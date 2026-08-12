import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const WEBHOOK_SECRET = Deno.env.get('POLAR_WEBHOOK_SECRET') ?? ''

const PRODUCT_PLAN_MAP: Record<string, string> = {
  '64f91fcc-0519-4ddf-8cbf-0509e3e7005d': 'single',
  '1892b459-43f9-465a-baf1-22a1b9416236': 'lifetime',
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  // Configure Polar to send this secret in the webhook request before enabling
  // this function in production. Leaving the secret unset keeps the existing
  // deployment compatible while allowing the secret to be enforced once set.
  if (WEBHOOK_SECRET) {
    const supplied = req.headers.get('x-fineinvoice-webhook-secret') ?? ''
    if (supplied !== WEBHOOK_SECRET) return new Response('Unauthorized', { status: 401 })
  }

  const body = await req.text()
  let event: any
  try {
    event = JSON.parse(body)
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  // Ignore unsupported events but acknowledge them so Polar does not retry.
  if (event?.type !== 'order.created') return json({ received: true })

  const order = event?.data ?? {}
  const customerEmail = String(order?.customer?.email ?? order?.user?.email ?? '').trim().toLowerCase()
  const productId = String(order?.product_id ?? order?.product?.id ?? '')
  const plan = PRODUCT_PLAN_MAP[productId]
  const providerPaymentId = String(order?.id ?? '')

  if (!customerEmail || !plan || !providerPaymentId) {
    // Do not activate access when the event cannot be mapped unambiguously.
    return json({ ok: false, reason: 'missing email, product, or order id' }, 400)
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  // Idempotency: Polar may retry a webhook. A unique provider/order id means
  // the same purchase can never create multiple payment records.
  const { data: existingPayment, error: existingError } = await supabase
    .from('payments')
    .select('id,user_id,plan,status')
    .eq('provider', 'polar')
    .eq('provider_payment_id', providerPaymentId)
    .maybeSingle()

  if (existingError) {
    console.error('Payment lookup failed:', existingError)
    return json({ error: 'payment lookup failed' }, 500)
  }

  if (existingPayment?.status === 'verified') {
    return json({ success: true, duplicate: true, plan: existingPayment.plan })
  }

  const { data: { users }, error: usersError } = await supabase.auth.admin.listUsers()
  if (usersError) {
    console.error('Unable to list users:', usersError)
    return json({ error: 'user lookup failed' }, 500)
  }

  const authUser = users?.find((u: any) => String(u.email ?? '').toLowerCase() === customerEmail)
  const userId = authUser?.id ?? null

  // Record the verified provider transaction first. If the customer account
  // does not exist yet, the payment remains auditable and can be reconciled.
  const paymentPayload = {
    user_id: userId,
    provider: 'polar',
    provider_payment_id: providerPaymentId,
    plan,
    amount: order?.amount ?? order?.total_amount ?? null,
    currency: order?.currency ?? null,
    status: 'verified',
    payload: order,
  }

  const { error: paymentError } = await supabase
    .from('payments')
    .upsert(paymentPayload, { onConflict: 'provider,provider_payment_id' })

  if (paymentError) {
    console.error('Payment record failed:', paymentError)
    return json({ error: 'payment record failed' }, 500)
  }

  if (!userId) {
    console.warn('Verified Polar payment has no matching FineInvoice account:', customerEmail)
    return json({ success: true, plan, email: customerEmail, accountFound: false })
  }

  const activatedAt = new Date().toISOString()
  const { error: profileError } = await supabase
    .from('profiles')
    .update({
      plan,
      // Single purchases grant one paid download. Lifetime has unlimited access.
      single_credits: plan === 'single' ? 1 : 0,
      updated_at: activatedAt,
    })
    .eq('id', userId)

  if (profileError) {
    console.error('Profile activation failed:', profileError)
    return json({ error: 'profile activation failed' }, 500)
  }

  // Keep Supabase Auth metadata compatible with the existing UI while the
  // application migrates fully to public.profiles.
  const { error: authError } = await supabase.auth.admin.updateUserById(userId, {
    user_metadata: {
      ...(authUser?.user_metadata ?? {}),
      plan,
      plan_activated_at: activatedAt,
    },
  })

  if (authError) console.error('Auth metadata update failed:', authError)

  return json({ success: true, plan, email: customerEmail, accountFound: true })
})

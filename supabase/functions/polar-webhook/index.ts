import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const PRODUCT_PLAN_MAP: Record<string, string> = {
  '64f91fcc-0519-4ddf-8cbf-0509e3e7005d': 'single',
  '1892b459-43f9-465a-baf1-22a1b9416236': 'lifetime',
}

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const body  = await req.text()
  console.log('Body received:', body.slice(0, 500))

  let event: any
  try { event = JSON.parse(body) }
  catch { return new Response('Invalid JSON', { status: 400 }) }

  console.log('Event type:', event.type)

  if (event.type !== 'order.created') {
    return new Response(JSON.stringify({ received: true }), { status: 200 })
  }

  const order         = event.data
  const customerEmail = order?.customer?.email ?? order?.user?.email ?? ''
  const productId     = order?.product_id ?? order?.product?.id ?? ''
  const plan          = PRODUCT_PLAN_MAP[productId]

  console.log('email:', customerEmail, 'productId:', productId, 'plan:', plan)

  if (!customerEmail || !plan) {
    console.log('Missing email or unknown product — returning 200')
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  const { data: { users } } = await supabase.auth.admin.listUsers()
  const authUser = users?.find((u: any) => u.email?.toLowerCase() === customerEmail.toLowerCase())
  const userId   = authUser?.id ?? null
  console.log('userId:', userId)

  await supabase.from('payment_submissions').insert({
    user_id: userId, email: customerEmail, plan,
    method: 'polar', txn: order.id ?? 'polar-' + Date.now(),
    whatsapp: '', status: 'verified', unlock_code: 'POLAR-AUTO',
    submitted_at: new Date().toISOString(),
  })

  if (userId) {
    await supabase.auth.admin.updateUserById(userId, {
      user_metadata: { plan, plan_activated_at: new Date().toISOString() }
    })
    console.log('✅ Plan', plan, 'activated for', customerEmail)
  }

  return new Response(JSON.stringify({ success: true, plan, email: customerEmail }), {
    status: 200, headers: { 'Content-Type': 'application/json' }
  })
})

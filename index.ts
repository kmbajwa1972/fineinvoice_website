import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const POLAR_WEBHOOK_SECRET = Deno.env.get('POLAR_WEBHOOK_SECRET') ?? ''
const SUPABASE_URL         = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

// Polar product ID → plan mapping
const PRODUCT_PLAN_MAP: Record<string, string> = {
  '64f91fcc-0519-4ddf-8cbf-0509e3e7005d': 'single',  // Single PDF $2
  // 'YOUR_LIFETIME_PRODUCT_ID': 'lifetime',          // Add after creating Lifetime product
}

// Standard Webhooks verification (Polar uses whsec_ prefixed base64 secret)
async function verifyStandardWebhook(
  body: string,
  webhookId: string,
  timestamp: string,
  signature: string,
  secret: string
): Promise<boolean> {
  try {
    // Strip whsec_ prefix and base64 decode the secret
    const rawSecret = secret.startsWith('whsec_') ? secret.slice(6) : secret
    const secretBytes = Uint8Array.from(atob(rawSecret), c => c.charCodeAt(0))

    // Signed content = "{webhook-id}.{webhook-timestamp}.{body}"
    const signedContent = `${webhookId}.${timestamp}.${body}`
    const encoder = new TextEncoder()

    const key = await crypto.subtle.importKey(
      'raw', secretBytes,
      { name: 'HMAC', hash: 'SHA-256' },
      false, ['sign']
    )

    const signatureBytes = await crypto.subtle.sign('HMAC', key, encoder.encode(signedContent))
    const computedSig = btoa(String.fromCharCode(...new Uint8Array(signatureBytes)))

    // Polar signature format: "v1,<base64>" — may have multiple space-separated
    const signatures = signature.split(' ')
    return signatures.some(sig => {
      const sigValue = sig.startsWith('v1,') ? sig.slice(3) : sig
      return sigValue === computedSig
    })
  } catch (e) {
    console.error('Signature verification error:', e)
    return false
  }
}

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const body      = await req.text()
  const webhookId = req.headers.get('webhook-id')        ?? ''
  const timestamp = req.headers.get('webhook-timestamp') ?? ''
  const signature = req.headers.get('webhook-signature') ?? ''

  console.log('Webhook received — id:', webhookId, 'timestamp:', timestamp)

  // Verify signature
  if (POLAR_WEBHOOK_SECRET) {
    const valid = await verifyStandardWebhook(body, webhookId, timestamp, signature, POLAR_WEBHOOK_SECRET)
    if (!valid) {
      console.error('❌ Invalid signature')
      return new Response('Unauthorized', { status: 401 })
    }
    console.log('✅ Signature valid')
  }

  let event: any
  try {
    event = JSON.parse(body)
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  console.log('Event type:', event.type)

  // Only handle order.created
  if (event.type !== 'order.created') {
    return new Response(JSON.stringify({ received: true }), { status: 200 })
  }

  const order         = event.data
  const customerEmail = order?.customer?.email ?? order?.user?.email ?? ''
  const productId     = order?.product_id ?? order?.product?.id ?? order?.items?.[0]?.product_id ?? ''
  const plan          = PRODUCT_PLAN_MAP[productId]

  console.log('Order data — email:', customerEmail, 'productId:', productId, 'plan:', plan)

  if (!customerEmail) {
    console.error('No customer email')
    return new Response(JSON.stringify({ error: 'no email' }), { status: 200 })
  }

  if (!plan) {
    console.error('Unknown product ID:', productId, '— add to PRODUCT_PLAN_MAP')
    return new Response(JSON.stringify({ error: 'unknown product', productId }), { status: 200 })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  // Find user in Supabase Auth by email
  const { data: { users }, error: listErr } = await supabase.auth.admin.listUsers()
  const authUser = users?.find(u => u.email?.toLowerCase() === customerEmail.toLowerCase())
  const userId   = authUser?.id ?? null

  console.log('Auth user found:', userId ? userId : 'NOT FOUND')

  // Record in payment_submissions
  const { error: insertErr } = await supabase
    .from('payment_submissions')
    .insert({
      user_id:      userId,
      email:        customerEmail,
      plan,
      method:       'polar',
      txn:          order.id ?? 'polar-' + Date.now(),
      whatsapp:     '',
      status:       'verified',
      unlock_code:  'POLAR-AUTO',
      submitted_at: new Date().toISOString(),
    })

  if (insertErr) console.error('Insert error:', insertErr.message)

  // Update user metadata in Supabase Auth
  if (userId) {
    const { error: updateErr } = await supabase.auth.admin.updateUserById(userId, {
      user_metadata: { plan, plan_activated_at: new Date().toISOString() }
    })
    if (updateErr) {
      console.error('Metadata update error:', updateErr.message)
    } else {
      console.log(`✅ Plan '${plan}' activated for ${customerEmail}`)
    }
  }

  return new Response(JSON.stringify({ success: true, plan, email: customerEmail }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  })
})
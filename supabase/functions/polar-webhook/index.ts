import { createClient } from 'npm:@supabase/supabase-js@2'
import { Webhook } from 'npm:standardwebhooks@1.0.0'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const POLAR_WEBHOOK_SECRET = Deno.env.get('POLAR_WEBHOOK_SECRET') ?? ''
const SINGLE_PRODUCT_ID = '64f91fcc-0519-4ddf-8cbf-0509e3e7005d'
const LIFETIME_PRODUCT_ID = '1892b459-43f9-465a-baf1-22a1b9416236'

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function planForProduct(productId: string | null | undefined) {
  if (productId === SINGLE_PRODUCT_ID) return 'single'
  if (productId === LIFETIME_PRODUCT_ID) return 'lifetime'
  return null
}

async function findUserByEmail(email: string | null | undefined) {
  if (!email) return null
  const target = email.trim().toLowerCase()
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw error
    const user = data.users.find((u) => (u.email ?? '').toLowerCase() === target)
    if (user) return user
    if (data.users.length < 1000) break
  }
  return null
}

async function sendWhatsApp(number: string | null | undefined, message: string) {
  const token = Deno.env.get('WHATSAPP_ACCESS_TOKEN')
  const phoneNumberId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID')
  if (!token || !phoneNumberId || !number) return { skipped: true }

  const recipient = number.replace(/\D/g, '')
  if (!recipient) return { skipped: true }

  const response = await fetch(`https://graph.facebook.com/v23.0/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: recipient,
      type: 'text',
      text: { preview_url: false, body: message },
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    console.error('[WhatsApp] delivery failed:', response.status, body)
    return { skipped: false, ok: false }
  }
  return { skipped: false, ok: true }
}

async function activatePaidOrder(order: any) {
  const productId = order?.product_id ?? order?.product?.id
  const plan = planForProduct(productId)
  if (!plan) {
    console.warn('[Polar] Ignoring unknown product:', productId)
    return
  }

  const orderId = String(order?.id ?? '')
  const email = order?.customer_email ?? order?.customer?.email ?? null
  const polarCustomerId = order?.customer_id ?? order?.customer?.id ?? null
  const user = await findUserByEmail(email)
  if (!user) {
    console.error('[Polar] No FineInvoice user matched customer email:', email)
    return
  }

  const metadata = user.user_metadata ?? {}
  const processedOrders = Array.isArray(metadata.polarProcessedOrderIds)
    ? metadata.polarProcessedOrderIds.map(String)
    : []
  if (orderId && processedOrders.includes(orderId)) {
    console.log('[Polar] Duplicate order ignored:', orderId)
    return
  }

  const nextProcessed = orderId ? [...processedOrders.slice(-49), orderId] : processedOrders
  const nextMetadata = {
    ...metadata,
    plan,
    planVerified: true,
    paymentProvider: 'polar',
    polarCustomerId,
    polarProductId: productId,
    polarOrderId: orderId,
    paidAt: order?.created_at ?? new Date().toISOString(),
    singleCredits: plan === 'single' ? 1 : 0,
    unlockedInvoiceIds: Array.isArray(metadata.unlockedInvoiceIds) ? metadata.unlockedInvoiceIds : [],
    polarProcessedOrderIds: nextProcessed,
  }

  const { error } = await supabase.auth.admin.updateUserById(user.id, { user_metadata: nextMetadata })
  if (error) throw error

  const name = metadata.name || user.email || 'there'
  const message = plan === 'lifetime'
    ? `Hi ${name}! 🎉 Your FineInvoice Lifetime Access payment has been confirmed. Your account is now active with unlimited PDF downloads.`
    : `Hi ${name}! 🎉 Your FineInvoice Single PDF payment has been confirmed. Your account now has 1 paid PDF download.`

  await sendWhatsApp(metadata.whatsapp, message)
  console.log('[Polar] Activated', plan, 'for', user.email)
}

async function handleRefund(order: any) {
  const productId = order?.product_id ?? order?.product?.id
  const plan = planForProduct(productId)
  if (!plan) return
  const email = order?.customer_email ?? order?.customer?.email ?? null
  const user = await findUserByEmail(email)
  if (!user) return

  const metadata = user.user_metadata ?? {}
  // A refunded payment must never leave a paid plan active.
  const nextMetadata = {
    ...metadata,
    plan: 'free',
    planVerified: false,
    paymentProvider: null,
    singleCredits: 3,
    polarRefunded: true,
    refundedAt: new Date().toISOString(),
  }
  const { error } = await supabase.auth.admin.updateUserById(user.id, { user_metadata: nextMetadata })
  if (error) throw error
  await sendWhatsApp(metadata.whatsapp, `Hi ${metadata.name || user.email || 'there'}, your FineInvoice Polar payment was refunded and your paid plan has been removed.`)
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405)
  if (!POLAR_WEBHOOK_SECRET || !SERVICE_ROLE_KEY) return json({ ok: false, error: 'Webhook is not configured' }, 500)

  const body = await request.text()
  const headers = {
    'webhook-id': request.headers.get('webhook-id') ?? '',
    'webhook-signature': request.headers.get('webhook-signature') ?? '',
    'webhook-timestamp': request.headers.get('webhook-timestamp') ?? '',
  }

  let payload: any
  try {
    // Polar's secret is supplied as a raw polar_whs_* string; Standard Webhooks
    // expects the secret encoded as base64.
    const base64Secret = btoa(POLAR_WEBHOOK_SECRET.trim())
    const webhook = new Webhook(base64Secret)
    payload = webhook.verify(body, headers)
  } catch (error) {
    console.error('[Polar] Invalid webhook signature:', error)
    return json({ ok: false, error: 'Invalid signature' }, 403)
  }

  try {
    switch (payload?.type) {
      case 'order.paid':
        await activatePaidOrder(payload.data)
        break
      case 'order.refunded':
        await handleRefund(payload.data)
        break
      default:
        console.log('[Polar] Ignored event:', payload?.type)
    }
    return json({ received: true })
  } catch (error) {
    console.error('[Polar] Webhook processing error:', error)
    return json({ ok: false, error: 'Webhook processing failed' }, 500)
  }
})

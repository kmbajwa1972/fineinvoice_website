import { createClient } from 'npm:@supabase/supabase-js@2'
import { Webhook } from 'npm:standardwebhooks@1.0.0'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const POLAR_WEBHOOK_SECRET = Deno.env.get('POLAR_WEBHOOK_SECRET') ?? ''
const SINGLE_PRODUCT_ID = '64f91fcc-0519-4ddf-8cbf-0509e3e7005d'
const LIFETIME_PRODUCT_ID = '1892b459-43f9-465a-baf1-22a1b9416236'
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
function json(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } }) }
function planForProduct(id: unknown) { if (id === SINGLE_PRODUCT_ID) return 'single'; if (id === LIFETIME_PRODUCT_ID) return 'lifetime'; return null }
function normaliseEmail(value: unknown) { return typeof value === 'string' ? value.trim().toLowerCase() : '' }
async function findUserByEmail(email: unknown) { const target = normaliseEmail(email); if (!target) return null; for (let page = 1; page <= 20; page++) { const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 }); if (error) throw error; const user = data.users.find(u => normaliseEmail(u.email) === target); if (user) return user; if (data.users.length < 1000) break } return null }
async function sendWhatsApp(number: unknown, message: string) { const token = Deno.env.get('WHATSAPP_ACCESS_TOKEN'); const phoneNumberId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID'); if (!token || !phoneNumberId || typeof number !== 'string' || !number.trim()) return { skipped: true }; const recipient = number.replace(/\D/g, ''); if (!recipient) return { skipped: true }; const response = await fetch(`https://graph.facebook.com/v23.0/${phoneNumberId}/messages`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ messaging_product: 'whatsapp', to: recipient, type: 'text', text: { preview_url: false, body: message } }) }); if (!response.ok) console.error('[WhatsApp] delivery failed:', response.status, await response.text()); return { skipped: false, ok: response.ok } }
async function activatePaidOrder(order: any) {
  const productId = order?.product_id ?? order?.product?.id
  const plan = planForProduct(productId)
  if (!plan) { console.warn('[Polar] Unknown product ignored:', productId); return }
  if (order?.paid !== true && order?.status !== 'paid') { console.warn('[Polar] Paid event without paid order; ignoring'); return }
  const orderId = String(order?.id ?? '')
  const email = order?.customer_email ?? order?.customer?.email
  const polarCustomerId = order?.customer_id ?? order?.customer?.id ?? null
  const user = await findUserByEmail(email)
  if (!user) { console.error('[Polar] No FineInvoice user matched customer email:', email); return }
  const metadata = user.user_metadata ?? {}
  const processed = Array.isArray(metadata.polarProcessedOrderIds) ? metadata.polarProcessedOrderIds.map(String) : []
  const duplicate = !!orderId && processed.includes(orderId)
  const currentPlan = String(metadata.plan ?? 'free').toLowerCase()
  const currentPaidCredits = Math.max(0, Number(metadata.paidSingleCredits ?? 0) || 0)
  // Redelivery must repair entitlement if the order was previously recorded but
  // the Auth metadata was incomplete. A true duplicate that is already healthy
  // is a no-op; a duplicate missing the expected entitlement is repaired.
  const healthy = plan === 'lifetime'
    ? currentPlan === 'lifetime' && metadata.planVerified === true
    : currentPlan === 'single' && metadata.planVerified === true && currentPaidCredits > 0
  if (duplicate && healthy) { console.log('[Polar] Duplicate healthy order ignored:', orderId); return }
  const baseFree = Math.max(0, Number(metadata.freePdfCredits ?? metadata.singleCredits ?? 3) || 0)
  const nextPaid = plan === 'single' ? Math.max(1, currentPaidCredits) : 0
  const nextProcessed = orderId ? [...processed.filter(id => id !== orderId).slice(-49), orderId] : processed
  const nextMetadata = {
    ...metadata,
    plan,
    planVerified: true,
    paymentProvider: 'polar',
    polarCustomerId,
    polarProductId: productId,
    polarOrderId: orderId || metadata.polarOrderId || null,
    paidAt: order?.created_at ?? metadata.paidAt ?? new Date().toISOString(),
    freePdfCredits: baseFree,
    paidSingleCredits: nextPaid,
    singleCredits: baseFree,
    unlockedInvoiceIds: Array.isArray(metadata.unlockedInvoiceIds) ? metadata.unlockedInvoiceIds : [],
    polarProcessedOrderIds: nextProcessed,
    polarRefunded: false,
  }
  const { error } = await supabase.auth.admin.updateUserById(user.id, { user_metadata: nextMetadata })
  if (error) throw error
  const name = metadata.name || user.email || 'there'
  const message = plan === 'lifetime' ? `Hi ${name}! 🎉 Your FineInvoice Lifetime Access payment has been confirmed. Your account is now active with unlimited PDF downloads.` : `Hi ${name}! 🎉 Your FineInvoice Single PDF payment has been confirmed. Your account now has 1 paid PDF download.`
  await sendWhatsApp(metadata.whatsapp, message)
  console.log('[Polar] Activated/repaired', plan, 'for', user.email, 'order', orderId)
}
async function handleRefund(order: any) {
  const productId = order?.product_id ?? order?.product?.id; const plan = planForProduct(productId); if (!plan) return
  const email = order?.customer_email ?? order?.customer?.email; const user = await findUserByEmail(email); if (!user) return
  const metadata = user.user_metadata ?? {}; const refundedOrderId = String(order?.id ?? '')
  if (refundedOrderId && metadata.polarOrderId && String(metadata.polarOrderId) !== refundedOrderId) return
  const { error } = await supabase.auth.admin.updateUserById(user.id, { user_metadata: { ...metadata, plan: 'free', planVerified: false, paymentProvider: null, polarRefunded: true, polarRefundedOrderId: refundedOrderId, refundedAt: new Date().toISOString(), paidSingleCredits: 0, singleCredits: Math.max(0, Number(metadata.freePdfCredits ?? 3) || 0) } })
  if (error) throw error
  await sendWhatsApp(metadata.whatsapp, `Hi ${metadata.name || user.email || 'there'}, your FineInvoice Polar payment was refunded and your paid plan has been removed.`)
}
Deno.serve(async request => {
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405)
  if (!POLAR_WEBHOOK_SECRET || !SERVICE_ROLE_KEY) return json({ ok: false, error: 'Webhook is not configured' }, 500)
  const body = await request.text()
  try {
    const webhook = new Webhook(btoa(POLAR_WEBHOOK_SECRET.trim()))
    const payload: any = webhook.verify(body, { 'webhook-id': request.headers.get('webhook-id') ?? '', 'webhook-signature': request.headers.get('webhook-signature') ?? '', 'webhook-timestamp': request.headers.get('webhook-timestamp') ?? '' })
    if (payload?.type === 'order.paid') await activatePaidOrder(payload.data)
    else if (payload?.type === 'order.refunded') await handleRefund(payload.data)
    else console.log('[Polar] Event acknowledged but not handled:', payload?.type)
    return json({ received: true })
  } catch (error) { console.error('[Polar] Webhook processing error:', error); return json({ ok: false, error: 'Webhook processing failed' }, 500) }
})
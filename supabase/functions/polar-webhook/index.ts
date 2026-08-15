import { createClient } from 'npm:@supabase/supabase-js@2'
import { Webhook } from 'npm:standardwebhooks@1.0.0'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const POLAR_WEBHOOK_SECRET = Deno.env.get('POLAR_WEBHOOK_SECRET') ?? ''
const SINGLE_PRODUCT_ID = '64f91fcc-0519-4ddf-8cbf-0509e3e7005d'
const LIFETIME_PRODUCT_ID = '1892b459-43f9-465a-baf1-22a1b9416236'

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
})

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

function emailOf(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function planForProduct(id: unknown) {
  const value = String(id ?? '').trim().toLowerCase()
  if (value === SINGLE_PRODUCT_ID.toLowerCase()) return 'single'
  if (value === LIFETIME_PRODUCT_ID.toLowerCase()) return 'lifetime'
  return null
}

function planFromName(value: unknown) {
  const name = String(value ?? '').trim().toLowerCase()
  if (name.includes('lifetime')) return 'lifetime'
  if (name.includes('single') || name.includes('pdf')) return 'single'
  return null
}

async function findUserByEmail(email: unknown) {
  const target = emailOf(email)
  if (!target) return null
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw error
    const user = data.users.find((u) => emailOf(u.email) === target)
    if (user) return user
    if (data.users.length < 1000) break
  }
  return null
}

async function sendWhatsApp(number: unknown, message: string) {
  const token = Deno.env.get('WHATSAPP_ACCESS_TOKEN')
  const phoneNumberId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID')
  if (!token || !phoneNumberId || typeof number !== 'string' || !number.trim()) return { skipped: true }
  const recipient = number.replace(/\D/g, '')
  if (!recipient) return { skipped: true }
  const response = await fetch(`https://graph.facebook.com/v23.0/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: recipient,
      type: 'text',
      text: { preview_url: false, body: message }
    })
  })
  if (!response.ok) console.error('[WhatsApp] delivery failed:', response.status, await response.text())
  return { skipped: false, ok: response.ok }
}

async function activatePaidOrder(order: any, eventType: string) {
  const productId = order?.product_id ?? order?.product?.id
  const productName = order?.product?.name ?? order?.product?.title ?? order?.product_name ?? order?.product_title
  const email = order?.customer_email ?? order?.customer?.email
  const polarCustomerId = order?.customer_id ?? order?.customer?.id ?? null
  const orderId = String(order?.id ?? '')
  const paid = order?.paid === true
  const status = String(order?.status ?? '').trim().toLowerCase()

  const user = await findUserByEmail(email)
  if (!user) {
    console.error('[Polar] No FineInvoice user matched customer email:', email)
    return
  }

  const metadata = user.user_metadata ?? {}
  const resolvedPlan =
    planForProduct(productId) ??
    planFromName(productName) ??
    (['single', 'lifetime'].includes(String(metadata.pendingPolarPlan ?? '').toLowerCase())
      ? String(metadata.pendingPolarPlan).toLowerCase()
      : null)

  console.log('[Polar] Fulfilment event received', {
    eventType, orderId, email: user.email, productId, productName, resolvedPlan, paid, status
  })

  if (!resolvedPlan) {
    console.error('[Polar] Could not resolve product to FineInvoice plan:', { productId, productName, orderId })
    return
  }
  if (!paid && status !== 'paid') {
    console.log('[Polar] Order is not paid yet; entitlement not granted:', { eventType, orderId, status, paid })
    return
  }

  const processed = Array.isArray(metadata.polarProcessedOrderIds)
    ? metadata.polarProcessedOrderIds.map(String)
    : []
  if (orderId && processed.includes(orderId)) {
    console.log('[Polar] Duplicate order ignored:', orderId)
    return
  }

  // Free credits belong to the customer account and remain available after
  // upgrading. Each Single purchase adds exactly one paid credit.
  const currentFree = Math.max(0, Number(metadata.freePdfCredits ?? metadata.singleCredits ?? 3) || 0)
  const currentPaid = Math.max(0, Number(metadata.paidSingleCredits ?? 0) || 0)

  let plan = resolvedPlan
  let freePdfCredits = currentFree
  let paidSingleCredits = currentPaid

  if (resolvedPlan === 'lifetime') {
    plan = 'lifetime'
    // Lifetime is unlimited; keep the balances in metadata for audit/history,
    // but the UI and access gate do not consume them.
  } else if (String(metadata.plan ?? 'free').toLowerCase() === 'lifetime') {
    // Never downgrade an existing Lifetime account because of a later Single purchase.
    plan = 'lifetime'
  } else {
    plan = 'single'
    paidSingleCredits = currentPaid + 1
  }

  const nextProcessed = orderId ? [...processed.slice(-49), orderId] : processed
  const activatedAt = new Date().toISOString()
  const totalCredits = freePdfCredits + paidSingleCredits

  const nextMetadata = {
    ...metadata,
    plan,
    planVerified: true,
    paymentProvider: 'polar',
    polarCustomerId,
    polarProductId: productId ?? metadata.polarProductId ?? null,
    polarOrderId: orderId || metadata.polarOrderId || null,
    paidAt: order?.created_at ?? metadata.paidAt ?? activatedAt,
    plan_activated_at: activatedAt,
    freePdfCredits,
    paidSingleCredits,
    // Backward-compatible total balance for older builds.
    singleCredits: totalCredits,
    unlockedInvoiceIds: Array.isArray(metadata.unlockedInvoiceIds) ? metadata.unlockedInvoiceIds : [],
    polarProcessedOrderIds: nextProcessed,
    polarRefunded: false,
    pendingPolarPlan: null
  }

  const { error } = await supabase.auth.admin.updateUserById(user.id, { user_metadata: nextMetadata })
  if (error) throw error

  // Keep the cloud profile's legacy balance aligned with the total remaining credits.
  const { error: profileError } = await supabase
    .from('profiles')
    .update({ plan, single_credits: totalCredits, updated_at: activatedAt })
    .eq('id', user.id)
  if (profileError) console.warn('[Polar] Profile credit sync warning:', profileError)

  console.log('[Polar] Activated entitlement', {
    userId: user.id,
    email: user.email,
    plan,
    freePdfCredits,
    paidSingleCredits,
    totalCredits,
    orderId,
    eventType
  })

  const name = metadata.name || user.email || 'there'
  const message = plan === 'lifetime'
    ? `Hi ${name}! 🎉 Your FineInvoice Lifetime Access payment has been confirmed. Your account is now active with unlimited PDF downloads.`
    : `Hi ${name}! 🎉 Your FineInvoice Single PDF payment has been confirmed. Your account now has ${totalCredits} PDF credit(s) available (${freePdfCredits} free + ${paidSingleCredits} paid).`
  await sendWhatsApp(metadata.whatsapp, message)
}

async function handleRefund(order: any) {
  const productId = order?.product_id ?? order?.product?.id
  const plan = planForProduct(productId) ?? planFromName(order?.product?.name ?? order?.product?.title)
  if (!plan) return

  const user = await findUserByEmail(order?.customer_email ?? order?.customer?.email)
  if (!user) return

  const metadata = user.user_metadata ?? {}
  const refundedOrderId = String(order?.id ?? '')
  if (refundedOrderId && metadata.polarOrderId && String(metadata.polarOrderId) !== refundedOrderId) return

  const freeCredits = Math.max(0, Number(metadata.freePdfCredits ?? 3) || 0)
  const { error } = await supabase.auth.admin.updateUserById(user.id, {
    user_metadata: {
      ...metadata,
      plan: 'free',
      planVerified: false,
      paymentProvider: null,
      polarRefunded: true,
      polarRefundedOrderId: refundedOrderId,
      refundedAt: new Date().toISOString(),
      paidSingleCredits: 0,
      singleCredits: freeCredits,
      freePdfCredits: freeCredits
    }
  })
  if (error) throw error

  await supabase.from('profiles').update({ plan: 'free', single_credits: freeCredits, updated_at: new Date().toISOString() }).eq('id', user.id)
  await sendWhatsApp(metadata.whatsapp, `Hi ${metadata.name || user.email || 'there'}, your FineInvoice Polar payment was refunded and your paid plan has been removed.`)
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405)
  if (!POLAR_WEBHOOK_SECRET || !SERVICE_ROLE_KEY) return json({ ok: false, error: 'Webhook is not configured' }, 500)

  const body = await request.text()
  try {
    const webhook = new Webhook(btoa(POLAR_WEBHOOK_SECRET.trim()))
    const payload: any = webhook.verify(body, {
      'webhook-id': request.headers.get('webhook-id') ?? '',
      'webhook-signature': request.headers.get('webhook-signature') ?? '',
      'webhook-timestamp': request.headers.get('webhook-timestamp') ?? ''
    })

    const eventType = String(payload?.type ?? 'unknown')
    console.log('[Polar] Webhook event:', eventType)
    if (eventType === 'order.paid' || eventType === 'order.created' || eventType === 'order.updated') {
      await activatePaidOrder(payload.data, eventType)
    } else if (eventType === 'order.refunded') {
      await handleRefund(payload.data)
    } else {
      console.log('[Polar] Event acknowledged but not handled:', eventType)
    }
    return json({ received: true })
  } catch (error) {
    console.error('[Polar] Webhook processing error:', error)
    return json({ ok: false, error: 'Webhook processing failed' }, 500)
  }
})

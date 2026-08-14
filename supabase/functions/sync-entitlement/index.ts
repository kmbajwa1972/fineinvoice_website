import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { 'Content-Type': 'application/json' } })
  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    if (!token) return new Response(JSON.stringify({ error: 'Missing authorization' }), { status: 401, headers: { 'Content-Type': 'application/json' } })

    const { data: authData, error: authError } = await admin.auth.getUser(token)
    if (authError || !authData.user) return new Response(JSON.stringify({ error: 'Invalid session' }), { status: 401, headers: { 'Content-Type': 'application/json' } })

    const user = authData.user
    const email = String(user.email ?? '').trim().toLowerCase()

    let customer: any = null
    const byUser = await admin.from('customers').select('id,email,plan,name,user_id').eq('user_id', user.id).maybeSingle()
    if (!byUser.error && byUser.data) customer = byUser.data
    if (!customer && email) {
      const byEmail = await admin.from('customers').select('id,email,plan,name,user_id').ilike('email', email).maybeSingle()
      if (!byEmail.error && byEmail.data) customer = byEmail.data
    }

    if (!customer) return new Response(JSON.stringify({ synced: false, reason: 'customer_not_found' }), { status: 200, headers: { 'Content-Type': 'application/json' } })

    const dbPlan = String(customer.plan ?? 'free').toLowerCase()
    if (!['free', 'single', 'lifetime'].includes(dbPlan)) return new Response(JSON.stringify({ synced: false, reason: 'invalid_plan' }), { status: 200, headers: { 'Content-Type': 'application/json' } })

    const meta = user.user_metadata ?? {}
    const currentPlan = String(meta.plan ?? 'free').toLowerCase()
    const currentPaid = Math.max(0, Number(meta.paidSingleCredits ?? 0) || 0)
    const alreadyPaidOrder = Boolean(meta.polarOrderId) && meta.paymentProvider === 'polar' && meta.planVerified === true

    // Only repair a missing/mismatched entitlement. Never replenish a paid
    // credit that the customer has legitimately consumed.
    if (dbPlan === 'single' && currentPlan === 'single' && alreadyPaidOrder) {
      return new Response(JSON.stringify({ synced: false, plan: 'single', paidSingleCredits: currentPaid, reason: 'already_activated' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }

    const nextMeta = {
      ...meta,
      plan: dbPlan,
      planVerified: dbPlan !== 'free',
      paymentProvider: dbPlan === 'free' ? (meta.paymentProvider ?? null) : 'polar',
      freePdfCredits: dbPlan === 'free' ? Math.max(0, Number(meta.freePdfCredits ?? meta.singleCredits ?? 3) || 0) : 0,
      paidSingleCredits: dbPlan === 'single' ? Math.max(1, currentPaid) : 0,
      singleCredits: dbPlan === 'single' ? Math.max(1, currentPaid) : (dbPlan === 'free' ? Math.max(0, Number(meta.freePdfCredits ?? meta.singleCredits ?? 3) || 0) : 0),
      unlockedInvoiceIds: Array.isArray(meta.unlockedInvoiceIds) ? meta.unlockedInvoiceIds : []
    }

    const { error: updateError } = await admin.auth.admin.updateUserById(user.id, { user_metadata: nextMeta })
    if (updateError) throw updateError

    return new Response(JSON.stringify({ synced: true, plan: dbPlan, paidSingleCredits: nextMeta.paidSingleCredits, freePdfCredits: nextMeta.freePdfCredits }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  } catch (error) {
    console.error('[sync-entitlement]', error)
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Sync failed' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
})

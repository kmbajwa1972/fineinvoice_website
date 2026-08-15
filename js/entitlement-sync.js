(() => {
  'use strict';
  const SUPABASE_URL = 'https://mozllscpvaxdigatsxiu.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_r_O7AsGp8D91rDquxrCJrw_7OMCI6kG';
  let client = null;
  let timer = null;

  function getClient() {
    if (client) return client;
    if (!window.supabase?.createClient) return null;
    client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    return client;
  }

  function readLocal() {
    try { return JSON.parse(localStorage.getItem('fi_current_user') || 'null') || {}; }
    catch { return {}; }
  }

  function apply(user) {
    if (!user) return;
    const meta = user.user_metadata || {};
    const local = readLocal();
    let plan = String(meta.plan || local.plan || 'free').toLowerCase();
    if (!['free', 'single', 'lifetime'].includes(plan)) plan = 'free';

    const free = plan === 'free'
      ? Math.max(0, Number(meta.freePdfCredits ?? meta.singleCredits ?? local.freePdfCredits ?? local.singleCredits ?? 3) || 0)
      : 0;
    const paid = plan === 'single'
      ? Math.max(0, Number(meta.paidSingleCredits ?? local.paidSingleCredits ?? 0) || 0)
      : 0;

    const next = {
      ...local,
      id: user.id,
      email: user.email || local.email || '',
      name: meta.name || local.name || user.email || 'User',
      plan,
      planVerified: meta.planVerified === true,
      paymentProvider: meta.paymentProvider || local.paymentProvider || null,
      plan_activated_at: meta.plan_activated_at || local.plan_activated_at || null,
      freePdfCredits: free,
      paidSingleCredits: paid,
      singleCredits: plan === 'free' ? free : paid,
      unlockedInvoiceIds: Array.isArray(meta.unlockedInvoiceIds)
        ? [...new Set(meta.unlockedInvoiceIds.map(String))]
        : (local.unlockedInvoiceIds || []),
      whatsapp: meta.whatsapp || local.whatsapp || null
    };

    const changed = JSON.stringify({
      plan: local.plan,
      freePdfCredits: local.freePdfCredits,
      paidSingleCredits: local.paidSingleCredits,
      planVerified: local.planVerified
    }) !== JSON.stringify({
      plan: next.plan,
      freePdfCredits: next.freePdfCredits,
      paidSingleCredits: next.paidSingleCredits,
      planVerified: next.planVerified
    });

    localStorage.setItem('fi_current_user', JSON.stringify(next));

    if (changed) {
      window.dispatchEvent(new CustomEvent('fineinvoice:entitlement-updated', {
        detail: { user: next, plan, freePdfCredits: free, paidSingleCredits: paid }
      }));
    }

    if (typeof window.refreshDashboardEntitlement === 'function') {
      window.refreshDashboardEntitlement(next);
    }
  }

  async function sync() {
    try {
      const sb = getClient();
      if (!sb) return;
      let { data, error } = await sb.auth.getUser();
      if (error || !data?.user) return;
      apply(data.user);
    } catch (error) {
      console.warn('FineInvoice entitlement sync:', error);
    }
  }

  function start() {
    if (window.__fineInvoiceLiveEntitlementStarted) return;
    window.__fineInvoiceLiveEntitlementStarted = true;
    sync();
    timer = setInterval(sync, 2000);
    window.addEventListener('focus', sync);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') sync();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();

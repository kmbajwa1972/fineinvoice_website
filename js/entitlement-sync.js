(() => {
  const URL = 'https://mozllscpvaxdigatsxiu.supabase.co';
  const KEY = 'sb_publishable_r_O7AsGp8D91rDquxrCJrw_7OMCI6kG';
  let client;
  function getClient() {
    if (client) return client;
    if (window.supabase?.createClient) {
      client = window.supabase.createClient(URL, KEY, { auth: { persistSession: true, autoRefreshToken: true } });
    }
    return client;
  }
  async function sync() {
    try {
      const sb = getClient();
      if (!sb) return;
      const { data: sessionData } = await sb.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) return;
      const res = await fetch(`${URL}/functions/v1/sync-entitlement`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: KEY,
          'Content-Type': 'application/json'
        },
        body: '{}'
      });
      if (!res.ok) return;
      const result = await res.json();
      if (result?.synced || result?.plan) {
        await sb.auth.refreshSession();
        const { data: fresh } = await sb.auth.getUser();
        const user = fresh?.user;
        if (!user) return;
        const meta = user.user_metadata || {};
        const local = (() => { try { return JSON.parse(localStorage.getItem('fi_current_user') || 'null'); } catch { return null; } })() || {};
        const plan = String(meta.plan || result.plan || local.plan || 'free').toLowerCase();
        const free = plan === 'free' ? Math.max(0, Number(meta.freePdfCredits ?? meta.singleCredits ?? local.freePdfCredits ?? 0) || 0) : 0;
        const paid = plan === 'single' ? Math.max(0, Number(meta.paidSingleCredits ?? result.paidSingleCredits ?? local.paidSingleCredits ?? 0) || 0) : 0;
        const next = { ...local, id: user.id, email: user.email || local.email || '', name: meta.name || local.name || user.email || 'User', plan, planVerified: meta.planVerified === true, paymentProvider: meta.paymentProvider || local.paymentProvider || null, freePdfCredits: free, paidSingleCredits: paid, singleCredits: plan === 'free' ? free : 0, unlockedInvoiceIds: Array.isArray(meta.unlockedInvoiceIds) ? meta.unlockedInvoiceIds : (local.unlockedInvoiceIds || []) };
        localStorage.setItem('fi_current_user', JSON.stringify(next));
        window.dispatchEvent(new CustomEvent('fineinvoice:entitlement-updated', { detail: { user: next, plan, freePdfCredits: free, paidSingleCredits: paid } }));
        if (typeof window.refreshEntitlementUI === 'function') window.refreshEntitlementUI(true);
        if (typeof window.renderUserChip === 'function') window.renderUserChip('userChip');
      }
    } catch (e) {
      console.warn('FineInvoice entitlement sync:', e);
    }
  }
  window.addEventListener('DOMContentLoaded', () => {
    sync();
    setInterval(sync, 3000);
  });
  window.addEventListener('focus', sync);
})();

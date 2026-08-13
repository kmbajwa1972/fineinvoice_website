/* FineInvoice commercial entitlement manager
 * Free PDF/Print uses, paid Single PDF credits and Lifetime access.
 * Supabase user metadata is authoritative; localStorage is only a UI cache.
 */
(function () {
  'use strict';
  const FREE_START = 3;
  const PLAN_LIFETIME = 'lifetime';

  function normalizeUser(user) {
    if (!user) return null;
    const plan = String(user.plan || 'free').toLowerCase();
    return {
      ...user,
      plan,
      freePdfCredits: Number.isFinite(Number(user.freePdfCredits))
        ? Math.max(0, Number(user.freePdfCredits))
        : (Number.isFinite(Number(user.singleCredits)) ? Math.max(0, Number(user.singleCredits)) : FREE_START),
      paidSingleCredits: Math.max(0, Number(user.paidSingleCredits || 0)),
      unlockedInvoiceIds: Array.isArray(user.unlockedInvoiceIds) ? [...new Set(user.unlockedInvoiceIds.map(String))] : []
    };
  }

  function invoiceEntitlementId(invoice) {
    if (!invoice) return null;
    return String(invoice.entitlementId || invoice.id || '');
  }

  window.FineInvoiceEntitlements = {
    FREE_START,
    normalizeUser,
    invoiceEntitlementId,
    isLifetime(user) {
      return String(user?.plan || '').toLowerCase() === PLAN_LIFETIME;
    },
    isUnlocked(user, invoiceId) {
      return !!invoiceId && Array.isArray(user?.unlockedInvoiceIds) && user.unlockedInvoiceIds.includes(String(invoiceId));
    },
    async consume(invoiceId) {
      if (!invoiceId) return { ok: false, error: 'Invoice ID is required.' };
      if (typeof window.consumeInvoiceCredit === 'function') return window.consumeInvoiceCredit(invoiceId);
      return { ok: false, error: 'Entitlement service is not available.' };
    }
  };
})();

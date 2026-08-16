(() => {
  'use strict';

  // Compatibility shim only.
  // FineInvoice already has one shared entitlement/session manager in js/utils.js.
  // Creating another Supabase client here caused the "Multiple GoTrueClient
  // instances" warning and allowed two entitlement syncers to fight over
  // localStorage plan/credit state.
  function installToastGuard() {
    if (typeof window.showToast !== 'function' || window.__fineInvoiceActivationToastGuard) return;
    const original = window.showToast;
    window.__fineInvoiceActivationToastGuard = true;
    window.showToast = function (msg, type, duration) {
      const text = String(msg || '').trim();
      if (/^(Single|Lifetime) plan activated\b/i.test(text)) return;
      return original.apply(this, arguments);
    };
  }

  function startSharedSync() {
    installToastGuard();

    if (typeof window.startEntitlementSync === 'function') {
      window.startEntitlementSync();
      return;
    }

    // utils.js is parser-blocking on the pages that use this file, so its
    // DOMContentLoaded handler normally exists before this callback runs.
    // If it is absent, deliberately do nothing rather than creating a second
    // Supabase client with the same storage key.
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startSharedSync, { once: true });
  } else {
    startSharedSync();
  }
})();

// FineInvoice — single entitlement engine loader
(() => {
  if (window.__fineInvoiceEntitlementLoader) return;
  window.__fineInvoiceEntitlementLoader = true;
  const s = document.createElement('script');
  s.src = 'js/entitlements-final.js?v=20260816-1';
  s.defer = false;
  document.head.appendChild(s);
})();

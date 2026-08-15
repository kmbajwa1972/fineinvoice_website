/* FineInvoice PDF entitlement fix
 * One gate only: generate first, consume exactly one credit after success.
 * Existing saved invoices keep access through stable ID/entitlementId/invoice-number aliases.
 */
(function () {
  'use strict';

  // js/utils.js contains a legacy second PDF wrapper. Tell it not to wrap the
  // production download function again; otherwise one free PDF can consume
  // two credits and previously unlocked invoices can appear locked.
  window.__fineInvoiceStrictPdfGateWrapped = true;

  function aliasesForCurrentInvoice() {
    const ids = new Set();
    const add = value => {
      if (value !== undefined && value !== null && String(value).trim() !== '') ids.add(String(value));
    };

    if (typeof currentDraftId !== 'undefined') add(currentDraftId);

    const requested = new URLSearchParams(location.search).get('invoice');
    add(requested);

    if (typeof getInvoices === 'function') {
      const invoices = getInvoices();
      const match = invoices.find(inv => {
        const values = [inv?.id, inv?.entitlementId, inv?.invNumber, inv?.invoice_number];
        return values.some(v => v !== undefined && v !== null && String(v) === String(requested || currentDraftId || ''));
      });
      if (match) {
        add(match.id);
        add(match.entitlementId);
        add(match.invNumber);
        add(match.invoice_number);
      }
    }

    add(document.getElementById('invNumber')?.value);
    return [...ids];
  }

  function userUnlocked(user) {
    const unlocked = Array.isArray(user?.unlockedInvoiceIds)
      ? user.unlockedInvoiceIds.map(String)
      : [];
    return aliasesForCurrentInvoice().some(id => unlocked.includes(id));
  }

  function currentInvoiceId() {
    const aliases = aliasesForCurrentInvoice();
    return aliases[0] || String(document.getElementById('invNumber')?.value || 'draft');
  }

  // Override the global access helper so old invoices whose stored entitlement
  // ID differs from their current URL ID still resolve to the same entitlement.
  window.invoiceHasAccess = function (user) {
    if (!user) return false;
    const plan = String(user.plan || 'free').toLowerCase();
    if (plan === 'lifetime') return true;
    if (userUnlocked(user)) return true;
    return Number(user.freePdfCredits || 0) + Number(user.paidSingleCredits || 0) > 0;
  };

  // The print wrapper in utils.js calls consumeInvoiceCredit(). Replace it with
  // an alias-aware version so printing and PDF use the same persistent identity.
  window.addEventListener('load', function () {
    if (typeof consumeInvoiceCredit === 'function') {
      const originalConsume = consumeInvoiceCredit;
      window.consumeInvoiceCredit = async function (user, invoiceId) {
        const beforeAliases = aliasesForCurrentInvoice();
        const canonical = beforeAliases[0] || String(invoiceId || currentInvoiceId());
        const result = await originalConsume(user, canonical);
        if (!result?.ok || result.alreadyUnlocked || user?.plan === 'lifetime') return result;

        // Preserve every known identity for this saved invoice. This is only an
        // alias update; the credit was consumed exactly once above.
        const aliases = [...new Set([...beforeAliases, canonical])];
        const unlocked = [...new Set([...(user.unlockedInvoiceIds || []).map(String), ...aliases])];
        const sb = typeof getSupabase === 'function' ? getSupabase() : null;
        if (sb) {
          try {
            const { error } = await sb.auth.updateUser({
              data: { unlockedInvoiceIds: unlocked }
            });
            if (error) console.warn('FineInvoice entitlement alias sync failed:', error);
          } catch (error) {
            console.warn('FineInvoice entitlement alias sync failed:', error);
          }
        }
        user.unlockedInvoiceIds = unlocked;
        if (typeof saveCurrentUser === 'function') saveCurrentUser(user);
        return result;
      };
    }

    // Restore a fuller A4 print scale. The document remains one A4 sheet;
    // this only prevents the compact screen styling from making print output
    // unnecessarily tiny.
    const style = document.createElement('style');
    style.textContent = `
      @media print {
        @page { size: A4 portrait; margin: 8mm; }
        body.print-mode #invoiceDoc { font-size: 12px !important; line-height: 1.35 !important; }
        body.print-mode .invoice-paper { width: 100% !important; max-width: none !important; padding: 4mm 3mm !important; }
        body.print-mode .inv-company-name { font-size: 22px !important; }
        body.print-mode .inv-bill-name { font-size: 15px !important; }
        body.print-mode .inv-small, body.print-mode .inv-details { font-size: 11px !important; }
        body.print-mode .inv-items-table { font-size: 11px !important; }
        body.print-mode .inv-items-table th { font-size: 9px !important; }
        body.print-mode .inv-items-table td { padding: 6px 7px !important; }
        body.print-mode .inv-total-row { font-size: 11px !important; }
        body.print-mode .inv-grand { font-size: 15px !important; }
        body.print-mode .inv-footer { font-size: 9px !important; }
      }
    `;
    document.head.appendChild(style);
  });

  // Use the builder's existing generatePDF() routine so the current invoice
  // layout, blank-row filtering and A4 handling stay intact. We only own the
  // entitlement gate here.
  window.addEventListener('load', function () {
    window.downloadPDF = async function () {
      const user = typeof getInvoiceAccessUser === 'function'
        ? await getInvoiceAccessUser()
        : (typeof getCurrentUser === 'function' ? getCurrentUser() : null);

      if (!user) {
        showToast('Please sign in again to create a PDF.', 'error', 5000);
        return;
      }

      const invoiceId = currentInvoiceId();
      const unlocked = userUnlocked(user);
      const lifetime = String(user.plan || 'free').toLowerCase() === 'lifetime';
      const credits = Number(user.freePdfCredits || 0) + Number(user.paidSingleCredits || 0);

      if (!lifetime && !unlocked && credits <= 0) {
        showToast('No PDF credits remaining. Please purchase a PDF credit or Lifetime Access.', 'error', 5000);
        if (confirm('You have no PDF credits remaining.\n\nSingle: $2 per PDF\nor Lifetime: $25 unlimited.\n\nGo to Billing?')) {
          location.href = 'payment.html';
        }
        return;
      }

      try {
        if (typeof generatePDF !== 'function') throw new Error('PDF engine unavailable');
        showToast('Generating PDF…', 'info');
        const doc = await generatePDF();
        if (!doc || typeof doc.save !== 'function') throw new Error('PDF generation failed');

        // Consume only after successful PDF creation. Re-downloading an
        // already-unlocked invoice never consumes another credit.
        if (!lifetime && !unlocked) {
          const result = await consumeInvoiceCredit(user, invoiceId);
          if (!result?.ok) {
            showToast(result?.error || 'Could not save PDF entitlement.', 'error', 6000);
            return;
          }
        }

        const number = String(document.getElementById('invNumber')?.value || 'invoice')
          .replace(/[^a-z0-9._-]/gi, '_');
        doc.save(number + '.pdf');
        localStorage.setItem('fi_downloads', String(parseInt(localStorage.getItem('fi_downloads') || '0', 10) + 1));
        showToast('PDF downloaded! 🎉', 'success');
      } catch (error) {
        console.error('FineInvoice PDF generation failed:', error);
        showToast('PDF generation failed. Your PDF credit was not used.', 'error', 5000);
      }
    };
  });
})();

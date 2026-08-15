/* FineInvoice PDF entitlement fix
 * One gate only: generate first, consume exactly one credit after success.
 * Existing saved invoices keep access through stable ID/entitlementId/invoice-number aliases.
 */
(function () {
  'use strict';

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

  function currentInvoiceNumber() {
    const value = document.getElementById('invNumber')?.value || '';
    const match = String(value).match(/(?:INV[-_ ]?)?(\d+)/i);
    return match ? Number(match[1]) : null;
  }

  function isLegacyUnlocked(user) {
    // Compatibility repair for invoices created before the entitlement ID was
    // stabilised. If three free PDFs were already generated, INV-001..INV-003
    // must remain downloadable. This is intentionally limited to the first
    // three invoice numbers so invoice #4 still correctly requires payment.
    if (String(user?.plan || 'free').toLowerCase() !== 'free') return false;

    const oldDownloads = parseInt(localStorage.getItem('fi_downloads') || '0', 10);
    if (oldDownloads < 1) return false;

    const number = currentInvoiceNumber();
    if (Number.isFinite(number) && number >= 1 && number <= Math.min(3, oldDownloads)) return true;

    if (typeof getInvoices !== 'function') return false;
    const invoices = getInvoices();
    if (!Array.isArray(invoices) || !invoices.length) return false;

    const aliases = new Set(aliasesForCurrentInvoice());
    const firstThree = [...invoices]
      .filter(Boolean)
      .sort((a, b) => new Date(a.date || a.createdAt || 0) - new Date(b.date || b.createdAt || 0))
      .slice(0, Math.min(3, oldDownloads));

    return firstThree.some(inv =>
      [inv.id, inv.entitlementId, inv.invNumber, inv.invoice_number]
        .some(v => v != null && aliases.has(String(v)))
    );
  }

  function userUnlocked(user) {
    const unlocked = Array.isArray(user?.unlockedInvoiceIds)
      ? user.unlockedInvoiceIds.map(String)
      : [];
    return aliasesForCurrentInvoice().some(id => unlocked.includes(id)) || isLegacyUnlocked(user);
  }

  function currentInvoiceId() {
    const aliases = aliasesForCurrentInvoice();
    return aliases[0] || String(document.getElementById('invNumber')?.value || 'draft');
  }

  window.invoiceHasAccess = function (user) {
    if (!user) return false;
    const plan = String(user.plan || 'free').toLowerCase();
    if (plan === 'lifetime') return true;
    if (userUnlocked(user)) return true;
    return Number(user.freePdfCredits || 0) + Number(user.paidSingleCredits || 0) > 0;
  };

  window.addEventListener('load', function () {
    if (typeof consumeInvoiceCredit === 'function') {
      const originalConsume = consumeInvoiceCredit;
      window.consumeInvoiceCredit = async function (user, invoiceId) {
        const aliases = aliasesForCurrentInvoice();
        const canonical = aliases[0] || String(invoiceId || currentInvoiceId());
        const result = await originalConsume(user, canonical);
        if (!result?.ok || result.alreadyUnlocked || user?.plan === 'lifetime') return result;

        const unlocked = [...new Set([
          ...(user.unlockedInvoiceIds || []).map(String),
          ...aliases,
          canonical
        ])];

        const sb = typeof getSupabase === 'function' ? getSupabase() : null;
        if (sb) {
          try {
            const { error } = await sb.auth.updateUser({ data: { unlockedInvoiceIds: unlocked } });
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
        if (confirm('You have no PDF credits remaining.\n\nSingle: $2 per PDF\nor Lifetime: $25 unlimited.\n\nGo to Billing?')) location.href = 'payment.html';
        return;
      }

      try {
        if (typeof generatePDF !== 'function') throw new Error('PDF engine unavailable');
        showToast('Generating PDF…', 'info');
        const doc = await generatePDF();
        if (!doc || typeof doc.save !== 'function') throw new Error('PDF generation failed');

        if (!lifetime && !unlocked) {
          const result = await consumeInvoiceCredit(user, invoiceId);
          if (!result?.ok) {
            showToast(result?.error || 'Could not save PDF entitlement.', 'error', 6000);
            return;
          }
        }

        const number = String(document.getElementById('invNumber')?.value || 'invoice').replace(/[^a-z0-9._-]/gi, '_');
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

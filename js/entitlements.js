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

  /*
   * Final PDF/print renderer.
   * The invoice preview is already the correct visual document. The previous
   * PDF code captured the editor layout, which is much taller than the print
   * document. We now render the SAME print-mode invoice that the browser print
   * preview shows, then fit that canvas to A4. This keeps PDF and Print aligned.
   */
  window.addEventListener('load', function () {
    window.downloadPDF = async function () {
      const u = typeof getInvoiceAccessUser === 'function'
        ? await getInvoiceAccessUser()
        : (typeof getCurrentUser === 'function' ? getCurrentUser() : null);
      const invoiceId = String(
        (typeof currentDraftId !== 'undefined' && currentDraftId)
          ? currentDraftId
          : (document.getElementById('invNumber')?.value || 'draft')
      );

      const accessCheck = typeof invoiceHasAccess === 'function' ? invoiceHasAccess(u, invoiceId) : !!u;
      if (!accessCheck) {
        if (confirm('Your free PDF credits have been used.\n\nSingle: $2 per invoice\nor Lifetime: $25 unlimited.\n\nGo to Billing?')) {
          window.location.href = 'payment.html';
        }
        return;
      }

      const plan = String(u?.plan || 'free').toLowerCase();
      const unlocked = Array.isArray(u?.unlockedInvoiceIds) && u.unlockedInvoiceIds.map(String).includes(invoiceId);
      const alreadyUnlocked = plan === 'lifetime' || unlocked;
      const source = document.getElementById('invoiceDoc');
      if (!source) {
        showToast('Invoice preview not found.', 'error');
        return;
      }

      showToast('Generating A4 PDF…', 'info');
      let printStyle = null;
      let printModeAdded = false;

      try {
        /* Make PDF visually identical to browser Print Preview. */
        document.body.classList.add('print-mode');
        printModeAdded = true;

        printStyle = document.createElement('style');
        printStyle.id = 'fineinvoice-pdf-layout-style';
        printStyle.textContent = `
          body.print-mode .preview-body,
          body.print-mode #invoiceDoc {
            padding: 7mm !important;
            min-height: 0 !important;
            height: auto !important;
            margin: 0 !important;
            background: #fff !important;
            box-sizing: border-box !important;
          }
          body.print-mode #invoiceDoc {
            width: 100% !important;
            max-width: 100% !important;
            font-size: 10px !important;
            line-height: 1.25 !important;
          }
          body.print-mode #invoiceDoc .inv-header {
            margin-bottom: 10px !important;
            padding-bottom: 8px !important;
            border-bottom-width: 1px !important;
          }
          body.print-mode #invoiceDoc .inv-company-name { font-size: 17px !important; margin-bottom: 2px !important; }
          body.print-mode #invoiceDoc .inv-company-email { font-size: 9px !important; }
          body.print-mode #invoiceDoc .inv-logo { max-width: 105px !important; max-height: 38px !important; }
          body.print-mode #invoiceDoc .inv-badge { font-size: 21px !important; }
          body.print-mode #invoiceDoc .inv-meta { margin-bottom: 9px !important; }
          body.print-mode #invoiceDoc .inv-bill-label { font-size: 8px !important; margin-bottom: 3px !important; }
          body.print-mode #invoiceDoc .inv-bill-name { font-size: 12px !important; }
          body.print-mode #invoiceDoc .inv-details { font-size: 9px !important; }
          body.print-mode #invoiceDoc .inv-details div { margin-bottom: 2px !important; }
          body.print-mode #invoiceDoc .inv-items-table { margin-bottom: 9px !important; font-size: 9px !important; }
          body.print-mode #invoiceDoc .inv-items-table th { padding: 4px 5px !important; font-size: 7.5px !important; border-bottom-width: 1px !important; }
          body.print-mode #invoiceDoc .inv-items-table td { padding: 4px 5px !important; }
          body.print-mode #invoiceDoc .inv-totals { margin-bottom: 8px !important; }
          body.print-mode #invoiceDoc .inv-totals-box { min-width: 175px !important; }
          body.print-mode #invoiceDoc .inv-total-row { font-size: 9px !important; margin-bottom: 2px !important; }
          body.print-mode #invoiceDoc .inv-grand { font-size: 12px !important; padding-top: 5px !important; margin-top: 3px !important; min-height: 0 !important; }
          body.print-mode #invoiceDoc .inv-footer { font-size: 7.5px !important; padding-top: 6px !important; }
          body.print-mode #invoiceDoc > div[style*="background:#f9f7ff"] {
            padding: 7px 9px !important;
            margin-bottom: 8px !important;
            font-size: 9px !important;
          }
          body.print-mode #invoiceDoc * { break-inside: avoid !important; page-break-inside: avoid !important; }
        `;
        document.head.appendChild(printStyle);

        if (document.fonts?.ready) await document.fonts.ready;
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

        /* Capture the actual print-mode invoice, not a clone of the editor. */
        const canvas = await html2canvas(source, {
          scale: 2,
          useCORS: true,
          backgroundColor: '#ffffff',
          logging: false,
          width: source.scrollWidth,
          height: source.scrollHeight,
          windowWidth: source.scrollWidth,
          windowHeight: source.scrollHeight,
          scrollX: 0,
          scrollY: 0
        });

        const { jsPDF } = window.jspdf || {};
        if (!jsPDF) throw new Error('PDF engine unavailable');

        const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        const pageW = doc.internal.pageSize.getWidth();
        const pageH = doc.internal.pageSize.getHeight();
        const margin = 8;
        const usableW = pageW - margin * 2;
        const usableH = pageH - margin * 2;
        const naturalH = (canvas.height * usableW) / canvas.width;
        const invNum = document.getElementById('invNumber')?.value || 'invoice';
        const safeName = String(invNum).replace(/[^a-z0-9._-]/gi, '_');

        /* Fit any normal invoice to one A4 page. */
        if (naturalH <= usableH) {
          doc.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', margin, margin, usableW, naturalH);
        } else {
          /* Only genuinely long invoices receive a second page. */
          const scale = usableW / canvas.width;
          const scaledH = canvas.height * scale;
          const pageSourceHeight = Math.max(1, Math.floor(usableH / scale));
          let y = 0;
          let page = 0;
          while (y < canvas.height) {
            if (page > 0) doc.addPage();
            const h = Math.min(pageSourceHeight, canvas.height - y);
            const slice = document.createElement('canvas');
            slice.width = canvas.width;
            slice.height = h;
            const ctx = slice.getContext('2d');
            if (!ctx) throw new Error('PDF canvas unavailable');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, slice.width, slice.height);
            ctx.drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
            doc.addImage(slice.toDataURL('image/jpeg', 0.95), 'JPEG', margin, margin, usableW, Math.min(usableH, h * scale));
            y += h;
            page += 1;
          }
        }

        doc.save(`${safeName}.pdf`);

        if (!alreadyUnlocked && typeof consumeCommercialInvoiceCredit === 'function') {
          const result = await consumeCommercialInvoiceCredit(u, invoiceId);
          if (!result?.ok) {
            showToast(result?.error || 'Could not save PDF entitlement', 'error', 6000);
            return;
          }
        }

        const downloads = parseInt(localStorage.getItem('fi_downloads') || '0', 10) + 1;
        localStorage.setItem('fi_downloads', String(downloads));
        showToast('PDF downloaded successfully! 🎉', 'success');
      } catch (error) {
        console.error('FineInvoice PDF generation failed:', error);
        showToast('PDF generation failed. Your PDF credit was not used.', 'error', 5000);
      } finally {
        printStyle?.remove();
        if (printModeAdded) document.body.classList.remove('print-mode');
      }
    };
  });
})();

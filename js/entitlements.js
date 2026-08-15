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

  /* PDF uses the same compact presentation as the browser print preview.
     The live builder is a two-column editor; capturing that screen directly
     makes html2canvas include the wrong layout dimensions. We temporarily
     enable print-mode, then render a fixed A4-width invoice clone. */
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
      const alreadyUnlocked = plan === 'lifetime' || (u?.unlockedInvoiceIds || []).map(String).includes(invoiceId);
      const source = document.getElementById('invoiceDoc');
      if (!source) {
        showToast('Invoice preview not found.', 'error');
        return;
      }

      showToast('Generating A4 PDF…', 'info');
      let clone = null;
      let printModeAdded = false;
      let compactStyle = null;
      try {
        document.body.classList.add('print-mode');
        printModeAdded = true;
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

        clone = source.cloneNode(true);
        clone.id = 'invoiceDocPdfRender';
        clone.style.cssText = [
          'position:absolute', 'left:-10000px', 'top:0',
          'width:194mm', 'max-width:194mm', 'min-width:194mm',
          'height:auto', 'min-height:0', 'margin:0',
          'padding:8mm', 'box-sizing:border-box',
          'background:#ffffff', 'overflow:visible',
          'font-family:Plus Jakarta Sans,sans-serif',
          'font-size:11px', 'line-height:1.35', 'color:#1A1A2E'
        ].join(';');
        document.body.appendChild(clone);

        compactStyle = document.createElement('style');
        compactStyle.id = 'fineinvoice-pdf-compact-style';
        compactStyle.textContent = `
          #invoiceDocPdfRender{width:194mm!important;max-width:194mm!important;min-width:194mm!important}
          #invoiceDocPdfRender .inv-header{margin-bottom:10px!important;padding-bottom:8px!important}
          #invoiceDocPdfRender .inv-company-name{font-size:18px!important;margin-bottom:2px!important}
          #invoiceDocPdfRender .inv-company-email{font-size:10px!important}
          #invoiceDocPdfRender .inv-logo{max-height:38px!important;max-width:105px!important}
          #invoiceDocPdfRender .inv-badge{font-size:22px!important}
          #invoiceDocPdfRender .inv-meta{margin-bottom:10px!important}
          #invoiceDocPdfRender .inv-bill-label{font-size:8px!important;margin-bottom:3px!important}
          #invoiceDocPdfRender .inv-bill-name{font-size:12px!important}
          #invoiceDocPdfRender .inv-details{font-size:10px!important}
          #invoiceDocPdfRender .inv-details div{margin-bottom:2px!important}
          #invoiceDocPdfRender .inv-items-table{margin-bottom:10px!important;font-size:9px!important}
          #invoiceDocPdfRender .inv-items-table th{padding:5px 6px!important;font-size:8px!important}
          #invoiceDocPdfRender .inv-items-table td{padding:5px 6px!important}
          #invoiceDocPdfRender .inv-totals{margin-bottom:9px!important}
          #invoiceDocPdfRender .inv-totals-box{min-width:175px!important}
          #invoiceDocPdfRender .inv-total-row{font-size:9px!important;margin-bottom:3px!important}
          #invoiceDocPdfRender .inv-grand{font-size:13px!important;padding-top:6px!important;margin-top:4px!important;min-height:0!important}
          #invoiceDocPdfRender .inv-footer{font-size:8px!important;padding-top:8px!important}
          #invoiceDocPdfRender *{break-inside:avoid!important;page-break-inside:avoid!important}
        `;
        document.head.appendChild(compactStyle);

        if (document.fonts?.ready) await document.fonts.ready;
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

        const canvas = await html2canvas(clone, {
          scale: 2,
          useCORS: true,
          backgroundColor: '#ffffff',
          logging: false,
          width: clone.scrollWidth,
          height: clone.scrollHeight,
          windowWidth: clone.scrollWidth,
          windowHeight: clone.scrollHeight,
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

        /* Normal invoices should fit on one A4 page. Only if the content is
           genuinely taller than A4 do we paginate it. */
        if (naturalH <= usableH) {
          doc.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', margin, margin, usableW, naturalH);
        } else {
          const sourcePageHeight = Math.floor((usableH * canvas.width) / usableW);
          let sourceY = 0;
          let page = 0;
          while (sourceY < canvas.height) {
            if (page > 0) doc.addPage();
            const sourceHeight = Math.min(sourcePageHeight, canvas.height - sourceY);
            const slice = document.createElement('canvas');
            slice.width = canvas.width;
            slice.height = sourceHeight;
            const ctx = slice.getContext('2d');
            if (!ctx) throw new Error('PDF canvas unavailable');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, slice.width, slice.height);
            ctx.drawImage(canvas, 0, sourceY, canvas.width, sourceHeight, 0, 0, slice.width, sourceHeight);
            const sliceH = (sourceHeight * usableW) / canvas.width;
            doc.addImage(slice.toDataURL('image/jpeg', 0.95), 'JPEG', margin, margin, usableW, Math.min(usableH, sliceH));
            sourceY += sourceHeight;
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
        compactStyle?.remove();
        clone?.remove();
        if (printModeAdded) document.body.classList.remove('print-mode');
      }
    };
  });
})();

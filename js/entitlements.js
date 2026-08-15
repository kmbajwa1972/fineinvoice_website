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

  /* Final A4 PDF renderer. Normal invoices are compacted and fitted onto one
     A4 portrait page. Only genuinely long invoices are paginated. */
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
      try {
        clone = source.cloneNode(true);
        clone.id = 'invoiceDocPdfRender';
        clone.style.cssText = [
          'position:absolute', 'left:-10000px', 'top:0', 'width:190mm',
          'min-height:0', 'height:auto', 'padding:10mm', 'margin:0',
          'box-sizing:border-box', 'background:#ffffff', 'overflow:visible',
          'font-size:11.5px', 'line-height:1.4', 'color:#1A1A2E'
        ].join(';');
        document.body.appendChild(clone);

        const compactStyle = document.createElement('style');
        compactStyle.id = 'fineinvoice-pdf-compact-style';
        compactStyle.textContent = `
          #invoiceDocPdfRender .inv-header{margin-bottom:16px!important;padding-bottom:12px!important}
          #invoiceDocPdfRender .inv-company-name{font-size:19px!important}
          #invoiceDocPdfRender .inv-logo{max-height:44px!important;max-width:120px!important}
          #invoiceDocPdfRender .inv-badge{font-size:23px!important}
          #invoiceDocPdfRender .inv-meta{margin-bottom:14px!important}
          #invoiceDocPdfRender .inv-items-table{margin-bottom:12px!important;font-size:10.5px!important}
          #invoiceDocPdfRender .inv-items-table th{padding:6px 7px!important;font-size:9px!important}
          #invoiceDocPdfRender .inv-items-table td{padding:6px 7px!important}
          #invoiceDocPdfRender .inv-totals{margin-bottom:12px!important}
          #invoiceDocPdfRender .inv-total-row{font-size:10.5px!important;margin-bottom:4px!important}
          #invoiceDocPdfRender .inv-grand{font-size:14px!important;padding-top:7px!important;margin-top:4px!important}
          #invoiceDocPdfRender .inv-footer{font-size:9.5px!important;padding-top:10px!important}
        `;
        document.head.appendChild(compactStyle);

        if (document.fonts?.ready) await document.fonts.ready;
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

        const canvas = await html2canvas(clone, {
          scale: 2,
          useCORS: true,
          backgroundColor: '#ffffff',
          logging: false,
          windowWidth: clone.scrollWidth,
          windowHeight: clone.scrollHeight
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
        const fitScale = Math.min(1, usableH / naturalH);
        const minReadableScale = 0.72;
        const invNum = document.getElementById('invNumber')?.value || 'invoice';
        const safeName = String(invNum).replace(/[^a-z0-9._-]/gi, '_');

        if (fitScale >= minReadableScale) {
          doc.addImage(canvas.toDataURL('image/jpeg', 0.94), 'JPEG', margin, margin, usableW, naturalH * fitScale);
        } else {
          const slicePx = Math.max(1, Math.floor(usableH * canvas.width / usableW));
          let sourceY = 0;
          let page = 0;
          while (sourceY < canvas.height) {
            if (page > 0) doc.addPage();
            const sourceHeight = Math.min(slicePx, canvas.height - sourceY);
            const slice = document.createElement('canvas');
            slice.width = canvas.width;
            slice.height = sourceHeight;
            const ctx = slice.getContext('2d');
            if (!ctx) throw new Error('PDF canvas unavailable');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, slice.width, slice.height);
            ctx.drawImage(canvas, 0, sourceY, canvas.width, sourceHeight, 0, 0, slice.width, sourceHeight);
            const sliceH = (sourceHeight * usableW) / canvas.width;
            doc.addImage(slice.toDataURL('image/jpeg', 0.94), 'JPEG', margin, margin, usableW, Math.min(usableH, sliceH));
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
        document.getElementById('fineinvoice-pdf-compact-style')?.remove();
        clone?.remove();
      }
    };
  });
})();

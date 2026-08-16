// FineInvoice PDF entitlement flow v4
(() => {
  'use strict';

  function aliases() {
    const s = new Set();
    const add = v => { if (v != null && String(v).trim()) s.add(String(v)); };
    if (typeof currentDraftId !== 'undefined') add(currentDraftId);
    add(new URLSearchParams(location.search).get('invoice'));
    if (typeof getInvoices === 'function') {
      try {
        const all = getInvoices() || [];
        const n = String(new URLSearchParams(location.search).get('invoice') || (typeof currentDraftId !== 'undefined' ? currentDraftId : ''));
        const m = all.find(i => [i?.id, i?.entitlementId, i?.invNumber, i?.invoice_number].some(v => v != null && String(v) === n));
        if (m) { add(m.id); add(m.entitlementId); add(m.invNumber); add(m.invoice_number); }
      } catch (e) { console.warn('[FineInvoice] invoice alias lookup failed:', e); }
    }
    add(document.getElementById('invNumber')?.value);
    return [...s];
  }

  function invNo() {
    const v = document.getElementById('invNumber')?.value || '';
    const m = String(v).match(/(?:INV[-_ ]?)(\d+)/i);
    return m ? Number(m[1]) : null;
  }

  function firstFour() {
    const n = invNo();
    return Number.isFinite(n) && n >= 1 && n <= 4;
  }

  function unlocked(u) {
    const ids = Array.isArray(u?.unlockedInvoiceIds) ? u.unlockedInvoiceIds.map(String) : [];
    return firstFour() || aliases().some(x => ids.includes(String(x)));
  }

  function invoiceId() {
    return String(document.getElementById('invNumber')?.value || aliases()[0] || (typeof currentDraftId !== 'undefined' ? currentDraftId : '') || 'draft');
  }

  async function loadUser() {
    let auth = null;
    try {
      auth = typeof getAuthenticatedUser === 'function' ? await getAuthenticatedUser() : null;
    } catch (e) {
      console.warn('[FineInvoice] auth read failed:', e);
    }
    let u = auth?.user || null;
    if (!u) {
      try {
        u = typeof getAuthUser === 'function' ? await getAuthUser() : (typeof getCurrentUser === 'function' ? getCurrentUser() : null);
      } catch (e) {
        console.warn('[FineInvoice] fallback auth read failed:', e);
      }
    }
    if (!u) return null;

    const meta = u.user_metadata || {};
    const prev = typeof getCurrentUser === 'function' ? (getCurrentUser() || {}) : {};
    const plan = String(meta.plan ?? u.plan ?? prev.plan ?? 'free').toLowerCase();

    u = {
      ...prev,
      id: u.id,
      email: u.email || prev.email || '',
      name: meta.name || prev.name || u.email || 'User',
      plan,
      planVerified: meta.planVerified === true,
      paymentProvider: meta.paymentProvider || prev.paymentProvider || null,
      freePdfCredits: Math.max(0, Number(meta.freePdfCredits ?? prev.freePdfCredits ?? 3) || 0),
      paidSingleCredits: Math.max(0, Number(meta.paidSingleCredits ?? prev.paidSingleCredits ?? 0) || 0),
      singleCredits: 0,
      unlockedInvoiceIds: Array.isArray(meta.unlockedInvoiceIds)
        ? [...new Set(meta.unlockedInvoiceIds.map(String))]
        : (prev.unlockedInvoiceIds || [])
    };
    u.singleCredits = u.freePdfCredits + u.paidSingleCredits;
    if (typeof saveCurrentUser === 'function') saveCurrentUser(u);
    return u;
  }

  async function consumePaidCredit(u, id) {
    if (unlocked(u) || String(u.plan || '').toLowerCase() === 'lifetime') {
      return { ok: true, alreadyUnlocked: true };
    }

    const paid = Math.max(0, Number(u.paidSingleCredits || 0));
    if (paid <= 0) return { ok: false, error: 'No PDF credits remaining.' };

    const ids = [...new Set([...(u.unlockedInvoiceIds || []).map(String), String(id)])];
    const next = paid - 1;
    const sb = typeof getSupabase === 'function' ? getSupabase() : null;

    if (!sb) return { ok: false, error: 'Authentication service is unavailable.' };

    const { error: ae } = await sb.auth.updateUser({
      data: {
        paidSingleCredits: next,
        unlockedInvoiceIds: ids,
        singleCredits: Number(u.freePdfCredits || 0) + next
      }
    });
    if (ae) return { ok: false, error: ae.message || 'Could not save PDF entitlement.' };

    if (u.id) {
      try {
        await sb.from('profiles').update({ single_credits: next }).eq('id', u.id);
      } catch (e) {
        console.warn('[FineInvoice] profile credit mirror failed:', e);
      }
    }

    u.paidSingleCredits = next;
    u.singleCredits = Number(u.freePdfCredits || 0) + next;
    u.unlockedInvoiceIds = ids;
    if (typeof saveCurrentUser === 'function') saveCurrentUser(u);
    return { ok: true, source: 'paid' };
  }

  function styles() {
    if (document.getElementById('fineinvoice-pdf-flow-fix')) return;
    const s = document.createElement('style');
    s.id = 'fineinvoice-pdf-flow-fix';
    s.textContent = `
      #invoiceDoc{height:auto!important;min-height:297mm;overflow:visible!important}
      #invoiceDoc .invoice-paper{min-height:297mm;height:auto!important;overflow:visible!important}
      @media screen{
        #invoiceDoc .invoice-paper{font-size:13px!important}
        #invoiceDoc .inv-company-name{font-size:22px!important}
        #invoiceDoc .inv-company-email{font-size:11px!important}
        #invoiceDoc .inv-bill-label{font-size:9px!important}
        #invoiceDoc .inv-bill-name{font-size:15px!important}
        #invoiceDoc .inv-small,#invoiceDoc .inv-details{font-size:11px!important;line-height:1.35!important}
        #invoiceDoc .inv-items-table{font-size:11px!important}
        #invoiceDoc .inv-items-table th{font-size:9px!important;padding:7px 6px!important}
        #invoiceDoc .inv-items-table td{font-size:11px!important;padding:6px!important}
        #invoiceDoc .inv-total-row{font-size:11px!important}
        #invoiceDoc .inv-grand{font-size:15px!important}
        #invoiceDoc .inv-notes{font-size:10px!important;padding:8px 10px!important}
        #invoiceDoc .inv-footer{font-size:9px!important}
      }
      #invoiceDoc .inv-items-table tr{break-inside:avoid;page-break-inside:avoid}
      @media print{
        @page{size:A4 portrait;margin:15mm 10mm}
        body.print-mode .page-body{padding:0!important;margin:0!important}
        body.print-mode #invoiceDoc{font-size:14px!important;line-height:1.45!important;width:100%!important;min-height:0!important}
        body.print-mode #invoiceDoc .invoice-paper{width:190mm!important;max-width:190mm!important;min-height:0!important;height:auto!important;margin:0 auto!important;padding:10mm 6mm!important;overflow:visible!important}
        body.print-mode #invoiceDoc .inv-company-name{font-size:24px!important}
        body.print-mode #invoiceDoc .inv-company-email{font-size:12px!important}
        body.print-mode #invoiceDoc .inv-bill-label{font-size:10px!important}
        body.print-mode #invoiceDoc .inv-bill-name{font-size:16px!important}
        body.print-mode #invoiceDoc .inv-small,body.print-mode #invoiceDoc .inv-details{font-size:12px!important;line-height:1.4!important}
        body.print-mode #invoiceDoc .inv-items-table{font-size:12px!important}
        body.print-mode #invoiceDoc .inv-items-table th{font-size:10px!important;padding:7px!important}
        body.print-mode #invoiceDoc .inv-items-table td{font-size:12px!important;padding:7px!important}
        body.print-mode #invoiceDoc .inv-total-row{font-size:12px!important}
        body.print-mode #invoiceDoc .inv-grand{font-size:17px!important;padding-top:8px!important}
        body.print-mode #invoiceDoc .inv-notes{font-size:11px!important;padding:9px 11px!important}
        body.print-mode #invoiceDoc .inv-footer{font-size:10px!important;padding-top:10px!important}
        body.print-mode #invoiceDoc .inv-logo{max-height:60px!important;max-width:150px!important}
        body.print-mode #invoiceDoc .inv-header{padding-bottom:14px!important;margin-bottom:14px!important}
        body.print-mode #invoiceDoc .inv-meta{margin-bottom:14px!important}
        body.print-mode #invoiceDoc .inv-totals{margin-bottom:14px!important}
        #fineinvoice-print-dashboard{display:none!important}
      }
      @media screen{
        #invoiceDoc.pdf-capture .invoice-paper{font-size:11px!important}
        #invoiceDoc.pdf-capture .inv-company-name{font-size:19px!important}
        #invoiceDoc.pdf-capture .inv-company-email{font-size:10px!important}
        #invoiceDoc.pdf-capture .inv-bill-label{font-size:8px!important}
        #invoiceDoc.pdf-capture .inv-bill-name{font-size:13px!important}
        #invoiceDoc.pdf-capture .inv-small,#invoiceDoc.pdf-capture .inv-details{font-size:9.5px!important;line-height:1.25!important}
        #invoiceDoc.pdf-capture .inv-items-table{font-size:9.5px!important}
        #invoiceDoc.pdf-capture .inv-items-table th{font-size:8px!important;padding:6px!important}
        #invoiceDoc.pdf-capture .inv-items-table td{font-size:9.5px!important;padding:5px 6px!important}
        #invoiceDoc.pdf-capture .inv-total-row{font-size:9.5px!important}
        #invoiceDoc.pdf-capture .inv-grand{font-size:13px!important}
        #invoiceDoc.pdf-capture .inv-notes{font-size:9px!important;padding:7px 9px!important}
        #invoiceDoc.pdf-capture .inv-footer{font-size:8.5px!important;padding-top:8px!important}
      }
      #fineinvoice-print-dashboard{display:none;position:fixed;top:12px;right:14px;z-index:9999;padding:9px 14px;border:0;border-radius:8px;background:#6C3FF5;color:#fff;font-weight:700;cursor:pointer;box-shadow:0 3px 12px rgba(0,0,0,.18)}
      body.print-mode #fineinvoice-print-dashboard{display:block}
    `;
    document.head.appendChild(s);
    if (!document.getElementById('fineinvoice-print-dashboard')) {
      const b = document.createElement('button');
      b.id = 'fineinvoice-print-dashboard';
      b.type = 'button';
      b.textContent = '← Dashboard';
      b.onclick = () => { document.body.classList.remove('print-mode'); location.href = 'dashboard.html'; };
      document.body.appendChild(b);
    }
  }

  async function makePdf() {
    if (!window.jspdf?.jsPDF || typeof html2canvas !== 'function') throw Error('PDF engine unavailable');
    const p = document.querySelector('#invoiceDoc .invoice-paper');
    if (!p) throw Error('Invoice is empty');
    const el = document.getElementById('invoiceDoc');
    el.classList.add('pdf-capture');
    try {
      const c = await html2canvas(p, {
        scale: 3,
        useCORS: true,
        backgroundColor: '#fff',
        scrollX: 0,
        scrollY: 0,
        logging: false,
        windowWidth: Math.max(document.documentElement.clientWidth, p.scrollWidth)
      });
      const { jsPDF } = window.jspdf;
      const W = 210, M = 6, CW = W - M * 2, CH = 297 - M * 2;
      const mm = CW / c.width, total = c.height * mm;
      const pages = Math.max(1, Math.ceil(total / CH));
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      for (let pg = 0; pg < pages; pg++) {
        if (pg) doc.addPage('a4', 'portrait');
        const sy = Math.floor(pg * CH / mm);
        const sh = Math.min(c.height - sy, Math.ceil(CH / mm));
        if (sh <= 0) continue;
        const slice = document.createElement('canvas');
        slice.width = c.width;
        slice.height = sh;
        const x = slice.getContext('2d');
        x.fillStyle = '#fff';
        x.fillRect(0, 0, slice.width, slice.height);
        x.drawImage(c, 0, sy, c.width, sh, 0, 0, c.width, sh);
        doc.addImage(slice.toDataURL('image/jpeg', .96), 'JPEG', M, M, CW, sh * mm);
      }
      return doc;
    } finally {
      el.classList.remove('pdf-capture');
    }
  }

  function install() {
    styles();

    window.downloadPDF = async function () {
      const u = await loadUser();
      if (!u) {
        showToast('Please sign in again to create a PDF.', 'error', 5000);
        return;
      }

      const id = invoiceId();
      const life = String(u.plan || 'free').toLowerCase() === 'lifetime';
      const open = unlocked(u);
      const n = invNo();
      const paid = Math.max(0, Number(u.paidSingleCredits || 0));

      // INV-001 through INV-004 are permanently included.
      // Any later invoice needs either lifetime access, an unlocked invoice, or one paid credit.
      if (!life && !open && n > 4 && paid <= 0) {
        showToast('No PDF credits remaining. Please purchase a PDF credit or Lifetime Access.', 'error', 5000);
        return;
      }

      showToast('Generating PDF…', 'info');
      try {
        const doc = await makePdf();

        // Consume only after PDF generation succeeds.
        if (!life && !open && n > 4) {
          const r = await consumePaidCredit(u, id);
          if (!r.ok) throw Error(r.error);
        }

        doc.save((document.getElementById('invNumber').value || 'invoice').replace(/[^a-z0-9._-]/gi, '_') + '.pdf');
        localStorage.setItem('fi_downloads', String(parseInt(localStorage.getItem('fi_downloads') || '0', 10) + 1));
        showToast('PDF downloaded! 🎉', 'success');
      } catch (e) {
        console.error('[FineInvoice] PDF generation failed:', e);
        showToast('PDF generation failed. Your PDF credit was not used.', 'error', 5000);
      }
    };

    window.printInvoice = async function () {
      const u = await loadUser();
      if (!u) {
        showToast('Please sign in again to print.', 'error', 5000);
        return;
      }

      const id = invoiceId();
      const life = String(u.plan || 'free').toLowerCase() === 'lifetime';
      const open = unlocked(u);
      const n = invNo();
      const paid = Math.max(0, Number(u.paidSingleCredits || 0));

      if (!life && !open && n > 4 && paid <= 0) {
        showToast('No PDF credits remaining. Please purchase a PDF credit or Lifetime Access.', 'error', 5000);
        return;
      }

      if (!life && !open && n > 4) {
        const r = await consumePaidCredit(u, id);
        if (!r.ok) {
          showToast(r.error, 'error', 5000);
          return;
        }
      }

      document.body.classList.add('print-mode');
      window.print();
      setTimeout(() => document.body.classList.remove('print-mode'), 800);
    };

    console.log('[FineInvoice] PDF entitlement flow v4 active');
  }

  window.addEventListener('load', () => setTimeout(install, 0), { once: true });
})();

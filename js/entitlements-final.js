// FineInvoice — single PDF/Print entitlement engine
(() => {
  'use strict';
  if (window.__fineInvoiceEntitlementEngineLoaded) return;
  window.__fineInvoiceEntitlementEngineLoaded = true;

  const CREDIT_KEY = 'freePdfCredits';
  const PAID_KEY = 'paidSingleCredits';

  function sb() { return typeof getSupabase === 'function' ? getSupabase() : null; }
  function currentLocalUser() { return typeof getCurrentUser === 'function' ? (getCurrentUser() || {}) : {}; }

  async function user() {
    const client = sb();
    if (!client) {
      console.error('[FineInvoice] Supabase client is unavailable for PDF authorization.');
      return null;
    }
    let authUser = null;
    try {
      // Prefer the active session first. getUser() performs a network verification and can
      // return no user during a transient auth/network error even when a valid session exists.
      const sessionResult = await client.auth.getSession();
      authUser = sessionResult.data?.session?.user || null;
      if (!authUser) {
        const userResult = await client.auth.getUser();
        authUser = userResult.data?.user || null;
        if (userResult.error) console.warn('[FineInvoice] Supabase getUser verification failed:', userResult.error.message);
      }
    } catch (error) {
      console.warn('[FineInvoice] Could not read Supabase auth session:', error);
      return null;
    }
    if (!authUser) {
      console.warn('[FineInvoice] PDF authorization blocked: no active Supabase session.');
      return null;
    }
    const meta = authUser.user_metadata || {};
    const local = currentLocalUser();
    const free = Math.max(0, Number(meta[CREDIT_KEY] ?? local[CREDIT_KEY] ?? 3) || 0);
    const paid = Math.max(0, Number(meta[PAID_KEY] ?? local[PAID_KEY] ?? 0) || 0);
    const unlocked = Array.isArray(meta.unlockedInvoiceIds)
      ? [...new Set(meta.unlockedInvoiceIds.map(String))]
      : [...new Set((local.unlockedInvoiceIds || []).map(String))];
    const u = {
      ...local,
      id: authUser.id,
      email: authUser.email || local.email || '',
      name: meta.name || local.name || authUser.email || 'User',
      plan: String(meta.plan ?? local.plan ?? 'free').toLowerCase(),
      planVerified: meta.planVerified === true,
      paymentProvider: meta.paymentProvider || local.paymentProvider || null,
      freePdfCredits: free,
      paidSingleCredits: paid,
      singleCredits: free + paid,
      unlockedInvoiceIds: unlocked
    };
    if (typeof saveCurrentUser === 'function') saveCurrentUser(u);
    return u;
  }

  // Never use the editable Invoice # field as entitlement identity.
  function invoiceId() {
    const draft = typeof currentDraftId !== 'undefined' ? currentDraftId : null;
    const query = new URLSearchParams(location.search).get('invoice');
    const id = draft || query;
    return id ? String(id) : '';
  }

  function unlocked(u, id) {
    if (!u || !id) return false;
    if (u.plan === 'lifetime') return true;
    return (u.unlockedInvoiceIds || []).map(String).includes(String(id));
  }

  async function saveEntitlement(u, id, source) {
    const client = sb();
    if (!client || !u?.id || !id) return { ok: false, error: 'Authentication service is unavailable.' };
    const ids = [...new Set([...(u.unlockedInvoiceIds || []).map(String), String(id)])];
    const free = Math.max(0, Number(u.freePdfCredits || 0));
    const paid = Math.max(0, Number(u.paidSingleCredits || 0));
    const data = {
      freePdfCredits: free,
      paidSingleCredits: paid,
      singleCredits: free + paid,
      unlockedInvoiceIds: ids
    };
    const { error } = await client.auth.updateUser({ data });
    if (error) return { ok: false, error: error.message || 'Could not save PDF entitlement.' };
    try {
      await client.from('profiles').update({ single_credits: paid }).eq('id', u.id);
    } catch (e) {
      console.warn('[FineInvoice] profile credit mirror failed:', e);
    }
    u.unlockedInvoiceIds = ids;
    if (typeof saveCurrentUser === 'function') saveCurrentUser(u);
    return { ok: true, source };
  }

  async function consumeCredit(u, id) {
    if (unlocked(u, id)) return { ok: true, alreadyUnlocked: true };
    if (!id) return { ok: false, error: 'Please save the invoice before printing or downloading the PDF.' };
    if (u.plan === 'lifetime') return saveEntitlement(u, id, 'lifetime');

    let source = null;
    if (Number(u.freePdfCredits || 0) > 0) {
      u.freePdfCredits = Number(u.freePdfCredits) - 1;
      source = 'free';
    } else if (Number(u.paidSingleCredits || 0) > 0) {
      u.paidSingleCredits = Number(u.paidSingleCredits) - 1;
      source = 'paid';
    } else {
      return { ok: false, error: 'No PDF credits remaining. Please purchase a PDF credit or Lifetime Access.' };
    }
    u.singleCredits = u.freePdfCredits + u.paidSingleCredits;
    const result = await saveEntitlement(u, id, source);
    if (!result.ok) {
      if (source === 'free') u.freePdfCredits += 1;
      else u.paidSingleCredits += 1;
      u.singleCredits = u.freePdfCredits + u.paidSingleCredits;
    }
    return result;
  }

  function toast(message, type = 'info', duration = 5000) {
    if (typeof showToast === 'function') showToast(message, type, duration);
    else alert(message);
  }

  function styles() {
    if (document.getElementById('fineinvoice-final-entitlement-style')) return;
    const s = document.createElement('style');
    s.id = 'fineinvoice-final-entitlement-style';
    s.textContent = `
      #fineinvoice-print-dashboard{display:none;position:fixed;top:12px;right:14px;z-index:9999;padding:9px 14px;border:0;border-radius:8px;background:#6C3FF5;color:#fff;font-weight:700;cursor:pointer;box-shadow:0 3px 12px rgba(0,0,0,.18)}
      body.print-mode #fineinvoice-print-dashboard{display:block}
      @media screen{#invoiceDoc .invoice-paper{font-size:13px!important}#invoiceDoc .inv-company-name{font-size:22px!important}#invoiceDoc .inv-small,#invoiceDoc .inv-details{font-size:11px!important;line-height:1.35!important}#invoiceDoc .inv-items-table{font-size:11px!important}#invoiceDoc .inv-items-table td{font-size:11px!important;padding:6px!important}#invoiceDoc .inv-grand{font-size:15px!important}}
      @media print{@page{size:A4 portrait;margin:15mm 10mm}body.print-mode .page-body{padding:0!important;margin:0!important}body.print-mode #invoiceDoc .invoice-paper{width:190mm!important;max-width:190mm!important;height:auto!important;margin:0 auto!important;padding:10mm 6mm!important;overflow:visible!important}body.print-mode #invoiceDoc{font-size:14px!important;line-height:1.45!important}body.print-mode #invoiceDoc .inv-company-name{font-size:24px!important}body.print-mode #invoiceDoc .inv-small,body.print-mode #invoiceDoc .inv-details{font-size:12px!important}body.print-mode #invoiceDoc .inv-items-table{font-size:12px!important}body.print-mode #invoiceDoc .inv-items-table td{font-size:12px!important;padding:7px!important}body.print-mode #invoiceDoc .inv-grand{font-size:17px!important}#fineinvoice-print-dashboard{display:none!important}}
    `;
    document.head.appendChild(s);
    const b = document.createElement('button');
    b.id = 'fineinvoice-print-dashboard';
    b.type = 'button';
    b.textContent = '← Dashboard';
    b.onclick = () => { document.body.classList.remove('print-mode'); location.href = 'dashboard.html'; };
    document.body.appendChild(b);
  }

  // Safety net: crop blank white rows from the bottom of the capture (keeps ~8px of padding).
  function trimBottomWhite(c) {
    try {
      const ctx = c.getContext('2d'), w = c.width, h = c.height;
      let y = h - 1;
      for (; y >= 0; y--) {
        const d = ctx.getImageData(0, y, w, 1).data;
        let ink = false;
        for (let i = 0; i < d.length; i += 4) { if (d[i] < 245 || d[i + 1] < 245 || d[i + 2] < 245) { ink = true; break; } }
        if (ink) break;
      }
      const nh = Math.min(h, Math.max(1, y + 1 + 24));
      if (y < 0 || h - nh < 12) return c;
      const out = document.createElement('canvas');
      out.width = w; out.height = nh;
      const octx = out.getContext('2d');
      octx.fillStyle = '#fff'; octx.fillRect(0, 0, w, nh);
      octx.drawImage(c, 0, 0, w, nh, 0, 0, w, nh);
      return out;
    } catch (e) { return c; }
  }

  async function makePdf() {
    if (!window.jspdf?.jsPDF || typeof html2canvas !== 'function') throw Error('PDF engine unavailable');
    const paper = document.querySelector('#invoiceDoc .invoice-paper');
    if (!paper) throw Error('Invoice is empty');
    const el = document.getElementById('invoiceDoc');
    // css/theme.css forces .invoice-paper{min-height:1040px!important} for the on-screen preview. In the narrow
    // preview column that is ~1.5 A4 pages tall, so the capture contained a big blank area (-> blank 2nd page).
    // Capture at natural content height instead, then restore the preview.
    const prevMin = paper.style.getPropertyValue('min-height'), prevPri = paper.style.getPropertyPriority('min-height');
    paper.style.setProperty('min-height', '0', 'important');
    let canvas;
    try {
      canvas = await html2canvas(paper, { scale: 3, useCORS: true, backgroundColor: '#fff', scrollX: 0, scrollY: 0, logging: false });
    } finally {
      if (prevMin) paper.style.setProperty('min-height', prevMin, prevPri); else paper.style.removeProperty('min-height');
    }
    canvas = trimBottomWhite(canvas);
    const { jsPDF } = window.jspdf;
    const W = 210, M = 6, CW = W - M * 2, CH = 297 - M * 2;
    const mm = CW / canvas.width;
    const totalH = canvas.height * mm;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    // Normal invoices: fit on ONE page (the on-screen layout is slightly taller than the print layout,
    // which used to push a thin strip onto a blank 2nd page).
    if (totalH <= CH * 1.25) {
      let w = CW, h = totalH;
      if (h > CH) { const k = CH / h; w *= k; h *= k; }
      doc.addImage(canvas.toDataURL('image/jpeg', .96), 'JPEG', M + (CW - w) / 2, M, w, h);
      return doc;
    }
    // Long invoices: paginate, but never emit a near-empty last page.
    const pagePx = Math.ceil(CH / mm);
    let pages = Math.max(1, Math.ceil(canvas.height / pagePx));
    if (pages > 1 && canvas.height - (pages - 1) * pagePx < pagePx * 0.04) pages--;
    for (let p = 0; p < pages; p++) {
      if (p) doc.addPage('a4', 'portrait');
      const sy = p * pagePx;
      const sh = Math.min(pagePx, canvas.height - sy);
      const slice = document.createElement('canvas');
      slice.width = canvas.width; slice.height = sh;
      const ctx = slice.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, slice.width, slice.height);
      ctx.drawImage(canvas, 0, sy, canvas.width, sh, 0, 0, canvas.width, sh);
      doc.addImage(slice.toDataURL('image/jpeg', .96), 'JPEG', M, M, CW, sh * mm);
    }
    return doc;
  }

  async function gate() {
    const u = await user();
    if (!u) { toast('Please sign in again to create a PDF.', 'error'); return null; }
    const id = invoiceId();
    if (!id) { toast('Please save the invoice first.', 'error'); return null; }
    if (unlocked(u, id)) return { u, id, already: true };
    if (u.plan !== 'lifetime' && Number(u.freePdfCredits || 0) + Number(u.paidSingleCredits || 0) <= 0) {
      if (confirm('No PDF credits remain.\n\nSingle: $2 per invoice\nor Lifetime: $25 unlimited.\n\nGo to Billing?')) location.href = 'payment.html';
      return null;
    }
    return { u, id, already: false };
  }

  async function downloadPDF() {
    // Open a tab immediately during the user's click so popup blockers are less likely to block the PDF preview.
    const previewWindow = window.open('about:blank', '_blank');
    if (previewWindow) previewWindow.opener = null;
    let previewUrl = null;
    const g = await gate();
    if (!g) { if (previewWindow) previewWindow.close(); return; }
    toast('Generating PDF…', 'info');
    try {
      const doc = await makePdf();
      if (!g.already) { const r = await consumeCredit(g.u, g.id); if (!r.ok) throw Error(r.error); }
      const name = (document.getElementById('invNumber')?.value || 'invoice').replace(/[^a-z0-9._-]/gi, '_');
      // Keep the normal download, and also show the same PDF in a new tab.
      if (previewWindow) {
        previewUrl = URL.createObjectURL(doc.output('blob'));
        previewWindow.location.href = previewUrl;
        setTimeout(() => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, 60000);
      }
      doc.save(`${name}.pdf`);
      toast(previewWindow ? 'PDF opened and downloaded! 🎉' : 'PDF downloaded! 🎉', 'success');
    } catch (e) {
      if (previewWindow) previewWindow.close();
      console.error('[FineInvoice] PDF generation failed:', e);
      toast(e.message || 'PDF generation failed. Your credit was not used.', 'error', 5000);
    }
  }

  async function printInvoice() {
    const g = await gate(); if (!g) return;
    if (!g.already) { const r = await consumeCredit(g.u, g.id); if (!r.ok) { toast(r.error, 'error'); return; } }
    document.body.classList.add('print-mode');
    window.print();
    setTimeout(() => document.body.classList.remove('print-mode'), 800);
  }

  function install() {
    styles();
    window.downloadPDF = downloadPDF;
    window.printInvoice = printInvoice;
    console.log('[FineInvoice] single entitlement engine active');
  }

  window.addEventListener('load', install, { once: true });
})();
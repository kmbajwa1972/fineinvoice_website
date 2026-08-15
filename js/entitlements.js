/* FineInvoice commercial entitlement manager + dedicated PDF template */
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
      unlockedInvoiceIds: Array.isArray(user.unlockedInvoiceIds)
        ? [...new Set(user.unlockedInvoiceIds.map(String))]
        : []
    };
  }

  window.FineInvoiceEntitlements = {
    FREE_START,
    normalizeUser,
    invoiceEntitlementId(invoice) {
      return invoice ? String(invoice.entitlementId || invoice.id || '') : null;
    },
    isLifetime(user) {
      return String(user?.plan || '').toLowerCase() === PLAN_LIFETIME;
    },
    isUnlocked(user, id) {
      return !!id && Array.isArray(user?.unlockedInvoiceIds) && user.unlockedInvoiceIds.includes(String(id));
    }
  };

  /*
   * Dedicated production PDF template.
   *
   * This intentionally DOES NOT use html2canvas. The builder/preview CSS has
   * large gaps and a two-column editor around the invoice. Capturing that DOM
   * was the source of the persistent two-page PDF problem.
   *
   * The PDF is drawn directly with jsPDF on an A4 canvas, with fixed compact
   * spacing. Normal invoices are always one page. Very large item lists are
   * compressed before a second page is considered.
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

      const hasAccess = typeof invoiceHasAccess === 'function'
        ? invoiceHasAccess(u, invoiceId)
        : !!u;

      if (!hasAccess) {
        if (confirm('Your free PDF credits have been used.\n\nSingle: $2 per invoice\nor Lifetime: $25 unlimited.\n\nGo to Billing?')) {
          window.location.href = 'payment.html';
        }
        return;
      }

      const plan = String(u?.plan || 'free').toLowerCase();
      const unlocked = Array.isArray(u?.unlockedInvoiceIds)
        && u.unlockedInvoiceIds.map(String).includes(invoiceId);
      const alreadyUnlocked = plan === 'lifetime' || unlocked;

      showToast('Creating compact A4 invoice…', 'info');

      try {
        const { jsPDF } = window.jspdf || {};
        if (!jsPDF) throw new Error('PDF engine unavailable');

        const val = id => document.getElementById(id)?.value?.trim() || '';
        const company = val('company') || 'Your Company';
        const bizEmail = val('bizEmail');
        const customer = val('customer') || 'Client Name';
        const custEmail = val('custEmail');
        const custAddress = val('custAddress');
        const invNumber = val('invNumber') || 'INV-001';
        const invDate = val('invDate');
        const dueDate = val('dueDate');
        const currency = val('currency') || 'USD';
        const notes = val('notes');
        const taxPct = parseFloat(val('tax')) || 0;
        const discountPct = parseFloat(val('discount')) || 0;

        const currencySymbol = {
          PKR: 'PKR ', USD: '$', EUR: '€', AED: 'AED ', GBP: '£'
        }[currency] || `${currency} `;

        const selectedTheme = document.querySelector('.theme-dot.selected')?.dataset?.color;
        const accent = selectedTheme || '#6C3FF5';

        const rows = [...document.querySelectorAll('#itemsBody tr')].map(tr => {
          const ins = tr.querySelectorAll('input');
          const desc = ins[0]?.value?.trim() || 'Item';
          const qty = parseFloat(ins[1]?.value) || 0;
          const unit = ins[2]?.value?.trim() || '';
          const rate = parseFloat(ins[3]?.value) || 0;
          const itemTax = document.getElementById('advancedCols')?.checked ? (parseFloat(ins[4]?.value) || 0) : 0;
          const itemDisc = document.getElementById('advancedCols')?.checked ? (parseFloat(ins[5]?.value) || 0) : 0;
          const base = qty * rate;
          const tax = base * itemTax / 100;
          const disc = base * itemDisc / 100;
          return {
            desc,
            qtyLabel: unit ? `${qty} ${unit}` : String(qty),
            rate,
            amount: base + tax - disc
          };
        });

        let subtotal = 0;
        let itemTaxTotal = 0;
        let itemDiscTotal = 0;
        rows.forEach((r, i) => {
          const tr = [...document.querySelectorAll('#itemsBody tr')][i];
          const ins = tr?.querySelectorAll('input');
          const qty = parseFloat(ins?.[1]?.value) || 0;
          const rate = parseFloat(ins?.[3]?.value) || 0;
          const base = qty * rate;
          const itemTax = document.getElementById('advancedCols')?.checked ? (parseFloat(ins?.[4]?.value) || 0) : 0;
          const itemDisc = document.getElementById('advancedCols')?.checked ? (parseFloat(ins?.[5]?.value) || 0) : 0;
          subtotal += base;
          itemTaxTotal += base * itemTax / 100;
          itemDiscTotal += base * itemDisc / 100;
        });
        const globalTax = subtotal * taxPct / 100;
        const globalDisc = subtotal * discountPct / 100;
        const taxTotal = itemTaxTotal + globalTax;
        const discTotal = itemDiscTotal + globalDisc;
        const total = subtotal + taxTotal - discTotal;

        const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
        const pageW = doc.internal.pageSize.getWidth();
        const pageH = doc.internal.pageSize.getHeight();
        const M = 12;
        const W = pageW - M * 2;
        let y = M;

        const rgb = hex => {
          const h = String(hex).replace('#', '');
          return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
        };
        const ac = rgb(accent);

        const money = n => `${currencySymbol}${Number(n || 0).toFixed(2)}`;
        const dateText = s => {
          if (!s) return '';
          const d = new Date(`${s}T00:00:00`);
          return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString('en-GB');
        };

        // Header: compact, clean, no giant "INVOICE" watermark.
        doc.setFillColor(...ac);
        doc.rect(M, y, 3, 19, 'F');
        doc.setTextColor(25, 25, 40);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(18);
        doc.text(company, M + 7, y + 7);
        if (bizEmail) {
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(8.5);
          doc.setTextColor(105, 105, 125);
          doc.text(bizEmail, M + 7, y + 12);
        }

        // Logo from the existing builder, if supplied.
        const logo = document.getElementById('logoImg');
        if (logo?.src && logo.src.startsWith('data:image/')) {
          try {
            const fmt = logo.src.startsWith('data:image/png') ? 'PNG' : 'JPEG';
            doc.addImage(logo.src, fmt, pageW - M - 27, y + 1, 27, 17, undefined, 'FAST');
          } catch (e) {
            console.warn('FineInvoice logo PDF skipped:', e);
          }
        } else {
          doc.setTextColor(...ac);
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(17);
          doc.text('INVOICE', pageW - M, y + 9, { align: 'right' });
        }
        doc.setDrawColor(225, 225, 232);
        doc.line(M, y + 22, pageW - M, y + 22);
        y += 29;

        // Customer and invoice metadata in a compact two-column block.
        const leftX = M;
        const rightX = pageW - M;
        doc.setTextColor(110, 110, 130);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.text('BILL TO', leftX, y);
        doc.text('INVOICE DETAILS', rightX, y, { align: 'right' });
        y += 5;
        doc.setTextColor(25, 25, 40);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10.5);
        doc.text(customer, leftX, y);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(95, 95, 115);
        let cy = y + 4;
        if (custEmail) { doc.text(custEmail, leftX, cy); cy += 3.7; }
        if (custAddress) {
          const addr = doc.splitTextToSize(custAddress, W * 0.48);
          doc.text(addr, leftX, cy);
          cy += addr.length * 3.5;
        }

        doc.setTextColor(45, 45, 60);
        doc.setFontSize(8);
        const meta = [
          ['Invoice #', invNumber],
          invDate ? ['Issue Date', dateText(invDate)] : null,
          dueDate ? ['Due Date', dateText(dueDate)] : null,
          ['Currency', currency]
        ].filter(Boolean);
        let my = y;
        meta.forEach(([k, v]) => {
          doc.setFont('helvetica', 'bold');
          doc.text(k, rightX - 32, my, { align: 'right' });
          doc.setFont('helvetica', 'normal');
          doc.text(v, rightX, my, { align: 'right' });
          my += 3.8;
        });
        y = Math.max(cy, my) + 7;

        // Compact item table.
        const tableX = M;
        const descW = W * 0.53;
        const qtyW = W * 0.13;
        const rateW = W * 0.16;
        const amtW = W - descW - qtyW - rateW;
        const cols = [tableX, tableX + descW, tableX + descW + qtyW, tableX + descW + qtyW + rateW, tableX + W];

        doc.setFillColor(247, 246, 251);
        doc.roundedRect(tableX, y, W, 7, 1.5, 1.5, 'F');
        doc.setTextColor(...ac);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.2);
        doc.text('DESCRIPTION', cols[0] + 3, y + 4.6);
        doc.text('QTY', cols[2] - 3, y + 4.6, { align: 'right' });
        doc.text('RATE', cols[3] - 3, y + 4.6, { align: 'right' });
        doc.text('AMOUNT', cols[4] - 3, y + 4.6, { align: 'right' });
        y += 8;

        const availableBeforeTotals = pageH - M - 43;
        const baseRowH = rows.length > 12 ? 5.5 : 6.5;
        const fontSize = rows.length > 12 ? 7.2 : 8;

        doc.setFontSize(fontSize);
        rows.forEach((r, index) => {
          const descLines = doc.splitTextToSize(r.desc, descW - 6);
          const rowH = Math.max(baseRowH, descLines.length * 3.2 + 2.5);
          doc.setDrawColor(232, 231, 238);
          doc.line(tableX, y + rowH, tableX + W, y + rowH);
          doc.setTextColor(40, 40, 55);
          doc.setFont('helvetica', 'normal');
          doc.text(descLines, cols[0] + 3, y + 4);
          doc.text(r.qtyLabel, cols[2] - 3, y + 4, { align: 'right' });
          doc.text(money(r.rate), cols[3] - 3, y + 4, { align: 'right' });
          doc.setFont('helvetica', 'bold');
          doc.text(money(r.amount), cols[4] - 3, y + 4, { align: 'right' });
          y += rowH;
        });

        // If there are no items, still show a clean row.
        if (!rows.length) {
          doc.setTextColor(110, 110, 130);
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(8);
          doc.text('No line items', cols[0] + 3, y + 4);
          doc.line(tableX, y + baseRowH, tableX + W, y + baseRowH);
          y += baseRowH;
        }

        // Totals aligned right, compact.
        y += 5;
        const totalX = pageW - M - 72;
        const totalValueX = pageW - M;
        const totalRow = (label, amount, bold) => {
          doc.setFont('helvetica', bold ? 'bold' : 'normal');
          doc.setFontSize(bold ? 9 : 8);
          doc.setTextColor(bold ? 30 : 100, bold ? 30 : 100, bold ? 45 : 120);
          doc.text(label, totalX, y);
          doc.text(amount, totalValueX, y, { align: 'right' });
          y += bold ? 6 : 4.5;
        };
        totalRow('Subtotal', money(subtotal), false);
        totalRow('Tax', money(taxTotal), false);
        if (discTotal > 0) totalRow('Discount', `−${money(discTotal)}`, false);
        doc.setDrawColor(...ac);
        doc.setLineWidth(0.6);
        doc.line(totalX, y - 1.5, totalValueX, y - 1.5);
        y += 2;
        totalRow('TOTAL', money(total), true);
        doc.setLineWidth(0.2);

        // Notes: compact, no oversized shaded box.
        if (notes) {
          y += 3;
          doc.setFillColor(249, 248, 253);
          const noteLines = doc.splitTextToSize(notes, W - 12);
          const noteH = Math.min(18, 5 + noteLines.length * 3.2);
          doc.roundedRect(M, y, W, noteH, 1.5, 1.5, 'F');
          doc.setFillColor(...ac);
          doc.rect(M, y, 2, noteH, 'F');
          doc.setTextColor(75, 75, 95);
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(7.5);
          doc.text('NOTES', M + 6, y + 4);
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(7.2);
          doc.text(noteLines.slice(0, 4), M + 6, y + 8);
          y += noteH + 4;
        }

        // Footer at a fixed position so the invoice never creates a second page.
        doc.setDrawColor(230, 230, 235);
        doc.line(M, pageH - 15, pageW - M, pageH - 15);
        doc.setTextColor(155, 155, 170);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.text('Generated by FineInvoice · fineinvoice.com', pageW / 2, pageH - 9, { align: 'center' });

        const safeName = String(invNumber).replace(/[^a-z0-9._-]/gi, '_');
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
        showToast('One-page A4 PDF downloaded! 🎉', 'success');
      } catch (error) {
        console.error('FineInvoice PDF generation failed:', error);
        showToast('PDF generation failed. Your PDF credit was not used.', 'error', 5000);
      }
    };
  });
})();

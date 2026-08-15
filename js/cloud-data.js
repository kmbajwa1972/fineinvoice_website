// FineInvoice cloud persistence repair.
// Primary invoice storage is Supabase; localStorage remains only a cache/fallback.
(function () {
  function sb() { return typeof getSupabase === 'function' ? getSupabase() : null; }
  async function sessionUser() {
    const client = sb();
    if (!client) return null;
    const { data, error } = await client.auth.getSession();
    if (error || !data?.session?.user) return null;
    return data.session.user;
  }
  function payloadOf(row) {
    return row && row.payload && typeof row.payload === 'object' ? row.payload : (row || {});
  }
  function legacyIdOf(row) {
    const p = payloadOf(row);
    return p.legacy_id != null ? String(p.legacy_id) : String(row?.id || '');
  }
  function toRow(invoice, userId, existingId) {
    return {
      ...(existingId ? { id: existingId } : {}),
      user_id: userId,
      inv_number: invoice.invNumber || invoice.invoice_number || null,
      company: invoice.company || null,
      customer: invoice.customer || null,
      cust_email: invoice.custEmail || null,
      currency: invoice.currency || null,
      total: Number(invoice.total || 0),
      items: Array.isArray(invoice.items) ? invoice.items : [],
      tax: Number(invoice.tax || 0),
      discount: Number(invoice.discount || 0),
      notes: invoice.notes || null,
      theme_color: invoice.themeColor || null,
      due_date: invoice.dueDate || null,
      inv_date: invoice.invDate || null,
      status: invoice.status || 'saved',
      payload: { ...invoice, legacy_id: invoice.id != null ? String(invoice.id) : null }
    };
  }
  async function findCloudInvoice(id) {
    const client = sb(), user = await sessionUser();
    if (!client || !user) return { data: null, error: { message: 'Not authenticated' } };
    let q = await client.from('invoices').select('*').eq('user_id', user.id).eq('id', id).maybeSingle();
    if (q.data || q.error) return q;
    return client.from('invoices').select('*').eq('user_id', user.id).filter('payload->>legacy_id', 'eq', String(id)).maybeSingle();
  }
  async function saveCloudInvoice(invoice) {
    const client = sb(), user = await sessionUser();
    if (!client || !user) return { data: null, error: { message: 'Not authenticated' } };
    const legacy = invoice.id != null ? String(invoice.id) : '';
    let existing = null;
    if (legacy) {
      const r = await client.from('invoices').select('id').eq('user_id', user.id).filter('payload->>legacy_id', 'eq', legacy).maybeSingle();
      if (r.error) return { data: null, error: r.error };
      existing = r.data?.id || null;
    }
    if (existing) return client.from('invoices').update(toRow(invoice, user.id, existing)).eq('id', existing).select().single();
    return client.from('invoices').insert(toRow(invoice, user.id)).select().single();
  }
  async function loadCloudInvoices() {
    const client = sb(), user = await sessionUser();
    if (!client || !user) return { data: [], error: { message: 'Not authenticated' } };
    return client.from('invoices').select('*').eq('user_id', user.id).order('created_at', { ascending: false });
  }
  async function deleteCloudInvoice(id) {
    const client = sb(), user = await sessionUser();
    if (!client || !user) return { error: { message: 'Not authenticated' } };
    return client.from('invoices').delete().eq('id', id).eq('user_id', user.id);
  }
  window.fineInvoiceCloud = { loadCloudInvoices, saveCloudInvoice, findCloudInvoice, deleteCloudInvoice };

  function cacheInvoice(invoice) {
    if (typeof getInvoices !== 'function' || typeof saveInvoices !== 'function') return;
    const all = getInvoices();
    const id = String(invoice.id);
    const idx = all.findIndex(x => String(x.id) === id);
    if (idx >= 0) all[idx] = invoice; else all.push(invoice);
    saveInvoices(all);
  }

  function collectInvoiceFromBuilder() {
    const rows = [...document.querySelectorAll('#itemsBody tr')].map(tr => {
      const i = tr.querySelectorAll('input');
      return { desc: i[0]?.value || '', qty: i[1]?.value || 1, unit: i[2]?.value || '', rate: i[3]?.value || 0, itemTax: i[4]?.value || 0, itemDisc: i[5]?.value || 0 };
    });
    let subtotal = 0, itemTax = 0, itemDisc = 0;
    rows.forEach(r => {
      const base = (Number(r.qty) || 0) * (Number(r.rate) || 0);
      subtotal += base;
      itemTax += base * (Number(r.itemTax) || 0) / 100;
      itemDisc += base * (Number(r.itemDisc) || 0) / 100;
    });
    const globalTax = subtotal * (Number(document.getElementById('tax')?.value) || 0) / 100;
    const globalDisc = subtotal * (Number(document.getElementById('discount')?.value) || 0) / 100;
    const id = new URLSearchParams(location.search).get('invoice') || ('DRAFT-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8));
    return {
      id,
      company: document.getElementById('company')?.value || '',
      customer: document.getElementById('customer')?.value || '',
      bizEmail: document.getElementById('bizEmail')?.value || '',
      custEmail: document.getElementById('custEmail')?.value || '',
      custAddress: document.getElementById('custAddress')?.value || '',
      currency: document.getElementById('currency')?.value || 'USD',
      total: subtotal + itemTax + globalTax - itemDisc - globalDisc,
      invNumber: document.getElementById('invNumber')?.value || '',
      invDate: document.getElementById('invDate')?.value || '',
      dueDate: document.getElementById('dueDate')?.value || '',
      notes: document.getElementById('notes')?.value || '',
      themeColor: document.querySelector('.theme-dot.selected')?.dataset.color || '#6C3FF5',
      logoData: document.getElementById('logoImg')?.src || '',
      items: rows,
      date: new Date().toISOString(),
      status: 'saved'
    };
  }

  async function repairBuilder() {
    if (!document.getElementById('invoiceDoc') || typeof window.saveInvoice !== 'function') return;
    const originalSave = window.saveInvoice;
    window.saveInvoice = async function () {
      const invoice = collectInvoiceFromBuilder();
      if (!invoice.company || !invoice.customer) { showToast('Please enter company and customer name', 'error'); return; }
      const result = await saveCloudInvoice(invoice);
      if (result.error) { console.error('Cloud invoice save failed:', result.error); showToast('Invoice could not be saved to your account.', 'error', 5000); return; }
      const cloudId = result.data?.id;
      if (cloudId) invoice.cloudId = cloudId;
      cacheInvoice(invoice);
      showToast('Invoice saved securely to your account ✅', 'success');
    };

    // If an invoice was opened from the invoice list, hydrate it from Supabase.
    const invoiceParam = new URLSearchParams(location.search).get('invoice');
    if (invoiceParam && typeof window.loadInvoiceById === 'function') {
      try {
        const result = await findCloudInvoice(invoiceParam);
        if (!result.error && result.data) {
          const row = result.data, p = payloadOf(row);
          if (document.getElementById('company')) document.getElementById('company').value = p.company ?? row.company ?? '';
          if (document.getElementById('customer')) document.getElementById('customer').value = p.customer ?? row.customer ?? '';
          if (document.getElementById('bizEmail')) document.getElementById('bizEmail').value = p.bizEmail ?? '';
          if (document.getElementById('custEmail')) document.getElementById('custEmail').value = p.custEmail ?? row.cust_email ?? '';
          if (document.getElementById('custAddress')) document.getElementById('custAddress').value = p.custAddress ?? '';
          if (document.getElementById('currency')) document.getElementById('currency').value = p.currency ?? row.currency ?? 'USD';
          if (document.getElementById('invNumber')) document.getElementById('invNumber').value = p.invNumber ?? row.inv_number ?? '';
          if (document.getElementById('invDate')) document.getElementById('invDate').value = p.invDate ?? row.inv_date ?? '';
          if (document.getElementById('dueDate')) document.getElementById('dueDate').value = p.dueDate ?? row.due_date ?? '';
          if (document.getElementById('notes')) document.getElementById('notes').value = p.notes ?? row.notes ?? '';
          if (Array.isArray(p.items) && document.getElementById('itemsBody')) {
            document.getElementById('itemsBody').innerHTML = '';
            p.items.forEach(item => {
              if (typeof window.addItem === 'function') window.addItem();
              const tr = document.getElementById('itemsBody').lastElementChild, ins = tr?.querySelectorAll('input');
              if (ins) { ins[0].value = item.desc || ''; ins[1].value = item.qty || 1; ins[2].value = item.unit || ''; ins[3].value = item.rate || 0; ins[4].value = item.itemTax || 0; ins[5].value = item.itemDisc || 0; }
            });
          }
          if (typeof window.livePreview === 'function') window.livePreview();
          window.currentDraftId = String(row.id);
          cacheInvoice({ ...p, id: String(row.id), invNumber: p.invNumber ?? row.inv_number, customer: p.customer ?? row.customer, company: p.company ?? row.company, currency: p.currency ?? row.currency, total: Number(row.total || p.total || 0) });
        }
      } catch (e) { console.warn('Cloud invoice hydration failed:', e); }
    }
  }

  async function repairInvoiceList() {
    if (!document.getElementById('invoiceTable')) return;
    const result = await loadCloudInvoices();
    if (result.error) { console.warn('Cloud invoice list failed:', result.error); return; }
    const rows = result.data || [];
    const table = document.getElementById('invoiceTable'), empty = document.getElementById('emptyState'), count = document.getElementById('invoiceCountLabel');
    if (count) count.textContent = `${rows.length} invoice${rows.length !== 1 ? 's' : ''}`;
    if (!rows.length) { table.innerHTML = ''; if (empty) empty.style.display = 'block'; return; }
    if (empty) empty.style.display = 'none';
    const sym = { PKR: '₨', USD: '$', EUR: '€', AED: 'AED ', GBP: '£' };
    const esc = typeof escapeHtml === 'function' ? escapeHtml : s => String(s ?? '');
    table.innerHTML = rows.map(row => {
      const p = payloadOf(row), num = row.inv_number || p.invNumber || row.id, currency = row.currency || p.currency || 'USD';
      const amount = `${sym[currency] || currency + ' '}${Number(row.total || p.total || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
      const date = row.inv_date || p.invDate || row.created_at;
      return `<tr><td><span class="mono" style="font-size:13px;font-weight:600">${esc(num)}</span></td><td><strong>${esc(row.company || p.company || '—')}</strong></td><td>${esc(row.customer || p.customer || '—')}</td><td style="color:var(--muted);font-size:13px">${date ? new Date(date).toLocaleDateString('en-GB') : '—'}</td><td><span class="inv-amount">${amount}</span></td><td><span class="status-badge status-${esc(row.status || 'saved')}">${row.status === 'paid' ? '✅ Paid' : '📄 Saved'}</span></td><td><div class="action-btns"><button class="btn btn-outline btn-sm" onclick="openInvoice('${String(row.id)}')">📂 Open</button><button class="btn btn-danger btn-sm" onclick="fineInvoiceDelete('${String(row.id)}')">🗑️</button></div></td></tr>`;
    }).join('');
    window.openInvoice = id => { location.href = 'app.html?invoice=' + encodeURIComponent(id); };
    window.fineInvoiceDelete = async id => { if (!confirm('Delete this invoice?')) return; const r = await deleteCloudInvoice(id); if (r.error) { showToast(r.error.message, 'error'); return; } showToast('Invoice deleted', 'info'); await repairInvoiceList(); };
  }

  window.addEventListener('load', async () => { await repairBuilder(); await repairInvoiceList(); });
})();

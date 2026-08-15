// FineInvoice cloud persistence layer.
// Supabase is the primary invoice store; localStorage remains a cache/fallback.
(function () {
  'use strict';
  if (window.__fineInvoiceCloudPersistenceLoaded) return;
  window.__fineInvoiceCloudPersistenceLoaded = true;

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
    return p.legacy_id != null ? String(p.legacy_id) : '';
  }
  function isUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
  }

  // IMPORTANT: public.invoices contains only these columns. All builder-specific
  // fields live inside payload so schema changes cannot break invoice saving.
  function toRow(invoice, userId, existingId) {
    return {
      ...(existingId ? { id: existingId } : {}),
      user_id: userId,
      invoice_number: invoice.invNumber || invoice.invoice_number || null,
      customer_id: invoice.customer_id || null,
      status: invoice.status || 'saved',
      currency: invoice.currency || 'USD',
      total: Number(invoice.total || 0),
      payload: { ...invoice, legacy_id: invoice.id != null ? String(invoice.id) : null }
    };
  }

  async function findCloudInvoice(id) {
    const client = sb(), user = await sessionUser();
    if (!client || !user) return { data: null, error: { message: 'Not authenticated' } };
    const wanted = String(id || '');
    if (!wanted) return { data: null, error: null };

    if (isUuid(wanted)) {
      const byId = await client.from('invoices').select('*').eq('user_id', user.id).eq('id', wanted).maybeSingle();
      if (byId.error) return byId;
      if (byId.data) return byId;
    }

    return client.from('invoices').select('*').eq('user_id', user.id).filter('payload->>legacy_id', 'eq', wanted).maybeSingle();
  }

  async function saveCloudInvoice(invoice) {
    const client = sb(), user = await sessionUser();
    if (!client || !user) return { data: null, error: { message: 'Not authenticated' } };
    const legacy = invoice.id != null ? String(invoice.id) : '';
    let existing = null;

    if (isUuid(legacy)) {
      const byId = await client.from('invoices').select('id').eq('user_id', user.id).eq('id', legacy).maybeSingle();
      if (byId.error) return { data: null, error: byId.error };
      existing = byId.data?.id || null;
    }

    if (!existing && legacy) {
      const byLegacy = await client.from('invoices').select('id').eq('user_id', user.id).filter('payload->>legacy_id', 'eq', legacy).maybeSingle();
      if (byLegacy.error) return { data: null, error: byLegacy.error };
      existing = byLegacy.data?.id || null;
    }

    if (existing) {
      return client.from('invoices').update(toRow(invoice, user.id, existing)).eq('id', existing).eq('user_id', user.id).select().single();
    }
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
    const wanted = String(id || '');
    if (!wanted) return { error: { message: 'Invoice id is missing.' } };
    if (isUuid(wanted)) {
      return client.from('invoices').delete().eq('id', wanted).eq('user_id', user.id);
    }
    const found = await client.from('invoices').select('id').eq('user_id', user.id).filter('payload->>legacy_id', 'eq', wanted).maybeSingle();
    if (found.error) return { error: found.error };
    if (!found.data?.id) return { error: { message: 'Invoice not found.' } };
    return client.from('invoices').delete().eq('id', found.data.id).eq('user_id', user.id);
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

    window.saveInvoice = async function () {
      const invoice = collectInvoiceFromBuilder();
      if (!invoice.company || !invoice.customer) {
        showToast('Please enter company and customer name', 'error');
        return;
      }
      const result = await saveCloudInvoice(invoice);
      if (result.error) {
        console.error('Cloud invoice save failed:', result.error);
        showToast(result.error.message || 'Invoice could not be saved to your account.', 'error', 5000);
        return;
      }
      const cloudId = result.data?.id;
      if (cloudId) {
        invoice.cloudId = cloudId;
        if (!new URLSearchParams(location.search).get('invoice')) {
          window.currentDraftId = String(cloudId);
        }
      }
      cacheInvoice(invoice);
      showToast('Invoice saved securely to your account ✅', 'success');
    };

    const invoiceParam = new URLSearchParams(location.search).get('invoice');
    if (invoiceParam && typeof window.loadInvoiceById === 'function') {
      try {
        const result = await findCloudInvoice(invoiceParam);
        if (!result.error && result.data) {
          const row = result.data, p = payloadOf(row);
          if (document.getElementById('company')) document.getElementById('company').value = p.company ?? '';
          if (document.getElementById('customer')) document.getElementById('customer').value = p.customer ?? '';
          if (document.getElementById('bizEmail')) document.getElementById('bizEmail').value = p.bizEmail ?? '';
          if (document.getElementById('custEmail')) document.getElementById('custEmail').value = p.custEmail ?? '';
          if (document.getElementById('custAddress')) document.getElementById('custAddress').value = p.custAddress ?? '';
          if (document.getElementById('currency')) document.getElementById('currency').value = p.currency ?? row.currency ?? 'USD';
          if (document.getElementById('invNumber')) document.getElementById('invNumber').value = p.invNumber ?? row.invoice_number ?? '';
          if (document.getElementById('invDate')) document.getElementById('invDate').value = p.invDate ?? '';
          if (document.getElementById('dueDate')) document.getElementById('dueDate').value = p.dueDate ?? '';
          if (document.getElementById('notes')) document.getElementById('notes').value = p.notes ?? '';
          if (Array.isArray(p.items) && document.getElementById('itemsBody')) {
            document.getElementById('itemsBody').innerHTML = '';
            p.items.forEach(item => {
              if (typeof window.addItem === 'function') window.addItem(item);
            });
          }
          if (typeof window.livePreview === 'function') window.livePreview();
          window.currentDraftId = String(row.id);
          cacheInvoice({ ...p, id: String(row.id), invNumber: p.invNumber ?? row.invoice_number, customer: p.customer ?? '', company: p.company ?? '', currency: p.currency ?? row.currency, total: Number(row.total || p.total || 0) });
        }
      } catch (e) {
        console.warn('Cloud invoice hydration failed:', e);
      }
    }
  }

  async function migrateLocalInvoicesIfNeeded(cloudRows) {
    if (typeof getInvoices !== 'function') return cloudRows;
    const localRows = getInvoices();
    if (!Array.isArray(localRows) || !localRows.length) return cloudRows;
    const cloudLegacy = new Set((cloudRows || []).map(legacyIdOf).filter(Boolean));
    let changed = false;
    for (const local of localRows) {
      const localId = String(local?.id || '');
      if (!localId || cloudLegacy.has(localId)) continue;
      const saved = await saveCloudInvoice(local);
      if (!saved.error) {
        changed = true;
        cloudLegacy.add(localId);
      } else {
        console.warn('FineInvoice local invoice migration skipped:', saved.error);
      }
    }
    if (changed) {
      const refreshed = await loadCloudInvoices();
      return refreshed.error ? cloudRows : (refreshed.data || []);
    }
    return cloudRows;
  }

  async function repairInvoiceList() {
    if (!document.getElementById('invoiceTable')) return;
    const result = await loadCloudInvoices();
    if (result.error) {
      console.warn('Cloud invoice list failed:', result.error);
      return;
    }
    const rows = await migrateLocalInvoicesIfNeeded(result.data || []);
    const table = document.getElementById('invoiceTable'), empty = document.getElementById('emptyState'), count = document.getElementById('invoiceCountLabel');
    if (count) count.textContent = `${rows.length} invoice${rows.length !== 1 ? 's' : ''}`;
    if (!rows.length) {
      table.innerHTML = '';
      if (empty) empty.style.display = 'block';
      return;
    }
    if (empty) empty.style.display = 'none';
    const sym = { PKR: '₨', USD: '$', EUR: '€', AED: 'AED ', GBP: '£' };
    const esc = typeof escapeHtml === 'function' ? escapeHtml : s => String(s ?? '');
    table.innerHTML = rows.map(row => {
      const p = payloadOf(row), num = row.invoice_number || p.invNumber || row.id, currency = row.currency || p.currency || 'USD';
      const amount = `${sym[currency] || currency + ' '}${Number(row.total || p.total || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
      const date = p.invDate || row.created_at;
      return `<tr><td><span class="mono" style="font-size:13px;font-weight:600">${esc(num)}</span></td><td><strong>${esc(p.company || '—')}</strong></td><td>${esc(p.customer || '—')}</td><td style="color:var(--muted);font-size:13px">${date ? new Date(date).toLocaleDateString('en-GB') : '—'}</td><td><span class="inv-amount">${amount}</span></td><td><span class="status-badge status-${esc(row.status || 'saved')}">${row.status === 'paid' ? '✅ Paid' : '📄 Saved'}</span></td><td><div class="action-btns"><button class="btn btn-outline btn-sm" onclick="openInvoice('${String(row.id)}')">📂 Open</button><button class="btn btn-danger btn-sm" onclick="fineInvoiceDelete('${String(row.id)}')">🗑️</button></div></td></tr>`;
    }).join('');
    window.openInvoice = id => { location.href = 'app.html?invoice=' + encodeURIComponent(id); };
    window.fineInvoiceDelete = async id => {
      if (!confirm('Delete this invoice?')) return;
      const r = await deleteCloudInvoice(id);
      if (r.error) { showToast(r.error.message, 'error'); return; }
      const local = typeof getInvoices === 'function' ? getInvoices().filter(x => String(x.id) !== String(id)) : [];
      if (typeof saveInvoices === 'function') saveInvoices(local);
      showToast('Invoice deleted', 'info');
      await repairInvoiceList();
    };
  }

  window.addEventListener('load', async () => {
    try { await repairBuilder(); } catch (e) { console.warn('FineInvoice builder cloud repair failed:', e); }
    try { await repairInvoiceList(); } catch (e) { console.warn('FineInvoice invoice-list cloud repair failed:', e); }
  });
})();

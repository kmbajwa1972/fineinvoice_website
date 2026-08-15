// FineInvoice cloud persistence layer.
// Matches the ACTUAL production invoices schema in Supabase.
(function(){
  'use strict';
  if(window.__fineInvoiceCloudPersistenceLoaded)return;
  window.__fineInvoiceCloudPersistenceLoaded=true;
  function sb(){return typeof getSupabase==='function'?getSupabase():null}
  async function sessionUser(){const client=sb();if(!client)return null;const r=await client.auth.getSession();return r.data?.session?.user||null}
  function payloadOf(row){return row?.payload&&typeof row.payload==='object'?row.payload:(row||{})}
  function legacyIdOf(row){const p=payloadOf(row);return p.legacy_id!=null?String(p.legacy_id):''}
  function isUuid(v){return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v||''))}

  // IMPORTANT: production public.invoices has inv_number, not invoice_number,
  // and it does NOT have customer_id. Customer data is stored directly in the
  // invoice columns and the full legacy object is also retained in payload.
  function toRow(invoice,userId,existingId){
    return {
      ...(existingId?{id:existingId}:{}),
      user_id:userId,
      inv_number:invoice.invNumber||invoice.invoice_number||null,
      company:invoice.company||null,
      customer:invoice.customer||null,
      cust_email:invoice.custEmail||null,
      currency:invoice.currency||'USD',
      total:Number(invoice.total||0),
      items:Array.isArray(invoice.items)?invoice.items:[],
      tax:Number(invoice.tax||0),
      discount:Number(invoice.discount||0),
      notes:invoice.notes||null,
      theme_color:invoice.themeColor||null,
      due_date:invoice.dueDate||null,
      inv_date:invoice.invDate||null,
      status:invoice.status||'saved',
      payload:{...invoice,legacy_id:invoice.id!=null?String(invoice.id):null}
    }
  }
  async function findCloudInvoice(id){
    const client=sb(),user=await sessionUser();
    if(!client||!user)return{data:null,error:{message:'Not authenticated'}};
    const wanted=String(id||'');if(!wanted)return{data:null,error:null};
    if(isUuid(wanted)){const byId=await client.from('invoices').select('*').eq('user_id',user.id).eq('id',wanted).maybeSingle();if(byId.error)return byId;if(byId.data)return byId}
    return client.from('invoices').select('*').eq('user_id',user.id).filter('payload->>legacy_id','eq',wanted).maybeSingle()
  }
  async function saveCloudInvoice(invoice){
    const client=sb(),user=await sessionUser();
    if(!client||!user)return{data:null,error:{message:'Not authenticated'}};
    const legacy=invoice.id!=null?String(invoice.id):'';let existing=null;
    if(isUuid(legacy)){const q=await client.from('invoices').select('id').eq('user_id',user.id).eq('id',legacy).maybeSingle();if(q.error)return{data:null,error:q.error};existing=q.data?.id||null}
    if(!existing&&legacy){const q=await client.from('invoices').select('id').eq('user_id',user.id).filter('payload->>legacy_id','eq',legacy).maybeSingle();if(q.error)return{data:null,error:q.error};existing=q.data?.id||null}
    const row=toRow(invoice,user.id,existing);
    if(existing)return client.from('invoices').update(row).eq('id',existing).eq('user_id',user.id).select().single();
    return client.from('invoices').insert(row).select().single()
  }
  async function loadCloudInvoices(){const client=sb(),user=await sessionUser();if(!client||!user)return{data:[],error:{message:'Not authenticated'}};return client.from('invoices').select('*').eq('user_id',user.id).order('created_at',{ascending:false})}
  async function deleteCloudInvoice(id){
    const client=sb(),user=await sessionUser();if(!client||!user)return{error:{message:'Not authenticated'}};
    const wanted=String(id||'');if(!wanted)return{error:{message:'Invoice id is missing.'}};
    if(isUuid(wanted))return client.from('invoices').delete().eq('id',wanted).eq('user_id',user.id);
    const found=await client.from('invoices').select('id').eq('user_id',user.id).filter('payload->>legacy_id','eq',wanted).maybeSingle();
    if(found.error)return{error:found.error};if(!found.data?.id)return{error:{message:'Invoice not found.'}};
    return client.from('invoices').delete().eq('id',found.data.id).eq('user_id',user.id)
  }
  window.fineInvoiceCloud={loadCloudInvoices,saveCloudInvoice,findCloudInvoice,deleteCloudInvoice};

  function cacheInvoice(invoice){if(typeof getInvoices!=='function'||typeof saveInvoices!=='function')return;const all=getInvoices(),id=String(invoice.id),idx=all.findIndex(x=>String(x.id)===id);if(idx>=0)all[idx]=invoice;else all.push(invoice);saveInvoices(all)}
  function collectInvoiceFromBuilder(){
    const rows=[...document.querySelectorAll('#itemsBody tr')].map(tr=>{const i=tr.querySelectorAll('input');return{desc:i[0]?.value||'',qty:i[1]?.value||1,unit:i[2]?.value||'',rate:i[3]?.value||0,itemTax:i[4]?.value||0,itemDisc:i[5]?.value||0}});
    let subtotal=0,itemTax=0,itemDisc=0;rows.forEach(r=>{const base=(Number(r.qty)||0)*(Number(r.rate)||0);subtotal+=base;itemTax+=base*(Number(r.itemTax)||0)/100;itemDisc+=base*(Number(r.itemDisc)||0)/100});
    const taxPct=Number(document.getElementById('tax')?.value)||0,discPct=Number(document.getElementById('discount')?.value)||0;
    const tax=itemTax+subtotal*taxPct/100,discount=itemDisc+subtotal*discPct/100;
    const id=window.currentDraftId||new URLSearchParams(location.search).get('invoice')||('DRAFT-'+Date.now()+'-'+Math.random().toString(36).slice(2,8));
    return{id,company:document.getElementById('company')?.value||'',customer:document.getElementById('customer')?.value||'',bizEmail:document.getElementById('bizEmail')?.value||'',custEmail:document.getElementById('custEmail')?.value||'',custAddress:document.getElementById('custAddress')?.value||'',currency:document.getElementById('currency')?.value||'USD',total:subtotal+tax-discount,items:rows,tax:taxPct,discount:discPct,invNumber:document.getElementById('invNumber')?.value||'',invDate:document.getElementById('invDate')?.value||'',dueDate:document.getElementById('dueDate')?.value||'',notes:document.getElementById('notes')?.value||'',themeColor:document.querySelector('.theme-dot.selected')?.dataset.color||'#6C3FF5',logoData:document.getElementById('logoImg')?.src||'',date:new Date().toISOString(),status:'saved'}
  }
  async function repairBuilder(){
    if(!document.getElementById('invoiceDoc')||typeof window.saveInvoice!=='function')return;
    window.saveInvoice=async function(){
      const invoice=collectInvoiceFromBuilder();
      if(!invoice.company||!invoice.customer){showToast('Please enter company and customer name','error');return}
      const result=await saveCloudInvoice(invoice);
      if(result.error){console.error('Cloud invoice save failed:',result.error);showToast(result.error.message||'Invoice could not be saved to your account.','error',6000);return}
      const cloudId=result.data?.id;if(cloudId)window.currentDraftId=String(cloudId);
      cacheInvoice({...invoice,id:cloudId||invoice.id});
      showToast('Invoice saved securely to your account ✅','success')
    };
    const invoiceParam=new URLSearchParams(location.search).get('invoice');
    if(invoiceParam){
      try{const result=await findCloudInvoice(invoiceParam);if(!result.error&&result.data){const row=result.data,p=payloadOf(row);const set=(id,v)=>{const e=document.getElementById(id);if(e)e.value=v??''};set('company',row.company??p.company);set('customer',row.customer??p.customer);set('bizEmail',p.bizEmail);set('custEmail',row.cust_email??p.custEmail);set('custAddress',p.custAddress);set('currency',row.currency??p.currency??'USD');set('invNumber',row.inv_number??p.invNumber);set('invDate',row.inv_date??p.invDate);set('dueDate',row.due_date??p.dueDate);set('notes',row.notes??p.notes);window.currentDraftId=String(row.id);if(Array.isArray(row.items)||Array.isArray(p.items)){const items=Array.isArray(row.items)?row.items:p.items||[];const tb=document.getElementById('itemsBody');if(tb){tb.innerHTML='';items.forEach(item=>{if(typeof window.addItem==='function')window.addItem(item)})}}if(typeof window.livePreview==='function')window.livePreview();cacheInvoice({...p,id:String(row.id),invNumber:row.inv_number??p.invNumber,company:row.company??p.company,customer:row.customer??p.customer,custEmail:row.cust_email??p.custEmail,currency:row.currency??p.currency,total:Number(row.total||p.total||0)})}}catch(e){console.warn('Cloud invoice hydration failed:',e)}}
  }
  async function migrateLocalInvoicesIfNeeded(cloudRows){
    if(typeof getInvoices!=='function')return cloudRows;const localRows=getInvoices();if(!Array.isArray(localRows)||!localRows.length)return cloudRows;
    const cloudLegacy=new Set((cloudRows||[]).map(legacyIdOf).filter(Boolean));let changed=false;
    for(const local of localRows){const localId=String(local?.id||'');if(!localId||cloudLegacy.has(localId))continue;const saved=await saveCloudInvoice(local);if(!saved.error){changed=true;cloudLegacy.add(localId)}else console.warn('FineInvoice local invoice migration skipped:',saved.error)}
    if(changed){const refreshed=await loadCloudInvoices();return refreshed.error?cloudRows:(refreshed.data||[])}return cloudRows
  }
  async function repairInvoiceList(){
    if(!document.getElementById('invoiceTable'))return;const result=await loadCloudInvoices();if(result.error){console.warn('Cloud invoice list failed:',result.error);return}
    const rows=await migrateLocalInvoicesIfNeeded(result.data||[]),table=document.getElementById('invoiceTable'),empty=document.getElementById('emptyState'),count=document.getElementById('invoiceCountLabel');
    if(count)count.textContent=`${rows.length} invoice${rows.length!==1?'s':''}`;if(!rows.length){table.innerHTML='';if(empty)empty.style.display='block';return}if(empty)empty.style.display='none';
    const sym={PKR:'₨',USD:'$',EUR:'€',AED:'AED ',GBP:'£'},esc=typeof escapeHtml==='function'?escapeHtml:s=>String(s??'');
    table.innerHTML=rows.map(row=>{const p=payloadOf(row),num=row.inv_number||p.invNumber||row.id,currency=row.currency||p.currency||'USD',amount=`${sym[currency]||currency+' '}${Number(row.total||p.total||0).toLocaleString('en-US',{minimumFractionDigits:2})}`,date=row.inv_date||p.invDate||row.created_at;return `<tr><td><span class="mono" style="font-size:13px;font-weight:600">${esc(num)}</span></td><td><strong>${esc(row.company||p.company||'—')}</strong></td><td>${esc(row.customer||p.customer||'—')}</td><td style="color:var(--muted);font-size:13px">${date?new Date(date).toLocaleDateString('en-GB'):'—'}</td><td><span class="inv-amount">${amount}</span></td><td><span class="status-badge status-${esc(row.status||'saved')}">${row.status==='paid'?'✅ Paid':'📄 Saved'}</span></td><td><div class="action-btns"><button class="btn btn-outline btn-sm" onclick="openInvoice('${String(row.id)}')">📂 Open</button><button class="btn btn-danger btn-sm" onclick="fineInvoiceDelete('${String(row.id)}')">🗑️</button></div></td></tr>`}).join('');
    window.openInvoice=id=>{location.href='app.html?invoice='+encodeURIComponent(id)};window.fineInvoiceDelete=async id=>{if(!confirm('Delete this invoice?'))return;const r=await deleteCloudInvoice(id);if(r.error){showToast(r.error.message,'error');return}const local=typeof getInvoices==='function'?getInvoices().filter(x=>String(x.id)!==String(id)):[];if(typeof saveInvoices==='function')saveInvoices(local);showToast('Invoice deleted','info');await repairInvoiceList()}
  }
  window.addEventListener('load',async()=>{try{await repairBuilder()}catch(e){console.warn('FineInvoice builder cloud repair failed:',e)}try{await repairInvoiceList()}catch(e){console.warn('FineInvoice invoice-list cloud repair failed:',e)}})
})();

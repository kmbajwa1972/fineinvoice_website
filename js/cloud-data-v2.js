// FineInvoice cloud invoice persistence v2.
// Intentionally uses only columns known to exist in the current invoices table.
(function(){
  'use strict';
  if(window.__fineInvoiceCloudV2Loaded)return;
  window.__fineInvoiceCloudV2Loaded=true;
  const client=()=>typeof getSupabase==='function'?getSupabase():null;
  async function user(){const sb=client();if(!sb)return null;const r=await sb.auth.getSession();return r.data?.session?.user||null;}
  const payload=row=>row?.payload&&typeof row.payload==='object'?row.payload:(row||{});
  const legacy=row=>String(payload(row).legacy_id||'');
  async function saveCloud(invoice){
    const sb=client(),u=await user();
    if(!sb||!u)return{error:{message:'Your session is unavailable. Please sign in again.'}};
    const data={user_id:u.id,invoice_number:invoice.invNumber||invoice.invoice_number||null,status:invoice.status||'saved',currency:invoice.currency||'USD',total:Number(invoice.total||0),payload:{...invoice,legacy_id:invoice.id!=null?String(invoice.id):null}};
    // IMPORTANT: do not send customer_id. Customer information lives in payload.
    let existing=null;
    if(invoice.id){
      const q=await sb.from('invoices').select('id').eq('user_id',u.id).filter('payload->>legacy_id','eq',String(invoice.id)).maybeSingle();
      if(q.error)return{error:q.error};
      existing=q.data?.id||null;
    }
    if(existing)return sb.from('invoices').update(data).eq('id',existing).eq('user_id',u.id).select().single();
    return sb.from('invoices').insert(data).select().single();
  }
  async function loadCloud(){const sb=client(),u=await user();if(!sb||!u)return{data:[],error:{message:'Not authenticated'}};return sb.from('invoices').select('*').eq('user_id',u.id).order('created_at',{ascending:false});}
  function localCache(inv){const all=typeof getInvoices==='function'?getInvoices():[];const i=all.findIndex(x=>String(x.id)===String(inv.id));if(i>=0)all[i]=inv;else all.push(inv);if(typeof saveInvoices==='function')saveInvoices(all);}
  function collect(){const rows=[...document.querySelectorAll('#itemsBody tr')].map(tr=>{const x=tr.querySelectorAll('input');return{desc:x[0]?.value||'',qty:x[1]?.value||1,unit:x[2]?.value||'',rate:x[3]?.value||0,itemTax:x[4]?.value||0,itemDisc:x[5]?.value||0};});let total=0;rows.forEach(r=>{const b=(Number(r.qty)||0)*(Number(r.rate)||0);total+=b+b*(Number(r.itemTax)||0)/100-b*(Number(r.itemDisc)||0)/100;});const base=document.querySelector('#itemsBody')?rows.reduce((s,r)=>s+(Number(r.qty)||0)*(Number(r.rate)||0),0):0;total=base+base*(Number(document.getElementById('tax')?.value)||0)/100-base*(Number(document.getElementById('discount')?.value)||0)/100;const id=window.currentDraftId||new URLSearchParams(location.search).get('invoice')||('DRAFT-'+Date.now()+'-'+Math.random().toString(36).slice(2,8));return{id,company:document.getElementById('company')?.value||'',customer:document.getElementById('customer')?.value||'',bizEmail:document.getElementById('bizEmail')?.value||'',custEmail:document.getElementById('custEmail')?.value||'',custAddress:document.getElementById('custAddress')?.value||'',currency:document.getElementById('currency')?.value||'USD',total,invNumber:document.getElementById('invNumber')?.value||'',invDate:document.getElementById('invDate')?.value||'',dueDate:document.getElementById('dueDate')?.value||'',notes:document.getElementById('notes')?.value||'',themeColor:window.themeColor||document.querySelector('.theme-dot.selected')?.dataset.color||'#6C3FF5',logoData:window.logoData||'',items:rows,date:new Date().toISOString(),status:'saved'};}
  async function save(){const inv=collect();if(!inv.company||!inv.customer){showToast('Please enter company and customer name','error');return;}const r=await saveCloud(inv);if(r.error){console.error('[FineInvoice] invoice save failed:',r.error);showToast(r.error.message||'Invoice could not be saved to your account.','error',6000);return;}if(r.data?.id)window.currentDraftId=String(r.data.id);localCache(inv);showToast('Invoice saved securely to your account ✅','success');}
  async function list(){const r=await loadCloud();if(r.error)return;const rows=r.data||[];const body=document.getElementById('invoiceTable');if(!body)return;const empty=document.getElementById('emptyState');const count=document.getElementById('invoiceCountLabel');if(count)count.textContent=`${rows.length} invoice${rows.length===1?'':'s'}`;if(!rows.length){body.innerHTML='';if(empty)empty.style.display='block';return;}if(empty)empty.style.display='none';const sym={USD:'$',PKR:'₨',EUR:'€',AED:'AED ',GBP:'£'};body.innerHTML=rows.map(row=>{const p=payload(row),c=row.currency||p.currency||'USD',num=row.invoice_number||p.invNumber||row.id;return `<tr><td>${escapeHtml(num)}</td><td>${escapeHtml(p.company||'—')}</td><td>${escapeHtml(p.customer||'—')}</td><td>${p.invDate||row.created_at?new Date(p.invDate||row.created_at).toLocaleDateString('en-GB'):'—'}</td><td>${sym[c]||c+' '}${Number(row.total||p.total||0).toFixed(2)}</td><td>${row.status||'saved'}</td><td><button class="btn btn-outline btn-sm" onclick="location.href='app.html?invoice=${encodeURIComponent(row.id)}'">📂 Open</button></td></tr>`;}).join('');}
  window.fineInvoiceCloudV2={saveCloud,loadCloud,list};
  window.addEventListener('load',()=>{if(document.getElementById('invoiceDoc'))window.saveInvoice=save; if(document.getElementById('invoiceTable'))list();});
})();

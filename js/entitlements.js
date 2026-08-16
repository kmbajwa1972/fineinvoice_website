(function(){
'use strict';

function aliases(){
  const s=new Set(), add=v=>{if(v!=null&&String(v).trim())s.add(String(v))};
  if(typeof currentDraftId!=='undefined') add(currentDraftId);
  const q=new URLSearchParams(location.search).get('invoice'); add(q);
  if(typeof getInvoices==='function'){
    const a=getInvoices(), n=String(q||(typeof currentDraftId!=='undefined'?currentDraftId:''));
    const m=a.find(i=>[i?.id,i?.entitlementId,i?.invNumber,i?.invoice_number].some(v=>v!=null&&String(v)===n));
    if(m){add(m.id);add(m.entitlementId);add(m.invNumber);add(m.invoice_number)}
  }
  add(document.getElementById('invNumber')?.value);
  return [...s];
}
function invNo(){const v=document.getElementById('invNumber')?.value||'',m=String(v).match(/(?:INV[-_ ]?)(\d+)/i);return m?Number(m[1]):null}
function firstFour(){const n=invNo();return Number.isFinite(n)&&n>=1&&n<=4}
function unlocked(u){const ids=Array.isArray(u?.unlockedInvoiceIds)?u.unlockedInvoiceIds.map(String):[];return firstFour()||aliases().some(x=>ids.includes(String(x)))}
function invoiceId(){return String(document.getElementById('invNumber')?.value||aliases()[0]||currentDraftId||'draft')}

async function loadUser(){
  let u=typeof getAuthUser==='function'?await getAuthUser():getCurrentUser?.();
  if(!u)return null;
  const sb=typeof getSupabase==='function'?getSupabase():null;
  if(sb&&u.id){
    try{
      const {data,error}=await sb.from('profiles').select('plan,single_credits').eq('id',u.id).maybeSingle();
      if(!error&&data){
        const plan=String(data.plan||u.plan||'free').toLowerCase();
        const paid=plan==='single'?Math.max(0,Number(data.single_credits||0)):0;
        u={...u,plan,paidSingleCredits:paid,freePdfCredits:Math.max(0,Number(u.freePdfCredits??(plan==='free'?u.singleCredits??3:0))),singleCredits:Math.max(0,Number(u.singleCredits??0))};
        saveCurrentUser(u);
      }
    }catch(e){console.warn('Profile entitlement read failed:',e)}
  }
  return u;
}

async function consumePaidCredit(u,id){
  if(unlocked(u)||String(u.plan||'').toLowerCase()==='lifetime')return{ok:true,alreadyUnlocked:true};
  const paid=Math.max(0,Number(u.paidSingleCredits||0));
  if(paid<=0)return{ok:false,error:'No PDF credits remaining.'};
  const ids=[...new Set([...(u.unlockedInvoiceIds||[]).map(String),String(id)])],next=paid-1,sb=typeof getSupabase==='function'?getSupabase():null;
  if(sb){
    const {error:ae}=await sb.auth.updateUser({data:{paidSingleCredits:next,unlockedInvoiceIds:ids,singleCredits:Number(u.freePdfCredits||0)}});
    if(ae)return{ok:false,error:ae.message||'Could not save PDF entitlement.'};
    if(u.id){const {error:pe}=await sb.from('profiles').update({single_credits:next}).eq('id',u.id);if(pe)return{ok:false,error:pe.message||'Could not update PDF credit balance.'}}
  }
  u.paidSingleCredits=next;u.unlockedInvoiceIds=ids;saveCurrentUser(u);return{ok:true,source:'paid'};
}

function styles(){
  if(document.getElementById('fineinvoice-pdf-flow-fix'))return;
  const s=document.createElement('style');s.id='fineinvoice-pdf-flow-fix';
  s.textContent=`#invoiceDoc{height:auto!important;min-height:297mm;overflow:visible!important}#invoiceDoc .invoice-paper{min-height:297mm;height:auto!important;overflow:visible!important}@media screen{#invoiceDoc .invoice-paper{font-size:13px!important}#invoiceDoc .inv-company-name{font-size:22px!important}#invoiceDoc .inv-company-email{font-size:11px!important}#invoiceDoc .inv-bill-label{font-size:9px!important}#invoiceDoc .inv-bill-name{font-size:15px!important}#invoiceDoc .inv-small,#invoiceDoc .inv-details{font-size:11px!important;line-height:1.35!important}#invoiceDoc .inv-items-table{font-size:11px!important}#invoiceDoc .inv-items-table th{font-size:9px!important;padding:7px 6px!important}#invoiceDoc .inv-items-table td{font-size:11px!important;padding:6px!important}#invoiceDoc .inv-total-row{font-size:11px!important}#invoiceDoc .inv-grand{font-size:15px!important}#invoiceDoc .inv-notes{font-size:10px!important;padding:8px 10px!important}#invoiceDoc .inv-footer{font-size:9px!important}}#invoiceDoc .inv-items-table tr{break-inside:avoid;page-break-inside:avoid}@media print{@page{size:A4 portrait;margin:15mm 10mm}body.print-mode .page-body{padding:0!important;margin:0!important}body.print-mode #invoiceDoc{font-size:14px!important;line-height:1.45!important;width:100%!important;min-height:0!important}body.print-mode #invoiceDoc .invoice-paper{width:190mm!important;max-width:190mm!important;min-height:0!important;height:auto!important;margin:0 auto!important;padding:10mm 6mm!important;overflow:visible!important}body.print-mode #invoiceDoc .inv-company-name{font-size:24px!important}body.print-mode #invoiceDoc .inv-company-email{font-size:12px!important}body.print-mode #invoiceDoc .inv-bill-label{font-size:10px!important}body.print-mode #invoiceDoc .inv-bill-name{font-size:16px!important}body.print-mode #invoiceDoc .inv-small,body.print-mode #invoiceDoc .inv-details{font-size:12px!important;line-height:1.4!important}body.print-mode #invoiceDoc .inv-items-table{font-size:12px!important}body.print-mode #invoiceDoc .inv-items-table th{font-size:10px!important;padding:7px!important}body.print-mode #invoiceDoc .inv-items-table td{font-size:12px!important;padding:7px!important}body.print-mode #invoiceDoc .inv-total-row{font-size:12px!important}body.print-mode #invoiceDoc .inv-grand{font-size:17px!important;padding-top:8px!important}body.print-mode #invoiceDoc .inv-notes{font-size:11px!important;padding:9px 11px!important}body.print-mode #invoiceDoc .inv-footer{font-size:10px!important;padding-top:10px!important}body.print-mode #invoiceDoc .inv-logo{max-height:60px!important;max-width:150px!important}body.print-mode #invoiceDoc .inv-header{padding-bottom:14px!important;margin-bottom:14px!important}body.print-mode #invoiceDoc .inv-meta{margin-bottom:14px!important}body.print-mode #invoiceDoc .inv-totals{margin-bottom:14px!important}}@media screen{#invoiceDoc.pdf-capture .invoice-paper{font-size:11px!important}#invoiceDoc.pdf-capture .inv-company-name{font-size:19px!important}#invoiceDoc.pdf-capture .inv-company-email{font-size:10px!important}#invoiceDoc.pdf-capture .inv-bill-label{font-size:8px!important}#invoiceDoc.pdf-capture .inv-bill-name{font-size:13px!important}#invoiceDoc.pdf-capture .inv-small,#invoiceDoc.pdf-capture .inv-details{font-size:9.5px!important;line-height:1.25!important}#invoiceDoc.pdf-capture .inv-items-table{font-size:9.5px!important}#invoiceDoc.pdf-capture .inv-items-table th{font-size:8px!important;padding:6px!important}#invoiceDoc.pdf-capture .inv-items-table td{font-size:9.5px!important;padding:5px 6px!important}#invoiceDoc.pdf-capture .inv-total-row{font-size:9.5px!important}#invoiceDoc.pdf-capture .inv-grand{font-size:13px!important}#invoiceDoc.pdf-capture .inv-notes{font-size:9px!important;padding:7px 9px!important}#invoiceDoc.pdf-capture .inv-footer{font-size:8.5px!important;padding-top:8px!important}}#fineinvoice-print-dashboard{display:none;position:fixed;top:12px;right:14px;z-index:9999;padding:9px 14px;border:0;border-radius:8px;background:#6C3FF5;color:#fff;font-weight:700;cursor:pointer;box-shadow:0 3px 12px rgba(0,0,0,.18)}body.print-mode #fineinvoice-print-dashboard{display:block}@media print{#fineinvoice-print-dashboard{display:none!important}}`;
  document.head.appendChild(s);
  if(!document.getElementById('fineinvoice-print-dashboard')){const b=document.createElement('button');b.id='fineinvoice-print-dashboard';b.type='button';b.textContent='← Dashboard';b.onclick=()=>{document.body.classList.remove('print-mode');location.href='dashboard.html'};document.body.appendChild(b)}
}

async function makePdf(){
  if(!window.jspdf?.jsPDF||typeof html2canvas!=='function')throw Error('PDF engine unavailable');
  const p=document.querySelector('#invoiceDoc .invoice-paper');if(!p)throw Error('Invoice is empty');
  const el=document.getElementById('invoiceDoc');el.classList.add('pdf-capture');
  try{const c=await html2canvas(p,{scale:3,useCORS:true,backgroundColor:'#fff',scrollX:0,scrollY:0,logging:false,windowWidth:Math.max(document.documentElement.clientWidth,p.scrollWidth)}),{jsPDF}=window.jspdf,W=210,H=297,M=6,CW=W-M*2,CH=H-M*2,mm=CW/c.width,total=c.height*mm,pages=Math.max(1,Math.ceil(total/CH)),doc=new jsPDF({orientation:'portrait',unit:'mm',format:'a4');for(let pg=0;pg<pages;pg++){if(pg)doc.addPage('a4','portrait');const sy=Math.floor(pg*CH/mm),sh=Math.min(c.height-sy,Math.ceil(CH/mm));if(sh<=0)continue;const slice=document.createElement('canvas');slice.width=c.width;slice.height=sh;const x=slice.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,slice.width,slice.height);x.drawImage(c,0,sy,c.width,sh,0,0,c.width,sh);doc.addImage(slice.toDataURL('image/jpeg',.96),'JPEG',M,M,CW,sh*mm)}return doc}catch(e){throw e}finally{el.classList.remove('pdf-capture')}
}

function installSaveRepair(){if(window.__fineInvoiceSaveRepairInstalled)return;window.__fineInvoiceSaveRepairInstalled=true;const original=window.saveInvoice;if(typeof original!=='function')return;window.saveInvoice=function(){try{return original.apply(this,arguments)}catch(e){console.error('FineInvoice save failed:',e);showToast('Invoice could not be saved. Please try again.','error',5000)}}}

window.addEventListener('load',()=>{styles();setTimeout(()=>{installSaveRepair();window.downloadPDF=async function(){const u=await loadUser();if(!u){showToast('Please sign in again to create a PDF.','error',5000);return}const n=invoiceId(),life=String(u.plan||'free').toLowerCase()==='lifetime',open=unlocked(u),free=Math.max(0,Number(u.freePdfCredits||0)),paid=Math.max(0,Number(u.paidSingleCredits||0));if(!life&&!open&&invNo()>4&&free+paid<=0){showToast('No PDF credits remaining. Please purchase a PDF credit or Lifetime Access.','error',5000);if(confirm('You have no PDF credits remaining.\n\nSingle: $2 per PDF\nor Lifetime: $25 unlimited.\n\nGo to Billing?'))location.href='payment.html';return}showToast('Generating PDF…','info');try{const doc=await makePdf();if(!life&&!open&&invNo()>4){const r=await consumePaidCredit(u,n);if(!r.ok)throw Error(r.error)}doc.save((document.getElementById('invNumber').value||'invoice').replace(/[^a-z0-9._-]/gi,'_')+'.pdf');localStorage.setItem('fi_downloads',String(parseInt(localStorage.getItem('fi_downloads')||'0',10)+1));showToast('PDF downloaded! 🎉','success')}catch(e){console.error('FineInvoice PDF generation failed:',e);showToast('PDF generation failed. Your PDF credit was not used.','error',5000)}};window.printInvoice=async function(){const u=await loadUser();if(!u){showToast('Please sign in again to print.','error',5000);return}const n=invoiceId(),life=String(u.plan||'free').toLowerCase()==='lifetime',open=unlocked(u),free=Math.max(0,Number(u.freePdfCredits||0)),paid=Math.max(0,Number(u.paidSingleCredits||0));if(!life&&!open&&invNo()>4&&free+paid<=0){showToast('No PDF credits remaining. Please purchase a PDF credit or Lifetime Access.','error',5000);return}if(!life&&!open&&invNo()>4){const r=await consumePaidCredit(u,n);if(!r.ok){showToast(r.error,'error',5000);return}}document.body.classList.add('print-mode');window.print();setTimeout(()=>document.body.classList.remove('print-mode'),800)}},0)});
})();

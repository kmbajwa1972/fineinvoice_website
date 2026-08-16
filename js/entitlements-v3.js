// FineInvoice entitlement gate v3
(() => {
  'use strict';
  const invNo=()=>{const m=String(document.getElementById('invNumber')?.value||'').match(/(?:INV[-_ ]?)(\d+)/i);return m?Number(m[1]):null};
  const free=()=>{const n=invNo();return Number.isFinite(n)&&n>=1&&n<=4};
  const id=()=>typeof currentDraftId!=='undefined'&&currentDraftId!=null?String(currentDraftId):String(new URLSearchParams(location.search).get('invoice')||document.getElementById('invNumber')?.value||'draft');
  const open=(u,x)=>free()||String(u?.plan||'').toLowerCase()==='lifetime'||(u?.unlockedInvoiceIds||[]).map(String).includes(String(x));
  async function user(){const s=getSupabase();if(!s)return getCurrentUser?.()||null;let r=await s.auth.getSession();if(!r.data?.session)r=await s.auth.refreshSession();const a=r.data?.session?.user;if(!a)return null;const m=a.user_metadata||{},p=getCurrentUser?.()||{},pl=['single','lifetime'].includes(String(m.plan??p.plan??'free').toLowerCase())?String(m.plan??p.plan).toLowerCase():'free',u={...p,id:a.id,email:a.email||p.email||'',name:m.name||p.name||a.email||'User',plan:pl,planVerified:m.planVerified===true,paymentProvider:m.paymentProvider||p.paymentProvider||null,freePdfCredits:Math.max(0,Number(m.freePdfCredits??p.freePdfCredits??0)||0),paidSingleCredits:pl==='single'?Math.max(0,Number(m.paidSingleCredits??p.paidSingleCredits??0)||0):0,unlockedInvoiceIds:Array.isArray(m.unlockedInvoiceIds)?m.unlockedInvoiceIds.map(String):(p.unlockedInvoiceIds||[])};u.singleCredits=u.freePdfCredits+u.paidSingleCredits;saveCurrentUser(u);return u}
  async function consume(u,x){if(open(u,x))return{ok:true};const n=Math.max(0,Number(u.paidSingleCredits||0));if(n<=0)return{ok:false,error:'No PDF credits remaining.'};const s=getSupabase();if(!s)return{ok:false,error:'Authentication service is unavailable.'};const ids=[...new Set([...(u.unlockedInvoiceIds||[]).map(String),String(x)])];const r=await s.auth.updateUser({data:{freePdfCredits:Number(u.freePdfCredits||0),paidSingleCredits:n-1,singleCredits:Number(u.freePdfCredits||0)+n-1,unlockedInvoiceIds:ids}});if(r.error)return{ok:false,error:r.error.message||'Could not save PDF entitlement.'};u.paidSingleCredits=n-1;u.singleCredits=Number(u.freePdfCredits||0)+n-1;u.unlockedInvoiceIds=ids;saveCurrentUser(u);return{ok:true}}
  function install(){
    const originalPDF=window.downloadPDF;
    const originalPrint=window.printInvoice;
    if(typeof originalPDF==='function')window.downloadPDF=async()=>{const u=await user();if(!u){showToast('Please sign in again.','error');return}const x=id(),need=!open(u,x)&&!free()&&u.plan!=='lifetime';if(need&&Number(u.paidSingleCredits||0)<=0){showToast('No PDF credits remaining. Please purchase a PDF credit or Lifetime Access.','error',5000);return}if(need){const q=await consume(u,x);if(!q.ok){showToast(q.error,'error',5000);return}}return originalPDF()};
    if(typeof originalPrint==='function')window.printInvoice=async()=>{const u=await user();if(!u){showToast('Please sign in again.','error');return}const x=id(),need=!open(u,x)&&!free()&&u.plan!=='lifetime';if(need){const q=await consume(u,x);if(!q.ok){showToast(q.error,'error',5000);return}}return originalPrint()};
    console.log('[FineInvoice] entitlement gate v3 active');
  }
  window.addEventListener('load',()=>setTimeout(install,0),{once:true});
})();

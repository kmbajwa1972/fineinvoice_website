// ── Supabase Client ──
const SUPABASE_URL = 'https://mozllscpvaxdigatsxiu.supabase.co';
const SUPABASE_KEY = 'sb_publishable_r_O7AsGp8D91rDquxrCJrw_7OMCI6kG';

function getSupabase(){
  if(window._supabase) return window._supabase;
  if(window.supabase && window.supabase.createClient){
    window._supabase=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
    return window._supabase;
  }
  return null;
}
function safeJsonParse(value,fallback){try{return value?JSON.parse(value):fallback;}catch(err){console.warn('FineInvoice storage reset:',err);return fallback;}}
function escapeHtml(str){return String(str??'').replace(/[&<>\"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[ch]));}
function getCustomers(){return safeJsonParse(localStorage.getItem('fi_customers'),[])}
function getInvoices(){return safeJsonParse(localStorage.getItem('fi_invoices'),[])}
function getLicense(){return safeJsonParse(localStorage.getItem('fi_license'),{})}

function normalizePlanUser(user){
  if(!user||typeof user!=='object') return user;
  const plan=String(user.plan||'free').toLowerCase();
  if(!['free','single','lifetime'].includes(plan)) user.plan='free';
  user.plan=plan;
  user.freePdfCredits=Number.isFinite(Number(user.freePdfCredits))?Math.max(0,Number(user.freePdfCredits)):(Number.isFinite(Number(user.singleCredits))?Math.max(0,Number(user.singleCredits)):3);
  user.paidSingleCredits=Math.max(0,Number(user.paidSingleCredits||0));
  user.unlockedInvoiceIds=Array.isArray(user.unlockedInvoiceIds)?[...new Set(user.unlockedInvoiceIds.map(String))]:[];
  user.singleCredits=user.freePdfCredits;
  return user;
}
function getCurrentUser(){const user=safeJsonParse(localStorage.getItem('fi_current_user'),null);const normalized=normalizePlanUser(user);if(normalized)localStorage.setItem('fi_current_user',JSON.stringify(normalized));return normalized;}
function getUsers(){return safeJsonParse(localStorage.getItem('fi_users'),[])}
function saveCustomers(d){localStorage.setItem('fi_customers',JSON.stringify(Array.isArray(d)?d:[]))}
function saveInvoices(d){localStorage.setItem('fi_invoices',JSON.stringify(Array.isArray(d)?d:[]))}
function saveLicense(d){localStorage.setItem('fi_license',JSON.stringify(d&&typeof d==='object'?d:{}))}
function saveCurrentUser(u){if(u)localStorage.setItem('fi_current_user',JSON.stringify(normalizePlanUser(u)));else localStorage.removeItem('fi_current_user')}

function applyRemoteEntitlementUser(remoteUser){
  if(!remoteUser)return false;
  const meta=remoteUser.user_metadata||{};
  const previous=getCurrentUser()||{};
  const plan=['free','single','lifetime'].includes(String(meta.plan||previous.plan||'free').toLowerCase())?String(meta.plan||previous.plan||'free').toLowerCase():'free';
  const freeRaw=meta.freePdfCredits??previous.freePdfCredits??meta.singleCredits??previous.singleCredits??3;
  const paidRaw=meta.paidSingleCredits??previous.paidSingleCredits??0;
  const free=Math.max(0,Number(freeRaw)||0);
  const paid=Math.max(0,Number(paidRaw)||0);
  const next={...previous,id:remoteUser.id,email:remoteUser.email||previous.email||'',name:meta.name||previous.name||remoteUser.email||'User',plan,planVerified:meta.planVerified===true,paymentProvider:meta.paymentProvider||previous.paymentProvider||null,plan_activated_at:meta.plan_activated_at||previous.plan_activated_at||null,freePdfCredits:free,paidSingleCredits:paid,singleCredits:free,unlockedInvoiceIds:Array.isArray(meta.unlockedInvoiceIds)?[...new Set(meta.unlockedInvoiceIds.map(String))]:(previous.unlockedInvoiceIds||[]),whatsapp:meta.whatsapp||previous.whatsapp||null};
  const changed=String(previous.plan||'free')!==plan||Number(previous.freePdfCredits??previous.singleCredits??3)!==free||Number(previous.paidSingleCredits||0)!==paid||JSON.stringify(previous.unlockedInvoiceIds||[])!==JSON.stringify(next.unlockedInvoiceIds||[]);
  saveCurrentUser(next);
  if(changed){
    window.dispatchEvent(new CustomEvent('fineinvoice:entitlement-updated',{detail:{user:next,plan,freePdfCredits:free,paidSingleCredits:paid}}));
  }
  return changed;
}

let fineInvoiceEntitlementTimer=null;
async function syncEntitlementsNow(){
  const sb=getSupabase();
  if(!sb)return false;
  try{
    const{data,error}=await sb.auth.getUser();
    if(error||!data?.user)return false;
    return applyRemoteEntitlementUser(data.user);
  }catch(error){
    console.warn('FineInvoice entitlement sync failed:',error);
    return false;
  }
}

function startEntitlementSync(){
  if(window.__fineInvoiceEntitlementSyncStarted)return;
  window.__fineInvoiceEntitlementSyncStarted=true;
  syncEntitlementsNow();
  fineInvoiceEntitlementTimer=setInterval(syncEntitlementsNow,2000);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')syncEntitlementsNow()});
  window.addEventListener('focus',syncEntitlementsNow);
}

function stopEntitlementSync(){
  if(fineInvoiceEntitlementTimer){clearInterval(fineInvoiceEntitlementTimer);fineInvoiceEntitlementTimer=null;}
  window.__fineInvoiceEntitlementSyncStarted=false;
}

function requireAuth(redirect='signin.html'){const user=getCurrentUser();if(!user){window.location.href=redirect;return null}return user}
function requirePlan(user,minPlan,featureName){const order={free:0,single:1,lifetime:2};const userLevel=order[String(user?.plan||'free').toLowerCase()]??0;const required=order[minPlan]??1;if(userLevel>=required)return true;const label=minPlan==='lifetime'?'Lifetime ($25)':'Single ($2) or higher';showToast(`${featureName} requires ${label} plan. Upgrade in Billing.`,'error',5000);return false}

const EMAILJS_SERVICE='service_xkh5qjd';
const EMAILJS_TEMPLATE='template_invoice_send';
const EMAILJS_PUBLIC='ypfhAplPP-LZxq9zy';
async function sendInvoiceByEmail(toEmail,toName,fromName,invNumber,pdfBase64){if(!window.emailjs)return{error:'EmailJS not loaded'};try{return{data:await emailjs.send(EMAILJS_SERVICE,EMAILJS_TEMPLATE,{to_email:toEmail,to_name:toName,from_name:fromName,inv_number:invNumber,pdf_base64:pdfBase64||''},EMAILJS_PUBLIC)}}catch(err){return{error:err}}}
function logout(){localStorage.removeItem('fi_current_user');const sb=getSupabase();if(sb)sb.auth.signOut().finally(()=>{window.location.href='index.html'});else window.location.href='index.html'}
function showToast(msg,type='info',duration=3000){let c=document.getElementById('toast-container');if(!c){c=document.createElement('div');c.id='toast-container';c.className='toast-container';document.body.appendChild(c)}const t=document.createElement('div'),icons={success:'✅',error:'❌',info:'💡'};t.className=`toast ${type}`;const icon=document.createElement('span');icon.textContent=icons[type]||'💡';const text=document.createElement('span');text.textContent=String(msg??'');t.append(icon,text);c.appendChild(t);setTimeout(()=>{t.style.opacity='0';t.style.transform='translateX(120%)';t.style.transition='.3s';setTimeout(()=>t.remove(),300)},duration)}
function renderUserChip(containerId){const user=getCurrentUser(),el=document.getElementById(containerId);if(!el||!user)return;const initials=(user.name||user.email||'U').split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);const plan=String(user.plan||'free').toUpperCase();const planColor=plan==='LIFETIME'?'#B76E00':plan==='SINGLE'?'#00C48C':'#6C3FF5';const planBg=plan==='LIFETIME'?'rgba(255,181,0,.15)':plan==='SINGLE'?'rgba(0,196,140,.15)':'rgba(108,63,245,.15)';el.innerHTML=`<div class="user-chip"><div class="avatar">${escapeHtml(initials)}</div><span>${escapeHtml(user.name||user.email||'User')}</span></div><span class="badge" style="background:${planBg};color:${planColor};border-radius:99px;padding:3px 10px;font-size:11px;font-weight:700">${plan}</span>`;if(!el.dataset.fineInvoiceEntitlementListener){el.dataset.fineInvoiceEntitlementListener='1';window.addEventListener('fineinvoice:entitlement-updated',()=>renderUserChip(containerId))}}
async function submitPaymentSubmission(sub){const sb=getSupabase();if(!sb)return{error:{message:'Database unavailable'}};const{error}=await sb.from('payment_submissions').insert([sub]);return{error}}
async function checkUnlockCode(code){const sb=getSupabase();if(!sb)return{error:{message:'Database unavailable'}};const{data,error}=await sb.rpc('redeem_unlock_code',{p_code:code});if(error)return{error};return{data:Array.isArray(data)?data[0]:data}}
async function markCodeUsed(id,code){const sb=getSupabase();if(sb)await sb.rpc('mark_unlock_code_used',{p_id:id,p_code:code})}
async function callAdminPayments(action,extra={}){const sb=getSupabase();if(!sb)return{error:{message:'Database unavailable'}};const{data:sd}=await sb.auth.getSession(),token=sd?.session?.access_token;if(!token)return{error:{message:'Not signed in'}};try{const res=await fetch(`${SUPABASE_URL}/functions/v1/admin-payments`,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},body:JSON.stringify({action,...extra})});const body=await res.json();if(!res.ok)return{error:{message:body.error||'Request failed'}};return body}catch(err){return{error:{message:err.message||'Network error'}}}}
async function getAllSubmissions(){return callAdminPayments('list')}
async function verifySubmissionAndIssueCode(id){return callAdminPayments('verify',{id})}

function hasInvoiceAccess(user,invoiceId){
  if(!user)return false;
  const plan=String(user.plan||'free').toLowerCase();
  if(plan==='lifetime')return true;
  if((user.unlockedInvoiceIds||[]).includes(String(invoiceId)))return true;
  return Number(user.freePdfCredits||user.singleCredits||0)>0||Number(user.paidSingleCredits||0)>0;
}

async function getAuthenticatedUser(){
  const sb=getSupabase();
  if(!sb)return{user:null,error:'Authentication service is unavailable.'};
  let{data,error}=await sb.auth.getSession();
  if(error)return{user:null,error:error.message||'Unable to read authentication session.'};
  if(!data?.session){
    try{const refreshed=await sb.auth.refreshSession();data=refreshed.data;error=refreshed.error}catch(e){error=e}
  }
  if(error||!data?.session?.user)return{user:null,error:'Your authentication session is missing or expired. Please sign in again.'};
  return{user:data.session.user,error:null};
}

async function consumeInvoiceCredit(user,invoiceId){
  if(!user||!invoiceId)return{ok:false,error:'Authentication is required.'};
  const plan=String(user.plan||'free').toLowerCase();
  if(plan==='lifetime')return{ok:true,unlimited:true};
  const id=String(invoiceId);
  const unlocked=Array.isArray(user.unlockedInvoiceIds)?user.unlockedInvoiceIds.map(String):[];
  if(unlocked.includes(id))return{ok:true,alreadyUnlocked:true};

  const free=Math.max(0,Number(user.freePdfCredits??user.singleCredits??0));
  const paid=Math.max(0,Number(user.paidSingleCredits||0));
  let nextFree=free,nextPaid=paid;
  if(free>0)nextFree=free-1;
  else if(paid>0)nextPaid=paid-1;
  else return{ok:false,error:'No PDF credits remaining.'};

  const nextUnlocked=[...new Set([...unlocked,id])];
  const sb=getSupabase();
  if(!sb)return{ok:false,error:'Authentication service is unavailable.'};

  let sessionData=await sb.auth.getSession();
  if(!sessionData.data?.session){
    const refreshed=await sb.auth.refreshSession();
    sessionData=refreshed;
  }
  if(!sessionData.data?.session){return{ok:false,error:'Your authentication session is missing or expired. Please sign in again.'};}

  const metadata={freePdfCredits:nextFree,paidSingleCredits:nextPaid,singleCredits:nextFree,unlockedInvoiceIds:nextUnlocked};
  const{data,error}=await sb.auth.updateUser({data:metadata});
  if(error)return{ok:false,error:error.message||'Could not save your PDF credit.'};

  const authMeta=data?.user?.user_metadata||{};
  user.freePdfCredits=Number(authMeta.freePdfCredits??nextFree);
  user.paidSingleCredits=Number(authMeta.paidSingleCredits??nextPaid);
  user.singleCredits=user.freePdfCredits;
  user.unlockedInvoiceIds=Array.isArray(authMeta.unlockedInvoiceIds)?authMeta.unlockedInvoiceIds:nextUnlocked;
  saveCurrentUser(user);
  return{ok:true,usedFree:free>0,usedPaid:free<=0&&paid>0,freePdfCredits:user.freePdfCredits,paidSingleCredits:user.paidSingleCredits};
}

function normalizeWhatsappNumber(raw){let d=String(raw).replace(/\D/g,'');if(d.startsWith('00'))d=d.slice(2);return d}
async function sendWhatsAppCode(){return{error:'Unlock-code delivery is disabled. Polar payments activate plans automatically.'}}
async function notifyAdminNewSubmission(){return{error:'Manual payment notifications are disabled.'}}
const ADMIN_WHATSAPP_NUMBER='';
function setActiveNav(){const page=window.location.pathname.split('/').pop();document.querySelectorAll('.sidebar-nav a').forEach(a=>{if(a.getAttribute('href')===page)a.classList.add('active')})}

// ── PDF / Print access gate ──
window.addEventListener('DOMContentLoaded',()=>{
  const originalPrint=window.printInvoice;
  const originalPDF=window.downloadPDF;
  async function loadGateUser(){
    let user=getCurrentUser();
    const auth=await getAuthenticatedUser();
    if(auth.user){
      const a=auth.user,m=a.user_metadata||{};
      const plan=String(m.plan||user?.plan||'free').toLowerCase();
      user={...(user||{}),id:a.id,email:a.email||user?.email||'',name:m.name||user?.name||a.email||'User',plan:['free','single','lifetime'].includes(plan)?plan:'free',planVerified:m.planVerified===true, paymentProvider:m.paymentProvider||null,freePdfCredits:Number(m.freePdfCredits??m.singleCredits??user?.freePdfCredits??user?.singleCredits??3),paidSingleCredits:Number(m.paidSingleCredits??user?.paidSingleCredits??0),singleCredits:Number(m.freePdfCredits??m.singleCredits??user?.freePdfCredits??user?.singleCredits??3),unlockedInvoiceIds:Array.isArray(m.unlockedInvoiceIds)?m.unlockedInvoiceIds:(user?.unlockedInvoiceIds||[])};
      saveCurrentUser(user);
      return{user,error:null};
    }
    return{user,error:auth.error};
  }
  if(typeof originalPrint==='function'){
    window.printInvoice=async function(){
      const loaded=await loadGateUser();
      if(!loaded.user){showToast(loaded.error||'Please sign in again.','error');return;}
      const user=loaded.user;
      const invoiceId=typeof currentDraftId!=='undefined'?String(currentDraftId):('draft-'+Date.now());
      if(!hasInvoiceAccess(user,invoiceId)){
        if(confirm('Your free PDF credits have been used.\n\nSingle: $2 per invoice\nor Lifetime: $25 unlimited.\n\nGo to Billing?'))location.href='payment.html';
        return;
      }
      if(String(user.plan||'free').toLowerCase()!=='lifetime'&&!(user.unlockedInvoiceIds||[]).includes(invoiceId)){
        const r=await consumeInvoiceCredit(user,invoiceId);if(!r.ok){showToast(r.error||'Could not save your PDF credit.','error');return;}
      }
      document.body.classList.add('print-mode');window.print();setTimeout(()=>document.body.classList.remove('print-mode'),500);
    };
  }
  if(typeof originalPDF==='function'){
    window.downloadPDF=async function(){
      const loaded=await loadGateUser();
      if(!loaded.user){showToast(loaded.error||'Please sign in again.','error');return;}
      const user=loaded.user;
      const invoiceId=typeof currentDraftId!=='undefined'?String(currentDraftId):('draft-'+Date.now());
      if(!hasInvoiceAccess(user,invoiceId)){
        if(confirm('Your free PDF credits have been used.\n\nSingle: $2 per invoice\nor Lifetime: $25 unlimited.\n\nGo to Billing?'))location.href='payment.html';
        return;
      }
      const alreadyUnlocked=String(user.plan||'free').toLowerCase()==='lifetime'||(user.unlockedInvoiceIds||[]).includes(invoiceId);
      showToast('Generating PDF…','info');
      try{
        const el=document.getElementById('invoiceDoc');
        if(!el)throw new Error('Invoice preview not found');
        const previousHeight=el.style.height,previousOverflow=el.style.overflow;
        el.style.height='auto';el.style.overflow='visible';
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const canvas=await html2canvas(el,{scale:2,useCORS:true,backgroundColor:'#ffffff',width:el.scrollWidth,height:el.scrollHeight,windowWidth:Math.max(document.documentElement.clientWidth,el.scrollWidth),windowHeight:Math.max(window.innerHeight,el.scrollHeight),scrollX:0,scrollY:-window.scrollY});
        el.style.height=previousHeight;el.style.overflow=previousOverflow;
        const{jsPDF}=window.jspdf,doc=new jsPDF({orientation:'portrait',unit:'mm',format:'a4'}),pageW=doc.internal.pageSize.getWidth(),pageH=doc.internal.pageSize.getHeight(),imgH=(canvas.height*pageW)/canvas.width;
        let renderedHeight=0;
        while(renderedHeight<imgH-0.01){
          const sliceHeight=Math.min(pageH,imgH-renderedHeight);
          const sourceY=Math.floor((renderedHeight*canvas.width)/pageW);
          const sourceHeight=Math.max(1,Math.min(canvas.height-sourceY,Math.floor((sliceHeight*canvas.width)/pageW)));
          const sliceCanvas=document.createElement('canvas');sliceCanvas.width=canvas.width;sliceCanvas.height=sourceHeight;
          const ctx=sliceCanvas.getContext('2d');if(!ctx)throw new Error('PDF canvas unavailable');
          ctx.fillStyle='#ffffff';ctx.fillRect(0,0,sliceCanvas.width,sliceCanvas.height);
          ctx.drawImage(canvas,0,sourceY,canvas.width,sourceHeight,0,0,canvas.width,sourceHeight);
          if(renderedHeight>0)doc.addPage();
          doc.addImage(sliceCanvas.toDataURL('image/png'),'PNG',0,0,pageW,(sourceHeight*pageW)/canvas.width);
          renderedHeight+=sliceHeight;
        }
        const invNum=document.getElementById('invNumber').value||'invoice';doc.save(invNum+'.pdf');
        if(!alreadyUnlocked&&String(user.plan||'free').toLowerCase()!=='lifetime'){
          const r=await consumeInvoiceCredit(user,invoiceId);if(!r.ok){showToast(r.error||'Could not save PDF credit','error');return;}
        }
        const dl=parseInt(localStorage.getItem('fi_downloads')||'0')+1;localStorage.setItem('fi_downloads',dl);showToast('PDF downloaded! 🎉','success');
      }catch(e){console.error(e);showToast('PDF generation failed. Your PDF credit was not used.','error');}
    };
  }
});


window.addEventListener('DOMContentLoaded',startEntitlementSync);

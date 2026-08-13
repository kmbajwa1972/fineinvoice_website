// ── Supabase Client ──
const SUPABASE_URL = 'https://mozllscpvaxdigatsxiu.supabase.co';
const SUPABASE_KEY = 'sb_publishable_r_O7AsGp8D91rDquxrCJrw_7OMCI6kG';

function getSupabase() {
  if(window._supabase) return window._supabase;
  if(window.supabase && window.supabase.createClient) {
    window._supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession:true, autoRefreshToken:true, detectSessionInUrl:true }
    });
    return window._supabase;
  }
  return null;
}

function safeJsonParse(value,fallback){
  try{return value ? JSON.parse(value) : fallback;}catch(err){console.warn('FineInvoice storage reset:',err);return fallback;}
}

function escapeHtml(str){
  return String(str ?? '').replace(/[&<>\"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[ch]));
}

function getCustomers(){ return safeJsonParse(localStorage.getItem('fi_customers'),[]); }
function getInvoices(){ return safeJsonParse(localStorage.getItem('fi_invoices'),[]); }
function getLicense(){ return safeJsonParse(localStorage.getItem('fi_license'),{}); }
function getCurrentUser(){ return safeJsonParse(localStorage.getItem('fi_current_user'),null); }
function getUsers(){ return safeJsonParse(localStorage.getItem('fi_users'),[]); }
function saveCustomers(d){ localStorage.setItem('fi_customers',JSON.stringify(Array.isArray(d)?d:[])); }
function saveInvoices(d){ localStorage.setItem('fi_invoices',JSON.stringify(Array.isArray(d)?d:[])); }
function saveLicense(d){ localStorage.setItem('fi_license',JSON.stringify(d&&typeof d==='object'?d:{})); }
function saveCurrentUser(u){ if(u)localStorage.setItem('fi_current_user',JSON.stringify(u));else localStorage.removeItem('fi_current_user'); }

function requireAuth(redirect='signin.html'){
  const user=getCurrentUser();
  if(!user){ window.location.href=redirect; return null; }
  return user;
}

function requirePlan(user,minPlan,featureName){
  const order={free:0,single:1,lifetime:2};
  const userLevel=order[String(user?.plan||'free').toLowerCase()]??0;
  const required=order[minPlan]??1;
  if(userLevel>=required)return true;
  const label=minPlan==='lifetime'?'Lifetime ($25)':'Single ($2) or higher';
  showToast(`${featureName} requires ${label} plan. Upgrade in Billing.`,'error',5000);
  return false;
}

const EMAILJS_SERVICE='service_xkh5qjd';
const EMAILJS_TEMPLATE='template_invoice_send';
const EMAILJS_PUBLIC='ypfhAplPP-LZxq9zy';
async function sendInvoiceByEmail(toEmail,toName,fromName,invNumber,pdfBase64){
  if(!window.emailjs)return{error:'EmailJS not loaded'};
  try{return{data:await emailjs.send(EMAILJS_SERVICE,EMAILJS_TEMPLATE,{to_email:toEmail,to_name:toName,from_name:fromName,inv_number:invNumber,pdf_base64:pdfBase64||''},EMAILJS_PUBLIC)}}catch(err){return{error:err};}
}

function logout(){
  localStorage.removeItem('fi_current_user');
  const sb=getSupabase();
  if(sb)sb.auth.signOut().finally(()=>{window.location.href='index.html';});
  else window.location.href='index.html';
}

function showToast(msg,type='info',duration=3000){
  let c=document.getElementById('toast-container');
  if(!c){c=document.createElement('div');c.id='toast-container';c.className='toast-container';document.body.appendChild(c);}
  const t=document.createElement('div'),icons={success:'✅',error:'❌',info:'💡'};
  t.className=`toast ${type}`;
  const icon=document.createElement('span');icon.textContent=icons[type]||'💡';
  const text=document.createElement('span');text.textContent=String(msg??'');
  t.append(icon,text);c.appendChild(t);
  setTimeout(()=>{t.style.opacity='0';t.style.transform='translateX(120%)';t.style.transition='.3s';setTimeout(()=>t.remove(),300);},duration);
}

function renderUserChip(containerId){
  const user=getCurrentUser(),el=document.getElementById(containerId);if(!el||!user)return;
  const initials=(user.name||user.email||'U').split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
  const plan=String(user.plan||'free').toUpperCase();
  const planColor=plan==='LIFETIME'?'#B76E00':plan==='SINGLE'?'#00C48C':'#6C3FF5';
  const planBg=plan==='LIFETIME'?'rgba(255,181,0,.15)':plan==='SINGLE'?'rgba(0,196,140,.15)':'rgba(108,63,245,.15)';
  el.innerHTML=`<div class="user-chip"><div class="avatar">${escapeHtml(initials)}</div><span>${escapeHtml(user.name||user.email||'User')}</span></div><span class="badge" style="background:${planBg};color:${planColor};border-radius:99px;padding:3px 10px;font-size:11px;font-weight:700">${plan}</span>`;
}

async function submitPaymentSubmission(sub){
  const sb=getSupabase();if(!sb)return{error:{message:'Database unavailable'}};
  const{error}=await sb.from('payment_submissions').insert([sub]);return{error};
}
async function checkUnlockCode(code){
  const sb=getSupabase();if(!sb)return{error:{message:'Database unavailable'}};
  const{data,error}=await sb.rpc('redeem_unlock_code',{p_code:code});if(error)return{error};
  return{data:Array.isArray(data)?data[0]:data};
}
async function markCodeUsed(id,code){const sb=getSupabase();if(sb)await sb.rpc('mark_unlock_code_used',{p_id:id,p_code:code});}

async function callAdminPayments(action,extra={}){
  const sb=getSupabase();if(!sb)return{error:{message:'Database unavailable'}};
  const{data:sd}=await sb.auth.getSession(),token=sd?.session?.access_token;if(!token)return{error:{message:'Not signed in'}};
  try{const res=await fetch(`${SUPABASE_URL}/functions/v1/admin-payments`,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},body:JSON.stringify({action,...extra})});const body=await res.json();if(!res.ok)return{error:{message:body.error||'Request failed'}};return body;}catch(err){return{error:{message:err.message||'Network error'}};}
}
async function getAllSubmissions(){return callAdminPayments('list');}
async function verifySubmissionAndIssueCode(id){return callAdminPayments('verify',{id});}

function hasInvoiceAccess(user,invoiceId){
  if(!user)return false;
  const plan=String(user.plan||'free').toLowerCase();
  if(plan==='lifetime')return true;
  if((user.unlockedInvoiceIds||[]).includes(invoiceId))return true;
  return Number(user.singleCredits||0)>0;
}

async function consumeInvoiceCredit(user,invoiceId){
  if(!user||String(user.plan||'free').toLowerCase()==='lifetime')return{ok:true};
  const unlocked=Array.isArray(user.unlockedInvoiceIds)?user.unlockedInvoiceIds:[];
  if(unlocked.includes(invoiceId))return{ok:true,alreadyUnlocked:true};
  const credits=Number(user.singleCredits||0);
  if(credits<=0)return{ok:false,error:'No free PDF credits remaining'};
  const nextCredits=credits-1,nextUnlocked=[...unlocked,invoiceId];
  const sb=getSupabase();
  if(sb){const{error}=await sb.auth.updateUser({data:{singleCredits:nextCredits,unlockedInvoiceIds:nextUnlocked}});if(error)return{ok:false,error:error.message};}
  user.singleCredits=nextCredits;user.unlockedInvoiceIds=nextUnlocked;saveCurrentUser(user);
  return{ok:true};
}

// ── Remove old Green-API delivery; payment notifications remain database/admin based. ──
function normalizeWhatsappNumber(raw){let d=String(raw).replace(/\D/g,'');if(d.startsWith('00'))d=d.slice(2);return d;}
async function sendWhatsAppCode(){return{error:'WhatsApp delivery is disabled.'};}
async function notifyAdminNewSubmission(){return{error:'WhatsApp admin alerts are disabled.'};}
const ADMIN_WHATSAPP_NUMBER='';

function setActiveNav(){const page=window.location.pathname.split('/').pop();document.querySelectorAll('.sidebar-nav a').forEach(a=>{if(a.getAttribute('href')===page)a.classList.add('active');});}

// ── PDF / Print repair ──
// app.html defines its own handlers after this file loads. We therefore wrap
// those handlers after DOMContentLoaded, changing only the access/credit gate.
window.addEventListener('DOMContentLoaded',()=>{
  const originalPrint=window.printInvoice;
  const originalPDF=window.downloadPDF;
  if(typeof originalPrint==='function'){
    window.printInvoice=async function(){
      const sb=getSupabase();
      let user=getCurrentUser();
      if(sb){
        try{
          const{data,error}=await sb.auth.getSession();
          if(!error&&data?.session?.user){
            const a=data.session.user,m=a.user_metadata||{};
            const authPlan=String(m.plan||'free').toLowerCase();
            user={...(user||{}),id:a.id,email:a.email||user?.email||'',name:m.name||user?.name||a.email||'User',plan:(authPlan==='lifetime'||authPlan==='single')?authPlan:'free',singleCredits:Number(m.singleCredits??user?.singleCredits??3),unlockedInvoiceIds:Array.isArray(m.unlockedInvoiceIds)?m.unlockedInvoiceIds:(user?.unlockedInvoiceIds||[])};
            saveCurrentUser(user);
          }
        }catch(e){console.warn('Auth refresh failed:',e);}
      }
      const invoiceId=typeof currentDraftId!=='undefined'?currentDraftId:('draft-'+Date.now());
      if(!hasInvoiceAccess(user,invoiceId)){
        if(confirm('Your 3 free PDF credits have been used.\n\nSingle: $2 per invoice\nor Lifetime: $25 unlimited.\n\nGo to Billing?'))location.href='payment.html';
        return;
      }
      if(String(user?.plan||'free').toLowerCase()!=='lifetime'&&!(user.unlockedInvoiceIds||[]).includes(invoiceId)){
        const r=await consumeInvoiceCredit(user,invoiceId);if(!r.ok){showToast(r.error||'No free PDF credits remaining','error');return;}
      }
      document.body.classList.add('print-mode');window.print();setTimeout(()=>document.body.classList.remove('print-mode'),500);
    };
  }
  if(typeof originalPDF==='function'){
    window.downloadPDF=async function(){
      const sb=getSupabase();
      let user=getCurrentUser();
      if(sb){
        try{
          const{data,error}=await sb.auth.getSession();
          if(!error&&data?.session?.user){
            const a=data.session.user,m=a.user_metadata||{};
            const authPlan=String(m.plan||'free').toLowerCase();
            user={...(user||{}),id:a.id,email:a.email||user?.email||'',name:m.name||user?.name||a.email||'User',plan:(authPlan==='lifetime'||authPlan==='single')?authPlan:'free',singleCredits:Number(m.singleCredits??user?.singleCredits??3),unlockedInvoiceIds:Array.isArray(m.unlockedInvoiceIds)?m.unlockedInvoiceIds:(user?.unlockedInvoiceIds||[])};
            saveCurrentUser(user);
          }
        }catch(e){console.warn('Auth refresh failed:',e);}
      }
      const invoiceId=typeof currentDraftId!=='undefined'?currentDraftId:('draft-'+Date.now());
      if(!hasInvoiceAccess(user,invoiceId)){
        if(confirm('Your 3 free PDF credits have been used.\n\nSingle: $2 per invoice\nor Lifetime: $25 unlimited.\n\nGo to Billing?'))location.href='payment.html';
        return;
      }
      const alreadyUnlocked=String(user?.plan||'free').toLowerCase()==='lifetime'||(user.unlockedInvoiceIds||[]).includes(invoiceId);
      showToast('Generating PDF…','info');
      try{
        const el=document.getElementById('invoiceDoc');
        const canvas=await html2canvas(el,{scale:2,useCORS:true,backgroundColor:'#ffffff'});
        const{jsPDF}=window.jspdf;const doc=new jsPDF({orientation:'portrait',unit:'mm',format:'a4'});
        const imgData=canvas.toDataURL('image/png');const pageW=doc.internal.pageSize.getWidth();const pageH=(canvas.height*pageW)/canvas.width;
        doc.addImage(imgData,'PNG',0,0,pageW,pageH);
        const invNum=document.getElementById('invNumber').value||'invoice';doc.save(invNum+'.pdf');
        if(!alreadyUnlocked&&String(user?.plan||'free').toLowerCase()!=='lifetime'){
          const r=await consumeInvoiceCredit(user,invoiceId);if(!r.ok){showToast(r.error||'Could not save free PDF credit','error');return;}
        }
        const dl=parseInt(localStorage.getItem('fi_downloads')||'0')+1;localStorage.setItem('fi_downloads',dl);
        showToast('PDF downloaded! 🎉','success');
      }catch(e){console.error(e);showToast('PDF generation failed. Your free credit was not used.','error');}
    };
  }
});

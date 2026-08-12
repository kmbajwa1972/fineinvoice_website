// FineInvoice shared utilities
// IMPORTANT: keep the Supabase anon key here only; never place service-role or
// third-party secret keys in browser JavaScript.
const SUPABASE_URL = 'https://mozllscpvaxdigatsxiu.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1vemxsc2NwdmF4ZGlnYXRzeGl1IiwiaWF0IjoxNzgyNDAwMDk1LCJleHAiOjIwOTc5NzYwOTl9.-DS2gRmOQVUilEPljbUbffNikr9BK8IEg3iGD319RDk';

function getSupabase(){
  if(window._supabase) return window._supabase;
  if(window.supabase?.createClient){
    window._supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
    return window._supabase;
  }
  return null;
}
function readJSON(key,fallback){try{return JSON.parse(localStorage.getItem(key) ?? JSON.stringify(fallback));}catch{return fallback;}}
function getCustomers(){return readJSON('fi_customers',[]);}
function getInvoices(){return readJSON('fi_invoices',[]);}
function getLicense(){return readJSON('fi_license',{});}
function getCurrentUser(){return readJSON('fi_current_user',null);}
function getUsers(){return readJSON('fi_users',[]);}
function saveCustomers(d){localStorage.setItem('fi_customers',JSON.stringify(d));}
function saveInvoices(d){localStorage.setItem('fi_invoices',JSON.stringify(d));}
function saveLicense(d){localStorage.setItem('fi_license',JSON.stringify(d));}
function saveCurrentUser(u){if(u)localStorage.setItem('fi_current_user',JSON.stringify(u));else localStorage.removeItem('fi_current_user');}

function userFromSession(session){
  const u=session?.user;if(!u)return null;const m=u.user_metadata||{};
  return {id:u.id,email:u.email||'',name:m.name||u.email?.split('@')[0]||'User',plan:m.plan||'free',singleCredits:Number(m.singleCredits??3),unlockedInvoiceIds:Array.isArray(m.unlockedInvoiceIds)?m.unlockedInvoiceIds:[]};
}
async function getAuthUser(){
  const sb=getSupabase();if(!sb)return null;const {data,error}=await sb.auth.getSession();
  if(error||!data.session)return null;const u=userFromSession(data.session);if(u)saveCurrentUser(u);return u;
}
async function requireAuthAsync(redirect='signin.html'){const u=await getAuthUser();if(!u){window.location.href=redirect;return null;}return u;}
function requireAuth(redirect='signin.html'){
  const local=getCurrentUser(),sb=getSupabase();
  if(!sb){if(!local)window.location.href=redirect;return local;}
  sb.auth.getSession().then(({data})=>{const remote=userFromSession(data?.session);if(!remote){saveCurrentUser(null);window.location.href=redirect;return;}saveCurrentUser(remote);}).catch(()=>{if(!local)window.location.href=redirect;});
  if(!local&&!location.pathname.endsWith(redirect)){window.location.href=redirect;return null;}return local;
}
async function syncPlanFromSupabase(){return await getAuthUser();}
const PLAN_ORDER={free:0,single:1,lifetime:2};
function requirePlan(user,minPlan,featureName){const level=PLAN_ORDER[user?.plan||'free']??0,required=PLAN_ORDER[minPlan]??1;if(level>=required)return true;const label=minPlan==='lifetime'?'Lifetime ($25)':'Single ($2) or higher';showToast(`${featureName} requires ${label} plan. Upgrade in Billing.`,'error',5000);return false;}

async function dbSelect(table,query={}){const sb=getSupabase();if(!sb)return{data:null,error:{message:'Supabase unavailable'}};let q=sb.from(table).select(query.select||'*');for(const[k,v]of Object.entries(query.eq||{}))q=q.eq(k,v);if(query.order)q=q.order(query.order.column,{ascending:query.order.ascending!==false});return await q;}
async function dbInsert(table,row){const sb=getSupabase();if(!sb)return{data:null,error:{message:'Supabase unavailable'}};return await sb.from(table).insert(row).select().single();}
async function dbUpdate(table,id,row){const sb=getSupabase();if(!sb)return{data:null,error:{message:'Supabase unavailable'}};return await sb.from(table).update(row).eq('id',id).select().single();}
async function dbDelete(table,id){const sb=getSupabase();if(!sb)return{data:null,error:{message:'Supabase unavailable'}};return await sb.from(table).delete().eq('id',id);}

async function getCloudCustomers(){const u=await getAuthUser();if(!u)return{data:[],error:{message:'Not authenticated'}};return dbSelect('customers',{eq:{user_id:u.id},order:{column:'created_at',ascending:false}});}
async function getCloudInvoices(){const u=await getAuthUser();if(!u)return{data:[],error:{message:'Not authenticated'}};return dbSelect('invoices',{eq:{user_id:u.id},order:{column:'created_at',ascending:false}});}
async function createCloudCustomer(customer){const u=await getAuthUser();if(!u)return{data:null,error:{message:'Not authenticated'}};return dbInsert('customers',{...customer,user_id:u.id});}
async function updateCloudCustomer(id,customer){return dbUpdate('customers',id,customer);}
async function deleteCloudCustomer(id){return dbDelete('customers',id);}
async function createCloudInvoice(invoice){const u=await getAuthUser();if(!u)return{data:null,error:{message:'Not authenticated'}};return dbInsert('invoices',{...invoice,user_id:u.id});}
async function updateCloudInvoice(id,invoice){return dbUpdate('invoices',id,invoice);}
async function deleteCloudInvoice(id){return dbDelete('invoices',id);}

// Friendly names used by migrated pages.
async function getCustomersAsync(){const r=await getCloudCustomers();if(!r.error)localStorage.setItem('fi_customers',JSON.stringify(r.data||[]));return r.data||[];}
async function getInvoicesAsync(){const r=await getCloudInvoices();if(!r.error)localStorage.setItem('fi_invoices',JSON.stringify(r.data||[]));return r.data||[];}
async function createCustomer(data){const r=await createCloudCustomer(data);if(r.error)throw new Error(r.error.message);return r.data;}
async function updateCustomer(id,data){const r=await updateCloudCustomer(id,data);if(r.error)throw new Error(r.error.message);return r.data;}
async function removeCustomer(id){const r=await deleteCloudCustomer(id);if(r.error)throw new Error(r.error.message);return true;}

async function consumeInvoiceCredit(user,invoiceId){
  if(!user||user.plan==='lifetime')return{ok:true};const unlocked=Array.isArray(user.unlockedInvoiceIds)?user.unlockedInvoiceIds:[];
  if(unlocked.includes(invoiceId))return{ok:true};if(Number(user.singleCredits||0)<=0)return{ok:false,error:'No invoice credits remaining'};
  user.singleCredits=Math.max(0,Number(user.singleCredits)-1);user.unlockedInvoiceIds=[...unlocked,invoiceId];saveCurrentUser(user);
  const sb=getSupabase();if(sb){const{error}=await sb.auth.updateUser({data:{singleCredits:user.singleCredits,unlockedInvoiceIds:user.unlockedInvoiceIds}});if(error){console.error('Could not sync invoice credit:',error);return{ok:false,error:error.message};}}
  return{ok:true};
}
function hasInvoiceAccess(user,invoiceId){if(!user)return false;if(user.plan==='lifetime')return true;if((user.unlockedInvoiceIds||[]).includes(invoiceId))return true;return Number(user.singleCredits||0)>0;}

const EMAILJS_SERVICE='service_xkh5qjd',EMAILJS_TEMPLATE='template_invoice_send',EMAILJS_PUBLIC='ypfhAplPP-LZxq9zy';
async function sendInvoiceByEmail(toEmail,toName,fromName,invNumber,pdfBase64){if(!window.emailjs){showToast('Email service not loaded. Check your connection.','error');return{error:'EmailJS not loaded'};}try{return{data:await emailjs.send(EMAILJS_SERVICE,EMAILJS_TEMPLATE,{to_email:toEmail,to_name:toName,from_name:fromName,inv_number:invNumber,pdf_base64:pdfBase64||''},EMAILJS_PUBLIC)};}catch(error){return{error};}}

async function logout(){const sb=getSupabase();saveCurrentUser(null);if(sb){try{await sb.auth.signOut();}catch(e){console.warn('Sign-out warning:',e);}}window.location.href='index.html';}
function showToast(msg,type='info',duration=3000){let c=document.getElementById('toast-container');if(!c){c=document.createElement('div');c.id='toast-container';c.className='toast-container';document.body.appendChild(c);}const t=document.createElement('div'),icons={success:'✅',error:'❌',info:'💡'};t.className=`toast ${type}`;const icon=document.createElement('span');icon.textContent=icons[type]||'💡';const text=document.createElement('span');text.textContent=String(msg);t.append(icon,text);c.appendChild(t);setTimeout(()=>{t.style.opacity='0';t.style.transform='translateX(120%)';t.style.transition='.3s';setTimeout(()=>t.remove(),300);},duration);}
function renderUserChip(containerId){const user=getCurrentUser(),el=document.getElementById(containerId);if(!el||!user)return;const initials=(user.name||user.email||'U').split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2),plan=(user.plan||'free').toUpperCase();const planColor=plan==='LIFETIME'?'#B76E00':plan==='SINGLE'?'#00C48C':'#6C3FF5',planBg=plan==='LIFETIME'?'rgba(255,181,0,.15)':plan==='SINGLE'?'rgba(0,196,140,.15)':'rgba(108,63,245,.15)';el.innerHTML=`<div class="user-chip"><div class="avatar">${escapeHtml(initials)}</div><span>${escapeHtml(user.name||user.email||'User')}</span></div><span class="badge" style="background:${planBg};color:${planColor};border-radius:99px;padding:3px 10px;font-size:11px;font-weight:700">${escapeHtml(plan)}</span>`;}
async function submitPaymentSubmission(sub){const sb=getSupabase();if(!sb)return{error:{message:'Database unavailable'}};return await sb.from('payment_submissions').insert([sub]).select().single();}
async function checkUnlockCode(code){const sb=getSupabase();if(!sb)return{error:{message:'Database unavailable'}};return await sb.rpc('redeem_unlock_code',{p_code:code});}
async function markCodeUsed(id,code){const sb=getSupabase();if(!sb)return{error:{message:'Database unavailable'}};return await sb.rpc('mark_unlock_code_used',{p_id:id,p_code:code});}
async function getAllSubmissions(){const sb=getSupabase();if(!sb)return{data:[],error:{message:'Supabase unavailable'}};const{data:{session}}=await sb.auth.getSession();if(!session)return{data:[],error:{message:'Not authenticated'}};try{const res=await fetch(`${SUPABASE_URL}/functions/v1/admin-payments`,{method:'POST',headers:{Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({action:'list'})});const json=await res.json();return res.ok?{data:json.data||[],error:null}:{data:[],error:{message:json.error||'Admin request failed'}};}catch(e){return{data:[],error:{message:e.message||'Admin request failed'}};}}
function generateUnlockCode(){const part=()=>Math.random().toString(36).slice(2,6).toUpperCase();return`${part()}-${part()}`;}
async function verifySubmissionAndIssueCode(id){const sb=getSupabase();if(!sb)return{error:{message:'Database unavailable'}};const{data:{session}}=await sb.auth.getSession();if(!session)return{error:{message:'Not authenticated'}};try{const res=await fetch(`${SUPABASE_URL}/functions/v1/admin-payments`,{method:'POST',headers:{Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({action:'verify',id})});const json=await res.json();return res.ok?{data:json.data,error:null}:{data:null,error:{message:json.error||'Verification failed'}};}catch(e){return{data:null,error:{message:e.message||'Verification failed'}};}}
async function sendWhatsAppCode(){return{error:'WhatsApp delivery is temporarily disabled for security. Configure the server-side WhatsApp function before re-enabling it.'};}
async function notifyAdminNewSubmission(){return{error:'WhatsApp admin alerts require the server-side WhatsApp function.'};}
function normalizeWhatsappNumber(raw){let digits=String(raw).replace(/\D/g,'');if(digits.startsWith('00'))digits=digits.slice(2);if(digits.startsWith('0')&&digits.length===11)digits='92'+digits.slice(1);return digits;}
const ADMIN_WHATSAPP_NUMBER='';
function setActiveNav(){const page=window.location.pathname.split('/').pop();document.querySelectorAll('.sidebar-nav a,.sb-nav a').forEach(a=>{if(a.getAttribute('href')===page)a.classList.add('active');});}
function escapeHtml(str){return String(str??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;').replace(/'/g,'&#39;');}

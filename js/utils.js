// FineInvoice shared utilities
const SUPABASE_URL='https://mozllscpvaxdigatsxiu.supabase.co';
const SUPABASE_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1vemxsc2NwdmF4ZGlnYXRzeWl1IiwiaWF0IjoxNzgyNDAwMDk1LCJleHAiOjIwOTc3NjA5l9.-DS2gRmOQVUilEPljbUbffNikr9BK8IEg3iGD319RDk';
function getSupabase(){if(window._supabase)return window._supabase;if(window.supabase?.createClient){window._supabase=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});return window._supabase}return null}
function readJSON(k,f){try{return JSON.parse(localStorage.getItem(k)??JSON.stringify(f))}catch{return f}}
function getCustomers(){return readJSON('fi_customers',[])}function getInvoices(){return readJSON('fi_invoices',[])}function getLicense(){return readJSON('fi_license',{})}function getCurrentUser(){return readJSON('fi_current_user',null)}function getUsers(){return readJSON('fi_users',[])}
function saveCustomers(d){localStorage.setItem('fi_customers',JSON.stringify(d));void syncCustomersToCloud(d)}
function saveInvoices(d){localStorage.setItem('fi_invoices',JSON.stringify(d));void syncInvoicesToCloud(d)}
function saveLicense(d){localStorage.setItem('fi_license',JSON.stringify(d))}function saveCurrentUser(u){if(u)localStorage.setItem('fi_current_user',JSON.stringify(u));else localStorage.removeItem('fi_current_user')}
function userFromSession(s){const u=s?.user;if(!u)return null;const m=u.user_metadata||{};return{id:u.id,email:u.email||'',name:m.name||u.email?.split('@')[0]||'User',plan:m.plan||'free',singleCredits:Number(m.singleCredits??3),unlockedInvoiceIds:Array.isArray(m.unlockedInvoiceIds)?m.unlockedInvoiceIds:[]}}
async function getAuthUser(){const sb=getSupabase();if(!sb)return null;const{data,error}=await sb.auth.getSession();if(error||!data.session)return null;const u=userFromSession(data.session);if(u)saveCurrentUser(u);return u}
async function requireAuthAsync(redirect='signin.html'){const u=await getAuthUser();if(!u){location.href=redirect;return null}return u}
function requireAuth(redirect='signin.html'){const local=getCurrentUser(),sb=getSupabase();if(!sb){if(!local)location.href=redirect;return local}sb.auth.getSession().then(({data})=>{const u=userFromSession(data?.session);if(!u){saveCurrentUser(null);location.href=redirect}else saveCurrentUser(u)}).catch(()=>{if(!local)location.href=redirect});if(!local&&!location.pathname.endsWith(redirect)){location.href=redirect;return null}return local}
async function syncPlanFromSupabase(){return getAuthUser()}
const PLAN_ORDER={free:0,single:1,lifetime:2};function requirePlan(u,p,f){if((PLAN_ORDER[u?.plan||'free']??0)>=(PLAN_ORDER[p]??1))return true;showToast(`${f} requires ${p==='lifetime'?'Lifetime ($25)':'Single ($2) or higher'} plan. Upgrade in Billing.`,'error',5000);return false}
async function dbSelect(t,q={}){const sb=getSupabase();if(!sb)return{data:null,error:{message:'Supabase unavailable'}};let x=sb.from(t).select(q.select||'*');for(const[k,v]of Object.entries(q.eq||{}))x=x.eq(k,v);if(q.order)x=x.order(q.order.column,{ascending:q.order.ascending!==false});return x}
async function dbInsert(t,row){const sb=getSupabase();if(!sb)return{data:null,error:{message:'Supabase unavailable'}};return sb.from(t).insert(row).select().single()}
async function dbUpdate(t,id,row){const sb=getSupabase();if(!sb)return{data:null,error:{message:'Supabase unavailable'}};return sb.from(t).update(row).eq('id',id).select().single()}
async function dbDelete(t,id){const sb=getSupabase();if(!sb)return{data:null,error:{message:'Supabase unavailable'}};return sb.from(t).delete().eq('id',id)}
async function getCloudCustomers(){const u=await getAuthUser();if(!u)return{data:[],error:{message:'Not authenticated'}};return dbSelect('customers',{eq:{user_id:u.id},order:{column:'created_at',ascending:false}})}
async function getCloudInvoices(){const u=await getAuthUser();if(!u)return{data:[],error:{message:'Not authenticated'}};return dbSelect('invoices',{eq:{user_id:u.id},order:{column:'created_at',ascending:false}})}
async function createCloudCustomer(c){const u=await getAuthUser();if(!u)return{data:null,error:{message:'Not authenticated'}};return dbInsert('customers',{name:c.name||'',company:c.company||null,email:c.email||null,phone:c.phone||null,address:c.address||null,payload:c.payload||{},user_id:u.id})}
async function updateCloudCustomer(id,c){return dbUpdate('customers',id,{name:c.name||'',company:c.company||null,email:c.email||null,phone:c.phone||null,address:c.address||null,payload:c.payload||{}})}
async function deleteCloudCustomer(id){return dbDelete('customers',id)}
function invoiceRow(i,userId){return{user_id:userId,invoice_number:i.invoice_number??i.invNumber??i.number??null,customer_id:i.customer_id??null,status:i.status||'draft',currency:i.currency||null,total:Number(i.total??i.grandTotal??0)||0,payload:{...i,legacy_id:i.id!=null?String(i.id):null}}}
async function createCloudInvoice(i){const u=await getAuthUser();if(!u)return{data:null,error:{message:'Not authenticated'}};return dbInsert('invoices',invoiceRow(i,u.id))}
async function updateCloudInvoice(id,i){return dbUpdate('invoices',id,{invoice_number:i.invoice_number??i.invNumber??null,customer_id:i.customer_id??null,status:i.status||'draft',currency:i.currency||null,total:Number(i.total??i.grandTotal??0)||0,payload:{...i,legacy_id:i.id!=null?String(i.id):null}})}
async function getCloudInvoice(id){const sb=getSupabase();const u=await getAuthUser();if(!sb||!u)return{data:null,error:{message:'Not authenticated'}};const byId=await sb.from('invoices').select('*').eq('id',id).eq('user_id',u.id).maybeSingle();if(byId.data||byId.error)return byId;return sb.from('invoices').select('*').eq('user_id',u.id).filter('payload->>legacy_id','eq',String(id)).maybeSingle()}
async function syncInvoicesToCloud(invoices){const sb=getSupabase(),u=await getAuthUser();if(!sb||!u||!Array.isArray(invoices))return;for(const invoice of invoices){if(!invoice||invoice.id==null)continue;try{const payload=invoiceRow(invoice,u.id);const existing=await sb.from('invoices').select('id').eq('user_id',u.id).filter('payload->>legacy_id','eq',String(invoice.id)).maybeSingle();if(existing.data?.id)await updateCloudInvoice(existing.data.id,invoice);else await createCloudInvoice(invoice)}catch(e){console.warn('Invoice cloud sync failed:',e)}}}
async function syncCustomersToCloud(customers){const sb=getSupabase(),u=await getAuthUser();if(!sb||!u||!Array.isArray(customers))return;for(const customer of customers){if(!customer)continue;try{const legacyId=customer.id!=null?String(customer.id):null;let existing=null;if(legacyId)existing=await sb.from('customers').select('id').eq('user_id',u.id).filter('payload->>legacy_id','eq',legacyId).maybeSingle();const row={name:customer.name||'',company:customer.company||null,email:customer.email||null,phone:customer.phone||null,address:customer.address||null,payload:{...customer,legacy_id:legacyId}};if(existing?.data?.id)await sb.from('customers').update(row).eq('id',existing.data.id);else await sb.from('customers').insert({...row,user_id:u.id})}catch(e){console.warn('Customer cloud sync failed:',e)}}}
async function createCustomer(c){const r=await createCloudCustomer(c);if(r.error)throw new Error(r.error.message);return r.data}async function updateCustomer(id,c){return dbUpdate('customers',id,{name:c.name||'',company:c.company||null,email:c.email||null,phone:c.phone||null,address:c.address||null,payload:{...c,legacy_id:String(id)}})}async function removeCustomer(id){const r=await deleteCloudCustomer(id);if(r.error)throw new Error(r.error.message);return true}
async function consumeInvoiceCredit(u,id){if(!u||u.plan==='lifetime')return{ok:true};const ids=Array.isArray(u.unlockedInvoiceIds)?u.unlockedInvoiceIds:[];if(ids.includes(id))return{ok:true};if(Number(u.singleCredits||0)<=0)return{ok:false,error:'No invoice credits remaining'};const nextCredits=Math.max(0,Number(u.singleCredits)-1),nextIds=[...ids,id],sb=getSupabase();if(sb){const{error}=await sb.auth.updateUser({data:{singleCredits:nextCredits,unlockedInvoiceIds:nextIds}});if(error)return{ok:false,error:error.message}}u.singleCredits=nextCredits;u.unlockedInvoiceIds=nextIds;saveCurrentUser(u);return{ok:true}}
async function refundInvoiceCredit(u,id){if(!u||u.plan==='lifetime')return{ok:true};const ids=Array.isArray(u.unlockedInvoiceIds)?u.unlockedInvoiceIds:[];if(!ids.includes(id))return{ok:true};const nextIds=ids.filter(x=>x!==id),nextCredits=Number(u.singleCredits||0)+1,sb=getSupabase();if(sb){const{error}=await sb.auth.updateUser({data:{singleCredits:nextCredits,unlockedInvoiceIds:nextIds}});if(error)return{ok:false,error:error.message}}u.singleCredits=nextCredits;u.unlockedInvoiceIds=nextIds;saveCurrentUser(u);return{ok:true}}
function hasInvoiceAccess(u,id){return!!u&&(u.plan==='lifetime'||(u.unlockedInvoiceIds||[]).includes(id)||Number(u.singleCredits||0)>0)}
const EMAILJS_SERVICE='service_xkh5qjd',EMAILJS_TEMPLATE='template_invoice_send',EMAILJS_PUBLIC='ypfhAplPP-LZxq9zy';async function sendInvoiceByEmail(toEmail,toName,fromName,invNumber,pdfBase64){if(!window.emailjs)return{error:'EmailJS not loaded'};try{return{data:await emailjs.send(EMAILJS_SERVICE,EMAILJS_TEMPLATE,{to_email:toEmail,to_name:toName,from_name:fromName,inv_number:invNumber,pdf_base64:pdfBase64||''},EMAILJS_PUBLIC)}}catch(error){return{error}}}
async function logout(){const sb=getSupabase();saveCurrentUser(null);if(sb)try{await sb.auth.signOut()}catch(e){}location.href='index.html'}
function showToast(msg,type='info',duration=3000){let c=document.getElementById('toast-container');if(!c){c=document.createElement('div');c.id='toast-container';c.className='toast-container';document.body.appendChild(c)}const t=document.createElement('div'),icons={success:'✅',error:'❌',info:'💡'};t.className=`toast ${type}`;t.innerHTML='';const a=document.createElement('span');a.textContent=icons[type]||'💡';const b=document.createElement('span');b.textContent=String(msg);t.append(a,b);c.appendChild(t);setTimeout(()=>{t.style.opacity='0';t.style.transform='translateX(120%)';t.style.transition='.3s';setTimeout(()=>t.remove(),300)},duration)}
function renderUserChip(id){const u=getCurrentUser(),e=document.getElementById(id);if(!e||!u)return;const initials=(u.name||u.email||'U').split(' ').map(x=>x[0]).join('').toUpperCase().slice(0,2);e.innerHTML=`<div class="user-chip"><div class="avatar">${escapeHtml(initials)}</div><span>${escapeHtml(u.name||u.email||'User')}</span></div><span class="badge">${escapeHtml((u.plan||'free').toUpperCase())}</span>`}
async function submitPaymentSubmission(s){const sb=getSupabase();return sb?sb.from('payment_submissions').insert([s]).select().single():{error:{message:'Database unavailable'}}}async function checkUnlockCode(c){const sb=getSupabase();return sb?sb.rpc('redeem_unlock_code',{p_code:c}):{error:{message:'Database unavailable'}}}async function markCodeUsed(id,c){const sb=getSupabase();return sb?sb.rpc('mark_unlock_code_used',{p_id:id,p_code:c}):{error:{message:'Database unavailable'}}}
async function getAllSubmissions(){const sb=getSupabase();if(!sb)return{data:[],error:{message:'Supabase unavailable'}};const{data:{session}}=await sb.auth.getSession();if(!session)return{data:[],error:{message:'Not authenticated'}};try{const r=await fetch(`${SUPABASE_URL}/functions/v1/admin-payments`,{method:'POST',headers:{Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({action:'list'})}),j=await r.json();return r.ok?{data:j.data||[],error:null}:{data:[],error:{message:j.error||'Admin request failed'}}}catch(e){return{data:[],error:{message:e.message||'Admin request failed'}}}}
function generateUnlockCode(){const p=()=>Math.random().toString(36).slice(2,6).toUpperCase();return`${p()}-${p()}`}
async function verifySubmissionAndIssueCode(id){const sb=getSupabase();if(!sb)return{error:{message:'Database unavailable'}};const{data:{session}}=await sb.auth.getSession();if(!session)return{error:{message:'Not authenticated'}};try{const r=await fetch(`${SUPABASE_URL}/functions/v1/admin-payments`,{method:'POST',headers:{Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({action:'verify',id})}),j=await r.json();return r.ok?{data:j.data,error:null}:{data:null,error:{message:j.error||'Verification failed'}}}catch(e){return{data:null,error:{message:e.message||'Verification failed'}}}}
async function sendWhatsAppCode(){return{error:'WhatsApp delivery is temporarily disabled for security.'}}async function notifyAdminNewSubmission(){return{error:'WhatsApp admin alerts require the server-side function.'}}function normalizeWhatsappNumber(raw){let d=String(raw).replace(/\D/g,'');if(d.startsWith('00'))d=d.slice(2);if(d.startsWith('0')&&d.length===11)d='92'+d.slice(1);return d}const ADMIN_WHATSAPP_NUMBER='';
function setActiveNav(){const p=location.pathname.split('/').pop();document.querySelectorAll('.sidebar-nav a,.sb-nav a').forEach(a=>{if(a.getAttribute('href')===p)a.classList.add('active')})}function escapeHtml(s){return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;').replace(/'/g,'&#39;')}

// Invoice Builder hardening: replace the legacy download/print handlers after the page scripts load.
// The original handlers charged a credit before generating the artifact. These wrappers generate first,
// then consume exactly one credit only after a successful artifact, preventing failed downloads from charging users.
window.addEventListener('load',()=>{
  if(typeof window.downloadPDF==='function'){
    window.downloadPDF=async function(){
      const u=getCurrentUser();
      if(!hasInvoiceAccess(u,window.currentDraftId)){
        if(confirm('Download requires a paid plan ($2 Single or $25 Lifetime).\n\nGo to Billing?')) window.location.href='payment.html';
        return;
      }
      showToast('Generating PDF…','info');
      try{
        const el=document.getElementById('invoiceDoc');
        if(!el)throw new Error('Invoice preview not found');
        const canvas=await html2canvas(el,{scale:2,useCORS:true,backgroundColor:'#ffffff'});
        const {jsPDF}=window.jspdf||{};
        if(!jsPDF)throw new Error('PDF engine unavailable');
        const doc=new jsPDF({orientation:'portrait',unit:'mm',format:'a4'});
        const imgData=canvas.toDataURL('image/png');
        const pageW=doc.internal.pageSize.getWidth();
        const pageH=(canvas.height*pageW)/canvas.width;
        doc.addImage(imgData,'PNG',0,0,pageW,pageH);
        const invNum=(document.getElementById('invNumber')?.value||'invoice').replace(/[^a-z0-9._-]/gi,'_');
        doc.save(invNum+'.pdf');
        const charged=await consumeInvoiceCredit(u,window.currentDraftId);
        if(!charged.ok){showToast('PDF was created, but the invoice could not be unlocked: '+charged.error,'error',6000);return;}
        const dl=parseInt(localStorage.getItem('fi_downloads')||'0',10)+1;
        localStorage.setItem('fi_downloads',String(dl));
        showToast('PDF downloaded! 🎉','success');
      }catch(e){console.error('PDF generation failed:',e);showToast('PDF generation failed. Your credit was not charged.','error',5000)}
    };
  }
  if(typeof window.printInvoice==='function'){
    window.printInvoice=async function(){
      const u=getCurrentUser();
      if(!hasInvoiceAccess(u,window.currentDraftId)){
        if(confirm('Printing requires a paid plan.\n\nSingle — $2 per invoice\nLifetime — $25 forever\n\nGo to Billing?')) window.location.href='payment.html';
        return;
      }
      try{
        document.body.classList.add('print-mode');
        window.print();
        setTimeout(async()=>{document.body.classList.remove('print-mode');const charged=await consumeInvoiceCredit(u,window.currentDraftId);if(!charged.ok)showToast('Invoice printed, but credit could not be recorded: '+charged.error,'error',6000);else showToast('Invoice printed successfully!','success')},600);
      }catch(e){document.body.classList.remove('print-mode');showToast('Printing failed. Your credit was not charged.','error',5000)}
    };
  }
});

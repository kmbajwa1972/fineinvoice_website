// ── Supabase Client ──
const SUPABASE_URL = 'https://mozllscpvaxdigatsxiu.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1vemxsc2NwdmF4ZGlnYXRzeGl1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0MDAwOTUsImV4cCI6MjA5Nzk3NjA5NX0.-DS2gRmOQVUilEPljbUbffNikr9BK8IEg3iGD319RDk';

// Load Supabase from CDN — loaded via script tag in each page
// We expose a helper to get the client after CDN loads
function getSupabase() {
  if(window._supabase) return window._supabase;
  if(window.supabase && window.supabase.createClient) {
    window._supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    return window._supabase;
  }
  return null;
}

// ── HTML escaping ──
// Anything that came from a form (customer name/email, payment txn id, etc.)
// must go through this before being inserted via innerHTML.
function escapeHtml(str){
  return String(str ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

// ── LocalStorage fallback helpers (used as cache/session) ──
function getCustomers(){ return JSON.parse(localStorage.getItem('fi_customers')|| '[]'); }
function getInvoices () { return JSON.parse(localStorage.getItem('fi_invoices') || '[]'); }
function getLicense  () { return JSON.parse(localStorage.getItem('fi_license')  || '{}'); }
function getCurrentUser(){ return JSON.parse(localStorage.getItem('fi_current_user') || 'null'); }
function getUsers(){ return JSON.parse(localStorage.getItem('fi_users') || '[]'); }

function saveCustomers(d){ localStorage.setItem('fi_customers', JSON.stringify(d)); }
function saveInvoices(d) { localStorage.setItem('fi_invoices',  JSON.stringify(d)); }
function saveLicense(d)  { localStorage.setItem('fi_license',   JSON.stringify(d)); }
function saveCurrentUser(u){ localStorage.setItem('fi_current_user', JSON.stringify(u)); }

function requireAuth(redirect='signin.html'){
  const user = getCurrentUser();
  if(!user){ window.location.href = redirect; return null; }
  return user;
}

// ── Plan gate helper ──
// levels: 'free' | 'single' | 'lifetime'
function requirePlan(user, minPlan, featureName){
  const order = { free:0, single:1, lifetime:2 };
  const userLevel = order[user?.plan || 'free'] ?? 0;
  const required  = order[minPlan] ?? 1;
  if(userLevel >= required) return true;
  const label = minPlan === 'lifetime' ? 'Lifetime ($25)' : 'Single ($2) or higher';
  showToast(`${featureName} requires ${label} plan. Upgrade in Billing.`, 'error', 5000);
  return false;
}

// ── Email invoice via EmailJS (Lifetime only) ──
// Khalid must add his EmailJS service/template IDs in payment.html or here
const EMAILJS_SERVICE  = 'service_xkh5qjd';
const EMAILJS_TEMPLATE = 'template_invoice_send'; // create this template in EmailJS
const EMAILJS_PUBLIC   = 'ypfhAplPP-LZxq9zy';

async function sendInvoiceByEmail(toEmail, toName, fromName, invNumber, pdfBase64){
  if(!window.emailjs){
    showToast('Email service not loaded. Check your connection.', 'error');
    return { error: 'EmailJS not loaded' };
  }
  try {
    const result = await emailjs.send(EMAILJS_SERVICE, EMAILJS_TEMPLATE, {
      to_email:   toEmail,
      to_name:    toName,
      from_name:  fromName,
      inv_number: invNumber,
      pdf_base64: pdfBase64 || ''
    }, EMAILJS_PUBLIC);
    return { data: result };
  } catch(err){
    return { error: err };
  }
}

function logout(){
  localStorage.removeItem('fi_current_user');
  const sb = getSupabase();
  if(sb) sb.auth.signOut().finally(()=>{ window.location.href = 'index.html'; });
  else window.location.href = 'index.html';
}

// ── Toast ──
function showToast(msg, type='info', duration=3000){
  let c = document.getElementById('toast-container');
  if(!c){ c = document.createElement('div'); c.id='toast-container'; c.className='toast-container'; document.body.appendChild(c); }
  const t = document.createElement('div');
  const icons = { success:'✅', error:'❌', info:'💡' };
  t.className = `toast ${type}`;
  t.innerHTML = `<span>${icons[type]||'💡'}</span><span>${msg}</span>`;
  c.appendChild(t);
  setTimeout(()=>{ t.style.opacity='0'; t.style.transform='translateX(120%)'; t.style.transition='.3s'; setTimeout(()=>t.remove(),300); }, duration);
}

// ── User chip ──
function renderUserChip(containerId){
  const user = getCurrentUser();
  const el = document.getElementById(containerId);
  if(!el||!user) return;
  const initials = (user.name||user.email||'U').split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
  const plan = (user.plan||'free').toUpperCase();
  const planColor = plan==='LIFETIME'?'#B76E00':plan==='SINGLE'?'#00C48C':'#6C3FF5';
  const planBg = plan==='LIFETIME'?'rgba(255,181,0,.15)':plan==='SINGLE'?'rgba(0,196,140,.15)':'rgba(108,63,245,.15)';
  el.innerHTML = `
    <div class="user-chip">
      <div class="avatar">${initials}</div>
      <span>${user.name||user.email||'User'}</span>
    </div>
    <span class="badge" style="background:${planBg};color:${planColor};border-radius:99px;padding:3px 10px;font-size:11px;font-weight:700">${plan}</span>
  `;
}

// ── Payment submissions (Supabase-backed, so Khalid can see them from any device) ──
// Direct table SELECT/UPDATE from the client is blocked by RLS (see
// supabase/migrations/0001_lock_down_payment_submissions.sql) — the anon key
// can only INSERT here. Redemption goes through narrow SECURITY DEFINER
// RPCs; admin listing/verification goes through the admin-payments Edge
// Function, which checks the caller's email against ADMIN_EMAILS server-side.
async function submitPaymentSubmission(sub){
  const sb = getSupabase();
  if(!sb) return { error:{ message:'Database unavailable' } };
  // No .select() here — RLS gives anon INSERT-only access on this table (by
  // design, so nobody can read other customers' submissions), and the
  // caller doesn't need the row back, so asking for one is redundant and
  // would fail anyway since anon has no SELECT policy to read it back with.
  const { error } = await sb.from('payment_submissions').insert([sub]);
  return { error };
}

async function checkUnlockCode(code){
  const sb = getSupabase();
  if(!sb) return { error:{ message:'Database unavailable' } };
  const { data, error } = await sb.rpc('redeem_unlock_code', { p_code: code });
  if(error) return { error };
  const row = Array.isArray(data) ? data[0] : data;
  return { data: row || null };
}

async function markCodeUsed(id, code){
  const sb = getSupabase();
  if(!sb) return;
  await sb.rpc('mark_unlock_code_used', { p_id: id, p_code: code });
}

async function callAdminPayments(action, extra = {}){
  const sb = getSupabase();
  if(!sb) return { error:{ message:'Database unavailable' } };
  const { data: sessionData } = await sb.auth.getSession();
  const token = sessionData?.session?.access_token;
  if(!token) return { error:{ message:'Not signed in' } };
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/admin-payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ action, ...extra })
    });
    const body = await res.json();
    if(!res.ok) return { error: body.error ? { message: body.error } : { message: 'Request failed' } };
    return body;
  } catch(err){
    return { error: { message: err.message || 'Network error' } };
  }
}

async function getAllSubmissions(){
  const { data, error } = await callAdminPayments('list');
  if(error) console.error('getAllSubmissions error:', error);
  return { data: data || [], error };
}

async function verifySubmissionAndIssueCode(id){
  return callAdminPayments('verify', { id });
}

// ── Automatic WhatsApp sending via Green-API ──
const GREEN_API_ID_INSTANCE    = '710701673614';
const GREEN_API_TOKEN_INSTANCE = 'd21bd555c5b14b778f3e5debccc0f18adf1ff283aba24f2283';
const GREEN_API_HOST           = 'https://7107.api.greenapi.com';

function normalizeWhatsappNumber(raw){
  // Strip everything except digits, then drop a leading 0 if the country code is missing
  let digits = String(raw).replace(/\D/g, '');
  if(digits.startsWith('00')) digits = digits.slice(2);
  return digits;
}

async function sendWhatsAppCode(whatsapp, plan, code){
  const chatId = normalizeWhatsappNumber(whatsapp) + '@c.us';
  const url = `${GREEN_API_HOST}/waInstance${GREEN_API_ID_INSTANCE}/sendMessage/${GREEN_API_TOKEN_INSTANCE}`;
  const message =
    `Thank you for your FineInvoice payment!\n\n` +
    `Plan: ${String(plan).toUpperCase()}\n` +
    `Your unlock code: ${code}\n\n` +
    `Enter this code on the Billing page under "Have a code?" to activate your plan.`;

  try{
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId, message })
    });
    const data = await res.json();
    if(!res.ok) return { error: data };
    return { data };
  } catch(err){
    return { error: err.message || 'Network error sending WhatsApp message' };
  }
}

const ADMIN_WHATSAPP_NUMBER = '923008637155'; // Khalid's own number — receives new-submission alerts

async function notifyAdminNewSubmission(sub){
  const chatId = normalizeWhatsappNumber(ADMIN_WHATSAPP_NUMBER) + '@c.us';
  const url = `${GREEN_API_HOST}/waInstance${GREEN_API_ID_INSTANCE}/sendMessage/${GREEN_API_TOKEN_INSTANCE}`;
  const message =
    `🔔 New FineInvoice payment submitted!\n\n` +
    `Plan: ${String(sub.plan||'').toUpperCase()}\n` +
    `Method: ${sub.method}\n` +
    `Transaction ID: ${sub.txn}\n` +
    `Customer WhatsApp: ${sub.whatsapp}\n` +
    `Email: ${sub.email||'—'}\n\n` +
    `Open admin.html to verify and send the unlock code.`;
  try{
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId, message })
    });
  } catch(e){ console.error('Could not notify admin:', e); }
}

// ── Single-plan invoice credits (so SINGLE buys one invoice, not unlimited) ──
function hasInvoiceAccess(user, invoiceId){
  if(!user) return false;
  if(user.plan === 'lifetime') return true;
  const unlocked = user.unlockedInvoiceIds || [];
  if(unlocked.includes(invoiceId)) return true; // already paid for this specific invoice
  return (user.singleCredits || 0) > 0;
}

async function consumeInvoiceCredit(user, invoiceId){
  if(!user || user.plan === 'lifetime') return;
  const unlocked = user.unlockedInvoiceIds || [];
  if(unlocked.includes(invoiceId)) return; // don't double-charge for the same invoice
  user.singleCredits = Math.max(0, (user.singleCredits || 0) - 1);
  unlocked.push(invoiceId);
  user.unlockedInvoiceIds = unlocked;
  saveCurrentUser(user);
  const sb = getSupabase();
  if(sb){
    try { await sb.auth.updateUser({ data: { singleCredits: user.singleCredits, unlockedInvoiceIds: user.unlockedInvoiceIds } }); }
    catch(e){ console.error('Could not sync invoice credit:', e); }
  }
}

// ── Active nav ──
function setActiveNav(){
  const page = window.location.pathname.split('/').pop();
  document.querySelectorAll('.sidebar-nav a').forEach(a=>{
    if(a.getAttribute('href')===page) a.classList.add('active');
  });
}

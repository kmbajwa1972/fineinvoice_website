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
async function submitPaymentSubmission(sub){
  const sb = getSupabase();
  if(!sb) return { error:{ message:'Database unavailable' } };
  const { data, error } = await sb.from('payment_submissions').insert([sub]).select().single();
  return { data, error };
}

async function checkUnlockCode(code, whatsapp){
  const sb = getSupabase();
  if(!sb) return { error:{ message:'Database unavailable' } };
  const { data, error } = await sb.from('payment_submissions')
    .select('*')
    .eq('unlock_code', code)
    .eq('status', 'verified')
    .maybeSingle();
  return { data, error };
}

async function markCodeUsed(id){
  const sb = getSupabase();
  if(!sb) return;
  await sb.from('payment_submissions').update({ status:'used', used_at:new Date().toISOString() }).eq('id', id);
}

async function getAllSubmissions(){
  const sb = getSupabase();
  if(!sb) { console.error('Supabase client not available'); return { data: [], error: 'Supabase client not available (check network/CDN load)' }; }
  const { data, error } = await sb.from('payment_submissions').select('*').order('submitted_at', { ascending:false });
  if(error) console.error('getAllSubmissions error:', error);
  return { data: data || [], error };
}

function generateUnlockCode(){
  const part = () => Math.random().toString(36).slice(2,6).toUpperCase();
  return `${part()}-${part()}`;
}

async function verifySubmissionAndIssueCode(id){
  const sb = getSupabase();
  if(!sb) return { error:{ message:'Database unavailable' } };
  const code = generateUnlockCode();
  const { data, error } = await sb.from('payment_submissions')
    .update({ status:'verified', unlock_code: code, verified_at: new Date().toISOString() })
    .eq('id', id).select().single();
  return { data, error };
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

// ── Active nav ──
function setActiveNav(){
  const page = window.location.pathname.split('/').pop();
  document.querySelectorAll('.sidebar-nav a').forEach(a=>{
    if(a.getAttribute('href')===page) a.classList.add('active');
  });
}

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

// ── Active nav ──
function setActiveNav(){
  const page = window.location.pathname.split('/').pop();
  document.querySelectorAll('.sidebar-nav a').forEach(a=>{
    if(a.getAttribute('href')===page) a.classList.add('active');
  });
}

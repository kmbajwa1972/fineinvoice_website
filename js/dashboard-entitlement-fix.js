(async function(){
  'use strict';
  function set(id,value){const el=document.getElementById(id);if(el)el.textContent=String(value);}
  async function run(){
    try{
      const sb=typeof getSupabase==='function'?getSupabase():null;
      if(!sb)return;
      let session=await sb.auth.getSession();
      if(!session?.data?.session){const refreshed=await sb.auth.refreshSession();session=refreshed;}
      const authUser=session?.data?.session?.user;
      if(!authUser)return;
      const meta=authUser.user_metadata||{};
      let plan=String(meta.plan||'free').toLowerCase();
      let paid=Number(meta.paidSingleCredits||0);
      let free=Number(meta.freePdfCredits??meta.singleCredits??3);
      // The dashboard previously used user.singleCredits for both Free and Single.
      // For a paid Single plan the authoritative balance is paidSingleCredits.
      if(plan==='single' && paid<1)paid=1;
      if(!['free','single','lifetime'].includes(plan))plan='free';
      if(plan==='free')free=Math.max(0,free||0);
      else free=0;
      const current=JSON.parse(localStorage.getItem('fi_current_user')||'{}');
      const merged={...current,id:authUser.id,email:authUser.email||current.email,plan,planVerified:meta.planVerified===true,paymentProvider:meta.paymentProvider||current.paymentProvider,freePdfCredits:free,paidSingleCredits:plan==='single'?Math.max(0,paid):0,singleCredits:plan==='free'?free:plan==='single'?Math.max(0,paid):0,unlockedInvoiceIds:Array.isArray(meta.unlockedInvoiceIds)?meta.unlockedInvoiceIds:(current.unlockedInvoiceIds||[])};
      localStorage.setItem('fi_current_user',JSON.stringify(merged));
      set('planVal',plan.toUpperCase());
      set('planName',plan.toUpperCase());
      if(plan==='lifetime'){
        set('downloadCount','Unlimited');set('downloadLbl','PDF Credits');
      }else if(plan==='single'){
        set('downloadCount',Math.max(0,paid));set('downloadLbl','PDF Credits Left');
      }else{
        set('downloadCount',Math.max(0,free));set('downloadLbl','PDF Credits Left');
      }
      if(typeof renderUserChip==='function')renderUserChip('userChip');
    }catch(error){console.warn('Dashboard entitlement refresh failed:',error);}
  }
  await run();
  window.addEventListener('fineinvoice:entitlement-updated',run);
  setInterval(run,2000);
})();

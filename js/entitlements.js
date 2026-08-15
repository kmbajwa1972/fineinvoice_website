/* FineInvoice commercial entitlement manager */
(function () {
  'use strict';
  const FREE_START = 3;
  const PLAN_LIFETIME = 'lifetime';
  function normalizeUser(user) {
    if (!user) return null;
    const plan = String(user.plan || 'free').toLowerCase();
    return {...user,plan,freePdfCredits:Number.isFinite(Number(user.freePdfCredits))?Math.max(0,Number(user.freePdfCredits)):(Number.isFinite(Number(user.singleCredits))?Math.max(0,Number(user.singleCredits)):FREE_START),paidSingleCredits:Math.max(0,Number(user.paidSingleCredits||0)),unlockedInvoiceIds:Array.isArray(user.unlockedInvoiceIds)?[...new Set(user.unlockedInvoiceIds.map(String))]:[]};
  }
  window.FineInvoiceEntitlements={FREE_START,normalizeUser,invoiceEntitlementId(invoice){return invoice?String(invoice.entitlementId||invoice.id||''):null},isLifetime(user){return String(user?.plan||'').toLowerCase()===PLAN_LIFETIME},isUnlocked(user,id){return!!id&&Array.isArray(user?.unlockedInvoiceIds)&&user.unlockedInvoiceIds.includes(String(id))}};

  /* Replace the builder's PDF routine with a compact invoice-only renderer. */
  window.addEventListener('load',function(){
    window.downloadPDF=async function(){
      const u=typeof getInvoiceAccessUser==='function'?await getInvoiceAccessUser():(typeof getCurrentUser==='function'?getCurrentUser():null);
      const invoiceId=String((typeof currentDraftId!=='undefined'&&currentDraftId)?currentDraftId:(document.getElementById('invNumber')?.value||'draft'));
      const hasAccess=typeof invoiceHasAccess==='function'?invoiceHasAccess(u,invoiceId):!!u;
      if(!hasAccess){if(confirm('Your free PDF credits have been used.\n\nSingle: $2 per invoice\nor Lifetime: $25 unlimited.\n\nGo to Billing?'))window.location.href='payment.html';return}
      const plan=String(u?.plan||'free').toLowerCase(),unlocked=Array.isArray(u?.unlockedInvoiceIds)&&u.unlockedInvoiceIds.map(String).includes(invoiceId),alreadyUnlocked=plan==='lifetime'||unlocked,source=document.getElementById('invoiceDoc');
      if(!source){showToast('Invoice preview not found.','error');return}
      showToast('Generating one-page A4 PDF…','info');
      let clone=null,style=null;
      try{
        /* Clone only the invoice document. Do not capture the preview/editor wrapper. */
        clone=source.cloneNode(true);clone.id='fineinvoicePdfInvoice';clone.className='';
        clone.style.cssText='position:absolute!important;left:-20000px!important;top:0!important;width:194mm!important;max-width:194mm!important;min-width:194mm!important;height:auto!important;min-height:0!important;margin:0!important;padding:5mm!important;box-sizing:border-box!important;background:#fff!important;overflow:visible!important;font-family:Arial,sans-serif!important;font-size:9px!important;line-height:1.15!important;color:#1A1A2E!important;';
        document.body.appendChild(clone);
        style=document.createElement('style');style.textContent=`
          #fineinvoicePdfInvoice{width:194mm!important;max-width:194mm!important;min-width:194mm!important}
          #fineinvoicePdfInvoice .inv-header{display:flex!important;margin:0 0 7px!important;padding:0 0 5px!important;border-bottom:1px solid #ddd!important}
          #fineinvoicePdfInvoice .inv-company-name{font-size:15px!important;line-height:1.1!important;margin:0!important}
          #fineinvoicePdfInvoice .inv-company-email{font-size:8px!important;line-height:1.1!important;margin:1px 0 0!important}
          #fineinvoicePdfInvoice .inv-logo{max-width:85px!important;max-height:30px!important}
          #fineinvoicePdfInvoice .inv-badge{font-size:19px!important;line-height:1!important}
          #fineinvoicePdfInvoice .inv-meta{display:flex!important;margin:0 0 7px!important;line-height:1.15!important}
          #fineinvoicePdfInvoice .inv-bill-label{font-size:7px!important;margin:0 0 1px!important}
          #fineinvoicePdfInvoice .inv-bill-name{font-size:10px!important;line-height:1.15!important}
          #fineinvoicePdfInvoice .inv-bill-to>div:not(.inv-bill-label){font-size:8px!important;line-height:1.15!important;margin:0!important}
          #fineinvoicePdfInvoice .inv-details{font-size:8px!important;line-height:1.15!important}
          #fineinvoicePdfInvoice .inv-details div{margin:0!important;padding:0!important}
          #fineinvoicePdfInvoice .inv-items-table{width:100%!important;margin:0 0 6px!important;border-collapse:collapse!important;font-size:8px!important;line-height:1.1!important}
          #fineinvoicePdfInvoice .inv-items-table th{padding:3px 4px!important;font-size:6.8px!important;line-height:1!important;border-bottom:1px solid #bbb!important}
          #fineinvoicePdfInvoice .inv-items-table td{padding:3px 4px!important;line-height:1.1!important;border-bottom:1px solid #eee!important}
          #fineinvoicePdfInvoice .inv-totals{display:flex!important;margin:0 0 5px!important}
          #fineinvoicePdfInvoice .inv-totals-box{min-width:160px!important;width:160px!important}
          #fineinvoicePdfInvoice .inv-total-row{font-size:7.5px!important;line-height:1.1!important;margin:0!important;padding:1px 0!important}
          #fineinvoicePdfInvoice .inv-grand{font-size:9px!important;line-height:1.1!important;padding:3px 0 0!important;margin:2px 0 0!important;border-top:1px solid currentColor!important;min-height:0!important}
          #fineinvoicePdfInvoice .inv-footer{font-size:6.5px!important;line-height:1!important;padding:4px 0 0!important;margin:0!important;border-top:1px solid #eee!important}
          #fineinvoicePdfInvoice>div{margin-top:0!important;margin-bottom:5px!important}
          #fineinvoicePdfInvoice>div[style*="background:#f9f7ff"]{padding:5px 7px!important;margin:4px 0 5px!important;font-size:7px!important;line-height:1.15!important}
          #fineinvoicePdfInvoice *{break-inside:avoid!important;page-break-inside:avoid!important}
        `;document.head.appendChild(style);
        if(document.fonts?.ready)await document.fonts.ready;
        await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
        const canvas=await html2canvas(clone,{scale:2,width:clone.scrollWidth,height:clone.scrollHeight,windowWidth:clone.scrollWidth,windowHeight:clone.scrollHeight,backgroundColor:'#fff',useCORS:true,logging:false});
        const{jsPDF}=window.jspdf||{};if(!jsPDF)throw new Error('PDF engine unavailable');
        const doc=new jsPDF({orientation:'portrait',unit:'mm',format:'a4',compress:true}),pageW=doc.internal.pageSize.getWidth(),pageH=doc.internal.pageSize.getHeight(),margin=7,usableW=pageW-margin*2,usableH=pageH-margin*2,naturalH=canvas.height*usableW/canvas.width,scale=Math.min(1,usableH/naturalH),finalH=naturalH*scale;
        doc.addImage(canvas.toDataURL('image/jpeg',.94),'JPEG',margin,margin,usableW,finalH);
        const invNum=document.getElementById('invNumber')?.value||'invoice';doc.save(`${String(invNum).replace(/[^a-z0-9._-]/gi,'_')}.pdf`);
        if(!alreadyUnlocked&&typeof consumeCommercialInvoiceCredit==='function'){const r=await consumeCommercialInvoiceCredit(u,invoiceId);if(!r?.ok){showToast(r?.error||'Could not save PDF entitlement','error',6000);return}}
        const dl=parseInt(localStorage.getItem('fi_downloads')||'0',10)+1;localStorage.setItem('fi_downloads',String(dl));showToast('One-page A4 PDF downloaded! 🎉','success');
      }catch(e){console.error('FineInvoice PDF generation failed:',e);showToast('PDF generation failed. Your PDF credit was not used.','error',5000)}finally{style?.remove();clone?.remove()}
    };
  });
})();

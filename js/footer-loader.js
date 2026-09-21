// FineInvoice reusable footer loader
fetch("footer.html")
  .then(response => response.text())
  .then(html => {
    const target = document.querySelector("#site-footer") || document.querySelector("footer");
    if (target) {
      if (target.id === "site-footer") target.innerHTML = html;
      else target.outerHTML = html;
    }
  })
  .catch(() => {});

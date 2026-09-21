// FineInvoice reusable footer loader
fetch("/footer.html")
  .then(response => response.text())
  .then(html => {
    const footer = document.querySelector("#site-footer") || document.querySelector("footer");
    if (footer) {
      if (footer.id === "site-footer") footer.outerHTML = html;
      else footer.outerHTML = html;
    }
  })
  .catch(() => {});

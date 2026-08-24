// FineInvoice reusable footer loader
fetch("footer.html")
  .then(response => response.text())
  .then(html => {
    const footer = document.querySelector("footer");
    if (footer) {
      footer.outerHTML = html;
    }
  })
  .catch(() => {});

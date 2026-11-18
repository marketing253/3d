/* Página de links: copiar (Pix, senha do Wi-Fi) e compartilhar */
(() => {
  const toast = m => { const t = document.createElement("div"); t.className = "toast"; t.textContent = m; document.body.appendChild(t); setTimeout(() => t.remove(), 2200); };
  const slug = location.pathname.split("/")[2];
  document.addEventListener("click", async e => {
    const c = e.target.closest("[data-copia]");
    if (c) {
      try { await navigator.clipboard.writeText(c.dataset.copia); toast("Copiado!"); } catch (err) { prompt("Copie:", c.dataset.copia); }
      if (c.dataset.item) fetch(`/l/${slug}/c/${c.dataset.item}`, { method: "POST", keepalive: true }).catch(() => {});
      return;
    }
    const s = e.target.closest("[data-share]");
    if (s) {
      const dados = { title: s.dataset.titulo, url: s.dataset.share };
      if (navigator.share) { try { await navigator.share(dados); } catch (err) {} }
      else { try { await navigator.clipboard.writeText(dados.url); toast("Link copiado!"); } catch (err) { prompt("Copie o link:", dados.url); } }
    }
  });
})();

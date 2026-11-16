/* Página de links do Instagram: WhatsApp e fotos do catálogo vêm da loja */
(() => {
  const $ = s => document.querySelector(s);
  let zap = "5541987440009";
  const linkZap = msg => `https://wa.me/${zap}?text=${encodeURIComponent(msg)}`;
  const ligaZap = () => {
    $("#lkZap").href = linkZap("Olá! Vi o Instagram da 8ON. Sou de uma empresa e quero algo personalizado sob encomenda.");
    $("#lkVideo").href = linkZap("Olá! Vi o Instagram da 8ON e quero um orçamento de vídeo / marketing.");
  };
  ligaZap();

  fetch("/api/publico/catalogo").then(r => r.ok ? r.json() : null).then(d => {
    if (!d) return;
    const n = String(d.loja?.whatsapp || "").replace(/\D/g, "");
    if (n.length >= 10) { zap = n.length <= 11 ? "55" + n : n; ligaZap(); }
    // três fotos do catálogo, os mais vendidos primeiro
    const fs = (d.produtos || []).filter(p => p.foto).sort((a, b) => (b.maisVendido ? 1 : 0) - (a.maisVendido ? 1 : 0)).slice(0, 3);
    if (fs.length >= 3) {
      const box = $("#fotos3d"); box.classList.remove("vazio"); box.textContent = "";
      for (const p of fs) { const i = new Image(); i.src = p.foto; i.alt = p.nome; i.loading = "lazy"; box.appendChild(i); }
    }
  }).catch(() => {});

  // contador do "REC" no cartão de vídeo
  const tc = $("#tc"); if (!tc || matchMedia("(prefers-reduced-motion:reduce)").matches) return;
  const t0 = performance.now(), p = n => String(n).padStart(2, "0");
  setInterval(() => { const ms = performance.now() - t0, s = Math.floor(ms / 1000);
    tc.textContent = `00:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}:${p(Math.floor((ms % 1000) / 1000 * 30))}`; }, 1000 / 15);
})();

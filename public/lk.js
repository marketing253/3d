/* Página de links: copiar (Pix, senha do Wi-Fi), compartilhar, QR, vídeo, horário, formulário e eventos do pixel */
(() => {
  const toast = m => { const t = document.createElement("div"); t.className = "toast"; t.textContent = m; document.body.appendChild(t); setTimeout(() => t.remove(), 2200); };
  const slug = location.pathname.split("/")[2];
  const evento = (nome, dados) => { try { if (window.fbq) fbq("trackCustom", nome, dados); if (window.gtag) gtag("event", nome, dados); } catch (e) {} };
  document.addEventListener("click", async e => {
    const c = e.target.closest("[data-copia]");
    if (c) {
      try { await navigator.clipboard.writeText(c.dataset.copia); toast("Copiado!"); } catch (err) { prompt("Copie:", c.dataset.copia); }
      if (c.dataset.item) fetch(`/l/${slug}/c/${c.dataset.item}`, { method: "POST", keepalive: true }).catch(() => {});
      evento("copiar", { botao: c.textContent.trim().slice(0, 60) });
      return;
    }
    const q = e.target.closest("[data-qr]");
    if (q) { const box = q.closest(".pix")?.querySelector(".pixqr"); if (box) { box.hidden = !box.hidden; q.classList.toggle("on", !box.hidden); } return; }
    const v = e.target.closest("[data-video]");
    if (v) { const f = document.createElement("iframe"); f.src = v.dataset.video; f.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen"; f.allowFullscreen = true; f.title = v.getAttribute("aria-label") || "Vídeo"; v.replaceWith(f); evento("video", {}); return; }
    const s = e.target.closest("[data-share]");
    if (s) {
      const dados = { title: s.dataset.titulo, url: s.dataset.share };
      if (navigator.share) { try { await navigator.share(dados); } catch (err) {} }
      else { try { await navigator.clipboard.writeText(dados.url); toast("Link copiado!"); } catch (err) { prompt("Copie o link:", dados.url); } }
      return;
    }
    const a = e.target.closest("a.bt,a.ico,a.catit,a.prod");
    if (a) { const nome = (a.getAttribute("aria-label") || a.textContent).trim().slice(0, 60); evento("clique_botao", { botao: nome }); if (window.fbq && /wa\.me|whatsapp/i.test(a.href + nome)) fbq("track", "Contact"); }
  });

  // horário: "Aberto agora" / "Fechado" no horário de Brasília
  const agoraBR = () => { const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date()).map(x => [x.type, x.value]));
    return { dia: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday), min: +p.hour * 60 + +p.minute }; };
  const mins = h => { const [a, b] = h.split(":").map(Number); return a * 60 + b; };
  const faixas = x => { if (!x || !x.aberto) return []; const l = [[x.abre, x.fecha]]; if (x.abre2 && x.fecha2) l.push([x.abre2, x.fecha2]); return l.map(([a, b]) => { const i = mins(a); let f = mins(b); if (f <= i) f += 1440; return [i, f, b]; }); };
  const NOMES = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
  function statusHorario(dias) {
    const { dia, min } = agoraBR();
    for (const [i, f, fim] of faixas(dias[dia])) if (min >= i && min < f) return { aberto: true, txt: `Aberto agora · fecha às ${fim}` };
    for (const [i, f, fim] of faixas(dias[(dia + 6) % 7])) if (f > 1440 && min < f - 1440) return { aberto: true, txt: `Aberto agora · fecha às ${fim}` };
    for (let k = 0; k < 8; k++) { const d = (dia + k) % 7; for (const [i] of faixas(dias[d])) if (k > 0 || i > min) {
      const h = `${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}`;
      return { aberto: false, txt: `Fechado · abre ${k === 0 ? "hoje" : k === 1 ? "amanhã" : NOMES[d]} às ${h}` }; } }
    return { aberto: false, txt: "Fechado" };
  }
  function atualizaHorarios() {
    document.querySelectorAll("[data-horario]").forEach(el => {
      let dias; try { dias = JSON.parse(el.dataset.horario); } catch (e) { return; }
      const st = statusHorario(dias), b = el.querySelector(".horst"); b.hidden = false; b.textContent = st.txt; b.className = "horst " + (st.aberto ? "on" : "off");
      const hoje = agoraBR().dia; el.querySelectorAll("li").forEach(li => li.classList.toggle("hoje", +li.dataset.dia === hoje));
    });
  }
  atualizaHorarios(); setInterval(atualizaHorarios, 60000);

  // formulário de contato
  document.addEventListener("submit", async e => {
    const f = e.target.closest("form[data-form]"); if (!f) return; e.preventDefault();
    const err = f.querySelector(".ferro"), bt = f.querySelector("button[type=submit]"), dados = Object.fromEntries(new FormData(f));
    err.hidden = true;
    if ((dados.nome || "").trim().length < 2) { err.textContent = "Coloque seu nome."; err.hidden = false; return; }
    if ((dados.whatsapp || "").replace(/\D/g, "").length < 10) { err.textContent = "Coloque o WhatsApp com DDD."; err.hidden = false; return; }
    bt.disabled = true; const txt = bt.textContent; bt.textContent = "Enviando…";
    try {
      const r = await fetch(f.dataset.form, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(dados) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.erro || "Não deu para enviar. Tente de novo.");
      f.hidden = true; const ok = f.nextElementSibling; if (ok && ok.classList.contains("fok")) ok.hidden = false;
      try { if (window.fbq) fbq("track", "Lead"); if (window.gtag) gtag("event", "generate_lead", {}); } catch (x) {}
    } catch (x) { err.textContent = x.message; err.hidden = false; bt.disabled = false; bt.textContent = txt; }
  });
})();

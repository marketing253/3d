// Páginas de links (estilo "link na bio" / cartão NFC) e QR codes dinâmicos.
// Módulo separado do precificador: tabelas lk_*, rotas /api/lk/*, página pública /l/:slug e redirecionamento /q/:codigo.
const crypto = require("crypto");

// cada tema dá as cores-padrão (o que for escolhido à mão tem prioridade)
const TEMAS = {
  azul: { cor: "#2563eb", cor2: "#60a5fa", fundo: ["#0f1d3d", "#1e3a8a"] }, roxo: { cor: "#7c3aed", cor2: "#c084fc", fundo: ["#1e1239", "#4c1d95"] },
  verde: { cor: "#16a34a", cor2: "#4ade80", fundo: ["#0b2416", "#14532d"] }, laranja: { cor: "#ea580c", cor2: "#fb923c", fundo: ["#2a1306", "#7c2d12"] },
  vermelho: { cor: "#dc2626", cor2: "#f87171", fundo: ["#2a0b0b", "#7f1d1d"] }, grafite: { cor: "#374151", cor2: "#6b7280", fundo: ["#0b0f14", "#1f2937"] },
  rosa: { cor: "#db2777", cor2: "#f472b6", fundo: ["#2a0a1c", "#831843"] }, menta: { cor: "#1FBE8C", cor2: "#45D68C", fundo: ["#0E1114", "#12382d"] },
  dourado: { cor: "#b8892d", cor2: "#e6c36a", fundo: ["#15110a", "#3b2e14"] }, claro: { cor: "#111827", cor2: "#374151", fundo: ["#f5f5f4", "#e7e5e4"], claro: true },
};
const FONTES = { inter: ["Inter", "Inter:wght@400;600;700;800"], poppins: ["Poppins", "Poppins:wght@400;600;700"], montserrat: ["Montserrat", "Montserrat:wght@400;600;700;800"],
  nunito: ["Nunito", "Nunito:wght@400;700;800"], playfair: ["Playfair Display", "Playfair+Display:wght@500;700"], sistema: ["system-ui", null] };
const TIPOS = ["link", "whatsapp", "instagram", "tiktok", "facebook", "youtube", "email", "telefone", "localizacao", "avaliacao", "pdf", "pix", "wifi", "contato", "texto", "produto", "imagem", "galeria", "espacador", "titulo"];
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/;
const RESERVADOS = new Set(["admin", "api", "novo", "nova", "editar", "q", "l", "p"]);

module.exports = function instalar({ app, db, exigeLogin, exigeEdicao, rateLimit, QRCode, FOTOS_DIR, FOTO_RE, pixPayload, origemUrl, path, lojaConfig }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS lk_paginas (id TEXT PRIMARY KEY, slug TEXT UNIQUE NOT NULL, dados TEXT NOT NULL, criado_em TEXT NOT NULL DEFAULT (datetime('now')), atualizado_em TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS lk_qr (id TEXT PRIMARY KEY, codigo TEXT UNIQUE NOT NULL, dados TEXT NOT NULL, criado_em TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS lk_eventos (ref TEXT NOT NULL, item TEXT NOT NULL DEFAULT '', dia TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (ref, item, dia));
  `);
  const txt = (v, max = 200) => String(v ?? "").trim().slice(0, max);
  const num = v => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
  const faixa = (v, a, b, pad) => { const x = Number(v); return Number.isFinite(x) ? Math.max(a, Math.min(b, Math.round(x))) : pad; };
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const urlOk = u => { try { const x = new URL(String(u || "").trim()); return /^https?:$/.test(x.protocol) ? x.href : ""; } catch { return ""; } };
  const foto = f => (typeof f === "string" && FOTO_RE.test(f) ? f : "");
  const cor = c => (/^#[0-9a-f]{6}$/i.test(c || "") ? c : "");
  const um = (v, lista, pad) => (lista.includes(v) ? v : pad);
  const hoje = () => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10); // dia em Brasília
  const conta = db.prepare("INSERT INTO lk_eventos (ref, item, dia, n) VALUES (?, ?, ?, 1) ON CONFLICT(ref, item, dia) DO UPDATE SET n = n + 1");
  const registra = (ref, item = "") => { try { conta.run(ref, item, hoje()); } catch (e) {} };
  const limite = rateLimit({ windowMs: 60 * 1000, limit: 240, standardHeaders: "draft-7", legacyHeaders: false });

  // ---------- limpeza dos dados vindos do painel ----------
  function limpaItem(i) {
    const tipo = TIPOS.includes(i?.tipo) ? i.tipo : null; if (!tipo) return null;
    const o = { id: /^[a-z0-9]{6,16}$/.test(i.id || "") ? i.id : crypto.randomBytes(5).toString("hex"), tipo, ativo: i.ativo !== false, titulo: txt(i.titulo, 80),
      destaque: um(i.destaque, ["", "pulsar", "brilho", "balancar"], "") };
    if (["instagram", "tiktok", "facebook", "youtube", "whatsapp", "email", "link", "telefone", "localizacao"].includes(tipo)) o.modo = i.modo === "icone" ? "icone" : "botao";
    if (tipo === "avaliacao") o.coresGoogle = i.coresGoogle !== false;
    const t = (k, m) => (o[k] = txt(i[k], m));
    if (["link", "youtube", "avaliacao", "pdf", "facebook"].includes(tipo)) o.url = urlOk(i.url);
    if (tipo === "whatsapp") { const v = txt(i.numero, 200); o.numero = /chat\.whatsapp\.com|wa\.me|whatsapp\.com/i.test(v) ? urlOk(v) : v.replace(/\D/g, "").slice(0, 15); t("mensagem", 300); }
    if (tipo === "telefone") o.numero = txt(i.numero, 25).replace(/[^\d+]/g, "");
    if (tipo === "instagram" || tipo === "tiktok") o.usuario = txt(i.usuario, 40).replace(/^@/, "").replace(/[^\w.]/g, "");
    if (tipo === "email") { o.email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(txt(i.email, 120)) ? txt(i.email, 120) : ""; t("assunto", 120); }
    if (tipo === "localizacao") { o.url = urlOk(i.url); t("endereco", 200); }
    if (tipo === "avaliacao") { t("nomeLocal", 80); t("endereco", 200); }
    if (tipo === "pix") { t("chave", 77); o.tipoChave = um(i.tipoChave, ["auto", "cpf", "cnpj", "email", "telefone", "aleatoria"], "auto"); t("nome", 25); t("cidade", 15); }
    if (tipo === "wifi") { t("rede", 32); t("senha", 63); o.seguranca = um(i.seguranca, ["WPA", "WEP", "nopass"], "WPA"); }
    if (tipo === "contato") { t("nome", 80); t("telefone", 25); t("email", 120); t("empresa", 80); t("cargo", 60); o.site = urlOk(i.site); }
    if (tipo === "texto") t("texto", 1500);
    if (tipo === "produto") { o.preco = Math.max(0, Math.round(num(i.preco) * 100) / 100); o.foto = foto(i.foto); o.url = urlOk(i.url); t("descricao", 200); }
    if (tipo === "imagem") { o.foto = foto(i.foto); o.url = urlOk(i.url); }
    if (tipo === "galeria") o.fotos = (Array.isArray(i.fotos) ? i.fotos : []).map(foto).filter(Boolean).slice(0, 12);
    if (tipo === "espacador") o.altura = faixa(i.altura, 4, 120, 24);
    return o;
  }
  function limpaPagina(b) {
    const d = b && typeof b === "object" ? b : {}, ds = d.design || {};
    return {
      titulo: txt(d.titulo, 80) || "Minha página", mostrarTitulo: d.mostrarTitulo !== false, descricao: txt(d.descricao, 300), ogImagem: foto(d.ogImagem),
      logo: foto(d.logo), logoForma: um(d.logoForma, ["redondo", "quadrado", "arredondado", "inteira"], "redondo"), logoTam: um(d.logoTam, ["p", "m", "g"], "m"),
      logoZoom: faixa(d.logoZoom, 100, 300, 100), logoX: faixa(d.logoX, 0, 100, 50), logoY: faixa(d.logoY, 0, 100, 50), logoBorda: d.logoBorda !== false, logoFundo: d.logoFundo !== false,
      design: {
        tema: TEMAS[ds.tema] ? ds.tema : "azul", fonte: FONTES[ds.fonte] ? ds.fonte : "poppins",
        corBotao: cor(ds.corBotao || ds.cor), corTexto: cor(ds.corTexto), corBotao2: cor(ds.corBotao2), degrade: !!ds.degrade,
        fundo: um(ds.fundo, ["tema", "cor", "gradiente", "imagem"], "tema"), fundo1: cor(ds.fundo1), fundo2: cor(ds.fundo2), fundoImagem: foto(ds.fundoImagem),
        fundoBlur: faixa(ds.fundoBlur, 0, 30, 6), fundoSobre: um(ds.fundoSobre, ["escura", "clara", "nenhuma"], "escura"), fundoOpac: faixa(ds.fundoOpac, 0, 90, 25),
        botao: um(ds.botao, ["pilula", "arredondado", "quadrado"], "arredondado"), estilo: um(ds.estilo, ["vidro", "cristal", "solido", "contorno", "sombra"], "vidro"),
        pixCor: cor(ds.pixCor), pixTexto: cor(ds.pixTexto),
      },
      rodape: txt(d.rodape, 300), compartilhar: d.compartilhar !== false,
      itens: (Array.isArray(d.itens) ? d.itens : []).slice(0, 60).map(limpaItem).filter(Boolean),
    };
  }
  const slugDe = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50);
  const metr = (ref, dias = 30) => {
    const desde = new Date(Date.now() - (dias - 1) * 86400000 - 3 * 3600000).toISOString().slice(0, 10);
    const rows = db.prepare("SELECT item, dia, n FROM lk_eventos WHERE ref = ? AND dia >= ?").all(ref, desde);
    const total = rows.filter(r => !r.item).reduce((s, r) => s + r.n, 0), porItem = {}, porDia = {};
    for (const r of rows) { if (r.item) porItem[r.item] = (porItem[r.item] || 0) + r.n; else porDia[r.dia] = r.n; }
    const sempre = db.prepare("SELECT COALESCE(SUM(n), 0) t FROM lk_eventos WHERE ref = ? AND item = ''").get(ref).t;
    return { total, sempre, porItem, porDia };
  };
  const linhaPag = r => ({ id: r.id, slug: r.slug, ...limpaPagina(JSON.parse(r.dados)), atualizadoEm: r.atualizado_em, acessos30: metr("p:" + r.id).total });

  // ---------- painel: páginas ----------
  app.get("/api/lk/paginas", exigeLogin, (req, res) => res.json(db.prepare("SELECT * FROM lk_paginas ORDER BY atualizado_em DESC").all().map(linhaPag)));
  app.get("/api/lk/paginas/:id/metricas", exigeLogin, (req, res) => res.json(metr("p:" + req.params.id, Math.min(365, Number(req.query.dias) || 30))));
  app.get("/api/lk/slug", exigeLogin, (req, res) => {
    const s = slugDe(req.query.s), r = s && db.prepare("SELECT id FROM lk_paginas WHERE slug = ?").get(s);
    res.json({ slug: s, livre: !!s && SLUG_RE.test(s) && !RESERVADOS.has(s) && (!r || r.id === req.query.id) });
  });
  app.post("/api/lk/paginas", exigeLogin, exigeEdicao, (req, res) => {
    const d = limpaPagina(req.body); let s = slugDe(req.body?.slug || d.titulo) || "pagina";
    if (RESERVADOS.has(s)) s += "-1";
    let k = 1; const base = s; while (db.prepare("SELECT 1 FROM lk_paginas WHERE slug = ?").get(s)) s = `${base}-${++k}`;
    const id = crypto.randomUUID();
    db.prepare("INSERT INTO lk_paginas (id, slug, dados) VALUES (?, ?, ?)").run(id, s, JSON.stringify(d));
    res.json(linhaPag(db.prepare("SELECT * FROM lk_paginas WHERE id = ?").get(id)));
  });
  app.put("/api/lk/paginas/:id", exigeLogin, exigeEdicao, (req, res) => {
    const r = db.prepare("SELECT * FROM lk_paginas WHERE id = ?").get(req.params.id); if (!r) return res.status(404).json({ erro: "Página não encontrada." });
    let slug = r.slug;
    if (req.body?.slug != null && slugDe(req.body.slug) !== r.slug) {
      slug = slugDe(req.body.slug);
      if (!SLUG_RE.test(slug) || RESERVADOS.has(slug)) return res.status(400).json({ erro: "Endereço inválido. Use letras, números e hífen." });
      if (db.prepare("SELECT 1 FROM lk_paginas WHERE slug = ? AND id != ?").get(slug, r.id)) return res.status(409).json({ erro: "Esse endereço já está em uso." });
    }
    db.prepare("UPDATE lk_paginas SET slug = ?, dados = ?, atualizado_em = datetime('now') WHERE id = ?").run(slug, JSON.stringify(limpaPagina(req.body)), r.id);
    res.json(linhaPag(db.prepare("SELECT * FROM lk_paginas WHERE id = ?").get(r.id)));
  });
  app.delete("/api/lk/paginas/:id", exigeLogin, exigeEdicao, (req, res) => {
    db.prepare("DELETE FROM lk_paginas WHERE id = ?").run(req.params.id);
    db.prepare("DELETE FROM lk_eventos WHERE ref = ?").run("p:" + req.params.id);
    res.json({ ok: true });
  });

  // ---------- painel: QR codes dinâmicos ----------
  const B32 = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // sem 0/O/1/I para não confundir
  const novoCodigo = () => { for (;;) { let c = ""; const b = crypto.randomBytes(6); for (const x of b) c += B32[x % 32]; if (!db.prepare("SELECT 1 FROM lk_qr WHERE codigo = ?").get(c)) return c; } };
  const CODIGO_RE = /^[A-Za-z0-9-]{3,32}$/;
  const limpaQr = b => ({ nome: txt(b?.nome, 80) || "QR code", destinoTipo: b?.destinoTipo === "pagina" ? "pagina" : b?.destinoTipo === "url" ? "url" : "nenhum",
    url: urlOk(b?.url), paginaId: txt(b?.paginaId, 60), obs: txt(b?.obs, 200) });
  const linhaQr = r => ({ id: r.id, codigo: r.codigo, ...JSON.parse(r.dados), criadoEm: r.criado_em, ...(m => ({ scans30: m.total, scansSempre: m.sempre }))(metr("q:" + r.id)) });
  app.get("/api/lk/qr", exigeLogin, (req, res) => res.json(db.prepare("SELECT * FROM lk_qr ORDER BY criado_em DESC").all().map(linhaQr)));
  app.post("/api/lk/qr", exigeLogin, exigeEdicao, (req, res) => {
    const qtd = Math.max(1, Math.min(200, Math.round(num(req.body?.quantidade) || 1))), d = limpaQr(req.body), criados = [];
    const pedido = txt(req.body?.codigo, 32);
    if (pedido && qtd === 1) { if (!CODIGO_RE.test(pedido)) return res.status(400).json({ erro: "Código: de 3 a 32 letras, números ou hífen." });
      if (db.prepare("SELECT 1 FROM lk_qr WHERE codigo = ? COLLATE NOCASE").get(pedido)) return res.status(409).json({ erro: "Esse código já existe." }); }
    db.transaction(() => { for (let i = 0; i < qtd; i++) {
      const id = crypto.randomUUID(), codigo = qtd === 1 && pedido ? pedido : novoCodigo();
      db.prepare("INSERT INTO lk_qr (id, codigo, dados) VALUES (?, ?, ?)").run(id, codigo, JSON.stringify(qtd > 1 ? { ...d, nome: `${d.nome} ${String(i + 1).padStart(String(qtd).length, "0")}` } : d)); criados.push(id);
    } })();
    res.json(criados.map(id => linhaQr(db.prepare("SELECT * FROM lk_qr WHERE id = ?").get(id))));
  });
  app.put("/api/lk/qr/:id", exigeLogin, exigeEdicao, (req, res) => {
    const r = db.prepare("SELECT * FROM lk_qr WHERE id = ?").get(req.params.id); if (!r) return res.status(404).json({ erro: "QR não encontrado." });
    db.prepare("UPDATE lk_qr SET dados = ? WHERE id = ?").run(JSON.stringify(limpaQr(req.body)), r.id);
    res.json(linhaQr(db.prepare("SELECT * FROM lk_qr WHERE id = ?").get(r.id)));
  });
  app.delete("/api/lk/qr/:id", exigeLogin, exigeEdicao, (req, res) => {
    db.prepare("DELETE FROM lk_qr WHERE id = ?").run(req.params.id); db.prepare("DELETE FROM lk_eventos WHERE ref = ?").run("q:" + req.params.id);
    res.json({ ok: true });
  });
  // imagem do QR (qualquer texto/link) para baixar ou imprimir
  app.get("/api/lk/qrimg", exigeLogin, async (req, res) => {
    const t = txt(req.query.t, 600); if (!t) return res.status(400).end();
    const opt = { margin: 2, errorCorrectionLevel: "M", color: { dark: cor(req.query.c) || "#000000", light: "#ffffff" } };
    const nome = txt(req.query.n, 40).replace(/[^\w-]/g, "_") || "qrcode";
    try {
      if (req.query.f === "png") res.type("png").set("Content-Disposition", `attachment; filename="${nome}.png"`).send(await QRCode.toBuffer(t, { ...opt, width: 1200 }));
      else res.type("image/svg+xml").set(req.query.d ? { "Content-Disposition": `attachment; filename="${nome}.svg"` } : {}).send(await QRCode.toString(t, { ...opt, type: "svg" }));
    } catch (e) { res.status(400).end(); }
  });

  // ---------- público: QR dinâmico ----------
  app.get("/q/:codigo", limite, (req, res) => {
    const r = CODIGO_RE.test(req.params.codigo) && db.prepare("SELECT * FROM lk_qr WHERE codigo = ? COLLATE NOCASE").get(req.params.codigo);
    if (!r) return res.status(404).send(paginaAviso("Código não encontrado", "Confira se o código foi digitado certo."));
    const d = JSON.parse(r.dados); registra("q:" + r.id);
    if (d.destinoTipo === "url" && d.url) return res.redirect(302, d.url);
    if (d.destinoTipo === "pagina") { const p = db.prepare("SELECT slug FROM lk_paginas WHERE id = ?").get(d.paginaId); if (p) return res.redirect(302, "/l/" + p.slug); }
    const L = lojaConfig(), wa = String(L.whatsapp || "").replace(/\D/g, "");
    res.send(paginaAviso("Este código ainda não foi ativado", "O produto está pronto, só falta a loja ligar o código a uma página ou link." + (wa ? `<br><br><a class="b" href="https://wa.me/${wa.length <= 11 ? "55" + wa : wa}?text=${encodeURIComponent("Olá! Quero ativar o código " + r.codigo)}">Ativar pelo WhatsApp</a>` : "")));
  });

  // ---------- público: página ----------
  const pagina = slug => db.prepare("SELECT * FROM lk_paginas WHERE slug = ?").get(String(slug).toLowerCase());
  app.get("/l/:slug", limite, async (req, res) => {
    const r = pagina(req.params.slug);
    if (!r) return res.status(404).send(paginaAviso("Página não encontrada", "Confira o endereço."));
    if (!req.query.previa) registra("p:" + r.id);
    const csp = res.get("Content-Security-Policy"); // a prévia do painel mostra a página num iframe do próprio site
    if (csp) res.set("Content-Security-Policy", csp.replace("frame-ancestors 'none'", "frame-ancestors 'self'"));
    res.set("Cache-Control", "no-store").type("html").send(await renderiza(r, origemUrl(req)));
  });
  app.get("/l/:slug/i/:item", limite, (req, res) => { // clique em item (conta e redireciona)
    const r = pagina(req.params.slug); if (!r) return res.status(404).end();
    const i = limpaPagina(JSON.parse(r.dados)).itens.find(x => x.id === req.params.item && x.ativo); if (!i) return res.redirect(302, "/l/" + r.slug);
    const dest = destinoItem(i); if (!dest) return res.redirect(302, "/l/" + r.slug);
    registra("p:" + r.id, i.id); res.redirect(302, dest);
  });
  app.post("/l/:slug/c/:item", limite, (req, res) => { // clique em copiar (Pix, senha): só conta
    const r = pagina(req.params.slug);
    if (r && JSON.parse(r.dados).itens.some(x => x.id === req.params.item)) registra("p:" + r.id, req.params.item);
    res.status(204).end();
  });
  app.get("/l/:slug/v/:item.vcf", limite, (req, res) => { // contato: baixa o cartão (vCard)
    const r = pagina(req.params.slug); if (!r) return res.status(404).end();
    const i = JSON.parse(r.dados).itens.find(x => x.id === req.params.item && x.tipo === "contato"); if (!i) return res.status(404).end();
    registra("p:" + r.id, i.id);
    const v = s => String(s || "").replace(/[\\;,]/g, m => "\\" + m).replace(/\n/g, "\\n");
    const linhas = ["BEGIN:VCARD", "VERSION:3.0", `FN:${v(i.nome || i.titulo)}`, `N:${v(i.nome || i.titulo)};;;;`,
      i.empresa && `ORG:${v(i.empresa)}`, i.cargo && `TITLE:${v(i.cargo)}`, i.telefone && `TEL;TYPE=CELL:${v(i.telefone)}`, i.email && `EMAIL:${v(i.email)}`, i.site && `URL:${v(i.site)}`, "END:VCARD"].filter(Boolean);
    res.set({ "Content-Type": "text/vcard; charset=utf-8", "Content-Disposition": `attachment; filename="${(i.nome || "contato").replace(/[^\w-]+/g, "_")}.vcf"` }).send(linhas.join("\r\n"));
  });
  app.get("/l-img/:nome", limite, (req, res) => { // imagens usadas nas páginas (só as que estão em alguma página)
    const n = req.params.nome; if (!FOTO_RE.test(n) || !db.prepare("SELECT 1 FROM lk_paginas WHERE dados LIKE ?").get("%" + n + "%")) return res.status(404).end();
    res.set("Cache-Control", "public, max-age=604800"); res.sendFile(path.join(FOTOS_DIR, n), e => { if (e && !res.headersSent) res.status(404).end(); });
  });

  function destinoItem(i) {
    switch (i.tipo) {
      case "link": case "youtube": case "avaliacao": case "pdf": case "facebook": case "produto": case "imagem": return i.url;
      case "whatsapp": { if (/^https?:/.test(i.numero)) return i.numero; const n = i.numero.length <= 11 ? "55" + i.numero : i.numero; return n.length >= 12 ? `https://wa.me/${n}${i.mensagem ? "?text=" + encodeURIComponent(i.mensagem) : ""}` : ""; }
      case "instagram": return i.usuario ? "https://instagram.com/" + i.usuario : "";
      case "tiktok": return i.usuario ? "https://www.tiktok.com/@" + i.usuario : "";
      case "email": return i.email ? `mailto:${i.email}${i.assunto ? "?subject=" + encodeURIComponent(i.assunto) : ""}` : "";
      case "telefone": return i.numero ? "tel:" + (i.numero.startsWith("+") ? i.numero : "+55" + i.numero) : "";
      case "localizacao": return i.url || (i.endereco ? "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(i.endereco) : "");
      default: return "";
    }
  }
  const ICONES = {
    link: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    whatsapp: '<path d="M4 20l1.3-4A8 8 0 1 1 8 18.7z"/><path d="M9 9.5c.4 2 2.1 3.9 4.5 4.6l1-1.2 2 .9-.5 1.6c-3.9.2-7.5-3.4-7.3-7.3L10.3 7.6l.9 2z"/>',
    instagram: '<rect x="4" y="4" width="16" height="16" rx="4.5"/><circle cx="12" cy="12" r="3.6"/><circle cx="16.8" cy="7.2" r=".6" fill="currentColor"/>',
    tiktok: '<path d="M14 4v10.5a3.5 3.5 0 1 1-3-3.46M14 4c.5 2.5 2.3 4 5 4"/>',
    facebook: '<path d="M14.5 8H16V4.5h-2.5A3.5 3.5 0 0 0 10 8v2.5H8V14h2v6.5h3.5V14h2.3l.5-3.5h-2.8V8.6c0-.4.3-.6.5-.6z"/>',
    youtube: '<rect x="3" y="6" width="18" height="12" rx="3.5"/><path d="M10.5 9.5v5l4.3-2.5z" fill="currentColor"/>',
    email: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="M4 7l8 6 8-6"/>',
    telefone: '<path d="M6.5 3.5h3l1.5 4-2 1.5a11 11 0 0 0 6 6l1.5-2 4 1.5v3a2 2 0 0 1-2 2A16 16 0 0 1 4.5 5.5a2 2 0 0 1 2-2z"/>',
    localizacao: '<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/>',
    avaliacao: '<path d="M20.5 12.2c0-.6 0-1.2-.2-1.7H12v3.3h4.8a4.1 4.1 0 0 1-1.8 2.7v2.2h2.9c1.7-1.6 2.6-3.9 2.6-6.5z"/><path d="M12 21c2.4 0 4.5-.8 5.9-2.2L15 16.5c-.8.5-1.8.9-3 .9a5.2 5.2 0 0 1-4.9-3.6H4.1v2.3A9 9 0 0 0 12 21z"/><path d="M7.1 13.8a5.4 5.4 0 0 1 0-3.6V7.9h-3a9 9 0 0 0 0 8.2z"/><path d="M12 6.6c1.3 0 2.5.5 3.4 1.3l2.6-2.6A9 9 0 0 0 4.1 7.9l3 2.3A5.2 5.2 0 0 1 12 6.6z"/>',
    google: '<path d="M20 12.2c0-.6-.1-1.1-.2-1.7H12v3.3h4.6a4.6 4.6 0 0 1-2 3"/><path d="M19.4 9A8.5 8.5 0 1 0 20 12.2"/>',
    pdf: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M9.5 14h5M9.5 17h5"/>',
    contato: '<circle cx="12" cy="9" r="3.5"/><path d="M5.5 19c.8-3.2 3.4-5 6.5-5s5.7 1.8 6.5 5"/>',
    wifi: '<path d="M3 9.5a13 13 0 0 1 18 0M6 12.8a8.5 8.5 0 0 1 12 0M9 16a4 4 0 0 1 6 0"/><circle cx="12" cy="19" r="1" fill="currentColor"/>',
    produto: '<path d="M5 8h14l-1.2 11H6.2z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>',
    qr: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M14 14h2v2h-2zM18 18h2v2h-2zM14 18v2M18 14h2"/>',
  };
  const ic = t => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONES[t] || ICONES.link}</svg>`;
  const PIX_LOGO = '<svg class="pixlogo" viewBox="0 0 120 40" aria-label="Pix"><g transform="translate(20 20) rotate(45)"><rect x="-13" y="-13" width="11" height="11" rx="2.5" fill="#32BCAD"/><rect x="2" y="-13" width="11" height="11" rx="2.5" fill="#32BCAD"/><rect x="-13" y="2" width="11" height="11" rx="2.5" fill="#32BCAD"/><rect x="2" y="2" width="11" height="11" rx="2.5" fill="#32BCAD"/></g><text x="44" y="29" font-family="Arial,Helvetica,sans-serif" font-size="28" font-weight="700" fill="#32BCAD" letter-spacing="-1">pix</text></svg>';
  const brl = v => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
  const ROT_CHAVE = { cpf: "Chave CPF", cnpj: "Chave CNPJ", email: "Chave e-mail", telefone: "Chave celular", aleatoria: "Chave aleatória" };
  const tipoChaveDe = i => i.tipoChave !== "auto" ? i.tipoChave : /@/.test(i.chave) ? "email" : /^\+?\d[\d\s().-]{9,}$/.test(i.chave) && i.chave.replace(/\D/g, "").length === 11 && !/[.-]/.test(i.chave) ? "telefone"
    : i.chave.replace(/\D/g, "").length === 11 ? "cpf" : i.chave.replace(/\D/g, "").length === 14 ? "cnpj" : /^[0-9a-f-]{32,36}$/i.test(i.chave) ? "aleatoria" : "";

  async function renderiza(r, origem) {
    const d = limpaPagina(JSON.parse(r.dados)), ds = d.design, T = TEMAS[ds.tema] || TEMAS.azul;
    const c = ds.corBotao || T.cor, c2 = ds.degrade ? (ds.corBotao2 || T.cor2) : c, claroTema = T.claro && ds.fundo === "tema";
    const txtCor = claroTema ? "#111827" : "#ffffff", btnTxt = ds.corTexto || (ds.estilo === "contorno" ? txtCor : "#ffffff");
    const F = FONTES[ds.fonte] || FONTES.inter;
    const fundoBase = ds.fundo === "cor" && ds.fundo1 ? ds.fundo1 : ds.fundo === "gradiente" && ds.fundo1 ? `linear-gradient(160deg,${ds.fundo1},${ds.fundo2 || ds.fundo1})` : `linear-gradient(160deg,${T.fundo[0]},${T.fundo[1]})`;
    const comFoto = ds.fundo === "imagem" && ds.fundoImagem, sobre = ds.fundoSobre === "clara" ? "255,255,255" : "0,0,0";
    const raio = { pilula: "999px", arredondado: "16px", quadrado: "6px" }[ds.botao];
    const grad = `linear-gradient(135deg,${c},${c2})`;
    const BRILHO = "linear-gradient(rgba(255,255,255,.26) 0%,rgba(255,255,255,.09) 24%,rgba(255,255,255,0) 50%),radial-gradient(130% 160% at 12% 2%,rgba(255,255,255,.34) 0%,rgba(255,255,255,.1) 24%,rgba(255,255,255,0) 50%)";
    const SOMBRA_VIDRO = "0 12px 28px rgba(15,23,42,.2),0 5px 12px rgba(15,23,42,.12),inset 0 1px 0 rgba(255,255,255,.4),inset 0 -8px 14px rgba(0,0,0,.1)";
    const btnCss = {
      solido: `background:${grad};color:${btnTxt};border:1px solid rgba(255,255,255,.12);box-shadow:0 6px 18px ${rgba(c, .28)}`,
      vidro: `background:${BRILHO},linear-gradient(135deg,${rgba(c, .9)},${rgba(c2, .82)});color:${btnTxt};border:1px solid rgba(255,255,255,.38);backdrop-filter:blur(10px) saturate(150%);-webkit-backdrop-filter:blur(10px) saturate(150%);box-shadow:${SOMBRA_VIDRO}`,
      cristal: `background:${BRILHO},linear-gradient(135deg,${rgba(c, .34)},${rgba(c2, .16)});color:${btnTxt};border:1px solid rgba(255,255,255,.45);backdrop-filter:blur(18px) saturate(180%);-webkit-backdrop-filter:blur(18px) saturate(180%);box-shadow:${SOMBRA_VIDRO}`,
      contorno: `background:transparent;color:${btnTxt};border:2px solid ${claroTema ? c : "rgba(255,255,255,.9)"}`,
      sombra: `background:${grad};color:${btnTxt};border:2px solid rgba(0,0,0,.85);box-shadow:4px 5px 0 rgba(0,0,0,.85)`,
    }[ds.estilo];
    const tam = { p: 92, m: 124, g: 160 }[d.logoTam];
    const formaRaio = { redondo: "50%", quadrado: "10px", arredondado: "26%", inteira: "0" }[d.logoForma];
    const url = origem + "/l/" + r.slug, link = i => `/l/${r.slug}/i/${i.id}`;
    const dest = i => i.destaque ? ` d-${i.destaque}` : "";
    const pixBg = ds.pixCor || "#ffffff", pixTx = ds.pixTexto || c;
    const partes = [];
    let icones = [];
    const fechaIcones = () => { if (icones.length) partes.push(`<div class="icones">${icones.join("")}</div>`); icones = []; };
    for (const i of d.itens.filter(x => x.ativo)) {
      const tit = esc(i.titulo);
      if (i.modo === "icone" && destinoItem(i)) { icones.push(`<a class="ico" href="${link(i)}" target="_blank" rel="noopener" aria-label="${tit || i.tipo}">${ic(i.tipo)}</a>`); continue; }
      fechaIcones();
      if (["link", "whatsapp", "instagram", "tiktok", "facebook", "youtube", "email", "telefone", "localizacao", "avaliacao", "pdf"].includes(i.tipo)) {
        if (destinoItem(i)) partes.push(`<a class="bt${dest(i)}${i.tipo === "avaliacao" && i.coresGoogle ? " google" : ""}" href="${link(i)}" target="_blank" rel="noopener">${ic(i.tipo === "avaliacao" ? "google" : i.tipo)}<span>${tit || i.tipo}</span></a>`); continue; }
      if (i.tipo === "titulo") partes.push(`<h2 class="sec">${tit}</h2>`);
      if (i.tipo === "texto" && i.texto) partes.push(`<p class="tx">${esc(i.texto).replace(/\n/g, "<br>")}</p>`);
      if (i.tipo === "espacador") partes.push(`<div style="height:${i.altura}px"></div>`);
      if (i.tipo === "contato" && (i.nome || i.telefone)) partes.push(`<a class="bt${dest(i)}" href="/l/${r.slug}/v/${i.id}.vcf">${ic("contato")}<span>${tit || "Salvar contato"}</span></a>`);
      if (i.tipo === "imagem" && i.foto) partes.push(i.url ? `<a class="img" href="${link(i)}" target="_blank" rel="noopener"><img src="/l-img/${i.foto}" alt="${tit}" loading="lazy"></a>` : `<div class="img"><img src="/l-img/${i.foto}" alt="${tit}" loading="lazy"></div>`);
      if (i.tipo === "galeria" && i.fotos.length) partes.push(`${tit ? `<h2 class="sec">${tit}</h2>` : ""}<div class="gal">${i.fotos.map(f => `<img src="/l-img/${f}" alt="" loading="lazy">`).join("")}</div>`);
      if (i.tipo === "produto") partes.push(`<${i.url ? `a href="${link(i)}" target="_blank" rel="noopener"` : "div"} class="prod">${i.foto ? `<img src="/l-img/${i.foto}" alt="" loading="lazy">` : `<span class="pi">${ic("produto")}</span>`}<span class="pt"><b>${tit}</b>${i.descricao ? `<small>${esc(i.descricao)}</small>` : ""}${i.preco ? `<em>${brl(i.preco)}</em>` : ""}</span></${i.url ? "a" : "div"}>`);
      if (i.tipo === "pix" && i.chave) {
        let qr = ""; try { qr = await QRCode.toString(pixPayload({ chave: i.chave, nome: i.nome || d.titulo, cidade: i.cidade || "BRASIL", valor: 0, txid: "LINK" }), { type: "svg", margin: 1 }); } catch (e) {}
        const tc = tipoChaveDe(i), oculta = tc === "aleatoria";
        partes.push(`<div class="pix"><div class="pixtop">${PIX_LOGO}${qr ? `<button class="pixqrbt" type="button" data-qr aria-label="Mostrar QR code do Pix">${ic("qr")}</button>` : ""}</div>
          ${qr ? `<div class="pixqr" hidden>${qr}<small>Abra o app do banco e leia o QR</small></div>` : ""}
          <div class="pixch"><small>${ROT_CHAVE[tc] || "Chave Pix"}</small><b>${oculta ? "••••••••" : esc(i.chave)}</b></div>
          <button class="bt pixcp" type="button" data-copia="${esc(i.chave)}" data-item="${i.id}">${tit && tit !== "Pix" ? tit : "Copiar Chave Pix"}</button></div>`);
      }
      if (i.tipo === "wifi" && i.rede) {
        const e = s => String(s).replace(/([\\;,:"])/g, "\\$1");
        let qr = ""; try { qr = await QRCode.toString(`WIFI:T:${i.seguranca};S:${e(i.rede)};${i.seguranca !== "nopass" ? `P:${e(i.senha)};` : ""};`, { type: "svg", margin: 1 }); } catch (err) {}
        partes.push(`<div class="pix"><div class="pixtop"><span class="wftit">${ic("wifi")}<b>${tit || "Wi-Fi"}</b></span>${qr ? `<button class="pixqrbt" type="button" data-qr aria-label="Mostrar QR code do Wi-Fi">${ic("qr")}</button>` : ""}</div>
          ${qr ? `<div class="pixqr" hidden>${qr}<small>Aponte a câmera para conectar</small></div>` : ""}
          <div class="pixch"><small>Rede</small><b>${esc(i.rede)}</b>${i.senha && i.seguranca !== "nopass" ? `<small style="margin-top:6px">Senha</small><b>${esc(i.senha)}</b>` : ""}</div>
          ${i.senha && i.seguranca !== "nopass" ? `<span class="wfdica">Toque para copiar a senha do Wi-Fi:</span><button class="bt pixcp" type="button" data-copia="${esc(i.senha)}" data-item="${i.id}">Copiar senha</button>` : ""}</div>`);
      }
    }
    fechaIcones();
    const logoHtml = d.logo ? `<div class="logo${d.logoForma === "inteira" ? " inteira" : ""}"><img src="/l-img/${d.logo}" alt="${esc(d.titulo)}"></div>` : "";
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(d.titulo)}</title><meta name="description" content="${esc(d.descricao || d.titulo)}">
<meta property="og:title" content="${esc(d.titulo)}"><meta property="og:description" content="${esc(d.descricao || "")}">${d.ogImagem || d.logo ? `<meta property="og:image" content="${origem}/l-img/${d.ogImagem || d.logo}">` : ""}
<meta name="theme-color" content="${claroTema ? "#f5f5f4" : T.fundo[0]}">${d.logo ? `<link rel="icon" href="/l-img/${d.logo}">` : ""}
${F[1] ? `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${F[1]}&display=swap">` : ""}
<style>
*{box-sizing:border-box;margin:0}html{-webkit-text-size-adjust:100%}
body{min-height:100vh;background:${fundoBase};background-color:${T.fundo[0]};color:${txtCor};font:15px/1.45 "${F[0]}",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;position:relative;overflow-x:hidden}
${comFoto ? `body::before{content:"";position:fixed;inset:-40px;background:url(/l-img/${ds.fundoImagem}) center/cover no-repeat;filter:blur(${ds.fundoBlur}px);transform:scale(1.06);z-index:-2}
body::after{content:"";position:fixed;inset:0;background:rgba(${sobre},${ds.fundoSobre === "nenhuma" ? 0 : ds.fundoOpac / 100});z-index:-1}` : ""}
.w{max-width:480px;margin:0 auto;padding:44px 18px 36px;display:flex;flex-direction:column;align-items:center;gap:14px}
.logo{width:${tam}px;height:${tam}px;border-radius:${formaRaio};overflow:hidden;flex:none;${d.logoFundo ? "background:#fff;" : ""}${d.logoBorda ? "border:4px solid rgba(255,255,255,.92);box-shadow:0 14px 40px rgba(0,0,0,.28);" : ""}}
.logo img{width:100%;height:100%;display:block;object-fit:cover;object-position:${d.logoX}% ${d.logoY}%;transform:scale(${d.logoZoom / 100});transform-origin:${d.logoX}% ${d.logoY}%}
.logo.inteira{width:auto;height:auto;max-width:${Math.round(tam * 1.9)}px;border-radius:0;background:none;border:0;box-shadow:none;overflow:visible}
.logo.inteira img{width:auto;max-width:100%;height:auto;max-height:${tam}px;object-fit:contain;transform:none;filter:drop-shadow(0 8px 20px rgba(0,0,0,.25))}
h1{font-size:23px;font-weight:800;text-align:center;letter-spacing:-.01em;margin-top:2px}.ds{text-align:center;opacity:.88;max-width:360px;white-space:pre-line}
.share{display:inline-flex;align-items:center;gap:7px;font:600 13px inherit;font-family:inherit;padding:7px 15px;border-radius:99px;border:1px solid ${claroTema ? "rgba(0,0,0,.18)" : "rgba(255,255,255,.55)"};background:${claroTema ? "rgba(255,255,255,.7)" : "rgba(255,255,255,.08)"};color:inherit;cursor:pointer;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
.lista{width:100%;display:flex;flex-direction:column;gap:12px;margin-top:6px}
.bt{display:flex;align-items:center;justify-content:center;width:100%;min-height:56px;padding:14px 52px;border-radius:${raio};${btnCss};font-family:inherit;font-weight:700;font-size:15.5px;text-decoration:none;cursor:pointer;position:relative;overflow:hidden;transition:transform .15s ease,filter .15s ease;-webkit-tap-highlight-color:transparent}
.bt:hover{filter:brightness(1.06)}.bt:active{transform:scale(.97)}.bt svg{width:22px;height:22px;position:absolute;left:20px;top:50%;margin-top:-11px}.bt span{text-align:center;line-height:1.25}
.d-pulsar{animation:pulsar 1.8s ease-in-out infinite}@keyframes pulsar{50%{transform:scale(1.035)}}
.d-balancar{animation:balancar 3.2s ease-in-out infinite}@keyframes balancar{0%,80%,100%{transform:rotate(0)}84%{transform:rotate(-2.5deg)}88%{transform:rotate(2.5deg)}92%{transform:rotate(-1.5deg)}96%{transform:rotate(1deg)}}
.d-brilho::after{content:"";position:absolute;top:0;left:-70%;width:45%;height:100%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.55),transparent);transform:skewX(-20deg);animation:brilho 2.8s ease-in-out infinite}@keyframes brilho{0%,50%{left:-70%}100%{left:130%}}
.icones{display:flex;justify-content:center;flex-wrap:wrap;gap:22px;margin:2px 0 4px}
.ico{width:46px;height:46px;display:grid;place-items:center;color:${claroTema ? c : "#fff"};transition:transform .15s}.ico:active{transform:scale(.9)}.ico svg{width:40px;height:40px;stroke-width:2;filter:drop-shadow(0 3px 8px rgba(0,0,0,.25))}
.bt.google{background:${BRILHO},linear-gradient(90deg,#4285F4 0%,#5b8def 30%,#EA4335 72%,#e8513c 100%);color:#fff;border:1px solid rgba(255,255,255,.35);box-shadow:${SOMBRA_VIDRO}}
.bt.pixcp{min-height:50px;padding:12px 18px;margin-top:2px}.wfdica{font-size:12px;opacity:.8;color:${pixTx}}
.sec{font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:.12em;opacity:.85;margin:12px 0 0;text-align:center}.tx{text-align:center;opacity:.92;padding:0 6px}
.img{display:block;width:100%}.img img{width:100%;border-radius:18px;display:block;box-shadow:0 10px 30px rgba(0,0,0,.2)}
.gal{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;width:100%}.gal img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:12px}
.prod{display:flex;gap:12px;align-items:center;width:100%;padding:10px;border-radius:18px;background:${claroTema ? "#fff" : "rgba(255,255,255,.12)"};backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);color:inherit;text-decoration:none;border:1px solid ${claroTema ? "rgba(0,0,0,.08)" : "rgba(255,255,255,.25)"}}
.prod img,.prod .pi{width:76px;height:76px;border-radius:14px;object-fit:cover;flex:none;display:grid;place-items:center;background:rgba(255,255,255,.15)}.prod .pi svg{width:30px}
.pt{display:flex;flex-direction:column;gap:2px;min-width:0}.pt small{opacity:.8}.pt em{font-style:normal;font-weight:800;font-size:16px;color:${claroTema ? c : "#fff"}}
.pix{width:100%;max-width:340px;align-self:center;background:${pixBg};color:#1f2937;border-radius:20px;padding:16px 16px 14px;display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center;box-shadow:0 14px 36px rgba(0,0,0,.25)}
.pixtop{display:flex;align-items:center;justify-content:center;width:100%;position:relative;min-height:40px}.pixlogo{height:34px;width:auto}
.pixqrbt{position:absolute;right:0;top:50%;transform:translateY(-50%);width:36px;height:36px;border-radius:10px;border:1px solid rgba(0,0,0,.1);background:${rgba(pixTx, .08)};color:${pixTx};display:grid;place-items:center;cursor:pointer}.pixqrbt svg{width:20px;height:20px}
.pixqr{display:flex;flex-direction:column;align-items:center;gap:4px}.pixqr[hidden]{display:none}.pixqr svg{width:190px;height:auto}.pixqr small{font-size:12px;color:#6b7280}
.pixch{width:100%;border:1px solid rgba(0,0,0,.08);background:${rgba(pixTx, .05)};border-radius:12px;padding:9px 10px;display:flex;flex-direction:column;gap:1px}
.pixch small{font-size:12px;color:${pixTx};opacity:.85}.pixch b{font:800 15px ui-monospace,Consolas,monospace;color:${pixTx};word-break:break-all}
.pixcp{width:100%;cursor:pointer}
.wftit{display:flex;align-items:center;gap:8px;font-size:16px;color:${pixTx}}.wftit svg{width:24px;height:24px}
.rod{margin-top:24px;text-align:center;font-size:13px;opacity:.8;white-space:pre-line}
.toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:rgba(17,17,17,.92);color:#fff;padding:10px 18px;border-radius:12px;font-size:14px;z-index:9}
@media (prefers-reduced-motion:reduce){.d-pulsar,.d-balancar,.d-brilho::after{animation:none}}
</style></head><body><main class="w">
${logoHtml}${d.mostrarTitulo ? `<h1>${esc(d.titulo)}</h1>` : ""}${d.descricao ? `<p class="ds">${esc(d.descricao)}</p>` : ""}
${d.compartilhar ? `<button class="share" type="button" data-share="${esc(url)}" data-titulo="${esc(d.titulo)}"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4"/></svg>Compartilhar</button>` : ""}
<div class="lista">${partes.join("\n")}</div>${d.rodape ? `<p class="rod">${esc(d.rodape)}</p>` : ""}
</main><script src="/lk.js" defer></script></body></html>`;
  }
  function paginaAviso(t, m) {
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(t)}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0E1114;color:#F1F6F4;font:16px/1.5 system-ui,sans-serif;padding:20px;text-align:center}.c{max-width:380px}h1{font-size:22px}.b{display:inline-block;background:#1FBE8C;color:#06130F;padding:12px 20px;border-radius:12px;font-weight:700;text-decoration:none}</style></head>
<body><div class="c"><h1>${esc(t)}</h1><p>${m}</p></div></body></html>`;
  }
  return {};
};

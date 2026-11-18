// Páginas de links (estilo "link na bio" / cartão NFC) e QR codes dinâmicos.
// Módulo separado do precificador: tabelas lk_*, rotas /api/lk/*, página pública /l/:slug e redirecionamento /q/:codigo.
const crypto = require("crypto");

const TEMAS = {
  azul: { cor: "#2563eb", fundo: ["#0f1d3d", "#1e3a8a"] }, roxo: { cor: "#7c3aed", fundo: ["#1e1239", "#4c1d95"] },
  verde: { cor: "#16a34a", fundo: ["#0b2416", "#14532d"] }, laranja: { cor: "#ea580c", fundo: ["#2a1306", "#7c2d12"] },
  vermelho: { cor: "#dc2626", fundo: ["#2a0b0b", "#7f1d1d"] }, grafite: { cor: "#374151", fundo: ["#0b0f14", "#1f2937"] },
  rosa: { cor: "#db2777", fundo: ["#2a0a1c", "#831843"] }, menta: { cor: "#1FBE8C", fundo: ["#0E1114", "#12382d"] },
  claro: { cor: "#111827", fundo: ["#f5f5f4", "#e7e5e4"], claro: true },
};
const TIPOS = ["link", "whatsapp", "instagram", "youtube", "email", "avaliacao", "pdf", "pix", "wifi", "contato", "texto", "produto", "imagem", "galeria", "espacador", "titulo"];
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
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const urlOk = u => { try { const x = new URL(String(u || "").trim()); return /^https?:$/.test(x.protocol) ? x.href : ""; } catch { return ""; } };
  const foto = f => (typeof f === "string" && FOTO_RE.test(f) ? f : "");
  const cor = c => (/^#[0-9a-f]{6}$/i.test(c || "") ? c : "");
  const hoje = () => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10); // dia em Brasília
  const conta = db.prepare("INSERT INTO lk_eventos (ref, item, dia, n) VALUES (?, ?, ?, 1) ON CONFLICT(ref, item, dia) DO UPDATE SET n = n + 1");
  const registra = (ref, item = "") => { try { conta.run(ref, item, hoje()); } catch (e) {} };
  const limite = rateLimit({ windowMs: 60 * 1000, limit: 240, standardHeaders: "draft-7", legacyHeaders: false });

  // ---------- limpeza dos dados vindos do painel ----------
  function limpaItem(i) {
    const tipo = TIPOS.includes(i?.tipo) ? i.tipo : null; if (!tipo) return null;
    const o = { id: /^[a-z0-9]{6,16}$/.test(i.id || "") ? i.id : crypto.randomBytes(5).toString("hex"), tipo, ativo: i.ativo !== false, titulo: txt(i.titulo, 80) };
    const t = (k, m) => (o[k] = txt(i[k], m));
    if (["link", "youtube", "avaliacao", "pdf"].includes(tipo)) o.url = urlOk(i.url);
    if (tipo === "whatsapp") { o.numero = txt(i.numero, 20).replace(/\D/g, ""); t("mensagem", 300); }
    if (tipo === "instagram") o.usuario = txt(i.usuario, 40).replace(/^@/, "").replace(/[^\w.]/g, "");
    if (tipo === "email") { o.email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(txt(i.email, 120)) ? txt(i.email, 120) : ""; t("assunto", 120); }
    if (tipo === "pix") { t("chave", 77); t("tipoChave", 30); t("nome", 25); t("cidade", 15); o.qr = i.qr !== false; }
    if (tipo === "wifi") { t("rede", 32); t("senha", 63); o.seguranca = ["WPA", "WEP", "nopass"].includes(i.seguranca) ? i.seguranca : "WPA"; }
    if (tipo === "contato") { t("nome", 80); t("telefone", 25); t("email", 120); t("empresa", 80); t("cargo", 60); o.site = urlOk(i.site); }
    if (tipo === "texto") t("texto", 1500);
    if (tipo === "produto") { o.preco = Math.max(0, Math.round(num(i.preco) * 100) / 100); o.foto = foto(i.foto); o.url = urlOk(i.url); t("descricao", 200); }
    if (tipo === "imagem") { o.foto = foto(i.foto); o.url = urlOk(i.url); }
    if (tipo === "galeria") o.fotos = (Array.isArray(i.fotos) ? i.fotos : []).map(foto).filter(Boolean).slice(0, 12);
    if (tipo === "espacador") o.altura = Math.max(4, Math.min(120, Math.round(num(i.altura) || 24)));
    return o;
  }
  function limpaPagina(b) {
    const d = b && typeof b === "object" ? b : {}, ds = d.design || {};
    return {
      titulo: txt(d.titulo, 80) || "Minha página", descricao: txt(d.descricao, 300), logo: foto(d.logo), logoForma: d.logoForma === "quadrado" ? "quadrado" : "redondo",
      design: {
        tema: TEMAS[ds.tema] ? ds.tema : "azul", cor: cor(ds.cor),
        fundo: ["tema", "cor", "gradiente", "imagem"].includes(ds.fundo) ? ds.fundo : "tema", fundo1: cor(ds.fundo1), fundo2: cor(ds.fundo2), fundoImagem: foto(ds.fundoImagem),
        botao: ["pilula", "arredondado", "quadrado"].includes(ds.botao) ? ds.botao : "pilula", estilo: ["solido", "vidro", "contorno"].includes(ds.estilo) ? ds.estilo : "solido",
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
  const linhaPag = r => ({ id: r.id, slug: r.slug, ...JSON.parse(r.dados), atualizadoEm: r.atualizado_em, acessos30: metr("p:" + r.id).total });

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
    let k = 1, base = s; while (db.prepare("SELECT 1 FROM lk_paginas WHERE slug = ?").get(s)) s = `${base}-${++k}`;
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
    let pedido = txt(req.body?.codigo, 32);
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
    try {
      if (req.query.f === "png") { res.type("png").set("Content-Disposition", `attachment; filename="${txt(req.query.n, 40).replace(/[^\w-]/g, "_") || "qrcode"}.png"`).send(await QRCode.toBuffer(t, { ...opt, width: 1200 })); }
      else res.type("image/svg+xml").set(req.query.d ? { "Content-Disposition": `attachment; filename="${txt(req.query.n, 40).replace(/[^\w-]/g, "_") || "qrcode"}.svg"` } : {}).send(await QRCode.toString(t, { ...opt, type: "svg" }));
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
  app.get("/l/:slug", limite, async (req, res) => {
    const r = db.prepare("SELECT * FROM lk_paginas WHERE slug = ?").get(String(req.params.slug).toLowerCase());
    if (!r) return res.status(404).send(paginaAviso("Página não encontrada", "Confira o endereço."));
    if (!req.query.previa) registra("p:" + r.id);
    const csp = res.get("Content-Security-Policy"); // a prévia do painel mostra a página num iframe do próprio site
    if (csp) res.set("Content-Security-Policy", csp.replace("frame-ancestors 'none'", "frame-ancestors 'self'"));
    res.set("Cache-Control", "no-store").type("html").send(await renderiza(r, origemUrl(req)));
  });
  // clique em item (conta e redireciona)
  app.get("/l/:slug/i/:item", limite, (req, res) => {
    const r = db.prepare("SELECT * FROM lk_paginas WHERE slug = ?").get(String(req.params.slug).toLowerCase()); if (!r) return res.status(404).end();
    const i = JSON.parse(r.dados).itens.find(x => x.id === req.params.item && x.ativo); if (!i) return res.redirect(302, "/l/" + r.slug);
    const dest = destinoItem(i); if (!dest) return res.redirect(302, "/l/" + r.slug);
    registra("p:" + r.id, i.id); res.redirect(302, dest);
  });
  // clique em botão de copiar (Pix, senha do Wi-Fi): só conta
  app.post("/l/:slug/c/:item", limite, (req, res) => {
    const r = db.prepare("SELECT id, dados FROM lk_paginas WHERE slug = ?").get(String(req.params.slug).toLowerCase());
    if (r && JSON.parse(r.dados).itens.some(x => x.id === req.params.item)) registra("p:" + r.id, req.params.item);
    res.status(204).end();
  });
  // contato: baixa o cartão (vCard)
  app.get("/l/:slug/v/:item.vcf", limite, (req, res) => {
    const r = db.prepare("SELECT * FROM lk_paginas WHERE slug = ?").get(String(req.params.slug).toLowerCase()); if (!r) return res.status(404).end();
    const i = JSON.parse(r.dados).itens.find(x => x.id === req.params.item && x.tipo === "contato"); if (!i) return res.status(404).end();
    registra("p:" + r.id, i.id);
    const v = s => String(s || "").replace(/[\\;,]/g, m => "\\" + m).replace(/\n/g, "\\n");
    const linhas = ["BEGIN:VCARD", "VERSION:3.0", `FN:${v(i.nome || i.titulo)}`, `N:${v(i.nome || i.titulo)};;;;`,
      i.empresa && `ORG:${v(i.empresa)}`, i.cargo && `TITLE:${v(i.cargo)}`, i.telefone && `TEL;TYPE=CELL:${v(i.telefone)}`, i.email && `EMAIL:${v(i.email)}`, i.site && `URL:${v(i.site)}`, "END:VCARD"].filter(Boolean);
    res.set({ "Content-Type": "text/vcard; charset=utf-8", "Content-Disposition": `attachment; filename="${(i.nome || "contato").replace(/[^\w-]+/g, "_")}.vcf"` }).send(linhas.join("\r\n"));
  });
  // imagens usadas nas páginas (só as que estão em alguma página)
  app.get("/l-img/:nome", limite, (req, res) => {
    const n = req.params.nome; if (!FOTO_RE.test(n) || !db.prepare("SELECT 1 FROM lk_paginas WHERE dados LIKE ?").get("%" + n + "%")) return res.status(404).end();
    res.set("Cache-Control", "public, max-age=604800"); res.sendFile(path.join(FOTOS_DIR, n), e => { if (e && !res.headersSent) res.status(404).end(); });
  });

  function destinoItem(i) {
    switch (i.tipo) {
      case "link": case "youtube": case "avaliacao": case "pdf": return i.url;
      case "produto": case "imagem": return i.url;
      case "whatsapp": { const n = i.numero.length <= 11 ? "55" + i.numero : i.numero; return n.length >= 12 ? `https://wa.me/${n}${i.mensagem ? "?text=" + encodeURIComponent(i.mensagem) : ""}` : ""; }
      case "instagram": return i.usuario ? "https://instagram.com/" + i.usuario : "";
      case "email": return i.email ? `mailto:${i.email}${i.assunto ? "?subject=" + encodeURIComponent(i.assunto) : ""}` : "";
      default: return "";
    }
  }
  const ICONES = {
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    whatsapp: '<path d="M4 20l1.3-4A8 8 0 1 1 8 18.7z"/><path d="M9 9.5c.4 2 2.1 3.9 4.5 4.6l1-1.2 2 .9-.5 1.6c-3.9.2-7.5-3.4-7.3-7.3L10.3 7.6l.9 2z"/>',
    instagram: '<rect x="4" y="4" width="16" height="16" rx="4.5"/><circle cx="12" cy="12" r="3.6"/><circle cx="16.8" cy="7.2" r=".6" fill="currentColor"/>',
    youtube: '<rect x="3" y="6" width="18" height="12" rx="3.5"/><path d="M10.5 9.5v5l4.3-2.5z" fill="currentColor"/>',
    email: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="M4 7l8 6 8-6"/>',
    avaliacao: '<path d="M12 4l2.4 5 5.4.7-4 3.8 1 5.4L12 16.3 7.2 18.9l1-5.4-4-3.8 5.4-.7z"/>',
    pdf: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M9.5 14h5M9.5 17h5"/>',
    contato: '<circle cx="12" cy="9" r="3.5"/><path d="M5.5 19c.8-3.2 3.4-5 6.5-5s5.7 1.8 6.5 5"/>',
    pix: '<path d="M12 3.5l3.4 3.4-3.4 3.4-3.4-3.4zM12 13.7l3.4 3.4-3.4 3.4-3.4-3.4zM3.5 12l3.4-3.4 3.4 3.4-3.4 3.4zM13.7 12l3.4-3.4 3.4 3.4-3.4 3.4z"/>',
    wifi: '<path d="M3 9.5a13 13 0 0 1 18 0M6 12.8a8.5 8.5 0 0 1 12 0M9 16a4 4 0 0 1 6 0"/><circle cx="12" cy="19" r="1" fill="currentColor"/>',
    produto: '<path d="M5 8h14l-1.2 11H6.2z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>',
  };
  const ic = t => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONES[t] || ICONES.link}</svg>`;
  const brl = v => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  async function renderiza(r, origem) {
    const d = JSON.parse(r.dados), ds = d.design, T = TEMAS[ds.tema] || TEMAS.azul, c = ds.cor || T.cor;
    const fundo = ds.fundo === "imagem" && ds.fundoImagem ? `linear-gradient(rgba(0,0,0,.45),rgba(0,0,0,.6)),url(/l-img/${ds.fundoImagem}) center/cover fixed`
      : ds.fundo === "cor" && ds.fundo1 ? ds.fundo1 : ds.fundo === "gradiente" && ds.fundo1 ? `linear-gradient(160deg,${ds.fundo1},${ds.fundo2 || ds.fundo1})` : `linear-gradient(160deg,${T.fundo[0]},${T.fundo[1]})`;
    const claro = T.claro && (ds.fundo === "tema" || !ds.fundo), txtCor = claro ? "#111827" : "#ffffff";
    const raio = { pilula: "999px", arredondado: "14px", quadrado: "4px" }[ds.botao];
    const btnCss = { solido: `background:${c};color:#fff;border:0`, vidro: `background:rgba(255,255,255,.14);color:${txtCor};border:1px solid rgba(255,255,255,.28);backdrop-filter:blur(8px)`, contorno: `background:transparent;color:${txtCor};border:2px solid ${claro ? c : "rgba(255,255,255,.85)"}` }[ds.estilo];
    const url = origem + "/l/" + r.slug, link = i => `/l/${r.slug}/i/${i.id}`;
    const partes = [];
    for (const i of d.itens.filter(x => x.ativo)) {
      const tit = esc(i.titulo);
      if (["link", "whatsapp", "instagram", "youtube", "email", "avaliacao", "pdf"].includes(i.tipo)) { if (destinoItem(i)) partes.push(`<a class="bt" href="${link(i)}" target="_blank" rel="noopener">${ic(i.tipo)}<span>${tit || i.tipo}</span></a>`); continue; }
      if (i.tipo === "titulo") partes.push(`<h2 class="sec">${tit}</h2>`);
      if (i.tipo === "texto" && i.texto) partes.push(`<p class="tx">${esc(i.texto).replace(/\n/g, "<br>")}</p>`);
      if (i.tipo === "espacador") partes.push(`<div style="height:${i.altura}px"></div>`);
      if (i.tipo === "contato" && (i.nome || i.telefone)) partes.push(`<a class="bt" href="/l/${r.slug}/v/${i.id}.vcf">${ic("contato")}<span>${tit || "Salvar contato"}</span></a>`);
      if (i.tipo === "imagem" && i.foto) partes.push(i.url ? `<a class="img" href="${link(i)}" target="_blank" rel="noopener"><img src="/l-img/${i.foto}" alt="${tit}" loading="lazy"></a>` : `<div class="img"><img src="/l-img/${i.foto}" alt="${tit}" loading="lazy"></div>`);
      if (i.tipo === "galeria" && i.fotos.length) partes.push(`${tit ? `<h2 class="sec">${tit}</h2>` : ""}<div class="gal">${i.fotos.map(f => `<img src="/l-img/${f}" alt="" loading="lazy">`).join("")}</div>`);
      if (i.tipo === "produto") partes.push(`<${i.url ? `a href="${link(i)}" target="_blank" rel="noopener"` : "div"} class="prod">${i.foto ? `<img src="/l-img/${i.foto}" alt="" loading="lazy">` : `<span class="pi">${ic("produto")}</span>`}<span class="pt"><b>${tit}</b>${i.descricao ? `<small>${esc(i.descricao)}</small>` : ""}${i.preco ? `<em>${brl(i.preco)}</em>` : ""}</span></${i.url ? "a" : "div"}>`);
      if (i.tipo === "pix" && i.chave) {
        let qr = ""; try { if (i.qr) qr = await QRCode.toString(pixPayload({ chave: i.chave, nome: i.nome || d.titulo, cidade: i.cidade || "BRASIL", valor: 0, txid: "LINK" }), { type: "svg", margin: 1 }); } catch (e) {}
        partes.push(`<div class="cx"><div class="cxt">${ic("pix")}<b>${tit || "Pix"}</b></div><small>${esc(i.tipoChave || "Chave Pix")}</small><code>${esc(i.chave)}</code>${qr ? `<div class="qr">${qr}</div>` : ""}<button class="bt" type="button" data-copia="${esc(i.chave)}" data-item="${i.id}">Copiar chave Pix</button></div>`);
      }
      if (i.tipo === "wifi" && i.rede) {
        const e = s => String(s).replace(/([\\;,:"])/g, "\\$1");
        let qr = ""; try { qr = await QRCode.toString(`WIFI:T:${i.seguranca};S:${e(i.rede)};${i.seguranca !== "nopass" ? `P:${e(i.senha)};` : ""};`, { type: "svg", margin: 1 }); } catch (err) {}
        partes.push(`<div class="cx"><div class="cxt">${ic("wifi")}<b>${tit || "Wi-Fi"}</b></div><small>Rede</small><code>${esc(i.rede)}</code>${i.senha && i.seguranca !== "nopass" ? `<small>Senha</small><code>${esc(i.senha)}</code>` : ""}<div class="qr">${qr}</div><span class="dica">Aponte a câmera para o QR para conectar</span>${i.senha && i.seguranca !== "nopass" ? `<button class="bt" type="button" data-copia="${esc(i.senha)}" data-item="${i.id}">Copiar senha</button>` : ""}</div>`);
      }
    }
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(d.titulo)}</title><meta name="description" content="${esc(d.descricao || d.titulo)}">
<meta property="og:title" content="${esc(d.titulo)}"><meta property="og:description" content="${esc(d.descricao || "")}">${d.logo ? `<meta property="og:image" content="${origem}/l-img/${d.logo}">` : ""}
<meta name="theme-color" content="${claro ? "#f5f5f4" : T.fundo[0]}">${d.logo ? `<link rel="icon" href="/l-img/${d.logo}">` : ""}
<style>
*{box-sizing:border-box;margin:0}body{min-height:100vh;background:${fundo};background-color:${T.fundo[0]};color:${txtCor};font:15px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.w{max-width:460px;margin:0 auto;padding:40px 16px 32px;display:flex;flex-direction:column;align-items:center;gap:12px}
.logo{width:110px;height:110px;object-fit:cover;border-radius:${d.logoForma === "quadrado" ? "22px" : "50%"};border:3px solid rgba(255,255,255,.85);box-shadow:0 10px 30px rgba(0,0,0,.25);background:#fff}
h1{font-size:22px;text-align:center;margin-top:6px}.ds{text-align:center;opacity:.85;max-width:360px;white-space:pre-line}
.share{display:inline-flex;align-items:center;gap:6px;font:600 13px system-ui;padding:7px 14px;border-radius:99px;border:1px solid ${claro ? "rgba(0,0,0,.2)" : "rgba(255,255,255,.45)"};background:transparent;color:inherit;cursor:pointer}
.lista{width:100%;display:flex;flex-direction:column;gap:10px;margin-top:8px}
.bt{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;min-height:52px;padding:12px 18px;border-radius:${raio};${btnCss};font:600 15px system-ui;text-decoration:none;cursor:pointer;position:relative;transition:transform .15s}
.bt:active{transform:scale(.98)}.bt svg{width:21px;height:21px;position:absolute;left:18px}.bt span{padding:0 26px;text-align:center}
.sec{font-size:15px;text-transform:uppercase;letter-spacing:.08em;opacity:.8;margin:10px 0 0;text-align:center}.tx{text-align:center;opacity:.9}
.img{display:block;width:100%}.img img{width:100%;border-radius:16px;display:block}
.gal{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;width:100%}.gal img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:10px}
.prod{display:flex;gap:12px;align-items:center;width:100%;padding:10px;border-radius:16px;background:${claro ? "#fff" : "rgba(255,255,255,.12)"};color:inherit;text-decoration:none;border:1px solid ${claro ? "rgba(0,0,0,.08)" : "rgba(255,255,255,.18)"}}
.prod img,.prod .pi{width:72px;height:72px;border-radius:12px;object-fit:cover;flex:none;display:grid;place-items:center;background:rgba(255,255,255,.15)}.prod .pi svg{width:30px}
.pt{display:flex;flex-direction:column;gap:2px}.pt small{opacity:.8}.pt em{font-style:normal;font-weight:800;color:${claro ? c : "#fff"}}
.cx{width:100%;background:#fff;color:#111827;border-radius:18px;padding:16px;display:flex;flex-direction:column;align-items:center;gap:4px;text-align:center}
.cxt{display:flex;align-items:center;gap:8px;font-size:16px}.cxt svg{width:22px;color:${c}}.cx small{color:#6b7280;margin-top:6px}.cx code{font:700 15px ui-monospace,Consolas,monospace;word-break:break-all}
.qr{width:170px;margin:8px 0}.qr svg{width:100%;height:auto}.dica{font-size:12px;color:#6b7280}.cx .bt{margin-top:8px;background:${c};color:#fff;border:0;border-radius:${raio}}
.rod{margin-top:22px;text-align:center;font-size:13px;opacity:.75;white-space:pre-line}
.toast{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);background:#111;color:#fff;padding:10px 16px;border-radius:10px;font-size:14px}
</style></head><body><main class="w">
${d.logo ? `<img class="logo" src="/l-img/${d.logo}" alt="${esc(d.titulo)}">` : ""}<h1>${esc(d.titulo)}</h1>${d.descricao ? `<p class="ds">${esc(d.descricao)}</p>` : ""}
${d.compartilhar ? `<button class="share" type="button" data-share="${esc(url)}" data-titulo="${esc(d.titulo)}"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4"/></svg>Compartilhar</button>` : ""}
<div class="lista">${partes.join("\n")}</div>${d.rodape ? `<p class="rod">${esc(d.rodape)}</p>` : ""}
</main><script src="/lk.js" defer></script></body></html>`;
  }
  function paginaAviso(t, m) {
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(t)}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0E1114;color:#F1F6F4;font:16px/1.5 system-ui,sans-serif;padding:20px;text-align:center}.c{max-width:380px}h1{font-size:22px}.b{display:inline-block;background:#1FBE8C;color:#06130F;padding:12px 20px;border-radius:12px;font-weight:700;text-decoration:none}</style></head>
<body><div class="c"><h1>${esc(t)}</h1><p>${m}</p></div></body></html>`;
  }
  // fotos usadas nas páginas (para a limpeza de fotos órfãs não apagar)
  return { fotosUsadas: () => { const s = new Set(); for (const r of db.prepare("SELECT dados FROM lk_paginas").all()) for (const m of r.dados.matchAll(/[a-f0-9]{32}\.(?:jpg|png|webp|gif)/g)) s.add(m[0]); return s; } };
};

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
const TIPOS = ["link", "whatsapp", "instagram", "tiktok", "facebook", "youtube", "email", "telefone", "localizacao", "avaliacao", "pdf", "pix", "wifi", "contato", "texto", "produto", "imagem", "galeria", "espacador", "titulo",
  "horario", "video", "mapa", "formulario", "catalogo"];
const MODELOS = require("./public/lk-modelos.js");
const express = require("express");
const fs = require("fs");
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/;
const RESERVADOS = new Set(["admin", "api", "novo", "nova", "editar", "q", "l", "p"]);

module.exports = function instalar({ app, db, exigeLogin, exigeEdicao, rateLimit, QRCode, FOTOS_DIR, FOTO_RE, pixPayload, origemUrl, path, lojaConfig, produtosPublicos, linkProduto }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS lk_paginas (id TEXT PRIMARY KEY, slug TEXT UNIQUE NOT NULL, dados TEXT NOT NULL, criado_em TEXT NOT NULL DEFAULT (datetime('now')), atualizado_em TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS lk_qr (id TEXT PRIMARY KEY, codigo TEXT UNIQUE NOT NULL, dados TEXT NOT NULL, criado_em TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS lk_contatos (id TEXT PRIMARY KEY, pagina_id TEXT NOT NULL, item TEXT NOT NULL DEFAULT '', dados TEXT NOT NULL, lido INTEGER NOT NULL DEFAULT 0, criado_em TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS lk_meta (chave TEXT PRIMARY KEY, valor TEXT NOT NULL);
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
    if (tipo === "wifi") { t("rede", 32); t("senha", 63); o.seguranca = um(i.seguranca, ["WPA", "WEP", "nopass"], "WPA"); o.ocultarSenha = !!i.ocultarSenha; }
    if (tipo === "contato") { t("nome", 80); t("telefone", 25); t("email", 120); t("empresa", 80); t("cargo", 60); o.site = urlOk(i.site); }
    if (tipo === "texto") t("texto", 1500);
    if (tipo === "produto") { o.preco = Math.max(0, Math.round(num(i.preco) * 100) / 100); o.foto = foto(i.foto); o.url = urlOk(i.url); t("descricao", 200); }
    if (tipo === "imagem") { o.foto = foto(i.foto); o.url = urlOk(i.url); }
    if (tipo === "galeria") o.fotos = (Array.isArray(i.fotos) ? i.fotos : []).map(foto).filter(Boolean).slice(0, 12);
    if (tipo === "espacador") o.altura = faixa(i.altura, 4, 120, 24);
    if (tipo === "horario") {
      const h = v => (/^([01]\d|2[0-3]):[0-5]\d$/.test(v || "") ? v : "");
      o.dias = [0, 1, 2, 3, 4, 5, 6].map(k => { const x = (Array.isArray(i.dias) && i.dias[k]) || {}; return { aberto: !!x.aberto, abre: h(x.abre) || "08:00", fecha: h(x.fecha) || "18:00", abre2: h(x.abre2), fecha2: h(x.fecha2) }; });
      t("obs", 160);
    }
    if (tipo === "video") o.url = urlOk(i.url);
    if (tipo === "mapa") { t("endereco", 200); o.altura = faixa(i.altura, 160, 480, 240); }
    if (tipo === "formulario") { o.pedeEmail = !!i.pedeEmail; o.pedeMensagem = i.pedeMensagem !== false; t("descricao", 200); t("textoBotao", 40); t("textoOk", 200); }
    if (tipo === "catalogo") { t("categoria", 60); o.limite = faixa(i.limite, 1, 24, 6); o.estilo = um(i.estilo, ["grade", "lista"], "grade"); }
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
      metaPixel: /^\d{5,20}$/.test(String(d.metaPixel || "").trim()) ? String(d.metaPixel).trim() : "",
      ga4: /^G-[A-Z0-9]{4,16}$/i.test(String(d.ga4 || "").trim()) ? String(d.ga4).trim().toUpperCase() : "",
      relatorioEmail: /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(txt(d.relatorioEmail, 120)) ? txt(d.relatorioEmail, 120) : "",
      relToken: /^[a-f0-9]{32}$/.test(d.relToken || "") ? d.relToken : "", origem: um(d.origem, ["", "ativacao", "multlinks"], ""),
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
  const metrPeriodo = (ref, ini, fim) => { // ini/fim: AAAA-MM-DD (inclusive)
    const rows = db.prepare("SELECT item, dia, n FROM lk_eventos WHERE ref = ? AND dia >= ? AND dia <= ?").all(ref, ini, fim);
    const porItem = {}, porDia = {}; let total = 0;
    for (const r of rows) { if (r.item) porItem[r.item] = (porItem[r.item] || 0) + r.n; else { porDia[r.dia] = r.n; total += r.n; } }
    return { total, porItem, porDia };
  };
  const contatosNovos = id => db.prepare("SELECT COUNT(*) n FROM lk_contatos WHERE pagina_id = ? AND lido = 0").get(id).n;
  const linhaPag = r => ({ id: r.id, slug: r.slug, ...limpaPagina(JSON.parse(r.dados)), atualizadoEm: r.atualizado_em, acessos30: metr("p:" + r.id).total, contatosNovos: contatosNovos(r.id) });
  const novoToken = () => crypto.randomBytes(16).toString("hex");
  // cria a página (usado pelo painel, pela ativação do cliente e pela importação)
  function criaPagina(dados, slugPedido) {
    const d = limpaPagina(dados); d.relToken = novoToken(); let s = slugDe(slugPedido || d.titulo) || "pagina";
    if (RESERVADOS.has(s) || !SLUG_RE.test(s)) s = (s.slice(0, 46) || "pagina") + "-1";
    let k = 1; const base = s; while (db.prepare("SELECT 1 FROM lk_paginas WHERE slug = ?").get(s)) s = `${base}-${++k}`;
    const id = crypto.randomUUID();
    db.prepare("INSERT INTO lk_paginas (id, slug, dados) VALUES (?, ?, ?)").run(id, s, JSON.stringify(d));
    return db.prepare("SELECT * FROM lk_paginas WHERE id = ?").get(id);
  }

  // ---------- painel: páginas ----------
  app.get("/api/lk/paginas", exigeLogin, (req, res) => res.json(db.prepare("SELECT * FROM lk_paginas ORDER BY atualizado_em DESC").all().map(linhaPag)));
  app.get("/api/lk/paginas/:id/metricas", exigeLogin, (req, res) => res.json(metr("p:" + req.params.id, Math.min(365, Number(req.query.dias) || 30))));
  app.get("/api/lk/slug", exigeLogin, (req, res) => {
    const s = slugDe(req.query.s), r = s && db.prepare("SELECT id FROM lk_paginas WHERE slug = ?").get(s);
    res.json({ slug: s, livre: !!s && SLUG_RE.test(s) && !RESERVADOS.has(s) && (!r || r.id === req.query.id) });
  });
  app.post("/api/lk/paginas", exigeLogin, exigeEdicao, (req, res) => res.json(linhaPag(criaPagina(req.body, req.body?.slug))));
  app.put("/api/lk/paginas/:id", exigeLogin, exigeEdicao, (req, res) => {
    const r = db.prepare("SELECT * FROM lk_paginas WHERE id = ?").get(req.params.id); if (!r) return res.status(404).json({ erro: "Página não encontrada." });
    let slug = r.slug;
    if (req.body?.slug != null && slugDe(req.body.slug) !== r.slug) {
      slug = slugDe(req.body.slug);
      if (!SLUG_RE.test(slug) || RESERVADOS.has(slug)) return res.status(400).json({ erro: "Endereço inválido. Use letras, números e hífen." });
      if (db.prepare("SELECT 1 FROM lk_paginas WHERE slug = ? AND id != ?").get(slug, r.id)) return res.status(409).json({ erro: "Esse endereço já está em uso." });
    }
    const velho = JSON.parse(r.dados), novo = limpaPagina(req.body);
    novo.relToken = /^[a-f0-9]{32}$/.test(velho.relToken || "") ? velho.relToken : novoToken(); novo.origem = velho.origem || "";
    db.prepare("UPDATE lk_paginas SET slug = ?, dados = ?, atualizado_em = datetime('now') WHERE id = ?").run(slug, JSON.stringify(novo), r.id);
    res.json(linhaPag(db.prepare("SELECT * FROM lk_paginas WHERE id = ?").get(r.id)));
  });
  app.delete("/api/lk/paginas/:id", exigeLogin, exigeEdicao, (req, res) => {
    db.prepare("DELETE FROM lk_paginas WHERE id = ?").run(req.params.id);
    db.prepare("DELETE FROM lk_eventos WHERE ref = ?").run("p:" + req.params.id);
    db.prepare("DELETE FROM lk_contatos WHERE pagina_id = ?").run(req.params.id);
    res.json({ ok: true });
  });

  // ---------- painel: contatos do formulário ----------
  const linhaContato = r => ({ id: r.id, paginaId: r.pagina_id, item: r.item, lido: !!r.lido, criadoEm: r.criado_em, ...JSON.parse(r.dados) });
  app.get("/api/lk/contatos", exigeLogin, (req, res) => res.json(db.prepare("SELECT * FROM lk_contatos WHERE pagina_id = ? ORDER BY criado_em DESC LIMIT 500").all(txt(req.query.pagina, 60)).map(linhaContato)));
  app.put("/api/lk/contatos/:id", exigeLogin, exigeEdicao, (req, res) => { db.prepare("UPDATE lk_contatos SET lido = ? WHERE id = ?").run(req.body?.lido === false ? 0 : 1, req.params.id); res.json({ ok: true }); });
  app.delete("/api/lk/contatos/:id", exigeLogin, exigeEdicao, (req, res) => { db.prepare("DELETE FROM lk_contatos WHERE id = ?").run(req.params.id); res.json({ ok: true }); });
  app.get("/api/lk/contatos.csv", exigeLogin, (req, res) => {
    const c = v => `"${String(v ?? "").replace(/"/g, '""')}"`, l = db.prepare("SELECT * FROM lk_contatos WHERE pagina_id = ? ORDER BY criado_em DESC").all(txt(req.query.pagina, 60)).map(linhaContato);
    const linhas = [["Data", "Nome", "WhatsApp", "E-mail", "Mensagem"].join(";"), ...l.map(x => [x.criadoEm, x.nome, x.whatsapp, x.email, x.mensagem].map(c).join(";"))];
    res.set({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="contatos.csv"' }).send("\ufeff" + linhas.join("\r\n"));
  });
  // categorias do catálogo (para o item "Catálogo")
  app.get("/api/lk/categorias", exigeLogin, (req, res) => res.json([...new Set(produtosPublicos().map(x => x.p.categoria || "").filter(Boolean))].sort()));

  // ---------- painel: QR codes dinâmicos ----------
  const B32 = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // sem 0/O/1/I para não confundir
  const novoCodigo = () => { for (;;) { let c = ""; const b = crypto.randomBytes(6); for (const x of b) c += B32[x % 32]; if (!db.prepare("SELECT 1 FROM lk_qr WHERE codigo = ?").get(c)) return c; } };
  const CODIGO_RE = /^[A-Za-z0-9-]{3,32}$/;
  const limpaVisual = v => { v = v && typeof v === "object" ? v : {};
    return { cor: cor(v.cor) || "#000000", fundo: cor(v.fundo) || "#ffffff", corOlho: cor(v.corOlho), modulo: um(v.modulo, ["quadrado", "redondo", "pontos"], "quadrado"),
      olho: v.olho === "redondo" ? "arredondado" : um(v.olho, ["quadrado", "arredondado"], "quadrado"), logo: um(v.logo, ["", "pagina", "foto"], ""), logoFoto: foto(v.logoFoto) }; };
  const limpaQr = b => ({ nome: txt(b?.nome, 80) || "QR code", destinoTipo: b?.destinoTipo === "pagina" ? "pagina" : b?.destinoTipo === "url" ? "url" : "nenhum",
    url: urlOk(b?.url), paginaId: txt(b?.paginaId, 60), obs: txt(b?.obs, 200), ativavel: b?.ativavel !== false, visual: limpaVisual(b?.visual) });
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
    const velho = JSON.parse(r.dados), novo = limpaQr(req.body);
    if (velho.ativadoEm) { novo.ativadoEm = velho.ativadoEm; novo.ativadoPor = velho.ativadoPor; }
    db.prepare("UPDATE lk_qr SET dados = ? WHERE id = ?").run(JSON.stringify(novo), r.id);
    res.json(linhaQr(db.prepare("SELECT * FROM lk_qr WHERE id = ?").get(r.id)));
  });
  app.delete("/api/lk/qr/:id", exigeLogin, exigeEdicao, (req, res) => {
    db.prepare("DELETE FROM lk_qr WHERE id = ?").run(req.params.id); db.prepare("DELETE FROM lk_eventos WHERE ref = ?").run("q:" + req.params.id);
    res.json({ ok: true });
  });
  // QR com visual próprio (cores, módulos redondos, cantos, logo no meio) em SVG
  const rr = (x, y, w, h, r) => { r = Math.min(r, w / 2, h / 2); return r <= 0 ? `M${x} ${y}h${w}v${h}h${-w}z` : `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-(h - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}z`; };
  function logoDataUri(nome) {
    if (!FOTO_RE.test(nome || "")) return "";
    try { const ext = nome.split(".").pop(), mime = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" }[ext]; return `data:${mime};base64,${fs.readFileSync(path.join(FOTOS_DIR, nome)).toString("base64")}`; } catch (e) { return ""; }
  }
  function svgQr(texto, v, logo) {
    v = limpaVisual(v);
    const qr = QRCode.create(texto, { errorCorrectionLevel: logo ? "H" : "M" }), n = qr.modules.size, dados = qr.modules.data, M = 3, tot = n + M * 2;
    const olhoEm = (x, y) => (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7);
    let L = 0; if (logo) { L = Math.round(n * 0.26); if ((n - L) % 2) L++; }
    const a0 = (n - L) / 2, noLogo = (x, y) => L && x >= a0 - 1 && x < a0 + L + 1 && y >= a0 - 1 && y < a0 + L + 1;
    let mods = "";
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      if (!dados[y * n + x] || olhoEm(x, y) || noLogo(x, y)) continue;
      const X = x + M, Y = y + M;
      mods += v.modulo === "pontos" ? `M${X + 0.5} ${Y}a.5 .5 0 1 1 0 1a.5 .5 0 1 1 0-1z` : v.modulo === "redondo" ? rr(X + 0.04, Y + 0.04, 0.92, 0.92, 0.32) : `M${X} ${Y}h1v1h-1z`;
    }
    const co = v.corOlho || v.cor, R = { quadrado: [0, 0, 0], arredondado: [1, 0.6, 0.4] }[v.olho]; // testado: mais redondo que isso, os leitores deixam de achar os cantos
    const olho = (x, y) => `<path fill-rule="evenodd" d="${rr(x, y, 7, 7, R[0])}${rr(x + 1, y + 1, 5, 5, R[1])}"/><path d="${rr(x + 2, y + 2, 3, 3, R[2])}"/>`;
    const lg = logo ? `<path fill="${v.fundo}" d="${rr(a0 + M - 0.5, a0 + M - 0.5, L + 1, L + 1, 1.2)}"/><image href="${logo}" x="${a0 + M + 0.3}" y="${a0 + M + 0.3}" width="${L - 0.6}" height="${L - 0.6}" preserveAspectRatio="xMidYMid meet"/>` : "";
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${tot} ${tot}" width="1000" height="1000"${v.modulo === "quadrado" ? ' shape-rendering="crispEdges"' : ""}><rect width="${tot}" height="${tot}" fill="${v.fundo}"/><path fill="${v.cor}" d="${mods}"/><g fill="${co}">${olho(M, M)}${olho(M + n - 7, M)}${olho(M, M + n - 7)}</g>${lg}</svg>`;
  }
  const logoDoQr = (d, vis) => { const v = limpaVisual(vis); if (v.logo === "foto") return logoDataUri(v.logoFoto);
    if (v.logo === "pagina" && d.destinoTipo === "pagina") { const p = db.prepare("SELECT dados FROM lk_paginas WHERE id = ?").get(d.paginaId); if (p) return logoDataUri(JSON.parse(p.dados).logo); } return ""; };
  // imagem do QR (qualquer texto/link) para baixar ou imprimir
  app.get("/api/lk/qrimg", exigeLogin, async (req, res) => {
    const nomeArq = txt(req.query.n, 40).replace(/[^\w-]/g, "_") || "qrcode";
    if (req.query.qr || req.query.v) { // QR com visual: ?qr=<id> (salvo) ou ?t=<texto>&v=<visual em JSON> (prévia do editor)
      let texto = txt(req.query.t, 600), vis = {}, base = {};
      try { vis = req.query.v ? JSON.parse(String(req.query.v)) : {}; } catch (e) {}
      if (req.query.qr) { const r = db.prepare("SELECT * FROM lk_qr WHERE id = ?").get(String(req.query.qr)); if (!r) return res.status(404).end(); base = JSON.parse(r.dados); texto = origemUrl(req) + "/q/" + r.codigo; if (!req.query.v) vis = base.visual || {}; }
      if (!texto) return res.status(400).end();
      if (req.query.pg) base = { destinoTipo: "pagina", paginaId: String(req.query.pg) };
      try { res.type("image/svg+xml").set("Cache-Control", "no-store").set(req.query.d ? { "Content-Disposition": `attachment; filename="${nomeArq}.svg"` } : {}).send(svgQr(texto, vis, logoDoQr(base, vis))); } catch (e) { res.status(400).end(); }
      return;
    }
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
    if (d.ativavel !== false) return res.send(paginaAtivar(r));
    const L = lojaConfig(), wa = String(L.whatsapp || "").replace(/\D/g, "");
    res.send(paginaAviso("Este código ainda não foi ativado", "O produto está pronto, só falta a loja ligar o código a uma página ou link." + (wa ? `<br><br><a class="b" href="https://wa.me/${wa.length <= 11 ? "55" + wa : wa}?text=${encodeURIComponent("Olá! Quero ativar o código " + r.codigo)}">Ativar pelo WhatsApp</a>` : "")));
  });

  // ---------- público: o cliente ativa o cartão/placa sozinho ----------
  const limiteAtiva = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: "draft-7", legacyHeaders: false });
  app.post("/q/:codigo/ativar", limiteAtiva, express.urlencoded({ extended: false, limit: "10kb" }), (req, res) => {
    const r = CODIGO_RE.test(req.params.codigo) && db.prepare("SELECT * FROM lk_qr WHERE codigo = ? COLLATE NOCASE").get(req.params.codigo);
    if (!r) return res.status(404).send(paginaAviso("Código não encontrado", "Confira se o código foi digitado certo."));
    const q = JSON.parse(r.dados);
    if (q.destinoTipo !== "nenhum" || q.ativavel === false) return res.redirect(303, "/q/" + r.codigo);
    const b = req.body || {};
    if (b.site) return res.redirect(303, "/q/" + r.codigo); // robô (campo escondido preenchido)
    const nome = txt(b.nome, 80), whats = txt(b.whatsapp, 30).replace(/\D/g, ""), insta = txt(b.instagram, 60).replace(/^.*instagram\.com\//i, "").replace(/^@/, "").replace(/[^\w.]/g, "").slice(0, 40);
    const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(txt(b.email, 120)) ? txt(b.email, 120) : "", modelo = MODELOS[b.modelo] ? b.modelo : "branco";
    if (nome.length < 2 || whats.length < 10 || whats.length > 13) return res.send(paginaAtivar(r, "Preencha o nome e um WhatsApp com DDD.", b));
    const M = MODELOS[modelo], dd = { nome, whatsapp: whats, instagram: insta, email };
    const pag = criaPagina({ titulo: nome, design: { ...M.tema }, itens: M.itens(dd).filter(i => i.tipo !== "instagram" || insta), origem: "ativacao" }, nome);
    db.prepare("UPDATE lk_qr SET dados = ? WHERE id = ?").run(JSON.stringify({ ...q, destinoTipo: "pagina", paginaId: pag.id, ativadoEm: new Date().toISOString(), ativadoPor: nome }), r.id);
    res.redirect(303, "/l/" + pag.slug + "?ativado=1");
  });
  // digitar o código ou ler o QR com a câmera
  app.get("/ativar", limite, (req, res) => res.send(paginaBase("Ativar meu cartão", `<h1>Ativar meu cartão ou placa</h1><p>Leia o QR code com a câmera ou digite o código que veio no produto.</p>
    <div class="cam" id="cam" hidden><video id="camv" playsinline muted></video></div><button class="b" type="button" id="camb" hidden>Ler QR com a câmera</button>
    <form id="codf" class="f"><input name="c" id="codi" maxlength="32" placeholder="Código (ex.: 7KQ2M9XA)" autocomplete="off" autocapitalize="characters" required><button class="b" type="submit">Continuar</button></form>`, "/lk-ativar.js")));

  // ---------- público: formulário de contato ----------
  const limiteForm = rateLimit({ windowMs: 10 * 60 * 1000, limit: 8, standardHeaders: "draft-7", legacyHeaders: false, message: { erro: "Muitos envios. Tente daqui a pouco." } });
  app.post("/l/:slug/f/:item", limiteForm, (req, res) => {
    const r = pagina(req.params.slug); if (!r) return res.status(404).json({ erro: "Página não encontrada." });
    const i = limpaPagina(JSON.parse(r.dados)).itens.find(x => x.id === req.params.item && x.tipo === "formulario" && x.ativo); if (!i) return res.status(404).json({ erro: "Formulário não encontrado." });
    const b = req.body || {}; if (b.site) return res.json({ ok: true });
    const d = { nome: txt(b.nome, 80), whatsapp: txt(b.whatsapp, 30).replace(/[^\d+() -]/g, ""), email: i.pedeEmail ? txt(b.email, 120) : "", mensagem: i.pedeMensagem ? txt(b.mensagem, 1000) : "" };
    if (d.nome.length < 2) return res.status(400).json({ erro: "Coloque seu nome." });
    if (d.whatsapp.replace(/\D/g, "").length < 10) return res.status(400).json({ erro: "Coloque o WhatsApp com DDD." });
    if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) return res.status(400).json({ erro: "Confira o e-mail." });
    db.prepare("INSERT INTO lk_contatos (id, pagina_id, item, dados) VALUES (?, ?, ?, ?)").run(crypto.randomUUID(), r.id, i.id, JSON.stringify(d));
    registra("p:" + r.id, i.id); res.json({ ok: true });
  });

  // ---------- relatório mensal (página com link secreto + e-mail) ----------
  const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  const mesAnterior = () => { const d = new Date(Date.now() - 3 * 3600000); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); };
  function dadosRelatorio(r, mes) {
    const d = limpaPagina(JSON.parse(r.dados)), [a, m] = mes.split("-").map(Number), fimDia = new Date(Date.UTC(a, m, 0)).getUTCDate();
    const ini = `${mes}-01`, fim = `${mes}-${String(fimDia).padStart(2, "0")}`, x = metrPeriodo("p:" + r.id, ini, fim);
    const ant = new Date(Date.UTC(a, m - 2, 1)).toISOString().slice(0, 7), fa = new Date(Date.UTC(a, m - 1, 0)).getUTCDate(), xa = metrPeriodo("p:" + r.id, `${ant}-01`, `${ant}-${String(fa).padStart(2, "0")}`);
    const cliques = d.itens.map(i => ({ nome: i.titulo || i.tipo, n: x.porItem[i.id] || 0 })).filter(i => i.n).sort((p, q) => q.n - p.n);
    const contatos = db.prepare("SELECT COUNT(*) n FROM lk_contatos WHERE pagina_id = ? AND substr(criado_em, 1, 7) = ?").get(r.id, mes).n;
    const dias = [...Array(fimDia)].map((_, k) => x.porDia[`${mes}-${String(k + 1).padStart(2, "0")}`] || 0);
    return { d, mes, rotulo: `${MESES[m - 1]} de ${a}`, acessos: x.total, antes: xa.total, cliques, totalCliques: cliques.reduce((s, c) => s + c.n, 0), contatos, dias };
  }
  const variacao = (a, b) => !b ? (a ? "primeiro mês com acessos" : "") : `${a >= b ? "▲" : "▼"} ${Math.abs(Math.round((a - b) / b * 100))}% em relação ao mês anterior`;
  app.get("/l/:slug/relatorio/:token", limite, (req, res) => {
    const r = pagina(req.params.slug), dd = r && JSON.parse(r.dados);
    if (!r || !/^[a-f0-9]{32}$/.test(req.params.token) || dd.relToken !== req.params.token) return res.status(404).send(paginaAviso("Relatório não encontrado", "Confira o link."));
    const mes = /^\d{4}-(0[1-9]|1[0-2])$/.test(req.query.mes || "") ? req.query.mes : mesAnterior(), R = dadosRelatorio(r, mes), max = Math.max(1, ...R.dias);
    const [a, m] = mes.split("-").map(Number), nav = k => new Date(Date.UTC(a, m - 1 + k, 1)).toISOString().slice(0, 7);
    res.set("Cache-Control", "no-store").send(paginaBase("Relatório · " + R.d.titulo, `<div class="rel"><small class="tag">Relatório mensal</small><h1>${esc(R.d.titulo)}</h1>
      <div class="navm"><a href="?mes=${nav(-1)}">‹</a><b>${esc(R.rotulo)}</b><a href="?mes=${nav(1)}">›</a></div>
      <div class="nums"><div><b>${R.acessos}</b><span>acessos</span></div><div><b>${R.totalCliques}</b><span>cliques</span></div><div><b>${R.contatos}</b><span>contatos</span></div></div>
      <p class="var">${esc(variacao(R.acessos, R.antes))}</p>
      <div class="barras">${R.dias.map((n, k) => `<i style="height:${Math.max(3, Math.round(n / max * 90))}px" title="${k + 1}/${m}: ${n}"></i>`).join("")}</div>
      <h2>Cliques por botão</h2>${R.cliques.length ? R.cliques.map(c => `<div class="cl"><span>${esc(c.nome)}</span><b>${c.n}</b></div>`).join("") : "<p>Nenhum clique neste mês.</p>"}
      <p class="rod"><a href="/l/${esc(r.slug)}">Ver a página</a></p></div>`));
  });
  let mailer = null;
  const emailPronto = () => !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
  function transporte() {
    if (!emailPronto()) return null;
    if (!mailer) { const porta = Number(process.env.SMTP_PORT) || 465; mailer = require("nodemailer").createTransport({ host: process.env.SMTP_HOST, port: porta, secure: porta === 465, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } }); }
    return mailer;
  }
  async function enviaRelatorio(r, mes, origem, para) {
    const t = transporte(); if (!t) throw new Error("O envio de e-mail não está configurado no servidor (SMTP).");
    let dd = JSON.parse(r.dados); if (!dd.relToken) { dd.relToken = novoToken(); db.prepare("UPDATE lk_paginas SET dados = ? WHERE id = ?").run(JSON.stringify(dd), r.id); }
    const R = dadosRelatorio(r, mes), link = `${origem}/l/${r.slug}/relatorio/${dd.relToken}?mes=${mes}`, L = lojaConfig();
    const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#111">
      <p style="color:#6b7280;font-size:13px;margin:0">Relatório mensal · ${esc(R.rotulo)}</p><h1 style="font-size:22px;margin:4px 0 16px">${esc(R.d.titulo)}</h1>
      <table style="width:100%;border-collapse:collapse;text-align:center"><tr>${[[R.acessos, "acessos"], [R.totalCliques, "cliques"], [R.contatos, "contatos"]].map(([n, t]) => `<td style="padding:14px;background:#f3f4f6;border:4px solid #fff;border-radius:12px"><b style="font-size:26px;display:block">${n}</b><span style="color:#6b7280;font-size:13px">${t}</span></td>`).join("")}</tr></table>
      <p style="color:#374151;font-size:14px">${esc(variacao(R.acessos, R.antes))}</p>
      ${R.cliques.length ? `<h2 style="font-size:16px;margin:18px 0 6px">Botões mais clicados</h2>${R.cliques.slice(0, 8).map(c => `<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid #e5e7eb;font-size:14px"><span>${esc(c.nome)}</span><b>${c.n}</b></div>`).join("")}` : ""}
      <p style="margin:22px 0"><a href="${link}" style="background:#111827;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:bold">Ver relatório completo</a></p>
      <p style="color:#9ca3af;font-size:12px">${esc(L.nome || "")} · página ${esc(origem.replace(/^https?:\/\//, ""))}/l/${esc(r.slug)}</p></div>`;
    await t.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to: para || R.d.relatorioEmail, subject: `Relatório de ${R.rotulo} · ${R.d.titulo}`, html });
  }
  app.get("/api/lk/email", exigeLogin, (req, res) => res.json({ configurado: emailPronto() }));
  app.post("/api/lk/paginas/:id/relatorio", exigeLogin, exigeEdicao, async (req, res) => {
    const r = db.prepare("SELECT * FROM lk_paginas WHERE id = ?").get(req.params.id); if (!r) return res.status(404).json({ erro: "Página não encontrada." });
    const para = limpaPagina(JSON.parse(r.dados)).relatorioEmail; if (!para) return res.status(400).json({ erro: "Coloque o e-mail do cliente primeiro." });
    try { await enviaRelatorio(r, mesAnterior(), origemUrl(req), para); res.json({ ok: true, para }); } catch (e) { res.status(400).json({ erro: e.message }); }
  });
  // todo dia 1º, a partir das 9h (Brasília), manda o relatório do mês anterior para quem tem e-mail cadastrado
  setInterval(async () => {
    const agora = new Date(Date.now() - 3 * 3600000); if (agora.getUTCDate() !== 1 || agora.getUTCHours() < 9 || !emailPronto()) return;
    const mes = mesAnterior(), origem = process.env.SITE_URL || process.env.PUBLIC_URL || "https://3d.8ondigital.com.br";
    for (const r of db.prepare("SELECT * FROM lk_paginas").all()) {
      const d = limpaPagina(JSON.parse(r.dados)), chave = `rel:${r.id}:${mes}`;
      if (!d.relatorioEmail || db.prepare("SELECT 1 FROM lk_meta WHERE chave = ?").get(chave)) continue;
      try { await enviaRelatorio(r, mes, origem, d.relatorioEmail); db.prepare("INSERT OR REPLACE INTO lk_meta (chave, valor) VALUES (?, ?)").run(chave, new Date().toISOString()); }
      catch (e) { console.error("relatório", r.slug, e.message); }
    }
  }, 30 * 60 * 1000).unref();

  // ---------- painel: importar página do multlinks / Smart Painel ----------
  const HOSTS_IMPORT = /(^|\.)(multlinks\.com|smartpainel\.com\.br)$/i;
  async function baixa(url, max = 8 * 1024 * 1024) {
    const u = new URL(url); if (u.protocol !== "https:" || !HOSTS_IMPORT.test(u.hostname)) throw new Error("endereço não permitido");
    const r = await fetch(u, { redirect: "follow", signal: AbortSignal.timeout(15000), headers: { "User-Agent": "Mozilla/5.0 (importador de links)" } });
    if (!r.ok) throw new Error("HTTP " + r.status); if (!HOSTS_IMPORT.test(new URL(r.url).hostname)) throw new Error("redirecionou para fora");
    const buf = Buffer.from(await r.arrayBuffer()); if (buf.length > max) throw new Error("arquivo grande demais");
    return { buf, tipo: r.headers.get("content-type") || "" };
  }
  async function baixaImagem(url) {
    try { const { buf, tipo } = await baixa(url); const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" }[tipo.split(";")[0].trim()]; if (!ext) return "";
      const nome = crypto.randomBytes(16).toString("hex") + "." + ext; fs.writeFileSync(path.join(FOTOS_DIR, nome), buf); return nome; } catch (e) { return ""; }
  }
  const desc = s => String(s || "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  const atr = (tag, nome) => { const m = tag.match(new RegExp(nome + '="([^"]*)"')); return m ? desc(m[1]) : ""; };
  const hexDe = s => { const m = String(s || "").match(/#[0-9a-f]{6}/gi); return m || []; };
  function itemDeLink(href, titulo) {
    const h = href.toLowerCase();
    if (/wa\.me\/|api\.whatsapp\.com|chat\.whatsapp\.com/.test(h)) { const n = (href.match(/wa\.me\/(\d+)/) || href.match(/phone=(\d+)/) || [])[1]; return { tipo: "whatsapp", titulo, numero: n || href }; }
    if (/instagram\.com\//.test(h)) return { tipo: "instagram", titulo, usuario: (href.match(/instagram\.com\/([\w.]+)/i) || [])[1] || "" };
    if (/tiktok\.com\/@/.test(h)) return { tipo: "tiktok", titulo, usuario: (href.match(/@([\w.]+)/) || [])[1] || "" };
    if (/facebook\.com|fb\.com/.test(h)) return { tipo: "facebook", titulo, url: href };
    if (/youtube\.com|youtu\.be/.test(h)) return { tipo: "youtube", titulo, url: href };
    if (h.startsWith("mailto:")) return { tipo: "email", titulo, email: href.slice(7).split("?")[0] };
    if (h.startsWith("tel:")) return { tipo: "telefone", titulo, numero: href.slice(4) };
    if (/google\.[^/]+\/maps|maps\.app\.goo\.gl|goo\.gl\/maps/.test(h)) return { tipo: "localizacao", titulo, url: href };
    if (/\.pdf($|\?)|pdf_proxy/.test(h)) return { tipo: "pdf", titulo, url: href };
    return { tipo: "link", titulo, url: href };
  }
  app.post("/api/lk/importar", exigeLogin, exigeEdicao, async (req, res) => {
    let u; try { u = new URL(String(req.body?.url || "").trim()); } catch (e) { return res.status(400).json({ erro: "Cole o endereço da página (ex.: https://multlinks.com/minhapagina)." }); }
    if (!/^(www\.)?multlinks\.com$/i.test(u.hostname) || !/^\/[\w-]+\/?$/.test(u.pathname)) return res.status(400).json({ erro: "Por enquanto só importo páginas do multlinks.com." });
    let html; try { html = (await baixa(u.href, 3 * 1024 * 1024)).buf.toString("utf8"); } catch (e) { return res.status(400).json({ erro: "Não consegui abrir a página (" + e.message + ")." }); }
    const abs = h => { try { return new URL(desc(h), u).href; } catch (e) { return ""; } };
    const head = html.slice(0, html.indexOf("<body")), body = html.slice(html.indexOf("<body"));
    const v = nome => { const m = head.match(new RegExp("--" + nome + "\\s*:\\s*([^;]+);")); return m ? m[1].trim() : ""; };
    const titulo = desc((head.match(/<title>([^<]*)/) || [])[1]) || u.pathname.replace(/\//g, "");
    const imgLogo = body.match(/<img[^>]*class="logo([^"]*)"[^>]*>/) || body.match(/<img[^>]*class="[^"]*\blogo\b[^"]*"[^>]*>/);
    const pulados = []; const d = { titulo, mostrarTitulo: !imgLogo, descricao: desc((body.match(/<div class="description">([\s\S]*?)<\/div>/) || [])[1]).slice(0, 300), origem: "multlinks", itens: [], design: {} };
    if (imgLogo) {
      d.logo = await baixaImagem(abs(atr(imgLogo[0], "src"))); const cl = atr(imgLogo[0], "class");
      d.logoForma = /shape-original/.test(cl) ? "inteira" : /shape-arredondado/.test(cl) ? "arredondado" : /shape-quadrad/.test(cl) ? "quadrado" : "redondo";
      d.logoTam = /size-(pequen|small)/.test(cl) ? "p" : /size-(grande|large)/.test(cl) ? "g" : "m"; d.logoFundo = false; d.logoBorda = d.logoForma !== "inteira";
    }
    const ds = d.design, bg = (v("page-bg-image").match(/url\(["']?([^"')]+)/) || [])[1];
    ds.tema = "azul"; ds.estilo = /btn-style-glass/.test(body.slice(0, 300)) ? "vidro" : "solido"; ds.fonte = "poppins";
    const gl = hexDe(v("btn-link-bg")); ds.corBotao = gl[1] || hexDe(v("btn-bg"))[0] || ""; if (gl.length >= 2) { ds.degrade = true; ds.corBotao = gl[0]; ds.corBotao2 = gl[gl.length - 1]; }
    ds.corTexto = hexDe(v("btn-text"))[0] || ""; ds.pixCor = hexDe(v("card-bg"))[0] || ""; ds.pixTexto = hexDe(v("card-text-color"))[0] || "";
    ds.botao = parseInt(v("btn-link-radius")) >= 30 ? "pilula" : "arredondado";
    if (bg) { ds.fundoImagem = await baixaImagem(abs(bg)); if (ds.fundoImagem) { ds.fundo = "imagem"; ds.fundoBlur = parseInt(v("page-bg-blur")) || 0; const op = (v("page-bg-overlay").match(/rgba\([^)]*,\s*([\d.]+)\)/) || [])[1]; ds.fundoSobre = "escura"; ds.fundoOpac = op ? Math.round(Number(op) * 100) : 30; } }
    if (!ds.fundoImagem) { const g = hexDe(v("gradient")); if (g.length) { ds.fundo = "gradiente"; ds.fundo1 = g[0]; ds.fundo2 = g[g.length - 1]; } }
    // ícones pequenos (linha de redes)
    const mini = (body.match(/<div class="mini-icons-public"[\s\S]*?<\/div>/) || [""])[0];
    for (const m of mini.matchAll(/<a[^>]*href="([^"]+)"/g)) { const it = itemDeLink(abs(m[1]), ""); it.modo = "icone"; it.titulo = { instagram: "Instagram", facebook: "Facebook", youtube: "YouTube", tiktok: "TikTok", whatsapp: "WhatsApp", email: "E-mail", link: "Site" }[it.tipo] || ""; d.itens.push(it); }
    // blocos da lista, na ordem em que aparecem
    const ini = body.indexOf('<div class="links">'), fim = body.indexOf("public-dialogs.js");
    const lista = ini >= 0 ? body.slice(ini, fim > ini ? fim : undefined) : "";
    const achados = [];
    for (const m of lista.matchAll(/<div class="gbtn-wrap"[^>]*>/g)) achados.push([m.index, { tipo: "avaliacao", titulo: atr(m[0], "data-btn-title") || "Avalie no Google", url: atr(m[0], "data-google-url"), coresGoogle: true }]);
    for (const m of lista.matchAll(/class="card pix-block[\s\S]*?data-pix-key="[^"]*"[^>]*>/g)) { const t = m[0];
      achados.push([m.index, { tipo: "pix", chave: atr(t, "data-pix-key"), tipoChave: { cpf: "cpf", cnpj: "cnpj", email: "email", phone: "telefone", telefone: "telefone", evp: "aleatoria", random: "aleatoria", aleatoria: "aleatoria" }[atr(t, "data-pix-type")] || "auto", nome: atr(t, "data-pix-merchant-name").slice(0, 25), cidade: atr(t, "data-pix-merchant-city").slice(0, 15) }]); }
    for (const m of lista.matchAll(/class="card wifi-block[\s\S]*?data-wifi-qr="[^"]*"[^>]*>/g)) { const t = m[0], qr = atr(t, "data-wifi-qr");
      achados.push([m.index, { tipo: "wifi", titulo: "Wi-Fi", rede: atr(t, "data-wifi-ssid"), senha: atr(t, "data-wifi-password"), seguranca: /T:WEP/.test(qr) ? "WEP" : /T:nopass/i.test(qr) ? "nopass" : "WPA", ocultarSenha: atr(t, "data-wifi-show-password") === "0" }]); }
    for (const m of lista.matchAll(/<a class="btn([^"]*)"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
      const cl = m[1], href = abs(m[2]), tit = desc(m[3]).slice(0, 80); if (/\bgoogle\b/.test(cl)) continue;
      if (/contact-btn/.test(cl)) {
        let c = { tipo: "contato", titulo: tit || "Salvar contato" };
        try { const vc = (await baixa(href, 200000)).buf.toString("utf8"), g = k => ((vc.match(new RegExp("^" + k + "[^:\\n]*:(.*)$", "mi")) || [])[1] || "").trim().replace(/\\([,;])/g, "$1");
          Object.assign(c, { nome: g("FN"), telefone: g("TEL"), email: g("EMAIL"), empresa: g("ORG").replace(/;+$/, ""), cargo: g("TITLE"), site: g("URL") }); } catch (e) { pulados.push("contato (não abriu o vCard)"); }
        achados.push([m.index, c]); continue;
      }
      const it = itemDeLink(href, tit); if (/\bdestaque\b/.test(cl)) it.destaque = "brilho"; achados.push([m.index, it]);
    }
    const tipos = (lista.match(/<div class="card ([\w-]+)/g) || []).map(x => x.slice(17)).filter(t => !/pix-block|wifi-block/.test(t));
    if (tipos.length) pulados.push(...tipos.map(t => "bloco " + t));
    d.itens.push(...achados.sort((a, b) => a[0] - b[0]).map(x => x[1]));
    const r = criaPagina(d, u.pathname.replace(/\//g, ""));
    res.json({ pagina: linhaPag(r), itens: d.itens.length, pulados });
  });

  // ---------- público: página ----------
  const pagina = slug => db.prepare("SELECT * FROM lk_paginas WHERE slug = ?").get(String(slug).toLowerCase());
  app.get("/l/:slug", limite, async (req, res) => {
    const r = pagina(req.params.slug);
    if (!r) return res.status(404).send(paginaAviso("Página não encontrada", "Confira o endereço."));
    const previa = !!req.query.previa; if (!previa) registra("p:" + r.id);
    const nonce = crypto.randomBytes(16).toString("base64"), up = /upgrade-insecure-requests/.test(res.get("Content-Security-Policy") || "");
    // política própria das páginas: prévia em iframe do painel, vídeo/mapa embutidos e pixel do Meta / Google Analytics
    res.set("Content-Security-Policy", ["default-src 'self'", `script-src 'self' 'nonce-${nonce}' https://connect.facebook.net https://www.googletagmanager.com`,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob: https://i.ytimg.com https://www.facebook.com https://*.google-analytics.com https://*.googletagmanager.com",
      "connect-src 'self' https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com https://www.facebook.com https://connect.facebook.net",
      "frame-src https://www.youtube-nocookie.com https://player.vimeo.com https://www.google.com https://maps.google.com", "form-action 'self'", "frame-ancestors 'self'",
      "base-uri 'self'", "object-src 'none'", ...(up ? ["upgrade-insecure-requests"] : [])].join(";"));
    res.set("Cache-Control", "no-store").type("html").send(await renderiza(r, origemUrl(req), { nonce, previa, ativado: !!req.query.ativado }));
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
    relogio: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>', ok: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16.5 9.5"/>',
    qr: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M14 14h2v2h-2zM18 18h2v2h-2zM14 18v2M18 14h2"/>',
  };
  const ic = t => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONES[t] || ICONES.link}</svg>`;
  const PIX_LOGO = '<svg class="pixlogo" viewBox="0 0 120 40" aria-label="Pix"><g transform="translate(20 20) rotate(45)"><rect x="-13" y="-13" width="11" height="11" rx="2.5" fill="#32BCAD"/><rect x="2" y="-13" width="11" height="11" rx="2.5" fill="#32BCAD"/><rect x="-13" y="2" width="11" height="11" rx="2.5" fill="#32BCAD"/><rect x="2" y="2" width="11" height="11" rx="2.5" fill="#32BCAD"/></g><text x="44" y="29" font-family="Arial,Helvetica,sans-serif" font-size="28" font-weight="700" fill="#32BCAD" letter-spacing="-1">pix</text></svg>';
  const brl = v => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
  const ROT_CHAVE = { cpf: "Chave CPF", cnpj: "Chave CNPJ", email: "Chave e-mail", telefone: "Chave celular", aleatoria: "Chave aleatória" };
  const tipoChaveDe = i => i.tipoChave !== "auto" ? i.tipoChave : /@/.test(i.chave) ? "email" : /^\+?\d[\d\s().-]{9,}$/.test(i.chave) && i.chave.replace(/\D/g, "").length === 11 && !/[.-]/.test(i.chave) ? "telefone"
    : i.chave.replace(/\D/g, "").length === 11 ? "cpf" : i.chave.replace(/\D/g, "").length === 14 ? "cnpj" : /^[0-9a-f-]{32,36}$/i.test(i.chave) ? "aleatoria" : "";

  const ytId = u => (String(u).match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/))([\w-]{11})/) || [])[1] || "";
  const vimeoId = u => (String(u).match(/vimeo\.com\/(?:video\/)?(\d{6,12})/) || [])[1] || "";
  const DIAS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
  const faixaHor = x => x.aberto ? `${x.abre} às ${x.fecha}${x.abre2 && x.fecha2 ? ` · ${x.abre2} às ${x.fecha2}` : ""}` : "Fechado";
  async function renderiza(r, origem, op = {}) {
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
      if (i.tipo === "horario") partes.push(`<div class="hor" data-horario="${esc(JSON.stringify(i.dias))}"><div class="hortop">${ic("relogio")}<b>${tit || "Horário de funcionamento"}</b></div><span class="horst" hidden></span>
        <ul>${[1, 2, 3, 4, 5, 6, 0].map(k => `<li data-dia="${k}"><span>${DIAS[k]}</span><em>${faixaHor(i.dias[k])}</em></li>`).join("")}</ul>${i.obs ? `<small>${esc(i.obs)}</small>` : ""}</div>`);
      if (i.tipo === "video" && i.url) { const y = ytId(i.url), vm = vimeoId(i.url), vert = /shorts\//.test(i.url);
        if (y) partes.push(`${tit ? `<h2 class="sec">${tit}</h2>` : ""}<div class="vid${vert ? " vert" : ""}"><button type="button" data-video="https://www.youtube-nocookie.com/embed/${y}?autoplay=1&rel=0&playsinline=1" aria-label="Tocar vídeo${tit ? ": " + tit : ""}"><img src="https://i.ytimg.com/vi/${y}/hqdefault.jpg" alt="" loading="lazy"><span class="play"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="currentColor"/></svg></span></button></div>`);
        else if (vm) partes.push(`${tit ? `<h2 class="sec">${tit}</h2>` : ""}<div class="vid"><iframe src="https://player.vimeo.com/video/${vm}" loading="lazy" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen title="${tit || "Vídeo"}"></iframe></div>`); }
      if (i.tipo === "mapa" && i.endereco) { const q = encodeURIComponent(i.endereco);
        partes.push(`<div class="mapa">${tit ? `<b class="mtit">${ic("localizacao")}${tit}</b>` : ""}<iframe src="https://www.google.com/maps?q=${q}&output=embed" style="height:${i.altura}px" loading="lazy" referrerpolicy="no-referrer-when-downgrade" title="Mapa: ${esc(i.endereco)}"></iframe><a href="https://www.google.com/maps/search/?api=1&query=${q}" target="_blank" rel="noopener">${esc(i.endereco)} · Abrir no Maps</a></div>`); }
      if (i.tipo === "formulario") partes.push(`<form class="form" data-form="/l/${r.slug}/f/${i.id}" novalidate><b class="ftit">${tit || "Fale com a gente"}</b>${i.descricao ? `<small>${esc(i.descricao)}</small>` : ""}
        <input name="nome" required maxlength="80" placeholder="Seu nome" autocomplete="name"><input name="whatsapp" required maxlength="30" inputmode="tel" placeholder="Seu WhatsApp com DDD" autocomplete="tel">
        ${i.pedeEmail ? `<input name="email" type="email" maxlength="120" placeholder="Seu e-mail" autocomplete="email">` : ""}${i.pedeMensagem ? `<textarea name="mensagem" maxlength="1000" rows="3" placeholder="Mensagem"></textarea>` : ""}
        <input name="site" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true"><button class="bt" type="submit">${esc(i.textoBotao) || "Enviar"}</button><p class="ferro" hidden></p></form>
        <div class="fok" hidden>${ic("ok")}<b>${esc(i.textoOk) || "Recebemos! Logo falamos com você."}</b></div>`);
      if (i.tipo === "catalogo") { const lp = produtosPublicos().filter(x => !i.categoria || (x.p.categoria || "") === i.categoria).slice(0, i.limite);
        if (lp.length) partes.push(`${tit ? `<h2 class="sec">${tit}</h2>` : ""}<div class="cat ${i.estilo}">${lp.map(x => `<a class="catit" href="${linkProduto(origem, x.id, x.p.nome)}" target="_blank" rel="noopener">${x.foto ? `<img src="/fotos-publicas/${x.foto}" alt="" loading="lazy">` : `<span class="pi">${ic("produto")}</span>`}<span class="pt"><b>${esc(x.p.nome)}</b><em>${brl(Number(x.p.precoCatalogo) || 0)}</em></span></a>`).join("")}</div>
          <a class="bt" href="${origem}/${i.categoria ? "?cat=" + encodeURIComponent(i.categoria) : ""}" target="_blank" rel="noopener">${ic("produto")}<span>Ver catálogo completo</span></a>`); }
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
          <div class="pixch"><small>Rede</small><b>${esc(i.rede)}</b>${i.senha && i.seguranca !== "nopass" && !i.ocultarSenha ? `<small style="margin-top:6px">Senha</small><b>${esc(i.senha)}</b>` : ""}</div>
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
.hor,.form,.mapa,.fok{width:100%;border-radius:20px;padding:14px 16px;background:${claroTema ? "#fff" : "rgba(255,255,255,.12)"};border:1px solid ${claroTema ? "rgba(0,0,0,.08)" : "rgba(255,255,255,.25)"};backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);box-shadow:0 10px 28px rgba(0,0,0,.16)}
.hortop{display:flex;align-items:center;gap:8px;font-size:16px}.hortop svg,.mtit svg{width:22px;height:22px;flex:none}
.horst{display:inline-block;margin:8px 0 2px;padding:4px 11px;border-radius:99px;font-size:13px;font-weight:700}.horst.on{background:#16a34a;color:#fff}.horst.off{background:#dc2626;color:#fff}
.hor ul{list-style:none;padding:0;margin:8px 0 0;display:flex;flex-direction:column;gap:3px}.hor li{display:flex;justify-content:space-between;gap:10px;font-size:14px;opacity:.85}.hor li em{font-style:normal;text-align:right}.hor li.hoje{opacity:1;font-weight:700}.hor>small{display:block;margin-top:8px;opacity:.8;font-size:12.5px}
.vid{width:100%;aspect-ratio:16/9;border-radius:18px;overflow:hidden;background:#000;box-shadow:0 12px 30px rgba(0,0,0,.28)}.vid.vert{aspect-ratio:9/16;max-width:300px;align-self:center}
.vid button{all:unset;display:block;width:100%;height:100%;position:relative;cursor:pointer}.vid img{width:100%;height:100%;object-fit:cover;display:block}.vid iframe{width:100%;height:100%;border:0;display:block}
.play{position:absolute;left:50%;top:50%;width:68px;height:48px;margin:-24px 0 0 -34px;border-radius:14px;background:#ff0033;color:#fff;display:grid;place-items:center;box-shadow:0 6px 20px rgba(0,0,0,.35)}.play svg{width:28px;height:28px}
.mapa{padding:10px;display:flex;flex-direction:column;gap:8px}.mtit{display:flex;align-items:center;gap:8px;padding:4px 6px 0}.mapa iframe{width:100%;border:0;border-radius:14px;display:block}.mapa a{color:inherit;font-size:13px;opacity:.85;text-align:center;text-decoration:underline}
.form{display:flex;flex-direction:column;gap:9px}.ftit{font-size:17px}.form>small{opacity:.85;margin-top:-4px}
.form input,.form textarea{width:100%;border:1px solid ${claroTema ? "rgba(0,0,0,.15)" : "rgba(255,255,255,.35)"};background:${claroTema ? "#fff" : "rgba(255,255,255,.92)"};color:#111;border-radius:12px;padding:12px 13px;font:15px inherit;font-family:inherit;outline:0}
.form input:focus,.form textarea:focus{box-shadow:0 0 0 3px ${rgba(c, .35)}}.form .hp{position:absolute;left:-9999px;width:1px;height:1px;opacity:0}.form .bt{min-height:50px;padding:12px 18px}.ferro{color:#fecaca;font-size:13px;font-weight:600}
.fok{display:flex;align-items:center;gap:10px;font-size:15px}.fok svg{width:28px;height:28px;color:#22c55e;flex:none}
.cat{width:100%;display:grid;gap:10px}.cat.grade{grid-template-columns:1fr 1fr}.catit{display:flex;flex-direction:column;border-radius:16px;overflow:hidden;text-decoration:none;color:inherit;background:${claroTema ? "#fff" : "rgba(255,255,255,.12)"};border:1px solid ${claroTema ? "rgba(0,0,0,.08)" : "rgba(255,255,255,.22)"}}
.catit img,.catit .pi{width:100%;aspect-ratio:1;object-fit:cover;display:grid;place-items:center;background:rgba(255,255,255,.1)}.catit .pt{padding:8px 10px 10px}.catit b{font-size:13.5px;line-height:1.25}
.cat.lista .catit{flex-direction:row;align-items:center;gap:12px;padding:8px}.cat.lista .catit img,.cat.lista .catit .pi{width:64px;border-radius:12px;flex:none}.cat.lista .catit .pt{padding:0}
.ativado{width:100%;border-radius:18px;padding:14px 16px;background:#ecfdf5;color:#064e3b;font-size:14px;display:flex;flex-direction:column;gap:6px;box-shadow:0 10px 28px rgba(0,0,0,.2)}.ativado b{font-size:16px}.ativado a{color:#047857;font-weight:700}
.rod{margin-top:24px;text-align:center;font-size:13px;opacity:.8;white-space:pre-line}
.toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:rgba(17,17,17,.92);color:#fff;padding:10px 18px;border-radius:12px;font-size:14px;z-index:9}
@media (prefers-reduced-motion:reduce){.d-pulsar,.d-balancar,.d-brilho::after{animation:none}}
</style></head><body><main class="w">
${logoHtml}${d.mostrarTitulo ? `<h1>${esc(d.titulo)}</h1>` : ""}${d.descricao ? `<p class="ds">${esc(d.descricao)}</p>` : ""}
${d.compartilhar ? `<button class="share" type="button" data-share="${esc(url)}" data-titulo="${esc(d.titulo)}"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4"/></svg>Compartilhar</button>` : ""}
${op.ativado ? (() => { const L = lojaConfig(), wa = String(L.whatsapp || "").replace(/\D/g, ""); return `<div class="ativado"><b>🎉 Sua página está no ar!</b><span>Guarde este endereço: <b>${esc(url.replace(/^https?:\/\//, ""))}</b></span><span>Quer colocar sua logo, trocar cores ou botões?${wa ? ` <a href="https://wa.me/${wa.length <= 11 ? "55" + wa : wa}?text=${encodeURIComponent("Olá! Ativei minha página " + url + " e quero personalizar.")}" target="_blank" rel="noopener">Fale com a loja no WhatsApp</a>` : " Fale com a loja."}</span></div>`; })() : ""}
<div class="lista">${partes.join("\n")}</div>${d.rodape ? `<p class="rod">${esc(d.rodape)}</p>` : ""}
</main><script src="/lk.js" defer></script>${!op.previa && d.metaPixel ? `<script nonce="${op.nonce}">!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${d.metaPixel}');fbq('track','PageView');</script>` : ""}${!op.previa && d.ga4 ? `<script async src="https://www.googletagmanager.com/gtag/js?id=${d.ga4}"></script><script nonce="${op.nonce}">window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${d.ga4}');</script>` : ""}</body></html>`;
  }
  function paginaBase(t, corpo, script) {
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(t)}</title><meta name="robots" content="noindex">
<style>*{box-sizing:border-box}body{margin:0;min-height:100vh;background:linear-gradient(160deg,#0f172a,#1e293b);color:#f1f5f9;font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:28px 16px}
.c{max-width:440px;margin:0 auto;display:flex;flex-direction:column;gap:14px}h1{font-size:23px;margin:0}h2{font-size:16px;margin:10px 0 0}p{margin:0;opacity:.85}
.b{display:inline-flex;justify-content:center;align-items:center;border:0;background:#1FBE8C;color:#06130F;padding:14px 20px;border-radius:14px;font:700 15px inherit;font-family:inherit;text-decoration:none;cursor:pointer;width:100%}
.f{display:flex;flex-direction:column;gap:10px}.f label{display:flex;flex-direction:column;gap:5px;font-size:13px;font-weight:600;opacity:.9}
input{width:100%;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.95);color:#111;border-radius:12px;padding:13px;font:16px inherit;font-family:inherit}
.mods{display:grid;grid-template-columns:1fr 1fr;gap:8px}.mods label{display:block;cursor:pointer}.mods input{position:absolute;opacity:0;width:1px}.mods span{display:block;border:1px solid rgba(255,255,255,.2);border-radius:12px;padding:10px;font-weight:700;font-size:14px;background:rgba(255,255,255,.06)}
.mods small{display:block;font-weight:400;opacity:.75;font-size:12px;margin-top:2px}.mods input:checked+span{border-color:#1FBE8C;background:rgba(31,190,140,.18);box-shadow:0 0 0 2px #1FBE8C}
.erro{background:#7f1d1d;color:#fff;padding:10px 12px;border-radius:12px;font-weight:600}.hp{position:absolute;left:-9999px}
.cam{border-radius:16px;overflow:hidden;background:#000}.cam video{width:100%;display:block}.tag{color:#1FBE8C;font-weight:700;text-transform:uppercase;letter-spacing:.08em;font-size:12px}
.navm{display:flex;align-items:center;justify-content:space-between;background:rgba(255,255,255,.06);border-radius:12px;padding:6px}.navm a{color:#fff;text-decoration:none;font-size:22px;padding:2px 14px}.navm b{text-transform:capitalize}
.nums{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.nums div{background:rgba(255,255,255,.07);border-radius:14px;padding:14px 8px;text-align:center}.nums b{display:block;font-size:28px}.nums span{opacity:.75;font-size:13px}
.var{font-size:13px}.barras{display:flex;align-items:flex-end;gap:2px;height:96px;background:rgba(255,255,255,.04);border-radius:12px;padding:6px}.barras i{flex:1;background:#1FBE8C;border-radius:2px 2px 0 0}
.cl{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.1)}.rel{display:flex;flex-direction:column;gap:12px}.rod a{color:#1FBE8C}</style></head>
<body><main class="c">${corpo}</main>${script ? `<script src="${script}" defer></script>` : ""}</body></html>`;
  }
  function paginaAtivar(r, erro = "", b = {}) {
    const ops = Object.entries(MODELOS).map(([k, m]) => `<label><input type="radio" name="modelo" value="${k}"${(b.modelo || "branco") === k ? " checked" : ""}><span>${esc(m.nome)}<small>${esc(m.desc)}</small></span></label>`).join("");
    return paginaBase("Ativar " + r.codigo, `<small class="tag">Código ${esc(r.codigo)}</small><h1>Vamos ativar sua página</h1><p>Preencha os dados e em segundos seu cartão ou placa já abre a sua página. Depois a loja pode colocar sua logo e personalizar.</p>
      ${erro ? `<div class="erro">${esc(erro)}</div>` : ""}
      <form class="f" method="post" action="/q/${esc(r.codigo)}/ativar">
        <label>Nome da empresa ou seu nome<input name="nome" required maxlength="80" value="${esc(b.nome || "")}" autocomplete="organization"></label>
        <label>WhatsApp com DDD<input name="whatsapp" required maxlength="20" inputmode="tel" value="${esc(b.whatsapp || "")}" placeholder="(41) 99999-9999" autocomplete="tel"></label>
        <label>Instagram (opcional)<input name="instagram" maxlength="60" value="${esc(b.instagram || "")}" placeholder="@seuperfil"></label>
        <label>E-mail (opcional)<input name="email" type="email" maxlength="120" value="${esc(b.email || "")}" autocomplete="email"></label>
        <label style="margin-top:4px">Escolha um modelo</label><div class="mods">${ops}</div>
        <input name="site" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
        <button class="b" type="submit">Ativar minha página</button></form>`);
  }
  function paginaAviso(t, m) {
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(t)}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0E1114;color:#F1F6F4;font:16px/1.5 system-ui,sans-serif;padding:20px;text-align:center}.c{max-width:380px}h1{font-size:22px}.b{display:inline-block;background:#1FBE8C;color:#06130F;padding:12px 20px;border-radius:12px;font-weight:700;text-decoration:none}</style></head>
<body><div class="c"><h1>${esc(t)}</h1><p>${m}</p></div></body></html>`;
  }
  return {};
};

// Precificador 3D — servidor com login.
// Uso: npm start   (variáveis em .env.example)
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const { db, DATA_DIR } = require("./db");

// Carrega .env simples (sem dependência extra)
const envFile = path.join(__dirname, ".env");
if (fs.existsSync(envFile)) {
  for (const linha of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const COOKIE_SECURE = process.env.COOKIE_SECURE === "true";
const FOTOS_DIR = path.join(DATA_DIR, "fotos");

// Segredo da sessão: usa SESSION_SECRET ou cria um e guarda em data/.segredo
function segredoSessao() {
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32) return process.env.SESSION_SECRET;
  const arq = path.join(DATA_DIR, ".segredo");
  if (fs.existsSync(arq)) return fs.readFileSync(arq, "utf8").trim();
  const s = crypto.randomBytes(48).toString("hex");
  fs.writeFileSync(arq, s, { mode: 0o600 });
  return s;
}

// Armazena sessões no SQLite
class SqliteStore extends session.Store {
  constructor() {
    super();
    this.qGet = db.prepare("SELECT sess FROM sessoes WHERE sid = ? AND expira > ?");
    this.qSet = db.prepare("INSERT INTO sessoes (sid, sess, expira) VALUES (?, ?, ?) ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expira = excluded.expira");
    this.qDel = db.prepare("DELETE FROM sessoes WHERE sid = ?");
    this.qTouch = db.prepare("UPDATE sessoes SET expira = ? WHERE sid = ?");
    this.qClean = db.prepare("DELETE FROM sessoes WHERE expira <= ?");
    setInterval(() => this.qClean.run(Date.now()), 60 * 60 * 1000).unref();
  }
  expira(sess) { return sess?.cookie?.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + 86400000; }
  get(sid, cb) { try { const r = this.qGet.get(sid, Date.now()); cb(null, r ? JSON.parse(r.sess) : null); } catch (e) { cb(e); } }
  set(sid, sess, cb) { try { this.qSet.run(sid, JSON.stringify(sess), this.expira(sess)); cb && cb(null); } catch (e) { cb && cb(e); } }
  destroy(sid, cb) { try { this.qDel.run(sid); cb && cb(null); } catch (e) { cb && cb(e); } }
  touch(sid, sess, cb) { try { this.qTouch.run(this.expira(sess), sid); cb && cb(null); } catch (e) { cb && cb(e); } }
}

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1); // atrás do nginx

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: COOKIE_SECURE ? [] : null,
    },
  },
}));
app.use(express.json({ limit: "300kb" }));
app.use(session({
  name: "p3d.sid",
  secret: segredoSessao(),
  store: new SqliteStore(),
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: { httpOnly: true, sameSite: "lax", secure: COOKIE_SECURE, maxAge: 7 * 24 * 60 * 60 * 1000 },
}));

// Bloqueia requisições de alteração vindas de outros sites
app.use("/api", (req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const origem = req.get("origin");
  if (origem) {
    try { if (new URL(origem).host !== req.get("host")) return res.status(403).json({ erro: "Origem não permitida." }); }
    catch { return res.status(403).json({ erro: "Origem não permitida." }); }
  }
  next();
});

// ---------- utilidades ----------
const qUsuarioPorId = db.prepare("SELECT id, usuario, nome, papel FROM usuarios WHERE id = ?");
const totalUsuarios = () => db.prepare("SELECT COUNT(*) n FROM usuarios").get().n;
const totalAdmins = () => db.prepare("SELECT COUNT(*) n FROM usuarios WHERE papel = 'admin'").get().n;

function usuarioAtual(req) {
  if (!req.session.uid) return null;
  return qUsuarioPorId.get(req.session.uid) || null;
}
function exigeLogin(req, res, next) {
  const u = usuarioAtual(req);
  if (!u) return res.status(401).json({ erro: "Faça login para continuar." });
  req.usuario = u; next();
}
function exigeEdicao(req, res, next) {
  if (req.usuario.papel === "leitura") return res.status(403).json({ erro: "Seu acesso é só de leitura." });
  next();
}
function exigeAdmin(req, res, next) {
  if (req.usuario.papel !== "admin") return res.status(403).json({ erro: "Só administradores podem fazer isso." });
  next();
}
function validaUsuario(usuario) {
  return typeof usuario === "string" && /^[a-zA-Z0-9._-]{3,40}$/.test(usuario);
}
function validaSenha(senha) {
  return typeof senha === "string" && senha.length >= 8 && senha.length <= 200;
}
const PAPEIS = ["admin", "editor", "leitura"];
function entrar(req, id, cb) {
  req.session.regenerate(err => {
    if (err) return cb(err);
    req.session.uid = id;
    db.prepare("UPDATE usuarios SET ultimo_login = datetime('now') WHERE id = ?").run(id);
    req.session.save(cb);
  });
}

// ---------- autenticação ----------
const limiteLogin = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: "draft-7", legacyHeaders: false,
  message: { erro: "Muitas tentativas. Espere 15 minutos e tente de novo." },
});

app.get("/api/estado", (req, res) => {
  res.json({ temUsuarios: totalUsuarios() > 0, usuario: usuarioAtual(req) });
});

app.post("/api/primeiro-acesso", limiteLogin, (req, res) => {
  if (totalUsuarios() > 0) return res.status(409).json({ erro: "O administrador já foi criado. Faça login." });
  const { nome, usuario, senha } = req.body || {};
  if (!nome || !String(nome).trim()) return res.status(400).json({ erro: "Informe seu nome." });
  if (!validaUsuario(usuario)) return res.status(400).json({ erro: "O usuário deve ter de 3 a 40 letras, números, ponto, hífen ou sublinhado." });
  if (!validaSenha(senha)) return res.status(400).json({ erro: "A senha deve ter pelo menos 8 caracteres." });
  const r = db.prepare("INSERT INTO usuarios (usuario, nome, senha_hash, papel) VALUES (?, ?, ?, 'admin')")
    .run(usuario.trim(), String(nome).trim().slice(0, 80), bcrypt.hashSync(senha, 12));
  entrar(req, r.lastInsertRowid, err => err ? res.status(500).json({ erro: "Erro ao iniciar a sessão." }) : res.json({ usuario: qUsuarioPorId.get(r.lastInsertRowid) }));
});

// hash fixo para comparar mesmo quando o usuário não existe (evita revelar quais usuários existem pelo tempo de resposta)
const HASH_FALSO = bcrypt.hashSync(crypto.randomBytes(16).toString("hex"), 12);
app.post("/api/login", limiteLogin, (req, res) => {
  const { usuario, senha } = req.body || {};
  if (typeof usuario !== "string" || typeof senha !== "string") return res.status(400).json({ erro: "Informe usuário e senha." });
  const u = db.prepare("SELECT id, senha_hash FROM usuarios WHERE usuario = ?").get(usuario.trim());
  const ok = bcrypt.compareSync(senha, u ? u.senha_hash : HASH_FALSO);
  if (!u || !ok) return res.status(401).json({ erro: "Usuário ou senha incorretos." });
  entrar(req, u.id, err => err ? res.status(500).json({ erro: "Erro ao iniciar a sessão." }) : res.json({ usuario: qUsuarioPorId.get(u.id) }));
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => { res.clearCookie("p3d.sid"); res.json({ ok: true }); });
});

app.post("/api/minha-senha", exigeLogin, (req, res) => {
  const { atual, nova } = req.body || {};
  const u = db.prepare("SELECT senha_hash FROM usuarios WHERE id = ?").get(req.usuario.id);
  if (!bcrypt.compareSync(String(atual || ""), u.senha_hash)) return res.status(400).json({ erro: "A senha atual está incorreta." });
  if (!validaSenha(nova)) return res.status(400).json({ erro: "A nova senha deve ter pelo menos 8 caracteres." });
  db.prepare("UPDATE usuarios SET senha_hash = ? WHERE id = ?").run(bcrypt.hashSync(nova, 12), req.usuario.id);
  // encerra as outras sessões deste usuário
  const minhas = db.prepare("SELECT sid, sess FROM sessoes").all();
  for (const s of minhas) { try { if (JSON.parse(s.sess).uid === req.usuario.id && s.sid !== req.sessionID) db.prepare("DELETE FROM sessoes WHERE sid = ?").run(s.sid); } catch {} }
  res.json({ ok: true });
});

// ---------- usuários (admin) ----------
app.get("/api/usuarios", exigeLogin, exigeAdmin, (req, res) => {
  res.json(db.prepare("SELECT id, usuario, nome, papel, criado_em, ultimo_login FROM usuarios ORDER BY nome COLLATE NOCASE").all());
});
app.post("/api/usuarios", exigeLogin, exigeAdmin, (req, res) => {
  const { nome, usuario, senha, papel } = req.body || {};
  if (!nome || !String(nome).trim()) return res.status(400).json({ erro: "Informe o nome." });
  if (!validaUsuario(usuario)) return res.status(400).json({ erro: "O usuário deve ter de 3 a 40 letras, números, ponto, hífen ou sublinhado." });
  if (!validaSenha(senha)) return res.status(400).json({ erro: "A senha deve ter pelo menos 8 caracteres." });
  if (!PAPEIS.includes(papel)) return res.status(400).json({ erro: "Tipo de acesso inválido." });
  try {
    const r = db.prepare("INSERT INTO usuarios (usuario, nome, senha_hash, papel) VALUES (?, ?, ?, ?)")
      .run(usuario.trim(), String(nome).trim().slice(0, 80), bcrypt.hashSync(senha, 12), papel);
    res.json(qUsuarioPorId.get(r.lastInsertRowid));
  } catch (e) {
    if (String(e.message).includes("UNIQUE")) return res.status(409).json({ erro: "Já existe alguém com esse usuário." });
    throw e;
  }
});
app.patch("/api/usuarios/:id", exigeLogin, exigeAdmin, (req, res) => {
  const id = Number(req.params.id);
  const alvo = qUsuarioPorId.get(id);
  if (!alvo) return res.status(404).json({ erro: "Usuário não encontrado." });
  const { nome, papel, senha } = req.body || {};
  if (papel !== undefined) {
    if (!PAPEIS.includes(papel)) return res.status(400).json({ erro: "Tipo de acesso inválido." });
    if (alvo.papel === "admin" && papel !== "admin" && totalAdmins() <= 1) return res.status(400).json({ erro: "Precisa existir pelo menos um administrador." });
    db.prepare("UPDATE usuarios SET papel = ? WHERE id = ?").run(papel, id);
  }
  if (nome !== undefined && String(nome).trim()) db.prepare("UPDATE usuarios SET nome = ? WHERE id = ?").run(String(nome).trim().slice(0, 80), id);
  if (senha !== undefined) {
    if (!validaSenha(senha)) return res.status(400).json({ erro: "A senha deve ter pelo menos 8 caracteres." });
    db.prepare("UPDATE usuarios SET senha_hash = ? WHERE id = ?").run(bcrypt.hashSync(senha, 12), id);
  }
  res.json(qUsuarioPorId.get(id));
});
app.delete("/api/usuarios/:id", exigeLogin, exigeAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.usuario.id) return res.status(400).json({ erro: "Você não pode excluir o seu próprio usuário." });
  const alvo = qUsuarioPorId.get(id);
  if (!alvo) return res.status(404).json({ erro: "Usuário não encontrado." });
  db.prepare("DELETE FROM usuarios WHERE id = ?").run(id);
  for (const s of db.prepare("SELECT sid, sess FROM sessoes").all()) { try { if (JSON.parse(s.sess).uid === id) db.prepare("DELETE FROM sessoes WHERE sid = ?").run(s.sid); } catch {} }
  res.json({ ok: true });
});

// ---------- configuração ----------
app.get("/api/config", exigeLogin, (req, res) => {
  const r = db.prepare("SELECT dados FROM config WHERE id = 1").get();
  res.json(r ? JSON.parse(r.dados) : null);
});
app.put("/api/config", exigeLogin, exigeEdicao, (req, res) => {
  const c = req.body;
  if (!c || typeof c !== "object" || !Array.isArray(c.filamentos) || !Array.isArray(c.canais)) return res.status(400).json({ erro: "Configuração inválida." });
  db.prepare("INSERT INTO config (id, dados) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET dados = excluded.dados, atualizado_em = datetime('now')").run(JSON.stringify(c));
  res.json({ ok: true });
});

// ---------- produtos ----------
const FOTO_RE = /^[a-f0-9]{32}\.(jpg|png|webp|gif)$/;
function limpaProduto(b) {
  if (!b || typeof b !== "object") return null;
  const p = { ...b };
  delete p.id; delete p.atualizadoEm; delete p.atualizadoPor;
  p.nome = String(p.nome || "").trim().slice(0, 150);
  if (!p.nome) return null;
  p.fotoId = p.fotoId && FOTO_RE.test(p.fotoId) ? p.fotoId : "";
  if (p.linkModelo) { try { const u = new URL(p.linkModelo); p.linkModelo = /^https?:$/.test(u.protocol) ? u.href : ""; } catch { p.linkModelo = ""; } }
  return p;
}
function apagaFoto(nome) {
  if (nome && FOTO_RE.test(nome)) fs.promises.unlink(path.join(FOTOS_DIR, nome)).catch(() => {});
}
function linhaParaProduto(r) {
  return { ...JSON.parse(r.dados), id: r.id, atualizadoEm: r.atualizado_em, atualizadoPor: r.nome_usuario || null };
}
app.get("/api/produtos", exigeLogin, (req, res) => {
  const rows = db.prepare("SELECT p.*, u.nome AS nome_usuario FROM produtos p LEFT JOIN usuarios u ON u.id = p.atualizado_por ORDER BY p.criado_em").all();
  res.json(rows.map(linhaParaProduto));
});
app.post("/api/produtos", exigeLogin, exigeEdicao, (req, res) => {
  const p = limpaProduto(req.body);
  if (!p) return res.status(400).json({ erro: "Dê um nome ao produto." });
  const id = crypto.randomUUID();
  db.prepare("INSERT INTO produtos (id, dados, foto, atualizado_por) VALUES (?, ?, ?, ?)").run(id, JSON.stringify(p), p.fotoId || null, req.usuario.id);
  res.json({ ...p, id });
});
app.put("/api/produtos/:id", exigeLogin, exigeEdicao, (req, res) => {
  const atual = db.prepare("SELECT foto FROM produtos WHERE id = ?").get(req.params.id);
  if (!atual) return res.status(404).json({ erro: "Produto não encontrado." });
  const p = limpaProduto(req.body);
  if (!p) return res.status(400).json({ erro: "Dê um nome ao produto." });
  db.prepare("UPDATE produtos SET dados = ?, foto = ?, atualizado_em = datetime('now'), atualizado_por = ? WHERE id = ?")
    .run(JSON.stringify(p), p.fotoId || null, req.usuario.id, req.params.id);
  if (atual.foto && atual.foto !== p.fotoId) apagaFoto(atual.foto);
  res.json({ ...p, id: req.params.id });
});
app.delete("/api/produtos/:id", exigeLogin, exigeEdicao, (req, res) => {
  const atual = db.prepare("SELECT foto FROM produtos WHERE id = ?").get(req.params.id);
  if (!atual) return res.status(404).json({ erro: "Produto não encontrado." });
  db.prepare("DELETE FROM produtos WHERE id = ?").run(req.params.id);
  apagaFoto(atual.foto);
  res.json({ ok: true });
});

// ---------- financeiro ----------
const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;
const MES_RE = /^\d{4}-\d{2}$/;
const n = v => { const x = Number(v); return Number.isFinite(x) ? Math.round(x * 100) / 100 : 0; };
const txt = (v, max = 200) => String(v ?? "").trim().slice(0, max);
function intervaloMes(mes) {
  const [a, m] = mes.split("-").map(Number);
  const fim = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return [`${mes}-01`, `${mes}-${String(fim).padStart(2, "0")}`];
}
function limpaVenda(b) {
  if (!b || !DATA_RE.test(b.data)) return { erro: "Informe a data da venda." };
  const descricao = txt(b.descricao, 150);
  if (!descricao) return { erro: "Informe o produto vendido." };
  const quantidade = n(b.quantidade);
  if (quantidade <= 0) return { erro: "A quantidade precisa ser maior que zero." };
  return { v: {
    data: b.data, produto_id: b.produto_id ? txt(b.produto_id, 60) : null, descricao, quantidade,
    preco_unit: n(b.preco_unit), canal: txt(b.canal, 80), taxas: n(b.taxas), frete: n(b.frete),
    custo_unit: n(b.custo_unit), cliente: txt(b.cliente, 120), status: b.status === "pendente" ? "pendente" : "pago", obs: txt(b.obs, 500),
  } };
}
function limpaLanc(b) {
  if (!b || !DATA_RE.test(b.data)) return { erro: "Informe a data." };
  const descricao = txt(b.descricao, 150);
  if (!descricao) return { erro: "Informe a descrição." };
  const valor = n(b.valor);
  if (valor <= 0) return { erro: "O valor precisa ser maior que zero." };
  if (!["entrada", "saida"].includes(b.tipo)) return { erro: "Tipo inválido." };
  return { v: { data: b.data, tipo: b.tipo, descricao, categoria: txt(b.categoria, 60) || "Outros", valor, status: b.status === "pendente" ? "pendente" : "pago", obs: txt(b.obs, 500) } };
}
const COLS_V = ["data", "produto_id", "descricao", "quantidade", "preco_unit", "canal", "taxas", "frete", "custo_unit", "cliente", "status", "obs"];
const COLS_L = ["data", "tipo", "descricao", "categoria", "valor", "status", "obs"];

app.get("/api/financeiro", exigeLogin, (req, res) => {
  const mes = MES_RE.test(req.query.mes || "") ? req.query.mes : new Date().toISOString().slice(0, 7);
  const [de, ate] = intervaloMes(mes);
  const vendas = db.prepare("SELECT * FROM vendas WHERE data BETWEEN ? AND ? ORDER BY data DESC, criado_em DESC").all(de, ate);
  const lancamentos = db.prepare("SELECT * FROM lancamentos WHERE data BETWEEN ? AND ? ORDER BY data DESC, criado_em DESC").all(de, ate);
  // série dos últimos 12 meses (somente valores pagos)
  const [a, m] = mes.split("-").map(Number);
  const ini = new Date(Date.UTC(a, m - 12, 1)).toISOString().slice(0, 10);
  const serieV = db.prepare(`SELECT substr(data,1,7) mes, SUM(quantidade*preco_unit - taxas - frete) liquido, SUM(quantidade*preco_unit - taxas - frete - quantidade*custo_unit) lucro, SUM(quantidade) pecas
    FROM vendas WHERE status='pago' AND data BETWEEN ? AND ? GROUP BY 1`).all(ini, ate);
  const serieL = db.prepare(`SELECT substr(data,1,7) mes, tipo, SUM(valor) total FROM lancamentos WHERE status='pago' AND data BETWEEN ? AND ? GROUP BY 1,2`).all(ini, ate);
  const serie = [];
  for (let i = 11; i >= 0; i--) {
    const k = new Date(Date.UTC(a, m - 1 - i, 1)).toISOString().slice(0, 7);
    const sv = serieV.find(x => x.mes === k) || {};
    const ent = (sv.liquido || 0) + (serieL.find(x => x.mes === k && x.tipo === "entrada")?.total || 0);
    const sai = serieL.find(x => x.mes === k && x.tipo === "saida")?.total || 0;
    serie.push({ mes: k, entradas: n(ent), saidas: n(sai), lucroVendas: n(sv.lucro || 0), pecas: sv.pecas || 0 });
  }
  const saldoAnterior = (() => {
    const v = db.prepare("SELECT COALESCE(SUM(quantidade*preco_unit - taxas - frete),0) t FROM vendas WHERE status='pago' AND data < ?").get(de).t;
    const e = db.prepare("SELECT COALESCE(SUM(valor),0) t FROM lancamentos WHERE status='pago' AND tipo='entrada' AND data < ?").get(de).t;
    const s = db.prepare("SELECT COALESCE(SUM(valor),0) t FROM lancamentos WHERE status='pago' AND tipo='saida' AND data < ?").get(de).t;
    return n(v + e - s);
  })();
  res.json({ mes, vendas, lancamentos, serie, saldoAnterior });
});

function crud(tabela, limpa, cols) {
  app.post(`/api/${tabela}`, exigeLogin, exigeEdicao, (req, res) => {
    const { v, erro } = limpa(req.body); if (erro) return res.status(400).json({ erro });
    const id = crypto.randomUUID();
    db.prepare(`INSERT INTO ${tabela} (id, ${cols.join(",")}, criado_por) VALUES (?, ${cols.map(() => "?").join(",")}, ?)`).run(id, ...cols.map(c => v[c]), req.usuario.id);
    if (tabela === "vendas" && req.body.baixarEstoque && v.produto_id) ajustaEstoque(v.produto_id, -v.quantidade);
    res.json({ id, ...v });
  });
  app.put(`/api/${tabela}/:id`, exigeLogin, exigeEdicao, (req, res) => {
    const { v, erro } = limpa(req.body); if (erro) return res.status(400).json({ erro });
    const r = db.prepare(`UPDATE ${tabela} SET ${cols.map(c => c + " = ?").join(",")} WHERE id = ?`).run(...cols.map(c => v[c]), req.params.id);
    if (!r.changes) return res.status(404).json({ erro: "Registro não encontrado." });
    res.json({ id: req.params.id, ...v });
  });
  app.delete(`/api/${tabela}/:id`, exigeLogin, exigeEdicao, (req, res) => {
    db.prepare(`DELETE FROM ${tabela} WHERE id = ?`).run(req.params.id);
    res.json({ ok: true });
  });
}
crud("vendas", limpaVenda, COLS_V);
crud("lancamentos", limpaLanc, COLS_L);

app.get("/api/financeiro/csv", exigeLogin, (req, res) => {
  const mes = MES_RE.test(req.query.mes || "") ? req.query.mes : new Date().toISOString().slice(0, 7);
  const [de, ate] = intervaloMes(mes);
  const linhas = [["Data", "Tipo", "Descrição", "Categoria/Canal", "Qtd", "Valor bruto", "Taxas", "Frete", "Valor líquido", "Custo", "Lucro", "Situação"]];
  for (const v of db.prepare("SELECT * FROM vendas WHERE data BETWEEN ? AND ? ORDER BY data").all(de, ate)) {
    const bruto = v.quantidade * v.preco_unit, liq = bruto - v.taxas - v.frete, custo = v.quantidade * v.custo_unit;
    linhas.push([v.data, "Venda", v.descricao, v.canal, v.quantidade, bruto, v.taxas, v.frete, liq, custo, liq - custo, v.status]);
  }
  for (const l of db.prepare("SELECT * FROM lancamentos WHERE data BETWEEN ? AND ? ORDER BY data").all(de, ate)) {
    const val = l.tipo === "entrada" ? l.valor : -l.valor;
    linhas.push([l.data, l.tipo === "entrada" ? "Receita" : "Despesa", l.descricao, l.categoria, "", "", "", "", val, "", "", l.status]);
  }
  const fmt = x => typeof x === "number" ? String(Math.round(x * 100) / 100).replace(".", ",") : `"${String(x ?? "").replace(/"/g, '""')}"`;
  res.set("Content-Type", "text/csv; charset=utf-8");
  res.set("Content-Disposition", `attachment; filename="financeiro-${mes}.csv"`);
  res.send("﻿" + linhas.map(l => l.map(fmt).join(";")).join("\r\n"));
});

// ---------- fotos ----------
const TIPOS = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
const upload = multer({
  storage: multer.diskStorage({
    destination: FOTOS_DIR,
    filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString("hex") + "." + TIPOS[file.mimetype]),
  }),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => cb(null, Boolean(TIPOS[file.mimetype])),
});
app.post("/api/fotos", exigeLogin, exigeEdicao, (req, res) => {
  upload.single("foto")(req, res, err => {
    if (err) return res.status(400).json({ erro: err.code === "LIMIT_FILE_SIZE" ? "Imagem grande demais (máximo 8 MB)." : "Não deu para receber a imagem." });
    if (!req.file) return res.status(400).json({ erro: "Envie uma imagem JPG, PNG, WEBP ou GIF." });
    res.json({ id: req.file.filename });
  });
});
app.get("/fotos/:nome", exigeLogin, (req, res) => {
  if (!FOTO_RE.test(req.params.nome)) return res.status(404).end();
  res.set("Cache-Control", "private, max-age=86400");
  res.sendFile(path.join(FOTOS_DIR, req.params.nome), err => { if (err && !res.headersSent) res.status(404).end(); });
});
app.delete("/api/fotos/:nome", exigeLogin, exigeEdicao, (req, res) => {
  const usada = db.prepare("SELECT 1 FROM produtos WHERE foto = ?").get(req.params.nome);
  if (!usada) apagaFoto(req.params.nome);
  res.json({ ok: true });
});

// Remove fotos enviadas que nunca foram salvas em um produto (mais de 1 dia)
function limpaFotosOrfas() {
  const usadas = new Set(db.prepare("SELECT foto FROM produtos WHERE foto IS NOT NULL").all().map(r => r.foto));
  for (const f of fs.readdirSync(FOTOS_DIR)) {
    if (!FOTO_RE.test(f) || usadas.has(f)) continue;
    const st = fs.statSync(path.join(FOTOS_DIR, f));
    if (Date.now() - st.mtimeMs > 86400000) apagaFoto(f);
  }
}
limpaFotosOrfas();
setInterval(limpaFotosOrfas, 6 * 60 * 60 * 1000).unref();


// ---------- estoque de peças prontas ----------
function ajustaEstoque(produtoId, delta) {
  const r = db.prepare("SELECT dados FROM produtos WHERE id = ?").get(produtoId);
  if (!r) return null;
  const p = JSON.parse(r.dados);
  p.estoque = Math.max(0, Math.round((Number(p.estoque) || 0) + delta));
  db.prepare("UPDATE produtos SET dados = ? WHERE id = ?").run(JSON.stringify(p), produtoId);
  return p.estoque;
}
app.post("/api/produtos/:id/estoque", exigeLogin, exigeEdicao, (req, res) => {
  const delta = Number(req.body?.delta);
  if (!Number.isFinite(delta)) return res.status(400).json({ erro: "Quantidade inválida." });
  const e = ajustaEstoque(req.params.id, delta);
  if (e === null) return res.status(404).json({ erro: "Produto não encontrado." });
  res.json({ estoque: e });
});

// ---------- rolos de filamento ----------
function limpaRolo(b) {
  if (!b || !txt(b.filamento_id, 60)) return { erro: "Escolha o tipo de filamento." };
  const cor = txt(b.cor, 60); if (!cor) return { erro: "Informe a cor do rolo." };
  const peso = n(b.peso) || 1000;
  const restante = b.restante === undefined || b.restante === "" ? peso : Math.max(0, n(b.restante));
  return { v: { filamento_id: txt(b.filamento_id, 60), cor, peso, restante, preco: n(b.preco), data_compra: DATA_RE.test(b.data_compra || "") ? b.data_compra : null, ativo: b.ativo === false || b.ativo === 0 ? 0 : 1 } };
}
const COLS_R = ["filamento_id", "cor", "peso", "restante", "preco", "data_compra", "ativo"];
app.get("/api/rolos", exigeLogin, (req, res) => {
  res.json(db.prepare("SELECT * FROM rolos ORDER BY ativo DESC, data_compra, criado_em").all());
});
app.post("/api/rolos", exigeLogin, exigeEdicao, (req, res) => {
  const { v, erro } = limpaRolo(req.body); if (erro) return res.status(400).json({ erro });
  const id = crypto.randomUUID();
  db.transaction(() => {
    db.prepare(`INSERT INTO rolos (id, ${COLS_R.join(",")}) VALUES (?, ${COLS_R.map(() => "?").join(",")})`).run(id, ...COLS_R.map(c => v[c]));
    if (req.body.lancarDespesa && v.preco > 0) {
      db.prepare("INSERT INTO lancamentos (id, data, tipo, descricao, categoria, valor, status, criado_por) VALUES (?, ?, 'saida', ?, 'Filamento', ?, 'pago', ?)")
        .run(crypto.randomUUID(), v.data_compra || new Date().toISOString().slice(0, 10), `Rolo ${txt(req.body.nomeFilamento, 60)} ${v.cor}`.trim(), v.preco, req.usuario.id);
    }
  })();
  res.json({ id, ...v });
});
app.put("/api/rolos/:id", exigeLogin, exigeEdicao, (req, res) => {
  const { v, erro } = limpaRolo(req.body); if (erro) return res.status(400).json({ erro });
  const r = db.prepare(`UPDATE rolos SET ${COLS_R.map(c => c + " = ?").join(",")} WHERE id = ?`).run(...COLS_R.map(c => v[c]), req.params.id);
  if (!r.changes) return res.status(404).json({ erro: "Rolo não encontrado." });
  res.json({ id: req.params.id, ...v });
});
app.post("/api/rolos/:id/uso", exigeLogin, exigeEdicao, (req, res) => {
  const g = n(req.body?.gramas);
  const r = db.prepare("SELECT restante FROM rolos WHERE id = ?").get(req.params.id);
  if (!r) return res.status(404).json({ erro: "Rolo não encontrado." });
  const restante = Math.max(0, n(r.restante - g));
  db.prepare("UPDATE rolos SET restante = ? WHERE id = ?").run(restante, req.params.id);
  res.json({ restante });
});
app.delete("/api/rolos/:id", exigeLogin, exigeEdicao, (req, res) => {
  db.prepare("DELETE FROM rolos WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});
// desconta gramas dos rolos ativos daquele tipo, do mais antigo para o mais novo
function baixaFilamento(filamentoId, gramas) {
  let falta = gramas;
  const rolos = db.prepare("SELECT id, restante FROM rolos WHERE ativo = 1 AND filamento_id = ? AND restante > 0 ORDER BY data_compra, criado_em").all(filamentoId);
  for (const r of rolos) {
    if (falta <= 0) break;
    const usa = Math.min(r.restante, falta);
    db.prepare("UPDATE rolos SET restante = ? WHERE id = ?").run(n(r.restante - usa), r.id);
    falta -= usa;
  }
  return falta; // gramas que não havia em estoque
}

// ---------- pedidos ----------
const STATUS_PEDIDO = ["orcamento", "aprovado", "imprimindo", "pronto", "entregue", "cancelado"];
function limpaPedido(b) {
  if (!b) return { erro: "Pedido inválido." };
  const cliente = txt(b.cliente, 120); if (!cliente) return { erro: "Informe o nome do cliente." };
  const itens = (Array.isArray(b.itens) ? b.itens : []).slice(0, 50).map(i => ({
    produto_id: i.produto_id ? txt(i.produto_id, 60) : null,
    descricao: txt(i.descricao, 150),
    quantidade: Math.max(0, n(i.quantidade)),
    preco_unit: n(i.preco_unit),
    custo_unit: n(i.custo_unit),
    horas_unit: n(i.horas_unit),
    personalizacao: txt(i.personalizacao, 300),
    doEstoque: !!i.doEstoque,
    fil: (Array.isArray(i.fil) ? i.fil : []).slice(0, 8).map(f => ({ filId: txt(f.filId, 60), g: n(f.g) })),
  })).filter(i => i.descricao && i.quantidade > 0);
  if (!itens.length) return { erro: "Adicione pelo menos um item com quantidade." };
  const data = DATA_RE.test(b.data || "") ? b.data : new Date().toISOString().slice(0, 10);
  return { v: {
    cliente, whatsapp: txt(b.whatsapp, 30).replace(/[^\d+]/g, ""), canal: txt(b.canal, 80), data,
    prazo: DATA_RE.test(b.prazo || "") ? b.prazo : null, itens,
    desconto: n(b.desconto), freteCliente: n(b.freteCliente), freteVoce: n(b.freteVoce), taxas: n(b.taxas), sinal: n(b.sinal),
    obs: txt(b.obs, 1000),
  } };
}
function linhaPedido(r) { return { ...JSON.parse(r.dados), id: r.id, numero: r.numero, status: r.status, prazo: r.prazo, criadoEm: r.criado_em, atualizadoEm: r.atualizado_em }; }
app.get("/api/pedidos", exigeLogin, (req, res) => {
  res.json(db.prepare("SELECT * FROM pedidos ORDER BY numero DESC LIMIT 1000").all().map(linhaPedido));
});
app.post("/api/pedidos", exigeLogin, exigeEdicao, (req, res) => {
  const { v, erro } = limpaPedido(req.body); if (erro) return res.status(400).json({ erro });
  const status = STATUS_PEDIDO.includes(req.body.status) && !["entregue", "pronto"].includes(req.body.status) ? req.body.status : "orcamento";
  const id = crypto.randomUUID();
  const numero = (db.prepare("SELECT COALESCE(MAX(numero),0) m FROM pedidos").get().m) + 1;
  db.prepare("INSERT INTO pedidos (id, numero, dados, status, prazo, criado_por) VALUES (?, ?, ?, ?, ?, ?)").run(id, numero, JSON.stringify(v), status, v.prazo, req.usuario.id);
  res.json(linhaPedido(db.prepare("SELECT * FROM pedidos WHERE id = ?").get(id)));
});
app.put("/api/pedidos/:id", exigeLogin, exigeEdicao, (req, res) => {
  const atual = db.prepare("SELECT status FROM pedidos WHERE id = ?").get(req.params.id);
  if (!atual) return res.status(404).json({ erro: "Pedido não encontrado." });
  if (atual.status === "entregue") return res.status(400).json({ erro: "Pedido entregue não pode ser alterado. Volte o status antes." });
  const { v, erro } = limpaPedido(req.body); if (erro) return res.status(400).json({ erro });
  db.prepare("UPDATE pedidos SET dados = ?, prazo = ?, atualizado_em = datetime('now') WHERE id = ?").run(JSON.stringify(v), v.prazo, req.params.id);
  res.json(linhaPedido(db.prepare("SELECT * FROM pedidos WHERE id = ?").get(req.params.id)));
});
app.post("/api/pedidos/:id/status", exigeLogin, exigeEdicao, (req, res) => {
  const novo = req.body?.status;
  if (!STATUS_PEDIDO.includes(novo)) return res.status(400).json({ erro: "Status inválido." });
  const r = db.prepare("SELECT * FROM pedidos WHERE id = ?").get(req.params.id);
  if (!r) return res.status(404).json({ erro: "Pedido não encontrado." });
  const p = JSON.parse(r.dados);
  const avisos = [];
  db.transaction(() => {
    const ordem = s => STATUS_PEDIDO.indexOf(s);
    // chegou em "pronto" (ou além): baixa filamento das peças impressas, uma vez só
    if (novo !== "cancelado" && ordem(novo) >= ordem("pronto") && !r.filamento_baixado) {
      for (const it of p.itens) {
        if (it.doEstoque) continue;
        for (const f of it.fil || []) {
          const falta = baixaFilamento(f.filId, f.g * it.quantidade);
          if (falta > 1) avisos.push(`Faltaram ${Math.round(falta)} g de filamento cadastrado para "${it.descricao}". Confira os rolos em Estoque.`);
        }
      }
      db.prepare("UPDATE pedidos SET filamento_baixado = 1 WHERE id = ?").run(r.id);
    }
    if (novo === "entregue" && r.status !== "entregue") {
      // gera as vendas no financeiro
      const hoje = new Date().toISOString().slice(0, 10);
      const bruto = p.itens.reduce((s, i) => s + i.quantidade * i.preco_unit, 0) || 1;
      const desconto = p.desconto || 0;
      p.itens.forEach((it, idx) => {
        const parte = (it.quantidade * it.preco_unit) / bruto;
        const precoLiq = it.quantidade > 0 ? (it.quantidade * it.preco_unit - desconto * parte) / it.quantidade : 0;
        const extraFrete = idx === 0 ? (p.freteCliente || 0) : 0; // frete cobrado do cliente entra na 1ª linha
        db.prepare(`INSERT INTO vendas (id, data, produto_id, descricao, quantidade, preco_unit, canal, taxas, frete, custo_unit, cliente, status, obs, criado_por, pedido_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pago', ?, ?, ?)`).run(
          crypto.randomUUID(), hoje, it.produto_id, it.descricao, it.quantidade, n(precoLiq + extraFrete / it.quantidade), p.canal,
          n((p.taxas || 0) * parte), idx === 0 ? n(p.freteVoce || 0) : 0, it.custo_unit, p.cliente, `Pedido #${r.numero}`, req.usuario.id, r.id);
      });
      if (!r.estoque_baixado) {
        for (const it of p.itens) if (it.doEstoque && it.produto_id) ajustaEstoque(it.produto_id, -it.quantidade);
        db.prepare("UPDATE pedidos SET estoque_baixado = 1 WHERE id = ?").run(r.id);
      }
    }
    if (r.status === "entregue" && novo !== "entregue") {
      db.prepare("DELETE FROM vendas WHERE pedido_id = ?").run(r.id);
      avisos.push("As vendas deste pedido foram retiradas do financeiro.");
    }
    db.prepare("UPDATE pedidos SET status = ?, atualizado_em = datetime('now') WHERE id = ?").run(novo, r.id);
  })();
  res.json({ pedido: linhaPedido(db.prepare("SELECT * FROM pedidos WHERE id = ?").get(r.id)), avisos });
});
app.delete("/api/pedidos/:id", exigeLogin, exigeEdicao, (req, res) => {
  const r = db.prepare("SELECT status FROM pedidos WHERE id = ?").get(req.params.id);
  if (!r) return res.status(404).json({ erro: "Pedido não encontrado." });
  if (r.status === "entregue") return res.status(400).json({ erro: "Pedido entregue não pode ser excluído. Volte o status antes." });
  db.prepare("DELETE FROM pedidos WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// ---------- catálogo público (sem login) ----------
const limitePublico = rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: "draft-7", legacyHeaders: false });
function produtosPublicos() {
  return db.prepare("SELECT id, dados, foto FROM produtos ORDER BY criado_em").all()
    .map(r => ({ id: r.id, p: JSON.parse(r.dados), foto: r.foto }))
    .filter(x => x.p.catalogo && Number(x.p.precoCatalogo) > 0);
}
app.get("/api/publico/catalogo", limitePublico, (req, res) => {
  const c = db.prepare("SELECT dados FROM config WHERE id = 1").get();
  const loja = (c && JSON.parse(c.dados).loja) || {};
  res.set("Cache-Control", "public, max-age=60");
  res.json({
    loja: { nome: txt(loja.nome, 80) || "Impressões 3D", whatsapp: txt(loja.whatsapp, 30).replace(/\D/g, ""), instagram: txt(loja.instagram, 60), pagamento: txt(loja.pagamento, 200), prazoDias: Number(loja.prazoDias) || 0, sobre: txt(loja.sobre, 400) },
    produtos: produtosPublicos().map(({ id, p, foto }) => ({
      id, nome: p.nome, categoria: p.categoria || "", descricao: txt(p.descricaoCatalogo, 400), preco: n(p.precoCatalogo),
      prontaEntrega: (Number(p.estoque) || 0) > 0, foto: foto ? "/fotos-publicas/" + foto : null, personalizavel: !!p.personalizavel,
    })),
  });
});
app.get("/fotos-publicas/:nome", limitePublico, (req, res) => {
  const nome = req.params.nome;
  if (!FOTO_RE.test(nome) || !produtosPublicos().some(x => x.foto === nome)) return res.status(404).end();
  res.set("Cache-Control", "public, max-age=3600");
  res.sendFile(path.join(FOTOS_DIR, nome), err => { if (err && !res.headersSent) res.status(404).end(); });
});
app.get("/catalogo", (req, res) => res.sendFile(path.join(__dirname, "public", "catalogo.html")));

// ---------- páginas ----------
app.use(express.static(path.join(__dirname, "public"), { index: "index.html", maxAge: "1h" }));
app.use("/api", (req, res) => res.status(404).json({ erro: "Rota não encontrada." }));
app.use((err, req, res, next) => {
  console.error(err);
  if (req.path.startsWith("/api")) return res.status(500).json({ erro: "Erro no servidor." });
  res.status(500).send("Erro no servidor.");
});

app.listen(PORT, HOST, () => console.log(`Precificador 3D rodando em http://${HOST}:${PORT}`));

// Precificador 3D — servidor com login.
// Uso: npm start   (variáveis em .env.example)
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const https = require("https");
const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const QRCode = require("qrcode");
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
  const serieV = db.prepare(`SELECT substr(data,1,7) mes, SUM(quantidade*preco_unit - taxas - frete - adiantado) liquido, SUM(quantidade*preco_unit - taxas - frete - quantidade*custo_unit) lucro, SUM(quantidade) pecas
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
    const v = db.prepare("SELECT COALESCE(SUM(quantidade*preco_unit - taxas - frete - adiantado),0) t FROM vendas WHERE status='pago' AND data < ?").get(de).t;
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
// Compra parcelada: gera uma conta por mês (mesmo dia; em meses mais curtos, o último dia).
// O valor total é dividido em centavos e a sobra do arredondamento vai na 1ª parcela.
function somaMeses(iso, k) {
  const [a, m, d] = iso.split("-").map(Number);
  const ult = new Date(Date.UTC(a, m - 1 + k + 1, 0)).getUTCDate();
  return new Date(Date.UTC(a, m - 1 + k, Math.min(d, ult))).toISOString().slice(0, 10);
}
app.post("/api/lancamentos/parcelado", exigeLogin, exigeEdicao, (req, res) => {
  const b = req.body || {};
  const parcelas = Math.round(n(b.parcelas));
  if (!(parcelas >= 2 && parcelas <= 60)) return res.status(400).json({ erro: "Informe de 2 a 60 parcelas." });
  const { v, erro } = limpaLanc({ ...b, valor: b.valor, status: "pendente" }); if (erro) return res.status(400).json({ erro });
  const centavos = Math.round(v.valor * 100);
  const total = b.modo === "total" ? centavos : centavos * parcelas;
  const base = Math.floor(total / parcelas), sobra = total - base * parcelas;
  const pagas = Math.max(0, Math.min(parcelas, Math.round(n(b.pagas))));
  const grupo = crypto.randomUUID().slice(0, 8);
  const ins = db.prepare("INSERT INTO lancamentos (id, data, tipo, descricao, categoria, valor, status, obs, criado_por) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
  const criadas = [];
  db.transaction(() => {
    for (let k = 0; k < parcelas; k++) {
      const valor = (base + (k === 0 ? sobra : 0)) / 100, data = somaMeses(v.data, k);
      const obs = [`Parcela ${k + 1} de ${parcelas} · total ${(total / 100).toFixed(2).replace(".", ",")} · grupo ${grupo}`, v.obs].filter(Boolean).join(" · ").slice(0, 500);
      ins.run(crypto.randomUUID(), data, v.tipo, `${v.descricao} (${k + 1}/${parcelas})`.slice(0, 150), v.categoria, valor, k < pagas ? "pago" : "pendente", obs, req.usuario.id);
      criadas.push({ data, valor });
    }
  })();
  res.json({ parcelas: criadas, total: total / 100 });
});

crud("vendas", limpaVenda, COLS_V);
crud("lancamentos", limpaLanc, COLS_L);

app.get("/api/financeiro/csv", exigeLogin, (req, res) => {
  const mes = MES_RE.test(req.query.mes || "") ? req.query.mes : new Date().toISOString().slice(0, 7);
  const [de, ate] = intervaloMes(mes);
  const linhas = [["Data", "Tipo", "Descrição", "Categoria/Canal", "Qtd", "Valor bruto", "Taxas", "Frete", "Valor líquido", "Já recebido no sinal", "Custo", "Lucro", "Situação"]];
  for (const v of db.prepare("SELECT * FROM vendas WHERE data BETWEEN ? AND ? ORDER BY data").all(de, ate)) {
    const bruto = v.quantidade * v.preco_unit, liq = bruto - v.taxas - v.frete, custo = v.quantidade * v.custo_unit;
    linhas.push([v.data, "Venda", v.descricao, v.canal, v.quantidade, bruto, v.taxas, v.frete, liq, v.adiantado || 0, custo, liq - custo, v.status]);
  }
  for (const l of db.prepare("SELECT * FROM lancamentos WHERE data BETWEEN ? AND ? ORDER BY data").all(de, ate)) {
    const val = l.tipo === "entrada" ? l.valor : -l.valor;
    linhas.push([l.data, l.tipo === "entrada" ? "Receita" : "Despesa", l.descricao, l.categoria, "", "", "", "", val, "", "", "", l.status]);
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

// ---------- dados do link do modelo (MakerWorld / Thingiverse) ----------
// O navegador não consegue ler essas páginas (CORS), então o servidor busca.
// Só fala com hosts fixos: o id do modelo vem da URL, nunca o endereço inteiro.
const UA_MODELO = "Precificador3D/1.0 (pre-visualizacao de link)";
const HOSTS_IMAGEM = /^(makerworld\.bblmw\.com|public\.bblmw\.cn|(resize|cdn)\.thingiverse\.com)$/;
const limiteModelo = rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: "draft-7", legacyHeaders: false });
// Usa https.get e não fetch: o Cloudflare do MakerWorld bloqueia o fetch do Node (403).
function httpsGet(url, { max = 5 * 1024 * 1024, timeout = 12000 } = {}) {
  return new Promise((ok, falha) => {
    const req = https.get(url, { headers: { "User-Agent": UA_MODELO, Accept: "*/*" } }, r => {
      const partes = []; let total = 0;
      r.on("data", d => { total += d.length; if (total > max) { req.destroy(Object.assign(new Error("grande"), { grande: true })); return; } partes.push(d); });
      r.on("end", () => ok({ status: r.statusCode, headers: r.headers, corpo: Buffer.concat(partes) }));
      r.on("error", falha);
    });
    req.setTimeout(timeout, () => req.destroy(new Error("tempo")));
    req.on("error", falha);
  });
}
async function buscaModelo(url, tipo) {
  let r;
  try { r = await httpsGet(url); if (r.status >= 500 || r.status === 403 || r.status === 429) throw new Error("site " + r.status); }
  catch (e) { console.warn("modelo-info: 1ª tentativa falhou:", url, e.message); await new Promise(ok => setTimeout(ok, 800)); r = await httpsGet(url); }
  if (r.status !== 200) throw Object.assign(new Error("site " + r.status), { site: r.status });
  const texto = r.corpo.toString("utf8");
  return tipo === "json" ? JSON.parse(texto) : texto;
}
const metaTag = (html, prop) => {
  const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*>`, "i"));
  const c = m && m[0].match(/content=["']([^"']*)["']/i);
  return c ? c[1].replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'") : "";
};
const linkImagem = u => { try { const x = new URL(u); return x.protocol === "https:" && HOSTS_IMAGEM.test(x.hostname) ? "/api/modelo-imagem?u=" + encodeURIComponent(x.href) : null; } catch { return null; } };

app.get("/api/modelo-info", exigeLogin, exigeEdicao, limiteModelo, async (req, res) => {
  let u; try { u = new URL(String(req.query.url || "").trim()); } catch { return res.status(400).json({ erro: "Link inválido." }); }
  try {
    if (/(^|\.)makerworld\.com$/.test(u.hostname)) {
      const id = (u.pathname.match(/\/models\/(\d+)/) || [])[1];
      if (!id) return res.status(400).json({ erro: "Não achei o número do modelo nesse link." });
      const d = await buscaModelo(`https://makerworld.com/api/v1/design-service/design/${id}`, "json");
      const perfil = Number((u.hash.match(/profileId-(\d+)/) || [])[1]);
      const lista = Array.isArray(d.instances) ? d.instances : [];
      const ins = lista.find(i => perfil && i.profileId === perfil) || lista.find(i => i.id === d.defaultInstanceId) || lista[0] || {};
      return res.json({
        site: "MakerWorld",
        titulo: txt(d.titleTranslated || d.title, 120),
        perfil: txt(ins.title, 120),
        segundos: Math.max(0, Math.round(Number(ins.prediction) || 0)),
        filamentos: (Array.isArray(ins.instanceFilaments) ? ins.instanceFilaments : []).slice(0, 8)
          .map(f => ({ tipo: txt(f.type, 30), cor: /^#[0-9a-f]{3,8}$/i.test(f.color) ? f.color : "", g: n(f.usedG) }))
          .filter(f => f.g > 0),
        imagem: linkImagem(d.coverUrl || ins.cover),
      });
    }
    if (/(^|\.)thingiverse\.com$/.test(u.hostname)) {
      const id = (u.pathname.match(/thing:(\d+)/) || [])[1];
      if (!id) return res.status(400).json({ erro: "Não achei o número do modelo nesse link." });
      const html = await buscaModelo(`https://www.thingiverse.com/thing:${id}`, "text");
      return res.json({ site: "Thingiverse", titulo: txt(metaTag(html, "og:title").replace(/\s+by\s+.*$/i, ""), 120), segundos: 0, filamentos: [], imagem: linkImagem(metaTag(html, "og:image")) });
    }
    res.status(422).json({ erro: "Só dá para puxar os dados de links do MakerWorld e do Thingiverse. Nos outros sites, envie a foto manualmente." });
  } catch (e) {
    if (e.site !== 404) console.warn("modelo-info:", u.href, e.message);
    res.status(502).json({ erro: e.site === 404 ? "Modelo não encontrado. Confira o link." : "O site do modelo não respondeu. Tente de novo ou envie a foto manualmente." });
  }
});

app.get("/api/modelo-imagem", exigeLogin, exigeEdicao, limiteModelo, async (req, res) => {
  let url = String(req.query.u || "");
  try {
    for (let salto = 0; ; salto++) {
      const x = new URL(url);
      if (x.protocol !== "https:" || !HOSTS_IMAGEM.test(x.hostname) || salto > 3) return res.status(400).end();
      const r = await httpsGet(x.href, { max: 20 * 1024 * 1024, timeout: 20000 });
      if (r.status >= 300 && r.status < 400 && r.headers.location) { url = new URL(r.headers.location, x).href; continue; }
      if (r.status !== 200) return res.status(502).end();
      res.set("Content-Type", "application/octet-stream");
      res.set("Cache-Control", "private, no-store");
      return res.send(r.corpo);
    }
  } catch (e) { res.status(e.grande ? 413 : 502).end(); }
});

// Remove fotos enviadas que nunca foram salvas em um produto (mais de 1 dia)
function limpaFotosOrfas() {
  const usadas = new Set(db.prepare("SELECT foto FROM produtos WHERE foto IS NOT NULL").all().map(r => r.foto));
  for (const r of db.prepare("SELECT dados FROM pedidos WHERE dados LIKE '%\"proposta\"%'").all())
    for (const f of JSON.parse(r.dados).proposta?.fotos || []) usadas.add(f.id);
  const logo = lojaConfig().logo; if (logo) usadas.add(logo);
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
    ...(i.recalc ? { recalc: true } : {}),
    ...(i.kit_id ? { kit_id: txt(i.kit_id, 60) } : {}),
    ...(Array.isArray(i.componentes) && i.componentes.length ? { componentes: i.componentes.slice(0, 20).map(c => ({ produto_id: txt(c.produto_id, 60), q: Math.max(0, n(c.q)) })) } : {}),
  })).filter(i => i.descricao && i.quantidade > 0);
  if (!itens.length) return { erro: "Adicione pelo menos um item com quantidade." };
  const data = DATA_RE.test(b.data || "") ? b.data : new Date().toISOString().slice(0, 10);
  return { v: {
    cliente, whatsapp: txt(b.whatsapp, 30).replace(/[^\d+]/g, ""), canal: txt(b.canal, 80), data,
    prazo: DATA_RE.test(b.prazo || "") ? b.prazo : null, itens,
    desconto: n(b.desconto), freteCliente: n(b.freteCliente), freteVoce: n(b.freteVoce), taxas: n(b.taxas), sinal: n(b.sinal),
    obs: txt(b.obs, 1000), ...(b.origem === "catalogo" ? { origem: "catalogo" } : {}), ...(b.cupom ? { cupom: txt(b.cupom, 30).toUpperCase() } : {}),
    ...(b.impressora ? { impressora: txt(b.impressora, 60) } : {}),
    ...(b.entrada !== "" && b.entrada != null && Number.isFinite(Number(b.entrada)) ? { entrada: Math.max(0, n(b.entrada)) } : {}),
  } };
}
// ---------- sinal do pedido entra no caixa no dia em que foi recebido ----------
// Cada aumento do sinal vira uma receita "Sinal do pedido #N" com a data de hoje; se o sinal diminuir,
// tira das receitas mais novas. Na entrega, a venda guarda esse valor em "adiantado".
const hojeBR = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
const sinalLancado = pedidoId => db.prepare("SELECT COALESCE(SUM(valor),0) t FROM lancamentos WHERE pedido_id = ? AND tipo = 'entrada'").get(pedidoId).t;
function sincronizaSinal(pedidoId, uid) {
  const r = db.prepare("SELECT numero, dados, status FROM pedidos WHERE id = ?").get(pedidoId); if (!r || r.status === "entregue") return;
  const p = JSON.parse(r.dados), alvo = n(p.sinal), atual = n(sinalLancado(pedidoId));
  if (alvo > atual + 0.004) {
    db.prepare("INSERT INTO lancamentos (id, data, tipo, descricao, categoria, valor, status, obs, criado_por, pedido_id) VALUES (?, ?, 'entrada', ?, 'Sinal de pedido', ?, 'pago', ?, ?, ?)")
      .run(crypto.randomUUID(), hojeBR(), `Sinal do pedido #${r.numero} · ${p.cliente}`.slice(0, 150), n(alvo - atual), "Lançado pelo pedido; o restante entra na entrega", uid, pedidoId);
  } else if (alvo < atual - 0.004) {
    let tirar = n(atual - alvo);
    for (const l of db.prepare("SELECT id, valor FROM lancamentos WHERE pedido_id = ? AND tipo = 'entrada' ORDER BY data DESC, criado_em DESC").all(pedidoId)) {
      if (tirar <= 0.004) break;
      if (l.valor <= tirar + 0.004) { db.prepare("DELETE FROM lancamentos WHERE id = ?").run(l.id); tirar = n(tirar - l.valor); }
      else { db.prepare("UPDATE lancamentos SET valor = ? WHERE id = ?").run(n(l.valor - tirar), l.id); tirar = 0; }
    }
  }
}
function linhaPedido(r) { return { ...JSON.parse(r.dados), id: r.id, numero: r.numero, status: r.status, prazo: r.prazo, token: r.token || null, criadoEm: r.criado_em, atualizadoEm: r.atualizado_em }; }
app.get("/api/pedidos", exigeLogin, (req, res) => {
  res.json(db.prepare("SELECT * FROM pedidos ORDER BY numero DESC LIMIT 1000").all().map(linhaPedido));
});
app.post("/api/pedidos", exigeLogin, exigeEdicao, (req, res) => {
  const { v, erro } = limpaPedido(req.body); if (erro) return res.status(400).json({ erro });
  const status = STATUS_PEDIDO.includes(req.body.status) && !["entregue", "pronto"].includes(req.body.status) ? req.body.status : "orcamento";
  const id = crypto.randomUUID();
  const numero = (db.prepare("SELECT COALESCE(MAX(numero),0) m FROM pedidos").get().m) + 1;
  db.transaction(() => {
    db.prepare("INSERT INTO pedidos (id, numero, dados, status, prazo, criado_por) VALUES (?, ?, ?, ?, ?, ?)").run(id, numero, JSON.stringify(v), status, v.prazo, req.usuario.id);
    sincronizaSinal(id, req.usuario.id);
  })();
  res.json(linhaPedido(db.prepare("SELECT * FROM pedidos WHERE id = ?").get(id)));
});
app.put("/api/pedidos/:id", exigeLogin, exigeEdicao, (req, res) => {
  const atual = db.prepare("SELECT status, dados FROM pedidos WHERE id = ?").get(req.params.id);
  if (!atual) return res.status(404).json({ erro: "Pedido não encontrado." });
  if (atual.status === "entregue") return res.status(400).json({ erro: "Pedido entregue não pode ser alterado. Volte o status antes." });
  const { v, erro } = limpaPedido(req.body); if (erro) return res.status(400).json({ erro });
  const ant = JSON.parse(atual.dados); if (ant.proposta) v.proposta = ant.proposta; // a proposta tem rota própria
  if (ant.resposta) v.resposta = ant.resposta; // aprovação/recusa feita pelo cliente no link
  db.transaction(() => {
    db.prepare("UPDATE pedidos SET dados = ?, prazo = ?, atualizado_em = datetime('now') WHERE id = ?").run(JSON.stringify(v), v.prazo, req.params.id);
    sincronizaSinal(req.params.id, req.usuario.id);
  })();
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
      // o que já entrou no caixa como sinal fica marcado na venda para não contar duas vezes
      const sinalPago = sinalLancado(r.id); let sinalResto = sinalPago;
      p.itens.forEach((it, idx) => {
        const adiant = idx === p.itens.length - 1 ? n(sinalResto) : n(sinalPago * (it.quantidade * it.preco_unit) / bruto); sinalResto -= adiant;
        const parte = (it.quantidade * it.preco_unit) / bruto;
        const precoLiq = it.quantidade > 0 ? (it.quantidade * it.preco_unit - desconto * parte) / it.quantidade : 0;
        const extraFrete = idx === 0 ? (p.freteCliente || 0) : 0; // frete cobrado do cliente entra na 1ª linha
        db.prepare(`INSERT INTO vendas (id, data, produto_id, descricao, quantidade, preco_unit, canal, taxas, frete, custo_unit, cliente, status, obs, criado_por, pedido_id, adiantado)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pago', ?, ?, ?, ?)`).run(
          crypto.randomUUID(), hoje, it.produto_id, it.descricao, it.quantidade, n(precoLiq + extraFrete / it.quantidade), p.canal,
          n((p.taxas || 0) * parte), idx === 0 ? n(p.freteVoce || 0) : 0, it.custo_unit, p.cliente,
          `Pedido #${r.numero}${adiant > 0 ? ` · ${brlS(adiant)} recebido antes como sinal` : ""}`, req.usuario.id, r.id, adiant);
      });
      if (!r.estoque_baixado) {
        for (const it of p.itens) if (it.doEstoque && it.produto_id) ajustaEstoque(it.produto_id, -it.quantidade);
        db.prepare("UPDATE pedidos SET estoque_baixado = 1 WHERE id = ?").run(r.id);
      }
    }
    // chegou em "pronto": encerra a impressão em andamento ou registra as horas previstas na impressora
    if (["pronto", "entregue"].includes(novo) && ["aprovado", "imprimindo"].includes(r.status)) registraImpressaoDoPedido(r, p, req.usuario.id, txt(req.body.impressora, 60));
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
  db.prepare("UPDATE impressoes SET pedido_id = NULL WHERE pedido_id = ?").run(req.params.id);
  db.prepare("DELETE FROM lancamentos WHERE pedido_id = ?").run(req.params.id); // pedido apagado: tira o sinal do caixa
  res.json({ ok: true });
});
app.post("/api/pedidos/:id/impressora", exigeLogin, exigeEdicao, (req, res) => {
  const r = db.prepare("SELECT * FROM pedidos WHERE id = ?").get(req.params.id);
  if (!r) return res.status(404).json({ erro: "Pedido não encontrado." });
  const imp = txt(req.body?.impressora, 60);
  if (imp && !impressoraExiste(imp)) return res.status(400).json({ erro: "Impressora não encontrada." });
  const p = JSON.parse(r.dados);
  if (imp) p.impressora = imp; else delete p.impressora;
  db.prepare("UPDATE pedidos SET dados = ?, atualizado_em = datetime('now') WHERE id = ?").run(JSON.stringify(p), r.id);
  res.json(linhaPedido(db.prepare("SELECT * FROM pedidos WHERE id = ?").get(r.id)));
});

// ---------- proposta comercial (PDF) ----------
// Os textos da proposta ficam em pedido.proposta; a página abaixo monta as folhas A4 para salvar em PDF.
function limpaProposta(b) {
  b = b || {};
  const lista = (x, max, f) => (Array.isArray(x) ? x : []).slice(0, max).map(f).filter(Boolean);
  return {
    titulo: txt(b.titulo, 120), produtoTitulo: txt(b.produtoTitulo, 80), texto: txt(b.texto, 1200),
    fotos: lista(b.fotos, 4, f => FOTO_RE.test(f?.id || "") ? { id: f.id, legenda: txt(f.legenda, 80) } : null),
    destaques: lista(b.destaques, 6, d => (txt(d?.t, 60) || txt(d?.d, 200)) ? { t: txt(d.t, 60), d: txt(d.d, 200) } : null),
    specs: lista(b.specs, 10, d => (txt(d?.k, 60) || txt(d?.v, 160)) ? { k: txt(d.k, 60), v: txt(d.v, 160) } : null),
    faixas: lista(b.faixas, 8, f => n(f?.preco) > 0 ? { rotulo: txt(f.rotulo, 80), q: Math.max(1, Math.round(n(f.q))), preco: n(f.preco), prazo: txt(f.prazo, 40) } : null),
    destaqueFaixa: Math.round(Number.isFinite(Number(b.destaqueFaixa)) ? Number(b.destaqueFaixa) : -1), somar: !!b.somar,
    notaPreco: txt(b.notaPreco, 300), arteValor: n(b.arteValor), arteNota: txt(b.arteNota, 200),
    condicoes: lista(b.condicoes, 8, d => txt(d?.v, 300) ? { k: txt(d.k, 40), v: txt(d.v, 300) } : null),
    validade: DATA_RE.test(b.validade || "") ? b.validade : null,
    passos: lista(b.passos, 6, x => txt(x, 160) || null),
  };
}
app.put("/api/pedidos/:id/proposta", exigeLogin, exigeEdicao, (req, res) => {
  const r = db.prepare("SELECT dados FROM pedidos WHERE id = ?").get(req.params.id);
  if (!r) return res.status(404).json({ erro: "Pedido não encontrado." });
  const p = JSON.parse(r.dados); p.proposta = limpaProposta(req.body);
  db.prepare("UPDATE pedidos SET dados = ?, atualizado_em = datetime('now') WHERE id = ?").run(JSON.stringify(p), req.params.id);
  res.json(linhaPedido(db.prepare("SELECT * FROM pedidos WHERE id = ?").get(req.params.id)));
});
app.get("/imprimir/proposta/:id", exigeLogin, (req, res) => {
  const r = db.prepare("SELECT * FROM pedidos WHERE id = ?").get(req.params.id);
  if (!r) return res.status(404).send("Pedido não encontrado.");
  const p = JSON.parse(r.dados), L = lojaConfig(), pr = p.proposta;
  if (!pr) return res.status(404).send("Este pedido ainda não tem proposta. Abra o pedido e clique em Proposta em PDF.");
  const e = escH, loja = L.nome || "Sua loja";
  const dataLonga = iso => new Date(iso + "T12:00:00").toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric" });
  const zap = txt(L.whatsapp, 30), site = txt(L.site, 80).replace(/^https?:\/\//, "").replace(/\/$/, "");
  const contato = [site, zap].filter(Boolean).map(e).join(" · ");
  const logo = L.logo && FOTO_RE.test(L.logo) ? `<img class="logo" src="/fotos/${L.logo}" alt="${e(loja)}">` : `<div class="logotxt">${e(loja)}</div>`;
  // título com a primeira palavra sublinhada, no estilo das propostas da loja
  const tit = (t, cls = "") => { const [a, ...b] = String(t || "").split(" "); return `<h1 class="${cls}"><u>${e(a)}</u> ${e(b.join(" "))}</h1>`; };
  const rodape = k => `<div class="pe"><span>${e(loja)} · Proposta comercial · ${e(p.cliente)}</span><span>${k}</span></div>`;
  const fotoTag = f => `<figure><div class="ph"><img src="/fotos/${f.id}" alt=""></div>${f.legenda ? `<figcaption>${e(f.legenda)}</figcaption>` : ""}</figure>`;
  let pag = 1; const pags = [];
  // capa
  pags.push(`<section class="pg dark capa">${logo}<div class="k">Proposta comercial</div>${tit(pr.titulo || "Proposta")}
    <p class="para">Para ${e(p.cliente)} · ${dataLonga(p.data || hojeBR())}</p>
    ${pr.fotos[0] ? `<div class="ph grande"><img src="/fotos/${pr.fotos[0].id}" alt=""></div>` : ""}
    <div class="pe">${contato}</div></section>`);
  // o produto; poucas especificações cabem na mesma página
  const fotosProd = pr.fotos.slice(1, 3);
  const specTab = `<table class="spec"><tr><th>Especificação</th><th>Valor</th></tr>${pr.specs.map(d => `<tr><td><b>${e(d.k)}</b></td><td>${e(d.v)}</td></tr>`).join("")}</table>`;
  const specJunto = pr.specs.length > 0 && !pr.fotos[3] && pr.specs.length + pr.destaques.length <= (fotosProd.length ? 9 : 14) && (pr.texto || pr.destaques.length || fotosProd.length);
  if (pr.texto || pr.destaques.length || fotosProd.length)
    pags.push(`<section class="pg"><div class="k">O produto</div>${tit(pr.produtoTitulo || "Sobre a peça", "h2")}
      ${pr.texto ? `<p class="lead">${e(pr.texto).replace(/\n/g, "<br>")}</p>` : ""}
      ${fotosProd.length ? `<div class="fotos n${fotosProd.length}">${fotosProd.map(fotoTag).join("")}</div>` : ""}
      ${pr.destaques.length ? `<table class="dest">${pr.destaques.map(d => `<tr><td><i></i><b>${e(d.t)}</b></td><td>${e(d.d)}</td></tr>`).join("")}</table>` : ""}
      ${specJunto ? `<div class="k" style="margin-top:9mm">Especificações</div>${specTab}` : ""}
      ${rodape(++pag)}</section>`);
  // especificações em página própria
  if (pr.specs.length && !specJunto)
    pags.push(`<section class="pg"><div class="k">Especificações</div>${tit("Detalhes da peça", "h2")}
      ${pr.fotos[3] ? `<div class="fotos n1">${fotoTag(pr.fotos[3])}</div>` : ""}
      ${specTab}
      ${rodape(++pag)}</section>`);
  // investimento + condições
  const temPrazo = pr.faixas.some(f => f.prazo), vazio = temPrazo ? "<td></td>" : "";
  const totalItens = pr.faixas.reduce((s, f) => s + f.q * f.preco, 0);
  const desc = n(p.desconto), frete = n(p.freteCliente);
  const conds = [...pr.condicoes, ...(pr.validade ? [{ k: "Validade", v: `Esta proposta vale até ${dataLonga(pr.validade)}.` }] : [])];
  pags.push(`<section class="pg"><div class="k">Investimento</div>${tit(pr.somar ? "Valores do pedido" : "Preço por quantidade", "h2")}
    ${pr.notaPreco ? `<p class="lead sm">${e(pr.notaPreco)}</p>` : ""}
    <table class="inv"><tr><th>${pr.somar ? "Item" : "Quantidade"}</th>${pr.somar ? "<th>Qtd</th>" : ""}<th>Por unidade</th><th>Total</th>${temPrazo ? "<th>Prazo</th>" : ""}</tr>
    ${pr.faixas.map((f, i) => `<tr${i === pr.destaqueFaixa ? ' class="on"' : ""}><td><b>${e(f.rotulo || `${f.q} ${f.q === 1 ? "unidade" : "unidades"}`)}</b></td>${pr.somar ? `<td>${f.q}</td>` : ""}<td>${brlS(f.preco)}</td><td>${brlS(f.q * f.preco)}</td>${temPrazo ? `<td><b>${e(f.prazo)}</b></td>` : ""}</tr>`).join("")}
    ${pr.somar ? `${desc > 0 ? `<tr><td colspan="3">Desconto</td><td>− ${brlS(desc)}</td>${vazio}</tr>` : ""}${frete > 0 ? `<tr><td colspan="3">Frete</td><td>${brlS(frete)}</td>${vazio}</tr>` : ""}<tr class="tot"><td colspan="3">Total</td><td>${brlS(totalItens - desc + frete)}</td>${vazio}</tr>` : ""}</table>
    ${!pr.somar && pr.destaqueFaixa >= 0 && pr.destaqueFaixa < pr.faixas.length ? `<p class="mini">Linha em destaque: melhor custo por unidade.</p>` : ""}
    ${pr.arteValor > 0 ? `<div class="box"><b>Preparação da arte: ${brlS(pr.arteValor)} (uma única vez)</b>${pr.arteNota ? `<span>${e(pr.arteNota)}</span>` : ""}</div>` : ""}
    ${conds.length ? `<div class="k" style="margin-top:9mm">Condições</div>${tit("Como funciona", "h2")}<table class="cond">${conds.map(c => `<tr><td><b>${e(c.k)}</b></td><td>${e(c.v)}</td></tr>`).join("")}</table>` : ""}
    ${rodape(++pag)}</section>`);
  // próximos passos + contato
  pags.push(`<section class="pg dark fim">${pr.passos.length ? `<div class="k">Próximos passos</div>${tit("Do sim à entrega", "h2")}
    <ol class="passos">${pr.passos.map(x => `<li>${e(x)}</li>`).join("")}</ol>` : ""}
    <div class="k" style="margin-top:12mm">Fale com a gente</div>
    <table class="cont">${zap ? `<tr><td>WhatsApp</td><td><b>${e(zap)}</b></td></tr>` : ""}${site ? `<tr><td>Site</td><td><b>${e(site)}</b></td></tr>` : ""}${L.instagram ? `<tr><td>Instagram</td><td><b>${e(L.instagram)}</b></td></tr>` : ""}</table>
    <div class="fimlogo">${logo}</div></section>`);
  const cor = /^#[0-9a-f]{6}$/i.test(L.cor || "") ? L.cor : "#22c08a";
  res.set("Content-Type", "text/html; charset=utf-8");
  res.send(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Proposta ${e(loja)} - ${e(pr.titulo)} - ${e(p.cliente)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=Inter:wght@400;600;700&display=swap">
<style>
@page{size:A4;margin:0}
*{box-sizing:border-box}
html,body{margin:0;background:#6b7078;-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{font-family:Inter,Arial,sans-serif;color:#1b1d21;font-size:11pt}
.pg{width:210mm;height:297mm;margin:0 auto 8mm;padding:20mm 18mm 14mm;background:#f2f1ec;position:relative;overflow:hidden;break-after:page;display:flex;flex-direction:column}
.pg:last-child{break-after:auto}
.dark{background:#0e1114;color:#f3f4f6}
.k{font-size:8pt;letter-spacing:.32em;text-transform:uppercase;color:${cor};margin-bottom:3mm}
h1{font-family:"Archivo Black",Arial,sans-serif;font-weight:400;font-size:34pt;line-height:1.1;margin:0 0 6mm}
h1.h2{font-size:24pt}
h1 u{text-decoration:none;background:linear-gradient(${cor},${cor}) left bottom/100% 1.6mm no-repeat;padding-bottom:.6mm}
.logo{max-height:26mm;max-width:70mm;object-fit:contain;align-self:flex-start}
.logotxt{font-family:"Archivo Black",Arial,sans-serif;font-size:22pt}
.capa .logo,.capa .logotxt{margin-bottom:38mm}
.para{color:#b7bcc4;font-size:12pt;margin:0 0 14mm}
.ph{background:#fff;border-radius:3mm;display:flex;align-items:center;justify-content:center;overflow:hidden}
.ph img{width:100%;height:100%;object-fit:contain}
.ph.grande{height:118mm}
.capa .pe{border:0;color:#8a9099}
.lead{font-size:12pt;line-height:1.5;margin:0 0 8mm}.lead.sm{font-size:10.5pt;color:#4b5058}
.fotos{display:grid;gap:6mm;margin-bottom:9mm}.fotos.n2{grid-template-columns:1fr 1fr}.fotos.n1{grid-template-columns:1fr}
.fotos .ph{height:72mm}.fotos.n1 .ph{height:90mm}
figure{margin:0}figcaption{font-size:8.5pt;color:#7a7f87;margin-top:2.5mm}
table{width:100%;border-collapse:collapse}
.dest td{padding:2.2mm 0;vertical-align:top;font-size:10.5pt}.dest td:first-child{width:62mm}.dest td:last-child{color:#4b5058}
.dest i{display:inline-block;width:3mm;height:3mm;background:${cor};margin-right:3mm}
.spec th,.inv th{text-align:left;font-weight:400;font-size:7.5pt;letter-spacing:.25em;text-transform:uppercase;color:#7a7f87;padding:0 0 3mm;border-bottom:.4mm solid #1b1d21}
.spec td,.inv td{padding:3mm 0;border-bottom:.2mm solid #d6d4cc;font-size:10.5pt;vertical-align:top}
.spec td:first-child{width:62mm}
.inv tr.on td{background:color-mix(in srgb,${cor} 18%,white)}
.inv tr.tot td{font-weight:700;border-bottom:.4mm solid #1b1d21}
.mini{font-size:8.5pt;color:#7a7f87;margin:2.5mm 0 0}
.box{margin-top:8mm;background:#fff;border-left:2mm solid ${cor};border-radius:0 3mm 3mm 0;padding:5mm 7mm;display:flex;flex-direction:column;gap:1.5mm;font-size:10.5pt}.box span{color:#4b5058}
.cond td{padding:1.6mm 0;font-size:10.5pt;vertical-align:top}.cond td:first-child{width:38mm}.cond td:last-child{color:#4b5058}
.pe{margin-top:auto;display:flex;justify-content:space-between;border-top:.2mm solid #d6d4cc;padding-top:3mm;font-size:8pt;color:#7a7f87}
.passos{list-style:none;counter-reset:n;padding:0;margin:4mm 0 0}
.passos li{counter-increment:n;display:flex;gap:10mm;align-items:baseline;margin-bottom:9mm;font-size:12pt}
.passos li::before{content:counter(n);font-family:"Archivo Black",Arial,sans-serif;font-size:22pt;color:${cor};width:8mm;flex:none}
.cont td{padding:2mm 0;font-size:13pt}.cont td:first-child{width:28mm;font-size:9pt;color:#8a9099}
.fimlogo{margin-top:auto}.fimlogo .logo{max-height:18mm}.fimlogo .logotxt{font-size:16pt}
.dica{max-width:210mm;margin:8mm auto;background:#fff;border-radius:2mm;padding:4mm 6mm;font:10pt Inter,Arial,sans-serif}
@media print{html,body{background:none}.pg{margin:0}.dica{display:none}}
</style></head><body>
<p class="dica">Na janela de impressão, escolha <b>Salvar como PDF</b>, papel <b>A4</b>, margens <b>Nenhuma</b> e marque <b>Gráficos de plano de fundo</b>. Se ela não abrir, use Ctrl+P.</p>
${pags.join("")}
<script src="/imprimir.js"></script></body></html>`);
});

// ---------- impressoras: impressões em andamento e horas de máquina ----------
// As impressoras ficam em config.impressoras; aqui ficam as impressões (com início, pausa e fim),
// que dão o tempo restante ao vivo e as horas de cada máquina para a manutenção.
const ST_ATIVA = ["imprimindo", "pausada"];
function impressorasCfg() {
  const r = db.prepare("SELECT dados FROM config WHERE id = 1").get();
  const c = r ? JSON.parse(r.dados) : null;
  return c && Array.isArray(c.impressoras) ? c.impressoras : null;
}
function impressoraExiste(id) { const l = impressorasCfg(); return !!l && l.some(i => i.id === id); }
function decorridoS(x, agora = Date.now()) {
  const ate = x.fim || x.pausado_em || agora;
  return Math.max(0, Math.round((ate - x.inicio) / 1000) - (x.pausa_s || 0));
}
function linhaImpressao(x) {
  const dec = decorridoS(x);
  return { id: x.id, impressora: x.impressora_id, pedido: x.pedido_id, descricao: x.descricao, status: x.status, origem: x.origem,
    inicio: x.inicio, fim: x.fim, duracao_s: x.duracao_s, decorrido_s: dec,
    restante_s: x.restante_s != null && ST_ATIVA.includes(x.status) ? x.restante_s : Math.max(0, x.duracao_s - dec),
    progresso: x.progresso, pausado_em: x.pausado_em, atualizado_em: x.atualizado_em };
}
function horasPedido(p) {
  return (p.itens || []).reduce((s, i) => s + (i.doEstoque ? 0 : n(i.quantidade) * n(i.horas_unit)), 0);
}
function registraImpressaoDoPedido(r, p, uid, sugerida) {
  const lista = impressorasCfg(); if (!lista || !lista.length) return;
  const agora = Date.now();
  const ativas = db.prepare(`SELECT * FROM impressoes WHERE pedido_id = ? AND status IN ('imprimindo','pausada')`).all(r.id);
  for (const x of ativas) {
    const pausa = x.pausado_em ? (x.pausa_s || 0) + Math.round((agora - x.pausado_em) / 1000) : x.pausa_s;
    db.prepare("UPDATE impressoes SET status = 'concluida', fim = ?, pausado_em = NULL, pausa_s = ?, atualizado_em = ? WHERE id = ?").run(agora, pausa, agora, x.id);
  }
  if (db.prepare("SELECT 1 FROM impressoes WHERE pedido_id = ?").get(r.id)) return; // já tem impressão registrada
  const horas = horasPedido(p); if (!(horas > 0)) return;
  const imp = [p.impressora, sugerida].find(id => id && lista.some(i => i.id === id)) || lista[0].id;
  const dur = Math.round(horas * 3600);
  db.prepare(`INSERT INTO impressoes (id, impressora_id, pedido_id, descricao, inicio, duracao_s, fim, status, origem, atualizado_em, criado_por)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'concluida', 'pedido', ?, ?)`).run(crypto.randomUUID(), imp, r.id, `Pedido #${r.numero}`, agora - dur * 1000, dur, agora, agora, uid);
}

app.get("/api/impressoes", exigeLogin, (req, res) => {
  const ativas = db.prepare("SELECT * FROM impressoes WHERE status IN ('imprimindo','pausada') ORDER BY inicio").all().map(linhaImpressao);
  const recentes = db.prepare("SELECT * FROM impressoes WHERE status NOT IN ('imprimindo','pausada') ORDER BY fim DESC LIMIT 30").all().map(linhaImpressao);
  const horas = {}, falhas = {};
  for (const x of db.prepare("SELECT * FROM impressoes").all()) {
    horas[x.impressora_id] = (horas[x.impressora_id] || 0) + decorridoS(x) / 3600;
    if (x.status === "falhou") falhas[x.impressora_id] = (falhas[x.impressora_id] || 0) + 1;
  }
  res.json({ agora: Date.now(), ativas, recentes, horas, falhas });
});
app.post("/api/impressoes", exigeLogin, exigeEdicao, (req, res) => {
  const b = req.body || {};
  const imp = txt(b.impressora, 60);
  if (!impressoraExiste(imp)) return res.status(400).json({ erro: "Escolha uma impressora." });
  const dur = Math.round(n(b.duracao_s));
  if (!(dur >= 60 && dur <= 14 * 86400)) return res.status(400).json({ erro: "Informe o tempo de impressão (de 1 minuto a 14 dias)." });
  if (db.prepare("SELECT 1 FROM impressoes WHERE impressora_id = ? AND status IN ('imprimindo','pausada')").get(imp))
    return res.status(409).json({ erro: "Essa impressora já está imprimindo. Conclua ou cancele a impressão atual antes." });
  let pedido = null;
  if (b.pedido) {
    pedido = db.prepare("SELECT * FROM pedidos WHERE id = ?").get(txt(b.pedido, 60));
    if (!pedido) return res.status(404).json({ erro: "Pedido não encontrado." });
  }
  const descricao = txt(b.descricao, 150) || (pedido ? `Pedido #${pedido.numero}` : "Impressão avulsa");
  const id = crypto.randomUUID(), agora = Date.now();
  db.transaction(() => {
    db.prepare(`INSERT INTO impressoes (id, impressora_id, pedido_id, descricao, inicio, duracao_s, status, origem, atualizado_em, criado_por)
      VALUES (?, ?, ?, ?, ?, ?, 'imprimindo', 'manual', ?, ?)`).run(id, imp, pedido ? pedido.id : null, descricao, agora, dur, agora, req.usuario.id);
    if (pedido && pedido.status === "aprovado") db.prepare("UPDATE pedidos SET status = 'imprimindo', atualizado_em = datetime('now') WHERE id = ?").run(pedido.id);
    if (pedido) { const p = JSON.parse(pedido.dados); if (p.impressora !== imp) { p.impressora = imp; db.prepare("UPDATE pedidos SET dados = ? WHERE id = ?").run(JSON.stringify(p), pedido.id); } }
  })();
  res.json({ impressao: linhaImpressao(db.prepare("SELECT * FROM impressoes WHERE id = ?").get(id)),
    pedido: pedido ? linhaPedido(db.prepare("SELECT * FROM pedidos WHERE id = ?").get(pedido.id)) : null });
});
app.post("/api/impressoes/:id/acao", exigeLogin, exigeEdicao, (req, res) => {
  const x = db.prepare("SELECT * FROM impressoes WHERE id = ?").get(req.params.id);
  if (!x) return res.status(404).json({ erro: "Impressão não encontrada." });
  const acao = req.body?.acao, agora = Date.now();
  if (!ST_ATIVA.includes(x.status)) return res.status(400).json({ erro: "Essa impressão já terminou." });
  const pausaTotal = () => x.pausado_em ? (x.pausa_s || 0) + Math.round((agora - x.pausado_em) / 1000) : (x.pausa_s || 0);
  if (acao === "pausar") {
    if (x.status !== "imprimindo") return res.status(400).json({ erro: "A impressão não está rodando." });
    db.prepare("UPDATE impressoes SET status = 'pausada', pausado_em = ?, atualizado_em = ? WHERE id = ?").run(agora, agora, x.id);
  } else if (acao === "retomar") {
    if (x.status !== "pausada") return res.status(400).json({ erro: "A impressão não está pausada." });
    db.prepare("UPDATE impressoes SET status = 'imprimindo', pausa_s = ?, pausado_em = NULL, atualizado_em = ? WHERE id = ?").run(pausaTotal(), agora, x.id);
  } else if (acao === "ajustar") {
    // "a impressora diz que faltam X": muda a duração para o restante bater
    const falta = Math.round(n(req.body.restante_s));
    if (!(falta >= 0 && falta <= 14 * 86400)) return res.status(400).json({ erro: "Tempo restante inválido." });
    db.prepare("UPDATE impressoes SET duracao_s = ?, atualizado_em = ? WHERE id = ?").run(decorridoS(x, agora) + falta, agora, x.id);
  } else if (["concluir", "falhou", "cancelar"].includes(acao)) {
    const st = { concluir: "concluida", falhou: "falhou", cancelar: "cancelada" }[acao];
    db.prepare("UPDATE impressoes SET status = ?, fim = ?, pausa_s = ?, pausado_em = NULL, restante_s = NULL, atualizado_em = ? WHERE id = ?").run(st, agora, pausaTotal(), agora, x.id);
  } else return res.status(400).json({ erro: "Ação inválida." });
  const y = db.prepare("SELECT * FROM impressoes WHERE id = ?").get(x.id);
  const outrasAtivas = y.pedido_id ? db.prepare("SELECT COUNT(*) c FROM impressoes WHERE pedido_id = ? AND status IN ('imprimindo','pausada')").get(y.pedido_id).c : 0;
  res.json({ impressao: linhaImpressao(y), pedidoSemImpressaoAtiva: !!y.pedido_id && !outrasAtivas });
});
app.delete("/api/impressoes/:id", exigeLogin, exigeEdicao, (req, res) => {
  // apagar do histórico (lançamento errado); a impressão em andamento se cancela, não se apaga
  const x = db.prepare("SELECT status FROM impressoes WHERE id = ?").get(req.params.id);
  if (!x) return res.status(404).json({ erro: "Impressão não encontrada." });
  if (ST_ATIVA.includes(x.status)) return res.status(400).json({ erro: "Cancele a impressão antes de apagar." });
  db.prepare("DELETE FROM impressoes WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});


// ---------- compras / orçamento de equipamentos ----------
const CAT_COMPRA = { Equipamento: "Equipamentos", Filamento: "Filamento", Embalagem: "Embalagem", Ferramenta: "Peças e manutenção", Outros: "Outros" };
function limpaCompra(b) {
  if (!b) return { erro: "Item inválido." };
  const nome = txt(b.nome, 150); if (!nome) return { erro: "Informe o nome do item." };
  const cotacoes = (Array.isArray(b.cotacoes) ? b.cotacoes : []).slice(0, 10).map(c => {
    let link = ""; try { const u = new URL(String(c.link || "").trim()); if (/^https?:$/.test(u.protocol)) link = u.href; } catch {}
    return { loja: txt(c.loja, 80), preco: n(c.preco), link };
  }).filter(c => c.loja || c.preco > 0 || c.link);
  return { v: {
    nome, categoria: Object.keys(CAT_COMPRA).includes(b.categoria) ? b.categoria : "Outros",
    quantidade: Math.max(1, n(b.quantidade) || 1), prioridade: ["essencial", "importante", "depois"].includes(b.prioridade) ? b.prioridade : "importante",
    cotacoes, obs: txt(b.obs, 500),
  } };
}
function linhaCompra(r) { return { ...JSON.parse(r.dados), id: r.id, status: r.status, valorPago: r.valor_pago, dataCompra: r.data_compra, criadoEm: r.criado_em }; }
app.get("/api/compras", exigeLogin, (req, res) => {
  res.json(db.prepare("SELECT * FROM compras ORDER BY criado_em").all().map(linhaCompra));
});
app.post("/api/compras", exigeLogin, exigeEdicao, (req, res) => {
  const lista = Array.isArray(req.body?.itens) ? req.body.itens : [req.body];
  const criados = [];
  for (const b of lista.slice(0, 50)) {
    const { v, erro } = limpaCompra(b); if (erro) return res.status(400).json({ erro });
    const id = crypto.randomUUID();
    db.prepare("INSERT INTO compras (id, dados, status) VALUES (?, ?, ?)").run(id, JSON.stringify(v), v.cotacoes.some(c => c.preco > 0) ? "cotado" : "planejado");
    criados.push(linhaCompra(db.prepare("SELECT * FROM compras WHERE id = ?").get(id)));
  }
  res.json(criados);
});
app.put("/api/compras/:id", exigeLogin, exigeEdicao, (req, res) => {
  const { v, erro } = limpaCompra(req.body); if (erro) return res.status(400).json({ erro });
  const status = ["planejado", "cotado"].includes(req.body.status) ? req.body.status : null;
  const r = db.prepare("UPDATE compras SET dados = ?" + (status ? ", status = ?" : "") + " WHERE id = ?").run(...(status ? [JSON.stringify(v), status, req.params.id] : [JSON.stringify(v), req.params.id]));
  if (!r.changes) return res.status(404).json({ erro: "Item não encontrado." });
  res.json(linhaCompra(db.prepare("SELECT * FROM compras WHERE id = ?").get(req.params.id)));
});
app.post("/api/compras/:id/comprar", exigeLogin, exigeEdicao, (req, res) => {
  const r = db.prepare("SELECT * FROM compras WHERE id = ?").get(req.params.id);
  if (!r) return res.status(404).json({ erro: "Item não encontrado." });
  const valor = n(req.body?.valor); const data = DATA_RE.test(req.body?.data || "") ? req.body.data : new Date().toISOString().slice(0, 10);
  if (valor <= 0) return res.status(400).json({ erro: "Informe quanto você pagou." });
  const c = JSON.parse(r.dados);
  db.transaction(() => {
    db.prepare("UPDATE compras SET status = 'comprado', valor_pago = ?, data_compra = ? WHERE id = ?").run(valor, data, r.id);
    if (req.body.lancarDespesa) db.prepare("INSERT INTO lancamentos (id, data, tipo, descricao, categoria, valor, status, obs, criado_por) VALUES (?, ?, 'saida', ?, ?, ?, 'pago', ?, ?)")
      .run(crypto.randomUUID(), data, `${c.quantidade > 1 ? c.quantidade + "× " : ""}${c.nome}`, CAT_COMPRA[c.categoria] || "Outros", valor, "Lista de compras", req.usuario.id);
  })();
  res.json(linhaCompra(db.prepare("SELECT * FROM compras WHERE id = ?").get(r.id)));
});
app.post("/api/compras/:id/desfazer", exigeLogin, exigeEdicao, (req, res) => {
  const r = db.prepare("UPDATE compras SET status = 'cotado', valor_pago = NULL, data_compra = NULL WHERE id = ?").run(req.params.id);
  if (!r.changes) return res.status(404).json({ erro: "Item não encontrado." });
  res.json(linhaCompra(db.prepare("SELECT * FROM compras WHERE id = ?").get(req.params.id)));
});
app.delete("/api/compras/:id", exigeLogin, exigeEdicao, (req, res) => {
  db.prepare("DELETE FROM compras WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});


// ---------- backup automático ----------
const BACKUP_DIR = path.join(DATA_DIR, "backups");
fs.mkdirSync(BACKUP_DIR, { recursive: true });
const BACKUP_RE = /^precificador-\d{4}-\d{2}-\d{2}(-\d{6})?\.db$/;
async function fazBackup(manual) {
  const agora = new Date();
  const dia = agora.toISOString().slice(0, 10);
  const nome = manual ? `precificador-${dia}-${agora.toISOString().slice(11, 19).replace(/:/g, "")}.db` : `precificador-${dia}.db`;
  const destino = path.join(BACKUP_DIR, nome);
  if (!manual && fs.existsSync(destino)) return null;
  await db.backup(destino);
  // mantém os 14 backups mais recentes
  const lista = fs.readdirSync(BACKUP_DIR).filter(f => BACKUP_RE.test(f)).sort().reverse();
  for (const f of lista.slice(14)) fs.promises.unlink(path.join(BACKUP_DIR, f)).catch(() => {});
  return nome;
}
fazBackup(false).catch(e => console.error("backup", e));
setInterval(() => fazBackup(false).catch(e => console.error("backup", e)), 3 * 60 * 60 * 1000).unref();
app.get("/api/backups", exigeLogin, exigeAdmin, (req, res) => {
  const lista = fs.readdirSync(BACKUP_DIR).filter(f => BACKUP_RE.test(f)).sort().reverse()
    .map(f => { const st = fs.statSync(path.join(BACKUP_DIR, f)); return { nome: f, tamanho: st.size, data: st.mtime.toISOString() }; });
  const fotos = fs.readdirSync(FOTOS_DIR).filter(f => FOTO_RE.test(f)).length;
  res.json({ backups: lista, fotos });
});
app.post("/api/backups", exigeLogin, exigeAdmin, async (req, res) => {
  try { res.json({ nome: await fazBackup(true) }); } catch (e) { console.error(e); res.status(500).json({ erro: "Não deu para fazer o backup agora." }); }
});
app.get("/api/backups/:nome", exigeLogin, exigeAdmin, (req, res) => {
  if (!BACKUP_RE.test(req.params.nome)) return res.status(404).end();
  res.download(path.join(BACKUP_DIR, req.params.nome), req.params.nome, err => { if (err && !res.headersSent) res.status(404).end(); });
});

// ---------- Pix (BR Code copia e cola) ----------
const semAcento = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\x20-\x7E]/g, "");
function crc16(str) {
  let crc = 0xffff;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}
function pixPayload({ chave, nome, cidade, valor, txid }) {
  const f = (id, v) => id + String(v.length).padStart(2, "0") + v;
  const conta = f("00", "br.gov.bcb.pix") + f("01", chave);
  let p = f("00", "01") + f("26", conta) + f("52", "0000") + f("53", "986");
  if (valor > 0) p += f("54", valor.toFixed(2));
  p += f("58", "BR") + f("59", semAcento(nome).toUpperCase().slice(0, 25) || "LOJA") + f("60", semAcento(cidade).toUpperCase().slice(0, 15) || "BRASIL");
  p += f("62", f("05", (semAcento(txid).replace(/[^A-Za-z0-9]/g, "").slice(0, 25)) || "***"));
  p += "6304";
  return p + crc16(p);
}
function lojaConfig() {
  const c = db.prepare("SELECT dados FROM config WHERE id = 1").get();
  return (c && JSON.parse(c.dados).loja) || {};
}
async function pixPara(valor, txid) {
  const L = lojaConfig();
  const chave = txt(L.pixChave, 77);
  if (!chave) return null;
  const payload = pixPayload({ chave, nome: L.pixNome || L.nome, cidade: L.pixCidade, valor: n(valor), txid });
  const svg = await QRCode.toString(payload, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  return { payload, svg };
}
app.get("/api/pix", exigeLogin, async (req, res) => {
  const r = await pixPara(Number(req.query.valor) || 0, req.query.txid || "");
  if (!r) return res.status(400).json({ erro: "Cadastre sua chave Pix em Custos e taxas → Sua loja." });
  res.json(r);
});

// ---------- impressão 10×15 do pedido ----------
const escH = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const brlS = v => (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
app.get("/imprimir/pedido/:id", exigeLogin, async (req, res) => {
  const r = db.prepare("SELECT * FROM pedidos WHERE id = ?").get(req.params.id);
  if (!r) return res.status(404).send("Pedido não encontrado.");
  const p = JSON.parse(r.dados), L = lojaConfig();
  const bruto = p.itens.reduce((s, i) => s + i.quantidade * i.preco_unit, 0);
  const total = bruto - (p.desconto || 0) + (p.freteCliente || 0);
  const receber = Math.max(0, total - (p.sinal || 0));
  const pix = receber > 0 && r.status !== "entregue" ? await pixPara(receber, "PED" + r.numero) : null;
  const dataBR = s => s ? s.split("-").reverse().join("/") : "";
  res.set("Content-Type", "text/html; charset=utf-8");
  res.send(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Pedido #${r.numero}</title>
<style>
@page{size:100mm 150mm;margin:0}
*{box-sizing:border-box}
body{margin:0;font-family:Arial,Helvetica,sans-serif;color:#000;background:#fff}
.et{width:100mm;height:150mm;padding:5mm 5mm 4mm;display:flex;flex-direction:column;gap:2.5mm;overflow:hidden}
.top{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:.5mm solid #000;padding-bottom:2mm}
.loja{font-size:15pt;font-weight:800;line-height:1.05}
.num{font-size:20pt;font-weight:800}
.lb{font-size:7.5pt;text-transform:uppercase;letter-spacing:.06em}
.cli{font-size:13pt;font-weight:700}
table{width:100%;border-collapse:collapse;font-size:9.5pt}
td{padding:1mm 0;vertical-align:top;border-bottom:.2mm dashed #000}
td.q{width:9mm;font-weight:700}
td.v{text-align:right;white-space:nowrap}
.pers{font-size:8pt}
.tot{display:flex;justify-content:space-between;font-size:11pt;font-weight:800}
.pix{display:flex;gap:3mm;align-items:center;margin-top:auto}
.pix svg{width:30mm;height:30mm}
.pix .t{font-size:8pt;word-break:break-all}
.ok{margin-top:auto;font-size:10pt;text-align:center;font-weight:700}
.rod{font-size:7.5pt;text-align:center}
@media screen{body{background:#ddd;padding:10px}.et{background:#fff;margin:0 auto;box-shadow:0 0 8px rgba(0,0,0,.2)}.dica{font:13px Arial;text-align:center;margin:10px}}
@media print{.dica{display:none}}
</style></head><body>
<p class="dica">Escolha a impressora térmica e o papel 100 × 150 mm. Se a janela de impressão não abrir, use Ctrl+P.</p>
<div class="et">
  <div class="top"><div><div class="lb">Pedido</div><div class="loja">${escH(L.nome || "Impressões 3D")}</div></div><div class="num">#${r.numero}</div></div>
  <div><div class="lb">Cliente</div><div class="cli">${escH(p.cliente)}</div>${p.whatsapp ? `<div>${escH(p.whatsapp)}</div>` : ""}<div class="lb" style="margin-top:1mm">Pedido em ${dataBR(p.data)}${p.prazo ? ` · entrega até ${dataBR(p.prazo)}` : ""}</div></div>
  <table>${p.itens.map(i => `<tr><td class="q">${i.quantidade}×</td><td>${escH(i.descricao)}${i.personalizacao ? `<div class="pers">${escH(i.personalizacao)}</div>` : ""}</td><td class="v">${brlS(i.quantidade * i.preco_unit)}</td></tr>`).join("")}</table>
  ${p.desconto ? `<div class="tot" style="font-size:9pt;font-weight:400"><span>Desconto</span><span>-${brlS(p.desconto)}</span></div>` : ""}
  ${p.freteCliente ? `<div class="tot" style="font-size:9pt;font-weight:400"><span>Frete</span><span>${brlS(p.freteCliente)}</span></div>` : ""}
  <div class="tot"><span>Total</span><span>${brlS(total)}</span></div>
  ${p.sinal ? `<div class="tot" style="font-size:9.5pt;font-weight:400"><span>Já pago</span><span>${brlS(p.sinal)}</span></div>` : ""}
  ${pix ? `<div class="pix">${pix.svg}<div><div class="lb">Falta pagar</div><div class="num" style="font-size:14pt">${brlS(receber)}</div><div class="t">Pague com o Pix pelo QR Code</div></div></div>`
        : `<div class="ok">${receber > 0 ? `Falta pagar: ${brlS(receber)}` : "Pago. Obrigado pela compra!"}</div>`}
  <div class="rod">${escH(L.instagram ? "Instagram " + L.instagram : "")}${L.whatsapp ? ` · WhatsApp ${escH(L.whatsapp)}` : ""}</div>
</div>
<script src="/imprimir.js"></script>
</body></html>`);
});

// ---------- clientes (a partir dos pedidos e vendas) ----------
function listaClientes() {
  const mapa = new Map();
  const chave = (nome, zap) => { const d = String(zap || "").replace(/\D/g, ""); return d.length >= 8 ? "z" + d.slice(-9) : "n" + semAcento(nome).toLowerCase().trim(); };
  const soma = (nome, zap, valor, data, origem) => {
    if (!String(nome || "").trim()) return;
    const k = chave(nome, zap);
    const c = mapa.get(k) || { nome: nome.trim(), whatsapp: "", total: 0, compras: 0, ultima: "", primeira: "", orcamentos: 0 };
    if (zap && !c.whatsapp) c.whatsapp = zap;
    if (origem === "orcamento") c.orcamentos++;
    else { c.total += valor; c.compras++; if (!c.ultima || data > c.ultima) c.ultima = data; if (!c.primeira || data < c.primeira) c.primeira = data; }
    mapa.set(k, c);
  };
  for (const r of db.prepare("SELECT dados, status FROM pedidos").all()) {
    if (r.status === "cancelado") continue;
    const p = JSON.parse(r.dados);
    const total = p.itens.reduce((s, i) => s + i.quantidade * i.preco_unit, 0) - (p.desconto || 0) + (p.freteCliente || 0);
    soma(p.cliente, p.whatsapp, total, p.data, r.status === "orcamento" ? "orcamento" : "pedido");
  }
  for (const v of db.prepare("SELECT cliente, data, quantidade*preco_unit AS total FROM vendas WHERE pedido_id IS NULL AND cliente IS NOT NULL AND cliente <> ''").all()) {
    soma(v.cliente, "", v.total, v.data, "venda");
  }
  return [...mapa.values()].map(c => ({ ...c, total: n(c.total) })).sort((a, b) => b.total - a.total);
}
app.get("/api/clientes", exigeLogin, (req, res) => res.json(listaClientes()));

// ---------- resumo para a tela Hoje (retorno do investimento) ----------
app.get("/api/resumo", exigeLogin, (req, res) => {
  const lucroTotal = db.prepare("SELECT COALESCE(SUM(quantidade*preco_unit - taxas - frete - quantidade*custo_unit),0) t FROM vendas WHERE status='pago'").get().t;
  const investimento = db.prepare("SELECT COALESCE(SUM(valor_pago),0) t FROM compras WHERE status='comprado'").get().t;
  const planejado = db.prepare("SELECT COUNT(*) n FROM compras WHERE status<>'comprado'").get().n;
  const porMes = db.prepare(`SELECT substr(data,1,7) mes, SUM(quantidade*preco_unit - taxas - frete - quantidade*custo_unit) lucro
    FROM vendas WHERE status='pago' GROUP BY 1 ORDER BY 1 DESC LIMIT 6`).all();
  const primeiraVenda = db.prepare("SELECT MIN(data) d FROM vendas WHERE status='pago'").get().d;
  res.json({ lucroTotal: n(lucroTotal), investimento: n(investimento), comprasPendentes: planejado, porMes, primeiraVenda });
});

// ---------- pedido vindo do catálogo público ----------
const limitePedidoPublico = rateLimit({ windowMs: 10 * 60 * 1000, limit: 6, standardHeaders: "draft-7", legacyHeaders: false,
  message: { erro: "Muitos pedidos seguidos. Tente de novo em alguns minutos." } });
app.post("/api/publico/pedido", limitePedidoPublico, (req, res) => {
  const b = req.body || {};
  const nome = txt(b.nome, 80);
  if (nome.length < 2) return res.status(400).json({ erro: "Informe seu nome." });
  const prods = new Map(produtosPublicos().map(x => [x.id, x.p]));
  const kits = new Map(kitsPublicos(prods).map(k => [k.id, k]));
  const itens = (Array.isArray(b.itens) ? b.itens : []).slice(0, 30).map(i => {
    const q = Math.round(Number(i.q) || 0);
    if (q < 1 || q > 999) return null;
    if (i.kit) {
      const k = kits.get(String(i.kit)); if (!k) return null;
      return { produto_id: null, kit_id: k.id, descricao: "Kit " + k.nome, quantidade: q, preco_unit: k.preco, custo_unit: 0, horas_unit: 0,
        personalizacao: txt([k.itens.map(x => `${x.q}× ${x.nome}`).join(", "), i.pers].filter(Boolean).join(" · "), 300), doEstoque: false, fil: [],
        componentes: k.itens.map(x => ({ produto_id: x.produto_id, q: x.q })), recalc: true };
    }
    const p = prods.get(String(i.id || ""));
    if (!p) return null;
    return { produto_id: String(i.id), descricao: p.nome, quantidade: q, preco_unit: n(p.precoCatalogo), custo_unit: 0, horas_unit: 0,
      personalizacao: txt(i.pers, 200), doEstoque: false, fil: [], recalc: true };
  }).filter(Boolean);
  if (!itens.length) return res.status(400).json({ erro: "O carrinho está vazio." });
  const L = lojaConfig();
  const cfg = configCompleta();
  const canal = cfg.canais?.[0]?.nome || "Venda direta";
  const hoje = new Date().toISOString().slice(0, 10);
  const prazoD = new Date(); prazoD.setDate(prazoD.getDate() + (Number(L.prazoDias) || 5));
  const bruto = itens.reduce((s, i) => s + i.quantidade * i.preco_unit, 0);
  const cup = b.cupom ? cupomValido(b.cupom, bruto) : null;
  const dados = { cliente: nome, whatsapp: txt(b.whatsapp, 30).replace(/[^\d+]/g, ""), canal, data: hoje, prazo: prazoD.toISOString().slice(0, 10),
    itens, desconto: cup && !cup.erro ? cup.desconto : 0, freteCliente: 0, freteVoce: 0, taxas: 0, sinal: 0,
    obs: "Pedido feito pelo catálogo do site" + (cup && !cup.erro ? ` · cupom ${cup.codigo}` : ""), origem: "catalogo",
    ...(cup && !cup.erro ? { cupom: cup.codigo } : {}) };
  const id = crypto.randomUUID();
  const numero = (db.prepare("SELECT COALESCE(MAX(numero),0) m FROM pedidos").get().m) + 1;
  db.prepare("INSERT INTO pedidos (id, numero, dados, status, prazo) VALUES (?, ?, ?, 'orcamento', ?)").run(id, numero, JSON.stringify(dados), dados.prazo);
  res.json({ numero });
});

// ---------- kits e cupons ----------
function configCompleta() { const c = db.prepare("SELECT dados FROM config WHERE id = 1").get(); return c ? JSON.parse(c.dados) : {}; }
function kitsPublicos(prods) {
  prods = prods || new Map(produtosPublicos().map(x => [x.id, x.p]));
  const fotos = new Map(produtosPublicos().map(x => [x.id, x.foto]));
  return (configCompleta().kits || []).filter(k => k && k.ativo && n(k.preco) > 0 && Array.isArray(k.itens) && k.itens.length)
    .map(k => {
      const itens = k.itens.map(i => ({ produto_id: String(i.produto_id || ""), q: Math.max(1, Math.round(Number(i.q) || 1)) }))
        .map(i => ({ ...i, p: prods.get(i.produto_id) }));
      if (itens.some(i => !i.p)) return null;
      const fotoId = itens.map(i => fotos.get(i.produto_id)).find(Boolean);
      return { id: txt(k.id, 60), nome: txt(k.nome, 100), descricao: txt(k.descricao, 300), preco: n(k.preco),
        avulso: n(itens.reduce((s, i) => s + i.q * n(i.p.precoCatalogo), 0)), foto: fotoId ? "/fotos-publicas/" + fotoId : null,
        itens: itens.map(i => ({ produto_id: i.produto_id, nome: i.p.nome, q: i.q })) };
    }).filter(Boolean);
}
function cupomValido(codigo, total) {
  const cod = txt(codigo, 30).toUpperCase().replace(/\s+/g, "");
  const c = (configCompleta().cupons || []).find(x => x && x.ativo && String(x.codigo || "").toUpperCase() === cod);
  if (!c) return { erro: "Cupom não encontrado ou encerrado." };
  const hoje = new Date().toISOString().slice(0, 10);
  if (c.validade && DATA_RE.test(c.validade) && c.validade < hoje) return { erro: "Este cupom já venceu." };
  if (n(c.minimo) > 0 && total != null && total < n(c.minimo)) return { erro: `Este cupom vale para pedidos a partir de ${brlS(c.minimo)}.` };
  const desconto = total == null ? null : n(Math.min(total, c.tipo === "valor" ? n(c.valor) : total * n(c.valor) / 100));
  return { codigo: cod, tipo: c.tipo === "valor" ? "valor" : "pct", valor: n(c.valor), minimo: n(c.minimo), desconto };
}
const limiteCupom = rateLimit({ windowMs: 10 * 60 * 1000, limit: 30, standardHeaders: "draft-7", legacyHeaders: false,
  message: { erro: "Muitas tentativas. Tente de novo em alguns minutos." } });
app.get("/api/publico/cupom", limiteCupom, (req, res) => {
  const r = cupomValido(req.query.codigo, null);
  if (r.erro) return res.status(404).json(r);
  res.json({ codigo: r.codigo, tipo: r.tipo, valor: r.valor, minimo: r.minimo });
});

// ---------- fechamento do mês (para salvar em PDF) ----------
const MESES_PT = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
function resumoMes(mes) {
  const [de, ate] = intervaloMes(mes);
  const vs = db.prepare("SELECT * FROM vendas WHERE data BETWEEN ? AND ?").all(de, ate);
  const ls = db.prepare("SELECT * FROM lancamentos WHERE data BETWEEN ? AND ?").all(de, ate);
  const r = { bruto: 0, taxas: 0, frete: 0, custo: 0, lucro: 0, pecas: 0, nVendas: 0, receberVendas: 0, entradas: 0, saidas: 0, pagar: 0, receberLanc: 0, canais: {}, produtos: {}, categorias: {} };
  for (const v of vs) {
    const bruto = v.quantidade * v.preco_unit, liq = bruto - v.taxas - v.frete, custo = v.quantidade * v.custo_unit;
    if (v.status !== "pago") { r.receberVendas += liq - (v.adiantado || 0); continue; }
    r.adiantado = (r.adiantado || 0) + (v.adiantado || 0);
    r.bruto += bruto; r.taxas += v.taxas; r.frete += v.frete; r.custo += custo; r.lucro += liq - custo; r.pecas += v.quantidade; r.nVendas++;
    const c = r.canais[v.canal || "Sem canal"] ||= { bruto: 0, lucro: 0, n: 0 }; c.bruto += bruto; c.lucro += liq - custo; c.n++;
    const pr = r.produtos[v.descricao] ||= { q: 0, bruto: 0, lucro: 0 }; pr.q += v.quantidade; pr.bruto += bruto; pr.lucro += liq - custo;
  }
  for (const l of ls) {
    if (l.status !== "pago") { if (l.tipo === "entrada") r.receberLanc += l.valor; else r.pagar += l.valor; continue; }
    if (l.tipo === "entrada") r.entradas += l.valor;
    else { r.saidas += l.valor; r.categorias[l.categoria] = (r.categorias[l.categoria] || 0) + l.valor; }
  }
  r.liquido = r.bruto - r.taxas - r.frete;
  r.saldo = r.liquido - (r.adiantado || 0) + r.entradas - r.saidas; // sinal já entrou como receita
  r.pedidosNovos = db.prepare("SELECT dados, status FROM pedidos").all().map(x => ({ ...JSON.parse(x.dados), status: x.status }))
    .filter(p => p.data >= de && p.data <= ate && p.status !== "cancelado").length;
  r.clientesNovos = listaClientes().filter(c => c.primeira >= de && c.primeira <= ate);
  return r;
}
app.get("/imprimir/mes/:mes", exigeLogin, (req, res) => {
  const mes = MES_RE.test(req.params.mes) ? req.params.mes : new Date().toISOString().slice(0, 7);
  const [a, m] = mes.split("-").map(Number);
  const ant = new Date(Date.UTC(a, m - 2, 1)).toISOString().slice(0, 7);
  const r = resumoMes(mes), p = resumoMes(ant), L = lojaConfig();
  const nomeMes = k => { const [y, mm] = k.split("-").map(Number); return `${MESES_PT[mm - 1]} de ${y}`; };
  const varia = (x, y) => y ? `<span class="${x >= y ? "pos" : "neg"}">${x >= y ? "▲" : "▼"} ${Math.abs((x - y) / Math.abs(y) * 100).toFixed(0)}%</span>` : "";
  const linha = (rot, v, cls) => `<tr><td>${rot}</td><td class="v ${cls || ""}">${brlS(v)}</td></tr>`;
  const top = Object.entries(r.produtos).sort((x, y) => y[1].q - x[1].q).slice(0, 8);
  const cats = Object.entries(r.categorias).sort((x, y) => y[1] - x[1]);
  const canais = Object.entries(r.canais).sort((x, y) => y[1].bruto - x[1].bruto);
  const margem = r.bruto > 0 ? (r.lucro / r.bruto * 100).toFixed(1).replace(".", ",") + "%" : "—";
  res.set("Content-Type", "text/html; charset=utf-8");
  res.send(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Fechamento ${nomeMes(mes)} · ${escH(L.nome || "")}</title>
<style>
@page{size:A4;margin:14mm}
*{box-sizing:border-box}
body{margin:0;font-family:Arial,Helvetica,sans-serif;color:#111;background:#fff;font-size:10.5pt}
.pg{max-width:182mm;margin:0 auto}
h1{font-size:20pt;margin:0}
h2{font-size:11pt;text-transform:uppercase;letter-spacing:.06em;margin:16px 0 6px;border-bottom:1.5px solid #15803d;padding-bottom:3px;color:#15803d}
.sub{color:#555;margin:2px 0 12px}
.kp{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.k{border:1px solid #ccc;border-radius:6px;padding:8px 10px}
.k b{display:block;font-size:15pt;margin-top:2px}
.k span{font-size:8pt;color:#555;text-transform:uppercase;letter-spacing:.05em}
.k small{display:block;color:#555;font-size:8.5pt;margin-top:2px}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:18px}
table{width:100%;border-collapse:collapse}
td,th{padding:4px 2px;border-bottom:1px solid #e3e3e3;text-align:left;vertical-align:top}
th{font-size:8.5pt;color:#555;text-transform:uppercase;letter-spacing:.04em}
.v,th.v{text-align:right;white-space:nowrap}
tr.t td{font-weight:700;border-top:1.5px solid #111;border-bottom:0}
.pos{color:#15803d}.neg{color:#b42318}
.muted{color:#666}
.ft{margin-top:18px;font-size:8.5pt;color:#666}
.dica{margin:0 0 10px;padding:8px 10px;background:#f2f2f2;border-radius:6px;font-size:9.5pt}
@media print{.dica{display:none}}
</style></head><body><div class="pg">
<p class="dica">Na janela de impressão, escolha <b>Salvar como PDF</b>. Se ela não abrir, use Ctrl+P.</p>
<h1>Fechamento de ${nomeMes(mes)}</h1>
<p class="sub">${escH(L.nome || "Minha loja")} · gerado em ${new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}</p>
<div class="kp">
  <div class="k"><span>Vendido</span><b>${brlS(r.bruto)}</b><small>${varia(r.bruto, p.bruto)} vs ${MESES_PT[Number(ant.slice(5)) - 1]}</small></div>
  <div class="k"><span>Lucro das vendas</span><b class="${r.lucro < 0 ? "neg" : ""}">${brlS(r.lucro)}</b><small>margem ${margem} ${varia(r.lucro, p.lucro)}</small></div>
  <div class="k"><span>Saldo do mês</span><b class="${r.saldo < 0 ? "neg" : ""}">${brlS(r.saldo)}</b><small>entrou − saiu</small></div>
  <div class="k"><span>Peças vendidas</span><b>${r.pecas.toLocaleString("pt-BR")}</b><small>${r.nVendas} vendas · ${r.pedidosNovos} pedidos novos</small></div>
</div>
<div class="cols">
<div><h2>Resultado das vendas</h2><table>
${linha("Vendido (bruto)", r.bruto)}${linha("Taxas dos canais", -r.taxas)}${linha("Frete pago por você", -r.frete)}
<tr class="t"><td>Recebido das vendas</td><td class="v">${brlS(r.liquido)}</td></tr>
${linha("Custo de produção das peças", -r.custo)}
<tr class="t"><td>Lucro das vendas</td><td class="v ${r.lucro < 0 ? "neg" : "pos"}">${brlS(r.lucro)}</td></tr></table>
<h2>Caixa do mês</h2><table>
${r.adiantado ? linha("Recebido das vendas (sem os sinais)", r.liquido - r.adiantado) : linha("Recebido das vendas", r.liquido)}${linha("Outras entradas (inclui sinais de pedidos)", r.entradas)}${linha("Despesas pagas", -r.saidas)}
<tr class="t"><td>Saldo do mês</td><td class="v ${r.saldo < 0 ? "neg" : "pos"}">${brlS(r.saldo)}</td></tr>
${r.receberVendas + r.receberLanc > 0 ? linha('<span class="muted">Ainda a receber</span>', r.receberVendas + r.receberLanc, "muted") : ""}
${r.pagar > 0 ? linha('<span class="muted">Ainda a pagar</span>', r.pagar, "muted") : ""}</table></div>
<div><h2>Despesas por categoria</h2>${cats.length ? `<table>${cats.map(([c, v]) => linha(escH(c), v)).join("")}<tr class="t"><td>Total</td><td class="v">${brlS(r.saidas)}</td></tr></table>` : `<p class="muted">Nenhuma despesa paga no mês.</p>`}
<h2>Vendas por canal</h2>${canais.length ? `<table><tr><th>Canal</th><th class="v">Vendas</th><th class="v">Vendido</th><th class="v">Lucro</th></tr>${canais.map(([c, v]) => `<tr><td>${escH(c)}</td><td class="v">${v.n}</td><td class="v">${brlS(v.bruto)}</td><td class="v">${brlS(v.lucro)}</td></tr>`).join("")}</table>` : `<p class="muted">Nenhuma venda no mês.</p>`}</div>
</div>
<h2>Produtos mais vendidos</h2>${top.length ? `<table><tr><th>Produto</th><th class="v">Peças</th><th class="v">Vendido</th><th class="v">Lucro</th></tr>${top.map(([nm, v]) => `<tr><td>${escH(nm)}</td><td class="v">${v.q.toLocaleString("pt-BR")}</td><td class="v">${brlS(v.bruto)}</td><td class="v">${brlS(v.lucro)}</td></tr>`).join("")}</table>` : `<p class="muted">Nenhuma venda no mês.</p>`}
<h2>Clientes novos (${r.clientesNovos.length})</h2>${r.clientesNovos.length ? `<table><tr><th>Cliente</th><th>WhatsApp</th><th class="v">Comprou</th></tr>${r.clientesNovos.slice(0, 20).map(c => `<tr><td>${escH(c.nome)}</td><td>${escH(c.whatsapp || "—")}</td><td class="v">${brlS(c.total)}</td></tr>`).join("")}</table>` : `<p class="muted">Nenhum cliente novo no mês.</p>`}
<p class="ft">Lucro das vendas = vendido − taxas − frete − custo de produção (filamento, energia, desgaste, falhas, mão de obra e embalagem). Compras de filamento lançadas como despesa entram no caixa, não no lucro, para não contar duas vezes.</p>
</div><script src="/imprimir.js"></script></body></html>`);
});

// ---------- cobranças pendentes ----------
// contas a pagar: todas as vencidas e as que vencem nos próximos 40 dias
app.get("/api/a-pagar", exigeLogin, (req, res) => {
  const limite = new Date(Date.now() + 40 * 86400000).toISOString().slice(0, 10);
  res.json(db.prepare("SELECT id, data, tipo, descricao, categoria, valor, status, obs FROM lancamentos WHERE tipo = 'saida' AND status = 'pendente' AND data <= ? ORDER BY data, criado_em LIMIT 60").all(limite));
});
app.get("/api/cobrancas", exigeLogin, (req, res) => {
  const vs = db.prepare(`SELECT v.id, v.data, v.descricao, v.cliente, v.quantidade*v.preco_unit - v.taxas - v.frete AS valor, v.quantidade*v.preco_unit - v.adiantado AS bruto, p.dados AS pdados, p.numero
    FROM vendas v LEFT JOIN pedidos p ON p.id = v.pedido_id WHERE v.status = 'pendente' ORDER BY v.data`).all();
  res.json(vs.map(v => { const pd = v.pdados ? JSON.parse(v.pdados) : null;
    return { id: v.id, data: v.data, descricao: v.descricao, cliente: v.cliente || "", valor: n(v.bruto), numero: v.numero || null, whatsapp: pd ? pd.whatsapp || "" : "" }; }));
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
    kits: kitsPublicos().map(({ itens, ...k }) => ({ ...k, itens: itens.map(i => ({ nome: i.nome, q: i.q })) })),
    temCupom: (configCompleta().cupons || []).some(c => c && c.ativo),
  });
});
app.get("/fotos-publicas/:nome", limitePublico, (req, res) => {
  const nome = req.params.nome;
  if (!FOTO_RE.test(nome) || !produtosPublicos().some(x => x.foto === nome)) return res.status(404).end();
  res.set("Cache-Control", "public, max-age=3600");
  res.sendFile(path.join(FOTOS_DIR, nome), err => { if (err && !res.headersSent) res.status(404).end(); });
});
// ---------- link do pedido para o cliente ----------
const TOKEN_RE = /^[a-f0-9]{32}$/;
const origemUrl = req => (req.secure ? "https" : "http") + "://" + req.get("host");
const htmlCache = {};
function paginaComMeta(arquivo, meta) {
  const html = htmlCache[arquivo] ||= fs.readFileSync(path.join(__dirname, "public", arquivo), "utf8");
  const tags = [
    `<meta property="og:type" content="website">`,
    `<meta property="og:title" content="${escH(meta.titulo)}">`,
    meta.descricao ? `<meta property="og:description" content="${escH(meta.descricao)}">` : "",
    meta.imagem ? `<meta property="og:image" content="${escH(meta.imagem)}">` : "",
  ].join("\n");
  return html.replace("</head>", tags + "\n</head>");
}
app.post("/api/pedidos/:id/link", exigeLogin, exigeEdicao, (req, res) => {
  const r = db.prepare("SELECT id, token FROM pedidos WHERE id = ?").get(req.params.id);
  if (!r) return res.status(404).json({ erro: "Pedido não encontrado." });
  let token = r.token;
  if (!token) { token = crypto.randomBytes(16).toString("hex"); db.prepare("UPDATE pedidos SET token = ? WHERE id = ?").run(token, r.id); }
  res.json({ token, url: origemUrl(req) + "/pedido/" + token });
});
function pedidoPorToken(token) {
  if (!TOKEN_RE.test(token || "")) return null;
  const r = db.prepare("SELECT * FROM pedidos WHERE token = ?").get(token);
  if (!r) return null;
  if (r.status === "cancelado" && JSON.parse(r.dados).resposta?.acao !== "recusado") return null;
  return r;
}
function fotoDoItem(i) {
  if (!i.produto_id) return null;
  const pr = db.prepare("SELECT foto FROM produtos WHERE id = ?").get(i.produto_id);
  return pr && pr.foto && FOTO_RE.test(pr.foto) ? pr.foto : null;
}
// Entrada pedida ao aprovar: valor do pedido ou o % padrão da loja (Sua loja → Entrada).
function entradaDe(p, total, L) {
  if (p.entrada != null && Number.isFinite(Number(p.entrada))) return n(Math.min(Number(p.entrada), total));
  const pct = L.entradaPct === "" || L.entradaPct == null ? 50 : Math.max(0, Math.min(100, Number(L.entradaPct) || 0));
  return n(total * pct / 100);
}
const limiteResposta = rateLimit({ windowMs: 10 * 60 * 1000, limit: 10, standardHeaders: "draft-7", legacyHeaders: false,
  message: { erro: "Muitas tentativas. Espere alguns minutos ou fale com a loja pelo WhatsApp." } });
// O cliente aprova ou recusa o orçamento pelo link do pedido.
app.post("/api/publico/pedido/:token/resposta", limiteResposta, (req, res) => {
  const r = pedidoPorToken(req.params.token); if (!r) return res.status(404).json({ erro: "Pedido não encontrado." });
  if (r.status !== "orcamento") return res.status(409).json({ erro: "Este orçamento já foi respondido. Fale com a loja pelo WhatsApp." });
  const acao = req.body?.acao;
  if (!["aprovar", "recusar"].includes(acao)) return res.status(400).json({ erro: "Resposta inválida." });
  const p = JSON.parse(r.dados);
  p.resposta = { acao: acao === "aprovar" ? "aprovado" : "recusado", em: new Date().toISOString(), visto: false, ...(acao === "recusar" && txt(req.body.motivo, 300) ? { motivo: txt(req.body.motivo, 300) } : {}) };
  db.prepare("UPDATE pedidos SET dados = ?, status = ?, atualizado_em = datetime('now') WHERE id = ?")
    .run(JSON.stringify(p), acao === "aprovar" ? "aprovado" : "cancelado", r.id);
  res.json({ ok: true });
});
app.post("/api/pedidos/:id/resposta-vista", exigeLogin, (req, res) => {
  const r = db.prepare("SELECT dados FROM pedidos WHERE id = ?").get(req.params.id);
  if (!r) return res.status(404).json({ erro: "Pedido não encontrado." });
  const p = JSON.parse(r.dados); if (p.resposta) p.resposta.visto = true;
  db.prepare("UPDATE pedidos SET dados = ? WHERE id = ?").run(JSON.stringify(p), req.params.id);
  res.json(linhaPedido(db.prepare("SELECT * FROM pedidos WHERE id = ?").get(req.params.id)));
});
app.get("/api/publico/pedido/:token", limitePublico, async (req, res) => {
  const r = pedidoPorToken(req.params.token); if (!r) return res.status(404).json({ erro: "Pedido não encontrado." });
  const p = JSON.parse(r.dados), L = lojaConfig();
  const bruto = p.itens.reduce((s, i) => s + i.quantidade * i.preco_unit, 0);
  const total = bruto - (p.desconto || 0) + (p.freteCliente || 0);
  const receber = n(Math.max(0, total - (p.sinal || 0)));
  const entrada = entradaDe(p, total, L), faltaEntrada = n(Math.max(0, entrada - (p.sinal || 0)));
  // Pix: nada antes de aprovar; depois, primeiro a entrada e, paga a entrada, o restante.
  const pixTipo = ["orcamento", "cancelado", "entregue"].includes(r.status) || receber <= 0 ? null
    : faltaEntrada > 0.004 && ["aprovado", "imprimindo"].includes(r.status) ? "entrada" : "restante";
  const pixValor = pixTipo === "entrada" ? faltaEntrada : receber;
  const pix = pixTipo ? await pixPara(pixValor, (pixTipo === "entrada" ? "ENT" : "PED") + r.numero) : null;
  res.set("Cache-Control", "no-store");
  res.json({
    loja: { nome: txt(L.nome, 80) || "Impressões 3D", whatsapp: txt(L.whatsapp, 30).replace(/\D/g, ""), instagram: txt(L.instagram, 60), pagamento: txt(L.pagamento, 200) },
    numero: r.numero, status: r.status, prazo: r.prazo, data: p.data, cliente: String(p.cliente || "").split(" ")[0],
    itens: p.itens.map((i, k) => ({ descricao: i.descricao, quantidade: i.quantidade, preco: i.preco_unit, personalizacao: i.personalizacao || "",
      foto: fotoDoItem(i) ? `/pedido/${r.token}/foto/${k}` : null })),
    desconto: n(p.desconto), frete: n(p.freteCliente), total, sinal: n(p.sinal), receber,
    entrada, faltaEntrada, resposta: p.resposta ? { acao: p.resposta.acao, em: p.resposta.em } : null,
    pix: pix ? { payload: pix.payload, svg: pix.svg, tipo: pixTipo, valor: pixValor, chave: txt(L.pixChave, 77), nome: txt(L.pixNome || L.nome, 60) } : null,
  });
});
app.get("/pedido/:token/foto/:i", limitePublico, (req, res) => {
  const r = pedidoPorToken(req.params.token); if (!r) return res.status(404).end();
  const item = JSON.parse(r.dados).itens[Number(req.params.i)];
  const foto = item && fotoDoItem(item); if (!foto) return res.status(404).end();
  res.set("Cache-Control", "private, max-age=3600");
  res.sendFile(path.join(FOTOS_DIR, foto), err => { if (err && !res.headersSent) res.status(404).end(); });
});
app.get("/pedido/:token", limitePublico, (req, res) => {
  const r = pedidoPorToken(req.params.token);
  if (!r) return res.status(404).send("Pedido não encontrado. Peça um novo link para a loja.");
  const p = JSON.parse(r.dados), L = lojaConfig();
  const total = p.itens.reduce((s, i) => s + i.quantidade * i.preco_unit, 0) - (p.desconto || 0) + (p.freteCliente || 0);
  const k = p.itens.findIndex(i => fotoDoItem(i));
  res.set("Cache-Control", "no-store");
  res.type("html").send(paginaComMeta("pedido.html", {
    titulo: `Pedido #${r.numero} · ${txt(L.nome, 80) || "Impressões 3D"}`,
    descricao: p.itens.map(i => `${i.quantidade}× ${i.descricao}`).join(", ").slice(0, 180) + ` · Total ${brlS(total)}`,
    imagem: k >= 0 ? `${origemUrl(req)}/pedido/${r.token}/foto/${k}` : null,
  }));
});

app.get("/catalogo", (req, res) => {
  const id = String(req.query.p || "");
  const x = id ? produtosPublicos().find(y => y.id === id) : null;
  const L = lojaConfig(), loja = txt(L.nome, 80) || "Impressões 3D";
  res.type("html").send(paginaComMeta("catalogo.html", x
    ? { titulo: `${x.p.nome} · ${brlS(x.p.precoCatalogo)}`, descricao: txt(x.p.descricaoCatalogo, 180) || `Peça impressa em 3D da ${loja}`, imagem: x.foto ? `${origemUrl(req)}/fotos-publicas/${x.foto}` : null }
    : { titulo: `${loja} · Catálogo`, descricao: txt(L.sobre, 180) || "Peças impressas em 3D sob encomenda e à pronta entrega." }));
});

// ---------- páginas ----------
// sem cache longo: depois de um deploy o navegador sempre pega a versão nova (usa ETag para não baixar à toa)
app.use(express.static(path.join(__dirname, "public"), { index: "index.html", setHeaders: res => res.setHeader("Cache-Control", "no-cache") }));
app.use("/api", (req, res) => res.status(404).json({ erro: "Rota não encontrada." }));
app.use((err, req, res, next) => {
  console.error(err);
  if (req.path.startsWith("/api")) return res.status(500).json({ erro: "Erro no servidor." });
  res.status(500).send("Erro no servidor.");
});

app.listen(PORT, HOST, () => console.log(`Precificador 3D rodando em http://${HOST}:${PORT}`));

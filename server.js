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

// ---------- páginas ----------
app.use(express.static(path.join(__dirname, "public"), { index: "index.html", maxAge: "1h" }));
app.use("/api", (req, res) => res.status(404).json({ erro: "Rota não encontrada." }));
app.use((err, req, res, next) => {
  console.error(err);
  if (req.path.startsWith("/api")) return res.status(500).json({ erro: "Erro no servidor." });
  res.status(500).send("Erro no servidor.");
});

app.listen(PORT, HOST, () => console.log(`Precificador 3D rodando em http://${HOST}:${PORT}`));

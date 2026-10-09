// Banco de dados SQLite: usuários, sessões, configuração e produtos.
const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, "fotos"), { recursive: true });

const db = new Database(path.join(DATA_DIR, "precificador.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario TEXT NOT NULL UNIQUE COLLATE NOCASE,
  nome TEXT NOT NULL,
  senha_hash TEXT NOT NULL,
  papel TEXT NOT NULL CHECK (papel IN ('admin','editor','leitura')),
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  ultimo_login TEXT
);
CREATE TABLE IF NOT EXISTS sessoes (
  sid TEXT PRIMARY KEY,
  sess TEXT NOT NULL,
  expira INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessoes_expira ON sessoes(expira);
CREATE TABLE IF NOT EXISTS config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  dados TEXT NOT NULL,
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS produtos (
  id TEXT PRIMARY KEY,
  dados TEXT NOT NULL,
  foto TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS vendas (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,              -- AAAA-MM-DD
  produto_id TEXT,
  descricao TEXT NOT NULL,
  quantidade REAL NOT NULL DEFAULT 1,
  preco_unit REAL NOT NULL DEFAULT 0,
  canal TEXT,
  taxas REAL NOT NULL DEFAULT 0,
  frete REAL NOT NULL DEFAULT 0,
  custo_unit REAL NOT NULL DEFAULT 0,
  cliente TEXT,
  status TEXT NOT NULL DEFAULT 'pago' CHECK (status IN ('pago','pendente')),
  obs TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  criado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS vendas_data ON vendas(data);
CREATE TABLE IF NOT EXISTS lancamentos (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('entrada','saida')),
  descricao TEXT NOT NULL,
  categoria TEXT NOT NULL,
  valor REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pago' CHECK (status IN ('pago','pendente')),
  obs TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  criado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS lancamentos_data ON lancamentos(data);
CREATE TABLE IF NOT EXISTS pedidos (
  id TEXT PRIMARY KEY,
  numero INTEGER NOT NULL,
  dados TEXT NOT NULL,             -- JSON: cliente, itens, valores
  status TEXT NOT NULL DEFAULT 'orcamento',
  prazo TEXT,
  filamento_baixado INTEGER NOT NULL DEFAULT 0,
  estoque_baixado INTEGER NOT NULL DEFAULT 0,
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now')),
  criado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS pedidos_status ON pedidos(status);
CREATE TABLE IF NOT EXISTS rolos (
  id TEXT PRIMARY KEY,
  filamento_id TEXT NOT NULL,
  cor TEXT NOT NULL,
  peso REAL NOT NULL DEFAULT 1000,
  restante REAL NOT NULL DEFAULT 1000,
  preco REAL NOT NULL DEFAULT 0,
  data_compra TEXT,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// colunas adicionadas em versões novas
const colunasVendas = db.prepare("PRAGMA table_info(vendas)").all().map(c => c.name);
if (!colunasVendas.includes("pedido_id")) db.exec("ALTER TABLE vendas ADD COLUMN pedido_id TEXT");

module.exports = { db, DATA_DIR };

// Cria um usuário ou troca a senha pelo terminal da VPS.
// Uso: npm run criar-admin -- usuario "Nome Completo"
//      npm run criar-usuario -- usuario "Nome" editor|leitura
// A senha é pedida no terminal (não fica no histórico).
const readline = require("readline");
const bcrypt = require("bcryptjs");
const { db } = require("../db");

const args = process.argv.slice(2).filter(a => a !== "--admin");
const admin = process.argv.includes("--admin");
const [usuario, nome = usuario, papelArg] = args;
const papel = admin ? "admin" : (papelArg || "editor");

if (!usuario || !/^[a-zA-Z0-9._-]{3,40}$/.test(usuario) || !["admin", "editor", "leitura"].includes(papel)) {
  console.log('Uso: npm run criar-admin -- usuario "Nome"\n     npm run criar-usuario -- usuario "Nome" editor|leitura');
  process.exit(1);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
rl._writeToOutput = function (s) { if (s.includes("Senha")) rl.output.write(s); else rl.output.write("*"); };
rl.question("Senha (mínimo 8 caracteres): ", senha => {
  rl.output.write("\n");
  rl.close();
  if (!senha || senha.length < 8) { console.log("Senha curta demais."); process.exit(1); }
  const hash = bcrypt.hashSync(senha, 12);
  const existe = db.prepare("SELECT id FROM usuarios WHERE usuario = ?").get(usuario);
  if (existe) {
    db.prepare("UPDATE usuarios SET senha_hash = ?, papel = ?, nome = ? WHERE id = ?").run(hash, papel, nome, existe.id);
    console.log(`Usuário "${usuario}" atualizado (${papel}).`);
  } else {
    db.prepare("INSERT INTO usuarios (usuario, nome, senha_hash, papel) VALUES (?, ?, ?, ?)").run(usuario, nome, hash, papel);
    console.log(`Usuário "${usuario}" criado (${papel}).`);
  }
});

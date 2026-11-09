// Notificações push (Web Push) sem biblioteca externa: chave VAPID (ES256) e criptografia aes128gcm (RFC 8291),
// tudo com o crypto do Node. As chaves são criadas na primeira vez e ficam em DATA_DIR/vapid.json.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const b64u = buf => Buffer.from(buf).toString("base64url");
const deB64u = s => Buffer.from(String(s || ""), "base64url");
const hmac = (chave, dado) => crypto.createHmac("sha256", chave).update(dado).digest();

let vapid = null;
function chaves(dataDir) {
  if (vapid) return vapid;
  const arq = path.join(dataDir, "vapid.json");
  let j = null;
  try { j = JSON.parse(fs.readFileSync(arq, "utf8")); } catch (e) { /* cria abaixo */ }
  if (!j || !j.publica || !j.privada) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const jwk = publicKey.export({ format: "jwk" });
    j = { publica: b64u(Buffer.concat([Buffer.from([4]), deB64u(jwk.x), deB64u(jwk.y)])), privada: privateKey.export({ format: "pem", type: "pkcs8" }) };
    fs.writeFileSync(arq, JSON.stringify(j), { mode: 0o600 });
  }
  vapid = { publica: j.publica, privada: crypto.createPrivateKey(j.privada) };
  return vapid;
}

function jwt(aud, sub, v) {
  const cab = b64u(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const corpo = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub }));
  const ass = crypto.sign("sha256", Buffer.from(cab + "." + corpo), { key: v.privada, dsaEncoding: "ieee-p1363" });
  return cab + "." + corpo + "." + b64u(ass);
}

// criptografa a mensagem para a inscrição do aparelho (um registro só, aes128gcm)
function cifra(sub, texto) {
  const uaPub = deB64u(sub.keys.p256dh), auth = deB64u(sub.keys.auth);
  const ecdh = crypto.createECDH("prime256v1"); ecdh.generateKeys();
  const asPub = ecdh.getPublicKey(), segredo = ecdh.computeSecret(uaPub);
  const ikm = hmac(hmac(auth, segredo), Buffer.concat([Buffer.from("WebPush: info\0"), uaPub, asPub, Buffer.from([1])]));
  const sal = crypto.randomBytes(16), prk = hmac(sal, ikm);
  const cek = hmac(prk, Buffer.concat([Buffer.from("Content-Encoding: aes128gcm\0"), Buffer.from([1])])).subarray(0, 16);
  const nonce = hmac(prk, Buffer.concat([Buffer.from("Content-Encoding: nonce\0"), Buffer.from([1])])).subarray(0, 12);
  const c = crypto.createCipheriv("aes-128-gcm", cek, nonce);
  const cifrado = Buffer.concat([c.update(Buffer.concat([Buffer.from(texto), Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([sal, rs, Buffer.from([asPub.length]), asPub, cifrado]);
}

// envia; devolve o status HTTP (404/410 = inscrição morta, pode apagar)
async function envia(dataDir, sub, dados, contato) {
  const v = chaves(dataDir), url = new URL(sub.endpoint);
  const r = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: "86400", Urgency: "high",
      Authorization: `vapid t=${jwt(url.origin, contato, v)}, k=${v.publica}`,
    },
    body: cifra(sub, JSON.stringify(dados)),
    signal: AbortSignal.timeout(10000),
  });
  return r.status;
}

// aceita só inscrições bem formadas, com endereço https
function inscricaoValida(s) {
  try {
    if (!s || typeof s.endpoint !== "string" || s.endpoint.length > 1000 || !s.keys) return false;
    if (new URL(s.endpoint).protocol !== "https:") return false;
    return deB64u(s.keys.p256dh).length === 65 && deB64u(s.keys.auth).length === 16;
  } catch (e) { return false; }
}

module.exports = { chaves, envia, inscricaoValida, _cifra: cifra, _jwt: jwt };

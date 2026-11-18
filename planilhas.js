// Preenche modelos de "anunciar em massa" da Shopee e do Mercado Livre direto no XML do .xlsx,
// sem regravar o resto do arquivo (abas escondidas, listas e fórmulas que o marketplace confere continuam iguais).
const zlib = require("zlib");

// ---------- zip mínimo (leitura e escrita) ----------
const CRC = (() => { const t = new Int32Array(256); for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[i] = c; } return t; })();
function crc32(buf) { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function zipLer(buf) {
  let e = buf.length - 22; while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error("Arquivo não é uma planilha .xlsx.");
  const total = buf.readUInt16LE(e + 10); let p = buf.readUInt32LE(e + 16); const out = [];
  for (let i = 0; i < total; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("Planilha corrompida.");
    const metodo = buf.readUInt16LE(p + 10), tam = buf.readUInt32LE(p + 20), nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), lo = buf.readUInt32LE(p + 42);
    const nome = buf.toString("utf8", p + 46, p + 46 + nl);
    const ini = lo + 30 + buf.readUInt16LE(lo + 26) + buf.readUInt16LE(lo + 28), raw = buf.subarray(ini, ini + tam);
    out.push({ nome, dados: metodo === 8 ? zlib.inflateRawSync(raw) : Buffer.from(raw) });
    p += 46 + nl + el + cl;
  }
  return out;
}
function zipGravar(arqs) {
  const partes = [], central = []; let off = 0;
  for (const a of arqs) {
    const nome = Buffer.from(a.nome, "utf8"), comp = zlib.deflateRawSync(a.dados), crc = crc32(a.dados);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8); lh.writeUInt16LE(0x21, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(a.dados.length, 22); lh.writeUInt16LE(nome.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10); ch.writeUInt16LE(0x21, 14);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(a.dados.length, 24); ch.writeUInt16LE(nome.length, 28); ch.writeUInt32LE(off, 42);
    partes.push(lh, nome, comp); central.push(ch, nome); off += 30 + nome.length + comp.length;
  }
  const cd = Buffer.concat(central), fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(arqs.length, 8); fim.writeUInt16LE(arqs.length, 10); fim.writeUInt32LE(cd.length, 12); fim.writeUInt32LE(off, 16);
  return Buffer.concat([...partes, cd, fim]);
}

// ---------- xlsx ----------
const desesc = s => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n)).replace(/&amp;/g, "&");
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
const colNum = c => [...c].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const colLetra = n => { let s = ""; while (n) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };
function abrir(buf) {
  const arqs = zipLer(buf), pega = n => arqs.find(a => a.nome === n);
  const ss = pega("xl/sharedStrings.xml") ? [...pega("xl/sharedStrings.xml").dados.toString("utf8").matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => desesc([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join(""))) : [];
  const wb = pega("xl/workbook.xml").dados.toString("utf8"), rels = pega("xl/_rels/workbook.xml.rels").dados.toString("utf8");
  const abas = [...wb.matchAll(/<sheet\b[^>]*>/g)].map(m => {
    const at = Object.fromEntries([...m[0].matchAll(/([\w:]+)="([^"]*)"/g)].map(x => [x[1], x[2]]));
    const rel = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map(x => x[0]).find(x => x.includes(`Id="${at["r:id"]}"`)) || "";
    const alvo = (rel.match(/Target="([^"]+)"/) || [])[1] || "";
    return { nome: desesc(at.name || ""), oculta: /hidden/i.test(at.state || ""), arquivo: "xl/" + alvo.replace(/^\/?(xl\/)?/, "") };
  });
  return { arqs, pega, ss, abas };
}
// lê as células de uma linha: {A: "texto", B: ...} (com flag de fórmula)
function linha(xml, r, ss) {
  const m = xml.match(new RegExp(`<row [^>]*r="${r}"[^>]*>([\\s\\S]*?)</row>`)); if (!m) return null;
  const out = {};
  for (const c of m[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const [, col, at, inner = ""] = c, v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
    let val = "";
    if (/t="s"/.test(at) && v != null) val = ss[Number(v)] || "";
    else if (/t="inlineStr"/.test(at)) val = desesc([...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join(""));
    else if (v != null) val = desesc(v);
    out[col] = { val, formula: /<f[ >]/.test(inner) };
  }
  return out;
}
// grava valores numa linha, mantendo o estilo das células que já existem; cria a linha se precisar
function gravaLinha(xml, r, valores, estiloCol = {}) {
  const re = new RegExp(`(<row [^>]*r="${r}"[^>]*>)([\\s\\S]*?)(</row>)|<row [^>]*r="${r}"[^>]*/>`);
  let m = xml.match(re), corpo = "", abre = `<row r="${r}">`;
  if (m) { corpo = m[2] || ""; abre = m[1] || `<row r="${r}">`; }
  const celulas = {};
  for (const c of corpo.matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>[\s\S]*?<\/c>)/g)) celulas[c[1]] = { xml: c[0], s: (c[2].match(/s="(\d+)"/) || [])[1] };
  for (const [col, v] of Object.entries(valores)) {
    if (v === "" || v == null) continue;
    const s = celulas[col]?.s ?? estiloCol[colNum(col)], st = s != null ? ` s="${s}"` : "";
    celulas[col] = { xml: typeof v === "number" ? `<c r="${col}${r}"${st}><v>${v}</v></c>` : `<c r="${col}${r}"${st} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`, s };
  }
  const nova = abre + Object.keys(celulas).sort((a, b) => colNum(a) - colNum(b)).map(c => celulas[c].xml).join("") + "</row>";
  if (m) return xml.slice(0, m.index) + nova + xml.slice(m.index + m[0].length);
  // linha nova: entra antes da primeira linha com número maior (ou no fim do sheetData)
  const depois = [...xml.matchAll(/<row [^>]*r="(\d+)"/g)].find(x => Number(x[1]) > r);
  const pos = depois ? depois.index : xml.indexOf("</sheetData>");
  return xml.slice(0, pos) + nova + xml.slice(pos);
}
const estilosColunas = xml => { const e = {}; for (const m of xml.matchAll(/<col [^>]*>/g)) { const a = Object.fromEntries([...m[0].matchAll(/(\w+)="([^"]*)"/g)].map(x => [x[1], x[2]])); if (a.style) for (let c = +a.min; c <= +a.max; c++) e[c] = a.style; } return e; };
// listas suspensas da aba: "'extra info'!$A$25:$C$25" (uma linha de outra aba) ou "\"Ligado,Desativado\"" → {coluna: Set(valores)}
function listasValidas(x, xml) {
  const out = {};
  for (const m of xml.matchAll(/<dataValidation\b([^>]*)>([\s\S]*?)<\/dataValidation>/g)) {
    if (!/type="list"/.test(m[1])) continue;
    const sq = (m[1].match(/sqref="([^"]+)"/) || [])[1] || "", f = desesc((m[2].match(/<formula1>([\s\S]*?)<\/formula1>/) || [])[1] || "");
    let vals = null;
    const lit = f.match(/^"(.*)"$/); if (lit) vals = lit[1].split(",");
    const ref = f.match(/^'?([^'!]+)'?!\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)$/);
    if (ref && ref[3] === ref[5]) {
      const a = x.abas.find(y => y.nome === ref[1]); const arq = a && x.pega(a.arquivo);
      if (arq) { const l = linha(arq.dados.toString("utf8"), Number(ref[3]), x.ss) || {}; vals = Object.entries(l).filter(([c]) => colNum(c) >= colNum(ref[2]) && colNum(c) <= colNum(ref[4])).map(([, v]) => v.val).filter(Boolean); }
    }
    if (!vals) continue;
    for (const parte of sq.split(/\s+/)) { const c = (parte.match(/^([A-Z]+)/) || [])[1]; if (c) out[c] = new Set(vals); }
  }
  return out;
}
const sem = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Descobre o tipo do modelo e as abas onde dá para colocar produtos.
function inspeciona(buf) {
  const x = abrir(buf), abas = [];
  for (const a of x.abas) {
    if (a.oculta) continue;
    const arq = x.pega(a.arquivo); if (!arq) continue;
    const xml = arq.dados.toString("utf8");
    const l1 = linha(xml, 1, x.ss) || {};
    if (Object.values(l1).some(c => /^ps_product_name\|/.test(c.val))) { abas.push({ nome: a.nome, tipo: "shopee" }); continue; } // a aba de exemplo não tem o "|"
    const l3 = linha(xml, 3, x.ss) || {};
    if (Object.values(l3).some(c => /^T[ií]tulo/.test(c.val)) && Object.values(l3).some(c => /^Pre[cç]o/.test(c.val))) abas.push({ nome: a.nome, tipo: "ml" });
  }
  if (!abas.length) throw new Error("Não reconheci o modelo. Envie a planilha baixada em \"Anunciar em massa\" (Mercado Livre) ou \"Adicionar em massa\" (Shopee), sem mudar nada nela.");
  return { tipo: abas[0].tipo, abas: abas.map(a => a.nome) };
}

// produtos: [{aba, titulo, descricao, preco, estoque, sku, fotos[], pesoKg, c, l, a, marca, prazo}]
function preenche(buf, produtos) {
  const x = abrir(buf), porAba = new Map(), mudou = new Map();
  for (const p of produtos) { const a = x.abas.find(y => y.nome === p.aba); if (!a) throw new Error(`A aba "${p.aba}" não está na planilha.`); if (!porAba.has(a)) porAba.set(a, []); porAba.get(a).push(p); }
  for (const [aba, lista] of porAba) {
    let xml = x.pega(aba.arquivo).dados.toString("utf8"); const estilos = estilosColunas(xml);
    const opcoes = listasValidas(x, xml); // coluna → valores aceitos (listas suspensas do modelo)
    const filtra = v => { for (const c of Object.keys(v)) { const ok = opcoes[c]; if (ok && typeof v[c] === "string" && !ok.has(v[c])) delete v[c]; } return v; };
    const l1 = linha(xml, 1, x.ss) || {};
    if (Object.values(l1).some(c => /^ps_product_name\|/.test(c.val))) {
      // Shopee: a linha 1 traz a chave de cada coluna (ps_product_name|1|0 …); os produtos começam na linha 7
      const col = {}; for (const [c, v] of Object.entries(l1)) col[v.val.split("|")[0]] = c;
      let r = 7; while (linha(xml, r, x.ss) && Object.values(linha(xml, r, x.ss)).some(c => c.val)) r++;
      for (const p of lista) {
        const v = {}; const poe = (k, val) => { if (col[k]) v[col[k]] = val; };
        poe("ps_product_name", p.titulo.slice(0, 120)); poe("ps_product_description", p.descricao.slice(0, 5000)); poe("ps_sku_parent_short", p.sku); poe("ps_sku_short", p.sku);
        poe("ps_price", p.preco); poe("ps_stock", p.estoque); poe("ps_item_cover_image", p.fotos[0] || "");
        p.fotos.slice(1, 9).forEach((f, i) => poe("ps_item_image_" + (i + 1), f));
        if (p.pesoKg) poe("ps_weight", p.pesoKg); if (p.c) poe("ps_length", p.c); if (p.l) poe("ps_width", p.l); if (p.a) poe("ps_height", p.a);
        for (const k of Object.keys(col)) if (/^channel_id/.test(k)) v[col[k]] = "Ligado";
        xml = gravaLinha(xml, r++, filtra(v), estilos);
      }
    } else {
      // Mercado Livre: cabeçalhos na linha 3; os produtos começam na 1ª linha com a fórmula de "Quantidade de caracteres"
      const l3 = linha(xml, 3, x.ss) || {}, col = c => Object.entries(l3).find(([, v]) => c.test(sem(v.val)))?.[0];
      const cQtd = col(/^quantidade de caracteres/);
      let r = 4; while (r < 60 && !(linha(xml, r, x.ss)?.[cQtd]?.formula)) r++; if (r >= 60) r = 8;
      const cTit = col(/^titulo/); while (linha(xml, r, x.ss)?.[cTit]?.val) r++;
      const mapa = [[/^titulo/, p => p.titulo.slice(0, 60)], [/^condicao/, () => "Novo"], [/^codigo universal/, () => "O produto não tem código cadastrado"],
        [/^fotos/, p => p.fotos.join(", ")], [/^sku/, p => p.sku], [/^estoque/, p => p.estoque], [/^preco/, p => p.preco], [/^descricao/, p => p.descricao.slice(0, 50000)],
        [/^tipo de anuncio/, () => "Clássico"], [/^custo de envio/, () => "Por conta do comprador"], [/^retirar pessoalmente/, () => "Concordo"],
        [/^tipo de garantia/, () => "Garantia do vendedor"], [/^tempo de garantia/, () => 90], [/^unidade de tempo de garantia/, () => "dias"],
        [/^marca$/, p => p.marca], [/^fabricante/, p => p.marca], [/^modelo$/, p => p.titulo.replace(/\s*(impress[aã]o\s*)?3d\s*$/i, "").slice(0, 60)],
        [/^prazo de disponibilidade/, p => p.prazo],
        // medidas da peça (sem embalagem), em cm: comprimento = maior, largura, altura
        [/^comprimento/, p => p.peca ? [...p.peca].sort((a, b) => b - a)[0] : ""], [/^largura/, p => p.peca ? [...p.peca].sort((a, b) => b - a)[1] : ""], [/^altura/, p => p.peca ? p.peca[2] : ""],
        [/^unidade de (comprimento|largura|altura)/, p => p.peca ? "cm" : ""]];
      for (const p of lista) {
        const v = {};
        for (const [c, cab] of Object.entries(l3)) { const h = sem(cab.val); const m = mapa.find(([re]) => re.test(h)); if (m) { const val = m[1](p); if (val !== "" && val != null) v[c] = val; } }
        xml = gravaLinha(xml, r++, filtra(v), estilos);
      }
    }
    mudou.set(aba.arquivo, Buffer.from(xml, "utf8"));
  }
  return zipGravar(x.arqs.map(a => ({ nome: a.nome, dados: mudou.get(a.nome) || a.dados })));
}

module.exports = { inspeciona, preenche, _zip: { zipLer, zipGravar, crc32 } };

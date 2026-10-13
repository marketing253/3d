// Lê o peso do filamento e o tempo de impressão de um arquivo fatiado do Bambu Studio
// (.gcode.3mf / .3mf fatiado / .gcode). Tudo acontece no navegador: o arquivo não é enviado ao servidor.
(function(){
"use strict";
const LIMITE_TEXTO = 400 * 1024; // lê só o começo e o fim do G-code

function u16(b, o){ return b[o] | (b[o+1] << 8) }
function u32(b, o){ return (b[o] | (b[o+1] << 8) | (b[o+2] << 16) | (b[o+3] << 24)) >>> 0 }

function entradasZip(b){
  let fim = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 70000); i--) if (u32(b, i) === 0x06054b50) { fim = i; break }
  if (fim < 0) throw new Error("Não consegui abrir o arquivo .3mf.");
  const total = u16(b, fim + 10); let p = u32(b, fim + 16); const lista = [];
  const dec = new TextDecoder();
  for (let k = 0; k < total && u32(b, p) === 0x02014b50; k++) {
    const metodo = u16(b, p + 10), comp = u32(b, p + 20), tam = u32(b, p + 24);
    const ln = u16(b, p + 28), le = u16(b, p + 30), lc = u16(b, p + 32), local = u32(b, p + 42);
    lista.push({ nome: dec.decode(b.subarray(p + 46, p + 46 + ln)), metodo, comp, tam, local });
    p += 46 + ln + le + lc;
  }
  return lista;
}
async function textoZip(b, e, max){
  const ini = e.local + 30 + u16(b, e.local + 26) + u16(b, e.local + 28);
  const dados = b.subarray(ini, ini + e.comp);
  if (e.metodo === 0) return new TextDecoder().decode(max ? dados.subarray(0, max) : dados);
  if (e.metodo !== 8) throw new Error("Formato de compactação não suportado.");
  const leitor = new Blob([dados]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  const partes = []; let n = 0;
  for (;;) { const { done, value } = await leitor.read(); if (done) break; partes.push(value); n += value.length; if (max && n >= max) { leitor.cancel().catch(()=>{}); break } }
  const tudo = new Uint8Array(n); let o = 0; for (const p of partes) { tudo.set(p, o); o += p.length }
  return new TextDecoder().decode(tudo);
}

function deSliceInfo(xml){
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const placas = [...doc.getElementsByTagName("plate")];
  if (!placas.length) return null;
  let seg = 0, peso = 0; const fil = new Map(); let comDados = 0;
  for (const pl of placas) {
    const meta = k => { const m = [...pl.getElementsByTagName("metadata")].find(x => x.getAttribute("key") === k); return m ? parseFloat(m.getAttribute("value")) : NaN };
    const pr = meta("prediction"), w = meta("weight");
    const fs = [...pl.getElementsByTagName("filament")];
    if (!(pr > 0) && !fs.length) continue;
    comDados++;
    if (pr > 0) seg += pr;
    if (w > 0) peso += w;
    for (const f of fs) {
      const g = parseFloat(f.getAttribute("used_g")) || 0; if (!(g > 0)) continue;
      const tipo = f.getAttribute("type") || "", cor = f.getAttribute("color") || "";
      const k = tipo + "|" + cor.toUpperCase();
      const a = fil.get(k) || { tipo, cor, g: 0 }; a.g += g; fil.set(k, a);
    }
  }
  if (!comDados) return null;
  const filamentos = [...fil.values()];
  if (!filamentos.length && peso > 0) filamentos.push({ tipo: "", cor: "", g: peso });
  return { segundos: Math.round(seg), filamentos, placas: comDados };
}

function tempoTexto(s){
  let t = 0; const re = /(\d+(?:\.\d+)?)\s*([dhms])/g; let m, achou = false;
  while ((m = re.exec(s))) { achou = true; t += parseFloat(m[1]) * { d: 86400, h: 3600, m: 60, s: 1 }[m[2]] }
  return achou ? t : NaN;
}
function deGcode(txt){
  const linha = re => { const m = txt.match(re); return m ? m[1].trim() : null };
  let seg = NaN;
  const t1 = linha(/;\s*total estimated time:\s*([^;\n]+)/i) || linha(/;\s*estimated printing time \(normal mode\)\s*=\s*([^\n]+)/i) || linha(/;\s*model printing time:\s*([^;\n]+)/i);
  if (t1) seg = tempoTexto(t1);
  if (!(seg > 0)) { const s = linha(/;\s*TIME:\s*(\d+)/); if (s) seg = +s }
  const lista = s => s ? s.split(/[,;]/).map(x => x.trim()) : [];
  const gs = lista(linha(/;\s*filament used \[g\]\s*=\s*([^\n]+)/i)).map(parseFloat);
  const tipos = lista(linha(/;\s*filament_type\s*=\s*([^\n]+)/i));
  const cores = lista(linha(/;\s*filament_colou?r\s*=\s*([^\n]+)/i));
  let filamentos = gs.map((g, i) => ({ tipo: tipos[i] || tipos[0] || "", cor: cores[i] || "", g })).filter(f => f.g > 0);
  if (!filamentos.length) {
    const tot = parseFloat(linha(/;\s*total filament weight \[g\]\s*:\s*([\d.]+)/i));
    if (tot > 0) filamentos = [{ tipo: tipos[0] || "", cor: cores[0] || "", g: tot }];
  }
  if (!(seg > 0) && !filamentos.length) return null;
  return { segundos: Math.round(seg > 0 ? seg : 0), filamentos, placas: 1 };
}

window.lerFatiado = async function(file){
  const buf = new Uint8Array(await file.arrayBuffer());
  if (buf[0] === 0x50 && buf[1] === 0x4b) {
    const ents = entradasZip(buf);
    const si = ents.find(e => /(^|\/)slice_info\.config$/i.test(e.nome));
    if (si) { const r = deSliceInfo(await textoZip(buf, si)); if (r) return r }
    const gs = ents.filter(e => /\.gcode$/i.test(e.nome));
    if (gs.length) {
      let seg = 0, fil = [];
      for (const g of gs) { const r = deGcode(await textoZip(buf, g, LIMITE_TEXTO)); if (r) { seg += r.segundos; fil = fil.concat(r.filamentos) } }
      if (seg > 0 || fil.length) return { segundos: seg, filamentos: fil, placas: gs.length };
    }
    throw new Error("Este .3mf ainda não foi fatiado. No Bambu Studio, clique em Fatiar e depois em Arquivo → Exportar → Exportar arquivo fatiado (.gcode.3mf).");
  }
  const dec = new TextDecoder();
  const txt = buf.length > LIMITE_TEXTO * 2 ? dec.decode(buf.subarray(0, LIMITE_TEXTO)) + "\n" + dec.decode(buf.subarray(buf.length - LIMITE_TEXTO)) : dec.decode(buf);
  const r = deGcode(txt);
  if (!r) throw new Error("Não encontrei tempo nem peso neste arquivo. Use o arquivo fatiado do Bambu Studio (.gcode.3mf ou .gcode).");
  return r;
};
})();

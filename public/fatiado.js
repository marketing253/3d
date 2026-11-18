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

// ---------- medidas da peça (mm) ----------
// 3MF: caixa de cada objeto da malha (com as transformações de componentes e da placa); fica a maior peça.
// gcode.3mf sem malha: caixa dos objetos em Metadata/plate_N.json + altura do G-code (max_z_height).
const ESCALA = { micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 };
function caixaTransf(c, t){
  if (!t) return c;
  const m = t.trim().split(/\s+/).map(Number); if (m.length !== 12 || m.some(isNaN)) return c;
  const out = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const x of [c[0], c[3]]) for (const y of [c[1], c[4]]) for (const z of [c[2], c[5]]) {
    const p = [x*m[0] + y*m[3] + z*m[6] + m[9], x*m[1] + y*m[4] + z*m[7] + m[10], x*m[2] + y*m[5] + z*m[8] + m[11]];
    for (let i = 0; i < 3; i++) { out[i] = Math.min(out[i], p[i]); out[i+3] = Math.max(out[i+3], p[i]) }
  }
  return out;
}
const juntaCaixa = (a, b) => !a ? b : !b ? a : [Math.min(a[0],b[0]), Math.min(a[1],b[1]), Math.min(a[2],b[2]), Math.max(a[3],b[3]), Math.max(a[4],b[4]), Math.max(a[5],b[5])];
const atr = (s, k) => { const m = s.match(new RegExp("(?:^|\\s)" + k + '="([^"]*)"')); return m ? m[1] : null };
function medidasDe(caixas){
  let melhor = null;
  for (const c of caixas) { if (!c || !isFinite(c[0])) continue; const d = [c[3]-c[0], c[4]-c[1], c[5]-c[2]]; if (!melhor || d[0]*d[1]*Math.max(d[2],0.1) > melhor[0]*melhor[1]*Math.max(melhor[2],0.1)) melhor = d }
  return melhor && melhor[0] > 0 ? { x: +melhor[0].toFixed(1), y: +melhor[1].toFixed(1), z: +melhor[2].toFixed(1) } : null;
}
async function medidasMalha(buf, ents){
  const modelos = ents.filter(e => /^3D\/.*\.model$/i.test(e.nome)); if (!modelos.length) return null;
  const objs = new Map(); // "arquivo#id" → {caixa} ou {comps}
  let escala = 1;
  for (const e of modelos) {
    const txt = await textoZip(buf, e), arq = "/" + e.nome;
    const un = (txt.match(/<model\b[^>]*\bunit="([^"]+)"/) || [])[1]; if (e.nome.toLowerCase() === "3d/3dmodel.model" && un) escala = ESCALA[un] || 1;
    for (const o of txt.matchAll(/<object\b([^>]*)>([\s\S]*?)<\/object>/g)) {
      const id = atr(o[1], "id"); if (!id) continue;
      if (/<vertex\b/.test(o[2])) {
        const c = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
        for (const v of o[2].matchAll(/<vertex\b([^>]*)\/?>/g)) {
          const x = +atr(v[1], "x"), y = +atr(v[1], "y"), z = +atr(v[1], "z");
          if (x < c[0]) c[0] = x; if (y < c[1]) c[1] = y; if (z < c[2]) c[2] = z; if (x > c[3]) c[3] = x; if (y > c[4]) c[4] = y; if (z > c[5]) c[5] = z;
        }
        objs.set(arq + "#" + id, { caixa: c });
      } else {
        const comps = [...o[2].matchAll(/<component\b([^>]*)\/?>/g)].map(c => ({ ref: (atr(c[1], "p:path") || arq) + "#" + atr(c[1], "objectid"), t: atr(c[1], "transform") }));
        objs.set(arq + "#" + id, { comps });
      }
    }
  }
  const caixaDe = (k, n = 0) => { const o = objs.get(k); if (!o || n > 8) return null; if (o.caixa) return o.caixa; let c = null; for (const x of o.comps) c = juntaCaixa(c, caixaTransf(caixaDe(x.ref, n + 1), x.t)); return c };
  const raiz = ents.find(e => e.nome.toLowerCase() === "3d/3dmodel.model"); if (!raiz) return null;
  const itens = [...(await textoZip(buf, raiz)).matchAll(/<item\b([^>]*)\/?>/g)].map(i => caixaTransf(caixaDe("/3D/3dmodel.model#" + atr(i[1], "objectid")), atr(i[1], "transform")));
  const m = medidasDe(itens); if (!m) return null;
  return { x: +(m.x * escala).toFixed(1), y: +(m.y * escala).toFixed(1), z: +(m.z * escala).toFixed(1) };
}
async function medidasPlaca(buf, ents){
  let xy = null, z = 0;
  for (const e of ents.filter(e => /plate_\d+\.json$/i.test(e.nome))) {
    try { const j = JSON.parse(await textoZip(buf, e)); for (const o of j.bbox_objects || []) { const b = o.bbox; if (!Array.isArray(b) || b.length < 4) continue; const d = [b[2]-b[0], b[3]-b[1]]; if (!xy || d[0]*d[1] > xy[0]*xy[1]) xy = d } } catch (err) {}
  }
  for (const g of ents.filter(e => /\.gcode$/i.test(e.nome))) { const m = (await textoZip(buf, g, 80 * 1024)).match(/;\s*max_z_height:\s*([\d.]+)/i); if (m) z = Math.max(z, parseFloat(m[1])) }
  if (!xy && !(z > 0)) return null;
  return { x: xy ? +xy[0].toFixed(1) : 0, y: xy ? +xy[1].toFixed(1) : 0, z: +z.toFixed(1) };
}
function medidasStl(buf){
  const c = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  const pega = (x, y, z) => { if (x < c[0]) c[0] = x; if (y < c[1]) c[1] = y; if (z < c[2]) c[2] = z; if (x > c[3]) c[3] = x; if (y > c[4]) c[4] = y; if (z > c[5]) c[5] = z };
  const n = buf.length >= 84 ? u32(buf, 80) : 0;
  if (n > 0 && 84 + n * 50 === buf.length) { // binário
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    for (let i = 0; i < n; i++) { const o = 84 + i * 50 + 12; for (let k = 0; k < 3; k++) pega(dv.getFloat32(o + k*12, true), dv.getFloat32(o + k*12 + 4, true), dv.getFloat32(o + k*12 + 8, true)) }
  } else {
    const txt = new TextDecoder().decode(buf);
    for (const m of txt.matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)) pega(+m[1], +m[2], +m[3]);
  }
  return medidasDe([c]);
}

window.lerFatiado = async function(file){
  if (/\.stl$/i.test(file.name)) {
    const m = medidasStl(new Uint8Array(await file.arrayBuffer()));
    if (!m) throw new Error("Não consegui ler as medidas deste STL.");
    return { segundos: 0, filamentos: [], placas: 0, medidas: m, soMedidas: true };
  }
  const r = await lerFatiadoBase(file);
  return r;
};
async function lerFatiadoBase(file){
  const buf = new Uint8Array(await file.arrayBuffer());
  if (buf[0] === 0x50 && buf[1] === 0x4b) {
    const ents = entradasZip(buf);
    let medidas = null; try { medidas = await medidasMalha(buf, ents) || await medidasPlaca(buf, ents) } catch (err) {}
    const si = ents.find(e => /(^|\/)slice_info\.config$/i.test(e.nome));
    if (si) { const r = deSliceInfo(await textoZip(buf, si)); if (r) return { ...r, medidas } }
    const gs = ents.filter(e => /\.gcode$/i.test(e.nome));
    if (gs.length) {
      let seg = 0, fil = [];
      for (const g of gs) { const r = deGcode(await textoZip(buf, g, LIMITE_TEXTO)); if (r) { seg += r.segundos; fil = fil.concat(r.filamentos) } }
      if (seg > 0 || fil.length) return { segundos: seg, filamentos: fil, placas: gs.length, medidas };
    }
    if (medidas) return { segundos: 0, filamentos: [], placas: 0, medidas, soMedidas: true }; // projeto ainda não fatiado: pelo menos as medidas
    throw new Error("Este .3mf ainda não foi fatiado. No Bambu Studio, clique em Fatiar e depois em Arquivo → Exportar → Exportar arquivo fatiado (.gcode.3mf).");
  }
  const dec = new TextDecoder();
  const txt = buf.length > LIMITE_TEXTO * 2 ? dec.decode(buf.subarray(0, LIMITE_TEXTO)) + "\n" + dec.decode(buf.subarray(buf.length - LIMITE_TEXTO)) : dec.decode(buf);
  const r = deGcode(txt);
  if (!r) throw new Error("Não encontrei tempo nem peso neste arquivo. Use o arquivo fatiado do Bambu Studio (.gcode.3mf ou .gcode).");
  const zm = txt.match(/;\s*max_z_height:\s*([\d.]+)/i); // G-code solto só traz a altura
  if (zm) r.medidas = { x: 0, y: 0, z: +parseFloat(zm[1]).toFixed(1) };
  return r;
}
})();

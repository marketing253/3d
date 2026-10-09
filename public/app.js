(function(){
"use strict";
const $=s=>document.querySelector(s);
const brl=v=>v==null||!isFinite(v)?"—":v.toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const pct=v=>v==null||!isFinite(v)?"—":(v*100).toLocaleString("pt-BR",{maximumFractionDigits:1})+"%";
const num=v=>{const n=parseFloat(v);return isFinite(n)?n:0};
const uid=()=>Math.random().toString(36).slice(2,10);
const safeUrl=u=>{try{const x=new URL(String(u||"").trim());return /^https?:$/.test(x.protocol)?x.href:null}catch(e){return null}};
const fotoSrc=p=>p&&p.fotoId?"/fotos/"+encodeURIComponent(p.fotoId):null;
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

const DEFAULTS={
  tarifaKwh:0.90, consumoW:100, valorImpressora:4500, vidaUtilH:5000, manutencaoH:0.30,
  falhaPct:10, maoObraH:20, impostoPct:0, margemPct:40,
  filamentos:[
    {id:"pla-nac",nome:"PLA Básico nacional",precoKg:95},
    {id:"pla-matte",nome:"PLA Matte",precoKg:115},
    {id:"pla-bambu",nome:"PLA Basic Bambu Lab",precoKg:150},
    {id:"petg",nome:"PETG",precoKg:105},
    {id:"tpu",nome:"TPU 95A",precoKg:160}
  ],
  canais:[
    {id:"direta",nome:"Venda direta (Insta/WhatsApp)",comissaoPct:0,tarifaFixa:0,fixaAbaixoDe:0},
    {id:"ml",nome:"Mercado Livre Clássico",comissaoPct:14,tarifaFixa:6.5,fixaAbaixoDe:79},
    {id:"shopee",nome:"Shopee",comissaoPct:20,tarifaFixa:4,fixaAbaixoDe:0}
  ]
};
const clone=o=>JSON.parse(JSON.stringify(o));
let cfg=clone(DEFAULTS);
let produtos=[];
let me=null, carregado=false;
const podeEditar=()=>me&&me.papel!=="leitura";
async function api(method,url,body){
  const opt={method,headers:{},credentials:"same-origin"};
  if(body instanceof FormData) opt.body=body;
  else if(body!==undefined){opt.headers["Content-Type"]="application/json";opt.body=JSON.stringify(body)}
  let r; try{ r=await fetch(url,opt) }catch(e){ const err=new Error("Sem conexão com o servidor. Confira a internet e tente de novo.");err.status=0;throw err }
  let data=null; try{ data=await r.json() }catch(e){}
  if(r.status===401&&!url.startsWith("/api/login")&&!url.startsWith("/api/primeiro")&&!url.startsWith("/api/minha-senha")){ showAuth(); }
  if(!r.ok){ const err=new Error((data&&data.erro)||"Algo deu errado. Tente de novo.");err.status=r.status;throw err }
  return data;
}
let fotoOriginal=null;
let editingId=null;
let draft=null;

/* ---------- cálculo ---------- */
function precoCanal(custo,c,margemPct,impPct){
  const k=1-(num(c.comissaoPct)+num(impPct)+num(margemPct))/100;
  if(k<=0.02) return null;
  const fixa=num(c.tarifaFixa), lim=num(c.fixaAbaixoDe);
  let p=(custo+fixa)/k;
  if(lim>0 && p>=lim){ const semFixa=custo/k; p=Math.max(semFixa,lim); }
  return Math.ceil(p-0.9+1e-9)+0.9; // arredonda para R$ x,90
}
function lucroCanal(preco,custo,c,impPct){
  const lim=num(c.fixaAbaixoDe);
  const fixa=(lim>0 && preco>=lim)?0:num(c.tarifaFixa);
  const taxas=preco*num(c.comissaoPct)/100+fixa;
  const imposto=preco*num(impPct)/100;
  const lucro=preco-taxas-imposto-custo;
  return {taxas,imposto,lucro,margem:preco>0?lucro/preco:null};
}
function calc(p,C){
  C=C||cfg;
  const uni=Math.max(1,Math.round(num(p.unidades)||1));
  const horas=num(p.horas)+num(p.minutos)/60;
  let gramas=0,material=0,faltando=false;
  for(const l of (p.filamentos||[])){
    const f=C.filamentos.find(x=>x.id===l.filId); const g=num(l.gramas);
    gramas+=g; if(!f&&g>0) faltando=true;
    material+=g/1000*(f?num(f.precoKg):0);
  }
  const energia=horas*num(C.consumoW)/1000*num(C.tarifaKwh);
  const vida=Math.max(1,num(C.vidaUtilH));
  const desgaste=horas*(num(C.valorImpressora)/vida+num(C.manutencaoH));
  const falha=(material+energia+desgaste)*num(C.falhaPct)/100;
  const maoObra=num(p.manualMin)/60*num(C.maoObraH);
  const u={
    material:material/uni, maquina:(energia+desgaste)/uni, energia:energia/uni, desgaste:desgaste/uni,
    falha:falha/uni, maoObra:maoObra/uni, extras:num(p.embalagem)+num(p.outros)
  };
  const custo=u.material+u.maquina+u.falha+u.maoObra+u.extras;
  const margem=(p.margemPct===""||p.margemPct==null)?num(C.margemPct):num(p.margemPct);
  const precoReal=num(p.precoVenda)>0?num(p.precoVenda):null;
  const canais=C.canais.map(c=>{
    const sug=precoCanal(custo,c,margem,C.impostoPct);
    const usado=precoReal??sug;
    const r=usado!=null?lucroCanal(usado,custo,c,C.impostoPct):null;
    return {id:c.id,nome:c.nome,sugerido:sug,usado,real:precoReal!=null,...(r||{}),
      lucroH:(r&&horas>0)?r.lucro/(horas/uni):null};
  });
  return {uni,horas,horasUnid:horas/uni,gramas,gramasUnid:gramas/uni,u,custo,margem,canais,faltando};
}


/* ---------- abas ---------- */
let tab="produtos";
function setTab(t){
  tab=t;
  document.querySelectorAll("nav.tabs button").forEach(b=>b.setAttribute("aria-selected",String(b.dataset.tab===t)));
  ["produtos","financeiro","novo","tendencias","config","usuarios","conta"].forEach(x=>{$("#p-"+x).hidden=x!==t});
  try{localStorage.setItem("prec3d.tab",t)}catch(e){}
  if(t==="config") renderConfig();
  if(t==="usuarios") carregaUsuarios();
  if(t==="financeiro") carregaFin();
  if(t==="novo") renderFicha();
  window.scrollTo({top:0});
}
document.querySelectorAll("nav.tabs button").forEach(b=>b.addEventListener("click",()=>{
  if(b.dataset.tab==="novo"&&!editingId&&!draft) startForm(null);
  setTab(b.dataset.tab);
}));

function toast(msg){const t=$("#toast");t.textContent=msg;t.hidden=false;clearTimeout(toast._t);toast._t=setTimeout(()=>t.hidden=true,2600)}
const PAPEL_NOME={admin:"Administrador",editor:"Editor",leitura:"Só leitura"};
function renderUserChip(){
  $("#userchip").innerHTML=me?`<span>Olá, <b>${esc(me.nome)}</b> · ${PAPEL_NOME[me.papel]||""}</span><button class="btn" id="btnSair" type="button">Sair</button>`:"";
}
$("#userchip").addEventListener("click",async e=>{
  if(!e.target.closest("#btnSair")) return;
  try{await api("POST","/api/logout")}catch(err){}
  me=null;produtos=[];draft=null;editingId=null;showAuth();
});

/* ---------- lista / ranking ---------- */
function renderRankCanal(){
  const sel=$("#rankCanal"), cur=sel.value;
  sel.innerHTML=cfg.canais.map(c=>`<option value="${esc(c.id)}">${esc(c.nome)}</option>`).join("");
  if(cfg.canais.some(c=>c.id===cur)) sel.value=cur;
}
function renderLista(){
  renderRankCanal();
  const box=$("#lista");
  if(!produtos.length){
    box.innerHTML=`<div class="card empty"><h2>${!carregado?"Carregando seus produtos…":"Nenhum produto cadastrado ainda"}</h2>
      <p>Cadastre um item com os gramas e o tempo que o Bambu Studio mostra depois de fatiar. O sistema calcula o custo e o preço de venda em cada canal.</p>
      <button class="btn primary edit-only" data-act="novo">Cadastrar o primeiro produto</button></div>`;
    return;
  }
  const canalId=$("#rankCanal").value||cfg.canais[0]?.id;
  const sort=$("#sortBy").value;
  const rows=produtos.map(p=>{const r=calc(p);const ch=r.canais.find(c=>c.id===canalId)||r.canais[0];return {p,r,ch}});
  const key={lucroH:x=>-(x.ch?.lucroH??-1e9),lucro:x=>-(x.ch?.lucro??-1e9),margem:x=>-(x.ch?.margem??-1e9),custo:x=>x.r.custo,nome:x=>x.p.nome.toLowerCase()}[sort];
  rows.sort((a,b)=>{const A=key(a),B=key(b);return A<B?-1:A>B?1:0});
  const maxLH=Math.max(...rows.map(x=>x.ch?.lucroH||0),1);
  box.innerHTML=`<div class="tablewrap"><table><thead><tr>
    <th></th><th>Produto</th><th class="n">Tempo/un.</th><th class="n">Filamento/un.</th><th class="n">Custo/un.</th>
    <th class="n">Preço</th><th class="n">Lucro/un.</th><th class="n">Margem</th><th class="n">Lucro/h impressora</th><th></th></tr></thead><tbody>
    ${rows.map((x,i)=>{const {p,r,ch}=x;const lh=ch?.lucroH;
      const mCls=ch?.margem==null?"":ch.margem<0.15?"bad":ch.margem>=0.3?"good":"";
      return `<tr>
      <td class="rank">${i+1}</td>
      <td><div class="pcell">${fotoSrc(p)?`<img class="thumb" src="${esc(fotoSrc(p))}" alt="" loading="lazy">`:`<span class="thumb ph">3D</span>`}
        <div style="min-width:0"><div class="pname">${esc(p.nome)}</div><div class="pcat">${esc(p.categoria||"Sem categoria")}${r.uni>1?` · ${r.uni} por mesa`:""}${safeUrl(p.linkModelo)?`<br><a href="${esc(safeUrl(p.linkModelo))}" target="_blank" rel="noopener">abrir modelo ↗</a>`:""}</div></div></div></td>
      <td class="n">${fmtH(r.horasUnid)}</td>
      <td class="n">${r.gramasUnid.toLocaleString("pt-BR",{maximumFractionDigits:1})} g</td>
      <td class="n">${brl(r.custo)}</td>
      <td class="n">${brl(ch?.usado)}${ch&&!ch.real?`<div class="pcat">sugerido</div>`:""}</td>
      <td class="n">${brl(ch?.lucro)}</td>
      <td class="n"><span class="pill ${mCls}">${pct(ch?.margem)}</span></td>
      <td class="n"><div class="meter"><b style="width:${lh>0?Math.max(2,lh/maxLH*70):2}px"></b>${brl(lh)}</div></td>
      <td style="white-space:nowrap;text-align:right" data-id="${esc(p.id)}" class="edit-only">
        <button class="btn ghost" data-act="edit">Editar</button>
        <button class="btn ghost" data-act="vender">Vendi</button>
        <button class="btn ghost" data-act="dup">Duplicar</button>
        <button class="btn ghost" data-act="del">Excluir</button></td></tr>`}).join("")}
  </tbody></table></div>`;
}
function fmtH(h){if(!h)return "—";const t=Math.round(h*60);const H=Math.floor(t/60),M=t%60;return H?`${H}h${String(M).padStart(2,"0")}`:`${M} min`}
$("#lista").addEventListener("click",async e=>{
  const b=e.target.closest("button[data-act]"); if(!b) return;
  const act=b.dataset.act;
  if(act==="novo"){startForm(null);setTab("novo");return}
  const id=b.closest("[data-id]")?.dataset.id; const p=produtos.find(x=>x.id===id); if(!p) return;
  if(act==="edit"){startForm(p);setTab("novo")}
  if(act==="vender"){setTab("financeiro");abreForm("venda",{produto_id:p.id});return}
  if(act==="dup"){const c=clone(p);delete c.id;c.nome=p.nome+" (cópia)";startForm(c);setTab("novo")}
  if(act==="del"){
    const td=b.parentElement;
    td.innerHTML=`<span class="confirm">Excluir "${esc(p.nome)}"? <button class="btn danger" data-act="delok">Excluir</button><button class="btn ghost" data-act="delno">Manter</button></span>`;
  }
  if(act==="delno") renderLista();
  if(act==="delok"){
    try{await api("DELETE","/api/produtos/"+encodeURIComponent(id));produtos=produtos.filter(x=>x.id!==id);renderLista();toast("Produto excluído")}
    catch(err){toast(err.message);renderLista()}
  }
});
$("#sortBy").addEventListener("change",()=>{try{localStorage.setItem("prec3d.sort",$("#sortBy").value)}catch(e){};renderLista()});
$("#rankCanal").addEventListener("change",renderLista);
$("#btnNovo").addEventListener("click",()=>{startForm(null);setTab("novo")});

/* ---------- formulário ---------- */
function blank(){return {nome:"",categoria:"",unidades:1,filamentos:[{filId:cfg.filamentos[0]?.id||"",gramas:""}],horas:0,minutos:0,manualMin:5,embalagem:0,outros:0,margemPct:"",precoVenda:"",linkModelo:"",fotoId:""}}
function startForm(p){
  editingId=p&&p.id?p.id:null;
  draft=p?clone(p):blank();
  if(!draft.filamentos||!draft.filamentos.length) draft.filamentos=[{filId:cfg.filamentos[0]?.id||"",gramas:""}];
  $("#formTitle").textContent=editingId?"Editar produto":"Novo produto";
  $("#btnSalvar").textContent=editingId?"Salvar alterações":"Salvar produto";
  $("#f-nome").value=draft.nome||"";
  $("#f-cat").value=draft.categoria||"";
  $("#f-unid").value=draft.unidades||1;
  $("#f-h").value=draft.horas||0; $("#f-m").value=draft.minutos||0;
  $("#f-manual").value=draft.manualMin??0;
  $("#f-emb").value=draft.embalagem??0; $("#f-out").value=draft.outros??0;
  $("#f-margem").value=draft.margemPct??""; $("#f-margem").placeholder=String(cfg.margemPct);
  $("#f-preco").value=draft.precoVenda??"";
  $("#f-link").value=draft.linkModelo||"";
  fotoOriginal=editingId?(draft.fotoId||null):null;
  if(!editingId&&draft.fotoId){draft.fotoId="";} /* cópia não compartilha a foto */
  renderFoto();
  $("#saveMsg").textContent="";
  renderFilLines(); renderFicha();
  $("#cats").innerHTML=[...new Set(produtos.map(p=>p.categoria).filter(Boolean))].map(c=>`<option value="${esc(c)}">`).join("");
}
function readForm(){
  draft.nome=$("#f-nome").value.trim();
  draft.categoria=$("#f-cat").value.trim();
  draft.unidades=Math.max(1,Math.round(num($("#f-unid").value)||1));
  draft.horas=num($("#f-h").value); draft.minutos=num($("#f-m").value);
  draft.manualMin=num($("#f-manual").value);
  draft.embalagem=num($("#f-emb").value); draft.outros=num($("#f-out").value);
  draft.margemPct=$("#f-margem").value===""?"":num($("#f-margem").value);
  draft.precoVenda=$("#f-preco").value===""?"":num($("#f-preco").value);
  draft.linkModelo=$("#f-link").value.trim();
  document.querySelectorAll("#filLines .fil-line").forEach((el,i)=>{
    draft.filamentos[i]={filId:el.querySelector("select").value,gramas:el.querySelector("input").value===""?"":num(el.querySelector("input").value)};
  });
}
function renderFilLines(){
  const opts=id=>cfg.filamentos.map(f=>`<option value="${esc(f.id)}"${f.id===id?" selected":""}>${esc(f.nome)} · ${brl(num(f.precoKg))}/kg</option>`).join("")
    +(id&&!cfg.filamentos.some(f=>f.id===id)?`<option value="${esc(id)}" selected>Filamento removido</option>`:"");
  $("#filLines").innerHTML=draft.filamentos.map((l,i)=>`<div class="fil-line">
    <select id="fil-sel-${i}" aria-label="Filamento ${i+1}">${opts(l.filId)}</select>
    <div class="unit"><input id="fil-g-${i}" type="number" min="0" step="0.1" value="${esc(l.gramas)}" placeholder="0" aria-label="Gramas"><span>g</span></div>
    <button type="button" class="btn ghost" data-rm="${i}" aria-label="Remover" ${draft.filamentos.length<2?"disabled":""}>✕</button></div>`).join("");
}
$("#filLines").addEventListener("click",e=>{const b=e.target.closest("[data-rm]");if(!b)return;readForm();draft.filamentos.splice(+b.dataset.rm,1);renderFilLines();renderFicha()});
$("#btnAddFil").addEventListener("click",()=>{readForm();if(draft.filamentos.length>=8)return;draft.filamentos.push({filId:cfg.filamentos[Math.min(draft.filamentos.length,cfg.filamentos.length-1)]?.id||"",gramas:""});renderFilLines();renderFicha()});
$("#form").addEventListener("input",()=>{readForm();renderFicha()});
$("#form").addEventListener("change",()=>{readForm();renderFicha()});
$("#btnLimpar").addEventListener("click",()=>{discardUnsavedFoto();startForm(null)});
$("#btnCancelar").addEventListener("click",()=>{discardUnsavedFoto();draft=null;editingId=null;setTab("produtos")});
$("#form").addEventListener("submit",async e=>{
  e.preventDefault(); readForm();
  if(!draft.nome){$("#saveMsg").textContent="Dê um nome ao produto para salvar.";$("#f-nome").focus();return}
  const body=clone(draft); delete body.id;
  body.filamentos=body.filamentos.filter(l=>num(l.gramas)>0||body.filamentos.length===1);
  body.atualizadoEm=new Date().toISOString();
  const btn=$("#btnSalvar"); btn.disabled=true;
  try{
    if(editingId){const r=await api("PUT","/api/produtos/"+encodeURIComponent(editingId),body);const i=produtos.findIndex(x=>x.id===editingId);produtos[i]={...r,atualizadoPor:me.nome}}
    else{const r=await api("POST","/api/produtos",body);produtos.push({...r,atualizadoPor:me.nome})}
    fotoOriginal=null;
    toast(editingId?"Alterações salvas":"Produto salvo");
    draft=null;editingId=null;renderLista();setTab("produtos");
  }catch(err){
    $("#saveMsg").textContent=err.message;
  }finally{btn.disabled=false}
});

function renderFicha(){
  if(!draft) return;
  const r=calc(draft);
  const u=r.u, total=r.custo||0;
  const parts=[["Filamento",u.material,"--c1",`${r.gramasUnid.toLocaleString("pt-BR",{maximumFractionDigits:1})} g por unidade`],
    ["Impressora (luz + desgaste)",u.maquina,"--c2",`luz ${brl(u.energia)} · desgaste ${brl(u.desgaste)}`],
    [`Reserva para falhas (${num(cfg.falhaPct)}%)`,u.falha,"--c3",""],
    ["Mão de obra",u.maoObra,"--c4",`${num(draft.manualMin)} min a ${brl(num(cfg.maoObraH))}/h${r.uni>1?` ÷ ${r.uni} peças`:""}`],
    ["Embalagem e extras",u.extras,"--c5",""]];
  const hasInput=r.gramas>0||r.horas>0;
  const fs=fotoSrc(draft), lk=safeUrl(draft.linkModelo);
  $("#ficha").innerHTML=`
    ${fs?`<img class="fichafoto" src="${esc(fs)}" alt="Foto do produto">`:""}
    ${lk?`<a href="${esc(lk)}" target="_blank" rel="noopener" style="font-size:13.5px">Abrir página do modelo ↗</a>`:""}
    <div class="stack" style="gap:6px"><h3>Custo por unidade</h3>
      <div class="big num">${brl(total)}</div>
      <div class="note">${r.horas>0?`${fmtH(r.horas)} de impressão`:"Informe o tempo de impressão"}${r.uni>1?` para ${r.uni} peças (${fmtH(r.horasUnid)} cada)`:""}</div></div>
    ${r.faltando?`<div class="warnbox">Um filamento deste produto foi removido em Custos e taxas. Escolha outro filamento para o custo ficar certo.</div>`:""}
    <div class="bar" role="img" aria-label="Composição do custo">${parts.map(p=>`<i style="width:${total>0?p[1]/total*100:0}%;background:var(${p[2]})"></i>`).join("")}</div>
    <div class="kv">${parts.map(p=>`<span class="sw" style="background:var(${p[2]})"></span><span>${p[0]}</span><span class="v">${brl(p[1])}</span>${p[3]?`<span class="sub">${esc(p[3])}</span>`:""}`).join("")}</div>
    <div class="stack" style="gap:0">
      <div class="row spread" style="margin-bottom:10px"><h3>Preço sugerido por canal</h3><span class="pill acc">margem ${num(r.margem)}%</span></div>
      ${r.canais.map(c=>{
        if(c.sugerido==null) return `<div class="chan"><span class="name">${esc(c.nome)}</span><span class="pill bad">margem alta demais</span>
          <span class="det">Comissão + imposto + margem passam de 98%. Reduza a margem.</span></div>`;
        const lucroTxt=c.real?`com o seu preço de ${brl(c.usado)}: lucro ${brl(c.lucro)} (${pct(c.margem)})`
          :`taxas ${brl(c.taxas)} · lucro ${brl(c.lucro)} por unidade`;
        return `<div class="chan"><span class="name">${esc(c.nome)}</span><span class="price num">${brl(c.sugerido)}</span>
          <span class="det">${lucroTxt}${c.lucroH!=null?` · ${brl(c.lucroH)}/h de impressora`:""}</span>
          ${c.real&&c.lucro<0?`<span class="det" style="color:var(--bad)">Seu preço dá prejuízo neste canal.</span>`:""}</div>`}).join("")}
    </div>
    ${hasInput?"":`<p class="note" style="margin:0">Preencha os gramas e o tempo para ver o custo real.</p>`}`;
}

/* ---------- foto ---------- */
function renderFoto(){
  if(!draft) return;
  const src=fotoSrc(draft);
  $("#fotoPrev").innerHTML=src?`<img src="${esc(src)}" alt="Foto do produto">`:"<span>Sem foto</span>";
  $("#fotoRm").hidden=!src;

}
function discardUnsavedFoto(){
  if(draft&&draft.fotoId&&draft.fotoId!==fotoOriginal){api("DELETE","/api/fotos/"+encodeURIComponent(draft.fotoId)).catch(()=>{})}
}
function shrink(file){
  return new Promise((res,rej)=>{
    const img=new Image(), u=URL.createObjectURL(file);
    img.onload=()=>{
      const max=1000, k=Math.min(1,max/Math.max(img.width,img.height));
      const c=document.createElement("canvas"); c.width=Math.round(img.width*k); c.height=Math.round(img.height*k);
      const g=c.getContext("2d"); g.fillStyle="#fff"; g.fillRect(0,0,c.width,c.height); g.drawImage(img,0,0,c.width,c.height);
      URL.revokeObjectURL(u);
      c.toBlob(b=>b?res(b):rej(new Error("conv")),"image/jpeg",0.85);
    };
    img.onerror=()=>{URL.revokeObjectURL(u);rej(new Error("img"))};
    img.src=u;
  });
}
async function setFoto(file){
  if(!draft||!file||!/^image\//.test(file.type)) return;
  const msg=$("#fotoMsg"); msg.textContent="Enviando foto…";
  try{
    const blob=await shrink(file);
    const fd=new FormData(); fd.append("foto",blob,"foto.jpg");
    const r=await api("POST","/api/fotos",fd);
    if(draft.fotoId&&draft.fotoId!==fotoOriginal) api("DELETE","/api/fotos/"+encodeURIComponent(draft.fotoId)).catch(()=>{});
    draft.fotoId=r.id;
    msg.textContent="Foto adicionada. Clique em Salvar para guardar.";
  }catch(e){
    msg.textContent=e&&e.status!==undefined?e.message:"Não deu para ler essa imagem. Tente outra (JPG ou PNG).";
  }
  renderFoto(); renderFicha();
}
$("#f-foto").addEventListener("change",e=>{const f=e.target.files&&e.target.files[0];e.target.value="";setFoto(f)});
$("#fotoBtn").addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();$("#f-foto").click()}});
$("#fotoRm").addEventListener("click",()=>{discardUnsavedFoto();draft.fotoId="";$("#fotoMsg").textContent="Foto removida. Clique em Salvar para confirmar.";renderFoto();renderFicha()});
document.addEventListener("paste",e=>{
  if(tab!=="novo"||!draft) return;
  const it=[...(e.clipboardData?.items||[])].find(i=>i.type.startsWith("image/"));
  if(it){e.preventDefault();setFoto(it.getAsFile())}
});

/* ---------- configuração ---------- */
const MAQ=[["tarifaKwh","Tarifa de energia","R$/kWh",0.01,"Na sua conta de luz, com impostos"],
  ["consumoW","Consumo médio da A1","W",1,"Em média uns 100 W imprimindo PLA"],
  ["valorImpressora","Valor pago na impressora","R$",1,""],
  ["vidaUtilH","Vida útil estimada","h",100,"Para dividir o custo da máquina"],
  ["manutencaoH","Manutenção por hora","R$/h",0.05,"Bicos, placas e peças de troca"]];
const NEG=[["falhaPct","Reserva para falhas","%",1,"Impressões perdidas e testes"],
  ["maoObraH","Valor da sua hora","R$/h",1,"Pós-processamento e embalagem"],
  ["impostoPct","Imposto sobre a venda","%",0.5,"MEI paga valor fixo: deixe 0"],
  ["margemPct","Margem de lucro padrão","%",1,"Sobre o preço de venda"]];
function fieldHTML([k,label,un,step,hint]){
  const pre=un==="R$";
  return `<label class="f">${label}${hint?`<span class="hint">${hint}</span>`:""}<div class="unit${pre?" pre":""}">${pre?"<span>R$</span>":""}<input type="number" step="${step}" min="0" id="cfg-${k}" data-k="${k}" value="${esc(cfg[k])}">${pre?"":`<span>${un}</span>`}</div></label>`;
}
function renderConfig(){
  $("#cfgMaquina").innerHTML=MAQ.map(fieldHTML).join("");
  $("#cfgNegocio").innerHTML=NEG.map(fieldHTML).join("");
  $("#cfgFil").innerHTML=cfg.filamentos.map((f,i)=>`<div class="fil-line" data-i="${i}">
    <input id="cf-n-${i}" data-f="nome" value="${esc(f.nome)}" aria-label="Nome do filamento">
    <div class="unit pre"><span>R$</span><input id="cf-p-${i}" data-f="precoKg" type="number" step="1" min="0" value="${esc(f.precoKg)}" aria-label="Preço por kg"></div>
    <button class="btn ghost edit-only" data-rmfil="${i}" aria-label="Remover filamento" ${cfg.filamentos.length<2?"disabled":""}>✕</button></div>`).join("");
  $("#cfgCanais").innerHTML=cfg.canais.map((c,i)=>`<tr data-i="${i}">
    <td><input id="cc-n-${i}" data-c="nome" value="${esc(c.nome)}" aria-label="Nome do canal"></td>
    <td class="n"><input id="cc-c-${i}" data-c="comissaoPct" type="number" step="0.5" min="0" value="${esc(c.comissaoPct)}" aria-label="Comissão"></td>
    <td class="n"><input id="cc-f-${i}" data-c="tarifaFixa" type="number" step="0.25" min="0" value="${esc(c.tarifaFixa)}" aria-label="Tarifa fixa"></td>
    <td class="n"><input id="cc-l-${i}" data-c="fixaAbaixoDe" type="number" step="1" min="0" value="${esc(c.fixaAbaixoDe)}" aria-label="Fixa abaixo de"></td>
    <td><button class="btn ghost edit-only" data-rmcanal="${i}" aria-label="Remover canal" ${cfg.canais.length<2?"disabled":""}>✕</button></td></tr>`).join("");
  if(!podeEditar()) $("#p-config").querySelectorAll("input").forEach(i=>i.disabled=true);
}
let saveT=null;
function saveCfg(){
  clearTimeout(saveT);
  saveT=setTimeout(async()=>{
    if(!podeEditar()) return;
    try{await api("PUT","/api/config",clone(cfg))}catch(e){toast(e.message)}
  },700);
  renderLista();
}
$("#p-config").addEventListener("input",e=>{
  const t=e.target;
  if(t.dataset.k){cfg[t.dataset.k]=num(t.value)}
  else if(t.dataset.f){const i=+t.closest("[data-i]").dataset.i;cfg.filamentos[i][t.dataset.f]=t.dataset.f==="nome"?t.value:num(t.value)}
  else if(t.dataset.c){const i=+t.closest("[data-i]").dataset.i;cfg.canais[i][t.dataset.c]=t.dataset.c==="nome"?t.value:num(t.value)}
  else return;
  saveCfg();
});
$("#p-config").addEventListener("click",e=>{
  const rf=e.target.closest("[data-rmfil]"), rc=e.target.closest("[data-rmcanal]");
  if(rf){cfg.filamentos.splice(+rf.dataset.rmfil,1);renderConfig();saveCfg()}
  if(rc){cfg.canais.splice(+rc.dataset.rmcanal,1);renderConfig();saveCfg()}
});
$("#btnAddFilCfg").addEventListener("click",()=>{cfg.filamentos.push({id:"f-"+uid(),nome:"Novo filamento",precoKg:100});renderConfig();saveCfg()});
$("#btnAddCanal").addEventListener("click",()=>{cfg.canais.push({id:"c-"+uid(),nome:"Novo canal",comissaoPct:0,tarifaFixa:0,fixaAbaixoDe:0});renderConfig();saveCfg()});

/* ---------- tendências ---------- */
const TRENDS=[
  {q:"name keychain",t:"Chaveiros personalizados com nome ou logo",cat:"Personalizados",faixa:"R$ 8 – 25",fil:"PLA 2–4 cores",dif:"Fácil",p:"Vendem muito em lote para festas, empresas e escolas. Use o AMS lite para letras em outra cor e imprima 10 a 20 por mesa.",g:"6–12 g",tempo:"15–30 min/un. em lote"},
  {q:"QR code sign",t:"Placas de Pix, Wi‑Fi e QR code",cat:"Personalizados",faixa:"R$ 25 – 60",fil:"PLA 2 cores",dif:"Fácil",p:"Muito procuradas por comércios, salões e restaurantes. O QR code em duas cores fica nítido e tem custo baixo.",g:"25–50 g",tempo:"1–2 h"},
  {q:"gridfinity",t:"Organizadores de mesa e gaveta (Gridfinity)",cat:"Casa e escritório",faixa:"R$ 25 – 90",fil:"PLA / PETG",dif:"Fácil",p:"Separadores de gaveta, porta-canetas e bandejas modulares. Dá para vender em kits e por medida.",g:"40–150 g",tempo:"2–5 h"},
  {q:"headset stand",t:"Suportes de headset, controle e celular",cat:"Setup gamer",faixa:"R$ 30 – 80",fil:"PLA Matte / PETG",dif:"Fácil",p:"O público gamer paga bem por acabamento fosco e cores combinando com o setup. Suportes para Alexa/Echo também vendem.",g:"60–150 g",tempo:"3–6 h"},
  {q:"vase",t:"Vasos e cachepôs decorativos",cat:"Decoração",faixa:"R$ 30 – 90",fil:"PLA Matte",dif:"Fácil",p:"Modelos ondulados, low-poly e em modo vaso imprimem rápido e com pouco material. Funcionam muito bem no Instagram.",g:"50–150 g",tempo:"2–5 h"},
  {q:"lithophane lamp",t:"Luminárias e litofanias com foto",cat:"Decoração",faixa:"R$ 60 – 150",fil:"PLA branco",dif:"Média",p:"Litofania com foto do cliente vende como presente (Dia das Mães, Natal, casamento). Fica mais lucrativa com base de LED.",g:"60–120 g",tempo:"4–8 h"},
  {q:"articulated dragon",t:"Brinquedos articulados e fidgets",cat:"Brinquedos",faixa:"R$ 20 – 90",fil:"PLA silk / multicor",dif:"Fácil",p:"Dragões, polvos e bichos articulados vendem bem para crianças e colecionadores. Só use modelos com licença comercial.",g:"30–200 g",tempo:"2–10 h"},
  {q:"cake topper",t:"Topos de bolo e lembrancinhas de festa",cat:"Festas",faixa:"R$ 20 – 60",fil:"PLA / PLA glitter",dif:"Fácil",p:"Topo de bolo com nome e idade, além de lembrancinhas personalizadas em quantidade. A demanda é constante.",g:"15–40 g",tempo:"1–2 h"},
  {q:"cookie cutter",t:"Cortadores de biscoito e carimbos de confeitaria",cat:"Cozinha",faixa:"R$ 10 – 35",fil:"PLA / PETG",dif:"Fácil",p:"Muito procurados por confeiteiras. Informe que é para contato rápido com a massa: o PLA comum não tem certificação alimentar.",g:"8–25 g",tempo:"30–60 min"},
  {q:"pet tag",t:"Acessórios para pets",cat:"Pets",faixa:"R$ 20 – 60",fil:"PETG",dif:"Fácil",p:"Porta-saquinho, plaquinhas com nome e telefone, e suportes de comedouro. As plaquinhas personalizadas têm ótima margem.",g:"10–80 g",tempo:"30 min–3 h"},
  {q:"replacement part",t:"Peças de reposição e adaptadores",cat:"Utilidades",faixa:"R$ 15 – 60",fil:"PETG",dif:"Média",p:"Botões, clipes, suportes de prateleira e tampas. Exige medir bem, mas tem pouca concorrência e o cliente aceita pagar mais.",g:"5–50 g",tempo:"30 min–2 h"},
  {q:"coaster",t:"Porta-copos e itens de cozinha temáticos",cat:"Casa e escritório",faixa:"R$ 30 – 70 (kit)",fil:"PLA multicor / TPU",dif:"Fácil",p:"Kits de porta-copos com suporte, temáticos ou com logo. Funcionam bem como presente corporativo.",g:"40–100 g",tempo:"2–4 h"}
];
let trendCat="Todas";
function renderTrends(){
  const cats=["Todas",...new Set(TRENDS.map(x=>x.cat))];
  $("#trendFilter").innerHTML=cats.map(c=>`<button class="btn ${c===trendCat?"primary":""}" data-cat="${esc(c)}" style="padding:6px 12px">${esc(c)}</button>`).join("");
  $("#trends").innerHTML=TRENDS.filter(x=>trendCat==="Todas"||x.cat===trendCat).map((x,i)=>`<article class="trend">
    <div class="meta"><span class="pill acc">${esc(x.cat)}</span><span class="pill">${esc(x.fil)}</span><span class="pill ${x.dif==="Fácil"?"good":""}">${esc(x.dif)}</span></div>
    <div class="t">${esc(x.t)}</div><p>${esc(x.p)}</p>
    <p class="num" style="font-size:12px">Típico: ${esc(x.g)} · ${esc(x.tempo)}</p>
    <div class="src"><a href="https://makerworld.com/pt/search/models?keyword=${encodeURIComponent(x.q)}" target="_blank" rel="noopener">Modelos no MakerWorld ↗</a><a href="https://www.printables.com/search/models?q=${encodeURIComponent(x.q)}" target="_blank" rel="noopener">Printables ↗</a></div>
    <div class="foot"><span class="faixa">${esc(x.faixa)}</span><button class="btn edit-only" data-trend="${TRENDS.indexOf(x)}">Cadastrar</button></div></article>`).join("");
}
$("#trendFilter").addEventListener("click",e=>{const b=e.target.closest("[data-cat]");if(!b)return;trendCat=b.dataset.cat;renderTrends()});
$("#trends").addEventListener("click",e=>{const b=e.target.closest("[data-trend]");if(!b)return;const x=TRENDS[+b.dataset.trend];
  const p=blank();p.nome=x.t;p.categoria=x.cat;startForm(p);setTab("novo");$("#f-nome").select()});

/* ---------- dados ---------- */
function mergeCfg(d){
  const c=clone(DEFAULTS);
  for(const k of Object.keys(c)) if(d&&d[k]!==undefined) c[k]=d[k];
  if(!Array.isArray(c.filamentos)||!c.filamentos.length) c.filamentos=clone(DEFAULTS.filamentos);
  if(!Array.isArray(c.canais)||!c.canais.length) c.canais=clone(DEFAULTS.canais);
  return c;
}
function refreshAll(){
  renderLista();
  if(tab==="config"&&!$("#p-config").contains(document.activeElement)) renderConfig();
  if(tab==="novo"&&draft){ if(!$("#form").contains(document.activeElement)) renderFilLines(); renderFicha(); }
}

/* ---------- financeiro ---------- */
const hojeISO=()=>{const d=new Date();return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10)};
let finMes=hojeISO().slice(0,7), fin=null, finForm=null;
const MESES=["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
const nomeMes=(k,curto)=>{const [a,m]=k.split("-").map(Number);return curto?MESES[m-1].slice(0,3):`${MESES[m-1]} de ${a}`};
const cap=s=>s.charAt(0).toUpperCase()+s.slice(1);
const pl=(n,s,p)=>`${n.toLocaleString("pt-BR")} ${n===1?s:p}`;
const addMes=(k,d)=>{const [a,m]=k.split("-").map(Number);const x=new Date(Date.UTC(a,m-1+d,1));return x.toISOString().slice(0,7)};
const dataBRc=s=>s?s.split("-").reverse().join("/"):"";
const CAT_SAIDA=["Filamento","Energia","Embalagem","Peças e manutenção","Frete e correios","Marketing e anúncios","Taxas e impostos","Equipamentos","Outros"];
const CAT_ENTRADA=["Venda avulsa","Aporte","Reembolso","Outros"];
const vendaTot=v=>{const bruto=v.quantidade*v.preco_unit, liq=bruto-v.taxas-v.frete, custo=v.quantidade*v.custo_unit;return {bruto,liq,custo,lucro:liq-custo}};

async function carregaFin(){
  try{ fin=await api("GET","/api/financeiro?mes="+finMes); renderFin() }catch(e){ if(e.status!==401) toast(e.message) }
}
function renderFin(){
  $("#finMes").textContent=cap(nomeMes(finMes));
  $("#finCsv").href="/api/financeiro/csv?mes="+finMes;
  if(!fin) return;
  const vs=fin.vendas, ls=fin.lancamentos;
  let entradas=0,saidas=0,lucro=0,pecas=0,receber=0,pagar=0,bruto=0;
  for(const v of vs){const t=vendaTot(v); if(v.status==="pago"){entradas+=t.liq;lucro+=t.lucro;pecas+=v.quantidade;bruto+=t.bruto} else receber+=t.liq}
  for(const l of ls){ if(l.status==="pago"){ if(l.tipo==="entrada") entradas+=l.valor; else saidas+=l.valor } else { if(l.tipo==="entrada") receber+=l.valor; else pagar+=l.valor } }
  const saldo=entradas-saidas, acumulado=fin.saldoAnterior+saldo;
  $("#finTiles").innerHTML=`
    <div class="tile"><span class="tl">Entradas</span><span class="tv num">${brl(entradas)}</span><span class="ts">${pl(vs.filter(v=>v.status==="pago").length,"venda","vendas")} · ${pl(pecas,"peça","peças")}</span></div>
    <div class="tile"><span class="tl">Saídas</span><span class="tv num">${brl(saidas)}</span><span class="ts">${pl(ls.filter(l=>l.tipo==="saida"&&l.status==="pago").length,"despesa paga","despesas pagas")}</span></div>
    <div class="tile main"><span class="tl">Saldo do mês</span><span class="tv num ${saldo<0?"neg":"pos"}">${brl(saldo)}</span><span class="ts">Acumulado: ${brl(acumulado)}</span></div>
    <div class="tile"><span class="tl">Lucro das vendas</span><span class="tv num">${brl(lucro)}</span><span class="ts">${bruto>0?pct(lucro/bruto)+" do faturado":"sem vendas pagas"}</span></div>
    <div class="tile"><span class="tl">A receber</span><span class="tv num sm">${brl(receber)}</span><span class="ts">vendas e receitas pendentes</span></div>
    <div class="tile"><span class="tl">A pagar</span><span class="tv num sm">${brl(pagar)}</span><span class="ts">despesas pendentes</span></div>`;
  renderFinChart();
  // categorias de despesa
  const cats={}; for(const l of ls) if(l.tipo==="saida") cats[l.categoria]=(cats[l.categoria]||0)+l.valor;
  const ce=Object.entries(cats).sort((a,b)=>b[1]-a[1]); const cmax=Math.max(1,...ce.map(x=>x[1]));
  $("#finCats").innerHTML=ce.length?ce.map(([c,v])=>`<div class="hb" title="${esc(c)}: ${brl(v)}"><span class="hbl">${esc(c)}</span><span class="hbt"><i style="width:${v/cmax*100}%"></i></span><span class="hbv num">${brl(v)}</span></div>`).join(""):`<p class="note">Nenhuma despesa neste mês.</p>`;
  // mais vendidos
  const top={}; for(const v of vs){const k=v.descricao;top[k]=top[k]||{q:0,l:0};top[k].q+=v.quantidade;top[k].l+=vendaTot(v).lucro}
  const te=Object.entries(top).sort((a,b)=>b[1].q-a[1].q).slice(0,6);
  $("#finTop").innerHTML=te.length?`<table class="mini"><thead><tr><th>Produto</th><th class="n">Qtd</th><th class="n">Lucro</th></tr></thead><tbody>${te.map(([k,x])=>`<tr><td>${esc(k)}</td><td class="n">${x.q.toLocaleString("pt-BR")}</td><td class="n">${brl(x.l)}</td></tr>`).join("")}</tbody></table>`:`<p class="note">Nenhuma venda neste mês.</p>`;
  // lista
  const itens=[...vs.map(v=>({k:"venda",d:v.data,o:v})),...ls.map(l=>({k:l.tipo,d:l.data,o:l}))].sort((a,b)=>a.d<b.d?1:a.d>b.d?-1:0);
  $("#finLista").innerHTML=itens.length?`<div class="tablewrap"><table style="min-width:720px"><thead><tr><th>Data</th><th>Descrição</th><th>Categoria / canal</th><th class="n">Valor</th><th>Situação</th><th class="edit-only"></th></tr></thead><tbody>
  ${itens.map(({k,o})=>{
    let desc,cat,val,sub="";
    if(k==="venda"){const t=vendaTot(o);desc=`${esc(o.descricao)}${o.quantidade!==1?` <span class="pcat">× ${o.quantidade.toLocaleString("pt-BR")}</span>`:""}`;cat=`<span class="pill">Venda</span> ${esc(o.canal||"")}`;val=t.liq;sub=`<div class="pcat">lucro ${brl(t.lucro)}${o.cliente?" · "+esc(o.cliente):""}</div>`}
    else{desc=esc(o.descricao);cat=esc(o.categoria);val=k==="entrada"?o.valor:-o.valor}
    const pend=o.status==="pendente";
    const stTxt=pend?(val>=0?"A receber":"A pagar"):(val>=0?"Recebido":"Pago");
    return `<tr data-fk="${k}" data-fid="${esc(o.id)}"><td class="num">${dataBRc(o.data)}</td><td><div class="pname">${desc}</div>${sub}</td><td>${cat}</td>
      <td class="n ${val<0?"neg":"pos"}">${val<0?"− ":"+ "}${brl(Math.abs(val))}</td>
      <td><span class="pill ${pend?"":"good"}">${stTxt}</span></td>
      <td class="edit-only fact" style="white-space:nowrap;text-align:right">${pend?'<button class="btn ghost" data-fa="quitar">Quitar</button>':""}<button class="btn ghost" data-fa="edit">Editar</button><button class="btn ghost" data-fa="del">Excluir</button></td></tr>`}).join("")}
  </tbody></table></div>`:`<div class="card empty"><h2>Nada lançado em ${nomeMes(finMes)}</h2><p>Registre uma venda, uma despesa (filamento, luz, embalagem) ou uma receita para acompanhar o mês.</p></div>`;
}
function renderFinChart(){
  const s=fin.serie, W=Math.max(320,Math.round($("#finChartWrap").clientWidth||720)), H=W<560?200:240, pl=56, pr=8, pt=12, pb=28;
  const max=Math.max(1,...s.flatMap(x=>[x.entradas,x.saidas]));
  const nice=v=>{const p=Math.pow(10,Math.floor(Math.log10(v)));const m=v/p;return (m<=1?1:m<=2?2:m<=5?5:10)*p};
  const top=nice(max), steps=4, gw=(W-pl-pr)/s.length, bw=Math.min(18,(gw-10)/2);
  const y=v=>pt+(H-pt-pb)*(1-v/top);
  let g="";
  for(let i=0;i<=steps;i++){const v=top*i/steps;g+=`<line x1="${pl}" x2="${W-pr}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${pl-6}" y="${y(v)+4}" class="ax" text-anchor="end">${v>=1000?(v/1000).toLocaleString("pt-BR")+" mil":v.toLocaleString("pt-BR")}</text>`}
  const bar=(x,v,cls)=>{const h=Math.max(0,y(0)-y(v));if(h<=0)return "";const r=Math.min(4,h,bw/2);const yt=y(v);
    return `<path class="${cls}" d="M${x},${y(0)} V${yt+r} Q${x},${yt} ${x+r},${yt} H${x+bw-r} Q${x+bw},${yt} ${x+bw},${yt+r} V${y(0)} Z"/>`};
  s.forEach((m,i)=>{const cx=pl+gw*i+gw/2;const cur=m.mes===finMes;
    g+=`<g class="col${cur?" cur":""}" data-i="${i}"><rect x="${pl+gw*i}" y="${pt}" width="${gw}" height="${H-pt-pb}" class="hit"/>${bar(cx-bw-1,m.entradas,"b-in")}${bar(cx+1,m.saidas,"b-out")}${(W>=560||i%2===1)?`<text x="${cx}" y="${H-8}" class="ax${cur?" axc":""}" text-anchor="middle">${nomeMes(m.mes,true)}</text>`:""}</g>`});
  g+=`<line x1="${pl}" x2="${W-pr}" y1="${y(0)}" y2="${y(0)}" class="base"/>`;
  $("#finChart").innerHTML=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Entradas e saídas dos últimos 12 meses">${g}</svg>`;
  $("#finTable").innerHTML=`<table class="mini"><thead><tr><th>Mês</th><th class="n">Entradas</th><th class="n">Saídas</th><th class="n">Saldo</th><th class="n">Lucro vendas</th></tr></thead><tbody>${s.slice().reverse().map(m=>`<tr><td>${nomeMes(m.mes)}</td><td class="n">${brl(m.entradas)}</td><td class="n">${brl(m.saidas)}</td><td class="n">${brl(m.entradas-m.saidas)}</td><td class="n">${brl(m.lucroVendas)}</td></tr>`).join("")}</tbody></table>`;
}
const tip=$("#finTip");
$("#finChart").addEventListener("pointermove",e=>{
  const c=e.target.closest(".col"); if(!c||!fin){tip.hidden=true;return}
  const m=fin.serie[+c.dataset.i]; const box=$("#finChartWrap").getBoundingClientRect();
  tip.innerHTML=`<b>${cap(nomeMes(m.mes))}</b><span><i class="sw in"></i>Entradas <b class="num">${brl(m.entradas)}</b></span><span><i class="sw out"></i>Saídas <b class="num">${brl(m.saidas)}</b></span><span>Saldo <b class="num">${brl(m.entradas-m.saidas)}</b></span>`;
  tip.hidden=false; const x=Math.min(e.clientX-box.left+12, box.width-190); tip.style.left=Math.max(0,x)+"px"; tip.style.top=(e.clientY-box.top-10)+"px";
});
let rzT;window.addEventListener("resize",()=>{clearTimeout(rzT);rzT=setTimeout(()=>{if(fin&&tab==="financeiro")renderFinChart()},150)});
$("#finChart").addEventListener("pointerleave",()=>tip.hidden=true);
$("#finChart").addEventListener("click",e=>{const c=e.target.closest(".col");if(!c)return;finMes=fin.serie[+c.dataset.i].mes;carregaFin()});
$("#finPrev").addEventListener("click",()=>{finMes=addMes(finMes,-1);fin=null;renderFin();carregaFin()});
$("#finNext").addEventListener("click",()=>{finMes=addMes(finMes,1);fin=null;renderFin();carregaFin()});
$("#finHoje").addEventListener("click",()=>{finMes=hojeISO().slice(0,7);carregaFin()});
$("#finTabela").addEventListener("click",()=>{const t=$("#finTable");t.hidden=!t.hidden;$("#finTabela").textContent=t.hidden?"Ver como tabela":"Esconder tabela"});
document.querySelectorAll("[data-novo]").forEach(b=>b.addEventListener("click",()=>abreForm(b.dataset.novo)));

/* formulário de venda / lançamento */
function opcoesCanal(sel){return cfg.canais.map(c=>`<option value="${esc(c.nome)}"${c.nome===sel?" selected":""}>${esc(c.nome)}</option>`).join("")}
function abreForm(tipo,o){
  o=o||{}; finForm={tipo,id:o.id||null,taxaManual:!!o.id,custoManual:!!o.id,precoManual:!!o.id};
  const box=$("#finForm"); box.hidden=false;
  const data=o.data||(finMes===hojeISO().slice(0,7)?hojeISO():finMes+"-01");
  const st=o.status||"pago";
  if(tipo==="venda"){
    const prodOpts=`<option value="">Outro (digitar)</option>`+produtos.slice().sort((a,b)=>a.nome.localeCompare(b.nome)).map(p=>`<option value="${esc(p.id)}"${p.id===o.produto_id?" selected":""}>${esc(p.nome)}</option>`).join("");
    box.innerHTML=`<form class="stack" id="ffVenda" autocomplete="off">
      <div class="row spread"><h2>${o.id?"Editar venda":"Registrar venda"}</h2><button type="button" class="btn ghost" data-ff="fechar">Fechar</button></div>
      <div class="fields">
        <label class="f">Data<input type="date" id="fv-data" required value="${esc(data)}"></label>
        <label class="f">Produto<select id="fv-prod">${prodOpts}</select></label>
        <label class="f">Descrição<input id="fv-desc" required maxlength="150" value="${esc(o.descricao||"")}"></label>
        <label class="f">Quantidade<input id="fv-qtd" type="number" min="1" step="1" value="${esc(o.quantidade||1)}"></label>
        <label class="f">Canal<select id="fv-canal">${opcoesCanal(o.canal||cfg.canais[0]?.nome)}</select></label>
        <label class="f">Preço por unidade<div class="unit pre"><span>R$</span><input id="fv-preco" type="number" min="0" step="0.01" value="${esc(o.preco_unit??"")}"></div></label>
        <label class="f">Taxas da plataforma<span class="hint">Calculada pelo canal; pode ajustar</span><div class="unit pre"><span>R$</span><input id="fv-taxas" type="number" min="0" step="0.01" value="${esc(o.taxas??0)}"></div></label>
        <label class="f">Frete pago por você<div class="unit pre"><span>R$</span><input id="fv-frete" type="number" min="0" step="0.01" value="${esc(o.frete??0)}"></div></label>
        <label class="f">Custo por unidade<span class="hint">Vem do cadastro do produto</span><div class="unit pre"><span>R$</span><input id="fv-custo" type="number" min="0" step="0.01" value="${esc(o.custo_unit??0)}"></div></label>
        <label class="f">Cliente<span class="hint">Opcional</span><input id="fv-cliente" maxlength="120" value="${esc(o.cliente||"")}"></label>
        <label class="f">Situação<select id="fv-status"><option value="pago"${st==="pago"?" selected":""}>Recebido</option><option value="pendente"${st==="pendente"?" selected":""}>A receber</option></select></label>
        <label class="f">Observação<input id="fv-obs" maxlength="500" value="${esc(o.obs||"")}"></label>
      </div>
      <div class="vresumo" id="fvResumo"></div>
      <div class="row"><button class="btn primary" type="submit">${o.id?"Salvar alterações":"Registrar venda"}</button><span class="note" id="ffMsg"></span></div>
    </form>`;
    if(!o.id&&o.produto_id) aplicaProduto();
    atualizaVenda();
  }else{
    const cats=tipo==="saida"?CAT_SAIDA:CAT_ENTRADA, ent=tipo==="entrada";
    box.innerHTML=`<form class="stack" id="ffLanc" autocomplete="off">
      <div class="row spread"><h2>${o.id?"Editar":"Nova"} ${ent?"receita":"despesa"}</h2><button type="button" class="btn ghost" data-ff="fechar">Fechar</button></div>
      <div class="fields">
        <label class="f">Data<input type="date" id="fl-data" required value="${esc(data)}"></label>
        <label class="f">Descrição<input id="fl-desc" required maxlength="150" placeholder="${ent?"Ex.: venda na feira":"Ex.: 2 rolos PLA preto"}" value="${esc(o.descricao||"")}"></label>
        <label class="f">Categoria<select id="fl-cat">${cats.map(c=>`<option${c===o.categoria?" selected":""}>${c}</option>`).join("")}</select></label>
        <label class="f">Valor<div class="unit pre"><span>R$</span><input id="fl-valor" type="number" min="0.01" step="0.01" required value="${esc(o.valor??"")}"></div></label>
        <label class="f">Situação<select id="fl-status"><option value="pago"${st==="pago"?" selected":""}>${ent?"Recebido":"Pago"}</option><option value="pendente"${st==="pendente"?" selected":""}>${ent?"A receber":"A pagar"}</option></select></label>
        <label class="f">Observação<input id="fl-obs" maxlength="500" value="${esc(o.obs||"")}"></label>
      </div>
      <div class="row"><button class="btn primary" type="submit">Salvar</button><span class="note" id="ffMsg"></span></div>
    </form>`;
  }
  box.scrollIntoView({behavior:"smooth",block:"start"});
  box.querySelector("input:not([type=date]),select")?.focus();
}
function canalSel(){return cfg.canais.find(c=>c.nome===$("#fv-canal").value)||cfg.canais[0]}
function aplicaProduto(){
  const p=produtos.find(x=>x.id===$("#fv-prod").value); if(!p) return;
  const r=calc(p); $("#fv-desc").value=p.nome;
  if(!finForm.custoManual) $("#fv-custo").value=r.custo.toFixed(2);
  if(!finForm.precoManual){const ch=r.canais.find(c=>c.nome===canalSel()?.nome);const pr=num(p.precoVenda)>0?num(p.precoVenda):ch?.sugerido;if(pr)$("#fv-preco").value=pr.toFixed(2)}
}
function atualizaVenda(){
  if(!finForm||finForm.tipo!=="venda") return;
  const q=num($("#fv-qtd").value), pr=num($("#fv-preco").value), c=canalSel();
  if(!finForm.taxaManual&&c){const lim=num(c.fixaAbaixoDe);const fixa=(lim>0&&pr>=lim)?0:num(c.tarifaFixa);$("#fv-taxas").value=(q*(pr*num(c.comissaoPct)/100+fixa)+q*pr*num(cfg.impostoPct)/100).toFixed(2)}
  const t=vendaTot({quantidade:q,preco_unit:pr,taxas:num($("#fv-taxas").value),frete:num($("#fv-frete").value),custo_unit:num($("#fv-custo").value)});
  $("#fvResumo").innerHTML=`<span>Total <b class="num">${brl(t.bruto)}</b></span><span>Você recebe <b class="num">${brl(t.liq)}</b></span><span>Lucro <b class="num ${t.lucro<0?"neg":"pos"}">${brl(t.lucro)}</b></span>`;
}
$("#finForm").addEventListener("input",e=>{
  if(!finForm) return; const id=e.target.id;
  if(id==="fv-taxas") finForm.taxaManual=true;
  if(id==="fv-custo") finForm.custoManual=true;
  if(id==="fv-preco") finForm.precoManual=true;
  if(id==="fv-prod"){finForm.custoManual=false;finForm.precoManual=false;aplicaProduto()}
  if(id==="fv-canal"&&!finForm.precoManual) aplicaProduto();
  atualizaVenda();
});
$("#finForm").addEventListener("change",e=>{ if(e.target.id==="fv-prod"||e.target.id==="fv-canal"){ if(e.target.id==="fv-prod"){finForm.custoManual=false;finForm.precoManual=false} aplicaProduto(); atualizaVenda() } });
$("#finForm").addEventListener("click",e=>{ if(e.target.closest('[data-ff="fechar"]')) fechaForm() });
function fechaForm(){finForm=null;$("#finForm").hidden=true;$("#finForm").innerHTML=""}
$("#finForm").addEventListener("submit",async e=>{
  e.preventDefault(); const m=$("#ffMsg"); const btn=e.submitter; if(btn) btn.disabled=true;
  try{
    let body,url;
    if(finForm.tipo==="venda"){
      body={data:$("#fv-data").value,produto_id:$("#fv-prod").value||null,descricao:$("#fv-desc").value,quantidade:num($("#fv-qtd").value),preco_unit:num($("#fv-preco").value),canal:$("#fv-canal").value,taxas:num($("#fv-taxas").value),frete:num($("#fv-frete").value),custo_unit:num($("#fv-custo").value),cliente:$("#fv-cliente").value,status:$("#fv-status").value,obs:$("#fv-obs").value};
      url="/api/vendas";
    }else{
      body={data:$("#fl-data").value,tipo:finForm.tipo,descricao:$("#fl-desc").value,categoria:$("#fl-cat").value,valor:num($("#fl-valor").value),status:$("#fl-status").value,obs:$("#fl-obs").value};
      url="/api/lancamentos";
    }
    if(finForm.id) await api("PUT",url+"/"+encodeURIComponent(finForm.id),body); else await api("POST",url,body);
    toast(finForm.tipo==="venda"?"Venda registrada":"Lançamento salvo");
    const mesNovo=body.data.slice(0,7); fechaForm(); finMes=mesNovo; carregaFin();
  }catch(err){ m.textContent=err.message } finally{ if(btn) btn.disabled=false }
});
$("#finLista").addEventListener("click",async e=>{
  const b=e.target.closest("[data-fa]"); if(!b) return;
  const tr=b.closest("[data-fid]"), k=tr.dataset.fk, id=tr.dataset.fid;
  const o=(k==="venda"?fin.vendas:fin.lancamentos).find(x=>x.id===id); if(!o) return;
  const url=(k==="venda"?"/api/vendas/":"/api/lancamentos/")+encodeURIComponent(id);
  const a=b.dataset.fa;
  if(a==="edit") abreForm(k==="venda"?"venda":o.tipo,o);
  if(a==="quitar"){ try{ await api("PUT",url,{...o,status:"pago"}); toast("Marcado como quitado"); carregaFin() }catch(err){ toast(err.message) } }
  if(a==="del") tr.querySelector(".fact").innerHTML=`<span class="confirm">Excluir? <button class="btn danger" data-fa="delok">Excluir</button><button class="btn ghost" data-fa="no">Manter</button></span>`;
  if(a==="no") renderFin();
  if(a==="delok"){ try{ await api("DELETE",url); toast("Excluído"); carregaFin() }catch(err){ toast(err.message) } }
});

/* ---------- login ---------- */
function showAuth(){
  $("#appScreen").hidden=true; $("#authScreen").hidden=false;
  $("#authLoading").hidden=true;
  api("GET","/api/estado").then(e=>{
    $("#formSetup").hidden=e.temUsuarios; $("#formLogin").hidden=!e.temUsuarios;
    (e.temUsuarios?$("#lg-usuario"):$("#st-nome")).focus();
  }).catch(err=>{$("#authLoading").hidden=false;$("#authLoading").textContent=err.message});
}
async function showApp(){
  $("#authScreen").hidden=true; $("#appScreen").hidden=false;
  document.body.classList.toggle("ro",!podeEditar());
  $("#tab-usuarios").hidden=me.papel!=="admin";
  renderUserChip();
  let t=null; try{t=localStorage.getItem("prec3d.tab")}catch(e){}
  if(!t||t==="novo"||(t==="usuarios"&&me.papel!=="admin")||!$("#p-"+t)) t="produtos";
  setTab(t);
  await carregaDados();
}
async function carregaDados(){
  try{
    const [c,ps]=await Promise.all([api("GET","/api/config"),api("GET","/api/produtos")]);
    cfg=mergeCfg(c); produtos=ps.filter(p=>p&&p.nome); carregado=true; refreshAll();
  }catch(e){ if(e.status!==401) toast(e.message) }
}
$("#formLogin").addEventListener("submit",async e=>{
  e.preventDefault(); $("#lgErr").textContent="";
  const btn=e.submitter; if(btn) btn.disabled=true;
  try{ const r=await api("POST","/api/login",{usuario:$("#lg-usuario").value.trim(),senha:$("#lg-senha").value}); me=r.usuario; $("#lg-senha").value=""; await showApp() }
  catch(err){ $("#lgErr").textContent=err.message; $("#lg-senha").select() }
  finally{ if(btn) btn.disabled=false }
});
$("#formSetup").addEventListener("submit",async e=>{
  e.preventDefault(); $("#stErr").textContent="";
  if($("#st-senha").value!==$("#st-senha2").value){$("#stErr").textContent="As duas senhas não são iguais.";return}
  try{ const r=await api("POST","/api/primeiro-acesso",{nome:$("#st-nome").value.trim(),usuario:$("#st-usuario").value.trim(),senha:$("#st-senha").value}); me=r.usuario; await showApp() }
  catch(err){ $("#stErr").textContent=err.message }
});
$("#formSenha").addEventListener("submit",async e=>{
  e.preventDefault(); const m=$("#msMsg");
  if($("#ms-nova").value!==$("#ms-nova2").value){m.textContent="As duas senhas novas não são iguais.";return}
  try{ await api("POST","/api/minha-senha",{atual:$("#ms-atual").value,nova:$("#ms-nova").value}); e.target.reset(); m.textContent="Senha trocada. Outros aparelhos conectados foram desconectados." }
  catch(err){ m.textContent=err.message }
});

/* ---------- usuários ---------- */
let usuarios=[];
async function carregaUsuarios(){
  if(!me||me.papel!=="admin") return;
  try{ usuarios=await api("GET","/api/usuarios"); renderUsuarios() }catch(e){ toast(e.message) }
}
const dataBR=s=>s?new Date(s.replace(" ","T")+"Z").toLocaleString("pt-BR",{dateStyle:"short",timeStyle:"short"}):"nunca";
function renderUsuarios(){
  $("#listaUsuarios").innerHTML=`<div class="tablewrap"><table style="min-width:640px"><thead><tr><th>Nome</th><th>Usuário</th><th>Acesso</th><th>Último acesso</th><th></th></tr></thead><tbody>
  ${usuarios.map(u=>`<tr data-uid="${u.id}">
    <td class="pname">${esc(u.nome)}${u.id===me.id?' <span class="pill acc">você</span>':""}</td>
    <td class="num">${esc(u.usuario)}</td>
    <td><select id="pp-${u.id}" data-papel style="width:auto" ${u.id===me.id?"disabled":""}>${Object.entries(PAPEL_NOME).map(([k,v])=>`<option value="${k}"${k===u.papel?" selected":""}>${v}</option>`).join("")}</select></td>
    <td class="num" style="font-size:13px">${esc(dataBR(u.ultimo_login))}</td>
    <td style="white-space:nowrap;text-align:right" class="uact">
      <button class="btn ghost" data-uact="senha">Nova senha</button>
      ${u.id===me.id?"":'<button class="btn ghost" data-uact="del">Excluir</button>'}</td></tr>`).join("")}
  </tbody></table></div>`;
}
$("#listaUsuarios").addEventListener("change",async e=>{
  const s=e.target.closest("[data-papel]"); if(!s) return;
  const id=+s.closest("[data-uid]").dataset.uid;
  try{ await api("PATCH","/api/usuarios/"+id,{papel:s.value}); toast("Acesso alterado") }catch(err){ toast(err.message) }
  carregaUsuarios();
});
$("#listaUsuarios").addEventListener("click",async e=>{
  const b=e.target.closest("[data-uact]"); if(!b) return;
  const tr=b.closest("[data-uid]"), id=+tr.dataset.uid, u=usuarios.find(x=>x.id===id), cell=tr.querySelector(".uact");
  const a=b.dataset.uact;
  if(a==="senha"){
    cell.innerHTML=`<span class="confirm"><input type="password" id="np-${id}" placeholder="Nova senha (8+)" minlength="8" style="width:170px" autocomplete="new-password"><button class="btn primary" data-uact="senhaok">Salvar</button><button class="btn ghost" data-uact="cancel">Cancelar</button></span>`;
    cell.querySelector("input").focus();
  }
  if(a==="senhaok"){
    const v=cell.querySelector("input").value;
    try{ await api("PATCH","/api/usuarios/"+id,{senha:v}); toast("Senha de "+u.nome+" alterada"); renderUsuarios() }catch(err){ toast(err.message) }
  }
  if(a==="del") cell.innerHTML=`<span class="confirm">Excluir ${esc(u.nome)}? <button class="btn danger" data-uact="delok">Excluir</button><button class="btn ghost" data-uact="cancel">Manter</button></span>`;
  if(a==="delok"){ try{ await api("DELETE","/api/usuarios/"+id); toast("Usuário excluído") }catch(err){ toast(err.message) } carregaUsuarios() }
  if(a==="cancel") renderUsuarios();
});
$("#formUser").addEventListener("submit",async e=>{
  e.preventDefault(); const m=$("#nuMsg");
  try{
    await api("POST","/api/usuarios",{nome:$("#nu-nome").value.trim(),usuario:$("#nu-usuario").value.trim(),senha:$("#nu-senha").value,papel:$("#nu-papel").value});
    m.textContent="Pessoa adicionada. Passe o usuário e a senha inicial para ela."; e.target.reset(); carregaUsuarios();
  }catch(err){ m.textContent=err.message }
});

async function boot(){
  try{const s=localStorage.getItem("prec3d.sort");if(s)$("#sortBy").value=s}catch(e){}
  renderTrends();
  try{
    const e=await api("GET","/api/estado");
    if(e.usuario){ me=e.usuario; await showApp() } else showAuth();
  }catch(err){ $("#authScreen").hidden=false; $("#authLoading").textContent=err.message }
}
document.addEventListener("visibilitychange",()=>{ if(!document.hidden&&me&&!draft) carregaDados() });
boot();
})();

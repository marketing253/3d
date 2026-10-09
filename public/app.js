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
  loja:{nome:"",whatsapp:"",instagram:"",pagamento:"Pix, cartão ou dinheiro",prazoDias:5,horasDia:16,sobre:""},
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
  ["produtos","pedidos","fila","estoque","financeiro","novo","tendencias","config","usuarios","conta"].forEach(x=>{$("#p-"+x).hidden=x!==t});
  try{localStorage.setItem("prec3d.tab",t)}catch(e){}
  const tb=$("#tab-"+t); if(tb) $("#pageTitle").textContent=tb.textContent.trim();
  document.body.classList.remove("navopen"); $("#menuBtn").setAttribute("aria-expanded","false");
  if(t==="config") renderConfig();
  if(t==="usuarios") carregaUsuarios();
  if(t==="financeiro") carregaFin();
  if(t==="pedidos"||t==="fila") carregaPedidos();
  if(t==="estoque") carregaRolos();
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

$("#menuBtn").addEventListener("click",()=>{const o=document.body.classList.toggle("navopen");$("#menuBtn").setAttribute("aria-expanded",String(o))});
$("#scrim").addEventListener("click",()=>{document.body.classList.remove("navopen");$("#menuBtn").setAttribute("aria-expanded","false")});
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
        <div style="min-width:0"><div class="pname">${esc(p.nome)}</div><div class="pcat">${esc(p.categoria||"Sem categoria")}${r.uni>1?` · ${r.uni} por mesa`:""}${num(p.estoque)>0?` · <span class="pill good">${num(p.estoque)} pronto${num(p.estoque)>1?"s":""}</span>`:""}${p.catalogo?` <span class="pill acc">catálogo</span>`:""}${safeUrl(p.linkModelo)?`<br><a href="${esc(safeUrl(p.linkModelo))}" target="_blank" rel="noopener">abrir modelo ↗</a>`:""}</div></div></div></td>
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
function blank(){return {nome:"",categoria:"",unidades:1,filamentos:[{filId:cfg.filamentos[0]?.id||"",gramas:""}],horas:0,minutos:0,manualMin:5,embalagem:0,outros:0,margemPct:"",precoVenda:"",linkModelo:"",fotoId:"",catalogo:false,personalizavel:false,descricaoCatalogo:"",precoCatalogo:"",estoque:0}}
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
  $("#f-catshow").checked=!!draft.catalogo; $("#f-pers").checked=!!draft.personalizavel;
  $("#f-catdesc").value=draft.descricaoCatalogo||""; $("#f-catpreco").value=draft.precoCatalogo??""; $("#f-estoque").value=draft.estoque||0;
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
  draft.catalogo=$("#f-catshow").checked; draft.personalizavel=$("#f-pers").checked;
  draft.descricaoCatalogo=$("#f-catdesc").value.trim(); draft.precoCatalogo=$("#f-catpreco").value===""?"":num($("#f-catpreco").value);
  draft.estoque=Math.max(0,Math.round(num($("#f-estoque").value)));
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
  if(body.catalogo&&!(num(body.precoCatalogo)>0)){const r0=calc(body);body.precoCatalogo=num(body.precoVenda)>0?num(body.precoVenda):(r0.canais[0]?.sugerido||"")}
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
  {const ph=num(draft.precoVenda)>0?num(draft.precoVenda):r.canais[0]?.sugerido;$("#f-catpreco").placeholder=ph?ph.toFixed(2):"—";}
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
  renderLoja();
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
  c.loja={...clone(DEFAULTS.loja),...(d&&d.loja||{})};
  return c;
}
function refreshAll(){
  renderLista();
  if(tab==="config"&&!$("#p-config").contains(document.activeElement)) renderConfig();
  if(tab==="novo"&&draft){ if(!$("#form").contains(document.activeElement)) renderFilLines(); renderFicha(); }
}


/* ---------- utilidades de pedido ---------- */
const ST={orcamento:"Orçamento",aprovado:"Aprovado",imprimindo:"Imprimindo",pronto:"Pronto",entregue:"Entregue",cancelado:"Cancelado"};
const ST_NEXT={orcamento:["aprovado","Aprovar"],aprovado:["imprimindo","Começar a imprimir"],imprimindo:["pronto","Marcar pronto"],pronto:["entregue","Entregar"]};
const ST_CLS={orcamento:"",aprovado:"acc",imprimindo:"warn",pronto:"good",entregue:"good",cancelado:"bad"};
const addDias=(iso,d)=>{const x=new Date(iso+"T12:00:00");x.setDate(x.getDate()+d);return x.toISOString().slice(0,10)};
const diasAte=iso=>Math.round((new Date(iso+"T12:00:00")-new Date(hojeISO()+"T12:00:00"))/86400000);
const ddmm=iso=>iso?iso.slice(8,10)+"/"+iso.slice(5,7):"—";
const soDig=s=>String(s||"").replace(/\D/g,"");
function waNum(s){let d=soDig(s);if(!d)return "";if(d.length<=11)d="55"+d;return d}
function waLink(num,texto){const n=waNum(num);return "https://wa.me/"+(n||"")+"?text="+encodeURIComponent(texto)}
function totPed(p){
  let bruto=0,custo=0,horas=0,gramas=0;
  for(const i of p.itens||[]){const q=num(i.quantidade);bruto+=q*num(i.preco_unit);custo+=q*num(i.custo_unit);if(!i.doEstoque){horas+=q*num(i.horas_unit);for(const f of i.fil||[])gramas+=q*num(f.g)}}
  const total=bruto-num(p.desconto)+num(p.freteCliente);
  const lucro=total-num(p.taxas)-num(p.freteVoce)-custo-num(p.freteCliente)*0;
  return {bruto,total,custo,horas,gramas,lucro,receber:Math.max(0,total-num(p.sinal))};
}
const resumoItens=p=>(p.itens||[]).map(i=>`${num(i.quantidade).toLocaleString("pt-BR")}× ${i.descricao}`).join(", ");

/* ---------- pedidos ---------- */
let pedidos=[], pedFiltro="ativos", pedBusca="", pedForm=null, pedCarregado=false;
async function carregaPedidos(){
  try{ pedidos=await api("GET","/api/pedidos"); pedCarregado=true; renderPedidos(); renderFila() }catch(e){ if(e.status!==401) toast(e.message) }
}
function filtraPed(){
  const b=pedBusca.trim().toLowerCase();
  return pedidos.filter(p=>{
    if(pedFiltro==="ativos"&&["entregue","cancelado"].includes(p.status)) return false;
    if(!["ativos","todos"].includes(pedFiltro)&&p.status!==pedFiltro) return false;
    if(b&&!(`#${p.numero} ${p.cliente} ${resumoItens(p)} ${p.whatsapp||""}`.toLowerCase().includes(b))) return false;
    return true;
  });
}
function prazoPill(p){
  if(!p.prazo) return `<span class="pcat">sem prazo</span>`;
  if(["entregue","cancelado"].includes(p.status)) return `<span class="num">${ddmm(p.prazo)}</span>`;
  const d=diasAte(p.prazo);
  const cls=d<0?"bad":d<=1?"warn":"";
  const t=d<0?`atrasado ${-d}d`:d===0?"hoje":d===1?"amanhã":`em ${d} dias`;
  return `<span class="num">${ddmm(p.prazo)}</span> <span class="pill ${cls}">${t}</span>`;
}
function renderPedidos(){
  const cont={ativos:0,todos:pedidos.length}; for(const k in ST) cont[k]=0;
  for(const p of pedidos){cont[p.status]++; if(!["entregue","cancelado"].includes(p.status)) cont.ativos++}
  const chips=[["ativos","Em andamento"],...Object.entries(ST),["todos","Todos"]];
  $("#pedChips").innerHTML=chips.map(([k,n])=>`<button class="chip${pedFiltro===k?" on":""}" data-pf="${k}">${n} <b>${cont[k]||0}</b></button>`).join("");
  const lst=filtraPed();
  if(!pedCarregado){ $("#pedLista").innerHTML=`<div class="card empty"><h2>Carregando pedidos…</h2></div>`; return }
  if(!lst.length){ $("#pedLista").innerHTML=`<div class="card empty"><h2>${pedidos.length?"Nenhum pedido neste filtro":"Nenhum pedido ainda"}</h2><p>Crie um orçamento com os produtos, gere a mensagem para o WhatsApp e acompanhe até a entrega. Quando o pedido é entregue, a venda entra sozinha no Financeiro.</p><button class="btn primary edit-only" data-pa="novo">+ Novo pedido</button></div>`; return }
  $("#pedLista").innerHTML=`<div class="tablewrap"><table style="min-width:860px"><thead><tr><th>Nº</th><th>Cliente</th><th>Itens</th><th>Prazo</th><th class="n">Total</th><th>Status</th><th></th></tr></thead><tbody>
  ${lst.map(p=>{const t=totPed(p);const nx=ST_NEXT[p.status];
    return `<tr data-pid="${esc(p.id)}"><td class="num">#${p.numero}</td>
      <td><div class="pname">${esc(p.cliente)}</div><div class="pcat">${esc(p.canal||"")}${p.whatsapp?" · "+esc(p.whatsapp):""}</div></td>
      <td style="max-width:260px"><div class="clip">${esc(resumoItens(p))}</div><div class="pcat">${t.horas?fmtH(t.horas)+" de máquina":"pronta entrega"}</div></td>
      <td>${prazoPill(p)}</td>
      <td class="n">${brl(t.total)}${num(p.sinal)>0&&p.status!=="entregue"?`<div class="pcat">falta ${brl(t.receber)}</div>`:""}</td>
      <td><span class="pill ${ST_CLS[p.status]}">${ST[p.status]}</span></td>
      <td class="pact"><div class="row" style="gap:4px;justify-content:flex-end;flex-wrap:nowrap">
        ${nx?`<button class="btn sm primary edit-only" data-pa="next">${nx[1]}</button>`:""}
        <button class="btn sm" data-pa="msg">WhatsApp</button>
        ${p.status!=="entregue"?'<button class="btn sm ghost edit-only" data-pa="edit">Editar</button>':""}
        <select class="sm edit-only" data-pa="st" aria-label="Mudar status">${Object.entries(ST).map(([k,n])=>`<option value="${k}"${k===p.status?" selected":""}>${n}</option>`).join("")}</select>
      </div></td></tr>`}).join("")}
  </tbody></table></div>`;
}
$("#pedChips").addEventListener("click",e=>{const b=e.target.closest("[data-pf]");if(!b)return;pedFiltro=b.dataset.pf;renderPedidos()});
$("#pedBusca").addEventListener("input",e=>{pedBusca=e.target.value;renderPedidos()});
$("#btnNovoPed").addEventListener("click",()=>abrePedido(null));
async function mudaStatus(p,novo){
  try{
    const r=await api("POST","/api/pedidos/"+encodeURIComponent(p.id)+"/status",{status:novo});
    const i=pedidos.findIndex(x=>x.id===p.id); if(i>=0) pedidos[i]=r.pedido;
    toast(novo==="entregue"?"Pedido entregue. Venda lançada no Financeiro":`Pedido #${p.numero}: ${ST[novo]}`);
    for(const a of r.avisos||[]) setTimeout(()=>toast(a),2700);
    renderPedidos(); renderFila();
    if(novo==="entregue"||novo==="pronto"){ if(r.pedido.itens.some(i=>i.doEstoque)) carregaDados(); if(tab==="estoque") carregaRolos() }
    if((novo==="pronto"||novo==="entregue")&&tab==="pedidos") abreMsg(r.pedido,novo==="pronto"?"pronto":"obrigado");
  }catch(err){ toast(err.message) }
}
$("#pedLista").addEventListener("click",e=>{
  const b=e.target.closest("[data-pa]"); if(!b||b.tagName==="SELECT") return;
  if(b.dataset.pa==="novo") return abrePedido(null);
  const p=pedidos.find(x=>x.id===b.closest("[data-pid]")?.dataset.pid); if(!p) return;
  const a=b.dataset.pa;
  if(a==="next") mudaStatus(p,ST_NEXT[p.status][0]);
  if(a==="edit") abrePedido(p);
  if(a==="msg") abreMsg(p);
});
$("#pedLista").addEventListener("change",e=>{
  const s=e.target.closest('select[data-pa="st"]'); if(!s) return;
  const p=pedidos.find(x=>x.id===s.closest("[data-pid]").dataset.pid); if(p&&s.value!==p.status) mudaStatus(p,s.value);
});

/* formulário do pedido */
function itemDeProduto(p,canalNome,qtd){
  const r=calc(p), ch=r.canais.find(c=>c.nome===canalNome)||r.canais[0];
  const preco=num(p.precoCatalogo)>0?num(p.precoCatalogo):num(p.precoVenda)>0?num(p.precoVenda):(ch?.sugerido||0);
  const uni=r.uni;
  return {produto_id:p.id,descricao:p.nome,quantidade:qtd||1,preco_unit:+preco.toFixed(2),custo_unit:+r.custo.toFixed(2),horas_unit:+r.horasUnid.toFixed(4),
    personalizacao:"",doEstoque:false,fil:(p.filamentos||[]).filter(l=>num(l.gramas)>0).map(l=>({filId:l.filId,g:+(num(l.gramas)/uni).toFixed(2)}))};
}
function abrePedido(p){
  const novo=!p;
  pedForm={id:p?.id||null,taxaManual:!!p,d:p?clone(p):{cliente:"",whatsapp:"",canal:cfg.canais[0]?.nome||"",data:hojeISO(),prazo:addDias(hojeISO(),num(cfg.loja.prazoDias)||5),itens:[],desconto:0,freteCliente:0,freteVoce:0,taxas:0,sinal:0,obs:"",status:"orcamento"}};
  if(!pedForm.d.itens.length) pedForm.d.itens.push({produto_id:null,descricao:"",quantidade:1,preco_unit:0,custo_unit:0,horas_unit:0,personalizacao:"",doEstoque:false,fil:[]});
  const d=pedForm.d, box=$("#pedForm"); box.hidden=false;
  box.innerHTML=`<form class="stack" id="pf" autocomplete="off">
    <div class="row spread"><h2>${novo?"Novo pedido":"Editar pedido #"+p.numero}</h2><button type="button" class="btn ghost" data-pfa="fechar">Fechar</button></div>
    <div class="fields">
      <label class="f">Cliente<input id="pf-cliente" required maxlength="120" value="${esc(d.cliente)}"></label>
      <label class="f">WhatsApp<span class="hint">Com DDD</span><input id="pf-whats" inputmode="tel" maxlength="30" placeholder="(11) 91234-5678" value="${esc(d.whatsapp)}"></label>
      <label class="f">Canal<select id="pf-canal">${opcoesCanal(d.canal)}</select></label>
      <label class="f">Data do pedido<input type="date" id="pf-data" value="${esc(d.data)}"></label>
      <label class="f">Prazo de entrega<span class="hint" id="pf-sugPrazo"></span><input type="date" id="pf-prazo" value="${esc(d.prazo||"")}"></label>
      ${novo?`<label class="f">Começa como<select id="pf-status"><option value="orcamento">Orçamento</option><option value="aprovado">Aprovado</option></select></label>`:""}
    </div>
    <div class="stack" style="gap:8px"><div class="row spread"><h3>Itens</h3><button type="button" class="btn ghost" data-pfa="addItem">+ Item</button></div><div id="pfItens" class="stack" style="gap:10px"></div></div>
    <div class="fields">
      <label class="f">Desconto<div class="unit pre"><span>R$</span><input id="pf-desc" type="number" min="0" step="0.01" value="${esc(d.desconto)}"></div></label>
      <label class="f">Frete cobrado do cliente<div class="unit pre"><span>R$</span><input id="pf-fc" type="number" min="0" step="0.01" value="${esc(d.freteCliente)}"></div></label>
      <label class="f">Frete pago por você<div class="unit pre"><span>R$</span><input id="pf-fv" type="number" min="0" step="0.01" value="${esc(d.freteVoce)}"></div></label>
      <label class="f">Taxas do canal<span class="hint">Calculada; pode ajustar</span><div class="unit pre"><span>R$</span><input id="pf-taxas" type="number" min="0" step="0.01" value="${esc(d.taxas)}"></div></label>
      <label class="f">Sinal já recebido<div class="unit pre"><span>R$</span><input id="pf-sinal" type="number" min="0" step="0.01" value="${esc(d.sinal)}"></div></label>
      <label class="f">Observação<input id="pf-obs" maxlength="1000" value="${esc(d.obs)}"></label>
    </div>
    <div class="vresumo" id="pfResumo"></div>
    <div class="row"><button class="btn primary" type="submit">Salvar pedido</button><button class="btn" type="submit" data-msg="1">Salvar e gerar mensagem</button><span class="note" id="pfMsg"></span>
      ${!novo&&p.status!=="entregue"?'<span style="flex:1"></span><button type="button" class="btn ghost" data-pfa="del">Excluir pedido</button>':""}</div>
  </form>`;
  renderPfItens(); atualizaPf();
  box.scrollIntoView({behavior:"smooth",block:"start"}); $("#pf-cliente").focus();
}
function renderPfItens(){
  const ps=produtos.slice().sort((a,b)=>a.nome.localeCompare(b.nome));
  $("#pfItens").innerHTML=pedForm.d.itens.map((it,i)=>{const pr=produtos.find(x=>x.id===it.produto_id);const est=pr?num(pr.estoque):0;
    return `<div class="pfi" data-ii="${i}">
      <label class="f">Produto<select data-if="produto_id"><option value="">Outro (digitar)</option>${ps.map(p=>`<option value="${esc(p.id)}"${p.id===it.produto_id?" selected":""}>${esc(p.nome)}${num(p.estoque)>0?` (${num(p.estoque)} prontos)`:""}</option>`).join("")}</select></label>
      <label class="f">Descrição<input data-if="descricao" maxlength="150" value="${esc(it.descricao)}"></label>
      <label class="f">Qtd<input data-if="quantidade" type="number" min="1" step="1" value="${esc(it.quantidade)}"></label>
      <label class="f">Preço un.<div class="unit pre"><span>R$</span><input data-if="preco_unit" type="number" min="0" step="0.01" value="${esc(it.preco_unit)}"></div></label>
      <label class="f wide">Personalização<input data-if="personalizacao" maxlength="300" placeholder="Nomes, cores, texto…" value="${esc(it.personalizacao)}"></label>
      <div class="pfi-x">${est>0||it.doEstoque?`<label class="chk"><input type="checkbox" data-if="doEstoque"${it.doEstoque?" checked":""}> Da pronta entrega</label>`:""}
        <button type="button" class="btn ghost" data-pfa="rmItem" ${pedForm.d.itens.length<2?"disabled":""} aria-label="Remover item">✕</button></div>
    </div>`}).join("");
}
function lePf(){
  const d=pedForm.d;
  d.cliente=$("#pf-cliente").value.trim(); d.whatsapp=$("#pf-whats").value.trim(); d.canal=$("#pf-canal").value;
  d.data=$("#pf-data").value; d.prazo=$("#pf-prazo").value; d.desconto=num($("#pf-desc").value); d.freteCliente=num($("#pf-fc").value);
  d.freteVoce=num($("#pf-fv").value); d.taxas=num($("#pf-taxas").value); d.sinal=num($("#pf-sinal").value); d.obs=$("#pf-obs").value.trim();
  if($("#pf-status")) d.status=$("#pf-status").value;
}
function atualizaPf(){
  if(!pedForm) return; lePf(); const d=pedForm.d;
  if(!pedForm.taxaManual){const c=cfg.canais.find(x=>x.nome===d.canal);let t=0;
    if(c) for(const i of d.itens){const pu=num(i.preco_unit),q=num(i.quantidade),lim=num(c.fixaAbaixoDe);t+=q*(pu*num(c.comissaoPct)/100+((lim>0&&pu>=lim)?0:num(c.tarifaFixa)))}
    t+=totPed({...d,taxas:0}).total*num(cfg.impostoPct)/100; d.taxas=+t.toFixed(2); $("#pf-taxas").value=d.taxas.toFixed(2)}
  const t=totPed(d);
  const fim=previsaoNovo(t.horas, pedForm.id);
  $("#pf-sugPrazo").textContent=t.horas>0?`Pela fila, fica pronto ~${ddmm(fim)}`:"";
  $("#pfResumo").innerHTML=`<span>Total do cliente <b class="num">${brl(t.total)}</b></span><span>A receber <b class="num">${brl(t.receber)}</b></span><span>Lucro <b class="num ${t.lucro<0?"neg":"pos"}">${brl(t.lucro)}</b></span><span>Máquina <b class="num">${fmtH(t.horas)}</b></span><span>Filamento <b class="num">${Math.round(t.gramas)} g</b></span>`;
}
$("#pedForm").addEventListener("input",e=>{
  if(!pedForm) return; const el=e.target;
  if(el.id==="pf-taxas") pedForm.taxaManual=true;
  const row=el.closest("[data-ii]");
  if(row&&el.dataset.if){const it=pedForm.d.itens[+row.dataset.ii];const k=el.dataset.if;
    if(k==="produto_id"){ const p=produtos.find(x=>x.id===el.value); pedForm.d.itens[+row.dataset.ii]=p?{...itemDeProduto(p,pedForm.d.canal,num(it.quantidade)||1),personalizacao:it.personalizacao}:{...it,produto_id:null,fil:[],custo_unit:0,horas_unit:0}; renderPfItens() }
    else if(k==="doEstoque") it.doEstoque=el.checked;
    else it[k]=["quantidade","preco_unit"].includes(k)?num(el.value):el.value;
  }
  if(el.id==="pf-canal") pedForm.taxaManual=false;
  atualizaPf();
});
$("#pedForm").addEventListener("change",e=>{ if(e.target.matches('select[data-if="produto_id"],#pf-canal,input[data-if="doEstoque"]')) $("#pedForm").dispatchEvent(new Event("input")) });
$("#pedForm").addEventListener("click",async e=>{
  const b=e.target.closest("[data-pfa]"); if(!b||!pedForm) return; const a=b.dataset.pfa;
  if(a==="fechar"){pedForm=null;$("#pedForm").hidden=true;$("#pedForm").innerHTML="";return}
  if(a==="addItem"){lePf();pedForm.d.itens.push({produto_id:null,descricao:"",quantidade:1,preco_unit:0,custo_unit:0,horas_unit:0,personalizacao:"",doEstoque:false,fil:[]});renderPfItens();atualizaPf()}
  if(a==="rmItem"){lePf();pedForm.d.itens.splice(+b.closest("[data-ii]").dataset.ii,1);renderPfItens();atualizaPf()}
  if(a==="del"){b.outerHTML=`<span class="confirm">Excluir este pedido? <button type="button" class="btn danger" data-pfa="delok">Excluir</button></span>`}
  if(a==="delok"){try{await api("DELETE","/api/pedidos/"+encodeURIComponent(pedForm.id));pedidos=pedidos.filter(x=>x.id!==pedForm.id);pedForm=null;$("#pedForm").hidden=true;renderPedidos();renderFila();toast("Pedido excluído")}catch(err){toast(err.message)}}
});
$("#pedForm").addEventListener("submit",async e=>{
  e.preventDefault(); lePf(); const comMsg=e.submitter?.dataset.msg; const m=$("#pfMsg");
  try{
    const d=pedForm.d; let r;
    if(pedForm.id){r=await api("PUT","/api/pedidos/"+encodeURIComponent(pedForm.id),d);const i=pedidos.findIndex(x=>x.id===r.id);pedidos[i]=r}
    else{r=await api("POST","/api/pedidos",d);pedidos.unshift(r)}
    toast(pedForm.id?"Pedido atualizado":`Pedido #${r.numero} criado`);
    pedForm=null;$("#pedForm").hidden=true;$("#pedForm").innerHTML="";renderPedidos();renderFila();
    if(comMsg) abreMsg(r);
  }catch(err){ m.textContent=err.message }
});

/* mensagem para o WhatsApp */
let msgPed=null;
function textoMsg(p,tipo){
  const t=totPed(p), loja=cfg.loja.nome||"nossa loja", nome=(p.cliente||"").split(" ")[0];
  const linhas=(p.itens||[]).map(i=>`• ${num(i.quantidade).toLocaleString("pt-BR")}× ${i.descricao} — ${brl(num(i.preco_unit))} cada = ${brl(num(i.quantidade)*num(i.preco_unit))}${i.personalizacao?`\n   Personalização: ${i.personalizacao}`:""}`).join("\n");
  const extras=[num(p.desconto)>0?`Desconto: -${brl(num(p.desconto))}`:"",num(p.freteCliente)>0?`Frete: ${brl(num(p.freteCliente))}`:""].filter(Boolean).join("\n");
  const pag=cfg.loja.pagamento?`\nPagamento: ${cfg.loja.pagamento}`:"";
  if(tipo==="orcamento") return `Olá, ${nome}! Segue o orçamento da ${loja}:\n\n${linhas}${extras?"\n"+extras:""}\n\n*Total: ${brl(t.total)}*\n${p.prazo?`Prazo: fica pronto até ${dataBRc(p.prazo)}`:""}${pag}\n\nPosso confirmar o pedido?`;
  if(tipo==="confirmado") return `Olá, ${nome}! Pedido #${p.numero} confirmado na ${loja}.\n\n${linhas}\n\n*Total: ${brl(t.total)}*${num(p.sinal)>0?`\nSinal recebido: ${brl(num(p.sinal))}\nRestante na entrega: ${brl(t.receber)}`:""}\n${p.prazo?`Previsão: ${dataBRc(p.prazo)}`:""}\n\nAviso assim que estiver pronto!`;
  if(tipo==="pronto") return `Olá, ${nome}! Seu pedido #${p.numero} da ${loja} está pronto.\n\n${resumoItens(p)}\n${t.receber>0?`\nValor a pagar: *${brl(t.receber)}*${pag}`:"\nJá está todo pago."}\n\nComo prefere receber: retirada ou entrega?`;
  if(tipo==="cobranca") return `Olá, ${nome}! Passando para lembrar do pedido #${p.numero} da ${loja}.\nValor em aberto: *${brl(t.receber)}*${pag}\n\nQualquer dúvida, estou à disposição.`;
  return `Olá, ${nome}! Obrigado pela compra na ${loja}. Espero que goste das peças!${cfg.loja.instagram?`\nSe puder, marque a gente no Instagram: ${cfg.loja.instagram}`:""}\n\nPrecisando de mais alguma coisa, é só chamar.`;
}
function abreMsg(p,tipo){
  msgPed=p; tipo=tipo||({orcamento:"orcamento",aprovado:"confirmado",imprimindo:"confirmado",pronto:"pronto",entregue:"obrigado"}[p.status]||"orcamento");
  const box=$("#pedMsgBox"); box.hidden=false;
  box.innerHTML=`<div class="row spread"><h2>Mensagem para ${esc(p.cliente)} · pedido #${p.numero}</h2><button class="btn ghost" data-ma="fechar">Fechar</button></div>
    <div class="row">${[["orcamento","Orçamento"],["confirmado","Confirmação"],["pronto","Pedido pronto"],["cobranca","Cobrança"],["obrigado","Agradecimento"]].map(([k,n])=>`<button class="chip${k===tipo?" on":""}" data-mt="${k}">${n}</button>`).join("")}</div>
    <textarea id="msgTxt" rows="12">${esc(textoMsg(p,tipo))}</textarea>
    <div class="row"><button class="btn primary" data-ma="copiar">Copiar texto</button><a class="btn" id="msgWa" target="_blank" rel="noopener" href="#">Abrir no WhatsApp ↗</a><span class="note">${p.whatsapp?"":"Sem número cadastrado: o WhatsApp vai pedir para escolher o contato."}</span></div>`;
  const upd=()=>{$("#msgWa").href=waLink(p.whatsapp,$("#msgTxt").value)}; upd();
  $("#msgTxt").addEventListener("input",upd);
  box.scrollIntoView({behavior:"smooth",block:"start"});
}
$("#pedMsgBox").addEventListener("click",async e=>{
  const c=e.target.closest("[data-mt]"); if(c&&msgPed) return abreMsg(msgPed,c.dataset.mt);
  const b=e.target.closest("[data-ma]"); if(!b) return;
  if(b.dataset.ma==="fechar"){$("#pedMsgBox").hidden=true;msgPed=null}
  if(b.dataset.ma==="copiar"){const t=$("#msgTxt");try{await navigator.clipboard.writeText(t.value);toast("Mensagem copiada")}catch(err){t.select();toast("Selecionei o texto: use Ctrl+C")}}
});

/* ---------- fila da impressora ---------- */
function filaOrdenada(excluiId){
  return pedidos.filter(p=>["aprovado","imprimindo"].includes(p.status)&&p.id!==excluiId&&totPed(p).horas>0)
    .sort((a,b)=>(a.status==="imprimindo"?0:1)-(b.status==="imprimindo"?0:1)||(a.prazo||"9999").localeCompare(b.prazo||"9999")||a.numero-b.numero);
}
function horasDia(){return Math.max(1,Math.min(24,num(cfg.loja.horasDia)||16))}
function previsaoNovo(horas,excluiId){
  const tot=filaOrdenada(excluiId).reduce((s,p)=>s+totPed(p).horas,0)+horas;
  return addDias(hojeISO(),Math.max(0,Math.ceil(tot/horasDia())-1));
}
function renderFila(){
  if(!$("#filaLista")) return;
  const f=filaOrdenada(), hd=horasDia(); let acum=0, atrasos=0;
  const linhas=f.map((p,i)=>{const t=totPed(p);const ini=acum;acum+=t.horas;
    const fim=addDias(hojeISO(),Math.max(0,Math.ceil(acum/hd)-1));const late=p.prazo&&fim>p.prazo;if(late)atrasos++;
    return `<tr data-pid="${esc(p.id)}" class="${i===0?"agora":""}"><td class="num">${i+1}</td>
      <td><div class="pname">#${p.numero} · ${esc(p.cliente)}</div><div class="pcat clip">${esc(resumoItens(p))}</div></td>
      <td class="n">${fmtH(t.horas)}</td><td class="n num">${Math.round(t.gramas)} g</td>
      <td>${prazoPill(p)}</td>
      <td><span class="num">${ddmm(fim)}</span> ${late?'<span class="pill bad">depois do prazo</span>':'<span class="pill good">no prazo</span>'}</td>
      <td><span class="pill ${ST_CLS[p.status]}">${ST[p.status]}</span></td>
      <td class="pact">${p.status==="aprovado"?'<button class="btn sm primary edit-only" data-fa2="imprimindo">Começar</button>':'<button class="btn sm primary edit-only" data-fa2="pronto">Pronto</button>'}</td></tr>`});
  $("#filaTiles").innerHTML=`
    <div class="tile"><span class="tl">Na fila</span><span class="tv num">${f.length}</span><span class="ts">${f.length===1?"pedido aprovado":"pedidos aprovados"}</span></div>
    <div class="tile"><span class="tl">Horas de impressão</span><span class="tv num">${fmtH(acum)||"0 min"}</span><span class="ts">${hd} h por dia de impressora</span></div>
    <div class="tile main"><span class="tl">Fila livre em</span><span class="tv num">${acum>=hd?ddmm(addDias(hojeISO(),Math.floor(acum/hd))):"hoje"}</span><span class="ts">prazo para prometer a um pedido novo</span></div>
    <div class="tile"><span class="tl">Risco de atraso</span><span class="tv num ${atrasos?"neg":""}">${atrasos}</span><span class="ts">${atrasos?"pedidos ficam prontos depois do prazo":"tudo dentro do prazo"}</span></div>`;
  $("#filaLista").innerHTML=f.length?`<div class="tablewrap"><table style="min-width:820px"><thead><tr><th>#</th><th>Pedido</th><th class="n">Máquina</th><th class="n">Filamento</th><th>Prazo</th><th>Previsão</th><th>Status</th><th></th></tr></thead><tbody>${linhas.join("")}</tbody></table></div>`
    :`<div class="card empty"><h2>A impressora está livre</h2><p>Os pedidos aprovados aparecem aqui em ordem de prazo, com a previsão de quando cada um fica pronto.</p></div>`;
  const pend=pedidos.filter(p=>["aprovado","imprimindo"].includes(p.status)&&totPed(p).horas===0);
  $("#filaExtra").innerHTML=pend.length?`<p class="note"><strong>${pend.length} pedido(s) só com pronta entrega</strong> não ocupam a impressora: ${pend.map(p=>"#"+p.numero).join(", ")}.</p>`:"";
}
$("#filaLista").addEventListener("click",e=>{const b=e.target.closest("[data-fa2]");if(!b)return;const p=pedidos.find(x=>x.id===b.closest("[data-pid]").dataset.pid);if(p)mudaStatus(p,b.dataset.fa2)});

/* ---------- estoque ---------- */
let rolos=[], roloForm=false;
async function carregaRolos(){ try{ rolos=await api("GET","/api/rolos"); renderEstoque() }catch(e){ if(e.status!==401) toast(e.message) } }
const nomeFil=id=>cfg.filamentos.find(f=>f.id===id)?.nome||"Filamento removido";
function renderEstoque(){
  const ativos=rolos.filter(r=>r.ativo), acabados=rolos.filter(r=>!r.ativo);
  const porTipo={}; for(const r of ativos){porTipo[r.filamento_id]=(porTipo[r.filamento_id]||0)+r.restante}
  const baixo=ativos.filter(r=>r.restante<150);
  $("#rolTiles").innerHTML=Object.keys(porTipo).length?Object.entries(porTipo).map(([k,g])=>`<div class="tile"><span class="tl">${esc(nomeFil(k))}</span><span class="tv num sm">${(g/1000).toLocaleString("pt-BR",{maximumFractionDigits:2})} kg</span><span class="ts">${pl(ativos.filter(r=>r.filamento_id===k).length,"rolo","rolos")}</span></div>`).join(""):"";
  $("#rolAviso").innerHTML=baixo.length?`<div class="warnbox">Acabando: ${baixo.map(r=>`${esc(nomeFil(r.filamento_id))} ${esc(r.cor)} (${Math.round(r.restante)} g)`).join(", ")}. Hora de comprar mais.</div>`:"";
  const card=r=>{const pc=Math.max(0,Math.min(100,r.restante/r.peso*100));
    return `<div class="rolo${r.ativo?"":" off"}" data-rid="${esc(r.id)}"><div class="row spread"><b>${esc(r.cor)}</b><span class="pill">${esc(nomeFil(r.filamento_id))}</span></div>
      <div class="rbar"><i style="width:${pc}%" class="${r.restante<150?"low":""}"></i></div>
      <div class="row spread"><span class="num">${Math.round(r.restante)} g <span class="pcat">de ${Math.round(r.peso)} g</span></span>${r.restante<150&&r.ativo?'<span class="pill bad">acabando</span>':""}</div>
      <div class="pcat">${r.data_compra?"Comprado em "+dataBRc(r.data_compra):""}${r.preco?` · ${brl(r.preco)}`:""}</div>
      <div class="row edit-only rbtns" style="gap:4px">${r.ativo?`<button class="btn sm" data-ra="usar">Usar</button><button class="btn sm ghost" data-ra="acabou">Acabou</button>`:`<button class="btn sm ghost" data-ra="reativar">Reativar</button><button class="btn sm ghost" data-ra="del">Excluir</button>`}</div></div>`};
  $("#rolLista").innerHTML=ativos.length?`<div class="rolos">${ativos.map(card).join("")}</div>`:`<div class="card empty"><h2>Nenhum rolo cadastrado</h2><p>Cadastre seus rolos. Quando um pedido fica pronto, o sistema desconta os gramas do rolo mais antigo daquele tipo.</p></div>`;
  $("#rolAcabados").innerHTML=acabados.length?`<details><summary>Rolos acabados (${acabados.length})</summary><div class="rolos" style="margin-top:10px">${acabados.map(card).join("")}</div></details>`:"";
  // peças prontas
  const ps=produtos.slice().sort((a,b)=>num(b.estoque)-num(a.estoque)||a.nome.localeCompare(b.nome));
  $("#pecasLista").innerHTML=ps.length?`<div class="tablewrap"><table class="mini" style="min-width:420px"><thead><tr><th>Produto</th><th class="n">Prontas</th><th class="edit-only"></th></tr></thead><tbody>${ps.map(p=>`<tr data-prid="${esc(p.id)}"><td>${esc(p.nome)}</td><td class="n num"><b>${num(p.estoque)}</b></td>
    <td class="edit-only" style="text-align:right;white-space:nowrap"><button class="btn sm" data-pe="-1" aria-label="Tirar uma">−</button> <button class="btn sm" data-pe="1" aria-label="Somar uma">+</button> <button class="btn sm ghost" data-pe="lote">+ Lote</button></td></tr>`).join("")}</tbody></table></div>`:`<p class="note">Cadastre produtos para controlar as peças prontas.</p>`;
}
$("#btnNovoRolo").addEventListener("click",()=>{
  const box=$("#rolForm"); box.hidden=false;
  box.innerHTML=`<form class="stack" id="rf"><div class="row spread"><h2>Novo rolo</h2><button type="button" class="btn ghost" data-rfa="fechar">Fechar</button></div>
    <div class="fields">
      <label class="f">Tipo<select id="rf-fil">${cfg.filamentos.map(f=>`<option value="${esc(f.id)}">${esc(f.nome)}</option>`).join("")}</select></label>
      <label class="f">Cor<input id="rf-cor" required maxlength="60" placeholder="Ex.: Preto"></label>
      <label class="f">Peso do rolo<div class="unit"><input id="rf-peso" type="number" min="1" step="1" value="1000"><span>g</span></div></label>
      <label class="f">Quanto ainda tem<span class="hint">Vazio = rolo cheio</span><div class="unit"><input id="rf-rest" type="number" min="0" step="1" placeholder="cheio"><span>g</span></div></label>
      <label class="f">Preço pago<div class="unit pre"><span>R$</span><input id="rf-preco" type="number" min="0" step="0.01"></div></label>
      <label class="f">Data da compra<input type="date" id="rf-data" value="${hojeISO()}"></label>
    </div>
    <label class="chk"><input type="checkbox" id="rf-desp" checked> Lançar a compra como despesa no Financeiro</label>
    <div class="row"><button class="btn primary" type="submit">Salvar rolo</button><span class="note" id="rfMsg"></span></div></form>`;
  $("#rf-cor").focus();
});
$("#rolForm").addEventListener("click",e=>{if(e.target.closest('[data-rfa="fechar"]')){$("#rolForm").hidden=true}});
$("#rolForm").addEventListener("submit",async e=>{
  e.preventDefault();
  try{
    const fil=$("#rf-fil").value;
    await api("POST","/api/rolos",{filamento_id:fil,nomeFilamento:nomeFil(fil),cor:$("#rf-cor").value,peso:num($("#rf-peso").value),restante:$("#rf-rest").value,preco:num($("#rf-preco").value),data_compra:$("#rf-data").value,lancarDespesa:$("#rf-desp").checked});
    $("#rolForm").hidden=true; toast("Rolo cadastrado"); carregaRolos();
  }catch(err){ $("#rfMsg").textContent=err.message }
});
$("#rolLista").parentElement.addEventListener("click",async e=>{
  const b=e.target.closest("[data-ra]"); if(!b) return;
  const card=b.closest("[data-rid]"), r=rolos.find(x=>x.id===card.dataset.rid); if(!r) return;
  const a=b.dataset.ra;
  if(a==="usar"){ b.closest(".rbtns").innerHTML=`<div class="unit" style="width:110px"><input type="number" min="1" step="1" id="uso-${esc(r.id)}" placeholder="0"><span>g</span></div><button class="btn sm primary" data-ra="usarok">Descontar</button>`; card.querySelector("input").focus(); return }
  try{
    if(a==="usarok"){ await api("POST","/api/rolos/"+encodeURIComponent(r.id)+"/uso",{gramas:num(card.querySelector("input").value)}) }
    if(a==="acabou") await api("PUT","/api/rolos/"+encodeURIComponent(r.id),{...r,ativo:false,restante:0});
    if(a==="reativar") await api("PUT","/api/rolos/"+encodeURIComponent(r.id),{...r,ativo:true});
    if(a==="del") await api("DELETE","/api/rolos/"+encodeURIComponent(r.id));
    carregaRolos();
  }catch(err){ toast(err.message) }
});
$("#pecasLista").addEventListener("click",async e=>{
  const b=e.target.closest("[data-pe]"); if(!b) return;
  const tr=b.closest("[data-prid]"), p=produtos.find(x=>x.id===tr.dataset.prid); if(!p) return;
  if(b.dataset.pe==="lote"){ tr.lastElementChild.innerHTML=`<div class="unit" style="width:90px;display:inline-block"><input type="number" min="1" step="1" placeholder="qtd" id="lote-${esc(p.id)}"></div> <button class="btn sm primary" data-pe="loteok">Somar</button>`; tr.querySelector("input").focus(); return }
  const delta=b.dataset.pe==="loteok"?num(tr.querySelector("input").value):num(b.dataset.pe);
  if(!delta) return;
  try{ const r=await api("POST","/api/produtos/"+encodeURIComponent(p.id)+"/estoque",{delta}); p.estoque=r.estoque; renderEstoque(); renderLista() }catch(err){ toast(err.message) }
});

/* ---------- sua loja (config) ---------- */
const LOJA=[["nome","Nome da loja","text","Ex.: Freire 3D"],["whatsapp","WhatsApp da loja","tel","Recebe os pedidos do catálogo"],["instagram","Instagram","text","@sualoja"],["pagamento","Formas de pagamento","text","Pix, cartão ou dinheiro"],["prazoDias","Prazo padrão (dias)","number","Usado em pedidos novos"],["horasDia","Horas de impressora por dia","number","Para calcular a fila"],["sobre","Texto do catálogo","text","Uma frase sobre a loja"]];
function renderLoja(){
  $("#cfgLoja").innerHTML=LOJA.map(([k,l,t,h])=>`<label class="f${k==="sobre"?" wide":""}">${l}<span class="hint">${h}</span><input id="lj-${k}" data-l="${k}" type="${t==="number"?"number":t}" ${t==="number"?'min="0" step="1"':""} value="${esc(cfg.loja[k]??"")}"></label>`).join("");
  const url=location.origin+"/catalogo";
  $("#catLink").innerHTML=`<span class="num clip">${esc(url)}</span><button class="btn sm" id="copCat">Copiar link</button><a class="btn sm" href="/catalogo" target="_blank" rel="noopener">Abrir catálogo ↗</a>`;
  $("#copCat").addEventListener("click",async()=>{try{await navigator.clipboard.writeText(url);toast("Link copiado")}catch(e){toast(url)}});
  if(!podeEditar()) $("#cfgLoja").querySelectorAll("input").forEach(i=>i.disabled=true);
}
$("#cfgLoja").addEventListener("input",e=>{const k=e.target.dataset.l;if(!k)return;cfg.loja[k]=["prazoDias","horasDia"].includes(k)?num(e.target.value):e.target.value;saveCfg()});

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
        <label class="f">Produto<select id="fv-prod">${prodOpts}</select><span class="chk" id="fv-baixaBox" hidden><input type="checkbox" id="fv-baixa"> Saiu da pronta entrega</span></label>
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
  const tem=num(p.estoque)>0&&!finForm.id; $("#fv-baixaBox").hidden=!tem; $("#fv-baixa").checked=tem;
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
      body={data:$("#fv-data").value,produto_id:$("#fv-prod").value||null,descricao:$("#fv-desc").value,quantidade:num($("#fv-qtd").value),preco_unit:num($("#fv-preco").value),canal:$("#fv-canal").value,taxas:num($("#fv-taxas").value),frete:num($("#fv-frete").value),custo_unit:num($("#fv-custo").value),cliente:$("#fv-cliente").value,status:$("#fv-status").value,obs:$("#fv-obs").value,baixarEstoque:!$("#fv-baixaBox").hidden&&$("#fv-baixa").checked};
      url="/api/vendas";
    }else{
      body={data:$("#fl-data").value,tipo:finForm.tipo,descricao:$("#fl-desc").value,categoria:$("#fl-cat").value,valor:num($("#fl-valor").value),status:$("#fl-status").value,obs:$("#fl-obs").value};
      url="/api/lancamentos";
    }
    if(finForm.id) await api("PUT",url+"/"+encodeURIComponent(finForm.id),body); else await api("POST",url,body);
    if(body.baixarEstoque&&!finForm.id){const pp=produtos.find(x=>x.id===body.produto_id);if(pp)pp.estoque=Math.max(0,num(pp.estoque)-body.quantidade)}
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

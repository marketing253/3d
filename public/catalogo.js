(function(){
"use strict";
const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const brl=v=>Number(v||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
let dados=null, cat="Todos", carrinho={};
let foco=new URLSearchParams(location.search).get("p");
let cli={nome:"",whatsapp:""}, cupom=null;
try{ carrinho=JSON.parse(localStorage.getItem("cat3d.carrinho")||"{}")||{} }catch(e){ carrinho={} }
try{ cli={...cli,...JSON.parse(localStorage.getItem("cat3d.cliente")||"{}")} }catch(e){}
const salva=()=>{ try{ localStorage.setItem("cat3d.carrinho",JSON.stringify(carrinho)) }catch(e){} };

async function carrega(){
  try{
    const r=await fetch("/api/publico/catalogo"); if(!r.ok) throw new Error();
    dados=await r.json();
  }catch(e){ $("#grid").innerHTML=`<p class="note">Não deu para carregar o catálogo. Recarregue a página.</p>`; return }
  const L=dados.loja;
  document.title=L.nome+" · Catálogo";
  $("#lojaNome").innerHTML=`<small>Impressão 3D sob encomenda</small>${esc(L.nome)}`;
  $("#lojaSobre").textContent=L.sobre||"Peças impressas em 3D, feitas sob encomenda ou à pronta entrega.";
  $("#lojaMeta").innerHTML=[L.prazoDias?`<span class="pill">Produção em até ${L.prazoDias} dias</span>`:"",L.pagamento?`<span class="pill">${esc(L.pagamento)}</span>`:"",
    L.instagram?`<a class="pill acc" href="https://instagram.com/${encodeURIComponent(L.instagram.replace(/^@/,""))}" target="_blank" rel="noopener">${esc(L.instagram.startsWith("@")?L.instagram:"@"+L.instagram)}</a>`:""].join("");
  // remove itens que saíram do catálogo
  dados.kits=dados.kits||[];
  for(const id of Object.keys(carrinho)) if(!(id.startsWith("kit:")?dados.kits.some(k=>"kit:"+k.id===id):dados.produtos.some(p=>p.id===id))) delete carrinho[id];
  $("#cupBox").hidden=!dados.temCupom;
  if(dados.temCupom){ let c=""; try{c=new URLSearchParams(location.search).get("cupom")||sessionStorage.getItem("cat3d.cupom")||""}catch(e){} if(c){ $("#cCupom").value=c; setTimeout(aplicaCupom,0) } }
  render();
}
function render(){
  const ps=dados.produtos;
  const ks=foco?[]:dados.kits;
  $("#kits").hidden=!ks.length;
  $("#kitGrid").innerHTML=ks.map(k=>{const id="kit:"+k.id, q=carrinho[id]?.q||0; return `<article class="prod" data-id="${esc(id)}">
    <div class="ph">${k.foto?`<img src="${esc(k.foto)}" alt="${esc(k.nome)}" loading="lazy">`:"KIT"}</div>
    <div class="bd"><h2>${esc(k.nome)}</h2><p>${k.itens.map(i=>`${i.q}× ${esc(i.nome)}`).join(" + ")}</p>${k.descricao?`<p>${esc(k.descricao)}</p>`:""}
      <div class="ft"><span>${k.avulso>k.preco?`<span class="de">${brl(k.avulso)}</span> <span class="eco">economize ${brl(k.avulso-k.preco)}</span><br>`:""}<span class="preco num">${brl(k.preco)}</span></span>
        ${q?`<span class="step"><button data-d="-1" aria-label="Menos">−</button><span>${q}</span><button data-d="1" aria-label="Mais">+</button></span>`:`<button class="btn primary" data-d="1">Adicionar</button>`}</div></div></article>`}).join("");
  const cats=["Todos",...new Set(ps.map(p=>p.categoria).filter(Boolean))];
  $("#cats").innerHTML=cats.length>2?cats.map(c=>`<button class="chip${c===cat?" on":""}" data-c="${esc(c)}">${esc(c)}</button>`).join(""):"";
  if(foco&&!ps.some(p=>p.id===foco)) foco=null;
  const lst=foco?ps.filter(p=>p.id===foco):ps.filter(p=>cat==="Todos"||p.categoria===cat);
  if(foco) $("#cats").innerHTML=`<button class="chip on" data-todos>← Ver todos os produtos (${ps.length})</button>`;
  $("#grid").innerHTML=lst.length?lst.map(p=>{const q=carrinho[p.id]?.q||0;return `<article class="prod" data-id="${esc(p.id)}">
    <div class="ph">${p.foto?`<img src="${esc(p.foto)}" alt="${esc(p.nome)}" loading="lazy">`:"3D"}</div>
    <div class="bd"><div class="row" style="gap:6px">${p.prontaEntrega?'<span class="pill good">Pronta entrega</span>':""}${p.personalizavel?'<span class="pill acc">Personalizável</span>':""}</div>
      <h2>${esc(p.nome)}</h2>${p.descricao?`<p>${esc(p.descricao)}</p>`:""}
      <div class="ft"><span class="preco num">${brl(p.preco)}</span>
        ${q?`<span class="step"><button data-d="-1" aria-label="Menos">−</button><span>${q}</span><button data-d="1" aria-label="Mais">+</button></span>`:`<button class="btn primary" data-d="1">Adicionar</button>`}</div></div></article>`}).join("")
    :`<p class="note">Nenhum produto no catálogo ainda.</p>`;
  renderCarrinho();
}
function itens(){ return Object.entries(carrinho).map(([id,c])=>{
  if(id.startsWith("kit:")){const k=dados.kits.find(x=>"kit:"+x.id===id);return {p:k&&{id,nome:"Kit "+k.nome,preco:k.preco,personalizavel:true,kit:k.id},...c}}
  return {p:dados.produtos.find(x=>x.id===id),...c}}).filter(x=>x.p&&x.q>0) }
function descontoCupom(tot){ if(!cupom) return 0; if(cupom.minimo>0&&tot<cupom.minimo) return 0; return Math.min(tot,cupom.tipo==="valor"?cupom.valor:tot*cupom.valor/100) }
function texto(){
  const L=dados.loja, its=itens(); const tot=its.reduce((s,x)=>s+x.q*x.p.preco,0);
  const linhas=its.map(x=>`• ${x.q}× ${x.p.nome} — ${brl(x.q*x.p.preco)}${x.pers?`\n   Personalização: ${x.pers}`:""}`).join("\n");
  const des=descontoCupom(tot);
  return `Olá! Vim pelo catálogo da ${L.nome} e quero fazer um pedido:\n\n${linhas}\n\n${des>0?`Subtotal: ${brl(tot)}\nCupom ${cupom.codigo}: -${brl(des)}\n`:""}Total estimado: ${brl(tot-des)}\n\nMeu nome: ${cli.nome.trim()}`;
}
function renderCarrinho(){
  const its=itens(); salva();
  $("#cartbar").hidden=!its.length;
  if(!its.length){ $("#cart").hidden=true; $("#cliente").hidden=true; return }
  const tot=its.reduce((s,x)=>s+x.q*x.p.preco,0), n=its.reduce((s,x)=>s+x.q,0);
  const des=descontoCupom(tot);
  $("#cartResumo").innerHTML=`${n} ${n===1?"item":"itens"} · ${des>0?`<s>${brl(tot)}</s> `:""}<b>${brl(tot-des)}</b>`;
  if(cupom) $("#cupMsg").textContent=des>0?`Cupom ${cupom.codigo}: −${brl(des)}`:`O cupom ${cupom.codigo} vale para pedidos a partir de ${brl(cupom.minimo)}.`;
  $("#cart").innerHTML=its.map(x=>`<div class="cline" data-id="${esc(x.p.id)}"><span>${x.q}× ${esc(x.p.nome)}</span><span class="num">${brl(x.q*x.p.preco)}</span>
    ${x.p.personalizavel?`<input data-pers placeholder="Personalização: nome, cor, texto…" maxlength="200" value="${esc(x.pers||"")}">`:""}</div>`).join("");
  const num=String(dados.loja.whatsapp||"").replace(/\D/g,""); const wa=num?(num.length<=11?"55"+num:num):"";
  $("#enviar").href="https://wa.me/"+wa+"?text="+encodeURIComponent(texto());
}
$("#cats").addEventListener("click",e=>{if(e.target.closest("[data-todos]")){foco=null;try{history.replaceState(null,"","/catalogo")}catch(err){}render();return}
  const b=e.target.closest("[data-c]");if(!b)return;cat=b.dataset.c;render()});
function cliqueQtd(e){
  const b=e.target.closest("[data-d]"); if(!b) return; const id=b.closest("[data-id]").dataset.id;
  const c=carrinho[id]||{q:0,pers:""}; c.q=Math.max(0,Math.min(999,c.q+Number(b.dataset.d)));
  if(c.q) carrinho[id]=c; else delete carrinho[id];
  render();
}
$("#grid").addEventListener("click",cliqueQtd);
$("#kitGrid").addEventListener("click",cliqueQtd);
async function aplicaCupom(){
  const cod=$("#cCupom").value.trim().toUpperCase().replace(/\s+/g,""); if(!cod){cupom=null;$("#cupMsg").textContent="";renderCarrinho();return}
  $("#cupMsg").textContent="Conferindo…";
  try{ const r=await fetch("/api/publico/cupom?codigo="+encodeURIComponent(cod)); const j=await r.json(); if(!r.ok) throw new Error(j.erro||"Cupom inválido.");
    cupom=j; try{sessionStorage.setItem("cat3d.cupom",cod)}catch(e){} renderCarrinho() }
  catch(err){ cupom=null; $("#cupMsg").textContent=err.message; renderCarrinho() }
}
$("#cAplicar").addEventListener("click",aplicaCupom);
$("#cCupom").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();aplicaCupom()}});
$("#cart").addEventListener("input",e=>{const i=e.target.closest("[data-pers]");if(!i)return;const id=i.closest("[data-id]").dataset.id;if(carrinho[id]){carrinho[id].pers=i.value;salva();
  const num=String(dados.loja.whatsapp||"").replace(/\D/g,"");$("#enviar").href="https://wa.me/"+(num?(num.length<=11?"55"+num:num):"")+"?text="+encodeURIComponent(texto())}});
function abreCarrinho(abrir){const c=$("#cart");c.hidden=!abrir;$("#cliente").hidden=!abrir;$("#verCarrinho").textContent=abrir?"Esconder":"Ver pedido"}
$("#verCarrinho").addEventListener("click",()=>abreCarrinho($("#cart").hidden));
$("#cNome").value=cli.nome; $("#cWhats").value=cli.whatsapp;
for(const id of ["#cNome","#cWhats"]) $(id).addEventListener("input",()=>{cli.nome=$("#cNome").value;cli.whatsapp=$("#cWhats").value;
  try{localStorage.setItem("cat3d.cliente",JSON.stringify(cli))}catch(e){}
  const num=String(dados.loja.whatsapp||"").replace(/\D/g,"");$("#enviar").href="https://wa.me/"+(num?(num.length<=11?"55"+num:num):"")+"?text="+encodeURIComponent(texto())});
function toast(m){const t=$("#toast");t.textContent=m;t.hidden=false;clearTimeout(toast._t);toast._t=setTimeout(()=>t.hidden=true,3500)}
$("#enviar").addEventListener("click",e=>{
  if(cli.nome.trim().length<2){ e.preventDefault(); abreCarrinho(true); $("#cNome").focus(); toast("Digite seu nome para enviar o pedido."); return }
  const corpo={nome:cli.nome.trim(),whatsapp:cli.whatsapp.trim(),cupom:cupom?cupom.codigo:"",itens:itens().map(x=>x.p.kit?{kit:x.p.kit,q:x.q,pers:x.pers||""}:{id:x.p.id,q:x.q,pers:x.pers||""})};
  try{ fetch("/api/publico/pedido",{method:"POST",keepalive:true,headers:{"Content-Type":"application/json"},body:JSON.stringify(corpo)}).catch(()=>{}) }catch(err){}
  setTimeout(()=>{carrinho={};render();toast("Pedido enviado! Termine a conversa no WhatsApp.")},400);
});
carrega();
})();

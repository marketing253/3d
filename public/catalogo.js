(function(){
"use strict";
const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const brl=v=>Number(v||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
let dados=null, cat="Todos", carrinho={};
try{ carrinho=JSON.parse(localStorage.getItem("cat3d.carrinho")||"{}")||{} }catch(e){ carrinho={} }
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
  for(const id of Object.keys(carrinho)) if(!dados.produtos.some(p=>p.id===id)) delete carrinho[id];
  render();
}
function render(){
  const ps=dados.produtos;
  const cats=["Todos",...new Set(ps.map(p=>p.categoria).filter(Boolean))];
  $("#cats").innerHTML=cats.length>2?cats.map(c=>`<button class="chip${c===cat?" on":""}" data-c="${esc(c)}">${esc(c)}</button>`).join(""):"";
  const lst=ps.filter(p=>cat==="Todos"||p.categoria===cat);
  $("#grid").innerHTML=lst.length?lst.map(p=>{const q=carrinho[p.id]?.q||0;return `<article class="prod" data-id="${esc(p.id)}">
    <div class="ph">${p.foto?`<img src="${esc(p.foto)}" alt="${esc(p.nome)}" loading="lazy">`:"3D"}</div>
    <div class="bd"><div class="row" style="gap:6px">${p.prontaEntrega?'<span class="pill good">Pronta entrega</span>':""}${p.personalizavel?'<span class="pill acc">Personalizável</span>':""}</div>
      <h2>${esc(p.nome)}</h2>${p.descricao?`<p>${esc(p.descricao)}</p>`:""}
      <div class="ft"><span class="preco num">${brl(p.preco)}</span>
        ${q?`<span class="step"><button data-d="-1" aria-label="Menos">−</button><span>${q}</span><button data-d="1" aria-label="Mais">+</button></span>`:`<button class="btn primary" data-d="1">Adicionar</button>`}</div></div></article>`}).join("")
    :`<p class="note">Nenhum produto no catálogo ainda.</p>`;
  renderCarrinho();
}
function itens(){ return Object.entries(carrinho).map(([id,c])=>({p:dados.produtos.find(x=>x.id===id),...c})).filter(x=>x.p&&x.q>0) }
function texto(){
  const L=dados.loja, its=itens(); const tot=its.reduce((s,x)=>s+x.q*x.p.preco,0);
  const linhas=its.map(x=>`• ${x.q}× ${x.p.nome} — ${brl(x.q*x.p.preco)}${x.pers?`\n   Personalização: ${x.pers}`:""}`).join("\n");
  return `Olá! Vim pelo catálogo da ${L.nome} e quero fazer um pedido:\n\n${linhas}\n\nTotal estimado: ${brl(tot)}\n\nMeu nome: `;
}
function renderCarrinho(){
  const its=itens(); salva();
  $("#cartbar").hidden=!its.length;
  if(!its.length){ $("#cart").hidden=true; return }
  const tot=its.reduce((s,x)=>s+x.q*x.p.preco,0), n=its.reduce((s,x)=>s+x.q,0);
  $("#cartResumo").innerHTML=`${n} ${n===1?"item":"itens"} · <b>${brl(tot)}</b>`;
  $("#cart").innerHTML=its.map(x=>`<div class="cline" data-id="${esc(x.p.id)}"><span>${x.q}× ${esc(x.p.nome)}</span><span class="num">${brl(x.q*x.p.preco)}</span>
    ${x.p.personalizavel?`<input data-pers placeholder="Personalização: nome, cor, texto…" maxlength="200" value="${esc(x.pers||"")}">`:""}</div>`).join("");
  const num=String(dados.loja.whatsapp||"").replace(/\D/g,""); const wa=num?(num.length<=11?"55"+num:num):"";
  $("#enviar").href="https://wa.me/"+wa+"?text="+encodeURIComponent(texto());
}
$("#cats").addEventListener("click",e=>{const b=e.target.closest("[data-c]");if(!b)return;cat=b.dataset.c;render()});
$("#grid").addEventListener("click",e=>{
  const b=e.target.closest("[data-d]"); if(!b) return; const id=b.closest("[data-id]").dataset.id;
  const c=carrinho[id]||{q:0,pers:""}; c.q=Math.max(0,Math.min(999,c.q+Number(b.dataset.d)));
  if(c.q) carrinho[id]=c; else delete carrinho[id];
  render();
});
$("#cart").addEventListener("input",e=>{const i=e.target.closest("[data-pers]");if(!i)return;const id=i.closest("[data-id]").dataset.id;if(carrinho[id]){carrinho[id].pers=i.value;salva();
  const num=String(dados.loja.whatsapp||"").replace(/\D/g,"");$("#enviar").href="https://wa.me/"+(num?(num.length<=11?"55"+num:num):"")+"?text="+encodeURIComponent(texto())}});
$("#verCarrinho").addEventListener("click",()=>{const c=$("#cart");c.hidden=!c.hidden;$("#verCarrinho").textContent=c.hidden?"Ver pedido":"Esconder"});
carrega();
})();

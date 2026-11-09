(function(){
"use strict";
/* Catálogo público: vitrine com busca e categorias, janela do produto e carrinho.
   O pedido é feito ali mesmo, só com nome e WhatsApp (sem cadastro): ele cai no painel
   e o cliente segue pelo link do pedido para aprovar e pagar. */
const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const brl=v=>Number(v||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const sem=s=>String(s||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase();
let dados=null, cat="Todos", busca="", carrinho={}, cupom=null;
let foco=new URLSearchParams(location.search).get("p");
let cli={nome:"",whatsapp:""};
// entrega: tipo, cep e endereço; valor/combinar vêm do servidor pelo CEP (o servidor confere de novo no pedido)
let ent={tipo:"retirada",cep:"",rua:"",numero:"",complemento:"",bairro:"",cidade:"",uf:"",valor:null,combinar:false,achou:false};
try{ carrinho=JSON.parse(localStorage.getItem("cat3d.carrinho")||"{}")||{} }catch(e){ carrinho={} }
try{ cli={...cli,...JSON.parse(localStorage.getItem("cat3d.cliente")||"{}")} }catch(e){}
try{ const x=JSON.parse(localStorage.getItem("cat3d.entrega")||"{}"); if(x&&typeof x==="object") ent={...ent,...x,achou:false} }catch(e){}
const salva=()=>{ try{ localStorage.setItem("cat3d.carrinho",JSON.stringify(carrinho)) }catch(e){} };
function toast(m){const t=$("#toast");t.textContent=m;t.hidden=false;clearTimeout(toast._t);toast._t=setTimeout(()=>t.hidden=true,3000)}

const ICONES={
  prazo:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  pag:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h4"/></svg>',
  arte:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l4-1 11-11-3-3L5 16l-1 4z"/><path d="M14 6l3 3"/></svg>',
};

async function carrega(){
  try{ const r=await fetch("/api/publico/catalogo"); if(!r.ok) throw new Error(); dados=await r.json() }
  catch(e){ $("#grid").innerHTML=`<p class="vazio">Não deu para carregar o catálogo. Recarregue a página.</p>`; return }
  const L=dados.loja;
  document.title=`${L.nome} · Catálogo 3D`;
  if(L.logo){ $("#logo").src=L.logo; $("#logoPe").src=L.logo }
  if(L.sobre) $("#hSobre").textContent=L.sobre;
  $("#selos").innerHTML=[
    L.prazoDias?[ICONES.prazo,`Pronto em até ${L.prazoDias} dias`,"Produção sob encomenda"]:null,
    [ICONES.pag,L.cartao?"Pix ou cartão em até 12x":"Pagamento por Pix",L.pagamento||"Pelo link do pedido, com confirmação automática"],
    [ICONES.arte,"Personalize do seu jeito","Nomes, cores e textos aprovados antes de imprimir"],
  ].filter(Boolean).map(([i,t,s])=>`<div class="selo">${i}<div><b>${esc(t)}</b><span>${esc(s)}</span></div></div>`).join("");
  // vitrine do topo: até 3 produtos com foto (pronta entrega primeiro); sem foto nenhuma, o texto ocupa a largura toda
  const comFoto=dados.produtos.filter(p=>p.foto).sort((a,b)=>(b.prontaEntrega?1:0)-(a.prontaEntrega?1:0)).slice(0,3);
  const vit=$("#vitrine"); vit.hidden=!comFoto.length; vit.classList.toggle("um",comFoto.length===1);
  vit.innerHTML=comFoto.map(p=>`<button class="vt" type="button" data-ver="${esc(p.id)}" aria-label="Ver ${esc(p.nome)}"><img src="${esc(p.foto)}" alt="${esc(p.nome)}"><span>${esc(p.nome)}<b>${brl(p.preco)}</b></span></button>`).join("");
  if(!comFoto.length&&document.body.classList.contains("sem3d")) document.querySelector(".hero .wrap").style.gridTemplateColumns="1fr";
  const wa=waLoja(), ig=String(L.instagram||"").replace(/^@/,"");
  if(wa){ $("#zap").href=`https://wa.me/${wa}?text=${encodeURIComponent(`Olá! Vim pelo catálogo da ${L.nome} e queria tirar uma dúvida.`)}`; $("#zap").hidden=false } // botão flutuante
  if(L.site){ const url=/^https?:/i.test(L.site)?L.site:"https://"+L.site; $("#lkSite").href=url; $("#lkSite").hidden=false }
  $("#links").innerHTML=[wa?`<a href="https://wa.me/${wa}" target="_blank" rel="noopener">WhatsApp</a>`:"",ig?`<a href="https://instagram.com/${encodeURIComponent(ig)}" target="_blank" rel="noopener">@${esc(ig)}</a>`:"",
    L.site?`<a href="${esc(/^https?:/i.test(L.site)?L.site:"https://"+L.site)}" target="_blank" rel="noopener">${esc(L.site.replace(/^https?:\/\//,"").replace(/\/$/,""))}</a>`:""].join("");
  if(L.cartao) $("#nCartao").textContent=" ou cartão em até 12x";
  dados.kits=dados.kits||[];
  for(const id of Object.keys(carrinho)) if(!item(id)) delete carrinho[id]; // tira o que saiu do catálogo
  $("#cupBox").hidden=!dados.temCupom;
  if(dados.temCupom){ let c=""; try{c=new URLSearchParams(location.search).get("cupom")||sessionStorage.getItem("cat3d.cupom")||""}catch(e){} if(c){ $("#cCupom").value=c; setTimeout(aplicaCupom,0) } }
  $("#cNome").value=cli.nome; $("#cWhats").value=cli.whatsapp;
  montaEntrega();
  banners();
  render();
  if(foco&&item(foco)) abreProduto(foco);
}
const waLoja=()=>{ const n=String(dados?.loja?.whatsapp||"").replace(/\D/g,""); return n?(n.length<=11?"55"+n:n):"" };
// produto ou kit pelo id do carrinho ("kit:<id>" para kits)
function item(id){
  if(String(id).startsWith("kit:")){ const k=dados.kits.find(x=>"kit:"+x.id===id); return k&&{id,nome:"Kit "+k.nome,preco:k.preco,foto:k.foto,personalizavel:true,kit:k.id,descricao:k.descricao||k.itens.map(i=>`${i.q}× ${i.nome}`).join(" + "),avulso:k.avulso} }
  const p=dados.produtos.find(x=>x.id===id); return p&&{...p};
}
const qtdHtml=(id,q)=>q?`<span class="qtd" data-id="${esc(id)}"><button type="button" data-d="-1" aria-label="Menos">−</button><span>${q}</span><button type="button" data-d="1" aria-label="Mais">+</button></span>`
  :`<button class="add" type="button" data-id="${esc(id)}" data-d="1">Adicionar</button>`;
function card(x){
  const q=carrinho[x.id]?.q||0;
  return `<article class="prod" data-ver="${esc(x.id)}">
    <div class="ph">${x.foto?`<img src="${esc(x.foto)}" alt="${esc(x.nome)}" loading="lazy">`:x.kit?"KIT":"3D"}
      <div class="selos-ph">${x.prontaEntrega?'<span class="tag pe">Pronta entrega</span>':""}${x.personalizavel&&!x.kit?'<span class="tag">Personalizável</span>':""}</div></div>
    <div class="bd">${x.categoria?`<span class="cat">${esc(x.categoria)}</span>`:""}<h3>${esc(x.nome)}</h3>${x.descricao?`<p>${esc(x.descricao)}</p>`:""}
      <div class="ft"><span>${x.avulso>x.preco?`<span class="de">${brl(x.avulso)}</span>`:""}<span class="preco">${brl(x.preco)}</span></span>${qtdHtml(x.id,q)}</div></div>
  </article>`;
}
function render(){
  const ps=dados.produtos, cats=["Todos",...new Set(ps.map(p=>p.categoria).filter(Boolean))];
  $("#cats").innerHTML=cats.length>2?cats.map(c=>`<button class="chip${c===cat?" on":""}" type="button" data-c="${esc(c)}">${esc(c)}</button>`).join(""):"";
  const b=sem(busca).trim();
  const lst=ps.filter(p=>(cat==="Todos"||p.categoria===cat)&&(!b||sem(p.nome+" "+p.descricao+" "+p.categoria).includes(b)));
  const ks=cat==="Todos"&&!b?dados.kits:[];
  $("#kits").hidden=!ks.length;
  $("#kitGrid").innerHTML=ks.map(k=>card(item("kit:"+k.id))).join("");
  const nP=n=>`${n} ${n===1?"produto":"produtos"}`;
  // em "Todos", sem busca e com 2+ categorias: uma seção por categoria (sem categoria vai para "Outros", no fim)
  const grupos=cat==="Todos"&&!b&&cats.length>2&&lst.length>0;
  $("#cabGrade").hidden=$("#grid").hidden=grupos;
  $("#grupos").innerHTML=grupos?[...cats.slice(1),""].map(c=>{ const its=lst.filter(p=>(p.categoria||"")===c); if(!its.length) return "";
    return `<section class="grupo"><div class="secao"><h2 class="titulo">${esc(c||"Outros")} <small>${nP(its.length)}</small></h2>${c?`<button type="button" data-c="${esc(c)}">Ver só ${esc(c)} →</button>`:""}</div><div class="grade">${its.map(card).join("")}</div></section>` }).join(""):"";
  $("#tGrade").textContent=b?"Resultado da busca":cat==="Todos"?"Produtos":cat;
  $("#nGrade").textContent=lst.length?nP(lst.length):"";
  $("#grid").innerHTML=lst.length?lst.map(card).join(""):`<p class="vazio">${ps.length?"Nenhum produto encontrado. Tente outra busca.":"Nenhum produto no catálogo ainda."}</p>`;
  renderCarrinho();
}
function muda(id,d){
  const c=carrinho[id]||{q:0,pers:""}; c.q=Math.max(0,Math.min(999,c.q+d));
  if(c.q) carrinho[id]=c; else delete carrinho[id];
  if(d>0&&c.q===1) toast("Adicionado ao carrinho");
  render(); if($("#dProd").open) abreProduto(id); if($("#dCarr").open) renderCarrinho();
}

const vaiProdutos=()=>{ const y=$("#produtos").getBoundingClientRect().top+scrollY; scrollTo({top:y,behavior:"smooth"}) };

/* banners rotativos: trocam sozinhos a cada 5 s e param enquanto o cliente mexe */
function banners(){
  const bs=dados.banners||[]; $("#banners").hidden=!bs.length; if(!bs.length) return;
  $("#bnTrilho").innerHTML=bs.map((b,i)=>{ const tag=b.alvo?"button":"div";
    return `<${tag} ${tag==="button"?'type="button"':""} class="bn${b.cel?" cel":""}" ${b.alvo?`data-alvo="${esc(b.alvo)}"`:""} aria-label="${esc(b.titulo||"Banner "+(i+1))}"><picture>${b.cel?`<source media="(max-width:640px)" srcset="${esc(b.cel)}">`:""}<img src="${esc(b.img)}" alt="${esc(b.titulo||"")}" ${i?'loading="lazy"':'fetchpriority="high"'}></picture></${tag}>` }).join("");
  $("#bnTrilho").classList.toggle("temcel",bs.some(b=>b.cel)); // no celular todos ficam 3:2; quem não tem foto do celular aparece inteiro
  const um=bs.length<2; document.querySelectorAll(".bnseta").forEach(x=>x.hidden=um);
  $("#bnPontos").innerHTML=um?"":bs.map((_,i)=>`<button type="button" data-bnp="${i}" class="${i?"":"on"}" aria-label="Banner ${i+1}"></button>`).join("");
  const t=$("#bnTrilho");
  t.addEventListener("scroll",()=>{ const i=bnAtual(); document.querySelectorAll("#bnPontos button").forEach((p,k)=>p.classList.toggle("on",k===i)) },{passive:true});
  if(um||matchMedia("(prefers-reduced-motion:reduce)").matches) return;
  let parado=false; const box=$(".bnbox");
  for(const [ev,v] of [["mouseenter",true],["mouseleave",false],["touchstart",true],["touchend",false],["focusin",true],["focusout",false]]) box.addEventListener(ev,()=>{ parado=v; if(!v) bnTempo() },{passive:true});
  function bnTempo(){ clearTimeout(banners._t); banners._t=setTimeout(()=>{ if(!parado&&!document.hidden) bnVai(bnAtual()+1); bnTempo() },5000) }
  bnTempo();
}
const bnAtual=()=>{ const t=$("#bnTrilho"); return Math.round(t.scrollLeft/Math.max(1,t.clientWidth)) };
function bnVai(i){ const t=$("#bnTrilho"), n=t.children.length; if(!n) return; i=(i+n)%n; t.scrollTo({left:i*t.clientWidth,behavior:"smooth"}) }
function bnAbre(alvo){
  if(alvo.startsWith("cat:")){ const c=alvo.slice(4); cat=dados.produtos.some(p=>p.categoria===c)?c:"Todos"; busca=""; $("#busca").value=""; render(); return vaiProdutos() }
  if(alvo.startsWith("p:")){ const id=alvo.slice(2); if(item(id)) abreProduto(id); return }
  if(alvo.startsWith("kit:")){ if(item(alvo)) abreProduto(alvo); return }
  if(/^https:\/\//i.test(alvo)) window.open(alvo,"_blank","noopener");
}

/* janela do produto */
function abreProduto(id){
  const x=item(id); if(!x) return; const q=carrinho[id]?.q||0;
  $("#dProd").innerHTML=`<button class="x" type="button" data-fecha aria-label="Fechar">✕</button><div class="dp">
    <div class="ph">${x.foto?`<img src="${esc(x.foto)}" alt="${esc(x.nome)}">`:x.kit?"KIT":"3D"}</div>
    <div class="info">${x.categoria?`<span class="cat" style="font-size:12px;color:var(--suave);font-weight:700;text-transform:uppercase;letter-spacing:.06em">${esc(x.categoria)}</span>`:""}
      <h2 class="titulo">${esc(x.nome)}</h2>
      <div>${x.avulso>x.preco?`<span class="de">${brl(x.avulso)}</span>`:""}<span class="preco" style="font-size:28px">${brl(x.preco)}</span></div>
      ${x.descricao?`<p>${esc(x.descricao)}</p>`:""}
      ${x.prontaEntrega?'<p><b style="color:var(--verde)">Pronta entrega</b> · sai mais rápido</p>':""}
      ${x.personalizavel?`<label>Personalização <span style="font-weight:400;color:var(--suave)">(opcional)</span><input class="campo" data-pers="${esc(id)}" maxlength="200" placeholder="Nome, cor, texto…" value="${esc(carrinho[id]?.pers||"")}"></label>`:""}
      <div class="acoes">${q?qtdHtml(id,q)+`<button class="grande" type="button" data-abre-carr>Ver carrinho</button>`:`<button class="grande" type="button" data-id="${esc(id)}" data-d="1">Adicionar ao carrinho · ${brl(x.preco)}</button>`}</div>
    </div></div>`;
  if(!$("#dProd").open) $("#dProd").showModal();
}

/* carrinho */
function itens(){ return Object.entries(carrinho).map(([id,c])=>({p:item(id),...c})).filter(x=>x.p&&x.q>0) }
function descontoCupom(tot){ if(!cupom) return 0; if(cupom.minimo>0&&tot<cupom.minimo) return 0; return Math.min(tot,cupom.tipo==="valor"?cupom.valor:tot*cupom.valor/100) }
function renderCarrinho(){
  const its=itens(); salva();
  const n=its.reduce((s,x)=>s+x.q,0), tot=its.reduce((s,x)=>s+x.q*x.p.preco,0), des=descontoCupom(tot);
  $("#nCarr").textContent=n; $("#flut").classList.toggle("tem",n>0);
  $("#flutTxt").textContent=`Ver carrinho · ${n} ${n===1?"item":"itens"}`; $("#flutTot").textContent=brl(tot-des);
  $("#dcTit").textContent=n?`Seu pedido (${n})`:"Seu pedido";
  $("#dcCorpo").innerHTML=its.length?its.map(x=>`<div class="it" data-id="${esc(x.p.id)}">
      <div class="mini">${x.p.foto?`<img src="${esc(x.p.foto)}" alt="">`:""}</div>
      <div><b>${esc(x.p.nome)}</b><small>${brl(x.p.preco)} cada</small></div>
      <div style="text-align:right">${qtdHtml(x.p.id,x.q)}<small style="margin-top:4px">${brl(x.q*x.p.preco)}</small></div>
      ${x.p.personalizavel?`<input class="campo" data-pers="${esc(x.p.id)}" maxlength="200" placeholder="Personalização: nome, cor, texto…" value="${esc(x.pers||"")}">`:""}
    </div>`).join(""):`<p class="vazio" style="padding:30px 0">Seu carrinho está vazio.<br>Escolha um produto para começar.</p>`;
  $("#dcPe").hidden=!its.length;
  const fr=freteAtual(tot-des);
  $("#linDesc").hidden=!(des>0); $("#vDesc").textContent="− "+brl(des);
  $("#linFrete").hidden=ent.tipo!=="entrega"||!ent.achou; $("#vFrete").textContent=fr.txt;
  $("#vTot").textContent=brl(tot-des+fr.valor);
  if(cupom) $("#cupMsg").textContent=des>0?`Cupom ${cupom.codigo} aplicado.`:`O cupom ${cupom.codigo} vale a partir de ${brl(cupom.minimo)}.`;
}
function abreCarrinho(){ if($("#dProd").open) $("#dProd").close(); renderCarrinho(); if(!$("#dCarr").open) $("#dCarr").showModal() }
async function aplicaCupom(){
  const cod=$("#cCupom").value.trim().toUpperCase().replace(/\s+/g,""); if(!cod){cupom=null;$("#cupMsg").textContent="";renderCarrinho();return}
  $("#cupMsg").textContent="Conferindo…";
  try{ const r=await fetch("/api/publico/cupom?codigo="+encodeURIComponent(cod)); const j=await r.json(); if(!r.ok) throw new Error(j.erro||"Cupom inválido.");
    cupom=j; try{sessionStorage.setItem("cat3d.cupom",cod)}catch(e){} renderCarrinho() }
  catch(err){ cupom=null; $("#cupMsg").textContent=err.message; renderCarrinho() }
}

/* entrega ou retirada */
const opE=()=>dados?.entrega||{retirada:true,entrega:false};
function freteAtual(sub){
  if(ent.tipo!=="entrega"||!ent.achou) return {valor:0,txt:""};
  if(ent.combinar) return {valor:0,txt:"a combinar"};
  const g=opE().gratisAcima; if(g>0&&sub>=g) return {valor:0,txt:"Grátis"};
  return {valor:Number(ent.valor)||0,txt:brl(ent.valor)};
}
function montaEntrega(){
  const o=opE(); const ambos=o.retirada&&o.entrega;
  $("#recBox").hidden=!o.entrega&&!o.retiradaTxt;
  $("#recOpc").hidden=!ambos;
  if(!o.entrega) ent.tipo="retirada"; else if(!o.retirada) ent.tipo="entrega";
  $("#recRetTxt").textContent=o.retiradaTxt?"Sem frete · ver onde":"Sem frete";
  document.querySelector(`input[name="rec"][value="${ent.tipo}"]`).checked=true;
  $("#eCep").value=ent.cep?ent.cep.replace(/(\d{5})(\d{3})/,"$1-$2"):""; $("#eRua").value=ent.rua; $("#eNum").value=ent.numero; $("#eComp").value=ent.complemento; $("#eBairro").value=ent.bairro;
  mostraEntrega(); if(ent.tipo==="entrega"&&ent.cep.length===8) buscaFrete();
}
function mostraEntrega(){
  const o=opE(), e=ent.tipo==="entrega";
  $("#endBox").hidden=!e; $("#endCampos").hidden=!e||!ent.achou;
  if(!e){ $("#eMsg").className="nota"; $("#eMsg").textContent=""; const r=$("#recBox").querySelector(".rtxt")||Object.assign(document.createElement("p"),{className:"nota rtxt"}); r.textContent=o.retiradaTxt?"Retirada: "+o.retiradaTxt:""; r.hidden=!o.retiradaTxt; $("#recBox").appendChild(r) }
  else $("#recBox").querySelector(".rtxt")?.remove();
  if(o.gratisAcima>0&&e&&!ent.combinar) $("#eMsg").dataset.gratis=` Frete grátis a partir de ${brl(o.gratisAcima)}.`;
  renderCarrinho();
}
const salvaEnt=()=>{ try{ const {achou,...x}=ent; localStorage.setItem("cat3d.entrega",JSON.stringify(x)) }catch(e){} };
async function buscaFrete(){
  const cep=ent.cep, m=$("#eMsg"); m.className="nota"; m.textContent="Buscando o CEP…"; ent.achou=false; mostraEntrega();
  try{ const r=await fetch("/api/publico/frete?cep="+cep); const j=await r.json(); if(ent.cep!==cep) return; if(!r.ok) throw new Error(j.erro||"CEP não encontrado.");
    ent={...ent,cidade:j.cidade,uf:j.uf,valor:j.valor,combinar:j.valor==null,achou:true};
    if(!ent.rua||ent._cepRua!==cep){ ent.rua=j.rua; ent.bairro=j.bairro; ent._cepRua=cep; $("#eRua").value=j.rua; $("#eBairro").value=j.bairro }
    m.className="nota "+(ent.combinar?"aviso":"bom");
    m.textContent=`${j.cidade}/${j.uf}${j.km!=null?" · "+String(j.km).replace(".",",")+" km":""} · ${ent.combinar?"Frete a combinar pelo WhatsApp depois do pedido.":"Frete "+brl(j.valor)+"."}${!ent.combinar&&opE().gratisAcima>0?" Grátis a partir de "+brl(opE().gratisAcima)+".":""}`;
    salvaEnt(); mostraEntrega(); if(!$("#eNum").value) $("#eNum").focus();
  }catch(err){ if(ent.cep!==cep) return; m.className="nota aviso"; m.textContent=err.message; ent.achou=false; mostraEntrega() }
}
$("#recOpc").addEventListener("change",e=>{ ent.tipo=e.target.value; salvaEnt(); mostraEntrega(); if(ent.tipo==="entrega"){ if(ent.cep.length===8&&!ent.achou) buscaFrete(); else $("#eCep").focus() } });
$("#eCep").addEventListener("input",e=>{ const d=e.target.value.replace(/\D/g,"").slice(0,8); e.target.value=d.length>5?d.slice(0,5)+"-"+d.slice(5):d;
  if(d!==ent.cep){ ent.cep=d; ent.achou=false; if(d.length===8) buscaFrete(); else { $("#eMsg").textContent=""; mostraEntrega() } } });
for(const [id,k] of [["#eRua","rua"],["#eNum","numero"],["#eComp","complemento"],["#eBairro","bairro"]]) $(id).addEventListener("input",e=>{ ent[k]=e.target.value; salvaEnt() });

/* pedido: cria no sistema e mostra o link para aprovar e pagar */
$("#dcPe").addEventListener("submit",async e=>{
  e.preventDefault(); $("#cErro").textContent="";
  cli={nome:$("#cNome").value.trim(),whatsapp:$("#cWhats").value.trim()}; try{localStorage.setItem("cat3d.cliente",JSON.stringify(cli))}catch(err){}
  if(cli.nome.length<2){ $("#cErro").textContent="Digite seu nome."; return $("#cNome").focus() }
  if(cli.whatsapp.replace(/\D/g,"").length<10){ $("#cErro").textContent="Digite seu WhatsApp com DDD."; return $("#cWhats").focus() }
  if(ent.tipo==="entrega"){
    if(!ent.achou){ $("#cErro").textContent="Digite o CEP da entrega."; return $("#eCep").focus() }
    if(!ent.rua.trim()){ $("#cErro").textContent="Digite a rua da entrega."; return $("#eRua").focus() }
    if(!ent.numero.trim()){ $("#cErro").textContent="Digite o número do endereço."; return $("#eNum").focus() }
  }
  const btn=$("#cEnviar"); btn.disabled=true; btn.textContent="Enviando…";
  try{
    const corpo={nome:cli.nome,whatsapp:cli.whatsapp,cupom:cupom?cupom.codigo:"",entrega:ent.tipo==="entrega"?{tipo:"entrega",cep:ent.cep,rua:ent.rua,numero:ent.numero,complemento:ent.complemento,bairro:ent.bairro}:{tipo:"retirada"},itens:itens().map(x=>x.p.kit?{kit:x.p.kit,q:x.q,pers:x.pers||""}:{id:x.p.id,q:x.q,pers:x.pers||""})};
    const r=await fetch("/api/publico/pedido",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(corpo)});
    const j=await r.json().catch(()=>({})); if(!r.ok) throw new Error(j.erro||"Não deu para enviar o pedido. Tente de novo.");
    carrinho={}; salva(); render();
    const wa=waLoja(), msg=`Olá! Acabei de fazer o pedido #${j.numero} pelo catálogo.`;
    $("#dcCorpo").innerHTML=`<div class="ok"><div class="ic" aria-hidden="true">✓</div><h2 class="titulo">Pedido #${j.numero} recebido!</h2>
      <p>Obrigado, ${esc(cli.nome.split(" ")[0])}! No link do pedido você confere os itens, aprova e paga${dados.loja.cartao?" por Pix ou cartão":" por Pix"}. Guarde o link para acompanhar.${ent.tipo==="entrega"&&ent.combinar?" O frete para a sua cidade a gente combina pelo WhatsApp.":""}</p>
      ${j.link?`<a class="grande" href="${esc(j.link)}">Ver meu pedido e pagar</a>`:""}
      ${wa?`<a class="sec" href="https://wa.me/${wa}?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">Falar com a loja no WhatsApp</a>`:""}</div>`;
    $("#dcPe").hidden=true;
  }catch(err){ $("#cErro").textContent=err.message }
  finally{ btn.disabled=false; btn.textContent="Fazer pedido" }
});

/* cliques e campos */
document.addEventListener("click",e=>{
  const d=e.target.closest("[data-d]"); if(d){ e.stopPropagation(); return muda(d.dataset.id||d.closest("[data-id]").dataset.id,Number(d.dataset.d)) }
  if(e.target.closest("[data-abre-carr]")) return abreCarrinho();
  if(e.target.closest("[data-fecha]")){ e.target.closest("dialog").close(); return }
  const c=e.target.closest("[data-c]"); if(c){ cat=c.dataset.c; render(); if(!c.closest("#cats")||scrollY>$("#produtos").offsetTop) vaiProdutos(); return }
  const bn=e.target.closest("[data-bn]"); if(bn) return bnVai(bnAtual()+Number(bn.dataset.bn));
  const bp=e.target.closest("[data-bnp]"); if(bp) return bnVai(Number(bp.dataset.bnp));
  const ba=e.target.closest("[data-alvo]"); if(ba) return bnAbre(ba.dataset.alvo);
  const v=e.target.closest("[data-ver]"); if(v&&!e.target.closest("input")) return abreProduto(v.dataset.ver);
});
for(const id of ["#dProd","#dCarr"]) $(id).addEventListener("click",e=>{ if(e.target===e.currentTarget) e.currentTarget.close() }); // clique fora fecha
$("#dProd").addEventListener("close",()=>{ if(foco){ foco=null; try{history.replaceState(null,"","/catalogo")}catch(e){} } });
document.addEventListener("input",e=>{
  const p=e.target.closest("[data-pers]"); if(p){ const id=p.dataset.pers; if(carrinho[id]){ carrinho[id].pers=p.value; salva() } else if(item(id)) carrinho[id]={q:0,pers:p.value}; return }
});
$("#busca").addEventListener("input",e=>{ busca=e.target.value; render() });
$("#cAplicar").addEventListener("click",aplicaCupom);
$("#cCupom").addEventListener("keydown",e=>{ if(e.key==="Enter"){ e.preventDefault(); aplicaCupom() } });
carrega();
})();

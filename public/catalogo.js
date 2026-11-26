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
// ordem da vitrine: "vendidos" (como vem do servidor), "az", "menor", "maior"; lembra a escolha do cliente
let ordem="vendidos"; try{ ordem=localStorage.getItem("cat3d.ordem")||"vendidos" }catch(e){}
const ORDENA={az:(a,b)=>a.nome.localeCompare(b.nome,"pt-BR",{sensitivity:"base"}),menor:(a,b)=>a.preco-b.preco||a.nome.localeCompare(b.nome,"pt-BR"),maior:(a,b)=>b.preco-a.preco||a.nome.localeCompare(b.nome,"pt-BR")};
let foco=new URLSearchParams(location.search).get("p")||(()=>{ const m=location.pathname.match(/^\/produto\/([^/]+)/); try{ return m?decodeURIComponent(m[1]):null }catch(e){ return null } })();
const focoCurto=(location.pathname.match(/^\/c\/([^/]+)/)||[])[1]||""; // link curto /c/<código>: vira o id quando o catálogo carregar
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
  zap:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 20.5l1.3-4.2A8.5 8.5 0 1 1 8 19.4z"/><path d="M9 8.5c0 3.5 3 6.5 6.5 6.5l1-1.6-2-1-1 .9a5 5 0 0 1-2.3-2.3l.9-1-1-2z"/></svg>',
  ig:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.2" cy="6.8" r=".6" fill="currentColor"/></svg>',
  site:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18"/></svg>',
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
  heroProdutos();
  duoCards();
  if(L.cartao) document.querySelectorAll(".ncartao").forEach(s=>s.textContent=" ou cartão em até 12x");
  if(L.prazoDias) $("#fqPrazo").textContent=`Peças à pronta entrega saem logo. As sob encomenda ficam prontas em até ${L.prazoDias} dias depois da arte aprovada.`;
  const wa=waLoja(), ig=String(L.instagram||"").replace(/^@/,"");
  if(wa){ $("#zap").href=`https://wa.me/${wa}?text=${encodeURIComponent(`Olá! Vim pelo catálogo da ${L.nome} e queria tirar uma dúvida.`)}`; $("#zap").hidden=false } // botão flutuante
  if(L.site){ const url=/^https?:/i.test(L.site)?L.site:"https://"+L.site; $("#lkSite").href=url; $("#lkSite").hidden=false }
  // rodapé: contatos com ícone, categorias, pagamento e selo de compra segura
  const fone=wa?(wa.length===13?`(${wa.slice(2,4)}) ${wa.slice(4,9)}-${wa.slice(9)}`:wa.length===12?`(${wa.slice(2,4)}) ${wa.slice(4,8)}-${wa.slice(8)}`:"WhatsApp"):"";
  $("#links").innerHTML=[wa?`<a href="https://wa.me/${wa}" target="_blank" rel="noopener">${ICONES.zap}WhatsApp: ${esc(fone)}</a>`:"",ig?`<a href="https://instagram.com/${encodeURIComponent(ig)}" target="_blank" rel="noopener">${ICONES.ig}@${esc(ig)}</a>`:"",
    L.site?`<a href="${esc(/^https?:/i.test(L.site)?L.site:"https://"+L.site)}" target="_blank" rel="noopener">${ICONES.site}${esc(L.site.replace(/^https?:\/\//,"").replace(/\/$/,""))}</a>`:""].join("");
  if(L.sobre) $("#rpSobre").textContent=L.sobre;
  $("#seguroTxt").textContent=L.cartao?"Pagamento via Mercado Pago":"Pix com confirmação automática";
  $("#rpPag").innerHTML=[`<li class="ck">Pix com confirmação na hora</li>`,L.cartao?`<li class="ck">Cartão em até 12x</li>`:"",`<li class="ck">Arte aprovada antes de imprimir</li>`,`<li class="ck">Retirada ou entrega</li>`].join("");
  $("#rpCopy").textContent=`© ${new Date().getFullYear()} ${L.nome}. Todos os direitos reservados.`;
  { const cs=[...new Set(dados.produtos.map(p=>p.categoria).filter(Boolean))].slice(0,7);
    $("#rpCats").innerHTML=(cs.length?cs:["Todos"]).map(c=>`<li><button type="button" data-c="${esc(c)}">${esc(c)}</button></li>`).join("") }
  if(L.cartao) $("#nCartao").textContent=" ou cartão em até 12x";
  dados.kits=dados.kits||[];
  for(const id of Object.keys(carrinho)) if(!item(id)) delete carrinho[id]; // tira o que saiu do catálogo
  for(const [id,c] of Object.entries(carrinho)) if(c.cor&&!(item(id).cores||[]).some(k=>k.nome===c.cor)) delete c.cor; // cor que saiu da lista
  $("#cupBox").hidden=!dados.temCupom;
  if(dados.temCupom){ let c=""; try{c=new URLSearchParams(location.search).get("cupom")||sessionStorage.getItem("cat3d.cupom")||""}catch(e){} if(c){ $("#cCupom").value=c; setTimeout(aplicaCupom,0) } }
  $("#cNome").value=cli.nome; $("#cWhats").value=cli.whatsapp;
  montaEntrega();
  banners();
  render();
  if(focoCurto&&!foco){ const l=dados.produtos.filter(p=>p.id.toLowerCase().startsWith(focoCurto.toLowerCase())); if(l.length===1) foco=l[0].id }
  if(foco&&item(foco)) abreProduto(foco);
  avaliacoes();
  refazer();
}
// "Pedir de novo": o link do pedido entregue traz ?refazer=token; os itens que ainda existem vão para o carrinho
async function refazer(){
  let tk=null; try{ tk=new URLSearchParams(location.search).get("refazer") }catch(e){} if(!tk) return;
  try{ history.replaceState(null,"","/") }catch(e){}
  try{ const r=await fetch("/api/publico/pedido/"+encodeURIComponent(tk)+"/refazer"); if(!r.ok) throw 0; const j=await r.json();
    for(const i of j.itens){ const id=i.kit?"kit:"+i.kit:i.id; if(!item(id)) continue; const c=carrinho[id]||{q:0,pers:""}; c.q=Math.min(999,c.q+i.q); if(i.pers) c.pers=i.pers; if(i.ad&&i.ad.length) c.ad=i.ad; if(i.cor) c.cor=i.cor; carrinho[id]=c }
    salva(); render(); if(itens().length) abreCarrinho();
    toast(j.itens.length?`Os itens do pedido #${j.numero} estão no carrinho${j.faltaram?` (${j.faltaram} não está${j.faltaram>1?"ão":""} mais no catálogo)`:""}.`:"Os itens desse pedido não estão mais no catálogo.");
  }catch(e){ toast("Não deu para refazer esse pedido.") }
}
// avaliações escolhidas pela loja
function avaliacoes(){
  const l=dados.avaliacoes||[]; $("#avals").hidden=!l.length; if(!l.length) return;
  const media=l.reduce((s,a)=>s+a.nota,0)/l.length;
  $("#nAval").textContent=`${media.toFixed(1).replace(".",",")} ★ · ${l.length} ${l.length===1?"avaliação":"avaliações"}`;
  $("#avalGrid").innerHTML=l.map(a=>`<figure class="avalc"><div class="est">${"★".repeat(a.nota)}<i>${"★".repeat(5-a.nota)}</i></div>${a.texto?`<blockquote>“${esc(a.texto)}”</blockquote>`:""}<figcaption><b>${esc(a.nome)}</b>${a.item?` · ${esc(a.item)}`:""}</figcaption></figure>`).join("");
}
const waLoja=()=>{ const n=String(dados?.loja?.whatsapp||"").replace(/\D/g,""); return n?(n.length<=11?"55"+n:n):"" };
// produto ou kit pelo id do carrinho ("kit:<id>" para kits)
function item(id){
  if(String(id).startsWith("kit:")){ const k=dados.kits.find(x=>"kit:"+x.id===id); return k&&{id,nome:"Kit "+k.nome,preco:k.preco,foto:k.foto,personalizavel:true,kit:k.id,descricao:k.descricao||k.itens.map(i=>`${i.q}× ${i.nome}`).join(" + "),avulso:k.avulso} }
  const p=dados.produtos.find(x=>x.id===id); return p&&{...p};
}
// adicionais marcados (só os que ainda existem) e o preço de uma unidade com eles
const adEscolha=id=>{ const x=item(id), a=carrinho[id]?.ad||[]; return (x?.adicionais||[]).map((v,i)=>({...v,i})).filter(v=>a.includes(v.i)) };
const precoUn=id=>{ const x=item(id); return x?x.preco+adEscolha(id).reduce((s,v)=>s+v.preco,0):0 };
const qtdHtml=(id,q)=>q?`<span class="qtd" data-id="${esc(id)}"><button type="button" data-d="-1" aria-label="Menos">−</button><span>${q}</span><button type="button" data-d="1" aria-label="Mais">+</button></span>`
  :`<button class="add" type="button" data-id="${esc(id)}" data-d="1">Adicionar</button>`;
const amostra=c=>`<i class="am" style="background:${/^#[0-9a-f]{6}$/i.test(c.hex||"")?c.hex:"#d5d9dc"}"></i>`;
const bolas=cs=>`<div class="bolas" aria-label="${cs.length} ${cs.length===1?"cor":"cores"}">${cs.slice(0,8).map(amostra).join("")}${cs.length>8?`<span>+${cs.length-8}</span>`:""}<span>${cs.length} ${cs.length===1?"cor":"cores"}</span></div>`;
function card(x){
  const q=carrinho[x.id]?.q||0;
  return `<article class="prod" data-ver="${esc(x.id)}">
    <div class="ph">${x.foto?`<img src="${esc(x.foto)}" alt="${esc(x.nome)}" loading="lazy">`:x.kit?"KIT":"3D"}
      ${x.fotos?.length>1?`<span class="nfotos" aria-label="${x.fotos.length} fotos">${x.fotos.length} fotos</span>`:""}<div class="selos-ph">${x.maisVendido?'<span class="tag mv">Mais vendido</span>':""}${x.prontaEntrega?'<span class="tag pe">Pronta entrega</span>':""}${x.personalizavel&&!x.kit?'<span class="tag">Personalizável</span>':""}</div></div>
    <div class="bd">${x.categoria?`<span class="cat">${esc(x.categoria)}</span>`:""}<h3>${esc(x.nome)}</h3>${x.cores?.length?bolas(x.cores):""}${x.descricao?`<p>${esc(x.descricao)}</p>`:""}
      <div class="ft"><span>${x.avulso>x.preco?`<span class="de">${brl(x.avulso)}</span>`:""}<span class="preco">${brl(x.preco)}</span></span>${qtdHtml(x.id,q)}</div></div>
  </article>`;
}
function render(){
  const ps=dados.produtos, cats=["Todos",...new Set(ps.map(p=>p.categoria).filter(Boolean))];
  $("#cats").innerHTML=cats.length>2?cats.map(c=>`<button class="chip${c===cat?" on":""}" type="button" data-c="${esc(c)}">${esc(c)}</button>`).join(""):"";
  const b=sem(busca).trim();
  const lst=ps.filter(p=>(cat==="Todos"||p.categoria===cat)&&(!b||sem(p.nome+" "+p.descricao+" "+p.categoria).includes(b)));
  if(ORDENA[ordem]) lst.sort(ORDENA[ordem]); // "mais vendidos" mantém a ordem do servidor
  if($("#ordem")) $("#ordem").value=ordem;
  vitrineTopo(cats,cat==="Todos"&&!b);
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
  const x0=item(id);
  if(d>0&&x0?.cores?.length&&!carrinho[id]?.cor){ // sem cor escolhida: abre o produto para escolher
    if(!$("#dProd").open) abreProduto(id);
    const f=$("#dProd .cores"); if(f){ f.classList.add("falta"); f.scrollIntoView({block:"nearest",behavior:"smooth"}) }
    toast("Escolha a cor"); return }
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

/* banner do topo com os produtos: troca sozinho a cada 5,5 s e para enquanto o cliente mexe */
function heroProdutos(){
  const ps=dados.produtos.filter(p=>p.foto)
    .map((p,i)=>({p,i,peso:(p.maisVendido?2:0)+(p.prontaEntrega?1:0)}))
    .sort((a,b)=>b.peso-a.peso||a.i-b.i).slice(0,6).map(x=>x.p);
  if(!ps.length) return; // fica o slide de boas-vindas
  const sobre=dados.loja.sobre||"Peça impressa em 3D, feita para você.";
  $("#hTrilho").innerHTML=ps.map((p,i)=>{ const T=i?"h2":"h1";
    return `<div class="hs${i?"":" on"}" role="group" aria-roledescription="slide" aria-label="${i+1} de ${ps.length}">
      <div class="htx"><small>${esc(p.categoria||"Impressão 3D")}</small><${T} class="titulo hn">${esc(p.nome)}</${T}><p>${esc(p.descricao||sobre)}</p>
        <div class="hac"><div class="hpr"><small>${p.personalizavel?"Personalizável":p.prontaEntrega?"Pronta entrega":"Sob encomenda"}</small><b>${brl(p.preco)}</b></div>
          <button type="button" class="cta" data-ver="${esc(p.id)}">Ver produto</button><button type="button" class="cta sec" data-id="${esc(p.id)}" data-d="1">Adicionar</button></div></div>
      <button type="button" class="hft" data-ver="${esc(p.id)}" aria-label="Ver ${esc(p.nome)}" tabindex="-1"><img src="${esc(p.foto)}" alt="${esc(p.nome)}" ${i?'loading="lazy"':'fetchpriority="high"'}>${p.maisVendido?'<span class="tg">Mais vendido</span>':p.prontaEntrega?'<span class="tg">Pronta entrega</span>':""}</button>
    </div>` }).join("");
  const um=ps.length<2; document.querySelectorAll(".hseta").forEach(b=>b.hidden=um);
  $("#hPontos").innerHTML=um?"":ps.map((p,i)=>`<button type="button" data-hp="${i}" class="${i?"":"on"}" aria-label="Ver ${esc(p.nome)}"></button>`).join("");
  const t=$("#hTrilho");
  // enquanto a rolagem suave anda (seta, bolinha ou troca automática), o slide de destino já fica ativo
  t.addEventListener("scroll",()=>{ if(hAlvo!=null&&hAtual()!==hAlvo) return; hAlvo=null; hMarca(hAtual()) },{passive:true});
  t.addEventListener("touchstart",()=>{ hAlvo=null },{passive:true});
  if(um||matchMedia("(prefers-reduced-motion:reduce)").matches) return;
  let parado=false; const box=$(".hbox");
  for(const [ev,v] of [["mouseenter",true],["mouseleave",false],["touchstart",true],["touchend",false],["focusin",true],["focusout",false]]) box.addEventListener(ev,()=>{ parado=v; if(!v) tempo() },{passive:true});
  function tempo(){ clearTimeout(heroProdutos._t); heroProdutos._t=setTimeout(()=>{ if(!parado&&!document.hidden&&!$("#dProd").open) hVai(hAtual()+1); tempo() },5500) }
  tempo();
}
let hAlvo=null;
const hAtual=()=>{ const t=$("#hTrilho"); return Math.round(t.scrollLeft/Math.max(1,t.clientWidth)) };
const hMarca=i=>{ [...$("#hTrilho").children].forEach((s,k)=>s.classList.toggle("on",k===i)); document.querySelectorAll("#hPontos button").forEach((b,k)=>b.classList.toggle("on",k===i)) };
function hVai(i){ const t=$("#hTrilho"), n=t.children.length; if(!n) return; i=(i+n)%n; hAlvo=i; hMarca(i); t.scrollTo({left:i*t.clientWidth,behavior:"smooth"}) }
/* dois caminhos: peças para você e brindes para empresa (com foto dos próprios produtos) */
const catBrinde=()=>[...new Set(dados.produtos.map(p=>p.categoria).filter(Boolean))].find(c=>/brinde|empresa|corporativ/i.test(sem(c)));
function duoCards(){
  const ps=dados.produtos; $("#duo").hidden=!ps.length; if(!ps.length) return;
  const cb=catBrinde(), foto=p=>p?`<img src="${esc(p.foto)}" alt="" loading="lazy">`:"";
  const a=ps.find(p=>p.foto&&p.categoria!==cb), b=(cb&&ps.find(p=>p.foto&&p.categoria===cb))||ps.filter(p=>p.foto&&p!==a)[1]||ps.find(p=>p.foto&&p!==a);
  $("#duoA").innerHTML=foto(a); $("#duoB").innerHTML=foto(b);
  $("#duoBt").textContent=cb?"Ver brindes":"Pedir orçamento";
}
$("#duoBt").addEventListener("click",()=>{
  const cb=catBrinde(); if(cb){ cat=cb; busca=""; $("#busca").value=""; render(); return vaiProdutos() }
  const wa=waLoja(); if(wa) return window.open(`https://wa.me/${wa}?text=${encodeURIComponent("Olá! Queria um orçamento de brindes impressos em 3D com a logo da minha empresa.")}`,"_blank","noopener");
  vaiProdutos();
});
/* categorias em bolinhas e os mais pedidos (só na vitrine inteira, sem busca) */
function vitrineTopo(cats,inteira){
  const ps=dados.produtos, cs=cats.slice(1);
  $("#catsSec").hidden=cs.length<2; $("#lkCats").hidden=cs.length<2;
  $("#bolCats").innerHTML=cs.map(c=>{ const its=ps.filter(p=>p.categoria===c), f=its.find(p=>p.foto);
    return `<button type="button" class="bolcat" data-c="${esc(c)}"><i>${f?`<img src="${esc(f.foto)}" alt="" loading="lazy">`:esc(c.slice(0,1))}</i>${esc(c)}<small>${its.length} ${its.length===1?"peça":"peças"}</small></button>` }).join("");
  const top=ps.map((p,i)=>({p,i,peso:(p.maisVendido?2:0)+(p.prontaEntrega?1:0)})).sort((a,b)=>b.peso-a.peso||a.i-b.i).slice(0,8).map(x=>x.p);
  $("#topSec").hidden=!inteira||ps.length<5;
  $("#topGrid").innerHTML=$("#topSec").hidden?"":top.map(card).join("");
}

/* janela do produto */
function abreProduto(id){
  const x=item(id); if(!x) return; const q=carrinho[id]?.q||0;
  const esc_=esc(id), cor=carrinho[id]?.cor||"";
  const icShare='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4"/></svg>';
  const icZap='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l1.3-3.9A8 8 0 1 1 8 19z"/><path d="M9.5 9.5c.3 1.6 1.4 3 3 3.9l1-1 2 1-.5 1.5c-2.8 0-6-3-6-6l1.5-.5 1 2z"/></svg>';
  $("#dProd").innerHTML=`<button class="x" type="button" data-fecha aria-label="Fechar">✕</button><div class="dp">
    <div class="ph">${galeria(x)}</div>
    <div class="info">
      <div class="dp-cab">${x.categoria?`<span class="cat">${esc(x.categoria)}</span>`:""}<h2 class="titulo">${esc(x.nome)}</h2></div>
      <div class="dp-preco"><div>${x.avulso>x.preco?`<span class="de">${brl(x.avulso)}</span>`:""}<span class="preco">${brl(x.preco)}</span>${x.prontaEntrega?'<span class="pe">Pronta entrega</span>':""}</div>
        <div class="dp-sh"><button type="button" data-share="${esc_}" aria-label="Compartilhar este produto" title="Compartilhar">${icShare}</button><a href="https://wa.me/?text=${encodeURIComponent(`${x.nome} · ${brl(x.preco)}\n${linkItem(x)}`)}" target="_blank" rel="noopener" aria-label="Enviar no WhatsApp" title="Enviar no WhatsApp">${icZap}</a></div></div>
      ${x.descricao?`<p class="dp-desc">${esc(x.descricao)}</p>`:""}
      ${x.cores?.length?`<div class="opt cores" role="radiogroup" aria-label="Cor"><div class="opt-t">Cor <span>${cor?esc(cor):"escolha uma"}</span></div><div class="corop">${x.cores.map(c=>`<label title="${esc(c.nome)}"><input type="radio" name="cor-${esc_}" data-cor="${esc_}" value="${esc(c.nome)}"${cor===c.nome?" checked":""}>${amostra(c)}<span>${esc(c.nome)}</span></label>`).join("")}</div></div>`:""}
      ${x.adicionais?.length?`<div class="opt"><div class="opt-t">Adicionais <span>opcional</span></div><div class="adlist">${x.adicionais.map((v,i)=>`<label class="adc"><input type="checkbox" data-ad="${esc_}" value="${i}"${(carrinho[id]?.ad||[]).includes(i)?" checked":""}><span>${esc(v.nome)}</span><b>${v.preco>0?"+ "+brl(v.preco):"grátis"}</b></label>`).join("")}</div></div>`:""}
      ${x.personalizavel?`<label class="opt"><span class="opt-t">Personalização <span>opcional</span></span><input class="campo" data-pers="${esc_}" maxlength="200" placeholder="Nome, texto ou detalhe" value="${esc(carrinho[id]?.pers||"")}"></label>`:""}
      <div class="dp-pe">
        <div class="acoes">${q?qtdHtml(id,q)+`<button class="grande" type="button" data-abre-carr>Ver carrinho · ${brl(q*precoUn(id))}</button>`:`<button class="grande" type="button" data-id="${esc_}" data-d="1">Adicionar ao carrinho · ${brl(precoUn(id))}</button>`}</div>
        ${x.kit?"":`<button type="button" class="orclink" data-orc="${esc_}">Mais unidades ou algo diferente? <span>Solicitar orçamento</span></button>`}
      </div>
    </div></div>`;
  if(!$("#dProd").open) $("#dProd").showModal();
  foco=id; try{ history.replaceState(null,"",linkItem(x).replace(location.origin,"")) }catch(e){} // o endereço vira o do produto
  ligaGaleria();
}
/* pedido de orçamento de um produto: vira um Orçamento no painel; a loja responde com o valor pelo WhatsApp */
function abreOrcamento(id){
  const x=item(id); if(!x) return; const info=$("#dProd .info"); if(!info) return;
  info.innerHTML=`<h2 class="titulo">Solicitar orçamento</h2>
    <p>${esc(x.nome)}. Conte o que você precisa e a loja responde pelo WhatsApp com o valor e o prazo.</p>
    <form class="orcform" id="orcForm" data-id="${esc(id)}">
      <label>Quantidade<input class="campo" id="oQtd" type="number" min="1" max="100000" inputmode="numeric" value="${Math.max(1,carrinho[id]?.q||10)}" required></label>
      ${x.cores?.length?`<label><span>Cor <small class="opc">(opcional)</small></span><select class="campo" id="oCor"><option value="">Ainda não sei</option>${x.cores.map(c=>`<option${carrinho[id]?.cor===c.nome?" selected":""}>${esc(c.nome)}</option>`).join("")}</select></label>`:""}
      <label><span>O que você precisa <small class="opc">(opcional)</small></span><textarea class="campo" id="oTxt" rows="3" maxlength="600" placeholder="Ex.: com a logo da empresa, para o dia 15/12"></textarea></label>
      <div class="dados"><label>Seu nome<input class="campo" id="oNome" maxlength="80" autocomplete="name" value="${esc(cli.nome)}" required></label>
        <label>WhatsApp<input class="campo" id="oWhats" maxlength="20" inputmode="tel" autocomplete="tel" placeholder="(41) 91234-5678" value="${esc(cli.whatsapp)}" required></label></div>
      <p class="erro" id="oErro" role="alert"></p>
      <div class="acoes"><button class="grande" type="submit" id="oEnviar">Enviar pedido de orçamento</button></div>
      <button type="button" class="voltar" data-ver="${esc(id)}">Voltar ao produto</button>
    </form>`;
  $("#oQtd").focus();
}
document.addEventListener("submit",async e=>{
  if(e.target.id!=="orcForm") return; e.preventDefault();
  const f=e.target, id=f.dataset.id, err=$("#oErro"); err.textContent="";
  cli={nome:$("#oNome").value.trim(),whatsapp:$("#oWhats").value.trim()}; try{localStorage.setItem("cat3d.cliente",JSON.stringify(cli))}catch(x){}
  if(cli.nome.length<2){ err.textContent="Digite seu nome."; return $("#oNome").focus() }
  if(cli.whatsapp.replace(/\D/g,"").length<10){ err.textContent="Digite seu WhatsApp com DDD."; return $("#oWhats").focus() }
  const b=$("#oEnviar"); b.disabled=true; b.textContent="Enviando…";
  try{
    const r=await fetch("/api/publico/orcamento",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id,q:Number($("#oQtd").value),cor:$("#oCor")?.value||"",texto:$("#oTxt").value,nome:cli.nome,whatsapp:cli.whatsapp})});
    const j=await r.json().catch(()=>({})); if(!r.ok) throw new Error(j.erro||"Não deu para enviar. Tente de novo.");
    const wa=waLoja(), x=item(id);
    $("#dProd .info").innerHTML=`<div class="ok"><div class="ic" aria-hidden="true">✓</div><h2 class="titulo">Pedido de orçamento #${j.numero} enviado</h2>
      <p>Obrigado, ${esc(cli.nome.split(" ")[0])}. A loja responde pelo WhatsApp com o valor e o link para aprovar e pagar.</p>
      ${wa?`<a class="sec" href="https://wa.me/${wa}?text=${encodeURIComponent(`Olá! Acabei de pedir o orçamento #${j.numero} de ${x?.nome||"um produto"} pelo catálogo.`)}" target="_blank" rel="noopener">Falar com a loja no WhatsApp</a>`:""}</div>`;
  }catch(x){ err.textContent=x.message; b.disabled=false; b.textContent="Enviar pedido de orçamento" }
});
/* foto do produto em tela cheia: arrasta para o lado entre as fotos; fecha no ✕, no Esc ou tocando fora da foto */
function zoomFotos(id,ini){
  const x=item(id); if(!x) return; const fs=x.fotos?.length?x.fotos:x.foto?[x.foto]:[]; if(!fs.length) return;
  const z=document.createElement("div"); z.className="zoomf"; z.setAttribute("role","dialog"); z.setAttribute("aria-modal","true"); z.setAttribute("aria-label",`Fotos de ${x.nome}`);
  z.innerHTML=`<div class="ztr">${fs.map((u,i)=>`<div class="zsl"><img src="${esc(u)}" alt="${esc(x.nome)} · foto ${i+1} de ${fs.length}"></div>`).join("")}</div>
    <button type="button" class="zx" aria-label="Fechar">✕</button>${fs.length>1?`<span class="zct">${ini+1}/${fs.length}</span><button type="button" class="zs e" data-zv="-1" aria-label="Foto anterior">‹</button><button type="button" class="zs d" data-zv="1" aria-label="Próxima foto">›</button>`:""}`;
  $("#dProd").appendChild(z); // dentro da janela do produto, para ficar por cima dela
  const tr=z.querySelector(".ztr"), at=()=>Math.round(tr.scrollLeft/Math.max(1,tr.clientWidth));
  tr.scrollLeft=ini*tr.clientWidth;
  tr.addEventListener("scroll",()=>{ const c=z.querySelector(".zct"); if(c) c.textContent=`${at()+1}/${fs.length}` },{passive:true});
  const fecha=()=>{ z.remove(); document.removeEventListener("keydown",tecla,true) };
  const tecla=ev=>{ if(ev.key==="Escape"){ ev.preventDefault(); ev.stopPropagation(); fecha() } else if(ev.key==="ArrowRight"||ev.key==="ArrowLeft") tr.scrollTo({left:(at()+(ev.key==="ArrowRight"?1:-1))*tr.clientWidth,behavior:"smooth"}) };
  z.addEventListener("click",ev=>{ ev.stopPropagation(); const v=ev.target.closest("[data-zv]"); if(v) return tr.scrollTo({left:(at()+Number(v.dataset.zv))*tr.clientWidth,behavior:"smooth"}); if(ev.target.closest(".zx")||ev.target.classList.contains("zsl")) fecha() });
  document.addEventListener("keydown",tecla,true); z.querySelector(".zx").focus();
}
/* link de um produto só (abre o catálogo já nele, com foto e preço na prévia do WhatsApp) */
const slugNome=s=>String(s||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,70)||"produto";
// link curto para compartilhar: /c/<menor começo do id que não repete> (o servidor usa a mesma regra)
const codCurto=id=>{ const ids=(dados?.produtos||[]).map(p=>p.id); for(let k=5;k<id.length;k++){ const c=id.slice(0,k); if(!ids.some(o=>o!==id&&o.startsWith(c))) return c } return id };
const linkItem=x=>location.origin+(x.kit?"/?p="+encodeURIComponent(x.id):"/c/"+encodeURIComponent(codCurto(x.id)));
async function compartilha(id){
  const x=item(id); if(!x) return; const url=linkItem(x);
  if(navigator.share){ try{ await navigator.share({title:x.nome,text:`${x.nome} · ${brl(x.preco)}`,url}); return }catch(e){ if(e.name==="AbortError") return } }
  try{ await navigator.clipboard.writeText(url); toast("Link do produto copiado") }catch(e){ prompt("Copie o link do produto:",url) }
}
/* galeria de fotos do produto: arrasta para o lado, setas, bolinhas e miniaturas */
function galeria(x){
  const fs_=x.fotos||[]; if(fs_.length<2) return x.foto?`<img src="${esc(x.foto)}" alt="${esc(x.nome)}">`:x.kit?"KIT":"3D";
  return `<div class="gal"><div class="galtr" id="galTr">${fs_.map((f,i)=>`<img src="${esc(f)}" alt="${esc(x.nome)} · foto ${i+1} de ${fs_.length}"${i?' loading="lazy"':""}>`).join("")}</div>
    <button type="button" class="galseta e" data-gv="-1" aria-label="Foto anterior">‹</button><button type="button" class="galseta d" data-gv="1" aria-label="Próxima foto">›</button>
    <span class="galnum" id="galNum">1/${fs_.length}</span>
    <div class="galmin">${fs_.map((f,i)=>`<button type="button" data-gi="${i}" aria-label="Ver foto ${i+1}"${i?"":' class="on"'}><img src="${esc(f)}" alt=""></button>`).join("")}</div></div>`;
}
function ligaGaleria(){
  const t=$("#galTr"); if(!t) return; const n=t.children.length, gal=t.closest(".gal");
  const atual=()=>Math.round(t.scrollLeft/Math.max(1,t.clientWidth));
  let alvo=null; // enquanto a rolagem suave anda, o contador já mostra a foto de destino
  const marca=i=>{ $("#galNum").textContent=(i+1)+"/"+n; gal.querySelectorAll(".galmin button").forEach((b,k)=>b.classList.toggle("on",k===i)) };
  const vai=i=>{ i=(i+n)%n; alvo=i; marca(i); t.scrollTo({left:i*t.clientWidth,behavior:"smooth"}) };
  t.addEventListener("scroll",()=>{ const i=atual(); if(alvo!=null&&i!==alvo) return; alvo=null; marca(i) },{passive:true});
  t.addEventListener("touchstart",()=>{ alvo=null },{passive:true});
  gal.addEventListener("click",e=>{ const s=e.target.closest("[data-gv]"), m=e.target.closest("[data-gi]"); if(s) vai((alvo??atual())+Number(s.dataset.gv)); else if(m) vai(Number(m.dataset.gi)) });
  gal.addEventListener("keydown",e=>{ if(e.key==="ArrowLeft"){ e.preventDefault(); vai(atual()-1) } else if(e.key==="ArrowRight"){ e.preventDefault(); vai(atual()+1) } });
}

/* carrinho */
function itens(){ return Object.entries(carrinho).map(([id,c])=>({p:item(id),...c,pu:precoUn(id),ads:adEscolha(id)})).filter(x=>x.p&&x.q>0) }
function descontoCupom(tot){ if(!cupom) return 0; if(cupom.minimo>0&&tot<cupom.minimo) return 0; return Math.min(tot,cupom.tipo==="valor"?cupom.valor:tot*cupom.valor/100) }
function renderCarrinho(){
  const its=itens(); salva();
  const n=its.reduce((s,x)=>s+x.q,0), tot=its.reduce((s,x)=>s+x.q*x.pu,0), des=descontoCupom(tot);
  $("#nCarr").textContent=n; $("#flut").classList.toggle("tem",n>0);
  $("#flutTxt").textContent=`Ver carrinho · ${n} ${n===1?"item":"itens"}`; $("#flutTot").textContent=brl(tot-des);
  $("#dcTit").textContent=n?`Seu pedido (${n})`:"Seu pedido";
  $("#dcCorpo").innerHTML=its.length?its.map(x=>`<div class="it" data-id="${esc(x.p.id)}">
      <div class="mini">${x.p.foto?`<img src="${esc(x.p.foto)}" alt="">`:""}</div>
      <div><b>${esc(x.p.nome)}</b>${x.cor?`<small class="adtx">${amostra((x.p.cores||[]).find(k=>k.nome===x.cor)||{})} Cor ${esc(x.cor)}</small>`:""}${x.ads.length?`<small class="adtx">+ ${esc(x.ads.map(v=>v.nome).join(", "))}</small>`:""}<small>${brl(x.pu)} cada</small></div>
      <div style="text-align:right">${qtdHtml(x.p.id,x.q)}<small style="margin-top:4px">${brl(x.q*x.pu)}</small></div>
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
  const btn=$("#cEnviar"); btn.disabled=true; btn.textContent="Enviando…"; let saindo=false;
  try{
    const corpo={nome:cli.nome,whatsapp:cli.whatsapp,cupom:cupom?cupom.codigo:"",entrega:ent.tipo==="entrega"?{tipo:"entrega",cep:ent.cep,rua:ent.rua,numero:ent.numero,complemento:ent.complemento,bairro:ent.bairro}:{tipo:"retirada"},itens:itens().map(x=>x.p.kit?{kit:x.p.kit,q:x.q,pers:x.pers||""}:{id:x.p.id,q:x.q,pers:x.pers||"",ad:x.ads.map(v=>v.i),cor:x.cor||""})};
    const r=await fetch("/api/publico/pedido",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(corpo)});
    const j=await r.json().catch(()=>({})); if(!r.ok) throw new Error(j.erro||"Não deu para enviar o pedido. Tente de novo.");
    carrinho={}; salva(); render();
    // preço fechado: vai direto para a tela de pagamento do pedido (100% ou entrada, Pix ou cartão)
    if(j.direto&&j.link){ saindo=true; btn.textContent="Abrindo o pagamento…"; location.href=j.link; return }
    const wa=waLoja(), msg=`Olá! Acabei de fazer o pedido #${j.numero} pelo catálogo.`;
    $("#dcCorpo").innerHTML=`<div class="ok"><div class="ic" aria-hidden="true">✓</div><h2 class="titulo">Pedido #${j.numero} recebido</h2>
      <p>Obrigado, ${esc(cli.nome.split(" ")[0])}. No link do pedido você confere os itens, aprova e paga${dados.loja.cartao?" por Pix ou cartão":" por Pix"}. Guarde o link para acompanhar.${ent.tipo==="entrega"&&ent.combinar?" O frete para a sua cidade a gente combina pelo WhatsApp.":""}</p>
      ${j.link?`<a class="grande" href="${esc(j.link)}">Ver meu pedido e pagar</a>`:""}
      ${wa?`<a class="sec" href="https://wa.me/${wa}?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">Falar com a loja no WhatsApp</a>`:""}</div>`;
    $("#dcPe").hidden=true;
  }catch(err){ $("#cErro").textContent=err.message }
  finally{ if(!saindo){ btn.disabled=false; btn.textContent="Fazer pedido" } }
});

/* cliques e campos */
document.addEventListener("click",e=>{
  const d=e.target.closest("[data-d]"); if(d){ e.stopPropagation(); return muda(d.dataset.id||d.closest("[data-id]").dataset.id,Number(d.dataset.d)) }
  if(e.target.closest("[data-abre-carr]")) return abreCarrinho();
  const zf=e.target.closest("#dProd .ph img"); if(zf&&!zf.closest(".galmin")){ const tr=zf.closest(".galtr"); return zoomFotos(foco,tr?[...tr.children].indexOf(zf):0) }
  const sh=e.target.closest("[data-share]"); if(sh) return compartilha(sh.dataset.share);
  const oc=e.target.closest("[data-orc]"); if(oc) return abreOrcamento(oc.dataset.orc);
  if(e.target.closest("[data-fecha]")){ e.target.closest("dialog").close(); return }
  const c=e.target.closest("[data-c]"); if(c){ cat=c.dataset.c; render(); if(!c.closest("#cats")||scrollY>$("#produtos").offsetTop) vaiProdutos(); return }
  const hv=e.target.closest("[data-hv]"); if(hv) return hVai((hAlvo??hAtual())+Number(hv.dataset.hv));
  const hp=e.target.closest("[data-hp]"); if(hp) return hVai(Number(hp.dataset.hp));
  const bn=e.target.closest("[data-bn]"); if(bn) return bnVai(bnAtual()+Number(bn.dataset.bn));
  const bp=e.target.closest("[data-bnp]"); if(bp) return bnVai(Number(bp.dataset.bnp));
  const ba=e.target.closest("[data-alvo]"); if(ba) return bnAbre(ba.dataset.alvo);
  const v=e.target.closest("[data-ver]"); if(v&&!e.target.closest("input")) return abreProduto(v.dataset.ver);
});
for(const id of ["#dProd","#dCarr"]) $(id).addEventListener("click",e=>{ if(e.target===e.currentTarget) e.currentTarget.close() }); // clique fora fecha
$("#dProd").addEventListener("close",()=>{ if(foco){ foco=null; try{history.replaceState(null,"","/")}catch(e){} } });
document.addEventListener("input",e=>{
  const k=e.target.closest("[data-cor]"); if(k){ const id=k.dataset.cor; if(!item(id)) return; const c=carrinho[id]||(carrinho[id]={q:0,pers:""}); c.cor=k.value; salva(); renderCarrinho(); abreProduto(id); return }
  const a=e.target.closest("[data-ad]"); if(a){ const id=a.dataset.ad; if(!item(id)) return; const c=carrinho[id]||(carrinho[id]={q:0,pers:""}), v=Number(a.value);
    c.ad=(c.ad||[]).filter(k=>k!==v); if(a.checked) c.ad.push(v); c.ad.sort((x,y)=>x-y); salva(); renderCarrinho(); abreProduto(id); return }
  const p=e.target.closest("[data-pers]"); if(p){ const id=p.dataset.pers; if(carrinho[id]){ carrinho[id].pers=p.value; salva() } else if(item(id)) carrinho[id]={q:0,pers:p.value}; return }
});
$("#busca").addEventListener("input",e=>{ busca=e.target.value; render() });
$("#ordem").addEventListener("change",e=>{ ordem=e.target.value; try{localStorage.setItem("cat3d.ordem",ordem)}catch(x){} render() });
$("#cAplicar").addEventListener("click",aplicaCupom);
$("#cCupom").addEventListener("keydown",e=>{ if(e.key==="Enter"){ e.preventDefault(); aplicaCupom() } });
carrega();
})();

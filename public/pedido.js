(function(){
"use strict";
/* Link do pedido para o cliente: um passo a passo só, sempre na mesma ordem.
   1 Orçamento → 2 Pagamento de 50% → 3 Arte → 4 Produção → 5 Pronto e entrega.
   Só o passo atual fica aberto; os feitos aparecem com ✓ e os próximos em cinza. */
const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const brl=v=>Number(v||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const dataBR=s=>s?s.split("-").reverse().join("/"):"";
const quando=iso=>iso?new Date(iso).toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}):"";
const token=location.pathname.split("/").filter(Boolean)[1]||"";
const V=v=>"V"+String(v).padStart(2,"0");
function toast(m){const t=$("#toast");t.textContent=m;t.hidden=false;clearTimeout(toast._t);toast._t=setTimeout(()=>t.hidden=true,2600)}
async function copia(txt,msg){try{await navigator.clipboard.writeText(txt);toast(msg)}catch(e){toast("Selecione o texto e copie")}}
async function envia(url,body){
  const r=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body||{})});
  const j=await r.json().catch(()=>({})); if(!r.ok) throw new Error(j.erro||"Não deu para enviar. Tente de novo."); return j;
}
const seguro=d=>d.pix?.auto?`<div class="seguro"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg><div><b>Compra segura</b><span>Pagamento processado pelo Mercado Pago, com confirmação automática. Os dados do seu cartão não passam pela loja.</span></div></div>`:"";
const pixHtml=d=>`<div class="pixw">
  ${d.pix.renova!=null?`<div class="tempo" id="tempo" data-fim="${Date.now()+d.pix.renova}"><span>Código Pix válido nesta tela por</span><b id="tempoTxt">05:00</b></div>`:""}
  <div class="qr">${d.pix.svg}</div>
  <div class="cod" id="pixCod">${esc(d.pix.payload)}</div>
  <button class="btn pri" type="button" data-a="copPix">Copiar código Pix</button>
  ${d.pix.chave?`<div class="chave"><div><span>Ou pague pela chave Pix${d.pix.nome?` · ${esc(d.pix.nome)}`:""}</span><b>${esc(d.pix.chave)}</b></div><button class="btn sm" type="button" data-a="copChave">Copiar</button></div>`:""}
</div>`;

// Pix ou cartão: com a Public Key do Mercado Pago, o cliente escolhe a forma; o cartão usa o formulário deles (Card Payment Brick).
const pagHtml=d=>!d.cartao?pixHtml(d):`<div class="formas" role="tablist">
    <button type="button" class="fm on" role="tab" aria-selected="true" data-a="fPix">Pix</button>
    <button type="button" class="fm" role="tab" aria-selected="false" data-a="fCartao">Cartão de crédito<small>até ${d.cartao.parcelas}x</small></button>
  </div>
  <div data-forma="pix">${pixHtml(d)}</div>
  <div data-forma="cartao" class="fecha"><div id="cardBrick"></div><p class="exp">Parcele em até ${d.cartao.parcelas}x: depois de digitar o número do cartão, escolha as parcelas. Os juros do parcelamento aparecem antes de você confirmar. Cada parcela tem um valor mínimo, então valores pequenos ficam só à vista.</p></div>`;
// Caixa de "Pagamento aprovado" (cartão ou Pix), com o que acontece a seguir.
const PROXIMO={arte:"Agora preparamos a sua arte. Ela aparece aqui para você aprovar.",producao:"Seu pedido já foi para a produção.",pronto:"Pedido quitado! Combine a retirada ou a entrega com a loja.",entregue:"Pedido quitado. Obrigado!"};
async function aprovado(detalhe){
  await carrega();
  const n=carrega.d, z=document.createElement("div"); z.className="ok-pag"; z.setAttribute("role","dialog"); z.setAttribute("aria-modal","true");
  z.innerHTML=`<div class="ok-box"><div class="ok-ic" aria-hidden="true">✓</div><h2>Pagamento aprovado!</h2><p>${esc(detalhe)}</p>${n&&PROXIMO[n.etapa]?`<p class="ok-prox">${PROXIMO[n.etapa]}</p>`:""}<button class="btn pri" type="button">Ver meu pedido</button></div>`;
  const fecha=()=>{ z.remove(); document.querySelector(".passo .agora")?.scrollIntoView({behavior:"smooth",block:"start"}) };
  z.addEventListener("click",ev=>{ if(ev.target===z||ev.target.closest("button")) fecha() });
  document.body.appendChild(z); z.querySelector("button").focus();
}
function sdkMP(){
  return sdkMP.p||=new Promise((ok,erro)=>{const s=document.createElement("script");s.src="https://sdk.mercadopago.com/js/v2";s.onload=ok;s.onerror=()=>{sdkMP.p=null;erro(new Error("Não deu para abrir o pagamento com cartão. Tente de novo ou use o Pix."))};document.head.appendChild(s)});
}
async function montaCartao(d){
  const el=document.getElementById("cardBrick"); if(!el||el.childElementCount) return;
  el.innerHTML=`<p class="exp">Carregando o formulário do cartão…</p>`;
  await sdkMP(); el.innerHTML="";
  const mp=new MercadoPago(d.cartao.publicKey,{locale:"pt-BR"});
  try{await montaCartao.brick?.unmount()}catch(e){}
  montaCartao.brick=await mp.bricks().create("cardPayment","cardBrick",{
    initialization:{amount:d.cartao.valor,payer:{email:d.cartao.email}}, // e-mail já preenchido: o campo some do formulário
    customization:{paymentMethods:{maxInstallments:d.cartao.parcelas,types:{excluded:["debit_card"]}}},
    callbacks:{
      onReady:()=>{},
      onError:e=>console.error("cartão",e),
      onSubmit:dados=>envia(`/api/publico/pedido/${encodeURIComponent(token)}/cartao`,dados).then(async j=>{
        if(j.analise) return toast("Pagamento em análise. Esta página avança quando for aprovado.");
        const x=Number(dados.installments)||1;
        await aprovado(`${brl(d.cartao.valor)} no cartão de crédito${x>1?` em ${x}x`:" à vista"}.`);
      }).catch(err=>{ toast(err.message); throw err }),
    },
  });
}

function relogio(){
  clearInterval(relogio._t);
  const el=document.getElementById("tempo"); if(!el) return;
  const passo=()=>{ const r=Math.max(0,Number(el.dataset.fim)-Date.now()), m=Math.floor(r/60000), s2=Math.floor(r%60000/1000);
    const t=document.getElementById("tempoTxt"); if(t) t.textContent=`${String(m).padStart(2,"0")}:${String(s2).padStart(2,"0")}`;
    el.classList.toggle("fim",r<60000);
    if(r<=0){ clearInterval(relogio._t); carrega() } };
  passo(); relogio._t=setInterval(passo,1000);
}
async function carrega(){
  let d;
  try{const r=await fetch("/api/publico/pedido/"+encodeURIComponent(token));if(!r.ok)throw new Error(r.status);d=await r.json()}
  catch(e){$("#ped").innerHTML=`<div class="vazio"><h2>Pedido não encontrado</h2><p>O link pode estar incompleto. Peça um novo link para a loja.</p></div>`;return}
  carrega.d=d; const L=d.loja, et=d.etapa;
  if(L.cor) document.documentElement.style.setProperty("--cor",L.cor);
  document.title=`Pedido #${d.numero} · ${L.nome}`;
  const wa=t=>L.whatsapp?"https://wa.me/"+(L.whatsapp.length<=11?"55"+L.whatsapp:L.whatsapp)+"?text="+encodeURIComponent(t):null;
  const restante=Math.max(0,d.total-d.entrada);

  // os 5 passos: [chave, título, resumo quando feito]
  const temArte=!!d.precisaArte;
  const passos=[
    ["orcamento","Orçamento",d.resposta?.acao==="aprovado"?`Aprovado em ${quando(d.resposta.em)}`:"Aprovado"],
    ["pagamento",et==="orcamento"&&restante>0?"Pagamento":`Pagamento de ${d.entrada>0&&d.total>0?Math.round(d.entrada/d.total*100)+"%":"entrada"}`,`Entrada de ${brl(d.entrada)} recebida`],
    ...(temArte?[["arte","Aprovação da arte",d.arte?`Arte ${V(d.arte.v)} aprovada`:"Arte aprovada"]]:[]),
    ["producao","Produção","Produzido"],
    ["pronto","Pronto e entrega","Entregue"],
  ];
  const ordem=passos.map(p=>p[0]), atual=et==="entregue"?ordem.length:Math.max(0,ordem.indexOf(et));

  const corpo={};
  corpo.orcamento=`
    ${d.fotos&&d.fotos.length?`<div class="carrossel" id="carrossel">
      <div class="trilho" id="trilho">${d.fotos.map((u,i)=>`<button type="button" class="slide" data-a="zoom" data-src="${esc(u)}" aria-label="Foto ${i+1} de ${d.fotos.length}. Toque para ampliar"><img src="${esc(u)}" alt="Foto ${i+1} do orçamento" ${i?'loading="lazy"':''}></button>`).join("")}</div>
      ${d.fotos.length>1?`<button type="button" class="seta esq" data-a="fotoAnt" aria-label="Foto anterior">‹</button><button type="button" class="seta dir" data-a="fotoProx" aria-label="Próxima foto">›</button>
      <span class="cont" id="fotoCont">1/${d.fotos.length}</span>
      <div class="pontos">${d.fotos.map((_,i)=>`<span class="${i?"":"on"}"></span>`).join("")}</div>`:""}
    </div>`:""}
    <ul class="lista">${d.itens.map(i=>`<li>${i.foto&&!i.personalizacao?`<button type="button" class="fotobig" data-a="zoom" data-src="${esc(i.foto)}" aria-label="Ver a foto de ${esc(i.descricao)} em tela cheia"><img src="${esc(i.foto)}" alt="${esc(i.descricao)}" loading="lazy"><span>Toque para ampliar</span></button>`:""}<span class="txt"><b>${esc(i.descricao)}</b>${i.personalizacao?`<span class="tag">${esc(i.personalizacao)}</span>`:""}<small>${Number(i.quantidade).toLocaleString("pt-BR")} × ${brl(i.preco)}</small></span><b>${brl(i.quantidade*i.preco)}</b></li>`).join("")}</ul>
    <div class="tot"><span>Total</span><b>${brl(d.total)}</b></div>
    ${d.entrada>0&&restante>0
    ?`<p class="exp">Como você prefere pagar? O pagamento é por Pix, logo depois de aprovar.${d.prazo?` Prazo: pronto até <b>${dataBR(d.prazo)}</b>.`:""}</p>
      <div class="opcoes" role="radiogroup" aria-label="Forma de pagamento">
        <label class="opc"><input type="radio" name="pagar" value="total" checked><span><b>Pagar 100% agora: ${brl(d.total)} <em class="rec">Recomendado</em></b><small>Quita o pedido de uma vez e não precisa pagar mais nada na entrega</small></span></label>
        <label class="opc"><input type="radio" name="pagar" value="entrada"><span><b>Entrada de ${Math.round(d.entrada/d.total*100)}%: ${brl(d.entrada)}</b><small>E o restante, ${brl(restante)}, quando ficar pronto</small></span></label>
      </div>`
    :`<p class="exp">${d.entrada>0?`Ao aprovar, você paga <b>${brl(d.entrada)}</b> por Pix para começarmos.`:"Ao aprovar, seu pedido segue para a produção."}${d.prazo?` Prazo: pronto até <b>${dataBR(d.prazo)}</b>.`:""}</p>`}
    <div id="resp">
      <div class="acoes" data-etapa="1"><button class="btn pri" type="button" data-a="aprovar">Aprovar orçamento</button><button class="btn" type="button" data-a="recusar">Recusar</button></div>
      <div data-etapa="aprovar" hidden><p class="exp" style="color:var(--tinta)">Confirma a aprovação de <b>${brl(d.total)}</b>?</p><div class="acoes"><button class="btn pri" type="button" data-a="aprovar-ok">Sim, aprovar</button><button class="btn" type="button" data-a="voltar">Voltar</button></div></div>
      <div data-etapa="recusar" hidden><label for="motivo">Quer contar o motivo? (opcional)</label><textarea id="motivo" rows="3" maxlength="300"></textarea><div class="acoes"><button class="btn perigo" type="button" data-a="recusar-ok">Recusar orçamento</button><button class="btn" type="button" data-a="voltar">Voltar</button></div></div>
    </div>`;
  corpo.pagamento=d.pix?.auto
    ?`<div class="valor">${brl(d.pix.valor)}</div>
      <p class="exp">${d.cartao?"Pague por Pix ou cartão de crédito para começarmos.":"Pague por Pix para começarmos. No app do banco, escolha <b>Pix copia e cola</b>: o valor já vem preenchido."} <b>Assim que o pagamento cair, esta página avança sozinha.</b></p>
      ${pagHtml(d)}${seguro(d)}`
    :d.pagInformado
    ?`<div class="aviso"><b>Recebemos o seu aviso de pagamento</b><span>Assim que confirmarmos o Pix, a arte aparece aqui para você aprovar.</span></div>
      ${wa(`Olá! Paguei a entrada do pedido #${d.numero}. Segue o comprovante:`)?`<a class="btn" href="${esc(wa(`Olá! Paguei a entrada do pedido #${d.numero}. Segue o comprovante:`))}" target="_blank" rel="noopener">Enviar o comprovante no WhatsApp</a>`:""}`
    :`<div class="valor">${brl(d.pix?d.pix.valor:d.faltaEntrada)}</div>
      <p class="exp">Pague por Pix para começarmos. No app do banco, escolha <b>Pix copia e cola</b>: o valor já vem preenchido.</p>
      ${d.pix?pixHtml(d):`<p class="exp">Fale com a loja para pagar.</p>`}
      <button class="btn pri" type="button" data-a="paguei">Já paguei</button>`;
  corpo.arte=!d.arte||d.arte.status==="substituida"
    ?`<div class="aviso"><b>Estamos preparando a sua arte</b><span>Ela aparece aqui para você aprovar. Avisamos pelo WhatsApp.</span></div>`
    :d.arte.status==="ajuste"
    ?`<div class="aviso"><b>Recebemos o seu pedido de ajuste</b><span>${d.arte.comentario?`“${esc(d.arte.comentario)}”. `:""}A nova versão aparece aqui.</span></div>`
    :`<figure class="arte"><img src="${esc(d.arte.imagem)}" alt="Arte ${V(d.arte.v)}"><figcaption>${V(d.arte.v)} · As cores impressas podem variar em relação à tela.</figcaption></figure>
      ${d.arte.nota?`<p class="exp"><b>Recado da loja:</b> ${esc(d.arte.nota)}</p>`:""}
      <div id="respArte">
        <div class="acoes" data-etapa="1"><button class="btn pri" type="button" data-a="arte-ok">Aprovar arte</button><button class="btn" type="button" data-a="ajuste">Pedir ajuste</button></div>
        <div data-etapa="arte-ok" hidden><p class="exp" style="color:var(--tinta)">Depois de aprovada, a arte vai para a produção. Confirma?</p><div class="acoes"><button class="btn pri" type="button" data-a="arte-sim">Sim, aprovar a arte</button><button class="btn" type="button" data-a="voltar">Voltar</button></div></div>
        <div data-etapa="ajuste" hidden><label for="coment">O que precisa mudar?</label><textarea id="coment" rows="3" maxlength="600"></textarea><div class="acoes"><button class="btn pri" type="button" data-a="ajuste-ok">Enviar pedido de ajuste</button><button class="btn" type="button" data-a="voltar">Voltar</button></div></div>
      </div>`;
  corpo.producao=`<div class="aviso"><b>Seu pedido está em produção</b><span>${d.prazo?`Previsão: pronto até <b>${dataBR(d.prazo)}</b>. `:""}Avisamos assim que ficar pronto.</span></div>`;
  corpo.pronto=d.pix
    ?`<p class="exp">Seu pedido está pronto! Falta pagar o restante${d.pix.auto?" (a confirmação é automática)":""}:</p><div class="valor">${brl(d.pix.valor)}</div>${pagHtml(d)}
      ${wa(`Olá! Paguei o restante do pedido #${d.numero}. Como combinamos a retirada ou entrega?`)?`<a class="btn" href="${esc(wa(`Olá! Paguei o restante do pedido #${d.numero}. Como combinamos a retirada ou entrega?`))}" target="_blank" rel="noopener">Combinar a entrega no WhatsApp</a>`:""}`
    :`<div class="aviso"><b>Seu pedido está pronto!</b><span>Combine a retirada ou a entrega com a loja.</span></div>
      ${wa(`Olá! Sobre a entrega do pedido #${d.numero}:`)?`<a class="btn pri" href="${esc(wa(`Olá! Sobre a entrega do pedido #${d.numero}:`))}" target="_blank" rel="noopener">Combinar a entrega no WhatsApp</a>`:""}`;

  const recusado=et==="recusado"||et==="cancelado";
  $("#ped").innerHTML=`
  <article class="doc">
    <header class="topo">
      <div class="logo">${L.logo?`<img src="${esc(L.logo)}" alt="${esc(L.nome)}">`:`<div class="nome">${esc(L.nome)}</div>`}</div>
      <div class="num"><small>Pedido</small><b>#${d.numero}</b><span>${esc(d.cliente)}</span></div>
    </header>
    ${recusado?`<div class="aviso"><b>${et==="recusado"?"Você recusou este orçamento":"Pedido cancelado"}</b><span>Se mudar de ideia ou quiser outra opção, é só chamar a loja.</span></div>`
    :et==="entregue"?`<div class="aviso ok"><b>Pedido entregue. Obrigado pela compra!</b><span>Volte sempre.</span></div>`:""}
    ${recusado?"":`<ol class="passo">${passos.map(([k,t,feito],i)=>{
      const st=i<atual?"feito":i===atual?"agora":"depois";
      return `<li class="${st}"><div class="cab"><span class="n">${i<atual?"✓":i+1}</span><div><b>${esc(t)}</b>${st==="feito"?`<small>${esc(feito)}</small>`:""}</div></div>${st==="agora"?`<div class="corpo">${corpo[k]}</div>`:""}</li>`}).join("")}</ol>`}
    <div class="resumo"><div><span>Total</span><b>${brl(d.total)}</b></div><div><span>Pago</span><b>${brl(Math.max(0,d.total-d.receber))}</b></div><div><span>Falta</span><b>${brl(et==="entregue"?0:d.receber)}</b></div></div>
    <footer class="rodape">
      <div class="loja">${esc(L.nome)}${L.whatsappTxt?` · WhatsApp ${esc(L.whatsappTxt)}`:""}${L.site?` · ${esc(L.site)}`:""}</div>
      ${wa(`Olá! Sobre o meu pedido #${d.numero}:`)?`<a href="${esc(wa(`Olá! Sobre o meu pedido #${d.numero}:`))}" target="_blank" rel="noopener">Dúvidas? Fale com a loja</a>`:""}
    </footer>
  </article>`;

  $("#ped").onclick=async e=>{
    const x=e.target.closest("[data-a]"); if(!x) return; const a=x.dataset.a;
    const grupo=x.closest("#resp,#respArte");
    const mostra=et2=>grupo.querySelectorAll("[data-etapa]").forEach(el=>el.hidden=el.dataset.etapa!==et2);
    if(a==="zoom"&&x.closest("#trilho")){ // foto do orçamento: tela cheia que também arrasta entre as fotos
      const fs=d.fotos||[], ini=[...x.parentNode.children].indexOf(x);
      const z=document.createElement("div"); z.className="zoom galz"; z.setAttribute("role","dialog"); z.setAttribute("aria-label","Fotos do orçamento");
      z.innerHTML=`<div class="ztrilho">${fs.map((u,i)=>`<div class="zslide"><img src="${esc(u)}" alt="Foto ${i+1} de ${fs.length}"></div>`).join("")}</div>
        <button type="button" class="zx" aria-label="Fechar">✕</button>${fs.length>1?`<span class="zcont">${ini+1}/${fs.length}</span>`:""}`;
      document.body.appendChild(z); document.body.style.overflow="hidden";
      const tr=z.querySelector(".ztrilho"); tr.scrollLeft=ini*tr.clientWidth;
      tr.addEventListener("scroll",()=>{ const c=z.querySelector(".zcont"); if(c) c.textContent=`${Math.round(tr.scrollLeft/tr.clientWidth)+1}/${fs.length}` },{passive:true});
      const fecha=()=>{ const t=document.getElementById("trilho"); if(t) t.scrollLeft=Math.round(tr.scrollLeft/tr.clientWidth)*t.clientWidth; z.remove(); document.body.style.overflow=""; document.removeEventListener("keydown",tecla) };
      const tecla=ev=>{ if(ev.key==="Escape") fecha() };
      z.addEventListener("click",ev=>{ if(ev.target.closest(".zx")||ev.target.classList.contains("zslide")) fecha() }); // ✕ ou toque fora da foto
      document.addEventListener("keydown",tecla); z.querySelector(".zx").focus();
      return }
    if(a==="zoom"){ const z=document.createElement("div"); z.className="zoom"; z.innerHTML=`<img src="${esc(x.dataset.src)}" alt="">`; z.addEventListener("click",()=>z.remove()); document.body.appendChild(z); return }
    if(a==="fPix"||a==="fCartao"){
      const c=a==="fCartao";
      $("#ped").querySelectorAll(".fm").forEach(b=>{const on=(b.dataset.a==="fCartao")===c;b.classList.toggle("on",on);b.setAttribute("aria-selected",on)});
      $("#ped").querySelector("[data-forma=pix]").hidden=c; $("#ped").querySelector("[data-forma=cartao]").classList.toggle("fecha",!c);
      if(c) montaCartao(d).catch(err=>{ toast(err.message); const el=document.getElementById("cardBrick"); if(el) el.innerHTML="" });
      return;
    }
    if(a==="fotoAnt"||a==="fotoProx"){ const t=document.getElementById("trilho"); if(t) t.scrollBy({left:(a==="fotoProx"?1:-1)*t.clientWidth,behavior:"smooth"}); return }
    if(a==="copPix") return copia(d.pix.payload,"Código Pix copiado");
    if(a==="copChave") return copia(d.pix.chave,"Chave Pix copiada");
    if(["aprovar","recusar","arte-ok","ajuste"].includes(a)){ mostra(a); const t=grupo.querySelector("textarea:not([hidden])"); if(a==="recusar"||a==="ajuste") setTimeout(()=>grupo.querySelector(`[data-etapa="${a}"] textarea`)?.focus(),0); return }
    if(a==="voltar") return mostra("1");
    x.disabled=true;
    try{
      if(a==="aprovar-ok"){ await envia(`/api/publico/pedido/${encodeURIComponent(token)}/resposta`,{acao:"aprovar",pagar:document.querySelector('input[name="pagar"]:checked')?.value||"total"}); toast("Orçamento aprovado!") }
      if(a==="recusar-ok"){ await envia(`/api/publico/pedido/${encodeURIComponent(token)}/resposta`,{acao:"recusar",motivo:$("#motivo").value}); toast("Resposta enviada") }
      if(a==="paguei"){ await envia(`/api/publico/pedido/${encodeURIComponent(token)}/paguei`); toast("Aviso enviado. Obrigado!") }
      if(a==="arte-sim"){ await envia(`/api/publico/arte/${encodeURIComponent(token)}/resposta`,{acao:"aprovar"}); toast("Arte aprovada!") }
      if(a==="ajuste-ok"){ await envia(`/api/publico/arte/${encodeURIComponent(token)}/resposta`,{acao:"ajuste",comentario:$("#coment").value}); toast("Pedido de ajuste enviado") }
      await carrega();
      document.querySelector(".passo .agora")?.scrollIntoView({behavior:"smooth",block:"start"});
    }catch(err){ toast(err.message); x.disabled=false }
  };

  // Pix do Mercado Pago: pergunta de tempos em tempos e avança a página quando o pagamento cair
  relogio(); // contador do código Pix
  const trilho=document.getElementById("trilho");
  if(trilho) trilho.addEventListener("scroll",()=>{ const i=Math.round(trilho.scrollLeft/Math.max(1,trilho.clientWidth)), n=trilho.children.length;
    document.querySelectorAll("#carrossel .pontos span").forEach((p,k)=>p.classList.toggle("on",k===i));
    const c=document.getElementById("fotoCont"); if(c) c.textContent=`${i+1}/${n}`;
    document.querySelector("#carrossel .esq")?.toggleAttribute("disabled",i===0); document.querySelector("#carrossel .dir")?.toggleAttribute("disabled",i===n-1) },{passive:true});
  document.querySelector("#carrossel .esq")?.setAttribute("disabled","");
  // cartão: monta o formulário do Mercado Pago escondido já na abertura, para o clique em "Cartão" mostrar na hora
  if(d.cartao) montaCartao(d).catch(()=>{ const el=document.getElementById("cardBrick"); if(el) el.innerHTML="" });
  clearTimeout(carrega._t);
  if(d.pix?.auto){
    const confere=async()=>{
      if(document.hidden){carrega._t=setTimeout(confere,6000);return}
      try{
        const r=await fetch("/api/publico/pedido/"+encodeURIComponent(token)); const n=await r.json();
        if(n.sinal>d.sinal){ await aprovado(`Recebemos o seu pagamento de ${brl(n.sinal-d.sinal)}.`); return }
        if(n.etapa!==d.etapa){ await carrega(); document.querySelector(".passo .agora")?.scrollIntoView({behavior:"smooth",block:"start"}); return }
      }catch(e){}
      carrega._t=setTimeout(confere,6000);
    };
    carrega._t=setTimeout(confere,6000);
  }
}
carrega();
})();

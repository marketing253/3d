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
const pixHtml=d=>`<div class="pixw">
  <div class="qr">${d.pix.svg}</div>
  <div class="cod" id="pixCod">${esc(d.pix.payload)}</div>
  <button class="btn pri" type="button" data-a="copPix">Copiar código Pix</button>
  ${d.pix.chave?`<div class="chave"><div><span>Ou pague pela chave Pix${d.pix.nome?` · ${esc(d.pix.nome)}`:""}</span><b>${esc(d.pix.chave)}</b></div><button class="btn sm" type="button" data-a="copChave">Copiar</button></div>`:""}
</div>`;

async function carrega(){
  let d;
  try{const r=await fetch("/api/publico/pedido/"+encodeURIComponent(token));if(!r.ok)throw new Error(r.status);d=await r.json()}
  catch(e){$("#ped").innerHTML=`<div class="vazio"><h2>Pedido não encontrado</h2><p>O link pode estar incompleto. Peça um novo link para a loja.</p></div>`;return}
  const L=d.loja, et=d.etapa;
  if(L.cor) document.documentElement.style.setProperty("--cor",L.cor);
  document.title=`Pedido #${d.numero} · ${L.nome}`;
  const wa=t=>L.whatsapp?"https://wa.me/"+(L.whatsapp.length<=11?"55"+L.whatsapp:L.whatsapp)+"?text="+encodeURIComponent(t):null;
  const restante=Math.max(0,d.total-d.entrada);

  // os 5 passos: [chave, título, resumo quando feito]
  const temArte=!!d.precisaArte;
  const passos=[
    ["orcamento","Orçamento",d.resposta?.acao==="aprovado"?`Aprovado em ${quando(d.resposta.em)}`:"Aprovado"],
    ["pagamento",`Pagamento de ${d.entrada>0&&d.total>0?Math.round(d.entrada/d.total*100)+"%":"entrada"}`,`Entrada de ${brl(d.entrada)} recebida`],
    ...(temArte?[["arte","Aprovação da arte",d.arte?`Arte ${V(d.arte.v)} aprovada`:"Arte aprovada"]]:[]),
    ["producao","Produção","Produzido"],
    ["pronto","Pronto e entrega","Entregue"],
  ];
  const ordem=passos.map(p=>p[0]), atual=et==="entregue"?ordem.length:Math.max(0,ordem.indexOf(et));

  const corpo={};
  corpo.orcamento=`
    <ul class="lista">${d.itens.map(i=>`<li>${i.foto&&!i.personalizacao?`<button type="button" class="fotobig" data-a="zoom" data-src="${esc(i.foto)}" aria-label="Ver a foto de ${esc(i.descricao)} em tela cheia"><img src="${esc(i.foto)}" alt="${esc(i.descricao)}" loading="lazy"><span>Toque para ampliar</span></button>`:""}<span class="txt"><b>${esc(i.descricao)}</b>${i.personalizacao?`<span class="tag">${esc(i.personalizacao)}</span>`:""}<small>${Number(i.quantidade).toLocaleString("pt-BR")} × ${brl(i.preco)}</small></span><b>${brl(i.quantidade*i.preco)}</b></li>`).join("")}</ul>
    <div class="tot"><span>Total</span><b>${brl(d.total)}</b></div>
    <p class="exp">${d.entrada>0?`Ao aprovar, você paga <b>${brl(d.entrada)}</b> por Pix para começarmos${restante>0?` e o restante, <b>${brl(restante)}</b>, quando ficar pronto`:""}.`:"Ao aprovar, seu pedido segue para a produção."}${d.prazo?` Prazo: pronto até <b>${dataBR(d.prazo)}</b>.`:""}</p>
    <div id="resp">
      <div class="acoes" data-etapa="1"><button class="btn pri" type="button" data-a="aprovar">Aprovar orçamento</button><button class="btn" type="button" data-a="recusar">Recusar</button></div>
      <div data-etapa="aprovar" hidden><p class="exp" style="color:var(--tinta)">Confirma a aprovação de <b>${brl(d.total)}</b>?</p><div class="acoes"><button class="btn pri" type="button" data-a="aprovar-ok">Sim, aprovar</button><button class="btn" type="button" data-a="voltar">Voltar</button></div></div>
      <div data-etapa="recusar" hidden><label for="motivo">Quer contar o motivo? (opcional)</label><textarea id="motivo" rows="3" maxlength="300"></textarea><div class="acoes"><button class="btn perigo" type="button" data-a="recusar-ok">Recusar orçamento</button><button class="btn" type="button" data-a="voltar">Voltar</button></div></div>
    </div>`;
  corpo.pagamento=d.pagInformado
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
    ?`<p class="exp">Seu pedido está pronto! Falta pagar o restante:</p><div class="valor">${brl(d.pix.valor)}</div>${pixHtml(d)}
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
    if(a==="zoom"){ const z=document.createElement("div"); z.className="zoom"; z.innerHTML=`<img src="${esc(x.dataset.src)}" alt="">`; z.addEventListener("click",()=>z.remove()); document.body.appendChild(z); return }
    if(a==="copPix") return copia(d.pix.payload,"Código Pix copiado");
    if(a==="copChave") return copia(d.pix.chave,"Chave Pix copiada");
    if(["aprovar","recusar","arte-ok","ajuste"].includes(a)){ mostra(a); const t=grupo.querySelector("textarea:not([hidden])"); if(a==="recusar"||a==="ajuste") setTimeout(()=>grupo.querySelector(`[data-etapa="${a}"] textarea`)?.focus(),0); return }
    if(a==="voltar") return mostra("1");
    x.disabled=true;
    try{
      if(a==="aprovar-ok"){ await envia(`/api/publico/pedido/${encodeURIComponent(token)}/resposta`,{acao:"aprovar"}); toast("Orçamento aprovado!") }
      if(a==="recusar-ok"){ await envia(`/api/publico/pedido/${encodeURIComponent(token)}/resposta`,{acao:"recusar",motivo:$("#motivo").value}); toast("Resposta enviada") }
      if(a==="paguei"){ await envia(`/api/publico/pedido/${encodeURIComponent(token)}/paguei`); toast("Aviso enviado. Obrigado!") }
      if(a==="arte-sim"){ await envia(`/api/publico/arte/${encodeURIComponent(token)}/resposta`,{acao:"aprovar"}); toast("Arte aprovada!") }
      if(a==="ajuste-ok"){ await envia(`/api/publico/arte/${encodeURIComponent(token)}/resposta`,{acao:"ajuste",comentario:$("#coment").value}); toast("Pedido de ajuste enviado") }
      await carrega();
      document.querySelector(".passo .agora")?.scrollIntoView({behavior:"smooth",block:"start"});
    }catch(err){ toast(err.message); x.disabled=false }
  };
}
carrega();
})();

(function(){
"use strict";
const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const brl=v=>Number(v||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const dataBR=s=>s?s.split("-").reverse().join("/"):"";
const token=location.pathname.split("/").filter(Boolean)[1]||"";
const ORDEM=["orcamento","aprovado","imprimindo","pronto","entregue"];
// título e explicação do quadro de status
const ST={
  orcamento:["Orçamento aguardando sua aprovação","Confira os itens e os valores abaixo e responda no fim da página.","gira"],
  aprovado:["Pedido aprovado","Seu pedido está na fila de produção.","gira"],
  imprimindo:["Seu pedido está sendo produzido","As peças estão sendo impressas agora.","gira"],
  pronto:["Pedido pronto","Combine a retirada ou a entrega com a loja.","ok"],
  entregue:["Pedido entregue","Obrigado pela compra!","ok"],
  cancelado:["Orçamento recusado","Se mudar de ideia, é só chamar a loja.","x"],
};
function toast(m){const t=$("#toast");t.textContent=m;t.hidden=false;clearTimeout(toast._t);toast._t=setTimeout(()=>t.hidden=true,2600)}
async function copia(txt,msg){try{await navigator.clipboard.writeText(txt);toast(msg)}catch(e){toast("Selecione o texto e copie")}}
async function responde(acao,motivo){
  const r=await fetch("/api/publico/pedido/"+encodeURIComponent(token)+"/resposta",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({acao,motivo})});
  const j=await r.json().catch(()=>({})); if(!r.ok) throw new Error(j.erro||"Não deu para enviar. Tente de novo.");
}
function abrePix(){ $("#pixModal").hidden=false; document.body.style.overflow="hidden" }
function fechaPix(){ $("#pixModal").hidden=true; document.body.style.overflow="" }

async function carrega(){
  let d;
  try{const r=await fetch("/api/publico/pedido/"+encodeURIComponent(token));if(!r.ok)throw new Error(r.status);d=await r.json()}
  catch(e){$("#ped").innerHTML=`<div class="vazio"><h2>Pedido não encontrado</h2><p>O link pode estar incompleto. Peça um novo link para a loja.</p></div>`;return}
  const L=d.loja;
  if(L.cor) document.documentElement.style.setProperty("--cor",L.cor);
  document.title=`Pedido #${d.numero} · ${L.nome}`;
  const pos=ORDEM.indexOf(d.status), st=ST[d.status]||ST.orcamento, recusado=d.status==="cancelado";
  const wa=L.whatsapp?"https://wa.me/"+(L.whatsapp.length<=11?"55"+L.whatsapp:L.whatsapp)+"?text="+encodeURIComponent(
    d.status==="orcamento"?`Olá! Tenho uma dúvida sobre o orçamento #${d.numero}:`:d.pix&&d.pix.tipo==="entrada"?`Olá! Paguei a entrada do pedido #${d.numero}. Segue o comprovante:`:`Olá! Sobre o meu pedido #${d.numero}:`):null;
  const pago=Math.max(0,d.total-d.receber);
  const quando=d.data?dataBR(d.data):"";
  const ladoStatus=d.status==="orcamento"?(d.entrada>0?`<b>Entrada de ${brl(d.entrada)} ao aprovar</b>O restante fica para a entrega.`:`<b>Aprovando, entra na fila de produção</b>`)
    :d.pix&&d.pix.tipo==="entrada"?`<b>Aguardando a entrada de ${brl(d.pix.valor)}</b>A produção começa assim que ela for paga.`
    :d.prazo&&!["entregue","cancelado"].includes(d.status)?`<b>Previsão: pronto até ${dataBR(d.prazo)}</b>Avisamos assim que estiver pronto.`
    :`<b>${esc(st[1])}</b>`;
  $("#ped").innerHTML=`
  <article class="doc">
    <header class="topo">
      <div class="logo">${L.logo?`<img src="${esc(L.logo)}" alt="${esc(L.nome)}">`:`<div class="nome">${esc(L.nome)}</div>`}</div>
      <div class="num"><small>${d.status==="orcamento"||recusado?"Orçamento":"Pedido"}</small><b>#${d.numero}</b><span>${quando}</span></div>
    </header>

    <section class="box status">
      <div><span class="rot">Situação do pedido</span><h1>${esc(st[0])}</h1></div>
      <div class="lado"><i class="ico ${st[2]}" aria-hidden="true"></i><div>${ladoStatus}</div></div>
      ${recusado?"":`<div class="passos">${["Orçamento","Aprovado","Produção","Pronto"].map((n,i)=>`<div class="${pos>=i?"on":""}"><i></i>${n}</div>`).join("")}</div>`}
    </section>

    <div class="dois">
      <section class="box"><span class="rot">Cliente</span><div class="val">${esc(d.cliente||"—")}</div>${d.canal?`<div class="sub">Pedido por ${esc(d.canal)}</div>`:""}</section>
      <section class="box"><span class="rot">Entrega</span><div class="val">${d.prazo&&!recusado?`Pronto até ${dataBR(d.prazo)}`:"A combinar"}</div><div class="sub">Retirada ou envio combinados com a loja</div></section>
    </div>

    ${d.arte?`<section class="box"><span class="rot">Arte</span><div class="val">${d.arte.status==="aprovada"?"Arte aprovada":d.arte.status==="ajuste"?"Ajuste pedido: a loja vai mandar uma nova versão":"Nova arte para você aprovar"}</div>
      <div class="sub" style="margin:4px 0 10px">Versão V${String(d.arte.v).padStart(2,"0")}</div><a class="btn ${d.arte.status==="pendente"?"pri":""} sm" href="/aprovacao/${esc(token)}">${d.arte.status==="pendente"?"Ver e aprovar a arte":"Ver a arte"}</a></section>`:""}

    <section class="box itens">
      <div class="cab"><span class="rot">Itens</span><div class="val">Produtos e serviços</div></div>
      <table><thead><tr><th>Produto</th><th class="n qtd">Qtd.</th><th class="n unit">Unitário</th><th class="n">Total</th></tr></thead><tbody>
      ${d.itens.map(i=>`<tr><td><div class="prod">${i.foto?`<img src="${esc(i.foto)}" alt="" loading="lazy">`:""}<div><b>${esc(i.descricao)}</b>
          <span class="mob">${Number(i.quantidade).toLocaleString("pt-BR")} × ${brl(i.preco)}</span>
          ${i.personalizacao?`<span class="tag">${esc(i.personalizacao)}</span>`:""}</div></div></td>
        <td class="n qtd">${Number(i.quantidade).toLocaleString("pt-BR")}</td><td class="n unit">${brl(i.preco)}</td><td class="n"><b>${brl(i.quantidade*i.preco)}</b></td></tr>`).join("")}
      </tbody></table>
    </section>

    <section class="box resumo">
      ${d.desconto>0?`<div><span>Desconto</span><b>−${brl(d.desconto)}</b></div>`:""}
      ${d.frete>0?`<div><span>Frete</span><b>${brl(d.frete)}</b></div>`:""}
      <div><span>Total do pedido</span><b>${brl(d.total)}</b></div>
      ${d.status==="orcamento"||recusado?"":`<div><span>Valor pago</span><b>${brl(pago)}</b></div>
      <div class="saldo"><span>Saldo a pagar</span><b>${brl(d.status==="entregue"?0:d.receber)}</b></div>`}
    </section>

    ${d.status==="orcamento"?`<section class="box resp" id="resp"><span class="rot">Sua resposta</span><div class="val">O que achou do orçamento?</div>
      <p>${d.entrada>0?`Ao aprovar, aparece o Pix da entrada de <b>${brl(d.entrada)}</b> para começarmos a produção. O restante, ${brl(Math.max(0,d.receber-d.entrada))}, fica para a entrega.`:"Aprovando, já colocamos o seu pedido na fila de produção."}</p>
      <div class="acoes" data-etapa="1"><button class="btn pri" type="button" data-r="aprovar">Aprovar orçamento</button><button class="btn" type="button" data-r="recusar">Recusar</button></div>
      <div data-etapa="aprovar" hidden><p style="color:var(--tinta)">Confirma a aprovação do pedido de <b>${brl(d.total)}</b>?</p><div class="acoes"><button class="btn pri" type="button" data-r="aprovar-ok">Sim, aprovar</button><button class="btn" type="button" data-r="voltar">Voltar</button></div></div>
      <div data-etapa="recusar" hidden><label for="motivo" style="font-weight:600;font-size:14px">Quer contar o motivo? (opcional)</label><textarea id="motivo" rows="3" maxlength="300" placeholder="Ex.: ficou acima do orçamento, prazo muito longo…"></textarea><div class="acoes"><button class="btn perigo" type="button" data-r="recusar-ok">Recusar orçamento</button><button class="btn" type="button" data-r="voltar">Voltar</button></div></div>
      <div class="msg" id="respMsg"></div></section>`:""}

    <footer class="rodape">
      <div class="slogan">${esc(L.sobre||"")}</div>
      <div class="loja">${esc(L.nome)}${L.pagamento?`<br>Pagamento: ${esc(L.pagamento)}`:""}${L.whatsappTxt?`<br>WhatsApp ${esc(L.whatsappTxt)}`:""}${L.site?`<br>${esc(L.site)}`:""}${L.instagram?`<br>${esc(L.instagram.startsWith("@")?L.instagram:"@"+L.instagram)}`:""}</div>
    </footer>
  </article>

  <div class="fora">
    ${d.pix?`<button class="btn pri" type="button" id="btnPix">▣ ${d.pix.tipo==="entrada"?`Pix da entrada · ${brl(d.pix.valor)}`:"Pix para pagamento"}</button>`:""}
    ${wa?`<a class="btn" href="${esc(wa)}" target="_blank" rel="noopener">${d.status==="orcamento"?"Tirar dúvidas no WhatsApp":d.pix&&d.pix.tipo==="entrada"?"Enviar comprovante no WhatsApp":"Falar com a loja no WhatsApp"}</a>`:""}
    <span class="lnk"><a href="/catalogo">Ver o catálogo da loja</a></span>
  </div>

  ${d.pix?`<div class="modal" id="pixModal" hidden role="dialog" aria-modal="true" aria-labelledby="pixTit"><div class="janela">
    <div style="display:flex;justify-content:space-between;align-items:center"><h2 id="pixTit">${d.pix.tipo==="entrada"?"Pix da entrada":"Pix para pagamento"}</h2><button class="btn sm" type="button" data-fecha>Fechar</button></div>
    <div class="valor">${brl(d.pix.valor)}</div>
    <div class="qr">${d.pix.svg}</div>
    <span style="color:var(--suave);font-size:13.5px">No app do banco, escolha <b>Pix copia e cola</b> e cole o código. O valor já vem preenchido.</span>
    <div class="cod" id="pixCod">${esc(d.pix.payload)}</div>
    <button class="btn pri" type="button" id="copPix">Copiar código Pix</button>
    ${d.pix.chave?`<div class="chave"><div><span>Ou pague pela chave Pix${d.pix.nome?` · ${esc(d.pix.nome)}`:""}</span><b>${esc(d.pix.chave)}</b></div><button class="btn sm" type="button" id="copChave">Copiar chave</button></div>`:""}
    <span style="color:var(--suave);font-size:13px">Depois de pagar, mande o comprovante pelo WhatsApp.</span>
  </div></div>`:""}`;

  const bp=$("#btnPix"); if(bp) bp.addEventListener("click",abrePix);
  const m=$("#pixModal"); if(m) m.addEventListener("click",e=>{ if(e.target===m||e.target.closest("[data-fecha]")) fechaPix() });
  const cp=$("#copPix"); if(cp) cp.addEventListener("click",()=>copia(d.pix.payload,"Código Pix copiado"));
  const cc=$("#copChave"); if(cc) cc.addEventListener("click",()=>copia(d.pix.chave,"Chave Pix copiada"));
  const rs=$("#resp");
  if(rs) rs.addEventListener("click",async e=>{
    const x=e.target.closest("[data-r]"); if(!x) return; const a=x.dataset.r;
    const mostra=et=>rs.querySelectorAll("[data-etapa]").forEach(el=>el.hidden=el.dataset.etapa!==et);
    if(a==="aprovar"||a==="recusar"){ mostra(a); if(a==="recusar") $("#motivo").focus(); return }
    if(a==="voltar"){ mostra("1"); return }
    x.disabled=true; $("#respMsg").textContent="";
    try{ await responde(a==="aprovar-ok"?"aprovar":"recusar",a==="recusar-ok"?$("#motivo").value:""); toast(a==="aprovar-ok"?"Orçamento aprovado!":"Resposta enviada"); await carrega(); window.scrollTo({top:0,behavior:"smooth"}); if(a==="aprovar-ok"&&$("#btnPix")) setTimeout(abrePix,600) }
    catch(err){ $("#respMsg").textContent=err.message; x.disabled=false }
  });
}
document.addEventListener("keydown",e=>{ if(e.key==="Escape"&&$("#pixModal")&&!$("#pixModal").hidden) fechaPix() });
carrega();
})();

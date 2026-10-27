(function(){
"use strict";
const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const brl=v=>Number(v||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const dataBR=s=>s?s.split("-").reverse().join("/"):"";
const token=location.pathname.split("/").filter(Boolean)[1]||"";
const ST={cancelado:"Orçamento recusado",orcamento:"Orçamento aguardando sua aprovação",aprovado:"Pedido aprovado, na fila de produção",imprimindo:"Sendo impresso agora",pronto:"Pronto! Combine a retirada ou entrega",entregue:"Entregue. Obrigado pela compra!"};
const ORDEM=["orcamento","aprovado","imprimindo","pronto","entregue"];
function toast(m){const t=$("#toast");t.textContent=m;t.hidden=false;clearTimeout(toast._t);toast._t=setTimeout(()=>t.hidden=true,2600)}
async function copia(txt,msg){try{await navigator.clipboard.writeText(txt);toast(msg)}catch(e){const a=$("#pixCod");if(a){a.focus();a.select()}toast("Selecionei o código: copie com o dedo ou Ctrl+C")}}
/* aprovar ou recusar: dois toques, para não aprovar sem querer */
async function responde(acao,motivo){
  const r=await fetch("/api/publico/pedido/"+encodeURIComponent(token)+"/resposta",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({acao,motivo})});
  const j=await r.json().catch(()=>({})); if(!r.ok) throw new Error(j.erro||"Não deu para enviar. Tente de novo.");
}
async function carrega(){
  let d;
  try{const r=await fetch("/api/publico/pedido/"+encodeURIComponent(token));if(!r.ok)throw new Error(r.status);d=await r.json()}
  catch(e){$("#ped").innerHTML=`<div class="card empty"><h2>Pedido não encontrado</h2><p>O link pode estar incompleto. Peça um novo link para a loja.</p></div>`;return}
  document.title=`Pedido #${d.numero} · ${d.loja.nome}`;
  const pos=ORDEM.indexOf(d.status);
  const wa=d.loja.whatsapp?"https://wa.me/"+(d.loja.whatsapp.length<=11?"55"+d.loja.whatsapp:d.loja.whatsapp)+"?text="+encodeURIComponent(
    d.status==="orcamento"?`Olá! Tenho uma dúvida sobre o orçamento #${d.numero}:`:d.pix&&d.pix.tipo==="entrada"?`Olá! Paguei a entrada do pedido #${d.numero}. Segue o comprovante:`:`Olá! Sobre o meu pedido #${d.numero}:`):null;
  const recusado=d.status==="cancelado";
  $("#ped").innerHTML=`
    <header class="stack" style="gap:6px"><h1><small>${esc(d.loja.nome)}</small>Pedido #${d.numero}</h1>
      <p style="margin:0">${d.cliente?`Olá, ${esc(d.cliente)}! `:""}<b>${esc(ST[d.status]||"")}</b></p>
      ${d.prazo&&d.status!=="entregue"?`<p class="note" style="margin:0">Previsão: fica pronto até <b>${dataBR(d.prazo)}</b></p>`:""}</header>
    ${recusado?"":`<div class="passos">${["Orçamento","Aprovado","Produção","Pronto"].map((n,i)=>`<div class="${pos>=i?"on":""}"><i></i>${n}</div>`).join("")}</div>`}
    <section class="card"><h3 style="margin-bottom:4px">Itens</h3>
      ${d.itens.map(i=>`<div class="it"><div class="ph">${i.foto?`<img src="${esc(i.foto)}" alt="" loading="lazy">`:"3D"}</div>
        <div><b>${esc(i.descricao)}</b><span class="pcat">${Number(i.quantidade).toLocaleString("pt-BR")} × ${brl(i.preco)}</span>${i.personalizacao?`<div class="pcat">Personalização: ${esc(i.personalizacao)}</div>`:""}</div>
        <span class="num">${brl(i.quantidade*i.preco)}</span></div>`).join("")}
    </section>
    <section class="card">
      ${d.desconto>0?`<div class="lin"><span>Desconto</span><span class="num">−${brl(d.desconto)}</span></div>`:""}
      ${d.frete>0?`<div class="lin"><span>Frete</span><span class="num">${brl(d.frete)}</span></div>`:""}
      <div class="lin tot"><span>Total</span><span class="num">${brl(d.total)}</span></div>
      ${d.sinal>0?`<div class="lin"><span>Já pago (sinal)</span><span class="num">−${brl(d.sinal)}</span></div>`:""}
      ${d.status==="orcamento"||d.status==="cancelado"?"":d.receber>0&&d.status!=="entregue"?`<div class="lin falta"><span>A pagar</span><span class="num">${brl(d.receber)}</span></div>`:`<p class="pos" style="margin:6px 0 0"><b>Pagamento concluído.</b></p>`}
      ${d.loja.pagamento&&d.receber>0?`<p class="note" style="margin:8px 0 0">Formas de pagamento: ${esc(d.loja.pagamento)}</p>`:""}
    </section>
    ${d.status==="orcamento"?`<section class="card stack resp" id="resp"><h3>O que achou do orçamento?</h3>
      <p class="note" style="margin:0">${d.entrada>0?`Ao aprovar, é só pagar a entrada de <b>${brl(d.entrada)}</b> por Pix para começarmos a produção. O restante, ${brl(Math.max(0,d.receber-d.entrada))}, fica para a entrega.`:"Aprovando, já colocamos o seu pedido na fila de produção."}</p>
      <div class="cta" data-etapa="1"><button class="btn primary" type="button" data-r="aprovar">Aprovar orçamento</button><button class="btn ghost" type="button" data-r="recusar">Recusar</button></div>
      <div class="cta" data-etapa="aprovar" hidden><p style="margin:0">Confirma a aprovação do pedido de <b>${brl(d.total)}</b>?</p><button class="btn primary" type="button" data-r="aprovar-ok">Sim, aprovar</button><button class="btn ghost" type="button" data-r="voltar">Voltar</button></div>
      <div class="cta" data-etapa="recusar" hidden><label class="f">Quer contar o motivo? (opcional)<textarea id="motivo" rows="3" maxlength="300" placeholder="Ex.: ficou acima do orçamento, prazo muito longo…"></textarea></label><button class="btn danger" type="button" data-r="recusar-ok">Recusar orçamento</button><button class="btn ghost" type="button" data-r="voltar">Voltar</button></div>
      <span class="note" id="respMsg"></span></section>`:""}
    ${recusado?`<section class="card stack"><h3>Você recusou este orçamento</h3><p class="note" style="margin:0">Obrigado pela resposta! Se mudar de ideia ou quiser outra opção, é só chamar a loja.</p></section>`:""}
    ${d.pix&&d.status!=="entregue"?`<section class="card stack${d.pix.tipo==="entrada"?" resp":""}"><h3>${d.pix.tipo==="entrada"?`Pague a entrada: ${brl(d.pix.valor)}`:"Pague com Pix"}</h3>
      ${d.pix.tipo==="entrada"?`<p class="note" style="margin:0">Orçamento aprovado! A produção começa assim que a entrada for paga. O restante, ${brl(Math.max(0,d.receber-d.pix.valor))}, fica para a entrega.</p>`:""}
      <div class="pixw"><div class="qr">${d.pix.svg}</div>
        <div class="cod"><span class="note" style="margin:0">Abra o app do banco, escolha <b>Pix copia e cola</b> e cole o código. O valor de ${brl(d.pix.valor)} já vem preenchido.</span>
          <textarea id="pixCod" rows="4" readonly>${esc(d.pix.payload)}</textarea>
          <button class="btn primary" id="copPix" type="button">Copiar código Pix</button></div></div>
      ${d.pix.chave?`<div class="chave"><span class="pcat">Ou pague pela chave Pix${d.pix.nome?` (${esc(d.pix.nome)})`:""}</span><div class="row" style="gap:8px;flex-wrap:nowrap"><b class="num clip" id="pixChave">${esc(d.pix.chave)}</b><button class="btn sm" id="copChave" type="button">Copiar chave</button></div></div>`:""}
      <p class="note" style="margin:0">Depois de pagar, mande o comprovante pelo WhatsApp.</p></section>`:""}
    <div class="cta">${wa?`<a class="btn ${d.pix&&d.pix.tipo==="entrada"?"primary":""}" href="${esc(wa)}" target="_blank" rel="noopener">${d.status==="orcamento"?"Tirar dúvidas no WhatsApp":d.pix&&d.pix.tipo==="entrada"?"Enviar comprovante no WhatsApp":"Falar com a loja no WhatsApp"}</a>`:""}
      ${d.loja.instagram?`<a class="btn ghost" href="https://instagram.com/${encodeURIComponent(d.loja.instagram.replace(/^@/,""))}" target="_blank" rel="noopener">Instagram ${esc(d.loja.instagram.startsWith("@")?d.loja.instagram:"@"+d.loja.instagram)}</a>`:""}
      <a class="btn ghost" href="/catalogo">Ver o catálogo da loja</a></div>`;
  const b=$("#copPix"); if(b) b.addEventListener("click",()=>copia(d.pix.payload,"Código Pix copiado"));
  const bc=$("#copChave"); if(bc) bc.addEventListener("click",()=>copia(d.pix.chave,"Chave Pix copiada"));
  const rs=$("#resp");
  if(rs) rs.addEventListener("click",async e=>{
    const x=e.target.closest("[data-r]"); if(!x) return; const a=x.dataset.r;
    const mostra=et=>rs.querySelectorAll("[data-etapa]").forEach(el=>el.hidden=el.dataset.etapa!==et);
    if(a==="aprovar"||a==="recusar"){ mostra(a); if(a==="recusar") $("#motivo").focus(); return }
    if(a==="voltar"){ mostra("1"); return }
    x.disabled=true; $("#respMsg").textContent="Enviando…";
    try{ await responde(a==="aprovar-ok"?"aprovar":"recusar",a==="recusar-ok"?$("#motivo").value:""); toast(a==="aprovar-ok"?"Orçamento aprovado!":"Resposta enviada"); await carrega(); window.scrollTo({top:0,behavior:"smooth"}) }
    catch(err){ $("#respMsg").textContent=err.message; x.disabled=false }
  });
}
carrega();
})();

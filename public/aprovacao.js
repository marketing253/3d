(function(){
"use strict";
const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const token=location.pathname.split("/").filter(Boolean)[1]||"";
const V=v=>"V"+String(v).padStart(2,"0");
const quando=iso=>iso?new Date(iso).toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}):"";
function toast(m){const t=$("#toast");t.textContent=m;t.hidden=false;clearTimeout(toast._t);toast._t=setTimeout(()=>t.hidden=true,2600)}

async function carrega(){
  let d;
  try{const r=await fetch("/api/publico/arte/"+encodeURIComponent(token));if(!r.ok)throw new Error(r.status);d=await r.json()}
  catch(e){$("#ap").innerHTML=`<div class="vazio"><h2>Arte não encontrada</h2><p>O link pode estar incompleto ou a arte ainda não foi enviada. Fale com a loja.</p></div>`;return}
  const L=d.loja, a=d.atual;
  if(L.cor) document.documentElement.style.setProperty("--cor",L.cor);
  document.title=`Aprovação ${V(a.v)} · ${L.nome}`;
  const wa=L.whatsapp?"https://wa.me/"+(L.whatsapp.length<=11?"55"+L.whatsapp:L.whatsapp)+"?text="+encodeURIComponent(`Olá! Sobre a arte ${V(a.v)} do pedido #${d.numero}:`):null;
  const aviso=a.status==="aprovada"?`<div class="aviso ok"><span class="bola">✓</span><div><b>Arte aprovada</b><span>A aprovação desta versão está registrada com a ${esc(L.nome)} desde ${quando(a.respondidoEm)}.</span></div></div>`
    :a.status==="ajuste"?`<div class="aviso aj"><span class="bola">!</span><div><b>Ajuste pedido</b><span>Recebemos o seu pedido de ajuste em ${quando(a.respondidoEm)}. A nova versão chega por este mesmo link.</span>${a.comentario?`<span style="display:block;margin-top:6px;color:var(--tinta)">“${esc(a.comentario)}”</span>`:""}</div></div>`
    :a.status==="substituida"?`<div class="aviso ve"><span class="bola">i</span><div><b>Existe uma versão mais nova</b><span>Recarregue a página.</span></div></div>`:"";
  $("#ap").innerHTML=`
    <header class="topo"><h1>Aprovação da arte</h1>
      <div class="prod">${esc(d.produto)}</div>
      <div class="ver"><span class="v">${V(a.v)}</span>${esc(d.cliente)}</div></header>
    <section class="palco"><figure><img src="${esc(a.imagem)}" alt="Arte ${V(a.v)}"><figcaption>#${d.numero} · ${V(a.v)} · As cores impressas podem variar em relação à tela.</figcaption></figure></section>
    <section class="base">
      ${aviso}
      ${a.nota?`<div class="nota"><b>Recado da loja</b>${esc(a.nota)}</div>`:""}
      ${a.status==="pendente"?`<div id="resp">
        <div class="acoes" data-etapa="1"><button class="btn pri" type="button" data-r="aprovar">Aprovar arte</button><button class="btn" type="button" data-r="ajuste">Pedir ajuste</button></div>
        <div data-etapa="aprovar" hidden><p style="margin:0 0 10px">Confirma a aprovação da arte <b>${V(a.v)}</b>? Depois de aprovada, ela vai para a produção.</p><div class="acoes"><button class="btn pri" type="button" data-r="aprovar-ok">Sim, aprovar</button><button class="btn" type="button" data-r="voltar">Voltar</button></div></div>
        <div data-etapa="ajuste" hidden><label for="coment">O que precisa mudar?</label><textarea id="coment" rows="4" maxlength="600" placeholder="Ex.: aumentar o logo, trocar a cor do fundo para azul…"></textarea><div class="acoes"><button class="btn pri" type="button" data-r="ajuste-ok">Enviar pedido de ajuste</button><button class="btn" type="button" data-r="voltar">Voltar</button></div></div>
        <div class="msg" id="respMsg"></div></div>`:""}
      ${d.versoes.length>1?`<div class="hist">Versões: ${d.versoes.map(x=>`${V(x.v)} ${({aprovada:"aprovada",ajuste:"ajuste pedido",pendente:"aguardando",substituida:"substituída"})[x.status]||""}`).join(" · ")}</div>`:""}
      <div class="rod">${wa?`<a href="${esc(wa)}" target="_blank" rel="noopener">Falar com a loja no WhatsApp</a>`:""}<a href="/pedido/${esc(token)}">Ver o pedido</a></div>
    </section>`;
  const rs=$("#resp");
  if(rs) rs.addEventListener("click",async e=>{
    const x=e.target.closest("[data-r]"); if(!x) return; const k=x.dataset.r;
    const mostra=et=>rs.querySelectorAll("[data-etapa]").forEach(el=>el.hidden=el.dataset.etapa!==et);
    if(k==="aprovar"||k==="ajuste"){ mostra(k); if(k==="ajuste") $("#coment").focus(); return }
    if(k==="voltar"){ mostra("1"); return }
    x.disabled=true; $("#respMsg").textContent="";
    try{
      const r=await fetch("/api/publico/arte/"+encodeURIComponent(token)+"/resposta",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({acao:k==="aprovar-ok"?"aprovar":"ajuste",comentario:k==="ajuste-ok"?$("#coment").value:""})});
      const j=await r.json().catch(()=>({})); if(!r.ok) throw new Error(j.erro||"Não deu para enviar. Tente de novo.");
      toast(k==="aprovar-ok"?"Arte aprovada!":"Pedido de ajuste enviado"); await carrega();
    }catch(err){ $("#respMsg").textContent=err.message; x.disabled=false }
  });
}
carrega();
})();

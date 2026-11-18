/* Área "Links" do painel: páginas de links (cartão NFC / link na bio) e QR codes dinâmicos.
   Fica separada do resto do precificador: usa só window.painel (api, toast, esc, enviaImagem…). */
(() => {
  "use strict";
  const P = () => window.painel;
  const $ = s => document.querySelector(s);
  const esc = s => P().esc(s);
  const ORIGEM = location.origin;
  let paginas = null, qrs = null, ed = null, salvarT = null, salvando = false, pendente = false, abertoItem = null;

  const TEMAS = { azul: "#2563eb", roxo: "#7c3aed", verde: "#16a34a", laranja: "#ea580c", vermelho: "#dc2626", grafite: "#374151", rosa: "#db2777", menta: "#1FBE8C", claro: "#e7e5e4" };
  const NOME_TEMA = { azul: "Azul", roxo: "Roxo", verde: "Verde", laranja: "Laranja", vermelho: "Vermelho", grafite: "Grafite", rosa: "Rosa", menta: "Menta 8ON", claro: "Claro" };
  const TIPOS = [
    ["whatsapp", "WhatsApp", "WhatsApp"], ["instagram", "Instagram", "Instagram"], ["link", "Link", "Acesse nosso site"], ["pix", "PIX", "Pix"],
    ["avaliacao", "Avaliação", "Avalie no Google"], ["contato", "Contato", "Salvar contato"], ["wifi", "Wi-Fi", "Wi-Fi"], ["youtube", "YouTube", "YouTube"],
    ["email", "E-mail", "Enviar e-mail"], ["pdf", "PDF", "Cardápio (PDF)"], ["produto", "Produto", "Produto"], ["imagem", "Imagem", ""],
    ["galeria", "Galeria", ""], ["texto", "Texto", ""], ["titulo", "Título", "Seção"], ["espacador", "Espaçador", ""],
  ];
  const NOME_TIPO = Object.fromEntries(TIPOS.map(t => [t[0], t[1]]));
  // campos de cada tipo: [chave, rótulo, tipo do campo]
  const T = ["titulo", "Texto do botão"];
  const CAMPOS = {
    link: [T, ["url", "Link (https://…)", "url"]], youtube: [T, ["url", "Link do vídeo ou canal", "url"]], avaliacao: [T, ["url", "Link de avaliação do Google", "url"]],
    pdf: [T, ["url", "Link do PDF (Google Drive, site…)", "url"]], whatsapp: [T, ["numero", "WhatsApp com DDD", "tel"], ["mensagem", "Mensagem que já vem escrita (opcional)"]],
    instagram: [T, ["usuario", "@ do Instagram"]], email: [T, ["email", "E-mail", "email"], ["assunto", "Assunto (opcional)"]],
    pix: [["titulo", "Título"], ["tipoChave", "Tipo da chave (CPF, CNPJ, e-mail, celular, aleatória)"], ["chave", "Chave Pix"], ["nome", "Nome de quem recebe (até 25 letras)"], ["cidade", "Cidade (até 15 letras)"], ["qr", "Mostrar o QR code do Pix", "check"]],
    wifi: [["titulo", "Título"], ["rede", "Nome da rede"], ["senha", "Senha"], ["seguranca", "Segurança", "sel:WPA=WPA/WPA2|WEP=WEP|nopass=Sem senha"]],
    contato: [T, ["nome", "Nome"], ["telefone", "Telefone", "tel"], ["email", "E-mail", "email"], ["empresa", "Empresa"], ["cargo", "Cargo"], ["site", "Site", "url"]],
    texto: [["texto", "Texto", "area"]], titulo: [["titulo", "Título da seção"]],
    produto: [["titulo", "Nome do produto"], ["descricao", "Descrição curta"], ["preco", "Preço (R$)", "num"], ["foto", "Foto", "foto"], ["url", "Link ao tocar (opcional)", "url"]],
    imagem: [["foto", "Imagem", "foto"], ["titulo", "Descrição (opcional)"], ["url", "Link ao tocar (opcional)", "url"]],
    galeria: [["titulo", "Título (opcional)"], ["fotos", "Fotos (até 12)", "fotos"]], espacador: [["altura", "Altura em pixels", "num"]],
  };
  const resumo = i => ({ link: i.url, youtube: i.url, avaliacao: i.url, pdf: i.url, whatsapp: i.numero, instagram: i.usuario && "@" + i.usuario, email: i.email, pix: i.chave, wifi: i.rede, contato: i.nome || i.telefone,
    texto: (i.texto || "").slice(0, 60), produto: i.preco ? P().brl(+i.preco) : "", imagem: i.foto ? "imagem" : "", galeria: (i.fotos || []).length + " fotos", espacador: (i.altura || 24) + " px" }[i.tipo] || "");
  const uid = () => Math.random().toString(36).slice(2, 12).padEnd(10, "0");
  const imgUrl = f => "/fotos/" + encodeURIComponent(f);
  const qrImg = (t, extra = "") => `/api/lk/qrimg?t=${encodeURIComponent(t)}${extra}`;
  const edita = () => P().podeEditar();

  // ================= PÁGINAS =================
  async function carregaPaginas() { paginas = await P().api("GET", "/api/lk/paginas"); }
  function lista() {
    const box = $("#lkPag"), busca = (lista.b || "").toLowerCase();
    const l = (paginas || []).filter(p => !busca || (p.titulo + " " + p.slug).toLowerCase().includes(busca));
    box.innerHTML = `<div class="stack">
      <div class="row spread"><div><h2 style="margin:0">Páginas de links</h2><p class="note" style="margin:2px 0 0">Para cartões e placas NFC, QR codes e link na bio. Cada página tem endereço próprio e você edita quando quiser.</p></div>
        <button class="btn primary edit-only" type="button" data-lk="nova">+ Nova página</button></div>
      <input type="search" id="lkBusca" placeholder="Buscar páginas" value="${esc(lista.b || "")}" style="max-width:340px">
      ${l.length ? `<div class="lk-grade">${l.map(p => `<div class="card lk-card" data-pid="${esc(p.id)}">
        <div class="lk-cab">${p.logo ? `<img src="${imgUrl(p.logo)}" alt="">` : `<span class="lk-sem">${esc((p.titulo || "?")[0])}</span>`}<div><b>${esc(p.titulo)}</b><a href="/l/${esc(p.slug)}" target="_blank" rel="noopener" class="pcat">/l/${esc(p.slug)}</a></div></div>
        <div class="row spread" style="gap:8px"><span class="pcat">👁 ${p.acessos30} acesso${p.acessos30 === 1 ? "" : "s"} em 30 dias · ${p.itens.filter(i => i.ativo).length} itens</span>
          <span class="row" style="gap:6px"><button class="btn sm" type="button" data-lk="editar">Editar</button><a class="btn sm ghost" href="/l/${esc(p.slug)}" target="_blank" rel="noopener">Abrir</a><button class="btn sm ghost edit-only" type="button" data-lk="qr" title="Criar um QR code dinâmico para esta página">QR</button></span></div>
      </div>`).join("")}</div>` : `<div class="card empty"><h2>${paginas?.length ? "Nada encontrado" : "Nenhuma página ainda"}</h2><p>Crie uma página com WhatsApp, Instagram, Pix, Wi-Fi, avaliação no Google e o que mais quiser. Depois grave o link num cartão NFC ou num QR code.</p></div>`}
    </div>`;
  }

  async function novaPagina() {
    const titulo = prompt("Nome da página (ex.: nome do cliente ou da empresa):"); if (!titulo || !titulo.trim()) return;
    try {
      const p = await P().api("POST", "/api/lk/paginas", { titulo: titulo.trim(), design: { tema: "menta" }, itens: [{ tipo: "whatsapp", titulo: "WhatsApp" }, { tipo: "instagram", titulo: "Instagram" }] });
      paginas.unshift(p); abreEditor(p.id);
    } catch (e) { P().toast(e.message); }
  }

  // ================= EDITOR =================
  function abreEditor(id) {
    const p = paginas.find(x => x.id === id); if (!p) return;
    ed = JSON.parse(JSON.stringify(p)); abertoItem = null; desenhaEditor(); window.scrollTo({ top: 0 });
  }
  function desenhaEditor() {
    const d = ed, ds = d.design;
    $("#lkPag").innerHTML = `<div class="lk-ed">
      <div class="lk-topo"><button class="btn ghost" type="button" data-lk="voltar">← Páginas</button><b class="lk-tit">${esc(d.titulo)}</b><span class="note" id="lkStatus"></span>
        <span style="flex:1"></span><a class="btn sm ghost" href="/l/${esc(d.slug)}" target="_blank" rel="noopener" id="lkAbrir">Abrir página</a><button class="btn sm ghost edit-only" type="button" data-lk="excluir">Excluir</button></div>
      <div class="lk-cols">
        <div class="stack lk-form" id="lkForm">
          <div class="card stack"><h3>Página</h3>
            <div class="fields">
              <label class="f" style="grid-column:1/-1">Título<input data-k="titulo" maxlength="80" value="${esc(d.titulo)}"></label>
              <label class="f" style="grid-column:1/-1">Endereço da página<span class="hint" id="lkSlugMsg">${esc(ORIGEM.replace(/^https?:\/\//, ""))}/l/…</span><div class="unit pre"><span>/l/</span><input id="lkSlug" maxlength="50" value="${esc(d.slug)}"></div></label>
              <label class="f" style="grid-column:1/-1">Descrição<textarea data-k="descricao" rows="2" maxlength="300">${esc(d.descricao)}</textarea></label>
            </div>
            <div class="row" style="gap:12px;align-items:center">
              <div class="lk-logo${d.logoForma === "quadrado" ? " q" : ""}">${d.logo ? `<img src="${imgUrl(d.logo)}" alt="">` : "Logo"}</div>
              <div class="stack" style="gap:6px"><div class="row" style="gap:6px"><label class="btn sm" for="lkLogoArq">${d.logo ? "Trocar logo" : "Enviar logo"}</label><input type="file" id="lkLogoArq" accept="image/*" hidden>${d.logo ? `<button class="btn sm ghost" type="button" data-lk="tiralogo">Tirar</button>` : ""}</div>
                <div class="row" style="gap:6px">${["redondo", "quadrado"].map(f => `<button type="button" class="chip${d.logoForma === f ? " on" : ""}" data-forma="${f}">${f === "redondo" ? "Redonda" : "Quadrada"}</button>`).join("")}</div></div>
            </div>
            <label class="chk"><input type="checkbox" data-k="compartilhar"${d.compartilhar !== false ? " checked" : ""}> Mostrar o botão "Compartilhar"</label>
          </div>

          <div class="card stack"><h3>Visual</h3>
            <span class="note">Tema</span>
            <div class="lk-temas">${Object.keys(TEMAS).map(t => `<button type="button" class="lk-tema${ds.tema === t ? " on" : ""}" data-tema="${t}"><i style="background:${TEMAS[t]}"></i>${NOME_TEMA[t]}</button>`).join("")}</div>
            <div class="fields">
              <label class="f">Cor dos botões<span class="hint">Vazio usa a do tema</span><div class="row" style="gap:6px"><input type="color" data-k="design.cor" value="${ds.cor || TEMAS[ds.tema]}" style="width:56px;padding:2px">${ds.cor ? `<button type="button" class="btn sm ghost" data-lk="tiracor">Usar a do tema</button>` : ""}</div></label>
              <label class="f">Fundo<select data-k="design.fundo">${[["tema", "Do tema"], ["cor", "Uma cor"], ["gradiente", "Degradê"], ["imagem", "Foto"]].map(([v, n]) => `<option value="${v}"${ds.fundo === v ? " selected" : ""}>${n}</option>`).join("")}</select></label>
              ${ds.fundo === "cor" || ds.fundo === "gradiente" ? `<label class="f">Cor ${ds.fundo === "gradiente" ? "1" : "do fundo"}<input type="color" data-k="design.fundo1" value="${ds.fundo1 || "#0E1114"}" style="width:56px;padding:2px"></label>` : ""}
              ${ds.fundo === "gradiente" ? `<label class="f">Cor 2<input type="color" data-k="design.fundo2" value="${ds.fundo2 || "#12382d"}" style="width:56px;padding:2px"></label>` : ""}
              ${ds.fundo === "imagem" ? `<div class="f"><span>Foto do fundo</span><div class="row" style="gap:6px">${ds.fundoImagem ? `<img src="${imgUrl(ds.fundoImagem)}" alt="" style="height:44px;border-radius:8px">` : ""}<label class="btn sm" for="lkFundoArq">${ds.fundoImagem ? "Trocar" : "Enviar foto"}</label><input type="file" id="lkFundoArq" accept="image/*" hidden></div></div>` : ""}
            </div>
            <span class="note">Botões</span>
            <div class="row" style="gap:6px;flex-wrap:wrap">${[["pilula", "Pílula"], ["arredondado", "Arredondado"], ["quadrado", "Reto"]].map(([v, n]) => `<button type="button" class="chip${ds.botao === v ? " on" : ""}" data-botao="${v}">${n}</button>`).join("")}
              <span style="width:10px"></span>${[["solido", "Cheio"], ["vidro", "Vidro"], ["contorno", "Contorno"]].map(([v, n]) => `<button type="button" class="chip${ds.estilo === v ? " on" : ""}" data-estilo="${v}">${n}</button>`).join("")}</div>
          </div>

          <div class="card stack"><div class="row spread"><h3>Itens da página</h3><span class="note">Arraste ⠿ para mudar a ordem</span></div>
            <div class="lk-add edit-only">${TIPOS.map(([t, n]) => `<button type="button" data-add="${t}">${n}</button>`).join("")}</div>
            <div class="lk-itens" id="lkItens">${d.itens.map((i, k) => itemHtml(i, k)).join("") || `<p class="note">Nenhum item. Toque num tipo acima para adicionar.</p>`}</div>
          </div>

          <div class="card stack"><h3>Rodapé</h3><textarea data-k="rodape" rows="2" maxlength="300" placeholder="Ex.: endereço, horário de funcionamento">${esc(d.rodape)}</textarea></div>
          <div class="card stack" id="lkMet"><h3>Métricas</h3><p class="note">Carregando…</p></div>
        </div>
        <div class="lk-prev"><div class="lk-cel"><iframe id="lkFrame" title="Prévia da página" src="/l/${esc(d.slug)}?previa=1"></iframe></div><p class="note" style="text-align:center">Prévia ao vivo · salva sozinho</p></div>
      </div></div>`;
    metricas();
  }
  function itemHtml(i, k) {
    const aberto = abertoItem === i.id;
    return `<div class="lk-item${i.ativo ? "" : " off"}${aberto ? " aberto" : ""}" data-k="${k}" draggable="true">
      <div class="lk-ih"><span class="lk-arr" title="Arrastar">⠿</span><span class="lk-tipo">${esc(NOME_TIPO[i.tipo] || i.tipo)}</span><b>${esc(i.titulo || "")}</b><small>${esc(resumo(i) || "")}</small>
        <span class="lk-ia edit-only"><button type="button" data-ia="ver" title="${i.ativo ? "Esconder" : "Mostrar"}">${i.ativo ? "👁" : "🚫"}</button><button type="button" data-ia="dup" title="Duplicar">⧉</button><button type="button" data-ia="del" title="Excluir">✕</button></span>
        <button type="button" class="lk-abre" data-ia="abre">${aberto ? "Fechar" : "Editar"}</button></div>
      ${aberto ? `<div class="lk-campos">${(CAMPOS[i.tipo] || []).map(c => campo(i, c)).join("")}</div>` : ""}</div>`;
  }
  function campo(i, [k, rot, tipo]) {
    const v = i[k] ?? "";
    if (tipo === "check") return `<label class="chk"><input type="checkbox" data-c="${k}"${v !== false ? " checked" : ""}> ${rot}</label>`;
    if (tipo === "area") return `<label class="f">${rot}<textarea data-c="${k}" rows="3" maxlength="1500">${esc(v)}</textarea></label>`;
    if (tipo && tipo.startsWith("sel:")) return `<label class="f">${rot}<select data-c="${k}">${tipo.slice(4).split("|").map(o => { const [a, b] = o.split("="); return `<option value="${a}"${(v || "WPA") === a ? " selected" : ""}>${b}</option>`; }).join("")}</select></label>`;
    if (tipo === "foto") return `<div class="f"><span>${rot}</span><div class="row" style="gap:8px">${v ? `<img src="${imgUrl(v)}" alt="" class="lk-mini">` : ""}<label class="btn sm">${v ? "Trocar" : "Enviar"}<input type="file" accept="image/*" data-foto="${k}" hidden></label>${v ? `<button type="button" class="btn sm ghost" data-tirafoto="${k}">Tirar</button>` : ""}</div></div>`;
    if (tipo === "fotos") return `<div class="f"><span>${rot}</span><div class="row" style="gap:6px;flex-wrap:wrap">${(i.fotos || []).map((f, n) => `<span class="lk-gf"><img src="${imgUrl(f)}" alt=""><button type="button" data-tiragal="${n}">✕</button></span>`).join("")}${(i.fotos || []).length < 12 ? `<label class="btn sm">+ Fotos<input type="file" accept="image/*" multiple data-gal="1" hidden></label>` : ""}</div></div>`;
    const t = { url: "url", tel: "tel", email: "email", num: "number" }[tipo] || "text";
    return `<label class="f">${rot}<input type="${t}" data-c="${k}" value="${esc(v)}"${t === "number" ? ' step="0.01" min="0"' : ""}></label>`;
  }
  function redesenhaItens() { $("#lkItens").innerHTML = ed.itens.map((i, k) => itemHtml(i, k)).join("") || `<p class="note">Nenhum item. Toque num tipo acima para adicionar.</p>`; }

  // salvar com espera (auto-save) e prévia atualizada
  function agenda() { clearTimeout(salvarT); $("#lkStatus").textContent = "Salvando…"; salvarT = setTimeout(salva, 700); }
  async function salva() {
    if (!ed || !edita()) return; if (salvando) { pendente = true; return; } salvando = true;
    const slug = $("#lkSlug")?.value.trim();
    try {
      const r = await P().api("PUT", "/api/lk/paginas/" + encodeURIComponent(ed.id), { ...ed, slug });
      const i = paginas.findIndex(x => x.id === ed.id); if (i >= 0) paginas[i] = r;
      const slugMudou = r.slug !== ed.slug; ed.slug = r.slug; $("#lkStatus").textContent = "Salvo ✓"; $("#lkAbrir").href = "/l/" + r.slug;
      if (slugMudou) $("#lkSlug").value = r.slug;
      const f = $("#lkFrame"); if (f) { const y = f.contentWindow?.scrollY || 0; f.onload = () => { try { f.contentWindow.scrollTo(0, y); } catch (e) {} }; f.src = "/l/" + r.slug + "?previa=1&t=" + Date.now(); }
    } catch (e) { $("#lkStatus").textContent = ""; P().toast(e.message); }
    salvando = false; if (pendente) { pendente = false; salva(); }
  }
  async function metricas() {
    const box = $("#lkMet"); if (!box || !ed) return;
    try {
      const m = await P().api("GET", `/api/lk/paginas/${encodeURIComponent(ed.id)}/metricas?dias=30`);
      const dias = [...Array(30)].map((_, k) => { const d = new Date(Date.now() - (29 - k) * 86400000 - 3 * 3600000).toISOString().slice(0, 10); return [d, m.porDia[d] || 0]; });
      const max = Math.max(1, ...dias.map(x => x[1]));
      const cliques = ed.itens.map(i => [i, m.porItem[i.id] || 0]).filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]);
      box.innerHTML = `<h3>Métricas</h3><div class="row" style="gap:18px"><span><b class="num" style="font-size:22px">${m.total}</b> <span class="pcat">acessos em 30 dias</span></span><span><b class="num" style="font-size:22px">${m.sempre}</b> <span class="pcat">desde o início</span></span></div>
        <div class="lk-barras" title="Acessos por dia (30 dias)">${dias.map(([d, n]) => `<i style="height:${Math.max(2, Math.round(n / max * 60))}px" title="${d.split("-").reverse().slice(0, 2).join("/")}: ${n}"></i>`).join("")}</div>
        ${cliques.length ? `<b style="font-size:14px">Cliques por item</b><div class="stack" style="gap:4px">${cliques.map(([i, n]) => `<div class="row spread"><span>${esc(i.titulo || NOME_TIPO[i.tipo])}</span><b class="num">${n}</b></div>`).join("")}</div>` : `<p class="note" style="margin:0">Os cliques nos botões aparecem aqui.</p>`}`;
    } catch (e) { box.innerHTML = `<h3>Métricas</h3><p class="note">${esc(e.message)}</p>`; }
  }
  const setK = (k, v) => { const p = k.split("."); if (p.length === 2) ed[p[0]][p[1]] = v; else ed[k] = v; };

  // ---------- eventos da área de páginas ----------
  const pag = document.getElementById("lkPag");
  pag.addEventListener("input", e => {
    const t = e.target;
    if (t.id === "lkBusca") { lista.b = t.value; const pos = t.selectionStart; lista(); const b = $("#lkBusca"); b.focus(); b.setSelectionRange(pos, pos); return; }
    if (!ed) return;
    if (t.dataset.k) { setK(t.dataset.k, t.type === "checkbox" ? t.checked : t.value); if (t.dataset.k === "titulo") $(".lk-tit").textContent = t.value; agenda(); return; }
    if (t.id === "lkSlug") { clearTimeout(pag._s); pag._s = setTimeout(async () => { const r = await P().api("GET", `/api/lk/slug?s=${encodeURIComponent(t.value)}&id=${encodeURIComponent(ed.id)}`).catch(() => null); if (!r) return; $("#lkSlugMsg").textContent = r.livre ? `${ORIGEM.replace(/^https?:\/\//, "")}/l/${r.slug} ✓ disponível` : `"${r.slug || t.value}" não está disponível`; if (r.livre) agenda(); }, 500); return; }
    const box = t.closest(".lk-item"); if (box && t.dataset.c) { const i = ed.itens[+box.dataset.k]; i[t.dataset.c] = t.type === "checkbox" ? t.checked : t.value; const s = box.querySelector(".lk-ih b"); if (t.dataset.c === "titulo" && s) s.textContent = t.value; agenda(); }
  });
  pag.addEventListener("change", async e => {
    const t = e.target; if (!ed) return;
    if (t.dataset.k === "design.fundo") { desenhaEditor(); return; }
    const sobe = async f => { try { return await P().enviaImagem(f); } catch (err) { P().toast(err.message); return null; } };
    if (t.id === "lkLogoArq" && t.files[0]) { const id = await sobe(t.files[0]); if (id) { ed.logo = id; desenhaEditor(); agenda(); } return; }
    if (t.id === "lkFundoArq" && t.files[0]) { const id = await sobe(t.files[0]); if (id) { ed.design.fundoImagem = id; desenhaEditor(); agenda(); } return; }
    const box = t.closest(".lk-item"); if (!box) return; const i = ed.itens[+box.dataset.k];
    if (t.dataset.foto && t.files[0]) { const id = await sobe(t.files[0]); if (id) { i[t.dataset.foto] = id; redesenhaItens(); agenda(); } }
    if (t.dataset.gal && t.files.length) { i.fotos = i.fotos || []; for (const f of [...t.files].slice(0, 12 - i.fotos.length)) { const id = await sobe(f); if (id) i.fotos.push(id); } redesenhaItens(); agenda(); }
  });
  pag.addEventListener("click", async e => {
    const b = e.target.closest("[data-lk],[data-tema],[data-forma],[data-botao],[data-estilo],[data-add],[data-ia],[data-tirafoto],[data-tiragal]"); if (!b) return;
    const a = b.dataset.lk;
    if (a === "nova") return novaPagina();
    if (a === "editar") return abreEditor(b.closest("[data-pid]").dataset.pid);
    if (a === "qr") { const id = b.closest("[data-pid]").dataset.pid; return qrParaPagina(id); }
    if (a === "voltar") { clearTimeout(salvarT); if ($("#lkStatus")?.textContent === "Salvando…") await salva(); ed = null; lista(); return; }
    if (a === "excluir") { if (!confirm(`Excluir a página "${ed.titulo}"? O endereço deixa de funcionar e os QR codes que apontam para ela ficam sem destino.`)) return;
      try { await P().api("DELETE", "/api/lk/paginas/" + encodeURIComponent(ed.id)); paginas = paginas.filter(x => x.id !== ed.id); ed = null; lista(); P().toast("Página excluída"); } catch (err) { P().toast(err.message); } return; }
    if (!ed) return;
    if (a === "tiralogo") { ed.logo = ""; desenhaEditor(); agenda(); return; }
    if (a === "tiracor") { ed.design.cor = ""; desenhaEditor(); agenda(); return; }
    if (b.dataset.tema) { ed.design.tema = b.dataset.tema; desenhaEditor(); agenda(); return; }
    if (b.dataset.forma) { ed.logoForma = b.dataset.forma; desenhaEditor(); agenda(); return; }
    if (b.dataset.botao) { ed.design.botao = b.dataset.botao; desenhaEditor(); agenda(); return; }
    if (b.dataset.estilo) { ed.design.estilo = b.dataset.estilo; desenhaEditor(); agenda(); return; }
    if (b.dataset.add) { const tp = TIPOS.find(t => t[0] === b.dataset.add); const i = { id: uid(), tipo: tp[0], titulo: tp[2], ativo: true }; if (tp[0] === "espacador") i.altura = 24; if (tp[0] === "pix") i.qr = true;
      ed.itens.push(i); abertoItem = i.id; redesenhaItens(); agenda(); setTimeout(() => document.querySelector(`.lk-item[data-k="${ed.itens.length - 1}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 50); return; }
    const box = b.closest(".lk-item"); if (!box) return; const k = +box.dataset.k, i = ed.itens[k];
    if (b.dataset.tirafoto) { i[b.dataset.tirafoto] = ""; redesenhaItens(); agenda(); return; }
    if (b.dataset.tiragal != null) { i.fotos.splice(+b.dataset.tiragal, 1); redesenhaItens(); agenda(); return; }
    const ia = b.dataset.ia;
    if (ia === "abre") { abertoItem = abertoItem === i.id ? null : i.id; redesenhaItens(); return; }
    if (ia === "ver") { i.ativo = !i.ativo; redesenhaItens(); agenda(); return; }
    if (ia === "dup") { const c = { ...JSON.parse(JSON.stringify(i)), id: uid() }; ed.itens.splice(k + 1, 0, c); redesenhaItens(); agenda(); return; }
    if (ia === "del") { if (!confirm(`Excluir "${i.titulo || NOME_TIPO[i.tipo]}"?`)) return; ed.itens.splice(k, 1); redesenhaItens(); agenda(); }
  });
  // arrastar para reordenar
  let arrastando = null;
  pag.addEventListener("dragstart", e => { const it = e.target.closest?.(".lk-item"); if (!it || e.target.closest("input,textarea,select")) return; arrastando = +it.dataset.k; it.classList.add("arr"); e.dataTransfer.effectAllowed = "move"; });
  pag.addEventListener("dragover", e => { if (arrastando == null) return; const it = e.target.closest?.(".lk-item"); if (it) { e.preventDefault(); document.querySelectorAll(".lk-item.sobre").forEach(x => x.classList.remove("sobre")); it.classList.add("sobre"); } });
  pag.addEventListener("drop", e => { const it = e.target.closest?.(".lk-item"); if (arrastando == null || !it) return; e.preventDefault(); const para = +it.dataset.k; const [m] = ed.itens.splice(arrastando, 1); ed.itens.splice(para, 0, m); arrastando = null; redesenhaItens(); agenda(); });
  pag.addEventListener("dragend", () => { arrastando = null; document.querySelectorAll(".lk-item.arr,.lk-item.sobre").forEach(x => x.classList.remove("arr", "sobre")); });

  // ================= QR CODES DINÂMICOS =================
  async function carregaQrs() { qrs = await P().api("GET", "/api/lk/qr"); }
  const destTxt = q => q.destinoTipo === "url" ? q.url : q.destinoTipo === "pagina" ? ((paginas || []).find(p => p.id === q.paginaId) ? "Página: " + paginas.find(p => p.id === q.paginaId).titulo : "Página excluída") : "Sem destino (ainda não ativado)";
  function telaQr() {
    const box = $("#lkQr"), busca = (telaQr.b || "").toLowerCase(), f = telaQr.form;
    const l = (qrs || []).filter(q => !busca || (q.nome + " " + q.codigo + " " + destTxt(q)).toLowerCase().includes(busca));
    const opcPag = sel => (paginas || []).map(p => `<option value="${esc(p.id)}"${p.id === sel ? " selected" : ""}>${esc(p.titulo)}</option>`).join("");
    box.innerHTML = `<div class="stack">
      <div class="row spread"><div><h2 style="margin:0">QR codes dinâmicos</h2><p class="note" style="margin:2px 0 0">O QR leva para ${esc(ORIGEM.replace(/^https?:\/\//, ""))}/q/código, e você troca o destino quando quiser, sem reimprimir. Também serve para gravar em cartões e placas NFC.</p></div>
        <button class="btn primary edit-only" type="button" data-q="novo">+ Novo QR code</button></div>
      ${f ? `<div class="card stack"><h3>${f.id ? "Editar destino" : "Novo QR code"}</h3>
        <div class="fields">
          <label class="f">Nome<span class="hint">Para você achar depois</span><input id="qNome" maxlength="80" value="${esc(f.nome || "")}" placeholder="Ex.: Placa balcão Da Nossa Cozinha"></label>
          ${f.id ? "" : `<label class="f">Quantidade<span class="hint">Mais de 1 gera um lote para ativar depois</span><input id="qQtd" type="number" min="1" max="200" value="${f.quantidade || 1}"></label>
          <label class="f">Código (opcional)<span class="hint">Vazio cria um automático</span><input id="qCod" maxlength="32" placeholder="Ex.: cozinha" value="${esc(f.codigo || "")}"></label>`}
          <label class="f">Destino<select id="qTipo"><option value="pagina"${f.destinoTipo === "pagina" ? " selected" : ""}>Uma página de links</option><option value="url"${f.destinoTipo === "url" ? " selected" : ""}>Um link</option><option value="nenhum"${f.destinoTipo === "nenhum" ? " selected" : ""}>Nenhum (ativar depois)</option></select></label>
          ${f.destinoTipo === "pagina" ? `<label class="f">Página<select id="qPag">${opcPag(f.paginaId) || "<option value=''>Crie uma página primeiro</option>"}</select></label>` : ""}
          ${f.destinoTipo === "url" ? `<label class="f" style="grid-column:1/-1">Link de destino<input id="qUrl" type="url" placeholder="https://…" value="${esc(f.url || "")}"></label>` : ""}
        </div>
        <div class="row"><button class="btn primary" type="button" data-q="salvar">${f.id ? "Salvar destino" : "Criar"}</button><button class="btn ghost" type="button" data-q="cancelar">Cancelar</button></div></div>` : ""}
      <input type="search" id="qBusca" placeholder="Buscar QR codes" value="${esc(telaQr.b || "")}" style="max-width:340px">
      ${l.length ? `<div class="lk-qrs">${l.map(q => { const link = ORIGEM + "/q/" + q.codigo; return `<div class="card lk-qr" data-qid="${esc(q.id)}">
        <img src="${qrImg(link)}" alt="QR ${esc(q.codigo)}" loading="lazy">
        <div class="stack" style="gap:4px;min-width:0"><b>${esc(q.nome)}</b><a href="${esc(link)}" target="_blank" rel="noopener" class="num">/q/${esc(q.codigo)}</a>
          <span class="pcat${q.destinoTipo === "nenhum" ? " lk-pend" : ""}">→ ${esc(destTxt(q))}</span><span class="pcat">📷 ${q.scans30} leitura${q.scans30 === 1 ? "" : "s"} em 30 dias · ${q.scansSempre} no total</span>
          <div class="row" style="gap:6px;flex-wrap:wrap"><button class="btn sm edit-only" type="button" data-q="editar">Mudar destino</button><a class="btn sm ghost" href="${qrImg(link, "&f=png&n=" + encodeURIComponent("qr-" + q.codigo))}">PNG</a><a class="btn sm ghost" href="${qrImg(link, "&d=1&n=" + encodeURIComponent("qr-" + q.codigo))}">SVG</a><button class="btn sm ghost" type="button" data-q="copiar">Copiar link</button><button class="btn sm ghost edit-only" type="button" data-q="excluir">Excluir</button></div></div>
      </div>`; }).join("")}</div>` : `<div class="card empty"><h2>${qrs?.length ? "Nada encontrado" : "Nenhum QR code ainda"}</h2><p>Crie um QR para uma página de links ou para qualquer endereço. Se o endereço mudar, é só trocar o destino aqui.</p></div>`}
    </div>`;
  }
  async function qrParaPagina(paginaId) {
    const p = paginas.find(x => x.id === paginaId);
    try { await carregaQrs(); const ja = qrs.find(q => q.destinoTipo === "pagina" && q.paginaId === paginaId);
      if (!ja) { const r = await P().api("POST", "/api/lk/qr", { nome: p.titulo, destinoTipo: "pagina", paginaId }); qrs.unshift(...r); P().toast("QR code dinâmico criado para a página"); }
      telaQr.b = p.titulo; P().abreTab("qrcodes"); } catch (e) { P().toast(e.message); }
  }
  const qbox = document.getElementById("lkQr");
  qbox.addEventListener("input", e => {
    if (e.target.id === "qBusca") { telaQr.b = e.target.value; const pos = e.target.selectionStart; telaQr(); const b = $("#qBusca"); b.focus(); b.setSelectionRange(pos, pos); }
  });
  qbox.addEventListener("change", e => { if (e.target.id === "qTipo") { leFormQr(); telaQr.form.destinoTipo = e.target.value; telaQr(); } });
  function leFormQr() { const f = telaQr.form; if (!f) return; f.nome = $("#qNome")?.value ?? f.nome; f.quantidade = $("#qQtd")?.value ?? f.quantidade; f.codigo = $("#qCod")?.value ?? f.codigo; f.paginaId = $("#qPag")?.value ?? f.paginaId; f.url = $("#qUrl")?.value ?? f.url; }
  qbox.addEventListener("click", async e => {
    const b = e.target.closest("[data-q]"); if (!b) return; const a = b.dataset.q, q = qrs?.find(x => x.id === b.closest("[data-qid]")?.dataset.qid);
    if (a === "novo") { telaQr.form = { destinoTipo: (paginas || []).length ? "pagina" : "url", paginaId: paginas?.[0]?.id, quantidade: 1 }; telaQr(); $("#qNome")?.focus(); return; }
    if (a === "cancelar") { telaQr.form = null; telaQr(); return; }
    if (a === "editar") { telaQr.form = { ...q }; telaQr(); window.scrollTo({ top: 0, behavior: "smooth" }); return; }
    if (a === "copiar") { const u = ORIGEM + "/q/" + q.codigo; try { await navigator.clipboard.writeText(u); P().toast("Link copiado: " + u); } catch (err) { prompt("Copie:", u); } return; }
    if (a === "excluir") { if (!confirm(`Excluir o QR "${q.nome}"? Quem ler esse QR vai ver "código não encontrado".`)) return;
      try { await P().api("DELETE", "/api/lk/qr/" + encodeURIComponent(q.id)); qrs = qrs.filter(x => x.id !== q.id); telaQr(); } catch (err) { P().toast(err.message); } return; }
    if (a === "salvar") {
      leFormQr(); const f = telaQr.form;
      if (f.destinoTipo === "url" && !/^https?:\/\/\S+\.\S+/.test(f.url || "")) return P().toast("Coloque um link começando com https://");
      if (f.destinoTipo === "pagina" && !f.paginaId) return P().toast("Escolha a página");
      try {
        if (f.id) { const r = await P().api("PUT", "/api/lk/qr/" + encodeURIComponent(f.id), f); qrs = qrs.map(x => x.id === r.id ? r : x); P().toast("Destino salvo. O mesmo QR já leva para o novo destino."); }
        else { const r = await P().api("POST", "/api/lk/qr", f); qrs.unshift(...r); P().toast(r.length > 1 ? `${r.length} QR codes criados` : "QR code criado"); }
        telaQr.form = null; telaQr();
      } catch (err) { P().toast(err.message); }
    }
  });

  // ================= entrada =================
  window.lkPainel = {
    async abrir(t) {
      try {
        if (t === "paginas") { if (!paginas) { $("#lkPag").innerHTML = '<p class="note">Carregando…</p>'; } await carregaPaginas(); if (ed) { const p = paginas.find(x => x.id === ed.id); if (p) return; ed = null; } lista(); }
        if (t === "qrcodes") { $("#lkQr").innerHTML = '<p class="note">Carregando…</p>'; await Promise.all([carregaQrs(), paginas ? null : carregaPaginas()]); telaQr(); }
      } catch (e) { P().toast(e.message); }
    },
  };
  // se o painel já abriu numa dessas abas antes deste arquivo carregar
  if (window.painel) { if (!$("#p-paginas").hidden) window.lkPainel.abrir("paginas"); if (!$("#p-qrcodes").hidden) window.lkPainel.abrir("qrcodes"); }
})();

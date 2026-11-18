/* Área "Links" do painel: páginas de links (cartão NFC / link na bio) e QR codes dinâmicos.
   Fica separada do resto do precificador: usa só window.painel (api, toast, esc, enviaImagem…). */
(() => {
  "use strict";
  const P = () => window.painel;
  const $ = s => document.querySelector(s);
  const esc = s => P().esc(s);
  const ORIGEM = location.origin, HOST = ORIGEM.replace(/^https?:\/\//, "");
  let paginas = null, qrs = null, ed = null, salvarT = null, salvando = false, pendente = false, abertoItem = null, aba = null, abaDesign = "tema", gradeAberta = false;

  const TEMAS = { azul: ["#2563eb", "#0f1d3d", "#1e3a8a"], roxo: ["#7c3aed", "#1e1239", "#4c1d95"], verde: ["#16a34a", "#0b2416", "#14532d"], laranja: ["#ea580c", "#2a1306", "#7c2d12"],
    vermelho: ["#dc2626", "#2a0b0b", "#7f1d1d"], grafite: ["#374151", "#0b0f14", "#1f2937"], rosa: ["#db2777", "#2a0a1c", "#831843"], menta: ["#1FBE8C", "#0E1114", "#12382d"],
    dourado: ["#b8892d", "#15110a", "#3b2e14"], claro: ["#111827", "#f5f5f4", "#e7e5e4"] };
  const NOME_TEMA = { azul: "Azul clássico", roxo: "Roxo moderno", verde: "Verde fresh", laranja: "Laranja solar", vermelho: "Vermelho", grafite: "Grafite", rosa: "Rosa suave", menta: "Menta 8ON", dourado: "Dourado", claro: "Claro" };
  const FONTES = { poppins: "Poppins", inter: "Inter", montserrat: "Montserrat", nunito: "Nunito", playfair: "Playfair Display", sistema: "Padrão do celular" };
  const ICO = {
    link: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    whatsapp: '<path d="M4 20l1.3-4A8 8 0 1 1 8 18.7z"/><path d="M9 9.5c.4 2 2.1 3.9 4.5 4.6l1-1.2 2 .9-.5 1.6c-3.9.2-7.5-3.4-7.3-7.3L10.3 7.6l.9 2z"/>',
    instagram: '<rect x="4" y="4" width="16" height="16" rx="4.5"/><circle cx="12" cy="12" r="3.6"/><circle cx="16.8" cy="7.2" r=".6" fill="currentColor"/>',
    tiktok: '<path d="M14 4v10.5a3.5 3.5 0 1 1-3-3.46M14 4c.5 2.5 2.3 4 5 4"/>',
    facebook: '<path d="M14.5 8H16V4.5h-2.5A3.5 3.5 0 0 0 10 8v2.5H8V14h2v6.5h3.5V14h2.3l.5-3.5h-2.8V8.6c0-.4.3-.6.5-.6z"/>',
    youtube: '<rect x="3" y="6" width="18" height="12" rx="3.5"/><path d="M10.5 9.5v5l4.3-2.5z" fill="currentColor"/>',
    email: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="M4 7l8 6 8-6"/>',
    telefone: '<path d="M6.5 3.5h3l1.5 4-2 1.5a11 11 0 0 0 6 6l1.5-2 4 1.5v3a2 2 0 0 1-2 2A16 16 0 0 1 4.5 5.5a2 2 0 0 1 2-2z"/>',
    localizacao: '<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/>',
    avaliacao: '<path d="M20 12.2c0-.6-.1-1.1-.2-1.7H12v3.3h4.6a4.6 4.6 0 0 1-2 3"/><path d="M19.4 9A8.5 8.5 0 1 0 20 12.2"/>',
    pdf: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M9.5 14h5M9.5 17h5"/>',
    pix: '<path d="M12 3.5l3.4 3.4-3.4 3.4-3.4-3.4zM12 13.7l3.4 3.4-3.4 3.4-3.4-3.4zM3.5 12l3.4-3.4 3.4 3.4-3.4 3.4zM13.7 12l3.4-3.4 3.4 3.4-3.4 3.4z"/>',
    wifi: '<path d="M3 9.5a13 13 0 0 1 18 0M6 12.8a8.5 8.5 0 0 1 12 0M9 16a4 4 0 0 1 6 0"/><circle cx="12" cy="19" r="1" fill="currentColor"/>',
    contato: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><circle cx="9" cy="11" r="2.2"/><path d="M5.8 16c.6-1.6 1.8-2.4 3.2-2.4s2.6.8 3.2 2.4M14.5 10h4M14.5 13.5h3"/>',
    produto: '<path d="M5 8h14l-1.2 11H6.2z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>',
    imagem: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="M4 17l5-4.5 4 3.5 3-2.5 4 3.5"/>',
    galeria: '<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/>',
    texto: '<path d="M5 6h14M5 10h14M5 14h10M5 18h7"/>', titulo: '<path d="M6 5v14M18 5v14M6 12h12"/>', espacador: '<path d="M12 4v16M8 8l4-4 4 4M8 16l4 4 4-4"/>',
    olho: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>', olhoNao: '<path d="M3 3l18 18M10.6 6a9.8 9.8 0 0 1 1.4-.1c6 0 9.5 6.1 9.5 6.1a17 17 0 0 1-2.6 3.3M6.2 7.3A16.7 16.7 0 0 0 2.5 12S6 18.5 12 18.5a9 9 0 0 0 4-.9"/>',
    dup: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>',
    lixo: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12.5A1.5 1.5 0 0 0 8.5 21h7a1.5 1.5 0 0 0 1.5-1.5L18 7M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7"/>',
    lapis: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>', arr: '<circle cx="9" cy="6" r="1.3" fill="currentColor"/><circle cx="15" cy="6" r="1.3" fill="currentColor"/><circle cx="9" cy="12" r="1.3" fill="currentColor"/><circle cx="15" cy="12" r="1.3" fill="currentColor"/><circle cx="9" cy="18" r="1.3" fill="currentColor"/><circle cx="15" cy="18" r="1.3" fill="currentColor"/>',
    mais: '<path d="M12 5v14M5 12h14"/>', foto: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="M4 17l5-4.5 4 3.5 3-2.5 4 3.5"/>',
    desc: '<path d="M5 7h14M5 12h14M5 17h9"/>', design: '<path d="M4 20l8.5-8.5M14 4l1 2.5L17.5 7.5 15 8.5 14 11l-1-2.5L10.5 7.5 13 6.5z"/><path d="M19 13l.6 1.4 1.4.6-1.4.6L19 17l-.6-1.4-1.4-.6 1.4-.6z"/>',
    corrente: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    engrenagem: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    grafico: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>', abrir: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  };
  const svg = (k, cls = "") => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICO[k] || ICO.link}</svg>`;
  const TIPOS = [
    ["whatsapp", "WhatsApp", "WhatsApp"], ["instagram", "Instagram", "Instagram"], ["pix", "PIX", "Pix"], ["avaliacao", "Avaliação", "Avalie no Google"],
    ["link", "Link", "Acesse nosso site"], ["contato", "Contato", "Salvar contato"], ["wifi", "Wi-Fi", "Wi-Fi"], ["tiktok", "TikTok", "TikTok"],
    ["facebook", "Facebook", "Facebook"], ["youtube", "YouTube", "YouTube"], ["email", "E-mail", "Enviar e-mail"], ["telefone", "Ligar", "Ligar agora"],
    ["localizacao", "Localização", "Como chegar"], ["pdf", "PDF", "Cardápio (PDF)"], ["produto", "Produto", "Produto"], ["imagem", "Imagem", ""],
    ["galeria", "Galeria", ""], ["texto", "Texto", ""], ["titulo", "Título", "Seção"], ["espacador", "Espaçador", ""],
  ];
  const DICA = { whatsapp: "Abre uma conversa no WhatsApp com o número configurado.", instagram: "Leva para o perfil do Instagram.", pix: "Mostra a chave Pix com botão de copiar e QR code.",
    avaliacao: "Leva direto para a avaliação no Google.", link: "Leva para qualquer site.", contato: "Salva o contato direto na agenda do celular.", wifi: "Mostra a rede e copia a senha (com QR para conectar).",
    telefone: "Liga para o número ao tocar.", localizacao: "Abre o endereço no Google Maps.", pdf: "Abre um PDF (cardápio, catálogo…).", produto: "Mostra um produto com foto e preço.",
    imagem: "Mostra uma imagem.", galeria: "Mostra várias fotos em grade.", texto: "Um parágrafo de texto.", titulo: "Um título para separar seções.", espacador: "Um espaço em branco entre itens." };
  const NOME_TIPO = Object.fromEntries(TIPOS.map(t => [t[0], t[1]]));
  const SOCIAIS = ["instagram", "tiktok", "facebook", "youtube", "whatsapp", "email", "link", "telefone", "localizacao"];
  const T = ["titulo", "Título do botão"];
  const CAMPOS = {
    link: [T, ["url", "Link (https://…)", "url"]], youtube: [T, ["url", "Link do vídeo ou canal", "url"]], facebook: [T, ["url", "Link da página do Facebook", "url"]],
    avaliacao: [T, ["url", "Link de avaliação do Google", "url"], ["coresGoogle", "Botão com as cores do Google", "check"]],
    pdf: [T, ["url", "Link do PDF (Google Drive, site…)", "url"]], whatsapp: [T, ["numero", "Telefone com DDD ou link do grupo"], ["mensagem", "Mensagem que já vem escrita (opcional)"]],
    instagram: [T, ["usuario", "@ do Instagram"]], tiktok: [T, ["usuario", "@ do TikTok"]], email: [T, ["email", "E-mail", "email"], ["assunto", "Assunto (opcional)"]],
    telefone: [T, ["numero", "Telefone com DDD", "tel"]], localizacao: [T, ["endereco", "Endereço"], ["url", "Ou o link do Google Maps (opcional)", "url"]],
    pix: [["chave", "Chave PIX"], ["tipoChave", "Tipo da chave PIX", "sel:auto=Detectar automaticamente|cpf=CPF|cnpj=CNPJ|email=E-mail|telefone=Telefone|aleatoria=Chave aleatória"], ["titulo", "Texto do botão (opcional)"], ["nome", "Nome de quem recebe (até 25 letras)"], ["cidade", "Cidade (até 15 letras)"]],
    wifi: [["titulo", "Título"], ["rede", "Nome da rede"], ["senha", "Senha"], ["seguranca", "Segurança", "sel:WPA=WPA/WPA2|WEP=WEP|nopass=Sem senha"]],
    contato: [T, ["nome", "Nome"], ["telefone", "Telefone", "tel"], ["email", "E-mail", "email"], ["empresa", "Empresa"], ["cargo", "Cargo"], ["site", "Site", "url"]],
    texto: [["texto", "Texto", "area"]], titulo: [["titulo", "Título da seção"]],
    produto: [["titulo", "Nome do produto"], ["descricao", "Descrição curta"], ["preco", "Preço (R$)", "num"], ["foto", "Foto", "foto"], ["url", "Link ao tocar (opcional)", "url"]],
    imagem: [["foto", "Imagem", "foto"], ["titulo", "Descrição (opcional)"], ["url", "Link ao tocar (opcional)", "url"]],
    galeria: [["titulo", "Título (opcional)"], ["fotos", "Fotos (até 12)", "fotos"]], espacador: [["altura", "Altura em pixels", "num"]],
  };
  const uid = () => Math.random().toString(36).slice(2, 12).padEnd(10, "0");
  const imgUrl = f => "/fotos/" + encodeURIComponent(f);
  const qrImg = (t, extra = "") => `/api/lk/qrimg?t=${encodeURIComponent(t)}${extra}`;
  const edita = () => P().podeEditar();
  const corTema = () => (TEMAS[ed.design.tema] || TEMAS.azul)[0];

  // ================= LISTA DE PÁGINAS =================
  async function carregaPaginas() { paginas = await P().api("GET", "/api/lk/paginas"); }
  function lista() {
    const box = $("#lkPag"), busca = (lista.b || "").toLowerCase();
    const l = (paginas || []).filter(p => !busca || (p.titulo + " " + p.slug).toLowerCase().includes(busca));
    box.innerHTML = `<div class="lp-wrap">
      <div class="lp-cab"><div><h2>Páginas de links</h2><p>Para cartões e placas NFC, QR codes e link na bio. Você edita quando quiser, sem mudar o cartão.</p></div></div>
      <button class="lp-grande edit-only" type="button" data-lk="nova">${svg("mais")} Nova página</button>
      <div class="lp-busca">${svg("link")}<input type="search" id="lkBusca" placeholder="Buscar páginas" value="${esc(lista.b || "")}"></div>
      ${l.length ? l.map(p => `<div class="lp-pcard" data-pid="${esc(p.id)}">
        <div class="lp-pc-a">${p.logo ? `<img src="${imgUrl(p.logo)}" alt="">` : `<span>${esc((p.titulo || "?")[0].toUpperCase())}</span>`}</div>
        <div class="lp-pc-b"><b>${esc(p.titulo)}</b><small>${esc(HOST)}/l/${esc(p.slug)}</small><span class="lp-pc-v">${svg("olho")} ${p.acessos30} <small>em 30 dias</small></span></div>
        <div class="lp-pc-c"><button class="lp-bt" type="button" data-lk="editar">${svg("lapis")} Editar</button><a class="lp-bt pri" href="/l/${esc(p.slug)}" target="_blank" rel="noopener">${svg("abrir")} Abrir</a></div>
      </div>`).join("") : `<div class="lp-vazio"><b>${paginas?.length ? "Nada encontrado" : "Nenhuma página ainda"}</b><p>Crie uma página com WhatsApp, Instagram, Pix, Wi-Fi, avaliação no Google e o que mais quiser. Depois grave o link num cartão NFC ou num QR code.</p></div>`}
    </div>`;
  }
  async function novaPagina() {
    const titulo = prompt("Nome da página (ex.: nome do cliente ou da empresa):"); if (!titulo || !titulo.trim()) return;
    try {
      const p = await P().api("POST", "/api/lk/paginas", { titulo: titulo.trim(), design: { tema: "azul", estilo: "vidro" }, itens: [{ tipo: "whatsapp", titulo: "WhatsApp" }, { tipo: "instagram", titulo: "Instagram", modo: "icone" }] });
      paginas.unshift(p); abreEditor(p.id);
    } catch (e) { P().toast(e.message); }
  }

  // ================= EDITOR =================
  function abreEditor(id) {
    const p = paginas.find(x => x.id === id); if (!p) return;
    ed = JSON.parse(JSON.stringify(p)); abertoItem = null; aba = null; gradeAberta = false; desenha(); window.scrollTo({ top: 0 });
  }
  const chips = (nome, atual, ops) => `<div class="lp-chips">${ops.map(([v, t]) => `<button type="button" class="lp-chip${atual === v ? " on" : ""}" data-set="${nome}" data-v="${v}">${t}</button>`).join("")}</div>`;
  const faixa = (nome, rot, v, a, b, unid = "") => `<label class="lp-faixa"><span>${rot}<b>${v}${unid}</b></span><input type="range" min="${a}" max="${b}" value="${v}" data-k="${nome}"></label>`;
  const corCampo = (nome, rot, v, pad) => `<label class="lp-cor"><span>${rot}</span><input type="color" data-k="${nome}" value="${v || pad}"></label>`;
  function desenha() {
    const d = ed;
    $("#lkPag").innerHTML = `<div class="lp-ed">
      <div class="lp-colA">
        <button class="lp-voltar" type="button" data-lk="voltar">← Páginas</button>
        <div class="lp-cab"><div><h2>Editar página</h2><p>Organize o conteúdo e o visual da página.</p></div>
          <div class="lp-cab-bts"><button class="lp-bt" type="button" data-aba="ajustes">${svg("engrenagem")} Ajustes</button><button class="lp-bt" type="button" data-aba="metricas">${svg("grafico")} Métricas</button><a class="lp-bt" href="/l/${esc(d.slug)}" target="_blank" rel="noopener" id="lkAbrir">${svg("abrir")} Ver página</a></div></div>
        <div class="lp-box"><label class="lp-flut"><span>Título da página</span><input data-k="titulo" maxlength="80" value="${esc(d.titulo)}"></label></div>
        <div class="lp-quatro">${[["logo", "foto", "Logo"], ["descricao", "desc", "Descrição"], ["design", "design", "Design"], ["link", "corrente", "Meu link"]].map(([a, i, t]) => `<button type="button" class="lp-bt${aba === a ? " on" : ""}" data-aba="${a}">${svg(i)} ${t}</button>`).join("")}</div>
        <div id="lpAba">${painelAba()}</div>
        <button class="lp-grande edit-only" type="button" data-lk="grade">${svg("mais")} Adicionar item</button>
        ${gradeAberta ? `<div class="lp-grade edit-only">${TIPOS.map(([t, n]) => `<button type="button" data-add="${t}" title="${esc(DICA[t] || "")}">${svg(t)}<span>${n}</span></button>`).join("")}</div>` : ""}
        <div class="lp-atalhos edit-only">${["instagram", "tiktok", "whatsapp", "email"].map(t => `<button type="button" data-add="${t}" title="Adicionar ${NOME_TIPO[t]}">${svg(t)}<i>+</i></button>`).join("")}<button type="button" data-lk="grade" title="Mais tipos">${svg("mais")}</button></div>
        <p class="lp-dica">Segure e arraste para mudar a ordem</p>
        <div class="lp-itens" id="lkItens">${itensHtml()}</div>
        ${d.rodape != null && (d.rodape || desenha.rodape) ? `<div class="lp-box"><label class="lp-flut"><span>Rodapé</span><textarea data-k="rodape" rows="2" maxlength="300" placeholder="Ex.: endereço, horário de funcionamento">${esc(d.rodape)}</textarea></label></div>`
          : `<button class="lp-tracejado edit-only" type="button" data-lk="rodape">${svg("mais")} Adicionar rodapé</button>`}
        <div class="lp-barra"><span id="lkStatus">Tudo salvo ✓</span><a class="lp-bt pri" href="/l/${esc(d.slug)}" target="_blank" rel="noopener">${svg("abrir")} Ver página</a></div>
      </div>
      <div class="lp-colB"><div class="lp-cel"><iframe id="lkFrame" title="Prévia da página" src="/l/${esc(d.slug)}?previa=1"></iframe></div><p class="lp-dica">Prévia ao vivo · salva sozinho</p></div>
    </div>`;
    if (aba === "metricas") metricas();
  }
  function painelAba() {
    const d = ed, ds = d.design;
    if (aba === "logo") return `<div class="lp-box lp-pn">
      <div class="lp-logo-l"><div class="lp-logoprev f-${d.logoForma} t-${d.logoTam}${d.logoBorda ? " borda" : ""}${d.logoFundo ? " fundo" : ""}">${d.logo ? `<img src="${imgUrl(d.logo)}" alt="" style="object-position:${d.logoX}% ${d.logoY}%;transform:scale(${d.logoZoom / 100});transform-origin:${d.logoX}% ${d.logoY}%">` : "<span>Sem logo</span>"}</div>
        <div class="lp-row"><label class="lp-bt pri">${svg("foto")} ${d.logo ? "Trocar logo" : "Enviar logo"}<input type="file" id="lkLogoArq" accept="image/*" hidden></label>${d.logo ? `<button class="lp-bt" type="button" data-lk="tiralogo">${svg("lixo")} Tirar</button>` : ""}</div></div>
      <div class="lp-grupo"><span>Formato</span>${chips("logoForma", d.logoForma, [["redondo", "Redonda"], ["arredondado", "Arredondada"], ["quadrado", "Quadrada"], ["inteira", "Inteira, sem corte"]])}</div>
      <div class="lp-grupo"><span>Tamanho</span>${chips("logoTam", d.logoTam, [["p", "Pequena"], ["m", "Média"], ["g", "Grande"]])}</div>
      ${d.logoForma !== "inteira" ? `<div class="lp-grupo"><span>Enquadrar</span>${faixa("logoZoom", "Zoom", d.logoZoom, 100, 300, "%")}${faixa("logoX", "Mover para os lados", d.logoX, 0, 100)}${faixa("logoY", "Mover para cima/baixo", d.logoY, 0, 100)}</div>
      <div class="lp-row"><label class="lp-sw"><input type="checkbox" data-k="logoBorda"${d.logoBorda ? " checked" : ""}><i></i> Moldura branca</label><label class="lp-sw"><input type="checkbox" data-k="logoFundo"${d.logoFundo ? " checked" : ""}><i></i> Fundo branco atrás da logo</label></div>` : `<p class="lp-dica" style="text-align:left">Logo inteira aparece sem círculo nem moldura. Boa para logos com fundo transparente (PNG).</p>`}
    </div>`;
    if (aba === "descricao") return `<div class="lp-box lp-pn"><label class="lp-flut"><span>Descrição</span><textarea data-k="descricao" rows="3" maxlength="300" placeholder="Uma frase sobre a empresa ou a pessoa">${esc(d.descricao)}</textarea></label>
      <label class="lp-sw"><input type="checkbox" data-k="mostrarTitulo"${d.mostrarTitulo !== false ? " checked" : ""}><i></i> Mostrar o nome da página embaixo da logo</label></div>`;
    if (aba === "link") return `<div class="lp-box lp-pn"><b>Meu link</b><p class="lp-sub">Configure um endereço curto e fácil para a página.</p>
      <div class="lp-linkin"><span>${esc(HOST)}/l/</span><input id="lkSlug" maxlength="50" value="${esc(d.slug)}"></div><small id="lkSlugMsg" class="lp-sub"></small>
      <div class="lp-row"><button class="lp-bt" type="button" data-lk="copialink">${svg("corrente")} Copiar link</button><button class="lp-bt" type="button" data-lk="qrpagina">${svg("pix")} Criar QR code dinâmico</button></div>
      <div class="lp-qrmini"><img src="${qrImg(ORIGEM + "/l/" + d.slug)}" alt="QR da página"><div><b>QR direto da página</b><p class="lp-sub">Para mudar o destino depois sem reimprimir, use o QR code dinâmico.</p><a class="lp-bt" href="${qrImg(ORIGEM + "/l/" + d.slug, "&f=png&n=" + encodeURIComponent("qr-" + d.slug))}">Baixar PNG</a></div></div></div>`;
    if (aba === "ajustes") return `<div class="lp-box lp-pn"><b>Ajustes</b>
      <div class="lp-grupo"><span>Imagem de compartilhamento</span><p class="lp-sub">Aparece quando o link é enviado no WhatsApp e nas redes. Tamanho ideal 1200×630. Sem imagem, usa a logo.</p>
        <div class="lp-row">${d.ogImagem ? `<img src="${imgUrl(d.ogImagem)}" alt="" class="lp-og">` : ""}<label class="lp-bt">${svg("foto")} ${d.ogImagem ? "Trocar" : "Enviar imagem"}<input type="file" id="lkOgArq" accept="image/*" hidden></label>${d.ogImagem ? `<button class="lp-bt" type="button" data-lk="tiraog">Tirar</button>` : ""}</div></div>
      <label class="lp-sw"><input type="checkbox" data-k="compartilhar"${d.compartilhar !== false ? " checked" : ""}><i></i> Mostrar o botão "Compartilhar"</label>
      <div class="lp-row" style="justify-content:flex-end"><button class="lp-bt perigo edit-only" type="button" data-lk="excluir">${svg("lixo")} Excluir página</button></div></div>`;
    if (aba === "metricas") return `<div class="lp-box lp-pn" id="lkMet"><b>Métricas</b><p class="lp-sub">Carregando…</p></div>`;
    if (aba === "design") {
      const sub = { tema: () => `<div class="lp-temas">${Object.entries(TEMAS).map(([k, [c, f1, f2]]) => `<button type="button" class="lp-tema${ds.tema === k ? " on" : ""}" data-tema="${k}"><i style="background:linear-gradient(160deg,${f1},${f2})"><em style="background:${c}"></em><em style="background:${c};opacity:.7"></em></i><span>${NOME_TEMA[k]}</span></button>`).join("")}</div>`,
        fundo: () => `<div class="lp-grupo"><span>Fundo</span>${chips("design.fundo", ds.fundo, [["tema", "Do tema"], ["cor", "Uma cor"], ["gradiente", "Degradê"], ["imagem", "Foto"]])}</div>
          ${ds.fundo === "cor" || ds.fundo === "gradiente" ? `<div class="lp-row">${corCampo("design.fundo1", ds.fundo === "gradiente" ? "Cor 1" : "Cor", ds.fundo1, TEMAS[ds.tema][1])}${ds.fundo === "gradiente" ? corCampo("design.fundo2", "Cor 2", ds.fundo2, TEMAS[ds.tema][2]) : ""}</div>` : ""}
          ${ds.fundo === "imagem" ? `<div class="lp-fotofundo">${ds.fundoImagem ? `<img src="${imgUrl(ds.fundoImagem)}" alt="">` : ""}<div><b>${ds.fundoImagem ? "Imagem carregada" : "Sem imagem"}</b><small>Fundo da página</small></div><label class="lp-bt">${ds.fundoImagem ? "Trocar" : "Enviar foto"}<input type="file" id="lkFundoArq" accept="image/*" hidden></label></div>
            ${faixa("design.fundoBlur", "Desfoque", ds.fundoBlur, 0, 30, "px")}<div class="lp-grupo"><span>Camada por cima (melhora a leitura)</span>${chips("design.fundoSobre", ds.fundoSobre, [["escura", "Escura"], ["clara", "Clara"], ["nenhuma", "Nenhuma"]])}</div>${ds.fundoSobre !== "nenhuma" ? faixa("design.fundoOpac", "Opacidade", ds.fundoOpac, 0, 90, "%") : ""}` : ""}`,
        botoes: () => `<div class="lp-row">${corCampo("design.corBotao", "Botão", ds.corBotao, TEMAS[ds.tema][0])}${corCampo("design.corTexto", "Texto", ds.corTexto, "#ffffff")}${ds.degrade ? corCampo("design.corBotao2", "Degradê", ds.corBotao2, "#60a5fa") : ""}</div>
          <label class="lp-sw"><input type="checkbox" data-k="design.degrade"${ds.degrade ? " checked" : ""}><i></i> Botão em degradê</label>${ds.corBotao || ds.corTexto ? `<button class="lp-link" type="button" data-lk="coresTema">Voltar às cores do tema</button>` : ""}
          <div class="lp-grupo"><span>Estilo</span>${chips("design.estilo", ds.estilo, [["vidro", "Vidro"], ["cristal", "Cristal (transparente)"], ["solido", "Cheio"], ["contorno", "Contorno"], ["sombra", "Sombra"]])}</div>
          <div class="lp-grupo"><span>Formato</span>${chips("design.botao", ds.botao, [["pilula", "Pílula"], ["arredondado", "Arredondado"], ["quadrado", "Reto"]])}</div>`,
        cartoes: () => `<p class="lp-sub">Cores dos cartões de Pix e Wi-Fi.</p><div class="lp-row">${corCampo("design.pixCor", "Cartão", ds.pixCor, "#ffffff")}${corCampo("design.pixTexto", "Texto do cartão", ds.pixTexto, TEMAS[ds.tema][0])}</div>${ds.pixCor || ds.pixTexto ? `<button class="lp-link" type="button" data-lk="coresPix">Voltar ao padrão</button>` : ""}`,
        fonte: () => `<div class="lp-fontes">${Object.entries(FONTES).map(([k, n]) => `<button type="button" class="lp-chip${ds.fonte === k ? " on" : ""}" data-set="design.fonte" data-v="${k}" style="font-family:'${n}',system-ui">${n}</button>`).join("")}</div>` };
      return `<div class="lp-box lp-pn lp-dsg"><div class="lp-celmob"><iframe title="Prévia" src="/l/${esc(d.slug)}?previa=1" id="lkFrame2"></iframe></div>
        <div class="lp-dtabs">${[["tema", "design", "Tema"], ["fundo", "foto", "Fundo"], ["botoes", "olho", "Botões"], ["cartoes", "pix", "Pix e Wi-Fi"], ["fonte", "texto", "Fonte"]].map(([k, i, t]) => `<button type="button" class="${abaDesign === k ? "on" : ""}" data-dtab="${k}">${svg(i)}<span>${t}</span></button>`).join("")}</div>
        <div class="lp-dbody">${sub[abaDesign]()}</div></div>`;
    }
    return "";
  }
  function itensHtml() {
    if (!ed.itens.length) return `<div class="lp-vazio"><b>Nenhum item ainda</b><p>Use "Adicionar item" ou os atalhos acima.</p></div>`;
    return ed.itens.map((i, k) => {
      const aberto = abertoItem === i.id;
      return `<div class="lp-item${i.ativo ? "" : " off"}${aberto ? " aberto" : ""}" data-k="${k}" draggable="true">
        <div class="lp-ih"><span class="lp-iic">${svg(i.tipo)}</span><b data-ia="abre">${esc(i.titulo || NOME_TIPO[i.tipo])}${i.modo === "icone" ? ' <small class="lp-tag">ícone</small>' : ""}${i.destaque ? ' <small class="lp-tag">✨</small>' : ""}</b>
          <span class="lp-iacs edit-only"><button type="button" data-ia="ver" title="${i.ativo ? "Esconder" : "Mostrar"}">${svg(i.ativo ? "olho" : "olhoNao")}</button><button type="button" data-ia="dup" title="Duplicar">${svg("dup")}</button><button type="button" data-ia="del" class="perigo" title="Excluir">${svg("lixo")}</button></span>
          <button type="button" class="lp-bt lp-ed-bt" data-ia="abre">${aberto ? "✕ Fechar" : `${svg("lapis")} Editar`}</button><span class="lp-arr" title="Arrastar">${svg("arr")}</span></div>
        ${aberto ? `<div class="lp-campos">${(CAMPOS[i.tipo] || []).map(c => campo(i, c)).join("")}
          ${SOCIAIS.includes(i.tipo) ? `<div class="lp-grupo"><span>Mostrar como</span><div class="lp-chips">${[["botao", "Botão"], ["icone", "Só o ícone (linha de ícones)"]].map(([v, t]) => `<button type="button" class="lp-chip${(i.modo || "botao") === v ? " on" : ""}" data-im="modo" data-v="${v}">${t}</button>`).join("")}</div></div>` : ""}
          ${!["texto", "titulo", "espacador", "galeria", "imagem", "produto"].includes(i.tipo) && i.modo !== "icone" ? `<div class="lp-grupo"><span>Destaque animado deste botão</span><div class="lp-chips">${[["", "Nenhum"], ["pulsar", "Pulsar"], ["brilho", "Brilho passando"], ["balancar", "Balançar"]].map(([v, t]) => `<button type="button" class="lp-chip${(i.destaque || "") === v ? " on" : ""}" data-im="destaque" data-v="${v}">${t}</button>`).join("")}</div></div>` : ""}
        </div>` : ""}</div>`;
    }).join("");
  }
  function campo(i, [k, rot, tipo]) {
    const v = i[k] ?? "";
    if (tipo === "check") return `<label class="lp-sw"><input type="checkbox" data-c="${k}"${v !== false ? " checked" : ""}><i></i> ${rot}</label>`;
    if (tipo === "area") return `<label class="lp-flut"><span>${rot}</span><textarea data-c="${k}" rows="3" maxlength="1500">${esc(v)}</textarea></label>`;
    if (tipo && tipo.startsWith("sel:")) return `<label class="lp-flut"><span>${rot}</span><select data-c="${k}">${tipo.slice(4).split("|").map(o => { const [a, b] = o.split("="); return `<option value="${a}"${(v || tipo.slice(4).split("=")[0]) === a ? " selected" : ""}>${b}</option>`; }).join("")}</select></label>`;
    if (tipo === "foto") return `<div class="lp-grupo"><span>${rot}</span><div class="lp-row">${v ? `<img src="${imgUrl(v)}" alt="" class="lp-mini">` : ""}<label class="lp-bt">${svg("foto")} ${v ? "Trocar" : "Enviar"}<input type="file" accept="image/*" data-foto="${k}" hidden></label>${v ? `<button type="button" class="lp-bt" data-tirafoto="${k}">Tirar</button>` : ""}</div></div>`;
    if (tipo === "fotos") return `<div class="lp-grupo"><span>${rot}</span><div class="lp-row">${(i.fotos || []).map((f, n) => `<span class="lp-gf"><img src="${imgUrl(f)}" alt=""><button type="button" data-tiragal="${n}">✕</button></span>`).join("")}${(i.fotos || []).length < 12 ? `<label class="lp-bt">${svg("mais")} Fotos<input type="file" accept="image/*" multiple data-gal="1" hidden></label>` : ""}</div></div>`;
    const t = { url: "url", tel: "tel", email: "email", num: "number" }[tipo] || "text";
    return `<label class="lp-flut"><span>${rot}</span><input type="${t}" data-c="${k}" value="${esc(v)}"${t === "number" ? ' step="0.01" min="0"' : ""}></label>`;
  }
  const redesenhaItens = () => { $("#lkItens").innerHTML = itensHtml(); };
  const redesenhaAba = () => { $("#lpAba").innerHTML = painelAba(); document.querySelectorAll(".lp-quatro .lp-bt").forEach(b => b.classList.toggle("on", b.dataset.aba === aba)); if (aba === "metricas") metricas(); };

  // salvar com espera (auto-save) e prévia atualizada
  function agenda(rapido) { clearTimeout(salvarT); const s = $("#lkStatus"); if (s) s.textContent = "Salvando…"; salvarT = setTimeout(salva, rapido ? 150 : 650); }
  async function salva() {
    if (!ed || !edita()) return; if (salvando) { pendente = true; return; } salvando = true;
    try {
      const r = await P().api("PUT", "/api/lk/paginas/" + encodeURIComponent(ed.id), { ...ed });
      const i = paginas.findIndex(x => x.id === ed.id); if (i >= 0) paginas[i] = r;
      ed.slug = r.slug; const s = $("#lkStatus"); if (s) s.textContent = "Tudo salvo ✓";
      document.querySelectorAll('a[href^="/l/"]').forEach(a => { if (a.closest(".lp-ed")) a.href = "/l/" + r.slug; });
      for (const id of ["lkFrame", "lkFrame2"]) { const f = document.getElementById(id); if (!f) continue; let y = 0; try { y = f.contentWindow.scrollY; } catch (e) {} f.onload = () => { try { f.contentWindow.scrollTo(0, y); } catch (e) {} }; f.src = "/l/" + r.slug + "?previa=1&t=" + Date.now(); }
    } catch (e) { const s = $("#lkStatus"); if (s) s.textContent = "Não salvou"; P().toast(e.message); }
    salvando = false; if (pendente) { pendente = false; salva(); }
  }
  async function metricas() {
    const box = $("#lkMet"); if (!box || !ed) return;
    try {
      const m = await P().api("GET", `/api/lk/paginas/${encodeURIComponent(ed.id)}/metricas?dias=30`);
      const dias = [...Array(30)].map((_, k) => { const d = new Date(Date.now() - (29 - k) * 86400000 - 3 * 3600000).toISOString().slice(0, 10); return [d, m.porDia[d] || 0]; });
      const max = Math.max(1, ...dias.map(x => x[1]));
      const cliques = ed.itens.map(i => [i, m.porItem[i.id] || 0]).filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]);
      box.innerHTML = `<b>Métricas</b><div class="lp-row" style="gap:22px"><span class="lp-num"><b>${m.total}</b><small>acessos em 30 dias</small></span><span class="lp-num"><b>${m.sempre}</b><small>desde o início</small></span></div>
        <div class="lp-barras">${dias.map(([d, n]) => `<i style="height:${Math.max(3, Math.round(n / max * 70))}px" title="${d.split("-").reverse().slice(0, 2).join("/")}: ${n}"></i>`).join("")}</div>
        ${cliques.length ? `<span class="lp-sub">Cliques por item</span>${cliques.map(([i, n]) => `<div class="lp-cl"><span>${svg(i.tipo)} ${esc(i.titulo || NOME_TIPO[i.tipo])}</span><b>${n}</b></div>`).join("")}` : `<p class="lp-sub">Os cliques nos botões aparecem aqui.</p>`}`;
    } catch (e) { box.innerHTML = `<b>Métricas</b><p class="lp-sub">${esc(e.message)}</p>`; }
  }
  const setK = (k, v) => { const p = k.split("."); if (p.length === 2) ed[p[0]][p[1]] = v; else ed[k] = v; };
  const getK = k => { const p = k.split("."); return p.length === 2 ? ed[p[0]][p[1]] : ed[k]; };

  // ---------- eventos da área de páginas ----------
  const pag = document.getElementById("lkPag");
  pag.addEventListener("input", e => {
    const t = e.target;
    if (t.id === "lkBusca") { lista.b = t.value; const pos = t.selectionStart; lista(); const b = $("#lkBusca"); b.focus(); b.setSelectionRange(pos, pos); return; }
    if (!ed) return;
    if (t.dataset.k) {
      const v = t.type === "checkbox" ? t.checked : t.type === "range" ? +t.value : t.value; setK(t.dataset.k, v);
      if (t.type === "range") { const b = t.closest(".lp-faixa")?.querySelector("b"); if (b) b.textContent = v + (t.dataset.k === "logoZoom" || t.dataset.k.endsWith("Opac") ? "%" : t.dataset.k.endsWith("Blur") ? "px" : "");
        if (t.dataset.k.startsWith("logo")) { const im = $(".lp-logoprev img"); if (im) { im.style.objectPosition = `${ed.logoX}% ${ed.logoY}%`; im.style.transform = `scale(${ed.logoZoom / 100})`; im.style.transformOrigin = `${ed.logoX}% ${ed.logoY}%`; } } }
      if (t.type === "checkbox" && (t.dataset.k === "design.degrade" || t.dataset.k.startsWith("logo"))) redesenhaAba();
      agenda(); return;
    }
    if (t.id === "lkSlug") { clearTimeout(pag._s); pag._s = setTimeout(async () => { const r = await P().api("GET", `/api/lk/slug?s=${encodeURIComponent(t.value)}&id=${encodeURIComponent(ed.id)}`).catch(() => null); if (!r) return; $("#lkSlugMsg").textContent = r.livre ? `${HOST}/l/${r.slug} ✓ disponível` : `"${r.slug || t.value}" não está disponível`; if (r.livre) { ed.slug = r.slug; agenda(true); } }, 500); return; }
    const box = t.closest(".lp-item"); if (box && t.dataset.c) { const i = ed.itens[+box.dataset.k]; i[t.dataset.c] = t.type === "checkbox" ? t.checked : t.value; const s = box.querySelector(".lp-ih > b"); if (t.dataset.c === "titulo" && s && s.firstChild) s.firstChild.textContent = t.value || NOME_TIPO[i.tipo]; agenda(); }
  });
  pag.addEventListener("change", async e => {
    const t = e.target; if (!ed) return;
    const sobe = async f => { try { return await P().enviaImagem(f); } catch (err) { P().toast(err.message); return null; } };
    if (t.id === "lkLogoArq" && t.files[0]) { const id = await sobe(t.files[0]); if (id) { ed.logo = id; ed.logoZoom = 100; ed.logoX = 50; ed.logoY = 50; redesenhaAba(); agenda(true); } return; }
    if (t.id === "lkFundoArq" && t.files[0]) { const id = await sobe(t.files[0]); if (id) { ed.design.fundoImagem = id; redesenhaAba(); agenda(true); } return; }
    if (t.id === "lkOgArq" && t.files[0]) { const id = await sobe(t.files[0]); if (id) { ed.ogImagem = id; redesenhaAba(); agenda(true); } return; }
    const box = t.closest(".lp-item"); if (!box) return; const i = ed.itens[+box.dataset.k];
    if (t.dataset.foto && t.files[0]) { const id = await sobe(t.files[0]); if (id) { i[t.dataset.foto] = id; redesenhaItens(); agenda(true); } }
    if (t.dataset.gal && t.files.length) { i.fotos = i.fotos || []; for (const f of [...t.files].slice(0, 12 - i.fotos.length)) { const id = await sobe(f); if (id) i.fotos.push(id); } redesenhaItens(); agenda(true); }
  });
  pag.addEventListener("click", async e => {
    const b = e.target.closest("[data-lk],[data-aba],[data-dtab],[data-set],[data-tema],[data-add],[data-ia],[data-im],[data-tirafoto],[data-tiragal]"); if (!b) return;
    const a = b.dataset.lk;
    if (a === "nova") return novaPagina();
    if (a === "editar") return abreEditor(b.closest("[data-pid]").dataset.pid);
    if (a === "voltar") { clearTimeout(salvarT); if ($("#lkStatus")?.textContent === "Salvando…") await salva(); ed = null; lista(); return; }
    if (!ed) return;
    if (a === "excluir") { if (!confirm(`Excluir a página "${ed.titulo}"? O endereço deixa de funcionar e os QR codes que apontam para ela ficam sem destino.`)) return;
      try { await P().api("DELETE", "/api/lk/paginas/" + encodeURIComponent(ed.id)); paginas = paginas.filter(x => x.id !== ed.id); ed = null; lista(); P().toast("Página excluída"); } catch (err) { P().toast(err.message); } return; }
    if (a === "grade") { gradeAberta = !gradeAberta; desenhaManter(); return; }
    if (a === "rodape") { ed.rodape = ed.rodape || ""; desenha.rodape = true; desenhaManter(); setTimeout(() => document.querySelector('[data-k="rodape"]')?.focus(), 30); return; }
    if (a === "tiralogo") { ed.logo = ""; redesenhaAba(); agenda(true); return; }
    if (a === "tiraog") { ed.ogImagem = ""; redesenhaAba(); agenda(true); return; }
    if (a === "coresTema") { ed.design.corBotao = ""; ed.design.corTexto = ""; ed.design.corBotao2 = ""; redesenhaAba(); agenda(true); return; }
    if (a === "coresPix") { ed.design.pixCor = ""; ed.design.pixTexto = ""; redesenhaAba(); agenda(true); return; }
    if (a === "copialink") { const u = ORIGEM + "/l/" + ed.slug; try { await navigator.clipboard.writeText(u); P().toast("Link copiado: " + u); } catch (err) { prompt("Copie:", u); } return; }
    if (a === "qrpagina") return qrParaPagina(ed.id);
    if (b.dataset.aba) { aba = aba === b.dataset.aba ? null : b.dataset.aba; redesenhaAba(); return; }
    if (b.dataset.dtab) { abaDesign = b.dataset.dtab; redesenhaAba(); return; }
    if (b.dataset.tema) { ed.design.tema = b.dataset.tema; ed.design.corBotao = ""; ed.design.corBotao2 = ""; ed.design.pixTexto = ""; redesenhaAba(); agenda(true); return; }
    if (b.dataset.set) { setK(b.dataset.set, b.dataset.v); redesenhaAba(); agenda(true); return; }
    if (b.dataset.add) {
      const tp = TIPOS.find(t => t[0] === b.dataset.add); const i = { id: uid(), tipo: tp[0], titulo: tp[2], ativo: true };
      if (tp[0] === "espacador") i.altura = 24; if (tp[0] === "pix") i.tipoChave = "auto"; if (["tiktok", "email"].includes(tp[0]) && e.target.closest(".lp-atalhos")) i.modo = "icone";
      ed.itens.push(i); abertoItem = i.id; gradeAberta = false; desenhaManter(); agenda(true);
      setTimeout(() => document.querySelector(`.lp-item[data-k="${ed.itens.length - 1}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 60); return;
    }
    const box = b.closest(".lp-item"); if (!box) return; const k = +box.dataset.k, i = ed.itens[k];
    if (b.dataset.im) { i[b.dataset.im] = b.dataset.v; redesenhaItens(); agenda(true); return; }
    if (b.dataset.tirafoto) { i[b.dataset.tirafoto] = ""; redesenhaItens(); agenda(true); return; }
    if (b.dataset.tiragal != null) { i.fotos.splice(+b.dataset.tiragal, 1); redesenhaItens(); agenda(true); return; }
    const ia = b.dataset.ia;
    if (ia === "abre") { abertoItem = abertoItem === i.id ? null : i.id; redesenhaItens(); return; }
    if (ia === "ver") { i.ativo = !i.ativo; redesenhaItens(); agenda(true); return; }
    if (ia === "dup") { ed.itens.splice(k + 1, 0, { ...JSON.parse(JSON.stringify(i)), id: uid() }); redesenhaItens(); agenda(true); return; }
    if (ia === "del") { if (!confirm(`Excluir "${i.titulo || NOME_TIPO[i.tipo]}"?`)) return; ed.itens.splice(k, 1); redesenhaItens(); agenda(true); }
  });
  function desenhaManter() { const y = scrollY; desenha(); scrollTo(0, y); }
  // arrastar para reordenar (mouse) e segurar-e-arrastar (toque)
  let arrastando = null;
  pag.addEventListener("dragstart", e => { const it = e.target.closest?.(".lp-item"); if (!it || e.target.closest("input,textarea,select")) return; arrastando = +it.dataset.k; it.classList.add("arr"); e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", ""); } catch (x) {} });
  pag.addEventListener("dragover", e => { if (arrastando == null) return; const it = e.target.closest?.(".lp-item"); if (it) { e.preventDefault(); document.querySelectorAll(".lp-item.sobre").forEach(x => x.classList.remove("sobre")); it.classList.add("sobre"); } });
  pag.addEventListener("drop", e => { const it = e.target.closest?.(".lp-item"); if (arrastando == null || !it) return; e.preventDefault(); move(arrastando, +it.dataset.k); arrastando = null; });
  pag.addEventListener("dragend", () => { arrastando = null; document.querySelectorAll(".lp-item.arr,.lp-item.sobre").forEach(x => x.classList.remove("arr", "sobre")); });
  function move(de, para) { if (de === para) return; const [m] = ed.itens.splice(de, 1); ed.itens.splice(para, 0, m); redesenhaItens(); agenda(true); }
  let toque = null;
  pag.addEventListener("touchstart", e => { const h = e.target.closest(".lp-arr"); if (!h) return; const it = h.closest(".lp-item"); toque = { de: +it.dataset.k }; it.classList.add("arr"); }, { passive: true });
  pag.addEventListener("touchmove", e => { if (!toque) return; e.preventDefault(); const p = e.touches[0], el = document.elementFromPoint(p.clientX, p.clientY)?.closest(".lp-item"); document.querySelectorAll(".lp-item.sobre").forEach(x => x.classList.remove("sobre")); if (el) { el.classList.add("sobre"); toque.para = +el.dataset.k; } }, { passive: false });
  pag.addEventListener("touchend", () => { if (!toque) return; const t = toque; toque = null; document.querySelectorAll(".lp-item.arr,.lp-item.sobre").forEach(x => x.classList.remove("arr", "sobre")); if (t.para != null) move(t.de, t.para); });

  // ================= QR CODES DINÂMICOS =================
  async function carregaQrs() { qrs = await P().api("GET", "/api/lk/qr"); }
  const destTxt = q => q.destinoTipo === "url" ? q.url : q.destinoTipo === "pagina" ? ((paginas || []).find(p => p.id === q.paginaId) ? "Página: " + paginas.find(p => p.id === q.paginaId).titulo : "Página excluída") : "Sem destino (ainda não ativado)";
  function telaQr() {
    const box = $("#lkQr"), busca = (telaQr.b || "").toLowerCase(), f = telaQr.form;
    const l = (qrs || []).filter(q => !busca || (q.nome + " " + q.codigo + " " + destTxt(q)).toLowerCase().includes(busca));
    const opcPag = sel => (paginas || []).map(p => `<option value="${esc(p.id)}"${p.id === sel ? " selected" : ""}>${esc(p.titulo)}</option>`).join("");
    box.innerHTML = `<div class="lp-wrap">
      <div class="lp-cab"><div><h2>QR codes dinâmicos</h2><p>O QR leva para ${esc(HOST)}/q/código e você troca o destino quando quiser, sem reimprimir. Serve também para gravar em cartões e placas NFC.</p></div></div>
      <button class="lp-grande edit-only" type="button" data-q="novo">${svg("mais")} Novo QR code</button>
      ${f ? `<div class="lp-box lp-pn"><b>${f.id ? "Mudar destino" : "Novo QR code"}</b>
        <label class="lp-flut"><span>Nome (para você achar depois)</span><input id="qNome" maxlength="80" value="${esc(f.nome || "")}" placeholder="Ex.: Placa balcão Da Nossa Cozinha"></label>
        ${f.id ? "" : `<div class="lp-row"><label class="lp-flut" style="flex:1"><span>Quantidade (mais de 1 = lote para ativar depois)</span><input id="qQtd" type="number" min="1" max="200" value="${f.quantidade || 1}"></label>
          <label class="lp-flut" style="flex:1"><span>Código (opcional)</span><input id="qCod" maxlength="32" placeholder="automático" value="${esc(f.codigo || "")}"></label></div>`}
        <div class="lp-grupo"><span>Destino</span><div class="lp-chips">${[["pagina", "Uma página de links"], ["url", "Um link"], ["nenhum", "Nenhum (ativar depois)"]].map(([v, t]) => `<button type="button" class="lp-chip${f.destinoTipo === v ? " on" : ""}" data-qt="${v}">${t}</button>`).join("")}</div></div>
        ${f.destinoTipo === "pagina" ? `<label class="lp-flut"><span>Página</span><select id="qPag">${opcPag(f.paginaId) || "<option value=''>Crie uma página primeiro</option>"}</select></label>` : ""}
        ${f.destinoTipo === "url" ? `<label class="lp-flut"><span>Link de destino</span><input id="qUrl" type="url" placeholder="https://…" value="${esc(f.url || "")}"></label>` : ""}
        <div class="lp-row"><button class="lp-bt pri" type="button" data-q="salvar">${f.id ? "Salvar destino" : "Criar"}</button><button class="lp-bt" type="button" data-q="cancelar">Cancelar</button></div></div>` : ""}
      <div class="lp-busca">${svg("link")}<input type="search" id="qBusca" placeholder="Buscar QR codes" value="${esc(telaQr.b || "")}"></div>
      ${l.length ? l.map(q => { const link = ORIGEM + "/q/" + q.codigo; return `<div class="lp-qr" data-qid="${esc(q.id)}">
        <img src="${qrImg(link)}" alt="QR ${esc(q.codigo)}" loading="lazy">
        <div class="lp-qr-b"><b>${esc(q.nome)}</b><a href="${esc(link)}" target="_blank" rel="noopener">${esc(HOST)}/q/${esc(q.codigo)}</a>
          <span class="${q.destinoTipo === "nenhum" ? "lp-pend" : "lp-sub"}">→ ${esc(destTxt(q))}</span><span class="lp-sub">${svg("olho")} ${q.scans30} leitura${q.scans30 === 1 ? "" : "s"} em 30 dias · ${q.scansSempre} no total</span>
          <div class="lp-row"><button class="lp-bt edit-only" type="button" data-q="editar">${svg("lapis")} Mudar destino</button><a class="lp-bt" href="${qrImg(link, "&f=png&n=" + encodeURIComponent("qr-" + q.codigo))}">PNG</a><a class="lp-bt" href="${qrImg(link, "&d=1&n=" + encodeURIComponent("qr-" + q.codigo))}">SVG</a><button class="lp-bt" type="button" data-q="copiar">${svg("corrente")} Copiar</button><button class="lp-bt perigo edit-only" type="button" data-q="excluir" title="Excluir">${svg("lixo")}</button></div></div>
      </div>`; }).join("") : `<div class="lp-vazio"><b>${qrs?.length ? "Nada encontrado" : "Nenhum QR code ainda"}</b><p>Crie um QR para uma página de links ou para qualquer endereço. Se o endereço mudar, é só trocar o destino aqui.</p></div>`}
    </div>`;
  }
  async function qrParaPagina(paginaId) {
    const p = paginas.find(x => x.id === paginaId);
    try { await carregaQrs(); const ja = qrs.find(q => q.destinoTipo === "pagina" && q.paginaId === paginaId);
      if (!ja) { const r = await P().api("POST", "/api/lk/qr", { nome: p.titulo, destinoTipo: "pagina", paginaId }); qrs.unshift(...r); P().toast("QR code dinâmico criado para a página"); }
      telaQr.b = p.titulo; P().abreTab("qrcodes"); } catch (e) { P().toast(e.message); }
  }
  const qbox = document.getElementById("lkQr");
  qbox.addEventListener("input", e => { if (e.target.id === "qBusca") { telaQr.b = e.target.value; const pos = e.target.selectionStart; telaQr(); const b = $("#qBusca"); b.focus(); b.setSelectionRange(pos, pos); } });
  function leFormQr() { const f = telaQr.form; if (!f) return; f.nome = $("#qNome")?.value ?? f.nome; f.quantidade = $("#qQtd")?.value ?? f.quantidade; f.codigo = $("#qCod")?.value ?? f.codigo; f.paginaId = $("#qPag")?.value ?? f.paginaId; f.url = $("#qUrl")?.value ?? f.url; }
  qbox.addEventListener("click", async e => {
    const qt = e.target.closest("[data-qt]"); if (qt) { leFormQr(); telaQr.form.destinoTipo = qt.dataset.qt; if (qt.dataset.qt === "pagina" && !telaQr.form.paginaId) telaQr.form.paginaId = paginas?.[0]?.id; telaQr(); return; }
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

  // fontes das opções de fonte (só para mostrar no painel)
  if (!document.getElementById("lpFontes")) { const l = document.createElement("link"); l.id = "lpFontes"; l.rel = "stylesheet"; l.href = "https://fonts.googleapis.com/css2?family=Poppins:wght@500;700&family=Montserrat:wght@600&family=Nunito:wght@700&family=Playfair+Display:wght@600&display=swap"; document.head.appendChild(l); }

  // ================= entrada =================
  window.lkPainel = {
    async abrir(t) {
      try {
        if (t === "paginas") { if (!paginas) $("#lkPag").innerHTML = '<p class="lp-sub">Carregando…</p>'; await carregaPaginas(); if (ed && paginas.find(x => x.id === ed.id)) return; ed = null; lista(); }
        if (t === "qrcodes") { $("#lkQr").innerHTML = '<p class="lp-sub">Carregando…</p>'; await Promise.all([carregaQrs(), paginas ? null : carregaPaginas()]); telaQr(); }
      } catch (e) { P().toast(e.message); }
    },
  };
  if (window.painel) { if (!$("#p-paginas").hidden) window.lkPainel.abrir("paginas"); if (!$("#p-qrcodes").hidden) window.lkPainel.abrir("qrcodes"); }
})();

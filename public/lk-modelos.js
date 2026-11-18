/* Modelos prontos das páginas de links. Usado no painel (window.LK_MODELOS) e no servidor (ativação pelo cliente). */
(function (raiz, fabrica) {
  if (typeof module === "object" && module.exports) module.exports = fabrica(); else raiz.LK_MODELOS = fabrica();
})(typeof self !== "undefined" ? self : this, function () {
  // d = { nome, whatsapp, instagram, email }
  const semana = (abre, fecha, sab, dom) => [0, 1, 2, 3, 4, 5, 6].map(k => k === 0 ? (dom ? { aberto: true, abre: dom[0], fecha: dom[1] } : { aberto: false, abre: "08:00", fecha: "12:00" })
    : k === 6 ? (sab ? { aberto: true, abre: sab[0], fecha: sab[1] } : { aberto: false, abre: "08:00", fecha: "12:00" }) : { aberto: true, abre, fecha });
  const ig = d => ({ tipo: "instagram", titulo: "Instagram", usuario: d.instagram || "", modo: "icone" });
  const zap = (d, titulo, destaque = "") => ({ tipo: "whatsapp", titulo, numero: d.whatsapp || "", destaque });
  return {
    branco: { nome: "Em branco", desc: "Só WhatsApp e Instagram", tema: { tema: "azul", estilo: "vidro" },
      itens: d => [ig(d), zap(d, "WhatsApp")] },
    restaurante: { nome: "Restaurante", desc: "Cardápio, pedido no WhatsApp, horário, Pix", tema: { tema: "laranja", estilo: "vidro" },
      itens: d => [ig(d), { tipo: "facebook", titulo: "Facebook", modo: "icone" }, zap(d, "Peça pelo WhatsApp", "pulsar"), { tipo: "pdf", titulo: "Cardápio" },
        { tipo: "avaliacao", titulo: "Avalie no Google", coresGoogle: true }, { tipo: "horario", titulo: "Horário de funcionamento", dias: semana("11:00", "22:00", ["11:00", "23:00"], ["11:00", "16:00"]) },
        { tipo: "pix", titulo: "", tipoChave: "auto" }, { tipo: "wifi", titulo: "Wi-Fi", seguranca: "WPA" }, { tipo: "mapa", titulo: "Onde estamos", altura: 240 }] },
    loja: { nome: "Loja", desc: "Compra no WhatsApp, loja online, endereço", tema: { tema: "rosa", estilo: "vidro" },
      itens: d => [ig(d), { tipo: "tiktok", titulo: "TikTok", modo: "icone" }, zap(d, "Comprar pelo WhatsApp", "brilho"), { tipo: "link", titulo: "Loja online" },
        { tipo: "galeria", titulo: "Novidades", fotos: [] }, { tipo: "horario", titulo: "Horário", dias: semana("09:00", "19:00", ["09:00", "14:00"]) },
        { tipo: "localizacao", titulo: "Como chegar" }, { tipo: "avaliacao", titulo: "Avalie no Google", coresGoogle: true }, { tipo: "pix", titulo: "", tipoChave: "auto" }] },
    advogado: { nome: "Advogado", desc: "Agendamento, contato, escritório", tema: { tema: "dourado", estilo: "vidro", fonte: "playfair" },
      itens: d => [zap(d, "Agende uma consulta", "brilho"), { tipo: "contato", titulo: "Salvar contato", nome: d.nome || "", telefone: d.whatsapp || "", email: d.email || "" },
        { tipo: "email", titulo: "Enviar e-mail", email: d.email || "" }, { tipo: "link", titulo: "Site do escritório" }, ig(d), { tipo: "titulo", titulo: "Áreas de atuação" },
        { tipo: "texto", texto: "Direito Civil · Trabalhista · Família · Empresarial" }, { tipo: "horario", titulo: "Atendimento", dias: semana("09:00", "18:00") },
        { tipo: "localizacao", titulo: "Endereço do escritório" }, { tipo: "avaliacao", titulo: "Avalie no Google", coresGoogle: true }] },
    clinica: { nome: "Clínica", desc: "Agendar consulta, ligar, mapa, formulário", tema: { tema: "menta", estilo: "vidro" },
      itens: d => [ig(d), zap(d, "Agendar consulta", "pulsar"), { tipo: "telefone", titulo: "Ligar para a clínica", numero: d.whatsapp || "" },
        { tipo: "formulario", titulo: "Quero ser atendido", descricao: "Deixe seu contato que retornamos.", pedeMensagem: true },
        { tipo: "horario", titulo: "Horário de atendimento", dias: semana("08:00", "18:00", ["08:00", "12:00"]) }, { tipo: "mapa", titulo: "Como chegar", altura: 240 },
        { tipo: "avaliacao", titulo: "Avalie no Google", coresGoogle: true }] },
    empresa: { nome: "Empresa", desc: "Redes, site, contato, apresentação", tema: { tema: "azul", estilo: "vidro" },
      itens: d => [ig(d), { tipo: "facebook", titulo: "Facebook", modo: "icone" }, { tipo: "youtube", titulo: "YouTube", modo: "icone" }, { tipo: "link", titulo: "Site", modo: "icone" },
        { tipo: "avaliacao", titulo: "Avalie no Google", coresGoogle: true }, zap(d, "Fale conosco"), { tipo: "contato", titulo: "Salvar contato", nome: d.nome || "", telefone: d.whatsapp || "", email: d.email || "" },
        { tipo: "pdf", titulo: "Apresentação da empresa" }, { tipo: "link", titulo: "Trabalhe conosco" }, { tipo: "wifi", titulo: "Wi-Fi", seguranca: "WPA" }] },
    pessoal: { nome: "Instagram pessoal", desc: "Redes, vídeo, parcerias", tema: { tema: "roxo", estilo: "cristal" },
      itens: d => [ig(d), { tipo: "tiktok", titulo: "TikTok", modo: "icone" }, { tipo: "youtube", titulo: "YouTube", modo: "icone" }, { tipo: "video", titulo: "Meu último vídeo" },
        { tipo: "link", titulo: "Meu link favorito", destaque: "brilho" }, zap(d, "Parcerias e publis"), { tipo: "email", titulo: "Contato comercial", email: d.email || "" }] },
  };
});

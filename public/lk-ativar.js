/* Tela /ativar: digitar o código ou ler o QR com a câmera (onde o navegador permite) */
(() => {
  const vai = t => { t = String(t || "").trim(); const m = t.match(/\/q\/([A-Za-z0-9-]{3,32})/); const c = m ? m[1] : t.replace(/[^A-Za-z0-9-]/g, ""); if (c.length >= 3) location.href = "/q/" + encodeURIComponent(c); };
  document.getElementById("codf").addEventListener("submit", e => { e.preventDefault(); vai(document.getElementById("codi").value); });
  if (!("BarcodeDetector" in window) || !navigator.mediaDevices?.getUserMedia) return; // iPhone: a câmera do próprio celular já abre o link do QR
  const bt = document.getElementById("camb"); bt.hidden = false;
  bt.addEventListener("click", async () => {
    let det; try { det = new BarcodeDetector({ formats: ["qr_code"] }); } catch (e) { bt.textContent = "Seu navegador não lê QR aqui. Use a câmera do celular."; return; }
    const box = document.getElementById("cam"), v = document.getElementById("camv");
    try { v.srcObject = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }); } catch (e) { bt.textContent = "Não deu para abrir a câmera"; return; }
    box.hidden = false; bt.hidden = true; await v.play();
    const lê = async () => { try { const r = await det.detect(v); if (r[0]) { v.srcObject.getTracks().forEach(t => t.stop()); return vai(r[0].rawValue); } } catch (e) {} requestAnimationFrame(lê); };
    lê();
  });
})();

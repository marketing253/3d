// Impressora 3D em cena 3D (three.js) para o topo do catálogo: uma impressora de mesa (modelo próprio, sem marca)
// imprimindo a logo 8ON camada por camada. A mesa anda no eixo Y e o cabeçote no X, como numa impressora real.
// Sem WebGL, marca <body class="sem3d"> e o catálogo mostra as fotos dos produtos no lugar.
import * as THREE from "/vendor/three.module.min.js";

const caixa = document.getElementById("impr3d");
try { if (caixa) monta(caixa); } catch (e) { console.error("impressora 3D", e); falha(); }

function falha() {
  document.body.classList.add("sem3d");
  const v = document.getElementById("vitrine");
  if (caixa) caixa.remove();
  if (v && v.hidden) document.querySelector(".hero .wrap").style.gridTemplateColumns = "1fr";
}

function monta(el) {
  const teste = document.createElement("canvas");
  if (!(teste.getContext("webgl2") || teste.getContext("webgl"))) throw new Error("sem WebGL");
  const quieto = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.35;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  el.appendChild(renderer.domElement);

  const cena = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);

  // luz de estúdio: ambiente suave, luz principal com sombra e contraluz verde da marca
  cena.add(new THREE.HemisphereLight(0xeaf6f1, 0x1a2228, 2.4));
  const sol = new THREE.DirectionalLight(0xffffff, 4.2);
  sol.position.set(4, 8, 6); sol.castShadow = true;
  sol.shadow.mapSize.set(1024, 1024); sol.shadow.camera.left = -4; sol.shadow.camera.right = 4; sol.shadow.camera.top = 5; sol.shadow.camera.bottom = -3; sol.shadow.bias = -0.0008;
  cena.add(sol);
  const contra = new THREE.DirectionalLight(0x1fbe8c, 3.2); contra.position.set(-5, 4, -6); cena.add(contra);
  const preenchimento = new THREE.DirectionalLight(0xcfe8ff, 1.4); preenchimento.position.set(-6, 2, 4); cena.add(preenchimento);

  const chao = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.ShadowMaterial({ opacity: 0.35 }));
  chao.rotation.x = -Math.PI / 2; chao.receiveShadow = true; cena.add(chao);

  const mat = {
    corpo: new THREE.MeshStandardMaterial({ color: 0x2a333c, roughness: 0.5, metalness: 0.3 }),
    aluminio: new THREE.MeshStandardMaterial({ color: 0x8a96a1, roughness: 0.32, metalness: 0.85 }),
    escuro: new THREE.MeshStandardMaterial({ color: 0x0e1114, roughness: 0.7, metalness: 0.1 }),
    mesa: new THREE.MeshStandardMaterial({ color: 0xc9a55a, roughness: 0.38, metalness: 0.6 }),
    branco: new THREE.MeshStandardMaterial({ color: 0xeef1f4, roughness: 0.35, metalness: 0.05 }),
    latao: new THREE.MeshStandardMaterial({ color: 0xd4a84c, roughness: 0.25, metalness: 1 }),
    tela: new THREE.MeshStandardMaterial({ color: 0x0b2a22, emissive: 0x1fbe8c, emissiveIntensity: 0.9, roughness: 0.4 }),
    filamento: new THREE.MeshStandardMaterial({ color: 0x1fbe8c, roughness: 0.45, metalness: 0.05 }),
  };
  const bloco = (w, h, d, m, x, y, z, pai) => {
    const g = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    g.position.set(x, y, z); g.castShadow = true; g.receiveShadow = true; (pai || cena).add(g); return g;
  };

  // base com tela e trilhos do eixo Y
  bloco(4.4, 0.5, 3.8, mat.corpo, 0, 0.25, 0);
  bloco(4.3, 0.04, 3.7, mat.escuro, 0, 0.52, 0);
  bloco(0.9, 0.22, 0.02, mat.tela, -1.2, 0.27, 1.905);
  for (const x of [-0.7, 0.7]) bloco(0.08, 0.08, 3.4, mat.aluminio, x, 0.58, 0);

  // mesa (anda para frente e para trás)
  const mesa = new THREE.Group(); mesa.position.y = 0.66; cena.add(mesa);
  bloco(2.1, 0.1, 2.1, mat.escuro, 0, 0, 0, mesa);
  bloco(2.9, 0.06, 2.9, mat.mesa, 0, 0.08, 0, mesa);
  const TOPO_MESA = 0.11;

  // coluna do eixo Z à esquerda e braço do eixo X
  bloco(0.42, 3.9, 0.42, mat.corpo, -2.05, 2.45, -0.2);
  bloco(0.06, 3.7, 0.06, mat.aluminio, -1.82, 2.45, -0.2);
  const braco = new THREE.Group(); cena.add(braco);
  bloco(0.62, 0.62, 0.62, mat.corpo, -2.05, 0, -0.2, braco);
  bloco(3.7, 0.2, 0.26, mat.aluminio, 0.0, 0.12, -0.2, braco);

  // cabeçote (anda no braço); a origem do grupo é a ponta do bico
  const cab = new THREE.Group(); braco.add(cab);
  bloco(0.62, 0.78, 0.56, mat.branco, 0, 0.62, 0.02, cab);
  bloco(0.5, 0.16, 0.02, mat.escuro, 0, 0.82, 0.31, cab);
  const ventoinha = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.03, 24), mat.escuro);
  ventoinha.rotation.x = Math.PI / 2; ventoinha.position.set(0, 0.5, 0.31); cab.add(ventoinha);
  const pas = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.04, 0.01), mat.aluminio); pas.position.set(0, 0.5, 0.33); cab.add(pas);
  const bico = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.2, 18), mat.latao); bico.rotation.x = Math.PI; bico.position.y = 0.12; bico.castShadow = true; cab.add(bico);
  const brilho = new THREE.PointLight(0xff8a2a, 0.8, 1.2); brilho.position.y = 0.05; cab.add(brilho);

  // carretel de filamento em cima da coluna
  const carretel = new THREE.Group(); carretel.position.set(-2.05, 4.75, -0.2); cena.add(carretel);
  for (const z of [-0.2, 0.2]) { const f = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.05, 40), mat.escuro); f.rotation.x = Math.PI / 2; f.position.z = z; f.castShadow = true; carretel.add(f); }
  const rolo = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.52, 0.36, 40), mat.filamento); rolo.rotation.x = Math.PI / 2; carretel.add(rolo);
  const eixo = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.5, 16), mat.aluminio); eixo.rotation.x = Math.PI / 2; carretel.add(eixo);

  // a peça: a logo 8ON deitada na mesa, subindo camada por camada ("8" verde, "ON" branco e o ponto verde)
  const CAMADAS = 30, ALT = 0.017;
  const anel = (cx, cy, rx, ry, ex, ey) => {
    const s = new THREE.Shape(); s.absellipse(cx, cy, rx, ry, 0, Math.PI * 2, false);
    const h = new THREE.Path(); h.absellipse(cx, cy, ex, ey, 0, Math.PI * 2, true); s.holes.push(h); return s;
  };
  const poli = pts => { const s = new THREE.Shape(); pts.forEach(([x, y], i) => i ? s.lineTo(x, y) : s.moveTo(x, y)); s.closePath(); return s; };
  const formaOito = [anel(-0.95, 0.27, 0.27, 0.26, 0.13, 0.12), anel(-0.95, -0.25, 0.31, 0.29, 0.16, 0.14)];
  const formaON = [
    anel(0.05, -0.05, 0.42, 0.48, 0.3, 0.36),
    poli([[0.6, -0.53], [0.72, -0.53], [0.72, 0.43], [0.6, 0.43]]),
    poli([[1.13, -0.53], [1.25, -0.53], [1.25, 0.43], [1.13, 0.43]]),
    poli([[0.6, 0.43], [0.74, 0.43], [1.25, -0.53], [1.11, -0.53]]),
  ];
  const formaPonto = [(() => { const s = new THREE.Shape(); s.absarc(1.4, 0.45, 0.075, 0, Math.PI * 2, false); return s; })()];
  const geo = formas => { const g = new THREE.ExtrudeGeometry(formas, { depth: ALT, bevelEnabled: false, curveSegments: 28 }); g.rotateX(-Math.PI / 2); return g; };
  const gOito = geo(formaOito), gON = geo(formaON), gPonto = geo(formaPonto);
  const verdeA = new THREE.MeshStandardMaterial({ color: 0x1fbe8c, roughness: 0.48, metalness: 0.02, transparent: true });
  const verdeB = new THREE.MeshStandardMaterial({ color: 0x17a679, roughness: 0.52, metalness: 0.02, transparent: true });
  const brancoA = new THREE.MeshStandardMaterial({ color: 0xf2f5f7, roughness: 0.45, metalness: 0.02, transparent: true });
  const brancoB = new THREE.MeshStandardMaterial({ color: 0xd9dfe4, roughness: 0.5, metalness: 0.02, transparent: true });
  const mats = [verdeA, verdeB, brancoA, brancoB];
  const peca = new THREE.Group(); peca.position.set(-0.12, TOPO_MESA, 0.05); mesa.add(peca);
  const camadas = [];
  for (let i = 0; i < CAMADAS; i++) {
    const g = new THREE.Group(); g.position.y = i * ALT; g.visible = false;
    for (const [geom, m] of [[gOito, i % 2 ? verdeB : verdeA], [gON, i % 2 ? brancoB : brancoA], [gPonto, i % 2 ? verdeB : verdeA]]) {
      const mesh = new THREE.Mesh(geom, m); mesh.castShadow = true; mesh.receiveShadow = true; g.add(mesh);
    }
    peca.add(g); camadas.push(g);
  }

  // ciclo lento: imprime 60 s (2 s por camada), mostra a logo pronta, some e recomeça
  const IMPRIME = 60, MOSTRA = 5, SOME = 1.2, CICLO = IMPRIME + MOSTRA + SOME;
  const BRACO_Y = 0.66 + TOPO_MESA; // altura do bico rente à mesa
  const PARADO_X = 1.35;
  function posa(t) {
    const tc = t % CICLO;
    const imprimindo = tc < IMPRIME;
    const prog = imprimindo ? (tc / IMPRIME) * CAMADAS : CAMADAS, feitas = Math.floor(prog), f = prog - feitas;
    camadas.forEach((m, i) => { m.visible = i < feitas; });
    const opac = tc > IMPRIME + MOSTRA ? 1 - (tc - IMPRIME - MOSTRA) / SOME : 1;
    mats.forEach(m => { m.opacity = opac; });
    const alturaBico = BRACO_Y + Math.min(feitas + 1, CAMADAS) * ALT;
    if (imprimindo) {
      // preenchimento em zigue-zague: o cabeçote varre a logo da esquerda para a direita e a mesa vai e vem
      const suave = x => x * x * (3 - 2 * x); // acelera e freia como o motor de passo
      const ida = feitas % 2 === 0 ? f : 1 - f;
      cab.position.x = -1.2 + 2.7 * suave(ida);
      mesa.position.z = 0.05 + 0.4 * Math.sin(f * Math.PI * 6);
      brilho.intensity = 0.8 + Math.sin(t * 6) * 0.15;
    } else {
      cab.position.x += (PARADO_X - cab.position.x) * 0.02;
      mesa.position.z += (0.9 - mesa.position.z) * 0.02;
      brilho.intensity = 0;
    }
    braco.position.y = imprimindo ? alturaBico : braco.position.y + (BRACO_Y + CAMADAS * ALT + 0.5 - braco.position.y) * 0.04;
    if (imprimindo) carretel.rotation.z -= 0.0015;
    pas.rotation.z += 0.25;
    // câmera em 3/4, de cima, balançando bem devagar
    const a = -0.42 + Math.sin(t * 0.1) * 0.18;
    camera.position.set(Math.sin(a) * 11, 6.2 + Math.sin(t * 0.08) * 0.25, Math.cos(a) * 11);
    camera.lookAt(-0.3, 1.85, 0);
  }

  function ajusta() {
    const w = el.clientWidth || 300, h = el.clientHeight || w;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  new ResizeObserver(() => { ajusta(); if (quieto) desenha(IMPRIME + 1); }).observe(el);
  ajusta();

  const desenha = t => { posa(t); renderer.render(cena, camera); };
  if (quieto) { desenha(IMPRIME + 1); return; } // sem animação: mostra a peça pronta

  // só anima quando aparece na tela e a aba está visível
  let visivel = true, t0 = performance.now(), pausado = 0, ultimo = t0;
  new IntersectionObserver(es => { visivel = es[0].isIntersecting; }).observe(el);
  function quadro(agora) {
    requestAnimationFrame(quadro);
    if (!visivel || document.hidden) { pausado += agora - ultimo; ultimo = agora; return; }
    ultimo = agora;
    desenha((agora - t0 - pausado) / 1000);
  }
  requestAnimationFrame(quadro);
  el.classList.add("pronta");
}

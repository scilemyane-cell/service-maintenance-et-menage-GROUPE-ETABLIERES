// plan-3d.js — « 🧊 Vue 3D » du plan des clés : les étages d'un bâtiment empilés en
// maquette holographique (sous-sol → R+2), qu'on fait tourner à la souris / au doigt.
// Les repères de clés deviennent des épingles debout ; le filtre par clé les allume
// sur tous les étages à la fois. Rendu WebGL (three.js) : textures nettes même en perspective.
import { esc } from "./astreinte-logic.js";

const sa = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const COULEURS = { rouge: "#ff4d5e", bleu: "#4da3ff", vert: "#3ddc84", orange: "#ffb020" };
const triCode = (a, b) => String(a).localeCompare(String(b), "fr", { numeric: true });

export const NIVEAUX = [[-2, "Sous-sol -2"], [-1, "Sous-sol"], [0, "RDC"], [1, "R+1"], [2, "R+2"], [3, "R+3"], [4, "R+4"], [5, "R+5"]];
export function niveauDe(titre) {
  const s = sa(titre);
  if (/sous.?sol/.test(s)) return -1;
  if (/\brdc\b|rez.de.chaussee/.test(s)) return 0;
  const m = s.match(/r\s*\+\s*(\d)/); return m ? +m[1] : null;
}
const prefixe = (titre) => sa(titre).replace(/sous.?sol|\brdc\b|rez.de.chaussee|r\s*\+\s*\d/g, " ").replace(/^plan\s+/, "").replace(/[-–\s]+/g, " ").trim();
const nomNiveau = (n) => n < -1 ? `Sous-sol ${n}` : n < 0 ? "Sous-sol" : n === 0 ? "RDC" : `R+${n}`;
// Groupes d'étages d'un même bâtiment (au moins 2 niveaux), le plus complet d'abord.
export function groupesEtages(pages) {
  const res = groupesEtagesBrut(pages); if (res.length || !pages?.length) return res;
  // Aucun niveau reconnu (titres sans « rdc », « r+1 »…) : chaque page devient un niveau, dans l'ordre du PDF (réglable en mode édition).
  return [{ cle: "plan", nom: "Plan", etages: pages.filter(p => p.niveauManuel !== "x").map((p, i) => ({ ...p, niv: i })) }].filter(g => g.etages.length);
}
function groupesEtagesBrut(pages) {
  const g = {};
  // Réglage manuel de la page (mode édition) prioritaire : niveauManuel ("" = auto, "x" = pas un étage) et batiment.
  pages.forEach(p => { const nm = p.niveauManuel; const n = nm === "x" ? null : nm !== undefined && nm !== "" ? +nm : niveauDe(p.titre); if (n === null || Number.isNaN(n)) return;
    const k = p.batiment ? "bat:" + sa(p.batiment) : (prefixe(p.titre) || "ensemble"); (g[k] = g[k] || []).push({ ...p, niv: n }); });
  const joli = (k, l) => { if (k.startsWith("bat:")) return l[0].batiment; if (/^ensemble$/.test(k)) return "Ensemble du site";
    const t = String(l[0].titre || "").replace(/sous.?sol|\brdc\b|rez.de.chauss[ée]e|r\s*\+\s*\d/gi, " ").replace(/^plan\s+/i, "").replace(/\s*[-–]\s*(?=\s|$)/g, " ").replace(/\s+/g, " ").trim();
    return (t || k).replace(/^./, c => c.toUpperCase()).replace(/^Batiment/, "Bâtiment"); };
  return Object.entries(g).map(([k, l]) => ({ cle: k, nom: joli(k, l), etages: l.sort((a, b) => a.niv - b.niv) }))
    .filter(x => x.etages.length >= 1).sort((a, b) => (b.cle === "ensemble") - (a.cle === "ensemble") || b.etages.length - a.etages.length || a.nom.localeCompare(b.nom));
}

// Image → zone utile (sans cartouche) + version « hologramme » (traits lumineux, fond transparent).
const chargerImg = (src) => new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = src; });
function zoneUtile(img) {
  const w = 420, h = Math.round(img.height * w / img.width), c = document.createElement("canvas"); c.width = w; c.height = h;
  const x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(img, 0, 0, w, h); const d = x.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let y = 0; y < h; y++) for (let i = 0; i < w; i++) {
    const fx = i / w, fy = y / h;
    if (fy < 0.09 || fy > 0.86 || (fx < 0.3 && fy > 0.7) || (fx > 0.75 && fy < 0.16) || fx < 0.02 || fx > 0.98) continue;
    const k = (y * w + i) * 4; if (d[k] + d[k + 1] + d[k + 2] < 600) { if (i < x0) x0 = i; if (i > x1) x1 = i; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 <= x0 || y1 <= y0) return { x: 0, y: 0, w: 1, h: 1 };
  const m = 0.012; return { x: Math.max(0, x0 / w - m), y: Math.max(0, y0 / h - m), w: Math.min(1, (x1 - x0) / w + 2 * m), h: Math.min(1, (y1 - y0) / h + 2 * m) };
}
// Texture d'un étage : « clair » (traits foncés, fond blanc) ou « holo » (traits lumineux, fond transparent).
// Les traits sont épaissis d'un pixel pour rester lisibles en perspective.
function texture(img, z, style, maxW = 2600, dejaRogne = false) {
  const sx = dejaRogne ? 0 : z.x * img.width, sy = dejaRogne ? 0 : z.y * img.height, sw = dejaRogne ? img.width : z.w * img.width, sh = dejaRogne ? img.height : z.h * img.height;
  const W = Math.min(maxW, Math.round(sw)), H = Math.round(sh * W / sw);
  const c = document.createElement("canvas"); c.width = W; c.height = H; const x = c.getContext("2d", { willReadFrequently: true });
  x.drawImage(img, sx, sy, sw, sh, 0, 0, W, H);
  const id = x.getImageData(0, 0, W, H), d = id.data, a0 = new Uint8ClampedArray(W * H);
  for (let p = 0, k = 0; p < W * H; p++, k += 4) {
    const px = p % W, py = (p / W) | 0, fx = z.x + px / W * z.w, fy = z.y + py / H * z.h;
    if ((fx < 0.3 && fy > 0.7) || (fx > 0.75 && fy < 0.16) || fy > 0.86) continue;
    const l = d[k] * 0.3 + d[k + 1] * 0.59 + d[k + 2] * 0.11; a0[p] = Math.max(0, Math.min(255, (240 - l) * 1.9));
  }
  const [R, G, B] = style === "holo" ? [95, 200, 240] : [12, 38, 66];
  for (let y = 0; y < H; y++) for (let xx = 0; xx < W; xx++) {
    const p = y * W + xx; let a = a0[p];
    if (xx > 0 && a0[p - 1] > a) a = a0[p - 1]; if (xx < W - 1 && a0[p + 1] > a) a = a0[p + 1];
    if (y > 0 && a0[p - W] > a) a = a0[p - W]; if (y < H - 1 && a0[p + W] > a) a = a0[p + W];
    const k = p * 4; d[k] = R; d[k + 1] = G; d[k + 2] = B; d[k + 3] = a;
  }
  x.putImageData(id, 0, 0); return c;
}

export const THREE_URL = "https://cdn.jsdelivr.net/npm/three@0.160.0/+esm";
export const ORBIT_URL = "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/OrbitControls.js/+esm";

// Étiquette texte (sprite toujours tourné vers la caméra).
function etiquette(THREE, texte, couleur, taille = 1) {
  const c = document.createElement("canvas"), x = c.getContext("2d"), fs = 64;
  x.font = `800 ${fs}px system-ui,sans-serif`; const w = Math.ceil(x.measureText(texte).width) + 36;
  c.width = w; c.height = fs + 28; x.font = `800 ${fs}px system-ui,sans-serif`;
  x.fillStyle = "rgba(6,14,24,.92)"; x.strokeStyle = couleur; x.lineWidth = 6;
  const r = 14; x.beginPath(); x.roundRect(3, 3, w - 6, c.height - 6, r); x.fill(); x.stroke();
  x.fillStyle = "#fff"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(texte, w / 2, c.height / 2 + 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
  const h = 2.2 * taille; sp.scale.set(h * w / c.height, h, 1); sp.renderOrder = 20; return sp;
}
// Nom de pièce : texte net (dessiné en vectoriel), toujours face à la caméra.
function nomPiece(THREE, texte) {
  const c = document.createElement("canvas"), x = c.getContext("2d"), fs = 40, mots = texte.split(" "), lignes = [];
  x.font = `700 ${fs}px system-ui,sans-serif`;
  mots.forEach(m => { const l = lignes[lignes.length - 1]; if (l && x.measureText(l + " " + m).width < 340) lignes[lignes.length - 1] = l + " " + m; else lignes.push(m); });
  const w = Math.ceil(Math.max(...lignes.map(l => x.measureText(l).width))) + 20, h = lignes.length * (fs + 6) + 12;
  c.width = w; c.height = h; x.font = `700 ${fs}px system-ui,sans-serif`; x.textAlign = "center"; x.textBaseline = "top";
  x.fillStyle = "rgba(4,12,22,.72)"; x.beginPath(); x.roundRect(0, 0, w, h, 10); x.fill();
  x.fillStyle = "#eafaff"; lignes.forEach((l, i) => x.fillText(l, w / 2, 8 + i * (fs + 6)));
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  // Taille fixe à l'écran (ne grossit pas en s'approchant).
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false, sizeAttenuation: false })); const k = matchMedia("(max-width:700px)").matches ? 0.00024 : 0.00042; sp.scale.set(k * w, k * h, 1); sp.renderOrder = 12; return sp;
}
function texteNiveau(THREE, texte) {
  const c = document.createElement("canvas"), x = c.getContext("2d"); c.width = 640; c.height = 160;
  x.font = "800 120px system-ui,sans-serif"; x.fillStyle = "rgba(170,235,255,.95)"; x.shadowColor = "rgba(80,200,255,.9)"; x.shadowBlur = 24; x.textBaseline = "middle"; x.fillText(texte, 10, 84);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false })); sp.scale.set(20, 5, 1); sp.renderOrder = 15; return sp;
}

// ---------- Maquette : pièces détectées automatiquement (zones fermées du plan) ----------
function dilater(m, W, H, r) {
  const t = new Uint8Array(W * H), o = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) { let c = 0; const b = y * W;
    for (let x = -r; x < W; x++) { if (x + r < W) c += m[b + x + r]; if (x - r - 1 >= 0) c -= m[b + x - r - 1]; if (x >= 0) t[b + x] = c > 0 ? 1 : 0; } }
  for (let x = 0; x < W; x++) { let c = 0;
    for (let y = -r; y < H; y++) { if (y + r < H) c += t[(y + r) * W + x]; if (y - r - 1 >= 0) c -= t[(y - r - 1) * W + x]; if (y >= 0) o[y * W + x] = c > 0 ? 1 : 0; } }
  return o;
}
function composantes(m, W, H, valeur) { // étiquettes 4-connexes des pixels m == valeur
  const lab = new Int32Array(W * H), q = new Int32Array(W * H), info = [null]; let nb = 0;
  for (let s = 0; s < W * H; s++) {
    if (m[s] !== valeur || lab[s]) continue;
    nb++; let h = 0, t = 0, n = 0, bord = false, x0 = W, x1 = 0, y0 = H, y1 = 0; q[t++] = s; lab[s] = nb;
    while (h < t) { const p = q[h++], x = p % W, y = (p / W) | 0; n++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) bord = true;
      if (x > 0 && m[p - 1] === valeur && !lab[p - 1]) { lab[p - 1] = nb; q[t++] = p - 1; }
      if (x < W - 1 && m[p + 1] === valeur && !lab[p + 1]) { lab[p + 1] = nb; q[t++] = p + 1; }
      if (y > 0 && m[p - W] === valeur && !lab[p - W]) { lab[p - W] = nb; q[t++] = p - W; }
      if (y < H - 1 && m[p + W] === valeur && !lab[p + W]) { lab[p + W] = nb; q[t++] = p + W; } }
    info.push({ n, bord, x0, x1, y0, y1 });
  }
  return { lab, info, nb };
}
function analyserPieces(cv) {
  const W = cv.width, H = cv.height, d = cv.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, W, H).data;
  const noir = new Uint8Array(W * H); for (let p = 0, k = 0; p < W * H; p++, k += 4) noir[p] = (d[k] * 0.3 + d[k + 1] * 0.59 + d[k + 2] * 0.11) < 170 ? 1 : 0;
  const r = Math.max(2, Math.round(W / 650)), dil = dilater(noir, W, H, r);
  const vide = composantes(dil, W, H, 0), ok = vide.info.map((c, i) => i && c && !c.bord && c.n > W * H * 0.00005 && c.n < W * H * 0.2);
  const lab = new Int32Array(W * H); for (let p = 0; p < W * H; p++) if (ok[vide.lab[p]]) lab[p] = vide.lab[p];
  // Murs = traits épaissis qui bordent une pièce ; îlots isolés (textes, meubles) retirés.
  const piece = new Uint8Array(W * H); for (let p = 0; p < W * H; p++) piece[p] = lab[p] ? 1 : 0;
  const pres = dilater(piece, W, H, r + 2), murs = new Uint8Array(W * H);
  const fin = dilater(noir, W, H, 1); for (let p = 0; p < W * H; p++) murs[p] = fin[p] && pres[p] ? 1 : 0;
  const cm = composantes(murs, W, H, 1);
  for (let p = 0; p < W * H; p++) if (murs[p]) { const c = cm.info[cm.lab[p]]; if (Math.max(c.x1 - c.x0, c.y1 - c.y0) < W * 0.025) murs[p] = 0; }
  // Les îlots retirés rejoignent la pièce qui les entoure.
  for (let it = 0; it < 2 * r + 3; it++) { let chg = 0;
    for (let p = W; p < W * H - W; p++) if (!lab[p] && !murs[p] && pres[p]) { const v = lab[p - 1] || lab[p + 1] || lab[p - W] || lab[p + W]; if (v) { lab[p] = v; chg++; } }
    if (!chg) break; }
  return { W, H, lab, murs };
}
const CAT_PIECE = [[/sanit|wc|douche/i, [94, 196, 196]], [/circul|couloir|coursive|degt|d[ée]gag|hall|sas|escal|cage|asc/i, [168, 178, 190]], [/^ch\b|chambre/i, [170, 140, 220]],
  [/salle de cours|sec|td|tp|informatique|cdi|amphi/i, [112, 160, 235]], [/labo|pr[ée]pa/i, [110, 200, 140]], [/bureau|accueil|direct|secr|vie scol|r[ée]union|infirm/i, [236, 186, 100]],
  [/local|rangt|r[ée]serve|archive|stock|tech|entretien|office/i, [190, 160, 130]]];
const PASTELS = [[150, 190, 225], [170, 210, 190], [215, 195, 160], [195, 175, 215], [225, 180, 180], [175, 205, 215]];
const couleurPiece = (nom, id = 0) => (CAT_PIECE.find(([rx]) => rx.test(nom || "")) || [0, PASTELS[id % PASTELS.length]])[1];
function geometrieMurs(THREE, murs, W, H, L, P, h, couleurs = null, pas = 0) {
  const c = pas || Math.max(1, Math.round(W / 1000)), GW = Math.ceil(W / c), GH = Math.ceil(H / c), g = new Uint8Array(GW * GH);
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) { let n = 0, t = 0; for (let yy = y * c; yy < Math.min(H, y * c + c); yy++) for (let xx = x * c; xx < Math.min(W, x * c + c); xx++) { t++; n += murs[yy * W + xx]; } g[y * GW + x] = n * 2 >= t ? 1 : 0; }
  const boites = [], ouverts = new Map();
  for (let y = 0; y <= GH; y++) {
    const runs = []; if (y < GH) { let x = 0; while (x < GW) { if (g[y * GW + x]) { const x0 = x; while (x < GW && g[y * GW + x]) x++; runs.push(x0 + "," + x); } else x++; } }
    const suiv = new Map();
    runs.forEach(k => { if (ouverts.has(k)) { suiv.set(k, ouverts.get(k)); ouverts.delete(k); } else suiv.set(k, y); });
    ouverts.forEach((y0, k) => { const [a, b] = k.split(",").map(Number); boites.push([a, y0, b, y]); });
    ouverts.clear(); suiv.forEach((v, k) => ouverts.set(k, v));
  }
  const pos = [], nor = [], col = [], X = (gx) => (gx * c / W - 0.5) * L, Z = (gy) => (gy * c / H - 0.5) * P;
  const face = (pts, n, cc) => { [0, 1, 2, 0, 2, 3].forEach(i => { pos.push(...pts[i]); nor.push(...n); col.push(...cc); }); };
  const [cote, dessus] = couleurs || [[0.86, 0.9, 0.95], [0.97, 0.98, 1]];
  boites.forEach(([a, b, e, f]) => { const x0 = X(a), x1 = X(e), z0 = Z(b), z1 = Z(f);
    face([[x0, h, z0], [x0, h, z1], [x1, h, z1], [x1, h, z0]], [0, 1, 0], dessus);
    face([[x0, 0, z1], [x1, 0, z1], [x1, h, z1], [x0, h, z1]], [0, 0, 1], cote);
    face([[x1, 0, z0], [x0, 0, z0], [x0, h, z0], [x1, h, z0]], [0, 0, -1], cote);
    face([[x1, 0, z1], [x1, 0, z0], [x1, h, z0], [x1, h, z1]], [1, 0, 0], cote);
    face([[x0, 0, z0], [x0, 0, z1], [x0, h, z1], [x0, h, z0]], [-1, 0, 0], cote); });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3)); geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  return geo;
}

export async function ouvrirVue3D({ titre, groupes, reperes, filtre = "", charger, onPlat, hd = null, aPdf = false, ajouterPdf = null, textes = null }) {
  if (!document.getElementById("p3-style")) document.head.insertAdjacentHTML("beforeend", STYLE);
  const PALETTE = ["#ff4d5e", "#4da3ff", "#3ddc84", "#ffb020", "#c77dff", "#ff7ac6", "#2ee6d6", "#ffe14d", "#ff8a3d", "#9be15d", "#7aa2ff", "#ff5c8a", "#5ce1ff", "#d4a373", "#b8f2e6", "#f4a261"];
  // Types de repères : clé (par défaut), compteur, tableau électrique.
  const typeR = (r) => r.t || "cle", COUL_T = { compteur: "#06b6d4", tableau: "#f59e0b" };
  const codes = [...new Set(reperes.filter(r => typeR(r) === "cle").map(r => r.c))].sort(triCode);
  const couleurCle = (c) => codes.includes(c) ? PALETTE[codes.indexOf(c) % PALETTE.length] : "#94a3b8";
  const couleurR = (r) => COUL_T[typeR(r)] || couleurCle(r.c);
  const libR = (r) => typeR(r) === "tableau" ? `⚡ ${r.c}` : typeR(r) === "compteur" ? `🎛 ${r.c}` : r.c;
  const vise = (r) => !st.filtre ? false : st.filtre === "__tab" ? typeR(r) === "tableau" : st.filtre === "__cpt" ? typeR(r) === "compteur" : typeR(r) === "cle" && r.c === st.filtre;
  const st = { g: 0, ecart: 22, filtre, auto: true };
  const fond = document.createElement("div"); fond.className = "p3";
  fond.innerHTML = `<div class="p3-ciel"></div>
    <header class="p3-h"><b>🧊 ${esc(titre)}</b><span class="p3-sous">${matchMedia("(pointer:coarse)").matches ? "1 doigt : déplacer · 2 doigts : zoomer et tourner · double-tap : zoomer ici" : "Glisse pour tourner · molette pour zoomer · clic droit pour déplacer · double-clic : zoomer ici"}</span>
      <div class="p3-hb"><select data-g>${groupes.map((g, i) => `<option value="${i}">${esc(g.nom)} (${g.etages.length} niveaux)</option>`).join("")}</select>
      <button data-dessus>⬆ Vue de dessus</button><button data-face>↺ Vue 3D</button><button data-maq>🏠 Maquette</button><button data-auto>⏸ Rotation</button><label class="p3-ec">Éclater <input type="range" min="4" max="45" value="${st.ecart}" data-ecart></label>${!aPdf && ajouterPdf ? `<label class="p3-hd">✨ Rendre net + noms des pièces (PDF)<input type="file" accept="application/pdf" hidden data-hd></label>` : ""}<button data-x>✕ Fermer la 3D</button></div></header><div class="p3-etat" hidden></div>
    <aside class="p3-niv"></aside><aside class="p3-leg"></aside>
    <div class="p3-vue"><div class="p3-load">⏳ Construction de la maquette…</div></div>
    <div class="p3-info" hidden></div>`;
  document.body.appendChild(fond);
  const $ = (s) => fond.querySelector(s), vue = $(".p3-vue");
  let vivant = true, raf = 0, renderer = null, ro = null;
  const fermer = () => { vivant = false; cancelAnimationFrame(raf); ro?.disconnect(); try { renderer?.dispose(); renderer?.forceContextLoss(); } catch { /* */ } fond.remove(); document.removeEventListener("keydown", clavier); };
  const clavier = (e) => { if (e.key === "Escape") fermer(); };
  document.addEventListener("keydown", clavier);
  $("[data-x]").onclick = fermer;

  let THREE, OrbitControls;
  try { [THREE, { OrbitControls }] = await Promise.all([import(/* @vite-ignore */ THREE_URL), import(/* @vite-ignore */ ORBIT_URL)]); }
  catch (e) { $(".p3-load").textContent = "La 3D n'a pas pu se charger (connexion ?)."; return; }
  if (!vivant) return;
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); renderer.outputColorSpace = THREE.SRGBColorSpace;
  vue.appendChild(renderer.domElement);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(38, 1, 0.5, 2000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.08; controls.autoRotate = true; controls.autoRotateSpeed = 0.6; controls.maxPolarAngle = Math.PI * 0.49; controls.minDistance = 8; controls.maxDistance = 400;
  // Doigts « comme une carte » : 1 doigt déplace le plan, 2 doigts zooment (pincer) et tournent / inclinent.
  controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
  // Pincement au pavé tactile (ctrl + molette, petites valeurs) : zoom progressif vers le pointeur.
  renderer.domElement.addEventListener("wheel", (e) => { if (!e.ctrlKey) return; e.preventDefault(); e.stopImmediatePropagation();
    const k = Math.exp(Math.max(-60, Math.min(60, e.deltaY)) * 0.012), r = renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), ray0 = new THREE.Raycaster(); ray0.setFromCamera(v, camera);
    const sol = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), pt = new THREE.Vector3(); const vise = ray0.ray.intersectPlane(sol, pt) ? pt : controls.target.clone();
    const off = camera.position.clone().sub(vise).multiplyScalar(k), d = off.length();
    if (d < controls.minDistance || d > controls.maxDistance) return;
    camera.position.copy(vise).add(off); controls.target.sub(vise).multiplyScalar(k).add(vise); arreterAuto(); }, { passive: false, capture: true });

  controls.screenSpacePanning = false; controls.zoomToCursor = true; controls.panSpeed = 1.1; controls.rotateSpeed = 0.55; controls.zoomSpeed = 2.2;
  const aniso = renderer.capabilities.getMaxAnisotropy(), mobile = matchMedia("(max-width:700px), (pointer:coarse)").matches;
  const taille = () => { const r = vue.getBoundingClientRect(); renderer.setSize(r.width, r.height, false); renderer.domElement.style.width = r.width + "px"; renderer.domElement.style.height = r.height + "px"; camera.aspect = r.width / Math.max(1, r.height); camera.updateProjectionMatrix(); };
  ro = new ResizeObserver(taille); ro.observe(vue); taille();

  let etages = [], monde = new THREE.Group(); scene.add(monde);
  let cible = null; // animation de caméra
  const allerCamera = (pos, tgt) => { cible = { pos: new THREE.Vector3(...pos), tgt: new THREE.Vector3(...tgt), t: 0, p0: camera.position.clone(), g0: controls.target.clone() }; };
  const arreterAuto = () => { st.auto = false; controls.autoRotate = false; $("[data-auto]").textContent = "▶ Rotation"; };

  function filtreOptions() {
    const m = {}; const ns = new Set(groupes[st.g].etages.map(e => e.n));
    const ici = reperes.filter(r => ns.has(r.p)), nT = ici.filter(r => typeR(r) === "tableau").length, nC = ici.filter(r => typeR(r) === "compteur").length;
    ici.filter(r => typeR(r) === "cle").forEach(r => { m[r.c] = (m[r.c] || 0) + 1; });
    if (st.filtre && !st.filtre.startsWith("__") && !m[st.filtre]) st.filtre = "";
    const libF = st.filtre === "__tab" ? "tableaux" : st.filtre === "__cpt" ? "compteurs" : st.filtre;
    $(".p3-leg").innerHTML = `<h4 data-plier>🔑 Repères${st.filtre ? ` : ${esc(libF)}` : ""} <small>clique pour isoler</small><i class="p3-pli">▾</i></h4>${nT ? `<button data-cle="__tab" class="${st.filtre === "__tab" ? "on" : st.filtre ? "off" : ""}"><i style="background:${COUL_T.tableau}"></i><b>⚡ Tableaux</b><span>${nT}</span></button>` : ""}${nC ? `<button data-cle="__cpt" class="${st.filtre === "__cpt" ? "on" : st.filtre ? "off" : ""}"><i style="background:${COUL_T.compteur}"></i><b>🎛️ Compteurs</b><span>${nC}</span></button>` : ""}${Object.keys(m).sort(triCode).map(c => `<button data-cle="${esc(c)}" class="${c === st.filtre ? "on" : st.filtre ? "off" : ""}"><i style="background:${couleurCle(c)}"></i><b>${esc(c)}</b><span>${m[c]}</span></button>`).join("")}`;
  }
  function placer() { const n = etages.length; etages.forEach((e, i) => { e.cibleY = st.seul != null ? 0 : (i - (n - 1) / 2) * st.ecart; e.groupe.visible = st.seul == null || st.seul === e.n; });
    fond.querySelectorAll(".p3-niv [data-niv]").forEach(b => b.classList.toggle("on", +b.dataset.niv === st.seul)); fond.querySelector(".p3-niv [data-tous]")?.classList.toggle("on", st.seul == null); }
  // Un seul niveau en 3D (les autres sont masqués), ou tous empilés.
  // Maquette : sols colorés par pièce + vrais murs (bords des pièces) en volume, éclairés.
  const HMUR = 1.3; let lumieres = false;
  async function construireMaquette(et) {
    if (et.maq || !hd || !st.z) return;
    const cv = await hd(et.n, mobile ? 1300 : 1700, st.z); if (!vivant) return;
    const A = analyserPieces(cv), { W, H, lab } = A, L = 100, P = et.P;
    // Nom et clés de chaque pièce.
    const noms = {}, cles = {};
    const proche = (fx, fy, R) => { const px = Math.round(fx * W), py = Math.round(fy * H);
      for (let rr = 0; rr <= R; rr += 2) for (let dy = -rr; dy <= rr; dy += 2) for (const dx of (Math.abs(dy) === rr ? Array.from({ length: rr + 1 }, (_, i) => -rr + 2 * i) : [-rr, rr])) {
        const x = px + dx, y = py + dy; if (x >= 0 && y >= 0 && x < W && y < H && lab[y * W + x]) return lab[y * W + x]; } return 0; };
    et.pieces.forEach(q => { const id = proche(q.fx, q.fy, Math.round(W / 60)); if (id && (!noms[id] || q.t.length > noms[id].length) && !/^b[aâ]timent/i.test(q.t)) noms[id] = q.t; });
    et.points.forEach(p => { const id = proche(p.fx, p.fy, Math.round(W / 80));
      if (id && typeR(p.r) === "cle") (cles[id] = cles[id] || []).push(p.r.c); });
    const sol = document.createElement("canvas"); sol.width = W; sol.height = H;
    const tex = new THREE.CanvasTexture(sol); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = aniso;
    const mSol = new THREE.Mesh(new THREE.PlaneGeometry(L, P), new THREE.MeshLambertMaterial({ map: tex, transparent: true, depthWrite: false })); mSol.receiveShadow = true;
    mSol.rotation.x = -Math.PI / 2; mSol.position.y = 0.01; mSol.renderOrder = 1; mSol.userData.sol = et.n; et.groupe.add(mSol);
    if (!lumieres) { lumieres = true; scene.add(new THREE.HemisphereLight(0xeaf4ff, 0x40454f, 0.85)); const dl = new THREE.DirectionalLight(0xfff6e8, 1.6); dl.position.set(45, 110, 60);
      dl.castShadow = true; dl.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048); Object.assign(dl.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 10, far: 400 }); dl.shadow.bias = -0.0006; dl.shadow.camera.updateProjectionMatrix(); scene.add(dl); }
    const murs = new THREE.Mesh(geometrieMurs(THREE, A.murs, W, H, L, P, HMUR), new THREE.MeshLambertMaterial({ vertexColors: true }));
    murs.renderOrder = 4; murs.castShadow = murs.receiveShadow = true; et.groupe.add(murs);
    // Socle du bâtiment (dalle épaisse) : emprise des pièces + murs.
    const emprise = new Uint8Array(W * H); for (let p = 0; p < W * H; p++) emprise[p] = lab[p] || A.murs[p] ? 1 : 0;
    const socle = new THREE.Mesh(geometrieMurs(THREE, emprise, W, H, L, P, 0.7, [[0.32, 0.36, 0.42], [0.55, 0.58, 0.63]], Math.max(2, Math.round(W / 400))), new THREE.MeshLambertMaterial({ vertexColors: true }));
    socle.position.y = -0.72; socle.receiveShadow = true; et.groupe.add(socle);
    // Une étiquette par pièce nommée, au centre de la pièce.
    const som = {}; for (let p = 0; p < W * H; p += 3) { const id = lab[p]; if (!id || !noms[id]) continue; const t = som[id] || (som[id] = [0, 0, 0]); t[0] += p % W; t[1] += (p / W) | 0; t[2]++; }
    const etiq = Object.entries(som).filter(([, t]) => t[2] > 12).map(([id, t]) => ({ t: noms[id], pos: new THREE.Vector3((t[0] / t[2] / W - 0.5) * L, HMUR + 0.4, (t[1] / t[2] / H - 0.5) * P), sp: null, aire: t[2] }));
    et.maq = { A, noms, cles, sol, tex, mSol, murs, socle, etiq, sel: 0 };
    dessinerSol(et);
  }
  function dessinerSol(et) {
    const m = et.maq; if (!m) return; const { W, H, lab, murs } = m.A, x = m.sol.getContext("2d"), img = x.createImageData(W, H), d = img.data, cache = {};
    const coul = (id) => { if (cache[id]) return cache[id]; const ks = m.cles[id] || [], aCle = st.filtre && ks.includes(st.filtre);
      let c = couleurPiece(m.noms[id], id); if (st.filtre) c = aCle ? [255, 200, 60] : c.map(v => v * 0.35); if (id === m.sel) c = [255, 255, 255];
      return (cache[id] = [c[0], c[1], c[2], st.filtre && !aCle && id !== m.sel ? 170 : 250]); };
    if (!m.ao) m.ao = dilater(murs, W, H, Math.max(2, Math.round(W / 300)));
    for (let p = 0, k = 0; p < W * H; p++, k += 4) { const id = lab[p]; if (!id || murs[p]) continue; const c = coul(id), f = m.ao[p] ? 0.8 : 1; d[k] = c[0] * f; d[k + 1] = c[1] * f; d[k + 2] = c[2] * f; d[k + 3] = c[3]; }
    x.putImageData(img, 0, 0); m.tex.needsUpdate = true;
  }
  async function majMaquette() {
    $("[data-maq]").classList.toggle("on", st.maq);
    etages.forEach(e => { if (e.maq) { e.maq.mSol.visible = e.maq.murs.visible = e.maq.socle.visible = st.maq; } if (e.plan) e.plan.visible = !st.maq; [...e.pieces, ...(e.maq?.etiq || [])].forEach(q => { if (q.sp) q.sp.visible = false; }); });
    if (!st.maq) return;
    if (!hd) { window.toast?.("Fais d'abord « ✨ Rendre net + noms des pièces (PDF) »."); st.maq = false; $("[data-maq]").classList.remove("on"); return; }
    const etat = $(".p3-etat"); etat.hidden = false;
    const liste = etages.filter(e => st.seul == null || e.n === st.seul);
    for (const [i, e] of liste.entries()) { etat.textContent = `🏠 Construction de la maquette… ${i + 1} / ${liste.length}`;
      try { await construireMaquette(e); } catch (err) { console.warn("maquette", err); } if (e.maq) { e.maq.mSol.visible = e.maq.murs.visible = e.maq.socle.visible = st.maq; } if (e.plan) e.plan.visible = !(st.maq && e.maq); }
    etat.hidden = true;
  }
  function infoPiece(et, id) {
    const m = et.maq, box = $(".p3-info"); m.sel = id; dessinerSol(et);
    const ks = [...new Set(m.cles[id] || [])].sort(triCode), nb = (c) => (m.cles[id] || []).filter(x => x === c).length;
    box.hidden = false;
    box.innerHTML = `<b>🚪 ${esc(m.noms[id] || "Pièce sans nom sur le plan")}</b><span>${nomNiveau(et.niv)}</span>
      <span>${ks.length ? "Clés de cette pièce :" : "Aucune clé repérée dans cette pièce."}</span>
      ${ks.length ? `<div>${ks.map(c => `<button data-k="${esc(c)}" style="border-color:${couleurCle(c)}">🔑 ${esc(c)}${nb(c) > 1 ? ` ×${nb(c)}` : ""}</button>`).join("")}</div>` : ""}
      <div><button data-plat>Voir à plat ›</button><button data-fi>✕</button></div>`;
    box.querySelectorAll("[data-k]").forEach(b => b.onclick = () => { st.filtre = b.dataset.k; filtreOptions(); dessinerPoints(); majSols(); });
    box.querySelector("[data-plat]").onclick = () => { fermer(); onPlat?.(et.n, st.filtre); };
    box.querySelector("[data-fi]").onclick = () => { box.hidden = true; m.sel = 0; dessinerSol(et); };
  }
  const majSols = () => etages.forEach(e => { if (e.maq) dessinerSol(e); });
  function seulNiveau(n) { st.seul = n; placer(); if (st.maq) majMaquette(); if (n != null) { arreterAuto(); allerCamera([30, 62, 62], [0, 0, 0]); ultraHD(n); } else allerCamera([70, 95, 100], [0, 0, 0]); }
  // Niveau seul : redessiné encore plus fin (jusqu'à 6144 px sur ordinateur, 4096 sur téléphone).
  async function ultraHD(n) {
    const et = etages.find(e => e.n === n); if (!hd || !et?.plan || !st.z || et.ultra) return;
    const larg = Math.min(renderer.capabilities.maxTextureSize || 4096, mobile ? 4096 : 6144); if (larg <= (et.larg || 0)) return;
    const etat = $(".p3-etat"); etat.hidden = false; etat.textContent = "✨ Détails du niveau…";
    try { const cv = await hd(n, larg, st.z); if (!cv || !vivant) return;
      const t = new THREE.CanvasTexture(texture(cv, st.z, "holo", larg, true)); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
      const ancien = et.plan.material.map; et.plan.material.map = t; et.plan.material.needsUpdate = true; ancien?.dispose(); et.ultra = true; et.larg = larg; }
    catch (e) { console.warn("Ultra HD", e); } finally { etat.hidden = true; }
  }
  function dessinerPoints() {
    etages.forEach(e => {
      e.points.forEach(p => { const on = vise(p.r), off = !!st.filtre && !on;
        p.mesh.material.opacity = off ? 0.07 : 1; p.mesh.scale.setScalar(on ? 1.9 : 1); p.halo.visible = !!on;
        if (on && !p.lab) { p.lab = etiquette(THREE, libR(p.r), couleurR(p.r), 0.8); p.lab.position.set(p.mesh.position.x, 2.6, p.mesh.position.z); e.groupe.add(p.lab);
          const tige = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(p.mesh.position.x, 0.1, p.mesh.position.z), new THREE.Vector3(p.mesh.position.x, 1.6, p.mesh.position.z)]), new THREE.LineBasicMaterial({ color: couleurR(p.r) })); p.tige = tige; e.groupe.add(tige); }
        if (p.lab) { p.lab.visible = !!on; p.tige.visible = !!on; } });
      const nb = st.filtre ? e.points.filter(p => vise(p.r)).length : e.points.length;
      fond.querySelector(`[data-niv="${e.n}"] em`)?.replaceChildren(document.createTextNode(nb ? `${nb} 🔑` : ""));
    });
  }
  async function construire() {
    $(".p3-load").hidden = false; $(".p3-info").hidden = true;
    monde.clear(); etages = [];
    const g = groupes[st.g]; filtreOptions();
    st.seul = null;
    $(".p3-niv").innerHTML = `<small>Voir un niveau en 3D</small><button data-tous class="on"><b>Tous</b><em></em></button>` + [...g.etages].reverse().map(e => `<div class="p3-nl"><button data-niv="${e.n}"><b>${nomNiveau(e.niv)}</b><em></em></button><button data-plat2="${e.n}" title="Ouvrir ce niveau à plat (pour modifier)">▭</button></div>`).join("");
    const [imgs, lesTextes] = await Promise.all([Promise.all(g.etages.map(e => charger(e.n).then(src => src ? chargerImg(src) : null).catch(() => null))), textes ? textes().catch(() => null) : null]);
    if (!vivant) return;
    const zs = imgs.map(i => i ? zoneUtile(i) : null).filter(Boolean);
    const z = zs.length ? { x: Math.min(...zs.map(a => a.x)), y: Math.min(...zs.map(a => a.y)) } : { x: 0, y: 0 };
    z.w = zs.length ? Math.max(...zs.map(a => a.x + a.w)) - z.x : 1; z.h = zs.length ? Math.max(...zs.map(a => a.y + a.h)) - z.y : 1; st.z = z;
    const ratio = imgs[0] ? (z.h * imgs[0].height) / (z.w * imgs[0].width) : 0.7, L = 100, P = L * ratio;
    g.etages.forEach((e, i) => {
      const groupe = new THREE.Group(); monde.add(groupe);
      // Dalle (verre bleuté) + contour lumineux.
      const dalle = new THREE.Mesh(new THREE.PlaneGeometry(L, P), new THREE.MeshBasicMaterial({ color: 0x0d3550, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }));
      dalle.rotation.x = -Math.PI / 2; dalle.userData.n = e.n; groupe.add(dalle);
      const bord = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(L, P)), new THREE.LineBasicMaterial({ color: 0x6fdcff, transparent: true, opacity: 0.7 }));
      bord.rotation.x = -Math.PI / 2; groupe.add(bord);
      if (imgs[i]) {
        const t = new THREE.CanvasTexture(texture(imgs[i], z, "holo")); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
        const plan = new THREE.Mesh(new THREE.PlaneGeometry(L, P), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
        plan.rotation.x = -Math.PI / 2; plan.position.y = 0.02; plan.userData.n = e.n; groupe.add(plan);
      }
      const nom = texteNiveau(THREE, nomNiveau(e.niv)); nom.position.set(-L / 2 - 10, 0, P / 2 - 2); groupe.add(nom);
      const points = reperes.filter(r => r.p === e.n).map(r => ({ r, fx: (r.x - z.x) / z.w, fy: (r.y - z.y) / z.h })).filter(r => r.fx >= 0 && r.fx <= 1 && r.fy >= 0 && r.fy <= 1).map(({ r, fx, fy }) => {
        const col = new THREE.Color(couleurR(r));
        const mesh = new THREE.Mesh(new THREE.CircleGeometry(0.75, 20), new THREE.MeshBasicMaterial({ color: col, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
        mesh.rotation.x = -Math.PI / 2; mesh.position.set((fx - 0.5) * L, 0.12, (fy - 0.5) * P); mesh.userData.r = r.id; mesh.renderOrder = 5; groupe.add(mesh);
        const halo = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.5, 28), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
        halo.rotation.x = -Math.PI / 2; halo.position.copy(mesh.position); halo.visible = false; groupe.add(halo);
        return { r, mesh, halo, fx, fy };
      });
      const pieces = ((lesTextes || {})[e.n] || []).map(([fx0, fy0, t]) => ({ fx: (fx0 - z.x) / z.w, fy: (fy0 - z.y) / z.h, t })).filter(q => q.fx >= 0 && q.fx <= 1 && q.fy >= 0 && q.fy <= 1)
        .map(q => ({ t: q.t, fx: q.fx, fy: q.fy, pos: new THREE.Vector3((q.fx - 0.5) * L, 0.5, (q.fy - 0.5) * P), sp: null }));
      etages.push({ n: e.n, niv: e.niv, P, groupe, points, pieces, cibleY: 0, plan: groupe.children.find(c => c.material?.map) });
    });
    placer(); etages.forEach(e => { e.groupe.position.y = 0; }); dessinerPoints();
    const d = Math.max(L, P) * 1.25; allerCamera([d * 0.55, d * 0.75, d * 0.8], [0, 0, 0]);
    $(".p3-load").hidden = true;
    if (st.maq) majMaquette();
    // Haute définition : les étages sont redessinés depuis le PDF (traits vectoriels → texture 4096 px).
    if (hd) {
      const jeton = (construire.jeton = (construire.jeton || 0) + 1), etat = $(".p3-etat");
      const larg = Math.min(renderer.capabilities.maxTextureSize || 4096, mobile ? 3072 : 4096);
      for (const [i, et] of etages.entries()) {
        if (!vivant || jeton !== construire.jeton) return;
        etat.hidden = false; etat.textContent = `✨ Haute définition… ${i + 1} / ${etages.length}`;
        try { const cv = await hd(et.n, larg, z); if (!cv || !vivant || jeton !== construire.jeton || !et.plan || et.ultra) continue;
          const t = new THREE.CanvasTexture(texture(cv, z, "holo", larg, true)); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
          const ancien = et.plan.material.map; et.plan.material.map = t; et.plan.material.needsUpdate = true; ancien?.dispose(); et.larg = larg; }
        catch (e) { console.warn("HD", e); }
      }
      etat.hidden = true;
    }
  }
  function infoPin(id) {
    const r = reperes.find(x => x.id === id); const box = $(".p3-info"); if (!r) { box.hidden = true; return; }
    const e = groupes[st.g].etages.find(x => x.n === r.p), tous = reperes.filter(x => x.c === r.c);
    box.hidden = false;
    box.innerHTML = `<b style="color:${couleurR(r)}">${typeR(r) === "cle" ? "🔑 " : ""}${esc(libR(r))}</b>${r.note ? `<span>${esc(r.note)}</span>` : ""}<span>${e ? nomNiveau(e.niv) + " · " : ""}${tous.length} porte${tous.length > 1 ? "s" : ""} avec cette clé</span>
      <div><button data-allumer>Isoler cette clé</button><button data-plat>Voir à plat ›</button><button data-fi>✕</button></div>`;
    box.querySelector("[data-allumer]").onclick = () => { st.filtre = typeR(r) === "tableau" ? "__tab" : typeR(r) === "compteur" ? "__cpt" : r.c; filtreOptions(); dessinerPoints(); box.hidden = true; };
    box.querySelector("[data-plat]").onclick = () => { fermer(); onPlat?.(r.p, st.filtre); };
    box.querySelector("[data-fi]").onclick = () => { box.hidden = true; };
  }

  // Clic : un point → infos ; un étage → plan à plat.
  const ray = new THREE.Raycaster(), souris = new THREE.Vector2(); let down = null;
  // Tap = sélection (point de clé / niveau) ; double-tap = zoom sur l'endroit touché ; plusieurs doigts = geste, pas de tap.
  let doigts = 0, multi = false, dernierTap = null, tapAttente = 0;
  renderer.domElement.addEventListener("pointerdown", (e) => { doigts++; if (doigts > 1) multi = true; if (doigts === 1) { multi = false; down = { x: e.clientX, y: e.clientY }; } arreterAuto(); });
  const lever = () => { doigts = Math.max(0, doigts - 1); };
  renderer.domElement.addEventListener("pointercancel", lever);
  const viser = (e) => { const r = renderer.domElement.getBoundingClientRect(); souris.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(souris, camera); };
  const planVise = () => ray.intersectObjects(etages.flatMap(et => et.groupe.children.filter(c => c.userData.n !== undefined)).filter(o => o.parent.visible))[0];
  function tapSimple(e) {
    viser(e);
    const pts = etages.filter(et => et.groupe.visible).flatMap(et => et.points.filter(p => p.mesh.material.opacity > 0.5).map(p => p.mesh));
    const hp = ray.intersectObjects(pts)[0]; if (hp) { infoPin(hp.object.userData.r); return; }
    if (st.maq) { const sols = etages.filter(et => et.groupe.visible && et.maq?.mSol.visible).map(et => et.maq.mSol), hs = ray.intersectObjects(sols)[0];
      if (hs?.uv) { const et = etages.find(x => x.n === hs.object.userData.sol), { W, H, lab } = et.maq.A; const id = lab[Math.min(H - 1, Math.round((1 - hs.uv.y) * H)) * W + Math.min(W - 1, Math.round(hs.uv.x * W))]; if (id) { infoPiece(et, id); return; } } }
    const h = planVise(); if (h && st.seul == null) seulNiveau(h.object.userData.n);
  }
  function zoomIci(e) {
    viser(e); const h = planVise(); if (!h) return;
    const off = camera.position.clone().sub(controls.target).multiplyScalar(0.45);
    if (off.length() < controls.minDistance * 1.2) off.setLength(controls.minDistance * 1.2);
    allerCamera(h.point.clone().add(off).toArray(), h.point.toArray());
  }
  renderer.domElement.addEventListener("pointerup", (e) => {
    lever();
    const geste = multi || !down || Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y) > (e.pointerType === "touch" ? 12 : 5);
    if (doigts === 0) { down = null; } if (geste) { if (doigts === 0) multi = false; return; }
    const ev = { clientX: e.clientX, clientY: e.clientY }, maintenant = Date.now();
    if (dernierTap && maintenant - dernierTap.t < 320 && Math.hypot(ev.clientX - dernierTap.x, ev.clientY - dernierTap.y) < 40) { clearTimeout(tapAttente); dernierTap = null; zoomIci(ev); return; }
    dernierTap = { t: maintenant, x: ev.clientX, y: ev.clientY };
    clearTimeout(tapAttente); tapAttente = setTimeout(() => { dernierTap = null; tapSimple(ev); }, 300);
  });
  renderer.domElement.addEventListener("dblclick", (e) => e.preventDefault());
  $("[data-hd]")?.addEventListener("change", async (e) => { const f = e.target.files?.[0]; if (!f) return; const lab = e.target.closest("label"); lab.textContent = "⏳ Enregistrement du PDF…";
    try { hd = await ajouterPdf(f); lab.remove(); construire(); } catch (err) { alert("Impossible : " + (err?.message || err)); lab.textContent = "✨ Rendre net + noms des pièces (PDF)"; } });
  $("[data-g]").onchange = (e) => { st.g = +e.target.value; construire(); };
  // Sur téléphone, la légende se replie (un tap sur « 🔑 Clés » l'ouvre / la ferme).
  if (matchMedia("(max-width:700px)").matches) $(".p3-leg").classList.add("plie");
  $(".p3-leg").addEventListener("click", (e) => { if (e.target.closest("[data-plier]")) { $(".p3-leg").classList.toggle("plie"); return; }
    if (matchMedia("(max-width:700px)").matches && e.target.closest("[data-cle]")) setTimeout(() => $(".p3-leg").classList.add("plie"), 250);
  });
  $(".p3-leg").addEventListener("click", (e) => { const b = e.target.closest("[data-cle]"); if (!b) return; st.filtre = st.filtre === b.dataset.cle ? "" : b.dataset.cle; majSols(); filtreOptions(); dessinerPoints(); });
  $(".p3-niv").addEventListener("click", (e) => { const pl = e.target.closest("[data-plat2]"); if (pl) { fermer(); onPlat?.(+pl.dataset.plat2, st.filtre); return; }
    if (e.target.closest("[data-tous]")) { seulNiveau(null); return; } const b = e.target.closest("[data-niv]"); if (b) seulNiveau(st.seul === +b.dataset.niv ? null : +b.dataset.niv); });
  $("[data-auto]").onclick = (e) => { st.auto = !st.auto; controls.autoRotate = st.auto; e.target.textContent = st.auto ? "⏸ Rotation" : "▶ Rotation"; };
  $("[data-ecart]").oninput = (e) => { st.ecart = +e.target.value; placer(); };
  $("[data-maq]").onclick = () => { st.maq = !st.maq; majMaquette(); };
  $("[data-dessus]").onclick = () => { arreterAuto(); allerCamera([0, 150, 0.01], [0, 0, 0]); };
  $("[data-face]").onclick = () => { allerCamera([70, 95, 100], [0, 0, 0]); };

  const boucle = () => {
    if (!vivant) return;
    etages.forEach(e => { e.groupe.position.y += (e.cibleY - e.groupe.position.y) * 0.08; });
    if (cible) { cible.t = Math.min(1, cible.t + 0.035); const k = 1 - Math.pow(1 - cible.t, 3);
      camera.position.lerpVectors(cible.p0, cible.pos, k); controls.target.lerpVectors(cible.g0, cible.tgt, k); if (cible.t >= 1) cible = null; }
    // De près : chaque point affiche son numéro de clé (les 60 plus proches).
    boucle.n = (boucle.n || 0) + 1;
    if (boucle.n % 8 === 0) {
      const v = new THREE.Vector3(), proches = [];
      etages.forEach(e => e.points.forEach(p => { const visible = e.groupe.visible && p.mesh.material.opacity > 0.5 && !vise(p.r);
        if (!visible) { if (p.petite) p.petite.visible = false; return; }
        p.mesh.getWorldPosition(v); const d = v.distanceTo(camera.position); const ndc = v.clone().project(camera); const ecran = Math.abs(ndc.x) < 0.95 && Math.abs(ndc.y) < 0.95 && ndc.z < 1; if (d < (st.maq ? 70 : 170) && ecran) proches.push([d, p, e]); else if (p.petite) p.petite.visible = false; }));
      proches.sort((a, b) => a[0] - b[0]).forEach(([, p, e], i) => {
        if (i >= 50) { if (p.petite) p.petite.visible = false; return; }
        if (!p.petite) { p.petite = etiquette(THREE, libR(p.r), couleurR(p.r), 0.42); p.petite.position.set(p.mesh.position.x, 1.1, p.mesh.position.z); e.groupe.add(p.petite); }
        p.petite.visible = true; });
    }
    // Noms des pièces : affichés nets autour de l'endroit regardé (les 90 plus proches à l'écran).
    if (boucle.n % 8 === 4) {
      const v = new THREE.Vector3(), proches = [];
      etages.forEach(e => (st.maq && e.maq ? e.pieces : e.maq?.etiq || []).forEach(q => { if (q.sp) q.sp.visible = false; }));
      etages.forEach(e => (st.maq && e.maq ? e.maq.etiq : e.pieces).forEach(q => { if (!e.groupe.visible) { if (q.sp) q.sp.visible = false; return; } v.copy(q.pos).add(e.groupe.position); const d = v.distanceTo(camera.position), ndc = v.clone().project(camera);
        if (d < 150 && Math.abs(ndc.x) < 1 && Math.abs(ndc.y) < 1 && ndc.z < 1) proches.push([d, q, e]); else if (q.sp) q.sp.visible = false; }));
      // Pas de chevauchement : rectangles à l'écran (taille fixe des étiquettes).
      const rv = renderer.domElement.getBoundingClientRect(), k5 = camera.projectionMatrix.elements[5] / 2 * rv.height, rects = []; let nb = 0;
      proches.sort((a, b) => a[0] - b[0]).forEach(([, q, e]) => {
        if (nb >= (st.maq ? 28 : 50)) { if (q.sp) q.sp.visible = false; return; }
        if (!q.sp) { q.sp = nomPiece(THREE, q.t); q.sp.position.copy(q.pos); q.sp.visible = false; e.groupe.add(q.sp); }
        v.copy(q.pos).add(e.groupe.position); const ndc = v.project(camera), cx = (ndc.x + 1) / 2 * rv.width, cy = (1 - ndc.y) / 2 * rv.height;
        const w = q.sp.scale.x * k5 + 6, h = q.sp.scale.y * k5 + 4, r0 = [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2];
        if (rects.some(r => r0[0] < r[2] && r0[2] > r[0] && r0[1] < r[3] && r0[3] > r[1])) { q.sp.visible = false; return; }
        rects.push(r0); nb++;
        q.sp.visible = true; });
    }
    const t = performance.now() / 1000; etages.forEach(e => e.points.forEach(p => { if (p.halo.visible) { const s = 1 + (t * 1.2 % 1) * 1.4; p.halo.scale.setScalar(s); p.halo.material.opacity = 0.9 * (1 - (t * 1.2 % 1)); } }));
    controls.update(); renderer.render(scene, camera); raf = requestAnimationFrame(boucle);
  };
  camera.position.set(140, 160, 180); controls.target.set(0, 0, 0);
  boucle(); await construire();
}

const STYLE = `<style id="p3-style">
.p3{position:fixed;inset:0;z-index:6500;background:radial-gradient(ellipse at 50% 60%,#0d2238 0%,#050b14 70%);color:#dff6ff;display:flex;flex-direction:column;font-family:system-ui,sans-serif;overflow:hidden}
.p3-ciel{position:absolute;inset:0;background-image:linear-gradient(rgba(80,200,255,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(80,200,255,.05) 1px,transparent 1px);background-size:44px 44px;mask-image:radial-gradient(ellipse at 50% 70%,#000 20%,transparent 75%);pointer-events:none}
.p3-h{position:relative;z-index:3;display:flex;align-items:center;gap:12px;padding:10px 16px;flex-wrap:wrap;background:linear-gradient(#050b14,transparent)}
.p3-h b{max-width:34vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:17px;text-shadow:0 0 12px rgba(120,225,255,.6)}.p3-sous{font-size:12px;color:#7fb3cc}
.p3-hb{margin-left:auto;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.p3-hb select,.p3-hb button,.p3-niv button,.p3-info button{background:rgba(40,120,170,.18);color:#dff6ff;border:1px solid rgba(120,225,255,.35);border-radius:9px;padding:6px 11px;font:inherit;font-size:13px;cursor:pointer;backdrop-filter:blur(6px)}
.p3-hb select option{background:#0b1a2a}.p3-hb button:hover,.p3-niv button:hover,.p3-info button:hover{background:rgba(80,190,255,.3)}
.p3-ec{display:flex;align-items:center;gap:6px;font-size:12.5px;color:#9fd3ea}.p3-ec input{accent-color:#5fd4ff;width:110px}
.p3-niv{position:absolute;left:16px;top:50%;transform:translateY(-50%);z-index:3;display:flex;flex-direction:column;gap:8px}.p3-niv small{font-size:11px;color:#7fb3cc}.p3-nl{display:flex;gap:4px}.p3-nl [data-plat2]{min-width:0;padding:4px 9px;justify-content:center;font-size:16px}.p3-hb button.on{background:rgba(80,190,255,.4);border-color:#7fe8ff;box-shadow:0 0 12px rgba(80,200,255,.5)}.p3-niv button.on{background:rgba(80,190,255,.35);border-color:#7fe8ff}
.p3-niv button{display:flex;flex-direction:column;align-items:flex-start;min-width:96px;padding:8px 12px}.p3-niv b{font-size:15px}.p3-niv em{font-style:normal;font-size:11.5px;color:#ffb3bb;min-height:14px}
.p3-vue{flex:1;position:relative;min-height:0}.p3-vue canvas{display:block;touch-action:none;cursor:grab}.p3-vue canvas:active{cursor:grabbing}
.p3-leg{position:absolute;right:16px;top:64px;bottom:16px;z-index:3;width:170px;overflow:auto;display:flex;flex-direction:column;gap:4px;scrollbar-width:thin}
.p3-leg h4{margin:0 0 4px;font-size:13px;color:#bfe9ff}.p3-pli{display:none}.p3-leg h4 small{display:block;font-weight:400;color:#7fb3cc;font-size:11px}
.p3-leg button{display:flex;align-items:center;gap:8px;background:rgba(10,30,50,.55);border:1px solid rgba(120,225,255,.18);border-radius:8px;padding:5px 9px;color:#dff6ff;font:inherit;font-size:13px;cursor:pointer;text-align:left}
.p3-leg button i{width:11px;height:11px;border-radius:50%;flex:none}.p3-leg button span{margin-left:auto;color:#8fc0d6;font-size:12px}.p3-leg button.on{background:rgba(80,190,255,.3);border-color:#7fe8ff}.p3-leg button.off{opacity:.45}
.p3-hd{background:linear-gradient(135deg,#0f6a8f,#1aa3c8);color:#fff;border:1px solid #5fd4ff;border-radius:9px;padding:6px 11px;font-size:13px;cursor:pointer;box-shadow:0 0 14px rgba(95,212,255,.5)}
.p3-etat{position:absolute;left:50%;top:60px;transform:translateX(-50%);z-index:4;background:rgba(6,16,28,.85);border:1px solid rgba(120,225,255,.4);border-radius:99px;padding:5px 14px;font-size:12.5px;color:#bfe9ff}.p3-etat[hidden]{display:none}
.p3-load{position:absolute;inset:0;display:grid;place-items:center;font-size:16px;color:#9fd3ea;pointer-events:none}.p3-load[hidden]{display:none}
.p3-info{position:absolute;right:200px;bottom:16px;z-index:4;background:rgba(6,16,28,.9);border:1px solid rgba(120,225,255,.4);border-radius:14px;padding:12px 14px;display:flex;flex-direction:column;gap:6px;min-width:240px;box-shadow:0 0 30px rgba(80,200,255,.2);font-size:13.5px}
.p3-info[hidden]{display:none}.p3-info span{color:#9fc7da}.p3-info div{display:flex;gap:6px;flex-wrap:wrap}
@media (max-width:700px){.p3-niv{top:auto;bottom:12px;transform:none;flex-direction:row;flex-wrap:nowrap;overflow-x:auto;left:8px;right:170px;gap:5px}.p3-niv small,.p3-nl [data-plat2]{display:none}.p3-niv>button,.p3-nl{flex:none}.p3-leg h4 small{display:none}.p3-niv button{padding:5px 8px}.p3-niv b{font-size:13px}.p3-niv em{font-size:10px}.p3-niv button{min-width:0}.p3-sous{display:none}.p3-leg{top:auto;bottom:12px;max-height:55vh;height:auto;width:150px;background:rgba(5,11,20,.85);border-radius:12px;padding:8px}.p3-leg.plie{max-height:none}.p3-leg.plie button{display:none}.p3-leg h4{cursor:pointer;display:flex;align-items:center;gap:6px;flex-wrap:wrap}.p3-pli{display:inline;font-style:normal;margin-left:auto}.p3-leg.plie .p3-pli{transform:rotate(180deg)}.p3-h{padding:8px 10px;gap:6px}.p3-h b{font-size:15px;max-width:60vw}.p3-hb{gap:5px}.p3-hb button,.p3-hb select{padding:5px 8px;font-size:12px}.p3-ec{display:none}.p3-info{right:12px;bottom:230px}}
</style>`;

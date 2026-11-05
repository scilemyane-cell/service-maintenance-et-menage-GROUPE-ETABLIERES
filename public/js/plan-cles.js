// plan-cles.js — « 🔑 Plan des clés » d'un dossier de site.
// Le plan PDF (architecte) est importé dans l'appli : chaque page devient une image, et les
// étiquettes posées sur le PDF (MV10, MV11… en rouge ou bleu = numéros de clé / organigramme)
// deviennent des repères modifiables : ajouter, déplacer, changer le numéro ou la couleur, supprimer.
// Filtre par numéro de clé : toutes les portes d'une même clé s'allument, page par page.
// Stockage : config/plancles-<dossier> (pages + repères, écouté en direct) et
// config/plancles-<dossier>-p<n> (image de la page, lue à la demande).
import { db } from "./firebase-init.js";
import { doc, getDoc, setDoc, deleteDoc, onSnapshot, collection, addDoc, query, where, getDocs } from "./firestore-compte.js";
import { auth } from "./firebase-init.js";
import { esc } from "./astreinte-logic.js";
import { PDFJS, PDFJS_WORKER } from "./fiches-poste-import.js";
import { groupesEtages, niveauDe, NIVEAUX } from "./plan-3d.js";
const nomNiveau = (n) => n < -1 ? `Sous-sol ${n}` : n < 0 ? "Sous-sol" : n === 0 ? "RDC" : `R+${n}`;

const refMeta = (id) => doc(db, "config", `plancles-${id}`);
const refPage = (id, n) => doc(db, "config", `plancles-${id}-p${n}`);
const cacheImages = new Map();
const COULEURS = { rouge: "#d11f1f", bleu: "#1565d8", vert: "#15803d", orange: "#d97706" };
const uid = () => Math.random().toString(36).slice(2, 10);
const nomSite = (n) => String(n || "").replace(/\s*\([^)]*@[^)]*\)\s*/g, " ").replace(/\S+@\S+/g, "").replace(/\s+/g, " ").trim();
const triCode = (a, b) => String(a).localeCompare(String(b), "fr", { numeric: true });

// ---------- PDF d'origine (pour la 3D en haute définition) ----------
const refPdf = (id, k) => doc(db, "config", `plancles-${id}-pdf${k}`);
const pdfCache = new Map();
// Noms des pièces : textes du PDF (position + texte), regroupés par étiquette (« salle » + « informatique 2 »).
const refTextes = (id) => doc(db, "config", `plancles-${id}-textes`);
const horsCartouche = (x, y, paysage = true) => paysage ? !((x < 0.3 && y > 0.7) || (x > 0.75 && y < 0.16) || y > 0.86 || y < 0.06) : !(y < 0.035 || y > 0.965 || x < 0.035 || x > 0.965);
const PARASITES = /^(\d*up|is|vh|vb|hsp:?|pl|pld\.?|td|pc|ss|ep|ev|eu|gtl|jd|pvc|vmc|logt|x|m|m2|ob|f|larg\.?|all|carrelage|trappe|[+-]?\d+[,.]\d+=?.*|\d+(?:[.,]\d+)?\s*(?:m²|m2|m|cm|ml)?)$/i;
export async function extraireTextes(pdf) {
  const pages = {};
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n), vp = page.getViewport({ scale: 1 }), tc = await page.getTextContent().catch(() => ({ items: [] }));
    const items = [];
    tc.items.forEach(it => {
      const t = String(it.str || "").trim(); if (!t) return;
      const [a, b, c, d, e, f] = it.transform, la = Math.hypot(a, b) || 1, lh = Math.hypot(c, d) || 1, w = it.width || 0, h = it.height || lh;
      const [x0, y0] = vp.convertToViewportPoint(e + c / lh * h / 2, f + d / lh * h / 2), [x1, y1] = vp.convertToViewportPoint(e + a / la * w + c / lh * h / 2, f + b / la * w + d / lh * h / 2);
      const fx = (x0 + x1) / 2 / vp.width, fy = (y0 + y1) / 2 / vp.height, H = h / Math.max(vp.width, vp.height);
      if (fx < 0 || fx > 1 || fy < 0 || fy > 1 || !horsCartouche(fx, fy, vp.width >= vp.height)) return;
      items.push({ x: fx, y: fy, xa: Math.min(x0, x1) / vp.width, xb: Math.max(x0, x1) / vp.width, h: H, t });
    });
    // 1) Mots d'une même ligne (« Ch » + « 101 »).
    items.sort((p, q) => p.y - q.y || p.xa - q.xa);
    const lignes = [];
    items.forEach(it => { const l = lignes.find(l => Math.abs(l.y - it.y) < it.h * 0.6 && it.xa - l.xb < it.h * 1.6 && it.xa - l.xb > -it.h);
      if (l) { l.t += " " + it.t; l.xb = Math.max(l.xb, it.xb); l.x = (l.xa + l.xb) / 2; } else lignes.push({ ...it }); });
    // 2) Lignes empilées d'une même étiquette (« salle » / « informatique 2 »).
    const blocs = [];
    lignes.sort((p, q) => p.y - q.y).forEach(it => { const b = blocs.find(b => Math.abs(b.x - it.x) < Math.max(0.012, it.h * 4) && it.y - b.yb > -it.h * 0.3 && it.y - b.yb < it.h * 2.4 && b.n < 3);
      if (b) { b.t += " " + it.t; b.y = (b.y * b.n + it.y) / (b.n + 1); b.yb = it.y; b.n++; } else blocs.push({ x: it.x, y: it.y, yb: it.y, n: 1, t: it.t }); });
    const propres = blocs.map(b => ({ ...b, t: b.t.split(/\s+/).filter(m => !PARASITES.test(m) || /^ch$/i.test(b.t.split(/\s+/)[0])).join(" ") }))
      .filter(b => /[a-zà-ü]{2,}/i.test(b.t) && !/^(ch|wc)$/i.test(b.t) || /^ch\s*\d/i.test(b.t));
    if (propres.length) pages[n] = propres.slice(0, 600).map(b => [+b.x.toFixed(4), +b.y.toFixed(4), b.t.slice(0, 40)]);
  }
  return pages;
}
export async function lireTextes(dossierId) { try { const s = await getDoc(refTextes(dossierId)); return s.exists() ? s.data().pages || {} : null; } catch { return null; } }
export async function sauverPdfPlan(dossierId, fichier) {
  const buf = new Uint8Array(await fichier.arrayBuffer()); let bin = ""; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  const b64 = btoa(bin), T = 900000, n = Math.ceil(b64.length / T);
  if (n > 40) throw new Error("PDF trop lourd (max ≈ 25 Mo)");
  for (let k = 0; k < n; k++) await setDoc(refPdf(dossierId, k), { d: b64.slice(k * T, (k + 1) * T) });
  await setDoc(refMeta(dossierId), { pdf: { morceaux: n, nom: fichier.name, le: Date.now() } }, { merge: true });
  pdfCache.delete(dossierId);
  try { const { pdf } = await documentPdf(dossierId, n); const pages = await extraireTextes(pdf); await setDoc(refTextes(dossierId), { pages, le: Date.now() }); }
  catch (e) { console.warn("Noms des pièces non extraits", e); }
}
async function documentPdf(dossierId, morceaux) {
  if (!pdfCache.has(dossierId)) pdfCache.set(dossierId, (async () => {
    const parts = await Promise.all(Array.from({ length: morceaux }, (_, k) => getDoc(refPdf(dossierId, k)).then(s => s.data()?.d || "")));
    const bin = atob(parts.join("")), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const pdfjs = await import(/* @vite-ignore */ PDFJS); pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    return { pdfjs, pdf: await pdfjs.getDocument({ data: u }).promise };
  })().catch(e => { pdfCache.delete(dossierId); throw e; }));
  return pdfCache.get(dossierId);
}
// Rendu net d'une zone d'une page (z en fractions de page), largeur « larg » pixels.
// Traits du plan (vectoriels) : segments en fractions de page, pour monter les murs en 3D.
// Les courbes (arcs de portes) sont ignorées → les portes restent des ouvertures.
const segCache = new Map();
async function segmentsPage(dossierId, morceaux, n) {
  const cle = `${dossierId}-${n}`; if (segCache.has(cle)) return segCache.get(cle);
  const { pdfjs, pdf } = await documentPdf(dossierId, morceaux);
  const page = await pdf.getPage(n), vp = page.getViewport({ scale: 1 }), ol = await page.getOperatorList(), O = pdfjs.OPS;
  const mul = (m, t) => [m[0] * t[0] + m[2] * t[1], m[1] * t[0] + m[3] * t[1], m[0] * t[2] + m[2] * t[3], m[1] * t[2] + m[3] * t[3], m[0] * t[4] + m[2] * t[5] + m[4], m[1] * t[4] + m[3] * t[5] + m[5]];
  let ctm = [1, 0, 0, 1, 0, 0], couleur = [0, 0, 0]; const pile = [], out = [];
  let attente = [];
  const pt = (x, y) => { const X = ctm[0] * x + ctm[2] * y + ctm[4], Y = ctm[1] * x + ctm[3] * y + ctm[5]; const [a, b] = vp.convertToViewportPoint(X, Y); return [a / vp.width, b / vp.height]; };
  const STROKES = new Set([O.stroke, O.closeStroke, O.fillStroke, O.eoFillStroke, O.closeFillStroke, O.closeEOFillStroke]);
  for (let i = 0; i < ol.fnArray.length && out.length < 4 * 70000; i++) {
    const fn = ol.fnArray[i], a = ol.argsArray[i];
    if (fn === O.save) pile.push([ctm, couleur]);
    else if (fn === O.restore) { const v = pile.pop(); if (v) [ctm, couleur] = v; }
    else if (fn === O.transform) ctm = mul(ctm, a);
    else if (fn === O.paintFormXObjectBegin) { pile.push([ctm, couleur]); if (Array.isArray(a?.[0]) && a[0].length === 6) ctm = mul(ctm, a[0]); }
    else if (fn === O.paintFormXObjectEnd) { const v = pile.pop(); if (v) [ctm, couleur] = v; }
    else if (fn === O.setStrokeRGBColor) couleur = [a[0], a[1], a[2]];
    else if (fn === O.setStrokeGray) couleur = [a[0] * 255, a[0] * 255, a[0] * 255];
    else if (fn === O.constructPath) {
      const ops = a[0], ar = a[1]; let j = 0, cx = 0, cy = 0, sx = 0, sy = 0;
      for (const op of ops) {
        if (op === O.moveTo) { cx = ar[j++]; cy = ar[j++]; sx = cx; sy = cy; }
        else if (op === O.lineTo) { const x = ar[j++], y = ar[j++]; attente.push([cx, cy, x, y]); cx = x; cy = y; }
        else if (op === O.rectangle) { const x = ar[j++], y = ar[j++], w = ar[j++], h = ar[j++]; attente.push([x, y, x + w, y], [x + w, y, x + w, y + h], [x + w, y + h, x, y + h], [x, y + h, x, y]); cx = x; cy = y; }
        else if (op === O.curveTo) { cx = ar[j + 4]; cy = ar[j + 5]; j += 6; }
        else if (op === O.curveTo2 || op === O.curveTo3) { cx = ar[j + 2]; cy = ar[j + 3]; j += 4; }
        else if (op === O.closePath) { if (cx !== sx || cy !== sy) attente.push([cx, cy, sx, sy]); cx = sx; cy = sy; }
      }
    } else if (STROKES.has(fn)) {
      const [r, g, b] = couleur, colore = Math.max(r, g, b) - Math.min(r, g, b) > 60;
      if (!colore) attente.forEach(([x1, y1, x2, y2]) => { const [a1, b1] = pt(x1, y1), [a2, b2] = pt(x2, y2);
        if (Math.hypot(a2 - a1, b2 - b1) > 0.0012) out.push(+a1.toFixed(5), +b1.toFixed(5), +a2.toFixed(5), +b2.toFixed(5)); });
      attente = [];
    } else if (fn === O.fill || fn === O.eoFill || fn === O.endPath) attente = [];
  }
  const res = new Float32Array(out); segCache.set(cle, res); return res;
}
export function rendeurHD(dossierId, morceaux) {
  const f = async (n, larg, z) => {
    const { pdfjs, pdf } = await documentPdf(dossierId, morceaux);
    const page = await pdf.getPage(n), v1 = page.getViewport({ scale: 1 });
    const scale = larg / (z.w * v1.width), vp = page.getViewport({ scale, offsetX: -z.x * v1.width * scale, offsetY: -z.y * v1.height * scale });
    const cv = document.createElement("canvas"); cv.width = Math.round(larg); cv.height = Math.round(z.h * v1.height * scale);
    const cx = cv.getContext("2d"); cx.fillStyle = "#fff"; cx.fillRect(0, 0, cv.width, cv.height);
    await page.render({ canvasContext: cx, viewport: vp, annotationMode: pdfjs.AnnotationMode.DISABLE }).promise;
    return cv;
  };
  f.murs = (n) => segmentsPage(dossierId, morceaux, n);
  return f;
}

export async function planClesExiste(dossierId) {
  try { const s = await getDoc(refMeta(dossierId)); return s.exists() && (s.data().pages || []).length > 0; } catch { return false; }
}

// ---------- Import du PDF (dans le navigateur) ----------
async function encoder(canvas) {
  let c = canvas;
  for (let essai = 0; essai < 6; essai++) {
    for (const q of [0.82, 0.7, 0.58]) {
      let u = c.toDataURL("image/webp", q);
      if (!u.startsWith("data:image/webp")) u = c.toDataURL("image/jpeg", q);
      if (u.length < 950000) return { data: u, w: c.width, h: c.height };
    }
    const c2 = document.createElement("canvas"); c2.width = Math.round(c.width * 0.85); c2.height = Math.round(c.height * 0.85);
    const x = c2.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, c2.width, c2.height); x.drawImage(c, 0, 0, c2.width, c2.height); c = c2;
  }
  throw new Error("page trop lourde");
}
const titrePage = (items, n) => {
  const t = items.map(i => String(i.str || "").trim()).filter(Boolean);
  const m = t.find(s => /^(plan |b[aâ]timent [a-z]\s*-|coupe|fa[cç]ade)/i.test(s));
  return m ? m.replace(/\s+/g, " ").replace(/^./, c => c.toUpperCase()).replace(/^Batiment/i, "Bâtiment") : `Page ${n}`;
};
function couleurAnnot(a) {
  const c = a.defaultAppearanceData?.fontColor || a.color;
  if (!c || c.length < 3) return "rouge";
  const [r, g, b] = c;
  return b > r + 40 ? "bleu" : g > r + 40 && g > b ? "vert" : "rouge";
}
export async function importerPlanPdf(dossier, fichier, par, progres = () => {}) {
  const pdfjs = await import(/* @vite-ignore */ PDFJS);
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  const pdf = await pdfjs.getDocument({ data: await fichier.arrayBuffer() }).promise;
  const ancien = await getDoc(refMeta(dossier.id)).catch(() => null);
  const ancienNb = ancien?.exists?.() ? (ancien.data().pages || []).length : 0;
  const pages = [], reperes = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    progres(`Page ${n} / ${pdf.numPages}…`);
    const page = await pdf.getPage(n), vp1 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: 2600 / Math.max(vp1.width, vp1.height) });
    const cv = document.createElement("canvas"); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
    const cx = cv.getContext("2d"); cx.fillStyle = "#fff"; cx.fillRect(0, 0, cv.width, cv.height);
    await page.render({ canvasContext: cx, viewport: vp, annotationMode: pdfjs.AnnotationMode.DISABLE }).promise;
    const img = await encoder(cv);
    const tc = await page.getTextContent().catch(() => ({ items: [] }));
    const annots = await page.getAnnotations().catch(() => []);
    annots.forEach(a => {
      if (!["FreeText", "Text", "Square"].includes(a.subtype)) return;
      const txt = String(a.contentsObj?.str || a.contents || a.textContent?.join(" ") || "").replace(/\s+/g, " ").trim();
      if (!txt || !a.rect) return;
      const [x1, y1, x2, y2] = vp.convertToViewportRectangle(a.rect);
      const lg = txt.match(/^log(?:ement|t)?\.?\s*(\S+)$/i), tb = txt.match(/^(TGBT|TDR|TD|TC)\s*(\d+)?$/i);
      const base = { id: uid(), p: n, x: +(((x1 + x2) / 2) / vp.width).toFixed(5), y: +(((y1 + y2) / 2) / vp.height).toFixed(5), note: "" };
      reperes.push(lg ? { ...base, t: "logement", c: lg[1] } : tb ? { ...base, t: "tableau", c: `${tb[1].toUpperCase()}${tb[2] ? " " + tb[2] : ""}`, tabType: tb[1].toUpperCase(), num: tb[2] || "" } : { ...base, c: txt.slice(0, 40), col: couleurAnnot(a) });
    });
    await setDoc(refPage(dossier.id, n), { data: img.data, dossierId: dossier.id, n });
    cacheImages.set(`${dossier.id}-${n}`, img.data);
    pages.push({ n, titre: titrePage(tc.items || [], n), w: img.w, h: img.h });
  }
  for (let n = pdf.numPages + 1; n <= ancienNb; n++) await deleteDoc(refPage(dossier.id, n)).catch(() => {});
  await setDoc(refMeta(dossier.id), { dossierId: dossier.id, dossierNom: dossier.nom || "", fichier: fichier.name, importeLe: Date.now(), importePar: par, pages, reperes, majLe: Date.now(), majPar: par });
  progres("Enregistrement du PDF (3D nette)…");
  try { await sauverPdfPlan(dossier.id, fichier); } catch (e) { console.warn("PDF HD non enregistré", e); }
  return { pages: pages.length, reperes: reperes.length };
}

// ---------- Repères : clés, compteurs, tableaux électriques ----------
export const TYPES_R = {
  cle: { ic: "🔑", lib: "Clé", pl: "Clés" },
  compteur: { ic: "🎛️", lib: "Compteur", pl: "Compteurs", k: "#0891b2" },
  tableau: { ic: "⚡", lib: "Tableau électrique", pl: "Tableaux électriques", k: "#d97706" },
  logement: { ic: "🏠", lib: "Logement", pl: "Logements", k: "#dc2626" },
  vanne: { ic: "🚰", lib: "Vanne", pl: "Vannes", k: "#2563eb" },
};
export const TYPES_TABLEAU = ["TGBT", "TD", "TDR", "TC", "Armoire", "Coffret"];
export const typeR = (r) => r.t || "cle";
const couleurR = (r) => typeR(r) === "cle" ? (COULEURS[r.col] || COULEURS.rouge) : TYPES_R[typeR(r)].k;
const libR = (r) => typeR(r) === "vanne" ? `🚰 ${r.c}` : typeR(r) === "logement" ? `🏠 ${r.c}` : typeR(r) === "tableau" ? `⚡ ${r.c}` : typeR(r) === "compteur" ? `🎛️ ${r.c}` : r.c;
const correspond = (r, f) => !f ? true : f === "__cle" ? typeR(r) === "cle" : f === "__tab" ? typeR(r) === "tableau" : f === "__cpt" ? typeR(r) === "compteur" : f === "__log" ? typeR(r) === "logement" : f === "__van" ? typeR(r) === "vanne" : typeR(r) === "cle" && r.c === f;
const libFiltre = (f) => f === "__cle" ? "Clés" : f === "__tab" ? "Tableaux électriques" : f === "__cpt" ? "Compteurs" : f === "__log" ? "Logements" : f === "__van" ? "Vannes" : f ? `Clé ${f}` : "Tous les repères";
export const prochainNumero = (reps, type) => 1 + Math.max(0, ...reps.filter(r => typeR(r) === "tableau" && r.tabType === type).map(r => parseInt(r.num, 10) || 0));

// Photos d'un équipement (tableau électrique…) : petits documents dans « fiches-photos ».
export async function photosEquipement(repId) {
  const s = await getDocs(query(collection(db, "fiches-photos"), where("repId", "==", repId)));
  return s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.le || 0) - (b.le || 0));
}
export async function ajouterPhotoEquipement(dossierId, repId, fichier, par) {
  const { compresserImage } = await import("./demandes-photos.js");
  const data = await compresserImage(fichier);
  return addDoc(collection(db, "fiches-photos"), { type: "equipement", dossierId, repId, agentUid: auth.currentUser?.uid || "", par, data, legende: "", le: Date.now() });
}
export async function lirePlanMeta(dossierId) { try { const s = await getDoc(refMeta(dossierId)); return s.exists() ? s.data() : null; } catch { return null; } }

// ---------- Impression / PDF par type d'équipement ----------
async function imprimerPlans({ dossier, meta, filtre, charger }) {
  const reps = (meta.reperes || []).filter(r => correspond(r, filtre));
  if (!reps.length) { alert("Aucun repère de ce type sur le plan."); return; }
  const pages = meta.pages.filter(p => reps.some(r => r.p === p.n));
  const imgs = [];
  for (const p of pages) {
    const src = await charger(p.n); if (!src) continue;
    const im = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = src; });
    const cv = document.createElement("canvas"); cv.width = p.w; cv.height = p.h; const x = cv.getContext("2d");
    x.drawImage(im, 0, 0, p.w, p.h); const fs = Math.round(p.w / 110);
    x.fillStyle = "#fff"; (meta.masques || []).filter(m => m.p === p.n).forEach(m => x.fillRect(m.x * p.w, m.y * p.h, m.w * p.w, m.h * p.h));
    x.font = `bold ${fs}px sans-serif`; x.textAlign = "center"; x.textBaseline = "middle";
    reps.filter(r => r.p === p.n).forEach(r => { const t = libR(r).replace(/^[^\w]+\s/, ""), w = x.measureText(t).width + fs * 0.8, cx = r.x * p.w, cy = r.y * p.h, k = couleurR(r);
      x.fillStyle = "rgba(255,255,255,.95)"; x.fillRect(cx - w / 2, cy - fs * 0.75, w, fs * 1.5); x.strokeStyle = k; x.lineWidth = 3; x.strokeRect(cx - w / 2, cy - fs * 0.75, w, fs * 1.5); x.fillStyle = k; x.fillText(t, cx, cy + 1); });
    imgs.push({ p, src: cv.toDataURL("image/jpeg", 0.88) });
  }
  const titre = (n) => meta.pages.find(p => p.n === n)?.titre || `Page ${n}`;
  const lignes = reps.slice().sort((a, b) => triCode(a.c, b.c)).map(r => `<tr><td><b style="color:${couleurR(r)}">${esc(r.c)}</b></td><td>${esc(TYPES_R[typeR(r)].lib)}</td><td>${esc(titre(r.p))}</td><td>${esc(r.note || "")}</td></tr>`).join("");
  // Mise en page Groupe Établières / AppSMM : bandeau, cartouche et pied de page sur chaque feuille.
  const logo = new URL("img/logo-etablieres.png", document.baseURI).href, auj = new Date().toLocaleDateString("fr-FR"), par = window.__smmNom || "";
  const nbT = Object.fromEntries(Object.keys(TYPES_R).map(t => [t, reps.filter(r => typeR(r) === t).length]));
  const legende = Object.keys(TYPES_R).filter(t => nbT[t]).map(t => `<span><i style="background:${t === "cle" ? COULEURS.rouge : TYPES_R[t].k}"></i>${TYPES_R[t].ic} ${TYPES_R[t].pl} : ${nbT[t]}</span>`).join("");
  const total = imgs.length + Math.max(1, Math.ceil(reps.length / 22));
  const tete = (sous) => `<header><img src="${logo}" alt=""><div><b>${esc(nomSite(dossier.nom))}</b><small>${sous}</small></div><div class="app"><b>AppSMM</b><small>Service Maintenance &amp; Ménage<br>Groupe Établières</small></div></header>`;
  const pied = (k) => `<footer><span>${legende}</span><span>Édité le ${auj}${par ? ` par ${esc(par)}` : ""} · AppSMM</span><span>Page ${k} / ${total}</span></footer>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(nomSite(dossier.nom))} — ${esc(libFiltre(filtre))}</title><style>
    @page{size:A4 landscape;margin:7mm}*{box-sizing:border-box}body{font-family:system-ui,"Segoe UI",sans-serif;margin:0;color:#14213d;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .pg{page-break-after:always;height:195mm;display:flex;flex-direction:column;border:1.2pt solid #14213d;border-radius:3mm;overflow:hidden}
    header{display:flex;align-items:center;gap:5mm;padding:2.5mm 5mm;background:linear-gradient(90deg,#14213d,#1f3a68);color:#fff}
    header img{height:11mm;background:#fff;border-radius:2mm;padding:1mm 2mm}header>div{display:flex;flex-direction:column;flex:1}header b{font-size:13pt}header small{font-size:9pt;opacity:.85}
    header .app{flex:none;text-align:right;border-left:1px solid rgba(255,255,255,.35);padding-left:5mm}header .app b{font-size:12pt;letter-spacing:.04em;color:#ffd166}header .app small{font-size:7.5pt;line-height:1.25}
    .plan{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;padding:2mm}.plan img{max-width:100%;max-height:100%;object-fit:contain}
    footer{display:flex;justify-content:space-between;gap:4mm;align-items:center;padding:1.8mm 5mm;border-top:1pt solid #c9d2e3;font-size:8pt;color:#44506a;background:#f4f6fa}
    footer span{display:flex;align-items:center;gap:3mm;flex-wrap:wrap}footer i{display:inline-block;width:3mm;height:3mm;border-radius:50%;margin-right:1mm;vertical-align:middle}
    .liste{flex:1;padding:4mm 5mm;overflow:hidden}.pgl{height:auto;page-break-after:auto}.pgl .liste{overflow:visible}thead{display:table-header-group}tr{page-break-inside:avoid}table{border-collapse:collapse;width:100%;font-size:9pt}th,td{border:1px solid #c9d2e3;padding:1.5mm 2.5mm;text-align:left}th{background:#14213d;color:#fff}tr:nth-child(even) td{background:#f4f6fa}
  </style></head><body>
  ${imgs.map(({ p, src }, k) => `<div class="pg">${tete(`${esc(p.titre)} · ${esc(libFiltre(filtre))} · ${reps.filter(r => r.p === p.n).length} repère(s)`)}<div class="plan"><img src="${src}"></div>${pied(k + 1)}</div>`).join("")}
  <div class="pg pgl">${tete(`Liste des repères · ${esc(libFiltre(filtre))} (${reps.length})`)}<div class="liste"><table><thead><tr><th>Repère</th><th>Type</th><th>Plan</th><th>Emplacement / note</th></tr></thead><tbody>${lignes}</tbody></table></div>${pied(`${imgs.length + 1}${total > imgs.length + 1 ? `–${total}` : ""}`)}</div></body></html>`;
  const f = document.createElement("iframe"); f.style.cssText = "position:fixed;left:-20000px;top:0;width:1123px;height:794px;border:0"; document.body.appendChild(f);
  f.contentDocument.open(); f.contentDocument.write(html); f.contentDocument.close();
  await new Promise(r => { const im = f.contentDocument.querySelector("header img"); if (!im || im.complete) setTimeout(r, 600); else { im.onload = im.onerror = () => setTimeout(r, 300); setTimeout(r, 4000); } }); f.contentWindow.focus(); f.contentWindow.print(); setTimeout(() => f.remove(), 60000);
}

// ---------- Visionneuse / mode édition ----------
export function ouvrirPlanCles({ dossier, user, editeur, focus = null }) {
  const par = window.__smmNom || user?.displayName || user?.nom || user?.email || "";
  const st = { meta: null, page: 1, filtre: "", edition: false, s: 1, tx: 0, ty: 0, couleur: "rouge", dernierCode: "", liste: false, sel: null,
    outil: "sel", tabType: "TD", tabNum: "", cptId: "", focus, caches: new Set((() => { try { return JSON.parse(localStorage.getItem("pc-caches") || "[]"); } catch { return []; } })()) };
  let compteursSite = [];
  import("./compteurs-data.js").then(m => m.listerTousLesCompteurs()).then(l => { compteursSite = (l || []).filter(c => c.dossierId === dossier.id).sort((a, b) => triCode(a.nom || "", b.nom || "")); if (st.edition) dessinerPanneau(); }).catch(() => {});
  const fond = document.createElement("div"); fond.className = "pc-fond";
  document.body.appendChild(fond); document.body.classList.add("pc-ouvert");
  if (!document.getElementById("pc-style")) document.head.insertAdjacentHTML("beforeend", STYLE);
  let unsub = () => {};
  const fermer = () => { unsub(); fond.remove(); document.body.classList.remove("pc-ouvert"); document.removeEventListener("keydown", clavier); };
  const clavier = (e) => { if (e.key === "Escape" && !e.target.closest?.("input,select,textarea")) { if (st.sel) { st.sel = null; dessinerReperes(); } else fermer(); } };
  document.addEventListener("keydown", clavier);

  const reperes = () => st.meta?.reperes || [];
  const masques = () => st.meta?.masques || [];
  const sauverMasques = async (liste, msg) => { st.meta.masques = liste; dessinerReperes(); if (st.edition) dessinerPanneau();
    try { await setDoc(refMeta(dossier.id), { masques: liste, majLe: Date.now(), majPar: par }, { merge: true }); if (msg) window.toast?.(msg); } catch (e) { alert("Enregistrement impossible : " + (e?.message || e)); } };
  const sauver = async (liste, msg) => {
    st.meta.reperes = liste; dessinerReperes(); dessinerBarre(); if (st.edition) dessinerPanneau();
    try { await setDoc(refMeta(dossier.id), { reperes: liste, majLe: Date.now(), majPar: par }, { merge: true }); if (msg) window.toast?.(msg); }
    catch (e) { alert("Enregistrement impossible : " + (e?.message || e)); }
  };
  const sauverPages = async (pages) => { st.meta.pages = pages; dessinerBarre(); try { await setDoc(refMeta(dossier.id), { pages, majLe: Date.now(), majPar: par }, { merge: true }); window.toast?.("✓ Page réglée"); } catch (e) { alert("Enregistrement impossible : " + (e?.message || e)); } };

  fond.innerHTML = `<div class="pc">
    <header class="pc-h"><b>🗺️ Plans — ${esc(nomSite(dossier.nom))}</b><span class="pc-maj"></span>
      <div class="pc-hb">${editeur ? `<label class="pc-btn">📄 Importer un plan PDF<input type="file" accept="application/pdf" hidden data-import></label>` : ""}<button class="pc-btn" data-fermer>✕ Fermer</button></div></header>
    <div class="pc-barre"></div>
    <div class="pc-corps"><div class="pc-vue"><div class="pc-scene"><div class="pc-ban"></div><img class="pc-img" alt=""><div class="pc-reps"></div><div class="pc-pied"></div></div><div class="pc-msg"></div></div><aside class="pc-liste" hidden></aside><aside class="pc-ed" hidden></aside></div>
  </div>`;
  const $ = (s) => fond.querySelector(s);
  const vue = $(".pc-vue"), scene = $(".pc-scene"), img = $(".pc-img"), reps = $(".pc-reps"), msg = $(".pc-msg");
  $("[data-fermer]").onclick = fermer;

  $("[data-import]")?.addEventListener("change", async (e) => {
    const f = e.target.files?.[0]; e.target.value = ""; if (!f) return;
    if (st.meta && !confirm(`Remplacer le plan actuel (${st.meta.pages.length} page${st.meta.pages.length > 1 ? "s" : ""}, ${reperes().length} repère${reperes().length > 1 ? "s" : ""}) par « ${f.name} » ?${reperes().length ? "\nLes repères seront repris des étiquettes du nouveau PDF." : ""}`)) return;
    msg.hidden = false; msg.textContent = "⏳ Import du plan…";
    try { const r = await importerPlanPdf(dossier, f, par, (t) => { msg.textContent = "⏳ " + t; }); st.page = 1; window.toast?.(`✓ Plan importé : ${r.pages} pages, ${r.reperes} repères de clés`); }
    catch (err) { console.error(err); alert("Import impossible : " + (err?.message || err)); }
    msg.hidden = true;
  });

  // ---- Barre : pages, filtres par type / clé, actions ----
  function dessinerBarre() {
    const b = $(".pc-barre"); if (!st.meta) { b.innerHTML = ""; return; }
    const tous = {}; reperes().filter(r => typeR(r) === "cle").forEach(r => { tous[r.c] = (tous[r.c] || 0) + 1; });
    const codes = Object.keys(tous).sort(triCode), nb = (t) => reperes().filter(r => typeR(r) === t).length;
    const parPage = (p) => reperes().filter(r => r.p === p && correspond(r, st.filtre)).length;
    const puce = (f, lib, n) => `<button class="pc-ty ${st.filtre === f ? "on" : ""}" data-f="${f}">${lib}${n !== undefined ? ` <i>${n}</i>` : ""}</button>`;
    b.innerHTML = `<div class="pc-pages">${st.meta.pages.map(p => { const n = parPage(p.n); return `<button class="pc-pg ${p.n === st.page ? "on" : ""} ${st.filtre && !n ? "vide" : ""}" data-page="${p.n}" title="${esc(p.titre)}">${esc(p.titre.replace(/^Plan (ensemble )?/i, "").replace(/^B[aâ]timent /i, "Bât. "))}${n ? `<i>${n}</i>` : ""}</button>`; }).join("")}</div>
      <div class="pc-outils">
        <div class="pc-tys">${puce("", "Tout")}${puce("__cle", "🔑 Clés", nb("cle"))}${nb("compteur") || st.edition ? puce("__cpt", "🎛️ Compteurs", nb("compteur")) : ""}${nb("tableau") || st.edition ? puce("__tab", "⚡ Tableaux", nb("tableau")) : ""}${nb("vanne") || st.edition ? puce("__van", "🚰 Vannes", nb("vanne")) : ""}${nb("logement") || st.edition ? puce("__log", "🏠 Logements", nb("logement")) : ""}</div>
        <div class="pc-yeux" title="Afficher / masquer un type de repère">${Object.keys(TYPES_R).filter(t => nb(t)).map(t => `<button data-oeil="${t}" class="${st.caches.has(t) ? "off" : ""}">${st.caches.has(t) ? "🚫" : "👁"} ${TYPES_R[t].ic}</button>`).join("")}</div>
        ${codes.length ? `<select data-filtre><option value="">🔑 Une clé…</option>${codes.map(c => `<option value="${esc(c)}" ${c === st.filtre ? "selected" : ""}>${esc(c)} — ${tous[c]} porte${tous[c] > 1 ? "s" : ""}</option>`).join("")}</select>` : ""}
        <button class="pc-btn" data-liste>${st.liste ? "✕ Liste" : "📋 Liste"}</button>
        ${groupesEtages(st.meta.pages).length ? `<button class="pc-btn p3-lance" data-3d>🧊 Vue 3D</button>` : ""}
        <button class="pc-btn" data-ajuster>⤢ Ajuster</button>
        <button class="pc-btn" data-imprimer title="Plans + liste, prêts à imprimer ou enregistrer en PDF">🖨️ Imprimer / PDF</button>
        ${editeur ? `<button class="pc-btn ${st.edition && st.outil === "masque" ? "edit" : ""}" data-gomme title="Trace un rectangle sur le plan pour l'effacer en blanc">⬜ Effacer une zone</button>` : ""}
        ${editeur ? `<button class="pc-btn ${st.edition ? "edit" : ""}" data-edition>${st.edition ? "✓ Terminer l'édition" : "✏️ Mode édition"}</button>` : ""}
      </div>`;
    b.querySelectorAll("[data-page]").forEach(x => x.onclick = () => allerPage(+x.dataset.page));
    b.querySelectorAll("[data-oeil]").forEach(x => x.onclick = () => { const t = x.dataset.oeil; st.caches.has(t) ? st.caches.delete(t) : st.caches.add(t); try { localStorage.setItem("pc-caches", JSON.stringify([...st.caches])); } catch { /* */ } majTout(); });
    b.querySelectorAll("[data-f]").forEach(x => x.onclick = () => { st.filtre = x.dataset.f; majTout(); });
    b.querySelector("[data-filtre]")?.addEventListener("change", (e) => { st.filtre = e.target.value; majTout(); });
    b.querySelector("[data-liste]").onclick = () => { st.liste = !st.liste; if (st.liste) basculerEdition(false); dessinerBarre(); dessinerListe(); };
    b.querySelector("[data-ajuster]").onclick = ajuster;
    b.querySelector("[data-3d]")?.addEventListener("click", async () => {
      const { ouvrirVue3D } = await import("./plan-3d.js");
      const m = st.meta.pdf?.morceaux;
      ouvrirVue3D({ titre: dossier.nom || "", groupes: groupesEtages(st.meta.pages), reperes: reperes(), masques: masques(), photos: photosEquipement, caches: [...st.caches], filtre: st.filtre, charger: imagePage,
        hd: m ? rendeurHD(dossier.id, m) : null, aPdf: !!m, textes: () => lireTextes(dossier.id),
        ajouterPdf: editeur ? async (f) => { await sauverPdfPlan(dossier.id, f); const s2 = await getDoc(refMeta(dossier.id)); return rendeurHD(dossier.id, s2.data()?.pdf?.morceaux || 1); } : null,
        onPlat: (n, f) => { st.filtre = f || ""; allerPage(n); dessinerListe(); } });
    });
    b.querySelector("[data-imprimer]").onclick = () => choixImpression();
    b.querySelector("[data-edition]")?.addEventListener("click", () => basculerEdition(!st.edition));
    b.querySelector("[data-gomme]")?.addEventListener("click", () => { if (st.edition && st.outil === "masque") { st.outil = "sel"; fond.classList.remove("pc-pose"); dessinerPanneau(); dessinerBarre(); return; }
      st.outil = "masque"; if (!st.edition) basculerEdition(true); else { dessinerPanneau(); dessinerBarre(); } fond.classList.add("pc-pose", "pc-gomme");
      window.toast?.("⬜ Fais glisser un rectangle sur la zone à effacer (clic sur une zone effacée = la remettre)"); });
  }
  const majTout = () => { dessinerReperes(); dessinerBarre(); dessinerListe(); };
  function basculerEdition(v) { st.edition = v; st.sel = null; if (v) st.liste = false; fond.classList.toggle("pc-edit", v); dessinerBarre(); dessinerListe(); dessinerPanneau(); dessinerReperes(); }

  function choixImpression() {
    const nb = (t) => reperes().filter(r => typeR(r) === t).length;
    const d = document.createElement("div"); d.className = "pc-dlg";
    d.innerHTML = `<div><b>🖨️ Imprimer / enregistrer en PDF</b><p>Les pages qui contiennent ces repères, en paysage, puis la liste complète.</p>
      ${[["__log", "🏠 Logements", nb("logement")], ["__van", "🚰 Vannes", nb("vanne")], ["__tab", "⚡ Tableaux électriques", nb("tableau")], ["__cpt", "🎛️ Compteurs", nb("compteur")], ["__cle", "🔑 Clés", nb("cle")], ...(st.filtre && !st.filtre.startsWith("__") ? [[st.filtre, `🔑 Clé ${st.filtre}`, reperes().filter(r => correspond(r, st.filtre)).length]] : []), ["", "Tous les repères", reperes().length]]
        .filter(x => x[2]).map(([f, l, n]) => `<button class="pc-btn" data-imp="${esc(f)}">${l} <i>${n}</i></button>`).join("")}
      <button class="pc-btn" data-x>Annuler</button></div>`;
    fond.appendChild(d);
    d.onclick = async (e) => { if (e.target === d || e.target.closest("[data-x]")) { d.remove(); return; } const b = e.target.closest("[data-imp]"); if (!b) return;
      b.textContent = "⏳ Préparation…"; try { await imprimerPlans({ dossier, meta: st.meta, filtre: b.dataset.imp, charger: imagePage }); } catch (err) { alert("Impression impossible : " + (err?.message || err)); } d.remove(); };
  }

  function dessinerListe() {
    const a = $(".pc-liste"); a.hidden = !st.liste; if (!st.liste) return;
    const titre = (n) => st.meta.pages.find(p => p.n === n)?.titre || `Page ${n}`;
    const groupes = [["logement", "🏠 Logements"], ["cle", "🔑 Clés"], ["tableau", "⚡ Tableaux électriques"], ["vanne", "🚰 Vannes"], ["compteur", "🎛️ Compteurs"]].map(([t, lib]) => {
      const m = {}; reperes().filter(r => typeR(r) === t).forEach(r => { (m[r.c] = m[r.c] || { n: 0, pages: {}, r }).n++; m[r.c].pages[r.p] = (m[r.c].pages[r.p] || 0) + 1; });
      return { t, lib, m };
    }).filter(g => Object.keys(g.m).length);
    a.innerHTML = groupes.map(g => `<h4>${g.lib} <small>${Object.keys(g.m).length}</small></h4>${Object.keys(g.m).sort(triCode).map(k => { const x = g.m[k];
      return `<div class="pc-li ${k === st.filtre ? "on" : ""}"><button data-code-l="${esc(k)}" data-type-l="${g.t}"><i style="background:${couleurR(x.r)}"></i><b>${esc(k)}</b><span>${g.t === "cle" ? `${x.n} porte${x.n > 1 ? "s" : ""}` : esc(x.r.note || "")}</span></button>
        <div>${Object.entries(x.pages).map(([p, n]) => `<a data-aller="${p}" data-code-a="${esc(k)}" data-type-a="${g.t}">${esc(titre(+p))}${g.t === "cle" ? ` (${n})` : ""}</a>`).join("")}</div></div>`; }).join("")}`).join("") || `<p class="pc-aidep">Aucun repère.</p>`;
    a.querySelectorAll("[data-code-l]").forEach(x => x.onclick = () => {
      if (x.dataset.typeL === "cle") { st.filtre = st.filtre === x.dataset.codeL ? "" : x.dataset.codeL; majTout(); return; }
      const r = reperes().find(y => typeR(y) === x.dataset.typeL && y.c === x.dataset.codeL); if (r) allerRepere(r.id); });
    a.querySelectorAll("[data-aller]").forEach(x => x.onclick = () => { if (x.dataset.typeA === "cle") { st.filtre = x.dataset.codeA; allerPage(+x.dataset.aller); dessinerListe(); }
      else { const r = reperes().find(y => typeR(y) === x.dataset.typeA && y.c === x.dataset.codeA && y.p === +x.dataset.aller); if (r) allerRepere(r.id); } });
  }

  // ---- Panneau du mode édition (comme une barre d'outils de traitement de texte) ----
  function dessinerPanneau() {
    const a = $(".pc-ed"); a.hidden = !st.edition; if (!st.edition || !st.meta) return;
    const p = st.meta.pages.find(x => x.n === st.page) || {}, ici = reperes().filter(r => r.p === st.page);
    if (!st.tabNum) st.tabNum = String(prochainNumero(reperes(), st.tabType));
    const places = new Set(reperes().filter(r => typeR(r) === "compteur").map(r => r.cptId));
    const bats = [...new Set(st.meta.pages.map(x => x.batiment).filter(Boolean))];
    const nivAuto = niveauDe(p.titre || "");
    const outil = (id, ic, lib) => `<button class="pc-to ${st.outil === id ? "on" : ""}" data-outil="${id}"><span>${ic}</span>${lib}</button>`;
    a.innerHTML = `<h4>✏️ Mode édition</h4>
      <div class="pc-tos">${outil("sel", "✋", "Sélection")}${outil("cle", "🔑", "Clé")}${outil("compteur", "🎛️", "Compteur")}${outil("tableau", "⚡", "Tableau élec.")}${outil("vanne", "🚰", "Vanne")}${outil("logement", "🏠", "Logement")}${outil("masque", "⬜", "Masquer une zone")}</div>
      <div class="pc-opt">${st.outil === "sel" ? `<p class="pc-aidep">Clique sur une vignette pour la modifier, ou fais-la glisser pour la déplacer.</p>`
        : st.outil === "masque" ? `<p class="pc-aidep">👉 Fais glisser sur le plan pour cacher une zone en blanc (cartouche, logo, mention…). Clique sur une zone cachée pour la retirer.</p>
          <button class="pc-btn" data-cartouche style="white-space:normal;text-align:left">🧹 Masquer le cartouche de l'architecte (toutes les pages)</button>`
        : st.outil === "cle" ? `<label>Numéro de clé<input data-code value="${esc(st.dernierCode)}" placeholder="ex. MV10"></label><div class="pc-pcol">${Object.keys(COULEURS).map(c => `<button class="pc-col ${c === st.couleur ? "on" : ""}" data-col="${c}" style="--k:${COULEURS[c]}" title="${c}"></button>`).join("")}</div><p class="pc-aidep">👉 Clique sur le plan pour poser la clé.</p>`
        : st.outil === "compteur" ? (compteursSite.length ? `<label>Compteur du site<select data-cpt>${compteursSite.map(c => `<option value="${esc(c.id)}" ${c.id === st.cptId ? "selected" : ""}>${places.has(c.id) ? "✓ " : ""}${esc(c.nom || "")}</option>`).join("")}</select></label><p class="pc-aidep">👉 Clique sur le plan à l'endroit du compteur. ✓ = déjà placé.</p>` : `<p class="pc-aidep">Aucun compteur enregistré sur ce site (tuile Relevé compteur).</p>`)
        : st.outil === "vanne" ? `<label>Nom de la vanne<input data-vannom value="${esc(st.vanNom || `V${1 + Math.max(0, ...reperes().filter(x => typeR(x) === "vanne").map(x => parseInt(String(x.c).replace(/\D/g, ""), 10) || 0))}`)}" placeholder="ex. V1, Vanne gaz"></label><p class="pc-aidep">👉 Clique sur le plan : le numéro suivant est ensuite proposé.</p>`
        : st.outil === "logement" ? `<label>N° du logement<input data-lognum value="${esc(st.logNum || String(1 + Math.max(0, ...reperes().filter(x => typeR(x) === "logement").map(x => parseInt(x.c, 10) || 0))))}" inputmode="numeric"></label><p class="pc-aidep">👉 Clique au centre du logement : le numéro suivant est ensuite proposé.</p>`
        : `<div class="pc-2"><label>Type<select data-tabtype>${TYPES_TABLEAU.map(t => `<option ${t === st.tabType ? "selected" : ""}>${t}</option>`).join("")}</select></label><label>Numéro<input data-tabnum value="${esc(st.tabNum)}" inputmode="numeric"></label></div><p class="pc-aidep">👉 Clique sur le plan : <b>${esc(st.tabType)} ${esc(st.tabNum)}</b> sera posé, puis le numéro suivant est proposé.</p>`}</div>
      <h5>📄 Cette page</h5>
      <label>Bâtiment<input data-bat list="pc-bats" value="${esc(p.batiment || "")}" placeholder="auto (d'après le titre)"><datalist id="pc-bats">${bats.map(x => `<option value="${esc(x)}">`).join("")}</datalist></label>
      <label>Niveau (pour la 3D)<select data-niv><option value="">Auto${nivAuto !== null ? ` (${nomNiveau(nivAuto)})` : " (non détecté)"}</option>${NIVEAUX.map(([n, l]) => `<option value="${n}" ${String(p.niveauManuel) === String(n) ? "selected" : ""}>${l}</option>`).join("")}<option value="x" ${p.niveauManuel === "x" ? "selected" : ""}>Pas un étage (plan masse…)</option></select></label>
      <h5>📍 Sur cette page <small>${ici.length}</small></h5>
      <div class="pc-edl">${ici.slice().sort((x, y) => typeR(x).localeCompare(typeR(y)) || triCode(x.c, y.c)).map(r => `<div><button data-voir-r="${r.id}"><i style="background:${couleurR(r)}"></i>${esc(libR(r))}</button><button data-sup-r="${r.id}" title="Supprimer">🗑️</button></div>`).join("") || `<p class="pc-aidep">Rien sur cette page.</p>`}</div>
      <button class="pc-btn edit" data-fin>✓ Terminer l'édition</button>`;
    a.querySelectorAll("[data-outil]").forEach(x => x.onclick = () => { st.outil = x.dataset.outil; fond.classList.toggle("pc-gomme", st.outil === "masque"); dessinerBarre(); if (st.outil === "compteur" && !st.cptId) st.cptId = compteursSite.find(c => !places.has(c.id))?.id || compteursSite[0]?.id || ""; fond.classList.toggle("pc-pose", st.outil !== "sel"); dessinerPanneau(); });
    a.querySelector("[data-code]")?.addEventListener("input", (e) => { st.dernierCode = e.target.value.trim(); });
    a.querySelectorAll("[data-col]").forEach(x => x.onclick = () => { st.couleur = x.dataset.col; dessinerPanneau(); });
    a.querySelector("[data-cpt]")?.addEventListener("change", (e) => { st.cptId = e.target.value; });
    a.querySelector("[data-tabtype]")?.addEventListener("change", (e) => { st.tabType = e.target.value; st.tabNum = String(prochainNumero(reperes(), st.tabType)); dessinerPanneau(); });
    a.querySelector("[data-vannom]")?.addEventListener("input", (e) => { st.vanNom = e.target.value.trim(); });
    a.querySelector("[data-lognum]")?.addEventListener("input", (e) => { st.logNum = e.target.value.trim(); });
    a.querySelector("[data-tabnum]")?.addEventListener("input", (e) => { st.tabNum = e.target.value.trim(); });
    a.querySelector("[data-bat]").addEventListener("change", (e) => sauverPages(st.meta.pages.map(x => x.n === st.page ? { ...x, batiment: e.target.value.trim() } : x)));
    a.querySelector("[data-niv]").addEventListener("change", (e) => sauverPages(st.meta.pages.map(x => x.n === st.page ? { ...x, niveauManuel: e.target.value } : x)));
    a.querySelectorAll("[data-voir-r]").forEach(x => x.onclick = () => allerRepere(x.dataset.voirR));
    a.querySelectorAll("[data-sup-r]").forEach(x => x.onclick = () => { const r = reperes().find(y => y.id === x.dataset.supR); if (r && confirm(`Supprimer ${libR(r)} ?`)) sauver(reperes().filter(y => y.id !== r.id), `${r.c} supprimé`); });
    a.querySelector("[data-fin]").onclick = () => basculerEdition(false);
    a.querySelector("[data-cartouche]")?.addEventListener("click", () => {
      // Cartouche « michel joyau + agence » en bas à droite des plans en paysage (portrait : bandeau du bas).
      const nv = st.meta.pages.filter(p => !masques().some(m => m.p === p.n && m.auto)).map(p => p.w >= p.h ? { id: uid(), p: p.n, x: 0.835, y: 0.885, w: 0.145, h: 0.07, auto: true } : { id: uid(), p: p.n, x: 0.6, y: 0.93, w: 0.38, h: 0.06, auto: true });
      if (!nv.length) { window.toast?.("Cartouche déjà masqué sur toutes les pages."); return; }
      sauverMasques([...masques(), ...nv], `🧹 Cartouche masqué sur ${nv.length} page${nv.length > 1 ? "s" : ""} — ajuste ou ajoute des zones si besoin`); });
  }
  function poser(x, y) {
    const base = { id: uid(), p: st.page, x, y, note: "" };
    if (st.outil === "cle") { const code = (st.dernierCode || "").trim(); if (!code) { window.toast?.("Indique d'abord le numéro de la clé (panneau à droite)."); return; }
      sauver([...reperes(), { ...base, t: "cle", c: code, col: st.couleur }], `✓ Clé ${code} posée`); return; }
    if (st.outil === "compteur") { const c = compteursSite.find(k => k.id === st.cptId); if (!c) { window.toast?.("Choisis d'abord le compteur (panneau à droite)."); return; }
      const deja = reperes().find(r => typeR(r) === "compteur" && r.cptId === c.id);
      if (deja && !confirm(`« ${c.nom} » est déjà placé sur le plan. Le déplacer ici ?`)) return;
      const liste = deja ? reperes().filter(r => r.id !== deja.id) : reperes();
      const places = new Set([...liste.filter(r => typeR(r) === "compteur").map(r => r.cptId), c.id]);
      st.cptId = compteursSite.find(k => !places.has(k.id))?.id || st.cptId;
      sauver([...liste, { ...base, t: "compteur", c: c.nom || "Compteur", cptId: c.id, cptType: c.type || "" }], `✓ Compteur « ${c.nom} » placé`); return; }
    if (st.outil === "vanne") { const c = (st.vanNom || `V${1 + Math.max(0, ...reperes().filter(x => typeR(x) === "vanne").map(x => parseInt(String(x.c).replace(/\D/g, ""), 10) || 0))}`).trim(); if (!c) return;
      const m = c.match(/^(.*?)(\d+)$/); st.vanNom = m ? `${m[1]}${+m[2] + 1}` : ""; sauver([...reperes(), { ...base, t: "vanne", c }], `✓ Vanne ${c} posée`); return; }
    if (st.outil === "logement") { const c = (st.logNum || String(1 + Math.max(0, ...reperes().filter(x => typeR(x) === "logement").map(x => parseInt(x.c, 10) || 0)))).trim(); if (!c) return;
      if (reperes().some(x => typeR(x) === "logement" && x.c === c) && !confirm(`Le logement ${c} existe déjà. En poser un autre ?`)) return;
      st.logNum = String((parseInt(c, 10) || 0) + 1); sauver([...reperes(), { ...base, t: "logement", c }], `✓ Logement ${c} posé`); return; }
    if (st.outil === "tableau") { const num = String(st.tabNum || "").trim(), c = `${st.tabType}${num ? " " + num : ""}`;
      if (reperes().some(r => typeR(r) === "tableau" && r.c === c) && !confirm(`${c} existe déjà sur ce site. En créer un autre quand même ?`)) return;
      st.tabNum = String((parseInt(num, 10) || 0) + 1);
      sauver([...reperes(), { ...base, t: "tableau", c, tabType: st.tabType, num }], `✓ ${c} posé`); }
  }

  // ---- Page / image / zoom ----
  async function allerPage(n) {
    st.page = n; st.sel = null; dessinerBarre(); if (st.edition) dessinerPanneau();
    const p = st.meta.pages.find(x => x.n === n); if (!p) return;
    img.style.width = p.w + "px"; img.style.height = p.h + "px"; scene.style.width = p.w + "px"; scene.style.height = p.h + "px";
    // Mise en page Groupe Établières / AppSMM autour du plan (comme à l'impression).
    scene.style.setProperty("--u", (p.w / 100) + "px");
    $(".pc-ban").innerHTML = `<img src="${new URL("img/logo-etablieres.png", document.baseURI).href}" alt=""><div><b>${esc(nomSite(dossier.nom))}</b><small>${esc(p.titre || "")}</small></div><div class="app"><b>AppSMM</b><small>Service Maintenance &amp; Ménage · Groupe Établières</small></div>`;
    $(".pc-pied").innerHTML = `<span>Plans · repères clés, compteurs, tableaux</span><span>${st.meta.majLe ? `Mis à jour le ${new Date(st.meta.majLe).toLocaleDateString("fr-FR")}` : ""}</span><span>Page ${st.meta.pages.findIndex(x => x.n === n) + 1} / ${st.meta.pages.length}</span>`;
    const cle = `${dossier.id}-${n}`;
    if (!cacheImages.has(cle)) { msg.hidden = false; msg.textContent = "⏳ Chargement de la page…"; img.removeAttribute("src");
      try { await imagePage(n); } catch (e) { msg.textContent = "Page indisponible : " + (e?.message || e); return; } }
    if (st.page !== n) return;
    img.src = cacheImages.get(cle) || ""; msg.hidden = true;
    ajuster(); dessinerReperes();
  }
  async function allerRepere(id) {
    const r = reperes().find(x => x.id === id); if (!r) return;
    if (st.page !== r.p) await allerPage(r.p);
    const p = st.meta.pages.find(x => x.n === r.p); const W = vue.clientWidth, H = vue.clientHeight;
    st.s = Math.min(W / p.w, H / p.h) * 2.4; st.tx = W / 2 - r.x * p.w * st.s; st.ty = H / 2 - r.y * p.h * st.s; appliquer();
    st.sel = id; dessinerReperes();
  }
  async function imagePage(n) {
    const cle = `${dossier.id}-${n}`;
    if (!cacheImages.has(cle)) { const s = await getDoc(refPage(dossier.id, n)); cacheImages.set(cle, s.exists() ? s.data().data : ""); }
    return cacheImages.get(cle);
  }
  function appliquer() { scene.style.transform = `translate(${st.tx}px,${st.ty}px) scale(${st.s})`; scene.style.setProperty("--inv", String(Math.max(1, 9.5 / (17 * st.s)))); }
  function ajuster() {
    const p = st.meta?.pages.find(x => x.n === st.page); if (!p) return;
    const W = vue.clientWidth, H = vue.clientHeight, hb = p.w * 0.06, hp = p.w * 0.03, Ht = p.h + hb + hp;
    st.s = Math.min(W / p.w, H / Ht) * 0.97; st.tx = (W - p.w * st.s) / 2; st.ty = (H - Ht * st.s) / 2 + hb * st.s; appliquer();
  }
  function zoomer(f, cx, cy) {
    const s2 = Math.max(0.05, Math.min(4, st.s * f)), k = s2 / st.s;
    st.tx = cx - (cx - st.tx) * k; st.ty = cy - (cy - st.ty) * k; st.s = s2; appliquer();
  }
  // Molette ET pavé tactile (pincement = ctrl + petites valeurs) : zoom progressif, proportionnel au geste.
  vue.addEventListener("wheel", (e) => { e.preventDefault(); const r = vue.getBoundingClientRect(), d = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1);
    zoomer(Math.exp(-Math.max(-300, Math.min(300, d)) * (e.ctrlKey ? 0.012 : 0.0018)), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
  const pointeurs = new Map(); let geste = null;
  vue.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".pc-pop")) return;
    vue.setPointerCapture(e.pointerId); pointeurs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const rep = e.target.closest(".pc-m");
    if (pointeurs.size === 2) { const [a, b] = [...pointeurs.values()]; geste = { type: "pinch", d: Math.hypot(a.x - b.x, a.y - b.y) }; return; }
    if (st.edition && st.outil === "masque") { const mk = e.target.closest(".pc-mask"); const [x, y] = versPlan(e);
      geste = { type: "masque", x0: e.clientX, y0: e.clientY, fx: x, fy: y, bouge: false, suppr: mk?.dataset.mask }; return; }
    geste = rep && st.edition ? { type: "rep", id: rep.dataset.id, x0: e.clientX, y0: e.clientY, bouge: false } : { type: "pan", x0: e.clientX, y0: e.clientY, tx: st.tx, ty: st.ty, bouge: false, rep: rep?.dataset.id };
  });
  vue.addEventListener("pointermove", (e) => {
    if (!pointeurs.has(e.pointerId) || !geste) return; pointeurs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (geste.type === "pinch" && pointeurs.size === 2) { const [a, b] = [...pointeurs.values()], d = Math.hypot(a.x - b.x, a.y - b.y), r = vue.getBoundingClientRect(); zoomer(d / geste.d, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top); geste.d = d; return; }
    const dx = e.clientX - geste.x0, dy = e.clientY - geste.y0; if (Math.abs(dx) + Math.abs(dy) > 4) geste.bouge = true;
    if (geste.type === "pan") { st.tx = geste.tx + dx; st.ty = geste.ty + dy; appliquer(); }
    else if (geste.type === "masque" && geste.bouge) { const [x, y] = versPlan(e); let el = reps.querySelector(".pc-mask.trace"); if (!el) { el = document.createElement("div"); el.className = "pc-mask trace"; reps.appendChild(el); }
      Object.assign(el.style, { left: Math.min(x, geste.fx) * 100 + "%", top: Math.min(y, geste.fy) * 100 + "%", width: Math.abs(x - geste.fx) * 100 + "%", height: Math.abs(y - geste.fy) * 100 + "%" }); }
    else if (geste.type === "rep" && geste.bouge) { const el = reps.querySelector(`[data-id="${geste.id}"]`); const [x, y] = versPlan(e); if (el) { el.style.left = x * 100 + "%"; el.style.top = y * 100 + "%"; } }
  });
  const fin = (e) => {
    if (!pointeurs.has(e.pointerId)) return; pointeurs.delete(e.pointerId);
    const g = geste; if (pointeurs.size) { geste = null; return; } geste = null; if (!g || g.type === "pinch") return;
    if (g.type === "masque") {
      if (!g.bouge) { if (g.suppr && confirm("Retirer ce masque ? La zone redevient visible.")) sauverMasques(masques().filter(m => m.id !== g.suppr), "Zone de nouveau visible"); return; }
      const [x, y] = versPlan(e), m = { id: uid(), p: st.page, x: +Math.max(0, Math.min(x, g.fx)).toFixed(4), y: +Math.max(0, Math.min(y, g.fy)).toFixed(4), w: +Math.abs(x - g.fx).toFixed(4), h: +Math.abs(y - g.fy).toFixed(4) };
      if (m.w > 0.005 && m.h > 0.005) sauverMasques([...masques(), m], "⬜ Zone masquée"); else dessinerReperes(); return;
    }
    if (g.type === "rep") {
      if (g.bouge) { const [x, y] = versPlan(e); sauver(reperes().map(r => r.id === g.id ? { ...r, x, y } : r)); }
      else { st.sel = g.id; dessinerReperes(); }
      return;
    }
    if (g.bouge) return;
    if (g.rep) { st.sel = g.rep; dessinerReperes(); return; }
    if (st.sel) { st.sel = null; dessinerReperes(); return; }
    if (st.edition && st.outil !== "sel") { const [x, y] = versPlan(e); if (x < 0 || y < 0 || x > 1 || y > 1) return; poser(x, y); }
  };
  vue.addEventListener("pointerup", fin); vue.addEventListener("pointercancel", fin);
  function versPlan(e) { const r = scene.getBoundingClientRect(); return [+((e.clientX - r.left) / r.width).toFixed(5), +((e.clientY - r.top) / r.height).toFixed(5)]; }

  function dessinerReperes() {
    const liste = reperes().filter(r => r.p === st.page && !st.caches.has(typeR(r)));
    const mk = masques().filter(m => m.p === st.page).map(m => `<div class="pc-mask" data-mask="${m.id}" style="left:${m.x * 100}%;top:${m.y * 100}%;width:${m.w * 100}%;height:${m.h * 100}%"></div>`).join("");
    reps.innerHTML = mk + liste.map(r => { const on = st.filtre && correspond(r, st.filtre);
      return `<div class="pc-m t-${typeR(r)} ${st.filtre && !on ? "terne" : ""} ${on && !st.filtre.startsWith("__") ? "fort" : ""} ${st.sel === r.id ? "sel" : ""}" data-id="${r.id}" style="left:${r.x * 100}%;top:${r.y * 100}%;--k:${couleurR(r)}" title="${esc(libR(r))}${r.note ? " — " + esc(r.note) : ""}">${esc(libR(r))}</div>`; }).join("");
    const sel = liste.find(r => r.id === st.sel); fond.querySelector(".pc-pop")?.remove();
    if (!sel) return;
    const t = typeR(sel), pop = document.createElement("div"); pop.className = "pc-pop";
    const photosHTML = t === "tableau" || t === "vanne" ? `<div class="pc-ph" data-ph><small>⏳ photos…</small></div><div class="pc-2"><label class="pc-btn">📸 Prendre une photo<input type="file" accept="image/*" capture="environment" hidden data-ph-add></label><label class="pc-btn">🖼️ Choisir des photos<input type="file" accept="image/*" multiple hidden data-ph-add></label></div>` : "";
    if (st.edition) {
      pop.innerHTML = `<b>${TYPES_R[t].ic} ${TYPES_R[t].lib}</b>
        ${["cle", "vanne", "logement"].includes(t) ? `<label>${t === "vanne" ? "Nom" : "Numéro"} <input data-c value="${esc(sel.c)}"></label>` : ""}
        ${t === "tableau" ? `<div class="pc-2"><label>Type<select data-tt>${TYPES_TABLEAU.map(x => `<option ${x === sel.tabType ? "selected" : ""}>${x}</option>`).join("")}</select></label><label>Numéro<input data-tn value="${esc(sel.num || "")}"></label></div>` : ""}
        ${t === "compteur" ? `<label>Compteur<select data-tc>${compteursSite.map(c => `<option value="${esc(c.id)}" ${c.id === sel.cptId ? "selected" : ""}>${esc(c.nom || "")}</option>`).join("") || `<option>${esc(sel.c)}</option>`}</select></label>` : ""}
        <label>${t === "cle" ? "Porte / local" : "Emplacement / note"} <input data-n value="${esc(sel.note || "")}" placeholder="${t === "tableau" ? "ex. local technique R+1" : "ex. bureau directeur"}"></label>
        ${t === "cle" ? `<div class="pc-pcol">${Object.keys(COULEURS).map(c => `<button class="pc-col ${c === (sel.col || "rouge") ? "on" : ""}" data-col="${c}" style="--k:${COULEURS[c]}"></button>`).join("")}</div>` : ""}
        ${photosHTML}
        <div class="pc-pb"><button class="pc-btn rouge" data-suppr>🗑️ Supprimer</button><button class="pc-btn" data-ok>✓ OK</button></div>`;
    } else {
      pop.innerHTML = `<b style="color:${couleurR(sel)}">${t === "cle" ? "🔑 " : ""}${esc(libR(sel))}</b>${sel.note ? `<span>${esc(sel.note)}</span>` : ""}
        ${t === "cle" ? `<span>${reperes().filter(r => typeR(r) === "cle" && r.c === sel.c).length} porte(s) avec cette clé sur le site</span><div class="pc-pb"><button class="pc-btn" data-voir>Voir toutes ses portes</button></div>` : ""}
        ${t === "compteur" ? `<div class="pc-pb"><button class="pc-btn" data-relever>📷 Relever ce compteur</button></div>` : ""}
        ${t === "tableau" || t === "vanne" ? photosHTML : ""}`;
    }
    fond.querySelector(".pc-vue").appendChild(pop);
    const el = reps.querySelector(`[data-id="${sel.id}"]`), rv = vue.getBoundingClientRect(), re = el.getBoundingClientRect();
    pop.style.left = Math.min(rv.width - 270, Math.max(8, re.left - rv.left - 20)) + "px"; pop.style.top = Math.min(rv.height - 300, re.bottom - rv.top + 8) + "px";
    let col = sel.col || "rouge";
    pop.querySelectorAll("[data-col]").forEach(x => x.onclick = () => { col = x.dataset.col; pop.querySelectorAll("[data-col]").forEach(y => y.classList.toggle("on", y === x)); });
    pop.querySelector("[data-ok]")?.addEventListener("click", () => {
      const note = pop.querySelector("[data-n]").value.trim(); let maj = { note };
      if (t === "cle") { const c = pop.querySelector("[data-c]").value.trim(); if (!c) return; st.dernierCode = c; maj = { ...maj, c, col }; }
      if (t === "vanne" || t === "logement") { const c = pop.querySelector("[data-c]").value.trim(); if (!c) return; maj = { ...maj, c }; }
      if (t === "tableau") { const tabType = pop.querySelector("[data-tt]").value, num = pop.querySelector("[data-tn]").value.trim(); maj = { ...maj, tabType, num, c: `${tabType}${num ? " " + num : ""}` }; }
      if (t === "compteur") { const c = compteursSite.find(k => k.id === pop.querySelector("[data-tc]").value); if (c) maj = { ...maj, cptId: c.id, c: c.nom || sel.c, cptType: c.type || "" }; }
      st.sel = null; sauver(reperes().map(r => r.id === sel.id ? { ...r, ...maj } : r), "✓ Modifié"); });
    pop.querySelector("[data-c]")?.addEventListener("keydown", (e) => { if (e.key === "Enter") pop.querySelector("[data-ok]").click(); });
    pop.querySelector("[data-suppr]")?.addEventListener("click", () => { if (!confirm(`Supprimer ${libR(sel)} ?`)) return; st.sel = null; sauver(reperes().filter(r => r.id !== sel.id), `${sel.c} supprimé`); });
    pop.querySelector("[data-voir]")?.addEventListener("click", () => { st.filtre = sel.c; st.sel = null; st.liste = true; majTout(); });
    pop.querySelector("[data-relever]")?.addEventListener("click", () => { window.compteurRelevDeepLinkId = sel.cptId; fermer(); if (!window.__allerCategorie?.("compteurs")) { window.compteurRelevDeepLinkId = null; window.toast?.("Le relevé n'est pas accessible avec ce compte."); } });
    const boite = pop.querySelector("[data-ph]");
    if (boite) {
      const charger = async () => { try { const l = await photosEquipement(sel.id); boite.innerHTML = l.length ? l.map((p, i) => `<img src="${p.data}" data-i="${i}" alt="">`).join("") : `<small>Pas encore de photo.</small>`;
        boite.querySelectorAll("img").forEach(im => im.onclick = async () => { const { voirPhotos } = await import("./demandes-photos.js"); voirPhotos(l, +im.dataset.i); }); } catch (e) { boite.innerHTML = `<small>Photos indisponibles</small>`; } };
      charger();
      pop.querySelectorAll("[data-ph-add]").forEach(inp => inp.addEventListener("change", async (e) => { const fs = [...(e.target.files || [])]; e.target.value = ""; if (!fs.length) return;
        let ok = 0; for (const [i, f] of fs.entries()) { boite.innerHTML = `<small>⏳ envoi ${i + 1} / ${fs.length}…</small>`;
          try { await ajouterPhotoEquipement(dossier.id, sel.id, f, par); ok++; } catch (err) { alert(`Photo « ${f.name} » non enregistrée : ` + (err?.message || err)); } }
        if (ok) window.toast?.(ok > 1 ? `📸 ${ok} photos ajoutées` : "📸 Photo ajoutée"); charger(); }));
    }
  }

  window.addEventListener("resize", () => { if (document.body.contains(fond)) ajuster(); });
  msg.textContent = "⏳ Chargement du plan…";
  unsub = onSnapshot(refMeta(dossier.id), (s) => {
    const premier = !st.meta;
    st.meta = s.exists() ? s.data() : null;
    if (!st.meta || !(st.meta.pages || []).length) {
      st.meta = null; dessinerBarre(); reps.innerHTML = ""; img.removeAttribute("src"); msg.hidden = false;
      msg.innerHTML = editeur ? `<div class="pc-vide"><b>Aucun plan pour ce site.</b><p>Importe le plan PDF de l'architecte : chaque page devient une image, les étiquettes (MV10, MV11…) deviennent des repères de clés, puis le mode édition permet d'ajouter compteurs et tableaux électriques.</p><label class="pc-btn grand">📄 Importer un plan PDF<input type="file" accept="application/pdf" hidden data-import2></label></div>` : `<div class="pc-vide"><b>Aucun plan pour ce site.</b></div>`;
      msg.querySelector("[data-import2]")?.addEventListener("change", (e) => { const i = $("[data-import]"); const dt = new DataTransfer(); if (e.target.files[0]) dt.items.add(e.target.files[0]); i.files = dt.files; i.dispatchEvent(new Event("change")); });
      return;
    }
    $(".pc-maj").textContent = st.meta.majLe ? `mis à jour le ${new Date(st.meta.majLe).toLocaleDateString("fr-FR")}${st.meta.majPar ? ` par ${st.meta.majPar}` : ""}` : "";
    if (!st.meta.pages.some(p => p.n === st.page)) st.page = st.meta.pages[0].n;
    dessinerBarre(); dessinerListe(); if (st.edition) dessinerPanneau();
    if (premier && st.focus?.repId) { const r = reperes().find(x => x.id === st.focus.repId); if (r) { st.page = r.p; allerPage(r.p).then(() => allerRepere(r.id)); return; } }
    if (premier && st.focus?.filtre) st.filtre = st.focus.filtre;
    if (premier || !img.src) allerPage(st.page); else dessinerReperes();
  }, (e) => { msg.textContent = "Plan indisponible : " + (e?.message || e); });
}

const STYLE = `<style id="pc-style">
body.pc-ouvert{overflow:hidden}
.pc-fond{position:fixed;inset:0;z-index:6000;background:rgba(10,14,22,.6);display:flex}
.pc{flex:1;margin:10px;background:var(--panel,#fff);color:var(--text,#111);border-radius:14px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.4)}
.pc-h{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--border,#ddd);flex-wrap:wrap}.pc-h b{font-size:16px}.pc-maj{font-size:12px;color:var(--text-dim,#666)}.pc-hb{margin-left:auto;display:flex;gap:6px}
.pc-btn{display:inline-flex;align-items:center;gap:5px;background:var(--panel-alt,#f2f4f7);color:var(--text,#111);border:1px solid var(--border,#ccc);border-radius:9px;padding:6px 11px;font:inherit;font-size:13px;cursor:pointer;white-space:nowrap}
.pc-btn:hover{filter:brightness(1.06)}.pc-btn.p3-lance{background:linear-gradient(135deg,#0b3a5c,#0f6a8f);color:#dff6ff;border-color:#2fa8d8;box-shadow:0 0 12px rgba(47,168,216,.45)}.pc-btn.edit{background:#1565d8;color:#fff;border-color:#1565d8}.pc-btn.rouge{color:#d11f1f}.pc-btn.grand{font-size:15px;padding:10px 16px;margin-top:10px}
.pc-barre{padding:8px 14px;border-bottom:1px solid var(--border,#ddd);display:flex;flex-direction:column;gap:7px}
.pc-pages{display:flex;gap:5px;overflow-x:auto;padding-bottom:3px;scrollbar-width:thin}
.pc-pg{flex:none;background:none;border:1px solid var(--border,#ccc);border-radius:99px;padding:4px 11px;font:inherit;font-size:12.5px;color:var(--text,#111);cursor:pointer;display:flex;align-items:center;gap:6px}
.pc-pg.on{background:#d11f1f;border-color:#d11f1f;color:#fff}.pc-pg.vide{opacity:.4}.pc-pg i{font-style:normal;font-size:11px;background:rgba(209,31,31,.14);color:#d11f1f;border-radius:99px;padding:0 6px;font-weight:700}.pc-pg.on i{background:#fff}
.pc-outils{display:flex;gap:6px;flex-wrap:wrap;align-items:center}.pc-outils select{font:inherit;font-size:13px;padding:6px 8px;border-radius:9px;border:1px solid var(--border,#ccc);background:var(--panel,#fff);color:var(--text,#111);max-width:260px}
.pc-aide{margin:0;font-size:12.5px;color:var(--text-dim,#555);display:flex;align-items:center;gap:6px;flex-wrap:wrap}.pc-aide input{font:inherit;font-size:13px;padding:3px 6px;border-radius:6px;border:1px solid var(--border,#ccc);width:80px}
.pc-col{width:20px;height:20px;border-radius:50%;background:var(--k);border:2px solid transparent;cursor:pointer;padding:0}.pc-col.on{border-color:var(--text,#111);box-shadow:0 0 0 2px var(--panel,#fff) inset}
.pc-corps{flex:1;display:flex;min-height:0}
.pc-vue{flex:1;position:relative;overflow:hidden;background:#e9ecf1;touch-action:none;cursor:grab}.pc-vue:active{cursor:grabbing}.pc-fond.pc-edit .pc-vue{cursor:crosshair}
.pc-scene{position:absolute;left:0;top:0;transform-origin:0 0;--inv:1}.pc-img{display:block;user-select:none;-webkit-user-drag:none;pointer-events:none;background:#fff;box-shadow:0 4px 20px rgba(0,0,0,.15)}
.pc-reps{position:absolute;inset:0}
.pc-m{position:absolute;transform:translate(-50%,-50%) scale(var(--inv));transform-origin:center;background:rgba(255,255,255,.93);color:var(--k);border:2px solid var(--k);border-radius:5px;padding:0 5px;font:700 17px/1.2 system-ui,sans-serif;white-space:nowrap;cursor:pointer;user-select:none;box-shadow:0 1px 3px rgba(0,0,0,.25)}
.pc-m.terne{opacity:.22}.pc-m.fort{background:var(--k);color:#fff;z-index:2;box-shadow:0 0 0 4px color-mix(in srgb,var(--k) 35%,transparent)}.pc-m.sel{outline:3px solid #111;z-index:3}
.pc-fond.pc-edit .pc-m{cursor:move}
.pc-msg{position:absolute;inset:0;display:grid;place-items:center;font-size:15px;color:#333;pointer-events:none}.pc-msg[hidden]{display:none}.pc-vide{pointer-events:auto;background:#fff;padding:22px;border-radius:14px;max-width:460px;text-align:center;box-shadow:0 8px 30px rgba(0,0,0,.15)}.pc-vide p{font-size:13.5px;color:#555}
.pc-pop{position:absolute;z-index:10;width:240px;background:var(--panel,#fff);color:var(--text,#111);border:1px solid var(--border,#ccc);border-radius:12px;padding:12px;box-shadow:0 12px 30px rgba(0,0,0,.25);display:flex;flex-direction:column;gap:7px;font-size:13px;cursor:default}
.pc-pop label{display:flex;flex-direction:column;gap:2px;font-size:12px;color:var(--text-dim,#555)}.pc-pop input{font:inherit;font-size:14px;padding:5px 7px;border-radius:7px;border:1px solid var(--border,#ccc);background:var(--panel,#fff);color:var(--text,#111)}
.pc-pop span{color:var(--text-dim,#555)}.pc-pcol{display:flex;gap:6px}.pc-pb{display:flex;gap:6px;justify-content:space-between}
.pc-liste{width:290px;flex:none;border-left:1px solid var(--border,#ddd);overflow:auto;padding:10px 12px;font-size:13px}.pc-liste h4{margin:0 0 8px;font-size:13.5px}
.pc-li{border-bottom:1px solid var(--border,#eee);padding:6px 0}.pc-li.on{background:color-mix(in srgb,#d11f1f 8%,transparent)}
.pc-li button{all:unset;cursor:pointer;display:flex;align-items:center;gap:7px;width:100%}.pc-li button i{width:10px;height:10px;border-radius:3px}.pc-li button span{margin-left:auto;color:var(--text-dim,#555);font-size:12px}
.pc-li div{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}.pc-li a{font-size:11.5px;color:#1565d8;cursor:pointer;background:rgba(21,101,216,.08);border-radius:6px;padding:1px 6px}
@media (max-width:700px){.pc{margin:0;border-radius:0}.pc-liste{position:absolute;right:0;top:0;bottom:0;background:var(--panel,#fff);z-index:5;width:85%}.pc-corps{position:relative}.pc-h b{font-size:14px}}
.pc-tys{display:flex;gap:4px;flex-wrap:wrap}.pc-ty{font:inherit;font-size:12.5px;padding:5px 10px;border-radius:99px;border:1px solid var(--border,#ccc);background:none;color:var(--text,#111);cursor:pointer}.pc-ty.on{background:#1565d8;border-color:#1565d8;color:#fff}.pc-ty i{font-style:normal;opacity:.75;margin-left:2px}
.pc-yeux{display:flex;gap:3px}.pc-yeux button{font:inherit;font-size:12px;padding:4px 7px;border-radius:8px;border:1px solid var(--border,#ccc);background:var(--panel,#fff);color:var(--text,#111);cursor:pointer}.pc-yeux button.off{opacity:.5;background:var(--panel-alt,#eee)}
.pc-m.t-logement{background:#fff;color:#dc2626;border-color:#dc2626;font-size:20px}.pc-m.t-tableau,.pc-m.t-compteur{border-radius:99px;background:var(--k);color:#fff}.pc-m.t-tableau.terne,.pc-m.t-compteur.terne{opacity:.18}
.pc-ed{width:290px;flex:none;border-left:1px solid var(--border,#ddd);overflow:auto;padding:12px 14px;display:flex;flex-direction:column;gap:8px;font-size:13px;background:var(--panel,#fff)}
.pc-ed[hidden]{display:none}.pc-ed h4{margin:0;font-size:15px}.pc-ed h5{margin:8px 0 0;font-size:13px;color:var(--text-dim,#555)}.pc-ed h5 small{font-weight:400}
.pc-ed label{display:flex;flex-direction:column;gap:3px;font-size:12px;color:var(--text-dim,#555)}.pc-ed input,.pc-ed select,.pc-pop select{font:inherit;font-size:14px;padding:6px 8px;border-radius:8px;border:1px solid var(--border,#ccc);background:var(--panel,#fff);color:var(--text,#111)}
.pc-tos{display:grid;grid-template-columns:1fr 1fr;gap:6px}.pc-to{font:inherit;font-size:12.5px;display:flex;flex-direction:column;align-items:center;gap:2px;padding:9px 4px;border-radius:10px;border:1px solid var(--border,#ccc);background:var(--panel-alt,#f2f4f7);color:var(--text,#111);cursor:pointer}
.pc-to span{font-size:22px}.pc-to.on{border-color:#1565d8;background:rgba(21,101,216,.12);box-shadow:0 0 0 2px rgba(21,101,216,.25)}
.pc-opt{background:var(--panel-alt,#f2f4f7);border-radius:10px;padding:10px;display:flex;flex-direction:column;gap:8px}.pc-aidep{margin:0;font-size:12px;color:var(--text-dim,#555)}
.pc-2{display:grid;grid-template-columns:1fr 1fr;gap:6px}.pc-2 .pc-btn{justify-content:center;font-size:12px;padding:6px 4px}.pc-2 input,.pc-2 select{width:100%;min-width:0;box-sizing:border-box}.pc-edl{display:flex;flex-direction:column;gap:3px;max-height:220px;overflow:auto}.pc-edl div{display:flex;gap:4px}
.pc-edl button{font:inherit;font-size:12.5px;background:none;border:1px solid var(--border,#ddd);border-radius:7px;padding:4px 7px;cursor:pointer;color:var(--text,#111);display:flex;align-items:center;gap:6px}.pc-edl button:first-child{flex:1;text-align:left}.pc-edl i{width:9px;height:9px;border-radius:50%;flex:none}
.pc-fond.pc-edit.pc-pose .pc-vue{cursor:copy}.pc-fond.pc-edit.pc-gomme .pc-vue{cursor:crosshair}
.pc-ph{display:flex;gap:4px;flex-wrap:wrap}.pc-ph img{width:64px;height:64px;object-fit:cover;border-radius:7px;cursor:zoom-in}.pc-ph small{color:var(--text-dim,#555)}
.pc-dlg{position:absolute;inset:0;z-index:20;background:rgba(0,0,0,.35);display:grid;place-items:center}.pc-dlg>div{background:var(--panel,#fff);color:var(--text,#111);border-radius:14px;padding:16px;display:flex;flex-direction:column;gap:8px;min-width:280px;box-shadow:0 20px 50px rgba(0,0,0,.35)}.pc-dlg p{margin:0;font-size:12.5px;color:var(--text-dim,#555)}.pc-dlg i{font-style:normal;opacity:.7}
.pc-liste h4 small{font-weight:400;color:var(--text-dim,#555)}.pc-fond{position:fixed}.pc{position:relative}
@media (max-width:700px){.pc-ed{position:absolute;right:0;top:0;bottom:0;z-index:6;width:86%;box-shadow:-10px 0 30px rgba(0,0,0,.25)}}
.pc-ban{position:absolute;left:0;right:0;bottom:100%;height:calc(var(--u)*6);display:flex;align-items:center;gap:calc(var(--u)*1.5);padding:0 calc(var(--u)*1.5);background:linear-gradient(90deg,#14213d,#1f3a68);color:#fff;border-radius:calc(var(--u)*.8) calc(var(--u)*.8) 0 0;font-family:system-ui,sans-serif;pointer-events:none}
.pc-ban img{height:calc(var(--u)*4);background:#fff;border-radius:calc(var(--u)*.5);padding:calc(var(--u)*.3) calc(var(--u)*.6)}.pc-ban>div{display:flex;flex-direction:column;flex:1;min-width:0}
.pc-ban b{font-size:calc(var(--u)*2)}.pc-ban small{font-size:calc(var(--u)*1.25);opacity:.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.pc-ban .app{flex:none;text-align:right;border-left:1px solid rgba(255,255,255,.35);padding-left:calc(var(--u)*1.5)}.pc-ban .app b{color:#ffd166;letter-spacing:.04em;font-size:calc(var(--u)*1.8)}
.pc-pied{position:absolute;left:0;right:0;top:100%;height:calc(var(--u)*3);display:flex;justify-content:space-between;align-items:center;padding:0 calc(var(--u)*1.5);background:#f4f6fa;color:#44506a;border-top:1px solid #c9d2e3;font:calc(var(--u)*1.15) system-ui,sans-serif;border-radius:0 0 calc(var(--u)*.8) calc(var(--u)*.8);pointer-events:none}
.pc-scene{outline:calc(var(--u)*.2) solid #14213d;outline-offset:0;border-radius:2px}.pc-scene .pc-ban,.pc-scene .pc-pied{box-shadow:0 0 0 calc(var(--u)*.2) #14213d}
.pc-mask{position:absolute;background:#fff}.pc-fond.pc-edit .pc-mask{outline:2px dashed #e11d48;background:#fff;cursor:pointer}.pc-mask.trace{outline:2px dashed #1565d8;background:rgba(255,255,255,.7)}
</style>`;

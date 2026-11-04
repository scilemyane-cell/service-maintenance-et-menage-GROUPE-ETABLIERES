// plan-cles.js — « 🔑 Plan des clés » d'un dossier de site.
// Le plan PDF (architecte) est importé dans l'appli : chaque page devient une image, et les
// étiquettes posées sur le PDF (MV10, MV11… en rouge ou bleu = numéros de clé / organigramme)
// deviennent des repères modifiables : ajouter, déplacer, changer le numéro ou la couleur, supprimer.
// Filtre par numéro de clé : toutes les portes d'une même clé s'allument, page par page.
// Stockage : config/plancles-<dossier> (pages + repères, écouté en direct) et
// config/plancles-<dossier>-p<n> (image de la page, lue à la demande).
import { db } from "./firebase-init.js";
import { doc, getDoc, setDoc, deleteDoc, onSnapshot } from "./firestore-compte.js";
import { esc } from "./astreinte-logic.js";
import { PDFJS, PDFJS_WORKER } from "./fiches-poste-import.js";
import { groupesEtages } from "./plan-3d.js";

const refMeta = (id) => doc(db, "config", `plancles-${id}`);
const refPage = (id, n) => doc(db, "config", `plancles-${id}-p${n}`);
const cacheImages = new Map();
const COULEURS = { rouge: "#d11f1f", bleu: "#1565d8", vert: "#15803d", orange: "#d97706" };
const uid = () => Math.random().toString(36).slice(2, 10);
const triCode = (a, b) => String(a).localeCompare(String(b), "fr", { numeric: true });

// ---------- PDF d'origine (pour la 3D en haute définition) ----------
const refPdf = (id, k) => doc(db, "config", `plancles-${id}-pdf${k}`);
const pdfCache = new Map();
// Noms des pièces : textes du PDF (position + texte), regroupés par étiquette (« salle » + « informatique 2 »).
const refTextes = (id) => doc(db, "config", `plancles-${id}-textes`);
const horsCartouche = (x, y) => !((x < 0.3 && y > 0.7) || (x > 0.75 && y < 0.16) || y > 0.86 || y < 0.06);
const PARASITES = /^(\d*up|is|vh|vb|hsp|pl|td|pc|ss|\d+(?:[.,]\d+)?\s*(?:m²|m2|m|cm|ml)?)$/i;
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
      if (fx < 0 || fx > 1 || fy < 0 || fy > 1 || !horsCartouche(fx, fy)) return;
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
      reperes.push({ id: uid(), p: n, x: +(((x1 + x2) / 2) / vp.width).toFixed(5), y: +(((y1 + y2) / 2) / vp.height).toFixed(5), c: txt.slice(0, 40), col: couleurAnnot(a), note: "" });
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

// ---------- Visionneuse / édition ----------
export function ouvrirPlanCles({ dossier, user, editeur }) {
  const par = window.__smmNom || user?.displayName || user?.nom || user?.email || "";
  const st = { meta: null, page: 1, filtre: "", edition: false, s: 1, tx: 0, ty: 0, couleur: "rouge", dernierCode: "", liste: false, sel: null };
  const fond = document.createElement("div"); fond.className = "pc-fond";
  document.body.appendChild(fond); document.body.classList.add("pc-ouvert");
  if (!document.getElementById("pc-style")) document.head.insertAdjacentHTML("beforeend", STYLE);
  let unsub = () => {};
  const fermer = () => { unsub(); fond.remove(); document.body.classList.remove("pc-ouvert"); document.removeEventListener("keydown", clavier); };
  const clavier = (e) => { if (e.key === "Escape") { if (st.sel) { st.sel = null; dessinerReperes(); } else fermer(); } };
  document.addEventListener("keydown", clavier);

  const reperes = () => st.meta?.reperes || [];
  const sauver = async (liste, msg) => {
    st.meta.reperes = liste; dessinerReperes(); dessinerBarre();
    try { await setDoc(refMeta(dossier.id), { reperes: liste, majLe: Date.now(), majPar: par }, { merge: true }); if (msg) window.toast?.(msg); }
    catch (e) { alert("Enregistrement impossible : " + (e?.message || e)); }
  };

  fond.innerHTML = `<div class="pc">
    <header class="pc-h"><b>🔑 Plan des clés — ${esc(dossier.nom || "")}</b><span class="pc-maj"></span>
      <div class="pc-hb">${editeur ? `<label class="pc-btn">📄 Importer un plan PDF<input type="file" accept="application/pdf" hidden data-import></label>` : ""}<button class="pc-btn" data-fermer>✕ Fermer</button></div></header>
    <div class="pc-barre"></div>
    <div class="pc-corps"><div class="pc-vue"><div class="pc-scene"><img class="pc-img" alt=""><div class="pc-reps"></div></div><div class="pc-msg"></div></div><aside class="pc-liste" hidden></aside></div>
  </div>`;
  const $ = (s) => fond.querySelector(s);
  const vue = $(".pc-vue"), scene = $(".pc-scene"), img = $(".pc-img"), reps = $(".pc-reps"), msg = $(".pc-msg");
  $("[data-fermer]").onclick = fermer;

  // Import
  $("[data-import]")?.addEventListener("change", async (e) => {
    const f = e.target.files?.[0]; e.target.value = ""; if (!f) return;
    if (reperes().length && !confirm(`Remplacer le plan actuel (${st.meta.pages.length} pages, ${reperes().length} repères) par « ${f.name} » ?\nLes repères seront repris des étiquettes du nouveau PDF.`)) return;
    msg.hidden = false; msg.textContent = "⏳ Import du plan…";
    try { const r = await importerPlanPdf(dossier, f, par, (t) => { msg.textContent = "⏳ " + t; }); st.page = 1; window.toast?.(`✓ Plan importé : ${r.pages} pages, ${r.reperes} repères de clés`); }
    catch (err) { console.error(err); alert("Import impossible : " + (err?.message || err)); }
    msg.hidden = true;
  });

  // ---- Barre : pages, numéros de clé, modes ----
  function compteParCode(page) { const m = {}; reperes().forEach(r => { if (page && r.p !== page) return; m[r.c] = (m[r.c] || 0) + 1; }); return m; }
  function dessinerBarre() {
    const b = $(".pc-barre"); if (!st.meta) { b.innerHTML = ""; return; }
    const tous = compteParCode(), codes = Object.keys(tous).sort(triCode);
    const parPage = (p) => reperes().filter(r => r.p === p && (!st.filtre || r.c === st.filtre)).length;
    b.innerHTML = `<div class="pc-pages">${st.meta.pages.map(p => { const n = parPage(p.n); return `<button class="pc-pg ${p.n === st.page ? "on" : ""} ${st.filtre && !n ? "vide" : ""}" data-page="${p.n}" title="${esc(p.titre)}">${esc(p.titre.replace(/^Plan (ensemble )?/i, "").replace(/^B[aâ]timent /i, "Bât. "))}${n ? `<i>${n}</i>` : ""}</button>`; }).join("")}</div>
      <div class="pc-outils">
        <select data-filtre><option value="">🔑 Toutes les clés (${reperes().length})</option>${codes.map(c => `<option value="${esc(c)}" ${c === st.filtre ? "selected" : ""}>${esc(c)} — ${tous[c]} porte${tous[c] > 1 ? "s" : ""}</option>`).join("")}</select>
        <button class="pc-btn" data-liste>${st.liste ? "✕ Liste" : "📋 Liste des clés"}</button>
        ${groupesEtages(st.meta.pages).length ? `<button class="pc-btn p3-lance" data-3d>🧊 Vue 3D</button>` : ""}
        <button class="pc-btn" data-ajuster>⤢ Ajuster</button>
        <button class="pc-btn" data-telecharger title="Image de la page avec ses repères">⬇️ Image</button>
        ${editeur ? `<button class="pc-btn ${st.edition ? "edit" : ""}" data-edition>${st.edition ? "✓ Terminer les modifications" : "✏️ Modifier les repères"}</button>` : ""}
      </div>
      ${st.edition ? `<p class="pc-aide">Clique sur le plan pour <b>ajouter</b> un repère · fais glisser un repère pour le <b>déplacer</b> · clique dessus pour changer le <b>numéro</b>, la <b>couleur</b> ou le <b>supprimer</b>.
        Nouveau repère : <input data-code value="${esc(st.dernierCode)}" size="6" placeholder="ex. MV10"> ${Object.keys(COULEURS).map(c => `<button class="pc-col ${c === st.couleur ? "on" : ""}" data-col="${c}" style="--k:${COULEURS[c]}" title="${c}"></button>`).join("")}</p>` : ""}`;
    b.querySelectorAll("[data-page]").forEach(x => x.onclick = () => allerPage(+x.dataset.page));
    b.querySelector("[data-filtre]").onchange = (e) => { st.filtre = e.target.value; dessinerReperes(); dessinerBarre(); dessinerListe(); };
    b.querySelector("[data-liste]").onclick = () => { st.liste = !st.liste; dessinerBarre(); dessinerListe(); };
    b.querySelector("[data-ajuster]").onclick = ajuster;
    b.querySelector("[data-3d]")?.addEventListener("click", async () => {
      const { ouvrirVue3D } = await import("./plan-3d.js");
      const m = st.meta.pdf?.morceaux;
      ouvrirVue3D({ titre: dossier.nom || "", groupes: groupesEtages(st.meta.pages), reperes: reperes(), filtre: st.filtre, charger: imagePage,
        hd: m ? rendeurHD(dossier.id, m) : null, aPdf: !!m, textes: () => lireTextes(dossier.id),
        ajouterPdf: editeur ? async (f) => { await sauverPdfPlan(dossier.id, f); const s2 = await getDoc(refMeta(dossier.id)); return rendeurHD(dossier.id, s2.data()?.pdf?.morceaux || 1); } : null,
        onPlat: (n, f) => { st.filtre = f || ""; allerPage(n); dessinerListe(); } });
    });
    b.querySelector("[data-telecharger]").onclick = telecharger;
    b.querySelector("[data-edition]")?.addEventListener("click", () => { st.edition = !st.edition; st.sel = null; fond.classList.toggle("pc-edit", st.edition); dessinerBarre(); dessinerReperes(); });
    b.querySelector("[data-code]")?.addEventListener("input", (e) => { st.dernierCode = e.target.value.trim(); });
    b.querySelectorAll("[data-col]").forEach(x => x.onclick = () => { st.couleur = x.dataset.col; dessinerBarre(); });
  }
  function dessinerListe() {
    const a = $(".pc-liste"); a.hidden = !st.liste; if (!st.liste) return;
    const m = {}; reperes().forEach(r => { const k = r.c; (m[k] = m[k] || { n: 0, pages: {}, col: r.col }).n++; m[k].pages[r.p] = (m[k].pages[r.p] || 0) + 1; });
    const titre = (n) => st.meta.pages.find(p => p.n === n)?.titre || `Page ${n}`;
    a.innerHTML = `<h4>📋 ${Object.keys(m).length} numéros de clé · ${reperes().length} repères</h4>
      ${Object.keys(m).sort(triCode).map(k => `<div class="pc-li ${k === st.filtre ? "on" : ""}"><button data-code-l="${esc(k)}"><i style="background:${COULEURS[m[k].col] || COULEURS.rouge}"></i><b>${esc(k)}</b><span>${m[k].n} porte${m[k].n > 1 ? "s" : ""}</span></button>
        <div>${Object.entries(m[k].pages).map(([p, n]) => `<a data-aller="${p}" data-code-a="${esc(k)}">${esc(titre(+p))} (${n})</a>`).join("")}</div></div>`).join("")}`;
    a.querySelectorAll("[data-code-l]").forEach(x => x.onclick = () => { st.filtre = st.filtre === x.dataset.codeL ? "" : x.dataset.codeL; dessinerBarre(); dessinerReperes(); dessinerListe(); });
    a.querySelectorAll("[data-aller]").forEach(x => x.onclick = () => { st.filtre = x.dataset.codeA; allerPage(+x.dataset.aller); dessinerListe(); });
  }

  // ---- Page / image / zoom ----
  async function allerPage(n) {
    st.page = n; st.sel = null; dessinerBarre();
    const p = st.meta.pages.find(x => x.n === n); if (!p) return;
    img.style.width = p.w + "px"; img.style.height = p.h + "px"; scene.style.width = p.w + "px"; scene.style.height = p.h + "px";
    const cle = `${dossier.id}-${n}`;
    if (!cacheImages.has(cle)) { msg.hidden = false; msg.textContent = "⏳ Chargement de la page…"; img.removeAttribute("src");
      try { await imagePage(n); } catch (e) { msg.textContent = "Page indisponible : " + (e?.message || e); return; } }
    if (st.page !== n) return;
    img.src = cacheImages.get(cle) || ""; msg.hidden = true;
    ajuster(); dessinerReperes();
  }
  async function imagePage(n) {
    const cle = `${dossier.id}-${n}`;
    if (!cacheImages.has(cle)) { const s = await getDoc(refPage(dossier.id, n)); cacheImages.set(cle, s.exists() ? s.data().data : ""); }
    return cacheImages.get(cle);
  }
  function appliquer() { scene.style.transform = `translate(${st.tx}px,${st.ty}px) scale(${st.s})`; scene.style.setProperty("--inv", String(Math.max(1, 9.5 / (17 * st.s)))); }
  function ajuster() {
    const p = st.meta?.pages.find(x => x.n === st.page); if (!p) return;
    const W = vue.clientWidth, H = vue.clientHeight; st.s = Math.min(W / p.w, H / p.h) * 0.98; st.tx = (W - p.w * st.s) / 2; st.ty = (H - p.h * st.s) / 2; appliquer();
  }
  function zoomer(f, cx, cy) {
    const s2 = Math.max(0.05, Math.min(4, st.s * f)), k = s2 / st.s;
    st.tx = cx - (cx - st.tx) * k; st.ty = cy - (cy - st.ty) * k; st.s = s2; appliquer();
  }
  vue.addEventListener("wheel", (e) => { e.preventDefault(); const r = vue.getBoundingClientRect(); zoomer(e.deltaY < 0 ? 1.18 : 1 / 1.18, e.clientX - r.left, e.clientY - r.top); }, { passive: false });
  const pointeurs = new Map(); let geste = null;
  vue.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".pc-pop")) return;
    vue.setPointerCapture(e.pointerId); pointeurs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const rep = e.target.closest(".pc-m");
    if (pointeurs.size === 2) { const [a, b] = [...pointeurs.values()]; geste = { type: "pinch", d: Math.hypot(a.x - b.x, a.y - b.y) }; return; }
    geste = rep && st.edition ? { type: "rep", id: rep.dataset.id, x0: e.clientX, y0: e.clientY, bouge: false } : { type: "pan", x0: e.clientX, y0: e.clientY, tx: st.tx, ty: st.ty, bouge: false, rep: rep?.dataset.id };
  });
  vue.addEventListener("pointermove", (e) => {
    if (!pointeurs.has(e.pointerId) || !geste) return; pointeurs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (geste.type === "pinch" && pointeurs.size === 2) { const [a, b] = [...pointeurs.values()], d = Math.hypot(a.x - b.x, a.y - b.y), r = vue.getBoundingClientRect(); zoomer(d / geste.d, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top); geste.d = d; return; }
    const dx = e.clientX - geste.x0, dy = e.clientY - geste.y0; if (Math.abs(dx) + Math.abs(dy) > 4) geste.bouge = true;
    if (geste.type === "pan") { st.tx = geste.tx + dx; st.ty = geste.ty + dy; appliquer(); }
    else if (geste.type === "rep" && geste.bouge) { const el = reps.querySelector(`[data-id="${geste.id}"]`); const [x, y] = versPlan(e); if (el) { el.style.left = x * 100 + "%"; el.style.top = y * 100 + "%"; } }
  });
  const fin = (e) => {
    if (!pointeurs.has(e.pointerId)) return; pointeurs.delete(e.pointerId);
    const g = geste; if (pointeurs.size) { geste = null; return; } geste = null; if (!g || g.type === "pinch") return;
    if (g.type === "rep") {
      if (g.bouge) { const [x, y] = versPlan(e); sauver(reperes().map(r => r.id === g.id ? { ...r, x, y } : r)); }
      else { st.sel = g.id; dessinerReperes(); }
      return;
    }
    if (g.bouge) return;
    if (g.rep) { st.sel = g.rep; dessinerReperes(); return; }
    if (st.sel) { st.sel = null; dessinerReperes(); return; }
    if (st.edition) { const code = (st.dernierCode || "").trim(); if (!code) { window.toast?.("Indique d'abord le numéro de clé du nouveau repère."); return; }
      const [x, y] = versPlan(e); if (x < 0 || y < 0 || x > 1 || y > 1) return;
      const nv = { id: uid(), p: st.page, x, y, c: code, col: st.couleur, note: "" }; sauver([...reperes(), nv], `✓ Repère ${code} ajouté`); }
  };
  vue.addEventListener("pointerup", fin); vue.addEventListener("pointercancel", fin);
  function versPlan(e) { const r = scene.getBoundingClientRect(); return [+((e.clientX - r.left) / r.width).toFixed(5), +((e.clientY - r.top) / r.height).toFixed(5)]; }

  function dessinerReperes() {
    const liste = reperes().filter(r => r.p === st.page);
    reps.innerHTML = liste.map(r => `<div class="pc-m ${r.col || "rouge"} ${st.filtre && r.c !== st.filtre ? "terne" : ""} ${st.filtre && r.c === st.filtre ? "fort" : ""} ${st.sel === r.id ? "sel" : ""}" data-id="${r.id}" style="left:${r.x * 100}%;top:${r.y * 100}%;--k:${COULEURS[r.col] || COULEURS.rouge}" title="${esc(r.c)}${r.note ? " — " + esc(r.note) : ""}">${esc(r.c)}</div>`).join("");
    const sel = liste.find(r => r.id === st.sel); fond.querySelector(".pc-pop")?.remove();
    if (!sel) return;
    const pop = document.createElement("div"); pop.className = "pc-pop";
    pop.innerHTML = st.edition ? `<b>Repère de clé</b>
        <label>Numéro <input data-c value="${esc(sel.c)}"></label>
        <label>Porte / local <input data-n value="${esc(sel.note || "")}" placeholder="ex. bureau directeur"></label>
        <div class="pc-pcol">${Object.keys(COULEURS).map(c => `<button class="pc-col ${c === (sel.col || "rouge") ? "on" : ""}" data-col="${c}" style="--k:${COULEURS[c]}"></button>`).join("")}</div>
        <div class="pc-pb"><button class="pc-btn rouge" data-suppr>🗑️ Supprimer</button><button class="pc-btn" data-ok>✓ OK</button></div>`
      : `<b style="color:${COULEURS[sel.col] || COULEURS.rouge}">🔑 ${esc(sel.c)}</b>${sel.note ? `<span>${esc(sel.note)}</span>` : ""}<span>${reperes().filter(r => r.c === sel.c).length} porte(s) avec cette clé sur le site</span>
        <div class="pc-pb"><button class="pc-btn" data-voir>Voir toutes ses portes</button></div>`;
    fond.querySelector(".pc-vue").appendChild(pop);
    const el = reps.querySelector(`[data-id="${sel.id}"]`), rv = vue.getBoundingClientRect(), re = el.getBoundingClientRect();
    pop.style.left = Math.min(rv.width - 250, Math.max(8, re.left - rv.left - 20)) + "px"; pop.style.top = Math.min(rv.height - 200, re.bottom - rv.top + 8) + "px";
    let col = sel.col || "rouge";
    pop.querySelectorAll("[data-col]").forEach(x => x.onclick = () => { col = x.dataset.col; pop.querySelectorAll("[data-col]").forEach(y => y.classList.toggle("on", y === x)); });
    pop.querySelector("[data-ok]")?.addEventListener("click", () => { const c = pop.querySelector("[data-c]").value.trim(); if (!c) return; st.dernierCode = c; st.sel = null;
      sauver(reperes().map(r => r.id === sel.id ? { ...r, c, note: pop.querySelector("[data-n]").value.trim(), col } : r), "✓ Repère modifié"); });
    pop.querySelector("[data-c]")?.addEventListener("keydown", (e) => { if (e.key === "Enter") pop.querySelector("[data-ok]").click(); });
    pop.querySelector("[data-suppr]")?.addEventListener("click", () => { st.sel = null; sauver(reperes().filter(r => r.id !== sel.id), `Repère ${sel.c} supprimé`); });
    pop.querySelector("[data-voir]")?.addEventListener("click", () => { st.filtre = sel.c; st.sel = null; st.liste = true; dessinerBarre(); dessinerReperes(); dessinerListe(); });
  }

  // Image de la page avec ses repères (à imprimer / envoyer au serrurier).
  async function telecharger() {
    const p = st.meta?.pages.find(x => x.n === st.page); if (!p || !img.src) return;
    const cv = document.createElement("canvas"); cv.width = p.w; cv.height = p.h; const x = cv.getContext("2d");
    x.drawImage(img, 0, 0, p.w, p.h); const fs = Math.round(p.w / 120);
    x.font = `bold ${fs}px sans-serif`; x.textAlign = "center"; x.textBaseline = "middle";
    reperes().filter(r => r.p === st.page && (!st.filtre || r.c === st.filtre)).forEach(r => { const w = x.measureText(r.c).width + fs * 0.7, cx = r.x * p.w, cy = r.y * p.h, k = COULEURS[r.col] || COULEURS.rouge;
      x.fillStyle = "rgba(255,255,255,.92)"; x.fillRect(cx - w / 2, cy - fs * 0.7, w, fs * 1.4); x.strokeStyle = k; x.lineWidth = 2; x.strokeRect(cx - w / 2, cy - fs * 0.7, w, fs * 1.4); x.fillStyle = k; x.fillText(r.c, cx, cy + 1); });
    x.font = `bold ${fs * 1.4}px sans-serif`; x.textAlign = "left"; x.fillStyle = "#111"; x.fillText(`${dossier.nom || ""} — ${p.titre}${st.filtre ? ` — clé ${st.filtre}` : ""} — ${new Date().toLocaleDateString("fr-FR")}`, fs, fs * 1.5);
    const a = document.createElement("a"); a.href = cv.toDataURL("image/jpeg", 0.9); a.download = `Plan clés ${dossier.nom || ""} - ${p.titre}${st.filtre ? " - " + st.filtre : ""}.jpg`; a.click();
  }

  window.addEventListener("resize", () => { if (document.body.contains(fond)) ajuster(); });
  msg.textContent = "⏳ Chargement du plan…";
  unsub = onSnapshot(refMeta(dossier.id), (s) => {
    const premier = !st.meta;
    st.meta = s.exists() ? s.data() : null;
    if (!st.meta || !(st.meta.pages || []).length) {
      st.meta = null; dessinerBarre(); reps.innerHTML = ""; img.removeAttribute("src"); msg.hidden = false;
      msg.innerHTML = editeur ? `<div class="pc-vide"><b>Aucun plan des clés pour ce site.</b><p>Importe le plan PDF de l'architecte : chaque page devient une image et les étiquettes (MV10, MV11…) deviennent des repères de clés modifiables.</p><label class="pc-btn grand">📄 Importer un plan PDF<input type="file" accept="application/pdf" hidden data-import2></label></div>` : `<div class="pc-vide"><b>Aucun plan des clés pour ce site.</b></div>`;
      msg.querySelector("[data-import2]")?.addEventListener("change", (e) => { const i = $("[data-import]"); const dt = new DataTransfer(); if (e.target.files[0]) dt.items.add(e.target.files[0]); i.files = dt.files; i.dispatchEvent(new Event("change")); });
      return;
    }
    $(".pc-maj").textContent = st.meta.majLe ? `mis à jour le ${new Date(st.meta.majLe).toLocaleDateString("fr-FR")}${st.meta.majPar ? ` par ${st.meta.majPar}` : ""}` : "";
    if (!st.meta.pages.some(p => p.n === st.page)) st.page = st.meta.pages[0].n;
    dessinerBarre(); dessinerListe();
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
</style>`;

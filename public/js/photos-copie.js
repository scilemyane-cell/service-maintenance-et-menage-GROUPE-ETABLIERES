// photos-copie.js — Copie des photos SharePoint dans Firestore (dossiers de site).
// SharePoint ne donne pas de lien d'image permanent : chaque ouverture d'un
// dossier demandait un jeton Microsoft + une adresse par photo, d'où la
// lenteur. On garde donc, en plus de l'original SharePoint, une copie
// allégée (JPEG ~1000 px) dans la collection « photos-copies » (id = id
// SharePoint de la photo). Firestore la garde aussi sur l'appareil : à la
// 2e ouverture, les photos s'affichent tout de suite, même sans réseau.
import { db } from "./firebase-init.js";
import { collection, doc, setDoc, getDocs, query, where, documentId, serverTimestamp } from "./firestore-compte.js";

const COL = "photos-copies";
const memoire = new Map();          // itemId -> dataURL (ou null = pas de copie)
const LIMITE = 700000;              // taille max d'une copie (le document Firestore est limité à 1 Mo)

// Copies existantes pour une liste de photos (par lots de 30 = limite de « in »).
export async function copiesPhotos(itemIds) {
  const res = {}, manquants = [];
  [...new Set(itemIds.filter(Boolean))].forEach(id => { if (memoire.has(id)) { if (memoire.get(id)) res[id] = memoire.get(id); } else manquants.push(id); });
  for (let i = 0; i < manquants.length; i += 30) {
    const lot = manquants.slice(i, i + 30);
    try {
      const s = await getDocs(query(collection(db, COL), where(documentId(), "in", lot)));
      const vus = new Set();
      s.docs.forEach(d => { const v = d.data()?.data; if (v) { memoire.set(d.id, v); res[d.id] = v; vus.add(d.id); } });
      lot.forEach(id => { if (!vus.has(id)) memoire.set(id, null); });
    } catch (e) { console.warn("copies photos :", e?.message || e); }
  }
  return res;
}
export const aUneCopie = (itemId) => !!memoire.get(itemId);

// Image (fichier, blob ou adresse) → JPEG allégé en dataURL.
export async function compresserImage(source, max = 1000) {
  let blob = source;
  if (typeof source === "string") { const r = await fetch(source); if (!r.ok) throw new Error(`téléchargement ${r.status}`); blob = await r.blob(); }
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ko(new Error("image illisible")); i.src = url; });
    let taille = max, q = 0.72, out = "";
    for (let essai = 0; essai < 6; essai++) {
      const k = Math.min(1, taille / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
      const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
      out = c.toDataURL("image/jpeg", q);
      if (out.length <= LIMITE) return out;
      if (q > 0.5) q -= 0.1; else taille = Math.round(taille * 0.75);
    }
    return out.length <= LIMITE ? out : null;
  } finally { URL.revokeObjectURL(url); }
}

// Enregistre la copie d'une photo (sans bloquer : une erreur est juste notée).
export async function enregistrerCopie(itemId, source, meta = {}) {
  if (!itemId || memoire.get(itemId)) return false;
  try {
    const data = await compresserImage(source);
    if (!data) return false;
    await setDoc(doc(db, COL, itemId), { data, ...meta, creeLe: serverTimestamp() });
    memoire.set(itemId, data);
    return true;
  } catch (e) { console.warn("copie photo", itemId, ":", e?.message || e); return false; }
}

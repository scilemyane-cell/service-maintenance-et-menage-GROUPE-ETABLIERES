// espaces-verts-data.js — Traçabilité des espaces verts (sites MNA).
// Un passage = un document « espaces-verts » (site, date, agent, prestations
// faites, observations). Les photos sont à part (« espaces-verts-photos »,
// ≈ 80 Ko chacune) pour ne pas alourdir la liste des passages.
import { db } from "./firebase-init.js";
import {
  collection, doc, setDoc, addDoc, updateDoc, deleteDoc, onSnapshot, query, where, serverTimestamp,
} from "./firestore-compte.js";

const COL = "espaces-verts";
const COL_PHOTOS = "espaces-verts-photos";

// Prestations, regroupées comme sur la feuille. `jours` = intervalle attendu
// entre deux passages pour cette prestation (alerte de retard au-delà) ;
// `saison` = mois (1-12) où elle est attendue. Sans `jours` : pas d'alerte.
export const GROUPES = [
  {
    nom: "Tonte et bordures", icone: "🌱", taches: [
      { cle: "tonte", label: "Tonte", jours: 14, saison: [3, 4, 5, 6, 7, 8, 9, 10] },
      { cle: "bordures", label: "Coupe des bordures", jours: 30, saison: [3, 4, 5, 6, 7, 8, 9, 10] },
      { cle: "ramassage-herbe", label: "Ramassage de l'herbe" },
    ],
  },
  {
    nom: "Taille haies et arbustes", icone: "✂️", taches: [
      { cle: "haies", label: "Taille des haies", jours: 182 },
      { cle: "arbustes", label: "Taille des arbustes", jours: 365 },
      { cle: "elagage", label: "Élagage léger" },
    ],
  },
  {
    nom: "Désherbage et massifs", icone: "🌷", taches: [
      { cle: "desherbage", label: "Désherbage des allées", jours: 30, saison: [3, 4, 5, 6, 7, 8, 9, 10, 11] },
      { cle: "massifs", label: "Entretien des massifs", jours: 30, saison: [3, 4, 5, 6, 7, 8, 9, 10] },
      { cle: "paillage", label: "Paillage", jours: 365 },
    ],
  },
  {
    nom: "Feuilles et déchets verts", icone: "🍂", taches: [
      { cle: "feuilles", label: "Ramassage des feuilles", jours: 14, saison: [10, 11, 12] },
      { cle: "debroussaillage", label: "Débroussaillage", jours: 182 },
      { cle: "dechets", label: "Évacuation des déchets verts" },
    ],
  },
];
export const TACHES = GROUPES.flatMap(g => g.taches.map(t => ({ ...t, groupe: g.nom })));

export const estSiteMNA = (s) => /MNA/i.test(s?.dispositif || "Dispositif MNA") && !s?.supprimeLe;

export function watchPassages(cb) {
  return onSnapshot(collection(db, COL), (snap) => {
    const l = [];
    snap.forEach(d => { const x = { id: d.id, ...d.data() }; if (!x.supprimeLe) l.push(x); });
    cb(l);
  }, (e) => { console.error("Espaces verts :", e); cb(null, e); });
}

export async function creerPassage(data) {
  const ref = await addDoc(collection(db, COL), { taches: {}, obs: {}, observations: "", ...data, creeLe: serverTimestamp(), majLe: serverTimestamp() });
  return ref.id;
}
export const majPassage = (id, data) => setDoc(doc(db, COL, id), { ...data, majLe: serverTimestamp() }, { merge: true });
export const supprimerPassage = (id) => deleteDoc(doc(db, COL, id));

export function watchPhotosPassage(passageId, cb) {
  return onSnapshot(query(collection(db, COL_PHOTOS), where("passageId", "==", passageId)),
    s => cb(s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.le || 0) - (b.le || 0))),
    (e) => { console.warn("Photos espaces verts :", e); cb([]); });
}
export const ajouterPhotoEV = (p) => addDoc(collection(db, COL_PHOTOS), { legende: "", moment: "", ...p, le: Date.now() });
export const majPhotoEV = (id, champs) => updateDoc(doc(db, COL_PHOTOS, id), champs);
export const supprimerPhotoEV = (id) => deleteDoc(doc(db, COL_PHOTOS, id));

// Dernière date (YYYY-MM-DD) à laquelle chaque prestation a été faite sur un site.
export function dernieresDates(passages, siteId, avantDate = null) {
  const r = {};
  for (const p of passages) {
    if (p.siteId !== siteId || (avantDate && p.date >= avantDate)) continue;
    for (const [cle, fait] of Object.entries(p.taches || {})) if (fait && (!r[cle] || p.date > r[cle])) r[cle] = p.date;
  }
  return r;
}

export const joursDepuis = (iso, ref = new Date()) => Math.floor((new Date(ref.toDateString()) - new Date(iso + "T00:00:00")) / 864e5);

// Prestations en retard sur un site, à la date du jour : attendues en cette
// saison et plus faites depuis l'intervalle prévu (+ 25 % de marge).
export function retardsSite(passages, siteId, ref = new Date()) {
  const derniers = dernieresDates(passages, siteId);
  const aDejaUnPassage = passages.some(p => p.siteId === siteId);
  const mois = ref.getMonth() + 1;
  const out = [];
  if (!aDejaUnPassage) return out;
  for (const t of TACHES) {
    if (!t.jours) continue;
    if (t.saison && !t.saison.includes(mois)) continue;
    const d = derniers[t.cle];
    if (!d) { out.push({ ...t, jamais: true }); continue; }
    const j = joursDepuis(d, ref);
    if (j > Math.round(t.jours * 1.25)) out.push({ ...t, depuis: j, derniere: d });
  }
  return out;
}

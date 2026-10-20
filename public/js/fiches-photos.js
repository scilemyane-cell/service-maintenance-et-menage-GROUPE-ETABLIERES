// fiches-photos.js — Photos des fiches de traçabilité ménage.
// Une photo = un document « fiches-photos » (≈ 80 Ko) rattaché à sa fiche :
// plus de plafond par fiche (avant : photos DANS la fiche, limite 1 Mo).
// moment : "avant" (en arrivant), "apres" (en partant) ou "" (autre).
// En fin de semaine les photos sont archivées en PDF sur SharePoint puis
// supprimées d'ici (voir tracabilite-archive.js) : le stockage reste léger.
import { db } from "./firebase-init.js";
import { collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot, query, where, getDocs } from "./firestore-compte.js";

export const COL_PHOTOS = "fiches-photos";

// Toutes les photos d'une fiche : anciennes (dans la fiche, clé "f:i") + nouvelles (clé "d:id").
export function photosFusion(fiche, docs = []) {
  const anciennes = (fiche?.photos || []).map((p, i) => ({ ...p, cle: `f:${i}`, moment: p.moment || "" }));
  return [...anciennes, ...docs.map(p => ({ ...p, cle: `d:${p.id}` }))];
}

export function watchPhotosFiche(ficheId, cb) {
  return onSnapshot(query(collection(db, COL_PHOTOS), where("ficheId", "==", ficheId)),
    s => cb(s.docs.map(d => ({ id: d.id, ...d.data() }))), (e) => { console.warn("Photos fiche :", e); cb([]); });
}
export function watchPhotosSemaine(weekStart, cb) {
  return onSnapshot(query(collection(db, COL_PHOTOS), where("weekStart", "==", weekStart)),
    s => cb(s.docs.map(d => ({ id: d.id, ...d.data() }))), (e) => { console.warn("Photos semaine :", e); cb([]); });
}
export async function photosDeLaFiche(ficheId) {
  const s = await getDocs(query(collection(db, COL_PHOTOS), where("ficheId", "==", ficheId)));
  return s.docs.map(d => ({ id: d.id, ...d.data() }));
}
export const ajouterPhoto = (p) => addDoc(collection(db, COL_PHOTOS), { legende: "", ...p, le: Date.now() });
export const majPhoto = (id, champs) => updateDoc(doc(db, COL_PHOTOS, id), champs);
export const supprimerPhoto = (id) => deleteDoc(doc(db, COL_PHOTOS, id));

// ordre-onglets-data.js
// Ordre des onglets à l'intérieur de chaque tuile (ex. Astreinte :
// Calendrier, Absences, Interventions…) — réglage global, modifié par le
// Super Admin par glisser-déposer, appliqué à tout le monde.
import { db } from "./firebase-init.js";
import { doc, setDoc, onSnapshot } from "./firestore-compte.js";

const REF = doc(db, "config", "ordre-onglets");

export function watchOrdreOnglets(callback) {
  return onSnapshot(REF, (snap) => callback(snap.exists() ? (snap.data().ordres || {}) : {}),
    (err) => { console.error("watchOrdreOnglets:", err); callback({}); });
}

export async function saveOrdreOnglets(categorieId, ids) {
  await setDoc(REF, { ordres: { [categorieId]: ids } }, { merge: true });
}

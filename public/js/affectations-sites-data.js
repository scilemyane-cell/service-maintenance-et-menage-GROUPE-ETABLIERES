// affectations-sites-data.js
// Sites de demandes attribués aux techniciens par un superviseur
// (config/sites-techniciens : { affectations: { "<nom du site>": [uid, …] } }).
import { db } from "./firebase-init.js";
import { doc, onSnapshot, setDoc } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const REF = doc(db, "config", "sites-techniciens");

export function watchAffectationsSites(callback) {
  return onSnapshot(REF, (snap) => callback(snap.exists() ? (snap.data().affectations || {}) : {}),
    (err) => { console.error("watchAffectationsSites:", err); callback({}); });
}

export async function saveAffectationSite(site, uids) {
  await setDoc(REF, { affectations: { [site]: uids }, majLe: Date.now() }, { merge: true });
}

// Enregistre plusieurs sites d'un coup ({ "<site>": [uid, …], … }).
export async function saveAffectationsSites(map) {
  await setDoc(REF, { affectations: map, majLe: Date.now() }, { merge: true });
}

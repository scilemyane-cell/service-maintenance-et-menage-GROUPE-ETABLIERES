// favoris-data.js
// "Mes sites favoris" de l'accueil, propres à chaque utilisateur et
// stockés dans Firestore (favoris-sites/{uid} : { ids: [...] }) — donc
// les mêmes sur tous ses appareils, et modifiables par un Admin / Super
// Admin (via "Aperçu en tant que…") pour préparer la vue d'un technicien.

import { db } from "./firebase-init.js";
import { doc, onSnapshot, setDoc } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

export function watchFavoris(uid, callback, onError) {
  return onSnapshot(doc(db, "favoris-sites", uid), (snap) => {
    callback(snap.exists() ? (snap.data().ids || []) : null); // null = jamais enregistré
  }, (err) => { console.error("watchFavoris:", err); onError?.(err); });
}

export async function saveFavoris(uid, ids) {
  await setDoc(doc(db, "favoris-sites", uid), { ids, majLe: Date.now() });
}

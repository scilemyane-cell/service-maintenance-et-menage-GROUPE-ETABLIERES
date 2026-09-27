// favoris-data.js
// "Mes sites favoris" de l'accueil, propres à chaque utilisateur et
// stockés dans Firestore (favoris-sites/{uid} : { ids: [...] }) — donc
// les mêmes sur tous ses appareils, et modifiables par un Admin / Super
// Admin (via "Aperçu en tant que…") pour préparer la vue d'un technicien.

import { db } from "./firebase-init.js";
import { doc, onSnapshot, setDoc } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

export function watchFavoris(uid, callback, onError) {
  return onSnapshot(doc(db, "favoris-sites", uid), (snap) => {
    callback(snap.exists() ? (snap.data().ids || []) : null, snap.exists() ? snap.data() : {}); // null = jamais enregistré
  }, (err) => { console.error("watchFavoris:", err); onError?.(err); });
}

export async function saveFavoris(uid, ids) {
  await setDoc(doc(db, "favoris-sites", uid), { ids, majLe: Date.now() }, { merge: true });
}

// Suivi des demandes (vue Par site) : les favoris de l'accueil sont repris
// automatiquement (rapprochement par nom) ; l'étoile ajoute / retire un
// site de demandes à la main, sans toucher aux favoris de l'accueil.
export async function saveFavorisDemandes(uid, ajout, retrait) {
  await setDoc(doc(db, "favoris-sites", uid), { demandesAjout: ajout, demandesRetrait: retrait, majLe: Date.now() }, { merge: true });
}

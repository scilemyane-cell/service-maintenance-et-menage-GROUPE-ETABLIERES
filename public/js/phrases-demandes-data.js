// phrases-demandes-data.js
// Phrases types du Suivi des demandes (commentaires et actions attribuées),
// partagées par tous : config/phrases-demandes { commentaires: [], actions: [] }.
import { db } from "./firebase-init.js";
import { doc, onSnapshot, setDoc } from "./firestore-compte.js";

const REF = doc(db, "config", "phrases-demandes");
export const PHRASES_DEFAUT = {
  commentaires: ["Intervention réalisée.", "À reprogrammer.", "Pièce commandée, en attente de livraison.", "Devis demandé.", "Entreprise sollicitée.", "Accès impossible (logement occupé / absent).", "Demande en doublon."],
  actions: ["Merci de me faire un retour ou de clôturer l'intervention.", "Merci de demander un devis.", "Merci de commander la pièce.", "Merci de planifier l'intervention.", "Merci de contacter le demandeur.", "Merci de relancer l'entreprise."],
};

export function watchPhrasesDemandes(callback) {
  return onSnapshot(REF, (snap) => {
    const d = snap.exists() ? snap.data() : {};
    callback({ commentaires: d.commentaires || PHRASES_DEFAUT.commentaires, actions: d.actions || PHRASES_DEFAUT.actions });
  }, (err) => { console.error("watchPhrasesDemandes:", err); callback(PHRASES_DEFAUT); });
}

export async function savePhrasesDemandes(type, liste) {
  await setDoc(REF, { [type]: liste, majLe: Date.now() }, { merge: true });
}

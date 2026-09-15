// taches-data.js
// Suivi des tâches internes (Super Admin uniquement) — sur le même
// principe que le Prévisionnel Travaux : chaque tâche avance par étapes
// (À faire → En cours → Bloquée → Terminée) pour avoir un visuel clair
// sur ce qui reste à faire, sans dépendre d'un fichier externe.

import { db } from "./firebase-init.js";
import {
  doc, addDoc, updateDoc, deleteDoc, onSnapshot, serverTimestamp,
  collection,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const COLLECTION = "admin-taches";

export const ETAPES = {
  a_faire: "À faire",
  en_cours: "En cours",
  bloque: "Bloquée",
  termine: "Terminée",
};

export const PRIORITES = { haute: "🔴 Haute", normale: "🟡 Normale", basse: "🟢 Basse" };

export function nouvelleTache() {
  return { titre: "", description: "", priorite: "normale", etape: "a_faire" };
}

export function watchTaches(callback) {
  return onSnapshot(collection(db, COLLECTION), (snap) => {
    const list = [];
    snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
    callback(list);
  }, (err) => { console.error("watchTaches:", err); callback([]); });
}

export async function creerTache(tache, user) {
  await addDoc(collection(db, COLLECTION), {
    ...tache,
    creeParNom: user?.nom || user?.email || "Inconnu",
    createdAt: serverTimestamp(),
    majAt: serverTimestamp(),
  });
}

export async function modifierTache(id, patch, user) {
  await updateDoc(doc(db, COLLECTION, id), {
    ...patch,
    majAt: serverTimestamp(),
    majParNom: user?.nom || user?.email || "Inconnu",
  });
}

export async function changerEtape(id, etape, user) {
  await modifierTache(id, { etape }, user);
}

export async function supprimerTache(id) {
  await deleteDoc(doc(db, COLLECTION, id));
}

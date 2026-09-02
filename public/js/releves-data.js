import { db } from "./firebase-init.js";
import {
  doc, setDoc, addDoc, deleteDoc, updateDoc, collection, onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

export function watchReleves(callback) {
  return onSnapshot(collection(db, "releves-interventions"), (snap) => {
    const list = [];
    snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
    callback(list.sort((a, b) => (b.validatedAt || "").localeCompare(a.validatedAt || "")));
  }, (err) => { console.error("watchReleves:", err); callback([]); });
}

export async function createReleve(record) {
  await addDoc(collection(db, "releves-interventions"), record);
}

// Supprime un relevé archivé et libère les interventions qu'il contenait
// (elles repassent "En attente", pour pouvoir être corrigées et incluses
// dans un nouveau relevé). Une intervention déjà supprimée entre-temps est
// simplement ignorée (pas d'échec de l'ensemble pour autant). Réservé
// Super Admin côté règles Firestore.
export async function deleteReleve(releveId, interventionIds) {
  await Promise.allSettled(
    (interventionIds || []).map(id => updateDoc(doc(db, "interventions", id), { transmis: false }))
  );
  await deleteDoc(doc(db, "releves-interventions", releveId));
}

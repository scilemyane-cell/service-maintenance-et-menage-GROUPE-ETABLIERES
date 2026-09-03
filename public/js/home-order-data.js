// home-order-data.js
// Ordre personnalisé des bulles de l'écran d'accueil (Astreinte, Dossiers
// de site, Stock maintenance...) — un réglage global, modifiable par un
// Admin/Super Admin, appliqué à tout le monde.

import { db } from "./firebase-init.js";
import { doc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const REF = doc(db, "config", "home-order");

export function watchHomeOrder(callback) {
  return onSnapshot(REF, (snap) => {
    callback(snap.exists() ? (snap.data().order || []) : []);
  }, (err) => { console.error("watchHomeOrder:", err); callback([]); });
}

export async function saveHomeOrder(order) {
  await setDoc(REF, { order }, { merge: true });
}

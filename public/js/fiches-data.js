import { db } from "./firebase-init.js";
import {
  doc, setDoc, deleteDoc,
  collection, onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

// Une fiche = un document par (site, semaine, agent).
// id du document : `${siteId}_${weekStart}_${uid}`
export function ficheId(siteId, weekStart, uid) {
  return `${siteId}_${weekStart}_${uid}`;
}

export function watchFiches(callback) {
  return onSnapshot(collection(db, "fiches"), (snap) => {
    const list = [];
    snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
    callback(list);
  }, (err) => { console.error("watchFiches:", err); callback([]); });
}

export async function saveFiche(id, data) {
  await setDoc(doc(db, "fiches", id), data, { merge: true });
}

export async function deleteFiche(id) {
  await deleteDoc(doc(db, "fiches", id));
}

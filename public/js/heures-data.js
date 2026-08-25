import { db } from "./firebase-init.js";
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc,
  collection, addDoc, onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const DEFAULT_PARAMS = { seuilSemaine: 48, nbSemainesMoyenne: 8, seuilMoyenne: 44 };

// ---- Paramètres de seuils (modifiables par un admin/n1 dans l'appli) ----
export function watchHeuresParams(callback) {
  const ref = doc(db, "config", "heures-parametres");
  return onSnapshot(ref, (snap) => {
    callback(snap.exists() ? { ...DEFAULT_PARAMS, ...snap.data() } : DEFAULT_PARAMS);
  }, (err) => { console.error("watchHeuresParams:", err); callback(DEFAULT_PARAMS); });
}
export async function saveHeuresParams(params) {
  await setDoc(doc(db, "config", "heures-parametres"), params);
}

export function watchHeures(callback) {
  return onSnapshot(collection(db, "heures"), (snap) => {
    const list = [];
    snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
    callback(list);
  }, (err) => { console.error("watchHeures:", err); callback([]); });
}

export async function addHeures(record) {
  await addDoc(collection(db, "heures"), record);
}

export async function validateHeures(id, validatedBy) {
  await updateDoc(doc(db, "heures", id), { validated: true, validatedBy });
}

export async function deleteHeures(id) {
  await deleteDoc(doc(db, "heures", id));
}

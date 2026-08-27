import { db } from "./firebase-init.js";
import {
  doc, setDoc, addDoc, collection, onSnapshot,
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

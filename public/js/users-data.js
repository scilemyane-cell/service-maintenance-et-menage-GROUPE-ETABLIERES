import { db } from "./firebase-init.js";
import { doc, updateDoc, collection, onSnapshot } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

export function watchUsers(callback) {
  return onSnapshot(collection(db, "users"), (snap) => {
    const list = [];
    snap.forEach((d) => list.push({ uid: d.id, ...d.data() }));
    callback(list.sort((a, b) => (a.nom || a.email || "").localeCompare(b.nom || b.email || "")));
  }, (err) => { console.error("watchUsers:", err); callback([]); });
}

export async function updateUser(uid, fields) {
  await updateDoc(doc(db, "users", uid), fields);
}

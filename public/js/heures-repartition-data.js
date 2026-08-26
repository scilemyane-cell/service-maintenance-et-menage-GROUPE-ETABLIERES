import { db } from "./firebase-init.js";
import { doc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { collection } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

export function repartitionId(dispositif, weekStart, uid) {
  return `${dispositif}_${weekStart}_${uid}`;
}

export function watchRepartitions(callback) {
  return onSnapshot(collection(db, "heures-repartition"), (snap) => {
    const list = [];
    snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
    callback(list);
  }, (err) => { console.error("watchRepartitions:", err); callback([]); });
}

export async function saveRepartition(id, data) {
  await setDoc(doc(db, "heures-repartition", id), data, { merge: true });
}

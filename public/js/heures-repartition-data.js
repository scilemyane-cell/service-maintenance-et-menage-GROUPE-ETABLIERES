import { partager } from "./ecoute-partagee.js";
import { db } from "./firebase-init.js";
import { doc, setDoc, onSnapshot } from "./firestore-compte.js";
import { collection } from "./firestore-compte.js";

export function repartitionId(dispositif, weekStart, uid) {
  return `${dispositif}_${weekStart}_${uid}`;
}

export const watchRepartitions = partager("heures-repartition", watchRepartitionsBrut);
function watchRepartitionsBrut(callback) {
  return onSnapshot(collection(db, "heures-repartition"), (snap) => {
    const list = [];
    snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
    callback(list);
  }, (err) => { console.error("watchRepartitions:", err); callback([]); });
}

export async function saveRepartition(id, data) {
  await setDoc(doc(db, "heures-repartition", id), data, { merge: true });
}

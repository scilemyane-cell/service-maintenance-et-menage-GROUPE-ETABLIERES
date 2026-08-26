import { db } from "./firebase-init.js";
import {
  doc, setDoc, collection, onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

// Un document par jour de bascule N1 : transferts-ligne/{YYYY-MM-DD}
// { date, fromPerson, toPerson, confirmedBy, confirmedByNom, confirmedAt }
export function watchTransferts(callback) {
  return onSnapshot(collection(db, "transferts-ligne"), (snap) => {
    const list = [];
    snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
    callback(list);
  }, (err) => { console.error("watchTransferts:", err); callback([]); });
}

export async function confirmTransfert(date, fromPerson, toPerson, user) {
  await setDoc(doc(db, "transferts-ligne", date), {
    date, fromPerson, toPerson,
    confirmedBy: user.uid, confirmedByNom: user.nom || user.email,
    confirmedAt: new Date().toISOString(),
  });
}

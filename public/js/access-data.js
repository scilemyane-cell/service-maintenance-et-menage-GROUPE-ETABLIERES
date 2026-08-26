import { db } from "./firebase-init.js";
import { doc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const REF = () => doc(db, "config", "menage-access");

// Structure : { [nomDispositif]: [uid, uid, ...] }
// Une liste vide ou absente = accès ouvert à tous les agents ménage/mi-temps
// (comportement par défaut, rétrocompatible).
export function watchAccess(callback) {
  return onSnapshot(REF(), (snap) => {
    callback(snap.exists() ? snap.data() : {});
  }, (err) => { console.error("watchAccess:", err); callback({}); });
}

export async function setDispositifAccess(dispositif, uids) {
  await setDoc(REF(), { [dispositif]: uids }, { merge: true });
}

export function hasAccess(accessMap, dispositif, user) {
  if (user.role === "admin" || user.role === "n1" || user.role === "direction") return true;
  const list = accessMap[dispositif];
  if (!list || list.length === 0) return true; // pas de restriction définie = ouvert
  return list.includes(user.uid);
}

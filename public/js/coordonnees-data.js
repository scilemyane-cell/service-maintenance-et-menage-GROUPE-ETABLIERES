import { db } from "./firebase-init.js";
import { doc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const REF = () => doc(db, "config", "coordonnees");

// Structure : { [nomPersonne]: { telephone: "...", email: "..." } }
export function watchCoordonnees(callback) {
  return onSnapshot(REF(), (snap) => {
    callback(snap.exists() ? snap.data() : {});
  }, (err) => { console.error("watchCoordonnees:", err); callback({}); });
}

export async function saveCoordonnee(personName, fields) {
  await setDoc(REF(), { [personName]: fields }, { merge: true });
}

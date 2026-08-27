import { db } from "./firebase-init.js";
import { doc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const REF = () => doc(db, "config", "associations-sites");

// Structure : { associations: [ { nom: "Agropolis", sites: ["Site A", "Site B"] }, ... ] }
const DEFAULT_ASSOCIATIONS = [
  { nom: "École", sites: ["Internat Bâtiment A", "Internat Bâtiment B"] },
  { nom: "Agropolis", sites: [] },
  { nom: "Armonia", sites: ["Résidence Valoria"] },
];

let seeded = false;

export function watchAssociations(callback) {
  return onSnapshot(REF(), (snap) => {
    if (snap.exists() && snap.data().associations) {
      callback(snap.data().associations);
    } else {
      callback(DEFAULT_ASSOCIATIONS);
      if (!seeded) { seeded = true; setDoc(REF(), { associations: DEFAULT_ASSOCIATIONS }); }
    }
  }, (err) => { console.error("watchAssociations:", err); callback(DEFAULT_ASSOCIATIONS); });
}

export async function saveAssociations(associations) {
  await setDoc(REF(), { associations });
}

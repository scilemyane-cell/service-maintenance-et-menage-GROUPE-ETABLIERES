// entreprises-data.js
// Liste des entreprises extérieures (prestataires) à qui une demande peut
// être attribuée : config/entreprises-exterieures : { liste: [{ nom, metier, tel, email }] }.
import { db } from "./firebase-init.js";
import { doc, onSnapshot, setDoc } from "./firestore-compte.js";

const REF = doc(db, "config", "entreprises-exterieures");

export function watchEntreprises(callback) {
  return onSnapshot(REF, (snap) => callback(snap.exists() && Array.isArray(snap.data().liste) ? snap.data().liste : []),
    (err) => { console.error("watchEntreprises:", err); callback([]); });
}

export async function saveEntreprises(liste) {
  const propre = liste.map(e => ({ nom: String(e.nom || "").trim(), contact: String(e.contact || "").trim(), metier: String(e.metier || "").trim(), tel: String(e.tel || "").trim(), email: String(e.email || "").trim() }))
    .filter(e => e.nom).sort((a, b) => a.nom.localeCompare(b.nom, "fr", { sensitivity: "base" }));
  await setDoc(REF, { liste: propre, majLe: Date.now() });
}

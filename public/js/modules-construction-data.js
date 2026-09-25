// modules-construction-data.js
// Modules "en construction" : tuiles que le Super Admin est en train de
// développer / tester. Tant qu'un module est marqué en construction, il
// est invisible pour tous les autres rôles (accueil, onglets, et ses
// chiffres dans Statistiques). Seul un Super Admin le voit, avec un
// bandeau 🚧 — sauf en mode "Aperçu en tant que…", où il voit l'appli
// exactement comme la personne choisie.
// Stocké dans config/modules-construction : { ids: ["stock-menage", …] }.

import { db } from "./firebase-init.js";
import { doc, onSnapshot, setDoc } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const REF = () => doc(db, "config", "modules-construction");
let courant = [];

export function watchModulesConstruction(callback) {
  return onSnapshot(REF(), (snap) => {
    courant = (snap.exists() && Array.isArray(snap.data().ids)) ? snap.data().ids : [];
    callback(courant);
  }, (err) => { console.error("watchModulesConstruction:", err); callback(courant); });
}

export async function basculerModuleConstruction(id) {
  const ids = courant.includes(id) ? courant.filter(x => x !== id) : [...courant, id];
  await setDoc(REF(), { ids }, { merge: true });
}

// Modules dont les données doivent être masquées pour cet utilisateur
// (vide pour un Super Admin hors mode aperçu).
export function modulesMasquesPour(user) {
  if (user && user.role === "super_admin" && !user.apercu) return [];
  return courant;
}
export function modulesEnConstruction() { return courant; }

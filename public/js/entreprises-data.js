// entreprises-data.js
// Liste des entreprises extérieures (prestataires) à qui une demande peut
// être attribuée : config/entreprises-exterieures :
// { liste: [{ nom, contact, metier, tel, email, notes }] }.
// Un seul écouteur partagé par toute l'appli.
import { db } from "./firebase-init.js";
import { doc, onSnapshot, setDoc } from "./firestore-compte.js";

const REF = doc(db, "config", "entreprises-exterieures");
const cache = { liste: [], pret: false, abonnes: new Set(), unsub: null };

export const cleEntreprise = (x) => String(x || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
export const entreprises = () => cache.liste;
export const entreprisesPretes = () => cache.pret;
export const ficheEntreprise = (nom) => cache.liste.find(e => cleEntreprise(e.nom) === cleEntreprise(nom));

// Abonnement (le premier abonné ouvre l'écoute Firestore). Renvoie de quoi se désabonner.
export function abonnerEntreprises(fn) {
  cache.abonnes.add(fn);
  if (!cache.unsub) cache.unsub = onSnapshot(REF, (snap) => {
    cache.liste = snap.exists() && Array.isArray(snap.data().liste) ? snap.data().liste : []; cache.pret = true;
    cache.abonnes.forEach(f => { try { f(cache.liste); } catch (e) { console.error(e); } });
  }, (err) => { console.error("entreprises:", err); cache.pret = true; });
  else if (cache.pret) setTimeout(() => fn(cache.liste), 0);
  return () => cache.abonnes.delete(fn);
}
// Compatibilité.
export function watchEntreprises(callback) { return abonnerEntreprises(callback); }

export async function saveEntreprises(liste) {
  const t = (x) => String(x || "").trim();
  const propre = liste.map(e => ({ nom: t(e.nom), contact: t(e.contact), metier: t(e.metier), tel: t(e.tel), email: t(e.email), notes: t(e.notes) }))
    .filter(e => e.nom).sort((a, b) => a.nom.localeCompare(b.nom, "fr", { sensitivity: "base" }));
  await setDoc(REF, { liste: propre, majLe: Date.now() });
}

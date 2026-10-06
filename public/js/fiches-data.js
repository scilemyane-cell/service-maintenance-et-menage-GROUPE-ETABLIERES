import { partager } from "./ecoute-partagee.js";
import { db } from "./firebase-init.js";
import {
  doc, setDoc, deleteDoc, serverTimestamp, deleteField, Timestamp,
  collection, onSnapshot,
} from "./firestore-compte.js";
import { ecoutePartagee } from "./ecoute-partagee.js";
import { ecouteDelta, majLocale } from "./cache-delta.js";

// Une fiche = un document par (site, semaine, agent).
// id du document : `${siteId}_${weekStart}_${uid}`
export function ficheId(siteId, weekStart, uid) {
  return `${siteId}_${weekStart}_${uid}`;
}

// QUOTA : copie locale des fiches + seules les fiches modifiées depuis la
// dernière visite sont relues (champ majLe posé à chaque enregistrement).
// Une fiche supprimée devient un « tombeau » (supprimeLe) pour que tous
// les appareils le voient ; elle est masquée partout.
export function watchFiches(callback) {
  return ecoutePartagee("fiches:delta", ecouteDelta({ cle: "fiches", col: "fiches", champs: ["majLe"] }),
    (liste) => callback(liste.filter(f => !f.supprimeLe)));
}
// Ancienne écoute complète (plus utilisée, gardée pour référence).
export const watchFichesComplet = partager("fiches", watchFichesBrut);
function watchFichesBrut(callback) {
  return onSnapshot(collection(db, "fiches"), (snap) => {
    const list = [];
    snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
    callback(list);
  }, (err) => { console.error("watchFiches:", err); callback([]); });
}

// Traçabilité honnête : une fiche remplie après la fin de sa semaine (+3 j)
// garde la date de cette saisie tardive (affichée sur la fiche et à l'impression).
function marquerSaisieTardive(data) {
  if (!data || data.saisieTardiveLe || !data.weekEnd) return data;
  const limite = new Date(String(data.weekEnd).slice(0, 10) + "T00:00:00"); limite.setDate(limite.getDate() + 3);
  const contenu = Object.values(data.cells || {}).some(Boolean) || Object.values(data.obs || {}).some(Boolean) || (data.chambres || []).length || data.observationsGenerales;
  if (Date.now() > limite.getTime() && contenu) { const d = new Date(); data.saisieTardiveLe = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
  return data;
}

export async function saveFiche(id, data) {
  marquerSaisieTardive(data);
  majLocale("fiches", id, { ...data, majLe: Timestamp.now(), supprimeLe: null });
  await setDoc(doc(db, "fiches", id), { ...data, majLe: serverTimestamp(), supprimeLe: deleteField() }, { merge: true });
}

// Suppression = fiche vidée et marquée supprimée (visible des autres appareils
// qui gardent une copie locale). agentUid conservé pour les règles.
export async function deleteFiche(id, agentUid = "") {
  majLocale("fiches", id, { supprimeLe: Timestamp.now(), majLe: Timestamp.now(), ...(agentUid ? { agentUid } : {}) }, { remplacer: true });
  await setDoc(doc(db, "fiches", id), { supprimeLe: serverTimestamp(), majLe: serverTimestamp(), ...(agentUid ? { agentUid } : {}) });
}
void deleteDoc;

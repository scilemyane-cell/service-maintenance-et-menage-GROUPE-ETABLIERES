import { partager } from "./ecoute-partagee.js";
import { db } from "./firebase-init.js";
import {
  doc, setDoc, deleteDoc, serverTimestamp, deleteField, Timestamp,
  collection, onSnapshot, addDoc,
} from "./firestore-compte.js";
import { auth } from "./firebase-init.js";
import { ecoutePartagee } from "./ecoute-partagee.js";
import { ecouteDelta, majLocale, docLocal } from "./cache-delta.js";

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
// Une correction d'une fiche déjà remplie n'est pas une saisie tardive.
const aDuContenu = (d) => !!d && (Object.values(d.cells || {}).some(Boolean) || Object.values(d.obs || {}).some(Boolean) || (d.chambres || []).length || d.observationsGenerales);
function marquerSaisieTardive(data, avant) {
  if (!data || !data.weekEnd) return data;
  const d = new Date(), auj = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  // Déjà remplie auparavant (rempliLe, ou fiche existante avec du contenu) → correction.
  const correction = !!data.rempliLe || (!data.reconstituee && aDuContenu(avant));
  const contenu = aDuContenu(data);
  if (contenu && !data.rempliLe) data.rempliLe = auj;
  if (data.saisieTardiveLe || correction) return data;
  const limite = new Date(String(data.weekEnd).slice(0, 10) + "T00:00:00"); limite.setDate(limite.getDate() + 3);
  if (Date.now() > limite.getTime() && contenu) data.saisieTardiveLe = auj;
  return data;
}

// Champs d'audit de la date de saisie : jamais écrits par l'enregistrement
// normal (une copie périmée à l'écran ne doit ni annuler une correction ni
// raccourcir l'historique). Seuls marquerSaisieTardive (1re fois) et
// corrigerDateSaisie les posent.
const CHAMPS_AUDIT = ["saisieTardiveLe", "saisieInitialeLe", "historiqueSaisie"];
export async function saveFiche(id, data) {
  const avant = docLocal("fiches", id);
  const dejaDatee = !!avant?.saisieTardiveLe;
  marquerSaisieTardive(data, avant);
  const envoi = { ...data };
  CHAMPS_AUDIT.forEach(k => delete envoi[k]);
  if (!dejaDatee && data.saisieTardiveLe && !avant?.saisieInitialeLe) { envoi.saisieTardiveLe = data.saisieTardiveLe; envoi.saisieInitialeLe = data.saisieTardiveLe; }
  majLocale("fiches", id, { ...envoi, majLe: Timestamp.now(), supprimeLe: null });
  await setDoc(doc(db, "fiches", id), { ...envoi, majLe: serverTimestamp(), supprimeLe: deleteField() }, { merge: true });
  journaliserModif(id, data, avant);
}

// ---- Journal de remplissage (qui, quand, quoi) ----
// Une ligne par enregistrement : cases cochées / décochées (avec leur jour),
// observations, envoi. Sert à vérifier à quelle heure les fiches sont
// remplies et à estimer le temps de présence (Traçabilité › Journal).
const appareil = () => { const u = navigator.userAgent || ""; return /iPhone|iPad/.test(u) ? "iPhone/iPad" : /Android/.test(u) ? "Android" : /Windows/.test(u) ? "PC Windows" : /Mac/.test(u) ? "Mac" : "autre"; };
function journal(ligne) {
  const uid = auth?.currentUser?.uid; if (!uid) return;
  addDoc(collection(db, "fiches-journal"), { ...ligne, auteurUid: uid, auteurAnonyme: !!auth.currentUser.isAnonymous, appareil: appareil(), at: Date.now(), atServeur: serverTimestamp() })
    .catch(e => console.warn("journal fiches :", e?.message || e));
}
function journaliserModif(id, data, avant) {
  const a = avant?.cells || {}, n = data.cells || {};
  const coches = Object.keys(n).filter(k => n[k] && !a[k]), decoches = Object.keys(a).filter(k => a[k] && !n[k]);
  const obs = Object.keys({ ...(avant?.obs || {}), ...(data.obs || {}) }).filter(k => (avant?.obs || {})[k] !== (data.obs || {})[k]).length
    + ((avant?.observationsGenerales || "") !== (data.observationsGenerales || "") ? 1 : 0);
  const envoi = !!data.submitted && !avant?.submitted, rouvert = !data.submitted && !!avant?.submitted;
  const validee = !!data.validee && !avant?.validee;
  if (!coches.length && !decoches.length && !obs && !envoi && !rouvert && !validee) return;
  journal({ type: "modif", ficheId: id, siteId: data.siteId || "", siteName: data.siteName || "", weekStart: data.weekStart || "",
    agentUid: data.agentUid || "", agentNom: data.agentNom || "", prestataire: !!data.prestataire, societe: data.societe || "",
    coches: coches.slice(0, 400), decoches: decoches.slice(0, 400), nbCoches: coches.length, nbDecoches: decoches.length, obs, envoi, rouvert, validee,
    faits: Object.values(n).filter(Boolean).length });
}
// Ouverture de l'écran de saisie (agent ou prestataire).
export function journaliserConnexion(info) {
  const uid = auth?.currentUser?.uid; if (!uid) return;
  // Une ligne par ouverture, sauf rechargement dans les 20 minutes.
  const cle = `fj-cnx-${uid}-${info.ecran || ""}`;
  try { const der = +localStorage.getItem(cle) || 0; if (Date.now() - der < 20 * 60000) return; localStorage.setItem(cle, String(Date.now())); } catch { /* */ }
  journal({ type: "connexion", ...info });
}

// Correction de la date de saisie (admins) : la date affichée/utilisée devient
// la nouvelle ; la date initiale est conservée (saisieInitialeLe) et chaque
// correction est ajoutée au journal (historiqueSaisie, jamais raccourci).
export async function corrigerDateSaisie(id, nouvelle, motif, user) {
  const f = docLocal("fiches", id) || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(nouvelle || "")) throw new Error("Date invalide");
  if (!String(motif || "").trim()) throw new Error("Motif obligatoire");
  if (!user || !["admin", "super_admin"].includes(user.role)) throw new Error("Réservé aux administrateurs");
  const ancienne = f.saisieTardiveLe || null;
  const entree = { ancienne, nouvelle, motif: String(motif).trim(), par: user.nom || user.email || "", parUid: user.uid || "", le: new Date().toISOString() };
  const champs = {
    saisieTardiveLe: nouvelle,
    saisieInitialeLe: f.saisieInitialeLe || ancienne || nouvelle,
    historiqueSaisie: [...(f.historiqueSaisie || []), entree],
  };
  majLocale("fiches", id, { ...champs, majLe: Timestamp.now() });
  await setDoc(doc(db, "fiches", id), { ...champs, majLe: serverTimestamp() }, { merge: true });
}

// Suppression = fiche vidée et marquée supprimée (visible des autres appareils
// qui gardent une copie locale). agentUid conservé pour les règles.
export async function deleteFiche(id, agentUid = "") {
  // Le journal de la date de saisie survit à la suppression.
  const f = docLocal("fiches", id) || {};
  const audit = {}; CHAMPS_AUDIT.forEach(k => { if (f[k] != null) audit[k] = f[k]; });
  majLocale("fiches", id, { ...audit, supprimeLe: Timestamp.now(), majLe: Timestamp.now(), ...(agentUid ? { agentUid } : {}) }, { remplacer: true });
  await setDoc(doc(db, "fiches", id), { ...audit, supprimeLe: serverTimestamp(), majLe: serverTimestamp(), ...(agentUid ? { agentUid } : {}) });
}
void deleteDoc;

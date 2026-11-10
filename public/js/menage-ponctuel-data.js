// menage-ponctuel-data.js — Ménage ponctuel (gros ménage) fait par une entreprise
// extérieure sur un site (ex. une maison du dispositif MNA), avec suivi.
//  • Une mission = un document « menage-ponctuel » dont l'identifiant est AUSSI
//    le code du lien prestataire (collection « invitations », type "ponctuel").
//  • Le prestataire ouvre le lien (guest.html?invite=…) : il pointe son arrivée
//    et son départ, coche les pièces faites avec photos avant / après, écrit
//    ses observations puis envoie. Le responsable vérifie et valide.
//  • Photos : collection « fiches-photos » (type "ponctuel" + ponctuelId),
//    mêmes règles que les photos des fiches (≈ 80–140 Ko chacune).
import { db, auth } from "./firebase-init.js";
import {
  doc, setDoc, updateDoc, deleteDoc, addDoc, collection, onSnapshot, query, where, getDocs,
} from "./firestore-compte.js";

export const COL_PONCTUEL = "menage-ponctuel";
const COL_PH = "fiches-photos";

function randomToken() {
  const b = new Uint8Array(16); crypto.getRandomValues(b);
  return Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
}

// Création (responsable) : mission + lien prestataire, même code.
export async function creerMission({ site, dispositif, entreprise, telephone = "", debut, fin, consignes = "", pieces = [], createdBy }) {
  const token = randomToken(), now = new Date().toISOString();
  await setDoc(doc(db, "invitations", token), {
    type: "ponctuel", ponctuelId: token, sites: [{ id: site.id, name: site.name }], siteId: site.id, siteName: site.name,
    weeks: [], debut, fin, label: entreprise, telephone, active: true, createdBy, createdAt: now,
  });
  await setDoc(doc(db, COL_PONCTUEL, token), {
    siteId: site.id, siteName: site.name, dispositif: dispositif || "", entreprise, telephone, debut, fin, consignes,
    pieces: pieces.map(nom => ({ nom })), faits: {}, obs: {}, passages: [], observations: "",
    presta: null, termine: null, validee: false, createdBy, createdAt: now, majLe: Date.now(),
  });
  return token;
}

export function watchMissions(cb) {
  return onSnapshot(collection(db, COL_PONCTUEL), (s) => cb(s.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => String(b.debut || "").localeCompare(String(a.debut || "")) || String(b.createdAt || "").localeCompare(String(a.createdAt || "")))),
  (e) => { console.warn("Ménage ponctuel :", e); cb([]); });
}
// Une seule mission (lecture par son code : marche aussi pour le prestataire).
export function ecouterMission(id, cb) {
  return onSnapshot(doc(db, COL_PONCTUEL, id), (s) => cb(s.exists() ? { id: s.id, ...s.data() } : null),
    (e) => { console.warn("Mission ménage :", e); cb(null); });
}
export const majMission = (id, champs) => updateDoc(doc(db, COL_PONCTUEL, id), { ...champs, majLe: Date.now() });

// Couper / rouvrir le lien du prestataire.
export const accesMission = (id, active) => updateDoc(doc(db, "invitations", id), { active });

export async function supprimerMission(id) {
  const ph = await getDocs(query(collection(db, COL_PH), where("ponctuelId", "==", id)));
  await Promise.all(ph.docs.map(d => deleteDoc(d.ref).catch(() => {})));
  await deleteDoc(doc(db, "invitations", id)).catch(() => {});
  await deleteDoc(doc(db, COL_PONCTUEL, id));
}

// ---- Photos ----
export function ecouterPhotosMission(id, cb) {
  return onSnapshot(query(collection(db, COL_PH), where("ponctuelId", "==", id)),
    (s) => cb(s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.le || 0) - (b.le || 0))),
    (e) => { console.warn("Photos ménage ponctuel :", e); cb([]); });
}
export async function ajouterPhotoMission(id, { data, piece = "", moment = "", par = "" }) {
  const uid = auth.currentUser?.uid; if (!uid) throw new Error("Non connecté");
  return addDoc(collection(db, COL_PH), { type: "ponctuel", ponctuelId: id, agentUid: uid, agentNom: par, piece, moment, data, legende: "", le: Date.now() });
}
export const supprimerPhotoMission = (photoId) => deleteDoc(doc(db, COL_PH, photoId));

// ---- Calculs communs (écran prestataire et suivi) ----
export const passageOuvert = (m) => (m?.passages || []).find(p => p.a && !p.d) || null;
export function minutesPassees(m) {
  return Math.round((m?.passages || []).reduce((t, p) => t + ((p.d || (p.a ? Date.now() : 0)) - (p.a || 0)), 0) / 60000);
}
export const fmtMin = (mn) => mn <= 0 ? "0 min" : `${Math.floor(mn / 60) ? Math.floor(mn / 60) + " h " : ""}${String(mn % 60).padStart(Math.floor(mn / 60) ? 2 : 1, "0")} min`;
export const nbFaits = (m) => (m?.pieces || []).filter((_, i) => m.faits?.[i]).length;
export function statutMission(m, actif = true) {
  if (m.validee) return { cle: "validee", ic: "✅", lib: "Validé" };
  if (m.termine) return { cle: "averifier", ic: "📨", lib: "Terminé — à vérifier" };
  if (passageOuvert(m)) return { cle: "encours", ic: "🟠", lib: "En cours sur place" };
  if ((m.passages || []).length || nbFaits(m)) return { cle: "commence", ic: "🟡", lib: "Commencé" };
  const d = new Date(), auj = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  if (!actif) return { cle: "coupe", ic: "⛔", lib: "Accès coupé" };
  if (m.fin && auj > m.fin) return { cle: "retard", ic: "🔴", lib: "Pas fait (date dépassée)" };
  return { cle: "prevu", ic: "🕓", lib: "Prévu" };
}
export const heureFr = (ms) => ms ? new Date(ms).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }).replace(":", "h") : "";
export const jourFr = (ms) => ms ? new Date(ms).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" }) : "";
export const dateFr = (iso) => iso ? new Date(iso + "T00:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "long" }) : "";
export const lienMission = (id) => `${location.origin}/guest.html?invite=${id}`;

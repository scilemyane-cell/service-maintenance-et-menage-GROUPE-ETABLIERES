import { db } from "./firebase-init.js";
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc,
  collection, onSnapshot,
} from "./firestore-compte.js";

// Code court (8 caractères, sans 0/O/1/l/I) : lien SMS lisible, ~10^14 combinaisons.
function randomToken() {
  const A = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => A[b % A.length]).join("");
}
// Remplace un ancien lien long par un lien court (copie de l'accès, l'ancien est supprimé).
export async function raccourcirInvitation(inv) {
  const { id, ...data } = inv;
  const token = randomToken();
  await setDoc(doc(db, "invitations", token), { ...data, ancienLien: id, modifieLe: new Date().toISOString() });
  await deleteDoc(doc(db, "invitations", id));
  return token;
}

export function watchInvitations(callback) {
  return onSnapshot(collection(db, "invitations"), (snap) => {
    const list = [];
    snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
    callback(list.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")));
  }, (err) => { console.error("watchInvitations:", err); callback([]); });
}

// Accès prestataire / remplaçant : un ou plusieurs sites, valable du … au …
export async function createInvitation({ sites, debut, fin, weeks, label, telephone = "", createdBy, type = "" }) {
  const token = randomToken();
  await setDoc(doc(db, "invitations", token), {
    ...(type ? { type } : {}),
    sites, siteId: sites[0]?.id || "", siteName: sites.map(s => s.name).join(", "), weeks, debut, fin, label, telephone,
    active: true, createdBy, createdAt: new Date().toISOString(),
  });
  return token;
}

// Lien d'accès d'un agent (sans mot de passe) à son espace, valable du … au …
export async function createLienAgent({ dispositif, agentUid, agentNom, debut, fin, telephone = "", createdBy }) {
  const token = randomToken();
  await setDoc(doc(db, "invitations", token), {
    type: "agent", dispositif, agentUid, agentNom, label: agentNom, debut, fin, telephone, weeks: [], sites: [],
    active: true, createdBy, createdAt: new Date().toISOString(),
  });
  return token;
}

// Infos pratiques pour un prestataire qui ne connaît pas les lieux (adresse,
// codes boîtes à clés, consignes par site, contact, mot d'accueil) : lues par
// la page invitée, sans accès aux autres collections (codes copiés ici).
export async function setInvitationInfos(token, infos) {
  await updateDoc(doc(db, "invitations", token), { infos });
}

// Modification d'un accès (prestataire, téléphone, dates, sites, semaines).
export async function updateInvitation(token, patch) {
  await updateDoc(doc(db, "invitations", token), { ...patch, modifieLe: new Date().toISOString() });
}

export async function setInvitationActive(token, active) {
  await updateDoc(doc(db, "invitations", token), { active });
}

export async function deleteInvitation(token) {
  await deleteDoc(doc(db, "invitations", token));
}

// Lecture ponctuelle (mode invité, pas d'écoute continue nécessaire)
export async function getInvitation(token) {
  const snap = await getDoc(doc(db, "invitations", token));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

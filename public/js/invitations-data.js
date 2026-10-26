import { db } from "./firebase-init.js";
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc,
  collection, onSnapshot,
} from "./firestore-compte.js";

function randomToken() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

export function watchInvitations(callback) {
  return onSnapshot(collection(db, "invitations"), (snap) => {
    const list = [];
    snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
    callback(list.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")));
  }, (err) => { console.error("watchInvitations:", err); callback([]); });
}

// Accès prestataire / remplaçant : un ou plusieurs sites, valable du … au …
export async function createInvitation({ sites, debut, fin, weeks, label, telephone = "", createdBy }) {
  const token = randomToken();
  await setDoc(doc(db, "invitations", token), {
    sites, siteId: sites[0]?.id || "", siteName: sites.map(s => s.name).join(", "), weeks, debut, fin, label, telephone,
    active: true, createdBy, createdAt: new Date().toISOString(),
  });
  return token;
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

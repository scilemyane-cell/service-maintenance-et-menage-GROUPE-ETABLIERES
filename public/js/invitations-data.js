import { db } from "./firebase-init.js";
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc,
  collection, onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

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

export async function createInvitation({ siteId, siteName, weeks, label, createdBy }) {
  const token = randomToken();
  await setDoc(doc(db, "invitations", token), {
    siteId, siteName, weeks, label,
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

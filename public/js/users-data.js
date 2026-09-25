import { db } from "./firebase-init.js";
import { doc, setDoc, updateDoc, collection, onSnapshot } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

export function watchUsers(callback) {
  return onSnapshot(collection(db, "users"), (snap) => {
    const list = [];
    snap.forEach((d) => list.push({ uid: d.id, ...d.data() }));
    callback(list.sort((a, b) => (a.nom || a.email || "").localeCompare(b.nom || b.email || "")));
  }, (err) => { console.error("watchUsers:", err); callback([]); });
}

export async function updateUser(uid, fields) {
  await updateDoc(doc(db, "users", uid), fields);
}

export async function createUserProfile(uid, fields) {
  await setDoc(doc(db, "users", uid), fields);
}

// ---- Comptes en attente de rattachement ----
// Cas d'un email qui a déjà un accès Firebase (Authentication) mais plus
// de profil dans l'appli (profil supprimé, compte créé à la main dans la
// console…) : l'appli ne peut pas créer le profil directement, faute de
// connaître son identifiant. Le profil est donc préparé ici, sous
// l'email, et rattaché automatiquement à la prochaine connexion de la
// personne (voir auth.js).
export async function preparerCompteEnAttente(email, profil) {
  await setDoc(doc(db, "comptes-en-attente", email.trim().toLowerCase()), { ...profil, preparerLe: Date.now() });
}

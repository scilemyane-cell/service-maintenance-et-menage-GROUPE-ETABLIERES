import { auth, db } from "./firebase-init.js";
import {
  signInWithEmailAndPassword, signOut, onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { doc, getDoc, setDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

// Rôles possibles : "super_admin" | "admin" | "n1" | "technicien" | "menage" | "mi_temps" | "direction"

export function login(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

export function logout() {
  return signOut(auth);
}

export async function getCurrentUserProfile(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snap.data() : null;
}

// callback reçoit soit null (déconnecté), soit { uid, email, nom, role, ... }
// Si l'utilisateur est authentifié mais n'a pas encore de document dans
// users/{uid} (cas du tout premier compte créé), callback reçoit un objet
// avec role: null pour que l'interface puisse afficher un message clair
// plutôt que planter.
// Profil préparé par un admin sous l'email (compte Firebase qui existait
// déjà, voir preparerCompteEnAttente dans users-data.js) : rattaché ici,
// une seule fois, à la première connexion.
async function rattacherCompteEnAttente(user) {
  if (!user.email) return null;
  const ref = doc(db, "comptes-en-attente", user.email.toLowerCase());
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    const { preparerLe, ...profil } = snap.data();
    await setDoc(doc(db, "users", user.uid), profil);
    await deleteDoc(ref).catch(() => {});
    return profil;
  } catch (e) {
    console.error("rattacherCompteEnAttente:", e);
    return null;
  }
}

export function watchAuth(callback) {
  onAuthStateChanged(auth, async (user) => {
    if (!user) { callback(null); return; }
    let profile = await getCurrentUserProfile(user.uid);
    if (!profile) profile = await rattacherCompteEnAttente(user);
    if (!profile) {
      callback({ uid: user.uid, email: user.email, role: null, nom: user.email });
      return;
    }
    callback({ uid: user.uid, email: user.email, ...profile });
  });
}

export function roleLabel(role) {
  const labels = {
    super_admin: "Super Administrateur",
    admin: "Administrateur",
    n1: "Superviseur",
    technicien: "Technicien",
    menage: "Agent d'entretien",
    mi_temps: "Salarié temps partiel",
    direction: "Direction (lecture seule)",
  };
  return labels[role] || "Rôle inconnu";
}

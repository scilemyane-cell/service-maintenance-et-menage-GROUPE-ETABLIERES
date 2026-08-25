import { auth, db } from "./firebase-init.js";
import {
  signInWithEmailAndPassword, signOut, onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

// Rôles possibles : "admin" | "n1" | "technicien" | "menage" | "mi_temps" | "direction"

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
export function watchAuth(callback) {
  onAuthStateChanged(auth, async (user) => {
    if (!user) { callback(null); return; }
    const profile = await getCurrentUserProfile(user.uid);
    if (!profile) {
      callback({ uid: user.uid, email: user.email, role: null, nom: user.email });
      return;
    }
    callback({ uid: user.uid, email: user.email, ...profile });
  });
}

export function roleLabel(role) {
  const labels = {
    admin: "Administrateur",
    n1: "Cadre astreinte (N1)",
    technicien: "Technicien",
    menage: "Agent d'entretien",
    mi_temps: "Salarié temps partiel",
    direction: "Direction (lecture seule)",
  };
  return labels[role] || "Rôle inconnu";
}

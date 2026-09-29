import { auth, db } from "./firebase-init.js";
import {
  signInWithEmailAndPassword, signOut, onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { doc, getDoc, setDoc, deleteDoc } from "./firestore-compte.js";
import { journaliserConnexion } from "./connexions-data.js";

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

// Profil mémorisé sur l'appareil : à l'ouverture, l'appli s'affiche tout
// de suite avec le profil connu, sans attendre l'aller-retour Firestore
// (lent sur téléphone). Le profil est relu en arrière-plan et mis à jour
// pour la prochaine ouverture ; les règles Firestore restent la vraie
// barrière de sécurité.
const CLE_PROFIL = "etablieres-profil";
function lireProfilMemo(uid) {
  try { const c = JSON.parse(localStorage.getItem(CLE_PROFIL) || "null"); return c && c.uid === uid && c.profil ? c.profil : null; } catch { return null; }
}
function memoriserProfil(uid, profil) {
  try { localStorage.setItem(CLE_PROFIL, JSON.stringify({ uid, profil })); localStorage.setItem("etablieres-connecte", "1"); } catch {}
}
function oublierProfil() {
  try { localStorage.removeItem(CLE_PROFIL); localStorage.removeItem("etablieres-connecte"); } catch {}
}

export function watchAuth(callback) {
  onAuthStateChanged(auth, async (user) => {
    if (!user) { oublierProfil(); callback(null); return; }
    const memo = lireProfilMemo(user.uid);
    if (memo && memo.role) {
      callback({ uid: user.uid, email: user.email, ...memo });
      journaliserConnexion(user, memo);
      import("./lectures-compteur.js").then(m => m.demarrerCompteurLectures({ uid: user.uid, nom: memo?.nom, email: user.email })).catch(() => {});
      getCurrentUserProfile(user.uid).then(p => { if (p) memoriserProfil(user.uid, p); }).catch(() => {});
      return;
    }
    let profile = await getCurrentUserProfile(user.uid);
    if (!profile) profile = await rattacherCompteEnAttente(user);
    journaliserConnexion(user, profile); // en arrière-plan, jamais bloquant
    import("./lectures-compteur.js").then(m => m.demarrerCompteurLectures({ uid: user.uid, nom: profile?.nom, email: user.email })).catch(() => {});
    if (!profile) {
      callback({ uid: user.uid, email: user.email, role: null, nom: user.email });
      return;
    }
    memoriserProfil(user.uid, profile);
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

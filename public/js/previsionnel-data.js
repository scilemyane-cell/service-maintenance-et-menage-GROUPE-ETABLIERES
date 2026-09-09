// previsionnel-data.js
// Prévisionnel travaux/investissement par site — chaque besoin identifié
// sur le terrain (toiture, cuisine, extincteurs...) est noté au fil de
// l'eau, avec un montant estimé et une année visée, plutôt que d'être
// reconstitué de mémoire au moment de préparer le budget pour le conseil
// d'administration. Une fois voté, chaque ligne passe en Validé/Refusé/
// Reporté pour garder un historique d'une année sur l'autre.

import { db } from "./firebase-init.js";
import {
  doc, addDoc, updateDoc, getDocs, onSnapshot, deleteDoc,
  collection,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const COLLECTION = "previsionnel-travaux";

export const CATEGORIES_TRAVAUX = [
  "Toiture", "Cuisine", "Salle de bain", "Chambres", "Extincteurs / Sécurité incendie",
  "VMC / Ventilation", "Chauffage", "Électricité", "Plomberie", "Menuiseries",
  "Peinture / Revêtements", "Espaces extérieurs", "Autre",
];

export const PRIORITES = { urgent: "🔴 Urgent", a_prevoir: "🟡 À prévoir", si_budget: "🟢 Si budget disponible" };
export const STATUTS = { propose: "Proposé", valide: "✅ Validé", refuse: "❌ Refusé", reporte: "⏳ Reporté" };

// Une fois VALIDÉ par le CA, une demande suit un avancement jusqu'à sa
// réalisation — permet à Frédéric de suivre où en est chaque travaux
// voté, pas seulement s'il a été accepté ou non.
export const AVANCEMENTS = {
  a_planifier: "À planifier", devis_demande: "Devis demandé",
  travaux_prevus: "Travaux prévus", travaux_en_cours: "Travaux en cours", termine: "✅ Terminé",
};

export function nouvelleLigne() {
  return {
    titre: "", categorie: "", description: "",
    montantEstime: 0, anneeVisee: new Date().getFullYear() + 1, typeAnnee: "civile", // "civile" | "scolaire"
    priorite: "a_prevoir", motif: "", photos: [],
    statut: "propose", dateStatut: null, statutParNom: "",
    avancement: null, dateAvancement: null, avancementParNom: "",
  };
}

// Libellé d'affichage de l'année visée, selon son type — "2026" pour une
// année civile, "2025-2026" pour une année scolaire (1er septembre au
// 31 août).
export function formatAnneeVisee(ligne) {
  if (ligne.typeAnnee === "scolaire") return `${ligne.anneeVisee}-${ligne.anneeVisee + 1}`;
  return String(ligne.anneeVisee);
}

// Flux temps réel de toutes les lignes — filtrage (année, site,
// priorité, statut) fait côté écran plutôt que par requête, le volume
// attendu restant raisonnable (quelques dizaines à centaines de lignes).
export function watchLignes(callback) {
  return onSnapshot(collection(db, COLLECTION), (snap) => {
    const list = [];
    snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
    callback(list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)));
  }, (err) => { console.error("watchLignes (prévisionnel travaux):", err); callback([]); });
}

export async function creerLigne(dossierId, dossierNom, data, user) {
  await addDoc(collection(db, COLLECTION), {
    dossierId, dossierNom, ...data,
    createdAt: Date.now(), createdByNom: user?.nom || user?.email || "Inconnu",
  });
}

export async function modifierLigne(id, patch) {
  await updateDoc(doc(db, COLLECTION, id), patch);
}

// Changement de statut après le vote en CA — tracé (qui, quand) pour
// garder un historique clair d'une année sur l'autre.
export async function changerStatut(id, statut, user) {
  await updateDoc(doc(db, COLLECTION, id), {
    statut, dateStatut: Date.now(), statutParNom: user?.nom || user?.email || "Inconnu",
  });
}

// Changement d'avancement (uniquement pertinent une fois validé) — tracé
// de la même façon.
export async function changerAvancement(id, avancement, user) {
  await updateDoc(doc(db, COLLECTION, id), {
    avancement, dateAvancement: Date.now(), avancementParNom: user?.nom || user?.email || "Inconnu",
  });
}

export async function supprimerLigne(id) {
  await deleteDoc(doc(db, COLLECTION, id));
}

// Toutes les années déjà présentes dans les données, plus l'année en
// cours et la suivante (toujours proposées, même sans ligne existante,
// pour préparer le budget de l'année prochaine facilement).
export function anneesDisponibles(lignes) {
  const maintenant = new Date().getFullYear();
  const annees = new Set([maintenant, maintenant + 1]);
  lignes.forEach(l => { if (l.anneeVisee) annees.add(l.anneeVisee); });
  return [...annees].sort((a, b) => b - a);
}

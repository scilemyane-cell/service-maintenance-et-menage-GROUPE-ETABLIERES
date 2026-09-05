// compteurs-data.js
// Relevés de compteurs (eau, gaz, électricité) par site — nouvel onglet
// indépendant "Relevé compteur". Un compteur électrique porte 4 index
// tarifaires standards pour les bâtiments tertiaires en Tarif Jaune/Vert :
// HPH (Heures Pleines Hiver), HCH (Heures Creuses Hiver), HPE (Heures
// Pleines Été), HCE (Heures Creuses Été) — à relever ensemble à chaque
// passage, avec une seule photo du tableau. Un compteur eau/gaz n'a
// qu'un seul index.

import { db } from "./firebase-init.js";
import {
  doc, addDoc, updateDoc, getDoc, getDocs,
  collection, query, where,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const COMPTEURS = "compteurs";
const RELEVES = "compteurs-releves";

export const INDEX_ELEC = ["HPH", "HCH", "HPE", "HCE"];
export const INDEX_LABELS = {
  HPH: "Heures Pleines Hiver", HCH: "Heures Creuses Hiver",
  HPE: "Heures Pleines Été", HCE: "Heures Creuses Été",
};

export function nouveauCompteur(type) {
  return {
    type, // "eau" | "gaz" | "elec"
    nom: type === "elec" ? "Tableau électrique" : type === "eau" ? "Compteur d'eau" : "Compteur de gaz",
    emplacement: "",
    supprimeLe: null,
    dernierReleve: null, // { at, valeurs, releveParNom } — mis en cache pour affichage rapide
  };
}

// Liste ponctuelle des dossiers de site ayant les compteurs activés —
// utilisée par l'écran principal du nouvel onglet.
export async function listerSitesAvecCompteurs() {
  const q = query(collection(db, "sites-dossiers"), where("compteursActifs", "==", true));
  const snap = await getDocs(q);
  const list = [];
  snap.forEach((d) => { if (!d.data().supprimeLe) list.push({ id: d.id, nom: d.data().nom }); });
  return list.sort((a, b) => (a.nom || "").localeCompare(b.nom || ""));
}

// Liste ponctuelle de tous les compteurs, tous sites confondus.
export async function listerTousLesCompteurs() {
  const snap = await getDocs(collection(db, COMPTEURS));
  const list = [];
  snap.forEach((d) => { if (!d.data().supprimeLe) list.push({ id: d.id, ...d.data() }); });
  return list;
}

export async function creerCompteur(dossierId, dossierNom, compteur) {
  const ref = await addDoc(collection(db, COMPTEURS), { dossierId, dossierNom, ...compteur });
  return ref.id;
}

export async function modifierCompteur(id, fields) {
  await updateDoc(doc(db, COMPTEURS, id), fields);
}

export async function envoyerCompteurCorbeille(id) {
  await updateDoc(doc(db, COMPTEURS, id), { supprimeLe: Date.now() });
}

// Un seul compteur, pour le lien direct par QR (ouvre l'écran de relevé
// sans avoir à charger toute la liste des sites).
export async function getCompteurUnique(id) {
  const snap = await getDoc(doc(db, COMPTEURS, id));
  if (!snap.exists() || snap.data().supprimeLe) return null;
  return { id: snap.id, ...snap.data() };
}

// Enregistre un relevé (historique) et met à jour le cache "dernier
// relevé" sur le compteur lui-même, pour un affichage rapide sans avoir
// à interroger l'historique à chaque fois.
export async function enregistrerReleve(compteur, valeurs, photo, user) {
  const at = Date.now();
  await addDoc(collection(db, RELEVES), {
    compteurId: compteur.id,
    dossierId: compteur.dossierId,
    dossierNom: compteur.dossierNom,
    type: compteur.type,
    nomCompteur: compteur.nom,
    valeurs,
    photoItemId: photo?.itemId || null,
    photoName: photo?.name || null,
    releveParUid: user?.uid || null,
    releveParNom: user?.nom || user?.email || "Inconnu",
    createdAt: at,
  });
  await updateDoc(doc(db, COMPTEURS, compteur.id), {
    dernierReleve: {
      at, valeurs,
      releveParNom: user?.nom || user?.email || "Inconnu",
      photoItemId: photo?.itemId || null,
    },
  });
}

// Historique complet d'un compteur, du plus récent au plus ancien.
export async function listerHistoriqueCompteur(compteurId) {
  const q = query(collection(db, RELEVES), where("compteurId", "==", compteurId));
  const snap = await getDocs(q);
  const list = [];
  snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
  return list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

// QR encodant un lien direct vers l'écran de relevé de ce compteur —
// scanné avec l'appareil photo normal du téléphone (hors appli), ça
// ouvre directement le bon formulaire.
export function qrPayloadForCompteur(compteurId) {
  return `https://service-maintenance-et-menage.web.app/app.html?compteurrelever=${compteurId}`;
}

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
  doc, addDoc, updateDoc, getDoc, getDocs, onSnapshot,
  collection, query, where,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const COMPTEURS = "compteurs";
const RELEVES = "compteurs-releves";

export const INDEX_ELEC = ["HPH", "HCH", "HPE", "HCE"];
export const INDEX_LABELS = {
  HPH: "Heures Pleines Hiver", HCH: "Heures Creuses Hiver",
  HPE: "Heures Pleines Été", HCE: "Heures Creuses Été",
};
export const MOIS_LABELS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];

// Clés d'index à relever (et donc à photographier) selon le type de
// compteur — une seule pour eau/gaz, les 4 index tarifaires pour l'élec.
export function clesIndex(type) {
  return type === "elec" ? INDEX_ELEC : ["valeur"];
}

export function nouveauCompteur(type) {
  return {
    type, // "eau" | "gaz" | "elec"
    nom: type === "elec" ? "Tableau électrique" : type === "eau" ? "Compteur d'eau" : "Compteur de gaz",
    emplacement: "",
    frequence: "mensuel", // "mensuel" | "annuel"
    echeanceJour: 1,      // pour "annuel" uniquement : jour/mois de l'échéance chaque année
    echeanceMois: 1,
    supprimeLe: null,
    dernierReleve: null, // { at, valeurs, releveParNom } — mis en cache pour affichage rapide
  };
}

const JOURS_TOLERANCE_MENSUEL = 32; // au-delà, un relevé mensuel est considéré "en retard"

// Date de la dernière échéance déjà passée pour un compteur "annuel" (le
// jour/mois configuré, cette année s'il est déjà passé, sinon l'an
// dernier). Sert de référence : si le dernier relevé est antérieur à
// cette date, l'échéance la plus récente n'a pas été honorée.
function derniereEcheanceAnnuelle(compteur) {
  const now = new Date();
  const jour = compteur.echeanceJour || 1;
  const mois = (compteur.echeanceMois || 1) - 1; // Date() : mois 0-indexé
  let echeance = new Date(now.getFullYear(), mois, jour);
  if (echeance > now) echeance = new Date(now.getFullYear() - 1, mois, jour);
  return echeance;
}

// Un compteur est "en retard" si :
// - fréquence mensuelle : aucun relevé depuis plus de ~32 jours ;
// - fréquence annuelle : l'échéance (jour/mois) la plus récente est
//   passée sans qu'un relevé n'ait été fait depuis.
export function estEnRetard(compteur) {
  if (compteur.frequence === "annuel") {
    if (!compteur.dernierReleve?.at) return true;
    return compteur.dernierReleve.at < derniereEcheanceAnnuelle(compteur).getTime();
  }
  if (!compteur.dernierReleve?.at) return true;
  return (Date.now() - compteur.dernierReleve.at) > JOURS_TOLERANCE_MENSUEL * 24 * 3600 * 1000;
}

export function prochaineEcheanceLabel(compteur) {
  if (compteur.frequence === "annuel") {
    return `chaque année le ${String(compteur.echeanceJour || 1).padStart(2, "0")}/${String(compteur.echeanceMois || 1).padStart(2, "0")}`;
  }
  return "tous les mois";
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
// à interroger l'historique à chaque fois. `photos` est un objet avec
// les mêmes clés que `valeurs` (HPH/HCH/HPE/HCE pour l'électricité,
// "valeur" pour eau/gaz) — une photo par index relevé, l'écran d'un
// compteur multi-tarif n'affichant souvent qu'un seul index à la fois.
// `dateAntidatee` (optionnel, en ms) permet à un superviseur/admin de
// saisir un relevé à une date passée (ex. oublié la semaine dernière) —
// réservé aux éditeurs côté interface ET côté règles Firestore, un
// technicien ne pouvant enregistrer qu'à la date/heure du moment.
export async function enregistrerReleve(compteur, valeurs, photos, user, dateAntidatee = null) {
  const at = dateAntidatee || Date.now();
  await addDoc(collection(db, RELEVES), {
    compteurId: compteur.id,
    dossierId: compteur.dossierId,
    dossierNom: compteur.dossierNom,
    type: compteur.type,
    nomCompteur: compteur.nom,
    valeurs,
    photos, // { [clé]: { itemId, name } }
    releveParUid: user?.uid || null,
    releveParNom: user?.nom || user?.email || "Inconnu",
    createdAt: at,
    saisiHorsDate: !!dateAntidatee,
  });
  await updateDoc(doc(db, COMPTEURS, compteur.id), {
    dernierReleve: {
      at, valeurs, photos,
      releveParNom: user?.nom || user?.email || "Inconnu",
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

// Nombre de compteurs "en retard", tous sites confondus — flux temps
// réel utilisé pour le badge de la tuile "Relevé compteur" sur l'écran
// d'accueil, sans avoir à ouvrir l'onglet.
export function watchCompteursAlertCount(callback) {
  return onSnapshot(collection(db, COMPTEURS), (snap) => {
    let n = 0;
    snap.forEach((d) => {
      const c = d.data();
      if (!c.supprimeLe && estEnRetard(c)) n++;
    });
    callback(n);
  }, (err) => { console.error("watchCompteursAlertCount:", err); callback(0); });
}

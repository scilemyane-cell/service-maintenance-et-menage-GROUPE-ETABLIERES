import { db } from "./firebase-init.js";
import {
  doc, setDoc, deleteDoc, addDoc,
  collection, onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

// Les 16 catégories standard reprises de la fiche index papier — servent
// de modèle de départ pour chaque nouveau dossier, afin d'uniformiser la
// structure entre toutes les résidences.
export const SECTIONS_STANDARD = [
  "Compteurs de gaz",
  "Vanne de coupure générale gaz",
  "Compteurs électricité Linky",
  "Coupure générale électricité / TGBT",
  "Tableau électrique d'accueil / communs",
  "Compteurs d'eau généraux",
  "Vanne d'arrêt générale d'eau",
  "Nourrices de distribution (collecteurs)",
  "Baie de brassage (réseau & télécom)",
  "VMC (ventilation / arrêt d'urgence)",
  "Lieux des boîtes à clés",
  "Locaux poubelles & planning de ramassage",
  "Registre de sécurité unique",
  "Centrale incendie (SSI / détection)",
  "Centrale intrusion (alarme)",
  "Accès aux clés et badges",
];

export const URGENCES_STANDARD = [
  { service: "Sapeurs-Pompiers", mission: "Secours aux personnes, incendie", telephone: "18 ou 112" },
  { service: "Police Secours", mission: "Sécurité, vandalisme", telephone: "17" },
  { service: "SAMU", mission: "Urgence médicale grave", telephone: "15" },
];

// Ordre standard des équipements, modifiable depuis l'onglet Paramètres —
// stocké à part de SECTIONS_STANDARD (qui reste la valeur d'origine/repli
// si personne n'a encore rien personnalisé).
const SETTINGS_DOC = doc(db, "config", "site-dossier-sections");

export function watchSectionsOrder(callback) {
  return onSnapshot(SETTINGS_DOC, (snap) => {
    const titres = snap.exists() ? snap.data().titres : null;
    callback(Array.isArray(titres) && titres.length > 0 ? titres : SECTIONS_STANDARD);
  }, (err) => { console.error("watchSectionsOrder:", err); callback(SECTIONS_STANDARD); });
}

export async function saveSectionsOrder(titres) {
  await setDoc(SETTINGS_DOC, { titres });
}

export function watchSitesDossiers(callback) {
  return onSnapshot(collection(db, "sites-dossiers"), (snap) => {
    const list = [];
    snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
    callback(list.sort((a, b) => (a.nom || "").localeCompare(b.nom || "")));
  }, (err) => { console.error("watchSitesDossiers:", err); callback([]); });
}

export function nouveauDossier(sectionsOrder) {
  const titres = Array.isArray(sectionsOrder) && sectionsOrder.length > 0 ? sectionsOrder : SECTIONS_STANDARD;
  return {
    nom: "Nouvelle résidence",
    adresse: "",
    association: "",
    groupe: "",
    urgences: JSON.parse(JSON.stringify(URGENCES_STANDARD)),
    sections: titres.map(titre => ({ titre, concerne: false, emplacement: "", procedure: "", photos: [] })),
  };
}

export async function createDossier(data) {
  const ref = await addDoc(collection(db, "sites-dossiers"), data);
  return ref.id;
}

export async function saveDossier(id, data) {
  await setDoc(doc(db, "sites-dossiers", id), data);
}

export async function deleteDossier(id) {
  await deleteDoc(doc(db, "sites-dossiers", id));
}

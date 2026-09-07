// masterlock-data.js
// Codes Masterlock (boîtes à clés) par site — nouvel onglet indépendant
// "🔐 Codes Masterlock", en lien avec les Dossiers de site : la fiche
// d'un dossier affiche en lecture seule les codes actuels de son site
// (voir watchCodesForSite, utilisée par site-dossier.js), pour que la
// mise à jour d'un code ici se reflète immédiatement là-bas, sans jamais
// écraser le texte libre déjà saisi sur la fiche du dossier.
//
// Chaque changement de code est tracé dans un historique séparé, jamais
// modifiable/supprimable (intégrité) — utile en cas de doute sur "quel
// était le code avant" ou "qui l'a changé".

import { db } from "./firebase-init.js";
import {
  doc, addDoc, updateDoc, getDocs, onSnapshot,
  collection, query, where,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const CODES = "masterlock-codes";
const HISTORIQUE = "masterlock-historique";

export function nouveauCode() {
  return {
    nom: "Boîte à clés",
    code: "",
    notes: "",
    supprimeLe: null,
    derniereMajAt: null,
    derniereMajParNom: "",
  };
}

// Importe automatiquement les codes déjà présents en texte libre sur les
// fiches de dossier de site (ex. section "Lieux des boîtes à clés",
// procédure "CODE 8572") — pour ne pas obliger à tout retaper à la main
// dans ce nouvel onglet alors que l'info existe déjà ailleurs. Ne crée
// une entrée QUE pour un site qui n'en a encore aucune (jamais de
// doublon ni d'écrasement d'un code déjà géré ici). Renvoie le nombre
// d'entrées importées.
export async function importerCodesDepuisDossiers(user) {
  const [dossiersSnap, existants] = await Promise.all([
    getDocs(collection(db, "sites-dossiers")),
    listerTousLesCodes(),
  ]);
  const sitesAvecCodeDeja = new Set(existants.map(c => c.dossierId));
  const motsCles = ["boîte", "boite", "clé", "cle", "masterlock"];
  let importes = 0;

  for (const d of dossiersSnap.docs) {
    const data = d.data();
    if (data.supprimeLe || sitesAvecCodeDeja.has(d.id)) continue;
    const sections = data.sections || [];
    for (const section of sections) {
      const titre = (section.titre || "").toLowerCase();
      if (!section.concerne || !motsCles.some(m => titre.includes(m))) continue;
      const texte = `${section.procedure || ""} ${section.emplacement || ""}`;
      const match = texte.match(/\d{3,}/); // au moins 3 chiffres à la suite = probablement un code
      if (!match) continue;
      const entry = nouveauCode();
      entry.nom = section.titre || "Boîte à clés";
      entry.code = match[0];
      entry.notes = section.emplacement || "";
      await creerCode(d.id, data.nom, entry, user);
      importes++;
      break; // un seul import par site pour cette passe, même s'il y a plusieurs sections correspondantes
    }
  }
  return importes;
}

// Tous les dossiers de site (pas de réglage d'activation à cocher ici :
// n'importe quel site peut avoir une ou plusieurs boîtes à clés).
export async function listerSitesPourMasterlock() {
  const snap = await getDocs(collection(db, "sites-dossiers"));
  const list = [];
  snap.forEach((d) => {
    if (!d.data().supprimeLe) list.push({ id: d.id, nom: d.data().nom, association: d.data().association || "", groupe: d.data().groupe || "" });
  });
  return list.sort((a, b) => (a.nom || "").localeCompare(b.nom || ""));
}

export async function listerTousLesCodes() {
  const snap = await getDocs(collection(db, CODES));
  const list = [];
  snap.forEach((d) => { if (!d.data().supprimeLe) list.push({ id: d.id, ...d.data() }); });
  return list;
}

export async function creerCode(dossierId, dossierNom, entry, user) {
  const ref = await addDoc(collection(db, CODES), {
    dossierId, dossierNom, ...entry,
    derniereMajAt: Date.now(), derniereMajParNom: user?.nom || user?.email || "Inconnu",
  });
  if (entry.code) {
    await addDoc(collection(db, HISTORIQUE), {
      codeId: ref.id, dossierId, dossierNom, nom: entry.nom,
      ancienCode: null, nouveauCode: entry.code,
      modifieParNom: user?.nom || user?.email || "Inconnu", at: Date.now(),
    });
  }
  return ref.id;
}

// Modifie une boîte à clés — enregistre un historique UNIQUEMENT si le
// code lui-même a changé (pas pour un simple changement de nom/notes).
export async function modifierCode(entryActuel, patch, user) {
  const nomAffiche = user?.nom || user?.email || "Inconnu";
  await updateDoc(doc(db, CODES, entryActuel.id), { ...patch, derniereMajAt: Date.now(), derniereMajParNom: nomAffiche });
  if (patch.code !== undefined && patch.code !== entryActuel.code) {
    await addDoc(collection(db, HISTORIQUE), {
      codeId: entryActuel.id, dossierId: entryActuel.dossierId, dossierNom: entryActuel.dossierNom,
      nom: patch.nom || entryActuel.nom,
      ancienCode: entryActuel.code || null, nouveauCode: patch.code,
      modifieParNom: nomAffiche, at: Date.now(),
    });
  }
}

export async function supprimerCode(id) {
  await updateDoc(doc(db, CODES, id), { supprimeLe: Date.now() });
}

export async function listerHistoriquePourSite(dossierId) {
  const q = query(collection(db, HISTORIQUE), where("dossierId", "==", dossierId));
  const snap = await getDocs(q);
  const list = [];
  snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
  return list.sort((a, b) => (b.at || 0) - (a.at || 0));
}

// Flux temps réel des codes d'UN site — utilisé par site-dossier.js pour
// afficher, en lecture seule, les codes actuels directement sur la fiche
// du dossier ("le dossier de site se met à jour").
export function watchCodesForSite(dossierId, callback) {
  const q = query(collection(db, CODES), where("dossierId", "==", dossierId));
  return onSnapshot(q, (snap) => {
    const list = [];
    snap.forEach((d) => { if (!d.data().supprimeLe) list.push({ id: d.id, ...d.data() }); });
    callback(list.sort((a, b) => (a.nom || "").localeCompare(b.nom || "")));
  }, (err) => { console.error("watchCodesForSite:", err); callback([]); });
}

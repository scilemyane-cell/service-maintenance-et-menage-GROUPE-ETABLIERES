// export-sharepoint.js
// Synchronisation quotidienne automatique des données de l'appli vers de
// vraies listes SharePoint, en complément de Firestore (qui reste la base
// de travail en temps réel). Consultable directement dans le navigateur
// SharePoint, sans rien télécharger — répond à l'exigence de la charte
// numérique sans réécrire toute l'architecture de données.

import { db } from "./firebase-init.js";
import {
  doc, getDoc, setDoc, getDocs, collection,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { getGraphTokenSilentOnly } from "./graph-auth.js";
import { synchroniserListe, urlListe } from "./sharepoint-lists.js";

const STATUS_DOC = doc(db, "config", "export-sharepoint-status");

function todayStr() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

// ---- Extraction et mise à plat des données, module par module ----
// Noms de colonnes en un seul mot (PascalCase, sans espace/accent) pour
// coller exactement aux noms de champs internes SharePoint et éviter tout
// souci d'encodage entre le nom affiché et la clé technique.

async function extraireStockProduits() {
  const snap = await getDocs(collection(db, "stock-produits"));
  const lignes = [];
  snap.forEach(d => {
    const p = d.data();
    if (p.supprimeLe) return;
    lignes.push({
      Nom: p.nom || "", Categorie: p.categorie || "", Unite: p.unite || "",
      StockActuel: p.stockActuel ?? 0, StockCible: p.stockCible ?? 0, SeuilMin: p.stockMin ?? 0,
      Fournisseur: p.fournisseurNom || "", EmailFournisseur: p.fournisseurEmail || "", RefFournisseur: p.refFournisseur || "",
    });
  });
  return lignes;
}
const COLONNES_STOCK_PRODUITS = [
  { nom: "Nom", type: "text" }, { nom: "Categorie", type: "text" }, { nom: "Unite", type: "text" },
  { nom: "StockActuel", type: "number" }, { nom: "StockCible", type: "number" }, { nom: "SeuilMin", type: "number" },
  { nom: "Fournisseur", type: "text" }, { nom: "EmailFournisseur", type: "text" }, { nom: "RefFournisseur", type: "text" },
];

async function extraireStockSites() {
  const [itemsSnap, sitesSnap] = await Promise.all([
    getDocs(collection(db, "stock-site-items")),
    getDocs(collection(db, "sites-dossiers")),
  ]);
  const nomsSites = new Map();
  sitesSnap.forEach(d => nomsSites.set(d.id, d.data().nom));
  const lignes = [];
  itemsSnap.forEach(d => {
    const it = d.data();
    lignes.push({
      Site: nomsSites.get(it.dossierId) || it.dossierId || "",
      Article: it.nom || "", Unite: it.unite || "", Quantite: it.quantite ?? 0,
      CiblePermanente: it.quantiteCible ?? 0,
      Origine: it.catalogueOrigine === "central" ? "Catalogue central" : it.produitId ? "Liste type sites" : "Propre au site",
    });
  });
  return lignes;
}
const COLONNES_STOCK_SITES = [
  { nom: "Site", type: "text" }, { nom: "Article", type: "text" }, { nom: "Unite", type: "text" },
  { nom: "Quantite", type: "number" }, { nom: "CiblePermanente", type: "number" }, { nom: "Origine", type: "text" },
];

async function extraireInterventions() {
  const snap = await getDocs(collection(db, "interventions"));
  const lignes = [];
  snap.forEach(d => {
    const i = d.data();
    lignes.push({
      Date: i.date || "", Intervenant: i.technicien || "", Association: i.association || "", Groupe: i.groupe || "", Site: i.site || "",
      Type: i.type || "", Heures: i.heures ?? 0, HeureDepart: i.heureDebut || "", HeureRetour: i.heureFin || "",
      Description: i.description || "", TransmisAuManager: !!i.transmis,
    });
  });
  return lignes;
}
const COLONNES_INTERVENTIONS = [
  { nom: "Date", type: "text" }, { nom: "Intervenant", type: "text" }, { nom: "Association", type: "text" },
  { nom: "Groupe", type: "text" }, { nom: "Site", type: "text" }, { nom: "Type", type: "text" },
  { nom: "Heures", type: "number" }, { nom: "HeureDepart", type: "text" }, { nom: "HeureRetour", type: "text" },
  { nom: "Description", type: "text", long: true }, { nom: "TransmisAuManager", type: "boolean" },
];

async function extraireDossiersSite() {
  const snap = await getDocs(collection(db, "sites-dossiers"));
  const lignes = [];
  snap.forEach(d => {
    const dd = d.data();
    if (dd.supprimeLe) return;
    lignes.push({
      Nom: dd.nom || "", Adresse: dd.adresse || "", Association: dd.association || "", Groupe: dd.groupe || "",
      StockDeporte: !!dd.stockDeporte,
      NbEquipementsConcernes: (dd.sections || []).filter(s => s.concerne).length,
      NbNumerosUrgence: (dd.urgences || []).length,
    });
  });
  return lignes;
}
const COLONNES_DOSSIERS_SITE = [
  { nom: "Nom", type: "text" }, { nom: "Adresse", type: "text" }, { nom: "Association", type: "text" },
  { nom: "Groupe", type: "text" }, { nom: "StockDeporte", type: "boolean" },
  { nom: "NbEquipementsConcernes", type: "number" }, { nom: "NbNumerosUrgence", type: "number" },
];

// ---- Orchestration ----

export const MODULES = [
  { nom: "Stock central", colonnes: COLONNES_STOCK_PRODUITS, extraire: extraireStockProduits },
  { nom: "Stock par site", colonnes: COLONNES_STOCK_SITES, extraire: extraireStockSites },
  { nom: "Interventions", colonnes: COLONNES_INTERVENTIONS, extraire: extraireInterventions },
  { nom: "Dossiers de site", colonnes: COLONNES_DOSSIERS_SITE, extraire: extraireDossiersSite },
];

// Déclenchée automatiquement à la connexion (voir app.html). Ne synchronise
// qu'une fois par jour, et seulement si une session Microsoft est déjà
// active dans le navigateur (jamais de popup de connexion imposée).
export async function runDailyExportIfNeeded() {
  try {
    const snap = await getDoc(STATUS_DOC);
    const last = snap.exists() ? snap.data().lastExportDate : null;
    if (last === todayStr()) return; // déjà fait aujourd'hui

    const token = await getGraphTokenSilentOnly();
    if (!token) return; // pas de session Microsoft active, on retentera au prochain login

    for (const mod of MODULES) {
      const lignes = await mod.extraire();
      await synchroniserListe(token, mod.nom, mod.colonnes, lignes);
    }

    await setDoc(STATUS_DOC, { lastExportDate: todayStr(), lastExportAt: new Date().toISOString() }, { merge: true });
  } catch (e) {
    console.error("Synchronisation quotidienne SharePoint échouée :", e);
    // Échec silencieux — ne doit jamais bloquer l'usage normal de l'appli.
  }
}

// Déclenchement manuel (bouton "Synchroniser maintenant"), avec token
// interactif si besoin (peut demander une connexion Microsoft).
export async function exporterMaintenant(getTokenInteractif, onProgress) {
  const token = await getTokenInteractif();
  for (const mod of MODULES) {
    onProgress?.(mod.nom);
    const lignes = await mod.extraire();
    await synchroniserListe(token, mod.nom, mod.colonnes, lignes);
  }
  await setDoc(STATUS_DOC, { lastExportDate: todayStr(), lastExportAt: new Date().toISOString() }, { merge: true });
}

export async function getStatutExport() {
  const snap = await getDoc(STATUS_DOC);
  return snap.exists() ? snap.data() : null;
}

export { urlListe };

// export-sharepoint.js
// Export quotidien automatique des données de l'appli vers SharePoint, en
// complément du stockage Firestore (qui reste la base de travail en temps
// réel). Un fichier Excel par module, remplacé à chaque export — répond à
// l'exigence de la charte numérique (stockage Office 365) sans réécrire
// toute l'architecture de données.

import { db } from "./firebase-init.js";
import {
  doc, getDoc, setDoc, getDocs, collection,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { getGraphTokenSilentOnly } from "./graph-auth.js";
import { uploadToDrive, EXPORTS_ROOT_FOLDER } from "./sharepoint-storage.js";

const STATUS_DOC = doc(db, "config", "export-sharepoint-status");

function todayStr() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function tsToStr(ts) {
  if (!ts) return "";
  if (ts.toDate) return ts.toDate().toLocaleString("fr-FR");
  return String(ts);
}

// Construit un classeur Excel à partir de lignes déjà à plat (tableau
// d'objets simples : clé = colonne, valeur = cellule).
function construireClasseur(lignes, nomFeuille) {
  const ws = window.XLSX.utils.json_to_sheet(lignes);
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, nomFeuille.slice(0, 31)); // limite Excel
  return wb;
}

async function exporterModule(token, nomFichier, lignes, nomFeuille) {
  if (!window.XLSX) throw new Error("Librairie Excel non chargée (vérifier app.html)");
  const wb = construireClasseur(lignes.length > 0 ? lignes : [{ Info: "Aucune donnée" }], nomFeuille);
  const arrayBuffer = window.XLSX.write(wb, { type: "array", bookType: "xlsx" });
  const blob = new Blob([arrayBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const file = new File([blob], nomFichier, { type: blob.type });
  await uploadToDrive(file, token, [], EXPORTS_ROOT_FOLDER, { conflictBehavior: "replace", fixedFilename: nomFichier });
}

// ---- Extraction et mise à plat des données, module par module ----

async function extraireStockProduits() {
  const snap = await getDocs(collection(db, "stock-produits"));
  const lignes = [];
  snap.forEach(d => {
    const p = d.data();
    if (p.supprimeLe) return;
    lignes.push({
      Nom: p.nom, Catégorie: p.categorie, Unité: p.unite,
      "Stock actuel": p.stockActuel, "Stock cible": p.stockCible, "Seuil min": p.stockMin,
      Fournisseur: p.fournisseurNom, "Email fournisseur": p.fournisseurEmail, "Réf. fournisseur": p.refFournisseur,
    });
  });
  return lignes;
}

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
      Site: nomsSites.get(it.dossierId) || it.dossierId,
      Article: it.nom, Unité: it.unite, Quantité: it.quantite,
      "Cible permanente": it.quantiteCible,
      Origine: it.catalogueOrigine === "central" ? "Catalogue central" : it.produitId ? "Liste type sites" : "Propre au site",
    });
  });
  return lignes;
}

async function extraireInterventions() {
  const snap = await getDocs(collection(db, "interventions"));
  const lignes = [];
  snap.forEach(d => {
    const i = d.data();
    lignes.push({
      Date: i.date, Intervenant: i.technicien, Association: i.association, Groupe: i.groupe, Site: i.site,
      Type: i.type, Heures: i.heures, "Heure départ": i.heureDebut, "Heure retour": i.heureFin,
      Description: i.description, "Transmis au manager": i.transmis ? "Oui" : "Non",
    });
  });
  return lignes;
}

async function extraireDossiersSite() {
  const snap = await getDocs(collection(db, "sites-dossiers"));
  const lignes = [];
  snap.forEach(d => {
    const dd = d.data();
    if (dd.supprimeLe) return;
    lignes.push({
      Nom: dd.nom, Adresse: dd.adresse, Association: dd.association, Groupe: dd.groupe,
      "Stock déporté": dd.stockDeporte ? "Oui" : "Non",
      "Nb équipements concernés": (dd.sections || []).filter(s => s.concerne).length,
      "Nb numéros d'urgence": (dd.urgences || []).length,
    });
  });
  return lignes;
}

// ---- Orchestration ----

const MODULES = [
  { fichier: "Stock_central.xlsx", feuille: "Stock central", extraire: extraireStockProduits },
  { fichier: "Stock_par_site.xlsx", feuille: "Stock par site", extraire: extraireStockSites },
  { fichier: "Interventions.xlsx", feuille: "Interventions", extraire: extraireInterventions },
  { fichier: "Dossiers_de_site.xlsx", feuille: "Dossiers de site", extraire: extraireDossiersSite },
];

// Déclenchée automatiquement à la connexion (voir app.html). N'exporte
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
      await exporterModule(token, mod.fichier, lignes, mod.feuille);
    }

    await setDoc(STATUS_DOC, { lastExportDate: todayStr(), lastExportAt: new Date().toISOString() }, { merge: true });
  } catch (e) {
    console.error("Export quotidien SharePoint échoué :", e);
    // Échec silencieux — ne doit jamais bloquer l'usage normal de l'appli.
  }
}

// Déclenchement manuel (bouton "Exporter maintenant"), avec token
// interactif si besoin (peut demander une connexion Microsoft).
export async function exporterMaintenant(getTokenInteractif, onProgress) {
  const token = await getTokenInteractif();
  for (const mod of MODULES) {
    onProgress?.(mod.feuille);
    const lignes = await mod.extraire();
    await exporterModule(token, mod.fichier, lignes, mod.feuille);
  }
  await setDoc(STATUS_DOC, { lastExportDate: todayStr(), lastExportAt: new Date().toISOString() }, { merge: true });
}

export async function getStatutExport() {
  const snap = await getDoc(STATUS_DOC);
  return snap.exists() ? snap.data() : null;
}

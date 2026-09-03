// export-sharepoint.js
// Export quotidien automatique des données de l'appli vers SharePoint, en
// complément du stockage Firestore (qui reste la base de travail en temps
// réel). Un PDF propre par module (tableau mis en forme), remplacé à
// chaque export — répond à l'exigence de la charte numérique (stockage
// Office 365) sans réécrire toute l'architecture de données.
//
// PDF plutôt qu'Excel : même mécanisme fiable qu'un simple envoi de
// fichier (comme les photos), sans les soucis de droits rencontrés avec
// les listes SharePoint natives ni les limites de mise en forme de la
// librairie Excel gratuite.

import { db } from "./firebase-init.js";
import {
  doc, getDoc, setDoc, getDocs, collection,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { esc } from "./astreinte-logic.js";
import { getGraphTokenSilentOnly } from "./graph-auth.js";
import { uploadToDrive, EXPORTS_ROOT_FOLDER } from "./sharepoint-storage.js";

const STATUS_DOC = doc(db, "config", "export-sharepoint-status");

function todayStr() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

// Empreinte compacte du contenu des lignes — sert à détecter si les
// données ont changé depuis le dernier export, pour ne créer une archive
// datée que quand c'est réellement utile (pas de doublon si rien n'a
// bougé). Simple hash (FNV-1a), pas une empreinte cryptographique.
function empreinte(lignes) {
  const texte = JSON.stringify(lignes);
  let h = 0x811c9dc5;
  for (let i = 0; i < texte.length; i++) {
    h ^= texte.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36) + ":" + texte.length;
}

// Construit un rapport HTML soigné (titre, date, tableau) à partir de
// lignes déjà à plat (tableau d'objets simples : clé = colonne).
function construireRapportHTML(titre, lignes) {
  const colonnes = lignes.length > 0 ? Object.keys(lignes[0]) : [];
  return `
    <div style="font-family:Calibri,Arial,sans-serif;background:#fff;color:#111;padding:24px;width:100%">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px">
        <span style="font-size:20px;font-weight:700">${esc(titre)}</span>
        <span style="font-size:11px;color:#666">Groupe Établières · Service Maintenance et Ménage</span>
      </div>
      <p style="font-size:11px;color:#666;margin:0 0 18px">Généré le ${esc(new Date().toLocaleString("fr-FR"))} · ${lignes.length} ligne(s)</p>
      ${lignes.length === 0 ? `<p style="font-size:13px;color:#666">Aucune donnée pour l'instant.</p>` : `
        <div style="display:grid;grid-template-columns:repeat(${colonnes.length},1fr);width:100%">
          ${colonnes.map(c => `<div style="border:1px solid #999;background:#B08D46;color:#fff;padding:5px 7px;font-size:10px;font-weight:700;overflow-wrap:break-word;word-break:break-word">${esc(c)}</div>`).join("")}
          ${lignes.map((ligne, i) => colonnes.map(c => `<div style="border:1px solid #ccc;background:${i % 2 === 0 ? '#ffffff' : '#F5F3EE'};padding:4px 7px;font-size:10px;overflow-wrap:break-word;word-break:break-word">${esc(ligne[c] == null ? '' : String(ligne[c]))}</div>`).join("")).join("")}
        </div>
      `}
    </div>
  `;
}

async function genererPdf(titre, lignes) {
  if (!window.html2pdf) throw new Error("Librairie PDF non chargée (vérifier app.html)");

  const hidden = document.createElement("div");
  hidden.style.cssText = "position:fixed;top:0;left:0;width:1000px;opacity:0.01;pointer-events:none;z-index:-1;";
  document.body.appendChild(hidden);
  hidden.innerHTML = construireRapportHTML(titre, lignes);
  // On capture l'élément de contenu réel (position statique, à l'intérieur
  // du conteneur hors-écran) plutôt que le conteneur position:fixed
  // lui-même — html2canvas peut produire une capture blanche quand la
  // cible capturée a elle-même position:fixed.
  const cible = hidden.firstElementChild;

  // Laisse le navigateur mettre en page le contenu ajouté avant de le
  // capturer — sans ce délai, html2canvas peut photographier une zone
  // encore vide (page blanche) juste après l'insertion dans le DOM.
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  try {
    return await window.html2pdf()
      .set({
        margin: 10,
        filename: `${titre}.pdf`,
        image: { type: "jpeg", quality: 0.92 },
        html2canvas: { scale: 2, backgroundColor: "#ffffff" },
        jsPDF: { unit: "mm", format: "a4", orientation: lignes.length > 0 && Object.keys(lignes[0]).length > 6 ? "landscape" : "portrait" },
      })
      .from(cible)
      .outputPdf("blob");
  } finally {
    hidden.remove();
  }
}

// Envoie la version "actuelle" (nom fixe, toujours remplacée — accès
// rapide au dernier état) et, si les données ont changé depuis le dernier
// export, archive aussi une copie datée (jamais écrasée — conserve un
// historique consultable dans le temps, sans dupliquer inutilement quand
// rien n'a bougé).
async function genererEtEnvoyerPdf(token, nomFichier, titre, lignes, dernieresEmpreintes) {
  const blob = await genererPdf(titre, lignes);
  const fileActuel = new File([blob], nomFichier, { type: "application/pdf" });
  await uploadToDrive(fileActuel, token, [], EXPORTS_ROOT_FOLDER, { conflictBehavior: "replace", fixedFilename: nomFichier });

  const emp = empreinte(lignes);
  if (dernieresEmpreintes[nomFichier] !== emp) {
    const nomArchive = `${nomFichier.replace(/\.pdf$/, "")}_${todayStr()}.pdf`;
    const fileArchive = new File([blob], nomArchive, { type: "application/pdf" });
    await uploadToDrive(fileArchive, token, ["Archives"], EXPORTS_ROOT_FOLDER, { conflictBehavior: "replace", fixedFilename: nomArchive });
    dernieresEmpreintes[nomFichier] = emp;
  }
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

async function extraireHistoriqueInventaires() {
  const [mouvSnap, produitsSnap, usersSnap] = await Promise.all([
    getDocs(collection(db, "stock-mouvements")),
    getDocs(collection(db, "stock-produits")),
    getDocs(collection(db, "users")),
  ]);
  const nomsProduits = new Map();
  produitsSnap.forEach(d => nomsProduits.set(d.id, d.data().nom));
  const nomsUsers = new Map();
  usersSnap.forEach(d => nomsUsers.set(d.id, d.data().nom || d.data().email));
  const lignes = [];
  mouvSnap.forEach(d => {
    const m = d.data();
    lignes.push({
      Date: m.date?.toDate ? m.date.toDate().toLocaleString("fr-FR") : "",
      Produit: nomsProduits.get(m.produitId) || m.produitId,
      "Quantité avant": m.quantiteAvant, "Quantité après": m.quantiteApres,
      "Compté par": nomsUsers.get(m.uid) || m.uid || "",
    });
  });
  // Plus récent en premier.
  lignes.sort((a, b) => (b.Date || "").localeCompare(a.Date || ""));
  return lignes;
}

async function extraireFichesMenage() {
  const [sitesSnap, fichesSnap] = await Promise.all([
    getDoc(doc(db, "config", "menage-sites")),
    getDocs(collection(db, "fiches")),
  ]);
  const sites = sitesSnap.exists() ? (sitesSnap.data().sites || []) : [];
  const parSiteId = new Map(sites.map(s => [s.id, s]));
  const lignes = [];
  fichesSnap.forEach(d => {
    const f = d.data();
    const site = parSiteId.get(f.siteId);
    lignes.push({
      Dispositif: site?.dispositif || "Dispositif MNA",
      Site: f.siteName || site?.name || "",
      Agent: f.agentNom,
      "Semaine du": f.weekStart, "Semaine au": f.weekEnd,
      Terminée: f.submitted ? "Oui" : "Non",
      "Nb chambres suivies": (f.chambres || []).length,
      "Observations générales": f.observationsGenerales || "",
    });
  });
  return lignes;
}

// ---- Orchestration ----

const MODULES = [
  { fichier: "Stock_central.pdf", titre: "Stock central", extraire: extraireStockProduits },
  { fichier: "Stock_par_site.pdf", titre: "Stock par site", extraire: extraireStockSites },
  { fichier: "Historique_inventaires.pdf", titre: "Historique des inventaires", extraire: extraireHistoriqueInventaires },
  { fichier: "Interventions.pdf", titre: "Interventions", extraire: extraireInterventions },
  { fichier: "Fiches_menage.pdf", titre: "Fiches de traçabilité ménage", extraire: extraireFichesMenage },
];

// Déclenchée automatiquement à la connexion (voir app.html). N'exporte
// qu'une fois par jour, et seulement si une session Microsoft est déjà
// active dans le navigateur (jamais de popup de connexion imposée).
export async function runDailyExportIfNeeded() {
  try {
    const snap = await getDoc(STATUS_DOC);
    const statut = snap.exists() ? snap.data() : {};
    if (statut.lastExportDate === todayStr()) return; // déjà fait aujourd'hui

    const token = await getGraphTokenSilentOnly();
    if (!token) return; // pas de session Microsoft active, on retentera au prochain login

    const dernieresEmpreintes = { ...(statut.empreintes || {}) };
    for (const mod of MODULES) {
      const lignes = await mod.extraire();
      await genererEtEnvoyerPdf(token, mod.fichier, mod.titre, lignes, dernieresEmpreintes);
    }

    await setDoc(STATUS_DOC, { lastExportDate: todayStr(), lastExportAt: new Date().toISOString(), empreintes: dernieresEmpreintes }, { merge: true });
  } catch (e) {
    console.error("Export quotidien SharePoint échoué :", e);
    // Échec silencieux — ne doit jamais bloquer l'usage normal de l'appli.
  }
}

// Déclenchement manuel (bouton "Exporter maintenant"), avec token
// interactif si besoin (peut demander une connexion Microsoft).
export async function exporterMaintenant(getTokenInteractif, onProgress) {
  const token = await getTokenInteractif();
  const snap = await getDoc(STATUS_DOC);
  const statut = snap.exists() ? snap.data() : {};
  const dernieresEmpreintes = { ...(statut.empreintes || {}) };
  for (const mod of MODULES) {
    onProgress?.(mod.titre);
    const lignes = await mod.extraire();
    await genererEtEnvoyerPdf(token, mod.fichier, mod.titre, lignes, dernieresEmpreintes);
  }
  await setDoc(STATUS_DOC, { lastExportDate: todayStr(), lastExportAt: new Date().toISOString(), empreintes: dernieresEmpreintes }, { merge: true });
}

export async function getStatutExport() {
  const snap = await getDoc(STATUS_DOC);
  return snap.exists() ? snap.data() : null;
}

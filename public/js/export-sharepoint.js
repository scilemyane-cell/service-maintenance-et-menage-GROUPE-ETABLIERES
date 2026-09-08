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
import { consommationMensuelle, clesIndex } from "./compteurs-data.js";
import { listerTousLesCodes } from "./masterlock-data.js";

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
// rien n'a bougé). `dossierSegments` : chemin de sous-dossiers dédié à ce
// module/site dans ExportsDonnees, pour ne pas tout mélanger à plat (ex.
// ["Stock"], ["Relevé de compteur", "LE CAP"]...). `cleEmpreinte` distingue les
// fichiers de même nom dans des dossiers différents (ex. plusieurs sites)
// dans le suivi "a changé depuis le dernier export ?".
async function genererEtEnvoyerPdf(token, dossierSegments, nomFichier, titre, lignes, dernieresEmpreintes, cleEmpreinte = nomFichier) {
  const blob = await genererPdf(titre, lignes);
  const fileActuel = new File([blob], nomFichier, { type: "application/pdf" });
  await uploadToDrive(fileActuel, token, dossierSegments, EXPORTS_ROOT_FOLDER, { conflictBehavior: "replace", fixedFilename: nomFichier });

  const emp = empreinte(lignes);
  if (dernieresEmpreintes[cleEmpreinte] !== emp) {
    const nomArchive = `${nomFichier.replace(/\.pdf$/, "")}_${todayStr()}.pdf`;
    const fileArchive = new File([blob], nomArchive, { type: "application/pdf" });
    await uploadToDrive(fileArchive, token, [...dossierSegments, "Archives"], EXPORTS_ROOT_FOLDER, { conflictBehavior: "replace", fixedFilename: nomArchive });
    dernieresEmpreintes[cleEmpreinte] = emp;
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
      "Compté par": nomsUsers.get(m.uid) || "Non identifié",
    });
  });
  // Plus récent en premier.
  lignes.sort((a, b) => (b.Date || "").localeCompare(a.Date || ""));
  return lignes;
}

async function extraireSortiesStockSites() {
  const [mouvSnap, itemsSnap, sitesSnap, usersSnap] = await Promise.all([
    getDocs(collection(db, "stock-site-mouvements")),
    getDocs(collection(db, "stock-site-items")),
    getDocs(collection(db, "sites-dossiers")),
    getDocs(collection(db, "users")),
  ]);
  const nomsArticles = new Map();
  const siteDeArticle = new Map();
  itemsSnap.forEach(d => { nomsArticles.set(d.id, d.data().nom); siteDeArticle.set(d.id, d.data().dossierId); });
  const nomsSites = new Map();
  sitesSnap.forEach(d => nomsSites.set(d.id, d.data().nom));
  const nomsUsers = new Map();
  usersSnap.forEach(d => nomsUsers.set(d.id, d.data().nom || d.data().email));
  const lignes = [];
  mouvSnap.forEach(d => {
    const m = d.data();
    lignes.push({
      Date: m.date?.toDate ? m.date.toDate().toLocaleString("fr-FR") : "",
      Type: m.type === "sortie" ? "Sortie" : "Actualisation",
      Site: nomsSites.get(siteDeArticle.get(m.itemId)) || "",
      Article: nomsArticles.get(m.itemId) || m.itemId,
      "Quantité avant": m.quantiteAvant, "Quantité après": m.quantiteApres,
      "Quantité sortie": m.quantiteSortie ?? "",
      "Logement concerné": m.logement || "",
      "Effectué par": nomsUsers.get(m.uid) || "Non identifié",
    });
  });
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

const TYPE_LABEL_RELEVE = { eau: "Eau", gaz: "Gaz", chauffage: "Chauffage urbain", elec: "Électricité" };
const UNITE_TYPE = { eau: "m³", gaz: "m³", chauffage: "kWh", elec: "kWh" };

// Ne dépend pas du type du compteur (qui peut avoir changé depuis, ex.
// passage de 4 à 1 index) : regarde directement la forme des valeurs
// enregistrées sur CE relevé — un seul "valeur" (eau/gaz/chauffage/élec
// mono-index), ou plusieurs clés d'index (élec multi-tarif).
function formatValeursReleve(r) {
  if (r.valeurs?.valeur !== undefined) return `${r.valeurs.valeur ?? "?"} ${UNITE_TYPE[r.type] || ""}`;
  return Object.entries(r.valeurs || {}).map(([k, v]) => `${k}=${v ?? "?"}`).join(" / ");
}

async function extraireRelevesCompteurs() {
  const snap = await getDocs(collection(db, "compteurs-releves"));
  const lignes = [];
  snap.forEach(d => {
    const r = d.data();
    lignes.push({
      Date: r.createdAt ? new Date(r.createdAt).toLocaleString("fr-FR") : "",
      Site: r.dossierNom || "",
      Compteur: r.nomCompteur || "",
      Type: TYPE_LABEL_RELEVE[r.type] || r.type,
      Valeur: formatValeursReleve(r),
      "Relevé par": r.releveParNom || "",
      Antidaté: r.saisiHorsDate ? "Oui" : "Non",
    });
  });
  lignes.sort((a, b) => (b.Date || "").localeCompare(a.Date || ""));
  return lignes;
}

// Regroupe les mêmes données par site, sans la colonne "Site" (rendue
// inutile puisque chaque site aura son propre fichier/dossier) — sert au
// PDF détaillé par site, en plus du récapitulatif global ci-dessus.
async function extraireRelevesParSite() {
  const snap = await getDocs(collection(db, "compteurs-releves"));
  const parSite = new Map(); // nomSite -> lignes[]
  snap.forEach(d => {
    const r = d.data();
    const nomSite = r.dossierNom || "Site inconnu";
    if (!parSite.has(nomSite)) parSite.set(nomSite, []);
    parSite.get(nomSite).push({
      Date: r.createdAt ? new Date(r.createdAt).toLocaleString("fr-FR") : "",
      Compteur: r.nomCompteur || "",
      Type: TYPE_LABEL_RELEVE[r.type] || r.type,
      Valeur: formatValeursReleve(r),
      "Relevé par": r.releveParNom || "",
      Antidaté: r.saisiHorsDate ? "Oui" : "Non",
    });
  });
  parSite.forEach(lignes => lignes.sort((a, b) => (b.Date || "").localeCompare(a.Date || "")));
  return parSite;
}

// Génère, en plus du récapitulatif global (voir MODULES), un PDF détaillé
// par site — chacun dans son propre sous-dossier (ExportsDonnees/
// Relevé de compteur/[Nom du site]/) plutôt que tout mélanger dans un
// seul fichier.
async function exporterRelevesCompteursParSite(token, dernieresEmpreintes) {
  const parSite = await extraireRelevesParSite();
  for (const [nomSite, lignes] of parSite) {
    await genererEtEnvoyerPdf(
      token, ["Relevé de compteur", nomSite], "Releves.pdf", `Relevés de compteurs — ${nomSite}`,
      lignes, dernieresEmpreintes, `RelevéDeCompteur/${nomSite}`
    );
  }
}

// Année scolaire (1er septembre au 31 août) correspondant à une date —
// utilisée pour découper l'historique de chaque compteur en sections,
// plus parlant qu'une année civile pour un établissement.
function anneeScolaire(ms) {
  if (!ms) return "Date inconnue";
  const d = new Date(ms);
  const debut = d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear() - 1; // getMonth() : 8 = septembre
  return `${debut}-${debut + 1}`;
}

const TYPE_LABEL_COMPTEUR = { eau: "Eau", gaz: "Gaz", chauffage: "Chauffage urbain", elec: "Électricité" };

// PDF détaillé d'UN SEUL compteur : graphique en bâtons de la
// consommation mensuelle sur 12 mois, puis l'historique complet des
// relevés découpé par année scolaire (la plus récente en premier).
async function genererPdfCompteur(compteur, releves) {
  if (!window.html2pdf) throw new Error("Librairie PDF non chargée (vérifier app.html)");
  const cles = clesIndex(compteur);
  const clesConso = cles;

  const parAnnee = new Map();
  [...releves].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).forEach(r => {
    const annee = anneeScolaire(r.createdAt);
    if (!parAnnee.has(annee)) parAnnee.set(annee, []);
    parAnnee.get(annee).push(r);
  });
  const anneesTriees = [...parAnnee.keys()].sort().reverse();

  const ligneStyle = (bg) => `border:1px solid #ccc;background:${bg};padding:4px 7px;font-size:10px`;
  const enteteStyle = `border:1px solid #999;background:#B08D46;color:#fff;padding:5px 7px;font-size:10px;font-weight:700`;

  const html = `
    <div style="font-family:Calibri,Arial,sans-serif;background:#fff;color:#111;padding:24px;width:100%">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px">
        <span style="font-size:20px;font-weight:700">${esc(compteur.nom)} — ${esc(compteur.dossierNom)}</span>
        <span style="font-size:11px;color:#666">Groupe Établières · Service Maintenance et Ménage</span>
      </div>
      <p style="font-size:11px;color:#666;margin:0 0 18px">${esc(TYPE_LABEL_COMPTEUR[compteur.type] || compteur.type)}${compteur.emplacement ? " · " + esc(compteur.emplacement) : ""} · Généré le ${esc(new Date().toLocaleString("fr-FR"))}</p>
      ${releves.length >= 2 ? `<canvas id="cpt-export-chart" width="900" height="280" style="width:100%;max-width:900px;margin-bottom:20px"></canvas>` : ""}
      ${releves.length === 0 ? `<p style="font-size:13px;color:#666">Aucun relevé enregistré pour l'instant.</p>` : anneesTriees.map(annee => `
        <h3 style="font-size:14px;margin:18px 0 8px;border-bottom:2px solid #B08D46;padding-bottom:4px">Année scolaire ${esc(annee)}</h3>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);width:100%">
          <div style="${enteteStyle}">Date</div><div style="${enteteStyle}">Valeur(s)</div>
          <div style="${enteteStyle}">Relevé par</div><div style="${enteteStyle}">Antidaté</div>
          ${parAnnee.get(annee).map((r, i) => {
            const valeurs = formatValeursReleve(r);
            const bg = i % 2 === 0 ? "#ffffff" : "#F5F3EE";
            return `
              <div style="${ligneStyle(bg)}">${esc(r.createdAt ? new Date(r.createdAt).toLocaleString("fr-FR") : "")}</div>
              <div style="${ligneStyle(bg)}">${esc(valeurs)}</div>
              <div style="${ligneStyle(bg)}">${esc(r.releveParNom || "")}</div>
              <div style="${ligneStyle(bg)}">${r.saisiHorsDate ? "Oui" : "Non"}</div>
            `;
          }).join("")}
        </div>
      `).join("")}
    </div>
  `;

  const hidden = document.createElement("div");
  hidden.style.cssText = "position:fixed;top:0;left:0;width:1000px;opacity:0.01;pointer-events:none;z-index:-1;";
  document.body.appendChild(hidden);
  hidden.innerHTML = html;
  const cible = hidden.firstElementChild;
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  // Graphique en bâtons de la consommation mensuelle sur 12 mois.
  let chart = null;
  if (releves.length >= 2 && window.Chart) {
    const canvas = hidden.querySelector("#cpt-export-chart");
    const parCle = clesConso.map(cle => consommationMensuelle(releves, cle, 12));
    const couleursChart = [
      { fill: "rgba(176,141,70,.75)", bord: "#B08D46" },
      { fill: "rgba(63,182,172,.75)", bord: "#3FB6AC" },
      { fill: "rgba(229,83,61,.75)", bord: "#E5533D" },
      { fill: "rgba(139,124,240,.75)", bord: "#8B7CF0" },
    ];
    const datasets = clesConso.map((cle, i) => ({
      label: cle === "valeur" ? `Consommation (${UNITE_TYPE[compteur.type] || "m³"})` : `${cle} (kWh)`,
      data: parCle[i].map(m => m.valeur),
      backgroundColor: couleursChart[i % couleursChart.length].fill,
      borderColor: couleursChart[i % couleursChart.length].bord,
      borderWidth: 1.5,
      borderRadius: 5,
      borderSkipped: false,
      maxBarThickness: 34,
    }));
    chart = new window.Chart(canvas.getContext("2d"), {
      type: "bar",
      data: { labels: parCle[0].map(m => m.label), datasets },
      options: {
        responsive: false, animation: false,
        plugins: {
          legend: { display: clesConso.length > 1, position: "bottom", labels: { color: "#333", boxWidth: 12, boxHeight: 12, padding: 12, font: { size: 11 } } },
          title: { display: true, text: "Consommation par mois — 12 derniers mois", color: "#1a1a1a", font: { size: 14, weight: "700" }, padding: { bottom: 12 } },
        },
        scales: {
          x: { ticks: { color: "#555", font: { size: 10 } }, grid: { display: false } },
          y: { ticks: { color: "#555", font: { size: 10 } }, beginAtZero: true, grid: { color: "rgba(0,0,0,.06)" } },
        },
      },
    });
    await new Promise(resolve => setTimeout(resolve, 200)); // laisse Chart.js finir de dessiner avant la capture
  }

  try {
    return await window.html2pdf()
      .set({
        margin: 10, filename: `${compteur.nom}.pdf`,
        image: { type: "jpeg", quality: 0.92 },
        html2canvas: { scale: 2, backgroundColor: "#ffffff" },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
      })
      .from(cible)
      .outputPdf("blob");
  } finally {
    chart?.destroy();
    hidden.remove();
  }
}

// Un PDF PAR COMPTEUR (pas juste par site) : chacun dans
// ExportsDonnees/Compteurs/[Site]/[Eau|Gaz|Électricité]/[Nom].pdf — un
// compteur d'eau n'est ainsi jamais mélangé avec un compteur électrique.
async function exporterPdfParCompteur(token, dernieresEmpreintes) {
  const [compteursSnap, relevesSnap] = await Promise.all([
    getDocs(collection(db, "compteurs")),
    getDocs(collection(db, "compteurs-releves")),
  ]);
  const relevesParCompteur = new Map();
  relevesSnap.forEach(d => {
    const r = d.data();
    if (!relevesParCompteur.has(r.compteurId)) relevesParCompteur.set(r.compteurId, []);
    relevesParCompteur.get(r.compteurId).push(r);
  });

  for (const d of compteursSnap.docs) {
    const compteur = { id: d.id, ...d.data() };
    if (compteur.supprimeLe) continue;
    const releves = relevesParCompteur.get(compteur.id) || [];
    const blob = await genererPdfCompteur(compteur, releves);
    const nomFichier = `${compteur.nom}.pdf`.replace(/[\\/:*?"<>|]/g, "-");
    const dossierSegments = ["Relevé de compteur", compteur.dossierNom, TYPE_LABEL_COMPTEUR[compteur.type] || compteur.type];

    const fileActuel = new File([blob], nomFichier, { type: "application/pdf" });
    await uploadToDrive(fileActuel, token, dossierSegments, EXPORTS_ROOT_FOLDER, { conflictBehavior: "replace", fixedFilename: nomFichier });

    const cleEmpreinte = `Compteur/${compteur.id}`;
    const emp = empreinte(releves.map(r => ({ v: r.valeurs, d: r.createdAt })));
    if (dernieresEmpreintes[cleEmpreinte] !== emp) {
      const nomArchive = `${nomFichier.replace(/\.pdf$/, "")}_${todayStr()}.pdf`;
      const fileArchive = new File([blob], nomArchive, { type: "application/pdf" });
      await uploadToDrive(fileArchive, token, [...dossierSegments, "Archives"], EXPORTS_ROOT_FOLDER, { conflictBehavior: "replace", fixedFilename: nomArchive });
      dernieresEmpreintes[cleEmpreinte] = emp;
    }
  }
}

// Attend que toutes les images d'un conteneur aient fini de charger (ou
// aient échoué) avant de continuer — html2canvas peut sinon capturer la
// page avant qu'une image (ex. le logo) ait eu le temps de s'afficher,
// laissant un espace vide dans le PDF généré.
function attendreImages(container) {
  const imgs = [...container.querySelectorAll("img")];
  return Promise.all(imgs.map(img => img.complete ? Promise.resolve() : new Promise(resolve => {
    img.addEventListener("load", resolve, { once: true });
    img.addEventListener("error", resolve, { once: true }); // on continue quand même plutôt que de bloquer indéfiniment
    setTimeout(resolve, 3000); // filet de sécurité
  })));
}

// ---- Codes Masterlock (avec logo, meme style visuel que le recap
// imprimable de l'onglet dedie) ----

async function genererPdfMasterlock(codes) {
  if (!window.html2pdf) throw new Error("Librairie PDF non chargée (vérifier app.html)");
  const parSite = new Map();
  codes.forEach(c => {
    const nomSite = c.dossierNom || "Site inconnu";
    if (!parSite.has(nomSite)) parSite.set(nomSite, []);
    parSite.get(nomSite).push(c);
  });
  const sitesTries = [...parSite.keys()].sort((a, b) => a.localeCompare(b));

  const carteCode = (c) => `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:6px 10px;border:1px solid #e2ddd0;border-radius:6px;background:#FAF8F3;margin-bottom:4px">
      <div style="min-width:0">
        <p style="margin:0;font-weight:700;font-size:12px;color:#222">${esc(c.nom)}</p>
        ${c.notes ? `<p style="margin:0;font-size:10px;color:#777">${esc(c.notes)}</p>` : ""}
      </div>
      <div style="flex:none;background:#B08D46;color:#fff;font-weight:800;font-size:16px;letter-spacing:2px;border-radius:5px;padding:3px 12px;white-space:nowrap">${esc(c.code || "—")}</div>
    </div>
  `;

  const html = `
    <div style="font-family:Calibri,Arial,sans-serif;background:#fff;color:#111;width:100%">
      <div style="background:linear-gradient(135deg,#1a1a1a,#2b2b2b);padding:14px 20px;display:flex;align-items:center;gap:14px">
        <img src="img/logo-etablieres.png" alt="Groupe Établières" style="height:40px;background:#fff;border-radius:6px;padding:4px">
        <div>
          <p style="margin:0;color:#D9B24C;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase">Groupe Établières · Service Maintenance et Ménage</p>
          <h1 style="margin:1px 0 0;color:#fff;font-size:17px">Codes Masterlock — Récapitulatif</h1>
        </div>
      </div>
      <div style="padding:14px 20px">
        <p style="margin:0 0 10px;font-size:10px;color:#a00;font-weight:700;background:#fdecea;border:1px solid #f5c6c1;border-radius:5px;padding:5px 10px;display:inline-block">Document sensible — usage interne uniquement. Généré le ${esc(new Date().toLocaleString("fr-FR"))}.</p>
        ${sitesTries.length === 0 ? `<p style="font-size:13px;color:#666">Aucun code enregistré pour l'instant.</p>` : sitesTries.map(nomSite => `
          <div style="border:1px solid #ddd;border-radius:8px;padding:8px 10px;margin-bottom:8px;break-inside:avoid">
            <h4 style="margin:0 0 5px;font-size:12px;color:#111;border-bottom:1.5px solid #B08D46;padding-bottom:3px">${esc(nomSite)}</h4>
            ${parSite.get(nomSite).map(carteCode).join("")}
          </div>
        `).join("")}
      </div>
    </div>
  `;

  const hidden = document.createElement("div");
  hidden.style.cssText = "position:fixed;top:0;left:0;width:800px;opacity:0.01;pointer-events:none;z-index:-1;";
  document.body.appendChild(hidden);
  hidden.innerHTML = html;
  const cible = hidden.firstElementChild;
  await attendreImages(cible); // sinon html2canvas peut capturer avant la fin du chargement du logo
  try {
    return await window.html2pdf()
      .set({
        margin: 10, filename: "Codes_masterlock.pdf",
        image: { type: "jpeg", quality: 0.92 },
        html2canvas: { scale: 2, backgroundColor: "#ffffff" },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
      })
      .from(cible)
      .outputPdf("blob");
  } finally {
    hidden.remove();
  }
}

async function exporterCodesMasterlock(token, dernieresEmpreintes) {
  const codes = await listerTousLesCodes();
  const blob = await genererPdfMasterlock(codes);
  const nomFichier = "Codes_masterlock.pdf";
  const dossierSegments = ["Codes Masterlock"];

  const fileActuel = new File([blob], nomFichier, { type: "application/pdf" });
  await uploadToDrive(fileActuel, token, dossierSegments, EXPORTS_ROOT_FOLDER, { conflictBehavior: "replace", fixedFilename: nomFichier });

  const cleEmpreinte = "CodesMasterlock";
  const emp = empreinte(codes.map(c => ({ nom: c.nom, code: c.code, notes: c.notes, site: c.dossierNom })));
  if (dernieresEmpreintes[cleEmpreinte] !== emp) {
    const nomArchive = `Codes_masterlock_${todayStr()}.pdf`;
    const fileArchive = new File([blob], nomArchive, { type: "application/pdf" });
    await uploadToDrive(fileArchive, token, [...dossierSegments, "Archives"], EXPORTS_ROOT_FOLDER, { conflictBehavior: "replace", fixedFilename: nomArchive });
    dernieresEmpreintes[cleEmpreinte] = emp;
  }
}

// ---- Orchestration ----

const MODULES = [
  { dossier: ["Stock"], fichier: "Stock_central.pdf", titre: "Stock central", extraire: extraireStockProduits },
  { dossier: ["Stock"], fichier: "Stock_par_site.pdf", titre: "Stock par site", extraire: extraireStockSites },
  { dossier: ["Stock"], fichier: "Historique_inventaires.pdf", titre: "Historique des inventaires", extraire: extraireHistoriqueInventaires },
  { dossier: ["Stock"], fichier: "Historique_sorties_sites.pdf", titre: "Sorties de stock par site", extraire: extraireSortiesStockSites },
  { dossier: ["Interventions"], fichier: "Interventions.pdf", titre: "Interventions", extraire: extraireInterventions },
  { dossier: ["Menage"], fichier: "Fiches_menage.pdf", titre: "Fiches de traçabilité ménage", extraire: extraireFichesMenage },
  { dossier: ["Relevé de compteur"], fichier: "Releves_compteurs.pdf", titre: "Relevés de compteurs (tous sites)", extraire: extraireRelevesCompteurs },
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
      await genererEtEnvoyerPdf(token, mod.dossier, mod.fichier, mod.titre, lignes, dernieresEmpreintes);
    }
    await exporterRelevesCompteursParSite(token, dernieresEmpreintes);
    await exporterPdfParCompteur(token, dernieresEmpreintes);
    await exporterCodesMasterlock(token, dernieresEmpreintes);

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
    await genererEtEnvoyerPdf(token, mod.dossier, mod.fichier, mod.titre, lignes, dernieresEmpreintes);
  }
  onProgress?.("Relevés de compteurs (détail par site)");
  await exporterRelevesCompteursParSite(token, dernieresEmpreintes);
  onProgress?.("Relevés de compteurs (un PDF par compteur, avec courbe)");
  await exporterPdfParCompteur(token, dernieresEmpreintes);
  onProgress?.("Codes Masterlock");
  await exporterCodesMasterlock(token, dernieresEmpreintes);
  await setDoc(STATUS_DOC, { lastExportDate: todayStr(), lastExportAt: new Date().toISOString(), empreintes: dernieresEmpreintes }, { merge: true });
}

export async function getStatutExport() {
  const snap = await getDoc(STATUS_DOC);
  return snap.exists() ? snap.data() : null;
}

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
        <table style="width:100%;border-collapse:collapse">
          <thead>
            <tr>
              ${colonnes.map(c => `<th style="border:1px solid #999;background:#B08D46;color:#fff;padding:5px 7px;font-size:10px;text-align:left;white-space:nowrap">${esc(c)}</th>`).join("")}
            </tr>
          </thead>
          <tbody>
            ${lignes.map((ligne, i) => `
              <tr style="background:${i % 2 === 0 ? '#fff' : '#F5F3EE'}">
                ${colonnes.map(c => `<td style="border:1px solid #ccc;padding:4px 7px;font-size:10px">${esc(ligne[c] == null ? '' : String(ligne[c]))}</td>`).join("")}
              </tr>
            `).join("")}
          </tbody>
        </table>
      `}
    </div>
  `;
}

async function genererEtEnvoyerPdf(token, nomFichier, titre, lignes) {
  if (!window.html2pdf) throw new Error("Librairie PDF non chargée (vérifier app.html)");

  const hidden = document.createElement("div");
  hidden.style.cssText = "position:fixed;left:-9999px;top:0;width:1000px;";
  hidden.innerHTML = construireRapportHTML(titre, lignes);
  document.body.appendChild(hidden);

  // Laisse le navigateur mettre en page le contenu ajouté avant de le
  // capturer — sans ce délai, html2canvas peut photographier une zone
  // encore vide (page blanche) juste après l'insertion dans le DOM.
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  let blob;
  try {
    blob = await window.html2pdf()
      .set({
        margin: 10,
        filename: nomFichier,
        image: { type: "jpeg", quality: 0.92 },
        html2canvas: { scale: 2 },
        jsPDF: { unit: "mm", format: "a4", orientation: lignes.length > 0 && Object.keys(lignes[0]).length > 6 ? "landscape" : "portrait" },
        pagebreak: { mode: ["css", "avoid-all"] },
      })
      .from(hidden)
      .outputPdf("blob");
  } finally {
    hidden.remove();
  }

  const file = new File([blob], nomFichier, { type: "application/pdf" });
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

// ---- Orchestration ----

const MODULES = [
  { fichier: "Stock_central.pdf", titre: "Stock central", extraire: extraireStockProduits },
  { fichier: "Stock_par_site.pdf", titre: "Stock par site", extraire: extraireStockSites },
  { fichier: "Interventions.pdf", titre: "Interventions", extraire: extraireInterventions },
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
      await genererEtEnvoyerPdf(token, mod.fichier, mod.titre, lignes);
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
    onProgress?.(mod.titre);
    const lignes = await mod.extraire();
    await genererEtEnvoyerPdf(token, mod.fichier, mod.titre, lignes);
  }
  await setDoc(STATUS_DOC, { lastExportDate: todayStr(), lastExportAt: new Date().toISOString() }, { merge: true });
}

export async function getStatutExport() {
  const snap = await getDoc(STATUS_DOC);
  return snap.exists() ? snap.data() : null;
}

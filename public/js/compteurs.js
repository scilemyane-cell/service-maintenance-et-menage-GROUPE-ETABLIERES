// compteurs.js
// Nouvel onglet indépendant "📏 Relevé compteur" : relevés eau/gaz/
// électricité par site, avec photo obligatoire à chaque relevé et QR
// code par compteur (ouvre directement le formulaire de relevé depuis
// l'appareil photo du téléphone, hors appli). Historique complet
// conservé (voir compteurs-data.js).
//
// Structure de l'écran, très proche du "Sites" du Stock déporté
// (stock-sites.js) : une carte repliable par résidence, avec badge
// d'alerte ("X en retard"), et à l'intérieur la liste des compteurs
// groupés par type (💧 Eau, 🔥 Gaz, ⚡ Électricité). Un mode rapide fait
// défiler tous les compteurs d'un site à la suite — utile sur les
// résidences qui en comptent plus de 80.

import { esc } from "./astreinte-logic.js";
import {
  listerSitesAvecCompteurs, listerTousLesCompteurs, creerCompteur, modifierCompteur,
  envoyerCompteurCorbeille, getCompteurUnique, enregistrerReleve, listerHistoriqueCompteur,
  qrPayloadForCompteur, nouveauCompteur, INDEX_ELEC, INDEX_LABELS, clesIndex,
  estEnRetard, prochaineEcheanceLabel, MOIS_LABELS, calculerEcarts, detecterAnomalies,
  trouverSectionPourType, consommationMensuelle, uniteValeur, supprimerReleve,
} from "./compteurs-data.js";
import { getAccessToken, uploadToDrive, getImageDisplayUrl, DOSSIERS_ROOT_FOLDER, getFolderWebUrl } from "./sharepoint-storage.js";
import { getDossierUnique, activerCompteursSurTousLesDossiers } from "./site-dossier-data.js";
import { watchAssociations } from "./associations-data.js";
import { renderQrWithLogo, printQrCard } from "./qr-logo.js";
import {
  enqueuePendingReleve, estErreurReseau, demarrerSyncAuto, countPendingReleves, onQueueChange,
} from "./offline-queue.js";

const TYPE_ICONE = { eau: "💧", gaz: "🔥", chauffage: "🌡️", elec: "⚡" };
const TYPE_LABEL = { eau: "Eau", gaz: "Gaz", chauffage: "Chauffage urbain", elec: "Électricité" };
const TYPES_COMPTEUR = ["eau", "gaz", "chauffage", "elec"]; // ordre d'affichage partout (liste, groupement par type, formulaires)
const ROLES_SUPERVISION = ["super_admin", "admin", "n1"]; // seuls eux peuvent antidater un relevé

function peutAntidater(user) {
  return ROLES_SUPERVISION.includes(user?.role);
}

// Convertit une date "YYYY-MM-DD" (valeur d'un <input type="date">) en
// timestamp ms, à midi ce jour-là (évite tout souci de fuseau horaire
// autour de minuit) — ou null si vide/invalide.
function dateInputVersTimestamp(valeur) {
  if (!valeur) return null;
  const [y, m, d] = valeur.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 12, 0, 0).getTime();
}

let mountedContainer = null;
let mountedUser = null;
let state = { sites: [], compteurs: [], associations: [] };
let pendingCount = 0;
let syncDemarre = false; // la synchro tourne en tache de fond, independamment de l'onglet ouvert
let associationsSubscribed = false;
let ui = {
  screen: "liste", ouverts: new Set(), qrOuverts: new Set(), historiqueOuverts: new Set(),
  addingSiteId: null, addingType: null, sectionsParSite: {}, editingCompteurId: null,
  addingFrequence: null, addingEcheanceJour: null, addingEcheanceMois: null,
  addingNom: null, addingEmplacement: null, addingAutoNom: null, addingAutoEmplacement: null, addingNbIndex: null,
  releveCompteurId: null, releveRetourSiteId: null, releveEnCours: null,
  rapideSiteId: null, rapideIndex: 0, rapportSiteId: null,
};

export async function mountCompteurs(container, user) {
  mountedContainer = container;
  mountedUser = user;
  state = { sites: [], compteurs: [], associations: [] };
  ui = {
    screen: "liste", ouverts: new Set(), qrOuverts: new Set(), historiqueOuverts: new Set(),
    addingSiteId: null, addingType: null, sectionsParSite: {}, editingCompteurId: null,
  addingFrequence: null, addingEcheanceJour: null, addingEcheanceMois: null,
  addingNom: null, addingEmplacement: null, addingAutoNom: null, addingAutoEmplacement: null, addingNbIndex: null,
    releveCompteurId: null, releveRetourSiteId: null, releveEnCours: null,
    rapideSiteId: null, rapideIndex: 0, rapportSiteId: null,
  };
  container.innerHTML = `<div class="hint">Chargement…</div>`;

  if (!syncDemarre) {
    syncDemarre = true;
    onQueueChange(async () => { pendingCount = await countPendingReleves(); if (ui.screen === "liste" && !ui.rapideSiteId) render(); });
    demarrerSyncAuto(traiterReleveEnAttente);
  }
  if (!associationsSubscribed) {
    associationsSubscribed = true;
    watchAssociations((a) => { state.associations = a; if (ui.screen === "liste" && !ui.rapideSiteId) render(); });
  }
  pendingCount = await countPendingReleves();

  try {
    await load();
  } catch (e) {
    container.innerHTML = `<div class="hint" style="color:var(--red)">❌ ${esc(e.message || String(e))}${e.code === "permission-denied" ? " — les règles Firestore pour ce nouvel onglet (collections 'compteurs' / 'compteurs-releves') n'ont probablement pas encore été republiées (Console Firebase > Firestore Database > Règles)." : ""}</div>`;
    return;
  }

  // Lien direct depuis un QR scanné hors appli (voir app.html, ?compteurrelever=)
  if (window.compteurRelevDeepLinkId) {
    const id = window.compteurRelevDeepLinkId;
    window.compteurRelevDeepLinkId = null;
    try {
      await ouvrirReleve(id, null);
    } catch (e) {
      container.innerHTML = `<div class="hint" style="color:var(--red)">❌ ${esc(e.message || String(e))}</div>`;
    }
    return;
  }
  render();
}

async function load() {
  const [sites, compteurs] = await Promise.all([listerSitesAvecCompteurs(), listerTousLesCompteurs()]);
  state.sites = sites;
  state.compteurs = compteurs;
  if (ui.screen === "liste") render();
}

function render() {
  if (!mountedContainer) return;
  if (!document.contains(mountedContainer)) return;
  if (ui.screen === "releve") return renderReleve();
  if (ui.rapideSiteId) return renderRapide();
  if (ui.rapportSiteId) return renderRapportSite();
  renderListe();
}

function formatDate(ms) {
  if (!ms) return "jamais relevé";
  return new Date(ms).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatValeurs(compteur) {
  const v = compteur.dernierReleve?.valeurs;
  if (!v) return "—";
  const cles = clesIndex(compteur);
  if (cles.length > 1) return cles.map(k => `${k}\u00A0${v[k] ?? "?"}`).join(" · ");
  return `${v.valeur ?? "?"} ${uniteValeur(compteur)}`;
}

// =================================================================
// Export PDF (impression) : récapitulatif des relevés d'un site —
// réutilise le mécanisme générique .print-fiche/.print-only déjà en
// place dans l'appli (ex. dossiers de site), donc directement
// "Enregistrer en PDF" depuis la boîte de dialogue d'impression.
// =================================================================
function exporterPdfSite(siteId) {
  const site = state.sites.find(s => s.id === siteId);
  if (!site) return;
  const compteurs = state.compteurs.filter(c => c.dossierId === siteId);

  const ligneCompteur = (c) => `
    <tr>
      <td>${esc(c.nom)}</td>
      <td>${esc(c.emplacement || "—")}</td>
      <td>${formatDate(c.dernierReleve?.at)}</td>
      <td>${formatValeurs(c)}</td>
      <td>${esc(c.dernierReleve?.releveParNom || "—")}</td>
    </tr>
  `;

  const tableauType = (type, label) => {
    const liste = compteurs.filter(c => c.type === type).sort((a, b) => (a.nom || "").localeCompare(b.nom || ""));
    if (liste.length === 0) return "";
    return `
      <h3 style="margin:16px 0 6px">${TYPE_ICONE[type]} ${label}</h3>
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr>
          <th style="text-align:left;border-bottom:1px solid #999;padding:4px">Compteur</th>
          <th style="text-align:left;border-bottom:1px solid #999;padding:4px">Emplacement</th>
          <th style="text-align:left;border-bottom:1px solid #999;padding:4px">Dernier relevé</th>
          <th style="text-align:left;border-bottom:1px solid #999;padding:4px">Valeur(s)</th>
          <th style="text-align:left;border-bottom:1px solid #999;padding:4px">Relevé par</th>
        </tr></thead>
        <tbody>${liste.map(ligneCompteur).join("")}</tbody>
      </table>
    `;
  };

  const html = `
    <div class="print-fiche" style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:24px;color:#111">
      <div style="text-align:center;margin-bottom:16px">
        <img src="img/logo-etablieres.png" alt="Groupe Établières" style="height:60px">
      </div>
      <h2 style="margin:0 0 4px">Relevé de compteur — ${esc(site.nom)}</h2>
      <p style="margin:0;color:#555;font-size:12px">Exporté le ${formatDate(Date.now())}</p>
      ${tableauType("eau", "Eau")}
      ${tableauType("gaz", "Gaz")}
      ${tableauType("elec", "Électricité")}
      ${compteurs.length === 0 ? `<p>Aucun compteur configuré sur ce site.</p>` : ""}
    </div>
  `;

  const printRoot = document.createElement("div");
  printRoot.id = "cpt-print-root";
  printRoot.className = "print-only";
  printRoot.innerHTML = html;
  document.body.appendChild(printRoot);
  window.print();
  setTimeout(() => printRoot.remove(), 1000);
}

// =================================================================
// Liste des sites (accordéon)
// =================================================================
function groupedSites(sites) {
  const result = [];
  const usedIds = new Set();
  state.associations.forEach(assoc => {
    const sitesForAssoc = sites.filter(s => s.association === assoc.nom);
    if (sitesForAssoc.length === 0) return;
    const groupeNames = [...new Set(sitesForAssoc.map(s => s.groupe).filter(Boolean))];
    const groups = [];
    const sansGroupe = sitesForAssoc.filter(s => !s.groupe);
    if (sansGroupe.length) groups.push({ groupeLabel: null, sites: sansGroupe });
    groupeNames.forEach(g => groups.push({ groupeLabel: g, sites: sitesForAssoc.filter(s => s.groupe === g) }));
    result.push({ assocLabel: assoc.nom, groups });
    sitesForAssoc.forEach(s => usedIds.add(s.id));
  });
  const orphans = sites.filter(s => !usedIds.has(s.id));
  if (orphans.length) result.push({ assocLabel: "Sans association", groups: [{ groupeLabel: null, sites: orphans }] });
  return result;
}

function renderSiteCard(site) {
  const compteurs = state.compteurs.filter(c => c.dossierId === site.id);
  const enRetard = compteurs.filter(estEnRetard);
  const ouvert = ui.ouverts.has(site.id);
  return `
    <div class="form-card" style="padding:0;overflow:visible">
      <div style="width:100%;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 16px">
        <button data-toggle-site="${site.id}" style="flex:1;display:flex;align-items:center;gap:10px;background:none;border:none;cursor:pointer;text-align:left;padding:0;min-width:0">
          <span style="font-size:14px;color:var(--gold);font-weight:700">🏢 ${esc(site.nom)}</span>
        </button>
        <span style="display:flex;align-items:center;gap:10px">
          ${enRetard.length > 0 ? `
            <span class="ssx-badge-tip" tabindex="0">
              <span style="background:var(--red);color:#fff;border-radius:999px;padding:3px 11px;font-size:12px;font-weight:800;cursor:default">⚠️ ${enRetard.length} en retard</span>
              <div class="ssx-tip-content">
                <p style="margin:0 0 6px;font-size:11px;color:var(--text-dim);font-weight:700">En retard sur ${esc(site.nom)} :</p>
                <ul>
                  ${enRetard.map(c => `<li><span>${TYPE_ICONE[c.type]} ${esc(c.nom)}</span><b>${formatDate(c.dernierReleve?.at)}</b></li>`).join("")}
                </ul>
              </div>
            </span>
          ` : `<span style="font-size:11px;color:var(--text-dim)">${compteurs.length} compteur(s)</span>`}
          <button data-toggle-site="${site.id}" style="background:none;border:none;cursor:pointer;font-size:12px;color:var(--text-dim);padding:0">${ouvert ? "▲" : "▼"}</button>
        </span>
      </div>
      ${ouvert ? `
      <div style="padding:0 16px 16px">
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
          <button class="nav-btn" data-rapide-site="${site.id}" ${compteurs.length === 0 ? 'disabled style="opacity:.4"' : ''}>🚀 Mode rapide (${compteurs.length})</button>
          <button class="nav-btn" data-export-pdf="${site.id}" ${compteurs.length === 0 ? 'disabled style="opacity:.4"' : ''}>🖨️ Exporter en PDF</button>
          <button class="add-btn" data-voir-rapport="${site.id}" ${compteurs.length === 0 ? 'disabled style="opacity:.4"' : ''}>📊 Voir le rapport</button>
          <button class="nav-btn" data-open-sharepoint="${site.id}" data-nom-site="${esc(site.nom)}">🔗 Ouvrir sur SharePoint</button>
        </div>
        ${compteurs.length === 0 ? `<p class="hint">Aucun compteur pour l'instant sur ce site.</p>` : TYPES_COMPTEUR.map(type => {
          const liste = compteurs.filter(c => c.type === type).sort((a, b) => (a.nom || "").localeCompare(b.nom || ""));
          if (liste.length === 0) return "";
          return `
            <p style="font-size:12px;font-weight:700;color:var(--text-dim);margin:14px 0 6px">${TYPE_ICONE[type]} ${TYPE_LABEL[type]} (${liste.length})</p>
            ${liste.map(c => renderCompteurRow(c)).join("")}
          `;
        }).join("")}
        <div id="cpt-add-zone-${site.id}" style="margin-top:14px">
          ${ui.addingSiteId === site.id ? renderAddForm(site) : `
            <button class="nav-btn" data-open-add="${site.id}">➕ Ajouter un compteur</button>
          `}
        </div>
        <div id="cpt-status-${site.id}" style="font-size:12px;margin-top:8px"></div>
      </div>
      ` : ""}
    </div>
  `;
}

function renderListe() {
  const trierParRetard = (sites) => [...sites].sort((a, b) => {
    const aRetard = state.compteurs.filter(c => c.dossierId === a.id && estEnRetard(c)).length;
    const bRetard = state.compteurs.filter(c => c.dossierId === b.id && estEnRetard(c)).length;
    if (aRetard > 0 && bRetard === 0) return -1;
    if (bRetard > 0 && aRetard === 0) return 1;
    return (a.nom || "").localeCompare(b.nom || "");
  });
  const groupes = groupedSites(state.sites);

  mountedContainer.innerHTML = `
    <div class="stack">
      <p class="hint">Relevés eau, gaz, électricité par site, avec photo obligatoire à chaque relevé — activable depuis la fiche d'un dossier de site ("📏 Ce site a des compteurs à relever").</p>
      ${pendingCount > 0 ? `
        <div class="stat-chip" style="width:fit-content;border-color:var(--gold);color:var(--gold)">
          📡 ${pendingCount} relevé(s) enregistré(s) sur cet appareil, en attente d'envoi (pas de réseau au moment de la saisie) — envoi automatique dès le retour de connexion.
        </div>
      ` : ""}
      ${peutAntidater(mountedUser) ? `
        <button class="nav-btn" id="cpt-activer-tous" style="width:fit-content">🔧 Activer les compteurs sur tous les dossiers de site existants</button>
        <div id="cpt-activer-tous-status" style="font-size:12px"></div>
      ` : ""}
      ${state.sites.length === 0 ? `
        <p class="hint">Aucun site n'a les compteurs activés pour l'instant. Coche "Ce site a des compteurs à relever" depuis la fiche d'un dossier de site (Dossiers de site) pour qu'il apparaisse ici.</p>
      ` : groupes.map(g => `
        <div>
          <h3 style="margin:12px 0 8px;font-size:15px;color:var(--gold)">${esc(g.assocLabel)}</h3>
          ${g.groups.map(sub => `
            ${sub.groupeLabel ? `<div style="font-size:12px;color:var(--text-dim);margin:6px 0 6px 4px">${esc(sub.groupeLabel)}</div>` : ""}
            ${trierParRetard(sub.sites).map(site => renderSiteCard(site)).join("")}
          `).join("")}
        </div>
      `).join("")}
    </div>
  `;

  document.getElementById("cpt-activer-tous")?.addEventListener("click", async () => {
    const statusEl = document.getElementById("cpt-activer-tous-status");
    if (!confirm("Activer les compteurs sur tous les dossiers de site qui ne les ont pas encore ? Ils apparaîtront ensuite ici (liste vide jusqu'à ce que tu y ajoutes des compteurs).")) return;
    statusEl.innerHTML = `<span style="color:var(--text-dim)">⏳ Activation en cours…</span>`;
    try {
      const n = await activerCompteursSurTousLesDossiers();
      statusEl.innerHTML = `<span style="color:var(--gold)">✓ ${n} dossier(s) mis à jour.</span>`;
      await load();
    } catch (e) {
      statusEl.innerHTML = `<span style="color:var(--red)">❌ ${esc(e.message || String(e))}</span>`;
    }
  });
  mountedContainer.querySelectorAll("[data-toggle-site]").forEach(btn => btn.addEventListener("click", () => {
    const id = btn.dataset.toggleSite;
    if (ui.ouverts.has(id)) ui.ouverts.delete(id); else ui.ouverts.add(id);
    render();
  }));
  mountedContainer.querySelectorAll("[data-rapide-site]").forEach(btn => btn.addEventListener("click", () => {
    ui.rapideSiteId = btn.dataset.rapideSite; ui.rapideIndex = 0; render();
  }));
  mountedContainer.querySelectorAll("[data-export-pdf]").forEach(btn => btn.addEventListener("click", () => {
    exporterPdfSite(btn.dataset.exportPdf);
  }));
  mountedContainer.querySelectorAll("[data-voir-rapport]").forEach(btn => btn.addEventListener("click", () => {
    ui.rapportSiteId = btn.dataset.voirRapport;
    render();
  }));
  mountedContainer.querySelectorAll("[data-open-sharepoint]").forEach(btn => btn.addEventListener("click", async () => {
    const original = btn.textContent;
    btn.textContent = "⏳ Ouverture…"; btn.disabled = true;
    // Ouverture synchrone d'un onglet vide AVANT l'await (sinon bloquée
    // par le bloqueur de pop-up), redirigé une fois l'URL connue.
    const win = window.open("", "_blank");
    try {
      const url = await getFolderWebUrl([btn.dataset.nomSite, "Relevé de compteur"]);
      if (win) win.location.href = url; else window.open(url, "_blank");
    } catch (e) {
      win?.close();
      alert("Impossible d'ouvrir SharePoint : " + (e.message || e));
    } finally {
      btn.textContent = original; btn.disabled = false;
    }
  }));
  mountedContainer.querySelectorAll("[data-open-add]").forEach(btn => btn.addEventListener("click", async () => {
    const siteId = btn.dataset.openAdd;
    ui.addingSiteId = siteId; ui.addingType = "eau"; ui.addingNbIndex = null;
    ui.addingNom = null; ui.addingEmplacement = null; ui.addingAutoNom = null; ui.addingAutoEmplacement = null;
    if (!ui.sectionsParSite[siteId]) {
      try {
        const dossier = await getDossierUnique(siteId);
        ui.sectionsParSite[siteId] = dossier?.sections || [];
      } catch (e) {
        ui.sectionsParSite[siteId] = [];
      }
    }
    appliquerAutoRemplissage(siteId, ui.addingType);
    render();
  }));
  mountedContainer.querySelectorAll("[data-relever]").forEach(btn => btn.addEventListener("click", () => {
    ouvrirReleve(btn.dataset.relever, btn.dataset.retourSite);
  }));
  mountedContainer.querySelectorAll("[data-toggle-qr]").forEach(btn => btn.addEventListener("click", () => {
    const id = btn.dataset.toggleQr;
    if (ui.qrOuverts.has(id)) ui.qrOuverts.delete(id); else ui.qrOuverts.add(id);
    render();
    if (ui.qrOuverts.has(id)) {
      const canvas = document.getElementById(`cpt-qr-canvas-${id}`);
      if (canvas) renderQrWithLogo(canvas, qrPayloadForCompteur(id), 200);
    }
  }));
  mountedContainer.querySelectorAll("[data-qr-print]").forEach(btn => btn.addEventListener("click", () => {
    printQrCard(document.getElementById(`cpt-qr-card-${btn.dataset.qrPrint}`));
  }));
  mountedContainer.querySelectorAll("[data-toggle-hist]").forEach(btn => btn.addEventListener("click", async () => {
    const id = btn.dataset.toggleHist;
    if (ui.historiqueOuverts.has(id)) { ui.historiqueOuverts.delete(id); render(); return; }
    ui.historiqueOuverts.add(id);
    render();
    await chargerEtAfficherHistorique(id);
  }));
  mountedContainer.querySelectorAll("[data-edit-compteur]").forEach(btn => btn.addEventListener("click", () => {
    const id = btn.dataset.editCompteur;
    ui.editingCompteurId = ui.editingCompteurId === id ? null : id;
    render();
  }));
  mountedContainer.querySelectorAll("[data-del-compteur]").forEach(btn => btn.addEventListener("click", () => {
    const c = state.compteurs.find(x => x.id === btn.dataset.delCompteur);
    if (!c) return;
    if (!confirm(`Mettre "${c.nom}" à la corbeille ? L'historique des relevés est conservé.`)) return;
    envoyerCompteurCorbeille(c.id).then(load).catch(e => alert("Erreur : " + (e.message || e)));
  }));

  attachAddFormListeners();
  attachEditFormListeners();
  resolvePhotos(mountedContainer);
}

function renderCompteurRow(c) {
  const retard = estEnRetard(c);
  return `
    <div class="form-card" style="margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap">
        <div>
          <p style="margin:0;font-weight:700">${esc(c.nom)}${c.emplacement ? ` <span style="font-weight:400;color:var(--text-dim);font-size:12px">— ${esc(c.emplacement)}</span>` : ""}</p>
          <p style="margin:2px 0 0;font-size:12px;${retard ? 'color:var(--red);font-weight:700' : 'color:var(--text-dim)'}">${retard ? '⚠️ ' : '✓ '}${formatDate(c.dernierReleve?.at)}${c.dernierReleve ? ` — ${c.dernierReleve.releveParNom}` : ""}</p>
          <p style="margin:2px 0 0;font-size:12px;color:var(--text-dim)">${formatValeurs(c)}</p>
          <p style="margin:2px 0 0;font-size:11px;color:var(--text-dim)">🔁 Relevé attendu ${prochaineEcheanceLabel(c)}</p>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="add-btn" data-relever="${c.id}" data-retour-site="${c.dossierId}" style="padding:6px 12px;font-size:12px">📷 Relever</button>
          <button class="nav-btn" data-toggle-qr="${c.id}" style="padding:6px 10px;font-size:12px">🔳 QR</button>
          <button class="nav-btn" data-toggle-hist="${c.id}" style="padding:6px 10px;font-size:12px">🗂️ Historique</button>
          <button class="nav-btn" data-edit-compteur="${c.id}" style="padding:6px 10px;font-size:12px">✏️</button>
          <button class="del-btn" data-del-compteur="${c.id}" style="padding:6px 10px;font-size:12px">🗑️</button>
        </div>
      </div>
      ${ui.editingCompteurId === c.id ? renderEditForm(c) : ""}
      ${ui.qrOuverts.has(c.id) ? `
        <div id="cpt-qr-card-${c.id}" class="qr-print-card" style="background:#fff;border-radius:10px;padding:16px;text-align:center;max-width:260px;margin-top:12px">
          <div id="cpt-qr-canvas-${c.id}" style="width:200px;height:200px;margin:0 auto"></div>
          <p style="color:#111;font-size:11px;margin:8px 0 0">À imprimer et coller sur <b>${esc(c.nom)}</b> — scanné avec l'appareil photo du téléphone, ouvre directement le relevé de ce compteur.</p>
          <button class="nav-btn" data-qr-print="${c.id}" style="margin-top:10px">🖨️ Imprimer</button>
        </div>
      ` : ""}
      ${ui.historiqueOuverts.has(c.id) ? `<div id="cpt-hist-${c.id}" style="margin-top:10px"></div>` : ""}
    </div>
  `;
}

function formatEcarts(compteur, ecarts) {
  if (!ecarts) return `<span class="hint">—</span>`;
  const cles = clesIndex(compteur);
  if (cles.length > 1) {
    return cles.map(k => {
      const e = ecarts[k];
      if (e === null || e === undefined || isNaN(e)) return `${k}\u00A0?`;
      return `${k}\u00A0<span style="color:${e < 0 ? 'var(--red)' : 'var(--gold)'}">${e >= 0 ? "+" : ""}${e.toFixed(2)}</span>`;
    }).join(" · ");
  }
  const e = ecarts.valeur;
  if (e === null || e === undefined || isNaN(e)) return "?";
  return `<span style="color:${e < 0 ? 'var(--red)' : 'var(--gold)'};font-weight:600">${e >= 0 ? "+" : ""}${e.toFixed(2)} ${uniteValeur(compteur)}</span>`;
}

function renderHistoriqueHTML(historique, compteur) {
  if (!compteur) return `<p class="hint">Compteur introuvable.</p>`;
  if (historique.length === 0) return `<p class="hint" style="margin:8px 0">Aucun relevé enregistré pour l'instant.</p>`;
  const estSuperAdmin = mountedUser?.role === "super_admin";
  return `
    <div class="table-wrap" style="border:none">
      <table>
        <thead><tr><th>Date</th><th>Valeur(s)</th><th>Consommation</th><th>Relevé par</th><th>Photo(s)</th>${estSuperAdmin ? "<th></th>" : ""}</tr></thead>
        <tbody>
          ${historique.map((r, i) => {
            // Ancien format (avant la photo par index) : un seul
            // photoItemId à la racine — conservé pour l'historique déjà
            // enregistré avant cette évolution.
            const photos = r.photos || (r.photoItemId ? { valeur: { itemId: r.photoItemId } } : {});
            const ecarts = historique[i + 1] ? calculerEcarts(r.valeurs, historique[i + 1].valeurs) : null;
            return `
            <tr>
              <td>${formatDate(r.createdAt)}${r.saisiHorsDate ? ` <span title="Saisi rétroactivement, à une date antérieure" style="color:var(--gold);font-size:11px">🕓 antidaté</span>` : ""}</td>
              <td>${clesIndex(compteur).length > 1 ? clesIndex(compteur).map(k => `${k}\u00A0${r.valeurs?.[k] ?? "?"}`).join(" · ") : `${r.valeurs?.valeur ?? "?"} ${uniteValeur(compteur)}`}</td>
              <td>${formatEcarts(compteur, ecarts)}</td>
              <td>${esc(r.releveParNom || "")}</td>
              <td style="white-space:nowrap">
                ${Object.entries(photos).map(([k, p]) => p?.itemId
                  ? `<img data-resolve-photo="${esc(p.itemId)}" title="${esc(k)}" alt="" style="width:36px;height:36px;object-fit:cover;border-radius:6px;border:1px solid var(--border);cursor:pointer;margin-right:4px" onclick="window.open(this.src,'_blank')" onerror="this.style.opacity=0.3">`
                  : ""
                ).join("") || "—"}
              </td>
              ${estSuperAdmin ? `<td><button class="del-btn" data-del-releve="${r.id}" data-compteur-id="${compteur.id}" style="padding:3px 8px;font-size:11px" title="Supprimer ce relevé (ex. essai/test) — Super Admin uniquement">🗑️</button></td>` : ""}
            </tr>
          `;}).join("")}
        </tbody>
      </table>
    </div>
    <div id="cpt-hist-chart-card-${esc(compteur.id)}" style="margin-top:14px;background:#fff;border-radius:10px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,.08)">
      <div style="position:relative;height:280px">
        <canvas id="cpt-hist-chart-${esc(compteur.id)}"></canvas>
      </div>
    </div>
  `;
}

// Charge (ou recharge, après une suppression) et affiche l'historique
// d'un compteur dans son emplacement dans la liste.
async function chargerEtAfficherHistorique(compteurId) {
  const holder = document.getElementById(`cpt-hist-${compteurId}`);
  if (!holder) return;
  holder.innerHTML = `<p class="hint" style="margin:8px 0">⏳ Chargement…</p>`;
  const compteur = state.compteurs.find(c => c.id === compteurId);
  const historique = await listerHistoriqueCompteur(compteurId);
  holder.innerHTML = renderHistoriqueHTML(historique, compteur);
  resolvePhotos(holder);
  dessinerGraphiqueHistorique(holder, historique, compteur);
  holder.querySelectorAll("[data-del-releve]").forEach(btn => btn.addEventListener("click", async () => {
    if (!confirm("Supprimer définitivement ce relevé (ex. essai/test) ? Cette action est irréversible et ne peut pas être annulée.")) return;
    btn.disabled = true;
    try {
      await supprimerReleve(btn.dataset.compteurId, btn.dataset.delReleve);
      await load(); // recharge la liste (rafraîchit aussi le "dernier relevé" affiché sur la ligne du compteur) — se re-render déjà toute seule si l'écran est encore la liste
      await chargerEtAfficherHistorique(compteurId);
    } catch (e) {
      alert("Erreur : " + (e.message || e));
      btn.disabled = false;
    }
  }));
}

let graphiquesActifs = {}; // conserve les instances Chart.js pour les détruire avant d'en recréer une

// Graphique en bâtons de la consommation mensuelle sur les 12 derniers
// mois — plus parlant qu'une courbe brute des index pour repérer une
// tendance ou un mois anormal. Pour l'électricité, uniquement les 4
// index d'ÉNERGIE (HPH/HCH/HPE/HCE) : les 4 index de PUISSANCE MAXIMALE
// (120/121/122/123) ne se soustraient pas d'un mois à l'autre de la même
// façon (ce ne sont pas des compteurs cumulatifs de consommation), ils
// restent visibles dans le tableau d'historique mais pas dans ce graphique.
function dessinerGraphiqueHistorique(holder, historique, compteur) {
  const canvas = holder.querySelector(`#cpt-hist-chart-${compteur.id}`);
  const carte = holder.querySelector(`#cpt-hist-chart-card-${compteur.id}`);
  if (!canvas || !window.Chart || historique.length < 2) { if (carte) carte.style.display = "none"; return; }
  if (carte) carte.style.display = "block";

  const clesConso = clesIndex(compteur);
  // Palette reprise de l'identité de l'appli (or, sarcelle, rouge,
  // violet) avec un peu de transparence sur le remplissage — plus doux
  // que des aplats purs, tout en gardant un contour net.
  const couleurs = [
    { fill: "rgba(217,178,76,.75)", bord: "#D9B24C" },
    { fill: "rgba(63,182,172,.75)", bord: "#3FB6AC" },
    { fill: "rgba(229,83,61,.75)", bord: "#E5533D" },
    { fill: "rgba(139,124,240,.75)", bord: "#8B7CF0" },
  ];
  const parCle = clesConso.map(cle => consommationMensuelle(historique, cle, 12));
  const labels = parCle[0].map(m => m.label);
  const datasets = clesConso.map((cle, i) => ({
    label: cle === "valeur" ? `Consommation (${uniteValeur(compteur)})` : `${cle} (kWh)`,
    data: parCle[i].map(m => m.valeur),
    backgroundColor: couleurs[i % couleurs.length].fill,
    borderColor: couleurs[i % couleurs.length].bord,
    borderWidth: 1.5,
    borderRadius: 5,
    borderSkipped: false,
    maxBarThickness: 34,
  }));

  const idPrecedent = canvas.dataset.chartId;
  if (idPrecedent && graphiquesActifs[idPrecedent]) { graphiquesActifs[idPrecedent].destroy(); delete graphiquesActifs[idPrecedent]; }
  const chartId = compteur.id + "-" + Date.now();
  canvas.dataset.chartId = chartId;
  graphiquesActifs[chartId] = new window.Chart(canvas.getContext("2d"), {
    type: "bar",
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: clesConso.length > 1, position: "bottom", labels: { color: "#333", boxWidth: 12, boxHeight: 12, padding: 14, font: { size: 12 } } },
        title: { display: true, text: "Consommation par mois — 12 derniers mois", color: "#1a1a1a", font: { size: 14, weight: "700" }, padding: { bottom: 14 } },
        tooltip: { backgroundColor: "#1a1a1a", padding: 10, cornerRadius: 6, titleFont: { size: 12 }, bodyFont: { size: 12 } },
      },
      scales: {
        x: { ticks: { color: "#555", font: { size: 11 } }, grid: { display: false } },
        y: { ticks: { color: "#555", font: { size: 11 } }, beginAtZero: true, grid: { color: "rgba(0,0,0,.06)" } },
      },
    },
  });
}

// Cherche, parmi les équipements déjà définis sur la fiche du dossier de
// site, celui qui correspond le mieux au type de compteur choisi — pour
// pré-remplir automatiquement le nom et reprendre son emplacement déjà
// renseigné là-bas (ex. "Compteurs d'eau généraux" → "sous-sol, local
// technique"). Priorité aux intitulés contenant à la fois "compteur" et
// le mot du type ; à défaut, un intitulé contenant juste le mot du type.
// Met à jour ui.addingNom/addingEmplacement pour le type sélectionné,
// sans écraser une saisie manuelle de l'utilisateur (on ne remplace que
// si le champ est vide ou égal à la précédente suggestion automatique).
function appliquerAutoRemplissage(siteId, type) {
  const sections = ui.sectionsParSite[siteId] || [];
  const match = trouverSectionPourType(sections, type);
  const suggestionNom = match?.titre || "";
  const suggestionEmplacement = match?.emplacement || "";
  if (!ui.addingNom || ui.addingNom === ui.addingAutoNom) ui.addingNom = suggestionNom;
  if (!ui.addingEmplacement || ui.addingEmplacement === ui.addingAutoEmplacement) ui.addingEmplacement = suggestionEmplacement;
  ui.addingAutoNom = suggestionNom;
  ui.addingAutoEmplacement = suggestionEmplacement;
}

function renderAddForm(site) {
  const suggestions = (ui.sectionsParSite[site.id] || []).map(s => s.titre).filter(Boolean);
  const freq = ui.addingFrequence || "mensuel";
  const type = ui.addingType || "eau";
  const nbIndex = ui.addingNbIndex || 4;
  return `
    <div class="form-card">
      <h4 style="margin:0 0 10px;font-size:14px">Nouveau compteur — ${esc(site.nom)}</h4>
      <div class="form-grid">
        <label>Type
          <select id="cpt-new-type">
            <option value="eau" ${type === "eau" ? "selected" : ""}>💧 Eau</option>
            <option value="gaz" ${type === "gaz" ? "selected" : ""}>🔥 Gaz</option>
            <option value="chauffage" ${type === "chauffage" ? "selected" : ""}>🌡️ Chauffage urbain</option>
            <option value="elec" ${type === "elec" ? "selected" : ""}>⚡ Électricité</option>
          </select>
        </label>
        <label>Nom
          <input id="cpt-new-nom" list="cpt-new-nom-list" value="${esc(ui.addingNom || "")}" placeholder="ex. Compteur général, Tableau local technique…" autocomplete="off">
          <datalist id="cpt-new-nom-list">
            ${suggestions.map(s => `<option value="${esc(s)}">`).join("")}
          </datalist>
        </label>
        <label>Emplacement (optionnel)<input id="cpt-new-emplacement" value="${esc(ui.addingEmplacement || "")}" placeholder="ex. sous-sol, local technique…"></label>
      </div>
      ${type === "elec" ? `
        <div class="form-grid" style="margin-top:10px">
          <label>Nombre d'index de ce compteur
            <select id="cpt-new-nbindex">
              <option value="4" ${nbIndex === 4 ? "selected" : ""}>4 — multi-tarif (120/121/122/123 = HPH/HCH/HPE/HCE)</option>
              <option value="1" ${nbIndex === 1 ? "selected" : ""}>1 — compteur de base (un seul index)</option>
            </select>
          </label>
        </div>
        <p class="hint" style="margin:4px 0 0">Certains sites n'ont qu'un simple compteur électrique (1 index), d'autres un tarif Jaune/Vert à 4 index — à choisir selon ce que ce compteur affiche réellement.</p>
      ` : ""}
      ${suggestions.length > 0 ? `<p class="hint" style="margin:6px 0 0">💡 Suggestions de nom reprises des équipements de la fiche de ce dossier de site : ${suggestions.map(esc).join(", ")}</p>` : ""}
      ${ui.addingAutoNom ? `<p class="hint" style="margin:4px 0 0;color:var(--gold)">✓ Nom et emplacement repris automatiquement de "${esc(ui.addingAutoNom)}" (modifiable)</p>` : ""}
      <p style="font-size:12px;font-weight:700;color:var(--text-dim);margin:14px 0 6px">🔁 Fréquence de relevé attendue</p>
      ${frequenceFieldsHTML("cpt-new", freq, ui.addingEcheanceJour || 1, ui.addingEcheanceMois || 1)}
      <div style="display:flex;gap:8px;margin-top:10px">
        <button class="add-btn" id="cpt-new-save">💾 Ajouter</button>
        <button class="nav-btn" id="cpt-new-cancel">Annuler</button>
      </div>
      <div id="cpt-new-status" style="font-size:12px;margin-top:8px"></div>
    </div>
  `;
}

// Champs de fréquence, partagés entre le formulaire d'ajout et celui de
// modification (même structure, préfixe d'id différent).
function frequenceFieldsHTML(prefix, frequence, jour, mois) {
  return `
    <div class="form-grid">
      <label>Fréquence
        <select id="${prefix}-frequence">
          <option value="mensuel" ${frequence === "mensuel" ? "selected" : ""}>Tous les mois</option>
          <option value="annuel" ${frequence === "annuel" ? "selected" : ""}>Une fois par an, à date fixe</option>
        </select>
      </label>
      ${frequence === "annuel" ? `
        <label>Jour de l'échéance<input type="number" min="1" max="31" id="${prefix}-echeance-jour" value="${jour}"></label>
        <label>Mois de l'échéance
          <select id="${prefix}-echeance-mois">
            ${MOIS_LABELS.map((m, i) => `<option value="${i + 1}" ${mois === i + 1 ? "selected" : ""}>${m}</option>`).join("")}
          </select>
        </label>
      ` : ""}
    </div>
  `;
}

function renderEditForm(c) {
  return `
    <div class="form-card" style="margin-top:10px;background:var(--panel-alt)">
      <h4 style="margin:0 0 10px;font-size:14px">Modifier — ${esc(c.nom)}</h4>
      <div class="form-grid">
        <label>Nom<input id="cpt-edit-nom" value="${esc(c.nom)}"></label>
        <label>Emplacement (optionnel)<input id="cpt-edit-emplacement" value="${esc(c.emplacement || '')}"></label>
      </div>
      ${c.type === "elec" ? `
        <div class="form-grid" style="margin-top:10px">
          <label>Nombre d'index de ce compteur
            <select id="cpt-edit-nbindex">
              <option value="4" ${(c.nbIndex || 4) === 4 ? "selected" : ""}>4 — multi-tarif (120/121/122/123 = HPH/HCH/HPE/HCE)</option>
              <option value="1" ${(c.nbIndex || 4) === 1 ? "selected" : ""}>1 — compteur de base (un seul index)</option>
            </select>
          </label>
        </div>
      ` : ""}
      <p style="font-size:12px;font-weight:700;color:var(--text-dim);margin:14px 0 6px">🔁 Fréquence de relevé attendue</p>
      ${frequenceFieldsHTML("cpt-edit", c.frequence || "mensuel", c.echeanceJour || 1, c.echeanceMois || 1)}
      <div style="display:flex;gap:8px;margin-top:10px">
        <button class="add-btn" id="cpt-edit-save" data-id="${c.id}">💾 Enregistrer</button>
        <button class="nav-btn" id="cpt-edit-cancel">Annuler</button>
      </div>
      <div id="cpt-edit-status" style="font-size:12px;margin-top:8px"></div>
    </div>
  `;
}

function attachEditFormListeners() {
  const freqSelect = document.getElementById("cpt-edit-frequence");
  if (!freqSelect) return;
  const c = state.compteurs.find(x => x.id === ui.editingCompteurId);
  freqSelect.addEventListener("change", (e) => {
    c.frequence = e.target.value; // reflet local le temps du re-render, pas encore enregistré
    render();
  });
  document.getElementById("cpt-edit-cancel").addEventListener("click", () => { ui.editingCompteurId = null; render(); });
  document.getElementById("cpt-edit-save").addEventListener("click", async () => {
    const statusEl = document.getElementById("cpt-edit-status");
    const nom = document.getElementById("cpt-edit-nom").value.trim();
    const emplacement = document.getElementById("cpt-edit-emplacement").value.trim();
    const frequence = document.getElementById("cpt-edit-frequence").value;
    const patch = { nom: nom || c.nom, emplacement, frequence };
    if (c.type === "elec") patch.nbIndex = parseInt(document.getElementById("cpt-edit-nbindex")?.value, 10) || 4;
    // Modifier l'emplacement à la main = ne plus vouloir qu'il soit
    // écrasé automatiquement plus tard (voir synchroniserEmplacementsCompteurs()).
    if (emplacement !== (c.emplacement || "")) patch.emplacementAuto = false;
    if (frequence === "annuel") {
      patch.echeanceJour = parseInt(document.getElementById("cpt-edit-echeance-jour").value, 10) || 1;
      patch.echeanceMois = parseInt(document.getElementById("cpt-edit-echeance-mois").value, 10) || 1;
    }
    statusEl.innerHTML = `<span style="color:var(--text-dim)">⏳ Enregistrement…</span>`;
    try {
      await modifierCompteur(c.id, patch);
      ui.editingCompteurId = null;
      await load();
    } catch (e) {
      statusEl.innerHTML = `<span style="color:var(--red)">❌ ${esc(e.message || String(e))}</span>`;
    }
  });
}

function attachAddFormListeners() {
  const typeSelect = document.getElementById("cpt-new-type");
  if (!typeSelect) return;
  document.getElementById("cpt-new-nom").addEventListener("input", (e) => { ui.addingNom = e.target.value; });
  document.getElementById("cpt-new-emplacement").addEventListener("input", (e) => { ui.addingEmplacement = e.target.value; });
  typeSelect.addEventListener("change", (e) => {
    // Capture la saisie actuelle avant de changer de type, pour ne rien
    // perdre si l'utilisateur avait déjà modifié le nom/emplacement.
    ui.addingNom = document.getElementById("cpt-new-nom").value;
    ui.addingEmplacement = document.getElementById("cpt-new-emplacement").value;
    ui.addingType = e.target.value;
    appliquerAutoRemplissage(ui.addingSiteId, ui.addingType);
    render();
  });
  document.getElementById("cpt-new-nbindex")?.addEventListener("change", (e) => {
    ui.addingNbIndex = parseInt(e.target.value, 10);
    render();
  });
  document.getElementById("cpt-new-frequence").addEventListener("change", (e) => {
    ui.addingNom = document.getElementById("cpt-new-nom").value;
    ui.addingEmplacement = document.getElementById("cpt-new-emplacement").value;
    ui.addingFrequence = e.target.value;
    ui.addingEcheanceJour = parseInt(document.getElementById("cpt-new-echeance-jour")?.value, 10) || ui.addingEcheanceJour || 1;
    ui.addingEcheanceMois = parseInt(document.getElementById("cpt-new-echeance-mois")?.value, 10) || ui.addingEcheanceMois || 1;
    render();
  });
  document.getElementById("cpt-new-cancel").addEventListener("click", () => { ui.addingSiteId = null; render(); });
  document.getElementById("cpt-new-save").addEventListener("click", async () => {
    const statusEl = document.getElementById("cpt-new-status");
    const site = state.sites.find(s => s.id === ui.addingSiteId);
    const type = document.getElementById("cpt-new-type").value;
    const nomInput = document.getElementById("cpt-new-nom").value.trim();
    const emplacement = document.getElementById("cpt-new-emplacement").value.trim();
    const frequence = document.getElementById("cpt-new-frequence").value;
    const compteur = nouveauCompteur(type);
    if (nomInput) compteur.nom = nomInput;
    compteur.emplacement = emplacement;
    if (type === "elec") compteur.nbIndex = parseInt(document.getElementById("cpt-new-nbindex")?.value, 10) || 4;
    // Reste "automatique" (suivra les futures modifications de la fiche du
    // dossier de site) tant que l'utilisateur n'a pas tapé autre chose que
    // la suggestion proposée — voir synchroniserEmplacementsCompteurs().
    compteur.emplacementAuto = !emplacement || emplacement === (ui.addingAutoEmplacement || "");
    compteur.frequence = frequence;
    if (frequence === "annuel") {
      compteur.echeanceJour = parseInt(document.getElementById("cpt-new-echeance-jour").value, 10) || 1;
      compteur.echeanceMois = parseInt(document.getElementById("cpt-new-echeance-mois").value, 10) || 1;
    }
    statusEl.innerHTML = `<span style="color:var(--text-dim)">⏳ Ajout…</span>`;
    try {
      await creerCompteur(site.id, site.nom, compteur);
      ui.addingSiteId = null;
      ui.addingFrequence = null; ui.addingEcheanceJour = null; ui.addingEcheanceMois = null; ui.addingNbIndex = null;
      ui.addingNom = null; ui.addingEmplacement = null; ui.addingAutoNom = null; ui.addingAutoEmplacement = null;
      await load();
    } catch (e) {
      statusEl.innerHTML = `<span style="color:var(--red)">❌ ${esc(e.message || String(e))}</span>`;
    }
  });
}

// =================================================================
// =================================================================
// Bloc(s) photo — une photo par index relevé (4 pour l'élec, 1 pour
// eau/gaz) : un tableau multi-tarif n'affiche souvent qu'un seul index
// à la fois à l'écran, d'où une photo dédiée par index plutôt qu'une
// photo unique pour tout le compteur.
// =================================================================
function labelPourCle(compteur, cle) {
  if (cle === "valeur") return "Photo du compteur";
  return `${cle} — ${INDEX_LABELS[cle]}`;
}

function photosBlockHTML(prefix, compteur, photos, optionnel = false) {
  return clesIndex(compteur).map(cle => {
    const photo = photos[cle];
    return `
      <div style="margin-bottom:12px">
        <label style="display:block;font-size:12px;font-weight:600;margin-bottom:4px">${esc(labelPourCle(compteur, cle))}${photo ? ' <span style="color:var(--gold)">✓</span>' : optionnel ? ' <span style="color:var(--text-dim)">(optionnelle)</span>' : ' <span style="color:var(--red)">(obligatoire)</span>'}</label>
        ${photo ? `
          <div style="position:relative;width:fit-content">
            <img ${photo.itemId ? `data-resolve-photo="${esc(photo.itemId)}"` : `src="${esc(photo.previewUrl || photo.url)}"`} alt="" style="width:90px;height:90px;object-fit:cover;border-radius:8px;border:1px solid var(--border)" onerror="this.style.opacity=0.3">
            <button data-del-photo="${cle}" class="${prefix}-del-photo" style="position:absolute;top:-6px;right:-6px;background:var(--red);color:#fff;border:none;border-radius:50%;width:20px;height:20px;font-size:11px;cursor:pointer;line-height:1">✕</button>
          </div>
        ` : `
          <button data-photo-btn="${cle}" class="nav-btn ${prefix}-photo-btn">📷 Prendre une photo</button>
        `}
      </div>
    `;
  }).join("") + `<input type="file" accept="image/*" capture="environment" class="${prefix}-photo-input" style="display:none">`
    + `<span class="${prefix}-photo-status" style="font-size:12px"></span>`;
}

// Attache les écouteurs du bloc photo ci-dessus. La photo est capturée
// et gardée EN MÉMOIRE (fichier + aperçu local) sans jamais tenter de
// l'envoyer à ce stade — l'envoi n'a lieu qu'au moment d'enregistrer le
// relevé (voir plus bas), ce qui permet de prendre une photo même sans
// réseau. `photos` est l'objet mutable dans lequel les fichiers pris sont
// stockés (une entrée par clé d'index) ; `onChange` est appelée après
// chaque prise/suppression pour re-render l'écran.
function wirePhotosBlock(prefix, compteur, photos, onChange) {
  const root = mountedContainer;
  const fileInput = root.querySelector(`.${prefix}-photo-input`);

  root.querySelectorAll(`[data-del-photo].${prefix}-del-photo`).forEach(btn => {
    btn.addEventListener("click", () => {
      const p = photos[btn.dataset.delPhoto];
      if (p?.previewUrl) URL.revokeObjectURL(p.previewUrl);
      delete photos[btn.dataset.delPhoto];
      onChange();
    });
  });
  root.querySelectorAll(`.${prefix}-photo-btn`).forEach(btn => {
    btn.addEventListener("click", () => {
      fileInput.dataset.cle = btn.dataset.photoBtn;
      fileInput.click();
    });
  });
  fileInput?.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const cle = e.target.dataset.cle;
    photos[cle] = { file, previewUrl: URL.createObjectURL(file) };
    onChange();
  });
}

// Un superviseur/admin peut valider un relevé sans toutes les photos —
// utile pour compléter le fichier avec d'anciens relevés (pas de photo
// disponible a posteriori). Un technicien doit toujours fournir toutes
// les photos requises.
function photosCompletes(compteur, photos, user) {
  if (peutAntidater(user)) return true;
  return clesIndex(compteur).every(cle => photos[cle]);
}

// Envoie toutes les photos capturées (fichiers en mémoire) vers
// SharePoint et renvoie l'objet `photos` final (avec itemId/url réels),
// prêt pour enregistrerReleve(). Lève une erreur si un envoi échoue —
// à l'appelant de distinguer une coupure réseau (mise en file d'attente,
// voir offline-queue.js) d'une autre erreur.
async function envoyerToutesLesPhotos(compteur, photos) {
  const token = await getAccessToken(); // un seul jeton pour tous les envois de ce relevé
  const resultat = {};
  for (const [cle, photo] of Object.entries(photos)) {
    if (photo.itemId) { resultat[cle] = photo; continue; } // déjà envoyée (repli après échec partiel)
    const sousDossier = cle === "valeur" ? compteur.nom : `${compteur.nom} (${cle})`;
    const { url, itemId, isImage, name } = await uploadToDrive(
      photo.file, token, [compteur.dossierNom, "Relevé de compteur", sousDossier], DOSSIERS_ROOT_FOLDER
    );
    resultat[cle] = { url, itemId, isImage, name };
  }
  return resultat;
}

// Vérifie les anomalies avant enregistrement (baisse impossible, hausse
// anormale par rapport à l'historique récent) et demande confirmation à
// l'utilisateur le cas échéant. Renvoie true si l'enregistrement peut se
// poursuivre (aucune anomalie, ou l'utilisateur a confirmé malgré tout).
async function confirmerMalgreAnomalies(compteur, valeurs) {
  let historiqueRecent = [];
  try { historiqueRecent = (await listerHistoriqueCompteur(compteur.id)).slice(0, 6); } catch (e) { /* si l'historique n'est pas joignable, on ignore juste la verification statistique */ }
  const anomalies = detecterAnomalies(compteur, valeurs, historiqueRecent);
  if (anomalies.length === 0) return true;
  return confirm(`⚠️ Anomalie détectée sur ce relevé :\n\n${anomalies.join("\n")}\n\nEnregistrer quand même ?`);
}

// Tente d'envoyer les photos puis d'enregistrer le relevé. En cas
// d'échec RÉSEAU (pas d'autre type d'erreur), met tout le relevé en
// file d'attente locale (voir offline-queue.js) au lieu de faire
// échouer l'opération — l'utilisateur peut continuer son travail, la
// synchronisation se fera automatiquement au retour de connexion.
// Renvoie { statut: "envoye" | "en_attente" }, ou lève une erreur pour
// tout autre problème (droits, etc.).
async function finaliserEnregistrementReleve(compteur, valeurs, photos, dateAntidatee) {
  try {
    const photosEnvoyees = await envoyerToutesLesPhotos(compteur, photos);
    await enregistrerReleve(compteur, valeurs, photosEnvoyees, mountedUser, dateAntidatee);
    return { statut: "envoye" };
  } catch (e) {
    if (!estErreurReseau(e)) throw e;
    const photosFiles = {};
    for (const [cle, photo] of Object.entries(photos)) photosFiles[cle] = photo.file;
    await enqueuePendingReleve({ compteur, valeurs, photosFiles, user: mountedUser, dateAntidatee });
    return { statut: "en_attente" };
  }
}

// Rejoue un relevé mis en file d'attente (voir demarrerSyncAuto ci-
// dessous) — reconstruit un objet "photos" à partir des fichiers
// conservés, puis suit exactement le même chemin que l'enregistrement
// normal.
async function traiterReleveEnAttente(entry) {
  const photos = {};
  for (const [cle, file] of Object.entries(entry.photosFiles)) photos[cle] = { file };
  const photosEnvoyees = await envoyerToutesLesPhotos(entry.compteur, photos);
  await enregistrerReleve(entry.compteur, entry.valeurs, photosEnvoyees, entry.user, entry.dateAntidatee);
}

// =================================================================
// Écran de relevé (un seul compteur) — atteint par le bouton "Relever"
// ou par un QR scanné hors appli
// =================================================================
async function ouvrirReleve(compteurId, retourSiteId) {
  const compteur = state.compteurs.find(c => c.id === compteurId) || await getCompteurUnique(compteurId);
  if (!compteur) { alert("Compteur introuvable (peut-être supprimé)."); return; }
  ui.screen = "releve";
  ui.releveCompteurId = compteurId;
  ui.releveRetourSiteId = retourSiteId;
  ui.releveEnCours = { compteur, valeurs: {}, photos: {} };
  render();
}

function renderReleve() {
  const { compteur, valeurs, photos } = ui.releveEnCours;
  const complet = photosCompletes(compteur, photos, mountedUser);
  const champs = clesIndex(compteur).length > 1
    ? clesIndex(compteur).map(k => `
        <label>${k} <span style="color:var(--text-dim);font-weight:400">(${INDEX_LABELS[k]})</span>
          <input type="number" inputmode="decimal" min="0" step="0.01" id="cpt-r-${k}" value="${valeurs[k] ?? ""}" placeholder="kWh">
        </label>
      `).join("")
    : `<label>Valeur relevée<input type="number" inputmode="decimal" min="0" step="0.001" id="cpt-r-valeur" value="${valeurs.valeur ?? ""}" placeholder="${uniteValeur(compteur)}"></label>`;

  mountedContainer.innerHTML = `
    <div class="stack">
      <button class="nav-btn" id="cpt-r-quitter">✕ Quitter sans enregistrer</button>
      <div class="form-card" style="max-width:420px;margin:0 auto">
        <p class="hint" style="margin:0 0 2px">${esc(compteur.dossierNom)}</p>
        <h3 style="margin:0 0 4px">${TYPE_ICONE[compteur.type]} ${esc(compteur.nom)}</h3>
        ${compteur.emplacement ? `<p class="hint" style="margin:0 0 12px">${esc(compteur.emplacement)}</p>` : ""}
        ${compteur.dernierReleve ? `<p class="hint" style="margin:0 0 12px">Dernier relevé : ${formatDate(compteur.dernierReleve.at)} — ${formatValeurs(compteur)}</p>` : ""}

        <div class="form-grid">${champs}</div>

        ${peutAntidater(mountedUser) ? `
          <label style="display:block;margin-top:10px">Date du relevé
            <input type="date" id="cpt-r-date" value="${ui.releveEnCours.dateChoisie || new Date().toISOString().slice(0, 10)}" max="${new Date().toISOString().slice(0, 10)}">
          </label>
          <p class="hint" style="margin:2px 0 0">Laisse aujourd'hui par défaut, ou choisis une date antérieure si ce relevé a été fait plus tôt et pas encore saisi.</p>
        ` : ""}

        <label style="display:block;font-size:11px;color:var(--text-dim);margin:14px 0 6px">${peutAntidater(mountedUser) ? "Photo(s) — optionnelle(s) pour un superviseur/admin (utile pour compléter d'anciens relevés)" : clesIndex(compteur).length > 1 ? `Une photo par index (${clesIndex(compteur).length} obligatoires)` : "Photo du compteur (obligatoire)"}</label>
        <div id="cpt-r-photo-zone">${photosBlockHTML("cpt-r", compteur, photos, peutAntidater(mountedUser))}</div>

        <button class="add-btn" id="cpt-r-save" style="width:100%;margin-top:16px;font-size:15px;padding:12px" ${complet ? "" : "disabled style=\"opacity:.5\""}>✓ Enregistrer le relevé</button>
        <div id="cpt-r-status" style="font-size:12px;margin-top:10px"></div>
      </div>
    </div>
  `;

  function syncValeurs() {
    if (clesIndex(compteur).length > 1) {
      clesIndex(compteur).forEach(k => { const el = document.getElementById(`cpt-r-${k}`); if (el) valeurs[k] = el.value; });
    } else {
      const el = document.getElementById("cpt-r-valeur"); if (el) valeurs.valeur = el.value;
    }
  }
  mountedContainer.querySelectorAll("input[type=number]").forEach(el => el.addEventListener("input", syncValeurs));

  document.getElementById("cpt-r-quitter").addEventListener("click", () => {
    ui.screen = "liste"; ui.releveCompteurId = null; ui.releveEnCours = null;
    if (ui.releveRetourSiteId) ui.ouverts.add(ui.releveRetourSiteId);
    render();
  });
  document.getElementById("cpt-r-date")?.addEventListener("change", (e) => { ui.releveEnCours.dateChoisie = e.target.value; });
  wirePhotosBlock("cpt-r", compteur, photos, () => { syncValeurs(); render(); });
  document.getElementById("cpt-r-save").addEventListener("click", async () => {
    syncValeurs();
    const statusEl = document.getElementById("cpt-r-status");
    if (!photosCompletes(compteur, photos, mountedUser)) { statusEl.innerHTML = `<span style="color:var(--red)">Il manque au moins une photo.</span>`; return; }
    statusEl.innerHTML = `<span style="color:var(--text-dim)">⏳ Vérification…</span>`;
    if (!(await confirmerMalgreAnomalies(compteur, valeurs))) { statusEl.innerHTML = ""; return; }
    const dateChoisie = peutAntidater(mountedUser) ? dateInputVersTimestamp(document.getElementById("cpt-r-date")?.value) : null;
    const aujourdHui = new Date().toISOString().slice(0, 10);
    const estAnterieure = dateChoisie && document.getElementById("cpt-r-date").value !== aujourdHui;
    statusEl.innerHTML = `<span style="color:var(--text-dim)">⏳ Enregistrement…</span>`;
    try {
      const { statut } = await finaliserEnregistrementReleve(compteur, valeurs, photos, estAnterieure ? dateChoisie : null);
      ui.screen = "liste"; ui.releveCompteurId = null; ui.releveEnCours = null;
      if (ui.releveRetourSiteId) ui.ouverts.add(ui.releveRetourSiteId);
      if (statut === "en_attente") {
        await load();
        alert("📡 Pas de réseau : ce relevé a été enregistré sur cet appareil et sera envoyé automatiquement dès le retour de connexion.");
      } else {
        await load();
      }
    } catch (e) {
      statusEl.innerHTML = `<span style="color:var(--red)">❌ ${esc(e.message || String(e))}</span>`;
    }
  });

  resolvePhotos(mountedContainer);
}

// =================================================================
// Mode rapide : tous les compteurs d'un site à la suite
// =================================================================
function renderRapide() {
  const site = state.sites.find(s => s.id === ui.rapideSiteId);
  if (!site) { ui.rapideSiteId = null; render(); return; }
  const liste = state.compteurs.filter(c => c.dossierId === site.id)
    .sort((a, b) => (a.type === b.type ? (a.nom || "").localeCompare(b.nom || "") : TYPES_COMPTEUR.indexOf(a.type) - TYPES_COMPTEUR.indexOf(b.type)));

  if (ui.rapideIndex >= liste.length) {
    mountedContainer.innerHTML = `
      <div class="stack">
        <div class="form-card" style="text-align:center;max-width:360px;margin:0 auto">
          <p style="font-size:36px;margin:0 0 8px">✅</p>
          <h3 style="margin:0 0 6px">Relevés de ${esc(site.nom)} terminés</h3>
          <p class="hint" style="margin:0 0 16px">${liste.length} compteur(s) passé(s) en revue.</p>
          <button class="add-btn" id="cpt-rap-fin" style="width:100%">← Retour à la liste</button>
        </div>
      </div>
    `;
    document.getElementById("cpt-rap-fin").addEventListener("click", () => { ui.rapideSiteId = null; ui.ouverts.add(site.id); load().catch(e => alert("Erreur : " + (e.message || e))); });
    return;
  }

  const compteur = liste[ui.rapideIndex];
  ui.releveEnCours = ui.releveEnCours && ui.releveEnCours.compteur.id === compteur.id ? ui.releveEnCours : { compteur, valeurs: {}, photos: {} };
  const { valeurs, photos } = ui.releveEnCours;
  const complet = photosCompletes(compteur, photos, mountedUser);
  const champs = clesIndex(compteur).length > 1
    ? clesIndex(compteur).map(k => `
        <label>${k}<input type="number" inputmode="decimal" min="0" step="0.01" id="cpt-rap-${k}" value="${valeurs[k] ?? ""}" placeholder="kWh"></label>
      `).join("")
    : `<label>Valeur relevée<input type="number" inputmode="decimal" min="0" step="0.001" id="cpt-rap-valeur" value="${valeurs.valeur ?? ""}" placeholder="${uniteValeur(compteur)}"></label>`;

  mountedContainer.innerHTML = `
    <div class="stack">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <button class="nav-btn" id="cpt-rap-quitter">✕ Quitter le mode rapide</button>
        <span class="hint">${ui.rapideIndex + 1} / ${liste.length} · ${esc(site.nom)}</span>
      </div>
      <div class="form-card" style="max-width:400px;margin:0 auto">
        <h3 style="margin:0 0 2px">${TYPE_ICONE[compteur.type]} ${esc(compteur.nom)}</h3>
        ${compteur.emplacement ? `<p class="hint" style="margin:0 0 10px">${esc(compteur.emplacement)}</p>` : ""}
        ${compteur.dernierReleve ? `<p class="hint" style="margin:0 0 10px">Dernier relevé : ${formatDate(compteur.dernierReleve.at)} — ${formatValeurs(compteur)}</p>` : ""}

        <div class="form-grid">${champs}</div>

        ${peutAntidater(mountedUser) ? `
          <label style="display:block;margin-top:10px">Date du relevé
            <input type="date" id="cpt-rap-date" value="${ui.releveEnCours.dateChoisie || new Date().toISOString().slice(0, 10)}" max="${new Date().toISOString().slice(0, 10)}">
          </label>
        ` : ""}

        <label style="display:block;font-size:11px;color:var(--text-dim);margin:14px 0 6px">${peutAntidater(mountedUser) ? "Photo(s) — optionnelle(s) pour un superviseur/admin" : clesIndex(compteur).length > 1 ? `Une photo par index (${clesIndex(compteur).length} obligatoires)` : "Photo (obligatoire)"}</label>
        <div id="cpt-rap-photo-zone">${photosBlockHTML("cpt-rap", compteur, photos, peutAntidater(mountedUser))}</div>

        <button class="add-btn" id="cpt-rap-valider" style="width:100%;margin-top:16px;font-size:15px;padding:12px" ${complet ? "" : "disabled style=\"opacity:.5\""}>✓ Valider et suivant →</button>
        <button class="nav-btn" id="cpt-rap-passer" style="width:100%;margin-top:8px">Passer sans relever</button>
        <div id="cpt-rap-status" style="font-size:12px;margin-top:10px"></div>
      </div>
    </div>
  `;

  function syncValeurs() {
    if (clesIndex(compteur).length > 1) {
      clesIndex(compteur).forEach(k => { const el = document.getElementById(`cpt-rap-${k}`); if (el) valeurs[k] = el.value; });
    } else {
      const el = document.getElementById("cpt-rap-valeur"); if (el) valeurs.valeur = el.value;
    }
  }
  mountedContainer.querySelectorAll("input[type=number]").forEach(el => el.addEventListener("input", syncValeurs));

  document.getElementById("cpt-rap-quitter").addEventListener("click", () => { ui.rapideSiteId = null; ui.releveEnCours = null; ui.ouverts.add(site.id); render(); });
  document.getElementById("cpt-rap-passer").addEventListener("click", () => { ui.rapideIndex++; ui.releveEnCours = null; render(); });
  document.getElementById("cpt-rap-date")?.addEventListener("change", (e) => { ui.releveEnCours.dateChoisie = e.target.value; });
  wirePhotosBlock("cpt-rap", compteur, photos, () => { syncValeurs(); render(); });
  document.getElementById("cpt-rap-valider").addEventListener("click", async () => {
    syncValeurs();
    const statusEl = document.getElementById("cpt-rap-status");
    if (!photosCompletes(compteur, photos, mountedUser)) { statusEl.innerHTML = `<span style="color:var(--red)">Il manque au moins une photo.</span>`; return; }
    statusEl.innerHTML = `<span style="color:var(--text-dim)">⏳ Vérification…</span>`;
    if (!(await confirmerMalgreAnomalies(compteur, valeurs))) { statusEl.innerHTML = ""; return; }
    const aujourdHui = new Date().toISOString().slice(0, 10);
    const dateSaisie = document.getElementById("cpt-rap-date")?.value;
    const dateChoisie = peutAntidater(mountedUser) && dateSaisie && dateSaisie !== aujourdHui ? dateInputVersTimestamp(dateSaisie) : null;
    statusEl.innerHTML = `<span style="color:var(--text-dim)">⏳ Enregistrement…</span>`;
    try {
      const { statut } = await finaliserEnregistrementReleve(compteur, valeurs, photos, dateChoisie);
      compteur.dernierReleve = { at: dateChoisie || Date.now(), valeurs, releveParNom: mountedUser?.nom || mountedUser?.email }; // reflet immédiat, sans recharger
      if (statut === "en_attente") statusEl.innerHTML = `<span style="color:var(--gold)">📡 Pas de réseau — enregistré localement, sera envoyé automatiquement.</span>`;
      ui.rapideIndex++;
      ui.releveEnCours = null;
      render();
    } catch (e) {
      statusEl.innerHTML = `<span style="color:var(--red)">❌ ${esc(e.message || String(e))}</span>`;
    }
  });

  resolvePhotos(mountedContainer);
}

// =================================================================
// Rapport à l'écran (par site) — la même information que l'export PDF,
// mais consultable directement dans l'appli sans avoir à imprimer/
// télécharger quoi que ce soit : dernière valeur de chaque compteur et
// sa courbe de consommation mensuelle, groupés par type.
// =================================================================
async function renderRapportSite() {
  const site = state.sites.find(s => s.id === ui.rapportSiteId);
  if (!site) { ui.rapportSiteId = null; render(); return; }
  const compteurs = state.compteurs.filter(c => c.dossierId === site.id);

  mountedContainer.innerHTML = `
    <div class="stack">
      <button class="nav-btn" id="cpt-rapport-retour">← Retour</button>
      <h2 style="margin:4px 0 0">📊 Rapport — ${esc(site.nom)}</h2>
      <p class="hint" style="margin:0">Dernière valeur et consommation mensuelle de chaque compteur de ce site.</p>
      ${compteurs.length === 0 ? `<p class="hint">Aucun compteur sur ce site.</p>` : `<div id="cpt-rapport-corps"><p class="hint">⏳ Chargement de l'historique…</p></div>`}
    </div>
  `;
  document.getElementById("cpt-rapport-retour").addEventListener("click", () => { ui.rapportSiteId = null; ui.ouverts.add(site.id); render(); });
  if (compteurs.length === 0) return;

  const historiques = await Promise.all(compteurs.map(c => listerHistoriqueCompteur(c.id)));
  const corps = document.getElementById("cpt-rapport-corps");
  if (!corps) return; // l'utilisateur a peut-être déjà quitté l'écran entre-temps

  corps.innerHTML = TYPES_COMPTEUR.map(type => {
    const liste = compteurs.filter(c => c.type === type).sort((a, b) => (a.nom || "").localeCompare(b.nom || ""));
    if (liste.length === 0) return "";
    return `
      <p style="font-size:13px;font-weight:700;color:var(--text-dim);margin:16px 0 8px">${TYPE_ICONE[type]} ${TYPE_LABEL[type]}</p>
      ${liste.map(c => {
        const retard = estEnRetard(c);
        return `
        <div class="form-card" style="margin-bottom:12px">
          <div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:6px">
            <p style="margin:0;font-weight:700">${esc(c.nom)}</p>
            <p style="margin:0;font-size:12px;${retard ? 'color:var(--red);font-weight:700' : 'color:var(--text-dim)'}">${retard ? '⚠️ ' : '✓ '}${formatDate(c.dernierReleve?.at)} — ${formatValeurs(c)}</p>
          </div>
          <div id="cpt-rapport-chart-holder-${c.id}"></div>
        </div>
      `;}).join("")}
    `;
  }).join("");

  compteurs.forEach((c, i) => {
    const holder = document.getElementById(`cpt-rapport-chart-holder-${c.id}`);
    if (!holder) return;
    holder.innerHTML = `
      <div id="cpt-hist-chart-card-${esc(c.id)}" style="margin-top:10px;background:#fff;border-radius:10px;padding:14px;box-shadow:0 1px 3px rgba(0,0,0,.08)">
        <div style="position:relative;height:220px">
          <canvas id="cpt-hist-chart-${esc(c.id)}"></canvas>
        </div>
      </div>
    `;
    dessinerGraphiqueHistorique(holder, historiques[i], c);
  });
}

// =================================================================
// Résolution des vignettes photo (voir data-resolve-photo)
// =================================================================
async function resolvePhotos(container) {
  const nodes = [...container.querySelectorAll("[data-resolve-photo]")];
  const itemIds = [...new Set(nodes.map(n => n.dataset.resolvePhoto).filter(Boolean))];
  await Promise.all(itemIds.map(async (itemId) => {
    try {
      const url = await getImageDisplayUrl(itemId);
      container.querySelectorAll(`[data-resolve-photo="${itemId}"]`).forEach(img => { img.src = url; });
    } catch (e) {
      container.querySelectorAll(`[data-resolve-photo="${itemId}"]`).forEach(img => { img.style.opacity = 0.3; });
    }
  }));
}

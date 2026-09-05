// compteurs.js
// Nouvel onglet indépendant "🔢 Relevé compteur" : relevés eau/gaz/
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
  estEnRetard, prochaineEcheanceLabel, MOIS_LABELS,
} from "./compteurs-data.js";
import { getAccessToken, uploadToDrive, getImageDisplayUrl, DOSSIERS_ROOT_FOLDER } from "./sharepoint-storage.js";
import { getDossierUnique } from "./site-dossier-data.js";
import { renderQrWithLogo, printQrCard } from "./qr-logo.js";

const TYPE_ICONE = { eau: "💧", gaz: "🔥", elec: "⚡" };
const TYPE_LABEL = { eau: "Eau", gaz: "Gaz", elec: "Électricité" };
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
let state = { sites: [], compteurs: [] };
let ui = {
  screen: "liste", ouverts: new Set(), qrOuverts: new Set(), historiqueOuverts: new Set(),
  addingSiteId: null, addingType: null, sectionsParSite: {}, editingCompteurId: null,
  addingFrequence: null, addingEcheanceJour: null, addingEcheanceMois: null,
  addingNom: null, addingEmplacement: null, addingAutoNom: null, addingAutoEmplacement: null,
  releveCompteurId: null, releveRetourSiteId: null, releveEnCours: null,
  rapideSiteId: null, rapideIndex: 0,
};

export async function mountCompteurs(container, user) {
  mountedContainer = container;
  mountedUser = user;
  state = { sites: [], compteurs: [] };
  ui = {
    screen: "liste", ouverts: new Set(), qrOuverts: new Set(), historiqueOuverts: new Set(),
    addingSiteId: null, addingType: null, sectionsParSite: {}, editingCompteurId: null,
  addingFrequence: null, addingEcheanceJour: null, addingEcheanceMois: null,
  addingNom: null, addingEmplacement: null, addingAutoNom: null, addingAutoEmplacement: null,
    releveCompteurId: null, releveRetourSiteId: null, releveEnCours: null,
    rapideSiteId: null, rapideIndex: 0,
  };
  container.innerHTML = `<div class="hint">Chargement…</div>`;
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
  renderListe();
}

function formatDate(ms) {
  if (!ms) return "jamais relevé";
  return new Date(ms).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatValeurs(compteur) {
  const v = compteur.dernierReleve?.valeurs;
  if (!v) return "—";
  if (compteur.type === "elec") return INDEX_ELEC.map(k => `${k}\u00A0${v[k] ?? "?"}`).join(" · ");
  return `${v.valeur ?? "?"} ${compteur.type === "eau" ? "m³" : "m³"}`;
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
function renderListe() {
  const sitesTries = [...state.sites].sort((a, b) => {
    const aRetard = state.compteurs.filter(c => c.dossierId === a.id && estEnRetard(c)).length;
    const bRetard = state.compteurs.filter(c => c.dossierId === b.id && estEnRetard(c)).length;
    if (aRetard > 0 && bRetard === 0) return -1;
    if (bRetard > 0 && aRetard === 0) return 1;
    return (a.nom || "").localeCompare(b.nom || "");
  });

  mountedContainer.innerHTML = `
    <div class="stack">
      <p class="hint">Relevés eau, gaz, électricité par site, avec photo obligatoire à chaque relevé — activable depuis la fiche d'un dossier de site ("🔢 Ce site a des compteurs à relever").</p>
      ${state.sites.length === 0 ? `
        <p class="hint">Aucun site n'a les compteurs activés pour l'instant. Coche "Ce site a des compteurs à relever" depuis la fiche d'un dossier de site (Dossiers de site) pour qu'il apparaisse ici.</p>
      ` : sitesTries.map(site => {
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
            </div>
            ${compteurs.length === 0 ? `<p class="hint">Aucun compteur pour l'instant sur ce site.</p>` : ["eau", "gaz", "elec"].map(type => {
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
      `;}).join("")}
    </div>
  `;

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
  mountedContainer.querySelectorAll("[data-open-add]").forEach(btn => btn.addEventListener("click", async () => {
    const siteId = btn.dataset.openAdd;
    ui.addingSiteId = siteId; ui.addingType = "eau";
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
    const holder = document.getElementById(`cpt-hist-${id}`);
    if (holder) {
      holder.innerHTML = `<p class="hint" style="margin:8px 0">⏳ Chargement…</p>`;
      const historique = await listerHistoriqueCompteur(id);
      holder.innerHTML = renderHistoriqueHTML(historique, state.compteurs.find(c => c.id === id));
      resolvePhotos(holder);
    }
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

function renderHistoriqueHTML(historique, compteur) {
  if (!compteur) return `<p class="hint">Compteur introuvable.</p>`;
  if (historique.length === 0) return `<p class="hint" style="margin:8px 0">Aucun relevé enregistré pour l'instant.</p>`;
  return `
    <div class="table-wrap" style="border:none">
      <table>
        <thead><tr><th>Date</th><th>Valeur(s)</th><th>Relevé par</th><th>Photo(s)</th></tr></thead>
        <tbody>
          ${historique.map(r => {
            // Ancien format (avant la photo par index) : un seul
            // photoItemId à la racine — conservé pour l'historique déjà
            // enregistré avant cette évolution.
            const photos = r.photos || (r.photoItemId ? { valeur: { itemId: r.photoItemId } } : {});
            return `
            <tr>
              <td>${formatDate(r.createdAt)}${r.saisiHorsDate ? ` <span title="Saisi rétroactivement, à une date antérieure" style="color:var(--gold);font-size:11px">🕓 antidaté</span>` : ""}</td>
              <td>${compteur.type === "elec" ? INDEX_ELEC.map(k => `${k}\u00A0${r.valeurs?.[k] ?? "?"}`).join(" · ") : `${r.valeurs?.valeur ?? "?"} m³`}</td>
              <td>${esc(r.releveParNom || "")}</td>
              <td style="white-space:nowrap">
                ${Object.entries(photos).map(([k, p]) => p?.itemId
                  ? `<img data-resolve-photo="${esc(p.itemId)}" title="${esc(k)}" alt="" style="width:36px;height:36px;object-fit:cover;border-radius:6px;border:1px solid var(--border);cursor:pointer;margin-right:4px" onclick="window.open(this.src,'_blank')" onerror="this.style.opacity=0.3">`
                  : ""
                ).join("") || "—"}
              </td>
            </tr>
          `;}).join("")}
        </tbody>
      </table>
    </div>
  `;
}

// Cherche, parmi les équipements déjà définis sur la fiche du dossier de
// site, celui qui correspond le mieux au type de compteur choisi — pour
// pré-remplir automatiquement le nom et reprendre son emplacement déjà
// renseigné là-bas (ex. "Compteurs d'eau généraux" → "sous-sol, local
// technique"). Priorité aux intitulés contenant à la fois "compteur" et
// le mot du type ; à défaut, un intitulé contenant juste le mot du type.
function trouverSectionCompteur(sections, type) {
  const motsType = { eau: ["eau"], gaz: ["gaz"], elec: ["électri", "electri", "linky"] }[type] || [];
  const contientMotType = (titre) => motsType.some(m => titre.includes(m));
  let match = sections.find(s => {
    const t = (s.titre || "").toLowerCase();
    return t.includes("compteur") && contientMotType(t);
  });
  if (!match) match = sections.find(s => contientMotType((s.titre || "").toLowerCase()));
  return match || null;
}

// Met à jour ui.addingNom/addingEmplacement pour le type sélectionné,
// sans écraser une saisie manuelle de l'utilisateur (on ne remplace que
// si le champ est vide ou égal à la précédente suggestion automatique).
function appliquerAutoRemplissage(siteId, type) {
  const sections = ui.sectionsParSite[siteId] || [];
  const match = trouverSectionCompteur(sections, type);
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
  return `
    <div class="form-card">
      <h4 style="margin:0 0 10px;font-size:14px">Nouveau compteur — ${esc(site.nom)}</h4>
      <div class="form-grid">
        <label>Type
          <select id="cpt-new-type">
            <option value="eau" ${ui.addingType === "eau" ? "selected" : ""}>💧 Eau</option>
            <option value="gaz" ${ui.addingType === "gaz" ? "selected" : ""}>🔥 Gaz</option>
            <option value="elec" ${ui.addingType === "elec" ? "selected" : ""}>⚡ Électricité (4 index HPH/HCH/HPE/HCE)</option>
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
    compteur.frequence = frequence;
    if (frequence === "annuel") {
      compteur.echeanceJour = parseInt(document.getElementById("cpt-new-echeance-jour").value, 10) || 1;
      compteur.echeanceMois = parseInt(document.getElementById("cpt-new-echeance-mois").value, 10) || 1;
    }
    statusEl.innerHTML = `<span style="color:var(--text-dim)">⏳ Ajout…</span>`;
    try {
      await creerCompteur(site.id, site.nom, compteur);
      ui.addingSiteId = null;
      ui.addingFrequence = null; ui.addingEcheanceJour = null; ui.addingEcheanceMois = null;
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
function labelPourCle(type, cle) {
  if (type !== "elec") return "Photo du compteur";
  return `${cle} — ${INDEX_LABELS[cle]}`;
}

function photosBlockHTML(prefix, compteur, photos) {
  return clesIndex(compteur.type).map(cle => {
    const photo = photos[cle];
    return `
      <div style="margin-bottom:12px">
        <label style="display:block;font-size:12px;font-weight:600;margin-bottom:4px">${esc(labelPourCle(compteur.type, cle))}${photo ? ' <span style="color:var(--gold)">✓</span>' : ' <span style="color:var(--red)">(obligatoire)</span>'}</label>
        ${photo ? `
          <div style="position:relative;width:fit-content">
            <img ${photo.itemId ? `data-resolve-photo="${esc(photo.itemId)}"` : `src="${esc(photo.url)}"`} alt="" style="width:90px;height:90px;object-fit:cover;border-radius:8px;border:1px solid var(--border)" onerror="this.style.opacity=0.3">
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

// Attache les écouteurs du bloc photo ci-dessus. `photos` est l'objet
// mutable dans lequel les photos prises sont stockées (une entrée par
// clé d'index) ; `onChange` est appelée après chaque prise/suppression
// pour re-render l'écran.
function wirePhotosBlock(prefix, compteur, photos, onChange) {
  const root = mountedContainer;
  const fileInput = root.querySelector(`.${prefix}-photo-input`);
  const statusEl = root.querySelector(`.${prefix}-photo-status`);

  root.querySelectorAll(`[data-del-photo].${prefix}-del-photo`).forEach(btn => {
    btn.addEventListener("click", () => { delete photos[btn.dataset.delPhoto]; onChange(); });
  });
  root.querySelectorAll(`.${prefix}-photo-btn`).forEach(btn => {
    btn.addEventListener("click", async () => {
      statusEl.innerHTML = `<span style="color:var(--text-dim)">⏳ Connexion…</span>`;
      try {
        const token = await getAccessToken(); // en réaction directe au clic, sinon bloqué par le navigateur
        statusEl.innerHTML = "";
        fileInput.dataset.readyToken = token;
        fileInput.dataset.cle = btn.dataset.photoBtn;
        fileInput.click();
      } catch (err) {
        statusEl.innerHTML = `<span style="color:var(--red)">❌ ${esc(err.message || String(err))}</span>`;
      }
    });
  });
  fileInput?.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const cle = e.target.dataset.cle;
    statusEl.innerHTML = `<span style="color:var(--text-dim)">⏳ Envoi de la photo…</span>`;
    try {
      const sousDossier = compteur.type === "elec" ? `${compteur.nom} (${cle})` : compteur.nom;
      const { url, itemId, isImage, name } = await uploadToDrive(
        file, e.target.dataset.readyToken, [compteur.dossierNom, "Relevé de compteur", sousDossier], DOSSIERS_ROOT_FOLDER
      );
      photos[cle] = { url, itemId, isImage, name };
      onChange();
    } catch (err) {
      statusEl.innerHTML = `<span style="color:var(--red)">❌ Échec : ${esc(err.message || String(err))}</span>`;
    }
  });
}

function photosCompletes(compteur, photos) {
  return clesIndex(compteur.type).every(cle => photos[cle]);
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
  const complet = photosCompletes(compteur, photos);
  const champs = compteur.type === "elec"
    ? INDEX_ELEC.map(k => `
        <label>${k} <span style="color:var(--text-dim);font-weight:400">(${INDEX_LABELS[k]})</span>
          <input type="number" inputmode="decimal" min="0" step="0.01" id="cpt-r-${k}" value="${valeurs[k] ?? ""}" placeholder="kWh">
        </label>
      `).join("")
    : `<label>Valeur relevée<input type="number" inputmode="decimal" min="0" step="0.001" id="cpt-r-valeur" value="${valeurs.valeur ?? ""}" placeholder="m³"></label>`;

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

        <label style="display:block;font-size:11px;color:var(--text-dim);margin:14px 0 6px">${compteur.type === "elec" ? "Une photo par index (4 obligatoires)" : "Photo du compteur (obligatoire)"}</label>
        <div id="cpt-r-photo-zone">${photosBlockHTML("cpt-r", compteur, photos)}</div>

        <button class="add-btn" id="cpt-r-save" style="width:100%;margin-top:16px;font-size:15px;padding:12px" ${complet ? "" : "disabled style=\"opacity:.5\""}>✓ Enregistrer le relevé</button>
        <div id="cpt-r-status" style="font-size:12px;margin-top:10px"></div>
      </div>
    </div>
  `;

  function syncValeurs() {
    if (compteur.type === "elec") {
      INDEX_ELEC.forEach(k => { const el = document.getElementById(`cpt-r-${k}`); if (el) valeurs[k] = el.value; });
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
    if (!photosCompletes(compteur, photos)) { statusEl.innerHTML = `<span style="color:var(--red)">Il manque au moins une photo.</span>`; return; }
    const dateChoisie = peutAntidater(mountedUser) ? dateInputVersTimestamp(document.getElementById("cpt-r-date")?.value) : null;
    const aujourdHui = new Date().toISOString().slice(0, 10);
    const estAnterieure = dateChoisie && document.getElementById("cpt-r-date").value !== aujourdHui;
    statusEl.innerHTML = `<span style="color:var(--text-dim)">⏳ Enregistrement…</span>`;
    try {
      await enregistrerReleve(compteur, valeurs, photos, mountedUser, estAnterieure ? dateChoisie : null);
      ui.screen = "liste"; ui.releveCompteurId = null; ui.releveEnCours = null;
      if (ui.releveRetourSiteId) ui.ouverts.add(ui.releveRetourSiteId);
      await load();
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
    .sort((a, b) => (a.type === b.type ? (a.nom || "").localeCompare(b.nom || "") : ["eau", "gaz", "elec"].indexOf(a.type) - ["eau", "gaz", "elec"].indexOf(b.type)));

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
  const complet = photosCompletes(compteur, photos);
  const champs = compteur.type === "elec"
    ? INDEX_ELEC.map(k => `
        <label>${k}<input type="number" inputmode="decimal" min="0" step="0.01" id="cpt-rap-${k}" value="${valeurs[k] ?? ""}" placeholder="kWh"></label>
      `).join("")
    : `<label>Valeur relevée<input type="number" inputmode="decimal" min="0" step="0.001" id="cpt-rap-valeur" value="${valeurs.valeur ?? ""}" placeholder="m³"></label>`;

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

        <label style="display:block;font-size:11px;color:var(--text-dim);margin:14px 0 6px">${compteur.type === "elec" ? "Une photo par index (4 obligatoires)" : "Photo (obligatoire)"}</label>
        <div id="cpt-rap-photo-zone">${photosBlockHTML("cpt-rap", compteur, photos)}</div>

        <button class="add-btn" id="cpt-rap-valider" style="width:100%;margin-top:16px;font-size:15px;padding:12px" ${complet ? "" : "disabled style=\"opacity:.5\""}>✓ Valider et suivant →</button>
        <button class="nav-btn" id="cpt-rap-passer" style="width:100%;margin-top:8px">Passer sans relever</button>
        <div id="cpt-rap-status" style="font-size:12px;margin-top:10px"></div>
      </div>
    </div>
  `;

  function syncValeurs() {
    if (compteur.type === "elec") {
      INDEX_ELEC.forEach(k => { const el = document.getElementById(`cpt-rap-${k}`); if (el) valeurs[k] = el.value; });
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
    if (!photosCompletes(compteur, photos)) { statusEl.innerHTML = `<span style="color:var(--red)">Il manque au moins une photo.</span>`; return; }
    const aujourdHui = new Date().toISOString().slice(0, 10);
    const dateSaisie = document.getElementById("cpt-rap-date")?.value;
    const dateChoisie = peutAntidater(mountedUser) && dateSaisie && dateSaisie !== aujourdHui ? dateInputVersTimestamp(dateSaisie) : null;
    statusEl.innerHTML = `<span style="color:var(--text-dim)">⏳ Enregistrement…</span>`;
    try {
      await enregistrerReleve(compteur, valeurs, photos, mountedUser, dateChoisie);
      compteur.dernierReleve = { at: dateChoisie || Date.now(), valeurs, photos, releveParNom: mountedUser?.nom || mountedUser?.email }; // reflet immédiat, sans recharger
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

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

let mountedContainer = null;
let mountedUser = null;
let state = { sites: [], compteurs: [] };
let ui = {
  screen: "liste", ouverts: new Set(), qrOuverts: new Set(), historiqueOuverts: new Set(),
  addingSiteId: null, addingType: null, emplacementsSuggeres: {}, editingCompteurId: null,
  addingFrequence: null, addingEcheanceJour: null, addingEcheanceMois: null,
  releveCompteurId: null, releveRetourSiteId: null, releveEnCours: null,
  rapideSiteId: null, rapideIndex: 0,
};

export async function mountCompteurs(container, user) {
  mountedContainer = container;
  mountedUser = user;
  state = { sites: [], compteurs: [] };
  ui = {
    screen: "liste", ouverts: new Set(), qrOuverts: new Set(), historiqueOuverts: new Set(),
    addingSiteId: null, addingType: null, emplacementsSuggeres: {}, editingCompteurId: null,
  addingFrequence: null, addingEcheanceJour: null, addingEcheanceMois: null,
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
  mountedContainer.querySelectorAll("[data-open-add]").forEach(btn => btn.addEventListener("click", async () => {
    const siteId = btn.dataset.openAdd;
    ui.addingSiteId = siteId; ui.addingType = "eau"; render();
    if (!ui.emplacementsSuggeres[siteId]) {
      try {
        const dossier = await getDossierUnique(siteId);
        ui.emplacementsSuggeres[siteId] = (dossier?.sections || []).map(s => s.titre).filter(Boolean);
      } catch (e) {
        ui.emplacementsSuggeres[siteId] = [];
      }
      if (ui.addingSiteId === siteId) render();
    }
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
              <td>${formatDate(r.createdAt)}</td>
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

function renderAddForm(site) {
  const suggestions = ui.emplacementsSuggeres[site.id] || [];
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
          <input id="cpt-new-nom" list="cpt-new-nom-list" placeholder="ex. Compteur général, Tableau local technique…" autocomplete="off">
          <datalist id="cpt-new-nom-list">
            ${suggestions.map(s => `<option value="${esc(s)}">`).join("")}
          </datalist>
        </label>
        <label>Emplacement (optionnel)<input id="cpt-new-emplacement" placeholder="ex. sous-sol, local technique…"></label>
      </div>
      ${suggestions.length > 0 ? `<p class="hint" style="margin:6px 0 0">💡 Suggestions de nom reprises des équipements de la fiche de ce dossier de site : ${suggestions.map(esc).join(", ")}</p>` : ""}
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
  typeSelect.addEventListener("change", (e) => { ui.addingType = e.target.value; render(); });
  document.getElementById("cpt-new-frequence").addEventListener("change", (e) => {
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
        file, e.target.dataset.readyToken, [compteur.dossierNom, "Compteurs", sousDossier], DOSSIERS_ROOT_FOLDER
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
  wirePhotosBlock("cpt-r", compteur, photos, () => { syncValeurs(); render(); });
  document.getElementById("cpt-r-save").addEventListener("click", async () => {
    syncValeurs();
    const statusEl = document.getElementById("cpt-r-status");
    if (!photosCompletes(compteur, photos)) { statusEl.innerHTML = `<span style="color:var(--red)">Il manque au moins une photo.</span>`; return; }
    statusEl.innerHTML = `<span style="color:var(--text-dim)">⏳ Enregistrement…</span>`;
    try {
      await enregistrerReleve(compteur, valeurs, photos, mountedUser);
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
  wirePhotosBlock("cpt-rap", compteur, photos, () => { syncValeurs(); render(); });
  document.getElementById("cpt-rap-valider").addEventListener("click", async () => {
    syncValeurs();
    const statusEl = document.getElementById("cpt-rap-status");
    if (!photosCompletes(compteur, photos)) { statusEl.innerHTML = `<span style="color:var(--red)">Il manque au moins une photo.</span>`; return; }
    statusEl.innerHTML = `<span style="color:var(--text-dim)">⏳ Enregistrement…</span>`;
    try {
      await enregistrerReleve(compteur, valeurs, photos, mountedUser);
      compteur.dernierReleve = { at: Date.now(), valeurs, photos, releveParNom: mountedUser?.nom || mountedUser?.email }; // reflet immédiat, sans recharger
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

// masterlock.js
// Nouvel onglet indépendant "🔐 Codes Masterlock" : gestion des codes de
// boîtes à clés par site, en lien avec les Dossiers de site (voir
// site-dossier.js, qui affiche en lecture seule les codes actuels de
// chaque site). Historique complet des changements de code conservé
// (voir masterlock-data.js) — utile en cas de doute ou de contrôle.

import { esc } from "./astreinte-logic.js";
import {
  listerSitesPourMasterlock, listerTousLesCodes, creerCode, modifierCode,
  supprimerCode, nouveauCode, listerHistoriquePourSite, importerCodesDepuisDossiers,
} from "./masterlock-data.js";
import { watchAssociations } from "./associations-data.js";

let mountedContainer = null;
let mountedUser = null;
let state = { sites: [], codes: [], associations: [] };
let ui = { ouverts: new Set(), addingSiteId: null, editingCodeId: null, historiqueOuverts: new Set() };

export async function mountMasterlock(container, user) {
  mountedContainer = container;
  mountedUser = user;
  state = { sites: [], codes: [], associations: [] };
  ui = { ouverts: new Set(), addingSiteId: null, editingCodeId: null, historiqueOuverts: new Set() };
  container.innerHTML = `<div class="hint">Chargement…</div>`;

  watchAssociations((a) => { state.associations = a; render(); });

  try {
    await load();
  } catch (e) {
    container.innerHTML = `<div class="hint" style="color:var(--red)">❌ ${esc(e.message || String(e))}${e.code === "permission-denied" ? " — les règles Firestore pour ce nouvel onglet (collections 'masterlock-codes' / 'masterlock-historique') n'ont probablement pas encore été republiées." : ""}</div>`;
  }
}

async function load() {
  const [sites, codes] = await Promise.all([listerSitesPourMasterlock(), listerTousLesCodes()]);
  state.sites = sites;
  state.codes = codes;
  render();
}

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

function formatDate(ms) {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function render() {
  if (!mountedContainer || !document.contains(mountedContainer)) return;
  renderListe();
}

// Ne montre que les sites ayant au moins un code (ou en cours d'ajout) —
// les sites sans boîte à clés n'encombrent pas la liste (contrairement
// aux Compteurs, chaque site n'a pas forcément de Masterlock).
function renderListe() {
  const sitesAvecCodes = state.sites.filter(s => state.codes.some(c => c.dossierId === s.id) || ui.addingSiteId === s.id);
  const groupes = groupedSites(sitesAvecCodes);

  mountedContainer.innerHTML = `
    <div class="stack">
      <p class="hint">Codes des boîtes à clés Masterlock par site. Chaque ajout/modification écrit directement le code dans la section "Lieux des boîtes à clés" de la fiche du dossier de site correspondant (champ Procédure).</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="nav-btn" id="mlk-choisir-site">➕ Ajouter un code sur un site</button>
        <button class="nav-btn" id="mlk-import" style="border-color:var(--gold);color:var(--gold)">📥 Importer les codes déjà présents dans les dossiers de site</button>
        <button class="nav-btn" id="mlk-export-recap">🖨️ Exporter le récap complet (toutes résidences)</button>
      </div>
      <div id="mlk-import-status" style="font-size:12px"></div>
      ${sitesAvecCodes.length === 0 ? `<p class="hint">Aucun code enregistré pour l'instant.</p>` : groupes.map(g => `
        <div>
          <h3 style="margin:12px 0 8px;font-size:15px;color:var(--gold)">${esc(g.assocLabel)}</h3>
          ${g.groups.map(sub => `
            ${sub.groupeLabel ? `<div style="font-size:12px;color:var(--text-dim);margin:6px 0 6px 4px">${esc(sub.groupeLabel)}</div>` : ""}
            ${sub.sites.map(site => renderSiteCard(site)).join("")}
          `).join("")}
        </div>
      `).join("")}
    </div>
  `;

  document.getElementById("mlk-choisir-site").addEventListener("click", () => {
    const nom = prompt("Nom du site (tape le début du nom pour chercher) :");
    if (!nom) return;
    const match = state.sites.find(s => s.nom.toLowerCase().includes(nom.trim().toLowerCase()));
    if (!match) { alert("Aucun site trouvé avec ce nom."); return; }
    ui.addingSiteId = match.id; ui.ouverts.add(match.id); render();
  });
  document.getElementById("mlk-export-recap").addEventListener("click", () => exporterRecap(state.sites));
  document.getElementById("mlk-import").addEventListener("click", async () => {
    const statusEl = document.getElementById("mlk-import-status");
    if (!confirm("Chercher, dans toutes les fiches de dossier de site, une section \"boîte à clés\" contenant un code (ex. \"CODE 8572\"), et créer automatiquement une entrée ici pour chaque site qui n'en a pas encore ?")) return;
    statusEl.innerHTML = `<span style="color:var(--text-dim)">⏳ Recherche et import en cours…</span>`;
    try {
      const n = await importerCodesDepuisDossiers(mountedUser);
      statusEl.innerHTML = n > 0
        ? `<span style="color:var(--gold)">✓ ${n} code(s) importé(s) depuis les dossiers de site.</span>`
        : `<span class="hint">Aucun code supplémentaire trouvé à importer (soit déjà présents ici, soit aucune section "boîte à clés" avec un code détecté).</span>`;
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
  mountedContainer.querySelectorAll("[data-export-site]").forEach(btn => btn.addEventListener("click", () => {
    const site = state.sites.find(s => s.id === btn.dataset.exportSite);
    if (site) exporterRecap([site]);
  }));
  mountedContainer.querySelectorAll("[data-open-add]").forEach(btn => btn.addEventListener("click", () => {
    ui.addingSiteId = btn.dataset.openAdd; render();
  }));
  mountedContainer.querySelectorAll("[data-edit-code]").forEach(btn => btn.addEventListener("click", () => {
    ui.editingCodeId = ui.editingCodeId === btn.dataset.editCode ? null : btn.dataset.editCode;
    render();
  }));
  mountedContainer.querySelectorAll("[data-del-code]").forEach(btn => btn.addEventListener("click", async () => {
    const c = state.codes.find(x => x.id === btn.dataset.delCode);
    if (!c) return;
    if (!confirm(`Supprimer "${c.nom}" (${c.dossierNom}) ? L'historique des codes précédents est conservé.`)) return;
    try { await supprimerCode(c.id, c.dossierId); await load(); } catch (e) { alert("Erreur : " + (e.message || e)); }
  }));
  mountedContainer.querySelectorAll("[data-toggle-hist]").forEach(btn => btn.addEventListener("click", async () => {
    const dossierId = btn.dataset.toggleHist;
    if (ui.historiqueOuverts.has(dossierId)) { ui.historiqueOuverts.delete(dossierId); render(); return; }
    ui.historiqueOuverts.add(dossierId);
    render();
    const holder = document.getElementById(`mlk-hist-${dossierId}`);
    if (holder) {
      holder.innerHTML = `<p class="hint" style="margin:8px 0">⏳ Chargement…</p>`;
      const historique = await listerHistoriquePourSite(dossierId);
      holder.innerHTML = renderHistoriqueHTML(historique);
    }
  }));

  attachAddFormListeners();
  attachEditFormListeners();
}

function renderSiteCard(site) {
  const codes = state.codes.filter(c => c.dossierId === site.id);
  const ouvert = ui.ouverts.has(site.id);
  return `
    <div class="form-card" style="padding:0;overflow:visible;margin-bottom:8px">
      <div style="width:100%;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 16px">
        <button data-toggle-site="${site.id}" style="flex:1;display:flex;align-items:center;gap:10px;background:none;border:none;cursor:pointer;text-align:left;padding:0;min-width:0">
          <span style="font-size:14px;color:var(--gold);font-weight:700">🔐 ${esc(site.nom)}</span>
        </button>
        <span style="display:flex;align-items:center;gap:10px">
          <span style="font-size:11px;color:var(--text-dim)">${codes.length} boîte(s)</span>
          <button data-toggle-site="${site.id}" style="background:none;border:none;cursor:pointer;font-size:12px;color:var(--text-dim);padding:0">${ouvert ? "▲" : "▼"}</button>
        </span>
      </div>
      ${ouvert ? `
      <div style="padding:0 16px 16px">
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
          <button class="nav-btn" data-export-site="${site.id}" ${codes.length === 0 ? 'disabled style="opacity:.4"' : ''}>🖨️ Exporter ce site</button>
          <button class="nav-btn" data-toggle-hist="${site.id}">🗂️ Historique des changements</button>
        </div>
        ${codes.length === 0 ? `<p class="hint">Aucune boîte à clés pour l'instant sur ce site.</p>` : codes.map(c => `
          <div class="form-card" style="margin-bottom:8px">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap">
              <div>
                <p style="margin:0;font-weight:700">${esc(c.nom)}</p>
                <p style="margin:2px 0 0;font-size:20px;font-weight:800;letter-spacing:2px;color:var(--gold)">${esc(c.code || "—")}</p>
                ${c.notes ? `<p style="margin:2px 0 0;font-size:12px;color:var(--text-dim)">${esc(c.notes)}</p>` : ""}
                <p style="margin:2px 0 0;font-size:11px;color:var(--text-dim)">Mis à jour le ${formatDate(c.derniereMajAt)} par ${esc(c.derniereMajParNom || "—")}</p>
              </div>
              <div style="display:flex;gap:6px;flex-wrap:wrap">
                <button class="nav-btn" data-edit-code="${c.id}" style="padding:6px 10px;font-size:12px">✏️</button>
                <button class="del-btn" data-del-code="${c.id}" style="padding:6px 10px;font-size:12px">🗑️</button>
              </div>
            </div>
            ${ui.editingCodeId === c.id ? renderEditForm(c) : ""}
          </div>
        `).join("")}
        <div id="mlk-add-zone-${site.id}" style="margin-top:14px">
          ${ui.addingSiteId === site.id ? renderAddForm(site) : `
            <button class="nav-btn" data-open-add="${site.id}">➕ Ajouter une boîte à clés</button>
          `}
        </div>
        <div id="mlk-status-${site.id}" style="font-size:12px;margin-top:8px"></div>
        ${ui.historiqueOuverts.has(site.id) ? `<div id="mlk-hist-${site.id}" style="margin-top:12px"></div>` : ""}
      </div>
      ` : ""}
    </div>
  `;
}

function renderHistoriqueHTML(historique) {
  if (historique.length === 0) return `<p class="hint" style="margin:8px 0">Aucun changement de code enregistré pour l'instant.</p>`;
  return `
    <div class="table-wrap" style="border:none">
      <table>
        <thead><tr><th>Date</th><th>Boîte</th><th>Ancien code</th><th>Nouveau code</th><th>Modifié par</th></tr></thead>
        <tbody>
          ${historique.map(h => `
            <tr>
              <td>${new Date(h.at).toLocaleString("fr-FR")}</td>
              <td>${esc(h.nom || "")}</td>
              <td>${esc(h.ancienCode || "— (création)")}</td>
              <td style="font-weight:700">${esc(h.nouveauCode || "")}</td>
              <td>${esc(h.modifieParNom || "")}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

// Catégories courantes proposées en menu déroulant pour nommer une boîte
// à clés — évite de retaper à chaque fois un nom légèrement différent
// pour la même chose d'un site à l'autre, tout en gardant "Autre" pour
// les cas particuliers.
const CATEGORIES_BOITE = [
  "Accès bâtiment", "Accès chaufferie", "Accès parking", "Accès atelier",
  "Accès salle de sport", "Accès local poubelles", "Boîte aux lettres",
];

function selectCategorieHTML(id, valeurActuelle) {
  const estPreset = CATEGORIES_BOITE.includes(valeurActuelle);
  return `
    <select id="${id}">
      <option value="">— Choisir une catégorie —</option>
      ${CATEGORIES_BOITE.map(c => `<option value="${esc(c)}" ${valeurActuelle === c ? "selected" : ""}>${esc(c)}</option>`).join("")}
      <option value="__autre__" ${!estPreset && valeurActuelle ? "selected" : ""}>Autre (préciser)…</option>
    </select>
    <input id="${id}-autre" placeholder="Nom de la boîte à clés" value="${!estPreset ? esc(valeurActuelle || "") : ""}" style="margin-top:6px;${estPreset || !valeurActuelle ? "display:none" : ""}">
  `;
}

function wireSelectCategorie(id) {
  const select = document.getElementById(id);
  const autre = document.getElementById(`${id}-autre`);
  if (!select || !autre) return;
  const sync = () => { autre.style.display = select.value === "__autre__" ? "block" : "none"; };
  select.addEventListener("change", sync);
  sync();
}

function valeurCategorie(id) {
  const select = document.getElementById(id);
  const autre = document.getElementById(`${id}-autre`);
  if (select.value === "__autre__") return (autre.value || "").trim();
  return select.value;
}

function renderAddForm(site) {
  return `
    <div class="form-card">
      <h4 style="margin:0 0 10px;font-size:14px">Nouvelle boîte à clés — ${esc(site.nom)}</h4>
      <div class="form-grid">
        <label>Catégorie${selectCategorieHTML("mlk-new-nom", "")}</label>
        <label>Code<input id="mlk-new-code" placeholder="ex. 1234" inputmode="numeric"></label>
        <label>Notes (optionnel)<input id="mlk-new-notes" placeholder="ex. accès sous le porche, à droite"></label>
      </div>
      <div style="display:flex;gap:8px;margin-top:10px">
        <button class="add-btn" id="mlk-new-save">💾 Ajouter</button>
        <button class="nav-btn" id="mlk-new-cancel">Annuler</button>
      </div>
      <div id="mlk-new-status" style="font-size:12px;margin-top:8px"></div>
    </div>
  `;
}

function attachAddFormListeners() {
  const btn = document.getElementById("mlk-new-save");
  if (!btn) return;
  wireSelectCategorie("mlk-new-nom");
  document.getElementById("mlk-new-cancel").addEventListener("click", () => { ui.addingSiteId = null; render(); });
  btn.addEventListener("click", async () => {
    const statusEl = document.getElementById("mlk-new-status");
    const site = state.sites.find(s => s.id === ui.addingSiteId);
    const nom = valeurCategorie("mlk-new-nom") || "Boîte à clés";
    const code = document.getElementById("mlk-new-code").value.trim();
    const notes = document.getElementById("mlk-new-notes").value.trim();
    if (!code) { statusEl.innerHTML = `<span style="color:var(--red)">Le code est obligatoire.</span>`; return; }
    statusEl.innerHTML = `<span style="color:var(--text-dim)">⏳ Ajout…</span>`;
    try {
      const entry = nouveauCode();
      entry.nom = nom; entry.code = code; entry.notes = notes;
      await creerCode(site.id, site.nom, entry, mountedUser);
      ui.addingSiteId = null;
      await load();
    } catch (e) {
      statusEl.innerHTML = `<span style="color:var(--red)">❌ ${esc(e.message || String(e))}</span>`;
    }
  });
}

function renderEditForm(c) {
  return `
    <div class="form-card" style="margin-top:10px;background:var(--panel-alt)">
      <h4 style="margin:0 0 10px;font-size:14px">Modifier — ${esc(c.nom)}</h4>
      <div class="form-grid">
        <label>Catégorie${selectCategorieHTML("mlk-edit-nom", c.nom)}</label>
        <label>Code<input id="mlk-edit-code" value="${esc(c.code || "")}" inputmode="numeric"></label>
        <label>Notes (optionnel)<input id="mlk-edit-notes" value="${esc(c.notes || "")}"></label>
      </div>
      <div style="display:flex;gap:8px;margin-top:10px">
        <button class="add-btn" id="mlk-edit-save" data-id="${c.id}">💾 Enregistrer</button>
        <button class="nav-btn" id="mlk-edit-cancel">Annuler</button>
      </div>
      <div id="mlk-edit-status" style="font-size:12px;margin-top:8px"></div>
    </div>
  `;
}

function attachEditFormListeners() {
  const btn = document.getElementById("mlk-edit-save");
  if (!btn) return;
  wireSelectCategorie("mlk-edit-nom");
  const c = state.codes.find(x => x.id === ui.editingCodeId);
  document.getElementById("mlk-edit-cancel").addEventListener("click", () => { ui.editingCodeId = null; render(); });
  btn.addEventListener("click", async () => {
    const statusEl = document.getElementById("mlk-edit-status");
    const nom = valeurCategorie("mlk-edit-nom");
    const code = document.getElementById("mlk-edit-code").value.trim();
    const notes = document.getElementById("mlk-edit-notes").value.trim();
    if (!code) { statusEl.innerHTML = `<span style="color:var(--red)">Le code est obligatoire.</span>`; return; }
    statusEl.innerHTML = `<span style="color:var(--text-dim)">⏳ Enregistrement…</span>`;
    try {
      await modifierCode(c, { nom: nom || c.nom, code, notes }, mountedUser);
      ui.editingCodeId = null;
      await load();
    } catch (e) {
      statusEl.innerHTML = `<span style="color:var(--red)">❌ ${esc(e.message || String(e))}</span>`;
    }
  });
}

// Récap imprimable pour les équipes — un ou plusieurs sites, groupés par
// association comme à l'écran. Réutilise le mécanisme générique
// .print-fiche/.print-only déjà en place dans l'appli.
function exporterRecap(sites) {
  const groupes = groupedSites(sites.filter(s => state.codes.some(c => c.dossierId === s.id)));
  if (groupes.length === 0) { alert("Aucun code à exporter pour le moment."); return; }

  const carteCode = (c) => `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:14px;padding:10px 14px;border:1px solid #e2ddd0;border-radius:8px;background:#FAF8F3;margin-bottom:6px">
      <div style="min-width:0">
        <p style="margin:0;font-weight:700;font-size:13px;color:#222">${esc(c.nom)}</p>
        ${c.notes ? `<p style="margin:2px 0 0;font-size:11px;color:#777">${esc(c.notes)}</p>` : ""}
      </div>
      <div style="flex:none;background:#B08D46;color:#fff;font-weight:800;font-size:20px;letter-spacing:3px;border-radius:6px;padding:6px 16px;white-space:nowrap">${esc(c.code || "—")}</div>
    </div>
  `;

  const carteSite = (site) => {
    const codes = state.codes.filter(c => c.dossierId === site.id);
    if (codes.length === 0) return "";
    return `
      <div style="border:1px solid #ddd;border-radius:10px;padding:14px 16px;margin-bottom:12px;break-inside:avoid;page-break-inside:avoid">
        <h4 style="margin:0 0 8px;font-size:14px;color:#111;border-bottom:2px solid #B08D46;padding-bottom:6px">🔐 ${esc(site.nom)}</h4>
        ${codes.map(carteCode).join("")}
      </div>
    `;
  };

  const html = `
    <div class="print-fiche" style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:0;color:#111;overflow:hidden">
      <div style="background:linear-gradient(135deg,#1a1a1a,#2b2b2b);padding:24px 28px;display:flex;align-items:center;gap:18px">
        <img src="img/logo-etablieres.png" alt="Groupe Établières" style="height:56px;background:#fff;border-radius:8px;padding:6px">
        <div>
          <p style="margin:0;color:#D9B24C;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase">Groupe Établières · Service Maintenance et Ménage</p>
          <h1 style="margin:2px 0 0;color:#fff;font-size:22px">🔐 Codes Masterlock — Récapitulatif</h1>
        </div>
      </div>
      <div style="padding:20px 28px">
        <p style="margin:0 0 18px;font-size:11px;color:#a00;font-weight:700;background:#fdecea;border:1px solid #f5c6c1;border-radius:6px;padding:8px 12px;display:inline-block">⚠️ Document sensible — usage interne uniquement. Exporté le ${formatDate(Date.now())}.</p>
        ${groupes.map(g => `
          <h2 style="margin:20px 0 10px;font-size:16px;color:#B08D46;border-bottom:1px solid #eee;padding-bottom:6px">${esc(g.assocLabel)}</h2>
          ${g.groups.map(sub => `
            ${sub.groupeLabel ? `<p style="margin:8px 0 8px;font-weight:700;font-size:12px;color:#666;text-transform:uppercase;letter-spacing:.5px">${esc(sub.groupeLabel)}</p>` : ""}
            ${sub.sites.map(carteSite).join("")}
          `).join("")}
        `).join("")}
      </div>
    </div>
  `;

  const printRoot = document.createElement("div");
  printRoot.id = "mlk-print-root";
  printRoot.className = "print-only";
  printRoot.innerHTML = html;
  document.body.appendChild(printRoot);
  window.print();
  setTimeout(() => printRoot.remove(), 1000);
}

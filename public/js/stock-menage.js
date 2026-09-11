// stock-menage.js
// Nouvel onglet indépendant "Stock Ménage" : produits de ménage
// (papier toilette, savon, produits d'entretien...), distinct du Stock
// maintenance (pièces techniques). Chaque sortie est attribuée à un
// centre (dossier de site) ou au dispositif MNA, pour suivre qui
// consomme quoi.

import { esc } from "./astreinte-logic.js";
import {
  watchProduits, creerProduit, modifierProduit, supprimerProduit,
  enregistrerSortie, enregistrerEntree, watchSorties,
  nouveauProduit, CATEGORIES_MENAGE, MNA_ID, MNA_LABEL,
} from "./stock-menage-data.js";
import { watchSitesDossiers } from "./site-dossier-data.js";

let mountedContainer = null;
let mountedUser = null;
let state = { produits: [], sorties: [], sites: [] };
let unsubs = [];
let ui = { onglet: "produits", addingOpen: false, editingId: null, filtreAttribution: "toutes", filtreCategorie: "toutes" };

export async function mountStockMenage(container, user) {
  mountedContainer = container;
  mountedUser = user;
  state = { produits: [], sorties: [], sites: [] };
  ui = { onglet: "produits", addingOpen: false, editingId: null, filtreAttribution: "toutes", filtreCategorie: "toutes" };
  unsubs.forEach(u => u());
  container.innerHTML = `<div class="hint">Chargement…</div>`;
  unsubs = [
    watchProduits((list) => { state.produits = list; render(); }),
    watchSorties((list) => { state.sorties = list; render(); }),
    watchSitesDossiers((list) => { state.sites = list; render(); }),
  ];
  render();
}

function render() {
  if (!mountedContainer || !document.contains(mountedContainer)) return;
  mountedContainer.innerHTML = `
    <div class="stack">
      <p class="hint">Produits de ménage (papier toilette, savon, produits d'entretien…), distincts du stock de pièces techniques. Chaque sortie est attribuée à un centre ou au dispositif MNA, pour suivre la consommation.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="nav-btn" id="sm-onglet-produits" style="${ui.onglet === 'produits' ? 'border-color:var(--gold);color:var(--gold)' : ''}">📦 Produits & stock</button>
        <button class="nav-btn" id="sm-onglet-historique" style="${ui.onglet === 'historique' ? 'border-color:var(--gold);color:var(--gold)' : ''}">🗂️ Historique des sorties</button>
      </div>
      <div id="sm-corps"></div>
    </div>
  `;
  document.getElementById("sm-onglet-produits").addEventListener("click", () => { ui.onglet = "produits"; render(); });
  document.getElementById("sm-onglet-historique").addEventListener("click", () => { ui.onglet = "historique"; render(); });

  const corps = document.getElementById("sm-corps");
  if (ui.onglet === "produits") renderProduits(corps); else renderHistorique(corps);
}

function attributionOptions(selectionnee) {
  const options = [`<option value="">— Choisir —</option>`, `<option value="${MNA_ID}" ${selectionnee === MNA_ID ? "selected" : ""}>👥 ${MNA_LABEL}</option>`];
  state.sites.forEach(s => options.push(`<option value="${s.id}" ${selectionnee === s.id ? "selected" : ""}>🏢 ${esc(s.nom)}</option>`));
  return options.join("");
}

function nomAttribution(id) {
  if (id === MNA_ID) return MNA_LABEL;
  return state.sites.find(s => s.id === id)?.nom || "Inconnu";
}

// =================================================================
// Onglet Produits & stock
// =================================================================
function renderProduits(container) {
  const produits = state.produits;
  container.innerHTML = `
    <div style="display:flex;gap:8px;margin:10px 0">
      <button class="add-btn" id="sm-add">➕ Ajouter un produit</button>
    </div>
    ${ui.addingOpen ? renderFormProduit(null) : ""}
    ${produits.length === 0 ? `<p class="hint">Aucun produit pour l'instant.</p>` : CATEGORIES_MENAGE.map(cat => {
      const liste = produits.filter(p => p.categorie === cat);
      if (liste.length === 0) return "";
      return `
        <p style="font-size:12px;font-weight:700;color:var(--text-dim);margin:14px 0 6px">${esc(cat)}</p>
        ${liste.map(p => renderCarteProduit(p)).join("")}
      `;
    }).join("")}
    ${produits.filter(p => !CATEGORIES_MENAGE.includes(p.categorie)).map(p => renderCarteProduit(p)).join("")}
  `;

  document.getElementById("sm-add").addEventListener("click", () => { ui.addingOpen = !ui.addingOpen; ui.editingId = null; render(); });
  attacherEcouteursProduits();
}

function renderCarteProduit(p) {
  const enAlerte = (p.stockActuel || 0) <= (p.seuilMin || 0);
  return `
    <div class="form-card" style="margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap">
        <div>
          <p style="margin:0;font-weight:700">${esc(p.nom)}</p>
          <p style="margin:2px 0 0;font-size:12px;${enAlerte ? "color:var(--red);font-weight:700" : "color:var(--text-dim)"}">${enAlerte ? "⚠️ " : ""}Stock : ${p.stockActuel || 0} ${esc(p.unite || "")} ${enAlerte ? "(sous le seuil)" : ""} · Seuil : ${p.seuilMin || 0}</p>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="nav-btn" data-sortie="${p.id}" style="padding:6px 10px;font-size:12px">📤 Sortie</button>
          <button class="nav-btn" data-entree="${p.id}" style="padding:6px 10px;font-size:12px">📥 Entrée</button>
          <button class="nav-btn" data-edit-sm="${p.id}" style="padding:6px 10px;font-size:12px">✏️</button>
          <button class="del-btn" data-del-sm="${p.id}" style="padding:6px 10px;font-size:12px">🗑️</button>
        </div>
      </div>
      ${ui.editingId === p.id ? renderFormProduit(p) : ""}
      <div id="sm-sortie-form-${p.id}"></div>
      <div id="sm-entree-form-${p.id}"></div>
    </div>
  `;
}

function renderFormProduit(p) {
  const data = p || nouveauProduit();
  const prefix = p ? `sm-edit-${p.id}` : "sm-new";
  return `
    <div class="form-card" style="margin-top:8px;background:var(--panel-alt)">
      <h4 style="margin:0 0 10px;font-size:14px">${p ? "Modifier — " + esc(p.nom) : "Nouveau produit"}</h4>
      <div class="form-grid">
        <label>Nom<input id="${prefix}-nom" value="${esc(data.nom || '')}" placeholder="ex. Papier toilette"></label>
        <label>Catégorie
          <select id="${prefix}-categorie">
            <option value="">— Choisir —</option>
            ${CATEGORIES_MENAGE.map(c => `<option value="${esc(c)}" ${data.categorie === c ? "selected" : ""}>${esc(c)}</option>`).join("")}
          </select>
        </label>
        <label>Unité<input id="${prefix}-unite" value="${esc(data.unite || 'pièce')}" placeholder="ex. rouleau, litre, pièce"></label>
        <label>Stock actuel<input type="number" min="0" id="${prefix}-stock" value="${data.stockActuel || 0}"></label>
        <label>Seuil minimum (alerte)<input type="number" min="0" id="${prefix}-seuil" value="${data.seuilMin || 0}"></label>
      </div>
      <div style="display:flex;gap:8px;margin-top:10px">
        <button class="add-btn" data-save-sm="${p ? p.id : 'new'}">💾 Enregistrer</button>
        <button class="nav-btn" data-cancel-sm="${p ? p.id : 'new'}">Annuler</button>
      </div>
      <div id="${prefix}-status" style="font-size:12px;margin-top:8px"></div>
    </div>
  `;
}

function attacherEcouteursProduits() {
  mountedContainer.querySelectorAll("[data-edit-sm]").forEach(btn => btn.addEventListener("click", () => {
    ui.editingId = ui.editingId === btn.dataset.editSm ? null : btn.dataset.editSm;
    ui.addingOpen = false;
    render();
  }));
  mountedContainer.querySelectorAll("[data-del-sm]").forEach(btn => btn.addEventListener("click", async () => {
    const p = state.produits.find(x => x.id === btn.dataset.delSm);
    if (!p) return;
    if (!confirm(`Mettre "${p.nom}" à la corbeille ?`)) return;
    try { await supprimerProduit(p.id); } catch (e) { alert("Erreur : " + (e.message || e)); }
  }));
  mountedContainer.querySelectorAll("[data-cancel-sm]").forEach(btn => btn.addEventListener("click", () => {
    ui.addingOpen = false; ui.editingId = null; render();
  }));
  mountedContainer.querySelectorAll("[data-save-sm]").forEach(btn => btn.addEventListener("click", async () => {
    const id = btn.dataset.saveSm;
    const prefix = id === "new" ? "sm-new" : `sm-edit-${id}`;
    const statusEl = document.getElementById(`${prefix}-status`);
    const nom = document.getElementById(`${prefix}-nom`).value.trim();
    if (!nom) { statusEl.innerHTML = `<span style="color:var(--red)">Le nom est obligatoire.</span>`; return; }
    const payload = {
      nom, categorie: document.getElementById(`${prefix}-categorie`).value,
      unite: document.getElementById(`${prefix}-unite`).value.trim() || "pièce",
      stockActuel: parseInt(document.getElementById(`${prefix}-stock`).value, 10) || 0,
      seuilMin: parseInt(document.getElementById(`${prefix}-seuil`).value, 10) || 0,
    };
    statusEl.innerHTML = `<span style="color:var(--text-dim)">⏳ Enregistrement…</span>`;
    try {
      if (id === "new") { await creerProduit(payload); ui.addingOpen = false; }
      else { await modifierProduit(id, payload); ui.editingId = null; }
      render();
    } catch (e) {
      statusEl.innerHTML = `<span style="color:var(--red)">❌ ${esc(e.message || String(e))}</span>`;
    }
  }));

  mountedContainer.querySelectorAll("[data-sortie]").forEach(btn => btn.addEventListener("click", () => {
    const holder = document.getElementById(`sm-sortie-form-${btn.dataset.sortie}`);
    holder.innerHTML = holder.innerHTML ? "" : renderFormSortie(btn.dataset.sortie);
    if (holder.innerHTML) attacherEcouteurSortie(btn.dataset.sortie);
  }));
  mountedContainer.querySelectorAll("[data-entree]").forEach(btn => btn.addEventListener("click", () => {
    const holder = document.getElementById(`sm-entree-form-${btn.dataset.entree}`);
    holder.innerHTML = holder.innerHTML ? "" : renderFormEntree(btn.dataset.entree);
    if (holder.innerHTML) attacherEcouteurEntree(btn.dataset.entree);
  }));
}

function renderFormSortie(produitId) {
  return `
    <div class="form-card" style="margin-top:8px;background:var(--panel-alt)">
      <h4 style="margin:0 0 10px;font-size:13px">📤 Enregistrer une sortie</h4>
      <div class="form-grid">
        <label>Quantité<input type="number" min="1" id="sm-sortie-qte-${produitId}" value="1"></label>
        <label>Attribution (centre ou MNA)
          <select id="sm-sortie-attrib-${produitId}">${attributionOptions("")}</select>
        </label>
        <label>Commentaire (optionnel)<input id="sm-sortie-comment-${produitId}" placeholder="ex. réassort mensuel"></label>
      </div>
      <button class="add-btn" data-valider-sortie="${produitId}" style="margin-top:8px">💾 Valider la sortie</button>
      <div id="sm-sortie-status-${produitId}" style="font-size:12px;margin-top:8px"></div>
    </div>
  `;
}

function attacherEcouteurSortie(produitId) {
  document.querySelector(`[data-valider-sortie="${produitId}"]`).addEventListener("click", async () => {
    const statusEl = document.getElementById(`sm-sortie-status-${produitId}`);
    const p = state.produits.find(x => x.id === produitId);
    const qte = parseInt(document.getElementById(`sm-sortie-qte-${produitId}`).value, 10);
    const attribSelect = document.getElementById(`sm-sortie-attrib-${produitId}`);
    const attribId = attribSelect.value;
    if (!qte || qte <= 0) { statusEl.innerHTML = `<span style="color:var(--red)">Quantité invalide.</span>`; return; }
    if (!attribId) { statusEl.innerHTML = `<span style="color:var(--red)">Choisis une attribution.</span>`; return; }
    const commentaire = document.getElementById(`sm-sortie-comment-${produitId}`).value.trim();
    statusEl.innerHTML = `<span style="color:var(--text-dim)">⏳ Enregistrement…</span>`;
    try {
      await enregistrerSortie(p, qte, attribId, nomAttribution(attribId), commentaire, mountedUser);
      document.getElementById(`sm-sortie-form-${produitId}`).innerHTML = "";
    } catch (e) {
      statusEl.innerHTML = `<span style="color:var(--red)">❌ ${esc(e.message || String(e))}</span>`;
    }
  });
}

function renderFormEntree(produitId) {
  return `
    <div class="form-card" style="margin-top:8px;background:var(--panel-alt)">
      <h4 style="margin:0 0 10px;font-size:13px">📥 Enregistrer une entrée (réapprovisionnement)</h4>
      <label>Quantité reçue<input type="number" min="1" id="sm-entree-qte-${produitId}" value="1" style="max-width:160px"></label>
      <button class="add-btn" data-valider-entree="${produitId}" style="margin-top:8px">💾 Valider l'entrée</button>
      <div id="sm-entree-status-${produitId}" style="font-size:12px;margin-top:8px"></div>
    </div>
  `;
}

function attacherEcouteurEntree(produitId) {
  document.querySelector(`[data-valider-entree="${produitId}"]`).addEventListener("click", async () => {
    const statusEl = document.getElementById(`sm-entree-status-${produitId}`);
    const p = state.produits.find(x => x.id === produitId);
    const qte = parseInt(document.getElementById(`sm-entree-qte-${produitId}`).value, 10);
    if (!qte || qte <= 0) { statusEl.innerHTML = `<span style="color:var(--red)">Quantité invalide.</span>`; return; }
    statusEl.innerHTML = `<span style="color:var(--text-dim)">⏳ Enregistrement…</span>`;
    try {
      await enregistrerEntree(p, qte);
      document.getElementById(`sm-entree-form-${produitId}`).innerHTML = "";
    } catch (e) {
      statusEl.innerHTML = `<span style="color:var(--red)">❌ ${esc(e.message || String(e))}</span>`;
    }
  });
}

// =================================================================
// Onglet Historique des sorties
// =================================================================
function renderHistorique(container) {
  const sorties = state.sorties.filter(s => {
    if (ui.filtreAttribution !== "toutes" && s.attributionId !== ui.filtreAttribution) return false;
    if (ui.filtreCategorie !== "toutes" && s.categorie !== ui.filtreCategorie) return false;
    return true;
  });

  container.innerHTML = `
    <div class="filters-row" style="flex-wrap:wrap;gap:8px;margin:10px 0">
      <select id="sm-hist-attrib">
        <option value="toutes">Toutes attributions</option>
        ${attributionOptions(ui.filtreAttribution === "toutes" ? "" : ui.filtreAttribution)}
      </select>
      <select id="sm-hist-cat">
        <option value="toutes">Toutes catégories</option>
        ${CATEGORIES_MENAGE.map(c => `<option value="${esc(c)}" ${ui.filtreCategorie === c ? "selected" : ""}>${esc(c)}</option>`).join("")}
      </select>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Date</th><th>Produit</th><th>Quantité</th><th>Attribution</th><th>Commentaire</th><th>Par</th></tr></thead>
        <tbody>
          ${sorties.length === 0 ? `<tr><td colspan="6" class="empty-row">Aucune sortie pour ces filtres.</td></tr>` :
            sorties.map(s => `
              <tr>
                <td>${new Date(s.date).toLocaleDateString("fr-FR")}</td>
                <td>${esc(s.produitNom)}</td>
                <td>${s.quantite} ${esc(s.unite || "")}</td>
                <td>${s.attributionId === MNA_ID ? "👥 " : "🏢 "}${esc(s.attributionNom)}</td>
                <td>${esc(s.commentaire || "")}</td>
                <td>${esc(s.creePar || "")}</td>
              </tr>
            `).join("")}
        </tbody>
      </table>
    </div>
  `;

  document.getElementById("sm-hist-attrib").addEventListener("change", (e) => { ui.filtreAttribution = e.target.value || "toutes"; render(); });
  document.getElementById("sm-hist-cat").addEventListener("change", (e) => { ui.filtreCategorie = e.target.value; render(); });
}

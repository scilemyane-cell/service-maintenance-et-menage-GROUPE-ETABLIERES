// stock-site-catalogue.js
// Gestion du catalogue type utilisé pour configurer le stock déporté des
// sites ("🗂️ Configurer depuis la liste type" dans Dossiers de site).
// Indépendant du catalogue central de maintenance (stock-produits) — vide
// au départ, à alimenter selon ce que les sites doivent réellement garder
// en permanence sur place.

import { esc } from "./astreinte-logic.js";
import { activerGlisserDeposer } from "./drag-reorder.js";
import {
  watchCatalogueSite, ajouterProduitCatalogueSite, modifierProduitCatalogueSite, supprimerProduitCatalogueSite, definirOrdreCatalogueSite,
} from "./stock-site-data.js";
import { watchFournisseurs } from "./fournisseurs-data.js";

let mountedContainer = null;
let state = { produits: [], fournisseurs: [] };
let ui = { editId: null };
let unsub = null;

export function mountStockCatalogueSite(container) {
  if (unsub) { unsub(); unsub = null; }
  mountedContainer = container;
  ui = { editId: null };
  container.innerHTML = `<div class="hint">Chargement…</div>`;
  const u1 = watchCatalogueSite((p) => { state.produits = p; if (!ui.editId) render(); });
  const u2 = watchFournisseurs((f) => { state.fournisseurs = f; if (!ui.editId) render(); });
  unsub = () => { u1(); u2(); };
}

function render() {
  if (!mountedContainer) return;
  if (!document.contains(mountedContainer)) { if (unsub) { unsub(); unsub = null; } return; }

  if (ui.editId) { renderForm(ui.editId === "new" ? null : state.produits.find(p => p.id === ui.editId)); return; }

  mountedContainer.innerHTML = `
    <div class="stack">
      <p class="hint">Liste type utilisée pour configurer rapidement le stock déporté d'un site (case "Concerné" + quantité cible). Indépendante du catalogue du stock central — propre à ce que les sites doivent garder sur place.</p>
      <button class="add-btn" id="csc-new" style="width:fit-content">➕ Ajouter un produit</button>
      ${state.produits.length > 1 ? `<p class="hint" style="margin:0">Maintiens l'icône ☰ appuyée puis fais glisser pour réordonner la liste.</p>` : ""}
      <div class="table-wrap">
        <table>
          <thead><tr><th></th><th>Produit</th><th>Catégorie</th><th>Fournisseur</th><th>Unité</th><th></th></tr></thead>
          <tbody>
            ${state.produits.length === 0 ? `<tr><td colspan="6" class="empty-row">Liste vide pour l'instant.</td></tr>` :
              state.produits.map((p, idx) => `
                <tr data-drag-index="${idx}">
                  <td style="white-space:nowrap;width:1%"><span data-drag-handle style="font-size:16px;color:var(--text-dim);cursor:grab;padding:4px;user-select:none">☰</span></td>
                  <td>${esc(p.nom)}</td>
                  <td style="font-size:12px;color:var(--text-dim)">${esc(p.categorie || "—")}</td>
                  <td style="font-size:12px;color:var(--text-dim)">${esc(p.fournisseurNom || "—")}</td>
                  <td style="font-size:12px;color:var(--text-dim)">${esc(p.unite || "pièce")}</td>
                  <td style="white-space:nowrap">
                    <button class="nav-btn" data-edit="${p.id}" style="padding:4px 8px;font-size:11px">✏️</button>
                    <button class="del-btn" data-del="${p.id}" style="padding:4px 8px;font-size:11px">🗑️</button>
                  </td>
                </tr>
              `).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById("csc-new").addEventListener("click", () => { ui.editId = "new"; render(); });
  mountedContainer.querySelectorAll("[data-edit]").forEach(btn => btn.addEventListener("click", () => { ui.editId = btn.dataset.edit; render(); }));
  const listeAffichee = [...state.produits];
  activerGlisserDeposer(mountedContainer, "tbody tr[data-drag-index]", async (nouvelOrdre) => {
    const nouvelleListe = nouvelOrdre.map(ancienIndex => listeAffichee[ancienIndex]);
    if (nouvelleListe.every((p, i) => p === listeAffichee[i])) return;
    await definirOrdreCatalogueSite(nouvelleListe.map((p, i) => ({ id: p.id, ordre: i })));
  });
  mountedContainer.querySelectorAll("[data-del]").forEach(btn => btn.addEventListener("click", async () => {
    const p = state.produits.find(x => x.id === btn.dataset.del);
    if (confirm(`Retirer "${p.nom}" de la liste type ? (les articles déjà configurés sur des sites ne sont pas affectés)`)) await supprimerProduitCatalogueSite(p.id);
  }));
}

function renderForm(p) {
  mountedContainer.innerHTML = `
    <div class="stack">
      <button class="nav-btn" id="csc-back">← Retour</button>
      <div class="form-card">
        <h3 style="margin:0 0 10px;font-size:14px;color:var(--gold)">${p ? "Modifier" : "Nouveau"} produit type</h3>
        <div class="form-grid">
          <label>Nom<input id="csc-nom" value="${esc(p?.nom || '')}"></label>
          <label>Catégorie<input id="csc-categorie" value="${esc(p?.categorie || '')}" placeholder="ex. Sécurité, Consommables…"></label>
          <label>Unité<input id="csc-unite" value="${esc(p?.unite || 'pièce')}"></label>
          <label>Fournisseur
            <select id="csc-fournisseur">
              <option value="">— Même que le Stock maintenance (si le produit y existe) —</option>
              ${state.fournisseurs.map(f => `<option value="${f.id}" ${p?.fournisseurId === f.id ? "selected" : ""}>${esc(f.nom)}</option>`).join("")}
            </select>
          </label>
          <label>Réf. fournisseur<input id="csc-ref" value="${esc(p?.refFournisseur || '')}"></label>
        </div>
        <button class="add-btn" id="csc-save">💾 Enregistrer</button>
        <span id="csc-status" style="font-size:12px;margin-left:8px"></span>
      </div>
    </div>
  `;
  document.getElementById("csc-back").addEventListener("click", () => { ui.editId = null; render(); });
  document.getElementById("csc-save").addEventListener("click", async () => {
    const statusEl = document.getElementById("csc-status");
    const nom = document.getElementById("csc-nom").value.trim();
    if (!nom) { statusEl.innerHTML = `<span style="color:var(--red)">Le nom est obligatoire.</span>`; return; }
    const payload = {
      nom,
      categorie: document.getElementById("csc-categorie").value.trim(),
      unite: document.getElementById("csc-unite").value.trim() || "pièce",
      refFournisseur: document.getElementById("csc-ref").value.trim(),
    };
    const f = state.fournisseurs.find(x => x.id === document.getElementById("csc-fournisseur").value);
    Object.assign(payload, f
      ? { fournisseurId: f.id, fournisseurNom: f.nom || "", fournisseurEmail: f.email || "" }
      : { fournisseurId: null, fournisseurNom: "", fournisseurEmail: "" });
    statusEl.innerHTML = `<span style="color:var(--text-dim)">⏳ Enregistrement…</span>`;
    try {
      if (p) await modifierProduitCatalogueSite(p.id, payload);
      else await ajouterProduitCatalogueSite({ ...payload, ordre: state.produits.reduce((m, x) => Math.max(m, x.ordre ?? -1), state.produits.length - 1) + 1 });
      ui.editId = null; render();
    } catch (e) {
      statusEl.innerHTML = `<span style="color:var(--red)">❌ ${esc(e.message || String(e))}</span>`;
    }
  });
}

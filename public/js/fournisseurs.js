// fournisseurs.js
// Gestion de la liste des fournisseurs (onglet "Fournisseurs" du module
// Stock maintenance) : nom, commercial, email — réutilisée lors de l'ajout
// d'un produit au stock central, pour ne pas ressaisir ces informations
// à chaque fois.

import { esc } from "./astreinte-logic.js";
import {
  watchFournisseurs, ajouterFournisseur, modifierFournisseur, supprimerFournisseur,
} from "./fournisseurs-data.js";

let mountedContainer = null;
let state = { fournisseurs: [] };
let ui = { editId: null };
let unsub = null;

export function mountFournisseurs(container) {
  if (unsub) { unsub(); unsub = null; }
  mountedContainer = container;
  ui = { editId: null };
  container.innerHTML = `<div class="hint">Chargement…</div>`;
  unsub = watchFournisseurs((f) => { state.fournisseurs = f; if (!ui.editId) render(); });
}

function render() {
  if (!mountedContainer) return;
  if (!document.contains(mountedContainer)) { if (unsub) { unsub(); unsub = null; } return; }

  if (ui.editId) { renderForm(ui.editId === "new" ? null : state.fournisseurs.find(f => f.id === ui.editId)); return; }

  mountedContainer.innerHTML = `
    <div class="stack">
      <p class="hint">Liste des fournisseurs, réutilisable lors de l'ajout d'un produit au stock central — plus besoin de ressaisir le nom, le contact commercial et l'email à chaque fois.</p>
      <button class="add-btn" id="fr-new" style="width:fit-content">➕ Ajouter un fournisseur</button>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Fournisseur</th><th>Commercial</th><th>Email</th><th></th></tr></thead>
          <tbody>
            ${state.fournisseurs.length === 0 ? `<tr><td colspan="4" class="empty-row">Aucun fournisseur pour l'instant.</td></tr>` :
              state.fournisseurs.map(f => `
                <tr>
                  <td>${esc(f.nom)}</td>
                  <td style="font-size:12px;color:var(--text-dim)">${esc(f.commercial || "—")}</td>
                  <td style="font-size:12px;color:var(--text-dim)">${esc(f.email || "—")}</td>
                  <td style="white-space:nowrap">
                    <button class="nav-btn" data-edit="${f.id}" style="padding:4px 8px;font-size:11px">✏️</button>
                    <button class="del-btn" data-del="${f.id}" style="padding:4px 8px;font-size:11px">🗑️</button>
                  </td>
                </tr>
              `).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById("fr-new").addEventListener("click", () => { ui.editId = "new"; render(); });
  mountedContainer.querySelectorAll("[data-edit]").forEach(btn => btn.addEventListener("click", () => { ui.editId = btn.dataset.edit; render(); }));
  mountedContainer.querySelectorAll("[data-del]").forEach(btn => btn.addEventListener("click", async () => {
    const f = state.fournisseurs.find(x => x.id === btn.dataset.del);
    if (confirm(`Retirer "${f.nom}" de la liste des fournisseurs ? (les produits déjà liés gardent leurs informations actuelles)`)) await supprimerFournisseur(f.id);
  }));
}

function renderForm(f) {
  mountedContainer.innerHTML = `
    <div class="stack">
      <button class="nav-btn" id="fr-back">← Retour</button>
      <div class="form-card">
        <h3 style="margin:0 0 10px;font-size:14px;color:var(--gold)">${f ? "Modifier" : "Nouveau"} fournisseur</h3>
        <div class="form-grid">
          <label>Nom du fournisseur<input id="fr-nom" value="${esc(f?.nom || '')}" placeholder="ex. Cedeo, Rexel…"></label>
          <label>Contact commercial<input id="fr-commercial" value="${esc(f?.commercial || '')}" placeholder="ex. Jean Dupont"></label>
          <label>Email<input id="fr-email" type="email" value="${esc(f?.email || '')}" placeholder="commandes@fournisseur.fr"></label>
        </div>
        <button class="add-btn" id="fr-save">💾 Enregistrer</button>
        <span id="fr-status" style="font-size:12px;margin-left:8px"></span>
      </div>
    </div>
  `;
  document.getElementById("fr-back").addEventListener("click", () => { ui.editId = null; render(); });
  document.getElementById("fr-save").addEventListener("click", async () => {
    const statusEl = document.getElementById("fr-status");
    const nom = document.getElementById("fr-nom").value.trim();
    if (!nom) { statusEl.innerHTML = `<span style="color:var(--red)">Le nom est obligatoire.</span>`; return; }
    const payload = {
      nom,
      commercial: document.getElementById("fr-commercial").value.trim(),
      email: document.getElementById("fr-email").value.trim(),
    };
    statusEl.innerHTML = `<span style="color:var(--text-dim)">⏳ Enregistrement…</span>`;
    try {
      if (f) await modifierFournisseur(f.id, payload); else await ajouterFournisseur(payload);
      ui.editId = null; render();
    } catch (e) {
      statusEl.innerHTML = `<span style="color:var(--red)">❌ ${esc(e.message || String(e))}</span>`;
    }
  });
}

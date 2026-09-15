// taches.js
// Onglet "Suivi des tâches" — réservé au Super Admin. Vue en colonnes
// par étape (À faire / En cours / Bloquée / Terminée) pour avoir un
// visuel immédiat sur ce qui avance, sur le même principe que le
// Prévisionnel Travaux mais pour le suivi interne au quotidien.

import { esc } from "./astreinte-logic.js";
import {
  ETAPES, PRIORITES, nouvelleTache, watchTaches,
  creerTache, modifierTache, changerEtape, supprimerTache,
} from "./taches-data.js";

let mountedContainer = null;
let mountedUser = null;
let unsub = null;
let state = { taches: [] };
let ui = { addingOpen: false, editingId: null, filtrePriorite: "toutes" };

export function mountTaches(container, user) {
  mountedContainer = container;
  mountedUser = user;
  state = { taches: [] };
  ui = { addingOpen: false, editingId: null, filtrePriorite: "toutes" };
  if (unsub) unsub();
  container.innerHTML = `<p class="hint">⏳ Chargement…</p>`;
  unsub = watchTaches((list) => {
    state.taches = list;
    if (document.contains(mountedContainer)) render();
  });
}

function tachesFiltrees() {
  return state.taches.filter(t => ui.filtrePriorite === "toutes" || t.priorite === ui.filtrePriorite);
}

function render() {
  if (!mountedContainer || !document.contains(mountedContainer)) return;
  const taches = tachesFiltrees();
  const total = state.taches.length;
  const termine = state.taches.filter(t => t.etape === "termine").length;
  const pct = total > 0 ? Math.round((termine / total) * 100) : 0;

  mountedContainer.innerHTML = `
    <div class="stack">
      <p class="hint">Suivi interne des choses à faire ou en cours — visible uniquement par les Super Administrateurs.</p>

      <div class="form-card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <h3 style="margin:0;font-size:13px;color:var(--text-dim)">Avancement global</h3>
          <span style="font-family:ui-monospace,monospace;font-weight:700;color:var(--gold)">${termine} / ${total} terminée(s) — ${pct}%</span>
        </div>
        <div style="background:var(--panel-alt);border-radius:6px;height:12px;overflow:hidden">
          <div style="width:${pct}%;height:100%;background:var(--teal);border-radius:6px;transition:width .3s ease"></div>
        </div>
      </div>

      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        <button class="add-btn" id="tc-new">➕ Nouvelle tâche</button>
        <select id="tc-filtre-priorite">
          <option value="toutes" ${ui.filtrePriorite === "toutes" ? "selected" : ""}>Toutes priorités</option>
          ${Object.entries(PRIORITES).map(([k, v]) => `<option value="${k}" ${ui.filtrePriorite === k ? "selected" : ""}>${v}</option>`).join("")}
        </select>
      </div>

      ${ui.addingOpen ? renderFormTache(null) : ""}
      ${ui.editingId ? renderFormTache(state.taches.find(t => t.id === ui.editingId)) : ""}

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:14px;align-items:start">
        ${Object.entries(ETAPES).map(([cle, label]) => renderColonne(cle, label, taches)).join("")}
      </div>
    </div>
  `;

  document.getElementById("tc-new").addEventListener("click", () => { ui.addingOpen = !ui.addingOpen; ui.editingId = null; render(); });
  document.getElementById("tc-filtre-priorite").addEventListener("change", (e) => { ui.filtrePriorite = e.target.value; render(); });
  attacherEcouteursFormulaire();
  attacherEcouteursCartes();
}

function renderColonne(cle, label, taches) {
  const lignes = taches.filter(t => t.etape === cle).sort((a, b) => (a.priorite === "haute" ? -1 : 0) - (b.priorite === "haute" ? -1 : 0));
  const couleur = cle === "bloque" ? "var(--red)" : cle === "termine" ? "var(--teal)" : "var(--gold)";
  return `
    <div>
      <p style="margin:0 0 8px;font-size:12px;font-weight:700;color:${couleur};border-bottom:2px solid ${couleur};padding-bottom:6px">${esc(label)} (${lignes.length})</p>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${lignes.length === 0 ? `<p class="hint" style="font-size:12px">—</p>` : lignes.map(t => renderCarteTache(t, cle)).join("")}
      </div>
    </div>
  `;
}

function renderCarteTache(t, etapeActuelle) {
  const etapesCles = Object.keys(ETAPES);
  const idx = etapesCles.indexOf(etapeActuelle);
  const precedente = etapesCles[idx - 1];
  const suivante = etapesCles[idx + 1];
  return `
    <div class="form-card" style="padding:10px 12px;margin:0" data-tache-id="${t.id}">
      <p style="margin:0 0 4px;font-size:13px;font-weight:700">${PRIORITES[t.priorite] || ""} ${esc(t.titre)}</p>
      ${t.description ? `<p style="margin:0 0 6px;font-size:12px;color:var(--text-dim);white-space:pre-wrap">${esc(t.description)}</p>` : ""}
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">
        ${precedente ? `<button class="nav-btn" data-avancer="${t.id}:${precedente}" style="font-size:11px">← ${esc(ETAPES[precedente])}</button>` : ""}
        ${suivante ? `<button class="nav-btn" data-avancer="${t.id}:${suivante}" style="font-size:11px">${esc(ETAPES[suivante])} →</button>` : ""}
        <button class="nav-btn" data-tc-edit="${t.id}" style="font-size:11px">✏️</button>
        <button class="del-btn" data-tc-del="${t.id}" style="font-size:11px">🗑️</button>
      </div>
    </div>
  `;
}

function renderFormTache(t) {
  const data = t || nouvelleTache();
  const id = t ? t.id : "new";
  return `
    <div class="form-card">
      <h3 style="margin:0 0 12px;font-size:14px">${t ? "✏️ Modifier la tâche" : "➕ Nouvelle tâche"}</h3>
      <div class="form-grid">
        <label>Titre<input id="tc-f-titre" value="${esc(data.titre)}" placeholder="ex. Relancer le fournisseur X"></label>
        <label>Priorité
          <select id="tc-f-priorite">${Object.entries(PRIORITES).map(([k, v]) => `<option value="${k}" ${data.priorite === k ? "selected" : ""}>${v}</option>`).join("")}</select>
        </label>
      </div>
      <label style="display:block;margin-top:10px">Description (optionnel)<textarea id="tc-f-description" rows="3" placeholder="Détails, contexte...">${esc(data.description || "")}</textarea></label>
      <div style="display:flex;gap:10px;margin-top:12px">
        <button class="add-btn" id="tc-f-save" data-id="${id}">💾 Enregistrer</button>
        <button class="nav-btn" id="tc-f-cancel">Annuler</button>
      </div>
      <div id="tc-f-status" style="font-size:12px;margin-top:8px"></div>
    </div>
  `;
}

function attacherEcouteursFormulaire() {
  document.getElementById("tc-f-cancel")?.addEventListener("click", () => { ui.addingOpen = false; ui.editingId = null; render(); });
  document.getElementById("tc-f-save")?.addEventListener("click", async () => {
    const statusEl = document.getElementById("tc-f-status");
    const titre = document.getElementById("tc-f-titre").value.trim();
    if (!titre) { statusEl.innerHTML = `<span style="color:var(--red)">Le titre est obligatoire.</span>`; return; }
    const patch = {
      titre,
      priorite: document.getElementById("tc-f-priorite").value,
      description: document.getElementById("tc-f-description").value.trim(),
    };
    const id = document.getElementById("tc-f-save").dataset.id;
    statusEl.innerHTML = `<span style="color:var(--text-dim)">⏳ Enregistrement…</span>`;
    try {
      if (id === "new") await creerTache({ ...nouvelleTache(), ...patch }, mountedUser);
      else await modifierTache(id, patch, mountedUser);
      ui.addingOpen = false; ui.editingId = null;
      window.toast("Tâche enregistrée.", "success");
      render();
    } catch (e) {
      statusEl.innerHTML = `<span style="color:var(--red)">❌ ${esc(e.message || String(e))}</span>`;
    }
  });
}

function attacherEcouteursCartes() {
  mountedContainer.querySelectorAll("[data-avancer]").forEach(btn => btn.addEventListener("click", async () => {
    const [id, etape] = btn.dataset.avancer.split(":");
    try { await changerEtape(id, etape, mountedUser); } catch (e) { window.toast("Erreur : " + (e.message || e), "error"); }
  }));
  mountedContainer.querySelectorAll("[data-tc-edit]").forEach(btn => btn.addEventListener("click", () => {
    ui.editingId = btn.dataset.tcEdit; ui.addingOpen = false; render();
  }));
  mountedContainer.querySelectorAll("[data-tc-del]").forEach(btn => btn.addEventListener("click", async () => {
    if (!(await window.confirmDialog("Supprimer définitivement cette tâche ?", { danger: true, texteValider: "Supprimer" }))) return;
    try { await supprimerTache(btn.dataset.tcDel); } catch (e) { window.toast("Erreur : " + (e.message || e), "error"); }
  }));
}

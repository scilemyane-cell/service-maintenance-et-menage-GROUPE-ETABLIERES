// stock-guest.js
// Écran minimal de mise à jour d'un article de stock déporté, accessible
// sans compte complet (connexion anonyme automatique, comme l'accès
// remplaçant). La sortie est quand même tracée : uid anonyme enregistré,
// affiché comme "Non identifié" partout où le nom ne peut pas être résolu.

import { esc } from "./astreinte-logic.js";
import {
  getArticleSiteAvecResidence, actualiserStockSite, enregistrerSortieSite,
} from "./stock-site-data.js";

export async function mountStockGuest(container, user, itemId) {
  container.innerHTML = `<div class="hint">Chargement…</div>`;
  const item = await getArticleSiteAvecResidence(itemId);
  if (!item) {
    container.innerHTML = `<div class="login-card"><p class="hint">Cet article est introuvable — il a peut-être été supprimé. Vérifie l'étiquette ou demande une nouvelle étiquette à jour.</p></div>`;
    return;
  }
  render(container, user, item, "sortie");
}

function render(container, user, item, mode) {
  container.innerHTML = `
    <div class="login-card" style="max-width:420px">
      <h1 style="margin:0 0 2px;font-size:20px">${esc(item.nom)}</h1>
      <p class="hint" style="margin:0 0 16px">${esc(item.siteNom)} · Stock actuel : <b>${item.quantite ?? 0} ${esc(item.unite || "")}</b></p>

      <div style="display:flex;gap:8px;margin-bottom:16px">
        <button class="nav-btn" id="sg-mode-sortie" style="flex:1;${mode === "sortie" ? "border-color:var(--gold)" : ""}">📤 Sortie de produit</button>
        <button class="nav-btn" id="sg-mode-actualiser" style="flex:1;${mode === "actualiser" ? "border-color:var(--gold)" : ""}">🔄 Actualiser le stock</button>
      </div>
      <div id="sg-form"></div>
      <div id="sg-status" style="font-size:12px;margin-top:10px"></div>
    </div>
  `;
  document.getElementById("sg-mode-sortie").addEventListener("click", () => render(container, user, item, "sortie"));
  document.getElementById("sg-mode-actualiser").addEventListener("click", () => render(container, user, item, "actualiser"));

  if (mode === "sortie") renderModeSortie(container, user, item);
  else renderModeActualiser(container, user, item);
}

function renderModeSortie(container, user, item) {
  const formEl = document.getElementById("sg-form");
  formEl.innerHTML = `
    <label>Quantité sortie<input type="number" min="1" step="1" id="sg-qte-sortie" value="1" style="font-size:18px;font-weight:700"></label>
    <label style="display:block;margin-top:10px">Logement concerné<input id="sg-logement" placeholder="ex. Appartement 12, Chambre 3…"></label>
    <button class="add-btn" id="sg-valider-sortie" style="margin-top:14px;width:100%">✓ Enregistrer la sortie</button>
  `;
  document.getElementById("sg-valider-sortie").addEventListener("click", async () => {
    const statusEl = document.getElementById("sg-status");
    const qte = parseFloat(document.getElementById("sg-qte-sortie").value);
    const logement = document.getElementById("sg-logement").value.trim();
    if (isNaN(qte) || qte <= 0) { statusEl.innerHTML = `<span style="color:var(--red)">Quantité invalide.</span>`; return; }
    if (!logement) { statusEl.innerHTML = `<span style="color:var(--red)">Le logement concerné est obligatoire.</span>`; return; }
    statusEl.innerHTML = `<span style="color:var(--text-dim)">⏳ Enregistrement…</span>`;
    try {
      await enregistrerSortieSite(item.id, qte, logement, user.uid);
      statusEl.innerHTML = `<span style="color:var(--gold)">✓ Sortie enregistrée. Tu peux fermer cette page.</span>`;
      document.getElementById("sg-valider-sortie").disabled = true;
    } catch (e) {
      statusEl.innerHTML = `<span style="color:var(--red)">❌ ${esc(e.message || String(e))}</span>`;
    }
  });
}

function renderModeActualiser(container, user, item) {
  const formEl = document.getElementById("sg-form");
  formEl.innerHTML = `
    <label>Quantité comptée<input type="number" min="0" step="1" id="sg-qte-actu" value="${item.quantite ?? 0}" style="font-size:18px;font-weight:700"></label>
    <button class="add-btn" id="sg-valider-actu" style="margin-top:14px;width:100%">✓ Valider le comptage</button>
  `;
  document.getElementById("sg-valider-actu").addEventListener("click", async () => {
    const statusEl = document.getElementById("sg-status");
    const qte = parseFloat(document.getElementById("sg-qte-actu").value);
    if (isNaN(qte) || qte < 0) { statusEl.innerHTML = `<span style="color:var(--red)">Quantité invalide.</span>`; return; }
    statusEl.innerHTML = `<span style="color:var(--text-dim)">⏳ Enregistrement…</span>`;
    try {
      await actualiserStockSite(item.id, qte, user.uid);
      statusEl.innerHTML = `<span style="color:var(--gold)">✓ Stock actualisé. Tu peux fermer cette page.</span>`;
      document.getElementById("sg-valider-actu").disabled = true;
    } catch (e) {
      statusEl.innerHTML = `<span style="color:var(--red)">❌ ${esc(e.message || String(e))}</span>`;
    }
  });
}

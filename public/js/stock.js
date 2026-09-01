import { esc } from "./astreinte-logic.js";
import { watchStockProduits, createProduit, saveProduit, deleteProduit, seedProduitsType } from "./stock-data.js";

let state = { produits: [] };
let ui = { filtre: "", categorie: "toutes", editId: null, qrId: null };
let unsubs = [];
let mountedContainer = null;

function cleanup() { unsubs.forEach(u => u()); unsubs = []; }

export function mountStockProduits(container) {
  cleanup();
  mountedContainer = container;
  ui = { filtre: "", categorie: "toutes", editId: null, qrId: null };
  container.innerHTML = `<div class="hint">Chargement…</div>`;
  unsubs.push(watchStockProduits((p) => { state.produits = p; render(); }));
}

function categories() {
  return [...new Set(state.produits.map(p => p.categorie).filter(Boolean))].sort();
}

function stockStatus(p) {
  if (p.stockActuel <= p.stockMin) return "danger";
  if (p.stockActuel <= p.stockMin * 1.5) return "warn";
  return "ok";
}

function render() {
  if (!mountedContainer) return;
  if (!document.contains(mountedContainer)) { cleanup(); return; }

  if (ui.qrId) { renderQr(state.produits.find(p => p.id === ui.qrId)); return; }
  if (ui.editId) { renderEditForm(ui.editId === "new" ? null : state.produits.find(p => p.id === ui.editId)); return; }

  const filtered = state.produits.filter(p =>
    (ui.categorie === "toutes" || p.categorie === ui.categorie) &&
    (ui.filtre.trim() === "" || (p.nom || "").toLowerCase().includes(ui.filtre.toLowerCase()))
  );

  mountedContainer.innerHTML = `
    <div class="stack">
      <p class="hint">Produits de maintenance en stock — définis un stock cible et un seuil minimum par produit ; l'onglet "Commandes" liste automatiquement ce qui repasse sous le seuil.</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="add-btn" id="sk-new">➕ Ajouter un produit</button>
        ${state.produits.length === 0 ? `<button class="nav-btn" id="sk-seed">📦 Charger la liste type (50 produits)</button>` : ""}
      </div>
      <div class="filters-row">
        <input id="sk-search" placeholder="Rechercher un produit…" value="${esc(ui.filtre)}" style="flex:1;min-width:160px">
        <select id="sk-cat"><option value="toutes">Toutes catégories</option>${categories().map(c => `<option value="${esc(c)}" ${ui.categorie === c ? 'selected' : ''}>${esc(c)}</option>`).join("")}</select>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Produit</th><th>Catégorie</th><th>Stock</th><th>Fournisseur</th><th></th></tr></thead>
          <tbody>
            ${filtered.length === 0 ? `<tr><td colspan="5" class="empty-row">Aucun produit.</td></tr>` :
              filtered.map(p => {
                const status = stockStatus(p);
                const color = status === "danger" ? "var(--red)" : status === "warn" ? "var(--gold)" : "var(--text)";
                return `
                <tr>
                  <td>${esc(p.nom)}</td>
                  <td style="font-size:12px;color:var(--text-dim)">${esc(p.categorie || "—")}</td>
                  <td style="color:${color};font-weight:700">${p.stockActuel ?? 0} / ${p.stockCible ?? 0} ${esc(p.unite || "")}${status === "danger" ? " ⚠️" : ""}</td>
                  <td style="font-size:12px">${esc(p.fournisseurNom || "—")}</td>
                  <td style="white-space:nowrap">
                    <button class="nav-btn" data-qr="${p.id}" style="padding:4px 8px;font-size:11px">🔳 QR</button>
                    <button class="nav-btn" data-edit="${p.id}" style="padding:4px 8px;font-size:11px">✏️</button>
                    <button class="del-btn" data-del="${p.id}" style="padding:4px 8px;font-size:11px">🗑️</button>
                  </td>
                </tr>
              `;}).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById("sk-new").addEventListener("click", () => { ui.editId = "new"; render(); });
  document.getElementById("sk-seed")?.addEventListener("click", async () => {
    if (!confirm("Charger les 50 produits type ? Tu pourras les modifier/supprimer ensuite.")) return;
    document.getElementById("sk-seed").textContent = "⏳ Chargement…";
    await seedProduitsType();
  });
  document.getElementById("sk-search").addEventListener("input", (e) => { ui.filtre = e.target.value; render(); });
  document.getElementById("sk-cat").addEventListener("change", (e) => { ui.categorie = e.target.value; render(); });
  mountedContainer.querySelectorAll("[data-qr]").forEach(btn => btn.addEventListener("click", () => { ui.qrId = btn.dataset.qr; render(); }));
  mountedContainer.querySelectorAll("[data-edit]").forEach(btn => btn.addEventListener("click", () => { ui.editId = btn.dataset.edit; render(); }));
  mountedContainer.querySelectorAll("[data-del]").forEach(btn => btn.addEventListener("click", async () => {
    const p = state.produits.find(x => x.id === btn.dataset.del);
    if (confirm(`Supprimer "${p.nom}" ?`)) await deleteProduit(p.id);
  }));
}

function renderEditForm(p) {
  const data = p ? { ...p } : { nom: "", categorie: "", unite: "pièce", stockCible: 10, stockMin: 3, stockActuel: 0, fournisseurNom: "", fournisseurEmail: "" };

  mountedContainer.innerHTML = `
    <div class="stack">
      <button class="nav-btn" id="sk-back">← Retour</button>
      <div class="form-card">
        <h3 style="margin:0 0 10px;font-size:14px;color:var(--gold)">${p ? "Modifier" : "Nouveau"} produit</h3>
        <div class="form-grid">
          <label>Nom<input id="sk-nom" value="${esc(data.nom)}"></label>
          <label>Catégorie<input id="sk-categorie" value="${esc(data.categorie)}" placeholder="ex. Robinetterie"></label>
          <label>Unité<input id="sk-unite" value="${esc(data.unite)}" placeholder="pièce, lot, boîte…"></label>
          <label>Stock actuel<input id="sk-actuel" type="number" min="0" value="${data.stockActuel ?? 0}"></label>
          <label>Stock cible (niveau normal)<input id="sk-cible" type="number" min="0" value="${data.stockCible ?? 0}"></label>
          <label>Seuil minimum (déclenche la commande)<input id="sk-min" type="number" min="0" value="${data.stockMin ?? 0}"></label>
          <label>Fournisseur<input id="sk-fournisseur-nom" value="${esc(data.fournisseurNom || '')}" placeholder="ex. Cedeo, Rexel…"></label>
          <label>Email fournisseur<input id="sk-fournisseur-email" type="email" value="${esc(data.fournisseurEmail || '')}" placeholder="commandes@fournisseur.fr"></label>
        </div>
        <button class="add-btn" id="sk-save">💾 Enregistrer</button>
        <span id="sk-status" style="font-size:12px;margin-left:8px"></span>
      </div>
    </div>
  `;

  document.getElementById("sk-back").addEventListener("click", () => { ui.editId = null; render(); });
  document.getElementById("sk-save").addEventListener("click", async () => {
    const statusEl = document.getElementById("sk-status");
    const payload = {
      nom: document.getElementById("sk-nom").value.trim(),
      categorie: document.getElementById("sk-categorie").value.trim(),
      unite: document.getElementById("sk-unite").value.trim() || "pièce",
      stockActuel: parseInt(document.getElementById("sk-actuel").value, 10) || 0,
      stockCible: parseInt(document.getElementById("sk-cible").value, 10) || 0,
      stockMin: parseInt(document.getElementById("sk-min").value, 10) || 0,
      fournisseurNom: document.getElementById("sk-fournisseur-nom").value.trim(),
      fournisseurEmail: document.getElementById("sk-fournisseur-email").value.trim(),
    };
    if (!payload.nom) { statusEl.innerHTML = `<span style="color:var(--red)">Le nom est obligatoire.</span>`; return; }
    statusEl.innerHTML = `<span style="color:var(--text-dim)">⏳ Enregistrement…</span>`;
    try {
      if (p) await saveProduit(p.id, payload); else await createProduit(payload);
      ui.editId = null; render();
    } catch (e) {
      statusEl.innerHTML = `<span style="color:var(--red)">❌ ${esc(e.message || String(e))}</span>`;
    }
  });
}

// Encodage du QR : un simple préfixe + id produit, lu par l'onglet
// Inventaire pour ouvrir directement la fiche du bon produit.
export function qrPayloadFor(produitId) { return `ETAB-STOCK:${produitId}`; }

function renderQr(p) {
  if (!p) { ui.qrId = null; render(); return; }
  mountedContainer.innerHTML = `
    <div class="stack">
      <button class="nav-btn" id="sk-back">← Retour</button>
      <div class="form-card" style="text-align:center;max-width:320px" id="sk-qr-print">
        <p style="font-weight:700;margin:0 0 4px">${esc(p.nom)}</p>
        <p class="hint" style="margin:0 0 12px">${esc(p.categorie || "")}</p>
        <div id="sk-qr-canvas" style="width:220px;height:220px;margin:0 auto"></div>
      </div>
      <button class="add-btn" id="sk-print" style="width:fit-content">🖨️ Imprimer l'étiquette</button>
    </div>
  `;
  document.getElementById("sk-back").addEventListener("click", () => { ui.qrId = null; render(); });
  document.getElementById("sk-print").addEventListener("click", () => window.print());

  const holder = document.getElementById("sk-qr-canvas");
  if (window.QRCode) {
    new window.QRCode(holder, {
      text: qrPayloadFor(p.id),
      width: 220,
      height: 220,
      correctLevel: window.QRCode.CorrectLevel.M,
    });
  } else {
    holder.textContent = "Librairie QR non chargée (vérifier app.html).";
  }
}

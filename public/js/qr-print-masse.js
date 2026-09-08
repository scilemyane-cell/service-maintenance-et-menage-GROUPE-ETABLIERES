// qr-print-masse.js
// Impression en masse de QR codes — produits (petites étiquettes) ou
// dossiers de site (grandes fiches) — sur une seule feuille imprimable,
// plutôt qu'un par un comme le permettaient déjà les écrans individuels.
// Réutilise le module centralisé qr-logo.js (même logo incrusté, même
// niveau de correction d'erreur) pour un rendu identique.

import { esc } from "./astreinte-logic.js";
import { renderQrWithLogo } from "./qr-logo.js";
import { watchStockProduits } from "./stock-data.js";
import { qrPayloadFor } from "./stock.js";
import { watchSitesDossiers } from "./site-dossier-data.js";

let mountedContainer = null;
let state = { type: "produits", produits: [], sites: [], selection: new Set() };
let unsubs = [];

export async function mountQrMasse(container) {
  mountedContainer = container;
  state = { type: "produits", produits: [], sites: [], selection: new Set() };
  unsubs.forEach(u => u());
  unsubs = [
    watchStockProduits((list) => { state.produits = list; if (state.type === "produits") render(); }),
    watchSitesDossiers((list) => { state.sites = list; if (state.type === "sites") render(); }),
  ];
  render();
}

function itemsActuels() {
  return state.type === "produits" ? state.produits : state.sites;
}

function payloadPour(item) {
  return state.type === "produits"
    ? qrPayloadFor(item.id)
    : `https://service-maintenance-et-menage.web.app/dossier-pdf-guest.html?dossier=${item.id}`;
}

function render() {
  if (!mountedContainer || !document.contains(mountedContainer)) return;
  const items = itemsActuels();

  mountedContainer.innerHTML = `
    <div class="stack">
      <p class="hint">Sélectionne les éléments à imprimer, puis génère la feuille — chaque QR inclut déjà le logo Établières, comme à l'impression individuelle.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="nav-btn" id="qm-type-produits" style="${state.type === 'produits' ? 'border-color:var(--gold);color:var(--gold)' : ''}">📦 Produits (petites étiquettes)</button>
        <button class="nav-btn" id="qm-type-sites" style="${state.type === 'sites' ? 'border-color:var(--gold);color:var(--gold)' : ''}">🏢 Dossiers de site (fiches)</button>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <button class="nav-btn" id="qm-tout">Tout sélectionner</button>
        <button class="nav-btn" id="qm-aucun">Tout désélectionner</button>
        <span class="hint">${state.selection.size} sur ${items.length} sélectionné(s)</span>
      </div>
      <div style="max-height:420px;overflow:auto;border:1px solid var(--border);border-radius:8px;padding:10px">
        ${items.length === 0 ? `<p class="hint">Aucun élément pour l'instant.</p>` : items.map(it => `
          <label style="display:flex;align-items:center;gap:8px;padding:5px 0;cursor:pointer">
            <input type="checkbox" data-qm-item="${it.id}" ${state.selection.has(it.id) ? "checked" : ""} style="width:16px;height:16px;accent-color:var(--gold)">
            <span>${esc(it.nom)}${it.categorie ? ` <span class="hint">(${esc(it.categorie)})</span>` : ""}</span>
          </label>
        `).join("")}
      </div>
      <button class="add-btn" id="qm-generer" ${state.selection.size === 0 ? 'disabled style="opacity:.4"' : ''} style="width:fit-content">🖨️ Générer et imprimer (${state.selection.size})</button>
      <div id="qm-status" style="font-size:12px"></div>
    </div>
  `;

  document.getElementById("qm-type-produits").addEventListener("click", () => { state.type = "produits"; state.selection = new Set(); render(); });
  document.getElementById("qm-type-sites").addEventListener("click", () => { state.type = "sites"; state.selection = new Set(); render(); });
  document.getElementById("qm-tout").addEventListener("click", () => { itemsActuels().forEach(it => state.selection.add(it.id)); render(); });
  document.getElementById("qm-aucun").addEventListener("click", () => { state.selection.clear(); render(); });
  mountedContainer.querySelectorAll("[data-qm-item]").forEach(cb => cb.addEventListener("change", () => {
    if (cb.checked) state.selection.add(cb.dataset.qmItem); else state.selection.delete(cb.dataset.qmItem);
    render();
  }));
  document.getElementById("qm-generer")?.addEventListener("click", genererEtImprimer);
}

// Génère une feuille imprimable (grille de QR) puis déclenche
// l'impression — réutilise le mécanisme générique .print-fiche déjà en
// place dans l'appli (masque automatiquement le reste de la page).
async function genererEtImprimer() {
  const statusEl = document.getElementById("qm-status");
  const items = itemsActuels().filter(it => state.selection.has(it.id));
  if (items.length === 0) return;
  statusEl.innerHTML = `<span style="color:var(--text-dim)">⏳ Génération de ${items.length} QR code(s)…</span>`;

  const estPetit = state.type === "produits";
  const colonnes = estPetit ? 4 : 2;
  const taille = estPetit ? 110 : 190;

  const html = `
    <div class="print-fiche" style="background:#fff;padding:20px;color:#111">
      <h2 style="margin:0 0 4px">${estPetit ? "Étiquettes QR — Produits" : "Fiches QR — Dossiers de site"}</h2>
      <p style="margin:0 0 16px;font-size:11px;color:#666">Groupe Établières · Exporté le ${new Date().toLocaleDateString("fr-FR")}</p>
      <div style="display:grid;grid-template-columns:repeat(${colonnes},1fr);gap:${estPetit ? "10px" : "18px"}">
        ${items.map((it, i) => `
          <div style="text-align:center;border:1px solid #ccc;border-radius:8px;padding:${estPetit ? "8px" : "16px"};page-break-inside:avoid;break-inside:avoid">
            <div id="qm-qr-${i}" style="width:${taille}px;height:${taille}px;margin:0 auto"></div>
            <p style="margin:6px 0 0;font-size:${estPetit ? 10 : 13}px;font-weight:700;line-height:1.2">${esc(it.nom)}</p>
          </div>
        `).join("")}
      </div>
    </div>
  `;

  const printRoot = document.createElement("div");
  printRoot.id = "qm-print-root";
  printRoot.className = "print-only";
  printRoot.innerHTML = html;
  document.body.appendChild(printRoot);

  // Les QR se dessinent dans des <canvas> créés dynamiquement par
  // qrcodejs — il faut attendre que chacun soit prêt avant d'imprimer,
  // sinon certaines cases resteraient vides sur le papier.
  await Promise.all(items.map((it, i) => renderQrWithLogo(document.getElementById(`qm-qr-${i}`), payloadPour(it), taille)));

  statusEl.innerHTML = "";
  window.print();
  setTimeout(() => printRoot.remove(), 1000);
}

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
import { listerTousLesArticlesSite, listerSitesAvecStockDeporte, qrPayloadForSite } from "./stock-site-data.js";

let mountedContainer = null;
let state = { type: "produits", produits: [], sites: [], articlesSite: [], selection: new Set() };
let unsubs = [];

export async function mountQrMasse(container) {
  mountedContainer = container;
  state = { type: "produits", produits: [], sites: [], articlesSite: [], selection: new Set() };
  unsubs.forEach(u => u());
  unsubs = [
    watchStockProduits((list) => { state.produits = list; if (state.type === "produits") render(); }),
    watchSitesDossiers((list) => { state.sites = list; if (state.type === "sites") render(); }),
  ];
  // Stock déporté : lecture ponctuelle (pas de flux temps réel exposé),
  // recroisée avec le nom des sites pour l'affichage et l'étiquetage.
  const [articles, sitesDeportes] = await Promise.all([listerTousLesArticlesSite(), listerSitesAvecStockDeporte()]);
  const nomParSite = new Map(sitesDeportes.map(s => [s.id, s.nom]));
  state.articlesSite = articles.map(a => ({ ...a, nomSite: nomParSite.get(a.dossierId) || "Site inconnu" }));
  render();
}

function itemsActuels() {
  if (state.type === "produits") return state.produits;
  if (state.type === "sites") return state.sites;
  return state.articlesSite;
}

function payloadPour(item) {
  if (state.type === "produits") return qrPayloadFor(item.id);
  if (state.type === "sites") return `https://service-maintenance-et-menage.web.app/dossier-pdf-guest.html?dossier=${item.id}`;
  return qrPayloadForSite(item.id);
}

// Libellé affiché sous le QR — pour le stock déporté, le nom du site est
// indispensable (le même produit peut exister sur plusieurs sites, sinon
// impossible de distinguer les étiquettes une fois imprimées).
function libellePour(item) {
  return state.type === "articlesSite" && item.nomSite ? `${item.nom} — ${item.nomSite}` : item.nom;
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
        <button class="nav-btn" id="qm-type-articlesSite" style="${state.type === 'articlesSite' ? 'border-color:var(--gold);color:var(--gold)' : ''}">📤 Stock déporté (petites étiquettes)</button>
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
            <span>${esc(libellePour(it))}${it.categorie ? ` <span class="hint">(${esc(it.categorie)})</span>` : ""}</span>
          </label>
        `).join("")}
      </div>
      <button class="add-btn" id="qm-generer" ${state.selection.size === 0 ? 'disabled style="opacity:.4"' : ''} style="width:fit-content">🖨️ Générer et imprimer (${state.selection.size})</button>
      <div id="qm-status" style="font-size:12px"></div>
    </div>
  `;

  document.getElementById("qm-type-produits").addEventListener("click", () => { state.type = "produits"; state.selection = new Set(); render(); });
  document.getElementById("qm-type-sites").addEventListener("click", () => { state.type = "sites"; state.selection = new Set(); render(); });
  document.getElementById("qm-type-articlesSite").addEventListener("click", () => { state.type = "articlesSite"; state.selection = new Set(); render(); });
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

  const estPetit = state.type === "produits" || state.type === "articlesSite";
  const colonnes = estPetit ? 4 : 2;
  const taille = estPetit ? 110 : 190; // taille d'affichage/impression (physique, en px CSS)
  const resolutionInterne = estPetit ? 320 : 420; // résolution réelle du QR dessiné, toujours plus fine que la taille affichée pour un rendu net à l'impression (l'agrandissement d'un QR trop petit à la source est ce qui le rendait flou/brouillé)

  const titreFeuille = { produits: "Étiquettes QR — Produits", sites: "Fiches QR — Dossiers de site", articlesSite: "Étiquettes QR — Stock déporté" }[state.type];

  const html = `
    <div class="print-fiche" style="background:#fff;padding:20px;color:#111">
      <h2 style="margin:0 0 4px">${titreFeuille}</h2>
      <p style="margin:0 0 16px;font-size:11px;color:#666">Groupe Établières · Exporté le ${new Date().toLocaleDateString("fr-FR")}</p>
      <div style="display:grid;grid-template-columns:repeat(${colonnes},1fr);gap:${estPetit ? "10px" : "18px"}">
        ${items.map((it, i) => `
          <div style="text-align:center;border:1px solid #ccc;border-radius:8px;padding:${estPetit ? "8px" : "16px"};page-break-inside:avoid;break-inside:avoid">
            <div id="qm-qr-${i}" style="width:${taille}px;height:${taille}px;margin:0 auto;overflow:hidden"></div>
            <p style="margin:6px 0 0;font-size:${estPetit ? 10 : 13}px;font-weight:700;line-height:1.2">${esc(libellePour(it))}</p>
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
  // sinon certaines cases resteraient vides sur le papier. Rendu à
  // resolutionInterne (plus fin que la taille affichée) puis mis à
  // l'échelle en CSS pour un résultat net plutôt que pixelisé/brouillé.
  // Pas de logo sur les petites étiquettes : à cette taille il devient
  // minuscule et flou, et mange une portion d'un QR déjà dense (URL
  // longue) — mieux vaut un QR propre sans logo qu'illisible avec.
  await Promise.all(items.map(async (it, i) => {
    const holder = document.getElementById(`qm-qr-${i}`);
    await renderQrWithLogo(holder, payloadPour(it), resolutionInterne, estPetit);
    const canvas = holder.querySelector("canvas");
    if (canvas) { canvas.style.width = "100%"; canvas.style.height = "100%"; }
  }));

  statusEl.innerHTML = "";
  window.print();
  setTimeout(() => printRoot.remove(), 1000);
}

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
import { watchProduits as watchProduitsMenage, ZONES as ZONES_MENAGE } from "./stock-menage-data.js";
import { qrPayloadFor as qrPayloadForMenage } from "./stock-menage.js";

let mountedContainer = null;
let state = { type: "produits", produits: [], sites: [], articlesSite: [], produitsMenage: [], selection: new Set(), siteFiltre: "toutes" };
let unsubs = [];

export async function mountQrMasse(container) {
  mountedContainer = container;
  state = { type: "produits", produits: [], sites: [], articlesSite: [], produitsMenage: [], selection: new Set(), siteFiltre: "toutes" };
  unsubs.forEach(u => u());
  unsubs = [
    watchStockProduits((list) => { state.produits = list; if (state.type === "produits") render(); }),
    watchSitesDossiers((list) => { state.sites = list; if (state.type === "sites") render(); }),
    watchProduitsMenage((list) => { state.produitsMenage = list; if (state.type === "menage") render(); }),
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
  if (state.type === "menage") return state.produitsMenage;
  return state.articlesSite;
}

// Sites distincts présents dans le stock déporté — pour peupler le filtre.
function sitesDisponibles() {
  const parId = new Map();
  state.articlesSite.forEach(a => { if (a.dossierId && !parId.has(a.dossierId)) parId.set(a.dossierId, a.nomSite || "Site inconnu"); });
  return [...parId.entries()].sort((a, b) => a[1].localeCompare(b[1]));
}

// Éléments réellement affichés/sélectionnables à l'écran — c'est-à-dire
// itemsActuels() après application du filtre par site (uniquement
// pertinent pour le stock déporté, où le même produit existe sur
// plusieurs sites).
function itemsAffiches() {
  const items = itemsActuels();
  if (state.type === "articlesSite" && state.siteFiltre !== "toutes") {
    return items.filter(it => it.dossierId === state.siteFiltre);
  }
  return items;
}

function payloadPour(item) {
  if (state.type === "produits") return qrPayloadFor(item.id);
  if (state.type === "sites") return `https://service-maintenance-et-menage.web.app/dossier-pdf-guest.html?dossier=${item.id}`;
  if (state.type === "menage") return qrPayloadForMenage(item.id);
  return qrPayloadForSite(item.id);
}

// Libellé affiché sous le QR — pour le stock déporté, le nom du site est
// indispensable (le même produit peut exister sur plusieurs sites, sinon
// impossible de distinguer les étiquettes une fois imprimées). Pour le
// stock ménage, la zone (École/Agropolis) évite la même ambiguïté.
function libellePour(item) {
  if (state.type === "articlesSite" && item.nomSite) return `${item.nom} — ${item.nomSite}`;
  if (state.type === "menage" && item.zone) return `${item.nom} — ${ZONES_MENAGE[item.zone] || item.zone}`;
  return item.nom;
}

function render() {
  if (!mountedContainer || !document.contains(mountedContainer)) return;
  const items = itemsAffiches();

  mountedContainer.innerHTML = `
    <div class="stack">
      <p class="hint">Sélectionne les éléments à imprimer, puis génère la feuille — chaque QR inclut déjà le logo Établières, comme à l'impression individuelle.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="nav-btn" id="qm-type-produits" style="${state.type === 'produits' ? 'border-color:var(--gold);color:var(--gold)' : ''}">📦 Produits (petites étiquettes)</button>
        <button class="nav-btn" id="qm-type-sites" style="${state.type === 'sites' ? 'border-color:var(--gold);color:var(--gold)' : ''}">🏢 Dossiers de site (fiches)</button>
        <button class="nav-btn" id="qm-type-articlesSite" style="${state.type === 'articlesSite' ? 'border-color:var(--gold);color:var(--gold)' : ''}">📤 Stock déporté (petites étiquettes)</button>
        <button class="nav-btn" id="qm-type-menage" style="${state.type === 'menage' ? 'border-color:var(--gold);color:var(--gold)' : ''}">🧻 Stock Ménage (petites étiquettes)</button>
      </div>
      ${state.type === "articlesSite" ? `
        <div>
          <label style="font-size:12px;color:var(--text-dim)">Filtrer par site
            <select id="qm-site-filtre" style="display:block;margin-top:4px;max-width:280px">
              <option value="toutes" ${state.siteFiltre === "toutes" ? "selected" : ""}>Tous les sites (${state.articlesSite.length})</option>
              ${sitesDisponibles().map(([id, nom]) => `<option value="${esc(id)}" ${state.siteFiltre === id ? "selected" : ""}>${esc(nom)} (${state.articlesSite.filter(a => a.dossierId === id).length})</option>`).join("")}
            </select>
          </label>
        </div>
      ` : ""}
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <button class="nav-btn" id="qm-tout">Tout sélectionner</button>
        <button class="nav-btn" id="qm-aucun">Tout désélectionner</button>
        <span class="hint">${items.filter(it => state.selection.has(it.id)).length} sur ${items.length} sélectionné(s)</span>
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

  document.getElementById("qm-type-produits").addEventListener("click", () => { state.type = "produits"; state.selection = new Set(); state.siteFiltre = "toutes"; render(); });
  document.getElementById("qm-type-sites").addEventListener("click", () => { state.type = "sites"; state.selection = new Set(); state.siteFiltre = "toutes"; render(); });
  document.getElementById("qm-type-articlesSite").addEventListener("click", () => { state.type = "articlesSite"; state.selection = new Set(); state.siteFiltre = "toutes"; render(); });
  document.getElementById("qm-type-menage").addEventListener("click", () => { state.type = "menage"; state.selection = new Set(); state.siteFiltre = "toutes"; render(); });
  document.getElementById("qm-site-filtre")?.addEventListener("change", (e) => { state.siteFiltre = e.target.value; render(); });
  document.getElementById("qm-tout").addEventListener("click", () => { items.forEach(it => state.selection.add(it.id)); render(); });
  document.getElementById("qm-aucun").addEventListener("click", () => { items.forEach(it => state.selection.delete(it.id)); render(); });
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

  const estPetit = state.type === "produits" || state.type === "articlesSite" || state.type === "menage";
  const colonnes = estPetit ? 3 : 2;
  const taille = estPetit ? 150 : 190; // le rendu SVG est net à n'importe quelle taille, plus besoin de sur-dimensionner en interne avant de réduire

  const titreFeuille = { produits: "Étiquettes QR — Produits", sites: "Fiches QR — Dossiers de site", articlesSite: "Étiquettes QR — Stock déporté", menage: "Étiquettes QR — Stock Ménage" }[state.type];

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

  // Les QR se dessinent en SVG (vectoriel, net à n'importe quelle taille)
  // — il faut attendre que chacun soit prêt avant d'imprimer, sinon
  // certaines cases resteraient vides sur le papier.
  await Promise.all(items.map((it, i) => renderQrWithLogo(document.getElementById(`qm-qr-${i}`), payloadPour(it), taille)));

  statusEl.innerHTML = "";
  window.print();
  setTimeout(() => printRoot.remove(), 1000);
}

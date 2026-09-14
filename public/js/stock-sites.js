// stock-sites.js
// Vue centralisée et unique du stock déporté (onglet "Sites" du module
// Stock maintenance) : tous les sites ayant le stock déporté activé, avec
// leurs articles, quantités, seuils, QR codes et sorties de produit. Toute
// la gestion se fait ici — la fiche "Dossier de site" ne fait plus que
// porter la case "a un stock déporté".

import { esc } from "./astreinte-logic.js";
import { renderQrWithLogo, printQrCard } from "./qr-logo.js";
import { dessinerFluxSVG } from "./flux-svg.js";
import { renderUniteField, attacherUniteField } from "./unites-stock.js";
import {
  listerSitesAvecStockDeporte, listerTousLesArticlesSite,
  ajouterArticleSite, modifierArticleSite, supprimerArticleSite,
  configurerArticlesSiteDepuisCatalogue, listerCatalogueSite, listerCatalogueCentral,
  qrPayloadForSite, getArticleSiteAvecResidence, actualiserStockSite, enregistrerSortieSite,
  listerMouvementsSite, supprimerMouvementSite,
} from "./stock-site-data.js";

let mountedContainer = null;
let mountedUser = null;
let state = { sites: [], items: [], catalogueSite: null, catalogueCentral: null };
let ui = { screen: "liste", qrId: null, ajusteId: null, addingSiteId: null, addingMode: null, ouverts: new Set(), rapideSiteId: null, rapideIndex: 0, qrRapideOuvert: null, fluxSiteId: null, jaugesSiteId: null, historiqueSiteId: null };

export async function mountStockSites(container, user) {
  mountedContainer = container;
  mountedUser = user;
  state = { sites: [], items: [], catalogueSite: null, catalogueCentral: null };
  ui = { screen: "liste", qrId: null, ajusteId: null, addingSiteId: null, addingMode: null, ouverts: new Set(), rapideSiteId: null, rapideIndex: 0, qrRapideOuvert: null, fluxSiteId: null, jaugesSiteId: null, historiqueSiteId: null };
  container.innerHTML = `<div class="hint">Chargement…</div>`;
  await load();

  // Lien direct depuis un QR scanné hors appli (voir app.html, ?stocksite=)
  if (window.stockSiteDeepLinkId) {
    const id = window.stockSiteDeepLinkId;
    window.stockSiteDeepLinkId = null;
    ui.screen = "ajuste";
    ui.ajusteId = id;
    render();
  }
  // Lien direct vers le mode rapide d'un site (QR unique par résidence,
  // imprimé une fois) — voir app.html, paramètre ?stocksiterapide=
  if (window.stockSiteRapideDeepLinkId) {
    const id = window.stockSiteRapideDeepLinkId;
    window.stockSiteRapideDeepLinkId = null;
    ui.rapideSiteId = id;
    ui.rapideIndex = 0;
    render();
  }
}

async function load() {
  const [sites, items] = await Promise.all([
    listerSitesAvecStockDeporte(),
    listerTousLesArticlesSite(),
  ]);
  state.sites = sites;
  state.items = items;
  if (ui.screen === "liste") render();
}

function render() {
  if (!mountedContainer) return;
  if (!document.contains(mountedContainer)) { return; }

  if (ui.screen === "qr") return renderQr();
  if (ui.screen === "ajuste") return renderAjuste();
  if (ui.screen === "scan") return renderScan();
  if (ui.screen === "flux") return renderFlux();
  if (ui.screen === "jauges") return renderJauges();
  if (ui.screen === "historique") return renderHistorique();
  if (ui.rapideSiteId) return renderRapide();
  renderListe();
}

// =================================================================
// Liste
// =================================================================
function renderListe() {
  const alertesTotal = state.items.filter(it => (it.quantite ?? 0) < (it.quantiteCible ?? 0)).length;
  // Les sites ayant au moins une alerte remontent en haut de la liste,
  // pour les repérer immédiatement sans avoir à parcourir toute la liste.
  const sitesTries = [...state.sites].sort((a, b) => {
    const alertesA = state.items.filter(it => it.dossierId === a.id && (it.quantite ?? 0) < (it.quantiteCible ?? 0)).length;
    const alertesB = state.items.filter(it => it.dossierId === b.id && (it.quantite ?? 0) < (it.quantiteCible ?? 0)).length;
    return alertesB - alertesA;
  });

  mountedContainer.innerHTML = `
    <div class="stack">
      <p class="hint">Stock gardé localement sur chaque site (indépendant du stock central), activable depuis la fiche d'un dossier de site ("📦 Ce site a un stock déporté").</p>
      <button class="add-btn" id="ssx-scan" style="width:fit-content">📷 Scanner un article</button>
      ${alertesTotal > 0 ? `<div class="stat-chip warn" style="width:fit-content">⚠️ ${alertesTotal} article(s) sous leur seuil, tous sites confondus</div>` : ""}

      ${state.sites.length === 0 ? `
        <p class="hint">Aucun site n'a le stock déporté activé pour l'instant. Coche "Ce site a un stock déporté" depuis la fiche d'un dossier de site (Dossiers de site) pour qu'il apparaisse ici.</p>
      ` : sitesTries.map(site => {
        const items = state.items.filter(it => it.dossierId === site.id);
        const itemsManquants = items.filter(it => (it.quantite ?? 0) < (it.quantiteCible ?? 0));
        const alertesSite = itemsManquants.length;
        const ouvert = ui.ouverts.has(site.id);
        return `
        <div class="form-card" style="padding:0;overflow:visible">
          <div style="width:100%;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 16px">
            <button data-toggle-site="${site.id}" style="flex:1;display:flex;align-items:center;gap:10px;background:none;border:none;cursor:pointer;text-align:left;padding:0;min-width:0">
              <span style="font-size:14px;color:var(--gold);font-weight:700">🏢 ${esc(site.nom)}</span>
            </button>
            <span style="display:flex;align-items:center;gap:10px">
              ${alertesSite > 0 ? `
                <span class="ssx-badge-tip" tabindex="0">
                  <span style="background:var(--red);color:#fff;border-radius:999px;padding:3px 11px;font-size:12px;font-weight:800;cursor:default">⚠️ ${alertesSite} à réapprovisionner</span>
                  <div class="ssx-tip-content">
                    <p style="margin:0 0 6px;font-size:11px;color:var(--text-dim);font-weight:700">Manque sur ${esc(site.nom)} :</p>
                    <ul>
                      ${itemsManquants.map(it => `<li><span>${esc(it.nom)}</span><b>${it.quantite ?? 0} / ${it.quantiteCible ?? 0} ${esc(it.unite || "")}</b></li>`).join("")}
                    </ul>
                  </div>
                </span>
              ` : `<span style="font-size:11px;color:var(--text-dim)">${items.length} article(s)</span>`}
              <button data-toggle-site="${site.id}" style="background:none;border:none;cursor:pointer;font-size:12px;color:var(--text-dim);padding:0">${ouvert ? "▲" : "▼"}</button>
            </span>
          </div>
          ${ouvert ? `
          <div style="padding:0 16px 16px">
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
              <button class="nav-btn" data-rapide-site="${site.id}">🚀 Mode rapide</button>
              <button class="nav-btn" data-qr-rapide-site="${site.id}">🔳 QR inventaire rapide</button>
              <button class="nav-btn" data-flux-site="${site.id}" style="border-color:var(--teal);color:var(--teal)">🌊 Flux des sorties</button>
              <button class="nav-btn" data-jauges-site="${site.id}" style="border-color:var(--gold);color:var(--gold)">📊 Jauges des sorties</button>
              <button class="nav-btn" data-historique-site="${site.id}">🗂️ Historique des sorties</button>
            </div>
            <div id="ssx-qr-rapide-holder-${site.id}" class="qr-print-card" style="display:none;background:#fff;border-radius:10px;padding:16px;text-align:center;max-width:260px;margin-bottom:12px">
              <div id="ssx-qr-rapide-canvas-${site.id}" style="width:200px;height:200px;margin:0 auto"></div>
              <p style="color:#111;font-size:11px;margin:8px 0 0">À imprimer et coller une seule fois sur ce site — scanné avec l'appareil photo du téléphone, ouvre directement la mise à jour du stock de <b>${esc(site.nom)}</b>, sans compte ni code à saisir.</p>
              <button class="nav-btn" data-qr-rapide-print="${site.id}" style="margin-top:10px">🖨️ Imprimer</button>
            </div>
            ${items.length === 0 ? `<p class="hint">Aucun article pour l'instant sur ce site.</p>` : `
              <div class="table-wrap" style="border:none">
                <table>
                  <thead><tr><th>Article</th><th>Origine</th><th>Quantité</th><th>Cible perm.</th><th></th></tr></thead>
                  <tbody>
                    ${items.map(it => `
                      <tr>
                        <td>${esc(it.nom)}</td>
                        <td style="font-size:11px;color:var(--text-dim)">${it.catalogueOrigine === "central" ? "Catalogue central" : it.produitId ? "Liste type sites" : "Propre au site"}</td>
                        <td><input type="number" min="0" step="1" value="${it.quantite ?? 0}" data-qte="${it.id}" style="width:70px;${(it.quantite ?? 0) < (it.quantiteCible ?? 0) ? 'color:var(--red);font-weight:700' : ''}"> ${esc(it.unite || "")}</td>
                        <td><input type="number" min="0" step="1" value="${it.quantiteCible ?? 0}" data-cible="${it.id}" style="width:70px"></td>
                        <td style="white-space:nowrap">
                          <button class="nav-btn" data-qr="${it.id}" style="padding:4px 8px;font-size:11px">🔳 QR</button>
                          <button class="nav-btn" data-ajuste="${it.id}" style="padding:4px 8px;font-size:11px">📤 Sortie/Ajuster</button>
                          <button class="del-btn" data-del="${it.id}" style="padding:4px 8px;font-size:11px">🗑️</button>
                        </td>
                      </tr>
                    `).join("")}
                  </tbody>
                </table>
              </div>
            `}
            <div id="ssx-add-zone-${site.id}" style="margin-top:10px">
              ${ui.addingSiteId === site.id ? renderAddForm(site) : `
                <div style="display:flex;gap:8px;flex-wrap:wrap">
                  <button class="nav-btn" data-open-config="${site.id}">🗂️ Configurer depuis la liste type</button>
                  <button class="nav-btn" data-open-catalogue="${site.id}">➕ Depuis le catalogue central</button>
                  <button class="nav-btn" data-open-libre="${site.id}">➕ Article propre à ce site</button>
                </div>
              `}
            </div>
            <div id="ssx-status-${site.id}" style="font-size:12px;margin-top:8px"></div>
          </div>
          ` : ""}
        </div>
      `;}).join("")}
    </div>
  `;

  document.getElementById("ssx-scan").addEventListener("click", () => { ui.screen = "scan"; render(); });
  mountedContainer.querySelectorAll("[data-toggle-site]").forEach(btn => btn.addEventListener("click", () => {
    const id = btn.dataset.toggleSite;
    if (ui.ouverts.has(id)) ui.ouverts.delete(id); else ui.ouverts.add(id);
    render();
  }));
  mountedContainer.querySelectorAll("[data-rapide-site]").forEach(btn => btn.addEventListener("click", () => {
    ui.rapideSiteId = btn.dataset.rapideSite; ui.rapideIndex = 0; render();
  }));
  mountedContainer.querySelectorAll("[data-flux-site]").forEach(btn => btn.addEventListener("click", () => {
    ui.screen = "flux"; ui.fluxSiteId = btn.dataset.fluxSite; render();
  }));
  mountedContainer.querySelectorAll("[data-jauges-site]").forEach(btn => btn.addEventListener("click", () => {
    ui.screen = "jauges"; ui.jaugesSiteId = btn.dataset.jaugesSite; render();
  }));
  mountedContainer.querySelectorAll("[data-historique-site]").forEach(btn => btn.addEventListener("click", () => {
    ui.screen = "historique"; ui.historiqueSiteId = btn.dataset.historiqueSite; render();
  }));
  mountedContainer.querySelectorAll("[data-qr-rapide-site]").forEach(btn => btn.addEventListener("click", () => {
    const id = btn.dataset.qrRapideSite;
    const holder = document.getElementById(`ssx-qr-rapide-holder-${id}`);
    const canvas = document.getElementById(`ssx-qr-rapide-canvas-${id}`);
    if (holder.style.display === "none") {
      holder.style.display = "block";
      renderQrWithLogo(canvas, `https://service-maintenance-et-menage.web.app/stock-site-guest.html?site=${id}`, 200);
    } else {
      holder.style.display = "none";
    }
  }));
  mountedContainer.querySelectorAll("[data-qr-rapide-print]").forEach(btn => btn.addEventListener("click", () => {
    printQrCard(document.getElementById(`ssx-qr-rapide-holder-${btn.dataset.qrRapidePrint}`));
  }));
  mountedContainer.querySelectorAll("[data-qr]").forEach(btn => btn.addEventListener("click", () => { ui.screen = "qr"; ui.qrId = btn.dataset.qr; render(); }));
  mountedContainer.querySelectorAll("[data-ajuste]").forEach(btn => btn.addEventListener("click", () => { ui.screen = "ajuste"; ui.ajusteId = btn.dataset.ajuste; render(); }));
  mountedContainer.querySelectorAll("[data-qte]").forEach(inp => {
    inp.addEventListener("change", async () => {
      const val = parseFloat(inp.value);
      if (isNaN(val) || val < 0) { inp.value = 0; return; }
      try { await modifierArticleSite(inp.dataset.qte, { quantite: val }); await load(); }
      catch (e) { window.toast("Échec : " + (e.message || e)); }
    });
  });
  mountedContainer.querySelectorAll("[data-cible]").forEach(inp => {
    inp.addEventListener("change", async () => {
      const val = parseFloat(inp.value);
      if (isNaN(val) || val < 0) { inp.value = 0; return; }
      try { await modifierArticleSite(inp.dataset.cible, { quantiteCible: val }); await load(); }
      catch (e) { window.toast("Échec : " + (e.message || e)); }
    });
  });
  mountedContainer.querySelectorAll("[data-del]").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!(await window.confirmDialog("Retirer cet article du stock du site ?", { danger: true, texteValider: "Retirer" }))) return;
      try { await supprimerArticleSite(btn.dataset.del); await load(); }
      catch (e) { window.toast("Échec : " + (e.message || e)); }
    });
  });

  mountedContainer.querySelectorAll("[data-open-config]").forEach(btn => btn.addEventListener("click", async () => {
    const statusEl = document.getElementById(`ssx-status-${btn.dataset.openConfig}`);
    if (!state.catalogueSite) {
      statusEl.innerHTML = `<span style="color:var(--text-dim)">⏳ Chargement de la liste type…</span>`;
      try { state.catalogueSite = await listerCatalogueSite(); }
      catch (e) { statusEl.innerHTML = `<span style="color:var(--red)">❌ ${esc(e.message || String(e))}</span>`; return; }
    }
    if (state.catalogueSite.length === 0) {
      statusEl.innerHTML = `<span style="color:var(--red)">La liste type des sites est vide — ajoute d'abord des produits dans l'onglet "Catalogue sites".</span>`;
      return;
    }
    statusEl.innerHTML = "";
    ui.addingSiteId = btn.dataset.openConfig; ui.addingMode = "config";
    render();
  }));
  mountedContainer.querySelectorAll("[data-open-catalogue]").forEach(btn => btn.addEventListener("click", async () => {
    const statusEl = document.getElementById(`ssx-status-${btn.dataset.openCatalogue}`);
    if (!state.catalogueCentral) {
      statusEl.innerHTML = `<span style="color:var(--text-dim)">⏳ Chargement…</span>`;
      try { state.catalogueCentral = await listerCatalogueCentral(); }
      catch (e) { statusEl.innerHTML = `<span style="color:var(--red)">❌ ${esc(e.message || String(e))}</span>`; return; }
    }
    statusEl.innerHTML = "";
    ui.addingSiteId = btn.dataset.openCatalogue; ui.addingMode = "catalogue";
    render();
  }));
  mountedContainer.querySelectorAll("[data-open-libre]").forEach(btn => btn.addEventListener("click", () => {
    ui.addingSiteId = btn.dataset.openLibre; ui.addingMode = "libre";
    render();
  }));

  attachAddFormListeners();
  if (ui.addingSiteId && ui.addingMode === "libre") attacherUniteField(`ssx-libre-unite-${ui.addingSiteId}`);
}

// =================================================================
// Mode rapide (défilement de tous les articles d'un site, sans revenir
// à la liste entre chaque — QR unique imprimé une fois par résidence)
// =================================================================
function renderRapide() {
  const site = state.sites.find(s => s.id === ui.rapideSiteId);
  if (!site) { ui.rapideSiteId = null; render(); return; }
  const liste = [...state.items].filter(it => it.dossierId === site.id).sort((a, b) => (a.nom || "").localeCompare(b.nom || ""));

  if (liste.length === 0) {
    mountedContainer.innerHTML = `
      <div class="stack">
        <button class="nav-btn" id="ssx-r-quitter">✕ Quitter le mode rapide</button>
        <p class="hint">Aucun article pour l'instant sur ${esc(site.nom)}.</p>
      </div>
    `;
    document.getElementById("ssx-r-quitter").addEventListener("click", () => { ui.rapideSiteId = null; render(); });
    return;
  }

  if (ui.rapideIndex >= liste.length) {
    mountedContainer.innerHTML = `
      <div class="stack">
        <div class="form-card" style="text-align:center;max-width:360px;margin:0 auto">
          <p style="font-size:36px;margin:0 0 8px">✅</p>
          <h3 style="margin:0 0 6px">Inventaire de ${esc(site.nom)} terminé</h3>
          <p class="hint" style="margin:0 0 16px">${liste.length} article(s) passé(s) en revue.</p>
          <button class="add-btn" id="ssx-r-fin" style="width:100%">← Retour à la liste</button>
        </div>
      </div>
    `;
    document.getElementById("ssx-r-fin").addEventListener("click", () => { ui.rapideSiteId = null; render(); });
    return;
  }

  const it = liste[ui.rapideIndex];
  mountedContainer.innerHTML = `
    <div class="stack">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <button class="nav-btn" id="ssx-r-quitter">✕ Quitter le mode rapide</button>
        <span class="hint">${ui.rapideIndex + 1} / ${liste.length} · ${esc(site.nom)}</span>
      </div>
      <div class="form-card" style="text-align:center;max-width:360px;margin:0 auto">
        <h3 style="margin:0 0 2px;font-size:17px">${esc(it.nom)}</h3>
        <p class="hint" style="margin:0 0 16px">Cible permanente : ${it.quantiteCible ?? 0} ${esc(it.unite || "")} · Dernier stock : ${it.quantite ?? 0} ${esc(it.unite || "")}</p>

        <p style="font-size:12px;color:var(--text-dim);margin:0 0 8px">Quantité comptée</p>
        <div style="display:flex;align-items:center;justify-content:center;gap:14px;margin-bottom:10px">
          <button id="ssx-r-moins" style="width:52px;height:52px;border-radius:50%;border:1px solid var(--border);background:var(--panel-alt);color:var(--text);font-size:26px;cursor:pointer">−</button>
          <input id="ssx-r-qte" type="number" min="0" value="${it.quantite ?? 0}" style="font-size:32px;font-weight:700;width:110px;text-align:center;background:transparent;border:none;border-bottom:2px solid var(--border);padding:4px">
          <button id="ssx-r-plus" style="width:52px;height:52px;border-radius:50%;border:1px solid var(--border);background:var(--panel-alt);color:var(--text);font-size:26px;cursor:pointer">+</button>
        </div>
        <div id="ssx-r-indicateur" style="font-size:12px;font-weight:700;margin-bottom:14px"></div>

        <button class="add-btn" id="ssx-r-valider" style="width:100%;font-size:15px;padding:14px">✓ Valider et suivant →</button>
        <button class="nav-btn" id="ssx-r-passer" style="width:100%;margin-top:8px">Passer sans modifier</button>
        <div id="ssx-r-status" style="font-size:12px;margin-top:10px"></div>
      </div>
    </div>
  `;

  const qteInput = document.getElementById("ssx-r-qte");
  const indicateur = document.getElementById("ssx-r-indicateur");
  function updateIndicateur() {
    const v = parseInt(qteInput.value, 10);
    if (isNaN(v)) { indicateur.innerHTML = ""; return; }
    indicateur.innerHTML = v < (it.quantiteCible ?? 0)
      ? `<span style="color:var(--red)">⚠️ Sous la cible</span>`
      : `<span style="color:var(--text-dim)">✓ Au niveau cible</span>`;
  }
  updateIndicateur();
  qteInput.addEventListener("input", updateIndicateur);

  document.getElementById("ssx-r-moins").addEventListener("click", () => { qteInput.value = Math.max(0, (parseInt(qteInput.value, 10) || 0) - 1); updateIndicateur(); });
  document.getElementById("ssx-r-plus").addEventListener("click", () => { qteInput.value = (parseInt(qteInput.value, 10) || 0) + 1; updateIndicateur(); });
  document.getElementById("ssx-r-quitter").addEventListener("click", () => { ui.rapideSiteId = null; render(); });
  document.getElementById("ssx-r-passer").addEventListener("click", () => { ui.rapideIndex++; render(); });
  document.getElementById("ssx-r-valider").addEventListener("click", async () => {
    const statusEl = document.getElementById("ssx-r-status");
    const nouvelle = parseInt(qteInput.value, 10);
    if (isNaN(nouvelle) || nouvelle < 0) { statusEl.innerHTML = `<span style="color:var(--red)">Quantité invalide.</span>`; return; }
    try {
      await actualiserStockSite(it.id, nouvelle, mountedUser?.uid || null);
      it.quantite = nouvelle; // reflète tout de suite dans state.items (même objet référencé)
      ui.rapideIndex++;
      render();
    } catch (e) {
      statusEl.innerHTML = `<span style="color:var(--red)">❌ ${esc(e.message || String(e))}</span>`;
    }
  });
}

// =================================================================
// Formulaires d'ajout (liste type / catalogue central / article libre)
// =================================================================
function renderAddForm(site) {
  if (ui.addingMode === "config") {
    const items = state.items.filter(it => it.dossierId === site.id);
    const parProduitId = new Map(items.filter(it => it.produitId).map(it => [it.produitId, it]));
    const categories = [...new Set((state.catalogueSite || []).map(p => p.categorie || "Autre"))];
    return `
      <p class="hint" style="margin:0 0 10px">Coche les produits que ce site doit garder en permanence, et indique la quantité à toujours avoir sur place.</p>
      ${categories.map(cat => `
        <p style="font-size:12px;font-weight:700;color:var(--gold);margin:12px 0 6px">${esc(cat)}</p>
        ${(state.catalogueSite || []).filter(p => (p.categorie || "Autre") === cat).map(p => {
          const existant = parProduitId.get(p.id);
          return `
          <div style="display:flex;align-items:center;gap:10px;padding:4px 0;flex-wrap:wrap">
            <label style="display:flex;align-items:center;gap:6px;flex:1;min-width:200px">
              <input type="checkbox" data-cfg-concerne="${p.id}" ${existant ? 'checked' : ''} style="width:16px;height:16px;accent-color:var(--gold)">
              ${esc(p.nom)}
            </label>
            <label style="font-size:11px;color:var(--text-dim)">Cible perm.
              <input type="number" min="0" step="1" data-cfg-cible="${p.id}" value="${existant?.quantiteCible ?? 1}" style="width:60px;margin-left:4px">
            </label>
          </div>`;
        }).join("")}
      `).join("")}
      <div style="display:flex;gap:8px;margin-top:14px">
        <button class="add-btn" data-config-valider="${site.id}">✓ Enregistrer la configuration</button>
        <button class="nav-btn" data-add-annuler="${site.id}">✕ Annuler</button>
      </div>
    `;
  }
  if (ui.addingMode === "catalogue") {
    return `
      <div class="form-grid">
        <label>Produit du catalogue
          <select id="ssx-catalogue-produit-${site.id}">
            ${(state.catalogueCentral || []).map(p => `<option value="${p.id}">${esc(p.nom)}</option>`).join("")}
          </select>
        </label>
        <label>Quantité<input type="number" min="0" step="1" id="ssx-catalogue-qte-${site.id}" value="1"></label>
        <label>Quantité à avoir en permanence<input type="number" min="0" step="1" id="ssx-catalogue-cible-${site.id}" value="1"></label>
      </div>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="add-btn" data-catalogue-valider="${site.id}">✓ Ajouter</button>
        <button class="nav-btn" data-add-annuler="${site.id}">✕ Annuler</button>
      </div>
    `;
  }
  // libre
  return `
    <div class="form-grid">
      <label>Nom de l'article<input id="ssx-libre-nom-${site.id}" placeholder="ex. pièce spécifique à ce site"></label>
      <label>Quantité<input type="number" min="0" step="1" id="ssx-libre-qte-${site.id}" value="1"></label>
      <label>Quantité à avoir en permanence<input type="number" min="0" step="1" id="ssx-libre-cible-${site.id}" value="1"></label>
      <label>Unité${renderUniteField(`ssx-libre-unite-${site.id}`, "pièce", esc)}</label>
    </div>
    <div style="display:flex;gap:8px;margin-top:8px">
      <button class="add-btn" data-libre-valider="${site.id}">✓ Ajouter</button>
      <button class="nav-btn" data-add-annuler="${site.id}">✕ Annuler</button>
    </div>
  `;
}

function attachAddFormListeners() {
  mountedContainer.querySelectorAll("[data-add-annuler]").forEach(btn => btn.addEventListener("click", () => {
    ui.addingSiteId = null; ui.addingMode = null; render();
  }));
  mountedContainer.querySelectorAll("[data-config-valider]").forEach(btn => btn.addEventListener("click", async () => {
    const siteId = btn.dataset.configValider;
    const statusEl = document.getElementById(`ssx-status-${siteId}`);
    const items = state.items.filter(it => it.dossierId === siteId);
    const decisions = (state.catalogueSite || []).map(p => {
      const cb = document.querySelector(`[data-cfg-concerne="${p.id}"]`);
      const cible = document.querySelector(`[data-cfg-cible="${p.id}"]`);
      return {
        produitId: p.id, nom: p.nom, unite: p.unite || "",
        concerne: cb?.checked || false,
        quantiteCible: parseFloat(cible?.value) || 0,
      };
    });
    statusEl.innerHTML = `<span style="color:var(--text-dim)">⏳ Enregistrement…</span>`;
    try {
      await configurerArticlesSiteDepuisCatalogue(siteId, items, decisions, "site");
      ui.addingSiteId = null; ui.addingMode = null;
      await load();
    } catch (e) {
      statusEl.innerHTML = `<span style="color:var(--red)">❌ ${esc(e.message || String(e))}</span>`;
    }
  }));
  mountedContainer.querySelectorAll("[data-catalogue-valider]").forEach(btn => btn.addEventListener("click", async () => {
    const siteId = btn.dataset.catalogueValider;
    const statusEl = document.getElementById(`ssx-status-${siteId}`);
    const produitId = document.getElementById(`ssx-catalogue-produit-${siteId}`).value;
    const produit = (state.catalogueCentral || []).find(p => p.id === produitId);
    const qte = parseFloat(document.getElementById(`ssx-catalogue-qte-${siteId}`).value) || 0;
    const cible = parseFloat(document.getElementById(`ssx-catalogue-cible-${siteId}`).value) || 0;
    if (!produit) return;
    try {
      await ajouterArticleSite(siteId, { produitId: produit.id, catalogueOrigine: "central", nom: produit.nom, unite: produit.unite || "", quantite: qte, quantiteCible: cible });
      ui.addingSiteId = null; ui.addingMode = null;
      await load();
    } catch (e) {
      statusEl.innerHTML = `<span style="color:var(--red)">❌ ${esc(e.message || String(e))}</span>`;
    }
  }));
  mountedContainer.querySelectorAll("[data-libre-valider]").forEach(btn => btn.addEventListener("click", async () => {
    const siteId = btn.dataset.libreValider;
    const statusEl = document.getElementById(`ssx-status-${siteId}`);
    const nom = document.getElementById(`ssx-libre-nom-${siteId}`).value.trim();
    const qte = parseFloat(document.getElementById(`ssx-libre-qte-${siteId}`).value) || 0;
    const cible = parseFloat(document.getElementById(`ssx-libre-cible-${siteId}`).value) || 0;
    const unite = document.getElementById(`ssx-libre-unite-${siteId}`).value.trim() || "pièce";
    if (!nom) { statusEl.innerHTML = `<span style="color:var(--red)">Le nom est obligatoire.</span>`; return; }
    try {
      await ajouterArticleSite(siteId, { produitId: null, nom, unite, quantite: qte, quantiteCible: cible });
      ui.addingSiteId = null; ui.addingMode = null;
      await load();
    } catch (e) {
      statusEl.innerHTML = `<span style="color:var(--red)">❌ ${esc(e.message || String(e))}</span>`;
    }
  }));
}

// =================================================================
// QR code
// =================================================================
// =================================================================
// Flux des sorties par logement, pour un site (résidence) donné
// =================================================================
async function renderFlux() {
  const site = state.sites.find(s => s.id === ui.fluxSiteId);
  const itemsDuSite = state.items.filter(it => it.dossierId === ui.fluxSiteId);
  mountedContainer.innerHTML = `<div class="stack"><button class="nav-btn" id="ssx-flux-retour">← Retour</button><p class="hint">⏳ Calcul du flux…</p></div>`;
  document.getElementById("ssx-flux-retour").addEventListener("click", () => { ui.screen = "liste"; render(); });

  const tousMouvements = (await Promise.all(itemsDuSite.map(it => listerMouvementsSite(it.id)))).flat();
  const sorties = tousMouvements.filter(m => m.type === "sortie" && m.logement);
  const parLogement = new Map();
  sorties.forEach(m => parLogement.set(m.logement, (parLogement.get(m.logement) || 0) + (m.quantiteSortie || 0)));
  const entries = [...parLogement.entries()].sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, q]) => s + q, 0);
  const stockActuelTotal = itemsDuSite.reduce((s, it) => s + (it.quantite || 0), 0);

  if (ui.screen !== "flux" || ui.fluxSiteId !== site?.id) return; // l'utilisateur a changé d'écran pendant le calcul

  mountedContainer.innerHTML = `
    <div class="stack">
      <button class="nav-btn" id="ssx-flux-retour">← Retour</button>
      <div class="form-card">
        <h3 style="margin:0 0 4px;font-size:14px;color:var(--gold)">🌊 Flux des sorties — ${esc(site?.nom || "")}</h3>
        <p class="hint" style="margin:0 0 14px">Répartition de toutes les sorties enregistrées vers chaque logement.</p>
        ${entries.length === 0 ? `<p class="hint">Aucune sortie avec logement renseigné pour l'instant sur ce site.</p>` : `<div id="ssx-flux-svg" style="width:100%;overflow-x:auto"></div>`}
      </div>
    </div>
  `;
  document.getElementById("ssx-flux-retour").addEventListener("click", () => { ui.screen = "liste"; render(); });
  if (entries.length > 0) dessinerFluxSVG(document.getElementById("ssx-flux-svg"), entries, total, { labelCentre: "STOCK", reserveTotal: stockActuelTotal });
}

// =================================================================
// Jauges des sorties — tableau de bord : un coup d'œil sur ce qui part
// le plus vite sur ce site, article par article (quantité totale sortie
// depuis le début du suivi, tous logements confondus).
// =================================================================
async function renderJauges() {
  const site = state.sites.find(s => s.id === ui.jaugesSiteId);
  const itemsDuSite = state.items.filter(it => it.dossierId === ui.jaugesSiteId);
  mountedContainer.innerHTML = `<div class="stack"><button class="nav-btn" id="ssx-jauges-retour">← Retour</button><p class="hint">⏳ Calcul des sorties…</p></div>`;
  document.getElementById("ssx-jauges-retour").addEventListener("click", () => { ui.screen = "liste"; render(); });

  const tousMouvements = await Promise.all(itemsDuSite.map(it => listerMouvementsSite(it.id)));
  const parItem = itemsDuSite.map((it, i) => {
    const sorties = tousMouvements[i].filter(m => m.type === "sortie");
    const total = sorties.reduce((s, m) => s + (m.quantiteSortie || 0), 0);
    return { nom: it.nom, unite: it.unite || "", total, nombre: sorties.length };
  }).filter(it => it.total > 0).sort((a, b) => b.total - a.total);

  if (ui.screen !== "jauges" || ui.jaugesSiteId !== site?.id) return; // écran changé pendant le calcul

  const maxTotal = parItem.reduce((m, it) => Math.max(m, it.total), 0) || 1;

  mountedContainer.innerHTML = `
    <div class="stack">
      <button class="nav-btn" id="ssx-jauges-retour">← Retour</button>
      <div class="form-card">
        <h3 style="margin:0 0 4px;font-size:14px;color:var(--gold)">📊 Jauges des sorties — ${esc(site?.nom || "")}</h3>
        <p class="hint" style="margin:0 0 14px">Quantité totale sortie par article depuis le début du suivi, tous logements confondus. Rouge = article qui part le plus vite, sarcelle = consommation faible.</p>
        ${parItem.length === 0 ? `<p class="hint">Aucune sortie enregistrée pour l'instant sur ce site.</p>` : `
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px">
            ${parItem.map(it => uneJaugeSortieHTML(it, maxTotal)).join("")}
          </div>
        `}
      </div>
    </div>
  `;
  document.getElementById("ssx-jauges-retour").addEventListener("click", () => { ui.screen = "liste"; render(); });
}

function uneJaugeSortieHTML(it, maxTotal) {
  const f = Math.max(0, Math.min(1, it.total / maxTotal));
  const cx = 60, cy = 62, r = 46;
  const angle = 180 - f * 180;
  const rad = (angle * Math.PI) / 180;
  const endX = cx + r * Math.cos(rad);
  const endY = cy - r * Math.sin(rad);
  const couleur = f > 0.66 ? "#C24444" : f > 0.33 ? "#C29A3F" : "#3FB6AC";

  return `
    <div style="text-align:center">
      <svg viewBox="0 0 120 78" style="width:100%">
        <path d="M ${cx - r},${cy} A ${r},${r} 0 0 1 ${cx + r},${cy}" fill="none" stroke="var(--border, #444)" stroke-width="10" stroke-linecap="round"/>
        <path d="M ${cx - r},${cy} A ${r},${r} 0 0 1 ${endX},${endY}" fill="none" stroke="${couleur}" stroke-width="10" stroke-linecap="round"/>
        <text x="${cx}" y="${cy - 6}" text-anchor="middle" font-size="20" font-weight="800" fill="var(--text, #eee)">${it.total}</text>
        <text x="${cx}" y="${cy + 12}" text-anchor="middle" font-size="9" fill="var(--text-dim, #999)">${esc(it.unite)} · ${it.nombre} sortie(s)</text>
      </svg>
      <p style="margin:2px 0 0;font-size:11px;font-weight:700;line-height:1.2" title="${esc(it.nom)}">${esc(it.nom.length > 16 ? it.nom.slice(0, 15) + "…" : it.nom)}</p>
    </div>
  `;
}

// =================================================================
// Historique des sorties — liste détaillée, avec suppression réservée
// au Super Admin (recrédite automatiquement le stock de l'article).
// =================================================================
async function renderHistorique() {
  const site = state.sites.find(s => s.id === ui.historiqueSiteId);
  const itemsDuSite = state.items.filter(it => it.dossierId === ui.historiqueSiteId);
  const itemsParId = new Map(itemsDuSite.map(it => [it.id, it]));
  mountedContainer.innerHTML = `<div class="stack"><button class="nav-btn" id="ssx-hist-retour">← Retour</button><p class="hint">⏳ Chargement de l'historique…</p></div>`;
  document.getElementById("ssx-hist-retour").addEventListener("click", () => { ui.screen = "liste"; render(); });

  const tousMouvements = (await Promise.all(itemsDuSite.map(it => listerMouvementsSite(it.id)))).flat();
  const sorties = tousMouvements.filter(m => m.type === "sortie").sort((a, b) => (b.date?.toMillis?.() || 0) - (a.date?.toMillis?.() || 0));

  if (ui.screen !== "historique" || ui.historiqueSiteId !== site?.id) return; // écran changé pendant le chargement

  const estSuperAdmin = mountedUser?.role === "super_admin";

  mountedContainer.innerHTML = `
    <div class="stack">
      <button class="nav-btn" id="ssx-hist-retour">← Retour</button>
      <div class="form-card">
        <h3 style="margin:0 0 4px;font-size:14px;color:var(--gold)">🗂️ Historique des sorties — ${esc(site?.nom || "")}</h3>
        <p class="hint" style="margin:0 0 14px">${estSuperAdmin ? "Supprimer une sortie recrédite automatiquement le stock de l'article." : "Seul un Super Admin peut supprimer une sortie."}</p>
        ${sorties.length === 0 ? `<p class="hint">Aucune sortie enregistrée pour l'instant sur ce site.</p>` : `
          <div class="table-wrap">
            <table>
              <thead><tr><th>Date</th><th>Article</th><th>Quantité</th><th>Logement</th>${estSuperAdmin ? "<th></th>" : ""}</tr></thead>
              <tbody>
                ${sorties.map(m => {
                  const it = itemsParId.get(m.itemId);
                  const dateStr = m.date?.toDate ? m.date.toDate().toLocaleDateString("fr-FR") : "—";
                  return `
                    <tr>
                      <td>${dateStr}</td>
                      <td>${esc(it?.nom || "Article supprimé")}</td>
                      <td>${m.quantiteSortie ?? 0} ${esc(it?.unite || "")}</td>
                      <td>${esc(m.logement || "—")}</td>
                      ${estSuperAdmin ? `<td><button class="del-btn" data-del-mouvement="${m.id}" style="padding:3px 8px;font-size:11px" title="Supprimer cette sortie (ex. erreur de saisie) et recréditer le stock">🗑️</button></td>` : ""}
                    </tr>
                  `;
                }).join("")}
              </tbody>
            </table>
          </div>
        `}
      </div>
    </div>
  `;
  document.getElementById("ssx-hist-retour").addEventListener("click", () => { ui.screen = "liste"; render(); });
  mountedContainer.querySelectorAll("[data-del-mouvement]").forEach(btn => btn.addEventListener("click", async () => {
    const m = sorties.find(x => x.id === btn.dataset.delMouvement);
    if (!m) return;
    const it = itemsParId.get(m.itemId);
    if (!(await window.confirmDialog(`Supprimer cette sortie de "${it?.nom || "cet article"}" (${m.quantiteSortie ?? 0} ${it?.unite || ""}) ? Le stock sera recrédité de cette quantité.`, { danger: true, texteValider: "Supprimer" }))) return;
    try { await supprimerMouvementSite(m); await load(); await renderHistorique(); }
    catch (e) { window.toast("Échec : " + (e.message || e)); }
  }));
}

function renderQr() {
  const item = state.items.find(it => it.id === ui.qrId);
  if (!item) { ui.screen = "liste"; render(); return; }
  const site = state.sites.find(s => s.id === item.dossierId);

  mountedContainer.innerHTML = `
    <div class="stack">
      <button class="nav-btn" id="ssx-back">← Retour</button>
      <div class="form-card qr-print-card" id="ssx-qr-print-card" style="text-align:center;max-width:320px">
        <p style="font-weight:700;margin:0 0 4px">${esc(item.nom)}</p>
        <p class="hint" style="margin:0 0 12px">${esc(site?.nom || "")}</p>
        <div id="ssx-qr-holder" style="width:220px;height:220px;margin:0 auto"></div>
      </div>
      <button class="add-btn" id="ssx-print" style="width:fit-content">🖨️ Imprimer l'étiquette</button>
    </div>
  `;
  document.getElementById("ssx-back").addEventListener("click", () => { ui.screen = "liste"; render(); });
  document.getElementById("ssx-print").addEventListener("click", () => printQrCard(document.getElementById("ssx-qr-print-card")));

  const holder = document.getElementById("ssx-qr-holder");
  renderQrWithLogo(holder, qrPayloadForSite(item.id), 220);
}

// =================================================================
// Scanner
// =================================================================
function renderScan() {
  mountedContainer.innerHTML = `
    <div class="stack">
      <button class="nav-btn" id="ssx-cancel-scan">✕ Annuler</button>
      <div class="form-card" style="text-align:center;max-width:360px">
        <p class="hint" style="margin:0 0 14px">Prends une photo nette de l'étiquette QR de l'article — l'appareil photo habituel de ton téléphone va s'ouvrir.</p>
        <input type="file" accept="image/*" capture="environment" id="ssx-scan-input" style="display:none">
        <button class="add-btn" id="ssx-scan-open" style="width:100%;padding:16px;font-size:15px">📷 Prendre la photo</button>
      </div>
      <p class="hint" id="ssx-scan-hint"></p>
    </div>
  `;
  document.getElementById("ssx-cancel-scan").addEventListener("click", () => { ui.screen = "liste"; render(); });

  const onDecoded = (decodedText) => {
    let itemId = null;
    try { itemId = new URL(decodedText).searchParams.get("stocksite"); } catch (e) {}
    const item = itemId ? state.items.find(it => it.id === itemId) : null;
    if (item) {
      ui.screen = "ajuste"; ui.ajusteId = item.id;
      render();
    } else {
      document.getElementById("ssx-scan-hint").innerHTML = `<span style="color:var(--red)">QR non reconnu — ce n'est pas une étiquette de stock déporté. Réessaie avec la photo plus nette/plus proche.</span>`;
    }
  };

  const inputEl = document.getElementById("ssx-scan-input");
  document.getElementById("ssx-scan-open").addEventListener("click", () => inputEl.click());
  inputEl.addEventListener("change", () => {
    const fichier = inputEl.files?.[0];
    if (!fichier) return;
    const hintEl = document.getElementById("ssx-scan-hint");
    hintEl.innerHTML = `<span style="color:var(--text-dim)">⏳ Lecture du QR…</span>`;
    decoderImageQr(fichier)
      .then((texte) => {
        if (texte) onDecoded(texte);
        else hintEl.innerHTML = `<span style="color:var(--red)">Aucun QR détecté sur cette photo — réessaie en te rapprochant.</span>`;
      })
      .catch(() => { hintEl.innerHTML = `<span style="color:var(--red)">Échec de lecture de la photo.</span>`; })
      .finally(() => { inputEl.value = ""; });
  });
}

// Décode un QR code à partir d'une photo statique (plutôt qu'un flux
// vidéo en direct, qui s'est révélé peu fiable — écran noir — sur
// certains téléphones Android malgré l'autorisation caméra accordée).
function decoderImageQr(fichier) {
  return new Promise((resolve, reject) => {
    if (!window.jsQR) { reject(new Error("Librairie de lecture QR non chargée")); return; }
    const img = new Image();
    img.onload = () => {
      // Les photos de téléphone sont souvent énormes (plusieurs millions
      // de pixels) — les réduire accélère nettement l'analyse et évite des
      // soucis de performance/mémoire pouvant faire échouer la détection.
      // On tente d'abord une version réduite, puis la taille d'origine en
      // repli si rien n'est trouvé.
      const tentative = (largeurMax) => {
        const ratio = Math.min(1, largeurMax / Math.max(img.width, img.height));
        const w = Math.round(img.width * ratio);
        const h = Math.round(img.height * ratio);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        const donnees = ctx.getImageData(0, 0, w, h);
        return window.jsQR(donnees.data, donnees.width, donnees.height, { inversionAttempts: "attemptBoth" });
      };
      const resultat = tentative(1200) || tentative(Math.max(img.width, img.height));
      resolve(resultat ? resultat.data : null);
    };
    img.onerror = () => reject(new Error("Image illisible"));
    img.src = URL.createObjectURL(fichier);
  });
}

// =================================================================
// Actualiser / Sortie de produit
// =================================================================
async function renderAjuste() {
  mountedContainer.innerHTML = `<div class="hint">Chargement…</div>`;
  const item = await getArticleSiteAvecResidence(ui.ajusteId);
  if (!item) { mountedContainer.innerHTML = `<p class="hint">Article introuvable (peut-être supprimé).</p>`; return; }

  mountedContainer.innerHTML = `
    <div class="stack">
      <button class="nav-btn" id="ssx-back">← Retour</button>
      <div class="form-card" style="max-width:420px">
        <h3 style="margin:0 0 2px;font-size:16px">${esc(item.nom)}</h3>
        <p class="hint" style="margin:0 0 16px">${esc(item.siteNom)} · Stock actuel : <b>${item.quantite ?? 0} ${esc(item.unite || "")}</b></p>

        <div style="display:flex;gap:8px;margin-bottom:16px">
          <button class="nav-btn" id="ssx-mode-sortie" style="flex:1">📤 Sortie de produit</button>
          <button class="nav-btn" id="ssx-mode-actualiser" style="flex:1">🔄 Actualiser le stock</button>
        </div>
        <div id="ssx-ajuste-form"></div>
        <div id="ssx-ajuste-status" style="font-size:12px;margin-top:10px"></div>
      </div>
    </div>
  `;
  document.getElementById("ssx-back").addEventListener("click", () => { ui.screen = "liste"; ui.ajusteId = null; render(); });
  document.getElementById("ssx-mode-sortie").addEventListener("click", () => renderModeSortie(item));
  document.getElementById("ssx-mode-actualiser").addEventListener("click", () => renderModeActualiser(item));

  renderModeSortie(item); // mode par défaut
}

function renderModeSortie(item) {
  const formEl = document.getElementById("ssx-ajuste-form");
  formEl.innerHTML = `
    <label>Quantité sortie<input type="number" min="1" step="1" id="ssx-qte-sortie" value="1" style="font-size:18px;font-weight:700"></label>
    <label style="display:block;margin-top:10px">Logement concerné<input id="ssx-logement" placeholder="ex. Appartement 12, Chambre 3…"></label>
    <button class="add-btn" id="ssx-valider-sortie" style="margin-top:14px;width:100%">✓ Enregistrer la sortie</button>
  `;
  document.getElementById("ssx-valider-sortie").addEventListener("click", async () => {
    const statusEl = document.getElementById("ssx-ajuste-status");
    const qte = parseFloat(document.getElementById("ssx-qte-sortie").value);
    const logement = document.getElementById("ssx-logement").value.trim();
    if (isNaN(qte) || qte <= 0) { statusEl.innerHTML = `<span style="color:var(--red)">Quantité invalide.</span>`; return; }
    if (!logement) { statusEl.innerHTML = `<span style="color:var(--red)">Le logement concerné est obligatoire.</span>`; return; }
    statusEl.innerHTML = `<span style="color:var(--text-dim)">⏳ Enregistrement…</span>`;
    try {
      await enregistrerSortieSite(item.id, qte, logement, mountedUser?.uid || null);
      statusEl.innerHTML = `<span style="color:var(--gold)">✓ Sortie enregistrée</span>`;
      setTimeout(() => { ui.screen = "liste"; ui.ajusteId = null; load(); render(); }, 1000);
    } catch (e) {
      statusEl.innerHTML = `<span style="color:var(--red)">❌ ${esc(e.message || String(e))}</span>`;
    }
  });
}

function renderModeActualiser(item) {
  const formEl = document.getElementById("ssx-ajuste-form");
  formEl.innerHTML = `
    <label>Quantité comptée<input type="number" min="0" step="1" id="ssx-qte-actu" value="${item.quantite ?? 0}" style="font-size:18px;font-weight:700"></label>
    <button class="add-btn" id="ssx-valider-actu" style="margin-top:14px;width:100%">✓ Valider le comptage</button>
  `;
  document.getElementById("ssx-valider-actu").addEventListener("click", async () => {
    const statusEl = document.getElementById("ssx-ajuste-status");
    const qte = parseFloat(document.getElementById("ssx-qte-actu").value);
    if (isNaN(qte) || qte < 0) { statusEl.innerHTML = `<span style="color:var(--red)">Quantité invalide.</span>`; return; }
    statusEl.innerHTML = `<span style="color:var(--text-dim)">⏳ Enregistrement…</span>`;
    try {
      await actualiserStockSite(item.id, qte, mountedUser?.uid || null);
      statusEl.innerHTML = `<span style="color:var(--gold)">✓ Stock actualisé</span>`;
      setTimeout(() => { ui.screen = "liste"; ui.ajusteId = null; load(); render(); }, 800);
    } catch (e) {
      statusEl.innerHTML = `<span style="color:var(--red)">❌ ${esc(e.message || String(e))}</span>`;
    }
  });
}

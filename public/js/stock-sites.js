// stock-sites.js
// Vue centralisée et unique du stock déporté (onglet "Sites" du module
// Stock maintenance) : tous les sites ayant le stock déporté activé, avec
// leurs articles, quantités, seuils, QR codes et sorties de produit. Toute
// la gestion se fait ici — la fiche "Dossier de site" ne fait plus que
// porter la case "a un stock déporté".

import { esc } from "./astreinte-logic.js";
import {
  listerSitesAvecStockDeporte, listerTousLesArticlesSite,
  ajouterArticleSite, modifierArticleSite, supprimerArticleSite,
  configurerArticlesSiteDepuisCatalogue, listerCatalogueSite, listerCatalogueCentral,
  qrPayloadForSite, getArticleSiteAvecResidence, actualiserStockSite, enregistrerSortieSite,
} from "./stock-site-data.js";

let mountedContainer = null;
let mountedUser = null;
let state = { sites: [], items: [], catalogueSite: null, catalogueCentral: null };
let ui = { screen: "liste", qrId: null, ajusteId: null, addingSiteId: null, addingMode: null };

export async function mountStockSites(container, user) {
  mountedContainer = container;
  mountedUser = user;
  state = { sites: [], items: [], catalogueSite: null, catalogueCentral: null };
  ui = { screen: "liste", qrId: null, ajusteId: null, addingSiteId: null, addingMode: null };
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
  renderListe();
}

// =================================================================
// Liste
// =================================================================
function renderListe() {
  const alertesTotal = state.items.filter(it => (it.quantite ?? 0) < (it.quantiteCible ?? 0)).length;

  mountedContainer.innerHTML = `
    <div class="stack">
      <p class="hint">Stock gardé localement sur chaque site (indépendant du stock central), activable depuis la fiche d'un dossier de site ("📦 Ce site a un stock déporté").</p>
      <button class="add-btn" id="ssx-scan" style="width:fit-content">📷 Scanner un article</button>
      ${alertesTotal > 0 ? `<div class="stat-chip warn" style="width:fit-content">⚠️ ${alertesTotal} article(s) sous leur seuil, tous sites confondus</div>` : ""}

      ${state.sites.length === 0 ? `
        <p class="hint">Aucun site n'a le stock déporté activé pour l'instant. Coche "Ce site a un stock déporté" depuis la fiche d'un dossier de site (Dossiers de site) pour qu'il apparaisse ici.</p>
      ` : state.sites.map(site => {
        const items = state.items.filter(it => it.dossierId === site.id);
        return `
        <div class="form-card">
          <h3 style="margin:0 0 10px;font-size:14px;color:var(--gold)">🏢 ${esc(site.nom)}</h3>
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
      `;}).join("")}
    </div>
  `;

  document.getElementById("ssx-scan").addEventListener("click", () => { ui.screen = "scan"; render(); });
  mountedContainer.querySelectorAll("[data-qr]").forEach(btn => btn.addEventListener("click", () => { ui.screen = "qr"; ui.qrId = btn.dataset.qr; render(); }));
  mountedContainer.querySelectorAll("[data-ajuste]").forEach(btn => btn.addEventListener("click", () => { ui.screen = "ajuste"; ui.ajusteId = btn.dataset.ajuste; render(); }));
  mountedContainer.querySelectorAll("[data-qte]").forEach(inp => {
    inp.addEventListener("change", async () => {
      const val = parseFloat(inp.value);
      if (isNaN(val) || val < 0) { inp.value = 0; return; }
      try { await modifierArticleSite(inp.dataset.qte, { quantite: val }); await load(); }
      catch (e) { alert("Échec : " + (e.message || e)); }
    });
  });
  mountedContainer.querySelectorAll("[data-cible]").forEach(inp => {
    inp.addEventListener("change", async () => {
      const val = parseFloat(inp.value);
      if (isNaN(val) || val < 0) { inp.value = 0; return; }
      try { await modifierArticleSite(inp.dataset.cible, { quantiteCible: val }); await load(); }
      catch (e) { alert("Échec : " + (e.message || e)); }
    });
  });
  mountedContainer.querySelectorAll("[data-del]").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm("Retirer cet article du stock du site ?")) return;
      try { await supprimerArticleSite(btn.dataset.del); await load(); }
      catch (e) { alert("Échec : " + (e.message || e)); }
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
      <label>Unité<input id="ssx-libre-unite-${site.id}" placeholder="pièce, lot…" value="pièce"></label>
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
function renderQr() {
  const item = state.items.find(it => it.id === ui.qrId);
  if (!item) { ui.screen = "liste"; render(); return; }
  const site = state.sites.find(s => s.id === item.dossierId);

  mountedContainer.innerHTML = `
    <div class="stack">
      <button class="nav-btn" id="ssx-back">← Retour</button>
      <div class="form-card" style="text-align:center;max-width:320px">
        <p style="font-weight:700;margin:0 0 4px">${esc(item.nom)}</p>
        <p class="hint" style="margin:0 0 12px">${esc(site?.nom || "")}</p>
        <div id="ssx-qr-holder" style="width:220px;height:220px;margin:0 auto"></div>
      </div>
      <button class="add-btn" id="ssx-print" style="width:fit-content">🖨️ Imprimer l'étiquette</button>
    </div>
  `;
  document.getElementById("ssx-back").addEventListener("click", () => { ui.screen = "liste"; render(); });
  document.getElementById("ssx-print").addEventListener("click", () => window.print());

  const holder = document.getElementById("ssx-qr-holder");
  if (window.QRCode) {
    new window.QRCode(holder, { text: qrPayloadForSite(item.id), width: 220, height: 220, correctLevel: window.QRCode.CorrectLevel.M });
  } else {
    holder.textContent = "Librairie QR non chargée (vérifier app.html).";
  }
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

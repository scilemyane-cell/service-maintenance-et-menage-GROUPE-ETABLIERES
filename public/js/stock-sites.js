// stock-sites.js
// Vue centralisée (onglet "Sites" du module Stock maintenance) : tous les
// sites ayant un stock déporté activé, avec leurs articles, quantités et
// seuils d'alerte. Chaque article a un QR code (scannable directement avec
// l'appareil photo du téléphone) menant à un écran d'actualisation ou de
// sortie de produit avec le logement concerné.

import { esc } from "./astreinte-logic.js";
import {
  listerSitesAvecStockDeporte, listerTousLesArticlesSite,
  modifierArticleSite, supprimerArticleSite,
  qrPayloadForSite, getArticleSiteAvecResidence, actualiserStockSite, enregistrerSortieSite,
} from "./stock-site-data.js";

let mountedContainer = null;
let mountedUser = null;
let state = { sites: [], items: [], loading: true };
let ui = { screen: "liste", qrId: null, ajusteId: null, scanning: false };
let scanner = null;

export async function mountStockSites(container, user) {
  mountedContainer = container;
  mountedUser = user;
  state = { sites: [], items: [], loading: true };
  ui = { screen: "liste", qrId: null, ajusteId: null, scanning: false };
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
  state.loading = false;
  if (ui.screen === "liste") render();
}

function stopScanner() {
  if (scanner) { scanner.stop().catch(() => {}).finally(() => { scanner.clear?.(); scanner = null; }); }
}

function render() {
  if (!mountedContainer) return;
  if (!document.contains(mountedContainer)) { stopScanner(); return; }

  if (ui.screen === "qr") return renderQr();
  if (ui.screen === "ajuste") return renderAjuste();
  if (ui.screen === "scan") return renderScan();
  renderListe();
}

// =================================================================
// Liste
// =================================================================
function renderListe() {
  const alertesTotal = state.items.filter(it => (it.quantite ?? 0) <= (it.seuilMin ?? 0)).length;

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
                <thead><tr><th>Article</th><th>Origine</th><th>Quantité</th><th>Cible perm.</th><th>Seuil min.</th><th></th></tr></thead>
                <tbody>
                  ${items.map(it => `
                    <tr>
                      <td>${esc(it.nom)}</td>
                      <td style="font-size:11px;color:var(--text-dim)">${it.produitId ? "Catalogue central" : "Propre au site"}</td>
                      <td><input type="number" min="0" step="1" value="${it.quantite ?? 0}" data-qte="${it.id}" style="width:70px;${(it.quantite ?? 0) <= (it.seuilMin ?? 0) ? 'color:var(--red);font-weight:700' : ''}"> ${esc(it.unite || "")}</td>
                      <td style="font-size:12px;color:var(--text-dim)">${it.quantiteCible ?? "—"}</td>
                      <td><input type="number" min="0" step="1" value="${it.seuilMin ?? 0}" data-seuil="${it.id}" style="width:70px"></td>
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
          <p class="hint" style="margin-top:8px">Pour ajouter un article sur ce site, ouvre sa fiche depuis Dossiers de site.</p>
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
  mountedContainer.querySelectorAll("[data-seuil]").forEach(inp => {
    inp.addEventListener("change", async () => {
      const val = parseFloat(inp.value);
      if (isNaN(val) || val < 0) { inp.value = 0; return; }
      try { await modifierArticleSite(inp.dataset.seuil, { seuilMin: val }); await load(); }
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
      <div id="ssx-reader" style="max-width:360px;border-radius:10px;overflow:hidden"></div>
      <p class="hint" id="ssx-scan-hint">Pointe la caméra vers l'étiquette QR de l'article.</p>
    </div>
  `;
  document.getElementById("ssx-cancel-scan").addEventListener("click", () => { ui.screen = "liste"; stopScanner(); render(); });

  if (!window.Html5Qrcode) {
    document.getElementById("ssx-scan-hint").innerHTML = `<span style="color:var(--red)">Librairie de scan non chargée.</span>`;
    return;
  }
  scanner = new window.Html5Qrcode("ssx-reader");
  scanner.start(
    { facingMode: "environment" }, { fps: 10, qrbox: 220 },
    (decodedText) => {
      let itemId = null;
      try { itemId = new URL(decodedText).searchParams.get("stocksite"); } catch (e) {}
      const item = itemId ? state.items.find(it => it.id === itemId) : null;
      if (item) {
        stopScanner();
        ui.screen = "ajuste"; ui.ajusteId = item.id;
        render();
      } else {
        document.getElementById("ssx-scan-hint").innerHTML = `<span style="color:var(--red)">QR non reconnu — ce n'est pas une étiquette de stock déporté.</span>`;
      }
    },
    () => {}
  ).catch((err) => {
    document.getElementById("ssx-scan-hint").innerHTML = `<span style="color:var(--red)">Impossible d'accéder à la caméra : ${esc(err.message || String(err))}</span>`;
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

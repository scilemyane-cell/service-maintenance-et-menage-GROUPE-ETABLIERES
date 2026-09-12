// stock-menage.js
// Nouvel onglet indépendant "Stock Ménage" : produits de ménage
// (papier toilette, savon, produits d'entretien...), distinct du Stock
// maintenance (pièces techniques). Chaque sortie est attribuée à un
// centre (dossier de site) ou au dispositif MNA, pour suivre qui
// consomme quoi.

import { esc } from "./astreinte-logic.js";
import {
  watchProduits, creerProduit, modifierProduit, supprimerProduit,
  enregistrerSortie, enregistrerEntree, watchSorties,
  nouveauProduit, CATEGORIES_MENAGE, MNA_ID, MNA_LABEL, ZONES,
  watchZonesSites, definirZoneSite,
} from "./stock-menage-data.js";
import { watchSitesDossiers } from "./site-dossier-data.js";
import { renderQrWithLogo, printQrCard } from "./qr-logo.js";

let mountedContainer = null;
let mountedUser = null;
let state = { produits: [], sorties: [], sites: [], zonesSites: {} };
let unsubs = [];
let ui = { zone: "ecole", onglet: "produits", addingOpen: false, editingId: null, filtreAttribution: "toutes", filtreCategorie: "toutes", qrId: null, qrGeneralZone: null, rapide: false, rapideIndex: 0 };

const ROLES_GESTION = ["super_admin", "admin", "n1"];

// Les gestionnaires voient toujours les deux zones ; les autres rôles
// (techniciens, agents de ménage) sont restreints aux zones qui leur ont
// été explicitement assignées (Administration > Comptes), puisque le
// personnel n'est pas le même d'une association à l'autre.
function zonesAccessibles(user) {
  if (ROLES_GESTION.includes(user?.role)) return ["ecole", "agropolis"];
  return user?.stockMenageZones || [];
}

export async function mountStockMenage(container, user) {
  mountedContainer = container;
  mountedUser = user;
  state = { produits: [], sorties: [], sites: [], zonesSites: {} };
  const accessibles = zonesAccessibles(user);
  ui = { zone: accessibles[0] || null, onglet: "produits", addingOpen: false, editingId: null, filtreAttribution: "toutes", filtreCategorie: "toutes", qrId: null, qrGeneralZone: null, rapide: false, rapideIndex: 0 };
  unsubs.forEach(u => u());
  container.innerHTML = `<div class="hint">Chargement…</div>`;
  unsubs = [
    watchProduits((list) => {
      const dejaEnRapide = ui.rapide;
      state.produits = list;
      // Lien direct depuis un QR produit (scanné hors appli) :
      // .../app.html?stockmenage=ID_PRODUIT — ouvre directement sa fiche
      // avec la sortie prête à valider, sur la bonne zone.
      if (window.stockMenageDeepLinkProduitId) {
        const cible = list.find(p => p.id === window.stockMenageDeepLinkProduitId);
        window.stockMenageDeepLinkProduitId = null;
        if (cible && zonesAccessibles(mountedUser).includes(cible.zone)) {
          ui.zone = cible.zone;
          ui.onglet = "produits";
          ui.deepLinkSortieId = cible.id;
        }
      }
      // QR général par zone (mode rapide) : .../app.html?stockmenagerapide=ecole
      if (window.stockMenageRapideDeepLinkZone) {
        const zoneCible = window.stockMenageRapideDeepLinkZone;
        window.stockMenageRapideDeepLinkZone = null;
        if (zonesAccessibles(mountedUser).includes(zoneCible)) {
          ui.zone = zoneCible;
          ui.rapide = true;
          ui.rapideIndex = 0;
        }
      }
      if (!dejaEnRapide) render();
    }),
    watchSorties((list) => { state.sorties = list; render(); }),
    watchSitesDossiers((list) => { state.sites = list; render(); }),
    watchZonesSites((z) => { state.zonesSites = z; render(); }),
  ];
  render();
}

// Sites configurés (via Paramètres) comme concernés par une zone donnée.
function sitesDeLaZone(zone) {
  return state.sites.filter(s => state.zonesSites[s.id] === zone);
}

function render() {
  if (!mountedContainer || !document.contains(mountedContainer)) return;
  if (ui.qrId) { renderQr(state.produits.find(p => p.id === ui.qrId)); return; }
  if (ui.qrGeneralZone) { renderQrGeneral(ui.qrGeneralZone); return; }
  if (ui.rapide) { renderModeRapide(); return; }
  const accessibles = zonesAccessibles(mountedUser);
  const estGestion = ROLES_GESTION.includes(mountedUser?.role);

  if (accessibles.length === 0) {
    mountedContainer.innerHTML = `<div class="stack"><p class="hint">Aucune zone de stock ménage ne t'a été attribuée pour l'instant — contacte un administrateur.</p></div>`;
    return;
  }
  if (!ui.zone || (ui.zone !== "parametres" && !accessibles.includes(ui.zone))) ui.zone = accessibles[0];

  mountedContainer.innerHTML = `
    <div class="stack">
      <p class="hint">Produits de ménage (papier toilette, savon, produits d'entretien…), distincts du stock de pièces techniques — deux stocks séparés, École et Agropolis. Chaque sortie est attribuée à un centre concerné ou au dispositif MNA.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${accessibles.includes("ecole") ? `<button class="nav-btn" id="sm-zone-ecole" style="${ui.zone === 'ecole' ? 'border-color:var(--gold);color:var(--gold)' : ''}">🏫 École</button>` : ""}
        ${accessibles.includes("agropolis") ? `<button class="nav-btn" id="sm-zone-agropolis" style="${ui.zone === 'agropolis' ? 'border-color:var(--gold);color:var(--gold)' : ''}">🌾 Agropolis</button>` : ""}
        ${estGestion ? `<button class="nav-btn" id="sm-zone-parametres" style="${ui.zone === 'parametres' ? 'border-color:var(--gold);color:var(--gold)' : ''}">⚙️ Paramètres (sites concernés)</button>` : ""}
      </div>
      <div id="sm-corps"></div>
    </div>
  `;
  document.getElementById("sm-zone-ecole")?.addEventListener("click", () => { ui.zone = "ecole"; ui.onglet = "produits"; render(); });
  document.getElementById("sm-zone-agropolis")?.addEventListener("click", () => { ui.zone = "agropolis"; ui.onglet = "produits"; render(); });
  document.getElementById("sm-zone-parametres")?.addEventListener("click", () => { ui.zone = "parametres"; render(); });

  const corps = document.getElementById("sm-corps");
  if (ui.zone === "parametres" && estGestion) { renderParametresZones(corps); return; }

  corps.innerHTML = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0">
      <button class="nav-btn" id="sm-onglet-produits" style="${ui.onglet === 'produits' ? 'border-color:var(--gold);color:var(--gold)' : ''}">📦 Produits & stock</button>
      <button class="nav-btn" id="sm-onglet-historique" style="${ui.onglet === 'historique' ? 'border-color:var(--gold);color:var(--gold)' : ''}">🗂️ Historique des sorties</button>
    </div>
    <div id="sm-sous-corps"></div>
  `;
  document.getElementById("sm-onglet-produits").addEventListener("click", () => { ui.onglet = "produits"; render(); });
  document.getElementById("sm-onglet-historique").addEventListener("click", () => { ui.onglet = "historique"; render(); });

  const sousCorps = document.getElementById("sm-sous-corps");
  if (ui.onglet === "produits") renderProduits(sousCorps); else renderHistorique(sousCorps);
}

function attributionOptions(selectionnee) {
  const options = [`<option value="">— Choisir —</option>`, `<option value="${MNA_ID}" ${selectionnee === MNA_ID ? "selected" : ""}>👥 ${MNA_LABEL}</option>`];
  sitesDeLaZone(ui.zone).forEach(s => options.push(`<option value="${s.id}" ${selectionnee === s.id ? "selected" : ""}>🏢 ${esc(s.nom)}</option>`));
  return options.join("");
}

function nomAttribution(id) {
  if (id === MNA_ID) return MNA_LABEL;
  return state.sites.find(s => s.id === id)?.nom || "Inconnu";
}

// =================================================================
// Paramètres : quels sites sont concernés par chaque zone
// =================================================================
function renderParametresZones(container) {
  const sitesTries = [...state.sites].sort((a, b) => (a.nom || "").localeCompare(b.nom || ""));
  container.innerHTML = `
    <p class="hint" style="margin:10px 0">Indique, pour chaque site, s'il est concerné par le stock École, le stock Agropolis, ou aucun des deux (n'apparaîtra alors dans aucune liste d'attribution de sortie).</p>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Site</th><th>Zone</th></tr></thead>
        <tbody>
          ${sitesTries.length === 0 ? `<tr><td colspan="2" class="empty-row">Aucun site pour l'instant.</td></tr>` :
            sitesTries.map(s => `
              <tr>
                <td>${esc(s.nom)}</td>
                <td>
                  <select data-zone-site="${s.id}">
                    <option value="" ${!state.zonesSites[s.id] ? "selected" : ""}>— Aucune —</option>
                    ${Object.entries(ZONES).map(([k, v]) => `<option value="${k}" ${state.zonesSites[s.id] === k ? "selected" : ""}>${v}</option>`).join("")}
                  </select>
                </td>
              </tr>
            `).join("")}
        </tbody>
      </table>
    </div>
  `;
  container.querySelectorAll("[data-zone-site]").forEach(sel => sel.addEventListener("change", async (e) => {
    try { await definirZoneSite(sel.dataset.zoneSite, e.target.value || null); } catch (err) { alert("Erreur : " + (err.message || err)); }
  }));
}

// =================================================================
// Onglet Produits & stock
// =================================================================
function renderProduits(container) {
  const produits = state.produits.filter(p => p.zone === ui.zone);
  container.innerHTML = `
    <div style="display:flex;gap:8px;margin:10px 0;flex-wrap:wrap">
      <button class="add-btn" id="sm-add">➕ Ajouter un produit</button>
      <button class="nav-btn" id="sm-qr-general">🔲 QR général (actualisation rapide)</button>
    </div>
    ${ui.addingOpen ? renderFormProduit(null) : ""}
    ${produits.length === 0 ? `<p class="hint">Aucun produit pour l'instant dans le stock ${ZONES[ui.zone]}.</p>` : CATEGORIES_MENAGE.map(cat => {
      const liste = produits.filter(p => p.categorie === cat);
      if (liste.length === 0) return "";
      return `
        <p style="font-size:12px;font-weight:700;color:var(--text-dim);margin:14px 0 6px">${esc(cat)}</p>
        ${liste.map(p => renderCarteProduit(p)).join("")}
      `;
    }).join("")}
    ${produits.filter(p => !CATEGORIES_MENAGE.includes(p.categorie)).map(p => renderCarteProduit(p)).join("")}
  `;

  document.getElementById("sm-add").addEventListener("click", () => { ui.addingOpen = !ui.addingOpen; ui.editingId = null; render(); });
  document.getElementById("sm-qr-general").addEventListener("click", () => { ui.qrGeneralZone = ui.zone; render(); });
  attacherEcouteursProduits();

  // Ouvre automatiquement la sortie du produit visé par un QR scanné,
  // une seule fois (voir mountStockMenage).
  if (ui.deepLinkSortieId) {
    const id = ui.deepLinkSortieId;
    ui.deepLinkSortieId = null;
    const holder = document.getElementById(`sm-sortie-form-${id}`);
    if (holder) {
      holder.innerHTML = renderFormSortie(id);
      attacherEcouteurSortie(id);
      holder.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }
}

// Encodage du QR : un vrai lien vers l'appli avec l'id du produit en
// paramètre — scanné avec l'appareil photo normal du téléphone, ouvre
// directement la fiche du bon produit, sortie prête à valider. Même
// principe que le Stock maintenance.
export function qrPayloadFor(produitId) {
  return `https://service-maintenance-et-menage.web.app/app.html?stockmenage=${produitId}`;
}

// Encodage du QR général d'une zone — un seul QR, imprimé une fois,
// menant directement au mode rapide d'actualisation de tous les
// produits de cette zone (comme le QR général du Stock maintenance).
export function qrPayloadGeneral(zone) {
  return `https://service-maintenance-et-menage.web.app/app.html?stockmenagerapide=${zone}`;
}

function renderQrGeneral(zone) {
  mountedContainer.innerHTML = `
    <div class="stack">
      <button class="nav-btn" id="sm-qrg-back">← Retour</button>
      <div class="form-card qr-print-card" style="text-align:center;max-width:320px" id="sm-qrg-print">
        <p style="font-weight:700;margin:0 0 4px">Stock Ménage — ${ZONES[zone]}</p>
        <p class="hint" style="margin:0 0 12px">Ouvre l'actualisation rapide de tous les produits</p>
        <div id="sm-qrg-canvas" style="width:220px;height:220px;margin:0 auto"></div>
      </div>
      <button class="add-btn" id="sm-qrg-print-btn" style="width:fit-content">🖨️ Imprimer l'affiche</button>
    </div>
  `;
  document.getElementById("sm-qrg-back").addEventListener("click", () => { ui.qrGeneralZone = null; render(); });
  document.getElementById("sm-qrg-print-btn").addEventListener("click", () => printQrCard(document.getElementById("sm-qrg-print")));
  renderQrWithLogo(document.getElementById("sm-qrg-canvas"), qrPayloadGeneral(zone), 220);
}

// Mode rapide : passe en revue, un par un, tous les produits de la zone
// actuelle pour actualiser directement leur stock — même principe que
// le mode rapide du Stock maintenance.
function renderModeRapide() {
  const produits = state.produits.filter(p => p.zone === ui.zone);
  if (produits.length === 0) {
    mountedContainer.innerHTML = `<div class="stack" style="padding:16px"><p class="hint">Aucun produit pour l'instant dans le stock ${ZONES[ui.zone]}.</p><button class="nav-btn" id="sm-rapide-quitter">← Retour</button></div>`;
    document.getElementById("sm-rapide-quitter").addEventListener("click", () => { ui.rapide = false; render(); });
    return;
  }
  if (ui.rapideIndex >= produits.length) {
    mountedContainer.innerHTML = `
      <div class="stack" style="padding:16px">
        <div class="form-card" style="text-align:center;max-width:360px;margin:0 auto">
          <p style="font-size:36px;margin:0 0 8px">✅</p>
          <h3 style="margin:0 0 6px">Stock ${ZONES[ui.zone]} actualisé</h3>
          <p class="hint" style="margin:0 0 16px">${produits.length} produit(s) passé(s) en revue.</p>
          <button class="add-btn" id="sm-rapide-recommencer" style="width:100%">↻ Recommencer</button>
          <button class="nav-btn" id="sm-rapide-quitter" style="width:100%;margin-top:8px">Terminer</button>
        </div>
      </div>`;
    document.getElementById("sm-rapide-recommencer").addEventListener("click", () => { ui.rapideIndex = 0; render(); });
    document.getElementById("sm-rapide-quitter").addEventListener("click", () => { ui.rapide = false; render(); });
    return;
  }

  const p = produits[ui.rapideIndex];
  mountedContainer.innerHTML = `
    <div class="stack" style="padding:16px">
      <p class="hint" style="text-align:center">${ui.rapideIndex + 1} / ${produits.length} · ${ZONES[ui.zone]}</p>
      <div class="form-card" style="text-align:center;max-width:360px;margin:0 auto">
        <h3 style="margin:0 0 2px;font-size:17px">${esc(p.nom)}</h3>
        <p class="hint" style="margin:0 0 16px">${esc(p.categorie || "")} · Dernier stock : ${p.stockActuel || 0} ${esc(p.unite || "")}</p>

        <p style="font-size:12px;color:var(--text-dim);margin:0 0 8px">Quantité comptée</p>
        <div style="display:flex;align-items:center;justify-content:center;gap:14px;margin-bottom:10px">
          <button id="sm-rapide-moins" style="width:52px;height:52px;border-radius:50%;border:1px solid var(--border);background:var(--panel-alt);color:var(--text);font-size:26px;cursor:pointer">−</button>
          <input id="sm-rapide-qte" type="number" min="0" value="${p.stockActuel || 0}" style="font-size:32px;font-weight:700;width:110px;text-align:center;background:transparent;border:none;border-bottom:2px solid var(--border);padding:4px">
          <button id="sm-rapide-plus" style="width:52px;height:52px;border-radius:50%;border:1px solid var(--border);background:var(--panel-alt);color:var(--text);font-size:26px;cursor:pointer">+</button>
        </div>

        <button class="add-btn" id="sm-rapide-valider" style="width:100%;font-size:15px;padding:14px">✓ Valider et suivant →</button>
        <button class="nav-btn" id="sm-rapide-passer" style="width:100%;margin-top:8px">Passer sans modifier</button>
        <button class="nav-btn" id="sm-rapide-quitter-inline" style="width:100%;margin-top:8px;border:none">← Quitter le mode rapide</button>
        <div id="sm-rapide-status" style="font-size:12px;margin-top:10px"></div>
      </div>
    </div>`;

  const qteInput = document.getElementById("sm-rapide-qte");
  document.getElementById("sm-rapide-moins").addEventListener("click", () => { qteInput.value = Math.max(0, (parseInt(qteInput.value, 10) || 0) - 1); });
  document.getElementById("sm-rapide-plus").addEventListener("click", () => { qteInput.value = (parseInt(qteInput.value, 10) || 0) + 1; });
  document.getElementById("sm-rapide-passer").addEventListener("click", () => { ui.rapideIndex++; render(); });
  document.getElementById("sm-rapide-quitter-inline").addEventListener("click", () => { ui.rapide = false; render(); });
  document.getElementById("sm-rapide-valider").addEventListener("click", async () => {
    const statusEl = document.getElementById("sm-rapide-status");
    const nouvelle = parseInt(qteInput.value, 10);
    if (isNaN(nouvelle) || nouvelle < 0) { statusEl.innerHTML = `<span style="color:var(--red)">Quantité invalide.</span>`; return; }
    try {
      await modifierProduit(p.id, { stockActuel: nouvelle });
      ui.rapideIndex++;
      render();
    } catch (e) {
      statusEl.innerHTML = `<span style="color:var(--red)">❌ ${esc(e.message || String(e))}</span>`;
    }
  });
}

function renderQr(p) {
  if (!p) { ui.qrId = null; render(); return; }
  mountedContainer.innerHTML = `
    <div class="stack">
      <button class="nav-btn" id="sm-qr-back">← Retour</button>
      <div class="form-card qr-print-card" style="text-align:center;max-width:320px" id="sm-qr-print">
        <p style="font-weight:700;margin:0 0 4px">${esc(p.nom)}</p>
        <p class="hint" style="margin:0 0 12px">${esc(p.categorie || "")} · ${ZONES[p.zone] || ""}</p>
        <div id="sm-qr-canvas" style="width:220px;height:220px;margin:0 auto"></div>
      </div>
      <button class="add-btn" id="sm-qr-print-btn" style="width:fit-content">🖨️ Imprimer l'étiquette</button>
    </div>
  `;
  document.getElementById("sm-qr-back").addEventListener("click", () => { ui.qrId = null; render(); });
  document.getElementById("sm-qr-print-btn").addEventListener("click", () => printQrCard(document.getElementById("sm-qr-print")));
  renderQrWithLogo(document.getElementById("sm-qr-canvas"), qrPayloadFor(p.id), 220);
}

function renderCarteProduit(p) {
  const enAlerte = (p.stockActuel || 0) <= (p.stockMin || 0);
  const enSurstock = p.stockMax > 0 && (p.stockActuel || 0) > p.stockMax;
  return `
    <div class="form-card" style="margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap">
        <div>
          <p style="margin:0;font-weight:700">${esc(p.nom)}</p>
          <p style="margin:2px 0 0;font-size:12px;${enAlerte ? "color:var(--red);font-weight:700" : enSurstock ? "color:var(--gold);font-weight:700" : "color:var(--text-dim)"}">${enAlerte ? "⚠️ " : enSurstock ? "📦 " : ""}Stock : ${p.stockActuel || 0} ${esc(p.unite || "")} ${enAlerte ? "(sous le stock minimum)" : enSurstock ? "(au-dessus du stock maximum)" : ""}</p>
          <p style="margin:2px 0 0;font-size:11px;color:var(--text-dim)">Min : ${p.stockMin || 0} · Max : ${p.stockMax || "—"}${(p.uniteParEmballage || p.uniteParPalette) ? ` · Conditionnement : ${p.uniteParEmballage ? p.uniteParEmballage + " " + esc(p.unite || "") + "/emballage" : ""}${p.uniteParEmballage && p.uniteParPalette ? " · " : ""}${p.uniteParPalette ? p.uniteParPalette + " emballages/palette" : ""}` : ""}</p>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="nav-btn" data-sortie="${p.id}" style="padding:6px 10px;font-size:12px">📤 Sortie</button>
          <button class="nav-btn" data-entree="${p.id}" style="padding:6px 10px;font-size:12px">📥 Entrée</button>
          <button class="nav-btn" data-qr-sm="${p.id}" style="padding:6px 10px;font-size:12px">🔲 QR</button>
          <button class="nav-btn" data-edit-sm="${p.id}" style="padding:6px 10px;font-size:12px">✏️</button>
          <button class="del-btn" data-del-sm="${p.id}" style="padding:6px 10px;font-size:12px">🗑️</button>
        </div>
      </div>
      ${ui.editingId === p.id ? renderFormProduit(p) : ""}
      <div id="sm-sortie-form-${p.id}"></div>
      <div id="sm-entree-form-${p.id}"></div>
    </div>
  `;
}

function renderFormProduit(p) {
  const data = p || nouveauProduit(ui.zone);
  const prefix = p ? `sm-edit-${p.id}` : "sm-new";
  return `
    <div class="form-card" style="margin-top:8px;background:var(--panel-alt)">
      <h4 style="margin:0 0 10px;font-size:14px">${p ? "Modifier — " + esc(p.nom) : `Nouveau produit — stock ${ZONES[ui.zone]}`}</h4>
      <div class="form-grid">
        <label>Nom<input id="${prefix}-nom" value="${esc(data.nom || '')}" placeholder="ex. Papier toilette"></label>
        <label>Catégorie
          <select id="${prefix}-categorie">
            <option value="">— Choisir —</option>
            ${CATEGORIES_MENAGE.map(c => `<option value="${esc(c)}" ${data.categorie === c ? "selected" : ""}>${esc(c)}</option>`).join("")}
          </select>
        </label>
        <label>Unité<input id="${prefix}-unite" value="${esc(data.unite || 'pièce')}" placeholder="ex. rouleau, litre, pièce"></label>
        <label>Stock actuel<input type="number" min="0" id="${prefix}-stock" value="${data.stockActuel || 0}"></label>
        <label>Stock minimum (alerte)<input type="number" min="0" id="${prefix}-stockmin" value="${data.stockMin || 0}"></label>
        <label>Stock maximum<input type="number" min="0" id="${prefix}-stockmax" value="${data.stockMax || 0}"></label>
        <label>Conditionnement — unités par emballage<input type="number" min="0" id="${prefix}-condemballage" value="${data.uniteParEmballage || 0}" placeholder="ex. 6 rouleaux/paquet"></label>
        <label>Conditionnement — emballages par palette<input type="number" min="0" id="${prefix}-condpalette" value="${data.uniteParPalette || 0}" placeholder="ex. 60 paquets/palette"></label>
      </div>
      <div style="display:flex;gap:8px;margin-top:10px">
        <button class="add-btn" data-save-sm="${p ? p.id : 'new'}">💾 Enregistrer</button>
        <button class="nav-btn" data-cancel-sm="${p ? p.id : 'new'}">Annuler</button>
      </div>
      <div id="${prefix}-status" style="font-size:12px;margin-top:8px"></div>
    </div>
  `;
}

function attacherEcouteursProduits() {
  mountedContainer.querySelectorAll("[data-edit-sm]").forEach(btn => btn.addEventListener("click", () => {
    ui.editingId = ui.editingId === btn.dataset.editSm ? null : btn.dataset.editSm;
    ui.addingOpen = false;
    render();
  }));
  mountedContainer.querySelectorAll("[data-del-sm]").forEach(btn => btn.addEventListener("click", async () => {
    const p = state.produits.find(x => x.id === btn.dataset.delSm);
    if (!p) return;
    if (!confirm(`Mettre "${p.nom}" à la corbeille ?`)) return;
    try { await supprimerProduit(p.id); } catch (e) { alert("Erreur : " + (e.message || e)); }
  }));
  mountedContainer.querySelectorAll("[data-cancel-sm]").forEach(btn => btn.addEventListener("click", () => {
    ui.addingOpen = false; ui.editingId = null; render();
  }));
  mountedContainer.querySelectorAll("[data-save-sm]").forEach(btn => btn.addEventListener("click", async () => {
    const id = btn.dataset.saveSm;
    const prefix = id === "new" ? "sm-new" : `sm-edit-${id}`;
    const statusEl = document.getElementById(`${prefix}-status`);
    const nom = document.getElementById(`${prefix}-nom`).value.trim();
    if (!nom) { statusEl.innerHTML = `<span style="color:var(--red)">Le nom est obligatoire.</span>`; return; }
    const payload = {
      nom, categorie: document.getElementById(`${prefix}-categorie`).value,
      unite: document.getElementById(`${prefix}-unite`).value.trim() || "pièce",
      stockActuel: parseInt(document.getElementById(`${prefix}-stock`).value, 10) || 0,
      stockMin: parseInt(document.getElementById(`${prefix}-stockmin`).value, 10) || 0,
      stockMax: parseInt(document.getElementById(`${prefix}-stockmax`).value, 10) || 0,
      uniteParEmballage: parseInt(document.getElementById(`${prefix}-condemballage`).value, 10) || 0,
      uniteParPalette: parseInt(document.getElementById(`${prefix}-condpalette`).value, 10) || 0,
    };
    if (id === "new") payload.zone = ui.zone; // la zone d'un produit existant ne change jamais après coup depuis ce formulaire
    statusEl.innerHTML = `<span style="color:var(--text-dim)">⏳ Enregistrement…</span>`;
    try {
      if (id === "new") { await creerProduit(payload); ui.addingOpen = false; }
      else { await modifierProduit(id, payload); ui.editingId = null; }
      render();
    } catch (e) {
      statusEl.innerHTML = `<span style="color:var(--red)">❌ ${esc(e.message || String(e))}</span>`;
    }
  }));

  mountedContainer.querySelectorAll("[data-qr-sm]").forEach(btn => btn.addEventListener("click", () => { ui.qrId = btn.dataset.qrSm; render(); }));
  mountedContainer.querySelectorAll("[data-sortie]").forEach(btn => btn.addEventListener("click", () => {
    const holder = document.getElementById(`sm-sortie-form-${btn.dataset.sortie}`);
    holder.innerHTML = holder.innerHTML ? "" : renderFormSortie(btn.dataset.sortie);
    if (holder.innerHTML) attacherEcouteurSortie(btn.dataset.sortie);
  }));
  mountedContainer.querySelectorAll("[data-entree]").forEach(btn => btn.addEventListener("click", () => {
    const holder = document.getElementById(`sm-entree-form-${btn.dataset.entree}`);
    holder.innerHTML = holder.innerHTML ? "" : renderFormEntree(btn.dataset.entree);
    if (holder.innerHTML) attacherEcouteurEntree(btn.dataset.entree);
  }));
}

function renderFormSortie(produitId) {
  return `
    <div class="form-card" style="margin-top:8px;background:var(--panel-alt)">
      <h4 style="margin:0 0 10px;font-size:13px">📤 Enregistrer une sortie</h4>
      <div class="form-grid">
        <label>Quantité<input type="number" min="1" id="sm-sortie-qte-${produitId}" value="1"></label>
        <label>Attribution (centre ou MNA)
          <select id="sm-sortie-attrib-${produitId}">${attributionOptions("")}</select>
        </label>
        <label>Commentaire (optionnel)<input id="sm-sortie-comment-${produitId}" placeholder="ex. réassort mensuel"></label>
      </div>
      <button class="add-btn" data-valider-sortie="${produitId}" style="margin-top:8px">💾 Valider la sortie</button>
      <div id="sm-sortie-status-${produitId}" style="font-size:12px;margin-top:8px"></div>
    </div>
  `;
}

function attacherEcouteurSortie(produitId) {
  document.querySelector(`[data-valider-sortie="${produitId}"]`).addEventListener("click", async () => {
    const statusEl = document.getElementById(`sm-sortie-status-${produitId}`);
    const p = state.produits.find(x => x.id === produitId);
    const qte = parseInt(document.getElementById(`sm-sortie-qte-${produitId}`).value, 10);
    const attribSelect = document.getElementById(`sm-sortie-attrib-${produitId}`);
    const attribId = attribSelect.value;
    if (!qte || qte <= 0) { statusEl.innerHTML = `<span style="color:var(--red)">Quantité invalide.</span>`; return; }
    if (!attribId) { statusEl.innerHTML = `<span style="color:var(--red)">Choisis une attribution.</span>`; return; }
    const commentaire = document.getElementById(`sm-sortie-comment-${produitId}`).value.trim();
    statusEl.innerHTML = `<span style="color:var(--text-dim)">⏳ Enregistrement…</span>`;
    try {
      await enregistrerSortie(p, qte, attribId, nomAttribution(attribId), commentaire, mountedUser);
      document.getElementById(`sm-sortie-form-${produitId}`).innerHTML = "";
    } catch (e) {
      statusEl.innerHTML = `<span style="color:var(--red)">❌ ${esc(e.message || String(e))}</span>`;
    }
  });
}

function renderFormEntree(produitId) {
  return `
    <div class="form-card" style="margin-top:8px;background:var(--panel-alt)">
      <h4 style="margin:0 0 10px;font-size:13px">📥 Enregistrer une entrée (réapprovisionnement)</h4>
      <label>Quantité reçue<input type="number" min="1" id="sm-entree-qte-${produitId}" value="1" style="max-width:160px"></label>
      <button class="add-btn" data-valider-entree="${produitId}" style="margin-top:8px">💾 Valider l'entrée</button>
      <div id="sm-entree-status-${produitId}" style="font-size:12px;margin-top:8px"></div>
    </div>
  `;
}

function attacherEcouteurEntree(produitId) {
  document.querySelector(`[data-valider-entree="${produitId}"]`).addEventListener("click", async () => {
    const statusEl = document.getElementById(`sm-entree-status-${produitId}`);
    const p = state.produits.find(x => x.id === produitId);
    const qte = parseInt(document.getElementById(`sm-entree-qte-${produitId}`).value, 10);
    if (!qte || qte <= 0) { statusEl.innerHTML = `<span style="color:var(--red)">Quantité invalide.</span>`; return; }
    statusEl.innerHTML = `<span style="color:var(--text-dim)">⏳ Enregistrement…</span>`;
    try {
      await enregistrerEntree(p, qte);
      document.getElementById(`sm-entree-form-${produitId}`).innerHTML = "";
    } catch (e) {
      statusEl.innerHTML = `<span style="color:var(--red)">❌ ${esc(e.message || String(e))}</span>`;
    }
  });
}

// =================================================================
// Onglet Historique des sorties
// =================================================================
function renderHistorique(container) {
  const sorties = state.sorties.filter(s => {
    if (s.zone !== ui.zone) return false;
    if (ui.filtreAttribution !== "toutes" && s.attributionId !== ui.filtreAttribution) return false;
    if (ui.filtreCategorie !== "toutes" && s.categorie !== ui.filtreCategorie) return false;
    return true;
  });

  container.innerHTML = `
    <div class="filters-row" style="flex-wrap:wrap;gap:8px;margin:10px 0">
      <select id="sm-hist-attrib">
        <option value="toutes">Toutes attributions</option>
        ${attributionOptions(ui.filtreAttribution === "toutes" ? "" : ui.filtreAttribution)}
      </select>
      <select id="sm-hist-cat">
        <option value="toutes">Toutes catégories</option>
        ${CATEGORIES_MENAGE.map(c => `<option value="${esc(c)}" ${ui.filtreCategorie === c ? "selected" : ""}>${esc(c)}</option>`).join("")}
      </select>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Date</th><th>Produit</th><th>Quantité</th><th>Attribution</th><th>Commentaire</th><th>Par</th></tr></thead>
        <tbody>
          ${sorties.length === 0 ? `<tr><td colspan="6" class="empty-row">Aucune sortie pour ces filtres.</td></tr>` :
            sorties.map(s => `
              <tr>
                <td>${new Date(s.date).toLocaleDateString("fr-FR")}</td>
                <td>${esc(s.produitNom)}</td>
                <td>${s.quantite} ${esc(s.unite || "")}</td>
                <td>${s.attributionId === MNA_ID ? "👥 " : "🏢 "}${esc(s.attributionNom)}</td>
                <td>${esc(s.commentaire || "")}</td>
                <td>${esc(s.creePar || "")}</td>
              </tr>
            `).join("")}
        </tbody>
      </table>
    </div>
  `;

  document.getElementById("sm-hist-attrib").addEventListener("change", (e) => { ui.filtreAttribution = e.target.value || "toutes"; render(); });
  document.getElementById("sm-hist-cat").addEventListener("change", (e) => { ui.filtreCategorie = e.target.value; render(); });
}

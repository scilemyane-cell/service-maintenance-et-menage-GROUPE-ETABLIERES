// stock-sites.js
// Vue centralisée (onglet "Sites" du module Stock maintenance) : tous les
// sites ayant un stock déporté activé, avec leurs articles, quantités et
// seuils d'alerte, gérables au même endroit sans avoir à ouvrir chaque
// dossier de site un par un.

import { esc } from "./astreinte-logic.js";
import {
  listerSitesAvecStockDeporte, listerTousLesArticlesSite,
  modifierArticleSite, supprimerArticleSite,
} from "./stock-site-data.js";

let mountedContainer = null;
let state = { sites: [], items: [], loading: true };

export async function mountStockSites(container) {
  mountedContainer = container;
  state = { sites: [], items: [], loading: true };
  container.innerHTML = `<div class="hint">Chargement…</div>`;
  await load();
}

async function load() {
  const [sites, items] = await Promise.all([
    listerSitesAvecStockDeporte(),
    listerTousLesArticlesSite(),
  ]);
  state.sites = sites;
  state.items = items;
  state.loading = false;
  render();
}

function render() {
  if (!mountedContainer) return;
  if (!document.contains(mountedContainer)) return;

  const alertesTotal = state.items.filter(it => (it.quantite ?? 0) <= (it.seuilMin ?? 0)).length;

  mountedContainer.innerHTML = `
    <div class="stack">
      <p class="hint">Stock gardé localement sur chaque site (indépendant du stock central), activable depuis la fiche d'un dossier de site ("📦 Ce site a un stock déporté").</p>
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
                <thead><tr><th>Article</th><th>Origine</th><th>Quantité</th><th>Seuil min.</th><th></th></tr></thead>
                <tbody>
                  ${items.map(it => `
                    <tr>
                      <td>${esc(it.nom)}</td>
                      <td style="font-size:11px;color:var(--text-dim)">${it.produitId ? "Catalogue central" : "Propre au site"}</td>
                      <td><input type="number" min="0" step="1" value="${it.quantite ?? 0}" data-qte="${it.id}" style="width:70px;${(it.quantite ?? 0) <= (it.seuilMin ?? 0) ? 'color:var(--red);font-weight:700' : ''}"> ${esc(it.unite || "")}</td>
                      <td><input type="number" min="0" step="1" value="${it.seuilMin ?? 0}" data-seuil="${it.id}" style="width:70px"></td>
                      <td><button class="del-btn" data-del="${it.id}" style="padding:4px 8px;font-size:11px">🗑️</button></td>
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

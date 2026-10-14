// stock-sites-devis.js
// Demande de devis pour la mise en place / le réassort du stock déporté,
// RÉCAPITULÉE PAR FOURNISSEUR : les quantités manquantes de tous les
// sites sont additionnées par produit, puis rangées sous le fournisseur
// du produit — le même que dans le Stock maintenance (fiche produit du
// stock central), ou celui choisi dans le Catalogue sites. Un email de
// demande de devis (Outlook) et une version imprimable par fournisseur.

import { esc } from "./astreinte-logic.js";
import { listerSitesAvecStockDeporte, listerTousLesArticlesSite, listerCatalogueSite, listerCatalogueCentral, trierArticlesSite } from "./stock-site-data.js";
import { listerFournisseurs } from "./fournisseurs-data.js";

let mountedContainer = null;
let state = { sites: [], items: [], fournisseurs: [], catalogueSite: [], central: [] };
let ui = { base: "manquant", repartition: true, exclus: new Set(), ouverts: new Set() };

export async function mountStockSitesDevis(container) {
  mountedContainer = container;
  ui = { base: "manquant", repartition: true, exclus: new Set(), ouverts: new Set() };
  container.innerHTML = `<div class="hint">Chargement…</div>`;
  try {
    const [sites, items, fournisseurs, catalogueSite, central] = await Promise.all([
      listerSitesAvecStockDeporte(), listerTousLesArticlesSite(), listerFournisseurs().catch(() => []),
      listerCatalogueSite().catch(() => []), listerCatalogueCentral().catch(() => []),
    ]);
    state = { sites, items, fournisseurs, catalogueSite, central };
  } catch (e) {
    container.innerHTML = `<p class="hint" style="color:var(--red)">❌ ${esc(e.message || String(e))}</p>`;
    return;
  }
  render();
}

const cle = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
// Nom de site sans l'adresse mail entre parenthèses.
const nomCourt = (s) => String(s || "").replace(/\s*\(.*?\)\s*/g, " ").trim() || s;

// Fournisseur d'un article de site : celui du produit du stock central
// (même produit, ou même nom), sinon celui choisi dans le Catalogue sites.
function fournisseurDe(it) {
  const central = it.catalogueOrigine === "central"
    ? state.central.find(p => p.id === it.produitId)
    : state.central.find(p => cle(p.nom) === cle(it.nom));
  const typeSite = it.catalogueOrigine !== "central" && it.produitId ? state.catalogueSite.find(p => p.id === it.produitId) : null;
  const src = [typeSite, central].find(p => p && (p.fournisseurId || p.fournisseurNom)) || null;
  if (!src) return { cle: "__aucun__", nom: "Fournisseur non renseigné", email: "", fournisseurId: null };
  const fiche = state.fournisseurs.find(f => f.id === src.fournisseurId) || state.fournisseurs.find(f => cle(f.nom) === cle(src.fournisseurNom));
  return {
    cle: fiche?.id || cle(src.fournisseurNom) || "__aucun__",
    nom: fiche?.nom || src.fournisseurNom || "Fournisseur",
    email: fiche?.email || src.fournisseurEmail || "",
    fournisseurId: fiche?.id || null,
    ref: (central || typeSite)?.refFournisseur || "",
  };
}

function quantitePour(it) {
  const cible = it.quantiteCible ?? 0;
  return ui.base === "cible" ? cible : Math.max(0, cible - (it.quantite ?? 0));
}

// { fournisseur, lignes: [{ nom, unite, ref, total, sites:[{nom, quantite}] }] } par fournisseur.
function groupes() {
  const actifs = new Set(state.sites.filter(s => !ui.exclus.has(s.id)).map(s => s.id));
  const nomSite = new Map(state.sites.map(s => [s.id, nomCourt(s.nom)]));
  const parFour = new Map();
  [...state.items].sort(trierArticlesSite).forEach(it => {
    if (!actifs.has(it.dossierId)) return;
    const q = quantitePour(it);
    if (q <= 0) return;
    const f = fournisseurDe(it);
    if (!parFour.has(f.cle)) parFour.set(f.cle, { fournisseur: f, produits: new Map() });
    const g = parFour.get(f.cle);
    const k = it.produitId || `nom:${cle(it.nom)}`;
    if (!g.produits.has(k)) g.produits.set(k, { nom: it.nom || "—", unite: it.unite || "pièce", ref: f.ref, total: 0, sites: [] });
    const l = g.produits.get(k);
    l.total += q;
    l.sites.push({ nom: nomSite.get(it.dossierId) || "Site", quantite: q });
  });
  return [...parFour.values()]
    .map(g => ({ fournisseur: g.fournisseur, lignes: [...g.produits.values()] }))
    .sort((a, b) => (a.fournisseur.cle === "__aucun__") - (b.fournisseur.cle === "__aucun__") || a.fournisseur.nom.localeCompare(b.fournisseur.nom, "fr"));
}

function texteDevis(g) {
  const fiche = state.fournisseurs.find(f => f.id === g.fournisseur.fournisseurId);
  const intro = fiche?.messageDevis?.trim()
    || "Bonjour,\n\nDans le cadre de la mise en place de stocks sur nos sites, merci de nous transmettre un devis pour les produits suivants :";
  const lignes = g.lignes.map(l => `- ${l.nom}${l.ref ? ` (réf. ${l.ref})` : ""} : ${l.total} ${l.unite}`).join("\n");
  const rep = ui.repartition
    ? "\n\nRépartition par site :\n" + g.lignes.map(l => `- ${l.nom} : ${l.sites.map(s => `${s.nom} ${s.quantite}`).join(", ")}`).join("\n")
    : "";
  return `${intro}\n\n${lignes}${rep}\n\nCordialement,`;
}

function lienOutlook(g) {
  const params = [
    ["to", g.fournisseur.email],
    ["subject", "Demande de devis — stocks déportés (sites)"],
    ["body", texteDevis(g)],
  ].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
  return `https://outlook.office.com/mail/deeplink/compose?${params}`;
}

function render() {
  if (!mountedContainer || !document.contains(mountedContainer)) return;
  const gs = groupes();
  const actifs = state.sites.filter(s => !ui.exclus.has(s.id));

  mountedContainer.innerHTML = `
    <div class="stack">
      <p class="hint">Récap par fournisseur de ce qu'il faut pour les stocks des sites. Le fournisseur est celui du produit dans le <b>Stock maintenance</b> (même produit ou même nom) ; à défaut, celui choisi dans le <b>Catalogue sites</b>.</p>
      <div class="form-card" style="display:flex;flex-wrap:wrap;gap:10px 18px;align-items:center">
        <label style="display:flex;align-items:center;gap:6px;font-size:13px">Quantités
          <select id="sdv-base">
            <option value="manquant" ${ui.base === "manquant" ? "selected" : ""}>Ce qui manque (cible − stock)</option>
            <option value="cible" ${ui.base === "cible" ? "selected" : ""}>Quantités cibles complètes</option>
          </select>
        </label>
        <label style="display:flex;align-items:center;gap:6px;font-size:13px"><input type="checkbox" id="sdv-repartition" ${ui.repartition ? "checked" : ""}> Répartition par site</label>
        <details id="sdv-sites" ${ui.sitesOuvert ? "open" : ""}>
          <summary style="cursor:pointer;font-size:13px">Sites inclus (${actifs.length}/${state.sites.length})</summary>
          <div style="display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:8px">
            ${state.sites.map(s => `<label style="display:flex;align-items:center;gap:5px;font-size:12px"><input type="checkbox" data-site="${s.id}" ${ui.exclus.has(s.id) ? "" : "checked"}> ${esc(nomCourt(s.nom))}</label>`).join("")}
          </div>
        </details>
      </div>

      ${gs.length === 0 ? `<div class="stat-chip ok" style="width:fit-content">✓ Rien à demander pour les sites sélectionnés</div>` : `
        <div class="sdv-recap">
          ${gs.map((g, i) => `<span class="sdv-pastille ${g.fournisseur.cle === "__aucun__" ? "rouge" : ""}">${esc(g.fournisseur.nom)} · <b>${g.lignes.length}</b> produit(s) · <b>${g.lignes.reduce((s, l) => s + l.total, 0)}</b> u.</span>`).join("")}
        </div>
        ${gs.map((g, gi) => {
          const sans = g.fournisseur.cle === "__aucun__";
          const total = g.lignes.reduce((s, l) => s + l.total, 0);
          return `
          <div class="form-card sdv-four ${sans ? "sdv-sans" : ""}">
            <div class="sdv-four-tete">
              <div>
                <h3>🏭 ${esc(g.fournisseur.nom)}</h3>
                <small>${g.fournisseur.email ? esc(g.fournisseur.email) + " · " : ""}${g.lignes.length} produit(s) · ${total} unité(s)</small>
              </div>
              <div style="display:flex;gap:8px;flex-wrap:wrap">
                ${sans ? `<span class="hint" style="color:var(--red);margin:0">Associe ces produits à un fournisseur dans « Catalogue sites » ou dans le Stock maintenance</span>`
                  : g.fournisseur.email ? `<a class="add-btn" href="${lienOutlook(g)}" target="_blank" rel="noopener" style="text-decoration:none">📧 Demander le devis</a>`
                  : `<span class="hint" style="color:var(--red);margin:0">Email manquant (onglet Fournisseurs)</span>`}
                ${sans ? "" : `<button class="nav-btn" data-copier="${gi}">📋 Copier</button>`}
                <button class="nav-btn" data-imprimer="${gi}">🖨️ Imprimer</button>
              </div>
            </div>
            <div class="table-wrap" style="border:none">
              <table>
                <thead><tr><th>Produit</th><th style="width:1%;white-space:nowrap">Total</th>${ui.repartition ? "<th>Par site</th>" : ""}</tr></thead>
                <tbody>
                  ${g.lignes.map(l => `
                    <tr>
                      <td>${esc(l.nom)}${l.ref ? `<br><small style="color:var(--text-dim)">réf. ${esc(l.ref)}</small>` : ""}</td>
                      <td style="font-weight:800;white-space:nowrap;font-size:15px">${l.total} <small style="font-weight:500;color:var(--text-dim)">${esc(l.unite)}</small></td>
                      ${ui.repartition ? `<td><div class="sdv-sites">${l.sites.map(s => `<span>${esc(s.nom)} <b>${s.quantite}</b></span>`).join("")}</div></td>` : ""}
                    </tr>`).join("")}
                </tbody>
              </table>
            </div>
          </div>`;
        }).join("")}
      `}
    </div>
  `;

  const $ = (id) => document.getElementById(id);
  $("sdv-base").addEventListener("change", (e) => { ui.base = e.target.value; render(); });
  $("sdv-repartition").addEventListener("change", (e) => { ui.repartition = e.target.checked; render(); });
  $("sdv-sites").addEventListener("toggle", (e) => { ui.sitesOuvert = e.target.open; });
  mountedContainer.querySelectorAll("[data-site]").forEach(cb => cb.addEventListener("change", () => {
    if (cb.checked) ui.exclus.delete(cb.dataset.site); else ui.exclus.add(cb.dataset.site);
    render();
  }));
  mountedContainer.querySelectorAll("[data-copier]").forEach(b => b.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(texteDevis(gs[+b.dataset.copier])); window.toast?.("Texte copié"); }
    catch { window.toast?.("Copie impossible — utilise Imprimer"); }
  }));
  mountedContainer.querySelectorAll("[data-imprimer]").forEach(b => b.addEventListener("click", () => imprimer(gs[+b.dataset.imprimer])));
}

function imprimer(g) {
  const w = window.open("", "_blank");
  if (!w) { window.toast?.("Autorise les fenêtres pop-up pour imprimer"); return; }
  w.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Demande de devis — ${esc(g.fournisseur.nom)}</title>
    <style>body{font-family:Arial,sans-serif;font-size:12px;color:#111;margin:24px}h1{font-size:18px;margin:0 0 4px}p{margin:2px 0}
    table{width:100%;border-collapse:collapse;margin-top:14px}th,td{border:1px solid #bbb;padding:5px 7px;text-align:left;vertical-align:top}
    th{background:#eee}td.n{white-space:nowrap;font-weight:bold}.s{font-size:11px;color:#444}</style></head><body>
    <h1>Demande de devis — stocks déportés</h1>
    <p>Groupe Établières · Service maintenance · ${new Date().toLocaleDateString("fr-FR")}</p>
    <p>Fournisseur : <b>${esc(g.fournisseur.nom)}</b> ${esc(g.fournisseur.email)}</p>
    <table><thead><tr><th>Produit</th><th>Réf.</th><th>Quantité</th>${ui.repartition ? "<th>Répartition par site</th>" : ""}</tr></thead><tbody>
    ${g.lignes.map(l => `<tr><td>${esc(l.nom)}</td><td>${esc(l.ref || "")}</td><td class="n">${l.total} ${esc(l.unite)}</td>${ui.repartition ? `<td class="s">${l.sites.map(s => `${esc(s.nom)} : ${s.quantite}`).join("<br>")}</td>` : ""}</tr>`).join("")}
    </tbody></table></body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
}

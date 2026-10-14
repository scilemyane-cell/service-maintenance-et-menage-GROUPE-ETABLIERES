// stock-sites-devis.js
// Demande de devis GLOBALE pour la mise en place / le réassort du stock
// déporté : additionne, tous sites confondus, ce qu'il manque sur chaque
// site (quantité cible − quantité actuelle) et prépare un seul email de
// demande de devis (Outlook), avec la répartition par site, ainsi qu'une
// version imprimable / PDF.

import { esc } from "./astreinte-logic.js";
import { listerSitesAvecStockDeporte, listerTousLesArticlesSite, trierArticlesSite } from "./stock-site-data.js";
import { listerFournisseurs } from "./fournisseurs-data.js";

let mountedContainer = null;
let state = { sites: [], items: [], fournisseurs: [] };
let ui = { base: "manquant", repartition: true, fournisseurId: "", email: "", exclus: new Set() };

export async function mountStockSitesDevis(container) {
  mountedContainer = container;
  ui = { base: "manquant", repartition: true, fournisseurId: "", email: "", exclus: new Set() };
  container.innerHTML = `<div class="hint">Chargement…</div>`;
  try {
    const [sites, items, fournisseurs] = await Promise.all([
      listerSitesAvecStockDeporte(), listerTousLesArticlesSite(), listerFournisseurs().catch(() => []),
    ]);
    state = { sites, items, fournisseurs };
  } catch (e) {
    container.innerHTML = `<p class="hint" style="color:var(--red)">❌ ${esc(e.message || String(e))}</p>`;
    return;
  }
  render();
}

// Quantité demandée pour un article d'un site, selon la base choisie.
function quantitePour(it) {
  const cible = it.quantiteCible ?? 0;
  return ui.base === "cible" ? cible : Math.max(0, cible - (it.quantite ?? 0));
}

// Regroupe les articles de tous les sites par produit (même produit de la
// liste type / du catalogue central, sinon même nom), dans l'ordre de la
// liste type.
function lignesGlobales() {
  const sitesIds = new Set(state.sites.filter(s => !ui.exclus.has(s.id)).map(s => s.id));
  const nomSite = new Map(state.sites.map(s => [s.id, s.nom]));
  const parProduit = new Map();
  [...state.items].sort(trierArticlesSite).forEach(it => {
    if (!sitesIds.has(it.dossierId)) return;
    const q = quantitePour(it);
    if (q <= 0) return;
    const cle = it.produitId || `nom:${(it.nom || "").trim().toLowerCase()}`;
    if (!parProduit.has(cle)) parProduit.set(cle, { nom: it.nom || "—", unite: it.unite || "pièce", total: 0, sites: [] });
    const l = parProduit.get(cle);
    l.total += q;
    l.sites.push({ nom: nomSite.get(it.dossierId) || "Site", quantite: q });
  });
  return [...parProduit.values()];
}

function texteDevis(lignes) {
  const fournisseur = state.fournisseurs.find(f => f.id === ui.fournisseurId);
  const intro = fournisseur?.messageDevis?.trim()
    || "Bonjour,\n\nDans le cadre de la mise en place de stocks déportés sur nos sites, merci de nous transmettre un devis pour les produits suivants :";
  const total = lignes.map(l => `- ${l.nom} : ${l.total} ${l.unite}`).join("\n");
  const repartition = ui.repartition
    ? "\n\nRépartition par site (pour information / livraison) :\n" + lignes.map(l => `- ${l.nom} : ${l.sites.map(s => `${s.nom} ${s.quantite}`).join(", ")}`).join("\n")
    : "";
  return `${intro}\n\n${total}${repartition}\n\nCordialement,`;
}

function lienOutlook(lignes) {
  const params = [
    ["to", ui.email],
    ["subject", "Demande de devis — mise en place des stocks déportés (sites)"],
    ["body", texteDevis(lignes)],
  ].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
  return `https://outlook.office.com/mail/deeplink/compose?${params}`;
}

function render() {
  if (!mountedContainer || !document.contains(mountedContainer)) return;
  const lignes = lignesGlobales();
  const totalArticles = lignes.reduce((s, l) => s + l.total, 0);
  const sitesActifs = state.sites.filter(s => !ui.exclus.has(s.id));

  mountedContainer.innerHTML = `
    <div class="stack">
      <p class="hint">Demande de devis unique, tous sites confondus : les quantités manquantes de chaque site sont additionnées par produit. Choisis le fournisseur, vérifie la liste, puis ouvre l'email prêt à envoyer ou imprime la demande.</p>

      <div class="form-card">
        <div class="form-grid">
          <label>Fournisseur
            <select id="sdv-fournisseur">
              <option value="">— Choisir (ou saisir l'email) —</option>
              ${state.fournisseurs.map(f => `<option value="${f.id}" ${f.id === ui.fournisseurId ? "selected" : ""}>${esc(f.nom || "")}</option>`).join("")}
            </select>
          </label>
          <label>Email<input id="sdv-email" type="email" value="${esc(ui.email)}" placeholder="contact@fournisseur.fr"></label>
          <label>Quantités demandées
            <select id="sdv-base">
              <option value="manquant" ${ui.base === "manquant" ? "selected" : ""}>Ce qui manque (cible − stock actuel)</option>
              <option value="cible" ${ui.base === "cible" ? "selected" : ""}>Quantités cibles complètes</option>
            </select>
          </label>
        </div>
        <label style="display:flex;align-items:center;gap:6px;font-size:13px;margin:8px 0">
          <input type="checkbox" id="sdv-repartition" ${ui.repartition ? "checked" : ""}> Joindre la répartition par site
        </label>
        <details style="margin:4px 0 10px">
          <summary style="cursor:pointer;font-size:13px">Sites inclus (${sitesActifs.length}/${state.sites.length})</summary>
          <div style="display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:8px">
            ${state.sites.map(s => `<label style="display:flex;align-items:center;gap:5px;font-size:12px"><input type="checkbox" data-site="${s.id}" ${ui.exclus.has(s.id) ? "" : "checked"}> ${esc(s.nom)}</label>`).join("")}
          </div>
        </details>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          ${lignes.length === 0 ? "" : ui.email
            ? `<a class="add-btn" href="${lienOutlook(lignes)}" target="_blank" rel="noopener" style="text-decoration:none">📧 Ouvrir dans Outlook</a>`
            : `<span class="hint" style="color:var(--red);margin:0">Renseigne l'email du fournisseur</span>`}
          ${lignes.length ? `<button class="nav-btn" id="sdv-copier">📋 Copier le texte</button>
          <button class="nav-btn" id="sdv-imprimer">🖨️ Imprimer / PDF</button>` : ""}
        </div>
      </div>

      ${lignes.length === 0 ? `<div class="stat-chip ok" style="width:fit-content">✓ Rien à demander pour les sites sélectionnés</div>` : `
        <div class="stat-chip warn" style="width:fit-content">${lignes.length} produit(s) · ${totalArticles} unité(s) · ${sitesActifs.length} site(s)</div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Produit</th><th>Total</th><th>Répartition par site</th></tr></thead>
            <tbody>
              ${lignes.map(l => `
                <tr>
                  <td>${esc(l.nom)}</td>
                  <td style="font-weight:700;white-space:nowrap">${l.total} ${esc(l.unite)}</td>
                  <td style="font-size:12px;color:var(--text-dim)">${l.sites.map(s => `${esc(s.nom)} <b>${s.quantite}</b>`).join(" · ")}</td>
                </tr>`).join("")}
            </tbody>
          </table>
        </div>
      `}
    </div>
  `;

  const $ = (id) => document.getElementById(id);
  $("sdv-fournisseur").addEventListener("change", (e) => {
    ui.fournisseurId = e.target.value;
    const f = state.fournisseurs.find(x => x.id === ui.fournisseurId);
    if (f) ui.email = f.email || "";
    render();
  });
  $("sdv-email").addEventListener("change", (e) => { ui.email = e.target.value.trim(); render(); });
  $("sdv-base").addEventListener("change", (e) => { ui.base = e.target.value; render(); });
  $("sdv-repartition").addEventListener("change", (e) => { ui.repartition = e.target.checked; render(); });
  mountedContainer.querySelectorAll("[data-site]").forEach(cb => cb.addEventListener("change", () => {
    if (cb.checked) ui.exclus.delete(cb.dataset.site); else ui.exclus.add(cb.dataset.site);
    render();
    mountedContainer.querySelector("details")?.setAttribute("open", "");
  }));
  $("sdv-copier")?.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(texteDevis(lignes)); window.toast?.("Texte copié"); }
    catch { window.toast?.("Copie impossible — utilise Imprimer / PDF"); }
  });
  $("sdv-imprimer")?.addEventListener("click", () => imprimer(lignes));
}

function imprimer(lignes) {
  const fournisseur = state.fournisseurs.find(f => f.id === ui.fournisseurId);
  const w = window.open("", "_blank");
  if (!w) { window.toast?.("Autorise les fenêtres pop-up pour imprimer"); return; }
  w.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Demande de devis — stocks déportés</title>
    <style>body{font-family:Arial,sans-serif;font-size:12px;color:#111;margin:24px}h1{font-size:18px;margin:0 0 4px}p{margin:2px 0}
    table{width:100%;border-collapse:collapse;margin-top:14px}th,td{border:1px solid #bbb;padding:5px 7px;text-align:left;vertical-align:top}
    th{background:#eee}td.n{white-space:nowrap;font-weight:bold}.s{font-size:11px;color:#444}</style></head><body>
    <h1>Demande de devis — mise en place des stocks déportés</h1>
    <p>Groupe Établières · Service maintenance · ${new Date().toLocaleDateString("fr-FR")}</p>
    ${fournisseur || ui.email ? `<p>Fournisseur : <b>${esc(fournisseur?.nom || "")}</b> ${esc(ui.email)}</p>` : ""}
    <table><thead><tr><th>Produit</th><th>Quantité totale</th>${ui.repartition ? "<th>Répartition par site</th>" : ""}</tr></thead><tbody>
    ${lignes.map(l => `<tr><td>${esc(l.nom)}</td><td class="n">${l.total} ${esc(l.unite)}</td>${ui.repartition ? `<td class="s">${l.sites.map(s => `${esc(s.nom)} : ${s.quantite}`).join("<br>")}</td>` : ""}</tr>`).join("")}
    </tbody></table></body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
}

// compteurs-schema.js — « Schéma des compteurs » : on dispose les compteurs en
// arbre (compteur général → sous-compteurs) et on les relie entre eux.
// Un sous-compteur est DÉDUIT de son compteur parent : la consommation
// « propre » du parent = son index − ce que mesurent ses sous-compteurs.
// Lien stocké sur le sous-compteur : compteurParentId.
import { esc } from "./astreinte-logic.js";
import { modifierCompteur, clesIndex, uniteValeur } from "./compteurs-data.js";

const ENERGIES = [
  { id: "eau", label: "Eau", icone: "💧", couleur: "#2a78d6" },
  { id: "elec", label: "Électricité", icone: "⚡", couleur: "#eda100" },
  { id: "gaz", label: "Gaz", icone: "🔥", couleur: "#eb6834" },
  { id: "chauffage", label: "Chauffage urbain", icone: "♨️", couleur: "#e87ba4" },
];
const JOUR = 86400000;
const st = { energie: null, lier: null }; // lier = id du compteur qu'on est en train de relier
const fmt = (n, d = 1) => n === null || !Number.isFinite(n) ? "—" : new Intl.NumberFormat("fr-FR", { maximumFractionDigits: d }).format(n);
const nomCourt = n => String(n || "").replace(/\S+@\S+/g, "").replace(/\s{2,}/g, " ").trim();

// Consommation entre deux dates (interpolée entre relevés, index par index).
export function calculConso(releves) {
  const parC = new Map();
  (releves || []).forEach(r => { if (r.createdAt) (parC.get(r.compteurId) || parC.set(r.compteurId, []).get(r.compteurId)).push(r); });
  parC.forEach(l => l.sort((a, b) => a.createdAt - b.createdAt));
  const cache = new Map();
  const series = (c) => {
    if (cache.has(c.id)) return cache.get(c.id);
    const out = clesIndex(c).map(k => (parC.get(c.id) || []).map(r => [r.createdAt, r.illisibles?.[k] ? NaN : parseFloat(String(r.valeurs?.[k] ?? "").replace(",", "."))]).filter(([, v]) => Number.isFinite(v)));
    cache.set(c.id, out); return out;
  };
  const interp = (pts, ms) => { for (let i = 1; i < pts.length; i++) if (ms <= pts[i][0]) { const [ta, va] = pts[i - 1], [tb, vb] = pts[i]; return tb === ta ? vb : va + (vb - va) * (ms - ta) / (tb - ta); } return pts[pts.length - 1][1]; };
  return (c, t0, t1) => {
    let tot = 0, ok = false;
    series(c).forEach(pts => { if (pts.length < 2) return; const a = Math.max(t0, pts[0][0]), b = Math.min(t1, pts[pts.length - 1][0]); if (b <= a) return; const va = interp(pts, a), vb = interp(pts, b); if (vb >= va) { tot += vb - va; ok = true; } });
    return ok ? tot : null;
  };
}

export function renderSchema(container, { compteurs, releves, peutModifier, onRetour, onOuvrirSite }) {
  const presentes = ENERGIES.filter(e => compteurs.some(c => c.type === e.id));
  if (!st.energie || !presentes.some(e => e.id === st.energie)) st.energie = (presentes[0] || ENERGIES[0]).id;
  const E = ENERGIES.find(e => e.id === st.energie);
  const liste = compteurs.filter(c => c.type === st.energie);
  const parId = new Map(liste.map(c => [c.id, c]));
  const parentDe = (c) => c.compteurParentId && parId.has(c.compteurParentId) && c.compteurParentId !== c.id ? c.compteurParentId : null;
  const enfants = (id) => liste.filter(c => parentDe(c) === id).sort((a, b) => nomCourt(a.dossierNom + a.nom).localeCompare(nomCourt(b.dossierNom + b.nom), "fr"));
  const descendants = (id, acc = new Set()) => { enfants(id).forEach(e => { if (!acc.has(e.id)) { acc.add(e.id); descendants(e.id, acc); } }); return acc; };

  // Consommation des 30 derniers jours connus (jusqu'au dernier relevé) : brute et propre.
  const conso = calculConso(releves);
  const fin = Date.now(), debut = fin - 30 * JOUR;
  const brut = (c) => conso(c, debut, fin);
  const propre = (c) => { const b = brut(c); if (b === null) return null; const s = enfants(c.id).reduce((t, e) => t + (brut(e) || 0), 0); return b - s; };
  const unite = uniteValeur({ type: st.energie });

  const carte = (c, niveau) => {
    const b = brut(c), p = enfants(c.id).length ? propre(c) : null;
    const bloque = st.lier && (st.lier === c.id || descendants(st.lier).has(c.id));
    const cible = st.lier && !bloque;
    return `<div class="sc-carte ${st.lier === c.id ? "lie" : ""} ${cible ? "cible" : ""} ${bloque && st.lier !== c.id ? "bloque" : ""}" data-sc-id="${c.id}" style="--e:${E.couleur}">
      <div class="sc-ic">${E.icone}</div>
      <div class="sc-txt"><b>${esc(c.nom || E.label)}</b><small>${esc(nomCourt(c.dossierNom))}${c.emplacement ? ` · ${esc(c.emplacement)}` : ""}</small>
        <span class="sc-conso">${b !== null ? `${fmt(b, b < 10 ? 2 : 0)} ${unite}<em> sur 30 j</em>` : `<em>pas encore de consommation</em>`}${p !== null ? ` · <span class="${p < 0 ? "neg" : "propre"}" title="Consommation propre = ce compteur moins ses sous-compteurs">propre ${fmt(p, Math.abs(p) < 10 ? 2 : 0)} ${unite}</span>` : ""}</span>
        ${p !== null && p < 0 ? `<span class="sc-alerte">⚠️ Les sous-compteurs mesurent plus que ce compteur : relevés à vérifier</span>` : ""}
      </div>
      ${peutModifier && !st.lier ? `<div class="sc-act">
        <button type="button" data-sc-lier="${c.id}" title="Relier ce compteur à celui qui l'alimente">🔗 ${parentDe(c) ? "Changer" : "Relier"}</button>
        ${parentDe(c) ? `<button type="button" data-sc-detacher="${c.id}" title="Ce compteur n'est plus un sous-compteur">✂ Détacher</button>` : ""}
      </div>` : ""}
      ${cible ? `<div class="sc-cible-txt">↳ Cliquer ici : il alimente ${esc(liste.find(x => x.id === st.lier)?.nom || "")}</div>` : ""}
    </div>`;
  };
  const arbre = (c, niveau = 0) => {
    const e = enfants(c.id);
    return `<li>${carte(c, niveau)}${e.length ? `<ul>${e.map(x => arbre(x, niveau + 1)).join("")}</ul>` : ""}</li>`;
  };
  const racines = liste.filter(c => !parentDe(c));
  const avecEnfants = racines.filter(c => enfants(c.id).length), seuls = racines.filter(c => !enfants(c.id).length);

  container.innerHTML = `
  <div class="sc">
    <div class="sc-entete">
      <button class="nav-btn" id="sc-retour">← Retour</button>
      <div><h1>🔗 Schéma des compteurs</h1><p>Qui alimente qui : un sous-compteur est déduit de son compteur général. La consommation « propre » d'un compteur = son index moins ses sous-compteurs.</p></div>
    </div>
    <div class="sc-onglets">${presentes.map(e => `<button data-sc-e="${e.id}" class="${e.id === st.energie ? "on" : ""}" style="--e:${e.couleur}">${e.icone} ${e.label} <small>${compteurs.filter(c => c.type === e.id).length}</small></button>`).join("")}</div>
    ${st.lier ? `<div class="sc-mode">🔗 <b>${esc(liste.find(x => x.id === st.lier)?.nom || "")}</b> (${esc(nomCourt(liste.find(x => x.id === st.lier)?.dossierNom))}) : clique sur le compteur qui l'<b>alimente</b> (son compteur général). <button type="button" id="sc-annuler">Annuler</button></div>`
      : peutModifier ? `<p class="sc-aide">Pour relier : clique sur <b>🔗 Relier</b> sur le sous-compteur (ex. le self), puis sur le compteur général qui l'alimente (ex. le lycée).</p>` : ""}
    ${avecEnfants.length ? `<section class="sc-zone"><h3>Réseaux</h3>${avecEnfants.map(c => `<ul class="sc-arbre">${arbre(c)}</ul>`).join("")}</section>` : ""}
    ${seuls.length ? `<section class="sc-zone"><h3>${avecEnfants.length ? "Compteurs indépendants" : "Compteurs (aucun lien pour l'instant)"}</h3><div class="sc-seuls">${seuls.map(c => carte(c, 0)).join("")}</div></section>` : ""}
    ${!liste.length ? `<p class="hint">Aucun compteur de ce type.</p>` : ""}
  </div>`;

  const rerendre = () => renderSchema(container, { compteurs, releves, peutModifier, onRetour, onOuvrirSite });
  container.querySelector("#sc-retour")?.addEventListener("click", () => { st.lier = null; onRetour(); });
  container.querySelector("#sc-annuler")?.addEventListener("click", () => { st.lier = null; rerendre(); });
  container.querySelectorAll("[data-sc-e]").forEach(b => b.addEventListener("click", () => { st.energie = b.dataset.scE; st.lier = null; rerendre(); }));
  container.querySelectorAll("[data-sc-lier]").forEach(b => b.addEventListener("click", (e) => { e.stopPropagation(); st.lier = b.dataset.scLier; rerendre(); window.scrollTo({ top: 0, behavior: "smooth" }); }));
  const enregistrer = async (id, parent) => {
    try { await modifierCompteur(id, { compteurParentId: parent || null }); const c = compteurs.find(x => x.id === id); if (c) c.compteurParentId = parent || null; st.lier = null; rerendre(); window.toast?.(parent ? "✓ Compteurs reliés" : "✓ Compteur détaché"); }
    catch (err) { alert("Enregistrement impossible : " + (err?.message || err)); }
  };
  container.querySelectorAll("[data-sc-detacher]").forEach(b => b.addEventListener("click", (e) => { e.stopPropagation(); enregistrer(b.dataset.scDetacher, null); }));
  container.querySelectorAll(".sc-carte.cible").forEach(el => el.addEventListener("click", () => enregistrer(st.lier, el.dataset.scId)));
}

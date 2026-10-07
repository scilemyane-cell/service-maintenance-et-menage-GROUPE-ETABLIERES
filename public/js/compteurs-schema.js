// compteurs-schema.js — « Schéma des compteurs » : on dispose les compteurs en
// arbre (compteur général → sous-compteurs) et on les relie entre eux.
// Un sous-compteur est DÉDUIT de son compteur parent : la consommation
// « propre » du parent = son index − ce que mesurent ses sous-compteurs.
// Lien stocké sur le sous-compteur : compteurParentId.
import { esc } from "./astreinte-logic.js";
import { trierGroupes } from "./associations-data.js";
import { activerGlisserDeposer } from "./drag-reorder.js";
import { modifierCompteur, clesIndex, uniteValeur } from "./compteurs-data.js";

export const ENERGIES = [
  { id: "eau", label: "Eau", icone: "💧", couleur: "#2a78d6" },
  { id: "elec", label: "Électricité", icone: "⚡", couleur: "#eda100" },
  { id: "gaz", label: "Gaz", icone: "🔥", couleur: "#eb6834" },
  { id: "chauffage", label: "Chauffage urbain", icone: "♨️", couleur: "#e87ba4" },
];
const JOUR = 86400000;
const st = { energie: null, lier: null, assoc: "" }; // lier = id du compteur qu'on est en train de relier ; assoc = filtre association
const fmt = (n, d = 1) => n === null || !Number.isFinite(n) ? "—" : new Intl.NumberFormat("fr-FR", { maximumFractionDigits: d }).format(n);
// Toujours 2 chiffres après la virgule (ex. 15,90 · 0,20 · 477,00).
const fmt2 = (n) => n === null || !Number.isFinite(n) ? "—" : new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
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

// Réseaux d'une énergie, rangés par association puis groupe (comme les
// dossiers de site). Réutilisé par le Schéma (relier) et par Pilotage énergie
// (lecture seule, sur la période choisie).
//  conso(c, t0, t1) → consommation interpolée ; debut/fin = fenêtre mesurée.
// Compteur d'eau chaude (ECS) : mesure l'eau froide envoyée à la production
// d'eau chaude. Reconnu par son nom (« Eau chaude », « ECS ») ou le champ eauChaude.
export const estEauChaude = (c) => !!c && c.type === "eau" && (c.eauChaude === true || /eau\s*chaude|\becs\b/i.test(`${c.nom || ""} ${c.emplacement || ""}`));

// Ordre choisi par glisser-déposer (champ « ordre » du compteur), sinon alphabétique.
export const cmpCompteurs = (a, b) => (a.ordre ?? 1e9) - (b.ordre ?? 1e9) || nomCourt(a.dossierNom + a.nom).localeCompare(nomCourt(b.dossierNom + b.nom), "fr");

export function reseauxHTML({ liste, E, conso, debut, fin, sites = [], associations = [], peutModifier = false, lier = null, assoc = "", glisser = false }) {
  const jours = Math.max(1, Math.round((fin - debut) / JOUR));
  const parId = new Map(liste.map(c => [c.id, c]));
  const parentDe = (c) => c.compteurParentId && parId.has(c.compteurParentId) && c.compteurParentId !== c.id ? c.compteurParentId : null;
  const enfants = (id) => liste.filter(c => parentDe(c) === id).sort(cmpCompteurs);
  const descendants = (id, acc = new Set()) => { enfants(id).forEach(e => { if (!acc.has(e.id)) { acc.add(e.id); descendants(e.id, acc); } }); return acc; };
  const brut = (c) => conso(c, debut, fin);
  const propre = (c) => { const b = brut(c); if (b === null) return null; const s = enfants(c.id).reduce((t, e) => t + (brut(e) || 0), 0); return b - s; };
  const unite = uniteValeur({ type: E.id });

  // Cadran : le niveau = part du compteur dans le réseau, débit au centre.
  const dial = (c, part, opts = {}) => {
    const b = opts.virtuel ? opts.valeur : brut(c);
    const parJour = b === null ? null : b / jours;
    const bloque = !opts.virtuel && lier && (lier === c.id || descendants(lier).has(c.id));
    const cible = !opts.virtuel && lier && !bloque;
    const niveau = Math.max(6, Math.min(100, part ?? 55));
    const vitesse = parJour ? Math.max(0.8, 6 - Math.log10(1 + parJour) * 2.2) : 0; // plus ça coule, plus le flux va vite
    const chaude = !opts.virtuel && estEauChaude(c);
    return `<div class="sx-c ${chaude ? "chaude" : ""} ${opts.virtuel ? "virtuel" : ""} ${lier === c?.id ? "lie" : ""} ${cible ? "cible" : ""} ${bloque && lier !== c?.id ? "bloque" : ""} ${opts.alerte ? "alerte" : ""}" ${!opts.virtuel ? `data-sc-id="${c.id}"` : ""} style="--niv:${niveau}%;--v:${vitesse}s">
      <div class="sx-dial"><span class="sx-motif">${chaude ? "♨️" : E.icone}</span><div class="sx-eau"><i></i><i></i><i></i></div>
        <div class="sx-centre"><b>${parJour === null ? "—" : fmt2(parJour)}</b><small>${unite}/jour</small></div>
        ${part != null && !opts.racine ? `<span class="sx-part">${fmt(part, 0)} %</span>` : ""}</div>
      <div class="sx-nom"><b>${esc(opts.virtuel ? opts.titre : (c.nom || E.label))}</b><small>${esc(opts.virtuel ? opts.sous : nomCourt(c.dossierNom))}</small>
        ${chaude ? `<span class="sx-badge-chaude">♨️ Eau chaude produite</span>` : opts.general ? `<span class="sx-badge-general">💧 Eau froide générale</span>` : ""}
        <span class="sx-tot">${b === null ? "pas encore de mesure" : `${fmt2(b)} ${unite} sur ${jours} j`}</span>
        ${opts.alerte ? `<span class="sx-al">⚠️ ${esc(opts.alerte)}</span>` : ""}</div>
      ${!opts.virtuel && peutModifier && !lier ? `<div class="sx-act"><button type="button" data-sc-lier="${c.id}">🔗 ${parentDe(c) ? "Changer" : "Relier"}</button>${parentDe(c) ? `<button type="button" data-sc-detacher="${c.id}">✂</button>` : ""}</div>` : ""}
      ${cible ? `<div class="sx-cible">↳ alimente ${esc(liste.find(x => x.id === lier)?.nom || "")}</div>` : ""}
    </div>`;
  };
  // Réseau : compteur → tuyaux animés → sous-compteurs (+ la part « propre »), sur autant de niveaux que besoin.
  const reseau = (c, part = 100, racine = true) => {
    const e = enfants(c.id);
    if (!e.length) return dial(c, part, { racine });
    const b = brut(c), p = propre(c);
    const pc = (x) => b ? Math.max(0, Math.min(100, (x || 0) / b * 100)) : null;
    const branches = e.map(x => `<div class="sx-branche">${reseau(x, pc(brut(x)), false)}</div>`).join("")
      + `<div class="sx-branche">${dial(null, p !== null ? pc(p) : null, { virtuel: true, valeur: p !== null ? Math.max(0, p) : null, titre: `Reste consommé — ${nomCourt(c.dossierNom)}`, sous: `hors ${e.map(x => estEauChaude(x) ? "eau chaude" : nomCourt(x.dossierNom) !== nomCourt(c.dossierNom) ? nomCourt(x.dossierNom) : (x.nom || "sous-compteur")).join(", ")}`, alerte: p !== null && p < 0 ? "les sous-compteurs dépassent le général : relevés à vérifier" : "" })}</div>`;
    const debit = b ? b / jours : 0;
    return `<div class="sx-net" style="--v:${debit ? Math.max(0.8, 6 - Math.log10(1 + debit) * 2.2) : 0}s">
      <div class="sx-tete">${dial(c, part, { racine, general: E.id === "eau" && e.some(estEauChaude) })}</div>
      <div class="sx-tuyau ${debit ? "coule" : ""}"></div>
      <div class="sx-enfants">${branches}</div>
    </div>`;
  };

  // Rangement par association → groupe, d'après le site du compteur de tête.
  const siteDe = new Map(sites.map(x => [x.id, x]));
  const assocDe = (c) => siteDe.get(c.dossierId)?.association || "";
  const groupeDe = (c) => siteDe.get(c.dossierId)?.groupe || "";
  const racines = liste.filter(c => !parentDe(c));
  const nomsAssoc = [...associations.map(a => a.nom).filter(n => racines.some(c => assocDe(c) === n))];
  if (racines.some(c => !nomsAssoc.includes(assocDe(c)))) nomsAssoc.push("");
  const affichees = assoc ? nomsAssoc.filter(n => n === assoc) : nomsAssoc;
  // Une liste par association/groupe, dans l'ordre choisi ; ☰ pour glisser.
  const listes = new Map();
  const bloc = (l, cle) => {
    listes.set(cle, l);
    return `<div class="sx-liste" data-sx-liste="${esc(cle)}">${l.map((c, i) => enfants(c.id).length
      ? `<div class="sx-item sx-item-net" ${glisser ? `data-drag-index="${i}"` : ""}>${glisser ? `<span class="sx-poignee" data-drag-handle title="Glisser pour ranger">☰</span>` : ""}<div class="sx-scroll">${reseau(c)}</div></div>`
      : `<div class="sx-item" ${glisser ? `data-drag-index="${i}"` : ""}>${glisser ? `<span class="sx-poignee" data-drag-handle title="Glisser pour ranger">☰</span>` : ""}${dial(c, null, { racine: true })}</div>`).join("")}</div>`;
  };
  const tri = (l) => [...l].sort(cmpCompteurs);
  const html = affichees.map(n => {
    const l = racines.filter(c => (n ? assocDe(c) === n : !nomsAssoc.slice(0, -1).includes(assocDe(c)) || !assocDe(c)));
    const nb = l.reduce((t, c) => t + 1 + descendants(c.id).size, 0);
    const sansG = tri(l.filter(c => !groupeDe(c)));
    const groupes = trierGroupes([...new Set(l.map(groupeDe).filter(Boolean))]);
    return `<section class="sx-zone sx-assoc"><h3>🏢 ${esc(n || "Sans association")} <small>${nb} compteur${nb > 1 ? "s" : ""}</small></h3>
      ${sansG.length ? bloc(sansG, `${n}|`) : ""}
      ${groupes.map(g => `<div class="sx-groupe">${esc(g)}</div>${bloc(tri(l.filter(c => groupeDe(c) === g)), `${n}|${g}`)}`).join("")}
    </section>`;
  }).join("");
  const chips = nomsAssoc.length > 1 ? `<div class="sx-assocs">${["", ...nomsAssoc.filter(Boolean)].map(n => `<button type="button" data-sx-assoc="${esc(n)}" class="${assoc === n ? "on" : ""}">${esc(n || "Toutes")}</button>`).join("")}</div>` : "";
  return { html: html || `<p class="hint">Aucun compteur de ce type.</p>`, chips, listes };
}

export function renderSchema(container, { compteurs, releves, sites = [], associations = [], peutModifier, onRetour, onOuvrirSite }) {
  const presentes = ENERGIES.filter(e => compteurs.some(c => c.type === e.id));
  if (!st.energie || !presentes.some(e => e.id === st.energie)) st.energie = (presentes[0] || ENERGIES[0]).id;
  const E = ENERGIES.find(e => e.id === st.energie);
  const liste = compteurs.filter(c => c.type === st.energie);
  // Consommation des 30 derniers jours connus.
  const fin = Date.now(), debut = fin - 30 * JOUR;
  const r = reseauxHTML({ liste, E, conso: calculConso(releves), debut, fin, sites, associations, peutModifier, lier: st.lier, assoc: st.lier ? "" : st.assoc, glisser: peutModifier && !st.lier });

  container.innerHTML = `
  <div class="sc sx-e-${E.id}" style="--e:${E.couleur}">
    <div class="sc-entete">
      <button class="nav-btn" id="sc-retour">← Retour</button>
      <div><h1>🔗 Schéma des compteurs</h1><p>Qui alimente qui : un sous-compteur est déduit de son compteur général (sur autant de niveaux que nécessaire). La consommation « propre » d'un compteur = son index moins ses sous-compteurs. Débits sur les 30 derniers jours.</p></div>
    </div>
    <div class="sc-onglets">${presentes.map(e => `<button data-sc-e="${e.id}" class="${e.id === st.energie ? "on" : ""}" style="--e:${e.couleur}">${e.icone} ${e.label} <small>${compteurs.filter(c => c.type === e.id).length}</small></button>`).join("")}</div>
    ${st.lier ? "" : r.chips}
    ${st.lier ? `<div class="sc-mode">🔗 <b>${esc(liste.find(x => x.id === st.lier)?.nom || "")}</b> (${esc(nomCourt(liste.find(x => x.id === st.lier)?.dossierNom))}) : clique sur le compteur qui l'<b>alimente</b> (son compteur général, ou un sous-compteur). <button type="button" id="sc-annuler">Annuler</button></div>`
      : peutModifier ? `<p class="sc-aide">Pour relier : clique sur <b>🔗 Relier</b> sur le sous-compteur (ex. le self), puis sur le compteur qui l'alimente (ex. le lycée). Un sous-compteur peut lui-même avoir des sous-compteurs. Pour ranger : maintiens <b>☰</b> et fais glisser — l'ordre est repris dans Pilotage énergie.</p>` : ""}
    ${r.html}
  </div>`;

  const rerendre = () => renderSchema(container, { compteurs, releves, sites, associations, peutModifier, onRetour, onOuvrirSite });
  container.querySelector("#sc-retour")?.addEventListener("click", () => { st.lier = null; onRetour(); });
  container.querySelector("#sc-annuler")?.addEventListener("click", () => { st.lier = null; rerendre(); });
  container.querySelectorAll("[data-sc-e]").forEach(b => b.addEventListener("click", () => { st.energie = b.dataset.scE; st.lier = null; rerendre(); }));
  container.querySelectorAll("[data-sx-assoc]").forEach(b => b.addEventListener("click", () => { st.assoc = b.dataset.sxAssoc; rerendre(); }));
  container.querySelectorAll("[data-sc-lier]").forEach(b => b.addEventListener("click", (e) => { e.stopPropagation(); st.lier = b.dataset.scLier; rerendre(); window.scrollTo({ top: 0, behavior: "smooth" }); }));
  const enregistrer = async (id, parent) => {
    try { await modifierCompteur(id, { compteurParentId: parent || null }); const c = compteurs.find(x => x.id === id); if (c) c.compteurParentId = parent || null; st.lier = null; rerendre(); window.toast?.(parent ? "✓ Compteurs reliés" : "✓ Compteur détaché"); }
    catch (err) { alert("Enregistrement impossible : " + (err?.message || err)); }
  };
  container.querySelectorAll("[data-sc-detacher]").forEach(b => b.addEventListener("click", (e) => { e.stopPropagation(); enregistrer(b.dataset.scDetacher, null); }));
  container.querySelectorAll(".sx-c.cible").forEach(el => el.addEventListener("click", () => enregistrer(st.lier, el.dataset.scId)));
  // Rangement par glisser-déposer, dans chaque association/groupe.
  if (peutModifier && !st.lier) container.querySelectorAll("[data-sx-liste]").forEach(el => {
    const l = r.listes.get(el.dataset.sxListe); if (!l) return;
    activerGlisserDeposer(el, ":scope > [data-drag-index]", async (nouvelOrdre) => {
      const ordonnes = nouvelOrdre.map(i => l[i]);
      try {
        for (let i = 0; i < ordonnes.length; i++) if (ordonnes[i].ordre !== i) { await modifierCompteur(ordonnes[i].id, { ordre: i }); ordonnes[i].ordre = i; }
        ordonnes.forEach((c, i) => { c.ordre = i; });
        el.querySelectorAll(":scope > [data-drag-index]").forEach((it, i) => { it.dataset.dragIndex = i; });
        l.splice(0, l.length, ...ordonnes);
      } catch (err) { alert("Enregistrement de l'ordre impossible : " + (err?.message || err)); }
    });
  });
}

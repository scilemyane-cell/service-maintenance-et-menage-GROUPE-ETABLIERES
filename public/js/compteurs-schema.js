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
  const f = (c, t0, t1) => {
    let tot = 0, ok = false;
    series(c).forEach(pts => { if (pts.length < 2) return; const a = Math.max(t0, pts[0][0]), b = Math.min(t1, pts[pts.length - 1][0]); if (b <= a) return; const va = interp(pts, a), vb = interp(pts, b); if (vb >= va) { tot += vb - va; ok = true; } });
    return ok ? tot : null;
  };
  // Débit moyen par jour sur la fenêtre [t0, t1], mesuré sur la partie de la
  // fenêtre couverte par les relevés ; si les relevés sont tous plus anciens,
  // on prend le dernier intervalle mesuré (relevés mensuels).
  f.taux = (c, t0, t1) => {
    let tot = 0, ok = false;
    series(c).forEach(pts => {
      if (pts.length < 2) return;
      let a = Math.max(t0, pts[0][0]), b = Math.min(t1, pts[pts.length - 1][0]);
      if (b - a < 86400000) { a = pts[pts.length - 2][0]; b = pts[pts.length - 1][0]; }
      if (b <= a) return;
      const va = interp(pts, a), vb = interp(pts, b);
      if (vb >= va) { tot += (vb - va) / ((b - a) / 86400000); ok = true; }
    });
    return ok ? tot : null;
  };
  f.nb = (c) => Math.max(0, ...series(c).map(p => p.length));
  return f;
}

// Réseaux d'une énergie, rangés par association puis groupe (comme les
// dossiers de site). Réutilisé par le Schéma (relier) et par Pilotage énergie
// (lecture seule, sur la période choisie).
//  conso(c, t0, t1) → consommation interpolée ; debut/fin = fenêtre mesurée.
// Compteur d'eau chaude (ECS) : mesure l'eau froide envoyée à la production
// d'eau chaude. Reconnu par son nom (« Eau chaude », « ECS ») ou le champ eauChaude.
export const estEauChaude = (c) => !!c && c.type === "eau" && (c.eauChaude === true || /eau\s*chaude|\becs\b/i.test(`${c.nom || ""} ${c.emplacement || ""}`));

// Sous-compteur DÉDUIT du compteur au-dessus (cas normal) ou seulement pour
// INFO (ex. eau chaude : c'est de l'eau que le site consomme quand même).
// Par défaut, l'eau chaude n'est pas déduite ; réglable compteur par compteur.
export const estDeduit = (c) => c.nonDeduit === true ? false : c.nonDeduit === false ? true : !estEauChaude(c);

// Ordre choisi par glisser-déposer (champ « ordre » du compteur), sinon alphabétique.
const lgt = (c) => String(c.logement || "").trim();
export const cmpCompteurs = (a, b) => (a.ordre ?? 1e9) - (b.ordre ?? 1e9) || (!lgt(a) !== !lgt(b) ? (lgt(a) ? 1 : -1) : 0) || (lgt(a) && lgt(b) ? lgt(a).localeCompare(lgt(b), "fr", { numeric: true }) : 0) || nomCourt(a.dossierNom + " " + a.nom).localeCompare(nomCourt(b.dossierNom + " " + b.nom), "fr", { numeric: true });

// Une eau chaude placée AU-DESSUS d'un compteur d'eau froide (branchement à
// l'envers) est traitée comme étant dessous, en « pour info » (copie, sans écrire).
export function normaliserEauChaude(liste) {
  const m = new Map(liste.map(c => [c.id, c]));
  const inv = liste.filter(c => !estEauChaude(c) && estEauChaude(m.get(c.compteurParentId)));
  if (!inv.length) return liste;
  const l2 = liste.map(c => ({ ...c }));
  const m2 = new Map(l2.map(c => [c.id, c]));
  inv.forEach(({ id }) => {
    const c = m2.get(id), ec = m2.get(c.compteurParentId); if (!ec || ec.compteurParentId === c.id) return;
    c.compteurParentId = ec.compteurParentId && ec.compteurParentId !== c.id ? ec.compteurParentId : null; c.nonDeduit = null;
    ec.compteurParentId = c.id; ec.nonDeduit = true;
  });
  return l2;
}

export function reseauxHTML({ liste, E, conso, debut, fin, sites = [], associations = [], peutModifier = false, lier = null, assoc = "", glisser = false }) {
  liste = normaliserEauChaude(liste);;
    }
  }
  const jours = Math.max(1, Math.round((fin - debut) / JOUR));
  const parId = new Map(liste.map(c => [c.id, c]));
  const parentDe = (c) => c.compteurParentId && parId.has(c.compteurParentId) && c.compteurParentId !== c.id ? c.compteurParentId : null;
  const enfants = (id) => liste.filter(c => parentDe(c) === id).sort(cmpCompteurs);
  const descendants = (id, acc = new Set()) => { enfants(id).forEach(e => { if (!acc.has(e.id)) { acc.add(e.id); descendants(e.id, acc); } }); return acc; };
  // Liste « Alimenté par » : aucun (compteur général) ou un autre compteur de
  // la même énergie (jamais lui-même ni un de ses sous-compteurs : pas de boucle).
  const libC = (x) => `${nomCourt(x.dossierNom)} — ${x.logement ? `Logt ${x.logement} · ` : ""}${x.nom || E.label}`;
  const optionsParent = (c) => {
    const interdits = descendants(c.id); interdits.add(c.id);
    const possibles = liste.filter(x => !interdits.has(x.id) && (estEauChaude(c) || !estEauChaude(x))).sort(cmpCompteurs); // une eau chaude n'alimente pas l'eau froide
    const meme = possibles.filter(x => x.dossierId === c.dossierId), autres = possibles.filter(x => x.dossierId !== c.dossierId);
    const opt = (x) => `<option value="${x.id}" ${parentDe(c) === x.id ? "selected" : ""}>${esc(libC(x))}</option>`;
    return `<option value="">— Personne (compteur général)</option>`
      + (meme.length ? `<optgroup label="${esc(nomCourt(c.dossierNom) || "Même site")}">${meme.map(opt).join("")}</optgroup>` : "")
      + [...new Set(autres.map(x => x.dossierNom))].map(n => `<optgroup label="${esc(nomCourt(n))}">${autres.filter(x => x.dossierNom === n).map(opt).join("")}</optgroup>`).join("");
  };
  // Débit par jour × nombre de jours de la fenêtre (une fenêtre partiellement
  // couverte par les relevés n'est plus sous-estimée) ; sinon conso brute.
  const brut = (c) => { if (conso.taux) { const t = conso.taux(c, debut, fin); return t === null ? null : t * jours; } return conso(c, debut, fin); };
  const pasDeMesure = (c) => { const n = conso.nb ? conso.nb(c) : null; return n === 0 ? "aucun relevé" : n === 1 ? "1 seul relevé — il en faut 2" : "pas encore de mesure"; };
  const propre = (c) => { const b = brut(c); if (b === null) return null; const s = enfants(c.id).filter(estDeduit).reduce((t, e) => t + (brut(e) || 0), 0); return b - s; };
  const unite = uniteValeur({ type: E.id });

  // Carte d'un compteur dans l'arbre : nom, site, total, débit/jour et son
  // rôle (général, déduit, pour info). Réglages : en cliquant dessus.
  const noeud = (c, opts = {}) => {
    const b = opts.virtuel ? opts.valeur : brut(c);
    const parJour = b === null ? null : b / jours;
    const chaude = !opts.virtuel && estEauChaude(c);
    const aParent = !opts.virtuel && parentDe(c);
    const info = aParent && !estDeduit(c);
    const bloque = !opts.virtuel && lier && (lier === c.id || descendants(lier).has(c.id));
    const cible = !opts.virtuel && lier && !bloque;
    const role = opts.virtuel ? `<span class="sx-r reste">= Reste (calcul)</span>`
      : chaude ? `<span class="sx-r chaude">♨️ Eau chaude${info ? " · pour info" : " · déduite"}</span>`
      : info ? `<span class="sx-r info">ℹ️ Pour info · non déduit</span>`
      : aParent ? `<span class="sx-r deduit">− Déduit</span>`
      : enfants(c.id).length ? `<span class="sx-r general">🔝 Compteur général</span>` : "";
    const niveau = opts.part == null ? null : Math.max(0, Math.min(100, opts.part));
    return `<div class="sx-n ${chaude ? "chaude" : ""} ${opts.virtuel ? "virtuel" : ""} ${info ? "info" : ""} ${!aParent && !opts.virtuel && enfants(c.id).length ? "tete" : ""} ${lier === c?.id ? "lie" : ""} ${cible ? "cible" : ""} ${bloque && lier !== c?.id ? "bloque" : ""} ${opts.alerte ? "alerte" : ""}" ${!opts.virtuel ? `data-sc-id="${c.id}" tabindex="0"` : ""}>
      <div class="sx-n-titre"><span class="sx-n-ic">${opts.virtuel ? "⚖️" : chaude ? "♨️" : E.icone}</span><b>${esc(opts.virtuel ? opts.titre : (c.nom || E.label))}</b></div>
      <small class="sx-n-site">${esc(opts.virtuel ? opts.sous : nomCourt(c.dossierNom) + (c.logement ? ` · Logt ${c.logement}` : ""))}</small>
      <div class="sx-n-val">${b === null ? `<span class="sx-n-vide">${opts.virtuel ? "un compteur n'a pas encore 2 relevés" : pasDeMesure(c)}</span>` : `<b>${fmt2(b)}</b> ${unite}<small> · ${fmt2(parJour)}/j</small>`}</div>
      ${niveau !== null ? `<div class="sx-n-barre" title="${fmt(niveau, 0)} % du compteur au-dessus"><i style="width:${niveau}%"></i><span>${fmt(niveau, 0)} %</span></div>` : ""}
      ${role}
      ${opts.alerte ? `<span class="sx-al">⚠️ ${esc(opts.alerte)}</span>` : ""}
      ${cible ? `<div class="sx-cible">↳ alimente ${esc(liste.find(x => x.id === lier)?.nom || "")}</div>` : ""}
    </div>`;
  };
  // Arbre de HAUT en BAS : le compteur général en haut, ses sous-compteurs
  // en dessous (traits pleins = déduits, pointillés = pour info), puis la
  // case « = Reste consommé » qui fait le calcul.
  const branche = (c, part = null) => {
    const e = enfants(c.id);
    const info = parentDe(c) && !estDeduit(c);
    if (!e.length) return `<li class="${info ? "info" : ""}">${noeud(c, { part })}</li>`;
    const b = brut(c), p = e.filter(estDeduit).some(x => brut(x) === null) ? null : propre(c); // un sous-compteur sans mesure : pas de reste faux
    const pc = (x) => b ? (x || 0) / b * 100 : null;
    const ded = e.filter(estDeduit);
    const formule = b === null ? "" : `${fmt2(b)} ${ded.map(x => `− ${fmt2(brut(x) || 0)}`).join(" ")}`;
    const reste = !ded.length ? "" : `<li class="sx-li-reste">${noeud(null, { virtuel: true, valeur: p !== null ? Math.max(0, p) : null, part: p !== null ? pc(Math.max(0, p)) : null, titre: `Reste — ${nomCourt(c.nom || c.dossierNom)}`, sous: formule ? `${formule} ${unite}` : `hors ${ded.map(x => x.nom || "sous-compteur").join(", ")}`, alerte: p !== null && p < 0 ? "les sous-compteurs dépassent le général : relevés à vérifier" : "" })}</li>`;
    return `<li class="${info ? "info" : ""}">${noeud(c, { part })}<ul>${e.map(x => branche(x, pc(brut(x)))).join("")}${reste}</ul></li>`;
  };
  const reseau = (c) => `<div class="sx-scroll"><ul class="sx-org">${branche(c)}</ul></div>`;

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
      ? `<div class="sx-item sx-item-net" ${glisser ? `data-drag-index="${i}"` : ""}>${glisser ? `<span class="sx-poignee" data-drag-handle title="Glisser pour ranger">☰</span>` : ""}${reseau(c)}</div>`
      : `<div class="sx-item" ${glisser ? `data-drag-index="${i}"` : ""}>${glisser ? `<span class="sx-poignee" data-drag-handle title="Glisser pour ranger">☰</span>` : ""}${noeud(c)}</div>`).join("")}</div>`;
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
  return { html: html || `<p class="hint">Aucun compteur de ce type.</p>`, chips, listes, descendants, optionsParent, parentDe };
}

export function renderSchema(container, { compteurs, releves, sites = [], associations = [], peutModifier, onRetour, onOuvrirSite }) {
  // Une eau chaude n'alimente jamais un compteur d'eau froide : si c'est le
  // cas (branchement à l'envers), on remet l'eau chaude SOUS ce compteur,
  // en « pour info ». Réparé une fois, automatiquement.
  if (peutModifier) {
    const parIdC = new Map(compteurs.map(c => [c.id, c]));
    const aReparer = compteurs.filter(c => c.type === "eau" && !estEauChaude(c) && estEauChaude(parIdC.get(c.compteurParentId)));
    if (aReparer.length) {
      (async () => {
        for (const c of aReparer) {
          const ec = parIdC.get(c.compteurParentId); if (!ec || ec.compteurParentId === c.id) continue;
          const pp = ec.compteurParentId && ec.compteurParentId !== c.id ? ec.compteurParentId : null;
          await modifierCompteur(c.id, { compteurParentId: pp, nonDeduit: null }); c.compteurParentId = pp; c.nonDeduit = null;
          await modifierCompteur(ec.id, { compteurParentId: c.id, nonDeduit: true }); ec.compteurParentId = c.id; ec.nonDeduit = true;
        }
        window.toast?.("✓ Eau chaude remise sous son compteur général");
        renderSchema(container, { compteurs, releves, sites, associations, peutModifier, onRetour, onOuvrirSite });
      })().catch(err => console.error("réparation eau chaude :", err));
      return;
    }
  }
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
      <div><h1>🔗 Schéma des compteurs</h1><p>Qui alimente qui, sur les 30 derniers jours.</p></div>
      ${peutModifier ? `<button class="add-btn sc-modele" id="sc-modele">✏️ Mode modélisation</button>` : ""}
    </div>
    <div class="sc-onglets">${presentes.map(e => `<button data-sc-e="${e.id}" class="${e.id === st.energie ? "on" : ""}" style="--e:${e.couleur}">${e.icone} ${e.label} <small>${compteurs.filter(c => c.type === e.id).length}</small></button>`).join("")}</div>
    ${st.lier ? "" : r.chips}
    ${st.lier ? `<div class="sc-mode">🔗 <b>${esc(liste.find(x => x.id === st.lier)?.nom || "")}</b> (${esc(nomCourt(liste.find(x => x.id === st.lier)?.dossierNom))}) : clique sur le compteur qui l'<b>alimente</b> (son compteur général, ou un sous-compteur). <button type="button" id="sc-annuler">Annuler</button></div>`
      : peutModifier ? `<p class="sc-aide">Lecture de <b>haut en bas</b> : le compteur général en haut, ses sous-compteurs dessous. Trait plein = <b>déduit</b>, pointillés = <b>pour info</b> (ex. eau chaude). La case <b>= Reste</b> fait le calcul. Pour régler un compteur : <b>clique dessus</b> (ou glisse-le sur le compteur qui l'alimente). Pour ranger : <b>☰</b>.</p>` : ""}
    ${r.html}
  </div>`;

  const rerendre = () => renderSchema(container, { compteurs, releves, sites, associations, peutModifier, onRetour, onOuvrirSite });
  container.querySelector("#sc-modele")?.addEventListener("click", async () => {
    const { renderModele } = await import("./compteurs-modele.js");
    renderModele(container, { compteurs, sites, associations, energie: st.energie, onRetour: (e) => { if (e) st.energie = e; rerendre(); window.scrollTo(0, 0); } });
    window.scrollTo(0, 0);
  });
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
  container.querySelectorAll(".sx-n.cible").forEach(el => el.addEventListener("click", () => enregistrer(st.lier, el.dataset.scId)));
  // Cliquer (ou toucher) un compteur ouvre une fenêtre avec « Alimenté par »
  // et « Déduire » ; sur ordinateur on peut aussi le glisser sur son parent.
  const ouvrirReglages = (id) => {
    const c = compteurs.find(x => x.id === id); if (!c) return;
    const aParent = !!r.parentDe(c);
    const fond = document.createElement("div"); fond.className = "sx-feuille-fond";
    fond.innerHTML = `<div class="sx-feuille"><div class="sx-feuille-tete"><b>${esc(c.nom || "")}</b><small>${esc(nomCourt(c.dossierNom))}${c.logement ? ` · Logement ${esc(c.logement)}` : ""}</small><button type="button" data-f-x>✕</button></div>
      <label class="sx-f-l">↳ Alimenté par (le compteur juste au-dessus)<select data-f-parent>${r.optionsParent(c)}</select></label>
      ${aParent ? `<label class="sx-f-c"><input type="checkbox" data-f-deduit ${estDeduit(c) ? "checked" : ""}> Déduire du compteur au-dessus <small>(décoche pour un compteur « pour info », ex. eau chaude)</small></label>` : `<p class="sx-f-aide">C'est un compteur général (rien au-dessus).</p>`}
      ${aParent ? (() => { const P = compteurs.find(x => x.id === r.parentDe(c)); return `<button type="button" class="sx-f-inv" data-f-inverser>⇅ Inverser : mettre ce compteur AU-DESSUS de « ${esc(nomCourt(P?.dossierNom))} — ${esc(P?.nom || "")} »<small>Ce compteur devient le général ; l'autre passe dessous, avec les compteurs qui étaient à côté.</small></button>`; })() : ""}
      <button type="button" class="sx-f-ok" data-f-x>Fermer</button></div>`;
    document.body.append(fond);
    fond.querySelector("[data-f-inverser]")?.addEventListener("click", async () => {
      const P = compteurs.find(x => x.id === r.parentDe(c)); if (!P) return;
      const PP = P.compteurParentId || null;
      const freres = compteurs.filter(x => x.type === c.type && x.compteurParentId === P.id && x.id !== c.id);
      try {
        await modifierCompteur(c.id, { compteurParentId: PP }); c.compteurParentId = PP;
        await modifierCompteur(P.id, { compteurParentId: c.id }); P.compteurParentId = c.id;
        for (const f of freres) { await modifierCompteur(f.id, { compteurParentId: c.id }); f.compteurParentId = c.id; }
        fermer(); rerendre(); window.toast?.("✓ Compteurs inversés");
      } catch (err) { alert("Enregistrement impossible : " + (err?.message || err)); }
    });
    const fermer = () => fond.remove();
    fond.addEventListener("click", (ev) => { if (ev.target === fond) fermer(); });
    fond.querySelectorAll("[data-f-x]").forEach(b => b.addEventListener("click", fermer));
    const fs = fond.querySelector("[data-f-parent]");
    fs.addEventListener("change", () => { fermer(); enregistrer(id, fs.value || null); });
    fond.querySelector("[data-f-deduit]")?.addEventListener("change", async (ev) => {
      const v = ev.target.checked;
      try { await modifierCompteur(id, { nonDeduit: !v }); c.nonDeduit = !v; fermer(); rerendre(); window.toast?.(v ? "✓ Déduit du compteur au-dessus" : "✓ Compteur pour info (non déduit)"); }
      catch (err) { alert("Enregistrement impossible : " + (err?.message || err)); }
    });
  };
  if (peutModifier) container.querySelectorAll(".sx-n[data-sc-id]").forEach(carte => {
    const id = carte.dataset.scId;
    carte.addEventListener("keydown", (e) => { if (e.key === "Enter") ouvrirReglages(id); });
    const surTel = window.matchMedia("(max-width:700px)").matches;
    if (surTel) { carte.addEventListener("click", () => ouvrirReglages(id)); return; }
    carte.style.cursor = "grab"; carte.style.touchAction = "none";
    carte.title = "Clic : régler · Glisser sur un autre compteur : le brancher dessous";
    carte.addEventListener("pointerdown", (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      const x0 = e.clientX, y0 = e.clientY; let fantome = null, zone = null, cible = null;
      const interdits = r.descendants(id); interdits.add(id);
      const demarrer = () => {
        fantome = carte.cloneNode(true); fantome.classList.add("sx-fantome"); document.body.append(fantome);
        zone = document.createElement("div"); zone.className = "sx-zone-general"; zone.textContent = "⬇ Lâcher ici = compteur général (rien au-dessus)"; container.querySelector(".sc").append(zone);
        container.querySelectorAll(".sx-n[data-sc-id]").forEach(c => c.classList.add(interdits.has(c.dataset.scId) ? "sx-interdit" : "sx-possible"));
        document.body.style.userSelect = "none";
      };
      const bouger = (ev) => {
        if (!fantome && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
        if (!fantome) demarrer();
        ev.preventDefault();
        fantome.style.left = ev.clientX + "px"; fantome.style.top = ev.clientY + "px";
        const sous = document.elementFromPoint(ev.clientX, ev.clientY);
        const c = sous?.closest?.(".sx-n[data-sc-id]"); const z = sous?.closest?.(".sx-zone-general");
        container.querySelectorAll(".sx-survol").forEach(x => x.classList.remove("sx-survol"));
        cible = z ? "GENERAL" : (c && !interdits.has(c.dataset.scId) ? c.dataset.scId : null);
        if (z) z.classList.add("sx-survol"); else if (cible) c.classList.add("sx-survol");
      };
      const lacher = () => {
        document.removeEventListener("pointermove", bouger); document.removeEventListener("pointerup", lacher); document.removeEventListener("pointercancel", lacher);
        if (!fantome) { ouvrirReglages(id); return; }
        fantome.remove(); zone?.remove(); document.body.style.userSelect = "";
        container.querySelectorAll(".sx-possible,.sx-interdit,.sx-survol").forEach(x => x.classList.remove("sx-possible", "sx-interdit", "sx-survol"));
        const actuel = compteurs.find(x => x.id === id)?.compteurParentId || null;
        if (cible === "GENERAL") { if (actuel) enregistrer(id, null); }
        else if (cible && cible !== actuel) enregistrer(id, cible);
      };
      document.addEventListener("pointermove", bouger, { passive: false });
      document.addEventListener("pointerup", lacher); document.addEventListener("pointercancel", lacher);
    });
  });
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

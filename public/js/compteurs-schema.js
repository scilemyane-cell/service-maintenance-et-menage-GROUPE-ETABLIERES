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

// Sous-compteur DÉDUIT du compteur au-dessus (cas normal) ou seulement pour
// INFO (ex. eau chaude : c'est de l'eau que le site consomme quand même).
// Par défaut, l'eau chaude n'est pas déduite ; réglable compteur par compteur.
export const estDeduit = (c) => c.nonDeduit === true ? false : c.nonDeduit === false ? true : !estEauChaude(c);

// Ordre choisi par glisser-déposer (champ « ordre » du compteur), sinon alphabétique.
const lgt = (c) => String(c.logement || "").trim();
export const cmpCompteurs = (a, b) => (a.ordre ?? 1e9) - (b.ordre ?? 1e9) || (!lgt(a) !== !lgt(b) ? (lgt(a) ? 1 : -1) : 0) || (lgt(a) && lgt(b) ? lgt(a).localeCompare(lgt(b), "fr", { numeric: true }) : 0) || nomCourt(a.dossierNom + " " + a.nom).localeCompare(nomCourt(b.dossierNom + " " + b.nom), "fr", { numeric: true });

export function reseauxHTML({ liste, E, conso, debut, fin, sites = [], associations = [], peutModifier = false, lier = null, assoc = "", glisser = false }) {
  const jours = Math.max(1, Math.round((fin - debut) / JOUR));
  const parId = new Map(liste.map(c => [c.id, c]));
  const parentDe = (c) => c.compteurParentId && parId.has(c.compteurParentId) && c.compteurParentId !== c.id ? c.compteurParentId : null;
  const enfants = (id) => liste.filter(c => parentDe(c) === id).sort(cmpCompteurs);
  const descendants = (id, acc = new Set()) => { enfants(id).forEach(e => { if (!acc.has(e.id)) { acc.add(e.id); descendants(e.id, acc); } }); return acc; };
  // Liste « Alimenté par » : aucun (compteur général) ou un autre compteur de
  // la même énergie (jamais lui-même ni un de ses sous-compteurs : pas de boucle).
  const libC = (x) => `${x.logement ? `Logt ${x.logement} · ` : ""}${x.nom || E.label}`;
  const optionsParent = (c) => {
    const interdits = descendants(c.id); interdits.add(c.id);
    const possibles = liste.filter(x => !interdits.has(x.id)).sort(cmpCompteurs);
    const meme = possibles.filter(x => x.dossierId === c.dossierId), autres = possibles.filter(x => x.dossierId !== c.dossierId);
    const opt = (x) => `<option value="${x.id}" ${parentDe(c) === x.id ? "selected" : ""}>${esc(libC(x))}</option>`;
    return `<option value="">— Personne (compteur général)</option>`
      + (meme.length ? `<optgroup label="${esc(nomCourt(c.dossierNom) || "Même site")}">${meme.map(opt).join("")}</optgroup>` : "")
      + [...new Set(autres.map(x => x.dossierNom))].map(n => `<optgroup label="${esc(nomCourt(n))}">${autres.filter(x => x.dossierNom === n).map(opt).join("")}</optgroup>`).join("");
  };
  const brut = (c) => conso(c, debut, fin);
  const propre = (c) => { const b = brut(c); if (b === null) return null; const s = enfants(c.id).filter(estDeduit).reduce((t, e) => t + (brut(e) || 0), 0); return b - s; };
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
      <div class="sx-nom"><b>${esc(opts.virtuel ? opts.titre : (c.nom || E.label))}</b><small>${esc(opts.virtuel ? opts.sous : nomCourt(c.dossierNom) + (c.logement ? ` · Logement ${c.logement}` : ""))}</small>
        ${chaude ? `<span class="sx-badge-chaude">♨️ Eau chaude produite</span>` : opts.general ? `<span class="sx-badge-general">💧 Eau froide générale</span>` : ""}
        <span class="sx-tot">${b === null ? "pas encore de mesure" : `${fmt2(b)} ${unite} sur ${jours} j`}</span>
        ${opts.alerte ? `<span class="sx-al">⚠️ ${esc(opts.alerte)}</span>` : ""}</div>
      ${!opts.virtuel && parentDe(c) && !estDeduit(c) ? `<span class="sx-badge-info">ℹ️ pour info — non déduit</span>` : ""}
      ${!opts.virtuel && peutModifier && parentDe(c) ? `<label class="sx-deduit"><input type="checkbox" data-sx-deduit="${c.id}" ${estDeduit(c) ? "checked" : ""}> Déduire du compteur au-dessus</label>` : ""}
      ${!opts.virtuel && peutModifier ? `<label class="sx-parent" title="Le compteur qui alimente celui-ci (en amont)">↳ Alimenté par <select data-sx-parent="${c.id}">${optionsParent(c)}</select></label>` : ""}
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
      + (!e.some(estDeduit) ? "" : `<div class="sx-branche">${dial(null, p !== null ? pc(p) : null, { virtuel: true, valeur: p !== null ? Math.max(0, p) : null, titre: `Reste consommé — ${nomCourt(c.dossierNom)}`, sous: `hors ${e.filter(estDeduit).map(x => estEauChaude(x) ? "eau chaude" : nomCourt(x.dossierNom) !== nomCourt(c.dossierNom) ? nomCourt(x.dossierNom) : (x.nom || "sous-compteur")).join(", ")}`, alerte: p !== null && p < 0 ? "les sous-compteurs dépassent le général : relevés à vérifier" : "" })}</div>`);
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
  return { html: html || `<p class="hint">Aucun compteur de ce type.</p>`, chips, listes, descendants };
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
      : peutModifier ? `<p class="sc-aide">Pour brancher un compteur : <b>attrape son cadran rond et lâche-le sur le compteur qui l'alimente</b> (ex. le self sur le compteur général du lycée). Pour en refaire un compteur général : lâche-le sur la zone « Compteur général » qui apparaît en bas. La liste « ↳ Alimenté par » fait la même chose. Pour ranger : maintiens <b>☰</b> et fais glisser.</p>` : ""}
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
  container.querySelectorAll("[data-sx-deduit]").forEach(cb => {
    cb.addEventListener("pointerdown", (e) => e.stopPropagation());
    cb.addEventListener("change", async () => {
      const id = cb.dataset.sxDeduit;
      try { await modifierCompteur(id, { nonDeduit: !cb.checked }); const c = compteurs.find(x => x.id === id); if (c) c.nonDeduit = !cb.checked; rerendre(); window.toast?.(cb.checked ? "✓ Déduit du compteur au-dessus" : "✓ Compteur pour info (non déduit)"); }
      catch (err) { alert("Enregistrement impossible : " + (err?.message || err)); }
    });
  });
  container.querySelectorAll("[data-sx-parent]").forEach(sel => {
    sel.addEventListener("click", (e) => e.stopPropagation());
    sel.addEventListener("pointerdown", (e) => e.stopPropagation());
    sel.addEventListener("change", () => enregistrer(sel.dataset.sxParent, sel.value || null));
  });
  // Téléphone : les cartes restent compactes (lecture) ; toucher un compteur
  // ouvre une fenêtre en bas avec « Alimenté par » et « Déduire ».
  const surTel = () => window.matchMedia("(max-width:700px)").matches;
  if (peutModifier) container.querySelectorAll(".sx-c[data-sc-id]").forEach(carte => carte.addEventListener("click", (e) => {
    if (!surTel() || e.target.closest("select,input,label,button")) return;
    const id = carte.dataset.scId, c = compteurs.find(x => x.id === id); if (!c) return;
    const sel = carte.querySelector(".sx-parent select"), cb = carte.querySelector("[data-sx-deduit]");
    const fond = document.createElement("div"); fond.className = "sx-feuille-fond";
    fond.innerHTML = `<div class="sx-feuille"><div class="sx-feuille-tete"><b>${esc(c.nom || "")}</b><small>${esc(nomCourt(c.dossierNom))}${c.logement ? ` · Logement ${esc(c.logement)}` : ""}</small><button type="button" data-f-x>✕</button></div>
      <label class="sx-f-l">↳ Alimenté par (le compteur juste au-dessus)<select data-f-parent>${sel ? sel.innerHTML : ""}</select></label>
      ${cb ? `<label class="sx-f-c"><input type="checkbox" data-f-deduit ${cb.checked ? "checked" : ""}> Déduire du compteur au-dessus <small>(décoche pour un compteur « pour info », ex. eau chaude)</small></label>` : ""}
      <button type="button" class="sx-f-ok" data-f-x>Fermer</button></div>`;
    document.body.append(fond);
    const fermer = () => fond.remove();
    fond.addEventListener("click", (ev) => { if (ev.target === fond) fermer(); });
    fond.querySelectorAll("[data-f-x]").forEach(b => b.addEventListener("click", fermer));
    const fs = fond.querySelector("[data-f-parent]"); if (sel) fs.value = sel.value;
    fs.addEventListener("change", () => { fermer(); enregistrer(id, fs.value || null); });
    fond.querySelector("[data-f-deduit]")?.addEventListener("change", async (ev) => {
      const v = ev.target.checked;
      try { await modifierCompteur(id, { nonDeduit: !v }); c.nonDeduit = !v; fermer(); rerendre(); window.toast?.(v ? "✓ Déduit du compteur au-dessus" : "✓ Compteur pour info (non déduit)"); }
      catch (err) { alert("Enregistrement impossible : " + (err?.message || err)); }
    });
  }));
  // Brancher par glisser-déposer : on attrape le CADRAN d'un compteur et on le
  // lâche sur le compteur qui l'alimente (ou sur la zone « compteur général »).
  if (peutModifier) container.querySelectorAll(".sx-c[data-sc-id] .sx-dial").forEach(dialEl => {
    const carte = dialEl.closest(".sx-c"), id = carte.dataset.scId;
    dialEl.style.cursor = "grab"; dialEl.style.touchAction = "none"; dialEl.title = "Glisser sur le compteur qui alimente celui-ci";
    if (window.matchMedia("(max-width:700px)").matches) { dialEl.style.touchAction = ""; dialEl.style.cursor = ""; return; }
    dialEl.addEventListener("pointerdown", (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      const x0 = e.clientX, y0 = e.clientY; let fantome = null, zone = null, cible = null;
      const interdits = r.descendants(id); interdits.add(id);
      const demarrer = () => {
        fantome = dialEl.cloneNode(true); fantome.className += " sx-fantome"; document.body.append(fantome);
        zone = document.createElement("div"); zone.className = "sx-zone-general"; zone.textContent = "⬇ Lâcher ici = compteur général (sans compteur au-dessus)"; container.querySelector(".sc").append(zone);
        container.querySelectorAll(".sx-c[data-sc-id]").forEach(c => c.classList.add(interdits.has(c.dataset.scId) ? "sx-interdit" : "sx-possible"));
        document.body.style.userSelect = "none";
      };
      const bouger = (ev) => {
        if (!fantome && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
        if (!fantome) demarrer();
        ev.preventDefault();
        fantome.style.left = ev.clientX + "px"; fantome.style.top = ev.clientY + "px";
        const sous = document.elementFromPoint(ev.clientX, ev.clientY);
        const c = sous?.closest?.(".sx-c[data-sc-id]"); const z = sous?.closest?.(".sx-zone-general");
        container.querySelectorAll(".sx-survol").forEach(x => x.classList.remove("sx-survol"));
        cible = z ? "GENERAL" : (c && !interdits.has(c.dataset.scId) ? c.dataset.scId : null);
        if (z) z.classList.add("sx-survol"); else if (cible) c.classList.add("sx-survol");
      };
      const lacher = () => {
        document.removeEventListener("pointermove", bouger); document.removeEventListener("pointerup", lacher); document.removeEventListener("pointercancel", lacher);
        if (!fantome) return;
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

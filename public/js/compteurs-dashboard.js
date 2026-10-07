// compteurs-dashboard.js
// "Pilotage énergie" — tableau de bord des compteurs au format rapport de
// direction (sobre, lisible, exportable) :
//  - filtres sur une ligne : période (mois / 12 mois / année scolaire),
//    UG, énergie ; bouton Exporter PDF (impression du navigateur) ;
//  - chiffres clés : consommation par énergie sur la période + écart avec
//    la même période de l'année précédente, taux de relevés à jour ;
//  - graphique mensuel (12 derniers mois) : année en cours vs année
//    précédente, pour l'énergie choisie, avec infobulle au survol ;
//  - points d'attention détectés automatiquement (hausse anormale, retards,
//    illisibles, baisses notables) ;
//  - tableau par site triable : consommations, écart N-1, tendance 12 mois,
//    couverture des relevés, état.
// SVG/HTML uniquement (pas de librairie), couleurs : une seule teinte forte
// (bleu) pour la période, gris pour N-1, vert = baisse, rouge = hausse.

import { esc } from "./astreinte-logic.js";
import { estEnRetard, motRetard, uniteValeur, clesIndex, fenetreReleve, modifierCompteur } from "./compteurs-data.js";
import { reseauxHTML, ENERGIES as ENERGIES_SCHEMA } from "./compteurs-schema.js";
import { trierGroupes } from "./associations-data.js";

const ENERGIES = [
  { id: "elec", label: "Électricité", couleur: "#eda100" },
  { id: "eau", label: "Eau", couleur: "#2a78d6" },
  { id: "gaz", label: "Gaz", couleur: "#eb6834" },
  { id: "chauffage", label: "Chauffage urbain", couleur: "#e87ba4" },
];
const JOUR = 86400000;
const BLEU = "#2a78d6", GRIS = "#C9CCD2";
const fmt = (n, d = 0) => n === null || n === undefined || !Number.isFinite(n) ? "—" : new Intl.NumberFormat("fr-FR", { maximumFractionDigits: d }).format(n);
const nomCourt = n => String(n || "").replace(/\s*\([^)]*@[^)]*\)\s*/g, " ").replace(/\S+@\S+/g, "").replace(/\s{2,}/g, " ").trim();
const fmt2 = (n) => n === null || n === undefined || !Number.isFinite(n) ? "—" : new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const decalerAn = (d, n) => { const x = new Date(d); x.setFullYear(x.getFullYear() + n); return x; };
const pct = (a, b) => (a === null || b === null || !b) ? null : ((a - b) / b) * 100;

// État des filtres, conservé tant que l'onglet reste ouvert.
const f = { periode: "12mois", ug: "", energie: "", energieGraphe: null, energieReseau: null, tri: "asso", sens: 1 };

export function renderPilotage(container, { compteurs: tousCompteurs, sites, associations, releves, onRetour, onRelever, onOuvrirSite }) {
  // ---------- Index des relevés par compteur (chronologique) ----------
  const parCompteur = new Map();
  releves.forEach(r => { if (!r.createdAt) return; (parCompteur.get(r.compteurId) || parCompteur.set(r.compteurId, []).get(r.compteurId)).push(r); });
  parCompteur.forEach(l => l.sort((a, b) => a.createdAt - b.createdAt));
  // Relevés exploitables PAR INDEX (un compteur multi-tarif n'affiche souvent
  // qu'un index à la fois : chaque index a sa propre série), chronologiques.
  const seriesCache = new Map();
  const series = (c) => {
    if (seriesCache.has(c.id)) return seriesCache.get(c.id);
    const out = clesIndex(c).map(k => (parCompteur.get(c.id) || [])
      .map(r => [r.createdAt, r.illisibles?.[k] ? NaN : parseFloat(String(r.valeurs?.[k] ?? "").replace(",", "."))])
      .filter(([, v]) => Number.isFinite(v)));
    seriesCache.set(c.id, out); return out;
  };
  // Index estimé à une date : interpolé entre les deux relevés qui l'encadrent
  // (un relevé du 2 octobre compte donc surtout pour septembre).
  const interpoler = (pts, ms) => {
    for (let i = 1; i < pts.length; i++) {
      if (ms <= pts[i][0]) { const [ta, va] = pts[i - 1], [tb, vb] = pts[i]; return tb === ta ? vb : va + (vb - va) * (ms - ta) / (tb - ta); }
    }
    return pts[pts.length - 1][1];
  };
  // Consommation entre t0 et t1 : somme des index ; bornée aux relevés connus
  // (avant le premier ou après le dernier relevé, on ne devine rien).
  const conso = (c, t0, t1) => {
    let total = 0, ok = false;
    series(c).forEach(pts => {
      if (pts.length < 2) return;
      const deb = Math.max(t0, pts[0][0]), fin = Math.min(t1, pts[pts.length - 1][0]);
      if (fin <= deb) return;
      const a = interpoler(pts, deb), b = interpoler(pts, fin);
      if (b >= a) { total += b - a; ok = true; }
    });
    return ok ? total : null;
  };
  // ---------- Veille fuites d'eau ----------
  // Débit moyen (m³/jour) entre chaque paire de relevés ; le dernier intervalle
  // est comparé à la référence : « conso normale » saisie, sinon médiane des
  // intervalles précédents.
  const veilleEau = () => tousCompteurs.filter(c => c.type === "eau" && (!f.ug || ugDe(c) === f.ug)).map(c => {
    const pts = []; // total des index par relevé (tous index lisibles)
    (parCompteur.get(c.id) || []).forEach(r => {
      let t = 0, ok = true; clesIndex(c).forEach(k => { const v = parseFloat(String(r.valeurs?.[k] ?? "").replace(",", ".")); if (r.illisibles?.[k] || !Number.isFinite(v)) ok = false; else t += v; });
      if (ok) pts.push([r.createdAt, t]);
    });
    const debits = [];
    for (let i = 1; i < pts.length; i++) { const j = (pts[i][0] - pts[i - 1][0]) / JOUR; if (j >= 0.5 && pts[i][1] >= pts[i - 1][1]) debits.push({ du: pts[i - 1][0], au: pts[i][0], j, v: (pts[i][1] - pts[i - 1][1]) / j }); }
    const enf = enfantsDe(c);
    if (enf.length) debits.forEach(d => { const sous = enf.reduce((t, x) => t + (conso(x, d.du, d.au) || 0), 0); d.v = Math.max(0, d.v - sous / d.j); d.net = true; });
    const dernier = debits[debits.length - 1] || null;
    const precedents = debits.slice(0, -1).map(d => d.v).sort((a, b) => a - b);
    const med = precedents.length ? precedents[Math.floor(precedents.length / 2)] : null;
    const seuil = Number.isFinite(parseFloat(c.consoNormaleJour)) ? parseFloat(c.consoNormaleJour) : null;
    const ref = seuil ?? med;
    const ratio = dernier && ref ? dernier.v / ref : null;
    const etat = !dernier ? "attente" : ratio === null ? "construction" : ratio > 1.8 ? "fuite" : ratio > 1.3 ? "surveiller" : "ok";
    const age = c.dernierReleve?.at ? Math.round((Date.now() - c.dernierReleve.at) / JOUR) : null;
    return { c, debits, dernier, ref, refManuelle: seuil !== null, ratio, etat, age };
  }).sort((a, b) => ({ fuite: 0, surveiller: 1, ok: 2, construction: 3, attente: 4 }[a.etat] - { fuite: 0, surveiller: 1, ok: 2, construction: 3, attente: 4 }[b.etat]) || (b.ratio || 0) - (a.ratio || 0));

  // Sous-compteurs (Schéma des compteurs) : un compteur général compte sa
  // consommation PROPRE = son index − ce que mesurent ses sous-compteurs.
  const enfantsDe = (c) => tousCompteurs.filter(x => x.compteurParentId === c.id && x.type === c.type && x.id !== c.id);
  const consoPropre = (c, t0, t1) => { const v = conso(c, t0, t1); if (v === null) return null; const e = enfantsDe(c); return e.length ? Math.max(0, v - e.reduce((t, x) => t + (conso(x, t0, t1) || 0), 0)) : v; };
  const somme = (liste, t0, t1) => {
    let s = 0, ok = false;
    liste.forEach(c => { const v = consoPropre(c, t0, t1); if (v !== null) { s += v; ok = true; } });
    return ok ? s : null;
  };

  // ---------- Filtres ----------
  const siteParId = new Map(sites.map(s => [s.id, s]));
  // Ordre des dossiers de site : association (ordre habituel) → groupe → nom.
  const rangAsso = (n) => { const i = associations.findIndex(a => a.nom === n); return i < 0 ? 999 : i; };
  const groupesTries = trierGroupes([...new Set(sites.map(s => s.groupe).filter(Boolean))]);
  const rangGroupe = (g) => g ? 1 + groupesTries.indexOf(g) : 0;
  const cleOrdreSite = (s) => [rangAsso(s?.association), rangGroupe(s?.groupe), nomCourt(s?.nom).toLowerCase()];
  const cmpOrdre = (a, b) => { const x = cleOrdreSite(a), y = cleOrdreSite(b); for (let i = 0; i < 2; i++) { if (x[i] < y[i]) return -1; if (x[i] > y[i]) return 1; } return String(x[2]).localeCompare(String(y[2]), "fr", { numeric: true }); };
  // Regroupe une liste par association puis groupe : [{ assoc, groupe, items }].
  const parAssoGroupe = (items, siteDe) => {
    const out = [];
    [...items].sort((a, b) => cmpOrdre(siteDe(a), siteDe(b))).forEach(it => {
      const s = siteDe(it), as = s?.association || "Sans association", g = s?.groupe || "";
      const der = out[out.length - 1];
      if (der && der.assoc === as && der.groupe === g) der.items.push(it); else out.push({ assoc: as, groupe: g, items: [it] });
    });
    return out;
  };
  const ugDe = c => siteParId.get(c.dossierId)?.association || "";
  const compteurs = tousCompteurs.filter(c => (!f.ug || ugDe(c) === f.ug) && (!f.energie || c.type === f.energie));
  const energiesPresentes = ENERGIES.filter(e => compteurs.some(c => c.type === e.id));
  if (!f.energieGraphe || !energiesPresentes.some(e => e.id === f.energieGraphe)) f.energieGraphe = (energiesPresentes[0] || ENERGIES[0]).id;

  const auj = new Date();
  const fin = auj.getTime() + 1;
  const debut = f.periode === "mois" ? new Date(auj.getFullYear(), auj.getMonth(), 1)
    : f.periode === "scolaire" ? new Date(auj.getMonth() >= 8 ? auj.getFullYear() : auj.getFullYear() - 1, 8, 1)
    : new Date(auj.getFullYear(), auj.getMonth() - 11, 1);
  const t0 = debut.getTime(), t0p = decalerAn(debut, -1).getTime(), t1p = decalerAn(auj, -1).getTime() + 1;
  const libPeriode = { mois: "ce mois", "12mois": "12 mois", scolaire: "année scolaire" }[f.periode];

  // ---------- Chiffres clés ----------
  const kpis = energiesPresentes.map(e => {
    const l = compteurs.filter(c => c.type === e.id);
    const v = somme(l, t0, fin), vp = somme(l, t0p, t1p);
    const spark = []; for (let i = 12; i >= 1; i--) { // 12 mois COMPLETS (le mois en cours, partiel, fausserait la tendance)
      const d = new Date(auj.getFullYear(), auj.getMonth() - i, 1), d2 = new Date(auj.getFullYear(), auj.getMonth() - i + 1, 1); spark.push(somme(l, d.getTime(), Math.min(d2.getTime(), fin))); }
    const connus = spark.filter(x => x !== null);
    return { ...e, v, vp, d: pct(v, vp), unite: uniteValeur({ type: e.id }), spark, moy: connus.length ? connus.reduce((a, b) => a + b, 0) / connus.length : null };
  });
  const enRetard = compteurs.filter(estEnRetard);
  const fen = fenetreReleve(), faitsFen = compteurs.filter(c => (c.dernierReleve?.at || 0) >= fen.debut.getTime()).length;
  const tauxAJour = compteurs.length ? Math.round(((compteurs.length - enRetard.length) / compteurs.length) * 100) : null;

  // ---------- Graphique mensuel (12 derniers mois, énergie choisie) ----------
  const eG = ENERGIES.find(e => e.id === f.energieGraphe);
  const lG = compteurs.filter(c => c.type === f.energieGraphe);
  const mois = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(auj.getFullYear(), auj.getMonth() - i, 1), d2 = new Date(auj.getFullYear(), auj.getMonth() - i + 1, 1);
    mois.push({
      label: d.toLocaleDateString("fr-FR", { month: "short" }), long: d.toLocaleDateString("fr-FR", { month: "long", year: "numeric" }),
      n: somme(lG, d.getTime(), Math.min(d2.getTime(), fin)), p: somme(lG, decalerAn(d, -1).getTime(), decalerAn(d2, -1).getTime()),
    });
  }

  // ---------- Tableau par site ----------
  const sitesAffiches = sites.filter(s => compteurs.some(c => c.dossierId === s.id));
  const lignes = sitesAffiches.map(s => {
    const cs = compteurs.filter(c => c.dossierId === s.id);
    const parE = {};
    energiesPresentes.forEach(e => {
      const l = cs.filter(c => c.type === e.id);
      if (!l.length) return;
      parE[e.id] = { v: somme(l, t0, fin), vp: somme(l, t0p, t1p) };
      parE[e.id].d = pct(parE[e.id].v, parE[e.id].vp);
    });
    const lGs = cs.filter(c => c.type === f.energieGraphe);
    const tendance = lGs.length ? mois.map((m, i) => {
      const d = new Date(auj.getFullYear(), auj.getMonth() - (11 - i), 1), d2 = new Date(auj.getFullYear(), auj.getMonth() - (11 - i) + 1, 1);
      return somme(lGs, d.getTime(), Math.min(d2.getTime(), fin));
    }) : null;
    const retard = cs.filter(estEnRetard).length;
    const illisible = cs.some(c => { const l = parCompteur.get(c.id) || []; const r = l[l.length - 1]; return r && r.illisibles && Object.values(r.illisibles).some(Boolean); });
    return { s, cs, parE, tendance, retard, illisible, couverture: cs.length ? (cs.length - retard) / cs.length : 0, dRef: parE[f.energieGraphe]?.d ?? null };
  });
  const cleTri = {
    asso: l => cleOrdreSite(l.s).map(v => typeof v === "number" ? String(v).padStart(4, "0") : v).join("|"),
    nom: l => nomCourt(l.s.nom).toLowerCase(), ug: l => l.s.association || "", ecart: l => l.dRef ?? -Infinity,
    couverture: l => l.couverture, etat: l => l.retard * 10 + (l.illisible ? 1 : 0),
    ...Object.fromEntries(energiesPresentes.map(e => [e.id, l => l.parE[e.id]?.v ?? -Infinity])),
  };
  const k = cleTri[f.tri] || cleTri.nom;
  lignes.sort((a, b) => { const x = k(a), y = k(b); return (x > y ? 1 : x < y ? -1 : 0) * f.sens; });

  // ---------- Points d'attention ----------
  const attention = [];
  const mDebut = new Date(auj.getFullYear(), auj.getMonth() - 1, 1), mFin = new Date(auj.getFullYear(), auj.getMonth(), 1);
  const nomMois = mDebut.toLocaleDateString("fr-FR", { month: "long" });
  compteurs.forEach(c => {
    const v = conso(c, mDebut.getTime(), mFin.getTime()), vp = conso(c, decalerAn(mDebut, -1).getTime(), decalerAn(mFin, -1).getTime());
    const d = pct(v, vp);
    if (d !== null && d > 30 && v - vp > 0) attention.push({ niveau: "crit", icone: "▲", poids: d,
      titre: `${nomCourt(c.dossierNom)} — ${ENERGIES.find(e => e.id === c.type)?.label || c.type} +${fmt(d)} % en ${nomMois}`,
      texte: `${fmt(v)} ${uniteValeur(c)} contre ${fmt(vp)} ${uniteValeur(c)} en ${nomMois} ${mDebut.getFullYear() - 1} (${esc(c.nom)}). Fuite ou dérive à vérifier.`, site: c.dossierId });
  });
  if (enRetard.length) attention.push({ niveau: "crit", icone: "!", poids: 1000,
    titre: `${enRetard.length} compteur${enRetard.length > 1 ? "s" : ""} ${motRetard()}`,
    texte: [...new Set(enRetard.map(c => nomCourt(c.dossierNom)))].slice(0, 8).join(", ") + (enRetard.length > 8 ? "…" : "") + "." });
  const ill = releves.filter(r => r.createdAt > Date.now() - 90 * JOUR && r.illisibles && Object.values(r.illisibles).some(Boolean) && compteurs.some(c => c.id === r.compteurId));
  if (ill.length) attention.push({ niveau: "warn", icone: "?", poids: 10,
    titre: `${ill.length} relevé${ill.length > 1 ? "s" : ""} illisible${ill.length > 1 ? "s" : ""} (3 derniers mois)`,
    texte: [...new Set(ill.map(r => nomCourt(r.dossierNom)))].slice(0, 6).join(", ") + "." });
  lignes.forEach(l => Object.entries(l.parE).forEach(([e, x]) => {
    if (x.d !== null && x.d < -15 && x.vp > 0) attention.push({ niveau: "good", icone: "▼", poids: -x.d / 100,
      titre: `${nomCourt(l.s.nom)} — ${ENERGIES.find(z => z.id === e).label} ${fmt(x.d)} % sur ${libPeriode}`,
      texte: `${fmt(x.v)} ${uniteValeur({ type: e })} contre ${fmt(x.vp)} sur la même période l'an dernier.`, site: l.s.id });
  }));
  attention.sort((a, b) => ({ crit: 0, warn: 1, good: 2 }[a.niveau] - { crit: 0, warn: 1, good: 2 }[b.niveau]) || b.poids - a.poids);

  const flecheTri = col => f.tri === col ? (f.sens > 0 ? " ▲" : " ▼") : "";
  const ecart = (d, taille = "") => d === null ? `<span class="pe-muet">—</span>` : `<span class="pe-delta ${d > 0 ? "pe-hausse" : "pe-baisse"} ${taille}">${d > 0 ? "▲" : "▼"} ${fmt(Math.abs(d), 1)} %</span>`;

  container.innerHTML = `
    <div class="pe">
      <div class="pe-entete">
        <div>
          <button class="nav-btn pe-retour" id="pe-retour">← Retour</button>
          <h1>Pilotage énergie — Compteurs</h1>
          <p>Groupe Établières · données au ${auj.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })} · ${compteurs.length} compteur${compteurs.length > 1 ? "s" : ""} sur ${sitesAffiches.length} site${sitesAffiches.length > 1 ? "s" : ""}</p>
        </div>
        <div class="pe-filtres">
          <div class="pe-seg">${[["mois", "Mois"], ["12mois", "12 mois"], ["scolaire", "Année scolaire"]].map(([v, l]) => `<button data-pe-periode="${v}" class="${f.periode === v ? "pe-on" : ""}">${l}</button>`).join("")}</div>
          <select id="pe-ug"><option value="">Toutes les UG</option>${associations.map(a => `<option ${f.ug === a.nom ? "selected" : ""}>${esc(a.nom)}</option>`).join("")}</select>
          <button id="pe-pdf">⤓ Exporter PDF</button>
        </div>
      </div>

      <div class="pe-energies">${[{ id: "", label: "Toutes énergies", icone: "📊", couleur: "#52514e" }, ...ENERGIES_SCHEMA.filter(e => tousCompteurs.some(c => c.type === e.id))].map(e => `<button type="button" data-pe-en="${e.id}" class="${f.energie === e.id ? "on" : ""}" style="--e:${e.couleur}"><span>${e.icone}</span>${e.label}<small>${e.id ? tousCompteurs.filter(c => c.type === e.id && (!f.ug || ugDe(c) === f.ug)).length + " compteur(s)" : ""}</small></button>`).join("")}</div>

      ${(() => {
        // Historique récent : les consommations démarrent au PREMIER relevé (index de départ = zéro).
        const premiers = compteurs.map(c => (parCompteur.get(c.id) || [])[0]?.createdAt).filter(Boolean);
        if (!premiers.length) return "";
        const p0 = new Date(Math.min(...premiers));
        if (Date.now() - p0.getTime() > 400 * JOUR) return "";
        const moisFr = (d) => d.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
        return `<div class="pe-carte pe-info">ℹ️ Les relevés ont démarré en <b>${moisFr(p0)}</b> : ce premier index sert de point de départ (zéro). Les consommations sont calculées entre deux relevés successifs — un relevé fait du 27 au 3 clôture le mois qui se termine. La comparaison avec l'année précédente sera disponible à partir de ${moisFr(new Date(p0.getFullYear() + 1, p0.getMonth(), 1))}.</div>`;
      })()}

      ${(() => {
        if (f.energie && f.energie !== "eau") return "";
        const V = veilleEau(); if (!V.length) return "";
        const nb = (e) => V.filter(x => x.etat === e).length;
        const libEtat = { fuite: "Fuite probable", surveiller: "À surveiller", ok: "Normal", construction: "Référence à définir", attente: "En attente de 2 relevés" };
        const jauge = (x) => {
          const r = 42, c = 2 * Math.PI * r, arc = 0.75 * c; // jauge sur 270°
          const p = x.ratio === null ? 0 : Math.min(1, x.ratio / 2.5);
          const repere = x.ref ? Math.min(1, 1 / 2.5) : null;
          return `<svg viewBox="0 0 110 110" class="vf-jauge"><circle cx="55" cy="55" r="${r}" class="vf-piste" stroke-dasharray="${arc} ${c}" transform="rotate(135 55 55)"/>
            <circle cx="55" cy="55" r="${r}" class="vf-niveau" stroke-dasharray="${arc * p} ${c}" transform="rotate(135 55 55)"/>
            ${repere !== null ? (() => { const ang = (135 + 270 * repere) * Math.PI / 180; return `<circle cx="${55 + r * Math.cos(ang)}" cy="${55 + r * Math.sin(ang)}" r="4.5" class="vf-repere"/>`; })() : ""}
            <text x="55" y="52" text-anchor="middle" class="vf-val">${x.dernier ? fmt2(x.dernier.v) : "—"}</text><text x="55" y="68" text-anchor="middle" class="vf-unite">m³ / jour</text></svg>`;
        };
        const barres = (x) => { const d = x.debits.slice(-8); if (d.length < 2) return ""; const m = Math.max(...d.map(z => z.v), x.ref || 0) || 1;
          return `<div class="vf-histo" title="Débit moyen entre deux relevés (8 derniers)">${d.map((z, i) => `<i style="height:${Math.max(6, z.v / m * 100)}%" class="${i === d.length - 1 ? "der" : ""}" title="${new Date(z.du).toLocaleDateString("fr-FR")} → ${new Date(z.au).toLocaleDateString("fr-FR")} : ${fmt(z.v, 2)} m³/j"></i>`).join("")}${x.ref ? `<b style="bottom:${x.ref / m * 100}%"></b>` : ""}</div>`; };
        return `<section class="vf">
          <div class="vf-tete"><div><span class="vf-sur">Surveillance en continu</span><h2>💧 Veille fuites d'eau</h2>
            <p>Chaque compteur d'eau compare son <b>débit moyen depuis le relevé précédent</b> à sa consommation normale. Au-delà de +30 % : à surveiller ; au-delà de +80 % : fuite probable.</p></div>
            <div class="vf-resume"><span class="f">${nb("fuite")}<small>fuite${nb("fuite") > 1 ? "s" : ""} probable${nb("fuite") > 1 ? "s" : ""}</small></span><span class="s">${nb("surveiller")}<small>à surveiller</small></span><span class="o">${nb("ok")}<small>normal</small></span>${nb("construction") + nb("attente") ? `<span class="c">${nb("construction") + nb("attente")}<small>référence à définir</small></span>` : ""}</div></div>
          ${parAssoGroupe(V, x => siteParId.get(x.c.dossierId)).map((G, gi, T) => `${gi === 0 || T[gi - 1].assoc !== G.assoc ? `<div class="vf-asso">🏢 ${esc(G.assoc)}</div>` : ""}${G.groupe ? `<div class="vf-groupe">${esc(G.groupe)}</div>` : ""}
          <div class="vf-grille">${[...G.items].sort((a, b) => (a.c.ordre ?? 1e9) - (b.c.ordre ?? 1e9) || V.indexOf(a) - V.indexOf(b)).map(x => `
            <div class="vf-c vf-${x.etat}">
              <div class="vf-c-tete"><b>${esc(nomCourt(x.c.dossierNom))}</b><small>${esc(x.c.nom || "Eau")}${x.dernier?.net ? " · propre (hors sous-compteurs)" : ""}</small><span class="vf-etat">${libEtat[x.etat]}</span></div>
              <div class="vf-c-corps">${jauge(x)}
                <div class="vf-c-info">
                  ${x.ratio !== null ? `<div class="vf-ratio">${x.ratio >= 1 ? "+" : ""}${fmt((x.ratio - 1) * 100)} %<small>vs normal</small></div>` : ""}
                  <div>Normal : <b>${x.ref ? `${fmt2(x.ref)} m³/j` : "—"}</b>${x.ref ? `<small>${x.refManuelle ? " (saisi)" : " (calculé)"}</small>` : ""}</div>
                  ${x.dernier ? `<div class="vf-mute">du ${new Date(x.dernier.du).toLocaleDateString("fr-FR")} au ${new Date(x.dernier.au).toLocaleDateString("fr-FR")}</div>` : `<div class="vf-mute">Il faut 2 relevés pour mesurer un débit.</div>`}
                  ${x.age !== null && x.age > 10 ? `<div class="vf-mute">⏱ dernier relevé il y a ${x.age} j — un relevé intermédiaire affinerait la mesure</div>` : ""}
                </div></div>
              ${barres(x)}
              ${x.etat === "construction" ? `<button type="button" class="vf-normal" data-vf-fixe="${x.c.id}" data-vf-v="${Math.round(x.dernier.v * 100) / 100}">✓ ${fmt2(x.dernier.v)} m³/jour, c'est normal pour ce site</button>` : ""}
              <div class="vf-actions"><button type="button" data-vf-ref="${x.c.id}" data-vf-val="${x.ref ?? ""}">${x.refManuelle ? "✏️ Modifier la conso normale" : "⚙️ Définir la conso normale"}</button><button type="button" data-pe-site="${x.c.dossierId}">Voir le site →</button></div>
            </div>`).join("")}</div>`).join("")}
        </section>`;
      })()}

      ${(() => {
        // Réseaux de compteurs (même graphique que « Schéma des compteurs ») : suivi par énergie, période choisie.
        const ens = ENERGIES_SCHEMA.filter(e => compteurs.some(c => c.type === e.id));
        if (!ens.length) return "";
        if (f.energie && ens.some(e => e.id === f.energie)) f.energieReseau = f.energie;
        if (!f.energieReseau || !ens.some(e => e.id === f.energieReseau)) f.energieReseau = (ens.find(e => e.id === "elec") || ens[0]).id;
        const E = ens.find(e => e.id === f.energieReseau);
        const r = reseauxHTML({ liste: compteurs.filter(c => c.type === E.id), E, conso, debut: Math.max(t0, Math.min(...compteurs.map(c => (parCompteur.get(c.id) || [])[0]?.createdAt || Infinity))), fin: Date.now(), sites, associations });
        return `<section class="pe-reseaux sx-e-${E.id}">
          <div class="pe-titre-graphe"><div><h2>${E.icone} Réseaux de compteurs — ${esc(E.label)}</h2><p class="pe-st">Même vue que le Schéma des compteurs, sur ${libPeriode} · débit moyen par jour au centre · le niveau = part de chaque compteur dans son réseau · rangé par association</p></div>
            ${f.energie ? "" : `<div class="pe-chips">${ens.map(e => `<button data-pe-reseau="${e.id}" class="${e.id === E.id ? "pe-on" : ""}"><i style="background:${e.couleur}"></i>${e.icone} ${e.label}</button>`).join("")}</div>`}</div>
          ${r.html}
        </section>`;
      })()}

      <div class="pe-kpis">
        ${kpis.map(x => `
          <div class="pe-carte pe-kpi">
            <div class="pe-lab"><i style="background:${x.couleur}"></i>${x.label} · ${libPeriode}</div>
            <div class="pe-val">${fmt(x.v)}<small>${x.unite}</small></div>
            ${ecart(x.d)}<span class="pe-sous">${x.vp === null ? "pas de donnée N-1" : "vs N-1"}</span>
            <div class="pe-kpi-spark">${sparkline(x.spark, x.couleur, 150, 34)}<span class="pe-sous">${x.moy !== null ? `≈ ${fmt(x.moy)} ${x.unite}/mois` : ""}</span></div>
          </div>`).join("")}
        <div class="pe-carte pe-kpi pe-kpi-rel">
          <div class="pe-lab">Relevés ${fen.ouverte ? "de la période en cours" : "du mois"}</div>
          <div class="pe-rel">${anneau(compteurs.length ? Math.round(faitsFen / compteurs.length * 100) : 0)}<div><div class="pe-val">${faitsFen}<small>/ ${compteurs.length}</small></div><span class="pe-sous">${fen.libelle}</span></div></div>
          ${enRetard.length ? `<span class="pe-delta pe-hausse">${enRetard.length} compteur${enRetard.length > 1 ? "s" : ""} ${motRetard()}</span>` : `<span class="pe-delta pe-baisse">✓ tout est relevé</span>`}
        </div>
      </div>

      <div class="pe-deux">
        <div class="pe-carte">
          <div class="pe-titre-graphe">
            <div><h2>Consommation ${eG ? `${eG.id === "eau" ? "d'" : "de "}${eG.label.toLowerCase()}` : ""} par mois</h2><p class="pe-st">${f.ug || "Tous sites"} · ${eG ? uniteValeur({ type: eG.id }) : ""} · comparaison avec l'année précédente</p></div>
            <div class="pe-chips">${energiesPresentes.map(e => `<button data-pe-graphe="${e.id}" class="${e.id === f.energieGraphe ? "pe-on" : ""}"><i style="background:${e.couleur}"></i>${e.label}</button>`).join("")}</div>
          </div>
          <div class="pe-legende"><span><i style="background:${eG?.couleur || BLEU}"></i>12 derniers mois</span><span><i style="background:${GRIS}"></i>Année précédente</span></div>
          ${graphe(mois, eG ? uniteValeur({ type: eG.id }) : "", eG?.couleur)}
          <details class="pe-table-vue"><summary>Voir les valeurs</summary>
            <table><thead><tr><th>Mois</th><th class="n">Période</th><th class="n">N-1</th><th class="n">Écart</th></tr></thead>
            <tbody>${mois.map(m => `<tr><td>${esc(m.long)}</td><td class="n">${fmt(m.n)}</td><td class="n">${fmt(m.p)}</td><td class="n">${ecart(pct(m.n, m.p))}</td></tr>`).join("")}</tbody></table>
          </details>
        </div>
        <div class="pe-carte">
          <h2>Points d'attention</h2><p class="pe-st">Détectés automatiquement sur les relevés</p>
          ${attention.length === 0 ? `<p class="pe-muet">Rien à signaler.</p>` : attention.slice(0, 7).map(a => `
            <div class="pe-anom ${a.site ? "pe-clic" : ""}" ${a.site ? `data-pe-site="${a.site}"` : ""}>
              <div class="pe-ic pe-ic-${a.niveau}">${a.icone}</div>
              <div><b>${esc(a.titre)}</b><p>${esc(a.texte)}</p></div>
            </div>`).join("")}
        </div>
      </div>

      ${(() => {
        const rows = lignes.map(l => ({ s: l.s, v: l.parE[f.energieGraphe]?.v ?? null, vp: l.parE[f.energieGraphe]?.vp ?? null })).filter(r => r.v !== null).sort((a, b) => b.v - a.v);
        if (!rows.length || !eG) return "";
        const max = Math.max(...rows.map(r => Math.max(r.v, r.vp || 0))) || 1, tot = rows.reduce((t, r) => t + r.v, 0);
        return `<div class="pe-carte">
        <div class="pe-titre-graphe"><div><h2>Qui consomme le plus ? — ${esc(eG.label)}</h2><p class="pe-st">${libPeriode} · ${uniteValeur({ type: eG.id })} · le trait gris = même période l'an dernier · clic sur un site pour l'ouvrir</p></div>
          <div class="pe-chips">${energiesPresentes.map(e => `<button data-pe-graphe="${e.id}" class="${e.id === f.energieGraphe ? "pe-on" : ""}"><i style="background:${e.couleur}"></i>${e.label}</button>`).join("")}</div></div>
        <div class="pe-classement">${rows.slice(0, 12).map((r, i) => { const d = pct(r.v, r.vp); return `
          <div class="pe-cl pe-clic" data-pe-site="${r.s.id}" title="${esc(nomCourt(r.s.nom))} : ${fmt(r.v)} ${uniteValeur({ type: eG.id })}${r.vp !== null ? ` (N-1 : ${fmt(r.vp)})` : ""}">
            <span class="pe-cl-r">${i + 1}</span><span class="pe-cl-n">${esc(nomCourt(r.s.nom))}</span>
            <span class="pe-cl-b"><i style="width:${(r.v / max) * 100}%;background:${eG.couleur}"></i>${r.vp !== null ? `<em style="left:${(r.vp / max) * 100}%"></em>` : ""}</span>
            <b>${fmt(r.v)}</b><small>${Math.round(r.v / tot * 100)} %</small>${ecart(d)}
          </div>`; }).join("")}</div>
      </div>`; })()}

      <div class="pe-carte">
        <h2>Détail par site</h2>
        <p class="pe-st">Consommation sur ${libPeriode}, écart avec la même période de l'année précédente, tendance mensuelle (${eG ? eG.label.toLowerCase() : ""}), relevés — clic sur un en-tête pour trier, sur un site pour l'ouvrir</p>
        <div class="pe-scroll"><table class="pe-table">
          <thead><tr>
            <th data-pe-tri="nom">Site${flecheTri("nom")}</th><th data-pe-tri="asso">UG${flecheTri("asso")}</th>
            ${energiesPresentes.map(e => `<th class="n" data-pe-tri="${e.id}">${e.label} (${uniteValeur({ type: e.id })})${flecheTri(e.id)}</th>`).join("")}
            <th class="n" data-pe-tri="ecart">vs N-1${flecheTri("ecart")}</th><th>Tendance 12 mois</th>
            <th data-pe-tri="couverture">Relevés à jour${flecheTri("couverture")}</th><th data-pe-tri="etat">État${flecheTri("etat")}</th>
          </tr></thead>
          <tbody>${lignes.map((l, i) => `${f.tri === "asso" && (i === 0 || (lignes[i - 1].s.association || "") !== (l.s.association || "") || (lignes[i - 1].s.groupe || "") !== (l.s.groupe || "")) ? `<tr class="pe-gr"><td colspan="${6 + energiesPresentes.length}">${i === 0 || (lignes[i - 1].s.association || "") !== (l.s.association || "") ? `🏢 ${esc(l.s.association || "Sans association")}` : ""}${l.s.groupe ? ` <small>${esc(l.s.groupe)}</small>` : ""}</td></tr>` : ""}
            <tr data-pe-site="${l.s.id}" class="pe-clic">
              <td><b>${esc(nomCourt(l.s.nom))}</b></td><td>${esc(l.s.association || "—")}</td>
              ${energiesPresentes.map(e => `<td class="n">${l.parE[e.id] ? fmt(l.parE[e.id].v) : `<span class="pe-muet">·</span>`}</td>`).join("")}
              <td class="n">${ecart(l.dRef)}</td>
              <td>${l.tendance ? sparkline(l.tendance) : `<span class="pe-muet">—</span>`}</td>
              <td><span class="pe-couv"><span style="width:${Math.round(l.couverture * 100)}%"></span></span>${Math.round(l.couverture * 100)} %</td>
              <td>${l.retard ? `<span class="pe-badge pe-b-ko">● ${l.retard} ${motRetard()}</span>` : l.illisible ? `<span class="pe-badge pe-b-w">? Illisible</span>` : `<span class="pe-badge pe-b-ok">✓ À jour</span>`}</td>
            </tr>`).join("")}
          </tbody>
        </table></div>
        ${enRetard.length ? `
          <h2 style="margin-top:18px">Compteurs à relever</h2>
          <div class="pe-retards">${enRetard.map(c => `
            <div><span><b>${esc(c.nom)}</b> · ${esc(nomCourt(c.dossierNom))} <span class="pe-muet">— ${c.dernierReleve?.at ? `dernier relevé le ${new Date(c.dernierReleve.at).toLocaleDateString("fr-FR")}` : "jamais relevé"}</span></span>
            <button class="nav-btn" data-pe-relever="${c.id}">Relever</button></div>`).join("")}</div>` : ""}
      </div>
      <div class="pe-tip" id="pe-tip"></div>
    </div>`;

  const rerendre = () => renderPilotage(container, { compteurs: tousCompteurs, sites, associations, releves, onRetour, onRelever, onOuvrirSite });
  container.querySelector("#pe-retour")?.addEventListener("click", onRetour);
  container.querySelector("#pe-pdf")?.addEventListener("click", () => window.print());
  container.querySelectorAll("[data-pe-periode]").forEach(b => b.addEventListener("click", () => { f.periode = b.dataset.pePeriode; rerendre(); }));
  container.querySelector("#pe-ug")?.addEventListener("change", e => { f.ug = e.target.value; rerendre(); });
  container.querySelectorAll("[data-pe-en]").forEach(b => b.addEventListener("click", () => { f.energie = b.dataset.peEn; if (f.energie) { f.energieGraphe = f.energie; f.energieReseau = f.energie; } rerendre(); }));
  container.querySelectorAll("[data-pe-graphe]").forEach(b => b.addEventListener("click", () => { f.energieGraphe = b.dataset.peGraphe; rerendre(); }));
  container.querySelectorAll("[data-pe-reseau]").forEach(b => b.addEventListener("click", () => { f.energieReseau = b.dataset.peReseau; rerendre(); }));
  container.querySelectorAll("[data-pe-tri]").forEach(th => th.addEventListener("click", () => {
    const c = th.dataset.peTri; if (f.tri === c) f.sens *= -1; else { f.tri = c; f.sens = c === "nom" || c === "ug" || c === "asso" ? 1 : -1; } rerendre();
  }));
  container.querySelectorAll("[data-pe-site]").forEach(el => el.addEventListener("click", () => onOuvrirSite(el.dataset.peSite)));
  container.querySelectorAll("[data-vf-fixe]").forEach(b => b.addEventListener("click", async () => {
    const n = parseFloat(b.dataset.vfV); b.disabled = true;
    try { await modifierCompteur(b.dataset.vfFixe, { consoNormaleJour: n }); const c = tousCompteurs.find(x => x.id === b.dataset.vfFixe); if (c) c.consoNormaleJour = n; rerendre(); }
    catch (e) { alert("Enregistrement impossible : " + (e?.message || e)); b.disabled = false; }
  }));
  container.querySelectorAll("[data-vf-ref]").forEach(b => b.addEventListener("click", async () => {
    const v = prompt("Consommation NORMALE de ce compteur, en m³ par jour (ex. 1,5).\nLaisse vide pour revenir au calcul automatique.", b.dataset.vfVal ? String(Math.round(parseFloat(b.dataset.vfVal) * 100) / 100).replace(".", ",") : "");
    if (v === null) return;
    const n = parseFloat(v.replace(",", "."));
    try { await modifierCompteur(b.dataset.vfRef, { consoNormaleJour: v.trim() === "" ? null : (Number.isFinite(n) && n > 0 ? n : null) }); const c = tousCompteurs.find(x => x.id === b.dataset.vfRef); if (c) c.consoNormaleJour = v.trim() === "" ? null : n; rerendre(); }
    catch (e) { alert("Enregistrement impossible : " + (e?.message || e)); }
  }));
  container.querySelectorAll("[data-pe-relever]").forEach(b => b.addEventListener("click", () => onRelever(b.dataset.peRelever)));
  const tip = container.querySelector("#pe-tip");
  container.querySelectorAll(".pe-hit").forEach(r => {
    r.addEventListener("mousemove", e => {
      const m = mois[+r.dataset.i], d = pct(m.n, m.p);
      tip.style.display = "block"; tip.style.left = (e.clientX + 14) + "px"; tip.style.top = (e.clientY + 10) + "px";
      tip.innerHTML = `<b>${esc(m.long)}</b>Période : ${fmt(m.n)}<br>Année précédente : ${fmt(m.p)}${d === null ? "" : `<br><span class="${d > 0 ? "pe-hausse" : "pe-baisse"}">${d > 0 ? "▲" : "▼"} ${fmt(Math.abs(d), 1)} %</span>`}`;
    });
    r.addEventListener("mouseleave", () => { tip.style.display = "none"; });
  });
}

// Barres groupées (période en bleu, N-1 en gris), un seul axe, extrémités
// arrondies ancrées sur la ligne de base ; zone de survol par mois entier.
function graphe(mois, unite, couleur) {
  const W = 760, H = 280, L = 58, B = 30, T = 12;
  const vals = mois.flatMap(m => [m.n, m.p]).filter(v => v !== null);
  if (!vals.length) return `<p class="pe-muet" style="padding:40px 0;text-align:center">Pas encore assez d'historique de relevés pour tracer les consommations mensuelles.</p>`;
  const brut = Math.max(...vals) || 1;
  const pas = Math.pow(10, Math.floor(Math.log10(brut)));
  const max = Math.ceil(brut / pas / 2) * pas * 2 || 1;
  const cw = (W - L - 8) / mois.length, bw = Math.min(16, cw / 2 - 3);
  let s = "";
  for (let k = 0; k <= 4; k++) {
    const y = T + (H - T - B) * (1 - k / 4);
    s += `<line x1="${L}" x2="${W - 8}" y1="${y}" y2="${y}" stroke="#EEF0F3"/><text x="${L - 8}" y="${y + 4}" font-size="11" text-anchor="end" fill="#8A8D93">${fmt(max * k / 4)}</text>`;
  }
  const barre = (x, v, c) => {
    if (v === null) return "";
    const h = Math.max(1, (H - T - B) * v / max), y = H - B - h, r = Math.min(4, h, bw / 2);
    return `<path d="M${x},${H - B} V${y + r} Q${x},${y} ${x + r},${y} H${x + bw - r} Q${x + bw},${y} ${x + bw},${y + r} V${H - B} Z" fill="${c}"/>`;
  };
  mois.forEach((m, i) => {
    const x0 = L + i * cw + cw / 2 - bw - 1;
    s += barre(x0, m.p, GRIS) + barre(x0 + bw + 2, m.n, couleur || BLEU);
    if (m.n !== null && m.n > 0) { const hy = H - B - Math.max(1, (H - T - B) * m.n / max); s += `<text x="${x0 + bw + 2 + bw / 2}" y="${hy - 4}" font-size="10" text-anchor="middle" fill="#52514e">${fmt(m.n)}</text>`; }
    s += `<text x="${L + i * cw + cw / 2}" y="${H - 10}" font-size="11" text-anchor="middle" fill="#52514e">${esc(m.label)}</text>`;
    s += `<rect class="pe-hit" data-i="${i}" x="${L + i * cw}" y="${T}" width="${cw}" height="${H - T - B}" fill="transparent"/>`;
  });
  s += `<line x1="${L}" x2="${W - 8}" y1="${H - B}" y2="${H - B}" stroke="#C9CCD2"/>`;
  return `<svg viewBox="0 0 ${W} ${H}" class="pe-graphe" role="img" aria-label="Consommation mensuelle en ${esc(unite)}">${s}</svg>`;
}

function anneau(p, t = 64, ep = 8) {
  const r = (t - ep) / 2, c = 2 * Math.PI * r, v = Math.max(0, Math.min(100, p));
  const col = v >= 90 ? "#0ca30c" : v >= 50 ? "#eda100" : "#d03b3b";
  return `<svg width="${t}" height="${t}" viewBox="0 0 ${t} ${t}"><circle cx="${t / 2}" cy="${t / 2}" r="${r}" fill="none" stroke="#EEF0F3" stroke-width="${ep}"/><circle cx="${t / 2}" cy="${t / 2}" r="${r}" fill="none" stroke="${col}" stroke-width="${ep}" stroke-linecap="round" stroke-dasharray="${(v / 100) * c} ${c}" transform="rotate(-90 ${t / 2} ${t / 2})"/><text x="50%" y="50%" dy=".35em" text-anchor="middle" font-size="14" font-weight="800" fill="currentColor">${v}%</text></svg>`;
}

function sparkline(valeurs, couleur = BLEU, W = 92, H = 26) {
  const v = valeurs.map(x => x === null ? null : x);
  const connus = v.filter(x => x !== null);
  if (connus.length < 2) return `<span class="pe-muet">—</span>`;
  const max = Math.max(...connus) || 1, min = Math.min(...connus);
  const pts = v.map((x, i) => x === null ? null : [(i / (v.length - 1)) * (W - 4) + 2, H - 3 - ((x - min) / ((max - min) || 1)) * (H - 6)]);
  let d = "", enCours = false;
  pts.forEach(p => { if (!p) { enCours = false; return; } d += (enCours ? " L" : " M") + p[0].toFixed(1) + "," + p[1].toFixed(1); enCours = true; });
  const dernier = [...pts].reverse().find(Boolean);
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><path d="${d}" fill="none" stroke="${couleur}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${dernier[0]}" cy="${dernier[1]}" r="2.5" fill="${couleur}"/></svg>`;
}

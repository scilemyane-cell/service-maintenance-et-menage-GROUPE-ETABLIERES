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
import { estEnRetard, uniteValeur, clesIndex } from "./compteurs-data.js";

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
const decalerAn = (d, n) => { const x = new Date(d); x.setFullYear(x.getFullYear() + n); return x; };
const pct = (a, b) => (a === null || b === null || !b) ? null : ((a - b) / b) * 100;

// État des filtres, conservé tant que l'onglet reste ouvert.
const f = { periode: "12mois", ug: "", energie: "", energieGraphe: null, tri: "nom", sens: 1 };

export function renderPilotage(container, { compteurs: tousCompteurs, sites, associations, releves, onRetour, onRelever, onOuvrirSite }) {
  // ---------- Index des relevés par compteur (chronologique) ----------
  const parCompteur = new Map();
  releves.forEach(r => { if (!r.createdAt) return; (parCompteur.get(r.compteurId) || parCompteur.set(r.compteurId, []).get(r.compteurId)).push(r); });
  parCompteur.forEach(l => l.sort((a, b) => a.createdAt - b.createdAt));
  const valeurAvant = (c, ms) => {
    const liste = parCompteur.get(c.id) || [], cles = clesIndex(c);
    let derniere = null;
    for (const r of liste) {
      if (r.createdAt >= ms) break;
      let t = 0, ok = false;
      cles.forEach(k => { if (r.illisibles?.[k]) return; const v = parseFloat(String(r.valeurs?.[k] ?? "").replace(",", ".")); if (!isNaN(v)) { t += v; ok = true; } });
      if (ok) derniere = t;
    }
    return derniere;
  };
  const conso = (c, t0, t1) => {
    const a = valeurAvant(c, t0), b = valeurAvant(c, t1);
    return a === null || b === null || b < a ? null : b - a;
  };
  const somme = (liste, t0, t1) => {
    let s = 0, ok = false;
    liste.forEach(c => { const v = conso(c, t0, t1); if (v !== null) { s += v; ok = true; } });
    return ok ? s : null;
  };

  // ---------- Filtres ----------
  const siteParId = new Map(sites.map(s => [s.id, s]));
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
    return { ...e, v, vp, d: pct(v, vp), unite: uniteValeur({ type: e.id }) };
  });
  const enRetard = compteurs.filter(estEnRetard);
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
    titre: `${enRetard.length} compteur${enRetard.length > 1 ? "s" : ""} en retard de relevé`,
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
          <select id="pe-energie"><option value="">Toutes énergies</option>${ENERGIES.filter(e => tousCompteurs.some(c => c.type === e.id)).map(e => `<option value="${e.id}" ${f.energie === e.id ? "selected" : ""}>${e.label}</option>`).join("")}</select>
          <button id="pe-pdf">⤓ Exporter PDF</button>
        </div>
      </div>

      <div class="pe-kpis">
        ${kpis.map(x => `
          <div class="pe-carte pe-kpi">
            <div class="pe-lab"><i style="background:${x.couleur}"></i>${x.label} · ${libPeriode}</div>
            <div class="pe-val">${fmt(x.v)}<small>${x.unite}</small></div>
            ${ecart(x.d)}<span class="pe-sous">${x.vp === null ? "pas de donnée N-1" : "vs N-1"}</span>
          </div>`).join("")}
        <div class="pe-carte pe-kpi">
          <div class="pe-lab">Relevés à jour</div>
          <div class="pe-val">${tauxAJour ?? "—"}<small>%</small></div>
          ${enRetard.length ? `<span class="pe-delta pe-hausse">${enRetard.length} compteur${enRetard.length > 1 ? "s" : ""} en retard</span>` : `<span class="pe-delta pe-baisse">✓ tout est à jour</span>`}
        </div>
      </div>

      <div class="pe-deux">
        <div class="pe-carte">
          <div class="pe-titre-graphe">
            <div><h2>Consommation ${eG ? `${eG.id === "eau" ? "d'" : "de "}${eG.label.toLowerCase()}` : ""} par mois</h2><p class="pe-st">${f.ug || "Tous sites"} · ${eG ? uniteValeur({ type: eG.id }) : ""} · comparaison avec l'année précédente</p></div>
            <div class="pe-chips">${energiesPresentes.map(e => `<button data-pe-graphe="${e.id}" class="${e.id === f.energieGraphe ? "pe-on" : ""}"><i style="background:${e.couleur}"></i>${e.label}</button>`).join("")}</div>
          </div>
          <div class="pe-legende"><span><i style="background:${BLEU}"></i>12 derniers mois</span><span><i style="background:${GRIS}"></i>Année précédente</span></div>
          ${graphe(mois, eG ? uniteValeur({ type: eG.id }) : "")}
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

      <div class="pe-carte">
        <h2>Détail par site</h2>
        <p class="pe-st">Consommation sur ${libPeriode}, écart avec la même période de l'année précédente, tendance mensuelle (${eG ? eG.label.toLowerCase() : ""}), relevés — clic sur un en-tête pour trier, sur un site pour l'ouvrir</p>
        <div class="pe-scroll"><table class="pe-table">
          <thead><tr>
            <th data-pe-tri="nom">Site${flecheTri("nom")}</th><th data-pe-tri="ug">UG${flecheTri("ug")}</th>
            ${energiesPresentes.map(e => `<th class="n" data-pe-tri="${e.id}">${e.label} (${uniteValeur({ type: e.id })})${flecheTri(e.id)}</th>`).join("")}
            <th class="n" data-pe-tri="ecart">vs N-1${flecheTri("ecart")}</th><th>Tendance 12 mois</th>
            <th data-pe-tri="couverture">Relevés à jour${flecheTri("couverture")}</th><th data-pe-tri="etat">État${flecheTri("etat")}</th>
          </tr></thead>
          <tbody>${lignes.map(l => `
            <tr data-pe-site="${l.s.id}" class="pe-clic">
              <td><b>${esc(nomCourt(l.s.nom))}</b></td><td>${esc(l.s.association || "—")}</td>
              ${energiesPresentes.map(e => `<td class="n">${l.parE[e.id] ? fmt(l.parE[e.id].v) : `<span class="pe-muet">·</span>`}</td>`).join("")}
              <td class="n">${ecart(l.dRef)}</td>
              <td>${l.tendance ? sparkline(l.tendance) : `<span class="pe-muet">—</span>`}</td>
              <td><span class="pe-couv"><span style="width:${Math.round(l.couverture * 100)}%"></span></span>${Math.round(l.couverture * 100)} %</td>
              <td>${l.retard ? `<span class="pe-badge pe-b-ko">● ${l.retard} en retard</span>` : l.illisible ? `<span class="pe-badge pe-b-w">? Illisible</span>` : `<span class="pe-badge pe-b-ok">✓ À jour</span>`}</td>
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
  container.querySelector("#pe-energie")?.addEventListener("change", e => { f.energie = e.target.value; if (e.target.value) f.energieGraphe = e.target.value; rerendre(); });
  container.querySelectorAll("[data-pe-graphe]").forEach(b => b.addEventListener("click", () => { f.energieGraphe = b.dataset.peGraphe; rerendre(); }));
  container.querySelectorAll("[data-pe-tri]").forEach(th => th.addEventListener("click", () => {
    const c = th.dataset.peTri; if (f.tri === c) f.sens *= -1; else { f.tri = c; f.sens = c === "nom" || c === "ug" ? 1 : -1; } rerendre();
  }));
  container.querySelectorAll("[data-pe-site]").forEach(el => el.addEventListener("click", () => onOuvrirSite(el.dataset.peSite)));
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
function graphe(mois, unite) {
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
    s += barre(x0, m.p, GRIS) + barre(x0 + bw + 2, m.n, BLEU);
    s += `<text x="${L + i * cw + cw / 2}" y="${H - 10}" font-size="11" text-anchor="middle" fill="#52514e">${esc(m.label)}</text>`;
    s += `<rect class="pe-hit" data-i="${i}" x="${L + i * cw}" y="${T}" width="${cw}" height="${H - T - B}" fill="transparent"/>`;
  });
  s += `<line x1="${L}" x2="${W - 8}" y1="${H - B}" y2="${H - B}" stroke="#C9CCD2"/>`;
  return `<svg viewBox="0 0 ${W} ${H}" class="pe-graphe" role="img" aria-label="Consommation mensuelle en ${esc(unite)}">${s}</svg>`;
}

function sparkline(valeurs) {
  const W = 92, H = 26, v = valeurs.map(x => x === null ? null : x);
  const connus = v.filter(x => x !== null);
  if (connus.length < 2) return `<span class="pe-muet">—</span>`;
  const max = Math.max(...connus) || 1, min = Math.min(...connus);
  const pts = v.map((x, i) => x === null ? null : [(i / (v.length - 1)) * (W - 4) + 2, H - 3 - ((x - min) / ((max - min) || 1)) * (H - 6)]);
  let d = "", enCours = false;
  pts.forEach(p => { if (!p) { enCours = false; return; } d += (enCours ? " L" : " M") + p[0].toFixed(1) + "," + p[1].toFixed(1); enCours = true; });
  const dernier = [...pts].reverse().find(Boolean);
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><path d="${d}" fill="none" stroke="${BLEU}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${dernier[0]}" cy="${dernier[1]}" r="2.5" fill="${BLEU}"/></svg>`;
}

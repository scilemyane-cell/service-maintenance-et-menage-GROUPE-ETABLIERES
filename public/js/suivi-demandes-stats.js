// suivi-demandes-stats.js — Tableau de bord « Statistiques » du Suivi des
// demandes, calculé EN DIRECT depuis les demandes Firestore (plus de photo
// figée). Graphiques en SVG maison (aucune librairie), avec infobulles.
import { esc } from "./astreinte-logic.js";

const MOIS_COURTS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const MOIS_LONGS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
const JOURS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const ORDRE_URG = ["Critique", "Urgent", "Normal", "À planifier", "Non renseignée"];
const ASSOS = ["Agropolis", "École", "Armonia"]; // ordre fixe = couleur fixe par association

const st = { periode: "12m", association: "", moisSel: null };

const dateValide = (v) => {
  // Accepte "AAAA-MM-JJ", "JJ/MM/AAAA", un horodatage Firestore, un nombre ou une Date.
  if (!v) return null;
  let d = null;
  if (typeof v === "string") {
    const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})/), fr = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (iso) d = new Date(+iso[1], +iso[2] - 1, +iso[3]);
    else if (fr) d = new Date(+fr[3], +fr[2] - 1, +fr[1]);
  } else if (typeof v === "number") d = new Date(v > 1e11 ? v : v > 20000 && v < 80000 ? Math.round((v - 25569) * 86400000) : v * 1000);
  else if (v.toDate) d = v.toDate();
  else if (v instanceof Date) d = v;
  else if (typeof v.seconds === "number") d = new Date(v.seconds * 1000);
  if (!d || isNaN(d)) return null;
  d = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const y = d.getFullYear(), maxY = new Date().getFullYear() + 1;
  return y < 2020 || y > maxY ? null : d;
};
const jours = (a, b) => Math.round((b - a) / 86400000);
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);
const fmt = (n) => Number(n).toLocaleString("fr-FR");
const cleMois = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const estOuverte = (l) => l.statut !== "Réalisé" && l.statut !== "Annulé";
const mediane = (arr) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };

function debutPeriode() {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  if (st.periode === "mois") return new Date(t.getFullYear(), t.getMonth(), 1);
  if (st.periode === "3m") return new Date(t.getFullYear(), t.getMonth() - 2, 1);
  if (st.periode === "12m") return new Date(t.getFullYear(), t.getMonth() - 11, 1);
  if (st.periode === "scolaire") return new Date(t.getMonth() >= 8 ? t.getFullYear() : t.getFullYear() - 1, 8, 1);
  return null;
}

// ---------- petits composants graphiques ----------
function anneau(valeur, taille = 92, ep = 9, couleur = "var(--dst-good)") {
  const r = (taille - ep) / 2, c = 2 * Math.PI * r, v = Math.max(0, Math.min(100, valeur));
  return `<svg width="${taille}" height="${taille}" viewBox="0 0 ${taille} ${taille}" class="dst-anneau" aria-hidden="true">
    <circle cx="${taille / 2}" cy="${taille / 2}" r="${r}" fill="none" stroke="rgba(255,255,255,.14)" stroke-width="${ep}"/>
    <circle cx="${taille / 2}" cy="${taille / 2}" r="${r}" fill="none" stroke="${couleur}" stroke-width="${ep}" stroke-linecap="round"
      stroke-dasharray="${(v / 100) * c} ${c}" transform="rotate(-90 ${taille / 2} ${taille / 2})"/>
    <text x="50%" y="50%" dy=".35em" text-anchor="middle" class="dst-anneau-txt">${v}%</text></svg>`;
}

function donut(data, total, libelle) {
  const size = 168, r = 62, sw = 20, cx = size / 2, circ = 2 * Math.PI * r;
  let off = 0;
  const segs = data.filter(d => d.v > 0).map(d => {
    const frac = d.v / total, len = Math.max(0, frac * circ - 2);
    const s = `<circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="${d.c}" stroke-width="${sw}" stroke-dasharray="${len} ${circ - len}"
      stroke-dashoffset="${-off + circ / 4}" data-tip="<b>${esc(d.n)}</b><br>${fmt(d.v)} demandes · ${pct(d.v, total)} %" class="dst-hit"/>`;
    off += frac * circ; return s;
  }).join("");
  return `<div class="dst-donut">
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="var(--dst-track)" stroke-width="${sw}"/>${segs}
      <text x="50%" y="47%" text-anchor="middle" class="dst-donut-v">${fmt(total)}</text><text x="50%" y="60%" text-anchor="middle" class="dst-donut-l">${esc(libelle)}</text></svg>
    <ul class="dst-leg">${data.filter(d => d.v > 0).map(d => `<li><i style="background:${d.c}"></i><span>${esc(d.n)}</span><b>${fmt(d.v)}</b><em>${pct(d.v, total)} %</em></li>`).join("")}</ul>
  </div>`;
}

// Barres horizontales classées (sites, types, intervenants…)
function barresH(rows, { max, couleur = "var(--dst-s1)", suffixe = "" } = {}) {
  const m = max || Math.max(1, ...rows.map(r => r.v));
  return `<div class="dst-bh">${rows.map((r, i) => `
    <div class="dst-bh-l" data-tip="<b>${esc(r.n)}</b><br>${fmt(r.v)}${suffixe}${r.tip ? "<br>" + r.tip : ""}">
      <span class="dst-bh-rang">${i + 1}</span>
      <span class="dst-bh-nom">${esc(r.n)}</span>
      <span class="dst-bh-piste"><span style="width:${Math.max(2, (r.v / m) * 100)}%;background:${r.c || couleur}"></span></span>
      <b class="dst-bh-v">${fmt(r.v)}</b>
    </div>`).join("")}</div>`;
}

// Histogramme mensuel empilé par statut (reçues chaque mois)
function histoMensuel(mois) {
  const W = 760, H = 250, pb = 30, pt = 24, pl = 34, pr = 8;
  const max = Math.max(4, ...mois.map(m => m.total));
  const pas = Math.pow(10, Math.floor(Math.log10(max))); const top = Math.ceil(max / pas) * pas;
  const y = (v) => H - pb - (v / top) * (H - pb - pt);
  const bw = (W - pl - pr) / mois.length, larg = Math.min(34, bw * 0.62);
  const grilles = [0, 0.5, 1].map(f => { const v = Math.round(top * f); return `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}" class="dst-grid"/><text x="${pl - 6}" y="${y(v) + 4}" text-anchor="end" class="dst-axe">${v}</text>`; }).join("");
  const barres = mois.map((m, i) => {
    const x = pl + i * bw + (bw - larg) / 2;
    let base = 0;
    const couches = [["Réalisé", m.real, "var(--dst-good)"], ["En cours", m.ouv, "var(--dst-warn)"], ["Annulé", m.ann, "var(--dst-crit)"]].filter(c => c[1] > 0);
    const rects = couches.map(([n, v, c], k) => {
      const y1 = y(base + v), h = Math.max(0, y(base) - y1 - (k > 0 ? 2 : 0));
      base += v;
      const dernier = k === couches.length - 1;
      return `<rect x="${x}" y="${y1}" width="${larg}" height="${h}" fill="${c}" ${dernier ? `rx="4"` : ""}/>${dernier && h > 4 ? `<rect x="${x}" y="${y1 + 4}" width="${larg}" height="${Math.max(0, h - 4)}" fill="${c}"/>` : ""}`;
    }).join("");
    const tip = `<b>${esc(m.label)}</b><br>${fmt(m.total)} reçues<br><i class='dst-dot' style='background:var(--dst-good)'></i>${fmt(m.real)} réalisées (${pct(m.real, m.total)} %)<br><i class='dst-dot' style='background:var(--dst-warn)'></i>${fmt(m.ouv)} en cours<br><i class='dst-dot' style='background:var(--dst-crit)'></i>${fmt(m.ann)} annulées`;
    return `<g class="dst-col" data-tip="${tip}" data-mois="${m.cle}"><rect x="${pl + i * bw}" y="${pt - 16}" width="${bw}" height="${H - pt + 16}" fill="transparent"/>${rects}
      ${m.total ? `<text x="${x + larg / 2}" y="${y(m.total) - 6}" text-anchor="middle" class="dst-val">${m.total}</text>` : ""}
      <text x="${x + larg / 2}" y="${H - 10}" text-anchor="middle" class="dst-axe">${m.court}</text></g>`;
  }).join("");
  return `<svg viewBox="0 0 ${W} ${H}" class="dst-svg" preserveAspectRatio="xMidYMid meet">${grilles}${barres}</svg>`;
}

// ---------- flux mensuel : arrivées / traitées / stock ----------
// Date de traitement : réalisée → date d'intervention (sinon validation, statut,
// déclaration) ; annulée → date du statut. Sans date connue : considérée
// traitée le jour de la demande (elle ne gonfle pas le stock à tort).
const dateTraitement = (l) => l.statut === "Réalisé" ? (dateValide(l.dateIntervention) || dateValide(l.dateValidation) || dateValide(l.dateStatut) || dateValide(l.declareLe))
  : l.statut === "Annulé" ? (dateValide(l.dateStatut) || dateValide(l.dateValidation)) : null;
const finMois = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0);

function fluxMensuel(lignes, nb = 12, fin = new Date()) {
  const mois = [];
  for (let k = nb - 1; k >= 0; k--) {
    const d = new Date(fin.getFullYear(), fin.getMonth() - k, 1), f = finMois(d), cle = cleMois(d);
    const arrivees = lignes.filter(l => l.d && cleMois(l.d) === cle);
    const traitees = lignes.filter(l => l.dt && cleMois(l.dt) === cle);
    const stock = lignes.filter(l => l.d && l.d <= f && !(l.dt && l.dt <= f) && !(l.traite && !l.dt)).length;
    mois.push({ cle, court: MOIS_COURTS[d.getMonth()], label: `${MOIS_LONGS[d.getMonth()]} ${d.getFullYear()}`, arr: arrivees.length,
      real: traitees.filter(l => l.statut === "Réalisé").length, ann: traitees.filter(l => l.statut === "Annulé").length, trait: traitees.length, stock });
  }
  return mois;
}

// Barres groupées : arrivées (bleu) / traitées (vert) par mois
function histoFlux(mois, sel) {
  const W = 760, H = 250, pb = 30, pt = 24, pl = 34, pr = 8;
  const max = Math.max(4, ...mois.flatMap(m => [m.arr, m.trait]));
  const pas = Math.pow(10, Math.floor(Math.log10(max))); const top = Math.ceil(max / pas) * pas;
  const y = (v) => H - pb - (v / top) * (H - pb - pt);
  const bw = (W - pl - pr) / mois.length, larg = Math.min(16, bw * 0.3);
  const grilles = [0, 0.5, 1].map(f => { const v = Math.round(top * f); return `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}" class="dst-grid"/><text x="${pl - 6}" y="${y(v) + 4}" text-anchor="end" class="dst-axe">${v}</text>`; }).join("");
  const barre = (x, v, c) => v ? `<rect x="${x}" y="${y(v)}" width="${larg}" height="${Math.max(0, y(0) - y(v))}" rx="3" fill="${c}"/>` : "";
  const cols = mois.map((m, i) => {
    const cx = pl + i * bw + bw / 2, x1 = cx - larg - 1, x2 = cx + 1;
    const solde = m.arr - m.trait;
    const tip = `<b>${esc(m.label)}</b><br><i class='dst-dot' style='background:var(--dst-s1)'></i>${fmt(m.arr)} arrivée${m.arr > 1 ? "s" : ""}<br><i class='dst-dot' style='background:var(--dst-s3)'></i>${fmt(m.trait)} traitée${m.trait > 1 ? "s" : ""} (${fmt(m.real)} réalisée${m.real > 1 ? "s" : ""}, ${fmt(m.ann)} annulée${m.ann > 1 ? "s" : ""})<br>Solde : ${solde > 0 ? "+" : ""}${solde} · stock fin de mois : ${fmt(m.stock)}`;
    return `<g class="dst-col ${m.cle === sel ? "sel" : ""}" data-tip="${tip}" data-dst-mois="${m.cle}" style="cursor:pointer">
      <rect x="${pl + i * bw}" y="${pt - 16}" width="${bw}" height="${H - pt + 16}" fill="${m.cle === sel ? "var(--dst-track)" : "transparent"}" rx="6"/>
      ${barre(x1, m.arr, "var(--dst-s1)")}${barre(x2, m.trait, "var(--dst-s3)")}
      ${m.arr ? `<text x="${x1 + larg / 2}" y="${y(m.arr) - 5}" text-anchor="middle" class="dst-val">${m.arr}</text>` : ""}
      ${m.trait ? `<text x="${x2 + larg / 2}" y="${y(m.trait) - 5}" text-anchor="middle" class="dst-val">${m.trait}</text>` : ""}
      <text x="${cx}" y="${H - 10}" text-anchor="middle" class="dst-axe">${m.court}</text></g>`;
  }).join("");
  return `<svg viewBox="0 0 ${W} ${H}" class="dst-svg" preserveAspectRatio="xMidYMid meet">${grilles}${cols}</svg>`;
}

// Courbe du stock en attente en fin de mois
function courbeStock(mois, sel) {
  const W = 760, H = 170, pb = 28, pt = 22, pl = 34, pr = 14;
  const max = Math.max(4, ...mois.map(m => m.stock));
  const pas = Math.pow(10, Math.floor(Math.log10(max))); const top = Math.ceil(max / pas) * pas;
  const y = (v) => H - pb - (v / top) * (H - pb - pt);
  const bw = (W - pl - pr) / mois.length, x = (i) => pl + i * bw + bw / 2;
  const pts = mois.map((m, i) => `${x(i)},${y(m.stock)}`).join(" ");
  const grilles = [0, 0.5, 1].map(f => { const v = Math.round(top * f); return `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}" class="dst-grid"/><text x="${pl - 6}" y="${y(v) + 4}" text-anchor="end" class="dst-axe">${v}</text>`; }).join("");
  const aire = `${x(0)},${y(0)} ${pts} ${x(mois.length - 1)},${y(0)}`;
  return `<svg viewBox="0 0 ${W} ${H}" class="dst-svg" preserveAspectRatio="xMidYMid meet">${grilles}
    <polygon points="${aire}" fill="color-mix(in srgb,var(--dst-s2) 12%,transparent)"/>
    <polyline points="${pts}" fill="none" stroke="var(--dst-s2)" stroke-width="2.5" stroke-linejoin="round"/>
    ${mois.map((m, i) => `<g class="dst-col" data-tip="<b>${esc(m.label)}</b><br>${fmt(m.stock)} demande${m.stock > 1 ? "s" : ""} en attente en fin de mois" data-dst-mois="${m.cle}" style="cursor:pointer">
      <rect x="${pl + i * bw}" y="${pt - 12}" width="${bw}" height="${H - pt}" fill="transparent"/>
      <circle cx="${x(i)}" cy="${y(m.stock)}" r="${m.cle === sel ? 6 : 4}" fill="var(--dst-s2)" stroke="var(--dst-card)" stroke-width="2"/>
      ${i === mois.length - 1 || m.cle === sel ? `<text x="${x(i)}" y="${y(m.stock) - 10}" text-anchor="middle" class="dst-val">${m.stock}</text>` : ""}
      <text x="${x(i)}" y="${H - 8}" text-anchor="middle" class="dst-axe">${m.court}</text></g>`).join("")}</svg>`;
}

// ---------- calculs ----------
function calculer(toutes) {
  const debut = debutPeriode();
  const auj = new Date(); auj.setHours(0, 0, 0, 0);
  const avecAssoc = toutes.filter(l => !st.association || l.association === st.association);
  const lignes = avecAssoc.map(l => { const d = dateValide(l.date), traite = l.statut === "Réalisé" || l.statut === "Annulé"; let dt = dateTraitement(l); if (traite && !dt) dt = d; return { ...l, d, dt, traite, di: dateValide(l.dateIntervention) || (l.statut === "Réalisé" ? dateValide(l.dateStatut) : null) }; });
  const periode = lignes.filter(l => !debut || (l.d && l.d >= debut));
  const total = periode.length;
  const real = periode.filter(l => l.statut === "Réalisé").length;
  const ann = periode.filter(l => l.statut === "Annulé").length;
  // Stock « ouvert » : toutes les demandes encore à traiter (quelle que soit la période)
  const ouvertes = lignes.filter(estOuverte);
  const ages = ouvertes.filter(l => l.d).map(l => jours(l.d, auj));
  const delais = periode.filter(l => l.statut === "Réalisé" && l.d && l.di && l.di >= l.d).map(l => jours(l.d, l.di));
  const urgentesOuvertes = ouvertes.filter(l => l.urgence === "Urgent" || l.urgence === "Critique");
  const vieilles = ouvertes.filter(l => l.d && jours(l.d, auj) > 30);

  // 12 derniers mois (toujours 12 pour la tendance)
  const mois = [];
  for (let k = 11; k >= 0; k--) {
    const d = new Date(auj.getFullYear(), auj.getMonth() - k, 1);
    const cle = cleMois(d), l = lignes.filter(x => x.d && cleMois(x.d) === cle);
    mois.push({ cle, court: MOIS_COURTS[d.getMonth()], label: `${MOIS_LONGS[d.getMonth()]} ${d.getFullYear()}`, total: l.length,
      real: l.filter(x => x.statut === "Réalisé").length, ann: l.filter(x => x.statut === "Annulé").length, ouv: l.filter(estOuverte).length });
  }
  const moisCourant = mois[11], moisPrec = mois[10];

  const compte = (arr, cle) => { const o = {}; arr.forEach(l => { const k = l[cle] || "Non renseigné"; o[k] = (o[k] || 0) + 1; }); return Object.entries(o).sort((a, b) => b[1] - a[1]); };

  const sites = {};
  periode.forEach(l => { const s = sites[l.site] || (sites[l.site] = { n: l.site, v: 0, ouv: 0, real: 0 }); s.v++; if (estOuverte(l)) s.ouv++; if (l.statut === "Réalisé") s.real++; });
  const urg = ORDRE_URG.map(u => { const l = periode.filter(x => (x.urgence || "Non renseignée") === u); return { n: u, v: l.length, real: l.filter(x => x.statut === "Réalisé").length, ouv: l.filter(estOuverte).length }; }).filter(u => u.v);
  const tranches = [["Moins de 7 jours", 0, 7], ["7 à 30 jours", 7, 31], ["1 à 3 mois", 31, 91], ["Plus de 3 mois", 91, 1e9]]
    .map(([n, a, b]) => ({ n, v: ages.filter(x => x >= a && x < b).length }));
  const jourSem = [0, 0, 0, 0, 0, 0, 0]; periode.forEach(l => { if (l.d) jourSem[(l.d.getDay() + 6) % 7]++; });

  // Flux sur 12 mois + détail du mois choisi
  const flux = fluxMensuel(lignes, 12);
  if (!st.moisSel || !flux.some(m => m.cle === st.moisSel)) st.moisSel = flux[flux.length - 1].cle;
  const ms = flux.find(m => m.cle === st.moisSel), iMs = flux.indexOf(ms), msPrec = flux[iMs - 1] || null;
  const arrM = lignes.filter(l => l.d && cleMois(l.d) === ms.cle), traitM = lignes.filter(l => l.dt && cleMois(l.dt) === ms.cle && l.traite);
  const delaisM = traitM.filter(l => l.statut === "Réalisé" && l.d && l.dt >= l.d).map(l => jours(l.d, l.dt));
  const parSiteM = {}; arrM.forEach(l => { (parSiteM[l.site] ||= { n: l.site, arr: 0, trait: 0 }).arr++; }); traitM.forEach(l => { (parSiteM[l.site] ||= { n: l.site, arr: 0, trait: 0 }).trait++; });
  const quiTraite = (l) => l.attribueANom || l.declarePar || l.contact || l.intervenant || "Non renseigné";
  const parQuiM = {}; traitM.filter(l => l.statut === "Réalisé").forEach(l => { const k = String(quiTraite(l)).trim(); parQuiM[k] = (parQuiM[k] || 0) + 1; });
  const urgArrM = ORDRE_URG.map(u => ({ n: u, v: arrM.filter(x => (x.urgence || "Non renseignée") === u).length })).filter(u => u.v);
  const detail = { ms, msPrec, arrM, traitM, delaisM, sites: Object.values(parSiteM).sort((a, b) => (b.arr + b.trait) - (a.arr + a.trait)), qui: Object.entries(parQuiM).sort((a, b) => b[1] - a[1]), urgArr: urgArrM };
  return { flux, detail, total, real, ann, ouv: total - real - ann, ouvertes, ages, delais, urgentesOuvertes, vieilles, mois, moisCourant, moisPrec,
    assos: compte(periode, "association"), statuts: compte(periode, "statut"), types: compte(periode.filter(l => l.type), "type"),
    intervenants: compte(periode.filter(l => (l.contact || l.intervenant) && l.statut === "Réalisé").map(l => ({ ...l, qui: l.contact || l.intervenant })), "qui"),
    sites: Object.values(sites).sort((a, b) => b.v - a.v), urg, tranches, jourSem, sansDate: avecAssoc.filter(l => !dateValide(l.date)).length };
}

// ---------- rendu ----------
export function renderStatsDemandes(container, toutes, { toggleHTML, onToggle, ouvrirTableau, source = "direct", extrait = "", doublons = 0 }) {
  if (!toutes) { container.innerHTML = `<div class="stack">${toggleHTML}<div class="hint">Chargement des demandes…</div></div>`; onToggle(); return; }
  const s = calculer(toutes);
  const libPeriode = { mois: "ce mois-ci", "3m": "sur 3 mois", "12m": "sur 12 mois", scolaire: "depuis la rentrée", tout: "depuis le début" }[st.periode];
  const delta = s.moisCourant.total - s.moisPrec.total;
  const med = mediane(s.delais), ageMed = mediane(s.ages);
  const couleurAssoc = (n) => { const i = ASSOS.indexOf(n); return i >= 0 ? `var(--dst-s${i + 1})` : "var(--dst-autre)"; };
  const couleurStatut = (n) => n === "Réalisé" ? "var(--dst-good)" : n === "Annulé" ? "var(--dst-crit)" : "var(--dst-warn)";
  const maxSite = Math.max(1, ...s.sites.slice(0, 10).map(x => x.v));
  const maxJour = Math.max(1, ...s.jourSem);

  container.innerHTML = `
  <div class="stack dst">
    ${toggleHTML}
    <section class="dst-hero">
      <div class="dst-hero-tete">
        <div><span class="dst-sur">Suivi des demandes · ${source === "fichier" ? "fichier Excel" : "en direct"}</span><h2>Tableau de bord <em>des demandes</em></h2>
          <p>${source === "fichier" ? `Calculé à partir des ${fmt(toutes.length)} demandes du fichier Excel extrait le ${esc(extrait || "—")}. Importe-les dans l'onglet Tableau pour passer en direct.` : `Calculé à partir des ${fmt(toutes.length)} demandes enregistrées — se met à jour dès qu'un statut change.${doublons ? ` <b>🔗 ${fmt(doublons)} doublon${doublons > 1 ? "s" : ""} relié${doublons > 1 ? "s" : ""} non compté${doublons > 1 ? "s" : ""}.</b>` : ""}`}</p></div>
        <div class="dst-filtres">
          <div class="dst-seg">${[["mois", "Mois"], ["3m", "3 mois"], ["12m", "12 mois"], ["scolaire", "Année scol."], ["tout", "Tout"]].map(([k, l]) => `<button data-dst-per="${k}" class="${st.periode === k ? "on" : ""}">${l}</button>`).join("")}</div>
          <div class="dst-seg dst-seg-a">${[["", "Toutes"], ...ASSOS.map(a => [a, a])].map(([k, l]) => `<button data-dst-asso="${esc(k)}" class="${st.association === k ? "on" : ""}">${esc(l)}</button>`).join("")}</div>
        </div>
      </div>
      <div class="dst-kpis">
        <div class="dst-kpi"><span>Demandes reçues</span><b>${fmt(s.total)}</b><small>${libPeriode}</small></div>
        <div class="dst-kpi dst-kpi-anneau">${anneau(pct(s.real, s.total - s.ann), 66, 7)}<div><span>Réalisées</span><b class="petit">${fmt(s.real)}</b><small>sur ${fmt(s.total - s.ann)} hors annulées</small></div></div>
        <div class="dst-kpi"><span>En attente aujourd'hui</span><b class="warn">${fmt(s.ouvertes.length)}</b><small>${ageMed !== null ? `ancienneté médiane ${ageMed} j` : "toutes périodes"}</small></div>
        <div class="dst-kpi"><span>Délai de traitement</span><b>${med !== null ? `${med} j` : "—"}</b><small>${med !== null ? `médiane sur ${fmt(s.delais.length)} demandes datées` : "renseigner la date d'intervention"}</small></div>
        <div class="dst-kpi"><span>Ce mois-ci</span><b>${fmt(s.flux[11].arr)} <small style="font-size:.5em;opacity:.8">arrivées</small></b><small>${fmt(s.flux[11].trait)} traitée${s.flux[11].trait > 1 ? "s" : ""} · <span class="${delta > 0 ? "up" : delta < 0 ? "down" : ""}">${delta > 0 ? "▲ +" + delta : delta < 0 ? "▼ " + delta : "="} vs ${MOIS_LONGS[(new Date().getMonth() + 11) % 12].toLowerCase()}</span></small></div>
      </div>
    </section>

    ${s.urgentesOuvertes.length || s.vieilles.length ? `
    <div class="dst-alertes">
      ${s.urgentesOuvertes.length ? `<button class="dst-alerte crit" data-dst-aller="urgent"><span class="dst-al-ico">!</span><div><b>${fmt(s.urgentesOuvertes.length)} demande${s.urgentesOuvertes.length > 1 ? "s" : ""} urgente${s.urgentesOuvertes.length > 1 ? "s" : ""} ou critique${s.urgentesOuvertes.length > 1 ? "s" : ""} en attente</b><small>Voir la liste →</small></div></button>` : ""}
      ${s.vieilles.length ? `<button class="dst-alerte warn" data-dst-aller="attente"><span class="dst-al-ico">⏳</span><div><b>${fmt(s.vieilles.length)} demande${s.vieilles.length > 1 ? "s" : ""} ouverte${s.vieilles.length > 1 ? "s" : ""} depuis plus de 30 jours</b><small>Voir les demandes à traiter →</small></div></button>` : ""}
    </div>` : ""}

    ${(() => { const D = s.detail, m = D.ms, p = D.msPrec, solde = m.arr - m.trait, med = mediane(D.delaisM);
      const evo = (a, b) => b == null ? "" : a > b ? `<small class="up">▲ +${a - b} vs ${p.court}</small>` : a < b ? `<small class="down">▼ ${a - b} vs ${p.court}</small>` : `<small>= ${p.court}</small>`;
      const maxS = Math.max(1, ...D.sites.slice(0, 8).flatMap(x => [x.arr, x.trait]));
      return `
    <section class="dst-carte dst-mois">
      <div class="dst-carte-tete"><div><h3>📅 Le mois en détail</h3><p>Arrivées et demandes traitées dans le mois · clique un mois sur les graphiques pour le changer</p></div>
        <div class="dst-mois-nav"><button data-dst-nav="-1" ${D.ms === s.flux[0] ? "disabled" : ""} aria-label="Mois précédent">‹</button><b>${esc(m.label)}</b><button data-dst-nav="1" ${D.ms === s.flux[s.flux.length - 1] ? "disabled" : ""} aria-label="Mois suivant">›</button></div></div>
      <div class="dst-mkpis">
        <div class="arr"><span>📥 Arrivées</span><b>${fmt(m.arr)}</b>${evo(m.arr, p?.arr)}</div>
        <div class="trait"><span>✅ Traitées</span><b>${fmt(m.trait)}</b><small>${fmt(m.real)} réalisée${m.real > 1 ? "s" : ""} · ${fmt(m.ann)} annulée${m.ann > 1 ? "s" : ""}</small></div>
        <div class="${solde > 0 ? "neg" : "pos"}"><span>⚖️ Solde du mois</span><b>${solde > 0 ? "+" : ""}${fmt(solde)}</b><small>${solde > 0 ? "le stock augmente" : solde < 0 ? "le stock diminue" : "stable"}</small></div>
        <div><span>📦 En attente fin de mois</span><b>${fmt(m.stock)}</b>${evo(m.stock, p?.stock)}</div>
        <div><span>⏱ Délai médian</span><b>${med !== null ? `${med} j` : "—"}</b><small>${D.delaisM.length ? `sur ${fmt(D.delaisM.length)} réalisée${D.delaisM.length > 1 ? "s" : ""}` : "pas de date d'intervention"}</small></div>
      </div>
      <div class="dst-mgrille">
        <div><h4>Par site <small>arrivées / traitées</small></h4>
          ${D.sites.length ? `<div class="dst-ms">${D.sites.slice(0, 8).map(x => `<button class="dst-ms-l" data-dst-site="${esc(x.n)}" data-tip="<b>${esc(x.n)}</b><br>${x.arr} arrivée(s) · ${x.trait} traitée(s)"><span class="n">${esc(x.n)}</span><span class="b"><i class="a" style="width:${(x.arr / maxS) * 100}%"></i><i class="t" style="width:${(x.trait / maxS) * 100}%"></i></span><span class="v"><b>${x.arr}</b> / <b>${x.trait}</b></span></button>`).join("")}</div>` : `<div class="dst-vide">Aucun mouvement ce mois</div>`}</div>
        <div><h4>Réalisées par <small>technicien ou entreprise</small></h4>
          ${D.qui.length ? barresH(D.qui.slice(0, 8).map(([n, v]) => ({ n, v })), { couleur: "var(--dst-s3)", suffixe: " réalisées" }) : `<div class="dst-vide">Aucune réalisée ce mois</div>`}</div>
        <div><h4>Urgence des arrivées</h4>
          ${D.urgArr.length ? barresH(D.urgArr.map(u => ({ n: u.n, v: u.v, c: u.n === "Critique" ? "var(--dst-crit)" : u.n === "Urgent" ? "var(--dst-s2)" : "var(--dst-s1)" })), { suffixe: " arrivées" }).replace(/dst-bh-rang">\d+/g, 'dst-bh-rang">•') : `<div class="dst-vide">—</div>`}</div>
      </div>
    </section>

    <section class="dst-carte">
      <div class="dst-carte-tete"><div><h3>Arrivées et traitées par mois</h3><p>12 derniers mois · une demande est « traitée » le mois de son intervention (ou de son annulation)</p></div>
        <ul class="dst-leg dst-leg-h"><li><i style="background:var(--dst-s1)"></i><span>Arrivées</span></li><li><i style="background:var(--dst-s3)"></i><span>Traitées</span></li></ul></div>
      ${histoFlux(s.flux, st.moisSel)}
    </section>

    <section class="dst-carte">
      <div class="dst-carte-tete"><div><h3>Demandes en attente en fin de mois</h3><p>Le stock monte quand il arrive plus de demandes qu'on n'en traite</p></div></div>
      ${courbeStock(s.flux, st.moisSel)}
    </section>`; })()}

    <div class="dst-grille">
      <section class="dst-carte"><div class="dst-carte-tete"><div><h3>Statut</h3><p>${libPeriode}</p></div></div>
        ${s.total ? donut(s.statuts.map(([n, v]) => ({ n, v, c: couleurStatut(n) })), s.total, "demandes") : `<div class="dst-vide">Aucune demande sur la période</div>`}</section>
      <section class="dst-carte"><div class="dst-carte-tete"><div><h3>Association</h3><p>${libPeriode}</p></div></div>
        ${s.total ? donut(s.assos.map(([n, v]) => ({ n, v, c: couleurAssoc(n) })), s.total, "demandes") : `<div class="dst-vide">—</div>`}</section>
    </div>

    <div class="dst-grille">
      <section class="dst-carte"><div class="dst-carte-tete"><div><h3>Ancienneté des demandes en attente</h3><p>${fmt(s.ouvertes.length)} demandes à traiter, toutes périodes</p></div></div>
        ${barresH(s.tranches.map((t, i) => ({ ...t, c: ["var(--dst-q1)", "var(--dst-q2)", "var(--dst-q3)", "var(--dst-q4)"][i] })), { suffixe: " demandes" }).replace(/dst-bh-rang">\d+/g, 'dst-bh-rang">•')}</section>
      <section class="dst-carte"><div class="dst-carte-tete"><div><h3>Urgence et avancement</h3><p>Part réalisée pour chaque niveau d'urgence</p></div></div>
        <div class="dst-urg">${s.urg.map(u => `
          <div class="dst-urg-l" data-tip="<b>${esc(u.n)}</b><br>${fmt(u.v)} demandes<br>${fmt(u.real)} réalisées · ${fmt(u.ouv)} en cours">
            <span class="dst-urg-n">${esc(u.n)}</span>
            <span class="dst-urg-piste"><span class="r" style="width:${pct(u.real, u.v)}%"></span><span class="o" style="width:${pct(u.ouv, u.v)}%"></span></span>
            <b>${pct(u.real, u.v)} %</b><small>${fmt(u.v)}</small>
          </div>`).join("") || `<div class="dst-vide">—</div>`}</div></section>
    </div>

    <section class="dst-carte">
      <div class="dst-carte-tete"><div><h3>Sites les plus demandeurs</h3><p>${libPeriode} · touche une ligne pour voir ses demandes</p></div></div>
      <div class="dst-sites">
        <div class="dst-sites-l dst-sites-t"><span>#</span><span>Site</span><span>Demandes</span><span>En attente</span><span>Réalisé</span></div>
        ${s.sites.slice(0, 10).map((x, i) => `
        <button class="dst-sites-l" data-dst-site="${esc(x.n)}">
          <span class="dst-rang">${i + 1}</span>
          <span class="dst-site-n">${esc(x.n)}</span>
          <span class="dst-site-b"><i style="width:${(x.v / maxSite) * 100}%"></i><b>${fmt(x.v)}</b></span>
          <span class="${x.ouv ? "dst-att" : "dst-muet"}">${fmt(x.ouv)}</span>
          <span><em class="dst-pill ${pct(x.real, x.v) >= 75 ? "ok" : pct(x.real, x.v) >= 50 ? "moy" : "bas"}">${pct(x.real, x.v)} %</em></span>
        </button>`).join("") || `<div class="dst-vide">—</div>`}
      </div>
    </section>

    <div class="dst-grille dst-grille-3">
      <section class="dst-carte"><div class="dst-carte-tete"><div><h3>Types de demande</h3><p>Top 8 · ${libPeriode}</p></div></div>
        ${s.types.length ? barresH(s.types.slice(0, 8).map(([n, v]) => ({ n, v }))) : `<div class="dst-vide">Type non renseigné</div>`}</section>
      <section class="dst-carte"><div class="dst-carte-tete"><div><h3>Demandes réalisées par intervenant</h3><p>${libPeriode}</p></div></div>
        ${s.intervenants.length ? barresH(s.intervenants.slice(0, 8).map(([n, v]) => ({ n, v })), { couleur: "var(--dst-s3)", suffixe: " réalisées" }) : `<div class="dst-vide">Intervenant non renseigné</div>`}</section>
      <section class="dst-carte"><div class="dst-carte-tete"><div><h3>Jour de la demande</h3><p>Quand les demandes arrivent</p></div></div>
        <div class="dst-jours">${s.jourSem.map((v, i) => `<div class="dst-jour" data-tip="<b>${JOURS[i]}</b><br>${fmt(v)} demandes (${pct(v, s.total)} %)"><span style="height:${Math.max(3, (v / maxJour) * 100)}%"></span><b>${v}</b><small>${JOURS[i]}</small></div>`).join("")}</div></section>
    </div>

    ${s.sansDate ? `<p class="dst-note">${fmt(s.sansDate)} demande${s.sansDate > 1 ? "s" : ""} sans date valide dans le fichier ne ${s.sansDate > 1 ? "sont" : "est"} pas comptée${s.sansDate > 1 ? "s" : ""} dans les périodes (elles restent dans « Tout » pour l'association et le stock en attente).</p>` : ""}
  </div>`;

  onToggle();
  const rerender = () => renderStatsDemandes(container, toutes, { toggleHTML, onToggle, ouvrirTableau, source, extrait });
  container.querySelectorAll("[data-dst-per]").forEach(b => b.addEventListener("click", () => { st.periode = b.dataset.dstPer; rerender(); }));
  container.querySelectorAll("[data-dst-asso]").forEach(b => b.addEventListener("click", () => { st.association = b.dataset.dstAsso; rerender(); }));
  container.querySelectorAll("[data-dst-mois]").forEach(g => g.addEventListener("click", () => { st.moisSel = g.dataset.dstMois; rerender(); }));
  container.querySelectorAll("[data-dst-nav]").forEach(b => b.addEventListener("click", () => { const i = s.flux.findIndex(m => m.cle === st.moisSel) + Number(b.dataset.dstNav); if (s.flux[i]) { st.moisSel = s.flux[i].cle; rerender(); } }));
  container.querySelectorAll("[data-dst-site]").forEach(b => b.addEventListener("click", () => ouvrirTableau({ site: b.dataset.dstSite, association: st.association })));
  container.querySelectorAll("[data-dst-aller]").forEach(b => b.addEventListener("click", () => ouvrirTableau({ mode: b.dataset.dstAller, association: st.association })));
  attacherInfobulles(container);
}

// Infobulle unique qui suit le doigt / la souris sur tout élément [data-tip]
function attacherInfobulles(container) {
  let tip = document.getElementById("dst-tip");
  if (!tip) { tip = document.createElement("div"); tip.id = "dst-tip"; tip.className = "dst-tip"; document.body.appendChild(tip); }
  const montrer = (e) => {
    const cible = e.target.closest?.("[data-tip]"); if (!cible || !container.contains(cible)) { tip.style.opacity = 0; return; }
    tip.innerHTML = cible.dataset.tip;
    const p = e.touches ? e.touches[0] : e;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let x = p.clientX + 14, y = p.clientY - h - 12;
    if (x + w > window.innerWidth - 8) x = p.clientX - w - 14;
    if (x < 8) x = 8; if (y < 8) y = p.clientY + 18;
    tip.style.transform = `translate(${x}px,${y}px)`; tip.style.opacity = 1;
  };
  container.addEventListener("mousemove", montrer);
  container.addEventListener("touchstart", montrer, { passive: true });
  container.addEventListener("mouseleave", () => { tip.style.opacity = 0; });
}

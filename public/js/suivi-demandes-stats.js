// suivi-demandes-stats.js — Tableau de bord « Statistiques » du Suivi des
// demandes, calculé EN DIRECT depuis les demandes Firestore (plus de photo
// figée). Graphiques en SVG maison (aucune librairie), avec infobulles.
import { esc } from "./astreinte-logic.js";
import { db } from "./firebase-init.js";
import { doc, getDoc, getDocs, collection } from "./firestore-compte.js";
import { effectifEtClotures, effectifHTML, douzeMois, brancherEffectif } from "./effectif-stats.js";

// Techniciens (config/people) et absences : lus une fois, pour l'analyse
// « interventions clôturées / techniciens présents ».
let effData = null, effChargement = null;
function chargerEffectif(rerender) {
  if (effData || effChargement) return;
  effChargement = Promise.all([getDoc(doc(db, "config", "people")), getDocs(collection(db, "absences")), getDoc(doc(db, "config", "stats-effectif")).catch(() => null)]).then(([pp, abs, ch]) => {
    const p = pp.exists() ? pp.data() : {};
    const absences = []; abs.forEach(d => absences.push({ id: d.id, ...d.data() }));
    effData = { techniciensChoisis: ch?.exists?.() ? ch.data().techniciens || [] : [], aliasTechniciens: ch?.exists?.() ? ch.data().alias || {} : {}, n1: p.n1 || [], techniciens: p.n2 || [], astreinteActive: p.astreinteActive || {}, datesDebut: p.datesDebut || {}, datesFin: p.datesFin || {}, binomes: p.binomes || {}, absences };
    rerender();
  }).catch(e => { console.error("Effectif techniciens :", e); effData = { techniciens: [], absences: [] }; });
}

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
const sa2 = (x) => String(x || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
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
  // ---- Indicateurs « direction » : période choisie vs période précédente de même durée ----
  const fenetre = (a, b) => {
    const dans = (x) => x && (!a || x >= a) && x <= b;
    const recues = lignes.filter(l => dans(l.d));
    const traitees = lignes.filter(l => l.traite && dans(l.dt));
    const realisees = traitees.filter(l => l.statut === "Réalisé");
    const del = realisees.filter(l => l.d && l.dt >= l.d).map(l => jours(l.d, l.dt));
    const urg = realisees.filter(l => (l.urgence === "Urgent" || l.urgence === "Critique") && l.d && l.dt >= l.d).map(l => jours(l.d, l.dt));
    const stock = lignes.filter(l => l.d && l.d <= b && !(l.dt && l.dt <= b) && !(l.traite && !l.dt)).length;
    return { recues: recues.length, traitees: traitees.length, realisees: realisees.length, annulees: traitees.length - realisees.length,
      delai: mediane(del), nbDelai: del.length, rapides: del.filter(x => x <= 7).length, urgNb: urg.length, urg48: urg.filter(x => x <= 2).length, stock };
  };
  // Comparatif mensuel : ce mois (à date), mois dernier, moyenne des 3 mois précédents
  const moisK = (k) => { const d0 = new Date(auj.getFullYear(), auj.getMonth() - k, 1); return { ...fenetre(d0, k ? finMois(d0) : auj), label: MOIS_LONGS[d0.getMonth()] }; };
  const comparatif = [0, 1, 2, 3].map(moisK);
  const cur = fenetre(debut, auj);
  let prec = null, libPrec = "";
  if (debut) {
    const duree = auj - debut, pa = new Date(debut.getTime() - duree - 86400000), pb = new Date(debut.getTime() - 86400000);
    prec = fenetre(pa, pb);
    libPrec = `${pa.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })} – ${pb.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })}`;
  }
  // Stock il y a 3 mois (tendance) : demandes arrivées avant cette date et pas encore traitées à cette date
  const il3m = new Date(auj.getFullYear(), auj.getMonth() - 3, auj.getDate());
  const stock3m = lignes.filter(l => l.d && l.d <= il3m && !(l.dt && l.dt <= il3m) && !(l.traite && !l.dt)).length;
  // Réactivité par niveau d'urgence (demandes traitées sur la période)
  const reactivite = ORDRE_URG.map(u => {
    const tr = lignes.filter(l => l.statut === "Réalisé" && l.dt && (!debut || l.dt >= debut) && l.d && l.dt >= l.d && (l.urgence || "Non renseignée") === u).map(l => jours(l.d, l.dt));
    const att = ouvertes.filter(l => (l.urgence || "Non renseignée") === u);
    return { n: u, nb: tr.length, med: mediane(tr), j2: tr.filter(x => x <= 2).length, j7: tr.filter(x => x <= 7).length, att: att.length, attVieilles: att.filter(l => l.d && jours(l.d, auj) > 30).length };
  }).filter(r => r.nb || r.att);
  // Par association (période)
  const parAsso = [...ASSOS, "Autres"].map(a => {
    const rec = periode.filter(l => (ASSOS.includes(l.association) ? l.association : "Autres") === a);
    const re = rec.filter(l => l.statut === "Réalisé"), an = rec.filter(l => l.statut === "Annulé");
    const del = re.filter(l => l.d && l.dt && l.dt >= l.d).map(l => jours(l.d, l.dt));
    const att = ouvertes.filter(l => (ASSOS.includes(l.association) ? l.association : "Autres") === a).length;
    return { n: a, v: rec.length, real: re.length, taux: pct(re.length, rec.length - an.length), med: mediane(del), att };
  }).filter(a => a.v || a.att);
  // Qui réalise : interne / externe (réalisées sur la période)
  const famille = (l) => { const c = sa2(l.categorieIntervenant); return c.startsWith("interne") ? (c.includes("site") ? "Interne site" : "Interne SG") : c.startsWith("externe") ? (c.includes("site") ? "Externe site" : "Externe SG") : "Non renseigné"; };
  const realPeriode = periode.filter(l => l.statut === "Réalisé");
  const qui = ["Interne SG", "Interne site", "Externe SG", "Externe site", "Non renseigné"].map(n => ({ n, v: realPeriode.filter(l => famille(l) === n).length })).filter(x => x.v);
  const direction = { comparatif, cur, prec, libPrec, stock3m, reactivite, parAsso, qui, nbReal: realPeriode.length };
  return { direction, flux, detail, total, real, ann, ouv: total - real - ann, ouvertes, ages, delais, urgentesOuvertes, vieilles, mois, moisCourant, moisPrec,
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

  const D0 = s.direction, C = D0.cur, P = D0.prec;
  const debutP = debutPeriode(), aujP = new Date();
  const libDates = debutP ? `du ${debutP.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })} au ${aujP.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}` : "depuis le début du suivi";
  // Évolution vs période précédente. sens : 1 = hausse souhaitable, -1 = baisse souhaitable, 0 = neutre
  const evol = (a, b, sens = 0, unite = "%") => {
    if (b == null || a == null) return "";
    if (unite === "%") { if (!b) return ""; const d = Math.round(((a - b) / b) * 100); if (!d) return `<small class="dst-ev">= période préc.</small>`;
      const bon = sens === 0 ? "" : (d > 0) === (sens > 0) ? "bon" : "mauvais"; return `<small class="dst-ev ${bon}">${d > 0 ? "▲ +" : "▼ "}${d} % vs période préc.</small>`; }
    const d = a - b; if (!d) return `<small class="dst-ev">= période préc.</small>`;
    const bon = sens === 0 ? "" : (d > 0) === (sens > 0) ? "bon" : "mauvais"; return `<small class="dst-ev ${bon}">${d > 0 ? "▲ +" : "▼ "}${d}${unite} vs période préc.</small>`;
  };
  const tauxReal = pct(s.real, s.total - s.ann);
  const top3 = s.sites.slice(0, 3), partTop3 = pct(top3.reduce((t, x) => t + x.v, 0), s.total);
  const interne = D0.qui.filter(q => q.n.startsWith("Interne")).reduce((t, q) => t + q.v, 0), externe = D0.qui.filter(q => q.n.startsWith("Externe")).reduce((t, q) => t + q.v, 0);
  const dStock = s.ouvertes.length - D0.stock3m;
  const urgR = D0.reactivite.filter(r => r.n === "Critique" || r.n === "Urgent"), urgNb = urgR.reduce((t, r) => t + r.nb, 0), urgJ2 = urgR.reduce((t, r) => t + r.j2, 0);
  const phrases = [
    `<b>${fmt(C.recues)} demande${C.recues > 1 ? "s" : ""} reçue${C.recues > 1 ? "s" : ""}</b> ${libPeriode}${P && P.recues ? ` (${C.recues >= P.recues ? "+" : ""}${pct(C.recues - P.recues, P.recues)} % par rapport à la période précédente)` : ""}, et <b>${fmt(C.traitees)} traitée${C.traitees > 1 ? "s" : ""}</b> dont ${fmt(C.realisees)} réalisée${C.realisees > 1 ? "s" : ""}.`,
    C.delai != null ? `Une demande réalisée l'est en <b>${C.delai} jour${C.delai > 1 ? "s" : ""}</b> (médiane) ; <b>${pct(C.rapides, C.nbDelai)} %</b> le sont en moins d'une semaine${urgNb ? `, et <b>${pct(urgJ2, urgNb)} %</b> des urgences en 48 h ou moins` : ""}.` : `Délai de traitement non mesurable : les dates d'intervention ne sont pas renseignées.`,
    `<b>${fmt(s.ouvertes.length)} demande${s.ouvertes.length > 1 ? "s" : ""} en attente</b> aujourd'hui${s.urgentesOuvertes.length ? `, dont <b>${fmt(s.urgentesOuvertes.length)} urgente${s.urgentesOuvertes.length > 1 ? "s" : ""}</b>` : ""}${s.vieilles.length ? ` et ${fmt(s.vieilles.length)} de plus de 30 jours` : ""} — ${dStock > 0 ? `<span class="mauvais">en hausse de ${dStock}</span>` : dStock < 0 ? `<span class="bon">en baisse de ${-dStock}</span>` : "stable"} par rapport à il y a 3 mois.`,
    top3.length ? `Les sites les plus demandeurs sont ${top3.map(x => `<b>${esc(x.n)}</b> (${fmt(x.v)})`).join(", ")}, soit ${partTop3} % des demandes.` : "",
    interne + externe ? `<b>${pct(interne, interne + externe)} %</b> des interventions réalisées l'ont été <b>en interne</b>, ${pct(externe, interne + externe)} % par des entreprises extérieures.` : "",
  ].filter(Boolean);

  container.innerHTML = `
  <div class="stack dst" id="dst-rapport">
    ${toggleHTML}
    <section class="dst-hero">
      <div class="dst-hero-tete">
        <div><span class="dst-sur">Service Maintenance &amp; Ménage · Groupe Établières</span><h2>Rapport d'activité <em>maintenance</em></h2>
          <p>Période : <b>${libDates}</b>${st.association ? ` · association <b>${esc(st.association)}</b>` : ""}. ${source === "fichier" ? `Calculé sur le fichier Excel extrait le ${esc(extrait || "—")}.` : `Données en direct (${fmt(toutes.length)} demandes)${doublons ? `, ${fmt(doublons)} doublon${doublons > 1 ? "s" : ""} non compté${doublons > 1 ? "s" : ""}` : ""}.`}</p></div>
        <div class="dst-filtres">
          <div class="dst-seg">${[["mois", "Mois"], ["3m", "3 mois"], ["12m", "12 mois"], ["scolaire", "Année scol."], ["tout", "Tout"]].map(([k, l]) => `<button data-dst-per="${k}" class="${st.periode === k ? "on" : ""}">${l}</button>`).join("")}</div>
          <div class="dst-seg dst-seg-a">${[["", "Toutes"], ...ASSOS.map(a => [a, a])].map(([k, l]) => `<button data-dst-asso="${esc(k)}" class="${st.association === k ? "on" : ""}">${esc(l)}</button>`).join("")}</div>
          <button class="dst-imprimer" data-dst-imprimer>🖨 Imprimer / PDF</button>
        </div>
      </div>
      <div class="dst-kpis">
        <div class="dst-kpi"><span>Demandes reçues</span><b>${fmt(C.recues)}</b>${evol(C.recues, P?.recues, 0)}</div>
        <div class="dst-kpi"><span>Demandes traitées</span><b>${fmt(C.traitees)}</b>${evol(C.traitees, P?.traitees, 1) || `<small>${fmt(C.realisees)} réalisées · ${fmt(C.annulees)} annulées</small>`}</div>
        <div class="dst-kpi dst-kpi-anneau">${anneau(tauxReal, 66, 7)}<div><span>Taux de réalisation</span><b class="petit">${fmt(s.real)} / ${fmt(s.total - s.ann)}</b><small>demandes reçues, hors annulées</small></div></div>
        <div class="dst-kpi"><span>Délai médian</span><b>${C.delai != null ? `${C.delai} j` : "—"}</b>${evol(C.delai, P?.delai, -1, " j") || `<small>${C.nbDelai ? `${pct(C.rapides, C.nbDelai)} % en moins de 7 j` : "dates d'intervention manquantes"}</small>`}</div>
        <div class="dst-kpi"><span>En attente aujourd'hui</span><b class="warn">${fmt(s.ouvertes.length)}</b><small class="dst-ev ${dStock > 0 ? "mauvais" : dStock < 0 ? "bon" : ""}">${dStock > 0 ? "▲ +" + dStock : dStock < 0 ? "▼ " + dStock : "="} vs il y a 3 mois</small></div>
      </div>
    </section>

    <section class="dst-carte dst-synthese">
      <div class="dst-carte-tete"><div><h3>📝 Synthèse</h3><p>${P ? `Comparaison avec la période précédente de même durée (${esc(D0.libPrec)})` : "Depuis le début du suivi"}</p></div></div>
      <ul>${phrases.map(p => `<li>${p}</li>`).join("")}</ul>
    </section>

    ${(() => { const [m0, m1, m2, m3] = D0.comparatif, prev = [m1, m2, m3];
      const moy = (f) => { const v = prev.map(f).filter(x => x != null); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null; };
      const lignesC = [
        ["Demandes reçues", (m) => m.recues, 0, ""],
        ["Demandes traitées", (m) => m.traitees, 1, ""],
        ["dont réalisées", (m) => m.realisees, 1, ""],
        ["Délai médian de réalisation", (m) => m.delai, -1, " j"],
        ["Réalisées en 7 jours ou moins", (m) => (m.nbDelai ? pct(m.rapides, m.nbDelai) : null), 1, " %"],
        ["Urgences traitées en 48 h ou moins", (m) => (m.urgNb ? pct(m.urg48, m.urgNb) : null), 1, " %"],
        ["En attente en fin de mois", (m) => m.stock, -1, ""],
      ];
      const cel = (v, u) => v == null ? "—" : `${fmt(v)}${u}`;
      const tend = (a, b, sens, u) => { if (a == null || b == null) return "—"; const d = a - b; if (!d) return `<span class="dst-ev">=</span>`;
        const cl = sens === 0 ? "" : (d > 0) === (sens > 0) ? "bon" : "mauvais"; return `<span class="dst-ev ${cl}">${d > 0 ? "▲ +" : "▼ "}${fmt(d)}${u.trim() === "%" ? " pts" : u}</span>`; };
      return `
    <section class="dst-carte">
      <div class="dst-carte-tete"><div><h3>📊 Ce mois-ci comparé aux mois précédents</h3><p>${esc(m0.label)} au ${new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long" })} · ${st.association ? esc(st.association) : "toutes associations"} · vert = amélioration, rouge = dégradation</p></div></div>
      <table class="dst-tab dst-tab-l dst-comp"><thead><tr><th>Indicateur</th><th>${esc(m0.label)}<small>en cours</small></th><th>${esc(m1.label)}</th><th>Moyenne<small>${esc(m3.label.slice(0, 4))}. → ${esc(m1.label.slice(0, 4))}.</small></th><th>vs ${esc(m1.label.toLowerCase())}</th><th>vs moyenne 3 mois</th></tr></thead><tbody>
        ${lignesC.map(([n, f, sens, u]) => { const a = f(m0), b = f(m1), c = moy(f); return `<tr><td><b>${n}</b></td><td class="dst-c0">${cel(a, u)}</td><td>${cel(b, u)}</td><td>${cel(c, u)}</td><td>${tend(a, b, sens, u)}</td><td>${tend(a, c, sens, u)}</td></tr>`; }).join("")}
      </tbody></table>
      <p class="dst-note" style="margin-top:10px">Le mois en cours n'est pas terminé : les volumes (reçues, traitées) sont naturellement plus bas qu'un mois complet. Les délais et pourcentages sont, eux, directement comparables.</p>
    </section>`; })()}

    ${s.urgentesOuvertes.length || s.vieilles.length ? `
    <div class="dst-alertes">
      ${s.urgentesOuvertes.length ? `<button class="dst-alerte crit" data-dst-aller="urgent"><span class="dst-al-ico">!</span><div><b>${fmt(s.urgentesOuvertes.length)} demande${s.urgentesOuvertes.length > 1 ? "s" : ""} urgente${s.urgentesOuvertes.length > 1 ? "s" : ""} ou critique${s.urgentesOuvertes.length > 1 ? "s" : ""} en attente</b><small>Voir la liste →</small></div></button>` : ""}
      ${s.vieilles.length ? `<button class="dst-alerte warn" data-dst-aller="attente"><span class="dst-al-ico">⏳</span><div><b>${fmt(s.vieilles.length)} demande${s.vieilles.length > 1 ? "s" : ""} ouverte${s.vieilles.length > 1 ? "s" : ""} depuis plus de 30 jours</b><small>Voir les demandes à traiter →</small></div></button>` : ""}
    </div>` : ""}

    <section class="dst-carte">
      <div class="dst-carte-tete"><div><h3>Activité mensuelle</h3><p>12 derniers mois · une demande est « traitée » le mois de son intervention (ou de son annulation) · clique un mois pour le détail</p></div>
        <ul class="dst-leg dst-leg-h"><li><i style="background:var(--dst-s1)"></i><span>Reçues</span></li><li><i style="background:var(--dst-s3)"></i><span>Traitées</span></li></ul></div>
      ${histoFlux(s.flux, st.moisSel)}
    </section>

    <div class="dst-grille">
      <section class="dst-carte"><div class="dst-carte-tete"><div><h3>Réactivité selon l'urgence</h3><p>Demandes réalisées ${libPeriode} · délai entre la demande et l'intervention</p></div></div>
        ${D0.reactivite.length ? `<table class="dst-tab"><thead><tr><th>Urgence</th><th>Réalisées</th><th>Délai médian</th><th>≤ 48 h</th><th>≤ 7 j</th><th>En attente</th></tr></thead><tbody>
          ${D0.reactivite.map(r => `<tr><td><i class="dst-pt" style="background:${r.n === "Critique" ? "var(--dst-crit)" : r.n === "Urgent" ? "var(--dst-s2)" : r.n === "Normal" ? "var(--dst-s1)" : "var(--dst-autre)"}"></i>${esc(r.n)}</td><td>${fmt(r.nb)}</td><td><b>${r.med != null ? `${r.med} j` : "—"}</b></td><td>${r.nb ? `${pct(r.j2, r.nb)} %` : "—"}</td><td>${r.nb ? `${pct(r.j7, r.nb)} %` : "—"}</td><td class="${r.att ? "dst-att" : "dst-muet"}">${fmt(r.att)}${r.attVieilles ? ` <small class="mauvais">(${r.attVieilles} &gt; 30 j)</small>` : ""}</td></tr>`).join("")}
        </tbody></table>` : `<div class="dst-vide">Aucune demande réalisée datée sur la période</div>`}</section>
      <section class="dst-carte"><div class="dst-carte-tete"><div><h3>Qui réalise les interventions</h3><p>${fmt(D0.nbReal)} demandes réalisées ${libPeriode}</p></div></div>
        ${D0.qui.length ? donut(D0.qui.map((q, i) => ({ n: q.n, v: q.v, c: { "Interne SG": "var(--dst-q3)", "Interne site": "var(--dst-q1)", "Externe SG": "var(--dst-s2)", "Externe site": "color-mix(in srgb,var(--dst-s2) 55%,#fff)", "Non renseigné": "var(--dst-autre)" }[q.n] })), D0.nbReal, "réalisées") : `<div class="dst-vide">—</div>`}</section>
    </div>

    <section class="dst-carte">
      <div class="dst-carte-tete"><div><h3>Par association</h3><p>${libPeriode} · en attente = toutes périodes confondues</p></div></div>
      <table class="dst-tab dst-tab-l"><thead><tr><th>Association</th><th>Demandes reçues</th><th>Part</th><th>Réalisées</th><th>Taux de réalisation</th><th>Délai médian</th><th>En attente</th></tr></thead><tbody>
        ${D0.parAsso.map(a => `<tr><td><i class="dst-pt" style="background:${couleurAssoc(a.n)}"></i><b>${esc(a.n)}</b></td><td>${fmt(a.v)}</td><td><span class="dst-part"><i style="width:${pct(a.v, s.total)}%;background:${couleurAssoc(a.n)}"></i></span>${pct(a.v, s.total)} %</td><td>${fmt(a.real)}</td><td><em class="dst-pill ${a.taux >= 75 ? "ok" : a.taux >= 50 ? "moy" : "bas"}">${a.taux} %</em></td><td>${a.med != null ? `${a.med} j` : "—"}</td><td class="${a.att ? "dst-att" : "dst-muet"}">${fmt(a.att)}</td></tr>`).join("")}
        <tr class="dst-tot"><td>Total</td><td>${fmt(s.total)}</td><td>100 %</td><td>${fmt(s.real)}</td><td>${tauxReal} %</td><td>${C.delai != null ? `${C.delai} j` : "—"}</td><td>${fmt(s.ouvertes.length)}</td></tr>
      </tbody></table>
    </section>

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

    <div class="dst-grille">
      <section class="dst-carte"><div class="dst-carte-tete"><div><h3>Demandes en attente en fin de mois</h3><p>Le stock monte quand il arrive plus de demandes qu'on n'en traite</p></div></div>
        ${courbeStock(s.flux, st.moisSel)}</section>
      <section class="dst-carte"><div class="dst-carte-tete"><div><h3>Ancienneté des demandes en attente</h3><p>${fmt(s.ouvertes.length)} demandes à traiter, toutes périodes</p></div></div>
        ${barresH(s.tranches.map((t, i) => ({ ...t, c: ["var(--dst-q1)", "var(--dst-q2)", "var(--dst-q3)", "var(--dst-q4)"][i] })), { suffixe: " demandes" }).replace(/dst-bh-rang">\d+/g, 'dst-bh-rang">•')}</section>
    </div>

    <div class="dst-grille">
      <section class="dst-carte"><div class="dst-carte-tete"><div><h3>Types de demande</h3><p>Top 8 · ${libPeriode}</p></div></div>
        ${s.types.length ? barresH(s.types.slice(0, 8).map(([n, v]) => ({ n, v }))) : `<div class="dst-vide">Type non renseigné</div>`}</section>
      <section class="dst-carte"><div class="dst-carte-tete"><div><h3>Statut des demandes reçues</h3><p>${libPeriode}</p></div></div>
        ${s.total ? donut(s.statuts.map(([n, v]) => ({ n, v, c: couleurStatut(n) })), s.total, "demandes") : `<div class="dst-vide">Aucune demande sur la période</div>`}</section>
    </div>

    ${(() => { const D = s.detail, m = D.ms, p = D.msPrec, solde = m.arr - m.trait, med = mediane(D.delaisM);
      const evo = (a, b) => b == null ? "" : a > b ? `<small class="up">▲ +${a - b} vs ${p.court}</small>` : a < b ? `<small class="down">▼ ${a - b} vs ${p.court}</small>` : `<small>= ${p.court}</small>`;
      const maxS = Math.max(1, ...D.sites.slice(0, 8).flatMap(x => [x.arr, x.trait]));
      return `
    <section class="dst-carte dst-mois">
      <div class="dst-carte-tete"><div><h3>📅 Zoom sur un mois</h3><p>Arrivées et demandes traitées dans le mois · clique un mois sur les graphiques pour le changer</p></div>
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
    </section>`; })()}

    ${(() => { if (!effData) return `<section class="dst-carte"><p class="dst-note">⏳ Chargement de l'analyse « interventions clôturées / techniciens présents »…</p></section>`;
      const auj = new Date(), iso = (d) => d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : null;
      const dem = toutes.filter(l => !st.association || l.association === st.association).map(l => ({ ...l, _dateInterv: l.statut === "Réalisé" ? iso(dateTraitement(l)) : null }));
      const e = effectifEtClotures(effData, { mois: douzeMois(auj), aujourdhui: iso(auj) }, dem);
      return e ? `<section class="dst-carte">${effectifHTML(e)}</section>` : `<section class="dst-carte"><p class="dst-note">Analyse par technicien indisponible : aucun technicien (N2) dans la liste de l'astreinte.</p></section>`; })()}

    ${s.sansDate ? `<p class="dst-note">${fmt(s.sansDate)} demande${s.sansDate > 1 ? "s" : ""} sans date valide ne ${s.sansDate > 1 ? "sont" : "est"} pas comptée${s.sansDate > 1 ? "s" : ""} dans les périodes.</p>` : ""}
    <p class="dst-note dst-print-only">Rapport édité le ${new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })} depuis l'application Service Maintenance &amp; Ménage.</p>
  </div>`;

  onToggle();
  const rerender = () => renderStatsDemandes(container, toutes, { toggleHTML, onToggle, ouvrirTableau, source, extrait, doublons });
  chargerEffectif(() => { if (document.contains(container) && container.querySelector("#dst-rapport")) rerender(); });
  brancherEffectif(container, (liste, alias) => { if (effData) { if (liste) effData.techniciensChoisis = liste; if (alias) effData.aliasTechniciens = { ...(effData.aliasTechniciens || {}), ...alias }; } rerender(); });
  container.querySelectorAll("[data-dst-per]").forEach(b => b.addEventListener("click", () => { st.periode = b.dataset.dstPer; rerender(); }));
  container.querySelectorAll("[data-dst-asso]").forEach(b => b.addEventListener("click", () => { st.association = b.dataset.dstAsso; rerender(); }));
  container.querySelectorAll("[data-dst-mois]").forEach(g => g.addEventListener("click", () => { st.moisSel = g.dataset.dstMois; rerender(); }));
  container.querySelectorAll("[data-dst-nav]").forEach(b => b.addEventListener("click", () => { const i = s.flux.findIndex(m => m.cle === st.moisSel) + Number(b.dataset.dstNav); if (s.flux[i]) { st.moisSel = s.flux[i].cle; rerender(); } }));
  container.querySelectorAll("[data-dst-site]").forEach(b => b.addEventListener("click", () => ouvrirTableau({ site: b.dataset.dstSite, association: st.association })));
  container.querySelector("[data-dst-imprimer]")?.addEventListener("click", () => {
    const r = container.querySelector("#dst-rapport"); if (!r) return;
    r.classList.add("print-fiche", "dst-impression");
    const fin = () => { r.classList.remove("print-fiche", "dst-impression"); window.removeEventListener("afterprint", fin); };
    window.addEventListener("afterprint", fin); setTimeout(() => window.print(), 50);
  });
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

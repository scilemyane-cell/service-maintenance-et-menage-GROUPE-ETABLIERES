// effectif-stats.js — « Demandes clôturées et techniciens présents » :
// nombre de techniciens réellement présents (jours ouvrés, absences, fériés,
// dates de début) mis en regard des demandes d'intervention clôturées.
// Utilisé dans Statistiques et dans les statistiques du Suivi des demandes.
import { esc } from "./astreinte-logic.js";

const pad = n => String(n).padStart(2, "0");
const isoLocal = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const norm = s => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
function versIso(v) {
  if (!v) return null;
  if (typeof v === "string") { const fr = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); return fr ? `${fr[3]}-${pad(fr[2])}-${pad(fr[1])}` : v.slice(0, 10); }
  if (typeof v === "number") return isoLocal(new Date(v));
  if (v.toDate) return isoLocal(v.toDate());
  if (v instanceof Date) return isoLocal(v);
  if (typeof v.seconds === "number") return isoLocal(new Date(v.seconds * 1000));
  return null;
}
const fmtNb = (n, dec = 0) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: dec, minimumFractionDigits: 0 }).format(n || 0);

// ---- Techniciens présents vs demandes clôturées ----
// Jours fériés français (fixes + Pâques, Ascension, Pentecôte).
export function feriesAnnee(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mois = Math.floor((h + l - 7 * m + 114) / 31), jour = ((h + l - 7 * m + 114) % 31) + 1, paques = new Date(y, mois - 1, jour);
  const plus = (n) => { const x = new Date(paques); x.setDate(x.getDate() + n); return isoLocal(x); };
  return new Set([`${y}-01-01`, plus(1), `${y}-05-01`, `${y}-05-08`, plus(39), plus(50), `${y}-07-14`, `${y}-08-15`, `${y}-11-01`, `${y}-11-11`, `${y}-12-25`]);
}
export function effectifEtClotures(data, p, demandesToutes) {
  // Techniciens = niveau 2 de l'astreinte, hors personnes sorties du roulement
  // (ex. agent espaces verts), à partir de leur date de début.
  const techs = (data.techniciens || []).filter(t => (data.astreinteActive || {})[t] !== false);
  if (!techs.length) return null;
  const feries = {}; const estFerie = (iso) => (feries[iso.slice(0, 4)] || (feries[iso.slice(0, 4)] = feriesAnnee(+iso.slice(0, 4)))).has(iso);
  const absent = (t, iso) => (data.absences || []).some(a => a.person === t && iso >= (versIso(a.start) || "9") && iso <= (versIso(a.end) || versIso(a.start) || ""));
  const present = (t, iso) => (!data.datesDebut?.[t] || iso >= data.datesDebut[t]) && (!data.datesFin?.[t] || iso <= data.datesFin[t]) && !absent(t, iso);
  const nomCle = (x) => norm(x).split(/\s+/)[0];
  const quiA = (d) => { const n = norm(d.intervenant || d.declarePar || d.attribueANom || ""); return techs.find(t => n && (n === norm(t) || n.startsWith(nomCle(t) + " ") || n === nomCle(t) || norm(t).startsWith(n))) || null; };
  const parTech = Object.fromEntries(techs.map(t => [t, { jours: 0, clos: 0 }]));
  const mois = p.mois.map(m => {
    const [yy, mm] = m.cle.split("-").map(Number), fin = new Date(yy, mm, 0), limite = p.aujourdhui;
    let ouvres = 0, joursTech = 0, minPres = Infinity, maxPres = 0; const joursT = {}, closT = {};
    for (let d = new Date(yy, mm - 1, 1); d <= fin; d.setDate(d.getDate() + 1)) {
      const iso = isoLocal(d); if (iso > limite) break;
      if (d.getDay() === 0 || d.getDay() === 6 || estFerie(iso)) continue;
      ouvres++; let n = 0;
      techs.forEach(t => { if (present(t, iso)) { n++; joursT[t] = (joursT[t] || 0) + 1; } });
      joursTech += n; minPres = Math.min(minPres, n); maxPres = Math.max(maxPres, n);
    }
    const clos = demandesToutes.filter(d => d.statut === "Réalisé" && d._dateInterv && d._dateInterv.startsWith(m.cle) && d._dateInterv <= limite);
    clos.forEach(d => { const t = quiA(d); if (t) closT[t] = (closT[t] || 0) + 1; });
    return { ...m, joursT, closT, ouvres, joursTech, moyen: ouvres ? joursTech / ouvres : 0, min: ouvres ? minPres : 0, max: maxPres, clos: clos.length,
      parJourTech: joursTech ? clos.length / joursTech : null, parTechPresent: ouvres && joursTech ? clos.length / (joursTech / ouvres) : null };
  }).filter(m => m.ouvres);
  // On démarre au premier mois où des clôtures sont enregistrées (avant, pas de données : ça fausserait les moyennes).
  const premier = mois.findIndex(m => m.clos > 0);
  if (premier > 0) mois.splice(0, premier);
  if (premier < 0) mois.length = 0;
  if (!mois.length) return null;
  mois.forEach(m => techs.forEach(t => { parTech[t].jours += m.joursT[t] || 0; parTech[t].clos += m.closT[t] || 0; }));
  const tot = mois.reduce((a, m) => ({ ouvres: a.ouvres + m.ouvres, joursTech: a.joursTech + m.joursTech, clos: a.clos + m.clos }), { ouvres: 0, joursTech: 0, clos: 0 });
  const ratio = tot.joursTech ? tot.clos / tot.joursTech : null;
  // Comparaison : mois avec l'équipe au complet (≥ 90 % de présence) vs mois en effectif réduit.
  const complet = mois.filter(m => m.moyen >= techs.length * 0.9 && m.joursTech), reduit = mois.filter(m => m.moyen < techs.length * 0.9 && m.joursTech);
  const r = (l) => { const j = l.reduce((s, m) => s + m.joursTech, 0); return j ? l.reduce((s, m) => s + m.clos, 0) / j : null; };
  return { techs, mois, tot, ratio, moyenPeriode: tot.ouvres ? tot.joursTech / tot.ouvres : 0,
    ratioComplet: r(complet), ratioReduit: r(reduit), nbComplet: complet.length, nbReduit: reduit.length,
    parTech: Object.entries(parTech).map(([t, o]) => ({ t, ...o, ratio: o.jours ? o.clos / o.jours : null })).sort((a, b) => b.clos - a.clos),
    nonAttribuees: tot.clos - Object.values(parTech).reduce((s, o) => s + o.clos, 0) };
}


// 12 derniers mois (ou ceux fournis) au format { cle, label }.
export function douzeMois(fin = new Date()) {
  return Array.from({ length: 12 }, (_, i) => { const d = new Date(fin.getFullYear(), fin.getMonth() - 11 + i, 1); return { cle: `${d.getFullYear()}-${pad(d.getMonth() + 1)}`, label: d.toLocaleDateString("fr-FR", { month: "short", year: "2-digit" }) }; });
}

function graphique(e) {
  const W = 640, H = 210, g = 34, n = e.mois.length, bw = (W - g * 2) / n;
  const maxC = Math.max(1, ...e.mois.map(m => m.clos)), maxT = Math.max(1, e.techs.length);
  const y = (v) => H - 26 - (v / maxC) * (H - 46), yt = (v) => H - 26 - (v / maxT) * (H - 46);
  const pts = e.mois.map((m, i) => `${g + bw * i + bw / 2},${yt(m.moyen)}`).join(" ");
  return `<svg viewBox="0 0 ${W} ${H}" class="eff-svg" role="img" aria-label="Clôtures et techniciens présents par mois">
    ${e.mois.map((m, i) => `<g><title>${esc(m.label)} : ${m.clos} clôturée(s), ${fmtNb(m.moyen, 1)} technicien(s) présent(s)/jour</title>
      <rect x="${g + bw * i + bw * .18}" y="${y(m.clos)}" width="${bw * .64}" height="${H - 26 - y(m.clos)}" rx="4" class="eff-barre"/>
      <text x="${g + bw * i + bw / 2}" y="${y(m.clos) - 4}" text-anchor="middle" class="eff-v">${m.clos || ""}</text>
      <text x="${g + bw * i + bw / 2}" y="${H - 8}" text-anchor="middle" class="eff-l">${esc(m.label)}</text></g>`).join("")}
    <polyline points="${pts}" class="eff-ligne"/>
    ${e.mois.map((m, i) => `<circle cx="${g + bw * i + bw / 2}" cy="${yt(m.moyen)}" r="4" class="eff-pt"><title>${fmtNb(m.moyen, 1)} technicien(s) présent(s)/jour</title></circle>`).join("")}
    ${Array.from({ length: maxT + 1 }, (_, k) => `<text x="${W - g + 6}" y="${yt(k) + 4}" class="eff-axe">${k}</text>`).join("")}
  </svg>
  <p class="eff-leg"><i class="b"></i>Demandes clôturées <i class="l"></i>Techniciens présents / jour (échelle à droite)</p>`;
}

function tab(entetes, lignes, total) {
  const c = (v, i, t = "td") => `<${t} class="${i ? "n" : ""}">${v}</${t}>`;
  return `<div class="eff-tab"><table><thead><tr>${entetes.map((h, i) => c(h, i, "th")).join("")}</tr></thead><tbody>${lignes.map(l => `<tr>${l.map((v, i) => c(v, i)).join("")}</tr>`).join("")}</tbody>${total ? `<tfoot><tr>${total.map((v, i) => c(`<b>${v}</b>`, i)).join("")}</tr></tfoot>` : ""}</table></div>`;
}

export function effectifHTML(e) {
  if (!e) return "";
  const f1 = (x) => x == null ? "—" : fmtNb(x, 1), f2 = (x) => x == null ? "—" : fmtNb(x, 2);
  const ecart = e.ratioComplet && e.ratioReduit ? Math.round((e.ratioReduit / e.ratioComplet - 1) * 100) : null;
  return `<div class="eff">
    <h3 class="eff-h">👷 Interventions clôturées et techniciens présents</h3>
    <p class="eff-sous">Demandes d'intervention passées en « Réalisé », mises en regard du nombre de techniciens réellement présents (jours ouvrés, hors week-ends et fériés, congés / RTT / arrêts déduits). Techniciens : ${e.techs.map(esc).join(", ")}.</p>
    <div class="stat-eff-kpis">
      <div><b>${f1(e.moyenPeriode)}</b><span>technicien(s) présent(s) en moyenne / jour</span><small>sur ${e.techs.length} dans l'équipe</small></div>
      <div><b>${fmtNb(e.tot.clos)}</b><span>interventions clôturées</span><small>${fmtNb(e.tot.joursTech)} jours de présence technicien</small></div>
      <div><b>${f2(e.ratio)}</b><span>clôtures par jour de présence</span><small>≈ ${f1(e.ratio != null ? e.ratio * 5 : null)} par technicien et par semaine</small></div>
      <div class="${ecart != null && ecart < -10 ? "alerte" : ""}"><b>${ecart == null ? "—" : `${ecart > 0 ? "+" : ""}${ecart} %`}</b><span>effet d'une équipe réduite</span><small>${e.ratioComplet != null ? `au complet : ${f2(e.ratioComplet)}/jour (${e.nbComplet} mois)` : "aucun mois au complet"}${e.ratioReduit != null ? ` · réduite : ${f2(e.ratioReduit)}/jour (${e.nbReduit} mois)` : ""}</small></div>
    </div>
    ${graphique(e)}
    <p class="eff-sous">Si les barres baissent en même temps que la courbe, c'est le manque d'effectif qui freine les clôtures ; si elles baissent avec l'équipe au complet, la cause est ailleurs (chantiers, grosses interventions, astreinte…).</p>
    ${tab(["Mois", "Jours ouvrés", "Techniciens présents / jour", "Jours de présence", "Clôturées", "Par jour de présence", "Par technicien présent"],
      e.mois.map(m => [esc(m.label), m.ouvres, `${f1(m.moyen)} <small>(${m.min}–${m.max})</small>`, m.joursTech, m.clos, f2(m.parJourTech), f1(m.parTechPresent)]),
      ["Total", e.tot.ouvres, f1(e.moyenPeriode), e.tot.joursTech, e.tot.clos, f2(e.ratio), f1(e.moyenPeriode ? e.tot.clos / e.moyenPeriode : null)])}
    <h4 class="eff-h4">Par technicien</h4>
    ${tab(["Technicien", "Jours présents", "Interventions clôturées", "Par jour présent"], e.parTech.map(x => [esc(x.t), x.jours, x.clos, f2(x.ratio)]))}
    ${e.nonAttribuees > 0 ? `<p class="eff-sous">${e.nonAttribuees} intervention(s) clôturée(s) sans technicien identifiable (entreprise extérieure, superviseur ou « Réalisé par » vide) : comptées dans le total, pas par technicien.</p>` : ""}
  </div>`;
}

// ---- Heures perdues : repos de 11 h après une intervention d'astreinte ----
// Après un déplacement de nuit, le technicien doit avoir 11 h de repos
// consécutives à partir de la FIN de l'intervention : s'il finit à 2 h, il ne
// peut reprendre qu'à 13 h au lieu de 8 h → 5 h de travail « perdues » sur sa
// journée (comptées seulement si c'est un jour travaillé pour lui).
export function heuresPerduesRepos(data, p) {
  const [hR, mR] = String(data.heureReprise || "08:00").split(":").map(Number);
  const JOURNEE = 7; // plafond : une journée de travail (35 h / 5)
  const feries = {}; const estFerie = (iso) => (feries[iso.slice(0, 4)] || (feries[iso.slice(0, 4)] = feriesAnnee(+iso.slice(0, 4)))).has(iso);
  const absent = (t, iso) => (data.absences || []).some(a => a.person === t && iso >= (versIso(a.start) || "9") && iso <= (versIso(a.end) || versIso(a.start) || ""));
  const hm = (t) => { const [h, m] = String(t).split(":").map(Number); return [h || 0, m || 0]; };
  const parCle = {};
  (data.interventions || []).forEach(i => {
    if (i.supprimeLe || i.sansDeplacement || !i.date || !i.heureDebut || !i.heureFin || !i.technicien) return;
    const [hD, mD] = hm(i.heureDebut), [hF, mF] = hm(i.heureFin);
    const debut = new Date(i.date + "T00:00:00"); debut.setHours(hD, mD, 0, 0);
    let fin = new Date(i.date + "T00:00:00"); fin.setHours(hF, mF, 0, 0); if (fin <= debut) fin.setDate(fin.getDate() + 1);
    const repos = new Date(fin.getTime() + 11 * 3600e3);
    const reprise = new Date(fin); reprise.setHours(hR, mR, 0, 0); if (fin >= reprise) reprise.setDate(reprise.getDate() + 1);
    if (repos <= reprise) return;
    const iso = isoLocal(reprise);
    if (reprise.getDay() === 0 || reprise.getDay() === 6 || estFerie(iso) || absent(i.technicien, iso)) return;
    const cle = `${i.technicien}|${iso}`, h = Math.min(JOURNEE, (repos - reprise) / 3600e3);
    // Plusieurs sorties la même nuit : seule la plus tardive compte.
    if (!parCle[cle] || parCle[cle].heures < h) parCle[cle] = { tech: i.technicien, jour: iso, heures: h, fin, repos, site: i.site || "", numero: i.numero || "" };
  });
  const tous = Object.values(parCle).filter(x => x.jour >= (p.mois[0]?.cle || "") + "-01" && x.jour <= p.aujourdhui).sort((a, b) => b.jour.localeCompare(a.jour));
  const mois = p.mois.map(m => { const l = tous.filter(x => x.jour.startsWith(m.cle)); return { ...m, heures: l.reduce((t, x) => t + x.heures, 0), nb: l.length }; });
  const parTech = {}; tous.forEach(x => { const o = parTech[x.tech] || (parTech[x.tech] = { heures: 0, nb: 0 }); o.heures += x.heures; o.nb++; });
  return { reprise: `${String(hR).padStart(2, "0")}h${String(mR).padStart(2, "0")}`, tous, mois, total: tous.reduce((t, x) => t + x.heures, 0),
    parTech: Object.entries(parTech).sort((a, b) => b[1].heures - a[1].heures) };
}

const fmtH = (h) => { const m = Math.round(h * 60); return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`; };
export function heuresPerduesHTML(r) {
  if (!r) return "";
  const maxH = Math.max(1, ...r.mois.map(m => m.heures));
  return `<div class="eff">
    <h3 class="eff-h">🛌 Heures perdues — repos de 11 h après l'astreinte</h3>
    <p class="eff-sous">Après un déplacement d'astreinte, le technicien doit avoir 11 h de repos à partir de la fin de l'intervention avant de reprendre. Quand ce repos dépasse l'heure de prise de poste (${esc(r.reprise)}) d'un jour travaillé, les heures entre ${esc(r.reprise)} et la fin du repos sont perdues pour le service (plafonnées à une journée de 7 h).</p>
    <div class="stat-eff-kpis">
      <div class="${r.total ? "alerte" : ""}"><b>${fmtH(r.total)}</b><span>heures perdues sur la période</span><small>≈ ${fmtNb(r.total / 7, 1)} journée(s) de technicien</small></div>
      <div><b>${r.tous.length}</b><span>reprise(s) décalée(s)</span><small>${r.tous.length ? `${fmtH(r.total / r.tous.length)} perdues en moyenne` : "aucune sur la période"}</small></div>
      <div><b>${fmtH(r.mois[r.mois.length - 1]?.heures || 0)}</b><span>ce mois-ci</span><small>${r.mois[r.mois.length - 1]?.nb || 0} reprise(s) décalée(s)</small></div>
    </div>
    <div class="hp-mois">${r.mois.map(m => `<div title="${esc(m.label)} : ${fmtH(m.heures)} (${m.nb} reprise(s) décalée(s))"><b>${m.heures ? fmtH(m.heures).replace(" h 00", " h") : ""}</b><span><i style="height:${m.heures / maxH * 100}%"></i></span><small>${esc(m.label)}</small></div>`).join("")}</div>
    ${r.parTech.length ? `<h4 class="eff-h4">Par technicien</h4>${tab(["Technicien", "Reprises décalées", "Heures perdues"], r.parTech.map(([t, o]) => [esc(t), o.nb, fmtH(o.heures)]))}` : ""}
    ${r.tous.length ? `<details class="hp-det"><summary>Voir le détail (${r.tous.length})</summary>${tab(["Jour de reprise", "Technicien", "Fin d'intervention", "Reprise possible", "Perdu"], r.tous.map(x => [new Date(x.jour + "T12:00").toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "2-digit" }), esc(x.tech), `${x.fin.toLocaleString("fr-FR", { weekday: "short", hour: "2-digit", minute: "2-digit" })}${x.site ? ` <small>${esc(x.site)}</small>` : ""}`, x.repos.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }), fmtH(x.heures)]))}</details>` : ""}
  </div>`;
}

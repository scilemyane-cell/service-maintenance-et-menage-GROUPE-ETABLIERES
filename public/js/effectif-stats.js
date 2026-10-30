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
export const EQUIPE_DEMANDES = ["Anthony", "Tony", "Yann", "Kévin", "Ronald", "Gaël", "Lionel"];
export function effectifEtClotures(data, p, demandesToutes) {
  // Techniciens = niveau 2 de l'astreinte, hors personnes sorties du roulement
  // (ex. agent espaces verts), à partir de leur date de début.
  // Équipe qui traite les demandes (choix de Valentin) : techniciens, agent
  // espaces verts et coordinateur. Rapprochés des noms de l'astreinte.
  const connus = [...new Set([...(data.techniciens || []), ...(data.n1 || [])])];
  const defaut = EQUIPE_DEMANDES.map(n => connus.find(c => norm(c) === norm(n) || norm(c).split(/\s+/)[0] === norm(n)) || n);
  const techs = Array.isArray(data.techniciensChoisis) && data.techniciensChoisis.length ? data.techniciensChoisis : defaut;
  const candidats = [...new Set([...(data.techniciens || []), ...(data.n1 || []), ...techs])];
  if (!techs.length) return null;
  const feries = {}; const estFerie = (iso) => (feries[iso.slice(0, 4)] || (feries[iso.slice(0, 4)] = feriesAnnee(+iso.slice(0, 4)))).has(iso);
  // Nom de l'absence comparé sans accents ni majuscules (« kevin » = « Kevin »).
  const memePers = (a, t) => { const x = norm(a), y = norm(t); return x === y || (x && y && (x.split(/\s+/)[0] === y || y.split(/\s+/)[0] === x)); };
  const absent = (t, iso) => (data.absences || []).some(a => memePers(a.person, t) && iso >= (versIso(a.start) || "9") && iso <= (versIso(a.end) || versIso(a.start) || ""));
  const nomCle = (x) => norm(x).split(/[\s/.,-]+/)[0];
  // Petite faute de frappe tolérée sur le prénom (« Antony » = « Anthony », « Kevin » = « Kévin »).
  const proche = (a, b) => { if (a === b) return true; if (Math.min(a.length, b.length) < 4 || Math.abs(a.length - b.length) > 1) return false;
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]); for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length] <= 1; };
  const alias = data.aliasTechniciens || {};
  // « Réalisé par » (ou la personne qui a déclaré la demande réalisée dans l'appli) —
  // jamais la personne à qui la demande était attribuée : attribuée ≠ réalisée.
  const nomDe = (d) => String(d.intervenant || d.contact || d.declarePar || "").trim();
  const quiA = (d) => {
    const brut = nomDe(d), n = norm(brut); if (!n) return null;
    if (alias[n]) return techs.includes(alias[n]) ? alias[n] : null;
    const exact = techs.find(t => n === norm(t) || n.startsWith(nomCle(t) + " ") || n === nomCle(t) || norm(t).startsWith(n));
    if (exact) return exact;
    const c = nomCle(brut); const p = techs.filter(t => proche(c, nomCle(t)));
    return p.length === 1 ? p[0] : null;
  };
  // Date d'arrivée : début du mois de sa 1re clôture (la « date de début » de l'astreinte,
  // ex. Kevin au 1er janvier, ne dit rien de sa présence au travail).
  const closParJour = {};
  demandesToutes.forEach(d => { if (d.statut !== "Réalisé" || !d._dateInterv) return; const t = quiA(d); if (t) (closParJour[t] = closParJour[t] || new Set()).add(d._dateInterv); });
  const debutReel = Object.fromEntries(techs.map(t => { const premiere = [...(closParJour[t] || [])].sort()[0]; return [t, premiere ? premiere.slice(0, 8) + "01" : null]; }));
  const avantDebut = (t, iso) => !!debutReel[t] && iso < debutReel[t];
  const apresFin = (t, iso) => !!data.datesFin?.[t] && iso > data.datesFin[t];
  // Les absences saisies (Astreinte › Absences) font foi.
  const present = (t, iso) => !avantDebut(t, iso) && !apresFin(t, iso) && !absent(t, iso);
  const binome = (t) => { const b = Object.entries(data.binomes || {}).find(([a]) => memePers(a, t))?.[1]; return b ? techs.find(x => memePers(b, x)) || null : null; };
  const parTech = Object.fromEntries(techs.map(t => [t, { jours: 0, clos: 0, abs: 0, hors: 0, closAbs: 0 }]));
  const mois = p.mois.map(m => {
    const [yy, mm] = m.cle.split("-").map(Number), fin = new Date(yy, mm, 0), limite = p.aujourdhui;
    let ouvres = 0, joursTech = 0, minPres = Infinity, maxPres = 0; const joursT = {}, closT = {}, absT = {}, horsT = {};
    for (let d = new Date(yy, mm - 1, 1); d <= fin; d.setDate(d.getDate() + 1)) {
      const iso = isoLocal(d); if (iso > limite) break;
      if (d.getDay() === 0 || d.getDay() === 6 || estFerie(iso)) continue;
      ouvres++; let n = 0;
      techs.forEach(t => { if (present(t, iso)) { n++; joursT[t] = (joursT[t] || 0) + 1; } else if (avantDebut(t, iso) || apresFin(t, iso)) { horsT[t] = (horsT[t] || 0) + 1; } else { absT[t] = (absT[t] || 0) + 1; } });
      joursTech += n; minPres = Math.min(minPres, n); maxPres = Math.max(maxPres, n);
    }
    const clos = demandesToutes.filter(d => d.statut === "Réalisé" && d._dateInterv && d._dateInterv.startsWith(m.cle) && d._dateInterv <= limite);
    const closAbsT = {};
    // Binôme (Astreinte › Binômes, ex. Tony & Anthony) : clôture faite sur le compte de l'un mais à deux —
    // pas d'alerte si l'un des deux était là.
    clos.forEach(d => { const t = quiA(d); if (!t) return; closT[t] = (closT[t] || 0) + 1; const b = binome(t); if (absent(t, d._dateInterv) && !(b && present(b, d._dateInterv))) closAbsT[t] = (closAbsT[t] || 0) + 1; });
    return { ...m, joursT, closT, absT, horsT, closAbsT, ouvres, joursTech, moyen: ouvres ? joursTech / ouvres : 0, min: ouvres ? minPres : 0, max: maxPres, clos: clos.length,
      parJourTech: joursTech ? clos.length / joursTech : null, parTechPresent: ouvres && joursTech ? clos.length / (joursTech / ouvres) : null };
  }).filter(m => m.ouvres);
  // On démarre au premier mois où des clôtures sont enregistrées (avant, pas de données : ça fausserait les moyennes).
  // Démarrage au premier mois « réellement suivi » : au moins 15 % du meilleur mois
  // (les quelques clôtures isolées d'avant la mise en service faussent les moyennes).
  const maxClos = Math.max(0, ...mois.map(m => m.clos));
  // Seuil 40 % : les mois où l'appli ne suivait qu'une partie des clôtures (dates d'intervention
  // non saisies) donnaient des comparaisons absurdes (« +259 % »).
  const premier = mois.findIndex(m => m.clos > 0 && m.clos >= maxClos * 0.4);
  if (premier > 0) mois.splice(0, premier);
  if (premier < 0) mois.length = 0;
  if (!mois.length) return null;
  mois.forEach(m => techs.forEach(t => { parTech[t].jours += m.joursT[t] || 0; parTech[t].clos += m.closT[t] || 0; parTech[t].abs += m.absT[t] || 0; parTech[t].hors += m.horsT[t] || 0; parTech[t].closAbs += m.closAbsT[t] || 0; }));
  const tot = mois.reduce((a, m) => ({ ouvres: a.ouvres + m.ouvres, joursTech: a.joursTech + m.joursTech, clos: a.clos + m.clos }), { ouvres: 0, joursTech: 0, clos: 0 });
  const ratio = tot.joursTech ? tot.clos / tot.joursTech : null;
  // Comparaison : mois avec l'équipe au complet (≥ 90 % de présence) vs mois en effectif réduit.
  const pleine = Math.max(0, ...mois.map(m => m.moyen)); // effectif habituel = meilleur mois
  const complet = mois.filter(m => m.joursTech && m.moyen >= pleine * 0.9), reduit = mois.filter(m => m.joursTech && m.moyen < pleine * 0.9);
  const r = (l) => { const j = l.reduce((s, m) => s + m.joursTech, 0); return j ? l.reduce((s, m) => s + m.clos, 0) / j : null; };
  return { techs, candidats, defaut, choixPerso: techs !== defaut, mois, tot, ratio, moyenPeriode: tot.ouvres ? tot.joursTech / tot.ouvres : 0,
    ratioComplet: r(complet), ratioReduit: r(reduit), nbComplet: complet.length, nbReduit: reduit.length,
    // Un binôme = une seule ligne : les interventions sont clôturées sur l'un ou l'autre compte.
    parTech: (() => { const vus = new Set(), l = [];
      techs.forEach(t => { if (vus.has(t)) return; vus.add(t); const b = binome(t); const o = { ...parTech[t] };
        if (b && !vus.has(b)) { vus.add(b); const p2 = parTech[b]; ["jours", "clos", "abs", "hors", "closAbs"].forEach(k => { o[k] = (o[k] || 0) + (p2[k] || 0); }); l.push({ t: `${t} & ${b}`, binome: true, ...o }); }
        else l.push({ t, ...o }); });
      return l.map(x => ({ ...x, ratio: x.jours ? x.clos / x.jours : null })).sort((a, b) => b.clos - a.clos); })(),
    nonAttribuees: tot.clos - Object.values(parTech).reduce((s, o) => s + o.clos, 0),
    nonReconnus: (() => { const debut = mois[0].cle, c = {}; demandesToutes.forEach(d => { if (d.statut !== "Réalisé" || !d._dateInterv || d._dateInterv.slice(0, 7) < debut || quiA(d)) return; const n = nomDe(d) || "(vide)"; c[n] = (c[n] || 0) + 1; }); return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 15); })(),
    debutReel };
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
    <p class="eff-sous">Demandes d'intervention passées en « Réalisé », mises en regard du nombre de techniciens réellement présents (jours ouvrés, hors week-ends et fériés, congés / RTT / arrêts saisis dans Astreinte › Absences déduits).</p>
    <details class="eff-choix"><summary>👷 Techniciens comptés : <b>${e.techs.map(esc).join(", ")}</b> — modifier</summary>
      <p class="eff-sous" style="margin:6px 0">Coche les personnes qui font les interventions. Le choix est enregistré pour tout le monde.</p>
      <div class="eff-choix-l">${e.candidats.map(t => `<label><input type="checkbox" data-eff-tech="${esc(t)}" ${e.techs.includes(t) ? "checked" : ""}> ${esc(t)}</label>`).join("")}</div>
      <div class="eff-ajout"><input data-eff-ajout placeholder="Autre technicien (nom tel qu'il apparaît dans les absences)"><button type="button" class="nav-btn" data-eff-ajout-btn>Ajouter</button>${e.choixPerso ? `<button type="button" class="nav-btn" data-eff-defaut>↺ Liste par défaut</button>` : ""}</div>
    </details>
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
    ${tab(["Technicien", "Jours présents", "Jours d'absence", "Pas encore / plus dans l'équipe", "Interventions clôturées", "Par jour présent"], e.parTech.map(x => [`${esc(x.t)}${x.binome ? ` <small title="Binôme (Astreinte › Binômes) : interventions clôturées sur l'un ou l'autre compte, jours de présence des deux additionnés">👥 binôme</small>` : ""}`, x.jours, x.abs || `<span style="color:#E5533D" title="Aucune absence trouvée : vérifie Astreinte › Absences">0 ⚠️</span>`, x.hors ? `${x.hors} <small>${e.debutReel?.[x.t] ? `(début ${new Date(e.debutReel[x.t] + "T12:00").toLocaleDateString("fr-FR")})` : ""}</small>` : "—", `${x.clos}${x.closAbs ? ` <span style="color:#E5533D" title="Interventions dont la date tombe pendant une absence saisie : « Réalisé par » ou date d'intervention à vérifier">⚠️ dont ${x.closAbs} pendant une absence</span>` : ""}`, f2(x.ratio)]))}
    <p class="eff-sous">Les absences saisies dans Astreinte › Absences font foi. Un technicien est compté à partir du mois de sa 1re intervention clôturée (la date de début de l'astreinte n'est pas une date d'arrivée). Une intervention n'est comptée qu'à la personne indiquée dans « Réalisé par » (ou qui l'a déclarée réalisée), pas à celle à qui elle était attribuée.</p>
    ${e.nonAttribuees > 0 ? `<p class="eff-sous">${e.nonAttribuees} intervention(s) clôturée(s) sans technicien identifiable (entreprise extérieure, superviseur ou « Réalisé par » vide) : comptées dans le total, pas par technicien.</p>` : ""}
    ${e.nonReconnus?.length ? `<details class="eff-choix"><summary>🔎 Noms « Réalisé par » non reconnus (${e.nonReconnus.length}) — associer à un technicien</summary>
      <p class="eff-sous" style="margin:6px 0">Si un nom correspond à un technicien (autre orthographe, nom de famille, initiales…), choisis-le : toutes ses interventions lui seront comptées. Laisse « — » pour une entreprise extérieure.</p>
      <div class="eff-alias">${e.nonReconnus.map(([n, v]) => `<label><span>${esc(n)} <small>(${v})</small></span><select data-eff-alias="${esc(norm(n))}"><option value="">—</option>${e.techs.map(t => `<option>${esc(t)}</option>`).join("")}</select></label>`).join("")}</div>
    </details>` : ""}
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

// Enregistre le choix des techniciens comptés (config/stats-effectif).
export function brancherEffectif(container, apres) {
  const enreg = async (liste) => {
    const { db } = await import("./firebase-init.js"); const { doc, setDoc } = await import("./firestore-compte.js");
    try { await setDoc(doc(db, "config", "stats-effectif"), { techniciens: liste, majLe: Date.now() }, { merge: true }); apres(liste); }
    catch (e) { alert("Enregistrement impossible : " + (e?.message || e)); }
  };
  const cochés = () => [...container.querySelectorAll("[data-eff-tech]")].filter(c => c.checked).map(c => c.dataset.effTech);
  container.querySelectorAll("[data-eff-tech]").forEach(c => c.addEventListener("change", () => { const l = cochés(); if (!l.length) { c.checked = true; return; } enreg(l); }));
  const add = () => { const i = container.querySelector("[data-eff-ajout]"), v = i?.value.trim(); if (v) enreg([...cochés(), v]); };
  container.querySelector("[data-eff-ajout-btn]")?.addEventListener("click", add);
  container.querySelector("[data-eff-ajout]")?.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } });
  container.querySelector("[data-eff-defaut]")?.addEventListener("click", () => enreg([]));
  container.querySelectorAll("[data-eff-alias]").forEach(sel => sel.addEventListener("change", async () => {
    const { db } = await import("./firebase-init.js"); const { doc, setDoc } = await import("./firestore-compte.js");
    if (!sel.value) return;
    try { await setDoc(doc(db, "config", "stats-effectif"), { alias: { [sel.dataset.effAlias]: sel.value }, majLe: Date.now() }, { merge: true }); apres(null, { [sel.dataset.effAlias]: sel.value }); }
    catch (e) { alert("Enregistrement impossible : " + (e?.message || e)); }
  }));
}

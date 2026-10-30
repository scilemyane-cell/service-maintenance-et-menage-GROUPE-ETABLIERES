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
  // Date d'arrivée : uniquement celle saisie ici (« Techniciens comptés › date d'arrivée »).
  // Ni la date de début d'astreinte, ni la 1re clôture (un agent espaces verts clôture peu) ne la donnent.
  const debutReel = Object.fromEntries(techs.map(t => [t, (data.arrivees || {})[t] || null]));
  const avantDebut = (t, iso) => !!debutReel[t] && iso < debutReel[t];
  const apresFin = (t, iso) => !!data.datesFin?.[t] && iso > data.datesFin[t];
  // Absences Eurecia importées (réelles : maladie, congés), par demi-journée. Sur les périodes
  // importées, elles remplacent les absences saisies dans l'astreinte (qui restent un prévisionnel).
  const eur = data.eurecia || null;
  const nomEur = Object.fromEntries(techs.map(t => { const n = norm(t); const tn = n.split(/[\s-]+/).filter(Boolean); const k = Object.keys(eur?.jours || {}).find(x => { const mots = norm(x).split(/[\s-]+/); return tn.every(w => mots.some(m => proche(m, w))); }); return [t, k || null]; }));
  const couvertEur = (iso) => (eur?.periodes || []).some(p => iso >= p.debut && iso <= p.fin);
  // Part de présence d'un jour (1, ½ ou 0) et type d'absence.
  const jour = (t, iso) => {
    if (avantDebut(t, iso) || apresFin(t, iso)) return { f: 0, type: "H" };
    if (eur && couvertEur(iso) && nomEur[t]) {
      const v = eur.jours[nomEur[t]]?.[iso]; if (!v) return { f: 1, type: null };
      const [m, a] = v.split("|"); const nAbs = (m ? 1 : 0) + (a ? 1 : 0);
      return { f: 1 - nAbs / 2, type: m || a, source: "eurecia" };
    }
    if (absent(t, iso)) return { f: 0, type: typeAbs(t, iso) };
    return { f: 1, type: null };
  };
  const present = (t, iso) => jour(t, iso).f > 0;
  const typeAbs = (t, iso) => { const a = (data.absences || []).find(a => memePers(a.person, t) && iso >= (versIso(a.start) || "9") && iso <= (versIso(a.end) || versIso(a.start) || "")); return a ? (["conge", "rtt", "arret"].includes(a.type) ? a.type : "autre") : null; };
  const jourParJour = []; // [{ iso, etat: { tech: "P" | "conge" | "rtt" | "arret" | "autre" | "H" }, clos: { tech: n } }]
  const binome = (t) => { const b = Object.entries(data.binomes || {}).find(([a]) => memePers(a, t))?.[1]; return b ? techs.find(x => memePers(b, x)) || null : null; };
  // Binôme qui clôture « sur le même espace » : pendant l'absence de l'un, ce qui est clôturé
  // à son nom a forcément été fait par l'autre (s'il était là) → attribué à celui qui était présent.
  let reattribuees = 0; const reattribT = {};
  const realisateur = (d, compter = false) => { const t = quiA(d); if (!t) return null; const b = binome(t);
    if (b && jour(t, d._dateInterv).f === 0 && present(b, d._dateInterv)) { if (compter) { reattribuees++; reattribT[b] = (reattribT[b] || 0) + 1; } return b; } return t; };
  const parTech = Object.fromEntries(techs.map(t => [t, { jours: 0, clos: 0, abs: 0, hors: 0, closAbs: 0, types: {} }]));
  const mois = p.mois.map(m => {
    const [yy, mm] = m.cle.split("-").map(Number), fin = new Date(yy, mm, 0), limite = p.aujourdhui;
    let ouvres = 0, joursTech = 0, minPres = Infinity, maxPres = 0; const joursT = {}, closT = {}, absT = {}, horsT = {}, absTypeT = {};
    for (let d = new Date(yy, mm - 1, 1); d <= fin; d.setDate(d.getDate() + 1)) {
      const iso = isoLocal(d); if (iso > limite) break;
      if (d.getDay() === 0 || d.getDay() === 6 || estFerie(iso)) continue;
      ouvres++; let n = 0;
      const etat = {};
      techs.forEach(t => { const j = jour(t, iso);
        if (j.type === "H") { horsT[t] = (horsT[t] || 0) + 1; etat[t] = "H"; return; }
        n += j.f; joursT[t] = (joursT[t] || 0) + j.f;
        if (j.f < 1) { const ty = j.type || "autre", part = 1 - j.f; absT[t] = (absT[t] || 0) + part; absTypeT[t] = absTypeT[t] || {}; absTypeT[t][ty] = (absTypeT[t][ty] || 0) + part; }
        etat[t] = j.f === 1 ? "P" : j.f === 0 ? (j.type || "autre") : `demi ${j.type || "autre"}`; });
      jourParJour.push({ iso, mois: m.cle, etat });
      joursTech += n; minPres = Math.min(minPres, n); maxPres = Math.max(maxPres, n);
    }
    const clos = demandesToutes.filter(d => d.statut === "Réalisé" && d._dateInterv && d._dateInterv.startsWith(m.cle) && d._dateInterv <= limite);
    const closAbsT = {};
    // Binôme (Astreinte › Binômes, ex. Tony & Anthony) : clôture faite sur le compte de l'un mais à deux —
    // pas d'alerte si l'un des deux était là.
    clos.forEach(d => { const t = realisateur(d, true); if (!t) return; closT[t] = (closT[t] || 0) + 1; if (jour(t, d._dateInterv).f === 0) closAbsT[t] = (closAbsT[t] || 0) + 1; });
    return { ...m, joursT, closT, absT, horsT, closAbsT, absTypeT, ouvres, joursTech, moyen: ouvres ? joursTech / ouvres : 0, min: ouvres ? minPres : 0, max: maxPres, clos: clos.length,
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
  mois.forEach(m => techs.forEach(t => { parTech[t].jours += m.joursT[t] || 0; parTech[t].clos += m.closT[t] || 0; parTech[t].abs += m.absT[t] || 0; parTech[t].hors += m.horsT[t] || 0; parTech[t].closAbs += m.closAbsT[t] || 0; Object.entries(m.absTypeT[t] || {}).forEach(([k, v]) => { parTech[t].types[k] = (parTech[t].types[k] || 0) + v; }); }));
  // Clôtures par jour et par technicien (calendrier).
  const closJour = {}; demandesToutes.forEach(d => { if (d.statut !== "Réalisé" || !d._dateInterv) return; const t = realisateur(d); if (!t) return; const k = d._dateInterv + "|" + t; closJour[k] = (closJour[k] || 0) + 1; });
  const debutAnalyse = mois[0].cle;
  const tot = mois.reduce((a, m) => ({ ouvres: a.ouvres + m.ouvres, joursTech: a.joursTech + m.joursTech, clos: a.clos + m.clos }), { ouvres: 0, joursTech: 0, clos: 0 });
  const ratio = tot.joursTech ? tot.clos / tot.joursTech : null;
  // Comparaison : mois avec l'équipe au complet (≥ 90 % de présence) vs mois en effectif réduit.
  const pleine = Math.max(0, ...mois.map(m => m.moyen)); // effectif habituel = meilleur mois
  const complet = mois.filter(m => m.joursTech && m.moyen >= pleine * 0.9), reduit = mois.filter(m => m.joursTech && m.moyen < pleine * 0.9);
  const r = (l) => { const j = l.reduce((s, m) => s + m.joursTech, 0); return j ? l.reduce((s, m) => s + m.clos, 0) / j : null; };
  return { techs, candidats, defaut, choixPerso: techs !== defaut, mois, tot, ratio, moyenPeriode: tot.ouvres ? tot.joursTech / tot.ouvres : 0,
    ratioComplet: r(complet), ratioReduit: r(reduit), nbComplet: complet.length, nbReduit: reduit.length,
    // Une ligne par personne ; les binômes sont regroupés (les deux lignes l'une sous l'autre + total du binôme).
    groupes: (() => { const vus = new Set(), g = [];
      const ligne = (t) => ({ t, ...parTech[t], ratio: parTech[t].jours ? parTech[t].clos / parTech[t].jours : null });
      techs.forEach(t => { if (vus.has(t)) return; vus.add(t); const b = binome(t);
        if (b && !vus.has(b)) { vus.add(b); const a = ligne(t), c = ligne(b), jours = a.jours + c.jours, clos = a.clos + c.clos;
          // Jours où au moins l'un des deux était là (le binôme a pu intervenir).
          const joursBinome = jourParJour.filter(j => j.mois >= debutAnalyse && (j.etat[t] === "P" || j.etat[b] === "P")).length;
          g.push({ binome: true, membres: [a, c], clos, joursBinome, ratio: joursBinome ? clos / joursBinome : null }); }
        else g.push({ binome: false, membres: [ligne(t)], clos: parTech[t].clos }); });
      return g.sort((x, y) => y.clos - x.clos); })(),
    reattribT, eurecia: eur ? { periodes: eur.periodes || [], reconnus: Object.fromEntries(Object.entries(nomEur).filter(([, v]) => v)) } : null,
    calendrier: jourParJour.filter(j => j.mois >= debutAnalyse).map(j => ({ ...j, clos: Object.fromEntries(techs.map(t => [t, closJour[j.iso + "|" + t] || 0])) })),
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
    ${Array.from({ length: maxT + 1 }, (_, k) => `<line x1="${g}" x2="${W - g}" y1="${yt(k)}" y2="${yt(k)}" class="eff-grille${k ? "" : " base"}"/>`).join("")}
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

const LIB_T = { P: "Présent", conge: "Congé", rtt: "RTT", arret: "Arrêt", autre: "Absent", H: "Pas encore / plus dans l'équipe" };
function parTechHTML(e) {
  // Présences seulement (pas de comptage des clôtures par personne).
  const lignes = e.groupes.flatMap(g => g.membres);
  const c = (n) => n ? fmtNb(n, 1) : "—";
  return `<h4 class="eff-h4">👷 Présence par technicien</h4><div class="eff-tab"><table><thead><tr><th>Technicien</th><th class="n">Jours présents</th><th class="n">Congé</th><th class="n">RTT</th><th class="n">Arrêt</th><th class="n">Autre absence</th><th class="n">Pas encore / plus là</th></tr></thead><tbody>
    ${lignes.map(m => `<tr><td><b>${esc(m.t)}</b></td><td class="n"><b>${fmtNb(m.jours, 1)}</b></td><td class="n">${c(m.types?.conge)}</td><td class="n">${c(m.types?.rtt)}</td><td class="n">${c(m.types?.arret)}</td><td class="n">${c(m.types?.autre)}</td><td class="n">${c(m.hors)}</td></tr>`).join("")}
  </tbody></table></div>`;
}
// Calendrier jour par jour : une ligne par technicien, une case par jour ouvré (couleur = présent / congé / RTT / arrêt), nombre de clôtures dans la case.
function calendrierHTML(e) {
  const jours = e.calendrier; if (!jours.length) return "";
  const ordre = e.groupes.flatMap(g => g.membres.map(m => m.t));
  const parMois = []; jours.forEach(j => { const d = parMois[parMois.length - 1]; if (d && d.mois === j.mois) d.n++; else parMois.push({ mois: j.mois, n: 1 }); });
  const nomMois = (k) => new Date(k + "-15").toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  return `<h4 class="eff-h4">📅 Présence jour par jour</h4>
  <div class="eff-cal-leg">${["P", "conge", "rtt", "arret", "autre", "H"].map(k => `<span><i class="eff-c ${k}"></i>${LIB_T[k]}</span>`).join("")}<span><i class="eff-c demi arret"></i>½ journée</span></div>
  <div class="eff-cal"><table><thead><tr><th></th>${parMois.map(p => `<th colspan="${p.n}" class="eff-cal-m">${nomMois(p.mois)}</th>`).join("")}</tr>
    <tr><th></th>${jours.map(j => { const d = new Date(j.iso + "T12:00"); return `<th class="${d.getDay() === 1 ? "lun" : ""}">${"LMMJV"[d.getDay() - 1] || ""}<br>${d.getDate()}</th>`; }).join("")}</tr></thead>
    <tbody>${ordre.map(t => `<tr><th>${esc(t)}</th>${jours.map(j => { const et = j.etat[t] || "P", lib = et.startsWith("demi ") ? `½ journée ${LIB_T[et.slice(5)] || ""}` : LIB_T[et], d = new Date(j.iso + "T12:00"); return `<td class="eff-c ${et} ${d.getDay() === 1 ? "lun" : ""}" title="${esc(t)} · ${d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })} : ${lib}"></td>`; }).join("")}</tr>`).join("")}</tbody></table></div>`;
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
      <p class="eff-sous" style="margin:10px 0 4px">Date d'arrivée (seulement pour quelqu'un arrivé en cours de période — avant, il n'est compté ni présent ni absent) :</p>
      <div class="eff-choix-l">${e.techs.map(t => `<label>${esc(t)} <input type="date" data-eff-arrivee="${esc(t)}" value="${esc(e.debutReel?.[t] || "")}"></label>`).join("")}</div>
      <div class="eff-ajout"><input data-eff-ajout placeholder="Autre technicien (nom tel qu'il apparaît dans les absences)"><button type="button" class="nav-btn" data-eff-ajout-btn>Ajouter</button>${e.choixPerso ? `<button type="button" class="nav-btn" data-eff-defaut>↺ Liste par défaut</button>` : ""}</div>
    </details>
    <div class="stat-eff-kpis">
      <div><b>${f1(e.moyenPeriode)}</b><span>technicien(s) présent(s) en moyenne / jour</span><small>sur ${e.techs.length} dans l'équipe</small></div>
      <div><b>${fmtNb(e.tot.clos)}</b><span>interventions clôturées</span><small>${fmtNb(e.tot.joursTech, 1)} jours de présence technicien</small></div>
      <div><b>${f2(e.ratio)}</b><span>clôtures par jour de présence</span><small>≈ ${f1(e.ratio != null ? e.ratio * 5 : null)} par technicien et par semaine</small></div>
      <div class="${ecart != null && ecart < -10 ? "alerte" : ""}"><b>${ecart == null ? "—" : `${ecart > 0 ? "+" : ""}${ecart} %`}</b><span>effet d'une équipe réduite</span><small>${e.ratioComplet != null ? `au complet : ${f2(e.ratioComplet)}/jour (${e.nbComplet} mois)` : "aucun mois au complet"}${e.ratioReduit != null ? ` · réduite : ${f2(e.ratioReduit)}/jour (${e.nbReduit} mois)` : ""}</small></div>
    </div>
    ${graphique(e)}
    <p class="eff-sous">Si les barres baissent en même temps que la courbe, c'est le manque d'effectif qui freine les clôtures ; si elles baissent avec l'équipe au complet, la cause est ailleurs (chantiers, grosses interventions, astreinte…).</p>
    ${tab(["Mois", "Jours ouvrés", "Techniciens présents / jour", "Jours de présence", "Clôturées", "Par jour de présence", "Par technicien présent"],
      e.mois.map(m => [esc(m.label), m.ouvres, `${f1(m.moyen)} <small>(${f1(m.min)}–${f1(m.max)})</small>`, f1(m.joursTech), m.clos, f2(m.parJourTech), f1(m.parTechPresent)]),
      ["Total", e.tot.ouvres, f1(e.moyenPeriode), f1(e.tot.joursTech), e.tot.clos, f2(e.ratio), f1(e.moyenPeriode ? e.tot.clos / e.moyenPeriode : null)])}
        ${parTechHTML(e)}
    ${calendrierHTML(e)}
    <p class="eff-sous">Présences calculées sur les jours ouvrés. ${e.eurecia?.periodes?.length ? `<b>Absences Eurecia</b> (réelles, à la demi-journée) importées du ${e.eurecia.periodes.map(p => `${new Date(p.debut + "T12:00").toLocaleDateString("fr-FR")} au ${new Date(p.fin + "T12:00").toLocaleDateString("fr-FR")}`).join(", ")} ; en dehors, absences saisies dans Astreinte › Absences.` : "D'après les absences saisies dans Astreinte › Absences (prévisionnel) — importe le planning Eurecia pour les absences réelles."}</p>
    <div class="eff-eur"><label class="nav-btn">📥 Importer le planning congés Eurecia (.xls)<input type="file" accept=".xls,.xlsx" hidden data-eff-eurecia></label><small data-eff-eurecia-etat>${e.eurecia ? `Rapprochés : ${Object.entries(e.eurecia.reconnus).map(([t, n]) => `${esc(t)} = ${esc(n)}`).join(" · ") || "aucun"}` : ""}</small></div>
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
  container.querySelector("[data-eff-eurecia]")?.addEventListener("change", async (ev) => {
    const f = ev.target.files[0]; if (!f) return; const etat = container.querySelector("[data-eff-eurecia-etat]");
    try {
      if (etat) etat.textContent = "⏳ Lecture du fichier…";
      const { lirePlanningEurecia, enregistrerEurecia } = await import("./eurecia-import.js");
      const lu = await lirePlanningEurecia(f);
      const nbAbs = lu.personnes.reduce((t, p) => t + Object.keys(p.jours).length, 0);
      if (!confirm(`Planning Eurecia du ${new Date(lu.debut + "T12:00").toLocaleDateString("fr-FR")} au ${new Date(lu.fin + "T12:00").toLocaleDateString("fr-FR")} : ${lu.personnes.length} personne(s), ${nbAbs} jour(s) d'absence (maladie / congés).\nLes absences Eurecia remplaceront, sur cette période, celles saisies dans l'astreinte pour le calcul des présences. Importer ?`)) { if (etat) etat.textContent = ""; return; }
      const r = await enregistrerEurecia(lu, "", f.name);
      if (etat) etat.textContent = "✓ Importé";
      apres(null, null, null, r);
    } catch (e) { if (etat) etat.textContent = "❌ " + (e?.message || e); }
    ev.target.value = "";
  });
  container.querySelectorAll("[data-eff-arrivee]").forEach(inp => inp.addEventListener("change", async () => {
    const { db } = await import("./firebase-init.js"); const { doc, setDoc } = await import("./firestore-compte.js");
    try { await setDoc(doc(db, "config", "stats-effectif"), { arrivees: { [inp.dataset.effArrivee]: inp.value || null }, majLe: Date.now() }, { merge: true }); apres(null, null, { [inp.dataset.effArrivee]: inp.value || null }); }
    catch (e) { alert("Enregistrement impossible : " + (e?.message || e)); }
  }));
  container.querySelectorAll("[data-eff-alias]").forEach(sel => sel.addEventListener("change", async () => {
    const { db } = await import("./firebase-init.js"); const { doc, setDoc } = await import("./firestore-compte.js");
    if (!sel.value) return;
    try { await setDoc(doc(db, "config", "stats-effectif"), { alias: { [sel.dataset.effAlias]: sel.value }, majLe: Date.now() }, { merge: true }); apres(null, { [sel.dataset.effAlias]: sel.value }); }
    catch (e) { alert("Enregistrement impossible : " + (e?.message || e)); }
  }));
}

// ============================================================
// Logique pure : calendrier, jours fériés, algorithme d'équilibrage.
// Aucune dépendance à Firebase ou au DOM — facilement testable
// avec `node --check` ou des tests unitaires plus tard.
// ============================================================

export function pad(n) { return n.toString().padStart(2, "0"); }
export function dateKey(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
export function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
export function sameDay(a, b) { return dateKey(a) === dateKey(b); }

export function fmtLong(d) {
  const jours = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
  const mois = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  return jours[d.getDay()] + " " + d.getDate() + " " + mois[d.getMonth()] + " " + d.getFullYear();
}
export function fmtShort(d) { return pad(d.getDate()) + "/" + pad(d.getMonth() + 1) + "/" + d.getFullYear(); }

export function easterSunday(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

export function buildHolidays(y1) {
  const y2 = y1 + 1;
  const easter = easterSunday(y2);
  const list = [
    { date: new Date(y1, 10, 1), label: "Toussaint" },
    { date: new Date(y1, 10, 11), label: "Armistice 1918" },
    { date: new Date(y1, 11, 25), label: "Noël" },
    { date: new Date(y2, 0, 1), label: "Jour de l'an" },
    { date: addDays(easter, 1), label: "Lundi de Pâques" },
    { date: new Date(y2, 4, 1), label: "Fête du travail" },
    { date: new Date(y2, 4, 8), label: "Victoire 1945" },
    { date: addDays(easter, 39), label: "Ascension" },
    { date: addDays(easter, 50), label: "Lundi de Pentecôte" },
    { date: new Date(y2, 6, 14), label: "Fête nationale" },
    { date: new Date(y2, 7, 15), label: "Assomption" },
  ];
  const map = new Map();
  list.forEach(h => map.set(dateKey(h.date), h.label));
  return map;
}

// Année scolaire de référence : à faire évoluer chaque été (voir README).
export const WEEKS_START = new Date(2026, 7, 31); // lundi 31 août 2026
export const YEAR_START = new Date(2026, 8, 1);   // 1er septembre 2026
export const YEAR_END = new Date(2027, 7, 31);    // 31 août 2027
export const HOLIDAYS = buildHolidays(2026);

export function weekIndexForDate(date) {
  const diffDays = Math.floor((new Date(date.getFullYear(), date.getMonth(), date.getDate()) - WEEKS_START) / 86400000);
  return Math.floor(diffDays / 7);
}

export function buildWeeksArray() {
  const weeks = [];
  let cur = new Date(WEEKS_START);
  const end = addDays(YEAR_END, 7);
  while (cur <= end) { weeks.push({ start: new Date(cur) }); cur = addDays(cur, 7); }
  return weeks;
}
export const WEEKS = buildWeeksArray();

export function dayWeight(date) {
  const isHoliday = HOLIDAYS.has(dateKey(date));
  const isWeekend = date.getDay() === 0 || date.getDay() === 6;
  return isHoliday ? 2 : (isWeekend ? 1.5 : 1);
}

export function isAbsentOnDate(absences, person, date) {
  const k = dateKey(date);
  return absences.some(a => a.person === person && k >= a.start && k <= a.end);
}

// Désigne, pour chaque semaine, la personne disponible ayant le score
// cumulé le plus bas (les jours de week-end comptent 1,5x, fériés 2x).
// Algorithme déterministe, rejoué à chaque changement de personnes/absences.
export function computeWeeklyTitulaires(people, absences) {
  const scoresN1 = {}, scoresN2 = {};
  people.n1.forEach(p => scoresN1[p] = 0);
  people.n2.forEach(p => scoresN2[p] = 0);
  const titN1 = [], titN2 = [];
  let lastN1 = null;
  WEEKS.forEach((w, idx) => {
    let weight = 0;
    const dayFlags = [];
    for (let i = 0; i < 7; i++) { const d = addDays(w.start, i); dayFlags.push(d); weight += dayWeight(d); }

    const availN1 = people.n1.filter(p => dayFlags.some(d => !isAbsentOnDate(absences, p, d)));
    let chosenN1;
    if (availN1.length > 0) {
      const sorted = [...availN1].sort((a, b) => scoresN1[a] - scoresN1[b]);
      chosenN1 = sorted[0];
      if (sorted.length > 1 && scoresN1[sorted[0]] === scoresN1[sorted[1]] && lastN1 === sorted[0]) chosenN1 = sorted[1];
      scoresN1[chosenN1] += weight;
      lastN1 = chosenN1;
    } else { chosenN1 = people.n1[0]; }
    titN1[idx] = chosenN1;

    const availN2 = people.n2.filter(p => dayFlags.some(d => !isAbsentOnDate(absences, p, d)));
    let chosenN2;
    if (availN2.length > 0) {
      const sorted = [...availN2].sort((a, b) => scoresN2[a] - scoresN2[b]);
      chosenN2 = sorted[0];
      scoresN2[chosenN2] += weight;
    } else { chosenN2 = people.n2[0]; }
    titN2[idx] = chosenN2;
  });
  return { titN1, titN2, scoresN1, scoresN2 };
}

export function resolveDayN1(date, people, absences, titN1) {
  const list = people.n1;
  if (list.length < 2) return { assigned: list[0] || "—", swapped: false };
  const wi = weekIndexForDate(date);
  const base = titN1[wi] ?? list[0];
  const other = list.find(p => p !== base) || list[0];
  if (!isAbsentOnDate(absences, base, date)) return { assigned: base, swapped: false };
  if (!isAbsentOnDate(absences, other, date)) return { assigned: other, swapped: true };
  return { assigned: "A DÉFINIR", swapped: true };
}
export function resolveDayN2(date, people, absences, titN2) {
  const list = people.n2, nb = list.length || 1;
  const wi = weekIndexForDate(date);
  const base = titN2[wi] ?? list[0];
  const baseIdx = Math.max(0, list.indexOf(base));
  for (let offset = 0; offset < nb; offset++) {
    const idx = (baseIdx + offset) % nb, name = list[idx];
    if (!isAbsentOnDate(absences, name, date)) return { assigned: name, swapped: offset > 0 };
  }
  return { assigned: "A DÉFINIR", swapped: true };
}

export function esc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function initials(name) {
  return name.trim().split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase();
}

export const N1_COLORS = ["#D9B24C", "#B98F2B"];
export const N2_COLORS = ["#3FB6AC", "#2E8F87", "#1F6B65", "#8FD6CF"];
export function colorForPerson(name, people) {
  const i1 = people.n1.indexOf(name);
  if (i1 >= 0) return N1_COLORS[i1 % N1_COLORS.length];
  const i2 = people.n2.indexOf(name);
  if (i2 >= 0) return N2_COLORS[i2 % N2_COLORS.length];
  return "#999";
}

// Détecte si `date` est un jour de bascule du cadre d'astreinte N1
// (la personne en charge aujourd'hui diffère de celle d'hier).
// Nécessite un resolveDayN1 déjà importé par l'appelant pour éviter une
// dépendance circulaire avec sites-data / le calcul complet.
export function handoverInfo(date, people, absences, titN1, resolveDayN1Fn) {
  const today = resolveDayN1Fn(date, people, absences, titN1);
  const yesterday = resolveDayN1Fn(addDays(date, -1), people, absences, titN1);
  if (today.assigned === yesterday.assigned) return null;
  if (today.assigned === "A DÉFINIR" || yesterday.assigned === "A DÉFINIR") return null;
  return { from: yesterday.assigned, to: today.assigned };
}

// Version unifiée : renvoie le prochain jour de bascule dans les
// `maxDays` jours à venir (aujourd'hui inclus), avec sa date exacte et
// le nombre de jours restants — pour un bandeau unique (aujourd'hui ou
// bientôt) plutôt que deux affichages séparés.
export function nextHandover(date, people, absences, titN1, resolveDayN1Fn, maxDays = 3) {
  for (let i = 0; i <= maxDays; i++) {
    const checkDate = addDays(date, i);
    const info = handoverInfo(checkDate, people, absences, titN1, resolveDayN1Fn);
    if (info) return { ...info, date: checkDate, daysUntil: i };
  }
  return null;
}

// Cherche le prochain jour de bascule dans les `maxDays` jours à venir
// (sans compter aujourd'hui) — pour un préavis avant le jour J.
export function upcomingHandover(date, people, absences, titN1, resolveDayN1Fn, maxDays = 3) {
  for (let i = 1; i <= maxDays; i++) {
    const checkDate = addDays(date, i);
    const info = handoverInfo(checkDate, people, absences, titN1, resolveDayN1Fn);
    if (info) return { ...info, date: checkDate, daysUntil: i };
  }
  return null;
}

export function hoursLeftToday() {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
  const ms = end - now;
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return { h, m };
}

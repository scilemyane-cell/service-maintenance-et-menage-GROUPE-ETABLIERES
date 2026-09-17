// prtt-import.js
// Analyse un fichier PRTT (planning prévisionnel de modulation du temps
// de travail, format RH10 — heures prévues par jour sur l'année) pour
// proposer automatiquement les jours d'absence (congés, RTT) à créer
// dans l'astreinte, afin d'éviter une double saisie entre le planning
// RH et l'outil d'astreinte : ce fichier reste la seule source, l'appli
// se contente d'en tirer les jours à bloquer pour le roulement.

// Feuilles candidates : celles dont le nom contient "PRTT" (le nom exact
// varie par salarié, ex. "BORDES Lionel - PRTT 2026-2027").
export function listerFeuillesCandidates(workbook) {
  return workbook.SheetNames.filter(n => /prtt/i.test(n));
}

// Repère la période de référence annoncée dans le fichier lui-même
// (ex. "Période de référence 01/09/2026 - 31/08/2027") — sert de garde-
// fou : le fichier contient d'autres tableaux ailleurs sur la même
// feuille (suivi cumulé, reliquat...) avec leurs propres dates, qui ne
// doivent surtout pas être confondues avec le calendrier quotidien réel.
export function trouverPeriodeReference(sheet, XLSX) {
  if (!sheet["!ref"]) return null;
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (cell && typeof cell.v === "string" && /période de référence/i.test(cell.v)) {
        const m = cell.v.match(/(\d{2})\/(\d{2})\/(\d{4})\s*-\s*(\d{2})\/(\d{2})\/(\d{4})/);
        if (m) {
          return {
            debut: new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])),
            fin: new Date(Number(m[6]), Number(m[5]) - 1, Number(m[4])),
          };
        }
      }
    }
  }
  return null;
}

// Repère la colonne au-delà de laquelle la feuille ne contient plus le
// vrai calendrier mais une zone annexe ("Contrat se terminant au-delà
// de la période de référence") — sert de deuxième garde-fou, en plus de
// la période de référence, contre les tableaux de calcul présents plus
// loin sur la même feuille (source des faux "0" qui annulaient à tort
// de vrais RTT).
export function trouverBorneDroite(sheet, XLSX) {
  if (!sheet["!ref"]) return null;
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (cell && typeof cell.v === "string" && /contrat se terminant/i.test(cell.v)) return c;
    }
  }
  return null;
}

// Parcourt une feuille et repère chaque cellule contenant une date ;
// lit la valeur juste à droite (colonne "Prévu") sur la même ligne —
// robuste à la mise en page réelle du fichier (plusieurs mois côte à
// côte, blocs de 3 colonnes Date/Prévu/Écart). Si une période de
// référence est trouvée sur la feuille, les dates en dehors sont
// ignorées (autres tableaux de la même feuille, hors calendrier réel) ;
// de même, tout ce qui est à la colonne "Contrat se terminant au-delà"
// ou après est ignoré (zone annexe, pas le calendrier réel).
export function extraireJours(sheet, XLSX) {
  if (!sheet["!ref"]) return [];
  const periode = trouverPeriodeReference(sheet, XLSX);
  const borneDroite = trouverBorneDroite(sheet, XLSX);
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  const colMax = borneDroite !== null ? Math.min(range.e.c, borneDroite - 1) : range.e.c;
  const jours = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= colMax; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (cell && cell.t === "d" && cell.v instanceof Date) {
        if (periode && (cell.v < periode.debut || cell.v > periode.fin)) continue;
        const valCell = sheet[XLSX.utils.encode_cell({ r, c: c + 1 })];
        jours.push({ date: cell.v, valeur: valCell ? valCell.v : undefined });
      }
    }
  }
  return jours;
}

function estWeekend(date) {
  const j = date.getDay();
  return j === 0 || j === 6;
}

// Classe chaque jour : "conge" (code "c"), "rtt" (case vide ou 0 un jour
// de semaine — jour normalement travaillé mais compensé), ou null (rien
// à importer : jour travaillé, jour férié, ou week-end). Les week-ends
// sont volontairement ignorés — une case vide un samedi/dimanche ne
// signifie pas une absence, juste un jour normalement non travaillé, et
// ne doit pas empêcher une astreinte ce jour-là.
export function classerJour(valeur, date) {
  if (typeof valeur === "string") {
    const v = valeur.trim().toLowerCase();
    if (v === "c") return "conge";
    if (v === "ferie" || v === "férié") return null;
  }
  if (estWeekend(date)) return null;
  if (valeur === undefined || valeur === null || valeur === "" || valeur === 0) return "rtt";
  return null; // jour travaillé (nombre d'heures > 0)
}

// Regroupe les jours consécutifs de même type en une seule plage
// (une absence par période continue, plutôt qu'une par jour).
export function regrouperEnPlages(joursClasses) {
  const tries = [...joursClasses].sort((a, b) => a.date - b.date);
  const plages = [];
  tries.forEach(j => {
    const derniere = plages[plages.length - 1];
    if (derniere && derniere.type === j.type) {
      const lendemainAttendu = new Date(derniere.end);
      lendemainAttendu.setDate(lendemainAttendu.getDate() + 1);
      if (lendemainAttendu.toDateString() === j.date.toDateString()) {
        derniere.end = j.date;
        return;
      }
    }
    plages.push({ type: j.type, start: j.date, end: j.date });
  });
  return plages;
}

// Fonction complète : feuille → plages d'absence proposées.
// Une même date calendaire peut apparaître plusieurs fois sur la
// feuille (en-tête de mois, tableau de calcul annexe, second passage…)
// avec des valeurs parfois contradictoires — ex. une ligne d'en-tête
// vide à côté de la vraie ligne journalière qui indique 8h travaillées.
// Règle de fusion, du plus fiable au moins fiable : si une seule
// occurrence de la date indique un nombre d'heures travaillées, le jour
// est considéré travaillé (aucune absence) ; sinon, si une occurrence
// porte le code congé, c'est un congé ; sinon, seulement si TOUTES les
// occurrences sont vides/à 0, c'est un jour à traiter comme RTT.
export function analyserPlanningPrtt(sheet, XLSX) {
  const jours = extraireJours(sheet, XLSX);
  const valeursParDate = new Map();
  jours.forEach(j => {
    const cle = j.date.toDateString();
    if (!valeursParDate.has(cle)) valeursParDate.set(cle, { date: j.date, valeurs: [] });
    valeursParDate.get(cle).valeurs.push(j.valeur);
  });

  const classes = [...valeursParDate.values()].map(({ date, valeurs }) => {
    if (valeurs.some(v => typeof v === "number" && v > 0)) return { date, type: null }; // travaillé au moins une fois recensé → jamais une absence
    const congeTrouve = valeurs.some(v => typeof v === "string" && v.trim().toLowerCase() === "c");
    if (congeTrouve) return { date, type: "conge" };
    const ferieTrouve = valeurs.some(v => typeof v === "string" && /^f[ée]ri[ée]$/i.test(v.trim()));
    if (ferieTrouve) return { date, type: null };
    // Tout le reste (vide/0 partout) suit la règle habituelle, y
    // compris l'exclusion des week-ends.
    return { date, type: classerJour(valeurs.find(v => v !== undefined), date) };
  }).filter(j => j.type);

  return regrouperEnPlages(classes);
}

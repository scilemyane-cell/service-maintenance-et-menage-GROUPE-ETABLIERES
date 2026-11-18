// recurrence-utils.js — calcul des dates d'une récurrence (planning).
// Sorti de planning.js pour que l'accueil puisse l'utiliser sans charger
// tout le module Astreinte (chargé seulement à l'ouverture de la tuile).
import { addDays, dateKey } from "./astreinte-logic.js";
import { compteCeJour } from "./absences-util.js";

export function jourSemaineVersGetDay(j) { return (j + 1) % 7; }

// Calcule les dates d'occurrence d'une récurrence entre aujourd'hui (ou sa
// date de début si future) et un horizon donné, en respectant sa
// fréquence en semaines, son jour de semaine et sa date de fin
// éventuelle — sans jamais dériver du rythme fixé par sa date de début.
export function genererOccurrencesRecurrence(rec, horizon) {
  if (!rec.dateDebut) return [];
  const freq = Math.max(1, parseInt(rec.frequenceSemaines, 10) || 1);
  const cibleDow = jourSemaineVersGetDay(parseInt(rec.jourSemaine, 10) || 0);
  const debut = new Date(rec.dateDebut + "T00:00:00");
  const fin = rec.dateFin ? new Date(rec.dateFin + "T00:00:00") : horizon;
  const limite = fin < horizon ? fin : horizon;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let d = debut > today ? new Date(debut) : new Date(today);
  while (d.getDay() !== cibleDow) d = addDays(d, 1);
  const semainesDepuisDebut = Math.round((d - debut) / (7 * 86400000));
  const reste = ((semainesDepuisDebut % freq) + freq) % freq;
  if (reste !== 0) d = addDays(d, (freq - reste) * 7);
  const dates = [];
  while (d <= limite) { dates.push(dateKey(d)); d = addDays(d, freq * 7); }
  return dates;
}

// Retire les dates où la personne est absente (congés, arrêt… saisis dans
// l'appli) : une tournée ne doit pas tomber pendant ses congés.
const normP = (n) => String(n || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
export function sansAbsences(dates, person, absences) {
  const p = normP(person);
  const abs = (absences || []).filter(a => a && !a.supprimeLe && normP(a.person) === p);
  if (!abs.length) return dates;
  return dates.filter(d => !abs.some(a => String(a.start).slice(0, 10) <= d && String(a.end || a.start).slice(0, 10) >= d && compteCeJour(a, d)));
}

// Code couleur par site (même couleur dans le planning individuel et sur l'accueil).
export const PALETTE_SITES = ["#2563EB", "#16A34A", "#DB2777", "#0891B2", "#1F2937", "#4F46E5", "#65A30D", "#475569", "#0EA5E9", "#0D9488"];
export const siteCourt = (n) => String(n || "").replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();
// Couleurs GLOBALES (un site = toujours la même couleur, quelle que soit la personne).
export function couleursSites(recurrences) {
  const sites = [...new Set((recurrences || []).filter(r => !r.supprimeLe && r.site).map(r => siteCourt(r.site)))].sort((a, b) => a.localeCompare(b, "fr"));
  return new Map(sites.map((n, i) => [n, PALETTE_SITES[i % PALETTE_SITES.length]]));
}
// Abréviation courte pour les petites cases (« Le Bois Blanc » → « BB », « La Yole » → « LY »).
export function abregeSite(n) {
  const mots = siteCourt(n).replace(/[’']/g, " ").split(/\s+/).filter(m => m && !/^(le|la|les|l|de|du|des|rs|bat|a|lot|mna|-)$/i.test(m));
  if (!mots.length) return "";
  if (mots.length === 1) return mots[0].slice(0, 2).toUpperCase();
  return mots.slice(0, 2).map(m => m[0]).join("").toUpperCase();
}

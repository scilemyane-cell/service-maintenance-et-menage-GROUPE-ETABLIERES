// recurrence-utils.js — calcul des dates d'une récurrence (planning).
// Sorti de planning.js pour que l'accueil puisse l'utiliser sans charger
// tout le module Astreinte (chargé seulement à l'ouverture de la tuile).
import { addDays, dateKey } from "./astreinte-logic.js";

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

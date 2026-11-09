// Mi-temps thérapeutique (type "mtt") : la personne travaille une partie du temps.
// Elle n'est comptée absente que les jours cochés comme non travaillés (joursOff,
// numéros JS 1=lundi … 5=vendredi) ; les autres jours elle est présente (à mi-temps).
// Pendant toute la période, elle reste hors astreinte (géré par astreinte-logic).
export const LIB_MTT = "Mi-temps thérapeutique";
export const COUL_MTT = "#F97316";
export const JOURS_MTT = [[1, "Lun"], [2, "Mar"], [3, "Mer"], [4, "Jeu"], [5, "Ven"]];
const iso = (d) => typeof d === "string" ? d.slice(0, 10) : (d instanceof Date ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : String(d || "").slice(0, 10));
// true si l'absence `a` (déjà connue comme couvrant la date) rend la personne absente ce jour-là
export function compteCeJour(a, jour) {
  if (!a || a.type !== "mtt") return true;
  const wd = new Date(iso(jour) + "T12:00").getDay();
  return (a.joursOff || []).map(Number).includes(wd);
}
// nombre de jours d'absence réelle entre deux dates incluses (ISO)
export function joursAbsence(a, d1, d2) {
  if (d2 < d1) return 0;
  if (a?.type !== "mtt") return Math.round((new Date(d2 + "T12:00") - new Date(d1 + "T12:00")) / 86400000) + 1;
  let n = 0; for (let d = new Date(d1 + "T12:00"), f = new Date(d2 + "T12:00"); d <= f; d.setDate(d.getDate() + 1)) if (compteCeJour(a, d)) n++;
  return n;
}
export const libHoraires = (a) => a?.hDebut && a?.hFin ? `${a.hDebut.replace(":", "h")}–${a.hFin.replace(":", "h")}` + (a.hDebut2 && a.hFin2 ? ` et ${a.hDebut2.replace(":", "h")}–${a.hFin2.replace(":", "h")}` : "") : "";
export const libJoursOff = (a) => { const o = (a?.joursOff || []).map(Number), h = libHoraires(a); return (o.length ? "absent le " + JOURS_MTT.filter(([n]) => o.includes(n)).map(([, l]) => l.toLowerCase()).join(", ") : "présent tous les jours (temps partiel)") + (h ? ` · présent ${h}` : ""); };
// Mi-temps en cours ce jour-là et la personne travaille (pour afficher ses horaires)
export const miTempsPresent = (absences, memePers, jour) => (absences || []).find(a => a.type === "mtt" && memePers(a.person) && String(a.start).slice(0, 10) <= jour && String(a.end || a.start).slice(0, 10) >= jour && !compteCeJour(a, jour));

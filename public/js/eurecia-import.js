// eurecia-import.js — Import du « Planning congés » exporté d'Eurecia (.xls).
// Le fichier : une ligne par salarié (« NOM PRÉNOM »), deux colonnes par jour
// (matin / après-midi), et le type d'absence donné par la COULEUR de la case
// (légende en haut du fichier : Maladie, Congés payés, À valider, Prévisionnelle…).
// Seules les absences réelles comptent : maladie et congés. « À valider » et
// « Prévisionnelle » ne sont pas des absences (ce ne sont que des demandes).
// Stockage : config/absences-eurecia { periodes:[{debut,fin,importeLe,par,fichier}], jours:{ "NOM PRÉNOM": { "2026-10-05": "arret|arret" } } }
import { db } from "./firebase-init.js";
import { doc, getDoc, setDoc } from "./firestore-compte.js";

const MOIS = { "janv": 1, "jan": 1, "févr": 2, "fevr": 2, "fév": 2, "mars": 3, "avr": 4, "mai": 5, "juin": 6, "juil": 7, "août": 8, "aout": 8, "sept": 9, "oct": 10, "nov": 11, "déc": 12, "dec": 12 };
const pad = (n) => String(n).padStart(2, "0");
const sans = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export async function lirePlanningEurecia(file) {
  const XLSX = await window.chargerLib?.("XLSX"); if (!XLSX) throw new Error("Lecture Excel indisponible");
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellStyles: true });
  const ws = wb.Sheets[wb.SheetNames[0]], ref = XLSX.utils.decode_range(ws["!ref"]);
  const cell = (r, c) => ws[XLSX.utils.encode_cell({ r, c })];
  const couleur = (r, c) => { const s = cell(r, c)?.s; return s?.patternType === "solid" ? String(s.fgColor?.rgb || "").toUpperCase().slice(-6) : ""; };
  const texte = (r, c) => String(cell(r, c)?.v ?? "").trim();
  // Légende : libellé → couleur de la case colorée juste avant.
  const legende = {};
  for (let r = 0; r <= Math.min(5, ref.e.r); r++) for (let c = 1; c <= ref.e.c; c++) {
    const t = sans(texte(r, c)); if (!t) continue;
    const coul = couleur(r, c - 1) || couleur(r, c); if (!coul || coul === "FFFFFF") continue;
    if (/maladie|arret/.test(t)) legende[coul] = "arret";
    else if (/conges? payes|conge/.test(t)) legende[coul] = legende[coul] || "conge";
    else if (/valider/.test(t)) legende[coul] = "avalider";
    else if (/previsionn/.test(t)) legende[coul] = "prev";
    else if (/jours a 0|conventionnel/.test(t)) legende[coul] = legende[coul] || "conge";
    else if (/rtt/.test(t)) legende[coul] = "rtt";
  }
  if (!Object.values(legende).includes("arret") && !Object.values(legende).includes("conge")) throw new Error("légende des couleurs introuvable (est-ce bien le « Planning congés » d'Eurecia ?)");
  // Ligne d'en-tête des dates : « J 1 oct. 2026 ».
  let rDates = -1; const cols = [];
  for (let r = 0; r <= Math.min(10, ref.e.r) && rDates < 0; r++) {
    for (let c = 0; c <= ref.e.c; c++) {
      const m = texte(r, c).match(/^[LMJVSD]\s+(\d{1,2})\s+([^\s.]+)\.?\s+(\d{4})/i);
      if (m) { const mo = MOIS[sans(m[2]).replace(".", "")] || MOIS[sans(m[2]).slice(0, 4)] || MOIS[sans(m[2]).slice(0, 3)]; if (mo) cols.push({ c, iso: `${m[3]}-${pad(mo)}-${pad(m[1])}` }); }
    }
    if (cols.length > 3) rDates = r; else cols.length = 0;
  }
  if (rDates < 0) throw new Error("ligne des dates introuvable");
  const personnes = [];
  for (let r = rDates + 1; r <= ref.e.r; r++) {
    const nom = texte(r, 0); if (!nom) continue;
    const jours = {};
    cols.forEach(({ c, iso }) => {
      const t = (cc) => { const ty = legende[couleur(r, cc)]; return ty === "arret" || ty === "conge" || ty === "rtt" ? ty : ""; };
      const m = t(c), a = t(c + 1);
      if (m || a) jours[iso] = `${m}|${a}`;
    });
    personnes.push({ nom, jours });
  }
  return { debut: cols[0].iso, fin: cols[cols.length - 1].iso, personnes, nbJours: cols.length };
}

// Enregistre : sur la période du fichier, les jours des personnes du fichier sont remplacés.
export async function enregistrerEurecia(lu, par, fichier) {
  const ref = doc(db, "config", "absences-eurecia");
  const s = await getDoc(ref), d = s.exists() ? s.data() : {};
  const jours = d.jours || {};
  lu.personnes.forEach(p => {
    const actuels = Object.fromEntries(Object.entries(jours[p.nom] || {}).filter(([iso]) => iso < lu.debut || iso > lu.fin));
    jours[p.nom] = { ...actuels, ...p.jours };
  });
  const periodes = [...(d.periodes || []).filter(x => !(x.debut === lu.debut && x.fin === lu.fin)), { debut: lu.debut, fin: lu.fin, importeLe: Date.now(), par: par || "", fichier: fichier || "" }].sort((a, b) => a.debut.localeCompare(b.debut));
  await setDoc(ref, { periodes, jours, majLe: Date.now() });
  return { periodes, jours };
}
export async function chargerEurecia() {
  try { const s = await getDoc(doc(db, "config", "absences-eurecia")); return s.exists() ? s.data() : null; } catch { return null; }
}

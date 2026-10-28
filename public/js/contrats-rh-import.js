// contrats-rh-import.js — Reprise des demandes de contrat faites AVANT l'appli :
// lecture de l'Excel RH01 (ou de son PDF). Les cellules sont repérées par leur
// libellé (« NOM : », « Fonction occupée : »…) et non par leur adresse, pour
// fonctionner avec les différentes versions du formulaire.
import { PDFJS, PDFJS_WORKER } from "./fiches-poste-import.js";
import { CRITERES, JOURS } from "./contrats-rh-donnees.js";

const nettoie = (t) => String(t ?? "").replace(/[’‘]/g, "'").replace(/ /g, " ").replace(/\s+/g, " ").trim();
const LIBELLES = /^(Télétravail|Pts|Pts .*|Annuelles|Ancienneté|Indice de base|Direction Association|Sélectionnez|€uros|Points|TOTAL Points|STATUT =>|Quotité.*|CDD|CDI|Ryhtme hebdo moyen|Rythme hebdo moyen|heures\/sem|Supra légal.*|Critères classants.*|VALIDATION Direction|Signature.*)$/i;
const estLibelle = (v) => typeof v === "string" && (/:\s*$/.test(nettoie(v)) || LIBELLES.test(nettoie(v)));
const pad = (n) => String(n).padStart(2, "0");
function isoDe(v) {
  if (v instanceof Date && !isNaN(v)) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  if (typeof v === "number" && v > 20000 && v < 80000) { const d = new Date(Math.round((v - 25569) * 864e5)); return d.toISOString().slice(0, 10); }
  const m = String(v || "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? `${m[3]}-${pad(m[2])}-${pad(m[1])}` : "";
}
function heureDe(v) {
  if (v instanceof Date && !isNaN(v)) return `${pad(v.getHours())}:${pad(v.getMinutes())}`;
  if (typeof v === "number" && v > 0 && v < 1) { const m = Math.round(v * 1440); return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`; }
  return nettoie(v);
}
const texte = (v) => v == null ? "" : v instanceof Date ? isoDe(v) : typeof v === "number" ? String(v) : nettoie(v);
const pourcent = (v) => { if (v == null || v === "") return ""; const x = typeof v === "number" ? v : parseFloat(String(v).replace(",", ".").replace("%", "")); if (!isFinite(x)) return ""; return String(Math.round((typeof v === "number" && x <= 1 ? x * 100 : x) * 100) / 100); };

// Grille (lignes × colonnes) → champs du formulaire.
function depuisGrille(g, planning) {
  const lignes = g.map(r => (r || []).map(v => (typeof v === "string" ? nettoie(v) : v)));
  const trouve = (re, apres = -1) => { for (let r = apres + 1; r < lignes.length; r++) { const c = (lignes[r] || []).findIndex(v => typeof v === "string" && re.test(v)); if (c >= 0) return { r, c }; } return null; };
  const apres = (pos) => { if (!pos) return []; const l = lignes[pos.r] || [], out = []; for (let c = pos.c + 1; c < l.length; c++) { const v = l[c]; if (v == null || v === "") continue; if (estLibelle(v)) break; out.push(v); } return out; };
  const val = (re) => apres(trouve(re))[0];
  const f = {};
  f.demandeDe = texte(val(/^Demande de/i)) || "CONTRAT";
  const av = trouve(/Si avenant/i); if (av) { const v = (lignes[av.r] || []).slice(av.c + 1).find(x => x != null && x !== ""); if (v) f.valeursAvant = texte(v); }
  f.nom = texte(val(/^NOM\s*:/)).toUpperCase();
  f.nomNaissance = texte(val(/^Nom de naissance/i));
  f.prenom = texte(val(/^Prénom/i));
  f.adresse = texte(val(/^Adresse/i));
  f.cp = texte(val(/^Code Postal/i)); f.ville = texte(val(/^Ville/i)); f.pays = texte(val(/^Pays/i)) || "France";
  f.email = texte(val(/^E-?Mail/i)); f.tel = texte(val(/^N° de téléphone/i));
  f.dateNaissance = isoDe(val(/^Date de naissance/i)); f.lieuNaissance = texte(val(/^Lieu de naissance/i));
  f.nir = texte(val(/^N° Imm/i)); f.nationalite = texte(val(/^Nationalité/i)); f.diplome = texte(val(/^Diplôme le plus/i));
  f.rqth = texte(val(/^Reconnaissance Travailleur/i)) || "NON";
  f.typeContrat = texte(val(/Type de Contrat/i)).toUpperCase() || "CDI";
  f.parrain = texte(val(/^Parrain/i)).replace(/^-$/, "");
  f.association = texte(val(/^Association\s*:/i)).toUpperCase();
  const rep = apres(trouve(/^Répartition/i)), nums = rep.filter(v => typeof v === "number" || /%/.test(String(v))), sites = rep.filter(v => typeof v === "string" && !/%/.test(v));
  f.repartition1 = pourcent(nums[0]) && +pourcent(nums[0]) ? pourcent(nums[0]) : "100"; f.repartition2 = +pourcent(nums[1]) ? pourcent(nums[1]) : "";
  f.site1 = texte(sites[0]); f.site2 = texte(sites[1]);
  const dd = apres(trouve(/^Date de début/i)); f.dateDebut = isoDe(dd[0]); f.dateFin = isoDe(dd[1]);
  f.motif = texte(val(/^Motif du contrat/i)); f.commentaire = texte(val(/^Commentaire/i));
  f.remplacement = texte(val(/^Si remplacement/i)); f.precisez = texte(val(/^Précisez/i));
  f.fonction = texte(val(/^Fonction occupée/i));
  const codes = apres(trouve(/^Codes analytiques/i)).map(texte).filter(Boolean);
  const cles = apres(trouve(/^Clé de répartition/i));
  f.analytiques = [0, 1, 2, 3].map(i => ({ code: codes[i] || "", pct: codes[i] ? pourcent(cles[i]) || (i === 0 ? "100" : "") : "" }));
  f.matieres = texte(val(/^Matière/i));
  const h = val(/^Nombre d.heures contrat/i); f.heures = h != null ? String(typeof h === "number" ? h : parseFloat(String(h).replace(/\s/g, "").replace(",", ".")) || "") : "";
  f.convention = texte(val(/^Convention Collective/i)) || "OEFMT";
  f.forfaitJour = texte(val(/^Forfait jour/i)) || "NON";
  const tt = apres(trouve(/^Télétravail/i)); f.teletravail = texte(tt[0]) || "NON"; f.teletravailPrecision = texte(tt[1]);
  const anc = val(/^Ancienneté\/expérience/i); f.anciennete = anc != null ? String(parseInt(anc) || 0) : "0";
  // Critères : valeur à gauche du libellé « Pts Autonomie… ».
  f.criteres = {};
  CRITERES.forEach(([k, lib]) => { const p = trouve(new RegExp(lib.split(" ")[0], "i")); if (!p) return; const l = lignes[p.r]; for (let c = p.c - 1; c >= 0; c--) { if (typeof l[c] === "number") { f.criteres[k] = String(l[c]); break; } if (typeof l[c] === "string" && l[c]) break; } });
  const num = (re) => { const v = val(re); return typeof v === "number" && v ? String(v) : ""; };
  f.ajustement = num(/^Ajustement de reclassification/i); f.bonification = num(/^Bonification indiciaire/i);
  const autre = trouve(/^Autre élément de rémunération$/i);
  if (autre) { const a = apres(autre); const pts = a.find(v => typeof v === "number"); const lib = a.find(v => typeof v === "string" && !/^Pts$/i.test(v)); if (pts && lib && !/régul/i.test(lib)) { f.regulAuto = false; f.autrePts = String(pts); f.autrePtsLibelle = lib; } }
  f.autresEuros = [];
  let e = -1; for (let i = 0; i < 2; i++) { const p = trouve(/^Autre élément de rémunération \(€\)/i, e); if (!p) break; e = p.r; const a = apres(p); const type = a.find(v => typeof v === "string" && !/sélectionnez|€uros/i.test(v)); const m = a.find(v => typeof v === "number"); f.autresEuros.push({ type: texte(type), montant: m ? String(m) : "" }); }
  while (f.autresEuros.length < 2) f.autresEuros.push({ type: "", montant: "" });
  f.manager = texte(val(/^Le Manager/i));
  f.direction = texte(val(/^Direction Association/i));
  const pf = trouve(/^Pôle Formation/i); if (pf) { const v = apres(pf).find(x => /^(OUI|NON)$/i.test(String(x))) || (lignes[pf.r] || []).find(x => /^(OUI|NON)$/i.test(String(x))); f.budgetPrevu = texte(v).toUpperCase(); }
  const en = trouve(/s'engage à respecter/i);
  if (en) { for (let r = en.r - 1; r <= en.r + 1; r++) { const v = (lignes[r] || []).find(x => /^(OUI|NON)$/i.test(String(x))); if (v && r !== pf?.r) { f.engagementFormateurs = texte(v).toUpperCase(); break; } } }
  const pr = trouve(/^Précisions pour validation/i);
  if (pr) { const v = apres(pr)[0] ?? [1, 2, 3].map(k => (lignes[pr.r + k] || []).find(x => typeof x === "string" && x && !/^Date/i.test(x))).find(Boolean); f.precisionsDirection = texte(v); }
  const dates = []; lignes.forEach((l, r) => (l || []).forEach((v, c) => { if (typeof v === "string" && /^Date\s*:$/i.test(v)) { const x = apres({ r, c })[0]; dates.push(isoDe(x)); } }));
  f.dateManager = dates[0] || ""; f.dateDirection = dates[1] || "";
  if (planning && !(parseFloat(f.heures) >= 1565)) f.planning = planning;
  Object.keys(f).forEach(k => { if (f[k] === undefined) delete f[k]; });
  return f;
}

function planningDepuisGrille(g) {
  const out = { A: {}, B: {}, rotation: false };
  let sem = null;
  g.forEach(r => {
    const a = nettoie(r?.[0]);
    if (/^Semaine A/i.test(a)) sem = "A"; else if (/^Semaine B/i.test(a)) sem = "B";
    else if (sem && JOURS.includes(a.toUpperCase())) { const v = [1, 2, 3, 4].map(i => r[i] == null || r[i] === "" ? "" : heureDe(r[i])); if (v.some(Boolean)) { out[sem][a.toUpperCase()] = v; if (sem === "B") out.rotation = true; } }
  });
  return Object.keys(out.A).length ? out : null;
}

async function lireXLSX(buf) {
  const XLSX = await window.chargerLib?.("XLSX"); if (!XLSX) throw new Error("Lecture Excel indisponible");
  const wb = XLSX.read(buf, { type: "array" });
  const nomF = wb.SheetNames.find(n => /RH01|DEMANDE DE CONTRAT/i.test(n)) || wb.SheetNames[0];
  const grille = (n) => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null, blankrows: true });
  const nomP = wb.SheetNames.find(n => /PLANNING/i.test(n));
  return depuisGrille(grille(nomF), nomP ? planningDepuisGrille(grille(nomP)) : null);
}

// PDF : on reconstitue des lignes (même hauteur) de morceaux de texte, dans l'ordre.
async function lirePDF(buf) {
  const pdfjs = await import(/* @vite-ignore */ PDFJS);
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  const pdf = await pdfjs.getDocument({ data: buf }).promise, g = [];
  for (let n = 1; n <= Math.min(pdf.numPages, 2); n++) {
    const page = await pdf.getPage(n), vp = page.getViewport({ scale: 1 }), tc = await page.getTextContent();
    const items = tc.items.filter(i => i.str && i.str.trim()).map(i => ({ s: nettoie(i.str), x: i.transform[4], y: Math.round(vp.height - i.transform[5]) }));
    const parY = [];
    items.sort((a, b) => a.y - b.y || a.x - b.x).forEach(i => { const l = parY.find(l => Math.abs(l.y - i.y) <= 3); if (l) l.items.push(i); else parY.push({ y: i.y, items: [i] }); });
    parY.forEach(l => {
      l.items.sort((a, b) => a.x - b.x);
      // Morceaux « Libellé : » séparés de leur valeur ; nombres et dates convertis.
      g.push(l.items.map(i => { const s = i.s; if (/^\d{1,3}(\s\d{3})*(,\d+)?$/.test(s)) return parseFloat(s.replace(/\s/g, "").replace(",", ".")); if (/^\d+(,\d+)?\s*%$/.test(s)) return s; return s; }));
    });
  }
  return depuisGrille(g, null);
}

export async function lireContratExistant(file) {
  const buf = await file.arrayBuffer();
  if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") return lirePDF(buf);
  return lireXLSX(buf);
}
export const _test = { depuisGrille, planningDepuisGrille };

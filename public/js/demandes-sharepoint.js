// demandes-sharepoint.js — Échange avec le fichier Excel des demandeurs
// (SG_Suivi_Demandes_GroupeEtablieres.xlsx) via le site SharePoint appsmm,
// grâce à deux flux Power Automate (le fichier original est sur un autre
// site, où l'appli n'a pas de droits) :
//
//  1) ORIGINAL → appsmm : un flux copie le fichier original dans
//     appsmm/Demandes/ à chaque modification. L'appli lit cette copie :
//     nouvelles demandes ajoutées, et demandes non encore traitées dans
//     l'appli mises à jour depuis le fichier.
//  2) appli → ORIGINAL : l'appli dépose appsmm/Demandes/
//     mises-a-jour-demandes.json (demandes modifiées dans l'appli) ; un
//     second flux reporte ces lignes dans le fichier original (par N°).
import { getGraphToken, getGraphTokenSilentOnly } from "./graph-auth.js";
import { uploadToDrive, telechargerFichierDrive } from "./sharepoint-storage.js";
import { db } from "./firebase-init.js";
import { doc, getDoc, getDocs, query, where, setDoc, collection, writeBatch, serverTimestamp } from "./firestore-compte.js";

const DOSSIER = "Demandes";
const COPIE = "SG_Suivi_Demandes_GroupeEtablieres.xlsx";
const FICHIER_MAJ = "mises-a-jour-demandes.json";
const REF_SYNCHRO = doc(db, "config", "demandes-synchro");
// Empreinte de chaque ligne du fichier au dernier import : la synchro auto
// ne relit dans Firestore que les demandes dont la ligne a changé (quota).
const REF_EMPREINTES = doc(db, "config", "demandes-empreintes");
function hashCourt(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }

const sa = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const txt = (v) => (v == null ? "" : String(v).replace(/\s+/g, " ").trim());
const MOIS = { janv: 1, fevr: 2, mars: 3, avr: 4, mai: 5, juin: 6, juil: 7, aout: 8, sept: 9, oct: 10, nov: 11, dec: 12 };
const iso = (y, m, d) => { const dt = new Date(Date.UTC(y, m - 1, d)); return isNaN(dt) || dt.getUTCMonth() !== m - 1 || y < 2020 || y > new Date().getFullYear() + 1 ? "" : dt.toISOString().slice(0, 10); };

// Dates du fichier : vraies dates Excel, "18082026", "210926", "21/09/2026", "MARDI 4 AOUT"…
function versIso(v, anneeRef) {
  if (v == null || v === "") return "";
  if (v instanceof Date) return iso(v.getFullYear(), v.getMonth() + 1, v.getDate());
  if (typeof v === "number") {
    if (v > 20000 && v < 80000) { const d = new Date(Math.round((v - 25569) * 86400000)); return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); }
    const s = String(Math.trunc(v));
    if (s.length === 7 || s.length === 8) { const p = s.padStart(8, "0"); return iso(+p.slice(4), +p.slice(2, 4), +p.slice(0, 2)); }
    if (s.length === 6) return iso(2000 + +s.slice(4), +s.slice(2, 4), +s.slice(0, 2));
    return "";
  }
  const t = sa(v);
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return iso(+m[1], +m[2], +m[3]);
  m = t.match(/(\d{1,2})[/.\-*](\d{1,2})[/.\-*]?(\d{2,4})/); if (m) { let y = +m[3].slice(0, 4); if (y < 100) y += 2000; return iso(y, +m[2], +m[1]); }
  if (/^\d{6,8}$/.test(t)) return versIso(+t, anneeRef);
  m = t.match(/(\d{1,2})\D.*?(janv|fevr|mars|avr|mai|juin|juil|aout|sept|oct|nov|dec)/);
  if (m) return iso(anneeRef || new Date().getFullYear(), MOIS[m[2]], +m[1]);
  return "";
}
function statut(v) {
  const t = sa(v); if (!t) return "Non renseigné";
  if (t.startsWith("realis")) return "Réalisé";
  if (t.startsWith("annul")) return "Annulé";
  return { "pris en compte": "Pris en compte", "demande de devis": "Demande de devis", "planifie": "Planifié", "intervenant sollicite": "Intervenant sollicité", "commande en cours": "Commande en cours", "autre": "Autre" }[t] || txt(v);
}
const urgence = (v) => ({ normal: "Normal", urgent: "Urgent", "a planifier": "À planifier", critique: "Critique" }[sa(v)] || "Non renseignée");
const association = (v) => { const t = sa(v); return t === "ecole" || t === "lycee" ? "École" : t === "agropolis" ? "Agropolis" : t === "armonia" ? "Armonia" : "Autres"; };
const ALIAS = { ronald: "Ronald", rnld: "Ronald", ecoleau: "Écol'eau", saisonnier: "Saisonnier", arnaudelec: "Arnaud Élec", vendeehabitat: "Vendée Habitat", vendeehabita: "Vendée Habitat",
  mickaelfouet: "Mickaël Fouet", mfouet: "Mickaël Fouet", yann: "Yann", bamenuiserie: "BA Menuiserie", fsb: "FSB", richards: "Richards", lionel: "Lionel", kevin: "Kevin",
  anthonytony: "Anthony / Tony", tonyouanthony: "Anthony / Tony", tke: "TKE", tkeharmonie: "TKE", sm: "SM", atemis: "Atemis", net: "Net 85", suny: "Suny", wendy: "Wendy",
  shubb: "Shubb", aba: "ABA", entgautier: "Ent. Gautier", servicemaintenance: "Service maintenance", mmegandon: "Mme Gandon" };
const contact = (v) => { const t = txt(v); return ALIAS[sa(t).replace(/[^a-z]/g, "")] || t; };

// Demande saisie sans N° : identifiant stable tiré de la date et du début du descriptif.
export const numeroSansNumero = (dateIso, descr) => `SN-${dateIso || "sansdate"}-${sa(descr).replace(/[^a-z0-9]/g, "").slice(0, 12)}`;

// Classeur SheetJS → demandes (même forme que l'import initial).
export async function demandesDepuisClasseur(wb, XLSX) {
  const nomFeuille = wb.SheetNames.find(n => sa(n).includes("suivi des demandes")) || wb.SheetNames[0];
  const lignes = XLSX.utils.sheet_to_json(wb.Sheets[nomFeuille], { header: 1, raw: true, defval: null });
  const iEntete = lignes.findIndex(r => /^n.{0,2}demande/.test(sa(r?.[0])));
  if (iEntete < 0) throw new Error("En-tête « N° demande » introuvable dans la copie du fichier.");
  const feuilleListes = wb.Sheets[wb.SheetNames.find(n => sa(n) === "listes")];
  const typesRef = feuilleListes ? XLSX.utils.sheet_to_json(feuilleListes, { header: 1, defval: null }).slice(1).map(r => r[5]).filter(Boolean) : [];
  const typeNorm = (v) => { const t = sa(v); if (!t) return ""; return typesRef.find(x => sa(x) === t || sa(x).startsWith(t)) || txt(v); };
  const out = [];
  for (const r of lignes.slice(iEntete + 1)) {
    if (!r || !(r[0] || r[6])) continue;
    const dDem = versIso(r[1]);
    const annee = dDem ? +dDem.slice(0, 4) : undefined;
    const intervenantCat = txt(r[10]), cont = contact(r[11]);
    out.push({
      numero: txt(r[0]) || numeroSansNumero(dDem, r[6]),
      dateDemande: dDem, association: association(r[2]), site: txt(r[3]) || "Non renseigné",
      type: typeNorm(r[5]), descriptif: txt(r[6]), urgence: urgence(r[8]), statut: statut(r[13]),
      intervenant: cont, categorieIntervenant: intervenantCat, contact: cont,
      local: txt(r[7]), demandeur: txt(r[4]), logementOccupe: txt(r[9]),
      dateIntervention: versIso(r[12], annee), dateStatut: versIso(r[14], annee), commentaireTech: txt(r[15]),
    });
  }
  return out;
}

// Champs saisis par les demandeurs : toujours repris du fichier.
const CHAMPS_DEMANDEUR = ["dateDemande", "site", "association", "type", "descriptif", "urgence", "local", "demandeur", "logementOccupe"];
// Champs de traitement : repris du fichier seulement si la demande n'a pas
// encore été touchée dans l'appli (sinon c'est l'appli qui fait foi).
const CHAMPS_TRAITEMENT = ["statut", "intervenant", "contact", "categorieIntervenant", "dateIntervention", "dateStatut", "commentaireTech"];

// Rapprochement lignes du fichier ↔ demandes de l'appli (fonction pure, testable).
export function rapprocherLignes(fichier, demandesApp) {
  const parNumero = new Map((demandesApp || []).map(d => [d.numero, d]));
  const vus = {}; fichier.forEach(f => { vus[f.numero] = (vus[f.numero] || 0) + 1; });
  const appVus = {}; (demandesApp || []).forEach(d => { appVus[d.numero] = (appVus[d.numero] || 0) + 1; });
  const nouvelles = [], majs = [];
  // N° en double (le même N° utilisé pour deux demandes différentes dans le
  // fichier) : on rapproche alors par N° + début du descriptif, sinon par
  // N° + date de demande.
  const empreinte = (x) => sa(x.descriptif).replace(/[^a-z0-9]/g, "").slice(0, 25);
  const parCle = new Map(), parNumDate = new Map();
  (demandesApp || []).forEach(d => { const c = `${d.numero}|${empreinte(d)}`; parCle.set(c, [...(parCle.get(c) || []), d]); const k = `${d.numero}|${d.dateDemande || ""}`; parNumDate.set(k, parNumDate.has(k) ? null : d); });
  // Une demande « travaillée » dans l'appli (commentaire, action, statut…) :
  // son descriptif ne doit JAMAIS être remplacé par celui d'une autre ligne
  // du fichier — sinon le suivi (commentaire, action) se retrouve sous une
  // autre intervention.
  const travaillee = (a) => !!(a.dateMaj || a.actionPour || a.actionFil?.length || a.commentaireTechPar || a.declarePar);
  const dejaPris = new Set();
  // Passe 1 : correspondances exactes (N° + début du descriptif) d'abord,
  // pour qu'une autre ligne au même N° ne « vole » pas la demande.
  const cibleDe = new Map();
  fichier.forEach(f => {
    const ambigu = vus[f.numero] > 1 || appVus[f.numero] > 1;
    if (!ambigu) return;
    const exactes = (parCle.get(`${f.numero}|${empreinte(f)}`) || []).filter(a => !dejaPris.has(a.id));
    if (exactes.length) { exactes.forEach(a => dejaPris.add(a.id)); cibleDe.set(f, exactes); }
  });
  for (const f of fichier) {
    const ambigu = vus[f.numero] > 1 || appVus[f.numero] > 1;
    let cibles = cibleDe.get(f);
    if (!cibles) {
      if (!ambigu) cibles = parNumero.get(f.numero) ? [parNumero.get(f.numero)] : [];
      else { const parDate = parNumDate.get(`${f.numero}|${f.dateDemande || ""}`); cibles = parDate && !dejaPris.has(parDate.id) ? [parDate] : []; }
      // Descriptif différent d'une demande déjà travaillée : c'est une AUTRE
      // demande (N° réutilisé / en double dans le fichier) → on la crée à part.
      if (cibles.length === 1 && travaillee(cibles[0]) && empreinte(cibles[0]) && empreinte(f) && empreinte(cibles[0]) !== empreinte(f)) {
        if (!(demandesApp || []).some(d => d.numero === f.numero && empreinte(d) === empreinte(f))) nouvelles.push(f);
        continue;
      }
      cibles.forEach(a => dejaPris.add(a.id));
    }
    if (!cibles.length) {
      // N° en double sans correspondance sûre : si une demande de l'appli a le même N° et la même date, on ne crée rien (prudence).
      if (ambigu && (demandesApp || []).some(d => d.numero === f.numero && (d.dateDemande || "") === (f.dateDemande || "") && empreinte(d) === empreinte(f))) continue;
      nouvelles.push(f); continue;
    }
    for (const a of cibles) {
      const diff = {};
      if (a.creeDansApp) { if (!a.vuDansFichier) majs.push([a.id, { vuDansFichier: true }]); continue; } // créée dans l'appli : l'appli fait foi
      const champs = a.dateMaj ? CHAMPS_DEMANDEUR : [...CHAMPS_DEMANDEUR, ...CHAMPS_TRAITEMENT];
      champs.forEach(k => { if ((f[k] || "") !== (a[k] || "")) diff[k] = f[k] || ""; });
      if (Object.keys(diff).length) majs.push([a.id, diff]);
    }
  }
  return { nouvelles, majs };
}

// Contrôle de cohérence (lecture seule) : compare la copie du fichier Excel
// et les demandes de l'appli, sans rien modifier.
export async function comparerAvecFichier(demandesApp, { onProgress = () => {} } = {}) {
  const token = await getGraphToken(); if (!token) return null;
  onProgress("Lecture de la copie SharePoint…");
  const buf = await telechargerFichierDrive(`${DOSSIER}/${COPIE}`, token);
  if (!buf) throw new Error(`Copie introuvable : appsmm › ${DOSSIER} › ${COPIE}.`);
  const XLSX = await window.chargerLib("XLSX");
  const fichier = await demandesDepuisClasseur(XLSX.read(buf, { type: "array" }), XLSX);
  const emp = (x) => sa(x.descriptif).replace(/[^a-z0-9]/g, "").slice(0, 25);
  const app = (demandesApp || []).filter(d => !d.lieeA);
  const parCle = new Map(), parNum = new Map();
  app.forEach(d => { parCle.set(`${d.numero}|${emp(d)}`, d); parNum.set(d.numero, [...(parNum.get(d.numero) || []), d]); });
  const vus = new Set();
  const stNorm = (v) => { const t = sa(v); return t.startsWith("realis") ? "realise" : t.startsWith("annul") ? "annule" : (!t || t === "non renseigne") ? "" : t; };
  const manquantes = [], statutDiff = [], siteDiff = [];
  fichier.forEach(f => {
    const d = parCle.get(`${f.numero}|${emp(f)}`) || ((parNum.get(f.numero) || []).length === 1 ? parNum.get(f.numero)[0] : null);
    if (!d) { manquantes.push(f); return; }
    vus.add(d.id);
    if (stNorm(f.statut) !== stNorm(d.statut)) statutDiff.push({ f, d });
    if (sa(f.site) !== sa(d.site)) siteDiff.push({ f, d });
  });
  const absentes = app.filter(d => !vus.has(d.id) && !(d.creeDansApp && !d.vuDansFichier));
  const nouvellesApp = app.filter(d => d.creeDansApp && !d.vuDansFichier);
  return { total: fichier.length, totalApp: app.length, manquantes, statutDiff, siteDiff, absentes, nouvellesApp };
}

// 1) Lecture de la copie dans appsmm → nouvelles demandes + mises à jour
// des demandes que personne n'a encore touchées dans l'appli.
export async function recupererDepuisCopie(demandesApp, { interactif = true, onProgress = () => {}, simulation = false } = {}) {
  const token = interactif ? await getGraphToken() : await getGraphTokenSilentOnly();
  if (!token) return null;
  onProgress("Lecture de la copie SharePoint…");
  const buf = await telechargerFichierDrive(`${DOSSIER}/${COPIE}`, token);
  if (!buf) throw new Error(`Copie introuvable : appsmm › ${DOSSIER} › ${COPIE}. Vérifie le flux Power Automate n° 1.`);
  const XLSX = await window.chargerLib("XLSX");
  let fichier = await demandesDepuisClasseur(XLSX.read(buf, { type: "array" }), XLSX);
  // Empreintes des lignes (clé = N° + début du descriptif + rang en cas de doublon exact).
  const rangs = {}, cleLigne = (f) => { const c = `${f.numero}|${sa(f.descriptif).replace(/[^a-z0-9]/g, "").slice(0, 25)}`; rangs[c] = (rangs[c] || 0) + 1; return `${c}|${rangs[c]}`; };
  const empreintesNouvelles = {}, clesLignes = fichier.map(f => cleLigne(f).replace(/[.\/#$\[\]]/g, "_"));
  fichier.forEach((f, i) => { empreintesNouvelles[clesLignes[i]] = hashCourt(JSON.stringify(f)); });
  if (demandesApp === null) {
    // Mode économe : seules les lignes nouvelles / modifiées depuis le dernier import.
    const anciennes = (await getDoc(REF_EMPREINTES).catch(() => null))?.data()?.e || null;
    if (!anciennes) {
      const snap = await getDocs(collection(db, "demandes"));
      demandesApp = []; snap.forEach(d => demandesApp.push({ id: d.id, ...d.data() }));
    } else {
      const changees = new Set(fichier.filter((f, i) => anciennes[clesLignes[i]] !== empreintesNouvelles[clesLignes[i]]).map(f => f.numero));
      if (!changees.size) { await setDoc(REF_SYNCHRO, { derniereLecture: Date.now() }, { merge: true }); return { nouvelles: 0, misesAJour: 0, total: fichier.length }; }
      fichier = fichier.filter(f => changees.has(f.numero));
      demandesApp = [];
      const nums = [...changees];
      for (let i = 0; i < nums.length; i += 30) {
        const snap = await getDocs(query(collection(db, "demandes"), where("numero", "in", nums.slice(i, i + 30))));
        snap.forEach(d => demandesApp.push({ id: d.id, ...d.data() }));
      }
    }
  }
  const { nouvelles, majs } = rapprocherLignes(fichier, demandesApp);
  if (simulation) return { nouvelles, majs, total: fichier.length }; // aperçu : rien n'est écrit
  const ops = [...nouvelles.map(n => ["set", n]), ...majs.map(([id, d]) => ["update", id, d])];
  for (let i = 0; i < ops.length; i += 400) {
    onProgress(`Enregistrement ${Math.min(i + 400, ops.length)} / ${ops.length}…`);
    const batch = writeBatch(db);
    ops.slice(i, i + 400).forEach(o => o[0] === "set"
      ? batch.set(doc(collection(db, "demandes")), { ...o[1], importeLe: serverTimestamp(), importMajLe: serverTimestamp() })
      : batch.update(doc(db, "demandes", o[1]), { ...o[2], importMajLe: serverTimestamp() }));
    await batch.commit();
  }
  await setDoc(REF_SYNCHRO, { derniereLecture: Date.now() }, { merge: true });
  try { await setDoc(REF_EMPREINTES, { e: empreintesNouvelles, le: Date.now() }); } catch (e) { console.warn("Empreintes demandes :", e); }
  return { nouvelles: nouvelles.length, misesAJour: majs.length, total: fichier.length };
}

// 2) Dépôt du fichier des mises à jour (demandes modifiées dans l'appli)
// pour le flux Power Automate n° 2.
// Action (en cours ou traitée) + historique des échanges, pour la colonne
// commentaire : lisible dans Excel, du plus ancien au plus récent.
const nomPropre = (n) => String(n || "").trim().replace(/\S+/g, (m) => m.charAt(0).toUpperCase() + m.slice(1));
function texteAction(d) {
  if (!d.actionPour || !d.actionTexte) return "";
  const frd = (x) => (x ? String(x).slice(0, 10).split("-").reverse().join("/") : "");
  const jm = (x) => frd(x).slice(0, 5);
  const fil = (Array.isArray(d.actionFil) ? d.actionFil : []).filter(m => m.texte && !/^Action modifiée/.test(m.texte));
  // La ligne « Nouvelle action » de l'action en cours est déjà le titre : on ne la répète pas.
  const iCourante = fil.map(m => /^📌 Nouvelle action/.test(m.texte)).lastIndexOf(true);
  const histo = fil.filter((m, i) => i !== iCourante).map(m => {
    const t = m.fait ? `✓ ${m.texte === "Action faite" ? "action faite" : m.texte}`
      : /^📌 Nouvelle action pour /.test(m.texte) ? m.texte.replace(/^📌 Nouvelle action pour ([^:]+):/, (x, qui) => `action donnée à ${nomPropre(qui.trim())} :`)
      : m.texte;
    return `• ${jm(m.le)} ${nomPropre(m.de)} : ${t}`;
  }).slice(-5);
  const par = d.actionPar ? ` (donnée par ${nomPropre(d.actionPar)}${d.actionLe ? ` le ${jm(d.actionLe)}` : ""})` : "";
  const tete = d.actionFaiteLe
    ? `✓ ACTION FAITE — ${nomPropre(d.actionPourNom) || "?"}${par} : ${d.actionTexte} — faite le ${jm(d.actionFaiteLe)}${d.actionFaitePar && d.actionFaitePar !== d.actionPourNom ? ` par ${nomPropre(d.actionFaitePar)}` : ""}`
    : `${d.actionImmediate ? "🚨 ACTION IMMÉDIATE" : "📌 ACTION EN COURS"} — ${nomPropre(d.actionPourNom) || "?"}${par}${d.actionEcheance ? `, avant le ${jm(d.actionEcheance)}` : ""} : ${d.actionTexte}`;
  return tete + (histo.length ? `\nÉchanges :\n${histo.join("\n")}` : "");
}

// Demandes importées deux fois par le passé (même N° + même descriptif) :
// on garde la plus complète et on RELIE les autres comme doublons (masquées,
// non comptées, réversible avec « Délier »).
export async function regrouperDoublonsImport(demandesApp) {
  const empreinte = (x) => sa(x.descriptif).replace(/[^a-z0-9]/g, "").slice(0, 25);
  const groupes = new Map();
  (demandesApp || []).filter(d => !d.lieeA && !d.creeDansApp).forEach(d => { const c = `${d.numero}|${empreinte(d)}`; groupes.set(c, [...(groupes.get(c) || []), d]); });
  const score = (d) => (d.dateMaj ? 100 : 0) + (d.actionPour ? 50 : 0) + ["local", "demandeur", "logementOccupe", "commentaireTech", "intervenant", "dateIntervention"].filter(k => d[k]).length;
  const ops = [];
  for (const liste of groupes.values()) {
    if (liste.length < 2) continue;
    const [garde, ...autres] = [...liste].sort((a, b) => score(b) - score(a));
    const complement = {};
    ["local", "demandeur", "logementOccupe", "type", "dateDemande"].forEach(k => { if (!garde[k]) { const v = autres.find(x => x[k])?.[k]; if (v) complement[k] = v; } });
    if (Object.keys(complement).length) ops.push([garde.id, complement]);
    autres.forEach(x => ops.push([x.id, { lieeA: garde.id, lieeANumero: garde.numero, doublonImport: true }]));
  }
  for (let i = 0; i < ops.length; i += 400) {
    const batch = writeBatch(db);
    ops.slice(i, i + 400).forEach(([id, d]) => batch.update(doc(db, "demandes", id), { ...d, importMajLe: serverTimestamp() }));
    await batch.commit();
  }
  return ops.filter(o => o[1].doublonImport).length;
}

export async function deposerMisesAJour(demandesApp, { onProgress = () => {}, interactif = true } = {}) {
  const token = interactif ? await getGraphToken() : await getGraphTokenSilentOnly();
  if (!token) return { envoyees: 0 };
  const fr = (isoDate) => (isoDate ? isoDate.slice(0, 10).split("-").reverse().join("/") : "");
  // Seulement les demandes modifiées dans l'appli ces 7 derniers jours : le
  // flux Power Automate reste léger (quota d'actions quotidien) tout en
  // rattrapant largement un envoi manqué.
  const depuis = Date.now() - 7 * 86400000;
  const ms = (d) => d.dateMaj?.toMillis ? d.dateMaj.toMillis() : (d.dateMaj?.seconds ? d.dateMaj.seconds * 1000 : 0);
  const lignes = (demandesApp || []).filter(d => d.dateMaj && ms(d) >= depuis && !String(d.numero).startsWith("SN-") && !(d.creeDansApp && !d.vuDansFichier)).map(d => ({
    numero: d.numero,
    statut: d.statut === "Réalisé – à valider" ? "RÉALISÉ" : d.statut && d.statut !== "Non renseigné" ? d.statut.toUpperCase() : "",
    validation: d.validation === "OUI" ? "OUI" : "", dateValidation: fr(d.dateValidation), validePar: d.validePar || "",
    categorieIntervenant: d.categorieIntervenant || "",
    intervenant: d.intervenant || d.contact || "",
    dateIntervention: fr(d.dateIntervention),
    dateStatut: fr(d.dateStatut),
    commentaire: [d.lieeANumero ? `🔗 Doublon de ${d.lieeANumero}` : "", d.urgenceCorrigee ? `⚠️ Urgence requalifiée : ${d.urgenceCorrigee}${d.urgenceCorrigeePar ? ` (${d.urgenceCorrigeePar})` : ""}` : "", d.commentaireTech ? `💬 ${d.commentaireTechPar ? `${nomPropre(d.commentaireTechPar)}${d.commentaireTechLe ? " (" + fr(d.commentaireTechLe).slice(0, 5) + ")" : ""} : ` : ""}${d.commentaireTech}` : "", texteAction(d)].filter(Boolean).join("\n"),
  }));
  // Demandes créées dans l'appli, pas encore vues dans le fichier : lignes à AJOUTER.
  const nouvelles = (demandesApp || []).filter(d => d.creeDansApp && !d.vuDansFichier).map(d => ({
    numero: d.numero, dateDemande: fr(d.dateDemande), association: d.association === "École" ? "Ecole" : (d.association || ""), site: d.site || "",
    demandeur: d.demandeur || "", type: d.type || "", descriptif: d.descriptif || "", local: d.local || "", urgence: d.urgence || "",
    logementOccupe: d.logementOccupe || "", statut: (d.statut || "").toUpperCase(),
  }));
  onProgress(`Dépôt de ${lignes.length} demande(s) modifiée(s)${nouvelles.length ? ` et ${nouvelles.length} nouvelle(s)` : ""}…`);
  const fichier = new File([JSON.stringify({ genereLe: new Date().toISOString(), nouvelles, lignes }, null, 1)], FICHIER_MAJ, { type: "application/json" });
  await uploadToDrive(fichier, token, [], DOSSIER, { conflictBehavior: "replace", fixedFilename: FICHIER_MAJ });
  await setDoc(REF_SYNCHRO, { dernierDepot: Date.now(), dernierDepotLignes: lignes.length }, { merge: true });
  return { envoyees: lignes.length };
}

export async function lireDerniereSynchro() {
  try { const s = await getDoc(REF_SYNCHRO); return s.exists() ? s.data() : null; } catch { return null; }
}

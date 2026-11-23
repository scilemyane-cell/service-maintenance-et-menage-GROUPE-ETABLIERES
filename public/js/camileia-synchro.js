// camileia-synchro.js — Synchro Camileia → tickets de l'appli (version de TEST,
// Super Admin), automatique toutes les minutes tant que l'appli est ouverte.
//
// Quota Firebase : AUCUNE relecture de la base à chaque passage. Les tickets
// existants viennent de la copie déjà chargée par l'appli (watchDemandes) ;
// on n'écrit que ce qui a vraiment changé. Les appels à Camileia passent par
// le relais Google (hors quota Firebase). Référentiels et noms de lieux sont
// gardés en mémoire / sur l'appareil.
import { db } from "./firebase-init.js";
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from "./firestore-compte.js";
import { watchDemandes } from "./firestore-data.js";
import * as cam from "./camileia.js";
import { diVersDemande } from "./camileia-demandes.js";

const PERIODE_MS = 60 * 1000;
const CLE_LIEUX = "camileia-libelles-lieux";
const sa = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export const etat = { derniere: 0, erreur: "", crees: 0, majs: 0, enCours: false, actif: false };
const abonnes = new Set();
export const surEtat = (cb) => { abonnes.add(cb); return () => abonnes.delete(cb); };
const signaler = () => abonnes.forEach(cb => { try { cb(etat); } catch { /* */ } });

// Copie locale des demandes (écoute partagée déjà ouverte par l'appli : 0 lecture en plus).
let demandes = null; const attentes = [];
watchDemandes((l) => { demandes = l || []; attentes.splice(0).forEach(f => f()); });
const demandesPretes = () => (demandes ? Promise.resolve() : new Promise(r => attentes.push(r)));

// Libellés : référentiels (6 h) + lieux (gardés sur l'appareil).
const libelles = new Map();
try { Object.entries(JSON.parse(localStorage.getItem(CLE_LIEUX) || "{}")).forEach(([k, v]) => libelles.set(k, v)); } catch { /* */ }
const sauverLieux = () => { try { const o = {}; libelles.forEach((v, k) => { if (!/d_i_/.test(k)) o[k] = v; }); localStorage.setItem(CLE_LIEUX, JSON.stringify(o)); } catch { /* */ } };
let refsLe = 0;
async function chargerReferentiels() {
  if (Date.now() - refsLe < 6 * 3600 * 1000) return;
  const refs = await cam.lireReferentiels();
  Object.values(refs).forEach(liste => liste.forEach(x => { const i = cam.iriDe(x); if (i) libelles.set(i, cam.libelleLisible(x.libelle || x.label || "")); }));
  refsLe = Date.now();
}
async function resoudreLieux(brutes) {
  const iris = new Set();
  brutes.forEach(di => ["site", "batiment", "local", "zone"].forEach(k => { const i = cam.iriDe(di[k]); if (i && !cam.libelleDe(di[k]) && !libelles.has(i)) iris.add(i); }));
  for (const iri of [...iris].slice(0, 50)) {
    try { const r = await cam.appeler("GET", iri); const l = cam.libelleDe(r); libelles.set(iri, l || ""); } catch { libelles.set(iri, ""); }
  }
  if (iris.size) sauverLieux();
}
// Correspondance états → statuts enregistrée à l'écran (relue au plus 1 fois / heure).
let corresp = {}, correspLe = 0;
async function correspondances() {
  if (Date.now() - correspLe > 3600 * 1000) { try { corresp = (await getDoc(doc(db, "config", "camileia-correspondances")))?.data()?.etats || {}; } catch { /* */ } correspLe = Date.now(); }
  return corresp;
}
export const oublierCorrespondances = () => { correspLe = 0; };

const CHAMPS_CAMILEIA = ["dateDemande", "site", "association", "type", "descriptif", "local", "demandeur", "camileiaEtat", "camileiaEtatIri", "numero"];
const CHAMPS_TRAITEMENT = ["statut", "urgence", "dateIntervention", "dateStatut"];

// Lit les DI Camileia et crée / met à jour les tickets. Renvoie { crees, majs, dis }.
export async function synchroniser() {
  await demandesPretes();
  await chargerReferentiels();
  const c = await correspondances();
  const brutes = cam.avecIri(await cam.lireTout(`${cam.RACINE}/d_is`, { maxPages: 10 }), `${cam.RACINE}/d_is`);
  await resoudreLieux(brutes);
  const existants = new Map(demandes.filter(d => d.source === "camileia").map(d => [d.id, d]));
  const parSite = new Map();
  demandes.forEach(d => { if (d.source !== "camileia" && d.site && d.association && d.association !== "Autres") parSite.set(sa(d.site), d.association); });
  const assoc = (site) => { const k = sa(site); if (parSite.has(k)) return parSite.get(k); for (const [s, a] of parSite) if (k && (s.startsWith(k) || k.startsWith(s))) return a; return "Autres"; };
  let crees = 0, majs = 0;
  const dis = brutes.map(di => diVersDemande(di, { libelles, correspondances: c }));
  // DI créées depuis l'appli : déjà une demande → pas de ticket en double.
  const dejaLiees = new Set(demandes.filter(d => d.source !== "camileia" && d.camileiaId != null).map(d => String(d.camileiaId)));
  for (const d of dis) {
    if (dejaLiees.has(String(d.camileiaId))) continue;
    const id = `cam-${d.camileiaId}`;
    const { lieuxNonResolus, ...champs } = d;
    const base = { ...champs, association: assoc(d.site), source: "camileia", creeDansApp: true, vuDansFichier: false };
    const e = existants.get(id);
    if (!e) { await setDoc(doc(db, "demandes-camileia", id), { ...base, importeLe: serverTimestamp(), importMajLe: serverTimestamp() }); crees++; continue; }
    const maj = {};
    CHAMPS_CAMILEIA.forEach(k => { if ((e[k] || "") !== (base[k] || "")) maj[k] = base[k]; });
    // Ticket déjà traité dans l'appli : c'est l'appli qui fait foi pour le statut (comme avec l'Excel).
    if (!e.dateMaj) CHAMPS_TRAITEMENT.forEach(k => { if ((e[k] || "") !== (base[k] || "")) maj[k] = base[k]; });
    if (Object.keys(maj).length) { await updateDoc(doc(db, "demandes-camileia", id), { ...maj, importMajLe: serverTimestamp() }); majs++; }
  }
  return { crees, majs, dis };
}

async function passage() {
  if (etat.enCours || !cam.estConnecte()) return;
  etat.enCours = true; signaler();
  try { const r = await synchroniser(); etat.crees = r.crees; etat.majs = r.majs; etat.erreur = ""; }
  catch (e) { etat.erreur = e?.message || String(e); console.warn("Synchro Camileia :", etat.erreur); }
  etat.derniere = Date.now(); etat.enCours = false; signaler();
}
let minuteur = null;
export function demarrer() {
  if (minuteur) return;
  etat.actif = true;
  setTimeout(passage, 15000); // laisse l'appli finir de charger
  minuteur = setInterval(passage, PERIODE_MS);
}

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
const CHAMPS_TRAITEMENT = ["statut", "urgence", "dateIntervention", "dateStatut", "categoriePanne"];

// Lit les DI Camileia et crée / met à jour les tickets. Renvoie { crees, majs, dis }.
export async function synchroniser() {
  await demandesPretes();
  await chargerReferentiels();
  const c = await correspondances();
  let ctypes = {}; try { ctypes = await (await import("./camileia-envoi.js")).lireCorrespTypes(); } catch { /* */ }
  const brutes = cam.avecIri(await cam.lireTout(`${cam.RACINE}/d_is`, { maxPages: 10 }), `${cam.RACINE}/d_is`);
  try { await surveillerDI(brutes); } catch (e) { console.warn("Surveillance DI Camileia :", e); }
  try { await importerMessages(brutes); } catch (e) { console.warn("Messages Camileia :", e); }
  await resoudreLieux(brutes);
  const existants = new Map(demandes.filter(d => d.source === "camileia" && !String(d.id).startsWith("_")).map(d => [d.id, d]));
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
    const brut = brutes.find(b => String(b.id) === String(d.camileiaId));
    const catAppli = (await import("./camileia-envoi.js")).categorieAppliPourType(cam.iriDe(brut?.typepanne), ctypes);
    if (catAppli) base.categoriePanne = catAppli;
    const e = existants.get(id);
    if (!e) { await setDoc(doc(db, "demandes-camileia", id), { ...base, importeLe: serverTimestamp(), importMajLe: serverTimestamp() }); crees++; continue; }
    const maj = {};
    CHAMPS_CAMILEIA.forEach(k => { if ((e[k] || "") !== (base[k] || "")) maj[k] = base[k]; });
    // Ticket déjà traité dans l'appli : c'est l'appli qui fait foi pour le statut (comme avec l'Excel).
    if (!e.dateMaj) CHAMPS_TRAITEMENT.forEach(k => { if ((e[k] || "") !== (base[k] || "")) maj[k] = base[k]; });
    // DI clôturée dans Camileia : c'est définitif, le ticket de l'appli passe « Réalisé » (Clôturée).
    else if (/\/d_i_etats\/4$/.test(String(base.camileiaEtatIri || "")) && e.statut !== "Réalisé") { maj.statut = "Réalisé"; maj.dateStatut = base.dateStatut || e.dateStatut || ""; }
    if (Object.keys(maj).length) { await updateDoc(doc(db, "demandes-camileia", id), { ...maj, importMajLe: serverTimestamp() }); majs++; }
  }
  return { crees, majs, dis };
}

// ---- Surveillance : une DI sans état / type / libellé fait planter Camileia (erreur 500) ----
// On garde sur l'appareil les dernières valeurs saines de chaque DI ; si un champ
// essentiel disparaît, on le remet (sinon valeur par défaut) et on prévient.
const CLE_SAINES = "camileia-di-saines";
const ESSENTIELS = ["etat", "typepanne", "libelle", "site", "batiment", "priorite"];
const PAR_DEFAUT = { typepanne: null, libelle: "(sans libellé)" };
async function surveillerDI(brutes) {
  try { const ev = await import("./camileia-envoi.js"); PAR_DEFAUT.typepanne = ev.typeParDefaut(await ev.referentiels()); } catch { /* */ }
  let saines = {}; try { saines = JSON.parse(localStorage.getItem(CLE_SAINES) || "{}"); } catch { /* */ }
  const reparees = [];
  for (const di of brutes) {
    const k = String(di.id), connu = saines[k] || {};
    let actifs = null; try { const ev = await import("./camileia-envoi.js"); actifs = await ev.referentiels(); } catch { /* */ }
    if (di.typepanne && actifs && !(await import("./camileia-envoi.js")).typeActif(di.typepanne, actifs)) { di.typepanne = null; connu.typepanne = null; }
    const manquants = ESSENTIELS.filter(c => !di[c] && (connu[c] || PAR_DEFAUT[c] || c === "etat"));
    // priorité : seulement si elle existait avant (elle peut être vide à la création)
    if (manquants.length) {
      const corrige = {};
      manquants.forEach(c => { corrige[c] = connu[c] || (c === "etat" ? `${cam.RACINE}/d_i_etats/${di.datecloture ? 4 : 5}` : PAR_DEFAUT[c]); });
      const aRemettre = Object.fromEntries(Object.entries(corrige).filter(([, v]) => v));
      if (Object.keys(aRemettre).length) {
        try { await cam.changerEtat(cam.iriDe(di) || `${cam.RACINE}/d_is/${di.id}`, null, aRemettre); Object.assign(di, aRemettre); reparees.push(`${di.numero || di.id} (${Object.keys(aRemettre).join(", ")})`); }
        catch (e) { console.warn("Réparation DI", di.id, e); }
      }
    }
    saines[k] = Object.fromEntries(ESSENTIELS.filter(c => di[c]).map(c => [c, cam.iriDe(di[c]) || di[c]]));
  }
  try { localStorage.setItem(CLE_SAINES, JSON.stringify(saines)); } catch { /* */ }
  if (reparees.length) window.toast?.(`🛠️ Camileia : DI réparée${reparees.length > 1 ? "s" : ""} automatiquement — ${reparees.join(" · ")}`, "error");
}

// ---- Échanges (messages de la DI) : Camileia → fiche de l'appli ----
const CLE_MSG = "camileia-messages-cache";
async function importerMessages(brutes) {
  let cache = {}; try { cache = JSON.parse(localStorage.getItem(CLE_MSG) || "{}"); } catch { /* */ }
  let contacts = []; try { contacts = (await (await import("./camileia-envoi.js")).referentiels()).contacts; } catch { /* */ }
  const nomContact = (iri) => { const c = contacts.find(x => String(x.id) === String(cam.iriDe(iri) || iri || "").split("/").pop()); return c ? `${c.prenom || ""} ${c.nom || ""}`.trim() : ""; };
  // Demandes de l'appli reliées à une DI (tickets Camileia + demandes envoyées depuis l'appli)
  const parDi = new Map();
  demandes.forEach(d => { const id = d.camileiaId ?? (String(d.camileiaIri || "").split("/").pop() || null); if (id != null && id !== "") parDi.set(String(id), d); });
  for (const di of brutes) {
    const d = parDi.get(String(di.id)); if (!d) continue;
    const iris = (di.messages || []).map(m => cam.iriDe(m) || m).filter(Boolean);
    const msgs = [];
    for (const iri of iris) {
      if (!cache[iri]) { try { const m = await cam.appeler("GET", iri); cache[iri] = { id: m.id, auteur: nomContact(m.contact) || "Camileia", contact: String(cam.iriDe(m.contact) || m.contact || ""), texte: String(m.message || ""), date: m.date || "" }; } catch { continue; } }
      msgs.push(cache[iri]);
    }
    msgs.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const avant = Array.isArray(d.camileiaMessages) ? d.camileiaMessages : [];
    if (msgs.length === avant.length && msgs.every((m, i) => m.id === avant[i]?.id)) continue;
    // Nouveau message qui ne vient pas de l'appli → « non lu » (badge sur la fiche)
    const nouveaux = msgs.filter(m => !avant.some(a => a.id === m.id));
    const nonLu = nouveaux.some(m => !/^\[Appli SMM\]/.test(m.texte)) || !!d.camileiaMsgNonLu;
    const col = String(d.id).startsWith("cam-") ? "demandes-camileia" : "demandes";
    try { await updateDoc(doc(db, col, d.id), { camileiaMessages: msgs, camileiaMsgNonLu: nonLu }); } catch (e) { console.warn("Messages", d.id, e); }
  }
  try { localStorage.setItem(CLE_MSG, JSON.stringify(cache)); } catch { /* */ }
}

async function passage() {
  await cam.chargerRelaisPartage();
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

// camileia-envoi.js — Envoi d'une demande créée dans l'appli vers Camileia
// (version de TEST). Utilise la correspondance des sites validée dans
// Suivi des demandes › Camileia (test) (config/camileia-sites, sans secret).
import { db } from "./firebase-init.js";
import { doc, getDoc, setDoc } from "./firestore-compte.js";
import * as cam from "./camileia.js";

export const REF_SITES = doc(db, "config", "camileia-sites");
const sa = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export async function lireCorrespSites() {
  try { return (await getDoc(REF_SITES))?.data() || { sites: {} }; } catch { return { sites: {} }; }
}
export async function enregistrerCorrespSites(c) { await setDoc(REF_SITES, { ...c, le: Date.now() }); }

// Référentiels Camileia gardés 6 h en mémoire (évite ~6 appels au relais par envoi).
let refs = null, refsLe = 0;
export async function referentiels() {
  if (refs && Date.now() - refsLe < 6 * 3600 * 1000) return refs;
  const L = (c) => cam.lireTout(c, { maxPages: 3 }).then(l => cam.avecIri(l, c));
  const [sites, categories, types, priorites, etats, contacts] = await Promise.all([
    L(`${cam.RACINE}/sites`), L(`${cam.RACINE}/d_i_categorie_type_pannes`), L(`${cam.RACINE}/d_i_type_pannes`),
    L(`${cam.RACINE}/d_i_priorites`), L(`${cam.RACINE}/d_i_etats`), L(`${cam.RACINE}/contacts`)]);
  const actif = (x) => x.actif !== false && x.visible !== false;
  refs = { sites: sites.filter(x => x.actif !== false), categories: categories.filter(actif), types: types.filter(actif), priorites, etats, contacts: contacts.filter(c => c.actif !== false) };
  refsLe = Date.now();
  return refs;
}

// Proposition automatique : site Camileia le plus proche du nom de site de l'appli.
export function proposerSite(nomApp, sitesCam) {
  const a = sa(nomApp); if (!a) return null;
  const motsA = new Set(a.split(" ").filter(m => m.length > 2));
  let meilleur = null, score = 0;
  sitesCam.forEach(s => {
    const b = sa(s.libelle), c = sa(s.code);
    let sc = 0;
    if (b === a || c === a) sc = 100;
    else if (b && (a.startsWith(b) || b.startsWith(a))) sc = 60;
    else { const motsB = b.split(" ").filter(m => m.length > 2); const communs = motsB.filter(m => motsA.has(m)).length; if (communs) sc = 20 + 30 * communs / Math.max(motsA.size, motsB.length); }
    if (sc > score) { score = sc; meilleur = s; }
  });
  return score >= 40 ? meilleur : null;
}

// Type de panne : catégorie Camileia dont le nom correspond au « type » de
// l'appli (Plomberie, Électricité…), puis son type « Autre » ; sinon le type par défaut.
function choisirType(typeApp, r, typeDefaut) {
  const t = sa(typeApp);
  const cat = t && r.categories.find(c => { const l = sa(cam.libelleLisible(c.libelle)); return l && (l === t || l.startsWith(t) || t.startsWith(l)); });
  if (cat) {
    const dans = r.types.filter(x => x.categorie === cat["@id"]);
    const autre = dans.find(x => sa(cam.libelleLisible(x.libelle)) === "autre") || dans[0];
    if (autre) return autre["@id"];
  }
  return typeDefaut || (r.types.find(x => sa(cam.libelleLisible(x.libelle)) === "autre") || r.types[0] || {})["@id"];
}
const PRIORITE_POUR_URGENCE = { "critique": "vital", "urgent": "tres urgent", "normal": "moins urgent", "a planifier": "non urgent" };

// Crée la DI dans Camileia pour une demande de l'appli. Renvoie la DI créée.
export async function envoyerDemande(d, { email = "" } = {}) {
  const c = await lireCorrespSites();
  const m = c.sites?.[d.site];
  if (!m?.site || !m?.batiment) throw new Error(`Site « ${d.site} » non relié à Camileia (Suivi des demandes › Camileia (test) › Correspondance des sites).`);
  const r = await referentiels();
  const voulu = PRIORITE_POUR_URGENCE[sa(d.urgence)];
  const prio = voulu && r.priorites.find(p => sa(cam.libelleLisible(p.libelle)) === voulu);
  const etat = r.etats.find(e => sa(cam.libelleLisible(e.libelle)) === "a qualifier") || r.etats[0];
  const contact = email && r.contacts.find(x => String(x.email || "").toLowerCase() === email.toLowerCase());
  const descr = String(d.descriptif || "").trim();
  const libelle = (d.local ? `${d.local} — ` : "") + (descr.length > 90 ? descr.slice(0, 87) + "…" : descr);
  const note = [descr, d.local && `Local : ${d.local}`, d.demandeur && `Demandeur : ${d.demandeur}`, d.numero && `Créée depuis l'appli SMM (${d.numero})`].filter(Boolean).join("\n");
  return cam.creerDI({
    libelle, note, site: m.site, siteCode: m.siteCode, batiment: m.batiment, typepanne: choisirType(d.type, r, c.typeDefaut),
    priorite: prio?.["@id"] || null, etat: etat?.["@id"], createur: contact?.["@id"] || null, demandeur: d.demandeur || null,
  });
}

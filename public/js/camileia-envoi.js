// camileia-envoi.js — Envoi d'une demande créée dans l'appli vers Camileia
// (version de TEST). Utilise la correspondance des sites validée dans
// Suivi des demandes › Camileia (test) (config/camileia-sites, sans secret).
import { db } from "./firebase-init.js";
import { doc, getDoc, setDoc } from "./firestore-compte.js";
import * as cam from "./camileia.js";

export const REF_SITES = doc(db, "config", "camileia-sites");
// Catégorie de panne de l'appli (categories-pannes.js) → type de demande Camileia.
export const REF_TYPES = doc(db, "config", "camileia-types");
// Refonte du 24/11/2026 (outils/camileia-refonte-categories.js) : une catégorie Camileia par
// catégorie de l'appli. Le type précis est choisi d'après les mots du descriptif (typePourCategorie).
export const CATEGORIE_CAM = {
  plomberie: 14, electricite: 11, equipements: 900006, menuiserie: 15, peinture: 9, serrurerie: 5,
  chauffage: 2, nettoyage: 7, incendie: 17, courants: 900004, ecs: 900012, exterieur: 900013,
  logistique: 12, toiture: 18, nuisibles: 900014, autre: 1,
};
// Type « générique » de chaque catégorie, si aucun mot du descriptif ne correspond à un type précis.
export const TYPES_PROPOSES = {
  plomberie: 900024,     // Plomberie › Autre
  electricite: 900053,   // Éclairage
  equipements: 900069, menuiserie: 900018, peinture: 900019, serrurerie: 900009,
  chauffage: 2,          // Problème de chauffage / climatisation
  nettoyage: 18,         // Problème de propreté
  incendie: 900049,      // Détecteur de fumée
  courants: 900028, ecs: 23, exterieur: 900083, logistique: 900085,
  toiture: 34, nuisibles: 900095, autre: 900096,
};
export async function lireCorrespTypes() {
  let c = {}; try { c = (await getDoc(REF_TYPES))?.data()?.categories || {}; } catch { /* */ }
  const out = {}; Object.entries(TYPES_PROPOSES).forEach(([k, id]) => { out[k] = c[k] || `${cam.RACINE}/d_i_type_pannes/${id}`; });
  return out;
}
// Type Camileia pour une catégorie de l'appli : type de la catégorie Camileia dont le nom
// ressemble le plus au descriptif (« fuite mitigeur » → Robinet / mitigeur…), sinon le type générique.
const racine = (m) => m.slice(0, 5);
export async function typePourCategorie(catApp, texte = "", typeActuel = null) {
  const r = await referentiels();
  const idC = String(CATEGORIE_CAM[catApp] ?? "");
  const dans = r.types.filter(t => idType(t.categorie) === idC);
  if (!dans.length) { const ct = await lireCorrespTypes(); return typeActif(ct[catApp], r) || typeParDefaut(r); }
  if (typeActuel && dans.some(t => idType(t["@id"] || t.id) === idType(typeActuel))) return `${cam.RACINE}/d_i_type_pannes/${idType(typeActuel)}`;
  const mots = new Set(sa(texte).split(" ").filter(m => m.length > 3).map(racine));
  let meilleur = null, score = 0;
  for (const t of dans) {
    const lib = sa(cam.libelleLisible(t.libelle)); if (!lib || lib === "autre" || /^urgent/.test(lib)) continue; // motifs « URGENT – … » : choisis par le demandeur seulement
    const n = lib.split(" ").filter(m => m.length > 3 && mots.has(racine(m))).length;
    if (n > score) { score = n; meilleur = t; }
  }
  if (meilleur) return `${cam.RACINE}/d_i_type_pannes/${idType(meilleur["@id"] || meilleur.id)}`;
  const ct = await lireCorrespTypes(); const def = typeActif(ct[catApp], r);
  if (def && dans.some(t => idType(t["@id"] || t.id) === idType(def))) return def;
  const autre = dans.find(t => /^autre/.test(sa(cam.libelleLisible(t.libelle)))) || dans[0];
  return `${cam.RACINE}/d_i_type_pannes/${idType(autre["@id"] || autre.id)}`;
}
export async function enregistrerCorrespTypes(categories) { await setDoc(REF_TYPES, { categories, le: Date.now() }); }
// Type Camileia → catégorie de l'appli (sens retour), d'après la correspondance.
// Catégorie Camileia (Paramètres › Catégories) → catégorie de panne de l'appli.
const CAT_POUR_CATEGORIE_CAM = {
  // catégories actuelles (refonte 24/11/2026) + anciennes désactivées (DI plus anciennes)
  ...Object.fromEntries(Object.entries(CATEGORIE_CAM).map(([k, v]) => [v, k])),
  3: "chauffage", 4: "chauffage", 6: "serrurerie", 8: "equipements", 10: "electricite", 13: "serrurerie", 16: "peinture",
  900002: "logistique", 900003: "serrurerie", 900005: "peinture", 900007: "courants", 900008: "courants", 900009: "courants", 900010: "courants",
};
// Type de demande Camileia → catégorie de l'appli : d'abord la correspondance
// enregistrée (type exact), sinon d'après la catégorie Camileia du type.
export function categorieAppliPourType(typeIri, corresp, types = []) {
  const id = (v) => String(cam.iriDe(v) || v || "").split("/").pop();
  if (!typeIri) return "";
  const k = Object.entries(corresp || {}).find(([, iri]) => id(iri) === id(typeIri));
  if (k) return k[0];
  const t = types.find(x => id(x["@id"] || x.id) === id(typeIri));
  return (t && CAT_POUR_CATEGORIE_CAM[id(t.categorie)]) || "";
}
const PRIO_POUR_URGENCE = { "critique": "vital", "urgent": "tres urgent", "normal": "moins urgent", "a planifier": "non urgent" };
export async function prioritePourUrgence(urgence) {
  const r = await referentiels(); const v = PRIO_POUR_URGENCE[sa(urgence)];
  return (v && r.priorites.find(p => sa(cam.libelleLisible(p.libelle)) === v))?.["@id"] || null;
}
const sa = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export async function lireCorrespSites() {
  try { return (await getDoc(REF_SITES))?.data() || { sites: {} }; } catch { return { sites: {} }; }
}
export async function enregistrerCorrespSites(c) { await setDoc(REF_SITES, { ...c, le: Date.now() }); }

// Référentiels Camileia gardés 6 h en mémoire (évite ~6 appels au relais par envoi).
let refs = null, refsLe = 0;
export async function referentiels() {
  if (refs && Date.now() - refsLe < 6 * 3600 * 1000) return refs;
  const L = (c) => cam.lireTout(c, { maxPages: 3 }).then(l => cam.avecLibellesWeb(cam.avecIri(l, c), c));
  const [sites, categories, types, priorites, etats, contacts] = await Promise.all([
    L(`${cam.RACINE}/sites`), L(`${cam.RACINE}/d_i_categorie_type_pannes`), L(`${cam.RACINE}/d_i_type_pannes`),
    L(`${cam.RACINE}/d_i_priorites`), L(`${cam.RACINE}/d_i_etats`), L(`${cam.RACINE}/contacts`)]);
  const actif = (x) => x.actif !== false && x.visible !== false;
  refs = { sites: sites.filter(x => x.actif !== false), categories: categories.filter(actif), types: types.filter(actif), priorites, etats, contacts: contacts.filter(c => c.actif !== false) };
  refsLe = Date.now();
  return refs;
}

// Proposition automatique : site Camileia le plus proche du nom de site de l'appli.
// Contact Camileia de la personne connectée (auteur des messages, créateur des DI).
export async function contactParEmail(email) {
  if (!email) return null;
  const r = await referentiels();
  return r.contacts.find(x => String(x.email || "").toLowerCase() === String(email).toLowerCase()) || null;
}
// Locaux Camileia (≈ 1 500, gardés 6 h) : « CH 301 » dans l'appli → local du même nom dans le bâtiment.
let locaux = null, locauxLe = 0;
async function localPour(batimentIri, texte) {
  const t = sa(texte); if (!t || !batimentIri) return null;
  if (!locaux || Date.now() - locauxLe > 6 * 3600 * 1000) { locaux = cam.avecIri(await cam.lireTout(`${cam.RACINE}/locals`, { maxPages: 3 }), `${cam.RACINE}/locals`); locauxLe = Date.now(); }
  const dans = locaux.filter(l => l.batiment === batimentIri);
  const exact = dans.filter(l => sa(l.numero) === t || sa(l.libelle) === t);
  return exact.length === 1 ? exact[0]["@id"] : null;
}

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
// Un type de demande désactivé dans Camileia fait planter la fiche (erreur 500) : on ne l'envoie jamais.
const idType = (v) => String(cam.iriDe(v) || v || "").split("/").pop();
export const typeActif = (iri, r) => iri && r.types.some(t => idType(t["@id"] || t.id) === idType(iri)) ? `${cam.RACINE}/d_i_type_pannes/${idType(iri)}` : null;
export function typeParDefaut(r) {
  const parId = (id) => r.types.find(t => idType(t["@id"] || t.id) === String(id));
  const t = parId(1) || r.types.find(x => idType(x.categorie) === "1") || r.types[0];
  return t ? `${cam.RACINE}/d_i_type_pannes/${idType(t["@id"] || t.id)}` : null;
}
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
  // Site et bâtiment choisis directement dans la liste Camileia (formulaire de la version test).
  const m = d.camSite && d.camBatiment ? { site: `${cam.RACINE}/sites/${d.camSite}`, batiment: `${cam.RACINE}/batiments/${d.camBatiment}`, siteCode: d.camSiteCode || c.sites?.[d.site]?.siteCode } : c.sites?.[d.site];
  if (!m?.site || !m?.batiment) throw new Error(`Site « ${d.site} » non relié à Camileia (Suivi des demandes › Camileia (test) › Correspondance des sites).`);
  const r = await referentiels();
  const voulu = PRIORITE_POUR_URGENCE[sa(d.urgence)];
  const prio = voulu && r.priorites.find(p => sa(cam.libelleLisible(p.libelle)) === voulu);
  const etat = r.etats.find(e => sa(cam.libelleLisible(e.libelle)) === "a qualifier") || r.etats[0];
  const contact = email && r.contacts.find(x => String(x.email || "").toLowerCase() === email.toLowerCase());
  const descr = String(d.descriptif || "").trim();
  const libelle = (d.local ? `${d.local} — ` : "") + (descr.length > 90 ? descr.slice(0, 87) + "…" : descr);
  const note = [descr, d.local && `Local : ${d.local}`, d.demandeur && `Demandeur : ${d.demandeur}`, d.numero && `Créée depuis l'appli SMM (${d.numero})`].filter(Boolean).join("\n");
  let local = null; try { local = await localPour(m.batiment, d.local); } catch { /* local facultatif */ }
  // Type : catégorie de la demande (corrigée ou automatique) → type Camileia de la correspondance.
  let typeIri = null;
  try { const { categorieDe } = await import("./categories-pannes.js"); typeIri = await typePourCategorie(categorieDe(d), `${descr} ${d.local || ""}`); } catch { /* repli ci-dessous */ }
  return cam.creerDI({
    libelle, note, site: m.site, siteCode: m.siteCode, batiment: m.batiment, local, typepanne: typeActif(typeIri, r) || typeActif(choisirType(d.type, r, c.typeDefaut), r) || typeParDefaut(r), // jamais vide ni désactivé : sinon la fiche Camileia plante (erreur 500)
    priorite: prio?.["@id"] || null, etat: etat?.["@id"], createur: contact?.["@id"] || null, demandeur: d.demandeur || null,
  });
}

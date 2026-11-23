// camileia.js — Client de l'API Camileia (GMAO), module Demandes d'intervention.
// Doc : groupe-etablieres.camileia.com › menu « Modules » (API Platform).
//
// Deux façons de joindre l'API :
//  • « direct » : le navigateur appelle Camileia. Les identifiants sont tapés à
//    l'écran, JAMAIS enregistrés : seul le jeton (valable quelques heures) est
//    gardé pour la session de l'onglet. Ne marche que si Camileia autorise
//    les appels depuis l'adresse de l'appli (CORS).
//  • « relais » : un petit script Google Apps Script (outils/camileia-relais.gs)
//    garde les identifiants et fait les appels à la place du navigateur.
//
// Rien ici n'est jamais supprimé dans Camileia (l'API n'a pas de DELETE).

const CLE_CONFIG = "camileia-config";
const CLE_JETON = "camileia-jeton";
const BASE_DEFAUT = "https://groupe-etablieres.camileia.com";
export const RACINE = "/api-platform";

export function lireConfig() {
  try { return { mode: "direct", base: BASE_DEFAUT, relaisUrl: "", relaisCle: "", ...JSON.parse(localStorage.getItem(CLE_CONFIG) || "{}") }; }
  catch { return { mode: "direct", base: BASE_DEFAUT, relaisUrl: "", relaisCle: "" }; }
}
export function enregistrerConfig(c) { try { localStorage.setItem(CLE_CONFIG, JSON.stringify({ ...lireConfig(), ...c })); } catch { /* */ } }

const lireJeton = () => { try { return sessionStorage.getItem(CLE_JETON) || ""; } catch { return ""; } };
const ecrireJeton = (t) => { try { t ? sessionStorage.setItem(CLE_JETON, t) : sessionStorage.removeItem(CLE_JETON); } catch { /* */ } };
export const estConnecte = () => lireConfig().mode === "relais" ? !!lireConfig().relaisUrl : !!lireJeton();
export function deconnecter() { ecrireJeton(""); }

export class ErreurCamileia extends Error {
  constructor(message, { statut = 0, corps = null } = {}) { super(message); this.statut = statut; this.corps = corps; }
}
const MSG_CORS = "Appel bloqué par le navigateur : Camileia n'autorise pas l'appel direct depuis l'appli (CORS) ou le serveur est injoignable. Il faut passer par le relais (mode « relais »).";

async function lireReponse(r) {
  const t = await r.text();
  try { return t ? JSON.parse(t) : null; } catch { return t; }
}
function messageErreur(statut, corps) {
  const detail = corps && typeof corps === "object" ? (corps["hydra:description"] || corps.detail || corps.message || corps.title || JSON.stringify(corps).slice(0, 300)) : String(corps || "").slice(0, 300);
  if (statut === 401) return `Non autorisé (401) : jeton absent ou expiré — reconnecte-toi. ${detail}`;
  if (statut === 403) return `Accès refusé (403) : ce compte API n'a pas le droit sur cette ressource. ${detail}`;
  if (statut === 404) return `Introuvable (404). ${detail}`;
  return `Erreur Camileia ${statut} : ${detail}`;
}

// Connexion (mode direct) : POST /api-authentication → jeton.
// Le format exact attendu n'est pas documenté : on essaie les noms de champs
// les plus courants et on garde la réponse brute en cas d'échec.
export async function connecter(identifiant, motDePasse) {
  const { base } = lireConfig();
  const essais = [{ username: identifiant, password: motDePasse }, { login: identifiant, password: motDePasse }, { _username: identifiant, _password: motDePasse }];
  let derniere = null;
  for (const corps of essais) {
    let r;
    try { r = await fetch(`${base}/api-authentication`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(corps) }); }
    catch { throw new ErreurCamileia(MSG_CORS); }
    const d = await lireReponse(r);
    const jeton = d && typeof d === "object" ? (d.token || d.jwt || d.access_token) : "";
    if (r.ok && jeton) { ecrireJeton(jeton); return true; }
    derniere = { statut: r.status, corps: d };
    if (r.status !== 400 && r.status !== 401 && r.status !== 422) break;
  }
  throw new ErreurCamileia(`Connexion refusée : ${messageErreur(derniere?.statut, derniere?.corps)}`, derniere || {});
}

// Appel générique. chemin = "/api-platform/d_is?page=1" ou une IRI.
export async function appeler(methode, chemin, corps = null) {
  const cfg = lireConfig();
  if (!chemin.startsWith("/")) chemin = "/" + chemin;
  if (cfg.mode === "relais") {
    if (!cfg.relaisUrl) throw new ErreurCamileia("Adresse du relais non renseignée.");
    let r;
    // text/plain : requête « simple », sans pré-vérification CORS (Apps Script ne la gère pas).
    try { r = await fetch(cfg.relaisUrl, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ cle: cfg.relaisCle, methode, chemin, corps }) }); }
    catch { throw new ErreurCamileia("Relais injoignable : vérifie l'adresse du relais (déploiement Apps Script « Application Web », accès « Tout le monde »)."); }
    const d = await lireReponse(r);
    if (!d || typeof d !== "object") throw new ErreurCamileia(`Réponse du relais illisible : ${String(d).slice(0, 200)}`);
    if (d.erreur) throw new ErreurCamileia(`Relais : ${d.erreur}`);
    if (d.statut >= 400) throw new ErreurCamileia(messageErreur(d.statut, d.corps), { statut: d.statut, corps: d.corps });
    return d.corps;
  }
  const jeton = lireJeton();
  if (!jeton) throw new ErreurCamileia("Non connecté à Camileia.", { statut: 401 });
  // JSON simple : Camileia refuse « application/ld+json » (406 Not Acceptable).
  const enTetes = { Authorization: `Bearer ${jeton}`, Accept: "application/json" };
  if (corps != null) enTetes["Content-Type"] = "application/json";
  let r;
  try { r = await fetch(cfg.base + chemin, { method: methode, headers: enTetes, body: corps != null ? JSON.stringify(corps) : undefined }); }
  catch { throw new ErreurCamileia(MSG_CORS); }
  const d = await lireReponse(r);
  if (r.status === 401) ecrireJeton("");
  if (!r.ok) throw new ErreurCamileia(messageErreur(r.status, d), { statut: r.status, corps: d });
  return d;
}

// Collection API Platform (Hydra ou JSON simple), toutes pages jusqu'à maxPages.
export function membres(d) {
  if (Array.isArray(d)) return d;
  return (d && (d["hydra:member"] || d.member)) || [];
}
export async function lireTout(chemin, { maxPages = 20, onPage = () => {} } = {}) {
  const out = [], vus = new Set();
  // Camileia renvoie des tableaux JSON simples ; selon la ressource, « page »
  // est ignoré (toute la liste à chaque fois). On dédoublonne par id et on
  // s'arrête dès qu'une page n'apporte plus rien de nouveau.
  const avecPage = (n) => chemin + (chemin.includes("?") ? "&" : "?") + `page=${n}`;
  for (let n = 1; n <= maxPages; n++) {
    const d = await appeler("GET", /[?&]page=/.test(chemin) ? chemin : avecPage(n));
    const m = membres(d);
    let nouveaux = 0;
    m.forEach(x => { const k = x && x.id != null ? String(x.id) : JSON.stringify(x); if (!vus.has(k)) { vus.add(k); out.push(x); nouveaux++; } });
    onPage(n, out.length);
    if (!Array.isArray(d)) {
      const vue = d && (d["hydra:view"] || d.view);
      if (!(vue && (vue["hydra:next"] || vue.next))) break;
    } else if (!nouveaux || /[?&]page=/.test(chemin)) break;
  }
  return out;
}

// Libellés tels qu'affichés dans l'interface web de Camileia (l'API renvoie
// « custom.Fuitesurclimatiseur ») — relevés le 23/11/2026 dans Paramètres ›
// Types de demandes et sur une fiche DI. Un type ajouté depuis retombe sur le
// libellé de l'API.
const LIB_TYPES_PANNE = {"1": "Autre", "2": "Problème de chauffage/climatisation", "3": "J'ai trop chaud", "4": "J'ai trop froid", "5": "Le radiateur ne fonctionne pas", "6": "On a plus de chauffage", "7": "On a plus de climatisation", "8": "Il y a un bruit anormal", "9": "Il y a une odeur anormale", "10": "Le VMC ne fonctionne pas", "11": "L'ascenseur est bloqué", "12": "La porte du garage ne fonctionne pas", "13": "La porte du SAS ne fonctionne pas", "14": "Il n'y a plus d'électricité", "15": "La lumière ne fonctionne pas", "16": "Problème avec le disjoncteur du tableau de distribution", "17": "Ma prise ne fonctionne pas", "18": "Problème de propreté", "19": "Ma corbeille n'a pas été vidée", "20": "Les vitres ne sont pas propres", "21": "Le sol n'est pas propre", "22": "Le robinet fuit", "23": "Il n'y a pas d'eau chaude", "24": "Pas d'eau froide", "25": "Les WC sont bouchés", "26": "La fontaine d'eau ne fonctionne pas", "27": "Ma serrure ne fonctionne pas", "28": "Ma fenêtre ne s'ouvre pas", "29": "Ma poignée de porte est cassée", "30": "Il manque une dalle de faux plafond", "31": "Mon badge ne fonctionne plus", "32": "J'ai besoin d'un nouveau badge", "33": "Le BEAS est hors service", "34": "Infiltration d'eau", "35": "Fuite d'étanchéité", "900002": "Suivi contrôle réglementaire", "900003": "Demandes d'aménagement", "900004": "Demande d'équipements", "900005": "Demande de clé", "900006": "Paramétrage d'accès sur badge existant", "900007": "Autre", "900008": "Autre", "900009": "Autre", "900010": "Fuite sur radiateur", "900011": "Fuite sur climatiseur", "900012": "Clé cassée", "900013": "Clé perdue", "900014": "Changement de cylindre", "900015": "Masterlock", "900016": "Vitre cassée / fêlée", "900017": "Volet roulant", "900018": "Porte cassée", "900019": "Réparation mobilier", "900020": "Achat mobilier", "900021": "Demande ponctuelle (évènement)", "900022": "Abattant de toilettes cassé", "900023": "Siphon bouché", "900024": "Autre", "900025": "Portail", "900026": "Barrière", "900027": "Affichage HS", "900028": "Equipement interphone logement HS", "900029": "Platine HS", "900030": "Lecteur de badge HS", "900031": "Recomplètement consommables", "900032": "Recomplètement consommables", "900033": "Recomplètement consommables", "900034": "Recomplètement consommables", "900035": "Prestation exceptionnelle", "900036": "Remise en état peinture", "900037": "Salle de bain", "900038": "Cuisine", "900039": "Sol", "900040": "Plafond", "900041": "Sanitaires", "900042": "Peinture", "900043": "Cloison", "900044": "SSI en défaut", "900045": "Extincteur", "900046": "Désenfumage", "900047": "Arrêt d'urgence percuté", "900048": "Alarme", "900049": "Détecteur de fumée", "900050": "Eclairage de sécurité", "900051": "Zone à sécuriser", "900052": "Zone à sécuriser", "900053": "Eclairage", "900054": "Réfrigérateur", "900055": "Plaques de cuisson", "900056": "Pommeau de douche", "900057": "Barre de douche", "900058": "Bouche d'aération"};
const LIB_CATEGORIES = {"1": "Autre", "2": "Chauffage", "3": "Climatisation", "4": "Ventilation", "5": "Badges", "6": "Contrôle d'accès", "7": "Propreté", "8": "Ascenseur", "9": "Mobilier", "10": "Éclairage", "11": "Électricité", "12": "Traitement des déchets", "13": "Portes automatiques", "14": "Plomberie", "15": "Menuiserie", "16": "Travaux de finition", "17": "Sécurité", "18": "Toit", "900001": "Suivi contrôle réglementaire", "900002": "Salle de réunion", "900003": "Gestion des clés", "900004": "Interphonie", "900005": "Travaux", "900006": "Équipements", "900007": "Informatique / Téléphonie / Multimédia", "900008": "Informatique", "900009": "Téléphonie", "900010": "Multimédia", "900011": "Compte utilisateur"};
// Remplace le libellé brut par celui de l'interface pour les types / catégories de panne.
export function avecLibellesWeb(liste, collection) {
  const dico = /d_i_type_pannes/.test(collection) ? LIB_TYPES_PANNE : /d_i_categorie_type_pannes/.test(collection) ? LIB_CATEGORIES : null;
  if (!dico) return liste;
  return (liste || []).map(x => (x && dico[String(x.id)] ? { ...x, libelle: dico[String(x.id)] } : x));
}

// Libellés Camileia = clés de traduction (« word.Encours », « message.Attentedevis »).
const LIBELLES = {
  encours: "En cours", attentedevis: "Attente devis", terminee: "Terminée", cloturee: "Clôturée",
  aqualifier: "À qualifier", nonqualifiee: "Non qualifiée", prisencompte: "Pris en compte",
  nonurgent: "Non urgent", moinsurgent: "Moins urgent", semiurgent: "Semi-urgent", tresurgent: "Très urgent", vital: "Vital",
};
export function libelleLisible(l) {
  const brut = String(l ?? "").replace(/^(word|message|label|enum|custom)\./i, "");
  return LIBELLES[brut.toLowerCase()] || brut.replace(/([a-zà-ÿ])([A-Z])/g, "$1 $2");
}

// Une valeur d'IRI peut arriver en texte (« /api-platform/d_i_etats/3 »)
// ou en objet intégré ({ "@id": …, libelle: … }).
export const iriDe = (v) => (v && typeof v === "object" ? v["@id"] || "" : v || "");
export const libelleDe = (v) => (v && typeof v === "object" ? libelleLisible(v.libelle || v.label || v.nom || v.name || "") : "");
export const idDepuisIri = (iri) => { const m = String(iri || "").match(/\/(\d+)\/?$/); return m ? +m[1] : null; };

// Référentiels du module DI (pour traduire les IRI en libellés).
export const REFERENTIELS = {
  etats: `${RACINE}/d_i_etats`,
  priorites: `${RACINE}/d_i_priorites`,
  typesPanne: `${RACINE}/d_i_type_pannes`,
  categories: `${RACINE}/d_i_categorie_type_pannes`,
  types: `${RACINE}/d_i_types`,
};
// JSON simple : pas de « @id » → reconstruit depuis la collection + id.
export function avecIri(liste, collection) {
  return (liste || []).map(x => (x && typeof x === "object" && !x["@id"] && x.id != null ? { ...x, "@id": `${collection.split("?")[0]}/${x.id}` } : x));
}
export async function lireReferentiels(onProgress = () => {}) {
  const out = {};
  for (const [cle, chemin] of Object.entries(REFERENTIELS)) {
    onProgress(`Lecture ${cle}…`);
    try { out[cle] = avecLibellesWeb(avecIri(await lireTout(chemin, { maxPages: 10 }), chemin), chemin); }
    catch (e) { out[cle] = []; out[cle].erreur = e.message; }
  }
  return out;
}

// ---- Envois vers Camileia (aucune suppression possible) ----
// Message / compte rendu sur une DI.
export function envoyerMessage(diIri, texte, contactIri = null) {
  return appeler("POST", `${RACINE}/d_i_messages`, { di: diIri, contact: contactIri, message: texte, date: new Date().toISOString() });
}
// Changement d'état : l'API n'a que PUT (remplacement complet) → on relit
// la DI juste avant pour ne rien écraser de ce qui a changé dans Camileia.
export async function changerEtat(diIri, etatIri, enPlus = {}) {
  const actuelle = await appeler("GET", diIri);
  const corps = { ...actuelle, ...(etatIri ? { etat: etatIri } : {}), ...enPlus };
  ["@context", "@type", "@id"].forEach(k => delete corps[k]);
  Object.keys(corps).forEach(k => { const v = corps[k];
    if (v && typeof v === "object" && !Array.isArray(v) && v["@id"]) corps[k] = v["@id"];
    if (Array.isArray(v)) corps[k] = v.map(x => (x && typeof x === "object" && x["@id"] ? x["@id"] : x)); });
  return appeler("PUT", diIri, corps);
}

// ---- Création d'une DI dans Camileia ----
// Champs obligatoires côté Camileia : dateouverture, numero, libelle, etat,
// typepanne, site, batiment, P3, chargerecuperable, createurs, iot.
// Le N° est d'abord laissé à Camileia ; s'il est exigé, on en génère un.
export async function creerDI({ libelle, note, site, siteCode, batiment, local = null, typepanne, priorite, etat, createur, demandeur }) {
  const base = {
    dateouverture: new Date().toISOString(), libelle, note: note || null, etat, typepanne, site, batiment, ...(local ? { local } : {}),
    priorite: priorite || null, P3: false, chargerecuperable: false, iot: false,
    createurs: createur ? [createur] : [], demandeur: demandeur || null,
  };
  try { return await appeler("POST", `${RACINE}/d_is`, base); }
  catch (e) {
    if (!(e.statut >= 400 && e.statut < 500) || !/numero/i.test(JSON.stringify(e.corps || e.message))) throw e;
    const d = new Date(), aamm = `${String(d.getFullYear()).slice(2)}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    return appeler("POST", `${RACINE}/d_is`, { ...base, numero: `${siteCode || "SMM"}/${aamm}/SMM${String(Date.now()).slice(-5)}` });
  }
}

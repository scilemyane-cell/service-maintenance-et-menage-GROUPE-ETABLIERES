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
  const enTetes = { Authorization: `Bearer ${jeton}`, Accept: "application/ld+json" };
  if (corps != null) enTetes["Content-Type"] = "application/ld+json";
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
  const out = [];
  let suivant = chemin, n = 0;
  while (suivant && n < maxPages) {
    const d = await appeler("GET", suivant);
    out.push(...membres(d));
    n++; onPage(n, out.length);
    const vue = d && (d["hydra:view"] || d.view);
    const next = vue && (vue["hydra:next"] || vue.next);
    suivant = next && next !== suivant ? next : null;
  }
  return out;
}

// Une valeur d'IRI peut arriver en texte (« /api-platform/d_i_etats/3 »)
// ou en objet intégré ({ "@id": …, libelle: … }).
export const iriDe = (v) => (v && typeof v === "object" ? v["@id"] || "" : v || "");
export const libelleDe = (v) => (v && typeof v === "object" ? v.libelle || v.label || v.nom || v.name || "" : "");
export const idDepuisIri = (iri) => { const m = String(iri || "").match(/\/(\d+)\/?$/); return m ? +m[1] : null; };

// Référentiels du module DI (pour traduire les IRI en libellés).
export const REFERENTIELS = {
  etats: `${RACINE}/d_i_etats`,
  priorites: `${RACINE}/d_i_priorites`,
  typesPanne: `${RACINE}/d_i_type_pannes`,
  categories: `${RACINE}/d_i_categorie_type_pannes`,
  types: `${RACINE}/d_i_types`,
};
export async function lireReferentiels(onProgress = () => {}) {
  const out = {};
  for (const [cle, chemin] of Object.entries(REFERENTIELS)) {
    onProgress(`Lecture ${cle}…`);
    try { out[cle] = await lireTout(chemin, { maxPages: 10 }); }
    catch (e) { out[cle] = []; out[cle].erreur = e.message; }
  }
  return out;
}

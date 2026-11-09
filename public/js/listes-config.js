// listes-config.js — Listes de l'appli modifiables depuis l'interface
// (Administration > ⚙️ Paramétrage), au lieu d'être figées dans le code.
//
// Chaque module déclare sa liste avec listeVive(clé, valeursParDéfaut, options) :
// il reçoit un TABLEAU qu'il utilise comme avant. Quand la liste est modifiée
// dans l'appli, ce même tableau est mis à jour sur place (pas besoin de
// toucher au reste du code du module). Les valeurs du code servent de point
// de départ tant que personne n'a modifié la liste.
//
// Stockage : un seul document Firestore config/listes
//   l.<clé> = { items: [...format stocké...], majLe, majPar }
//   journal = [{ le, par, cle, label, detail }] (300 derniers changements)
// Une valeur « masquée » reste enregistrée (historique) mais n'est plus proposée.
import { db, auth } from "./firebase-init.js";
import { doc, onSnapshot, setDoc } from "./firestore-compte.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

const REF = () => doc(db, "config", "listes");
const CACHE = "smm-listes-v1";
const REG = {};               // clé → { defauts, opts, ref }
let stock = lireCache();      // clé → { items, majLe, majPar }
let journal = [];
let ecoute = null;
const abonnes = new Set();

function lireCache() { try { return JSON.parse(localStorage.getItem(CACHE) || "{}") || {}; } catch { return {}; } }
function ecrireCache() { try { localStorage.setItem(CACHE, JSON.stringify(stock)); } catch { /* stockage indisponible */ } }

// Conversions par type de liste ---------------------------------------------
// texte   : runtime = ["a", "b"]           stocké = [{ v: "a" }, { v: "b", masque: true }]
// tableau : runtime = objets ou n-uplets   stocké = [{ ...colonnes, masque? }]
// groupes : runtime = [{ theme, liste: [{ id, texte, niveau, sous? }] }] (missions)
function versStockDefaut(cle) {
  const r = REG[cle]; if (!r) return [];
  if (r.opts.versStock) return r.opts.versStock(r.defauts);
  if (r.opts.type === "groupes") return r.defauts.map(g => ({ theme: g.theme, liste: g.liste.map(x => ({ ...x })) }));
  if (r.opts.type === "tableau") return r.defauts.map(x => ({ ...x }));
  return r.defauts.map(v => ({ v }));
}
function versRuntime(cle, items) {
  const r = REG[cle];
  const actifs = (items || []).filter(i => !i.masque);
  if (r.opts.versRuntime) return r.opts.versRuntime(actifs);
  if (r.opts.type === "groupes") return actifs.map(g => ({ theme: g.theme, liste: (g.liste || []).filter(x => !x.masque).map(({ masque, ...x }) => x) }));
  if (r.opts.type === "tableau") return actifs.map(({ masque, ...x }) => x);
  return actifs.map(i => i.v).filter(v => v !== undefined && v !== "");
}
function appliquer(cle) {
  const r = REG[cle]; if (!r) return;
  const s = stock[cle];
  const valeurs = s && Array.isArray(s.items) ? versRuntime(cle, s.items) : r.defauts.map(x => (Array.isArray(x) ? [...x] : x && typeof x === "object" ? { ...x } : x));
  r.ref.splice(0, r.ref.length, ...valeurs);
  r.opts.apresMaj?.(r.ref);
}

// Déclare une liste modifiable et renvoie le tableau vivant à utiliser.
export function listeVive(cle, defauts, opts = {}) {
  const ref = [];
  REG[cle] = { defauts: defauts.map(x => (Array.isArray(x) ? [...x] : x && typeof x === "object" ? { ...x } : x)), opts, ref };
  appliquer(cle);
  demarrer();
  return ref;
}

function demarrer() {
  if (ecoute !== null) return;
  ecoute = false;
  onAuthStateChanged(auth, (u) => {
    if (!u) { if (typeof ecoute === "function") ecoute(); ecoute = false; return; }
    if (typeof ecoute === "function") return;
    ecoute = onSnapshot(REF(), (snap) => {
      const d = snap.exists() ? snap.data() : {};
      stock = d.l && typeof d.l === "object" ? d.l : {};
      journal = Array.isArray(d.journal) ? d.journal : [];
      ecrireCache();
      Object.keys(REG).forEach(appliquer);
      abonnes.forEach(f => { try { f(); } catch (e) { console.warn(e); } });
      try { window.dispatchEvent(new CustomEvent("listes-maj")); } catch { /* hors navigateur */ }
    }, (e) => console.warn("Listes paramétrables :", e));
  });
}

// --- API pour l'écran Paramétrage ------------------------------------------
export const estDeclaree = (cle) => !!REG[cle];
export const optionsListe = (cle) => REG[cle]?.opts || {};
export const estModifiee = (cle) => !!stock[cle];
export const infosListe = (cle) => stock[cle] ? { majLe: stock[cle].majLe, majPar: stock[cle].majPar } : null;
// Liste complète au format stocké (masquées comprises), ou les valeurs du code.
export const itemsListe = (cle) => JSON.parse(JSON.stringify(stock[cle]?.items || versStockDefaut(cle)));
export const journalListes = () => [...journal].reverse();
export function ecouterListes(f) { abonnes.add(f); demarrer(); return () => abonnes.delete(f); }

export async function enregistrerListe(cle, items, user, label, detail) {
  const qui = user?.nom || user?.email || "";
  const le = Date.now();
  const entree = { le, par: qui, cle, label: label || cle, detail: detail || "Modification" };
  const j = [...journal, entree].slice(-300);
  await setDoc(REF(), { l: { [cle]: { items, majLe: le, majPar: qui } }, journal: j }, { merge: true });
}
export async function reinitialiserListe(cle, user, label) {
  const qui = user?.nom || user?.email || "";
  const entree = { le: Date.now(), par: qui, cle, label: label || cle, detail: "Remise aux valeurs d'origine" };
  const l = { ...stock }; delete l[cle];
  // Réécrit la carte entière pour vraiment supprimer la clé.
  await setDoc(REF(), { l, journal: [...journal, entree].slice(-300) }, { merge: false });
}

// stock-menage-data.js
// Stock des produits de ménage (papier toilette, savon, produits
// d'entretien...) — distinct du Stock maintenance (pièces techniques).
// Deux stocks séparés (École / Agropolis) — chaque produit appartient à
// une zone. Chaque sortie est attribuée soit à un centre (dossier de
// site) concerné par cette zone, soit au dispositif MNA.

import { db } from "./firebase-init.js";
import {
  doc, addDoc, updateDoc, getDoc, getDocs, onSnapshot, deleteDoc, setDoc, deleteField, serverTimestamp,
  collection, query, where,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const PRODUITS = "stock-menage-produits";
const SORTIES = "stock-menage-sorties";
const PARAMETRES_DOC = () => doc(db, "config", "stock-menage-zones");

// Attribution spéciale, en plus des centres (dossiers de site) —
// le dispositif MNA n'est pas un site géographique classique.
export const MNA_ID = "__dispositif_mna__";
export const MNA_LABEL = "Dispositif MNA";

export const ZONES = { ecole: "École", agropolis: "Agropolis" };

export const CATEGORIES_MENAGE = [
  "Papier toilette", "Savon / hygiène", "Produits d'entretien", "Sacs poubelle",
  "Essuie-mains / papier", "Désinfectants", "Autre",
];

export function nouveauProduit(zone) {
  return {
    nom: "", categorie: "", unite: "pièce", stockActuel: 0,
    stockMin: 0, stockMax: 0,
    uniteParEmballage: 0, uniteParPalette: 0,
    zone, supprimeLe: null,
  };
}

export function watchProduits(callback) {
  return onSnapshot(collection(db, PRODUITS), (snap) => {
    const list = [];
    snap.forEach((d) => { if (!d.data().supprimeLe) list.push({ id: d.id, ...d.data() }); });
    callback(list.sort((a, b) => (a.categorie || "").localeCompare(b.categorie || "") || (a.nom || "").localeCompare(b.nom || "")));
  }, (err) => { console.error("watchProduits (stock menage):", err); callback([]); });
}

export async function creerProduit(item) {
  await addDoc(collection(db, PRODUITS), item);
}

export async function modifierProduit(id, patch) {
  await updateDoc(doc(db, PRODUITS, id), patch);
}

export async function supprimerProduit(id) {
  await updateDoc(doc(db, PRODUITS, id), { supprimeLe: serverTimestamp() });
}

// Enregistre une sortie de stock, attribuée à un centre (dossierId d'un
// site) ou au dispositif MNA (MNA_ID) — décrémente le stock du produit
// et journalise la sortie pour le suivi par attribution.
export async function enregistrerSortie(produit, quantite, attributionId, attributionNom, commentaire, user) {
  const nouveauStock = Math.max(0, (produit.stockActuel || 0) - quantite);
  await updateDoc(doc(db, PRODUITS, produit.id), { stockActuel: nouveauStock });
  await addDoc(collection(db, SORTIES), {
    produitId: produit.id, produitNom: produit.nom, categorie: produit.categorie || "", zone: produit.zone || "",
    quantite, unite: produit.unite || "",
    attributionId, attributionNom,
    commentaire: commentaire || "",
    date: Date.now(),
    creePar: user?.nom || user?.email || "Inconnu",
  });
}

// Réapprovisionnement (entrée de stock) — plus simple qu'une sortie, pas
// d'attribution puisque ça alimente le stock commun.
export async function enregistrerEntree(produit, quantite) {
  const nouveauStock = (produit.stockActuel || 0) + quantite;
  await updateDoc(doc(db, PRODUITS, produit.id), { stockActuel: nouveauStock });
}

export function watchSorties(callback) {
  return onSnapshot(collection(db, SORTIES), (snap) => {
    const list = [];
    snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
    callback(list.sort((a, b) => (b.date || 0) - (a.date || 0)));
  }, (err) => { console.error("watchSorties (stock menage):", err); callback([]); });
}

// ---- Paramètres : quels sites sont concernés par chaque zone ----
// Un même document config/stock-menage-zones : { [siteId]: "ecole" | "agropolis" }
// Un site non listé n'est concerné par aucune des deux zones (n'apparaît
// dans aucune liste d'attribution) — indépendant du champ "association"
// du dossier de site, pour rester libre de composer les deux zones
// comme voulu, plutôt que de suivre automatiquement l'association.
export function watchZonesSites(callback) {
  return onSnapshot(PARAMETRES_DOC(), (snap) => {
    callback(snap.exists() ? snap.data() : {});
  }, (err) => { console.error("watchZonesSites:", err); callback({}); });
}

export async function definirZoneSite(siteId, zone) {
  // zone === null retire le site des deux zones (deleteField supprime la
  // clé plutôt que d'y écrire "undefined", ce que Firestore refuse).
  if (zone === null) {
    await setDoc(PARAMETRES_DOC(), { [siteId]: deleteField() }, { merge: true });
  } else {
    await setDoc(PARAMETRES_DOC(), { [siteId]: zone }, { merge: true });
  }
}

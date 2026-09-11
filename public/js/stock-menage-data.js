// stock-menage-data.js
// Stock des produits de ménage (papier toilette, savon, produits
// d'entretien...) — distinct du Stock maintenance (pièces techniques).
// Chaque sortie est attribuée soit à un centre (dossier de site), soit
// au dispositif MNA, pour savoir qui consomme quoi.

import { db } from "./firebase-init.js";
import {
  doc, addDoc, updateDoc, getDoc, getDocs, onSnapshot, deleteDoc, serverTimestamp,
  collection, query, where,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const PRODUITS = "stock-menage-produits";
const SORTIES = "stock-menage-sorties";

// Attribution spéciale, en plus des centres (dossiers de site) —
// le dispositif MNA n'est pas un site géographique classique.
export const MNA_ID = "__dispositif_mna__";
export const MNA_LABEL = "Dispositif MNA";

export const CATEGORIES_MENAGE = [
  "Papier toilette", "Savon / hygiène", "Produits d'entretien", "Sacs poubelle",
  "Essuie-mains / papier", "Désinfectants", "Autre",
];

export function nouveauProduit() {
  return {
    nom: "", categorie: "", unite: "pièce", stockActuel: 0, seuilMin: 0,
    supprimeLe: null,
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
    produitId: produit.id, produitNom: produit.nom, categorie: produit.categorie || "",
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

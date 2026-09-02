// stock-site-data.js
// Stock "déporté" tenu localement sur un site (résidence) — indépendant
// des quantités du stock central. Un article peut soit référencer un
// produit du catalogue central (produitId renseigné), soit être un
// article propre au site, hors catalogue (produitId vide, nom libre).

import { db } from "./firebase-init.js";
import {
  doc, addDoc, updateDoc, deleteDoc, getDocs,
  collection, query, where, onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const COLLECTION = "stock-site-items";

export function watchStockSite(dossierId, callback) {
  const q = query(collection(db, COLLECTION), where("dossierId", "==", dossierId));
  return onSnapshot(q, (snap) => {
    const list = [];
    snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
    callback(list.sort((a, b) => (a.nom || "").localeCompare(b.nom || "")));
  }, (err) => { console.error("watchStockSite:", err); callback([]); });
}

export async function ajouterArticleSite(dossierId, item) {
  await addDoc(collection(db, COLLECTION), { dossierId, ...item });
}

export async function modifierArticleSite(id, fields) {
  await updateDoc(doc(db, COLLECTION, id), fields);
}

export async function supprimerArticleSite(id) {
  await deleteDoc(doc(db, COLLECTION, id));
}

// Liste ponctuelle du catalogue central (pour le sélecteur "Ajouter depuis
// le catalogue") — un seul chargement, pas un flux temps réel.
export async function listerCatalogueCentral() {
  const snap = await getDocs(collection(db, "stock-produits"));
  const list = [];
  snap.forEach((d) => { if (!d.data().supprimeLe) list.push({ id: d.id, ...d.data() }); });
  return list.sort((a, b) => (a.nom || "").localeCompare(b.nom || ""));
}

// fournisseurs-data.js
// Liste des fournisseurs (nom, contact commercial, email) — évite de
// ressaisir ces informations à chaque produit ajouté au stock central.

import { db } from "./firebase-init.js";
import {
  doc, addDoc, updateDoc, deleteDoc, getDocs,
  collection, onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const COLLECTION = "fournisseurs";

export function watchFournisseurs(callback) {
  return onSnapshot(collection(db, COLLECTION), (snap) => {
    const list = [];
    snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
    callback(list.sort((a, b) => (a.nom || "").localeCompare(b.nom || "")));
  }, (err) => { console.error("watchFournisseurs:", err); callback([]); });
}

export async function listerFournisseurs() {
  const snap = await getDocs(collection(db, COLLECTION));
  const list = [];
  snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
  return list.sort((a, b) => (a.nom || "").localeCompare(b.nom || ""));
}

export async function ajouterFournisseur(fournisseur) {
  const ref = await addDoc(collection(db, COLLECTION), fournisseur);
  return ref.id;
}

export async function modifierFournisseur(id, fields) {
  await updateDoc(doc(db, COLLECTION, id), fields);
}

export async function supprimerFournisseur(id) {
  await deleteDoc(doc(db, COLLECTION, id));
}

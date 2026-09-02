// stock-site-data.js
// Stock "déporté" tenu localement sur un site (résidence) — indépendant
// des quantités du stock central. Un article peut soit référencer un
// produit du catalogue central (produitId renseigné), soit être un
// article propre au site, hors catalogue (produitId vide, nom libre).

import { db } from "./firebase-init.js";
import {
  doc, addDoc, updateDoc, deleteDoc, getDoc, getDocs,
  collection, query, where, onSnapshot, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const COLLECTION = "stock-site-items";
const CATALOGUE_SITE = "stock-site-catalogue";

// Catalogue type des sites — indépendant du catalogue central (stock
// central de maintenance). Vide au départ, alimenté au fur et à mesure
// selon ce que les sites doivent réellement garder sur place.
export function watchCatalogueSite(callback) {
  return onSnapshot(collection(db, CATALOGUE_SITE), (snap) => {
    const list = [];
    snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
    callback(list.sort((a, b) => (a.categorie || "").localeCompare(b.categorie || "") || (a.nom || "").localeCompare(b.nom || "")));
  }, (err) => { console.error("watchCatalogueSite:", err); callback([]); });
}

export async function listerCatalogueSite() {
  const snap = await getDocs(collection(db, CATALOGUE_SITE));
  const list = [];
  snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
  return list.sort((a, b) => (a.categorie || "").localeCompare(b.categorie || "") || (a.nom || "").localeCompare(b.nom || ""));
}

export async function ajouterProduitCatalogueSite(item) {
  await addDoc(collection(db, CATALOGUE_SITE), item);
}

export async function modifierProduitCatalogueSite(id, fields) {
  await updateDoc(doc(db, CATALOGUE_SITE, id), fields);
}

export async function supprimerProduitCatalogueSite(id) {
  await deleteDoc(doc(db, CATALOGUE_SITE, id));
}
const MOUVEMENTS = "stock-site-mouvements";

// QR encodant un lien direct vers l'écran d'ajustement/sortie de cet
// article — scanné avec l'appareil photo normal du téléphone (hors appli),
// ça ouvre directement la bonne fiche.
export function qrPayloadForSite(itemId) {
  return `https://service-maintenance-et-menage.web.app/app.html?stocksite=${itemId}`;
}

export async function getArticleSiteAvecResidence(itemId) {
  const snap = await getDoc(doc(db, COLLECTION, itemId));
  if (!snap.exists()) return null;
  const item = { id: snap.id, ...snap.data() };
  const siteSnap = await getDoc(doc(db, "sites-dossiers", item.dossierId));
  item.siteNom = siteSnap.exists() ? siteSnap.data().nom : "Site inconnu";
  return item;
}

// Actualise le stock à une quantité comptée (inventaire), sans notion de
// logement — utilisé pour un recomptage.
export async function actualiserStockSite(itemId, nouvelleQuantite, uid) {
  const ref = doc(db, COLLECTION, itemId);
  const snap = await getDoc(ref);
  const avant = snap.exists() ? (snap.data().quantite ?? 0) : 0;
  await updateDoc(ref, { quantite: nouvelleQuantite });
  await addDoc(collection(db, MOUVEMENTS), {
    itemId, type: "actualisation", quantiteAvant: avant, quantiteApres: nouvelleQuantite,
    uid, date: serverTimestamp(),
  });
}

// Enregistre une sortie de produit (consommation), avec le logement
// concerné — décrémente automatiquement le stock et journalise.
export async function enregistrerSortieSite(itemId, quantiteSortie, logement, uid) {
  const ref = doc(db, COLLECTION, itemId);
  const snap = await getDoc(ref);
  const avant = snap.exists() ? (snap.data().quantite ?? 0) : 0;
  const apres = Math.max(0, avant - quantiteSortie);
  await updateDoc(ref, { quantite: apres });
  await addDoc(collection(db, MOUVEMENTS), {
    itemId, type: "sortie", quantiteAvant: avant, quantiteApres: apres,
    quantiteSortie, logement: logement || "", uid, date: serverTimestamp(),
  });
}

export async function listerMouvementsSite(itemId) {
  const q = query(collection(db, MOUVEMENTS), where("itemId", "==", itemId));
  const snap = await getDocs(q);
  const list = [];
  snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
  return list.sort((a, b) => (b.date?.toMillis?.() || 0) - (a.date?.toMillis?.() || 0));
}

// Liste ponctuelle des dossiers de site ayant le stock déporté activé —
// utilisée par la vue centralisée du module Stock maintenance.
export async function listerSitesAvecStockDeporte() {
  const q = query(collection(db, "sites-dossiers"), where("stockDeporte", "==", true));
  const snap = await getDocs(q);
  const list = [];
  snap.forEach((d) => { if (!d.data().supprimeLe) list.push({ id: d.id, nom: d.data().nom }); });
  return list.sort((a, b) => (a.nom || "").localeCompare(b.nom || ""));
}

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

// Configuration en masse depuis la liste type (catalogue central) : pour
// chaque produit, on décide s'il est "concerné" par ce site et, si oui,
// la quantité à avoir en permanence sur place (quantiteCible). Les
// produits décochés qui avaient déjà un article sur ce site sont retirés ;
// les produits cochés déjà présents ne sont que mis à jour (la quantité
// actuelle comptée n'est jamais écrasée par cette opération).
export async function configurerArticlesSiteDepuisCatalogue(dossierId, existants, decisions, origine = "site") {
  const parProduitId = new Map(existants.filter(e => e.produitId).map(e => [e.produitId, e]));
  const ops = [];
  for (const d of decisions) {
    const existant = parProduitId.get(d.produitId);
    if (d.concerne) {
      if (existant) {
        ops.push(updateDoc(doc(db, COLLECTION, existant.id), {
          nom: d.nom, unite: d.unite, quantiteCible: d.quantiteCible, seuilMin: d.seuilMin,
        }));
      } else {
        ops.push(addDoc(collection(db, COLLECTION), {
          dossierId, produitId: d.produitId, catalogueOrigine: origine, nom: d.nom, unite: d.unite,
          quantite: 0, quantiteCible: d.quantiteCible, seuilMin: d.seuilMin,
        }));
      }
    } else if (existant) {
      ops.push(deleteDoc(doc(db, COLLECTION, existant.id)));
    }
  }
  await Promise.all(ops);
}

// Liste ponctuelle de tous les articles de stock déporté, tous sites
// confondus — utilisée par la vue centralisée du module Stock maintenance.
export async function listerTousLesArticlesSite() {
  const snap = await getDocs(collection(db, COLLECTION));
  const list = [];
  snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
  return list;
}

// Liste ponctuelle du catalogue central (pour le sélecteur "Ajouter depuis
// le catalogue") — un seul chargement, pas un flux temps réel.
export async function listerCatalogueCentral() {
  const snap = await getDocs(collection(db, "stock-produits"));
  const list = [];
  snap.forEach((d) => { if (!d.data().supprimeLe) list.push({ id: d.id, ...d.data() }); });
  return list.sort((a, b) => (a.nom || "").localeCompare(b.nom || ""));
}

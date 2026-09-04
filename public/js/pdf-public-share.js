// pdf-public-share.js
// Copie publique (sans authentification requise) d'un PDF de dossier de
// site, réservée EXCLUSIVEMENT au cas où le partage public par lien
// SharePoint est indisponible (paramètre tenant Microsoft 365 désactivé,
// cas actuel). Le reste de l'application continue d'utiliser SharePoint
// (Article 3.2 de la charte) ; ce contournement ponctuel a été validé
// explicitement par Valentin.
//
// Contrairement à une première version envisagée avec Firebase Storage
// (nécessite le forfait payant Blaze — refusé), le PDF est ici découpé
// en morceaux et stocké directement dans Firestore (déjà utilisé
// intensivement par toute l'application, sans frais). Chaque document
// Firestore est limité à 1 Mo : le PDF est donc fractionné en morceaux
// de 650 Ko (avant encodage base64, qui ajoute environ 33% de volume),
// avec une bonne marge de sécurité sous la limite.
//
// Objectif : un prestataire extérieur SANS compte Microsoft ni accès à
// SharePoint doit pouvoir scanner le QR "fiche PDF" collé sur un site et
// ouvrir directement le PDF (avec photos), sans aucune connexion — voir
// dossier-pdf-guest.html / dossier-pdf-guest.js, qui reconstitue le PDF
// à la volée dans le navigateur à partir de ces morceaux.

import { db } from "./firebase-init.js";
import {
  doc, getDoc, setDoc, deleteDoc,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const COLLECTION = "dossiers-pdf-public";
const CHUNK_SIZE = 650000; // octets bruts par morceau, avant encodage base64

function metaRef(dossierId) { return doc(db, COLLECTION, dossierId); }
function chunkRef(dossierId, index) { return doc(db, COLLECTION, dossierId, "chunks", String(index)); }

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 8192; // évite un dépassement de pile sur de gros tableaux
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Reconstitue le Blob PDF complet à partir de ses morceaux Firestore.
async function reassembleBlob(dossierId, chunkCount) {
  const parts = [];
  for (let i = 0; i < chunkCount; i++) {
    const snap = await getDoc(chunkRef(dossierId, i));
    if (!snap.exists()) throw new Error(`Morceau ${i + 1}/${chunkCount} manquant — le PDF est peut-être en cours de régénération, réessaie dans un instant.`);
    parts.push(base64ToBytes(snap.data().data));
  }
  return new Blob(parts, { type: "application/pdf" });
}

// Vérification légère (sans reconstituer le PDF) : indique juste si une
// publication existe déjà pour ce dossier — utilisée par le bouton QR de
// l'application pour décider s'il faut (re)générer avant de créer le QR.
export async function hasPublicPdf(dossierId) {
  const snap = await getDoc(metaRef(dossierId));
  return snap.exists();
}

// Renvoie {blob, updatedAt} si un PDF a déjà été publié pour ce dossier,
// ou null sinon (première fois).
export async function getExistingPublicPdf(dossierId) {
  const metaSnap = await getDoc(metaRef(dossierId));
  if (!metaSnap.exists()) return null;
  const meta = metaSnap.data();
  const blob = await reassembleBlob(dossierId, meta.chunkCount);
  return { blob, updatedAt: meta.updatedAt };
}

// Découpe et enregistre le PDF dans Firestore (remplace toute publication
// précédente), puis renvoie le Blob d'origine.
export async function publishPublicPdf(dossierId, blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunkCount = Math.ceil(bytes.length / CHUNK_SIZE) || 1;

  // Supprime les morceaux d'une publication précédente en trop (si le
  // nouveau PDF tient sur moins de morceaux que l'ancien) avant d'écrire.
  const oldMetaSnap = await getDoc(metaRef(dossierId));
  const oldCount = oldMetaSnap.exists() ? (oldMetaSnap.data().chunkCount || 0) : 0;
  for (let i = chunkCount; i < oldCount; i++) {
    await deleteDoc(chunkRef(dossierId, i)).catch(() => {});
  }

  for (let i = 0; i < chunkCount; i++) {
    const slice = bytes.subarray(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    await setDoc(chunkRef(dossierId, i), { data: bytesToBase64(slice) });
  }
  await setDoc(metaRef(dossierId), { chunkCount, updatedAt: Date.now(), sizeBytes: bytes.length });

  return blob;
}

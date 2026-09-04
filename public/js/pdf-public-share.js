// pdf-public-share.js
// Copie publique (sans authentification requise) d'un PDF de dossier de
// site, hébergée sur Firebase Storage — réservée EXCLUSIVEMENT au cas où
// le partage public par lien SharePoint est indisponible (paramètre
// tenant Microsoft 365 désactivé, cas actuel). Le reste de l'application
// continue d'utiliser SharePoint (Article 3.2 de la charte) ; ce
// contournement ponctuel a été validé explicitement par Valentin.
//
// Objectif : un prestataire extérieur SANS compte Microsoft ni accès à
// SharePoint doit pouvoir scanner le QR "fiche PDF" collé sur un site et
// ouvrir directement le PDF (avec photos), sans aucune connexion.

import { storage } from "./firebase-init.js";
import {
  ref, uploadBytes, getDownloadURL,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js";

const FOLDER = "dossiers-pdf-public";

function pathFor(dossierId) {
  return `${FOLDER}/${dossierId}.pdf`;
}

// Renvoie l'URL publique déjà existante pour ce dossier, ou null si aucun
// PDF n'a encore été publié (première fois).
export async function getExistingPublicPdfUrl(dossierId) {
  try {
    return await getDownloadURL(ref(storage, pathFor(dossierId)));
  } catch (e) {
    if (e.code === "storage/object-not-found") return null;
    throw e;
  }
}

// Envoie (ou remplace) la copie publique du PDF pour ce dossier, et
// renvoie son URL de téléchargement direct — consultable par n'importe
// qui, sans compte.
export async function publishPublicPdf(dossierId, blob) {
  const storageRef = ref(storage, pathFor(dossierId));
  await uploadBytes(storageRef, blob, { contentType: "application/pdf" });
  return getDownloadURL(storageRef);
}

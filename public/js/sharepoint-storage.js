// sharepoint-storage.js
// Remplace google-drive.js : envoi et lecture de photos/fichiers dans la
// bibliothèque SharePoint partagée "appsmm", via Microsoft Graph API.
// Tout le monde utilise son compte Microsoft @etablieres.fr existant —
// aucun compte Google requis (contrainte : Lionel n'en a pas).

import { getGraphToken } from "./graph-auth.js";

const GRAPH_ROOT = "https://graph.microsoft.com/v1.0";
const SHAREPOINT_HOSTNAME = "etablieresfr.sharepoint.com";
const SITE_PATH = "/sites/appsmm";
const ROOT_FOLDER = "DossiersDeSite";
export const DOSSIERS_ROOT_FOLDER = ROOT_FOLDER;
export const STOCK_ROOT_FOLDER = "StockMaintenance";
export const EXPORTS_ROOT_FOLDER = "ExportsDonnees";

let cachedDriveId = null;

async function resolveDriveId(token) {
  if (cachedDriveId) return cachedDriveId;
  const siteRes = await fetch(`${GRAPH_ROOT}/sites/${SHAREPOINT_HOSTNAME}:${SITE_PATH}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!siteRes.ok) throw new Error(`Site SharePoint "appsmm" introuvable (${siteRes.status})`);
  const site = await siteRes.json();

  const driveRes = await fetch(`${GRAPH_ROOT}/sites/${site.id}/drive`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!driveRes.ok) throw new Error(`Bibliothèque de documents introuvable (${driveRes.status})`);
  const drive = await driveRes.json();
  cachedDriveId = drive.id;
  return cachedDriveId;
}

// Vérifie/crée chaque niveau d'un chemin de dossiers, un par un — Graph ne
// crée pas de façon fiable plusieurs niveaux de dossiers imbriqués en une
// seule fois lors d'un envoi par session, contrairement à un envoi simple.
// Idempotent : ne fait rien si le dossier existe déjà.
export async function ensureFolderPath(driveId, token, folderPath) {
  const segments = folderPath.split("/").filter(Boolean);
  const encodedSoFar = [];
  for (const segment of segments) {
    const parentEncoded = encodedSoFar.join("/");
    encodedSoFar.push(encodeURIComponent(segment));
    const currentEncoded = encodedSoFar.join("/");

    const checkRes = await fetch(
      `${GRAPH_ROOT}/drives/${driveId}/root:/${currentEncoded}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (checkRes.ok) continue; // ce niveau existe déjà, passer au suivant

    const childrenUrl = parentEncoded
      ? `${GRAPH_ROOT}/drives/${driveId}/root:/${parentEncoded}:/children`
      : `${GRAPH_ROOT}/drives/${driveId}/root/children`;
    const createRes = await fetch(childrenUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: segment, folder: {}, "@microsoft.graph.conflictBehavior": "fail" }),
    });
    // 409 = quelqu'un d'autre l'a créé entre-temps (course), ce n'est pas une erreur.
    if (!createRes.ok && createRes.status !== 409) {
      throw new Error(`Impossible de créer le dossier "${segment}" (${createRes.status})`);
    }
  }
}

// Déplace un fichier déjà envoyé vers le bon dossier (opération de
// métadonnées uniquement — pas de retéléchargement). Sert à réparer les
// fichiers mal rangés par un envoi précédent.
export async function moveItemToFolder(itemId, folderPath) {
  const token = await getGraphToken();
  const driveId = await resolveDriveId(token);
  await ensureFolderPath(driveId, token, folderPath);
  const res = await fetch(`${GRAPH_ROOT}/drives/${driveId}/items/${itemId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ parentReference: { path: `/drive/root:/${folderPath}` } }),
  });
  if (!res.ok) throw new Error(`Échec du déplacement (${res.status})`);
  return res.json();
}

// Supprime réellement un fichier sur SharePoint (pas juste sa référence
// dans Firestore) — utilisée quand une photo est retirée d'une fiche.
export async function deleteDriveItem(itemId) {
  const token = await getGraphToken();
  const driveId = await resolveDriveId(token);
  const res = await fetch(`${GRAPH_ROOT}/drives/${driveId}/items/${itemId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 404) throw new Error(`Échec de la suppression (${res.status})`);
}

function sanitizeFilename(name) {
  return name.replace(/[\\/:*?"<>|#%]/g, "_").trim() || "fichier";
}

// Construit un chemin de dossier lisible à partir de segments (ex. nom de
// résidence, nom d'équipement) — chaque segment est nettoyé des caractères
// interdits dans un chemin, tronqué pour rester raisonnable, et un segment
// vide est simplement ignoré.
export function buildFolderPath(rootFolder, segments) {
  const clean = (segments || [])
    .filter(Boolean)
    .map(s => sanitizeFilename(String(s)).slice(0, 80));
  return [rootFolder, ...clean].join("/");
}

// Même rôle que dans google-drive.js : à appeler AVANT d'ouvrir le
// sélecteur de fichier, en réaction directe au clic (sinon le navigateur
// bloque la popup de connexion Microsoft).
export async function getAccessToken() {
  return getGraphToken();
}

// Envoie le fichier sur SharePoint avec un jeton déjà obtenu, rangé dans un
// dossier lisible (folderSegments, ex. [nomResidence, nomEquipement] ou
// [nomProduit]) plutôt que dans un unique dossier plat. Utilise une session
// d'upload par blocs de 5 Mo (fonctionne aussi bien pour une petite photo
// que pour un gros PDF, sans limite de taille pratique).
export async function uploadToDrive(file, token, folderSegments = [], rootFolder = ROOT_FOLDER, options = {}) {
  const { conflictBehavior = "rename", fixedFilename = null } = options;
  const driveId = await resolveDriveId(token);
  const safeName = fixedFilename ? sanitizeFilename(fixedFilename) : sanitizeFilename(file.name);
  const folder = buildFolderPath(rootFolder, folderSegments);
  await ensureFolderPath(driveId, token, folder);
  // Nom horodaté par défaut pour ne jamais écraser une photo précédente ;
  // si un nom fixe est fourni (ex. le PDF récapitulatif du dossier), on
  // s'en tient à ce nom et on remplace l'ancien fichier au même endroit.
  const itemPath = fixedFilename ? `${folder}/${safeName}` : `${folder}/${Date.now()}-${safeName}`;

  // En mode "remplacer" (nom fixe), on supprime d'abord tout fichier déjà
  // présent à cet emplacement avant de créer la session d'envoi — une
  // tentative précédente interrompue peut laisser une session bloquée que
  // Microsoft refuse de remplacer directement (erreur 409).
  if (conflictBehavior === "replace") {
    await fetch(`${GRAPH_ROOT}/drives/${driveId}/root:/${itemPath}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {}); // ignore si le fichier n'existait pas encore
  }

  const sessionRes = await fetch(
    `${GRAPH_ROOT}/drives/${driveId}/root:/${itemPath}:/createUploadSession`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": conflictBehavior === "replace" ? "fail" : conflictBehavior } }),
    }
  );
  if (!sessionRes.ok) throw new Error(`Échec de la création de la session d'envoi (${sessionRes.status})`);
  const session = await sessionRes.json();
  const uploadUrl = session.uploadUrl;

  const chunkSize = 5 * 1024 * 1024;
  const total = file.size;
  let start = 0;
  let item = null;

  while (start < total) {
    const end = Math.min(start + chunkSize, total);
    const chunk = file.slice(start, end);
    const chunkRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Length": String(end - start),
        "Content-Range": `bytes ${start}-${end - 1}/${total}`,
      },
      body: chunk,
    });
    if (!chunkRes.ok && chunkRes.status !== 202) {
      throw new Error(`Échec de l'envoi du fichier (${chunkRes.status})`);
    }
    if (chunkRes.status !== 202) item = await chunkRes.json();
    start = end;
  }

  const isImage = file.type.startsWith("image/");
  return {
    // Pour les documents (non-image), on ouvre directement la page
    // SharePoint du fichier dans un nouvel onglet — ce lien ne périme pas
    // et fonctionne avec la session Microsoft déjà ouverte du navigateur.
    url: item.webUrl,
    itemId: item.id,
    isImage,
    name: file.name,
  };
}

// Les images ne peuvent pas utiliser un lien fixe comme les documents (une
// balise <img> a besoin de l'URL directe des octets, qui expire côté
// Microsoft) : on redemande une URL fraîche à chaque affichage.
export async function getImageDisplayUrl(itemId) {
  const token = await getGraphToken();
  const driveId = await resolveDriveId(token);
  const res = await fetch(
    `${GRAPH_ROOT}/drives/${driveId}/items/${itemId}?select=id,@microsoft.graph.downloadUrl`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`Photo introuvable (${res.status})`);
  const item = await res.json();
  return item["@microsoft.graph.downloadUrl"];
}

// Vérifie si un fichier à nom fixe (ex. le PDF récapitulatif d'un dossier,
// enregistré via conflictBehavior "replace") existe déjà sur SharePoint à
// l'emplacement attendu, et renvoie directement son lien de consultation
// (webUrl) si oui — sans le télécharger ni le régénérer. Si le nom exact
// n'est pas trouvé (ex. un ancien fichier enregistré avant l'adoption du
// nom fixe, encore horodaté à l'ancienne — voir uploadToDrive), on
// retombe sur une recherche tolérante dans le même dossier : n'importe
// quel fichier dont le nom se termine par le même suffixe est accepté, en
// gardant le plus récemment modifié. Renvoie null si vraiment rien n'existe.
export async function getExistingFileUrl(folderSegments, fixedFilename, rootFolder = ROOT_FOLDER) {
  const token = await getAccessToken();
  const driveId = await resolveDriveId(token);
  const folder = buildFolderPath(rootFolder, folderSegments);
  const safeName = sanitizeFilename(fixedFilename);

  const res = await fetch(
    `${GRAPH_ROOT}/drives/${driveId}/root:/${folder}/${safeName}?select=id,webUrl,lastModifiedDateTime`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (res.ok) {
    const item = await res.json();
    return { url: item.webUrl, lastModified: item.lastModifiedDateTime };
  }
  if (res.status !== 404) throw new Error(`Vérification SharePoint impossible (${res.status})`);

  // Repli tolérant : le dossier existe peut-être avec un fichier au nom
  // légèrement différent (ancien horodatage, casse différente...).
  const listRes = await fetch(
    `${GRAPH_ROOT}/drives/${driveId}/root:/${folder}:/children?select=name,webUrl,lastModifiedDateTime&$top=200`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (listRes.status === 404) return null; // le dossier lui-même n'existe pas encore
  if (!listRes.ok) throw new Error(`Vérification SharePoint impossible (${listRes.status})`);
  const list = await listRes.json();
  const suffix = safeName.toLowerCase();
  const matches = (list.value || []).filter(it => (it.name || "").toLowerCase().endsWith(suffix));
  if (matches.length === 0) return null;
  matches.sort((a, b) => new Date(b.lastModifiedDateTime) - new Date(a.lastModifiedDateTime));
  return { url: matches[0].webUrl, lastModified: matches[0].lastModifiedDateTime };
}

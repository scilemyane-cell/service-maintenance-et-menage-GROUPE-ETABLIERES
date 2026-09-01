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

function sanitizeFilename(name) {
  return name.replace(/[\\/:*?"<>|#%]/g, "_").trim() || "fichier";
}

// Même rôle que dans google-drive.js : à appeler AVANT d'ouvrir le
// sélecteur de fichier, en réaction directe au clic (sinon le navigateur
// bloque la popup de connexion Microsoft).
export async function getAccessToken() {
  return getGraphToken();
}

// Envoie le fichier sur SharePoint avec un jeton déjà obtenu. Utilise une
// session d'upload par blocs de 5 Mo (fonctionne aussi bien pour une petite
// photo que pour un gros PDF, sans limite de taille pratique).
export async function uploadToDrive(file, token) {
  const driveId = await resolveDriveId(token);
  const safeName = sanitizeFilename(file.name);
  const itemPath = `${ROOT_FOLDER}/${Date.now()}-${safeName}`;

  const sessionRes = await fetch(
    `${GRAPH_ROOT}/drives/${driveId}/root:/${itemPath}:/createUploadSession`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "rename" } }),
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

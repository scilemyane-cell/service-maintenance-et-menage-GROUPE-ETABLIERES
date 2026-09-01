// google-drive-readonly.js
// Authentification Google minimale, utilisée UNIQUEMENT par l'outil de
// migration (public/js/migration-tool.js) pour retélécharger les anciennes
// photos envoyées via l'ancien système Google Drive, avant de les renvoyer
// vers SharePoint. Reprend le même Client ID OAuth que l'ancien
// google-drive.js (portée drive.file : accès uniquement aux fichiers créés
// par cette appli, jamais au reste du Drive).
//
// Ce fichier n'a pas vocation à rester après la migration — il peut être
// supprimé une fois toutes les anciennes photos rapatriées.

export const GOOGLE_CLIENT_ID = "769766682655-33d68qv6151nmhsergqq750dovsf41r9.apps.googleusercontent.com";
const SCOPE = "https://www.googleapis.com/auth/drive.file";

let gisLoaded = null;
let tokenClient = null;
let cachedToken = null;
let cachedTokenExpiry = 0;

function loadGis() {
  if (gisLoaded) return gisLoaded;
  gisLoaded = new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve();
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.onload = resolve;
    script.onerror = () => reject(new Error("Impossible de charger Google Identity Services"));
    document.head.appendChild(script);
  });
  return gisLoaded;
}

// Doit être appelé en réaction directe à un clic (sinon le navigateur
// bloque la popup de connexion Google).
export async function getGoogleAccessToken() {
  if (cachedToken && Date.now() < cachedTokenExpiry) return cachedToken;
  await loadGis();
  return new Promise((resolve, reject) => {
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SCOPE,
      callback: (resp) => {
        if (resp.error) { reject(new Error(resp.error)); return; }
        cachedToken = resp.access_token;
        cachedTokenExpiry = Date.now() + (resp.expires_in - 60) * 1000;
        resolve(cachedToken);
      },
      error_callback: (err) => reject(new Error(err.type || "Connexion Google annulée")),
    });
    tokenClient.requestAccessToken({ prompt: cachedToken ? "" : "consent" });
  });
}

// Télécharge les octets d'un fichier Drive déjà connu (fileId = l'ancien
// champ "driveId" stocké sur chaque photo), et le retourne sous forme
// d'objet File, prêt à être ré-uploadé vers SharePoint.
export async function downloadDriveFile(fileId, token, filename) {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) {
    throw new Error(`Téléchargement Google Drive échoué (${res.status})`);
  }
  const blob = await res.blob();
  return new File([blob], filename || `photo-${fileId}`, { type: blob.type || "application/octet-stream" });
}

// ============================================================
// Upload de photos vers Google Drive, entièrement côté navigateur.
// Utilise Google Identity Services (OAuth) — la personne qui envoie une
// photo se connecte une fois avec SON compte Google, l'appli reçoit un
// jeton temporaire et l'utilise pour envoyer le fichier directement sur
// Drive, sans jamais passer par un serveur intermédiaire.
//
// Portée volontairement restreinte à "drive.file" : l'appli ne peut voir
// QUE les fichiers qu'elle a elle-même créés, jamais le reste du Drive.
// ============================================================

// À REMPLIR : ID client OAuth créé dans Google Cloud Console
// (APIs & Services > Identifiants > Créer des identifiants > ID client OAuth).
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

async function getAccessToken() {
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

// Envoie le fichier sur Drive, le rend consultable via lien, puis renvoie
// une URL directement affichable dans une balise <img>.
export async function uploadToDrive(file) {
  const token = await getAccessToken();

  const metadata = { name: `${Date.now()}-${file.name}`, mimeType: file.type };
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  form.append("file", file);

  const uploadRes = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!uploadRes.ok) throw new Error("Échec de l'envoi vers Drive (" + uploadRes.status + ")");
  const { id } = await uploadRes.json();

  // Rend le fichier consultable par lien (lecture seule, sans compte requis)
  await fetch(`https://www.googleapis.com/drive/v3/files/${id}/permissions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ role: "reader", type: "anyone" }),
  });

  return { url: `https://drive.google.com/uc?export=view&id=${id}`, driveId: id };
}

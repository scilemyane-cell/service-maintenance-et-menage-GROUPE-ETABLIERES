// graph-auth.js
// Authentification Microsoft (Entra ID) via MSAL, pour l'accès à Microsoft
// Graph API (SharePoint) depuis le navigateur.
//
// Nécessite la librairie MSAL chargée en script classique dans app.html
// (voir la balise <script src="https://alcdn.msauth.net/..."> ajoutée
// dans le <head>) — elle expose un objet global `msal`.

const MSAL_CONFIG = {
  auth: {
    clientId: "b497e502-821e-4771-bcf6-d0d887e82a5a",
    authority: "https://login.microsoftonline.com/e945af82-e70b-4c36-b2cc-bd3eefac161d",
    redirectUri: window.location.origin,
  },
  cache: {
    cacheLocation: "localStorage",
    storeAuthStateInCookie: false,
  },
};

const GRAPH_SCOPES = ["Sites.Selected", "User.Read"];

let msalInstance = null;
let initPromise = null;

function getMsalInstance() {
  if (!window.msal) {
    throw new Error("MSAL n'est pas chargé (vérifier le script msal-browser dans app.html)");
  }
  if (!msalInstance) {
    msalInstance = new window.msal.PublicClientApplication(MSAL_CONFIG);
  }
  return msalInstance;
}

async function ensureInitialized() {
  if (!initPromise) {
    const instance = getMsalInstance();
    initPromise = instance.initialize().then(() => instance.handleRedirectPromise());
  }
  await initPromise;
  return msalInstance;
}

function getActiveAccount(instance) {
  const active = instance.getActiveAccount();
  if (active) return active;
  const accounts = instance.getAllAccounts();
  if (accounts.length > 0) { instance.setActiveAccount(accounts[0]); return accounts[0]; }
  return null;
}

export async function getGraphToken() {
  const instance = await ensureInitialized();
  let account = getActiveAccount(instance);
  if (!account) {
    // Doit être appelé en réaction directe à un clic utilisateur, sinon
    // le navigateur bloque la popup de connexion Microsoft.
    const result = await instance.loginPopup({ scopes: GRAPH_SCOPES });
    instance.setActiveAccount(result.account);
    account = result.account;
  }
  try {
    const result = await instance.acquireTokenSilent({ scopes: GRAPH_SCOPES, account });
    return result.accessToken;
  } catch (silentError) {
    const result = await instance.acquireTokenPopup({ scopes: GRAPH_SCOPES, account });
    return result.accessToken;
  }
}

// Ne demande jamais de popup — utilisée pour les tâches automatiques en
// arrière-plan (ex. export quotidien) qui ne doivent jamais interrompre la
// personne avec une fenêtre de connexion inattendue. Retourne null si
// aucune session Microsoft n'est déjà active dans ce navigateur.
export async function getGraphTokenSilentOnly() {
  try {
    const instance = await ensureInitialized();
    const account = getActiveAccount(instance);
    if (!account) return null;
    const result = await instance.acquireTokenSilent({ scopes: GRAPH_SCOPES, account });
    return result.accessToken;
  } catch (e) {
    return null;
  }
}

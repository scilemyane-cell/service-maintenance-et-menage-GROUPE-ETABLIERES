import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js";
import { firebaseConfig } from "./firebase-config.js";

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
// Utilisé UNIQUEMENT pour héberger une copie publique (sans authentification
// requise) du PDF d'un dossier de site, destinée aux prestataires externes
// sans compte Microsoft — voir pdf-public-share.js. Le reste de l'appli
// continue d'utiliser SharePoint (charte Article 3.2) ; ce contournement
// ponctuel a été validé explicitement par Valentin faute d'alternative
// SharePoint (partage public par lien désactivé sur le tenant).
export const storage = getStorage(app);

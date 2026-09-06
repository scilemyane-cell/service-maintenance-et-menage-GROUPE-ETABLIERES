import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentSingleTabManager,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Persistance locale (IndexedDB) : les lectures restent consultables et
// les écritures sont mises en file d'attente automatiquement en cas de
// coupure réseau (ex. local technique/sous-sol sans réseau), puis
// synchronisées dès que la connexion revient — sans que l'utilisateur
// n'ait rien à faire de particulier. "Single tab" : un seul onglet à la
// fois profite du cache local (suffisant pour cet usage, un utilisateur
// n'ouvrant normalement pas l'appli dans plusieurs onglets à la fois) ;
// un onglet supplémentaire retombe simplement sans persistance plutôt
// que d'échouer.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentSingleTabManager({}) }),
});

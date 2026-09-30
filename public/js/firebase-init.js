import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
} from "./firestore-compte.js";
import { firebaseConfig } from "./firebase-config.js";

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Persistance locale (IndexedDB) : les lectures restent consultables et
// les écritures sont mises en file d'attente automatiquement en cas de
// coupure réseau (ex. local technique/sous-sol sans réseau), puis
// synchronisées dès que la connexion revient — sans que l'utilisateur
// n'ait rien à faire de particulier.
// "Multi-onglets" (QUOTA) : chaque scan de QR code de compteur ouvre un
// NOUVEL onglet ; en mode « un seul onglet », chaque onglet en plus
// n'avait pas de cache et relisait tout au serveur. En multi-onglets, tous
// les onglets partagent le même cache et les mêmes écoutes : un onglet
// supplémentaire ne relit presque rien.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

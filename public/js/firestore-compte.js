// firestore-compte.js
// Passe-plat vers le SDK Firestore qui COMPTE (estimation) les lectures
// facturées : quota gratuit de 50 000 lectures / jour. Tous les modules
// importent Firestore depuis ce fichier ; seules onSnapshot / getDocs /
// getDoc sont enrobées, le reste est ré-exporté tel quel.
import * as F from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
// Liste explicite (esbuild ne sait pas résoudre « export * » d'un module externe).
// Ajouter ici toute nouvelle fonction Firestore utilisée dans l'appli.
export {
  Timestamp, addDoc, collection, deleteDoc, deleteField, doc, increment, initializeFirestore, limit, orderBy, persistentLocalCache, persistentMultipleTabManager, persistentSingleTabManager, query, runTransaction, serverTimestamp, setDoc, updateDoc, where, writeBatch,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const C = (globalThis.__smmLectures = globalThis.__smmLectures || { n: 0, envoye: 0 });
const compter = (k) => { if (k > 0) C.n += k; };

export async function getDocs(q) {
  const s = await F.getDocs(q);
  if (!s.metadata?.fromCache) compter(Math.max(1, s.size));
  return s;
}
export async function getDoc(r) {
  const s = await F.getDoc(r);
  if (!s.metadata?.fromCache) compter(1);
  return s;
}
export function onSnapshot(ref, ...rest) {
  let premierServeur = true;
  const enrober = (fn) => function (snap) {
    try {
      if (snap && snap.metadata && !snap.metadata.fromCache) {
        if (typeof snap.docChanges === "function") {
          // 1re réponse du serveur : toute la requête est facturée (≥ 1 lecture) ; ensuite seulement les changements.
          compter(premierServeur ? Math.max(1, snap.size) : snap.docChanges().length);
        } else if (!snap.metadata.hasPendingWrites) compter(1);
        premierServeur = false;
      }
    } catch { /* le comptage ne doit jamais gêner */ }
    return fn.apply(this, arguments);
  };
  const i = rest.findIndex(a => typeof a === "function");
  if (i >= 0) rest[i] = enrober(rest[i]);
  else if (rest[0] && typeof rest[0].next === "function") rest[0] = { ...rest[0], next: enrober(rest[0].next) };
  return F.onSnapshot(ref, ...rest);
}

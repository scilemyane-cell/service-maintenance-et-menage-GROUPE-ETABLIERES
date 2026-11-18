// firestore-compte.js
// Passe-plat vers le SDK Firestore qui COMPTE (estimation) les lectures
// facturées : quota gratuit de 50 000 lectures / jour. Tous les modules
// importent Firestore depuis ce fichier ; onSnapshot / getDocs / getDoc
// sont enrobées pour les lectures, setDoc / updateDoc / addDoc / deleteDoc /
// writeBatch / runTransaction pour les écritures (quota 20 000 / jour).
import * as F from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
// Liste explicite (esbuild ne sait pas résoudre « export * » d'un module externe).
// Ajouter ici toute nouvelle fonction Firestore utilisée dans l'appli.
export {
  Timestamp, collection, deleteField, doc, documentId, increment, initializeFirestore, limit, orderBy, persistentLocalCache, persistentMultipleTabManager, persistentSingleTabManager, query, serverTimestamp, where,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const C = (globalThis.__smmLectures = globalThis.__smmLectures || { n: 0, envoye: 0 });
C.e = C.e || 0; C.eEnvoye = C.eEnvoye || 0; C.pos = C.pos || 0; C.posEnvoye = C.posEnvoye || 0;
const compter = (k) => { if (k > 0) C.n += k; };
// Écritures (quota gratuit : 20 000 / jour). Les positions GPS sont comptées à part.
const ecrit = (k = 1, ref) => { C.e += k; try { if (ref?.path?.startsWith("positions/")) C.pos += k; } catch { /* */ } };

export async function setDoc(r, ...a) { const x = await F.setDoc(r, ...a); ecrit(1, r); return x; }
export async function updateDoc(r, ...a) { const x = await F.updateDoc(r, ...a); ecrit(1, r); return x; }
export async function addDoc(c, ...a) { const x = await F.addDoc(c, ...a); ecrit(1); return x; }
export async function deleteDoc(r) { const x = await F.deleteDoc(r); ecrit(1, r); return x; }
export function writeBatch(db) {
  const b = F.writeBatch(db); let k = 0;
  const w = {
    set(...a) { k++; b.set(...a); return w; },
    update(...a) { k++; b.update(...a); return w; },
    delete(...a) { k++; b.delete(...a); return w; },
    async commit() { const x = await b.commit(); ecrit(k); return x; },
  };
  return w;
}
export async function runTransaction(db, fn, ...a) {
  let k = 0;
  const x = await F.runTransaction(db, (tx) => {
    k = 0;
    const t = {
      get: (...g) => tx.get(...g).then(s => { compter(1); return s; }),
      set(...z) { k++; tx.set(...z); return t; },
      update(...z) { k++; tx.update(...z); return t; },
      delete(...z) { k++; tx.delete(...z); return t; },
    };
    return fn(t);
  }, ...a);
  ecrit(k); return x;
}

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

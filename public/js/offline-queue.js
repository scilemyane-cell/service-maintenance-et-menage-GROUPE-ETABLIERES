// offline-queue.js
// File d'attente locale (IndexedDB) pour un relevé de compteur complet
// (valeurs + photos) qui n'a pas pu être envoyé faute de réseau (ex.
// local technique/sous-sol sans réseau). Contrairement aux données
// Firestore (qui ont leur propre persistance/synchronisation intégrée,
// voir firebase-init.js), l'envoi des photos vers Microsoft Graph est un
// simple appel réseau sans file d'attente native — il faut la construire
// nous-mêmes, et il est plus simple/robuste de rejouer tout le relevé
// (photos + écriture Firestore) en une fois plutôt que de patcher des
// morceaux séparément.
//
// Principe : la photo est capturée localement sans jamais tenter de
// l'envoyer avant que l'utilisateur ne clique sur "Enregistrer" (voir
// compteurs.js) — donc la prise de vue elle-même fonctionne toujours,
// même sans réseau. Seul l'enregistrement final peut échouer faute de
// réseau ; dans ce cas, tout le relevé (compteur, valeurs, fichiers
// photo, utilisateur, date) est stocké ici, et une synchronisation
// automatique le rejoue dès que la connexion revient.

const DB_NAME = "etablieres-offline-queue";
const STORE = "releves-en-attente";
const listeners = new Set(); // notifiés à chaque changement de la file

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    const result = fn(store);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
  });
}

function notifier() {
  listeners.forEach(cb => { try { cb(); } catch (e) { /* ignore */ } });
}

export function onQueueChange(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

// entry = { compteur, valeurs, photosFiles: { [cle]: File }, user,
//           dateAntidatee, siteNom }
export async function enqueuePendingReleve(entry) {
  const record = { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, ...entry, createdAt: Date.now() };
  await withStore("readwrite", (store) => store.put(record));
  notifier();
  return record.id;
}

export async function listPendingReleves() {
  return withStore("readonly", (store) => new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  }));
}

export async function countPendingReleves() {
  return withStore("readonly", (store) => new Promise((resolve, reject) => {
    const req = store.count();
    req.onsuccess = () => resolve(req.result || 0);
    req.onerror = () => reject(req.error);
  }));
}

export async function removePendingReleve(id) {
  await withStore("readwrite", (store) => store.delete(id));
  notifier();
}

// Distingue une vraie coupure réseau (à mettre en file d'attente, et à
// réessayer automatiquement) d'une autre erreur (droits, quota, fichier
// invalide...) qu'il ne sert à rien de réessayer tel quel.
export function estErreurReseau(e) {
  if (!navigator.onLine) return true;
  const msg = (e?.message || String(e)).toLowerCase();
  return msg.includes("failed to fetch") || msg.includes("networkerror") || msg.includes("network error") || e?.name === "TypeError";
}

let flushEnCours = false;

// Tente de rejouer tous les relevés en attente, un par un, en s'arrêtant
// au premier échec réseau (pas la peine d'insister si le réseau manque
// toujours). `traiterUnReleve(entry)` doit reproduire tout le travail
// normal (upload des photos + enregistrement Firestore) et lever une
// erreur en cas d'échec.
export async function flushPendingReleves(traiterUnReleve) {
  if (flushEnCours || !navigator.onLine) return;
  flushEnCours = true;
  try {
    const items = await listPendingReleves();
    for (const item of items) {
      try {
        await traiterUnReleve(item);
        await removePendingReleve(item.id);
      } catch (e) {
        if (!estErreurReseau(e)) {
          console.error("Échec définitif d'un relevé en attente (laissé dans la file) :", e);
        }
        break; // réseau toujours indisponible (ou premier échec) : on retentera plus tard
      }
    }
  } finally {
    flushEnCours = false;
    notifier();
  }
}

// À appeler une fois au montage du module compteurs pour déclencher la
// synchronisation automatiquement dès que la connexion revient.
export function demarrerSyncAuto(traiterUnReleve) {
  const tenter = () => flushPendingReleves(traiterUnReleve);
  window.addEventListener("online", tenter);
  // Filet de sécurité : la connexion peut revenir sans que l'évènement
  // "online" se déclenche de façon fiable sur tous les appareils/réseaux.
  const intervalId = setInterval(tenter, 60000);
  tenter();
  return () => { window.removeEventListener("online", tenter); clearInterval(intervalId); };
}

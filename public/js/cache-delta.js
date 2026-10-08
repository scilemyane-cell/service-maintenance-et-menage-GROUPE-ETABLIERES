// cache-delta.js
// Économie du quota Firestore (50 000 lectures / jour, gratuit) :
// une collection est gardée sur l'appareil (IndexedDB). À l'ouverture de
// l'appli on repart de cette copie et on ne demande au serveur QUE les
// documents modifiés depuis la dernière visite (champs date passés en
// paramètre, remplis avec serverTimestamp à chaque écriture).
// Une relecture complète est faite une fois par semaine (ou sans copie)
// pour rattraper d'éventuelles suppressions.
import { db } from "./firebase-init.js";
import { collection, query, where, onSnapshot, getDocs, getDoc, Timestamp } from "./firestore-compte.js";

const DB_NOM = "smm-cache", STORE = "kv", RELECTURE_COMPLETE = 7 * 86400000, MARGE = 15 * 60000;

function ouvrirIDB() {
  return new Promise((ok, ko) => {
    try {
      const r = indexedDB.open(DB_NOM, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => ok(r.result);
      r.onerror = () => ko(r.error);
    } catch (e) { ko(e); }
  });
}
async function idbLire(cle) {
  try { const d = await ouvrirIDB(); return await new Promise((ok) => { const t = d.transaction(STORE).objectStore(STORE).get(cle); t.onsuccess = () => ok(t.result || null); t.onerror = () => ok(null); }); }
  catch { return null; }
}
async function idbEcrire(cle, val) {
  try { const d = await ouvrirIDB(); await new Promise((ok) => { const t = d.transaction(STORE, "readwrite"); t.objectStore(STORE).put(val, cle); t.oncomplete = ok; t.onerror = ok; }); }
  catch { /* stockage indisponible : on se passe de cache */ }
}

// Timestamp Firestore <-> objet simple (IndexedDB ne garde pas les classes).
const versCache = (v) => {
  if (v && typeof v === "object") {
    if (typeof v.toMillis === "function" && "seconds" in v) return { __ts: [v.seconds, v.nanoseconds || 0] };
    if (Array.isArray(v)) return v.map(versCache);
    const o = {}; for (const k in v) o[k] = versCache(v[k]); return o;
  }
  return v;
};
const depuisCache = (v) => {
  if (v && typeof v === "object") {
    if (Array.isArray(v.__ts)) return new Timestamp(v.__ts[0], v.__ts[1]);
    if (Array.isArray(v)) return v.map(depuisCache);
    const o = {}; for (const k in v) o[k] = depuisCache(v[k]); return o;
  }
  return v;
};
const lireChamp = (x, champ) => champ.split(".").reduce((o, k) => (o == null ? o : o[k]), x);
const ms = (t) => (typeof t === "number" ? t : t && typeof t.toMillis === "function" ? t.toMillis() : (t && t.seconds ? t.seconds * 1000 : 0));

// Registre des copies locales ouvertes : permet d'appliquer tout de suite
// une modification faite sur CET appareil (même hors ligne), sans attendre
// que le serveur ait posé l'horodatage (serverTimestamp) qui la fait
// entrer dans l'écoute « modifiés depuis ».
const REGISTRE = new Map();
// Copie locale actuelle d'un document (null si inconnue).
export function docLocal(cle, id) { return REGISTRE.get(cle)?.docs.get(id) || null; }
// Retire un document de la copie locale (après une suppression sur CET appareil).
export function retirerLocal(cle, id) {
  const r = REGISTRE.get(cle);
  if (!r || !id || !r.docs.delete(id)) return;
  r.emettreListe(); r.sauver();
}
export function majLocale(cle, id, champs, { remplacer = false } = {}) {
  const r = REGISTRE.get(cle);
  if (!r || !id) return;
  const avant = r.docs.get(id) || {};
  r.docs.set(id, remplacer ? { ...champs } : { ...avant, ...champs });
  r.emettreListe(); r.sauver();
}

// Renvoie une fonction demarrer(emettre) utilisable avec ecoutePartagee.
// numerique : les champs date sont des nombres (ms) et non des Timestamp.
export function ecouteDelta({ cle, col, champs, numerique = false }) {
  return async (emettre) => {
    const docs = new Map();
    let depuis = 0, completLe = 0, timerSave = null;
    const liste = () => [...docs.entries()].map(([id, d]) => ({ id, ...d }));
    const noterDate = (d) => champs.forEach(c => { const t = ms(lireChamp(d, c)); if (t > depuis) depuis = t; });
    const sauver = () => { clearTimeout(timerSave); timerSave = setTimeout(() => {
      const o = {}; docs.forEach((d, id) => { o[id] = versCache(d); });
      idbEcrire(`delta:${cle}`, { docs: o, depuis, completLe });
    }, 1500); };
    let pret = false;
    REGISTRE.set(cle, { docs, sauver, emettreListe: () => { if (pret) emettre(liste()); } });

    const cache = await idbLire(`delta:${cle}`);
    if (cache && cache.docs && Date.now() - (cache.completLe || 0) < RELECTURE_COMPLETE) {
      Object.entries(cache.docs).forEach(([id, d]) => docs.set(id, depuisCache(d)));
      depuis = cache.depuis || 0; completLe = cache.completLe || 0;
      pret = true; emettre(liste());
    } else {
      try {
        const snap = await getDocs(collection(db, col));
        snap.forEach(d => { const x = d.data(); docs.set(d.id, x); noterDate(x); });
        completLe = Date.now();
        sauver();
      } catch (e) { console.error(`cache-delta ${cle} (lecture complète) :`, e); }
      pret = true; emettre(liste());
    }

    // Écoute des seuls documents modifiés depuis la dernière visite.
    const seuil = numerique ? Math.max(0, depuis - MARGE) : Timestamp.fromMillis(Math.max(0, depuis - MARGE));
    champs.forEach(champ => {
      onSnapshot(query(collection(db, col), where(champ, ">", seuil)), (snap) => {
        let change = false;
        snap.docChanges().forEach(ch => {
          const x = ch.doc.data({ serverTimestamps: "estimate" });
          // « removed » : soit supprimé, soit écriture locale en attente
          // (l'horodatage serveur n'est pas encore connu) → on garde.
          // Un document ne « sort » d'une écoute « modifié depuis » que s'il est
          // supprimé… ou pendant une écriture locale (horodatage serveur pas
          // encore connu — et ch.doc.metadata ne le signale pas toujours) : on
          // vérifie qu'il n'existe vraiment plus avant de le retirer, sinon le
          // compteur modifié/relevé disparaissait jusqu'au redémarrage.
          if (ch.type === "removed") {
            if (ch.doc.metadata.hasPendingWrites || snap.metadata.hasPendingWrites) return;
            const id = ch.doc.id;
            getDoc(ch.doc.ref).then(d => { if (!d.exists() && docs.delete(id)) { emettre(liste()); sauver(); } }).catch(() => {});
            return;
          }
          docs.set(ch.doc.id, x); change = true;
          if (!ch.doc.metadata.hasPendingWrites) noterDate(ch.doc.data());
        });
        if (change) { emettre(liste()); sauver(); }
      }, (err) => console.error(`cache-delta ${cle} (${champ}) :`, err));
    });
  };
}

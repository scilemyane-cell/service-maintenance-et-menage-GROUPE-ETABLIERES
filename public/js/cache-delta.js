// cache-delta.js
// Économie du quota Firestore (50 000 lectures / jour, gratuit) :
// une collection est gardée sur l'appareil (IndexedDB). À l'ouverture de
// l'appli on repart de cette copie et on ne demande au serveur QUE les
// documents modifiés depuis la dernière visite (champs date passés en
// paramètre, remplis avec serverTimestamp à chaque écriture).
// Une relecture complète est faite une fois par semaine (ou sans copie)
// pour rattraper d'éventuelles suppressions.
import { db } from "./firebase-init.js";
import { collection, query, where, onSnapshot, getDocs, Timestamp } from "./firestore-compte.js";

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
const ms = (t) => (t && typeof t.toMillis === "function" ? t.toMillis() : (t && t.seconds ? t.seconds * 1000 : 0));

// Renvoie une fonction demarrer(emettre) utilisable avec ecoutePartagee.
export function ecouteDelta({ cle, col, champs }) {
  return async (emettre) => {
    const docs = new Map();
    let depuis = 0, completLe = 0, timerSave = null;
    const liste = () => [...docs.entries()].map(([id, d]) => ({ id, ...d }));
    const noterDate = (d) => champs.forEach(c => { const t = ms(lireChamp(d, c)); if (t > depuis) depuis = t; });
    const sauver = () => { clearTimeout(timerSave); timerSave = setTimeout(() => {
      const o = {}; docs.forEach((d, id) => { o[id] = versCache(d); });
      idbEcrire(`delta:${cle}`, { docs: o, depuis, completLe });
    }, 1500); };

    const cache = await idbLire(`delta:${cle}`);
    if (cache && cache.docs && Date.now() - (cache.completLe || 0) < RELECTURE_COMPLETE) {
      Object.entries(cache.docs).forEach(([id, d]) => docs.set(id, depuisCache(d)));
      depuis = cache.depuis || 0; completLe = cache.completLe || 0;
      emettre(liste());
    } else {
      try {
        const snap = await getDocs(collection(db, col));
        snap.forEach(d => { const x = d.data(); docs.set(d.id, x); noterDate(x); });
        completLe = Date.now();
        sauver();
      } catch (e) { console.error(`cache-delta ${cle} (lecture complète) :`, e); }
      emettre(liste());
    }

    // Écoute des seuls documents modifiés depuis la dernière visite.
    const seuil = Timestamp.fromMillis(Math.max(0, depuis - MARGE));
    champs.forEach(champ => {
      onSnapshot(query(collection(db, col), where(champ, ">", seuil)), (snap) => {
        let change = false;
        snap.docChanges().forEach(ch => {
          const x = ch.doc.data({ serverTimestamps: "estimate" });
          // « removed » : soit supprimé, soit écriture locale en attente
          // (l'horodatage serveur n'est pas encore connu) → on garde.
          if (ch.type === "removed" && !ch.doc.metadata.hasPendingWrites) { if (docs.delete(ch.doc.id)) change = true; return; }
          docs.set(ch.doc.id, x); change = true;
          if (!ch.doc.metadata.hasPendingWrites) noterDate(ch.doc.data());
        });
        if (change) { emettre(liste()); sauver(); }
      }, (err) => console.error(`cache-delta ${cle} (${champ}) :`, err));
    });
  };
}

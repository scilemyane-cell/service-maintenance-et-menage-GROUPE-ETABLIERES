import { db } from "./firebase-init.js";
import { doc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { SITES as DEFAULT_SITES } from "./sites-config.js";

const REF = () => doc(db, "config", "menage-sites");
let syncing = false;

export function watchSites(callback) {
  return onSnapshot(REF(), (snap) => {
    if (snap.exists() && snap.data().sites) {
      const existing = snap.data().sites;
      callback(existing);
      // Fusion silencieuse : tout nouveau site ajouté dans le code (par id)
      // et absent de la base est ajouté automatiquement, sans jamais toucher
      // aux sites déjà présents (même modifiés depuis l'interface).
      const missing = DEFAULT_SITES.filter(d => !existing.some(e => e.id === d.id));
      if (missing.length > 0 && !syncing) {
        syncing = true;
        setDoc(REF(), { sites: [...existing, ...missing] }).finally(() => { syncing = false; });
      }
    } else {
      callback(DEFAULT_SITES);
      if (!syncing) { syncing = true; setDoc(REF(), { sites: DEFAULT_SITES }).finally(() => { syncing = false; }); }
    }
  }, (err) => { console.error("watchSites:", err); callback(DEFAULT_SITES); });
}

export async function saveSites(sites) {
  await setDoc(REF(), { sites });
}

export function findSiteIn(sites, id) {
  return sites.find(s => s.id === id) || sites[0];
}

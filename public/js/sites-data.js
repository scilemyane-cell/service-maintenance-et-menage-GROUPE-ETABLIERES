import { db } from "./firebase-init.js";
import { doc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { SITES as DEFAULT_SITES } from "./sites-config.js";

const REF = () => doc(db, "config", "menage-sites");
let seeded = false;

export function watchSites(callback) {
  return onSnapshot(REF(), (snap) => {
    if (snap.exists() && snap.data().sites) {
      callback(snap.data().sites);
    } else {
      callback(DEFAULT_SITES);
      // Amorce Firestore avec la config par défaut une seule fois, pour
      // que les modifications futures se fassent depuis la base.
      if (!seeded) { seeded = true; setDoc(REF(), { sites: DEFAULT_SITES }); }
    }
  }, (err) => { console.error("watchSites:", err); callback(DEFAULT_SITES); });
}

export async function saveSites(sites) {
  await setDoc(REF(), { sites });
}

export function findSiteIn(sites, id) {
  return sites.find(s => s.id === id) || sites[0];
}

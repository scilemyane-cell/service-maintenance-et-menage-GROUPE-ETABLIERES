import { db } from "./firebase-init.js";
import { doc, setDoc, onSnapshot } from "./firestore-compte.js";
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
      // Correction ponctuelle (une seule fois) : La Moutonnerie et Studio MNA
      // passent au lundi / mercredi / vendredi.
      let corrige = false;
      const sites = existing.map(e => {
        if (!["moutonnerie", "studio-mna"].includes(e.id) || e.correctionJours === "lmv") return e;
        corrige = true;
        return { ...e, correctionJours: "lmv", rooms: (e.rooms || []).map(r => ({ ...r, days: ["LUN", "MER", "VEN"] })) };
      });
      // Fusion ponctuelle : le Studio fait partie de La Moutonnerie (un seul site).
      const studio = sites.find(x => x.id === "studio-mna"), mout = sites.find(x => x.id === "moutonnerie");
      if (studio && mout) {
        corrige = true;
        const ren = { "Cuisine / salon": "Studio — cuisine / salon", "WC": "Studio — WC", "Salle d'eau": "Studio — salle d'eau" };
        const piecesStudio = (studio.rooms || []).map(r => ({ ...r, name: ren[r.name] || ("Studio — " + r.name) })).filter(r => !(mout.rooms || []).some(x => x.name === r.name));
        sites.splice(sites.indexOf(mout), 1, { ...mout, rooms: [...(mout.rooms || []), ...piecesStudio] });
        sites.splice(sites.findIndex(x => x.id === "studio-mna"), 1);
      }
      if ((missing.length > 0 || corrige) && !syncing) {
        syncing = true;
        setDoc(REF(), { sites: [...sites, ...missing] }).finally(() => { syncing = false; });
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

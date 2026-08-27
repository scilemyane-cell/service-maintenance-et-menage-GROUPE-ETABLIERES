import { db } from "./firebase-init.js";
import { doc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const REF = () => doc(db, "config", "associations-sites");

// Structure : { associations: [ { nom, sites: [{ nom, groupe }] } ] }
// `groupe` est optionnel — vide/absent = site affiché directement sous
// l'association ; renseigné (ex. "MNA", "Résidence") = les sites portant
// le même groupe sont regroupés visuellement ensemble.
const DEFAULT_ASSOCIATIONS = [
  { nom: "École", sites: [{ nom: "Internat Bâtiment A" }, { nom: "Internat Bâtiment B" }] },
  {
    nom: "Agropolis",
    sites: [
      { nom: "SVDP", groupe: "MNA" },
      { nom: "DR", groupe: "MNA" },
      { nom: "AGA", groupe: "MNA" },
      { nom: "Résidence", groupe: "Résidence" },
      { nom: "Haras de Vendée", groupe: "Résidence" },
    ],
  },
  { nom: "Armonia", sites: [{ nom: "Résidence Valoria" }] },
];

let seeded = false;

function normalize(associations) {
  return associations.map(a => ({
    nom: a.nom,
    sites: (a.sites || []).map(s => (typeof s === "string" ? { nom: s } : s)),
  }));
}

export function watchAssociations(callback) {
  return onSnapshot(REF(), (snap) => {
    if (snap.exists() && snap.data().associations) {
      let existing = normalize(snap.data().associations);
      callback(existing);
      // Comble automatiquement une association déjà présente en base mais
      // dont la liste de sites est encore vide, avec le modèle par défaut
      // prévu dans le code — sans jamais toucher à une association qui a
      // déjà au moins un site (donc déjà personnalisée par un admin).
      let changed = false;
      const patched = existing.map(a => {
        if (a.sites.length === 0) {
          const def = DEFAULT_ASSOCIATIONS.find(d => d.nom === a.nom);
          if (def && def.sites.length > 0) { changed = true; return { nom: a.nom, sites: def.sites }; }
        }
        return a;
      });
      if (changed && !seeded) { seeded = true; setDoc(REF(), { associations: patched }).finally(() => { seeded = false; }); }
    } else {
      callback(DEFAULT_ASSOCIATIONS);
      if (!seeded) { seeded = true; setDoc(REF(), { associations: DEFAULT_ASSOCIATIONS }); }
    }
  }, (err) => { console.error("watchAssociations:", err); callback(DEFAULT_ASSOCIATIONS); });
}

export async function saveAssociations(associations) {
  await setDoc(REF(), { associations });
}

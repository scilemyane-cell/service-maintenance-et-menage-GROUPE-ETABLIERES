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

// Ordre d'affichage imposé partout dans l'appli :
// École → Agropolis → (Agropolis) Résidences → (Agropolis) MNA → Armonia.
const sansAccentOrdre = t => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
export function rangAssociation(nom) {
  const n = sansAccentOrdre(nom);
  if (n.includes("ecole")) return 0;
  if (n.includes("agropolis")) return 1;
  if (n.includes("armonia")) return 4;
  return 5;
}
export function rangGroupe(nom) {
  const n = sansAccentOrdre(nom);
  if (!n) return 0;
  if (n.includes("residence")) return 1;
  if (/\bmna\b/.test(n)) return 2;
  return 3;
}
export function trierGroupes(noms) {
  return [...noms].sort((a, b) => rangGroupe(a) - rangGroupe(b) || String(a).localeCompare(String(b), "fr"));
}
function trierAssociations(liste) {
  return [...liste].sort((a, b) => rangAssociation(a.nom) - rangAssociation(b.nom));
}

export function watchAssociations(callback) {
  return onSnapshot(REF(), (snap) => {
    if (snap.exists() && snap.data().associations) {
      let existing = normalize(snap.data().associations);
      callback(trierAssociations(existing));
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
      callback(trierAssociations(DEFAULT_ASSOCIATIONS));
      if (!seeded) { seeded = true; setDoc(REF(), { associations: DEFAULT_ASSOCIATIONS }); }
    }
  }, (err) => { console.error("watchAssociations:", err); callback(trierAssociations(DEFAULT_ASSOCIATIONS)); });
}

export async function saveAssociations(associations) {
  await setDoc(REF(), { associations });
}

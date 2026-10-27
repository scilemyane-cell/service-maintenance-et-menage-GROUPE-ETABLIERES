import { db } from "./firebase-init.js";
import { doc, setDoc, onSnapshot } from "./firestore-compte.js";

const REF = () => doc(db, "config", "menage-dispositif-settings");

// Modèles hebdomadaires par défaut (heures contractuelles réparties par
// tâche/site) — amorcés une seule fois, ensuite librement modifiables
// depuis Paramètres > Général sans jamais écraser un ajustement déjà fait.
const DEFAULT_TEMPLATES = {
  "Daoud Mahdi": [
    { label: "Ménage — Résidence", heures: 5 },
    { label: "Ramassage déchets & sortie poubelles — Résidence", heures: 5 },
    { label: "Espaces verts — Résidence", heures: 2 },
    { label: "Ménage — Haras de Vendée", heures: 1.5 },
  ],
};

// Planning de Marie (semaine type, 36 h) : heures par site.
const CHARGE_MNA = { maj: "2026-10-27", template: [
  { label: "Ménage — Maison MNA DR", heures: 10 },
  { label: "Ménage — Maison MNA AGA", heures: 10 },
  { label: "Ménage — Maison MNA Saint Vincent de Paul", heures: 10 },
  { label: "Ménage — Maison MNA La Moutonnerie", heures: 3 },
  { label: "Ménage — Maison MNA La Ferme", heures: 3 },
] };

let syncing = false;

// Structure : { [nomDispositif]: { heures: true|false, template: [{label, heures}] } }
// Absent = true par défaut (suivi des heures activé), template vide par défaut.
export function watchDispositifSettings(callback) {
  return onSnapshot(REF(), (snap) => {
    const data = snap.exists() ? snap.data() : {};
    callback(data);
    // Amorçage silencieux : si un dispositif a un modèle par défaut prévu
    // dans le code et qu'aucun modèle n'existe encore en base pour lui,
    // on l'ajoute une fois — sans jamais toucher à un modèle déjà défini
    // (même vide) par un administrateur.
    // Charge de travail de Marie mise à jour d'après son planning (une seule fois).
    if (data["Dispositif MNA"]?.chargeMaj !== CHARGE_MNA.maj && !syncing) {
      syncing = true;
      setDoc(REF(), { "Dispositif MNA": { ...(data["Dispositif MNA"] || {}), template: CHARGE_MNA.template, chargeMaj: CHARGE_MNA.maj } }, { merge: true }).finally(() => { syncing = false; });
      return;
    }
    const missing = Object.entries(DEFAULT_TEMPLATES).filter(([disp]) => data[disp]?.template === undefined);
    if (missing.length > 0 && !syncing) {
      syncing = true;
      const patch = {};
      missing.forEach(([disp, template]) => { patch[disp] = { ...(data[disp] || {}), template }; });
      setDoc(REF(), patch, { merge: true }).finally(() => { syncing = false; });
    }
  }, (err) => { console.error("watchDispositifSettings:", err); callback({}); });
}

export async function setDispositifHeures(dispositif, enabled) {
  await setDoc(REF(), { [dispositif]: { heures: enabled } }, { merge: true });
}

export async function setDispositifTemplate(dispositif, template) {
  await setDoc(REF(), { [dispositif]: { template } }, { merge: true });
}

export function heuresEnabled(settingsMap, dispositif) {
  if (settingsMap[dispositif]?.heures !== undefined) return settingsMap[dispositif].heures;
  // Par défaut, le suivi horaire est désactivé pour le dispositif MNA
  // (contrat fixe, ex. 35h — pas besoin de pointage au jour le jour),
  // activé pour tout autre dispositif (ex. mi-temps avec heures variables).
  return dispositif !== "Dispositif MNA";
}

export function templateFor(settingsMap, dispositif) {
  return settingsMap[dispositif]?.template || [];
}

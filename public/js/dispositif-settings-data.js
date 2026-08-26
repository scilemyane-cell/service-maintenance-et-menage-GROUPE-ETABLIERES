import { db } from "./firebase-init.js";
import { doc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const REF = () => doc(db, "config", "menage-dispositif-settings");

// Structure : { [nomDispositif]: { heures: true|false } }
// Absent = true par défaut (suivi des heures activé).
export function watchDispositifSettings(callback) {
  return onSnapshot(REF(), (snap) => {
    callback(snap.exists() ? snap.data() : {});
  }, (err) => { console.error("watchDispositifSettings:", err); callback({}); });
}

export async function setDispositifHeures(dispositif, enabled) {
  await setDoc(REF(), { [dispositif]: { heures: enabled } }, { merge: true });
}

export function heuresEnabled(settingsMap, dispositif) {
  if (settingsMap[dispositif]?.heures !== undefined) return settingsMap[dispositif].heures;
  // Par défaut, le suivi horaire est désactivé pour le dispositif MNA
  // (contrat fixe, ex. 35h — pas besoin de pointage au jour le jour),
  // activé pour tout autre dispositif (ex. mi-temps avec heures variables).
  return dispositif !== "Dispositif MNA";
}

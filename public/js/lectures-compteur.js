// lectures-compteur.js
// Envoie régulièrement l'estimation des lectures ET des écritures Firestore de cet appareil
// (voir firestore-compte.js) dans lectures/{jour}_{uid}. Le « jour » suit
// l'heure du Pacifique, comme la remise à zéro du quota Firebase (9 h à Paris).
import { db } from "./firebase-init.js";
import { doc, setDoc, increment, serverTimestamp, collection, query, where, getDocs } from "./firestore-compte.js";

export const jourQuota = (d = new Date()) => d.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
let timer = null;

export function demarrerCompteurLectures(user) {
  if (timer || !user?.uid) return;
  const C = globalThis.__smmLectures || { n: 0, envoye: 0 };
  const envoyer = async () => {
    const aEnvoyer = C.n - C.envoye, eEnv = (C.e || 0) - (C.eEnvoye || 0), pEnv = (C.pos || 0) - (C.posEnvoye || 0);
    if (aEnvoyer <= 0 && eEnv <= 0) return;
    C.envoye = C.n; C.eEnvoye = C.e || 0; C.posEnvoye = C.pos || 0;
    try {
      await setDoc(doc(db, "lectures", `${jourQuota()}_${user.uid}`), {
        uid: user.uid, nom: user.nom || user.email || "", jour: jourQuota(), n: increment(aEnvoyer),
        e: increment(eEnv + 1), pos: increment(pEnv), majLe: serverTimestamp(),
      }, { merge: true });
    } catch (e) { C.envoye -= aEnvoyer; C.eEnvoye -= eEnv; C.posEnvoye -= pEnv; console.warn("Compteur de lectures :", e?.code || e); }
  };
  timer = setInterval(envoyer, 5 * 60000);
  setTimeout(envoyer, 60000);
  document.addEventListener("visibilitychange", () => { if (document.hidden) envoyer(); });
}

// Lectures des N derniers jours (Super Admin) : [{jour, uid, nom, n}]
export async function lireLectures(jours = 7) {
  const depuis = jourQuota(new Date(Date.now() - (jours - 1) * 864e5));
  const snap = await getDocs(query(collection(db, "lectures"), where("jour", ">=", depuis)));
  const l = []; snap.forEach(d => l.push(d.data())); return l;
}

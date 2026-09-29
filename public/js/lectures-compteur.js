// lectures-compteur.js
// Envoie régulièrement l'estimation des lectures Firestore de cet appareil
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
    const aEnvoyer = C.n - C.envoye; if (aEnvoyer <= 0) return;
    C.envoye = C.n;
    try {
      await setDoc(doc(db, "lectures", `${jourQuota()}_${user.uid}`), {
        uid: user.uid, nom: user.nom || user.email || "", jour: jourQuota(), n: increment(aEnvoyer), majLe: serverTimestamp(),
      }, { merge: true });
    } catch (e) { C.envoye -= aEnvoyer; console.warn("Compteur de lectures :", e?.code || e); }
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

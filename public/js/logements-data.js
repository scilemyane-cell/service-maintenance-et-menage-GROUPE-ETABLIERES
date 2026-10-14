// logements-data.js — Lecture, depuis l'appli, des logements Bât. A / B
// (outil logements, base Firebase « agropolis » distincte) : sert au
// bandeau d'accueil « 🏠 Logements à faire » d'un technicien, 5 jours avant
// la date d'intervention.
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getFirestore, doc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const CONFIG = {
  apiKey: "AIzaSyC9XP9ZYueo_XWj92uaGFlB0ulUc8dN9hU",
  authDomain: "agropolis-ca6bf.firebaseapp.com",
  projectId: "agropolis-ca6bf",
  storageBucket: "agropolis-ca6bf.firebasestorage.app",
  messagingSenderId: "414066383790",
  appId: "1:414066383790:web:35b554177f18373547463f",
};
const appLog = () => getApps().find(a => a.name === "logements") || initializeApp(CONFIG, "logements");
export const JOURS_AVANT = 5;
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Chambres attribuées à uid, dont l'intervention est d'ici 5 jours (ou en retard
// de moins de 7 jours), triées par date puis créneau.
export function watchMesLogements(uid, callback) {
  if (!uid) { callback([]); return () => {}; }
  return onSnapshot(doc(getFirestore(appLog()), "logements_internat", "etat"), (snap) => {
    let data = null; try { data = JSON.parse(snap.data()?.json || "null"); } catch { data = null; }
    const auj = new Date(); auj.setHours(0, 0, 0, 0);
    const max = new Date(auj); max.setDate(max.getDate() + JOURS_AVANT);
    const min = new Date(auj); min.setDate(min.getDate() - 7);
    const l = [];
    Object.values(data?.buildings || {}).forEach(b => (b.floors || []).forEach(f => (f.rooms || []).forEach(r => {
      if (r.assigneUid !== uid || !r.interventionDate) return;
      if (r.interventionDate > iso(max) || r.interventionDate < iso(min)) return;
      l.push({ bat: b.label || "", etage: f.name || "", numero: r.number, date: r.interventionDate, creneau: r.creneau || "", note: r.occupant || "" });
    })));
    l.sort((a, b) => a.date.localeCompare(b.date) || (a.creneau === "matin" ? -1 : b.creneau === "matin" ? 1 : 0) || String(a.numero).localeCompare(String(b.numero), "fr", { numeric: true }));
    callback(l);
  }, (err) => { console.error("logements :", err); callback([]); });
}

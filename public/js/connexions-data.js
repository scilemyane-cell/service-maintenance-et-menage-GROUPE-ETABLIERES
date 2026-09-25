// connexions-data.js
// Journal des connexions à l'appli (visible uniquement par le Super Admin,
// Administration > Connexions). Une ligne par ouverture de l'appli, au
// plus une toutes les 30 minutes par navigateur, pour ne pas noyer le
// journal quand quelqu'un recharge la page plusieurs fois.
import { db } from "./firebase-init.js";
import {
  collection, addDoc, serverTimestamp, query, where, orderBy, limit, getDocs, Timestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const COL = () => collection(db, "connexions");

function appareil() {
  const ua = navigator.userAgent || "";
  const type = /iPad|Tablet/i.test(ua) ? "Tablette" : /Mobi|Android|iPhone/i.test(ua) ? "Téléphone" : "Ordinateur";
  const nav = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Autre";
  const os = /Windows/.test(ua) ? "Windows" : /iPhone|iPad|iOS/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "";
  return { type, nav, os };
}

export async function journaliserConnexion(authUser, profil) {
  try {
    if (!authUser?.uid) return;
    const cle = "smm-derniere-connexion-" + authUser.uid;
    let derniere = 0;
    try { derniere = +localStorage.getItem(cle) || 0; } catch (e) { /* stockage indisponible */ }
    if (Date.now() - derniere < 30 * 60 * 1000) return;
    try { localStorage.setItem(cle, String(Date.now())); } catch (e) { /* ignore */ }
    const a = appareil();
    await addDoc(COL(), {
      uid: authUser.uid,
      email: authUser.email || "",
      nom: profil?.nom || authUser.email || (authUser.isAnonymous ? "Remplaçant (QR)" : ""),
      role: profil?.role || (authUser.isAnonymous ? "invite" : ""),
      at: serverTimestamp(),
      appareil: a.type, navigateur: a.nav, systeme: a.os,
    });
  } catch (e) {
    console.warn("journaliserConnexion:", e); // jamais bloquant
  }
}

export async function listerConnexions(jours = 90) {
  const depuis = Timestamp.fromDate(new Date(Date.now() - jours * 864e5));
  const snap = await getDocs(query(COL(), where("at", ">=", depuis), orderBy("at", "desc"), limit(3000)));
  const out = [];
  snap.forEach(d => { const x = d.data(); out.push({ id: d.id, ...x, date: x.at?.toDate ? x.at.toDate() : null }); });
  return out;
}

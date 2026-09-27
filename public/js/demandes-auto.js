// demandes-auto.js — Synchronisation automatique avec le fichier Excel des
// demandes, en arrière-plan, tant qu'un responsable (Super Admin / Admin /
// Superviseur) a l'appli ouverte avec sa session Microsoft active :
//  • toutes les 5 min, regarde si la copie SharePoint a changé (empreinte du
//    contenu) → si oui, importe les nouvelles demandes (les techniciens
//    voient les « 🆕 » sans attendre) ;
//  • dépose les modifications faites dans l'appli (y compris par les
//    techniciens, qui n'ont pas d'accès Microsoft) pour le flux n° 2.
// Un verrou dans config/demandes-synchro évite que deux responsables
// importent en même temps (doublons).
import { db } from "./firebase-init.js";
import { doc, getDoc, getDocs, collection, query, where, limit, runTransaction, Timestamp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { getGraphTokenSilentOnly } from "./graph-auth.js";
import { metadonneesFichierDrive } from "./sharepoint-storage.js";
import { recupererDepuisCopie, deposerMisesAJour } from "./demandes-sharepoint.js";

const REF = doc(db, "config", "demandes-synchro");
const CHEMIN_COPIE = "Demandes/SG_Suivi_Demandes_GroupeEtablieres.xlsx";
const PERIODE = 5 * 60000;
let timer = null, enCours = false;

async function prendreVerrou(cle) {
  return runTransaction(db, async (tx) => {
    const s = await tx.get(REF);
    const v = s.exists() ? (s.data()[cle] || 0) : 0;
    if (Date.now() - v < 3 * 60000) return false;
    tx.set(REF, { [cle]: Date.now() }, { merge: true });
    return true;
  });
}

async function tour() {
  if (enCours || document.hidden) return;
  enCours = true;
  try {
    const token = await getGraphTokenSilentOnly();
    if (!token) return; // pas de session Microsoft ouverte : on ne dérange pas
    const synchro = (await getDoc(REF)).data() || {};

    // 1) Import si la copie a changé
    const meta = await metadonneesFichierDrive(CHEMIN_COPIE, token);
    const empreinte = meta?.file?.hashes?.quickXorHash || `${meta?.size}-${meta?.lastModifiedDateTime}`;
    if (meta && empreinte !== synchro.derniereEmpreinte && await prendreVerrou("verrouImport")) {
      const snap = await getDocs(collection(db, "demandes"));
      const liste = []; snap.forEach(d => liste.push({ id: d.id, ...d.data() }));
      const r = await recupererDepuisCopie(liste, { interactif: false });
      if (r) {
        const { setDoc } = await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js");
        await setDoc(REF, { derniereEmpreinte: empreinte, verrouImport: 0 }, { merge: true });
        if (r.nouvelles) window.toast?.(`📥 ${r.nouvelles} nouvelle(s) demande(s) arrivée(s) du fichier Excel`);
      }
    }

    // 2) Dépôt des modifications faites dans l'appli depuis le dernier envoi
    const dernierDepot = synchro.dernierDepot || 0;
    const modif = await getDocs(query(collection(db, "demandes"), where("dateMaj", ">", Timestamp.fromMillis(dernierDepot)), limit(1)));
    if (!modif.empty && await prendreVerrou("verrouDepot")) {
      const recents = await getDocs(query(collection(db, "demandes"), where("dateMaj", ">=", Timestamp.fromMillis(Date.now() - 7 * 86400000))));
      const liste = []; recents.forEach(d => liste.push({ id: d.id, ...d.data() }));
      await deposerMisesAJour(liste, { interactif: false });
    }
  } catch (e) { console.warn("Synchro auto des demandes :", e); }
  finally { enCours = false; }
}

export function demarrerSynchroAutoDemandes() {
  if (timer) return;
  setTimeout(tour, 8000);
  timer = setInterval(tour, PERIODE);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) setTimeout(tour, 2000); });
}

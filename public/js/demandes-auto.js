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
import { doc, getDoc, getDocs, collection, query, where, limit, runTransaction, Timestamp } from "./firestore-compte.js";
import { getGraphTokenSilentOnly } from "./graph-auth.js";
import { metadonneesFichierDrive } from "./sharepoint-storage.js";
import { recupererDepuisCopie, deposerMisesAJour } from "./demandes-sharepoint.js";

const REF = doc(db, "config", "demandes-synchro");
const CHEMIN_COPIE = "Demandes/SG_Suivi_Demandes_GroupeEtablieres.xlsx";
const PERIODE = 5 * 60000;
let timer = null, enCours = false, avertiSuspendu = false;

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
    // Synchro suspendue (décalage des N° détecté dans le fichier) : on ne
    // touche à rien tant qu'un responsable n'a pas vérifié et relancé.
    if (synchro.suspendu) {
      if (!avertiSuspendu) { avertiSuspendu = true; window.toast?.(`⛔ Synchro avec le fichier Excel suspendue : N° décalés détectés (${synchro.suspendu.total}). Voir Suivi des demandes.`); }
      return;
    }

    // 1) Import si la copie a changé
    const meta = await metadonneesFichierDrive(CHEMIN_COPIE, token);
    const empreinte = meta?.file?.hashes?.quickXorHash || `${meta?.size}-${meta?.lastModifiedDateTime}`;
    if (meta && empreinte !== synchro.derniereEmpreinte && await prendreVerrou("verrouImport")) {
      // null = mode économe (ne relit que les demandes dont la ligne a changé)
      const r = await recupererDepuisCopie(null, { interactif: false });
      if (r?.suspendu) { window.toast?.(`⛔ Import arrêté : ${r.total} demande(s) aux N° décalés dans le fichier Excel. Synchro suspendue, rien n'a été créé.`); return; }
      if (r) {
        const { setDoc } = await import("./firestore-compte.js");
        await setDoc(REF, { derniereEmpreinte: empreinte, verrouImport: 0 }, { merge: true });
        if (r.nouvelles) window.toast?.(`📥 ${r.nouvelles} nouvelle(s) demande(s) arrivée(s) du fichier Excel`);
      }
    }

    // 2) Dépôt des modifications faites dans l'appli depuis le dernier envoi
    // Quota : on travaille sur la copie locale des demandes (déjà tenue à
    // jour par l'appli, voir cache-delta.js) — aucune relecture Firestore.
    const dernierDepot = synchro.dernierDepot || 0;
    const { watchDemandes } = await import("./firestore-data.js");
    const toutes = await new Promise((ok) => { let u = null, fini = false; u = watchDemandes((l) => { if (fini) return; fini = true; setTimeout(() => u && u(), 0); ok(l); }); });
    const msDe = (t) => (t?.toMillis ? t.toMillis() : (t?.seconds ? t.seconds * 1000 : 0));
    const aDeposer = toutes.some(d => msDe(d.dateMaj) > dernierDepot);
    if (aDeposer && await prendreVerrou("verrouDepot")) {
      // Toutes les demandes : le dépôt garde lui-même les 10 derniers jours et
      // repère les N° en double (copie locale, aucune lecture Firestore).
      await deposerMisesAJour(toutes, { interactif: false });
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

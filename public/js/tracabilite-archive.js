// tracabilite-archive.js — Archivage hebdomadaire des fiches de traçabilité
// ménage sur SharePoint, puis nettoyage des photos dans l'appli.
//
// Pour chaque fiche d'une semaine terminée (à partir du mardi suivant, pour
// laisser le temps de finir la saisie du vendredi) :
//   • ExportsDonnees/Traçabilité ménage/Département (sans photos)/<site>/…pdf
//     → la version à transmettre au Département (aucune photo, aucune
//       allusion aux photos dans les observations) ;
//   • ExportsDonnees/Traçabilité ménage/Interne (avec photos)/<site>/…pdf
//     → la version interne, avec les photos avant / après ;
//   • une fois les deux PDF bien enregistrés, les photos sont supprimées de
//     l'appli (le stockage ne garde que la semaine en cours).
// Lancé tout seul à l'ouverture de l'appli par un gestionnaire (compte
// Microsoft nécessaire pour SharePoint — l'agent n'en a pas).
import { db } from "./firebase-init.js";
import { collection, doc, getDoc, getDocs, query, where, setDoc, writeBatch } from "./firestore-compte.js";
import { getGraphToken, getGraphTokenSilentOnly } from "./graph-auth.js";
import { uploadToDrive, EXPORTS_ROOT_FOLDER } from "./sharepoint-storage.js";
import { ficheHTML } from "./tracabilite-rendu.js";
import { photosDeLaFiche, COL_PHOTOS } from "./fiches-photos.js";

// Première semaine archivée (les fiches plus anciennes restent dans l'appli).
export const ARCHIVE_DEBUT = "2026-10-12";
const DOSSIER = "Traçabilité ménage";
export const DOSSIER_DEPT = "Département (sans photos)";
export const DOSSIER_INTERNE = "Interne (avec photos)";

const ms = (v) => (v?.toMillis ? v.toMillis() : v?.seconds ? v.seconds * 1000 : Number(v) || 0);
// Semaine terminée : à partir du mardi qui suit le vendredi (weekEnd + 4 j).
export const semaineTerminee = (f, maintenant = Date.now()) => {
  if (!f?.weekEnd) return false;
  const lim = new Date(String(f.weekEnd).slice(0, 10) + "T00:00:00"); lim.setDate(lim.getDate() + 4);
  return maintenant >= lim.getTime();
};
// Version Département : aucune photo, et rien qui parle de photo dans les remarques.
const sansPhoto = (t) => String(t || "").split(/(?<=[.!?\n])\s*/).filter(x => !/photo|📷/i.test(x)).join(" ").trim();
export function versionDepartement(f) {
  const obs = {}; Object.entries(f.obs || {}).forEach(([k, v]) => { const t = sansPhoto(v); if (t) obs[k] = t; });
  return { ...f, photos: [], obs, observationsGenerales: sansPhoto(f.observationsGenerales),
    chambres: (f.chambres || []).map(c => ({ ...c, observation: sansPhoto(c.observation) })) };
}
export const nomFichier = (f) => `${f.weekStart} - ${f.siteName || "Site"} - ${f.agentNom || "Agent"}.pdf`.replace(/[\\/:*?"<>|]+/g, "-");

async function pdf(fiche, site, dispositif) {
  const html2pdf = await window.chargerLib?.("html2pdf"); if (!html2pdf) throw new Error("Librairie PDF non chargée");
  const cache = document.createElement("div");
  cache.style.cssText = "position:fixed;top:0;left:0;width:780px;opacity:0.01;pointer-events:none;z-index:-1;background:#fff";
  cache.innerHTML = ficheHTML(fiche, site, dispositif); document.body.append(cache);
  await Promise.all([...cache.querySelectorAll("img")].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; setTimeout(r, 4000); })));
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  try {
    return await html2pdf().set({ margin: [9, 9, 11, 9], image: { type: "jpeg", quality: 0.9 },
      html2canvas: { scale: 2, backgroundColor: "#ffffff", useCORS: true, logging: false }, jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
      pagebreak: { mode: ["css", "legacy"], avoid: [".trac-piece", "figure", "tr"] } }).from(cache.firstElementChild).outputPdf("blob");
  } finally { cache.remove(); }
}

let enCours = false;
export async function archiverSemainesTerminees({ interactif = false, onProgress = () => {} } = {}) {
  if (enCours) return { archivees: 0 }; enCours = true;
  try {
    const token = interactif ? await getGraphToken() : await getGraphTokenSilentOnly();
    if (!token) return { archivees: 0, sansCompte: true };
    const sites = (await getDoc(doc(db, "config", "menage-sites")))?.data()?.sites || [];
    const snap = await getDocs(query(collection(db, "fiches"), where("weekStart", ">=", ARCHIVE_DEBUT)));
    const fiches = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(f => !f.supprimeLe && semaineTerminee(f));
    // À archiver : jamais archivée, ou modifiée après l'archive (la version Département est alors refaite).
    const aFaire = fiches.filter(f => !f.archiveSP || ms(f.majLe) > (f.archiveSP.le || 0) + 120000);
    let archivees = 0, photosSupprimees = 0;
    for (const f of aFaire.slice(0, 12)) {
      onProgress(`Archivage ${archivees + 1} / ${aFaire.length} : ${f.siteName} — ${f.agentNom}`);
      const site = sites.find(s => s.id === f.siteId) || null, disp = site?.dispositif || "Dispositif MNA";
      const docsPh = await photosDeLaFiche(f.id);
      const photos = [...(f.photos || []).map(p => ({ ...p, moment: p.moment || "" })), ...docsPh];
      const nom = nomFichier(f), seg = (d) => [DOSSIER, d, f.siteName || "Sans site"];
      const opts = { conflictBehavior: "replace", fixedFilename: nom };
      const blobD = await pdf(versionDepartement(f), site, disp);
      await uploadToDrive(new File([blobD], nom, { type: "application/pdf" }), token, seg(DOSSIER_DEPT), EXPORTS_ROOT_FOLDER, opts);
      // Version interne : seulement s'il reste des photos à archiver, ou à la 1re archive.
      let interne = f.archiveSP?.interne || "";
      if (!f.archiveSP || photos.length) {
        const blobI = await pdf({ ...f, photos }, site, disp);
        await uploadToDrive(new File([blobI], nom, { type: "application/pdf" }), token, seg(DOSSIER_INTERNE), EXPORTS_ROOT_FOLDER, opts);
        interne = nom;
      }
      // Les deux PDF sont sur SharePoint → on libère le stockage de l'appli.
      const batch = writeBatch(db);
      docsPh.forEach(p => batch.delete(doc(db, COL_PHOTOS, p.id)));
      const nbPhotos = (f.archiveSP?.nbPhotos || 0) + photos.length;
      batch.set(doc(db, "fiches", f.id), { archiveSP: { le: Date.now(), departement: nom, interne, nbPhotos }, ...(f.photos?.length ? { photos: [] } : {}) }, { merge: true });
      await batch.commit();
      archivees++; photosSupprimees += photos.length;
    }
    return { archivees, photosSupprimees, restantes: Math.max(0, aFaire.length - 12) };
  } finally { enCours = false; }
}

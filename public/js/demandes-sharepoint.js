// demandes-sharepoint.js — Renvoie vers le fichier Excel SharePoint des
// demandeurs (SG_Suivi_Demandes_GroupeEtablieres.xlsx) le traitement fait
// dans l'appli : Contact (intervenant), Date d'intervention, Statut, Date
// statut, Commentaire. Chaque demande est retrouvée par son N° ; seules
// ces 5 colonnes (L à P) sont écrites, jamais celles des demandeurs, et
// seulement pour les demandes modifiées dans l'appli depuis la dernière
// synchronisation.
import { getGraphToken } from "./graph-auth.js";
import { db } from "./firebase-init.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const GRAPH = "https://graph.microsoft.com/v1.0";
const HOTE = "etablieresfr.sharepoint.com";
const SITE = "/sites/Sharepoint";
const NOM_FICHIER = "SG_Suivi_Demandes_GroupeEtablieres.xlsx";
const ID_UNIQUE = "eca7f67e-e644-43be-a4ff-436c65c14dd3"; // sourcedoc du lien partagé
const FEUILLE = "📋 Suivi des demandes";
const FEUILLE_LISTES = "Listes";
const REF_SYNCHRO = doc(db, "config", "demandes-synchro");

export class ErreurDroitsSharePoint extends Error {}

const sansAccent = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const lettre = (n) => String.fromCharCode(65 + n); // 0 → A (colonnes A..Z suffisent)
const serieExcel = (iso) => {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return "";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000);
};

async function appel(token, url, options = {}) {
  const res = await fetch(url.startsWith("http") ? url : GRAPH + url, {
    ...options, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(options.headers || {}) },
  });
  if (res.status === 401 || res.status === 403) {
    throw new ErreurDroitsSharePoint(`Accès refusé par SharePoint (${res.status}) sur le site ${SITE}.`);
  }
  if (!res.ok) throw new Error(`SharePoint ${res.status} : ${(await res.text()).slice(0, 200)}`);
  return res.status === 204 ? null : res.json();
}

async function trouverFichier(token) {
  const site = await appel(token, `/sites/${HOTE}:${SITE}`);
  const drives = await appel(token, `/sites/${site.id}/drives?$select=id,name`);
  for (const d of drives.value || []) {
    const r = await appel(token, `/drives/${d.id}/root/search(q='${encodeURIComponent(NOM_FICHIER.replace(".xlsx", ""))}')?$select=id,name,sharepointIds,webUrl`).catch(() => ({ value: [] }));
    const exact = (r.value || []).find(x => (x.sharepointIds?.listItemUniqueId || "").toLowerCase() === ID_UNIQUE)
      || (r.value || []).find(x => x.name === NOM_FICHIER);
    if (exact) return { driveId: d.id, itemId: exact.id, webUrl: exact.webUrl };
  }
  throw new Error(`Fichier ${NOM_FICHIER} introuvable sur le site ${SITE}.`);
}

// lignesApp : demandes Firestore ({ numero, statut, intervenant, contact,
// dateIntervention, dateStatut, commentaireTech, dateMaj }).
export async function synchroniserDemandesVersSharePoint(lignesApp, { onProgress = () => {}, tout = false } = {}) {
  const token = await getGraphToken();
  onProgress("Recherche du fichier sur SharePoint…");
  const f = await trouverFichier(token);
  const base = `/drives/${f.driveId}/items/${f.itemId}/workbook`;
  const feuille = `${base}/worksheets('${encodeURIComponent(FEUILLE)}')`;

  onProgress("Lecture du fichier…");
  const plage = await appel(token, `${feuille}/usedRange(valuesOnly=true)?$select=address,values`);
  const valeurs = plage.values || [];
  const debut = parseInt(String(plage.address).split("!")[1].match(/\d+/)[0], 10); // 1re ligne de la plage
  const iEntete = valeurs.findIndex(r => sansAccent(r[0]).startsWith("n° demande") || sansAccent(r[0]).startsWith("n demande"));
  if (iEntete < 0) throw new Error("En-tête « N° demande » introuvable dans le fichier.");
  const entete = valeurs[iEntete].map(sansAccent);
  const col = (debutNom) => entete.findIndex(h => h.startsWith(debutNom));
  const C = { contact: col("contact"), dateInterv: col("date d'intervention"), statut: col("statut"), dateStatut: col("date statut"), commentaire: col("commentaire") };
  if (Object.values(C).some(v => v < 0)) throw new Error("Colonnes attendues introuvables (Contact, Date d'intervention, Statut, Date statut, Commentaire).");

  // Libellés de statut autorisés par la liste déroulante du fichier.
  let statutsFichier = [];
  try {
    const l = await appel(token, `${base}/worksheets('${encodeURIComponent(FEUILLE_LISTES)}')/usedRange(valuesOnly=true)?$select=values`);
    const iCol = (l.values?.[0] || []).findIndex(h => sansAccent(h) === "statut");
    if (iCol >= 0) statutsFichier = l.values.slice(1).map(r => r[iCol]).filter(Boolean);
  } catch { /* liste absente : on écrit le libellé en majuscules */ }
  const statutPourFichier = (s) => {
    if (!s || s === "Non renseigné") return "";
    return statutsFichier.find(x => sansAccent(x) === sansAccent(s)) || String(s).toUpperCase();
  };

  const ligneDuNumero = {};
  valeurs.forEach((r, i) => { if (i > iEntete && r[0]) ligneDuNumero[String(r[0]).trim()] = debut + i; });

  const synchro = await getDoc(REF_SYNCHRO).catch(() => null);
  const derniere = !tout && synchro?.exists() ? synchro.data().derniereSynchro || 0 : 0;
  const msMaj = (l) => l.dateMaj?.toMillis ? l.dateMaj.toMillis() : (l.dateMaj?.seconds ? l.dateMaj.seconds * 1000 : 0);
  const aEnvoyer = lignesApp.filter(l => ligneDuNumero[l.numero] && msMaj(l) > derniere);
  const introuvables = lignesApp.filter(l => msMaj(l) > derniere && !ligneDuNumero[l.numero]).length;

  const cMin = Math.min(...Object.values(C)), cMax = Math.max(...Object.values(C));
  const requetes = aEnvoyer.map((l, k) => {
    const n = ligneDuNumero[l.numero];
    const actuel = valeurs[n - debut] || [];
    const ligne = actuel.slice(cMin, cMax + 1).map(v => v ?? "");
    const poser = (c, v) => { ligne[c - cMin] = v; };
    poser(C.contact, l.intervenant || l.contact || actuel[C.contact] || "");
    poser(C.dateInterv, serieExcel(l.dateIntervention) || actuel[C.dateInterv] || "");
    poser(C.statut, statutPourFichier(l.statut));
    poser(C.dateStatut, serieExcel(l.dateStatut) || actuel[C.dateStatut] || "");
    poser(C.commentaire, l.commentaireTech || actuel[C.commentaire] || "");
    return { id: String(k + 1), method: "PATCH", url: `${feuille.replace(GRAPH, "")}/range(address='${lettre(cMin)}${n}:${lettre(cMax)}${n}')`.replace(/^\/?/, "/"), headers: { "Content-Type": "application/json" }, body: { values: [ligne] } };
  });

  for (let i = 0; i < requetes.length; i += 20) {
    onProgress(`Envoi ${Math.min(i + 20, requetes.length)} / ${requetes.length}…`);
    const r = await appel(token, "/$batch", { method: "POST", body: JSON.stringify({ requests: requetes.slice(i, i + 20) }) });
    const echec = (r.responses || []).find(x => x.status >= 400);
    if (echec) {
      if (echec.status === 403 || echec.status === 401) throw new ErreurDroitsSharePoint("SharePoint refuse l'écriture dans le fichier.");
      throw new Error(`SharePoint ${echec.status} : ${JSON.stringify(echec.body).slice(0, 200)}`);
    }
  }
  await setDoc(REF_SYNCHRO, { derniereSynchro: Date.now(), derniereSynchroLignes: requetes.length }, { merge: true });
  return { envoyees: requetes.length, introuvables, webUrl: f.webUrl };
}

export async function lireDerniereSynchro() {
  try { const s = await getDoc(REF_SYNCHRO); return s.exists() ? s.data() : null; } catch { return null; }
}

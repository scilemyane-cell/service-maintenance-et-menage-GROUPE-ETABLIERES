// camileia-retour.js — Quand un ticket Camileia (version de test) est modifié
// dans l'appli, on renvoie à Camileia : le nouvel état (statut) et le
// commentaire technicien (en message). Échec = simple avertissement, le
// ticket de l'appli reste enregistré ; l'erreur est notée sur le ticket.
import { db } from "./firebase-init.js";
import { doc, getDoc, updateDoc } from "./firestore-compte.js";
import * as cam from "./camileia.js";
import { statutPropose } from "./camileia-demandes.js";
import { auth } from "./firebase-init.js";

const sa = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
// Statut appli → libellé d'état Camileia (par défaut).
const ETAT_POUR_STATUT = {
  "pris en compte": "Pris en compte", "demande de devis": "Attente devis", "planifie": "En cours",
  "intervenant sollicite": "En cours", "commande en cours": "En cours", "en attente de date d'intervention": "En cours",
  "realise – a valider": "Terminée", "realise": "Clôturée",
};
let etatsCache = null;
async function etats() {
  if (!etatsCache) etatsCache = cam.avecIri(await cam.lireTout(`${cam.RACINE}/d_i_etats`, { maxPages: 2 }), `${cam.RACINE}/d_i_etats`);
  return etatsCache;
}
async function etatPourStatut(statut) {
  const liste = await etats();
  // 1) correspondance enregistrée à l'écran (état → statut), sens inverse
  let corresp = {};
  try { corresp = (await getDoc(doc(db, "config", "camileia-correspondances")))?.data()?.etats || {}; } catch { /* */ }
  const voulu = ETAT_POUR_STATUT[sa(statut)];
  const parLibelle = voulu && liste.find(e => sa(cam.libelleLisible(e.libelle)) === sa(voulu));
  if (parLibelle) return parLibelle["@id"];
  const inverse = liste.find(e => (corresp[e["@id"]] || statutPropose(cam.libelleLisible(e.libelle))) === statut);
  return inverse ? inverse["@id"] : null;
}

export async function renvoyerVersCamileia(id, fields, { collection = "demandes-camileia" } = {}) {
  await cam.chargerRelaisPartage();
  if (!cam.estConnecte()) throw new Error("relais Camileia non réglé sur cet appareil (Suivi des demandes › Camileia (test))");
  const ref = doc(db, collection, id);
  const t = (await getDoc(ref))?.data();
  if (!t?.camileiaIri) return;
  const faits = [], erreurs = [];
  let contactIri = null;
  try { const { contactParEmail } = await import("./camileia-envoi.js"); contactIri = (await contactParEmail(auth.currentUser?.email))?.["@id"] || null; } catch { /* auteur facultatif */ }
  try {
    if (fields.statut && fields.statut !== "Annulé") {
      const iri = await etatPourStatut(fields.statut);
      // Demande réalisée : le commentaire technicien devient le compte rendu d'intervention de la DI.
      const realise = /^r[ée]alis/i.test(fields.statut);
      const cr = String(fields.commentaireTech || t.commentaireTech || "").trim();
      const enPlus = realise ? { ...(cr ? { noteb: cr } : {}), dateintervention: t.camileiaDateIntervention || new Date().toISOString() } : {};
      if (iri && iri !== t.camileiaEtatIri) { await cam.changerEtat(t.camileiaIri, iri, enPlus); faits.push(realise && cr ? "état + compte rendu" : "état"); await updateDoc(ref, { camileiaEtatIri: iri }); }
    }
  } catch (e) { erreurs.push(`état : ${e.message}`); }
  // Qualification faite dans l'appli : type de demande et priorité renvoyés à Camileia.
  try {
    const enPlus = {};
    if ("categoriePanne" in fields || "urgence" in fields) {
      const ev = await import("./camileia-envoi.js");
      if ("categoriePanne" in fields) {
        const { categorieDe } = await import("./categories-pannes.js");
        const ct = await ev.lireCorrespTypes();
        const tp = ct[categorieDe({ ...t, ...fields })]; if (tp) enPlus.typepanne = tp;
      }
      if (fields.urgence) { const pr = await ev.prioritePourUrgence(fields.urgence); if (pr) enPlus.priorite = pr; }
    }
    if (Object.keys(enPlus).length) { await cam.changerEtat(t.camileiaIri, null, enPlus); faits.push("qualification"); }
  } catch (e) { erreurs.push(`qualification : ${e.message}`); }
  try {
    const texte = String(fields.commentaireTech || "").trim();
    if (texte && texte !== String(t.dernierMessageCamileia || "")) {
      await cam.envoyerMessage(t.camileiaIri, `[Appli SMM] ${texte}`, contactIri); faits.push("message");
      await updateDoc(ref, { dernierMessageCamileia: texte });
    }
  } catch (e) { erreurs.push(`message : ${e.message}`); }
  try { await updateDoc(ref, { camileiaRetourLe: Date.now(), camileiaRetour: faits.join(", "), camileiaRetourErreur: erreurs.join(" | ") }); } catch { /* */ }
  if (erreurs.length) { console.warn("Retour Camileia :", erreurs); window.toast?.(`⚠️ Camileia : ${erreurs.join(" | ")}`, "error"); }
  else if (faits.length) window.toast?.(`✓ Camileia mis à jour (${faits.join(", ")})`);
}

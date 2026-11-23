// camileia-retour.js — Quand un ticket Camileia (version de test) est modifié
// dans l'appli, on renvoie à Camileia : le nouvel état (statut) et le
// commentaire technicien (en message). Échec = simple avertissement, le
// ticket de l'appli reste enregistré ; l'erreur est notée sur le ticket.
import { db } from "./firebase-init.js";
import { doc, getDoc, updateDoc } from "./firestore-compte.js";
import * as cam from "./camileia.js";
import { statutPropose } from "./camileia-demandes.js";

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
  if (!cam.estConnecte()) return;
  const ref = doc(db, collection, id);
  const t = (await getDoc(ref))?.data();
  if (!t?.camileiaIri) return;
  const faits = [], erreurs = [];
  try {
    if (fields.statut && fields.statut !== "Annulé") {
      const iri = await etatPourStatut(fields.statut);
      if (iri && iri !== t.camileiaEtatIri) { await cam.changerEtat(t.camileiaIri, iri); faits.push("état"); await updateDoc(ref, { camileiaEtatIri: iri }); }
    }
  } catch (e) { erreurs.push(`état : ${e.message}`); }
  try {
    const texte = String(fields.commentaireTech || "").trim();
    if (texte && texte !== String(t.dernierMessageCamileia || "")) {
      await cam.envoyerMessage(t.camileiaIri, `[Appli SMM] ${texte}`); faits.push("message");
      await updateDoc(ref, { dernierMessageCamileia: texte });
    }
  } catch (e) { erreurs.push(`message : ${e.message}`); }
  try { await updateDoc(ref, { camileiaRetourLe: Date.now(), camileiaRetour: faits.join(", "), camileiaRetourErreur: erreurs.join(" | ") }); } catch { /* */ }
  if (erreurs.length) console.warn("Retour Camileia :", erreurs);
}

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

const idDe = (iri) => { const n = parseInt(String(iri || "").split("/").pop(), 10); return Number.isFinite(n) ? n : null; };
// « 2026-11-23T21:45:00Z » → « 2026-11-23T22:45 » (heure locale, format du formulaire Camileia)
const dateLocale = (v) => { const d = v ? new Date(v) : new Date(); if (isNaN(d)) return null; return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };

// Technicien attribué dans l'appli → contact (et société) Camileia.
async function contactPourAttribution(uid, nom) {
  const ev = await import("./camileia-envoi.js");
  let email = "";
  try { email = (await getDoc(doc(db, "users", uid)))?.data()?.email || ""; } catch { /* */ }
  let c = email ? await ev.contactParEmail(email) : null;
  if (!c && nom) {
    const r = await ev.referentiels();
    const cible = sa(nom).replace(/[^a-z]+/g, " ").trim();
    const trouves = r.contacts.filter(x => { const a = sa(`${x.prenom} ${x.nom}`).replace(/[^a-z]+/g, " ").trim(), b = sa(`${x.nom} ${x.prenom}`).replace(/[^a-z]+/g, " ").trim(); return a === cible || b === cible; });
    if (trouves.length === 1) c = trouves[0];
  }
  return c;
}

export async function renvoyerVersCamileia(id, fields, { collection = "demandes-camileia" } = {}) {
  await cam.chargerRelaisPartage();
  if (!cam.estConnecte()) throw new Error("relais Camileia non réglé sur cet appareil (Suivi des demandes › Camileia (test))");
  const ref = doc(db, collection, id);
  const t = (await getDoc(ref))?.data();
  if (!t?.camileiaIri) return;
  window.toast?.("⏳ Envoi à Camileia…");
  const faits = [], erreurs = [], avertissements = [];
  let contactIri = null;
  try { const { contactParEmail } = await import("./camileia-envoi.js"); contactIri = (await contactParEmail(auth.currentUser?.email))?.["@id"] || null; } catch { /* auteur facultatif */ }

  // 1) Ce qu'on veut changer sur la fiche DI (identifiants numériques Camileia).
  const champs = {}, libelles = [];
  let etatIri = null;
  try {
    if (fields.statut && fields.statut !== "Annulé") {
      const iri = await etatPourStatut(fields.statut);
      if (iri && iri !== t.camileiaEtatIri) {
        etatIri = iri; champs.etat = idDe(iri); libelles.push("état");
        // Demande réalisée : le commentaire technicien devient le compte rendu d'intervention.
        if (/^r[ée]alis/i.test(fields.statut)) {
          const cr = String(fields.commentaireTech || t.commentaireTech || "").trim();
          if (cr) { champs.noteb = cr; libelles.push("compte rendu"); }
          champs.dateintervention = dateLocale(t.camileiaDateIntervention);
        }
      }
    }
  } catch (e) { erreurs.push(`état : ${e.message}`); }
  try {
    const urg = fields.urgenceCorrigee || fields.urgence;
    if ("categoriePanne" in fields || urg) {
      const ev = await import("./camileia-envoi.js");
      if ("categoriePanne" in fields) {
        const { categorieDe } = await import("./categories-pannes.js");
        const ct = await ev.lireCorrespTypes();
        const tp = ct[categorieDe({ ...t, ...fields })]; if (tp) champs.typepanne = idDe(tp);
      }
      if (urg) { const pr = await ev.prioritePourUrgence(urg); if (pr) champs.priorite = idDe(pr); }
      if (champs.typepanne || champs.priorite) libelles.push("qualification");
    }
  } catch (e) { erreurs.push(`qualification : ${e.message}`); }
  try {
    if ("attribueA" in fields && fields.attribueA !== "ext") {
      if (!fields.attribueA) { champs.contacts = []; champs.societes = []; libelles.push("attribution retirée"); }
      else {
        const c = await contactPourAttribution(fields.attribueA, fields.attribueANom);
        if (c) { champs.contacts = [c.id ?? idDe(c["@id"])]; champs.societes = c.societe ? [idDe(c.societe)] : []; libelles.push(`attribuée à ${fields.attribueANom || c.prenom}`); }
        else avertissements.push(`${fields.attribueANom || "technicien"} introuvable dans les contacts Camileia : attribution non reportée`);
      }
    }
  } catch (e) { erreurs.push(`attribution : ${e.message}`); }

  // 2) Envoi : d'abord au nom de la personne connectée (tracé dans Camileia),
  //    sinon par l'API (enregistré mais SANS historique ni mail Camileia).
  if (Object.keys(champs).length) {
    let fait = false;
    try {
      const jeton = await auth.currentUser?.getIdToken?.();
      const r = await cam.modifierAuNomDe(idDe(t.camileiaIri), champs, jeton);
      if (r?.ok) {
        fait = true; faits.push(`${libelles.join(", ")} — tracé`);
        if (r.absents?.length) avertissements.push(`non modifiable avec ce compte Camileia : ${r.absents.join(", ")}`);
      } else if (!r?.pasDeCompte) erreurs.push("Camileia n'a pas confirmé la modification");
      else avertissements.push(r.relaisAncien ? "relais à mettre à jour : modification NON tracée dans Camileia" : `pas de compte Camileia relié pour ${r.email || auth.currentUser?.email} : modification NON tracée dans Camileia`);
    } catch (e) { erreurs.push(e.message); fait = true; /* pas de double envoi si le relais a répondu une erreur */ }
    if (!fait) {
      try {
        const enPlus = {};
        if ("noteb" in champs) enPlus.noteb = champs.noteb;
        if ("dateintervention" in champs) enPlus.dateintervention = new Date(champs.dateintervention).toISOString();
        if (champs.typepanne) enPlus.typepanne = `${cam.RACINE}/d_i_type_pannes/${champs.typepanne}`;
        if (champs.priorite) enPlus.priorite = `${cam.RACINE}/d_i_priorites/${champs.priorite}`;
        if (champs.contacts) enPlus.contacts = champs.contacts.map(x => `${cam.RACINE}/contacts/${x}`);
        if (champs.societes) enPlus.societes = champs.societes.map(x => `${cam.RACINE}/societes/${x}`);
        await cam.changerEtat(t.camileiaIri, etatIri, enPlus);
        faits.push(libelles.join(", ")); fait = true;
      } catch (e) { erreurs.push(e.message); }
    }
    if (fait && etatIri && !erreurs.length) { try { await updateDoc(ref, { camileiaEtatIri: etatIri }); } catch { /* */ } }
  }

  // 3) Commentaire technicien → message dans la DI (signé par son contact).
  try {
    const texte = String(fields.commentaireTech || "").trim();
    if (texte && texte !== String(t.dernierMessageCamileia || "")) {
      await cam.envoyerMessage(t.camileiaIri, `[Appli SMM] ${texte}`, contactIri); faits.push("message");
      await updateDoc(ref, { dernierMessageCamileia: texte });
    }
  } catch (e) { erreurs.push(`message : ${e.message}`); }
  try { await updateDoc(ref, { camileiaRetourLe: Date.now(), camileiaRetour: faits.join(", "), camileiaRetourErreur: [...erreurs, ...avertissements].join(" | ") }); } catch { /* */ }
  if (erreurs.length) { console.warn("Retour Camileia :", erreurs); window.toast?.(`⚠️ Camileia : ${erreurs.join(" | ")}`, "error"); }
  else if (avertissements.length) window.toast?.(`⚠️ Camileia${faits.length ? ` (${faits.join(", ")})` : ""} : ${avertissements.join(" | ")}`, "error");
  else if (faits.length) window.toast?.(`✓ Camileia mis à jour (${faits.join(", ")})`);
  else window.toast?.("Camileia : rien à changer (déjà à jour)");
}

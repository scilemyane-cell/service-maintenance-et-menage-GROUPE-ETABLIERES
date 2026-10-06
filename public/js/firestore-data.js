import { ecoutePartagee, partager } from "./ecoute-partagee.js";
import { ecouteDelta, majLocale } from "./cache-delta.js";
import { db, auth } from "./firebase-init.js";
import {
  doc, getDoc, getDocs, setDoc, updateDoc,
  collection, addDoc, deleteDoc, onSnapshot, runTransaction, serverTimestamp, deleteField,
  writeBatch, Timestamp, query, where
} from "./firestore-compte.js";

const DEFAULT_PEOPLE = { n1: ["Valentin", "Lionel"], n2: ["Technicien 1", "Technicien 2", "Technicien 3"] };

// ---- Personnes (N1 / N2) ----
export const watchPeople = partager("people", watchPeopleBrut);
function watchPeopleBrut(callback) {
  const ref = doc(db, "config", "people");
  return onSnapshot(ref, (snap) => {
    callback(snap.exists() ? snap.data() : DEFAULT_PEOPLE);
  }, (err) => { console.error("watchPeople:", err); callback(DEFAULT_PEOPLE); });
}
export async function savePeople(people) {
  await setDoc(doc(db, "config", "people"), people);
}

// ---- Absences ----
export const watchAbsences = partager("absences", watchAbsencesBrut);
function watchAbsencesBrut(callback) {
  return onSnapshot(collection(db, "absences"), (snap) => {
    const list = [];
    snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
    callback(list);
  }, (err) => { console.error("watchAbsences:", err); callback([]); });
}
export async function addAbsence(record) {
  await addDoc(collection(db, "absences"), record);
}
export async function updateAbsence(id, fields) {
  await updateDoc(doc(db, "absences", id), fields);
}
export async function deleteAbsence(id) {
  await deleteDoc(doc(db, "absences", id));
}

// ---- Récurrences (planning récurrent d'entretien, ex. espaces verts) ----
// Une récurrence décrit une règle ("tous les X, tel jour, sur tel site")
// à partir de laquelle de vraies interventions sont générées à l'avance
// (voir genererOccurrencesRecurrence dans planning.js) — la récurrence
// elle-même ne contient jamais d'heures travaillées.
export const watchRecurrences = partager("recurrences", watchRecurrencesBrut);
function watchRecurrencesBrut(callback) {
  return onSnapshot(collection(db, "recurrences"), (snap) => {
    const list = [];
    snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
    callback(list);
  }, (err) => { console.error("watchRecurrences:", err); callback([]); });
}
export async function addRecurrence(record) {
  const ref = await addDoc(collection(db, "recurrences"), { ...record, createdBy: auth.currentUser?.uid || record.createdBy });
  return ref.id;
}
export async function updateRecurrence(id, fields) {
  await updateDoc(doc(db, "recurrences", id), fields);
}
export async function deleteRecurrence(id) {
  await deleteDoc(doc(db, "recurrences", id));
}

// ---- Interventions ----
export const watchInterventions = partager("interventions", watchInterventionsBrut);
function watchInterventionsBrut(callback) {
  return onSnapshot(collection(db, "interventions"), (snap) => {
    const list = [];
    snap.forEach((d) => { if (!d.data().supprimeLe) list.push({ id: d.id, ...d.data() }); });
    callback(list);
  }, (err) => { console.error("watchInterventions:", err); callback([]); });
}
// QUOTA : l'accueil n'a besoin que d'une petite partie des interventions
// (à compléter, à venir, mois à clôturer) — requêtes ciblées au lieu de
// relire tout l'historique à chaque ouverture.
export function watchInterventionsDepuis(dateIso, callback) {
  return ecoutePartagee(`interv-depuis:${dateIso}`, (emettre) => onSnapshot(query(collection(db, "interventions"), where("date", ">=", dateIso)), (snap) => {
    const l = []; snap.forEach(d => { if (!d.data().supprimeLe) l.push({ id: d.id, ...d.data() }); }); emettre(l);
  }, (err) => { console.error("watchInterventionsDepuis:", err); emettre([]); }), callback);
}
export function watchInterventionsACompleter(callback) {
  return ecoutePartagee("interv-a-completer", (emettre) => onSnapshot(query(collection(db, "interventions"), where("horairesACompleter", "==", true)), (snap) => {
    const l = []; snap.forEach(d => { if (!d.data().supprimeLe) l.push({ id: d.id, ...d.data() }); }); emettre(l);
  }, (err) => { console.error("watchInterventionsACompleter:", err); emettre([]); }), callback);
}
export async function addIntervention(record) {
  // Numéro d'intervention séquentiel (ex. "INT-00042"), attribué de
  // façon atomique via un compteur partagé — pour identifier chaque
  // intervention de façon lisible, notamment sur la note de frais
  // kilométrique qui y renvoie.
  const compteurRef = doc(db, "config", "compteur-interventions");
  const numero = await runTransaction(db, async (tx) => {
    const snap = await tx.get(compteurRef);
    const dernier = snap.exists() ? (snap.data().dernier || 0) : 0;
    const suivant = dernier + 1;
    tx.set(compteurRef, { dernier: suivant }, { merge: true });
    return suivant;
  });
  // createdBy = toujours le compte réellement connecté (règle Firestore),
  // y compris quand un responsable saisit depuis « Aperçu en tant que… ».
  const num = `INT-${String(numero).padStart(5, "0")}`;
  const ref = await addDoc(collection(db, "interventions"), { ...record, createdBy: auth.currentUser?.uid || record.createdBy, numero: num });
  return { id: ref.id, numero: num };
}
export async function updateIntervention(id, fields) {
  await updateDoc(doc(db, "interventions", id), fields);
}
// Suppression récupérable (corbeille, 60 jours) — remplace l'ancienne
// suppression directe et définitive, à l'origine d'une perte de données
// accidentelle sans aucun moyen de rattrapage.
export async function envoyerInterventionCorbeille(id) {
  await updateDoc(doc(db, "interventions", id), { supprimeLe: Timestamp.now() });
}
export async function restaurerIntervention(id) {
  await updateDoc(doc(db, "interventions", id), { supprimeLe: deleteField() });
}
export async function purgerInterventionDefinitivement(id) {
  await deleteDoc(doc(db, "interventions", id));
}
export async function listerInterventionsCorbeille() {
  const snap = await getDocs(collection(db, "interventions"));
  const list = [];
  snap.forEach((d) => { if (d.data().supprimeLe) list.push({ id: d.id, ...d.data() }); });
  return list;
}

// ---- Demandes d'intervention (import du fichier Excel "SG_Suivi_Demandes")
// ----
// Contrairement au reste de l'appli, ces demandes proviennent au départ
// d'un fichier Excel externe (les demandeurs y saisissent leurs demandes,
// hors de l'appli). Une fois importées ici, ce sont ces documents
// Firestore qui font foi pour le suivi/traitement par les techniciens ;
// le champ `numero` (ex. "SG-001") sert de clé pour retrouver la ligne
// correspondante dans le fichier Excel au moment de la resynchronisation.
// ---- Écoutes partagées ----
// Quota gratuit Firestore (50 000 lectures / jour) : chaque nouvelle écoute
// relit TOUS les documents de la requête. On garde donc une seule écoute par
// requête pour toute la session (ouvrir / fermer une tuile ne relit rien) :
// seuls les documents modifiés sont ensuite facturés.
// Demandes : copie gardée sur l'appareil + seules les demandes modifiées
// depuis la dernière visite sont lues (voir cache-delta.js). Les champs
// date couvrent toutes les écritures : dateMaj (appli), importeLe (nouvelle
// demande importée), importMajLe (mise à jour venant du fichier Excel).
export function watchDemandes(callback) {
  return ecoutePartagee("demandes:delta", ecouteDelta({ cle: "demandes", col: "demandes", champs: ["dateMaj", "importeLe", "importMajLe"] }), callback);
}
// Lecture ponctuelle de toutes les demandes (outils manuels : récupérer, doublons).
export async function lireToutesDemandes() {
  const snap = await getDocs(collection(db, "demandes"));
  const l = []; snap.forEach(d => l.push({ id: d.id, ...d.data() })); return l;
}
export async function importerDemandes(lignes) {
  const existant = await getDocs(collection(db, "demandes"));
  const numerosConnus = new Set();
  existant.forEach((d) => numerosConnus.add(d.data().numero));
  const aAjouter = lignes.filter((l) => !numerosConnus.has(l.numero));
  for (let i = 0; i < aAjouter.length; i += 450) {
    const lot = aAjouter.slice(i, i + 450);
    const batch = writeBatch(db);
    lot.forEach((l) => batch.set(doc(collection(db, "demandes")), { ...l, importeLe: serverTimestamp(), importMajLe: serverTimestamp() }));
    await batch.commit();
  }
  return aAjouter.length;
}
// ---- Vues dérivées des demandes ----
// QUOTA : ces vues (bandeaux, badges) étaient chacune une requête Firestore
// relue à chaque ouverture de l'appli (toutes les urgences depuis toujours,
// etc.). Elles sont maintenant calculées à partir de la copie locale des
// demandes (watchDemandes, cache-delta) : zéro lecture supplémentaire.
const msDe = (t) => (t?.toMillis ? t.toMillis() : (t?.seconds ? t.seconds * 1000 : 0));
const resumeAction = (x) => (x.actionPour && x.actionTexte ? { pour: x.actionPourNom || "", fait: !!x.actionFaiteLe, imm: !!x.actionImmediate, texte: x.actionTexte } : null);
function deriverDemandes(cle, calcul, callback) {
  return ecoutePartagee(`derive:${cle}`, (emettre) => { watchDemandes((liste) => emettre(calcul(liste))); }, callback);
}
// Demandes Urgentes / Critiques encore ouvertes (bandeau d'accueil).
export function watchUrgencesOuvertes(callback) {
  return deriverDemandes("urgences", (liste) => liste.filter(x => {
    const urg = x.urgenceCorrigee || x.urgence;
    return ["Urgent", "Critique"].includes(urg) && !x.lieeA && !["Réalisé", "Annulé", "Réalisé – à valider"].includes(x.statut);
  }).map(x => ({ id: x.id, numero: x.numero, site: x.site, local: x.local, descriptif: x.descriptif, urgence: x.urgenceCorrigee || x.urgence, dateDemande: x.dateDemande, importeMs: msDe(x.importeLe), attribueA: x.attribueA || "", action: resumeAction(x) })), callback);
}
// Nouvelles demandes (importées ou créées dans l'appli depuis 7 jours) — bandeau superviseur.
export function watchNouvellesDemandes(callback) {
  return deriverDemandes("nouvelles", (liste) => {
    const depuis = Date.now() - 7 * 86400000, limiteDate = Date.now() - 10 * 86400000;
    return liste.filter(x => msDe(x.importeLe) >= depuis && !x.lieeA && !["Réalisé", "Annulé"].includes(x.statut)
        && !(x.dateDemande && new Date(x.dateDemande + "T00:00:00").getTime() < limiteDate))
      .map(x => ({ id: x.id, numero: x.numero, site: x.site, local: x.local, descriptif: x.descriptif, urgence: x.urgenceCorrigee || x.urgence, statut: x.statut, importeMs: msDe(x.importeLe), creeDansApp: !!x.creeDansApp, attribueANom: x.attribueANom || "", action: resumeAction(x) }))
      .sort((a, b) => b.importeMs - a.importeMs);
  }, callback);
}
// Demandes déclarées réalisées par les techniciens, en attente de validation.
export function watchDemandesAValider(callback) {
  return deriverDemandes("a-valider", (liste) => liste.filter(x => x.statut === "Réalisé – à valider" && !x.lieeA).length, callback);
}
// Actions IMMÉDIATES attribuées à une personne, pas encore faites (bandeau rouge de l'accueil).
export function watchActionsImmediates(uid, callback) {
  return deriverDemandes(`immediates:${uid}`, (liste) => liste.filter(x => x.actionPour === uid && x.actionImmediate && !x.actionFaiteLe && !x.lieeA)
    .map(x => ({ id: x.id, numero: x.numero, site: x.site, local: x.local, actionTexte: x.actionTexte, actionPar: x.actionPar })), callback);
}
// Actions à faire + retours non lus sur les actions que j'ai attribuées (badge de la tuile).
export function watchMesActionsDemandes(uid, callback) {
  return deriverDemandes(`mes-actions:${uid}`, (liste) => liste.filter(x => (x.actionPour === uid && !x.actionFaiteLe) || (x.actionParUid === uid && x.actionReponseNonLue)).length, callback);
}
export async function updateDemande(id, fields) {
  majLocale("demandes", id, { ...fields, dateMaj: Timestamp.now() }); // affichage immédiat, même hors ligne
  await updateDoc(doc(db, "demandes", id), { ...fields, dateMaj: serverTimestamp() });
}
export async function ajouterDemande(record) {
  await addDoc(collection(db, "demandes"), { ...record, dateMaj: serverTimestamp() });
}
export async function supprimerDemande(id) {
  await deleteDoc(doc(db, "demandes", id));
}

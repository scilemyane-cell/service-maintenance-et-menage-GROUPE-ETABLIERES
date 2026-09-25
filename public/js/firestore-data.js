import { db, auth } from "./firebase-init.js";
import {
  doc, getDoc, getDocs, setDoc, updateDoc,
  collection, addDoc, deleteDoc, onSnapshot, runTransaction, serverTimestamp, deleteField,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const DEFAULT_PEOPLE = { n1: ["Valentin", "Lionel"], n2: ["Technicien 1", "Technicien 2", "Technicien 3"] };

// ---- Personnes (N1 / N2) ----
export function watchPeople(callback) {
  const ref = doc(db, "config", "people");
  return onSnapshot(ref, (snap) => {
    callback(snap.exists() ? snap.data() : DEFAULT_PEOPLE);
  }, (err) => { console.error("watchPeople:", err); callback(DEFAULT_PEOPLE); });
}
export async function savePeople(people) {
  await setDoc(doc(db, "config", "people"), people);
}

// ---- Absences ----
export function watchAbsences(callback) {
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
export function watchRecurrences(callback) {
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
export function watchInterventions(callback) {
  return onSnapshot(collection(db, "interventions"), (snap) => {
    const list = [];
    snap.forEach((d) => { if (!d.data().supprimeLe) list.push({ id: d.id, ...d.data() }); });
    callback(list);
  }, (err) => { console.error("watchInterventions:", err); callback([]); });
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
  await addDoc(collection(db, "interventions"), { ...record, createdBy: auth.currentUser?.uid || record.createdBy, numero: `INT-${String(numero).padStart(5, "0")}` });
}
export async function updateIntervention(id, fields) {
  await updateDoc(doc(db, "interventions", id), fields);
}
// Suppression récupérable (corbeille, 60 jours) — remplace l'ancienne
// suppression directe et définitive, à l'origine d'une perte de données
// accidentelle sans aucun moyen de rattrapage.
export async function envoyerInterventionCorbeille(id) {
  await updateDoc(doc(db, "interventions", id), { supprimeLe: serverTimestamp() });
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
export function watchDemandes(callback) {
  return onSnapshot(collection(db, "demandes"), (snap) => {
    const list = [];
    snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
    callback(list);
  }, (err) => { console.error("watchDemandes:", err); callback([]); });
}
// Import initial (ou réimport) en masse depuis le fichier Excel — n'écrase
// pas les demandes déjà présentes (identifiées par leur `numero`) pour ne
// jamais perdre un traitement déjà fait par un technicien dans l'appli ;
// n'ajoute que les numéros absents de la base.
export async function importerDemandes(lignes) {
  const existant = await getDocs(collection(db, "demandes"));
  const numerosConnus = new Set();
  existant.forEach((d) => numerosConnus.add(d.data().numero));
  const aAjouter = lignes.filter((l) => !numerosConnus.has(l.numero));
  for (let i = 0; i < aAjouter.length; i += 450) {
    const lot = aAjouter.slice(i, i + 450);
    const batch = writeBatch(db);
    lot.forEach((l) => batch.set(doc(collection(db, "demandes")), { ...l, importeLe: serverTimestamp() }));
    await batch.commit();
  }
  return aAjouter.length;
}
export async function updateDemande(id, fields) {
  await updateDoc(doc(db, "demandes", id), { ...fields, dateMaj: serverTimestamp() });
}
export async function ajouterDemande(record) {
  await addDoc(collection(db, "demandes"), { ...record, dateMaj: serverTimestamp() });
}
export async function supprimerDemande(id) {
  await deleteDoc(doc(db, "demandes", id));
}

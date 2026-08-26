import { db } from "./firebase-init.js";
import {
  doc, getDoc, setDoc, updateDoc,
  collection, addDoc, deleteDoc, onSnapshot,
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
export async function deleteAbsence(id) {
  await deleteDoc(doc(db, "absences", id));
}

// ---- Interventions ----
export function watchInterventions(callback) {
  return onSnapshot(collection(db, "interventions"), (snap) => {
    const list = [];
    snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
    callback(list);
  }, (err) => { console.error("watchInterventions:", err); callback([]); });
}
export async function addIntervention(record) {
  await addDoc(collection(db, "interventions"), record);
}
export async function updateIntervention(id, fields) {
  await updateDoc(doc(db, "interventions", id), fields);
}
export async function deleteIntervention(id) {
  await deleteDoc(doc(db, "interventions", id));
}

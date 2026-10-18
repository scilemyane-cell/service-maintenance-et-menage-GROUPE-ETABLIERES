// cles-data.js — Gestion des clés et badges.
//  • « cles » : le trousseau (une fiche par clé/badge, rattachée à un site,
//    avec le nombre d'exemplaires et le compteur « sortis »).
//  • « cles-prets » : chaque sortie de clé.
//      - type "temporaire" : emprunt par QR code (tableau à clés), rendu le
//        jour même ou à une date maximale ; créé par la personne elle-même
//        depuis son téléphone (appareilUid = son identifiant d'appareil).
//      - type "longue" : remise longue durée, créée par un gestionnaire,
//        signée par la personne via un lien envoyé sur sa boîte mail pro
//        (l'identifiant du document = jeton secret du lien).
//  • « cles-appareils » : le téléphone reconnu (nom/prénom saisis une fois).
import { db } from "./firebase-init.js";
import { engagementTexte, VERSION_ENGAGEMENT } from "./cles-attestation.js";
import { collection, doc, addDoc, setDoc, updateDoc, getDoc, getDocs, onSnapshot, query, where, increment } from "./firestore-compte.js";

export const CLES = "cles", PRETS = "cles-prets", APPAREILS = "cles-appareils";
export const TYPES_CLE = ["Clé", "Badge", "Télécommande", "Trousseau"];

export function jeton(n = 28) {
  const a = new Uint8Array(n); crypto.getRandomValues(a);
  return Array.from(a, x => "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"[x % 57]).join("");
}
export const enRetard = (p) => p.statut !== "rendue" && p.retourMax && p.retourMax < Date.now();
export const disponibles = (c) => Math.max(0, (Number(c.exemplaires) || 1) - (Number(c.sortis) || 0));

// ---------- gestionnaire (onglet 🔑 Clés) ----------
export function watchCles(cb, onErr) {
  return onSnapshot(collection(db, CLES), s => cb(s.docs.map(d => ({ id: d.id, ...d.data() })).filter(c => !c.supprimeLe)), onErr);
}
export function watchPrets(cb, onErr) {
  return onSnapshot(collection(db, PRETS), s => cb(s.docs.map(d => ({ id: d.id, ...d.data() }))), onErr);
}
export const creerCle = (data) => addDoc(collection(db, CLES), { ...data, sortis: 0, creeLe: Date.now() });
export const modifierCle = (id, data) => updateDoc(doc(db, CLES, id), data);
export const supprimerCle = (id, par) => updateDoc(doc(db, CLES, id), { supprimeLe: Date.now(), supprimePar: par || "" });

export async function creerRemiseLongue({ cle, nom, email, retourMax, par, note, fonction = "", service = "", motif = "" }) {
  const t = jeton();
  await setDoc(doc(db, PRETS, t), {
    type: "longue", statut: "a-signer", cleId: cle.id, cleNom: cle.nom || "", cleRepere: cle.repere || "", cleType: cle.type || "Clé",
    siteId: cle.siteId || "", siteNom: cle.siteNom || "", personneNom: nom, personneEmail: email, note: note || "",
    personneFonction: fonction, personneService: service, motif, engagement: engagementTexte(cle.type || "Clé"), engagementVersion: VERSION_ENGAGEMENT,
    sortieLe: Date.now(), creeLe: Date.now(), retourMax: retourMax || null, creePar: par || "", appareilUid: "",
  });
  await updateDoc(doc(db, CLES, cle.id), { sortis: increment(1) });
  return t;
}
export async function enregistrerRetour(p, par) {
  await updateDoc(doc(db, PRETS, p.id), { statut: "rendue", retourLe: Date.now(), retourPar: par || "" });
  if (p.cleId) await updateDoc(doc(db, CLES, p.cleId), { sortis: increment(-1) }).catch(() => {});
}
export const modifierPret = (id, data) => updateDoc(doc(db, PRETS, id), data);

// ---------- téléphone qui scanne le QR (page cles.html) ----------
export async function lireAppareil(uid) { const s = await getDoc(doc(db, APPAREILS, uid)); return s.exists() ? s.data() : null; }
export const enregistrerAppareil = (uid, data) => setDoc(doc(db, APPAREILS, uid), { ...data, vuLe: Date.now() }, { merge: true });
export async function clesDuSite(siteId) {
  const q = siteId ? query(collection(db, CLES), where("siteId", "==", siteId)) : collection(db, CLES);
  const s = await getDocs(q);
  return s.docs.map(d => ({ id: d.id, ...d.data() })).filter(c => !c.supprimeLe && c.pretable !== false);
}
export async function mesPrets(uid) {
  const s = await getDocs(query(collection(db, PRETS), where("appareilUid", "==", uid)));
  return s.docs.map(d => ({ id: d.id, ...d.data() }));
}
export async function emprunter({ uid, cle, nom, retourMax, pretePour = "" }) {
  await addDoc(collection(db, PRETS), {
    type: "temporaire", statut: "en-cours", appareilUid: uid, cleId: cle.id, cleNom: cle.nom || "", cleRepere: cle.repere || "", cleType: cle.type || "Clé",
    siteId: cle.siteId || "", siteNom: cle.siteNom || "", personneNom: nom, personneEmail: "", pretePour: pretePour || "", sortieLe: Date.now(), retourMax: retourMax || null,
  });
  await updateDoc(doc(db, CLES, cle.id), { sortis: increment(1) });
}
export async function rendre(p, nom) {
  await updateDoc(doc(db, PRETS, p.id), { statut: "rendue", retourLe: Date.now(), retourPar: nom || "" });
  if (p.cleId) await updateDoc(doc(db, CLES, p.cleId), { sortis: increment(-1) }).catch(() => {});
}

// ---------- signature d'une remise longue durée (page cle-signature.html) ----------
export async function lirePret(t) { const s = await getDoc(doc(db, PRETS, t)); return s.exists() ? { id: s.id, ...s.data() } : null; }
export const signer = (t, { signature, nom, uid, signeLe, preuve }) => updateDoc(doc(db, PRETS, t), { statut: "en-cours", signature, signeLe: signeLe || Date.now(), signeNom: nom, signeAppareil: uid || "", preuve: preuve || {} });

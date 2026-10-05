// astreinte-membres.js — Une personne du roulement d'astreinte (N1/N2) doit
// voir et compléter ses interventions quel que soit son rôle dans l'appli
// (ex. un agent d'entretien qui fait aussi l'astreinte N2).
import { watchPeople } from "./firestore-data.js";
import { watchCoordonnees } from "./coordonnees-data.js";

let people = null, coord = {}, demarre = false;
const abonnes = new Set();
const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export function suivreMembresAstreinte(cb) {
  if (cb) abonnes.add(cb);
  if (demarre) return;
  demarre = true;
  watchPeople((p) => { people = p; abonnes.forEach(f => { try { f(); } catch (e) { console.error(e); } }); });
  watchCoordonnees((c) => { coord = c || {}; abonnes.forEach(f => { try { f(); } catch (e) { console.error(e); } }); });
}

// Nom de la personne du planning reliée au compte, si elle est dans le roulement.
export function personneAstreinte(user) {
  if (!user || !people) return null;
  const toutes = [...new Set([...(people.n1 || []), ...(people.n2 || [])])];
  const lie = Object.entries(coord || {}).find(([, c]) => c && c.uid && c.uid === user.uid);
  if (lie && toutes.includes(lie[0])) return lie[0];
  const cibles = [user.nomPlanning, user.nom, (user.email || "").split("@")[0]].filter(Boolean).map(norm);
  const prenom = norm(user.nom).split(/\s+/)[0];
  return toutes.find(p => cibles.includes(norm(p))) || toutes.find(p => prenom && norm(p).split(/\s+/)[0] === prenom) || null;
}

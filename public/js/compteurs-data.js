// compteurs-data.js
// Relevés de compteurs (eau, gaz, électricité) par site — nouvel onglet
// indépendant "Relevé compteur". Un compteur électrique porte 4 index
// tarifaires pour les bâtiments tertiaires en Tarif Vert/Contrat Flexible :
// HPSH (Heures Pleines Saison Haute), HCSH (Heures Creuses Saison Haute),
// HPSB (Heures Pleines Saison Basse), HCSB (Heures Creuses Saison Basse)
// — à relever ensemble à chaque passage, avec une seule photo du tableau.
// Un compteur eau/gaz n'a qu'un seul index.

import { db } from "./firebase-init.js";
import {
  doc, addDoc, updateDoc, getDoc, getDocs, onSnapshot, deleteDoc, serverTimestamp, deleteField,
  collection, query, where,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { getDossierUnique, saveDossier } from "./site-dossier-data.js";

const COMPTEURS = "compteurs";
const RELEVES = "compteurs-releves";

// 4 index tarifaires pour l'électricité (Tarif Vert/Contrat Flexible,
// bâtiments tertiaires à forte puissance souscrite) — "120/121/122/123"
// sont les codes affichés directement sur l'écran du compteur, et
// correspondent aux 4 périodes tarifaires Saison Haute (nov-mars) /
// Saison Basse (avr-oct) x Heures Pleines / Heures Creuses :
// HPSH, HCSH, HPSB, HCSB (terminologie RTE/EDF officielle pour ce type
// de contrat — vérifiée le 15/09/2026, à ne pas confondre avec
// HPH/HCH/HPE/HCE qui est la terminologie d'un autre type de contrat).
export const INDEX_ELEC = ["120", "121", "122", "123"];
export const INDEX_LABELS = {
  "120": "HPSH — Heures Pleines Saison Haute", "121": "HCSH — Heures Creuses Saison Haute",
  "122": "HPSB — Heures Pleines Saison Basse", "123": "HCSB — Heures Creuses Saison Basse",
};
export const MOIS_LABELS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];

// Clés d'index à relever (et donc à photographier) selon le compteur —
// une seule pour eau/gaz/chauffage urbain ; pour l'électricité, 1 seule
// (compteur "base", mono-index) ou les 4 index tarifaires (multi-tarif),
// selon le champ nbIndex choisi à la création de CE compteur (certains
// sites n'ont qu'un simple compteur de base, d'autres un tarif Jaune/Vert
// à 4 index, d'autres encore des index qui ne suivent aucune convention
// standard connue — d'où l'option "custom", voir indexPersonnalises).
export function clesIndex(compteur) {
  if (compteur.type === "elec" && compteur.nbIndex === "custom") {
    const liste = compteur.indexPersonnalises || [];
    return liste.length > 0 ? liste.map(i => i.cle) : ["valeur"];
  }
  if (compteur.type === "elec" && (compteur.nbIndex || 4) === 1) return ["valeur"];
  if (compteur.type === "elec") return INDEX_ELEC;
  return ["valeur"];
}

// Intitulé à afficher pour un index donné — celui personnalisé par le
// site s'il y en a un (compteur à index "custom"), sinon la convention
// standard HPSH/HCSH/HPSB/HCSB, sinon rien (index sans nom particulier).
export function libelleIndex(compteur, cle) {
  if (compteur.nbIndex === "custom") {
    const trouve = (compteur.indexPersonnalises || []).find(i => i.cle === cle);
    return trouve?.label || "";
  }
  return INDEX_LABELS[cle] || "";
}

// Unité affichée pour la valeur relevée — kWh pour l'électricité et le
// chauffage urbain (facturé à l'énergie livrée), m³ pour l'eau et le gaz.
export function uniteValeur(compteur) {
  if (compteur.type === "elec" || compteur.type === "chauffage") return "kWh";
  return "m³";
}

export function nouveauCompteur(type) {
  const noms = {
    elec: "Tableau électrique", eau: "Compteur d'eau",
    gaz: "Compteur de gaz", chauffage: "Compteur de chauffage urbain",
  };
  return {
    type, // "eau" | "gaz" | "chauffage" | "elec"
    nom: noms[type] || "Compteur",
    nbIndex: type === "elec" ? 4 : 1, // pour l'élec uniquement : 1 (base) ou 4 (multi-tarif) — sans effet pour les autres types
    emplacement: "",
    emplacementAuto: true, // voir synchroniserEmplacementsCompteurs() : tant que vrai, l'emplacement suit automatiquement l'équipement correspondant du dossier de site
    frequence: "mensuel", // "mensuel" | "annuel"
    echeanceJour: 1,      // pour "annuel" uniquement : jour/mois de l'échéance chaque année
    echeanceMois: 1,
    supprimeLe: null,
    dernierReleve: null, // { at, valeurs, releveParNom } — mis en cache pour affichage rapide
  };
}

// Cherche, parmi les équipements d'un dossier de site, celui qui
// correspond le mieux à un type de compteur — utilisé à la fois pour
// suggérer nom/emplacement à la création (voir compteurs.js) et pour les
// tenir à jour automatiquement par la suite (voir
// synchroniserEmplacementsCompteurs ci-dessous). Priorité à un intitulé
// contenant à la fois "compteur" et le mot du type ; à défaut, un
// intitulé contenant juste le mot du type.
export function trouverSectionPourType(sections, type) {
  const motsType = {
    eau: ["eau"], gaz: ["gaz"], elec: ["électri", "electri", "linky"],
    chauffage: ["chauffage", "urbain", "cpcu", "sous-station", "sous station"],
  }[type] || [];
  const contientMotType = (titre) => motsType.some(m => titre.includes(m));
  let match = (sections || []).find(s => {
    const t = (s.titre || "").toLowerCase();
    return t.includes("compteur") && contientMotType(t);
  });
  if (!match) match = (sections || []).find(s => contientMotType((s.titre || "").toLowerCase()));
  return match || null;
}

// À appeler après l'enregistrement d'un dossier de site (voir
// site-dossier.js) : si un compteur a été créé avant que la fiche du
// dossier ne soit complétée (ou que son emplacement n'ait jamais été
// personnalisé manuellement), met à jour son emplacement pour qu'il
// reprenne celui — désormais renseigné ou modifié — de l'équipement
// correspondant. Ne touche jamais un compteur dont l'emplacement a été
// modifié à la main (emplacementAuto === false).
export async function synchroniserEmplacementsCompteurs(dossierId, sections) {
  const q = query(collection(db, COMPTEURS), where("dossierId", "==", dossierId));
  const snap = await getDocs(q);
  for (const d of snap.docs) {
    const c = d.data();
    if (c.supprimeLe || c.emplacementAuto === false) continue;
    const match = trouverSectionPourType(sections, c.type);
    const nouvelEmplacement = match?.emplacement || "";
    if (nouvelEmplacement && nouvelEmplacement !== c.emplacement) {
      await updateDoc(doc(db, COMPTEURS, d.id), { emplacement: nouvelEmplacement });
    }
  }
}

const TITRE_SECTION_PAR_TYPE = {
  eau: "Compteur d'eau", gaz: "Compteur de gaz",
  elec: "Compteur électrique (Linky)", chauffage: "Compteur de chauffage urbain",
};

// À appeler juste après la création d'un nouveau compteur (voir
// compteurs.js) : si le dossier de site de ce compteur n'a encore aucun
// équipement correspondant au type créé (eau/gaz/élec/chauffage), en
// ajoute un automatiquement — coché "Concerné" — à la liste des
// équipements & organes techniques du dossier, pour que le compteur
// apparaisse aussi là-bas sans ressaisie manuelle. Ne fait rien si une
// section correspondante existe déjà (pour ne jamais créer de doublon).
export async function creerSectionDossierPourCompteur(dossierId, type, nomCompteur) {
  if (!dossierId) return false;
  const dossier = await getDossierUnique(dossierId);
  if (!dossier) return false;
  const sections = dossier.sections || [];
  if (trouverSectionPourType(sections, type)) return false; // déjà couvert, rien à faire
  const nouvellesSections = [
    ...sections,
    { titre: nomCompteur || TITRE_SECTION_PAR_TYPE[type] || "Compteur", concerne: true, emplacement: "", procedure: "", photos: [] },
  ];
  await saveDossier(dossierId, { ...dossier, sections: nouvellesSections });
  return true;
}

const JOURS_TOLERANCE_MENSUEL = 32; // au-delà, un relevé mensuel est considéré "en retard"

// Date de la dernière échéance déjà passée pour un compteur "annuel" (le
// jour/mois configuré, cette année s'il est déjà passé, sinon l'an
// dernier). Sert de référence : si le dernier relevé est antérieur à
// cette date, l'échéance la plus récente n'a pas été honorée.
function derniereEcheanceAnnuelle(compteur) {
  const now = new Date();
  const jour = compteur.echeanceJour || 1;
  const mois = (compteur.echeanceMois || 1) - 1; // Date() : mois 0-indexé
  let echeance = new Date(now.getFullYear(), mois, jour);
  if (echeance > now) echeance = new Date(now.getFullYear() - 1, mois, jour);
  return echeance;
}

// Un compteur est "en retard" si :
// - fréquence mensuelle : aucun relevé depuis plus de ~32 jours ;
// - fréquence annuelle : l'échéance (jour/mois) la plus récente est
//   passée sans qu'un relevé n'ait été fait depuis.
export function estEnRetard(compteur) {
  if (compteur.frequence === "annuel") {
    if (!compteur.dernierReleve?.at) return true;
    return compteur.dernierReleve.at < derniereEcheanceAnnuelle(compteur).getTime();
  }
  if (!compteur.dernierReleve?.at) return true;
  return (Date.now() - compteur.dernierReleve.at) > JOURS_TOLERANCE_MENSUEL * 24 * 3600 * 1000;
}

export function prochaineEcheanceLabel(compteur) {
  if (compteur.frequence === "annuel") {
    return `chaque année le ${String(compteur.echeanceJour || 1).padStart(2, "0")}/${String(compteur.echeanceMois || 1).padStart(2, "0")}`;
  }
  return "tous les mois";
}

// Liste ponctuelle des dossiers de site ayant les compteurs activés —
// utilisée par l'écran principal du nouvel onglet.
export async function listerSitesAvecCompteurs() {
  const q = query(collection(db, "sites-dossiers"), where("compteursActifs", "==", true));
  const snap = await getDocs(q);
  const list = [];
  snap.forEach((d) => {
    if (!d.data().supprimeLe) list.push({ id: d.id, nom: d.data().nom, association: d.data().association || "", groupe: d.data().groupe || "" });
  });
  return list.sort((a, b) => (a.nom || "").localeCompare(b.nom || ""));
}

// Liste ponctuelle de tous les compteurs, tous sites confondus.
export async function listerTousLesCompteurs() {
  const snap = await getDocs(collection(db, COMPTEURS));
  const list = [];
  snap.forEach((d) => { if (!d.data().supprimeLe) list.push({ id: d.id, ...d.data() }); });
  return list;
}

export async function creerCompteur(dossierId, dossierNom, compteur) {
  const ref = await addDoc(collection(db, COMPTEURS), { dossierId, dossierNom, ...compteur });
  return ref.id;
}

export async function modifierCompteur(id, fields) {
  await updateDoc(doc(db, COMPTEURS, id), fields);
}

export async function envoyerCompteurCorbeille(id) {
  await updateDoc(doc(db, COMPTEURS, id), { supprimeLe: serverTimestamp() });
}

// Liste ponctuelle des compteurs actuellement à la corbeille — utilisée
// par l'écran Administration > Corbeille.
export async function listerCompteursCorbeille() {
  const snap = await getDocs(collection(db, COMPTEURS));
  const list = [];
  snap.forEach((d) => { if (d.data().supprimeLe) list.push({ id: d.id, nom: d.data().nom, dossierNom: d.data().dossierNom, supprimeLe: d.data().supprimeLe }); });
  return list;
}

export async function restaurerCompteur(id) {
  await updateDoc(doc(db, COMPTEURS, id), { supprimeLe: deleteField() });
}

// Suppression définitive et irréversible : le compteur ET tout son
// historique de relevés associé (sinon des relevés orphelins, sans
// compteur correspondant, resteraient indéfiniment dans la base).
export async function purgerCompteurDefinitivement(id) {
  const q = query(collection(db, RELEVES), where("compteurId", "==", id));
  const snap = await getDocs(q);
  await Promise.all(snap.docs.map((d) => deleteDoc(doc(db, RELEVES, d.id))));
  await deleteDoc(doc(db, COMPTEURS, id));
}

// Un seul compteur, pour le lien direct par QR (ouvre l'écran de relevé
// sans avoir à charger toute la liste des sites).
export async function getCompteurUnique(id) {
  const snap = await getDoc(doc(db, COMPTEURS, id));
  if (!snap.exists() || snap.data().supprimeLe) return null;
  return { id: snap.id, ...snap.data() };
}

// Enregistre un relevé (historique) et met à jour le cache "dernier
// relevé" sur le compteur lui-même, pour un affichage rapide sans avoir
// à interroger l'historique à chaque fois. `photos` est un objet avec
// les mêmes clés que `valeurs` (HPSH/HCSH/HPSB/HCSB pour l'électricité,
// "valeur" pour eau/gaz) — une photo par index relevé, l'écran d'un
// compteur multi-tarif n'affichant souvent qu'un seul index à la fois.
// `dateAntidatee` (optionnel, en ms) permet à un superviseur/admin de
// saisir un relevé à une date passée (ex. oublié la semaine dernière) —
// réservé aux éditeurs côté interface ET côté règles Firestore, un
// technicien ne pouvant enregistrer qu'à la date/heure du moment.
export async function enregistrerReleve(compteur, valeurs, photos, user, dateAntidatee = null, illisibles = {}) {
  const at = dateAntidatee || Date.now();
  await addDoc(collection(db, RELEVES), {
    compteurId: compteur.id,
    dossierId: compteur.dossierId,
    dossierNom: compteur.dossierNom,
    type: compteur.type,
    nomCompteur: compteur.nom,
    valeurs,
    illisibles, // { [clé]: true } — index relevé comme illisible (buée, cadran cassé…) plutôt qu'une vraie valeur
    photos, // { [clé]: { itemId, name } }
    releveParUid: user?.uid || null,
    releveParNom: user?.nom || user?.email || "Inconnu",
    createdAt: at,
    saisiHorsDate: !!dateAntidatee,
  });
  await updateDoc(doc(db, COMPTEURS, compteur.id), {
    dernierReleve: {
      at, valeurs, photos, illisibles,
      releveParNom: user?.nom || user?.email || "Inconnu",
    },
  });
}

// Historique complet d'un compteur, du plus récent au plus ancien.
export async function listerHistoriqueCompteur(compteurId) {
  const q = query(collection(db, RELEVES), where("compteurId", "==", compteurId));
  const snap = await getDocs(q);
  const list = [];
  snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
  return list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

// Supprime UN relevé individuel de l'historique (ex. essai/test) —
// réservé au Super Admin par les règles Firestore, l'historique n'étant
// normalement jamais modifiable (intégrité). Si le relevé supprimé était
// le plus récent, recalcule et remet à jour le cache "dernierReleve" du
// compteur à partir de ce qu'il reste, pour ne pas laisser un affichage
// périmé sur la liste/l'historique.
export async function supprimerReleve(compteurId, releveId) {
  await deleteDoc(doc(db, RELEVES, releveId));
  const restant = await listerHistoriqueCompteur(compteurId); // déjà trié du plus récent au plus ancien
  const dernier = restant[0];
  await updateDoc(doc(db, COMPTEURS, compteurId), {
    dernierReleve: dernier ? { at: dernier.createdAt, valeurs: dernier.valeurs, photos: dernier.photos || null, releveParNom: dernier.releveParNom } : null,
  });
}

// Écart entre deux relevés, index par index (utilisé pour "+142 m³
// depuis le dernier relevé" et pour la détection d'anomalie). Renvoie
// null pour un index si l'une des deux valeurs est absente/invalide, ou
// si le résultat est négatif (compteur qui recule — traité séparément
// comme anomalie, pas comme une consommation).
export function calculerEcarts(valeursRecentes, valeursPrecedentes) {
  if (!valeursPrecedentes) return null;
  const ecarts = {};
  for (const cle of Object.keys(valeursRecentes)) {
    const recent = parseFloat(valeursRecentes[cle]);
    const precedent = parseFloat(valeursPrecedentes[cle]);
    if (isNaN(recent) || isNaN(precedent)) { ecarts[cle] = null; continue; }
    ecarts[cle] = recent - precedent;
  }
  return ecarts;
}

// Repère les anomalies avant l'enregistrement d'un relevé : valeur en
// baisse (impossible sur un compteur cumulatif, sauf remplacement du
// compteur) ou hausse anormalement plus forte que la moyenne récente
// (fuite, dérive...). `historiqueRecent` = quelques derniers relevés
// (du plus récent au plus ancien, voir listerHistoriqueCompteur), utilisé
// pour établir une moyenne de référence. Renvoie un tableau de messages
// (vide = rien d'anormal détecté).
export function detecterAnomalies(compteur, nouvellesValeurs, historiqueRecent = []) {
  const messages = [];
  const cles = clesIndex(compteur);
  const derniereValeur = compteur.dernierReleve?.valeurs;

  for (const cle of cles) {
    const nouvelle = parseFloat(nouvellesValeurs[cle]);
    if (isNaN(nouvelle)) continue;
    const precedente = derniereValeur ? parseFloat(derniereValeur[cle]) : null;
    if (precedente !== null && !isNaN(precedente)) {
      if (nouvelle < precedente) {
        messages.push(`${cle !== "valeur" ? cle + " : " : ""}la nouvelle valeur (${nouvelle}) est inférieure au dernier relevé (${precedente}) — normalement impossible sauf remplacement du compteur.`);
        continue; // pas la peine de comparer à la moyenne si déjà signalé en baisse
      }
      const ecartActuel = nouvelle - precedente;
      // Moyenne des écarts sur l'historique récent (au moins 2 relevés
      // nécessaires pour établir une référence)
      const valeursHist = historiqueRecent.map(r => parseFloat(r.valeurs?.[cle])).filter(v => !isNaN(v));
      if (valeursHist.length >= 2) {
        const ecarts = [];
        for (let i = 0; i < valeursHist.length - 1; i++) ecarts.push(valeursHist[i] - valeursHist[i + 1]);
        const ecartsPositifs = ecarts.filter(e => e > 0);
        if (ecartsPositifs.length > 0) {
          const moyenne = ecartsPositifs.reduce((a, b) => a + b, 0) / ecartsPositifs.length;
          if (moyenne > 0 && ecartActuel > moyenne * 2.5 && ecartActuel > moyenne + 5) {
            messages.push(`${cle !== "valeur" ? cle + " : " : ""}hausse de ${ecartActuel.toFixed(2)} depuis le dernier relevé, contre une moyenne habituelle de ${moyenne.toFixed(2)} — vérifie une fuite ou une erreur de saisie.`);
          }
        }
      }
    }
  }
  return messages;
}

// QR encodant un lien direct vers l'écran de relevé de ce compteur —
// scanné avec l'appareil photo normal du téléphone (hors appli), ça
// ouvre directement le bon formulaire.
export function qrPayloadForCompteur(compteurId) {
  return `https://service-maintenance-et-menage.web.app/app.html?compteurrelever=${compteurId}`;
}

// Nombre de compteurs "en retard", tous sites confondus — flux temps
// réel utilisé pour le badge de la tuile "Relevé compteur" sur l'écran
// d'accueil, sans avoir à ouvrir l'onglet.
export function watchCompteursAlertCount(callback) {
  return onSnapshot(collection(db, COMPTEURS), (snap) => {
    let n = 0;
    snap.forEach((d) => {
      const c = d.data();
      if (!c.supprimeLe && estEnRetard(c)) n++;
    });
    callback(n);
  }, (err) => { console.error("watchCompteursAlertCount:", err); callback(0); });
}

// Consommation par mois calendaire sur les N derniers mois (12 par
// défaut), pour un index donné — utilisée pour le graphique en bâtons
// (préféré à une courbe brute des index). Pour chaque mois, on prend la
// dernière valeur connue avant la fin du mois moins la dernière valeur
// connue avant son début ; un mois sans donnée suffisante renvoie null
// plutôt que 0 (pour ne pas laisser croire à une consommation nulle).
// Historique complet, tous compteurs confondus — pour le tableau de
// bord global (consommation agrégée par type, comparaison entre sites).
// Un seul aller-retour Firestore plutôt qu'une requête par compteur.
export async function listerTousLesReleves() {
  const snap = await getDocs(collection(db, RELEVES));
  const list = [];
  snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
  return list;
}

// Valeur totale d'un compteur (somme de tous ses index — utile pour un
// compteur électrique multi-tarif où la "consommation" globale est la
// somme des 4 index) à un instant donné, à partir de son historique
// trié chronologiquement. Renvoie null si aucun relevé chiffré avant
// cet instant (un relevé entièrement "illisible" ne compte pas).
function valeurTotaleAvant(relevesChrono, cles, ms) {
  let derniere = null;
  for (const r of relevesChrono) {
    if ((r.createdAt || 0) >= ms) break;
    let total = 0, ok = false;
    cles.forEach(k => { const v = parseFloat(r.valeurs?.[k]); if (!isNaN(v)) { total += v; ok = true; } });
    if (ok) derniere = total;
  }
  return derniere;
}

// Consommation mensuelle agrégée sur les N derniers mois, additionnée
// sur tous les compteurs d'un même type (ex. tous les compteurs d'eau
// du groupe) — même principe que consommationMensuelle() mais toutes
// installations confondues, pour une vue d'ensemble plutôt que
// compteur par compteur.
export function consommationMensuelleAgregee(compteurs, tousReleves, nbMois = 12) {
  const maintenant = new Date();
  const mois = [];
  for (let i = nbMois - 1; i >= 0; i--) {
    mois.push({
      debut: new Date(maintenant.getFullYear(), maintenant.getMonth() - i, 1),
      fin: new Date(maintenant.getFullYear(), maintenant.getMonth() - i + 1, 1),
      label: new Date(maintenant.getFullYear(), maintenant.getMonth() - i, 1).toLocaleDateString("fr-FR", { month: "short", year: "2-digit" }),
    });
  }
  const totaux = mois.map(() => 0);
  const compteursAvecDonnees = mois.map(() => 0); // pour ne pas laisser croire à 0 si aucun compteur n'a de données ce mois-là
  compteurs.forEach(compteur => {
    const cles = clesIndex(compteur);
    const relevesChrono = tousReleves.filter(r => r.compteurId === compteur.id).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    if (relevesChrono.length === 0) return;
    mois.forEach((m, i) => {
      const avant = valeurTotaleAvant(relevesChrono, cles, m.debut.getTime());
      const apres = valeurTotaleAvant(relevesChrono, cles, m.fin.getTime());
      if (avant !== null && apres !== null) {
        totaux[i] += Math.max(0, apres - avant);
        compteursAvecDonnees[i]++;
      }
    });
  });
  return { labels: mois.map(m => m.label), valeurs: totaux.map((v, i) => compteursAvecDonnees[i] > 0 ? v : null) };
}

// Consommation totale d'un compteur sur les derniers `jours` jours
// (ex. 30, 365) — pour classer les sites les plus consommateurs.
// Renvoie null si l'historique ne couvre pas assez loin pour comparer.
export function consommationRecente(compteur, tousReleves, jours) {
  const cles = clesIndex(compteur);
  const relevesChrono = tousReleves.filter(r => r.compteurId === compteur.id).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  if (relevesChrono.length === 0) return null;
  const maintenant = Date.now();
  const avant = valeurTotaleAvant(relevesChrono, cles, maintenant - jours * 24 * 3600 * 1000);
  const apres = valeurTotaleAvant(relevesChrono, cles, maintenant + 1);
  if (avant === null || apres === null) return null;
  return Math.max(0, apres - avant);
}

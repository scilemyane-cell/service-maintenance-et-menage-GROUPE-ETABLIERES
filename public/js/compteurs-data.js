// compteurs-data.js
// Relevés de compteurs (eau, gaz, électricité) par site — nouvel onglet
// indépendant "Relevé compteur". Un compteur électrique porte 4 index
// tarifaires standards pour les bâtiments tertiaires en Tarif Jaune/Vert :
// HPH (Heures Pleines Hiver), HCH (Heures Creuses Hiver), HPE (Heures
// Pleines Été), HCE (Heures Creuses Été) — à relever ensemble à chaque
// passage, avec une seule photo du tableau. Un compteur eau/gaz n'a
// qu'un seul index.

import { db } from "./firebase-init.js";
import {
  doc, addDoc, updateDoc, getDoc, getDocs, onSnapshot,
  collection, query, where,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const COMPTEURS = "compteurs";
const RELEVES = "compteurs-releves";

// 4 index tarifaires pour l'électricité (Tarif Jaune/Vert, bâtiments
// tertiaires) — "120/121/122/123" sont les codes affichés directement
// sur l'écran du compteur (l'équivalent des libellés HPH/HCH/HPE/HCE),
// pas une donnée différente : ce sont juste deux façons de nommer les
// mêmes 4 périodes tarifaires.
export const INDEX_ELEC = ["120", "121", "122", "123"];
export const INDEX_LABELS = {
  "120": "HPH — Heures Pleines Hiver", "121": "HCH — Heures Creuses Hiver",
  "122": "HPE — Heures Pleines Été", "123": "HCE — Heures Creuses Été",
};
export const MOIS_LABELS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];

// Clés d'index à relever (et donc à photographier) selon le compteur —
// une seule pour eau/gaz/chauffage urbain ; pour l'électricité, 1 seule
// (compteur "base", mono-index) ou les 4 index tarifaires (multi-tarif),
// selon le champ nbIndex choisi à la création de CE compteur (certains
// sites n'ont qu'un simple compteur de base, d'autres un tarif Jaune/Vert
// à 4 index — ce n'est pas systématique).
export function clesIndex(compteur) {
  if (compteur.type === "elec" && (compteur.nbIndex || 4) === 1) return ["valeur"];
  if (compteur.type === "elec") return INDEX_ELEC;
  return ["valeur"];
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
  await updateDoc(doc(db, COMPTEURS, id), { supprimeLe: Date.now() });
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
// les mêmes clés que `valeurs` (HPH/HCH/HPE/HCE pour l'électricité,
// "valeur" pour eau/gaz) — une photo par index relevé, l'écran d'un
// compteur multi-tarif n'affichant souvent qu'un seul index à la fois.
// `dateAntidatee` (optionnel, en ms) permet à un superviseur/admin de
// saisir un relevé à une date passée (ex. oublié la semaine dernière) —
// réservé aux éditeurs côté interface ET côté règles Firestore, un
// technicien ne pouvant enregistrer qu'à la date/heure du moment.
export async function enregistrerReleve(compteur, valeurs, photos, user, dateAntidatee = null) {
  const at = dateAntidatee || Date.now();
  await addDoc(collection(db, RELEVES), {
    compteurId: compteur.id,
    dossierId: compteur.dossierId,
    dossierNom: compteur.dossierNom,
    type: compteur.type,
    nomCompteur: compteur.nom,
    valeurs,
    photos, // { [clé]: { itemId, name } }
    releveParUid: user?.uid || null,
    releveParNom: user?.nom || user?.email || "Inconnu",
    createdAt: at,
    saisiHorsDate: !!dateAntidatee,
  });
  await updateDoc(doc(db, COMPTEURS, compteur.id), {
    dernierReleve: {
      at, valeurs, photos,
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
export function consommationMensuelle(releves, cle, nbMois = 12) {
  const chrono = [...releves].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const valeurAvant = (ms) => {
    let derniere = null;
    for (const r of chrono) {
      if ((r.createdAt || 0) >= ms) break;
      const v = parseFloat(r.valeurs?.[cle]);
      if (!isNaN(v)) derniere = v;
    }
    return derniere;
  };

  const maintenant = new Date();
  const mois = [];
  for (let i = nbMois - 1; i >= 0; i--) {
    const debut = new Date(maintenant.getFullYear(), maintenant.getMonth() - i, 1);
    const fin = new Date(maintenant.getFullYear(), maintenant.getMonth() - i + 1, 1);
    const avant = valeurAvant(debut.getTime());
    const apres = valeurAvant(fin.getTime());
    const conso = (avant !== null && apres !== null) ? Math.max(0, apres - avant) : null;
    mois.push({ label: debut.toLocaleDateString("fr-FR", { month: "short", year: "2-digit" }), valeur: conso });
  }
  return mois;
}

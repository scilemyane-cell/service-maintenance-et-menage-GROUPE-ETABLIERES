// camileia-demandes.js — Traduction d'une DI Camileia en « demande » au format
// de l'appli (mêmes champs que l'import de l'Excel, cf. demandes-sharepoint.js).
// Fonctions pures, sans appel réseau ni Firestore.
import { iriDe, libelleDe } from "./camileia.js";

const sa = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const txt = (v) => (v == null ? "" : String(v).replace(/\s+/g, " ").trim());
const jour = (v) => (v && /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? String(v).slice(0, 10) : "");

// Statuts de l'appli (ceux de l'Excel).
export const STATUTS_SMM = ["Non renseigné", "Pris en compte", "Demande de devis", "Planifié", "Intervenant sollicité", "Commande en cours", "En attente de date d'intervention", "Arbitrage budgétaire", "Réalisé", "Annulé", "Autre"];

// Proposition automatique état Camileia → statut appli (corrigeable à l'écran).
export function statutPropose(libelleEtat) {
  const t = sa(libelleEtat);
  if (!t) return "";
  if (/annul|refus|rejet/.test(t)) return "Annulé";
  if (/clotur|termin|realis|resolu|fait\b|solde/.test(t)) return "Réalisé";
  if (/devis/.test(t)) return "Demande de devis";
  if (/commande/.test(t)) return "Commande en cours";
  if (/planif/.test(t)) return "Planifié";
  if (/arbitrage|budget/.test(t)) return "Arbitrage budgétaire";
  if (/sollicit|affect|transmis/.test(t)) return "Intervenant sollicité";
  if (/attente/.test(t)) return "En attente de date d'intervention";
  if (/pris|prise en charge|en cours|valid/.test(t)) return "Pris en compte";
  if (/nouve|ouvert|cree|saisi|a traiter/.test(t)) return "Non renseigné";
  return "";
}
// Priorité Camileia → urgence de l'appli (même logique que l'Excel).
export function urgenceDepuisPriorite(libelle) {
  const t = sa(libelle);
  if (!t) return "Non renseignée";
  if (/critique|immediat|tres urgent/.test(t)) return "Critique";
  if (/urgen|haute|elevee/.test(t)) return "Urgent";
  if (/planif|basse|faible/.test(t)) return "À planifier";
  if (/normal|moyenne/.test(t)) return "Normal";
  return "Non renseignée";
}

// libelles : Map IRI → libellé (référentiels + lieux résolus).
// correspondances : { iriEtat: statutAppli } (choix enregistrés à l'écran).
export function diVersDemande(di, { libelles = new Map(), correspondances = {} } = {}) {
  const lib = (v) => libelleDe(v) || libelles.get(iriDe(v)) || "";
  const iriEtat = iriDe(di.etat);
  const libEtat = lib(di.etat);
  const statut = correspondances[iriEtat] || statutPropose(libEtat) || "Non renseigné";
  const site = lib(di.site), batiment = lib(di.batiment), local = lib(di.local), zone = lib(di.zone);
  const descr = [txt(di.libelle), txt(di.note)].filter(Boolean).join(" — ");
  return {
    numero: txt(di.numero) || `CAM-${di.id}`,
    camileiaId: di.id ?? null,
    camileiaIri: iriDe(di) || (di.id != null ? `/api-platform/d_is/${di.id}` : ""),
    camileiaEtat: libEtat,
    camileiaEtatIri: iriEtat,
    dateDemande: jour(di.dateouverture),
    site: site || "Non renseigné",
    local: [batiment, zone, local].filter(Boolean).join(" · "),
    type: lib(di.typepanne) || lib(di.type),
    descriptif: descr,
    urgence: urgenceDepuisPriorite(lib(di.priorite)),
    statut,
    demandeur: txt(di.demandeur),
    dateIntervention: jour(di.dateintervention) || jour(di.dateinterventionplanifiee),
    dateStatut: jour(di.datecloture) || jour(di.dateprisencharge),
    // Lieux restés en IRI (libellé non lisible par ce compte API) : signalés.
    lieuxNonResolus: [di.site, di.batiment, di.local].filter(v => iriDe(v) && !lib(v)).map(iriDe),
  };
}

// Rapprochement DI ↔ demandes déjà dans l'appli : par ID Camileia d'abord,
// sinon par N°. Fonction pure (aucune écriture).
export function rapprocherDI(demandesCam, demandesApp) {
  const parId = new Map(), parNum = new Map();
  (demandesApp || []).forEach(d => {
    if (d.camileiaId != null) parId.set(String(d.camileiaId), d);
    if (d.numero) parNum.set(String(d.numero), d);
  });
  const nouvelles = [], existantes = [];
  (demandesCam || []).forEach(c => {
    const d = parId.get(String(c.camileiaId)) || parNum.get(String(c.numero));
    if (!d) { nouvelles.push(c); return; }
    const ecarts = ["statut", "site", "descriptif", "urgence"].filter(k => sa(c[k]) !== sa(d[k]));
    existantes.push({ cam: c, app: d, ecarts });
  });
  return { nouvelles, existantes };
}

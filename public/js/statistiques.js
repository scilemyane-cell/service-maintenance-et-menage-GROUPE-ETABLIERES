// statistiques.js
// Tableau de bord statistiques — vue d'ensemble agrégée sur l'ensemble
// des modules de l'appli (astreinte/interventions, demandes, compteurs,
// stock, prévisionnel travaux, absences, fiches ménage, commandes),
// pensé pour une présentation professionnelle à la direction.
//
// Filtres : période (mois, année civile, année scolaire, 12 derniers mois,
// année précédente) + association. Chaque chiffre clé est comparé à la
// période équivalente précédente (ex. 1er janv → aujourd'hui vs la même
// plage l'an dernier).
//
// Règles de calcul :
//  - interventions supprimées (corbeille) exclues ;
//  - interventions FUTURES exclues (les récurrences en génèrent à l'avance) ;
//  - dates comparées en heure locale (pas en UTC, qui décalait les mois) ;
//  - si une collection n'est pas lisible (droits, réseau), un bandeau le
//    dit explicitement au lieu d'afficher des zéros silencieux.

import { db } from "./firebase-init.js";
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { esc } from "./astreinte-logic.js";
import { modulesMasquesPour } from "./modules-construction-data.js";

let mountedContainer = null;
let graphiquesActifs = {};
let cache = null;
let userCourant = null;
let masques = []; // modules "en construction" masqués pour l'utilisateur courant
const filtres = { periode: "annee", association: "" };

const SOURCES = {
  interventions: "interventions",
  sites: "sites-dossiers",
  stockProduits: "stock-produits",
  stockMenageProduits: "stock-menage-produits",
  stockMenageSorties: "stock-menage-sorties",
  previsionnel: "previsionnel-travaux",
  masterlockCodes: "masterlock-codes",
  compteurs: "compteurs",
  relevesCompteurs: "compteurs-releves",
  absences: "absences",
  demandes: "demandes",
  fiches: "fiches",
  commandes: "stock-commandes",
};

export async function mountStatistiques(container, user) {
  mountedContainer = container;
  userCourant = user;
  masques = modulesMasquesPour(user);
  container.innerHTML = `<div class="hint">⏳ Calcul des statistiques…</div>`;
  try {
    cache = await collecterDonnees();
    render();
  } catch (err) {
    console.error("Statistiques:", err);
    container.innerHTML = `<div class="form-card" style="border-color:var(--red)"><p style="margin:0;color:var(--red)"><b>Impossible de calculer les statistiques.</b></p><p class="hint" style="margin:6px 0 0">${esc(err?.message || String(err))}</p></div>`;
  }
}

async function collecterDonnees() {
  const cles = Object.keys(SOURCES);
  const resultats = await Promise.allSettled(cles.map(k => getDocs(collection(db, SOURCES[k]))));
  const data = { erreurs: [] };
  resultats.forEach((r, idx) => {
    const cle = cles[idx];
    data[cle] = [];
    if (r.status === "rejected") {
      console.error(`Statistiques — lecture ${SOURCES[cle]}:`, r.reason);
      data.erreurs.push(`${SOURCES[cle]} (${r.reason?.code || r.reason?.message || "erreur"})`);
      return;
    }
    r.value.forEach(d => {
      const v = d.data();
      if (v.supprimeLe) return; // corbeille : jamais comptée
      data[cle].push({ id: d.id, ...v });
    });
  });
  return data;
}

// ------------------------------------------------------------------
// Dates (toujours en heure locale)
// ------------------------------------------------------------------
const pad = n => String(n).padStart(2, "0");
const isoLocal = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const moisCle = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const JOUR_MS = 86400000;

function versIso(v) {
  if (!v) return null;
  if (typeof v === "string") return v.slice(0, 10);
  if (typeof v === "number") return isoLocal(new Date(v));
  if (v.toDate) return isoLocal(v.toDate());
  if (v instanceof Date) return isoLocal(v);
  return null;
}
function joursEntre(isoA, isoB) {
  return Math.round((new Date(isoB + "T12:00:00") - new Date(isoA + "T12:00:00")) / JOUR_MS);
}
function decalerAnnee(d, n) { const x = new Date(d); x.setFullYear(x.getFullYear() + n); return x; }

const PERIODES = {
  mois: "Mois en cours",
  annee: "Année civile en cours",
  scolaire: "Année scolaire en cours",
  "12mois": "12 derniers mois",
  "annee-prec": "Année civile précédente",
};

function calculerPeriode(cle) {
  const auj = new Date(); auj.setHours(0, 0, 0, 0);
  const y = auj.getFullYear();
  let debut, fin, prevDebut, prevFin, libelleComparaison;
  switch (cle) {
    case "mois":
      debut = new Date(y, auj.getMonth(), 1); fin = auj;
      prevDebut = new Date(y, auj.getMonth() - 1, 1);
      prevFin = new Date(y, auj.getMonth() - 1, Math.min(auj.getDate(), new Date(y, auj.getMonth(), 0).getDate()));
      libelleComparaison = "vs mois précédent";
      break;
    case "scolaire": {
      const ys = auj.getMonth() >= 8 ? y : y - 1;
      debut = new Date(ys, 8, 1); fin = auj;
      prevDebut = decalerAnnee(debut, -1); prevFin = decalerAnnee(fin, -1);
      libelleComparaison = "vs année scolaire préc.";
      break;
    }
    case "12mois":
      debut = new Date(y, auj.getMonth() - 11, 1); fin = auj;
      prevDebut = decalerAnnee(debut, -1); prevFin = decalerAnnee(fin, -1);
      libelleComparaison = "vs 12 mois précédents";
      break;
    case "annee-prec":
      debut = new Date(y - 1, 0, 1); fin = new Date(y - 1, 11, 31);
      prevDebut = new Date(y - 2, 0, 1); prevFin = new Date(y - 2, 11, 31);
      libelleComparaison = "vs " + (y - 2);
      break;
    default: // annee
      debut = new Date(y, 0, 1); fin = auj;
      prevDebut = decalerAnnee(debut, -1); prevFin = decalerAnnee(fin, -1);
      libelleComparaison = "vs même période " + (y - 1);
  }
  const mois = [];
  for (let d = new Date(debut.getFullYear(), debut.getMonth(), 1); d <= fin; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    mois.push({ cle: moisCle(d), label: d.toLocaleDateString("fr-FR", { month: "short", year: "2-digit" }) });
  }
  return {
    debut: isoLocal(debut), fin: isoLocal(fin), debutMs: debut.getTime(), finMs: fin.getTime() + JOUR_MS - 1,
    prevDebut: isoLocal(prevDebut), prevFin: isoLocal(prevFin),
    libelleComparaison, mois, aujourdhui: isoLocal(auj),
  };
}
const dans = (iso, deb, fin) => !!iso && iso >= deb && iso <= fin;

// ------------------------------------------------------------------
// Divers
// ------------------------------------------------------------------
const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const num = v => { const n = parseFloat(String(v ?? "").replace(",", ".").replace(/\s/g, "")); return Number.isFinite(n) ? n : null; };
const somme = (arr, f) => arr.reduce((s, x) => s + (f(x) || 0), 0);
function compter(arr, f) { const o = {}; arr.forEach(x => { const k = f(x); o[k] = (o[k] || 0) + 1; }); return o; }
const trier = o => Object.entries(o).sort((a, b) => b[1] - a[1]);
const fmtNb = (n, dec = 0) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: dec, minimumFractionDigits: 0 }).format(n || 0);
const formatMontant = n => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n || 0);
function variation(actuel, precedent) {
  if (!precedent) return null;
  return Math.round(((actuel - precedent) / precedent) * 100);
}

const STATUTS_TRAITES_DEMANDES = ["Réalisé", "Annulé"];
const COULEUR_URGENCE = { "Normal": "#3FB6AC", "Urgent": "#D9B24C", "À planifier": "#8B96A6", "Non renseignée": "#5A6577", "Critique": "#E5533D" };
const ORDRE_URGENCE = ["Critique", "Urgent", "Normal", "À planifier", "Non renseignée"];
const TYPE_ABSENCE_LABELS = { conge: "Congés", rtt: "RTT", arret: "Arrêts" };
const COULEUR_ABSENCE = { conge: "#D9B24C", rtt: "#3FB6AC", arret: "#E5533D" };
const TYPE_COMPTEUR = { eau: { label: "Eau", icone: "💧", unite: "m³" }, gaz: { label: "Gaz", icone: "🔥", unite: "m³" }, chauffage: { label: "Chauffage urbain", icone: "🌡️", unite: "kWh" }, elec: { label: "Électricité", icone: "⚡", unite: "kWh" } };
const JOURS_SEMAINE = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const SEUIL_RETARD_RELEVE_J = 35;
const PALETTE = ["#D9B24C", "#3FB6AC", "#8B7CF0", "#E5533D", "#6FA8DC", "#B5C99A", "#D98BC9", "#C9A66B", "#5FA85A", "#8B96A6"];

// ------------------------------------------------------------------
// Calculs
// ------------------------------------------------------------------
function calculer(data, p) {
  const assocFiltre = filtres.association;
  const okAssoc = v => !assocFiltre || norm(v) === norm(assocFiltre);
  const assocParSite = {}; data.sites.forEach(s => { assocParSite[s.id] = s.association || ""; });

  // ---- Interventions (astreinte) ----
  const intervValides = data.interventions.filter(i => i.date && i.date <= p.aujourdhui && okAssoc(i.association));
  const interv = intervValides.filter(i => dans(i.date, p.debut, p.fin));
  const intervPrev = intervValides.filter(i => dans(i.date, p.prevDebut, p.prevFin));
  const heures = i => parseFloat(i.heures) || 0;
  const heuresTot = somme(interv, heures);
  const heuresPrev = somme(intervPrev, heures);
  const heuresNuit = somme(interv, i => parseFloat(i.heuresNuit) || 0);
  const primesDimanche = somme(interv, i => parseFloat(i.primeDimanche) || 0);
  const appelsN1 = interv.filter(i => i.appelN1).length;
  const intervParMois = p.mois.map(m => interv.filter(i => i.date.startsWith(m.cle)).length);
  const heuresParMois = p.mois.map(m => somme(interv.filter(i => i.date.startsWith(m.cle)), heures));
  const parType = trier(compter(interv, i => i.type || "Autre"));
  const parAssocInterv = trier(compter(interv, i => i.association || "Non renseignée"));
  const parSiteInterv = trier(compter(interv, i => i.site || "Non renseigné")).slice(0, 10);
  const parJourSemaine = [0, 0, 0, 0, 0, 0, 0];
  interv.forEach(i => { parJourSemaine[(new Date(i.date + "T12:00:00").getDay() + 6) % 7]++; });
  const parTech = {};
  interv.forEach(i => {
    const t = i.technicien || "Non renseigné";
    const o = parTech[t] || (parTech[t] = { nb: 0, heures: 0, nuit: 0, dimanches: new Set(), primes: 0, n1: 0 });
    o.nb++; o.heures += heures(i); o.nuit += parseFloat(i.heuresNuit) || 0;
    if (parseFloat(i.primeDimanche) > 0 && !o.dimanches.has(i.date)) { o.dimanches.add(i.date); o.primes += parseFloat(i.primeDimanche); }
    if (i.appelN1) o.n1++;
  });
  const techTries = Object.entries(parTech).sort((a, b) => b[1].heures - a[1].heures);
  // prime dimanche = par JOUR d'intervention un dimanche (pas par intervention)
  const primesDimancheReelles = somme(Object.values(parTech), o => o.primes);

  // ---- Demandes d'intervention ----
  const demandesToutes = data.demandes.map(d => ({ ...d, _date: versIso(d.dateDemande), _dateInterv: versIso(d.dateIntervention) })).filter(d => okAssoc(d.association));
  const dem = demandesToutes.filter(d => dans(d._date, p.debut, p.fin));
  const demPrev = demandesToutes.filter(d => dans(d._date, p.prevDebut, p.prevFin));
  const estTraitee = d => STATUTS_TRAITES_DEMANDES.includes(d.statut);
  const demTraitees = dem.filter(estTraitee).length;
  const pctTraitees = dem.length ? Math.round((demTraitees / dem.length) * 100) : 0;
  const avecDelai = dem.filter(d => d.statut === "Réalisé" && d._date && d._dateInterv).map(d => ({ ...d, _delai: joursEntre(d._date, d._dateInterv) })).filter(d => d._delai >= 0);
  const delaiMoyen = avecDelai.length ? somme(avecDelai, d => d._delai) / avecDelai.length : null;
  const delaiMedian = mediane(avecDelai.map(d => d._delai));
  const delaiParUrgence = ORDRE_URGENCE.map(u => {
    const l = avecDelai.filter(d => (d.urgence || "Non renseignée") === u);
    return { urgence: u, nb: l.length, moyen: l.length ? somme(l, d => d._delai) / l.length : null, median: mediane(l.map(d => d._delai)) };
  }).filter(x => x.nb > 0);
  const recuesParMois = p.mois.map(m => dem.filter(d => d._date.startsWith(m.cle)).length);
  const realiseesParMois = p.mois.map(m => demandesToutes.filter(d => d.statut === "Réalisé" && d._dateInterv && d._dateInterv.startsWith(m.cle)).length);
  const urgenceTriee = trier(compter(dem, d => d.urgence || "Non renseignée"));
  const statutTrie = trier(compter(dem, d => d.statut || "Non renseigné"));
  const parAssocDem = trier(compter(dem, d => d.association || "Autres"));
  const parSiteDem = trier(compter(dem, d => d.site || "Non renseigné")).slice(0, 10);
  const parTypeDem = trier(compter(dem.filter(d => d.type), d => d.type)).slice(0, 8);
  const parIntervenant = {};
  dem.filter(estTraitee).forEach(d => {
    const n = d.intervenant || "Non renseigné";
    const o = parIntervenant[n] || (parIntervenant[n] = { nb: 0, delais: [] });
    o.nb++;
  });
  avecDelai.forEach(d => { const n = d.intervenant || "Non renseigné"; (parIntervenant[n] || (parIntervenant[n] = { nb: 0, delais: [] })).delais.push(d._delai); });
  const intervenantsTries = Object.entries(parIntervenant).sort((a, b) => b[1].nb - a[1].nb).slice(0, 10);
  // Stock en attente (toutes périodes confondues) — ancienneté
  const enAttente = demandesToutes.filter(d => !estTraitee(d) && d._date);
  const tranchesAge = { "< 7 j": 0, "7–30 j": 0, "30–90 j": 0, "> 90 j": 0 };
  enAttente.forEach(d => {
    const age = joursEntre(d._date, p.aujourdhui);
    if (age < 7) tranchesAge["< 7 j"]++; else if (age < 30) tranchesAge["7–30 j"]++; else if (age < 90) tranchesAge["30–90 j"]++; else tranchesAge["> 90 j"]++;
  });
  const attentePlus30 = tranchesAge["30–90 j"] + tranchesAge["> 90 j"];
  const plusAnciennes = enAttente.map(d => ({ ...d, _age: joursEntre(d._date, p.aujourdhui) })).sort((a, b) => b._age - a._age).slice(0, 8);

  // ---- Compteurs ----
  const compteurs = data.compteurs.filter(c => okAssoc(assocParSite[c.dossierId]));
  const compteursParId = {}; compteurs.forEach(c => { compteursParId[c.id] = c; });
  const releves = data.relevesCompteurs.filter(r => compteursParId[r.compteurId] && r.createdAt);
  const relevesPeriode = releves.filter(r => r.createdAt >= p.debutMs && r.createdAt <= p.finMs);
  const relevesParMois = p.mois.map(m => relevesPeriode.filter(r => moisCle(new Date(r.createdAt)) === m.cle).length);
  const relevesParCompteur = {};
  releves.forEach(r => { (relevesParCompteur[r.compteurId] || (relevesParCompteur[r.compteurId] = [])).push(r); });
  const consoParType = {}; const consoParCompteur = [];
  Object.entries(relevesParCompteur).forEach(([cid, liste]) => {
    liste.sort((a, b) => a.createdAt - b.createdAt);
    const avant = liste.filter(r => r.createdAt < p.debutMs);
    const pendant = liste.filter(r => r.createdAt >= p.debutMs && r.createdAt <= p.finMs);
    if (pendant.length === 0) return;
    const base = avant.length ? avant[avant.length - 1] : pendant[0];
    const dernier = pendant[pendant.length - 1];
    if (base === dernier) return;
    let conso = 0, ok = false;
    Object.keys(dernier.valeurs || {}).forEach(k => {
      if (dernier.illisibles?.[k] || base.illisibles?.[k]) return;
      const a = num(base.valeurs?.[k]), b = num(dernier.valeurs?.[k]);
      if (a === null || b === null || b < a) return; // index remis à zéro / erreur de saisie : ignoré
      conso += b - a; ok = true;
    });
    if (!ok) return;
    const c = compteursParId[cid];
    consoParType[c.type] = (consoParType[c.type] || 0) + conso;
    consoParCompteur.push({ nom: c.nom, site: c.dossierNom || "", type: c.type, conso, du: base.createdAt, au: dernier.createdAt });
  });
  const topConso = {};
  Object.keys(TYPE_COMPTEUR).forEach(t => { topConso[t] = consoParCompteur.filter(x => x.type === t).sort((a, b) => b.conso - a.conso).slice(0, 5); });
  const limiteRetard = Date.now() - SEUIL_RETARD_RELEVE_J * JOUR_MS;
  const compteursEnRetard = compteurs
    .map(c => ({ ...c, _dernier: c.dernierReleve?.at || null }))
    .filter(c => !c._dernier || c._dernier < limiteRetard)
    .sort((a, b) => (a._dernier || 0) - (b._dernier || 0));

  // ---- Stock ----
  const sousSeuilMaint = masques.includes("stock") ? [] : data.stockProduits.filter(p2 => (p2.stockActuel || 0) <= (p2.stockMin || 0));
  const menageZoneOk = pr => !assocFiltre || !pr.zone || norm(pr.zone).includes(norm(assocFiltre)) || norm(assocFiltre).includes(norm(pr.zone));
  const sousSeuilMenage = masques.includes("stock-menage") ? [] : data.stockMenageProduits.filter(pr => menageZoneOk(pr) && (pr.stockActuel || 0) <= (pr.stockMin || 0));
  const mouvements = data.stockMenageSorties.filter(s => menageZoneOk(s) && dans(versIso(s.date), p.debut, p.fin));
  const totalEntrees = somme(mouvements.filter(s => s.type === "entree"), s => s.quantite);
  const sorties = mouvements.filter(s => s.type !== "entree");
  const totalSorties = somme(sorties, s => s.quantite);
  const quotePart = {}; sorties.filter(s => s.attributionNom).forEach(s => { quotePart[s.attributionNom] = (quotePart[s.attributionNom] || 0) + (s.quantite || 0); });
  const quotePartTriee = trier(quotePart);
  const topProduitsSortis = {}; sorties.forEach(s => { const n = s.produitNom || "?"; topProduitsSortis[n] = (topProduitsSortis[n] || 0) + (s.quantite || 0); });
  const topProduitsTries = trier(topProduitsSortis).slice(0, 8);
  const commandes = data.commandes.filter(c => dans(versIso(c.date), p.debut, p.fin));
  const commandesPrev = data.commandes.filter(c => dans(versIso(c.date), p.prevDebut, p.prevFin));
  const commandesParMois = p.mois.map(m => commandes.filter(c => versIso(c.date).startsWith(m.cle)).length);
  const commandesParFournisseur = trier(compter(commandes, c => c.fournisseurNom || "Non renseigné")).slice(0, 8);

  // ---- Prévisionnel (année en cours + suivante, indépendant de la période) ----
  const anneeCourante = new Date().getFullYear();
  const previsionnel = data.previsionnel.filter(l => (l.anneeVisee === anneeCourante || l.anneeVisee === anneeCourante + 1) && okAssoc(l.association || assocFiltre));
  const montantPropose = somme(previsionnel, l => l.montantEstime);
  const montantValide = somme(previsionnel.filter(l => l.statut === "valide"), l => l.montantEstime);
  const statutsLabels = { propose: "Proposé", valide: "Validé", refuse: "Refusé", reporte: "Reporté" };
  const parStatutPrev = { propose: 0, valide: 0, refuse: 0, reporte: 0 };
  previsionnel.forEach(l => { parStatutPrev[l.statut] = (parStatutPrev[l.statut] || 0) + (l.montantEstime || 0); });
  const parCategoriePrev = {}; previsionnel.forEach(l => { const c = l.categorie || "Non classé"; parCategoriePrev[c] = (parCategoriePrev[c] || 0) + (l.montantEstime || 0); });
  const categoriePrevTriee = trier(parCategoriePrev).slice(0, 8);

  // ---- Absences (jours tombant DANS la période) ----
  const joursDans = (a, deb, fin) => {
    const s = versIso(a.start); const e = versIso(a.end) || s;
    if (!s) return 0;
    const d1 = s > deb ? s : deb; const d2 = e < fin ? e : fin;
    return d2 < d1 ? 0 : joursEntre(d1, d2) + 1;
  };
  const joursParType = { conge: 0, rtt: 0, arret: 0 };
  const joursParPersonne = {};
  const absencesParMois = p.mois.map(() => 0);
  let totalJoursAbsence = 0;
  data.absences.forEach(a => {
    const j = joursDans(a, p.debut, p.fin);
    if (!j) return;
    totalJoursAbsence += j;
    const t = a.type || "conge"; joursParType[t] = (joursParType[t] || 0) + j;
    const pers = a.person || "Non renseigné"; joursParPersonne[pers] = (joursParPersonne[pers] || 0) + j;
    p.mois.forEach((m, idx) => {
      const [yy, mm] = m.cle.split("-").map(Number);
      absencesParMois[idx] += joursDans(a, `${m.cle}-01`, isoLocal(new Date(yy, mm, 0)));
    });
  });
  const totalJoursAbsencePrev = somme(data.absences, a => joursDans(a, p.prevDebut, p.prevFin));
  const personnesTriees = trier(joursParPersonne).slice(0, 10);

  // ---- Fiches ménage ----
  const fiches = data.fiches.filter(f => dans(f.weekStart, p.debut, p.fin));
  const fichesSoumises = fiches.filter(f => f.submitted).length;
  const semaine12 = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - i * 7);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    semaine12.push(isoLocal(d));
  }
  const fichesParSemaine = semaine12.map(cle => data.fiches.filter(f => f.weekStart === cle).length);

  return {
    interv, intervPrev, heuresTot, heuresPrev, heuresNuit, primesDimanche: primesDimancheReelles || primesDimanche, appelsN1,
    intervParMois, heuresParMois, parType, parAssocInterv, parSiteInterv, parJourSemaine, techTries,
    dem, demPrev, demTraitees, pctTraitees, delaiMoyen, delaiMedian, delaiParUrgence, avecDelai, recuesParMois, realiseesParMois,
    urgenceTriee, statutTrie, parAssocDem, parSiteDem, parTypeDem, intervenantsTries, enAttente, tranchesAge, attentePlus30, plusAnciennes,
    compteurs, relevesPeriode, relevesParMois, consoParType, topConso, compteursEnRetard,
    sousSeuilMaint, sousSeuilMenage, totalEntrees, totalSorties, quotePartTriee, topProduitsTries, commandes, commandesPrev, commandesParMois, commandesParFournisseur,
    previsionnel, montantPropose, montantValide, statutsLabels, parStatutPrev, categoriePrevTriee, anneeCourante,
    joursParType, absencesParMois, totalJoursAbsence, totalJoursAbsencePrev, personnesTriees,
    fiches, fichesSoumises, semaine12, fichesParSemaine,
  };
}

function mediane(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b); const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ------------------------------------------------------------------
// Rendu
// ------------------------------------------------------------------
function listeAssociations(data) {
  const set = new Map();
  [...data.sites.map(s => s.association), ...data.interventions.map(i => i.association), ...data.demandes.map(d => d.association)]
    .filter(Boolean).forEach(a => { if (!set.has(norm(a))) set.set(norm(a), a); });
  return [...set.values()].sort((a, b) => a.localeCompare(b, "fr"));
}

function render() {
  const data = cache;
  const p = calculerPeriode(filtres.periode);
  const s = calculer(data, p);
  const comp = p.libelleComparaison;
  const v = id => !masques.includes(id);
  const vFiches = !masques.some(id => id.startsWith("disp-"));
  const fmtDate = iso => iso.split("-").reverse().join("/");
  const titre = (t, sous) => `<h3 style="margin:0 0 ${sous ? 4 : 12}px;font-size:14px;color:var(--gold)">${t}</h3>${sous ? `<p class="hint" style="margin:0 0 12px">${sous}</p>` : ""}`;
  const canvas = (id, h = 220) => `<div style="position:relative;height:${h}px"><canvas id="${id}"></canvas></div>`;
  const vide = txt => `<p class="hint" style="margin:0">${txt}</p>`;
  const sousTitre = t => `<h4 style="margin:16px 0 8px;font-size:13px;color:var(--text-dim)">${t}</h4>`;

  mountedContainer.innerHTML = `
    <div class="stack">
      <div class="form-card" style="display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end">
        <label style="flex:1;min-width:180px">Période
          <select id="stat-f-periode">${Object.entries(PERIODES).map(([k, l]) => `<option value="${k}" ${filtres.periode === k ? "selected" : ""}>${l}</option>`).join("")}</select>
        </label>
        <label style="flex:1;min-width:180px">Association
          <select id="stat-f-assoc"><option value="">Toutes</option>${listeAssociations(data).map(a => `<option value="${esc(a)}" ${filtres.association === a ? "selected" : ""}>${esc(a)}</option>`).join("")}</select>
        </label>
        <button class="nav-btn" id="stat-rafraichir" style="font-size:12px">🔄 Actualiser</button>
        <p class="hint" style="margin:0;flex-basis:100%">Du ${fmtDate(p.debut)} au ${fmtDate(p.fin)} · comparaison ${comp.replace(/^vs /, "avec ")} (${fmtDate(p.prevDebut)} → ${fmtDate(p.prevFin)})${filtres.association ? ` · filtre association : <b>${esc(filtres.association)}</b> (sans effet sur absences et fiches ménage)` : ""}</p>
      </div>

      ${data.erreurs.length ? `<div class="form-card" style="border-color:var(--red)"><p style="margin:0;color:var(--red)"><b>⚠️ Données incomplètes</b> — lecture impossible de : ${esc(data.erreurs.join(", "))}. Les chiffres correspondants sont à zéro ; vérifier les droits Firestore de ton compte.</p></div>` : ""}

      <div class="stats-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px">
        ${v("astreinte") ? carteKpi("🛠️", fmtNb(s.interv.length), "Interventions astreinte", null, variation(s.interv.length, s.intervPrev.length), comp) : ""}
        ${v("astreinte") ? carteKpi("⏱️", fmtNb(s.heuresTot) + " h", "Heures d'astreinte", null, variation(s.heuresTot, s.heuresPrev), comp) : ""}
        ${v("astreinte") ? carteKpi("🌙", fmtNb(s.heuresNuit, 1) + " h", "Dont heures de nuit") : ""}
        ${v("astreinte") ? carteKpi("📆", formatMontant(s.primesDimanche), "Primes dimanche") : ""}
        ${v("astreinte") ? carteKpi("📞", fmtNb(s.appelsN1), "Appels au N1") : ""}
        ${v("suivi-demandes") ? carteKpi("📄", fmtNb(s.dem.length), "Demandes reçues", null, variation(s.dem.length, s.demPrev.length), comp) : ""}
        ${v("suivi-demandes") ? carteKpi("✔️", s.pctTraitees + " %", "Demandes traitées", s.dem.length ? (s.pctTraitees >= 70 ? "var(--teal)" : "var(--gold)") : null) : ""}
        ${v("suivi-demandes") ? carteKpi("⏳", s.delaiMoyen === null ? "—" : fmtNb(s.delaiMoyen, 1) + " j", "Délai moyen de traitement", null, null, s.delaiMedian === null ? "" : `médiane ${fmtNb(s.delaiMedian, 1)} j`) : ""}
        ${v("suivi-demandes") ? carteKpi("🚩", fmtNb(s.attentePlus30), "Demandes en attente > 30 j", s.attentePlus30 > 0 ? "var(--red)" : "var(--teal)", null, "toutes périodes") : ""}
        ${v("compteurs") ? carteKpi("📟", fmtNb(s.relevesPeriode.length), "Relevés compteurs") : ""}
        ${v("compteurs") ? carteKpi("⏰", fmtNb(s.compteursEnRetard.length), `Compteurs sans relevé > ${SEUIL_RETARD_RELEVE_J} j`, s.compteursEnRetard.length ? "var(--gold)" : "var(--teal)", null, `sur ${s.compteurs.length}`) : ""}
        ${v("stock") || v("stock-menage") ? carteKpi("📦", fmtNb(s.sousSeuilMaint.length + s.sousSeuilMenage.length), "Produits sous le seuil", (s.sousSeuilMaint.length + s.sousSeuilMenage.length) > 0 ? "var(--red)" : null, null, "état actuel") : ""}
        ${v("stock") ? carteKpi("🛒", fmtNb(s.commandes.length), "Commandes fournisseurs", null, variation(s.commandes.length, s.commandesPrev.length), comp) : ""}
        ${v("astreinte") ? carteKpi("🌴", fmtNb(s.totalJoursAbsence), "Jours d'absence", null, variation(s.totalJoursAbsence, s.totalJoursAbsencePrev), comp) : ""}
        ${vFiches ? carteKpi("🧽", fmtNb(s.fiches.length), "Fiches ménage") : ""}
        ${v("previsionnel") ? carteKpi("💰", formatMontant(s.montantPropose), `Prévisionnel ${s.anneeCourante}–${s.anneeCourante + 1}`) : ""}
        ${v("previsionnel") ? carteKpi("✅", formatMontant(s.montantValide), "Dont validé CA", "var(--teal)") : ""}
      </div>
      <p class="hint" style="margin:-4px 0 0">Patrimoine suivi : ${[v("sites") ? `${data.sites.length} site(s)` : "", v("compteurs") ? `${s.compteurs.length} compteur(s)` : "", v("masterlock") ? `${data.masterlockCodes.length} code(s) Masterlock` : ""].filter(Boolean).join(" · ") || "—"}.</p>

      ${v("astreinte") ? `<!-- ============ ASTREINTE ============ -->
      <div class="form-card">
        ${titre("🛠️ Astreinte — interventions et heures par mois")}
        ${s.interv.length ? canvas("stat-chart-interv-mois", 260) : vide("Aucune intervention sur la période.")}
      </div>

      ${s.interv.length ? `
      <div class="form-card">
        ${titre("Récapitulatif par intervenant", "Primes dimanche comptées par jour d'intervention un dimanche · heures de nuit = part des heures entre 21h et 6h (déjà incluse dans le total)")}
        ${canvas("stat-chart-tech", Math.max(160, s.techTries.length * 34))}
        ${tableau(["Intervenant", "Interv.", "Heures", "Dont nuit", "Dimanches", "Primes", "Appels N1"],
          s.techTries.map(([n, o]) => [esc(n), o.nb, fmtNb(o.heures, 1) + " h", fmtNb(o.nuit, 1) + " h", o.dimanches.size, formatMontant(o.primes), o.n1]),
          ["Total", s.interv.length, fmtNb(s.heuresTot, 1) + " h", fmtNb(s.heuresNuit, 1) + " h", somme(s.techTries, ([, o]) => o.dimanches.size), formatMontant(s.primesDimanche), s.appelsN1])}
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px" class="stats-2col">
        <div class="form-card">${titre("Par type d'intervention")}${canvas("stat-chart-types", 240)}</div>
        <div class="form-card">${titre("Par association")}${canvas("stat-chart-interv-assoc", 240)}</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px" class="stats-2col">
        <div class="form-card">${titre("Top 10 des sites")}${canvas("stat-chart-interv-sites", 280)}</div>
        <div class="form-card">${titre("Par jour de la semaine", "Charge du week-end mise en évidence")}${canvas("stat-chart-interv-jours", 240)}</div>
      </div>` : ""}
      ` : ""}

      ${v("suivi-demandes") ? `<!-- ============ DEMANDES ============ -->
      <div class="form-card">
        ${titre("📄 Suivi des demandes — reçues vs réalisées", `${s.dem.length} reçue(s) sur la période · ${s.demTraitees} traitée(s) (${s.pctTraitees} %) · ${s.enAttente.length} en attente au total (toutes périodes)`)}
        ${canvas("stat-chart-demandes-mois", 240)}
        <p class="hint" style="margin:8px 0 0">« Réalisées » = demandes passées au statut Réalisé avec une date d'intervention dans le mois. Le délai n'est calculable que si la date d'intervention est renseignée (${s.avecDelai.length} demande(s) réalisée(s) sur la période l'ont).</p>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px" class="stats-2col">
        <div class="form-card">${titre("Par urgence")}${s.urgenceTriee.length ? canvas("stat-chart-demandes-urgence") : vide("Aucune demande.")}</div>
        <div class="form-card">${titre("Par statut")}${s.statutTrie.length ? canvas("stat-chart-demandes-statut") : vide("Aucune demande.")}</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px" class="stats-2col">
        <div class="form-card">${titre("Par association")}${s.parAssocDem.length ? canvas("stat-chart-demandes-assoc") : vide("Aucune demande.")}</div>
        <div class="form-card">${titre("Top 10 des sites demandeurs")}${s.parSiteDem.length ? canvas("stat-chart-demandes-sites", 280) : vide("Aucune demande.")}</div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px" class="stats-2col">
        <div class="form-card">
          ${titre("Délai de traitement par urgence", "Date de demande → date d'intervention, demandes réalisées")}
          ${s.delaiParUrgence.length ? tableau(["Urgence", "Nb", "Moyen", "Médian"], s.delaiParUrgence.map(x => [esc(x.urgence), x.nb, fmtNb(x.moyen, 1) + " j", fmtNb(x.median, 1) + " j"])) : vide("Aucune date d'intervention renseignée sur la période.")}
          ${sousTitre("Par intervenant")}
          ${s.intervenantsTries.length ? tableau(["Intervenant", "Traitées", "Délai moyen"], s.intervenantsTries.map(([n, o]) => [esc(n), o.nb, o.delais.length ? fmtNb(somme(o.delais, x => x) / o.delais.length, 1) + " j" : "—"])) : vide("Aucune demande traitée.")}
        </div>
        <div class="form-card">
          ${titre("Demandes en attente — ancienneté", "État actuel, toutes périodes confondues")}
          ${canvas("stat-chart-demandes-age", 180)}
          ${s.plusAnciennes.length ? `${sousTitre("Les plus anciennes")}${tableau(["N°", "Site", "Urgence", "Âge"], s.plusAnciennes.map(d => [esc(d.numero || "—"), esc(d.site || "—"), esc(d.urgence || "—"), `<b style="color:${d._age > 30 ? "var(--red)" : "inherit"}">${d._age} j</b>`]))}` : ""}
        </div>
      </div>
      ${s.parTypeDem.length ? `<div class="form-card">${titre("Demandes par type")}${canvas("stat-chart-demandes-type", Math.max(160, s.parTypeDem.length * 30))}</div>` : ""}
      ` : ""}

      ${v("compteurs") ? `<!-- ============ COMPTEURS ============ -->
      <div class="form-card">
        ${titre("📟 Compteurs — consommations sur la période", "Écart entre le dernier relevé avant la période (ou le premier de la période) et le dernier relevé de la période. Index illisibles et remises à zéro ignorés.")}
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:8px">
          ${Object.entries(TYPE_COMPTEUR).map(([t, def]) => `
            <div style="text-align:center;padding:8px;border:1px solid var(--border);border-radius:10px">
              <p style="margin:0;font-size:18px">${def.icone}</p>
              <p style="margin:2px 0 0;font-size:20px;font-weight:800">${s.consoParType[t] ? fmtNb(s.consoParType[t]) : "—"} <span style="font-size:11px;font-weight:400">${def.unite}</span></p>
              <p class="hint" style="margin:0">${def.label}</p>
            </div>`).join("")}
        </div>
        ${Object.entries(s.topConso).filter(([, l]) => l.length).map(([t, l]) => `
          ${sousTitre(`${TYPE_COMPTEUR[t].icone} Plus gros consommateurs — ${TYPE_COMPTEUR[t].label}`)}
          ${tableau(["Compteur", "Site", "Conso", "Du → au"], l.map(x => [esc(x.nom), esc(x.site), `<b>${fmtNb(x.conso)} ${TYPE_COMPTEUR[t].unite}</b>`, `${new Date(x.du).toLocaleDateString("fr-FR")} → ${new Date(x.au).toLocaleDateString("fr-FR")}`]))}
        `).join("")}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px" class="stats-2col">
        <div class="form-card">${titre("Relevés effectués par mois")}${canvas("stat-chart-releves-mois")}</div>
        <div class="form-card">
          ${titre(`Compteurs sans relevé depuis plus de ${SEUIL_RETARD_RELEVE_J} jours`)}
          ${s.compteursEnRetard.length ? `<div style="max-height:220px;overflow:auto">${tableau(["Compteur", "Site", "Dernier relevé"], s.compteursEnRetard.map(c => [`${TYPE_COMPTEUR[c.type]?.icone || ""} ${esc(c.nom || "")}`, esc(c.dossierNom || "—"), c._dernier ? `${new Date(c._dernier).toLocaleDateString("fr-FR")} <span class="hint">(${Math.floor((Date.now() - c._dernier) / JOUR_MS)} j)</span>` : `<span style="color:var(--red)">Jamais</span>`]))}</div>` : vide("✅ Tous les compteurs sont à jour.")}
        </div>
      </div>
      ` : ""}

      ${v("previsionnel") ? `<!-- ============ PRÉVISIONNEL ============ -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px" class="stats-2col">
        <div class="form-card">${titre(`💰 Prévisionnel travaux ${s.anneeCourante}–${s.anneeCourante + 1} — par statut`)}${canvas("stat-chart-previsionnel", 240)}</div>
        <div class="form-card">${titre("Prévisionnel — par catégorie")}${s.categoriePrevTriee.length ? canvas("stat-chart-previsionnel-cat", 240) : vide("Aucune ligne.")}</div>
      </div>
      ` : ""}

      ${v("stock-menage") ? `<!-- ============ STOCK ============ -->
      <div class="form-card">
        ${titre("🧴 Stock Ménage — entrées / sorties", filtres.association ? `Zone : ${esc(filtres.association)}` : "École + Agropolis confondus")}
        <div style="display:flex;gap:24px;flex-wrap:wrap;margin-bottom:8px">
          <div style="text-align:center"><p style="margin:0;font-size:32px;font-weight:800;color:var(--teal)">${fmtNb(s.totalEntrees)}</p><p class="hint" style="margin:0">📥 unités entrées (réappro)</p></div>
          <div style="text-align:center"><p style="margin:0;font-size:32px;font-weight:800;color:var(--gold)">${fmtNb(s.totalSorties)}</p><p class="hint" style="margin:0">📤 unités sorties (consommées)</p></div>
        </div>
        ${s.quotePartTriee.length === 0 ? vide("Aucune sortie enregistrée sur la période.") : `
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start" class="stats-2col">
            <div>${sousTitre("Quote-part des sorties par site / MNA")}${canvas("stat-chart-quotepart")}
              ${s.quotePartTriee.map(([nom, qte]) => `<div style="display:flex;justify-content:space-between;font-size:12px;padding:4px 0;border-bottom:1px solid var(--border)"><span>${esc(nom)}</span><b>${fmtNb(qte)} (${s.totalSorties ? Math.round(qte / s.totalSorties * 100) : 0} %)</b></div>`).join("")}
            </div>
            <div>${sousTitre("Produits les plus consommés")}${canvas("stat-chart-top-produits", Math.max(160, s.topProduitsTries.length * 30))}</div>
          </div>`}
      </div>
      ` : ""}
      ${v("stock") || v("stock-menage") ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px" class="stats-2col">
        <div class="form-card">
          ${titre("📦 Produits sous le seuil minimum", "État actuel")}
          ${(s.sousSeuilMaint.length + s.sousSeuilMenage.length) === 0 ? vide("✅ Aucun produit sous le seuil.") : `<div style="max-height:260px;overflow:auto">${tableau(["Produit", "Stock", "Seuil", "Module"], [
            ...s.sousSeuilMaint.map(x => [esc(x.nom || "?"), `<b style="color:var(--red)">${fmtNb(x.stockActuel)}</b>`, fmtNb(x.stockMin), "Maintenance"]),
            ...s.sousSeuilMenage.map(x => [esc(x.nom || "?"), `<b style="color:var(--red)">${fmtNb(x.stockActuel)}</b>`, fmtNb(x.stockMin), `Ménage${x.zone ? " · " + esc(x.zone) : ""}`]),
          ])}</div>`}
        </div>
        ${v("stock") ? `<div class="form-card">
          ${titre("🛒 Commandes fournisseurs", `${s.commandes.length} commande(s) sur la période`)}
          ${canvas("stat-chart-commandes-mois", 180)}
          ${s.commandesParFournisseur.length ? `${sousTitre("Par fournisseur")}${tableau(["Fournisseur", "Commandes"], s.commandesParFournisseur.map(([n, c]) => [esc(n), c]))}` : ""}
        </div>` : ""}
      </div>` : ""}

      ${v("astreinte") ? `<!-- ============ ABSENCES ============ -->
      <div class="form-card">
        ${titre("🌴 Absences — congés, RTT, arrêts", `${fmtNb(s.totalJoursAbsence)} jour(s) sur la période (jours calendaires tombant dans la période)`)}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px" class="stats-2col">
          ${canvas("stat-chart-absences-type")}
          ${canvas("stat-chart-absences-mois")}
        </div>
        ${s.personnesTriees.length ? `${sousTitre("Par personne")}${s.personnesTriees.map(([nom, j]) => `<div style="display:flex;justify-content:space-between;font-size:12px;padding:4px 0;border-bottom:1px solid var(--border)"><span>${esc(nom)}</span><b>${j} j</b></div>`).join("")}` : ""}
      </div>
      ` : ""}

      ${vFiches ? `<!-- ============ FICHES MÉNAGE ============ -->
      <div class="form-card">
        ${titre("🧽 Fiches ménage — activité terrain", `${s.fiches.length} fiche(s) sur la période, dont ${s.fichesSoumises} soumise(s) · graphique : 12 dernières semaines`)}
        ${canvas("stat-chart-fiches-semaine")}
      </div>
      ` : ""}
    </div>
  `;

  document.getElementById("stat-f-periode")?.addEventListener("change", e => { filtres.periode = e.target.value; render(); });
  document.getElementById("stat-f-assoc")?.addEventListener("change", e => { filtres.association = e.target.value; render(); });
  document.getElementById("stat-rafraichir")?.addEventListener("click", () => mountStatistiques(mountedContainer, userCourant));

  dessinerGraphiques(s, p);
}

function carteKpi(icone, valeur, label, couleur, delta = null, sous = "") {
  let ligneDelta = "";
  if (delta !== null && delta !== undefined && Number.isFinite(delta)) {
    const fleche = delta > 0 ? "▲" : delta < 0 ? "▼" : "=";
    ligneDelta = `<p style="margin:3px 0 0;font-size:10px;color:var(--text-dim)">${fleche} ${delta > 0 ? "+" : ""}${delta} % ${esc(sous)}</p>`;
  } else if (sous && delta === null && !/^vs /.test(sous)) {
    ligneDelta = `<p style="margin:3px 0 0;font-size:10px;color:var(--text-dim)">${esc(sous)}</p>`;
  }
  return `
    <div class="form-card" style="text-align:center;padding:14px 8px">
      <p style="margin:0;font-size:20px">${icone}</p>
      <p style="margin:4px 0 0;font-size:22px;font-weight:800;${couleur ? `color:${couleur}` : ""}">${valeur}</p>
      <p style="margin:2px 0 0;font-size:11px;color:var(--text-dim)">${esc(label)}</p>
      ${ligneDelta}
    </div>
  `;
}

function tableau(entetes, lignes, total = null) {
  const cell = (v, i, tag = "td") => `<${tag} style="padding:5px 6px;border-bottom:1px solid var(--border);text-align:${i === 0 ? "left" : "right"};white-space:${i === 0 ? "normal" : "nowrap"}">${v}</${tag}>`;
  return `
    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr>${entetes.map((h, i) => cell(`<span style="color:var(--text-dim);font-weight:600">${h}</span>`, i, "th")).join("")}</tr></thead>
      <tbody>${lignes.map(l => `<tr>${l.map((v, i) => cell(v, i)).join("")}</tr>`).join("")}</tbody>
      ${total ? `<tfoot><tr>${total.map((v, i) => cell(`<b>${v}</b>`, i)).join("")}</tr></tfoot>` : ""}
    </table></div>`;
}

// ------------------------------------------------------------------
// Graphiques
// ------------------------------------------------------------------
function dessinerGraphiques(s, p) {
  Object.values(graphiquesActifs).forEach(c => c.destroy());
  graphiquesActifs = {};
  if (!window.Chart) return;

  const cs = getComputedStyle(document.body);
  const couleurTexte = (cs.getPropertyValue("--text-dim") || "#999").trim() || "#999";
  const couleurGrille = "rgba(128,128,128,.15)";
  const axes = (extra = {}) => ({
    x: { ticks: { color: couleurTexte }, grid: { color: couleurGrille }, ...(extra.x || {}) },
    y: { ticks: { color: couleurTexte, precision: 0 }, grid: { color: couleurGrille }, beginAtZero: true, ...(extra.y || {}) },
  });
  const legende = pos => ({ position: pos, labels: { color: couleurTexte, boxWidth: 12, font: { size: 10 } } });
  const creer = (id, config) => {
    const el = document.getElementById(id);
    if (!el) return;
    config.options = { maintainAspectRatio: false, ...(config.options || {}) };
    graphiquesActifs[id] = new window.Chart(el, config);
  };
  const barres = (id, labels, valeurs, couleur, { horizontal = false, label = "", couleurs = null } = {}) => creer(id, {
    type: "bar",
    data: { labels, datasets: [{ label, data: valeurs, backgroundColor: couleurs || couleur, borderRadius: 5 }] },
    options: { indexAxis: horizontal ? "y" : "x", plugins: { legend: { display: false } }, scales: axes() },
  });
  const anneau = (id, entrees, couleurs = PALETTE) => creer(id, {
    type: "doughnut",
    data: { labels: entrees.map(([k]) => k), datasets: [{ data: entrees.map(([, v]) => v), backgroundColor: couleurs, borderWidth: 0 }] },
    options: { plugins: { legend: legende("right") } },
  });
  const moisLabels = p.mois.map(m => m.label);

  // Astreinte
  creer("stat-chart-interv-mois", {
    type: "bar",
    data: {
      labels: moisLabels,
      datasets: [
        { type: "bar", label: "Interventions", data: s.intervParMois, backgroundColor: "rgba(217,178,76,.75)", borderRadius: 5, yAxisID: "y" },
        { type: "line", label: "Heures", data: s.heuresParMois.map(h => Math.round(h * 10) / 10), borderColor: "#3FB6AC", backgroundColor: "#3FB6AC", tension: .3, yAxisID: "y1" },
      ],
    },
    options: {
      plugins: { legend: legende("top") },
      scales: { ...axes(), y1: { position: "right", beginAtZero: true, ticks: { color: couleurTexte }, grid: { display: false } } },
    },
  });
  creer("stat-chart-tech", {
    type: "bar",
    data: {
      labels: s.techTries.map(([n]) => n),
      datasets: [
        { label: "Heures de jour", data: s.techTries.map(([, o]) => Math.round((o.heures - o.nuit) * 10) / 10), backgroundColor: "rgba(217,178,76,.8)", borderRadius: 4 },
        { label: "Heures de nuit", data: s.techTries.map(([, o]) => Math.round(o.nuit * 10) / 10), backgroundColor: "rgba(139,124,240,.85)", borderRadius: 4 },
      ],
    },
    options: { indexAxis: "y", plugins: { legend: legende("top") }, scales: axes({ x: { stacked: true }, y: { stacked: true } }) },
  });
  anneau("stat-chart-types", s.parType.slice(0, 9));
  anneau("stat-chart-interv-assoc", s.parAssocInterv);
  barres("stat-chart-interv-sites", s.parSiteInterv.map(([k]) => k), s.parSiteInterv.map(([, v]) => v), "rgba(63,182,172,.8)", { horizontal: true });
  barres("stat-chart-interv-jours", JOURS_SEMAINE, s.parJourSemaine, null, { couleurs: JOURS_SEMAINE.map((_, i) => i >= 5 ? "rgba(229,83,61,.8)" : "rgba(217,178,76,.75)") });

  // Demandes
  creer("stat-chart-demandes-mois", {
    type: "bar",
    data: {
      labels: moisLabels,
      datasets: [
        { label: "Reçues", data: s.recuesParMois, backgroundColor: "rgba(139,124,240,.8)", borderRadius: 4 },
        { label: "Réalisées", data: s.realiseesParMois, backgroundColor: "rgba(63,182,172,.8)", borderRadius: 4 },
      ],
    },
    options: { plugins: { legend: legende("top") }, scales: axes() },
  });
  anneau("stat-chart-demandes-urgence", s.urgenceTriee, s.urgenceTriee.map(([u]) => COULEUR_URGENCE[u] || "#888"));
  const COULEUR_STATUT = { "Réalisé": "#3FB6AC", "En cours / à traiter": "#D9B24C", "Annulé": "#E5533D" };
  anneau("stat-chart-demandes-statut", s.statutTrie, s.statutTrie.map(([k], i) => COULEUR_STATUT[k] || PALETTE[(i + 4) % PALETTE.length]));
  anneau("stat-chart-demandes-assoc", s.parAssocDem);
  barres("stat-chart-demandes-sites", s.parSiteDem.map(([k]) => k), s.parSiteDem.map(([, v]) => v), "rgba(139,124,240,.8)", { horizontal: true });
  barres("stat-chart-demandes-type", s.parTypeDem.map(([k]) => k), s.parTypeDem.map(([, v]) => v), "rgba(111,168,220,.8)", { horizontal: true });
  const tranches = Object.entries(s.tranchesAge);
  barres("stat-chart-demandes-age", tranches.map(([k]) => k), tranches.map(([, v]) => v), null, { couleurs: ["#3FB6AC", "#D9B24C", "#E0823D", "#E5533D"] });

  // Compteurs
  barres("stat-chart-releves-mois", moisLabels, s.relevesParMois, "rgba(111,168,220,.8)");

  // Prévisionnel
  const clesStatut = Object.keys(s.statutsLabels);
  barres("stat-chart-previsionnel", clesStatut.map(k => s.statutsLabels[k]), clesStatut.map(k => s.parStatutPrev[k] || 0), null,
    { horizontal: true, couleurs: ["rgba(217,178,76,.8)", "rgba(63,182,172,.85)", "rgba(229,83,61,.75)", "rgba(139,150,166,.6)"] });
  barres("stat-chart-previsionnel-cat", s.categoriePrevTriee.map(([k]) => k), s.categoriePrevTriee.map(([, v]) => v), "rgba(217,178,76,.8)", { horizontal: true });

  // Stock
  creer("stat-chart-quotepart", {
    type: "pie",
    data: { labels: s.quotePartTriee.map(([n]) => n), datasets: [{ data: s.quotePartTriee.map(([, q]) => q), backgroundColor: PALETTE, borderWidth: 0 }] },
    options: { plugins: { legend: { display: false } } },
  });
  barres("stat-chart-top-produits", s.topProduitsTries.map(([k]) => k), s.topProduitsTries.map(([, v]) => v), "rgba(217,178,76,.8)", { horizontal: true });
  barres("stat-chart-commandes-mois", moisLabels, s.commandesParMois, "rgba(63,182,172,.8)");

  // Absences
  const clesAbs = Object.keys(TYPE_ABSENCE_LABELS);
  creer("stat-chart-absences-type", {
    type: "doughnut",
    data: { labels: clesAbs.map(k => TYPE_ABSENCE_LABELS[k]), datasets: [{ data: clesAbs.map(k => s.joursParType[k] || 0), backgroundColor: clesAbs.map(k => COULEUR_ABSENCE[k]), borderWidth: 0 }] },
    options: { plugins: { legend: legende("right") } },
  });
  barres("stat-chart-absences-mois", moisLabels, s.absencesParMois, "rgba(217,178,76,.75)", { label: "Jours d'absence" });

  // Fiches
  creer("stat-chart-fiches-semaine", {
    type: "line",
    data: {
      labels: s.semaine12.map(w => new Date(w + "T12:00:00").toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })),
      datasets: [{ label: "Fiches", data: s.fichesParSemaine, borderColor: "#3FB6AC", backgroundColor: "rgba(63,182,172,.2)", fill: true, tension: .3 }],
    },
    options: { plugins: { legend: { display: false } }, scales: axes() },
  });
}

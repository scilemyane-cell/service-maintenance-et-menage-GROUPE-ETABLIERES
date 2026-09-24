// statistiques.js
// Tableau de bord statistiques — vue d'ensemble agrégée sur l'ensemble
// des modules de l'appli (interventions, stock, prévisionnel travaux,
// sites, compteurs, Masterlock, absences, demandes, fiches ménage,
// commandes fournisseurs), pensé pour une présentation professionnelle
// (chiffres clés + graphiques Chart.js) — notamment à destination de la
// direction.

import { db } from "./firebase-init.js";
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { esc } from "./astreinte-logic.js";

let mountedContainer = null;
let graphiquesActifs = {};

export async function mountStatistiques(container) {
  mountedContainer = container;
  container.innerHTML = `<div class="hint">⏳ Calcul des statistiques…</div>`;
  const data = await collecterDonnees();
  render(data);
}

async function collecterDonnees() {
  const [
    interventionsSnap, sitesSnap, stockProduitsSnap,
    stockMenageProduitsSnap, stockMenageSortiesSnap,
    previsionnelSnap, masterlockSnap, compteursSnap,
    absencesSnap, demandesSnap, fichesSnap, commandesSnap,
  ] = await Promise.all([
    getDocs(collection(db, "interventions")),
    getDocs(collection(db, "sites-dossiers")),
    getDocs(collection(db, "stock-produits")),
    getDocs(collection(db, "stock-menage-produits")),
    getDocs(collection(db, "stock-menage-sorties")),
    getDocs(collection(db, "previsionnel-travaux")),
    getDocs(collection(db, "masterlock-codes")),
    getDocs(collection(db, "compteurs")),
    getDocs(collection(db, "absences")),
    getDocs(collection(db, "demandes")),
    getDocs(collection(db, "fiches")),
    getDocs(collection(db, "stock-commandes")),
  ]);

  const interventions = []; interventionsSnap.forEach(d => interventions.push(d.data()));
  const sites = []; sitesSnap.forEach(d => { if (!d.data().supprimeLe) sites.push(d.data()); });
  const stockProduits = []; stockProduitsSnap.forEach(d => { if (!d.data().supprimeLe) stockProduits.push(d.data()); });
  const stockMenageProduits = []; stockMenageProduitsSnap.forEach(d => { if (!d.data().supprimeLe) stockMenageProduits.push(d.data()); });
  const stockMenageSorties = []; stockMenageSortiesSnap.forEach(d => stockMenageSorties.push(d.data()));
  const previsionnel = []; previsionnelSnap.forEach(d => { if (!d.data().supprimeLe) previsionnel.push(d.data()); });
  const masterlockCodes = []; masterlockSnap.forEach(d => { if (!d.data().supprimeLe) masterlockCodes.push(d.data()); });
  const compteurs = []; compteursSnap.forEach(d => { if (!d.data().supprimeLe) compteurs.push(d.data()); });
  const absences = []; absencesSnap.forEach(d => absences.push(d.data()));
  const demandes = []; demandesSnap.forEach(d => demandes.push(d.data()));
  const fiches = []; fichesSnap.forEach(d => fiches.push(d.data()));
  const commandes = []; commandesSnap.forEach(d => commandes.push(d.data()));

  return {
    interventions, sites, stockProduits, stockMenageProduits, stockMenageSorties,
    previsionnel, masterlockCodes, compteurs, absences, demandes, fiches, commandes,
  };
}

function formatMontant(n) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n || 0);
}

// Nombre de jours (inclusif) entre deux dates ISO "YYYY-MM-DD".
function nbJours(start, end) {
  if (!start) return 0;
  const d1 = new Date(start);
  const d2 = end ? new Date(end) : d1;
  return Math.max(1, Math.round((d2 - d1) / 86400000) + 1);
}

const STATUTS_TRAITES_DEMANDES = ["Réalisé", "Annulé"];
const COULEUR_URGENCE = { "Normal": "#3FB6AC", "Urgent": "#D9B24C", "À planifier": "#8B96A6", "Non renseignée": "#5A6577", "Critique": "#E5533D" };
const TYPE_ABSENCE_LABELS = { conge: "Congés", rtt: "RTT", arret: "Arrêts" };
const COULEUR_ABSENCE = { conge: "#D9B24C", rtt: "#3FB6AC", arret: "#E5533D" };

function render(data) {
  const maintenant = new Date();
  const anneeCourante = maintenant.getFullYear();
  const moisCourant = maintenant.toISOString().slice(0, 7);

  // ---- Chiffres clés (existant) ----
  const interventionsCeMois = data.interventions.filter(i => i.date && i.date.startsWith(moisCourant));
  const interventionsCetteAnnee = data.interventions.filter(i => i.date && i.date.startsWith(String(anneeCourante)));
  const totalHeuresAnnee = interventionsCetteAnnee.reduce((s, i) => s + (parseFloat(i.heures) || 0), 0);
  const produitsAlerteMaintenance = data.stockProduits.filter(p => (p.stockActuel || 0) <= (p.seuilMin || 0)).length;
  const produitsAlerteMenage = data.stockMenageProduits.filter(p => (p.stockActuel || 0) <= (p.stockMin || 0)).length;
  const previsionnelAnnee = data.previsionnel.filter(l => l.anneeVisee === anneeCourante || l.anneeVisee === anneeCourante + 1);
  const montantPropose = previsionnelAnnee.reduce((s, l) => s + (l.montantEstime || 0), 0);
  const montantValide = previsionnelAnnee.filter(l => l.statut === "valide").reduce((s, l) => s + (l.montantEstime || 0), 0);

  // ---- Interventions par mois (12 derniers mois) ----
  const mois12 = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(maintenant.getFullYear(), maintenant.getMonth() - i, 1);
    mois12.push({ cle: d.toISOString().slice(0, 7), label: d.toLocaleDateString("fr-FR", { month: "short", year: "2-digit" }) });
  }
  const interventionsParMois = mois12.map(m => data.interventions.filter(i => i.date && i.date.startsWith(m.cle)).length);

  // ---- Répartition par type d'intervention ----
  const parType = {};
  data.interventions.forEach(i => { const t = i.type || "Autre"; parType[t] = (parType[t] || 0) + 1; });
  const typesTries = Object.entries(parType).sort((a, b) => b[1] - a[1]).slice(0, 8);

  // ---- Prévisionnel travaux par statut ----
  const statutsLabels = { propose: "Proposé", valide: "Validé", refuse: "Refusé", reporte: "Reporté" };
  const parStatut = { propose: 0, valide: 0, refuse: 0, reporte: 0 };
  previsionnelAnnee.forEach(l => { parStatut[l.statut] = (parStatut[l.statut] || 0) + (l.montantEstime || 0); });

  // ---- Stock Ménage : entrées/sorties de l'année + quote-part par attribution ----
  const mouvementsAnnee = data.stockMenageSorties.filter(s => new Date(s.date || 0).getFullYear() === anneeCourante);
  const totalEntrees = mouvementsAnnee.filter(s => s.type === "entree").reduce((s, m) => s + (m.quantite || 0), 0);
  const totalSorties = mouvementsAnnee.filter(s => s.type !== "entree").reduce((s, m) => s + (m.quantite || 0), 0);
  const quotePart = {};
  mouvementsAnnee.filter(s => s.type !== "entree" && s.attributionNom).forEach(s => {
    quotePart[s.attributionNom] = (quotePart[s.attributionNom] || 0) + (s.quantite || 0);
  });
  const quotePartTriee = Object.entries(quotePart).sort((a, b) => b[1] - a[1]);

  // ---- Absences / congés / RTT / arrêts ----
  const absencesAnnee = data.absences.filter(a => a.start && new Date(a.start).getFullYear() === anneeCourante);
  const joursParType = { conge: 0, rtt: 0, arret: 0 };
  absencesAnnee.forEach(a => { const t = a.type || "conge"; joursParType[t] = (joursParType[t] || 0) + nbJours(a.start, a.end); });
  const totalJoursAbsence = Object.values(joursParType).reduce((s, n) => s + n, 0);
  const joursParPersonne = {};
  absencesAnnee.forEach(a => { const p = a.person || "Non renseigné"; joursParPersonne[p] = (joursParPersonne[p] || 0) + nbJours(a.start, a.end); });
  const personnesTriees = Object.entries(joursParPersonne).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const absencesParMois = mois12.map(m => absencesAnnee.filter(a => a.start && a.start.startsWith(m.cle)).length);

  // ---- Suivi des demandes d'intervention ----
  const demandesAnnee = data.demandes.filter(d => d.dateDemande && String(d.dateDemande).startsWith(String(anneeCourante)));
  const demandesTraitees = demandesAnnee.filter(d => STATUTS_TRAITES_DEMANDES.includes(d.statut)).length;
  const demandesATraiter = demandesAnnee.length - demandesTraitees;
  const pctTraitees = demandesAnnee.length > 0 ? Math.round((demandesTraitees / demandesAnnee.length) * 100) : 0;
  const parUrgence = {};
  demandesAnnee.forEach(d => { const u = d.urgence || "Non renseignée"; parUrgence[u] = (parUrgence[u] || 0) + 1; });
  const urgenceTriee = Object.entries(parUrgence).sort((a, b) => b[1] - a[1]);
  const demandesParMois = mois12.map(m => data.demandes.filter(d => d.dateDemande && String(d.dateDemande).startsWith(m.cle)).length);

  // ---- Fiches ménage (activité terrain) ----
  const fichesAnnee = data.fiches.filter(f => f.weekStart && f.weekStart.startsWith(String(anneeCourante)));
  const fichesCeMois = data.fiches.filter(f => f.weekStart && f.weekStart.startsWith(moisCourant));
  const fichesSoumises = fichesAnnee.filter(f => f.submitted).length;
  const semaine12 = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(maintenant); d.setDate(d.getDate() - i * 7);
    const lundi = new Date(d); lundi.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    semaine12.push(lundi.toISOString().slice(0, 10));
  }
  const fichesParSemaine = semaine12.map(cle => data.fiches.filter(f => f.weekStart === cle).length);

  // ---- Commandes fournisseurs (stock maintenance) ----
  const commandesAnnee = data.commandes.filter(c => c.date?.toDate && c.date.toDate().getFullYear() === anneeCourante);
  const commandesParMois = mois12.map(m => data.commandes.filter(c => {
    if (!c.date?.toDate) return false;
    return c.date.toDate().toISOString().slice(0, 7) === m.cle;
  }).length);

  mountedContainer.innerHTML = `
    <div class="stack">
      <p class="hint">Vue d'ensemble de l'activité — mise à jour à chaque ouverture de cet écran.</p>

      <div class="stats-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px">
        ${carteKpi("🏢", data.sites.length, "Sites gérés")}
        ${carteKpi("🛠️", interventionsCeMois.length, "Interventions ce mois")}
        ${carteKpi("⏱️", totalHeuresAnnee.toFixed(0) + " h", "Heures d'astreinte " + anneeCourante)}
        ${carteKpi("📦", produitsAlerteMaintenance + produitsAlerteMenage, "Produits sous le seuil", (produitsAlerteMaintenance + produitsAlerteMenage) > 0 ? "var(--red)" : null)}
        ${carteKpi("🔐", data.masterlockCodes.length, "Codes Masterlock")}
        ${carteKpi("📟", data.compteurs.length, "Compteurs suivis")}
        ${carteKpi("💰", formatMontant(montantPropose), "Prévisionnel " + anneeCourante)}
        ${carteKpi("✅", formatMontant(montantValide), "Dont validé CA")}
        ${carteKpi("🌴", totalJoursAbsence, "Jours d'absence " + anneeCourante)}
        ${carteKpi("📄", demandesAnnee.length, "Demandes reçues " + anneeCourante)}
        ${carteKpi("✔️", pctTraitees + "%", "Demandes traitées", pctTraitees >= 70 ? "var(--teal)" : "var(--gold)")}
        ${carteKpi("🧽", fichesCeMois.length, "Fiches ménage ce mois")}
      </div>

      <div class="form-card">
        <h3 style="margin:0 0 12px;font-size:14px;color:var(--gold)">Interventions astreinte — 12 derniers mois</h3>
        <div style="position:relative;height:240px"><canvas id="stat-chart-interv-mois"></canvas></div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px" class="stats-2col">
        <div class="form-card">
          <h3 style="margin:0 0 12px;font-size:14px;color:var(--gold)">Répartition par type d'intervention</h3>
          <div style="position:relative;height:240px"><canvas id="stat-chart-types"></canvas></div>
        </div>
        <div class="form-card">
          <h3 style="margin:0 0 12px;font-size:14px;color:var(--gold)">Prévisionnel travaux ${anneeCourante} — par statut</h3>
          <div style="position:relative;height:240px"><canvas id="stat-chart-previsionnel"></canvas></div>
        </div>
      </div>

      <div class="form-card">
        <h3 style="margin:0 0 4px;font-size:14px;color:var(--gold)">Stock Ménage ${anneeCourante} — entrées / sorties</h3>
        <p class="hint" style="margin:0 0 12px">École + Agropolis confondus</p>
        <div style="display:flex;gap:24px;flex-wrap:wrap;margin-bottom:16px">
          <div style="text-align:center">
            <p style="margin:0;font-size:32px;font-weight:800;color:var(--teal, #3FB6AC)">${totalEntrees}</p>
            <p class="hint" style="margin:0">📥 unités entrées (réappro)</p>
          </div>
          <div style="text-align:center">
            <p style="margin:0;font-size:32px;font-weight:800;color:var(--gold)">${totalSorties}</p>
            <p class="hint" style="margin:0">📤 unités sorties (consommées)</p>
          </div>
        </div>
        <h4 style="margin:0 0 10px;font-size:13px;color:var(--text-dim)">Quote-part des sorties par site / MNA</h4>
        ${quotePartTriee.length === 0 ? `<p class="hint">Aucune sortie enregistrée pour ${anneeCourante}.</p>` : `
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:center" class="stats-2col">
            <div style="position:relative;height:220px"><canvas id="stat-chart-quotepart"></canvas></div>
            <div>
              ${quotePartTriee.map(([nom, qte]) => {
                const pct = totalSorties > 0 ? Math.round((qte / totalSorties) * 100) : 0;
                return `<div style="display:flex;justify-content:space-between;font-size:12px;padding:4px 0;border-bottom:1px solid var(--border)"><span>${esc(nom)}</span><b>${qte} (${pct}%)</b></div>`;
              }).join("")}
            </div>
          </div>
        `}
      </div>

      <div class="form-card">
        <h3 style="margin:0 0 4px;font-size:14px;color:var(--gold)">Astreinte — Absences ${anneeCourante}</h3>
        <p class="hint" style="margin:0 0 12px">Congés, RTT et arrêts, en jours</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px" class="stats-2col">
          <div style="position:relative;height:220px"><canvas id="stat-chart-absences-type"></canvas></div>
          <div style="position:relative;height:220px"><canvas id="stat-chart-absences-mois"></canvas></div>
        </div>
        ${personnesTriees.length === 0 ? "" : `
          <h4 style="margin:16px 0 10px;font-size:13px;color:var(--text-dim)">Répartition par personne</h4>
          ${personnesTriees.map(([nom, j]) => `<div style="display:flex;justify-content:space-between;font-size:12px;padding:4px 0;border-bottom:1px solid var(--border)"><span>${esc(nom)}</span><b>${j} j</b></div>`).join("")}
        `}
      </div>

      <div class="form-card">
        <h3 style="margin:0 0 4px;font-size:14px;color:var(--gold)">Suivi des demandes ${anneeCourante}</h3>
        <p class="hint" style="margin:0 0 12px">${demandesAnnee.length} demande(s) reçue(s) · ${demandesATraiter} encore à traiter · ${pctTraitees}% traitées</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px" class="stats-2col">
          <div style="position:relative;height:220px"><canvas id="stat-chart-demandes-mois"></canvas></div>
          <div style="position:relative;height:220px"><canvas id="stat-chart-demandes-urgence"></canvas></div>
        </div>
      </div>

      <div class="form-card">
        <h3 style="margin:0 0 4px;font-size:14px;color:var(--gold)">Fiches ménage — activité terrain</h3>
        <p class="hint" style="margin:0 0 12px">${fichesAnnee.length} fiche(s) sur ${anneeCourante}, dont ${fichesSoumises} soumise(s)</p>
        <div style="position:relative;height:220px"><canvas id="stat-chart-fiches-semaine"></canvas></div>
      </div>

      <div class="form-card">
        <h3 style="margin:0 0 4px;font-size:14px;color:var(--gold)">Commandes fournisseurs (stock maintenance)</h3>
        <p class="hint" style="margin:0 0 12px">${commandesAnnee.length} commande(s) passée(s) en ${anneeCourante}</p>
        <div style="position:relative;height:220px"><canvas id="stat-chart-commandes-mois"></canvas></div>
      </div>
    </div>
  `;

  dessinerGraphiques({
    mois12, interventionsParMois, typesTries, statutsLabels, parStatut, quotePartTriee,
    joursParType, absencesParMois, demandesParMois, urgenceTriee, semaine12, fichesParSemaine, commandesParMois,
  });
}

function carteKpi(icone, valeur, label, couleur) {
  return `
    <div class="form-card" style="text-align:center;padding:16px 10px">
      <p style="margin:0;font-size:22px">${icone}</p>
      <p style="margin:4px 0 0;font-size:24px;font-weight:800;${couleur ? `color:${couleur}` : ""}">${valeur}</p>
      <p style="margin:2px 0 0;font-size:11px;color:var(--text-dim)">${esc(label)}</p>
    </div>
  `;
}

function dessinerGraphiques(d) {
  Object.values(graphiquesActifs).forEach(c => c.destroy());
  graphiquesActifs = {};
  if (!window.Chart) return;

  const styleCommun = {
    plugins: { legend: { labels: { color: getComputedStyle(document.body).getPropertyValue("--text") || "#eee" } } },
    scales: {
      x: { ticks: { color: "#999" }, grid: { color: "rgba(255,255,255,.06)" } },
      y: { ticks: { color: "#999" }, grid: { color: "rgba(255,255,255,.06)" }, beginAtZero: true },
    },
  };
  const palette = ["#B08D46", "#3FB6AC", "#C24444", "#6B5CA5", "#4C8CC2", "#C29A3F", "#5FA85A", "#A15C9E"];

  const ctxMois = document.getElementById("stat-chart-interv-mois");
  if (ctxMois) {
    graphiquesActifs.mois = new window.Chart(ctxMois, {
      type: "bar",
      data: {
        labels: d.mois12.map(m => m.label),
        datasets: [{ label: "Interventions", data: d.interventionsParMois, backgroundColor: "rgba(176,141,70,0.75)", borderRadius: 5 }],
      },
      options: { ...styleCommun, plugins: { legend: { display: false } }, maintainAspectRatio: false },
    });
  }

  const ctxTypes = document.getElementById("stat-chart-types");
  if (ctxTypes) {
    graphiquesActifs.types = new window.Chart(ctxTypes, {
      type: "doughnut",
      data: {
        labels: d.typesTries.map(([t]) => t),
        datasets: [{ data: d.typesTries.map(([, n]) => n), backgroundColor: palette }],
      },
      options: { plugins: { legend: { position: "right", labels: { color: "#ccc", boxWidth: 12, font: { size: 10 } } } }, maintainAspectRatio: false },
    });
  }

  const ctxPrev = document.getElementById("stat-chart-previsionnel");
  if (ctxPrev) {
    const cles = Object.keys(d.statutsLabels);
    graphiquesActifs.previsionnel = new window.Chart(ctxPrev, {
      type: "bar",
      data: {
        labels: cles.map(k => d.statutsLabels[k]),
        datasets: [{
          label: "Montant (€)", data: cles.map(k => d.parStatut[k] || 0),
          backgroundColor: ["rgba(176,141,70,.75)", "rgba(63,182,172,.85)", "rgba(194,68,68,.75)", "rgba(150,150,150,.6)"],
          borderRadius: 5,
        }],
      },
      options: { ...styleCommun, plugins: { legend: { display: false } }, indexAxis: "y", maintainAspectRatio: false },
    });
  }

  const ctxQuotePart = document.getElementById("stat-chart-quotepart");
  if (ctxQuotePart && d.quotePartTriee && d.quotePartTriee.length > 0) {
    graphiquesActifs.quotepart = new window.Chart(ctxQuotePart, {
      type: "pie",
      data: {
        labels: d.quotePartTriee.map(([nom]) => nom),
        datasets: [{ data: d.quotePartTriee.map(([, qte]) => qte), backgroundColor: palette }],
      },
      options: { plugins: { legend: { display: false } }, maintainAspectRatio: false },
    });
  }

  const ctxAbsType = document.getElementById("stat-chart-absences-type");
  if (ctxAbsType) {
    const cles = Object.keys(TYPE_ABSENCE_LABELS);
    graphiquesActifs.absType = new window.Chart(ctxAbsType, {
      type: "doughnut",
      data: {
        labels: cles.map(k => TYPE_ABSENCE_LABELS[k]),
        datasets: [{ data: cles.map(k => d.joursParType[k] || 0), backgroundColor: cles.map(k => COULEUR_ABSENCE[k]) }],
      },
      options: { plugins: { legend: { position: "right", labels: { color: "#ccc", boxWidth: 12, font: { size: 10 } } } }, maintainAspectRatio: false },
    });
  }

  const ctxAbsMois = document.getElementById("stat-chart-absences-mois");
  if (ctxAbsMois) {
    graphiquesActifs.absMois = new window.Chart(ctxAbsMois, {
      type: "bar",
      data: {
        labels: d.mois12.map(m => m.label),
        datasets: [{ label: "Absences démarrées", data: d.absencesParMois, backgroundColor: "rgba(217,178,76,.75)", borderRadius: 5 }],
      },
      options: { ...styleCommun, plugins: { legend: { display: false } }, maintainAspectRatio: false },
    });
  }

  const ctxDemMois = document.getElementById("stat-chart-demandes-mois");
  if (ctxDemMois) {
    graphiquesActifs.demMois = new window.Chart(ctxDemMois, {
      type: "bar",
      data: {
        labels: d.mois12.map(m => m.label),
        datasets: [{ label: "Demandes reçues", data: d.demandesParMois, backgroundColor: "rgba(139,124,240,.75)", borderRadius: 5 }],
      },
      options: { ...styleCommun, plugins: { legend: { display: false } }, maintainAspectRatio: false },
    });
  }

  const ctxDemUrg = document.getElementById("stat-chart-demandes-urgence");
  if (ctxDemUrg && d.urgenceTriee.length > 0) {
    graphiquesActifs.demUrg = new window.Chart(ctxDemUrg, {
      type: "doughnut",
      data: {
        labels: d.urgenceTriee.map(([u]) => u),
        datasets: [{ data: d.urgenceTriee.map(([, n]) => n), backgroundColor: d.urgenceTriee.map(([u]) => COULEUR_URGENCE[u] || "#888") }],
      },
      options: { plugins: { legend: { position: "right", labels: { color: "#ccc", boxWidth: 12, font: { size: 10 } } } }, maintainAspectRatio: false },
    });
  }

  const ctxFichesSem = document.getElementById("stat-chart-fiches-semaine");
  if (ctxFichesSem) {
    graphiquesActifs.fichesSem = new window.Chart(ctxFichesSem, {
      type: "line",
      data: {
        labels: d.semaine12.map(s => new Date(s).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })),
        datasets: [{ label: "Fiches", data: d.fichesParSemaine, borderColor: "#3FB6AC", backgroundColor: "rgba(63,182,172,.2)", fill: true, tension: .3 }],
      },
      options: { ...styleCommun, plugins: { legend: { display: false } }, maintainAspectRatio: false },
    });
  }

  const ctxCmdMois = document.getElementById("stat-chart-commandes-mois");
  if (ctxCmdMois) {
    graphiquesActifs.cmdMois = new window.Chart(ctxCmdMois, {
      type: "bar",
      data: {
        labels: d.mois12.map(m => m.label),
        datasets: [{ label: "Commandes", data: d.commandesParMois, backgroundColor: "rgba(63,182,172,.75)", borderRadius: 5 }],
      },
      options: { ...styleCommun, plugins: { legend: { display: false } }, maintainAspectRatio: false },
    });
  }
}

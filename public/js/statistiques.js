// statistiques.js
// Tableau de bord statistiques — vue d'ensemble agrégée sur les
// principaux modules de l'appli (interventions, stock, prévisionnel
// travaux, sites, compteurs, Masterlock), pensé pour une présentation
// professionnelle (chiffres clés + graphiques Chart.js).

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
  ] = await Promise.all([
    getDocs(collection(db, "interventions")),
    getDocs(collection(db, "sites-dossiers")),
    getDocs(collection(db, "stock-produits")),
    getDocs(collection(db, "stock-menage-produits")),
    getDocs(collection(db, "stock-menage-sorties")),
    getDocs(collection(db, "previsionnel-travaux")),
    getDocs(collection(db, "masterlock-codes")),
    getDocs(collection(db, "compteurs")),
  ]);

  const interventions = []; interventionsSnap.forEach(d => interventions.push(d.data()));
  const sites = []; sitesSnap.forEach(d => { if (!d.data().supprimeLe) sites.push(d.data()); });
  const stockProduits = []; stockProduitsSnap.forEach(d => { if (!d.data().supprimeLe) stockProduits.push(d.data()); });
  const stockMenageProduits = []; stockMenageProduitsSnap.forEach(d => { if (!d.data().supprimeLe) stockMenageProduits.push(d.data()); });
  const stockMenageSorties = []; stockMenageSortiesSnap.forEach(d => stockMenageSorties.push(d.data()));
  const previsionnel = []; previsionnelSnap.forEach(d => { if (!d.data().supprimeLe) previsionnel.push(d.data()); });
  const masterlockCodes = []; masterlockSnap.forEach(d => { if (!d.data().supprimeLe) masterlockCodes.push(d.data()); });
  const compteurs = []; compteursSnap.forEach(d => { if (!d.data().supprimeLe) compteurs.push(d.data()); });

  return { interventions, sites, stockProduits, stockMenageProduits, stockMenageSorties, previsionnel, masterlockCodes, compteurs };
}

function formatMontant(n) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n || 0);
}

function render(data) {
  const maintenant = new Date();
  const anneeCourante = maintenant.getFullYear();
  const moisCourant = maintenant.toISOString().slice(0, 7);

  // ---- Chiffres clés ----
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
    </div>
  `;

  dessinerGraphiques(mois12, interventionsParMois, typesTries, statutsLabels, parStatut, quotePartTriee);
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

function dessinerGraphiques(mois12, interventionsParMois, typesTries, statutsLabels, parStatut, quotePartTriee) {
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

  const ctxMois = document.getElementById("stat-chart-interv-mois");
  if (ctxMois) {
    graphiquesActifs.mois = new window.Chart(ctxMois, {
      type: "bar",
      data: {
        labels: mois12.map(m => m.label),
        datasets: [{ label: "Interventions", data: interventionsParMois, backgroundColor: "rgba(176,141,70,0.75)", borderRadius: 5 }],
      },
      options: { ...styleCommun, plugins: { legend: { display: false } }, maintainAspectRatio: false },
    });
  }

  const ctxTypes = document.getElementById("stat-chart-types");
  if (ctxTypes) {
    const palette = ["#B08D46", "#3FB6AC", "#C24444", "#6B5CA5", "#4C8CC2", "#C29A3F", "#5FA85A", "#A15C9E"];
    graphiquesActifs.types = new window.Chart(ctxTypes, {
      type: "doughnut",
      data: {
        labels: typesTries.map(([t]) => t),
        datasets: [{ data: typesTries.map(([, n]) => n), backgroundColor: palette }],
      },
      options: { plugins: { legend: { position: "right", labels: { color: "#ccc", boxWidth: 12, font: { size: 10 } } } }, maintainAspectRatio: false },
    });
  }

  const ctxPrev = document.getElementById("stat-chart-previsionnel");
  if (ctxPrev) {
    const cles = Object.keys(statutsLabels);
    graphiquesActifs.previsionnel = new window.Chart(ctxPrev, {
      type: "bar",
      data: {
        labels: cles.map(k => statutsLabels[k]),
        datasets: [{
          label: "Montant (€)", data: cles.map(k => parStatut[k] || 0),
          backgroundColor: ["rgba(176,141,70,.75)", "rgba(63,182,172,.85)", "rgba(194,68,68,.75)", "rgba(150,150,150,.6)"],
          borderRadius: 5,
        }],
      },
      options: { ...styleCommun, plugins: { legend: { display: false } }, indexAxis: "y", maintainAspectRatio: false },
    });
  }

  const ctxQuotePart = document.getElementById("stat-chart-quotepart");
  if (ctxQuotePart && quotePartTriee && quotePartTriee.length > 0) {
    const palette = ["#B08D46", "#3FB6AC", "#C24444", "#6B5CA5", "#4C8CC2", "#C29A3F", "#5FA85A", "#A15C9E"];
    graphiquesActifs.quotepart = new window.Chart(ctxQuotePart, {
      type: "pie",
      data: {
        labels: quotePartTriee.map(([nom]) => nom),
        datasets: [{ data: quotePartTriee.map(([, qte]) => qte), backgroundColor: palette }],
      },
      options: { plugins: { legend: { display: false } }, maintainAspectRatio: false },
    });
  }
}

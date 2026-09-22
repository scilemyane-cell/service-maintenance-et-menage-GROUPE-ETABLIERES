// Tableau de bord "Suivi des demandes d'intervention" — reprend le fichier
// Excel externe (hors appli, "SG_Suivi_Demandes_GroupeEtablieres") que
// Valentin tient à jour. Ce fichier n'étant pas stocké dans l'appli, cette
// page N'EST PAS connectée en direct à une source de données : les chiffres
// ci-dessous sont une PHOTO figée, mise à jour manuellement par Claude à
// chaque fois que Valentin envoie le fichier Excel à jour (généralement en
// fin de mois). Pas de saisie possible depuis cet écran.
//
// Structure : un accueil liste chaque mois (page dédiée par mois, avec
// bouton retour), plus un cumul global depuis le début du suivi.
//
// Pour mettre à jour après un nouvel envoi du fichier : ajouter le
// nouveau mois dans DONNEES_DEMANDES.mois (ne jamais réécrire les mois
// précédents — ce sont des photos, l'historique doit rester consultable),
// recalculer .global, changer misAJour, puis redéployer.
import { esc } from "./astreinte-logic.js";

const COULEUR_STATUT = { "Réalisé": "var(--teal)", "En cours / à traiter": "var(--gold)", "Annulé": "var(--red)" };
const COULEUR_ASSOCIATION = { "Agropolis": "var(--gold)", "École": "var(--teal)", "Armonia": "var(--violet)", "Autres": "var(--text-dim)" };
const COULEUR_URGENCE = { "Normal": "var(--teal)", "Urgent": "var(--gold)", "À planifier": "var(--text-dim)", "Non renseignée": "var(--border)", "Critique": "var(--red)" };

const DONNEES_DEMANDES = {
  misAJour: "22/09/2026",
  fichierSource: "SG_Suivi_Demandes_GroupeEtablieres",
  global: {
    total: 891,
    statut: { "Réalisé": 539, "En cours / à traiter": 320, "Annulé": 32 },
    association: { "Agropolis": 738, "École": 132, "Armonia": 6, "Autres": 15 },
    sites: [
      ["RS - La Yole", 148], ["RS - Le Mail", 114], ["RS - Le Bois Blanc", 100], ["RS - Cécile Sauvage", 89],
      ["RS - Le Relais", 86], ["Lycée", 48], ["RS - Les Trois Portes", 42], ["RS - Le Cap", 38],
      ["RS - Les Prêles", 29], ["Fontenay le Comte", 22], ["Sup Santé Animale", 16], ["Lot 1 MNA - AGA SA", 14],
      ["Lot 1 MNA - La Moutonnerie", 14], ["(non renseigné)", 14], ["Lot 1 MNA - AGA", 12], ["RS - Agro RS", 11],
      ["Ecole de Bijouterie", 11], ["Sup Social", 11], ["Siège", 11], ["Sup Agri", 9],
      ["Lot 1 MNA - Saint-Vincent de Paul", 8], ["Lot 1 MNA - Douanier Rousseau", 7], ["Lot 3 MNA - Challans", 6],
      ["Lot 3 MNA - La Yole", 4], ["EDP La-Roche-sur-Yon", 4], ["Lot 3 MNA - Saint-Christophe de Ligneron", 3],
      ["Lot 3 MNA - Saint-Gilles-Croix de Vie", 3], ["Lot 3 MNA - Coëx", 3], ["Restaurant scolaire", 2],
      ["EDP", 2], ["Sup Management", 2], ["Lot 3 MNA - Saint-Jean de Monts", 2], ["EDP Fontenay-le-Comte", 1],
      ["Cafétéria", 1], ["Lot 1 MNA - La Ferme", 1], ["AGRO - Direction", 1], ["tous sites MNA", 1], ["Lot 1 MNA - Bureaux", 1],
    ],
    urgence: { "Normal": 514, "Urgent": 179, "À planifier": 72, "Non renseignée": 124, "Critique": 2 },
  },
  // Comptées sur la date de demande, hors ~47 lignes à date visiblement
  // erronée dans le fichier (année mal saisie, ex. "206", "5202").
  // Chaque entrée est une PHOTO du mois telle qu'observée le jour de la
  // mise à jour — le statut d'une demande peut continuer à évoluer après
  // coup, donc les mois anciens ne sont pas recalculés rétroactivement.
  mois: [
    { cle: "2025-10", label: "Octobre 2025", total: 12,
      statut: { "En cours / à traiter": 8, "Réalisé": 4 },
      association: { "Agropolis": 12 },
      urgence: { "Non renseignée": 12 },
      sites: [["RS - Les Trois Portes", 7], ["RS - Les Prêles", 3], ["RS - La Yole", 1], ["Lot 1 MNA - La Moutonnerie", 1]] },
    { cle: "2025-11", label: "Novembre 2025", total: 3,
      statut: { "Annulé": 1, "Réalisé": 1, "En cours / à traiter": 1 },
      association: { "Agropolis": 1, "École": 2 },
      urgence: { "Non renseignée": 1, "Urgent": 1, "Normal": 1 },
      sites: [["Ecole de Bijouterie", 2], ["RS - Les Prêles", 1]] },
    { cle: "2025-12", label: "Décembre 2025", total: 5,
      statut: { "En cours / à traiter": 2, "Annulé": 1, "Réalisé": 2 },
      association: { "Agropolis": 5 },
      urgence: { "À planifier": 2, "Non renseignée": 3 },
      sites: [["RS - Les Prêles", 3], ["RS - Le Relais", 2]] },
    { cle: "2026-01", label: "Janvier 2026", total: 12,
      statut: { "En cours / à traiter": 9, "Réalisé": 3 },
      association: { "Agropolis": 11, "École": 1 },
      urgence: { "À planifier": 2, "Non renseignée": 8, "Urgent": 1, "Normal": 1 },
      sites: [["RS - Le Cap", 6], ["Lot 1 MNA - Saint-Vincent de Paul", 2], ["RS - Agro RS", 1], ["RS - La Yole", 1], ["RS - Le Bois Blanc", 1], ["Sup Social", 1]] },
    { cle: "2026-02", label: "Février 2026", total: 10,
      statut: { "En cours / à traiter": 3, "Réalisé": 7 },
      association: { "École": 5, "Agropolis": 5 },
      urgence: { "Normal": 1, "Non renseignée": 9 },
      sites: [["Lot 1 MNA - La Moutonnerie", 2], ["Sup Social", 2], ["RS - Le Cap", 2], ["Sup Santé Animale", 1], ["Lycée", 1], ["RS - Le Mail", 1], ["Fontenay le Comte", 1]] },
    { cle: "2026-03", label: "Mars 2026", total: 7,
      statut: { "Réalisé": 4, "Annulé": 2, "En cours / à traiter": 1 },
      association: { "Agropolis": 4, "École": 3 },
      urgence: { "Non renseignée": 4, "Normal": 2, "À planifier": 1 },
      sites: [["RS - La Yole", 3], ["RS - Les Prêles", 1], ["Sup Santé Animale", 1], ["Fontenay le Comte", 1], ["Ecole de Bijouterie", 1]] },
    { cle: "2026-04", label: "Avril 2026", total: 29,
      statut: { "Réalisé": 15, "En cours / à traiter": 13, "Annulé": 1 },
      association: { "Agropolis": 28, "École": 1 },
      urgence: { "Normal": 13, "À planifier": 1, "Non renseignée": 15 },
      sites: [["RS - Le Relais", 7], ["RS - Cécile Sauvage", 6], ["RS - Agro RS", 3], ["RS - La Yole", 3], ["RS - Les Prêles", 2], ["RS - Le Bois Blanc", 2], ["RS - Le Cap", 2], ["RS - Le Mail", 1]] },
    { cle: "2026-05", label: "Mai 2026", total: 29,
      statut: { "Réalisé": 25, "Annulé": 1, "En cours / à traiter": 3 },
      association: { "Agropolis": 28, "École": 1 },
      urgence: { "Non renseignée": 9, "Normal": 12, "À planifier": 6, "Urgent": 2 },
      sites: [["RS - La Yole", 18], ["Lot 3 MNA - Challans", 3], ["RS - Le Cap", 3], ["RS - Cécile Sauvage", 1], ["RS - Le Bois Blanc", 1], ["Lot 3 MNA - Saint-Christophe de Ligneron", 1], ["Lot 3 MNA - Saint-Gilles-Croix de Vie", 1], ["Ecole de Bijouterie", 1]] },
    { cle: "2026-06", label: "Juin 2026", total: 140,
      statut: { "Réalisé": 104, "Annulé": 9, "En cours / à traiter": 27 },
      association: { "École": 36, "Agropolis": 101, "Armonia": 3 },
      urgence: { "Urgent": 17, "Normal": 103, "Non renseignée": 16, "À planifier": 4 },
      sites: [["RS - La Yole", 28], ["RS - Le Mail", 17], ["RS - Cécile Sauvage", 16], ["RS - Le Bois Blanc", 15], ["Lycée", 11], ["Fontenay le Comte", 10], ["RS - Le Relais", 6], ["RS - Le Cap", 5]] },
    { cle: "2026-07", label: "Juillet 2026", total: 214,
      statut: { "Réalisé": 156, "Annulé": 2, "En cours / à traiter": 56 },
      association: { "Armonia": 3, "École": 18, "Agropolis": 193 },
      urgence: { "Urgent": 52, "Normal": 117, "À planifier": 41, "Non renseignée": 4 },
      sites: [["RS - Le Mail", 49], ["RS - La Yole", 39], ["RS - Cécile Sauvage", 23], ["RS - Le Bois Blanc", 15], ["RS - Le Relais", 11], ["RS - Les Trois Portes", 10], ["Lycée", 9], ["RS - Les Prêles", 7]] },
    { cle: "2026-08", label: "Août 2026", total: 162,
      statut: { "Annulé": 3, "En cours / à traiter": 42, "Réalisé": 117 },
      association: { "Agropolis": 151, "École": 11 },
      urgence: { "Normal": 108, "Urgent": 50, "À planifier": 2, "Critique": 1, "Non renseignée": 1 },
      sites: [["RS - Le Bois Blanc", 45], ["RS - Le Relais", 34], ["RS - Le Mail", 29], ["RS - Cécile Sauvage", 21], ["RS - Les Trois Portes", 7], ["Lycée", 6], ["RS - La Yole", 4], ["Fontenay le Comte", 3]] },
    { cle: "2026-09", label: "Septembre 2026", total: 198, partiel: true,
      statut: { "En cours / à traiter": 114, "Réalisé": 75, "Annulé": 9 },
      association: { "Agropolis": 160, "École": 38 },
      urgence: { "Normal": 147, "Urgent": 44, "Non renseignée": 3, "À planifier": 3, "Critique": 1 },
      sites: [["RS - La Yole", 42], ["RS - Le Relais", 25], ["RS - Le Bois Blanc", 20], ["Lycée", 16], ["RS - Cécile Sauvage", 16], ["RS - Le Mail", 13], ["RS - Le Cap", 11], ["RS - Les Prêles", 8]] },
  ],
};

let ui = { moisOuvert: null };

export function mountSuiviDemandesTab(container, user) {
  render(container);
}

function objATableau(obj, couleurs) {
  return Object.entries(obj).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([nom, valeur]) => ({ nom, valeur, couleur: couleurs[nom] || "var(--text-dim)" }));
}

function donutSVG(data, total, centreLabel) {
  const size = 148, r = 53, cx = size / 2, cy = size / 2, sw = 19;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  const segments = data.map(d => {
    const frac = d.valeur / total;
    const len = Math.max(0, frac * circ - (data.length > 1 ? 2 : 0));
    const dashoffset = -offset + circ / 4;
    offset += frac * circ;
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${d.couleur}" stroke-width="${sw}" stroke-linecap="round"
      stroke-dasharray="${len} ${circ - len}" stroke-dashoffset="${dashoffset}">
      <title>${esc(d.nom)} — ${d.valeur} (${Math.round(d.valeur / total * 100)}%)</title>
    </circle>`;
  }).join("");
  return `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="overflow:visible;flex-shrink:0">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--panel-alt)" stroke-width="${sw}"></circle>
      ${segments}
      <text x="${cx}" y="${cy - 3}" text-anchor="middle" style="font-family:'IBM Plex Mono',monospace;font-size:21px;font-weight:600;fill:var(--text)">${total}</text>
      <text x="${cx}" y="${cy + 13}" text-anchor="middle" style="font-size:9px;fill:var(--text-dim);text-transform:uppercase;letter-spacing:.06em">${esc(centreLabel)}</text>
    </svg>`;
}

function legendHTML(data, total) {
  return `<div class="demandes-legend">${data.map(d => `
    <span><i class="demandes-swatch" style="background:${d.couleur}"></i>${esc(d.nom)} <b>${d.valeur}</b> <span class="demandes-legend-pct">${Math.round(d.valeur / total * 100)}%</span></span>
  `).join("")}</div>`;
}

function ubarHTML(data, maxOverride) {
  const max = maxOverride || Math.max(...data.map(d => d.valeur));
  return `<div class="demandes-ubar-row">${data.map(d => `
    <div class="demandes-ubar-item">
      <div class="demandes-ubar-name" title="${esc(d.nom)}">${esc(d.nom)}</div>
      <div class="demandes-ubar-track"><div class="demandes-ubar-fill" style="width:${d.valeur / max * 100}%;background:${d.couleur || "var(--gold)"}" title="${esc(d.nom)} — ${d.valeur}"></div></div>
      <div class="demandes-ubar-count">${d.valeur}</div>
    </div>
  `).join("")}</div>`;
}

function render(container) {
  const cle = ui.moisOuvert;
  const mois = cle ? DONNEES_DEMANDES.mois.find(m => m.cle === cle) : null;
  if (mois) return renderPageMois(container, mois);
  return renderAccueil(container);
}

function renderAccueil(container) {
  const d = DONNEES_DEMANDES;
  const g = d.global;
  const statutTab = objATableau(g.statut, COULEUR_STATUT);
  const assocTab = objATableau(g.association, COULEUR_ASSOCIATION);
  const moisTries = [...d.mois].reverse(); // le plus récent en premier

  container.innerHTML = `
    <div class="stack">
      <div class="demandes-source-note">
        📄 Photo figée du fichier externe <b>${esc(d.fichierSource)}</b> (non connecté à l'appli) — dernière mise à jour : <b>${esc(d.misAJour)}</b>. Envoie le fichier à jour en fin de mois pour ajouter le mois suivant.
      </div>

      <div class="demandes-hero">
        <div class="demandes-hero-value">${g.total}</div>
        <div class="demandes-hero-label">demandes enregistrées depuis le début du suivi</div>
      </div>

      <div class="demandes-tiles">
        <div class="demandes-tile"><div class="demandes-tile-label">Réalisées</div><div class="demandes-tile-value" style="color:var(--teal)">${g.statut["Réalisé"]}</div><div class="demandes-tile-sub">${Math.round(g.statut["Réalisé"] / g.total * 100)}% du total</div></div>
        <div class="demandes-tile"><div class="demandes-tile-label">En cours / à traiter</div><div class="demandes-tile-value" style="color:var(--gold)">${g.statut["En cours / à traiter"]}</div><div class="demandes-tile-sub">${Math.round(g.statut["En cours / à traiter"] / g.total * 100)}%</div></div>
        <div class="demandes-tile"><div class="demandes-tile-label">Annulées</div><div class="demandes-tile-value" style="color:var(--red)">${g.statut["Annulé"]}</div><div class="demandes-tile-sub">${Math.round(g.statut["Annulé"] / g.total * 100)}%</div></div>
        <div class="demandes-tile"><div class="demandes-tile-label">Sites concernés</div><div class="demandes-tile-value">${g.sites.length}</div><div class="demandes-tile-sub">tous établissements confondus</div></div>
      </div>

      <div class="tech-grid" style="grid-template-columns:repeat(auto-fit,minmax(280px,1fr))">
        <div class="form-card"><h3 class="demandes-h3">Statut (cumul)</h3><div class="demandes-donut-block">${donutSVG(statutTab, g.total, "demandes")}${legendHTML(statutTab, g.total)}</div></div>
        <div class="form-card"><h3 class="demandes-h3">Association (cumul)</h3><div class="demandes-donut-block">${donutSVG(assocTab, g.total, "demandes")}${legendHTML(assocTab, g.total)}</div></div>
      </div>

      <div class="form-card">
        <h3 class="demandes-h3">Sites les plus concernés (cumul)</h3>
        <div class="demandes-sites-scroll">${ubarHTML(g.sites.slice(0, 12).map(([nom, valeur]) => ({ nom, valeur })), g.sites[0][1])}</div>
      </div>

      <h2 class="demandes-section-title">Par mois</h2>
      <p class="hint" style="margin-top:-8px">Clique un mois pour ouvrir sa page complète (statut, association, urgence, sites concernés).</p>
      <div class="demandes-mois-grid">
        ${moisTries.map((m, i) => {
          const suivant = moisTries[i + 1]; // mois précédent chronologiquement (liste inversée)
          const delta = suivant ? m.total - suivant.total : null;
          const realisePct = Math.round(((m.statut["Réalisé"] || 0) / m.total) * 100);
          return `
          <button type="button" class="demandes-mois-card" data-mois="${esc(m.cle)}">
            <div class="demandes-mois-card-top">
              <span class="demandes-mois-card-label">${esc(m.label)}</span>
              ${m.partiel ? `<span class="tag" style="background:var(--panel-alt);color:var(--text-dim);font-size:9px">en cours</span>` : ""}
            </div>
            <div class="demandes-mois-card-value">${m.total}</div>
            <div class="demandes-mois-card-sub">
              ${delta === null ? "premier mois du suivi" : delta === 0 ? "= vs mois précédent" : delta > 0 ? `▲ +${delta} vs mois précédent` : `▼ ${delta} vs mois précédent`}
            </div>
            <div class="demandes-mois-card-bar"><div style="width:${realisePct}%;background:var(--teal)"></div></div>
            <div class="demandes-mois-card-sub">${realisePct}% déjà réalisées</div>
          </button>`;
        }).join("")}
      </div>

      <div class="demandes-source-note" style="border-color:var(--gold)">
        ⚠️ <b>Pour un vrai suivi "résolues par mois" :</b> sur les ${g.statut["Réalisé"]} demandes marquées Réalisé, seulement 29% ont une "Date statut" renseignée dans le fichier — sans elle, impossible de savoir dans quel mois une demande a été traitée. Les totaux "reçues" par mois sont fiables ; à corriger côté saisie pour fiabiliser aussi les "résolues".
      </div>
    </div>
  `;

  container.querySelectorAll("[data-mois]").forEach(btn => {
    btn.addEventListener("click", () => { ui.moisOuvert = btn.dataset.mois; render(container); });
  });
}

function renderPageMois(container, m) {
  const statutTab = objATableau(m.statut, COULEUR_STATUT);
  const assocTab = objATableau(m.association, COULEUR_ASSOCIATION);
  const urgenceTab = objATableau(m.urgence, COULEUR_URGENCE);
  const sitesTab = m.sites.map(([nom, valeur]) => ({ nom, valeur }));

  container.innerHTML = `
    <div class="stack">
      <button class="back-btn" id="demandes-retour">← Retour aux mois</button>

      <div class="demandes-hero">
        <div class="demandes-hero-value">${m.total}</div>
        <div class="demandes-hero-label">nouvelles demandes en ${esc(m.label)}${m.partiel ? " (mois en cours, non terminé)" : ""}</div>
      </div>

      <div class="tech-grid" style="grid-template-columns:repeat(auto-fit,minmax(280px,1fr))">
        <div class="form-card"><h3 class="demandes-h3">Statut</h3><div class="demandes-donut-block">${donutSVG(statutTab, m.total, "demandes")}${legendHTML(statutTab, m.total)}</div></div>
        <div class="form-card"><h3 class="demandes-h3">Association</h3><div class="demandes-donut-block">${donutSVG(assocTab, m.total, "demandes")}${legendHTML(assocTab, m.total)}</div></div>
      </div>

      <div class="form-card">
        <h3 class="demandes-h3">Urgence</h3>
        ${ubarHTML(urgenceTab)}
      </div>

      <div class="form-card">
        <h3 class="demandes-h3">Sites concernés ce mois-ci</h3>
        ${ubarHTML(sitesTab)}
      </div>

      <div class="demandes-source-note">
        Cumul depuis le début du suivi (${esc(DONNEES_DEMANDES.misAJour)}) : <b>${DONNEES_DEMANDES.global.total}</b> demandes, dont <b>${m.total}</b> reçues en ${esc(m.label)}.
      </div>
    </div>
  `;

  document.getElementById("demandes-retour").addEventListener("click", () => { ui.moisOuvert = null; render(container); });
}

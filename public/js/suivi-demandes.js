// Tableau de bord "Suivi des demandes d'intervention" — reprend le fichier
// Excel externe (hors appli, "SG_Suivi_Demandes_GroupeEtablieres") que
// Valentin tient à jour. Ce fichier n'étant pas stocké dans l'appli, cette
// page N'EST PAS connectée en direct à une source de données : les chiffres
// ci-dessous sont une PHOTO figée, mise à jour manuellement par Claude à
// chaque fois que Valentin envoie le fichier Excel à jour (généralement en
// fin de mois). Pas de saisie possible depuis cet écran.
//
// Pour mettre à jour après un nouvel envoi du fichier : recalculer les
// valeurs ci-dessous (DONNEES_DEMANDES) à partir du fichier reçu, changer
// misAJour, puis redéployer.
import { esc } from "./astreinte-logic.js";

const DONNEES_DEMANDES = {
  misAJour: "22/09/2026",
  fichierSource: "SG_Suivi_Demandes_GroupeEtablieres",
  totalDemandes: 891,
  realisees: 539,
  enCours: 320,
  recuesMoisCourant: 198,
  libelleMoisCourant: "septembre",
  // Comptées sur la date de demande, hors lignes à date visiblement erronée
  // (année mal saisie, ex. "206", "5202" — 47 lignes exclues).
  mois: [
    { label: "Oct. 2025", valeur: 12 },
    { label: "Nov. 2025", valeur: 3 },
    { label: "Déc. 2025", valeur: 5 },
    { label: "Janv. 2026", valeur: 12 },
    { label: "Févr. 2026", valeur: 10 },
    { label: "Mars 2026", valeur: 7 },
    { label: "Avr. 2026", valeur: 29 },
    { label: "Mai 2026", valeur: 29 },
    { label: "Juin 2026", valeur: 140 },
    { label: "Juil. 2026", valeur: 214 },
    { label: "Août 2026", valeur: 162 },
    { label: "Sept. 2026", valeur: 198 },
  ],
  // Situation actuelle (toutes dates confondues), pas un flux mensuel.
  statuts: [
    { nom: "Réalisé", valeur: 539, couleur: "var(--teal)" },
    { nom: "En cours / à traiter", valeur: 320, couleur: "var(--gold)" },
    { nom: "Annulé", valeur: 32, couleur: "var(--red)" },
  ],
  associations: [
    { nom: "Agropolis", valeur: 738, couleur: "var(--gold)" },
    { nom: "École", valeur: 132, couleur: "var(--teal)" },
    { nom: "Armonia", valeur: 6, couleur: "var(--violet)" },
    { nom: "Autres / non renseigné", valeur: 15, couleur: "var(--text-dim)" },
  ],
  urgences: [
    { nom: "Normal", valeur: 514, couleur: "var(--teal)" },
    { nom: "Urgent", valeur: 179, couleur: "var(--gold)" },
    { nom: "À planifier", valeur: 72, couleur: "var(--text-dim)" },
    { nom: "Non renseignée", valeur: 124, couleur: "var(--border)" },
    { nom: "Critique", valeur: 2, couleur: "var(--red)" },
  ],
  // Colonne "Structure" du fichier — le site concerné par la demande.
  // Casse normalisée (Lycée/lycée, Siège/siège) et doublon de saisie fusionné
  // ("Saint-Vincent de Paul" / "Saint Vincent de Paul").
  sites: [
    { nom: "RS - La Yole", valeur: 148 },
    { nom: "RS - Le Mail", valeur: 114 },
    { nom: "RS - Le Bois Blanc", valeur: 100 },
    { nom: "RS - Cécile Sauvage", valeur: 89 },
    { nom: "RS - Le Relais", valeur: 86 },
    { nom: "Lycée", valeur: 48 },
    { nom: "RS - Les Trois Portes", valeur: 42 },
    { nom: "RS - Le Cap", valeur: 38 },
    { nom: "RS - Les Prêles", valeur: 29 },
    { nom: "Fontenay le Comte", valeur: 22 },
    { nom: "Sup Santé Animale", valeur: 16 },
    { nom: "Lot 1 MNA - AGA SA", valeur: 14 },
    { nom: "Lot 1 MNA - La Moutonnerie", valeur: 14 },
    { nom: "(non renseigné)", valeur: 14 },
    { nom: "Lot 1 MNA - AGA", valeur: 12 },
    { nom: "RS - Agro RS", valeur: 11 },
    { nom: "Ecole de Bijouterie", valeur: 11 },
    { nom: "Sup Social", valeur: 11 },
    { nom: "Siège", valeur: 11 },
    { nom: "Sup Agri", valeur: 9 },
    { nom: "Lot 1 MNA - Saint-Vincent de Paul", valeur: 8 },
    { nom: "Lot 1 MNA - Douanier Rousseau", valeur: 7 },
    { nom: "Lot 3 MNA - Challans", valeur: 6 },
    { nom: "Lot 3 MNA - La Yole", valeur: 4 },
    { nom: "EDP La-Roche-sur-Yon", valeur: 4 },
    { nom: "Lot 3 MNA - Saint-Christophe de Ligneron", valeur: 3 },
    { nom: "Lot 3 MNA - Saint-Gilles-Croix de Vie", valeur: 3 },
    { nom: "Lot 3 MNA - Coëx", valeur: 3 },
    { nom: "Restaurant scolaire", valeur: 2 },
    { nom: "EDP", valeur: 2 },
    { nom: "Sup Management", valeur: 2 },
    { nom: "Lot 3 MNA - Saint-Jean de Monts", valeur: 2 },
    { nom: "EDP Fontenay-le-Comte", valeur: 1 },
    { nom: "Cafétéria", valeur: 1 },
    { nom: "Lot 1 MNA - La Ferme", valeur: 1 },
    { nom: "AGRO - Direction", valeur: 1 },
    { nom: "tous sites MNA", valeur: 1 },
    { nom: "Lot 1 MNA - Bureaux", valeur: 1 },
  ],
};

export function mountSuiviDemandesTab(container, user) {
  render(container);
}

function donutSVG(data, total, centreLabel) {
  const size = 150, r = 54, cx = size / 2, cy = size / 2, sw = 20;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  const segments = data.map(d => {
    const frac = d.valeur / total;
    const len = Math.max(0, frac * circ - 2);
    const dashoffset = -offset + circ / 4;
    offset += frac * circ;
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${d.couleur}" stroke-width="${sw}" stroke-linecap="round"
      stroke-dasharray="${len} ${circ - len}" stroke-dashoffset="${dashoffset}">
      <title>${esc(d.nom)} — ${d.valeur} (${Math.round(d.valeur / total * 100)}%)</title>
    </circle>`;
  }).join("");
  return `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="overflow:visible">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--panel-alt)" stroke-width="${sw}"></circle>
      ${segments}
      <text x="${cx}" y="${cy - 2}" text-anchor="middle" style="font-size:20px;font-weight:700;fill:var(--text)">${total}</text>
      <text x="${cx}" y="${cy + 13}" text-anchor="middle" style="font-size:9px;fill:var(--text-dim);text-transform:uppercase;letter-spacing:.05em">${esc(centreLabel)}</text>
    </svg>`;
}

function legendHTML(data, total) {
  return `<div class="demandes-legend">${data.map(d => `
    <span><i class="demandes-swatch" style="background:${d.couleur}"></i>${esc(d.nom)} — ${d.valeur} (${Math.round(d.valeur / total * 100)}%)</span>
  `).join("")}</div>`;
}

function render(container) {
  const d = DONNEES_DEMANDES;
  const maxMois = Math.max(...d.mois.map(m => m.valeur));
  const maxUrgence = Math.max(...d.urgences.map(u => u.valeur));

  container.innerHTML = `
    <div class="stack">
      <div class="placeholder-card" style="text-align:left;padding:14px 18px">
        📄 Photo figée à partir du fichier Excel externe <b>${esc(d.fichierSource)}</b> (non connecté à l'appli) — dernière mise à jour : <b>${esc(d.misAJour)}</b>. Envoie le fichier à jour en fin de mois pour la prochaine actualisation.
      </div>

      <div class="demandes-tiles">
        <div class="demandes-tile"><div class="demandes-tile-label">Total demandes</div><div class="demandes-tile-value">${d.totalDemandes}</div><div class="demandes-tile-sub">depuis le début du suivi</div></div>
        <div class="demandes-tile"><div class="demandes-tile-label">Réalisées</div><div class="demandes-tile-value">${d.realisees}</div><div class="demandes-tile-sub">${Math.round(d.realisees / d.totalDemandes * 100)}% du total</div></div>
        <div class="demandes-tile"><div class="demandes-tile-label">En cours / à traiter</div><div class="demandes-tile-value">${d.enCours}</div><div class="demandes-tile-sub">${Math.round(d.enCours / d.totalDemandes * 100)}%</div></div>
        <div class="demandes-tile"><div class="demandes-tile-label">Reçues en ${esc(d.libelleMoisCourant)}</div><div class="demandes-tile-value">${d.recuesMoisCourant}</div><div class="demandes-tile-sub">mois en cours, non terminé</div></div>
      </div>

      <div class="form-card">
        <h3 style="margin:0 0 4px;font-size:14px;color:var(--gold)">Demandes reçues par mois</h3>
        <p class="hint" style="margin:0 0 12px">Comptées sur la date de demande.</p>
        <div class="demandes-bar-row">
          ${d.mois.map((m, i) => `
            <div class="demandes-bar-col">
              <div class="demandes-bar-value">${m.valeur}</div>
              <div class="demandes-bar${i === d.mois.length - 1 ? " demandes-bar-current" : ""}" style="height:${Math.max(4, m.valeur / maxMois * 128)}px" title="${esc(m.label)} — ${m.valeur} demande${m.valeur > 1 ? "s" : ""}"></div>
              <div class="demandes-bar-label">${esc(m.label.split(" ")[0])}</div>
            </div>
          `).join("")}
        </div>
      </div>

      <div class="tech-grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr))">
        <div class="form-card">
          <h3 style="margin:0 0 4px;font-size:14px;color:var(--gold)">Répartition par statut</h3>
          <p class="hint" style="margin:0 0 12px">Situation actuelle, toutes dates confondues.</p>
          <div style="display:flex;justify-content:center">${donutSVG(d.statuts, d.totalDemandes, "demandes")}</div>
          ${legendHTML(d.statuts, d.totalDemandes)}
        </div>
        <div class="form-card">
          <h3 style="margin:0 0 4px;font-size:14px;color:var(--gold)">Répartition par association</h3>
          <p class="hint" style="margin:0 0 12px">D'où viennent les demandes.</p>
          <div style="display:flex;justify-content:center">${donutSVG(d.associations, d.totalDemandes, "demandes")}</div>
          ${legendHTML(d.associations, d.totalDemandes)}
        </div>
      </div>

      <div class="form-card">
        <h3 style="margin:0 0 4px;font-size:14px;color:var(--gold)">Répartition par site</h3>
        <p class="hint" style="margin:0 0 12px">${d.sites.length} sites concernés, classés du plus au moins de demandes.</p>
        <div class="demandes-ubar-row demandes-sites-scroll">
          ${d.sites.slice().sort((a, b) => b.valeur - a.valeur).map(s => `
            <div class="demandes-ubar-item">
              <div class="demandes-ubar-name" title="${esc(s.nom)}">${esc(s.nom)}</div>
              <div class="demandes-ubar-track"><div class="demandes-ubar-fill" style="width:${s.valeur / d.sites[0].valeur * 100}%;background:var(--gold)" title="${esc(s.nom)} — ${s.valeur} (${Math.round(s.valeur / d.totalDemandes * 100)}%)"></div></div>
              <div class="demandes-ubar-count">${s.valeur}</div>
            </div>
          `).join("")}
        </div>
      </div>

      <div class="form-card">
        <h3 style="margin:0 0 4px;font-size:14px;color:var(--gold)">Répartition par urgence</h3>
        <p class="hint" style="margin:0 0 12px">Niveau de priorité déclaré à la création de la demande.</p>
        <div class="demandes-ubar-row">
          ${d.urgences.map(u => `
            <div class="demandes-ubar-item">
              <div class="demandes-ubar-name">${esc(u.nom)}</div>
              <div class="demandes-ubar-track"><div class="demandes-ubar-fill" style="width:${u.valeur / maxUrgence * 100}%;background:${u.couleur}" title="${esc(u.nom)} — ${u.valeur} (${Math.round(u.valeur / d.totalDemandes * 100)}%)"></div></div>
              <div class="demandes-ubar-count">${u.valeur}</div>
            </div>
          `).join("")}
        </div>
      </div>

      <div class="placeholder-card" style="text-align:left;padding:14px 18px;border-color:var(--gold)">
        ⚠️ <b>Pour un vrai suivi "résolues par mois" :</b> sur les ${d.realisees} demandes marquées Réalisé, seulement 29% ont une "Date statut" renseignée dans le fichier — sans elle, impossible de savoir dans quel mois une demande a été traitée. Le nombre de "reçues par mois" ci-dessus est fiable ; le nombre de "résolues par mois" ne le sera qu'une fois cette date remplie systématiquement dans le fichier.
      </div>
    </div>
  `;
}

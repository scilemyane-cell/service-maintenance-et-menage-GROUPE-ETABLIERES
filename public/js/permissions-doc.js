// permissions-doc.js
// Page de référence en lecture seule : ce que chaque rôle peut
// concrètement faire sur chaque onglet, aujourd'hui. Compilée à partir
// des rôles autorisés par onglet (app.html) ET des règles de sécurité
// Firestore réelles (firestore.rules) — c'est la base de données qui
// fait foi en dernier ressort, pas seulement ce que l'interface affiche
// ou cache. À mettre à jour à la main si les règles changent.

import { esc } from "./astreinte-logic.js";

const SECTIONS = [
  {
    titre: "Astreinte",
    lignes: [
      ["Calendrier", "Tous", "Lecture pour tous. La création/modification des créneaux d'astreinte est réservée à Super Admin/Admin/N1."],
      ["Absences", "Super Admin, Admin, N1", "Ces 3 rôles seulement — l'onglet n'apparaît même pas pour les autres."],
      ["Interventions", "Super Admin, Admin, N1, Technicien", "Tous ces rôles peuvent créer une intervention. Modifier/supprimer réservé à Super Admin/Admin/N1, ou à l'auteur de l'intervention pour la sienne. Une fois \"Transmise au manager\" (dans un relevé validé), seul Super Admin peut la débloquer."],
      ["Synthèse", "Super Admin, Admin, N1, Direction", "Lecture seule (graphiques et chiffres)."],
      ["Historique transferts", "Super Admin, Admin, N1, Direction", "Lecture seule."],
      ["Coordonnées", "Tous", "Lecture pour tous. Modification des fiches technicien (adresse, km, statut) réservée à Super Admin/Admin/N1."],
      ["Archive relevés", "Super Admin, Admin, N1, Direction", "Lecture seule."],
    ],
  },
  {
    titre: "Dispositifs MNA (Fiches / Traçabilité)",
    lignes: [
      ["Fiches, Traçabilité", "Super Admin, Admin, N1, Direction, Ménage, Mi-temps", "Accès en plus conditionné par \"Accès remplaçants\" ou un onglet bonus (Administration > Utilisateurs) pour un dispositif précis."],
      ["Heures, Répartition", "Idem", "Un agent peut modifier ses propres heures tant qu'elles ne sont pas validées ; une fois validées, seul Super Admin/Admin/N1 peut les modifier ou les supprimer."],
      ["Archive, Paramètres", "Super Admin, Admin, N1, Direction (Archive) / Super Admin, Admin, N1 (Paramètres)", "Lecture/gestion réservée à ces rôles."],
    ],
  },
  {
    titre: "Dossiers de site",
    lignes: [
      ["Dossiers", "Tous", "Tout le monde peut consulter. Créer/modifier une fiche réservé à Super Admin/Admin/N1. Suppression (corbeille) réservée à Super Admin."],
    ],
  },
  {
    titre: "Relevé compteur",
    lignes: [
      ["Sites (relevés)", "Super Admin, Admin, N1, Technicien", "Tous peuvent enregistrer un relevé du jour. Antidater un relevé (date passée) réservé à Super Admin/Admin/N1 — un technicien ne peut saisir qu'un relevé du jour même. Créer ou supprimer un compteur (pas juste un relevé) réservé à Super Admin/Admin/N1. Supprimer un relevé déjà enregistré : Super Admin seul."],
    ],
  },
  {
    titre: "Codes Masterlock",
    lignes: [
      ["Sites", "Super Admin, Admin, N1, Technicien", "Tous peuvent consulter les codes. Modifier un code réservé à Super Admin/Admin/N1 — même si un technicien a l'onglet ouvert, la base de données refuse sa modification. Modifier/supprimer l'historique : Super Admin seul."],
    ],
  },
  {
    titre: "Prévisionnel Travaux",
    lignes: [
      ["Besoins", "Super Admin, Admin, N1, Technicien", "Tous peuvent ajouter un besoin. Une fois créé, seuls Super Admin/Admin/N1 peuvent le modifier ou le supprimer — même l'auteur d'origine ne peut plus y toucher ensuite."],
    ],
  },
  {
    titre: "Suivi des tâches",
    lignes: [
      ["Tâches", "Super Admin uniquement", "Aucun autre rôle n'y a accès, ni en lecture ni en écriture."],
    ],
  },
  {
    titre: "Stock Ménage",
    lignes: [
      ["Stock", "Super Admin, Admin, N1, Ménage, Mi-temps, Technicien", "Super Admin/Admin/N1 voient et modifient tout. Les autres rôles sont limités aux zones qui leur sont attribuées (École et/ou Agropolis, dans Administration > Utilisateurs)."],
    ],
  },
  {
    titre: "Stock maintenance",
    lignes: [
      ["Produits", "Super Admin, Admin, N1", "Technicien n'a pas accès à cet onglet (contrairement à Sites/Inventaire ci-dessous)."],
      ["Inventaire", "Super Admin, Admin, N1, Technicien", "Un technicien peut ajuster une quantité en inventaire rapide, mais ne peut rien modifier d'autre sur la fiche produit (nom, catégorie, fournisseur… réservés à Super Admin/Admin/N1) — la base de données bloque toute autre modification de sa part."],
      ["Commandes", "Super Admin, Admin, N1, Direction", "Technicien n'a pas accès."],
      ["Sites (stock déporté)", "Super Admin, Admin, N1, Technicien", "Un technicien peut ajuster une quantité ou enregistrer une sortie. Ajouter/retirer un article du catalogue d'un site réservé à Super Admin/Admin/N1."],
      ["Catalogue sites, Fournisseurs", "Super Admin, Admin, N1", "Technicien n'a pas accès."],
    ],
  },
  {
    titre: "Administration",
    lignes: [
      ["Utilisateurs, Accès remplaçants, Associations & Sites, Corbeille, Migration photos, Export SharePoint, Impression QR en masse", "Super Admin, Admin", "Un Admin (non Super Admin) ne peut ni créer, ni modifier, ni voir le rôle d'un compte Admin ou Super Admin — protection contre une auto-promotion ou une rétrogradation accidentelle."],
    ],
  },
  {
    titre: "Statistiques",
    lignes: [
      ["Vue d'ensemble", "Super Admin, Admin, N1, Direction", "Lecture seule (tableau de bord global)."],
    ],
  },
];

export function mountPermissionsDoc(container) {
  container.innerHTML = `
    <div class="stack">
      <p class="hint">Référence de ce que chaque rôle peut concrètement faire aujourd'hui, onglet par onglet — compilée à partir des règles de sécurité réelles de la base de données, pas seulement de ce que l'interface affiche. Une action que l'interface autoriserait mais que la base refuse ne fonctionnera jamais, même par erreur. Mise à jour manuelle si les règles changent.</p>
      ${SECTIONS.map(s => `
        <div class="form-card">
          <h3 style="margin:0 0 10px;font-size:14px;color:var(--gold)">${esc(s.titre)}</h3>
          <div class="table-wrap">
            <table style="font-size:12px">
              <thead><tr><th>Onglet</th><th>Qui y accède</th><th>Ce qu'on peut y faire</th></tr></thead>
              <tbody>
                ${s.lignes.map(([onglet, roles, detail]) => `
                  <tr>
                    <td style="font-weight:700;white-space:nowrap">${esc(onglet)}</td>
                    <td style="white-space:nowrap">${esc(roles)}</td>
                    <td>${esc(detail)}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

// listes-registre.js — Catalogue des listes modifiables (Administration >
// ⚙️ Paramétrage) : rubrique, libellé, aide, colonnes, et le module qui
// déclare la liste (chargé à la demande pour connaître ses valeurs d'origine).
//
// NE PAS ajouter ici ce qui est lié à l'Excel des demandes (statuts,
// urgences, catégories de pannes) : ça partira avec la GMAO, on n'y touche pas.

const MOIS_COL = { cle: "saison", label: "Saison", type: "mois" };

export const RUBRIQUES = [
  { id: "ev", label: "Espaces verts", icone: "🌿", listes: [
    { cle: "ev.taches", label: "Prestations espaces verts", charger: () => import("./espaces-verts-data.js"),
      aide: "Ce que l'agent coche à chaque passage. Fréquence = nombre de jours avant alerte de retard (vide = pas d'alerte). Saison = mois où la prestation est attendue (aucun mois = toute l'année).",
      colonnes: [{ cle: "label", label: "Prestation", type: "texte" }, { cle: "groupe", label: "Groupe", type: "texte", suggestions: true }, { cle: "jours", label: "Tous les (jours)", type: "nombre" }, MOIS_COL] },
  ] },
  { id: "planning", label: "Interventions & planning", icone: "🗓️", listes: [
    { cle: "planning.types", label: "Types d'intervention", charger: () => import("./planning.js"),
      aide: "Proposés dans le planning et les interventions récurrentes (plomberie, électricité…)." },
  ] },
  { id: "cles", label: "Clés & accès", icone: "🔑", listes: [
    { cle: "cles.types", label: "Types de clés", charger: () => import("./cles-data.js") },
    { cle: "masterlock.categories", label: "Catégories des boîtes à clés", charger: () => import("./masterlock-data.js") },
    { cle: "plan.tableaux", label: "Types de tableaux électriques", charger: () => import("./plan-cles.js") },
  ] },
  { id: "sites", label: "Sites & carte", icone: "🗺️", listes: [
    { cle: "carte.categories", label: "Couleurs de la carte", charger: () => import("./site-map.js"),
      aide: "Nom et couleur des repères par association. Les catégories elles-mêmes sont fixes (elles suivent le nom de l'association).",
      colonnes: [{ cle: "label", label: "Nom affiché", type: "texte" }, { cle: "couleur", label: "Couleur", type: "couleur" }] },
  ] },
  { id: "menage", label: "Ménage & poubelles", icone: "🧽", listes: [
    { cle: "poubelles.flux", label: "Flux de déchets (poubelles)", charger: () => import("./poubelles.js") },
    { cle: "stockmenage.categories", label: "Catégories du stock ménage", charger: () => import("./stock-menage-data.js") },
  ] },
  { id: "prev", label: "Prévisionnel travaux", icone: "📊", listes: [
    { cle: "previsionnel.categories", label: "Catégories de travaux", charger: () => import("./previsionnel-data.js") },
  ] },
  { id: "fp", label: "Fiches de poste", icone: "📋", listes: [
    { cle: "fp.residences", label: "Résidences administratives", charger: () => import("./fiches-poste-modeles.js") },
    { cle: "fp.associations", label: "Associations de rattachement", charger: () => import("./fiches-poste-modeles.js") },
    { cle: "fp.managers", label: "Managers directs", charger: () => import("./fiches-poste-modeles.js") },
    { cle: "fp.missions", label: "Bibliothèque de missions", charger: () => import("./fiches-poste-modeles.js"),
      aide: "Missions proposées par thème. Niveau 1 = délégation totale, 2 = partage d'intention." },
    { cle: "fp.savoirFaire", label: "Savoir-faire", charger: () => import("./fiches-poste-modeles.js"),
      aide: "Les modèles de poste cochent ces lignes par leur position : on peut corriger un texte ou en ajouter à la fin, mais pas les déplacer ni les retirer." },
    { cle: "fp.savoirEtre", label: "Savoirs-être", charger: () => import("./fiches-poste-modeles.js"),
      aide: "Même principe que les savoir-faire : corriger ou ajouter à la fin." },
    { cle: "fp.chaque", label: "« Chaque collaborateur… »", charger: () => import("./fiches-poste-modeles.js"),
      aide: "Phrases imprimées sur toutes les fiches de poste." },
  ] },
  { id: "rh", label: "Contrats RH", icone: "📝", listes: [
    { cle: "rh.sites", label: "Sites RH", charger: () => import("./contrats-rh-donnees.js") },
    { cle: "rh.associations", label: "Associations", charger: () => import("./contrats-rh-donnees.js") },
    { cle: "rh.managers", label: "Managers", charger: () => import("./contrats-rh-donnees.js") },
    { cle: "rh.metiers", label: "Métiers", charger: () => import("./contrats-rh-donnees.js"),
      aide: "Catégorie 1 = ouvriers / employés, 2 = techniciens / agents de maîtrise, 3 = cadres.",
      colonnes: [{ cle: "nom", label: "Métier", type: "texte" }, { cle: "categorie", label: "Cat.", type: "choix", options: ["1", "2", "3"] }, { cle: "statut", label: "Statut", type: "texte", suggestions: true }] },
    { cle: "rh.remplacements", label: "Motifs de remplacement", charger: () => import("./contrats-rh-donnees.js") },
    { cle: "rh.primes", label: "Primes et autres éléments en €", charger: () => import("./contrats-rh-donnees.js") },
  ] },
];

export const toutesListes = () => RUBRIQUES.flatMap(r => r.listes.map(l => ({ ...l, rubrique: r.id })));

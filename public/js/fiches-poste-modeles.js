// fiches-poste-modeles.js — Propositions pour rédiger les fiches de poste
// (formulaire RH 05 du Groupe Établières) : modèles de poste, bibliothèque de
// missions par thème, savoir-faire et savoirs-être à cocher.

export const ASSOCIATIONS = ["Agropolis", "Ecole des Etablières", "Armonia", "Groupe Établières"];
export const RESIDENCES = ["La Roche Sur Yon", "Cécile Sauvage", "Haras de Vendée", "Les Herbiers", "Blois"];
export const MANAGERS = ["Responsable Maintenance et Entretien", "Coordinateur maintenance", "Directeur des services généraux", "Directeur de site"];

export const POSITIONNEMENT = `Le collaborateur rempli sa fonction dans le respect des textes en vigueur dans l'établissement (règlement intérieur, charte numérique, projet d'établissement, projet du groupe, notes de service, …), des textes officiels légaux (convention collective, code du travail, sécurité…) ainsi que des délégations autorisées par son Manager.`;
export const CHAQUE_COLLABORATEUR = [
  "Fait preuve solidarité au sein de son équipe.",
  "Participe à l'amélioration continue de son poste et de son site en lien avec son Manager.",
  "Participe, sur la base du volontariat et après en avoir échangé avec son Manager, à l'amélioration continue globale en intégrant des groupes projets ponctuels ou en faisant remonter ses idées d'améliorations.",
  "S'attache à respecter en interne comme en externe nos valeurs et la charte graphique.",
];
export const TEXTE_MISSIONS = `La fiche de poste recense les missions principales du poste et non le détail des tâches qui elles peuvent évoluer au quotidien en fonction des besoins du site. La fiche de poste doit être mise à jour uniquement en cas d'évolution de(s) mission(s).
Chaque collaborateur concerné en a eu connaissance des degrés des critères classants de son poste via l'annexe détaillée qui lui a été remise.`;

// Bibliothèque de missions : { id, texte, niveau (1 = délégation totale, 2 = partage d'intention), sous? }
export const MISSIONS = [
  { theme: "🧽 Ménage & hygiène", liste: [
    { id: "m-communs-mna", texte: "Entretien et ménage des parties communes des maisons (cuisine, salon, couloirs, sanitaires).", niveau: 1 },
    { id: "m-communs-res", texte: "Entretien des locaux : ménage des parties communes, bureaux et sanitaires de la résidence.", niveau: 1 },
    { id: "m-locaux", texte: "Entretien et ménage des locaux : salles de cours, bureaux, salles de réunion, circulations et escaliers.", niveau: 1 },
    { id: "m-internat", texte: "Entretien des chambres et lieux de vie de l'internat (parties communes, salles de détente).", niveau: 1 },
    { id: "m-sols", texte: "Entretien des sols : balayage, lavage manuel ou à l'autolaveuse, aspiration.", niveau: 1 },
    { id: "m-corbeilles", texte: "Vidage des corbeilles et évacuation des déchets en respectant le tri.", niveau: 1 },
    { id: "m-vitres", texte: "Nettoyage des vitres, portes, poignées et points de contact.", niveau: 1 },
    { id: "m-materiel", texte: "Entretien du matériel et du chariot de ménage, respect des dosages et des fiches produits.", niveau: 1 },
    { id: "m-sanitaires", texte: "Nettoyage et désinfection régulière des sanitaires et points d'eau.", niveau: 1 },
    { id: "m-linge", texte: "Gestion du linge de maison : lavage, séchage et rangement.", niveau: 1 },
    { id: "m-conso", texte: "Réapprovisionnement des consommables (papier, savon, produits d'entretien) et suivi du stock.", niveau: 1 },
    { id: "m-tracab", texte: "Renseignement des fiches de traçabilité du ménage dans l'application de suivi.", niveau: 1 },
    { id: "m-arrivees", texte: "Participation à la préparation des logements lors des arrivées et départs des jeunes.", niveau: 2 },
    { id: "m-anomalies", texte: "Signalement des anomalies et besoins de maintenance constatés dans les logements.", niveau: 2 },
  ] },
  { theme: "🗑️ Déchets & abords", liste: [
    { id: "d-poubelles", texte: "Sortie et rentrée des poubelles selon le planning de collecte.", niveau: 1 },
    { id: "d-points", texte: "Nettoyage des points de collecte : entretien des abords, maintien de la propreté (local poubelle)", niveau: 1 },
    { id: "d-petits", texte: "Assurer le ramassage ponctuel des petits déchets sur les abords de la résidence et dans le local vélo, afin de maintenir la propreté des espaces communs", niveau: 1 },
    { id: "d-cendrier", texte: "Assurer le vidage de cendrier", niveau: 1 },
    { id: "d-parking", texte: "Ramassage des déchets sur le parking et les abords extérieurs de la résidence.", niveau: 1 },
    { id: "d-tri", texte: "Respect et suivi des consignes de tri des déchets.", niveau: 1 },
  ] },
  { theme: "🌿 Espaces verts", liste: [
    { id: "ev-global", texte: "Entretien des espaces verts : tonte, désherbage, taille, arrosage.", niveau: 1 },
    { id: "ev-haies", texte: "Taille des haies et arbustes, ramassage des feuilles.", niveau: 1 },
    { id: "ev-materiel", texte: "Entretien courant du matériel espaces verts (tondeuse, débroussailleuse, taille-haie).", niveau: 1 },
    { id: "ev-tracab", texte: "Renseignement des fiches de passage espaces verts dans l'application de suivi.", niveau: 1 },
    { id: "ev-planif", texte: "Organisation des passages sur les sites selon la saison et les priorités.", niveau: 2 },
  ] },
  { theme: "🔧 Maintenance technique", liste: [
    { id: "t-interv", texte: "Réaliser les interventions de maintenance préventive et corrective (plomberie, électricité, menuiserie, serrurerie, peinture).", niveau: 1 },
    { id: "t-demandes", texte: "Traiter les demandes d'intervention et renseigner leur clôture dans l'outil de suivi.", niveau: 1 },
    { id: "t-compteurs", texte: "Réaliser les relevés de compteurs (eau, électricité, gaz).", niveau: 1 },
    { id: "t-astreinte", texte: "Assurer l'astreinte technique selon le planning établi.", niveau: 1 },
    { id: "t-securite", texte: "Contrôler le bon fonctionnement des équipements de sécurité (éclairage de secours, extincteurs, portes coupe-feu).", niveau: 1 },
    { id: "t-travaux", texte: "Réaliser les petits travaux d'aménagement et de rénovation des locaux.", niveau: 2 },
    { id: "t-entreprises", texte: "Accompagner les entreprises extérieures et les organismes de contrôle lors de leurs interventions.", niveau: 2 },
    { id: "t-outillage", texte: "Gérer l'outillage, le véhicule et le stock de pièces.", niveau: 1 },
    { id: "t-edl", texte: "Participer aux états des lieux des logements.", niveau: 2 },
  ] },
  { theme: "🗂️ Administratif, achats & suivi", liste: [
    { id: "a-achats", texte: "Suivi et traitement des demandes d'achat : demande de devis, validation de devis, transmission et traitement de la facture.", niveau: 2 },
    { id: "a-presta", texte: "Coordination avec les prestataires et fournisseurs : demande de devis, prise de rendez-vous pour intervention, validation.", niveau: 1 },
    { id: "a-registre", texte: "Suivi du registre de sécurité : archivage des rapports, demande de devis, levée de réserve, passage de commande, prise de rendez-vous pour intervention.", niveau: 2 },
    { id: "a-classement", texte: "Classement, numérisation et mise à jour des dossiers techniques et documentaires des sites.", niveau: 1 },
    { id: "a-plannings", texte: "Support à l'organisation des plannings d'intervention et suivi des tableaux de bord du service.", niveau: 1 },
    { id: "a-courant", texte: "Gestion des tâches administratives courantes du service : courriers, classement, saisie et mise à jour des tableaux de suivi.", niveau: 1 },
    { id: "a-contrats", texte: "Suivi administratif des contrats de maintenance et des contrôles réglementaires (échéances, renouvellements).", niveau: 2 },
    { id: "a-accueil", texte: "Accueil téléphonique du service, enregistrement des demandes d'intervention et information des demandeurs.", niveau: 1 },
  ] },
  { theme: "📋 Organisation & encadrement", liste: [
    { id: "o-planif", texte: "Organiser, planifier, suivre le travail de maintenance", niveau: 2, sous: [
      "Elaborer le planning de l'équipe maintenance pour permettre le bon suivi d'une maintenance préventive et corrective des différents équipements, matériels et bâtiments, en gérant les priorités, la sécurité et les contraintes des sites.",
      "Réagir en cas de panne grave et résoudre les problèmes rapidement",
      "Gérer les relations avec les fournisseurs de pièces et d'outils pour la maintenance",
      "Suivre la mise en œuvre des chantiers.",
      "Contrôler les interventions réalisées, proposer des améliorations des performances en termes de coûts et d'utilisation",
    ] },
    { id: "o-equipe", texte: "Animer son équipe", niveau: 1, sous: [
      "Organiser les équipes, les gérer administrativement, les former et les animer",
      "Leur apporter un appui technique et de résolution de problèmes",
    ] },
    { id: "o-coord", texte: "Coordonner l'activité quotidienne des techniciens et répartir les demandes d'intervention.", niveau: 1 },
    { id: "o-budget", texte: "Gérer le budget maintenance et suivre les dépenses.", niveau: 2 },
    { id: "o-conformite", texte: "Suivre la conformité réglementaire des bâtiments (contrôles périodiques, registres de sécurité, levée des réserves).", niveau: 2 },
    { id: "o-astreinte", texte: "Organiser et planifier l'astreinte technique.", niveau: 1 },
    { id: "o-prestataires", texte: "Consulter, choisir et suivre les entreprises extérieures et prestataires.", niveau: 2 },
  ] },
];
export const missionParId = (id) => MISSIONS.flatMap(t => t.liste).find(m => m.id === id);

export const SAVOIR_FAIRE = [
  "Connaissance des règles d'hygiène et de sécurité en milieu d'hébergement collectif.",
  "Connaissance des règles d'hygiène et de sécurité liées à la collecte des déchets.",
  "Maîtrise des gestes et postures de manutention.",
  "Savoir utiliser le matériel de collecte et de nettoyage.",
  "Savoir utiliser le matériel d'espaces verts en sécurité.",
  "Compétences techniques tous corps d'état (plomberie, électricité, menuiserie…).",
  "Habilitation électrique adaptée au poste.",
  "Lecture de plans et de schémas techniques.",
  "Utilisation des outils numériques (application de suivi, messagerie).",
  "Gestion des priorités, organisation",
  "Rigueur, ponctualité.",
  "Polyvalence",
  "Autonomie",
  "Autonomie, organisation et polyvalence",
  "Gestion des problématiques, facilitateur dans la résolution.",
  "Connaissance de la réglementation des établissements recevant du public (ERP).",
  "Gestion d'un budget et suivi de prestataires.",
  "Maîtrise des outils bureautiques (Excel, Word, messagerie) et des logiciels de gestion de maintenance.",
  "Capacité à rédiger et suivre des documents administratifs (bons de commande, courriers, tableaux de suivi).",
  "Connaissance des procédures de gestion de contrats et de la relation fournisseurs.",
];
export const SAVOIR_ETRE = [
  "Travailler en équipe",
  "Avoir le sens de l'observation",
  "Avoir une bonne capacité d'adaptation et faire preuve de réactivité.",
  "Organisation et rigueur",
  "Relationnel, écoute et communication",
  "Relationnel, écoute et communication dans les relations internes et externes auprès des publics accueillis.",
  "Réactivité - adaptation",
  "Capacité d'analyse",
  "Force de proposition",
  "Discrétion et respect de la confidentialité",
  "Sens du service",
  "Exemplarité et sens des responsabilités",
];

// Modèles de poste : tout ce qui est coché par défaut.
export const MODELES = [
  { id: "menage-mna", poste: "Agent de service", label: "Agent de service — ménage maisons MNA",
    principale: "Sous la responsabilité du Responsable Maintenance et Entretien, l'agent de service assure l'entretien et l'hygiène des parties communes au sein des structures d'hébergement (maisons) accueillant des mineurs non accompagnés (MNA), en suivant les procédures et les protocoles. Il réalise le ménage et le nettoyage des espaces communs afin de garantir un cadre propre, sain et sécurisé pour les jeunes accueillis. Son activité contribue au bien-être et au bon fonctionnement des structures.",
    missions: ["m-communs-mna", "m-sanitaires", "m-linge", "m-anomalies", "m-arrivees"],
    sf: [0, 2, 3, 10, 13, 14], se: [0, 1, 2, 3, 5], manager: "Responsable Maintenance et Entretien", management: false, teletravail: false },
  { id: "menage", poste: "Agent de service", label: "Agent de service — ménage des locaux",
    principale: "Sous la responsabilité du Responsable Maintenance et Entretien, l'agent de service assure l'entretien et l'hygiène des locaux du site (salles de cours, bureaux, circulations, sanitaires, lieux de vie) en suivant les procédures et les protocoles. Il réalise le ménage et le nettoyage afin de garantir un cadre propre, sain et accueillant pour les usagers et les équipes. Son activité contribue au bien-être et au bon fonctionnement de l'établissement.",
    missions: ["m-locaux", "m-sanitaires", "m-sols", "m-corbeilles", "m-vitres", "m-materiel", "m-conso", "m-anomalies"],
    sf: [0, 2, 3, 10, 13, 14], se: [0, 1, 2, 3, 5], manager: "Responsable Maintenance et Entretien", management: false, teletravail: false },
  { id: "residence", poste: "Agent de service", label: "Agent de service — résidence, déchets et espaces verts",
    principale: "Sous la responsabilité du Responsable Maintenance et Entretien, l'agent de service assure l'entretien et l'hygiène des locaux en suivant les procédures et les protocoles, ainsi que la collecte, le tri, le transport et la gestion des déchets ménagers et assimilés afin de garantir la propreté des espaces publics et la bonne organisation de la collecte des déchets. Il assure également le ramassage des déchets sur le parking, la sortie et la rentrée des poubelles, ainsi que l'entretien des espaces verts (tonte, désherbage, taille, arrosage).",
    missions: ["m-communs-res", "d-poubelles", "d-points", "d-petits", "d-cendrier", "d-parking", "ev-global"],
    sf: [1, 2, 3, 10, 13, 14], se: [0, 1, 2, 3, 5], manager: "Responsable Maintenance et Entretien", management: false, teletravail: false },
  { id: "espaces-verts", poste: "Agent espaces verts", label: "Agent espaces verts",
    principale: "Sous la responsabilité du Responsable Maintenance et Entretien, l'agent espaces verts assure l'entretien des espaces extérieurs des différents sites du groupe (tonte, désherbage, taille, ramassage des feuilles, arrosage) afin de garantir des abords propres, accueillants et sécurisés. Il organise ses passages selon la saison et les priorités et en assure la traçabilité.",
    missions: ["ev-global", "ev-haies", "ev-materiel", "ev-tracab", "ev-planif", "m-anomalies"],
    sf: [4, 2, 10, 13, 14], se: [0, 1, 2, 3], manager: "Responsable Maintenance et Entretien", management: false, teletravail: false },
  { id: "technicien", poste: "Technicien de maintenance", label: "Technicien de maintenance",
    principale: "Sous la responsabilité du Responsable Maintenance et Entretien, le technicien de maintenance assure la maintenance préventive et corrective des bâtiments, des équipements et des logements des différents sites du groupe. Il traite les demandes d'intervention, réalise les petits travaux d'aménagement, participe à l'astreinte technique et contribue à la sécurité et au confort des usagers.",
    missions: ["t-interv", "t-demandes", "t-compteurs", "t-astreinte", "t-securite", "t-travaux", "t-entreprises", "t-outillage"],
    sf: [5, 6, 7, 8, 9, 10, 14], se: [0, 1, 2, 3, 4], manager: "Responsable Maintenance et Entretien", management: false, teletravail: false },
  { id: "assistant", poste: "Assistant(e) Maintenance et Entretien", label: "Assistant(e) maintenance et entretien",
    principale: "Sous la responsabilité du Responsable Maintenance et Entretien, l'assistant(e) maintenance et entretien assure le support administratif et organisationnel du service : suivi des demandes d'intervention, coordination avec les prestataires et fournisseurs, gestion des commandes et des factures, ainsi que le suivi administratif des dossiers réglementaires et des contrats. Son activité contribue au bon fonctionnement et à la fluidité de l'activité du service maintenance.",
    missions: ["a-achats", "a-presta", "a-registre", "a-classement", "a-plannings", "a-courant"],
    sf: [17, 18, 19, 10, 13, 14], se: [0, 1, 2, 3, 5], manager: "Responsable Maintenance et Entretien", management: false, teletravail: false },
  { id: "coordinateur", poste: "Coordinateur maintenance", label: "Coordinateur maintenance",
    principale: "Sous la responsabilité du Responsable Maintenance et Entretien, le coordinateur maintenance organise et répartit l'activité quotidienne des techniciens, suit le traitement des demandes d'intervention et participe aux interventions techniques. Il co-organise l'astreinte et assure le lien avec les entreprises extérieures.",
    missions: ["o-coord", "t-demandes", "t-interv", "o-astreinte", "t-entreprises", "t-securite"],
    sf: [5, 8, 9, 11, 12, 14], se: [0, 3, 4, 6, 7, 8], manager: "Responsable Maintenance et Entretien", management: true, teletravail: false },
  { id: "responsable", poste: "Responsable maintenance", label: "Responsable maintenance",
    principale: "Sous la responsabilité du Directeur de service, le responsable maintenance gère la maintenance, l'amélioration des équipements et des bâtiments et leurs adaptations aux évolutions d'organisation ou de technologies. Il peut être responsable d'un budget. Il suit les chantiers et les travaux de maintenance. Il assure la sécurité et l'encadrement technique. Il organise et planifie la maintenance des bâtiments. Il est amené(e) à encadrer une équipe.",
    missions: ["o-planif", "o-equipe"],
    sf: [9, 11, 12, 14], se: [3, 4, 6, 7, 8], manager: "Directeur des services généraux", management: true, teletravail: true },
  { id: "vierge", poste: "", label: "Fiche vierge", principale: "", missions: [], sf: [], se: [], manager: "", management: false, teletravail: false },
];

export function ficheDepuisModele(modeleId) {
  const m = MODELES.find(x => x.id === modeleId) || MODELES[MODELES.length - 1];
  return {
    modele: m.id, poste: m.poste, collaborateur: "", association: "Agropolis", convention: "OEFMT", residence: "La Roche Sur Yon",
    multisite: false, secondSite: "", teletravail: m.teletravail, management: m.management, manager: m.manager,
    principale: m.principale,
    missions: m.missions.map(id => { const x = missionParId(id); return { texte: x.texte, niveau: x.niveau, sous: x.sous ? [...x.sous] : [] }; }),
    savoirFaire: m.sf.map(i => SAVOIR_FAIRE[i]), savoirEtre: m.se.map(i => SAVOIR_ETRE[i]),
    signatureNonConcerne: !m.management, signatures: "",
    etablieLe: new Date().toISOString().slice(0, 10), etabliePar: "le manager",
  };
}

// ============================================================
// Structure des fiches de traçabilité ménage, transcrite depuis
// les documents Word fournis (un fichier par site MNA).
// Chaque tâche peut porter une fréquence indicative (ex. "1X/MOIS")
// affichée à titre informatif ; l'agent coche le(s) jour(s) où la
// tâche a réellement été faite.
// ============================================================

const DAYS = ["LUN", "MAR", "MER", "JEU", "VEN"];

function room(name, days, tasks) {
  return { name, days, tasks: tasks.map(t => (typeof t === "string" ? { label: t } : t)) };
}

export const SITES = [
  {
    id: "svdp",
    name: "Maison MNA Saint Vincent de Paul",
    rooms: [
      room("Bureau", ["MAR"], [
        "Plinthes", "Poignées & interrupteurs", "Sols : aspirateur & lavage",
        "Surfaces : dépoussiérage", "Nettoyage vitres", "Vider les poubelles",
      ]),
      room("Infirmerie", DAYS, [
        "Désinfecter surfaces", "Sols : aspiration & lavage", "Plinthes, poignées, interrupteurs",
      ]),
      room("Escalier", DAYS, [
        "Balayage et serpillage des marches", "Nettoyage des rampes",
        "Poussières rebords", "Plinthes & interrupteurs",
      ]),
      room("Salon", DAYS, [
        "Sols : aspirateur & lavage", "Poussières mobiliers",
        "Nettoyage vitres, poignées & interrupteurs", "Vider les poubelles", "Plinthes & VMC",
      ]),
      room("Cuisine", DAYS, [
        "Nettoyer plan de travail, évier, sol, placards (aspirateur et lavage)",
        { label: "Électroménager : four, frigo, lave-linge, congélateur", freq: "2X/semaine" },
        { label: "Four", freq: "1X/semaine" },
        { label: "Micro-ondes", freq: "2X/semaine" },
        "Vider les poubelles",
        "Désinfection zone de contact",
        { label: "Plinthes", freq: "1X/mois" },
        { label: "Nettoyer les vitres", freq: "1X/3 mois" },
        { label: "VMC", freq: "1X/3 mois" },
        "Poignées & interrupteurs",
      ]),
      room("RDC — salle d'eau et WC", DAYS, [
        "WC : nettoyer & détartrage + poubelle",
        "Douche et lavabo : désinfection",
        "Sol : aspirateur et lavage",
        { label: "VMC & murs", freq: "2X/mois" },
        { label: "Plinthes", freq: "1X/mois" },
        { label: "Vitres", freq: "1X/3 mois" },
        "Poignées & interrupteurs",
      ]),
      room("Local API", DAYS, [
        { label: "Nettoyage frigo", freq: "1X/mois" },
        "Aspirateur & lavage sol",
        "Nettoyage poignées & interrupteurs",
        "Surface mobilier",
        { label: "Plinthes & VMC", freq: "1X/mois" },
      ]),
      room("Entrée", DAYS, [
        "Aspirateur & lavage du sol",
        { label: "Vitres & porte d'entrée", freq: "2X/mois" },
        "Désinfection poignées & interrupteurs",
        { label: "Plinthes", freq: "1X/mois" },
      ]),
      room("1er étage — salle d'eau (1)", DAYS, [
        "Aspirateur & lavage sols",
        "Douche & lavabo : nettoyage",
        { label: "Aérations & plinthes", freq: "1X/mois" },
        "Poignées & interrupteurs",
      ]),
      room("1er étage — salle d'eau (2)", DAYS, [
        "Douche, lavabo : désinfection",
        "Aspirateur & lavage sols & murs",
        { label: "Plinthes", freq: "1X/mois" },
        "Poignées & interrupteurs",
      ]),
      room("WC", DAYS, [
        "WC : nettoyage & détartrage, poubelle",
      ]),
    ],
    literie: true,
  },
  {
    id: "dr",
    name: "Maison MNA DR",
    rooms: [
      room("Bureau", ["MAR"], [
        "Plinthes", "Poignées & interrupteurs", "Sols : aspirateur & lavage",
        "Surfaces : dépoussiérage", "Nettoyage vitres", "Vider les poubelles",
      ]),
      room("Salle de sport", ["MAR"], [
        "Désinfecter surfaces", "Sols : aspiration & lavage", "Plinthes, poignées, interrupteurs",
      ]),
      room("Escalier", DAYS, [
        "Balayage et serpillage des marches", "Nettoyage des rampes",
        "Poussières rebords", "Plinthes & interrupteurs",
      ]),
      room("Salon", DAYS, [
        "Sols : aspirateur & lavage", "Poussières mobiliers",
        "Nettoyage vitres, poignées & interrupteurs", "Vider les poubelles", "Plinthes & VMC",
      ]),
      room("Cuisine", DAYS, [
        "Nettoyer plan de travail, évier, sol, placards (aspirateur et lavage)",
        { label: "Électroménager : four, frigo, lave-linge, congélateur", freq: "2X/semaine" },
        { label: "Four", freq: "1X/semaine" },
        { label: "Micro-ondes", freq: "2X/semaine" },
        "Vider les poubelles",
        "Désinfection zone de contact",
        { label: "Plinthes", freq: "1X/mois" },
        { label: "Nettoyer les vitres", freq: "1X/3 mois" },
        { label: "VMC", freq: "1X/3 mois" },
        "Poignées & interrupteurs",
      ]),
      room("RDC — salle d'eau et WC", DAYS, [
        "WC : nettoyer & détartrage + poubelle",
        "Douche et lavabo : désinfection",
        "Sol : aspirateur et lavage",
        { label: "VMC & murs", freq: "2X/mois" },
        { label: "Plinthes", freq: "1X/mois" },
        { label: "Vitres", freq: "1X/3 mois" },
        "Poignées & interrupteurs",
      ]),
      room("Local API", DAYS, [
        { label: "Nettoyage frigo", freq: "1X/mois" },
        "Aspirateur & lavage sol",
        "Nettoyage poignées & interrupteurs",
        "Surface mobilier",
        { label: "Plinthes & VMC", freq: "1X/mois" },
      ]),
      room("Couloir", DAYS, [
        "Aspirateur & lavage sol",
        "Nettoyage poignées et interrupteurs",
        { label: "Plinthes", freq: "1X/mois" },
      ]),
      room("Entrée", DAYS, [
        "Aspirateur & lavage du sol",
        { label: "Vitres & porte d'entrée", freq: "2X/mois" },
        "Désinfection poignées & interrupteurs",
        { label: "Plinthes", freq: "1X/mois" },
      ]),
      room("1er étage — salle d'eau", DAYS, [
        "Aspirateur & lavage sols",
        "Douche & lavabo : nettoyage",
        { label: "Aérations & plinthes", freq: "1X/mois" },
        "Poignées & interrupteurs",
      ]),
      room("1er étage — salle d'eau + WC", DAYS, [
        "WC : nettoyage & détartrage, poubelle",
        "Douche, lavabo : désinfection",
        "Aspirateur & lavage sols & murs",
        { label: "Plinthes", freq: "1X/mois" },
        "Poignées & interrupteurs",
      ]),
    ],
    literie: true,
  },
  {
    id: "aga",
    name: "Maison MNA AGA",
    rooms: [
      room("Bureau", ["JEU"], [
        "Plinthes", "Poignées & interrupteurs", "Sols : aspirateur & lavage",
        "Surfaces : dépoussiérage", "Nettoyage vitres", "Vider les poubelles", "WC",
      ]),
      room("Salon", DAYS, [
        "Sols : aspirateur & lavage", "Poussières mobiliers",
        "Nettoyage vitres, poignées & interrupteurs", "Vider les poubelles", "Plinthes & VMC",
      ]),
      room("Cuisine", DAYS, [
        "Nettoyer plan de travail, évier, sol, placards (aspirateur et lavage)",
        { label: "Électroménager : four, frigo, lave-linge, congélateur", freq: "2X/semaine" },
        { label: "Four", freq: "1X/semaine" },
        { label: "Micro-ondes", freq: "2X/semaine" },
        "Vider les poubelles",
        "Désinfection zone de contact",
        { label: "Plinthes", freq: "1X/mois" },
        { label: "Nettoyer les vitres", freq: "1X/3 mois" },
        { label: "VMC", freq: "1X/3 mois" },
        "Poignées & interrupteurs",
      ]),
      room("Local API", DAYS, [
        { label: "Nettoyage frigo", freq: "1X/mois" },
        "Aspirateur & lavage sol",
        "Nettoyage poignées & interrupteurs",
        "Surface mobilier",
        { label: "Plinthes & VMC", freq: "1X/mois" },
      ]),
      room("Couloir", DAYS, [
        "Aspirateur & lavage sol",
        "Nettoyage poignées et interrupteurs",
        { label: "Plinthes", freq: "1X/mois" },
      ]),
    ],
    literie: true,
  },
];

export function findSite(id) {
  return SITES.find(s => s.id === id) || SITES[0];
}

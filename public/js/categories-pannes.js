// categories-pannes.js — Catégorie de panne d'une demande d'intervention (statistiques « camembert »).
// Classement automatique d'après les mots du descriptif (et du type), corrigeable à la main par un
// superviseur (champ « categoriePanne » de la demande, prioritaire sur le classement automatique).
export const CATEGORIES_PANNES = [
  // Liste alignée sur les catégories de demande Camileia (refonte du 24/11/2026). Les id restent stables (statistiques).
  { id: "nuisibles", lib: "Nuisibles", ic: "🐭", c: "#7c3aed", mots: ["souris", "rats?", "cafards?", "punaises?", "punaises? de lit", "puces?", "nuisibles?", "insectes?", "guepes?", "frelons?", "fourmis?", "pigeons?", "blattes?", "taupes?", "rongeurs?", "deratis", "desinsect"] },
  { id: "incendie", lib: "Sécurité incendie", ic: "🧯", c: "#dc2626", mots: ["extincteurs?", "alarmes? incendie", "incendie", "detecteurs?", "daaf", "daf", "baes", "desenfumage", "ssi", "fumee", "issue de secours", "sirene", "eclairage de securite"] },
  { id: "toiture", lib: "Humidité / toiture / infiltrations", ic: "🏠", c: "#0e7490", mots: ["toit", "toiture", "gouttieres?", "infiltrations?", "cheneaux?", "tuiles?", "ardoises?", "etancheite", "descente d.eau pluviale", "eaux? pluviales?", "moisi\\w*", "moissi\\w*", "humidite", "humide", "condensation", "champignons?", "salpetre"] },
  { id: "ecs", lib: "Eau chaude", ic: "🚿", c: "#f97316", mots: ["eau chaude", "ballons?", "cumulus", "chauffe.?eau", "ecs", "temperature de l.eau"] },
  { id: "chauffage", lib: "Chauffage / clim / VMC", ic: "🔥", c: "#ef4444", mots: ["chauffage", "radiateurs?", "chaudieres?", "convecteurs?", "seche.?serviettes?", "thermostats?", "plancher chauffant", "clim", "climatis\\w*", "climatiseurs?", "pompe a chaleur", "pac", "il fait froid", "froid", "vmc", "ventilation", "bouches? d.aeration", "aeration"] },
  { id: "serrurerie", lib: "Serrurerie / accès", ic: "🔑", c: "#a16207", mots: ["serrures?", "cles?", "clefs?", "cylindres?", "badges?", "barillets?", "verrous?", "poignees?", "ferme.?portes?", "gaches?", "boite a cle", "masterlock", "cadenas", "portail", "barriere", "boite aux lettres", "bal", "lecteur de (carte|badge)", "porte automatique", "sas"] },
  { id: "courants", lib: "Courants faibles / audiovisuel", ic: "📡", c: "#0d9488", mots: ["interphones?", "visiophones?", "sonnettes?", "sonettes?", "sonneries?", "internet", "wi.?fi", "reseau", "connexion", "box internet", "hdmi", "usb", "video.?projecteurs?", "projecteurs?", "ecrans?", "tele", "televisions?", "tv", "telephones?", "enceintes?", "sono", "micros? (hf|sans fil)", "microphones?", "cables? (hdmi|usb|reseau|rj45|internet|video)"] },
  { id: "electricite", lib: "Électricité", ic: "⚡", c: "#eab308", mots: ["electri\\w*", "prises?", "ampoules?", "lumieres?", "eclairage", "neons?", "disjonct\\w*", "interrupteurs?", "courant", "leds?", "luminaires?", "plafonniers?", "spots?", "tableau electrique", "differentiel", "minuterie", "hublots?", "lampes?", "reglettes?"] },
  { id: "ascenseur", lib: "Ascenseur", ic: "🛗", c: "#475569", mots: ["ascenseurs?", "monte.?charges?", "elevateurs?", "plate.?forme elevatrice", "cabine d.ascenseur", "porte palieres?"] },
  { id: "equipements", lib: "Équipements / électroménager", ic: "🔌", c: "#0891b2", mots: ["plaques?", "four", "frigo", "refrigerateurs?", "lave.?linges?", "lave.?vaisselles?", "micro.?ondes?", "hottes?", "electromenager", "seche.?linges?", "seche.?mains?", "congelateurs?", "machine a laver", "cuisiniere", "bouilloire", "aspirateur"] },
  { id: "plomberie", lib: "Plomberie", ic: "💧", c: "#2563eb", mots: ["fuites?", "robinets?", "eviers?", "lavabos?", "wc", "toilettes?", "chasse", "siphons?", "syphons?", "bondes?", "douches?", "douchettes?", "bouche", "bouchee?s?", "canalisations?", "evacuations?", "mitigeurs?", "mitijeurs?", "joints?", "debouch\\w*", "baignoires?", "lave.?mains?", "urinoirs?", "eau", "ecoulement", "inondation", "degat des eaux", "silicone", "abattant", "fontaine"] },
  { id: "menuiserie", lib: "Menuiserie / vitrerie / stores", ic: "🚪", c: "#92400e", mots: ["portes?", "fenetres?", "volets?", "vitres?", "vitrerie", "carreaux? (casse|fele)", "stores?", "rideaux?", "occultations?", "manivelles?", "placards?", "tiroirs?", "charnieres?", "baies?", "velux", "vitrages?", "huisseries?", "plinthes?", "coursives?"] },
  { id: "nettoyage", lib: "Nettoyage", ic: "🧹", c: "#65a30d", mots: ["nettoy\\w*", "menage", "propre", "propretes?", "sales?", "salete", "odeurs?", "corbeilles?", "consommables?", "papier toilette", "savon"] },
  { id: "logistique", lib: "Logistique / encombrants", ic: "📦", c: "#9333ea", mots: ["encombrants?", "debarras\\w*", "desencombr\\w*", "demenag\\w*", "manutention", "dechetterie", "cartons?", "evacuer", "evacuation des", "deplacer", "transporter", "livraison", "colis", "evenements?", "salon", "banderoles?", "enseignes?", "installer la salle", "amenagement de salle"] },
  { id: "exterieur", lib: "Espaces verts / extérieurs", ic: "🌳", c: "#16a34a", mots: ["espaces? verts?", "haies?", "tontes?", "arbres?", "jardins?", "jardinieres?", "clotures?", "grillages?", "parkings?", "exterieurs?", "feuilles", "branches?", "pelouse", "gazon", "abris?", "bancs?", "poubelles? exterieures?", "voirie", "facades?", "ravalement"] },
  { id: "peinture", lib: "Petits travaux / mobilier", ic: "🖌️", c: "#db2777", mots: ["peintures?", "trous?", "reboucher", "rebouchage", "tapisserie", "faience", "carrelage", "sols?", "murs?", "plafonds?", "dalles?", "cloisons?", "parois?", "fissures?", "etageres?", "fixations?", "refixer", "tringles?", "chevilles?", "accrocher", "montage", "monter", "meubles?", "mobilier", "commodes?", "armoires?", "lits?", "matelas", "chaises?", "tables?", "bureaux?", "miroirs?", "patere", "credence", "tablettes?", "tableau blanc"] },
  { id: "autre", lib: "Autre", ic: "❔", c: "#64748b", mots: [] },
];
const RX = Object.fromEntries(CATEGORIES_PANNES.map(c => [c.id, c.mots.map(m => new RegExp(`(^|[^a-z])${m}($|[^a-z])`))]));
const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[’']/g, " ");

// Classement automatique : la catégorie qui a le plus de mots trouvés ; à égalité, l'ordre de la liste.
export function categorieAuto(texte) {
  let t = norm(texte);
  if (!t.trim()) return "autre";
  // « souris » d'ordinateur (avec clavier, écran, PC…) : ce n'est pas un nuisible.
  if (/(^|[^a-z])(clavier|ecrans?|ordinateurs?|pc|informatique|imprimantes?|usb|video.?surveillance)($|[^a-z])/.test(t)) t = t.replace(/(^|[^a-z])souris($|[^a-z])/g, "$1$2");
  let meilleur = "autre", score = 0;
  // Poids : un mot de métier précis (toiture, chauffage, serrure…) compte plus qu'un mot général (mur, sol, eau…).
  const POIDS = { ascenseur: 3, equipements: 1.5, plomberie: 1.2, menuiserie: 1, exterieur: 1, peinture: 0.7, nettoyage: 1.2, logistique: 1.5, courants: 1.5 };
  CATEGORIES_PANNES.forEach(c => { const n = RX[c.id].filter(r => r.test(t)).length * (POIDS[c.id] ?? 2); if (n > score) { score = n; meilleur = c.id; } });
  return meilleur;
}
// Catégorie retenue pour une demande (ligne du suivi ou document Firestore).
export function categorieDe(d) {
  if (d?.categoriePanne && CATEGORIES_PANNES.some(c => c.id === d.categoriePanne)) return d.categoriePanne;
  return categorieAuto(`${d?.descr || d?.descriptifCorrige || d?.descriptif || ""} ${d?.type || ""}`);
}
export const infoCategorie = (id) => CATEGORIES_PANNES.find(c => c.id === id) || CATEGORIES_PANNES[CATEGORIES_PANNES.length - 1];

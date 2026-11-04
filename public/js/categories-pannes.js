// categories-pannes.js — Catégorie de panne d'une demande d'intervention (statistiques « camembert »).
// Classement automatique d'après les mots du descriptif (et du type), corrigeable à la main par un
// superviseur (champ « categoriePanne » de la demande, prioritaire sur le classement automatique).
export const CATEGORIES_PANNES = [
  { id: "nuisibles", lib: "Nuisibles", ic: "🐭", c: "#7c3aed", mots: ["souris", "rats?", "cafards?", "punaises?", "nuisibles?", "insectes?", "guepes?", "frelons?", "fourmis?", "pigeons?", "blattes?", "taupes?", "deratis", "desinsect"] },
  { id: "incendie", lib: "Sécurité incendie", ic: "🧯", c: "#dc2626", mots: ["extincteurs?", "alarmes?", "incendie", "detecteurs?", "daaf", "daf", "baes", "desenfumage", "ssi", "fumee", "issue de secours", "sirene"] },
  { id: "toiture", lib: "Fuite toiture", ic: "🏠", c: "#0e7490", mots: ["toit", "toiture", "gouttieres?", "infiltrations?", "cheneaux?", "tuiles?", "ardoises?", "etancheite", "descente d.eau pluviale", "eaux? pluviales?", "terrasse"] },
  { id: "ecs", lib: "Panne d'eau chaude", ic: "🚿", c: "#f97316", mots: ["eau chaude", "ballons?", "cumulus", "chauffe.?eau", "ecs", "eau froide", "temperature de l.eau"] },
  { id: "chauffage", lib: "Panne de chauffage", ic: "🔥", c: "#ef4444", mots: ["chauffage", "radiateurs?", "chaudieres?", "convecteurs?", "seche.?serviettes?", "thermostats?", "plancher chauffant", "clim", "climatisation", "pompe a chaleur", "pac", "il fait froid", "froid"] },
  { id: "serrurerie", lib: "Serrurerie", ic: "🔑", c: "#a16207", mots: ["serrures?", "cles?", "clefs?", "cylindres?", "badges?", "barillets?", "verrous?", "poignees?", "ferme.?portes?", "gaches?", "boite a cle", "masterlock", "cadenas"] },
  { id: "electricite", lib: "Électricité", ic: "⚡", c: "#eab308", mots: ["electri\\w*", "prises?", "ampoules?", "lumieres?", "eclairage", "neons?", "disjonct\\w*", "interrupteurs?", "courant", "leds?", "luminaires?", "plafonniers?", "spots?", "tableau electrique", "differentiel", "minuterie", "hublots?", "lampes?", "reglettes?"] },
  { id: "equipements", lib: "Équipements / électroménager", ic: "🔌", c: "#0891b2", mots: ["plaques?", "four", "frigo", "refrigerateurs?", "lave.?linges?", "lave.?vaisselles?", "micro.?ondes?", "hottes?", "electromenager", "seche.?linges?", "congelateurs?", "tele", "television", "tv", "vmc", "ventilation", "machine a laver", "cuisiniere", "bouilloire", "aspirateur", "ascenseur"] },
  { id: "plomberie", lib: "Plomberie", ic: "💧", c: "#2563eb", mots: ["fuites?", "robinets?", "eviers?", "lavabos?", "wc", "toilettes?", "chasse", "siphons?", "bondes?", "douches?", "bouche", "bouchee?s?", "canalisations?", "evacuations?", "mitigeurs?", "joints?", "debouch\\w*", "baignoires?", "lave.?mains?", "urinoirs?", "eau", "ecoulement", "inondation", "degat des eaux"] },
  { id: "menuiserie", lib: "Menuiserie / vitrerie", ic: "🚪", c: "#92400e", mots: ["portes?", "fenetres?", "volets?", "vitres?", "carreaux? (casse|fele)", "stores?", "placards?", "tiroirs?", "charnieres?", "baies?", "velux", "vitrages?", "huisseries?", "plinthes?", "portails?"] },
  { id: "exterieur", lib: "Espaces verts / extérieurs", ic: "🌳", c: "#16a34a", mots: ["espaces? verts?", "haies?", "tontes?", "arbres?", "jardins?", "clotures?", "grillages?", "parkings?", "exterieurs?", "feuilles", "branches?", "pelouse", "gazon", "abris?", "bancs?", "poubelles? exterieures?"] },
  { id: "peinture", lib: "Peinture / petits travaux", ic: "🖌️", c: "#db2777", mots: ["peintures?", "trous?", "reboucher", "rebouchage", "tapisserie", "faience", "carrelage", "sols?", "murs?", "fissures?", "etageres?", "fixations?", "tringles?", "chevilles?", "accrocher", "montage", "monter", "meubles?", "lits?", "matelas", "chaises?", "tables?", "bureaux?", "miroirs?", "patere", "silicone"] },
  { id: "autre", lib: "Autre", ic: "📦", c: "#64748b", mots: [] },
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
  const POIDS = { equipements: 1.5, plomberie: 1.2, menuiserie: 1, exterieur: 1, peinture: 0.7 };
  CATEGORIES_PANNES.forEach(c => { const n = RX[c.id].filter(r => r.test(t)).length * (POIDS[c.id] ?? 2); if (n > score) { score = n; meilleur = c.id; } });
  return meilleur;
}
// Catégorie retenue pour une demande (ligne du suivi ou document Firestore).
export function categorieDe(d) {
  if (d?.categoriePanne && CATEGORIES_PANNES.some(c => c.id === d.categoriePanne)) return d.categoriePanne;
  return categorieAuto(`${d?.descr || d?.descriptifCorrige || d?.descriptif || ""} ${d?.type || ""}`);
}
export const infoCategorie = (id) => CATEGORIES_PANNES.find(c => c.id === id) || CATEGORIES_PANNES[CATEGORIES_PANNES.length - 1];

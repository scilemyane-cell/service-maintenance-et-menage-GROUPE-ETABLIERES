// Refonte des catégories / types de panne Camileia (24/11/2026) — exécuté une fois depuis l'appli (console, version test).
// Sauvegarde de l'état d'avant : Firestore config/camileia-categories-avant (champ json).
// Principe : on réutilise les catégories existantes (renommées) pour garder l'historique des DI,
// on déplace les types (PUT du type avec la nouvelle catégorie), on crée ce qui manque, on désactive
// les catégories vidées. Rien n'est supprimé.
export const PLAN = [
  // [id catégorie existante ou null pour créer, libellé, types à déplacer dedans, types à créer, clé appli]
  [14, "Plomberie", [900041, 900056, 900057], ["Fuite d'eau", "Évier / lavabo bouché", "Douche / baignoire", "Joints / silicone"], "plomberie"],
  [11, "Électricité", [], ["Interrupteur", "Tableau électrique"], "electricite"],
  [900006, "Équipements / Électroménager", [11, 900005], ["Four / micro-ondes", "Lave-linge / sèche-linge", "Sèche-mains", "Autre équipement"], "equipements"],
  [15, "Menuiserie / Vitrerie / Stores", [], ["Store / rideau", "Placard / tiroir"], "menuiserie"],
  [9, "Petits travaux / Mobilier", [900037, 900038, 900039, 900040, 900042, 900043], ["Fixation / montage", "Trou / fissure"], "peinture"],
  [5, "Serrurerie / Accès", [27, 29, 900012, 900013, 900014, 900015, 13, 900025, 900026], ["Ferme-porte", "Boîte aux lettres"], "serrurerie"],
  [2, "Chauffage / Clim / VMC", [3, 7, 900011, 10, 900058], [], "chauffage"],
  [7, "Nettoyage", [9], [], "nettoyage"],
  [17, "Sécurité incendie", [], [], "incendie"],
  [900004, "Courants faibles / Audiovisuel", [], ["Sonnette", "Internet / wifi", "Vidéoprojecteur / écran / HDMI", "Téléphone"], "courants"],
  [null, "Eau chaude", [23], ["Ballon / cumulus en panne"], "ecs"],
  [null, "Espaces verts / Extérieurs", [], ["Tonte / taille", "Arbre / branche", "Clôture", "Parking / voirie"], "exterieur"],
  [12, "Logistique / Encombrants", [900021, 900003, 900004], ["Encombrants", "Déménagement / manutention", "Déchetterie"], "logistique"],
  [18, "Humidité / Toiture / Infiltrations", [], ["Moisissures / humidité", "Gouttière / chéneau"], "toiture"],
  [null, "Nuisibles", [], ["Punaises de lit", "Puces", "Blattes / cafards", "Rongeurs", "Guêpes / frelons", "Autres insectes"], "nuisibles"],
  [1, "Autre", [], ["Autre demande"], "autre"],
];
// Catégories vidées par la refonte → désactivées (pas supprimées).
export const A_DESACTIVER = [3, 4, 8, 13, 900002, 900003, 900005, 900007];

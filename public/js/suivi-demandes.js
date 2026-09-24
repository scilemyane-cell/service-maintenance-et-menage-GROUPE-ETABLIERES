// Tableau de bord "Suivi des demandes d'intervention" — reprend le fichier
// Excel externe (hors appli, "SG_Suivi_Demandes_GroupeEtablieres") que les
// demandeurs continuent de remplir. Depuis cette version, la vue "Tableau"
// n'est PLUS une photo figée : les demandes vivent dans Firestore
// (collection `demandes`) et les techniciens peuvent changer le statut,
// l'intervenant et ajouter un commentaire DIRECTEMENT dans l'appli.
//
// Le lien avec le fichier Excel se fait en deux temps :
//  1) IMPORT (fait une fois, bouton réservé aux éditeurs) : charge les
//     lignes du fichier Excel dans Firestore. Un réimport n'écrase jamais
//     une demande déjà présente (comparaison sur le numéro `n°`), donc pas
//     de perte du travail déjà fait par un technicien dans l'appli.
//  2) RESYNCHRO vers Excel (pas encore automatique) : il reste à mettre en
//     place l'écriture retour dans le fichier SharePoint via l'API
//     Microsoft Graph, pour que les statuts changés ici se reflètent aussi
//     côté demandeurs. Tant que ce n'est pas fait, l'app est la référence
//     à jour, mais l'Excel peut retarder.
//
// Deux vues :
//  - "Tableau" (vue par défaut) : liste ligne par ligne des demandes
//    (vivantes, Firestore), filtrable (statut/urgence/site/association/
//    recherche), triée par urgence puis date — pour VRAIMENT traiter le
//    fichier, pas juste regarder des chiffres.
//  - "Statistiques" : l'ancien tableau de bord (cumul + une page par mois),
//    qui reste pour l'instant une photo figée mise à jour manuellement par
//    Claude à chaque envoi du fichier Excel par Valentin.
import { esc } from "./astreinte-logic.js";
import { watchDemandes, importerDemandes, updateDemande } from "./firestore-data.js";

const COULEUR_STATUT = { "Réalisé": "var(--teal)", "En cours / à traiter": "var(--gold)", "Annulé": "var(--red)" };
const COULEUR_ASSOCIATION = { "Agropolis": "var(--gold)", "École": "var(--teal)", "Armonia": "var(--violet)", "Autres": "var(--text-dim)" };
const COULEUR_URGENCE = { "Normal": "var(--teal)", "Urgent": "var(--gold)", "À planifier": "var(--text-dim)", "Non renseignée": "var(--border)", "Critique": "var(--red)" };
const ORDRE_URGENCE = { "Critique": 0, "Urgent": 1, "À planifier": 2, "Non renseignée": 3, "Normal": 4 };
const DEMANDES_SEED_NOM = "SG_Suivi_Demandes_GroupeEtablieres.xlsx";
const STATUTS_TRAITES = ["Réalisé", "Annulé"]; // ce qui n'est PAS "à traiter"

// Données individuelles ligne par ligne (dictionnaire-encodées pour rester
// compactes : sites/associations/types/urgences/statuts/intervenants sont
// des tableaux de libellés, et chaque ligne référence leur index).
const DEMANDES_SEED = {"sites":["AGRO - Direction","Cafétéria","EDP","EDP Fontenay-le-Comte","EDP La-Roche-sur-Yon","Ecole de Bijouterie","Fontenay le Comte","Lot 1 MNA - AGA","Lot 1 MNA - AGA SA","Lot 1 MNA - Bureaux","Lot 1 MNA - Douanier Rousseau","Lot 1 MNA - La Ferme","Lot 1 MNA - La Moutonnerie","Lot 1 MNA - Saint Vincent de Paul","Lot 1 MNA - Saint-Vincent de Paul","Lot 3 MNA - Challans","Lot 3 MNA - Coëx","Lot 3 MNA - La Yole","Lot 3 MNA - Saint-Christophe de Ligneron","Lot 3 MNA - Saint-Gilles-Croix de Vie","Lot 3 MNA - Saint-Jean de Monts","Lycée","Non renseigné","RS - Agro RS","RS - Cécile Sauvage","RS - La Yole","RS - Le Bois Blanc","RS - Le Cap","RS - Le Mail","RS - Le Relais","RS - Les Prêles","RS - Les Trois Portes","Restaurant scolaire","Siège","Sup Agri","Sup Management","Sup Santé Animale","Sup Social","lycée","siège","tous sites MNA"],"assocs":["Agropolis","Armonia","Autres","École"],"types":["","Autre","Déchets / Encombrants","Espaces verts / Extérieurs","Maintenance / Travaux","Nettoyage","Sécurité"],"urgences":["Critique","Non renseignée","Normal","Urgent","À planifier"],"statuts":["Annulé","Autre","Commande en cours","Demande de devis","Intervenant sollicité","Non renseigné","Planifié","Pris en compte","Réalisé"],"intervenants":["","Externe SG","Externe site","Interne SG","Interne site","MFouet","PES"],"rows":[["SG-001","2026-01-28",23,0,4,"moissisures sdb",4,7,0],["SG-002","2026-04-29",23,0,4,"Tablette lavabo à refixer",2,8,3],["SG-003","2026-04-29",23,0,4,"abattant WC à changer",2,8,3],["SG-004","2026-04-29",23,0,4,"un bout de la cuvette s'est détaché",2,8,3],["SG-005","2024-10-18",8,0,4,"humidité + tâche au plafond (relance le 07/12)",4,1,1],["SG-006","2024-12-07",8,0,4,"moisisure dans la salle de bain",4,3,1],["SG-007","2026-06-02",5,3,4,"faire le nécessaire pour les différentes installations en atelier pour la rentrée (voir récapitulatif envoyé à Valentin)",3,8,3],["SG-008","2025-12-02",29,0,4,"Constater les fissures présente dans le logement notamment côté lit faut-il faire quelque chose ?",4,3,1],["SG-009","2025-12-11",29,0,4,"Ajouter une serrure à la porte des toilettes",4,3,1],["SG-010","2026-04-08",29,0,4,"peinture qui s'écaille au plafond de la salle de bain au dessus de la douche",4,3,1],["SG-011","2026-04-28",29,0,4,"fuite sous le lavabo salle de bain",2,8,3],["SG-012","2026-04-28",29,0,4,"gonds porte salle de bain à revoir",2,3,1],["SG-013","2026-04-28",29,0,4,"judas extérieur à remettre",2,3,1],["SG-014","2026-04-28",29,0,4,"moisissure  derrière compteur eau",2,1,1],["SG-015","2026-04-28",29,0,4,"manque bout de manette volet roulant",2,3,1],["SG-016","2026-04-28",29,0,1,"Plus de commode/pied de table mal réparé, à remplacer ?",2,7,3],["SG-017","2026-07-17",3,1,4,"Remise en place des grilles de ventilation au niveau du self",3,8,0],["SG-018","2026-07-06",6,3,4,"Evacuation des eaux usées du local carton est constament pleine",3,0,0],["SG-019","2026-09-03",30,0,4,"Sonnette accueil HS",2,5,0],["SG-020","2026-03-24",25,0,4,"Salle de bain : Changement miroir usure avancée",1,8,0],["SG-021","2026-03-24",25,0,4,"Salle de bain : Rouille radiateur salle de bain, possibilité de repeindre ou nettoyer pour rendre plus esthétique?",1,8,0],["SG-022","2026-05-19",25,0,4,"Goutte à goutte régulier dans les toilettes (bruits réguliers dans le réservoir)",1,8,0],["SG-023","2026-09-03",30,0,4,"Retirer les 2 vis enfoncées dans le sol du parking (j'ai pris des photos car pas évident à voir)",2,5,0],["AOUT","2026-07-21",25,0,4,"Frigo HS",2,8,3],["SG-025","2026-09-03",27,0,4,"Volet roulant gauche du logement A104 ne fonctionne plus alors que j'ai changé la pile il y a 2 mois",3,8,1],["SG-026","",25,0,4,"VMC SDB /CUISINE HS",4,8,0],["SG-190","2026-06-15",28,0,4,"vmc qui ne fonctionne pas",2,0,0],["SG-028","",25,0,4,"Radiateur rouillé",4,8,0],["SG-029","2026-04-28",25,0,4,"Repeindre compteur électrique après un Dégât des eaux: demande du 29/01/2026 + revoir la peinture du séjour",2,8,1],["SG-030","2026-05-12",25,0,4,"Mettre un frigo neuf",2,8,1],["SG-031","2026-09-03",37,3,4,"Désinstaller climatiseurs",2,8,0],["SG-032","2026-06-30",25,0,4,"nettoyer siphon cuisine",2,1,1],["SG-033","2026-06-30",25,0,4,"radiateur à fixer",2,8,3],["SG-034","2026-06-30",25,0,4,"néon SDB à changer",2,8,3],["SG-035","2026-06-30",25,0,4,"Daaf périmé",2,8,3],["SG-036","2026-06-30",25,0,4,"passer un petit coup sur la cuvette des WC",2,8,1],["SG-037","2026-06-30",25,0,4,"nettoyer la SDB",2,8,1],["SG-038","2026-04-24",25,0,4,"Porte des WC dégondée ou déboitée ?",1,8,0],["SG-039","2026-05-12",25,0,4,"Porte coulissante du placard de l'entrée coulisse très  difficilement",1,8,0],["SG-040","2026-05-12",25,0,4,"la vmc fait beaucoup de bruit",4,8,1],["SG-041","2026-05-12",25,0,4,"Bouton poussoire wc à changer",2,8,1],["SG-042","",22,2,0,"sanitaire 4  : manque un film occultant à une fenêtre",3,5,0],["SG-043","2026-05-12",25,0,4,"dessus de la bonde de la douche cassé",2,8,1],["SG-044","2026-05-07",25,0,4,"Radiateur salle de bain complètement rouillé - prévoir changement ou produit anti-rouille",4,8,0],["SG-045","2026-05-07",25,0,4,"Désencombrement complet du logement (déchets à évacuer suite abandon)",2,8,1],["SG-046","2026-05-07",25,0,4,"Devis ménage à prévoir après désencombrement et travaux",2,8,0],["SG-047","2026-05-07",25,0,4,"Changement luminaire dans les toilettes",4,8,0],["SG-048","2026-05-07",25,0,4,"Fuite robinet cuisine",4,8,0],["SG-049","2026-05-07",25,0,4,"Placard de l'entrée : étagère à refixer",4,8,0],["SG-050","2026-05-07",25,0,4,"Sol et peinture très âbimé, revoir l'état après désencombrement / ménage",2,0,0],["SG-051","2026-06-23",25,0,4,"Detecteur de fumée à changer - périmé depuis 2025",2,8,0],["SG-052","2026-07-22",28,0,2,"demander des containers poubelle supplémentaires",2,6,0],["SG-053","2026-09-01",28,0,3,"enlever \"receptacle \" en pierre servant de cendriers et mettre des cendriers à tous les étages",2,0,0],["SG-054","2025-11-21",30,0,4,"Serrure qui semble tourner dans le vide avec la clef, mais à l'intérieur de la pièce le verrou semble tourné correctement.\nImpossibilité d'ouvrir le bureau depuis le couloir\n01/12/25 : Cela fonctionne correctement mais il faudrait y jeter un oeil",1,0,0],["SG-055","2025-12-11",30,0,4,"Fuite au niveau du robinet de la cuisine (Joint ou ensemble du robinet)",1,0,1],["SG-056","2026-03-26",30,0,4,"Refaire joint évier (âbimé à l'entrée du résident il y a un mois)",1,0,1],["SG-057","2026-04-09",30,0,4,"Syphon de l'évier cuisine qui joint",1,0,1],["SG-058","2026-03-23",36,3,4,"Prise à l'accueil du salon de toilettage qui se décolle du mur",2,0,3],["SG-059","2025-07-17",6,3,4,"Remplacer serrure baie du Hall hydraulique à Pissotte\nPhoto adressée ce jour par mail à : servicemaintenance@etablieres.fr",1,0,0],["SG-060","2026-06-10",27,0,4,"changer pile du volet roulant",2,0,0],["SG-061","2026-06-15",27,0,4,"changer pile du volet roulant",2,0,0],["SG-062","2026-06-17",1,1,1,"Installation d'un répéteur (ou autre) pour augmenter le débit internet. Le TPE captant de manère aléatoire le signal : les clients ne peuvent utiliser leur CB",3,0,1],["SG-063","2026-08-10",28,0,4,"remetre nouvelle porte de placard à la place du rideau à l'entrée",2,0,0],["SG-064","2026-06-24",6,3,4,"Banquettes dossiers en bois",2,0,0],["SG-065","2026-06-24",6,3,4,"Peinture murs",2,0,0],["SG-066","2026-06-24",6,3,5,"Puits de lumière",2,0,0],["SG-067","2026-06-24",6,3,5,"Vitres extérieures salle de classe restaurant",2,0,0],["SG-068","2026-07-10",30,0,4,"Eau très chaude uniquement, n'arrive pas à avoir d'eau froide",2,0,0],["SG-069","2025-08-04",25,0,4,"Moisissures plafond SDB + écaillement peinture",1,0,0],["SG-070","2025-01-14",25,0,4,"PB MOISSISSURES PLAFOND SDB +++   (pb de santé ASTHME)",3,0,0],["SG-071","2026-06-30",25,0,4,"2 vis tringle penderie à fixer ou retirer",2,0,3],["SG-072","2026-09-01",29,0,4,"poignée congélateur à réparer ou à changer",2,0,0],["SG-073","2026-08-25",6,3,4,"Vestiaire hommes: couper les cadenas en place et réparer les portes des casiers",2,0,0],["SG-074","2026-08-20",29,0,4,"sol très abimé , nombreuses rayures, à changer?",2,0,0],["SG-075","2026-09-01",29,0,4,"refaire joints evier cuisine",2,0,0],["SG-076","2026-09-08",25,0,4,"volet coincé à la moitié, ne s'ouvre plus et ne se ferme plus",2,0,0],["SG-077","2026-09-08",25,0,4,"Les plaques de cuisson de fonctionennt plus : cela disjoncte dès qu'on allume",3,0,0],["SG-078","2026-09-04",25,0,4,"Beaucoup d'air passe par la porte fenêtre et cela crée des sifflements jour et nuit (joint étanchéité) ?",2,0,0],["SG-079","2026-09-15",25,0,4,"Remettre les tringles à l'entrée et salon (BUG tableau = dde faite depuis le 17/08/26)",2,0,0],["SG-080","2026-07-21",8,0,4,"déplacer la commode de l'appartement 101  vers l'appartement 191 suite déménagement",3,1,0],["SG-081","2026-06-16",36,3,4,"Ravalement de facade Sup santé animale",2,1,3],["SG-082","2026-07-15",8,0,4,"Porte frigo cassée",2,1,0],["SG-083","2026-07-15",8,0,4,"problème serrure porte entrée",2,1,0],["SG-084","2026-01-22",27,0,4,"Plaque de cuisson - le + grand ne fonctionne pas",1,2,1],["SG-085","2026-08-19",28,0,4,"poignée dévissée? La poignée va vers le bas à l'intérieur et vers le haut à l'extérieur",3,3,0],["SG-086","2026-06-22",31,0,4,"Porte entrée forcée\nCadre et porte à réparer",3,3,1],["SG-087","2026-08-25",29,0,6,"refaire des clés",3,3,0],["SG-088","2026-09-07",27,0,4,"Plaque vitro céramique cassée Logement A204",3,3,0],["SG-089","2026-01-07",27,0,4,"à régler, elle ne se ferme plus depuis septembre",1,4,1],["SG-090","2025-09-02",29,0,4,"au 2ème étage les lumières de la coursive ne fonctionne pas",3,4,1],["SG-577","2026-08-18",27,0,4,"Réarmemant porte d'entrée",3,4,0],["SG-092","2026-06-15",27,0,4,"Vélux désembuage de l'escalier bat A B C - ouvert",2,6,0],["SG-093","2026-05-12",25,0,4,"baguette sur le côté du lit décollé",2,6,1],["SG-094","2026-01-29",25,0,4,"Fuite d'eau dans la colonne électrique dans le logement",3,6,1],["SG-095","2026-05-19",25,0,4,"Goutte à goutte régulier dans les toilettes (bruits réguliers dans le réservoir)",2,6,1],["SG-096","2026-08-19",6,3,4,"L'eau ressort de la bouche d'égout située dans le local carton. Les jours où la plonge est utilisée",3,7,0],["SG-097","2026-09-02",28,0,4,"bonde salle de bain à changer",2,7,0],["SG-098","2026-06-01",26,0,4,"lumières allumées toute la nuit, voir pour programmer jusqu'à 22h30",1,7,0],["SG-099","2025-10-15",31,0,4,"Mettre DAF / remplacer mecanisme WC + flotteur / remplacer le matelas / difficulté d'ouverture et de fermeture clé porte entrée (dégripant?)",1,7,0],["SG-100","2024-03-21",31,0,4,"colonne douche HS + changer le mécanisme ou flotteur WC",1,7,0],["SG-101","2025-10-15",31,0,4,"COMPLEMENT : 2eme couche peinture blanche / le chant en alu facade du bureau est à recoller / présence de 2 vis sur la bonde douche / dégripant serrure porte entrée",1,7,0],["SG-102","2025-10-15",31,0,4,"remplacer le mitigeur avec tige bonde (Fait) / le fluide de la douche est non puissant ... (douche HS?) / couche peinture blanche                     COMPL: mec WC",1,7,0],["SG-103","2024-03-21",31,0,4,"douche HS",1,7,0],["SG-104","2025-10-15",31,0,4,"COMPLEMENT: remplacer mécanisme WC + flotteur / remplacer le mitigeur evier par mitigeur lavabo / remplacer le matelas",1,7,0],["SG-105","2026-08-25",6,3,4,"Installer le destructeur d'insectes en cuisine",3,7,0],["SG-106","2024-03-21",31,0,4,"douche HS",1,7,0],["SG-107","2026-02-12",36,3,4,"Achat et installation nouvelle boîte aux lettre (la nôtre prend l'eau et le courrier avec)",2,7,1],["SG-108","2025-04-29",6,3,4,"Peinture plafond salle de restauration",1,7,0],["SG-109","2025-09-18",6,3,4,"Demande de rajout de prise dans le self , suite à la modification de la ligne de self",1,7,0],["SG-110","",6,3,4,"Modifier la fermeture des casier dans le vestiaire garçons  (casier piscine)",1,7,0],["SG-111","2026-06-16",21,3,4,"Ajouter des petits panneaux \"interdiction de fumer\" au niveau du préau de la salle de devoir",2,7,3],["SG-112","2025-10-15",31,0,4,"COMPLEMENT: remplacer mécanisme WC + flotteur car écoulement dans la cuvette WC",1,7,0],["SG-113","2025-10-15",31,0,4,"Mettre pile DAF / dégripant serrure porte entrée(fait) / la douche fait du bruit (douche HS ?) + présence d'une colonne douche supplémentaire dans ce logement ...",1,7,0],["SG-114","2025-10-06",25,0,4,"Fuite du radiateur de la SDB",1,7,0],["SG-115","2025-10-15",31,0,4,"Mettre pile DAF / dégripant porte serrure entrée(fait) / remplacer la bonde lavabo(Fait) / remplacer mécanisme WC + flotteur / ABSENCE de colonne douche",1,7,0],["SG-116","2026-08-12",31,0,4,"WC se désolidarise du mur",3,7,0],["SG-117","2026-04-07",24,0,4,"éclairage extérieur à régler",1,7,0],["SG-118","2026-07-15",8,0,4,"tiroirs commodes cassées",2,7,0],["SG-119","2026-06-24",26,0,4,"volet qui dysfonctionne malgré changement de pile",3,7,0],["SG-120","2026-08-12",28,0,4,"porte placard cusine à changer",2,8,0],["SG-121","2024-08-30",6,3,4,"fuite au niveau de la légumerie (ci besoin voir avec Angelique)",1,7,0],["SG-122","2026-08-10",28,0,4,"les plaques de cuisson chauffent mais au bout d'un moment elles se coupent",2,8,0],["SG-123","2025-03-31",7,0,4,"problème d'humidité",1,7,0],["SG-124","2026-07-10",31,0,4,"La poignée de porte du bureau des formateurs EDP tourne dans le vide. La porte est bloquée même si elle n'est pas verouillée",2,7,0],["SG-125","2026-07-21",29,0,4,"trop plein du syphon cuisine",2,7,0],["SG-670","2026-08-31",32,3,4,"Divers réparations (liste mail)",2,7,3],["SG-127","2026-08-20",29,0,4,"manette volet roulant à réparer",2,7,0],["SG-128","2026-08-27",26,0,4,"réparation lit (cassé au milieu)",3,7,0],["SG-129","2026-09-08",29,0,4,"VMC salle de bain bruyante",2,7,0],["SG-130","2026-09-04",25,0,4,"Chambre : plinthes abimées = humidité ???",2,7,0],["SG-131","2026-09-04",25,0,4,"Radiateur SDB ne fonctionne pas",2,7,0],["SG-132","2026-09-15",12,0,4,"WC bouchés",3,7,0],["SG-543","2026-08-07",26,0,4,"refixer joint porte entrée",3,8,0],["SG-134","2026-07-30",27,0,4,"Fuite sous évier",2,8,1],["SG-135","2026-07-30",27,0,4,"Fuite sous évier - Bonde",2,8,1],["SG-136","2026-07-27",27,0,1,"Volet roulant complètement défait - après avoir été forcé pour rentrer dans le logement - Ref mail valentin",2,8,1],["SG-183","2026-02-01",21,3,4,"Repeindre deux murs au CDI (choix de la couleur fait sur nuancier). Pose d'une tablette murale pour écran télé.",1,8,3],["SG-138","2026-04-07",24,0,4,"baie vitrée à changer",1,8,0],["SG-139","2026-06-12",21,3,4,"l´ampoule du video projecteur en salle sec 2.5 demande a etre changee",2,8,1],["SG-140","2026-04-07",24,0,4,"ampoule plafonier",1,8,3],["SG-141","2026-06-15",21,3,4,"Les jardinières espace fumeur BTS se détériore : les lames de bois se retirent (par des clous rouillés)",2,8,0],["SG-195","2026-06-15",21,3,4,"Ampoule vidéo projecteur 0.5 à changer",2,8,3],["SG-143","2026-05-05",24,0,4,"baie vitrée fissurée",4,8,0],["SG-144","2026-06-02",24,0,4,"baie vitrée fissurée",4,8,0],["SG-145","2026-07-20",28,0,4,"dessus du frigo cassé, apparemment il ne fonctionne pas très bien.",3,8,0],["SG-146","2026-07-16",28,0,4,"fuite au niveau du plafond dans le séjour, vient du 24?",3,8,0],["SG-147","2026-09-02",28,0,4,"joints vasque salle de bain à refaire",2,8,0],["SG-148","2026-09-02",28,0,4,"porte du meuble sous évier à changer",2,8,0],["SG-149","2026-01-26",26,0,4,"toujours fuite siphon BEC",1,8,0],["SG-150","2026-04-14",26,0,4,"Problème de lumière dans les coursives. Les lumières ne fonctionne pas la nuit",1,8,0],["SG-151","2026-04-29",26,0,4,"interphone semble HS",1,8,0],["SG-152","2026-05-18",26,0,4,"voir porte freezer",1,8,0],["SG-153","2026-09-10",31,0,4,"le volet gauche ne decend pas bien et le volet droit ne se remonte pas",2,8,0],["SG-154","2026-07-23",31,0,4,"Recoller le chant façade du lit / le porte peignoire est défixé / fuite syphon lavabo / bonde lavabo qui ne ferme pas",2,8,0],["SG-155","2026-09-14",31,0,4,"Remplacer le distributeur papier WC + volet droit qui présente deux ajourements",2,8,0],["SG-379","2026-07-09",31,0,4,"La prise murale située en dessous la fenêtre gauche ne fonctionne pas",2,8,0],["SG-157","2026-06-01",31,0,4,"reboucher les trous (x4) du mur où se trouvait la TV",1,8,0],["SG-158","",31,0,4,"faire installation radiateur elctrique",1,8,0],["SG-159","2026-06-04",31,0,4,"recoller les plinthes et mettre des plinthes",1,8,0],["SG-160","2026-09-08",26,0,4,"ampoule chambre à changer (une au stock au bureau)",2,8,0],["SG-161","2026-09-08",26,0,4,"plaque de cuisson du haut fait disjoncteur le compteur",2,8,0],["SG-162","2025-10-31",30,0,4,"Néon salle de bain à changer (refacturer au résident sortant)",1,8,1],["SG-163","2025-10-31",30,0,4,"Evier cuisine bouché avec eau stagnante marron à l'intérieur (refacturer au résident sortant)",1,8,1],["SG-164","2025-10-31",30,0,4,"Retirer flexible douche avec pomme (mis par bruno provisoirement pour l'ancienne résidente)",1,8,1],["SG-165","2025-12-01",30,0,4,"Prévenir résidente avant intervention\nNéon cuisine ne fonctionne pas malgré rachat et changement de néon par la résidente",1,8,1],["SG-166","2025-12-08",30,0,4,"Néon à changer dans la cuisine (malgré changement d'un néon neuf)",1,8,1],["SG-167","2026-08-27",26,0,4,"tiroir sous le lit qui ne ferme plus à cause du pied du lit",2,8,0],["SG-168","2026-04-20",11,0,4,"lave-linge qui fait beaucoup de bruit à l'essorage",1,8,0],["SG-169","2026-09-10",26,0,4,"flotteur semble HS (eau qui coule constamment)",2,8,0],["SG-170","2026-09-10",26,0,4,"Réglage porte d'entrée",2,8,0],["SG-171","2025-10-20",12,0,4,"manque la poignée de la dernière étagère de la commode de la chambre se situant au bout à droite dans le couloir.",1,8,0],["SG-172","2026-02-03",12,0,4,"Réparer la porte de garage pour la fermer à clés - cela évitera l'intrusion de personne externe au dispositif pour l'utilisation de la machine à laver",1,8,0],["SG-173","2026-06-02",14,0,4,"Changer ampoule champbre 3",1,8,0],["SG-174","2026-05-18",18,0,4,"Volet roulant de la baie vitrée qui ne remonte plus",1,8,0],["SG-175","2026-05-18",19,0,4,"ampoule des toilettes du bas est grillée",1,8,0],["SG-176","2026-06-04",19,0,4,"tiroirs meuble cassés",1,8,0],["SG-177","2026-05-11",15,0,4,"diffoculté à fermer la porte",1,8,0],["SG-178","2026-05-11",15,0,4,"diffoculté à fermer la porte",1,8,0],["SG-179","2026-05-11",15,0,4,"fenêtre cassée - si on l'ouvre impossible de la fermer",1,8,0],["SG-180","2026-08-25",7,0,4,"serrure local API difficile à fermer",2,8,0],["SG-181","2026-01-13",27,0,4,"Serrure difficile",1,8,1],["SG-182","2026-04-03",27,0,4,"Siphon SDB qui fuit",2,8,0],["SG-183","2026-04-28",27,0,4,"Plafonnier de la SDB qui pend",2,8,1],["SG-184","2026-05-18",27,0,4,"SERRURE CASSÉE",3,8,1],["SG-185","2026-05-22",27,0,4,"Serrure qui bloque sur le 1er tour - il est obligé de forcer",3,8,1],["SG-186","2026-06-01",27,0,4,"Fuite siphon de l'évier de cuisine",1,8,1],["SG-187","2023-12-05",36,3,4,"Les nouvelles plaques changées au plafond dans le hall sont de nouveau tâchées par l'eau (fuites du toit)",4,8,0],["SG-188","2026-06-02",36,3,4,"Stickers vitre hall d'entrée à décoller (attention prévoir matériel et produit adaptés)",2,8,0],["SG-189","2026-01-28",37,3,4,"il y a une fuite d'eau dans la chaufferie, constatée lors de ma venue pour relever les compteurs EDF ce jour",4,8,3],["SG-190","2026-02-12",37,3,4,"Pièce métallique tombée dans la salle 5 (la pièce est dans le bureau des assistantes de direction)",1,8,0],["SG-191","2026-02-26",37,3,4,"je renouvelle mon constat : il y a une fuite d'eau dans la chaufferie, constatée lors de ma venue pour relever les compteurs EDF ce jour",1,8,0],["SG-192","2025-11-25",5,3,4,"installation de stores dans certains bureaux\nRéception des rideaux gris",3,8,3],["SG-193","2026-05-27",5,3,4,"Lavabo: la bonde d'évacuation est bloquée",2,8,0],["SG-194","2026-06-03",5,3,4,"Une lumièe ne fonctionne plus dans les WC des hommes au N-1 (toilette de gauche). Attention vieux système qu'il faudra je pense changer, comme celui d'à côté",2,8,0],["SG-195","2026-03-16",6,3,4,"Démontage et nettayage filtre évacuation dessus bian marie",1,8,0],["SG-196","2023-08-30",32,3,4,"fermé toutes les bouches d'aération du vide sanitaire",1,8,1],["SG-197","2026-06-10",34,3,4,"Douches : pas d'eau qui sort + eau froide",3,8,0],["SG-182","2026-06-10",2,3,4,"Volet HS fenêtre du milieu",1,8,0],["SG-199","2026-06-23",25,0,4,"Plinthe en bois à côté de l'espace cuisine à changer",2,8,0],["SG-200","2026-06-23",25,0,4,"Syphon évier cuisine à nettoyer/déboucher",2,8,0],["SG-201","2026-06-15",21,3,4,"Panneau Sup Etablieres à l'entrée BTS / mur extérieur : le \"SUP\" est de travers",2,8,3],["SG-202","2026-09-02",28,0,4,"1 volet ne coulisse plus",2,8,0],["SG-203","2026-06-15",26,0,4,"changement ampoule plafonnier SBS",2,8,3],["SG-204","2026-06-15",26,0,4,"evacuer frigo HS",2,8,3],["SG-205","2026-06-15",26,0,4,"fuite siphon évier",3,8,3],["SG-207","2026-06-15",21,3,4,"Fenêtres qui ne coulissent plus",2,8,3],["SG-208","2026-06-23",25,0,4,"Matelas + alèse intérgrale à remplacer \n90 * 190",2,8,0],["SG-209","2026-06-30",25,0,4,"en cours de maintenance par Ronald",2,8,0],["SG-210","2026-06-17",26,0,4,"Poignée placard cuisine à remplacer",2,8,3],["SG-211","2026-06-17",26,0,4,"Néon kitchenette à changer",2,8,3],["SG-212","2026-06-16",39,3,4,"Chainette du store sorti du mécanisme (à remettre pas besoin de le changer)",2,8,0],["SG-213","2026-06-16",21,3,4,"Enlever l'enseigne \"SUP ETABLIERES\" à l'entrée Sup Agri",2,8,3],["SG-214","2026-06-16",36,3,4,"Enlever le logo Sup santé animale en sticker sur la vitre de l'entrée",2,8,3],["SG-215","2026-06-15",29,0,4,"Installer la banderole",2,8,3],["SG-216","2026-06-15",26,0,4,"Installer la banderole",2,8,3],["SG-217","2026-07-15",25,0,4,"Changer la bouche VMC dans la cuisine (cassée BG)",2,8,1],["SG-218","2026-06-18",26,0,4,"chasse d'eau coule en continue",2,8,3],["SG-219","2026-06-18",24,0,4,"Cache badge barrière C.S",2,8,3],["SG-220","2026-06-18",24,0,4,"Apporter une chaise orange manquante",2,8,3],["SG-221","2026-07-24",25,0,4,"Changer le miroir",4,8,1],["SG-222","2026-07-24",25,0,4,"Salle de bain, joint au sol entre douche et espace lavabo noir/ sale\nA refaire ou nettoyer",2,8,1],["SG-223","2026-07-03",25,0,4,"Ampoule du salon qui clignote",2,8,0],["SG-224","2026-06-19",10,0,4,"porte à coté de la machine à lavé et seche linge qui est bloqué",2,8,0],["SG-225","2026-06-19",34,3,1,"Récupération frigo suite à la fin des examens BTS GEMEAUX (cours la semaine prochaine)",2,8,0],["SG-226","2026-06-19",24,0,4,"Robinet se détache de l'évier",2,8,3],["SG-227","2026-06-19",24,0,4,"Chasse d'eau coule beaucoup - même après un délai \"normal\" après utilisation",2,8,3],["SG-228","2026-06-22",26,0,4,"changer néon kitchenette",2,8,4],["SG-229","2026-07-17",28,0,4,"revisser cuvette wc",3,8,0],["SG-230","2026-07-17",28,0,4,"bonde salle de bain à changer",3,8,0],["SG-231","2026-07-17",28,0,4,"néon salle de bain à changer",3,8,0],["SG-232","2026-06-23",24,0,4,"plus d'eau froide",3,8,3],["SG-233","2026-07-07",25,0,4,"Le volet ne se ferme plus (sorti du rail ?)",2,8,0],["SG-234","2026-07-24",25,0,4,"Miroir à changer",2,8,1],["SG-235","2026-07-24",25,0,4,"Joint noircit lavabo salle de bain",2,8,1],["SG-236","2026-07-24",25,0,4,"Retirer le lit métalique (suite départ MNA)",2,8,0],["SG-240","2026-06-23",7,0,4,"Retirer les vélos le long du mur",2,8,3],["SG-241","2026-06-23",8,0,4,"Armoire cassée",2,8,0],["SG-242","2026-06-23",24,0,4,"Cuvette WC à changer",2,8,3],["SG-240","2026-06-24",6,3,4,"Ampoules et plafonniers salle de restaurant à changer",2,8,0],["SG-241","2026-06-24",6,3,4,"Claustras à ressouder",2,8,0],["SG-242","2026-08-06",28,0,4,"Changer meuble sous l'évier cuisine",2,8,0],["SG-243","2026-06-24",6,3,6,"Porte de la salle de restaurant très difficile à fermer",2,8,0],["SG-244","2026-06-24",6,3,6,"Vérification des câbles électriques",2,8,0],["SG-245","2026-07-30",8,0,4,"déménager commode du log 101 vers log 191",3,8,0],["SG-246","2026-08-19",10,0,4,"Fuite sous l'évier de la cuisine",3,8,0],["SG-247","2026-07-17",28,0,4,"fuite au niveau du plafond dans le séjour, vient du 24?",3,8,0],["SG-256","2026-06-25",24,0,4,"Plafonnier a éclaté sous la chaleur",2,8,3],["SG-249","2026-06-25",24,0,4,"Relevé de compteur avant le 30/06 svp",4,8,3],["SG-250","2026-06-25",2,3,4,"Film sans teint salle de réunion EDP (merci)",2,8,3],["SG-251","2026-07-24",25,0,4,"Tablette au dessus lavabo salle de bain à refixer",2,8,1],["SG-252","2026-06-25",30,0,4,"Relevé des compteurs",2,8,0],["SG-253","2026-06-25",24,0,4,"Frigo cassé perte de froid",3,8,3],["SG-254","2026-07-24",25,0,4,"Carton + layette frigo blanche posé sur l'évier cuisine à évacuer",2,8,1],["SG-261","2026-06-26",24,0,4,"Evier laverie fuit, coule en continue",3,8,3],["SG-256","2026-06-26",29,0,4,"2 chaises à réparer dans le local technique",2,8,0],["SG-265","2026-06-26",24,0,4,"Pas d'eau froide",2,8,3],["SG-258","2026-06-26",34,3,4,"Gache de serrure cassé de la porte arrière droit menant sur l'extérieur",3,8,0],["SG-259","2026-06-29",26,0,4,"sèche-serviette HS",2,8,3],["SG-191","2026-06-15",28,0,4,"meuble de rangement qui ne ferme pas",2,8,0],["SG-261","2026-06-29",26,0,4,"faire devis peinture",2,8,1],["SG-262","2026-06-29",24,0,4,"Refaire le contour des toilettes - tapisserie qui se décolle",2,8,3],["SG-263","2026-06-29",26,0,4,"enlever frigo HS + mettre nouveau frigo",2,8,3],["SG-264","2026-06-29",26,0,4,"plaques de cuisson font sauter le compteur",2,8,3],["SG-265","2026-07-31",28,0,4,"Malgré le changement de 2 ampoules la lumière de la cuisine ne fonctionne pas",2,8,0],["/","2024-09-11",28,0,4,"nettoyage complet + lessivage murs",1,8,0],["SG-267","2026-06-29",29,0,4,"enlèvement vélos encombrants",2,8,3],["SG-268","2026-06-30",21,3,4,"accrocher un tableau (le tableau est dans le bureau harmonie) au niveau de l'entrée du lycée ou il y a la carte du monde",4,8,4],["SG-269","2026-04-07",24,0,4,"mur plafond effrité au sol",1,8,0],["SG-270","2026-06-30",23,0,4,"plaques de cuisson HS - le résident m'informe que les plaques ont commencer à bruler avant de s'eteindre",3,8,3],["SG-271","2026-06-17",25,0,4,"changer matelas qui s'effrite",2,8,0],["SG-272","2026-06-17",25,0,4,"plaque de cuisson 1/2 ne fonctionne pas",2,8,0],["SG-273","2026-06-18",25,0,4,"Plaque de cuisson signale que le plaque de devant ne chauffe pas correctement",2,8,0],["SG-274","2026-08-18",25,0,4,"Douche = l'eau ne s'écoule pas après avoir pris une douche (le résident a mis du déboucheur, sans succès)",3,8,0],["SG-275","2026-04-14",25,0,4,"Robinet cuisine, l'eau coule en continue (petite fuite)",1,8,0],["SG-276","2026-06-26",25,0,4,"eau qui coule le long du robinet cuisine (depuis 6 mois, déjà déclaré à Mansour)",2,8,0],["SG-277","2026-07-10",25,0,4,"évier cuisine fuit depuis 3 mois (goutte à goutte) - M. me relance",3,8,1],["SG-278","2026-07-02",25,0,4,"les plaques de cuisson ne fonctionnent plus",3,8,0],["SG-279","2026-06-30",26,0,4,"fuite siphon BEC",2,8,3],["SG-280","2026-09-01",29,0,4,"joints cuisine cuisine à refaire",2,8,0],["SG-281","2026-06-30",24,0,4,"refaire le contour du toilette - tapisserie décoller",2,8,3],["SG-282","2026-06-30",24,0,4,"cartons de l'entreprise B.A rester dans les couloirs du 3è",2,8,0],["SG-283","2026-07-01",24,0,4,"bouton poussoir de la douche qui fuit",2,8,0],["SG-284","2026-07-01",17,0,4,"douche bouchée",3,8,0],["SG-285","2026-08-17",25,0,4,"Remettre les barres rideaux salon et entrée",2,8,4],["SG-286","2026-07-02",34,3,4,"Installation câble HDMI dans le plafond (le câble de 15m est déjà présent dans la salle)",4,8,0],["SG-287","2026-07-02",24,0,4,"Néon à changer dans la SDB",2,8,0],["SG-288","2026-07-02",24,0,4,"bouton plaque électrique défait",2,8,0],["SG-289","2026-07-02",18,0,4,"Chaudière qui fuit",3,8,3],["SG-290","2026-07-03",27,0,4,"refixer les raques à vélos du parkin ext + en rajouter ?",2,8,0],["SG-291","",24,0,4,"volet à remonter",3,8,0],["SG-292","2026-07-03",21,3,4,"Installer une paire d'enceintes au CDI u-dessu du tableauen face du videoproj",2,8,0],["SG-293","2026-07-03",16,0,4,"LED Salle de bain qui ne s'allume plus",2,8,0],["SG-294","2026-07-06",10,0,4,"Alarme incendie déclenché - voyant",3,8,3],["SG-295","2026-07-06",34,3,4,"Verrou bloqué - Porte arrière droite côté couloir informatique",2,8,0],["SG-296","2026-07-06",26,0,4,"chasse d'eau HS",3,8,3],["SG-297","2026-07-06",26,0,4,"plaques de cuisson font sauter le compteur",3,8,3],["SG-298","2026-07-06",21,3,4,"Hotte défectueuse à évacuer salle prépa µbio",2,8,3],["SG-299","2026-07-06",21,3,4,"Etagère environ 130 x 35 cm à prévoir à la place",2,8,3],["SG-300","2026-07-06",21,3,4,"Etagère à remplacer 205 x 20 cm salle prépa chimie",2,8,3],["SG-301","2026-07-06",21,3,4,"2 néons clignotent en physique, 1 en automatisme (ne pas remplacer)",2,8,3],["SG-302","2026-07-06",21,3,4,"3 tabourets dont au moins 1 tampon est à changer",2,8,3],["SG-303","2026-07-06",21,3,4,"Cordons d'alimentation de 3 loupes à réparer",2,8,3],["SG-304","2026-07-06",26,0,4,"portail de la résidence bloqué en position ouverte",2,8,0],["SG-305","2026-07-06",6,3,4,"Double prise du sèche linge HS",2,8,0],["SG-306","2026-07-06",24,0,4,"grande plaque de cuisson qui ne fonctionne pas",2,8,0],["SG-307","2026-08-19",24,0,4,"Le frigo est hs ne fait pas de froid",3,8,0],["SG-308","2026-08-13",28,0,4,"bas du meuble tv cassé (vu lors d'une entrée)",2,8,0],["SG-309","2026-07-06",29,0,3,"Débarras mobilier en palette sur le côté de la résidence (sur la pelouse)",4,8,3],["SG-310","2026-07-06",29,0,2,"Evacuation des sacs dans le local poubelle (2 sacs de bouteille en verre)",4,8,3],["SG-311","2026-07-06",29,0,2,"Tri des vélos - à planifier avec l'équipe du relais pour que l'on puisse identifier les vélos à retirer",4,8,3],["SG-312","2026-07-06",30,0,4,"changer le daaf dans son intégralité",2,8,0],["SG-313","2026-07-06",24,0,4,"tapisserie autour des WC décollée",3,8,3],["SG-314","2026-07-06",26,0,4,"Les plaques font sauter le compteur (prêt d'une plaque)",2,8,3],["SG-315","2026-06-18",25,0,4,"Volet de la chambre ne s'ouvre plus",2,8,0],["SG-316","2026-07-07",26,0,4,"évacuer vélos abandonnés",4,8,3],["SG-317","2026-07-07",26,0,4,"évacuer archives",4,8,3],["SG-318","2026-07-07",31,0,4,"le boitier de badge situé à l'entrée des résidents dysfonctionne car le soleil tape directement dessus en fin de journée",3,8,0],["SG-319","2026-06-18",25,0,4,"Poignée du meuble de la cuisine cassée",2,8,0],["SG-320","2026-05-20",25,0,4,"Goutte à goutte régulier dans les toilettes (bruits réguliers dans le réservoir)",2,8,1],["SG-321","2026-06-12",25,0,4,"chasse d'eau ne fonctionne pas",3,8,0],["SG-322","2026-06-23",25,0,4,"Porte entrée du logement ne ferme plus ni avec la clef ni avec le bouton de l'autre côté du cylindre (côté intérieur)\nLe jeune MNA ne peut pas fermer son logement",3,8,0],["SG-323","2026-07-07",4,1,4,"interrupteur   mauvais fonctionnement descente escalier ( Bel air ) EDP",1,8,3],["SG-324","2026-07-24",25,0,4,"Radiateur légèrement rouillé",4,8,3],["SG-325","2026-07-07",29,0,4,"eau de la vasque salle de bain qui s'évacue mal",2,8,3],["SG-326","2026-08-17",25,0,4,"Tartre WC",3,8,0],["SG-327","2026-07-07",27,0,4,"Changer les 2 piles des 2 volets roulant - logement jamais loué en travaux depuis 11/2025",4,8,2],["SG-363","2026-07-07",24,0,4,"Toilettes disfonctionne",2,8,3],["SG-329","2026-07-08",26,0,4,"devis peinture (entiereté du logement)",2,8,0],["SG-330","2026-08-13",28,0,4,"revisser le rail du placard de l'entrée",2,8,0],["SG-229","2026-06-22",28,0,4,"évier cuisine qui fuit",3,8,0],["SG-230","2026-06-22",28,0,4,"vasque salle de bain bouchée",3,8,0],["SG-333","2026-08-13",28,0,4,"Les plaques font sauter le compteur régulièrement",2,8,0],["SG-334","2026-07-17",28,0,4,"cuvette wc cassée",3,8,0],["SG-335","2026-07-17",28,0,4,"bonde salle de bain à changer",3,8,0],["SG-336","2026-07-09",30,0,4,"Daaf à changer",2,8,0],["SG-337","2026-07-09",31,0,4,"Remplacement du syphon en dessous le lavabo. Il fuit",2,8,0],["SG-338","",30,0,4,"Voir néon cuisine qui ne fonctionne plus suite à la coupure élec début juillet",2,8,1],["SG-339","2026-07-09",19,0,4,"Néon de la cuisine qui ne fonctionne plus",2,8,0],["SG-340","2026-07-10",29,0,4,"vis tombée de la chaise du logement, à revisser",2,8,3],["SG-341","2026-07-24",25,0,4,"Tige du lavabo salle de bain, difficile à fermer/ouvrir",4,8,3],["SG-342","2026-07-10",31,0,2,"2 tables rondes de la salle commune à évacuer (affiches sur les tables concernées \"A EVACUER\"",4,8,3],["SG-389","2026-07-13",24,0,4,"Pas d'eau froide dans le logement",3,8,3],["SG-390","2026-07-13",24,0,4,"Pas d'eau froide dans le logement",3,8,3],["SG-345","2026-07-15",7,0,4,"évier de la SDB bouché",2,8,0],["SG-346","2026-07-15",15,0,4,"porte entrée qui ne ferme pas correctement",2,8,0],["SG-347","2026-07-15",15,0,4,"porte côté jardin qui nee ferme pas correctement",2,8,0],["SG-348","2026-07-15",25,0,4,"VMC ne fonctionne plus - LOGT VISTA",2,8,1],["SG-349","2026-07-15",25,0,4,"PB sol douche : pas + de détail, VISTA ne me répond pas",2,8,1],["SG-350","2026-07-15",33,3,4,"Evier bouché et toilettes qui commencentà se boucher",2,8,3],["SG-351","",24,0,4,"enlever le matelas mousse",2,8,3],["SG-352","2026-07-15",24,0,4,"plinthe penderie à refixer",2,8,3],["SG-353","2026-06-11",25,0,4,"frigo à changer",2,8,0],["SG-354","2026-07-15",31,0,6,"Des plaques se sont arrachées sur l'une des façades de la résidence. Nous voyons la laine de verres.",3,8,3],["SG-355","2026-06-18",25,0,4,"récupérer l'ancien frigo ( a garde car fonctionne encore)",2,8,0],["SG-356","2026-08-27",25,0,4,"Joint en bas de la fenêtre se décolle et fenêtre ferme mal",2,8,0],["SG-357","2026-07-15",26,0,4,"frigo semble HS",3,8,3],["SG-358","2026-07-15",26,0,4,"devis peinture ensemble logement",2,8,0],["SG-359","2026-07-15",26,0,4,"changement ampule spot entrée",2,8,0],["SG-360","2026-07-15",26,0,4,"refixer spot salle d'eau",2,8,0],["SG-361","2026-07-17",28,0,4,"wc qui fuit, j'ai coupé l'eau",3,8,0],["SG-362","2026-06-24",28,0,4,"grand bouton poussoir chasse d'eau WC cassée",3,8,0],["SG-363","2026-05-19",25,0,4,"Absence de bonde dans la douche depuis l'entrée de la résidente",1,8,0],["SG-364","2026-05-28",25,0,4,"Néon SDB à changer",2,8,1],["SG-365","2026-07-16",26,0,4,"plaque de cuisson du haut qui fait sauter le compteur",3,8,0],["SG-366","2026-08-03",26,0,4,"changer DAAF (périmé)",3,8,0],["SG-367","2026-06-29",28,0,4,"la VMC ne fonctionne pas dans la cuisine et la salle de bain",2,8,0],["SG-368","2026-08-13",28,0,4,"problème compteur ou plaque de cuisson  (la plaque fait sauter les plombs)",3,8,0],["SG-369","2026-08-13",28,0,4,"Le volet intérieur ne coulisse plus. Il ne peut plus le fermer = chaleur ++ dans le logement",3,8,0],["SG-370","2026-07-06",28,0,4,"ampoule salle de bain grillée, n'a pas les outils pour changer l'ampoule",3,8,0],["SG-371","2026-07-15",28,0,4,"la plaque de cuisson ne fonctionne plus",2,8,0],["SG-232","2026-06-23",28,0,4,"bouton poussoir (interrupteur) cassé au néon de la cuisine",2,8,0],["SG-373","2026-07-17",27,0,4,"Récupérer clé C008 de BAL dans le chauffage dessous boite à clés",2,8,0],["SG-374","2026-07-17",36,3,4,"Enlever le fil à linge à l'extérieur etle remplacer par le nouveau fil",2,8,0],["SG-375","2026-06-23",28,0,4,"baguette verticale du placard coulissant de la chambre qui se décolle",2,8,0],["SG-376","2026-07-20",24,0,4,"frigo à changer ne fais plus de froid",3,8,3],["SG-377","2026-06-30",25,0,4,"Daaf ou pile à changer",2,8,3],["SG-378","2026-07-21",33,3,4,"Odeur forte d'égout dans les toilettes du siège",3,8,3],["SG-379","2026-08-06",28,0,4,"changer abattant WC",2,8,0],["SG-380","2026-09-01",29,0,4,"cuvette WC  à refixer",2,8,0],["SG-381","2026-08-06",28,0,4,"Change ampoule plafonner SDB",2,8,0],["SG-382","2026-07-21",18,0,4,"DAF placé derrière le salon de SCDL ou sont entreposé les trottinette et vélo des jeunes (pile ou DAF à changer)",2,8,0],["SG-383","2026-06-30",25,0,4,"néon SDB à changer",2,8,3],["SG-384","2026-08-10",28,0,4,"changer le robinet par un mitigeursdb + joint lavabo",2,8,0],["SG-385","2026-07-22",14,0,4,"Ampoule plafonnier cuisine à changer",2,8,0],["SG-386","2026-07-22",14,0,4,"dysfonctionnement plaque à induction",2,8,0],["SG-387","2026-07-23",31,0,4,"Prise murale située en face le lit est défixée",2,8,0],["SG-388","2026-07-23",24,0,4,"plus d'eau froide",3,8,3],["SG-389","2026-07-23",12,0,4,"toilettes bouchés",3,8,1],["SG-390","2026-07-24",15,0,4,"relevé de compteur svp",2,8,0],["SG-391","2026-07-24",26,0,4,"fuite importante au niveau du ballon d'eau chaude",3,8,0],["SG-392","2026-07-24",14,0,2,"débarasser les cartons dans le local",2,8,3],["SG-393","2026-07-24",16,0,4,"ampoule des toilettes du haut",2,8,0],["SG-394","2026-07-29",25,0,4,"Manivelle du VR cassé",2,8,0],["SG-395","2026-06-18",25,0,4,"Evacuer matelas en mousse",2,8,0],["SG-396","2026-06-01",25,0,4,"Poubelle extérieur de la cour à refixer (près salle commune)",2,8,1],["SG-397","2026-07-07",25,0,4,"Retrait mauvaises herbes cour intérieur + feuilles",4,8,3],["SG-398","2026-07-07",25,0,4,"Nettoyage cour intérieur (déchets, karcher, démoussage)",4,8,3],["SG-399","2026-03-24",25,0,4,"La porte s'ouvre difficilement",4,8,1],["SG-400","2026-07-07",25,0,4,"Retrait mauvaises herbes patio intérieur (entre logement 11 et logement 1)",4,8,3],["SG-401","2026-07-07",25,0,4,"Retrait toiles araignées sur l'intégralité des vitres du patio",4,8,3],["SG-402","2026-07-24",25,0,5,"Local poubelle très sale et énormément de mouches\n+ bacs jaunes non triés, les poubelles non pas pris les bacs",2,8,3],["SG-403","2026-07-01",25,0,4,"Retrait ancienne imprimante",2,8,0],["SG-404","2026-07-01",25,0,4,"Retrait du réfrigérateur, radiateur.. stockés dans la salle commune\nSalle commune louée en septembre",2,8,0],["SG-405","2026-07-07",25,0,5,"Retrait écran ordinateur salle commune",4,8,3],["SG-406","2026-07-27",24,0,4,"Chasse d'eau qui coule en continue",2,8,0],["SG-407","2026-07-27",0,0,1,"Installation des repose-pieds sur les fauteuils ergonomiques",2,8,0],["SG-408","2026-07-28",12,0,4,"porte de garage pas de serrure",2,8,3],["SG-409","2026-07-28",10,0,4,"Suivi évacuation des poubelles",2,8,6],["SG-410","2026-07-29",24,0,4,"problème chasse d'eau",3,8,0],["SG-411","2025-07-11",25,0,4,"Porte Freezer cassée",2,8,3],["SG-412","2026-06-01",27,0,4,"Fuite siphon de l'évier de  cuisine",1,8,1],["SG-413","2026-07-29",22,0,2,"désencombrer les cartons sur toutes les strcutures MNA",2,8,3],["SG-414","2026-07-30",12,0,4,"depuis changement de serrure des chambres 2 jeunes ne peuvent plus fermer avec leur clés",3,8,0],["SG-415","2026-07-30",12,0,4,"fuite d'eau SDB. Lorsqu'ils ouvrent le robinet, de l'eau s'écoule au niveau du siphon et se répand sur le sol, ce qui finit par inonder la salle de bain,",3,8,0],["SG-416","2026-08-10",28,0,4,"huiler volet coulissant salon",2,8,0],["SG-417","2026-02-26",27,0,4,"Coffre volet roulant déboîté",1,8,1],["SG-505","2026-07-31",34,3,4,"Installation câble HDMI 15m dans plafond pour vidéoproj en Sup 1.10",2,8,3],["SG-506","2026-07-31",34,3,4,"Installation câble HDMI 15m dans plafond pour vidéoproj en Sup 1.03 (Le câble est déja présent dans la classe)",2,8,3],["SG-420","2026-08-06",28,0,4,"Le néon de la cuisine ne fonctionne plus",2,8,0],["SG-421","2026-07-31",24,0,4,"poignée à refixer",2,8,0],["SG-422","2026-07-31",24,0,4,"changer le frigo",2,8,0],["SG-423","2026-07-31",24,0,4,"changer le néon de la cuisine",2,8,0],["SG-424","2026-07-31",24,0,4,"étagère à refixer",2,8,0],["SG-425","2026-02-23",27,0,4,"Placard du haut coté gauche dans la cuisine ne tient pas ouvert",1,8,1],["SG-426","2026-07-31",24,0,4,"Tapisserie autour du WC qui se décolle",2,8,0],["SG-427","2026-08-06",28,0,4,"Refaire le joint de l'évier de la cuisine",2,8,0],["SG-428","2026-08-06",28,0,4,"Remettre un bouchon + chainette à l'évier de la cuisine",2,8,0],["SG-429","2026-08-03",21,3,4,"Rideaux reçu pour EDP - Installer avant rentrée",4,8,3],["SG-431","2026-08-03",26,0,4,"Bonde lavabo à réparer (ne ferme pas entièrement)",2,8,0],["SG-432","2026-08-03",26,0,4,"tiroir sous lit déssoudé sur la droite",2,8,0],["SG-433","2026-08-10",28,0,4,"Revisser poignée porte entrée ou la changer",2,8,0],["SG-525","2026-08-04",24,0,4,"Changer panneaux l'aide entrée de la résidence",2,8,0],["SG-435","2026-09-01",29,0,4,"huiler porte placard éléctricité",2,8,0],["SG-436","2026-08-04",29,0,4,"détartrage wc et réglage chasse d'eau (éclaboussures)",2,8,0],["SG-437","2026-08-04",29,0,4,"la sonnette ne fonctionne pas",2,8,0],["SG-438","2026-08-05",26,0,4,"remplacer réfrigérateur (location au 17/08)",2,8,0],["SG-439","2026-08-06",33,3,4,"tube néon HS",2,8,0],["SG-532","2026-08-06",7,0,4,"Porte des WC bureau éduc ne ferme plus",3,8,0],["SG-441","2026-08-06",28,0,4,"Remettre le champs des portes coulissantes + réglages des portes car elles coulissent très mal",2,8,0],["SG-442","2026-08-10",28,0,4,"fuite au niveau du robinet cuisine",3,8,0],["/","2024-10-14",28,0,4,"nettoyage complet + lessivage murs",1,8,0],["SG-444","2026-07-22",28,0,4,"le joint de la porte d'entrée est décollé",2,8,0],["SG-445","2026-07-22",28,0,4,"porte du placard sous évier cassée",2,8,0],["SG-446","2026-07-31",28,0,4,"changer abattant wc",2,8,0],["SG-447","2026-07-31",28,0,4,"détartrage wc",2,8,0],["SG-448","2026-07-31",28,0,4,"remettre un bouchon + chainette évier cuisine",2,8,0],["SG-449","2026-07-31",28,0,4,"changer le meuble sous l'évier",2,8,0],["SG-450","2026-06-01",28,0,4,"poignée salle de bain qui est mal fixée",1,8,0],["SG-545","2026-08-07",24,0,4,"Réparer porte local vélo",2,8,0],["SG-452","2026-06-01",28,0,4,"doute sur le fonctionnement VMC salle de bain ET cuisine",1,8,0],["SG-453","2026-06-01",28,0,4,"pommeau de douche très entartré et barre de douche mal fixéeobligée de la tenir pour que l'eau coule",1,8,0],["SG-454","2026-08-06",28,0,4,"Evier cuisine bouché",2,8,0],["SG-455","2026-07-09",28,0,4,"Evacuation carton archives sous le copieur du bureau secrétariat : a évacuer",4,8,3],["SG-456","2026-07-17",28,0,4,"1 lumière allumée dans coursive de droite 1er étage",2,8,0],["SG-457","2026-02-06",28,0,4,"l'éclairage coursive RDC Aile A ne fonctionne toujours pas",1,8,0],["SG-458","2026-08-07",26,0,4,"fuite mitigeur douche",3,8,0],["SG-544","2026-08-07",24,0,4,"Porte laverie à réparer / régler pour que le fermeture soit - violente",2,8,0],["SG-456","2026-08-07",24,0,4,"Grande plaque cuisine ne fonctionne pas",2,8,0],["SG-461","2026-08-10",31,0,4,"Défaut d'écoulement au niveau de l'evierr de la cuisine",2,8,0],["SG-462","2026-08-10",26,0,4,"La porte d'entrée ne se vérouille plus depuis l'intérieur",3,8,3],["SG-463","2026-08-10",26,0,4,"Fuite wc à l'arrière",3,8,3],["SG-464","2026-08-10",26,0,4,"Fuite au niveau du siphon de l'évier de la cuisine",2,8,0],["SG-465","2026-06-15",28,0,4,"Installer la banderole",2,8,3],["SG-466","2026-08-11",24,0,4,"Pas d'eau froide dans le logement",3,8,0],["SG-565","2026-08-11",26,0,4,"Les 2 interrupteurs sur le mur de l'entrée côté salle de bain disfonctionnent",2,8,0],["SG-468","2026-07-09",28,0,4,"Un frigo à évacuer dans la laverie (une affiche est collé dessus A EVACUER)",4,8,3],["SG-469","2026-06-29",28,0,4,"enlèvement canapé dans le local poubelles pas de carte de déchetterie, attention aux punaises de lit",2,8,3],["SG-470","2026-07-09",28,0,5,"Nettoyage des contenairs poubelles\nPlainte réccurente des résidents qui vivent à côté, odeurs ++",2,8,3],["SG-471","2026-07-09",28,0,4,"Retrait d'un deuxième canapé dans le local poubelle - il devient difficile de sortir les poubelles",2,8,3],["SG-472","2026-07-09",28,0,4,"Un congélateur dans le local technique + un ventilateur cassé + 2 chaises + un carton avec divers éléments - 1er étage (une affiche est collé dessus A EVACUER)",4,8,3],["SG-473","2026-07-09",28,0,4,"Un frigo à nettoyer (identifié à Nettoyer)",4,8,3],["SG-474","2026-06-01",28,0,4,"lumières extérieures parking cassées ou ne fonctionnent plus le soir",1,8,0],["SG-475","2026-07-09",28,0,4,"Retrait d'un barbecue sur le parking de la résidence",4,8,3],["SG-476","2026-06-25",25,0,4,"Relevé des compteurs",2,8,0],["SG-477","2023-05-10",28,0,4,"Pas d'ampoule dans la salle commune, à coté du bureau de Florine",1,8,0],["SG-478","2026-08-18",26,0,4,"Fuite au niveau du siphon du chauffe eau",3,8,0],["SG-479","2026-08-18",26,0,4,"la porte d'entrée frotte au sol provoquant une dégradation du sol",2,8,0],["SG-480","2026-08-18",26,0,4,"fuite siphon du lavabo de la salle de bain",2,8,0],["SG-481","2026-08-19",12,0,4,"Poignée de la porte d'entrée qui ne tient plus",2,8,0],["SG-482","2026-07-13",30,0,3,"Tondre devant tous les logements en RDC - Les résidents ne peuvent plus fermer leur volet",3,8,0],["SG-587","",23,0,4,"Joint frigo HS",3,8,0],["SG-484","2026-08-04",29,0,4,"la sonnette ne fonctionne pas",2,8,0],["SG-485","2026-06-30",29,0,4,"poignée porte freezer cassée, avait déjà une fissure à l'entrée du résident",2,8,0],["SG-486","2026-08-27",29,0,4,"syphon cuisine à vérifier",2,8,0],["SG-487","2026-08-27",29,0,4,"poignée congélateur à réparer ou à changer",2,8,0],["SG-488","2026-08-27",29,0,4,"bloc chasse d'eau qui se décolle",2,8,0],["SG-489","2026-08-27",29,0,4,"joints cuisine à refaire",2,8,0],["SG-490","2026-09-01",29,0,4,"syphon à nettoyer",2,8,0],["SG-491","2026-09-01",29,0,5,"fond des wc à détarter",2,8,0],["SG-492","2026-09-01",29,0,4,"réglage chasse d'eau WC",2,8,0],["SG-604","2026-08-21",8,0,4,"Faience douche HS, plaque de commacelle",3,8,0],["SG-605","2026-08-24",24,0,4,"Plafonnier pièce de vie : manque couvercle & une ampoule",2,8,0],["SG-495","2026-08-24",29,0,4,"Fuite siphon de la salle de bain",2,8,0],["SG-496","2026-08-24",29,0,4,"Fuite siphon de l'évier de la cuisine",2,8,0],["SG-497","2026-08-24",28,0,6,"le résident ne peut pas fermer sa porte de l'extérieur, il a déjà eu ce problème en début d'année",3,8,0],["SG-498","2026-08-24",24,0,4,"relevé compteur avant le 31/08/26",2,8,0],["SG-499","2026-08-24",24,0,4,"chasse d'eau qui  dysfonctionne",2,8,0],["SG-500","2026-08-24",24,0,4,"DAF défectueux",2,8,0],["SG-501","2026-08-24",26,0,4,"spot entrée à changer",2,8,0],["SG-502","2026-08-24",26,0,4,"changer abattant WC",2,8,0],["SG-503","2026-08-24",26,0,4,"DAF à mettre",2,8,0],["SG-504","2026-08-24",26,0,4,"porte d'entrée à regler",2,8,0],["SG-505","2026-09-10",31,0,4,"Malgré intervention du 09/09/2026, le Wc fuit toujours dans la cuvette - Pb mécanisme/flotteur",2,8,0],["SG-506","2026-08-24",26,0,4,"régler porte entrée bureau caroline",2,8,0],["SG-507","2026-08-24",24,0,4,"enlever le frigo dans le bureau de Vanessa",2,8,0],["SG-508","2026-08-24",10,0,4,"Velux désenfumage ouvert - impossibilité de le refermer",3,8,0],["SG-509","2026-08-24",24,0,4,"Suite coupure de courant lumière qui reste allumée en continue dans les parties communes",3,8,0],["SG-510","2026-08-24",24,0,4,"Frigo H.S ne fait plus de froid",3,8,0],["SG-511","2026-08-24",26,0,4,"plaques de cuisson très très lentes",3,8,0],["SG-512","2026-08-25",21,3,1,"Demande d'aide pour un démagement prendre le bureau métallique anciennement de l'edp qui se trouve stocké dans le foyer pour l'installer dans l' ancien bureau d'eric prendre le bureau qui se trouve déja dans cette espace pour le mettre dans l'ancien bureau de benoit chevillon et ramener le bureau de florence pichon qui est actuellement dans le bureau de nathalie lavigne mettre l'armoire métallique qui se trouve dans le local maintenance dans l'ancien bureau de benoit également",3,8,0],["SG-513","2026-08-25",24,0,4,"Frigo ne fait plus de froid",3,8,0],["SG-514","2026-09-01",29,0,4,"charnière porte étagère droite cuisine cassée",2,8,0],["SG-515","2026-09-01",29,0,4,"pas de pression à la douche, ne put être reloué en l'état",3,8,0],["SG-633","2026-08-25",31,0,4,"Serrure local a vélos HS",2,8,3],["SG-517","2026-08-25",26,0,4,"remettre des poignées aux meubles kitchenette",2,8,0],["SG-518","2026-08-25",26,0,4,"Changement abattant WC",2,8,0],["SG-519","",33,3,4,"Néon HS",2,8,0],["SG-520","2026-08-26",26,0,4,"changement néon cuisine",3,8,0],["SG-521","2026-08-26",26,0,4,"changement frigo",3,8,0],["SG-522","2026-08-26",26,0,4,"remettre bonde lavabo sdb",3,8,0],["SG-523","2026-08-26",26,0,4,"refixer ampoule salon",3,8,0],["SG-524","",26,0,4,"refixer DAF",2,8,0],["SG-525","2026-08-26",24,0,4,"Plaque cuisson fait sauter le compteur si lumière allumé",2,8,0],["SG-526","2026-08-26",24,0,4,"Joint plaque cuisson retiré, à refaire ?",2,8,0],["SG-527","2026-08-27",12,0,4,"lave-linge : hublot ne se ferme plus et impossible de lancer un programme",3,8,0],["SG-528","2026-08-27",24,0,4,"Frigo ne fait plus de froid",3,8,0],["SG-529","2026-07-24",25,0,4,"Faire relevés des compteurs avant le 31 juillet",2,8,1],["SG-530","2026-08-27",26,0,4,"Réglage porte d'entrée (très difficile à ouvrir)",3,8,0],["SG-531","2026-08-27",26,0,4,"Réglage frigo (frotte énormément au sol)",3,8,0],["SG-532","2026-08-27",21,3,4,"Il faut déconnecter les prises de la salle bel air 0,2 dont la terre est connecté au 230V",0,8,3],["SG-533","2026-08-27",21,3,4,"Goulote cable HDMI à côté du tableau à recoller",3,8,0],["SG-534","2026-08-27",21,3,4,"Volet roulant bloqué en position fermé",3,8,0],["SG-535","2026-08-27",26,0,4,"Changer le néon de la laverie",2,8,0],["SG-536","2026-08-25",29,0,4,"fuite siphon du lavabo de la SDB",2,8,0],["SG-537","2026-08-20",29,0,4,"refixer serrure trappe du port-bagage",2,8,0],["SG-538","2026-08-31",31,0,4,"La chasse d'eau coule en continu - pb méc WC/ flotteur",2,8,0],["SG-539","2026-08-31",31,0,4,"Le syphon de la cuisine résident ne tient plus",3,8,0],["SG-540","2026-08-31",24,0,4,"volet fermé ne remonte plus",2,8,0],["SG-541","2026-08-31",26,0,4,"plaque du bas qui fait sauter le compteur",2,8,0],["SG-542","2026-08-31",21,3,4,"salle bel air 0,2 (classe term cgea2) couper l'arrivée d'eau",1,8,0],["SG-543","2026-08-31",26,0,4,"régler porte entrée",2,8,0],["SG-544","2026-08-31",26,0,4,"régler porte entrée",2,8,0],["SG-545","2026-08-31",26,0,4,"les plaques font sauter le différentiel",3,8,0],["SG-546","2026-08-31",26,0,4,"poignée salle de bain fixé à l'envers",2,8,0],["SG-547","2026-08-31",26,0,4,"plaque du bas qui fait sauter le compteur",3,8,0],["SG-548","2026-08-31",26,0,4,"abattant WC à refixer",2,8,0],["SG-549","2026-08-31",26,0,4,"évacuer frigo du bureau caroline",2,8,0],["SG-550","2026-08-31",26,0,4,"mettre frigo",2,8,0],["SG-551","2026-09-01",8,0,4,"évier bouché",2,8,0],["SG-552","2026-09-01",29,0,4,"régler les portes étagères cuisine qui se frottent  quand on les ouvre ensemble",2,8,0],["SG-554","2026-08-20",29,0,4,"joints cuisine à refaire",2,8,0],["SG-555","2026-07-20",25,0,3,"porte donnant sur le jardin est de nouveau débloquée et beaucoup de passages - merci de la revérouillée comme auparavant",2,8,3],["SG-556","2026-08-20",29,0,4,"réparer porte meuble sous évier",2,8,0],["SG-557","2026-08-20",29,0,4,"pieds chaises à revisser",2,8,0],["SG-558","2026-09-01",26,0,4,"mettre bonde lavabo",2,8,0],["SG-559","2026-09-01",26,0,4,"changer plaques de cuisson",2,8,0],["SG-560","2026-08-20",29,0,3,"barrière bois qui s'effondre devant la résidence le long du parking, elle risque de tomber",3,8,0],["SG-561","2026-08-20",29,0,4,"une serrure de boîte aux lettres à changer , celle du 17 n'est pas accessible, le résident du 17 utilise donc la 1ère boîte aux lettres en haut à gauche",2,8,0],["SG-562","",22,2,0,"poignée de porte d'entrée dortoir à refixer",1,8,0],["SG-563","",22,2,0,"box de gauthier étagère gauche cassée petite penderie",1,8,0],["SG-564","2026-09-02",25,0,4,"Retirer les miroirs dans la salle commune (en lien avec demande du 01/07/26)\nSalle louée en septembre",2,8,0],["SG-565","2026-04-27",28,0,4,"porte extérieure qui mène au local poubelle bloquée, les poubelles sont dehors",1,8,0],["SG-566","2026-07-09",28,0,4,"Salle commune étage - 2 meubles à évacuer (une affiche est collé dessus A EVACUER)",4,8,3],["SG-567","2026-07-17",28,0,4,"chasse d'eau qui coule tout le temps, j'ai coupé l'arrivée d'eau",3,8,0],["SG-568","2026-07-09",28,0,4,"WC rez de chaussée : un meuble 3 tiroirs à évacuer (une affiche est collé dessus A EVACUER)",4,8,3],["SG-569","2026-06-29",28,0,4,"enlèvement vélos encombrants",2,8,3],["SG-570","2026-07-07",31,0,2,"Enlever les vélos situés dans le local vélo. Ils sont empilés",1,8,0],["SG-571","2026-09-02",28,0,2,"enlèvement grande TV stockée dans la laverie",2,8,0],["SG-572","2026-09-02",38,3,4,"Sanitaire 7- douche 4 : pas de pression",3,8,0],["SG-573","",22,2,0,"ch 114  : interrupteur chambre cassé",3,8,0],["SG-574","",22,2,0,"ch 316 - box :Heidi :lumiere de box ne fonctionne pas",3,8,0],["SG-575","2026-09-03",21,3,4,"Rideau a raccrocher au labo biologie",1,8,0],["SG-576","2026-09-03",7,0,4,"poignée de la chambre cassée - impossible de l'ouvrir de l'extérieur",3,8,0],["SG-577","2026-09-03",12,0,4,"Une des vis de la plaque mise pour la serrure du garage de la moutonnerie ne tient plus",2,8,0],["SG-578","2026-09-03",34,3,4,"Chasse d'eau cassé toilette etage sup agri",3,8,0],["SG-797","2026-09-09",5,3,4,"Au N-1, WC Hommes, la lumière du côté des utinoirs est grillée. Selon Arnaud, la douille est à changer car c'est un vieux système et les ampoules n'existent plus...",2,8,0],["SG-580","2026-09-03",37,3,4,"L'un des robinets laisse couler de l'eau sans arrêt si on ne tire pas le bouton à poussoir",3,8,0],["SG-581","",38,2,0,"Ch 221: box a Oceane Michaud : Neon de bureau a changer",2,8,0],["SG-582","2026-09-03",23,0,4,"remplacer frigo (HS à cause dégat des eaux)",3,8,0],["SG-583","",38,2,0,"ch 304 box Naolie Bridonneau : Prise sur le bloc lumiere qui fonctionne pas",2,8,0],["SG-584","",22,2,0,"Sanitaire 6 : douche 5 : evier bouche et le robinet du lavabo bouche",1,8,0],["SG-585","2026-08-31",26,0,4,"refixer mitijeur cuisine",2,8,0],["SG-586","2026-08-27",26,0,4,"régler porte (très difficile ouverture et fermeture)",3,8,0],["SG-587","2026-09-04",23,0,4,"plus d'eau chaude",3,8,0],["SG-588","2026-09-08",25,0,4,"Fuite robinet évier cuisine",2,8,0],["SG-589","2026-09-08",29,0,4,"refaire joints cuisine",2,8,0],["SG-590","2026-09-04",26,0,4,"refixer spot sdb",2,8,0],["SG-591","2026-09-08",37,3,4,"Câble USB de la salle 8 (écrasé)",3,8,0],["SG-592","2026-09-07",7,0,4,"Serrure toilettes qui ne ferme plus",3,8,0],["SG-593","2026-09-07",21,3,4,"Retirer le tableau blanc de mon bureau pour le fixer dans la salle\n sec 0.3, et enlever le tableau défectueux, merci",3,8,0],["SG-594","2026-09-07",21,3,4,"Fixer une bande de prises dans la salle sec 0,3 pour brancher\nles tablettes, merci",3,8,0],["SG-595","2026-09-04",25,0,4,"Plaques de cuisson ne chauffent quasiment pas",2,8,0],["SG-596","",22,2,0,"Ch 111  : 1er box a gauche : Neon du bureau a changer",3,8,0],["SG-597","",22,2,0,"Ch 211: 3ieme box a droite : Neon de bureau a changer",3,8,0],["SG-598","",22,2,0,"Sanitaire 1 : Douche 4 et 6 : eviers bouchés",3,8,0],["SG-599","2026-09-04",25,0,4,"Mettre frigo dans son meuble d'origine (enlever le dessus si cela est possible, afin qu'il passe)",2,8,0],["SG-600","2026-09-04",25,0,4,"Robinet SDB : tartre + fuite",2,8,0],["SG-601","2026-09-04",25,0,4,"Portes coulissantes très dures à ouvrir",2,8,0],["SG-602","2026-08-31",26,0,4,"L'eau de la douche coule juste 2 secondes",2,8,0],["SG-603","2026-09-10",26,0,4,"fuite groupe sécu ballon",2,8,0],["SG-604","2026-09-09",21,3,4,"Refixer la goulotte électrique dans la salle des AVS et réparer la porte",2,8,0],["SG-605","2026-09-10",28,0,4,"néon qui clignotte , le résident a changé 2 fois l'ampoule",3,8,0],["SG-606","2026-09-10",26,0,4,"néon kitchenette à changer (il s'allume une fois sur deux)",2,8,0],["SG-607","2026-09-04",26,0,4,"fuite mitijeur cuisine",3,8,0],["SG-608","2026-07-23",31,0,4,"Condamner la prise murale à côté du local \"ATMOS\" - RDC aile B",1,8,0],["SG-609","2026-06-02",31,0,4,"vérifier les tables de jardin",1,8,0],["SG-610","2026-09-10",29,0,4,"cuvette WC à revisser",2,8,0],["SG-611","2026-09-10",29,0,4,"porte étagère dessuis évier à régler, frottement au mur",2,8,0],["SG-612","2026-09-10",26,0,4,"plaques de cuisson ne chauffent pas",3,8,0],["SG-613","2026-09-10",26,0,4,"Réglage porte d'entrée",2,8,0],["SG-614","2026-09-11",26,0,4,"refixer socle spot sdb",2,8,0],["SG-615","2026-09-11",26,0,4,"Mettre DAF",2,8,0],["SG-616","2026-09-08",26,0,4,"Plus d'électricité dans le logement. Echange Téléphonique avec Valentin. Dépannage impossible à distance",3,8,0],["SG-617","2026-09-08",26,0,4,"Problème de pression d'eau au niveau de la douche",2,8,0],["SG-618","2026-09-11",37,3,4,"réglage de notre porte d'entrée qui est difficile à fermer",2,8,0],["SG-619","2026-09-11",21,3,4,"Pose d'un cadenas dans le petit placard de gauche en dessous de la table de l'amphi + enlever les étagères du petit placard pour pouvoir insérer l'enceinte debout",3,8,0],["SG-620","2026-09-14",25,0,5,"Nettoyage cour intérieur de la résidence : retrait des déchets au sol, mégots, bouteilles, ect..",2,8,0],["SG-621","2026-07-21",28,0,4,"remettre barillet serrure local poubelle",2,8,0],["SG-622","2026-09-02",25,0,4,"Miroir rouillé, à changer",2,5,0],["SG-623","2026-09-01",21,3,4,"Ajouter un tableau blanc dans mon bureau (entrée du lycée)",2,5,0],["SG-624","2026-09-01",24,0,4,"Frigo ne fait plus de froid - à changer",3,8,0],["SG-625","2026-09-01",24,0,4,"étagère à refixer",2,5,0],["SG-626","2026-09-01",29,0,4,"plafond de salle de bain piqué",2,5,1],["SG-627","2026-08-20",29,0,4,"table à réparer ou à changer (un pied cassé)",2,5,4],["SG-628","2026-09-01",21,3,4,"La porte de la salle Sec1.7 ne s'ouvre pas une fois qu'elle est fermée à clefs",3,8,0],["SG-629","2026-08-20",29,0,4,"fissure verticale  long du mur entre salle de bain et kitchenette à colmater",2,5,0],["SG-630","2026-08-20",29,0,4,"retouches éclats porte salle de bain coté extérieur",2,5,0],["SG-631","2026-09-01",16,0,4,"volet qui ne se remonte plus",2,8,0],["SG-632","2026-08-31",8,0,4,"Ajout d'une table ou un bureau dans le logement",2,5,0],["SG-633","2026-08-20",29,0,4,"reboucher éclats placard compteur eau",2,5,0],["SG-634","2026-09-01",29,0,4,"trou à reboucher sur mur cuisine",2,5,0],["SG-635","2026-08-25",29,0,1,"changer le matelas , pas en stock",2,5,4],["SG-636","2026-08-27",26,0,4,"Le volet roulant ne s'ouvre et ne se ferme plus. Location 31/08",3,5,0],["SG-637","2026-08-27",24,0,4,"commode cassée",2,5,0],["SG-638","2026-08-26",26,0,4,"changement séche-serviette, corrossion avancée",3,5,0],["SG-639","2026-08-25",29,0,4,"peinture murs entier salon ou juste une bande où la peinture est arrachée?",2,5,1],["SG-640","2026-08-24",26,0,4,"nettoyage hublots et toiles araignées coursives",2,5,0],["SG-641","2026-08-24",23,0,4,"Changement barillet, pas de clé",3,5,0],["SG-642","2026-08-27",29,0,4,"champ d'une étagère au dessus évier abimé et décollé",2,5,0],["SG-643","2026-08-27",29,0,4,"fissure et éclat plafond salon",2,5,0],["SG-644","2026-08-27",29,0,4,"marque humidité plafond salle de bain et cuisine",2,5,0],["SG-645","2026-08-20",29,0,4,"repeindre intérieur porte entrée",2,5,1],["SG-646","2026-08-20",29,0,4,"repeindre plafond logement",3,5,1],["SG-647","2026-08-20",29,0,4,"repeindre murs logement pour éviter de nouvelles dégradations",3,5,1],["SG-648","2025-03-12",28,0,4,"voir si possibilité de remettre en état les murs",1,5,1],["SG-649","2026-07-09",28,0,4,"Entretien des espaces verts : tonte et retrait des mauvaises herbes parking, patio intérieur de la résidence, aux abords de la résidence",4,5,3],["SG-650","2026-07-09",28,0,5,"Coursives de la résidence, escalier : Nettoyage karcher, enlèvement des toiles d'araignées",4,5,3],["SG-651","2026-08-04",29,0,4,"les bandes de placo du plafond de la salle de bain sont décollées sur plusieurs cm",2,5,1],["SG-652","2026-07-31",24,0,4,"abattant WC à changer",2,5,0],["SG-653","2026-08-10",28,0,5,"ménage total du logement",2,5,2],["SG-654","2026-08-10",28,0,4,"Changer porte chambre",2,5,0],["SG-655","2026-07-29",22,0,4,"porte entrée à régler",2,5,3],["SG-656","2026-08-10",28,0,4,"repeindre tous les murs, plafonds et plinthes , intérieur placard chambre",2,5,1],["SG-657","2026-07-28",17,0,4,"support pour accrocher la pomme de douche au mur tombé",2,8,0],["SG-658","2026-07-28",40,0,3,"vérification des espaces verts et entretien si besoin",2,5,3],["SG-659","2026-06-11",30,0,4,"le volet est coincé et ne veut plus se fermer",2,5,0],["SG-660","2026-07-07",25,0,4,"Retrait des archives (salle commune et chalet)",4,5,3],["SG-661","2026-07-07",25,0,5,"Nettoyage des vitres intérieur et extérieur RDC de la résidence\nSalle commune, patio, entrée, bureau",4,5,0],["SG-662","2026-07-07",25,0,5,"Nettoyage des abords de la résidences (extérieur) - porte entrée, chaufferie. Nettoyage de la porte, retrait des toiles d'araignées",4,5,3],["SG-663","2026-07-24",30,0,4,"Faire relevés des compteurs avant le 31 juillet",2,8,0],["SG-664","2026-06-30",25,0,4,"plafond SDB à repeindre",2,5,1],["SG-665","2026-08-10",28,0,4,"changer ou repeindre étagères entrée",2,5,0],["SG-666","2026-07-06",24,0,4,"Devis pour changement de volet",4,5,0],["SG-667","2026-08-10",28,0,4,"Changer porte salle de bain",2,5,0],["SG-668","2026-07-21",26,0,4,"remplacement fenêtre séjour (devis normalement en cours)",2,5,0],["SG-669","2026-07-17",28,0,5,"plafond salle de bain noirci en totalité",3,5,0],["SG-670","2026-07-17",28,0,4,"peintures à faire dans tout le logement",3,5,0],["SG-671","2026-07-17",28,0,4,"enlever étagères posées par résident",3,5,0],["SG-672","2026-07-17",28,0,4,"enlever adhésif cuisine + chambre",3,5,0],["SG-673","2026-07-17",28,0,5,"nettoyage +++ logement entier",3,5,0],["SG-674","2026-07-17",27,0,4,"4 chaises supplémentaires à mettre dans le local rangement\navant le 18/09/26",2,5,0],["SG-675","2026-07-24",25,0,5,"Une fois les travaux réalisés, prévoir le nettoyage de l'appartement\nToilette entartré, sol toilette présence de tâches, sol salle de bain présence de tâches (attention élément collés au sol qui se décolle), intérieur du réfrigérateur, nettoyage derrière le frigo, placard au dessus et en dessous de l'évier, plaque de cuisson (tâche ++), joint faïence cuisine à nettoyer, poussière mobilier, sol séjour, VMC salle de bain et cuisine, toiles araignées intérieur logement, toiles araignées aux abord de la fenêtre, portes intérieur du logement (salle de bain, WC, porte entrée)",4,5,1],["SG-676","2026-07-17",28,0,4,"changement barillet?",3,8,3],["SG-677","2026-07-17",28,0,5,"nettoyage +++ du logement entier",3,5,1],["SG-678","2026-07-17",28,0,4,"peintures à faire dans tout le logement",3,5,1],["SG-679","2026-07-09",4,1,4,"fermer au niveau des urinoirs toilettes EDP (Porte)",1,5,0],["SG-680","2026-07-08",26,0,4,"devis peinture (entiereté du logement)",2,5,0],["SG-681","2026-06-30",29,0,6,"la porte d'entrée se vérouille et se déverouille seule, j'entends des déclenchements de mon bureau alors qu'il n'y a personne à la porte, quelque fois ça s'enclenche plusieurs fois de suite et par moments plus rien",3,5,3],["SG-682","2026-07-07",29,0,4,"peinture qui s'écaille au plafond de la salle de bain et au plafond du salon,tâches plafond cuisine",4,5,1],["SG-683","2026-07-07",30,0,4,"Atelier : Rangement, tri, classement, retrait des éléments qui ne servent pas",4,5,3],["SG-684","2026-07-24",25,0,4,"Nettoyage plafond",4,5,1],["SG-685","2026-07-24",25,0,4,"Nettoyage des murs et ou peinture?",4,5,1],["SG-686","2026-07-24",25,0,4,"Changement sol séjour",4,5,1],["SG-687","2026-06-30",24,0,4,"Volet de la chambre qui ne remonte plus",2,5,0],["SG-688","2026-07-06",29,0,3,"Retirer les mauvaises herbes au sein des coursives et sur le parking (près des grillages, sur le goudron ...)",4,5,3],["SG-689","2026-07-06",29,0,3,"Nettoyage du local vélo (feuilles)",4,5,3],["SG-690","2026-07-06",29,0,3,"Démoussage / nettoyage karcher des coursives extérieur et escalier de la résidence",4,5,3],["SG-691","2026-07-06",29,0,3,"Démoussage et karcher devant la résidence et sous les boites aux lettres",4,5,3],["SG-692","2026-07-30",23,0,4,"changer barillet de la BAL du logement 185 car plus les clefs",3,5,0],["SG-693","2026-04-07",24,0,4,"infiltration baie vitrée",1,5,0],["SG-694","2025-08-01",25,0,4,"plinthes des wc",1,5,0],["SG-695","2026-07-03",30,0,3,"retirer le vélo désossé sur le parking à vélos",2,5,3],["SG-696","2025-08-01",25,0,4,"peinture plafond SDB taches  d'humidité",1,5,0],["SG-697","2025-07-09",25,0,4,"Moisissure plafond SDB",1,5,0],["SG-698","2026-07-24",25,0,5,"Ménage complet du logement après les interventions maintenance\nToilettes très sale (tâché), sol salle de bain tâché, lavabo salle de bain à nettoyer, sol séjour (il y a des choses qui se décollent en frottant fort), rail placard , vitres et fenêtre intérieur et extérieur, placard cuisine, evier et plaque de cuisson, pourssière mobilier, intérieur frigo, VMC salle de bain et cuisine, portes intérieures du logement (WC, salle de bain, porte entrée)",4,5,1],["SG-699","2026-07-24",25,0,4,"Changer ou repreindre le placard au dessus de l'évier - usure ++",2,5,3],["SG-700","2026-08-13",28,0,4,"Le bloc de la VMC est cassé",2,7,0],["SG-701","2026-06-30",17,0,4,"Livraison 15 miroirs 600x420mm",2,5,0],["SG-702","2026-07-17",28,0,4,"tablette salle de bain descellée",3,8,0],["SG-703","2026-06-30",4,1,4,"Plaque metal HS terrain de sport (foot)",1,5,0],["SG-704","2026-06-30",4,1,4,"deux plaques plastiques sur le bac a graisse derriere le self HS",1,5,0],["SG-705","2026-06-29",33,3,4,"Pose de 2 rideaux occultants comme le bureau COPACABANA suite à la canicule",4,5,0],["SG-706","2026-06-26",29,0,4,"installer une table à l'extérieur sur espace vert",2,5,1],["SG-707","2026-06-24",6,3,4,"Dalles plafond tâchées",2,5,0],["SG-708","2026-06-24",28,0,4,"VMC qui ne fonctionne pas",2,5,0],["SG-709","2026-06-24",6,3,4,"Fissure murs",2,5,0],["SG-710","2026-07-17",28,0,4,"peintures à faire dans tout le logement",3,5,3],["SG-711","2026-07-06",28,0,4,"rail de la porte coulissante du placard qui tombe",2,5,0],["SG-712","2026-07-17",28,0,4,"bas de porte salle de bain réparée avec une pièce mais possible de changer la porte?",2,5,0],["SG-713","2026-07-29",8,0,4,"trou dans le mur entre entre la salle de bain et la cuisine",3,5,0],["SG-714","2026-07-15",25,0,5,"Nettoyage pour le sol et la poussière sur le mobilier après travaux (attention tâches bien collés au sol, qui peuvent partir en frottant fort) + joint faience très sale",2,5,1],["SG-715","2026-07-17",28,0,5,"nettoyage +++ logement entier",3,5,1],["SG-716","2026-04-07",24,0,4,"sol à changer",1,5,0],["SG-717","2025-08-21",24,0,4,"Barillet HS. Je l'ai changé mais ce n'est pas un de ceux de la résidence",1,5,0],["SG-718","2025-02-10",24,0,4,"étagère à fixer + installer rideau",1,5,0],["SG-719","2023-09-01",24,0,4,"Infilitration d'eau plafond côté fenêtre",1,5,0],["SG-720","2026-07-17",28,0,4,"changement barillet? pas de clé mais ouverture avec pass PC",3,5,1],["SG-721","2026-07-06",21,3,4,"Une (petite) partie du parquet en physique est à nouveau à nu. Prévoir de le revitrifier ?",4,5,0],["SG-722","2026-07-06",21,3,4,"Le 1er néon du couloir des labos reste trop longtemps allumé et se rallume tout seul (sans mouvement)",2,8,0],["SG-723","2026-02-12",6,3,4,"robinet de la plonge pas d'eau chaude",1,5,0],["SG-724","2025-06-20",33,3,4,"Est il possible de poser un film UV sur les petites fenêtres derrière mon siège de bureau ?",1,5,0],["SG-725","2024-10-10",33,3,4,"Infiltration plafond bureau Agro Direction (Valentin informé)",1,5,0],["SG-726","2026-06-02",5,3,4,"reboucher le trou dans le mur suite au travaux effectués au niveau de l'interrupteur (l'équipe a déjà constaté le problème)",2,5,0],["SG-727","2026-04-15",5,3,4,"Problème dans les toilettes du RDC (femmes). Un lavabo fuit car difficulté à refermer le robinet, problème de joint ?",2,5,0],["SG-728","2026-03-06",5,3,4,"Mettre un nouvel éclairage, mettre pavés led",2,5,0],["SG-729","2025-11-25",5,3,4,"installer supports plafonniers pour les vidéoprojecteurs",2,5,0],["SG-730","2025-09-05",37,3,4,"Sur certaines tables de cours : plaquer les champs tombés ou décollés ainsi que remettre les patins manquants sur les pieds",4,5,3],["SG-731","2025-09-25",36,3,4,"Mur humide et apparition moisissures dans le bureau coordination",4,5,0],["SG-732","2026-07-28",7,0,4,"tableaux à accrocher",2,5,3],["SG-733","2025-07-29",36,3,4,"Changer néon salles de cours \nSalle 1 : 12 néons \nsalle Accueil : 8 néons \nLabo : 2 néons \nSalon de toilettage : 2 néons \nSalle 4 : 4 néons \nSalle 3 : 6 néons",2,5,3],["SG-734","2026-06-16",21,3,4,"Ravalement de facade coté SUP AGRI",2,5,0],["SG-735","2026-06-16",21,3,4,"Refaire les lignes du parking BTS",2,5,0],["SG-736","2026-05-21",27,0,4,"le sol est gondolé devant la fenêtre du séjour (humidité)",2,5,0],["SG-737","",27,0,4,"crédence de la cuisine qui se décolle",4,5,1],["SG-738","2026-08-10",28,0,4,"changer VMC cuisine",2,7,0],["SG-739","2026-01-09",27,0,4,"l'attache de la barre de douche est cassée",2,5,0],["SG-740","2026-01-09",27,0,4,"2 grosses fissure mur après cuisine + pied du lit",1,5,1],["SG-741","2026-01-06",27,0,4,"Grosse fissure mur de droite dans la cuisine",1,5,1],["SG-742","2026-06-01",28,0,4,"pas de planche sous le meuble de l'évier",1,5,0],["SG-743","2026-01-21",14,0,4,"Moisissuresur porte de SDB",1,5,0],["SG-744","2026-01-21",14,0,4,"Moisissure",1,5,0],["SG-745","2024-03-15",14,0,4,"Réapparition de la moississure",1,5,0],["SG-746","2026-02-03",12,0,4,"Présence moisissure",1,5,0],["SG-747","2025-06-02",12,0,4,"moisissure chambre à droite au bout du couloir",1,5,0],["SG-748","2025-06-02",12,0,4,"moisissure SDB",1,5,0],["SG-749","2026-08-10",31,0,4,"Interphone",2,5,0],["SG-750","2026-04-13",30,0,4,"Retirer la machine à laver qui ne fonctionne plus (attention il reste de l'eau dedans)",1,5,3],["SG-751","2023-12-01",30,0,4,"Refaire 1 clé logements 10 et 13",1,5,3],["SG-752","2026-04-24",7,0,4,"2 tableaux blancs à installer dans le bureau éducateur \n1 tableau en liège installer dans le bureau éducateur \n\n1 tableau en liège à installer dans le salon des jeunes\n1 tableau blanc à installer dans le salon des jeunes",1,5,0],["SG-753","2026-09-07",31,0,4,"Plusieurs résidents - Aile B se plaignent que l'eau chaude met du temps à venir,voir aps du tout à certains moments",3,5,0],["SG-754","2026-04-13",31,0,4,"la porte vitrée qui joint les deux bureaux ne peut plus s'ouvrir",1,5,0],["SG-755","2024-01-02",31,0,4,"Derrière l'accueil - constat d'une flaque d'eau entre le couloir et la baie informatique. Fuite provenant des dalles qui sont tâchées",1,5,0],["SG-578","2026-08-18",31,0,1,"Apparittion de fissures dans l'un des murs d'entrée (on y passe une clé). Photo adressée par mail.",4,5,0],["SG-757","2026-09-02",28,0,4,"chaise à changer + table si possible",2,5,3],["SG-758","2026-09-02",28,0,4,"lessivage murs cuisine",2,5,4],["SG-759","2026-09-02",28,0,4,"trou mur entrée à reboucher",2,5,0],["SG-760","2026-07-21",28,0,4,"refaire sol partie jour",2,5,0],["SG-761","2026-07-21",28,0,4,"refaire peintures logement entier",2,5,0],["SG-762","2026-06-16",21,3,4,"Enlever les 2 grandes enseignes \"ARMONIA\" sur les 2 façades extérieures",2,5,0],["SG-763","",21,3,4,"CH 301 n'est plus une chambre de surveillants a partir de lundi ca va devenir une chambre pour les eleves BTS donc il manque 2 portes de placard",4,5,0],["SG-764","2026-08-25",29,0,4,"fuite siphon évier de la cuisine",2,5,0],["SG-765","2025-09-01",21,3,4,"Ch 313: Il manque 2 portes de placard , les deux derniers boxs au fond a gauche dont un ,il faudra adapter la porte",4,5,0],["SG-766","2024-11-08",25,0,4,"PB MOISSISSURES SDB",3,5,0],["SG-767","2026-07-15",25,0,5,"Devis à faire pour nettoyage = sol, poussière mobilier",2,5,1],["SG-768","2026-08-20",29,0,4,"plaque fond étagère meuble au-dessus évier à refixer",2,5,0],["SG-749","2026-09-04",5,3,4,"Avant le 25/09/2026 : \nEnlever le comptoir le long des fenêtres et le stocker à l'école (voir avec Florian)\nEnlever 2 etagères suspendues (vertes)\nEnlever le convecteur électrique sous la fenêtre\nMettre goulotte pour fils qui descendent du plafond\nChangement de l'emplacement de la boite à clé\nChangement de sens de l'ouverture de la porte qui va vers le bureau d'Aurélie\nChangement de la serrure de la porte qui va vers le couloir\nEchange de 2 bureaux du 1er étage (Cédric) avec le bureau de l'accueil",4,5,0],["SG-716","2026-09-02",21,3,4,"Absence d'un rideau dans la salle de classe de TCGEA1 + Autres rideaux transparents (pb de luminosité avec le vidéo)",2,8,0],["SG-715","2026-09-02",21,3,4,"Rideau décroché dans salle de classe de 2CGEA2",2,8,0],["SG-772","2024-02-23",31,0,4,"Local électrique 202 (en face le logement 228) \nconstat d'une fuite d'eau dans le local électrique lorsqu'il pleut - voir avec la SMAC Valentin ?",1,5,0],["SG-533","2026-08-06",23,0,4,"Porte entre cuisine et séjour laisse un jour",2,5,0],["SG-519","2026-08-03",24,0,4,"DAF mal fixé",2,5,0],["SG-518","2026-08-03",24,0,4,"Evier boucher cuisine",2,5,0],["SG-488","2026-07-27",24,0,4,"Loquet porte d'entrée ne fonctionne pas",2,5,0],["SG-487","2026-07-27",24,0,4,"Porte du placard sortie des rails",2,5,0],["SG-449","2026-07-21",24,0,4,"loquet interieur porte se retire",2,5,0],["SG-264","2026-06-26",9,0,4,"volet bloqué dans la salle du bas",2,7,0],["SG-259","2026-06-26",36,3,4,"Fixer les accroches des manivelles des rideaux des salles de cours",2,5,0],["SG-257","2026-06-25",5,3,4,"Changer le battant des toilettes femmes de gauche du rez de chaussée",2,5,0],["SG-782","2026-09-09",29,0,5,"détartrage wc",2,5,4],["SG-783","",38,2,0,"salle de devoir 2 pb interupteur",1,5,0],["SG-784","2026-09-08",35,3,4,"Accrocher banderole PO",3,5,0],["SG-785","2026-09-08",35,3,5,"Vitrerie au dessus du SAS d'entrée",2,5,0],["SG-786","2026-09-08",29,0,5,"syphon cuisine à nettoyer",2,5,4],["SG-787","2026-09-08",36,3,2,"Palette à évacuer",2,5,0],["SG-788","2026-09-08",36,3,6,"Fixer l'extincteur (voir où sur le nouveau plan d'évacuation) \nAttention : intervention à prévoir un mardi ou un jeudi",4,5,0],["SG-789","2026-09-08",36,3,1,"Acheter / récuperer 5 cales portes",3,5,0],["SG-790","2026-09-08",37,3,4,"Réparer la porte d'entrée du fond (suite vandalisme)",0,5,0],["SG-791","",22,2,0,"box 307 2ieme box a droite: Paroidu coté droit du box mal fixé",2,5,0],["SG-792","2026-09-07",21,3,4,"La sonnerie dans le couloir des labos ne fonctionne plus",2,5,0],["SG-793","2026-09-07",24,0,4,"barre de la porte d'entrée qui bouge",2,5,0],["SG-794","2026-09-07",26,0,4,"bouton de sortie porte d'entrée reste enclenché (bruit sonore important et la porte ne se ferme plus)",3,5,3],["SG-795","2026-09-07",30,0,4,"remplacer le néon kitchenette qui a grillé",2,5,0],["SG-796","2023-11-21",31,0,4,"? des pbms de chauffage récurrents ces dernières années\nun devis n'avait pas été validé par rapport à une pièce du système de chauffage",1,5,0],["SG-797","2026-09-07",27,0,4,"Volet roulant bloqué en mode fermé - j'ai changé la pile il y a 2 mois",3,5,0],["SG-798","2026-09-07",24,0,4,"robinet SDB qui bouge",2,5,0],["SG-799","2026-09-07",24,0,4,"Baie vitrée qui ne ferme pas des 2 côtes",2,5,0],["SG-800","2026-09-07",24,0,4,"DAF défectueux",2,5,0],["SG-801","2026-09-04",25,0,4,"VMC cuisine à vérifier",2,5,0],["SG-802","2026-09-04",25,0,4,"Peinture plafond SDB à revoir : points de moisissure au dessus de la douche",2,5,0],["SG-803","2026-09-04",25,0,4,"Bouche VMC SDB à vérifier",2,5,0],["SG-804","2026-09-04",25,0,4,"Interphone HS",2,5,0],["SG-805","2026-09-04",25,0,5,"nettoyer le sol de la pièce de vie, qui est collant et laisse des traces",2,5,0],["SG-806","2026-09-04",25,0,4,"miroir rouillé, à changer",2,5,0],["SG-807","2026-09-04",34,3,4,"Néon clignotant",2,5,0],["SG-808","",22,2,0,"La sonnerie ne semble pas fonctionner au niveau de la margerie une partie du puy",1,5,0],["SG-809","2026-09-03",24,0,4,"Lumière qui clignote face au log 406",2,5,0],["SG-810","2026-09-03",33,3,4,"Une souris est présente au sein du siège. Elle a été apperçu dans le bureau de la Compta et le bureau de la Comm",2,5,0],["SG-811","2026-09-03",30,0,4,"Revoir le verrou du bureau du fond qui tourne dans le vide, beaucoup de mal à ouvrir",2,5,0],["SG-812","2026-09-09",21,3,4,"Réparer la pédale du vélo-bureau de la salle 0,7 classe de 4ème",2,5,0],["SG-813","2026-09-10",30,0,4,"les plaques de cuisson chauffent très mal = l'eau ne bout jamais",2,5,0],["SG-814","2026-09-10",36,3,4,"WC savon de gauche ne s'écoule pas",2,5,0],["SG-815","2026-09-10",36,3,4,"Siphon fuit petit lavabo",3,5,0],["SG-816","2026-09-10",36,3,4,"Sèche mains à remplacer car inefficace",2,5,0],["SG-817","2026-09-10",29,0,4,"plafond à réparer comme dans les autres logements",2,5,5],["SG-818","2026-09-10",29,0,3,"nettoyage toiles araignées dans les coursives et devant portes entrées des logements",2,5,0],["SG-819","2026-09-10",28,0,3,"enlever le gros receptacle qui sert de cendrier près de la porte du hall qui va à l'extérieur",2,5,0],["SG-820","2026-09-10",28,0,3,"installer cendriers à chaque niveau",2,5,0],["SG-821","2026-09-10",24,0,4,"Grande plaque de cuisson qui fait sauter le compter",2,5,0],["SG-822","2026-09-10",29,0,4,"porte du placard eau qui n'a plus de peinture",2,5,0],["SG-823","2026-09-11",26,0,4,"tiroir sous le lit ne ferme pas complétement",2,5,0],["SG-824","2026-09-14",7,0,4,"Porte placard cuisine gonds défectueux",2,5,0],["SG-825","2026-09-14",7,0,4,"Local API eaux sur les dalles au sol",2,5,0],["SG-826","2026-09-14",27,0,5,"nettoyage des poubelles + sol",4,5,2],["SG-827","2026-09-14",24,0,4,"commander barillet log 302 (V43)",3,5,0],["SG-828","2026-09-14",24,0,4,"installer le nouveau barillet du 302 au 312 et cvelui du 302 au 312",3,5,0],["SG-829","2023-10-06",31,0,4,"Changement du barillet (avec molette côté intérieur du logement) et redonner barillet échangé à Fabien",1,5,0],["SG-830","2026-09-15",13,0,4,"porte bureau éducateur difficile à ouvrir + serrure qui dysfonctionne",3,5,0],["SG-831","2026-09-15",24,0,4,"grande plaque de cuisson qui ne fonctionne pas",2,5,0],["SG-832","2026-09-15",12,0,4,"porte de cuisine qui tient",2,5,0],["SG-833","2026-09-15",27,0,4,"Plaque de cuisson cassée",3,5,2],["SG-834","2026-09-15",27,0,4,"Plaque de cuisson cassée",3,5,2],["SG-835","2026-09-15",27,0,4,"Cuvette des toilettes cassée",3,5,0],["SG-836","2026-09-15",27,0,4,"Porte d'entrée de la résidence ne ferme pas depuis le 18/08/2026",3,8,2],["SG-837","2026-09-15",27,0,4,"Barrière cassée parking depuis le 02/07/2026",3,5,2],["SG-838","2026-09-15",29,0,4,"interphone qui ne fonctionne pas",3,5,0],["SG-839","2026-09-15",25,0,4,"entrée : moisissure plafond",2,5,0],["SG-840","2026-09-15",25,0,4,"SDB : miroir rouillé, à remplacer",2,5,0],["SG-841","2026-09-15",25,0,4,"SDB : émail de la baignoire qui s'enlève",2,5,0],["SG-842","2026-09-15",25,0,4,"SDB : VMC à revoir",2,5,0],["SG-843","2026-09-15",25,0,4,"PIECE DE VIE : Radiateur ne chauffe pas",2,5,0],["SG-844","2026-09-15",25,0,4,"SDB : miroir rouillé, à remplacer",2,5,0],["SG-845","2026-09-15",25,0,4,"SDB : VMC à revoir",2,5,0],["SG-846","2026-09-15",25,0,4,"SDB : miroir rouillé, à remplacer",2,5,0],["SG-847","2026-09-15",25,0,4,"SDB : VMC à revoir",2,5,0],["SG-848","2026-09-15",25,0,4,"SDB : moisissure au sol",2,5,0],["SG-849","2026-09-15",25,0,4,"ENTREE : porte d'entrée ne ferme plus, obligé de fermer à clé",2,5,0],["SG-850","2026-09-15",25,0,4,"SDB : VMC à revoir",2,5,0],["SG-851","2026-09-15",25,0,4,"SDB : radiateur rouillé",2,5,0],["SG-852","2026-09-15",25,0,4,"SDB : moisissure plafond",2,5,0],["SG-853","2026-09-15",25,0,4,"SDB : miroir rouillé, à remplacer",2,5,0],["SG-854","2026-09-15",25,0,4,"SDB : VMC à revoir",2,5,0],["SG-855","2026-09-15",25,0,4,"SDB : miroir rouillé, à remplacer",2,5,0],["SG-856","2026-09-15",25,0,4,"SDB : VMC à revoir",2,5,0],["SG-857","2026-09-15",25,0,4,"SDB : radiateur rouillé",2,5,0],["SG-858","2026-09-15",25,0,4,"SDB : VMC à revoir",2,5,0],["SG-859","",22,2,0,"rideau cassé sup 1,5",1,5,0],["SG-860","2026-09-16",21,3,4,"Evacuation table cassée",2,8,0],["SG-861","2026-09-16",28,0,4,"Changer l'ampoule dans l'entrée",2,8,0],["SG-862","2026-09-16",21,3,4,"Câble HDMI coupé - salle MM2",2,8,0],["SG-863","2026-09-17",20,0,4,"changement barillet - clé cassé dans la serrure",3,7,0],["SG-864","2026-09-17",20,0,4,"changement du four poignée cassée",2,5,0],["SG-865","2026-09-17",8,0,4,"fléxible de douche cassée",2,5,0],["SG-866","2026-09-17",37,3,4,"support des poublles de tric \"à rénover\"",2,5,0],["SG-867","2026-09-17",30,0,4,"Joint crédence cuisine se décolle (déjà signalé à son entrée dans le logt)",2,5,0],["SG-868","2026-09-17",21,3,4,"Salle Bel Air 0,2 (TCGEA2) : Tableau blanc trop petit avec le vidéo / Prévoir un petit tableau complémentaire ou changement de tableau pour un plus grand",2,8,0],["SG-869","2026-09-17",21,3,4,"Changement des rideaux salle Bel air (TCGEA1) car ils sont transparents (pb avec vidéo)",2,8,0],["SG-870","2026-09-17",33,3,5,"Merci de nettoyer le fond des poubelles de la salle de pause lors du changement des sacs, car il y a des moucherons et asticots.",1,0,0],["SG-871","2026-09-17",29,0,5,"syphon cuisine à nettoyer",2,5,0],["SG-872","2026-09-17",24,0,4,"Frigo à changer",3,8,0],["SG-873","2026-09-17",30,0,4,"Néon SDB ne fonctionne plus",2,5,0],["SG-874","2026-09-17",30,0,4,"Néon SDB ne fonctionne plus",2,5,0],["SG-875","2026-09-17",25,0,5,"Sol collant pièce de vie, à nettoyer",2,5,0],["SG-876","2026-09-17",29,0,4,"toilettes communes: fuite WC handicapé  quand on tire la chasse d'eau",2,5,0],["SG-877","2026-09-17",37,3,4,"une fenetre de la salle 3 ne ferme plus",3,8,0],["SG-878","2026-09-18",10,0,4,"porte placard cassée",2,5,0],["SG-879","2026-09-18",25,0,4,"Evacuation des WC lente",2,5,0],["SG-880","2026-09-18",24,0,4,"Robinet de la cuisine fuit un peu",2,5,0],["SG-881","2026-09-18",27,0,4,"Elle n'a plus d'eau chaude dans son logement",3,0,0],["SG-882","",24,3,4,"Plaque de cuisson HS",3,5,0],["SG-883","2026-09-21",33,3,4,"Néon tisanerie qui ne fait que clignoter",2,5,0],["SG-884","2026-09-21",8,0,4,"douche qui ne fonctionne plus",3,5,0],["SG-885","2026-09-21",26,0,4,"Mettre matelas (matelas actuel trop petit)",2,5,4],["SG-886","2026-09-21",24,0,4,"Baie vitrée fissurée ++",2,5,0],["SG-887","2026-09-21",7,0,4,"problème de serrure, la clé ne tourne pas",1,5,0],["SG-888","2026-09-21",24,0,4,"plaques de cuisson qui font sauter l'électricité malgré séchage",3,5,0],["SG-889","2026-09-21",24,0,4,"plaques de cuisson qui font sauter l'électricité malgré séchage",3,5,0],["SG-890","2026-09-21",27,0,3,"Grillage côté parking a été coupé",2,5,0],["SG-891","2026-09-21",10,0,4,"débarraser les encombrants",2,5,0],["SG-892","2026-09-22",17,0,4,"porte de placard au dessus et en dessous de l'évier à refixer - charnières cassées",2,5,0],["SG-893","2026-09-22",31,0,4,"Le volet droit ne se remonte plus",2,5,0],["SG-894","2026-09-22",26,0,4,"Le sèche serviette ne fonctionne pas",2,5,0]]};

// Décode DEMANDES_SEED (le fichier Excel tel qu'importé la première fois)
// vers le format des documents Firestore `demandes` — utilisé UNIQUEMENT
// par le bouton d'import initial, jamais affiché directement.
function seedLignes() {
  const d = DEMANDES_SEED;
  return d.rows.map(r => ({
    numero: r[0], dateDemande: r[1] || null, site: d.sites[r[2]] || "Non renseigné",
    association: d.assocs[r[3]] || "Autres", type: d.types[r[4]] || "",
    descriptif: r[5], urgence: d.urgences[r[6]] || "Non renseignée",
    statut: d.statuts[r[7]] || "Non renseigné", intervenant: d.intervenants[r[8]] || "",
    commentaireTech: "",
  }));
}

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

let ui = {
  vue: "tableau", // "tableau" | "stats"
  moisOuvert: null,
  filtreStatut: "a-traiter", // "a-traiter" | "tous" | un statut précis
  filtreUrgence: "",
  filtreSites: [], // tableau vide = tous les sites ; sinon liste des sites cochés (sélection multiple)
  filtreAssociation: "",
  recherche: "",
};

let state = { demandes: null }; // null = pas encore chargé
let unsub = null;
let mountedUser = null;

export function mountSuiviDemandesTab(container, user) {
  if (unsub) { unsub(); unsub = null; }
  mountedUser = user;
  state = { demandes: null };
  render(container);
  unsub = watchDemandes((liste) => { state.demandes = liste; render(container); });
}

function permsUtilisateur() {
  const role = mountedUser?.role;
  const isEditor = role === "super_admin" || role === "admin" || role === "n1";
  const isTech = role === "technicien";
  const lectureSeule = !!mountedUser?.lectureSeule; // "Lecture" (cas par cas) : voit le tableau mais ne peut pas traiter
  return { isEditor, isTech, lectureSeule, peutTraiter: (isEditor || isTech) && !lectureSeule };
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

function fmtDateFR(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function render(container) {
  if (ui.vue === "tableau") return renderTableau(container);
  const cle = ui.moisOuvert;
  const mois = cle ? DONNEES_DEMANDES.mois.find(m => m.cle === cle) : null;
  if (mois) return renderPageMois(container, mois);
  return renderAccueil(container);
}

function toggleVueHTML() {
  return `
    <div class="demandes-vue-toggle">
      <button type="button" class="demandes-vue-btn ${ui.vue === "tableau" ? "active" : ""}" data-vue="tableau">📋 Tableau des demandes</button>
      <button type="button" class="demandes-vue-btn ${ui.vue === "stats" ? "active" : ""}" data-vue="stats">📊 Statistiques</button>
    </div>`;
}

function attacherToggleVue(container) {
  container.querySelectorAll("[data-vue]").forEach(btn => {
    btn.addEventListener("click", () => {
      ui.vue = btn.dataset.vue;
      if (ui.vue === "stats") ui.moisOuvert = null;
      render(container);
    });
  });
}

// ---- Vue "Tableau" : liste individuelle filtrable, pour traiter le fichier ----

// Ramène un document Firestore `demandes` (noms de champs complets) vers
// la forme compacte utilisée par l'affichage du tableau.
function ligneDepuisDoc(d) {
  return {
    id: d.id, n: d.numero || "—", date: d.dateDemande || null, site: d.site || "Non renseigné",
    association: d.association || "Autres", type: d.type || "", descr: d.descriptif || "",
    urgence: d.urgence || "Non renseignée", statut: d.statut || "Non renseigné",
    intervenant: d.intervenant || "", commentaireTech: d.commentaireTech || "",
    dateIntervention: d.dateIntervention || "",
  };
}

function toutesLesLignes() {
  return (state.demandes || []).map(ligneDepuisDoc);
}

function lignesFiltrees() {
  return toutesLesLignes().filter(l => {
    if (ui.filtreStatut === "a-traiter" ? STATUTS_TRAITES.includes(l.statut) : (ui.filtreStatut && ui.filtreStatut !== "tous" && l.statut !== ui.filtreStatut)) return false;
    if (ui.filtreUrgence && l.urgence !== ui.filtreUrgence) return false;
    if (ui.filtreSites.length > 0 && !ui.filtreSites.includes(l.site)) return false;
    if (ui.filtreAssociation && l.association !== ui.filtreAssociation) return false;
    if (ui.recherche) {
      const q = ui.recherche.toLowerCase();
      const hay = `${l.n} ${l.site} ${l.descr} ${l.type} ${l.intervenant}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }).sort((a, b) => {
    const ou = (ORDRE_URGENCE[a.urgence] ?? 9) - (ORDRE_URGENCE[b.urgence] ?? 9);
    if (ou !== 0) return ou;
    return (b.date || "").localeCompare(a.date || "");
  });
}

function badgeStatut(statut) {
  const couleur = statut === "Réalisé" ? "var(--teal)" : statut === "Annulé" ? "var(--red)" : "var(--gold)";
  return `<span class="tag" style="background:color-mix(in srgb, ${couleur} 18%, transparent);color:${couleur};border-color:color-mix(in srgb, ${couleur} 40%, transparent)">${esc(statut)}</span>`;
}

function badgeUrgence(urgence) {
  const couleur = COULEUR_URGENCE[urgence] || "var(--text-dim)";
  const icone = urgence === "Critique" ? "🔴" : urgence === "Urgent" ? "🟠" : urgence === "À planifier" ? "🗓️" : urgence === "Normal" ? "🟢" : "⚪";
  return `<span class="tag" style="background:color-mix(in srgb, ${couleur} 18%, transparent);color:${couleur};border-color:color-mix(in srgb, ${couleur} 40%, transparent)">${icone} ${esc(urgence)}</span>`;
}

function selectHTML(id, label, options, valeur) {
  return `
    <label class="demandes-filtre">
      <span>${esc(label)}</span>
      <select id="${id}">
        <option value="">Tous</option>
        ${options.map(o => `<option value="${esc(o)}" ${o === valeur ? "selected" : ""}>${esc(o)}</option>`).join("")}
      </select>
    </label>`;
}

function statutSelectHTML(id, valeur) {
  return `<select class="demandes-cell-select" id="${id}">
    ${DEMANDES_SEED.statuts.map(s => `<option value="${esc(s)}" ${s === valeur ? "selected" : ""}>${esc(s)}</option>`).join("")}
  </select>`;
}

// Multi-sélection de sites : un <select multiple> natif (Ctrl/Cmd+clic ou
// glisser pour cocher plusieurs sites à la fois) — pour qu'un technicien
// qui tourne sur 2-3 sites voie tout d'un coup, pas un site à la fois.
function siteMultiSelectHTML(sites, selectionnes) {
  return `
    <label class="demandes-filtre demandes-filtre-sites">
      <span>Site(s)</span>
      <select id="demandes-f-sites" multiple size="4">
        ${sites.map(s => `<option value="${esc(s)}" ${selectionnes.includes(s) ? "selected" : ""}>${esc(s)}</option>`).join("")}
      </select>
    </label>`;
}

function renderTableau(container) {
  const perms = permsUtilisateur();

  if (state.demandes === null) {
    container.innerHTML = `<div class="stack">${toggleVueHTML()}<div class="hint">Chargement des demandes…</div></div>`;
    attacherToggleVue(container);
    return;
  }

  if (state.demandes.length === 0) {
    container.innerHTML = `
      <div class="stack">
        ${toggleVueHTML()}
        <div class="demandes-source-note">
          Aucune demande importée pour l'instant. ${perms.isEditor
            ? `Clique pour charger les demandes du fichier Excel <b>${esc(DEMANDES_SEED_NOM)}</b> dans l'appli (un seul import nécessaire, sans risque de doublon en cas de reclic).`
            : "Demande à un responsable de faire l'import initial depuis le fichier Excel."}
        </div>
        ${perms.isEditor ? `<button type="button" class="demandes-vue-btn" id="demandes-importer">⬆️ Importer les demandes du fichier Excel</button>` : ""}
      </div>`;
    attacherToggleVue(container);
    if (perms.isEditor) {
      document.getElementById("demandes-importer").addEventListener("click", async (e) => {
        e.target.disabled = true; e.target.textContent = "Import en cours…";
        try {
          const n = await importerDemandes(seedLignes());
          e.target.textContent = `${n} demandes importées ✓`;
        } catch (err) {
          console.error("importerDemandes:", err);
          e.target.disabled = false; e.target.textContent = "⬆️ Importer les demandes du fichier Excel (échec, réessayer)";
        }
      });
    }
    return;
  }

  const lignes = lignesFiltrees();
  const total = state.demandes.length;
  const aTraiterTotal = toutesLesLignes().filter(l => !STATUTS_TRAITES.includes(l.statut)).length;

  container.innerHTML = `
    <div class="stack">
      <div class="demandes-source-note">
        📥 Demandes importées depuis le fichier Excel externe <b>${esc(DEMANDES_SEED_NOM)}</b>${perms.peutTraiter ? " — change le statut ou l'intervenant directement dans le tableau, ça s'enregistre tout de suite." : ""}. La resynchro automatique vers le fichier Excel (SharePoint) n'est pas encore en place.
      </div>

      ${toggleVueHTML()}

      <div class="demandes-tiles" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
        <div class="demandes-tile"><div class="demandes-tile-label">À traiter</div><div class="demandes-tile-value" style="color:var(--gold)">${aTraiterTotal}</div></div>
        <div class="demandes-tile"><div class="demandes-tile-label">Affichées (filtres)</div><div class="demandes-tile-value">${lignes.length}</div></div>
        <div class="demandes-tile"><div class="demandes-tile-label">Total importé</div><div class="demandes-tile-value" style="color:var(--text-dim)">${total}</div></div>
      </div>

      <div class="form-card demandes-filtres">
        <label class="demandes-filtre demandes-filtre-recherche">
          <span>🔎 Recherche</span>
          <input type="text" id="demandes-recherche" placeholder="N°, site, description, intervenant…" value="${esc(ui.recherche)}">
        </label>
        <label class="demandes-filtre">
          <span>Statut</span>
          <select id="demandes-f-statut">
            <option value="a-traiter" ${ui.filtreStatut === "a-traiter" ? "selected" : ""}>À traiter (non réalisé/annulé)</option>
            <option value="tous" ${ui.filtreStatut === "tous" ? "selected" : ""}>Tous les statuts</option>
            ${DEMANDES_SEED.statuts.map(s => `<option value="${esc(s)}" ${ui.filtreStatut === s ? "selected" : ""}>${esc(s)}</option>`).join("")}
          </select>
        </label>
        ${selectHTML("demandes-f-urgence", "Urgence", DEMANDES_SEED.urgences, ui.filtreUrgence)}
        ${selectHTML("demandes-f-association", "Association", DEMANDES_SEED.assocs, ui.filtreAssociation)}
        ${siteMultiSelectHTML([...DEMANDES_SEED.sites].sort(), ui.filtreSites)}
        <button type="button" class="demandes-reset-btn" id="demandes-reset-filtres">✕ Réinitialiser</button>
      </div>
      ${ui.filtreSites.length > 0 ? `<p class="hint">Sites sélectionnés : ${ui.filtreSites.map(esc).join(", ")}</p>` : ""}

      <div class="demandes-table-wrap">
        <table class="demandes-table">
          <thead>
            <tr>
              <th>N°</th><th>Date</th><th>Site</th><th>Association</th><th>Description</th><th>Urgence</th><th>Statut</th><th>Intervenant</th><th>Date interv.</th>
            </tr>
          </thead>
          <tbody>
            ${lignes.length === 0 ? `<tr><td colspan="9" class="demandes-table-empty">Aucune demande ne correspond à ces filtres.</td></tr>` : lignes.map(l => `
              <tr data-id="${esc(l.id)}">
                <td class="mono">${esc(l.n)}</td>
                <td class="mono">${fmtDateFR(l.date)}</td>
                <td>${esc(l.site)}</td>
                <td>${esc(l.association)}</td>
                <td class="demandes-table-descr" title="${esc(l.descr)}${l.type ? " — " + esc(l.type) : ""}${l.commentaireTech ? " — Note : " + esc(l.commentaireTech) : ""}">${esc(l.descr) || "<span class=\"text-dim\">—</span>"}${l.commentaireTech ? ` <span class="demandes-note-flag" title="${esc(l.commentaireTech)}">📝</span>` : ""}</td>
                <td>${badgeUrgence(l.urgence)}</td>
                <td>${perms.peutTraiter ? statutSelectHTML(`statut-${esc(l.id)}`, l.statut) : badgeStatut(l.statut)}</td>
                <td>${perms.peutTraiter ? `<input type="text" class="demandes-cell-input demandes-input-intervenant" id="interv-${esc(l.id)}" value="${esc(l.intervenant)}" placeholder="—">` : (esc(l.intervenant) || "<span class=\"text-dim\">—</span>")}</td>
                <td>${perms.peutTraiter ? `<input type="date" class="demandes-cell-input demandes-input-date-interv" id="dateinterv-${esc(l.id)}" value="${esc(l.dateIntervention)}">` : (fmtDateFR(l.dateIntervention) === "—" ? "<span class=\"text-dim\">—</span>" : fmtDateFR(l.dateIntervention))}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
      ${perms.peutTraiter ? `<p class="hint">Astuce : clique sur 📝 ou passe la souris sur une description pour voir la note technicien laissée dessus. Renseigne la "Date interv." quand tu interviens réellement, ça sert pour les statistiques de délai. Pour ajouter une note, ouvre la demande — pas encore possible depuis cet écran, dis-moi si tu en as besoin.</p>` : ""}
    </div>
  `;

  attacherToggleVue(container);
  document.getElementById("demandes-recherche").addEventListener("input", e => {
    ui.recherche = e.target.value;
    const curseur = e.target.selectionStart;
    render(container);
    // innerHTML a recréé le champ : on lui redonne le focus + la position du curseur
    // pour que la frappe reste fluide (sinon un seul caractère à la fois).
    const champ = document.getElementById("demandes-recherche");
    if (champ) { champ.focus(); champ.setSelectionRange(curseur, curseur); }
  });
  document.getElementById("demandes-f-statut").addEventListener("change", e => { ui.filtreStatut = e.target.value; render(container); });
  document.getElementById("demandes-f-urgence").addEventListener("change", e => { ui.filtreUrgence = e.target.value; render(container); });
  document.getElementById("demandes-f-association").addEventListener("change", e => { ui.filtreAssociation = e.target.value; render(container); });
  document.getElementById("demandes-f-sites").addEventListener("change", e => {
    ui.filtreSites = Array.from(e.target.selectedOptions).map(o => o.value);
    render(container);
  });
  document.getElementById("demandes-reset-filtres").addEventListener("click", () => {
    ui.filtreStatut = "a-traiter"; ui.filtreUrgence = ""; ui.filtreSites = []; ui.filtreAssociation = ""; ui.recherche = "";
    render(container);
  });

  if (perms.peutTraiter) {
    container.querySelectorAll(".demandes-cell-select").forEach(sel => {
      sel.addEventListener("change", async (e) => {
        const id = e.target.closest("tr").dataset.id;
        e.target.disabled = true;
        try { await updateDemande(id, { statut: e.target.value }); }
        catch (err) { console.error("updateDemande statut:", err); alert("Échec de l'enregistrement du statut — réessaie."); e.target.disabled = false; }
        // Pas de réactivation en cas de succès : le onSnapshot Firestore va rafraîchir tout l'écran de toute façon.
      });
    });
    container.querySelectorAll(".demandes-input-intervenant").forEach(inp => {
      inp.addEventListener("change", async (e) => {
        const id = e.target.closest("tr").dataset.id;
        e.target.disabled = true;
        try { await updateDemande(id, { intervenant: e.target.value.trim() }); }
        catch (err) { console.error("updateDemande intervenant:", err); alert("Échec de l'enregistrement de l'intervenant — réessaie."); e.target.disabled = false; }
      });
    });
    container.querySelectorAll(".demandes-input-date-interv").forEach(inp => {
      inp.addEventListener("change", async (e) => {
        const id = e.target.closest("tr").dataset.id;
        e.target.disabled = true;
        try { await updateDemande(id, { dateIntervention: e.target.value }); }
        catch (err) { console.error("updateDemande dateIntervention:", err); alert("Échec de l'enregistrement de la date — réessaie."); e.target.disabled = false; }
      });
    });
  }
}

// ---- Vue "Statistiques" : cumul global + une page par mois ----

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

      ${toggleVueHTML()}

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

  attacherToggleVue(container);
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

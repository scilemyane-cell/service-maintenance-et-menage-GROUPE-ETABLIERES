// contrats-rh-donnees.js — Référentiel du formulaire « RH01 - Demande de contrat »
// (CCN OEFMT, Groupe Établières) : métiers (catégorie / statut), taux
// d'ancienneté, critères classants, codes analytiques, listes, et le calcul
// des points / rémunération / période d'essai / quotité, comme dans l'Excel.

// Barème par défaut (NAO 2026). Modifiable dans l'appli (⚙️ Barème).
export const BAREME_DEFAUT = {
  maj: "oct-26", titre: "CONTRAT OEFMT - NAO 2026",
  indices: { 1: 870, 2: 900, 3: 970 }, supraCP: 125, valeurPoint: 20.91, minimumPoints: 1104, minimumMensuel: 1923.03, heuresAnnuelles: 1565,
  // Salaire minimum conventionnel : 1 923,03 € brut/mois (23 076,36 €/an) = 1104 points à 20,91 €.
  smic: "SMIC applicable au 01/06/2026 : 12,31 €/h, soit 1867,02 € brut temps plein",
  point: "Valeur du Point CNEAP : 20,91/an au 01/09/2026",
  nao: "NAO 2026 signée 05/10/2026 rétroactive au 01/09/2026",
};

// [métier, catégorie, statut]
export const METIERS = [["ADJOINT DIRECT. FORMATIONS INITIALES", 3, "CADRE"], ["ADJOINT DIRECT. FORMATION SUP. & CONTINUES", 3, "CADRE"], ["ADJOINT DIRECT. DAPA", 3, "CADRE"], ["ADJOINT DIRECT. VIE SCOLAIRE", 3, "CADRE"], ["ADJOINTE RESPONSABLE DE SITE", 3, "CADRE"], ["AGENT D'ACCUEIL DENTRETIEN ET DE MAINTENANCE", 1, "O/E"], ["AGENT DE SERVICE", 1, "O/E"], ["APPRENTI ASSIST. ADMINISTRATIVE", 2, "T/AM"], ["APPRENTI ASSISTANT COMMUNICATION", 2, "T/AM"], ["APPRENTI ASSISTANTE ADMINISTRATIVE", 2, "T/AM"], ["APPRENTI MONITRICE EDUCATRICE", 2, "T/AM"], ["ASSISTANT EDUCATEUR VIE SCOLAIRE", 1, "O/E"], ["ASSISTANT GEST.PAIE ADP", 2, "T/AM"], ["ASSISTANTE ADMINISTRATIVE", 2, "T/AM"], ["ASSISTANTE COMMUNICATION", 2, "T/AM"], ["ASSISTANTE DE DIRECTION 2", 2, "T/AM"], ["ASSISTANTE DE DIRECTION 3", 3, "CADRE"], ["ASSISTANTE DE DIRECTION GENERALE", 3, "CADRE"], ["ASSISTANTE DE GESTION LOCATIVE", 2, "T/AM"], ["ASSIST GESTION LOCATIVE / INTERVENANT ACTION SOCIALE", 2, "T/AM"], ["ASSISTANTE EDUCATRICE", 1, "O/E"], ["ASSIST RH CHARGEE RH", 2, "T/AM"], ["ASSISTANTE SERVICES GENERAUX", 2, "T/AM"], ["AUXILIAIRE DE VIE SCOLAIRE", 1, "O/E"], ["CHARGE DE MISSION", 3, "CADRE"], ["CHARGE DE VIE RESIDENTIELLE / GESTION LOCATIVE", 2, "T/AM"], ["COMPTABLE", 2, "T/AM"], ["CONSEILLERE ADMINISTRATIVE ET SOCIALE", 2, "T/AM"], ["CONSEILLERE SOCIO-EDUCATIVE", 2, "T/AM"], ["CONSEILLERE SOCIO-EDUCATIVE SECRETAIRE ADMINISTRATIVE", 2, "T/AM"], ["CONTROLEUSE DE GESTION", 3, "CADRE"], ["COORD. PEDAG. ASSIST. ADMIN", 2, "T/AM"], ["COORDINATRICE ADMINISTRATIVE FORMATION", 3, "CADRE"], ["COORDINATRICE FORMATION", 2, "T/AM"], ["COORDINATRICE HYGIENE SANTE", 2, "T/AM"], ["COORDINATRICE RESPONSABLE GROUPE", 2, "T/AM"], ["COORDINATRICE RS CONSEILLERE SOCIO-ADMINISTRATIVE", 2, "T/AM"], ["COORDINATEUR.TRICE DISPOSITIF MNA", 2, "T/AM"], ["D.A.F", 3, "CADRE"], ["DIR. DEVELOP. REL. EXTERN.", 3, "CADRE"], ["DIRECT. DELEGUE RESP. FORMATION", 3, "CADRE"], ["DIRECTEUR SERVICES GENERAUX", 3, "CADRE"], ["DIRECTRICE ASSOCIATION AGROPOLIS", 3, "CADRE"], ["DIRECTRICE RICHESSES HUMAINES", 3, "CADRE"], ["DIRECTRICE QUALITE ORGANISATION", 3, "CADRE"], ["EDUCATEUR VIE SCOLAIRE", 2, "O/E"], ["FORMATEUR Cat.2 (<Licence)", 2, "T/AM"], ["FORMATEUR Cat.3 (Licence-Ingénieur Master)", 3, "CADRE"], ["FORMATEUR COORDINATEUR", 2, "T/AM"], ["FORMATEUR RESP. FORM", 3, "CADRE"], ["GESTIONNAIRE PAIE RICHESSES HUMAINES", 2, "T/AM"], ["HOTE D'ACCUEIL STANDARDISTE", 1, "O/E"], ["INTERVENANT.E ACTION SOCIALE", 2, "T/AM"], ["MONITEUR EDUCATEUR", 2, "T/AM"], ["MONITRICE EDUC 50% COORD RESP GROUPE MNA 50%", 2, "T/AM"], ["RESP. CENTRE DE FORMATION", 3, "CADRE"], ["RESP. SERVICE COMMUNICATION", 3, "CADRE"], ["RESPONSABLE ACCUEIL DE GROUPE", 3, "CADRE"], ["RESPONSABLE COMPTABLE", 3, "CADRE"], ["RESPONSABLE DES RESIDENCES", 3, "CADRE"], ["RESPONSABLE RICHESSES HUMAINES", 3, "CADRE"], ["RESPONSABLE DEV. ORG. & RSE", 3, "CADRE"], ["RESPONSABLE DISPOSITIF MNA", 3, "CADRE"], ["RESPONSABLE EQUIPE MENAGE", 3, "CADRE"], ["RESPONSABLE FORMATION.S", 3, "CADRE"], ["RESPONSABLE SECURITE", 3, "CADRE"], ["RESPONSABLE VIE SCOLAIRE", 3, "CADRE"], ["RONDIER - VEILLEUR DE NUIT", 2, "T/AM"], ["SECRETAIRE", 1, "O/E"], ["SECRETAIRE ADMIN. RES. UNIVERSITAIRE SOCIALE", 2, "T/AM"], ["SECRETAIRE RESIDENCE SOCIALE", 2, "T/AM"], ["TECHNICIENNE DE LABORATOIRE", 2, "T/AM"], ["TECHNICIEN DE MAINTENANCE", 2, "T/AM"], ["TECHNICIEN INFORMATIQUE ET NUMERIQUE", 2, "T/AM"], ["VEILLEUR DE NUIT", 1, "O/E"], ["VIE SCOLAIRE SURVEILANT", 1, "O/E"], ["VIE SCOLAIRE VEILLEUR", 1, "O/E"]];
// Taux d'ancienneté par catégorie (indice 1 = 850, 2 = 880, 3 = 950 dans la CCN), index = années (0 → 43).
export const TAUX_ANCIENNETE = {"1": [0, 0.01, 0.01, 0.02, 0.02, 0.03, 0.03, 0.04, 0.04, 0.05, 0.05, 0.06, 0.06, 0.07, 0.07, 0.08, 0.08, 0.09, 0.09, 0.1, 0.1, 0.11, 0.11, 0.12, 0.12, 0.13, 0.13, 0.14, 0.14, 0.15, 0.15, 0.16, 0.16, 0.17, 0.17, 0.18, 0.18, 0.19, 0.18, 0.2, 0.2, 0.21, 0.21, 0.22], "2": [0, 0.01, 0.01, 0.01, 0.02, 0.02, 0.02, 0.03, 0.03, 0.03, 0.04, 0.04, 0.04, 0.05, 0.05, 0.05, 0.06, 0.06, 0.06, 0.07, 0.07, 0.07, 0.08, 0.08, 0.08, 0.09, 0.09, 0.09, 0.1, 0.1, 0.1, 0.11, 0.11, 0.11, 0.12, 0.12, 0.12, 0.12, 0.12, 0.12, 0.12, 0.12, 0.12, 0.12], "3": [0, 0.01, 0.01, 0.01, 0.02, 0.02, 0.02, 0.03, 0.03, 0.03, 0.04, 0.04, 0.04, 0.05, 0.05, 0.05, 0.06, 0.06, 0.06, 0.07, 0.07, 0.07, 0.08, 0.08, 0.08, 0.09, 0.09, 0.09, 0.1, 0.1, 0.1, 0.11, 0.11, 0.11, 0.12, 0.12, 0.12, 0.12, 0.12, 0.12, 0.12, 0.12, 0.12, 0.12]};
export const PTS_CRITERES = [5, 10, 15, 20, 25, 30, 35, 45, 50, 60, 75, 100, 150, 200];
export const PTS_DIPLOME = [15, 30, 50, 80, 100, 120, 180];
// Accord NAO 2026 (7 oct. 2026, effet 01/09/2026), annexe 2 : points par degré (1 à 4) et par catégorie.
const DEG_BASE = { 1: [6, 12, 18, 24], 2: [16, 23, 27, 37], 3: [31, 37, 47, 63] };
export const DEGRES = {
  autonomie: DEG_BASE, relationnel: DEG_BASE, technicite: DEG_BASE,
  management: { 1: [0, 0, 0, 0], 2: [16, 23, 37, 80], 3: [53, 80, 158, 210] },
  pedagogie: { 1: null, 2: [16, 23, 37, 108], 3: [52, 108, 157, 211] },
};
// Annexe 2.4 : points au titre des formations et qualifications [libellé, catégorie, points].
export const QUALIFS = [
  ["PVS Formation certifiante ou qualifiante AEVS", 1, 15], ["PVS Formation certifiante ou qualifiante EVS", 2, 20], ["PVS Formation certifiante ou qualifiante CVS", 2, 50],
  ["PVS Formation certifiante ou qualifiante RVS", 3, 50], ["Coordinateur opérationnel CQP", 3, 120], ["Enseignant-formateur BTS ou DE JEPS", 2, 50],
  ["Enseignant-formateur Licence ou DES JEPS", 2, 80], ["Enseignant-formateur Licence", 3, 80], ["Enseignant-formateur Master 2 ou diplôme d'ingénieur", 3, 122], ["Enseignant-formateur Doctorat", 3, 180],
];
export function ptsCritere(c, k, cat) {
  if (k === "formation") { const q = QUALIFS.find(x => x[0] === c.qualification); if (q) return q[2]; }
  const d = +(c.degres?.[k] || 0), t = DEGRES[k]?.[cat];
  if (d && t) return t[d - 1] || 0;
  return num(c.criteres?.[k]);
}
export const CRITERES = [
  ["autonomie", "Autonomie responsabilisante", PTS_CRITERES], ["relationnel", "Relationnel professionnel", PTS_CRITERES],
  ["technicite", "Technicité et expertise", PTS_CRITERES], ["management", "Management de projets / équipe", PTS_CRITERES],
  ["pedagogie", "Pédagogie et didactique", PTS_CRITERES], ["formation", "Formation / Diplôme", PTS_DIPLOME],
];
export const ANALYTIQUES = { "ECOLE DES ETABLIERES": ["11FISDI - Formations initiales sous contrat", "11LABDI - Labo", "11CDIDI - CDI", "11EPSDI - EPS", "11ARCDI - Article 44C", "11ARTDI - Article 44S", "11AVSDI - Auxiliaire vie scolaire", "11SCODI - Vie scolaire", "11ADMDI - Admin site Sous contrat", "13CCLDI - Compténces clés (AIPS)", "13ADMDI - Admin site Dapa", "18CEQDI - Centre équestre ", "18ADMDI - Admin Centre Equestre", "22MOADI - Licence pro Moa", "22MSADI - Module court  SA", "22MSHDI - Module court SH", "22SAQDI - Soigneur animalier qualité", "22CAPDI - CAP sellier harnacheur", "22RSEDI - RSEEE", "22ACSDI - BTS ACSE", "22ACDDI - BTS ACD", "22GEMDI - BTS GEMEAU", "22CSTDI - Tourisme Vert", "22BMEDI - Métier de l'élevage", "22BPRDI - BP REA", "22LCEDI - Licence pro Conseil en élévage", "22CGEDI - Bac Pro CGEA", "22MSADI - Module court soigneur animalier", "22MSHDI - Module court sellier", "22EXTDI - Modules courts", "22ADMDI - Admin site Sup Agri", "22APRAR - Apprentissage à répartir", "27ASSDI - Ass social", "27EDSDI - Educateur specialisé", "27MOEDI - Moniteur Educateur", "27EJEDI - Educateur jeunes enfants", "27PREDI - Prépa", "27ASFDI - Assistants Familiaux", "27EXT DI - Modules courts", "27ADMDI - Admin site Sup Social", "23RGRDI - RGHR option paie", "23RDCDI - Responsable developpement commercial", "23GADDI - GADV", "23APEDI - Assistant chef de projet (1 et 2)", "23MRHDI - ANNEE 1 ET 2", "23MCDDI - ANNEE 1 ET 3", "23EXT DI - Modules courts", "23ADMDI - Admin site Challans", "24AVMDI - ACV/MAC", "24BPEDI - BP", "24TLTDI - Toiletteur", "24BMEDI - BM Éducateur comportementaliste canin, félin et NAC", "24PEDDI - Frais Pédagogiques Commun", "24EXTDI - Modules courts", "24ADMDI - Admin site Montaigu", "25BIJDI - CAP Bijouterie", "25SERDI - Sertissage", "25HJODI - Mention haute joallerie", "25SAMDI - Secrétaire médicale", "25FPADI - Formation de formateurs", "25EXTDI - Modules courts", "25ADMDI - Admin site Les Herbiers", "26SIGDI - Technicien en géomatique", "26PSRDI - CAP Production et service en restaurations", "26EXTDI - Modules courts", "26ADMDI - Admin site Fontenay", "91ADGDI - GROUPE - charges", "92ADGDI - ECOLE - charges (salaires directs pour cette activité, hono EC/CAC..)", "93FACDI - A refacturer"], AGROPOLIS: ["1PREDI - PRELES", "1YOLDI - YOLE", "1CECDI - CECILE SAUVAGE", "1PELDI - PELLINIERE", "1MAIDI - MAIL", "1PORDI - 3PORTES", "1AGRDI - AGRO", "1BOIDI - BOIS BLANC", "1CAPDI - CAP", "1ESCDI - ESCALE", "1RELDI - RELAIS", "1ADHAR - ADMIN RS (SANS RHVS)", "2DOUDI - DOUANIER ROUSSEAU", "2VINDI - ST VINCENT DE PAUL", "2MO1DI - LA MOUTONNERIE", "2MO2DI - STUDIO", "2FERDI - LA FERME", "2AGADI - AGA", "2AGRDI - AGA SA dans RS Agro", "2FAMDI - FAMILLES SOLIDAIRES", "2CHRDI - ST CHRISTOPHE DU LIGNERON", "2GILDI - ST GILLES CROIX DE VIE", "2JEADI - ST JEAN DE MONTS", "2COEDI - COEX", "2CHADI - CHALLANS", "2YOLDI - LA YOLE", "2PREDI - LES PRELES", "2AD1AR - ADMIN LOT1", "2AD3AR - ADMIN LOT3", "2APRAR - APPRENTISSAGE A RÉPARTIR", "2ADMAR - ADMIN MNA", "3VALDI - ACCUEIL GROUPE VALORIA", "3CAMDI - ACCUEIL GROUPE CAMPUS", "3PORDI - ACCUEIL GROUPE 3 PORTES", "3ADGAR - ACCUEIL GROUPE ADMIN", "4VALDI - VALORIA", "9ADHAR - ADMIN HEBERGEMENT (RS +  RHVS)", "9ADGAR - ADMIN STRUCTURE GENERAL Y COMPRIS SECURITE", "9FACDI - A REFACTURER"] };
export const MANAGERS_RH = ["Alexandra HERMOUET", "Anne ROBIN", "Anne-Sophie POTTIER", "Aurélia TROUVÉ", "Benoit CHEVILLON", "Bruno REVERSÉ", "Carole BÉCOT", "Eric LABORDE", "Fabien VARY", "Fabrice NOIRAULT", "Flora DJENADI", "Frédéric CHANTREAU", "Frédéric LEGRAND", "Gwenaël ARNAUD", "Julie GUINÉ", "Julie MENGUAL", "Benoit GUITTON", "Mélanie DEBARRE", "Morgan KERMARREC", "Pascale RENOU", "Sandy GRÉGOIRE", "Céline PILLON", "Valentin BARRETEAU"];
export const SITES_RH = ["CHALLANS", "FONTENAY LE C.", "LA ROCHE S/ YON", "LES HERBIERS", "LYCEE", "SUP'AGRI", "MONTAIGU", "SUP'SOCIAL", "BLOIS", "NOIRMOUTIER"];
export const ASSOCIATIONS_RH = ["AGROPOLIS", "ECOLE DES ETABLIERES"];
export const DEMANDES = ["CONTRAT", "AV. AUG. TPS TRAVAIL", "AV REDUC. TPS TRAVAIL", "AV REVAL. SALARIALE"];
export const MOTIFS = ["Néant (si CDI)", "USAGE (si CDD uniquement)", "ACCROISSEMENT d'activité", "REMPLACEMENT salarié absent"];
export const REMPLACEMENTS = ["MALADIE", "MATERNITE", "PATERNITE", "ACCIDENT DE TRAVAIL", "CONGÉ PARENTAL", "AUTRE"];
export const AUTRES_EUROS = ["Astreinte", "Prime de dimanche", "Prime de poste", "Prime Excep.", "Prime Resp."];
export const JOURS = ["LUNDI", "MARDI", "MERCREDI", "JEUDI", "VENDREDI", "SAMEDI", "DIMANCHE"];

const norm = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
export function metier(fonction) { const n = norm(fonction); return METIERS.find(m => norm(m[0]) === n) || null; }
const jour = 864e5;
const isoPlus = (iso, n) => { if (!iso) return ""; const d = new Date(iso + "T12:00:00"); d.setTime(d.getTime() + n * jour); return d.toISOString().slice(0, 10); };
const num = (v) => { const x = parseFloat(String(v ?? "").replace(",", ".")); return isFinite(x) ? x : 0; };

// Heures (« 9:00 », « 9h », « 9.5 ») → heures décimales.
export function heureDec(v) { const s = String(v || "").trim(); if (!s) return null; const m = s.match(/^(\d{1,2})\s*[h:]\s*(\d{0,2})$/i); if (m) return +m[1] + (+m[2] || 0) / 60; const x = num(s); return x || null; }
export function totalJour(l) { const [a, b, c, d] = (l || []).map(heureDec); return Math.max(0, (a != null && b != null ? b - a : 0) + (c != null && d != null ? d - c : 0)); }
export const totalSemaine = (s) => JOURS.reduce((t, j) => t + totalJour(s?.[j]), 0);

// Tous les calculs automatiques du formulaire.
export function calculer(c, bareme = BAREME_DEFAUT) {
  const b = { ...BAREME_DEFAUT, ...(bareme || {}), indices: { ...BAREME_DEFAUT.indices, ...(bareme?.indices || {}) } };
  const m = metier(c.fonction);
  const cat = +(c.categorie || m?.[1] || 0) || 0;
  const statut = c.statut || m?.[2] || "";
  const indice = cat ? +b.indices[cat] || 0 : 0;
  const supra = num(b.supraCP);
  const ans = Math.max(0, Math.min(43, Math.floor(num(c.anciennete))));
  const taux = cat ? (TAUX_ANCIENNETE[cat] || [])[ans] || 0 : 0;
  const ptsAnc = Math.round((indice + supra) * taux * 100) / 100;
  const critPts = Object.fromEntries(CRITERES.map(([k]) => [k, ptsCritere(c, k, cat)]));
  const ptsCrit = Object.values(critPts).reduce((t, v) => t + v, 0);
  const base = indice + supra + ptsAnc + ptsCrit + num(c.ajustement) + num(c.bonification);
  const regul = Math.max(0, Math.floor(num(b.minimumPoints) - base + 1e-9));
  const autrePts = c.regulAuto === false ? num(c.autrePts) : regul;
  const total = Math.ceil(base + autrePts - 1e-9);
  const euros = (c.autresEuros || []).reduce((t, e) => t + num(e?.montant), 0);
  const annuel = total * num(b.valeurPoint);
  const mensuel = annuel / 12 + euros;
  // Temps de travail
  const H = num(b.heuresAnnuelles) || 1565, heures = num(c.heures);
  const cdd = String(c.typeContrat).toUpperCase() === "CDD", cdi = String(c.typeContrat).toUpperCase() === "CDI";
  const jours = c.dateDebut && c.dateFin ? Math.round((new Date(c.dateFin) - new Date(c.dateDebut)) / jour) + 1 : 0;
  const quotiteCDD = cdd && jours > 0 ? heures / (H / 365 * jours) : 0;
  const quotiteCDI = cdi ? heures / H : 0;
  const hebdo = 35 * (quotiteCDD > 0.01 ? quotiteCDD : quotiteCDI);
  const quotite = cdd ? quotiteCDD : quotiteCDI;
  // Période d'essai (CDI) : O/E 2 mois, T/AM 3, cadre 4 — fin = début + mois × 30 j.
  const moisEssai = cdi ? ({ "O/E": 2, "T/AM": 3, "CADRE": 4 })[String(statut).toUpperCase()] || "" : "";
  const finEssai = moisEssai && c.dateDebut ? isoPlus(c.dateDebut, moisEssai * 30) : "";
  const entretiens = moisEssai && c.dateDebut ? [isoPlus(c.dateDebut, 30), moisEssai >= 3 ? isoPlus(c.dateDebut, 60) : "", moisEssai >= 4 ? isoPlus(c.dateDebut, 80) : ""] : ["", "", ""];
  const tempsPartiel = quotite > 0 && quotite < 0.999;
  return { critPts, m, cat, statut, indice, supra, ans, taux, ptsAnc, ptsCrit, base, regul, autrePts, total, euros, annuel, mensuel, mensuelProrata: quotite > 0 ? (annuel / 12) * quotite + euros : mensuel,
    jours, quotiteCDD, quotiteCDI, quotite, hebdo, moisEssai, finEssai, entretiens, tempsPartiel, sousMinimum: base + autrePts < num(b.minimumPoints) - 1e-9, bareme: b };
}

export function contratVierge(user = "") {
  const auj = new Date().toISOString().slice(0, 10);
  return { demandeDe: "CONTRAT", valeursAvant: "", nom: "", nomNaissance: "", prenom: "", adresse: "", cp: "", ville: "", pays: "France", email: "", tel: "",
    dateNaissance: "", lieuNaissance: "", nir: "", nationalite: "", diplome: "", rqth: "NON", typeContrat: "CDI", parrain: "", association: "AGROPOLIS",
    repartition1: "100", site1: "", repartition2: "", site2: "", dateDebut: "", dateFin: "", motif: "Néant (si CDI)", commentaire: "", remplacement: "", precisez: "",
    fonction: "", categorie: "", statut: "", analytiques: [{ code: "", pct: "100" }, { code: "", pct: "" }, { code: "", pct: "" }, { code: "", pct: "" }], matieres: "",
    heures: "1565", convention: "OEFMT", forfaitJour: "NON", teletravail: "NON", teletravailPrecision: "", anciennete: "0",
    criteres: {}, degres: {}, qualification: "", ajustement: "", bonification: "", regulAuto: true, autrePts: "", autrePtsLibelle: "Régul minimum conventionnel",
    autresEuros: [{ type: "", montant: "" }, { type: "", montant: "" }], manager: user, direction: "", budgetPrevu: "", engagementFormateurs: "",
    precisionsDirection: "", dateManager: auj, dateDirection: "", planning: { A: {}, B: {}, rotation: false }, joindreFiche: true, joindrePlanning: true };
}

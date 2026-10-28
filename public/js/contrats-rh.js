// contrats-rh.js — « 📝 Demandes de contrat » (tuile RH) : formulaire RH01 du
// Groupe Établières (CCN OEFMT). Même principe que les fiches de poste : on
// choisit la personne (ou on reprend une demande / un Excel existant), on
// remplit, l'appli calcule tout (catégorie, statut, période d'essai, quotité,
// points, régul minimum, rémunération) et l'aperçu reproduit le formulaire.
// PDF (avec le planning temps partiel et la fiche de poste jointe) et copie
// sur SharePoint (ExportsDonnees › Demandes de contrat).
import { db } from "./firebase-init.js";
import { collection, doc, addDoc, setDoc, deleteDoc, onSnapshot, serverTimestamp } from "./firestore-compte.js";
import { esc } from "./astreinte-logic.js";
import { watchUsers } from "./users-data.js";
import { getGraphToken } from "./graph-auth.js";
import { uploadToDrive, EXPORTS_ROOT_FOLDER } from "./sharepoint-storage.js";
import { DEGRES, QUALIFS, BAREME_DEFAUT, METIERS, CRITERES, PTS_CRITERES, PTS_DIPLOME, ANALYTIQUES, MANAGERS_RH, SITES_RH, ASSOCIATIONS_RH, DEMANDES, MOTIFS, REMPLACEMENTS, AUTRES_EUROS, JOURS,
  calculer, contratVierge, metier, totalJour, totalSemaine } from "./contrats-rh-donnees.js";
import { lireContratExistant } from "./contrats-rh-import.js";

const COL = "contrats-rh";
let conteneur = null, user = null, unsubs = [], contrats = [], fiches = [], personnes = [], bareme = { ...BAREME_DEFAUT };
let ui = { id: null, c: null, modif: false, filtre: "" };
let ficheHTMLFn = null;

const fr = (iso) => iso ? new Date(iso + "T00:00:00").toLocaleDateString("fr-FR") : "";
const nb = (v, d = 2) => (isFinite(v) ? v : 0).toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });
const eur = (v) => nb(v, 2) + " €";
const pct = (v) => nb((v || 0) * 100, 2) + "%";
const sansAcc = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const nomComplet = (c) => `${c.prenom || ""} ${c.nom || ""}`.trim();
const cap = (w) => String(w || "").toLocaleLowerCase("fr").replace(/(^|[\s-])(\p{L})/gu, (m, a, b) => a + b.toLocaleUpperCase("fr"));
function nomFichier(c) {
  const d = (c.dateManager || new Date().toISOString().slice(0, 10)).replace(/-/g, ".");
  return `${d}_Dmd_${c.demandeDe && c.demandeDe !== "CONTRAT" ? "AVT_" : ""}${c.typeContrat || ""}_${String(c.nom || "NOM").toUpperCase()}_${cap(c.prenom) || "Prenom"}.pdf`.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "_");
}
const getP = (o, p) => p.split(".").reduce((x, k) => x?.[k], o);
function setP(o, p, v) { const k = p.split("."); let x = o; k.slice(0, -1).forEach((s, i) => { if (x[s] == null) x[s] = /^\d+$/.test(k[i + 1]) ? [] : {}; x = x[s]; }); x[k[k.length - 1]] = v; }

function cleanup() { unsubs.forEach(u => u()); unsubs = []; }

export function mountContratsRH(container, u) {
  cleanup(); conteneur = container; user = u;
  unsubs.push(onSnapshot(collection(db, COL), (s) => {
    const tous = s.docs.map(d => ({ id: d.id, ...d.data() }));
    const b = tous.find(x => x.id === "_bareme"); bareme = { ...BAREME_DEFAUT, ...(b || {}), indices: { ...BAREME_DEFAUT.indices, ...(b?.indices || {}) } };
    contrats = tous.filter(x => !x.id.startsWith("_"));
    if (!ui.c) render(); else { renderListe(); majApercu(); }
  }, (e) => { conteneur.innerHTML = `<div class="form-card"><p>⚠️ Accès refusé à la collection « contrats-rh ». Publie la règle Firestore indiquée par Claude.</p><p class="hint">${esc(e.message)}</p></div>`; }));
  unsubs.push(onSnapshot(collection(db, "fiches-poste"), (s) => { fiches = s.docs.map(d => ({ id: d.id, ...d.data() })).filter(x => !x.id.startsWith("_")); if (ui.c) majFicheJointe(); majPuces(); }, () => {}));
  unsubs.push(watchUsers((l) => {
    personnes = [...new Set((l || []).filter(p => !p.desactive && !p.disabled).map(p => String(p.nom || p.displayName || p.name || "").trim()).filter(n => n && !n.includes("@")))];
    majPuces();
  }));
  import("./fiches-poste.js").then(m => { ficheHTMLFn = m.ficheHTML; if (ui.c) majApercu(); }).catch(() => {});
  render();
}

// ---------- Fiche de poste liée ----------
function ficheDe(c) {
  const n = sansAcc(nomComplet(c)), inv = sansAcc(`${c.nom || ""} ${c.prenom || ""}`);
  if (!n) return null;
  return fiches.filter(f => { const x = sansAcc(f.collaborateur); return x === n || x === inv; }).sort((a, b) => String(b.etablieLe || "").localeCompare(String(a.etablieLe || "")))[0] || null;
}

// ---------- Le document RH01 (aperçu = PDF) ----------
const COLS = [136, 62, 82, 76, 182, 77, 57, 75];
const cg = `<colgroup>${COLS.map(w => `<col style="width:${w}px">`).join("")}</colgroup>`;
const L = (t, s = 1, cls = "") => `<td colspan="${s}" class="rl ${cls}">${t}</td>`;
const V = (t, s = 1, cls = "") => `<td colspan="${s}" class="rv ${cls}">${t ?? ""}</td>`;
const E = (s = 1, cls = "") => `<td colspan="${s}" class="${cls}"></td>`;
const T = (t, s = 1, cls = "") => `<td colspan="${s}" class="${cls}">${t}</td>`;

function pageRH01(c, r, nPages) {
  const b = r.bareme, h = (v) => esc(v ?? "");
  const cdd = String(c.typeContrat).toUpperCase() === "CDD";
  const an = c.analytiques || [];
  const gauches = [E(2) + L("Critères classants/degrés Fonctions", 2), E(4), E(4), T(h(b.smic), 4, "rh-smic"), T(`<u>${h(b.point)}</u>`, 4, "rh-point"), T(h(b.nao), 4, "rh-nao")];
  const crit = CRITERES.map(([k, l], i) => `<tr>${gauches[i]}${V(r.critPts[k] ? r.critPts[k] : "", 1, "c")}${T(`Pts ${l}`, 3, "rh-pts b")}</tr>`).join("");
  const opt = (lib, v) => +v ? `<tr>${E(2)}${L(lib, 2)}${V(nb(+v, 0), 1, "c")}${T("Pts", 3, "rh-pts")}</tr>` : "";
  const euros = (c.autresEuros || []).map(e => `<tr>${L("Autre élément de rémunération (€)", 3)}${T(e?.type ? h(e.type) : "<i>Sélectionnez</i>", 1, "rh-sel")}${V(+e?.montant ? eur(+String(e.montant).replace(",", ".")) : "", 1, "c")}${T("€uros", 1, "rh-pts")}${V("", 2)}</tr>`).join("");
  return `<section class="fp-page rh-page">
  <div class="rh-tete">
    <img src="img/logo-rh05.png" alt="Groupe Établières">
    <div class="rh-titre">${h(b.titre)}</div>
    <div class="rh-dem"><div class="rh-maj">Dernière MAJ : <span>${h(b.maj)}</span></div>
      <div class="rh-dem-l"><b>Demande de :</b><span>${h(c.demandeDe)}</span></div>
      <div class="rh-avant">${c.valeursAvant ? h(c.valeursAvant) : "Si avenant, indiquez ici les valeurs avant demande"}</div></div>
  </div>
  <p class="rh-consigne"><b>Demande à déposer dans votre espace manager SharePoint,<br>minimum <span class="r">8</span> jours avant le début du contrat pour contrôle et validation <span class="r">AVEC LA FICHE DE POSTE</span></b> (sauf pour les FO non concernés)</p>
  <p class="rh-pieces"><b>Pièces à joindre obligatoirement</b> (sauf si personnel déjà connu et sans changement – à vérifier) :<br><span class="r">Carte d'identité, Carte vitale, copie du diplôme, RIB à jour, extrait du casier judiciaire n°3 de moins de trois mois <b>+ attestation de permis de conduire VALIDE</b></span></p>
  <table class="rh-t rh-cadre">${cg}
    <tr>${L("NOM :", 1, "rh-nom")}${V(h(c.nom).toUpperCase(), 3, "c b")}${L("Nom de naissance :")}${V(h(c.nomNaissance), 3)}</tr>
    <tr>${L("Prénom :", 1, "b")}${V(h(c.prenom), 3)}${E(4)}</tr>
    <tr>${L("Adresse :")}${V(h(c.adresse), 7)}</tr>
    <tr>${L("Code Postal :")}${V(h(c.cp))}${L("Ville :")}${V(h(c.ville), 2)}${L("Pays :")}${V(h(c.pays), 2)}</tr>
    <tr>${L("E-Mail :")}${V(h(c.email), 3)}${L("N° de téléphone :")}${V(h(c.tel), 3)}</tr>
    <tr>${L("Date de naissance :")}${V(fr(c.dateNaissance))}${E(2)}${L("Lieu de naissance - Dept - Pays :")}${V(h(c.lieuNaissance), 3)}</tr>
    <tr>${L("N° Imm. social. :")}${V(h(c.nir), 2)}${E(1)}${L("Nationalité :")}${V(h(c.nationalite), 3)}</tr>
    <tr>${L("Diplôme le plus élevé :")}${V(h(c.diplome), 7)}</tr>
    <tr>${L("Reconnaissance Travailleur Handicapé (Joindre justificatif) :", 3)}${V(h(c.rqth), 1, "c")}${E(4)}</tr>
    <tr class="rh-sep">${T("1 - Type de Contrat :", 1, "rh-sec")}${V(h(c.typeContrat), 2, "c b gros")}${E(1)}${L("Parrain/Marraine (pour les CDI) :", 1, "b")}${V(h(c.parrain) || "-", 3, "c")}</tr>
    <tr>${L("Association :")}${V(h(c.association), 2, "c")}${L("Répartition :")}${V(c.repartition1 ? h(c.repartition1) + "%" : "", 1, "c")}${T(h(c.site1), 1, "rh-box rh-site")}${V(c.repartition2 ? h(c.repartition2) + "%" : "", 1, "c")}${T(h(c.site2), 1, "rh-box rh-site")}</tr>
    <tr>${L("Date de début :", 1, "b")}${V(fr(c.dateDebut), 1, "b")}${cdd ? L("Date de fin :") + V(fr(c.dateFin), 1, "b") : E(2)}${E(4)}</tr>
    <tr>${L("Motif du contrat :")}${V(h(c.motif), 2)}${L("Commentaire :")}${V(h(c.commentaire), 4, "b")}</tr>
    <tr>${L("<i>Si remplacement :</i>")}${V(h(c.remplacement), 2)}${L("Précisez :")}${V(h(c.precisez), 4)}</tr>
    <tr>${L("Fonction occupée :", 1, "b")}${V(h(c.fonction), 5, "b")}${T("Si métier non répertorié se rapprocher du Service RH pour ajout", 2, "rh-rouge-p")}</tr>
    <tr class="rh-essai"><td rowspan="2" class="rh-jaune c"><b class="r">NOUVEAU</b><br>Période d'essai uniquement <b>CDI</b> :<br><span class="r">(Calculs automatiques<br>ne rien modifier svp)</span></td>
      ${T("Durée de la période d'essai en mois", 2, "c petit rh-box")}${T("Date de fin de période d'essai à +/-<br>à revalider <span class='r'>IMPERATIVEMENT</span> avec service RH ==>>>", 2, "c petit")}
      <td rowspan="2" class="c b rh-box">${fr(r.finEssai)}</td><td rowspan="2" class="c petit rh-box">STATUT =></td><td rowspan="2" class="c b rh-box">${h(r.statut)}</td></tr>
    <tr class="rh-essai">${T(r.moisEssai ? String(r.moisEssai) : "", 2, "c b rh-box")}${T("sous réserve d'abs trav. effectif au cours de la période reportant d'autant", 2, "c petit")}</tr>
    <tr><td class="rh-orange c"><u>Délai de prévenance à respecter suivant contrat - cliquez ICI</u></td>${T("Calendrier prévisionnel des entretien.s suivi période d'essai à mener =====>>>", 4, "rh-jaune2 c")}${r.entretiens.map(d => T(fr(d), 1, "c rh-box")).join("")}</tr>
    <tr>${L("Codes analytiques", 1, "b")}${V(h(an[0]?.code), 2)}${V(h(an[1]?.code), 2)}${V(h(an[2]?.code), 2)}${V(h(an[3]?.code))}</tr>
    <tr>${L("Clé de répartition analytique en %")}${[0, 1, 2].map(i => V(an[i]?.code || i === 0 ? (an[i]?.pct || 0) + "%" : "0%", 2, "c")).join("")}${V(an[3]?.code ? (an[3]?.pct || 0) + "%" : "0%", 1, "c")}</tr>
    <tr>${L("Matière (s) enseignée(s) :", 1, "b")}${V(h(c.matieres), 7)}</tr>
    <tr class="rh-sep">${T("2 - Temps de travail :", 2, "rh-sec")}${E(2)}${T("CDD", 1, "c rh-vert b")}${T("CDI", 1, "c rh-vert b")}${T("Rythme hebdo moyen", 2, "c rh-vert b")}</tr>
    <tr>${L("Nombre d'heures contrat :", 1, "b")}${V(c.heures ? nb(+String(c.heures).replace(",", "."), 2) : "", 1, "c b")}${T("Annuelles", 1, "rh-bleu")}${L("Quotité (%) :")}${T(pct(r.quotiteCDD), 1, "c rh-bleu")}${T(pct(r.quotiteCDI), 1, "c rh-vertf")}${T(`${nb(r.hebdo, 2)} heures/sem`, 2, "c rh-bleu")}</tr>
    ${r.tempsPartiel ? `<tr>${E(1)}${T("Temps partiel hors formateur : planning hebdomadaire joint (obligatoire pour le contrat)", 7, "rh-rouge-p")}</tr>` : ""}
    <tr>${L("Convention Collective :")}${V(h(c.convention), 1, "c")}${E(6)}</tr>
    <tr>${L("Forfait jour :")}${V(h(c.forfaitJour), 1, "c")}${E(1)}${L("Télétravail")}${V(h(c.teletravail), 1, "c")}${V(h(c.teletravailPrecision), 3)}</tr>
    <tr>${T("3 - Rémunération :", 2, "rh-sec")}${E(6)}</tr>
    <tr>${L("Catégorie")}${T(r.cat || "", 1, "c rh-bleu")}${T("⟷", 1, "c rh-bleu")}${L("Indice de base", 1)}${T(r.indice || "", 1, "c rh-bleu b")}${T("Pts", 3, "rh-pts")}</tr>
    <tr>${E(2)}${L("Supra légal 6ème sem. CP", 2)}${T(r.supra, 1, "c rh-bleu b")}${T("Pts", 3, "rh-pts")}</tr>
    <tr>${L("Ancienneté/expérience reprise :<br><i>Cf. page 50 CCN</i>")}${V(h(c.anciennete), 1, "c b")}${T(nb(r.taux, 2), 1, "c")}${L("⟷ Ancienneté")}${T(nb(r.ptsAnc, 2), 1, "c rh-bleu")}${T("Pts", 3, "rh-pts")}</tr>
    ${crit}
    ${opt("Ajustement de reclassification", c.ajustement)}${opt("Bonification indiciaire", c.bonification)}
    <tr>${E(2)}${L("Autre élément de rémunération", 2)}${V(r.autrePts ? nb(r.autrePts, 0) : "", 1, "c")}${T("Pts", 1, "rh-pts")}${V(`<i>${h(c.autrePtsLibelle || "")}</i>`, 2, "rh-gris")}</tr>
    <tr>${E(1)}${T(`${Math.round(b.minimumPoints)} Points conventionnels MINIMUM`, 2, "rh-min c")}${T("TOTAL Points", 1, "c b rh-total")}${T(String(r.total), 1, "c b rh-total")}${T("Points", 1, "rh-pts b")}${E(2)}</tr>
    ${euros}
    <tr>${T(eur(r.annuel), 1, "r-al petit")}${T("Rémunération mensuelle indicative <b class='r'>TEMPS PLEIN</b>", 3, "c tpetit")}${T(eur(r.mensuel), 1, "c")}${T("à proratiser si temps partiel", 3, "tpetit")}</tr>
  </table>
  <table class="rh-t rh-sign">${cg}
    <tr><td colspan="4" class="rh-sg"><div class="rh-sg-l"><b class="rh-u">Le Manager :</b><span class="rv b">${h(c.manager)}</span></div>
      <div class="rh-sg-l"><span class="rl"><b><u>Pôle Formation uniquement :</u></b><br>Prévu au budget prévisionnel/marges brutes de début d'année :</span><span class="rv c">${h(c.budgetPrevu)}</span></div>
      <div class="rh-sg-l"><span class="rl">Le manager s'engage à respecter la répartition des heures des <b>formateurs</b>, conformément à l'article 16.2 de la CCN</span><span class="rv c">${h(c.engagementFormateurs)}</span></div></td>
      <td colspan="4" class="rh-sg rh-sg-d"><div class="rh-sg-l"><b class="rh-u">Direction Association</b><span class="b rh-bleu">${h(c.direction)}</span></div>
      <div class="rh-sg-l" style="margin-top:34px"><span class="rl">VALIDATION Direction</span><span class="rh-valid c b"></span></div></td></tr>
    <tr><td colspan="4" class="rh-prec"><b class="r">Précisions pour validation direction (OBLIGATOIRE):</b><div class="rv rh-prec-v">${h(c.precisionsDirection).replace(/\n/g, "<br>")}</div></td><td colspan="4" class="rh-sg-d rh-bleu-bg"></td></tr>
    <tr><td colspan="4" class="rh-sg"><div class="rh-sg-l"><span class="rl">Date :</span><span class="rv">${fr(c.dateManager)}</span></div><div class="rh-sg-l"><span class="rl">Signature :</span><span></span></div></td>
      <td colspan="4" class="rh-sg rh-sg-d"><div class="rh-sg-l"><span class="rl">Date :</span><span class="rh-valid">${fr(c.dateDirection)}</span></div></td></tr>
  </table>
  <div class="rh-pied">Page 1 de ${nPages}</div>
  </section>`;
}

function pagePlanning(c, n, nPages) {
  const sem = (lib, s) => `<p class="rh-pl-sem"><b>${lib}</b></p><table class="rh-pl"><thead><tr><th>JOUR(S) TRAVAILLE(S)</th><th>MATIN<br>ARRIVEE</th><th>MATIN<br>DEPART</th><th>APRES-MIDI<br>ARRIVEE</th><th>APRES-MIDI<br>DEPART</th><th>TOTAL</th></tr></thead>
    <tbody>${JOURS.map(j => { const l = s?.[j] || []; const t = totalJour(l); return `<tr><td>${j}</td>${[0, 1, 2, 3].map(i => `<td>${esc(l[i] || "")}</td>`).join("")}<td>${t ? hm(t) : ""}</td></tr>`; }).join("")}
    <tr class="tot"><td colspan="5">TOTAL HEBDOMADAIRE</td><td>${hm(totalSemaine(s))}</td></tr></tbody></table>`;
  const tA = totalSemaine(c.planning?.A);
  return `<section class="fp-page rh-page rh-planning">
    <div class="rh-pl-tete"><img src="img/logo-rh05.png" alt=""><div><h2>PLANNING HEBDOMADAIRE INDICATIF - TEMPS PARTIEL hors formateur</h2><p>Planning établi le : ${fr(c.dateManager)}</p></div></div>
    <p class="rh-pl-rouge">PLANNING A JOINDRE OBLIGATOIREMENT AVEC LA DEMANDE DE CONTRAT - RH01</p>
    <h3>COLLABORATEUR</h3><p>NOM : <b>${esc(String(c.nom || "").toUpperCase())}</b> &nbsp; Prénom : <b>${esc(c.prenom)}</b></p>
    <h3>PERIMETRE DU POSTE</h3><p>Association de rattachement : <b>${esc(c.association)}</b> &nbsp; Convention Collective Nationale : <b>${esc(c.convention)}</b></p>
    <p class="rh-pl-i">Ce planning sera indiqué tel que vous le renseignez dans le contrat de travail. Nous vous demandons la plus grande vigilance quant à la pertinence de ces indications.</p>
    ${sem("Semaine A", c.planning?.A)}${c.planning?.rotation ? sem("Semaine B (si rotation uniquement)", c.planning?.B) : ""}
    <h3>INFORMATION & RAPPEL du travail à temps partiel (limite & paiement)</h3>
    <p>Un temps partiel ne doit jamais atteindre un temps plein, sous peine d'être requalifié en temps plein et ce dès la première semaine.</p>
    <p>En cas de besoin, et uniquement à la demande de l'employeur, le salarié pourra être amené à effectuer des heures complémentaires dans la limite du 1/3 temps de la durée annuelle fixée au contrat. Le salarié devra être prévenu de toute modification dans un délai raisonnable, lui permettant de prendre les dispositions nécessaires.</p>
    <table class="rh-pl rh-pl-hc"><tr><td>Nbre d'heures complémentaires pouvant être effectuées au-delà des heures hebdomadaires et dans la limite de 10% (Majo TxHor 15%)</td><td>${hm(tA / 10)}</td></tr>
      <tr><td>Nbre d'heures complémentaires maximum pouvant être effectuées au-delà des heures hebdomadaires et dans la limite du 1/3 temps (Majo TxHor 25%)</td><td>${hm(tA / 3)}</td></tr>
      <tr><td><b>LIMITE HEBDOMADAIRE</b></td><td><b>${hm(tA + tA / 3)}</b></td></tr></table>
    <p class="rh-pl-i">En application des dispositions conventionnelles actuellement applicables, et de l'accord de branche sur le temps partiel du 16/12/2014, les heures complémentaires sont rémunérées avec une majoration de 15% pour les heures effectuées dans la limite de 10% et une majoration de 25% pour les heures effectuées au-delà de 10% et dans la limite du 1/3.</p>
    <div class="rh-pied">Page ${n} de ${nPages}</div></section>`;
}
const hm = (h) => { if (!h) return "0:00"; const m = Math.round(h * 60); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`; };

export function contratHTML(c, avecFiche = true) {
  const r = calculer(c, bareme);
  const planning = c.joindrePlanning !== false && r.tempsPartiel && totalSemaine(c.planning?.A) > 0;
  const n = 1 + (planning ? 1 : 0);
  const fiche = avecFiche && c.joindreFiche !== false && ficheHTMLFn ? ficheDe(c) : null;
  return `<div class="rh-doc">${pageRH01(c, r, n)}${planning ? pagePlanning(c, 2, n) : ""}</div>${fiche ? `<div class="rh-suite">${ficheHTMLFn(fiche)}</div>` : ""}`;
}

// ---------- Écran ----------
function render() {
  if (!conteneur || !document.contains(conteneur)) { cleanup(); return; }
  conteneur.innerHTML = `<div class="fp-app">
    <div id="rh-liste"></div>
    <div id="rh-edit">${ui.c ? "" : `<div class="form-card fp-accueil"><h2>📝 Demandes de contrat (RH01)</h2>
      <p class="hint">Choisis la personne : l'appli reprend ce qu'elle sait (dernière demande, fiche de poste) et calcule tout — catégorie, statut, période d'essai, quotité, points, régul au minimum conventionnel, salaire. L'aperçu reproduit le formulaire RH01, la fiche de poste est jointe au PDF.</p>
      <div class="fp-import"><div><b>📥 Demandes faites avant l'appli ?</b><span>Sélectionne les fichiers Excel RH01 (ou leurs PDF) : l'appli les lit et les range ici, modifiables.</span></div><label class="add-btn">📥 Reprendre des demandes<input type="file" accept=".xlsx,.xlsm,.pdf" multiple hidden data-rh-import></label></div>
      <p class="hint" style="margin:14px 0 6px"><b>Ou crée une nouvelle demande :</b></p>
      <div class="fp-modeles">
        <button type="button" data-rh-nouv="CONTRAT"><b>🆕 Nouveau contrat</b><small>CDI ou CDD</small></button>
        <button type="button" data-rh-nouv="AV. AUG. TPS TRAVAIL"><b>⬆️ Avenant augmentation temps</b><small>part d'une demande existante</small></button>
        <button type="button" data-rh-nouv="AV REDUC. TPS TRAVAIL"><b>⬇️ Avenant réduction temps</b><small>part d'une demande existante</small></button>
        <button type="button" data-rh-nouv="AV REVAL. SALARIALE"><b>💶 Avenant revalorisation</b><small>part d'une demande existante</small></button>
      </div>
      ${baremeHTML()}</div>`}</div>
  </div>`;
  renderListe();
  conteneur.querySelector("[data-rh-import]")?.addEventListener("change", (e) => importer([...e.target.files]));
  conteneur.querySelectorAll("[data-rh-nouv]").forEach(b => b.addEventListener("click", () => {
    const c = contratVierge(managerParDefaut()); c.demandeDe = b.dataset.rhNouv;
    ui = { ...ui, id: null, c, modif: true }; render();
    if (c.demandeDe !== "CONTRAT") window.toast?.("Choisis la personne : sa dernière demande est reprise et les valeurs « avant » sont notées automatiquement.");
  }));
  brancherBareme();
  if (ui.c) renderEditeur();
}
function managerParDefaut() { const n = sansAcc(user?.nom || ""); return MANAGERS_RH.find(m => n && sansAcc(m).split(" ")[0] === n.split(" ")[0]) || "Valentin BARRETEAU"; }

function baremeHTML() {
  const b = bareme;
  return `<details class="fp-det rh-bareme"><summary>⚙️ Barème CCN / NAO utilisé pour les calculs (${esc(b.maj)})</summary>
    <p class="hint">À mettre à jour à chaque NAO. Valeurs actuelles : accord NAO 2026 signé le 7 octobre 2026, effet au 1er septembre 2026 (bases 870 / 900 / 970, point 20,91 €, minimum 1 923,03 € brut/mois = 1104 points). Les points des critères classants par degré sont ceux de l'annexe 2 de l'accord.</p>
    <div class="fp-g2">
      <label>Indice catégorie 1<input type="number" data-rb="indices.1" value="${b.indices[1]}"></label>
      <label>Indice catégorie 2<input type="number" data-rb="indices.2" value="${b.indices[2]}"></label>
      <label>Indice catégorie 3<input type="number" data-rb="indices.3" value="${b.indices[3]}"></label>
      <label>Supra légal 6e sem. CP (pts)<input type="number" data-rb="supraCP" value="${b.supraCP}"></label>
      <label>Valeur du point (€/an)<input type="number" step="0.01" data-rb="valeurPoint" value="${b.valeurPoint}"></label>
      <label>Points conventionnels minimum<input type="number" data-rb="minimumPoints" value="${b.minimumPoints}"></label>
      <label>Heures annuelles temps plein<input type="number" data-rb="heuresAnnuelles" value="${b.heuresAnnuelles}"></label>
      <label>Dernière MAJ (en-tête)<input data-rb="maj" value="${esc(b.maj)}"></label>
    </div>
    <label class="fp-plein">Titre<input data-rb="titre" value="${esc(b.titre)}"></label>
    <label class="fp-plein">Ligne SMIC<input data-rb="smic" value="${esc(b.smic)}"></label>
    <label class="fp-plein">Ligne valeur du point<input data-rb="point" value="${esc(b.point)}"></label>
    <label class="fp-plein">Ligne NAO<input data-rb="nao" value="${esc(b.nao)}"></label>
    <button type="button" class="add-btn" data-rb-save style="margin-top:8px">💾 Enregistrer le barème</button> <small class="hint" data-rb-etat></small>
  </details>`;
}
function brancherBareme() {
  const z = conteneur.querySelector(".rh-bareme"); if (!z) return;
  z.querySelector("[data-rb-save]").addEventListener("click", async () => {
    const nv = { indices: {} };
    z.querySelectorAll("[data-rb]").forEach(i => { const v = i.type === "number" ? +i.value : i.value; setP(nv, i.dataset.rb, v); });
    try { await setDoc(doc(db, COL, "_bareme"), nv, { merge: true }); z.querySelector("[data-rb-etat]").textContent = "✓ Barème enregistré"; }
    catch (e) { z.querySelector("[data-rb-etat]").textContent = "❌ " + (e.message || e); }
  });
}

function renderListe() {
  const el = conteneur?.querySelector("#rh-liste"); if (!el) return;
  const q = sansAcc(ui.filtre);
  const l = contrats.filter(c => !q || sansAcc(`${nomComplet(c)} ${c.fonction} ${c.demandeDe}`).includes(q))
    .sort((a, b) => String(b.dateManager || "").localeCompare(String(a.dateManager || "")) || nomComplet(a).localeCompare(nomComplet(b), "fr"));
  el.innerHTML = `<div class="form-card fp-liste">
    <div class="fp-liste-tete"><b>${contrats.length} demande${contrats.length > 1 ? "s" : ""}</b><button type="button" class="nav-btn" data-rh-accueil>➕ Nouvelle</button></div>
    ${contrats.length > 4 ? `<input class="fp-cherche" placeholder="🔎 Chercher…" value="${esc(ui.filtre)}">` : ""}
    ${l.map(c => `<button type="button" class="fp-item ${ui.id === c.id ? "actif" : ""}" data-rh-ouvrir="${c.id}"><b>${esc(String(c.nom || "").toUpperCase())} ${esc(cap(c.prenom))}</b><span>${esc(c.demandeDe === "CONTRAT" ? c.typeContrat : c.demandeDe)} · ${esc(c.fonction || "")}</span><small>${c.dateDebut ? `début ${fr(c.dateDebut)}` : ""}${c.spLe ? " · ☁️" : ""}${c.importee ? " · 📥 reprise" : ""}</small></button>`).join("") || `<p class="hint">Aucune demande enregistrée pour l'instant.</p>`}
  </div>`;
  el.querySelector("[data-rh-accueil]")?.addEventListener("click", () => { if (ui.modif && !confirm("Abandonner les modifications en cours ?")) return; ui = { ...ui, id: null, c: null, modif: false }; render(); });
  el.querySelector(".fp-cherche")?.addEventListener("input", (e) => { ui.filtre = e.target.value; renderListe(); const i = conteneur.querySelector(".fp-cherche"); i?.focus(); i?.setSelectionRange(i.value.length, i.value.length); });
  el.querySelectorAll("[data-rh-ouvrir]").forEach(b => b.addEventListener("click", () => {
    if (ui.modif && !confirm("Abandonner les modifications en cours ?")) return;
    const c = contrats.find(x => x.id === b.dataset.rhOuvrir); if (!c) return;
    const { id, creeLe, majLe, ...data } = c; ui = { ...ui, id, c: { ...contratVierge(), ...JSON.parse(JSON.stringify(data)) }, modif: false }; render();
  }));
}

// Personnes proposées : comptes de l'appli, demandes et fiches de poste déjà faites.
function majPuces() {
  const z = conteneur?.querySelector("#rh-puces"); if (!z || !ui.c) return;
  const q = sansAcc(`${ui.c.prenom} ${ui.c.nom}`);
  const vus = new Map();
  const ajout = (n, src) => { const k = sansAcc(n); if (k && !vus.has(k)) vus.set(k, { n, src }); };
  contrats.forEach(c => ajout(`${cap(c.prenom)} ${String(c.nom || "").toUpperCase()}`, "📝"));
  fiches.forEach(f => ajout(f.collaborateur, "📄"));
  personnes.forEach(p => ajout(p, ""));
  const l = [...vus.values()].filter(x => !q || sansAcc(x.n).includes(q.split(" ").filter(Boolean).pop() || "")).filter(x => sansAcc(x.n) !== q).sort((a, b) => a.n.localeCompare(b.n, "fr"));
  z.innerHTML = l.length ? `<span class="hint">👥 Choisir :</span>${l.slice(0, 40).map(x => `<button type="button" data-rh-pers="${esc(x.n)}" title="${x.src === "📝" ? "a déjà une demande : elle sera reprise" : x.src === "📄" ? "a une fiche de poste" : ""}">${esc(x.n)}${x.src ? " " + x.src : ""}</button>`).join("")}` : "";
  z.querySelectorAll("[data-rh-pers]").forEach(b => b.addEventListener("click", () => choisirPersonne(b.dataset.rhPers)));
}

// Reprend la dernière demande de la personne (identité, poste, rémunération) ;
// pour un avenant, note les valeurs « avant ». Sinon, part de sa fiche de poste.
function choisirPersonne(nom) {
  const k = sansAcc(nom);
  const prec = contrats.filter(c => sansAcc(`${c.prenom} ${c.nom}`) === k || sansAcc(`${c.nom} ${c.prenom}`) === k).sort((a, b) => String(b.dateDebut || "").localeCompare(String(a.dateDebut || "")))[0];
  const c = ui.c;
  if (prec) {
    const { id, creeLe, majLe, spLe, spFichier, importee, ...data } = JSON.parse(JSON.stringify(prec));
    const r = calculer(prec, bareme);
    Object.assign(c, { ...data, demandeDe: c.demandeDe, dateManager: c.dateManager, dateDirection: "", commentaire: "", precisionsDirection: "", manager: data.manager || c.manager });
    if (c.demandeDe !== "CONTRAT") {
      c.valeursAvant = `Avant : ${data.typeContrat || ""} ${nb(+String(data.heures || 0).replace(",", "."), 2)} h/an (${pct(r.quotite)}, ${nb(r.hebdo, 2)} h/sem) · ${r.total} pts · ${eur(r.mensuel)} TP`;
      c.dateDebut = ""; c.motif = "Néant (si CDI)";
    }
  } else {
    const m = String(nom).trim().split(/\s+/);
    const majus = m.filter(w => w === w.toLocaleUpperCase("fr") && /\p{L}{2,}/u.test(w));
    c.nom = (majus.length ? majus.join(" ") : m.slice(1).join(" ")).toLocaleUpperCase("fr");
    c.prenom = cap((majus.length ? m.filter(w => !majus.includes(w)) : m.slice(0, 1)).join(" "));
    const f = ficheDe(c);
    if (f) {
      const p = sansAcc(f.poste);
      const met = METIERS.find(x => sansAcc(x[0]) === p) || (p.startsWith("technicien de maintenance") ? METIERS.find(x => x[0] === "TECHNICIEN DE MAINTENANCE") : p.startsWith("agent de service") ? METIERS.find(x => x[0] === "AGENT DE SERVICE") : null);
      if (met) c.fonction = met[0];
      if (/agropolis/i.test(f.association || "")) c.association = "AGROPOLIS"; else if (/ecole|école/i.test(f.association || "")) c.association = "ECOLE DES ETABLIERES";
      if (f.convention) c.convention = /oefmt/i.test(f.convention) ? "OEFMT" : f.convention;
    }
  }
  ui.modif = true; renderEditeur();
}

const sel = (path, liste, v, vide = "—") => `<select data-c="${path}"><option value="">${vide}</option>${liste.map(o => `<option ${String(o) === String(v ?? "") ? "selected" : ""}>${esc(o)}</option>`).join("")}${v && !liste.map(String).includes(String(v)) ? `<option selected>${esc(v)}</option>` : ""}</select>`;
const inp = (path, v, attrs = "") => `<input data-c="${path}" value="${esc(v ?? "")}" ${attrs}>`;
const oui = (path, v) => `<span class="fp-oui rh-oui"><button type="button" class="${v === "OUI" ? "on" : ""}" data-c-set="${path}" data-v="OUI">Oui</button><button type="button" class="${v === "NON" ? "on" : ""}" data-c-set="${path}" data-v="NON">Non</button></span>`;

function controles(c, r) {
  const l = [];
  if (!c.nom || !c.prenom) l.push("Nom et prénom à indiquer");
  if (!c.fonction) l.push("Fonction occupée à choisir");
  else if (!r.m && !c.categorie) l.push("Métier non répertorié : indique la catégorie (et vois avec le service RH)");
  if (!c.dateDebut) l.push("Date de début à indiquer");
  else { const j = Math.round((new Date(c.dateDebut) - new Date(new Date().toISOString().slice(0, 10))) / 864e5); if (j < 8) l.push(`Début dans ${j} jour(s) : la demande doit être déposée au moins 8 jours avant`); }
  if (String(c.typeContrat).toUpperCase() === "CDD") { if (!c.dateFin) l.push("CDD : date de fin à indiquer"); if (/néant/i.test(c.motif || "")) l.push("CDD : motif du contrat à choisir"); }
  if (String(c.typeContrat).toUpperCase() === "CDI" && c.motif && !/néant/i.test(c.motif)) l.push("CDI : le motif doit être « Néant (si CDI) »");
  if (/remplacement/i.test(c.motif || "") && !c.remplacement) l.push("Remplacement : préciser le motif d'absence et la personne remplacée");
  if (r.tempsPartiel && !totalSemaine(c.planning?.A)) l.push("Temps partiel : le planning hebdomadaire est obligatoire");
  if (r.tempsPartiel && totalSemaine(c.planning?.A) && Math.abs(totalSemaine(c.planning.A) - r.hebdo) > 0.3 && !c.planning?.rotation) l.push(`Planning : ${hm(totalSemaine(c.planning.A))}/sem alors que le contrat donne ${hm(r.hebdo)}/sem`);
  const pc = (c.analytiques || []).filter(a => a.code).reduce((t, a) => t + (+String(a.pct || 0).replace(",", ".")), 0);
  if (!(c.analytiques || []).some(a => a.code)) l.push("Code analytique à choisir");
  else if (Math.abs(pc - 100) > 0.01) l.push(`Clé de répartition analytique : ${pc} % au lieu de 100 %`);
  if (!c.precisionsDirection) l.push("Précisions pour validation direction : obligatoire");
  if (c.joindreFiche !== false && !ficheDe(c)) l.push("Aucune fiche de poste trouvée pour cette personne (onglet Fiches de poste)");
  return l;
}

function renderEditeur() {
  const c = ui.c, el = conteneur.querySelector("#rh-edit"), r = calculer(c, bareme);
  const cdd = String(c.typeContrat).toUpperCase() === "CDD";
  const codes = ANALYTIQUES[c.association] || [...ANALYTIQUES.AGROPOLIS, ...ANALYTIQUES["ECOLE DES ETABLIERES"]];
  el.innerHTML = `
  <div class="fp-barre">
    <button type="button" class="add-btn" data-rh-save>💾 Enregistrer${ui.modif ? " •" : ""}</button>
    <button type="button" class="add-btn" data-rh-pdf style="background:#2f6fd6">📄 Télécharger le PDF</button>
    <button type="button" class="nav-btn" data-rh-sp>☁️ Envoyer sur SharePoint</button>
    ${ui.id ? `<button type="button" class="nav-btn" data-rh-avenant>📑 Faire un avenant</button><button type="button" class="nav-btn" data-rh-dup>👥 Dupliquer pour une autre personne</button><button type="button" class="del-btn" data-rh-del>🗑️</button>` : ""}
    <small class="hint" id="rh-etat"></small>
  </div>
  <div class="fp-cols">
  <div class="fp-form">
    <div class="form-card"><h3>📋 Demande</h3>
      <div class="fp-puces">${DEMANDES.map(d => `<button type="button" class="${c.demandeDe === d ? "on" : ""}" data-c-set="demandeDe" data-v="${esc(d)}">${esc(d)}</button>`).join("")}</div>
      ${c.demandeDe !== "CONTRAT" ? `<label class="fp-plein">Valeurs avant la demande (avenant)<input data-c="valeursAvant" value="${esc(c.valeursAvant)}" placeholder="ex. Avant : 1565 h/an, 100 %, 1104 pts"></label>` : ""}
    </div>
    <div class="form-card"><h3>👤 Salarié</h3>
      <div class="fp-g2"><label>NOM${inp("nom", c.nom, 'autocomplete="off"')}</label><label>Prénom${inp("prenom", c.prenom, 'autocomplete="off"')}</label></div>
      <div class="fp-pers-puces" id="rh-puces"></div>
      <details class="fp-det" ${c.adresse || c.nir || !ui.id ? "open" : ""}><summary>Identité complète (adresse, naissance, n° sécu…)</summary>
      <div class="fp-g2">
        <label>Nom de naissance${inp("nomNaissance", c.nomNaissance)}</label><label>Adresse${inp("adresse", c.adresse)}</label>
        <label>Code postal${inp("cp", c.cp, 'inputmode="numeric"')}</label><label>Ville${inp("ville", c.ville)}</label>
        <label>Pays${inp("pays", c.pays)}</label><label>E-mail${inp("email", c.email, 'type="email"')}</label>
        <label>Téléphone${inp("tel", c.tel, 'type="tel"')}</label><label>Date de naissance${inp("dateNaissance", c.dateNaissance, 'type="date"')}</label>
        <label>Lieu de naissance - Dept - Pays${inp("lieuNaissance", c.lieuNaissance)}</label><label>N° de sécurité sociale${inp("nir", c.nir, 'inputmode="numeric"')}</label>
        <label>Nationalité${inp("nationalite", c.nationalite)}</label><label>Diplôme le plus élevé${inp("diplome", c.diplome)}</label>
      </div>
      <div class="rh-ligne"><span>Reconnaissance travailleur handicapé</span>${oui("rqth", c.rqth)}</div></details>
    </div>
    <div class="form-card"><h3>1 · Type de contrat</h3>
      <div class="fp-puces">${["CDI", "CDD"].map(t => `<button type="button" class="${c.typeContrat === t ? "on" : ""}" data-c-set="typeContrat" data-v="${t}">${t}</button>`).join("")}</div>
      <div class="fp-g2" style="margin-top:10px">
        <label>Association${sel("association", ASSOCIATIONS_RH, c.association)}</label>
        <label>Parrain / marraine (CDI)${inp("parrain", c.parrain)}</label>
        <label>Date de début${inp("dateDebut", c.dateDebut, 'type="date"')}</label>
        ${cdd ? `<label>Date de fin${inp("dateFin", c.dateFin, 'type="date"')}</label>` : ""}
        <label>Site 1 — %<span class="rh-2">${sel("site1", SITES_RH, c.site1)}${inp("repartition1", c.repartition1, 'inputmode="decimal" placeholder="100"')}</span></label>
        <label>Site 2 — % (si multisite)<span class="rh-2">${sel("site2", SITES_RH, c.site2)}${inp("repartition2", c.repartition2, 'inputmode="decimal"')}</span></label>
        <label>Motif du contrat${sel("motif", MOTIFS, c.motif)}</label>
        <label style="grid-column:1/-1">Commentaire${inp("commentaire", c.commentaire, 'placeholder="ex. Diminution temps de travail à 5h/semaine à la demande du salarié"')}</label>
        ${/remplacement/i.test(c.motif || "") ? `<label>Si remplacement${sel("remplacement", REMPLACEMENTS, c.remplacement)}</label><label>Précisez (personne remplacée…)${inp("precisez", c.precisez)}</label>` : ""}
      </div>
      <label class="fp-plein">Fonction occupée<select data-rh-fonction>
        <option value="">— Choisis la fonction —</option>
        ${[1, 2, 3].map(k => `<optgroup label="Catégorie ${k}${k === 1 ? " · ouvriers / employés" : k === 2 ? " · techniciens / agents de maîtrise" : " · cadres"}">${METIERS.filter(m => m[1] === k).map(m => `<option value="${esc(m[0])}" ${!c.fonctionAutre && c.fonction === m[0] ? "selected" : ""}>${esc(m[0])}</option>`).join("")}</optgroup>`).join("")}
        <option value="__autre" ${c.fonctionAutre || (c.fonction && !r.m) ? "selected" : ""}>Autre (métier non répertorié)…</option></select></label>
      ${c.fonctionAutre || (c.fonction && !r.m) ? `<label class="fp-plein">Intitulé de la fonction${inp("fonction", c.fonction)}</label>` : ""}
      <div class="rh-calc" data-rh-calc="essai"></div>
      ${(c.fonctionAutre || c.fonction) && !r.m ? `<div class="fp-g2"><label>Catégorie (métier non répertorié)${sel("categorie", ["1", "2", "3"], c.categorie)}</label><label>Statut${sel("statut", ["O/E", "T/AM", "CADRE"], c.statut)}</label></div>` : ""}
      <p class="hint" style="margin:10px 0 4px">Codes analytiques (${esc(c.association || "")}) et clé de répartition</p>
      ${[0, 1, 2, 3].map(i => `<div class="rh-2 rh-ana"><input data-c="analytiques.${i}.code" list="rh-codes" value="${esc(c.analytiques?.[i]?.code)}" placeholder="Code ${i + 1}"><input data-c="analytiques.${i}.pct" value="${esc(c.analytiques?.[i]?.pct)}" inputmode="decimal" placeholder="%"></div>`).join("")}
      <datalist id="rh-codes">${codes.map(x => `<option value="${esc(x)}">`).join("")}</datalist>
      <label class="fp-plein">Matière(s) enseignée(s)${inp("matieres", c.matieres)}</label>
    </div>
    <div class="form-card"><h3>2 · Temps de travail</h3>
      <div class="fp-g2">
        <label>Nombre d'heures annuelles${inp("heures", c.heures, 'inputmode="decimal"')}</label>
        <label>Convention collective${inp("convention", c.convention)}</label>
      </div>
      <div class="fp-puces" style="margin:6px 0">${[["1565", "Temps plein (1565 h)"], ["1252", "80 %"], ["782.5", "50 %"]].map(([v, l]) => `<button type="button" data-c-set="heures" data-v="${v}">${l}</button>`).join("")}<button type="button" data-rh-hebdo>⏱️ À partir d'heures / semaine…</button></div>
      <div class="rh-calc" data-rh-calc="temps"></div>
      <div class="rh-ligne"><span>Forfait jour</span>${oui("forfaitJour", c.forfaitJour)}</div>
      <div class="rh-ligne"><span>Télétravail</span>${oui("teletravail", c.teletravail)}${c.teletravail === "OUI" ? inp("teletravailPrecision", c.teletravailPrecision, 'placeholder="occasionnel, permanent…"') : ""}</div>
      ${r.tempsPartiel ? planningHTML(c) : ""}
    </div>
    <div class="form-card"><h3>3 · Rémunération</h3>
      <div class="fp-g2">
        <label>Ancienneté / expérience reprise (années)${inp("anciennete", c.anciennete, 'type="number" min="0" max="43"')}</label>
        <label>Ajustement de reclassification (pts)${inp("ajustement", c.ajustement, 'inputmode="decimal"')}</label>
        <label>Bonification indiciaire (pts)${inp("bonification", c.bonification, 'inputmode="decimal"')}</label>
      </div>
      <p class="hint" style="margin:10px 0 4px">Critères classants (accord NAO 2026, annexe 2) — choisis le degré, les points de la catégorie ${r.cat || "?"} s'affichent</p>
      ${r.cat ? "" : `<div class="fp-alerte">⚠️ Choisis d'abord la <b>fonction occupée</b> (section 1 · Type de contrat) : la catégorie en dépend, puis les degrés apparaissent ici.</div>`}
      <div class="rh-crit">${CRITERES.map(([k, l]) => {
        if (k === "formation") { const q = QUALIFS.filter(x => !r.cat || x[1] === r.cat); return `<label>${l}<select data-c="qualification"><option value="">— aucune / saisie libre</option>${q.map(x => `<option value="${esc(x[0])}" ${c.qualification === x[0] ? "selected" : ""}>${esc(x[0])} · ${x[2]} pts</option>`).join("")}</select>${c.qualification ? "" : `<input data-c="criteres.formation" value="${esc(c.criteres?.formation ?? "")}" inputmode="decimal" placeholder="points">`}</label>`; }
        const t = DEGRES[k]?.[r.cat];
        if (r.cat && t === null) return `<label>${l}<small class="hint">sans objet en catégorie 1</small></label>`;
        return `<label>${l}<select data-c="degres.${k}"><option value="">— ${t ? "aucun / saisie libre" : "choisis la fonction"}</option>${t ? t.map((p, i) => `<option value="${i + 1}" ${+c.degres?.[k] === i + 1 ? "selected" : ""}>Degré ${i + 1} · ${p} pts</option>`).join("") : ""}</select>${+c.degres?.[k] ? "" : `<input data-c="criteres.${k}" value="${esc(c.criteres?.[k] ?? "")}" inputmode="decimal" placeholder="points">`}</label>`;
      }).join("")}</div>
      <div class="rh-ligne"><label class="fp-c ${c.regulAuto !== false ? "on" : ""}"><input type="checkbox" data-rh-regul ${c.regulAuto !== false ? "checked" : ""}><span>Compléter automatiquement jusqu'au minimum conventionnel (${nb(bareme.minimumPoints, 0)} pts)</span></label></div>
      ${c.regulAuto === false ? `<div class="fp-g2"><label>Autre élément de rémunération (pts)${inp("autrePts", c.autrePts, 'inputmode="decimal"')}</label><label>Libellé${inp("autrePtsLibelle", c.autrePtsLibelle)}</label></div>` : ""}
      <p class="hint" style="margin:10px 0 4px">Autres éléments de rémunération (€ / mois)</p>
      ${[0, 1].map(i => `<div class="rh-2">${sel(`autresEuros.${i}.type`, AUTRES_EUROS, c.autresEuros?.[i]?.type, "Sélectionnez")}<input data-c="autresEuros.${i}.montant" value="${esc(c.autresEuros?.[i]?.montant)}" inputmode="decimal" placeholder="€"></div>`).join("")}
      <div class="rh-calc" data-rh-calc="remu"></div>
    </div>
    <div class="form-card"><h3>✍️ Validation</h3>
      <div class="fp-g2">
        <label>Le manager<input data-c="manager" list="rh-managers" value="${esc(c.manager)}"></label>
        <label>Direction association<input data-c="direction" list="rh-managers" value="${esc(c.direction)}" placeholder="ex. Pascale RENOU"></label>
        <label>Date (manager)${inp("dateManager", c.dateManager, 'type="date"')}</label>
        <label>Date (direction)${inp("dateDirection", c.dateDirection, 'type="date"')}</label>
      </div><datalist id="rh-managers">${MANAGERS_RH.map(m => `<option value="${esc(m)}">`).join("")}</datalist>
      <div class="rh-ligne"><span>Pôle Formation : prévu au budget</span>${oui("budgetPrevu", c.budgetPrevu)}</div>
      <div class="rh-ligne"><span>Engagement répartition heures formateurs (art. 16.2)</span>${oui("engagementFormateurs", c.engagementFormateurs)}</div>
      <label class="fp-plein">Précisions pour validation direction (obligatoire)<textarea data-c="precisionsDirection" rows="3" placeholder="Contexte, budget, remplacement de…, demande du salarié…">${esc(c.precisionsDirection)}</textarea></label>
      <div class="rh-ligne" data-rh-fiche></div>
      <div class="rh-ligne"><label class="fp-c ${c.joindrePlanning !== false ? "on" : ""}"><input type="checkbox" data-rh-jp ${c.joindrePlanning !== false ? "checked" : ""}><span>Joindre le planning hebdomadaire (temps partiel)</span></label></div>
    </div>
    <div class="form-card rh-controles" data-rh-controles></div>
  </div>
  <div class="fp-apercu-col"><div class="fp-apercu-titre">👁️ Aperçu du document <button type="button" class="nav-btn" data-rh-grand>🔍 Agrandir</button></div><div class="fp-apercu" id="rh-apercu"></div></div>
  </div>`;
  brancher();
  majApercu(); ajusterApercu(); majPuces(); majFicheJointe();
}

function planningHTML(c) {
  const sem = (k, lib) => `<p class="hint" style="margin:8px 0 4px"><b>${lib}</b> — total <b data-rh-tot="${k}">${hm(totalSemaine(c.planning?.[k]))}</b></p>
    <div class="rh-pl-saisie"><span></span><span>Matin arrivée</span><span>Matin départ</span><span>A-M arrivée</span><span>A-M départ</span>
    ${JOURS.map(j => `<b>${j.slice(0, 3)}</b>${[0, 1, 2, 3].map(i => `<input data-c="planning.${k}.${j}.${i}" value="${esc(c.planning?.[k]?.[j]?.[i] || "")}" placeholder="--:--" inputmode="numeric">`).join("")}`).join("")}</div>`;
  return `<div class="rh-planning-saisie"><h4>🗓️ Planning hebdomadaire indicatif (obligatoire en temps partiel)</h4>
    ${sem("A", "Semaine A")}
    <label class="fp-c ${c.planning?.rotation ? "on" : ""}"><input type="checkbox" data-rh-rot ${c.planning?.rotation ? "checked" : ""}><span>Rotation sur 2 semaines (semaine B)</span></label>
    ${c.planning?.rotation ? sem("B", "Semaine B") : ""}</div>`;
}

function majCalc() {
  const c = ui.c, r = calculer(c, bareme), z = (k) => conteneur.querySelector(`[data-rh-calc="${k}"]`);
  const e = z("essai"); if (e) e.innerHTML = c.fonction ? `${r.m ? `<b>${esc(r.m[0])}</b> · ` : ""}Catégorie <b>${r.cat || "?"}</b> · statut <b>${esc(r.statut || "?")}</b> · indice <b>${r.indice || "?"}</b>${r.moisEssai ? `<br>Période d'essai <b>${r.moisEssai} mois</b> → fin le <b>${fr(r.finEssai)}</b> · entretiens : ${r.entretiens.filter(Boolean).map(fr).join(", ")}` : ""}` : "";
  const t = z("temps"); if (t) t.innerHTML = `Quotité <b>${pct(r.quotite)}</b> · <b>${nb(r.hebdo, 2)} h/semaine</b>${r.tempsPartiel ? " · <b>temps partiel</b> (planning obligatoire)" : r.quotite ? " · temps plein" : ""}${String(c.typeContrat).toUpperCase() === "CDD" && r.jours ? ` · CDD de ${r.jours} jours` : ""}`;
  const m = z("remu"); if (m) m.innerHTML = `<div class="rh-remu">
    <span>Indice ${r.indice} + supra CP ${r.supra} + ancienneté ${nb(r.ptsAnc, 2)} (${nb(r.taux * 100, 0)} %) + critères ${nb(r.ptsCrit, 0)}${+c.ajustement ? ` + ajustement ${c.ajustement}` : ""}${+c.bonification ? ` + bonification ${c.bonification}` : ""}${r.autrePts ? ` + ${c.regulAuto === false ? "autre" : "régul minimum"} ${nb(r.autrePts, 0)}` : ""}</span>
    <b>${nb(r.total, 0)} points</b>${r.sousMinimum ? `<em class="r">⚠️ sous le minimum conventionnel (${bareme.minimumPoints})</em>` : ""}
    <span>Brut mensuel temps plein : <b>${eur(r.mensuel)}</b> (${eur(r.annuel)}/an)${r.tempsPartiel ? ` · au prorata ${pct(r.quotite)} : <b>${eur(r.mensuelProrata)}</b>` : ""}</span></div>`;
  conteneur.querySelectorAll("[data-rh-tot]").forEach(b => { b.textContent = hm(totalSemaine(c.planning?.[b.dataset.rhTot])); });
  const ctl = conteneur.querySelector("[data-rh-controles]"); if (ctl) { const l = controles(c, r); ctl.innerHTML = l.length ? `<h3>🔎 À vérifier avant envoi (${l.length})</h3><ul>${l.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : `<h3>✅ Demande complète</h3><p class="hint">Rien à signaler. Pense aux pièces à joindre : carte d'identité, carte vitale, diplôme, RIB, casier judiciaire n°3 (< 3 mois), permis de conduire.</p>`; }
}
function majFicheJointe() {
  const z = conteneur?.querySelector("[data-rh-fiche]"); if (!z || !ui.c) return;
  const f = ficheDe(ui.c);
  z.innerHTML = f ? `<label class="fp-c ${ui.c.joindreFiche !== false ? "on" : ""}"><input type="checkbox" data-rh-jf ${ui.c.joindreFiche !== false ? "checked" : ""}><span>📄 Joindre la fiche de poste « ${esc(f.poste || "")} »${f.etablieLe ? ` (établie le ${fr(f.etablieLe)})` : ""}</span></label>`
    : `<span class="hint">📄 Pas encore de fiche de poste pour ${esc(nomComplet(ui.c) || "cette personne")} — à créer dans l'onglet « Fiches de poste » (elle sera jointe automatiquement).</span>`;
  z.querySelector("[data-rh-jf]")?.addEventListener("change", (e) => { ui.c.joindreFiche = e.target.checked; ui.modif = true; majFicheJointe(); majApercu(); });
}

let obsApercu = null;
function ajusterApercu() {
  const a = conteneur?.querySelector("#rh-apercu"); if (!a) return;
  a.style.setProperty("--fpz", String(Math.min(1, Math.max(0.2, (a.clientWidth - 26) / 794))));
  if (!obsApercu) obsApercu = new ResizeObserver(() => ajusterApercu());
  obsApercu.disconnect(); obsApercu.observe(a);
}
function majApercu() {
  if (!ui.c || !conteneur) return;
  const a = conteneur.querySelector("#rh-apercu"); if (a) a.innerHTML = contratHTML(ui.c);
  const s = conteneur.querySelector("[data-rh-save]"); if (s) s.textContent = `💾 Enregistrer${ui.modif ? " •" : ""}`;
  majCalc();
}
function changer(fn, rerendre = true) { fn(ui.c); ui.modif = true; if (rerendre) { const y = window.scrollY; renderEditeur(); window.scrollTo(0, y); } else majApercu(); }

function brancher() {
  const el = conteneur.querySelector("#rh-edit");
  // Champs dont la valeur change la structure du formulaire → nouveau rendu.
  const structure = /^(association|motif|fonction|typeContrat|heures|dateFin|dateDebut|teletravail|qualification|degres\..*|categorie)$/;
  el.querySelectorAll("[data-c]").forEach(i => {
    const ev = i.tagName === "SELECT" ? "change" : "input";
    i.addEventListener(ev, () => changer(c => { setP(c, i.dataset.c, i.value); if (i.dataset.c === "motif" && !/remplacement/i.test(i.value)) { c.remplacement = ""; c.precisez = ""; } }, false));
    if (structure.test(i.dataset.c)) i.addEventListener("change", () => { const y = window.scrollY; renderEditeur(); window.scrollTo(0, y); });
  });
  ["nom", "prenom"].forEach(k => el.querySelector(`[data-c="${k}"]`)?.addEventListener("input", () => { majPuces(); majFicheJointe(); }));
  el.querySelector('[data-c="nom"]')?.addEventListener("blur", (e) => { const v = e.target.value.toLocaleUpperCase("fr"); if (v !== e.target.value) { e.target.value = v; changer(c => { c.nom = v; }, false); } });
  el.querySelector('[data-c="prenom"]')?.addEventListener("blur", (e) => { const v = cap(e.target.value); if (v !== e.target.value) { e.target.value = v; changer(c => { c.prenom = v; }, false); } });
  el.querySelectorAll("[data-c-set]").forEach(b => b.addEventListener("click", () => changer(c => {
    setP(c, b.dataset.cSet, b.dataset.v);
    if (b.dataset.cSet === "typeContrat") { if (b.dataset.v === "CDI") { c.motif = "Néant (si CDI)"; c.dateFin = ""; } else if (/néant/i.test(c.motif || "")) c.motif = ""; }
  })));
  el.querySelector("[data-rh-fonction]")?.addEventListener("change", (e) => changer(c => {
    if (e.target.value === "__autre") { c.fonctionAutre = true; if (metier(c.fonction)) c.fonction = ""; }
    else { c.fonctionAutre = false; c.fonction = e.target.value; c.categorie = ""; c.statut = ""; }
  }));
  el.querySelector("[data-rh-hebdo]")?.addEventListener("click", () => { const h = prompt("Heures par semaine (ex. 5 ou 17,5) :"); const v = parseFloat(String(h || "").replace(",", ".")); if (v > 0) changer(c => { c.heures = String(Math.round(v / 35 * (bareme.heuresAnnuelles || 1565) * 100) / 100); }); });
  el.querySelector("[data-rh-regul]")?.addEventListener("change", (e) => changer(c => { c.regulAuto = e.target.checked; if (!e.target.checked && !c.autrePtsLibelle) c.autrePtsLibelle = "Régul minimum conventionnel"; }));
  el.querySelector("[data-rh-rot]")?.addEventListener("change", (e) => changer(c => { c.planning = c.planning || {}; c.planning.rotation = e.target.checked; }));
  el.querySelector("[data-rh-jp]")?.addEventListener("change", (e) => changer(c => { c.joindrePlanning = e.target.checked; }, false));
  el.querySelector("[data-rh-save]")?.addEventListener("click", enregistrer);
  el.querySelector("[data-rh-grand]")?.addEventListener("click", () => {
    const v = document.createElement("div"); v.className = "fp-plein-ecran";
    v.innerHTML = `<button type="button" class="nav-btn">✕ Fermer</button><div class="fp-plein-pages">${contratHTML(ui.c)}</div>`;
    v.querySelector("button").onclick = () => v.remove(); v.addEventListener("click", (e) => { if (e.target === v) v.remove(); });
    document.body.appendChild(v);
  });
  el.querySelector("[data-rh-pdf]")?.addEventListener("click", async () => { etat("⏳ Création du PDF…"); try { const blob = await pdf(ui.c); await livrerPDF(blob, nomFichier(ui.c)); etat("✓ PDF prêt"); } catch (e) { etat("❌ " + (e.message || e)); } });
  el.querySelector("[data-rh-sp]")?.addEventListener("click", envoyerSP);
  el.querySelector("[data-rh-avenant]")?.addEventListener("click", () => {
    const prec = ui.c, r = calculer(prec, bareme);
    const c = { ...JSON.parse(JSON.stringify(prec)), demandeDe: "AV. AUG. TPS TRAVAIL", dateDebut: "", dateDirection: "", commentaire: "", precisionsDirection: "", motif: "Néant (si CDI)", spLe: null, spFichier: null, importee: false,
      dateManager: new Date().toISOString().slice(0, 10), valeursAvant: `Avant : ${prec.typeContrat || ""} ${nb(+String(prec.heures || 0).replace(",", "."), 2)} h/an (${pct(r.quotite)}, ${nb(r.hebdo, 2)} h/sem) · ${r.total} pts · ${eur(r.mensuel)} TP` };
    ui = { ...ui, id: null, c, modif: true }; render(); window.toast?.("Avenant prêt : choisis le type d'avenant, la date et modifie ce qui change.");
  });
  el.querySelector("[data-rh-dup]")?.addEventListener("click", () => {
    const c = { ...contratVierge(ui.c.manager), ...JSON.parse(JSON.stringify(ui.c)) };
    ["nom", "prenom", "nomNaissance", "adresse", "cp", "ville", "email", "tel", "dateNaissance", "lieuNaissance", "nir", "nationalite", "diplome", "valeursAvant", "anciennete", "spLe", "spFichier", "dateDirection"].forEach(k => { c[k] = k === "anciennete" ? "0" : ""; });
    c.importee = false; c.dateManager = new Date().toISOString().slice(0, 10);
    ui = { ...ui, id: null, c, modif: true }; render(); window.toast?.("Copie prête : indique la personne puis enregistre.");
  });
  el.querySelector("[data-rh-del]")?.addEventListener("click", async () => { if (!confirm(`Supprimer la demande de ${nomComplet(ui.c) || "cette personne"} ?`)) return; await deleteDoc(doc(db, COL, ui.id)); ui = { ...ui, id: null, c: null, modif: false }; render(); });
}

function etat(t) { const e = conteneur.querySelector("#rh-etat"); if (e) e.textContent = t; }

async function enregistrer() {
  const c = ui.c;
  if (!c.nom?.trim()) { window.toast?.("Indique au moins le nom du salarié.", "error"); conteneur.querySelector('[data-c="nom"]')?.focus(); return null; }
  etat("⏳ Enregistrement…");
  const data = { ...c, majLe: serverTimestamp(), majPar: user?.nom || user?.email || "" };
  try {
    if (ui.id) await setDoc(doc(db, COL, ui.id), data, { merge: true });
    else { const r = await addDoc(collection(db, COL), { ...data, creeLe: serverTimestamp() }); ui.id = r.id; }
    ui.modif = false; etat("✓ Enregistrée"); renderListe(); majApercu(); return ui.id;
  } catch (e) { etat("❌ " + (e.message || e)); return null; }
}

async function pdf(c) {
  const html2pdf = await window.chargerLib?.("html2pdf"); if (!html2pdf) throw new Error("Librairie PDF non chargée");
  const cache = document.createElement("div");
  cache.style.cssText = "position:fixed;top:0;left:0;width:794px;opacity:0.01;pointer-events:none;z-index:-1;background:#fff";
  cache.innerHTML = `<div class="fp-pdf rh-pdf">${contratHTML(c)}</div>`; document.body.append(cache);
  await Promise.all([...cache.querySelectorAll("img")].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; setTimeout(r, 3000); })));
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  try {
    return await html2pdf().set({ margin: 0, filename: nomFichier(c), image: { type: "jpeg", quality: 0.95 },
      html2canvas: { scale: 2, backgroundColor: "#ffffff", useCORS: true, logging: false }, jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
      pagebreak: { mode: ["css"], before: [".rh-page + .rh-page", ".rh-suite .fp-page"] } }).from(cache.firstElementChild).outputPdf("blob");
  } finally { cache.remove(); }
}

async function envoyerSP() {
  const id = ui.modif || !ui.id ? await enregistrer() : ui.id; if (!id) return;
  etat("⏳ Envoi sur SharePoint…");
  try {
    const token = await getGraphToken(); if (!token) throw new Error("Connexion Microsoft refusée");
    const blob = await pdf(ui.c), nom = nomFichier(ui.c);
    await uploadToDrive(new File([blob], nom, { type: "application/pdf" }), token, ["Demandes de contrat"], EXPORTS_ROOT_FOLDER, { conflictBehavior: "replace", fixedFilename: nom });
    await setDoc(doc(db, COL, id), { spLe: Date.now(), spFichier: nom }, { merge: true });
    etat(`☁️ Envoyée : ExportsDonnees › Demandes de contrat › ${nom}`);
  } catch (e) { etat("❌ SharePoint : " + (e.message || e)); }
}

async function importer(files) {
  if (!files.length) return;
  const zone = conteneur.querySelector(".fp-import span"), ok = [], ko = [];
  for (const [i, file] of files.entries()) {
    if (zone) zone.textContent = `⏳ Lecture ${i + 1}/${files.length} : ${file.name}…`;
    try {
      const c = { ...contratVierge(), ...(await lireContratExistant(file)), importee: true };
      if (!c.nom) throw new Error("nom du salarié introuvable (est-ce bien un formulaire RH01 ?)");
      const r = await addDoc(collection(db, COL), { ...c, creeLe: serverTimestamp(), majLe: serverTimestamp(), majPar: user?.nom || user?.email || "" });
      ok.push({ id: r.id, c });
    } catch (e) { console.error(e); ko.push(`${file.name} : ${e.message || e}`); }
  }
  if (ko.length) alert(`⚠️ ${ko.length} fichier(s) non repris :\n\n${ko.join("\n")}`);
  if (ok.length) { window.toast?.(`📥 ${ok.length} demande(s) reprise(s). Vérifie-les, tout est modifiable.`, "success"); ui = { ...ui, id: ok[0].id, c: JSON.parse(JSON.stringify(ok[0].c)), modif: false }; render(); }
  else render();
}

async function livrerPDF(blob, nom) {
  const mobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform));
  const file = new File([blob], nom, { type: "application/pdf" });
  if (mobile && navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title: nom }); return; } catch (e) { if (e?.name === "AbortError") return; } }
  const url = URL.createObjectURL(blob);
  if (mobile) { const w = window.open(url, "_blank"); if (!w) location.href = url; }
  else { const a = document.createElement("a"); a.href = url; a.download = nom; document.body.appendChild(a); a.click(); a.remove(); }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

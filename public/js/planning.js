import {
  addDays, dateKey, sameDay, fmtLong, fmtShort, HOLIDAYS,
  YEAR_START, YEAR_END, computeWeeklyTitulaires, resolveDayN1, resolveDayN2,
  isAbsentOnDate, esc, initials, colorForPerson, nextHandover, isPlausibleDate,
} from "./astreinte-logic.js";
import {
  watchPeople, savePeople, watchAbsences, addAbsence, updateAbsence, deleteAbsence,
  watchInterventions, addIntervention, updateIntervention, envoyerInterventionCorbeille,
  watchRecurrences, addRecurrence, updateRecurrence, deleteRecurrence,
} from "./firestore-data.js";
import { watchTransferts, annulerTransfert } from "./transfert-data.js";
import { watchCoordonnees, saveCoordonnee } from "./coordonnees-data.js";
import { watchUsers } from "./users-data.js";
import { watchAssociations } from "./associations-data.js";
import { watchReleves, createReleve, deleteReleve } from "./releves-data.js";
import { transfertBannerHTML, attachTransfertListeners } from "./transfert-ui.js";
import { getAccessToken, uploadToDrive, getImageDisplayUrl, deleteDriveItem, DOSSIERS_ROOT_FOLDER } from "./sharepoint-storage.js";
import { listerFeuillesCandidates, analyserPlanningPrtt } from "./prtt-import.js";
import { imprimerFicheIsolee } from "./print-fiche.js";

const TYPE_SUGGESTIONS = ["Plomberie", "Électricité", "Chauffage / CVC", "Serrurerie / Accès", "Sécurité incendie", "Ascenseur", "Espaces verts", "Informatique / Réseau", "Autre"];

// Seuil "heure de nuit" indicatif (21h-6h) — à valider avec la convention
// collective / le service RH, ce n'est pas un calcul juridiquement certifié.
const NUIT_DEBUT_MIN = 21 * 60, NUIT_FIN_MIN = 6 * 60;
const PRIME_DIMANCHE = 50;

function toMinutes(hhmm) {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
}

// Calcule le nombre d'heures d'une intervention tombant dans la plage de
// nuit (21h-6h), en gérant le passage à minuit.
function heuresDeNuit(heureDebut, heureFin) {
  const start = toMinutes(heureDebut);
  let end = toMinutes(heureFin);
  if (start === null || end === null) return 0;
  if (end <= start) end += 1440; // passe minuit
  const fenetres = [[0, NUIT_FIN_MIN], [NUIT_DEBUT_MIN, 1440 + NUIT_FIN_MIN], [1440 + NUIT_DEBUT_MIN, 2880]];
  let minutes = 0;
  for (const [ws, we] of fenetres) {
    minutes += Math.max(0, Math.min(end, we) - Math.max(start, ws));
  }
  return minutes / 60;
}

function estDimanche(dateStr) {
  return new Date(dateStr).getDay() === 0;
}

// Durée totale entre l'heure de départ et l'heure de retour, en gérant le
// passage à minuit (retour le lendemain).
function dureeHeures(depart, retour) {
  const start = toMinutes(depart);
  let end = toMinutes(retour);
  if (start === null || end === null) return null;
  if (end <= start) end += 1440;
  return Math.round(((end - start) / 60) * 100) / 100;
}
// Repos quotidien de 11h consécutives (art. L3121-10 du Code du travail) :
// sauf la durée de l'intervention elle-même, l'astreinte compte comme du
// repos ; mais dès qu'il y a intervention, les 11h de repos doivent être
// intégralement redonnées à partir de la FIN de l'intervention avant toute
// reprise de poste. Calculs indicatifs pour aider au suivi terrain — ne
// remplacent pas une analyse juridique/RH au cas par cas.
const REPOS_QUOTIDIEN_HEURES = 11;

// Date/heure de fin réelle d'une intervention, en gérant le passage à
// minuit (ex. départ 23h, retour 2h → la fin est le lendemain).
function finInterventionDateTime(i) {
  if (!i.date || !i.heureDebut || !i.heureFin) return null;
  const [hD, mD] = i.heureDebut.split(":").map(Number);
  const [hF, mF] = i.heureFin.split(":").map(Number);
  const debut = new Date(i.date + "T00:00:00"); debut.setHours(hD, mD, 0, 0);
  let fin = new Date(i.date + "T00:00:00"); fin.setHours(hF, mF, 0, 0);
  if (fin <= debut) fin = addDays(fin, 1);
  return fin;
}

// Heure à partir de laquelle la personne peut légalement reprendre le
// travail après cette intervention (fin + 11h consécutives).
function reposObligatoireJusqua(i) {
  const fin = finInterventionDateTime(i);
  if (!fin) return null;
  return new Date(fin.getTime() + REPOS_QUOTIDIEN_HEURES * 3600 * 1000);
}

function fmtHeureJour(d) {
  return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) + " le " + fmtShort(d);
}

// Prochaine prise de poste "normale" suivant la fin de l'intervention,
// selon l'heure de reprise habituelle configurée (par défaut 8h00).
function repriseNormaleApres(fin) {
  const [hR, mR] = (state.people.heureRepriseDefaut || "08:00").split(":").map(Number);
  let reprise = new Date(fin); reprise.setHours(hR, mR, 0, 0);
  if (fin >= reprise) reprise = addDays(reprise, 1);
  return reprise;
}

// Calcule, pour une intervention donnée, si le repos de 11h impose de
// décaler la reprise normale, et si une intervention ultérieure de la même
// personne a démarré avant la fin de ce repos obligatoire (violation).
function analyseReposIntervention(i, toutes) {
  const reposJusqua = reposObligatoireJusqua(i);
  if (!reposJusqua) return null;
  const repriseNormale = repriseNormaleApres(finInterventionDateTime(i));
  const decalageNecessaire = reposJusqua > repriseNormale;
  const violee = toutes.some(autre => {
    if (autre === i || autre.technicien !== i.technicien || !autre.date || !autre.heureDebut) return false;
    const [hD, mD] = autre.heureDebut.split(":").map(Number);
    const debutAutre = new Date(autre.date + "T00:00:00"); debutAutre.setHours(hD, mD, 0, 0);
    return debutAutre > finInterventionDateTime(i) && debutAutre < reposJusqua;
  });
  return { reposJusqua, decalageNecessaire, violee };
}

const PIE_COLORS = ["#D9B24C", "#3FB6AC", "#8B7CF0", "#E5533D", "#6FA8DC", "#B5C99A", "#D98BC9", "#C9A66B"];
let graphiquesSynthese = {}; // instances Chart.js actives — détruites avant chaque nouveau rendu

let state = { people: { n1: ["Valentin", "Lionel"], n2: ["Technicien 1", "Technicien 2", "Technicien 3"] }, absences: [], interventions: [], transferts: [], coordonnees: {}, associations: [], releves: [], recurrences: [] };
let ui = {
  subtab: "calendrier",
  calYear: new Date().getFullYear(), calMonth: new Date().getMonth(),
  selectedDate: null,
  filterTech: "Tous", filterSite: "Tous",
  form: { date: new Date().toISOString().slice(0, 10), technicien: "", association: "", groupe: "", site: "", type: "", heures: "", heureDebut: "", heureFin: "", description: "", photos: [], appelN1: false, n1Contacte: "", motifAppelN1: "", decisionN1: "" },
  editingId: null,
  ficheOuverte: null, // nom de la personne dont la fiche technicien est dépliée
  noteFraisMois: new Date().toISOString().slice(0, 7),
  noteFraisPreview: null,
  noteFraisTech: null,
  absForm: { person: "", start: new Date().toISOString().slice(0, 10), end: new Date().toISOString().slice(0, 10), type: "conge", note: "" },
  absEditingId: null,
  absFiltrePersonne: "Tous",
  absFiltreOrigine: "tous", // "tous" | "prtt" | "manuel"
  prttImportOuvert: false, prttWorkbook: null, prttFeuilles: [], prttFeuilleChoisie: "", prttPersonne: "", prttPreview: null, prttNomFichier: "",
  docForm: { person: "Tous", start: new Date().toISOString().slice(0, 10), end: new Date().toISOString().slice(0, 10), generated: false },
  planningIndivPerson: null, planningIndivYear: null, // année scolaire de départ ; résolue à anneeScolaireCourante() au premier rendu
  planningVueMulti: false, planningMultiPersonnes: null, planningMultiMoisIdx: null,
  recurForm: { association: "", groupe: "", site: "", type: "Espaces verts", heureDebut: "", heureFin: "", description: "", frequenceSemaines: 2, jourSemaine: 1, dateDebut: new Date().toISOString().slice(0, 10), dateFin: "" },
  recurEditingId: null,
  recurDetailsOpen: {}, // par personne : mémorise si le panneau "Planning récurrent" est déplié, pour ne pas le refermer à chaque saisie (voir renderRecurrencesPanel)
  planningQuickDate: null,
  planningQuickEditingId: null, // id de l'intervention en cours de modification depuis le planning individuel (null = ajout)
  planningQuickForm: { association: "", groupe: "", site: "", type: "Espaces verts", heureDebut: "", heureFin: "", description: "" },
};
let unsubs = [];
let clearCountdown = null;
let mountedContainer = null;
let mountedUser = null;

function cleanup() {
  unsubs.forEach(u => u());
  unsubs = [];
  if (clearCountdown) { clearCountdown(); clearCountdown = null; }
  if (renderAllTimer) { clearTimeout(renderAllTimer); renderAllTimer = null; }
}

export function permissions(user) {
  const isEditor = user.role === "super_admin" || user.role === "admin" || user.role === "n1";
  const isTech = user.role === "technicien";
  // Niveau "Lecture" réglé au cas par cas (Paramètres > Utilisateurs >
  // Gérer l'accès, sur la tuile Astreinte) pour technicien/menage/
  // mi_temps/direction : voit la tuile mais ne peut rien y modifier —
  // voir app.html (categorySubtabsFor) pour la pose de user.lectureSeule.
  const lectureSeule = !!user.lectureSeule;
  return {
    isEditor,
    isTech,
    lectureSeule,
    canEditNames: isEditor,
    canManageAbsences: isEditor,
    canLogIntervention: (isEditor || isTech) && !lectureSeule,
    canSeeSynthese: isEditor || user.role === "direction",
    canSeeAbsencesTab: isEditor,
    canSeeInterventionsTab: isEditor || isTech,
    canSeeTransfertsTab: isEditor || user.role === "direction",
    canSeeCoordonnees: true,
    canSeeArchiveReleves: isEditor || user.role === "direction",
  };
}

function startListeners(container, user, tab) {
  cleanup();
  mountedContainer = container;
  mountedUser = user;
  ui.subtab = tab;
  if (user.role === "technicien") ui.form.technicien = user.nom || user.email;

  container.innerHTML = `<div class="hint">Chargement…</div>`;

  unsubs.push(watchPeople((p) => {
    state.people = p;
    if (!ui.form.technicien && user.role !== "technicien") ui.form.technicien = p.n2[0] || "";
    if (!ui.absForm.person) ui.absForm.person = p.n1[0] || "";
    scheduleRenderAll();
  }));
  unsubs.push(watchAbsences((a) => { state.absences = a; scheduleRenderAll(); }));
  unsubs.push(watchInterventions((i) => { state.interventions = i; scheduleRenderAll(); }));
  unsubs.push(watchTransferts((t) => { state.transferts = t; scheduleRenderAll(); }));
  unsubs.push(watchCoordonnees((c) => { state.coordonnees = c; scheduleRenderAll(); }));
  if (tab === "coordonnees") unsubs.push(watchUsers((u) => { state.utilisateurs = u; scheduleRenderAll(); }));
  unsubs.push(watchAssociations((a) => { state.associations = a; scheduleRenderAll(); }));
  unsubs.push(watchReleves((r) => { state.releves = r; scheduleRenderAll(); }));
  unsubs.push(watchRecurrences((r) => { state.recurrences = r; scheduleRenderAll(); }));
}

// Cet onglet écoute 8 flux Firestore indépendants (people, absences,
// interventions, transferts, coordonnées, associations, relevés,
// récurrences) — à l'ouverture, chacun arrive à un instant légèrement
// différent et redessinait l'écran à chaque fois, ce qui donnait
// l'impression que l'écran "sautait" plusieurs fois de suite avant de se
// stabiliser. On regroupe les mises à jour rapprochées (arrivées à moins
// de 60ms d'écart) en un seul rendu final, sans retarder les rendus
// déclenchés par une action de l'utilisateur (ceux-là restent immédiats,
// via renderAll() directement).
let renderAllTimer = null;
function scheduleRenderAll() {
  if (renderAllTimer) clearTimeout(renderAllTimer);
  renderAllTimer = setTimeout(() => { renderAllTimer = null; renderAll(); }, 60);
}

export function mountCalendrier(container, user) { startListeners(container, user, "calendrier"); }
export function mountAbsencesTab(container, user) { startListeners(container, user, "absences"); }
export function mountInterventionsTab(container, user) { startListeners(container, user, "interventions"); }
export function mountSyntheseTab(container, user) { startListeners(container, user, "synthese"); }
export function mountTransfertsTab(container, user) { startListeners(container, user, "transferts"); }
export function mountCoordonneesTab(container, user) { startListeners(container, user, "coordonnees"); }
export function mountArchiveRelevesTab(container, user) { startListeners(container, user, "archive-releves"); }
// "Mon planning" : le planning individuel de la personne connectée
// uniquement (lecture seule), pour les agents hors gestion — ex. le
// technicien espaces verts qui n'est pas dans le roulement d'astreinte.
export function mountMonPlanningTab(container, user) { startListeners(container, user, "mon-planning"); }

const normNomPlanning = s => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
// Personne du planning reliée au compte : lien explicite (Coordonnées /
// Utilisateurs), sinon rapprochement par le nom.
function personneDuCompte(user) {
  const toutes = [...new Set([...state.people.n1, ...state.people.n2])];
  const lie = Object.entries(state.coordonnees || {}).find(([, c]) => c && c.uid && c.uid === user.uid);
  if (lie) return lie[0];
  const cibles = [user.nom, (user.email || "").split("@")[0]].filter(Boolean).map(normNomPlanning);
  const prenom = normNomPlanning(user.nom).split(/\s+/)[0];
  return toutes.find(p => cibles.includes(normNomPlanning(p)))
    || toutes.find(p => prenom && normNomPlanning(p).split(/\s+/)[0] === prenom) || null;
}

function prochainesInterventionsHTML(person) {
  const auj = dateKey(new Date());
  const fin = dateKey(addDays(new Date(), 30));
  const estMoi = n => normNomPlanning(n) === normNomPlanning(person);
  const reelles = state.interventions.filter(i => estMoi(i.technicien) && i.date >= auj && i.date <= fin);
  const dejaLa = new Set(reelles.filter(i => i.recurrenceId).map(i => i.recurrenceId + "|" + i.date));
  const prevues = (state.recurrences || []).filter(r => estMoi(r.person)).flatMap(r =>
    genererOccurrencesRecurrence(r, addDays(new Date(), 30)).filter(d => d >= auj && d <= fin && !dejaLa.has(r.id + "|" + d))
      .map(d => ({ date: d, heureDebut: r.heureDebut, heureFin: r.heureFin, site: r.site, type: r.type, recurrenceId: r.id })));
  const liste = [...reelles, ...prevues].sort((a, b) => (a.date + (a.heureDebut || "")).localeCompare(b.date + (b.heureDebut || "")));
  return `
    <div class="form-card">
      <p style="margin:0 0 8px;font-weight:700;font-size:13px">Mes interventions — 30 prochains jours</p>
      ${liste.length === 0 ? `<p class="hint" style="margin:0">Aucune intervention prévue sur les 30 prochains jours.</p>` : liste.map(i => `
        <div style="display:flex;gap:10px;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px">
          <b style="min-width:120px">${new Date(i.date + "T12:00:00").toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })}${i.heureDebut ? ` · ${esc(i.heureDebut)}${i.heureFin ? "–" + esc(i.heureFin) : ""}` : ""}</b>
          <span>${esc(i.site || "—")}${i.type ? ` · ${esc(i.type)}` : ""}${i.recurrenceId ? " 🔁" : ""}</span>
        </div>`).join("")}
    </div>`;
}

function renderMonPlanning(container) {
  const personne = personneDuCompte(mountedUser);
  if (!personne) {
    container.innerHTML = `<div class="placeholder-card"><b>Ton compte n'est relié à aucune personne du planning.</b><br><br>Demande à ton responsable de faire le lien (Administration → Utilisateurs → colonne « Dans le planning »).</div>`;
    return;
  }
  ui.planningIndivPerson = personne;
  ui.planningVueMulti = false;
  // Le technicien consulte seulement ; un responsable qui regarde sa vue
  // (« Aperçu en tant que… ») peut modifier son planning en cliquant sur un jour.
  return renderPlanningIndividuel(container, { canManageAbsences: !!mountedUser.apercu });
}
export function mountPlanningIndividuelTab(container, user) { startListeners(container, user, "planning-individuel"); }

function renderAll() {
  if (!mountedContainer || !mountedUser) return;
  if (!document.contains(mountedContainer)) { cleanup(); return; } // l'utilisateur a changé d'écran, on arrête d'écouter
  const perms = permissions(mountedUser);
  if (ui.subtab === "absences" && !perms.canSeeAbsencesTab) { mountedContainer.innerHTML = `<div class="placeholder-card">Accès non autorisé.</div>`; return; }
  if (ui.subtab === "interventions" && !perms.canSeeInterventionsTab) { mountedContainer.innerHTML = `<div class="placeholder-card">Accès non autorisé.</div>`; return; }
  if (ui.subtab === "synthese" && !perms.canSeeSynthese) { mountedContainer.innerHTML = `<div class="placeholder-card">Accès non autorisé.</div>`; return; }
  if (ui.subtab === "transferts" && !perms.canSeeTransfertsTab) { mountedContainer.innerHTML = `<div class="placeholder-card">Accès non autorisé.</div>`; return; }
  if (ui.subtab === "archive-releves" && !perms.canSeeArchiveReleves) { mountedContainer.innerHTML = `<div class="placeholder-card">Accès non autorisé.</div>`; return; }

  if (ui.subtab === "calendrier") return renderCalendar(mountedContainer, perms);
  if (ui.subtab === "absences") return renderAbsences(mountedContainer, perms);
  if (ui.subtab === "interventions") return renderInterventions(mountedContainer, perms);
  if (ui.subtab === "synthese") return renderSynthese(mountedContainer, perms);
  if (ui.subtab === "transferts") return renderTransferts(mountedContainer, mountedUser);
  if (ui.subtab === "coordonnees") return renderCoordonnees(mountedContainer, perms);
  if (ui.subtab === "archive-releves") return renderArchiveReleves(mountedContainer, mountedUser);
  if (ui.subtab === "planning-individuel") return renderPlanningIndividuel(mountedContainer, perms);
  if (ui.subtab === "mon-planning") return renderMonPlanning(mountedContainer);
}

// =================================================================
// Calendrier
// =================================================================
function monthGrid(year, month) {
  const first = new Date(year, month, 1);
  const startOffset = (first.getDay() + 6) % 7;
  const gridStart = addDays(first, -startOffset);
  const days = [];
  for (let i = 0; i < 42; i++) days.push(addDays(gridStart, i));
  return days;
}

// =================================================================
// Archive des relevés d'heures validés
// =================================================================
function renderArchiveReleves(container, user) {
  const sorted = [...state.releves].sort((a, b) => (a.validatedAt < b.validatedAt ? 1 : -1));
  const isSuperAdmin = user?.role === "super_admin";

  container.innerHTML = `
    <div class="stack">
      <p class="hint">Historique des relevés d'heures générés puis validés (transmis au manager pour paiement).${isSuperAdmin ? " En tant que Super Admin, tu peux supprimer un relevé en cas d'erreur — les interventions concernées repassent alors \"En attente\"." : ""}</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Intervenant</th><th>Période</th><th>Interventions</th><th>Total</th><th>Dont nuit</th><th>Primes dim.</th><th>Validé par</th><th>Le</th>${isSuperAdmin ? "<th></th>" : ""}</tr></thead>
          <tbody>
            ${sorted.length === 0 ? `<tr><td colspan="${isSuperAdmin ? 9 : 8}" class="empty-row">Aucun relevé validé pour l'instant.</td></tr>` :
              sorted.map(r => `
                <tr>
                  <td>${esc(r.person)}</td>
                  <td>${fmtShort(new Date(r.start))} → ${fmtShort(new Date(r.end))}</td>
                  <td>${r.nbInterventions}</td>
                  <td>${(r.total || 0).toFixed(2)} h</td>
                  <td>${(r.totalNuit || 0).toFixed(2)} h</td>
                  <td>${r.totalPrimes > 0 ? r.totalPrimes + "€" : "—"}</td>
                  <td>${esc(r.validatedByNom)}</td>
                  <td>${r.validatedAt ? new Date(r.validatedAt).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                  ${isSuperAdmin ? `<td><button class="del-btn" data-del-releve="${r.id}" style="padding:4px 10px;font-size:11px">🗑️ Supprimer</button></td>` : ""}
                </tr>
              `).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;

  container.querySelectorAll("[data-del-releve]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const r = state.releves.find(x => x.id === btn.dataset.delReleve);
      if (!confirm(`Supprimer ce relevé (${r.person}, ${r.nbInterventions} intervention(s)) ? Les interventions concernées repasseront "En attente".`)) return;
      btn.disabled = true;
      try {
        await deleteReleve(r.id, r.interventionIds);
      } catch (e) {
        window.toast("Échec : " + (e.message || e));
        btn.disabled = false;
      }
    });
  });
}

// =================================================================
// Coordonnées (téléphone / email) des cadres et techniciens, fiche
// technicien détaillée (adresse, kilomètres par site) et génération de
// la note de frais de déplacements officielle (reproduit le formulaire
// papier CG01 du groupe Établières).
// =================================================================
const STATUTS_NOTE_FRAIS = {
  salarie_prive: "Salarié droit privé", salarie_public: "Salarié droit public",
  etudiant: "Étudiants", intervenant: "Intervenant facturation",
  intervenant_benevole: "Intervenant bénévole",
};
const TARIF_KM = 0.447; // taux officiel CG01 (0,447 €/km)
// Le technicien est remboursé pour le trajet domicile ↔ service
// technique (puis prend un véhicule de service pour se rendre sur le
// site d'intervention lui-même — ce dernier trajet n'est pas à ses
// frais). Une seule adresse de destination, fixe, pour tout le monde.
const SERVICE_TECHNIQUE_NOM = "Service technique";
const SERVICE_TECHNIQUE_ADRESSE = "Route de Nantes, 85000 La Roche-sur-Yon";

// Couleur de badge par rôle — Cadre astreinte (doré) et Technicien
// (turquoise) se distinguent d'un coup d'œil ; une personne qui cumule
// les deux (ex. Lionel, cadre ET technicien) affiche les deux badges sur
// une seule carte plutôt que deux cartes en double pour le même nom.
const ROLE_COULEUR = { "Cadre astreinte": "var(--gold)", "Technicien": "var(--teal)" };

function renderCoordonnees(container, perms) {
  const rolesParNom = new Map();
  state.people.n1.forEach(nom => { if (!rolesParNom.has(nom)) rolesParNom.set(nom, []); rolesParNom.get(nom).push("Cadre astreinte"); });
  state.people.n2.forEach(nom => { if (!rolesParNom.has(nom)) rolesParNom.set(nom, []); rolesParNom.get(nom).push("Technicien"); });
  const all = [...rolesParNom.entries()].map(([nom, roles]) => ({ nom, roles }));

  // Une personne est ouverte : on affiche sa fiche complète en pleine
  // largeur (page dédiée avec bouton retour), plus la grille en dessous —
  // plus simple et plus net qu'une carte qui s'étire au milieu des autres.
  const personneOuverte = perms.isEditor ? all.find(p => p.nom === ui.ficheOuverte) : null;
  if (personneOuverte) {
    const c = state.coordonnees[personneOuverte.nom] || {};
    container.innerHTML = `
      <div class="stack">
        <button class="back-btn" id="fiche-retour">← Retour aux coordonnées</button>
        ${renderFicheTechnicien(personneOuverte.nom, personneOuverte.roles, c)}
      </div>
    `;
    document.getElementById("fiche-retour").addEventListener("click", () => { ui.ficheOuverte = null; renderAll(); });
    attacherFicheTechnicienListeners();
    attacherApercuNoteFraisListeners();
    return;
  }

  container.innerHTML = `
    <div class="stack">
      <p class="hint">Coordonnées des cadres d'astreinte et techniciens.${perms.isEditor ? " Clique sur une carte pour ouvrir sa fiche complète." : ""}</p>
      ${perms.canEditNames ? renderNomsEditor() : ""}
      <div class="tech-grid">
        ${all.length === 0 ? `<p class="hint">Aucune personne configurée.</p>` :
          all.map(p => {
            const c = state.coordonnees[p.nom] || {};
            return `
              <div class="tech-card"${perms.isEditor ? ` data-open-fiche="${esc(p.nom)}" role="button" tabindex="0"` : ""}>
                <div class="tech-card-header">
                  <div class="fiche-tech-avatar">${esc(initiales(p.nom))}</div>
                  <div>
                    <div class="fiche-tech-name">${esc(p.nom)}</div>
                    <div class="fiche-tech-sub">${p.roles.map(r => `<span class="tag" style="background:${ROLE_COULEUR[r]}">${esc(r)}</span>`).join(" ")}</div>
                  </div>
                </div>
                <div class="tech-card-quick-contact">
                  <div class="fiche-tech-contact-item">📞 ${c.telephone ? `<a href="tel:${esc(c.telephone)}" onclick="event.stopPropagation()">${esc(c.telephone)}</a>` : `<span class="hint">non renseigné</span>`}</div>
                  <div class="fiche-tech-contact-item">✉️ ${c.email ? `<a href="mailto:${esc(c.email)}" onclick="event.stopPropagation()">${esc(c.email)}</a>` : `<span class="hint">non renseigné</span>`}</div>
                </div>
              </div>`;
          }).join("")}
      </div>
    </div>
  `;

  if (perms.canEditNames) attacherNomsEditorListeners(container);
  if (!perms.isEditor) return;
  container.querySelectorAll("[data-open-fiche]").forEach(card => {
    const ouvrir = () => { ui.ficheOuverte = card.dataset.openFiche; renderAll(); };
    card.addEventListener("click", ouvrir);
    card.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ouvrir(); } });
  });
}

// Initiales d'un nom (avatar de la fiche technicien) — ex. "Jean Dupont"
// → "JD", "Valentin" → "V". Gère les accents/espaces multiples sans se
// soucier de la casse d'origine.
function initiales(nom) {
  const mots = (nom || "").trim().split(/\s+/).filter(Boolean);
  if (mots.length === 0) return "?";
  return mots.slice(0, 2).map(m => m[0].toUpperCase()).join("");
}

// Fiche complète d'un technicien — page dédiée (avec bouton retour dans
// renderCoordonnees) : identité, coordonnées, domicile/trajet, statut
// administratif et note de frais. Données et logique inchangées (mêmes
// attributs data-fiche-*/data-coord-*), seule la présentation change.
function renderFicheTechnicien(nom, roles, c) {
  const statutLabel = STATUTS_NOTE_FRAIS[c.statut || "salarie_prive"] || "—";
  return `
    <div class="fiche-tech-card">
      <div class="fiche-tech-header">
        <div class="fiche-tech-avatar">${esc(initiales(nom))}</div>
        <div>
          <div class="fiche-tech-name">${esc(nom)}</div>
          <div class="fiche-tech-sub">
            ${roles.map(r => `<span class="tag" style="background:${ROLE_COULEUR[r]}">${esc(r)}</span>`).join(" ")}
            <span class="tag" style="background:#8F5FBF;color:#fff">${esc(statutLabel)}</span>
          </div>
        </div>
      </div>

      <div class="fiche-tech-section">
        <p class="fiche-tech-eyebrow">Compte de l'appli</p>
        <p class="hint" style="margin:0 0 8px">Relie cette personne du planning à son compte de connexion : c'est ce qui lui affiche « Mon planning » sur l'accueil (si elle n'est pas d'astreinte).</p>
        ${(() => {
          const users = state.utilisateurs || [];
          const lie = users.find(u => u.uid === c.uid);
          return `<select data-fiche-uid="${esc(nom)}" style="max-width:360px">
            <option value="">— Aucun compte lié —</option>
            ${users.map(u => `<option value="${esc(u.uid)}" ${u.uid === c.uid ? "selected" : ""}>${esc(u.nom || u.email)}${u.email ? ` (${esc(u.email)})` : ""}</option>`).join("")}
          </select>${c.uid && !lie && users.length ? ` <span class="hint" style="color:var(--red)">compte lié introuvable</span>` : ""}`;
        })()}
      </div>

      <div class="fiche-tech-section">
        <p class="fiche-tech-eyebrow">Coordonnées</p>
        <div class="form-grid">
          <label>Téléphone<input type="tel" data-coord-tel="${esc(nom)}" value="${esc(c.telephone || '')}" placeholder="06 12 34 56 78"></label>
          <label>Téléphone secondaire<input type="tel" data-fiche-tel2="${esc(nom)}" value="${esc(c.telephone2 || '')}" placeholder="06 12 34 56 78"></label>
          <label>Email<input type="email" data-coord-email="${esc(nom)}" value="${esc(c.email || '')}" placeholder="email@etablieres.fr"></label>
        </div>
      </div>

      <div class="fiche-tech-section">
        <p class="fiche-tech-eyebrow">Domicile &amp; trajet</p>
        <p class="hint" style="margin:0 0 10px">Le trajet remboursé est domicile ↔ ${esc(SERVICE_TECHNIQUE_NOM)} (${esc(SERVICE_TECHNIQUE_ADRESSE)}) — le technicien prend ensuite un véhicule de service pour se rendre sur le site d'intervention, non remboursé séparément.</p>
        <div class="form-grid">
          <label>Adresse du domicile (lieu de départ)<input data-fiche-adresse="${esc(nom)}" value="${esc(c.adresseDomicile || '')}" placeholder="ex. 12 rue des Lilas, 85000 La Roche-sur-Yon"></label>
          <label>Km aller-retour domicile ↔ ${esc(SERVICE_TECHNIQUE_NOM)}<input type="number" min="0" step="0.1" data-fiche-km-service="${esc(nom)}" value="${c.kmDomicileService || ''}" placeholder="ex. 24"></label>
        </div>
      </div>

      <div class="fiche-tech-section">
        <p class="fiche-tech-eyebrow">Statut administratif</p>
        <div class="form-grid">
          <label>Association
            <select data-fiche-association="${esc(nom)}">
              <option value="ECOLE" ${(c.association || "ECOLE") === "ECOLE" ? "selected" : ""}>ECOLE</option>
              <option value="AGROPOLIS" ${c.association === "AGROPOLIS" ? "selected" : ""}>AGROPOLIS</option>
              <option value="ARMONIA" ${c.association === "ARMONIA" ? "selected" : ""}>ARMONIA</option>
            </select>
          </label>
          <label>Statut
            <select data-fiche-statut="${esc(nom)}">
              ${Object.entries(STATUTS_NOTE_FRAIS).map(([k, v]) => `<option value="${k}" ${(c.statut || "salarie_prive") === k ? "selected" : ""}>${v}</option>`).join("")}
            </select>
          </label>
          <label>Site principal (informatif)<input data-fiche-siteprincipal="${esc(nom)}" value="${esc(c.sitePrincipal || '')}" placeholder="ex. Service technique"></label>
        </div>
      </div>

      <div class="fiche-tech-section">
        <p class="fiche-tech-eyebrow">🖨️ Note de frais de déplacements</p>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <input type="month" id="fiche-mois-${esc(nom)}" value="${ui.noteFraisMois}">
          <button class="add-btn" data-generer-note="${esc(nom)}" style="font-size:12px">🖨️ Générer la note de frais</button>
        </div>
        <div id="fiche-note-status-${esc(nom)}" style="font-size:12px;margin-top:6px"></div>
        ${ui.noteFraisPreview && ui.noteFraisPreview.nom === nom ? renderApercuNoteFrais() : ""}
      </div>
    </div>
  `;
}

function attacherFicheTechnicienListeners() {
  mountedContainer.querySelectorAll("[data-coord-tel]").forEach(inp => inp.addEventListener("change", async () => {
    const nom = inp.dataset.coordTel;
    await saveCoordonnee(nom, { ...(state.coordonnees[nom] || {}), telephone: inp.value.trim() });
  }));
  mountedContainer.querySelectorAll("[data-coord-email]").forEach(inp => inp.addEventListener("change", async () => {
    const nom = inp.dataset.coordEmail;
    await saveCoordonnee(nom, { ...(state.coordonnees[nom] || {}), email: inp.value.trim() });
  }));
  mountedContainer.querySelectorAll("[data-fiche-adresse]").forEach(inp => inp.addEventListener("change", async () => {
    const nom = inp.dataset.ficheAdresse;
    await saveCoordonnee(nom, { ...(state.coordonnees[nom] || {}), adresseDomicile: inp.value.trim() });
  }));
  mountedContainer.querySelectorAll("[data-fiche-association]").forEach(sel => sel.addEventListener("change", async () => {
    const nom = sel.dataset.ficheAssociation;
    await saveCoordonnee(nom, { ...(state.coordonnees[nom] || {}), association: sel.value });
  }));
  mountedContainer.querySelectorAll("[data-fiche-uid]").forEach(sel => sel.addEventListener("change", async () => {
    const nom = sel.dataset.ficheUid;
    try {
      // Un compte ne peut être lié qu'à une seule personne du planning.
      for (const [autre, co] of Object.entries(state.coordonnees || {})) {
        if (autre !== nom && sel.value && co?.uid === sel.value) await saveCoordonnee(autre, { ...co, uid: "" });
      }
      await saveCoordonnee(nom, { ...(state.coordonnees[nom] || {}), uid: sel.value });
      window.toast?.("✓ Compte lié enregistré");
    } catch (e) {
      console.error("lien compte:", e);
      alert("Échec de l'enregistrement du compte lié : " + (e.message || e));
    }
  }));
  mountedContainer.querySelectorAll("[data-fiche-statut]").forEach(sel => sel.addEventListener("change", async () => {
    const nom = sel.dataset.ficheStatut;
    await saveCoordonnee(nom, { ...(state.coordonnees[nom] || {}), statut: sel.value });
  }));
  mountedContainer.querySelectorAll("[data-fiche-siteprincipal]").forEach(inp => inp.addEventListener("change", async () => {
    const nom = inp.dataset.ficheSiteprincipal;
    await saveCoordonnee(nom, { ...(state.coordonnees[nom] || {}), sitePrincipal: inp.value.trim() });
  }));
  mountedContainer.querySelectorAll("[data-fiche-km-service]").forEach(inp => inp.addEventListener("change", async () => {
    const nom = inp.dataset.ficheKmService;
    await saveCoordonnee(nom, { ...(state.coordonnees[nom] || {}), kmDomicileService: parseFloat(inp.value) || 0 });
  }));
  mountedContainer.querySelectorAll("[data-fiche-tel2]").forEach(inp => inp.addEventListener("change", async () => {
    const nom = inp.dataset.ficheTel2;
    await saveCoordonnee(nom, { ...(state.coordonnees[nom] || {}), telephone2: inp.value.trim() });
  }));
  mountedContainer.querySelectorAll("[data-generer-note]").forEach(btn => btn.addEventListener("click", async () => {
    const nom = btn.dataset.genererNote;
    const mois = document.getElementById(`fiche-mois-${nom}`).value;
    ui.noteFraisMois = mois;
    ouvrirApercuNoteFrais(nom, mois);
  }));
}

// Calcule les lignes de la note de frais (une par jour travaillé) sans
// rien afficher — réutilisé à la fois pour l'aperçu modifiable et pour
// l'impression finale, qui part des valeurs éventuellement corrigées
// dans l'aperçu plutôt que de tout recalculer depuis les interventions.
function calculerLignesNoteFrais(nom, mois, touteLHistoire = false) {
  const c = state.coordonnees[nom] || {};
  const kmAllerRetour = c.kmDomicileService || 0;
  const interventionsRetenues = state.interventions
    .filter(i => i.technicien === nom && i.date && !i.fraisRembourse && (touteLHistoire || i.date.startsWith(mois)))
    .sort((a, b) => a.date.localeCompare(b.date));
  const parJour = new Map();
  interventionsRetenues.forEach(i => {
    if (!parJour.has(i.date)) parJour.set(i.date, []);
    parJour.get(i.date).push(i);
  });
  return [...parJour.keys()].sort().map(jour => {
    const interventionsJour = parJour.get(jour);
    return {
      date: jour,
      lieuDepart: c.adresseDomicile || "—",
      villeDestination: `${SERVICE_TECHNIQUE_NOM} — ${SERVICE_TECHNIQUE_ADRESSE}`,
      numeros: interventionsJour.map(i => i.numero).filter(Boolean).join(", "),
      nature: interventionsJour.map(i => `${i.site}${i.type ? " (" + i.type + ")" : ""}`).join(" ; "),
      km: kmAllerRetour,
      fraisAnnexes: "",
      incluse: true,
      interventionIds: interventionsJour.map(i => i.id),
    };
  });
}

// Ouvre l'aperçu modifiable — avant impression, pour permettre de
// corriger le nombre de km d'un jour précis si le trajet habituel n'a
// pas été suivi ce jour-là (autre point de départ, déplacement
// exceptionnel...), plutôt que d'imprimer une valeur figée à l'aveugle.
function ouvrirApercuNoteFrais(nom, mois, declencheePar = null, touteLHistoire = false) {
  const statusEl = document.getElementById(`fiche-note-status-${nom}`);
  const c = state.coordonnees[nom] || {};
  const lignes = calculerLignesNoteFrais(nom, mois, touteLHistoire);
  if (lignes.length === 0) { const msg = touteLHistoire ? "Aucune intervention non remboursée pour l'instant." : "Aucune intervention pour ce mois."; if (statusEl) statusEl.innerHTML = `<span class="hint">${msg}</span>`; else window.toast(msg); return; }
  if (!c.kmDomicileService) {
    const msg = `⚠️ Kilomètres domicile ↔ ${SERVICE_TECHNIQUE_NOM} non renseignés pour ${nom}. Complète-les dans sa fiche (Coordonnées) avant de générer.`;
    if (statusEl) statusEl.innerHTML = `<span style="color:var(--red)">${esc(msg)}</span>`; else window.toast(msg, "error");
    return;
  }
  if (statusEl) statusEl.innerHTML = "";
  ui.noteFraisPreview = { nom, mois, lignes, declencheePar, touteLHistoire };
  renderAll();
}

function renderApercuNoteFrais() {
  const { lignes, nom, mois, declencheePar, touteLHistoire } = ui.noteFraisPreview;
  const totalKm = lignes.filter(l => l.incluse).reduce((s, l) => s + (parseFloat(l.km) || 0), 0);
  const nbIncluses = lignes.filter(l => l.incluse).length;
  return `
    <div class="form-card" style="margin-top:12px;background:var(--panel)">
      <h4 style="margin:0 0 8px;font-size:13px;color:var(--gold)">Aperçu — décoche les journées à ne pas inclure, modifie le trajet si besoin, avant d'imprimer</h4>
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;margin:0 0 10px">
        <input type="checkbox" id="note-frais-tout-historique" ${touteLHistoire ? "checked" : ""} style="width:15px;height:15px;accent-color:var(--gold)">
        Inclure tout l'historique non remboursé (pas seulement ce mois)
      </label>
      <div class="table-wrap">
        <table style="font-size:12px">
          <thead><tr><th></th><th>Date</th><th>N° intervention</th><th>Nature</th><th>Ville de destination</th><th>Km A/R</th><th>Frais annexes</th></tr></thead>
          <tbody>
            ${lignes.map((l, i) => `
              <tr style="${l.incluse ? "" : "opacity:.45"}">
                <td><input type="checkbox" data-note-incluse="${i}" ${l.incluse ? "checked" : ""} style="width:16px;height:16px;accent-color:var(--gold)"></td>
                <td>${new Date(l.date).toLocaleDateString("fr-FR")}</td>
                <td style="font-family:ui-monospace,monospace;font-size:11px">${esc(l.numeros || "—")}</td>
                <td>${esc(l.nature)}</td>
                <td><input data-note-destination="${i}" value="${esc(l.villeDestination)}" style="width:200px" ${l.incluse ? "" : "disabled"}></td>
                <td><input type="number" min="0" step="0.1" data-note-km="${i}" value="${l.km}" style="width:80px" ${l.incluse ? "" : "disabled"}></td>
                <td><input data-note-frais="${i}" value="${esc(l.fraisAnnexes)}" placeholder="ex. repas x2" style="width:140px" ${l.incluse ? "" : "disabled"}></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
      <p class="hint" style="margin:8px 0 0">Total : ${totalKm.toFixed(1)} km sur ${nbIncluses} journée(s) sélectionnée(s) (sur ${lignes.length})</p>
      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
        <button class="add-btn" id="note-frais-imprimer" ${nbIncluses === 0 ? 'disabled style="opacity:.5"' : ''} style="font-size:12px">🖨️ Imprimer (${nbIncluses})</button>
        <button class="nav-btn" id="note-frais-marquer-rembourse" ${nbIncluses === 0 ? 'disabled style="opacity:.5"' : ''} style="font-size:12px;border-color:var(--teal);color:var(--teal)" title="À utiliser une fois le remboursement obtenu, pour ne plus faire réapparaître ces journées la prochaine fois">✓ Marquer remboursement demandé</button>
        <button class="nav-btn" id="note-frais-annuler" style="font-size:12px">Annuler</button>
      </div>
    </div>
  `;
}

function attacherApercuNoteFraisListeners() {
  if (!ui.noteFraisPreview) return;
  mountedContainer.querySelectorAll("[data-note-incluse]").forEach(cb => cb.addEventListener("change", () => {
    ui.noteFraisPreview.lignes[parseInt(cb.dataset.noteIncluse, 10)].incluse = cb.checked;
    renderAll();
  }));
  mountedContainer.querySelectorAll("[data-note-destination]").forEach(inp => inp.addEventListener("input", () => {
    ui.noteFraisPreview.lignes[parseInt(inp.dataset.noteDestination, 10)].villeDestination = inp.value;
  }));
  mountedContainer.querySelectorAll("[data-note-km]").forEach(inp => inp.addEventListener("input", () => {
    ui.noteFraisPreview.lignes[parseInt(inp.dataset.noteKm, 10)].km = parseFloat(inp.value) || 0;
  }));
  mountedContainer.querySelectorAll("[data-note-frais]").forEach(inp => inp.addEventListener("input", () => {
    ui.noteFraisPreview.lignes[parseInt(inp.dataset.noteFrais, 10)].fraisAnnexes = inp.value;
  }));
  document.getElementById("note-frais-tout-historique")?.addEventListener("change", (e) => {
    const { nom, declencheePar } = ui.noteFraisPreview;
    const mois = ui.noteFraisMois;
    ouvrirApercuNoteFrais(nom, mois, declencheePar, e.target.checked);
  });
  document.getElementById("note-frais-annuler")?.addEventListener("click", () => { ui.noteFraisPreview = null; renderAll(); });
  document.getElementById("note-frais-imprimer")?.addEventListener("click", () => {
    const { nom, mois, lignes } = ui.noteFraisPreview;
    imprimerNoteDeFrais(nom, mois, lignes.filter(l => l.incluse));
  });
  document.getElementById("note-frais-marquer-rembourse")?.addEventListener("click", async () => {
    const lignesIncluses = ui.noteFraisPreview.lignes.filter(l => l.incluse);
    const idsATraiter = lignesIncluses.flatMap(l => l.interventionIds || []);
    if (idsATraiter.length === 0) return;
    if (!(await window.confirmDialog(`Marquer ${lignesIncluses.length} journée(s) comme remboursement demandé ? Elles ne réapparaîtront plus dans les prochaines notes de frais.`, { texteValider: "Marquer" }))) return;
    try {
      await Promise.all(idsATraiter.map(id => updateIntervention(id, { fraisRembourse: true })));
      window.toast(`${lignesIncluses.length} journée(s) marquée(s) comme remboursement demandé.`, "success");
      ui.noteFraisPreview = null;
      renderAll();
    } catch (e) {
      window.toast("Erreur : " + (e.message || e), "error");
    }
  });
}

// Génère et imprime la note de frais de déplacements du mois pour un
// technicien, en reproduisant le formulaire officiel papier (CG01) du
// groupe Établières — imprimable/enregistrable en PDF via la boîte de
// dialogue d'impression du navigateur. Part des lignes de l'aperçu
// (éventuellement corrigées à la main) plutôt que de tout recalculer.
function imprimerNoteDeFrais(nom, mois, lignes) {
  const c = state.coordonnees[nom] || {};
  const [annee, moisNum] = mois.split("-").map(Number);
  const totalKm = lignes.reduce((s, l) => s + (parseFloat(l.km) || 0), 0);
  const nomMois = new Date(annee, moisNum - 1, 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  const coche = (condition) => condition ? "☒" : "☐";

  const html = `
    <div class="print-fiche" style="background:#fff;color:#111;padding:20px;font-family:Calibri,Arial,sans-serif;font-size:12px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #333;padding-bottom:8px;margin-bottom:10px">
        <div style="display:flex;align-items:center;gap:10px">
          <img src="img/logo-etablieres.png" alt="Groupe Établières" style="height:38px">
          <div style="font-size:11px;line-height:1.3">Association ECOLE<br>Association AGROPOLIS<br>Association ARMONIA</div>
        </div>
        <div style="font-size:10px;text-align:right;line-height:1.4">
          <b>Codification : CG 01</b><br>Rattachement : CG - Compta/Gestion
        </div>
      </div>
      <h2 style="text-align:center;margin:0 0 10px;font-size:16px;background:#eee;padding:6px">NOTE DE FRAIS DE DEPLACEMENTS – ECOLE &amp; AGROPOLIS &amp; ARMONIA</h2>
      <p style="margin:0 0 10px;font-style:italic">Merci de compléter toutes les colonnes afin que votre demande soit traitée dans les meilleurs délais.</p>
      <p style="margin:0 0 4px"><b>NOM Prénom :</b> ${esc(nom)} &nbsp;&nbsp;&nbsp;&nbsp; <b>Mois :</b> ${esc(nomMois)}</p>
      <p style="margin:0 0 4px"><b>Association :</b> ${coche(!c.association || c.association === "ECOLE")} ECOLE &nbsp; ${coche(c.association === "AGROPOLIS")} AGROPOLIS &nbsp; ${coche(c.association === "ARMONIA")} ARMONIA</p>
      <p style="margin:0 0 4px"><b>Statut :</b>
        ${coche((c.statut || "salarie_prive") === "salarie_prive")} Salarié droit privé &nbsp;
        ${coche(c.statut === "salarie_public")} Salarié droit public &nbsp;
        ${coche(c.statut === "etudiant")} Étudiants &nbsp;
        ${coche(c.statut === "intervenant")} Intervenant facturation &nbsp;
        ${coche(c.statut === "intervenant_benevole")} Intervenant bénévole
      </p>
      <p style="margin:0 0 10px"><b>Site principal :</b> ${esc(c.sitePrincipal || "—")}</p>

      <table style="width:100%;border-collapse:collapse;font-size:11px">
        <thead><tr>
          <th style="border:1px solid #999;padding:5px;background:#eee">DATE</th>
          <th style="border:1px solid #999;padding:5px;background:#eee">Lieu départ</th>
          <th style="border:1px solid #999;padding:5px;background:#eee">Ville de destination</th>
          <th style="border:1px solid #999;padding:5px;background:#eee">Nature la mission</th>
          <th style="border:1px solid #999;padding:5px;background:#eee">Nbr Km A/R</th>
          <th style="border:1px solid #999;padding:5px;background:#eee">Frais annexes *<br><span style="font-weight:400;font-size:9px">(Péages, restaurant, parking…)</span></th>
        </tr></thead>
        <tbody>
          ${lignes.map(l => `
            <tr>
              <td style="border:1px solid #999;padding:5px">${new Date(l.date).toLocaleDateString("fr-FR")}</td>
              <td style="border:1px solid #999;padding:5px">${esc(l.lieuDepart)}</td>
              <td style="border:1px solid #999;padding:5px">${esc(l.villeDestination)}</td>
              <td style="border:1px solid #999;padding:5px">${l.numeros ? `<b>${esc(l.numeros)}</b> — ` : ""}${esc(l.nature)}</td>
              <td style="border:1px solid #999;padding:5px;text-align:center">${l.km}</td>
              <td style="border:1px solid #999;padding:5px">${esc(l.fraisAnnexes)}</td>
            </tr>
          `).join("")}
        </tbody>
        <tfoot>
          <tr style="font-weight:700">
            <td colspan="4" style="border:1px solid #999;padding:5px;text-align:right">TOTAUX</td>
            <td style="border:1px solid #999;padding:5px;text-align:center">${totalKm.toFixed(1)} km</td>
            <td style="border:1px solid #999;padding:5px"></td>
          </tr>
        </tfoot>
      </table>

      <div style="display:flex;justify-content:space-between;margin-top:18px;gap:16px">
        <div style="width:48%;border:1px solid #999;padding:8px;font-size:11px">
          <b>SIGNATURE DU RESPONSABLE HIERARCHIQUE</b><br><span style="font-size:10px">Avant transmission au siège</span><br><br>
          Tarif de remboursement du km : ${TARIF_KM.toFixed(3).replace(".", ",")} €
        </div>
        <div style="width:48%;border:1px solid #999;padding:8px;font-size:11px;text-align:center">
          <b>SIGNATURE DU DEMANDEUR</b>
        </div>
      </div>
      <p style="font-size:10px;margin:10px 0 0">*Frais annexes : joindre les justificatifs. En cas de repas, indiquer nom et nombre de personnes.</p>
      <p style="font-size:10px;margin:10px 0 4px">Dans le cas d'un remboursement par virement, merci de cocher la case ci-dessous et de joindre un RIB :</p>
      <p style="font-size:10px;margin:0">☐ Je souhaite que le remboursement de mes frais générés dans le cadre de ma mission soit effectué par virement. Je joins à la présente autorisation un RIB et j'accepte donc de communiquer mes coordonnées bancaires afin d'obtenir le remboursement de mes déplacements et frais par virement bancaire pour toutes mes interventions auprès de l'association ainsi que pour mes prochaines interventions sauf avis contraire de ma part.</p>
      <p style="font-size:9px;color:#666;margin-top:12px">Le nombre de kms déclarés doit s'appuyer sur le trajet le plus court proposé par MAPPY entre la ville de la résidence administrative du salarié (lieu de travail habituel) et la ville de déplacement. C'est sur cette base que se fera le remboursement. Un forfait est appliqué lors des déplacements entre les sites (CG11).</p>
    </div>
  `;

  const printRoot = document.createElement("div");
  printRoot.id = "note-frais-print-root";
  printRoot.className = "print-only";
  printRoot.innerHTML = html;
  document.body.appendChild(printRoot);
  window.print();
  setTimeout(() => printRoot.remove(), 1000);
  ui.noteFraisPreview = null;
  renderAll();
}

// =================================================================
// Historique des transferts de ligne
// =================================================================
function nuitIndicatorHTML() {
  const nuit = heuresDeNuit(ui.form.heureDebut, ui.form.heureFin);
  const dimanche = ui.form.date && estDimanche(ui.form.date);
  // Aperçu en direct du repos quotidien de 11h obligatoire (art. L3121-10),
  // pendant la saisie du formulaire — avant même d'enregistrer, pour que
  // le technicien voie tout de suite à partir de quelle heure il peut
  // légalement reprendre le travail.
  const fauxIntervention = { date: ui.form.date, heureDebut: ui.form.heureDebut, heureFin: ui.form.heureFin, technicien: ui.form.technicien };
  const fin = finInterventionDateTime(fauxIntervention);
  const reposJusqua = fin ? reposObligatoireJusqua(fauxIntervention) : null;
  const decalageNecessaire = reposJusqua && reposJusqua > repriseNormaleApres(fin);
  if (!nuit && !dimanche && !decalageNecessaire) return "";
  return `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
    ${nuit > 0 ? `<span class="tag" style="background:#3A3160">🌙 ${nuit.toFixed(2)}h de nuit (21h-6h, indicatif)</span>` : ""}
    ${dimanche ? `<span class="tag" style="background:#8F5FBF">🌞 Dimanche — prime +${PRIME_DIMANCHE}€ si déplacement</span>` : ""}
    ${decalageNecessaire ? `<span class="tag" style="background:var(--gold);color:#1A1305" title="Repos quotidien de 11h consécutives (art. L3121-10 du Code du travail) — calcul indicatif">🛌 Repos 11h obligatoire : reprise possible seulement à partir du ${fmtHeureJour(reposJusqua)}</span>` : ""}
  </div>`;
}

function renderTransferts(container, user) {
  const sorted = [...state.transferts].sort((a, b) => (a.date < b.date ? 1 : -1));
  const isSuperAdmin = user?.role === "super_admin";

  container.innerHTML = `
    <div class="stack">
      <p class="hint">Historique des transferts de ligne confirmés — qui a validé, et quand.${isSuperAdmin ? " En tant que Super Admin, tu peux annuler une confirmation en cas d'erreur (le transfert redevient à faire)." : ""}</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Date</th><th>De</th><th>Vers</th><th>Confirmé par</th><th>Le</th>${isSuperAdmin ? "<th></th>" : ""}</tr></thead>
          <tbody>
            ${sorted.length === 0 ? `<tr><td colspan="${isSuperAdmin ? 6 : 5}" class="empty-row">Aucun transfert confirmé pour l'instant.</td></tr>` :
              sorted.map(t => `
                <tr>
                  <td>${new Date(t.date).toLocaleDateString("fr-FR")}</td>
                  <td>${esc(t.fromPerson)}</td>
                  <td>${esc(t.toPerson)}</td>
                  <td>${esc(t.confirmedByNom)}</td>
                  <td>${t.confirmedAt ? new Date(t.confirmedAt).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                  ${isSuperAdmin ? `<td><button class="del-btn" data-annuler="${esc(t.date)}" style="padding:4px 10px;font-size:11px">🔄 Annuler</button></td>` : ""}
                </tr>
              `).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;

  container.querySelectorAll("[data-annuler]").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm("Annuler cette confirmation de transfert ? Le bandeau redeviendra actif pour le refaire.")) return;
      btn.disabled = true;
      try {
        await annulerTransfert(btn.dataset.annuler);
      } catch (e) {
        window.toast("Échec de l'annulation : " + (e.message || e));
        btn.disabled = false;
      }
    });
  });
}

// Éditeur commun "Noms des personnes" (ajout/retrait/renommage des N1 et
// N2) — utilisé à la fois depuis Astreinte (Calendrier) et Coordonnées,
// pour ne pas avoir à naviguer entre les deux pour la même chose.
// Le mot à utiliser pour un jour à 0h dépend du régime de travail de la
// personne : "RTT" pour un forfait jours (ex. cadre), "Jour à 0" pour
// une modulation horaire (ex. technicien) — les deux visent la même
// case du fichier PRTT (RR/R ou case vide), seul le mot change à
// l'affichage. Par défaut (régime non précisé) : "Jour à 0".
function libelleRtt(nom) {
  return (state.people.regimes || {})[nom] === "forfait" ? "RTT" : "Jour à 0";
}

function renderNomsEditor() {
  return `
    <details class="names-editor" style="background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:11px 15px">
      <summary style="cursor:pointer;font-size:13px;font-weight:600;color:var(--text-dim)">Noms des personnes</summary>
      <p style="font-size:11px;color:var(--text-dim);margin:10px 0">Ajouter ou retirer une personne du niveau 1 (réception d'appel) ou du niveau 2 (intervention, techniciens) — le calendrier se réajuste automatiquement. En N1, la 1ʳᵉ personne de la liste assure l'astreinte en continu ; les suivantes ne prennent le relais qu'en cas d'absence de la précédente, dans l'ordre. Le régime de travail détermine juste le mot utilisé pour un jour à 0h (RTT pour un forfait jours, Jour à 0 pour une modulation horaire) — sans effet sur le calendrier. Décoche "Astreinte" pour une personne présente dans la liste (note de frais, planning individuel, interventions) mais qui ne doit jamais être tirée au sort dans le roulement — ex. un agent qui n'est pas d'astreinte. Pour un technicien qui rejoint le roulement à une date précise (ex. un nouveau recruté à partir du 1ᵉʳ janvier), renseigne sa "Date de début" : il reste dans la liste mais n'est considéré disponible qu'à partir de cette date — inutile de lui créer une absence pour la période avant son arrivée, et le rattrapage se fait automatiquement au prorata de son temps de présence.</p>
      <label style="display:flex;align-items:center;gap:8px;font-size:12px;margin:4px 0 12px;max-width:340px">
        <span style="flex:1">Heure de prise de poste habituelle (repos 11h)<br><span style="font-size:10px;color:var(--text-dim);font-weight:400">Sert à calculer l'heure de reprise autorisée après une intervention d'astreinte.</span></span>
        <input type="time" id="heure-reprise-defaut" value="${esc(state.people.heureRepriseDefaut || "08:00")}" style="width:90px">
      </label>
      <p style="font-size:12px;font-weight:700;margin:10px 0 6px">Niveau 1 — réception</p>
      <div class="form-grid">
        ${state.people.n1.map((name, i) => `
          <label style="display:flex;align-items:center;gap:6px">
            <span style="flex:1">N1 — ${i === 0 ? "Principal" : "Remplaçant" + (state.people.n1.length > 2 ? " " + i : "")}<input data-name-group="n1" data-name-idx="${i}" value="${esc(name)}"></span>
            <span style="margin-top:18px"><select data-name-regime="${esc(name)}"><option value="horaire" ${(state.people.regimes || {})[name] !== "forfait" ? "selected" : ""}>Modulation horaire</option><option value="forfait" ${(state.people.regimes || {})[name] === "forfait" ? "selected" : ""}>Forfait jours</option></select></span>
            <label style="display:flex;flex-direction:column;gap:2px;margin-top:8px;font-size:10px;white-space:nowrap">Date de début<input type="date" data-name-debut="${esc(name)}" value="${esc((state.people.datesDebut || {})[name] || "")}" style="width:130px"></label>
            <label style="display:flex;align-items:center;gap:3px;margin-top:18px;font-size:10px;white-space:nowrap"><input type="checkbox" data-name-astreinte="${esc(name)}" ${(state.people.astreinteActive || {})[name] !== false ? "checked" : ""} style="width:14px;height:14px">Astreinte</label>
            ${state.people.n1.length > 1 ? `<button type="button" class="del-btn" data-name-del="n1:${i}" title="Retirer" style="margin-top:18px">🗑️</button>` : ""}
          </label>
        `).join("")}
      </div>
      <button type="button" class="nav-btn" id="names-add-n1" style="margin-top:8px;font-size:12px">➕ Ajouter une personne en N1</button>
      <div id="names-add-n1-form" style="display:none;gap:8px;margin-top:8px">
        <input id="names-add-n1-input" placeholder="Nom" style="flex:1">
        <button type="button" class="add-btn" id="names-add-n1-valider" style="font-size:12px">Ajouter</button>
      </div>

      <p style="font-size:12px;font-weight:700;margin:16px 0 6px">Niveau 2 — intervention</p>
      <div class="form-grid">
        ${state.people.n2.map((name, i) => `
          <label style="display:flex;align-items:center;gap:6px">
            <span style="flex:1">N2 — Technicien ${i + 1}<input data-name-group="n2" data-name-idx="${i}" value="${esc(name)}"></span>
            <span style="margin-top:18px"><select data-name-regime="${esc(name)}"><option value="horaire" ${(state.people.regimes || {})[name] !== "forfait" ? "selected" : ""}>Modulation horaire</option><option value="forfait" ${(state.people.regimes || {})[name] === "forfait" ? "selected" : ""}>Forfait jours</option></select></span>
            <label style="display:flex;flex-direction:column;gap:2px;margin-top:8px;font-size:10px;white-space:nowrap">Date de début<input type="date" data-name-debut="${esc(name)}" value="${esc((state.people.datesDebut || {})[name] || "")}" style="width:130px"></label>
            <label style="display:flex;align-items:center;gap:3px;margin-top:18px;font-size:10px;white-space:nowrap"><input type="checkbox" data-name-astreinte="${esc(name)}" ${(state.people.astreinteActive || {})[name] !== false ? "checked" : ""} style="width:14px;height:14px">Astreinte</label>
            ${state.people.n2.length > 1 ? `<button type="button" class="del-btn" data-name-del="n2:${i}" title="Retirer" style="margin-top:18px">🗑️</button>` : ""}
          </label>
        `).join("")}
      </div>
      <button type="button" class="nav-btn" id="names-add-n2" style="margin-top:8px;font-size:12px">➕ Ajouter une personne en N2</button>
      <div id="names-add-n2-form" style="display:none;gap:8px;margin-top:8px">
        <input id="names-add-n2-input" placeholder="Nom" style="flex:1">
        <button type="button" class="add-btn" id="names-add-n2-valider" style="font-size:12px">Ajouter</button>
      </div>
    </details>
  `;
}

function attacherNomsEditorListeners(container, onSaved) {
  container.querySelector("#heure-reprise-defaut")?.addEventListener("change", async (e) => {
    await savePeople({ ...state.people, heureRepriseDefaut: e.target.value || "08:00" });
  });
  container.querySelectorAll("input[data-name-group]").forEach(inp => {
    inp.addEventListener("change", async () => {
      const grp = inp.dataset.nameGroup, idx = parseInt(inp.dataset.nameIdx, 10);
      const val = inp.value.trim(); if (!val) return;
      const next = { ...state.people, [grp]: [...state.people[grp]] };
      next[grp][idx] = val;
      await savePeople(next);
    });
  });
  container.querySelectorAll("[data-name-del]").forEach(btn => btn.addEventListener("click", async () => {
    const [grp, idxStr] = btn.dataset.nameDel.split(":");
    const idx = parseInt(idxStr, 10);
    const nomRetire = state.people[grp][idx];
    if (!(await window.confirmDialog(`Retirer "${nomRetire}" du roulement ${grp.toUpperCase()} ? L'historique des astreintes déjà passées n'est pas modifié.`, { danger: true, texteValider: "Retirer" }))) return;
    const next = { ...state.people, [grp]: state.people[grp].filter((_, i) => i !== idx) };
    await savePeople(next);
  }));
  container.querySelectorAll("[data-name-regime]").forEach(sel => sel.addEventListener("change", async () => {
    const nom = sel.dataset.nameRegime;
    const regimes = { ...(state.people.regimes || {}), [nom]: sel.value };
    await savePeople({ ...state.people, regimes });
  }));
  container.querySelectorAll("[data-name-astreinte]").forEach(chk => chk.addEventListener("change", async () => {
    const nom = chk.dataset.nameAstreinte;
    const astreinteActive = { ...(state.people.astreinteActive || {}), [nom]: chk.checked };
    await savePeople({ ...state.people, astreinteActive });
  }));
  container.querySelectorAll("[data-name-debut]").forEach(inp => inp.addEventListener("change", async () => {
    const nom = inp.dataset.nameDebut;
    const datesDebut = { ...(state.people.datesDebut || {}) };
    if (inp.value) datesDebut[nom] = inp.value; else delete datesDebut[nom];
    await savePeople({ ...state.people, datesDebut });
  }));
  document.getElementById("names-add-n1")?.addEventListener("click", () => {
    const form = document.getElementById("names-add-n1-form");
    form.style.display = "flex";
    document.getElementById("names-add-n1-input").focus();
  });
  document.getElementById("names-add-n1-valider")?.addEventListener("click", async () => {
    const nom = document.getElementById("names-add-n1-input").value.trim(); if (!nom) return;
    await savePeople({ ...state.people, n1: [...state.people.n1, nom] });
  });
  document.getElementById("names-add-n2")?.addEventListener("click", () => {
    const form = document.getElementById("names-add-n2-form");
    form.style.display = "flex";
    document.getElementById("names-add-n2-input").focus();
  });
  document.getElementById("names-add-n2-valider")?.addEventListener("click", async () => {
    const nom = document.getElementById("names-add-n2-input").value.trim(); if (!nom) return;
    await savePeople({ ...state.people, n2: [...state.people.n2, nom] });
  });
}

// =================================================================
// Planning individuel — calendrier annuel d'une personne (congés,
// RTT, arrêts de travail et interventions), y compris pour quelqu'un
// qui n'est pas dans le roulement d'astreinte (ex. un agent des
// espaces verts). Les absences importées depuis un fichier PRTT
// (voir prtt-import.js) alimentent automatiquement ce planning
// puisqu'elles sont enregistrées comme n'importe quelle absence.
// =================================================================
// Affiché en année scolaire (septembre → août), comme le reste du module
// astreinte (YEAR_START/YEAR_END) plutôt qu'en année civile — "année N"
// signifie ici "année scolaire N → N+1".
const PLANNING_MOIS_SCOLAIRE = [
  { label: "Septembre", mois: 8, decalage: 0 }, { label: "Octobre", mois: 9, decalage: 0 },
  { label: "Novembre", mois: 10, decalage: 0 }, { label: "Décembre", mois: 11, decalage: 0 },
  { label: "Janvier", mois: 0, decalage: 1 }, { label: "Février", mois: 1, decalage: 1 },
  { label: "Mars", mois: 2, decalage: 1 }, { label: "Avril", mois: 3, decalage: 1 },
  { label: "Mai", mois: 4, decalage: 1 }, { label: "Juin", mois: 5, decalage: 1 },
  { label: "Juillet", mois: 6, decalage: 1 }, { label: "Août", mois: 7, decalage: 1 },
];
function anneeScolaireCourante() {
  const d = new Date();
  return d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear() - 1;
}
function moisScolaireIdxCourant() {
  const m = new Date().getMonth();
  const idx = PLANNING_MOIS_SCOLAIRE.findIndex(x => x.mois === m);
  return idx === -1 ? 0 : idx;
}
const JOURS_SEMAINE = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

function absenceDuJour(person, dateStr) {
  return state.absences.find(a => a.person === person && dateStr >= a.start && dateStr <= a.end) || null;
}

// ---- Sélecteur association / sous-service / site, réutilisé par le
// formulaire de récurrence et l'ajout ponctuel du planning individuel
// (même logique en cascade que le formulaire d'intervention principal).
function assocInfo(assocNom) {
  const a = state.associations.find(x => x.nom === assocNom);
  if (!a) return { groupes: [], hasSansGroupe: false, sites: [] };
  const groupes = [...new Set(a.sites.filter(s => s.groupe).map(s => s.groupe))];
  return { groupes, hasSansGroupe: a.sites.some(s => !s.groupe), sites: a.sites };
}
function siteSelectorHTML(idPrefix, form) {
  const info = assocInfo(form.association);
  const sites = info.sites.filter(s => form.groupe ? s.groupe === form.groupe : !s.groupe);
  const siteDisabled = !form.association || (info.groupes.length > 0 && !form.groupe && !info.hasSansGroupe);
  return `
    <label>Association
      <select id="${idPrefix}-association">
        <option value="">— Choisir —</option>
        ${state.associations.map(a => `<option value="${esc(a.nom)}" ${form.association === a.nom ? "selected" : ""}>${esc(a.nom)}</option>`).join("")}
      </select>
    </label>
    ${info.groupes.length > 0 ? `
    <label>Sous-service
      <select id="${idPrefix}-groupe">
        ${info.hasSansGroupe ? `<option value="" ${!form.groupe ? "selected" : ""}>— Aucun —</option>` : `<option value="">— Choisir —</option>`}
        ${info.groupes.map(g => `<option value="${esc(g)}" ${form.groupe === g ? "selected" : ""}>${esc(g)}</option>`).join("")}
      </select>
    </label>` : ""}
    <label>Site
      <select id="${idPrefix}-site" ${siteDisabled ? "disabled" : ""}>
        <option value="">— Choisir —</option>
        ${sites.map(s => `<option value="${esc(s.nom)}" ${form.site === s.nom ? "selected" : ""}>${esc(s.nom)}</option>`).join("")}
      </select>
    </label>`;
}
function attacherSiteSelectorListeners(idPrefix, form) {
  document.getElementById(`${idPrefix}-association`)?.addEventListener("change", (e) => { form.association = e.target.value; form.groupe = ""; form.site = ""; renderAll(); });
  document.getElementById(`${idPrefix}-groupe`)?.addEventListener("change", (e) => { form.groupe = e.target.value; form.site = ""; renderAll(); });
  document.getElementById(`${idPrefix}-site`)?.addEventListener("change", (e) => { form.site = e.target.value; });
}

// Convertit le jour de récurrence (0=Lundi..6=Dimanche, ordre affiché à
// l'écran) vers la convention Date#getDay() (0=Dimanche..6=Samedi).
function jourSemaineVersGetDay(j) { return (j + 1) % 7; }

// Calcule les dates d'occurrence d'une récurrence entre aujourd'hui (ou sa
// date de début si future) et un horizon donné, en respectant sa
// fréquence en semaines, son jour de semaine et sa date de fin
// éventuelle — sans jamais dériver du rythme fixé par sa date de début.
export function genererOccurrencesRecurrence(rec, horizon) {
  if (!rec.dateDebut) return [];
  const freq = Math.max(1, parseInt(rec.frequenceSemaines, 10) || 1);
  const cibleDow = jourSemaineVersGetDay(parseInt(rec.jourSemaine, 10) || 0);
  const debut = new Date(rec.dateDebut + "T00:00:00");
  const fin = rec.dateFin ? new Date(rec.dateFin + "T00:00:00") : horizon;
  const limite = fin < horizon ? fin : horizon;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let d = debut > today ? new Date(debut) : new Date(today);
  while (d.getDay() !== cibleDow) d = addDays(d, 1);
  const semainesDepuisDebut = Math.round((d - debut) / (7 * 86400000));
  const reste = ((semainesDepuisDebut % freq) + freq) % freq;
  if (reste !== 0) d = addDays(d, (freq - reste) * 7);
  const dates = [];
  while (d <= limite) { dates.push(dateKey(d)); d = addDays(d, freq * 7); }
  return dates;
}

// Matérialise, pour une récurrence donnée, les vraies interventions
// manquantes sur les ~4 prochains mois glissants (dé-duplication sur
// recurrenceId + date) — à relancer périodiquement pour prolonger le
// planning au fur et à mesure. Chaque intervention générée reste un
// document "interventions" normal, éditable/supprimable individuellement
// sans affecter la règle de récurrence.
async function genererInterventionsRecurrence(rec, user) {
  const horizon = addDays(new Date(), 120);
  const dates = genererOccurrencesRecurrence(rec, horizon);
  const dejaGenerees = new Set(state.interventions.filter(i => i.recurrenceId === rec.id).map(i => i.date));
  const aCreer = dates.filter(d => !dejaGenerees.has(d));
  const duree = dureeHeures(rec.heureDebut, rec.heureFin);
  for (const date of aCreer) {
    await addIntervention({
      date, technicien: rec.person, association: rec.association || "", groupe: rec.groupe || "", site: rec.site || "",
      type: rec.type || "Espaces verts", heures: duree !== null ? duree : 0,
      heureDebut: rec.heureDebut || "", heureFin: rec.heureFin || "", description: rec.description || "",
      heuresNuit: 0, primeDimanche: estDimanche(date) ? PRIME_DIMANCHE : 0, photos: [],
      appelN1: false, n1Contacte: "", motifAppelN1: "", decisionN1: "",
      recurrenceId: rec.id, genereAuto: true,
      createdBy: user.uid, createdByName: user.nom || user.email,
    });
  }
  return aCreer.length;
}

function renderRecurrencesPanel(person) {
  const recs = state.recurrences.filter(r => r.person === person);
  const f = ui.recurForm;
  // Une fois le panneau déplié une fois pour cette personne (manuellement, ou
  // parce qu'il y a déjà des récurrences / une édition en cours), on se
  // souvient de son état via `ui.recurDetailsOpen` : sans ça, chaque saisie
  // dans le formulaire (ex. choix de l'association) déclenche un renderAll()
  // qui recalculait "open" à partir de recs.length/recurEditingId et
  // refermait le panneau en pleine saisie.
  if (ui.recurDetailsOpen[person] === undefined) ui.recurDetailsOpen[person] = recs.length > 0 || !!ui.recurEditingId;
  const isOpen = ui.recurDetailsOpen[person];
  return `
    <details id="rf-details" class="names-editor" style="background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:11px 15px" ${isOpen ? "open" : ""}>
      <summary style="cursor:pointer;font-size:13px;font-weight:600;color:var(--text-dim)">🔁 Planning récurrent — entretiens réguliers de ${esc(person)}</summary>
      <p style="font-size:11px;color:var(--text-dim);margin:10px 0">Définis une règle (ex. "toutes les 2 semaines, le mardi, tonte de la Résidence Le Mail") puis clique "Générer" pour créer les interventions à venir (~4 mois) — elles apparaissent ensuite normalement dans l'onglet Interventions et ici (pastille violette). Reclique "Générer" de temps en temps pour prolonger le planning. Pour un entretien ponctuel hors récurrence, clique directement une date du calendrier ci-dessous.</p>
      ${recs.length ? `
      <div class="table-wrap" style="margin-bottom:12px">
        <table>
          <thead><tr><th>Fréquence</th><th>Jour</th><th>Site</th><th>Type</th><th>Période</th><th></th></tr></thead>
          <tbody>
            ${recs.map(r => `<tr>
              <td>${Number(r.frequenceSemaines) === 1 ? "Toutes les semaines" : `Toutes les ${esc(r.frequenceSemaines)} semaines`}</td>
              <td>${esc(JOURS_SEMAINE[r.jourSemaine] || "—")}</td>
              <td>${esc(r.site || "—")}</td>
              <td>${esc(r.type || "—")}</td>
              <td style="font-size:11px">${r.dateDebut ? new Date(r.dateDebut).toLocaleDateString("fr-FR") : "—"} → ${r.dateFin ? new Date(r.dateFin).toLocaleDateString("fr-FR") : "indéterminée"}</td>
              <td style="white-space:nowrap">
                <button type="button" class="nav-btn" data-recur-generer="${r.id}" style="padding:4px 8px;font-size:11px" title="Générer les prochaines interventions (jusqu'à 4 mois)">📅 Générer</button>
                <button type="button" class="nav-btn" data-recur-edit="${r.id}" style="padding:4px 8px;font-size:11px">✏️</button>
                <button type="button" class="del-btn" data-recur-del="${r.id}">🗑️</button>
              </td>
            </tr>`).join("")}
          </tbody>
        </table>
      </div>` : ""}
      <div class="form-grid">
        <label>Fréquence
          <select id="rf-freq">
            <option value="1" ${Number(f.frequenceSemaines) === 1 ? "selected" : ""}>Toutes les semaines</option>
            <option value="2" ${Number(f.frequenceSemaines) === 2 ? "selected" : ""}>Toutes les 2 semaines</option>
            <option value="3" ${Number(f.frequenceSemaines) === 3 ? "selected" : ""}>Toutes les 3 semaines</option>
            <option value="4" ${Number(f.frequenceSemaines) === 4 ? "selected" : ""}>Toutes les 4 semaines (≈ mensuel)</option>
          </select>
        </label>
        <label>Jour<select id="rf-jour">${JOURS_SEMAINE.map((j, i) => `<option value="${i}" ${Number(f.jourSemaine) === i ? "selected" : ""}>${j}</option>`).join("")}</select></label>
        ${siteSelectorHTML("rf", f)}
        <label>Type<input id="rf-type" list="types-rf" value="${esc(f.type)}"><datalist id="types-rf">${TYPE_SUGGESTIONS.map(t => `<option value="${esc(t)}">`).join("")}</datalist></label>
        <label>Heure de départ<input type="time" id="rf-heure-debut" value="${esc(f.heureDebut)}"></label>
        <label>Heure de retour<input type="time" id="rf-heure-fin" value="${esc(f.heureFin)}"></label>
        <label>Début de la récurrence<input type="date" id="rf-date-debut" value="${esc(f.dateDebut)}"></label>
        <label>Fin (optionnel)<input type="date" id="rf-date-fin" value="${esc(f.dateFin)}"></label>
        <label class="desc-field">Description<input id="rf-desc" value="${esc(f.description)}" placeholder="ex. tonte, taille de haies…"></label>
      </div>
      <button type="button" class="add-btn" id="rf-valider">${ui.recurEditingId ? "💾 Enregistrer les modifications" : "➕ Ajouter cette récurrence"}</button>
      ${ui.recurEditingId ? `<button type="button" class="nav-btn" id="rf-annuler" style="margin-left:8px">✕ Annuler</button>` : ""}
      <div id="rf-status" style="margin-top:8px;font-size:12px"></div>
    </details>
  `;
}

// Détail du jour cliqué dans le planning individuel : liste les
// interventions déjà présentes ce jour-là (avec Modifier/Supprimer —
// y compris celles générées par une récurrence) et propose le
// formulaire d'ajout/modification en dessous. Avant cet ajout, une fois
// une intervention posée sur un jour, il n'y avait aucun moyen de la
// reprendre depuis ce planning : il fallait la retrouver "à la main"
// dans la liste de l'onglet Interventions.
function renderJourDetail(person, interventionsJour) {
  if (!ui.planningQuickDate) return "";
  const f = ui.planningQuickForm;
  const dateLabel = new Date(ui.planningQuickDate).toLocaleDateString("fr-FR");
  const editing = ui.planningQuickEditingId;
  return `
    <div class="form-card" style="margin-top:10px">
      <h3 style="margin:0 0 10px;font-size:13px;color:var(--gold)">${dateLabel} — ${esc(person)}</h3>
      ${interventionsJour.length > 0 ? `
      <div class="table-wrap" style="margin-bottom:12px">
        <table style="font-size:12px">
          <thead><tr><th>Site</th><th>Type</th><th>Heures</th><th>Description</th><th></th></tr></thead>
          <tbody>
            ${interventionsJour.map(i => `<tr ${editing === i.id ? 'style="outline:2px solid var(--gold);outline-offset:-2px"' : ""}>
              <td>${esc(i.site)}</td><td>${esc(i.type)}${i.recurrenceId ? ` <span class="tag" style="font-size:9px">🔁 récurrence</span>` : ""}</td>
              <td>${i.heures} h</td><td>${esc(i.description || "—")}</td>
              <td style="white-space:nowrap"><button type="button" class="nav-btn" data-jour-edit-interv="${i.id}" style="padding:4px 8px;font-size:11px">✏️</button> <button type="button" class="del-btn" data-jour-del-interv="${i.id}" style="padding:4px 8px;font-size:11px">🗑️</button></td>
            </tr>`).join("")}
          </tbody>
        </table>
      </div>` : ""}
      <div class="form-grid">
        ${siteSelectorHTML("qf", f)}
        <label>Type<input id="qf-type" list="types-qf" value="${esc(f.type)}" placeholder="ex. Espaces verts"><datalist id="types-qf">${TYPE_SUGGESTIONS.map(t => `<option value="${esc(t)}">`).join("")}</datalist></label>
        <label>Heure de départ<input type="time" id="qf-heure-debut" value="${esc(f.heureDebut)}"></label>
        <label>Heure de retour<input type="time" id="qf-heure-fin" value="${esc(f.heureFin)}"></label>
        <label class="desc-field">Description<input id="qf-desc" value="${esc(f.description)}"></label>
      </div>
      <button type="button" class="add-btn" id="qf-valider">${editing ? "💾 Enregistrer les modifications" : "➕ Ajouter l'intervention"}</button>
      <button type="button" class="nav-btn" id="qf-annuler" style="margin-left:8px">✕ ${editing ? "Annuler la modification" : "Fermer"}</button>
      <div id="qf-status" style="margin-top:8px;font-size:12px"></div>
    </div>
  `;
}

// Vue combinée : plusieurs agendas ouverts en même temps, sur un même
// mois de l'année scolaire, pour voir d'un coup d'œil qui est présent,
// absent ou déjà en intervention ce jour-là (utile en réunion de
// planification, plutôt que d'ouvrir les plannings un par un).
function renderVueMultiPersonnes(container, allPeople) {
  const year = ui.planningIndivYear;
  if (!ui.planningMultiPersonnes) ui.planningMultiPersonnes = [...allPeople];
  else ui.planningMultiPersonnes = ui.planningMultiPersonnes.filter(p => allPeople.includes(p));
  if (ui.planningMultiMoisIdx === null) ui.planningMultiMoisIdx = -1;
  const vueAnnee = ui.planningMultiMoisIdx === -1;

  // Liste des jours affichés, chacun rattaché à son mois (pour l'en-tête
  // groupé) — soit les jours d'un seul mois, soit ceux des 12 mois de
  // l'année scolaire complète (septembre → août) mis bout à bout.
  const moisAffiches = vueAnnee ? PLANNING_MOIS_SCOLAIRE : [PLANNING_MOIS_SCOLAIRE[ui.planningMultiMoisIdx]];
  const LETTRES_JOUR = ["L", "M", "M", "J", "V", "S", "D"];
  const jours = [];
  moisAffiches.forEach(m => {
    const anneeReelle = year + m.decalage;
    const nbJours = new Date(anneeReelle, m.mois + 1, 0).getDate();
    for (let i = 0; i < nbJours; i++) {
      const date = new Date(anneeReelle, m.mois, i + 1);
      jours.push({
        date, moisLabel: m.label, premierDuMois: i === 0,
        premierDeSemaine: date.getDay() === 1,
        lettreJour: LETTRES_JOUR[(date.getDay() + 6) % 7],
        ferie: HOLIDAYS.get(dateKey(date)) || null,
      });
    }
  });
  const groupesMois = [];
  jours.forEach(j => {
    const dernier = groupesMois[groupesMois.length - 1];
    if (dernier && dernier.label === j.moisLabel) dernier.count++; else groupesMois.push({ label: j.moisLabel, count: 1 });
  });
  const todayKey = dateKey(new Date());
  const largeurCol = vueAnnee ? 14 : 18;

  // Binômes : chaque personne choisit son binôme dans une liste (plutôt
  // qu'un libellé à taper des deux côtés, source d'erreur) — les deux
  // membres reçoivent alors la même couleur pastel et sont regroupés côte
  // à côte dans le tableau. state.people.binomes est un simple aller
  // {nom: nomDuPartenaire}, mais un seul sens suffit à former le groupe :
  // pas besoin que les deux se soient mutuellement choisis pour un rendu
  // correct (setBinome, plus bas, garde quand même les deux sens à jour).
  const PASTELS = ["#FCE8D6", "#DCEEE4", "#E3E6FB", "#FBE3EC", "#FFF3C4", "#DDF0F5", "#EEE1F7", "#E9F0DA"];
  const binomes = state.people.binomes || {};
  const groupeDe = {};
  let groupIdx = 0;
  allPeople.forEach(p => {
    if (groupeDe[p] !== undefined) return;
    const q = binomes[p];
    if (q && allPeople.includes(q) && q !== p) {
      const gid = groupIdx++;
      groupeDe[p] = gid;
      groupeDe[q] = gid;
    }
  });
  const couleurBinome = (p) => groupeDe[p] === undefined ? null : PASTELS[groupeDe[p] % PASTELS.length];
  const personnes = [...ui.planningMultiPersonnes].sort((a, b) => {
    const ia = groupeDe[a] ?? Infinity, ib = groupeDe[b] ?? Infinity;
    if (ia !== ib) return ia - ib;
    return ui.planningMultiPersonnes.indexOf(a) - ui.planningMultiPersonnes.indexOf(b);
  });

  const interventionsParPersonneDate = {};
  state.interventions.forEach(i => {
    if (!personnes.includes(i.technicien)) return;
    interventionsParPersonneDate[`${i.technicien}|${i.date}`] = true;
  });

  container.innerHTML = `
    <div class="stack">
      <p class="hint">Vue combinée de plusieurs agendas ${vueAnnee ? "sur l'année scolaire complète" : "sur un même mois"} — pour voir en un coup d'œil qui est présent, absent ou déjà en intervention ce jour-là.</p>
      <div class="toolbar">
        <button type="button" class="nav-btn" id="pm-retour">← Planning d'une personne</button>
        <label>Année scolaire
          <select id="pm-annee">${[year - 1, year, year + 1].map(y => `<option value="${y}" ${y === year ? "selected" : ""}>${y}-${y + 1}</option>`).join("")}</select>
        </label>
        <label>Période
          <select id="pm-mois">
            <option value="-1" ${vueAnnee ? "selected" : ""}>Année scolaire complète</option>
            ${PLANNING_MOIS_SCOLAIRE.map((m, i) => `<option value="${i}" ${i === ui.planningMultiMoisIdx ? "selected" : ""}>${m.label}</option>`).join("")}
          </select>
        </label>
      </div>
      <div class="stat-row" style="gap:6px">
        ${allPeople.map(p => `<label style="display:flex;align-items:center;gap:4px;font-size:11px;background:var(--panel);border:1px solid var(--border);border-radius:20px;padding:3px 10px;cursor:pointer">
          <input type="checkbox" data-multi-personne="${esc(p)}" ${personnes.includes(p) ? "checked" : ""} style="width:13px;height:13px">${esc(p)}
        </label>`).join("")}
      </div>
      <details class="names-editor" style="background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:11px 15px">
        <summary style="cursor:pointer;font-size:13px;font-weight:600;color:var(--text-dim)">🎨 Binômes</summary>
        <p style="font-size:11px;color:var(--text-dim);margin:10px 0">Choisis le binôme de chaque personne : les deux reçoivent la même couleur pastel et sont regroupées côte à côte dans le tableau ci-dessous. "— Aucun —" retire la personne de son binôme.</p>
        <div class="form-grid">
          ${allPeople.map(p => `<label style="display:flex;align-items:center;gap:6px">
            <span style="flex:1;display:flex;align-items:center;gap:6px">${couleurBinome(p) ? `<i style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${couleurBinome(p)};border:1px solid var(--border)"></i>` : ""}${esc(p)}</span>
            <select data-binome="${esc(p)}" style="width:140px">
              <option value="">— Aucun —</option>
              ${allPeople.filter(q => q !== p).map(q => `<option value="${esc(q)}" ${binomes[p] === q ? "selected" : ""}>${esc(q)}</option>`).join("")}
            </select>
          </label>`).join("")}
        </div>
      </details>
      <div class="year-cal-legend">
        <span><i class="year-cal-legend-dot" style="background:var(--gold)"></i> Congé</span>
        <span><i class="year-cal-legend-dot" style="background:var(--teal)"></i> RTT</span>
        <span><i class="year-cal-legend-dot" style="background:var(--red)"></i> Arrêt de travail</span>
        <span><i class="year-cal-legend-dot year-cal-legend-dot-outline"></i> Intervention</span>
        <span><i class="year-cal-legend-dot" style="background:var(--violet, #8F5FBF)"></i> Jour férié</span>
      </div>
      <div class="table-wrap">
        <table style="font-size:11px">
          <thead>
            <tr><th style="position:sticky;left:0;background:var(--panel);z-index:2"></th>${groupesMois.map(g => `<th colspan="${g.count}" style="text-align:center;border-left:1px solid var(--border);white-space:nowrap">${g.label}</th>`).join("")}</tr>
            <tr><th style="position:sticky;left:0;background:var(--panel);z-index:2"></th>${jours.map(j => `<th style="text-align:center;padding:0 1px;font-weight:400;color:var(--text-dim);${j.premierDuMois ? "border-left:1px solid var(--border)" : j.premierDeSemaine ? "border-left:1px dashed var(--border)" : ""}">${j.lettreJour}</th>`).join("")}</tr>
            <tr><th style="position:sticky;left:0;background:var(--panel);z-index:2">Personne</th>${jours.map(j => `<th title="${j.ferie ? esc(j.ferie) : ""}" style="text-align:center;padding:0 1px;${j.ferie ? "color:var(--violet, #8F5FBF);font-weight:700" : (j.date.getDay() === 0 || j.date.getDay() === 6) ? "color:var(--text-dim)" : ""}${j.premierDuMois ? "border-left:1px solid var(--border)" : j.premierDeSemaine ? "border-left:1px dashed var(--border)" : ""}">${j.date.getDate()}</th>`).join("")}</tr>
          </thead>
          <tbody>
            ${personnes.length === 0 ? `<tr><td colspan="${jours.length + 1}" class="empty-row">Sélectionne au moins une personne ci-dessus.</td></tr>` : personnes.map(p => `
              <tr>
                <td style="font-weight:700;white-space:nowrap;position:sticky;left:0;z-index:1;background:${couleurBinome(p) || "var(--panel)"};${couleurBinome(p) ? "color:#1A1305" : ""}">${esc(p)}</td>
                ${jours.map(j => {
                  const d = j.date;
                  const k = dateKey(d);
                  const abs = absenceDuJour(p, k);
                  const interv = interventionsParPersonneDate[`${p}|${k}`];
                  const weekend = d.getDay() === 0 || d.getDay() === 6;
                  let bg = "transparent", titre = "Présent";
                  if (abs) { bg = abs.type === "arret" ? "var(--red)" : abs.type === "rtt" ? "var(--teal)" : "var(--gold)"; titre = abs.type === "arret" ? "Arrêt de travail" : abs.type === "rtt" ? libelleRtt(p) : "Congé"; }
                  else if (j.ferie) { titre = j.ferie; }
                  else if (weekend) { titre = "Week-end"; }
                  const bordureCol = j.premierDuMois ? "border-left:1px solid var(--border)" : j.premierDeSemaine ? "border-left:1px dashed var(--border)" : "";
                  return `<td style="text-align:center;padding:2px 1px;${bordureCol}${j.ferie && !abs ? "background:rgba(143,95,191,.12)" : ""}${k === todayKey ? "outline:2px solid var(--gold);outline-offset:-2px;" : ""}">
                    <div title="${esc(titre)} — ${d.toLocaleDateString("fr-FR")}" style="width:${largeurCol}px;height:${largeurCol}px;margin:0 auto;border-radius:4px;background:${bg};${(weekend || j.ferie) && !abs ? "opacity:.4" : ""};position:relative">
                      ${interv ? `<span style="position:absolute;bottom:-1px;right:-1px;width:5px;height:5px;border-radius:50%;background:var(--violet);box-shadow:0 0 0 1px rgba(0,0,0,.3)" title="Intervention"></span>` : ""}
                    </div>
                  </td>`;
                }).join("")}
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById("pm-retour").addEventListener("click", () => { ui.planningVueMulti = false; renderAll(); });
  document.getElementById("pm-annee").addEventListener("change", (e) => { ui.planningIndivYear = Number(e.target.value); renderAll(); });
  document.getElementById("pm-mois").addEventListener("change", (e) => { ui.planningMultiMoisIdx = Number(e.target.value); renderAll(); });
  container.querySelectorAll("[data-multi-personne]").forEach(chk => chk.addEventListener("change", () => {
    const nom = chk.dataset.multiPersonne;
    if (chk.checked) { if (!ui.planningMultiPersonnes.includes(nom)) ui.planningMultiPersonnes.push(nom); }
    else { ui.planningMultiPersonnes = ui.planningMultiPersonnes.filter(p => p !== nom); }
    renderAll();
  }));
  container.querySelectorAll("[data-binome]").forEach(sel => sel.addEventListener("change", async () => {
    const nom = sel.dataset.binome;
    const choisi = sel.value || null;
    const binomesNext = { ...(state.people.binomes || {}) };
    // Détache l'ancien binôme de `nom` (des deux côtés) avant d'appliquer
    // le nouveau, pour ne jamais laisser un lien à sens unique périmé.
    const ancien = binomesNext[nom];
    if (ancien && binomesNext[ancien] === nom) delete binomesNext[ancien];
    delete binomesNext[nom];
    if (choisi) {
      // Si la personne choisie avait elle-même déjà un autre binôme,
      // on le détache aussi : un binôme est toujours une paire exclusive.
      const anciennePartenaireDeChoisi = binomesNext[choisi];
      if (anciennePartenaireDeChoisi && binomesNext[anciennePartenaireDeChoisi] === choisi) delete binomesNext[anciennePartenaireDeChoisi];
      binomesNext[nom] = choisi;
      binomesNext[choisi] = nom;
    }
    await savePeople({ ...state.people, binomes: binomesNext });
  }));
}

function renderPlanningIndividuel(container, perms) {
  const allPeople = [...new Set([...state.people.n1, ...state.people.n2])];
  if (ui.planningIndivYear === null) ui.planningIndivYear = anneeScolaireCourante();
  if (ui.planningVueMulti) return renderVueMultiPersonnes(container, allPeople);
  if (!ui.planningIndivPerson || !allPeople.includes(ui.planningIndivPerson)) {
    ui.planningIndivPerson = allPeople[0] || null;
  }
  const person = ui.planningIndivPerson;
  const year = ui.planningIndivYear; // année scolaire de départ (year → year+1)
  const todayKey = dateKey(new Date());
  const peutProgrammer = perms.canManageAbsences; // même niveau que la gestion des absences
  const vuePerso = ui.subtab === "mon-planning";

  const debutAnneeScolaire = `${year}-09-01`, finAnneeScolaire = `${year + 1}-08-31`;
  const interventionsParDate = {};
  state.interventions.filter(i => i.technicien === person && i.date >= debutAnneeScolaire && i.date <= finAnneeScolaire).forEach(i => {
    if (!interventionsParDate[i.date]) interventionsParDate[i.date] = [];
    interventionsParDate[i.date].push(i);
  });

  const moisHTML = PLANNING_MOIS_SCOLAIRE.map(({ label, mois: mIdx, decalage }) => {
    const anneeReelle = year + decalage;
    const jours = monthGrid(anneeReelle, mIdx);
    const cells = jours.map(d => {
      const k = dateKey(d);
      const horsMois = d.getMonth() !== mIdx || d.getFullYear() !== anneeReelle;
      const weekend = d.getDay() === 0 || d.getDay() === 6;
      const abs = person ? absenceDuJour(person, k) : null;
      const interventionsJour = person ? (interventionsParDate[k] || []) : [];
      const infoInterv = interventionsJour.length > 0 ? { recurrente: interventionsJour.some(i => i.recurrenceId) } : null;
      const cliquable = person && peutProgrammer && !horsMois && !abs;
      const classes = ["year-cal-day"];
      if (horsMois) classes.push("hors-mois");
      else if (weekend) classes.push("weekend");
      if (abs) classes.push(abs.type === "arret" ? "arret" : abs.type === "rtt" ? "rtt" : "conge");
      if (k === todayKey) classes.push("today");
      if (cliquable) classes.push("clickable");
      const titre = abs ? (abs.type === "arret" ? "Arrêt de travail" : abs.type === "rtt" ? libelleRtt(person) : "Congé") : (cliquable ? (infoInterv ? "Cliquer pour voir/modifier l'intervention" : "Cliquer pour ajouter une intervention ponctuelle") : "");
      const dotTitre = infoInterv ? (infoInterv.recurrente ? "Intervention programmée (récurrence)" : "Intervention") : "";
      return `<div class="${classes.join(" ")}" title="${esc(titre)}" ${cliquable ? `data-date="${k}"` : ""} style="${cliquable ? "cursor:pointer" : ""}">${d.getDate()}${infoInterv ? `<span class="year-cal-dot${infoInterv.recurrente ? " year-cal-dot-recur" : ""}" title="${esc(dotTitre)}"></span>` : ""}</div>`;
    }).join("");
    return `
      <div class="year-cal-month">
        <p class="year-cal-month-title">${label}</p>
        <div class="year-cal-grid year-cal-dow">${["L", "M", "M", "J", "V", "S", "D"].map(j => `<div>${j}</div>`).join("")}</div>
        <div class="year-cal-grid">${cells}</div>
      </div>`;
  }).join("");

  container.innerHTML = `
    <div class="stack">
      ${vuePerso ? `<h3 style="margin:0;font-size:16px;color:var(--gold)">🗓️ Planning de ${esc(person)}</h3>${prochainesInterventionsHTML(person)}` : `<p class="hint">Planning sur une année scolaire (septembre → août), comme l'astreinte : congés, ${libelleRtt(person || "")}, arrêts de travail et jours d'intervention — y compris pour un agent qui n'est pas dans le roulement d'astreinte (ex. l'agent des espaces verts). Les congés/RTT importés depuis un fichier PRTT apparaissent automatiquement ici.</p>`}
      <div class="toolbar">
        ${vuePerso ? "" : `<label>Personne
          <select id="pi-personne">${allPeople.length === 0 ? `<option value="">Aucune personne configurée</option>` : allPeople.map(p => `<option value="${esc(p)}" ${p === person ? "selected" : ""}>${esc(p)}</option>`).join("")}</select>
        </label>`}
        <label>Année scolaire
          <select id="pi-annee">${[year - 1, year, year + 1].map(y => `<option value="${y}" ${y === year ? "selected" : ""}>${y}-${y + 1}</option>`).join("")}</select>
        </label>
        ${vuePerso ? "" : `<button type="button" class="nav-btn" id="pi-vue-multi" style="align-self:flex-end">👥 Voir plusieurs agendas</button>`}
      </div>
      <div class="year-cal-legend">
        <span><i class="year-cal-legend-dot" style="background:var(--gold)"></i> Congé</span>
        <span><i class="year-cal-legend-dot" style="background:var(--teal)"></i> ${esc(libelleRtt(person || ""))}</span>
        <span><i class="year-cal-legend-dot" style="background:var(--red)"></i> Arrêt de travail</span>
        <span><i class="year-cal-legend-dot year-cal-legend-dot-outline"></i> Intervention ponctuelle</span>
        <span><i class="year-cal-legend-dot year-cal-legend-dot-outline year-cal-legend-dot-recur"></i> Intervention programmée (récurrence)</span>
      </div>
      ${!person ? `<p class="hint">Ajoute une personne (N1 ou N2) dans les Coordonnées pour afficher un planning.</p>` : ""}
      ${person && peutProgrammer ? renderRecurrencesPanel(person) : ""}
      ${person ? renderJourDetail(person, ui.planningQuickDate ? (interventionsParDate[ui.planningQuickDate] || []) : []) : ""}
      ${person ? `<div class="year-cal">${moisHTML}</div>` : ""}
    </div>
  `;

  document.getElementById("pi-personne")?.addEventListener("change", (e) => { ui.planningIndivPerson = e.target.value; ui.planningQuickDate = null; ui.planningQuickEditingId = null; ui.recurEditingId = null; renderAll(); });
  document.getElementById("pi-annee")?.addEventListener("change", (e) => { ui.planningIndivYear = Number(e.target.value); renderAll(); });
  document.getElementById("pi-vue-multi")?.addEventListener("click", () => { ui.planningVueMulti = true; renderAll(); });

  if (person && peutProgrammer) {
    document.getElementById("rf-details")?.addEventListener("toggle", (e) => { ui.recurDetailsOpen[person] = e.target.open; });
    attacherSiteSelectorListeners("rf", ui.recurForm);
    document.getElementById("rf-freq")?.addEventListener("change", (e) => { ui.recurForm.frequenceSemaines = Number(e.target.value); });
    document.getElementById("rf-jour")?.addEventListener("change", (e) => { ui.recurForm.jourSemaine = Number(e.target.value); });
    document.getElementById("rf-type")?.addEventListener("input", (e) => { ui.recurForm.type = e.target.value; });
    document.getElementById("rf-heure-debut")?.addEventListener("input", (e) => { ui.recurForm.heureDebut = e.target.value; });
    document.getElementById("rf-heure-fin")?.addEventListener("input", (e) => { ui.recurForm.heureFin = e.target.value; });
    document.getElementById("rf-date-debut")?.addEventListener("change", (e) => { ui.recurForm.dateDebut = e.target.value; });
    document.getElementById("rf-date-fin")?.addEventListener("change", (e) => { ui.recurForm.dateFin = e.target.value; });
    document.getElementById("rf-desc")?.addEventListener("input", (e) => { ui.recurForm.description = e.target.value; });
    document.getElementById("rf-valider")?.addEventListener("click", async () => {
      const statusEl = document.getElementById("rf-status");
      const f = ui.recurForm;
      if (!f.association || !f.site) { statusEl.innerHTML = `<span style="color:var(--red)">Choisis une association et un site.</span>`; return; }
      if (!f.type) { statusEl.innerHTML = `<span style="color:var(--red)">Indique un type d'intervention.</span>`; return; }
      if (!f.dateDebut) { statusEl.innerHTML = `<span style="color:var(--red)">Indique une date de début.</span>`; return; }
      statusEl.innerHTML = `<span style="color:var(--text-dim)">⏳ Enregistrement…</span>`;
      const payload = {
        person, association: f.association, groupe: f.groupe || "", site: f.site, type: f.type,
        heureDebut: f.heureDebut || "", heureFin: f.heureFin || "", description: f.description || "",
        frequenceSemaines: Number(f.frequenceSemaines) || 1, jourSemaine: Number(f.jourSemaine) || 0,
        dateDebut: f.dateDebut, dateFin: f.dateFin || "",
      };
      try {
        if (ui.recurEditingId) {
          await updateRecurrence(ui.recurEditingId, payload);
          ui.recurEditingId = null;
        } else {
          await addRecurrence({ ...payload, createdBy: mountedUser.uid, createdByName: mountedUser.nom || mountedUser.email });
        }
        ui.recurForm = { association: "", groupe: "", site: "", type: "Espaces verts", heureDebut: "", heureFin: "", description: "", frequenceSemaines: 2, jourSemaine: 1, dateDebut: new Date().toISOString().slice(0, 10), dateFin: "" };
        renderAll();
      } catch (e) {
        statusEl.innerHTML = `<span style="color:var(--red)">❌ Échec : ${esc(e.message || String(e))}</span>`;
      }
    });
    document.getElementById("rf-annuler")?.addEventListener("click", () => { ui.recurEditingId = null; renderAll(); });
    container.querySelectorAll("[data-recur-edit]").forEach(btn => btn.addEventListener("click", () => {
      const rec = state.recurrences.find(r => r.id === btn.dataset.recurEdit); if (!rec) return;
      ui.recurEditingId = rec.id;
      ui.recurDetailsOpen[person] = true;
      ui.recurForm = {
        association: rec.association || "", groupe: rec.groupe || "", site: rec.site || "", type: rec.type || "Espaces verts",
        heureDebut: rec.heureDebut || "", heureFin: rec.heureFin || "", description: rec.description || "",
        frequenceSemaines: rec.frequenceSemaines || 1, jourSemaine: rec.jourSemaine || 0,
        dateDebut: rec.dateDebut || new Date().toISOString().slice(0, 10), dateFin: rec.dateFin || "",
      };
      renderAll();
    }));
    container.querySelectorAll("[data-recur-del]").forEach(btn => btn.addEventListener("click", async () => {
      if (!(await window.confirmDialog("Supprimer cette récurrence ? Les interventions déjà générées ne sont pas supprimées.", { danger: true, texteValider: "Supprimer" }))) return;
      await deleteRecurrence(btn.dataset.recurDel);
    }));
    container.querySelectorAll("[data-recur-generer]").forEach(btn => btn.addEventListener("click", async () => {
      const rec = state.recurrences.find(r => r.id === btn.dataset.recurGenerer); if (!rec) return;
      btn.disabled = true; const texteInitial = btn.textContent; btn.textContent = "⏳…";
      try {
        const n = await genererInterventionsRecurrence(rec, mountedUser);
        window.toast(n > 0 ? `${n} intervention${n > 1 ? "s" : ""} générée${n > 1 ? "s" : ""}.` : "Déjà à jour, rien à générer sur les 4 prochains mois.");
      } catch (e) {
        window.toast("Échec de la génération : " + (e.message || e));
      }
      btn.disabled = false; btn.textContent = texteInitial;
    }));
  }

  if (person && peutProgrammer) {
    container.querySelectorAll(".year-cal-day[data-date]").forEach(cell => {
      cell.addEventListener("click", () => {
        const k = cell.dataset.date;
        ui.planningQuickDate = ui.planningQuickDate === k ? null : k;
        ui.planningQuickEditingId = null;
        ui.planningQuickForm = { association: "", groupe: "", site: "", type: "Espaces verts", heureDebut: "", heureFin: "", description: "" };
        renderAll();
      });
    });
  }

  if (ui.planningQuickDate && peutProgrammer) {
    attacherSiteSelectorListeners("qf", ui.planningQuickForm);
    document.getElementById("qf-type")?.addEventListener("input", (e) => { ui.planningQuickForm.type = e.target.value; });
    document.getElementById("qf-heure-debut")?.addEventListener("input", (e) => { ui.planningQuickForm.heureDebut = e.target.value; });
    document.getElementById("qf-heure-fin")?.addEventListener("input", (e) => { ui.planningQuickForm.heureFin = e.target.value; });
    document.getElementById("qf-desc")?.addEventListener("input", (e) => { ui.planningQuickForm.description = e.target.value; });
    document.getElementById("qf-annuler")?.addEventListener("click", () => { ui.planningQuickDate = null; ui.planningQuickEditingId = null; renderAll(); });
    container.querySelectorAll("[data-jour-edit-interv]").forEach(btn => btn.addEventListener("click", () => {
      const i = state.interventions.find(x => x.id === btn.dataset.jourEditInterv); if (!i) return;
      ui.planningQuickEditingId = i.id;
      ui.planningQuickForm = {
        association: i.association || "", groupe: i.groupe || "", site: i.site || "", type: i.type || "Espaces verts",
        heureDebut: i.heureDebut || "", heureFin: i.heureFin || "", description: i.description || "",
      };
      renderAll();
    }));
    container.querySelectorAll("[data-jour-del-interv]").forEach(btn => btn.addEventListener("click", async () => {
      const id = btn.dataset.jourDelInterv;
      const interv = state.interventions.find(i => i.id === id);
      const libelle = interv ? `l'intervention du ${new Date(interv.date).toLocaleDateString("fr-FR")} chez ${interv.site}` : "cette intervention";
      if (!(await window.confirmDialog(`Mettre ${libelle} à la corbeille ? Récupérable pendant 60 jours dans Administration > Corbeille.`, { danger: true, texteValider: "Mettre à la corbeille" }))) return;
      if (ui.planningQuickEditingId === id) ui.planningQuickEditingId = null;
      state.interventions = state.interventions.filter(i => i.id !== id);
      renderAll();
      await envoyerInterventionCorbeille(id);
    }));
    document.getElementById("qf-valider")?.addEventListener("click", async () => {
      const statusEl = document.getElementById("qf-status");
      const f = ui.planningQuickForm;
      if (!f.association || !f.site) { statusEl.innerHTML = `<span style="color:var(--red)">Choisis une association et un site.</span>`; return; }
      if (!f.type) { statusEl.innerHTML = `<span style="color:var(--red)">Indique un type d'intervention.</span>`; return; }
      statusEl.innerHTML = `<span style="color:var(--text-dim)">⏳ Enregistrement…</span>`;
      const duree = dureeHeures(f.heureDebut, f.heureFin);
      try {
        if (ui.planningQuickEditingId) {
          await updateIntervention(ui.planningQuickEditingId, {
            association: f.association, groupe: f.groupe || "", site: f.site, type: f.type,
            heures: duree !== null ? duree : 0, description: f.description || "",
            heureDebut: f.heureDebut || "", heureFin: f.heureFin || "",
            heuresNuit: heuresDeNuit(f.heureDebut, f.heureFin), primeDimanche: estDimanche(ui.planningQuickDate) ? PRIME_DIMANCHE : 0,
          });
          ui.planningQuickEditingId = null;
        } else {
          await addIntervention({
            date: ui.planningQuickDate, technicien: person, association: f.association, groupe: f.groupe || "", site: f.site,
            type: f.type, heures: duree !== null ? duree : 0, description: f.description || "",
            heureDebut: f.heureDebut || "", heureFin: f.heureFin || "",
            heuresNuit: heuresDeNuit(f.heureDebut, f.heureFin), primeDimanche: estDimanche(ui.planningQuickDate) ? PRIME_DIMANCHE : 0,
            photos: [], appelN1: false, n1Contacte: "", motifAppelN1: "", decisionN1: "",
            origine: "planning", // travail programmé depuis le planning individuel, pas une intervention d'astreinte
            createdBy: mountedUser.uid, createdByName: mountedUser.nom || mountedUser.email,
          });
        }
        ui.planningQuickDate = null;
        renderAll();
        window.toast?.("✓ Intervention enregistrée");
      } catch (e) {
        console.error("Intervention planning:", e);
        const msg = e.code === "permission-denied" ? "enregistrement refusé par les règles Firestore (droits du compte connecté)" : (e.message || String(e));
        statusEl.innerHTML = `<span style="color:var(--red)">❌ Échec : ${esc(msg)}</span>`;
        alert("L'intervention n'a PAS été enregistrée : " + msg);
      }
    });
  }
}

function renderCalendar(container, perms) {
  // Une personne peut figurer dans les listes N1/N2 (note de frais,
  // interventions, planning individuel...) sans jamais être tirée au
  // sort dans le roulement d'astreinte (ex. un agent non-astreinte,
  // décoché dans "Noms des personnes") : le calcul du roulement se base
  // sur une version filtrée des listes, jamais sur state.people brut.
  const astreinteActive = state.people.astreinteActive || {};
  const peopleAstreinte = {
    ...state.people,
    n1: state.people.n1.filter(nom => astreinteActive[nom] !== false),
    n2: state.people.n2.filter(nom => astreinteActive[nom] !== false),
  };

  const { titN1, titN2, chargeGlobale } = computeWeeklyTitulaires(peopleAstreinte, state.absences);
  const today = new Date();
  const todayInRange = today >= addDays(YEAR_START, -7) && today <= addDays(YEAR_END, 7);
  const refDate = todayInRange ? today : YEAR_START;
  const n1Today = resolveDayN1(refDate, peopleAstreinte, state.absences, titN1);
  const n2Today = resolveDayN2(refDate, peopleAstreinte, state.absences, titN2);
  const holidayToday = HOLIDAYS.get(dateKey(refDate));
  const next = todayInRange ? nextHandover(refDate, peopleAstreinte, state.absences, titN1, resolveDayN1, 3) : null;
  const confirmedRecord = next ? state.transferts.find(t => t.id === dateKey(next.date)) : null;

  let alertDays = [];
  for (let d = new Date(YEAR_START); d <= YEAR_END; d = addDays(d, 1)) {
    const a = resolveDayN1(d, peopleAstreinte, state.absences, titN1), b = resolveDayN2(d, peopleAstreinte, state.absences, titN2);
    if (a.assigned === "A DÉFINIR" || b.assigned === "A DÉFINIR") alertDays.push(new Date(d));
  }

  const compteurs = {};
  [...peopleAstreinte.n1, ...peopleAstreinte.n2].forEach(p => compteurs[p] = { n1: 0, n2: 0, score: 0 });
  for (let d = new Date(YEAR_START); d <= YEAR_END; d = addDays(d, 1)) {
    const a = resolveDayN1(d, peopleAstreinte, state.absences, titN1), b = resolveDayN2(d, peopleAstreinte, state.absences, titN2);
    if (compteurs[a.assigned]) compteurs[a.assigned].n1++;
    if (compteurs[b.assigned]) compteurs[b.assigned].n2++;
  }
  // "charge" = charge globale équilibrée (N1 + N2, sans double-compter une
  // semaine cumulée par la même personne) — voir computeWeeklyTitulaires.
  Object.entries(chargeGlobale).forEach(([p, s]) => { if (compteurs[p]) compteurs[p].score = s; });

  const monthLabel = new Date(ui.calYear, ui.calMonth, 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  const days = monthGrid(ui.calYear, ui.calMonth);
  const dow = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
  const selected = ui.selectedDate ? new Date(ui.selectedDate) : refDate;
  const selN1 = resolveDayN1(selected, peopleAstreinte, state.absences, titN1);
  const selN2 = resolveDayN2(selected, peopleAstreinte, state.absences, titN2);
  const selHoliday = HOLIDAYS.get(dateKey(selected));

  container.innerHTML = `
    <div class="stack">
      ${transfertBannerHTML(next, confirmedRecord)}
      <div class="hero">
        <div class="hero-label">${todayInRange ? "Astreinte du jour" : "Aperçu — année scolaire"}</div>
        <div class="hero-blocks">
          <div class="hero-block n1">
            <div class="avatar" style="background:${colorForPerson(n1Today.assigned, state.people)}"></div>
            <div><div class="hero-block-label">Niveau 1 · réception</div><div class="hero-block-value">${esc(n1Today.assigned)}</div></div>
          </div>
          <div class="hero-block n2">
            <div class="avatar" style="background:${colorForPerson(n2Today.assigned, state.people)}"></div>
            <div><div class="hero-block-label">Niveau 2 · intervention</div><div class="hero-block-value">${esc(n2Today.assigned)}</div></div>
          </div>
        </div>
        ${holidayToday ? `<div style="margin-top:10px;color:var(--violet);font-size:12px">☀️ ${esc(holidayToday)}</div>` : ""}
      </div>

      ${alertDays.length ? `<div class="alert-banner">⚠️ ${alertDays.length} jour${alertDays.length > 1 ? "s" : ""} à réaffecter manuellement sur l'année.</div>` : ""}

      <div class="stat-row">
        ${Object.entries(compteurs).map(([name, c]) => `<div class="stat-chip" title="Total pondéré : compte les jours de weekend 1,5x et les jours fériés 2x, pour répartir équitablement les astreintes plus difficiles (pas un simple compteur de jours)">${esc(name)} — N1 <b>${c.n1}</b>j · N2 <b>${c.n2}</b>j · total pondéré <b>${c.score.toFixed(1)} j</b></div>`).join("")}
      </div>
      <p style="font-size:11px;color:var(--text-dim);margin:-6px 0 0">ℹ️ N1/N2 = nombre réel de jours d'astreinte assurés. Le "total pondéré" sert à équilibrer le roulement : un jour de weekend compte pour 1,5 jour et un jour férié pour 2 jours (plus contraignants), donc deux personnes avec le même nombre de jours N1+N2 peuvent avoir un total pondéré différent selon qu'elles sont tombées sur plus ou moins de weekends/fériés.</p>

      ${perms.canEditNames ? renderNomsEditor() : ""}

      <div class="cal-card">
        <div class="cal-nav">
          <div class="cal-month-label">${monthLabel}</div>
          <div class="cal-nav-btns">
            <button class="nav-btn" id="cal-prev">‹</button>
            <button class="nav-btn" id="cal-today">Aujourd'hui</button>
            <button class="nav-btn" id="cal-next">›</button>
          </div>
        </div>
        <div class="cal-grid">
          ${dow.map(d => `<div class="cal-dow">${d}</div>`).join("")}
          ${days.map(d => {
            const inMonth = d.getMonth() === ui.calMonth;
            const isToday = sameDay(d, new Date());
            const isSel = sameDay(d, selected);
            const inRange = d >= addDays(YEAR_START, -7) && d <= addDays(YEAR_END, 7);
            const a = inRange ? resolveDayN1(d, peopleAstreinte, state.absences, titN1) : null;
            const b = inRange ? resolveDayN2(d, peopleAstreinte, state.absences, titN2) : null;
            const hol = HOLIDAYS.get(dateKey(d));
            const isAlert = a && b && (a.assigned === "A DÉFINIR" || b.assigned === "A DÉFINIR");
            return `<div class="cal-day ${inMonth ? '' : 'outside'} ${isToday && !isAlert ? 'today' : ''} ${isAlert ? 'alert-day' : ''} ${isSel ? 'selected' : ''}" data-date="${dateKey(d)}">
              ${hol ? '<span class="cal-holiday-dot"></span>' : ''}
              <span class="cal-daynum">${d.getDate()}</span>
              ${a ? `<div class="cal-chips">
                <span class="cal-chip ${a.assigned === 'A DÉFINIR' ? 'def' : ''}" style="${a.assigned !== 'A DÉFINIR' ? `--chip-color:${colorForPerson(a.assigned, state.people)}` : ''}">${a.assigned === 'A DÉFINIR' ? 'N1 à définir' : esc(a.assigned)}</span>
                <span class="cal-chip ${b.assigned === 'A DÉFINIR' ? 'def' : ''}" style="${b.assigned !== 'A DÉFINIR' ? `--chip-color:${colorForPerson(b.assigned, state.people)}` : ''}">${b.assigned === 'A DÉFINIR' ? 'N2 à définir' : esc(b.assigned)}</span>
              </div>` : ""}
            </div>`;
          }).join("")}
        </div>
      </div>

      <div class="day-detail">
        <div class="day-detail-title">${fmtLong(selected)}</div>
        <div class="day-detail-row"><div class="avatar" style="background:${colorForPerson(selN1.assigned, state.people)}"></div> Niveau 1 : <b>${esc(selN1.assigned)}</b>${selN1.manuel ? ` <span class="tag" style="font-size:9px">✋ forcé manuellement</span>` : ""}</div>
        <div class="day-detail-row"><div class="avatar" style="background:${colorForPerson(selN2.assigned, state.people)}"></div> Niveau 2 : <b>${esc(selN2.assigned)}</b>${selN2.manuel ? ` <span class="tag" style="font-size:9px">✋ forcé manuellement</span>` : ""}</div>
        ${selHoliday ? `<div style="color:var(--violet);font-size:12px;margin-top:6px">☀️ ${esc(selHoliday)}</div>` : ""}
        ${perms.isEditor ? `
        <div class="form-grid" style="margin-top:12px">
          <label>Forcer le niveau 1 ce jour<select id="ov-n1"><option value="">— Automatique —</option>${peopleAstreinte.n1.map(p => `<option value="${esc(p)}" ${selN1.manuel && selN1.assigned === p ? "selected" : ""}>${esc(p)}</option>`).join("")}</select></label>
          <label>Forcer le niveau 2 ce jour<select id="ov-n2"><option value="">— Automatique —</option>${peopleAstreinte.n2.map(p => `<option value="${esc(p)}" ${selN2.manuel && selN2.assigned === p ? "selected" : ""}>${esc(p)}</option>`).join("")}</select></label>
        </div>
        <p class="hint" style="margin-top:6px">Utile pour un jour "à définir" (personne dispo automatiquement) ou n'importe quel remplacement ponctuel. Remets sur "— Automatique —" pour revenir au roulement normal. Le reste du roulement (les autres jours) n'est pas affecté.</p>
        ` : ""}
      </div>
    </div>
  `;

  if (perms.canEditNames) {
    attacherNomsEditorListeners(container);
  }
  document.getElementById("cal-prev").addEventListener("click", () => { ui.calMonth--; if (ui.calMonth < 0) { ui.calMonth = 11; ui.calYear--; } renderAll(); });
  document.getElementById("cal-next").addEventListener("click", () => { ui.calMonth++; if (ui.calMonth > 11) { ui.calMonth = 0; ui.calYear++; } renderAll(); });
  document.getElementById("cal-today").addEventListener("click", () => {
    const t = todayInRange ? today : YEAR_START;
    ui.calYear = t.getFullYear(); ui.calMonth = t.getMonth(); ui.selectedDate = dateKey(t); renderAll();
  });
  container.querySelectorAll(".cal-day[data-date]").forEach(cell => {
    cell.addEventListener("click", () => { ui.selectedDate = cell.dataset.date; renderAll(); });
  });

  if (perms.isEditor) {
    const appliquerOverride = async (niveau, valeur) => {
      const dk = dateKey(selected);
      const astreinteOverrides = { ...(state.people.astreinteOverrides || {}) };
      const cur = { ...(astreinteOverrides[dk] || {}) };
      if (valeur) cur[niveau] = valeur; else delete cur[niveau];
      if (Object.keys(cur).length > 0) astreinteOverrides[dk] = cur; else delete astreinteOverrides[dk];
      await savePeople({ ...state.people, astreinteOverrides });
    };
    document.getElementById("ov-n1")?.addEventListener("change", (e) => appliquerOverride("n1", e.target.value));
    document.getElementById("ov-n2")?.addEventListener("change", (e) => appliquerOverride("n2", e.target.value));
  }

  if (clearCountdown) { clearCountdown(); clearCountdown = null; }
  clearCountdown = attachTransfertListeners(container, next, mountedUser, () => renderAll());
}

// =================================================================
// Absences
// =================================================================
function moisDeLAnneeAstreinte() {
  const mois = [];
  let cur = new Date(YEAR_START.getFullYear(), YEAR_START.getMonth(), 1);
  while (cur <= YEAR_END) {
    mois.push({ cle: `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}`, label: cur.toLocaleDateString("fr-FR", { month: "short", year: "2-digit" }), debut: new Date(cur), fin: new Date(cur.getFullYear(), cur.getMonth() + 1, 0) });
    cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
  }
  return mois;
}

// Vue d'ensemble : une ligne par personne, une colonne par mois de
// l'année d'astreinte, jours d'absence de chaque type ce mois-là — pour
// voir en un coup d'œil qui est absent quand, sans dérouler tout le
// tableau détaillé en dessous.
function renderVueEnsembleAbsences(allPeople) {
  const mois = moisDeLAnneeAstreinte();
  return `
    <div class="form-card">
      <h3 style="margin:0 0 10px;font-size:14px;color:var(--gold)">Vue d'ensemble — jours d'absence par mois</h3>
      <div class="table-wrap">
        <table style="font-size:11px">
          <thead><tr><th>Personne</th>${mois.map(m => `<th>${esc(m.label)}</th>`).join("")}</tr></thead>
          <tbody>
            ${allPeople.map(p => `
              <tr>
                <td style="font-weight:700;white-space:nowrap">${esc(p)}</td>
                ${mois.map(m => {
                  const dans = state.absences.filter(a => a.person === p && new Date(a.start) <= m.fin && new Date(a.end) >= m.debut);
                  if (dans.length === 0) return `<td style="color:var(--text-dim)">—</td>`;
                  const parType = {};
                  dans.forEach(a => {
                    const debutEffectif = new Date(Math.max(new Date(a.start), m.debut));
                    const finEffective = new Date(Math.min(new Date(a.end), m.fin));
                    const j = Math.round((finEffective - debutEffectif) / 86400000) + 1;
                    parType[a.type] = (parType[a.type] || 0) + j;
                  });
                  const couleur = parType.arret ? "var(--red)" : parType.conge ? "var(--gold)" : "var(--teal)";
                  const detail = Object.entries(parType).map(([t, j]) => `${j} ${t === "conge" ? "congé" : t === "rtt" ? libelleRtt(p) : "arrêt"}`).join(", ");
                  return `<td style="color:${couleur};font-weight:700" title="${esc(detail)}">${Object.values(parType).reduce((s, v) => s + v, 0)}j</td>`;
                }).join("")}
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderImportPrtt(allPeople) {
  if (!ui.prttPersonne && allPeople.length > 0) ui.prttPersonne = allPeople[0]; // le menu affiche déjà le 1er nom par défaut (comportement natif du <select>) — sans ceci, la variable interne restait vide tant qu'on ne cliquait pas dessus, et cherchait le régime de "" plutôt que de la bonne personne
  return `
    <div class="form-card">
      <button type="button" class="nav-btn" id="prtt-toggle" style="width:fit-content">${ui.prttImportOuvert ? "▲ Fermer l'import PRTT" : "📥 Importer un planning PRTT (Excel)"}</button>
      ${ui.prttImportOuvert ? `
        <p class="hint" style="margin:10px 0">Lit directement le fichier PRTT (planning prévisionnel de modulation, format RH10) pour proposer les jours de congé/RTT à bloquer dans l'astreinte — évite de ressaisir à la main ce qui est déjà dans le planning RH. Les week-ends et jours fériés sont ignorés (une case vide un week-end n'est pas une absence).</p>
        <div class="form-grid">
          <label>Personne concernée<select id="prtt-personne">${allPeople.map(p => `<option value="${esc(p)}" ${ui.prttPersonne === p ? "selected" : ""}>${esc(p)}</option>`).join("")}</select></label>
          <label>Fichier Excel PRTT<input type="file" id="prtt-fichier" accept=".xlsx,.xls"></label>
        </div>
        ${ui.prttNomFichier ? `<p class="hint" style="margin:6px 0 0">📄 ${esc(ui.prttNomFichier)}</p>` : ""}
        ${ui.prttFeuilles.length > 0 ? `
          <label style="display:block;margin-top:8px">Feuille du classeur<select id="prtt-feuille">${ui.prttFeuilles.map(f => `<option value="${esc(f)}" ${ui.prttFeuilleChoisie === f ? "selected" : ""}>${esc(f)}</option>`).join("")}</select></label>
        ` : ""}
        <div id="prtt-status" style="font-size:12px;margin-top:8px"></div>
        ${ui.prttPreview ? renderApercuPrtt() : ""}
      ` : ""}
    </div>
  `;
}

function renderApercuPrtt() {
  if (ui.prttPreview.length === 0) return `<p class="hint" style="margin-top:10px">Aucun jour de congé/RTT détecté sur cette feuille.</p>`;
  return `
    <div style="margin-top:12px">
      <p style="font-size:12px;font-weight:700;margin:0 0 8px">Aperçu — ${ui.prttPreview.length} période(s) proposée(s) pour ${esc(ui.prttPersonne)} (à corriger si besoin avant de valider)</p>
      <div class="table-wrap">
        <table style="font-size:12px">
          <thead><tr><th>Type</th><th>Du</th><th>Au</th><th>Jours</th><th></th></tr></thead>
          <tbody>
            ${ui.prttPreview.map((p, i) => `
              <tr>
                <td><select data-prtt-type="${i}"><option value="conge" ${p.type === "conge" ? "selected" : ""}>Congé</option><option value="rtt" ${p.type === "rtt" ? "selected" : ""}>${libelleRtt(ui.prttPersonne)}</option></select></td>
                <td>${fmtShort(p.start)}</td><td>${fmtShort(p.end)}</td>
                <td>${Math.round((p.end - p.start) / 86400000) + 1}</td>
                <td><button type="button" class="del-btn" data-prtt-retirer="${i}">🗑️</button></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
      <button type="button" class="add-btn" id="prtt-confirmer" style="margin-top:10px">✓ Valider l'import (${ui.prttPreview.length})</button>
    </div>
  `;
}

function renderAbsences(container, perms) {
  const allPeople = [...state.people.n1, ...state.people.n2];
  const totals = {}, totalsRtt = {};
  allPeople.forEach(p => {
    const joursAbs = state.absences.filter(a => a.person === p);
    totals[p] = joursAbs.reduce((s, a) => s + ((new Date(a.end) - new Date(a.start)) / 86400000 + 1), 0);
    totalsRtt[p] = joursAbs.filter(a => a.type === "rtt").reduce((s, a) => s + ((new Date(a.end) - new Date(a.start)) / 86400000 + 1), 0);
  });
  // Origine "PRTT" : marquée par source:"prtt" sur les imports récents, ou
  // par la note historique pour les imports faits avant l'ajout de ce
  // champ — sert à isoler rapidement les congés importés du planning RH
  // (souvent ceux à corriger après coup) plutôt que de les chercher au
  // milieu des absences saisies à la main.
  const estPrtt = (a) => a.source === "prtt" || a.note === "Importé du planning PRTT";
  const sorted = [...state.absences]
    .filter(a => ui.absFiltrePersonne === "Tous" || a.person === ui.absFiltrePersonne)
    .filter(a => ui.absFiltreOrigine === "tous" || (ui.absFiltreOrigine === "prtt" ? estPrtt(a) : !estPrtt(a)))
    .sort((a, b) => (a.start < b.start ? 1 : -1));

  container.innerHTML = `
    <div class="stack">
      <p class="hint">Ajoute une plage de dates précise. Le planning se recalcule automatiquement.</p>
      <div class="stat-row">${allPeople.map(p => `<div class="stat-chip">${esc(p)} : <b>${totals[p]}</b> j${totalsRtt[p] > 0 ? ` (dont <b>${totalsRtt[p]}</b> ${libelleRtt(p)})` : ""}</div>`).join("")}</div>
      ${renderVueEnsembleAbsences(allPeople)}
      ${perms.canManageAbsences ? renderImportPrtt(allPeople) : ""}
      ${perms.canManageAbsences ? `
      <div class="form-card">
        <div class="form-grid">
          <label>Personne<select id="a-person">${allPeople.map(p => `<option value="${esc(p)}" ${ui.absForm.person === p ? 'selected' : ''}>${esc(p)}</option>`).join("")}</select></label>
          <label>Type<select id="a-type"><option value="conge" ${ui.absForm.type === 'conge' ? 'selected' : ''}>Congé</option><option value="rtt" ${ui.absForm.type === 'rtt' ? 'selected' : ''}>${libelleRtt(ui.absForm.person || allPeople[0])}</option><option value="arret" ${ui.absForm.type === 'arret' ? 'selected' : ''}>Arrêt de travail</option></select></label>
          <label>Du<input type="date" id="a-start" value="${esc(ui.absForm.start)}"></label>
          <label>Au<input type="date" id="a-end" value="${esc(ui.absForm.end)}"></label>
          <label class="desc-field">Note<input id="a-note" value="${esc(ui.absForm.note)}" placeholder="optionnel"></label>
        </div>
        <button class="add-btn" id="add-abs">${ui.absEditingId ? "💾 Enregistrer les modifications" : "➕ Ajouter l'absence"}</button>
        ${ui.absEditingId ? `<button type="button" class="nav-btn" id="cancel-abs-edit" style="margin-left:8px">✕ Annuler</button>` : ""}
      </div>` : ""}
      <div class="form-grid" style="margin-top:2px">
        <label>Filtrer par personne<select id="abs-filtre-personne"><option value="Tous">Toutes les personnes</option>${allPeople.map(p => `<option value="${esc(p)}" ${ui.absFiltrePersonne === p ? "selected" : ""}>${esc(p)}</option>`).join("")}</select></label>
        <label>Filtrer par origine<select id="abs-filtre-origine">
          <option value="tous" ${ui.absFiltreOrigine === "tous" ? "selected" : ""}>Toutes origines</option>
          <option value="prtt" ${ui.absFiltreOrigine === "prtt" ? "selected" : ""}>📥 Importées du PRTT uniquement</option>
          <option value="manuel" ${ui.absFiltreOrigine === "manuel" ? "selected" : ""}>Ajoutées manuellement uniquement</option>
        </select></label>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Personne</th><th>Type</th><th>Du</th><th>Au</th><th>Jours</th><th>Note</th>${perms.canManageAbsences ? '<th></th>' : ''}</tr></thead>
          <tbody>
            ${sorted.length === 0 ? `<tr><td colspan="7" class="empty-row">Aucune absence ne correspond à ce filtre.</td></tr>` :
              sorted.map(a => {
                const days = (new Date(a.end) - new Date(a.start)) / 86400000 + 1;
                return `<tr ${ui.absEditingId === a.id ? 'style="outline:2px solid var(--gold);outline-offset:-2px"' : ""}>
                  <td>${esc(a.person)}</td>
                  <td><span class="tag" style="background:${a.type === 'conge' ? 'var(--gold)' : a.type === 'rtt' ? 'var(--teal)' : 'var(--red)'};${a.type !== 'conge' ? 'color:#fff' : ''}">${a.type === 'conge' ? 'Congé' : a.type === 'rtt' ? libelleRtt(a.person) : 'Arrêt'}</span></td>
                  <td>${fmtShort(new Date(a.start))}</td><td>${fmtShort(new Date(a.end))}</td><td>${days}</td>
                  <td>${esc(a.note || "")}${estPrtt(a) ? ` <span class="tag" style="font-size:9px">📥 PRTT</span>` : ""}</td>
                  ${perms.canManageAbsences ? `<td style="white-space:nowrap"><button class="nav-btn" data-edit-abs="${a.id}" style="padding:4px 8px;font-size:11px">✏️</button> <button class="del-btn" data-del="${a.id}">🗑️</button></td>` : ""}
                </tr>`;
              }).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;

  if (perms.canManageAbsences) {
    ["person", "type", "start", "end", "note"].forEach(f => {
      const el = document.getElementById("a-" + f);
      el.addEventListener("input", () => { ui.absForm[f] = el.value; });
      el.addEventListener("change", () => { ui.absForm[f] = el.value; if (f === "person") renderAll(); });
    });
    document.getElementById("abs-filtre-personne")?.addEventListener("change", (e) => { ui.absFiltrePersonne = e.target.value; renderAll(); });
    document.getElementById("abs-filtre-origine")?.addEventListener("change", (e) => { ui.absFiltreOrigine = e.target.value; renderAll(); });
    document.getElementById("add-abs").addEventListener("click", async () => {
      if (!ui.absForm.start || !ui.absForm.end) return;
      if (!isPlausibleDate(ui.absForm.start) || !isPlausibleDate(ui.absForm.end)) {
        window.toast("Une des dates saisies semble incorrecte (année incomplète) — vérifie et retape-la entièrement.");
        return;
      }
      if (ui.absForm.end < ui.absForm.start) { window.toast("La date de fin doit être après la date de début."); return; }
      if (ui.absEditingId) {
        await updateAbsence(ui.absEditingId, { person: ui.absForm.person, type: ui.absForm.type, start: ui.absForm.start, end: ui.absForm.end, note: ui.absForm.note });
        ui.absEditingId = null;
      } else {
        await addAbsence({ person: ui.absForm.person, type: ui.absForm.type, start: ui.absForm.start, end: ui.absForm.end, note: ui.absForm.note, createdBy: mountedUser.uid });
      }
      ui.absForm.note = "";
      renderAll();
    });
    document.getElementById("cancel-abs-edit")?.addEventListener("click", () => {
      ui.absEditingId = null;
      ui.absForm = { person: ui.absForm.person, start: new Date().toISOString().slice(0, 10), end: new Date().toISOString().slice(0, 10), type: "conge", note: "" };
      renderAll();
    });
    container.querySelectorAll("[data-edit-abs]").forEach(btn => {
      btn.addEventListener("click", () => {
        const a = state.absences.find(x => x.id === btn.dataset.editAbs);
        if (!a) return;
        ui.absEditingId = a.id;
        ui.absForm = { person: a.person, type: a.type, start: a.start, end: a.end, note: a.note || "" };
        renderAll();
        mountedContainer.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
    container.querySelectorAll("[data-del]").forEach(btn => {
      btn.addEventListener("click", async () => { await deleteAbsence(btn.dataset.del); });
    });
  }
  attacherImportPrttListeners(container);
}

function attacherImportPrttListeners(container) {
  document.getElementById("prtt-toggle")?.addEventListener("click", () => { ui.prttImportOuvert = !ui.prttImportOuvert; renderAll(); });
  document.getElementById("prtt-personne")?.addEventListener("change", (e) => { ui.prttPersonne = e.target.value; });
  document.getElementById("prtt-fichier")?.addEventListener("change", async (e) => {
    const fichier = e.target.files[0];
    const statusEl = document.getElementById("prtt-status");
    if (!fichier) return;
    if (!window.XLSX) { statusEl.innerHTML = `<span style="color:var(--red)">Librairie Excel non chargée.</span>`; return; }
    statusEl.innerHTML = `<span style="color:var(--text-dim)">⏳ Lecture du fichier…</span>`;
    try {
      const buffer = await fichier.arrayBuffer();
      const wb = window.XLSX.read(buffer, { type: "array", cellDates: true });
      ui.prttWorkbook = wb;
      ui.prttNomFichier = fichier.name;
      const candidates = listerFeuillesCandidates(wb);
      ui.prttFeuilles = candidates.length > 0 ? candidates : wb.SheetNames;
      ui.prttFeuilleChoisie = ui.prttFeuilles[ui.prttFeuilles.length - 1]; // la feuille nominative est généralement la dernière du classeur
      // Calcule tout de suite l'aperçu pour cette feuille par défaut —
      // sans ça, rien ne s'affiche tant que l'utilisateur ne change pas
      // manuellement la feuille (l'événement "change" du menu déroulant
      // ne se déclenche pas juste parce qu'on l'a présélectionnée).
      ui.prttPreview = analyserPlanningPrtt(wb.Sheets[ui.prttFeuilleChoisie], window.XLSX);
      statusEl.innerHTML = "";
      renderAll();
    } catch (err) {
      statusEl.innerHTML = `<span style="color:var(--red)">❌ ${esc(err.message || String(err))}</span>`;
    }
  });
  document.getElementById("prtt-feuille")?.addEventListener("change", (e) => {
    ui.prttFeuilleChoisie = e.target.value;
    const statusEl = document.getElementById("prtt-status");
    try {
      const sheet = ui.prttWorkbook.Sheets[ui.prttFeuilleChoisie];
      ui.prttPreview = analyserPlanningPrtt(sheet, window.XLSX);
      statusEl.innerHTML = "";
    } catch (err) {
      statusEl.innerHTML = `<span style="color:var(--red)">❌ ${esc(err.message || String(err))}</span>`;
      ui.prttPreview = null;
    }
    renderAll();
  });
  container.querySelectorAll("[data-prtt-type]").forEach(sel => sel.addEventListener("change", () => {
    ui.prttPreview[parseInt(sel.dataset.prttType, 10)].type = sel.value;
  }));
  container.querySelectorAll("[data-prtt-retirer]").forEach(btn => btn.addEventListener("click", () => {
    ui.prttPreview.splice(parseInt(btn.dataset.prttRetirer, 10), 1);
    renderAll();
  }));
  document.getElementById("prtt-confirmer")?.addEventListener("click", async () => {
    const statusEl = document.getElementById("prtt-status");
    statusEl.innerHTML = `<span style="color:var(--text-dim)">⏳ Import en cours…</span>`;
    try {
      for (const p of ui.prttPreview) {
        await addAbsence({
          person: ui.prttPersonne, type: p.type,
          start: p.start.toISOString().slice(0, 10), end: p.end.toISOString().slice(0, 10),
          note: "Importé du planning PRTT", source: "prtt", createdBy: mountedUser.uid,
        });
      }
      window.toast(`${ui.prttPreview.length} période(s) importée(s).`, "success");
      ui.prttPreview = null; ui.prttFeuilles = []; ui.prttWorkbook = null; ui.prttImportOuvert = false; ui.prttNomFichier = "";
      renderAll();
    } catch (err) {
      statusEl.innerHTML = `<span style="color:var(--red)">❌ ${esc(err.message || String(err))}</span>`;
    }
  });
}

// =================================================================
// Interventions
// =================================================================
function renderDocPreview() {
  const filtered = state.interventions
    .filter(i => ui.docForm.person === "Tous" || i.technicien === ui.docForm.person)
    .filter(i => i.date >= ui.docForm.start && i.date <= ui.docForm.end)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const total = filtered.reduce((s, i) => s + (i.heures || 0), 0);
  const totalNuit = filtered.reduce((s, i) => s + (i.heuresNuit || 0), 0);
  const totalPrimes = filtered.reduce((s, i) => s + (i.primeDimanche || 0), 0);

  return `
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <button class="add-btn" id="doc-print">🖨️ Exporter en PDF (imprimer)</button>
      <button class="nav-btn" id="doc-valider" style="border-color:var(--teal)">✅ Valider ce relevé (transmis au manager)</button>
      <button class="nav-btn" id="doc-close">✕ Fermer l'aperçu</button>
    </div>
    <div id="doc-valid-status" style="font-size:12px;margin:6px 0"></div>
    <div class="print-fiche" id="doc-print-fiche" style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:24px;color:#111">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:18px">
        <img src="img/logo-etablieres.png" alt="Groupe Établières" style="height:60px">
        <span style="font-size:13px">Le ${fmtShort(new Date())}</span>
      </div>
      <p style="font-size:14px;margin:0 0 6px">RELEVÉ D'HEURES SUPPLÉMENTAIRES — ASTREINTE</p>
      <p style="font-size:13px;margin:0 0 6px">Intervenant : ${esc(ui.docForm.person)}</p>
      <p style="font-size:13px;margin:0 0 18px">Période du ${fmtShort(new Date(ui.docForm.start))} au ${fmtShort(new Date(ui.docForm.end))}</p>

      <table style="width:100%;border-collapse:collapse;margin-bottom:8px">
        <thead><tr>
          <th style="border:1px solid #999;padding:4px 6px;font-size:11px;text-align:left">N°</th>
          <th style="border:1px solid #999;padding:4px 6px;font-size:11px;text-align:left">Date</th>
          <th style="border:1px solid #999;padding:4px 6px;font-size:11px;text-align:left">Intervenant</th>
          <th style="border:1px solid #999;padding:4px 6px;font-size:11px;text-align:left">Site</th>
          <th style="border:1px solid #999;padding:4px 6px;font-size:11px;text-align:left">Type</th>
          <th style="border:1px solid #999;padding:4px 6px;font-size:11px;text-align:center">Arrivée</th>
          <th style="border:1px solid #999;padding:4px 6px;font-size:11px;text-align:center">Retour</th>
          <th style="border:1px solid #999;padding:4px 6px;font-size:11px;text-align:left">Compte-rendu</th>
          <th style="border:1px solid #999;padding:4px 6px;font-size:11px;text-align:center">Heures totales</th>
          <th style="border:1px solid #999;padding:4px 6px;font-size:11px;text-align:center">Dont nuit</th>
          <th style="border:1px solid #999;padding:4px 6px;font-size:11px;text-align:center">Prime dim.</th>
        </tr></thead>
        <tbody>
          ${filtered.length === 0 ? `<tr><td colspan="11" style="border:1px solid #999;padding:8px;text-align:center;font-size:12px">Aucune intervention sur cette période.</td></tr>` :
            filtered.map(i => `
              <tr>
                <td style="border:1px solid #999;padding:4px 6px;font-size:10px;font-family:ui-monospace,monospace">${esc(i.numero || "—")}</td>
                <td style="border:1px solid #999;padding:4px 6px;font-size:11px">${new Date(i.date).toLocaleDateString("fr-FR")}</td>
                <td style="border:1px solid #999;padding:4px 6px;font-size:11px">${esc(i.technicien)}</td>
                <td style="border:1px solid #999;padding:4px 6px;font-size:11px">${esc(i.site)}</td>
                <td style="border:1px solid #999;padding:4px 6px;font-size:11px">${esc(i.type)}</td>
                <td style="border:1px solid #999;padding:4px 6px;font-size:11px;text-align:center">${esc(i.heureDebut || "—")}</td>
                <td style="border:1px solid #999;padding:4px 6px;font-size:11px;text-align:center">${esc(i.heureFin || "—")}</td>
                <td style="border:1px solid #999;padding:4px 6px;font-size:11px">${esc(i.description)}</td>
                <td style="border:1px solid #999;padding:4px 6px;font-size:11px;text-align:center">${i.heures}</td>
                <td style="border:1px solid #999;padding:4px 6px;font-size:11px;text-align:center">${i.heuresNuit > 0 ? i.heuresNuit.toFixed(2) + "h" : "—"}</td>
                <td style="border:1px solid #999;padding:4px 6px;font-size:11px;text-align:center">${i.primeDimanche > 0 ? "+" + i.primeDimanche + "€" : ""}</td>
              </tr>`).join("")}
        </tbody>
        <tfoot>
          <tr style="font-weight:700">
            <td colspan="8" style="border:1px solid #999;padding:4px 6px;font-size:12px;text-align:right">Total</td>
            <td style="border:1px solid #999;padding:4px 6px;font-size:12px;text-align:center">${total.toFixed(2)} h</td>
            <td style="border:1px solid #999;padding:4px 6px;font-size:12px;text-align:center">${totalNuit.toFixed(2)} h</td>
            <td style="border:1px solid #999;padding:4px 6px;font-size:12px;text-align:center">${totalPrimes > 0 ? totalPrimes + "€" : "0€"}</td>
          </tr>
        </tfoot>
      </table>
      <p style="font-size:10px;color:#666;margin-bottom:12px">« Dont nuit » = la part des heures totales effectuée entre 21h et 6h (déjà comptée dans le total, pas en plus — sert juste à repérer la majoration nuit à appliquer). Calcul indicatif, à valider avec la convention collective. Prime dimanche : ${PRIME_DIMANCHE}€ par jour d'intervention un dimanche avec déplacement (pas de prime pour une astreinte traitée par téléphone).</p>

      <div style="margin-top:36px;display:flex;justify-content:space-between;font-size:12px">
        <span>Signature salarié</span>
        <span>Signature manager (validation pour paiement)</span>
      </div>
    </div>
  `;
}

// Galerie photo du formulaire d'intervention — même mécanisme que les
// autres galeries de l'appli (caméra + fichier), utile pour garder une
// preuve visuelle d'un dépannage (avant/après, pièce changée...).
// Bloc "Appel au N1" — apparaît quand la case est cochée, pour tracer
// les escalades du technicien vers le cadre d'astreinte (qui, pourquoi,
// quelle décision/consigne a été donnée).
function appelN1HTML() {
  if (!ui.form.appelN1) return "";
  return `
    <div class="form-grid" style="margin-top:8px;padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--panel-alt)">
      <label>N1 contacté
        <select id="f-n1-contacte">
          <option value="">— Choisir —</option>
          ${state.people.n1.map(nom => `<option value="${esc(nom)}" ${ui.form.n1Contacte === nom ? "selected" : ""}>${esc(nom)}</option>`).join("")}
        </select>
      </label>
      <label>Motif de l'appel<input id="f-motif-n1" value="${esc(ui.form.motifAppelN1)}" placeholder="ex. besoin d'un accord pour commander une pièce"></label>
      <label class="desc-field">Décision / consigne donnée<input id="f-decision-n1" value="${esc(ui.form.decisionN1)}" placeholder="ex. accord donné, intervention d'une entreprise externe demandée…"></label>
    </div>
  `;
}

function attacherEcouteursAppelN1() {
  document.getElementById("f-n1-contacte")?.addEventListener("change", (e) => { ui.form.n1Contacte = e.target.value; });
  document.getElementById("f-motif-n1")?.addEventListener("input", (e) => { ui.form.motifAppelN1 = e.target.value; });
  document.getElementById("f-decision-n1")?.addEventListener("input", (e) => { ui.form.decisionN1 = e.target.value; });
}

function interventionPhotosHTML() {
  const photos = ui.form.photos || [];
  return `
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px">
      ${photos.map((p, pi) => `
        <div style="position:relative">
          ${p.itemId
            ? `<img data-resolve-img-interv="${esc(p.itemId)}" alt="" style="width:64px;height:64px;object-fit:cover;border-radius:8px;border:1px solid var(--border);background:var(--panel-alt)" onerror="this.style.opacity=0.3">`
            : `<img src="${esc(p.url)}" alt="" style="width:64px;height:64px;object-fit:cover;border-radius:8px;border:1px solid var(--border)" onerror="this.style.opacity=0.3">`}
          <button data-del-interv-photo="${pi}" style="position:absolute;top:-6px;right:-6px;background:var(--red);color:#fff;border:none;border-radius:50%;width:18px;height:18px;font-size:10px;cursor:pointer;line-height:1">✕</button>
        </div>
      `).join("")}
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button type="button" class="nav-btn" id="interv-photo-camera" style="font-size:12px">📷 Prendre une photo</button>
      <button type="button" class="nav-btn" id="interv-photo-file" style="font-size:12px">📎 Importer un fichier</button>
      <input type="file" accept="image/*" capture="environment" id="interv-photo-input-camera" style="display:none">
      <input type="file" id="interv-photo-input-file" style="display:none">
    </div>
    <div id="interv-photo-status" style="font-size:11px;margin-top:4px"></div>
  `;
}

function attacherPhotosInterventionListeners() {
  const inputCamera = document.getElementById("interv-photo-input-camera");
  const inputFile = document.getElementById("interv-photo-input-file");
  const statusEl = document.getElementById("interv-photo-status");
  if (!inputCamera) return;

  const declencherSelecteur = async (input) => {
    statusEl.innerHTML = `<span style="color:var(--text-dim)">⏳ Connexion…</span>`;
    try {
      const token = await getAccessToken(); // en réaction directe au clic, sinon bloqué par le navigateur
      statusEl.innerHTML = "";
      input.dataset.readyToken = token;
      input.click();
    } catch (e) {
      statusEl.innerHTML = `<span style="color:var(--red)">❌ ${esc(e.message || String(e))}</span>`;
    }
  };
  document.getElementById("interv-photo-camera").addEventListener("click", () => declencherSelecteur(inputCamera));
  document.getElementById("interv-photo-file").addEventListener("click", () => declencherSelecteur(inputFile));

  [inputCamera, inputFile].forEach(input => input.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    statusEl.innerHTML = `<span style="color:var(--text-dim)">⏳ Envoi de la photo…</span>`;
    try {
      const dossierSegments = [ui.form.site || "Site non renseigné", "Interventions", `${ui.form.date || "date"} - ${ui.form.type || "Intervention"}`];
      const { url, itemId, isImage, name } = await uploadToDrive(file, e.target.dataset.readyToken, dossierSegments, DOSSIERS_ROOT_FOLDER);
      ui.form.photos = [...(ui.form.photos || []), { url, itemId, isImage, name }];
      renderAll();
    } catch (err) {
      statusEl.innerHTML = `<span style="color:var(--red)">❌ Échec : ${esc(err.message || String(err))}</span>`;
    }
  }));

  document.querySelectorAll("[data-del-interv-photo]").forEach(btn => btn.addEventListener("click", async () => {
    const pi = parseInt(btn.dataset.delIntervPhoto, 10);
    const photo = (ui.form.photos || [])[pi];
    if (!photo) return;
    if (!confirm(`Supprimer définitivement "${photo.name || 'cette photo'}" ?`)) return;
    if (photo.itemId) {
      try { await deleteDriveItem(photo.itemId); } catch (e) { window.toast("Échec de la suppression sur SharePoint : " + (e.message || e)); return; }
    }
    ui.form.photos = (ui.form.photos || []).filter((_, i) => i !== pi);
    renderAll();
  }));

  document.querySelectorAll("[data-resolve-img-interv]").forEach(async (img) => {
    try { img.src = await getImageDisplayUrl(img.dataset.resolveImgInterv); } catch (e) { img.style.opacity = "0.3"; }
  });
}

function renderInterventions(container, perms) {
  const intervenants = [...state.people.n1, ...state.people.n2];
  if (!ui.form.technicien && intervenants.length > 0 && !ui.form.appelN1) ui.form.technicien = intervenants[0];
  const sorted = [...state.interventions].sort((a, b) => (a.date < b.date ? 1 : -1));
  // Détection des N° d'intervention en double (ex. INT-00013 attribué deux
  // fois) : ça n'arrive plus tout seul depuis le contrôle d'unicité ajouté
  // sur la correction manuelle Super Admin, mais on continue de le signaler
  // clairement s'il en reste (données déjà en double avant ce correctif).
  const compteNumeros = {};
  sorted.forEach(i => { if (i.numero) compteNumeros[i.numero] = (compteNumeros[i.numero] || 0) + 1; });
  const numerosEnDouble = Object.keys(compteNumeros).filter(n => compteNumeros[n] > 1);
  const isLockedTech = perms.isTech && !perms.isEditor;

  const currentAssoc = state.associations.find(a => a.nom === ui.form.association);
  const groupesDispo = currentAssoc ? [...new Set(currentAssoc.sites.filter(s => s.groupe).map(s => s.groupe))] : [];
  const hasSansGroupe = currentAssoc ? currentAssoc.sites.some(s => !s.groupe) : false;
  const assocSelected = currentAssoc ? { groupes: groupesDispo, hasOnlyGrouped: groupesDispo.length > 0 && !hasSansGroupe } : null;
  const sitesForSiteSelect = currentAssoc
    ? currentAssoc.sites.filter(s => ui.form.groupe ? s.groupe === ui.form.groupe : !s.groupe)
    : [];

  container.innerHTML = `
    <div class="stack">
      ${perms.canLogIntervention ? `
      <div class="form-card">
        <div class="form-grid">
          <label>Date<input type="date" id="f-date" value="${esc(ui.form.date)}"></label>
          ${ui.editingId && mountedUser.role === "super_admin" ? `
          <label>N° d'intervention (Super Admin)<input id="f-numero" value="${esc(ui.form.numero || "")}" placeholder="INT-00042" style="font-family:ui-monospace,monospace"></label>` : ""}
          <label>Intervenant
            ${isLockedTech
              ? `<input value="${esc(ui.form.technicien)}" disabled>`
              : `<select id="f-tech"><option value="" ${!ui.form.technicien ? 'selected' : ''}>${ui.form.appelN1 ? "— Aucun (appel N1 seul) —" : "— Choisir —"}</option>${intervenants.map(t => `<option value="${esc(t)}" ${ui.form.technicien === t ? 'selected' : ''}>${esc(t)}</option>`).join("")}</select>`}
          </label>
          <label>Association
            <select id="f-association">
              <option value="">— Choisir —</option>
              ${state.associations.map(a => `<option value="${esc(a.nom)}" ${ui.form.association === a.nom ? 'selected' : ''}>${esc(a.nom)}</option>`).join("")}
            </select>
          </label>
          ${groupesDispo.length > 0 ? `
          <label>Sous-service
            <select id="f-groupe">
              ${hasSansGroupe ? `<option value="" ${!ui.form.groupe ? 'selected' : ''}>— Aucun —</option>` : `<option value="">— Choisir —</option>`}
              ${groupesDispo.map(g => `<option value="${esc(g)}" ${ui.form.groupe === g ? 'selected' : ''}>${esc(g)}</option>`).join("")}
            </select>
          </label>` : ""}
          <label>Site
            <select id="f-site" ${(!ui.form.association || (assocSelected?.groupes.length && !ui.form.groupe && assocSelected?.hasOnlyGrouped)) ? 'disabled' : ''}>
              <option value="">— Choisir —</option>
              ${sitesForSiteSelect.map(s => `<option value="${esc(s.nom)}" ${ui.form.site === s.nom ? 'selected' : ''}>${esc(s.nom)}</option>`).join("")}
            </select>
          </label>
          <label>Type<input id="f-type" list="types" value="${esc(ui.form.type)}" placeholder="ex. Plomberie"><datalist id="types">${TYPE_SUGGESTIONS.map(t => `<option value="${esc(t)}">`).join("")}</datalist></label>
          <label>Heures<input type="number" step="0.25" min="0" id="f-heures" value="${esc(ui.form.heures)}" placeholder="calculé automatiquement"></label>
          <label>Heure de départ<input type="time" id="f-heure-debut" value="${esc(ui.form.heureDebut)}"></label>
          <label>Heure de retour<input type="time" id="f-heure-fin" value="${esc(ui.form.heureFin)}"></label>
          <label class="desc-field">Description<input id="f-desc" value="${esc(ui.form.description)}" placeholder="détail rapide"></label>
        </div>
        <label style="display:flex;align-items:center;gap:6px;font-size:12px;margin-top:10px">
          <input type="checkbox" id="f-sans-deplacement" ${ui.form.sansDeplacement ? "checked" : ""} style="width:16px;height:16px;accent-color:var(--gold)">
          ☎️ Traité par téléphone / à distance, <b>sans déplacement</b> (pas de prime dimanche)
        </label>
        <label style="display:flex;align-items:center;gap:6px;font-size:12px;margin-top:6px">
          <input type="checkbox" id="f-appel-n1" ${ui.form.appelN1 ? "checked" : ""} style="width:16px;height:16px;accent-color:var(--gold)">
          📞 Appel passé au N1 pendant cette intervention (escalade, décision, consigne)
        </label>
        <div id="interv-n1-zone">${appelN1HTML()}</div>
        <label style="display:block;font-size:11px;color:var(--text-dim);margin-top:8px">Photo(s) du dépannage (optionnel)</label>
        <div id="interv-photo-zone">${interventionPhotosHTML()}</div>
        <div id="interv-nuit-indicator">${nuitIndicatorHTML()}</div>
        <button class="add-btn" id="add-interv">${ui.editingId ? "💾 Enregistrer les modifications" : "➕ Ajouter l'intervention"}</button>
        ${ui.editingId ? `<button class="nav-btn" id="cancel-edit" style="margin-left:8px">✕ Annuler</button>` : ""}
        <div id="interv-status" style="margin-top:8px;font-size:12px"></div>
      </div>` : ""}

      ${perms.isEditor ? `
      <div class="form-card">
        <h3 style="margin:0 0 10px;font-size:14px;color:var(--gold)">Générer un relevé d'heures supplémentaires</h3>
        <div class="form-grid">
          <label>Intervenant<select id="doc-person"><option value="Tous" ${ui.docForm.person === 'Tous' ? 'selected' : ''}>Tous</option>${intervenants.map(t => `<option value="${esc(t)}" ${ui.docForm.person === t ? 'selected' : ''}>${esc(t)}</option>`).join("")}</select></label>
          <label>Du<input type="date" id="doc-start" value="${esc(ui.docForm.start)}"></label>
          <label>Au<input type="date" id="doc-end" value="${esc(ui.docForm.end)}"></label>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
          <button class="nav-btn" data-period="mois" style="padding:5px 12px;font-size:11px">Ce mois-ci</button>
          <button class="nav-btn" data-period="3mois" style="padding:5px 12px;font-size:11px">3 derniers mois</button>
          <button class="nav-btn" data-period="annee" style="padding:5px 12px;font-size:11px">Année en cours</button>
          <button class="nav-btn" data-period="scolaire" style="padding:5px 12px;font-size:11px">Année scolaire (01/09 → 31/08)</button>
          <button class="nav-btn" data-period="tout" style="padding:5px 12px;font-size:11px">Toute la période</button>
        </div>
        <button class="add-btn" id="doc-generate">📄 Générer le document</button>
      </div>
      ${ui.docForm.generated ? renderDocPreview() : ""}
      ` : ""}

      ${numerosEnDouble.length > 0 && perms.isEditor ? `
      <div class="form-card" style="border:1px solid var(--red);background:rgba(230,80,80,.08)">
        <p style="margin:0;font-size:12px;color:var(--red)">⚠️ <b>${numerosEnDouble.length} numéro${numerosEnDouble.length > 1 ? "s" : ""} d'intervention en double</b> : ${numerosEnDouble.map(esc).join(", ")}. Les lignes concernées sont surlignées ci-dessous. Ouvre l'une des deux interventions (✏️) et attribue-lui un numéro libre via le champ "N° d'intervention (Super Admin)".</p>
      </div>` : ""}
      <div class="table-wrap">
        <table>
          <thead><tr><th>N°</th><th>Date</th><th>Intervenant</th><th>Site</th><th>Type</th><th>Heures</th><th>Description</th><th>Primes</th>${perms.isEditor ? '<th>Transmis au manager</th>' : ''}<th></th></tr></thead>
          <tbody>
            ${sorted.length === 0 ? `<tr><td colspan="10" class="empty-row">Aucune intervention enregistrée.</td></tr>` :
              sorted.map(i => {
                const canDelete = perms.isEditor || i.createdBy === mountedUser.uid;
                const repos = analyseReposIntervention(i, state.interventions);
                const enDouble = i.numero && numerosEnDouble.includes(i.numero);
                const reposHTML = repos && (repos.decalageNecessaire || repos.violee) ? `
                  <br><span class="tag" style="background:${repos.violee ? "var(--red)" : "var(--gold)"};${repos.violee ? "color:#fff" : "color:#1A1305"};font-size:10px" title="Repos quotidien de 11h consécutives (art. L3121-10 du Code du travail) — calcul indicatif">
                    ${repos.violee ? "⚠️ Repos 11h non respecté" : "🛌 Reprise possible seulement à partir du"} ${fmtHeureJour(repos.reposJusqua)}
                  </span>` : "";
                return `<tr ${enDouble ? 'style="background:rgba(230,80,80,.12)"' : ""}>
                  <td style="font-family:ui-monospace,monospace;font-size:11px;color:${enDouble ? "var(--red)" : "var(--text-dim)"}">${esc(i.numero || "—")}${enDouble ? ` <span title="Numéro attribué à plusieurs interventions">⚠️</span>` : ""}</td>
                  <td>${new Date(i.date).toLocaleDateString("fr-FR")}</td><td>${esc(i.technicien)}</td><td>${esc(i.site)}</td><td>${esc(i.type)}</td>
                  <td>${i.heures} h</td><td>${i.description ? esc(i.description) : ""}${i.appelN1 ? `${i.description ? "<br>" : ""}<span style="font-size:12px">📞 <b>Appel N1 (${esc(i.n1Contacte || "—")})</b> — ${esc(i.motifAppelN1 || "")}${i.decisionN1 ? ` → ${esc(i.decisionN1)}` : ""}</span>` : ""}${(i.photos || []).length ? ` <button class="nav-btn" data-voir-photos-interv="${i.id}" style="padding:2px 6px;font-size:10px">📷 ${i.photos.length}</button>` : ""}${reposHTML}</td>
                  <td style="white-space:nowrap">
                    ${i.heuresNuit > 0 ? `<span class="tag" style="background:#3A3160;font-size:9px">🌙 ${i.heuresNuit.toFixed(2)}h</span> ` : ""}
                    ${i.primeDimanche > 0 ? `<span class="tag" style="background:#8F5FBF;font-size:9px">🌞 +${i.primeDimanche}€</span>` : ""}
                    ${i.sansDeplacement ? `<span class="tag" style="background:#5A6070;font-size:9px">☎️ Sans déplacement</span>` : ""}
                  </td>
                  ${perms.isEditor ? `<td>${i.transmis
                    ? `<span class="tag" style="background:var(--teal);font-size:9px">✓ Dans un relevé validé</span>${mountedUser.role === "super_admin" ? ` <button class="nav-btn" data-remettre-attente="${i.id}" style="padding:2px 6px;font-size:9px;margin-left:4px">🔓 Débloquer</button>` : ""}`
                    : `<span style="color:var(--text-dim);font-size:11px">En attente</span>`}</td>` : ''}
                  <td>${canDelete ? `<button class="nav-btn" data-edit="${i.id}" style="padding:4px 8px;font-size:11px">✏️</button> <button class="del-btn" data-del="${i.id}">🗑️</button>` : ""}${perms.isEditor ? ` <button class="nav-btn" data-note-frais-ligne="${i.id}" style="padding:4px 8px;font-size:11px" title="Générer la note de frais du mois de cette intervention">🖨️</button>` : ""}</td>
                </tr>
                ${ui.noteFraisPreview && ui.noteFraisPreview.declencheePar === i.id ? `<tr><td colspan="10" style="padding:0;border:none">${renderApercuNoteFrais()}</td></tr>` : ""}
                `;
              }).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;

  if (perms.canLogIntervention) {
    attacherPhotosInterventionListeners();
    attacherEcouteursAppelN1();
    document.getElementById("f-sans-deplacement")?.addEventListener("change", (e) => { ui.form.sansDeplacement = e.target.checked; });
    document.getElementById("f-appel-n1")?.addEventListener("change", (e) => {
      ui.form.appelN1 = e.target.checked;
      document.getElementById("interv-n1-zone").innerHTML = appelN1HTML();
      attacherEcouteursAppelN1();
    });
    ["type", "heures", "desc"].forEach(field => {
      const el = document.getElementById("f-" + field); if (!el) return;
      el.addEventListener("input", () => { const key = field === "desc" ? "description" : field; ui.form[key] = el.value; });
    });
    document.getElementById("f-numero")?.addEventListener("input", (e) => { ui.form.numero = e.target.value; });
    document.getElementById("f-date").addEventListener("change", (e) => {
      // On accepte toujours ce qui est tapé, même une valeur intermédiaire
      // improbable en cours de frappe — la remettre de force à l'ancienne
      // valeur ici empêchait de taper une nouvelle date au clavier
      // (le champ se réinitialisait avant que l'année soit complète).
      // La vérification a lieu seulement au moment d'utiliser la date.
      ui.form.date = e.target.value;
      const indicator = document.getElementById("interv-nuit-indicator");
      if (indicator) indicator.innerHTML = nuitIndicatorHTML();
    });
    function onHeureChange() {
      // Mise à jour ciblée seulement (pas de renderAll) : un ré-affichage
      // complet du formulaire à chaque frappe faisait perdre le focus du
      // champ et provoquait des bugs de saisie sur les heures.
      ui.form.heureDebut = document.getElementById("f-heure-debut").value;
      ui.form.heureFin = document.getElementById("f-heure-fin").value;
      const indicator = document.getElementById("interv-nuit-indicator");
      if (indicator) indicator.innerHTML = nuitIndicatorHTML();
      const duree = dureeHeures(ui.form.heureDebut, ui.form.heureFin);
      if (duree !== null) {
        ui.form.heures = String(duree);
        const heuresInput = document.getElementById("f-heures");
        if (heuresInput) heuresInput.value = duree;
      }
    }
    document.getElementById("f-heure-debut").addEventListener("input", onHeureChange);
    document.getElementById("f-heure-fin").addEventListener("input", onHeureChange);
    document.getElementById("f-association").addEventListener("change", (e) => {
      ui.form.association = e.target.value;
      ui.form.groupe = "";
      ui.form.site = "";
      renderAll();
    });
    document.getElementById("f-groupe")?.addEventListener("change", (e) => {
      ui.form.groupe = e.target.value;
      ui.form.site = "";
      renderAll();
    });
    document.getElementById("f-site").addEventListener("change", (e) => { ui.form.site = e.target.value; });
    if (!isLockedTech) {
      const techEl = document.getElementById("f-tech");
      if (techEl) techEl.addEventListener("input", () => { ui.form.technicien = techEl.value; });
    }
    document.getElementById("add-interv").addEventListener("click", async () => {
      const statusEl = document.getElementById("interv-status");
      if (!isPlausibleDate(ui.form.date)) { statusEl.innerHTML = `<span style="color:var(--red)">La date saisie semble incorrecte (année incomplète) — vérifie et retape-la entièrement.</span>`; return; }
      if (ui.form.appelN1) {
        // Un appel au N1 peut se suffire à lui-même (ex. alerte à distance,
        // sans déplacement sur site) — pas besoin d'intervenant N2,
        // association/site/type/heures dans ce cas, contrairement à une
        // intervention classique.
        if (!ui.form.n1Contacte) { statusEl.innerHTML = `<span style="color:var(--red)">Choisis le N1 contacté.</span>`; return; }
        if (!ui.form.motifAppelN1) { statusEl.innerHTML = `<span style="color:var(--red)">Indique le motif de l'appel.</span>`; return; }
      } else {
        if (!ui.form.technicien) { statusEl.innerHTML = `<span style="color:var(--red)">Choisis un intervenant.</span>`; return; }
        if (!ui.form.association) { statusEl.innerHTML = `<span style="color:var(--red)">Choisis une association.</span>`; return; }
        if (!ui.form.site) { statusEl.innerHTML = `<span style="color:var(--red)">Choisis un site.</span>`; return; }
        if (!ui.form.type) { statusEl.innerHTML = `<span style="color:var(--red)">Indique un type d'intervention.</span>`; return; }
        if (!ui.form.heures) { statusEl.innerHTML = `<span style="color:var(--red)">Indique le nombre d'heures.</span>`; return; }
      }
      statusEl.innerHTML = `<span style="color:var(--text-dim)">⏳ Enregistrement…</span>`;
      const nuit = heuresDeNuit(ui.form.heureDebut, ui.form.heureFin);
      const dimanche = estDimanche(ui.form.date);
      // Prime dimanche uniquement s'il y a eu déplacement : pas pour une
      // astreinte traitée par téléphone / à distance, ni pour un simple
      // appel au N1 sans intervenant envoyé sur place.
      const sansDeplacement = !!ui.form.sansDeplacement || (!!ui.form.appelN1 && !ui.form.technicien);
      const payload = {
        date: ui.form.date, technicien: ui.form.technicien, association: ui.form.association, groupe: ui.form.groupe, site: ui.form.site,
        type: ui.form.type, heures: parseFloat(ui.form.heures) || 0, description: ui.form.description,
        heureDebut: ui.form.heureDebut, heureFin: ui.form.heureFin,
        heuresNuit: nuit, primeDimanche: dimanche && !sansDeplacement ? PRIME_DIMANCHE : 0,
        sansDeplacement,
        photos: ui.form.photos || [],
        appelN1: ui.form.appelN1 || false, n1Contacte: ui.form.appelN1 ? ui.form.n1Contacte : "",
        motifAppelN1: ui.form.appelN1 ? ui.form.motifAppelN1 : "", decisionN1: ui.form.appelN1 ? ui.form.decisionN1 : "",
      };
      // Correction manuelle du numéro d'intervention (INT-00042), réservée
      // au Super Admin, en cas d'erreur de numérotation (doublon, décalage
      // après une purge, etc.) — uniquement lors d'une modification, jamais
      // à la création (le numéro est toujours généré automatiquement).
      if (ui.editingId && mountedUser.role === "super_admin" && ui.form.numero && ui.form.numero.trim()) {
        const numeroVoulu = ui.form.numero.trim();
        const collision = state.interventions.find(i => i.id !== ui.editingId && i.numero === numeroVoulu);
        if (collision) {
          statusEl.innerHTML = `<span style="color:var(--red)">❌ Le numéro ${esc(numeroVoulu)} est déjà utilisé par une autre intervention (${esc(collision.date || "?")} — ${esc(collision.site || collision.association || "?")}). Choisis un autre numéro.</span>`;
          return;
        }
        payload.numero = numeroVoulu;
      }
      try {
        if (ui.editingId) {
          await updateIntervention(ui.editingId, payload);
          ui.editingId = null;
        } else {
          await addIntervention({ ...payload, createdBy: mountedUser.uid, createdByName: mountedUser.nom || mountedUser.email });
        }
        ui.form.association = ""; ui.form.groupe = ""; ui.form.site = ""; ui.form.type = ""; ui.form.heures = ""; ui.form.heureDebut = ""; ui.form.heureFin = ""; ui.form.description = ""; ui.form.photos = []; ui.form.appelN1 = false; ui.form.n1Contacte = ""; ui.form.motifAppelN1 = ""; ui.form.decisionN1 = "";
        renderAll();
      } catch (e) {
        statusEl.innerHTML = `<span style="color:var(--red)">❌ Échec : ${esc(e.message || String(e))}</span>`;
      }
    });
    document.getElementById("cancel-edit")?.addEventListener("click", () => {
      ui.editingId = null;
      ui.form.association = ""; ui.form.groupe = ""; ui.form.site = ""; ui.form.type = ""; ui.form.heures = ""; ui.form.heureDebut = ""; ui.form.heureFin = ""; ui.form.description = ""; ui.form.photos = []; ui.form.appelN1 = false; ui.form.n1Contacte = ""; ui.form.motifAppelN1 = ""; ui.form.decisionN1 = "";
      renderAll();
    });
    container.querySelectorAll("[data-voir-photos-interv]").forEach(btn => btn.addEventListener("click", async () => {
      const i = state.interventions.find(x => x.id === btn.dataset.voirPhotosInterv);
      if (!i || !(i.photos || []).length) return;
      btn.disabled = true; const original = btn.textContent; btn.textContent = "⏳";
      try {
        const urls = await Promise.all(i.photos.map(p => p.itemId ? getImageDisplayUrl(p.itemId) : Promise.resolve(p.url)));
        const overlay = document.createElement("div");
        overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:2000;display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:12px;padding:20px;overflow:auto;cursor:pointer";
        overlay.innerHTML = urls.map(u => `<img src="${esc(u)}" style="max-width:90vw;max-height:80vh;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.5)">`).join("");
        overlay.addEventListener("click", () => overlay.remove());
        document.body.appendChild(overlay);
      } catch (e) {
        window.toast("Impossible d'ouvrir les photos : " + (e.message || e));
      } finally {
        btn.disabled = false; btn.textContent = original;
      }
    }));
    container.querySelectorAll("[data-edit]").forEach(btn => {
      btn.addEventListener("click", () => {
        const i = state.interventions.find(x => x.id === btn.dataset.edit);
        if (!i) return;
        ui.editingId = i.id;
        ui.form = {
          date: i.date, technicien: i.technicien, association: i.association || "", groupe: i.groupe || "",
          site: i.site, type: i.type, heures: String(i.heures), heureDebut: i.heureDebut || "", heureFin: i.heureFin || "", description: i.description || "",
          photos: i.photos || [],
          appelN1: i.appelN1 || false, n1Contacte: i.n1Contacte || "", motifAppelN1: i.motifAppelN1 || "", decisionN1: i.decisionN1 || "",
          sansDeplacement: !!i.sansDeplacement,
          numero: i.numero || "",
        };
        renderAll();
        mountedContainer.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
    container.querySelectorAll("[data-del]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.del;
        const interv = state.interventions.find(i => i.id === id);
        const libelle = interv ? `l'intervention du ${new Date(interv.date).toLocaleDateString("fr-FR")} chez ${interv.site} (${interv.technicien})` : "cette intervention";
        if (!(await window.confirmDialog(`Mettre ${libelle} à la corbeille ? Récupérable pendant 60 jours dans Administration > Corbeille.`, { danger: true, texteValider: "Mettre à la corbeille" }))) return;
        state.interventions = state.interventions.filter(i => i.id !== id);
        renderAll();
        await envoyerInterventionCorbeille(id);
      });
    });
    container.querySelectorAll("[data-remettre-attente]").forEach(btn => {
      btn.addEventListener("click", async () => {
        if (!confirm("Remettre cette intervention en attente ? Elle ne sera plus comptée comme transmise (le relevé déjà validé n'est pas modifié).")) return;
        btn.disabled = true;
        try {
          await updateIntervention(btn.dataset.remettreAttente, { transmis: false });
        } catch (e) {
          window.toast("Échec : " + (e.message || e));
          btn.disabled = false;
        }
      });
    });
  }

  if (perms.isEditor) {
    document.getElementById("doc-person").addEventListener("change", (e) => { ui.docForm.person = e.target.value; if (ui.docForm.generated) { ui.docForm.generated = true; renderAll(); } });
    document.getElementById("doc-start").addEventListener("change", (e) => {
      // On n'empêche plus de taper, et on ne relance plus un rendu complet
      // ici : un renderAll() en cours de frappe recréait le champ et
      // coupait la saisie du clavier (ex. année tapée à moitié). La
      // validation et le re-rendu n'ont lieu qu'au clic sur "Générer le
      // document".
      ui.docForm.start = e.target.value;
    });
    document.getElementById("doc-end").addEventListener("change", (e) => {
      ui.docForm.end = e.target.value;
    });
    document.getElementById("doc-generate").addEventListener("click", () => {
      if (!isPlausibleDate(ui.docForm.start) || !isPlausibleDate(ui.docForm.end)) {
        window.toast("Une des dates saisies semble incorrecte (année incomplète) — vérifie et retape-la entièrement.");
        return;
      }
      ui.docForm.generated = true; renderAll();
    });
    container.querySelectorAll("[data-period]").forEach(btn => {
      btn.addEventListener("click", () => {
        const today = new Date();
        const iso = (d) => dateKey(d);
        if (btn.dataset.period === "mois") {
          ui.docForm.start = iso(new Date(today.getFullYear(), today.getMonth(), 1));
          ui.docForm.end = iso(today);
        } else if (btn.dataset.period === "3mois") {
          ui.docForm.start = iso(new Date(today.getFullYear(), today.getMonth() - 2, 1));
          ui.docForm.end = iso(today);
        } else if (btn.dataset.period === "annee") {
          ui.docForm.start = iso(new Date(today.getFullYear(), 0, 1));
          ui.docForm.end = iso(today);
        } else if (btn.dataset.period === "scolaire") {
          // Année scolaire : du 1er septembre au 31 août. Si on est avant
          // septembre, elle a commencé l'année civile précédente.
          const anneeDebut = today.getMonth() >= 8 ? today.getFullYear() : today.getFullYear() - 1;
          ui.docForm.start = iso(new Date(anneeDebut, 8, 1));
          ui.docForm.end = iso(today);
        } else if (btn.dataset.period === "tout") {
          const dates = state.interventions.map(i => i.date).sort();
          ui.docForm.start = dates[0] || iso(today);
          ui.docForm.end = iso(today);
        }
        ui.docForm.generated = true;
        renderAll();
      });
    });
    document.getElementById("doc-print")?.addEventListener("click", () => {
      imprimerFicheIsolee(document.getElementById("doc-print-fiche"));
    });
    document.getElementById("doc-close")?.addEventListener("click", () => { ui.docForm.generated = false; renderAll(); });
    document.getElementById("doc-valider")?.addEventListener("click", async () => {
      const statusEl = document.getElementById("doc-valid-status");
      const filtered = state.interventions
        .filter(i => ui.docForm.person === "Tous" || i.technicien === ui.docForm.person)
        .filter(i => i.date >= ui.docForm.start && i.date <= ui.docForm.end);
      if (filtered.length === 0) { statusEl.innerHTML = `<span style="color:var(--red)">Aucune intervention sur cette période à valider.</span>`; return; }
      statusEl.innerHTML = `<span style="color:var(--text-dim)">⏳ Validation en cours…</span>`;
      try {
        const total = filtered.reduce((s, i) => s + (i.heures || 0), 0);
        const totalNuit = filtered.reduce((s, i) => s + (i.heuresNuit || 0), 0);
        const totalPrimes = filtered.reduce((s, i) => s + (i.primeDimanche || 0), 0);
        await createReleve({
          person: ui.docForm.person, start: ui.docForm.start, end: ui.docForm.end,
          total, totalNuit, totalPrimes, nbInterventions: filtered.length,
          interventionIds: filtered.map(i => i.id),
          validatedBy: mountedUser.uid, validatedByNom: mountedUser.nom || mountedUser.email,
          validatedAt: new Date().toISOString(),
        });
        await Promise.all(filtered.map(i => updateIntervention(i.id, { transmis: true })));
        statusEl.innerHTML = `<span style="color:var(--teal)">✓ Relevé validé et archivé — ${filtered.length} intervention(s), ${total.toFixed(2)}h au total.</span>`;
      } catch (e) {
        statusEl.innerHTML = `<span style="color:var(--red)">❌ Échec : ${esc(e.message || String(e))}</span>`;
      }
    });
    mountedContainer.querySelectorAll("[data-note-frais-ligne]").forEach(btn => btn.addEventListener("click", () => {
      const interv = state.interventions.find(x => x.id === btn.dataset.noteFraisLigne);
      if (!interv) return;
      ouvrirApercuNoteFrais(interv.technicien, interv.date.slice(0, 7), interv.id);
    }));
    attacherApercuNoteFraisListeners();
  }
}

// =================================================================
// Synthèse
// =================================================================
function evolutionMensuelle(interventions, moisCount = 12) {
  const maintenant = new Date();
  const mois = [];
  for (let i = moisCount - 1; i >= 0; i--) {
    const d = new Date(maintenant.getFullYear(), maintenant.getMonth() - i, 1);
    mois.push({ cle: d.toISOString().slice(0, 7), label: d.toLocaleDateString("fr-FR", { month: "short", year: "2-digit" }) });
  }
  const parCle = {}; interventions.forEach(iv => { if (iv.date) { const cle = iv.date.slice(0, 7); parCle[cle] = (parCle[cle] || 0) + 1; } });
  return { labels: mois.map(m => m.label), valeurs: mois.map(m => parCle[m.cle] || 0) };
}

function detruireGraphiquesSynthese() {
  Object.values(graphiquesSynthese).forEach(c => c.destroy());
  graphiquesSynthese = {};
}

function renderSynthese(container) {
  detruireGraphiquesSynthese();
  if (state.interventions.length === 0) {
    container.innerHTML = `<div class="stack"><p class="hint">Aucune donnée pour l'instant.</p></div>`;
    return;
  }
  const sites = ["Tous", ...new Set(state.interventions.map(i => i.site))];
  const techs = ["Tous", ...state.people.n2];
  const filtered = state.interventions.filter(i =>
    (ui.filterTech === "Tous" || i.technicien === ui.filterTech) && (ui.filterSite === "Tous" || i.site === ui.filterSite));
  const totalHeures = filtered.reduce((s, i) => s + (i.heures || 0), 0);

  const byType = {}; filtered.forEach(i => { byType[i.type] = (byType[i.type] || 0) + 1; });
  const byTypeArr = Object.entries(byType).sort((a, b) => b[1] - a[1]);
  const bySite = {}; filtered.forEach(i => { bySite[i.site] = (bySite[i.site] || 0) + 1; });
  const bySiteArr = Object.entries(bySite).sort((a, b) => b[1] - a[1]);
  const heuresParTech = {}; filtered.forEach(i => { heuresParTech[i.technicien] = (heuresParTech[i.technicien] || 0) + (i.heures || 0); });
  const heuresArr = Object.entries(heuresParTech).sort((a, b) => b[1] - a[1]);
  const evolution = evolutionMensuelle(filtered);

  container.innerHTML = `
    <div class="stack">
      <div class="filters-row" style="display:flex;flex-wrap:wrap;gap:12px;align-items:end">
        <label style="font-size:11px;color:var(--text-dim)">Technicien<br><select id="filter-tech">${techs.map(t => `<option value="${esc(t)}" ${ui.filterTech === t ? 'selected' : ''}>${esc(t)}</option>`).join("")}</select></label>
        <label style="font-size:11px;color:var(--text-dim)">Site<br><select id="filter-site">${sites.map(s => `<option value="${esc(s)}" ${ui.filterSite === s ? 'selected' : ''}>${esc(s)}</option>`).join("")}</select></label>
        <div class="stat-chip" style="border-color:var(--teal);color:var(--teal)">${filtered.length} intervention${filtered.length > 1 ? "s" : ""} · ${totalHeures.toFixed(2)} h</div>
      </div>
      <div class="form-card">
        <h3 style="margin:0 0 12px;font-size:13px;color:var(--text-dim)">Évolution mensuelle — 12 derniers mois</h3>
        <div style="position:relative;height:220px"><canvas id="synth-evolution"></canvas></div>
      </div>
      <div class="stats-2col" style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        <div class="form-card"><h3 style="margin:0 0 12px;font-size:13px;color:var(--text-dim)">Par type d'intervention</h3><div style="position:relative;height:220px"><canvas id="synth-types"></canvas></div></div>
        <div class="form-card"><h3 style="margin:0 0 12px;font-size:13px;color:var(--text-dim)">Par site</h3><div style="position:relative;height:220px"><canvas id="synth-sites"></canvas></div></div>
        <div class="form-card" style="grid-column:1/-1"><h3 style="margin:0 0 12px;font-size:13px;color:var(--text-dim)">Heures cumulées par technicien</h3><div style="position:relative;height:${Math.max(160, heuresArr.length * 34)}px"><canvas id="synth-heures"></canvas></div></div>
      </div>
    </div>
  `;
  document.getElementById("filter-tech").addEventListener("change", (e) => { ui.filterTech = e.target.value; renderAll(); });
  document.getElementById("filter-site").addEventListener("change", (e) => { ui.filterSite = e.target.value; renderAll(); });

  if (!window.Chart) return; // librairie pas encore chargée (connexion lente) — les filtres/chiffres restent utilisables

  graphiquesSynthese.evolution = new window.Chart(document.getElementById("synth-evolution").getContext("2d"), {
    type: "bar",
    data: { labels: evolution.labels, datasets: [{ label: "Interventions", data: evolution.valeurs, backgroundColor: "rgba(217,178,76,.75)", borderColor: "#D9B24C", borderWidth: 1.5, borderRadius: 5, maxBarThickness: 28 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0, color: "#8A93A3" }, grid: { color: "rgba(255,255,255,.06)" } }, x: { ticks: { color: "#8A93A3" }, grid: { display: false } } } },
  });
  graphiquesSynthese.types = new window.Chart(document.getElementById("synth-types").getContext("2d"), {
    type: "doughnut",
    data: { labels: byTypeArr.map(([n]) => n), datasets: [{ data: byTypeArr.map(([, v]) => v), backgroundColor: byTypeArr.map((_, i) => PIE_COLORS[i % PIE_COLORS.length]) }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom", labels: { color: "#8A93A3", boxWidth: 11, font: { size: 11 } } } } },
  });
  graphiquesSynthese.sites = new window.Chart(document.getElementById("synth-sites").getContext("2d"), {
    type: "bar",
    data: { labels: bySiteArr.map(([n]) => n), datasets: [{ data: bySiteArr.map(([, v]) => v), backgroundColor: bySiteArr.map((_, i) => PIE_COLORS[i % PIE_COLORS.length]) }] },
    options: { indexAxis: "y", responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { precision: 0, color: "#8A93A3" }, grid: { color: "rgba(255,255,255,.06)" } }, y: { ticks: { color: "#8A93A3" }, grid: { display: false } } } },
  });
  graphiquesSynthese.heures = new window.Chart(document.getElementById("synth-heures").getContext("2d"), {
    type: "bar",
    data: { labels: heuresArr.map(([n]) => n), datasets: [{ label: "Heures", data: heuresArr.map(([, v]) => Math.round(v * 100) / 100), backgroundColor: "rgba(63,182,172,.75)", borderColor: "#3FB6AC", borderWidth: 1.5, borderRadius: 5, maxBarThickness: 26 }] },
    options: { indexAxis: "y", responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { color: "#8A93A3" }, grid: { color: "rgba(255,255,255,.06)" } }, y: { ticks: { color: "#8A93A3" }, grid: { display: false } } } },
  });
}

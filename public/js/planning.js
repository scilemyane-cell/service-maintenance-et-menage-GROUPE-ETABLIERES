import {
  addDays, dateKey, sameDay, fmtLong, fmtShort, HOLIDAYS,
  YEAR_START, YEAR_END, computeWeeklyTitulaires, resolveDayN1, resolveDayN2,
  isAbsentOnDate, esc, initials, colorForPerson, nextHandover, isPlausibleDate,
} from "./astreinte-logic.js";
import {
  watchPeople, savePeople, watchAbsences, addAbsence, deleteAbsence,
  watchInterventions, addIntervention, updateIntervention, deleteIntervention,
} from "./firestore-data.js";
import { watchTransferts, annulerTransfert } from "./transfert-data.js";
import { watchCoordonnees, saveCoordonnee } from "./coordonnees-data.js";
import { watchAssociations } from "./associations-data.js";
import { watchReleves, createReleve, deleteReleve } from "./releves-data.js";
import { transfertBannerHTML, attachTransfertListeners } from "./transfert-ui.js";
import { getAccessToken, uploadToDrive, getImageDisplayUrl, deleteDriveItem, DOSSIERS_ROOT_FOLDER } from "./sharepoint-storage.js";

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
const PIE_COLORS = ["#D9B24C", "#3FB6AC", "#8B7CF0", "#E5533D", "#6FA8DC", "#B5C99A", "#D98BC9", "#C9A66B"];

let state = { people: { n1: ["Valentin", "Lionel"], n2: ["Technicien 1", "Technicien 2", "Technicien 3"] }, absences: [], interventions: [], transferts: [], coordonnees: {}, associations: [], releves: [] };
let ui = {
  subtab: "calendrier",
  calYear: new Date().getFullYear(), calMonth: new Date().getMonth(),
  selectedDate: null,
  filterTech: "Tous", filterSite: "Tous",
  form: { date: new Date().toISOString().slice(0, 10), technicien: "", association: "", groupe: "", site: "", type: "", heures: "", heureDebut: "", heureFin: "", description: "", photos: [] },
  editingId: null,
  ficheOuverte: null, // nom de la personne dont la fiche technicien est dépliée
  noteFraisMois: new Date().toISOString().slice(0, 7),
  absForm: { person: "", start: new Date().toISOString().slice(0, 10), end: new Date().toISOString().slice(0, 10), type: "conge", note: "" },
  docForm: { person: "Tous", start: new Date().toISOString().slice(0, 10), end: new Date().toISOString().slice(0, 10), generated: false },
};
let unsubs = [];
let clearCountdown = null;
let mountedContainer = null;
let mountedUser = null;

function cleanup() {
  unsubs.forEach(u => u());
  unsubs = [];
  if (clearCountdown) { clearCountdown(); clearCountdown = null; }
}

export function permissions(user) {
  const isEditor = user.role === "super_admin" || user.role === "admin" || user.role === "n1";
  const isTech = user.role === "technicien";
  return {
    isEditor,
    isTech,
    canEditNames: isEditor,
    canManageAbsences: isEditor,
    canLogIntervention: isEditor || isTech,
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
    renderAll();
  }));
  unsubs.push(watchAbsences((a) => { state.absences = a; renderAll(); }));
  unsubs.push(watchInterventions((i) => { state.interventions = i; renderAll(); }));
  unsubs.push(watchTransferts((t) => { state.transferts = t; renderAll(); }));
  unsubs.push(watchCoordonnees((c) => { state.coordonnees = c; renderAll(); }));
  unsubs.push(watchAssociations((a) => { state.associations = a; renderAll(); }));
  unsubs.push(watchReleves((r) => { state.releves = r; renderAll(); }));
}

export function mountCalendrier(container, user) { startListeners(container, user, "calendrier"); }
export function mountAbsencesTab(container, user) { startListeners(container, user, "absences"); }
export function mountInterventionsTab(container, user) { startListeners(container, user, "interventions"); }
export function mountSyntheseTab(container, user) { startListeners(container, user, "synthese"); }
export function mountTransfertsTab(container, user) { startListeners(container, user, "transferts"); }
export function mountCoordonneesTab(container, user) { startListeners(container, user, "coordonnees"); }
export function mountArchiveRelevesTab(container, user) { startListeners(container, user, "archive-releves"); }

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
        alert("Échec : " + (e.message || e));
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
  intervenant: "Intervenant (facturation)", etudiant: "Étudiants",
};
const TARIF_KM = 0.32;
// Le technicien est remboursé pour le trajet domicile ↔ service
// technique (puis prend un véhicule de service pour se rendre sur le
// site d'intervention lui-même — ce dernier trajet n'est pas à ses
// frais). Une seule adresse de destination, fixe, pour tout le monde.
const SERVICE_TECHNIQUE_NOM = "Service technique";
const SERVICE_TECHNIQUE_ADRESSE = "Route de Nantes, 85000 La Roche-sur-Yon";

function renderCoordonnees(container, perms) {
  const all = [
    ...state.people.n1.map(nom => ({ nom, role: "Cadre astreinte" })),
    ...state.people.n2.map(nom => ({ nom, role: "Technicien" })),
  ];

  container.innerHTML = `
    <div class="stack">
      <p class="hint">Coordonnées des cadres d'astreinte et techniciens. ${perms.isEditor ? "Clique sur un champ pour le modifier. Déplie la fiche d'un technicien pour renseigner son adresse et ses kilomètres par site, puis générer sa note de frais de déplacements." : ""}</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Nom</th><th>Rôle</th><th>Téléphone</th><th>Email</th><th></th></tr></thead>
          <tbody>
            ${all.length === 0 ? `<tr><td colspan="5" class="empty-row">Aucune personne configurée.</td></tr>` :
              all.map(p => {
                const c = state.coordonnees[p.nom] || {};
                return `<tr>
                  <td><b>${esc(p.nom)}</b></td>
                  <td>${esc(p.role)}</td>
                  <td>${perms.isEditor
                    ? `<input type="tel" data-coord-tel="${esc(p.nom)}" value="${esc(c.telephone || '')}" placeholder="06 12 34 56 78" style="min-width:150px">`
                    : (c.telephone ? `<a href="tel:${esc(c.telephone)}" style="color:var(--gold)">${esc(c.telephone)}</a>` : `<span class="hint">—</span>`)}</td>
                  <td>${perms.isEditor
                    ? `<input type="email" data-coord-email="${esc(p.nom)}" value="${esc(c.email || '')}" placeholder="email@etablieres.fr" style="min-width:200px">`
                    : (c.email ? esc(c.email) : `<span class="hint">—</span>`)}</td>
                  <td>${perms.isEditor ? `<button class="nav-btn" data-toggle-fiche="${esc(p.nom)}" style="padding:5px 9px;font-size:11px">${ui.ficheOuverte === p.nom ? "▲ Fermer" : "📋 Fiche technicien"}</button>` : ""}</td>
                </tr>
                ${perms.isEditor && ui.ficheOuverte === p.nom ? `<tr><td colspan="5" style="padding:0;border:none">${renderFicheTechnicien(p.nom, c)}</td></tr>` : ""}`;
              }).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;

  if (!perms.isEditor) return;

  container.querySelectorAll("[data-coord-tel]").forEach(inp => {
    inp.addEventListener("change", async () => {
      const nom = inp.dataset.coordTel;
      const existing = state.coordonnees[nom] || {};
      await saveCoordonnee(nom, { ...existing, telephone: inp.value.trim() });
    });
  });
  container.querySelectorAll("[data-coord-email]").forEach(inp => {
    inp.addEventListener("change", async () => {
      const nom = inp.dataset.coordEmail;
      const existing = state.coordonnees[nom] || {};
      await saveCoordonnee(nom, { ...existing, email: inp.value.trim() });
    });
  });
  container.querySelectorAll("[data-toggle-fiche]").forEach(btn => btn.addEventListener("click", () => {
    ui.ficheOuverte = ui.ficheOuverte === btn.dataset.toggleFiche ? null : btn.dataset.toggleFiche;
    renderAll();
  }));
  attacherFicheTechnicienListeners();
}

// Fiche détaillée d'un technicien : adresse, association, statut, site
// principal, table des kilomètres aller-retour par site (alimentée au
// fur et à mesure, complétée automatiquement à la génération de la note
// de frais si un site manque), puis le générateur de note de frais.
function renderFicheTechnicien(nom, c) {
  return `
    <div class="form-card" style="margin:8px 0;background:var(--panel-alt)">
      <h4 style="margin:0 0 10px;font-size:14px;color:var(--gold)">📋 Fiche technicien — ${esc(nom)}</h4>
      <p class="hint" style="margin:0 0 10px">Le trajet remboursé est domicile ↔ ${esc(SERVICE_TECHNIQUE_NOM)} (${esc(SERVICE_TECHNIQUE_ADRESSE)}) — le technicien prend ensuite un véhicule de service pour se rendre sur le site d'intervention, non remboursé séparément.</p>
      <div class="form-grid">
        <label>Adresse du domicile (lieu de départ)<input data-fiche-adresse="${esc(nom)}" value="${esc(c.adresseDomicile || '')}" placeholder="ex. 12 rue des Lilas, 85000 La Roche-sur-Yon"></label>
        <label>Km aller-retour domicile ↔ ${esc(SERVICE_TECHNIQUE_NOM)}<input type="number" min="0" step="0.1" data-fiche-km-service="${esc(nom)}" value="${c.kmDomicileService || ''}" placeholder="ex. 24"></label>
        <label>Association
          <select data-fiche-association="${esc(nom)}">
            <option value="ECOLE" ${(c.association || "ECOLE") === "ECOLE" ? "selected" : ""}>ECOLE</option>
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

      <p style="font-size:12px;font-weight:700;color:var(--text-dim);margin:16px 0 6px">🖨️ Note de frais de déplacements</p>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <input type="month" id="fiche-mois-${esc(nom)}" value="${ui.noteFraisMois}">
        <button class="add-btn" data-generer-note="${esc(nom)}" style="font-size:12px">🖨️ Générer la note de frais</button>
      </div>
      <div id="fiche-note-status-${esc(nom)}" style="font-size:12px;margin-top:6px"></div>
    </div>
  `;
}

function attacherFicheTechnicienListeners() {
  mountedContainer.querySelectorAll("[data-fiche-adresse]").forEach(inp => inp.addEventListener("change", async () => {
    const nom = inp.dataset.ficheAdresse;
    await saveCoordonnee(nom, { ...(state.coordonnees[nom] || {}), adresseDomicile: inp.value.trim() });
  }));
  mountedContainer.querySelectorAll("[data-fiche-association]").forEach(sel => sel.addEventListener("change", async () => {
    const nom = sel.dataset.ficheAssociation;
    await saveCoordonnee(nom, { ...(state.coordonnees[nom] || {}), association: sel.value });
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
  mountedContainer.querySelectorAll("[data-generer-note]").forEach(btn => btn.addEventListener("click", async () => {
    const nom = btn.dataset.genererNote;
    const mois = document.getElementById(`fiche-mois-${nom}`).value;
    ui.noteFraisMois = mois;
    await genererNoteDeFrais(nom, mois);
  }));
}

// Génère la note de frais de déplacements du mois pour un technicien,
// en reproduisant le formulaire officiel papier (CG01) du groupe
// Établières — imprimable/enregistrable en PDF via la boîte de dialogue
// d'impression du navigateur.
async function genererNoteDeFrais(nom, mois) {
  const statusEl = document.getElementById(`fiche-note-status-${nom}`);
  const c = state.coordonnees[nom] || {};
  const kmAllerRetour = c.kmDomicileService || 0;
  const [annee, moisNum] = mois.split("-").map(Number);
  const interventionsMois = state.interventions
    .filter(i => i.technicien === nom && i.date && i.date.startsWith(mois))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (interventionsMois.length === 0) { statusEl.innerHTML = `<span class="hint">Aucune intervention pour ce mois.</span>`; return; }
  if (!kmAllerRetour) {
    statusEl.innerHTML = `<span style="color:var(--red)">⚠️ Kilomètres domicile ↔ ${esc(SERVICE_TECHNIQUE_NOM)} non renseignés. Complète-les dans la fiche ci-dessus avant de générer.</span>`;
    return;
  }
  statusEl.innerHTML = "";

  // Un seul trajet domicile ↔ service technique par JOUR travaillé, même
  // si plusieurs interventions (sur des sites différents) ont eu lieu ce
  // jour-là — le technicien ne fait cet aller-retour qu'une fois avant de
  // prendre le véhicule de service pour la suite.
  const parJour = new Map();
  interventionsMois.forEach(i => {
    if (!parJour.has(i.date)) parJour.set(i.date, []);
    parJour.get(i.date).push(i);
  });
  const jours = [...parJour.keys()].sort();
  const totalKm = kmAllerRetour * jours.length;
  const nomMois = new Date(annee, moisNum - 1, 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  const coche = (condition) => condition ? "☒" : "☐";

  const html = `
    <div class="print-fiche" style="background:#fff;color:#111;padding:20px;font-family:Calibri,Arial,sans-serif;font-size:12px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #333;padding-bottom:8px;margin-bottom:10px">
        <div style="display:flex;align-items:center;gap:10px">
          <img src="img/logo-etablieres.png" alt="Groupe Établières" style="height:38px">
          <div style="font-size:11px;line-height:1.3">Association ECOLE<br>Association ARMONIA</div>
        </div>
        <div style="font-size:10px;text-align:right;line-height:1.4">
          <b>Codification : CG 01</b><br>Rattachement : CG - Compta/Gestion
        </div>
      </div>
      <h2 style="text-align:center;margin:0 0 14px;font-size:16px;background:#eee;padding:6px">NOTE DE FRAIS DE DEPLACEMENTS – ECOLE &amp; ARMONIA</h2>
      <p style="margin:0 0 4px"><b>NOM Prénom :</b> ${esc(nom)} &nbsp;&nbsp;&nbsp;&nbsp; <b>Mois :</b> ${esc(nomMois)}</p>
      <p style="margin:0 0 4px"><b>Association :</b> ${coche(c.association !== "ARMONIA")} ECOLE &nbsp; ${coche(c.association === "ARMONIA")} ARMONIA</p>
      <p style="margin:0 0 4px"><b>Statut :</b>
        ${coche((c.statut || "salarie_prive") === "salarie_prive")} Salarié droit privé &nbsp;
        ${coche(c.statut === "salarie_public")} Salarié droit public &nbsp;
        ${coche(c.statut === "intervenant")} Intervenant (facturation) &nbsp;
        ${coche(c.statut === "etudiant")} Étudiants
      </p>
      <p style="margin:0 0 4px"><b>Site principal :</b> ${esc(c.sitePrincipal || "—")}</p>
      <p style="margin:0 0 10px"><b>Adresse complète :</b> ${esc(c.adresseDomicile || "—")}</p>

      <table style="width:100%;border-collapse:collapse;font-size:11px">
        <thead><tr>
          <th style="border:1px solid #999;padding:5px;background:#eee">DATE</th>
          <th style="border:1px solid #999;padding:5px;background:#eee">Lieu départ</th>
          <th style="border:1px solid #999;padding:5px;background:#eee">Ville de destination</th>
          <th style="border:1px solid #999;padding:5px;background:#eee">Nature de la mission</th>
          <th style="border:1px solid #999;padding:5px;background:#eee">Nbr Km A/R</th>
          <th style="border:1px solid #999;padding:5px;background:#eee">Frais annexes *</th>
        </tr></thead>
        <tbody>
          ${jours.map(jour => {
            const interventionsJour = parJour.get(jour);
            const nature = interventionsJour.map(i => `${i.site}${i.type ? " (" + i.type + ")" : ""}`).join(" ; ");
            return `
            <tr>
              <td style="border:1px solid #999;padding:5px">${new Date(jour).toLocaleDateString("fr-FR")}</td>
              <td style="border:1px solid #999;padding:5px">${esc(c.adresseDomicile || "—")}</td>
              <td style="border:1px solid #999;padding:5px">${esc(SERVICE_TECHNIQUE_NOM)} — ${esc(SERVICE_TECHNIQUE_ADRESSE)}</td>
              <td style="border:1px solid #999;padding:5px">${esc(nature)}</td>
              <td style="border:1px solid #999;padding:5px;text-align:center">${kmAllerRetour}</td>
              <td style="border:1px solid #999;padding:5px"></td>
            </tr>
          `;}).join("")}
        </tbody>
        <tfoot>
          <tr style="font-weight:700">
            <td colspan="4" style="border:1px solid #999;padding:5px;text-align:right">TOTAUX</td>
            <td style="border:1px solid #999;padding:5px;text-align:center">${totalKm.toFixed(1)} km</td>
            <td style="border:1px solid #999;padding:5px"></td>
          </tr>
        </tfoot>
      </table>
      <p style="font-size:10px;margin:6px 0 0">*Frais annexes : joindre les justificatifs. En cas de repas, indiquer nom et nombre de personnes.</p>

      <div style="display:flex;justify-content:space-between;margin-top:24px">
        <div style="width:45%;border:1px solid #999;padding:8px;font-size:11px">
          <b>RESERVE ADMINISTRATION</b><br>Tarif de remboursement du km : ${TARIF_KM.toFixed(2).replace(".", ",")} €<br><br><br>
          <i>Cachet « comptabilité » à remplir et valider par le Directeur Délégué</i>
        </div>
        <div style="width:45%;border:1px solid #999;padding:8px;font-size:11px;text-align:center">
          <b>SIGNATURE DU DEMANDEUR</b>
        </div>
      </div>
      <p style="font-size:9px;color:#666;margin-top:12px">Le nombre de kms déclarés doit s'appuyer sur le trajet le plus court proposé par MAPPY entre la résidence administrative du salarié (lieu de travail habituel) et la ville de déplacement. C'est sur cette base que se fera le remboursement.</p>
    </div>
  `;

  const printRoot = document.createElement("div");
  printRoot.id = "note-frais-print-root";
  printRoot.className = "print-only";
  printRoot.innerHTML = html;
  document.body.appendChild(printRoot);
  window.print();
  setTimeout(() => printRoot.remove(), 1000);
}

// =================================================================
// Historique des transferts de ligne
// =================================================================
function nuitIndicatorHTML() {
  const nuit = heuresDeNuit(ui.form.heureDebut, ui.form.heureFin);
  const dimanche = ui.form.date && estDimanche(ui.form.date);
  if (!nuit && !dimanche) return "";
  return `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
    ${nuit > 0 ? `<span class="tag" style="background:#3A3160">🌙 ${nuit.toFixed(2)}h de nuit (21h-6h, indicatif)</span>` : ""}
    ${dimanche ? `<span class="tag" style="background:#8F5FBF">🌞 Dimanche — prime +${PRIME_DIMANCHE}€</span>` : ""}
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
        alert("Échec de l'annulation : " + (e.message || e));
        btn.disabled = false;
      }
    });
  });
}

function renderCalendar(container, perms) {
  const { titN1, titN2, scoresN1, scoresN2 } = computeWeeklyTitulaires(state.people, state.absences);
  const today = new Date();
  const todayInRange = today >= addDays(YEAR_START, -7) && today <= addDays(YEAR_END, 7);
  const refDate = todayInRange ? today : YEAR_START;
  const n1Today = resolveDayN1(refDate, state.people, state.absences, titN1);
  const n2Today = resolveDayN2(refDate, state.people, state.absences, titN2);
  const holidayToday = HOLIDAYS.get(dateKey(refDate));
  const next = todayInRange ? nextHandover(refDate, state.people, state.absences, titN1, resolveDayN1, 3) : null;
  const confirmedRecord = next ? state.transferts.find(t => t.id === dateKey(next.date)) : null;

  let alertDays = [];
  for (let d = new Date(YEAR_START); d <= YEAR_END; d = addDays(d, 1)) {
    const a = resolveDayN1(d, state.people, state.absences, titN1), b = resolveDayN2(d, state.people, state.absences, titN2);
    if (a.assigned === "A DÉFINIR" || b.assigned === "A DÉFINIR") alertDays.push(new Date(d));
  }

  const compteurs = {};
  [...state.people.n1, ...state.people.n2].forEach(p => compteurs[p] = { n1: 0, n2: 0, score: 0 });
  for (let d = new Date(YEAR_START); d <= YEAR_END; d = addDays(d, 1)) {
    const a = resolveDayN1(d, state.people, state.absences, titN1), b = resolveDayN2(d, state.people, state.absences, titN2);
    if (compteurs[a.assigned]) compteurs[a.assigned].n1++;
    if (compteurs[b.assigned]) compteurs[b.assigned].n2++;
  }
  Object.entries(scoresN1).forEach(([p, s]) => { if (compteurs[p]) compteurs[p].score = s; });
  Object.entries(scoresN2).forEach(([p, s]) => { if (compteurs[p]) compteurs[p].score = s; });

  const monthLabel = new Date(ui.calYear, ui.calMonth, 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  const days = monthGrid(ui.calYear, ui.calMonth);
  const dow = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
  const selected = ui.selectedDate ? new Date(ui.selectedDate) : refDate;
  const selN1 = resolveDayN1(selected, state.people, state.absences, titN1);
  const selN2 = resolveDayN2(selected, state.people, state.absences, titN2);
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
        ${Object.entries(compteurs).map(([name, c]) => `<div class="stat-chip">${esc(name)} — N1 <b>${c.n1}</b>j · N2 <b>${c.n2}</b>j · charge <b>${c.score.toFixed(1)}</b></div>`).join("")}
      </div>

      ${perms.canEditNames ? `
      <details class="names-editor" style="background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:11px 15px">
        <summary style="cursor:pointer;font-size:13px;font-weight:600;color:var(--text-dim)">Noms des personnes</summary>
        <div class="form-grid" style="margin-top:12px">
          ${state.people.n1.map((name, i) => `<label>N1 — Titulaire ${i === 0 ? "A" : "B"}<input data-name-group="n1" data-name-idx="${i}" value="${esc(name)}"></label>`).join("")}
          ${state.people.n2.map((name, i) => `<label>N2 — Technicien ${i + 1}<input data-name-group="n2" data-name-idx="${i}" value="${esc(name)}"></label>`).join("")}
        </div>
      </details>` : ""}

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
            const a = inRange ? resolveDayN1(d, state.people, state.absences, titN1) : null;
            const b = inRange ? resolveDayN2(d, state.people, state.absences, titN2) : null;
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
        <div class="day-detail-row"><div class="avatar" style="background:${colorForPerson(selN1.assigned, state.people)}"></div> Niveau 1 : <b>${esc(selN1.assigned)}</b></div>
        <div class="day-detail-row"><div class="avatar" style="background:${colorForPerson(selN2.assigned, state.people)}"></div> Niveau 2 : <b>${esc(selN2.assigned)}</b></div>
        ${selHoliday ? `<div style="color:var(--violet);font-size:12px;margin-top:6px">☀️ ${esc(selHoliday)}</div>` : ""}
      </div>
    </div>
  `;

  if (perms.canEditNames) {
    container.querySelectorAll("input[data-name-group]").forEach(inp => {
      inp.addEventListener("change", async () => {
        const grp = inp.dataset.nameGroup, idx = parseInt(inp.dataset.nameIdx, 10);
        const val = inp.value.trim(); if (!val) return;
        const next = { ...state.people, [grp]: [...state.people[grp]] };
        next[grp][idx] = val;
        await savePeople(next);
      });
    });
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

  if (clearCountdown) { clearCountdown(); clearCountdown = null; }
  clearCountdown = attachTransfertListeners(container, next, mountedUser, () => renderAll());
}

// =================================================================
// Absences
// =================================================================
function renderAbsences(container, perms) {
  const allPeople = [...state.people.n1, ...state.people.n2];
  const totals = {};
  allPeople.forEach(p => {
    totals[p] = state.absences.filter(a => a.person === p).reduce((s, a) => s + ((new Date(a.end) - new Date(a.start)) / 86400000 + 1), 0);
  });
  const sorted = [...state.absences].sort((a, b) => (a.start < b.start ? 1 : -1));

  container.innerHTML = `
    <div class="stack">
      <p class="hint">Ajoute une plage de dates précise. Le planning se recalcule automatiquement.</p>
      <div class="stat-row">${allPeople.map(p => `<div class="stat-chip">${esc(p)} : <b>${totals[p]}</b> j</div>`).join("")}</div>
      ${perms.canManageAbsences ? `
      <div class="form-card">
        <div class="form-grid">
          <label>Personne<select id="a-person">${allPeople.map(p => `<option value="${esc(p)}" ${ui.absForm.person === p ? 'selected' : ''}>${esc(p)}</option>`).join("")}</select></label>
          <label>Type<select id="a-type"><option value="conge" ${ui.absForm.type === 'conge' ? 'selected' : ''}>Congé</option><option value="arret" ${ui.absForm.type === 'arret' ? 'selected' : ''}>Arrêt de travail</option></select></label>
          <label>Du<input type="date" id="a-start" value="${esc(ui.absForm.start)}"></label>
          <label>Au<input type="date" id="a-end" value="${esc(ui.absForm.end)}"></label>
          <label class="desc-field">Note<input id="a-note" value="${esc(ui.absForm.note)}" placeholder="optionnel"></label>
        </div>
        <button class="add-btn" id="add-abs">➕ Ajouter l'absence</button>
      </div>` : ""}
      <div class="table-wrap">
        <table>
          <thead><tr><th>Personne</th><th>Type</th><th>Du</th><th>Au</th><th>Jours</th><th>Note</th>${perms.canManageAbsences ? '<th></th>' : ''}</tr></thead>
          <tbody>
            ${sorted.length === 0 ? `<tr><td colspan="7" class="empty-row">Aucune absence.</td></tr>` :
              sorted.map(a => {
                const days = (new Date(a.end) - new Date(a.start)) / 86400000 + 1;
                return `<tr>
                  <td>${esc(a.person)}</td>
                  <td><span class="tag" style="background:${a.type === 'conge' ? 'var(--gold)' : 'var(--red)'};${a.type === 'arret' ? 'color:#fff' : ''}">${a.type === 'conge' ? 'Congé' : 'Arrêt'}</span></td>
                  <td>${fmtShort(new Date(a.start))}</td><td>${fmtShort(new Date(a.end))}</td><td>${days}</td><td>${esc(a.note || "")}</td>
                  ${perms.canManageAbsences ? `<td><button class="del-btn" data-del="${a.id}">🗑️</button></td>` : ""}
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
      el.addEventListener("change", () => { ui.absForm[f] = el.value; });
    });
    document.getElementById("add-abs").addEventListener("click", async () => {
      if (!ui.absForm.start || !ui.absForm.end) return;
      if (!isPlausibleDate(ui.absForm.start) || !isPlausibleDate(ui.absForm.end)) {
        alert("Une des dates saisies semble incorrecte (année incomplète) — vérifie et retape-la entièrement.");
        return;
      }
      if (ui.absForm.end < ui.absForm.start) { alert("La date de fin doit être après la date de début."); return; }
      await addAbsence({ person: ui.absForm.person, type: ui.absForm.type, start: ui.absForm.start, end: ui.absForm.end, note: ui.absForm.note, createdBy: mountedUser.uid });
      ui.absForm.note = "";
      renderAll();
    });
    container.querySelectorAll("[data-del]").forEach(btn => {
      btn.addEventListener("click", async () => { await deleteAbsence(btn.dataset.del); });
    });
  }
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
    <div class="print-fiche" style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:24px;color:#111">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:18px">
        <img src="img/logo-etablieres.png" alt="Groupe Établières" style="height:60px">
        <span style="font-size:13px">Le ${fmtShort(new Date())}</span>
      </div>
      <p style="font-size:14px;margin:0 0 6px">RELEVÉ D'HEURES SUPPLÉMENTAIRES — ASTREINTE</p>
      <p style="font-size:13px;margin:0 0 6px">Intervenant : ${esc(ui.docForm.person)}</p>
      <p style="font-size:13px;margin:0 0 18px">Période du ${fmtShort(new Date(ui.docForm.start))} au ${fmtShort(new Date(ui.docForm.end))}</p>

      <table style="width:100%;border-collapse:collapse;margin-bottom:8px">
        <thead><tr>
          <th style="border:1px solid #999;padding:4px 6px;font-size:11px;text-align:left">Date</th>
          <th style="border:1px solid #999;padding:4px 6px;font-size:11px;text-align:left">Intervenant</th>
          <th style="border:1px solid #999;padding:4px 6px;font-size:11px;text-align:left">Site</th>
          <th style="border:1px solid #999;padding:4px 6px;font-size:11px;text-align:left">Type</th>
          <th style="border:1px solid #999;padding:4px 6px;font-size:11px;text-align:center">Arrivée</th>
          <th style="border:1px solid #999;padding:4px 6px;font-size:11px;text-align:center">Retour</th>
          <th style="border:1px solid #999;padding:4px 6px;font-size:11px;text-align:left">Compte-rendu</th>
          <th style="border:1px solid #999;padding:4px 6px;font-size:11px;text-align:center">Heures</th>
          <th style="border:1px solid #999;padding:4px 6px;font-size:11px;text-align:center">Nuit</th>
          <th style="border:1px solid #999;padding:4px 6px;font-size:11px;text-align:center">Prime dim.</th>
        </tr></thead>
        <tbody>
          ${filtered.length === 0 ? `<tr><td colspan="10" style="border:1px solid #999;padding:8px;text-align:center;font-size:12px">Aucune intervention sur cette période.</td></tr>` :
            filtered.map(i => `
              <tr>
                <td style="border:1px solid #999;padding:4px 6px;font-size:11px">${new Date(i.date).toLocaleDateString("fr-FR")}</td>
                <td style="border:1px solid #999;padding:4px 6px;font-size:11px">${esc(i.technicien)}</td>
                <td style="border:1px solid #999;padding:4px 6px;font-size:11px">${esc(i.site)}</td>
                <td style="border:1px solid #999;padding:4px 6px;font-size:11px">${esc(i.type)}</td>
                <td style="border:1px solid #999;padding:4px 6px;font-size:11px;text-align:center">${esc(i.heureDebut || "—")}</td>
                <td style="border:1px solid #999;padding:4px 6px;font-size:11px;text-align:center">${esc(i.heureFin || "—")}</td>
                <td style="border:1px solid #999;padding:4px 6px;font-size:11px">${esc(i.description)}</td>
                <td style="border:1px solid #999;padding:4px 6px;font-size:11px;text-align:center">${i.heures}</td>
                <td style="border:1px solid #999;padding:4px 6px;font-size:11px;text-align:center">${i.heuresNuit > 0 ? i.heuresNuit.toFixed(2) + "h" : ""}</td>
                <td style="border:1px solid #999;padding:4px 6px;font-size:11px;text-align:center">${i.primeDimanche > 0 ? "+" + i.primeDimanche + "€" : ""}</td>
              </tr>`).join("")}
        </tbody>
        <tfoot>
          <tr style="font-weight:700">
            <td colspan="7" style="border:1px solid #999;padding:4px 6px;font-size:12px;text-align:right">Total</td>
            <td style="border:1px solid #999;padding:4px 6px;font-size:12px;text-align:center">${total.toFixed(2)} h</td>
            <td style="border:1px solid #999;padding:4px 6px;font-size:12px;text-align:center">${totalNuit.toFixed(2)} h</td>
            <td style="border:1px solid #999;padding:4px 6px;font-size:12px;text-align:center">${totalPrimes > 0 ? totalPrimes + "€" : "0€"}</td>
          </tr>
        </tfoot>
      </table>
      <p style="font-size:10px;color:#666;margin-bottom:12px">Heures de nuit calculées sur la plage 21h-6h (indicatif — à valider avec la convention collective). Prime dimanche : ${PRIME_DIMANCHE}€ par jour d'intervention un dimanche.</p>

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
      try { await deleteDriveItem(photo.itemId); } catch (e) { alert("Échec de la suppression sur SharePoint : " + (e.message || e)); return; }
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
  if (!ui.form.technicien && intervenants.length > 0) ui.form.technicien = intervenants[0];
  const sorted = [...state.interventions].sort((a, b) => (a.date < b.date ? 1 : -1));
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
          <label>Intervenant
            ${isLockedTech
              ? `<input value="${esc(ui.form.technicien)}" disabled>`
              : `<select id="f-tech">${intervenants.map(t => `<option value="${esc(t)}" ${ui.form.technicien === t ? 'selected' : ''}>${esc(t)}</option>`).join("")}</select>`}
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

      <div class="table-wrap">
        <table>
          <thead><tr><th>Date</th><th>Intervenant</th><th>Site</th><th>Type</th><th>Heures</th><th>Description</th><th>Primes</th>${perms.isEditor ? '<th>Transmis au manager</th>' : ''}<th></th></tr></thead>
          <tbody>
            ${sorted.length === 0 ? `<tr><td colspan="9" class="empty-row">Aucune intervention enregistrée.</td></tr>` :
              sorted.map(i => {
                const canDelete = perms.isEditor || i.createdBy === mountedUser.uid;
                return `<tr>
                  <td>${new Date(i.date).toLocaleDateString("fr-FR")}</td><td>${esc(i.technicien)}</td><td>${esc(i.site)}</td><td>${esc(i.type)}</td>
                  <td>${i.heures} h</td><td>${esc(i.description)}${(i.photos || []).length ? ` <button class="nav-btn" data-voir-photos-interv="${i.id}" style="padding:2px 6px;font-size:10px">📷 ${i.photos.length}</button>` : ""}</td>
                  <td style="white-space:nowrap">
                    ${i.heuresNuit > 0 ? `<span class="tag" style="background:#3A3160;font-size:9px">🌙 ${i.heuresNuit.toFixed(2)}h</span> ` : ""}
                    ${i.primeDimanche > 0 ? `<span class="tag" style="background:#8F5FBF;font-size:9px">🌞 +${i.primeDimanche}€</span>` : ""}
                  </td>
                  ${perms.isEditor ? `<td>${i.transmis
                    ? `<span class="tag" style="background:var(--teal);font-size:9px">✓ Dans un relevé validé</span>${mountedUser.role === "super_admin" ? ` <button class="nav-btn" data-remettre-attente="${i.id}" style="padding:2px 6px;font-size:9px;margin-left:4px">🔓 Débloquer</button>` : ""}`
                    : `<span style="color:var(--text-dim);font-size:11px">En attente</span>`}</td>` : ''}
                  <td>${canDelete ? `<button class="nav-btn" data-edit="${i.id}" style="padding:4px 8px;font-size:11px">✏️</button> <button class="del-btn" data-del="${i.id}">🗑️</button>` : ""}</td>
                </tr>`;
              }).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;

  if (perms.canLogIntervention) {
    attacherPhotosInterventionListeners();
    ["type", "heures", "desc"].forEach(field => {
      const el = document.getElementById("f-" + field); if (!el) return;
      el.addEventListener("input", () => { const key = field === "desc" ? "description" : field; ui.form[key] = el.value; });
    });
    document.getElementById("f-date").addEventListener("change", (e) => {
      if (!isPlausibleDate(e.target.value)) { e.target.value = ui.form.date; return; }
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
      if (!ui.form.technicien) { statusEl.innerHTML = `<span style="color:var(--red)">Choisis un intervenant.</span>`; return; }
      if (!ui.form.association) { statusEl.innerHTML = `<span style="color:var(--red)">Choisis une association.</span>`; return; }
      if (!ui.form.site) { statusEl.innerHTML = `<span style="color:var(--red)">Choisis un site.</span>`; return; }
      if (!ui.form.type) { statusEl.innerHTML = `<span style="color:var(--red)">Indique un type d'intervention.</span>`; return; }
      if (!ui.form.heures) { statusEl.innerHTML = `<span style="color:var(--red)">Indique le nombre d'heures.</span>`; return; }
      statusEl.innerHTML = `<span style="color:var(--text-dim)">⏳ Enregistrement…</span>`;
      const nuit = heuresDeNuit(ui.form.heureDebut, ui.form.heureFin);
      const dimanche = estDimanche(ui.form.date);
      const payload = {
        date: ui.form.date, technicien: ui.form.technicien, association: ui.form.association, groupe: ui.form.groupe, site: ui.form.site,
        type: ui.form.type, heures: parseFloat(ui.form.heures), description: ui.form.description,
        heureDebut: ui.form.heureDebut, heureFin: ui.form.heureFin,
        heuresNuit: nuit, primeDimanche: dimanche ? PRIME_DIMANCHE : 0,
        photos: ui.form.photos || [],
      };
      try {
        if (ui.editingId) {
          await updateIntervention(ui.editingId, payload);
          ui.editingId = null;
        } else {
          await addIntervention({ ...payload, createdBy: mountedUser.uid, createdByName: mountedUser.nom || mountedUser.email });
        }
        ui.form.association = ""; ui.form.groupe = ""; ui.form.site = ""; ui.form.type = ""; ui.form.heures = ""; ui.form.heureDebut = ""; ui.form.heureFin = ""; ui.form.description = ""; ui.form.photos = [];
        renderAll();
      } catch (e) {
        statusEl.innerHTML = `<span style="color:var(--red)">❌ Échec : ${esc(e.message || String(e))}</span>`;
      }
    });
    document.getElementById("cancel-edit")?.addEventListener("click", () => {
      ui.editingId = null;
      ui.form.association = ""; ui.form.groupe = ""; ui.form.site = ""; ui.form.type = ""; ui.form.heures = ""; ui.form.heureDebut = ""; ui.form.heureFin = ""; ui.form.description = ""; ui.form.photos = [];
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
        alert("Impossible d'ouvrir les photos : " + (e.message || e));
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
        };
        renderAll();
        mountedContainer.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
    container.querySelectorAll("[data-del]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.del;
        state.interventions = state.interventions.filter(i => i.id !== id);
        renderAll();
        await deleteIntervention(id);
      });
    });
    container.querySelectorAll("[data-remettre-attente]").forEach(btn => {
      btn.addEventListener("click", async () => {
        if (!confirm("Remettre cette intervention en attente ? Elle ne sera plus comptée comme transmise (le relevé déjà validé n'est pas modifié).")) return;
        btn.disabled = true;
        try {
          await updateIntervention(btn.dataset.remettreAttente, { transmis: false });
        } catch (e) {
          alert("Échec : " + (e.message || e));
          btn.disabled = false;
        }
      });
    });
  }

  if (perms.isEditor) {
    document.getElementById("doc-person").addEventListener("change", (e) => { ui.docForm.person = e.target.value; if (ui.docForm.generated) { ui.docForm.generated = true; renderAll(); } });
    document.getElementById("doc-start").addEventListener("change", (e) => {
      if (!isPlausibleDate(e.target.value)) { e.target.value = ui.docForm.start; return; }
      ui.docForm.start = e.target.value; if (ui.docForm.generated) renderAll();
    });
    document.getElementById("doc-end").addEventListener("change", (e) => {
      if (!isPlausibleDate(e.target.value)) { e.target.value = ui.docForm.end; return; }
      ui.docForm.end = e.target.value; if (ui.docForm.generated) renderAll();
    });
    document.getElementById("doc-generate").addEventListener("click", () => {
      if (!isPlausibleDate(ui.docForm.start) || !isPlausibleDate(ui.docForm.end)) {
        alert("Une des dates saisies semble incorrecte (année incomplète) — vérifie et retape-la entièrement.");
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
    document.getElementById("doc-print")?.addEventListener("click", () => { window.print(); });
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
  }
}

// =================================================================
// Synthèse
// =================================================================
function barList(data, total) {
  return data.map((d, i) => {
    const pct = total > 0 ? Math.round((d.value / total) * 100) : 0;
    return `<div class="bar-row" style="display:flex;align-items:center;gap:10px;margin-bottom:9px;font-size:12px">
      <span style="width:130px;flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(d.name)}</span>
      <span style="flex:1;background:var(--panel-alt);border-radius:5px;height:14px;overflow:hidden"><span style="display:block;height:100%;border-radius:5px;width:${pct}%;background:${PIE_COLORS[i % PIE_COLORS.length]}"></span></span>
      <span style="width:75px;text-align:right;color:var(--text-dim);font-family:ui-monospace,monospace">${d.value} · ${pct}%</span>
    </div>`;
  }).join("");
}
function barListHeures(data, maxVal) {
  return data.map(d => {
    const pct = maxVal > 0 ? Math.round((d.heures / maxVal) * 100) : 0;
    return `<div class="bar-row" style="display:flex;align-items:center;gap:10px;margin-bottom:9px;font-size:12px">
      <span style="width:130px;flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(d.name)}</span>
      <span style="flex:1;background:var(--panel-alt);border-radius:5px;height:14px;overflow:hidden"><span style="display:block;height:100%;border-radius:5px;width:${pct}%;background:var(--teal)"></span></span>
      <span style="width:75px;text-align:right;color:var(--text-dim);font-family:ui-monospace,monospace">${d.heures.toFixed(2)} h</span>
    </div>`;
  }).join("");
}

function renderSynthese(container) {
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
  const byTypeArr = Object.entries(byType).map(([name, value]) => ({ name, value }));
  const bySite = {}; filtered.forEach(i => { bySite[i.site] = (bySite[i.site] || 0) + 1; });
  const bySiteArr = Object.entries(bySite).map(([name, value]) => ({ name, value }));
  const heuresParTech = {}; filtered.forEach(i => { heuresParTech[i.technicien] = (heuresParTech[i.technicien] || 0) + (i.heures || 0); });
  const heuresArr = Object.entries(heuresParTech).map(([name, heures]) => ({ name, heures })).sort((a, b) => b.heures - a.heures);
  const maxHeures = Math.max(...heuresArr.map(h => h.heures), 1);

  container.innerHTML = `
    <div class="stack">
      <div class="filters-row" style="display:flex;flex-wrap:wrap;gap:12px;align-items:end">
        <label style="font-size:11px;color:var(--text-dim)">Technicien<br><select id="filter-tech">${techs.map(t => `<option value="${esc(t)}" ${ui.filterTech === t ? 'selected' : ''}>${esc(t)}</option>`).join("")}</select></label>
        <label style="font-size:11px;color:var(--text-dim)">Site<br><select id="filter-site">${sites.map(s => `<option value="${esc(s)}" ${ui.filterSite === s ? 'selected' : ''}>${esc(s)}</option>`).join("")}</select></label>
        <div class="stat-chip" style="border-color:var(--teal);color:var(--teal)">${filtered.length} intervention${filtered.length > 1 ? "s" : ""} · ${totalHeures.toFixed(2)} h</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        <div class="form-card"><h3 style="margin:0 0 12px;font-size:13px;color:var(--text-dim)">Par type d'intervention</h3>${barList(byTypeArr, filtered.length)}</div>
        <div class="form-card"><h3 style="margin:0 0 12px;font-size:13px;color:var(--text-dim)">Par site</h3>${barList(bySiteArr, filtered.length)}</div>
        <div class="form-card" style="grid-column:1/-1"><h3 style="margin:0 0 12px;font-size:13px;color:var(--text-dim)">Heures cumulées par technicien</h3>${barListHeures(heuresArr, maxHeures)}</div>
      </div>
    </div>
  `;
  document.getElementById("filter-tech").addEventListener("change", (e) => { ui.filterTech = e.target.value; renderAll(); });
  document.getElementById("filter-site").addEventListener("change", (e) => { ui.filterSite = e.target.value; renderAll(); });
}

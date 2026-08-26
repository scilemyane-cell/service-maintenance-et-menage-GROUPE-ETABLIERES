import { addDays, dateKey, fmtShort, esc } from "./astreinte-logic.js";
import { watchDispositifSettings, templateFor } from "./dispositif-settings-data.js";
import { watchRepartitions, saveRepartition, repartitionId } from "./heures-repartition-data.js";
import { watchUsers } from "./users-data.js";
import { watchHeuresParams } from "./heures-data.js";

const MENAGE_ROLES = ["menage", "mi_temps"];
const DAYS = ["LUN", "MAR", "MER", "JEU", "VEN", "SAM", "DIM"];
const DAY_LABELS = { LUN: "Lun", MAR: "Mar", MER: "Mer", JEU: "Jeu", VEN: "Ven", SAM: "Sam", DIM: "Dim" };

let state = { settings: {}, repartitions: [], agents: [], params: { seuilSemaine: 42, nbSemainesMoyenne: 8, seuilMoyenne: 44 } };
let ui = { weekStart: null, actingUid: null, actingNom: null };
let unsubs = [];
let mountedContainer = null;
let mountedUser = null;
let mountedDispositif = null;

function cleanup() { unsubs.forEach(u => u()); unsubs = []; }
function isEditorUser(user) { return user && (user.role === "admin" || user.role === "n1"); }

function mondayOf(date) {
  const offset = (date.getDay() + 6) % 7;
  return addDays(date, -offset);
}
function emptyDays() {
  return { LUN: 0, MAR: 0, MER: 0, JEU: 0, VEN: 0, SAM: 0, DIM: 0 };
}

export function mountRepartitionForDispositif(container, user, dispositif) {
  cleanup();
  mountedContainer = container;
  mountedUser = user;
  mountedDispositif = dispositif;
  if (!ui.weekStart) ui.weekStart = dateKey(mondayOf(new Date()));
  container.innerHTML = `<div class="hint">Chargement…</div>`;
  unsubs.push(watchDispositifSettings((s) => { state.settings = s; render(); }));
  unsubs.push(watchRepartitions((r) => { state.repartitions = r; render(); }));
  unsubs.push(watchUsers((u) => { state.agents = u.filter(x => MENAGE_ROLES.includes(x.role)); render(); }));
  unsubs.push(watchHeuresParams((p) => { state.params = p; render(); }));
}

function effectiveAgent() {
  if (isEditorUser(mountedUser) && ui.actingUid) return { uid: ui.actingUid, nom: ui.actingNom };
  return { uid: mountedUser.uid, nom: mountedUser.nom || mountedUser.email };
}

function currentRecord() {
  const agent = effectiveAgent();
  const id = repartitionId(mountedDispositif, ui.weekStart, agent.uid);
  const existing = state.repartitions.find(r => r.id === id);
  if (existing) {
    // Compatibilité : d'anciens enregistrements avaient un total unique
    // "heures" au lieu d'une répartition par jour.
    const lignes = existing.lignes.map(l => l.jours ? l : { label: l.label, prevu: l.prevu, jours: emptyDays() });
    return { id, data: { ...existing, lignes } };
  }
  const template = templateFor(state.settings, mountedDispositif);
  return {
    id,
    data: {
      dispositif: mountedDispositif,
      weekStart: ui.weekStart, weekEnd: dateKey(addDays(new Date(ui.weekStart), 6)),
      agentUid: agent.uid, agentNom: agent.nom,
      lignes: template.map(t => ({ label: t.label, prevu: t.heures, jours: emptyDays() })),
      submitted: false,
    },
  };
}

async function persist(id, data) {
  const statusEl = document.getElementById("rp-save-status");
  if (statusEl) statusEl.innerHTML = `<span style="color:var(--text-dim)">⏳ Enregistrement…</span>`;
  try {
    await saveRepartition(id, data);
    const el = document.getElementById("rp-save-status");
    if (el) el.innerHTML = `<span style="color:var(--teal)">✓ Enregistré</span>`;
  } catch (e) {
    const el = document.getElementById("rp-save-status");
    if (el) el.innerHTML = `<span style="color:var(--red)">❌ Échec : ${esc(e.message || String(e))}</span>`;
  }
}

let saveDebounceId = null;
function scheduleSave(id, data) {
  if (saveDebounceId) clearTimeout(saveDebounceId);
  saveDebounceId = setTimeout(() => { persist(id, data); }, 500);
}

// Moyenne glissante sur N semaines pour cet agent, sur ce dispositif
// précisément (les heures saisies ailleurs — onglet Heures, autres
// dispositifs — ne sont pas incluses dans ce calcul-ci).
function slidingAverageBreach(agentUid, dispositif, nbSemaines, seuil, currentWeekStart, currentTotal) {
  const byWeek = {};
  state.repartitions
    .filter(r => r.agentUid === agentUid && r.dispositif === dispositif)
    .forEach(r => { byWeek[r.weekStart] = dayTotals(r).__total; });
  byWeek[currentWeekStart] = currentTotal; // inclut la semaine en cours d'édition
  const weekKeys = Object.keys(byWeek).sort();
  if (weekKeys.length < nbSemaines) return null;
  const lastWeeks = weekKeys.slice(-nbSemaines);
  const sum = lastWeeks.reduce((s, wk) => s + (byWeek[wk] || 0), 0);
  const avg = sum / nbSemaines;
  return avg > seuil ? avg : null;
}

function dayTotals(data) {
  const totals = emptyDays();
  data.lignes.forEach(l => { DAYS.forEach(d => { totals[d] += parseFloat(l.jours[d]) || 0; }); });
  totals.__total = DAYS.reduce((s, d) => s + totals[d], 0);
  return totals;
}

// render() recharge l'agent/la semaine courante depuis les données
// connues (Firestore). renderView() affiche un objet `data` déjà en main
// SANS repasser par Firestore — indispensable pour que les modifications
// locales (ajout/suppression de ligne) ne soient jamais écrasées par une
// reconstruction depuis le modèle avant que la sauvegarde n'ait eu lieu.
function render() {
  if (!mountedContainer) return;
  const { id, data } = currentRecord();
  renderView(id, data);
}

function renderView(id, data) {
  if (!mountedContainer) return;
  const weekStartDate = new Date(ui.weekStart);
  const weekEndDate = addDays(weekStartDate, 6);
  const totalPrevu = data.lignes.reduce((s, l) => s + (l.prevu || 0), 0);
  const totals = dayTotals(data);
  const totalSemaine = DAYS.reduce((s, d) => s + totals[d], 0);
  const joursTravailles = DAYS.filter(d => totals[d] > 0);
  const aRepos = joursTravailles.length < 7;
  const agent = effectiveAgent();
  const depasseSemaine = totalSemaine > state.params.seuilSemaine;
  const moyenneDepassee = slidingAverageBreach(agent.uid, mountedDispositif, state.params.nbSemainesMoyenne, state.params.seuilMoyenne, ui.weekStart, totalSemaine);

  mountedContainer.innerHTML = `
    <div class="stack">
      <div class="form-card">
        <div class="form-grid">
          <label>Semaine
            <div style="display:flex;align-items:center;gap:8px">
              <button class="nav-btn" id="rp-prev">‹</button>
              <span style="font-size:13px;white-space:nowrap">${fmtShort(weekStartDate)} → ${fmtShort(weekEndDate)}</span>
              <button class="nav-btn" id="rp-next">›</button>
            </div>
          </label>
          ${isEditorUser(mountedUser) ? `
          <label>Remplir au nom de
            <select id="rp-agent">
              <option value="" ${!ui.actingUid ? 'selected' : ''}>Moi-même (${esc(mountedUser.nom || mountedUser.email)})</option>
              ${state.agents.map(a => `<option value="${a.uid}" ${ui.actingUid === a.uid ? 'selected' : ''}>${esc(a.nom || a.email)}</option>`).join("")}
            </select>
          </label>` : `<label>Agent<input value="${esc(data.agentNom)}" disabled></label>`}
        </div>
      </div>

      <p class="hint">Répartition pré-remplie selon le modèle hebdomadaire de ce dispositif (${totalPrevu}h prévues). Renseigne les heures réelles jour par jour — c'est modulable, ajuste selon la semaine réellement travaillée.</p>

      ${aRepos ? `<div class="stat-chip ok" style="width:fit-content">✓ Repos hebdomadaire présent (${7 - joursTravailles.length} jour${7 - joursTravailles.length > 1 ? 's' : ''} non travaillé${7 - joursTravailles.length > 1 ? 's' : ''})</div>`
              : `<div class="alert-banner">⚠️ Aucun jour de repos détecté cette semaine — tous les jours affichent des heures.</div>`}

      ${depasseSemaine ? `<div class="alert-banner">⚠️ Total de la semaine (${totalSemaine.toFixed(2)}h) au-dessus du seuil de ${state.params.seuilSemaine}h/semaine.</div>` : ""}
      ${moyenneDepassee ? `<div class="alert-banner">⚠️ Moyenne de ${moyenneDepassee.toFixed(2)}h/semaine sur les ${state.params.nbSemainesMoyenne} dernières semaines (seuil : ${state.params.seuilMoyenne}h) — sur ce dispositif uniquement.</div>` : ""}

      ${data.submitted ? `<div class="stat-chip ok" style="width:fit-content">✓ Semaine marquée comme terminée</div>` : ""}

      <div class="table-wrap">
        <table>
          <thead><tr>
            <th style="min-width:200px">Tâche</th>
            <th style="width:60px">Prévu</th>
            ${DAYS.map(d => `<th style="text-align:center">${DAY_LABELS[d]}</th>`).join("")}
            <th style="width:70px">Total</th>
            <th></th>
          </tr></thead>
          <tbody>
            ${data.lignes.length === 0 ? `<tr><td colspan="11" class="empty-row">Aucune ligne — ajoute-en une ci-dessous, ou configure un modèle dans Paramètres.</td></tr>` :
              data.lignes.map((l, i) => {
                const ligneTotal = DAYS.reduce((s, d) => s + (parseFloat(l.jours[d]) || 0), 0);
                return `
                <tr>
                  <td><input data-ligne-label="${i}" value="${esc(l.label)}" style="width:100%"></td>
                  <td>${l.prevu !== undefined ? l.prevu + "h" : "—"}</td>
                  ${DAYS.map(d => `<td><input type="number" step="0.25" min="0" data-ligne-jour="${i}-${d}" value="${l.jours[d] || ''}" placeholder="0" style="width:52px;text-align:center"></td>`).join("")}
                  <td style="text-align:center;font-weight:700">${ligneTotal.toFixed(2)}</td>
                  <td><button class="del-btn" data-del-ligne="${i}">🗑️</button></td>
                </tr>`;
              }).join("")}
          </tbody>
          <tfoot>
            <tr style="font-weight:700">
              <td colspan="2">Total / jour</td>
              ${DAYS.map(d => `<td style="text-align:center">${totals[d].toFixed(2)}</td>`).join("")}
              <td style="text-align:center">${totalSemaine.toFixed(2)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <button class="nav-btn" id="rp-add-ligne">➕ Ajouter une ligne (heures complémentaires non prévues)</button>

      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <button class="add-btn" id="rp-save">💾 Enregistrer</button>
        <button class="nav-btn" id="rp-submit">${data.submitted ? "↩️ Rouvrir la semaine" : "✓ Marquer la semaine comme terminée"}</button>
        <span id="rp-save-status" style="font-size:12px"></span>
      </div>
    </div>
  `;

  document.getElementById("rp-prev").addEventListener("click", () => { ui.weekStart = dateKey(addDays(weekStartDate, -7)); render(); });
  document.getElementById("rp-next").addEventListener("click", () => { ui.weekStart = dateKey(addDays(weekStartDate, 7)); render(); });
  document.getElementById("rp-agent")?.addEventListener("change", (e) => {
    const uid = e.target.value;
    if (!uid) { ui.actingUid = null; ui.actingNom = null; }
    else {
      const a = state.agents.find(x => x.uid === uid);
      ui.actingUid = uid; ui.actingNom = a?.nom || a?.email;
    }
    render();
  });

  mountedContainer.querySelectorAll("[data-ligne-label]").forEach(inp => {
    inp.addEventListener("input", () => { data.lignes[inp.dataset.ligneLabel].label = inp.value; scheduleSave(id, data); });
  });
  mountedContainer.querySelectorAll("[data-ligne-jour]").forEach(inp => {
    inp.addEventListener("change", () => {
      const [i, d] = inp.dataset.ligneJour.split("-");
      data.lignes[i].jours[d] = parseFloat(inp.value) || 0;
      persist(id, data);
      renderView(id, data);
    });
  });
  mountedContainer.querySelectorAll("[data-del-ligne]").forEach(btn => {
    btn.addEventListener("click", () => {
      data.lignes.splice(parseInt(btn.dataset.delLigne, 10), 1);
      persist(id, data);
      renderView(id, data);
    });
  });
  document.getElementById("rp-add-ligne").addEventListener("click", () => {
    data.lignes.push({ label: "Autre tâche", jours: emptyDays() });
    persist(id, data);
    renderView(id, data);
  });
  document.getElementById("rp-save").addEventListener("click", () => { persist(id, data); });
  document.getElementById("rp-submit").addEventListener("click", () => {
    data.submitted = !data.submitted;
    persist(id, data);
    renderView(id, data);
  });
}

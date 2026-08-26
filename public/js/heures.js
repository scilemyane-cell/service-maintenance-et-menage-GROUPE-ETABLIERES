import { addDays, dateKey, fmtShort, esc } from "./astreinte-logic.js";
import { watchHeures, addHeures, validateHeures, deleteHeures, watchHeuresParams, saveHeuresParams } from "./heures-data.js";

// Les seuils par défaut ci-dessous ne servent que tant qu'aucun paramètre
// n'a été enregistré dans Firestore (config/heures-parametres). Un
// admin/n1 peut les modifier directement dans l'onglet Heures > Paramètres,
// sans avoir besoin de changer le code.
// ⚠️ Ce sont des seuils d'ALERTE pour aider au suivi, pas un calcul
// juridiquement certifié — à valider avec un service RH/juridique.
let params = { seuilSemaine: 42, nbSemainesMoyenne: 8, seuilMoyenne: 44 };

let state = { heures: [] };
let ui = {
  filterPerson: "Tous",
  form: { date: new Date().toISOString().slice(0, 10), heuresInterne: "", hasExterne: false, employeurExterne: "", heuresExterne: "", note: "" },
};
let unsubs = [];
let mountedContainer = null;
let mountedUser = null;

function cleanup() { unsubs.forEach(u => u()); unsubs = []; }

function weekStartKey(dateStr) {
  const d = new Date(dateStr);
  const offset = (d.getDay() + 6) % 7; // lundi = 0
  const monday = addDays(d, -offset);
  return dateKey(monday);
}

// Calcule, pour une personne, les fenêtres glissantes de N semaines dont la
// moyenne dépasse le seuil. Les semaines sans saisie comptent pour 0h (donc
// ça ne peut que sous-estimer la charge réelle si des saisies manquent).
function slidingAverageBreaches(byWeek, nbSemaines, seuil) {
  const weekKeys = Object.keys(byWeek).sort();
  if (weekKeys.length === 0) return [];
  const first = new Date(weekKeys[0]), last = new Date(weekKeys[weekKeys.length - 1]);
  const allWeeks = [];
  for (let d = new Date(first); d <= last; d = addDays(d, 7)) allWeeks.push(dateKey(d));

  const breaches = [];
  for (let i = 0; i + nbSemaines <= allWeeks.length; i++) {
    const window = allWeeks.slice(i, i + nbSemaines);
    const sum = window.reduce((s, wk) => s + (byWeek[wk] || 0), 0);
    const avg = sum / nbSemaines;
    if (avg > seuil) breaches.push({ start: window[0], end: window[window.length - 1], avg });
  }
  return breaches;
}

export function mountHeures(container, user) {
  cleanup();
  mountedContainer = container;
  mountedUser = user;
  container.innerHTML = `<div class="hint">Chargement…</div>`;
  unsubs.push(watchHeures((h) => { state.heures = h; render(); }));
  unsubs.push(watchHeuresParams((p) => { params = p; render(); }));
}

function render() {
  if (!mountedContainer || !mountedUser) return;
  const isSelfEntry = mountedUser.role === "menage" || mountedUser.role === "mi_temps";
  const isReviewer = mountedUser.role === "admin" || mountedUser.role === "n1" || mountedUser.role === "direction";

  if (isSelfEntry) return renderSelf(mountedContainer, mountedUser);
  if (isReviewer) return renderReview(mountedContainer, mountedUser);
  mountedContainer.innerHTML = `<div class="placeholder-card">Ce module n'est pas disponible pour ton rôle.</div>`;
}

// =================================================================
// Vue "Mes heures" — agent d'entretien / temps partiel
// =================================================================
function weeklyTotalsFor(uid, heures) {
  const byWeek = {};
  heures.filter(h => h.uid === uid).forEach(h => {
    const wk = weekStartKey(h.date);
    byWeek[wk] = (byWeek[wk] || 0) + (h.heuresInterne || 0) + (h.heuresExterne || 0);
  });
  return byWeek;
}

function renderSelf(container, user) {
  const mine = state.heures.filter(h => h.uid === user.uid).sort((a, b) => (a.date < b.date ? 1 : -1));
  const byWeek = weeklyTotalsFor(user.uid, state.heures);
  const overWeeks = Object.entries(byWeek).filter(([, total]) => total > params.seuilSemaine);
  const avgBreaches = slidingAverageBreaches(byWeek, params.nbSemainesMoyenne, params.seuilMoyenne);
  const currentWeekKey = weekStartKey(new Date().toISOString().slice(0, 10));
  const currentWeekTotal = byWeek[currentWeekKey] || 0;

  container.innerHTML = `
    <div class="stack">
      <div class="hero">
        <div class="hero-label">Cette semaine</div>
        <div class="hero-blocks">
          <div class="hero-block n2">
            <div><div class="hero-block-label">Total heures (nous + autre employeur)</div><div class="hero-block-value">${currentWeekTotal.toFixed(2)} h</div></div>
          </div>
        </div>
      </div>

      ${overWeeks.length ? `<div class="alert-banner">⚠️ ${overWeeks.length} semaine${overWeeks.length > 1 ? 's' : ''} au-dessus de ${params.seuilSemaine}h cumulées — vérifie avec ton responsable.</div>` : ""}
      ${avgBreaches.length ? `<div class="alert-banner">⚠️ Moyenne au-dessus de ${params.seuilMoyenne}h/semaine sur une période de ${params.nbSemainesMoyenne} semaines (ex. semaine du ${fmtShort(new Date(avgBreaches[0].start))}).</div>` : ""}

      <div class="form-card">
        <div class="form-grid">
          <label>Date<input type="date" id="h-date" value="${esc(ui.form.date)}"></label>
          <label>Heures chez nous<input type="number" step="0.25" min="0" id="h-interne" value="${esc(ui.form.heuresInterne)}" placeholder="ex. 4"></label>
        </div>
        <label style="display:flex;align-items:center;gap:8px;margin-top:14px;font-size:12px;color:var(--text-dim)">
          <input type="checkbox" id="h-has-externe" ${ui.form.hasExterne ? "checked" : ""}>
          J'ai aussi travaillé ailleurs sur cette période
        </label>
        ${ui.form.hasExterne ? `
        <div class="form-grid" style="margin-top:10px">
          <label>Autre employeur<input id="h-employeur" value="${esc(ui.form.employeurExterne)}" placeholder="nom de l'employeur"></label>
          <label>Heures chez cet employeur<input type="number" step="0.25" min="0" id="h-externe" value="${esc(ui.form.heuresExterne)}" placeholder="ex. 10"></label>
        </div>` : ""}
        <div class="form-grid" style="margin-top:10px">
          <label class="desc-field">Note (optionnel)<input id="h-note" value="${esc(ui.form.note)}"></label>
        </div>
        <button class="add-btn" id="add-heures">➕ Enregistrer</button>
      </div>

      <div class="table-wrap">
        <table>
          <thead><tr><th>Date</th><th>Chez nous</th><th>Ailleurs</th><th>Employeur</th><th>Total jour</th><th>État</th><th></th></tr></thead>
          <tbody>
            ${mine.length === 0 ? `<tr><td colspan="7" class="empty-row">Aucune saisie pour l'instant.</td></tr>` :
              mine.map(h => {
                const total = (h.heuresInterne || 0) + (h.heuresExterne || 0);
                return `<tr>
                  <td>${fmtShort(new Date(h.date))}</td>
                  <td>${h.heuresInterne || 0} h</td>
                  <td>${h.heuresExterne || 0} h</td>
                  <td>${esc(h.employeurExterne || "")}</td>
                  <td>${total} h</td>
                  <td>${h.validated ? `<span class="tag" style="background:var(--teal)">Validé</span>` : `<span class="tag" style="background:var(--panel-alt);color:var(--text-dim)">En attente</span>`}</td>
                  <td>${!h.validated ? `<button class="del-btn" data-del="${h.id}">🗑️</button>` : ""}</td>
                </tr>`;
              }).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById("h-date").addEventListener("input", (e) => { ui.form.date = e.target.value; });
  document.getElementById("h-interne").addEventListener("input", (e) => { ui.form.heuresInterne = e.target.value; });
  document.getElementById("h-note").addEventListener("input", (e) => { ui.form.note = e.target.value; });
  document.getElementById("h-has-externe").addEventListener("change", (e) => { ui.form.hasExterne = e.target.checked; render(); });
  const empEl = document.getElementById("h-employeur");
  if (empEl) empEl.addEventListener("input", (e) => { ui.form.employeurExterne = e.target.value; });
  const extEl = document.getElementById("h-externe");
  if (extEl) extEl.addEventListener("input", (e) => { ui.form.heuresExterne = e.target.value; });

  document.getElementById("add-heures").addEventListener("click", async () => {
    if (!ui.form.date || !ui.form.heuresInterne) return;
    await addHeures({
      uid: user.uid,
      personNom: user.nom || user.email,
      date: ui.form.date,
      heuresInterne: parseFloat(ui.form.heuresInterne) || 0,
      heuresExterne: ui.form.hasExterne ? (parseFloat(ui.form.heuresExterne) || 0) : 0,
      employeurExterne: ui.form.hasExterne ? ui.form.employeurExterne : "",
      note: ui.form.note,
      validated: false,
      createdBy: user.uid,
    });
    ui.form = { date: new Date().toISOString().slice(0, 10), heuresInterne: "", hasExterne: false, employeurExterne: "", heuresExterne: "", note: "" };
    render();
  });

  container.querySelectorAll("[data-del]").forEach(btn => {
    btn.addEventListener("click", async () => { await deleteHeures(btn.dataset.del); });
  });
}

// =================================================================
// Vue validation — admin / n1 / direction
// =================================================================
function renderReview(container, user) {
  const canValidate = user.role === "admin" || user.role === "n1";
  const people = ["Tous", ...new Set(state.heures.map(h => h.personNom))];
  const filtered = state.heures.filter(h => ui.filterPerson === "Tous" || h.personNom === ui.filterPerson)
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  // Alertes : semaines où une personne dépasse le seuil hebdomadaire, et
  // moyennes glissantes au-dessus du seuil paramétré.
  const byPersonWeek = {};
  state.heures.forEach(h => {
    if (!byPersonWeek[h.personNom]) byPersonWeek[h.personNom] = {};
    const wk = weekStartKey(h.date);
    byPersonWeek[h.personNom][wk] = (byPersonWeek[h.personNom][wk] || 0) + (h.heuresInterne || 0) + (h.heuresExterne || 0);
  });
  const weekOverAlerts = [];
  const avgOverAlerts = [];
  Object.entries(byPersonWeek).forEach(([person, byWeek]) => {
    Object.entries(byWeek).forEach(([wk, total]) => { if (total > params.seuilSemaine) weekOverAlerts.push(person); });
    if (slidingAverageBreaches(byWeek, params.nbSemainesMoyenne, params.seuilMoyenne).length > 0) avgOverAlerts.push(person);
  });
  const uniqueWeekOver = [...new Set(weekOverAlerts)];
  const uniqueAvgOver = [...new Set(avgOverAlerts)];

  container.innerHTML = `
    <div class="stack">
      ${canValidate ? `
      <details class="names-editor">
        <summary>⚙️ Paramètres des seuils d'alerte</summary>
        <p class="hint" style="margin-top:10px">Ces valeurs sont indicatives, à valider avec un service RH/juridique — elles ne constituent pas un calcul juridiquement certifié.</p>
        <div class="form-grid" style="margin-top:10px">
          <label>Seuil hebdomadaire (h)<input type="number" step="0.5" min="0" id="p-seuil-semaine" value="${params.seuilSemaine}"></label>
          <label>Nombre de semaines pour la moyenne<input type="number" step="1" min="1" id="p-nb-semaines" value="${params.nbSemainesMoyenne}"></label>
          <label>Seuil de moyenne (h/semaine)<input type="number" step="0.5" min="0" id="p-seuil-moyenne" value="${params.seuilMoyenne}"></label>
        </div>
        <button class="add-btn" id="save-params">💾 Enregistrer les paramètres</button>
      </details>` : ""}

      <p class="hint">Seuil actuel : ${params.seuilSemaine}h/semaine, et moyenne max de ${params.seuilMoyenne}h sur ${params.nbSemainesMoyenne} semaines glissantes.</p>
      ${uniqueWeekOver.length ? `<div class="alert-banner">⚠️ Dépassement hebdomadaire : ${uniqueWeekOver.join(", ")}</div>` : ""}
      ${uniqueAvgOver.length ? `<div class="alert-banner">⚠️ Moyenne sur ${params.nbSemainesMoyenne} semaines dépassée : ${uniqueAvgOver.join(", ")}</div>` : ""}

      <div class="filters-row">
        <label>Personne<select id="filter-person">${people.map(p => `<option value="${esc(p)}" ${ui.filterPerson === p ? 'selected' : ''}>${esc(p)}</option>`).join("")}</select></label>
      </div>

      <div class="table-wrap">
        <table>
          <thead><tr><th>Date</th><th>Personne</th><th>Chez nous</th><th>Ailleurs</th><th>Employeur</th><th>Total</th><th>État</th>${canValidate ? '<th></th>' : ''}</tr></thead>
          <tbody>
            ${filtered.length === 0 ? `<tr><td colspan="8" class="empty-row">Aucune donnée.</td></tr>` :
              filtered.map(h => {
                const total = (h.heuresInterne || 0) + (h.heuresExterne || 0);
                return `<tr>
                  <td>${fmtShort(new Date(h.date))}</td>
                  <td>${esc(h.personNom)}</td>
                  <td>${h.heuresInterne || 0} h</td>
                  <td>${h.heuresExterne || 0} h</td>
                  <td>${esc(h.employeurExterne || "")}</td>
                  <td>${total} h</td>
                  <td>${h.validated ? `<span class="tag" style="background:var(--teal)">Validé</span>` : `<span class="tag" style="background:var(--panel-alt);color:var(--text-dim)">En attente</span>`}</td>
                  ${canValidate ? `<td style="white-space:nowrap">
                    ${!h.validated ? `<button class="nav-btn" data-validate="${h.id}" style="padding:4px 10px;font-size:11px">Valider</button>` : ""}
                    <button class="del-btn" data-del="${h.id}">🗑️</button>
                  </td>` : ""}
                </tr>`;
              }).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById("filter-person").addEventListener("change", (e) => { ui.filterPerson = e.target.value; render(); });

  if (canValidate) {
    const saveBtn = document.getElementById("save-params");
    if (saveBtn) saveBtn.addEventListener("click", async () => {
      const next = {
        seuilSemaine: parseFloat(document.getElementById("p-seuil-semaine").value) || params.seuilSemaine,
        nbSemainesMoyenne: parseInt(document.getElementById("p-nb-semaines").value, 10) || params.nbSemainesMoyenne,
        seuilMoyenne: parseFloat(document.getElementById("p-seuil-moyenne").value) || params.seuilMoyenne,
      };
      await saveHeuresParams(next);
    });
    container.querySelectorAll("[data-validate]").forEach(btn => {
      btn.addEventListener("click", async () => { await validateHeures(btn.dataset.validate, user.uid); });
    });
    container.querySelectorAll("[data-del]").forEach(btn => {
      btn.addEventListener("click", async () => { await deleteHeures(btn.dataset.del); });
    });
  }
}

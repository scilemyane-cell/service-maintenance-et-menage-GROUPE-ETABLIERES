import {
  addDays, dateKey, sameDay, fmtLong, fmtShort, HOLIDAYS,
  YEAR_START, YEAR_END, computeWeeklyTitulaires, resolveDayN1, resolveDayN2,
  isAbsentOnDate, esc, initials, colorForPerson, handoverInfo,
} from "./astreinte-logic.js";
import {
  watchPeople, savePeople, watchAbsences, addAbsence, deleteAbsence,
  watchInterventions, addIntervention, deleteIntervention,
} from "./firestore-data.js";
import { watchTransferts } from "./transfert-data.js";
import { transfertBannerHTML, attachTransfertListeners } from "./transfert-ui.js";

const SITE_SUGGESTIONS = ["École", "Agropolis", "Armonia", "Résidence Valoria", "Internat Bâtiment A", "Internat Bâtiment B"];
const TYPE_SUGGESTIONS = ["Plomberie", "Électricité", "Chauffage / CVC", "Serrurerie / Accès", "Sécurité incendie", "Ascenseur", "Espaces verts", "Informatique / Réseau", "Autre"];
const PIE_COLORS = ["#D9B24C", "#3FB6AC", "#8B7CF0", "#E5533D", "#6FA8DC", "#B5C99A", "#D98BC9", "#C9A66B"];

let state = { people: { n1: ["Valentin", "Lionel"], n2: ["Technicien 1", "Technicien 2", "Technicien 3"] }, absences: [], interventions: [], transferts: [] };
let ui = {
  subtab: "calendrier",
  calYear: new Date().getFullYear(), calMonth: new Date().getMonth(),
  selectedDate: null,
  filterTech: "Tous", filterSite: "Tous",
  form: { date: new Date().toISOString().slice(0, 10), technicien: "", site: "", type: "", heures: "", description: "" },
  absForm: { person: "", start: new Date().toISOString().slice(0, 10), end: new Date().toISOString().slice(0, 10), type: "conge", note: "" },
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
  const isEditor = user.role === "admin" || user.role === "n1";
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
}

export function mountCalendrier(container, user) { startListeners(container, user, "calendrier"); }
export function mountAbsencesTab(container, user) { startListeners(container, user, "absences"); }
export function mountInterventionsTab(container, user) { startListeners(container, user, "interventions"); }
export function mountSyntheseTab(container, user) { startListeners(container, user, "synthese"); }

function renderAll() {
  if (!mountedContainer || !mountedUser) return;
  const perms = permissions(mountedUser);
  if (ui.subtab === "absences" && !perms.canSeeAbsencesTab) { mountedContainer.innerHTML = `<div class="placeholder-card">Accès non autorisé.</div>`; return; }
  if (ui.subtab === "interventions" && !perms.canSeeInterventionsTab) { mountedContainer.innerHTML = `<div class="placeholder-card">Accès non autorisé.</div>`; return; }
  if (ui.subtab === "synthese" && !perms.canSeeSynthese) { mountedContainer.innerHTML = `<div class="placeholder-card">Accès non autorisé.</div>`; return; }

  if (ui.subtab === "calendrier") return renderCalendar(mountedContainer, perms);
  if (ui.subtab === "absences") return renderAbsences(mountedContainer, perms);
  if (ui.subtab === "interventions") return renderInterventions(mountedContainer, perms);
  if (ui.subtab === "synthese") return renderSynthese(mountedContainer, perms);
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

function renderCalendar(container, perms) {
  const { titN1, titN2, scoresN1, scoresN2 } = computeWeeklyTitulaires(state.people, state.absences);
  const today = new Date();
  const todayInRange = today >= YEAR_START && today <= YEAR_END;
  const refDate = todayInRange ? today : YEAR_START;
  const n1Today = resolveDayN1(refDate, state.people, state.absences, titN1);
  const n2Today = resolveDayN2(refDate, state.people, state.absences, titN2);
  const holidayToday = HOLIDAYS.get(dateKey(refDate));
  const handover = todayInRange ? handoverInfo(refDate, state.people, state.absences, titN1, resolveDayN1) : null;
  const todayKey = dateKey(refDate);
  const confirmedRecord = state.transferts.find(t => t.id === todayKey);

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
      ${transfertBannerHTML(handover, confirmedRecord)}
      <div class="hero">
        <div class="hero-label">${todayInRange ? "Astreinte du jour" : "Aperçu — année scolaire"}</div>
        <div class="hero-blocks">
          <div class="hero-block n1">
            <div class="avatar" style="background:${colorForPerson(n1Today.assigned, state.people)}">${n1Today.assigned === 'A DÉFINIR' ? '!' : initials(n1Today.assigned)}</div>
            <div><div class="hero-block-label">Niveau 1 · réception</div><div class="hero-block-value">${esc(n1Today.assigned)}</div></div>
          </div>
          <div class="hero-block n2">
            <div class="avatar" style="background:${colorForPerson(n2Today.assigned, state.people)}">${n2Today.assigned === 'A DÉFINIR' ? '!' : initials(n2Today.assigned)}</div>
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
            return `<div class="cal-day ${inMonth ? '' : 'outside'} ${isToday ? 'today' : ''} ${isSel ? 'selected' : ''}" data-date="${dateKey(d)}">
              ${hol ? '<span class="cal-holiday-dot"></span>' : ''}
              <span class="cal-daynum">${d.getDate()}</span>
              ${a ? `<div class="cal-chips">
                <span class="cal-chip ${a.assigned === 'A DÉFINIR' ? 'def' : ''}" style="${a.assigned !== 'A DÉFINIR' ? `background:${colorForPerson(a.assigned, state.people)}` : ''}">${a.assigned === 'A DÉFINIR' ? 'N1 !' : initials(a.assigned)}</span>
                <span class="cal-chip ${b.assigned === 'A DÉFINIR' ? 'def' : ''}" style="${b.assigned !== 'A DÉFINIR' ? `background:${colorForPerson(b.assigned, state.people)}` : ''}">${b.assigned === 'A DÉFINIR' ? 'N2 !' : initials(b.assigned)}</span>
              </div>` : ""}
            </div>`;
          }).join("")}
        </div>
      </div>

      <div class="day-detail">
        <div class="day-detail-title">${fmtLong(selected)}</div>
        <div class="day-detail-row"><div class="avatar" style="background:${colorForPerson(selN1.assigned, state.people)}">${selN1.assigned === 'A DÉFINIR' ? '!' : initials(selN1.assigned)}</div> Niveau 1 : <b>${esc(selN1.assigned)}</b></div>
        <div class="day-detail-row"><div class="avatar" style="background:${colorForPerson(selN2.assigned, state.people)}">${selN2.assigned === 'A DÉFINIR' ? '!' : initials(selN2.assigned)}</div> Niveau 2 : <b>${esc(selN2.assigned)}</b></div>
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
  clearCountdown = attachTransfertListeners(container, handover, mountedUser, () => renderAll());
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
function renderInterventions(container, perms) {
  const technicians = state.people.n2;
  const sorted = [...state.interventions].sort((a, b) => (a.date < b.date ? 1 : -1));
  const isLockedTech = perms.isTech && !perms.isEditor;

  container.innerHTML = `
    <div class="stack">
      ${perms.canLogIntervention ? `
      <div class="form-card">
        <div class="form-grid">
          <label>Date<input type="date" id="f-date" value="${esc(ui.form.date)}"></label>
          <label>Technicien
            ${isLockedTech
              ? `<input value="${esc(ui.form.technicien)}" disabled>`
              : `<select id="f-tech">${technicians.map(t => `<option value="${esc(t)}" ${ui.form.technicien === t ? 'selected' : ''}>${esc(t)}</option>`).join("")}</select>`}
          </label>
          <label>Site<input id="f-site" list="sites" value="${esc(ui.form.site)}" placeholder="ex. Résidence Valoria"><datalist id="sites">${SITE_SUGGESTIONS.map(s => `<option value="${esc(s)}">`).join("")}</datalist></label>
          <label>Type<input id="f-type" list="types" value="${esc(ui.form.type)}" placeholder="ex. Plomberie"><datalist id="types">${TYPE_SUGGESTIONS.map(t => `<option value="${esc(t)}">`).join("")}</datalist></label>
          <label>Heures<input type="number" step="0.25" min="0" id="f-heures" value="${esc(ui.form.heures)}" placeholder="ex. 1.5"></label>
          <label class="desc-field">Description<input id="f-desc" value="${esc(ui.form.description)}" placeholder="détail rapide"></label>
        </div>
        <button class="add-btn" id="add-interv">➕ Ajouter l'intervention</button>
      </div>` : ""}
      <div class="table-wrap">
        <table>
          <thead><tr><th>Date</th><th>Technicien</th><th>Site</th><th>Type</th><th>Heures</th><th>Description</th><th></th></tr></thead>
          <tbody>
            ${sorted.length === 0 ? `<tr><td colspan="7" class="empty-row">Aucune intervention enregistrée.</td></tr>` :
              sorted.map(i => {
                const canDelete = perms.isEditor || i.createdBy === mountedUser.uid;
                return `<tr>
                  <td>${new Date(i.date).toLocaleDateString("fr-FR")}</td><td>${esc(i.technicien)}</td><td>${esc(i.site)}</td><td>${esc(i.type)}</td>
                  <td>${i.heures} h</td><td>${esc(i.description)}</td>
                  <td>${canDelete ? `<button class="del-btn" data-del="${i.id}">🗑️</button>` : ""}</td>
                </tr>`;
              }).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;

  if (perms.canLogIntervention) {
    ["date", "site", "type", "heures", "desc"].forEach(field => {
      const el = document.getElementById("f-" + field); if (!el) return;
      el.addEventListener("input", () => { const key = field === "desc" ? "description" : field; ui.form[key] = el.value; });
    });
    if (!isLockedTech) {
      const techEl = document.getElementById("f-tech");
      if (techEl) techEl.addEventListener("input", () => { ui.form.technicien = techEl.value; });
    }
    document.getElementById("add-interv").addEventListener("click", async () => {
      if (!ui.form.site || !ui.form.type || !ui.form.heures) return;
      await addIntervention({
        date: ui.form.date, technicien: ui.form.technicien, site: ui.form.site,
        type: ui.form.type, heures: parseFloat(ui.form.heures), description: ui.form.description,
        createdBy: mountedUser.uid, createdByName: mountedUser.nom || mountedUser.email,
      });
      ui.form.site = ""; ui.form.type = ""; ui.form.heures = ""; ui.form.description = "";
      renderAll();
    });
    container.querySelectorAll("[data-del]").forEach(btn => {
      btn.addEventListener("click", async () => { await deleteIntervention(btn.dataset.del); });
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

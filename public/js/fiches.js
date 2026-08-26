import { addDays, dateKey, fmtShort, esc } from "./astreinte-logic.js";
import { SITES, findSite } from "./sites-config.js";
import { watchFiches, saveFiche, ficheId } from "./fiches-data.js";

const DAY_LABELS = { LUN: "Lun", MAR: "Mar", MER: "Mer", JEU: "Jeu", VEN: "Ven" };

let state = { fiches: [] };
let ui = { siteId: SITES[0].id, weekStart: null };
let unsubs = [];
let mountedContainer = null;
let mountedUser = null;
let saveTimer = null;

function cleanup() { unsubs.forEach(u => u()); unsubs = []; }

function mondayOf(date) {
  const offset = (date.getDay() + 6) % 7;
  return addDays(date, -offset);
}

export function mountFiches(container, user) {
  cleanup();
  mountedContainer = container;
  mountedUser = user;
  if (!ui.weekStart) ui.weekStart = dateKey(mondayOf(new Date()));
  container.innerHTML = `<div class="hint">Chargement…</div>`;
  unsubs.push(watchFiches((f) => { state.fiches = f; render(); }));
}

function currentFiche() {
  const site = findSite(ui.siteId);
  const id = ficheId(ui.siteId, ui.weekStart, mountedUser.uid);
  const existing = state.fiches.find(f => f.id === id);
  if (existing) return { id, data: existing };
  return {
    id,
    data: {
      siteId: site.id, siteName: site.name,
      weekStart: ui.weekStart, weekEnd: dateKey(addDays(new Date(ui.weekStart), 4)),
      agentUid: mountedUser.uid, agentNom: mountedUser.nom || mountedUser.email,
      cells: {}, obs: {}, chambres: [], observationsGenerales: "",
      submitted: false,
    },
  };
}

function scheduleSave(id, data) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveFiche(id, data); }, 500);
}

function render() {
  if (!mountedContainer) return;
  const site = findSite(ui.siteId);
  const weekStartDate = new Date(ui.weekStart);
  const weekEndDate = addDays(weekStartDate, 4);
  const { id, data } = currentFiche();

  mountedContainer.innerHTML = `
    <div class="stack">
      <div class="form-card">
        <div class="form-grid">
          <label>Site
            <select id="fc-site">${SITES.map(s => `<option value="${s.id}" ${s.id === ui.siteId ? 'selected' : ''}>${esc(s.name)}</option>`).join("")}</select>
          </label>
          <label>Semaine
            <div style="display:flex;align-items:center;gap:8px">
              <button class="nav-btn" id="fc-prev">‹</button>
              <span style="font-size:13px;white-space:nowrap">${fmtShort(weekStartDate)} → ${fmtShort(weekEndDate)}</span>
              <button class="nav-btn" id="fc-next">›</button>
            </div>
          </label>
          <label>Agent<input value="${esc(data.agentNom)}" disabled></label>
        </div>
      </div>

      ${data.submitted ? `<div class="stat-chip ok" style="width:fit-content">✓ Fiche marquée comme terminée pour cette semaine</div>` : ""}

      ${site.rooms.map((room, ri) => `
        <div class="form-card">
          <h3 style="margin:0 0 12px;font-size:14px;color:var(--gold)">${esc(room.name)}</h3>
          <div class="table-wrap" style="border:none">
            <table>
              <thead><tr>
                <th style="min-width:220px">Tâche</th>
                ${room.days.map(d => `<th style="text-align:center">${DAY_LABELS[d]}</th>`).join("")}
                <th>Observation</th>
              </tr></thead>
              <tbody>
                ${room.tasks.map((task, ti) => `
                  <tr>
                    <td>${esc(task.label)}${task.freq ? ` <span style="color:var(--text-dim);font-size:11px">(${esc(task.freq)})</span>` : ""}</td>
                    ${room.days.map(d => {
                      const key = `${ri}-${ti}-${d}`;
                      const checked = !!data.cells[key];
                      return `<td style="text-align:center"><input type="checkbox" data-cell="${key}" ${checked ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--gold)"></td>`;
                    }).join("")}
                    <td><input data-obs="${ri}-${ti}" value="${esc(data.obs[`${ri}-${ti}`] || "")}" style="min-width:140px" placeholder="—"></td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        </div>
      `).join("")}

      ${site.literie ? `
      <div class="form-card">
        <h3 style="margin:0 0 12px;font-size:14px;color:var(--gold)">Literie sur demande</h3>
        <div class="table-wrap" style="border:none">
          <table>
            <thead><tr><th>Chambre</th><th>Date</th><th>Observation</th><th></th></tr></thead>
            <tbody id="fc-chambres-body">
              ${data.chambres.map((c, i) => `
                <tr>
                  <td><input data-chambre-field="chambre" data-chambre-idx="${i}" value="${esc(c.chambre)}"></td>
                  <td><input type="date" data-chambre-field="date" data-chambre-idx="${i}" value="${esc(c.date || "")}"></td>
                  <td><input data-chambre-field="observation" data-chambre-idx="${i}" value="${esc(c.observation || "")}"></td>
                  <td><button class="del-btn" data-del-chambre="${i}">🗑️</button></td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
        <button class="nav-btn" id="fc-add-chambre" style="margin-top:10px">➕ Ajouter une chambre</button>
      </div>` : ""}

      <div class="form-card">
        <label style="display:block;font-size:11px;color:var(--text-dim);margin-bottom:6px">Observations générales</label>
        <textarea id="fc-obs-generales" rows="3" style="width:100%;background:var(--panel-alt);border:1px solid var(--border);border-radius:7px;padding:9px 10px;color:var(--text);font-size:13px;font-family:inherit">${esc(data.observationsGenerales)}</textarea>
      </div>

      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="add-btn" id="fc-save">💾 Enregistrer</button>
        <button class="nav-btn" id="fc-submit">${data.submitted ? "↩️ Rouvrir la fiche" : "✓ Marquer la semaine comme terminée"}</button>
      </div>
    </div>
  `;

  document.getElementById("fc-site").addEventListener("change", (e) => { ui.siteId = e.target.value; render(); });
  document.getElementById("fc-prev").addEventListener("click", () => { ui.weekStart = dateKey(addDays(weekStartDate, -7)); render(); });
  document.getElementById("fc-next").addEventListener("click", () => { ui.weekStart = dateKey(addDays(weekStartDate, 7)); render(); });

  mountedContainer.querySelectorAll("[data-cell]").forEach(cb => {
    cb.addEventListener("change", () => {
      data.cells[cb.dataset.cell] = cb.checked;
      scheduleSave(id, data);
    });
  });
  mountedContainer.querySelectorAll("[data-obs]").forEach(inp => {
    inp.addEventListener("input", () => {
      data.obs[inp.dataset.obs] = inp.value;
      scheduleSave(id, data);
    });
  });
  mountedContainer.querySelectorAll("[data-chambre-field]").forEach(inp => {
    inp.addEventListener("input", () => {
      const idx = parseInt(inp.dataset.chambreIdx, 10);
      data.chambres[idx][inp.dataset.chambreField] = inp.value;
      scheduleSave(id, data);
    });
  });
  document.getElementById("fc-add-chambre")?.addEventListener("click", () => {
    data.chambres.push({ chambre: "", date: "", observation: "" });
    saveFiche(id, data);
    render();
  });
  mountedContainer.querySelectorAll("[data-del-chambre]").forEach(btn => {
    btn.addEventListener("click", () => {
      data.chambres.splice(parseInt(btn.dataset.delChambre, 10), 1);
      saveFiche(id, data);
      render();
    });
  });
  document.getElementById("fc-obs-generales").addEventListener("input", (e) => {
    data.observationsGenerales = e.target.value;
    scheduleSave(id, data);
  });
  document.getElementById("fc-save").addEventListener("click", () => { saveFiche(id, data); });
  document.getElementById("fc-submit").addEventListener("click", () => {
    data.submitted = !data.submitted;
    saveFiche(id, data);
    render();
  });
}

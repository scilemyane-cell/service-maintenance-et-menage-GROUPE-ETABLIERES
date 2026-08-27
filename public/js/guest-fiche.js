import { addDays, dateKey, fmtShort, esc } from "./astreinte-logic.js";
import { watchSites } from "./sites-data.js";
import { watchFiches, saveFiche, ficheId } from "./fiches-data.js";

const DAY_LABELS = { LUN: "Lun", MAR: "Mar", MER: "Mer", JEU: "Jeu", VEN: "Ven" };

let state = { sites: [], fiches: [] };
let ui = { weekStart: null };
let unsubs = [];
let mountedContainer = null;
let mountedUser = null;
let mountedInvitation = null;
let saveTimer = null;

function cleanup() { unsubs.forEach(u => u()); unsubs = []; }

export function mountGuestFiche(container, user, invitation) {
  cleanup();
  mountedContainer = container;
  mountedUser = user;
  mountedInvitation = invitation;
  ui.weekStart = invitation.weeks[0];
  container.innerHTML = `<div class="hint">Chargement…</div>`;
  unsubs.push(watchSites((s) => { state.sites = s; render(); }));
  unsubs.push(watchFiches((f) => { state.fiches = f; render(); }));
}

function currentFiche() {
  const site = state.sites.find(s => s.id === mountedInvitation.siteId);
  const id = ficheId(mountedInvitation.siteId, ui.weekStart, mountedUser.uid);
  const existing = state.fiches.find(f => f.id === id);
  if (existing) return { id, data: existing, site };
  return {
    id,
    site,
    data: {
      siteId: mountedInvitation.siteId, siteName: mountedInvitation.siteName,
      weekStart: ui.weekStart, weekEnd: dateKey(addDays(new Date(ui.weekStart), 4)),
      agentUid: mountedUser.uid, agentNom: mountedInvitation.label + " (remplaçant)",
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
  if (!document.contains(mountedContainer)) { cleanup(); return; }
  const { id, data, site } = currentFiche();
  if (!site) { mountedContainer.innerHTML = `<div class="hint">Site introuvable.</div>`; return; }
  const weekStartDate = new Date(ui.weekStart);
  const weekEndDate = addDays(weekStartDate, 4);

  mountedContainer.innerHTML = `
    <div class="stack">
      ${mountedInvitation.weeks.length > 1 ? `
      <div class="form-card">
        <label style="font-size:11px;color:var(--text-dim)">Semaine à remplir</label>
        <select id="gf-week" style="margin-top:6px;background:var(--panel-alt);border:1px solid var(--border);border-radius:7px;padding:8px 10px;color:var(--text);font-size:13px">
          ${mountedInvitation.weeks.map(w => `<option value="${w}" ${w === ui.weekStart ? 'selected' : ''}>${fmtShort(new Date(w))} → ${fmtShort(addDays(new Date(w), 4))}</option>`).join("")}
        </select>
      </div>` : `<p class="hint">Semaine du ${fmtShort(weekStartDate)} au ${fmtShort(weekEndDate)}</p>`}

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

      <div class="form-card">
        <label style="display:block;font-size:11px;color:var(--text-dim);margin-bottom:6px">Observations générales</label>
        <textarea id="gf-obs-generales" rows="3" style="width:100%;background:var(--panel-alt);border:1px solid var(--border);border-radius:7px;padding:9px 10px;color:var(--text);font-size:13px;font-family:inherit">${esc(data.observationsGenerales)}</textarea>
      </div>

      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="add-btn" id="gf-save">💾 Enregistrer</button>
        <button class="nav-btn" id="gf-submit">${data.submitted ? "↩️ Rouvrir la fiche" : "✓ Marquer la semaine comme terminée"}</button>
      </div>
    </div>
  `;

  document.getElementById("gf-week")?.addEventListener("change", (e) => { ui.weekStart = e.target.value; render(); });

  mountedContainer.querySelectorAll("[data-cell]").forEach(cb => {
    cb.addEventListener("change", () => { data.cells[cb.dataset.cell] = cb.checked; scheduleSave(id, data); });
  });
  mountedContainer.querySelectorAll("[data-obs]").forEach(inp => {
    inp.addEventListener("input", () => { data.obs[inp.dataset.obs] = inp.value; scheduleSave(id, data); });
  });
  document.getElementById("gf-obs-generales").addEventListener("input", (e) => {
    data.observationsGenerales = e.target.value; scheduleSave(id, data);
  });
  document.getElementById("gf-save").addEventListener("click", () => { saveFiche(id, data); });
  document.getElementById("gf-submit").addEventListener("click", () => {
    data.submitted = !data.submitted;
    saveFiche(id, data);
    render();
  });
}

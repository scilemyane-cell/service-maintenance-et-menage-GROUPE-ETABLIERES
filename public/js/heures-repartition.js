import { addDays, dateKey, fmtShort, esc } from "./astreinte-logic.js";
import { watchDispositifSettings, templateFor } from "./dispositif-settings-data.js";
import { watchRepartitions, saveRepartition, repartitionId } from "./heures-repartition-data.js";
import { watchUsers } from "./users-data.js";

const MENAGE_ROLES = ["menage", "mi_temps"];

let state = { settings: {}, repartitions: [], agents: [] };
let ui = { weekStart: null, actingUid: null, actingNom: null };
let unsubs = [];
let mountedContainer = null;
let mountedUser = null;
let mountedDispositif = null;
let saveTimer = null;

function cleanup() { unsubs.forEach(u => u()); unsubs = []; }
function isEditorUser(user) { return user && (user.role === "admin" || user.role === "n1"); }

function mondayOf(date) {
  const offset = (date.getDay() + 6) % 7;
  return addDays(date, -offset);
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
}

function effectiveAgent() {
  if (isEditorUser(mountedUser) && ui.actingUid) return { uid: ui.actingUid, nom: ui.actingNom };
  return { uid: mountedUser.uid, nom: mountedUser.nom || mountedUser.email };
}

function currentRecord() {
  const agent = effectiveAgent();
  const id = repartitionId(mountedDispositif, ui.weekStart, agent.uid);
  const existing = state.repartitions.find(r => r.id === id);
  if (existing) return { id, data: existing };
  const template = templateFor(state.settings, mountedDispositif);
  return {
    id,
    data: {
      dispositif: mountedDispositif,
      weekStart: ui.weekStart, weekEnd: dateKey(addDays(new Date(ui.weekStart), 4)),
      agentUid: agent.uid, agentNom: agent.nom,
      lignes: template.map(t => ({ label: t.label, prevu: t.heures, heures: t.heures })),
    },
  };
}

function scheduleSave(id, data) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveRepartition(id, data); }, 500);
}

function render() {
  if (!mountedContainer) return;
  const { id, data } = currentRecord();
  const weekStartDate = new Date(ui.weekStart);
  const weekEndDate = addDays(weekStartDate, 4);
  const totalPrevu = data.lignes.reduce((s, l) => s + (l.prevu || 0), 0);
  const totalReel = data.lignes.reduce((s, l) => s + (parseFloat(l.heures) || 0), 0);

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

      <p class="hint">Répartition pré-remplie selon le modèle hebdomadaire de ce dispositif (${totalPrevu}h prévues). Les heures réelles sont modulables : ajuste-les selon la semaine, et ajoute une ligne pour toute heure supplémentaire non prévue.</p>

      <div class="table-wrap">
        <table>
          <thead><tr><th>Tâche</th><th style="width:100px">Prévu</th><th style="width:120px">Heures réelles</th><th></th></tr></thead>
          <tbody>
            ${data.lignes.length === 0 ? `<tr><td colspan="4" class="empty-row">Aucun modèle défini pour ce dispositif — ajoute des lignes manuellement, ou configure un modèle dans Paramètres.</td></tr>` :
              data.lignes.map((l, i) => `
                <tr>
                  <td><input data-ligne-label="${i}" value="${esc(l.label)}" style="width:100%"></td>
                  <td>${l.prevu !== undefined ? l.prevu + " h" : "—"}</td>
                  <td><input type="number" step="0.25" min="0" data-ligne-heures="${i}" value="${l.heures}" style="width:100%"></td>
                  <td><button class="del-btn" data-del-ligne="${i}">🗑️</button></td>
                </tr>
              `).join("")}
          </tbody>
        </table>
      </div>
      <button class="nav-btn" id="rp-add-ligne">➕ Ajouter une ligne (heures supplémentaires)</button>

      <div class="stat-chip" style="width:fit-content">Total réel cette semaine : <b>${totalReel.toFixed(2)} h</b>${totalPrevu ? ` (modèle : ${totalPrevu}h)` : ""}</div>

      <div style="display:flex;align-items:center;gap:10px">
        <button class="add-btn" id="rp-save">💾 Enregistrer</button>
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
  mountedContainer.querySelectorAll("[data-ligne-heures]").forEach(inp => {
    inp.addEventListener("input", () => {
      data.lignes[inp.dataset.ligneHeures].heures = parseFloat(inp.value) || 0;
      scheduleSave(id, data);
      const totalEl = mountedContainer.querySelector(".stat-chip b");
      if (totalEl) totalEl.textContent = data.lignes.reduce((s, l) => s + (parseFloat(l.heures) || 0), 0).toFixed(2) + " h";
    });
  });
  mountedContainer.querySelectorAll("[data-del-ligne]").forEach(btn => {
    btn.addEventListener("click", () => {
      data.lignes.splice(parseInt(btn.dataset.delLigne, 10), 1);
      saveRepartition(id, data);
      render();
    });
  });
  document.getElementById("rp-add-ligne").addEventListener("click", () => {
    data.lignes.push({ label: "Heures supplémentaires", heures: 0 });
    render();
  });
  document.getElementById("rp-save").addEventListener("click", async () => {
    const statusEl = document.getElementById("rp-save-status");
    statusEl.innerHTML = `<span style="color:var(--text-dim)">⏳ Enregistrement…</span>`;
    try { await saveRepartition(id, data); statusEl.innerHTML = `<span style="color:var(--teal)">✓ Enregistré</span>`; }
    catch (e) { statusEl.innerHTML = `<span style="color:var(--red)">❌ Échec : ${esc(e.message || String(e))}</span>`; }
  });
}

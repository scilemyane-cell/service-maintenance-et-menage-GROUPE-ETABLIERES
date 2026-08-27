import { addDays, dateKey, fmtShort, esc } from "./astreinte-logic.js";
import { watchRepartitions, saveRepartition } from "./heures-repartition-data.js";

const DAYS = ["LUN", "MAR", "MER", "JEU", "VEN", "SAM", "DIM"];
const DAY_LABELS = { LUN: "Lun", MAR: "Mar", MER: "Mer", JEU: "Jeu", VEN: "Ven", SAM: "Sam", DIM: "Dim" };

let state = { repartitions: [] };
let ui = { filterAgent: "Tous", openId: null };
let unsubs = [];
let mountedContainer = null;
let mountedDispositif = null;

function cleanup() { unsubs.forEach(u => u()); unsubs = []; }

function weekTotal(record) {
  return record.lignes.reduce((s, l) => s + DAYS.reduce((s2, d) => s2 + (parseFloat(l.jours?.[d]) || 0), 0), 0);
}

export function mountArchiveForDispositif(container, user, dispositif) {
  cleanup();
  mountedContainer = container;
  mountedDispositif = dispositif;
  ui.filterAgent = "Tous";
  ui.openId = null;
  container.innerHTML = `<div class="hint">Chargement…</div>`;
  unsubs.push(watchRepartitions((r) => { state.repartitions = r; render(); }));
}

function render() {
  if (!mountedContainer) return;
  if (!document.contains(mountedContainer)) { cleanup(); return; }
  const validated = state.repartitions
    .filter(r => r.dispositif === mountedDispositif && r.valide)
    .sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1));

  const agents = ["Tous", ...new Set(validated.map(r => r.agentNom))];
  const filtered = ui.filterAgent === "Tous" ? validated : validated.filter(r => r.agentNom === ui.filterAgent);
  const totalGeneral = filtered.reduce((s, r) => s + weekTotal(r), 0);
  const opened = ui.openId ? validated.find(r => r.id === ui.openId) : null;

  mountedContainer.innerHTML = `
    <div class="stack">
      <p class="hint">Semaines dont les heures ont été validées pour paiement (dispositif : ${esc(mountedDispositif)}).</p>

      <div class="filters-row">
        <label>Agent<select id="ar-agent">${agents.map(a => `<option ${ui.filterAgent === a ? 'selected' : ''}>${esc(a)}</option>`).join("")}</select></label>
      </div>

      <div class="stat-chip ok" style="width:fit-content">Total validé (filtre actuel) : ${totalGeneral.toFixed(2)} h sur ${filtered.length} semaine${filtered.length > 1 ? 's' : ''}</div>

      <div class="table-wrap">
        <table>
          <thead><tr><th>Semaine</th><th>Agent</th><th>Total</th><th></th></tr></thead>
          <tbody>
            ${filtered.length === 0 ? `<tr><td colspan="4" class="empty-row">Aucune semaine validée pour l'instant.</td></tr>` :
              filtered.map(r => `
                <tr>
                  <td>${fmtShort(new Date(r.weekStart))} → ${fmtShort(new Date(r.weekEnd))}</td>
                  <td>${esc(r.agentNom)}</td>
                  <td>${weekTotal(r).toFixed(2)} h</td>
                  <td style="white-space:nowrap">
                    <button class="nav-btn" data-open="${r.id}" style="padding:4px 10px;font-size:11px">Voir</button>
                    <button class="del-btn" data-devalider="${r.id}" title="Retirer la validation">↩️</button>
                  </td>
                </tr>
              `).join("")}
          </tbody>
        </table>
      </div>

      ${opened ? `
      <div class="form-card">
        <h3 style="margin:0 0 10px;font-size:14px;color:var(--gold)">${esc(opened.agentNom)} — ${fmtShort(new Date(opened.weekStart))} → ${fmtShort(new Date(opened.weekEnd))}</h3>
        <div class="table-wrap" style="border:none">
          <table>
            <thead><tr>
              <th>Tâche</th>
              ${DAYS.map(d => `<th style="text-align:center">${DAY_LABELS[d]}</th>`).join("")}
              <th>Total</th>
            </tr></thead>
            <tbody>
              ${opened.lignes.map(l => {
                const t = DAYS.reduce((s, d) => s + (parseFloat(l.jours?.[d]) || 0), 0);
                return `<tr>
                  <td>${esc(l.label)}</td>
                  ${DAYS.map(d => `<td style="text-align:center">${l.jours?.[d] || 0}</td>`).join("")}
                  <td style="font-weight:700">${t.toFixed(2)}</td>
                </tr>`;
              }).join("")}
            </tbody>
          </table>
        </div>
      </div>` : ""}
    </div>
  `;

  document.getElementById("ar-agent").addEventListener("change", (e) => { ui.filterAgent = e.target.value; render(); });
  mountedContainer.querySelectorAll("[data-open]").forEach(btn => {
    btn.addEventListener("click", () => { ui.openId = ui.openId === btn.dataset.open ? null : btn.dataset.open; render(); });
  });
  mountedContainer.querySelectorAll("[data-devalider]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const record = state.repartitions.find(r => r.id === btn.dataset.devalider);
      if (record && confirm("Retirer la validation de cette semaine ?")) {
        await saveRepartition(record.id, { ...record, valide: false });
      }
    });
  });
}

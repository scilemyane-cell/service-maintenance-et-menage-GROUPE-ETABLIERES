import { fmtShort, esc } from "./astreinte-logic.js";
import { watchSites } from "./sites-data.js";
import { watchFiches } from "./fiches-data.js";

let state = { fiches: [], sites: [] };
let ui = { filterDispositif: "Tous", filterSite: "Tous", filterAgent: "Tous", openId: null };
let unsubs = [];
let mountedContainer = null;
let lockedDispositif = null;

function cleanup() { unsubs.forEach(u => u()); unsubs = []; }

function siteDispositif(site) { return site?.dispositif || "Dispositif MNA"; }
function ficheDispositif(fiche) { return siteDispositif(state.sites.find(s => s.id === fiche.siteId)); }

export function mountTracabilite(container) {
  lockedDispositif = null;
  ui.filterDispositif = "Tous";
  mountInternal(container);
}

// Version verrouillée sur un seul dispositif (pas de sélecteur de dispositif ni de site)
export function mountTracabiliteForDispositif(container, dispositif) {
  lockedDispositif = dispositif;
  ui.filterDispositif = dispositif;
  mountInternal(container);
}

function mountInternal(container) {
  cleanup();
  mountedContainer = container;
  container.innerHTML = `<div class="hint">Chargement…</div>`;
  unsubs.push(watchSites((s) => { state.sites = s; render(); }));
  unsubs.push(watchFiches((f) => { state.fiches = f; render(); }));
}

function taskCompletion(fiche, site) {
  if (!site) return { done: 0, total: 0 };
  let done = 0, total = 0;
  site.rooms.forEach((room, ri) => {
    room.tasks.forEach((task, ti) => {
      room.days.forEach(d => {
        total++;
        if (fiche.cells && fiche.cells[`${ri}-${ti}-${d}`]) done++;
      });
    });
  });
  return { done, total };
}

function render() {
  if (!mountedContainer) return;
  const dispositifs = ["Tous", ...new Set(state.sites.map(siteDispositif))];
  const agents = ["Tous", ...new Set(state.fiches.map(f => f.agentNom))];
  const sitesForFilter = ui.filterDispositif === "Tous" ? state.sites : state.sites.filter(s => siteDispositif(s) === ui.filterDispositif);
  const siteNames = ["Tous", ...sitesForFilter.map(s => s.name)];
  const filtered = state.fiches
    .filter(f => ui.filterDispositif === "Tous" || ficheDispositif(f) === ui.filterDispositif)
    .filter(f => ui.filterSite === "Tous" || f.siteName === ui.filterSite)
    .filter(f => ui.filterAgent === "Tous" || f.agentNom === ui.filterAgent)
    .sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1));

  const opened = ui.openId ? state.fiches.find(f => f.id === ui.openId) : null;
  const openedSite = opened ? state.sites.find(s => s.id === opened.siteId) : null;

  mountedContainer.innerHTML = `
    <div class="stack">
      <div class="filters-row">
        ${!lockedDispositif ? `<label>Dispositif<select id="tr-disp">${dispositifs.map(d => `<option ${ui.filterDispositif === d ? 'selected' : ''}>${esc(d)}</option>`).join("")}</select></label>` : ""}
        <label>Site<select id="tr-site">${siteNames.map(s => `<option ${ui.filterSite === s ? 'selected' : ''}>${esc(s)}</option>`).join("")}</select></label>
        <label>Agent<select id="tr-agent">${agents.map(a => `<option ${ui.filterAgent === a ? 'selected' : ''}>${esc(a)}</option>`).join("")}</select></label>
      </div>

      <div class="table-wrap">
        <table>
          <thead><tr><th>Semaine</th><th>Site</th><th>Agent</th><th>Avancement</th><th>État</th><th></th></tr></thead>
          <tbody>
            ${filtered.length === 0 ? `<tr><td colspan="6" class="empty-row">Aucune fiche pour l'instant.</td></tr>` :
              filtered.map(f => {
                const site = state.sites.find(s => s.id === f.siteId);
                const { done, total } = taskCompletion(f, site);
                return `<tr>
                  <td>${fmtShort(new Date(f.weekStart))} → ${fmtShort(new Date(f.weekEnd))}</td>
                  <td>${esc(f.siteName)}</td>
                  <td>${esc(f.agentNom)}</td>
                  <td>${done}/${total}</td>
                  <td>${f.submitted ? `<span class="tag" style="background:var(--teal)">Terminée</span>` : `<span class="tag" style="background:var(--panel-alt);color:var(--text-dim)">En cours</span>`}</td>
                  <td><button class="nav-btn" data-open="${f.id}" style="padding:4px 10px;font-size:11px">Voir</button></td>
                </tr>`;
              }).join("")}
          </tbody>
        </table>
      </div>

      ${opened ? `
      <button class="add-btn" id="tr-print">🖨️ Exporter en PDF (imprimer)</button>
      <div class="form-card print-fiche">
        <h3 style="margin:0 0 10px;font-size:14px;color:var(--gold)">${esc(opened.siteName)} — ${fmtShort(new Date(opened.weekStart))} → ${fmtShort(new Date(opened.weekEnd))} — ${esc(opened.agentNom)}</h3>
        ${openedSite ? openedSite.rooms.map((room, ri) => `
          <div style="margin-bottom:14px">
            <div style="font-size:12px;font-weight:700;color:var(--text-dim);margin-bottom:4px">${esc(room.name)}</div>
            ${room.tasks.map((task, ti) => {
              const doneDays = room.days.filter(d => opened.cells && opened.cells[`${ri}-${ti}-${d}`]);
              const obs = (opened.obs && opened.obs[`${ri}-${ti}`]) || "";
              if (doneDays.length === 0 && !obs) return "";
              return `<div style="font-size:12px;padding:4px 0;border-top:1px solid var(--border)">
                <b>${esc(task.label)}</b> — ${doneDays.length ? doneDays.join(", ") : "non coché"}
                ${obs ? `<br><span style="color:var(--text-dim)">${esc(obs)}</span>` : ""}
              </div>`;
            }).join("")}
          </div>
        `).join("") : ""}
        ${opened.observationsGenerales ? `<div class="hint"><b>Observations générales :</b> ${esc(opened.observationsGenerales)}</div>` : ""}
        <div style="margin-top:20px;display:flex;justify-content:space-between;font-size:12px;color:var(--text-dim)">
          <span>Signature agent : ____________________</span>
          <span>Signature éducateur : ____________________</span>
        </div>
      </div>` : ""}
    </div>
  `;

  document.getElementById("tr-disp")?.addEventListener("change", (e) => { ui.filterDispositif = e.target.value; ui.filterSite = "Tous"; render(); });
  document.getElementById("tr-site").addEventListener("change", (e) => { ui.filterSite = e.target.value; render(); });
  document.getElementById("tr-agent").addEventListener("change", (e) => { ui.filterAgent = e.target.value; render(); });
  mountedContainer.querySelectorAll("[data-open]").forEach(btn => {
    btn.addEventListener("click", () => { ui.openId = btn.dataset.open; render(); });
  });
  document.getElementById("tr-print")?.addEventListener("click", () => { window.print(); });
}

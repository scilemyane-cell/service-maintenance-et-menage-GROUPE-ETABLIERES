import { fmtShort, esc } from "./astreinte-logic.js";
import { watchSites } from "./sites-data.js";
import { watchFiches, deleteFiche } from "./fiches-data.js";

let state = { fiches: [], sites: [] };
let ui = { filterDispositif: "Tous", filterSite: "Tous", filterAgent: "Tous", openId: null };
let unsubs = [];
let mountedContainer = null;
let mountedUser = null;
let lockedDispositif = null;

function cleanup() { unsubs.forEach(u => u()); unsubs = []; }

function siteDispositif(site) { return site?.dispositif || "Dispositif MNA"; }
function ficheDispositif(fiche) { return siteDispositif(state.sites.find(s => s.id === fiche.siteId)); }
function isEditorUser(user) { return user && (user.role === "admin" || user.role === "n1"); }

export function mountTracabilite(container, user) {
  lockedDispositif = null;
  ui.filterDispositif = "Tous";
  mountInternal(container, user);
}

// Version verrouillée sur un seul dispositif (pas de sélecteur de dispositif ni de site)
export function mountTracabiliteForDispositif(container, user, dispositif) {
  lockedDispositif = dispositif;
  ui.filterDispositif = dispositif;
  mountInternal(container, user);
}

function mountInternal(container, user) {
  cleanup();
  mountedContainer = container;
  mountedUser = user;
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
  if (!document.contains(mountedContainer)) { cleanup(); return; }
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
                  <td style="white-space:nowrap">
                    <button class="nav-btn" data-open="${f.id}" style="padding:4px 10px;font-size:11px">Voir</button>
                    ${isEditorUser(mountedUser) ? `<button class="del-btn" data-del-fiche="${f.id}">🗑️</button>` : ""}
                  </td>
                </tr>`;
              }).join("")}
          </tbody>
        </table>
      </div>

      ${opened ? `
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="add-btn" id="tr-print">🖨️ Exporter en PDF (imprimer)</button>
        <button class="nav-btn" id="tr-close">✕ Fermer l'aperçu</button>
        ${isEditorUser(mountedUser) ? `<button class="del-btn" id="tr-del-opened" style="border:1px solid var(--red);border-radius:8px;padding:9px 16px">🗑️ Supprimer cette fiche</button>` : ""}
      </div>
      <div class="print-fiche" style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:24px;color:#111">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:18px">
          <img src="img/logo-etablieres.png" alt="Groupe Établières" style="height:60px">
          <span style="font-size:13px">Le ${fmtShort(new Date())}</span>
        </div>
        <p style="font-size:14px;margin:0 0 6px">FICHE DE TRAÇABILITÉ – AGENT D'ENTRETIEN${lockedDispositif ? ` (${esc(lockedDispositif).toUpperCase()})` : ""}</p>
        <p style="font-size:13px;margin:0 0 6px">Structure : ${esc(opened.siteName).toUpperCase()}</p>
        <p style="font-size:13px;margin:0 0 18px">Date du ${fmtShort(new Date(opened.weekStart))} au ${fmtShort(new Date(opened.weekEnd))} &nbsp;&nbsp;&nbsp; Nom de l'agent : ${esc(opened.agentNom)}</p>

        ${openedSite ? openedSite.rooms.map((room, ri) => {
          const dayNames = { LUN: "LUNDI", MAR: "MARDI", MER: "MERCREDI", JEU: "JEUDI", VEN: "VENDREDI" };
          return `
          <p style="font-size:13px;font-weight:700;margin:16px 0 6px">${esc(room.name).toUpperCase()}</p>
          <table class="print-fiche-table" style="width:100%;border-collapse:collapse;margin-bottom:8px">
            <thead><tr>
              <th style="border:1px solid #999;padding:4px 6px;font-size:11px;text-align:left">TÂCHE</th>
              ${room.days.map(d => `<th style="border:1px solid #999;padding:4px 6px;font-size:11px">${dayNames[d]}</th>`).join("")}
              <th style="border:1px solid #999;padding:4px 6px;font-size:11px;text-align:left">OBSERVATIONS</th>
            </tr></thead>
            <tbody>
              ${room.tasks.map((task, ti) => `
                <tr>
                  <td style="border:1px solid #999;padding:4px 6px;font-size:11px">${esc(task.label)}${task.freq ? ` (${esc(task.freq)})` : ""}</td>
                  ${room.days.map(d => `<td style="border:1px solid #999;padding:4px 6px;font-size:12px;text-align:center">${(opened.cells && opened.cells[`${ri}-${ti}-${d}`]) ? "✓" : ""}</td>`).join("")}
                  <td style="border:1px solid #999;padding:4px 6px;font-size:11px">${esc((opened.obs && opened.obs[`${ri}-${ti}`]) || "")}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>`;
        }).join("") : ""}

        ${opened.chambres && opened.chambres.length ? `
        <p style="font-size:13px;font-weight:700;margin:16px 0 6px">LITERIE SUR DEMANDE</p>
        <table class="print-fiche-table" style="width:100%;border-collapse:collapse;margin-bottom:8px">
          <thead><tr>
            <th style="border:1px solid #999;padding:4px 6px;font-size:11px;text-align:left">CHAMBRE</th>
            <th style="border:1px solid #999;padding:4px 6px;font-size:11px;text-align:left">DATE</th>
            <th style="border:1px solid #999;padding:4px 6px;font-size:11px;text-align:left">OBSERVATIONS</th>
          </tr></thead>
          <tbody>
            ${opened.chambres.map(c => `
              <tr>
                <td style="border:1px solid #999;padding:4px 6px;font-size:11px">${esc(c.chambre)}</td>
                <td style="border:1px solid #999;padding:4px 6px;font-size:11px">${c.date ? fmtShort(new Date(c.date)) : ""}</td>
                <td style="border:1px solid #999;padding:4px 6px;font-size:11px">${esc(c.observation)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>` : ""}

        <p style="font-size:12px;margin-top:16px">OBSERVATIONS GÉNÉRALES : ${esc(opened.observationsGenerales || "")}</p>

        <div style="margin-top:36px;display:flex;justify-content:space-between;font-size:12px">
          <span>SIGNATURE AGENT</span>
          <span>SIGNATURE + NOM ÉDUCATEUR</span>
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
  document.getElementById("tr-close")?.addEventListener("click", () => { ui.openId = null; render(); });
  document.getElementById("tr-del-opened")?.addEventListener("click", async () => {
    if (confirm("Supprimer définitivement cette fiche ? Cette action est irréversible.")) {
      await deleteFiche(ui.openId);
      ui.openId = null;
      render();
    }
  });
  mountedContainer.querySelectorAll("[data-del-fiche]").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (confirm("Supprimer définitivement cette fiche ? Cette action est irréversible.")) {
        await deleteFiche(btn.dataset.delFiche);
        if (ui.openId === btn.dataset.delFiche) ui.openId = null;
        render();
      }
    });
  });
}

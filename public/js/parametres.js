import { esc, addDays, dateKey, fmtShort } from "./astreinte-logic.js";
import { watchSites, saveSites } from "./sites-data.js";
import { watchUsers, updateUser } from "./users-data.js";
import { watchInvitations, createInvitation, setInvitationActive, deleteInvitation } from "./invitations-data.js";
import { roleLabel } from "./auth.js";

const ALL_DAYS = ["LUN", "MAR", "MER", "JEU", "VEN"];

let state = { sites: [], users: [], invitations: [] };
let ui = { section: "fiches", editSiteId: null, invForm: { siteId: "", label: "", weekStart: "", nbWeeks: 1 } };
let unsubs = [];
let mountedContainer = null;
let mountedUser = null;

function cleanup() { unsubs.forEach(u => u()); unsubs = []; }

export function mountParametres(container, user) {
  cleanup();
  mountedContainer = container;
  mountedUser = user;
  container.innerHTML = `<div class="hint">Chargement…</div>`;
  unsubs.push(watchSites((s) => { state.sites = JSON.parse(JSON.stringify(s)); if (!ui.editSiteId) ui.editSiteId = s[0]?.id; render(); }));
  unsubs.push(watchUsers((u) => { state.users = u; render(); }));
  unsubs.push(watchInvitations((i) => { state.invitations = i; render(); }));
}

function render() {
  if (!mountedContainer) return;
  mountedContainer.innerHTML = `
    <div class="stack">
      <div class="tabs" style="background:none;border:none;padding:0;margin-bottom:-6px">
        <button class="tab-btn ${ui.section === 'fiches' ? 'active' : ''}" data-section="fiches">📋 Fiches ménage</button>
        <button class="tab-btn ${ui.section === 'users' ? 'active' : ''}" data-section="users">👤 Utilisateurs</button>
        <button class="tab-btn ${ui.section === 'invites' ? 'active' : ''}" data-section="invites">🔗 Accès remplaçants</button>
      </div>
      <div id="param-sub"></div>
    </div>
  `;
  mountedContainer.querySelectorAll("[data-section]").forEach(btn => {
    btn.addEventListener("click", () => { ui.section = btn.dataset.section; render(); });
  });
  const sub = document.getElementById("param-sub");
  if (ui.section === "fiches") return renderFiches(sub);
  if (ui.section === "users") return renderUsers(sub);
  if (ui.section === "invites") return renderInvites(sub);
}

// =================================================================
// Édition des fiches (pièces / tâches)
// =================================================================
function renderFiches(container) {
  const site = state.sites.find(s => s.id === ui.editSiteId) || state.sites[0];

  container.innerHTML = `
    <div class="stack">
      <div class="filters-row">
        <label>Site<select id="pf-site">${state.sites.map(s => `<option value="${s.id}" ${s.id === site?.id ? 'selected' : ''}>${esc(s.name)}</option>`).join("")}</select></label>
        <button class="nav-btn" id="pf-add-site">➕ Nouveau site</button>
      </div>

      ${site ? `
      <div class="form-card">
        <label style="font-size:11px;color:var(--text-dim)">Nom du site<input id="pf-site-name" value="${esc(site.name)}" style="margin-top:4px;background:var(--panel-alt);border:1px solid var(--border);border-radius:7px;padding:8px 10px;color:var(--text);font-size:13px;width:100%"></label>
      </div>

      ${site.rooms.map((room, ri) => `
        <div class="form-card">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px">
            <input data-room-name="${ri}" value="${esc(room.name)}" style="font-weight:700;color:var(--gold);background:var(--panel-alt);border:1px solid var(--border);border-radius:7px;padding:7px 10px;font-size:13px;flex:1">
            <button class="del-btn" data-del-room="${ri}">🗑️ Supprimer la pièce</button>
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px;font-size:11px;color:var(--text-dim)">
            Jours actifs :
            ${ALL_DAYS.map(d => `<label style="display:flex;align-items:center;gap:4px"><input type="checkbox" data-room-day="${ri}" data-day="${d}" ${room.days.includes(d) ? 'checked' : ''}> ${d}</label>`).join("")}
          </div>
          <div class="table-wrap" style="border:none">
            <table>
              <thead><tr><th>Tâche</th><th style="width:110px">Fréquence</th><th></th></tr></thead>
              <tbody>
                ${room.tasks.map((task, ti) => `
                  <tr>
                    <td><input data-task-label="${ri}-${ti}" value="${esc(task.label)}" style="width:100%"></td>
                    <td><input data-task-freq="${ri}-${ti}" value="${esc(task.freq || '')}" placeholder="ex. 1X/mois" style="width:100%"></td>
                    <td><button class="del-btn" data-del-task="${ri}-${ti}">🗑️</button></td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
          <button class="nav-btn" data-add-task="${ri}" style="margin-top:10px">➕ Ajouter une tâche</button>
        </div>
      `).join("")}

      <button class="nav-btn" id="pf-add-room">➕ Ajouter une pièce</button>
      <button class="add-btn" id="pf-save">💾 Enregistrer toutes les modifications</button>
      ` : `<p class="hint">Aucun site pour l'instant.</p>`}
    </div>
  `;

  document.getElementById("pf-site").addEventListener("change", (e) => { ui.editSiteId = e.target.value; render(); });
  document.getElementById("pf-add-site").addEventListener("click", () => {
    const id = "site-" + Date.now();
    state.sites.push({ id, name: "Nouveau site", literie: true, rooms: [] });
    ui.editSiteId = id;
    render();
  });
  if (!site) return;

  document.getElementById("pf-site-name").addEventListener("input", (e) => { site.name = e.target.value; });

  container.querySelectorAll("[data-room-name]").forEach(inp => {
    inp.addEventListener("input", () => { site.rooms[inp.dataset.roomName].name = inp.value; });
  });
  container.querySelectorAll("[data-room-day]").forEach(cb => {
    cb.addEventListener("change", () => {
      const ri = parseInt(cb.dataset.roomDay, 10), d = cb.dataset.day;
      const days = site.rooms[ri].days;
      if (cb.checked && !days.includes(d)) days.push(d);
      if (!cb.checked) site.rooms[ri].days = days.filter(x => x !== d);
      site.rooms[ri].days.sort((a, b) => ALL_DAYS.indexOf(a) - ALL_DAYS.indexOf(b));
    });
  });
  container.querySelectorAll("[data-del-room]").forEach(btn => {
    btn.addEventListener("click", () => { site.rooms.splice(parseInt(btn.dataset.delRoom, 10), 1); render(); });
  });
  container.querySelectorAll("[data-task-label]").forEach(inp => {
    inp.addEventListener("input", () => {
      const [ri, ti] = inp.dataset.taskLabel.split("-").map(Number);
      site.rooms[ri].tasks[ti].label = inp.value;
    });
  });
  container.querySelectorAll("[data-task-freq]").forEach(inp => {
    inp.addEventListener("input", () => {
      const [ri, ti] = inp.dataset.taskFreq.split("-").map(Number);
      site.rooms[ri].tasks[ti].freq = inp.value;
    });
  });
  container.querySelectorAll("[data-del-task]").forEach(btn => {
    btn.addEventListener("click", () => {
      const [ri, ti] = btn.dataset.delTask.split("-").map(Number);
      site.rooms[ri].tasks.splice(ti, 1);
      render();
    });
  });
  container.querySelectorAll("[data-add-task]").forEach(btn => {
    btn.addEventListener("click", () => {
      site.rooms[parseInt(btn.dataset.addTask, 10)].tasks.push({ label: "Nouvelle tâche", freq: "" });
      render();
    });
  });
  document.getElementById("pf-add-room").addEventListener("click", () => {
    site.rooms.push({ name: "Nouvelle pièce", days: [...ALL_DAYS], tasks: [] });
    render();
  });
  document.getElementById("pf-save").addEventListener("click", async () => {
    await saveSites(state.sites);
  });
}

// =================================================================
// Utilisateurs
// =================================================================
const ROLES = ["admin", "n1", "technicien", "menage", "mi_temps", "direction"];

function renderUsers(container) {
  container.innerHTML = `
    <div class="stack">
      <p class="hint">Modifie le nom affiché ou le rôle de chaque compte. Utile par exemple si une société externe remplace temporairement un agent.</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Email</th><th>Nom affiché</th><th>Rôle</th></tr></thead>
          <tbody>
            ${state.users.length === 0 ? `<tr><td colspan="3" class="empty-row">Aucun utilisateur.</td></tr>` :
              state.users.map(u => `
                <tr>
                  <td>${esc(u.email || "")}</td>
                  <td><input data-user-nom="${u.uid}" value="${esc(u.nom || '')}" style="min-width:160px"></td>
                  <td><select data-user-role="${u.uid}">${ROLES.map(r => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${esc(roleLabel(r))}</option>`).join("")}</select></td>
                </tr>
              `).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
  container.querySelectorAll("[data-user-nom]").forEach(inp => {
    inp.addEventListener("change", async () => { await updateUser(inp.dataset.userNom, { nom: inp.value }); });
  });
  container.querySelectorAll("[data-user-role]").forEach(sel => {
    sel.addEventListener("change", async () => { await updateUser(sel.dataset.userRole, { role: sel.value }); });
  });
}

// =================================================================
// Accès remplaçants (QR code)
// =================================================================
function weekStartOf(date) {
  const offset = (date.getDay() + 6) % 7;
  return addDays(date, -offset);
}

function renderInvites(container) {
  if (!ui.invForm.siteId && state.sites[0]) ui.invForm.siteId = state.sites[0].id;
  if (!ui.invForm.weekStart) ui.invForm.weekStart = dateKey(weekStartOf(new Date()));

  container.innerHTML = `
    <div class="stack">
      <p class="hint">Génère un lien + QR code donnant un accès limité (sans compte ni mot de passe) pour remplir les fiches d'un site sur une ou plusieurs semaines précises — utile pour un remplaçant externe.</p>

      <div class="form-card">
        <div class="form-grid">
          <label>Site<select id="pi-site">${state.sites.map(s => `<option value="${s.id}" ${s.id === ui.invForm.siteId ? 'selected' : ''}>${esc(s.name)}</option>`).join("")}</select></label>
          <label>Nom / société du remplaçant<input id="pi-label" value="${esc(ui.invForm.label)}" placeholder="ex. Société Progrès"></label>
          <label>Semaine de début<input type="date" id="pi-week" value="${esc(ui.invForm.weekStart)}"></label>
          <label>Nombre de semaines<input type="number" min="1" max="12" id="pi-nb" value="${ui.invForm.nbWeeks}"></label>
        </div>
        <button class="add-btn" id="pi-generate">🔗 Générer l'accès</button>
      </div>

      <div id="pi-result"></div>

      <div class="table-wrap">
        <table>
          <thead><tr><th>Remplaçant</th><th>Site</th><th>Semaines</th><th>État</th><th></th></tr></thead>
          <tbody>
            ${state.invitations.length === 0 ? `<tr><td colspan="5" class="empty-row">Aucun accès généré.</td></tr>` :
              state.invitations.map(inv => `
                <tr>
                  <td>${esc(inv.label)}</td>
                  <td>${esc(inv.siteName)}</td>
                  <td>${inv.weeks.length} sem. (${fmtShort(new Date(inv.weeks[0]))} → ${fmtShort(new Date(inv.weeks[inv.weeks.length - 1]))})</td>
                  <td>${inv.active ? `<span class="tag" style="background:var(--teal)">Actif</span>` : `<span class="tag" style="background:var(--panel-alt);color:var(--text-dim)">Désactivé</span>`}</td>
                  <td style="white-space:nowrap">
                    <button class="nav-btn" data-copy="${inv.id}" style="padding:4px 10px;font-size:11px">Copier le lien</button>
                    <button class="nav-btn" data-toggle="${inv.id}" data-active="${inv.active}" style="padding:4px 10px;font-size:11px">${inv.active ? "Désactiver" : "Réactiver"}</button>
                    <button class="del-btn" data-del-inv="${inv.id}">🗑️</button>
                  </td>
                </tr>
              `).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById("pi-site").addEventListener("change", (e) => { ui.invForm.siteId = e.target.value; });
  document.getElementById("pi-label").addEventListener("input", (e) => { ui.invForm.label = e.target.value; });
  document.getElementById("pi-week").addEventListener("input", (e) => { ui.invForm.weekStart = e.target.value; });
  document.getElementById("pi-nb").addEventListener("input", (e) => { ui.invForm.nbWeeks = parseInt(e.target.value, 10) || 1; });

  document.getElementById("pi-generate").addEventListener("click", async () => {
    if (!ui.invForm.label.trim()) { alert("Indique un nom ou une société pour ce remplaçant."); return; }
    const site = state.sites.find(s => s.id === ui.invForm.siteId);
    const weeks = [];
    let cur = new Date(ui.invForm.weekStart);
    for (let i = 0; i < ui.invForm.nbWeeks; i++) { weeks.push(dateKey(cur)); cur = addDays(cur, 7); }
    const token = await createInvitation({
      siteId: site.id, siteName: site.name, weeks, label: ui.invForm.label, createdBy: mountedUser.uid,
    });
    showResult(token);
  });

  container.querySelectorAll("[data-copy]").forEach(btn => {
    btn.addEventListener("click", () => copyLink(btn.dataset.copy, btn));
  });
  container.querySelectorAll("[data-toggle]").forEach(btn => {
    btn.addEventListener("click", async () => {
      await setInvitationActive(btn.dataset.toggle, btn.dataset.active !== "true");
    });
  });
  container.querySelectorAll("[data-del-inv]").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (confirm("Supprimer définitivement cet accès ?")) await deleteInvitation(btn.dataset.delInv);
    });
  });
}

function guestLink(token) {
  return `${location.origin}/guest.html?invite=${token}`;
}

function copyLink(token, btn) {
  navigator.clipboard.writeText(guestLink(token)).then(() => {
    const original = btn.textContent;
    btn.textContent = "Copié !";
    setTimeout(() => { btn.textContent = original; }, 1500);
  });
}

async function showResult(token) {
  const box = document.getElementById("pi-result");
  if (!box) return;
  const link = guestLink(token);
  box.innerHTML = `
    <div class="form-card" style="text-align:center">
      <p class="hint" style="margin-bottom:10px">Accès créé — transmets ce lien ou ce QR code au remplaçant :</p>
      <div id="pi-qr" style="display:flex;justify-content:center;margin-bottom:10px"></div>
      <div style="word-break:break-all;font-size:11px;color:var(--text-dim);margin-bottom:10px">${esc(link)}</div>
      <button class="nav-btn" id="pi-copy-new">Copier le lien</button>
    </div>
  `;
  document.getElementById("pi-copy-new").addEventListener("click", (e) => copyLink(token, e.target));
  try {
    const { toCanvas } = await import("https://cdn.jsdelivr.net/npm/qrcode@1.5.3/+esm");
    const canvas = document.createElement("canvas");
    document.getElementById("pi-qr").appendChild(canvas);
    await toCanvas(canvas, link, { width: 180, margin: 1 });
  } catch (e) {
    document.getElementById("pi-qr").innerHTML = `<span class="hint">(QR code indisponible, utilise le lien ci-dessous)</span>`;
  }
}

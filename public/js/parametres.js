import { esc, addDays, dateKey, fmtShort } from "./astreinte-logic.js";
import { watchSites, saveSites } from "./sites-data.js";
import { watchUsers, updateUser, createUserProfile } from "./users-data.js";
import { watchInvitations, createInvitation, setInvitationActive, deleteInvitation } from "./invitations-data.js";
import { watchAccess, setDispositifAccess } from "./access-data.js";
import { watchDispositifSettings, setDispositifHeures, heuresEnabled, templateFor, setDispositifTemplate } from "./dispositif-settings-data.js";
import { roleLabel } from "./auth.js";
import { firebaseConfig } from "./firebase-config.js";
import { auth } from "./firebase-init.js";
import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signOut, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

const ALL_DAYS = ["LUN", "MAR", "MER", "JEU", "VEN"];
const ROLES = ["admin", "n1", "technicien", "menage", "mi_temps", "direction"];
const MENAGE_ROLES = ["menage", "mi_temps"];

function siteDispositif(site) { return site.dispositif || "Dispositif MNA"; }

let unsubs = [];
function cleanup() { unsubs.forEach(u => u()); unsubs = []; }

function randomPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let pwd = "";
  for (let i = 0; i < 10; i++) pwd += chars[Math.floor(Math.random() * chars.length)];
  return pwd;
}

async function createUserAccount(email, password, nom, role) {
  const secondaryApp = initializeApp(firebaseConfig, "secondary-" + Date.now());
  const secondaryAuth = getAuth(secondaryApp);
  try {
    const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    await createUserProfile(cred.user.uid, { nom, role, email });
    await signOut(secondaryAuth);
    return cred.user.uid;
  } finally {
    await deleteApp(secondaryApp);
  }
}

// =================================================================
// ADMINISTRATION GLOBALE — Utilisateurs
// =================================================================
let usersState = { users: [] };
let newUserForm = { email: "", password: "", nom: "", role: "menage" };

export function mountUtilisateurs(container) {
  cleanup();
  container.innerHTML = `<div class="hint">Chargement…</div>`;
  unsubs.push(watchUsers((u) => { usersState.users = u; renderUtilisateurs(container); }));
}

function renderUtilisateurs(container) {
  if (!document.contains(container)) { cleanup(); return; }
  container.innerHTML = `
    <div class="stack">
      <div class="form-card">
        <h3 style="margin:0 0 10px;font-size:14px;color:var(--gold)">Créer un compte</h3>
        <div class="form-grid">
          <label>Email<input type="email" id="nu-email" value="${esc(newUserForm.email)}" placeholder="prenom.nom@etablieres.fr"></label>
          <label>Nom affiché<input id="nu-nom" value="${esc(newUserForm.nom)}" placeholder="ex. Lionel"></label>
          <label>Rôle<select id="nu-role">${ROLES.map(r => `<option value="${r}" ${newUserForm.role === r ? 'selected' : ''}>${esc(roleLabel(r))}</option>`).join("")}</select></label>
          <label>Mot de passe<div style="display:flex;gap:6px">
            <input id="nu-password" value="${esc(newUserForm.password)}" placeholder="min. 6 caractères" style="flex:1">
            <button class="nav-btn" id="nu-generate" type="button">🎲</button>
          </div></label>
        </div>
        <button class="add-btn" id="nu-create">➕ Créer le compte</button>
        <div id="nu-result"></div>
      </div>

      <p class="hint">Modifie le nom affiché, l'email ou le rôle de chaque compte existant. Si l'email est vide ci-dessous (comptes créés avant cette mise à jour), renseigne-le manuellement — nécessaire pour "Réinitialiser". "Réinitialiser" envoie un email à la personne pour qu'elle choisisse elle-même un nouveau mot de passe. La suppression d'un compte se fait depuis la console Firebase (voir manuel d'utilisation).</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Email</th><th>Nom affiché</th><th>Rôle</th><th>Mot de passe</th></tr></thead>
          <tbody>
            ${usersState.users.length === 0 ? `<tr><td colspan="4" class="empty-row">Aucun utilisateur.</td></tr>` :
              usersState.users.map(u => `
                <tr>
                  <td><input data-user-email="${u.uid}" value="${esc(u.email || '')}" placeholder="email manquant — à renseigner" style="min-width:200px${!u.email ? ';border-color:var(--red)' : ''}"></td>
                  <td><input data-user-nom="${u.uid}" value="${esc(u.nom || '')}" style="min-width:160px"></td>
                  <td><select data-user-role="${u.uid}">${ROLES.map(r => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${esc(roleLabel(r))}</option>`).join("")}</select></td>
                  <td>
                    <button class="nav-btn" data-reset-pwd="${u.uid}" style="padding:4px 10px;font-size:11px">🔑 Réinitialiser</button>
                    <div data-reset-status="${u.uid}" style="font-size:11px;margin-top:4px"></div>
                  </td>
                </tr>
              `).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById("nu-email").addEventListener("input", (e) => { newUserForm.email = e.target.value; });
  document.getElementById("nu-nom").addEventListener("input", (e) => { newUserForm.nom = e.target.value; });
  document.getElementById("nu-role").addEventListener("change", (e) => { newUserForm.role = e.target.value; });
  document.getElementById("nu-password").addEventListener("input", (e) => { newUserForm.password = e.target.value; });
  document.getElementById("nu-generate").addEventListener("click", () => {
    newUserForm.password = randomPassword();
    document.getElementById("nu-password").value = newUserForm.password;
  });
  document.getElementById("nu-create").addEventListener("click", async () => {
    const { email, password, nom, role } = newUserForm;
    const resultBox = document.getElementById("nu-result");
    if (!email || !password || !nom) { resultBox.innerHTML = `<p class="hint" style="color:var(--red)">Email, nom et mot de passe sont obligatoires.</p>`; return; }
    if (password.length < 6) { resultBox.innerHTML = `<p class="hint" style="color:var(--red)">Le mot de passe doit faire au moins 6 caractères.</p>`; return; }
    resultBox.innerHTML = `<p class="hint">Création en cours…</p>`;
    try {
      await createUserAccount(email, password, nom, role);
      resultBox.innerHTML = `
        <div class="form-card" style="margin-top:12px">
          <p class="hint">✓ Compte créé pour <b>${esc(nom)}</b>. Transmets-lui ces identifiants :</p>
          <p style="font-family:ui-monospace,monospace;font-size:13px">Email : ${esc(email)}<br>Mot de passe : ${esc(password)}</p>
        </div>`;
      newUserForm = { email: "", password: "", nom: "", role: "menage" };
    } catch (e) {
      const msg = e.code === "auth/email-already-in-use" ? "Cet email est déjà utilisé par un autre compte."
        : e.code === "auth/invalid-email" ? "Adresse email invalide."
        : "Erreur : " + e.message;
      resultBox.innerHTML = `<p class="hint" style="color:var(--red)">${esc(msg)}</p>`;
    }
  });
  container.querySelectorAll("[data-user-nom]").forEach(inp => {
    inp.addEventListener("change", async () => { await updateUser(inp.dataset.userNom, { nom: inp.value }); });
  });
  container.querySelectorAll("[data-user-email]").forEach(inp => {
    inp.addEventListener("change", async () => {
      await updateUser(inp.dataset.userEmail, { email: inp.value.trim() });
      inp.style.borderColor = "";
    });
  });
  container.querySelectorAll("[data-user-role]").forEach(sel => {
    sel.addEventListener("change", async () => { await updateUser(sel.dataset.userRole, { role: sel.value }); });
  });
  container.querySelectorAll("[data-reset-pwd]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const uid = btn.dataset.resetPwd;
      const emailInput = container.querySelector(`[data-user-email="${uid}"]`);
      const email = emailInput ? emailInput.value.trim() : "";
      const statusEl = container.querySelector(`[data-reset-status="${uid}"]`);
      if (!email) { if (statusEl) statusEl.innerHTML = `<span style="color:var(--red)">Renseigne d'abord l'email dans la colonne de gauche.</span>`; return; }
      btn.disabled = true;
      try {
        await sendPasswordResetEmail(auth, email);
        if (statusEl) statusEl.innerHTML = `<span style="color:var(--teal)">✓ Email envoyé</span>`;
      } catch (e) {
        const msg = e.code === "auth/user-not-found" ? "Aucun compte avec cet email." : "Échec : " + (e.message || e);
        if (statusEl) statusEl.innerHTML = `<span style="color:var(--red)">${esc(msg)}</span>`;
      } finally {
        btn.disabled = false;
      }
    });
  });
}

// =================================================================
// ADMINISTRATION GLOBALE — Accès remplaçants (QR code)
// =================================================================
let invState = { sites: [], invitations: [] };
let invForm = { siteId: "", label: "", weekStart: "", nbWeeks: 1 };

function weekStartOf(date) {
  const offset = (date.getDay() + 6) % 7;
  return addDays(date, -offset);
}

export function mountAccesRemplacants(container, user) {
  cleanup();
  container.innerHTML = `<div class="hint">Chargement…</div>`;
  unsubs.push(watchSites((s) => { invState.sites = s; renderInvites(container, user); }));
  unsubs.push(watchInvitations((i) => { invState.invitations = i; renderInvites(container, user); }));
}

function renderInvites(container, user) {
  if (!document.contains(container)) { cleanup(); return; }
  if (!invForm.siteId && invState.sites[0]) invForm.siteId = invState.sites[0].id;
  if (!invForm.weekStart) invForm.weekStart = dateKey(weekStartOf(new Date()));

  container.innerHTML = `
    <div class="stack">
      <p class="hint">Génère un lien + QR code donnant un accès limité (sans compte ni mot de passe) pour remplir les fiches d'un site sur une ou plusieurs semaines précises — utile pour un remplaçant externe.</p>

      <div class="form-card">
        <div class="form-grid">
          <label>Site<select id="pi-site">${invState.sites.map(s => `<option value="${s.id}" ${s.id === invForm.siteId ? 'selected' : ''}>${esc(s.name)}</option>`).join("")}</select></label>
          <label>Nom / société du remplaçant<input id="pi-label" value="${esc(invForm.label)}" placeholder="ex. Société Progrès"></label>
          <label>Semaine de début<input type="date" id="pi-week" value="${esc(invForm.weekStart)}"></label>
          <label>Nombre de semaines<input type="number" min="1" max="12" id="pi-nb" value="${invForm.nbWeeks}"></label>
        </div>
        <button class="add-btn" id="pi-generate">🔗 Générer l'accès</button>
      </div>

      <div id="pi-result"></div>

      <div class="table-wrap">
        <table>
          <thead><tr><th>Remplaçant</th><th>Site</th><th>Semaines</th><th>État</th><th></th></tr></thead>
          <tbody>
            ${invState.invitations.length === 0 ? `<tr><td colspan="5" class="empty-row">Aucun accès généré.</td></tr>` :
              invState.invitations.map(inv => `
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

  document.getElementById("pi-site").addEventListener("change", (e) => { invForm.siteId = e.target.value; });
  document.getElementById("pi-label").addEventListener("input", (e) => { invForm.label = e.target.value; });
  document.getElementById("pi-week").addEventListener("input", (e) => { invForm.weekStart = e.target.value; });
  document.getElementById("pi-nb").addEventListener("input", (e) => { invForm.nbWeeks = parseInt(e.target.value, 10) || 1; });

  document.getElementById("pi-generate").addEventListener("click", async () => {
    if (!invForm.label.trim()) { alert("Indique un nom ou une société pour ce remplaçant."); return; }
    const site = invState.sites.find(s => s.id === invForm.siteId);
    const weeks = [];
    let cur = new Date(invForm.weekStart);
    for (let i = 0; i < invForm.nbWeeks; i++) { weeks.push(dateKey(cur)); cur = addDays(cur, 7); }
    const token = await createInvitation({
      siteId: site.id, siteName: site.name, weeks, label: invForm.label, createdBy: user.uid,
    });
    showResult(token);
  });

  container.querySelectorAll("[data-copy]").forEach(btn => btn.addEventListener("click", () => copyLink(btn.dataset.copy, btn)));
  container.querySelectorAll("[data-toggle]").forEach(btn => {
    btn.addEventListener("click", async () => { await setInvitationActive(btn.dataset.toggle, btn.dataset.active !== "true"); });
  });
  container.querySelectorAll("[data-del-inv]").forEach(btn => {
    btn.addEventListener("click", async () => { if (confirm("Supprimer définitivement cet accès ?")) await deleteInvitation(btn.dataset.delInv); });
  });
}

function guestLink(token) { return `${location.origin}/guest.html?invite=${token}`; }
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

// =================================================================
// PARAMÈTRES D'UN DISPOSITIF — Fiches (scoped) + Accès (scoped)
// =================================================================
let dpState = { sites: [], users: [], access: {}, settings: {} };
let dpUi = { section: "fiches", editSiteId: null };
let dpNewUserForm = { email: "", password: "", nom: "" };

export function mountParametresDispositif(container, user, dispositif) {
  cleanup();
  dpUi.section = "fiches";
  dpUi.editSiteId = null;
  container.innerHTML = `<div class="hint">Chargement…</div>`;
  unsubs.push(watchSites((s) => {
    dpState.sites = JSON.parse(JSON.stringify(s));
    const inDisp = dpState.sites.filter(x => siteDispositif(x) === dispositif);
    if (!dpUi.editSiteId) dpUi.editSiteId = inDisp[0]?.id;
    renderParametresDispositif(container, user, dispositif);
  }));
  unsubs.push(watchUsers((u) => { dpState.users = u.filter(x => MENAGE_ROLES.includes(x.role)); renderParametresDispositif(container, user, dispositif); }));
  unsubs.push(watchAccess((a) => { dpState.access = a; renderParametresDispositif(container, user, dispositif); }));
  unsubs.push(watchDispositifSettings((s) => { dpState.settings = s; renderParametresDispositif(container, user, dispositif); }));
}

function renderParametresDispositif(container, user, dispositif) {
  if (!document.contains(container)) { cleanup(); return; }
  container.innerHTML = `
    <div class="stack">
      <div class="tabs" style="background:none;border:none;padding:0;margin-bottom:-6px">
        <button class="tab-btn ${dpUi.section === 'general' ? 'active' : ''}" data-dpp-section="general">⚙️ Général</button>
        <button class="tab-btn ${dpUi.section === 'fiches' ? 'active' : ''}" data-dpp-section="fiches">📋 Fiches</button>
        <button class="tab-btn ${dpUi.section === 'acces' ? 'active' : ''}" data-dpp-section="acces">🔐 Accès</button>
      </div>
      <div id="dpp-sub"></div>
    </div>
  `;
  container.querySelectorAll("[data-dpp-section]").forEach(btn => {
    btn.addEventListener("click", () => { dpUi.section = btn.dataset.dppSection; renderParametresDispositif(container, user, dispositif); });
  });
  const sub = document.getElementById("dpp-sub");
  if (dpUi.section === "general") return renderGeneralEditor(sub, user, dispositif);
  if (dpUi.section === "fiches") return renderFichesEditor(sub, dispositif);
  if (dpUi.section === "acces") return renderAccesEditor(sub, dispositif);
}

function renderGeneralEditor(container, user, dispositif) {
  const heuresOn = heuresEnabled(dpState.settings, dispositif);
  const template = templateFor(dpState.settings, dispositif);
  const totalTemplate = template.reduce((s, t) => s + (t.heures || 0), 0);
  container.innerHTML = `
    <div class="stack">
      <div class="form-card">
        <h3 style="margin:0 0 10px;font-size:14px;color:var(--gold)">Suivi des heures</h3>
        <label style="display:flex;align-items:center;gap:8px;font-size:13px">
          <input type="checkbox" id="gen-heures" ${heuresOn ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--gold)">
          Activer l'onglet "Heures" pour ce dispositif
        </label>
        <p class="hint" style="margin-top:8px">À désactiver pour un dispositif à contrat fixe (ex. 35h) qui n'a pas besoin de saisie horaire au jour le jour.</p>
      </div>

      ${heuresOn ? `
      <div class="form-card">
        <h3 style="margin:0 0 10px;font-size:14px;color:var(--gold)">Modèle hebdomadaire de répartition (${totalTemplate}h)</h3>
        <p class="hint" style="margin-bottom:10px">Ces lignes préremplissent automatiquement chaque semaine dans l'onglet "Répartition" de l'agent — il peut ensuite ajuster les heures réelles et en ajouter.</p>
        <div class="table-wrap" style="border:none">
          <table>
            <thead><tr><th>Tâche</th><th style="width:110px">Heures / semaine</th><th></th></tr></thead>
            <tbody>
              ${template.map((t, i) => `
                <tr>
                  <td><input data-tpl-label="${i}" value="${esc(t.label)}" style="width:100%"></td>
                  <td><input type="number" step="0.25" min="0" data-tpl-heures="${i}" value="${t.heures}" style="width:100%"></td>
                  <td><button class="del-btn" data-tpl-del="${i}">🗑️</button></td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
        <button class="nav-btn" id="tpl-add" style="margin-top:10px">➕ Ajouter une ligne au modèle</button>
        <button class="add-btn" id="tpl-save" style="margin-top:10px">💾 Enregistrer le modèle</button>
      </div>` : ""}

      <div class="form-card">
        <h3 style="margin:0 0 10px;font-size:14px;color:var(--gold)">Créer un compte pour ce dispositif</h3>
        <p class="hint" style="margin-bottom:10px">Le compte créé ici est automatiquement autorisé à accéder à ce dispositif (voir onglet Accès pour l'ajuster).</p>
        <div class="form-grid">
          <label>Email<input type="email" id="dgn-email" value="${esc(dpNewUserForm.email)}" placeholder="prenom.nom@etablieres.fr"></label>
          <label>Nom affiché<input id="dgn-nom" value="${esc(dpNewUserForm.nom)}" placeholder="ex. Daoud"></label>
          <label>Mot de passe<div style="display:flex;gap:6px">
            <input id="dgn-password" value="${esc(dpNewUserForm.password || "")}" placeholder="min. 6 caractères" style="flex:1">
            <button class="nav-btn" id="dgn-generate" type="button">🎲</button>
          </div></label>
        </div>
        <button class="add-btn" id="dgn-create">➕ Créer et autoriser sur ce dispositif</button>
        <div id="dgn-result"></div>
      </div>
    </div>
  `;

  document.getElementById("gen-heures").addEventListener("change", async (e) => {
    await setDispositifHeures(dispositif, e.target.checked);
  });

  let workingTemplate = JSON.parse(JSON.stringify(template));
  container.querySelectorAll("[data-tpl-label]").forEach(inp => {
    inp.addEventListener("input", () => { workingTemplate[inp.dataset.tplLabel].label = inp.value; });
  });
  container.querySelectorAll("[data-tpl-heures]").forEach(inp => {
    inp.addEventListener("input", () => { workingTemplate[inp.dataset.tplHeures].heures = parseFloat(inp.value) || 0; });
  });
  container.querySelectorAll("[data-tpl-del]").forEach(btn => {
    btn.addEventListener("click", async () => {
      workingTemplate.splice(parseInt(btn.dataset.tplDel, 10), 1);
      await setDispositifTemplate(dispositif, workingTemplate);
    });
  });
  document.getElementById("tpl-add")?.addEventListener("click", async () => {
    workingTemplate.push({ label: "Nouvelle tâche", heures: 0 });
    await setDispositifTemplate(dispositif, workingTemplate);
  });
  document.getElementById("tpl-save")?.addEventListener("click", async () => {
    await setDispositifTemplate(dispositif, workingTemplate);
  });

  document.getElementById("dgn-email").addEventListener("input", (e) => { dpNewUserForm.email = e.target.value; });
  document.getElementById("dgn-nom").addEventListener("input", (e) => { dpNewUserForm.nom = e.target.value; });
  document.getElementById("dgn-password").addEventListener("input", (e) => { dpNewUserForm.password = e.target.value; });
  document.getElementById("dgn-generate").addEventListener("click", () => {
    dpNewUserForm.password = randomPassword();
    document.getElementById("dgn-password").value = dpNewUserForm.password;
  });
  document.getElementById("dgn-create").addEventListener("click", async () => {
    const { email, password, nom } = dpNewUserForm;
    const resultBox = document.getElementById("dgn-result");
    if (!email || !password || !nom) { resultBox.innerHTML = `<p class="hint" style="color:var(--red)">Email, nom et mot de passe sont obligatoires.</p>`; return; }
    if (password.length < 6) { resultBox.innerHTML = `<p class="hint" style="color:var(--red)">Le mot de passe doit faire au moins 6 caractères.</p>`; return; }
    resultBox.innerHTML = `<p class="hint">Création en cours…</p>`;
    try {
      const uid = await createUserAccount(email, password, nom, "menage");
      const currentAccess = dpState.access[dispositif] || [];
      await setDispositifAccess(dispositif, [...currentAccess, uid]);
      resultBox.innerHTML = `
        <div class="form-card" style="margin-top:12px">
          <p class="hint">✓ Compte créé pour <b>${esc(nom)}</b> et autorisé sur ce dispositif. Transmets-lui ces identifiants :</p>
          <p style="font-family:ui-monospace,monospace;font-size:13px">Email : ${esc(email)}<br>Mot de passe : ${esc(password)}</p>
        </div>`;
      dpNewUserForm = { email: "", password: "", nom: "" };
    } catch (e) {
      const msg = e.code === "auth/email-already-in-use" ? "Cet email est déjà utilisé par un autre compte."
        : e.code === "auth/invalid-email" ? "Adresse email invalide."
        : "Erreur : " + e.message;
      resultBox.innerHTML = `<p class="hint" style="color:var(--red)">${esc(msg)}</p>`;
    }
  });
}

function renderFichesEditor(container, dispositif) {
  const sitesInDisp = dpState.sites.filter(s => siteDispositif(s) === dispositif);
  const site = sitesInDisp.find(s => s.id === dpUi.editSiteId) || sitesInDisp[0];

  container.innerHTML = `
    <div class="stack">
      <div class="filters-row">
        ${sitesInDisp.length > 1 ? `<label>Site<select id="pf-site">${sitesInDisp.map(s => `<option value="${s.id}" ${s.id === site?.id ? 'selected' : ''}>${esc(s.name)}</option>`).join("")}</select></label>` : ""}
        <button class="nav-btn" id="pf-add-site">➕ Nouveau site pour ce dispositif</button>
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
      ` : `<p class="hint">Aucun site dans ce dispositif pour l'instant.</p>`}
    </div>
  `;

  document.getElementById("pf-site")?.addEventListener("change", (e) => { dpUi.editSiteId = e.target.value; renderFichesEditor(container, dispositif); });
  document.getElementById("pf-add-site").addEventListener("click", () => {
    const id = "site-" + Date.now();
    dpState.sites.push({ id, name: "Nouveau site", dispositif, literie: true, rooms: [] });
    dpUi.editSiteId = id;
    renderFichesEditor(container, dispositif);
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
    btn.addEventListener("click", () => { site.rooms.splice(parseInt(btn.dataset.delRoom, 10), 1); renderFichesEditor(container, dispositif); });
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
      renderFichesEditor(container, dispositif);
    });
  });
  container.querySelectorAll("[data-add-task]").forEach(btn => {
    btn.addEventListener("click", () => {
      site.rooms[parseInt(btn.dataset.addTask, 10)].tasks.push({ label: "Nouvelle tâche", freq: "" });
      renderFichesEditor(container, dispositif);
    });
  });
  document.getElementById("pf-add-room").addEventListener("click", () => {
    site.rooms.push({ name: "Nouvelle pièce", days: [...ALL_DAYS], tasks: [] });
    renderFichesEditor(container, dispositif);
  });
  document.getElementById("pf-save").addEventListener("click", async () => { await saveSites(dpState.sites); });
}

function renderAccesEditor(container, dispositif) {
  const currentList = dpState.access[dispositif] || [];
  const isOpen = currentList.length === 0;

  container.innerHTML = `
    <div class="stack">
      <p class="hint">Par défaut, tous les agents ménage / temps partiel peuvent accéder à ce dispositif. Coche des personnes précises pour restreindre l'accès uniquement à elles.</p>
      <div class="stat-chip ${isOpen ? 'ok' : ''}" style="width:fit-content">${isOpen ? "Accès ouvert à tous les agents" : `Accès restreint à ${currentList.length} personne(s)`}</div>

      <div class="table-wrap">
        <table>
          <thead><tr><th>Autoriser</th><th>Nom</th><th>Email</th><th>Rôle</th></tr></thead>
          <tbody>
            ${dpState.users.length === 0 ? `<tr><td colspan="4" class="empty-row">Aucun agent ménage/mi-temps trouvé.</td></tr>` :
              dpState.users.map(u => `
                <tr>
                  <td><input type="checkbox" data-acc-uid="${u.uid}" ${currentList.includes(u.uid) ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--gold)"></td>
                  <td>${esc(u.nom || '')}</td>
                  <td>${esc(u.email || '')}</td>
                  <td>${esc(roleLabel(u.role))}</td>
                </tr>
              `).join("")}
          </tbody>
        </table>
      </div>
      <button class="add-btn" id="acc-save">💾 Enregistrer les accès</button>
      <button class="nav-btn" id="acc-open">🔓 Réouvrir à tous</button>
    </div>
  `;

  document.getElementById("acc-save").addEventListener("click", async () => {
    const uids = Array.from(container.querySelectorAll("[data-acc-uid]:checked")).map(cb => cb.dataset.accUid);
    await setDispositifAccess(dispositif, uids);
  });
  document.getElementById("acc-open").addEventListener("click", async () => {
    await setDispositifAccess(dispositif, []);
  });
}

import { fmtShort, esc, dateKey, addDays } from "./astreinte-logic.js";
import { watchSites } from "./sites-data.js";
import { watchFiches, deleteFiche, saveFiche, ficheId } from "./fiches-data.js";
import { watchUsers } from "./users-data.js";
import { mentionHTML, taskCompletion, ficheHTML, imprimerFiche } from "./tracabilite-rendu.js";
import { renderQrWithLogo, printQrCard } from "./qr-logo.js";

let state = { fiches: [], sites: [], agents: [] };
let ui = { filterDispositif: "Tous", filterSite: "Tous", filterAgent: "Tous", openId: null };
let unsubs = [];
let mountedContainer = null;
let mountedUser = null;
let lockedDispositif = null;

function cleanup() { unsubs.forEach(u => u()); unsubs = []; }

function siteDispositif(site) { return site?.dispositif || "Dispositif MNA"; }
function ficheDispositif(fiche) { return siteDispositif(state.sites.find(s => s.id === fiche.siteId)); }
function isEditorUser(user) { return user && (user.role === "super_admin" || user.role === "admin" || user.role === "n1"); }

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
  unsubs.push(watchUsers((u) => { state.agents = u.filter(x => ["menage", "mi_temps"].includes(x.role)); }));
}

// Cases du planning prévu : chaque tâche quotidienne (sans fréquence
// particulière) sur les jours où la pièce est prévue.
function cellsPlanning(site) {
  const c = {};
  (site?.rooms || []).forEach((room, ri) => room.tasks.forEach((t, ti) => { if (!t.freq) room.days.forEach(d => { c[`${ri}-${ti}-${d}`] = true; }); }));
  return c;
}

// Ouvre des fiches VIDES pour les semaines dont la fiche papier a disparu :
// l'agent coche ensuite ce qu'il a réellement fait ; chaque fiche porte la
// mention « reconstituée » (date, qui l'a ouverte, motif).
function ouvrirReconstitution() {
  const sites = state.sites.filter(s => !lockedDispositif || siteDispositif(s) === lockedDispositif).sort((a, b) => String(a.name).localeCompare(String(b.name), "fr"));
  const lundi = (d) => addDays(d, -((d.getDay() + 6) % 7));
  const finDefaut = dateKey(addDays(lundi(new Date()), -7));
  const fond = document.createElement("div"); fond.className = "ndm-fond";
  fond.innerHTML = `<div class="ndm rcs">
    <div class="ndm-tete"><h3>🧾 Reconstituer des fiches disparues</h3><button type="button" class="ndm-x" data-fermer>✕</button></div>
    <p class="gaf-aide">Crée une fiche <b>vide</b> par semaine manquante. L'agent y coche ensuite ce qu'il a réellement fait, puis tu valides. Chaque fiche porte la mention « reconstituée a posteriori » avec la date et le motif (visible à l'impression).</p>
    <label>Agent<select id="rcs-agent"><option value="">— choisir —</option>${state.agents.sort((a, b) => String(a.nom || a.email).localeCompare(String(b.nom || b.email), "fr")).map(a => `<option value="${esc(a.uid)}">${esc(a.nom || a.email)}</option>`).join("")}</select></label>
    <fieldset class="rcs-sites"><legend>Sites</legend>${sites.map(s => `<label><input type="checkbox" value="${esc(s.id)}"> ${esc(s.name)}</label>`).join("") || "<i>Aucun site</i>"}</fieldset>
    <div class="rcs-dates"><label>Du<input type="date" id="rcs-du" value="2026-09-01"></label><label>Au<input type="date" id="rcs-au" value="${finDefaut}"></label></div>
    <label>Motif<input id="rcs-motif" value="Fiche papier disparue"></label>
    <label class="rcs-pre"><input type="checkbox" id="rcs-pre"> <span><b>Pré-cocher d'après le planning prévu</b> — les tâches prévues chaque jour sont cochées (pas celles « 1X/mois », « 2X/semaine »…). À revoir ensuite avec l'agent : décocher ce qui n'a pas été fait. La fiche indique qu'elle a été pré-cochée.</span></label>
    <div class="ndm-etat"></div>
    <div class="ndm-btns"><button type="button" class="dps-annuler" data-fermer>Annuler</button><button type="button" class="dps-enregistrer" id="rcs-ok">🧾 Créer les fiches à compléter</button></div>
  </div>`;
  document.body.append(fond);
  const etat = fond.querySelector(".ndm-etat");
  fond.querySelectorAll("[data-fermer]").forEach(b => b.addEventListener("click", () => fond.remove()));
  fond.addEventListener("click", (e) => { if (e.target === fond) fond.remove(); });
  fond.querySelector("#rcs-ok").addEventListener("click", async (e) => {
    const uid = fond.querySelector("#rcs-agent").value, agent = state.agents.find(a => a.uid === uid);
    const ids = [...fond.querySelectorAll(".rcs-sites input:checked")].map(i => i.value);
    const pre = fond.querySelector("#rcs-pre").checked;
    const du = fond.querySelector("#rcs-du").value, au = fond.querySelector("#rcs-au").value, motif = (fond.querySelector("#rcs-motif").value.trim() || "Fiche papier disparue") + (pre ? " — pré-cochée d'après le planning prévu, à corriger avec l'agent" : "");
    if (!agent || !ids.length || !du || !au || au < du) { etat.textContent = "Choisis l'agent, au moins un site et une période valide."; return; }
    const semaines = []; for (let d = lundi(new Date(du + "T00:00:00")); dateKey(d) <= au; d = addDays(d, 7)) semaines.push(dateKey(d));
    const aCreer = [];
    ids.forEach(sid => semaines.forEach(w => { const id = ficheId(sid, w, uid); if (!state.fiches.some(f => f.id === id)) aCreer.push({ id, sid, w }); }));
    if (!aCreer.length) { etat.textContent = "Toutes ces semaines ont déjà une fiche."; return; }
    if (!confirm(pre ? `Créer ${aCreer.length} fiche(s) « reconstituée » PRÉ-COCHÉES d'après le planning pour ${agent.nom || agent.email} ?\nÀ corriger ensuite avec l'agent (décocher ce qui n'a pas été fait).` : `Créer ${aCreer.length} fiche(s) vide(s) « reconstituée » pour ${agent.nom || agent.email} ?\nL'agent devra cocher ce qu'il a réellement fait.`)) return;
    e.target.disabled = true; etat.textContent = "⏳ Création…";
    const auj = dateKey(new Date()), par = mountedUser?.nom || mountedUser?.email || "";
    try {
      for (const x of aCreer) {
        const site = state.sites.find(s => s.id === x.sid);
        await saveFiche(x.id, { siteId: x.sid, siteName: site?.name || "", weekStart: x.w, weekEnd: dateKey(addDays(new Date(x.w + "T00:00:00"), 4)),
          agentUid: uid, agentNom: agent.nom || agent.email, cells: pre ? cellsPlanning(site) : {}, obs: {}, periodiques: {}, chambres: [], observationsGenerales: "", submitted: false,
          reconstituee: { le: auj, par, motif, ...(pre ? { preCochee: true } : {}) } });
      }
      window.toast?.(`✓ ${aCreer.length} fiche(s) à compléter créée(s)`); fond.remove();
    } catch (err) { console.error(err); etat.textContent = "❌ " + (err?.message || err); e.target.disabled = false; }
  });
}

// QR code par site : ouvre, sans compte, la consultation en LECTURE SEULE
// de toutes les fiches de traçabilité de ce site (tracabilite-guest.html).
// Le lien suit l'adresse courante : imprimé depuis la version de test, il
// pointe vers la version de test ; depuis la version validée, vers celle-ci.
function lienLectureSite(siteId) {
  return new URL(`tracabilite-guest.html?site=${encodeURIComponent(siteId)}`, window.location.href).href;
}
function ouvrirQrLecture() {
  const sites = state.sites.filter(s => !lockedDispositif || siteDispositif(s) === lockedDispositif).sort((a, b) => String(a.name).localeCompare(String(b.name), "fr"));
  const pre = sites.find(s => s.name === ui.filterSite)?.id || sites[0]?.id || "";
  const fond = document.createElement("div"); fond.className = "ndm-fond";
  fond.innerHTML = `<div class="ndm">
    <div class="ndm-tete"><h3>📱 QR code — consultation en lecture seule</h3><button type="button" class="ndm-x" data-fermer>✕</button></div>
    <p class="gaf-aide">À imprimer et afficher sur le site. Scanné avec l'appareil photo d'un téléphone, il ouvre toutes les fiches de traçabilité de ce site, <b>sans compte</b> et <b>sans pouvoir rien modifier</b>.</p>
    <label>Site<select id="qrl-site">${sites.map(s => `<option value="${esc(s.id)}" ${s.id === pre ? "selected" : ""}>${esc(s.name)}</option>`).join("") || "<option value=''>Aucun site</option>"}</select></label>
    <div class="qr-print-card" id="qrl-carte" style="background:#fff;border-radius:10px;padding:16px;text-align:center;max-width:280px;margin:12px auto 0">
      <div id="qrl-qr" style="width:220px;height:220px;margin:0 auto"></div>
      <p id="qrl-txt" style="color:#111;font-size:12px;margin:8px 0 0"></p>
    </div>
    <div class="ndm-btns"><button type="button" class="dps-annuler" data-fermer>Fermer</button><button type="button" class="dps-enregistrer" id="qrl-print">🖨️ Imprimer</button></div>
  </div>`;
  document.body.append(fond);
  fond.querySelectorAll("[data-fermer]").forEach(b => b.addEventListener("click", () => fond.remove()));
  fond.addEventListener("click", (e) => { if (e.target === fond) fond.remove(); });
  const sel = fond.querySelector("#qrl-site");
  const dessiner = () => {
    const site = sites.find(s => s.id === sel.value);
    if (!site) { fond.querySelector("#qrl-qr").innerHTML = ""; return; }
    fond.querySelector("#qrl-txt").innerHTML = `Traçabilité ménage — <b>${esc(site.name)}</b><br>Consultation en lecture seule`;
    renderQrWithLogo(fond.querySelector("#qrl-qr"), lienLectureSite(site.id), 220);
  };
  sel.addEventListener("change", dessiner);
  fond.querySelector("#qrl-print").addEventListener("click", () => printQrCard(fond.querySelector("#qrl-carte")));
  dessiner();
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
        ${isEditorUser(mountedUser) ? `<button type="button" class="nav-btn" id="tr-reconst" style="align-self:flex-end">🧾 Reconstituer des fiches disparues</button><button type="button" class="nav-btn" id="tr-qr" style="align-self:flex-end">📱 QR lecture seule</button>` : ""}
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
                  <td>${f.submitted ? `<span class="tag" style="background:var(--teal)">Terminée</span>` : `<span class="tag" style="background:var(--panel-alt);color:var(--text-dim)">${f.reconstituee && !done ? "À compléter" : "En cours"}</span>`} ${mentionHTML(f, true)}</td>
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
${ficheHTML(opened, openedSite, lockedDispositif || "")}` : ""}
    </div>
  `;

  document.getElementById("tr-disp")?.addEventListener("change", (e) => { ui.filterDispositif = e.target.value; ui.filterSite = "Tous"; render(); });
  document.getElementById("tr-site").addEventListener("change", (e) => { ui.filterSite = e.target.value; render(); });
  document.getElementById("tr-agent").addEventListener("change", (e) => { ui.filterAgent = e.target.value; render(); });
  mountedContainer.querySelectorAll("[data-open]").forEach(btn => {
    btn.addEventListener("click", () => { ui.openId = btn.dataset.open; render(); });
  });
  document.getElementById("tr-reconst")?.addEventListener("click", ouvrirReconstitution);
  document.getElementById("tr-qr")?.addEventListener("click", ouvrirQrLecture);
  document.getElementById("tr-print")?.addEventListener("click", imprimerFiche);
  document.getElementById("tr-close")?.addEventListener("click", () => { ui.openId = null; render(); });
  document.getElementById("tr-del-opened")?.addEventListener("click", async () => {
    if (confirm("Supprimer définitivement cette fiche ? Cette action est irréversible.")) {
      await deleteFiche(ui.openId, state.fiches.find(f => f.id === ui.openId)?.agentUid);
      ui.openId = null;
      render();
    }
  });
  mountedContainer.querySelectorAll("[data-del-fiche]").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (confirm("Supprimer définitivement cette fiche ? Cette action est irréversible.")) {
        await deleteFiche(btn.dataset.delFiche, state.fiches.find(f => f.id === btn.dataset.delFiche)?.agentUid);
        if (ui.openId === btn.dataset.delFiche) ui.openId = null;
        render();
      }
    });
  });
}

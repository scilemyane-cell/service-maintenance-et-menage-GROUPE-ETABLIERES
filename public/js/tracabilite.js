import { fmtShort, esc, dateKey, addDays } from "./astreinte-logic.js";
import { watchSites } from "./sites-data.js";
import { watchFiches, deleteFiche, saveFiche, ficheId } from "./fiches-data.js";
import { watchUsers } from "./users-data.js";
import { mentionHTML, taskCompletion, ficheHTML, imprimerFiche } from "./tracabilite-rendu.js";
import { renderQrWithLogo, printQrCard } from "./qr-logo.js";
import { photosFusion, watchPhotosSemaine, watchPhotosFiche } from "./fiches-photos.js";
import { tableauDeBordHTML } from "./tracabilite-stats.js";
import { archiverSemainesTerminees, DOSSIER_DEPT, DOSSIER_INTERNE } from "./tracabilite-archive.js";

let state = { fiches: [], sites: [], agents: [], photosSemaine: [], photosOuverte: [] };
let unsubOuverte = null, ouverteSuivie = null;
const lundiCourant = () => { const t = new Date(); return dateKey(addDays(t, -((t.getDay() + 6) % 7))); };
const photosDe = (f) => photosFusion(f, f.id === ouverteSuivie ? state.photosOuverte : state.photosSemaine.filter(p => p.ficheId === f.id));
let ui = { filterDispositif: "Tous", filterSite: "Tous", filterAgent: "Tous", openId: null, vue: "fiches" };
let archiveEtat = "";
// Fin de semaine : PDF Département (sans photos) + Interne (avec photos) sur
// SharePoint, puis les photos sont retirées de l'appli. Tout seul, en silence.
async function lancerArchive(interactif = false) {
  archiveEtat = "⏳ Archivage SharePoint…"; render();
  try {
    const r = await archiverSemainesTerminees({ interactif, onProgress: (t) => { archiveEtat = "⏳ " + t; const el = document.getElementById("tr-archive-etat"); if (el) el.textContent = archiveEtat; } });
    archiveEtat = r.sansCompte ? (interactif ? "Connexion Microsoft nécessaire." : "")
      : r.archivees ? `☁️ ${r.archivees} fiche(s) archivée(s) sur SharePoint${r.photosSupprimees ? ` · ${r.photosSupprimees} photo(s) libérée(s)` : ""}${r.restantes ? ` · ${r.restantes} restantes (prochain passage)` : ""}`
      : (interactif ? "☁️ Tout est déjà archivé." : "");
    if (r.archivees) window.toast?.(archiveEtat);
  } catch (e) { console.warn("Archive traçabilité :", e); archiveEtat = "⚠️ Archivage impossible : " + (e?.message || e); }
  render();
}
let unsubs = [];
let mountedContainer = null;
let mountedUser = null;
let lockedDispositif = null;

function cleanup() { unsubs.forEach(u => u()); unsubs = []; if (unsubOuverte) unsubOuverte(); unsubOuverte = null; ouverteSuivie = null; }
function suivreOuverte(id) {
  if (id === ouverteSuivie) return;
  if (unsubOuverte) unsubOuverte(); unsubOuverte = null; ouverteSuivie = id; state.photosOuverte = [];
  if (id) unsubOuverte = watchPhotosFiche(id, (docs) => { state.photosOuverte = docs; render(); });
}

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
  unsubs.push(watchPhotosSemaine(lundiCourant(), (p) => { state.photosSemaine = p; render(); }));
  unsubs.push(watchUsers((u) => { state.agents = u.filter(x => ["menage", "mi_temps"].includes(x.role)); }));
  if (isEditorUser(user)) setTimeout(() => { if (mountedContainer === container) lancerArchive(false); }, 4000);
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

  suivreOuverte(ui.openId && state.fiches.some(f => f.id === ui.openId) ? ui.openId : null);
  const opened0 = ui.openId ? state.fiches.find(f => f.id === ui.openId) : null;
  const opened = opened0 ? { ...opened0, photos: photosDe(opened0) } : null;
  const openedSite = opened ? state.sites.find(s => s.id === opened.siteId) : null;

  mountedContainer.innerHTML = `
    <div class="stack">
      <div class="filters-row">
        ${!lockedDispositif ? `<label>Dispositif<select id="tr-disp">${dispositifs.map(d => `<option ${ui.filterDispositif === d ? 'selected' : ''}>${esc(d)}</option>`).join("")}</select></label>` : ""}
        <label>Site<select id="tr-site">${siteNames.map(s => `<option ${ui.filterSite === s ? 'selected' : ''}>${esc(s)}</option>`).join("")}</select></label>
        <label>Agent<select id="tr-agent">${agents.map(a => `<option ${ui.filterAgent === a ? 'selected' : ''}>${esc(a)}</option>`).join("")}</select></label>
        ${isEditorUser(mountedUser) ? `<button type="button" class="nav-btn" id="tr-reconst" style="align-self:flex-end">🧾 Reconstituer des fiches disparues</button><button type="button" class="nav-btn" id="tr-qr" style="align-self:flex-end">📱 QR lecture seule</button>` : ""}
      </div>

      ${(() => {
        // Suivi EN DIRECT de la semaine en cours : chaque coche de l'agent est
        // enregistrée tout de suite, pas besoin qu'elle « termine » sa fiche.
        const t = new Date(), lundi = lundiCourant();
        const cle = ["LUN", "MAR", "MER", "JEU", "VEN"][(t.getDay() + 6) % 7];
        const enCours = filtered.filter(f => f.weekStart === lundi);
        if (!enCours.length) return "";
        const ms = (v) => v?.toMillis ? v.toMillis() : v?.seconds ? v.seconds * 1000 : 0;
        const ilYa = (m) => { if (!m) return "—"; const mn = Math.round((Date.now() - m) / 60000); return mn < 1 ? "à l'instant" : mn < 60 ? `il y a ${mn} min` : mn < 1440 ? `il y a ${Math.round(mn / 60)} h` : `il y a ${Math.round(mn / 1440)} j`; };
        return `<div class="form-card tr-direct"><h3 style="margin:0 0 4px;font-size:15px">🟢 En direct — semaine en cours</h3><p class="hint" style="margin:0 0 10px">Mis à jour à chaque case cochée par l'agent, même si la fiche n'est pas encore « terminée ».</p>
          <div class="tr-direct-liste">${enCours.map(f => {
            const site = state.sites.find(s => s.id === f.siteId); const { done, total } = taskCompletion(f, site);
            let jd = 0, jt = 0; (site?.rooms || []).forEach((room, ri) => { if (!cle || !room.days.includes(cle)) return; room.tasks.forEach((task, ti) => { jt++; if (f.cells?.[`${ri}-${ti}-${cle}`]) jd++; }); });
            const pct = total ? Math.round(done / total * 100) : 0, phs = photosDe(f), nbPh = phs.length;
            return `<button type="button" class="tr-direct-l" data-open="${f.id}"><b>${esc(f.agentNom)}</b><span>${esc(f.siteName)}</span>
              <span class="tr-direct-barre"><i style="width:${pct}%"></i></span><span><b>${done}/${total}</b> semaine${jt ? ` · aujourd'hui ${jd}/${jt}` : ""}${nbPh ? ` · 📷 ${nbPh}` : ""}</span>
              <small>${f.submitted ? "✓ terminée" : `dernière saisie ${ilYa(ms(f.majLe))}`}</small></button>${nbPh ? `<div class="tr-direct-ph">${[...phs].sort((a, b) => (b.le || 0) - (a.le || 0)).slice(0, 10).map(p => `<figure data-ph-grand="${f.id}|${p.cle}"><img src="${p.data}" alt="" loading="lazy"><figcaption>${p.moment ? `<b class="tr-m ${p.moment}">${p.moment === "avant" ? "Avant" : "Après"}</b> ` : ""}${esc(p.piece || "")}${p.jour ? ` · ${esc(p.jour.toLowerCase())}` : ""}<br>${p.le ? new Date(p.le).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : ""}</figcaption></figure>`).join("")}</div>` : ""}`; }).join("")}</div></div>`;
      })()}

      <div class="tr-vues"><button type="button" class="${ui.vue === "fiches" ? "actif" : ""}" data-tr-vue="fiches">📋 Fiches</button><button type="button" class="${ui.vue === "stats" ? "actif" : ""}" data-tr-vue="stats">📊 Tableau de bord</button>
        ${isEditorUser(mountedUser) ? `<button type="button" class="tr-arch" id="tr-archive" title="PDF Département (sans photos) et Interne (avec photos) des semaines terminées">☁️ Archiver sur SharePoint</button>` : ""}<small id="tr-archive-etat" class="hint">${esc(archiveEtat)}</small></div>
      ${ui.vue === "stats" ? tableauDeBordHTML(filtered, state.sites) : `
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
                  <td>${f.submitted ? `<span class="tag" style="background:var(--teal)">Terminée</span>` : `<span class="tag" style="background:var(--panel-alt);color:var(--text-dim)">${f.reconstituee && !done ? "À compléter" : "En cours"}</span>`} ${f.archiveSP ? `<span class="tag" style="background:#e3eefc;color:#1d4f91" title="Archivée sur SharePoint le ${new Date(f.archiveSP.le).toLocaleDateString("fr-FR")}">☁️ SharePoint</span>` : ""} ${mentionHTML(f, true)}</td>
                  <td style="white-space:nowrap">
                    <button class="nav-btn" data-open="${f.id}" style="padding:4px 10px;font-size:11px">Voir</button>
                    ${isEditorUser(mountedUser) ? `<button class="del-btn" data-del-fiche="${f.id}">🗑️</button>` : ""}
                  </td>
                </tr>`;
              }).join("")}
          </tbody>
        </table>
      </div>`}

      ${opened && ui.vue === "fiches" ? `
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="add-btn" id="tr-print">🖨️ PDF sans photos</button>
        ${(opened.photos || []).length ? `<button class="add-btn" id="tr-print-photos">📷 PDF avec photos (${opened.photos.length})</button>` : ""}
        <button class="nav-btn" id="tr-close">✕ Fermer l'aperçu</button>
        ${opened.archiveSP ? `<p class="hint" style="width:100%;margin:0">☁️ Archivée sur SharePoint le ${new Date(opened.archiveSP.le).toLocaleDateString("fr-FR")} — ExportsDonnees › Traçabilité ménage › <b>${DOSSIER_DEPT}</b> (à envoyer au Département) et <b>${DOSSIER_INTERNE}</b>${opened.archiveSP.nbPhotos ? ` (${opened.archiveSP.nbPhotos} photo(s), retirées de l'appli)` : ""}.</p>` : ""}
        ${isEditorUser(mountedUser) ? `<button class="del-btn" id="tr-del-opened" style="border:1px solid var(--red);border-radius:8px;padding:9px 16px">🗑️ Supprimer cette fiche</button>` : ""}
      </div>
${ficheHTML(opened, openedSite, lockedDispositif || "")}` : ""}
    </div>
  `;

  document.getElementById("tr-disp")?.addEventListener("change", (e) => { ui.filterDispositif = e.target.value; ui.filterSite = "Tous"; render(); });
  document.getElementById("tr-site").addEventListener("change", (e) => { ui.filterSite = e.target.value; render(); });
  document.getElementById("tr-agent").addEventListener("change", (e) => { ui.filterAgent = e.target.value; render(); });
  mountedContainer.querySelectorAll("[data-ph-grand]").forEach(fg => fg.addEventListener("click", () => {
    const [fid, cle] = fg.dataset.phGrand.split("|"), fi = state.fiches.find(x => x.id === fid), p = fi && photosDe(fi).find(x => x.cle === cle); if (!p) return;
    const v = document.createElement("div"); v.className = "tr-ph-plein";
    v.innerHTML = `<img src="${p.data}" alt=""><p>${esc([p.moment === "avant" ? "AVANT" : p.moment === "apres" ? "APRÈS" : "", p.piece, p.jour, p.par, p.le ? new Date(p.le).toLocaleString("fr-FR") : "", p.legende].filter(Boolean).join(" · "))}</p>`;
    v.onclick = () => v.remove(); document.body.appendChild(v);
  }));
  mountedContainer.querySelectorAll("[data-tr-vue]").forEach(b => b.addEventListener("click", () => { ui.vue = b.dataset.trVue; render(); }));
  document.getElementById("tr-archive")?.addEventListener("click", () => lancerArchive(true));
  mountedContainer.querySelectorAll("[data-open]").forEach(btn => {
    btn.addEventListener("click", () => { ui.openId = btn.dataset.open; render(); });
  });
  document.getElementById("tr-reconst")?.addEventListener("click", ouvrirReconstitution);
  document.getElementById("tr-qr")?.addEventListener("click", ouvrirQrLecture);
  document.getElementById("tr-print")?.addEventListener("click", () => imprimerFiche(false));
  document.getElementById("tr-print-photos")?.addEventListener("click", () => imprimerFiche(true));
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

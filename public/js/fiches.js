import { addDays, dateKey, fmtShort, esc, isPlausibleDate } from "./astreinte-logic.js";
import { watchSites } from "./sites-data.js";
import { watchFiches, saveFiche, ficheId } from "./fiches-data.js";
import { watchUsers } from "./users-data.js";
import { watchAccess, hasAccess } from "./access-data.js";

const DAY_LABELS = { LUN: "Lun", MAR: "Mar", MER: "Mer", JEU: "Jeu", VEN: "Ven" };
const MENAGE_ROLES = ["menage", "mi_temps"];

let state = { fiches: [], sites: [], agents: [], allAgents: [], access: {} };
let ui = { dispositif: null, lockDispositif: false, siteId: null, weekStart: null, actingUid: null, actingNom: null, vue: "jour", jour: null };
const JOURS_KEYS = ["LUN", "MAR", "MER", "JEU", "VEN"];
const JOURS_LONGS = { LUN: "Lundi", MAR: "Mardi", MER: "Mercredi", JEU: "Jeudi", VEN: "Vendredi" };
let renderEnAttente = false;

// Jour affiché par défaut : aujourd'hui si on est sur la semaine en cours
// (le week-end → vendredi), sinon lundi.
function jourParDefaut() {
  const now = new Date();
  if (ui.weekStart !== dateKey(mondayOf(now))) return "LUN";
  const idx = (now.getDay() + 6) % 7;
  return JOURS_KEYS[Math.min(idx, 4)];
}

// Évite de reconstruire l'écran pendant qu'on tape une observation
// (sinon le champ perd le focus à chaque enregistrement automatique).
function saisieEnCours() {
  const a = document.activeElement;
  return !!(a && mountedContainer && mountedContainer.contains(a) && (a.tagName === "TEXTAREA" || (a.tagName === "INPUT" && a.type !== "checkbox")));
}
function renderSiLibre() {
  if (saisieEnCours()) { renderEnAttente = true; return; }
  render();
}
let unsubs = [];
let mountedContainer = null;
let mountedUser = null;
let saveTimer = null;

function cleanup() { unsubs.forEach(u => u()); unsubs = []; }

function siteDispositif(site) { return site.dispositif || "Dispositif MNA"; }

function dispositifs() {
  return [...new Set(state.sites.map(siteDispositif))];
}

function mondayOf(date) {
  const offset = (date.getDay() + 6) % 7;
  return addDays(date, -offset);
}

export function mountFiches(container, user) {
  cleanup();
  mountedContainer = container;
  mountedUser = user;
  ui.lockDispositif = false;
  if (!ui.weekStart) ui.weekStart = dateKey(mondayOf(new Date()));
  container.innerHTML = `<div class="hint">Chargement…</div>`;
  unsubs.push(watchSites((s) => {
    state.sites = s;
    if (!ui.dispositif) ui.dispositif = siteDispositif(s[0] || {});
    if (!ui.siteId) ui.siteId = s.find(x => siteDispositif(x) === ui.dispositif)?.id || s[0]?.id;
    render();
  }));
  unsubs.push(watchFiches((f) => { state.fiches = f; renderSiLibre(); }));
  unsubs.push(watchUsers((u) => { state.allAgents = u.filter(x => MENAGE_ROLES.includes(x.role)); render(); }));
  unsubs.push(watchAccess((a) => { state.access = a; render(); }));
}

// Même écran, mais verrouillé sur un dispositif précis (pas de barre
// d'onglets interne) — utilisé quand chaque dispositif a son propre
// onglet de premier niveau dans la navigation.
export function mountFichesForDispositif(container, user, dispositif) {
  cleanup();
  mountedContainer = container;
  mountedUser = user;
  ui.dispositif = dispositif;
  ui.lockDispositif = true;
  ui.siteId = null;
  if (!ui.weekStart) ui.weekStart = dateKey(mondayOf(new Date()));
  container.innerHTML = `<div class="hint">Chargement…</div>`;
  unsubs.push(watchSites((s) => {
    state.sites = s;
    if (!ui.siteId) ui.siteId = s.find(x => siteDispositif(x) === dispositif)?.id;
    render();
  }));
  unsubs.push(watchFiches((f) => { state.fiches = f; renderSiLibre(); }));
  unsubs.push(watchUsers((u) => { state.allAgents = u.filter(x => MENAGE_ROLES.includes(x.role)); render(); }));
  unsubs.push(watchAccess((a) => { state.access = a; render(); }));
}

function isEditorUser(user) { return user && (user.role === "super_admin" || user.role === "admin" || user.role === "n1"); }

function effectiveAgent() {
  if (isEditorUser(mountedUser) && ui.actingUid) {
    return { uid: ui.actingUid, nom: ui.actingNom };
  }
  return { uid: mountedUser.uid, nom: mountedUser.nom || mountedUser.email };
}

function currentFiche() {
  const site = state.sites.find(s => s.id === ui.siteId) || state.sites[0];
  const agent = effectiveAgent();
  const id = ficheId(ui.siteId, ui.weekStart, agent.uid);
  const existing = state.fiches.find(f => f.id === id);
  if (existing) return { id, data: existing };
  return {
    id,
    data: {
      siteId: site?.id, siteName: site?.name,
      weekStart: ui.weekStart, weekEnd: dateKey(addDays(new Date(ui.weekStart), 4)),
      agentUid: agent.uid, agentNom: agent.nom,
      cells: {}, obs: {}, periodiques: {}, chambres: [], observationsGenerales: "",
      submitted: false,
    },
  };
}

function scheduleSave(id, data) {
  setSaveStatus("saving");
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await saveFiche(id, data);
      setSaveStatus("ok");
    } catch (e) {
      console.error("Erreur d'enregistrement de la fiche:", e);
      setSaveStatus("error", e.message || String(e));
    }
  }, 500);
}

function setSaveStatus(status, errorMsg) {
  const el = document.getElementById("fc-save-status");
  if (!el) return;
  if (status === "saving") el.innerHTML = `<span style="color:var(--text-dim)">⏳ Enregistrement…</span>`;
  else if (status === "ok") el.innerHTML = `<span style="color:var(--teal)">✓ Enregistré</span>`;
  else if (status === "error") el.innerHTML = `<span style="color:var(--red)">❌ Échec de l'enregistrement : ${esc(errorMsg)}</span>`;
}

function vueSemaineHTML(site, data) {
  return `<div class="fj-semaine">${site.rooms.map((room, ri) => `
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
                ${room.tasks.map((task, ti) => {
                  const per = !!periodeTache(task);
                  const cellules = room.days.map(d => {
                    if (!per) {
                      const key = `${ri}-${ti}-${d}`;
                      return `<td style="text-align:center"><input type="checkbox" data-cell="${key}" ${data.cells[key] ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--gold)"></td>`;
                    }
                    const e = etatPerJour(site, room, task, jourISO(d));
                    if (!e.visible) return `<td style="text-align:center;color:var(--text-dim)">—</td>`;
                    return `<td style="text-align:center"><input type="checkbox" data-per-cell="P:${ri}-${ti}-${d}" ${e.fait ? 'checked' : ''} style="width:18px;height:18px;accent-color:${e.retard ? 'var(--red)' : 'var(--gold)'}"></td>`;
                  });
                  if (per && cellules.every(c => c.includes("—"))) return "";
                  return `
                  <tr>
                    <td>${esc(task.label)}${task.freq ? ` <span style="color:var(--text-dim);font-size:11px">(${esc(task.freq)})</span>` : ""}</td>
                    ${cellules.join("")}
                    <td><input data-obs="${ri}-${ti}" value="${esc(data.obs[`${ri}-${ti}`] || "")}" style="min-width:140px" placeholder="—"></td>
                  </tr>`;
                }).join("")}
              </tbody>
            </table>
          </div>
        </div>
      `).join("")}</div>`;
}

// ---- Tâches périodiques (1X/mois, 2X/mois, 1X/3 mois…) ----
// Elles ne sont pas à faire chaque jour : elles apparaissent dans la
// pièce, comme les autres, quand la période est écoulée depuis la
// dernière fois qu'elles ont été faites (ex. plinthes faites le 25/09 →
// reviennent le 25/10), et disparaissent une fois cochées. Les dates
// sont enregistrées dans data.periodiques de la fiche de la semaine ; le
// suivi est commun au site (peu importe quel agent l'a faite).
function periodeTache(task) {
  const m = String(task?.freq || "").replace(/\s+/g, "").match(/^(\d+)x\/(\d*)mois$/i);
  if (!m) return null;
  return { fois: +m[1] || 1, mois: +(m[2] || 1) || 1 };
}
function intervalleJours(task) { const p = periodeTache(task); return Math.max(1, Math.round(30 * p.mois / p.fois)); }
function seuilRetardJours(task) { return Math.max(90, intervalleJours(task) + 30); }
function clePeriodique(room, task) { return `${room.name}|${task.label}`; }
function datesFaitesSite(siteId, cle) {
  const out = [];
  state.fiches.filter(f => f.siteId === siteId && f.periodiques && Array.isArray(f.periodiques[cle]))
    .forEach(f => out.push(...f.periodiques[cle]));
  return [...new Set(out)].sort();
}
function joursEntre(isoA, isoB) { return Math.round((new Date(isoB) - new Date(isoA)) / 864e5); }
function fmtJM(iso) { const d = new Date(iso); return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`; }
function jourISO(jour) { return dateKey(addDays(new Date(ui.weekStart), JOURS_KEYS.indexOf(jour))); }
function premiereFicheSite(siteId) { return state.fiches.filter(f => f.siteId === siteId).map(f => f.weekStart).filter(Boolean).sort()[0] || null; }

// État d'une tâche périodique pour un jour donné.
function etatPerJour(site, room, task, iso) {
  const dates = datesFaitesSite(site.id, clePeriodique(room, task));
  const fait = dates.includes(iso);
  const avant = dates.filter(d => d < iso);
  const derniere = avant[avant.length - 1] || null;
  const echeance = derniere ? dateKey(addDays(new Date(derniere), intervalleJours(task))) : null;
  // Faite plus tard dans la même semaine → on ne la montre pas les jours d'avant.
  const finSemaine = dateKey(addDays(new Date(ui.weekStart || iso), 4));
  const faitePlusTard = dates.some(d => d > iso && d <= finSemaine);
  const visible = fait || (!faitePlusTard && (!derniere || iso >= echeance));
  const debut = premiereFicheSite(site.id);
  const retard = !fait && (derniere ? joursEntre(derniere, iso) > seuilRetardJours(task) : !!(debut && joursEntre(debut, iso) > seuilRetardJours(task)));
  return { fait, visible, retard, derniere };
}

// Pour l'accueil : tâches périodiques en retard aujourd'hui, par site.
export function retardsPeriodiques(sites, fiches) {
  const sauv = state.fiches;
  state.fiches = fiches;
  try {
    const auj = dateKey(new Date());
    return sites.map(site => {
      const retards = [];
      (site.rooms || []).forEach(room => (room.tasks || []).forEach(task => {
        if (periodeTache(task) && etatPerJour(site, room, task, auj).retard) retards.push({ room, task });
      }));
      return { site, retards };
    }).filter(x => x.retards.length);
  } finally { state.fiches = sauv; }
}

// Tâches visibles d'une pièce pour un jour (normales + périodiques dues).
function itemsPiece(site, data, ri, jour) {
  const room = site.rooms[ri];
  if (!(room.days || []).includes(jour)) return [];
  const iso = jourISO(jour);
  const out = [];
  (room.tasks || []).forEach((task, ti) => {
    if (!periodeTache(task)) { out.push({ ti, task, key: `${ri}-${ti}-${jour}`, fait: !!data.cells[`${ri}-${ti}-${jour}`] }); return; }
    const e = etatPerJour(site, room, task, iso);
    if (e.visible) out.push({ ti, task, key: `P:${ri}-${ti}-${jour}`, per: true, fait: e.fait, retard: e.retard, derniere: e.derniere });
  });
  return out;
}
function tachesDuJour(site, data, jour) {
  return (site.rooms || []).flatMap((_, ri) => itemsPiece(site, data, ri, jour));
}
function compte(site, data, jour) {
  const t = tachesDuJour(site, data, jour);
  return { total: t.length, faits: t.filter(x => x.fait).length };
}

// Coche / décoche une tâche périodique (clé "P:ri-ti-JOUR").
function basculerPeriodique(site, data, id, key, fait) {
  const [ri, ti, jour] = key.slice(2).split("-");
  const room = site.rooms[+ri], task = room.tasks[+ti];
  const cle = clePeriodique(room, task), iso = jourISO(jour);
  if (!data.periodiques) data.periodiques = {};
  const liste = new Set(data.periodiques[cle] || []);
  if (fait) liste.add(iso); else liste.delete(iso);
  // Liste vide plutôt que suppression : l'enregistrement fusionne les
  // champs, une clé supprimée resterait en base (décoche perdue).
  data.periodiques[cle] = [...liste].sort();
  // Mise à jour locale immédiate (sans attendre le retour de Firestore).
  const i = state.fiches.findIndex(f => f.id === id);
  if (i >= 0) state.fiches[i] = { ...state.fiches[i], periodiques: { ...data.periodiques } };
  else state.fiches.push({ id, ...data, periodiques: { ...data.periodiques } });
  scheduleSave(id, data);
}

function anneauHTML(pct, taille = 92) {
  const r = 40, c = 2 * Math.PI * r;
  return `<svg class="fj-anneau" viewBox="0 0 100 100" width="${taille}" height="${taille}" aria-hidden="true">
    <circle cx="50" cy="50" r="${r}" class="fj-anneau-fond"/>
    <circle cx="50" cy="50" r="${r}" class="fj-anneau-val" data-anneau stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct / 100)}"/>
  </svg>`;
}

function vueJourHTML(site, data) {
  const jour = ui.jour;
  const { total, faits } = compte(site, data, jour);
  const pct = total ? Math.round(faits / total * 100) : 0;
  const semaine = JOURS_KEYS.reduce((a, j) => { const c = compte(site, data, j); a.t += c.total; a.f += c.faits; return a; }, { t: 0, f: 0 });
  const pctSem = semaine.t ? Math.round(semaine.f / semaine.t * 100) : 0;
  const prenom = String(data.agentNom || "").split(/[\s@]/)[0];
  const dateJour = addDays(new Date(ui.weekStart), JOURS_KEYS.indexOf(jour));
  const piecesDuJour = (site.rooms || []).map((room, ri) => ({ room, ri, items: itemsPiece(site, data, ri, jour) })).filter(x => x.items.length);

  return `
  <div class="fj">
    <div class="fj-hero">
      <div class="fj-hero-txt">
        <div class="fj-bonjour">Bonjour ${esc(prenom)} 👋</div>
        <div class="fj-date">${JOURS_LONGS[jour]} ${dateJour.getDate()}/${String(dateJour.getMonth() + 1).padStart(2, "0")} · ${esc(site.name)}</div>
        <div class="fj-msg" data-fj-msg>${messageMotivation(faits, total)}</div>
        <div class="fj-sem">Semaine : <b data-fj-sem>${semaine.f}/${semaine.t}</b>
          <span class="fj-sem-barre"><span data-fj-sem-barre style="width:${pctSem}%"></span></span></div>
      </div>
      <div class="fj-hero-anneau">
        ${anneauHTML(pct)}
        <div class="fj-anneau-txt"><b data-fj-pct>${pct}%</b><span data-fj-compte>${faits}/${total}</span></div>
      </div>
    </div>

    <div class="fj-jours">
      ${JOURS_KEYS.map(j => {
        const c = compte(site, data, j);
        const fini = c.total > 0 && c.faits === c.total;
        return `<button class="fj-jour ${j === jour ? "actif" : ""} ${fini ? "fini" : ""}" data-fj-jour="${j}">
          <span>${DAY_LABELS[j]}</span>
          <small data-fj-jour-compte="${j}">${c.total ? (fini ? "✓" : `${c.faits}/${c.total}`) : "—"}</small>
        </button>`;
      }).join("")}
    </div>

    <div class="fj-bravo ${total && faits === total ? "visible" : ""}" data-fj-bravo>
      <span class="fj-bravo-emo">🎉</span>
      <div><b>Bravo ! Journée terminée</b><br><small>Toutes les tâches du ${JOURS_LONGS[jour].toLowerCase()} sont faites. Merci ✨</small></div>
    </div>

    ${piecesDuJour.length === 0 ? `<div class="fj-vide">☕ Aucune tâche prévue ce jour-là sur ce site.</div>` : ""}

    ${piecesDuJour.map(({ room, ri, items }) => {
      const f = items.filter(x => x.fait).length;
      const fini = f === items.length && items.length > 0;
      return `
      <div class="fj-piece ${fini ? "finie" : ""}" data-fj-piece="${ri}">
        <div class="fj-piece-tete">
          <div class="fj-piece-nom">${esc(room.name)}</div>
          <div class="fj-piece-compte" data-fj-piece-compte="${ri}">${f}/${items.length}</div>
          <button class="fj-tout" data-fj-tout="${ri}">${fini ? "↺ Tout décocher" : "✓ Tout fait"}</button>
        </div>
        <div class="fj-piece-barre"><span data-fj-piece-barre="${ri}" style="width:${items.length ? f / items.length * 100 : 0}%"></span></div>
        ${items.map(({ ti, task, key, per, fait, retard, derniere }) => {
          const obs = data.obs[`${ri}-${ti}`] || "";
          const tag = per
            ? `<em class="fj-tag-per ${retard ? "retard" : ""}">📅 ${esc(task.freq)}${retard ? " · en retard" : ""}</em><small class="fj-derniere">${derniere ? `Dernière fois le ${fmtJM(derniere)}` : "Jamais faite"}</small>`
            : (task.freq ? `<em>${esc(task.freq)}</em>` : "");
          return `
          <div class="fj-tache ${fait ? "faite" : ""} ${per ? "periodique" : ""}" data-fj-tache="${key}">
            <button class="fj-coche" data-fj-coche="${key}" aria-pressed="${fait}" aria-label="${esc(task.label)}">
              <span class="fj-rond"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>
              <span class="fj-label">${esc(task.label)}${tag}</span>
            </button>
            <button class="fj-obs-btn ${obs ? "a-obs" : ""}" data-fj-obs-btn="${ri}-${ti}" title="Ajouter une remarque">💬</button>
            <div class="fj-obs ${obs ? "ouverte" : ""}" data-fj-obs-zone="${ri}-${ti}">
              <input data-obs="${ri}-${ti}" value="${esc(obs)}" placeholder="Une remarque ? (produit manquant, souci…)">
            </div>
          </div>`;
        }).join("")}
      </div>`;
    }).join("")}
  </div>`;
}

function messageMotivation(faits, total) {
  if (!total) return "Pas de tâche aujourd'hui.";
  if (faits === 0) return "C'est parti ! Touche une tâche quand elle est faite.";
  if (faits === total) return "Tout est fait, super travail ! 💪";
  const reste = total - faits;
  if (faits / total >= 0.75) return `Presque fini, plus que ${reste} ! 🔥`;
  if (faits / total >= 0.5) return `Plus de la moitié, continue ! (${reste} restantes)`;
  return `Bien lancé ! Encore ${reste} tâche${reste > 1 ? "s" : ""}.`;
}

// Met à jour compteurs / barres / anneau sans reconstruire l'écran
// (garde l'animation de la coche fluide).
function majProgressionJour(site, data) {
  const c = mountedContainer;
  const jour = ui.jour;
  const { total, faits } = compte(site, data, jour);
  const pct = total ? Math.round(faits / total * 100) : 0;
  const anneau = c.querySelector("[data-anneau]");
  if (anneau) { const circ = 2 * Math.PI * 40; anneau.setAttribute("stroke-dashoffset", String(circ * (1 - pct / 100))); }
  const set = (sel, v) => { const el = c.querySelector(sel); if (el) el.textContent = v; };
  set("[data-fj-pct]", `${pct}%`);
  set("[data-fj-compte]", `${faits}/${total}`);
  const msg = c.querySelector("[data-fj-msg]"); if (msg) msg.innerHTML = messageMotivation(faits, total);
  const sem = JOURS_KEYS.reduce((a, j) => { const x = compte(site, data, j); a.t += x.total; a.f += x.faits; return a; }, { t: 0, f: 0 });
  set("[data-fj-sem]", `${sem.f}/${sem.t}`);
  const sb = c.querySelector("[data-fj-sem-barre]"); if (sb) sb.style.width = `${sem.t ? sem.f / sem.t * 100 : 0}%`;
  JOURS_KEYS.forEach(j => {
    const x = compte(site, data, j);
    const fini = x.total > 0 && x.faits === x.total;
    set(`[data-fj-jour-compte="${j}"]`, x.total ? (fini ? "✓" : `${x.faits}/${x.total}`) : "—");
    c.querySelector(`[data-fj-jour="${j}"]`)?.classList.toggle("fini", fini);
  });
  c.querySelectorAll("[data-fj-piece]").forEach(el => {
    const ri = +el.dataset.fjPiece;
    // On compte les lignes affichées (une tâche périodique cochée reste affichée ce jour-là).
    const cles = [...el.querySelectorAll("[data-fj-tache]")].map(x => x.dataset.fjTache);
    const items = itemsPiece(site, data, ri, jour);
    const f = cles.filter(k => items.find(x => x.key === k)?.fait).length;
    const fini = f === cles.length && cles.length > 0;
    el.classList.toggle("finie", fini);
    set(`[data-fj-piece-compte="${ri}"]`, `${f}/${cles.length}`);
    const b = c.querySelector(`[data-fj-piece-barre="${ri}"]`); if (b) b.style.width = `${cles.length ? f / cles.length * 100 : 0}%`;
    const bt = c.querySelector(`[data-fj-tout="${ri}"]`); if (bt) bt.textContent = fini ? "↺ Tout décocher" : "✓ Tout fait";
  });
  const bravo = c.querySelector("[data-fj-bravo]");
  const etaitVisible = bravo?.classList.contains("visible");
  const fini = total > 0 && faits === total;
  bravo?.classList.toggle("visible", fini);
  if (fini && !etaitVisible) lancerConfettis();
}

function lancerConfettis() {
  const zone = document.createElement("div");
  zone.className = "fj-confettis";
  const couleurs = ["#1baf7a", "#A87A12", "#2a78d6", "#eb6834", "#4a3aa7", "#f2c94c"];
  for (let i = 0; i < 40; i++) {
    const s = document.createElement("span");
    s.style.left = Math.random() * 100 + "vw";
    s.style.background = couleurs[i % couleurs.length];
    s.style.animationDelay = (Math.random() * 0.4) + "s";
    s.style.transform = `rotate(${Math.random() * 360}deg)`;
    zone.appendChild(s);
  }
  document.body.appendChild(zone);
  setTimeout(() => zone.remove(), 2600);
}

function render() {
  if (!mountedContainer) return;
  if (!document.contains(mountedContainer)) { cleanup(); return; }
  if (state.sites.length === 0) { mountedContainer.innerHTML = `<div class="hint">Chargement des sites…</div>`; return; }
  const disps = dispositifs();
  const sitesInDisp = state.sites.filter(s => siteDispositif(s) === ui.dispositif);
  const site = sitesInDisp.find(s => s.id === ui.siteId) || sitesInDisp[0];
  state.agents = state.allAgents.filter(a => hasAccess(state.access, ui.dispositif, { uid: a.uid, role: a.role }));
  const weekStartDate = new Date(ui.weekStart);
  const weekEndDate = addDays(weekStartDate, 4);
  const { id, data } = currentFiche();
  renderEnAttente = false;
  if (!ui.jour || !JOURS_KEYS.includes(ui.jour)) ui.jour = jourParDefaut();

  mountedContainer.innerHTML = `
    <div class="stack">
      ${!ui.lockDispositif ? `
      <div class="tabs" style="background:none;border:none;padding:0;margin-bottom:-6px">
        ${disps.map(d => `<button class="tab-btn ${d === ui.dispositif ? 'active' : ''}" data-disp="${esc(d)}">${esc(d)}</button>`).join("")}
      </div>` : ""}

      <div class="form-card">
        <div class="form-grid">
          ${sitesInDisp.length > 1 ? `
          <label>Site
            <select id="fc-site">${sitesInDisp.map(s => `<option value="${s.id}" ${s.id === ui.siteId ? 'selected' : ''}>${esc(s.name)}</option>`).join("")}</select>
          </label>` : `<label>Site<input value="${esc(site?.name || '')}" disabled></label>`}
          <label>Semaine
            <div style="display:flex;align-items:center;gap:8px">
              <button class="nav-btn" id="fc-prev">‹</button>
              <span style="font-size:13px;white-space:nowrap">${fmtShort(weekStartDate)} → ${fmtShort(weekEndDate)}</span>
              <button class="nav-btn" id="fc-next">›</button>
            </div>
          </label>
          ${isEditorUser(mountedUser) ? `
          <label>Remplir au nom de
            <select id="fc-agent">
              <option value="" ${!ui.actingUid ? 'selected' : ''}>Moi-même (${esc(mountedUser.nom || mountedUser.email)})</option>
              ${state.agents.map(a => `<option value="${a.uid}" ${ui.actingUid === a.uid ? 'selected' : ''}>${esc(a.nom || a.email)}</option>`).join("")}
            </select>
          </label>` : `<label>Agent<input value="${esc(data.agentNom)}" disabled></label>`}
        </div>
      </div>

      <div class="fj-vues">
        <button class="${ui.vue === "jour" ? "actif" : ""}" data-fj-vue="jour">📱 Ma journée</button>
        <button class="${ui.vue === "semaine" ? "actif" : ""}" data-fj-vue="semaine">📋 Toute la semaine</button>
      </div>

      ${data.submitted ? `<div class="stat-chip ok" style="width:fit-content">✓ Fiche marquée comme terminée pour cette semaine</div>` : ""}

      ${ui.vue === "jour" ? vueJourHTML(site, data) : vueSemaineHTML(site, data)}

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

      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        <button class="add-btn" id="fc-save">💾 Enregistrer</button>
        <button class="nav-btn" id="fc-submit">${data.submitted ? "↩️ Rouvrir la fiche" : "✓ Marquer la semaine comme terminée"}</button>
        <span id="fc-save-status" style="font-size:12px"></span>
      </div>
    </div>
  `;

  document.getElementById("fc-site")?.addEventListener("change", (e) => { ui.siteId = e.target.value; render(); });
  document.getElementById("fc-agent")?.addEventListener("change", (e) => {
    const uid = e.target.value;
    if (!uid) { ui.actingUid = null; ui.actingNom = null; }
    else {
      const a = state.agents.find(x => x.uid === uid);
      ui.actingUid = uid;
      ui.actingNom = a?.nom || a?.email;
    }
    render();
  });
  document.getElementById("fc-prev").addEventListener("click", () => { ui.weekStart = dateKey(addDays(weekStartDate, -7)); ui.jour = null; render(); });
  document.getElementById("fc-next").addEventListener("click", () => { ui.weekStart = dateKey(addDays(weekStartDate, 7)); ui.jour = null; render(); });
  mountedContainer.querySelectorAll("[data-fj-vue]").forEach(b => b.addEventListener("click", () => { ui.vue = b.dataset.fjVue; render(); }));
  mountedContainer.querySelectorAll("[data-fj-jour]").forEach(b => b.addEventListener("click", () => { ui.jour = b.dataset.fjJour; render(); }));
  mountedContainer.querySelectorAll("[data-fj-coche]").forEach(b => b.addEventListener("click", () => {
    const key = b.dataset.fjCoche;
    const ligne = b.closest("[data-fj-tache]");
    const fait = !ligne.classList.contains("faite");
    if (key.startsWith("P:")) basculerPeriodique(site, data, id, key, fait);
    else { data.cells[key] = fait; scheduleSave(id, data); }
    ligne.classList.toggle("faite", fait);
    b.setAttribute("aria-pressed", String(fait));
    if (fait) { ligne.classList.remove("pop"); void ligne.offsetWidth; ligne.classList.add("pop"); if (navigator.vibrate) navigator.vibrate(15); }
    majProgressionJour(site, data);
  }));
  mountedContainer.querySelectorAll("[data-per-cell]").forEach(cb => cb.addEventListener("change", () => {
    basculerPeriodique(site, data, id, cb.dataset.perCell, cb.checked);
  }));
  mountedContainer.querySelectorAll("[data-fj-tout]").forEach(b => b.addEventListener("click", () => {
    const piece = b.closest("[data-fj-piece]");
    const lignes = [...piece.querySelectorAll("[data-fj-tache]")];
    const toutFait = lignes.every(l => l.classList.contains("faite"));
    lignes.forEach(l => {
      const key = l.dataset.fjTache;
      if (key.startsWith("P:")) basculerPeriodique(site, data, id, key, !toutFait);
      else data.cells[key] = !toutFait;
      l.classList.toggle("faite", !toutFait);
    });
    majProgressionJour(site, data);
    scheduleSave(id, data);
  }));
  mountedContainer.querySelectorAll("[data-fj-obs-btn]").forEach(b => b.addEventListener("click", () => {
    const zone = mountedContainer.querySelector(`[data-fj-obs-zone="${b.dataset.fjObsBtn}"]`);
    zone?.classList.toggle("ouverte");
    if (zone?.classList.contains("ouverte")) zone.querySelector("input")?.focus();
  }));
  mountedContainer.addEventListener("focusout", () => { setTimeout(() => { if (renderEnAttente && !saisieEnCours()) render(); }, 0); });
  mountedContainer.querySelectorAll("[data-disp]").forEach(btn => {
    btn.addEventListener("click", () => {
      ui.dispositif = btn.dataset.disp;
      ui.siteId = state.sites.find(s => siteDispositif(s) === ui.dispositif)?.id;
      render();
    });
  });

  mountedContainer.querySelectorAll("[data-cell]").forEach(cb => {
    cb.addEventListener("change", () => {
      data.cells[cb.dataset.cell] = cb.checked;
      scheduleSave(id, data);
    });
  });
  mountedContainer.querySelectorAll("[data-obs]").forEach(inp => {
    inp.addEventListener("input", () => {
      data.obs[inp.dataset.obs] = inp.value;
      mountedContainer.querySelector(`[data-fj-obs-btn="${inp.dataset.obs}"]`)?.classList.toggle("a-obs", !!inp.value);
      scheduleSave(id, data);
    });
  });
  mountedContainer.querySelectorAll("[data-chambre-field]").forEach(inp => {
    inp.addEventListener("input", () => {
      const idx = parseInt(inp.dataset.chambreIdx, 10);
      if (inp.dataset.chambreField === "date" && inp.value && !isPlausibleDate(inp.value)) return; // année incomplète, on n'enregistre pas encore
      data.chambres[idx][inp.dataset.chambreField] = inp.value;
      scheduleSave(id, data);
    });
  });
  document.getElementById("fc-add-chambre")?.addEventListener("click", async () => {
    data.chambres.push({ chambre: "", date: "", observation: "" });
    render();
    try { await saveFiche(id, data); } catch (e) { console.error(e); window.toast("Échec de l'enregistrement : " + e.message); }
  });
  mountedContainer.querySelectorAll("[data-del-chambre]").forEach(btn => {
    btn.addEventListener("click", async () => {
      data.chambres.splice(parseInt(btn.dataset.delChambre, 10), 1);
      render();
      try { await saveFiche(id, data); } catch (e) { console.error(e); window.toast("Échec de l'enregistrement : " + e.message); }
    });
  });
  document.getElementById("fc-obs-generales").addEventListener("input", (e) => {
    data.observationsGenerales = e.target.value;
    scheduleSave(id, data);
  });
  document.getElementById("fc-save").addEventListener("click", async () => {
    setSaveStatus("saving");
    try { await saveFiche(id, data); setSaveStatus("ok"); }
    catch (e) { console.error(e); setSaveStatus("error", e.message || String(e)); }
  });
  document.getElementById("fc-submit").addEventListener("click", async () => {
    data.submitted = !data.submitted;
    try { await saveFiche(id, data); render(); }
    catch (e) { console.error(e); window.toast("Échec de l'enregistrement : " + e.message); }
  });
}

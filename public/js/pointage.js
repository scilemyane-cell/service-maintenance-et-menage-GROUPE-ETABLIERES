// pointage.js — Pointage simple des heures de la semaine (arrivée / départ par jour).
// Enregistré dans le même document que la « Répartition » (heures-repartition/{dispositif}_{lundi}_{uid})
// pour rester compatible avec l'archive et les stats : jours[LUN…] = heures calculées depuis les créneaux.
import { esc, dateKey, addDays } from "./astreinte-logic.js";
import { auth, db } from "./firebase-init.js";
import { doc, deleteDoc } from "./firestore-compte.js";
import { watchDispositifSettings, templateFor } from "./dispositif-settings-data.js";
import { watchRepartitions, saveRepartition, repartitionId } from "./heures-repartition-data.js";
import { watchUsers } from "./users-data.js";
import { watchAccess, hasAccess } from "./access-data.js";

const DAYS = ["LUN", "MAR", "MER", "JEU", "VEN", "SAM", "DIM"];
const NOMS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
const estEditeur = (u) => ["super_admin", "admin", "n1"].includes(u?.role);
const lundi = (d) => addDays(d, -((d.getDay() + 6) % 7));
const min = (t) => { const [h, m] = String(t || "").split(":").map(Number); return Number.isFinite(h) ? h * 60 + (m || 0) : null; };
const duree = (c) => { const a = min(c.a), d = min(c.d); return a != null && d != null && d > a ? (d - a) / 60 : 0; };
const fmtH = (h) => { const t = Math.round(h * 60); return `${Math.floor(t / 60)}h${String(t % 60).padStart(2, "0")}`; };
const maintenant = () => { const n = new Date(); return `${String(n.getHours()).padStart(2, "0")}:${String(n.getMinutes()).padStart(2, "0")}`; };

let st = { settings: {}, reps: [], users: [], access: {} }, ui = { semaine: null, agent: null }, unsubs = [], cont = null, user = null, disp = "", brouillon = null, tSave = null;

export function mountPointage(container, u, dispositif) {
  unsubs.forEach(f => f()); unsubs = [];
  cont = container; user = u; disp = dispositif; brouillon = null;
  if (!ui.semaine) ui.semaine = dateKey(lundi(new Date()));
  container.innerHTML = `<p class="hint">Chargement…</p>`;
  chargerMeteo(); // pré-chargée pour que le message s'affiche tout de suite
  unsubs.push(watchDispositifSettings((s) => { st.settings = s; render(); }));
  unsubs.push(watchRepartitions((r) => { st.reps = r; if (!tSave) brouillon = null; render(); }));
  if (estEditeur(u)) {
    unsubs.push(watchUsers((l) => { st.users = l.filter(x => ["menage", "mi_temps"].includes(x.role)); render(); }));
    unsubs.push(watchAccess((a) => { st.access = a; render(); }));
  }
}

function agent() {
  if (!estEditeur(user)) return { uid: user.uid, nom: user.nom || user.email };
  const l = st.users.filter(a => hasAccess(st.access, disp, { uid: a.uid, role: a.role }));
  const a = l.find(x => x.uid === ui.agent) || l[0];
  return a ? { uid: a.uid, nom: a.nom || a.email, liste: l } : { uid: user.uid, nom: user.nom || user.email, liste: [] };
}

function fiche() {
  const ag = agent(), id = repartitionId(disp, ui.semaine, ag.uid);
  if (brouillon?.id === id) return brouillon;
  const ex = st.reps.find(r => r.id === id), prevu = templateFor(st.settings, disp).reduce((s, t) => s + (+t.heures || 0), 0);
  const label = templateFor(st.settings, disp)[0]?.label || "Heures";
  const data = ex ? JSON.parse(JSON.stringify(ex)) : { dispositif: disp, weekStart: ui.semaine, weekEnd: dateKey(addDays(new Date(ui.semaine + "T12:00"), 6)), agentUid: ag.uid, agentNom: ag.nom, lignes: [{ label, prevu, jours: Object.fromEntries(DAYS.map(d => [d, 0])) }], submitted: false, valide: false };
  data.pointages = data.pointages || {};
  // Ancienne saisie en heures (sans créneaux) : on la garde telle quelle pour ce jour.
  brouillon = { id, data, prevu: prevu || data.lignes?.reduce((s, l) => s + (+l.prevu || 0), 0) || 0, nom: ag.nom };
  return brouillon;
}
const heuresJour = (data, d) => (data.pointages[d] || []).length ? data.pointages[d].reduce((s, c) => s + duree(c), 0)
  : (data.lignes || []).reduce((s, l) => s + (parseFloat(l.jours?.[d]) || 0), 0);

function enregistrer(f) {
  // Recalcule les heures du jour (une seule ligne : le total du jour) pour l'archive / stats.
  const jours = Object.fromEntries(DAYS.map(d => [d, Math.round(heuresJour(f.data, d) * 100) / 100]));
  f.data.lignes = [{ label: f.data.lignes?.[0]?.label || templateFor(st.settings, disp)[0]?.label || "Heures", prevu: f.prevu, jours }];
  // Lien d'accès sans mot de passe : le document reste rangé sous le compte de l'agent,
  // mais l'écriture se fait avec la session anonyme du lien (règle agentUid == auth.uid).
  if (user?.invite) { f.data.agentUid = auth.currentUser?.uid || f.data.agentUid; f.data.agentCle = user.uid; f.data.viaLien = true; }
  clearTimeout(tSave);
  const etat = cont.querySelector(".pt-etat"); if (etat) etat.textContent = "⏳ Enregistrement…";
  tSave = setTimeout(async () => {
    try { await saveRepartition(f.id, f.data); const e = cont.querySelector(".pt-etat"); if (e) e.textContent = "✓ Enregistré"; }
    catch (e) { const el = cont.querySelector(".pt-etat"); if (el) el.textContent = "❌ Non enregistré : " + (e?.message || e); }
    tSave = null;
  }, 400);
}

function render() {
  if (!cont || !document.contains(cont)) { unsubs.forEach(f => f()); unsubs = []; return; }
  const f = fiche(), data = f.data, ag = agent(), auj = dateKey(new Date());
  const lun = new Date(ui.semaine + "T12:00"), dateDe = (i) => dateKey(addDays(lun, i));
  const total = DAYS.reduce((s, d) => s + heuresJour(data, d), 0), ecart = total - f.prevu;
  const iAuj = DAYS.findIndex((_, i) => dateDe(i) === auj), dAuj = DAYS[iAuj];
  const enCours = dAuj ? (data.pointages[dAuj] || []).find(c => c.a && !c.d) : null;
  const ed = estEditeur(user), verrou = data.valide && !ed;
  const cfg = st.settings[disp] || {}, off = cfg.joursOff ?? [6, 0];
  const bloque = (iso) => { const b = (cfg.datesBloquees || []).find(x => iso >= x.du && iso <= (x.au || x.du)); if (b) return "⛔ " + (b.motif || "Date bloquée"); return off.includes(new Date(iso + "T12:00").getDay()) ? "Pas de présence prévue" : ""; };
  const bAuj = dAuj ? bloque(auj) : "";
  const fr = (d, o) => new Date(d + "T12:00").toLocaleDateString("fr-FR", o);
  cont.innerHTML = `<div class="stack pt">
    ${estEditeur(user) && ag.liste?.length > 1 ? `<label class="pt-ag">Agent <select data-pt-agent>${ag.liste.map(a => `<option value="${a.uid}" ${a.uid === ag.uid ? "selected" : ""}>${esc(a.nom || a.email)}</option>`).join("")}</select></label>` : ""}
    <div class="pt-sem"><button class="nav-btn" data-pt-sem="-1">‹</button><div><b>Semaine du ${fr(ui.semaine, { day: "numeric", month: "long" })}</b><small>${esc(ag.nom)}</small></div><button class="nav-btn" data-pt-sem="1">›</button></div>
    ${dAuj && !verrou && bAuj && !enCours && !estEditeur(user) ? `<div class="pt-gros"><p>📅 Aujourd'hui : <b>${esc(bAuj)}</b></p></div>` : dAuj && !verrou ? `<div class="pt-gros">${enCours ? `<p>Arrivé à <b>${enCours.a.replace(":", "h")}</b></p><button class="pt-btn stop" data-pt-depart>⏹️ Je pars</button>` : `<button class="pt-btn go" data-pt-arrive>▶️ J'arrive</button>`}<small>Touche le bouton en arrivant et en partant : l'heure est notée toute seule.</small></div>`
      : ui.semaine !== dateKey(lundi(new Date())) ? `<button class="nav-btn" data-pt-auj style="align-self:center">↩️ Revenir à cette semaine</button>` : ""}
    <div class="pt-tot ${f.prevu && ecart < -0.01 ? "moins" : f.prevu && ecart > 0.01 ? "plus" : "ok"}"><div><span>Total semaine</span><b>${fmtH(total)}</b></div>${f.prevu ? `<div><span>Contrat</span><b>${fmtH(f.prevu)}</b></div><div><span>Écart</span><b>${ecart > 0 ? "+" : ecart < 0 ? "−" : ""}${fmtH(Math.abs(ecart))}</b></div>` : ""}</div>
    <div class="pt-jours">${DAYS.map((d, i) => { const cr = data.pointages[d] || [], h = heuresJour(data, d), iso = dateDe(i);
      const bl = bloque(iso), ferme = bl && !estEditeur(user) && !cr.length;
      if (ferme) return `<div class="pt-j off"><div class="pt-j-t"><b>${NOMS[i]}</b><small>${fr(iso, { day: "numeric", month: "short" })}</small><span>${esc(bl)}</span></div></div>`;
      return `<div class="pt-j ${iso === auj ? "auj" : ""} ${h ? "plein" : ""} ${bl ? "off" : ""}"><div class="pt-j-t"><b>${NOMS[i]}</b><small>${fr(iso, { day: "numeric", month: "short" })}</small><span>${h ? fmtH(h) : bl ? esc(bl) : "—"}</span></div>
        ${cr.map((c, k) => { const fa = verrou || (c.b && !ed), fd = verrou || (c.bd && !ed) || (c.b && !c.d && !ed);
          return `<div class="pt-cr"><input type="time" value="${esc(c.a || "")}" data-pt-a="${d}|${k}" ${fa ? "disabled" : ""}><span>→</span><input type="time" value="${esc(c.d || "")}" data-pt-d="${d}|${k}" ${fd ? "disabled" : ""}>${verrou || (c.b && !ed) ? (c.b && !verrou ? `<span class="pt-lock" title="Heure pointée avec le bouton : seul le responsable peut la corriger">🔒</span>` : "") : `<button data-pt-rm="${d}|${k}" title="Retirer">✕</button>`}</div>`; }).join("")}
        ${verrou ? "" : `<button class="pt-add" data-pt-add="${d}">＋ ${cr.length ? "Autre créneau" : "Ajouter des heures"}</button>`}</div>`; }).join("")}</div>
    <div class="pt-pied"><span class="pt-etat"></span>
      ${data.valide ? `<span class="stat-chip ok">✅ Semaine validée</span>` : data.submitted ? `<span class="stat-chip ok">📨 Envoyée au responsable</span>` : ""}
      ${!data.valide ? `<button class="${data.submitted ? "nav-btn" : "add-btn"}" data-pt-envoi>${data.submitted ? "↩️ Modifier ma semaine" : "📨 Envoyer ma semaine"}</button>` : ""}
      ${estEditeur(user) && st.reps.some(r => r.id === f.id) ? `<button class="del-btn" data-pt-effacer>🗑️ Effacer la semaine</button>` : ""}
      ${estEditeur(user) ? `<button class="nav-btn" data-pt-valide>${data.valide ? "↩️ Retirer la validation" : "✅ Valider la semaine"}</button>` : ""}</div>
  </div>`;
  const $$ = (s) => cont.querySelectorAll(s), cle = (v) => v.split("|");
  $$("[data-pt-sem]").forEach(b => b.onclick = () => { ui.semaine = dateKey(addDays(new Date(ui.semaine + "T12:00"), 7 * +b.dataset.ptSem)); brouillon = null; render(); });
  cont.querySelector("[data-pt-auj]")?.addEventListener("click", () => { ui.semaine = dateKey(lundi(new Date())); brouillon = null; render(); });
  cont.querySelector("[data-pt-agent]")?.addEventListener("change", (e) => { ui.agent = e.target.value; brouillon = null; render(); });
  cont.querySelector("[data-pt-arrive]")?.addEventListener("click", async (e) => {
    e.currentTarget.disabled = true;
    if (!(await confirmerPointage(true))) { render(); return; }
    const premiere = !(data.pointages[dAuj] || []).length;
    (data.pointages[dAuj] = data.pointages[dAuj] || []).push({ a: maintenant(), d: "", b: 1 }); enregistrer(f); render();
    if (premiere && !estEditeur(user)) afficherMeteo(ag.nom);
  });
  cont.querySelector("[data-pt-depart]")?.addEventListener("click", async (e) => {
    e.currentTarget.disabled = true;
    if (!(await confirmerPointage(false))) { render(); return; }
    enCours.d = maintenant(); enCours.bd = 1; enregistrer(f); render();
  });
  $$("[data-pt-add]").forEach(b => b.onclick = () => { (data.pointages[b.dataset.ptAdd] = data.pointages[b.dataset.ptAdd] || []).push({ a: "", d: "" }); render(); cont.querySelector(`[data-pt-a="${b.dataset.ptAdd}|${data.pointages[b.dataset.ptAdd].length - 1}"]`)?.focus(); });
  const bloqueModif = (c, champ) => !estEditeur(user) && (data.valide || (champ === "d" ? c?.bd || (c?.b && !c?.d) : c?.b));
  $$("[data-pt-rm]").forEach(b => b.onclick = () => { const [d, k] = cle(b.dataset.ptRm); if (bloqueModif(data.pointages[d][+k], "a")) return; data.pointages[d].splice(+k, 1); enregistrer(f); render(); });
  $$("[data-pt-a],[data-pt-d]").forEach(inp => inp.onchange = () => { const [d, k] = cle(inp.dataset.ptA || inp.dataset.ptD); const c = data.pointages[d][+k]; if (bloqueModif(c, inp.dataset.ptA ? "a" : "d")) { render(); return; } c[inp.dataset.ptA ? "a" : "d"] = inp.value;
    if (c.a && c.d && min(c.d) <= min(c.a)) window.toast?.("⚠️ L'heure de départ doit être après l'arrivée"); enregistrer(f); render(); });
  cont.querySelector("[data-pt-envoi]")?.addEventListener("click", () => { data.submitted = !data.submitted; enregistrer(f); render(); });
  cont.querySelector("[data-pt-effacer]")?.addEventListener("click", async () => {
    if (!confirm(`Effacer toutes les heures de ${f.nom || "l'agent"} pour cette semaine ?`)) return;
    clearTimeout(tSave); tSave = null;
    try { await deleteDoc(doc(db, "heures-repartition", f.id)); brouillon = null; window.toast?.("🗑️ Semaine effacée"); render(); } catch (e) { alert("Effacement impossible : " + (e?.message || e)); }
  });
  cont.querySelector("[data-pt-valide]")?.addEventListener("click", () => { data.valide = !data.valide; if (data.valide) data.submitted = true; enregistrer(f); render(); });
}

// ---- Double validation « J'arrive » / « Je pars » (évite les touches accidentelles) ----
function confirmerPointage(arrivee) {
  return new Promise((resolve) => {
    const ov = document.createElement("div");
    ov.className = "pt-conf";
    ov.innerHTML = `<div class="pt-conf-box">
      <div class="pt-conf-ico">${arrivee ? "▶️" : "⏹️"}</div>
      <h3>${arrivee ? "Tu arrives ?" : "Tu pars ?"}</h3>
      <p>Heure notée : <b>${maintenant().replace(":", "h")}</b></p>
      <div class="pt-conf-btns"><button class="non">Annuler</button><button class="oui ${arrivee ? "go" : "stop"}">${arrivee ? "Oui, j'arrive" : "Oui, je pars"}</button></div>
    </div>`;
    const fin = (v) => { ov.remove(); resolve(v); };
    ov.querySelector(".non").onclick = () => fin(false);
    ov.querySelector(".oui").onclick = () => fin(true);
    ov.onclick = (e) => { if (e.target === ov) fin(false); };
    document.body.appendChild(ov);
  });
}

// ---- Petit message météo au début de la journée (Open-Meteo, gratuit, sans clé) ----
const METEO_LAT = 46.67, METEO_LON = -1.43; // La Roche-sur-Yon (résidence Cécile Sauvage)
let meteo = null, meteoJour = "";
function chargerMeteo() {
  const j = dateKey(new Date());
  if (meteo && meteoJour === j) return Promise.resolve(meteo);
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${METEO_LAT}&longitude=${METEO_LON}`
    + "&current=temperature_2m,weather_code,wind_speed_10m"
    + "&daily=temperature_2m_min,temperature_2m_max,precipitation_probability_max&timezone=Europe%2FParis&forecast_days=1";
  return fetch(url).then(r => r.json()).then(d => { meteo = d; meteoJour = j; return d; }).catch(() => null);
}
function messageMeteo(d, prenom) {
  const salut = new Date().getHours() < 12 ? "Bonjour" : "Salut";
  if (!d?.current || !d?.daily) return { ico: "👋", titre: `${salut} ${prenom} !`, txt: "Bonne journée et bon courage." };
  const t = Math.round(d.current.temperature_2m), code = d.current.weather_code, vent = d.current.wind_speed_10m,
    pluie = d.daily.precipitation_probability_max?.[0] ?? 0, tmin = d.daily.temperature_2m_min?.[0] ?? 10, tmax = Math.round(d.daily.temperature_2m_max?.[0] ?? t);
  let ico = "☀️", txt = "Beau temps, bonne journée dehors !";
  if ([71, 73, 75, 77, 85, 86].includes(code)) { ico = "❄️"; txt = "Neige annoncée : attention aux glissades avec les bacs."; }
  else if (code >= 95) { ico = "⛈️"; txt = "Orage possible : mets-toi à l'abri si ça gronde."; }
  else if (code >= 51 || pluie >= 60) { ico = "🌧️"; txt = "Pluie prévue : pense au K-way."; }
  else if (vent >= 40) { ico = "💨"; txt = "Gros vent : attention aux couvercles et aux bacs qui s'envolent."; }
  else if (tmin <= 2) { ico = "🥶"; txt = "Risque de gel : sol glissant, pense aux gants."; }
  else if (tmax >= 28) { ico = "🥵"; txt = "Il va faire chaud : bois bien de l'eau."; }
  else if (code >= 1 && code <= 3) { ico = "⛅"; txt = "Temps calme, bonne journée !"; }
  return { ico, titre: `${salut} ${prenom} ! ${t}°C`, txt: `${txt} (max ${tmax}°C)` };
}
function afficherMeteo(nom) {
  const p = String(nom || "").trim().split(/\s+/)[0] || "";
  const prenom = p ? p[0].toUpperCase() + p.slice(1).toLowerCase() : "";
  chargerMeteo().then(d => {
    const m = messageMeteo(d, prenom);
    document.querySelector(".pt-meteo")?.remove();
    const el = document.createElement("div");
    el.className = "pt-meteo";
    el.innerHTML = `<div class="ico">${m.ico}</div><div><b>${esc(m.titre)}</b><span>${esc(m.txt)}</span></div><button aria-label="Fermer">✕</button>`;
    el.querySelector("button").onclick = () => el.remove();
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 10000);
  });
}

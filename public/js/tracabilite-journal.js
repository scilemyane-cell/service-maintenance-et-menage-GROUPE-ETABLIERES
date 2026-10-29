// tracabilite-journal.js — Traçabilité › « 🕒 Journal & heures » (responsables).
// À partir du journal de remplissage (collection fiches-journal : ouvertures
// de l'écran de saisie, cases cochées / décochées avec leur jour, observations,
// envoi), on reconstitue pour chaque personne et chaque jour : heure de la
// 1re et de la dernière action, temps de présence estimé, comparaison avec le
// planning prévu, et les points à vérifier (cases cochées d'un coup, cases
// d'un autre jour, saisie hors horaires, modification par un responsable).
import { db } from "./firebase-init.js";
import { collection, query, where, onSnapshot, doc } from "./firestore-compte.js";
import { esc, addDays, dateKey } from "./astreinte-logic.js";
import { PLANNING_DEFAUT_MENAGE } from "./planning-menage.js";

const JOURS = ["LUN", "MAR", "MER", "JEU", "VEN", "SAM", "DIM"];
const NOMS_J = { LUN: "Lundi", MAR: "Mardi", MER: "Mercredi", JEU: "Jeudi", VEN: "Vendredi", SAM: "Samedi", DIM: "Dimanche" };
const ECART_SESSION = 45 * 60000, FIN_SESSION = 10 * 60000; // pause > 45 min = nouvelle session ; +10 min après la dernière action
const DEBUT_JOURNAL = "2026-10-29";
let el = null, ctx = {}, unsubs = [], evts = [], planning = null, ui = { lundi: null, agent: "", detail: "" };

const hm = (ms) => new Date(ms).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
const dureeTxt = (min) => { min = Math.round(min); const h = Math.floor(Math.abs(min) / 60), m = Math.abs(min) % 60; return `${min < 0 ? "−" : ""}${h} h ${String(m).padStart(2, "0")}`; };
const minutes = (h) => { const [a, b] = String(h || "0:0").split(":").map(Number); return a * 60 + (b || 0); };
const lundiDe = (d) => dateKey(addDays(d, -((d.getDay() + 6) % 7)));
const sansAcc = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const cleJour = (ms) => JOURS[(new Date(ms).getDay() + 6) % 7];

function cleanup() { unsubs.forEach(u => u()); unsubs = []; }

export function mountJournalTracabilite(container, contexte) {
  el = container; ctx = contexte || {};
  // Déjà à l'écoute (simple rafraîchissement de la Traçabilité) : on redessine seulement.
  if (unsubs.length) { rendre(); return; }
  if (!ui.lundi) ui.lundi = lundiDe(new Date());
  unsubs.push(onSnapshot(doc(db, "config", "planning-menage"), (s) => { planning = s.exists() ? s.data() : null; rendre(); }, () => {}));
  ecouter();
}
function ecouter() {
  unsubs.slice(1).forEach(u => u()); unsubs = unsubs.slice(0, 1);
  const debut = new Date(ui.lundi + "T00:00:00").getTime(), fin = debut + 7 * 864e5;
  evts = null; rendre();
  unsubs.push(onSnapshot(query(collection(db, "fiches-journal"), where("at", ">=", debut), where("at", "<", fin)), (s) => {
    evts = s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => a.at - b.at); rendre();
  }, (e) => { evts = []; el.innerHTML = `<div class="form-card"><p>⚠️ Journal inaccessible : publie la règle Firestore « fiches-journal ».</p><p class="hint">${esc(e.message)}</p></div>`; }));
}

// Planning prévu de la personne (onglet Planning du dispositif), par jour.
function prevuDe(nom) {
  const tous = { ...PLANNING_DEFAUT_MENAGE, ...(planning || {}) };
  const p = Object.values(tous).find(x => x?.agent && sansAcc(x.agent).split(" ")[0] === sansAcc(nom).split(" ")[0]);
  if (!p) return null;
  const out = {};
  JOURS.slice(0, 5).forEach(j => {
    const l = (p.lignes || []).filter(x => x.jours?.[j] && x.jours[j] !== "pause");
    if (!l.length) return;
    // Comme l'onglet Planning : le trajet n'est pas compté dans les heures prévues.
    out[j] = { min: l.filter(x => x.jours[j] !== "trajet").reduce((t, x) => t + Math.max(0, minutes(x.fin) - minutes(x.debut)), 0), debut: Math.min(...l.map(x => minutes(x.debut))), fin: Math.max(...l.map(x => minutes(x.fin))),
      sites: l.map(x => ({ de: minutes(x.debut), a: minutes(x.fin), site: x.jours[j] })) };
  });
  return out;
}

function analyser() {
  const sitesDisp = new Set((ctx.sites || []).map(s => s.id));
  const agentsDisp = new Set((ctx.fiches || []).map(f => f.agentUid));
  const liste = (evts || []).filter(e => (e.siteId && sitesDisp.has(e.siteId)) || (e.type === "connexion" && (agentsDisp.has(e.agentUid) || (ctx.dispositif && e.dispositif === ctx.dispositif && !["super_admin", "admin", "n1"].includes(e.role)))));
  const pers = new Map();
  liste.forEach(e => {
    const k = e.agentUid || e.auteurUid; if (!k) return;
    if (!pers.has(k)) pers.set(k, { uid: k, nom: e.agentNom || "?", prestataire: !!e.prestataire, evts: [] });
    const p = pers.get(k); if (e.agentNom) p.nom = e.agentNom; p.evts.push(e);
  });
  return [...pers.values()].map(p => {
    const prevu = prevuDe(p.nom);
    const aujourdhui = dateKey(new Date());
    const jours = JOURS.map(j => {
      const ev = p.evts.filter(e => cleJour(e.at) === j);
      const date = dateKey(addDays(new Date(ui.lundi + "T12:00:00"), JOURS.indexOf(j)));
      const avenir = date > aujourdhui, avantJournal = date < DEBUT_JOURNAL;
      const pr = prevu?.[j] || null;
      if (!ev.length) return { j, ev, prevu: pr, estime: 0, avenir, avantJournal, alertes: pr && !avenir && !avantJournal ? ["Aucune activité enregistrée ce jour"] : [], note: avenir ? "à venir" : avantJournal ? "journal pas encore actif" : "" };
      // Sessions : actions séparées de plus de 45 min = nouvelle session.
      const sessions = []; let cur = null;
      ev.forEach(e => { if (!cur || e.at - cur.fin > ECART_SESSION) { cur = { debut: e.at, fin: e.at, n: 0 }; sessions.push(cur); } cur.fin = e.at; cur.n++; });
      const estime = sessions.reduce((t, s) => t + (s.fin - s.debut + FIN_SESSION), 0) / 60000;
      const modifs = ev.filter(e => e.type === "modif");
      const coches = modifs.reduce((t, e) => t + (e.nbCoches || 0), 0);
      const autresJours = modifs.reduce((t, e) => t + (e.coches || []).filter(c => { const jj = String(c).split("-")[2]; return jj && JOURS.includes(jj) && jj !== j; }).length, 0);
      const alertes = [];
      // Cases cochées « d'un coup » : au moins 60 % des cases du jour en moins de 5 minutes.
      if (coches >= 15) { let max = 0; modifs.forEach((e, i) => { let n = 0; for (let k = i; k < modifs.length && modifs[k].at - e.at <= 5 * 60000; k++) n += modifs[k].nbCoches || 0; max = Math.max(max, n); }); if (max >= coches * 0.6) alertes.push(`${max} cases cochées en moins de 5 min (saisie groupée)`); }
      if (autresJours) alertes.push(`${autresJours} case${autresJours > 1 ? "s" : ""} cochée${autresJours > 1 ? "s" : ""} pour un autre jour (rattrapage ou anticipation)`);
      if (pr) {
        const m0 = (ms) => { const d = new Date(ms); return d.getHours() * 60 + d.getMinutes(); };
        const hors = ev.filter(e => m0(e.at) < pr.debut - 30 || m0(e.at) > pr.fin + 30);
        if (hors.length) alertes.push(`${hors.length} action${hors.length > 1 ? "s" : ""} hors des horaires prévus (${dureeTxt(pr.debut).replace(" h ", "h")}–${dureeTxt(pr.fin).replace(" h ", "h")})`);
        // Site coché ≠ site prévu à cette heure.
        const ailleurs = modifs.filter(e => e.nbCoches && e.siteId && (() => { const c = pr.sites.find(s => m0(e.at) >= s.de && m0(e.at) < s.a); return c && c.site !== "trajet" && c.site !== e.siteId; })());
        if (ailleurs.length) alertes.push(`${ailleurs.length} saisie${ailleurs.length > 1 ? "s" : ""} sur un autre site que celui prévu à cette heure`);
      }
      if (!modifs.length) alertes.push("Écran ouvert mais aucune case cochée");
      if (ev.some(e => e.auteurUid && e.agentUid && e.auteurUid !== e.agentUid)) alertes.push("Fiche modifiée par un responsable ce jour");
      return { j, ev, prevu: pr, avenir, sessions, estime, coches, premiere: ev[0].at, derniere: ev[ev.length - 1].at, alertes,
        sites: [...new Set(modifs.map(e => e.siteName).filter(Boolean))] };
    }).filter(x => x.ev.length || x.prevu);
    return { ...p, prevu, jours, totalEstime: jours.reduce((t, x) => t + x.estime, 0), totalPrevu: jours.filter(x => !x.avenir && !(x.avantJournal && !x.ev.length)).reduce((t, x) => t + (x.prevu?.min || 0), 0) };
  }).sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
}

function libelleEvt(e) {
  if (e.type === "connexion") return `🔓 Ouverture de l'écran de saisie${e.ecran === "prestataire" ? " (lien prestataire)" : ""}`;
  const t = [];
  if (e.nbCoches) { const parJ = {}; (e.coches || []).forEach(c => { const j = String(c).split("-")[2] || "?"; parJ[j] = (parJ[j] || 0) + 1; }); t.push(`✅ ${e.nbCoches} case${e.nbCoches > 1 ? "s" : ""} (${Object.entries(parJ).map(([j, n]) => `${j} ${n}`).join(", ")})`); }
  if (e.nbDecoches) t.push(`↩️ ${e.nbDecoches} décochée${e.nbDecoches > 1 ? "s" : ""}`);
  if (e.obs) t.push("📝 observation");
  if (e.envoi) t.push("📤 fiche envoyée");
  if (e.rouvert) t.push("🔁 fiche rouverte");
  if (e.validee) t.push("✔️ validée");
  return t.join(" · ") || "modification";
}

function rendre() {
  if (!el || !document.contains(el)) { cleanup(); return; }
  const debut = new Date(ui.lundi + "T00:00:00");
  const titre = `Semaine du ${debut.toLocaleDateString("fr-FR", { day: "numeric", month: "long" })} au ${addDays(debut, 6).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}`;
  const pers = evts ? analyser() : [];
  const choix = pers.find(p => p.uid === ui.agent) ? ui.agent : pers[0]?.uid || "";
  const p = pers.find(x => x.uid === choix);
  // Avant la mise en place du journal : seule la dernière modification de chaque fiche est connue.
  const anciennes = ui.lundi < lundiDe(new Date(DEBUT_JOURNAL + "T12:00:00")) ? (ctx.fiches || []).filter(f => f.weekStart === ui.lundi) : [];
  const ms = (v) => v?.toMillis ? v.toMillis() : v?.seconds ? v.seconds * 1000 : (typeof v === "number" ? v : 0);
  el.innerHTML = `<div class="form-card tj">
    <div class="tj-tete"><h3>🕒 Journal de remplissage & heures</h3>
      <div class="tj-sem"><button type="button" class="nav-btn" data-tj-sem="-7">◀</button><b>${titre}</b><button type="button" class="nav-btn" data-tj-sem="7">▶</button>${ui.lundi !== lundiDe(new Date()) ? `<button type="button" class="nav-btn" data-tj-sem="0">Cette semaine</button>` : ""}</div></div>
    <p class="hint">Chaque ouverture de l'écran de saisie et chaque enregistrement (cases cochées avec leur jour, observations, envoi) est noté avec l'heure et l'appareil. Le temps de présence est <b>estimé</b> : de la 1re à la dernière action de chaque période d'activité (une pause de plus de 45 min ouvre une nouvelle période), + 10 min. Journal tenu depuis le ${new Date(DEBUT_JOURNAL + "T12:00:00").toLocaleDateString("fr-FR")}.</p>
    ${evts === null ? `<p class="hint">Chargement…</p>` : !pers.length ? `<div class="tj-vide">Aucune activité enregistrée cette semaine.${anciennes.length ? `<br><br><b>Avant le journal, seule la dernière modification de chaque fiche est connue :</b><ul>${anciennes.map(f => `<li>${esc(f.agentNom)} · ${esc(f.siteName)} : dernière modification le ${ms(f.majLe) ? new Date(ms(f.majLe)).toLocaleString("fr-FR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "?"}${f.envoyeeLe ? ` · envoyée le ${new Date(f.envoyeeLe).toLocaleString("fr-FR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}` : ""}</li>`).join("")}</ul>` : ""}</div>` : `
    <div class="tj-pers">${pers.map(x => `<button type="button" class="${x.uid === choix ? "on" : ""}" data-tj-agent="${esc(x.uid)}"><b>${esc(x.nom)}</b><small>${dureeTxt(x.totalEstime)}${x.totalPrevu ? ` / ${dureeTxt(x.totalPrevu)} prévues` : ""}${x.jours.some(j => j.alertes.length) ? " · ⚠️" : ""}</small></button>`).join("")}</div>
    ${p ? `
    <div class="tj-kpi"><div><b>${dureeTxt(p.totalEstime)}</b><span>présence estimée</span></div>
      ${p.totalPrevu ? `<div><b>${dureeTxt(p.totalPrevu)}</b><span>prévues au planning${p.jours.some(x => x.avenir) ? " (jusqu'à aujourd'hui)" : ""}</span></div><div class="${p.totalEstime < p.totalPrevu * 0.8 ? "rouge" : p.totalEstime > p.totalPrevu * 1.1 ? "orange" : "vert"}"><b>${dureeTxt(p.totalEstime - p.totalPrevu)}</b><span>écart</span></div>` : `<div><b>—</b><span>pas de planning pour cette personne</span></div>`}
      <div><b>${p.jours.reduce((t, j) => t + (j.coches || 0), 0)}</b><span>cases cochées</span></div></div>
    <div class="tj-table-wrap"><table class="tj-t"><thead><tr><th>Jour</th><th>1re action</th><th>Dernière</th><th>Présence estimée</th><th>Prévu</th><th>Cases</th><th>Sites</th><th>À vérifier</th></tr></thead>
      <tbody>${p.jours.map(x => { const date = addDays(debut, JOURS.indexOf(x.j)); return `<tr class="${x.alertes.length ? "alerte" : ""}" data-tj-jour="${x.j}">
        <td><b>${NOMS_J[x.j]}</b> ${date.getDate()}/${date.getMonth() + 1}</td>
        <td>${x.premiere ? hm(x.premiere) : "—"}</td><td>${x.derniere ? hm(x.derniere) : "—"}</td>
        <td><b>${x.ev.length ? dureeTxt(x.estime) : "—"}</b>${x.sessions?.length > 1 ? `<small>${x.sessions.length} périodes : ${x.sessions.map(s => `${hm(s.debut)}–${hm(s.fin)}`).join(", ")}</small>` : ""}</td>
        <td>${x.prevu ? `${dureeTxt(x.prevu.min)}<small>${dureeTxt(x.prevu.debut).replace(" h ", "h")}–${dureeTxt(x.prevu.fin).replace(" h ", "h")}</small>` : "—"}</td>
        <td>${x.coches ?? 0}</td><td>${esc((x.sites || []).join(", "))}</td>
        <td>${x.alertes.map(a => `<div class="tj-al">⚠️ ${esc(a)}</div>`).join("") || (x.note ? `<small class="hint">${x.note}</small>` : `<span class="tj-ok">✓</span>`)}</td></tr>`; }).join("")}</tbody></table></div>
    <details class="tj-det" ${ui.detail === choix ? "open" : ""} data-tj-det><summary>📜 Détail de toutes les actions (${p.evts.length})</summary>
      <div class="tj-chrono">${p.evts.map(e => `<div><span class="tj-h">${new Date(e.at).toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit" })} ${hm(e.at)}</span><span>${esc(e.siteName || "")}</span><span>${libelleEvt(e)}${e.auteurUid && e.agentUid && e.auteurUid !== e.agentUid ? ` <em>(par un responsable)</em>` : ""}</span><small>${esc(e.appareil || "")}</small></div>`).join("")}</div></details>` : ""}`}
  </div>`;
  el.querySelectorAll("[data-tj-sem]").forEach(b => b.addEventListener("click", () => { const d = +b.dataset.tjSem; ui.lundi = d ? dateKey(addDays(new Date(ui.lundi + "T12:00:00"), d)) : lundiDe(new Date()); ecouter(); }));
  el.querySelectorAll("[data-tj-agent]").forEach(b => b.addEventListener("click", () => { ui.agent = b.dataset.tjAgent; rendre(); }));
  el.querySelector("[data-tj-det]")?.addEventListener("toggle", (e) => { ui.detail = e.target.open ? choix : ""; });
}

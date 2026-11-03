// ecran-atelier.js — « 📺 Écran atelier » : affichage pour la grande télé de
// l'atelier (compte de l'équipe). Tout se met à jour en direct :
//   • urgences en cours (les nouvelles clignotent, son en option) ;
//   • nouvelles demandes des 7 derniers jours ;
//   • pense-bête : événements à ne pas oublier (ajout / suppression ici) ;
//   • astreinte du jour (N1 / N2 + téléphone) ;
//   • horloge et date en grand.
// Bouton « Plein écran » : l'écran garde l'appli affichée sans veille.
import { db } from "./firebase-init.js";
import { collection, doc, addDoc, deleteDoc, updateDoc, setDoc, onSnapshot, serverTimestamp } from "./firestore-compte.js";
import { watchUrgencesOuvertes, watchNouvellesDemandes, watchPeople, watchAbsences, watchDemandes } from "./firestore-data.js";
import { watchCoordonnees } from "./coordonnees-data.js";
import { resolveDayN1, resolveDayN2, computeWeeklyTitulaires, esc } from "./astreinte-logic.js";

const COL = "atelier-memos";
let conteneur = null, user = null, unsubs = [], timer = null, wakeLock = null;
let urgences = [], nouvelles = [], memos = [], people = null, absences = [], coord = {}, mesDemandes = [], toutes = [];
// Colonne de droite « dynamique » : les panneaux défilent tout seuls.
const PANNEAUX = ["graphique", "fiers", "realisees"], DUREE_PANNEAU = 15000;
let panneau = 0, minuterieRotation = null;
const sansAccent = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const estClose = (d) => /^(realis|annul)/.test(sansAccent(d.statut));
const estRealisee = (d) => sansAccent(d.statut).startsWith("realis");
const dateFin = (d) => String(d.dateValidation || d.dateStatut || d.dateIntervention || "").slice(0, 10);
const valide = (d) => !d.lieeA && !d.supprimeeLe && !sansAccent(d.statut).startsWith("arbitrage");

// Flux mensuel, comme le graphique des Statistiques : reçues (bleu) / traitées (vert).
const dateOk = (v) => /^\d{4}-\d{2}-\d{2}/.test(String(v || "")) ? String(v).slice(0, 10) : "";
const dateTraitee = (d) => sansAccent(d.statut).startsWith("realis") ? (dateOk(d.dateIntervention) || dateOk(d.dateValidation) || dateOk(d.dateStatut) || dateOk(d.declareLe))
  : sansAccent(d.statut).startsWith("annul") ? (dateOk(d.dateStatut) || dateOk(d.dateValidation)) : "";
const MOIS_C = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
function flux(nb = 6) {
  const n = new Date(), l = toutes.filter(valide);
  return Array.from({ length: nb }, (_, i) => {
    const d = new Date(n.getFullYear(), n.getMonth() - (nb - 1 - i), 1), cle = iso(d).slice(0, 7);
    return { cle, court: MOIS_C[d.getMonth()], arr: l.filter(x => dateOk(x.dateDemande).startsWith(cle)).length, trait: l.filter(x => dateTraitee(x).startsWith(cle)).length };
  });
}
function graphiqueHTML() {
  const m = flux(6), c = m[m.length - 1];
  const W = 440, H = 400, pb = 34, pt = 34, pl = 4, pr = 4, max = Math.max(4, ...m.flatMap(x => [x.arr, x.trait]));
  const y = (v) => H - pb - (v / max) * (H - pb - pt), bw = (W - pl - pr) / m.length, larg = Math.min(30, bw * 0.36);
  const cols = m.map((x, i) => { const cx = pl + i * bw + bw / 2, x1 = cx - larg - 3, x2 = cx + 3, enCours = i === m.length - 1;
    return `${enCours ? `<rect x="${pl + i * bw + 4}" y="6" width="${bw - 8}" height="${H - 10}" rx="10" fill="#1a2440"/>` : ""}
      <rect x="${x1}" y="${y(x.arr)}" width="${larg}" height="${y(0) - y(x.arr)}" rx="5" fill="#3b7be0"/><rect x="${x2}" y="${y(x.trait)}" width="${larg}" height="${y(0) - y(x.trait)}" rx="5" fill="#1baf7a"/>
      ${x.arr ? `<text x="${x1 + larg / 2}" y="${y(x.arr) - 8}" text-anchor="middle" fill="#9cc0ff" font-size="19" font-weight="700">${x.arr}</text>` : ""}
      ${x.trait ? `<text x="${x2 + larg / 2}" y="${y(x.trait) - 8}" text-anchor="middle" fill="#7ff0bd" font-size="19" font-weight="700">${x.trait}</text>` : ""}
      <text x="${cx}" y="${H - 8}" text-anchor="middle" fill="${enCours ? "#eef2f8" : "#9aa7bd"}" font-size="19" font-weight="${enCours ? 800 : 400}">${x.court}</text>`; }).join("");
  const plus = c.trait - c.arr;
  return `<h2>📈 Demandes reçues et traitées</h2>
    <p class="ea-sous"><span class="ea-leg"><i style="background:#3b7be0"></i>Reçues</span><span class="ea-leg"><i style="background:#1baf7a"></i>Traitées</span></p>
    <svg viewBox="0 0 ${W} ${H}" class="ea-svg">${cols}</svg>
    ${plus > 0 ? `<div class="ea-bravo">💪 Ce mois-ci : <b>${c.trait}</b> traitées pour <b>${c.arr}</b> reçues — on avance plus vite qu'elles n'arrivent !</div>`
      : c.trait ? `<div class="ea-bravo">👍 Déjà <b>${c.trait}</b> demandes traitées ce mois-ci.</div>` : ""}`;
}
function fiersHTML() {
  const n = new Date(), l = toutes.filter(valide), cleM = iso(n).slice(0, 7), annee = String(n.getFullYear());
  const traitM = l.filter(x => dateTraitee(x).startsWith(cleM));
  const realM = traitM.filter(x => sansAccent(x.statut).startsWith("realis"));
  const urgM = realM.filter(x => ["Urgent", "Critique"].includes(x.urgenceCorrigee || x.urgence)).length;
  const traitAn = l.filter(x => dateTraitee(x).startsWith(annee)).length;
  // Meilleure semaine des 12 dernières (demandes réalisées).
  const l0 = new Date(n); l0.setDate(l0.getDate() - ((l0.getDay() + 6) % 7));
  let record = { n: 0, du: "" };
  for (let k = 0; k < 12; k++) { const d1 = new Date(l0); d1.setDate(d1.getDate() - 7 * k); const d2 = new Date(d1); d2.setDate(d2.getDate() + 6); const a = iso(d1), b = iso(d2);
    const nb = l.filter(x => sansAccent(x.statut).startsWith("realis")).filter(x => { const t = dateTraitee(x); return t >= a && t <= b; }).length; if (nb > record.n) record = { n: nb, du: a }; }
  const cartes = [
    [`${realM.length}`, "demandes réalisées ce mois-ci", "#1baf7a"],
    urgM ? [`${urgM}`, `urgence${urgM > 1 ? "s" : ""} réglée${urgM > 1 ? "s" : ""} ce mois-ci`, "#e04848"] : null,
    record.n ? [`${record.n}`, `record de la semaine (semaine du ${new Date(record.du + "T00:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "long" })})`, "#f0a020"] : null,
    [`${traitAn}`, `demandes traitées depuis janvier ${annee}`, "#3b7be0"],
  ].filter(Boolean);
  return `<h2>🏆 Nos points forts</h2><p class="ea-sous">Le travail de l'équipe en chiffres</p>
    <div class="ea-fiers">${cartes.map(([v, t, c]) => `<div class="ea-fier" style="border-left-color:${c}"><b style="color:${c}">${v}</b><span>${t}</span></div>`).join("")}</div>
    <div class="ea-bravo">👏 Merci à toute l'équipe !</div>`;
}
function realiseesHTML() {
  const l = toutes.filter(d => valide(d) && estRealisee(d) && dateFin(d) && joursEntre(dateFin(d), iso(new Date())) <= 7).sort((a, b) => dateFin(b).localeCompare(dateFin(a)));
  return `<h2>✅ Réalisées cette semaine <span class="ea-nb vert">${l.length}</span></h2><p class="ea-sous">7 derniers jours — bravo l'équipe</p>
    ${l.length ? l.slice(0, 7).map(d => `<div class="ea-n"><div class="ea-n-l1"><b>${esc(d.site || "")}</b>${d.local ? `<span class="ea-n-loc">· ${esc(d.local)}</span>` : ""}<span class="ea-n-date">${new Date(dateFin(d) + "T00:00:00").toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit" })}</span></div><span class="ea-n-t">${esc(String(d.descriptif || ""))}</span></div>`).join("") : `<div class="ea-vide petit">Aucune demande réalisée ces 7 derniers jours.</div>`}`;
}
let dejaVues = null, sonActif = false, edition = false;
const CHARGE_LE = Date.now();
try { sonActif = localStorage.getItem("ea-son") === "1"; } catch { /* */ }
const REF_TELECOMMANDE = () => doc(db, "config", "ecran-atelier");

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const joursEntre = (a, b) => Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 864e5);
const depuis = (ms) => { if (!ms) return ""; const h = Math.floor((Date.now() - ms) / 36e5); return h < 1 ? "à l'instant" : h < 24 ? `il y a ${h} h` : `il y a ${Math.floor(h / 24)} j`; };
const quand = (date) => {
  if (!date) return { txt: "À ne pas oublier", cls: "" };
  const j = joursEntre(iso(new Date()), date);
  const jour = new Date(date + "T00:00:00").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  if (j < 0) return { txt: `En retard · ${jour}`, cls: "retard" };
  if (j === 0) return { txt: "Aujourd'hui", cls: "auj" };
  if (j === 1) return { txt: "Demain", cls: "dem" };
  return { txt: `${jour} · dans ${j} j`, cls: j <= 7 ? "semaine" : "" };
};

function bip() {
  if (!sonActif) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.25, 0.5].forEach(t => { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = 880; o.connect(g); g.connect(ctx.destination); g.gain.setValueAtTime(0.25, ctx.currentTime + t); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.2); o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.22); });
  } catch { /* pas de son */ }
}

function astreinteHTML() {
  if (!people?.n1?.length) return "";
  const actifs = people.astreinteActive || {};
  const p = { ...people, n1: people.n1.filter(n => actifs[n] !== false), n2: (people.n2 || []).filter(n => actifs[n] !== false) };
  if (!p.n1.length || !p.n2.length) return "";
  try {
    const { titN1, titN2 } = computeWeeklyTitulaires(p, absences);
    const n1 = resolveDayN1(new Date(), p, absences, titN1)?.assigned, n2 = resolveDayN2(new Date(), p, absences, titN2)?.assigned;
    const ligne = (niv, nom) => nom ? `<div class="ea-ast-l"><span>${niv}</span><b>${esc(nom)}</b>${coord[nom]?.telephone ? `<em>📞 ${esc(coord[nom].telephone)}</em>` : ""}</div>` : "";
    return `<section class="ea-bloc ea-ast"><h2>📞 Astreinte aujourd'hui</h2>${ligne("N1", n1)}${ligne("N2", n2)}</section>`;
  } catch { return ""; }
}

// ---- Nouvelle présentation (proposée sur la version de TEST /beta) ----
// Données en plus : logements à préparer, compteurs à relever, météo (Open-Meteo, La Roche-sur-Yon).
let logementsV2 = [], compteursV2 = null, meteoV2 = null, meteoLe = 0, extrasV2 = false;
function chargerExtrasV2() {
  if (extrasV2) return; extrasV2 = true;
  import("./logements-data.js").then(m => unsubs.push(m.watchMesLogements("*", (l) => { logementsV2 = l || []; render(); }))).catch(() => {});
  const meteo = async () => {
    try {
      const r = await fetch("https://api.open-meteo.com/v1/forecast?latitude=46.67&longitude=-1.43&current=temperature_2m,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max&timezone=Europe%2FParis&forecast_days=3");
      if (r.ok) { meteoV2 = await r.json(); meteoLe = Date.now(); render(); }
    } catch { /* hors ligne */ }
  };
  meteo(); unsubs.push((() => { const t = setInterval(meteo, 30 * 60000); return () => clearInterval(t); })());
}
const METEO = (c) => c === 0 ? ["☀️", "Ensoleillé"] : c <= 2 ? ["🌤️", "Éclaircies"] : c === 3 ? ["☁️", "Couvert"] : c <= 48 ? ["🌫️", "Brouillard"] : c <= 57 ? ["🌦️", "Bruine"] : c <= 67 ? ["🌧️", "Pluie"] : c <= 77 ? ["🌨️", "Neige"] : c <= 82 ? ["🌧️", "Averses"] : c <= 86 ? ["🌨️", "Averses de neige"] : ["⛈️", "Orage"];
function meteoHTML() {
  const m = meteoV2; if (!m?.daily) return `<p class="eb-dim">Météo indisponible.</p>`;
  const cur = m.current || {}, [ic, lib] = METEO(cur.weather_code ?? m.daily.weather_code[0]);
  const vent = Math.round(m.daily.wind_speed_10m_max[0]), pluie = m.daily.precipitation_probability_max[0];
  const alerte = vent >= 60 ? `💨 Vent fort (${vent} km/h) : attention aux travaux en hauteur / extérieurs` : pluie >= 70 ? `☔ Pluie probable (${pluie} %) : prévoir les travaux en intérieur` : "";
  return `<div class="eb-met"><span class="eb-met-ic">${ic}</span><div><b>${Math.round(cur.temperature_2m ?? m.daily.temperature_2m_max[0])}°</b><span>${lib}</span><small>${Math.round(m.daily.temperature_2m_min[0])}° / ${Math.round(m.daily.temperature_2m_max[0])}° · 💨 ${vent} km/h · ☔ ${pluie} %</small></div></div>
    ${alerte ? `<div class="eb-met-al">${alerte}</div>` : ""}
    <div class="eb-met-j">${[1, 2].map(i => { const [ic2] = METEO(m.daily.weather_code[i]); const d = new Date(m.daily.time[i] + "T12:00"); return `<div><span>${d.toLocaleDateString("fr-FR", { weekday: "long" })}</span><b>${ic2} ${Math.round(m.daily.temperature_2m_min[i])}° / ${Math.round(m.daily.temperature_2m_max[i])}°</b><small>☔ ${m.daily.precipitation_probability_max[i]} %</small></div>`; }).join("")}</div>`;
}
const CANAL_TEST = location.pathname.startsWith("/beta/");
// Validée le 03/11 : nouvelle présentation pour tout le monde (↺ pour revenir à l'ancienne sur un appareil).
const presentationV2 = () => { try { return localStorage.getItem("ea-v2") !== "0"; } catch { return true; } };
const urgK = (u) => { const v = sansAccent(u); return v.startsWith("crit") ? "crit" : v.startsWith("urg") ? "urg" : ""; };
function renderV2(now, actifsMemos, urgTri, nouv, plein) {
  const auj = iso(now), lundi = new Date(now); lundi.setDate(lundi.getDate() - ((lundi.getDay() + 6) % 7)); const lun = iso(lundi);
  const l = toutes.filter(valide);
  const traiteesAuj = l.filter(x => dateTraitee(x) === auj && !x.lieeA);
  const parTech = {}; traiteesAuj.forEach(x => { const t = x.declarePar || "Équipe"; parTech[t] = (parTech[t] || 0) + 1; });
  const techs = Object.entries(parTech).sort((a, b) => b[1] - a[1]);
  const semT = l.filter(x => { const t = dateTraitee(x); return t >= lun && t <= auj; }).length;
  const semR = l.filter(x => { const t = dateOk(x.dateDemande); return t >= lun && t <= auj; }).length;
  // Astreinte
  let ast = null;
  try { if (people?.n1?.length) { const a = people.astreinteActive || {}, p = { ...people, n1: people.n1.filter(n => a[n] !== false), n2: (people.n2 || []).filter(n => a[n] !== false) };
    if (p.n1.length && p.n2.length) { const { titN1, titN2 } = computeWeeklyTitulaires(p, absences); ast = { n1: resolveDayN1(now, p, absences, titN1)?.assigned, n2: resolveDayN2(now, p, absences, titN2)?.assigned }; } } } catch { /* */ }
  const tel = (n) => coord[n]?.telephone ? `<em>${esc(coord[n].telephone)}</em>` : "";
  const memosAuj = actifsMemos.slice(0, 12);
  chargerExtrasV2();
  const absentsAuj = [...new Set((absences || []).filter(a => a.start && String(a.start).slice(0, 10) <= auj && String(a.end || a.start).slice(0, 10) >= auj).map(a => a.person).filter(Boolean))];
  const logAuj = logementsV2.filter(r => r.date === auj), logProch = logementsV2.filter(r => r.date > auj);
  const maxT = Math.max(1, ...techs.map(x => x[1]));
  conteneur.innerHTML = `${STYLE}${STYLE_V2}<div class="ea-scene ${window.__modeTele ? "tele" : ""}"><div class="eb">
    <header class="eb-tete">
      <div class="eb-id"><div class="eb-titre">ATELIER · SERVICE MAINTENANCE</div><div class="eb-date">${now.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}</div></div>
      <div class="eb-heure">${now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</div>
      <div class="eb-ast">${ast ? `<div class="eb-ast-t">📞 Astreinte</div><div class="eb-ast-l"><span>N1</span><b>${esc(ast.n1 || "—")}</b>${tel(ast.n1)}</div><div class="eb-ast-l n2"><span>N2</span><b>${esc(ast.n2 || "—")}</b>${tel(ast.n2)}</div>` : ""}</div>
      <div class="eb-cmd"><button data-ea="son" class="${sonActif ? "on" : ""}" title="Son des nouvelles urgences">${sonActif ? "🔔" : "🔕"}</button><button data-ea="edit" title="Pense-bête">✏️</button><button data-ea="plein" title="Plein écran">${plein ? "⤢" : "⛶"}</button><button data-ea="v1" title="Revenir à l'ancienne présentation">↺</button></div>
    </header>
    ${edition ? editionHTML() : ""}
    <div class="eb-corps">
      <section class="eb-urg ${urgTri.length ? "" : "calme"}">
        <div class="eb-h"><span>🚨 URGENCES</span><b class="eb-big ${urgTri.length ? "rouge" : "vert"}">${urgTri.length}</b></div>
        ${urgTri.length ? `<div class="ea-defil eb-defil"><div class="ea-piste"><div class="ea-lot">${urgTri.map(u => `<div class="eb-u ${urgK(u.urgence)} ${u.importeMs && Date.now() - u.importeMs < 4 * 36e5 ? "neuve" : ""}">
            <div class="eb-u-l1"><span class="eb-u-tag">${u.urgence === "Critique" ? "CRITIQUE" : "URGENT"}</span><b>${esc(u.site || "")}</b>${u.local ? `<span class="eb-u-loc">📍 ${esc(u.local)}</span>` : ""}<span class="eb-u-dep">${depuis(u.importeMs)}</span></div>
            <div class="eb-u-txt">${esc(String(u.descriptif || "").slice(0, 150))}</div>
            ${u.action ? `<div class="eb-u-act">📌 ${esc(u.action.texte)}</div>` : ""}</div>`).join("")}</div></div></div>`
          : `<div class="eb-ok"><span>✅</span>Aucune urgence en cours</div>`}
      </section>
      <div class="eb-mil">
        <section class="eb-bloc eb-absents">
          <div class="eb-h"><span>🏖️ ABSENTS AUJOURD'HUI</span>${absentsAuj.length ? `<b class="eb-big orange">${absentsAuj.length}</b>` : ""}</div>
          ${absentsAuj.length ? `<div class="eb-abs-l">${absentsAuj.map(a => `<b>${esc(a)}</b>`).join("")}</div>` : `<p class="eb-abs-ok">👷 Toute l'équipe est là</p>`}
        </section>
        <section class="eb-bloc eb-jour">
          <div class="eb-h"><span>📋 AUJOURD'HUI</span></div>
          <div class="ea-defil eb-defil"><div class="ea-piste"><div class="ea-lot">${logAuj.length || logProch.length ? `<div class="eb-ligne"><span class="eb-ic">🏠</span><div><b>Logements à préparer${logAuj.length ? ` : ${logAuj.length} aujourd'hui` : ""}</b><p>${(logAuj.length ? logAuj : logProch).slice(0, 4).map(r => `${esc(r.bat)} ${esc(String(r.numero))}${r.creneau ? ` (${r.creneau === "matin" ? "matin" : "après-midi"})` : ""}${logAuj.length ? "" : ` · ${new Date(r.date + "T12:00").toLocaleDateString("fr-FR", { weekday: "short", day: "numeric" })}`}${r.pour ? ` → ${esc(String(r.pour).split(" ")[0])}` : ""}`).join(" · ")}${(logAuj.length || logProch.length) > 4 ? " …" : ""}</p></div></div>` : ""}
          ${memosAuj.length ? `<div class="eb-sep">📌 À ne pas oublier</div>${memosAuj.map(m => { const q = quand(m.date); return `<div class="eb-m ${q.cls} ${m.important ? "imp" : ""}"><span>${m.important ? "⭐ " : ""}${esc(q.txt)}</span><b>${esc(m.texte || "")}</b></div>`; }).join("")}` : ""}</div></div></div>
        </section>
      </div>
      <div class="eb-droite">
        <section class="eb-bloc eb-meteo"><div class="eb-h"><span>🌤️ MÉTÉO</span></div>${meteoHTML()}</section>
        ${Math.floor(Date.now() / DUREE_PANNEAU) % 2 === 1 ? `<section class="eb-bloc eb-bilan eb-graphe">${graphiqueHTML()}<div class="ea-prog"><i style="animation-duration:${DUREE_PANNEAU}ms"></i></div></section>` : `<section class="eb-bloc eb-bilan">
          <div class="eb-h"><span>✅ TRAITÉES AUJOURD'HUI</span><b class="eb-big vert">${traiteesAuj.length}</b></div>
          ${techs.length ? `<div class="eb-techs">${techs.map(([t, n]) => `<div class="eb-tech"><span>${esc(/\set\s/i.test(t) ? t : t.replace(/^(\S+)\s+(\S).*$/, (m, a, b) => `${a[0].toUpperCase()}${a.slice(1)} ${b.toUpperCase()}.`))}</span><i><u style="width:${n / maxT * 100}%"></u></i><b>${n}</b></div>`).join("")}</div>` : ""}
          <div class="eb-sem">Semaine : <b>${semT}</b> traitées · <b>${semR}</b> reçues · <b>${nouv.length}</b> nouvelle${nouv.length > 1 ? "s" : ""} en 7 j</div>
          <div class="ea-prog"><i style="animation-duration:${DUREE_PANNEAU}ms"></i></div>
        </section>`}
      </div>
    </div>
    
  </div></div>`;
  ajuster();
  defilerUrgences();
}

function render() {
  if (!conteneur) return;
  const now = new Date();
  const actifsMemos = memos.filter(m => !m.date || joursEntre(iso(now), m.date) >= -1)
    .sort((a, b) => (a.date ? 0 : 1) - (b.date ? 0 : 1) || String(a.date || "").localeCompare(String(b.date || "")) || (b.important ? 1 : 0) - (a.important ? 1 : 0));
  const urgTri = [...urgences].sort((a, b) => (a.urgence === "Critique" ? 0 : 1) - (b.urgence === "Critique" ? 0 : 1) || (b.importeMs || 0) - (a.importeMs || 0));
  const nouv = nouvelles.filter(n => !urgences.some(u => u.id === n.id)).sort((a, b) => (b.importeMs || 0) - (a.importeMs || 0)).slice(0, 7);
  const plein = !!document.fullscreenElement || !!window.__modeTele;
  if (presentationV2()) return renderV2(now, actifsMemos, urgTri, nouv, plein);
  conteneur.innerHTML = `${STYLE}<div class="ea-scene ${window.__modeTele ? "tele" : ""}"><div class="ea ${plein ? "plein" : ""}">
    <header class="ea-tete">
      <div><div class="ea-titre">🛠️ Atelier — Service Maintenance</div><div class="ea-date">${now.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</div></div>
      <div class="ea-heure">${now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</div>
      <div class="ea-cmd">
        <button data-ea="son" class="${sonActif ? "on" : ""}">${sonActif ? "🔔 Son activé" : "🔕 Activer le son"}</button>
        <button data-ea="edit">${edition ? "✓ Fermer" : "✏️ Pense-bête"}</button>
        <button data-ea="plein">${plein ? "⤢ Quitter le plein écran" : "⛶ Plein écran"}</button>
        <button data-ea="v2">✨ Nouvelle présentation</button>
      </div>
    </header>
    ${edition ? editionHTML() : ""}
    <div class="ea-grille">
      <section class="ea-bloc ea-urg">
        <h2>🚨 Urgences en cours <span class="ea-nb ${urgTri.length ? "rouge" : "vert"}">${urgTri.length}</span></h2>
        ${urgTri.length ? `<div class="ea-defil"><div class="ea-piste"><div class="ea-lot">${urgTri.map(u => `<div class="ea-u ${u.urgence === "Critique" ? "critique" : ""} ${u.importeMs && Date.now() - u.importeMs < 4 * 36e5 ? "neuve" : ""}">
          <div class="ea-u-l1"><span class="ea-num">${esc(u.numero || "")}</span><b>${esc(u.site || "")}</b>${u.local ? `<span class="ea-loc">📍 ${esc(u.local)}</span>` : ""}<span class="ea-tag">${esc(u.urgence)}</span>${u.importeMs && Date.now() - u.importeMs < 4 * 36e5 ? `<span class="ea-new">NOUVELLE</span>` : ""}</div>
          <div class="ea-u-txt">${esc(String(u.descriptif || "").slice(0, 160))}</div>
          <div class="ea-u-pied">${depuis(u.importeMs)}${u.action ? ` · 📌 ${esc(u.action.texte)}` : ""}</div>
        </div>`).join("")}</div></div></div>` : `<div class="ea-vide">✅ Aucune urgence en cours</div>`}
      </section>
      <div class="ea-col">
        <section class="ea-bloc ea-memo">
          <h2>📌 Pense-bête</h2>
          ${actifsMemos.length ? actifsMemos.slice(0, 6).map(m => { const q = quand(m.date); return `<div class="ea-m ${q.cls} ${m.important ? "important" : ""}"><span class="ea-m-q">${m.important ? "⭐ " : ""}${esc(q.txt)}</span><span class="ea-m-t">${esc(m.texte)}</span></div>`; }).join("") : `<div class="ea-vide petit">Rien de prévu. Ajoute un rappel avec ✏️ Pense-bête.</div>`}
        </section>
        ${astreinteHTML()}
      </div>
      <div class="ea-col">
        <section class="ea-bloc ea-nouv ea-dyn" data-p="${PANNEAUX[panneau]}">
          ${PANNEAUX[panneau] === "graphique" ? graphiqueHTML() : PANNEAUX[panneau] === "fiers" ? fiersHTML() : PANNEAUX[panneau] === "realisees" ? realiseesHTML() : `<h2>🆕 Nouvelles demandes</h2><p class="ea-sous">7 derniers jours</p>
          ${nouv.length ? nouv.map(n => `<div class="ea-n"><div class="ea-n-l1">${/^SG-/.test(n.numero || "") ? `<span class="ea-num">${esc(n.numero)}</span>` : ""}<b>${esc(n.site || "")}</b>${n.local ? `<span class="ea-n-loc">· ${esc(n.local)}</span>` : ""}</div><span class="ea-n-t">${esc(String(n.descriptif || ""))}</span></div>`).join("") : `<div class="ea-vide petit">Aucune nouvelle demande.</div>`}`}
          <div class="ea-points">${PANNEAUX.map((_, i) => `<i class="${i === panneau ? "on" : ""}"></i>`).join("")}</div>
          <div class="ea-prog"><i style="animation-duration:${DUREE_PANNEAU}ms"></i></div>
        </section>
      </div>
    </div>
    ${mesDemandes.length ? `<footer class="ea-pied">👷 Demandes attribuées à ${esc(user?.nom || "l'équipe")} : <b>${mesDemandes.length}</b> à traiter${mesDemandes.filter(d => ["Urgent", "Critique"].includes(d.urgenceCorrigee || d.urgence)).length ? ` · dont <b class="rouge">${mesDemandes.filter(d => ["Urgent", "Critique"].includes(d.urgenceCorrigee || d.urgence)).length} urgente(s)</b>` : ""}</footer>` : ""}
  </div></div>`;
  ajuster();
  defilerUrgences();
}

// Urgences : si elles ne tiennent pas toutes dans le bloc, la liste défile
// en boucle (vers le haut, sans à-coup). L'horloge de départ est commune :
// le rafraîchissement de l'écran (toutes les 30 s) ne fait pas repartir le
// défilement du début.
const T0_DEFIL = Date.now(), VITESSE_DEFIL = 38; // px / seconde
function defilerUrgences() {
  // Toutes les zones qui débordent défilent (urgences, colonne « Aujourd'hui »…).
  conteneur?.querySelectorAll(".ea-defil").forEach(defilerZone);
}
function defilerZone(zone) {
  const piste = zone?.firstElementChild, lot = piste?.firstElementChild;
  if (!lot) return;
  const hLot = lot.offsetHeight, hZone = zone.clientHeight;
  if (hLot <= hZone + 2) { piste.style.animation = "none"; return; }
  piste.appendChild(lot.cloneNode(true));
  const duree = hLot / VITESSE_DEFIL;
  piste.style.setProperty("--ea-dh", `-${hLot}px`);
  piste.style.animation = `ea-defil ${duree}s linear infinite`;
  piste.style.animationDelay = `-${((Date.now() - T0_DEFIL) / 1000) % duree}s`;
}

// Écran « télé » : une scène fixe 1920 × 1080 (16:9, paysage) mise à
// l'échelle de l'écran — même rendu sur la télé, un PC ou un portable.
function ajuster() {
  const scene = conteneur?.querySelector(".ea-scene"), ea = scene?.firstElementChild; if (!ea) return;
  const plein = !!document.fullscreenElement || !!window.__modeTele;
  const w = plein ? window.innerWidth : conteneur.clientWidth || window.innerWidth;
  // Hors plein écran : tout doit tenir dans la fenêtre, sans défiler.
  const h = plein ? window.innerHeight : Math.max(300, window.innerHeight - Math.max(0, conteneur.getBoundingClientRect().top + window.scrollY) - 12);
  // Télé : les bords de l'image sont rognés par le téléviseur (« overscan ») → marge de sécurité de 5 %.
  let marge = 0.95; try { const m = parseFloat(localStorage.getItem("ea-marge")); if (m >= 0.8 && m <= 1) marge = m; } catch { /* */ }
  const k = Math.min(w / 1920, h / 1080) * (plein ? marge : 1);
  ea.style.transform = `scale(${k})`;
  scene.style.height = `${1080 * k}px`;
  scene.style.width = `${1920 * k}px`;
}

function editionHTML() {
  return `<section class="ea-bloc ea-edit">
    <h2>✏️ Pense-bête — ajouter un rappel</h2>
    <form class="ea-form">
      <input name="texte" required maxlength="140" placeholder="Ex. Passage du contrôleur SSI au lycée, livraison de gaz…">
      <input name="date" type="date">
      <label><input type="checkbox" name="important"> ⭐ Important</label>
      <button>➕ Ajouter</button>
    </form>
    <div class="ea-edit-liste">${[...memos].sort((a, b) => String(a.date || "9").localeCompare(String(b.date || "9"))).map(m => `<div><span>${m.date ? new Date(m.date + "T00:00:00").toLocaleDateString("fr-FR") : "sans date"}${m.important ? " ⭐" : ""}</span><b>${esc(m.texte)}</b><small>${esc(m.par || "")}</small><button data-suppr="${esc(m.id)}">🗑️</button></div>`).join("") || `<p class="ea-vide petit">Aucun rappel.</p>`}</div>
    <p class="ea-aide">Les rappels datés disparaissent tout seuls le lendemain de leur date. Les rappels sans date restent jusqu'à ce que tu les supprimes.</p>
  </section>`;
}

async function surClic(e) {
  const b = e.target.closest("[data-ea]");
  if (b) {
    const a = b.dataset.ea;
    if (a === "son") { sonActif = !sonActif; try { localStorage.setItem("ea-son", sonActif ? "1" : "0"); } catch { /* */ } if (sonActif) bip(); render(); }
    else if (a === "edit") { edition = !edition; render(); }
    else if (a === "v1" || a === "v2") { try { localStorage.setItem("ea-v2", a === "v2" ? "1" : "0"); } catch { /* */ } render(); }
    else if (a === "plein") {
      try { if (document.fullscreenElement) await document.exitFullscreen(); else await conteneur.requestFullscreen(); } catch { /* refusé */ }
      try { if (!wakeLock && navigator.wakeLock) wakeLock = await navigator.wakeLock.request("screen"); } catch { /* pas de verrou */ }
      render();
    }
    return;
  }
  const s = e.target.closest("[data-suppr]");
  if (s && confirm("Supprimer ce rappel ?")) { try { await deleteDoc(doc(db, COL, s.dataset.suppr)); } catch (err) { alert("Suppression impossible : " + (err?.message || err)); } }
}
async function surEnvoi(e) {
  if (!e.target.matches(".ea-form")) return;
  e.preventDefault();
  const f = new FormData(e.target), texte = String(f.get("texte") || "").trim(); if (!texte) return;
  try { await addDoc(collection(db, COL), { texte, date: f.get("date") || "", important: !!f.get("important"), par: user?.nom || user?.email || "", creeLe: serverTimestamp() }); e.target.reset(); }
  catch (err) { alert("Ajout impossible : " + (err?.message || err) + "\n(Les règles Firestore « atelier-memos » sont-elles publiées ?)"); }
}

function nettoyer() {
  unsubs.forEach(u => { try { u(); } catch { /* */ } }); unsubs = [];
  extrasV2 = false;
  clearInterval(timer); timer = null; clearInterval(minuterieRotation); minuterieRotation = null;
  try { wakeLock?.release(); } catch { /* */ } wakeLock = null;
}

export function mountEcranAtelier(container, u) {
  nettoyer();
  conteneur = container; user = u; dejaVues = null;
  if (!container.dataset.eaEcoute) {
    container.addEventListener("click", surClic);
    container.addEventListener("submit", surEnvoi);
    container.dataset.eaEcoute = "1";
  }
  if (!window.__eaGlobal) {
    window.__eaGlobal = true; // écoutes de la fenêtre : une seule fois (avant : ajoutées à chaque ouverture)
    // Mode télé (lancement automatique) : l'écran ne se met jamais en veille, et l'appli se recharge seule chaque nuit à 4 h.
    if (window.__modeTele) {
      (async () => { try { if (navigator.wakeLock) wakeLock = await navigator.wakeLock.request("screen"); } catch { /* */ } })();
      const lance = Date.now();
      setInterval(() => { if (new Date().getHours() === 4 && Date.now() - lance > 3600000) location.reload(); }, 600000);
    }
    document.addEventListener("fullscreenchange", () => conteneur && document.contains(conteneur) && render());
    window.addEventListener("resize", () => conteneur && document.contains(conteneur) && ajuster());
    // Réglage de la marge télé au clavier : « + » agrandit, « - » réduit (mémorisé sur cet appareil).
    document.addEventListener("keydown", (e) => {
      if (!conteneur || !document.contains(conteneur) || !(window.__modeTele || document.fullscreenElement) || e.target.closest?.("input,textarea")) return;
      if (!["+", "-", "="].includes(e.key)) return;
      let m = 0.95; try { m = parseFloat(localStorage.getItem("ea-marge")) || 0.95; } catch { /* */ }
      m = Math.min(1, Math.max(0.8, Math.round((m + (e.key === "-" ? -0.01 : 0.01)) * 100) / 100));
      try { localStorage.setItem("ea-marge", String(m)); } catch { /* */ }
      ajuster(); window.toast?.(`Taille de l'écran : ${Math.round(m * 100)} %`);
    });
    document.addEventListener("visibilitychange", async () => { if (document.visibilityState === "visible" && (document.fullscreenElement || window.__modeTele) && navigator.wakeLock) { try { wakeLock = await navigator.wakeLock.request("screen"); } catch { /* */ } } });
  }
  unsubs.push(watchUrgencesOuvertes((l) => {
    const ids = new Set(l.map(x => x.id));
    if (dejaVues && l.some(x => !dejaVues.has(x.id))) bip();
    dejaVues = ids; urgences = l; render();
  }));
  unsubs.push(watchNouvellesDemandes((l) => { nouvelles = l; render(); }));
  unsubs.push(watchDemandes((l) => {
    toutes = l || [];
    mesDemandes = (l || []).filter(d => d.attribueA === u?.uid && !d.lieeA && !d.supprimeeLe && !/^(realis|annul|arbitrage)/.test(String(d.statut || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()));
    render();
  }));
  unsubs.push(onSnapshot(collection(db, COL), (s) => { memos = s.docs.map(d => ({ id: d.id, ...d.data() })); render(); }, (e) => { console.warn("Pense-bête :", e); memos = []; render(); }));
  // Télécommande (onglet Pense-bête des superviseurs) : son, rechargement.
  unsubs.push(onSnapshot(REF_TELECOMMANDE(), (snap) => {
    const t = snap.exists() ? snap.data() : {};
    if (typeof t.son === "boolean" && t.son !== sonActif) { sonActif = t.son; try { localStorage.setItem("ea-son", sonActif ? "1" : "0"); } catch { /* */ } render(); }
    // Rechargement à distance : une seule fois par demande (avant : comparaison avec l'horloge du PC — si elle
    // retardait, la télé se rechargeait en boucle).
    if (t.rechargerLe) {
      let fait = 0; try { fait = +localStorage.getItem("ea-recharge-fait") || 0; } catch { /* */ }
      if (t.rechargerLe !== fait) { try { localStorage.setItem("ea-recharge-fait", String(t.rechargerLe)); } catch { /* */ } if (fait && Date.now() - CHARGE_LE > 5000) location.reload(); }
    }
  }, () => { /* */ }));
  unsubs.push(watchPeople((p) => { people = p; render(); }));
  unsubs.push(watchAbsences((a) => { absences = a || []; render(); }));
  unsubs.push(watchCoordonnees((c) => { coord = c || {}; render(); }));
  // Horloge : on redessine chaque minute (sauf pendant une saisie).
  clearInterval(minuterieRotation);
  minuterieRotation = setInterval(() => { const a = document.activeElement; if (a && conteneur?.contains(a) && a.matches("input")) return; panneau = (panneau + 1) % PANNEAUX.length; render(); }, DUREE_PANNEAU);
  timer = setInterval(() => { const a = document.activeElement; if (!(a && conteneur?.contains(a) && a.matches("input"))) render(); }, 30000);
  render();
}

const STYLE_V2 = `<style>
  .eb{position:absolute;top:0;left:0;width:1920px;height:1080px;box-sizing:border-box;transform-origin:0 0;background:radial-gradient(1200px 600px at 20% -10%,#16233d 0,#0a101c 60%);color:#f1f5f9;padding:26px 34px 22px;font-size:24px;display:flex;flex-direction:column;font-family:Montserrat,system-ui,sans-serif}
  .eb-tete{display:grid;grid-template-columns:1fr auto 1fr auto;align-items:center;gap:24px;margin-bottom:22px}
  .eb-titre{font-size:22px;font-weight:800;letter-spacing:.18em;color:#94a3b8}.eb-date{font-size:40px;font-weight:800}.eb-date::first-letter{text-transform:uppercase}
  .eb-heure{font-size:120px;font-weight:800;line-height:1;font-variant-numeric:tabular-nums;letter-spacing:2px}
  .eb-ast{justify-self:end;background:#111a2e;border:1px solid #23324f;border-radius:18px;padding:12px 20px;min-width:420px}
  .eb-ast-t{font-size:18px;font-weight:800;color:#94a3b8;letter-spacing:.12em;text-transform:uppercase;margin-bottom:4px}
  .eb-ast-l{display:flex;align-items:baseline;gap:14px;font-size:30px}.eb-ast-l span{font-size:18px;font-weight:800;background:#2563eb;border-radius:8px;padding:2px 10px}.eb-ast-l.n2 span{background:#475569}
  .eb-ast-l b{font-weight:800}.eb-ast-l em{font-style:normal;color:#93c5fd;font-size:26px;margin-left:auto}
  .eb-cmd{display:flex;flex-direction:column;gap:6px;opacity:.35}.eb-cmd:hover{opacity:1}
  .eb-cmd button{width:46px;height:40px;border-radius:10px;border:1px solid #23324f;background:#111a2e;color:#fff;font-size:20px;cursor:pointer}.eb-cmd button.on{border-color:#22c55e}
  .eb-corps{flex:1;min-height:0;display:grid;grid-template-columns:1.4fr 1fr .95fr;gap:24px}
  .eb-urg,.eb-bloc{background:#111a2e;border:1px solid #23324f;border-radius:22px;padding:20px 22px;min-height:0;overflow:hidden;display:flex;flex-direction:column}
  .eb-urg{border-color:#7f1d1d;background:linear-gradient(180deg,#2a1218,#111a2e 40%)}.eb-urg.calme{border-color:#14532d;background:linear-gradient(180deg,#0f2a1d,#111a2e 40%)}
  .eb-h{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}.eb-h span{font-size:22px;font-weight:800;letter-spacing:.12em;color:#cbd5e1}
  .eb-big{font-size:64px;line-height:1;font-weight:800}.eb-big.rouge{color:#f87171}.eb-big.vert{color:#4ade80}.eb-big.bleu{color:#60a5fa}
  .eb-defil{flex:1;min-height:0}
  .eb-u{border-radius:16px;padding:14px 18px;margin-bottom:12px;background:#3b1d12;border-left:10px solid #f97316}
  .eb-u.crit{background:#3f1218;border-left-color:#ef4444}.eb-u.neuve{animation:ea-flash 1.6s ease-in-out infinite}
  .eb-u-l1{display:flex;align-items:center;gap:14px;flex-wrap:wrap;font-size:30px}.eb-u-tag{font-size:16px;font-weight:800;letter-spacing:.1em;background:#f97316;color:#1a0b05;border-radius:8px;padding:3px 10px}
  .eb-u.crit .eb-u-tag{background:#ef4444;color:#fff}.eb-u-loc{color:#fde68a;font-size:26px}.eb-u-dep{margin-left:auto;font-size:20px;color:#fca5a5}
  .eb-u-txt{margin-top:8px;font-size:27px;line-height:1.3}.eb-u-act{margin-top:6px;font-size:20px;color:#fde68a}
  .eb-ok{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;font-size:40px;font-weight:800;color:#86efac}.eb-ok span{font-size:120px}
  .eb-mil{display:flex;flex-direction:column;gap:24px;min-height:0}.eb-mil .eb-memo{flex:1}
  .eb-techs{display:grid;gap:10px}.eb-tech{display:grid;grid-template-columns:240px 1fr 50px;align-items:center;gap:14px;font-size:26px}
  .eb-tech span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:700}.eb-tech i{height:18px;background:#1e293b;border-radius:99px;overflow:hidden}.eb-tech u{display:block;height:100%;background:#22c55e;border-radius:99px}
  .eb-tech b{text-align:right;font-size:32px}
  .eb-sem{margin-top:14px;font-size:21px;color:#94a3b8}.eb-sem b{color:#fff}.eb-sem span{display:block;color:#86efac;margin-top:4px}
  .eb-m{display:flex;flex-direction:column;padding:10px 14px;border-radius:12px;background:#0d1526;margin-bottom:10px;border-left:6px solid #475569}
  .eb-m span{font-size:18px;color:#94a3b8;font-weight:700}.eb-m span::first-letter{text-transform:uppercase}.eb-m b{font-size:25px;font-weight:600}
  .eb-m.auj{border-left-color:#f97316}.eb-m.auj span{color:#fdba74}.eb-m.dem{border-left-color:#eab308}.eb-m.retard{border-left-color:#ef4444}.eb-m.imp b{color:#fde68a}
  .eb-n{padding:10px 0;border-bottom:1px solid #1e2a44;font-size:24px}.eb-n span{color:#94a3b8}.eb-n p{margin:3px 0 0;font-size:21px;color:#cbd5e1;line-height:1.3}.eb-n small{color:#64748b;font-size:17px}
  .eb-dim{color:#64748b;font-size:22px}
  .eb-mil,.eb-droite{display:flex;flex-direction:column;gap:24px;min-height:0}.eb-jour{flex:1}.eb-jour .eb-defil{flex:1;min-height:0}.eb-bilan{flex:1}
  .eb-ligne{display:flex;gap:14px;align-items:flex-start;padding:12px 14px;border-radius:14px;background:#0d1526;margin-bottom:10px}
  .eb-ligne.chaud{background:#2a1d0b;border:1px solid #92400e}.eb-ic{font-size:34px;line-height:1}.eb-ligne b{font-size:26px}.eb-ligne p{margin:4px 0 0;font-size:21px;color:#cbd5e1;line-height:1.3}
  .eb-sep{margin:14px 0 8px;font-size:19px;font-weight:800;letter-spacing:.08em;color:#94a3b8;text-transform:uppercase}
  .eb-met{display:flex;align-items:center;gap:18px}.eb-met .eb-met-ic{font-size:120px;line-height:1;font-weight:400}.eb-met b{display:block;font-size:96px;line-height:1}.eb-met span{font-size:34px;font-weight:800}.eb-met small{display:block;font-size:24px;color:#cbd5e1;margin-top:6px}
  .eb-met-al{margin-top:10px;padding:10px 14px;border-radius:12px;background:#3b2a0b;color:#fde68a;font-size:24px;font-weight:700}
  .eb-met-j{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px}.eb-met-j div{background:#0d1526;border-radius:12px;padding:10px 12px}.eb-met-j span{display:block;font-size:22px;color:#cbd5e1}.eb-met-j span::first-letter{text-transform:uppercase}.eb-met-j b{font-size:32px}.eb-met-j small{display:block;color:#cbd5e1;font-size:21px}
  .eb-absents{flex:none;border:2px solid #f59e0b}.eb-absents .eb-h{margin-bottom:10px}.eb-big.orange{color:#fbbf24}
  .eb-abs-l{display:flex;flex-wrap:wrap;gap:10px}.eb-abs-l b{font-size:38px;font-weight:800;background:#0d1526;border:1px solid #334155;border-radius:12px;padding:4px 16px}
  .eb-abs-ok{margin:0;font-size:28px;font-weight:700;color:#86efac}
  .eb-jour .eb-defil{flex:1;min-height:0}
  .eb-bilan{position:relative}.eb-graphe h2{margin:0 0 6px;font-size:22px;letter-spacing:.06em}.eb-graphe .ea-svg{width:100%;flex:1;min-height:0}.eb-graphe .ea-bravo{display:none}.eb-graphe .ea-sous{margin:0 0 4px}
  .eb-bilan .ea-prog{position:absolute;left:0;right:0;bottom:0}
  .eb-bilan .eb-tech{grid-template-columns:170px 1fr 44px;font-size:23px}
  .eb-pied{margin-top:16px;font-size:22px;color:#cbd5e1}
</style>`;
const STYLE = `<style>
  .ea-scene{position:relative;overflow:hidden;margin:0 auto;border-radius:14px;background:#0b1220}
  .ea-scene.tele{position:fixed;inset:0;margin:auto;z-index:99999;border-radius:0;box-shadow:0 0 0 100vmax #0b1220}
  :fullscreen{background:#0b1220;display:flex;align-items:center;justify-content:center}
  :fullscreen .ea-scene{border-radius:0}
  .ea{--ea-bg:#0b1220;--ea-carte:#141d30;--ea-bord:#24304a;--ea-txt:#eef2f8;--ea-dim:#9aa7bd;position:absolute;top:0;left:0;width:1920px;height:1080px;box-sizing:border-box;transform-origin:0 0;background:var(--ea-bg);color:var(--ea-txt);padding:28px 34px;font-size:22px;display:flex;flex-direction:column;overflow:hidden}
  .ea-tete{display:flex;align-items:center;gap:20px;margin-bottom:18px}
  .ea-titre{font-size:1.6em;font-weight:800}.ea-date{color:var(--ea-dim);font-size:1.05em}.ea-date::first-letter,.ea-m-q::first-letter{text-transform:uppercase}
  .ea-heure{margin-left:auto;font-size:3.2em;font-weight:800;letter-spacing:1px;font-variant-numeric:tabular-nums}
  .ea-cmd{display:flex;flex-direction:column;gap:6px}
  .ea-cmd button{background:var(--ea-carte);color:var(--ea-txt);border:1px solid var(--ea-bord);border-radius:10px;padding:6px 14px;font:inherit;font-size:16px;cursor:pointer}
  .ea-cmd button.on{border-color:#1baf7a;color:#5fe0a8}
  .ea-grille{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1.45fr) minmax(0,1fr) minmax(0,.85fr);gap:22px;align-items:stretch}
  .ea-grille{grid-template-rows:minmax(0,1fr)}
  .ea-col{min-height:0}
  .ea-grille>.ea-bloc,.ea-col>.ea-bloc{overflow:hidden;min-height:0}
  .ea-sous{margin:-8px 0 10px;color:var(--ea-dim);font-size:.75em}
  .ea-col>.ea-memo{flex:1 1 auto}.ea-col>.ea-ast{flex:none}.ea-col>.ea-nouv{flex:1 1 auto}
  .ea-col{display:flex;flex-direction:column;gap:18px}
  .ea-bloc{background:var(--ea-carte);border:1px solid var(--ea-bord);border-radius:16px;padding:16px 18px}
  .ea-bloc h2{margin:0 0 12px;font-size:1.25em;display:flex;align-items:center;gap:10px}.ea-bloc h2 small{font-size:.6em;color:var(--ea-dim);font-weight:400}
  .ea-nb{font-size:.85em;border-radius:99px;padding:2px 12px}.ea-nb.rouge{background:#e04848}.ea-nb.vert{background:#1baf7a}
  .ea-u{border-left:6px solid #f0a020;background:#1a2440;border-radius:12px;padding:12px 14px;margin-bottom:10px}
  .ea-u.critique{border-left-color:#e04848;background:#2a1720}
  .ea-u.neuve{animation:ea-flash 1.6s ease-in-out infinite}
  @keyframes ea-flash{0%,100%{box-shadow:0 0 0 0 rgba(224,72,72,0)}50%{box-shadow:0 0 0 4px rgba(224,72,72,.55)}}
  .ea-u-l1{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:1.1em}
  .ea-num{font-family:ui-monospace,monospace;font-size:.8em;background:#0b1220;border:1px solid var(--ea-bord);border-radius:6px;padding:1px 7px;color:var(--ea-dim)}
  .ea-loc{color:#ffd27a}.ea-tag{margin-left:auto;font-size:.75em;font-weight:800;text-transform:uppercase;color:#ffb3b3}
  .ea-new{font-size:.7em;font-weight:800;background:#e04848;color:#fff;border-radius:6px;padding:2px 8px}
  .ea-u-txt{margin-top:6px;font-size:1.05em;line-height:1.35}
  .ea-u-pied{margin-top:4px;color:var(--ea-dim);font-size:.8em}
  .ea-plus{color:var(--ea-dim);text-align:center}
  .ea-urg{display:flex;flex-direction:column}
  .ea-defil{flex:1;min-height:0;overflow:hidden;position:relative;-webkit-mask-image:linear-gradient(transparent,#000 14px,#000 calc(100% - 30px),transparent);mask-image:linear-gradient(transparent,#000 14px,#000 calc(100% - 30px),transparent)}
  .ea-piste{will-change:transform;padding-top:4px}
  .ea-lot{display:flow-root}
  @keyframes ea-defil{from{transform:translateY(0)}to{transform:translateY(var(--ea-dh))}}
  .ea-vide{color:#5fe0a8;font-size:1.3em;text-align:center;padding:30px 0}.ea-vide.petit{font-size:.95em;color:var(--ea-dim);padding:10px 0;text-align:left}
  .ea-m{display:flex;flex-direction:column;gap:2px;padding:10px 12px;border-radius:10px;background:#1a2440;margin-bottom:8px;border-left:5px solid var(--ea-bord)}
  .ea-m.auj{border-left-color:#e04848;background:#2a1720}.ea-m.dem{border-left-color:#f0a020}.ea-m.semaine{border-left-color:#3b7be0}.ea-m.retard{border-left-color:#e04848;opacity:.85}
  .ea-m.important .ea-m-t{font-weight:800}
  .ea-m-q{font-size:.78em;color:var(--ea-dim)}.ea-m.auj .ea-m-q{color:#ff9b9b;font-weight:800}
  .ea-m-t{font-size:1.1em}
  .ea-ast-l{display:flex;align-items:baseline;gap:12px;font-size:1.15em;padding:4px 0}.ea-ast-l span{font-size:.75em;font-weight:800;background:#3b7be0;border-radius:6px;padding:1px 8px}.ea-ast-l em{font-style:normal;color:#ffd27a;margin-left:auto}
  .ea-n{display:flex;flex-direction:column;gap:2px;padding:7px 0;border-bottom:1px solid var(--ea-bord);font-size:.92em}.ea-n:last-child{border-bottom:none}
  .ea-n-l1{display:flex;align-items:baseline;gap:8px;white-space:nowrap;overflow:hidden}.ea-n-l1 b{flex:none;max-width:75%;overflow:hidden;text-overflow:ellipsis}.ea-n-l1 .ea-num{flex:none}.ea-n-loc{color:var(--ea-dim);overflow:hidden;text-overflow:ellipsis}
  .ea-n-t{color:var(--ea-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ea-svg{width:100%;height:auto;display:block;margin-top:6px}
  .ea-leg{display:inline-flex;align-items:center;gap:6px;margin-right:16px}.ea-leg i{width:14px;height:14px;border-radius:4px;display:inline-block}
  .ea-bravo{margin-top:14px;background:linear-gradient(90deg,#11845b,#1baf7a);color:#fff;border-radius:12px;padding:12px 16px;font-size:1em;line-height:1.35}
  .ea-fiers{display:flex;flex-direction:column;gap:10px}
  .ea-fier{display:flex;align-items:center;gap:16px;background:#1a2440;border-radius:12px;padding:12px 16px;border-left:6px solid}.ea-fier b{font-size:2.3em;line-height:1;min-width:2.2em;text-align:center}.ea-fier span{font-size:1.02em;line-height:1.3}
  .ea-n-date{margin-left:auto;flex:none;font-size:.85em;color:#5fe0a8}.ea-n-date.rouge{color:#ff8a8a;font-weight:800}
  .ea-dyn{position:relative;display:flex;flex-direction:column;animation:ea-fondu .6s ease}
  @keyframes ea-fondu{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
  .ea-points{display:flex;gap:8px;justify-content:center;margin-top:auto;padding-top:10px}.ea-points i{width:10px;height:10px;border-radius:50%;background:var(--ea-bord)}.ea-points i.on{background:#3b7be0}
  .ea-prog{height:4px;background:var(--ea-bord);border-radius:99px;overflow:hidden;margin-top:8px}.ea-prog i{display:block;height:100%;width:0;background:#3b7be0;animation:ea-barre linear forwards}
  @keyframes ea-barre{to{width:100%}}
  .ea-b-tete,.ea-b-l{display:grid;grid-template-columns:1.6fr .8fr .8fr .9fr;gap:8px;align-items:baseline}
  .ea-b-tete{color:var(--ea-dim);font-size:.75em;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px}
  .ea-b-l{padding:10px 0;border-bottom:1px solid var(--ea-bord)}.ea-b-l span{color:var(--ea-dim);font-size:.9em}.ea-b-l b{font-size:1.6em}.ea-b-l em{font-style:normal;color:var(--ea-dim);font-size:1.15em}
  .ea-b-l i{font-style:normal;font-weight:800;font-size:.85em}.ea-b-l i.up{color:#5fe0a8}.ea-b-l i.down{color:#ff8a8a}.ea-b-l i.eq{color:var(--ea-dim)}
  .ea-b-gros{margin-top:16px;display:flex;align-items:baseline;gap:12px;background:#1a2440;border-radius:12px;padding:12px 16px}.ea-b-gros b{font-size:2.4em;color:#ffd27a}.ea-b-gros span{color:var(--ea-dim)}
  .ea-pied{margin-top:18px;background:var(--ea-carte);border:1px solid var(--ea-bord);border-radius:12px;padding:10px 16px;font-size:1.05em}.ea-pied .rouge{color:#ff8a8a}
  .ea-edit{position:absolute;top:150px;left:34px;right:34px;z-index:5;max-height:860px;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.6);font-size:20px}
  .ea-edit-liste div{font-size:18px!important}
  .ea-form{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
  .ea-form input[name=texte]{flex:1;min-width:240px}
  .ea-form input{background:#0b1220;color:var(--ea-txt);border:1px solid var(--ea-bord);border-radius:8px;padding:9px 10px;font:inherit;font-size:20px}
  .ea-form label{font-size:14px;display:flex;gap:6px;align-items:center}
  .ea-form button,.ea-edit-liste button{background:#1baf7a;color:#fff;border:none;border-radius:8px;padding:9px 14px;font:inherit;font-size:14px;font-weight:700;cursor:pointer}
  .ea-edit-liste{margin-top:12px;display:flex;flex-direction:column;gap:6px}
  .ea-edit-liste div{display:grid;grid-template-columns:110px 1fr auto auto;gap:10px;align-items:center;font-size:14px;padding:6px 0;border-bottom:1px solid var(--ea-bord)}
  .ea-edit-liste span,.ea-edit-liste small{color:var(--ea-dim)}.ea-edit-liste button{background:none;padding:4px}
  .ea-aide{color:var(--ea-dim);font-size:13px;margin:10px 0 0}
</style>`;

// ---------- Gestion du pense-bête depuis l'appli (superviseurs) ----------
// Onglet « 📌 Pense-bête » de la tuile Écran atelier : ajouter, modifier,
// supprimer les rappels sans passer par l'écran de la télé.
let pbConteneur = null, pbUser = null, pbUnsub = null, pbMemos = [], pbEdit = null;
function pbRender() {
  if (!pbConteneur) return;
  const auj = iso(new Date());
  const tri = [...pbMemos].sort((a, b) => (a.date ? 0 : 1) - (b.date ? 0 : 1) || String(a.date || "").localeCompare(String(b.date || "")));
  const passes = tri.filter(m => m.date && joursEntre(auj, m.date) < -1), actifs = tri.filter(m => !passes.includes(m));
  const ligne = (m) => pbEdit === m.id ? `<form class="pb-l pb-form" data-pb-maj="${esc(m.id)}">
      <input name="texte" value="${esc(m.texte)}" required maxlength="140"><input name="date" type="date" value="${esc(m.date || "")}">
      <label><input type="checkbox" name="important" ${m.important ? "checked" : ""}> ⭐</label>
      <button class="add-btn">💾 Enregistrer</button><button type="button" class="nav-btn" data-pb-annuler>Annuler</button></form>`
    : `<div class="pb-l ${m.date && joursEntre(auj, m.date) < 0 ? "passe" : ""}">
      <span class="pb-q ${quand(m.date).cls}">${m.important ? "⭐ " : ""}${esc(quand(m.date).txt)}</span>
      <b>${esc(m.texte)}</b><small>${esc(m.par || "")}</small>
      <button class="nav-btn" data-pb-modif="${esc(m.id)}">✏️</button><button class="del-btn" data-pb-suppr="${esc(m.id)}">🗑️</button></div>`;
  pbConteneur.innerHTML = `<style>
    .pb{max-width:900px;margin:0 auto;display:flex;flex-direction:column;gap:12px}
    .pb-form{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
    .pb-tele{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
    .pb-form input[name=texte]{flex:1;min-width:220px}
    .pb-form input{padding:9px 10px;border-radius:8px;border:1px solid var(--border);background:var(--panel-alt);color:var(--text);font:inherit}
    .pb-l{display:grid;grid-template-columns:200px minmax(0,1fr) auto auto auto;gap:10px;align-items:center;padding:10px 0;border-bottom:1px solid var(--border)}
    .pb-l.pb-form{display:flex}
    .pb-l small{color:var(--text-dim)}.pb-l.passe{opacity:.55}
    .pb-q{font-size:12.5px;font-weight:600;color:var(--text-dim)}.pb-q.auj,.pb-q.retard{color:var(--red)}.pb-q.dem{color:#c27a00}.pb-q.semaine{color:#1d4f91}
    .pb-q::first-letter{text-transform:uppercase}
    @media (max-width:700px){.pb-l{grid-template-columns:1fr auto auto}.pb-l b{grid-column:1/-1;order:-1}.pb-l small{display:none}}
  </style><div class="pb">
    <div class="form-card"><h3 style="margin:0 0 6px">📌 Pense-bête de l'atelier</h3>
      <p class="hint" style="margin:0 0 10px">Ce que tu ajoutes ici s'affiche tout de suite sur la télé de l'atelier. Un rappel daté disparaît de la télé le lendemain de sa date.</p>
      <form class="pb-form" data-pb-ajout><input name="texte" required maxlength="140" placeholder="Ex. Passage du contrôleur SSI au lycée"><input name="date" type="date"><label><input type="checkbox" name="important"> ⭐ Important</label><button class="add-btn">➕ Ajouter</button></form></div>
    <div class="form-card pb-tele"><b>📺 Télécommande de la télé</b>
      <span class="hint">Son des nouvelles urgences :</span>
      <button class="nav-btn" data-pb-son="1">🔔 Activer</button><button class="nav-btn" data-pb-son="0">🔕 Couper</button>
      <button class="nav-btn" data-pb-recharger>🔄 Recharger la télé</button>
      <p class="hint" style="margin:6px 0 0;flex-basis:100%">Adresse à ouvrir sur la télé : <code>${esc(location.origin)}/app.html?ecran=atelier</code></p></div>
    <div class="form-card"><b>À venir (${actifs.length})</b>${actifs.map(ligne).join("") || `<p class="hint">Aucun rappel.</p>`}</div>
    ${passes.length ? `<details class="form-card"><summary><b>Passés (${passes.length})</b> — n'apparaissent plus sur la télé</summary>${passes.map(ligne).join("")}</details>` : ""}
  </div>`;
}
async function pbClic(e) {
  const son = e.target.closest("[data-pb-son]");
  if (son) { try { await setDoc(doc(db, "config", "ecran-atelier"), { son: son.dataset.pbSon === "1", majPar: pbUser?.nom || "" }, { merge: true }); window.toast?.(son.dataset.pbSon === "1" ? "🔔 Son activé sur la télé" : "🔕 Son coupé sur la télé"); } catch (err) { alert(err?.message || err); } return; }
  if (e.target.closest("[data-pb-recharger]")) { try { await setDoc(doc(db, "config", "ecran-atelier"), { rechargerLe: Date.now() }, { merge: true }); window.toast?.("🔄 La télé va se recharger"); } catch (err) { alert(err?.message || err); } return; }
  const m = e.target.closest("[data-pb-modif]"); if (m) { pbEdit = m.dataset.pbModif; pbRender(); return; }
  if (e.target.closest("[data-pb-annuler]")) { pbEdit = null; pbRender(); return; }
  const s = e.target.closest("[data-pb-suppr]");
  if (s && confirm("Supprimer ce rappel ?")) { try { await deleteDoc(doc(db, COL, s.dataset.pbSuppr)); } catch (err) { alert("Suppression impossible : " + (err?.message || err)); } }
}
async function pbEnvoi(e) {
  const f = e.target; if (!f.matches(".pb-form")) return; e.preventDefault();
  const d = new FormData(f), champs = { texte: String(d.get("texte") || "").trim(), date: d.get("date") || "", important: !!d.get("important") };
  if (!champs.texte) return;
  try {
    if (f.dataset.pbMaj) { await updateDoc(doc(db, COL, f.dataset.pbMaj), { ...champs, modifiePar: pbUser?.nom || "" }); pbEdit = null; }
    else { await addDoc(collection(db, COL), { ...champs, par: pbUser?.nom || pbUser?.email || "", creeLe: serverTimestamp() }); f.reset(); }
    window.toast?.("✓ Pense-bête mis à jour");
  } catch (err) { alert("Enregistrement impossible : " + (err?.message || err) + "\n(Règles Firestore « atelier-memos » publiées ?)"); }
}
export function mountPenseBete(container, u) {
  pbUnsub?.(); pbConteneur = container; pbUser = u; pbEdit = null;
  if (!container.dataset.pbEcoute) { container.addEventListener("click", pbClic); container.addEventListener("submit", pbEnvoi); container.dataset.pbEcoute = "1"; }
  pbConteneur.innerHTML = `<div class="hint">Chargement…</div>`;
  pbUnsub = onSnapshot(collection(db, COL), (s) => { pbMemos = s.docs.map(d => ({ id: d.id, ...d.data() })); pbRender(); }, (e) => { pbConteneur.innerHTML = `<div class="form-card" style="color:var(--red)">❌ ${esc(e.message)}</div>`; });
}

// planning-menage.js — Onglet « Planning » d'un dispositif ménage : planning
// hebdomadaire type de l'agent (créneaux horaires × jours, site par case),
// avec heures par jour et charge par site. Modifiable par les responsables,
// consultable par l'agent. Stocké dans config/planning-menage.
import { db } from "./firebase-init.js";
import { doc, setDoc, onSnapshot } from "./firestore-compte.js";
import { watchSites } from "./sites-data.js";
import { esc } from "./astreinte-logic.js";

const REF = () => doc(db, "config", "planning-menage");
const JOURS = ["LUN", "MAR", "MER", "JEU", "VEN"];
const NOMS = { LUN: "Lundi", MAR: "Mardi", MER: "Mercredi", JEU: "Jeudi", VEN: "Vendredi" };
const COUL_SITES = ["#2f6fd6", "#8a4fd1", "#d9772b", "#139c8f", "#c9407a", "#5a7d1a"];
const COUL_FIXES = { aga: "#2f6fd6", dr: "#8a4fd1", svdp: "#d9772b", moutonnerie: "#139c8f", "la-ferme": "#5a7d1a" };
const coul = (id) => { if (COUL_FIXES[id]) return COUL_FIXES[id]; let h = 0; for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return COUL_SITES[h % COUL_SITES.length]; };
// compte : temps de travail (trajets, réassort, fiches) ou non (pause).
const SPECIAUX = {
  trajet: { label: "Trajet", c: "#8b96a6", compte: true },
  reassort: { label: "Réassort", c: "#b45309", compte: true },
  tracabilite: { label: "Fiches de traçabilité", c: "#0d9488", compte: true },
  pause: { label: "Pause déjeuner", c: "#d9b24c", compte: false },
};

// Planning de Marie (PDF « planning hebdomadaire ») — amorcé une seule fois.
const tous = (v) => Object.fromEntries(JOURS.map(j => [j, v]));
const lmv = (v) => ({ LUN: v, MAR: "", MER: v, JEU: "", VEN: v });
// v5 (04/11/2026) : 36 h / semaine — Douanier Rousseau 8 h – 10 h 15, AGA 10 h 30 – 12 h, pause 12 h – 13 h,
// Saint Vincent de Paul 13 h – 14 h 50 ; lundi / mercredi / vendredi : Moutonnerie puis Ferme (trajets de 5 min) ;
// mardi : réassort 20 min. La fiche de traçabilité (5 min par maison) est COMPRISE dans le temps de chaque maison
// (ficheParSite), affichée sur chaque bloc.
const j5 = (L, Ma, Me, J, V) => ({ LUN: L, MAR: Ma, MER: Me, JEU: J, VEN: V });
export const PLANNING_DEFAUT_MENAGE = {
  "Dispositif MNA": {
    v: 5,
    agent: "Marie NICOLAIZEAU",
    ficheParSite: 5,
    lignes: [
      { debut: "08:00", fin: "10:15", jours: tous("dr") },
      { debut: "10:15", fin: "10:30", jours: tous("trajet") },
      { debut: "10:30", fin: "12:00", jours: tous("aga") },
      { debut: "12:00", fin: "13:00", jours: tous("pause") },
      { debut: "13:00", fin: "14:50", jours: tous("svdp") },
      { debut: "14:50", fin: "14:55", jours: j5("trajet", "reassort", "trajet", "", "trajet") },
      { debut: "14:55", fin: "15:10", jours: j5("moutonnerie", "reassort", "moutonnerie", "", "moutonnerie") },
      { debut: "15:10", fin: "15:55", jours: lmv("moutonnerie") },
      { debut: "15:55", fin: "16:00", jours: lmv("trajet") },
      { debut: "16:00", fin: "17:00", jours: lmv("la-ferme") },
    ],
  },
};

let st = { plannings: null, sites: [], edit: false, brouillon: null };
let unsubs = [], conteneur = null, user = null, dispositif = null;
const estEditeur = (u) => u && ["super_admin", "admin", "n1"].includes(u.role);
const cleanup = () => { unsubs.forEach(f => f()); unsubs = []; };
const minutes = (h) => { const [a, b] = String(h || "0:0").split(":").map(Number); return a * 60 + (b || 0); };
const duree = (l) => Math.max(0, minutes(l.fin) - minutes(l.debut));
const fmtH = (m) => `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, "0") : ""}`;
const court = (n) => String(n || "").replace(/^Maison\s+MNA\s+/i, "").replace(/^Maison\s+/i, "");

export function mountPlanningMenage(container, u, disp) {
  cleanup(); conteneur = container; user = u; dispositif = disp; st.edit = false; st.brouillon = null;
  container.innerHTML = `<div class="hint">Chargement…</div>`;
  unsubs.push(watchSites((s) => { st.sites = s; render(); }));
  unsubs.push(onSnapshot(REF(), (snap) => {
    const d = snap.exists() ? snap.data() : {};
    st.plannings = d;
    // Planning absent, ou d'une version plus ancienne que celle du code : remplacé une fois par la version à jour.
    const defaut = PLANNING_DEFAUT_MENAGE[dispositif];
    if (defaut && estEditeur(user) && (!d[dispositif] || (d[dispositif].v || 1) < (defaut.v || 1))) { d[dispositif] = defaut; setDoc(REF(), { [dispositif]: defaut }, { merge: true }).catch(() => {}); }
    render();
  }, () => { st.plannings = {}; render(); }));
}

function libelle(v) {
  if (!v) return "";
  if (SPECIAUX[v]) return SPECIAUX[v].label;
  const s = st.sites.find(x => x.id === v); return s ? court(s.name) : v;
}
function couleur(v) { return SPECIAUX[v]?.c || (st.sites.some(x => x.id === v) ? coul(v) : "#5a6372"); }
const travaille = (v) => v && (!SPECIAUX[v] || SPECIAUX[v].compte);
const estSite = (v) => v && !SPECIAUX[v];

function calculs(p) {
  const parJour = Object.fromEntries(JOURS.map(j => [j, 0])), parSite = {};
  (p.lignes || []).forEach(l => JOURS.forEach(j => { const v = l.jours?.[j]; if (travaille(v)) parJour[j] += duree(l); if (estSite(v)) parSite[v] = (parSite[v] || 0) + duree(l); }));
  const trajet = (p.lignes || []).reduce((t, l) => t + JOURS.filter(j => l.jours?.[j] === "trajet").length * duree(l), 0);
  // Fiches de traçabilité comprises : ficheParSite minutes par passage dans une maison (bloc continu).
  let passages = 0; if (p.ficheParSite) JOURS.forEach(j => { let prec = ""; (p.lignes || []).forEach(l => { const v = l.jours?.[j] || ""; if (estSite(v) && v !== prec) passages++; prec = v; }); });
  return { parJour, parSite, total: Object.values(parJour).reduce((a, b) => a + b, 0), trajet, fiches: passages * (p.ficheParSite || 0) };
}

function render() {
  if (!conteneur || !document.contains(conteneur)) { cleanup(); return; }
  if (!st.plannings) return;
  const p = st.edit ? st.brouillon : (st.plannings[dispositif] || PLANNING_DEFAUT_MENAGE[dispositif] || { agent: "", lignes: [] });
  const ed = st.edit, k = calculs(p);
  const sitesDisp = st.sites.filter(s => (s.dispositif || "Dispositif MNA") === dispositif);
  const options = (v) => `<option value="">—</option>${sitesDisp.map(s => `<option value="${esc(s.id)}" ${v === s.id ? "selected" : ""}>${esc(court(s.name))}</option>`).join("")}${Object.entries(SPECIAUX).map(([k, x]) => `<option value="${k}" ${v === k ? "selected" : ""}>${x.label}</option>`).join("")}`;
  conteneur.innerHTML = `<div class="stack pm">
    <div class="pm-tete">
      <div><h2>📅 Planning hebdomadaire</h2>${ed ? `<label class="pm-agent">Agent <input id="pm-agent" value="${esc(p.agent || "")}"></label>` : `<p class="hint" style="margin:2px 0 0">${p.agent ? `<b>${esc(p.agent)}</b> · ` : ""}${fmtH(k.total)} par semaine</p>`}</div>
      <div class="pm-btns">${ed ? `<button class="nav-btn" id="pm-annuler">Annuler</button><button class="add-btn" id="pm-save">💾 Enregistrer</button>` : `${estEditeur(user) ? `<button class="nav-btn" id="pm-edit">✏️ Modifier</button>` : ""}<button class="nav-btn" id="pm-print">🖨️ Imprimer</button>`}</div>
    </div>
    <div class="table-wrap pm-wrap"><table class="pm-t">
      <thead><tr><th>Heure</th>${JOURS.map(j => `<th>${NOMS[j]}<small>${fmtH(k.parJour[j])}</small></th>`).join("")}${ed ? "<th></th>" : ""}</tr></thead>
      <tbody>${(() => {
        const L = p.lignes || [];
        // Lecture : une même maison sur plusieurs créneaux qui se suivent = un seul grand rectangle (fusion verticale).
        const span = {}; if (!ed) JOURS.forEach(j => { for (let i = 0; i < L.length;) { const v = L[i].jours?.[j] || ""; let n = 1; while (i + n < L.length && (L[i + n].jours?.[j] || "") === v && L[i + n].debut === L[i + n - 1].fin) n++; span[`${i}|${j}`] = n; for (let k = 1; k < n; k++) span[`${i + k}|${j}`] = 0; i += n; } });
        const hh = (t) => t.replace(":", "h");
        return L.map((l, i) => `<tr style="height:${ed ? "auto" : Math.max(26, Math.round(duree(l) * 1.05)) + "px"}">
        <th>${ed ? `<input type="time" data-pm="${i}|debut" value="${esc(l.debut)}"> – <input type="time" data-pm="${i}|fin" value="${esc(l.fin)}">` : `${esc(hh(l.debut))} – ${esc(hh(l.fin))}`}</th>
        ${JOURS.map(j => { const v = l.jours?.[j] || ""; if (ed) return `<td><select data-pm="${i}|${j}" style="--c:${couleur(v)}">${options(v)}</select></td>`;
          const n = span[`${i}|${j}`]; if (n === 0) return "";
          const fin = L[i + n - 1].fin, dureeBloc = minutes(fin) - minutes(l.debut);
          return `<td ${n > 1 ? `rowspan="${n}"` : ""}>${v ? `<span class="pm-case ${SPECIAUX[v] ? "spe" : ""} ${dureeBloc < 20 ? "mini" : ""}" style="--c:${couleur(v)}" title="${esc(libelle(v))} · ${hh(l.debut)} – ${hh(fin)}">${esc(libelle(v))}${dureeBloc >= 20 ? `<small>${hh(l.debut)} – ${hh(fin)}</small>` : ""}${p.ficheParSite && estSite(v) && dureeBloc >= 30 ? `<em class="pm-fiche">📝 dont ${p.ficheParSite} min de fiche</em>` : ""}</span>` : ""}</td>`; }).join("")}
        ${ed ? `<td><button class="del-btn" data-pm-del="${i}">🗑️</button></td>` : ""}
      </tr>`).join(""); })()}</tbody>
    </table></div>
    ${ed ? `<button class="nav-btn" id="pm-add">➕ Ajouter un créneau</button>` : ""}
    <div class="pm-bas">
      <div class="form-card"><h3>⏱️ Heures travaillées</h3>
        <table class="pm-r">${JOURS.map(j => `<tr><td>${NOMS[j]}</td><td>${fmtH(k.parJour[j])}</td></tr>`).join("")}<tr class="tot"><td>Total</td><td>${fmtH(k.total)}</td></tr></table>
        ${k.trajet ? `<p class="hint">Dont trajets : ${fmtH(k.trajet)} par semaine (comptés à part, pas dans le temps des maisons).</p>` : ""}${k.fiches ? `<p class="hint">📝 Fiches de traçabilité : ${p.ficheParSite} min par maison, comprises dans le temps de ménage (${fmtH(k.fiches)} par semaine).</p>` : ""}</div>
      <div class="form-card"><h3>🏠 Temps passé par maison <small style="font-weight:600;color:var(--text-dim)">(sur place, hors trajets)</small></h3>
        ${Object.entries(k.parSite).sort((a, b) => b[1] - a[1]).map(([id, m]) => `<div class="pm-site"><span class="pm-pastille" style="--c:${couleur(id)}"></span><b>${esc(libelle(id))}</b><span class="pm-barre"><i style="width:${k.total ? m / k.total * 100 : 0}%;background:${couleur(id)}"></i></span><span class="pm-site-h">${fmtH(m)} / semaine · <b>${k.total ? Math.round(m / k.total * 100) : 0} %</b> du temps</span></div>`).join("") || `<p class="hint">Aucun site planifié.</p>`}</div>
    </div>
  </div>`;
  brancher();
}

function brancher() {
  const q = (s) => conteneur.querySelector(s);
  q("#pm-edit")?.addEventListener("click", () => { st.edit = true; st.brouillon = JSON.parse(JSON.stringify(st.plannings[dispositif] || PLANNING_DEFAUT_MENAGE[dispositif] || { agent: "", lignes: [] })); render(); });
  q("#pm-annuler")?.addEventListener("click", () => { st.edit = false; st.brouillon = null; render(); });
  q("#pm-print")?.addEventListener("click", imprimerPlanning);
  q("#pm-agent")?.addEventListener("input", (e) => { st.brouillon.agent = e.target.value; });
  conteneur.querySelectorAll("[data-pm]").forEach(el => el.addEventListener("change", () => {
    const [i, k] = el.dataset.pm.split("|"), l = st.brouillon.lignes[+i];
    if (k === "debut" || k === "fin") l[k] = el.value; else { l.jours = l.jours || {}; l.jours[k] = el.value; }
    render();
  }));
  conteneur.querySelectorAll("[data-pm-del]").forEach(b => b.addEventListener("click", () => { st.brouillon.lignes.splice(+b.dataset.pmDel, 1); render(); }));
  q("#pm-add")?.addEventListener("click", () => {
    const der = st.brouillon.lignes[st.brouillon.lignes.length - 1];
    st.brouillon.lignes.push({ debut: der?.fin || "08:00", fin: der?.fin ? `${String(Math.min(23, +der.fin.slice(0, 2) + 1)).padStart(2, "0")}${der.fin.slice(2)}` : "09:00", jours: tous("") });
    render();
  });
  q("#pm-save")?.addEventListener("click", async () => {
    st.brouillon.lignes.sort((a, b) => minutes(a.debut) - minutes(b.debut));
    try { await setDoc(REF(), { [dispositif]: st.brouillon }, { merge: true }); st.edit = false; st.brouillon = null; window.toast?.("Planning enregistré ✓"); }
    catch (e) { alert("Enregistrement impossible : " + (e?.message || e)); }
  });
}

// Impression : page A4 PAYSAGE à part (fond blanc), le planning + les totaux, dans un cadre invisible.
function imprimerPlanning() {
  const p = st.plannings?.[dispositif] || PLANNING_DEFAUT_MENAGE[dispositif]; if (!p) return;
  const k = calculs(p), L = p.lignes || [], hh = (t) => t.replace(":", "h");
  const span = {}; JOURS.forEach(j => { for (let i = 0; i < L.length;) { const v = L[i].jours?.[j] || ""; let n = 1; while (i + n < L.length && (L[i + n].jours?.[j] || "") === v && L[i + n].debut === L[i + n - 1].fin) n++; span[`${i}|${j}`] = n; for (let x = 1; x < n; x++) span[`${i + x}|${j}`] = 0; i += n; } });
  const totalMin = minutes(L[L.length - 1]?.fin || "17:00") - minutes(L[0]?.debut || "08:00");
  const hRow = (l) => Math.max(4.5, duree(l) / totalMin * 100); // mm : ~112 mm de grille, tout tient sur une page
  const lignes = L.map((l, i) => `<tr style="height:${hRow(l).toFixed(1)}mm"><th>${hh(l.debut)} – ${hh(l.fin)}</th>${JOURS.map(j => {
    const n = span[`${i}|${j}`]; if (n === 0) return ""; const v = l.jours?.[j] || "", fin = L[i + n - 1].fin, d = minutes(fin) - minutes(l.debut);
    return `<td ${n > 1 ? `rowspan="${n}"` : ""}>${v ? `<div class="c ${SPECIAUX[v] ? "spe" : ""}" style="--c:${couleur(v)}"><b>${esc(libelle(v))}</b>${d >= 20 ? `<small>${hh(l.debut)} – ${hh(fin)}</small>` : ""}${p.ficheParSite && !SPECIAUX[v] && d >= 30 ? `<i>dont ${p.ficheParSite} min de fiche</i>` : ""}</div>` : ""}</td>`; }).join("")}</tr>`).join("");
  const sites = Object.entries(k.parSite).sort((a, b) => b[1] - a[1]);
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Planning — ${esc(p.agent || dispositif)}</title><style>
    @page{size:A4 landscape;margin:8mm}*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    body{font-family:Montserrat,Arial,sans-serif;color:#111827;margin:0;font-size:10pt}
    .t{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:3mm}.t h1{font-size:15pt;margin:0}.t span{color:#4b5563}
    table.g{width:100%;border-collapse:separate;border-spacing:0;table-layout:fixed}
    table.g thead th{background:#f3f4f6;padding:1.5mm;font-size:10pt;border-bottom:.3mm solid #d1d5db}table.g thead th small{display:block;font-weight:600;color:#6b7280;font-size:8pt}
    table.g tbody th{width:24mm;font-size:7.5pt;color:#6b7280;font-weight:600;border-bottom:.2mm solid #eef0f3;text-align:center}
    table.g td{position:relative;padding:0;border-bottom:.2mm solid #eef0f3}
    .c{position:absolute;inset:.5mm .8mm;border-radius:2mm;background:var(--c);color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;overflow:hidden;line-height:1.15}
    .c b{font-size:9pt}.c small{font-size:7pt;opacity:.9}.c i{font-size:6.5pt;font-style:normal;opacity:.95;margin-top:.4mm;background:rgba(255,255,255,.22);border-radius:1mm;padding:0 1.2mm}.c.spe{background:#fff;color:var(--c);border:.3mm dashed var(--c)}.c.spe b{font-size:7.5pt}
    .bas{display:grid;grid-template-columns:1fr 1.6fr;gap:6mm;margin-top:4mm}.bas>div{border:.4mm solid #9ca3af;border-radius:2.5mm;padding:2.5mm 3.5mm}
    .bas h2{font-size:10pt;margin:0 0 1.5mm;padding-bottom:1.2mm;border-bottom:.4mm solid #111827}
    .bas table{width:100%;border-collapse:collapse;font-size:9pt}.bas td{padding:.8mm 1mm;border-bottom:.2mm solid #eef0f3}.bas td:last-child{text-align:right;font-weight:700}.bas tr.tot td{font-weight:800;border-top:.4mm solid #111827}
    .p{display:inline-block;width:3mm;height:3mm;border-radius:50%;background:var(--c);margin-right:1.5mm;vertical-align:middle}
  </style></head><body>
    <div class="t"><h1>Planning hebdomadaire — ${esc(p.agent || "")}</h1><span>${esc(dispositif)} · ${fmtH(k.total)} par semaine</span></div>
    <table class="g"><thead><tr><th style="width:24mm">Heure</th>${JOURS.map(j => `<th>${NOMS[j]}<small>${fmtH(k.parJour[j])}</small></th>`).join("")}</tr></thead><tbody>${lignes}</tbody></table>
    <div class="bas"><div><h2>Heures travaillées par jour</h2><table>${JOURS.map(j => `<tr><td>${NOMS[j]}</td><td>${fmtH(k.parJour[j])}</td></tr>`).join("")}<tr class="tot"><td>Total</td><td>${fmtH(k.total)}</td></tr></table></div>
      <div><h2>Temps passé par maison, sur place (hors trajets)</h2><table>${sites.map(([id, m]) => `<tr><td><span class="p" style="--c:${couleur(id)}"></span>${esc(libelle(id))}</td><td>${fmtH(m)} / semaine (${k.total ? Math.round(m / k.total * 100) : 0} % du temps)</td></tr>`).join("")}${k.trajet ? `<tr><td>Dont trajets</td><td>${fmtH(k.trajet)} / semaine</td></tr>` : ""}${k.fiches ? `<tr><td>Dont fiches de traçabilité (${p.ficheParSite} min par maison, dans le temps de ménage)</td><td>${fmtH(k.fiches)} / semaine</td></tr>` : ""}</table></div></div>
  </body></html>`;
  const f = document.createElement("iframe");
  // Cadre hors écran mais à la taille d'une page A4 paysage : sur téléphone, la mise en page n'est plus écrasée.
  f.style.cssText = "position:fixed;left:-20000px;top:0;width:1123px;height:794px;border:0";
  document.body.appendChild(f);
  const d = f.contentDocument; d.open(); d.write(html); d.close();
  setTimeout(() => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { alert("Impression impossible : " + (e?.message || e)); } setTimeout(() => f.remove(), 60000); }, 400);
}

// Heures par site (planning) : sert à mettre à jour le modèle de répartition.
export function chargeParSite(p, sites) {
  st.sites = sites || st.sites; const k = calculs(p || PLANNING_DEFAUT_MENAGE["Dispositif MNA"]);
  return Object.entries(k.parSite).map(([id, m]) => ({ label: `Ménage — ${libelle(id)}`, heures: Math.round(m / 60 * 100) / 100 }));
}

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
const SPECIAUX = { trajet: { label: "Trajet", c: "#8b96a6" }, pause: { label: "Pause déjeuner", c: "#d9b24c" } };

// Planning de Marie (PDF « planning hebdomadaire ») — amorcé une seule fois.
const tous = (v) => Object.fromEntries(JOURS.map(j => [j, v]));
const lmv = (v) => ({ LUN: v, MAR: "", MER: v, JEU: "", VEN: v });
export const PLANNING_DEFAUT_MENAGE = {
  "Dispositif MNA": {
    agent: "Marie NICOLAIZEAU",
    lignes: [
      { debut: "08:15", fin: "10:15", jours: tous("dr") },
      { debut: "10:15", fin: "10:30", jours: tous("trajet") },
      { debut: "10:30", fin: "12:30", jours: tous("aga") },
      { debut: "12:30", fin: "13:30", jours: tous("pause") },
      { debut: "13:30", fin: "15:30", jours: tous("svdp") },
      { debut: "15:30", fin: "16:30", jours: lmv("moutonnerie") },
      { debut: "16:30", fin: "17:30", jours: lmv("la-ferme") },
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
    if (!d[dispositif] && PLANNING_DEFAUT_MENAGE[dispositif] && estEditeur(user)) setDoc(REF(), { [dispositif]: PLANNING_DEFAUT_MENAGE[dispositif] }, { merge: true }).catch(() => {});
    render();
  }, () => { st.plannings = {}; render(); }));
}

function libelle(v) {
  if (!v) return "";
  if (SPECIAUX[v]) return SPECIAUX[v].label;
  const s = st.sites.find(x => x.id === v); return s ? court(s.name) : v;
}
function couleur(v) { return SPECIAUX[v]?.c || (st.sites.some(x => x.id === v) ? coul(v) : "#5a6372"); }
const travaille = (v) => v && !SPECIAUX[v];

function calculs(p) {
  const parJour = Object.fromEntries(JOURS.map(j => [j, 0])), parSite = {};
  (p.lignes || []).forEach(l => JOURS.forEach(j => { const v = l.jours?.[j]; if (travaille(v)) { parJour[j] += duree(l); parSite[v] = (parSite[v] || 0) + duree(l); } }));
  const trajet = (p.lignes || []).reduce((t, l) => t + JOURS.filter(j => l.jours?.[j] === "trajet").length * duree(l), 0);
  return { parJour, parSite, total: Object.values(parJour).reduce((a, b) => a + b, 0), trajet };
}

function render() {
  if (!conteneur || !document.contains(conteneur)) { cleanup(); return; }
  if (!st.plannings) return;
  const p = st.edit ? st.brouillon : (st.plannings[dispositif] || PLANNING_DEFAUT_MENAGE[dispositif] || { agent: "", lignes: [] });
  const ed = st.edit, k = calculs(p);
  const sitesDisp = st.sites.filter(s => (s.dispositif || "Dispositif MNA") === dispositif);
  const options = (v) => `<option value="">—</option>${sitesDisp.map(s => `<option value="${esc(s.id)}" ${v === s.id ? "selected" : ""}>${esc(court(s.name))}</option>`).join("")}<option value="trajet" ${v === "trajet" ? "selected" : ""}>Trajet</option><option value="pause" ${v === "pause" ? "selected" : ""}>Pause déjeuner</option>`;
  conteneur.innerHTML = `<div class="stack pm">
    <div class="pm-tete">
      <div><h2>📅 Planning hebdomadaire</h2>${ed ? `<label class="pm-agent">Agent <input id="pm-agent" value="${esc(p.agent || "")}"></label>` : `<p class="hint" style="margin:2px 0 0">${p.agent ? `<b>${esc(p.agent)}</b> · ` : ""}${fmtH(k.total)} par semaine</p>`}</div>
      <div class="pm-btns">${ed ? `<button class="nav-btn" id="pm-annuler">Annuler</button><button class="add-btn" id="pm-save">💾 Enregistrer</button>` : `${estEditeur(user) ? `<button class="nav-btn" id="pm-edit">✏️ Modifier</button>` : ""}<button class="nav-btn" id="pm-print">🖨️ Imprimer</button>`}</div>
    </div>
    <div class="table-wrap pm-wrap"><table class="pm-t">
      <thead><tr><th>Heure</th>${JOURS.map(j => `<th>${NOMS[j]}<small>${fmtH(k.parJour[j])}</small></th>`).join("")}${ed ? "<th></th>" : ""}</tr></thead>
      <tbody>${(p.lignes || []).map((l, i) => `<tr>
        <th>${ed ? `<input type="time" data-pm="${i}|debut" value="${esc(l.debut)}"> – <input type="time" data-pm="${i}|fin" value="${esc(l.fin)}">` : `${esc(l.debut.replace(":", "h"))} – ${esc(l.fin.replace(":", "h"))}`}</th>
        ${JOURS.map(j => { const v = l.jours?.[j] || ""; return ed ? `<td><select data-pm="${i}|${j}" style="--c:${couleur(v)}">${options(v)}</select></td>`
          : `<td>${v ? `<span class="pm-case ${SPECIAUX[v] ? "spe" : ""}" style="--c:${couleur(v)}">${esc(libelle(v))}</span>` : ""}</td>`; }).join("")}
        ${ed ? `<td><button class="del-btn" data-pm-del="${i}">🗑️</button></td>` : ""}
      </tr>`).join("")}</tbody>
    </table></div>
    ${ed ? `<button class="nav-btn" id="pm-add">➕ Ajouter un créneau</button>` : ""}
    <div class="pm-bas">
      <div class="form-card"><h3>⏱️ Heures travaillées</h3>
        <table class="pm-r">${JOURS.map(j => `<tr><td>${NOMS[j]}</td><td>${fmtH(k.parJour[j])}</td></tr>`).join("")}<tr class="tot"><td>Total</td><td>${fmtH(k.total)}</td></tr></table>
        ${k.trajet ? `<p class="hint">Trajets (non comptés) : ${fmtH(k.trajet)} par semaine.</p>` : ""}</div>
      <div class="form-card"><h3>🏠 Charge par site</h3>
        ${Object.entries(k.parSite).sort((a, b) => b[1] - a[1]).map(([id, m]) => `<div class="pm-site"><span class="pm-pastille" style="--c:${couleur(id)}"></span><b>${esc(libelle(id))}</b><span class="pm-barre"><i style="width:${k.total ? m / k.total * 100 : 0}%;background:${couleur(id)}"></i></span><span>${fmtH(m)} / sem.</span><small>${k.total ? Math.round(m / k.total * 100) : 0} %</small></div>`).join("") || `<p class="hint">Aucun site planifié.</p>`}</div>
    </div>
  </div>`;
  brancher();
}

function brancher() {
  const q = (s) => conteneur.querySelector(s);
  q("#pm-edit")?.addEventListener("click", () => { st.edit = true; st.brouillon = JSON.parse(JSON.stringify(st.plannings[dispositif] || PLANNING_DEFAUT_MENAGE[dispositif] || { agent: "", lignes: [] })); render(); });
  q("#pm-annuler")?.addEventListener("click", () => { st.edit = false; st.brouillon = null; render(); });
  q("#pm-print")?.addEventListener("click", () => window.print());
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

// Heures par site (planning) : sert à mettre à jour le modèle de répartition.
export function chargeParSite(p, sites) {
  st.sites = sites || st.sites; const k = calculs(p || PLANNING_DEFAUT_MENAGE["Dispositif MNA"]);
  return Object.entries(k.parSite).map(([id, m]) => ({ label: `Ménage — ${libelle(id)}`, heures: Math.round(m / 60 * 100) / 100 }));
}

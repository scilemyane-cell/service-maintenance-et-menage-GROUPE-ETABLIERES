// stats-menage.js — Onglet « 📊 Statistiques » d'un dispositif ménage :
// toutes les statistiques au même endroit, sur la période choisie.
//   • état des fiches (validées, à vérifier, pas envoyées, semaines sans fiche) ;
//   • tableau de bord (réalisé par site et par semaine, tâches sautées,
//     charge par jour, tâches périodiques) ;
//   • par personne (Marie, remplaçants, prestataires) ;
//   • planning : heures prévues par site et taux de réalisation.
import { db } from "./firebase-init.js";
import { doc, onSnapshot } from "./firestore-compte.js";
import { watchSites } from "./sites-data.js";
import { watchFiches } from "./fiches-data.js";
import { esc, dateKey, addDays } from "./astreinte-logic.js";
import { tableauDeBordHTML, calculer, cases, couleur } from "./tracabilite-stats.js";

let st = { sites: [], fiches: [], planning: null }, ui = { semaines: 8, site: "" };
let unsubs = [], conteneur = null, dispositif = null;
const cleanup = () => { unsubs.forEach(f => f()); unsubs = []; };
const pc = (d, t) => (t ? Math.round(d / t * 100) : null);
const court = (n) => String(n || "").replace(/^Maison\s+MNA\s+/i, "").replace(/^Maison\s+/i, "");
const fmtH = (m) => `${Math.floor(m / 60)}h${m % 60 ? String(Math.round(m % 60)).padStart(2, "0") : ""}`;

export function mountStatsMenage(container, user, disp) {
  cleanup(); conteneur = container; dispositif = disp;
  container.innerHTML = `<div class="hint">Chargement…</div>`;
  unsubs.push(watchSites((s) => { st.sites = s; render(); }));
  unsubs.push(watchFiches((f) => { st.fiches = f; render(); }));
  unsubs.push(onSnapshot(doc(db, "config", "planning-menage"), (s) => { st.planning = s.exists() ? s.data()[dispositif] || null : null; render(); }, () => {}));
}

function render() {
  if (!conteneur || !document.contains(conteneur)) { cleanup(); return; }
  const sitesDisp = st.sites.filter(s => (s.dispositif || "Dispositif MNA") === dispositif);
  const sites = ui.site ? sitesDisp.filter(s => s.id === ui.site) : sitesDisp;
  const ids = new Set(sites.map(s => s.id));
  const auj = new Date(), lundi = dateKey(addDays(auj, -((auj.getDay() + 6) % 7)));
  const semaines = Array.from({ length: ui.semaines }, (_, i) => dateKey(addDays(new Date(lundi + "T00:00:00"), -7 * (ui.semaines - 1 - i))));
  const fiches = st.fiches.filter(f => ids.has(f.siteId) && semaines.includes(f.weekStart));

  // 1. État des fiches
  const etat = (f) => f.validee ? "validee" : f.submitted ? "averif" : f.weekStart < lundi ? "nonenv" : "cours";
  const nb = { validee: 0, averif: 0, nonenv: 0, cours: 0 }; fiches.forEach(f => nb[etat(f)]++);
  const trous = []; sites.forEach(s => semaines.filter(w => w < lundi).forEach(w => { if (!fiches.some(f => f.siteId === s.id && f.weekStart === w)) trous.push({ s, w }); }));
  const fmtS = (w) => new Date(w + "T12:00").toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });

  // 3. Par personne (fiche par fiche, sans fusion)
  const parPers = {};
  fiches.forEach(f => {
    const site = sites.find(s => s.id === f.siteId); if (!site) return;
    const c = cases(f, site, auj), o = parPers[f.agentNom || "?"] || (parPers[f.agentNom || "?"] = { fiches: 0, d: 0, t: 0, sites: new Set(), presta: !!f.prestataire, societe: f.societe || "" });
    o.fiches++; o.sites.add(court(site.name)); c.forEach(x => { o.t++; if (x.fait) o.d++; });
  });

  // 4. Planning vs réalisé
  const { lignes } = calculer(fiches, sites, { semaines: ui.semaines, auj });
  let planningHTML = "";
  if (st.planning?.lignes?.length) {
    const minutes = (h) => { const [a, b] = String(h || "0:0").split(":").map(Number); return a * 60 + (b || 0); };
    const parSite = {};
    st.planning.lignes.forEach(l => Object.values(l.jours || {}).forEach(v => { if (v && ids.has(v)) parSite[v] = (parSite[v] || 0) + Math.max(0, minutes(l.fin) - minutes(l.debut)); }));
    const tot = Object.values(parSite).reduce((a, b) => a + b, 0);
    planningHTML = `<div class="form-card"><h3 class="tb-h">6. Planning et réalisation</h3>
      <p class="hint">Heures prévues chaque semaine au planning${st.planning.agent ? ` de ${esc(st.planning.agent)}` : ""}, et part des tâches réellement cochées sur la période. Un site avec beaucoup d'heures mais un faible taux = temps insuffisant pour le cahier des charges ou tâches à revoir.</p>
      <div class="table-wrap"><table class="tb-t"><thead><tr><th>Site</th><th>Heures / semaine</th><th>Part du temps</th><th>Réalisé</th></tr></thead><tbody>
      ${sites.filter(s => parSite[s.id]).map(s => { const l = lignes.find(x => x.site.id === s.id); return `<tr><td><b>${esc(court(s.name))}</b></td><td>${fmtH(parSite[s.id])}</td><td>${pc(parSite[s.id], tot)} %</td><td class="tb-c ${couleur(l?.taux)}">${l?.taux == null ? "—" : l.taux + " %"}</td></tr>`; }).join("")}
      </tbody><tfoot><tr><td><b>Total</b></td><td><b>${fmtH(tot)}</b></td><td></td><td></td></tr></tfoot></table></div></div>`;
  }

  conteneur.innerHTML = `<div class="stack sm">
    <div class="sm-filtres">
      <div class="tr-vues">${[4, 8, 12, 26, 52].map(n => `<button type="button" class="${ui.semaines === n ? "actif" : ""}" data-sm-sem="${n}">${n === 52 ? "1 an" : n + " sem."}</button>`).join("")}</div>
      <label>Site <select id="sm-site"><option value="">Tous les sites</option>${sitesDisp.map(s => `<option value="${esc(s.id)}" ${ui.site === s.id ? "selected" : ""}>${esc(court(s.name))}</option>`).join("")}</select></label>
      <span class="hint">du ${fmtS(semaines[0])} au ${new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })}</span>
    </div>

    <div class="form-card"><h3 class="tb-h">0. Fiches de la période</h3>
      <div class="tb-kpis">
        <div class="tb-kpi vert"><span>✅ Validées</span><b>${nb.validee}</b><small>transmissibles au MNA</small></div>
        <div class="tb-kpi ${nb.averif ? "orange" : ""}"><span>⏳ À vérifier</span><b>${nb.averif}</b><small>envoyées, en attente de ta validation</small></div>
        <div class="tb-kpi ${nb.nonenv ? "orange" : ""}"><span>📭 Pas envoyées</span><b>${nb.nonenv}</b><small>semaine finie, pas envoyée</small></div>
        <div class="tb-kpi ${trous.length ? "rouge" : "vert"}"><span>🕳️ Semaines sans fiche</span><b>${trous.length}</b><small>${sites.length} site(s) × ${semaines.filter(w => w < lundi).length} semaine(s) terminée(s)</small></div>
      </div>
      ${trous.length ? `<details class="sm-det"><summary>Voir les semaines sans fiche</summary><div class="sm-trous">${sites.map(s => { const l = trous.filter(t => t.s.id === s.id); return l.length ? `<div><b>${esc(court(s.name))}</b> : ${l.map(t => `S. du ${fmtS(t.w)}`).join(", ")}</div>` : ""; }).join("")}</div></details>` : ""}
    </div>

    ${tableauDeBordHTML(fiches, sites, { semaines: ui.semaines, auj })}

    <div class="form-card"><h3 class="tb-h">5. Par personne</h3>
      <div class="table-wrap"><table class="tb-t"><thead><tr><th>Personne</th><th>Fiches</th><th>Sites</th><th>Tâches faites</th><th>Réalisé</th></tr></thead><tbody>
      ${Object.entries(parPers).sort((a, b) => b[1].fiches - a[1].fiches).map(([n, o]) => `<tr><td><b>${esc(n)}</b>${o.presta ? ` <small class="hint">prestataire${o.societe ? " · " + esc(o.societe) : ""}</small>` : ""}</td><td>${o.fiches}</td><td>${esc([...o.sites].join(", "))}</td><td>${o.d}/${o.t}</td><td class="tb-c ${couleur(pc(o.d, o.t))}">${pc(o.d, o.t) ?? "—"} %</td></tr>`).join("") || `<tr><td colspan="5" class="hint">Aucune fiche sur la période.</td></tr>`}
      </tbody></table></div></div>

    ${planningHTML}
  </div>`;
  conteneur.querySelectorAll("[data-sm-sem]").forEach(b => b.addEventListener("click", () => { ui.semaines = +b.dataset.smSem; render(); }));
  conteneur.querySelector("#sm-site")?.addEventListener("change", (e) => { ui.site = e.target.value; render(); });
}

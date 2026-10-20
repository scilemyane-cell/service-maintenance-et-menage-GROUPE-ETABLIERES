// tracabilite-stats.js — Tableau de bord ménage (onglet Traçabilité).
// Les fiches étant remplies honnêtement, elles montrent ce qui n'a pas pu
// être fait. Trois vues, par site :
//   1. Taux de réalisation par semaine (vert / orange / rouge) + tendance ;
//   2. Tâches les plus souvent sautées (« jamais faite depuis N semaines ») ;
//   3. Charge par jour : le jour où l'agent n'arrive pas à tout faire.
// Seules les tâches quotidiennes comptent (les tâches « 1x/mois »… ont leur
// propre suivi) ; les jours à venir de la semaine en cours ne comptent pas.
import { esc, dateKey, addDays } from "./astreinte-logic.js";

const JOURS = ["LUN", "MAR", "MER", "JEU", "VEN"];
const NOMS = { LUN: "Lundi", MAR: "Mardi", MER: "Mercredi", JEU: "Jeudi", VEN: "Vendredi" };
const label = (t) => (typeof t === "string" ? t : t?.label || "");
const quotidienne = (t) => !(typeof t === "object" && t?.freq);
const lundiDe = (d) => dateKey(addDays(d, -((d.getDay() + 6) % 7)));
export const couleur = (p) => (p == null ? "" : p >= 90 ? "vert" : p >= 70 ? "orange" : "rouge");
const pc = (d, t) => (t ? Math.round((d / t) * 100) : null);

// Jours « échus » d'une semaine : tous si elle est passée, jusqu'à aujourd'hui sinon.
function joursEchus(weekStart, auj = new Date()) {
  const lundi = lundiDe(auj);
  if (weekStart < lundi) return JOURS;
  if (weekStart > lundi) return [];
  return JOURS.slice(0, Math.min(5, ((auj.getDay() + 6) % 7) + 1));
}

// Détail planifié / fait d'une fiche : [{ ri, ti, piece, tache, jour, fait }]
export function cases(fiche, site, auj = new Date()) {
  const echus = new Set(joursEchus(fiche.weekStart, auj)), out = [];
  (site?.rooms || []).forEach((room, ri) => (room.tasks || []).forEach((t, ti) => {
    if (!quotidienne(t)) return;
    (room.days || []).forEach(j => { if (echus.has(j)) out.push({ ri, ti, piece: room.name, tache: label(t), jour: j, fait: !!fiche.cells?.[`${ri}-${ti}-${j}`] }); });
  }));
  return out;
}

export function calculer(fiches, sites, { semaines = 8, auj = new Date() } = {}) {
  const lundi = lundiDe(auj);
  const listeSem = Array.from({ length: semaines }, (_, i) => dateKey(addDays(new Date(lundi + "T00:00:00"), -7 * (semaines - 1 - i))));
  const parSite = new Map();
  fiches.filter(f => listeSem.includes(f.weekStart)).forEach(f => {
    const site = sites.find(s => s.id === f.siteId); if (!site) return;
    const e = parSite.get(site.id) || { site, sem: {}, taches: new Map(), jours: {} };
    const c = cases(f, site, auj);
    const s = e.sem[f.weekStart] || (e.sem[f.weekStart] = { d: 0, t: 0 });
    c.forEach(x => {
      s.t++; if (x.fait) s.d++;
      const j = e.jours[x.jour] || (e.jours[x.jour] = { d: 0, t: 0 }); j.t++; if (x.fait) j.d++;
      const k = `${x.ri}-${x.ti}`, tk = e.taches.get(k) || { piece: x.piece, tache: x.tache, d: 0, t: 0, sem: {} };
      tk.t++; if (x.fait) tk.d++; const ts = tk.sem[f.weekStart] || (tk.sem[f.weekStart] = { d: 0, t: 0 }); ts.t++; if (x.fait) ts.d++;
      e.taches.set(k, tk);
    });
    parSite.set(site.id, e);
  });
  const lignes = [...parSite.values()].map(e => {
    const tot = Object.values(e.sem).reduce((a, s) => ({ d: a.d + s.d, t: a.t + s.t }), { d: 0, t: 0 });
    const avec = listeSem.filter(w => e.sem[w]?.t);
    const moy = (ws) => { const x = ws.reduce((a, w) => ({ d: a.d + e.sem[w].d, t: a.t + e.sem[w].t }), { d: 0, t: 0 }); return pc(x.d, x.t); };
    const recent = moy(avec.slice(-4)), avant = moy(avec.slice(-8, -4));
    const sautees = [...e.taches.values()].filter(t => t.t && t.d < t.t).map(t => {
      // Semaines consécutives (les plus récentes) sans qu'elle soit faite une seule fois.
      let n = 0; for (const w of [...listeSem].reverse()) { const s = t.sem[w]; if (!s?.t) continue; if (s.d) break; n++; }
      return { ...t, taux: pc(t.d, t.t), manquees: t.t - t.d, jamaisDepuis: n };
    }).sort((a, b) => b.jamaisDepuis - a.jamaisDepuis || a.taux - b.taux || b.manquees - a.manquees);
    return { site: e.site, sem: e.sem, taux: pc(tot.d, tot.t), recent, avant, tendance: recent != null && avant != null ? recent - avant : null, sautees, jours: e.jours };
  }).sort((a, b) => (a.taux ?? 101) - (b.taux ?? 101));
  // Charge par jour, tous sites filtrés confondus.
  const jours = {}; lignes.forEach(l => JOURS.forEach(j => { const x = l.jours[j]; if (!x) return; const g = jours[j] || (jours[j] = { d: 0, t: 0 }); g.d += x.d; g.t += x.t; }));
  return { listeSem, lignes, jours };
}

export function tableauDeBordHTML(fiches, sites, opts = {}) {
  const { listeSem, lignes, jours } = calculer(fiches, sites, opts);
  if (!lignes.length) return `<div class="form-card"><p class="hint">Pas encore de fiche sur les 8 dernières semaines pour ce filtre.</p></div>`;
  const tot = lignes.reduce((a, l) => { Object.values(l.sem).forEach(s => { a.d += s.d; a.t += s.t; }); return a; }, { d: 0, t: 0 });
  const global = pc(tot.d, tot.t);
  const pireJour = JOURS.filter(j => jours[j]?.t).sort((a, b) => pc(jours[a].d, jours[a].t) - pc(jours[b].d, jours[b].t))[0];
  const toutesSautees = lignes.flatMap(l => l.sautees.map(t => ({ ...t, siteNom: l.site.name }))).sort((a, b) => b.jamaisDepuis - a.jamaisDepuis || a.taux - b.taux || b.manquees - a.manquees);
  const fleche = (t) => t == null ? "" : t >= 3 ? `<span class="tb-tend up">▲ +${t} pts</span>` : t <= -3 ? `<span class="tb-tend down">▼ ${t} pts</span>` : `<span class="tb-tend">= stable</span>`;
  const sem = (w) => new Date(w + "T00:00:00").toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
  return `<div class="tb">
    <div class="tb-kpis">
      <div class="tb-kpi ${couleur(global)}"><span>Réalisé (8 semaines)</span><b>${global ?? "—"} %</b><small>${tot.d} tâches faites sur ${tot.t} prévues</small></div>
      <div class="tb-kpi"><span>Sites suivis</span><b>${lignes.length}</b><small>${lignes.filter(l => couleur(l.recent ?? l.taux) === "rouge").length} en rouge sur les 4 dernières semaines</small></div>
      <div class="tb-kpi ${pireJour ? couleur(pc(jours[pireJour].d, jours[pireJour].t)) : ""}"><span>Jour le plus chargé</span><b>${pireJour ? NOMS[pireJour] : "—"}</b><small>${pireJour ? `${pc(jours[pireJour].d, jours[pireJour].t)} % réalisé ce jour-là` : ""}</small></div>
      <div class="tb-kpi"><span>Tâches jamais faites</span><b>${toutesSautees.filter(t => t.jamaisDepuis >= 2).length}</b><small>depuis 2 semaines ou plus</small></div>
    </div>

    <div class="form-card"><h3 class="tb-h">1. Taux de réalisation par site et par semaine</h3>
      <p class="hint tb-leg"><i class="vert"></i> 90 % et plus <i class="orange"></i> 70 à 89 % <i class="rouge"></i> moins de 70 % · tendance = 4 dernières semaines comparées aux 4 précédentes</p>
      <div class="table-wrap"><table class="tb-t"><thead><tr><th>Site</th>${listeSem.map(w => `<th>${sem(w)}</th>`).join("")}<th>Moyenne</th><th>Tendance</th></tr></thead><tbody>
        ${lignes.map(l => `<tr><td><b>${esc(l.site.name)}</b></td>${listeSem.map(w => { const s = l.sem[w], p = s?.t ? pc(s.d, s.t) : null; return `<td class="tb-c ${couleur(p)}" title="${s ? `${s.d}/${s.t}` : "pas de fiche"}">${p == null ? "·" : p + "%"}</td>`; }).join("")}
          <td class="tb-c ${couleur(l.taux)}"><b>${l.taux ?? "—"}%</b></td><td>${fleche(l.tendance)}</td></tr>`).join("")}
      </tbody></table></div></div>

    <div class="form-card"><h3 class="tb-h">2. Tâches les plus souvent sautées</h3>
      <p class="hint">Sur les 8 dernières semaines. En tête : celles qui n'ont plus été faites du tout depuis plusieurs semaines.</p>
      ${toutesSautees.length ? `<div class="tb-saut">${toutesSautees.slice(0, 15).map(t => `<div class="tb-saut-l">
        <div><b>${esc(t.tache)}</b><span>${esc(t.siteNom)} · ${esc(t.piece)}</span></div>
        <span class="tb-barre"><i class="${couleur(t.taux)}" style="width:${t.taux}%"></i></span>
        <span class="tb-saut-n">${t.d}/${t.t} fois · <b>${t.taux}%</b></span>
        ${t.jamaisDepuis >= 1 ? `<span class="tb-alerte">${t.jamaisDepuis >= 2 ? `jamais faite depuis ${t.jamaisDepuis} semaines` : "pas faite cette semaine"}</span>` : `<span></span>`}
      </div>`).join("")}</div>` : `<p>✅ Aucune tâche sautée : tout ce qui était prévu a été fait.</p>`}</div>

    <div class="form-card"><h3 class="tb-h">3. Charge par jour</h3>
      <p class="hint">Part des tâches prévues réellement faites, selon le jour. Un jour nettement plus bas = trop de tâches prévues ce jour-là : à rééquilibrer, ou argument pour du temps supplémentaire.</p>
      <div class="tb-jours">${JOURS.map(j => { const x = jours[j], p = x?.t ? pc(x.d, x.t) : null; return `<div class="tb-jour"><span class="tb-jour-col"><i class="${couleur(p)}" style="height:${p ?? 0}%"></i></span><b>${p == null ? "—" : p + "%"}</b><span>${NOMS[j]}</span><small>${x ? `${x.t - x.d} non faites / ${x.t}` : ""}</small></div>`; }).join("")}</div>
      ${lignes.length > 1 ? `<div class="table-wrap"><table class="tb-t"><thead><tr><th>Site</th>${JOURS.map(j => `<th>${NOMS[j]}</th>`).join("")}</tr></thead><tbody>${lignes.map(l => `<tr><td>${esc(l.site.name)}</td>${JOURS.map(j => { const x = l.jours[j], p = x?.t ? pc(x.d, x.t) : null; return `<td class="tb-c ${couleur(p)}">${p == null ? "·" : p + "%"}</td>`; }).join("")}</tr>`).join("")}</tbody></table></div>` : ""}
    </div>
  </div>`;
}

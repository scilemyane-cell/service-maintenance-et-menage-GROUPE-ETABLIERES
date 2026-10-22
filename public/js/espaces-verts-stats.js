// espaces-verts-stats.js — Tableau de bord des espaces verts (sites MNA).
// Calculé à partir des passages : fréquence des passages, sites à jour ou en
// retard, prestations en retard (intervalle attendu de chaque prestation,
// selon la saison), activité par mois et par semaine.
import { esc } from "./astreinte-logic.js";
import { TACHES, retardsSite, joursDepuis } from "./espaces-verts-data.js";

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const lundi = (d) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
// Couleur du « dernier passage » : vert ≤ 14 j, orange ≤ 30 j, rouge au-delà.
const coulJours = (j) => (j == null ? "rouge" : j <= 14 ? "vert" : j <= 30 ? "orange" : "rouge");
const ilYa = (j) => (j == null ? "jamais" : j <= 0 ? "aujourd'hui" : j === 1 ? "hier" : `il y a ${j} j`);

export function calculerEV(passages, sites, auj = new Date()) {
  const ps = (passages || []).filter(p => p.date && sites.some(s => s.id === p.siteId));
  const moisCle = (d) => iso(d).slice(0, 7);
  const ceMois = moisCle(auj), moisPrec = moisCle(new Date(auj.getFullYear(), auj.getMonth() - 1, 1));
  const annee = String(auj.getFullYear());
  const parSite = sites.map(s => {
    const l = ps.filter(p => p.siteId === s.id).sort((a, b) => b.date.localeCompare(a.date));
    const dernier = l[0] || null, j = dernier ? joursDepuis(dernier.date, auj) : null;
    // « jamais faite » n'est pas un retard (démarrage du suivi) : compté à part.
    const tous = retardsSite(ps, s.id, auj), retards = tous.filter(r => !r.jamais), jamais = tous.filter(r => r.jamais);
    const il12 = iso(new Date(auj.getFullYear() - 1, auj.getMonth(), auj.getDate()));
    return { site: s, dernier, jours: j, retards, jamais, nb12: l.filter(p => p.date >= il12).length, nbAn: l.filter(p => p.date.startsWith(annee)).length, liste: l };
  }).sort((a, b) => (b.jours ?? 99999) - (a.jours ?? 99999));
  // 12 dernières semaines (lundi), passages par site.
  const l0 = lundi(auj), semaines = Array.from({ length: 12 }, (_, i) => { const d = new Date(l0); d.setDate(d.getDate() - 7 * (11 - i)); return iso(d); });
  const semDe = (dateIso) => iso(lundi(new Date(dateIso + "T00:00:00")));
  // 12 derniers mois.
  const mois = Array.from({ length: 12 }, (_, i) => { const d = new Date(auj.getFullYear(), auj.getMonth() - 11 + i, 1); return { cle: moisCle(d), label: MOIS[d.getMonth()] }; });
  const parMois = mois.map(m => ({ ...m, n: ps.filter(p => p.date.startsWith(m.cle)).length }));
  // Prestations : part des sites (avec au moins un passage) où elle est à jour.
  const actifs = parSite.filter(x => x.dernier);
  const m = auj.getMonth() + 1;
  const prestations = TACHES.filter(t => t.jours).map(t => {
    const enSaison = !t.saison || t.saison.includes(m);
    const enRetard = actifs.filter(x => x.retards.some(r => r.cle === t.cle)), jamais = actifs.filter(x => x.jamais.some(r => r.cle === t.cle));
    const total = actifs.length - jamais.length;
    return { ...t, enSaison, enRetard, jamais, aJour: total - enRetard.length, total };
  }).sort((a, b) => (b.enSaison - a.enSaison) || (b.enRetard.length - a.enRetard.length));
  return {
    parSite, semaines, semDe, parMois, prestations,
    ceMois: ps.filter(p => p.date.startsWith(ceMois)).length, moisPrec: ps.filter(p => p.date.startsWith(moisPrec)).length,
    annee: ps.filter(p => p.date.startsWith(annee)).length,
    retardsTotal: parSite.reduce((a, x) => a + x.retards.length, 0),
    aJour: actifs.filter(x => !x.retards.length).length, nbActifs: actifs.length,
  };
}

export function tableauEVHTML(passages, sites, auj = new Date()) {
  if (!sites.length) return "";
  const k = calculerEV(passages, sites, auj);
  const ecart = k.ceMois - k.moisPrec;
  const plusVieux = k.parSite[0];
  const maxMois = Math.max(1, ...k.parMois.map(x => x.n));
  const fmtS = (w) => new Date(w + "T00:00:00").toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
  return `<div class="tb ev-tb">
    <div class="tb-kpis">
      <div class="tb-kpi ${k.ceMois ? "vert" : "orange"}"><span>Passages ce mois-ci</span><b>${k.ceMois}</b><small>${ecart > 0 ? `▲ ${ecart} de plus que le mois dernier` : ecart < 0 ? `▼ ${-ecart} de moins que le mois dernier` : "autant que le mois dernier"} (${k.moisPrec})</small></div>
      <div class="tb-kpi"><span>Passages en ${auj.getFullYear()}</span><b>${k.annee}</b><small>sur ${k.parSite.length} site${k.parSite.length > 1 ? "s" : ""} MNA</small></div>
      <div class="tb-kpi ${!k.nbActifs ? "" : k.aJour === k.nbActifs ? "vert" : k.aJour ? "orange" : "rouge"}"><span>Sites à jour</span><b>${k.aJour}/${k.nbActifs || 0}</b><small>${k.retardsTotal} prestation${k.retardsTotal > 1 ? "s" : ""} en retard au total</small></div>
      <div class="tb-kpi ${coulJours(plusVieux?.jours)}"><span>Site le plus délaissé</span><b style="font-size:18px">${esc(plusVieux?.site.name || "—")}</b><small>dernier passage ${ilYa(plusVieux?.jours)}</small></div>
    </div>

    <div class="form-card"><h3 class="tb-h">1. État des sites</h3>
      <p class="hint tb-leg"><i class="vert"></i> passage il y a 14 j ou moins <i class="orange"></i> 15 à 30 j <i class="rouge"></i> plus de 30 j ou jamais</p>
      <div class="ev-etat">${k.parSite.map(x => `<div class="ev-etat-l ${coulJours(x.jours)}">
        <div><b>${esc(x.site.name)}</b><span>${x.dernier ? `Dernier passage le ${new Date(x.dernier.date + "T00:00:00").toLocaleDateString("fr-FR")} · ${esc(x.dernier.agentNom || "")}` : "Aucun passage enregistré"}</span></div>
        <span class="ev-etat-j">${ilYa(x.jours)}</span>
        <span class="ev-etat-n">${x.nb12} passage${x.nb12 > 1 ? "s" : ""} / 12 mois</span>
        <span>${!x.dernier ? "" : x.retards.length ? `<span class="tb-alerte">${x.retards.length} en retard</span>` : `<span class="ev-ok-pill">✓ à jour</span>`}</span>
      </div>`).join("")}</div></div>

    <div class="form-card"><h3 class="tb-h">2. Passages des 12 dernières semaines</h3>
      <p class="hint">Une case verte = au moins un passage cette semaine-là (le chiffre = nombre de passages).</p>
      <div class="table-wrap"><table class="tb-t"><thead><tr><th>Site</th>${k.semaines.map(w => `<th>${fmtS(w)}</th>`).join("")}</tr></thead><tbody>
        ${k.parSite.map(x => `<tr><td><b>${esc(x.site.name)}</b></td>${k.semaines.map(w => { const n = x.liste.filter(p => k.semDe(p.date) === w).length; return `<td class="tb-c ${n ? "vert" : ""}" title="${n} passage(s)">${n || "·"}</td>`; }).join("")}</tr>`).join("")}
      </tbody></table></div></div>

    <div class="form-card"><h3 class="tb-h">3. Prestations en retard</h3>
      <p class="hint">Par prestation : nombre de sites à jour selon la fréquence prévue (tonte tous les 14 j, désherbage tous les 30 j…). Hors saison, la prestation n'est pas attendue.</p>
      ${k.nbActifs ? `<div class="tb-saut">${k.prestations.map(t => { const p = t.total ? Math.round(t.aJour / t.total * 100) : 0; return `<div class="tb-saut-l ${t.enSaison ? "" : "ev-hors"}">
        <div><b>${esc(t.label)}</b><span>${t.enSaison ? `prévue tous les ${t.jours} j` : "hors saison"}${t.enRetard.length ? ` · en retard : ${t.enRetard.map(x => esc(x.site.name)).join(", ")}` : ""}${t.jamais.length ? ` · pas encore faite : ${t.jamais.map(x => esc(x.site.name)).join(", ")}` : ""}</span></div>
        <span class="tb-barre"><i class="${!t.enSaison ? "" : p >= 90 ? "vert" : p >= 60 ? "orange" : "rouge"}" style="width:${p}%"></i></span>
        <span class="tb-saut-n">${t.total ? `<b>${t.aJour}/${t.total}</b> sites à jour` : "pas encore faite"}</span><span></span>
      </div>`; }).join("")}</div>` : `<p class="hint">Les retards apparaîtront dès le premier passage enregistré.</p>`}</div>

    <div class="form-card"><h3 class="tb-h">4. Passages par mois</h3>
      <div class="ev-mois">${k.parMois.map(m => `<div class="ev-mois-c"><b>${m.n || ""}</b><span class="ev-mois-col"><i style="height:${m.n / maxMois * 100}%"></i></span><small>${m.label}</small></div>`).join("")}</div>
    </div>
  </div>`;
}

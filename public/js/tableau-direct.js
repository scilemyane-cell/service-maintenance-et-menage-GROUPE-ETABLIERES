// tableau-direct.js — « 🛰️ Tableau de bord direct » : tout voir d'un coup d'œil (superviseurs).
// Uniquement des écoutes déjà partagées par l'appli (copies locales) : quasi aucune lecture en plus.
// Tout se met à jour en direct ; chaque carte mène au bon endroit d'un clic.
import { esc, resolveDayN1, resolveDayN2, computeWeeklyTitulaires } from "./astreinte-logic.js";
import { watchDemandes, watchPeople, watchAbsences, watchInterventionsACompleter } from "./firestore-data.js";
import { watchCoordonnees } from "./coordonnees-data.js";
import { categorieDe, infoCategorie } from "./categories-pannes.js";

let unsubs = [], conteneur = null, minuterie = null, attente = null;
const st = { demandes: null, people: null, absences: [], coord: {}, interv: [], fiches: [], compteurs: null, stock: null };

const sa = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const ms = (t) => (t?.toMillis ? t.toMillis() : t?.seconds ? t.seconds * 1000 : typeof t === "number" ? t : 0);
const dateOk = (v) => /^\d{4}-\d{2}-\d{2}/.test(String(v || "")) ? String(v).slice(0, 10) : "";
const ferme = (d) => /^(realis|annul)/.test(sa(d.statut));
const aValider = (d) => d.statut === "Réalisé – à valider";
const valide = (d) => !d.lieeA && !d.supprimeeLe && !sa(d.statut).startsWith("arbitrage");
const urgence = (d) => d.urgenceCorrigee || d.urgence || "";
const estUrg = (d) => ["Urgent", "Critique"].includes(urgence(d));
const dateTraitee = (d) => sa(d.statut).startsWith("realis") ? (dateOk(d.dateIntervention) || dateOk(d.dateValidation) || dateOk(d.dateStatut) || dateOk(d.declareLe))
  : sa(d.statut).startsWith("annul") ? (dateOk(d.dateStatut) || dateOk(d.dateValidation)) : "";
const dateRecue = (d) => dateOk(d.dateDemande) || (ms(d.importeLe) ? iso(new Date(ms(d.importeLe))) : "");
const DEBUT_ATTRIBUTION = new Date("2026-10-01T00:00:00").getTime();
const depuis = (t) => { if (!t) return ""; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? "à l'instant" : m < 60 ? `il y a ${m} min` : m < 1440 ? `il y a ${Math.floor(m / 60)} h` : `il y a ${Math.floor(m / 1440)} j`; };
const age = (d) => { const j = dateRecue(d); return j ? Math.max(0, Math.round((new Date(iso(new Date()) + "T00:00") - new Date(j + "T00:00")) / 864e5)) : null; };

function planifier() { if (attente) return; attente = setTimeout(() => { attente = null; render(); }, 150); }

function astreinte() {
  const p0 = st.people; if (!p0?.n1?.length) return null;
  const actifs = p0.astreinteActive || {};
  const p = { ...p0, n1: p0.n1.filter(n => actifs[n] !== false), n2: (p0.n2 || []).filter(n => actifs[n] !== false) };
  try { const { titN1, titN2 } = computeWeeklyTitulaires(p, st.absences); return { n1: resolveDayN1(new Date(), p, st.absences, titN1)?.assigned, n2: p.n2.length ? resolveDayN2(new Date(), p, st.absences, titN2)?.assigned : "" }; }
  catch { return null; }
}
const tel = (n) => { const c = st.coord[n] || {}; return c.telephone || (Array.isArray(c.telephones) ? c.telephones.find(x => x.numero)?.numero : "") || ""; };

const COUL = ["#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899", "#14b8a6", "#ef4444", "#6366f1"];
const couleurDe = (n) => { let h = 0; for (const c of String(n)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return COUL[h % COUL.length]; };
const initiales = (n) => String(n || "?").replace(/^(👷|🏢)\s*/, "").split(/\s+(?:et\s+)?/).filter(Boolean).slice(0, 2).map(m => m[0]).join("").toUpperCase();
const avatar = (n, ext) => `<span class="td-av" style="--a:${ext ? "#64748b" : couleurDe(n)}">${ext ? "🏢" : esc(initiales(n))}</span>`;
const pl = (n, s, p) => `${n} ${n > 1 ? (p || s + "s") : s}`;
// Courbe lissée (Catmull-Rom → Bézier).
const chemin = (pts, bas = 1e9) => pts.map((p, i) => { if (!i) return `M${p[0]},${p[1]}`; const p0 = pts[i - 2] || pts[i - 1], p1 = pts[i - 1], p3 = pts[i + 1] || p;
  const c = (v) => Math.min(bas, v);
  return `C${p1[0] + (p[0] - p0[0]) / 6},${c(p1[1] + (p[1] - p0[1]) / 6)} ${p[0] - (p3[0] - p1[0]) / 6},${c(p[1] - (p3[1] - p1[1]) / 6)} ${p[0]},${p[1]}`; }).join(" ");
function sparkline(vals, c) {
  const W = 90, H = 26, m = Math.max(1, ...vals), pts = vals.map((v, i) => [i * W / (vals.length - 1), H - 3 - v / m * (H - 6)]);
  return `<svg viewBox="0 0 ${W} ${H}" class="td-spark"><path d="${chemin(pts, H - 3)} L${W},${H} L0,${H}Z" fill="${c}" opacity=".15"/><path d="${chemin(pts, H - 3)}" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round"/></svg>`;
}

function render() {
  if (!conteneur || !document.contains(conteneur)) return;
  if (!st.demandes) { conteneur.innerHTML = `<div class="hint">Chargement du tableau de bord…</div>`; return; }
  const auj = iso(new Date()), maintenant = new Date();
  const l = st.demandes.filter(valide);
  const ouvertes = l.filter(d => !ferme(d) && !aValider(d));
  const urg = ouvertes.filter(estUrg).sort((a, b) => (urgence(a) === "Critique" ? 0 : 1) - (urgence(b) === "Critique" ? 0 : 1) || (age(b) ?? 0) - (age(a) ?? 0));
  const aAttribuer = ouvertes.filter(d => !d.attribueA && ms(d.importeLe) >= DEBUT_ATTRIBUTION);
  const nbValider = l.filter(aValider).length;
  const vieilles = ouvertes.filter(d => (age(d) ?? 0) > 30).length;

  // Série quotidienne (30 jours, 7 sur téléphone pour les mini-courbes).
  const NJ = conteneur.clientWidth < 700 ? 14 : 30;
  const jours = Array.from({ length: NJ }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (NJ - 1) + i); const k = iso(d);
    return { k, d, r: l.filter(x => dateRecue(x) === k).length, t: l.filter(x => dateTraitee(x) === k && sa(x.statut).startsWith("realis")).length }; });
  const j7 = jours.slice(-7), recuesAuj = jours[jours.length - 1].r, traiteesAuj = jours[jours.length - 1].t;
  const totR = jours.reduce((s, x) => s + x.r, 0), totT = jours.reduce((s, x) => s + x.t, 0);

  // Grand graphique (aires lissées).
  const W = 820, H = 230, gx = 34, gb = 26, gt = 12, maxJ = Math.max(4, ...jours.flatMap(x => [x.r, x.t]));
  const pas = Math.ceil(maxJ / 4), top = pas * 4, X = (i) => gx + i * (W - gx - 8) / (NJ - 1), Y = (v) => H - gb - v / top * (H - gb - gt);
  const ptsR = jours.map((x, i) => [X(i), Y(x.r)]), ptsT = jours.map((x, i) => [X(i), Y(x.t)]);
  const grille = [0, 1, 2, 3, 4].map(k => `<line x1="${gx}" x2="${W - 8}" y1="${Y(k * pas)}" y2="${Y(k * pas)}" class="td-g"/><text x="${gx - 8}" y="${Y(k * pas) + 4}" text-anchor="end" class="td-ax">${k * pas}</text>`).join("");
  const etiq = jours.map((x, i) => (i % (NJ > 20 ? 5 : 2) === (NJ - 1) % (NJ > 20 ? 5 : 2) ? `<text x="${X(i)}" y="${H - 6}" text-anchor="middle" class="td-ax ${x.k === auj ? "fort" : ""}">${x.k === auj ? "auj." : x.d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" }).replace(".", "")}</text>` : "")).join("");
  const graph = `<svg viewBox="0 0 ${W} ${H}" class="td-courbe">
    <defs><linearGradient id="tdgR" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b82f6" stop-opacity=".35"/><stop offset="1" stop-color="#3b82f6" stop-opacity="0"/></linearGradient>
    <linearGradient id="tdgT" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#10b981" stop-opacity=".35"/><stop offset="1" stop-color="#10b981" stop-opacity="0"/></linearGradient></defs>
    ${grille}${etiq}
    <path d="${chemin(ptsR, Y(0))} L${X(NJ - 1)},${Y(0)} L${X(0)},${Y(0)}Z" fill="url(#tdgR)"/><path d="${chemin(ptsT, Y(0))} L${X(NJ - 1)},${Y(0)} L${X(0)},${Y(0)}Z" fill="url(#tdgT)"/>
    <path d="${chemin(ptsR, Y(0))}" fill="none" stroke="#3b82f6" stroke-width="2.5" stroke-linecap="round"/><path d="${chemin(ptsT, Y(0))}" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round"/>
    <circle cx="${ptsR[NJ - 1][0]}" cy="${ptsR[NJ - 1][1]}" r="4.5" fill="#3b82f6" class="td-pt"/><circle cx="${ptsT[NJ - 1][0]}" cy="${ptsT[NJ - 1][1]}" r="4.5" fill="#10b981" class="td-pt"/>
  </svg>`;

  // Charge par personne : barres empilées (urgentes en rouge).
  const charge = {};
  ouvertes.forEach(d => { const k = d.attribueANom || ""; const c = charge[k] || (charge[k] = { n: 0, u: 0, ext: d.attribueA === "ext" }); c.n++; if (estUrg(d)) c.u++; });
  const lignesCharge = Object.entries(charge).sort((a, b) => (a[0] === "") - (b[0] === "") || b[1].n - a[1].n);
  const maxC = Math.max(1, ...lignesCharge.map(([, c]) => c.n));

  // Donut des catégories.
  const cats = {}; ouvertes.forEach(d => { const c = categorieDe(d); cats[c] = (cats[c] || 0) + 1; });
  const tri = Object.entries(cats).sort((a, b) => b[1] - a[1]);
  const top5 = tri.slice(0, 5), reste = tri.slice(5).reduce((s, [, n]) => s + n, 0);
  const parts = [...top5.map(([id, n]) => ({ ...infoCategorie(id), n })), ...(reste ? [{ lib: "Autres", ic: "•", c: "#94a3b8", n: reste }] : [])];
  const R = 52, C = 2 * Math.PI * R; let off = 0;
  const donut = `<svg viewBox="0 0 140 140" class="td-donut"><circle cx="70" cy="70" r="${R}" fill="none" stroke="var(--panel-alt)" stroke-width="18"/>
    ${parts.map(p => { const lg = p.n / Math.max(1, ouvertes.length) * C; const s = `<circle cx="70" cy="70" r="${R}" fill="none" stroke="${p.c}" stroke-width="18" stroke-dasharray="${Math.max(0, lg - 2)} ${C}" stroke-dashoffset="${-off}" transform="rotate(-90 70 70)"/>`; off += lg; return s; }).join("")}
    <text x="70" y="68" text-anchor="middle" class="td-dn">${ouvertes.length}</text><text x="70" y="86" text-anchor="middle" class="td-dl">ouvertes</text></svg>`;

  // Fil d'activité.
  const activite = st.demandes.filter(d => !d.supprimeeLe && !d.lieeA).map(d => ({ d, t: Math.max(ms(d.dateMaj), ms(d.importeLe)) })).filter(x => x.t).sort((a, b) => b.t - a.t).slice(0, 6);
  const qui = (d) => d.commentaireMajPar || d.validePar || d.declarePar || d.attribuePar || d.commentaireTechPar || "";
  const coulStatut = (s) => { const v = sa(s); return v.startsWith("realis") ? "#10b981" : v.startsWith("annul") ? "#94a3b8" : v.startsWith("planif") ? "#8b5cf6" : v.includes("commande") || v.includes("devis") ? "#f59e0b" : "#3b82f6"; };

  // Équipe.
  const absents = st.absences.filter(a => String(a.start || "").slice(0, 10) <= auj && String(a.end || a.start || "").slice(0, 10) >= auj);
  const TYP = { conge: "Congé", rtt: "RTT", arret: "Arrêt", enfant: "Enfant malade" };
  const ast = astreinte();

  // Points à surveiller.
  const alertes = [];
  const immed = l.filter(d => d.actionImmediate && d.actionPour && !d.actionFaiteLe && !ferme(d));
  if (immed.length) alertes.push(["#ef4444", immed.length, `${pl(immed.length, "action immédiate", "actions immédiates")} en attente`, [...new Set(immed.map(d => d.actionPourNom).filter(Boolean))].join(", "), "suivi"]);
  if (aAttribuer.length) alertes.push(["#f59e0b", aAttribuer.length, `${aAttribuer.length > 1 ? "demandes" : "demande"} à attribuer`, "", "suivi"]);
  if (nbValider) alertes.push(["#8b5cf6", nbValider, `${nbValider > 1 ? "réalisations" : "réalisation"} à valider`, "", "valider"]);
  if (st.interv.length) alertes.push(["#0ea5e9", st.interv.length, `${st.interv.length > 1 ? "interventions" : "intervention"} d'astreinte à compléter`, "horaires manquants", "astreinte"]);
  if (vieilles) alertes.push(["#64748b", vieilles, `ouverte${vieilles > 1 ? "s" : ""} depuis + de 30 jours`, "", "a-traiter"]);
  if (st.compteurs?.n) alertes.push(["#84cc16", st.compteurs.n, `compteur${st.compteurs.n > 1 ? "s" : ""} ${st.compteurs.mot}`, "", "compteurs"]);
  if (st.stock?.total) alertes.push(["#f97316", st.stock.total, `article${st.stock.total > 1 ? "s" : ""} sous le seuil`, st.stock.deporte ? `dont ${st.stock.deporte} en stock déporté` : "stock atelier", "stock"]);

  // Ménage.
  const lundi = new Date(); lundi.setDate(lundi.getDate() - ((lundi.getDay() + 6) % 7)); const kLundi = iso(lundi);
  const parAgent = {};
  st.fiches.forEach(f => { const t = ms(f.majLe); if (!t || !f.agentNom) return; const a = parAgent[f.agentNom] || (parAgent[f.agentNom] = { auj: 0, sem: 0, der: 0 });
    if (iso(new Date(t)) === auj) a.auj++; if (String(f.weekStart || "").slice(0, 10) === kLundi) a.sem++; if (t > a.der) a.der = t; });
  const agents = Object.entries(parAgent).filter(([, a]) => a.sem || a.auj).sort((a, b) => b[1].der - a[1].der);

  const kpi = (v, lib, c, go, spark, sous) => `<button type="button" class="td-k" style="--c:${c}" data-go="${go}"><span class="td-kl"><i></i>${lib}</span><b>${v}</b>${spark || `<small>${sous || "&nbsp;"}</small>`}</button>`;
  conteneur.innerHTML = `<div class="td">
    <header class="td-h">
      <div><h2>Tableau de bord</h2><p><span class="td-live"><i></i>En direct</span> ${maintenant.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })} · ${maintenant.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</p></div>
      ${ast ? `<div class="td-astr"><span>Astreinte</span>${[["N1", ast.n1], ["N2", ast.n2]].filter(x => x[1]).map(([n, p]) => `<a ${tel(p) ? `href="tel:${esc(tel(p).replace(/[^\d+]/g, ""))}"` : ""} title="${esc(tel(p))}">${avatar(p)}<b>${n}</b> ${esc(p)}</a>`).join("")}</div>` : ""}
    </header>
    <section class="td-ks">
      ${kpi(ouvertes.length, "Ouvertes", "#3b82f6", "a-traiter", "", vieilles ? `dont ${vieilles} depuis + de 30 j` : "aucune de + de 30 j")}
      ${kpi(urg.length, "Urgentes", "#ef4444", "urgentes", "", (n => n ? `dont ${pl(n, "critique")}` : "aucune critique")(urg.filter(d => urgence(d) === "Critique").length))}
      ${kpi(aAttribuer.length, "À attribuer", "#f59e0b", "suivi", "", aAttribuer.length ? "en attente de choix" : "tout est attribué")}
      ${kpi(nbValider, "À valider", "#8b5cf6", "valider", "", nbValider ? "réalisées par les techniciens" : "rien en attente")}
      ${kpi(recuesAuj, "Reçues aujourd'hui", "#0ea5e9", "suivi", sparkline(j7.map(x => x.r), "#0ea5e9"))}
      ${kpi(traiteesAuj, "Réalisées aujourd'hui", "#10b981", "suivi", sparkline(j7.map(x => x.t), "#10b981"))}
    </section>
    <div class="td-main">
      <div class="td-col">
        <section class="td-c">
          <div class="td-ct"><h3>Demandes reçues et réalisées</h3><span class="td-sub">${NJ} derniers jours</span>
            <div class="td-leg"><span><i style="background:#3b82f6"></i>Reçues <b>${totR}</b></span><span><i style="background:#10b981"></i>Réalisées <b>${totT}</b></span></div></div>
          ${graph}
        </section>
        <div class="td-duo">
          <section class="td-c"><div class="td-ct"><h3>Charge en cours</h3><span class="td-sub">demandes ouvertes · <i class="td-pu"></i> dont urgentes</span></div>
            <div class="td-charge">${lignesCharge.map(([k, c]) => `<div class="td-cr">${k ? avatar(k, c.ext) : `<span class="td-av vide">?</span>`}<span class="td-cn">${k ? esc(k) : "<em>Non attribuées</em>"}</span>
              <div class="td-cb"><i style="width:${(c.n - c.u) / maxC * 100}%"></i><i class="u" style="width:${c.u / maxC * 100}%"></i></div><b>${c.n}</b></div>`).join("") || `<p class="td-vide">Aucune demande ouverte 🎉</p>`}</div>
          </section>
          <section class="td-c"><div class="td-ct"><h3>Types de pannes</h3><span class="td-sub">demandes ouvertes</span></div>
            <div class="td-dw">${donut}<ul class="td-dleg">${parts.map(p => `<li><i style="background:${p.c}"></i><span>${esc(p.lib)}</span><b>${p.n}</b></li>`).join("")}</ul></div>
          </section>
        </div>
        <section class="td-c"><div class="td-ct"><h3>Fil d'activité</h3></div>
          <div class="td-fil">${activite.map(({ d, t }) => `<button type="button" data-dem="${esc(d.id)}" data-site="${esc(d.site || "")}"><i style="--c:${coulStatut(d.statut)}"></i><div><b>${esc(d.numero || "")} · ${esc(d.site || "")}</b><span>${esc(d.statut || "Nouvelle")}${qui(d) ? ` · ${esc(qui(d))}` : ""}</span></div><em>${depuis(t)}</em></button>`).join("")}</div>
        </section>
      </div>
      <div class="td-col">
        <section class="td-c"><div class="td-ct"><h3>À surveiller</h3></div>
          ${alertes.length ? `<div class="td-al">${alertes.map(([c, n, t, s, go]) => `<button type="button" data-go="${go}" style="--c:${c}"><b>${n}</b><span>${esc(t)}${s ? `<small>${esc(s)}</small>` : ""}</span><em>›</em></button>`).join("")}</div>` : `<p class="td-vide">👌 Rien à signaler</p>`}
        </section>
        <section class="td-c"><div class="td-ct"><h3>Urgences</h3>${urg.length ? `<span class="td-badge">${urg.length}</span>` : ""}${urg.length > 6 ? `<button type="button" class="td-tout" data-go="urgentes">Tout voir ›</button>` : ""}</div>
          ${urg.length ? `<div class="td-li">${urg.slice(0, 6).map(d => `<button type="button" data-dem="${esc(d.id)}" data-site="${esc(d.site || "")}"><i class="${urgence(d) === "Critique" ? "crit" : ""}"></i><div><b>${esc(d.site || "")}</b><span>${esc(String(d.descriptifCorrige || d.descriptif || ""))}</span></div><em>${age(d) ?? "?"} j<small>${d.attribueANom ? esc(d.attribueANom) : `<u>à attribuer</u>`}</small></em></button>`).join("")}</div>` : `<p class="td-vide">👌 Aucune urgence ouverte</p>`}
        </section>
        <section class="td-c"><div class="td-ct"><h3>Équipe</h3><span class="td-sub">${absents.length ? pl(absents.length, "absent") : "tout le monde est là"}</span><button type="button" class="td-tout" data-go="equipe">Détail ›</button></div>
          ${absents.length ? `<div class="td-abs">${absents.map(a => `<div>${avatar(a.person)}<span><b>${esc(a.person || "")}</b><small>${TYP[a.type] || TYP.conge} · retour le ${new Date(new Date(String(a.end || a.start).slice(0, 10) + "T12:00").getTime() + 864e5).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })}</small></span></div>`).join("")}</div>` : ""}
        </section>
        ${agents.length ? `<section class="td-c"><div class="td-ct"><h3>Ménage</h3><span class="td-sub">fiches de traçabilité</span></div>
          ${agents.map(([n, a]) => `<div class="td-men">${avatar(n)}<span><b>${esc(n)}</b><small>${a.auj} aujourd'hui · ${a.sem} cette semaine</small></span><em>${depuis(a.der)}</em></div>`).join("")}</section>` : ""}
      </div>
    </div>
  </div>`;
}

function aller(go, el) {
  const A = window.__allerCategorie;
  if (el?.dataset.dem) { window.__suiviOuvrir = { id: el.dataset.dem, site: el.dataset.site }; A?.("suivi-demandes"); return; }
  if (["a-traiter", "urgentes", "valider", "actions"].includes(go)) { window.__suiviRaccourci = go; A?.("suivi-demandes"); return; }
  const cat = { suivi: "suivi-demandes", astreinte: "astreinte", equipe: "equipe", compteurs: "compteurs", stock: "stock" }[go];
  if (cat && !A?.(cat)) window.toast?.("Pas accessible avec ce compte.");
}

export function mountTableauDirect(container) {
  unsubs.forEach(u => { try { u(); } catch { /* */ } }); unsubs = [];
  clearInterval(minuterie);
  conteneur = container;
  if (!document.getElementById("td-style")) document.head.insertAdjacentHTML("beforeend", STYLE);
  container.addEventListener("click", (e) => { const b = e.target.closest("[data-go],[data-dem]"); if (b && container.contains(b)) aller(b.dataset.go, b); });
  render();
  unsubs.push(watchDemandes((l) => { st.demandes = l || []; planifier(); }));
  unsubs.push(watchPeople((p) => { st.people = p; planifier(); }));
  unsubs.push(watchAbsences((a) => { st.absences = a || []; planifier(); }));
  unsubs.push(watchCoordonnees((c) => { st.coord = c || {}; planifier(); }));
  unsubs.push(watchInterventionsACompleter((l) => { st.interv = l || []; planifier(); }));
  import("./fiches-data.js").then(m => { if (conteneur === container) unsubs.push(m.watchFiches((l) => { st.fiches = l || []; planifier(); })); }).catch(() => {});
  import("./compteurs-data.js").then(m => { if (conteneur === container) unsubs.push(m.watchCompteursListe((l) => {
    const actifs = (l || []).filter(c => !c.desactive && !c.archive);
    st.compteurs = { n: actifs.filter(m.estEnRetard).length, mot: m.motRetard() }; planifier(); })); }).catch(() => {});
  import("./stock-alerts-data.js").then(m => { if (conteneur === container) unsubs.push(m.watchStockAlertCount((c) => { st.stock = c; planifier(); })); }).catch(() => {});
  // L'heure, les « il y a … » et le jour se rafraîchissent toutes les minutes.
  minuterie = setInterval(() => { if (!document.contains(container)) { clearInterval(minuterie); unsubs.forEach(u => { try { u(); } catch { /* */ } }); unsubs = []; return; } render(); }, 60000);
}

const STYLE = `<style id="td-style">
.td{display:flex;flex-direction:column;gap:16px;max-width:1500px;margin:0 auto}
.td-h{display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:12px}
.td-h h2{margin:0;font-size:24px;letter-spacing:-.02em}.td-h p{margin:4px 0 0;color:var(--text-dim);font-size:13.5px;text-transform:capitalize;display:flex;align-items:center;gap:10px}
.td-live{display:inline-flex;align-items:center;gap:6px;text-transform:none;font-weight:600;color:#10b981;background:rgba(16,185,129,.12);padding:2px 9px;border-radius:99px;font-size:12px}
.td-live i{width:7px;height:7px;border-radius:50%;background:#10b981;animation:td-p 1.8s infinite}@keyframes td-p{0%{box-shadow:0 0 0 0 rgba(16,185,129,.6)}70%{box-shadow:0 0 0 7px rgba(16,185,129,0)}}
.td-astr{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.td-astr>span{font-size:12px;color:var(--text-dim);margin-right:2px}
.td-astr a{display:inline-flex;align-items:center;gap:7px;background:var(--panel);border:1px solid var(--border);border-radius:99px;padding:3px 12px 3px 3px;color:var(--text);text-decoration:none;font-size:13.5px}.td-astr a b{color:var(--text-dim);font-size:11px}
.td-av{width:28px;height:28px;flex:none;border-radius:50%;display:inline-grid;place-items:center;background:var(--a);color:#fff;font-size:11.5px;font-weight:700;letter-spacing:.02em}.td-av.vide{background:var(--panel-alt);color:var(--text-dim);border:1px dashed var(--border)}
.td-ks{display:grid;grid-template-columns:repeat(6,1fr);background:var(--panel);border:1px solid var(--border);border-radius:16px;overflow:hidden}
.td-k{all:unset;cursor:pointer;padding:14px 18px;display:flex;flex-direction:column;gap:2px;border-left:1px solid var(--border);position:relative;min-width:0}
.td-k:first-child{border-left:0}.td-k:hover{background:var(--panel-alt)}
.td-kl{font-size:12px;color:var(--text-dim);display:flex;align-items:center;gap:6px;white-space:nowrap}.td-kl i{width:8px;height:8px;border-radius:2px;background:var(--c)}
.td-k b{font-size:34px;font-weight:750;letter-spacing:-.03em;line-height:1.15;font-variant-numeric:tabular-nums}
.td-k small{font-size:12px;color:var(--text-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;height:26px;line-height:26px}.td-spark{width:90px;height:26px}
.td-main{display:grid;grid-template-columns:minmax(0,1.75fr) minmax(320px,1fr);gap:16px;align-items:start}
.td-col{display:flex;flex-direction:column;gap:16px;min-width:0}.td-duo{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.td-c{background:var(--panel);border:1px solid var(--border);border-radius:16px;padding:16px 18px;min-width:0}
.td-ct{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin-bottom:10px}.td-ct h3{margin:0;font-size:15px;font-weight:700;color:var(--text)}
.td-sub{font-size:12px;color:var(--text-dim)}.td-tout{all:unset;cursor:pointer;margin-left:auto;font-size:12.5px;color:var(--teal);font-weight:600}
.td-badge{background:#ef4444;color:#fff;font-size:11.5px;font-weight:700;border-radius:99px;padding:1px 8px}
.td-leg{margin-left:auto;display:flex;gap:14px;font-size:12.5px;color:var(--text-dim)}.td-leg i{display:inline-block;width:10px;height:3px;border-radius:2px;margin-right:6px;vertical-align:middle}.td-leg b{color:var(--text);margin-left:4px}
.td-courbe{width:100%;height:auto;display:block}.td-g{stroke:var(--border);stroke-dasharray:3 4}.td-ax{font-size:11px;fill:var(--text-dim)}.td-ax.fort{fill:var(--text);font-weight:700}.td-pt{stroke:var(--panel);stroke-width:2.5}
.td-pu{display:inline-block;width:8px;height:8px;border-radius:2px;background:#ef4444;vertical-align:middle}
.td-charge{display:flex;flex-direction:column;gap:10px}.td-cr{display:grid;grid-template-columns:28px minmax(70px,1fr) 1.3fr 26px;align-items:center;gap:9px;font-size:13px}
.td-cn{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.td-cn em{color:var(--text-dim)}
.td-cb{display:flex;height:8px;border-radius:99px;background:var(--panel-alt);overflow:hidden}.td-cb i{display:block;height:100%;background:#3b82f6}.td-cb i.u{background:#ef4444}.td-cr b{text-align:right;font-variant-numeric:tabular-nums}
.td-dw{display:flex;align-items:center;gap:14px}.td-donut{width:130px;flex:none}.td-dn{font-size:26px;font-weight:750;fill:var(--text)}.td-dl{font-size:11px;fill:var(--text-dim)}
.td-dleg{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px;min-width:0;flex:1}.td-dleg li{display:flex;align-items:center;gap:7px;font-size:12.5px}.td-dleg i{width:9px;height:9px;border-radius:3px;flex:none}.td-dleg span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.td-dleg b{font-variant-numeric:tabular-nums}
.td-al{display:flex;flex-direction:column}.td-al button{all:unset;cursor:pointer;display:flex;align-items:center;gap:12px;padding:8px 6px;border-top:1px solid var(--border);border-radius:8px}.td-al button:first-child{border-top:0}.td-al button:hover,.td-li button:hover,.td-fil button:hover{background:var(--panel-alt)}
.td-al b{min-width:34px;height:30px;border-radius:9px;display:grid;place-items:center;background:color-mix(in srgb,var(--c) 16%,transparent);color:var(--c);font-size:15px;font-weight:750}
.td-al span{flex:1;font-size:13.5px;display:flex;flex-direction:column}.td-al small{color:var(--text-dim);font-size:11.5px}.td-al em{color:var(--text-dim);font-style:normal;font-size:18px}
.td-li,.td-fil{display:flex;flex-direction:column}.td-li button,.td-fil button{all:unset;cursor:pointer;display:flex;align-items:center;gap:11px;padding:8px 6px;border-top:1px solid var(--border);border-radius:8px;min-width:0}.td-li button:first-child,.td-fil button:first-child{border-top:0}
.td-li i{width:4px;align-self:stretch;border-radius:4px;background:#f97316;flex:none}.td-li i.crit{background:#dc2626}
.td-li div,.td-fil div{flex:1;min-width:0;display:flex;flex-direction:column}.td-li b,.td-fil b{font-size:13.5px}.td-li span,.td-fil span{font-size:12.5px;color:var(--text-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.td-li em{font-style:normal;text-align:right;font-size:13px;font-weight:700;display:flex;flex-direction:column;white-space:nowrap}.td-li em small{font-weight:400;color:var(--text-dim);font-size:11.5px}.td-li u{text-decoration:none;color:#f59e0b;font-weight:600}
.td-fil i{width:9px;height:9px;border-radius:50%;background:var(--c);box-shadow:0 0 0 3px color-mix(in srgb,var(--c) 20%,transparent);flex:none}.td-fil em{font-style:normal;font-size:11.5px;color:var(--text-dim);white-space:nowrap}
.td-abs{display:flex;flex-direction:column;gap:8px}.td-abs>div,.td-men{display:flex;align-items:center;gap:10px}.td-abs span:not(.td-av),.td-men span:not(.td-av){display:flex;flex-direction:column;font-size:13.5px;flex:1}.td-abs small,.td-men small{color:var(--text-dim);font-size:12px}
.td-abs .td-av{box-shadow:0 0 0 2px var(--panel),0 0 0 4px #f59e0b}.td-men em{font-style:normal;font-size:12px;color:#10b981}
.td-vide{margin:2px 0;color:var(--text-dim);font-size:13.5px}
@media (max-width:1100px){.td-main{display:flex;flex-direction:column}.td-main>.td-col:last-child{order:-1}.td-ks{grid-template-columns:repeat(3,1fr)}.td-k:nth-child(4){border-left:0}.td-k:nth-child(n+4){border-top:1px solid var(--border)}}
@media (max-width:640px){.td-ks{grid-template-columns:repeat(2,1fr)}.td-k:nth-child(n){border-left:1px solid var(--border);border-top:1px solid var(--border)}.td-k:nth-child(odd){border-left:0}.td-k:nth-child(-n+2){border-top:0}.td-k{padding:12px 14px}.td-k b{font-size:28px}.td-duo{grid-template-columns:1fr}.td-c{padding:14px}.td-leg{margin-left:0;width:100%}}
</style>`;

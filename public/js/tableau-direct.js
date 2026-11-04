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

function render() {
  if (!conteneur || !document.contains(conteneur)) return;
  if (!st.demandes) { conteneur.innerHTML = `<div class="hint">Chargement du tableau de bord…</div>`; return; }
  const auj = iso(new Date()), maintenant = new Date();
  const l = st.demandes.filter(valide);
  const ouvertes = l.filter(d => !ferme(d) && !aValider(d));
  const urg = ouvertes.filter(estUrg).sort((a, b) => (urgence(a) === "Critique" ? 0 : 1) - (urgence(b) === "Critique" ? 0 : 1) || (age(b) ?? 0) - (age(a) ?? 0));
  const aAttribuer = ouvertes.filter(d => !d.attribueA && ms(d.importeLe) >= DEBUT_ATTRIBUTION);
  const nbValider = l.filter(aValider).length;
  const traiteesAuj = l.filter(d => dateTraitee(d) === auj && sa(d.statut).startsWith("realis"));
  const recuesAuj = l.filter(d => dateRecue(d) === auj);
  const vieilles = ouvertes.filter(d => (age(d) ?? 0) > 30).length;

  // Charge par personne (demandes ouvertes attribuées).
  const charge = {};
  ouvertes.forEach(d => { const k = d.attribueANom ? `${d.attribueA === "ext" ? "🏢" : "👷"} ${d.attribueANom}` : "— Non attribuées"; const c = charge[k] || (charge[k] = { n: 0, u: 0 }); c.n++; if (estUrg(d)) c.u++; });
  const lignesCharge = Object.entries(charge).sort((a, b) => b[1].n - a[1].n);
  const maxC = Math.max(1, ...lignesCharge.map(([, c]) => c.n));

  // 14 derniers jours : reçues / traitées.
  const NJ = conteneur.clientWidth < 600 ? 7 : 14;
  const jours = Array.from({ length: NJ }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (NJ - 1) + i); const k = iso(d); return { k, j: d.toLocaleDateString("fr-FR", { weekday: "narrow" }), n: d.getDate(), r: l.filter(x => dateRecue(x) === k).length, t: l.filter(x => dateTraitee(x) === k).length, we: [0, 6].includes(d.getDay()) }; });
  const maxJ = Math.max(3, ...jours.flatMap(x => [x.r, x.t]));
  const W = NJ === 7 ? 560 : 1100, H = NJ === 7 ? 220 : 170, bw = W / NJ, y = (v) => H - 22 - (v / maxJ) * (H - 40);
  const graph = `<svg viewBox="0 0 ${W} ${H}" class="td-svg">${jours.map((x, i) => { const cx = i * bw + bw / 2, b = Math.min(22, bw * .3);
    return `${x.k === auj ? `<rect x="${i * bw + 2}" y="0" width="${bw - 4}" height="${H}" rx="6" fill="var(--panel-alt)"/>` : ""}
      <rect x="${cx - b - 1}" y="${y(x.r)}" width="${b}" height="${y(0) - y(x.r)}" rx="3" fill="#3b7be0"/><rect x="${cx + 1}" y="${y(x.t)}" width="${b}" height="${y(0) - y(x.t)}" rx="3" fill="#1baf7a"/>
      ${x.r ? `<text x="${cx - b / 2 - 1}" y="${y(x.r) - 4}" text-anchor="middle" font-size="13" fill="#7fa8f0">${x.r}</text>` : ""}${x.t ? `<text x="${cx + b / 2 + 1}" y="${y(x.t) - 4}" text-anchor="middle" font-size="13" fill="#4fd19f">${x.t}</text>` : ""}
      <text x="${cx}" y="${H - 6}" text-anchor="middle" font-size="13" fill="${x.we ? "var(--text-dim)" : "var(--text)"}" font-weight="${x.k === auj ? 800 : 400}">${x.j} ${x.n}</text>`; }).join("")}</svg>`;

  // Activité en direct : dernières demandes modifiées.
  const activite = st.demandes.filter(d => !d.supprimeeLe && !d.lieeA).map(d => ({ d, t: Math.max(ms(d.dateMaj), ms(d.importeLe)) })).filter(x => x.t).sort((a, b) => b.t - a.t).slice(0, 7);
  const qui = (d) => d.commentaireMajPar || d.validePar || d.declarePar || d.attribuePar || d.commentaireTechPar || "";

  // Catégories des demandes ouvertes.
  const cats = {}; ouvertes.forEach(d => { const c = categorieDe(d); cats[c] = (cats[c] || 0) + 1; });
  const topCats = Object.entries(cats).sort((a, b) => b[1] - a[1]).slice(0, 6);

  // Équipe.
  const absDe = (n) => st.absences.find(a => sa(a.person) === sa(n) && String(a.start || "").slice(0, 10) <= auj && String(a.end || a.start || "").slice(0, 10) >= auj);
  const absents = st.absences.filter(a => String(a.start || "").slice(0, 10) <= auj && String(a.end || a.start || "").slice(0, 10) >= auj);
  const TYP = { conge: "🌴 Congé", rtt: "🕒 RTT", arret: "🤒 Arrêt", enfant: "🧒 Enfant malade" };
  const ast = astreinte();

  // Alertes.
  const alertes = [];
  if (st.interv.length) alertes.push(["🕓", `${st.interv.length} intervention${st.interv.length > 1 ? "s" : ""} d'astreinte à compléter (horaires)`, "astreinte"]);
  if (nbValider) alertes.push(["✅", `${nbValider} demande${nbValider > 1 ? "s" : ""} réalisée${nbValider > 1 ? "s" : ""} à valider`, "valider"]);
  if (aAttribuer.length) alertes.push(["🆕", `${aAttribuer.length} demande${aAttribuer.length > 1 ? "s" : ""} à attribuer`, "suivi"]);
  const immed = l.filter(d => d.actionImmediate && d.actionPour && !d.actionFaiteLe && !ferme(d));
  if (immed.length) alertes.push(["🚨", `${immed.length} action${immed.length > 1 ? "s" : ""} immédiate${immed.length > 1 ? "s" : ""} pas encore faite${immed.length > 1 ? "s" : ""} (${[...new Set(immed.map(d => d.actionPourNom).filter(Boolean))].map(esc).join(", ")})`, "suivi"]);
  if (vieilles) alertes.push(["⏳", `${vieilles} demande${vieilles > 1 ? "s" : ""} ouverte${vieilles > 1 ? "s" : ""} depuis plus de 30 jours`, "a-traiter"]);
  if (st.compteurs?.n) alertes.push(["🎛️", `${st.compteurs.n} compteur${st.compteurs.n > 1 ? "s" : ""} ${st.compteurs.mot}`, "compteurs"]);
  if (st.stock?.total) alertes.push(["📦", `${st.stock.total} article${st.stock.total > 1 ? "s" : ""} de stock sous le seuil${st.stock.deporte ? ` (dont ${st.stock.deporte} en stock déporté)` : ""}`, "stock"]);

  // Ménage : fiches remplies aujourd'hui / cette semaine.
  const lundi = new Date(); lundi.setDate(lundi.getDate() - ((lundi.getDay() + 6) % 7)); const kLundi = iso(lundi);
  const parAgent = {};
  st.fiches.forEach(f => { const t = ms(f.majLe); if (!t || !f.agentNom) return; const k = f.agentNom; const a = parAgent[k] || (parAgent[k] = { auj: 0, sem: 0, der: 0 });
    if (iso(new Date(t)) === auj) a.auj++; if (String(f.weekStart || "").slice(0, 10) === kLundi) a.sem++; if (t > a.der) a.der = t; });
  const agents = Object.entries(parAgent).filter(([, a]) => a.sem || a.auj).sort((a, b) => b[1].der - a[1].der);

  const kpi = (v, lib, c, go, alerte) => `<button type="button" class="td-kpi ${alerte ? "alerte" : ""}" style="--c:${c}" data-go="${go}"><b>${v}</b><span>${lib}</span></button>`;
  conteneur.innerHTML = `<div class="td">
    <div class="td-tete"><h2>🛰️ Tableau de bord <span class="td-live">● en direct</span></h2><span>${maintenant.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })} · ${maintenant.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</span></div>
    <div class="td-kpis">
      ${kpi(ouvertes.length, "demandes ouvertes", "#3b7be0", "a-traiter")}
      ${kpi(urg.length, "urgentes / critiques", "#e5533d", "urgentes", urg.length)}
      ${kpi(aAttribuer.length, "à attribuer", "#d9b24c", "suivi", aAttribuer.length)}
      ${kpi(nbValider, "à valider", "#8b7cf0", "valider", nbValider)}
      ${kpi(recuesAuj.length, "reçues aujourd'hui", "#5b9bd5", "suivi")}
      ${kpi(traiteesAuj.length, "réalisées aujourd'hui", "#1baf7a", "suivi")}
    </div>
    <div class="td-grille">
      <section class="td-carte td-alertes"><h3>⚠️ À surveiller</h3>
        ${alertes.length ? alertes.map(([ic, t, go]) => `<button type="button" class="td-al" data-go="${go}"><span>${ic}</span>${t}<em>›</em></button>`).join("") : `<p class="td-ok">👌 Rien d'urgent à signaler.</p>`}
      </section>
      <section class="td-carte"><h3>👥 Équipe aujourd'hui</h3>
        ${ast ? `<div class="td-ast"><span>📞 Astreinte</span><b>N1 ${esc(ast.n1 || "—")}</b>${tel(ast.n1) ? `<a href="tel:${esc(tel(ast.n1).replace(/[^\d+]/g, ""))}">${esc(tel(ast.n1))}</a>` : ""}${ast.n2 ? `<b>N2 ${esc(ast.n2)}</b>${tel(ast.n2) ? `<a href="tel:${esc(tel(ast.n2).replace(/[^\d+]/g, ""))}">${esc(tel(ast.n2))}</a>` : ""}` : ""}</div>` : ""}
        ${absents.length ? `<div class="td-abs">${absents.map(a => `<div><b>${esc(a.person || "")}</b><span>${TYP[a.type] || TYP.conge}</span><em>jusqu'au ${new Date(String(a.end || a.start).slice(0, 10) + "T12:00").toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}</em></div>`).join("")}</div>` : `<p class="td-ok">✅ Toute l'équipe est là.</p>`}
        <button type="button" class="td-lien" data-go="equipe">Voir l'équipe ›</button>
      </section>
      <section class="td-carte td-urg"><h3>🚨 Urgences en cours <b>${urg.length}</b></h3>
        ${urg.length ? urg.slice(0, 8).map(d => `<button type="button" class="td-ligne" data-dem="${esc(d.id)}" data-site="${esc(d.site || "")}"><i class="${urgence(d) === "Critique" ? "crit" : "urg"}"></i><b>${esc(d.site || "")}</b><span>${esc(String(d.descriptifCorrige || d.descriptif || "").slice(0, 90))}</span><em>${d.attribueANom ? esc(d.attribueANom) : "<u>non attribuée</u>"} · ${age(d) ?? "?"} j</em></button>`).join("") + (urg.length > 8 ? `<button type="button" class="td-lien" data-go="urgentes">+ ${urg.length - 8} autres ›</button>` : "") : `<p class="td-ok">👌 Aucune urgence ouverte.</p>`}
      </section>
      <section class="td-carte"><h3>👷 Charge en cours <small>demandes ouvertes</small></h3>
        ${lignesCharge.map(([k, c]) => `<div class="td-ch"><span>${esc(k)}</span><div><i style="width:${Math.round(c.n / maxC * 100)}%"></i></div><b>${c.n}</b>${c.u ? `<em>🚨 ${c.u}</em>` : "<em></em>"}</div>`).join("") || `<p class="td-ok">Aucune demande ouverte.</p>`}
      </section>
      <section class="td-carte td-large"><h3>📈 Reçues / réalisées — ${NJ} derniers jours <span class="td-leg"><i style="background:#3b7be0"></i>Reçues <i style="background:#1baf7a"></i>Traitées</span></h3>${graph}</section>
      <section class="td-carte"><h3>⚡ Activité en direct</h3>
        ${activite.map(({ d, t }) => `<button type="button" class="td-ligne act" data-dem="${esc(d.id)}" data-site="${esc(d.site || "")}"><b>${esc(d.numero ? `${d.numero}` : "")} · ${esc(d.site || "")}</b><span>${esc(d.statut || "Nouvelle")}${qui(d) ? ` — ${esc(qui(d))}` : ""}</span><em>${depuis(t)}</em></button>`).join("")}
      </section>
      <section class="td-carte"><h3>🧩 Types de pannes en cours</h3>
        ${topCats.map(([id, n]) => { const c = infoCategorie(id); return `<div class="td-ch cat"><span>${c.ic} ${esc(c.lib)}</span><div><i style="width:${Math.round(n / Math.max(1, topCats[0][1]) * 100)}%;background:${c.c}"></i></div><b>${n}</b><em></em></div>`; }).join("") || `<p class="td-ok">—</p>`}
      </section>
      <section class="td-carte"><h3>🧽 Ménage — fiches de traçabilité</h3>
        ${agents.length ? agents.map(([n, a]) => `<div class="td-men"><b>${esc(n)}</b><span>${a.auj} aujourd'hui · ${a.sem} cette semaine</span><em>${depuis(a.der)}</em></div>`).join("") : `<p class="td-ok">Aucune fiche remplie cette semaine.</p>`}
      </section>
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
.td{display:flex;flex-direction:column;gap:14px}
.td-tete{display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:6px}
.td-tete h2{margin:0;font-size:20px}.td-tete>span{color:var(--text-dim);font-size:13px;text-transform:capitalize}
.td-live{font-size:12px;color:#1baf7a;font-weight:600;margin-left:6px;animation:td-pulse 2s infinite}
@keyframes td-pulse{50%{opacity:.4}}
.td-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}
.td-kpi{background:var(--panel);border:1px solid var(--border);border-left:5px solid var(--c);border-radius:12px;padding:12px 14px;text-align:left;cursor:pointer;color:var(--text);display:flex;flex-direction:column;gap:2px;font:inherit}
.td-kpi b{font-size:30px;line-height:1.1;color:var(--c)}.td-kpi span{font-size:12.5px;color:var(--text-dim)}
.td-kpi.alerte{background:color-mix(in srgb,var(--c) 10%,var(--panel))}
.td-kpi:hover,.td-al:hover,.td-ligne:hover{filter:brightness(1.08)}
.td-grille{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:12px}
.td-carte{background:var(--panel);border:1px solid var(--border);border-radius:14px;padding:14px;display:flex;flex-direction:column;gap:6px;min-width:0}
.td-carte h3{margin:0 0 6px;font-size:14.5px;color:var(--gold);display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.td-carte h3 b{background:var(--red);color:#fff;border-radius:10px;padding:0 8px;font-size:12px}.td-carte h3 small{color:var(--text-dim);font-weight:500}
.td-large{grid-column:1/-1}.td-svg{width:100%;height:auto}
.td-leg{margin-left:auto;font-size:12px;color:var(--text-dim);font-weight:500;display:flex;align-items:center;gap:4px}.td-leg i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-left:8px}
.td-ok{color:var(--text-dim);margin:4px 0;font-size:13.5px}
.td-al{display:flex;align-items:center;gap:8px;background:var(--panel-alt);border:1px solid var(--border);border-radius:9px;padding:8px 10px;color:var(--text);font:inherit;font-size:13.5px;text-align:left;cursor:pointer}
.td-al em{margin-left:auto;color:var(--text-dim);font-style:normal}
.td-ast{display:flex;flex-wrap:wrap;gap:4px 10px;align-items:center;background:var(--panel-alt);border-radius:9px;padding:8px 10px;font-size:13.5px}.td-ast span{color:var(--text-dim);width:100%;font-size:12px}.td-ast a{color:var(--teal);font-size:12.5px}
.td-abs>div{display:grid;grid-template-columns:1fr auto;gap:0 8px;border-left:4px solid #f08a24;padding:5px 9px;margin:4px 0;background:var(--panel-alt);border-radius:0 8px 8px 0;font-size:13.5px}
.td-abs span{color:var(--text-dim);font-size:12.5px}.td-abs em{grid-column:1/-1;font-size:12px;color:var(--text-dim)}
.td-lien{align-self:flex-start;background:none;border:0;color:var(--teal);cursor:pointer;font:inherit;font-size:13px;padding:2px 0}
.td-ligne{display:grid;grid-template-columns:10px 1fr auto;grid-template-areas:"i b e" "i s s";gap:1px 8px;text-align:left;background:var(--panel-alt);border:1px solid var(--border);border-radius:9px;padding:7px 10px;color:var(--text);font:inherit;font-size:13px;cursor:pointer}
.td-ligne i{grid-area:i;border-radius:4px}.td-ligne i.crit{background:#b91c1c}.td-ligne i.urg{background:#e5533d}
.td-ligne b{grid-area:b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.td-ligne span{grid-area:s;color:var(--text-dim);font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.td-ligne em{grid-area:e;font-style:normal;color:var(--text-dim);font-size:12px;white-space:nowrap}.td-ligne em u{color:var(--gold);text-decoration:none;font-weight:600}
.td-ligne.act{grid-template-columns:1fr auto;grid-template-areas:"b e" "s s"}
.td-ch{display:grid;grid-template-columns:minmax(110px,1.2fr) 2fr 30px 44px;align-items:center;gap:8px;font-size:13px}
.td-ch span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.td-ch div{height:9px;background:var(--panel-alt);border-radius:5px;overflow:hidden}
.td-ch i{display:block;height:100%;background:#3b7be0;border-radius:5px}.td-ch b{text-align:right}.td-ch em{font-style:normal;font-size:12px;color:var(--red)}
.td-men{display:grid;grid-template-columns:1fr auto;gap:0 8px;background:var(--panel-alt);border-radius:9px;padding:7px 10px;font-size:13.5px}.td-men span{color:var(--text-dim);font-size:12.5px}.td-men em{grid-row:1/3;grid-column:2;align-self:center;font-style:normal;font-size:12px;color:#1baf7a}
@media (max-width:560px){.td-grille{grid-template-columns:1fr}.td-kpi b{font-size:24px}}
</style>`;

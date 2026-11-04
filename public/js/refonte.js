// refonte.js — Nouvel accueil (version TEST /beta uniquement).
// Ligne conductrice : tout part d'un LIEU (Sites) ou d'une PERSONNE (Équipe), le reste est rangé en espaces.
//   • une recherche unique (demandes, sites, personnes, clés, compteurs) ;
//   • « Aujourd'hui » : ce qui demande une action ;
//   • 5 espaces (Sites & bâtiments, Demandes & interventions, Équipe, Stocks, Pilotage) + Outils ;
//   • une « fiche site 360° » qui rassemble tout ce qui concerne un site.
// Uniquement des écoutes déjà partagées par l'appli : rien de plus lu dans Firestore.
import { esc } from "./astreinte-logic.js";
import { watchDemandes, watchAbsences, watchPeople } from "./firestore-data.js";
import { watchSitesDossiers } from "./site-dossier-data.js";
import { watchCoordonnees } from "./coordonnees-data.js";
import { memeSite } from "./suivi-demandes-sites.js";
import { nomPropre } from "./sites-visuel.js";

const ESPACES = [
  { id: "sites", ic: "🏢", titre: "Sites & bâtiments", sous: "Dossiers, plans, clés, compteurs, logements", c: "#3b82f6",
    cats: ["sites", "compteurs", "cles", "masterlock", "logements", "durete-eau", "espaces-verts"] },
  { id: "demandes", ic: "🔧", titre: "Demandes & interventions", sous: "Demandes, astreinte, travaux", c: "#f59e0b",
    cats: ["suivi-demandes", "astreinte", "previsionnel", "ecran-atelier", "equipe-terrain"] },
  { id: "equipe", ic: "👥", titre: "Équipe", sous: "Absences, plannings, ménage, coordonnées", c: "#10b981",
    cats: ["equipe", "planning-individuel", "mon-planning", "fiches-poste"], prefixes: ["disp-"] },
  { id: "stocks", ic: "📦", titre: "Stocks", sous: "Atelier, ménage, stock déporté", c: "#8b5cf6",
    cats: ["stock", "stock-menage", "stock-deporte"] },
  { id: "pilotage", ic: "📊", titre: "Pilotage", sous: "Tableau de bord, statistiques", c: "#ef4444",
    cats: ["direct", "statistiques", "taches"] },
];
const sa = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const ferme = (d) => /^(realis|annul)/.test(sa(d.statut)) || d.statut === "Réalisé – à valider";
const valide = (d) => !d.lieeA && !d.supprimeeLe && !sa(d.statut).startsWith("arbitrage");
const urgent = (d) => ["Urgent", "Critique"].includes(d.urgenceCorrigee || d.urgence);
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

let unsubs = [], ctx = null;
const st = { demandes: null, sites: [], absences: [], people: null, coord: {}, compteurs: [], cles: [], q: "", site: null };

export function refonteActive() { try { return location.pathname.startsWith("/beta") && localStorage.getItem("refonte-off") !== "1"; } catch { return false; } }

export function mountRefonte(container, user, cats, ouvrir) {
  unsubs.forEach(u => { try { u(); } catch { /* */ } }); unsubs = [];
  ctx = { container, user, cats, ouvrir };
  if (!document.getElementById("rf-style")) document.head.insertAdjacentHTML("beforeend", STYLE);
  const voit = (id) => cats.some(c => c.id === id);
  container.addEventListener("click", clic);
  container.addEventListener("input", (e) => { if (e.target.matches("[data-rf-q]")) { st.q = e.target.value; rendreRecherche(); } });
  render();
  const r = () => { if (document.contains(container)) render(); };
  if (voit("suivi-demandes")) unsubs.push(watchDemandes((l) => { st.demandes = l || []; r(); }));
  unsubs.push(watchSitesDossiers((l) => { st.sites = l || []; r(); }));
  unsubs.push(watchAbsences((a) => { st.absences = a || []; r(); }));
  unsubs.push(watchPeople((p) => { st.people = p; r(); }));
  unsubs.push(watchCoordonnees((c) => { st.coord = c || {}; r(); }));
  if (voit("compteurs")) import("./compteurs-data.js").then(m => unsubs.push(m.watchCompteursListe((l) => { st.compteurs = (l || []).map(c => ({ ...c, retard: m.estEnRetard(c) })); r(); }))).catch(() => {});
  if (voit("cles")) import("./cles-data.js").then(m => unsubs.push(m.watchCles((l) => { st.cles = (l || []).filter(c => !c.supprimeLe); r(); }, () => {}))).catch(() => {});
}

// ---------- Rendu ----------
function render() {
  const { container, user, cats } = ctx; if (!container || !document.contains(container)) return;
  if (st.site) { renderSite(); return; }
  const focus = document.activeElement?.matches?.("[data-rf-q]");
  const auj = iso(new Date()), prenom = String(user.displayName || user.nom || window.__smmNom || "").split(" ")[0];
  const dem = (st.demandes || []).filter(valide), ouvertes = dem.filter(d => !ferme(d));
  const urg = ouvertes.filter(urgent), aValider = dem.filter(d => d.statut === "Réalisé – à valider").length;
  const aAttribuer = ouvertes.filter(d => !d.attribueA && (d.importeLe?.toMillis?.() || 0) >= new Date("2026-10-01").getTime()).length;
  const absents = st.absences.filter(a => String(a.start || "").slice(0, 10) <= auj && String(a.end || a.start || "").slice(0, 10) >= auj);
  const compteursRetard = st.compteurs.filter(c => c.retard).length;
  const gestion = ["super_admin", "admin", "n1"].includes(user.role);
  const puce = (n, lib, c, go) => `<button class="rf-puce" style="--c:${c}" data-go="${go}"><b>${n}</b><span>${lib}</span></button>`;
  const placees = new Set();
  const espaces = ESPACES.map(e => { const l = cats.filter(c => e.cats.includes(c.id) || (e.prefixes || []).some(p => c.id.startsWith(p))); l.forEach(c => placees.add(c.id)); return { ...e, l }; }).filter(e => e.l.length);
  const autres = cats.filter(c => !placees.has(c.id));
  // Sites : demandes ouvertes rapprochées par nom.
  const parSite = st.sites.map(s => { const d = ouvertes.filter(x => memeSite(x.site, s.nom)); return { s, n: d.length, u: d.filter(urgent).length, cpt: st.compteurs.filter(c => c.dossierId === s.id && c.retard).length }; })
    .sort((a, b) => (b.u - a.u) || (b.n - a.n) || (a.s.nom || "").localeCompare(b.s.nom || ""));
  container.innerHTML = `<div class="rf">
    <header class="rf-tete">
      <div><h1>Bonjour${prenom ? ` ${esc(prenom)}` : ""} 👋</h1><p>${new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}</p></div>
      <button class="rf-lien" data-classique>↩ Ancien accueil</button>
    </header>
    <div class="rf-rech"><input data-rf-q type="search" autocomplete="off" placeholder="🔍 Rechercher : une demande, un site, une personne, une clé, un compteur…" value="${esc(st.q)}"><div class="rf-res" data-rf-res></div></div>
    <section class="rf-auj">
      ${st.demandes ? puce(urg.length, "urgences en cours", "#ef4444", "urgentes") : ""}
      ${st.demandes && gestion ? puce(aAttribuer, "à attribuer", "#f59e0b", "suivi") : ""}
      ${st.demandes && gestion ? puce(aValider, "à valider", "#8b5cf6", "valider") : ""}
      ${puce(absents.length, absents.length > 1 ? "absents aujourd'hui" : "absent aujourd'hui", "#10b981", "equipe")}
      ${st.compteurs.length ? puce(compteursRetard, "compteurs à relever", "#0ea5e9", "compteurs") : ""}
    </section>
    <h2 class="rf-h2">Espaces</h2>
    <section class="rf-esp">${espaces.map(e => `<article class="rf-carte" style="--c:${e.c}">
        <div class="rf-ct"><span class="rf-ic">${e.ic}</span><div><h3>${e.titre}</h3><p>${e.sous}</p></div></div>
        <div class="rf-mods">${e.l.map(c => `<button data-cat="${esc(c.id)}">${c.iconHTML ? "🎛️" : esc(c.icon || "")} ${esc(c.label)}${c.badge ? `<i>${c.badge}</i>` : ""}</button>`).join("")}</div>
      </article>`).join("")}
      ${autres.length ? `<article class="rf-carte" style="--c:#64748b"><div class="rf-ct"><span class="rf-ic">🧰</span><div><h3>Outils</h3><p>Administration et outils divers</p></div></div>
        <div class="rf-mods">${autres.map(c => `<button data-cat="${esc(c.id)}">${c.iconHTML ? "🎛️" : esc(c.icon || "")} ${esc(c.label)}</button>`).join("")}</div></article>` : ""}
    </section>
    ${cats.some(c => c.id === "sites") && st.sites.length ? `<h2 class="rf-h2">Sites <small>tout sur un site, en un clic</small></h2>
    <section class="rf-sites">${parSite.map(({ s, n, u, cpt }) => `<button class="rf-site" data-site="${esc(s.id)}">
        <b>${esc(nomPropre(s.nom))}</b><small>${esc(s.association || "")}</small>
        <span>${n ? `<i class="d">${n} demande${n > 1 ? "s" : ""}</i>` : `<i class="ok">✓ rien en cours</i>`}${u ? `<i class="u">🚨 ${u}</i>` : ""}${cpt ? `<i class="c">🎛️ ${cpt}</i>` : ""}</span></button>`).join("")}</section>` : ""}
  </div>`;
  if (focus) { const q = container.querySelector("[data-rf-q]"); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
  rendreRecherche();
}

function rendreRecherche() {
  const box = ctx.container.querySelector("[data-rf-res]"); if (!box) return;
  const mots = sa(st.q).split(/\s+/).filter(Boolean);
  if (!mots.length) { box.hidden = true; box.innerHTML = ""; return; }
  const ok = (t) => { const s = sa(t); return mots.every(m => s.includes(m)); };
  const grp = [];
  const sites = st.sites.filter(s => ok(`${s.nom} ${s.adresse || ""} ${s.association || ""}`)).slice(0, 5);
  if (sites.length) grp.push(["🏢 Sites", sites.map(s => `<button data-site="${esc(s.id)}"><b>${esc(nomPropre(s.nom))}</b><span>${esc(s.adresse || s.association || "")}</span></button>`)]);
  const dem = (st.demandes || []).filter(d => !d.supprimeeLe && ok(`${d.numero} ${d.site} ${d.local || ""} ${d.descriptifCorrige || d.descriptif} ${d.attribueANom || ""} ${d.intervenant || ""}`))
    .sort((a, b) => ferme(a) - ferme(b)).slice(0, 7);
  if (dem.length) grp.push(["📄 Demandes", dem.map(d => `<button data-dem="${esc(d.id)}" data-dsite="${esc(d.site || "")}"><b>${esc(d.numero || "")} · ${esc(d.site || "")}</b><span>${esc(String(d.descriptifCorrige || d.descriptif || "").slice(0, 90))}</span><em class="${ferme(d) ? "" : urgent(d) ? "u" : "o"}">${esc(d.statut || "Nouvelle")}</em></button>`)]);
  const pers = Object.entries(st.coord).filter(([n, c]) => ok(`${n} ${c.fonction || ""}`)).slice(0, 5);
  if (pers.length) grp.push(["👤 Personnes", pers.map(([n, c]) => { const t = c.telephone || (Array.isArray(c.telephones) ? c.telephones.find(x => x.numero)?.numero : ""); return `<a ${t ? `href="tel:${esc(String(t).replace(/[^\d+]/g, ""))}"` : `data-go="equipe"`}><b>${esc(n)}</b><span>${esc(c.fonction || "")}${t ? ` · 📞 ${esc(t)}` : ""}</span></a>`; })]);
  const cles = st.cles.filter(c => ok(`${c.nom} ${c.numero || ""} ${c.site || c.siteNom || ""} ${c.porte || ""}`)).slice(0, 5);
  if (cles.length) grp.push(["🔑 Clés & badges", cles.map(c => `<button data-cat="cles"><b>${esc(c.nom || c.numero || "")}</b><span>${esc(c.siteNom || c.site || "")}${c.type ? ` · ${esc(c.type)}` : ""}</span></button>`)]);
  const cpt = st.compteurs.filter(c => ok(`${c.nom} ${c.dossierNom || ""} ${c.type || ""}`)).slice(0, 5);
  if (cpt.length) grp.push(["🎛️ Compteurs", cpt.map(c => `<button data-cpt="${esc(c.dossierId || "")}"><b>${esc(c.nom || "")}</b><span>${esc(nomPropre(c.dossierNom || ""))}${c.retard ? " · à relever" : ""}</span></button>`)]);
  const mods = ctx.cats.filter(c => ok(`${c.label} ${c.desc || ""}`)).slice(0, 4);
  if (mods.length) grp.push(["🧭 Aller à", mods.map(c => `<button data-cat="${esc(c.id)}"><b>${esc(c.icon || "")} ${esc(c.label)}</b><span>${esc(c.desc || "")}</span></button>`)]);
  box.hidden = false;
  box.innerHTML = grp.length ? grp.map(([t, l]) => `<div class="rf-grp"><h4>${t}</h4>${l.join("")}</div>`).join("") : `<p class="rf-vide">Aucun résultat pour « ${esc(st.q)} ».</p>`;
}

// ---------- Fiche site 360° ----------
function renderSite() {
  const { container, user, cats } = ctx, s = st.sites.find(x => x.id === st.site);
  if (!s) { st.site = null; render(); return; }
  const voit = (id) => cats.some(c => c.id === id);
  const dem = (st.demandes || []).filter(d => valide(d) && memeSite(d.site, s.nom));
  const ouv = dem.filter(d => !ferme(d)).sort((a, b) => urgent(b) - urgent(a));
  const faites = dem.filter(d => /^realis/.test(sa(d.statut))).sort((a, b) => String(b.dateIntervention || "").localeCompare(String(a.dateIntervention || ""))).slice(0, 5);
  const cpt = st.compteurs.filter(c => c.dossierId === s.id);
  const cles = st.cles.filter(c => c.dossierId === s.id || c.siteId === s.id || (c.site && memeSite(c.site, s.nom)));
  const contacts = (s.sections || []).flatMap(sec => (sec.champs || sec.items || []).filter(ch => /t[ée]l|contact|responsable|gardien/i.test(ch.label || ch.titre || "") && (ch.valeur || ch.value)).map(ch => [ch.label || ch.titre, ch.valeur || ch.value])).slice(0, 4);
  const action = (ic, lib, data, montre = true) => montre ? `<button class="rf-act" ${data}>${ic}<span>${lib}</span></button>` : "";
  container.innerHTML = `<div class="rf rf-fiche">
    <button class="rf-retour" data-retour>‹ Tous les sites</button>
    <header class="rf-st"><div><h1>🏢 ${esc(nomPropre(s.nom))}</h1><p>${esc([s.association, s.adresse].filter(Boolean).join(" · "))}</p></div></header>
    <section class="rf-auj">
      <div class="rf-puce" style="--c:#f59e0b"><b>${ouv.length}</b><span>demandes en cours</span></div>
      <div class="rf-puce" style="--c:#ef4444"><b>${ouv.filter(urgent).length}</b><span>urgentes</span></div>
      ${cpt.length ? `<div class="rf-puce" style="--c:#0ea5e9"><b>${cpt.filter(c => c.retard).length} / ${cpt.length}</b><span>compteurs à relever</span></div>` : ""}
      ${cles.length ? `<div class="rf-puce" style="--c:#8b5cf6"><b>${cles.length}</b><span>clés & badges</span></div>` : ""}
    </section>
    <section class="rf-acts">
      ${action("📁", "Dossier du site", `data-dossier="${esc(s.id)}"`, voit("sites"))}
      ${action("📄", "Demandes du site", `data-dsite-tout="${esc(s.nom)}"`, voit("suivi-demandes"))}
      ${action("🔑", "Plan des clés", `data-plancles="${esc(s.id)}"`)}
      ${action("🎛️", "Compteurs", `data-cpt="${esc(s.id)}"`, voit("compteurs") && cpt.length > 0)}
      ${action("🔐", "Codes Masterlock", `data-cat="masterlock"`, voit("masterlock"))}
      ${action("🗝️", "Prêts de clés", `data-cat="cles"`, voit("cles"))}
    </section>
    <div class="rf-2col">
      <section class="rf-bloc"><h3>📄 En cours <b>${ouv.length}</b></h3>
        ${ouv.length ? ouv.slice(0, 12).map(d => `<button class="rf-ligne" data-dem="${esc(d.id)}" data-dsite="${esc(d.site || "")}"><i class="${urgent(d) ? "u" : ""}"></i><div><b>${esc(d.numero || "")}${d.local ? ` · ${esc(d.local)}` : ""}</b><span>${esc(String(d.descriptifCorrige || d.descriptif || ""))}</span></div><em>${esc(d.attribueANom || "à attribuer")}</em></button>`).join("") : `<p class="rf-vide">👌 Rien en cours sur ce site.</p>`}
        ${ouv.length > 12 ? `<button class="rf-lien" data-dsite-tout="${esc(s.nom)}">Voir les ${ouv.length} demandes ›</button>` : ""}
      </section>
      <div>
        ${cpt.length ? `<section class="rf-bloc"><h3>🎛️ Compteurs</h3>${cpt.map(c => `<div class="rf-cpt"><b>${esc(c.nom || "")}</b><span class="${c.retard ? "r" : "ok"}">${c.retard ? "à relever" : "✓ à jour"}</span></div>`).join("")}</section>` : ""}
        ${faites.length ? `<section class="rf-bloc"><h3>✅ Dernières réalisées</h3>${faites.map(d => `<button class="rf-ligne" data-dem="${esc(d.id)}" data-dsite="${esc(d.site || "")}"><i class="ok"></i><div><b>${esc(d.numero || "")}</b><span>${esc(String(d.descriptifCorrige || d.descriptif || ""))}</span></div><em>${d.dateIntervention ? new Date(String(d.dateIntervention).slice(0, 10) + "T12:00").toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : ""}</em></button>`).join("")}</section>` : ""}
        ${contacts.length ? `<section class="rf-bloc"><h3>📞 Contacts</h3>${contacts.map(([l, v]) => `<div class="rf-cpt"><b>${esc(l)}</b><span>${esc(v)}</span></div>`).join("")}</section>` : ""}
      </div>
    </div>
  </div>`;
  window.scrollTo(0, 0);
}

// ---------- Navigation ----------
function clic(e) {
  const { ouvrir, user } = ctx, b = e.target.closest("button,a"); if (!b || !ctx.container.contains(b)) return;
  const d = b.dataset;
  if (d.classique !== undefined) { try { localStorage.setItem("refonte-off", "1"); } catch { /* */ } location.reload(); return; }
  if (d.retour !== undefined) { st.site = null; render(); return; }
  if (d.site) { st.site = d.site; st.q = ""; render(); return; }
  if (d.cat) { ouvrir(d.cat); return; }
  if (d.dem) { window.__suiviOuvrir = { id: d.dem, site: d.dsite }; ouvrir("suivi-demandes"); return; }
  if (d.dsiteTout) { window.__suiviSite = d.dsiteTout; ouvrir("suivi-demandes"); return; }
  if (d.dossier) { ouvrir("sites", d.dossier); return; }
  if (d.cpt !== undefined) { if (d.cpt) window.compteursRapideSiteDeepLinkId = d.cpt; ouvrir("compteurs"); return; }
  if (d.plancles) { const s = st.sites.find(x => x.id === d.plancles); import("./plan-cles.js").then(m => m.ouvrirPlanCles({ dossier: { id: s.id, nom: s.nom }, user, editeur: ["super_admin", "admin", "n1"].includes(user.role) && !user.lectureSeule })); return; }
  if (d.go) {
    if (["urgentes", "valider"].includes(d.go)) { window.__suiviRaccourci = d.go; ouvrir("suivi-demandes"); }
    else if (d.go === "suivi") ouvrir("suivi-demandes");
    else ouvrir(d.go);
  }
}

const STYLE = `<style id="rf-style">
.rf{display:flex;flex-direction:column;gap:18px;max-width:1200px;margin:0 auto}
.rf-tete{display:flex;align-items:flex-end;justify-content:space-between;gap:10px;flex-wrap:wrap}
.rf-tete h1,.rf-st h1{margin:0;font-size:26px;letter-spacing:-.02em}.rf-tete p,.rf-st p{margin:4px 0 0;color:var(--text-dim);text-transform:capitalize}.rf-st p{text-transform:none}
.rf-lien{background:none;border:0;color:var(--teal);font:inherit;font-size:13px;cursor:pointer;padding:4px 0}
.rf-rech{position:relative}.rf-rech input{width:100%;box-sizing:border-box;font:inherit;font-size:16px;padding:14px 18px;border-radius:14px;border:1px solid var(--border);background:var(--panel);color:var(--text);box-shadow:0 4px 18px rgba(0,0,0,.08)}
.rf-rech input:focus{outline:none;border-color:#3b82f6;box-shadow:0 0 0 4px rgba(59,130,246,.2)}
.rf-res{position:absolute;left:0;right:0;top:calc(100% + 6px);z-index:60;background:var(--panel);border:1px solid var(--border);border-radius:14px;box-shadow:0 20px 50px rgba(0,0,0,.3);max-height:65vh;overflow:auto;padding:8px}
.rf-grp h4{margin:8px 8px 4px;font-size:12px;color:var(--text-dim);text-transform:uppercase;letter-spacing:.05em}
.rf-grp button,.rf-grp a{all:unset;cursor:pointer;display:grid;grid-template-columns:1fr auto;gap:1px 10px;padding:8px 10px;border-radius:9px;width:100%;box-sizing:border-box;color:var(--text)}
.rf-grp button:hover,.rf-grp a:hover{background:var(--panel-alt)}.rf-grp b{font-size:14px}.rf-grp span{grid-row:2;font-size:12.5px;color:var(--text-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rf-grp em{grid-row:1/3;grid-column:2;align-self:center;font-style:normal;font-size:12px;color:var(--text-dim)}.rf-grp em.u{color:#ef4444;font-weight:700}.rf-grp em.o{color:#3b82f6;font-weight:600}
.rf-vide{color:var(--text-dim);margin:6px 8px;font-size:14px}
.rf-auj{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.rf-puce{all:unset;cursor:pointer;box-sizing:border-box;background:var(--panel);border:1px solid var(--border);border-left:5px solid var(--c);border-radius:12px;padding:10px 14px;display:flex;flex-direction:column}
div.rf-puce{cursor:default}.rf-puce b{font-size:26px;color:var(--c);line-height:1.1}.rf-puce span{font-size:12.5px;color:var(--text-dim)}
.rf-h2{margin:6px 0 -6px;font-size:16px}.rf-h2 small{font-weight:400;color:var(--text-dim);font-size:13px;margin-left:6px}
.rf-esp{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px}
.rf-carte{background:var(--panel);border:1px solid var(--border);border-top:4px solid var(--c);border-radius:16px;padding:14px 16px;display:flex;flex-direction:column;gap:12px}
.rf-ct{display:flex;gap:12px;align-items:center}.rf-ic{font-size:26px;width:46px;height:46px;border-radius:12px;display:grid;place-items:center;background:color-mix(in srgb,var(--c) 15%,transparent);flex:none}
.rf-ct h3{margin:0;font-size:16px}.rf-ct p{margin:2px 0 0;font-size:12.5px;color:var(--text-dim)}
.rf-mods{display:flex;flex-wrap:wrap;gap:6px}.rf-mods button{font:inherit;font-size:13px;padding:6px 10px;border-radius:9px;border:1px solid var(--border);background:var(--panel-alt);color:var(--text);cursor:pointer;display:inline-flex;gap:5px;align-items:center}
.rf-mods button:hover{border-color:var(--c)}.rf-mods i{font-style:normal;background:#ef4444;color:#fff;border-radius:99px;padding:0 6px;font-size:11px;font-weight:700}
.rf-sites{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px}
.rf-site{all:unset;cursor:pointer;box-sizing:border-box;background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:10px 12px;display:flex;flex-direction:column;gap:2px}
.rf-site:hover{border-color:#3b82f6}.rf-site b{font-size:14px}.rf-site small{font-size:11.5px;color:var(--text-dim)}.rf-site span{display:flex;gap:5px;flex-wrap:wrap;margin-top:4px}
.rf-site i{font-style:normal;font-size:11.5px;border-radius:99px;padding:1px 8px}.rf-site i.d{background:rgba(245,158,11,.15);color:#d97706}.rf-site i.u{background:rgba(239,68,68,.15);color:#ef4444}.rf-site i.c{background:rgba(14,165,233,.15);color:#0284c7}.rf-site i.ok{color:var(--text-dim)}
.rf-retour{align-self:flex-start;background:none;border:0;color:var(--teal);font:inherit;font-size:14px;cursor:pointer;padding:0}
.rf-acts{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}
.rf-act{font:inherit;display:flex;flex-direction:column;align-items:center;gap:4px;padding:14px 8px;border-radius:14px;border:1px solid var(--border);background:var(--panel);color:var(--text);cursor:pointer;font-size:24px}
.rf-act span{font-size:13px;font-weight:600}.rf-act:hover{border-color:#3b82f6;transform:translateY(-1px)}
.rf-2col{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);gap:12px;align-items:start}.rf-2col>div{display:flex;flex-direction:column;gap:12px}
.rf-bloc{background:var(--panel);border:1px solid var(--border);border-radius:14px;padding:12px 14px;display:flex;flex-direction:column;gap:2px}
.rf-bloc h3{margin:0 0 6px;font-size:14.5px;display:flex;gap:6px;align-items:center}.rf-bloc h3 b{background:#f59e0b;color:#fff;border-radius:99px;padding:0 8px;font-size:12px}
.rf-ligne{all:unset;cursor:pointer;display:flex;gap:10px;align-items:center;padding:7px 6px;border-radius:8px;border-top:1px solid var(--border)}.rf-ligne:first-of-type{border-top:0}.rf-ligne:hover{background:var(--panel-alt)}
.rf-ligne i{width:4px;align-self:stretch;border-radius:4px;background:#3b82f6;flex:none}.rf-ligne i.u{background:#ef4444}.rf-ligne i.ok{background:#10b981}
.rf-ligne div{flex:1;min-width:0;display:flex;flex-direction:column}.rf-ligne b{font-size:13.5px}.rf-ligne span{font-size:12.5px;color:var(--text-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.rf-ligne em{font-style:normal;font-size:12px;color:var(--text-dim);white-space:nowrap}
.rf-cpt{display:flex;justify-content:space-between;gap:8px;padding:6px 2px;border-top:1px solid var(--border);font-size:13.5px}.rf-cpt:first-of-type{border-top:0}.rf-cpt span{color:var(--text-dim)}.rf-cpt span.r{color:#ef4444;font-weight:600}.rf-cpt span.ok{color:#10b981}
@media (max-width:760px){.rf-2col{grid-template-columns:1fr}.rf-tete h1,.rf-st h1{font-size:21px}.rf-esp{grid-template-columns:1fr}.rf-sites{grid-template-columns:1fr 1fr}}
</style>`;

// menage-ponctuel.js — Traçabilité › « 🧽 Ménage ponctuel » (responsables).
// Faire passer une entreprise pour un gros ménage sur un site (ex. maison MNA
// de Saint-Gilles) : création de la mission + lien prestataire, puis suivi
// (arrivée / départ, pièces faites, photos avant / après, observations),
// vérification, validation et impression du compte rendu.
import { esc } from "./astreinte-logic.js";
import { watchInvitations } from "./invitations-data.js";
import { voirPhotos } from "./demandes-photos.js";
import { watchSites } from "./sites-data.js";
import { watchAssociations } from "./associations-data.js";
import { watchSitesDossiers } from "./site-dossier-data.js";
import { listerCodesPourSite } from "./masterlock-data.js";
import { watchPlans, piecesDuPlan, clePlan, tachesParDefaut, editeurPlanHTML, brancherEditeurPlan } from "./maison-plan.js";
import {
  creerMission, modifierMission, watchMissions, ecouterPhotosMission, majMission, accesMission, supprimerMission,
  passageOuvert, minutesPassees, fmtMin, nbFaits, pieceFaite, tachesFaites, statutMission, heureFr, jourFr, dateFr, lienMission,
} from "./menage-ponctuel-data.js";

let st = { missions: [], invs: {}, photos: [], plans: {} }, ui = { form: false, ouverte: null, draft: null };
const codesCache = {}; // dossierId → codes boîte à clés
let unsubs = [], unsubPh = null, phPour = null, cont = null, ctx = null;
const auj = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const plus = (iso, j) => { const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + j); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

const STYLE = `<style>
.mp{display:flex;flex-direction:column;gap:12px}
.mp-tete{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}
.mp-grille{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px}
.mp-carte{text-align:left;background:var(--panel);border:1px solid var(--border);border-radius:14px;padding:12px;cursor:pointer;display:flex;flex-direction:column;gap:5px;font:inherit;color:var(--text)}
.mp-carte:hover{border-color:#2f6fd6}.mp-carte b{font-size:15px}.mp-carte small{color:var(--text-dim)}
.mp-badge{align-self:flex-start;font-size:12px;font-weight:700;padding:3px 9px;border-radius:999px;background:var(--panel-alt)}
.mp-badge.encours{background:#fff0dc;color:#a85d00}.mp-badge.averifier{background:#e3edff;color:#1f4fa8}.mp-badge.validee{background:#e9f8f0;color:#11845b}.mp-badge.retard,.mp-badge.coupe{background:#fde8e8;color:#b02a2a}.mp-badge.commence{background:#fff8d6;color:#7a6200}
.mp-barre{height:7px;border-radius:5px;background:var(--panel-alt);overflow:hidden}.mp-barre i{display:block;height:100%;background:#1baf7a}
.mp-f{display:grid;grid-template-columns:1fr 1fr;gap:10px}.mp-f label{display:flex;flex-direction:column;gap:4px;font-size:13px;font-weight:600}
.mp-f input,.mp-f select,.mp-f textarea{padding:9px;border-radius:9px;border:1px solid var(--border);background:var(--panel-alt);color:var(--text);font:inherit}
.mp-f .plein{grid-column:1/-1}
.mp-pcs{display:flex;flex-wrap:wrap;gap:6px}.mp-pcs label{flex-direction:row;align-items:center;gap:6px;font-weight:500;background:var(--panel-alt);border:1px solid var(--border);border-radius:999px;padding:5px 10px}
.mp-lien{display:flex;gap:8px;flex-wrap:wrap;align-items:center;background:#e9f8f0;border:1px solid #bfe8d4;border-radius:12px;padding:10px;color:#11845b;font-weight:600}
.mp-piece{border-top:1px solid var(--border);padding:10px 0}.mp-piece:first-child{border-top:none}
.mp-ph{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}.mp-ph figure{margin:0;width:110px}.mp-ph img{width:110px;height:90px;object-fit:cover;border-radius:8px;cursor:pointer;display:block}
.mp-ph figcaption{font-size:11px;color:var(--text-dim)}.mp-av{color:#a85d00;font-weight:700}.mp-ap{color:#11845b;font-weight:700}
.mp-actions{display:flex;gap:8px;flex-wrap:wrap}.mp-niv{flex-basis:100%;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:#2f6fd6;margin-top:6px}.mp-mini-act{display:flex;gap:4px}.mp-mini-act .nav-btn{padding:3px 8px;font-size:13px}
@media (max-width:600px){.mp-f{grid-template-columns:1fr}}
</style>`;

export function mountMenagePonctuel(container, contexte) {
  unsubs.forEach(f => f()); unsubs = [];
  cont = container; ctx = contexte;
  unsubs.push(watchMissions((l) => { st.missions = l; render(); }));
  unsubs.push(watchPlans((p) => { st.plans = p || {}; render(); }));
  unsubs.push(watchInvitations((l) => { st.invs = Object.fromEntries(l.filter(x => x.type === "ponctuel").map(x => [x.id, x])); render(); }));
  render();
}

// Onglet « 🧽 Gros ménage » d'un dispositif (ex. Dispositif MNA) : ses sites seulement.
export function mountMenagePonctuelDispositif(container, user, dispositif) {
  // Tous les sites : maisons / sites ménage (avec leurs pièces) + sites des associations.
  mountMenagePonctuel(container, { dispositif, sites: [], assoc: [], user, tous: true });
  unsubs.push(watchSites((l) => { ctx.sites = (l || []).map(s => ({ ...s, groupe: s.dispositif || "Dispositif MNA" })); render(); }));
  unsubs.push(watchSitesDossiers((l) => { ctx.dossiers = l || []; render(); }));
  unsubs.push(watchAssociations((as) => { ctx.assoc = (as || []).flatMap(a => (a.sites || []).map(x => ({ id: `assoc:${a.nom}|${x.nom}`, name: x.nom, groupe: a.nom, sousGroupe: x.groupe || "", dispositif: a.nom, rooms: [] }))); render(); }));
}

function suivrePhotos(id) {
  if (id === phPour) return;
  if (unsubPh) unsubPh(); unsubPh = null; phPour = id; st.photos = [];
  if (id) unsubPh = ecouterPhotosMission(id, (p) => { st.photos = p; render(); });
}

// Comparaison souple des noms : « Maison MNA Saint Vincent de Paul » = « SVDP ».
const norm = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\b(maison|mna|la|le|les)\b/g, " ").replace(/[^a-z0-9]+/g, " ").replace(/\bst\b/g, "saint").replace(/\bste\b/g, "sainte").trim();
const sigle = (t) => norm(t).split(" ").filter(Boolean).map(w => w[0]).join("");
const memeSite = (a, b) => { const x = norm(a), y = norm(b); return !!x && !!y && (x === y || x.includes(y) || y.includes(x) || sigle(a) === y.replace(/ /g, "") || sigle(b) === x.replace(/ /g, "")); };
const estMna = (s) => /mna/i.test(s.groupe || "") || /mna/i.test(s.dispositif || "");
const sitesDispo = () => {
  // Maisons MNA : la liste de référence est celle des Dossiers de site (groupe « MNA »).
  // On reprend les pièces de la fiche ménage correspondante quand elle existe.
  const doss = /mna/i.test(ctx.dispositif || "") ? (ctx.dossiers || []).filter(d => /mna/i.test(d.groupe || "")) : [];
  if (doss.length) {
    const fiches = (ctx.sites || []).filter(estMna);
    return doss.map(d => { const f = fiches.find(m => memeSite(m.name, d.nom)); return { id: f?.id || `dossier:${d.id}`, dossierId: d.id, name: d.nom, groupe: ctx.dispositif, dispositif: ctx.dispositif, rooms: f?.rooms || [] }; })
      .sort((a, b) => String(a.name).localeCompare(String(b.name), "fr"));
  }
  const menage = (ctx.sites || []).filter(s => s && s.id);
  // Sites des associations absents des fiches ménage ; ceux du groupe « MNA » rejoignent le dispositif MNA.
  const autres = (ctx.assoc || []).filter(s => !menage.some(m => memeSite(m.name, s.name)))
    .map(s => /mna/i.test(s.sousGroupe || "") ? { ...s, groupe: menage.find(estMna)?.groupe || "Dispositif MNA" } : s);
  const tous = [...menage, ...autres], tri = (a, b) => String(a.name).localeCompare(String(b.name), "fr");
  const ici = tous.filter(s => s.groupe === ctx.dispositif || (/mna/i.test(ctx.dispositif || "") && estMna(s)));
  return ici.sort(tri); // uniquement les sites du dispositif (ex. les maisons MNA)
};
const missionsVisibles = () => ctx.tous ? st.missions : st.missions.filter(m => !ctx.dispositif || !m.dispositif || m.dispositif === ctx.dispositif);
// Liste déroulante groupée (dispositif courant d'abord, puis les autres, puis les associations).
function optionsSites(sel) {
  const g = []; sitesDispo().forEach(s => { const n = (/mna/i.test(ctx.dispositif || "") && estMna(s)) ? ctx.dispositif : (s.groupe || "Autres"); let x = g.find(y => y.n === n); if (!x) g.push(x = { n, l: [] }); x.l.push(s); });
  return g.map(x => `<optgroup label="${esc(x.n)}">${x.l.map(s => `<option value="${esc(s.id)}" ${s.id === sel ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</optgroup>`).join("");
}
const actif = (m) => st.invs[m.id] ? st.invs[m.id].active !== false : true;

function render() {
  if (!cont || !cont.isConnected) return;
  const a = document.activeElement;
  if (a && cont.contains(a) && ["INPUT", "TEXTAREA", "SELECT"].includes(a.tagName) && a.type !== "checkbox") return;
  const ouverte = ui.ouverte ? st.missions.find(m => m.id === ui.ouverte) : null;
  suivrePhotos(ouverte?.id || null);
  if (ui.plan) { cont.innerHTML = STYLE + `<div class="mp">${planVue()}</div>`; brancherPlanVue(); return; }
  cont.innerHTML = STYLE + `<div class="mp">${ouverte ? detail(ouverte) : liste()}</div>`;
  brancher();
}

// Pièces proposées pour un site : celles programmées (par niveau), sinon celles de la fiche ménage.
// Pièces de la fiche ménage du site, avec leurs tâches : [{ nom, taches }].
function fichePieces(site) {
  const m = new Map();
  (site?.rooms || []).forEach(r => { const nom = String(r.name || "").trim(); if (!nom) return; const t = (r.tasks || []).map(x => String(x?.label || x || "").trim()).filter(Boolean); m.set(nom, [...new Set([...(m.get(nom) || []), ...t])]); });
  return [...m].map(([nom, taches]) => ({ nom, taches }));
}
function sitePieces(site) {
  const pl = piecesDuPlan(st.plans[clePlan(site)]);
  return pl.length ? pl : fichePieces(site).map(f => ({ cle: f.nom, nom: f.nom, niveau: "", taches: f.taches.length ? f.taches : tachesParDefaut(f.nom) }));
}
const aUnPlan = (site) => piecesDuPlan(st.plans[clePlan(site)]).length > 0;
// Rendu groupé par niveau (titre quand le niveau change).
export function parNiveau(pieces, rendu) {
  let niv = null;
  return pieces.map((p, i) => { const t = (p.niveau || "") !== niv && p.niveau ? `<div class="mp-niv">${esc(p.niveau)}</div>` : ""; niv = p.niveau || ""; return t + rendu(p, i); }).join("");
}

function planVue() {
  const site = sitesDispo().find(s => s.id === ui.plan) || sitesDispo()[0];
  if (!site) return `<button class="nav-btn" data-pl-retour>← Retour</button><div class="form-card hint">Aucune maison.</div>`;
  ui.plan = site.id;
  return `<div class="mp-actions"><button class="nav-btn" data-pl-retour>← ${ui.planRetour === "form" ? "Retour au formulaire" : "Retour"}</button></div>
    <div class="form-card"><h3 style="margin:0 0 4px">🏠 Pièces des maisons</h3><p class="hint" style="margin:0 0 10px">Programme une fois les niveaux et les pièces de chaque maison : ils seront proposés à chaque gros ménage. Tout est enregistré automatiquement.</p>
      <label class="mp-f" style="display:block"><select data-pl-site style="width:100%;padding:9px;border-radius:9px;border:1px solid var(--border);background:var(--panel-alt);color:var(--text);font:inherit">${sitesDispo().map(x => `<option value="${esc(x.id)}" ${x.id === site.id ? "selected" : ""}>${aUnPlan(x) ? "✅" : "⬜"} ${esc(x.name)}</option>`).join("")}</select></label></div>
    <div id="mp-plan">${editeurPlanHTML({ site, plan: st.plans[clePlan(site)], fiches: fichePieces(site) })}</div>`;
}
function brancherPlanVue() {
  const site = sitesDispo().find(s => s.id === ui.plan);
  cont.querySelector("[data-pl-retour]")?.addEventListener("click", () => { ui.form = ui.planRetour === "form"; ui.plan = null; ui.planRetour = null; render(); });
  cont.querySelector("[data-pl-site]")?.addEventListener("change", (e) => { ui.plan = e.target.value; e.target.blur(); render(); });
  const z = cont.querySelector("#mp-plan");
  if (z && site) brancherEditeurPlan(z, { site, plan: st.plans[clePlan(site)], fiches: fichePieces(site), onChange: (p) => { st.plans[clePlan(site)] = { niveaux: p.niveaux }; render(); } });
}

function liste() {
  const ms = missionsVisibles();
  const enCours = ms.filter(m => !m.validee), faits = ms.filter(m => m.validee);
  const carte = (m) => { const s = statutMission(m, actif(m)), tot = (m.pieces || []).length, f = nbFaits(m), mn = minutesPassees(m);
    return `<div role="button" tabindex="0" class="mp-carte" data-ouvrir="${m.id}"><span style="display:flex;justify-content:space-between;align-items:center;gap:6px"><span class="mp-badge ${s.cle}">${s.ic} ${s.lib}</span><span class="mp-mini-act"><a class="nav-btn" href="${lienMission(m.id)}&apercu=1" target="_blank" rel="noopener" title="Voir la fiche de l'entreprise" onclick="event.stopPropagation()" style="text-decoration:none">👁️</a>${m.validee ? "" : `<button type="button" class="nav-btn" data-modifier="${m.id}" title="Modifier">✏️</button>`}<button type="button" class="nav-btn" data-effacer="${m.id}" title="Supprimer">🗑️</button></span></span>
      <b>🏠 ${esc(m.siteName)}</b><span>🧽 ${esc(m.entreprise)}</span><small>Du ${dateFr(m.debut)} au ${dateFr(m.fin)}</small>
      ${tot ? `<span class="mp-barre"><i style="width:${Math.round(f / tot * 100)}%"></i></span><small>${f}/${tot} pièces faites${mn ? ` · ⏱️ ${fmtMin(mn)}` : ""}</small>` : mn ? `<small>⏱️ ${fmtMin(mn)}</small>` : ""}</div>`; };
  return `<div class="mp-tete"><div><h3 style="margin:0">🧽 Ménage ponctuel par une entreprise</h3><p class="hint" style="margin:2px 0 0">Gros ménage sur un site : l'entreprise reçoit un lien, pointe ses heures, coche les pièces avec photos avant / après. Tu suis tout ici puis tu valides.</p></div>
      <span class="mp-actions"><button class="nav-btn" data-plans>🏠 Pièces des maisons</button>${ui.form ? "" : `<button class="add-btn" data-nouveau>➕ Faire passer une entreprise</button>`}</span></div>
    ${ui.form ? formulaire() : ""}
    ${ui.cree ? `<div class="mp-lien">✓ Mission créée — envoie le lien à l'entreprise : <button class="nav-btn" data-copier="${ui.cree}">📋 Copier le lien</button>${st.missions.find(m => m.id === ui.cree)?.telephone ? `<a class="nav-btn" style="text-decoration:none" href="${smsHref(st.missions.find(m => m.id === ui.cree))}">📱 Envoyer par SMS</a>` : ""}<button class="nav-btn" data-fermer-cree>OK</button></div>` : ""}
    ${enCours.length ? `<div class="mp-grille">${enCours.map(carte).join("")}</div>` : (ui.form ? "" : `<div class="form-card hint">Aucun ménage ponctuel en cours.</div>`)}
    ${faits.length ? `<details class="form-card"><summary style="cursor:pointer;font-weight:700">✅ Validés (${faits.length})</summary><div class="mp-grille" style="margin-top:10px">${faits.map(carte).join("")}</div></details>` : ""}`;
}

function formulaire() {
  const d = ui.draft || (ui.draft = { siteId: sitesDispo()[0]?.id || "", entreprise: "", telephone: "", debut: auj(), fin: plus(auj(), 7), consignes: "", pieces: null, autres: "" });
  if (!sitesDispo().some(s => s.id === d.siteId)) d.siteId = sitesDispo()[0]?.id || "";
  const site = sitesDispo().find(s => s.id === d.siteId);
  const pcs = sitePieces(site), sig = d.siteId + "|" + pcs.map(p => p.cle).join("¦");
  if (!d.pieces || d.piecesPour !== sig) { const avant = d.piecesPour?.startsWith(d.siteId + "|") ? (d.pieces || {}) : {}; d.pieces = Object.fromEntries(pcs.map(p => [p.cle, avant[p.cle] ?? true])); d.piecesPour = sig; }
  return `<div class="form-card"><h3 style="margin:0 0 10px">${ui.edit ? "✏️ Modifier le ménage ponctuel" : "➕ Nouveau ménage ponctuel"}</h3><form class="mp-f" id="mp-form">
    <label class="plein">Site<select name="siteId" data-d>${optionsSites(d.siteId)}</select></label>
    <label>Entreprise<input name="entreprise" data-d required value="${esc(d.entreprise)}" placeholder="Nom de la société"></label>
    <label>Téléphone (pour le SMS)<input name="telephone" data-d type="tel" value="${esc(d.telephone)}" placeholder="06…"></label>
    <label>Du<input name="debut" data-d type="date" required value="${d.debut}"></label>
    <label>Au (le lien s'arrête après)<input name="fin" data-d type="date" required value="${d.fin}"></label>
    <label class="plein">Consignes pour l'entreprise<textarea name="consignes" data-d rows="3" placeholder="Ex. gros ménage complet avant l'arrivée d'un jeune : vitres, sols, cuisine (four, frigo), sanitaires détartrés…">${esc(d.consignes)}</textarea></label>
    <div class="plein"><div style="font-size:13px;font-weight:600;margin-bottom:6px">Pièces à faire (une photo avant / après par pièce)</div>
      ${pcs.length ? `<div class="mp-pcs">${parNiveau(pcs, (p) => `<label title="${esc((p.taches || []).join(" · "))}"><input type="checkbox" data-pc="${esc(p.cle)}" ${d.pieces[p.cle] ? "checked" : ""}> ${esc(p.nom)} <small class="hint">☑ ${(p.taches || []).length}</small></label>`)}</div>` : `<div class="hint">Pas encore de pièces programmées pour cette maison.</div>`}
      <button type="button" class="nav-btn" data-prog style="margin-top:8px">🏠 ${aUnPlan(site) ? "Modifier les pièces de cette maison" : "Programmer les pièces de cette maison (niveaux, chambres…)"}</button>
      <label style="margin-top:8px">Autres pièces / zones (une par ligne)<textarea name="autres" data-d rows="2" placeholder="Ex. Vitres extérieures&#10;Garage">${esc(d.autres)}</textarea></label></div>
    <div class="plein"><div style="font-size:13px;font-weight:600;margin-bottom:6px">🔐 Codes boîte à clés envoyés dans le SMS</div><div id="mp-codes">${codesHTML(site)}</div></div>
    <div class="plein mp-actions"><button class="add-btn" type="submit">${ui.edit ? "✓ Enregistrer" : "✓ Créer et obtenir le lien"}</button><button class="nav-btn" type="button" data-annuler>Annuler</button></div>
  </form></div>`;
}

// Codes boîte à clés du site (onglet Codes Masterlock), cochés par défaut.
function codesHTML(site) {
  if (!site?.dossierId) return `<div class="hint">Pas de dossier de site relié : aucun code à joindre.</div>`;
  const l = codesCache[site.dossierId];
  if (!l) { listerCodesPourSite(site.dossierId).then(c => { codesCache[site.dossierId] = (c || []).filter(x => x.code); const z = cont?.querySelector("#mp-codes"); if (z && ui.draft?.siteId === site.id) { z.innerHTML = codesHTML(site); brancherCodes(); } }).catch(() => { codesCache[site.dossierId] = []; }); return `<div class="hint">Chargement des codes…</div>`; }
  if (!l.length) return `<div class="hint">Aucun code enregistré pour ce site (onglet Codes Masterlock).</div>`;
  return `<div class="mp-pcs">${l.map(c => `<label><input type="checkbox" data-code="${esc(c.id)}" ${codeCoche(c) ? "checked" : ""}> ${esc(c.nom || "Boîte à clés")} : <b>${esc(c.code)}</b>${c.notes ? ` <small>(${esc(c.notes)})</small>` : ""}</label>`).join("")}</div>`;
}
// Coché par défaut ; en modification, on garde les codes déjà envoyés.
const codeCoche = (c) => !(ui.draft?.codesOff || {})[c.id] && (!ui.draft?.codesGarder || ui.draft.codesGarder.includes(c.code));
function brancherCodes() { cont?.querySelectorAll("[data-code]").forEach(cb => cb.addEventListener("change", () => {
  const off = {}; cont.querySelectorAll("[data-code]").forEach(x => { off[x.dataset.code] = !x.checked; }); ui.draft.codesOff = off; ui.draft.codesGarder = null; })); }
const texteCodes = (m) => (m.codes || []).length ? ` Boîte à clés : ${m.codes.map(c => `${c.nom || "boîte"} code ${c.code}${c.notes ? ` (${c.notes})` : ""}`).join(" ; ")}.` : "";
const smsTexte = (m) => `Bonjour, voici votre accès pour le ménage du site ${m.siteName} (Groupe Établières), du ${dateFr(m.debut)} au ${dateFr(m.fin)}.${texteCodes(m)} À l'arrivée, ouvrez ce lien, appuyez sur « J'arrive », prenez les photos avant / après de chaque pièce, puis « Terminer et envoyer » : ${lienMission(m.id)}`;
const smsHref = (m) => `sms:${String(m.telephone || "").replace(/[^0-9+]/g, "")}?&body=${encodeURIComponent(smsTexte(m))}`;

function detail(m) {
  const s = statutMission(m, actif(m)), ouvert = passageOuvert(m), tot = (m.pieces || []).length, f = nbFaits(m);
  const phs = st.photos, de = (n, mo) => phs.filter(p => p.piece === n && p.moment === mo);
  const autres = phs.filter(p => !(m.pieces || []).some(x => x.nom === p.piece));
  const fig = (p) => `<figure><img src="${p.data}" data-voir="${p.id}" alt="" loading="lazy"><figcaption><span class="${p.moment === "avant" ? "mp-av" : p.moment === "apres" ? "mp-ap" : ""}">${p.moment === "avant" ? "Avant" : p.moment === "apres" ? "Après" : "Photo"}</span> · ${jourFr(p.le)} ${heureFr(p.le)}</figcaption></figure>`;
  return `<div class="mp-actions"><button class="nav-btn" data-retour>← Retour</button></div>
    <div class="form-card"><span class="mp-badge ${s.cle}">${s.ic} ${s.lib}</span>
      <h3 style="margin:8px 0 2px">🏠 ${esc(m.siteName)} — 🧽 ${esc(m.entreprise)}</h3>
      <div class="hint">Du ${dateFr(m.debut)} au ${dateFr(m.fin)}${m.telephone ? ` · 📞 ${esc(m.telephone)}` : ""}${m.presta ? ` · intervenant : <b>${esc(`${m.presta.prenom || ""} ${m.presta.nom || ""}`.trim())}</b>${m.presta.societe ? ` (${esc(m.presta.societe)})` : ""}` : ""}</div>
      ${(m.codes || []).length ? `<p style="margin:8px 0 0;font-size:13.5px"><b>🔐 Codes envoyés :</b> ${m.codes.map(c => `${esc(c.nom)} <b>${esc(c.code)}</b>${c.notes ? ` (${esc(c.notes)})` : ""}`).join(" · ")}</p>` : ""}
      ${m.consignes ? `<p style="white-space:pre-wrap;margin:8px 0 0;font-size:13.5px"><b>Consignes :</b> ${esc(m.consignes)}</p>` : ""}
      <div class="mp-actions" style="margin-top:10px">
        <a class="add-btn" style="text-decoration:none" href="${lienMission(m.id)}&apercu=1" target="_blank" rel="noopener">👁️ Voir la fiche de l'entreprise</a>
        <button class="nav-btn" data-copier="${m.id}">📋 Copier le lien</button>${m.telephone ? `<a class="nav-btn" style="text-decoration:none" href="${smsHref(m)}">📱 SMS</a>` : ""}
        <button class="nav-btn" data-acces="${actif(m) ? "0" : "1"}">${actif(m) ? "⛔ Couper l'accès" : "🔓 Rouvrir l'accès"}</button>
        ${m.validee ? "" : `<button class="nav-btn" data-modif-detail>✏️ Modifier</button>`}
        <button class="nav-btn" data-imprimer>🖨️ Imprimer le compte rendu</button>
        ${m.validee ? `<button class="nav-btn" data-devalider>↩️ Annuler la validation</button>` : m.termine ? `<button class="add-btn" data-valider>✅ Valider le ménage</button><button class="nav-btn" data-renvoyer>↩️ Renvoyer à l'entreprise</button>` : ""}
        <button class="del-btn" data-supprimer>🗑️ Supprimer</button></div></div>
    <div class="form-card"><h3 style="margin:0 0 6px">⏱️ Présence sur place</h3>
      ${(m.passages || []).length ? `<ul style="margin:0;padding-left:18px">${m.passages.map(p => `<li>${jourFr(p.a)} : arrivée ${heureFr(p.a)} → ${p.d ? `départ ${heureFr(p.d)} (${fmtMin(Math.round((p.d - p.a) / 60000))})` : "<b>toujours sur place</b>"}</li>`).join("")}</ul><p style="margin:6px 0 0"><b>Total : ${fmtMin(minutesPassees(m))}</b>${ouvert ? " (en cours)" : ""}</p>` : `<div class="hint">Pas encore arrivé.</div>`}
      ${m.termine ? `<p class="hint" style="margin:6px 0 0">Envoyé le ${jourFr(m.termine)} à ${heureFr(m.termine)}${m.validee ? ` · validé${m.valideePar ? ` par ${esc(m.valideePar)}` : ""}${m.valideeLe ? ` le ${jourFr(m.valideeLe)}` : ""}` : ""}</p>` : ""}</div>
    <div class="form-card"><h3 style="margin:0 0 6px">🧹 Pièces ${tot ? `<small class="hint">${f}/${tot} faites</small>` : ""}</h3>
      ${parNiveau(m.pieces || [], (p, i) => { const av = de(p.nom, "avant"), ap = de(p.nom, "apres");
        const tt = p.taches || [], nt = tachesFaites(m, i);
        return `<div class="mp-piece"><b>${pieceFaite(m, i) ? "✅" : nt ? "🟡" : "⬜"} ${esc(p.libelle || p.nom)}</b>${tt.length ? ` <small class="hint">${nt}/${tt.length} tâches</small>` : ""}
          ${tt.length ? `<div style="display:flex;flex-wrap:wrap;gap:4px 12px;font-size:12.5px;margin-top:4px">${tt.map((t, k) => `<span style="${m.faits?.[`${i}-${k}`] ? "color:#11845b" : "color:var(--text-dim)"}">${m.faits?.[`${i}-${k}`] ? "☑" : "☐"} ${esc(t)}${m.obs?.[`${i}-${k}`] ? ` <i style="color:#a85d00">💬 ${esc(m.obs[`${i}-${k}`])}</i>` : ""}</span>`).join("")}</div>` : ""}${!av.length || !ap.length ? ` <small class="hint">${!av.length ? "· pas de photo avant " : ""}${!ap.length ? "· pas de photo après" : ""}</small>` : ""}
          ${m.obs?.[i] ? `<div style="font-size:13px;margin-top:4px">📝 ${esc(m.obs[i])}</div>` : ""}
          ${av.length || ap.length ? `<div class="mp-ph">${[...av, ...ap].map(fig).join("")}</div>` : ""}</div>`; }) || `<div class="hint">Aucune pièce listée.</div>`}</div>
    ${autres.length ? `<div class="form-card"><h3 style="margin:0 0 6px">📷 Autres photos</h3><div class="mp-ph">${autres.map(fig).join("")}</div></div>` : ""}
    <div class="form-card"><h3 style="margin:0 0 6px">📝 Observations de l'entreprise</h3><div style="white-space:pre-wrap;font-size:13.5px">${esc(m.observations || "—")}</div></div>`;
}

function imprimer(m) {
  const phs = st.photos, de = (n, mo) => phs.filter(p => p.piece === n && p.moment === mo);
  const autres = phs.filter(p => !(m.pieces || []).some(x => x.nom === p.piece));
  const img = (p, lib) => `<figure><img src="${p.data}"><figcaption>${lib} · ${jourFr(p.le)} ${heureFr(p.le)}</figcaption></figure>`;
  const w = window.open("", "_blank"); if (!w) { alert("Autorise les fenêtres pour imprimer."); return; }
  w.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Ménage ponctuel — ${esc(m.siteName)}</title><style>
    @page{size:A4 portrait;margin:10mm}body{font:12px/1.4 Arial,sans-serif;color:#111}h1{font-size:18px;margin:0}h2{font-size:14px;margin:14px 0 6px;border-bottom:1px solid #999}
    table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:4px 6px;text-align:left}.ph{display:flex;flex-wrap:wrap;gap:6px}figure{margin:0;width:150px;break-inside:avoid}
    figure img{width:150px;height:115px;object-fit:cover}.niv{font-weight:bold;text-transform:uppercase;margin:10px 0 4px;color:#2f6fd6}figcaption{font-size:10px}.piece{break-inside:avoid;margin-bottom:8px}</style></head><body>
    <h1>Compte rendu — ménage ponctuel</h1><p><b>Groupe Établières</b>${m.dispositif ? ` · ${esc(m.dispositif)}` : ""}<br>Site : <b>${esc(m.siteName)}</b> · Entreprise : <b>${esc(m.entreprise)}</b>${m.presta ? ` · Intervenant : ${esc(`${m.presta.prenom || ""} ${m.presta.nom || ""}`.trim())}` : ""}<br>Période prévue : du ${dateFr(m.debut)} au ${dateFr(m.fin)}</p>
    ${m.consignes ? `<p><b>Consignes :</b> ${esc(m.consignes)}</p>` : ""}
    <h2>Présence sur place</h2>${(m.passages || []).length ? `<table><tr><th>Jour</th><th>Arrivée</th><th>Départ</th><th>Durée</th></tr>${m.passages.map(p => `<tr><td>${jourFr(p.a)}</td><td>${heureFr(p.a)}</td><td>${p.d ? heureFr(p.d) : "—"}</td><td>${p.d ? fmtMin(Math.round((p.d - p.a) / 60000)) : "—"}</td></tr>`).join("")}<tr><th colspan="3">Total</th><th>${fmtMin(minutesPassees(m))}</th></tr></table>` : "<p>Aucun pointage.</p>"}
    <h2>Pièces (${nbFaits(m)}/${(m.pieces || []).length} faites)</h2>
    ${parNiveau(m.pieces || [], (p, i) => `<div class="piece"><b>${pieceFaite(m, i) ? "☑" : "☐"} ${esc(p.libelle || p.nom)}</b>${(p.taches || []).length ? `<div style="font-size:11px;margin:2px 0 4px">${p.taches.map((t, k) => `${m.faits?.[`${i}-${k}`] ? "☑" : "☐"} ${esc(t)}${m.obs?.[`${i}-${k}`] ? ` (💬 ${esc(m.obs[`${i}-${k}`])})` : ""}`).join(" &nbsp; ")}</div>` : ""}${m.obs?.[i] ? ` — ${esc(m.obs[i])}` : ""}<div class="ph">${de(p.nom, "avant").map(x => img(x, "Avant")).join("")}${de(p.nom, "apres").map(x => img(x, "Après")).join("")}</div></div>`).replace(/class="mp-niv"/g, 'class="niv"')}
    ${autres.length ? `<h2>Autres photos</h2><div class="ph">${autres.map(x => img(x, "Photo")).join("")}</div>` : ""}
    <h2>Observations de l'entreprise</h2><p style="white-space:pre-wrap">${esc(m.observations || "—")}</p>
    <p style="margin-top:14px">${m.termine ? `Envoyé par l'entreprise le ${jourFr(m.termine)} à ${heureFr(m.termine)}.` : "Non terminé par l'entreprise."} ${m.validee ? `Validé${m.valideePar ? ` par ${esc(m.valideePar)}` : ""}${m.valideeLe ? ` le ${jourFr(m.valideeLe)}` : ""}.` : "Non validé."}</p>
    <script>window.onload=()=>setTimeout(()=>window.print(),300)<\/script></body></html>`);
  w.document.close();
}

function effacer(id) {
  const m = st.missions.find(x => x.id === id); if (!m) return;
  if (!confirm(`Supprimer ce ménage ponctuel (${m.siteName}, ${m.entreprise}) et ses photos ? Le lien ne marchera plus.`)) return;
  supprimerMission(id).then(() => { if (ui.ouverte === id) ui.ouverte = null; if (ui.cree === id) ui.cree = null; window.toast?.("🗑️ Supprimé"); render(); }).catch(e => alert(e.message));
}
// Ouvre le formulaire prérempli avec la mission (le lien ne change pas).
function ouvrirModif(id) {
  const m = st.missions.find(x => x.id === id); if (!m) return;
  const site = sitesDispo().find(s => s.id === m.siteId);
  const noms = (m.pieces || []).map(p => p.nom), pcs = sitePieces(site), duSite = new Set(pcs.map(p => p.cle));
  ui.draft = { siteId: m.siteId, entreprise: m.entreprise || "", telephone: m.telephone || "", debut: m.debut, fin: m.fin, consignes: m.consignes || "",
    pieces: Object.fromEntries(pcs.map(p => [p.cle, noms.includes(p.cle)])), piecesPour: m.siteId + "|" + pcs.map(p => p.cle).join("¦"),
    autres: noms.filter(n => !duSite.has(n)).join("\n"), codesGarder: Array.isArray(m.codes) ? m.codes.map(c => c.code) : null };
  ui.edit = id; ui.form = true; ui.ouverte = null; ui.cree = null; render();
}

function copier(id, btn) {
  const m = st.missions.find(x => x.id === id);
  navigator.clipboard.writeText(m ? smsTexte(m) : lienMission(id)).then(() => { const o = btn.textContent; btn.textContent = "Copié !"; setTimeout(() => { btn.textContent = o; }, 1500); })
    .catch(() => prompt("Copie ce lien :", lienMission(id)));
}

function brancher() {
  const q = (s) => cont.querySelector(s), qa = (s) => cont.querySelectorAll(s);
  q("[data-nouveau]")?.addEventListener("click", () => { ui.form = true; ui.edit = null; ui.cree = null; ui.draft = null; render(); });
  q("[data-annuler]")?.addEventListener("click", () => { ui.form = false; ui.draft = null; ui.edit = null; render(); });
  qa("[data-modifier]").forEach(b => b.addEventListener("click", (e) => { e.stopPropagation(); ouvrirModif(b.dataset.modifier); }));
  qa("[data-effacer]").forEach(b => b.addEventListener("click", (e) => { e.stopPropagation(); effacer(b.dataset.effacer); }));
  q("[data-fermer-cree]")?.addEventListener("click", () => { ui.cree = null; render(); });
  q("[data-plans]")?.addEventListener("click", () => { ui.plan = ui.draft?.siteId || sitesDispo()[0]?.id; ui.planRetour = ui.form ? "form" : null; render(); });
  q("[data-prog]")?.addEventListener("click", () => { ui.plan = ui.draft?.siteId; ui.planRetour = "form"; render(); });
  qa("[data-copier]").forEach(b => b.addEventListener("click", () => copier(b.dataset.copier, b)));
  qa("[data-ouvrir]").forEach(b => b.addEventListener("click", () => { ui.ouverte = b.dataset.ouvrir; render(); }));
  q("[data-retour]")?.addEventListener("click", () => { ui.ouverte = null; render(); });
  qa("[data-voir]").forEach(img => img.addEventListener("click", () => { const i = st.photos.findIndex(p => p.id === img.dataset.voir); voirPhotos(st.photos, Math.max(0, i)); }));
  const form = q("#mp-form");
  if (form) {
    form.querySelectorAll("[data-d]").forEach(el => {
      el.addEventListener("input", () => { ui.draft[el.name] = el.value; });
      el.addEventListener("change", () => { ui.draft[el.name] = el.value; if (el.name === "siteId") { el.blur(); render(); } });
    });
    brancherCodes();
    form.querySelectorAll("[data-pc]").forEach(cb => cb.addEventListener("change", () => { ui.draft.pieces[cb.dataset.pc] = cb.checked; }));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const d = ui.draft, site = sitesDispo().find(s => s.id === d.siteId);
      if (!site) { alert("Choisis un site."); return; }
      if (!d.entreprise.trim()) { alert("Indique le nom de l'entreprise."); return; }
      if (d.fin < d.debut) { alert("La date de fin est avant la date de début."); return; }
      const vus = new Set(), pieces = [...sitePieces(site).filter(p => d.pieces?.[p.cle]).map(p => ({ nom: p.cle, libelle: p.nom, niveau: p.niveau, taches: p.taches || [] })),
        ...String(d.autres || "").split("\n").map(x => x.trim()).filter(Boolean).map(nom => ({ nom, taches: tachesParDefaut(nom) }))].filter(p => !vus.has(p.nom) && vus.add(p.nom));
      const codes = (codesCache[site.dossierId] || []).filter(codeCoche).map(c => ({ nom: c.nom || "Boîte à clés", code: c.code, notes: c.notes || "" }));
      const btn = form.querySelector("[type=submit]"); btn.disabled = true; btn.textContent = "⏳ Création…";
      if (ui.edit) {
        try {
          await modifierMission(ui.edit, { siteId: site.id, siteName: site.name, dispositif: site.groupe || site.dispositif || "", entreprise: d.entreprise.trim(), telephone: d.telephone.trim(), debut: d.debut, fin: d.fin, consignes: d.consignes.trim(), pieces, codes });
          ui.form = false; ui.draft = null; ui.edit = null; document.activeElement?.blur(); window.toast?.("✓ Modifié — le lien reste le même"); render();
        } catch (err) { btn.disabled = false; btn.textContent = "✓ Enregistrer"; alert("Modification impossible : " + (err?.message || err)); }
        return;
      }
      try {
        const id = await creerMission({ site, dispositif: site.groupe || site.dispositif || "", entreprise: d.entreprise.trim(), telephone: d.telephone.trim(), debut: d.debut, fin: d.fin, consignes: d.consignes.trim(), pieces, codes, createdBy: ctx.user?.uid || "" });
        ui.form = false; ui.draft = null; ui.cree = id;
        try { await navigator.clipboard.writeText(smsTexte({ id, siteName: site.name, debut: d.debut, fin: d.fin, codes })); window.toast?.("✓ Mission créée, message avec le lien copié"); } catch { window.toast?.("✓ Mission créée"); }
        document.activeElement?.blur(); render();
      } catch (err) { btn.disabled = false; btn.textContent = "✓ Créer et obtenir le lien"; alert("Création impossible : " + (err?.message || err)); }
    });
  }
  const m = ui.ouverte ? st.missions.find(x => x.id === ui.ouverte) : null;
  if (!m) return;
  const qui = ctx.user?.nom || ctx.user?.displayName || ctx.user?.email || "";
  q("[data-imprimer]")?.addEventListener("click", () => imprimer(m));
  q("[data-valider]")?.addEventListener("click", () => majMission(m.id, { validee: true, valideePar: qui, valideeLe: Date.now() }).then(() => window.toast?.("✅ Ménage validé")).catch(e => alert(e.message)));
  q("[data-devalider]")?.addEventListener("click", () => { if (confirm("Annuler la validation ?")) majMission(m.id, { validee: false, valideePar: "", valideeLe: null }).catch(e => alert(e.message)); });
  q("[data-renvoyer]")?.addEventListener("click", () => { if (confirm("Rouvrir la fiche pour que l'entreprise complète ? (pense à lui dire quoi reprendre)")) majMission(m.id, { termine: null }).then(() => accesMission(m.id, true)).catch(e => alert(e.message)); });
  q("[data-acces]")?.addEventListener("click", (e) => accesMission(m.id, e.currentTarget.dataset.acces === "1").catch(err => alert(err.message)));
  q("[data-supprimer]")?.addEventListener("click", () => effacer(m.id));
  q("[data-modif-detail]")?.addEventListener("click", () => ouvrirModif(m.id));
}

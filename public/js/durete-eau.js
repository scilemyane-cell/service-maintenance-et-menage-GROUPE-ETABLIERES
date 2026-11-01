// durete-eau.js — Contrôle de la dureté de l'eau (TH) sur les sites.
// Le technicien en charge d'un site (config/sites-techniciens) fait un contrôle
// tous les 3 mois : TH eau de ville, TH après adoucisseur, sel, action.
//  • « durete-eau/{id} » : un contrôle { site, date, point, thVille, thAdouci, sel, action, commentaire, agentUid, agentNom, creeLe }
//  • « config/durete-eau » : { exclus: [site…], ajoutes: [site…] } (sites sans adoucisseur / sites en plus)
import { db } from "./firebase-init.js";
import { collection, doc, onSnapshot, addDoc, deleteDoc, setDoc } from "./firestore-compte.js";
import { esc } from "./astreinte-logic.js";
import { watchAffectationsSites } from "./affectations-sites-data.js";
import { watchUsers } from "./users-data.js";

const COL = "durete-eau", CONF = doc(db, "config", "durete-eau");
const PERIODE_MOIS = 3, BIENTOT_J = 15;
const GESTION = ["super_admin", "admin", "n1"];
let cont = null, user = null, unsubs = [];
let controles = [], affect = {}, users = [], conf = { exclus: [], ajoutes: [] };
const st = { vue: null, filtre: "", ouvert: null, saisie: null, reglages: false };

const pad = (n) => String(n).padStart(2, "0");
const isoJ = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const frD = (iso) => iso ? new Date(iso + "T12:00").toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";
const plusMois = (iso, n) => { const d = new Date(iso + "T12:00"), j = d.getDate(); d.setDate(1); d.setMonth(d.getMonth() + n); d.setDate(Math.min(j, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate())); return isoJ(d); };
const jours = (a, b) => Math.round((new Date(b + "T12:00") - new Date(a + "T12:00")) / 86400000);
const nomUid = (uid) => { const u = users.find(x => x.uid === uid); return u ? (u.nom || u.displayName || u.email || "?") : "?"; };
const estGestion = () => GESTION.includes(user?.role) && !user?.apercu;

// Lecture du TH après adoucisseur (en °f) : trop doux < 5, bon 5–15, à régler > 15.
function avisAdouci(th) {
  if (th == null || th === "") return null;
  const v = Number(th);
  if (v < 5) return { cls: "orange", txt: "Trop doux (eau agressive) — remonter le mitigeage" };
  if (v <= 15) return { cls: "vert", txt: "Bon" };
  return { cls: "rouge", txt: "Trop dur — vérifier l'adoucisseur (sel, régénération)" };
}
function avisVille(th) {
  if (th == null || th === "") return "";
  const v = Number(th);
  return v < 15 ? "douce" : v <= 30 ? "moyennement dure" : "dure";
}

function sites() {
  const avecTech = Object.entries(affect).filter(([, u]) => Array.isArray(u) && u.length).map(([s]) => s);
  const l = [...new Set([...avecTech, ...(conf.ajoutes || []), ...controles.map(c => c.site)])].filter(s => s && !(conf.exclus || []).includes(s));
  return l.sort((a, b) => a.localeCompare(b, "fr"));
}
function etatSite(site) {
  const l = controles.filter(c => c.site === site).sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.creeLe || 0) - (a.creeLe || 0));
  const dernier = l[0] || null, auj = isoJ();
  const prochain = dernier ? plusMois(dernier.date, PERIODE_MOIS) : null;
  let etat = "jamais";
  if (dernier) { const r = jours(auj, prochain); etat = r < 0 ? "retard" : r <= BIENTOT_J ? "bientot" : "ok"; }
  return { site, liste: l, dernier, prochain, etat, techs: (affect[site] || []).map(nomUid) };
}
const LIB = { retard: "🔴 En retard", bientot: "🟠 À faire bientôt", jamais: "⚪ Jamais contrôlé", ok: "🟢 À jour" };
const ORDRE = { retard: 0, jamais: 1, bientot: 2, ok: 3 };

export function mountDureteEau(container, u) {
  unsubs.forEach(f => { try { f(); } catch { /* */ } }); unsubs = [];
  cont = container; user = u;
  if (st.vue === null) st.vue = estGestion() ? "tous" : "miens";
  cont.innerHTML = `<div class="hint">Chargement…</div>`;
  if (!cont.dataset.deEcoute) { cont.addEventListener("click", clic); cont.addEventListener("submit", envoi); cont.addEventListener("input", saisie); cont.dataset.deEcoute = "1"; }
  unsubs.push(onSnapshot(collection(db, COL), (s) => { controles = s.docs.map(d => ({ id: d.id, ...d.data() })); rendre(); },
    (e) => { cont.innerHTML = `<div class="form-card" style="color:var(--red)">❌ ${esc(e.message)}<br><small>As-tu publié la règle Firestore « durete-eau » ?</small></div>`; }));
  unsubs.push(watchAffectationsSites((a) => { affect = a || {}; rendre(); }));
  unsubs.push(watchUsers((l) => { users = l || []; rendre(); }));
  unsubs.push(onSnapshot(CONF, (s) => { conf = s.exists() ? { exclus: [], ajoutes: [], ...s.data() } : { exclus: [], ajoutes: [] }; rendre(); }, () => {}));
}

function rendre() {
  if (!cont || !document.contains(cont)) return;
  // Une mise à jour en direct (autre technicien, liste des sites…) ne doit pas effacer la saisie en cours.
  const fAvant = cont.querySelector("[data-de-form]");
  if (fAvant && st.saisie) st.saisie.vals = Object.fromEntries([...fAvant.elements].filter(x => x.name).map(x => [x.name, x.value]));
  const actif = document.activeElement?.name;
  const tous = sites().map(etatSite);
  const miens = tous.filter(e => (affect[e.site] || []).includes(user.uid));
  const base = st.vue === "miens" ? miens : tous;
  const q = st.filtre.trim().toLowerCase();
  const liste = base.filter(e => !q || e.site.toLowerCase().includes(q) || e.techs.join(" ").toLowerCase().includes(q))
    .sort((a, b) => ORDRE[a.etat] - ORDRE[b.etat] || (a.prochain || "").localeCompare(b.prochain || "") || (a.site || "").localeCompare(b.site || "", "fr"));
  const compte = (k) => base.filter(e => e.etat === k).length;
  const sitesSaisie = (st.vue === "miens" && miens.length ? miens : tous).map(e => e.site);
  cont.innerHTML = `<div class="de">
    <div class="de-tete">
      <div><h2>💧 Contrôle de la dureté de l'eau</h2><p class="hint">Un contrôle tous les ${PERIODE_MOIS} mois par site, fait par le technicien en charge du site. TH en °f (degrés français).</p></div>
      <button type="button" class="add-btn" data-de-nouveau>➕ Saisir un contrôle</button>
    </div>
    <div class="de-kpis">
      <div class="rouge"><b>${compte("retard")}</b><span>en retard</span></div>
      <div class="orange"><b>${compte("bientot")}</b><span>à faire sous ${BIENTOT_J} j</span></div>
      <div class="gris"><b>${compte("jamais")}</b><span>jamais contrôlés</span></div>
      <div class="vert"><b>${compte("ok")}</b><span>à jour</span></div>
    </div>
    <div class="de-barre">
      <div class="de-seg"><button type="button" data-de-vue="miens" class="${st.vue === "miens" ? "on" : ""}">👷 Mes sites (${miens.length})</button><button type="button" data-de-vue="tous" class="${st.vue === "tous" ? "on" : ""}">Tous les sites (${tous.length})</button></div>
      <input type="search" data-de-filtre placeholder="🔎 Site ou technicien…" value="${esc(st.filtre)}">
      ${estGestion() ? `<button type="button" class="nav-btn" data-de-reglages>⚙️ Sites concernés</button>` : ""}
    </div>
    ${st.saisie ? formHTML(sitesSaisie) : ""}
    ${st.reglages && estGestion() ? reglagesHTML() : ""}
    ${!liste.length ? `<div class="form-card">${st.vue === "miens" ? "Aucun site ne t'est attribué. Les sites sont attribués aux techniciens dans Suivi des demandes (« sites des techniciens »). Passe sur « Tous les sites » pour saisir quand même." : "Aucun site."}</div>` : ""}
    <div class="de-sites">${liste.map(carteHTML).join("")}</div>
  </div>`;
  const fApres = cont.querySelector("[data-de-form]");
  if (fApres && st.saisie?.vals) { Object.entries(st.saisie.vals).forEach(([k, v]) => { const el = fApres.elements[k]; if (el) el.value = v; }); if (actif && fApres.elements[actif]) fApres.elements[actif].focus(); }
  if (st.saisie) cont.querySelector("[data-de-form] [name=thAdouci]")?.dispatchEvent(new Event("input", { bubbles: true }));
}

function carteHTML(e) {
  const d = e.dernier, av = d ? avisAdouci(d.thAdouci) : null, ouvert = st.ouvert === e.site;
  return `<div class="de-site ${e.etat}">
    <div class="de-site-l">
      <div class="de-site-t"><b>${esc(e.site)}</b><span class="de-etat ${e.etat}">${LIB[e.etat]}</span></div>
      <small>👷 ${e.techs.length ? esc(e.techs.join(", ")) : "<i>aucun technicien attribué</i>"}</small>
      <div class="de-site-info">
        <span>Dernier : <b>${d ? frD(d.date) : "—"}</b>${d ? ` par ${esc(d.agentNom || "?")}` : ""}</span>
        <span>Prochain : <b>${e.prochain ? frD(e.prochain) : "dès que possible"}</b>${e.etat === "retard" ? ` <em>(${jours(e.prochain, isoJ())} j de retard)</em>` : ""}</span>
        ${d ? `<span>TH ville <b>${d.thVille ?? "—"}</b> °f · après adoucisseur <b class="de-th ${av?.cls || ""}">${d.thAdouci ?? "—"}</b> °f${d.sel ? ` · sel : ${esc(d.sel)}` : ""}</span>` : ""}
      </div>
    </div>
    <div class="de-site-b"><button type="button" class="dps-enregistrer" data-de-nouveau="${esc(e.site)}">➕ Contrôle</button>${e.liste.length ? `<button type="button" class="nav-btn" data-de-histo="${esc(e.site)}">${ouvert ? "▴" : "▾"} Historique (${e.liste.length})</button>` : ""}</div>
    ${ouvert ? `<div class="de-histo"><table><thead><tr><th>Date</th><th>Point</th><th class="n">TH ville</th><th class="n">TH adouci</th><th>Sel</th><th>Action / commentaire</th><th>Par</th><th></th></tr></thead><tbody>
      ${e.liste.map(c => { const a = avisAdouci(c.thAdouci); return `<tr><td>${frD(c.date)}</td><td>${esc(c.point || "")}</td><td class="n">${c.thVille ?? "—"}</td><td class="n"><span class="de-th ${a?.cls || ""}" title="${esc(a?.txt || "")}">${c.thAdouci ?? "—"}</span></td><td>${esc(c.sel || "")}</td><td>${esc([c.action, c.commentaire].filter(Boolean).join(" — "))}</td><td>${esc(c.agentNom || "")}</td><td>${estGestion() || c.agentUid === user.uid ? `<button type="button" class="nav-btn" data-de-suppr="${c.id}" title="Supprimer">🗑</button>` : ""}</td></tr>`; }).join("")}
    </tbody></table></div>` : ""}
  </div>`;
}

function formHTML(sitesListe) {
  const s = st.saisie;
  return `<form class="de-form form-card" data-de-form>
    <h3>➕ Contrôle de dureté</h3>
    <div class="de-grille">
      <label>Site<select name="site" required><option value="">— choisir —</option>${sitesListe.map(x => `<option ${x === s.site ? "selected" : ""}>${esc(x)}</option>`).join("")}</select></label>
      <label>Date<input type="date" name="date" value="${isoJ()}" max="${isoJ()}" required></label>
      <label>Point de prélèvement<select name="point">${["Sortie adoucisseur", "Eau froide (robinet)", "Eau chaude sanitaire", "Autre"].map(p => `<option>${p}</option>`).join("")}</select></label>
      <label>TH eau de ville (°f)<input type="number" name="thVille" min="0" max="80" step="0.5" inputmode="decimal" placeholder="ex. 32"></label>
      <label>TH après adoucisseur (°f)<input type="number" name="thAdouci" min="0" max="80" step="0.5" inputmode="decimal" placeholder="ex. 10" required><small data-de-avis></small></label>
      <label>Sel dans le bac<select name="sel"><option>OK</option><option>Bas — rechargé</option><option>Vide — rechargé</option><option>Pas d'adoucisseur</option></select></label>
      <label class="large">Action faite<input name="action" placeholder="ex. réglage vis de mitigeage, régénération forcée…"></label>
      <label class="large">Commentaire<textarea name="commentaire" rows="2"></textarea></label>
    </div>
    <p class="hint">Repère : après adoucisseur, viser <b>8 à 15 °f</b>. En dessous de 5 °f l'eau devient agressive pour les canalisations ; au-dessus de 15 °f, l'adoucisseur ne fait plus bien son travail.</p>
    <div class="de-btns"><button type="button" class="dps-annuler" data-de-annuler>Annuler</button><button class="dps-enregistrer">✓ Enregistrer</button></div>
  </form>`;
}

function reglagesHTML() {
  const avecTech = Object.entries(affect).filter(([, u]) => Array.isArray(u) && u.length).map(([s]) => s);
  const tousSites = [...new Set([...avecTech, ...(conf.ajoutes || []), ...(conf.exclus || [])])].sort((a, b) => a.localeCompare(b, "fr"));
  return `<div class="form-card de-reglages"><h3>⚙️ Sites concernés par le contrôle</h3>
    <p class="hint">Par défaut : tous les sites qui ont un technicien attribué. Décoche les sites sans adoucisseur. Tu peux aussi ajouter un site.</p>
    <div class="de-chk">${tousSites.map(s => `<label><input type="checkbox" data-de-site="${esc(s)}" ${(conf.exclus || []).includes(s) ? "" : "checked"}> ${esc(s)}</label>`).join("")}</div>
    <form data-de-ajout class="de-ajout"><input name="site" placeholder="Ajouter un site…" required><button class="nav-btn">➕ Ajouter</button></form>
  </div>`;
}

function saisie(e) {
  if (e.target.matches("[data-de-filtre]")) { st.filtre = e.target.value; const pos = e.target.selectionStart; rendre(); const i = cont.querySelector("[data-de-filtre]"); i?.focus(); try { i?.setSelectionRange(pos, pos); } catch { /* */ } return; }
  if (e.target.name === "thAdouci") { const a = avisAdouci(e.target.value), el = cont.querySelector("[data-de-avis]"); if (el) { el.textContent = a ? a.txt : ""; el.className = "de-avis " + (a?.cls || ""); } }
  if (e.target.name === "thVille") { const t = avisVille(e.target.value); e.target.title = t ? `Eau ${t}` : ""; }
}

async function clic(e) {
  const b = e.target.closest("button, input[type=checkbox]"); if (!b || !cont.contains(b)) return;
  if (b.dataset.deVue) { st.vue = b.dataset.deVue; rendre(); }
  else if (b.hasAttribute("data-de-nouveau")) { cont.querySelector("[data-de-form]")?.remove(); st.saisie = { site: b.dataset.deNouveau || "" }; rendre(); cont.querySelector("[data-de-form]")?.scrollIntoView({ behavior: "smooth", block: "start" }); }
  else if (b.hasAttribute("data-de-annuler")) { st.saisie = null; rendre(); }
  else if (b.dataset.deHisto) { st.ouvert = st.ouvert === b.dataset.deHisto ? null : b.dataset.deHisto; rendre(); }
  else if (b.hasAttribute("data-de-reglages")) { st.reglages = !st.reglages; rendre(); }
  else if (b.dataset.deSuppr) {
    const ok = window.confirmDialog ? await window.confirmDialog("Supprimer ce contrôle ?") : confirm("Supprimer ce contrôle ?");
    if (ok) try { await deleteDoc(doc(db, COL, b.dataset.deSuppr)); } catch (err) { alert("Suppression impossible : " + (err?.message || err)); }
  } else if (b.dataset.deSite != null && b.type === "checkbox") {
    const s = b.dataset.deSite, exclus = new Set(conf.exclus || []);
    if (b.checked) exclus.delete(s); else exclus.add(s);
    try { await setDoc(CONF, { exclus: [...exclus], majLe: Date.now() }, { merge: true }); } catch (err) { alert("Enregistrement impossible : " + (err?.message || err)); }
  }
}

async function envoi(e) {
  if (e.target.matches("[data-de-ajout]")) {
    e.preventDefault(); const s = String(new FormData(e.target).get("site") || "").trim(); if (!s) return;
    try { await setDoc(CONF, { ajoutes: [...new Set([...(conf.ajoutes || []), s])], exclus: (conf.exclus || []).filter(x => x !== s), majLe: Date.now() }, { merge: true }); } catch (err) { alert("Enregistrement impossible : " + (err?.message || err)); }
    return;
  }
  if (!e.target.matches("[data-de-form]")) return;
  e.preventDefault();
  const f = new FormData(e.target), num = (k) => { const v = String(f.get(k) || "").replace(",", ".").trim(); return v === "" ? null : Number(v); };
  const btn = e.target.querySelector("button:not([type=button])"); if (btn) { btn.disabled = true; btn.textContent = "⏳…"; }
  try {
    await addDoc(collection(db, COL), {
      site: String(f.get("site")), date: String(f.get("date")), point: String(f.get("point") || ""),
      thVille: num("thVille"), thAdouci: num("thAdouci"), sel: String(f.get("sel") || ""),
      action: String(f.get("action") || "").trim(), commentaire: String(f.get("commentaire") || "").trim(),
      agentUid: user.uid, agentNom: user.nom || user.displayName || user.email || "", creeLe: Date.now(),
    });
    st.saisie = null; window.toast?.("💧 Contrôle enregistré", "success"); rendre();
  } catch (err) { alert("Enregistrement impossible : " + (err?.message || err) + "\n(As-tu publié la règle Firestore « durete-eau » ?)"); if (btn) { btn.disabled = false; btn.textContent = "✓ Enregistrer"; } }
}

// espaces-verts.js — Feuilles de traçabilité des espaces verts (sites MNA).
// « Intervention » : l'agent espaces verts ouvre une feuille à chaque passage,
// choisit le site, coche ce qui a été fait (comme les fiches ménage MNA) et
// ajoute des photos avant / après. Le passage précédent du site est affiché à
// côté, et chaque prestation indique depuis quand elle n'a pas été faite.
// « Suivi » : par site, dernier passage, prestations en retard, historique
// complet et impression.
import { esc, dateKey } from "./astreinte-logic.js";
import { watchAssociations } from "./associations-data.js";
import { watchSitesDossiers } from "./site-dossier-data.js";
import { toast, confirmDialog } from "./ui-feedback.js";
import { db } from "./firebase-init.js";
import { collection, query, where, getDocs } from "./firestore-compte.js";
import {
  GROUPES, TACHES, watchPassages, creerPassage, majPassage, supprimerPassage,
  watchPhotosPassage, ajouterPhotoEV, majPhotoEV, supprimerPhotoEV, dernieresDates, joursDepuis, retardsSite,
} from "./espaces-verts-data.js";

const EDITEURS = ["super_admin", "admin", "n1"];
const MOMENTS = { avant: "Avant", apres: "Après", "": "Autre" };

let conteneur = null, user = null, vue = "intervention";
let sites = [], passages = null, erreur = "", sitesAssos = [], sitesDossiers = [];
// Sites MNA : ceux des Dossiers de site (groupe / association / nom contenant « MNA ») ;
// à défaut, ceux du groupe « MNA » dans Associations & Sites.
const majSites = () => { sites = sitesDossiers.length ? sitesDossiers : sitesAssos; };
let ui = { passageId: null, siteChoisi: "", date: dateKey(new Date()), ouvertsSuivi: new Set(), anneeImpr: new Date().getFullYear() };
let photos = [], photosPrec = [], unsubPhotos = null, unsubPhotosPrec = null, suiviPhotos = null, suiviPrecId = null;
let unsubs = [], saveTimer = null, statut = "", enAttente = null, renduDiffere = false;

const peutModifier = (p) => p && (EDITEURS.includes(user?.role) || p.agentUid === user?.uid);
// Sites MNA = ceux du groupe « MNA » dans Administration > Associations &
// Sites (même liste que le reste de l'appli) : un site ajouté là-bas apparaît
// ici tout seul.
const slug = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const sitesMNA = () => sites;
function sitesDepuisAssociations(assos) {
  const l = [];
  for (const a of assos || []) for (const st of a.sites || []) {
    if (/MNA/i.test(st.groupe || "") || /MNA/i.test(a.nom || "")) l.push({ id: "mna-" + slug(st.nom), name: st.nom, association: a.nom });
  }
  return l;
}
const fmt = (iso) => iso ? new Date(iso + "T00:00:00").toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" }) : "";
const fmtCourt = (iso) => iso ? new Date(iso + "T00:00:00").toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }) : "";
const ilYa = (j) => j <= 0 ? "aujourd'hui" : j === 1 ? "hier" : `il y a ${j} j`;
const tri = (a, b) => (b.date || "").localeCompare(a.date || "") || (b.creeLe?.seconds || 0) - (a.creeLe?.seconds || 0);
const labelTache = (cle) => TACHES.find(t => t.cle === cle)?.label || cle;
const tachesFaites = (p) => TACHES.filter(t => p.taches?.[t.cle]);

function nettoyer() {
  envoyer();
  unsubs.forEach(u => u()); unsubs = [];
  unsubPhotos?.(); unsubPhotos = null; unsubPhotosPrec?.(); unsubPhotosPrec = null; suiviPhotos?.(); suiviPhotos = null;
}

function monter(container, u, quelleVue) {
  nettoyer();
  conteneur = container; user = u; vue = quelleVue;
  if (!container.dataset.evEcoute) {
    container.addEventListener("click", surClic);
    container.addEventListener("input", surSaisie);
    container.addEventListener("change", surChangement);
    container.addEventListener("focusout", () => setTimeout(() => { if (renduDiffere) render(); }, 0));
    container.dataset.evEcoute = "1";
  }
  container.innerHTML = `<div class="hint" style="padding:24px;text-align:center">Chargement…</div>`;
  unsubs.push(watchAssociations(a => { sitesAssos = sitesDepuisAssociations(a); majSites(); render(); }));
  unsubs.push(watchSitesDossiers(l => {
    const vus = new Set();
    sitesDossiers = (l || []).filter(d => !d.supprimeLe && (/MNA/i.test(d.groupe || "") || /MNA/i.test(d.association || "") || /MNA/i.test(d.nom || "")))
      .map(d => ({ id: "mna-" + slug(d.nom), name: d.nom, association: d.association || "Agropolis" }))
      .filter(x => x.name && !vus.has(x.id) && vus.add(x.id)).sort((a, b) => a.name.localeCompare(b.name, "fr"));
    majSites(); render();
  }));
  unsubs.push(watchPassages((l, e) => {
    if (e) { erreur = /permission/i.test(e.message || "") ? "Accès refusé : publie la dernière version des règles Firestore (blocs « espaces-verts »)." : (e.message || String(e)); passages = []; }
    else { passages = l; erreur = ""; }
    render();
  }));
}
if (typeof window !== "undefined") window.addEventListener("pagehide", () => { envoyer(); });
export const mountEspacesVertsIntervention = (c, u) => monter(c, u, "intervention");
export const mountEspacesVertsSuivi = (c, u) => monter(c, u, "suivi");

// ---------- Photos ----------
async function compresserPhoto(fichier) {
  const url = URL.createObjectURL(fichier);
  try {
    const img = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ko(new Error("Image illisible")); i.src = url; });
    const max = 820, k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas"); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    let q = 0.58, out = c.toDataURL("image/jpeg", q);
    while (out.length > 80000 && q > 0.3) { q -= 0.08; out = c.toDataURL("image/jpeg", q); }
    return out;
  } finally { URL.revokeObjectURL(url); }
}

function suivrePhotos(id, prec) {
  if (id === undefined) return;
  if (!prec) {
    unsubPhotos?.(); photos = []; unsubPhotos = id ? watchPhotosPassage(id, l => { photos = l; render(); }) : null;
  } else {
    if (id === suiviPrecId) return;
    suiviPrecId = id; unsubPhotosPrec?.(); photosPrec = [];
    unsubPhotosPrec = id ? watchPhotosPassage(id, l => { photosPrec = l; render(); }) : null;
  }
}

// ---------- Sauvegarde ----------
function passageOuvert() { return (passages || []).find(p => p.id === ui.passageId) || null; }
function passagePrecedent(p) {
  return (passages || []).filter(x => x.siteId === p.siteId && x.id !== p.id && (x.date < p.date || (x.date === p.date && (x.creeLe?.seconds || 0) < (p.creeLe?.seconds || Infinity))))
    .sort(tri)[0] || null;
}
// Les champs modifiés s'accumulent et partent ensemble : cocher une case
// puis taper une précision juste après n'annule pas l'enregistrement de la case.
function sauverPlusTard(id, champs, delai = 700) {
  const p = (passages || []).find(x => x.id === id); if (p) Object.assign(p, champs);
  enAttente = { id, champs: { ...(enAttente?.id === id ? enAttente.champs : {}), ...champs } };
  statut = "⏳ Enregistrement…"; majStatut();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(envoyer, delai);
}
async function envoyer() {
  clearTimeout(saveTimer); saveTimer = null;
  const lot = enAttente; enAttente = null;
  if (!lot) return;
  try { await majPassage(lot.id, lot.champs); statut = "✅ Enregistré"; }
  catch (e) { console.error(e); statut = "❌ Échec de l'enregistrement : " + (e.message || e); toast(statut, "error"); }
  majStatut();
}
function majStatut() { const el = conteneur?.querySelector(".ev-statut"); if (el) el.textContent = statut; }

// ---------- Rendu : intervention ----------
function vueChoix() {
  const mna = sitesMNA();
  const miens = (passages || []).filter(p => EDITEURS.includes(user?.role) || p.agentUid === user?.uid).sort(tri).slice(0, 30);
  return `
    <div class="form-card">
      <b>➕ Nouvelle intervention</b>
      <div class="hint">Choisis le site, puis coche ce qui a été fait.</div>
      <div class="ev-sites">${mna.map(s => {
        const ret = passages ? retardsSite(passages, s.id).filter(r => !r.jamais).length : 0;
        return `<button class="ev-site ${ui.siteChoisi === s.id ? "actif" : ""}" data-site="${esc(s.id)}">🏡 ${esc(s.name)}${ret ? ` <span class="ev-badge">${ret} en retard</span>` : ""}</button>`;
      }).join("") || `<div class="hint">Aucun site MNA trouvé.</div>`}</div>
      ${EDITEURS.includes(user?.role) ? `<div class="hint">Il manque un site ? Dans 🏠 Dossiers de site, mets « MNA » dans son groupe.</div>` : ""}
      <label class="hint">Date de l'intervention <input type="date" class="ev-date" value="${esc(ui.date)}" max="${dateKey(new Date())}"></label>
      <div><button class="nav-btn ev-gros" data-act="commencer" ${ui.siteChoisi ? "" : "disabled"}>📝 Ouvrir la feuille</button></div>
    </div>
    <div class="form-card">
      <b>${EDITEURS.includes(user?.role) ? "Dernières interventions" : "Mes dernières interventions"}</b>
      ${miens.length ? miens.map(p => `
        <div class="ev-ligne" data-ouvrir="${esc(p.id)}">
          <div><b>${esc(p.siteName || "")}</b> · ${esc(fmt(p.date))}<br><small class="hint">${esc(p.agentNom || "")} · ${tachesFaites(p).map(t => t.label).join(", ") || "rien de coché"}</small></div>
          <span>›</span>
        </div>`).join("") : `<div class="hint">Aucune intervention pour l'instant.</div>`}
    </div>`;
}

function blocPrecedent(prec) {
  if (!prec) return `<div class="form-card ev-prec"><b>📋 Passage précédent</b><div class="hint">C'est le premier passage enregistré sur ce site.</div></div>`;
  suivrePhotos(prec.id, true);
  return `<details class="form-card ev-prec" open>
    <summary><b>📋 Passage précédent : ${esc(fmt(prec.date))}</b> <small class="hint">(${ilYa(joursDepuis(prec.date))}, ${esc(prec.agentNom || "")})</small></summary>
    <div class="ev-chips">${tachesFaites(prec).map(t => `<span class="ev-chip">✔ ${esc(t.label)}${prec.obs?.[t.cle] ? ` — ${esc(prec.obs[t.cle])}` : ""}</span>`).join("") || `<span class="hint">Rien de coché.</span>`}</div>
    ${prec.observations ? `<div class="ev-obs">💬 ${esc(prec.observations)}</div>` : ""}
    ${photosPrec.length ? `<div class="ev-photos">${photosPrec.map(ph => `<figure class="ev-ph"><img src="${ph.data}" alt="" data-voir><figcaption>${esc(MOMENTS[ph.moment || ""])}${ph.legende ? " · " + esc(ph.legende) : ""}</figcaption></figure>`).join("")}</div>` : ""}
  </details>`;
}

function vueFeuille(p) {
  const modif = peutModifier(p);
  const avant = dernieresDates(passages, p.siteId, p.date);
  const mois = new Date(p.date + "T00:00:00").getMonth() + 1;
  const ligne = (t) => {
    const fait = !!p.taches?.[t.cle];
    const der = avant[t.cle];
    const j = der ? joursDepuis(der, new Date(p.date + "T00:00:00")) : null;
    const enRetard = t.jours && (!t.saison || t.saison.includes(mois)) && j !== null && j > Math.round(t.jours * 1.25);
    const info = der ? `dernière fois le ${fmtCourt(der)} (${j} j)` : (t.jours ? "jamais faite ici" : "");
    return `<div class="fj-tache ${fait ? "faite" : ""}">
      <button class="fj-coche ev-coche" data-tache="${esc(t.cle)}" aria-pressed="${fait}" ${modif ? "" : "disabled"}>
        <span class="fj-rond"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>
        <span class="fj-label">${esc(t.label)}${info ? `<small class="fj-derniere ${enRetard ? "ev-retard" : ""}">${enRetard ? "⚠️ " : ""}${esc(info)}</small>` : ""}</span>
      </button>
      ${fait ? `<input class="ev-note" data-note="${esc(t.cle)}" value="${esc(p.obs?.[t.cle] || "")}" placeholder="Précision (facultatif)" ${modif ? "" : "disabled"}>` : ""}
    </div>`;
  };
  const vignettes = photos.map(ph => `<figure class="ev-ph"><img src="${ph.data}" alt="" data-voir>
      <figcaption>
        <select data-ph-moment="${esc(ph.id)}" ${modif ? "" : "disabled"}>${Object.entries(MOMENTS).map(([k, v]) => `<option value="${k}" ${(ph.moment || "") === k ? "selected" : ""}>${v}</option>`).join("")}</select>
        <input data-ph-leg="${esc(ph.id)}" value="${esc(ph.legende || "")}" placeholder="Légende" ${modif ? "" : "disabled"}>
        ${modif ? `<button class="del-btn" data-ph-del="${esc(ph.id)}" title="Supprimer">🗑️</button>` : ""}
      </figcaption></figure>`).join("");
  return `
    <div class="ev-entete">
      <button class="nav-btn" data-act="retour">← Retour</button>
      <small class="ev-statut hint">${esc(statut)}</small>
    </div>
    ${(() => { const faits = TACHES.filter(t => p.taches?.[t.cle]).length, total = TACHES.length, pct = total ? Math.round(faits / total * 100) : 0, r = 40, c = 2 * Math.PI * r;
      return `<div class="fj ev-fj"><div class="fj-hero">
        <div class="fj-hero-txt">
          <div class="fj-bonjour">🌿 ${esc(p.siteName || "")}</div>
          <div class="fj-date">${esc(fmt(p.date))} · ${esc(p.agentNom || "")}</div>
          <div class="fj-msg">${faits ? `${faits} tâche${faits > 1 ? "s" : ""} cochée${faits > 1 ? "s" : ""} pour ce passage.` : "Coche ce qui a été fait pendant ce passage."}</div>
        </div>
        <div class="fj-hero-anneau"><svg class="fj-anneau" viewBox="0 0 100 100" width="92" height="92" aria-hidden="true"><circle cx="50" cy="50" r="${r}" class="fj-anneau-fond"/><circle cx="50" cy="50" r="${r}" class="fj-anneau-val" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct / 100)}"/></svg>
          <div class="fj-anneau-txt"><b>${pct}%</b><span>${faits}/${total}</span></div></div>
      </div></div>`; })()}
    <div class="ev-grille">
      <div>
        <div class="fj">${GROUPES.map((g, gi) => { const f = g.taches.filter(t => p.taches?.[t.cle]).length, n = g.taches.length, fini = n && f === n;
          return `<div class="fj-piece ${fini ? "finie" : ""}">
          <div class="fj-piece-tete"><div class="fj-piece-nom">${g.icone} ${esc(g.nom)}</div><div class="fj-piece-compte">${f}/${n}</div>${modif ? `<button class="fj-tout" data-ev-tout="${gi}">${fini ? "↺ Tout décocher" : "✓ Tout fait"}</button>` : ""}</div>
          <div class="fj-piece-barre"><span style="width:${n ? f / n * 100 : 0}%"></span></div>
          ${g.taches.map(ligne).join("")}</div>`; }).join("")}</div>
        <div class="form-card">
          <b>💬 Observations</b>
          <textarea class="ev-observations" rows="3" placeholder="Problème constaté, matériel, à prévoir au prochain passage…" ${modif ? "" : "disabled"}>${esc(p.observations || "")}</textarea>
        </div>
        <div class="form-card">
          <b>📷 Photos</b>
          ${modif ? `<div class="ev-ph-btns">${["avant", "apres", ""].map(m => `<label class="nav-btn">📷 ${MOMENTS[m]}<input type="file" accept="image/*" capture="environment" data-ph-add="${m}" hidden multiple></label>`).join("")}</div>` : ""}
          <div class="ev-photos">${vignettes || `<span class="hint">Aucune photo.</span>`}</div>
        </div>
        <div class="ev-actions">
          <button class="nav-btn ev-gros" data-act="retour">✔️ Terminer</button>
          ${modif ? `<button class="nav-btn" data-act="supprimer">🗑️ Supprimer cette feuille</button>` : ""}
        </div>
      </div>
      <div>${blocPrecedent(passagePrecedent(p))}</div>
    </div>`;
}

// ---------- Rendu : suivi ----------
function vueSuivi() {
  const annee = ui.anneeImpr;
  return `
    <div class="form-card ev-barre">
      <b>🌿 Suivi des espaces verts — sites MNA</b>
      <label class="hint">Année à imprimer <select class="ev-annee">${[0, 1, 2].map(k => new Date().getFullYear() - k).map(a => `<option ${a === annee ? "selected" : ""}>${a}</option>`).join("")}</select></label>
    </div>
    ${sitesMNA().map(s => {
      const liste = passages.filter(p => p.siteId === s.id).sort(tri);
      const dernier = liste[0];
      const retards = retardsSite(passages, s.id);
      const ouvert = ui.ouvertsSuivi.has(s.id);
      return `<div class="form-card ev-carte">
        <div class="ev-carte-tete">
          <div><b>🏡 ${esc(s.name)}</b><br><small class="hint">${dernier ? `Dernier passage : ${esc(fmt(dernier.date))} (${ilYa(joursDepuis(dernier.date))}, ${esc(dernier.agentNom || "")})` : "Aucun passage enregistré"} · ${liste.filter(p => (p.date || "").startsWith(String(new Date().getFullYear()))).length} passage(s) cette année</small></div>
          <div class="ev-actions">
            <button class="nav-btn" data-histo="${esc(s.id)}">${ouvert ? "▲ Masquer" : "📜 Historique"}</button>
            <button class="nav-btn" data-imprimer="${esc(s.id)}" ${liste.length ? "" : "disabled"}>🖨️ Imprimer</button>
          </div>
        </div>
        ${retards.length ? `<div class="ev-chips">${retards.map(r => `<span class="ev-chip ${r.jamais ? "" : "ev-chip-retard"}">${r.jamais ? "⚪" : "⚠️"} ${esc(r.label)} ${r.jamais ? "— jamais faite" : `— ${r.depuis} j (prévu tous les ${r.jours} j)`}</span>`).join("")}</div>` : dernier ? `<div class="ev-ok">✅ Rien en retard</div>` : ""}
        ${ouvert ? (liste.length ? liste.map(p => `
          <div class="ev-ligne" data-ouvrir="${esc(p.id)}">
            <div><b>${esc(fmt(p.date))}</b> · ${esc(p.agentNom || "")}<br>
              <small>${tachesFaites(p).map(t => esc(t.label) + (p.obs?.[t.cle] ? ` (${esc(p.obs[t.cle])})` : "")).join(" · ") || "rien de coché"}</small>
              ${p.observations ? `<br><small class="hint">💬 ${esc(p.observations)}</small>` : ""}
            </div><span>›</span>
          </div>`).join("") : `<div class="hint">Aucun passage.</div>`) : ""}
      </div>`;
    }).join("") || `<div class="hint">Aucun site MNA trouvé.</div>`}`;
}

function render() {
  if (!conteneur) return;
  // Ne jamais redessiner sous les doigts de quelqu'un qui tape : on attend
  // qu'il quitte le champ.
  const actif = document.activeElement;
  if (actif && conteneur.contains(actif) && actif.matches("textarea, input:not([type=file]):not([type=date])")) { renduDiffere = true; return; }
  renduDiffere = false;
  let corps;
  if (passages === null) corps = `<div class="hint" style="padding:24px;text-align:center">Chargement…</div>`;
  else if (ui.passageId) {
    const p = passageOuvert();
    if (!p) { ui.passageId = null; corps = vue === "suivi" ? vueSuivi() : vueChoix(); }
    else corps = vueFeuille(p);
  } else corps = vue === "suivi" ? vueSuivi() : vueChoix();
  conteneur.innerHTML = `${STYLE}${erreur ? `<div class="form-card" style="color:var(--red)">❌ ${esc(erreur)}</div>` : ""}${corps}`;
}

// ---------- Événements ----------
async function surClic(e) {
  const t = e.target;
  const voir = t.closest("[data-voir]");
  if (voir) { const w = window.open(); if (w) w.document.write(`<title>Photo</title><body style="margin:0;background:#000"><img src="${voir.src}" style="max-width:100%;max-height:100vh;display:block;margin:auto">`); return; }
  const site = t.closest("[data-site]");
  if (site) { ui.siteChoisi = site.dataset.site; render(); return; }
  const ouvrir = t.closest("[data-ouvrir]");
  if (ouvrir) { ui.passageId = ouvrir.dataset.ouvrir; statut = ""; suiviPrecId = null; suivrePhotos(ui.passageId, false); render(); window.scrollTo?.(0, 0); return; }
  const histo = t.closest("[data-histo]");
  if (histo) { const id = histo.dataset.histo; ui.ouvertsSuivi.has(id) ? ui.ouvertsSuivi.delete(id) : ui.ouvertsSuivi.add(id); render(); return; }
  const impr = t.closest("[data-imprimer]");
  if (impr) { imprimer(impr.dataset.imprimer); return; }
  const tout = t.closest("[data-ev-tout]");
  if (tout && ui.passageId) {
    const p = passageOuvert(); if (!peutModifier(p)) return;
    const g = GROUPES[Number(tout.dataset.evTout)]; if (!g) return;
    const fini = g.taches.every(x => p.taches?.[x.cle]);
    const taches = { ...(p.taches || {}) }; g.taches.forEach(x => { taches[x.cle] = !fini; });
    sauverPlusTard(p.id, { taches }, 300); render(); return;
  }
  const coche = t.closest(".ev-coche");
  if (coche && ui.passageId) {
    const p = passageOuvert(); if (!peutModifier(p)) return;
    const cle = coche.dataset.tache;
    const taches = { ...(p.taches || {}), [cle]: !p.taches?.[cle] };
    sauverPlusTard(p.id, { taches }, 300); render(); return;
  }
  const del = t.closest("[data-ph-del]");
  if (del) {
    if (await confirmDialog("Supprimer cette photo ?", { danger: true, texteValider: "Supprimer" })) {
      try { await supprimerPhotoEV(del.dataset.phDel); } catch (err) { toast("Échec : " + (err.message || err), "error"); }
    }
    return;
  }
  const act = t.closest("[data-act]")?.dataset.act;
  if (act === "commencer") {
    const s = sitesMNA().find(x => x.id === ui.siteChoisi); if (!s) return;
    const date = conteneur.querySelector(".ev-date")?.value || dateKey(new Date());
    try {
      const id = await creerPassage({ siteId: s.id, siteName: s.name, date, agentUid: user.uid, agentNom: user.nom || user.email || "" });
      ui.passageId = id; ui.siteChoisi = ""; statut = ""; suiviPrecId = null; suivrePhotos(id, false); render(); window.scrollTo?.(0, 0);
    } catch (err) { console.error(err); toast("Impossible de créer la feuille : " + (err.message || err), "error"); }
  } else if (act === "retour") {
    await envoyer();
    ui.passageId = null; unsubPhotos?.(); unsubPhotos = null; unsubPhotosPrec?.(); unsubPhotosPrec = null; suiviPrecId = null; photos = []; photosPrec = []; render();
  } else if (act === "supprimer") {
    const p = passageOuvert(); if (!p) return;
    if (!await confirmDialog(`Supprimer la feuille du ${fmt(p.date)} (${p.siteName}) ? Ses photos seront supprimées aussi.`, { danger: true, texteValider: "Supprimer" })) return;
    try {
      await Promise.all(photos.map(ph => supprimerPhotoEV(ph.id)));
      await supprimerPassage(p.id);
      ui.passageId = null; toast("Feuille supprimée", "success"); render();
    } catch (err) { toast("Échec : " + (err.message || err), "error"); }
  }
}

function surSaisie(e) {
  const t = e.target; const p = passageOuvert(); if (!p || !peutModifier(p)) return;
  if (t.matches(".ev-observations")) sauverPlusTard(p.id, { observations: t.value });
  else if (t.matches("[data-note]")) sauverPlusTard(p.id, { obs: { ...(p.obs || {}), [t.dataset.note]: t.value } });
  else if (t.matches("[data-ph-leg]")) { clearTimeout(t._tm); t._tm = setTimeout(() => majPhotoEV(t.dataset.phLeg, { legende: t.value }).catch(() => {}), 700); }
}

async function surChangement(e) {
  const t = e.target;
  if (t.matches(".ev-date")) { ui.date = t.value; return; }
  if (t.matches(".ev-annee")) { ui.anneeImpr = Number(t.value); return; }
  if (t.matches("[data-ph-moment]")) { majPhotoEV(t.dataset.phMoment, { moment: t.value }).catch(err => toast("Échec : " + err.message, "error")); return; }
  if (t.matches("[data-ph-add]")) {
    const p = passageOuvert(); if (!p) return;
    const fichiers = [...(t.files || [])]; t.value = "";
    for (const f of fichiers) {
      try {
        statut = "⏳ Envoi de la photo…"; majStatut();
        const data = await compresserPhoto(f);
        await ajouterPhotoEV({ passageId: p.id, siteId: p.siteId, date: p.date, agentUid: p.agentUid, moment: t.dataset.phAdd, data });
        statut = "✅ Photo ajoutée"; majStatut();
      } catch (err) { console.error(err); toast("Photo non enregistrée : " + (err.message || err), "error"); }
    }
  }
}

// ---------- Impression ----------
async function imprimer(siteId) {
  const s = sites.find(x => x.id === siteId); const annee = String(ui.anneeImpr);
  const liste = passages.filter(p => p.siteId === siteId && (p.date || "").startsWith(annee)).sort((a, b) => a.date.localeCompare(b.date));
  if (!liste.length) { toast(`Aucun passage en ${annee} sur ce site`, "info"); return; }
  const w = window.open("", "_blank");
  if (!w) { toast("Autorise les fenêtres pop-up pour imprimer", "error"); return; }
  w.document.write("<p style='font-family:sans-serif'>Préparation…</p>");
  const parPassage = {};
  try {
    const snaps = await Promise.all(liste.map(p => getDocs(query(collection(db, "espaces-verts-photos"), where("passageId", "==", p.id)))));
    snaps.forEach((sn, i) => { parPassage[liste[i].id] = sn.docs.map(d => d.data()).sort((a, b) => (a.le || 0) - (b.le || 0)); });
  } catch (e) { console.warn("Photos impression :", e); }
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Espaces verts — ${esc(s?.name || "")} — ${annee}</title>
  <style>body{font-family:Arial,sans-serif;font-size:12px;color:#111;margin:18px}h1{font-size:18px;margin:0 0 4px}h2{font-size:14px;margin:18px 0 6px;border-bottom:2px solid #3a7d44;padding-bottom:3px}
  table{border-collapse:collapse;width:100%;margin-top:4px}td,th{border:1px solid #bbb;padding:4px 6px;text-align:left;vertical-align:top}th{background:#eef5ee}
  .ph{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}.ph figure{margin:0;width:150px}.ph img{width:150px;height:110px;object-fit:cover;border:1px solid #ccc}.ph figcaption{font-size:10px;color:#555}
  .passage{page-break-inside:avoid}</style></head><body>
  <h1>Traçabilité espaces verts — ${esc(s?.name || "")}</h1>
  <div>Année ${annee} · ${liste.length} passage(s) · édité le ${new Date().toLocaleDateString("fr-FR")}</div>
  ${liste.map(p => `<div class="passage"><h2>${esc(fmt(p.date))} — ${esc(p.agentNom || "")}</h2>
    <table><tr><th>Prestation</th><th>Fait</th><th>Précision</th></tr>
    ${TACHES.map(t => `<tr><td>${esc(t.label)}</td><td>${p.taches?.[t.cle] ? "✔" : ""}</td><td>${esc(p.obs?.[t.cle] || "")}</td></tr>`).join("")}</table>
    ${p.observations ? `<p><b>Observations :</b> ${esc(p.observations)}</p>` : ""}
    ${(parPassage[p.id] || []).length ? `<div class="ph">${parPassage[p.id].map(ph => `<figure><img src="${ph.data}"><figcaption>${esc(MOMENTS[ph.moment || ""])}${ph.legende ? " · " + esc(ph.legende) : ""}</figcaption></figure>`).join("")}</div>` : ""}
  </div>`).join("")}
  <script>window.onload=()=>setTimeout(()=>window.print(),400)<\/script></body></html>`;
  w.document.open(); w.document.write(html); w.document.close();
}

const STYLE = `<style>
  .ev-sites{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}
  .ev-site{background:var(--panel-alt);border:2px solid var(--border);color:var(--text);border-radius:12px;padding:12px 14px;font-weight:600;cursor:pointer;font-size:14px}
  .ev-site.actif{border-color:var(--teal);background:color-mix(in srgb,var(--teal) 18%,var(--panel-alt))}
  .ev-badge{display:inline-block;margin-left:6px;font-size:11px;background:var(--red);color:#fff;border-radius:10px;padding:1px 7px}
  .ev-date{margin-left:6px;padding:6px;border-radius:8px;border:1px solid var(--border);background:var(--panel-alt);color:var(--text)}
  .ev-gros{padding:12px 18px;font-size:15px;margin-top:10px}
  .ev-ligne{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 4px;border-top:1px solid var(--border);cursor:pointer}
  .ev-ligne:hover{color:var(--gold)}
  .ev-entete{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:10px}
  .ev-entete .ev-statut{margin-left:auto}
  .ev-grille{display:grid;grid-template-columns:minmax(0,3fr) minmax(0,2fr);gap:12px;align-items:start}
  @media (max-width:820px){.ev-grille{grid-template-columns:1fr}.ev-grille>div:last-child{order:-1}}
  .ev-grille .form-card{margin-bottom:10px}
  .ev-tache{display:grid;grid-template-columns:auto 1fr;gap:4px 10px;align-items:center;padding:8px 0;border-top:1px solid var(--border)}
  .ev-tache:first-of-type{border-top:none}
  .ev-coche{font-size:24px;background:none;border:none;cursor:pointer;padding:0 2px}
  .ev-tache-txt{display:flex;flex-direction:column;cursor:pointer}
  .ev-tache.fait .ev-tache-txt b{color:var(--teal)}
  .ev-retard{color:var(--red);font-weight:600}
  .ev-fj{margin-bottom:12px}
  .ev-grille .fj-piece{margin-bottom:10px}
  .fj-label .fj-derniere{display:block;text-decoration:none}
  .ev-note{margin:0 0 8px 46px;width:calc(100% - 46px);box-sizing:border-box;padding:6px 8px;border-radius:8px;border:1px solid var(--border);background:var(--panel-alt);color:var(--text);font:inherit}
  .ev-observations{width:100%;box-sizing:border-box;margin-top:6px;font:inherit;background:var(--panel-alt);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:8px}
  .ev-ph-btns{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}
  .ev-ph-btns .nav-btn{padding:10px 14px}
  .ev-photos{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
  .ev-ph{margin:0;width:150px;display:flex;flex-direction:column;gap:4px}
  .ev-ph img{width:150px;height:112px;object-fit:cover;border-radius:8px;border:1px solid var(--border);cursor:zoom-in}
  .ev-ph figcaption{display:flex;flex-direction:column;gap:3px;font-size:12px;color:var(--text-dim)}
  .ev-ph select,.ev-ph input{font-size:12px;padding:3px 5px;border-radius:6px;border:1px solid var(--border);background:var(--panel-alt);color:var(--text)}
  .ev-prec summary{cursor:pointer}
  .ev-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
  .ev-chip{font-size:12px;padding:3px 9px;border-radius:12px;background:var(--panel-alt);border:1px solid var(--border)}
  .ev-chip-retard{border-color:var(--red);color:var(--red)}
  .ev-obs{margin-top:8px;font-size:13px}
  .ev-ok{margin-top:8px;color:var(--teal);font-size:13px}
  .ev-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
  .ev-carte-tete{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:flex-start}
  .ev-carte{margin-bottom:10px}
  .ev-barre{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:10px}
  .ev-barre select{margin-left:6px}
</style>`;

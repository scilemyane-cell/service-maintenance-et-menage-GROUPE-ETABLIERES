// camileia-test.js — Écran de TEST du lien Camileia ↔ Suivi des demandes
// (Suivi des demandes › Camileia, version de test, Super Admin seulement).
//
// But : vérifier, avant de remplacer l'Excel par Camileia, que
//  1) l'appli joint l'API (direct ou via le relais),
//  2) les DI Camileia se traduisent correctement en demandes de l'appli,
//  3) l'appli sait renvoyer un message / un changement d'état à Camileia.
// AUCUNE demande n'est créée ni modifiée dans l'appli depuis cet écran
// (simulation seulement). Les seules écritures possibles vont vers Camileia,
// sur une DI choisie, après confirmation.
import { esc } from "./astreinte-logic.js";
import { db } from "./firebase-init.js";
import { doc, getDoc, getDocs, setDoc, updateDoc, collection, serverTimestamp } from "./firestore-compte.js";
import * as cam from "./camileia.js";
import { diVersDemande, rapprocherDI, statutPropose, STATUTS_SMM } from "./camileia-demandes.js";

const REF_CORRESP = doc(db, "config", "camileia-correspondances");
let racine = null;
const st = {
  occupe: "", erreur: "", info: "",
  refs: null, dis: [], demandes: [], libelles: new Map(), correspondances: {},
  rapprochement: null, ouverte: null, brut: null, toutes: false,
};

export async function mountCamileiaTest(container) {
  racine = container;
  await cam.chargerRelaisPartage();
  import("./camileia-synchro.js").then(m => { etatAuto = m.etat; m.surEtat((e) => { etatAuto = e; const z = document.getElementById("cam-auto"); if (z) z.outerHTML = autoHTML(); }); }).catch(() => {});
  try { st.correspondances = (await getDoc(REF_CORRESP))?.data()?.etats || {}; } catch { st.correspondances = {}; }
  rendre();
}

const occuper = async (msg, f) => {
  st.occupe = msg; st.erreur = ""; st.info = ""; rendre();
  try { await f(); } catch (e) { console.error(e); st.erreur = e.message || String(e); }
  st.occupe = ""; rendre();
};

function rendre() {
  if (!racine || !document.contains(racine)) return;
  const cfg = cam.lireConfig();
  const connecte = cam.estConnecte();
  racine.innerHTML = `
  <div class="stack">
    <p class="hint">🧪 <b>Test du lien Camileia.</b> Cet écran lit les demandes d'intervention de Camileia et montre comment elles arrivent dans le Suivi des demandes. « Créer les tickets » les ajoute à l'onglet <b>Demandes</b> de la <b>version de test uniquement</b> : visibles par toi seul, jamais par l'équipe. Quand tu modifies un de ces tickets (statut, commentaire), l'état et le commentaire repartent dans Camileia.</p>
    ${autoHTML()}
    ${st.erreur ? `<div class="form-card" style="border-left:4px solid #e53935"><b>⚠️ ${esc(st.erreur)}</b></div>` : ""}
    ${st.info ? `<div class="form-card" style="border-left:4px solid #43a047">${esc(st.info)}</div>` : ""}
    ${st.occupe ? `<div class="hint">⏳ ${esc(st.occupe)}</div>` : ""}

    <div class="form-card">
      <h3 style="margin:0 0 6px;font-size:15px">1. Connexion à l'API</h3>
      <label style="margin-right:14px"><input type="radio" name="cam-mode" value="direct" ${cfg.mode === "direct" ? "checked" : ""}> Direct (navigateur)</label>
      <label><input type="radio" name="cam-mode" value="relais" ${cfg.mode === "relais" ? "checked" : ""}> Relais (Apps Script)</label>
      ${cfg.mode === "direct" ? `
        <p class="hint" style="margin:6px 0">Identifiants API reçus de Camileia. Ils ne sont <b>jamais enregistrés</b> : seul le jeton est gardé jusqu'à la fermeture de l'onglet.</p>
        ${connecte ? `<div class="stat-chip ok" style="width:fit-content">✓ Connecté</div> <button class="nav-btn" id="cam-deco">Se déconnecter</button>` : `
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <input id="cam-id" placeholder="Identifiant API" autocomplete="off" style="max-width:200px">
          <input id="cam-mdp" type="password" placeholder="Mot de passe API" autocomplete="new-password" style="max-width:200px">
          <button class="add-btn" id="cam-co">Se connecter</button>
        </div>`}` : `
        <p class="hint" style="margin:6px 0">Adresse de l'application Web Apps Script (voir <code>outils/camileia-relais.gs</code>) et sa clé de relais.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <input id="cam-relais" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(cfg.relaisUrl)}" style="min-width:320px">
          <input id="cam-cle" type="password" placeholder="Clé du relais" value="${esc(cfg.relaisCle)}" style="max-width:200px">
          <button class="add-btn" id="cam-relais-ok">Enregistrer</button>
        </div>`}
    </div>

    <div class="form-card">
      <h3 style="margin:0 0 6px;font-size:15px">2. Lire les demandes Camileia</h3>
      <label class="hint"><input type="checkbox" id="cam-toutes" ${st.toutes ? "checked" : ""}> Toutes les pages (sinon les 3 premières, pour un test rapide)</label><br>
      <button class="add-btn" id="cam-lire" ${!connecte || st.occupe ? "disabled" : ""}>📥 Lire les DI</button>
      ${st.refs ? resumeRefs() : ""}
    </div>

    ${st.refs ? correspondancesHTML() : ""}
    ${cam.estConnecte() ? correspSitesHTML() : ""}
    ${cam.estConnecte() ? correspTypesHTML() : ""}
    ${cam.estConnecte() ? correspContactsHTML() : ""}
    ${cam.estConnecte() ? creationHTML() : ""}
    ${st.dis.length ? simulationHTML() : ""}
    ${st.dis.length ? tableauHTML() : ""}
    ${st.ouverte ? detailHTML() : ""}
  </div>`;
  brancher();
}

// ---- Correspondance des sites appli → Camileia (pour envoyer les nouvelles demandes) ----
const cs = { charge: false, sitesApp: [], camSites: [], map: {}, bats: {}, types: [], typeDefaut: "" };
function correspSitesHTML() {
  if (!cs.charge) return `<div class="form-card"><h3 style="margin:0 0 6px;font-size:15px">6. Correspondance des sites (appli → Camileia)</h3>
    <p class="hint" style="margin:0 0 8px">Nécessaire pour que « ➕ Nouvelle demande » parte aussi dans Camileia. Proposition automatique, à vérifier une fois.</p>
    <button class="nav-btn" id="cs-ouvrir" ${st.occupe ? "disabled" : ""}>🔗 Préparer la correspondance des sites</button></div>`;
  const optSites = (val) => `<option value="">— pas relié —</option>` + cs.camSites.map(s => `<option value="${esc(s["@id"])}" ${s["@id"] === val ? "selected" : ""}>${esc(s.libelle)}</option>`).join("");
  const optBats = (siteIri, val) => { const l = cs.bats[siteIri]; if (!l) return `<option value="${esc(val || "")}">${val ? "Bâtiment " + esc(String(val).split("/").pop()) : "—"}</option>`;
    return l.map(b => `<option value="${esc(b["@id"])}" ${b["@id"] === val ? "selected" : ""}>${esc(b.libelle || b["@id"].split("/").pop())}</option>`).join(""); };
  const relies = cs.sitesApp.filter(n => cs.map[n]?.site).length;
  return `<div class="form-card" style="border-left:4px solid #00897b;overflow-x:auto">
    <h3 style="margin:0 0 6px;font-size:15px">6. Correspondance des sites (appli → Camileia)</h3>
    <p class="hint" style="margin:0 0 8px">${relies} / ${cs.sitesApp.length} sites reliés. Le bâtiment se charge quand tu choisis le site (sinon le 1er bâtiment du site est utilisé).</p>
    <table class="table" style="width:100%;font-size:12px"><thead><tr><th>Site dans l'appli</th><th>Site Camileia</th><th>Bâtiment</th></tr></thead><tbody>
    ${cs.sitesApp.map((n, i) => { const m = cs.map[n] || {}; return `<tr><td>${esc(n)}</td>
      <td><select data-cs-site="${i}">${optSites(m.site)}</select></td>
      <td><select data-cs-bat="${i}" ${!m.site ? "disabled" : ""}>${optBats(m.site, m.batiment)}</select></td></tr>`; }).join("")}
    </tbody></table>
    <label style="display:block;margin-top:8px">Type de panne par défaut (si le « type » de la demande ne correspond à aucune catégorie Camileia)<br>
      <select id="cs-type">${cs.types.map(t => `<option value="${esc(t["@id"])}" ${t["@id"] === cs.typeDefaut ? "selected" : ""}>${esc(cam.libelleLisible(t.libelle))}</option>`).join("")}</select></label>
    <button class="add-btn" id="cs-enregistrer" style="margin-top:8px">💾 Enregistrer la correspondance des sites</button>
  </div>`;
}
async function chargerCorrespSites() {
  const ev = await import("./camileia-envoi.js");
  const [r, actuelle] = await Promise.all([ev.referentiels(), ev.lireCorrespSites()]);
  if (!st.demandes.length) { const snap = await getDocs(collection(db, "demandes")); st.demandes = []; snap.forEach(x => st.demandes.push({ id: x.id, ...x.data() })); }
  cs.sitesApp = [...new Set(st.demandes.filter(d => d.source !== "camileia" && d.site && d.site !== "Non renseigné" && !d.supprimeeLe).map(d => d.site.trim()))].sort((a, b) => a.localeCompare(b, "fr"));
  cs.camSites = [...r.sites].sort((a, b) => String(a.libelle).localeCompare(b.libelle, "fr"));
  cs.types = [...r.types].sort((a, b) => cam.libelleLisible(a.libelle).localeCompare(cam.libelleLisible(b.libelle), "fr"));
  cs.typeDefaut = actuelle.typeDefaut || (cs.types.find(t => cam.libelleLisible(t.libelle).toLowerCase() === "autre") || cs.types[0] || {})["@id"] || "";
  cs.map = {};
  cs.sitesApp.forEach(n => {
    const deja = actuelle.sites?.[n];
    if (deja?.site) { cs.map[n] = { ...deja }; return; }
    const p = ev.proposerSite(n, cs.camSites);
    if (p) cs.map[n] = { site: p["@id"], siteCode: p.code || "", siteLib: p.libelle, batiment: cam.iriDe((p.batiments || [])[0]) || "", auto: true };
  });
  cs.charge = true;
}
async function chargerBatsSite(siteIri) {
  if (!siteIri || cs.bats[siteIri]) return;
  const s = cs.camSites.find(x => x["@id"] === siteIri); if (!s) return;
  cs.bats[siteIri] = await Promise.all((s.batiments || []).map(cam.iriDe).map(i => cam.appeler("GET", i).then(b => ({ ...b, "@id": i })).catch(() => ({ "@id": i }))));
}

// ---- Correspondance catégories de l'appli → types de demande Camileia ----
const ct = { charge: false, cats: [], types: [], categories: [], map: {} };
function correspTypesHTML() {
  if (!ct.charge) return `<div class="form-card"><h3 style="margin:0 0 6px;font-size:15px">7. Correspondance des catégories (appli → Camileia)</h3>
    <p class="hint" style="margin:0 0 8px">Chaque catégorie de panne de l'appli (Plomberie, Électricité…) devient un type de demande Camileia : à la création, et quand Lionel corrige la catégorie d'un ticket.</p>
    <button class="nav-btn" id="ct-ouvrir" ${st.occupe ? "disabled" : ""}>🏷️ Préparer la correspondance des catégories</button></div>`;
  const options = (val) => ct.categories.map(c => { const l = ct.types.filter(t => t.categorie === c["@id"]); return l.length ? `<optgroup label="${esc(cam.libelleLisible(c.libelle))}">${l.map(t => `<option value="${esc(t["@id"])}" ${t["@id"] === val ? "selected" : ""}>${esc(cam.libelleLisible(t.libelle))}</option>`).join("")}</optgroup>` : ""; }).join("");
  return `<div class="form-card" style="border-left:4px solid #f4511e;overflow-x:auto">
    <h3 style="margin:0 0 6px;font-size:15px">7. Correspondance des catégories (appli → Camileia)</h3>
    <table class="table" style="width:100%;font-size:12px"><thead><tr><th>Catégorie dans l'appli</th><th>Type de demande Camileia</th></tr></thead><tbody>
    ${ct.cats.map((c, i) => `<tr><td>${c.ic} ${esc(c.lib)}</td><td><select data-ct="${i}">${options(ct.map[c.id])}</select></td></tr>`).join("")}
    </tbody></table>
    <button class="add-btn" id="ct-enregistrer" style="margin-top:8px">💾 Enregistrer la correspondance des catégories</button>
  </div>`;
}
async function chargerCorrespTypes() {
  const ev = await import("./camileia-envoi.js");
  const { CATEGORIES_PANNES } = await import("./categories-pannes.js");
  const [r, m] = await Promise.all([ev.referentiels(), ev.lireCorrespTypes()]);
  ct.cats = CATEGORIES_PANNES; ct.map = { ...m };
  ct.categories = [...r.categories].sort((a, b) => cam.libelleLisible(a.libelle).localeCompare(cam.libelleLisible(b.libelle), "fr"));
  ct.types = [...r.types].sort((a, b) => cam.libelleLisible(a.libelle).localeCompare(cam.libelleLisible(b.libelle), "fr"));
  ct.charge = true;
}

// ---- Correspondance des personnes de l'appli → contacts Camileia (« Suivi par ») ----
const cc = { charge: false, users: [], contacts: [], societes: {}, map: {} };
const REF_CONTACTS = doc(db, "config", "camileia-contacts");
const san = (s) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
function correspContactsHTML() {
  if (!cc.charge) return `<div class="form-card"><h3 style="margin:0 0 6px;font-size:15px">8. Correspondance des personnes (attribution → « Suivi par »)</h3>
    <p class="hint" style="margin:0 0 8px">Quand une demande est attribuée à quelqu'un dans l'appli, cette personne devient « Suivi par » dans Camileia. Relie chaque personne de l'appli à son contact Camileia.</p>
    <button class="nav-btn" id="cc-ouvrir" ${st.occupe ? "disabled" : ""}>👷 Préparer la correspondance des personnes</button></div>`;
  const opts = (val) => `<option value="">— pas dans Camileia —</option>` + Object.entries(cc.societes).map(([sIri, nomS]) => { const l = cc.contacts.filter(c => (c.societe || "") === sIri); return l.length ? `<optgroup label="${esc(nomS)}">${l.map(c => `<option value="${c.id}" ${String(c.id) === String(val) ? "selected" : ""}>${esc(`${c.prenom || ""} ${c.nom || ""}`.trim())}${c.utilisateur ? "" : " (sans compte)"}</option>`).join("")}</optgroup>` : ""; }).join("");
  return `<div class="form-card" style="border-left:4px solid #6d4c41;overflow-x:auto">
    <h3 style="margin:0 0 6px;font-size:15px">8. Correspondance des personnes (attribution → « Suivi par »)</h3>
    <table class="table" style="width:100%;font-size:12px"><thead><tr><th>Personne dans l'appli</th><th>Contact Camileia</th></tr></thead><tbody>
    ${cc.users.map((u, i) => `<tr><td>${esc(u.nom || u.email || u.uid)}<br><small>${esc(u.email || "")}</small></td><td><select data-cc="${i}">${opts(cc.map[u.uid])}</select></td></tr>`).join("")}
    </tbody></table>
    <button class="add-btn" id="cc-enregistrer" style="margin-top:8px">💾 Enregistrer la correspondance des personnes</button>
  </div>`;
}
async function chargerCorrespContacts() {
  const ev = await import("./camileia-envoi.js");
  const [r, snap, cfg, socs] = await Promise.all([ev.referentiels(), getDocs(collection(db, "users")), getDoc(REF_CONTACTS), cam.lireTout(`${cam.RACINE}/societes`, { maxPages: 2 })]);
  cc.contacts = [...r.contacts].sort((a, b) => `${a.nom} ${a.prenom}`.localeCompare(`${b.nom} ${b.prenom}`, "fr"));
  cc.societes = {}; socs.forEach(x => { cc.societes[`${cam.RACINE}/societes/${x.id}`] = x.libelle || x.nom || x.raisonsociale || `Société ${x.id}`; });
  const vus = new Set(cc.contacts.map(c => c.societe || "")); Object.keys(cc.societes).forEach(k => { if (!vus.has(k)) delete cc.societes[k]; });
  if (vus.has("")) cc.societes[""] = "Sans société";
  cc.users = []; snap.forEach(d => cc.users.push({ uid: d.id, ...d.data() }));
  cc.users = cc.users.filter(u => !u.desactive && u.actif !== false).sort((a, b) => (a.nom || a.email || "").localeCompare(b.nom || b.email || "", "fr"));
  const enreg = cfg?.data()?.map || {};
  cc.map = {};
  cc.users.forEach(u => {
    if (enreg[u.uid] !== undefined) { cc.map[u.uid] = enreg[u.uid]; return; }
    const parMail = u.email && cc.contacts.find(c => String(c.email || "").toLowerCase() === String(u.email).toLowerCase());
    const n = san(u.nom); const parNom = n && cc.contacts.filter(c => { const a = san(`${c.prenom} ${c.nom}`), b = san(`${c.nom} ${c.prenom}`); return a === n || b === n || (san(c.prenom) && n.split(" ")[0] === san(c.prenom) && n.includes(san(c.nom))); });
    cc.map[u.uid] = parMail ? parMail.id : (parNom && parNom.length === 1 ? parNom[0].id : "");
  });
  cc.charge = true;
}

// ---- Créer une DI dans Camileia (test) ----
const cr = { charge: false, sites: [], batiments: [], categories: [], types: [], priorites: [], etats: [], contacts: [], site: "", bat: "", cat: "", type: "", prio: "", createur: "", resultat: null };
function creationHTML() {
  if (!cr.charge) return `<div class="form-card"><h3 style="margin:0 0 6px;font-size:15px">5. Créer une DI dans Camileia</h3>
    <p class="hint" style="margin:0 0 8px">Crée une vraie demande d'intervention dans Camileia (GMAO en test chez vous), comme un demandeur.</p>
    <button class="nav-btn" id="cam-cr-ouvrir" ${st.occupe ? "disabled" : ""}>➕ Préparer une nouvelle DI</button></div>`;
  const opt = (liste, val, lib = (x) => cam.libelleLisible(x.libelle)) => `<option value="">— choisir —</option>` + liste.map(x => `<option value="${esc(x["@id"])}" ${x["@id"] === val ? "selected" : ""}>${esc(lib(x))}</option>`).join("");
  const typesCat = cr.types.filter(t => !cr.cat || t.categorie === cr.cat);
  return `<div class="form-card" style="border-left:4px solid #8e24aa">
    <h3 style="margin:0 0 6px;font-size:15px">5. Créer une DI dans Camileia</h3>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px">
      <label>Site<br><select id="cr-site">${opt(cr.sites, cr.site)}</select></label>
      <label>Bâtiment<br><select id="cr-bat" ${!cr.site ? "disabled" : ""}>${opt(cr.batiments, cr.bat)}</select></label>
      <label>Catégorie<br><select id="cr-cat">${opt(cr.categories, cr.cat)}</select></label>
      <label>Type de panne<br><select id="cr-type">${opt(typesCat, cr.type)}</select></label>
      <label>Priorité<br><select id="cr-prio">${opt(cr.priorites, cr.prio)}</select></label>
      <label>Créée au nom de<br><select id="cr-createur">${opt(cr.contacts, cr.createur, (c) => `${c.prenom || ""} ${c.nom || ""}`.trim())}</select></label>
    </div>
    <label style="display:block;margin-top:8px">Libellé (court) *<br><input id="cr-libelle" style="width:100%" placeholder="Ex. Fuite robinet salle 12"></label>
    <label style="display:block;margin-top:8px">Description<br><textarea id="cr-note" rows="3" style="width:100%"></textarea></label>
    <button class="add-btn" id="cam-cr-envoyer" style="margin-top:8px" ${st.occupe ? "disabled" : ""}>📤 Créer dans Camileia</button>
    ${cr.resultat ? `<p style="margin:8px 0 0">${cr.resultat}</p>` : ""}
  </div>`;
}
async function chargerCreation() {
  const L = (c) => cam.lireTout(c, { maxPages: 3 }).then(l => cam.avecLibellesWeb(cam.avecIri(l, c), c));
  const [sites, categories, types, priorites, etats, contacts] = await Promise.all([
    L(`${cam.RACINE}/sites`), L(`${cam.RACINE}/d_i_categorie_type_pannes`), L(`${cam.RACINE}/d_i_type_pannes`),
    L(`${cam.RACINE}/d_i_priorites`), L(`${cam.RACINE}/d_i_etats`), L(`${cam.RACINE}/contacts`)]);
  const actif = (x) => x.actif !== false && x.visible !== false;
  cr.sites = sites.filter(x => x.actif !== false).sort((a, b) => String(a.libelle).localeCompare(b.libelle, "fr"));
  cr.categories = categories.filter(actif).sort((a, b) => cam.libelleLisible(a.libelle).localeCompare(cam.libelleLisible(b.libelle), "fr"));
  cr.types = types.filter(actif).sort((a, b) => cam.libelleLisible(a.libelle).localeCompare(cam.libelleLisible(b.libelle), "fr"));
  cr.priorites = priorites; cr.etats = etats;
  cr.contacts = contacts.filter(c => c.actif !== false).sort((a, b) => String(a.nom).localeCompare(b.nom, "fr"));
  // Par défaut : le contact Camileia qui a l'adresse mail de la personne connectée.
  const mail = String(window.__smmEmail || (await import("./firebase-init.js")).auth?.currentUser?.email || "").toLowerCase();
  cr.createur = (cr.contacts.find(c => String(c.email || "").toLowerCase() === mail) || {})["@id"] || "";
  cr.charge = true;
}
async function chargerBatiments(siteIri) {
  cr.batiments = []; cr.bat = "";
  const site = cr.sites.find(x => x["@id"] === siteIri); if (!site) return;
  const iris = (site.batiments || []).map(cam.iriDe);
  const lus = await Promise.all(iris.map(i => cam.appeler("GET", i).then(b => ({ ...b, "@id": i })).catch(() => ({ "@id": i, libelle: i.split("/").pop() }))));
  cr.batiments = lus;
  if (lus.length === 1) cr.bat = lus[0]["@id"];
}
async function envoyerCreation() {
  const $ = (id) => document.getElementById(id);
  const libelle = $("cr-libelle").value.trim(), note = $("cr-note").value.trim();
  const manque = [!cr.site && "site", !cr.bat && "bâtiment", !cr.type && "type de panne", !libelle && "libellé"].filter(Boolean);
  if (manque.length) { st.erreur = `À remplir : ${manque.join(", ")}.`; rendre(); return; }
  const site = cr.sites.find(x => x["@id"] === cr.site);
  const etat = (cr.etats.find(e => /aqualifier/i.test(String(e.libelle).replace(/[^a-z]/gi, ""))) || cr.etats[0] || {})["@id"];
  const contact = cr.contacts.find(c => c["@id"] === cr.createur);
  if (!confirm(`Créer cette DI dans Camileia ?\n\n${site?.libelle} — ${libelle}`)) return;
  await occuper("Création dans Camileia…", async () => {
    const r = await cam.creerDI({ libelle, note, site: cr.site, siteCode: site?.code, batiment: cr.bat, typepanne: cr.type, priorite: cr.prio, etat, createur: cr.createur, demandeur: contact ? `${contact.prenom || ""} ${contact.nom || ""}`.trim() : null });
    cr.resultat = `✅ DI créée dans Camileia : <b>${esc(r?.numero || ("n° " + (r?.id ?? "?")))}</b>. Clique « 📥 Lire les DI » puis « 🎫 Créer les tickets » pour la voir dans l'appli.`;
    st.info = "DI créée dans Camileia.";
  });
}

let etatAuto = null;
function autoHTML() {
  const e = etatAuto; if (!e?.actif) return `<div id="cam-auto"></div>`;
  const quand = e.derniere ? new Date(e.derniere).toLocaleTimeString("fr-FR") : "—";
  return `<div class="hint" id="cam-auto">🔄 Vérification automatique toutes les minutes${e.enCours ? " (en cours…)" : ""} · dernière : ${quand}${e.derniere && !e.erreur ? ` · ${e.crees} créé(s), ${e.majs} mis à jour` : ""}${e.erreur ? ` · <span style="color:#e53935">⚠️ ${esc(e.erreur)}</span>` : ""}</div>`;
}

function resumeRefs() {
  const l = (k, nom) => { const r = st.refs[k] || []; return `<li>${nom} : ${r.erreur ? `<span style="color:#e53935">${esc(r.erreur)}</span>` : `${r.length}`}</li>`; };
  return `<ul class="hint" style="margin:8px 0 0">${l("etats", "États")}${l("priorites", "Priorités")}${l("typesPanne", "Types de panne")}${l("categories", "Catégories")}${l("types", "Types")}<li><b>${st.dis.length} DI lues</b></li></ul>`;
}

function correspondancesHTML() {
  const etats = st.refs.etats || [];
  if (!etats.length) return "";
  return `<div class="form-card">
    <h3 style="margin:0 0 6px;font-size:15px">3. Correspondance des états</h3>
    <p class="hint" style="margin:0 0 8px">Chaque état Camileia devient un statut de l'appli. Proposition automatique à vérifier ; « Enregistrer » garde ton choix (réglage partagé, n'affecte aucune demande).</p>
    <table class="table" style="width:100%;font-size:13px"><thead><tr><th>État Camileia</th><th>Statut dans l'appli</th><th>DI</th></tr></thead><tbody>
    ${etats.map(e => { const iri = cam.iriDe(e); const choix = st.correspondances[iri] || statutPropose(cam.libelleLisible(e.libelle)) || ""; const n = st.dis.filter(d => d.camileiaEtatIri === iri).length;
      return `<tr><td>${esc(cam.libelleLisible(e.libelle))}</td><td><select data-etat="${esc(iri)}">${["", ...STATUTS_SMM].map(s => `<option value="${esc(s)}" ${s === choix ? "selected" : ""}>${s ? esc(s) : "— à choisir —"}</option>`).join("")}</select>${st.correspondances[iri] ? "" : ` <span class="hint">(auto)</span>`}</td><td>${n}</td></tr>`; }).join("")}
    </tbody></table>
    <button class="nav-btn" id="cam-corresp-ok" style="margin-top:8px">💾 Enregistrer la correspondance</button>
  </div>`;
}

function simulationHTML() {
  const r = st.rapprochement; if (!r) return "";
  const sansStatut = st.dis.filter(d => !d.statut || d.statut === "Non renseigné").length;
  const lieux = st.dis.filter(d => d.lieuxNonResolus.length).length;
  return `<div class="form-card">
    <h3 style="margin:0 0 6px;font-size:15px">4. Simulation de l'import (rien n'est écrit)</h3>
    <ul style="margin:0">
      <li><b>${r.nouvelles.length}</b> DI seraient créées dans le Suivi des demandes</li>
      <li><b>${r.existantes.length}</b> correspondent déjà à une demande de l'appli${r.existantes.filter(x => x.ecarts.length).length ? ` (dont ${r.existantes.filter(x => x.ecarts.length).length} avec des écarts)` : ""}</li>
      <li>${sansStatut} sans statut précis (état non relié ou « nouvelle »)</li>
      ${lieux ? `<li style="color:#e65100">${lieux} DI avec un site / bâtiment / local illisible par ce compte API (seul le lien technique est fourni)</li>` : ""}
    </ul>
    <button class="add-btn" id="cam-creer" style="margin-top:10px" ${st.occupe ? "disabled" : ""}>🎫 Créer / mettre à jour les tickets (test)</button>
    <p class="hint" style="margin:6px 0 0">Tickets visibles seulement dans la version de test, par toi. Relancer ne crée pas de doublon : les tickets existants sont mis à jour (le statut seulement s'il n'a pas été touché dans l'appli).</p>
  </div>`;
}

const saT = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
async function creerTickets() {
  const { synchroniser } = await import("./camileia-synchro.js");
  const r = await synchroniser();
  st.info = `${r.crees} ticket(s) créé(s), ${r.majs} mis à jour. Va dans l'onglet « Demandes » (version de test).`;
}

function tableauHTML() {
  const ex = new Map((st.rapprochement?.existantes || []).map(x => [String(x.cam.camileiaId), x]));
  return `<div class="form-card" style="overflow-x:auto">
    <h3 style="margin:0 0 6px;font-size:15px">DI traduites au format de l'appli</h3>
    <table class="table" style="width:100%;font-size:12px"><thead><tr><th>N°</th><th>Date</th><th>Site</th><th>Descriptif</th><th>État Camileia → statut</th><th>Urgence</th><th>Dans l'appli</th></tr></thead><tbody>
    ${st.dis.slice(0, 300).map(d => { const e = ex.get(String(d.camileiaId));
      return `<tr data-di="${esc(String(d.camileiaId))}" style="cursor:pointer">
        <td><b>${esc(d.numero)}</b></td><td>${esc(d.dateDemande.split("-").reverse().join("/"))}</td>
        <td>${esc(d.site)}${d.local ? `<br><span class="hint">${esc(d.local)}</span>` : ""}</td>
        <td>${esc(d.descriptif.slice(0, 90))}</td>
        <td>${esc(d.camileiaEtat || "?")} → <b>${esc(d.statut)}</b></td><td>${esc(d.urgence)}</td>
        <td>${e ? (e.ecarts.length ? `⚠️ écarts : ${esc(e.ecarts.join(", "))}` : "✓ déjà") : "🆕 nouvelle"}</td></tr>`; }).join("")}
    </tbody></table>
    ${st.dis.length > 300 ? `<p class="hint">300 premières affichées sur ${st.dis.length}.</p>` : ""}
  </div>`;
}

function detailHTML() {
  const d = st.ouverte;
  const etats = st.refs?.etats || [];
  return `<div class="form-card" style="border-left:4px solid #1e88e5">
    <h3 style="margin:0 0 6px;font-size:15px">DI ${esc(d.numero)} — tests d'envoi vers Camileia</h3>
    <p class="hint" style="margin:0 0 8px">Ces boutons écrivent <b>dans Camileia</b> (visible par le demandeur). À faire sur une DI de test.</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
      <input id="cam-msg" placeholder="Message / compte rendu" style="min-width:280px">
      <button class="nav-btn" id="cam-envoyer-msg">💬 Envoyer le message</button>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
      <select id="cam-nouvel-etat">${etats.map(e => `<option value="${esc(cam.iriDe(e))}" ${cam.iriDe(e) === d.camileiaEtatIri ? "selected" : ""}>${esc(cam.libelleLisible(e.libelle))}</option>`).join("")}</select>
      <button class="nav-btn" id="cam-changer-etat">🔄 Changer l'état</button>
    </div>
    <button class="nav-btn" id="cam-brut">🔍 Voir la DI brute (diagnostic)</button>
    <button class="nav-btn" id="cam-fermer">Fermer</button>
    ${st.brut ? `<pre style="max-height:320px;overflow:auto;font-size:11px;background:rgba(0,0,0,.06);padding:8px;white-space:pre-wrap">${esc(JSON.stringify(st.brut, null, 2))}</pre>` : ""}
  </div>`;
}

// Lieux (site, bâtiment, local, zone) : IRI d'autres modules Camileia.
// On tente de les lire une fois chacun ; si le compte n'y a pas accès, la DI
// garde le lien technique (signalé dans la simulation).
async function resoudreLieux(brutes) {
  const iris = new Set();
  brutes.forEach(di => ["site", "batiment", "local", "zone"].forEach(k => { const i = cam.iriDe(di[k]); if (i && !cam.libelleDe(di[k]) && !st.libelles.has(i)) iris.add(i); }));
  let echecs = 0, n = 0;
  for (const iri of [...iris].slice(0, 150)) {
    if (echecs >= 3 && n === echecs) break; // aucun accès à ces ressources : inutile d'insister
    n++; st.occupe = `Lecture des lieux ${n} / ${Math.min(iris.size, 150)}…`; rendre();
    try { const r = await cam.appeler("GET", iri); const l = cam.libelleDe(r); if (l) st.libelles.set(iri, l); else echecs++; }
    catch { echecs++; }
  }
}

async function lireDI() {
  st.refs = await cam.lireReferentiels((m) => { st.occupe = m; rendre(); });
  st.libelles = new Map();
  Object.values(st.refs).forEach(liste => liste.forEach(x => { const i = cam.iriDe(x); if (i) st.libelles.set(i, cam.libelleLisible(x.libelle || x.label || "")); }));
  const brutes = cam.avecIri(await cam.lireTout(`${cam.RACINE}/d_is`, { maxPages: st.toutes ? 200 : 3, onPage: (p, n) => { st.occupe = `Lecture des DI : page ${p} (${n})…`; rendre(); } }), `${cam.RACINE}/d_is`);
  st.brutes = brutes;
  await resoudreLieux(brutes);
  st.occupe = "Comparaison avec les demandes de l'appli…"; rendre();
  const snap = await getDocs(collection(db, "demandes"));
  st.demandes = []; snap.forEach(x => st.demandes.push({ id: x.id, ...x.data() }));
  traduire();
  st.info = `${st.dis.length} DI lues et traduites.`;
}
function traduire() {
  st.dis = (st.brutes || []).map(di => ({ ...diVersDemande(di, { libelles: st.libelles, correspondances: st.correspondances }), _brut: di }));
  st.rapprochement = rapprocherDI(st.dis, st.demandes);
}

function brancher() {
  const $ = (id) => document.getElementById(id);
  racine.querySelectorAll('input[name="cam-mode"]').forEach(r => r.addEventListener("change", () => { cam.enregistrerConfig({ mode: r.value }); rendre(); }));
  $("cam-co")?.addEventListener("click", () => {
    const id = $("cam-id").value.trim(), mdp = $("cam-mdp").value;
    if (!id || !mdp) { st.erreur = "Identifiant et mot de passe requis."; rendre(); return; }
    occuper("Connexion…", async () => { await cam.connecter(id, mdp); st.info = "Connecté à l'API Camileia."; });
  });
  $("cam-deco")?.addEventListener("click", () => { cam.deconnecter(); rendre(); });
  $("cam-relais-ok")?.addEventListener("click", () => occuper("Enregistrement du relais…", async () => {
    const url = $("cam-relais").value.trim(), cle = $("cam-cle").value;
    cam.enregistrerConfig({ mode: "relais", relaisUrl: url, relaisCle: cle });
    await cam.partagerRelais(url, cle);
    st.info = "Relais enregistré pour tous tes appareils (Super Admin seulement).";
  }));
  $("cam-toutes")?.addEventListener("change", (e) => { st.toutes = e.target.checked; });
  $("cam-lire")?.addEventListener("click", () => occuper("Lecture…", lireDI));
  $("cam-creer")?.addEventListener("click", () => occuper("Création des tickets…", creerTickets));
  $("cam-cr-ouvrir")?.addEventListener("click", () => occuper("Chargement des sites, types de panne et contacts…", chargerCreation));
  const garder = () => { const l = $("cr-libelle"), n = $("cr-note"); return { l: l?.value || "", n: n?.value || "" }; };
  const remettre = (g) => { if ($("cr-libelle")) $("cr-libelle").value = g.l; if ($("cr-note")) $("cr-note").value = g.n; };
  $("cr-site")?.addEventListener("change", (e) => { const g = garder(); cr.site = e.target.value; occuper("Lecture des bâtiments…", () => chargerBatiments(cr.site)).then(() => remettre(g)); });
  $("cr-bat")?.addEventListener("change", (e) => { cr.bat = e.target.value; });
  $("cr-cat")?.addEventListener("change", (e) => { const g = garder(); cr.cat = e.target.value; cr.type = ""; rendre(); remettre(g); });
  $("cr-type")?.addEventListener("change", (e) => { cr.type = e.target.value; });
  $("cr-prio")?.addEventListener("change", (e) => { cr.prio = e.target.value; });
  $("cr-createur")?.addEventListener("change", (e) => { cr.createur = e.target.value; });
  $("cam-cr-envoyer")?.addEventListener("click", envoyerCreation);
  $("ct-ouvrir")?.addEventListener("click", () => occuper("Lecture des types de demande Camileia…", chargerCorrespTypes));
  $("cc-ouvrir")?.addEventListener("click", () => occuper("Lecture des contacts Camileia…", chargerCorrespContacts));
  racine.querySelectorAll("select[data-cc]").forEach(sel => sel.addEventListener("change", () => { cc.map[cc.users[+sel.dataset.cc].uid] = sel.value; }));
  $("cc-enregistrer")?.addEventListener("click", () => occuper("Enregistrement…", async () => {
    await setDoc(REF_CONTACTS, { map: cc.map, le: serverTimestamp() });
    st.info = "Correspondance des personnes enregistrée.";
  }));
  racine.querySelectorAll("select[data-ct]").forEach(sel => sel.addEventListener("change", () => { ct.map[ct.cats[+sel.dataset.ct].id] = sel.value; }));
  $("ct-enregistrer")?.addEventListener("click", () => occuper("Enregistrement…", async () => {
    await (await import("./camileia-envoi.js")).enregistrerCorrespTypes(ct.map);
    st.info = "Correspondance des catégories enregistrée.";
  }));
  $("cs-ouvrir")?.addEventListener("click", () => occuper("Lecture des sites Camileia…", chargerCorrespSites));
  racine.querySelectorAll("select[data-cs-site]").forEach(sel => sel.addEventListener("change", () => {
    const n = cs.sitesApp[+sel.dataset.csSite], s = cs.camSites.find(x => x["@id"] === sel.value);
    if (!s) { delete cs.map[n]; rendre(); return; }
    cs.map[n] = { site: s["@id"], siteCode: s.code || "", siteLib: s.libelle, batiment: cam.iriDe((s.batiments || [])[0]) || "" };
    occuper("Lecture des bâtiments…", () => chargerBatsSite(s["@id"]));
  }));
  racine.querySelectorAll("select[data-cs-bat]").forEach(sel => {
    const n = cs.sitesApp[+sel.dataset.csBat];
    sel.addEventListener("focus", () => { const si = cs.map[n]?.site; if (si && !cs.bats[si]) occuper("Lecture des bâtiments…", () => chargerBatsSite(si)); }, { once: true });
    sel.addEventListener("change", () => { if (cs.map[n]) { cs.map[n].batiment = sel.value; cs.map[n].batLib = sel.selectedOptions[0]?.text || ""; } });
  });
  $("cs-type")?.addEventListener("change", (e) => { cs.typeDefaut = e.target.value; });
  $("cs-enregistrer")?.addEventListener("click", () => occuper("Enregistrement…", async () => {
    const { enregistrerCorrespSites } = await import("./camileia-envoi.js");
    const sites = {}; Object.entries(cs.map).forEach(([n, m]) => { if (m?.site && m?.batiment) { const { auto, ...r } = m; sites[n] = r; } });
    await enregistrerCorrespSites({ sites, typeDefaut: cs.typeDefaut });
    st.info = `Correspondance enregistrée : ${Object.keys(sites).length} site(s) relié(s). « ➕ Nouvelle demande » peut maintenant les envoyer dans Camileia.`;
  }));
  $("cam-corresp-ok")?.addEventListener("click", () => occuper("Enregistrement…", async () => {
    const etats = {}; racine.querySelectorAll("select[data-etat]").forEach(s => { if (s.value) etats[s.dataset.etat] = s.value; });
    await setDoc(REF_CORRESP, { etats, le: Date.now() }, { merge: false });
    st.correspondances = etats; traduire(); st.info = "Correspondance enregistrée.";
    import("./camileia-synchro.js").then(m => m.oublierCorrespondances()).catch(() => {});
  }));
  racine.querySelectorAll("tr[data-di]").forEach(tr => tr.addEventListener("click", () => {
    st.ouverte = st.dis.find(d => String(d.camileiaId) === tr.dataset.di) || null; st.brut = null; rendre();
    document.getElementById("cam-fermer")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }));
  $("cam-fermer")?.addEventListener("click", () => { st.ouverte = null; st.brut = null; rendre(); });
  $("cam-brut")?.addEventListener("click", () => occuper("Lecture de la DI…", async () => { st.brut = await cam.appeler("GET", st.ouverte.camileiaIri); }));
  $("cam-envoyer-msg")?.addEventListener("click", () => {
    const texte = $("cam-msg").value.trim(); const d = st.ouverte;
    if (!texte) return;
    if (!confirm(`Envoyer ce message dans Camileia sur la DI ${d.numero} ?\n\n« ${texte} »`)) return;
    occuper("Envoi du message…", async () => {
      await cam.appeler("POST", `${cam.RACINE}/d_i_messages`, { di: d.camileiaIri, message: texte, date: new Date().toISOString() });
      st.info = `Message envoyé sur la DI ${d.numero}. Vérifie dans Camileia.`;
    });
  });
  $("cam-changer-etat")?.addEventListener("click", () => {
    const d = st.ouverte, iri = $("cam-nouvel-etat").value;
    const libBrut = (st.refs?.etats || []).find(e => cam.iriDe(e) === iri)?.libelle; const lib = cam.libelleLisible(libBrut || iri);
    if (iri === d.camileiaEtatIri) { st.info = "C'est déjà l'état actuel."; rendre(); return; }
    if (!confirm(`Passer la DI ${d.numero} de « ${d.camileiaEtat} » à « ${lib} » dans Camileia ?`)) return;
    occuper("Changement d'état…", async () => {
      // L'API n'a que PUT (remplacement complet) : on relit la DI juste avant
      // pour ne rien écraser de ce qui a pu changer dans Camileia entre-temps.
      const actuelle = await cam.appeler("GET", d.camileiaIri);
      const corps = { ...actuelle, etat: iri };
      ["@context", "@type"].forEach(k => delete corps[k]);
      // Champs liés renvoyés en objet : l'API attend leur IRI.
      Object.keys(corps).forEach(k => { const v = corps[k]; if (v && typeof v === "object" && !Array.isArray(v) && v["@id"]) corps[k] = v["@id"]; if (Array.isArray(v)) corps[k] = v.map(x => (x && typeof x === "object" && x["@id"] ? x["@id"] : x)); });
      const r = await cam.appeler("PUT", d.camileiaIri, corps);
      const idx = st.brutes.findIndex(x => String(x.id) === String(d.camileiaId));
      if (idx >= 0 && r && typeof r === "object") st.brutes[idx] = cam.avecIri([r], `${cam.RACINE}/d_is`)[0];
      traduire(); st.ouverte = st.dis.find(x => String(x.camileiaId) === String(d.camileiaId)) || null;
      st.info = `État de la DI ${d.numero} changé en « ${lib} ».`;
    });
  });
}

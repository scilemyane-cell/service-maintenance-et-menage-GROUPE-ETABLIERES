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
import { doc, getDoc, getDocs, setDoc, collection } from "./firestore-compte.js";
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
    <p class="hint">🧪 <b>Test du lien Camileia.</b> Cet écran lit les demandes d'intervention de Camileia et montre comment elles arriveraient dans le Suivi des demandes. <b>Rien n'est enregistré dans l'appli</b> : c'est une simulation. Les seuls envois possibles vont vers Camileia (message, changement d'état), sur une DI que tu choisis, après confirmation.</p>
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
    ${st.dis.length ? simulationHTML() : ""}
    ${st.dis.length ? tableauHTML() : ""}
    ${st.ouverte ? detailHTML() : ""}
  </div>`;
  brancher();
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
  </div>`;
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
  $("cam-relais-ok")?.addEventListener("click", () => { cam.enregistrerConfig({ relaisUrl: $("cam-relais").value.trim(), relaisCle: $("cam-cle").value }); st.info = "Relais enregistré."; rendre(); });
  $("cam-toutes")?.addEventListener("change", (e) => { st.toutes = e.target.checked; });
  $("cam-lire")?.addEventListener("click", () => occuper("Lecture…", lireDI));
  $("cam-corresp-ok")?.addEventListener("click", () => occuper("Enregistrement…", async () => {
    const etats = {}; racine.querySelectorAll("select[data-etat]").forEach(s => { if (s.value) etats[s.dataset.etat] = s.value; });
    await setDoc(REF_CORRESP, { etats, le: Date.now() }, { merge: false });
    st.correspondances = etats; traduire(); st.info = "Correspondance enregistrée.";
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

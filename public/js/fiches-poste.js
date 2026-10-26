// fiches-poste.js — « 📄 Fiches de poste » : rédaction des fiches de poste au
// format RH 05 du Groupe Établières. On part d'un modèle (agent de service MNA,
// résidence, espaces verts, technicien, coordinateur, responsable…), on coche
// les missions / compétences proposées, on ajuste, et l'aperçu reproduit le
// formulaire officiel. PDF téléchargeable et copie sur SharePoint
// (ExportsDonnees › Fiches de poste).
import { db } from "./firebase-init.js";
import { collection, doc, addDoc, setDoc, deleteDoc, onSnapshot, serverTimestamp } from "./firestore-compte.js";
import { esc } from "./astreinte-logic.js";
import { watchUsers } from "./users-data.js";
import { getGraphToken } from "./graph-auth.js";
import { uploadToDrive, EXPORTS_ROOT_FOLDER } from "./sharepoint-storage.js";
import { lireFicheExistante } from "./fiches-poste-import.js";
import { MODELES, MISSIONS, SAVOIR_FAIRE, SAVOIR_ETRE, ASSOCIATIONS, RESIDENCES, MANAGERS, POSITIONNEMENT, CHAQUE_COLLABORATEUR, TEXTE_MISSIONS, ficheDepuisModele } from "./fiches-poste-modeles.js";

const COL = "fiches-poste";
let conteneur = null, user = null, unsubs = [], fiches = [], personnes = [];
let ui = { id: null, f: null, modif: false, filtre: "" };

const fr = (iso) => iso ? new Date(iso + "T00:00:00").toLocaleDateString("fr-FR") : "";
const coche = (v) => v ? "☒" : "☐";
const nomFichier = (f) => `RH05 - Fiche de poste - ${f.poste || "Poste"} - ${f.collaborateur || "Sans nom"}.pdf`.replace(/[\\/:*?"<>|]+/g, "-");

function cleanup() { unsubs.forEach(u => u()); unsubs = []; }

export function mountFichesPoste(container, u) {
  cleanup(); conteneur = container; user = u;
  unsubs.push(onSnapshot(collection(db, COL), (s) => { fiches = s.docs.map(d => ({ id: d.id, ...d.data() })); if (!ui.f) render(); else renderListe(); },
    (e) => { conteneur.innerHTML = `<div class="form-card"><p>⚠️ Accès refusé à la collection « fiches-poste ». Publie la règle Firestore indiquée par Claude.</p><p class="hint">${esc(e.message)}</p></div>`; }));
  unsubs.push(watchUsers((l) => { personnes = (l || []).map(p => p.nom || p.displayName || p.name || "").filter(Boolean).sort(); }));
  render();
}

// ---------- Aperçu fidèle au formulaire RH 05 ----------
export function ficheHTML(f) {
  const entete = `<div class="fp-entete"><img src="img/logo-rh05.png" alt="Groupe Établières">
    <div class="fp-meta"><span>Date création :</span><span><b>Code :</b> <i>RH 05 - Richesses Humaines</i></span><span><b>Type :</b> <i>Formulaire</i></span><span><b>Destinataire(s) :</b> <i>Managers</i></span></div>
    <div class="fp-meta fp-maj"><span><b>Date MAJ :</b> <i>${fr(f.dateMaj) || "05/09/2025"}</i></span><span><b>Dernière(s) modification(s) :</b> ${esc(f.derniereModif || "Changement du logo")}</span></div></div>`;
  const pied = (n) => `<div class="fp-pied">Page <b>${n}</b> sur <b>2</b></div>`;
  const missions = (f.missions || []).map(m => `<tr><td>${esc(m.texte)}${m.sous?.length ? `<div class="fp-sous">${m.sous.map(s => `<div>➢&nbsp; ${esc(s)}</div>`).join("")}</div>` : ""}</td><td>${m.niveau === 1 ? "X" : ""}</td><td>${m.niveau === 2 ? "X" : ""}</td></tr>`).join("");
  return `<div class="fp-doc">
  <section class="fp-page">${entete}
    <h1>Fiche de poste</h1><h2>${esc(f.poste || "Intitulé du poste")}</h2>
    <h3 class="v">COLLABORATEUR</h3>
    <p>Prénom NOM : ${esc(f.collaborateur || "")}</p>
    <h3 class="v">PERIMETRE DU POSTE</h3>
    <div class="fp-2c"><span>Association de rattachement : ${esc(f.association || "")}</span><span>Convention collective : ${esc(f.convention || "")}</span></div>
    <p style="margin-top:10px">Résidence administrative principale : <span class="g">${esc(f.residence || "")}</span></p>
    <div class="fp-2c"><span>Poste en multisites : ${coche(f.multisite)} oui ${coche(!f.multisite)} non</span><span>Si oui, second site de travail : <span class="g">${esc(f.multisite && f.secondSite ? f.secondSite : "Choisissez un élément.")}</span></span></div>
    <div class="fp-2c"><span>Poste télétravaillable : ${coche(f.teletravail)} oui ${coche(!f.teletravail)} non</span><span>Poste incluant du management d'équipe : ${coche(f.management)} oui ${coche(!f.management)} non</span></div>
    <p style="margin-top:10px">Manager direct du collaborateur : ${esc(f.manager || "")}</p>
    <h3 class="v">Positionnement global</h3>
    <p class="j">${esc(POSITIONNEMENT)}</p>
    <p>Chaque collaborateur :<br>${CHAQUE_COLLABORATEUR.map(t => `- ${esc(t)}`).join("<br>")}</p>
    <h3 class="r">MISSION PRINCIPALE DU POSTE</h3>
    <p class="j ind">${esc(f.principale || "")}</p>
    <h3 class="r">MISSIONS DU POSTE &amp; DELEGATIONS</h3>
    <p class="j ind">${esc(TEXTE_MISSIONS).replace("\n", "<br>")}</p>
    ${pied(1)}
  </section>
  <section class="fp-page">${entete}
    <table class="fp-t"><thead><tr><th rowspan="2">MISSIONS</th><th colspan="2" class="fp-deleg">Délégation de décision<small>Sur la base de la <u>gouvernance intégrative du groupe</u> RH20</small></th></tr>
      <tr><th class="n">Niveau 1<br>Délégation totale</th><th class="n">Niveau 2<br>Partage d'intention</th></tr></thead>
      <tbody>${missions || `<tr><td colspan="3" style="color:#999">Aucune mission cochée</td></tr>`}</tbody></table>
    <h3 class="v">Compétences attendues du poste</h3>
    <p><b>Savoir-faire :</b></p><div class="fp-l">${(f.savoirFaire || []).map(t => `<div>-&nbsp;&nbsp;${esc(t)}</div>`).join("")}</div>
    <p><b>Savoirs-être :</b></p><div class="fp-l">${(f.savoirEtre || []).map(t => `<div>-&nbsp;&nbsp;${esc(t)}</div>`).join("")}</div>
    <h3 class="v">DELEGATION(S) DE SIGNATURE(S) autorisée(s) par le manager sur ce poste :</h3>
    ${f.signatureNonConcerne ? "" : `<p class="j">Listez ici les documents ou types de documents pour lesquels vous autorisez la signature par délégation. A noter que la responsabilité de l'acte de signature reste néanmoins de la responsabilité finale du manager.</p>${f.signatures ? `<p>${esc(f.signatures).replace(/\n/g, "<br>")}</p>` : ""}`}
    <p>${coche(f.signatureNonConcerne)} Poste non concerné par les délégations de signatures${f.signatureNonConcerne ? "" : " à ce jour"}</p>
    <p class="fp-rappel">La présente fiche de poste est, au minima, réétudiée lors de chaque entretien professionnel et est transmise par le manager au collaborateur concerné ainsi qu'au service RH pour suivi.</p>
    <p style="text-align:right">Fiche de poste établie le : ${fr(f.etablieLe)} par ${esc(f.etabliePar || "le manager")}.</p>
    <p>Signature salarié</p>
    ${pied(2)}
  </section></div>`;
}

// ---------- Écran ----------
function render() {
  if (!conteneur || !document.contains(conteneur)) { cleanup(); return; }
  conteneur.innerHTML = `<div class="fp-app">
    <div id="fp-liste"></div>
    <div id="fp-edit">${ui.f ? "" : `<div class="form-card fp-accueil"><h2>📄 Fiches de poste</h2>
      <p class="hint">Choisis un modèle de départ : tout est pré-coché, tu ajustes en cochant / décochant les propositions. L'aperçu reproduit le formulaire RH 05.</p>
      <div class="fp-import"><div><b>📥 Fiches faites avant l'appli ?</b><span>Sélectionne les PDF (ou Word) du formulaire RH 05 : l'appli les lit et les range ici, modifiables.</span></div><label class="add-btn">📥 Reprendre des fiches existantes<input type="file" accept=".pdf,.docx" multiple hidden data-fp-import></label></div>
      <p class="hint" style="margin:14px 0 0"><b>Ou crée une nouvelle fiche à partir d'un modèle :</b></p>
      <div class="fp-modeles">${MODELES.map(m => `<button type="button" data-fp-modele="${m.id}"><b>${esc(m.label)}</b><small>${m.missions.length ? `${m.missions.length} missions proposées` : "à remplir soi-même"}</small></button>`).join("")}</div></div>`}</div>
  </div>`;
  renderListe();
  conteneur.querySelector("[data-fp-import]")?.addEventListener("change", (e) => importer([...e.target.files]));
  conteneur.querySelectorAll("[data-fp-modele]").forEach(b => b.addEventListener("click", () => { ui = { ...ui, id: null, f: ficheDepuisModele(b.dataset.fpModele), modif: true }; render(); }));
  if (ui.f) renderEditeur();
}

function renderListe() {
  const el = conteneur?.querySelector("#fp-liste"); if (!el) return;
  const q = ui.filtre.toLowerCase();
  const l = fiches.filter(f => !q || `${f.collaborateur} ${f.poste}`.toLowerCase().includes(q)).sort((a, b) => String(a.collaborateur).localeCompare(String(b.collaborateur), "fr"));
  el.innerHTML = `<div class="form-card fp-liste">
    <div class="fp-liste-tete"><b>${fiches.length} fiche${fiches.length > 1 ? "s" : ""} de poste</b><button type="button" class="nav-btn" data-fp-nouvelle title="Nouvelle fiche ou reprise de fiches existantes">➕ Nouvelle</button></div>
    ${fiches.length > 4 ? `<input class="fp-cherche" placeholder="🔎 Chercher…" value="${esc(ui.filtre)}">` : ""}
    ${l.map(f => `<button type="button" class="fp-item ${ui.id === f.id ? "actif" : ""}" data-fp-ouvrir="${f.id}"><b>${esc(f.collaborateur || "Sans nom")}</b><span>${esc(f.poste || "")}</span><small>${f.etablieLe ? `établie le ${fr(f.etablieLe)}` : ""}${f.spLe ? " · ☁️" : ""}${f.importee ? " · 📥 reprise" : ""}</small></button>`).join("") || `<p class="hint">Aucune fiche enregistrée pour l'instant.</p>`}
  </div>`;
  el.querySelector("[data-fp-nouvelle]")?.addEventListener("click", () => { if (ui.modif && !confirm("Abandonner les modifications en cours ?")) return; ui = { ...ui, id: null, f: null, modif: false }; render(); });
  el.querySelector(".fp-cherche")?.addEventListener("input", (e) => { ui.filtre = e.target.value; renderListe(); const i = conteneur.querySelector(".fp-cherche"); i?.focus(); i?.setSelectionRange(i.value.length, i.value.length); });
  el.querySelectorAll("[data-fp-ouvrir]").forEach(b => b.addEventListener("click", () => {
    if (ui.modif && !confirm("Abandonner les modifications en cours ?")) return;
    const f = fiches.find(x => x.id === b.dataset.fpOuvrir); if (!f) return;
    const { id, creeLe, majLe, ...data } = f; ui = { ...ui, id, f: JSON.parse(JSON.stringify(data)), modif: false }; render();
  }));
}

function caseListe(nom, toutes, cochees) {
  const autres = cochees.filter(t => !toutes.includes(t));
  return `<div class="fp-coches">${[...toutes, ...autres].map((t, i) => `<label class="fp-c ${cochees.includes(t) ? "on" : ""}"><input type="checkbox" data-fp-liste="${nom}" data-i="${i}" ${cochees.includes(t) ? "checked" : ""}><span>${esc(t)}</span></label>`).join("")}</div>
    <div class="fp-ajout"><input data-fp-ajout-in="${nom}" placeholder="➕ Ajouter une autre proposition…"><button type="button" class="nav-btn" data-fp-ajout="${nom}">Ajouter</button></div>`;
}

function renderEditeur() {
  const f = ui.f, el = conteneur.querySelector("#fp-edit");
  const choisies = new Set((f.missions || []).map(m => m.texte));
  const biblio = MISSIONS.map(t => ({ ...t, liste: t.liste }));
  const persoMissions = (f.missions || []).filter(m => !MISSIONS.some(t => t.liste.some(x => x.texte === m.texte)));
  const principales = [...new Set(MODELES.map(m => m.principale).filter(Boolean))];
  el.innerHTML = `
  <div class="fp-barre">
    <button type="button" class="add-btn" data-fp-save>💾 Enregistrer${ui.modif ? " •" : ""}</button>
    <button type="button" class="add-btn" data-fp-pdf style="background:#2f6fd6">📄 Télécharger le PDF</button>
    <button type="button" class="nav-btn" data-fp-sp>☁️ Envoyer sur SharePoint</button>
    ${ui.id ? `<button type="button" class="nav-btn" data-fp-dup>📑 Dupliquer pour une autre personne</button><button type="button" class="del-btn" data-fp-del>🗑️</button>` : ""}
    <small class="hint" id="fp-etat"></small>
  </div>
  <div class="fp-cols">
  <div class="fp-form">
    <div class="form-card"><h3>👤 Collaborateur & poste</h3>
      <div class="fp-g2">
        <label>Prénom NOM<input data-fp="collaborateur" list="fp-pers" value="${esc(f.collaborateur)}" placeholder="ex. Marie NICOLAIZEAU"><datalist id="fp-pers">${personnes.map(p => `<option value="${esc(p)}">`).join("")}</datalist></label>
        <label>Intitulé du poste<input data-fp="poste" list="fp-postes" value="${esc(f.poste)}"><datalist id="fp-postes">${[...new Set(MODELES.map(m => m.poste).filter(Boolean))].map(p => `<option value="${esc(p)}">`).join("")}</datalist></label>
      </div>
      <p class="hint" style="margin:8px 0 4px">Repartir d'un modèle (remplace missions et compétences) :</p>
      <div class="fp-puces">${MODELES.filter(m => m.id !== "vierge").map(m => `<button type="button" class="${f.modele === m.id ? "on" : ""}" data-fp-remodele="${m.id}">${esc(m.label)}</button>`).join("")}</div>
    </div>
    <div class="form-card"><h3>📍 Périmètre du poste</h3>
      <div class="fp-g2">
        <label>Association de rattachement<input data-fp="association" list="fp-asso" value="${esc(f.association)}"><datalist id="fp-asso">${ASSOCIATIONS.map(a => `<option value="${esc(a)}">`).join("")}</datalist></label>
        <label>Convention collective<input data-fp="convention" value="${esc(f.convention)}"></label>
        <label>Résidence administrative principale<input data-fp="residence" list="fp-res" value="${esc(f.residence)}"><datalist id="fp-res">${RESIDENCES.map(a => `<option value="${esc(a)}">`).join("")}</datalist></label>
        <label>Manager direct<input data-fp="manager" list="fp-man" value="${esc(f.manager)}"><datalist id="fp-man">${MANAGERS.map(a => `<option value="${esc(a)}">`).join("")}</datalist></label>
      </div>
      <div class="fp-oui">
        ${[["multisite", "Poste en multisites"], ["teletravail", "Poste télétravaillable"], ["management", "Management d'équipe"]].map(([k, l]) => `<div><span>${l}</span><button type="button" class="${f[k] ? "on" : ""}" data-fp-oui="${k}" data-v="1">Oui</button><button type="button" class="${!f[k] ? "on" : ""}" data-fp-oui="${k}" data-v="0">Non</button></div>`).join("")}
      </div>
      ${f.multisite ? `<label class="fp-plein">Second site de travail<input data-fp="secondSite" list="fp-res" value="${esc(f.secondSite)}"></label>` : ""}
    </div>
    <div class="form-card"><h3>🎯 Mission principale</h3>
      <textarea data-fp="principale" rows="5">${esc(f.principale)}</textarea>
      <details class="fp-det"><summary>💡 Propositions (clique pour reprendre)</summary>${principales.map((p, i) => `<button type="button" class="fp-prop" data-fp-principale="${i}">${esc(p.slice(0, 170))}…</button>`).join("")}</details>
    </div>
    <div class="form-card"><h3>✅ Missions du poste & délégations <small class="hint">${(f.missions || []).length} cochée(s)</small></h3>
      <p class="hint" style="margin:0 0 8px">Coche les missions concernées. <b>N1</b> = délégation totale · <b>N2</b> = partage d'intention.</p>
      ${biblio.map(t => { const n = t.liste.filter(m => choisies.has(m.texte)).length; return `<details class="fp-theme" ${n ? "open" : ""}><summary>${t.theme} <small>${n ? `${n} cochée${n > 1 ? "s" : ""}` : ""}</small></summary>
        ${t.liste.map(m => { const sel = (f.missions || []).find(x => x.texte === m.texte); return `<div class="fp-mis ${sel ? "on" : ""}">
          <label><input type="checkbox" data-fp-mission="${esc(m.id)}" ${sel ? "checked" : ""}><span>${esc(m.texte)}${m.sous ? `<small>${m.sous.length} sous-missions</small>` : ""}</span></label>
          ${sel ? `<span class="fp-niv"><button type="button" class="${sel.niveau === 1 ? "on" : ""}" data-fp-niv="${esc(m.texte)}" data-v="1">N1</button><button type="button" class="${sel.niveau === 2 ? "on" : ""}" data-fp-niv="${esc(m.texte)}" data-v="2">N2</button></span>` : ""}
        </div>`; }).join("")}</details>`; }).join("")}
      ${persoMissions.length ? `<div class="fp-theme-perso"><b>✍️ Missions ajoutées</b>${persoMissions.map(m => `<div class="fp-mis on"><label><span>${esc(m.texte)}</span></label><span class="fp-niv"><button type="button" class="${m.niveau === 1 ? "on" : ""}" data-fp-niv="${esc(m.texte)}" data-v="1">N1</button><button type="button" class="${m.niveau === 2 ? "on" : ""}" data-fp-niv="${esc(m.texte)}" data-v="2">N2</button><button type="button" data-fp-mis-del="${esc(m.texte)}">✕</button></span></div>`).join("")}</div>` : ""}
      <div class="fp-ajout"><input id="fp-mis-in" placeholder="➕ Ajouter une mission propre à ce poste…"><button type="button" class="nav-btn" id="fp-mis-add">Ajouter</button></div>
    </div>
    <div class="form-card"><h3>🛠️ Savoir-faire</h3>${caseListe("savoirFaire", SAVOIR_FAIRE, f.savoirFaire || [])}</div>
    <div class="form-card"><h3>🤝 Savoirs-être</h3>${caseListe("savoirEtre", SAVOIR_ETRE, f.savoirEtre || [])}</div>
    <div class="form-card"><h3>✍️ Délégations de signature & validation</h3>
      <label class="fp-c ${f.signatureNonConcerne ? "on" : ""}"><input type="checkbox" data-fp-sig ${f.signatureNonConcerne ? "checked" : ""}><span>Poste non concerné par les délégations de signatures</span></label>
      ${f.signatureNonConcerne ? "" : `<label class="fp-plein">Documents autorisés à la signature par délégation<textarea data-fp="signatures" rows="3" placeholder="ex. bons de commande jusqu'à 1 500 € HT, bons d'intervention, PV de réception…">${esc(f.signatures)}</textarea></label>`}
      <div class="fp-g2" style="margin-top:10px">
        <label>Fiche établie le<input type="date" data-fp="etablieLe" value="${esc(f.etablieLe)}"></label>
        <label>Par<input data-fp="etabliePar" list="fp-par" value="${esc(f.etabliePar)}"><datalist id="fp-par"><option value="le manager"><option value="le DRH"></datalist></label>
      </div>
    </div>
  </div>
  <div class="fp-apercu-col"><div class="fp-apercu-titre">👁️ Aperçu du document <button type="button" class="nav-btn" data-fp-grand>🔍 Agrandir</button></div><div class="fp-apercu" id="fp-apercu">${ficheHTML(f)}</div></div>
  </div>`;
  brancher();
  ajusterApercu();
}

// L'aperçu (pages A4 de 794 px) est réduit pour tenir en entier dans la colonne.
let obsApercu = null;
function ajusterApercu() {
  const a = conteneur?.querySelector("#fp-apercu"); if (!a) return;
  a.style.setProperty("--fpz", String(Math.min(1, Math.max(0.2, (a.clientWidth - 26) / 794))));
  if (!obsApercu) { obsApercu = new ResizeObserver(() => ajusterApercu()); }
  obsApercu.disconnect(); obsApercu.observe(a);
}
function majApercu() {
  const a = conteneur.querySelector("#fp-apercu"); if (a) a.innerHTML = ficheHTML(ui.f);
  const s = conteneur.querySelector("[data-fp-save]"); if (s) s.textContent = `💾 Enregistrer${ui.modif ? " •" : ""}`;
}
function changer(fn, rerendre = true) { fn(ui.f); ui.modif = true; if (rerendre) { const y = window.scrollY; renderEditeur(); window.scrollTo(0, y); } else majApercu(); }

function brancher() {
  const el = conteneur.querySelector("#fp-edit");
  el.querySelectorAll("[data-fp]").forEach(i => i.addEventListener("input", () => changer(f => { f[i.dataset.fp] = i.value; }, false)));
  el.querySelectorAll("[data-fp-oui]").forEach(b => b.addEventListener("click", () => changer(f => { f[b.dataset.fpOui] = b.dataset.v === "1"; if (b.dataset.fpOui === "management") f.signatureNonConcerne = !f.management; })));
  el.querySelectorAll("[data-fp-remodele]").forEach(b => b.addEventListener("click", () => {
    if (!confirm("Remplacer la mission principale, les missions et les compétences par celles de ce modèle ?\n(Le nom, le périmètre et les dates sont gardés.)")) return;
    const m = ficheDepuisModele(b.dataset.fpRemodele);
    changer(f => Object.assign(f, { modele: m.modele, poste: m.poste, principale: m.principale, missions: m.missions, savoirFaire: m.savoirFaire, savoirEtre: m.savoirEtre, manager: m.manager || f.manager, management: m.management, teletravail: m.teletravail, signatureNonConcerne: m.signatureNonConcerne }));
  }));
  const principales = [...new Set(MODELES.map(m => m.principale).filter(Boolean))];
  el.querySelectorAll("[data-fp-principale]").forEach(b => b.addEventListener("click", () => changer(f => { f.principale = principales[+b.dataset.fpPrincipale]; })));
  el.querySelectorAll("[data-fp-mission]").forEach(cb => cb.addEventListener("change", () => changer(f => {
    const m = MISSIONS.flatMap(t => t.liste).find(x => x.id === cb.dataset.fpMission);
    f.missions = f.missions || [];
    if (cb.checked) f.missions.push({ texte: m.texte, niveau: m.niveau, sous: m.sous ? [...m.sous] : [] });
    else f.missions = f.missions.filter(x => x.texte !== m.texte);
  })));
  el.querySelectorAll("[data-fp-niv]").forEach(b => b.addEventListener("click", () => changer(f => { const m = f.missions.find(x => x.texte === b.dataset.fpNiv); if (m) m.niveau = +b.dataset.v; })));
  el.querySelectorAll("[data-fp-mis-del]").forEach(b => b.addEventListener("click", () => changer(f => { f.missions = f.missions.filter(x => x.texte !== b.dataset.fpMisDel); })));
  const ajMis = () => { const i = el.querySelector("#fp-mis-in"), t = i.value.trim(); if (t) changer(f => { (f.missions = f.missions || []).push({ texte: t, niveau: 1, sous: [] }); }); };
  el.querySelector("#fp-mis-add")?.addEventListener("click", ajMis);
  el.querySelector("#fp-mis-in")?.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); ajMis(); } });
  el.querySelectorAll("[data-fp-liste]").forEach(cb => cb.addEventListener("change", () => changer(f => {
    const nom = cb.dataset.fpListe, ref = nom === "savoirFaire" ? SAVOIR_FAIRE : SAVOIR_ETRE, cur = f[nom] || [];
    const tous = [...ref, ...cur.filter(t => !ref.includes(t))], t = tous[+cb.dataset.i];
    f[nom] = cb.checked ? [...cur, t] : cur.filter(x => x !== t);
  })));
  el.querySelectorAll("[data-fp-ajout]").forEach(b => {
    const nom = b.dataset.fpAjout, inp = el.querySelector(`[data-fp-ajout-in="${nom}"]`);
    const go = () => { const t = inp.value.trim(); if (t) changer(f => { f[nom] = [...(f[nom] || []), t]; }); };
    b.addEventListener("click", go); inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); go(); } });
  });
  el.querySelector("[data-fp-sig]")?.addEventListener("change", (e) => changer(f => { f.signatureNonConcerne = e.target.checked; }));
  el.querySelector("[data-fp-save]")?.addEventListener("click", enregistrer);
  el.querySelector("[data-fp-grand]")?.addEventListener("click", () => {
    const v = document.createElement("div"); v.className = "fp-plein-ecran";
    v.innerHTML = `<button type="button" class="nav-btn">✕ Fermer</button><div class="fp-plein-pages">${ficheHTML(ui.f)}</div>`;
    v.querySelector("button").onclick = () => v.remove(); v.addEventListener("click", (e) => { if (e.target === v) v.remove(); });
    document.body.appendChild(v);
  });
  el.querySelector("[data-fp-pdf]")?.addEventListener("click", async () => { etat("⏳ Création du PDF…"); try { const blob = await pdf(ui.f); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = nomFichier(ui.f); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); etat("✓ PDF téléchargé"); } catch (e) { etat("❌ " + (e.message || e)); } });
  el.querySelector("[data-fp-sp]")?.addEventListener("click", envoyerSP);
  el.querySelector("[data-fp-dup]")?.addEventListener("click", () => { ui = { ...ui, id: null, f: { ...JSON.parse(JSON.stringify(ui.f)), collaborateur: "", etablieLe: new Date().toISOString().slice(0, 10), spLe: null, spFichier: null }, modif: true }; render(); window.toast?.("Copie prête : indique le nom de la personne puis enregistre."); });
  el.querySelector("[data-fp-del]")?.addEventListener("click", async () => { if (!confirm(`Supprimer la fiche de poste de ${ui.f.collaborateur || "cette personne"} ?`)) return; await deleteDoc(doc(db, COL, ui.id)); ui = { ...ui, id: null, f: null, modif: false }; render(); });
}

function etat(t) { const e = conteneur.querySelector("#fp-etat"); if (e) e.textContent = t; }

async function enregistrer() {
  const f = ui.f;
  if (!f.collaborateur?.trim()) { window.toast?.("Indique le prénom et le nom du collaborateur.", "error"); conteneur.querySelector('[data-fp="collaborateur"]')?.focus(); return null; }
  etat("⏳ Enregistrement…");
  const data = { ...f, majLe: serverTimestamp(), majPar: user?.nom || user?.email || "" };
  try {
    if (ui.id) await setDoc(doc(db, COL, ui.id), data, { merge: true });
    else { const r = await addDoc(collection(db, COL), { ...data, creeLe: serverTimestamp() }); ui.id = r.id; }
    ui.modif = false; etat("✓ Enregistrée"); renderListe(); majApercu(); return ui.id;
  } catch (e) { etat("❌ " + (e.message || e)); return null; }
}

async function pdf(f) {
  const html2pdf = await window.chargerLib?.("html2pdf"); if (!html2pdf) throw new Error("Librairie PDF non chargée");
  const cache = document.createElement("div");
  cache.style.cssText = "position:fixed;top:0;left:0;width:794px;opacity:0.01;pointer-events:none;z-index:-1;background:#fff";
  cache.innerHTML = `<div class="fp-pdf">${ficheHTML(f)}</div>`; document.body.append(cache);
  await Promise.all([...cache.querySelectorAll("img")].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; setTimeout(r, 3000); })));
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  try {
    return await html2pdf().set({ margin: 0, filename: nomFichier(f), image: { type: "jpeg", quality: 0.95 },
      html2canvas: { scale: 2, backgroundColor: "#ffffff", useCORS: true, logging: false }, jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
      pagebreak: { mode: [] } }).from(cache.firstElementChild).outputPdf("blob");
  } finally { cache.remove(); }
}

async function envoyerSP() {
  const id = ui.modif || !ui.id ? await enregistrer() : ui.id; if (!id) return;
  etat("⏳ Envoi sur SharePoint…");
  try {
    const token = await getGraphToken(); if (!token) throw new Error("Connexion Microsoft refusée");
    const blob = await pdf(ui.f), nom = nomFichier(ui.f);
    await uploadToDrive(new File([blob], nom, { type: "application/pdf" }), token, ["Fiches de poste"], EXPORTS_ROOT_FOLDER, { conflictBehavior: "replace", fixedFilename: nom });
    await setDoc(doc(db, COL, id), { spLe: Date.now(), spFichier: nom }, { merge: true });
    etat(`☁️ Envoyée : ExportsDonnees › Fiches de poste › ${nom}`);
  } catch (e) { etat("❌ SharePoint : " + (e.message || e)); }
}

async function importer(files) {
  if (!files.length) return;
  const zone = conteneur.querySelector(".fp-import span"), ok = [], ko = [];
  for (const [i, file] of files.entries()) {
    if (zone) zone.textContent = `⏳ Lecture ${i + 1}/${files.length} : ${file.name}…`;
    try {
      const f = await lireFicheExistante(file);
      if (!f.collaborateur) throw new Error("nom du collaborateur introuvable (est-ce bien une fiche RH 05 ?)");
      const r = await addDoc(collection(db, COL), { ...f, creeLe: serverTimestamp(), majLe: serverTimestamp(), majPar: user?.nom || user?.email || "" });
      ok.push({ id: r.id, f });
    } catch (e) { console.error(e); ko.push(`${file.name} : ${e.message || e}`); }
  }
  if (ko.length) alert(`⚠️ ${ko.length} fichier(s) non repris :\n\n${ko.join("\n")}`);
  if (ok.length) { window.toast?.(`📥 ${ok.length} fiche(s) de poste reprise(s). Vérifie-les, tout est modifiable.`, "success"); ui = { ...ui, id: ok[0].id, f: JSON.parse(JSON.stringify(ok[0].f)), modif: false }; render(); }
  else render();
}

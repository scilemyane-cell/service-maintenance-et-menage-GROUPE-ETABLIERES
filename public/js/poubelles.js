// poubelles.js — Calendrier de collecte (sortie / rentrée des bacs) d'un dispositif.
// Le responsable programme les dates sur l'année ; l'agent coche chaque passage
// avec photos OBLIGATOIRES (bacs sortis/rentrés + zone nettoyée).
// Calendrier : config/poubelles-<dispositif>. Photos : collection « fiches-photos »
// (type "poubelles") — mêmes règles que les photos des fiches, pas de purge hebdo.
import { db, auth } from "./firebase-init.js";
import { doc, setDoc, onSnapshot, collection, addDoc, deleteDoc, query, where } from "./firestore-compte.js";
import { esc, dateKey, addDays, HOLIDAYS } from "./astreinte-logic.js";
import { compresserImage, voirPhotos } from "./demandes-photos.js";

const TYPES = { sortie: ["⬆️", "Sortie des bacs"], rentree: ["⬇️", "Rentrée des bacs"] };
const FLUX = ["Ordures ménagères", "Tri sélectif", "Verre", "Biodéchets", "Encombrants", "Autre"];
const JS = [["1", "Lundi"], ["2", "Mardi"], ["3", "Mercredi"], ["4", "Jeudi"], ["5", "Vendredi"], ["6", "Samedi"], ["0", "Dimanche"]];
const slug = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const estEditeur = (u) => ["super_admin", "admin", "n1"].includes(u?.role);
const frJ = (iso, o = { weekday: "short", day: "numeric", month: "short" }) => new Date(iso + "T12:00").toLocaleDateString("fr-FR", o);
const uid = () => Math.random().toString(36).slice(2, 9);

let st = { cal: { sites: [], dates: [] }, photos: [] }, ui = {}, unsubs = [], cont = null, user = null, disp = "";
const ref = () => doc(db, "config", "poubelles-" + slug(disp));

export function mountPoubelles(container, u, dispositif) {
  unsubs.forEach(f => f()); unsubs = [];
  cont = container; user = u; disp = dispositif; ui = { vue: "afaire", ...(ui.disp === dispositif ? ui : {}), disp: dispositif };
  container.innerHTML = `<p class="hint">Chargement…</p>`;
  unsubs.push(onSnapshot(ref(), (s) => { const d = s.exists() ? s.data() : {}; st.cal = { sites: d.sites || ["Cécile Sauvage"], dates: d.dates || [] }; render(); }, () => render()));
  unsubs.push(onSnapshot(query(collection(db, "fiches-photos"), where("type", "==", "poubelles")),
    (s) => { st.photos = s.docs.map(d => ({ id: d.id, ...d.data() })).filter(p => p.dispositif === disp); render(); }, (e) => { console.warn("Photos poubelles :", e); }));
}

const sauver = (patch) => setDoc(ref(), { ...patch, majLe: Date.now(), majPar: user?.nom || user?.email || "" }, { merge: true });
const photosDe = (id) => st.photos.filter(p => p.dateId === id).sort((a, b) => (a.le || 0) - (b.le || 0));
const fait = (id) => { const p = photosDe(id); return p.some(x => x.moment === "bacs") && p.some(x => x.moment === "zone"); };

function carte(x, auj) {
  const [ic, lib] = TYPES[x.t] || TYPES.sortie, ok = fait(x.id), ph = photosDe(x.id), retard = !ok && x.d < auj;
  const qui = ph[0]?.agentNom ? ` · ${esc(ph[0].agentNom)}` : "";
  return `<div class="pb-c ${ok ? "ok" : retard ? "retard" : x.d === auj ? "auj" : ""}">
    <div class="pb-c-t"><span class="pb-ic">${ic}</span><div><b>${lib}</b><small>${esc(x.site || "")}${x.flux ? ` · ${esc(x.flux)}` : ""}</small></div>
      <span class="pb-d">${x.d === auj ? "Aujourd'hui" : frJ(x.d)}${HOLIDAYS.has(x.d) ? " · férié" : ""}</span></div>
    ${ph.length ? `<div class="pb-ph">${ph.map((p, i) => `<img src="${p.data}" alt="" data-pb-voir="${x.id}" data-i="${i}" title="${p.moment === "zone" ? "Zone nettoyée" : "Bacs"}">`).join("")}</div>` : ""}
    ${ok ? `<div class="pb-fait">✅ Fait${ph.at(-1)?.le ? ` le ${new Date(ph.at(-1).le).toLocaleString("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : ""}${qui}</div>`
      : `<button class="add-btn pb-go" data-pb-faire="${x.id}">📸 ${retard ? "En retard — " : ""}Cocher avec photos</button>`}
    ${ph.length && estEditeur(user) ? `<button class="del-btn" data-pb-annuler="${x.id}" style="align-self:flex-start;font-size:12px">🗑️ Effacer ce passage (${ph.length} photo${ph.length > 1 ? "s" : ""})</button>` : ""}
  </div>`;
}

function render() {
  if (!cont || !document.contains(cont)) { unsubs.forEach(f => f()); unsubs = []; return; }
  const auj = dateKey(new Date()), ed = estEditeur(user);
  const dates = [...st.cal.dates].sort((a, b) => a.d.localeCompare(b.d) || (a.t === "sortie" ? -1 : 1));
  const d0 = dateKey(addDays(new Date(), -14)), d1 = dateKey(addDays(new Date(), 7));
  const enRetard = dates.filter(x => x.d < auj && x.d >= d0 && !fait(x.id));
  const prochains = dates.filter(x => x.d >= auj && x.d <= d1);
  const faits = dates.filter(x => x.d < auj && x.d >= d0 && fait(x.id)).reverse();
  const onglets = [["afaire", "✅ À faire"], ["historique", "🗂️ Historique"], ...(ed ? [["programmer", "📅 Programmer l'année"]] : [])];
  cont.innerHTML = `<div class="stack pb">
    <div class="tabs" style="background:none;border:none;padding:0">${onglets.map(([k, l]) => `<button class="tab-btn ${ui.vue === k ? "active" : ""}" data-pb-vue="${k}">${l}</button>`).join("")}</div>
    ${ui.vue === "afaire" ? `
      <p class="hint">Pour chaque sortie ou rentrée des bacs : coche-la en ajoutant <b>obligatoirement</b> une photo des bacs et une photo de la zone nettoyée.</p>
      ${enRetard.length ? `<h3 class="pb-h rouge">⚠️ En retard (${enRetard.length})</h3><div class="pb-l">${enRetard.map(x => carte(x, auj)).join("")}</div>` : ""}
      <h3 class="pb-h">📅 Cette semaine et la suivante</h3>
      <div class="pb-l">${prochains.map(x => carte(x, auj)).join("") || `<p class="hint">${dates.length ? "Rien de prévu dans les 7 prochains jours." : "Aucune date programmée pour l'instant" + (ed ? " — va dans « 📅 Programmer l'année »." : ".")}</p>`}</div>
      ${faits.length ? `<h3 class="pb-h">✔️ Faits ces 2 dernières semaines</h3><div class="pb-l">${faits.map(x => carte(x, auj)).join("")}</div>` : ""}`
    : ui.vue === "historique" ? historique(dates, auj) : programmer(dates, auj)}
  </div>`;
  brancher();
}

function historique(dates, auj) {
  const passes = dates.filter(x => x.d <= auj);
  const parMois = {};
  passes.forEach(x => (parMois[x.d.slice(0, 7)] = parMois[x.d.slice(0, 7)] || []).push(x));
  const mois = Object.keys(parMois).sort().reverse();
  if (!mois.length) return `<p class="hint">Aucun passage pour l'instant.</p>`;
  return mois.map(m => { const l = parMois[m], n = l.filter(x => fait(x.id)).length;
    return `<details class="form-card pb-mois" ${m === mois[0] ? "open" : ""}><summary><b>${new Date(m + "-15").toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}</b> <span class="${n === l.length ? "vert" : "rouge"}">${n}/${l.length} faits</span></summary>
      <div class="pb-l">${[...l].reverse().map(x => carte(x, auj)).join("")}</div></details>`; }).join("");
}

function programmer(dates, auj) {
  const r = ui.regle || (ui.regle = { site: st.cal.sites[0] || "", t: "sortie", jour: "1", freq: "1", flux: FLUX[0], du: auj, au: `${new Date().getFullYear() + (new Date().getMonth() >= 8 ? 1 : 0)}-08-31` });
  const futures = dates.filter(x => x.d >= auj), parMois = {};
  futures.forEach(x => (parMois[x.d.slice(0, 7)] = parMois[x.d.slice(0, 7)] || []).push(x));
  const opt = (l, v) => l.map(([k, t]) => `<option value="${esc(k)}" ${String(v) === String(k) ? "selected" : ""}>${esc(t)}</option>`).join("");
  const sitesOpt = opt(st.cal.sites.map(s => [s, s]), r.site);
  return `
  <div class="form-card"><h3 class="pb-h">🏢 Sites de la tournée</h3>
    <div class="pb-sites">${st.cal.sites.map((s, i) => `<span class="pb-chip">${esc(s)} <button data-pb-site-del="${i}" title="Retirer">✕</button></span>`).join("")}
      <input id="pb-site-nv" placeholder="➕ Ajouter un site (ex. Cécile Sauvage)"><button class="nav-btn" data-pb-site-add>Ajouter</button></div></div>
  <div class="form-card"><h3 class="pb-h">🔁 Programmer une récurrence</h3>
    <div class="form-grid">
      <label>Site<select data-r="site">${sitesOpt}</select></label>
      <label>Action<select data-r="t">${opt(Object.entries(TYPES).map(([k, [i, l]]) => [k, i + " " + l]), r.t)}</select></label>
      <label>Jour<select data-r="jour">${opt(JS, r.jour)}</select></label>
      <label>Fréquence<select data-r="freq">${opt([["1", "Chaque semaine"], ["2", "Une semaine sur deux"], ["4", "Toutes les 4 semaines"]], r.freq)}</select></label>
      <label>Collecte<select data-r="flux">${opt(FLUX.map(f => [f, f]), r.flux)}</select></label>
      <label>Du<input type="date" data-r="du" value="${esc(r.du)}"></label>
      <label>Au<input type="date" data-r="au" value="${esc(r.au)}"></label>
    </div>
    <p class="hint" style="margin:6px 0">Une semaine sur deux : la première date est le premier jour choisi à partir du « Du ».</p>
    <button class="add-btn" data-pb-gen>➕ Générer les dates</button>
  </div>
  <div class="form-card"><h3 class="pb-h">➕ Ajouter une date ponctuelle</h3>
    <div class="form-grid"><label>Date<input type="date" id="pb-u-d" value="${esc(auj)}"></label><label>Site<select id="pb-u-site">${sitesOpt}</select></label>
      <label>Action<select id="pb-u-t">${opt(Object.entries(TYPES).map(([k, [i, l]]) => [k, i + " " + l]), "sortie")}</select></label><label>Collecte<select id="pb-u-flux">${opt(FLUX.map(f => [f, f]), FLUX[0])}</select></label></div>
    <button class="nav-btn" data-pb-unit style="margin-top:8px">Ajouter cette date</button></div>
  <div class="form-card"><h3 class="pb-h">📆 Dates programmées <small>${futures.length} à venir</small></h3>
    <p class="hint">Touche ✕ pour retirer une date (ex. jour férié décalé), puis ajoute la bonne date ci-dessus. Les jours fériés sont signalés en orange.</p>
    ${Object.keys(parMois).sort().map(m => `<div class="pb-m"><b>${new Date(m + "-15").toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}</b><div class="pb-chips">${parMois[m].map(x => `<span class="pb-chip ${x.t} ${HOLIDAYS.has(x.d) ? "ferie" : ""}" title="${esc((x.site || "") + " · " + (x.flux || ""))}">${TYPES[x.t]?.[0] || ""} ${frJ(x.d)} <small>${esc(x.site || "")}</small><button data-pb-del="${x.id}">✕</button></span>`).join("")}</div></div>`).join("") || `<p class="hint">Aucune date à venir.</p>`}
    ${futures.length ? `<button class="del-btn" data-pb-vider style="margin-top:10px">🗑️ Retirer toutes les dates à venir…</button>` : ""}
  </div>`;
}

function brancher() {
  const $$ = (s) => cont.querySelectorAll(s);
  $$("[data-pb-vue]").forEach(b => b.onclick = () => { ui.vue = b.dataset.pbVue; render(); });
  $$("[data-pb-voir]").forEach(im => im.onclick = () => voirPhotos(photosDe(im.dataset.pbVoir), +im.dataset.i));
  $$("[data-pb-annuler]").forEach(b => b.onclick = async () => {
    const l = photosDe(b.dataset.pbAnnuler); if (!confirm(`Effacer ce passage et ses ${l.length} photo(s) ? Il redeviendra « à faire ».`)) return;
    b.disabled = true; try { for (const p of l) await deleteDoc(doc(db, "fiches-photos", p.id)); window.toast?.("🗑️ Passage effacé"); } catch (e) { alert("Effacement impossible : " + (e?.message || e)); b.disabled = false; }
  });
  $$("[data-pb-faire]").forEach(b => b.onclick = () => ouvrirValidation(st.cal.dates.find(x => x.id === b.dataset.pbFaire)));
  $$("[data-r]").forEach(el => el.onchange = () => { ui.regle[el.dataset.r] = el.value; });
  cont.querySelector("[data-pb-site-add]")?.addEventListener("click", () => { const v = cont.querySelector("#pb-site-nv").value.trim(); if (v && !st.cal.sites.includes(v)) sauver({ sites: [...st.cal.sites, v] }); });
  $$("[data-pb-site-del]").forEach(b => b.onclick = () => { const s = st.cal.sites[+b.dataset.pbSiteDel]; if (confirm(`Retirer « ${s} » de la liste des sites ? (les dates déjà programmées restent)`)) sauver({ sites: st.cal.sites.filter(x => x !== s) }); });
  $$("[data-pb-del]").forEach(b => b.onclick = () => sauver({ dates: st.cal.dates.filter(x => x.id !== b.dataset.pbDel) }));
  cont.querySelector("[data-pb-vider]")?.addEventListener("click", () => { const auj = dateKey(new Date()); if (confirm("Retirer toutes les dates à venir (les passages déjà faits sont gardés) ?")) sauver({ dates: st.cal.dates.filter(x => x.d < auj) }); });
  cont.querySelector("[data-pb-unit]")?.addEventListener("click", () => {
    const d = cont.querySelector("#pb-u-d").value, site = cont.querySelector("#pb-u-site").value, t = cont.querySelector("#pb-u-t").value, flux = cont.querySelector("#pb-u-flux").value;
    if (!d || !site) return window.toast?.("Choisis une date et un site.");
    if (st.cal.dates.some(x => x.d === d && x.t === t && x.site === site && x.flux === flux)) return window.toast?.("Cette date existe déjà.");
    sauver({ dates: [...st.cal.dates, { id: uid(), d, t, site, flux }] }).then(() => window.toast?.("✓ Date ajoutée"));
  });
  cont.querySelector("[data-pb-gen]")?.addEventListener("click", () => {
    const r = ui.regle; if (!r.site) return window.toast?.("Ajoute d'abord un site.");
    if (!r.du || !r.au || r.au < r.du) return window.toast?.("Vérifie les dates Du / Au.");
    let d = new Date(r.du + "T12:00"); while (String(d.getDay()) !== r.jour) d = addDays(d, 1);
    const fin = new Date(r.au + "T12:00"), nv = [];
    for (; d <= fin; d = addDays(d, 7 * +r.freq)) { const k = dateKey(d); if (!st.cal.dates.some(x => x.d === k && x.t === r.t && x.site === r.site && x.flux === r.flux)) nv.push({ id: uid(), d: k, t: r.t, site: r.site, flux: r.flux }); }
    if (!nv.length) return window.toast?.("Aucune nouvelle date (déjà programmées).");
    const fer = nv.filter(x => HOLIDAYS.has(x.d)).length;
    if (!confirm(`${nv.length} date(s) vont être ajoutées : ${TYPES[r.t][1].toLowerCase()} le ${JS.find(j => j[0] === r.jour)[1].toLowerCase()}, ${r.site}.${fer ? `\n⚠️ ${fer} tombent un jour férié (en orange, à vérifier).` : ""}`)) return;
    sauver({ dates: [...st.cal.dates, ...nv] }).then(() => window.toast?.(`✓ ${nv.length} dates programmées`));
  });
}

// Fenêtre « cocher » : 2 photos obligatoires (bacs + zone nettoyée).
function ouvrirValidation(x) {
  if (!x) return;
  const [ic, lib] = TYPES[x.t] || TYPES.sortie;
  const pris = { bacs: [], zone: [] };
  const fond = document.createElement("div"); fond.className = "cd-fond"; fond.style.zIndex = "1400";
  const zone = (k, titre) => `<div class="pb-z"><b>${titre} <em>obligatoire</em></b><div class="pb-z-l" data-z-l="${k}"></div>
    <label class="nav-btn pb-z-b">📷 Prendre une photo<input type="file" accept="image/*" capture="environment" hidden data-z="${k}"></label>
    <label class="nav-btn pb-z-b">🖼️ Galerie<input type="file" accept="image/*" multiple hidden data-z="${k}"></label></div>`;
  fond.innerHTML = `<div class="cd-fenetre" style="max-width:480px"><div class="cd-fenetre-tete"><div><b>${ic} ${lib}</b><small>${esc(x.site || "")} · ${frJ(x.d, { weekday: "long", day: "numeric", month: "long" })}${x.flux ? " · " + esc(x.flux) : ""}</small></div><button class="cd-x" data-x>✕</button></div>
    <div class="stack" style="gap:12px">
      ${zone("bacs", x.t === "rentree" ? "🗑️ Bacs rentrés" : "🗑️ Bacs sortis")}
      ${zone("zone", "🧽 Zone nettoyée (local / abords)")}
      <button class="add-btn" data-ok disabled>✓ Valider le passage</button>
    </div></div>`;
  document.body.append(fond);
  const maj = () => {
    Object.entries(pris).forEach(([k, l]) => { fond.querySelector(`[data-z-l="${k}"]`).innerHTML = l.map((d, i) => `<span class="pb-mini"><img src="${d}" alt=""><button data-rm="${k}" data-i="${i}">✕</button></span>`).join("") || `<small class="hint">Aucune photo</small>`; });
    fond.querySelectorAll("[data-rm]").forEach(b => b.onclick = () => { pris[b.dataset.rm].splice(+b.dataset.i, 1); maj(); });
    const ok = pris.bacs.length && pris.zone.length, bt = fond.querySelector("[data-ok]");
    bt.disabled = !ok; bt.textContent = ok ? "✓ Valider le passage" : "📸 Ajoute les 2 photos pour valider";
  };
  maj();
  fond.querySelectorAll("[data-z]").forEach(inp => inp.onchange = async () => {
    for (const f of inp.files) { try { pris[inp.dataset.z].push(await compresserImage(f, 1100)); } catch { window.toast?.("Photo illisible"); } }
    inp.value = ""; maj();
  });
  const fermer = () => fond.remove();
  fond.querySelectorAll("[data-x]").forEach(b => b.onclick = fermer);
  fond.querySelector("[data-ok]").onclick = async (e) => {
    const b = e.currentTarget; b.disabled = true; b.textContent = "Envoi des photos…";
    try {
      const base = { type: "poubelles", dispositif: disp, dateId: x.id, d: x.d, t: x.t, site: x.site || "", flux: x.flux || "", agentUid: auth.currentUser?.uid || "", agentNom: user?.nom || user?.email || "", legende: "" };
      for (const [k, l] of Object.entries(pris)) for (const data of l) await addDoc(collection(db, "fiches-photos"), { ...base, moment: k, data, le: Date.now() });
      fermer(); window.toast?.("✅ Passage validé");
    } catch (err) { alert("Envoi impossible : " + (err?.message || err)); b.disabled = false; maj(); }
  };
}

export const supprimerPhotoPoubelle = (id) => deleteDoc(doc(db, "fiches-photos", id));

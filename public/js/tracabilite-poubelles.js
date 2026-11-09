// tracabilite-poubelles.js — Fiche de traçabilité hebdomadaire d'un agent
// « poubelles » (dispositif Daoud Mahdi), au même format que les fiches MNA :
// passages de la tournée (sortie / rentrée des bacs, zone de tri, ramassage)
// avec leurs photos, et les heures pointées de la semaine.
// Données lues : config/poubelles-<dispositif> (calendrier), fiches-photos
// (type "poubelles") et heures-repartition (pointage). Seuls les observations
// et la validation sont écrites, dans config/tracabilite-poubelles-<dispositif>.
import { db } from "./firebase-init.js";
import { doc, setDoc, onSnapshot, collection, query, where } from "./firestore-compte.js";
import { esc, dateKey, addDays, fmtShort } from "./astreinte-logic.js";
import { watchRepartitions } from "./heures-repartition-data.js";
import { imprimerFiche } from "./tracabilite-rendu.js";
import { voirPhotos } from "./demandes-photos.js";

const DAYS = ["LUN", "MAR", "MER", "JEU", "VEN", "SAM", "DIM"];
const NOMS = ["LUNDI", "MARDI", "MERCREDI", "JEUDI", "VENDREDI", "SAMEDI", "DIMANCHE"];
const TYPES = { sortie: "Sortie des bacs", rentree: "Rentrée des bacs", picking: "Ramassage des déchets" };
const COLS = (t) => t === "picking" ? [["avant", "Avant"], ["apres", "Après"]] : [["bacs", "Bacs"], ["zoneAvant", "Zone avant"], ["zone", "Zone après"]];
const REQUIS = (t) => COLS(t).map(c => c[0]).filter(k => k !== "zoneAvant");
const LIB_MOMENT = { bacs: "Bacs", zoneAvant: "Zone de tri — avant", zone: "Zone de tri — après", avant: "Avant", apres: "Après" };
const estEditeur = (u) => ["super_admin", "admin", "n1"].includes(u?.role);
const slug = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const lundi = (d) => addDays(d, -((d.getDay() + 6) % 7));
const min = (t) => { const [h, m] = String(t || "").split(":").map(Number); return Number.isFinite(h) ? h * 60 + (m || 0) : null; };
const duree = (c) => { const a = min(c.a), d = min(c.d); return a != null && d != null && d > a ? (d - a) / 60 : 0; };
const fmtH = (h) => { const t = Math.round(h * 60); return `${Math.floor(t / 60)}h${String(t % 60).padStart(2, "0")}`; };
const heure = (t) => t ? new Date(t).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "";
const TD = "border:1px solid #999;padding:4px 6px;font-size:11px";

let st = { cal: { sites: [], dates: [] }, photos: [], reps: [], suivi: {} }, ui = { semaine: null }, unsubs = [], cont = null, user = null, disp = "";
const refSuivi = () => doc(db, "config", "tracabilite-poubelles-" + slug(disp));

export function mountTracabilitePoubelles(container, u, dispositif) {
  unsubs.forEach(f => f()); unsubs = [];
  cont = container; user = u; disp = dispositif;
  if (!ui.semaine) ui.semaine = dateKey(lundi(addDays(new Date(), -2))); // lundi/mardi : la semaine écoulée
  container.innerHTML = `<p class="hint">Chargement…</p>`;
  unsubs.push(onSnapshot(doc(db, "config", "poubelles-" + slug(dispositif)), (s) => { const d = s.exists() ? s.data() : {}; st.cal = { sites: d.sites || ["Cécile Sauvage"], dates: d.dates || [] }; render(); }, () => render()));
  unsubs.push(onSnapshot(query(collection(db, "fiches-photos"), where("type", "==", "poubelles")),
    (s) => { st.photos = s.docs.map(d => ({ id: d.id, ...d.data() })).filter(p => p.dispositif === dispositif); render(); }, (e) => console.warn("Photos poubelles :", e)));
  unsubs.push(watchRepartitions((r) => { st.reps = (r || []).filter(x => x.dispositif === dispositif); render(); }));
  unsubs.push(onSnapshot(refSuivi(), (s) => { st.suivi = s.exists() ? (s.data().semaines || {}) : {}; render(); }, (e) => console.warn("Suivi traçabilité poubelles :", e)));
}

// Données de la semaine affichée ---------------------------------------------
function semaine(ws) {
  const we = dateKey(addDays(new Date(ws + "T12:00"), 6));
  const dans = (d) => d >= ws && d <= we;
  const photos = st.photos.filter(p => dans(p.d));
  // Passages : ceux du calendrier + ceux faits hors calendrier (reconstitués depuis les photos).
  const libres = {};
  photos.filter(p => String(p.dateId).startsWith("libre-")).forEach(p => { libres[p.dateId] = libres[p.dateId] || { id: p.dateId, d: p.d, t: p.t || "picking", site: p.site, libre: true }; });
  const passages = [...st.cal.dates.filter(x => dans(x.d)), ...Object.values(libres)]
    .sort((a, b) => a.d.localeCompare(b.d) || (a.t === "sortie" ? -1 : 1))
    .map(x => {
      const ph = photos.filter(p => p.dateId === x.id).sort((a, b) => (a.le || 0) - (b.le || 0));
      return { ...x, ph, fait: REQUIS(x.t).every(k => ph.some(p => p.moment === k)), le: ph.at(-1)?.le, agent: ph[0]?.agentNom || "" };
    });
  const reps = st.reps.filter(r => r.weekStart === ws);
  const agents = [...new Set([...passages.map(p => p.agent), ...reps.map(r => r.agentNom)].filter(Boolean))];
  return { ws, we, passages, reps, agents };
}

const heuresJour = (r, d) => (r.pointages?.[d] || []).length ? r.pointages[d].reduce((s, c) => s + duree(c), 0)
  : (r.lignes || []).reduce((s, l) => s + (parseFloat(l.jours?.[d]) || 0), 0);

// Photos classées par passage (dans l'ordre de la tournée), puis par étape :
// Bacs → Zone avant → Zone après (ou Avant → Après pour un ramassage).
// « liste » = même ordre à plat, pour la visionneuse.
function photosClassees(s) {
  const liste = [], blocs = [];
  s.passages.filter(x => x.ph.length).forEach(x => {
    const etapes = [...COLS(x.t), ...[...new Set(x.ph.map(p => p.moment))].filter(m => !COLS(x.t).some(c => c[0] === m)).map(m => [m, LIB_MOMENT[m] || "Autre"])];
    const fig = (contenu, l, h) => `<figure style="margin:0;border:1px solid #bbb;border-radius:6px;padding:3px;background:#fff;break-inside:avoid">
      <figcaption style="font-size:9px;font-weight:700;margin:0 0 2px;text-transform:uppercase">${esc(l)}</figcaption>${contenu}
      <div style="font-size:8.5px;color:#666;margin-top:2px">${h}</div></figure>`;
    const cases = etapes.flatMap(([k, l]) => {
      const ph = x.ph.filter(p => p.moment === k);
      if (!ph.length) return [fig(`<div style="aspect-ratio:3/4;border:1px dashed #ccc;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:9px;color:#999">Pas de photo</div>`, l, "&nbsp;")];
      return ph.map(p => { liste.push(p); return fig(`<img src="${p.data}" alt="" data-tp-voir="${liste.length - 1}" style="width:100%;aspect-ratio:3/4;object-fit:contain;background:#f3f3f3;border-radius:4px;display:block;cursor:zoom-in">`, l, p.le ? heure(p.le) : "&nbsp;"); });
    }).join("");
    blocs.push(`<div style="margin:0 0 10px">
      <p style="font-size:11px;font-weight:700;margin:8px 0 4px;border-bottom:1px solid #ccc;padding-bottom:2px;break-after:avoid">${esc(new Date(x.d + "T12:00").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }).toUpperCase())} — ${esc((TYPES[x.t] || TYPES.sortie).toUpperCase())}${x.le ? ` · ${heure(x.le)}` : ""}</p>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px">${cases}</div></div>`);
  });
  return { liste, blocs };
}

// Fiche imprimable (même présentation que les fiches MNA) -------------------
function ficheHTML(s, suivi) {
  const coche = (x, k) => x.ph.some(p => p.moment === k) ? "✓" : "";
  const lignesPassages = s.passages.map(x => {
    const cols = COLS(x.t);
    return `<tr>
      <td style="${TD}">${esc(new Date(x.d + "T12:00").toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "2-digit" }))}</td>
      <td style="${TD}">${esc(TYPES[x.t] || TYPES.sortie)}${x.libre ? " (hors calendrier)" : ""}<br><span style="color:#666">${esc([x.site, x.flux].filter(Boolean).join(" · "))}</span></td>
      <td style="${TD};text-align:center">${cols.map(([k, l]) => `<span style="display:inline-block;margin:0 3px">${esc(l)} <b>${coche(x, k) || "—"}</b></span>`).join("")}</td>
      <td style="${TD};text-align:center">${x.fait ? `<b style="color:#11845b">FAIT</b>${x.le ? `<br>${heure(x.le)}` : ""}` : x.ph.length ? `<b style="color:#c25e00">INCOMPLET</b>` : `<b style="color:#b3261e">NON FAIT</b>`}</td>
    </tr>`;
  }).join("");
  const blocHeures = s.reps.map(r => {
    const tot = DAYS.reduce((t, d) => t + heuresJour(r, d), 0), prevu = (r.lignes || []).reduce((t, l) => t + (+l.prevu || 0), 0);
    const jours = DAYS.map((d, i) => ({ d, i, h: heuresJour(r, d), c: r.pointages?.[d] || [] })).filter(j => j.h > 0 || j.c.length);
    return `<p style="font-size:12px;margin:10px 0 4px"><b>${esc(r.agentNom || "")}</b></p>
      <table style="width:100%;border-collapse:collapse;margin-bottom:6px"><thead><tr><th style="${TD};text-align:left">JOUR</th><th style="${TD};text-align:left">CRÉNEAUX</th><th style="${TD}">HEURES</th></tr></thead><tbody>
      ${jours.map(j => `<tr><td style="${TD}">${NOMS[j.i]}</td><td style="${TD}">${j.c.map(c => `${esc(c.a || "?")} → ${esc(c.d || "?")}`).join(" · ") || "—"}</td><td style="${TD};text-align:center">${fmtH(j.h)}</td></tr>`).join("") || `<tr><td colspan="3" style="${TD}">Aucune heure pointée.</td></tr>`}
      <tr><td colspan="2" style="${TD};text-align:right"><b>TOTAL SEMAINE</b>${prevu ? ` (prévu ${fmtH(prevu)})` : ""}</td><td style="${TD};text-align:center"><b>${fmtH(tot)}</b></td></tr></tbody></table>`;
  }).join("") || `<p style="font-size:11px">Aucune heure pointée cette semaine.</p>`;
  const { blocs } = photosClassees(s);
  return `<div class="print-fiche print-trac" style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:24px;color:#111">
    <div style="margin-bottom:18px"><img src="img/logo-etablieres.png" alt="Groupe Établières" style="height:60px"></div>
    <p style="font-size:14px;margin:0 0 6px">FICHE DE TRAÇABILITÉ – AGENT D'ENTRETIEN (${esc(disp).toUpperCase()})</p>
    <p style="font-size:13px;margin:0 0 6px">Structure : ${esc(st.cal.sites.join(", ")).toUpperCase()} — TOURNÉE POUBELLES</p>
    <p style="font-size:13px;margin:0 0 18px">Date du ${fmtShort(new Date(s.ws + "T12:00"))} au ${fmtShort(new Date(s.we + "T12:00"))} &nbsp;&nbsp;&nbsp; Nom de l'agent : ${esc(s.agents.join(", ") || "—")}</p>
    <p style="font-size:13px;font-weight:700;margin:16px 0 6px">PASSAGES DE LA TOURNÉE</p>
    <table style="width:100%;border-collapse:collapse;margin-bottom:8px"><colgroup><col style="width:14%"><col style="width:34%"><col style="width:36%"><col style="width:16%"></colgroup>
      <thead><tr><th style="${TD};text-align:left">DATE</th><th style="${TD};text-align:left">ACTION</th><th style="${TD}">PHOTOS</th><th style="${TD}">STATUT</th></tr></thead>
      <tbody>${lignesPassages || `<tr><td colspan="4" style="${TD}">Aucun passage prévu ou fait cette semaine.</td></tr>`}</tbody></table>
    <p style="font-size:13px;font-weight:700;margin:16px 0 6px">HEURES DE LA SEMAINE</p>
    ${blocHeures}
    <p style="font-size:12px;margin-top:16px">OBSERVATIONS GÉNÉRALES : ${esc(suivi?.observations || "")}</p>
    ${suivi?.valideLe ? `<p style="font-size:11px;margin-top:6px;color:#11845b">Fiche vérifiée et validée le ${fmtShort(new Date(suivi.valideLe))}${suivi.validePar ? ` par ${esc(suivi.validePar)}` : ""}.</p>` : ""}
    ${blocs.length ? `<div class="trac-photos"><p style="font-size:13px;font-weight:700;margin:16px 0 6px">PHOTOS</p>${blocs.join("")}</div>` : ""}
  </div>`;
}

// Écran ------------------------------------------------------------------------
function render() {
  if (!cont || !document.contains(cont)) { unsubs.forEach(f => f()); unsubs = []; return; }
  if (cont.contains(document.activeElement) && document.activeElement.id === "tp-obs") return; // ne pas effacer une saisie en cours
  const s = semaine(ui.semaine), suivi = st.suivi[ui.semaine] || {}, ed = estEditeur(user);
  const nbFaits = s.passages.filter(x => x.fait).length;
  // Récap des semaines récentes (à vérifier / validées).
  const recentes = [0, 1, 2, 3, 4, 5].map(k => dateKey(addDays(new Date(dateKey(lundi(new Date())) + "T12:00"), -7 * k)));
  cont.innerHTML = `<div class="stack">
    <div class="form-card no-print">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <button class="nav-btn" data-tp-sem="-1">‹</button>
        <b>Semaine du ${fmtShort(new Date(s.ws + "T12:00"))} au ${fmtShort(new Date(s.we + "T12:00"))}</b>
        <button class="nav-btn" data-tp-sem="1">›</button>
        <span class="tag" style="margin-left:auto;${suivi.valideLe ? "background:#d8f3e3;color:#11845b" : "background:#fff1d6;color:#8a5a00"}">${suivi.valideLe ? "✅ Validée" : "⏳ À vérifier"}</span>
      </div>
      <p class="hint" style="margin:6px 0 0">${nbFaits}/${s.passages.length} passage(s) fait(s) · ${s.reps.length ? "heures pointées" : "aucune heure pointée"}</p>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">${recentes.map(w => `<button class="tab-btn ${w === ui.semaine ? "active" : ""}" data-tp-aller="${w}" style="font-size:12px">${st.suivi[w]?.valideLe ? "✅" : "⏳"} ${new Date(w + "T12:00").toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })}</button>`).join("")}</div>
    </div>
    ${ed ? `<div class="form-card no-print">
      <label>Observations générales<textarea id="tp-obs" rows="2" placeholder="Remarques sur la semaine (visible sur la fiche)">${esc(suivi.observations || "")}</textarea></label>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
        ${suivi.valideLe ? `<button class="nav-btn" data-tp-devalider>↩️ Annuler la validation</button>` : `<button class="add-btn" data-tp-valider style="background:#11845b">✅ Vérifiée — valider la fiche</button>`}
        <button class="nav-btn" data-tp-print="1">🖨️ Imprimer / PDF</button>
        <button class="nav-btn" data-tp-print="0">🖨️ Sans les photos</button>
      </div></div>` : `<div class="no-print"><button class="nav-btn" data-tp-print="1">🖨️ Imprimer / PDF</button></div>`}
    ${ficheHTML(s, suivi)}
  </div>`;
  brancher(s, suivi);
}

const sauverSuivi = (patch) => setDoc(refSuivi(), { semaines: { [ui.semaine]: { ...(st.suivi[ui.semaine] || {}), ...patch } }, majLe: Date.now() }, { merge: true });

function brancher(s, suivi) {
  const $ = (q) => cont.querySelector(q), $$ = (q) => cont.querySelectorAll(q);
  $$("[data-tp-sem]").forEach(b => b.onclick = () => { ui.semaine = dateKey(addDays(new Date(ui.semaine + "T12:00"), 7 * +b.dataset.tpSem)); render(); });
  $$("[data-tp-aller]").forEach(b => b.onclick = () => { ui.semaine = b.dataset.tpAller; render(); });
  $$("[data-tp-print]").forEach(b => b.onclick = () => imprimerFiche(b.dataset.tpPrint === "1"));
  const { liste } = photosClassees(s);
  $$("[data-tp-voir]").forEach(im => im.onclick = () => voirPhotos(liste, +im.dataset.tpVoir));
  const obs = $("#tp-obs");
  if (obs) obs.onchange = async () => { try { await sauverSuivi({ observations: obs.value.trim() }); window.toast?.("Observations enregistrées"); } catch (e) { alert("Enregistrement impossible : " + (e?.message || e)); } };
  $("[data-tp-valider]")?.addEventListener("click", async (e) => {
    const manque = s.passages.filter(x => !x.fait && x.d <= dateKey(new Date())).length;
    if (!confirm(`Valider la fiche de la semaine du ${fmtShort(new Date(s.ws + "T12:00"))} ?${manque ? `\n⚠️ ${manque} passage(s) non fait(s) ou incomplet(s).` : ""}`)) return;
    e.currentTarget.disabled = true;
    try { await sauverSuivi({ observations: (obs?.value || suivi.observations || "").trim(), valideLe: Date.now(), validePar: user?.nom || user?.email || "" }); window.toast?.("✅ Fiche validée"); }
    catch (err) { alert("Validation impossible : " + (err?.message || err)); e.currentTarget.disabled = false; }
  });
  $("[data-tp-devalider]")?.addEventListener("click", async () => {
    if (!confirm("Annuler la validation de cette fiche ?")) return;
    try { await sauverSuivi({ valideLe: null, validePar: null }); } catch (err) { alert("Impossible : " + (err?.message || err)); }
  });
}

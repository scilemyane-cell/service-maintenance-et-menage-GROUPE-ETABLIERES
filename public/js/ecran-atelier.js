// ecran-atelier.js — « 📺 Écran atelier » : affichage pour la grande télé de
// l'atelier (compte de l'équipe). Tout se met à jour en direct :
//   • urgences en cours (les nouvelles clignotent, son en option) ;
//   • nouvelles demandes des 7 derniers jours ;
//   • pense-bête : événements à ne pas oublier (ajout / suppression ici) ;
//   • astreinte du jour (N1 / N2 + téléphone) ;
//   • horloge et date en grand.
// Bouton « Plein écran » : l'écran garde l'appli affichée sans veille.
import { db } from "./firebase-init.js";
import { collection, doc, addDoc, deleteDoc, onSnapshot, serverTimestamp } from "./firestore-compte.js";
import { watchUrgencesOuvertes, watchNouvellesDemandes, watchPeople, watchAbsences, watchDemandes } from "./firestore-data.js";
import { watchCoordonnees } from "./coordonnees-data.js";
import { resolveDayN1, resolveDayN2, computeWeeklyTitulaires, esc } from "./astreinte-logic.js";

const COL = "atelier-memos";
let conteneur = null, user = null, unsubs = [], timer = null, wakeLock = null;
let urgences = [], nouvelles = [], memos = [], people = null, absences = [], coord = {}, mesDemandes = [];
let dejaVues = null, sonActif = false, edition = false;

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const joursEntre = (a, b) => Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 864e5);
const depuis = (ms) => { if (!ms) return ""; const h = Math.floor((Date.now() - ms) / 36e5); return h < 1 ? "à l'instant" : h < 24 ? `il y a ${h} h` : `il y a ${Math.floor(h / 24)} j`; };
const quand = (date) => {
  if (!date) return { txt: "À ne pas oublier", cls: "" };
  const j = joursEntre(iso(new Date()), date);
  const jour = new Date(date + "T00:00:00").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  if (j < 0) return { txt: `En retard · ${jour}`, cls: "retard" };
  if (j === 0) return { txt: "Aujourd'hui", cls: "auj" };
  if (j === 1) return { txt: "Demain", cls: "dem" };
  return { txt: `${jour} · dans ${j} j`, cls: j <= 7 ? "semaine" : "" };
};

function bip() {
  if (!sonActif) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.25, 0.5].forEach(t => { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = 880; o.connect(g); g.connect(ctx.destination); g.gain.setValueAtTime(0.25, ctx.currentTime + t); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.2); o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.22); });
  } catch { /* pas de son */ }
}

function astreinteHTML() {
  if (!people?.n1?.length) return "";
  const actifs = people.astreinteActive || {};
  const p = { ...people, n1: people.n1.filter(n => actifs[n] !== false), n2: (people.n2 || []).filter(n => actifs[n] !== false) };
  if (!p.n1.length || !p.n2.length) return "";
  try {
    const { titN1, titN2 } = computeWeeklyTitulaires(p, absences);
    const n1 = resolveDayN1(new Date(), p, absences, titN1)?.assigned, n2 = resolveDayN2(new Date(), p, absences, titN2)?.assigned;
    const ligne = (niv, nom) => nom ? `<div class="ea-ast-l"><span>${niv}</span><b>${esc(nom)}</b>${coord[nom]?.telephone ? `<em>📞 ${esc(coord[nom].telephone)}</em>` : ""}</div>` : "";
    return `<section class="ea-bloc ea-ast"><h2>📞 Astreinte aujourd'hui</h2>${ligne("N1", n1)}${ligne("N2", n2)}</section>`;
  } catch { return ""; }
}

function render() {
  if (!conteneur) return;
  const now = new Date();
  const actifsMemos = memos.filter(m => !m.date || joursEntre(iso(now), m.date) >= -1)
    .sort((a, b) => (a.date ? 0 : 1) - (b.date ? 0 : 1) || String(a.date || "").localeCompare(String(b.date || "")) || (b.important ? 1 : 0) - (a.important ? 1 : 0));
  const urgTri = [...urgences].sort((a, b) => (a.urgence === "Critique" ? 0 : 1) - (b.urgence === "Critique" ? 0 : 1) || (b.importeMs || 0) - (a.importeMs || 0));
  const nouv = nouvelles.filter(n => !urgences.some(u => u.id === n.id)).sort((a, b) => (b.importeMs || 0) - (a.importeMs || 0)).slice(0, 7);
  const plein = !!document.fullscreenElement;
  conteneur.innerHTML = `${STYLE}<div class="ea-scene"><div class="ea ${plein ? "plein" : ""}">
    <header class="ea-tete">
      <div><div class="ea-titre">🛠️ Atelier — Service Maintenance</div><div class="ea-date">${now.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</div></div>
      <div class="ea-heure">${now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</div>
      <div class="ea-cmd">
        <button data-ea="son" class="${sonActif ? "on" : ""}">${sonActif ? "🔔 Son activé" : "🔕 Activer le son"}</button>
        <button data-ea="edit">${edition ? "✓ Fermer" : "✏️ Pense-bête"}</button>
        <button data-ea="plein">${plein ? "⤢ Quitter le plein écran" : "⛶ Plein écran"}</button>
      </div>
    </header>
    ${edition ? editionHTML() : ""}
    <div class="ea-grille">
      <section class="ea-bloc ea-urg">
        <h2>🚨 Urgences en cours <span class="ea-nb ${urgTri.length ? "rouge" : "vert"}">${urgTri.length}</span></h2>
        ${urgTri.length ? urgTri.slice(0, 5).map(u => `<div class="ea-u ${u.urgence === "Critique" ? "critique" : ""} ${u.importeMs && Date.now() - u.importeMs < 4 * 36e5 ? "neuve" : ""}">
          <div class="ea-u-l1"><span class="ea-num">${esc(u.numero || "")}</span><b>${esc(u.site || "")}</b>${u.local ? `<span class="ea-loc">📍 ${esc(u.local)}</span>` : ""}<span class="ea-tag">${esc(u.urgence)}</span>${u.importeMs && Date.now() - u.importeMs < 4 * 36e5 ? `<span class="ea-new">NOUVELLE</span>` : ""}</div>
          <div class="ea-u-txt">${esc(String(u.descriptif || "").slice(0, 160))}</div>
          <div class="ea-u-pied">${depuis(u.importeMs)}${u.action ? ` · 📌 ${esc(u.action.texte)}` : ""}</div>
        </div>`).join("") + (urgTri.length > 5 ? `<div class="ea-plus">+ ${urgTri.length - 5} autre(s) urgence(s)</div>` : "") : `<div class="ea-vide">✅ Aucune urgence en cours</div>`}
      </section>
      <div class="ea-col">
        <section class="ea-bloc ea-memo">
          <h2>📌 Pense-bête</h2>
          ${actifsMemos.length ? actifsMemos.slice(0, 6).map(m => { const q = quand(m.date); return `<div class="ea-m ${q.cls} ${m.important ? "important" : ""}"><span class="ea-m-q">${m.important ? "⭐ " : ""}${esc(q.txt)}</span><span class="ea-m-t">${esc(m.texte)}</span></div>`; }).join("") : `<div class="ea-vide petit">Rien de prévu. Ajoute un rappel avec ✏️ Pense-bête.</div>`}
        </section>
        ${astreinteHTML()}
      </div>
      <div class="ea-col">
        <section class="ea-bloc ea-nouv">
          <h2>🆕 Nouvelles demandes</h2><p class="ea-sous">7 derniers jours</p>
          ${nouv.length ? nouv.map(n => `<div class="ea-n"><div class="ea-n-l1">${/^SG-/.test(n.numero || "") ? `<span class="ea-num">${esc(n.numero)}</span>` : ""}<b>${esc(n.site || "")}</b>${n.local ? `<span class="ea-n-loc">· ${esc(n.local)}</span>` : ""}</div><span class="ea-n-t">${esc(String(n.descriptif || ""))}</span></div>`).join("") : `<div class="ea-vide petit">Aucune nouvelle demande.</div>`}
        </section>
      </div>
    </div>
    ${mesDemandes.length ? `<footer class="ea-pied">👷 Demandes attribuées à ${esc(user?.nom || "l'équipe")} : <b>${mesDemandes.length}</b> à traiter${mesDemandes.filter(d => ["Urgent", "Critique"].includes(d.urgenceCorrigee || d.urgence)).length ? ` · dont <b class="rouge">${mesDemandes.filter(d => ["Urgent", "Critique"].includes(d.urgenceCorrigee || d.urgence)).length} urgente(s)</b>` : ""}</footer>` : ""}
  </div></div>`;
  ajuster();
}

// Écran « télé » : une scène fixe 1920 × 1080 (16:9, paysage) mise à
// l'échelle de l'écran — même rendu sur la télé, un PC ou un portable.
function ajuster() {
  const scene = conteneur?.querySelector(".ea-scene"), ea = scene?.firstElementChild; if (!ea) return;
  const plein = !!document.fullscreenElement;
  const w = plein ? window.innerWidth : conteneur.clientWidth || window.innerWidth;
  // Hors plein écran : tout doit tenir dans la fenêtre, sans défiler.
  const h = plein ? window.innerHeight : Math.max(300, window.innerHeight - Math.max(0, conteneur.getBoundingClientRect().top + window.scrollY) - 12);
  const k = Math.min(w / 1920, h / 1080);
  ea.style.transform = `scale(${k})`;
  scene.style.height = `${1080 * k}px`;
  scene.style.width = `${1920 * k}px`;
}

function editionHTML() {
  return `<section class="ea-bloc ea-edit">
    <h2>✏️ Pense-bête — ajouter un rappel</h2>
    <form class="ea-form">
      <input name="texte" required maxlength="140" placeholder="Ex. Passage du contrôleur SSI au lycée, livraison de gaz…">
      <input name="date" type="date">
      <label><input type="checkbox" name="important"> ⭐ Important</label>
      <button>➕ Ajouter</button>
    </form>
    <div class="ea-edit-liste">${[...memos].sort((a, b) => String(a.date || "9").localeCompare(String(b.date || "9"))).map(m => `<div><span>${m.date ? new Date(m.date + "T00:00:00").toLocaleDateString("fr-FR") : "sans date"}${m.important ? " ⭐" : ""}</span><b>${esc(m.texte)}</b><small>${esc(m.par || "")}</small><button data-suppr="${esc(m.id)}">🗑️</button></div>`).join("") || `<p class="ea-vide petit">Aucun rappel.</p>`}</div>
    <p class="ea-aide">Les rappels datés disparaissent tout seuls le lendemain de leur date. Les rappels sans date restent jusqu'à ce que tu les supprimes.</p>
  </section>`;
}

async function surClic(e) {
  const b = e.target.closest("[data-ea]");
  if (b) {
    const a = b.dataset.ea;
    if (a === "son") { sonActif = !sonActif; if (sonActif) bip(); render(); }
    else if (a === "edit") { edition = !edition; render(); }
    else if (a === "plein") {
      try { if (document.fullscreenElement) await document.exitFullscreen(); else await conteneur.requestFullscreen(); } catch { /* refusé */ }
      try { if (!wakeLock && navigator.wakeLock) wakeLock = await navigator.wakeLock.request("screen"); } catch { /* pas de verrou */ }
      render();
    }
    return;
  }
  const s = e.target.closest("[data-suppr]");
  if (s && confirm("Supprimer ce rappel ?")) { try { await deleteDoc(doc(db, COL, s.dataset.suppr)); } catch (err) { alert("Suppression impossible : " + (err?.message || err)); } }
}
async function surEnvoi(e) {
  if (!e.target.matches(".ea-form")) return;
  e.preventDefault();
  const f = new FormData(e.target), texte = String(f.get("texte") || "").trim(); if (!texte) return;
  try { await addDoc(collection(db, COL), { texte, date: f.get("date") || "", important: !!f.get("important"), par: user?.nom || user?.email || "", creeLe: serverTimestamp() }); e.target.reset(); }
  catch (err) { alert("Ajout impossible : " + (err?.message || err) + "\n(Les règles Firestore « atelier-memos » sont-elles publiées ?)"); }
}

function nettoyer() {
  unsubs.forEach(u => { try { u(); } catch { /* */ } }); unsubs = [];
  clearInterval(timer); timer = null;
  try { wakeLock?.release(); } catch { /* */ } wakeLock = null;
}

export function mountEcranAtelier(container, u) {
  nettoyer();
  conteneur = container; user = u; dejaVues = null;
  if (!container.dataset.eaEcoute) {
    container.addEventListener("click", surClic);
    container.addEventListener("submit", surEnvoi);
    document.addEventListener("fullscreenchange", () => conteneur && render());
    window.addEventListener("resize", () => conteneur && ajuster());
    document.addEventListener("visibilitychange", async () => { if (document.visibilityState === "visible" && document.fullscreenElement && navigator.wakeLock) { try { wakeLock = await navigator.wakeLock.request("screen"); } catch { /* */ } } });
    container.dataset.eaEcoute = "1";
  }
  unsubs.push(watchUrgencesOuvertes((l) => {
    const ids = new Set(l.map(x => x.id));
    if (dejaVues && l.some(x => !dejaVues.has(x.id))) bip();
    dejaVues = ids; urgences = l; render();
  }));
  unsubs.push(watchNouvellesDemandes((l) => { nouvelles = l; render(); }));
  unsubs.push(watchDemandes((l) => {
    mesDemandes = (l || []).filter(d => d.attribueA === u?.uid && !d.lieeA && !d.supprimeeLe && !/^(realis|annul|arbitrage)/.test(String(d.statut || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()));
    render();
  }));
  unsubs.push(onSnapshot(collection(db, COL), (s) => { memos = s.docs.map(d => ({ id: d.id, ...d.data() })); render(); }, (e) => { console.warn("Pense-bête :", e); memos = []; render(); }));
  unsubs.push(watchPeople((p) => { people = p; render(); }));
  unsubs.push(watchAbsences((a) => { absences = a || []; render(); }));
  unsubs.push(watchCoordonnees((c) => { coord = c || {}; render(); }));
  // Horloge : on redessine chaque minute (sauf pendant une saisie).
  timer = setInterval(() => { const a = document.activeElement; if (!(a && conteneur?.contains(a) && a.matches("input"))) render(); }, 30000);
  render();
}

const STYLE = `<style>
  .ea-scene{position:relative;overflow:hidden;margin:0 auto;border-radius:14px;background:#0b1220}
  :fullscreen{background:#0b1220;display:flex;align-items:center;justify-content:center}
  :fullscreen .ea-scene{border-radius:0}
  .ea{--ea-bg:#0b1220;--ea-carte:#141d30;--ea-bord:#24304a;--ea-txt:#eef2f8;--ea-dim:#9aa7bd;position:absolute;top:0;left:0;width:1920px;height:1080px;box-sizing:border-box;transform-origin:0 0;background:var(--ea-bg);color:var(--ea-txt);padding:28px 34px;font-size:22px;display:flex;flex-direction:column;overflow:hidden}
  .ea-tete{display:flex;align-items:center;gap:20px;margin-bottom:18px}
  .ea-titre{font-size:1.6em;font-weight:800}.ea-date{color:var(--ea-dim);font-size:1.05em}.ea-date::first-letter,.ea-m-q::first-letter{text-transform:uppercase}
  .ea-heure{margin-left:auto;font-size:3.2em;font-weight:800;letter-spacing:1px;font-variant-numeric:tabular-nums}
  .ea-cmd{display:flex;flex-direction:column;gap:6px}
  .ea-cmd button{background:var(--ea-carte);color:var(--ea-txt);border:1px solid var(--ea-bord);border-radius:10px;padding:6px 14px;font:inherit;font-size:16px;cursor:pointer}
  .ea-cmd button.on{border-color:#1baf7a;color:#5fe0a8}
  .ea-grille{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1.45fr) minmax(0,1fr) minmax(0,.85fr);gap:22px;align-items:stretch}
  .ea-grille{grid-template-rows:minmax(0,1fr)}
  .ea-col{min-height:0}
  .ea-grille>.ea-bloc,.ea-col>.ea-bloc{overflow:hidden;min-height:0}
  .ea-sous{margin:-8px 0 10px;color:var(--ea-dim);font-size:.75em}
  .ea-col>.ea-memo{flex:1 1 auto}.ea-col>.ea-ast{flex:none}.ea-col>.ea-nouv{flex:1 1 auto}
  .ea-col{display:flex;flex-direction:column;gap:18px}
  .ea-bloc{background:var(--ea-carte);border:1px solid var(--ea-bord);border-radius:16px;padding:16px 18px}
  .ea-bloc h2{margin:0 0 12px;font-size:1.25em;display:flex;align-items:center;gap:10px}.ea-bloc h2 small{font-size:.6em;color:var(--ea-dim);font-weight:400}
  .ea-nb{font-size:.85em;border-radius:99px;padding:2px 12px}.ea-nb.rouge{background:#e04848}.ea-nb.vert{background:#1baf7a}
  .ea-u{border-left:6px solid #f0a020;background:#1a2440;border-radius:12px;padding:12px 14px;margin-bottom:10px}
  .ea-u.critique{border-left-color:#e04848;background:#2a1720}
  .ea-u.neuve{animation:ea-flash 1.6s ease-in-out infinite}
  @keyframes ea-flash{0%,100%{box-shadow:0 0 0 0 rgba(224,72,72,0)}50%{box-shadow:0 0 0 4px rgba(224,72,72,.55)}}
  .ea-u-l1{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:1.1em}
  .ea-num{font-family:ui-monospace,monospace;font-size:.8em;background:#0b1220;border:1px solid var(--ea-bord);border-radius:6px;padding:1px 7px;color:var(--ea-dim)}
  .ea-loc{color:#ffd27a}.ea-tag{margin-left:auto;font-size:.75em;font-weight:800;text-transform:uppercase;color:#ffb3b3}
  .ea-new{font-size:.7em;font-weight:800;background:#e04848;color:#fff;border-radius:6px;padding:2px 8px}
  .ea-u-txt{margin-top:6px;font-size:1.05em;line-height:1.35}
  .ea-u-pied{margin-top:4px;color:var(--ea-dim);font-size:.8em}
  .ea-plus{color:var(--ea-dim);text-align:center}
  .ea-vide{color:#5fe0a8;font-size:1.3em;text-align:center;padding:30px 0}.ea-vide.petit{font-size:.95em;color:var(--ea-dim);padding:10px 0;text-align:left}
  .ea-m{display:flex;flex-direction:column;gap:2px;padding:10px 12px;border-radius:10px;background:#1a2440;margin-bottom:8px;border-left:5px solid var(--ea-bord)}
  .ea-m.auj{border-left-color:#e04848;background:#2a1720}.ea-m.dem{border-left-color:#f0a020}.ea-m.semaine{border-left-color:#3b7be0}.ea-m.retard{border-left-color:#e04848;opacity:.85}
  .ea-m.important .ea-m-t{font-weight:800}
  .ea-m-q{font-size:.78em;color:var(--ea-dim)}.ea-m.auj .ea-m-q{color:#ff9b9b;font-weight:800}
  .ea-m-t{font-size:1.1em}
  .ea-ast-l{display:flex;align-items:baseline;gap:12px;font-size:1.15em;padding:4px 0}.ea-ast-l span{font-size:.75em;font-weight:800;background:#3b7be0;border-radius:6px;padding:1px 8px}.ea-ast-l em{font-style:normal;color:#ffd27a;margin-left:auto}
  .ea-n{display:flex;flex-direction:column;gap:2px;padding:7px 0;border-bottom:1px solid var(--ea-bord);font-size:.92em}.ea-n:last-child{border-bottom:none}
  .ea-n-l1{display:flex;align-items:baseline;gap:8px;white-space:nowrap;overflow:hidden}.ea-n-l1 b{flex:none;max-width:75%;overflow:hidden;text-overflow:ellipsis}.ea-n-l1 .ea-num{flex:none}.ea-n-loc{color:var(--ea-dim);overflow:hidden;text-overflow:ellipsis}
  .ea-n-t{color:var(--ea-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ea-pied{margin-top:18px;background:var(--ea-carte);border:1px solid var(--ea-bord);border-radius:12px;padding:10px 16px;font-size:1.05em}.ea-pied .rouge{color:#ff8a8a}
  .ea-edit{position:absolute;top:150px;left:34px;right:34px;z-index:5;max-height:860px;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.6);font-size:20px}
  .ea-edit-liste div{font-size:18px!important}
  .ea-form{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
  .ea-form input[name=texte]{flex:1;min-width:240px}
  .ea-form input{background:#0b1220;color:var(--ea-txt);border:1px solid var(--ea-bord);border-radius:8px;padding:9px 10px;font:inherit;font-size:20px}
  .ea-form label{font-size:14px;display:flex;gap:6px;align-items:center}
  .ea-form button,.ea-edit-liste button{background:#1baf7a;color:#fff;border:none;border-radius:8px;padding:9px 14px;font:inherit;font-size:14px;font-weight:700;cursor:pointer}
  .ea-edit-liste{margin-top:12px;display:flex;flex-direction:column;gap:6px}
  .ea-edit-liste div{display:grid;grid-template-columns:110px 1fr auto auto;gap:10px;align-items:center;font-size:14px;padding:6px 0;border-bottom:1px solid var(--ea-bord)}
  .ea-edit-liste span,.ea-edit-liste small{color:var(--ea-dim)}.ea-edit-liste button{background:none;padding:4px}
  .ea-aide{color:var(--ea-dim);font-size:13px;margin:10px 0 0}
</style>`;

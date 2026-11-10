// maison-plan.js — Programmation des pièces d'une maison, par niveau
// (RDC, 1er étage, combles…), réutilisée à chaque gros ménage.
// Stockage : config/plans-maisons → { plans: { <clé maison>: { niveaux: [{ nom, pieces: [..] }] } } }
// La clé est l'id du dossier de site quand il existe (sinon l'id du site).
import { db } from "./firebase-init.js";
import { doc, setDoc, onSnapshot } from "./firestore-compte.js";
import { esc } from "./astreinte-logic.js";

const REF = () => doc(db, "config", "plans-maisons");
export function watchPlans(cb) {
  return onSnapshot(REF(), (s) => cb(s.exists() ? (s.data().plans || {}) : {}), (e) => { console.warn("Plans maisons :", e); cb({}); });
}
export const savePlan = (cle, plan) => setDoc(REF(), { plans: { [cle]: { niveaux: plan.niveaux || [], majLe: Date.now() } } }, { merge: true });
export const clePlan = (site) => site ? (site.dossierId || site.id) : "";

// Liste à plat : { cle (unique, sert aussi aux photos), nom, niveau }.
export function piecesDuPlan(plan) {
  const out = [];
  (plan?.niveaux || []).forEach(n => (n.pieces || []).forEach(p => {
    const nom = String(p || "").trim(); if (!nom) return;
    out.push({ cle: n.nom ? `${n.nom} · ${nom}` : nom, nom, niveau: n.nom || "" });
  }));
  return out;
}

const NIVEAUX = ["Sous-sol", "RDC", "1er étage", "2e étage", "3e étage", "Combles", "Extérieur"];
const RAPIDES = ["Chambre", "Salle de bain", "WC", "Cuisine", "Salon", "Séjour", "Bureau", "Couloir", "Escalier", "Entrée", "Buanderie", "Cellier", "Garage", "Terrasse"];

export const STYLE_PLAN = `<style>
.pl{display:flex;flex-direction:column;gap:12px}
.pl-niv{background:var(--panel);border:1px solid var(--border);border-left:4px solid #2f6fd6;border-radius:14px;padding:12px}
.pl-niv-t{display:flex;gap:6px;align-items:center;margin-bottom:8px}
.pl-niv-t input{flex:1;font:inherit;font-size:16px;font-weight:800;padding:6px 8px;border-radius:8px;border:1px solid transparent;background:transparent;color:var(--text)}
.pl-niv-t input:hover,.pl-niv-t input:focus{border-color:var(--border);background:var(--panel-alt)}
.pl-niv-t .nav-btn{padding:4px 9px}
.pl-pcs{display:flex;flex-wrap:wrap;gap:6px;min-height:30px}
.pl-pc{display:inline-flex;align-items:center;gap:6px;background:var(--panel-alt);border:1px solid var(--border);border-radius:999px;padding:5px 6px 5px 12px;font-size:14px}
.pl-pc button{border:none;background:#d9534f;color:#fff;border-radius:50%;width:20px;height:20px;cursor:pointer;font-size:11px;line-height:1}
.pl-add{display:flex;gap:6px;margin-top:10px}.pl-add input{flex:1;padding:8px;border-radius:9px;border:1px solid var(--border);background:var(--panel-alt);color:var(--text);font:inherit}
.pl-rap{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px}.pl-rap button{border:1px dashed var(--border);background:transparent;color:var(--text);border-radius:999px;padding:4px 10px;font:inherit;font-size:12.5px;cursor:pointer}
.pl-rap button:hover{border-color:#2f6fd6;color:#2f6fd6}
.pl-vide{text-align:center;padding:20px}
</style>`;

// Éditeur. opts : { site, plan, fiches (pièces de la fiche ménage), onSave(plan) }
export function editeurPlanHTML({ site, plan, fiches = [] }) {
  const nivs = plan?.niveaux || [];
  const libres = NIVEAUX.filter(n => !nivs.some(x => x.nom === n));
  return `${STYLE_PLAN}<div class="pl">
    ${nivs.length ? nivs.map((n, i) => `<div class="pl-niv">
      <div class="pl-niv-t"><input value="${esc(n.nom)}" data-pl-ren="${i}" title="Renommer le niveau">
        <button class="nav-btn" data-pl-up="${i}" ${i ? "" : "disabled"} title="Monter">↑</button><button class="nav-btn" data-pl-down="${i}" ${i < nivs.length - 1 ? "" : "disabled"} title="Descendre">↓</button>
        <button class="nav-btn" data-pl-delniv="${i}" title="Supprimer ce niveau">🗑️</button></div>
      <div class="pl-pcs">${(n.pieces || []).map((p, j) => `<span class="pl-pc">${esc(p)}<button data-pl-delpc="${i}|${j}" title="Retirer">✕</button></span>`).join("") || `<span class="hint">Aucune pièce : ajoute-les ci-dessous.</span>`}</div>
      <div class="pl-add"><input data-pl-txt="${i}" placeholder="Nom de la pièce (ex. Chambre 3, Salle de bain étage)"><button class="add-btn" data-pl-addpc="${i}">＋ Ajouter</button></div>
      <div class="pl-rap">${RAPIDES.map(r => `<button data-pl-rap="${i}|${esc(r)}">＋ ${esc(r)}</button>`).join("")}</div>
    </div>`).join("") : `<div class="form-card pl-vide"><p>Aucune pièce programmée pour <b>${esc(site?.name || "cette maison")}</b>.</p>
      ${fiches.length ? `<button class="add-btn" data-pl-import>📋 Reprendre les pièces de la fiche ménage (${fiches.length})</button> ` : ""}<button class="nav-btn" data-pl-addniv="RDC">＋ Commencer par le RDC</button></div>`}
    ${nivs.length ? `<div class="form-card"><b>＋ Ajouter un niveau</b><div class="pl-rap">${libres.map(n => `<button data-pl-addniv="${esc(n)}">＋ ${esc(n)}</button>`).join("")}<button data-pl-addniv="">＋ Autre…</button></div></div>` : ""}
  </div>`;
}

// Branche l'éditeur ; chaque modification est enregistrée tout de suite.
export function brancherEditeurPlan(zone, { site, plan, fiches = [], onChange }) {
  const p = { niveaux: JSON.parse(JSON.stringify(plan?.niveaux || [])) };
  const sauver = () => { onChange?.(p); savePlan(clePlan(site), p).catch(e => alert("Enregistrement impossible : " + (e?.message || e))); };
  const numeroChambre = () => { let max = 0; p.niveaux.forEach(n => n.pieces.forEach(x => { const m = /^chambre\s*(\d+)/i.exec(x); if (m) max = Math.max(max, +m[1]); })); return max + 1; };
  const ajouter = (i, nom) => {
    nom = String(nom || "").trim(); if (!nom) return;
    if (/^chambre$/i.test(nom)) nom = `Chambre ${numeroChambre()}`;
    const n = p.niveaux[i]; let final = nom, k = 2;
    while (n.pieces.some(x => x.toLowerCase() === final.toLowerCase())) final = `${nom} ${k++}`;
    n.pieces.push(final); sauver();
  };
  zone.querySelectorAll("[data-pl-addpc]").forEach(b => b.onclick = () => { const i = +b.dataset.plAddpc, inp = zone.querySelector(`[data-pl-txt="${i}"]`); const v = inp.value; inp.value = ""; inp.blur(); ajouter(i, v); });
  zone.querySelectorAll("[data-pl-txt]").forEach(inp => inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); const v = inp.value; inp.value = ""; inp.blur(); ajouter(+inp.dataset.plTxt, v); } }));
  zone.querySelectorAll("[data-pl-rap]").forEach(b => b.onclick = () => { const [i, nom] = b.dataset.plRap.split("|"); ajouter(+i, nom); });
  zone.querySelectorAll("[data-pl-delpc]").forEach(b => b.onclick = () => { const [i, j] = b.dataset.plDelpc.split("|").map(Number); p.niveaux[i].pieces.splice(j, 1); sauver(); });
  zone.querySelectorAll("[data-pl-ren]").forEach(inp => inp.addEventListener("change", () => { const v = inp.value.trim(); if (!v) { inp.value = p.niveaux[+inp.dataset.plRen].nom; return; } p.niveaux[+inp.dataset.plRen].nom = v; inp.blur(); sauver(); }));
  zone.querySelectorAll("[data-pl-up]").forEach(b => b.onclick = () => { const i = +b.dataset.plUp; [p.niveaux[i - 1], p.niveaux[i]] = [p.niveaux[i], p.niveaux[i - 1]]; sauver(); });
  zone.querySelectorAll("[data-pl-down]").forEach(b => b.onclick = () => { const i = +b.dataset.plDown; [p.niveaux[i + 1], p.niveaux[i]] = [p.niveaux[i], p.niveaux[i + 1]]; sauver(); });
  zone.querySelectorAll("[data-pl-delniv]").forEach(b => b.onclick = () => { const i = +b.dataset.plDelniv, n = p.niveaux[i]; if (!confirm(`Supprimer le niveau « ${n.nom} »${n.pieces.length ? ` et ses ${n.pieces.length} pièce(s)` : ""} ?`)) return; p.niveaux.splice(i, 1); sauver(); });
  zone.querySelectorAll("[data-pl-addniv]").forEach(b => b.onclick = () => {
    let nom = b.dataset.plAddniv; if (!nom) { nom = (prompt("Nom du niveau (ex. Mezzanine, Annexe) :") || "").trim(); if (!nom) return; }
    if (p.niveaux.some(n => n.nom.toLowerCase() === nom.toLowerCase())) { alert("Ce niveau existe déjà."); return; }
    // Rangé à sa place logique (Sous-sol → RDC → étages → Combles → Extérieur).
    const rang = (x) => { const i = NIVEAUX.indexOf(x); return i < 0 ? 50 : i * 10; };
    const pos = p.niveaux.findIndex(n => rang(n.nom) > rang(nom));
    p.niveaux.splice(pos < 0 ? p.niveaux.length : pos, 0, { nom, pieces: [] }); sauver();
  });
  zone.querySelector("[data-pl-import]")?.addEventListener("click", () => { p.niveaux = [{ nom: "RDC", pieces: [...fiches] }]; sauver(); });
}

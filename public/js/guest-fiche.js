// guest-fiche.js — Fiches de traçabilité ménage remplies par un prestataire
// ou un remplaçant externe, via un lien personnel (guest.html?invite=…).
//  • Le lien est limité dans le temps (du … au …) et à un ou plusieurs sites.
//  • À la première ouverture, la personne indique prénom, nom et société ;
//    le téléphone s'en souvient (même appareil = mêmes fiches en cours).
//  • La fiche se remplit jour par jour ; « Terminer et envoyer » la transmet
//    au responsable, qui la vérifie et la valide avant l'envoi au MNA.
import { addDays, dateKey, fmtShort, esc } from "./astreinte-logic.js";
import { watchSites } from "./sites-data.js";
import { watchFiches, saveFiche, ficheId } from "./fiches-data.js";

const JOURS = ["LUN", "MAR", "MER", "JEU", "VEN"];
const NOMS = { LUN: "Lundi", MAR: "Mardi", MER: "Mercredi", JEU: "Jeudi", VEN: "Vendredi" };

let state = { sites: [], fiches: [] };
let ui = { weekStart: null, siteId: null, jour: null };
let local = null, unsubs = [], conteneur = null, user = null, invitation = null, saveTimer = null, identite = null;

const cleIdentite = () => `presta-${invitation.id}`;
function lireIdentite() { try { return JSON.parse(localStorage.getItem(cleIdentite()) || "null"); } catch { return null; } }
function ecrireIdentite(v) { try { localStorage.setItem(cleIdentite(), JSON.stringify(v)); } catch { /* */ } }
const nomAgent = () => identite ? `${identite.prenom} ${identite.nom}${identite.societe ? ` (${identite.societe})` : ""}` : (invitation.label || "Prestataire");
export const sitesInvitation = (inv) => (Array.isArray(inv.sites) && inv.sites.length ? inv.sites : [{ id: inv.siteId, name: inv.siteName }]).filter(s => s && s.id);

const STYLE_GF = `<style>
      .gf{max-width:720px;margin:0 auto;display:flex;flex-direction:column;gap:12px}
      .gf-qui{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:13px;color:var(--text-dim)}
      .gf-qui button{background:none;border:none;color:var(--text-dim);text-decoration:underline;cursor:pointer;font:inherit;font-size:12px}
      .gf-sel{display:flex;gap:8px;flex-wrap:wrap}.gf-sel select{flex:1;min-width:160px;padding:10px;border-radius:10px;border:1px solid var(--border);background:var(--panel-alt);color:var(--text);font:inherit}
      .gf-jours{display:grid;grid-template-columns:repeat(5,1fr);gap:6px}
      .gf-jours button{padding:9px 4px;border-radius:10px;border:1px solid var(--border);background:var(--panel);color:var(--text);font:inherit;font-size:13px;font-weight:700;cursor:pointer;display:flex;flex-direction:column;align-items:center}
      .gf-jours button small{font-weight:500;color:var(--text-dim);font-size:11px}.gf-jours button.on{background:#1baf7a;color:#fff;border-color:#1baf7a}.gf-jours button.on small{color:#eafff4}
      .gf-piece h3{margin:0 0 8px;font-size:15px}
      .gf-t{display:flex;align-items:center;gap:12px;padding:10px 0;border-top:1px solid var(--border)}.gf-t:first-of-type{border-top:none}
      .gf-t input[type=checkbox]{width:26px;height:26px;accent-color:#1baf7a;flex:none}
      .gf-t label{flex:1;font-size:14.5px}.gf-t.fait label{text-decoration:line-through;color:var(--text-dim)}
      .gf-t .gf-obs{width:100%;margin-top:4px;padding:6px 8px;border-radius:8px;border:1px solid var(--border);background:var(--panel-alt);color:var(--text);font:inherit;font-size:12.5px}
      .gf-id form{display:flex;flex-direction:column;gap:10px}.gf-id label{display:flex;flex-direction:column;gap:4px;font-size:13px;font-weight:600}.gf-id input{padding:11px;border-radius:10px;border:1px solid var(--border);background:var(--panel-alt);color:var(--text);font:inherit;font-size:15px;width:100%;box-sizing:border-box}
      .gf-bas{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.gf-bas .add-btn{padding:12px 16px}
      .gf-ok{background:#e9f8f0;color:#11845b;border:1px solid #bfe8d4;border-radius:10px;padding:10px 12px;font-weight:600}
      .gf-att{background:#fff4dc;color:#8a5a00;border:1px solid #f0c060;border-radius:10px;padding:10px 12px;font-weight:600}
    </style>`;

function cleanup() { unsubs.forEach(u => u()); unsubs = []; }

export function mountGuestFiche(container, u, inv) {
  cleanup();
  conteneur = container; user = u; invitation = inv; identite = lireIdentite();
  const auj = dateKey(new Date());
  // Semaine affichée : celle d'aujourd'hui si elle fait partie de l'accès.
  const lundi = dateKey(addDays(new Date(), -((new Date().getDay() + 6) % 7)));
  ui.weekStart = inv.weeks.includes(lundi) ? lundi : inv.weeks[0];
  ui.siteId = sitesInvitation(inv)[0]?.id;
  const j = JOURS[(new Date().getDay() + 6) % 7];
  ui.jour = ui.weekStart === lundi && j ? j : "LUN";
  void auj;
  container.innerHTML = `<div class="hint">Chargement…</div>`;
  unsubs.push(watchSites((s) => { state.sites = s; render(); }));
  unsubs.push(watchFiches((f) => { state.fiches = f; if (local && Date.now() < local.jusqua) { const i = f.findIndex(x => x.id === local.copie.id); if (i >= 0) f[i] = local.copie; else f.push(local.copie); } render(); }));
}

function currentFiche() {
  const site = state.sites.find(s => s.id === ui.siteId);
  const id = ficheId(ui.siteId, ui.weekStart, user.uid);
  const existing = state.fiches.find(f => f.id === id);
  if (existing) return { id, data: { cells: {}, obs: {}, chambres: [], ...existing }, site };
  return { id, site, data: {
    siteId: ui.siteId, siteName: site?.name || "", weekStart: ui.weekStart, weekEnd: dateKey(addDays(new Date(ui.weekStart + "T00:00:00"), 4)),
    agentUid: user.uid, agentNom: nomAgent(), prestataire: true, invitation: invitation.id, societe: identite?.societe || "",
    cells: {}, obs: {}, chambres: [], observationsGenerales: "", submitted: false,
  } };
}
function sauver(id, data, delai = 500) {
  clearTimeout(saveTimer);
  data.agentNom = nomAgent(); data.prestataire = true; data.invitation = invitation.id; data.societe = identite?.societe || "";
  // Copie locale immédiate : l'écran ne revient pas en arrière en attendant Firestore.
  const i = state.fiches.findIndex(f => f.id === id), copie = { id, ...data, cells: { ...data.cells }, obs: { ...data.obs } };
  if (i >= 0) state.fiches[i] = copie; else state.fiches.push(copie);
  local = { copie, jusqua: Date.now() + 4000 };
  const etat = conteneur.querySelector("#gf-etat"); if (etat) etat.textContent = "⏳ Enregistrement…";
  saveTimer = setTimeout(async () => {
    try { await saveFiche(id, data); const e = conteneur.querySelector("#gf-etat"); if (e) e.textContent = "✓ Enregistré"; }
    catch (err) { const e = conteneur.querySelector("#gf-etat"); if (e) e.textContent = "❌ Pas enregistré (réseau ?)"; console.error(err); }
  }, delai);
}

function formulaireIdentite() {
  conteneur.innerHTML = `${STYLE_GF}<div class="gf"><div class="form-card gf-id">
    <h2>👋 Bienvenue</h2>
    <p class="hint">Avant de commencer, indique qui tu es. Ce téléphone s'en souviendra pour les prochaines fois.</p>
    <form id="gf-id-form">
      <label>Prénom<input name="prenom" required autocomplete="given-name"></label>
      <label>Nom<input name="nom" required autocomplete="family-name"></label>
      <label>Société<input name="societe" required autocomplete="organization" value="${esc(invitation.label || "")}"></label>
      <button class="add-btn">Commencer ✓</button>
    </form></div></div>`;
  conteneur.querySelector("#gf-id-form").addEventListener("submit", (e) => {
    e.preventDefault(); const f = new FormData(e.target);
    identite = { prenom: String(f.get("prenom")).trim(), nom: String(f.get("nom")).trim(), societe: String(f.get("societe")).trim() };
    ecrireIdentite(identite); render();
  });
}

function render() {
  if (!conteneur) return;
  if (!document.contains(conteneur)) { cleanup(); return; }
  if (!identite) { formulaireIdentite(); return; }
  const a = document.activeElement; if (a && conteneur.contains(a) && a.matches("input:not([type=checkbox]), textarea")) return;
  const { id, data, site } = currentFiche();
  const sites = sitesInvitation(invitation);
  if (!site) { conteneur.innerHTML = `<div class="hint">Chargement du site…</div>`; return; }
  const verrou = !!data.validee;
  const jour = ui.jour;
  const itemsPiece = (ri, j) => { const r = site.rooms[ri]; if (!(r.days || []).includes(j)) return []; return (r.tasks || []).map((task, ti) => ({ ti, task, key: `${ri}-${ti}-${j}`, fait: !!data.cells[`${ri}-${ti}-${j}`] })); };
  const compteJour = (j) => { const l = (site.rooms || []).flatMap((_, ri) => itemsPiece(ri, j)); return { total: l.length, faits: l.filter(x => x.fait).length }; };
  const { total, faits } = compteJour(jour), pct = total ? Math.round(faits / total * 100) : 0;
  const sem = JOURS.reduce((acc, j) => { const c = compteJour(j); acc.t += c.total; acc.f += c.faits; return acc; }, { t: 0, f: 0 });
  const pctSem = sem.t ? Math.round(sem.f / sem.t * 100) : 0;
  const dJour = addDays(new Date(ui.weekStart + "T00:00:00"), JOURS.indexOf(jour));
  const pieces = (site.rooms || []).map((room, ri) => ({ room, ri, items: itemsPiece(ri, jour) })).filter(x => x.items.length);
  const r = 40, circ = 2 * Math.PI * r;
  const msg = !total ? "Pas de tâche aujourd'hui." : faits === 0 ? "C'est parti ! Touche une tâche quand elle est faite." : faits === total ? "Tout est fait, super travail ! 💪" : faits / total >= 0.75 ? `Presque fini, plus que ${total - faits} ! 🔥` : faits / total >= 0.5 ? `Plus de la moitié, continue ! (${total - faits} restantes)` : `Bien lancé ! Encore ${total - faits} tâche${total - faits > 1 ? "s" : ""}.`;
  conteneur.innerHTML = `${STYLE_GF}
    <div class="gf">
      <div class="gf-qui"><span>👤 ${esc(nomAgent())}</span><button id="gf-pas-moi">Ce n'est pas moi</button></div>
      ${sites.length > 1 || invitation.weeks.length > 1 ? `<div class="gf-sel">
        ${sites.length > 1 ? `<select id="gf-site">${sites.map(s => `<option value="${esc(s.id)}" ${s.id === ui.siteId ? "selected" : ""}>🏠 ${esc(s.name)}</option>`).join("")}</select>` : ""}
        ${invitation.weeks.length > 1 ? `<select id="gf-week">${invitation.weeks.map(w => `<option value="${w}" ${w === ui.weekStart ? "selected" : ""}>Semaine du ${fmtShort(new Date(w + "T00:00:00"))}</option>`).join("")}</select>` : ""}
      </div>` : ""}
      ${verrou ? `<div class="gf-ok">✅ Fiche vérifiée et validée par le responsable. Merci !</div>` : data.submitted ? `<div class="gf-att">📤 Fiche envoyée au responsable. Tu peux encore la rouvrir pour corriger.</div>` : ""}
      <div class="fj">
        <div class="fj-hero">
          <div class="fj-hero-txt">
            <div class="fj-bonjour">Bonjour ${esc(identite.prenom)} 👋</div>
            <div class="fj-date">${NOMS[jour]} ${dJour.getDate()}/${String(dJour.getMonth() + 1).padStart(2, "0")} · ${esc(site.name)}</div>
            <div class="fj-msg">${msg}</div>
            <div class="fj-sem">Semaine : <b>${sem.f}/${sem.t}</b><span class="fj-sem-barre"><span style="width:${pctSem}%"></span></span></div>
          </div>
          <div class="fj-hero-anneau">
            <svg class="fj-anneau" viewBox="0 0 100 100" width="92" height="92" aria-hidden="true"><circle cx="50" cy="50" r="${r}" class="fj-anneau-fond"/><circle cx="50" cy="50" r="${r}" class="fj-anneau-val" stroke-dasharray="${circ}" stroke-dashoffset="${circ * (1 - pct / 100)}"/></svg>
            <div class="fj-anneau-txt"><b>${pct}%</b><span>${faits}/${total}</span></div>
          </div>
        </div>
        <div class="fj-jours">${JOURS.map(j => { const c = compteJour(j), fini = c.total > 0 && c.faits === c.total; return `<button class="fj-jour ${j === jour ? "actif" : ""} ${fini ? "fini" : ""}" data-jour="${j}"><span>${NOMS[j].slice(0, 3).toUpperCase()}</span><small>${c.total ? (fini ? "✓" : `${c.faits}/${c.total}`) : "—"}</small></button>`; }).join("")}</div>
        <div class="fj-bravo ${total && faits === total ? "visible" : ""}"><span class="fj-bravo-emo">🎉</span><div><b>Bravo ! Journée terminée</b><br><small>Toutes les tâches du ${NOMS[jour].toLowerCase()} sont faites. Merci ✨</small></div></div>
        <p class="hint" style="margin:0;text-align:right"><span id="gf-etat"></span></p>
        ${pieces.length ? "" : `<div class="fj-vide">☕ Aucune tâche prévue ce jour-là sur ce site.</div>`}
        ${pieces.map(({ room, ri, items }) => { const f = items.filter(x => x.fait).length, fini = f === items.length; return `
        <div class="fj-piece ${fini ? "finie" : ""}">
          <div class="fj-piece-tete"><div class="fj-piece-nom">${esc(room.name)}</div><div class="fj-piece-compte">${f}/${items.length}</div>${verrou ? "" : `<button class="fj-tout" data-tout="${ri}">${fini ? "↺ Tout décocher" : "✓ Tout fait"}</button>`}</div>
          <div class="fj-piece-barre"><span style="width:${f / items.length * 100}%"></span></div>
          ${items.map(({ ti, task, key, fait }) => { const ko = `${ri}-${ti}`, obs = data.obs[ko] || ""; return `
          <div class="fj-tache ${fait ? "faite" : ""}">
            <button class="fj-coche" data-cell="${key}" aria-pressed="${fait}" aria-label="${esc(task.label)}" ${verrou ? "disabled" : ""}>
              <span class="fj-rond"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>
              <span class="fj-label">${esc(task.label)}${task.freq ? `<em>${esc(task.freq)}</em>` : ""}</span>
            </button>
            ${verrou ? "" : `<button class="fj-obs-btn ${obs ? "a-obs" : ""}" data-obs-btn="${ko}" title="Ajouter une remarque">💬</button>`}
            <div class="fj-obs ${obs ? "ouverte" : ""}" data-obs-zone="${ko}"><input data-obs="${ko}" value="${esc(obs)}" placeholder="Une remarque ? (produit manquant, souci…)" ${verrou ? "disabled" : ""}></div>
          </div>`; }).join("")}
        </div>`; }).join("")}
      </div>
      <div class="form-card"><label class="hint">Observations générales de la semaine</label>
        <textarea id="gf-obs-generales" rows="3" style="width:100%;box-sizing:border-box;background:var(--panel-alt);border:1px solid var(--border);border-radius:8px;padding:9px;color:var(--text);font:inherit" ${verrou ? "disabled" : ""}>${esc(data.observationsGenerales || "")}</textarea></div>
      ${verrou ? "" : `<div class="gf-bas"><button class="add-btn" id="gf-submit">${data.submitted ? "↩️ Rouvrir la fiche" : "📤 Terminer et envoyer au responsable"}</button></div>`}
    </div>`;

  const garderPos = (fn) => { const y = window.scrollY; fn(); render(); window.scrollTo(0, y); };
  conteneur.querySelectorAll("[data-cell]").forEach(b => b.addEventListener("click", () => garderPos(() => { data.cells[b.dataset.cell] = !data.cells[b.dataset.cell]; sauver(id, data, 300); })));
  conteneur.querySelectorAll("[data-tout]").forEach(b => b.addEventListener("click", () => garderPos(() => { const ri = +b.dataset.tout, l = itemsPiece(ri, jour), v = !l.every(x => x.fait); l.forEach(x => { data.cells[x.key] = v; }); sauver(id, data, 300); })));
  conteneur.querySelectorAll("[data-obs-btn]").forEach(b => b.addEventListener("click", () => { const z = conteneur.querySelector(`[data-obs-zone="${b.dataset.obsBtn}"]`); z?.classList.toggle("ouverte"); z?.querySelector("input")?.focus(); }));
  conteneur.querySelector("#gf-pas-moi")?.addEventListener("click", () => { if (confirm("Changer de personne sur ce téléphone ?")) { try { localStorage.removeItem(cleIdentite()); } catch { /* */ } identite = null; render(); } });
  conteneur.querySelector("#gf-site")?.addEventListener("change", (e) => { ui.siteId = e.target.value; render(); });
  conteneur.querySelector("#gf-week")?.addEventListener("change", (e) => { ui.weekStart = e.target.value; render(); });
  conteneur.querySelectorAll("[data-jour]").forEach(b => b.addEventListener("click", () => { ui.jour = b.dataset.jour; render(); }));
  conteneur.querySelectorAll("[data-obs]").forEach(inp => inp.addEventListener("input", () => { data.obs[inp.dataset.obs] = inp.value; conteneur.querySelector(`[data-obs-btn="${inp.dataset.obs}"]`)?.classList.toggle("a-obs", !!inp.value); sauver(id, data, 800); }));
  conteneur.querySelector("#gf-obs-generales")?.addEventListener("input", (e) => { data.observationsGenerales = e.target.value; sauver(id, data, 800); });
  conteneur.querySelector("#gf-submit")?.addEventListener("click", () => {
    data.submitted = !data.submitted;
    if (data.submitted) data.envoyeeLe = Date.now(); else { data.validee = false; }
    clearTimeout(saveTimer); saveFiche(id, data).then(render).catch(err => alert("Envoi impossible : " + (err?.message || err)));
  });
  void dateKey;
}

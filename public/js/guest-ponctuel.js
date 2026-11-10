// guest-ponctuel.js — Écran du prestataire pour un ménage ponctuel (gros ménage),
// ouvert par son lien (guest.html?invite=… avec une invitation de type "ponctuel").
// Pointage arrivée / départ, pièces cochées avec photos avant / après,
// observations, puis « Terminer et envoyer » au responsable.
import { esc } from "./astreinte-logic.js";
import { compresserImage, voirPhotos } from "./demandes-photos.js";
import {
  ecouterMission, ecouterPhotosMission, majMission, ajouterPhotoMission, supprimerPhotoMission,
  passageOuvert, minutesPassees, fmtMin, nbFaits, heureFr, jourFr, dateFr,
} from "./menage-ponctuel-data.js";

let m = null, photos = [], unsubs = [], cont = null, user = null, inv = null, identite = null, envoiEnCours = 0, saveTimer = null;
const cleId = () => `ponctuel-${inv.id}`;
const lireId = () => { try { return JSON.parse(localStorage.getItem(cleId()) || "null"); } catch { return null; } };
const ecrireId = (v) => { try { localStorage.setItem(cleId(), JSON.stringify(v)); } catch { /* */ } };
const nom = () => identite ? `${identite.prenom} ${identite.nom}`.trim() : (inv?.label || "Prestataire");

const STYLE = `<style>
.gp{max-width:720px;margin:0 auto;display:flex;flex-direction:column;gap:12px}
.gp-card{background:var(--panel);border:1px solid var(--border);border-radius:14px;padding:14px}
.gp-card h3{margin:0 0 8px;font-size:16px}
.gp-cons{white-space:pre-wrap;font-size:14px;background:var(--panel-alt);border-radius:10px;padding:10px}
.gp-big{width:100%;padding:16px;border:none;border-radius:14px;font:inherit;font-size:18px;font-weight:800;color:#fff;cursor:pointer}
.gp-go{background:#1baf7a}.gp-stop{background:#d9534f}.gp-send{background:#2f6fd6}
.gp-pass{font-size:13px;color:var(--text-dim);margin-top:8px}
.gp-piece{border-top:1px solid var(--border);padding:12px 0}.gp-piece:first-of-type{border-top:none}
.gp-ph{display:flex;align-items:center;gap:10px}
.gp-ph input[type=checkbox]{width:28px;height:28px;accent-color:#1baf7a;flex:none}
.gp-ph label{flex:1;font-size:15.5px;font-weight:700}.gp-piece.fait .gp-ph label{color:#11845b}
.gp-btns{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}
.gp-btns label{display:flex;flex-direction:column;align-items:center;gap:2px;padding:10px 6px;border:1px dashed var(--border);border-radius:10px;cursor:pointer;font-size:13.5px;font-weight:700;background:var(--panel-alt)}
.gp-btns label small{font-weight:500;color:var(--text-dim);font-size:11px}.gp-btns label.ok{border-style:solid;border-color:#1baf7a}
.gp-btns input{display:none}
.gp-mini{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
.gp-mini figure{margin:0;position:relative;width:76px}.gp-mini img{width:76px;height:76px;object-fit:cover;border-radius:8px;display:block;cursor:pointer}
.gp-mini figcaption{font-size:10px;text-align:center;color:var(--text-dim)}
.gp-mini button{position:absolute;top:-6px;right:-6px;width:22px;height:22px;border-radius:50%;border:none;background:#d9534f;color:#fff;font-size:12px;cursor:pointer}
.gp-note{width:100%;margin-top:8px;padding:8px;border-radius:8px;border:1px solid var(--border);background:var(--panel-alt);color:var(--text);font:inherit;font-size:13px;box-sizing:border-box}
.gp-id form{display:flex;flex-direction:column;gap:10px}.gp-id label{display:flex;flex-direction:column;gap:4px;font-size:13px;font-weight:600}
.gp-id input{padding:12px;border-radius:10px;border:1px solid var(--border);background:var(--panel-alt);color:var(--text);font:inherit;font-size:15px}
.gp-ok{background:#e9f8f0;color:#11845b;border:1px solid #bfe8d4;border-radius:12px;padding:12px;font-weight:600}
.gp-att{background:#fff4dc;color:#8a5a00;border:1px solid #f0c060;border-radius:12px;padding:12px;font-weight:600}
.gp-qui{display:flex;justify-content:space-between;font-size:13px;color:var(--text-dim)}.gp-qui button{background:none;border:none;color:var(--text-dim);text-decoration:underline;cursor:pointer;font:inherit}
</style>`;

export function mountGuestPonctuel(container, u, invitation) {
  unsubs.forEach(f => f()); unsubs = [];
  cont = container; user = u; inv = invitation; identite = lireId();
  cont.innerHTML = `<div class="hint">Chargement…</div>`;
  const id = inv.ponctuelId || inv.id;
  unsubs.push(ecouterMission(id, (x) => { m = x; render(); }));
  unsubs.push(ecouterPhotosMission(id, (p) => { photos = p; render(); }));
}

const phDe = (piece, moment) => photos.filter(p => p.piece === piece && (moment == null || p.moment === moment));
const vignettes = (liste, modifiable) => liste.length ? `<div class="gp-mini">${liste.map(p => `<figure><img src="${p.data}" data-voir="${p.id}" alt="">${modifiable && p.agentUid === user.uid ? `<button data-del-ph="${p.id}" title="Retirer">✕</button>` : ""}<figcaption>${p.moment === "avant" ? "Avant" : p.moment === "apres" ? "Après" : ""} ${heureFr(p.le)}</figcaption></figure>`).join("")}</div>` : "";

function render() {
  if (!cont) return;
  // Ne pas redessiner pendant la saisie d'un texte (le curseur sauterait).
  const actif = document.activeElement;
  if (actif && cont.contains(actif) && (actif.tagName === "TEXTAREA" || (actif.tagName === "INPUT" && actif.type === "text"))) return;
  if (!m) { cont.innerHTML = `${STYLE}<div class="gp"><div class="gp-att">Cette mission n'existe plus. Contacte le Groupe Établières.</div></div>`; return; }
  if (!identite) {
    cont.innerHTML = `${STYLE}<div class="gp"><div class="gp-card gp-id"><h3>👋 Bonjour</h3><p class="hint" style="margin:0 0 10px">Avant de commencer, indique qui intervient. Ton téléphone s'en souviendra.</p>
      <form id="gp-idf"><label>Prénom<input name="prenom" type="text" required autocomplete="given-name"></label><label>Nom<input name="nom" type="text" required autocomplete="family-name"></label>
      <label>Société<input name="societe" type="text" value="${esc(m.entreprise || "")}"></label><button class="gp-big gp-go" type="submit">Continuer</button></form></div></div>`;
    cont.querySelector("#gp-idf").onsubmit = (e) => {
      e.preventDefault(); const f = new FormData(e.target);
      identite = { prenom: String(f.get("prenom")).trim(), nom: String(f.get("nom")).trim(), societe: String(f.get("societe")).trim() };
      ecrireId(identite); render();
    };
    return;
  }
  const ouvert = passageOuvert(m), verrou = !!m.termine || !!m.validee, total = (m.pieces || []).length, faits = nbFaits(m);
  const autres = photos.filter(p => !(m.pieces || []).some(x => x.nom === p.piece));
  cont.innerHTML = `${STYLE}<div class="gp">
    <div class="gp-qui"><span>👤 ${esc(nom())}${identite.societe ? ` · ${esc(identite.societe)}` : ""}</span>${verrou ? "" : `<button data-chg-id>Ce n'est pas moi</button>`}</div>
    <div class="gp-card"><h3>🧽 Gros ménage — ${esc(m.siteName)}</h3>
      <div class="hint" style="margin:0 0 8px">Du ${dateFr(m.debut)} au ${dateFr(m.fin)}</div>
      ${m.consignes ? `<div class="gp-cons">${esc(m.consignes)}</div>` : ""}</div>
    ${m.validee ? `<div class="gp-ok">✅ Ménage vérifié et validé par le Groupe Établières. Merci !</div>`
      : m.termine ? `<div class="gp-ok">📨 Envoyé le ${jourFr(m.termine)} à ${heureFr(m.termine)}. Merci ! Le responsable va vérifier.<br><button class="nav-btn" data-rouvrir style="margin-top:8px">✏️ J'ai oublié quelque chose</button></div>` : `
    <div class="gp-card">${ouvert
      ? `<button class="gp-big gp-stop" data-depart>🔴 Je pars <small style="font-weight:600">(arrivé à ${heureFr(ouvert.a)})</small></button>`
      : `<button class="gp-big gp-go" data-arrivee>🟢 J'arrive sur place</button>`}
      ${(m.passages || []).length ? `<div class="gp-pass">${(m.passages || []).map(p => `${jourFr(p.a)} : ${heureFr(p.a)} → ${p.d ? heureFr(p.d) : "en cours"}`).join(" · ")} — total ${fmtMin(minutesPassees(m))}</div>` : `<div class="gp-pass">Appuie en arrivant, puis « Je pars » en partant : tes heures sont notées automatiquement.</div>`}
    </div>`}
    <div class="gp-card"><h3>Pièces à faire <small class="hint">${faits}/${total}</small></h3>
      <p class="hint" style="margin:0 0 6px">Pour chaque pièce : une photo <b>avant</b>, une photo <b>après</b>, puis coche quand c'est fait.</p>
      ${(m.pieces || []).map((p, i) => { const av = phDe(p.nom, "avant"), ap = phDe(p.nom, "apres"), fait = !!m.faits?.[i];
        return `<div class="gp-piece ${fait ? "fait" : ""}">
          <div class="gp-ph"><input type="checkbox" id="gp-c${i}" data-fait="${i}" ${fait ? "checked" : ""} ${verrou ? "disabled" : ""}><label for="gp-c${i}">${esc(p.nom)}</label></div>
          ${verrou ? "" : `<div class="gp-btns"><label class="${av.length ? "ok" : ""}">📷 Avant<small>${av.length ? `${av.length} photo${av.length > 1 ? "s" : ""}` : "à prendre"}</small><input type="file" accept="image/*" capture="environment" multiple data-ph="${i}" data-moment="avant"></label>
            <label class="${ap.length ? "ok" : ""}">📷 Après<small>${ap.length ? `${ap.length} photo${ap.length > 1 ? "s" : ""}` : "à prendre"}</small><input type="file" accept="image/*" capture="environment" multiple data-ph="${i}" data-moment="apres"></label></div>`}
          ${vignettes([...av, ...ap], !verrou)}
          ${verrou ? (m.obs?.[i] ? `<div class="hint" style="margin-top:6px">📝 ${esc(m.obs[i])}</div>` : "") : `<input class="gp-note" type="text" data-obs="${i}" placeholder="Remarque sur cette pièce (facultatif)" value="${esc(m.obs?.[i] || "")}">`}
        </div>`; }).join("") || `<div class="hint">Aucune pièce listée : utilise les photos ci-dessous.</div>`}
    </div>
    <div class="gp-card"><h3>📷 Autres photos</h3>
      ${verrou ? "" : `<div class="gp-btns"><label>📷 Ajouter des photos<small>dégâts, problème constaté…</small><input type="file" accept="image/*" capture="environment" multiple data-ph="-1" data-moment=""></label></div>`}
      ${vignettes(autres, !verrou)}</div>
    <div class="gp-card"><h3>📝 Observations</h3>
      ${verrou ? `<div class="gp-cons">${esc(m.observations || "—")}</div>` : `<textarea class="gp-note" rows="4" data-obs-gen placeholder="Ce qui a été fait, ce qui reste, problème constaté…">${esc(m.observations || "")}</textarea>`}</div>
    ${envoiEnCours ? `<div class="gp-att">⏳ Envoi de ${envoiEnCours} photo${envoiEnCours > 1 ? "s" : ""}… garde la page ouverte.</div>` : ""}
    ${verrou ? "" : `<button class="gp-big gp-send" data-terminer>✅ Terminer le ménage et envoyer</button>`}
  </div>`;
  brancher();
}

function enregistrer(champs) { majMission(m.id, { presta: { ...identite, uid: user.uid }, prestaUid: user.uid, ...champs }).catch(e => alert("Enregistrement impossible : " + (e?.message || e))); }
function enregistrerTextes() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const obs = { ...(m.obs || {}) }; cont.querySelectorAll("[data-obs]").forEach(el => { obs[el.dataset.obs] = el.value.trim(); });
    const g = cont.querySelector("[data-obs-gen]");
    enregistrer({ obs, observations: g ? g.value.trim() : (m.observations || "") });
  }, 700);
}

function brancher() {
  cont.querySelector("[data-chg-id]")?.addEventListener("click", () => { if (confirm("Changer de personne ?")) { identite = null; ecrireId(null); render(); } });
  cont.querySelector("[data-arrivee]")?.addEventListener("click", () => enregistrer({ passages: [...(m.passages || []), { a: Date.now(), d: null }] }));
  cont.querySelector("[data-depart]")?.addEventListener("click", () => enregistrer({ passages: (m.passages || []).map(p => p.a && !p.d ? { ...p, d: Date.now() } : p) }));
  cont.querySelectorAll("[data-fait]").forEach(cb => cb.addEventListener("change", () => enregistrer({ faits: { ...(m.faits || {}), [cb.dataset.fait]: cb.checked } })));
  cont.querySelectorAll("[data-obs],[data-obs-gen]").forEach(el => { el.addEventListener("input", enregistrerTextes); el.addEventListener("blur", () => setTimeout(render, 50)); });
  cont.querySelectorAll("[data-voir]").forEach(img => img.addEventListener("click", () => { const i = photos.findIndex(p => p.id === img.dataset.voir); voirPhotos(photos, Math.max(0, i)); }));
  cont.querySelectorAll("[data-del-ph]").forEach(b => b.addEventListener("click", () => { if (confirm("Retirer cette photo ?")) supprimerPhotoMission(b.dataset.delPh).catch(e => alert(e.message)); }));
  cont.querySelectorAll("input[type=file][data-ph]").forEach(inp => inp.addEventListener("change", async () => {
    const i = +inp.dataset.ph, piece = i >= 0 ? m.pieces[i].nom : "", fichiers = [...inp.files];
    envoiEnCours += fichiers.length; render();
    for (const f of fichiers) {
      try { await ajouterPhotoMission(m.id, { data: await compresserImage(f, 1100), piece, moment: inp.dataset.moment, par: nom() }); }
      catch (e) { alert("Photo non envoyée : " + (e?.message || e)); }
      envoiEnCours--; render();
    }
  }));
  cont.querySelector("[data-rouvrir]")?.addEventListener("click", () => enregistrer({ termine: null }));
  cont.querySelector("[data-terminer]")?.addEventListener("click", () => {
    if (envoiEnCours) { alert("Attends la fin de l'envoi des photos."); return; }
    const manquent = (m.pieces || []).filter((_, i) => !m.faits?.[i]).map(p => p.nom);
    const sansApres = (m.pieces || []).filter((p, i) => m.faits?.[i] && !phDe(p.nom, "apres").length).map(p => p.nom);
    let msg = "Envoyer le ménage au responsable ?";
    if (manquent.length) msg += `\n\nPièces non cochées : ${manquent.join(", ")}`;
    if (sansApres.length) msg += `\n\nSans photo « après » : ${sansApres.join(", ")}`;
    if (!confirm(msg)) return;
    const obs = { ...(m.obs || {}) }; cont.querySelectorAll("[data-obs]").forEach(el => { obs[el.dataset.obs] = el.value.trim(); });
    const g = cont.querySelector("[data-obs-gen]");
    clearTimeout(saveTimer);
    enregistrer({ obs, observations: g ? g.value.trim() : "", termine: Date.now(), passages: (m.passages || []).map(p => p.a && !p.d ? { ...p, d: Date.now() } : p) });
  });
}

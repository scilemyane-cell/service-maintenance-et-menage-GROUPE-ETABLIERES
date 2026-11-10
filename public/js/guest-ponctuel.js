// guest-ponctuel.js — Écran du prestataire pour un ménage ponctuel (gros ménage),
// ouvert par son lien (guest.html?invite=… avec une invitation de type "ponctuel").
// Pointage arrivée / départ, pièces cochées avec photos avant / après,
// observations, puis « Terminer et envoyer » au responsable.
import { esc } from "./astreinte-logic.js";
import { compresserImage, voirPhotos } from "./demandes-photos.js";
import {
  ecouterMission, ecouterPhotosMission, majMission, ajouterPhotoMission, supprimerPhotoMission,
  passageOuvert, minutesPassees, fmtMin, nbFaits, pieceFaite, tachesFaites, heureFr, jourFr, dateFr,
} from "./menage-ponctuel-data.js";

// Aperçu responsable (…&apercu=1) : la fiche telle que l'entreprise la voit, sans rien enregistrer.
const APERCU = new URLSearchParams(location.search).get("apercu") === "1";
let nivSel = null; // niveau affiché (onglets)
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
.gp .fj-piece{margin:0}.gp-infos .fj-piece-nom{font-size:15px}.gp-code{font-size:15px;margin-top:6px}.gp-code b{font-size:20px;letter-spacing:1.5px}
.gp-aa{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:10px 0 6px;border-top:1px solid var(--border);margin-top:4px}
.gp-aa-col{display:flex;flex-direction:column;gap:8px;min-width:0}
.gp-aa-col figure{margin:0;position:relative}.gp-aa-col img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:10px;display:block;cursor:pointer}
.gp-aa-col figcaption{font-size:11px;color:var(--text-dim);text-align:center}
.gp-aa-col figure button{position:absolute;top:6px;right:6px;width:26px;height:26px;border-radius:50%;border:none;background:#d9534f;color:#fff;cursor:pointer}
.gp-aa-add{display:flex;align-items:center;justify-content:center;text-align:center;min-height:70px;border:2px dashed;border-radius:10px;font-weight:700;font-size:13px;cursor:pointer;padding:8px}
.gp-aa-add.avant{border-color:#e07a1f;color:#b85f10;background:#fff4e8}.gp-aa-add.apres{border-color:#1baf7a;color:#128077;background:#eaf8f1}
.gp-aa-vide{color:var(--text-dim);text-align:center}
.gp-niv-tete{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:10px 14px;border-radius:12px;background:#128077;color:#fff;font-weight:800;font-size:16px;text-transform:uppercase;letter-spacing:.5px}
.gp-niv-tete span{font-size:12px;font-weight:600;text-transform:none;letter-spacing:0;opacity:.95}
.gp-niv{margin:14px 0 2px;font-size:12.5px;font-weight:800;text-transform:uppercase;letter-spacing:.6px;color:#2f6fd6}
.gp-piece{border-top:1px solid var(--border);padding:12px 0}.gp-piece:first-of-type{border-top:none}
.gp-ph{display:flex;align-items:center;gap:10px}
.gp-ph input[type=checkbox]{width:28px;height:28px;accent-color:#1baf7a;flex:none}
.gp-ph label{flex:1;font-size:15.5px;font-weight:700}.gp-piece.fait .gp-ph label{color:#11845b}
.gp-ph-t .nav-btn{padding:6px 10px;font-size:12.5px;flex:none}
.gp-taches{display:flex;flex-direction:column;margin-top:8px;border:1px solid var(--border);border-radius:10px;overflow:hidden}
.gp-tache{display:flex;align-items:center;gap:12px;padding:10px 10px;border-top:1px solid var(--border);font-size:14.5px;cursor:pointer}.gp-tache:first-child{border-top:none}
.gp-tache input{width:24px;height:24px;accent-color:#1baf7a;flex:none}.gp-tache.ok span{text-decoration:line-through;color:var(--text-dim)}
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
  document.documentElement.dataset.theme = "clair"; // même visuel que les fiches MNA
  cont.innerHTML = `<div class="hint">Chargement…</div>`;
  const id = inv.ponctuelId || inv.id;
  unsubs.push(ecouterMission(id, (x) => { m = x; render(); }));
  unsubs.push(ecouterPhotosMission(id, (p) => { photos = p; render(); }));
}

const phDe = (piece, moment) => photos.filter(p => p.piece === piece && (moment == null || p.moment === moment));
// Photos d'une pièce en deux colonnes Avant | Après (comme les fiches MNA).
function colonnesAA(i, av, ap, verrou) {
  const col = (moment, liste) => `<div class="gp-aa-col ${moment}">
    <b class="fc-ph-moment ${moment}">${moment === "avant" ? "📷 Avant" : "📷 Après"}</b>
    ${liste.map(p => `<figure><img src="${p.data}" data-voir="${p.id}" alt="">${!verrou && p.agentUid === user.uid ? `<button data-del-ph="${p.id}" title="Retirer">✕</button>` : ""}<figcaption>${heureFr(p.le)}</figcaption></figure>`).join("")}
    ${verrou ? (liste.length ? "" : `<span class="gp-aa-vide">—</span>`) : `<label class="gp-aa-add ${moment}">${liste.length ? "＋ Ajouter" : `Prendre la photo ${moment === "avant" ? "avant" : "après"}`}<input type="file" accept="image/*" capture="environment" multiple data-ph="${i}" data-moment="${moment}" hidden></label>`}
  </div>`;
  return `<div class="gp-aa">${col("avant", av)}${col("apres", ap)}</div>`;
}
const vignettes = (liste, modifiable) => liste.length ? `<div class="gp-mini">${liste.map(p => `<figure><img src="${p.data}" data-voir="${p.id}" alt="">${modifiable && p.agentUid === user.uid ? `<button data-del-ph="${p.id}" title="Retirer">✕</button>` : ""}<figcaption>${p.moment === "avant" ? "Avant" : p.moment === "apres" ? "Après" : ""} ${heureFr(p.le)}</figcaption></figure>`).join("")}</div>` : "";

function render() {
  if (!cont) return;
  // Ne pas redessiner pendant la saisie d'un texte (le curseur sauterait).
  const actif = document.activeElement;
  if (actif && cont.contains(actif) && (actif.tagName === "TEXTAREA" || (actif.tagName === "INPUT" && actif.type === "text"))) return;
  if (!m) { cont.innerHTML = `${STYLE}<div class="gp"><div class="gp-att">Cette mission n'existe plus. Contacte le Groupe Établières.</div></div>`; return; }
  if (!identite && !APERCU) {
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
  const ouvert = passageOuvert(m), verrou = APERCU || !!m.termine || !!m.validee, total = (m.pieces || []).length, faits = nbFaits(m);
  const autres = photos.filter(p => !(m.pieces || []).some(x => x.nom === p.piece));
  cont.innerHTML = `${STYLE}<div class="gp">
    ${APERCU ? `<div class="gp-att">👁️ Aperçu — c'est la fiche que l'entreprise remplira sur son téléphone. Rien n'est modifiable ici.</div>` : ""}
    <div class="gp-qui" ${APERCU ? 'style="display:none"' : ""}><span>👤 ${esc(nom())}${identite.societe ? ` · ${esc(identite.societe)}` : ""}</span>${verrou ? "" : `<button data-chg-id>Ce n'est pas moi</button>`}</div>
    ${(() => { // Bandeau vert + anneau, comme les fiches MNA.
      const tot = (m.pieces || []).reduce((a, p, i) => a + ((p.taches || []).length || 1), 0);
      const fa = (m.pieces || []).reduce((a, p, i) => a + ((p.taches || []).length ? tachesFaites(m, i) : (m.faits?.[i] ? 1 : 0)), 0);
      const pct = tot ? Math.round(fa / tot * 100) : 0, r = 40, c = 2 * Math.PI * r;
      const msg = !fa ? "C'est parti ! Touche une tâche quand elle est faite." : fa === tot ? "Tout est fait, bravo ! Pense aux photos « après » puis envoie." : pct >= 50 ? "Plus de la moitié, continue comme ça 💪" : "Bien lancé, continue !";
      return `<div class="fj-hero"><div class="fj-hero-txt"><div class="fj-bonjour">Bonjour ${esc(identite?.prenom || "")} 👋</div>
        <div class="fj-date">Gros ménage · ${esc(m.siteName)} · du ${dateFr(m.debut)} au ${dateFr(m.fin)}</div>
        <div class="fj-msg">${msg}</div>
        <div class="fj-sem">Pièces : <b>${faits}/${total}</b><span class="fj-sem-barre"><span style="width:${total ? faits / total * 100 : 0}%"></span></span></div></div>
        <div class="fj-hero-anneau"><svg class="fj-anneau" viewBox="0 0 100 100" width="92" height="92"><circle cx="50" cy="50" r="${r}" class="fj-anneau-fond"/><circle cx="50" cy="50" r="${r}" class="fj-anneau-val" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct / 100)}"/></svg>
          <div class="fj-anneau-txt"><b>${pct}%</b><span>${fa}/${tot}</span></div></div></div>`; })()}
    ${(m.codes || []).length && !m.validee ? `<div class="fj-piece gp-infos"><div class="fj-piece-nom">🔐 Boîte à clés</div>${m.codes.map(c => `<div class="gp-code">${esc(c.nom)} : <b>${esc(c.code)}</b>${c.notes ? ` <small>(${esc(c.notes)})</small>` : ""}</div>`).join("")}</div>` : ""}
    ${m.consignes ? `<div class="fj-piece gp-infos"><div class="fj-piece-nom">📋 Consignes</div><div style="white-space:pre-wrap;font-size:14.5px;margin-top:6px">${esc(m.consignes)}</div></div>` : ""}
    ${m.validee ? `<div class="gp-ok">✅ Ménage vérifié et validé par le Groupe Établières. Merci !</div>`
      : m.termine ? `<div class="gp-ok">📨 Envoyé le ${jourFr(m.termine)} à ${heureFr(m.termine)}. Merci ! Le responsable va vérifier.<br><button class="nav-btn" data-rouvrir style="margin-top:8px">✏️ J'ai oublié quelque chose</button></div>` : `
    <div>${ouvert
      ? `<button class="gp-big gp-stop" data-depart>🔴 Je pars <small style="font-weight:600">(arrivé à ${heureFr(ouvert.a)})</small></button>`
      : `<button class="gp-big gp-go" data-arrivee>🟢 J'arrive sur place</button>`}
      ${(m.passages || []).length ? `<div class="gp-pass">${(m.passages || []).map(p => `${jourFr(p.a)} : ${heureFr(p.a)} → ${p.d ? heureFr(p.d) : "en cours"}`).join(" · ")} — total ${fmtMin(minutesPassees(m))}</div>` : `<div class="gp-pass">Appuie en arrivant, puis « Je pars » en partant : tes heures sont notées automatiquement.</div>`}
    </div>`}
    <div class="fj-bravo ${total && faits === total ? "visible" : ""}"><span class="fj-bravo-emo">🎉</span><div><b>Bravo ! Toutes les pièces sont faites</b><br><small>Vérifie les photos « après », puis « Terminer le ménage et envoyer ».</small></div></div>
    ${(() => { // Onglets par niveau (comme les jours des fiches MNA) : un seul niveau affiché à la fois.
      const nivs = [...new Set((m.pieces || []).map(p => p.niveau || ""))];
      if (nivs.length < 2) return "";
      const st = (n) => { const idx = (m.pieces || []).map((p, i) => i).filter(i => (m.pieces[i].niveau || "") === n); return { t: idx.length, f: idx.filter(i => pieceFaite(m, i)).length }; };
      if (!nivs.includes(nivSel)) nivSel = nivs.find(n => { const x = st(n); return x.f < x.t; }) ?? nivs[0];
      return `<div class="fj-jours" style="grid-template-columns:repeat(${Math.min(nivs.length, 4)},1fr)">${nivs.map(n => { const x = st(n), fini = x.t && x.f === x.t;
        return `<button class="fj-jour ${n === nivSel ? "actif" : ""} ${fini ? "fini" : ""}" data-niv="${esc(n)}"><span>${esc(n || "Autres")}</span><small>${fini ? "✓" : `${x.f}/${x.t}`}</small></button>`; }).join("")}</div>`; })()}
    ${(() => { const nivs = [...new Set((m.pieces || []).map(p => p.niveau || ""))], tabs = nivs.length > 1;
      const ici = (m.pieces || []).map((p, i) => i).filter(i => !tabs || (m.pieces[i].niveau || "") === nivSel);
      if (!tabs || !ici.length) return "";
      const f = ici.filter(i => pieceFaite(m, i)).length;
      return `<div class="gp-niv-tete">🏠 ${esc(nivSel || "Autres")} <span>${f}/${ici.length} pièce${ici.length > 1 ? "s" : ""} faite${f > 1 ? "s" : ""}</span></div>`; })()}
    ${(() => { let niv = null; const tabs = new Set((m.pieces || []).map(p => p.niveau || "")).size > 1; return (m.pieces || []).map((p, i) => { if (tabs && (p.niveau || "") !== nivSel) return ""; const av = phDe(p.nom, "avant"), ap = phDe(p.nom, "apres"), fait = pieceFaite(m, i), tt = p.taches || [], nt = tachesFaites(m, i);
        const titre = !tabs && p.niveau && p.niveau !== niv ? `<div class="gp-niv">${esc(p.niveau)}</div>` : ""; niv = p.niveau || "";
        const n = tt.length || 1, f = tt.length ? nt : (fait ? 1 : 0);
        const ligne = (cle, lib, ok) => { const obs = m.obs?.[cle] || ""; return `<div class="fj-tache ${ok ? "faite" : ""}">
            <button class="fj-coche" data-coche="${cle}" aria-pressed="${ok}" ${verrou ? "disabled" : ""}><span class="fj-rond"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span><span class="fj-label">${esc(lib)}</span></button>
            ${verrou ? (obs ? `<div class="fj-obs ouverte"><small>💬 ${esc(obs)}</small></div>` : "") : `<button class="fj-obs-btn ${obs ? "a-obs" : ""}" data-obs-btn="${cle}" title="Ajouter une remarque">💬</button>
            <div class="fj-obs ${obs ? "ouverte" : ""}" data-obs-zone="${cle}"><input type="text" data-obs="${cle}" value="${esc(obs)}" placeholder="Une remarque ? (dégât, produit manquant…)"></div>`}</div>`; };
        return `${titre}<div class="fj-piece ${fait ? "finie" : ""}">
          <div class="fj-piece-tete"><div class="fj-piece-nom">${esc(p.libelle || p.nom)}</div><div class="fj-piece-compte">${f}/${n}</div>
            ${verrou || !tt.length ? "" : `<button class="fj-tout" data-toutfait="${i}">${fait ? "↺ Tout décocher" : "✓ Tout fait"}</button>`}</div>
          <div class="fj-piece-barre"><span style="width:${f / n * 100}%"></span></div>
          ${tt.length ? tt.map((t, k) => ligne(`${i}-${k}`, t, !!m.faits?.[`${i}-${k}`])).join("") : ligne(String(i), "Pièce faite", fait)}
          ${colonnesAA(i, av, ap, verrou)}
        </div>`; }).join("") + (() => { // Niveau terminé → passer au suivant.
          if (!tabs) return ""; const nivs = [...new Set(m.pieces.map(p => p.niveau || ""))], k = nivs.indexOf(nivSel), ici = m.pieces.map((p, i) => i).filter(i => (m.pieces[i].niveau || "") === nivSel);
          return ici.every(i => pieceFaite(m, i)) && k < nivs.length - 1 ? `<button class="gp-big gp-go" data-niv="${esc(nivs[k + 1])}">➡️ Passer au niveau « ${esc(nivs[k + 1] || "Autres")} »</button>` : ""; })(); })() || `<div class="fj-vide">Aucune pièce listée : utilise les photos ci-dessous.</div>`}
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

// Double validation « J'arrive » / « Je pars » (comme le pointage des agents) : évite les touches accidentelles.
function confirmerPointage(arrivee) {
  return new Promise((resolve) => {
    const ov = document.createElement("div"); ov.className = "pt-conf";
    ov.innerHTML = `<div class="pt-conf-box"><div class="pt-conf-ico">${arrivee ? "▶️" : "⏹️"}</div>
      <h3>${arrivee ? "Tu arrives ?" : "Tu pars ?"}</h3>
      <p>${esc(m.siteName)}<br>Heure notée : <b>${heureFr(Date.now())}</b></p>
      <div class="pt-conf-btns"><button class="non">Annuler</button><button class="oui ${arrivee ? "go" : "stop"}">${arrivee ? "Oui, j'arrive" : "Oui, je pars"}</button></div></div>`;
    const fin = (v) => { ov.remove(); resolve(v); };
    ov.querySelector(".non").onclick = () => fin(false);
    ov.querySelector(".oui").onclick = () => fin(true);
    ov.onclick = (e) => { if (e.target === ov) fin(false); };
    document.body.appendChild(ov);
  });
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
  if (APERCU) {
    cont.querySelectorAll("[data-voir]").forEach(img => img.addEventListener("click", () => { const i = photos.findIndex(p => p.id === img.dataset.voir); voirPhotos(photos, Math.max(0, i)); }));
    cont.querySelectorAll("button, input, textarea").forEach(x => { if (!x.dataset.niv) x.disabled = true; });
    cont.querySelectorAll("[data-niv]").forEach(b => b.addEventListener("click", () => { nivSel = b.dataset.niv; render(); }));
    return;
  }
  cont.querySelector("[data-chg-id]")?.addEventListener("click", () => { if (confirm("Changer de personne ?")) { identite = null; ecrireId(null); render(); } });
  cont.querySelector("[data-arrivee]")?.addEventListener("click", async () => { if (await confirmerPointage(true)) enregistrer({ passages: [...(m.passages || []), { a: Date.now(), d: null }] }); });
  cont.querySelector("[data-depart]")?.addEventListener("click", async () => { if (await confirmerPointage(false)) enregistrer({ passages: (m.passages || []).map(p => p.a && !p.d ? { ...p, d: Date.now() } : p) }); });
  cont.querySelectorAll("[data-niv]").forEach(b => b.addEventListener("click", () => { nivSel = b.dataset.niv; render(); window.scrollTo({ top: (cont.querySelector(".fj-jours")?.getBoundingClientRect().top || 0) + window.scrollY - 10, behavior: "smooth" }); }));
  cont.querySelectorAll("[data-coche]").forEach(b => b.addEventListener("click", () => { const k = b.dataset.coche; enregistrer({ faits: { ...(m.faits || {}), [k]: !m.faits?.[k] } }); }));
  cont.querySelectorAll("[data-obs-btn]").forEach(b => b.addEventListener("click", () => { const z = cont.querySelector(`[data-obs-zone="${b.dataset.obsBtn}"]`); z?.classList.toggle("ouverte"); z?.querySelector("input")?.focus(); }));
  cont.querySelectorAll("[data-toutfait]").forEach(b => b.addEventListener("click", () => { const i = +b.dataset.toutfait, f = { ...(m.faits || {}) }; const tous = pieceFaite(m, i); (m.pieces[i].taches || []).forEach((_, k) => { f[`${i}-${k}`] = !tous; }); enregistrer({ faits: f }); }));
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
    const manquent = (m.pieces || []).filter((_, i) => !pieceFaite(m, i)).map(p => p.libelle || p.nom);
    const sansApres = (m.pieces || []).filter((p, i) => pieceFaite(m, i) && !phDe(p.nom, "apres").length).map(p => p.libelle || p.nom);
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

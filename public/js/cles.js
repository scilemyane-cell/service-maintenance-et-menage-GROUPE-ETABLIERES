// cles.js — Onglet « 🔑 Clés & badges » (gestionnaires).
//  • En cours : toutes les clés sorties (QR temporaire ou remise longue durée),
//    retards en rouge, relance par mail, retour en un clic.
//  • Trousseau : les clés par site (exemplaires, disponibles), ajout/modif,
//    « Remise longue durée » → mail Outlook avec le lien de signature.
//  • Historique : les prêts rendus.
//  • QR codes : un QR par tableau à clés (site) à imprimer — la personne
//    scanne, s'identifie une fois, puis prend / rend ses clés.
import { esc } from "./astreinte-logic.js";
import { watchCles, watchPrets, creerCle, modifierCle, supprimerCle, creerRemiseLongue, enregistrerRetour, modifierPret, disponibles, enRetard, TYPES_CLE } from "./cles-data.js";
import { listerSitesPourMasterlock } from "./masterlock-data.js";
import { renderQrWithLogo, printQrCard } from "./qr-logo.js";

let state = { cles: null, prets: null, sites: [] };
let ui = { vue: "encours", recherche: "", edition: null, ajoutSite: "" };
let arrets = [];

const base = () => location.origin + (location.pathname.includes("/beta/") ? "/beta" : "");
const lienSignature = (t) => `${base()}/cle-signature.html?t=${t}`;
const lienQR = (siteId) => `${base()}/cles.html${siteId ? `?s=${encodeURIComponent(siteId)}` : ""}`;
const jour = (ms) => (ms ? new Date(ms).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—");
const jourH = (ms) => (ms ? new Date(ms).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");
const outlook = (to, subject, body) => `https://outlook.office.com/mail/deeplink/compose?${[["to", to], ["subject", subject], ["body", body]].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")}`;
const prenom = (n) => String(n || "").trim().split(/\s+/)[0] || "";

function mailSignature(p) {
  return outlook(p.personneEmail, `Remise de ${p.cleType === "Badge" ? "badge" : "clé"} — ${p.cleNom} — à signer`,
    `Bonjour ${prenom(p.personneNom)},\n\nLe service maintenance te remet : ${p.cleType || "Clé"} « ${p.cleNom} »${p.cleRepere ? ` (n° ${p.cleRepere})` : ""}${p.siteNom ? ` — ${p.siteNom}` : ""}${p.retourMax ? `, à restituer au plus tard le ${jour(p.retourMax)}` : ""}.\n\nMerci de confirmer la remise en signant ici (avec le doigt sur ton téléphone ou la souris) :\n${lienSignature(p.id)}\n\nCe lien t'est personnel.\n\nCordialement,\nService Maintenance`);
}
function mailRelance(p) {
  return outlook(p.personneEmail || "", `Rappel — retour de la clé « ${p.cleNom} »`,
    `Bonjour ${prenom(p.personneNom)},\n\nSauf erreur, la clé « ${p.cleNom} »${p.siteNom ? ` (${p.siteNom})` : ""} sortie le ${jour(p.sortieLe)}${p.pretePour ? ` et prêtée à ${p.pretePour}` : ""} devait être rendue${p.retourMax ? ` le ${jour(p.retourMax)}` : ""}.\n\nMerci de la rapporter dès que possible${p.type === "temporaire" ? " et de rescanner le QR code du tableau à clés pour enregistrer le retour" : ""}.\n\nCordialement,\nService Maintenance`);
}

export async function mountCles(container, user) {
  arrets.forEach(f => { try { f(); } catch (e) {} }); arrets = [];
  const par = user?.nom || user?.email || "";
  container.innerHTML = `<div class="hint">Chargement des clés…</div>`;
  try { state.sites = await listerSitesPourMasterlock(); } catch (e) { state.sites = []; }
  const garde = (f) => (...a) => { if (!document.contains(container)) { arrets.forEach(x => x()); return; } f(...a); };
  const err = (e) => { container.innerHTML = `<div class="placeholder-card"><b>Accès impossible aux clés</b><br>${esc(e?.message || e)}<br><small>Si c'est « Missing or insufficient permissions », les règles Firestore du module Clés ne sont pas encore publiées.</small></div>`; };
  arrets.push(watchCles(garde(l => { state.cles = l; rendu(container, par); }), err));
  arrets.push(watchPrets(garde(l => { state.prets = l; rendu(container, par); }), err));
}

function rendu(container, par) {
  if (!state.cles || !state.prets) return;
  const encours = state.prets.filter(p => p.statut !== "rendue").sort((a, b) => (enRetard(b) - enRetard(a)) || (a.retourMax || 9e15) - (b.retourMax || 9e15));
  const retards = encours.filter(enRetard), aSigner = encours.filter(p => p.statut === "a-signer");
  const r = ui.recherche.trim().toLowerCase();
  const filtre = (p) => !r || [p.cleNom, p.personneNom, p.pretePour, p.siteNom, p.cleRepere].some(x => String(x || "").toLowerCase().includes(r));
  const nomSite = (id) => state.sites.find(s => s.id === id)?.nom || "";
  const parSite = new Map(); state.cles.forEach(c => { const k = c.siteId || ""; parSite.set(k, [...(parSite.get(k) || []), c]); });
  const sitesTries = [...parSite.keys()].sort((a, b) => (nomSite(a) || "zzz").localeCompare(nomSite(b) || "zzz"));
  const optSites = (sel) => `<option value="">— Choisir le site —</option>${state.sites.map(s => `<option value="${esc(s.id)}" ${s.id === sel ? "selected" : ""}>${esc(s.nom)}</option>`).join("")}`;
  const badge = (p) => p.statut === "a-signer" ? `<em class="cl-b sig">✍️ à signer</em>` : enRetard(p) ? `<em class="cl-b ret">⏰ en retard</em>` : p.type === "longue" ? `<em class="cl-b lon">✅ signée</em>` : `<em class="cl-b tmp">en cours</em>`;

  const ligneEncours = (p) => `<tr class="${enRetard(p) ? "cl-retard" : ""}">
    <td><b>${esc(p.cleNom)}</b>${p.cleRepere ? `<small>n° ${esc(p.cleRepere)}</small>` : ""}<small>${esc(p.siteNom || "")}</small></td>
    <td><b>${esc(p.personneNom)}</b>${p.pretePour ? `<small>👤 prêtée à <b>${esc(p.pretePour)}</b></small>` : ""}${p.personneEmail ? `<small>${esc(p.personneEmail)}</small>` : ""}</td>
    <td>${p.type === "longue" ? "Longue durée" : "Temporaire (QR)"}</td>
    <td>${jourH(p.sortieLe)}</td><td>${p.retourMax ? jour(p.retourMax) : "—"}</td><td>${badge(p)}</td>
    <td class="cl-act">
      ${p.statut === "a-signer" ? `<a class="nav-btn" href="${esc(mailSignature(p))}" target="_blank" rel="noopener">📧 Renvoyer</a><button class="nav-btn" data-copier="${p.id}">🔗 Lien</button>` : ""}
      ${p.signature ? `<button class="nav-btn" data-signature="${p.id}">🖊 Signature</button>` : ""}
      ${enRetard(p) ? `<a class="nav-btn" href="${esc(mailRelance(p))}" target="_blank" rel="noopener">📧 Relancer</a>` : ""}
      <button class="nav-btn cl-ok" data-retour="${p.id}">✅ Rendue</button></td></tr>`;

  container.innerHTML = `<div class="stack cl">
    <div class="cl-kpis">
      <div><span>Clés et badges</span><b>${state.cles.reduce((t, c) => t + (Number(c.exemplaires) || 1), 0)}</b><small>${state.cles.length} référence${state.cles.length > 1 ? "s" : ""}</small></div>
      <div><span>Sorties en cours</span><b>${encours.length}</b><small>${encours.filter(p => p.type === "longue").length} longue durée · ${encours.filter(p => p.type === "temporaire").length} temporaire${encours.filter(p => p.type === "temporaire").length > 1 ? "s" : ""}</small></div>
      <div class="${retards.length ? "rouge" : ""}"><span>En retard</span><b>${retards.length}</b><small>date de retour dépassée</small></div>
      <div class="${aSigner.length ? "orange" : ""}"><span>À signer</span><b>${aSigner.length}</b><small>remises en attente de signature</small></div>
    </div>
    <div class="cl-onglets">${[["encours", `🔓 En cours (${encours.length})`], ["trousseau", "🗝️ Trousseau"], ["historique", "📜 Historique"], ["qr", "📱 QR codes"]].map(([k, l]) => `<button data-vue="${k}" class="${ui.vue === k ? "on" : ""}">${l}</button>`).join("")}
      <input class="cl-cherche" placeholder="🔎 Clé, personne, site…" value="${esc(ui.recherche)}"></div>

    ${ui.vue === "encours" ? `<div class="form-card">${encours.filter(filtre).length ? `<div class="cl-scroll"><table class="cl-tab"><thead><tr><th>Clé</th><th>Personne</th><th>Type</th><th>Sortie</th><th>Retour max</th><th>État</th><th></th></tr></thead><tbody>${encours.filter(filtre).map(ligneEncours).join("")}</tbody></table></div>` : `<p class="hint">Aucune clé sortie en ce moment.</p>`}</div>` : ""}

    ${ui.vue === "trousseau" ? `
      <div class="form-card"><h3>➕ Ajouter une clé ou un badge</h3>
        <div class="cl-form"><label>Nom<input id="cl-n-nom" placeholder="ex. Local chaufferie"></label>
          <label>Type<select id="cl-n-type">${TYPES_CLE.map(t => `<option>${t}</option>`).join("")}</select></label>
          <label>N° / repère<input id="cl-n-rep" placeholder="ex. C12"></label>
          <label>Site<select id="cl-n-site">${optSites(ui.ajoutSite)}</select></label>
          <label>Exemplaires<input id="cl-n-ex" type="number" min="1" value="1"></label>
          <label class="cl-cb"><input type="checkbox" id="cl-n-qr" checked> Empruntable par QR code</label>
          <button class="nav-btn cl-ok" id="cl-n-ok">Ajouter</button></div></div>
      ${sitesTries.map(sid => `<div class="form-card"><h3>🏢 ${esc(nomSite(sid) || "Sans site")}</h3>
        <div class="cl-scroll"><table class="cl-tab"><thead><tr><th>Clé / badge</th><th>Type</th><th>Exemplaires</th><th>Disponibles</th><th>Détenteurs</th><th></th></tr></thead><tbody>
        ${parSite.get(sid).filter(c => !r || [c.nom, c.repere].some(x => String(x || "").toLowerCase().includes(r))).sort((a, b) => (a.nom || "").localeCompare(b.nom || "")).map(c => {
          const sorties = encours.filter(p => p.cleId === c.id);
          if (ui.edition === c.id) return `<tr><td colspan="6"><div class="cl-form"><label>Nom<input id="cl-e-nom" value="${esc(c.nom)}"></label><label>Type<select id="cl-e-type">${TYPES_CLE.map(t => `<option ${t === c.type ? "selected" : ""}>${t}</option>`).join("")}</select></label><label>N° / repère<input id="cl-e-rep" value="${esc(c.repere || "")}"></label><label>Site<select id="cl-e-site">${optSites(c.siteId)}</select></label><label>Exemplaires<input id="cl-e-ex" type="number" min="1" value="${Number(c.exemplaires) || 1}"></label><label class="cl-cb"><input type="checkbox" id="cl-e-qr" ${c.pretable !== false ? "checked" : ""}> Empruntable par QR</label><button class="nav-btn cl-ok" data-enreg="${c.id}">Enregistrer</button><button class="nav-btn" data-annuler>Annuler</button><button class="nav-btn cl-sup" data-supprimer="${c.id}">🗑 Supprimer</button></div></td></tr>`;
          return `<tr><td><b>${esc(c.nom)}</b>${c.repere ? `<small>n° ${esc(c.repere)}</small>` : ""}${c.pretable === false ? `<small>remise longue durée uniquement</small>` : ""}</td><td>${esc(c.type || "Clé")}</td><td>${Number(c.exemplaires) || 1}</td>
            <td><b class="${disponibles(c) ? "" : "cl-zero"}">${disponibles(c)}</b></td>
            <td>${sorties.map(p => `<span class="cl-det ${enRetard(p) ? "ret" : ""}">${esc(p.personneNom)}${p.pretePour ? ` → ${esc(p.pretePour)}` : ""}${p.type === "longue" ? " 🖊" : ""}</span>`).join(" ") || "—"}</td>
            <td class="cl-act"><button class="nav-btn" data-remise="${c.id}" ${disponibles(c) ? "" : "disabled"}>✍️ Remise longue durée</button><button class="nav-btn" data-edit="${c.id}">✏️</button></td></tr>`;
        }).join("")}</tbody></table></div></div>`).join("") || `<p class="hint">Aucune clé enregistrée. Ajoute la première ci-dessus.</p>`}` : ""}

    ${ui.vue === "historique" ? (() => { const h = state.prets.filter(p => p.statut === "rendue").filter(filtre).sort((a, b) => (b.retourLe || 0) - (a.retourLe || 0)).slice(0, 300);
      return `<div class="form-card">${h.length ? `<div class="cl-scroll"><table class="cl-tab"><thead><tr><th>Clé</th><th>Personne</th><th>Type</th><th>Sortie</th><th>Rendue</th><th>Durée</th></tr></thead><tbody>${h.map(p => `<tr class="${p.retourMax && p.retourLe > p.retourMax ? "cl-retard" : ""}"><td><b>${esc(p.cleNom)}</b><small>${esc(p.siteNom || "")}</small></td><td>${esc(p.personneNom)}${p.pretePour ? `<small>👤 prêtée à ${esc(p.pretePour)}</small>` : ""}</td><td>${p.type === "longue" ? "Longue durée" : "Temporaire"}</td><td>${jourH(p.sortieLe)}</td><td>${jourH(p.retourLe)}${p.retourMax && p.retourLe > p.retourMax ? `<small>rendue en retard</small>` : ""}</td><td>${Math.max(0, Math.round((p.retourLe - p.sortieLe) / 86400000))} j</td></tr>`).join("")}</tbody></table></div>` : `<p class="hint">Aucun retour enregistré pour l'instant.</p>`}</div>`; })() : ""}

    ${ui.vue === "qr" ? `<div class="form-card"><h3>📱 QR codes des tableaux à clés</h3><p class="hint">Imprime le QR du site et colle-le sur le tableau ou la boîte à clés. La personne le scanne avec son téléphone : la 1ʳᵉ fois elle donne son nom, ensuite le téléphone est reconnu (« Bonjour Fabrice, tu prends ou tu rends une clé ? »), avec une date de retour et un rappel au scan suivant si elle est dépassée.</p>
      <div class="cl-qrs">${[["", "Tous les sites"], ...sitesTries.filter(Boolean).map(s => [s, nomSite(s)])].map(([sid, nom]) => `
        <div class="cl-qr qr-print-card" id="cl-qr-${esc(sid || "tous")}"><div class="cl-qr-img" data-qr="${esc(sid)}"></div><b>🔑 Prêt de clés</b><small>${esc(nom)}</small><small class="cl-qr-txt">Scanne pour prendre ou rendre une clé</small><button class="nav-btn" data-imprimer="${esc(sid || "tous")}">🖨️ Imprimer</button></div>`).join("")}</div></div>` : ""}
  </div>`;

  const re = () => rendu(container, par);
  container.querySelectorAll("[data-vue]").forEach(b => b.onclick = () => { ui.vue = b.dataset.vue; re(); });
  const ch = container.querySelector(".cl-cherche");
  ch.oninput = () => { ui.recherche = ch.value; clearTimeout(ch._t); ch._t = setTimeout(() => { re(); const n = container.querySelector(".cl-cherche"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250); };
  container.querySelectorAll("[data-retour]").forEach(b => b.onclick = async () => { const p = state.prets.find(x => x.id === b.dataset.retour); if (!confirm(`Confirmer le retour de « ${p.cleNom} » par ${p.personneNom} ?`)) return; try { await enregistrerRetour(p, par); window.toast?.("✓ Retour enregistré"); } catch (e) { alert("Impossible : " + e.message); } });
  container.querySelectorAll("[data-copier]").forEach(b => b.onclick = async () => { try { await navigator.clipboard.writeText(lienSignature(b.dataset.copier)); window.toast?.("✓ Lien de signature copié"); } catch (e) { prompt("Lien de signature :", lienSignature(b.dataset.copier)); } });
  container.querySelectorAll("[data-signature]").forEach(b => b.onclick = () => { const p = state.prets.find(x => x.id === b.dataset.signature); const m = document.createElement("div"); m.className = "ndm-fond";
    m.innerHTML = `<div class="ndm"><h3>🖊 Remise signée — ${esc(p.cleNom)}</h3><p>${esc(p.signeNom || p.personneNom)}${p.personneEmail ? ` · ${esc(p.personneEmail)}` : ""}<br>Signée le ${jourH(p.signeLe)} · remise le ${jour(p.sortieLe)}${p.retourMax ? ` · retour au plus tard le ${jour(p.retourMax)}` : ""}</p><img src="${p.signature}" alt="signature" style="max-width:100%;border:1px solid var(--border);border-radius:10px;background:#fff"><button class="nav-btn" data-x>Fermer</button></div>`;
    document.body.append(m); m.onclick = (e) => { if (e.target === m || e.target.dataset.x !== undefined) m.remove(); }; });
  container.querySelector("#cl-n-ok")?.addEventListener("click", async () => {
    const nom = container.querySelector("#cl-n-nom").value.trim(), siteId = container.querySelector("#cl-n-site").value;
    if (!nom || !siteId) return alert("Indique le nom de la clé et le site.");
    ui.ajoutSite = siteId;
    try { await creerCle({ nom, type: container.querySelector("#cl-n-type").value, repere: container.querySelector("#cl-n-rep").value.trim(), siteId, siteNom: nomSite(siteId), exemplaires: Math.max(1, Number(container.querySelector("#cl-n-ex").value) || 1), pretable: container.querySelector("#cl-n-qr").checked, creePar: par }); window.toast?.("✓ Clé ajoutée"); }
    catch (e) { alert("Impossible : " + e.message); }
  });
  container.querySelectorAll("[data-edit]").forEach(b => b.onclick = () => { ui.edition = b.dataset.edit; re(); });
  container.querySelector("[data-annuler]")?.addEventListener("click", () => { ui.edition = null; re(); });
  container.querySelector("[data-enreg]")?.addEventListener("click", async (e) => { const id = e.target.dataset.enreg, siteId = container.querySelector("#cl-e-site").value;
    try { await modifierCle(id, { nom: container.querySelector("#cl-e-nom").value.trim(), type: container.querySelector("#cl-e-type").value, repere: container.querySelector("#cl-e-rep").value.trim(), siteId, siteNom: nomSite(siteId), exemplaires: Math.max(1, Number(container.querySelector("#cl-e-ex").value) || 1), pretable: container.querySelector("#cl-e-qr").checked }); ui.edition = null; window.toast?.("✓ Enregistré"); }
    catch (err) { alert("Impossible : " + err.message); } });
  container.querySelector("[data-supprimer]")?.addEventListener("click", async (e) => { const c = state.cles.find(x => x.id === e.target.dataset.supprimer);
    if (encours.some(p => p.cleId === c.id)) return alert("Cette clé est encore sortie : enregistre d'abord son retour.");
    if (!confirm(`Supprimer « ${c.nom} » du trousseau ? (l'historique de ses prêts est conservé)`)) return; try { await supprimerCle(c.id, par); ui.edition = null; } catch (err) { alert("Impossible : " + err.message); } });
  container.querySelectorAll("[data-remise]").forEach(b => b.onclick = () => ouvrirRemise(state.cles.find(c => c.id === b.dataset.remise), par));
  container.querySelectorAll("[data-qr]").forEach(el => renderQrWithLogo(el, lienQR(el.dataset.qr), 170));
  container.querySelectorAll("[data-imprimer]").forEach(b => b.onclick = () => printQrCard(document.getElementById(`cl-qr-${b.dataset.imprimer}`)));
}

function ouvrirRemise(cle, par) {
  const m = document.createElement("div"); m.className = "ndm-fond";
  m.innerHTML = `<div class="ndm"><div class="ndm-tete"><h3>✍️ Remise longue durée</h3><button type="button" class="ndm-x" data-x>✕</button></div>
    <p><b>${esc(cle.type || "Clé")} — ${esc(cle.nom)}</b>${cle.repere ? ` · n° ${esc(cle.repere)}` : ""}<br><small>${esc(cle.siteNom || "")}</small></p>
    <label class="cl-l">Nom et prénom de la personne<input id="rm-nom" placeholder="ex. Fabrice Noirault"></label>
    <label class="cl-l">Adresse mail pro<input id="rm-mail" type="email" placeholder="prenom.nom@etablieres.fr"></label>
    <label class="cl-l">À restituer au plus tard <small>(facultatif)</small><input id="rm-date" type="date"></label>
    <label class="cl-l">Note <small>(facultatif, visible sur la signature)</small><input id="rm-note" placeholder="ex. remise pour la durée du contrat"></label>
    <p class="hint">Un mail s'ouvre dans Outlook avec le lien de signature : la personne signe depuis sa boîte mail pro. La remise passe à « ✅ signée » dès qu'elle a signé.</p>
    <div class="ndm-btns"><button class="nav-btn" data-x>Annuler</button><button class="nav-btn cl-ok" id="rm-ok">📧 Créer et envoyer le mail</button></div></div>`;
  document.body.append(m);
  m.querySelectorAll("[data-x]").forEach(b => b.onclick = () => m.remove());
  m.querySelector("#rm-ok").onclick = async () => {
    const nom = m.querySelector("#rm-nom").value.trim(), email = m.querySelector("#rm-mail").value.trim(), d = m.querySelector("#rm-date").value;
    if (!nom) return alert("Indique le nom de la personne.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return alert("Indique une adresse mail valide.");
    const fenetre = window.open("about:blank", "_blank");
    try {
      const retourMax = d ? (() => { const [y, mo, j] = d.split("-").map(Number); return new Date(y, mo - 1, j, 18).getTime(); })() : null;
      const t = await creerRemiseLongue({ cle, nom, email, retourMax, par, note: m.querySelector("#rm-note").value.trim() });
      const url = mailSignature({ id: t, personneNom: nom, personneEmail: email, cleNom: cle.nom, cleType: cle.type, cleRepere: cle.repere, siteNom: cle.siteNom, retourMax });
      if (fenetre) fenetre.location.href = url; else window.open(url, "_blank");
      m.remove(); window.toast?.("✓ Remise créée — envoie le mail ouvert dans Outlook");
    } catch (e) { fenetre?.close(); alert("Impossible : " + e.message); }
  };
}

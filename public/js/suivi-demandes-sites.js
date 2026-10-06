// suivi-demandes-sites.js — Vue « Par site » du Suivi des demandes, pensée
// pour les techniciens sur le terrain (téléphone) : on choisit un site, on
// voit ses demandes en cartes, et on les traite en un geste (statut, date
// d'intervention, intervenant, commentaire, « ✓ Réalisé aujourd'hui »).
import { esc } from "./astreinte-logic.js";
import { ouvrirImpressionSite } from "./demandes-impression.js";
import { preparerFenetre, ouvrirTicketMail, prechargerCaptureTicket } from "./demandes-ticket.js";
import { capturerSaisies, restaurerSaisies } from "./saisies-preservees.js";
import { watchFavoris, saveFavorisDemandes } from "./favoris-data.js";
import { watchSitesDossiers } from "./site-dossier-data.js";
import { watchAffectationsSites, saveAffectationSite, saveAffectationsSites } from "./affectations-sites-data.js";
import { abonnerEntreprises, saveEntreprises, entreprises, ficheEntreprise, cleEntreprise } from "./entreprises-data.js";
import { watchPhrasesDemandes, savePhrasesDemandes, PHRASES_DEFAUT } from "./phrases-demandes-data.js";

// ---------- Phrases types (commentaires / actions) ----------
const phr = { data: PHRASES_DEFAUT, abonne: false, rerender: null };
function suivrePhrases() {
  if (phr.abonne) return; phr.abonne = true;
  watchPhrasesDemandes((d) => { phr.data = d; phr.rerender?.(); });
}
// Puces cliquables ; l'éditeur peut enregistrer le texte courant (💾) ou retirer une phrase (✕).
function phrasesHTML(type, editeur) {
  const liste = phr.data[type] || [];
  return `<details class="dps-phrases-wrap"><summary>💬 Phrases types</summary><div class="dps-phrases" data-phr-type="${type}">${liste.map((t, i) => `<span class="dps-phrase"><button type="button" data-phr-i="${i}" title="Insérer">${esc(t)}</button>${editeur ? `<button type="button" class="x" data-phr-suppr="${i}" title="Retirer cette phrase type">✕</button>` : ""}</span>`).join("")}${editeur ? `<button type="button" class="dps-phrase-plus" data-phr-ajout title="Enregistrer le texte saisi comme phrase type">💾 Enregistrer comme phrase type</button>` : ""}</div></details>`;
}
// cible() renvoie le champ texte ; mode "ajout" (commentaire) ou "remplace" (action).
function brancherPhrases(racine, cible, mode, apresSaisie) {
  racine.querySelectorAll(".dps-phrases").forEach(z => {
    const type = z.dataset.phrType;
    z.querySelectorAll("[data-phr-i]").forEach(b => b.addEventListener("click", (e) => {
      e.preventDefault();
      const t = (phr.data[type] || [])[+b.dataset.phrI] || "", c = cible(z); if (!c) return;
      c.value = mode === "ajout" && c.value.trim() ? c.value.replace(/\s+$/, "") + " " + t : t;
      apresSaisie?.(c); c.focus();
    }));
    z.querySelectorAll("[data-phr-suppr]").forEach(b => b.addEventListener("click", async (e) => {
      e.preventDefault();
      const liste = [...(phr.data[type] || [])], t = liste[+b.dataset.phrSuppr];
      if (!confirm(`Retirer la phrase type « ${t} » ?`)) return;
      liste.splice(+b.dataset.phrSuppr, 1);
      try { await savePhrasesDemandes(type, liste); } catch (err) { alert("Échec : " + (err?.message || err)); }
    }));
    z.querySelector("[data-phr-ajout]")?.addEventListener("click", async (e) => {
      e.preventDefault();
      const c = cible(z), t = (c?.value || "").trim();
      if (!t) { alert("Écris d'abord la phrase dans le champ, puis clique sur 💾."); c?.focus(); return; }
      const liste = phr.data[type] || [];
      if (liste.includes(t)) { window.toast?.("Cette phrase existe déjà."); return; }
      try { await savePhrasesDemandes(type, [...liste, t]); window.toast?.("Phrase type enregistrée ✓"); } catch (err) { alert("Échec : " + (err?.message || err)); }
    });
  });
}

// ---------- Sites attribués aux techniciens (par le superviseur) ----------
const aff = { data: {}, abonne: false, rerender: null };
function suivreAffectations() {
  if (aff.abonne) return; aff.abonne = true;
  watchAffectationsSites((d) => { aff.data = d || {}; aff.rerender?.(); });
}
// Attributions retrouvées même si le site est écrit autrement (« RS- Le Mail » / « RS - Le Mail »).
const cleSiteAff = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const techsDuSite = (nom) => { const k = cleSiteAff(nom); return [...new Set(Object.entries(aff.data || {}).filter(([n]) => n === nom || cleSiteAff(n) === k).flatMap(([, l]) => l || []))]; };

// ---------- Entreprises extérieures (prestataires) ----------
const ent = { get liste() { return entreprises(); }, abonne: false, rerender: null };
function suivreEntreprises() {
  if (ent.abonne) return; ent.abonne = true;
  abonnerEntreprises(() => ent.rerender?.());
}
const cleEnt = cleEntreprise;

// Fiche d'une entreprise (création rapide depuis une demande). Résout l'entreprise ou null.
function ouvrirNouvelleEntreprise() {
  return new Promise((resolve) => {
    const fond = document.createElement("div"); fond.className = "ndm-fond";
    fond.innerHTML = `<div class="ndm ent-fiche">
      <div class="ndm-tete"><h3>🏢 Nouvelle entreprise extérieure</h3><button type="button" class="ndm-x" data-fermer>✕</button></div>
      <label>Nom de la société *<input id="ent-nom" placeholder="ex. SARL Plomberie Martin"></label>
      <label>Contact (personne)<input id="ent-contact" placeholder="ex. M. Martin"></label>
      <label>Descriptif / métier<input id="ent-metier" placeholder="ex. Plomberie, chauffage — dépannage sous 48 h"></label>
      <div class="ent-2"><label>Téléphone<input id="ent-tel" type="tel" placeholder="06…"></label><label>Mail<input id="ent-email" type="email" placeholder="contact@…"></label></div>
      <div class="ndm-etat"></div>
      <div class="ndm-btns"><button type="button" class="dps-annuler" data-fermer>Annuler</button><button type="button" class="dps-enregistrer" id="ent-ok">✓ Ajouter et attribuer</button></div>
    </div>`;
    const fermer = (v) => { fond.remove(); resolve(v); };
    fond.querySelectorAll("[data-fermer]").forEach(b => b.addEventListener("click", () => fermer(null)));
    fond.addEventListener("click", (e) => { if (e.target === fond) fermer(null); });
    fond.querySelector("#ent-ok").addEventListener("click", async (e) => {
      const v = (id) => fond.querySelector(id).value.trim();
      const e1 = { notes: "", nom: v("#ent-nom"), contact: v("#ent-contact"), metier: v("#ent-metier"), tel: v("#ent-tel"), email: v("#ent-email") };
      if (!e1.nom) { fond.querySelector(".ndm-etat").textContent = "Indique le nom de la société."; return; }
      if (ficheEntreprise(e1.nom)) return fermer(ficheEntreprise(e1.nom));
      e.target.disabled = true; fond.querySelector(".ndm-etat").textContent = "⏳ Enregistrement…";
      try { await saveEntreprises([...ent.liste, e1]); fermer(e1); }
      catch (err) { console.error(err); fond.querySelector(".ndm-etat").textContent = "❌ " + (err?.message || err); e.target.disabled = false; }
    });
    document.body.appendChild(fond);
    fond.querySelector("#ent-nom").focus();
  });
}

// ---------- Sites favoris ----------
// Mêmes favoris que l'accueil / les compteurs (fiches sites), rapprochés
// des noms de sites du fichier des demandes par mots significatifs
// (ex. « Résidence Le Mail » ↔ « RS - Le Mail »).
const MOTS_VIDES = new Set(["rs", "lot", "mna", "maison", "site", "residence", "de", "du", "des", "la", "le", "les", "l", "d", "et", "a", "au", "sur", "1", "2", "3", "4"]);
const motsSite = (nom) => String(nom || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  .replace(/\bst\b/g, "saint").replace(/[^a-z0-9]+/g, " ").split(" ").filter(m => m && !MOTS_VIDES.has(m));
export function memeSite(nomDemande, nomFiche) {
  const a = motsSite(nomDemande), b = motsSite(nomFiche);
  if (!a.length || !b.length) return false;
  const [petit, grand] = a.length <= b.length ? [a, b] : [b, a];
  return petit.join(" ").length >= 3 && petit.every(m => grand.includes(m));
}
const fav = { uid: null, unsubs: [], ficheIds: [], fiches: [], ajout: [], retrait: [], pret: false, rerender: null };
function suivreFavoris(uid) {
  if (fav.uid === uid) return;
  fav.unsubs.forEach(u => u && u()); fav.unsubs = [];
  Object.assign(fav, { uid, ficheIds: [], fiches: [], ajout: [], retrait: [], pret: false });
  if (!uid) return;
  const maj = () => { fav.pret = true; fav.rerender?.(); };
  fav.unsubs.push(watchFavoris(uid, (ids, data = {}) => { fav.ficheIds = ids || []; fav.ajout = data.demandesAjout || []; fav.retrait = data.demandesRetrait || []; maj(); }));
  fav.unsubs.push(watchSitesDossiers((l) => { fav.fiches = l; maj(); }));
}
function estFavori(nomSite) {
  if (fav.retrait.includes(nomSite)) return false;
  if (fav.ajout.includes(nomSite)) return true;
  const noms = fav.ficheIds.map(id => fav.fiches.find(f => f.id === id)?.nom).filter(Boolean);
  return noms.some(n => memeSite(nomSite, n));
}
async function basculerFavori(nomSite) {
  if (!fav.uid) return;
  const etait = estFavori(nomSite);
  const ajout = fav.ajout.filter(n => n !== nomSite), retrait = fav.retrait.filter(n => n !== nomSite);
  if (etait) retrait.push(nomSite); else ajout.push(nomSite);
  fav.ajout = ajout; fav.retrait = retrait;
  fav.rerender?.();
  try { await saveFavorisDemandes(fav.uid, ajout, retrait); }
  catch (e) { console.error("saveFavorisDemandes:", e); window.toast?.("Favori non enregistré."); }
}

const STATUTS_RAPIDES = ["Pris en compte", "Intervenant sollicité", "Demande de devis", "Planifié", "Commande en cours", "Réalisé", "Annulé"];
const ORDRE_URG = { "Critique": 0, "Urgent": 1, "À planifier": 2, "Normal": 3, "Non renseignée": 4 };
const TRAITE = (s) => s === "Réalisé" || s === "Annulé";
// Circuit de validation : le technicien déclare « Réalisé », la demande passe
// « Réalisé – à valider » ; un superviseur (N1/Admin) la valide ou la refuse.
export const A_VALIDER = "Réalisé – à valider";
const EN_ATTENTE_VALID = (s) => s === A_VALIDER;
const A_TRAITER = (s) => !TRAITE(s) && !EN_ATTENTE_VALID(s);
// Les demandes arrivées à partir de cette date passent par « À attribuer » (superviseurs).
const DEBUT_ATTRIBUTION = new Date("2026-10-01T00:00:00").getTime();
const aujourdhui = () => new Date().toISOString().slice(0, 10);
// Jours calendaires écoulés (aujourd'hui = 0, hier = 1), quelle que soit l'heure.
const joursDepuis = (iso) => { if (!iso) return null; const d = new Date(String(iso).slice(0, 10) + "T12:00:00"); if (isNaN(d)) return null; const auj = new Date(); auj.setHours(12, 0, 0, 0); return Math.max(0, Math.round((auj - d) / 86400000)); };
const fr = (iso) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "");
const sa = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// ---------- Actions attribuées ----------
// Une action (« commander le mitigeur », « appeler le fournisseur »…) peut
// être confiée à une personne de l'appli ; elle la retrouve dans « Mes
// actions » et la marque faite.
// Fil d'échanges sur une action : la personne répond (question, info, « c'est
// fait »), l'auteur de l'action est prévenu (« 💬 Retours sur mes actions »).
const heureFr = (iso) => { if (!iso) return ""; const d = new Date(iso); return isNaN(d) ? fr(iso) : d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }) + " " + d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }); };
function filHTML(l) {
  const fil = Array.isArray(l.actionFil) ? l.actionFil : [];
  if (!fil.length) return "";
  return `<div class="dps-fil">${fil.map(m => `<div class="dps-fil-msg ${m.fait ? "fait" : ""}"><b>${esc(m.de || "?")}</b> <small>${heureFr(m.le)}</small><span>${m.fait ? "✓ " : ""}${esc(m.texte || "")}</span></div>`).join("")}</div>`;
}
// Noms à ne jamais « corriger » (sites, personnes, prestataires) pour l'IA.
const motsConnus = (lignes, utilisateurs = []) => [...new Set([...(lignes || []).flatMap(l => [l.site, l.intervenant, l.demandeur, l.commentaireTechPar, l.actionPourNom, l.actionParNom]),
  ...(utilisateurs || []).flatMap(u => [u?.nom, u?.displayName, u?.name, typeof u === "string" ? u : ""])].filter(Boolean))];
const btnIA = () => `<button type="button" class="dps-ia dps-ia-mini" data-ia-champ title="L'IA corrige et met au propre, sans changer le sens">✨ Mettre au propre</button>`;
function formReponseHTML(l, { avecFait }) {
  return `<details class="dps-repondre"><summary>💬 Répondre</summary>
    <div class="dps-repondre-champs"><textarea spellcheck="true" lang="fr" data-rep-texte data-ia-cible rows="2" placeholder="Ta réponse (question, info, avancement…)"></textarea>${btnIA()}
      <div class="dps-repondre-btns"><button type="button" class="dps-rep-envoyer" data-rep-envoyer="${esc(l.id)}">📨 Envoyer</button>${avecFait ? `<button type="button" class="dps-action-fait" data-rep-fait="${esc(l.id)}">✓ Envoyer et marquer fait</button>` : ""}</div></div></details>`;
}
// Pastille visible par tous : une action est attribuée sur la demande.
export function pastilleActionHTML(l) {
  if (!l.actionPour || !l.actionTexte) return "";
  if (l.actionFaiteLe) return `<span class="dps-pastille act fait" title="${esc(l.actionTexte)}">✓ Action faite</span>`;
  return `<span class="dps-pastille act ${l.actionImmediate ? "imm" : ""}" title="${esc(l.actionTexte)}">${l.actionImmediate ? "🚨" : "📌"} Action → ${esc(l.actionPourNom || "?")}</span>`;
}
export function blocActionHTML(l, { perms, uid, utilisateurs = [], ouvert = false }) {
  const peutAttribuer = perms.peutTraiter;
  const estAuteur = uid && l.actionParUid === uid;
  if (l.actionPour && !l.actionFaiteLe) {
    const retard = l.actionEcheance && l.actionEcheance < aujourdhui();
    const peutFaire = l.actionPour === uid || perms.isEditor;
    const peutRepondre = l.actionPour === uid || estAuteur || perms.isEditor;
    return `<div class="dps-action ${retard ? "retard" : ""} ${l.actionImmediate ? "immediat" : ""}">
      <div class="dps-action-haut">
      <div class="dps-action-txt">${l.actionImmediate ? `<span class="dps-immediat-badge">🚨 ACTION IMMÉDIATE</span>` : ""}📌 <b>Action pour ${esc(l.actionPourNom || "?")}</b>${l.actionEcheance ? ` <span class="dps-action-ech">${retard ? "⚠️ en retard — " : ""}avant le ${fr(l.actionEcheance)}</span>` : ""}
        ${l.actionTexte ? `<span class="dps-action-detail">${esc(l.actionTexte)}</span>` : ""}
        <small>Attribuée${l.actionPar ? ` par ${esc(l.actionPar)}` : ""}${l.actionLe ? ` le ${fr(l.actionLe)}` : ""}</small></div>
      <div class="dps-action-btns">
        ${peutFaire ? `<button type="button" class="dps-action-fait" data-act-fait="${esc(l.id)}" title="L'action seulement — l'intervention se clôture à part">✓ Action faite</button>` : ""}
        ${peutAttribuer || estAuteur ? `<button type="button" class="dps-action-modif" data-act-modif title="Modifier ou transférer l'action à quelqu'un d'autre">✏️ Modifier / transférer</button>` : ""}
        ${peutAttribuer ? `<button type="button" class="dps-action-suppr" data-act-retirer="${esc(l.id)}" title="Retirer l'action">✕</button>` : ""}
      </div></div>
      ${peutAttribuer || estAuteur ? `<div class="dps-action-champs dps-action-edit" hidden>
        <label>Pour<select data-edit-pour>${utilisateurs.map(u => `<option value="${esc(u.uid)}" ${u.uid === l.actionPour ? "selected" : ""}>${esc(u.nom || u.email)}</option>`).join("")}${utilisateurs.some(u => u.uid === l.actionPour) ? "" : `<option value="${esc(l.actionPour)}" selected>${esc(l.actionPourNom || "?")}</option>`}</select></label>
        <label>Avant le<input type="date" data-edit-ech value="${esc(l.actionEcheance || "")}"></label>
        <label class="large">Action à faire<input spellcheck="true" lang="fr" data-edit-texte data-ia-cible value="${esc(l.actionTexte || "")}">${btnIA()}</label>
        <label class="large dps-act-immediat"><input type="checkbox" data-edit-immediat ${l.actionImmediate ? "checked" : ""}> 🚨 Action immédiate <small>(alerte rouge en haut de son écran jusqu'à ce qu'elle soit faite)</small></label>
        <button type="button" class="dps-action-ok" data-act-enregistrer="${esc(l.id)}">💾 Enregistrer la modification</button>
      </div>` : ""}
      ${filHTML(l)}
      ${peutRepondre ? formReponseHTML(l, { avecFait: peutFaire }) : ""}
    </div>`;
  }
  const faite = l.actionPour && l.actionFaiteLe ? `<div class="dps-action faite">✓ Action faite par ${esc(l.actionFaitePar || l.actionPourNom || "")} le ${fr(l.actionFaiteLe)}${l.actionTexte ? ` — ${esc(l.actionTexte)}` : ""}${filHTML(l)}</div>` : "";
  if (!peutAttribuer) return faite;
  return `${faite}<details class="dps-action-form" ${ouvert ? "open" : ""}><summary>${l.actionPour ? "↪ Nouvelle action / réattribuer (l'historique est conservé)" : "📌 Attribuer une action à quelqu'un"}</summary>
    <div class="dps-action-champs">
      <label>Pour<select data-act-pour><option value="">— choisir —</option>${utilisateurs.map(u => `<option value="${esc(u.uid)}">${esc(u.nom || u.email)}</option>`).join("")}</select></label>
      <label>Avant le<input type="date" data-act-ech></label>
      <label class="large">Action à faire<input spellcheck="true" lang="fr" data-act-texte data-ia-cible placeholder="ex. Commander le mitigeur, rappeler le fournisseur…">${btnIA()}</label>
      <div class="large">${phrasesHTML("actions", perms.isEditor)}</div>
      <label class="large dps-act-immediat"><input type="checkbox" data-act-immediat> 🚨 Action immédiate <small>(alerte rouge en haut de son écran jusqu'à ce qu'elle soit faite)</small></label>
      <button type="button" class="dps-action-ok" data-act-attribuer="${esc(l.id)}">📌 Attribuer</button>
    </div></details>`;
}
// Carte « retour » pour l'auteur d'une action (réponse ou action faite non lue).
export function blocRetourHTML(l, { perms, uid }) {
  return `<div data-id="${esc(l.id)}" class="dps-action ${l.actionFaiteLe ? "faite" : ""}">
    <div class="dps-action-haut"><div class="dps-action-txt">${l.actionFaiteLe ? "✓" : "💬"} <b>${esc(l.actionPourNom || "?")}</b> ${l.actionFaiteLe ? `a marqué l'action faite le ${fr(l.actionFaiteLe)}` : "a répondu"}
      <span class="dps-action-detail">${esc(l.actionTexte || "")}</span></div>
      <div class="dps-action-btns"><button type="button" class="dps-rep-vu" data-rep-vu="${esc(l.id)}">👍 Vu</button></div></div>
    ${filHTML(l)}
    ${!l.actionFaiteLe ? formReponseHTML(l, { avecFait: false }) : ""}
  </div>`;
}
export function brancherActions(container, { lignes, maj, utilisateur, utilisateurs = [], uid = null }) {
  const ligne = (id) => lignes.find(x => x.id === id) || {};
  const ajoutFil = (id, texte, fait) => [...(Array.isArray(ligne(id).actionFil) ? ligne(id).actionFil : []), { de: utilisateur, texte, le: new Date().toISOString(), ...(fait ? { fait: true } : {}) }];
  // Qui doit être prévenu : l'auteur si c'est la personne chargée qui écrit, sinon la personne chargée.
  // Auteur de l'action : son uid (ou, pour les actions plus anciennes, retrouvé par son nom).
  const auteurUid = (id) => ligne(id).actionParUid || utilisateurs.find(u => (u.nom || u.email) === ligne(id).actionPar)?.uid || "";
  const notif = (id) => { const a = auteurUid(id); return a && a !== uid ? { actionReponseNonLue: true, actionParUid: a } : { actionNonLuPour: true }; };
  container.querySelectorAll(".dps-action-form").forEach(f => brancherPhrases(f, () => f.querySelector("[data-act-texte]"), "remplace"));
  // ✨ IA sur les champs d'action / de réponse
  container.querySelectorAll("[data-ia-champ]").forEach(b => b.addEventListener("click", async (e) => {
    e.preventDefault();
    const champ = b.parentElement.querySelector("[data-ia-cible]"); if (!champ) return;
    const notes = champ.value.trim();
    if (!notes) { window.toast?.("Écris d'abord quelques mots, l'IA les mettra au propre."); champ.focus(); return; }
    const id = b.closest("[data-id]")?.dataset.id; const l = lignes.find(x => x.id === id) || {};
    b.disabled = true; const avant = b.textContent; b.textContent = "⏳ IA…";
    try {
      const { redigerCommentaireDemande } = await import("./ia.js");
      const t = (await redigerCommentaireDemande({ descr: l.descr, notes, mots: motsConnus(lignes) })).replace(/\*\*/g, "").trim();
      const { proposerIA } = await import("./ia-suggestion.js");
      if (t) proposerIA(b, t, (v) => { champ.value = v; champ.dispatchEvent(new Event("input", { bubbles: true })); });
    } catch (err) { console.error(err); import("./ia-suggestion.js").then(m => m.signalerErreurIA(err)); }
    finally { b.disabled = false; b.textContent = avant; }
  }));
  container.querySelectorAll("[data-act-modif]").forEach(b => b.addEventListener("click", () => {
    const f = b.closest(".dps-action")?.querySelector(".dps-action-edit"); if (f) f.hidden = !f.hidden;
  }));
  container.querySelectorAll("[data-act-enregistrer]").forEach(b => b.addEventListener("click", async () => {
    const f = b.closest(".dps-action-edit"), id = b.dataset.actEnregistrer, l = ligne(id);
    const pour = f.querySelector("[data-edit-pour]").value, texte = f.querySelector("[data-edit-texte]").value.trim(), ech = f.querySelector("[data-edit-ech]").value;
    if (!texte) { alert("L'action ne peut pas être vide."); return; }
    const u = utilisateurs.find(x => x.uid === pour);
    const imm = !!f.querySelector("[data-edit-immediat]")?.checked;
    const champs = { actionTexte: texte, actionEcheance: ech };
    if (imm !== !!l.actionImmediate) champs.actionImmediate = imm;
    if (pour !== l.actionPour) Object.assign(champs, { actionPour: pour, actionPourNom: u?.nom || u?.email || "", actionNonLuPour: true });
    const modifs = [texte !== l.actionTexte && "action", ech !== (l.actionEcheance || "") && "échéance", pour !== l.actionPour && `personne (${champs.actionPourNom})`, imm !== !!l.actionImmediate && (imm ? "passée en IMMÉDIATE" : "n'est plus immédiate")].filter(Boolean);
    if (!modifs.length) { f.hidden = true; return; }
    champs.actionFil = ajoutFil(id, `Action modifiée : ${modifs.join(", ")}`);
    b.disabled = true;
    try { await maj(id, champs); } catch (e) { console.error(e); alert("Échec : " + (e?.message || e)); b.disabled = false; }
  }));
  container.querySelectorAll("[data-act-fait]").forEach(b => b.addEventListener("click", async () => {
    b.disabled = true; b.textContent = "⏳";
    const id = b.dataset.actFait;
    const l = ligne(id);
    try { await maj(id, { actionFaiteLe: aujourdhui(), actionFaitePar: utilisateur, actionFil: ajoutFil(id, "Action faite", true), actionReponseNonLue: true, ...(auteurUid(id) ? { actionParUid: auteurUid(id) } : {}) }); }
    catch (e) { console.error(e); alert("Échec : " + (e?.message || e)); b.disabled = false; b.textContent = "✓ Action faite"; return; }
    proposerCloture(l);
  }));
  // Après « Action faite » : l'action n'est PAS l'intervention. On le dit
  // clairement et on propose de clôturer l'intervention tout de suite.
  const proposerCloture = async (l) => {
    if (!l?.id || TRAITE(l.statut) || l.statut === "Réalisé") return;
    const oui = await window.confirmDialog(`L'action est notée comme faite.\n\n⚠️ L'intervention ${l.n || ""} (${l.site || ""}) n'est PAS clôturée pour autant.\n\nLe travail est-il terminé sur place ?`,
      { titre: "✓ Action faite — et l'intervention ?", texteValider: "✅ Oui, clôturer l'intervention", texteAnnuler: "Non, pas encore" });
    if (oui) window.dispatchEvent(new CustomEvent("dps-cloturer", { detail: { id: l.id, site: l.site } }));
  };
  const envoyer = async (b, fait) => {
    const zone = b.closest(".dps-repondre"), ta = zone.querySelector("[data-rep-texte]"), texte = ta.value.trim();
    const id = b.dataset.repEnvoyer || b.dataset.repFait;
    if (!texte && !fait) { ta.focus(); return; }
    b.disabled = true;
    const champs = { actionFil: ajoutFil(id, texte || "Action faite", fait), ...notif(id) };
    if (fait) Object.assign(champs, { actionFaiteLe: aujourdhui(), actionFaitePar: utilisateur, actionReponseNonLue: true, ...(auteurUid(id) ? { actionParUid: auteurUid(id) } : {}) });
    try { await maj(id, champs); }
    catch (e) { console.error(e); alert("Échec : " + (e?.message || e)); b.disabled = false; return; }
    if (fait) proposerCloture(ligne(id));
  };
  container.querySelectorAll("[data-rep-envoyer]").forEach(b => b.addEventListener("click", () => envoyer(b, false)));
  container.querySelectorAll("[data-rep-fait]").forEach(b => b.addEventListener("click", () => envoyer(b, true)));
  container.querySelectorAll("[data-rep-vu]").forEach(b => b.addEventListener("click", async () => {
    b.disabled = true;
    try { await maj(b.dataset.repVu, { actionReponseNonLue: false }); } catch (e) { console.error(e); b.disabled = false; }
  }));
  container.querySelectorAll("[data-act-retirer]").forEach(b => b.addEventListener("click", async () => {
    if (!confirm("Retirer cette action ?")) return;
    try { await maj(b.dataset.actRetirer, { actionPour: "", actionPourNom: "", actionTexte: "", actionEcheance: "", actionPar: "", actionParUid: "", actionLe: "", actionFaiteLe: "", actionFaitePar: "", actionFil: [], actionReponseNonLue: false, actionNonLuPour: false, ...(ligne(b.dataset.actRetirer).actionImmediate ? { actionImmediate: false } : {}) }); }
    catch (e) { console.error(e); alert("Échec : " + (e?.message || e)); }
  }));
  container.querySelectorAll("[data-act-attribuer]").forEach(b => b.addEventListener("click", async () => {
    const f = b.closest(".dps-action-form");
    const pour = f.querySelector("[data-act-pour]").value, texte = f.querySelector("[data-act-texte]").value.trim(), ech = f.querySelector("[data-act-ech]").value;
    if (!pour) { alert("Choisis la personne."); return; }
    if (!texte) { alert("Décris l'action à faire."); f.querySelector("[data-act-texte]").focus(); return; }
    const u = utilisateurs.find(x => x.uid === pour);
    b.disabled = true; b.textContent = "⏳";
    // L'historique des échanges est conservé : la nouvelle action s'ajoute à la suite.
    const nomPour = u?.nom || u?.email || "";
    const imm = !!f.querySelector("[data-act-immediat]")?.checked;
    const fil = ajoutFil(b.dataset.actAttribuer, `📌 Nouvelle action${imm ? " IMMÉDIATE" : ""} pour ${nomPour} : ${texte}`);
    // actionImmediate n'est écrit que s'il change (compatibilité avec les règles).
    const champImm = imm || ligne(b.dataset.actAttribuer).actionImmediate ? { actionImmediate: imm } : {};
    try { await maj(b.dataset.actAttribuer, { ...champImm, actionPour: pour, actionPourNom: nomPour, actionTexte: texte, actionEcheance: ech, actionPar: utilisateur, actionParUid: uid || "", actionLe: aujourdhui(), actionFaiteLe: "", actionFaitePar: "", actionFil: fil, actionReponseNonLue: false, actionNonLuPour: true }); }
    catch (e) { console.error(e); alert("Échec : " + (e?.message || e)); b.disabled = false; b.textContent = "📌 Attribuer"; }
  }));
}

// ---------- Attribution des sites en masse ----------
// Fenêtre : on choisit un technicien et on coche tous ses sites d'un coup.
function ouvrirGestionAffectations(sites, techs) {
  const parAsso = {}; sites.forEach(s => (parAsso[s.association || "Autres"] ||= []).push(s.nom));
  Object.values(parAsso).forEach(l => l.sort((a, b) => a.localeCompare(b, "fr")));
  const fond = document.createElement("div");
  fond.className = "ndm-fond";
  let tech = techs[0]?.uid || "";
  const coches = () => new Set(Object.entries(aff.data).filter(([, l]) => (l || []).includes(tech)).map(([s]) => s));
  let sel = coches();
  const dessiner = () => {
    fond.innerHTML = `<div class="ndm gaf">
      <div class="ndm-tete"><h3>👷 Attribuer des sites</h3><button type="button" class="ndm-x" data-fermer>✕</button></div>
      <label>Technicien<select id="gaf-tech">${techs.map(t => `<option value="${esc(t.uid)}" ${t.uid === tech ? "selected" : ""}>${esc(t.nom || t.email)} (${Object.values(aff.data).filter(l => (l || []).includes(t.uid)).length} sites)</option>`).join("")}</select></label>
      <p class="gaf-aide">Coche tous les sites de cette personne, puis enregistre. Un site peut avoir plusieurs techniciens.</p>
      <div class="gaf-listes">${Object.keys(parAsso).sort().map(a => `
        <fieldset class="gaf-asso"><legend>${esc(a)} <button type="button" data-gaf-tout="${esc(a)}">Tout</button><button type="button" data-gaf-rien="${esc(a)}">Aucun</button></legend>
          ${parAsso[a].map(nom => { const autres = (aff.data[nom] || []).filter(u => u !== tech).map(u => techs.find(t => t.uid === u)?.nom).filter(Boolean); return `<label class="gaf-site"><input type="checkbox" value="${esc(nom)}" ${sel.has(nom) ? "checked" : ""}> <span>${esc(nom)}${autres.length ? ` <small>(aussi : ${esc(autres.join(", "))})</small>` : ""}</span></label>`; }).join("")}
        </fieldset>`).join("")}</div>
      <div class="ndm-etat"></div>
      <div class="ndm-btns"><button type="button" class="dps-annuler" data-fermer>Fermer</button><button type="button" class="dps-enregistrer" id="gaf-ok">💾 Enregistrer (${sel.size} sites)</button></div>
    </div>`;
    fond.querySelectorAll("[data-fermer]").forEach(b => b.addEventListener("click", () => fond.remove()));
    fond.querySelector("#gaf-tech").addEventListener("change", (e) => { tech = e.target.value; sel = coches(); dessiner(); });
    fond.querySelectorAll(".gaf-site input").forEach(cb => cb.addEventListener("change", () => { cb.checked ? sel.add(cb.value) : sel.delete(cb.value); fond.querySelector("#gaf-ok").textContent = `💾 Enregistrer (${sel.size} sites)`; }));
    fond.querySelectorAll("[data-gaf-tout]").forEach(b => b.addEventListener("click", () => { parAsso[b.dataset.gafTout].forEach(n => sel.add(n)); dessiner(); }));
    fond.querySelectorAll("[data-gaf-rien]").forEach(b => b.addEventListener("click", () => { parAsso[b.dataset.gafRien].forEach(n => sel.delete(n)); dessiner(); }));
    fond.querySelector("#gaf-ok").addEventListener("click", async (e) => {
      const map = {};
      sites.forEach(({ nom }) => {
        const actuel = aff.data[nom] || [], a = actuel.includes(tech), b = sel.has(nom);
        if (a !== b) map[nom] = b ? [...actuel, tech] : actuel.filter(u => u !== tech);
      });
      if (!Object.keys(map).length) { fond.remove(); return; }
      e.target.disabled = true; fond.querySelector(".ndm-etat").textContent = "⏳ Enregistrement…";
      try { await saveAffectationsSites(map); window.toast?.("✓ Sites attribués"); fond.remove(); }
      catch (err) { console.error(err); fond.querySelector(".ndm-etat").textContent = "❌ " + (err?.message || err); e.target.disabled = false; }
    });
  };
  dessiner();
  document.body.appendChild(fond);
  fond.addEventListener("click", (e) => { if (e.target === fond) fond.remove(); });
}

// ---------- Nouvelles demandes ----------
// Mémorisé sur l'appareil, par personne : date de dernière consultation de
// chaque site. Une demande importée après cette date est « 🆕 nouvelle ».
const vuCle = (uid) => `etablieres-dps-vu-${uid || "anon"}`;
function lireVu(uid) {
  try { const v = JSON.parse(localStorage.getItem(vuCle(uid)) || "null"); if (v && v.base) return v; } catch {}
  const v = { base: Date.now(), sites: {} };
  try { localStorage.setItem(vuCle(uid), JSON.stringify(v)); } catch {}
  return v;
}
function marquerSiteVu(uid, site) {
  const v = lireVu(uid); v.sites[site] = Date.now();
  try { localStorage.setItem(vuCle(uid), JSON.stringify(v)); } catch {}
}
const estNouvelle = (l, depuis) => !!l.importeMs && l.importeMs > depuis && !TRAITE(l.statut) && l.statut !== A_VALIDER;

const st = { site: null, q: "", association: "", voirTraitees: false, toutVoir: false, brouillons: {}, tech: "", tri: "urgence", qSite: "" };
// Tri des demandes d'un site (mémorisé sur l'appareil).
try { st.tri = localStorage.getItem("etablieres-dps-tri") || "urgence"; } catch {}
const ORDRE_AVANCEMENT = { "Non renseigné": 0, "Pris en compte": 1, "Intervenant sollicité": 2, "Demande de devis": 3, "Planifié": 4, "Commande en cours": 5, "Autre": 6 };
const TRIS = {
  urgence: ["🔴 Urgence", (a, b) => ((ORDRE_URG[a.urgence] ?? 9) - (ORDRE_URG[b.urgence] ?? 9)) || (a.date || "").localeCompare(b.date || "")],
  recentes: ["📅 Plus récentes", (a, b) => (b.date || "").localeCompare(a.date || "") || String(b.n).localeCompare(String(a.n), "fr", { numeric: true })],
  anciennes: ["📅 Plus anciennes", (a, b) => (a.date || "9999").localeCompare(b.date || "9999") || String(a.n).localeCompare(String(b.n), "fr", { numeric: true })],
  local: ["🚪 N° logement / local", (a, b) => (!a.local) - (!b.local) || String(a.local).localeCompare(String(b.local), "fr", { numeric: true, sensitivity: "base" }) || (a.date || "").localeCompare(b.date || "")],
  numero: ["# N° demande", (a, b) => String(a.n).localeCompare(String(b.n), "fr", { numeric: true })],
  avancement: ["⏩ Avancement", (a, b) => ((ORDRE_AVANCEMENT[a.statut] ?? 9) - (ORDRE_AVANCEMENT[b.statut] ?? 9)) || ((ORDRE_URG[a.urgence] ?? 9) - (ORDRE_URG[b.urgence] ?? 9))],
};
// Brouillon par demande : rien n'est enregistré tant que « Enregistrer » /
// « Valider » n'est pas cliqué (on garde la saisie même si l'écran se
// rafraîchit à cause d'une autre modification).
const val = (l, k) => (st.brouillons[l.id] && k in st.brouillons[l.id] ? st.brouillons[l.id][k] : (l[k] || ""));
const aChange = (l) => { const b = st.brouillons[l.id]; return !!b && Object.keys(b).some(k => (b[k] || "") !== (l[k] || "")); };

function badgeUrg(u) {
  const cls = u === "Critique" ? "crit" : u === "Urgent" ? "urg" : u === "À planifier" ? "plan" : u === "Normal" ? "norm" : "nr";
  return `<span class="dps-urg ${cls}">${esc(u)}</span>`;
}
function badgeAge(j) {
  if (j === null) return "";
  const cls = j > 90 ? "vieux" : j > 30 ? "moyen" : "";
  return `<span class="dps-age ${cls}" title="Ancienneté de la demande">${j === 0 ? "aujourd'hui" : `il y a ${j} j`}</span>`;
}

export function renderParSite(container, lignes, { toggleHTML, onToggle, perms, maj, utilisateur = "", uid = null, utilisateurs = [], apres = null, favLectureSeule = false, rafraichir = null, quitterFocus = null }) {
  const saisies = capturerSaisies(container);
  // Préchargement de l'IA dès qu'on commence à écrire (✨ plus rapide ensuite).
  if (!container.__iaPrechargee) { container.__iaPrechargee = true; container.addEventListener("focusin", (e) => { if (e.target.matches("textarea, [data-act-texte], [data-edit-texte]") && !window.__iaPrete) { window.__iaPrete = true; import("./ia.js").then(m => m.prechargerIA()).catch(() => {}); } }); }
  suivreFavoris(uid);
  suivreAffectations();
  suivreEntreprises();
  suivrePhrases();
  if (!lignes) { container.innerHTML = `<div class="stack">${toggleHTML}<div class="hint">Chargement des demandes…</div></div>`; onToggle(); return; }
  const toutesLignes = lignes;
  const rerender = () => renderParSite(container, toutesLignes, { toggleHTML, onToggle, perms, maj, utilisateur, uid, utilisateurs, apres, favLectureSeule, rafraichir, quitterFocus });
  fav.rerender = () => { if (container.isConnected && !st.site) rerender(); };
  aff.rerender = () => { if (container.isConnected) rerender(); };
  ent.rerender = () => { if (container.isConnected && perms.isEditor) rerender(); };
  phr.rerender = () => { if (container.isConnected && st.site) rerender(); };
  // Personnes à qui l'on peut confier un site : techniciens d'abord, puis superviseurs / admins.
  const ORDRE_ROLE = { technicien: 0, n1: 1, admin: 2, super_admin: 3 };
  const accesTerrain = (u) => ["menage", "mi_temps"].includes(u.role) && (u.permissions || {})["suivi-demandes"] === "write";
  const techs = utilisateurs.filter(u => u.role in ORDRE_ROLE || accesTerrain(u))
    .sort((a, b) => ((ORDRE_ROLE[a.role] ?? 0) - (ORDRE_ROLE[b.role] ?? 0)) || String(a.nom || a.email).localeCompare(String(b.nom || b.email), "fr"));
  const nomDe = (id) => { const u = utilisateurs.find(x => x.uid === id); return u ? (u.nom || u.email) : ""; };
  const estTech = perms.isTech && !perms.isEditor;
  // ---------- Attribution d'une demande (technicien ou entreprise) ----------
  // Une demande attribuée ne concerne que son attributaire ; sans attribution,
  // elle suit le(s) technicien(s) du site (ancien fonctionnement).
  const concerneMoi = (l) => l.attribueA ? l.attribueA === uid : (techsDuSite(l.site).includes(uid) || l.actionPour === uid);
  if (estTech && uid && !st.toutVoir) lignes = lignes.filter(l => concerneMoi(l) || l.actionPour === uid || (l.lieeA && toutesLignes.some(p => p.id === l.lieeA && concerneMoi(p))));
  const iconeAttrib = (l) => l.attribueA === "ext" ? "🏢" : "👷";
  const pastilleAttribHTML = (l) => l.attribueANom ? `<span class="dps-pastille attrib ${l.attribueA === uid ? "moi" : ""}" title="Attribuée${l.attribuePar ? ` par ${esc(l.attribuePar)}` : ""}${l.attribueLe ? ` le ${fr(l.attribueLe)}` : ""}">${iconeAttrib(l)} ${l.attribueA === uid ? "Pour moi" : esc(l.attribueANom)}</span>` : "";
  const selectAttribHTML = (l) => {
    const duSite = techsDuSite(l.site).map(nomDe).filter(Boolean);
    return `<label class="dps-attrib-sel">Attribuée à<select data-attrib="${esc(l.id)}">
      <option value="">— Personne${duSite.length ? ` (suit le site : ${esc(duSite.join(", "))})` : ""} —</option>
      ${techs.map(t => `<option value="${esc(t.uid)}" ${l.attribueA === t.uid ? "selected" : ""}>👷 ${esc(t.nom || t.email)}${techsDuSite(l.site).includes(t.uid) ? " ★" : ""}</option>`).join("")}
      <optgroup label="🏢 Entreprises extérieures">
        ${l.attribueA === "ext" && !ficheEntreprise(l.attribueANom) ? `<option value="ext:${esc(l.attribueANom)}" selected>🏢 ${esc(l.attribueANom)}</option>` : ""}
        ${ent.liste.map(e => `<option value="ext:${esc(e.nom)}" ${l.attribueA === "ext" && cleEnt(l.attribueANom) === cleEnt(e.nom) ? "selected" : ""}>🏢 ${esc(e.nom)}${e.metier ? ` — ${esc(e.metier)}` : ""}</option>`).join("")}
        <option value="ext">➕ Nouvelle entreprise…</option>
      </optgroup>
    </select></label>${l.attribueA === "ext" && ficheEntreprise(l.attribueANom) ? (f => `<small class="dps-attrib-ent"><b>${esc(f.nom)}</b>${f.contact ? ` · 👤 ${esc(f.contact)}` : ""}${f.metier ? ` · ${esc(f.metier)}` : ""}${f.tel ? ` · <a href="tel:${esc(f.tel.replace(/\s/g, ""))}">📞 ${esc(f.tel)}</a>` : ""}${f.email ? ` · <a href="mailto:${esc(f.email)}">✉️</a>` : ""}</small>`)(ficheEntreprise(l.attribueANom)) : ""}`;
  };
  const attribBlocHTML = (l) => perms.isEditor && !TRAITE(l.statut) && !EN_ATTENTE_VALID(l.statut) ? `<div class="dps-attrib">${selectAttribHTML(l)}</div>`
    : l.attribueANom ? `<div class="dps-attrib lu">${iconeAttrib(l)} Attribuée à <b>${esc(l.attribueANom)}</b>${l.attribueA === "ext" && ficheEntreprise(l.attribueANom)?.metier ? ` <small>(${esc(ficheEntreprise(l.attribueANom).metier)})</small>` : ""}${l.attribuePar ? ` <small>par ${esc(l.attribuePar)}${l.attribueLe ? ` le ${fr(l.attribueLe)}` : ""}</small>` : ""}</div>` : "";
  const attribuer = async (l, valeur, sel) => {
    let champs;
    if (!valeur) champs = { attribueA: "", attribueANom: "", attribueLe: "", attribuePar: "" };
    else {
      let nom;
      if (valeur === "ext") {
        const e1 = await ouvrirNouvelleEntreprise();
        if (!e1) { if (sel) sel.value = l.attribueA === "ext" ? `ext:${l.attribueANom}` : (l.attribueA || ""); return; }
        nom = e1.nom;
      } else if (valeur.startsWith("ext:")) { nom = valeur.slice(4); valeur = "ext"; }
      else nom = nomDe(valeur);
      champs = { attribueA: valeur, attribueANom: nom, attribueLe: aujourdhui(), attribuePar: utilisateur, categorieIntervenant: valeur === "ext" ? "Externe SG" : "Interne SG" };
      // Le contact / entreprise suit l'attribution s'il était vide ou reprenait l'ancienne.
      if (!l.intervenant || l.intervenant === l.attribueANom) champs.intervenant = nom;
      if (!l.statut || l.statut === "Non renseigné") champs.statut = "Pris en compte";
    }
    if (sel) sel.disabled = true;
    try { await majP(l.id, champs); window.toast?.(valeur ? `${l.n} attribuée à ${champs.attribueANom}` : `${l.n} : attribution retirée`); }
    catch (e) { console.error(e); alert("Échec : " + (e?.message || e)); if (sel) sel.disabled = false; }
  };
  const brancherAttrib = () => {
    container.querySelectorAll("[data-attrib]").forEach(sel => sel.addEventListener("change", () => { const l = toutesLignes.find(x => x.id === sel.dataset.attrib); if (l) attribuer(l, sel.value, sel); }));
    container.querySelectorAll("[data-attrib-rapide]").forEach(b => b.addEventListener("click", () => { const [id, v] = b.dataset.attribRapide.split("|"); const l = toutesLignes.find(x => x.id === id); if (l) { b.disabled = true; attribuer(l, v, null); } }));
  };
  const q = sa(st.q.trim());
  const carteValidation = (l) => `
    <article class="dps-carte a-valider" data-id="${esc(l.id)}">
      <div class="dps-carte-tete"><span class="dps-num">${esc(l.n)}</span>${badgeUrg(l.urgence)}${pastilleActionHTML(l)}<span class="dps-local">🏠 ${esc(l.site)}</span>${l.local ? `<span class="dps-local">📍 ${esc(l.local)}</span>` : ""}</div>
      ${l.validation === "ANNULATION"
        ? `<div class="dps-valid-type annul">🚫 <b>Annulation demandée</b> par ${esc(l.declarePar || "le technicien")}${l.declareLe ? ` le ${fr(l.declareLe)}` : ""} — en attente de validation du superviseur</div>`
        : `<div class="dps-valid-type">✅ <b>Intervention réalisée</b>${l.declarePar ? ` par ${esc(l.declarePar)}` : ""}${l.declareLe ? ` le ${fr(l.declareLe)}` : ""} — en attente de validation du superviseur</div>`}
      <p class="dps-descr">${esc(l.descr) || "<i>Sans descriptif</i>"}</p>
      <div class="dps-lecture">
        <span>${l.validation === "ANNULATION" ? "Annulation demandée le" : "Réalisée le"} <b>${fr(l.dateIntervention) || "—"}</b>${l.intervenant ? ` · intervenant : <b>${esc(l.intervenant)}</b>` : ""}</span>
        ${l.declarePar ? `<span>Déclarée par <b>${esc(l.declarePar)}</b>${l.declareLe ? ` le ${fr(l.declareLe)}` : ""}</span>` : ""}
        ${l.commentaireTech ? `<span class="dps-com-lu">« ${esc(l.commentaireTech)} »${l.commentaireTechPar ? ` <small>— ${esc(l.commentaireTechPar)}</small>` : ""}</span>` : `<span class="dps-com-lu vide">Pas de commentaire</span>`}
      </div>
      ${perms.isEditor ? `<details class="dps-vf">
        <summary>✏️ Corriger avant de valider <small>(un détail à reprendre ? inutile de refuser)</small></summary>
        <div class="dps-vf-champs">
          <label>Date d'intervention<input type="date" data-vf="dateIntervention" value="${esc(l.dateIntervention || "")}"></label>
          <label>Réalisé par<input data-vf="declarePar" value="${esc(l.declarePar || "")}" placeholder="Technicien ou entreprise"></label>
          <label>Contact / entreprise<input data-vf="intervenant" value="${esc(l.intervenant || "")}" placeholder="ex. Ronald, Écol'eau…"></label>
          <label class="large">Commentaire<textarea data-vf="commentaireTech" rows="3" spellcheck="true" lang="fr">${esc(l.commentaireTech || "")}</textarea></label>
        </div>
        <div class="dps-vf-btns"><button type="button" class="dps-annuler" data-vf-enregistrer>💾 Enregistrer seulement</button></div>
        <p class="dps-vf-aide">« ✓ Valider » ci-dessous enregistre aussi tes corrections.</p>
      </details>
      <div class="dps-actions">
        <button type="button" class="dps-enregistrer valider" data-dps-valider>${l.validation === "ANNULATION" ? "✓ Valider l'annulation" : "✓ Valider la réalisation"}</button>
        <button type="button" class="dps-annuler" data-dps-refuser>↩ Refuser (renvoyer au technicien)</button>
      </div>` : `<span class="dps-pastille valid">⏳ En attente de validation du superviseur</span>`}
      <div class="dps-etat" aria-live="polite"></div>
    </article>`;
  const brancherValidation = () => container.querySelectorAll(".dps-carte.a-valider").forEach(c => {
    const etat = c.querySelector(".dps-etat");
    // Corrections du superviseur (seulement les champs réellement modifiés).
    const corrections = () => {
      const lv = lignes.find(x => x.id === c.dataset.id) || {}, ch = {};
      c.querySelectorAll("[data-vf]").forEach(el => { const k = el.dataset.vf, v = el.value.trim(); if (v !== String(lv[k] || "").trim()) ch[k] = v; });
      if ("commentaireTech" in ch) { ch.commentaireTechPar = utilisateur; ch.commentaireTechLe = aujourdhui(); }
      return ch;
    };
    c.querySelector("[data-vf-enregistrer]")?.addEventListener("click", async (e) => {
      const ch = corrections(); if (!Object.keys(ch).length) { etat.textContent = "Rien n'a été modifié."; return; }
      e.target.disabled = true; etat.textContent = "⏳ Enregistrement…";
      try { await majP(c.dataset.id, ch); etat.textContent = "✓ Corrections enregistrées — reste à valider"; etat.className = "dps-etat ok"; }
      catch (err) { console.error(err); etat.textContent = "❌ Échec — réessaie"; etat.className = "dps-etat ko"; }
      e.target.disabled = false;
    });
    c.querySelector("[data-dps-valider]")?.addEventListener("click", async (e) => {
      e.target.disabled = true; etat.textContent = "⏳ Validation…";
      const lv = lignes.find(x => x.id === c.dataset.id);
      const annul = lv?.validation === "ANNULATION";
      try { await majP(c.dataset.id, { ...corrections(), statut: annul ? "Annulé" : "Réalisé", validation: "OUI", dateValidation: aujourdhui(), validePar: utilisateur, dateStatut: aujourdhui() }); etat.textContent = annul ? "✓ Annulation validée" : "✓ Réalisation validée"; etat.className = "dps-etat ok"; }
      catch (err) { console.error(err); etat.textContent = "❌ Échec — réessaie"; etat.className = "dps-etat ko"; e.target.disabled = false; }
    });
    c.querySelector("[data-dps-refuser]")?.addEventListener("click", async () => {
      const motif = prompt("Pourquoi refuses-tu ? (le technicien verra ce message sur la demande)", "");
      if (motif === null) return;
      etat.textContent = "⏳ …";
      try { await majP(c.dataset.id, { statut: "Pris en compte", validation: "REFUSEE", refusPar: utilisateur, refusLe: aujourdhui(), refusMotif: motif.trim(), dateStatut: aujourdhui() }); etat.textContent = "↩ Renvoyée au technicien"; etat.className = "dps-etat ok"; }
      catch (err) { console.error(err); etat.textContent = "❌ Échec — réessaie"; etat.className = "dps-etat ko"; }
    });
  });
  const brancherNouvelle = () => container.querySelectorAll("[data-nouvelle-demande]").forEach(b => b.addEventListener("click", async () => {
    const { ouvrirNouvelleDemande } = await import("./demandes-creation.js");
    ouvrirNouvelleDemande({ lignes, siteDefaut: b.dataset.nouvelleDemande || "", utilisateur, onCree: (n, site) => { st.site = site; st.vuAvant = null; if (container.isConnected) (rafraichir || rerender)(); } });
  }));
  const filtreAssoc = (l) => !st.association || l.association === st.association;
  // ---------- Demandes reliées (doublons) ----------
  // Une demande « liée » suit la principale : ce qui est enregistré sur la
  // principale (statut, date, intervenant, commentaire, validation) est
  // recopié sur ses doublons, pour que chaque ligne de l'Excel soit à jour.
  const CHAMPS_PROPAGES = ["statut", "dateIntervention", "intervenant", "categorieIntervenant", "commentaireTech", "commentaireTechPar", "commentaireTechLe", "dateStatut", "validation", "dateValidation", "validePar", "declarePar", "declareLe"];
  const lieesDe = (id) => lignes.filter(x => x.lieeA === id);
  const majP = async (id, champs) => {
    await maj(id, champs);
    const sub = Object.fromEntries(Object.entries(champs).filter(([k]) => CHAMPS_PROPAGES.includes(k)));
    if (!Object.keys(sub).length) return;
    for (const x of lieesDe(id)) { try { await maj(x.id, sub); } catch (e) { console.warn("Propagation doublon", x.n, e); } }
  };

  // ---------- Liste des sites ----------
  if (!st.site) {
    const vu = lireVu(uid);
    const parSiteTous = {}; lignes.forEach(l => { if (!l.lieeA && l.site && !parSiteTous[l.site]) parSiteTous[l.site] = { nom: l.site, association: l.association }; });
    const parSite = {};
    const doublonsParSite = {}; lignes.forEach(l => { if (l.lieeA && filtreAssoc(l)) doublonsParSite[l.site] = (doublonsParSite[l.site] || 0) + 1; });
    lignes.filter(l => filtreAssoc(l) && !l.lieeA).forEach(l => {
      const s = parSite[l.site] || (parSite[l.site] = { nom: l.site, association: l.association, ouvertes: 0, urgentes: 0, total: 0, plusVieille: 0, realiseesMois: 0, aValider: 0, actions: 0 });
      s.total++;
      if (l.actionPour && !l.actionFaiteLe) s.actions++;
      if (estNouvelle(l, vu.sites[l.site] || vu.base)) s.nouvelles = (s.nouvelles || 0) + 1;
      if (EN_ATTENTE_VALID(l.statut)) s.aValider++;
      else if (!TRAITE(l.statut)) {
        s.ouvertes++;
        if (l.urgence === "Urgent" || l.urgence === "Critique") s.urgentes++;
        const j = joursDepuis(l.date); if (j !== null && j > s.plusVieille) s.plusVieille = j;
      } else if (l.statut === "Réalisé" && (l.dateIntervention || l.dateStatut || "").slice(0, 7) === aujourdhui().slice(0, 7)) s.realiseesMois++;
    });
    const tri = (a, b) => (b.urgentes - a.urgentes) || (b.ouvertes - a.ouvertes) || a.nom.localeCompare(b.nom, "fr");
    const tous = Object.values(parSite).filter(s => !q || sa(s.nom).includes(q));
    // Technicien : ses sites attribués d'abord. Superviseur : filtre par technicien.
    const attribues = estTech && uid ? tous.filter(s => techsDuSite(s.nom).includes(uid)).sort(tri) : [];
    const dejaVu = new Set(attribues.map(s => s.nom));
    const filtreTech = !estTech && st.tech ? (s) => techsDuSite(s.nom).includes(st.tech) : null;
    // Superviseur (sans filtre) : sites rangés par technicien, puis les non attribués.
    const groupes = !estTech && !st.tech ? techs.map(t => ({ t, sites: tous.filter(s => techsDuSite(s.nom).includes(t.uid)).sort(tri) })).filter(g => g.sites.length) : [];
    const parTech = groupes.length > 0;
    const attribueAQuelquun = (s) => techsDuSite(s.nom).some(id => techs.some(t => t.uid === id));
    const favoris = filtreTech || parTech ? [] : tous.filter(s => !dejaVu.has(s.nom) && estFavori(s.nom)).sort(tri);
    const sites = filtreTech ? tous.filter(filtreTech).sort(tri)
      : parTech ? tous.filter(s => !attribueAQuelquun(s) && (st.voirTraitees || s.ouvertes > 0 || s.aValider > 0)).sort(tri)
      : tous.filter(s => !dejaVu.has(s.nom) && !estFavori(s.nom) && (st.voirTraitees || s.ouvertes > 0 || s.aValider > 0)).sort(tri);
    const carteSite = (s) => `
        <div class="dps-site-wrap">
        <button class="dps-site ${s.urgentes ? "a-urg" : s.ouvertes ? "" : "vide"}" data-dps-site="${esc(s.nom)}">
          <div class="dps-site-tete"><b>${esc(s.nom)}</b><small>${esc(s.association)}</small>${techsDuSite(s.nom).length ? `<small class="dps-site-techs">👷 ${esc(techsDuSite(s.nom).map(nomDe).filter(Boolean).join(", "))}</small>` : ""}</div>
          <div class="dps-site-compte"><span class="n">${s.ouvertes}</span><span>à traiter</span></div>
          <div class="dps-site-pied">
            ${doublonsParSite[s.nom] ? `<span class="dps-pastille lien">🔗 ${doublonsParSite[s.nom]} doublon${doublonsParSite[s.nom] > 1 ? "s" : ""} non compté${doublonsParSite[s.nom] > 1 ? "s" : ""}</span>` : ""}
            ${s.nouvelles ? `<span class="dps-pastille nouv">🆕 ${s.nouvelles} nouvelle${s.nouvelles > 1 ? "s" : ""}</span>` : ""}
            ${s.urgentes ? `<span class="dps-pastille urg">🔴 ${s.urgentes} urgente${s.urgentes > 1 ? "s" : ""}</span>` : ""}
            ${s.plusVieille > 30 ? `<span class="dps-pastille vieux">⏳ ${s.plusVieille} j</span>` : ""}
            ${s.realiseesMois ? `<span class="dps-pastille ok">✓ ${s.realiseesMois} ce mois</span>` : ""}
            ${s.aValider ? `<span class="dps-pastille valid">⏳ ${s.aValider} à valider</span>` : ""}
            ${s.actions ? `<span class="dps-pastille act">📌 ${s.actions} action${s.actions > 1 ? "s" : ""}</span>` : ""}
            ${!s.ouvertes && !s.aValider ? `<span class="dps-pastille ok">✓ À jour</span>` : ""}
          </div>
        </button>
        ${uid && !favLectureSeule ? `<button type="button" class="dps-etoile ${estFavori(s.nom) ? "on" : ""}" data-dps-fav="${esc(s.nom)}" title="${estFavori(s.nom) ? "Retirer de mes sites" : "Ajouter à mes sites"}">${estFavori(s.nom) ? "★" : "☆"}</button>` : ""}
        </div>`;
    const totFav = favoris.reduce((t, s) => t + s.ouvertes, 0);
    const affiches = filtreTech ? sites : tous.filter(s => s.ouvertes > 0 || s.aValider > 0);
    const totOuv = affiches.reduce((t, s) => t + s.ouvertes, 0), totUrg = affiches.reduce((t, s) => t + s.urgentes, 0);
    container.innerHTML = `
    <div class="stack dps">
      ${toggleHTML}
      <section class="dps-hero">
        <div><span class="dps-sur">Traitement sur le terrain</span><h2>Demandes <em>par site</em></h2>
          <p>${estTech && !st.toutVoir ? "Seulement les demandes qui te sont attribuées (ou de tes sites)." : "Choisis un site pour voir et traiter ses demandes."}</p>${perms.peutTraiter ? `<button type="button" class="dps-nouvelle" data-nouvelle-demande>➕ Nouvelle demande</button>` : ""}</div>
        <div class="dps-hero-chiffres"><div><b>${totOuv}</b><span>à traiter</span></div><div class="urg"><b>${totUrg}</b><span>urgentes</span></div><div><b>${affiches.length}</b><span>sites</span></div></div>
      </section>
      ${perms.isEditor ? (() => { const av = lignes.filter(l => EN_ATTENTE_VALID(l.statut) && !l.lieeA).sort((a, b) => (a.dateIntervention || "").localeCompare(b.dateIntervention || "")); return av.length ? `
      <section class="dps-valid-bloc">
        <div class="dps-valid-tete"><h3>⏳ ${av.length} demande${av.length > 1 ? "s" : ""} à valider</h3><p>Déclarées réalisées par les techniciens — vérifie et valide.</p></div>
        <div class="dps-cartes">${av.map(l => carteValidation(l)).join("")}</div>
      </section>` : ""; })() : ""}
      ${perms.isEditor ? (() => {
        // Nouvelles demandes (arrivées depuis la mise en place de l'attribution) sans attributaire.
        const aa = toutesLignes.filter(l => !l.lieeA && !l.attribueA && l.importeMs >= DEBUT_ATTRIBUTION && A_TRAITER(l.statut) && filtreAssoc(l))
          .sort((a, b) => ((ORDRE_URG[a.urgence] ?? 9) - (ORDRE_URG[b.urgence] ?? 9)) || b.importeMs - a.importeMs);
        return aa.length ? `
      <section class="dps-a-attribuer">
        <div class="dps-valid-tete"><h3>🆕 ${aa.length} demande${aa.length > 1 ? "s" : ""} à attribuer</h3><p>Choisis le technicien ou l'entreprise : le technicien ne verra que les demandes qui lui sont attribuées.</p></div>
        <div class="dps-aa-liste">${aa.slice(0, 30).map(l => `
          <div class="dps-aa" data-id="${esc(l.id)}">
            <div class="dps-aa-txt"><span class="dps-num">${esc(l.n)}</span>${badgeUrg(l.urgence)}<b>${esc(l.site)}</b>${l.local ? ` <small>📍 ${esc(l.local)}</small>` : ""}<p>${esc((l.descr || "").slice(0, 140)) || "<i>Sans descriptif</i>"}</p></div>
            <div class="dps-aa-choix">${techsDuSite(l.site).filter(id => techs.some(t => t.uid === id)).map(id => `<button type="button" class="dps-aa-rapide" data-attrib-rapide="${esc(l.id)}|${esc(id)}">👷 ${esc(nomDe(id))}</button>`).join("")}${selectAttribHTML(l)}</div>
          </div>`).join("")}${aa.length > 30 ? `<div class="hint">+ ${aa.length - 30} autre(s)</div>` : ""}</div>
      </section>` : "";
      })() : ""}
      ${estTech ? `<label class="dps-case dps-toutvoir"><input type="checkbox" id="dps-toutvoir" ${st.toutVoir ? "checked" : ""}> 👀 Voir aussi les demandes des autres</label>` : ""}
      <div class="dps-barre">
        <label class="dps-recherche"><span>🔎</span><input id="dps-q" type="search" placeholder="Rechercher un site, un N° (SG-623) ou un mot…" value="${esc(st.q)}"></label>
        <div class="dps-seg">${[["", "Toutes"], ["Agropolis", "Agropolis"], ["École", "École"], ["Armonia", "Armonia"]].map(([k, l]) => `<button data-dps-asso="${esc(k)}" class="${st.association === k ? "on" : ""}">${l}</button>`).join("")}</div>
        ${perms.isEditor && techs.length ? `<button type="button" class="dps-gerer-affect" id="dps-gerer-affect">👷 Attribuer des sites…</button>` : ""}
        ${!estTech && techs.length ? `<label class="dps-tech-filtre">👷<select id="dps-tech"><option value="">Tous les techniciens</option>${techs.map(t => `<option value="${esc(t.uid)}" ${st.tech === t.uid ? "selected" : ""}>${esc(t.nom || t.email)} (${(n => `${n} site${n > 1 ? "s" : ""}`)(Object.values(aff.data).filter(l => l.includes(t.uid)).length)})</option>`).join("")}</select></label>` : ""}
        <label class="dps-case"><input type="checkbox" id="dps-traitees" ${st.voirTraitees ? "checked" : ""}> Sites sans demande en attente</label>
      </div>
      ${q.length >= 3 ? (() => {
        // Recherche aussi dans les demandes (N°, descriptif, local), même traitées ou reliées.
        const trouvees = lignes.filter(l => sa(l.n).includes(q) || sa(l.descr).includes(q) || sa(l.local).includes(q)).slice(0, 30);
        const etat = (l) => l.lieeA ? `🔗 doublon de ${esc(l.lieeANumero || "?")}` : TRAITE(l.statut) ? `✓ ${esc(l.statut)}` : EN_ATTENTE_VALID(l.statut) ? "⏳ à valider" : `à traiter · ${esc(l.statut)}`;
        return `<section class="dps-trouvees"><h3>📄 Demandes trouvées <small>${trouvees.length}${trouvees.length === 30 ? "+" : ""}</small></h3>
          ${trouvees.length ? `<div class="dps-trouvees-liste">${trouvees.map(l => `<button type="button" class="dps-trouvee" data-ouvrir-dem="${esc(l.id)}" data-ouvrir-site="${esc(l.site)}"><b>${esc(l.n)}</b><span>${esc(l.site)}${l.local ? ` · ${esc(l.local)}` : ""} — ${esc((l.descr || "").slice(0, 70))}</span><em class="${TRAITE(l.statut) || l.lieeA ? "fini" : ""}">${etat(l)}</em></button>`).join("")}</div>`
          : `<p class="dps-vide">❌ Aucune demande « ${esc(st.q.trim())} » dans l'appli${/^[a-z]{1,4}-?\d+$/i.test(st.q.trim()) ? " : elle n'a pas encore été récupérée du fichier Excel (onglet Tableau › « 📥 Récupérer les demandes du fichier »)" : ""}.</p>`}</section>`;
      })() : ""}
      ${attribues.length ? `
      <section class="dps-favoris dps-attribues">
        <h3>👷 Mes sites attribués <small>${attribues.reduce((t, s) => t + s.ouvertes, 0)} demande(s) à traiter</small>${(n => n ? `<span class="dps-pastille nouv">🆕 ${n} nouvelle${n > 1 ? "s" : ""} demande${n > 1 ? "s" : ""}</span>` : "")(attribues.reduce((t, s) => t + (s.nouvelles || 0), 0))}</h3>
        <div class="dps-sites">${attribues.map(carteSite).join("")}</div>
      </section>` : ""}
      ${filtreTech ? `<h3 class="dps-autres-titre">👷 Sites de ${esc(nomDe(st.tech))} (${sites.length})</h3>` : ""}
      ${groupes.map(g => { const aTraiter = g.sites.reduce((t, s) => t + s.ouvertes, 0), urg = g.sites.reduce((t, s) => t + s.urgentes, 0); return `
      <section class="dps-groupe-tech">
        <h3><span class="dps-avatar">${esc((g.t.nom || g.t.email || "?").slice(0, 1).toUpperCase())}</span>${esc(g.t.nom || g.t.email)}
          <small>${g.sites.length} site${g.sites.length > 1 ? "s" : ""} · ${aTraiter} à traiter${urg ? ` · <b class="urg">${urg} urgente${urg > 1 ? "s" : ""}</b>` : ""}</small></h3>
        <div class="dps-sites">${g.sites.map(carteSite).join("")}</div>
      </section>`; }).join("")}
      ${parTech ? `<h3 class="dps-autres-titre">Sites sans technicien attribué</h3>` : ""}
      ${favoris.length ? `
      <section class="dps-favoris">
        <h3>⭐ Mes sites <small>${totFav} demande${totFav > 1 ? "s" : ""} à traiter</small></h3>
        <div class="dps-sites">${favoris.map(carteSite).join("")}</div>
      </section>
      <h3 class="dps-autres-titre">Autres sites</h3>` : attribues.length ? `<h3 class="dps-autres-titre">Autres sites</h3>` : (uid && fav.pret && !filtreTech && !parTech ? `<p class="dps-astuce">⭐ Tes sites favoris de l'accueil apparaissent ici en premier. Tu peux aussi cliquer sur ☆ pour en ajouter.</p>` : "")}
      <div class="dps-sites">
        ${sites.map(carteSite).join("") || `<div class="dps-vide">Aucun ${favoris.length ? "autre " : ""}site${q ? " ne correspond à la recherche" : " avec des demandes en attente"}.</div>`}
      </div>
    </div>`;
    onToggle();
    let t = null;
    container.querySelector("#dps-q")?.addEventListener("input", (e) => { st.q = e.target.value; clearTimeout(t); t = setTimeout(() => { rerender(); const el = container.querySelector("#dps-q"); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 250); });
    container.querySelectorAll("[data-dps-asso]").forEach(b => b.addEventListener("click", () => { st.association = b.dataset.dpsAsso; rerender(); }));
    container.querySelector("#dps-gerer-affect")?.addEventListener("click", () => ouvrirGestionAffectations(Object.values(parSiteTous), techs));
    container.querySelector("#dps-tech")?.addEventListener("change", (e) => { st.tech = e.target.value; rerender(); });
    container.querySelector("#dps-traitees")?.addEventListener("change", (e) => { st.voirTraitees = e.target.checked; rerender(); });
    container.querySelector("#dps-toutvoir")?.addEventListener("change", (e) => { st.toutVoir = e.target.checked; rerender(); });
    brancherAttrib();
    container.querySelectorAll("[data-dps-fav]").forEach(b => b.addEventListener("click", (e) => { e.stopPropagation(); basculerFavori(b.dataset.dpsFav); }));
    container.querySelectorAll("[data-ouvrir-dem]").forEach(b => b.addEventListener("click", () => { st.site = b.dataset.ouvrirSite; st.q = ""; st.vuAvant = null; st.focusId = b.dataset.ouvrirDem; rerender(); container.scrollIntoView({ block: "start" }); }));
    container.querySelectorAll("[data-dps-site]").forEach(b => b.addEventListener("click", () => { st.site = b.dataset.dpsSite; st.q = ""; st.vuAvant = null; rerender(); container.scrollIntoView({ block: "start" }); }));
    brancherValidation();
    brancherNouvelle();
    restaurerSaisies(container, saisies);
    apres?.();
    return;
  }

  // ---------- Demandes d'un site ----------
  // À l'ouverture du site : on garde l'ancienne date de consultation pour
  // afficher les « 🆕 », puis on note le site comme vu.
  if (st.vuAvant == null || st.vuSite !== st.site) { const v = lireVu(uid); st.vuAvant = v.sites[st.site] || v.base; st.vuSite = st.site; marquerSiteVu(uid, st.site); }
  const duSite = lignes.filter(l => l.site === st.site && !l.lieeA);
  const tousDuSite = lignes.filter(l => l.site === st.site);
  const enValidation = duSite.filter(l => EN_ATTENTE_VALID(l.statut));
  const qS = sa(st.qSite.trim());
  const filtreQ = (l) => !qS || sa(`${l.local} ${l.n} ${l.descr} ${l.demandeur} ${l.type}`).includes(qS);
  const ouvertes = duSite.filter(l => A_TRAITER(l.statut) && filtreQ(l)).sort((TRIS[st.tri] || TRIS.urgence)[1]);
  const traitees = duSite.filter(l => TRAITE(l.statut)).sort((a, b) => (b.dateIntervention || b.dateStatut || b.date || "").localeCompare(a.dateIntervention || a.dateStatut || a.date || ""));
  // Bloc des demandes liées, affiché en haut de la carte principale.
  const lieesHTML = (l) => {
    const liees = lieesDe(l.id); if (!liees.length) return "";
    return `<details class="dps-liees"><summary>🔗 Regroupe ${liees.length + 1} demandes <small>${liees.map(x => esc(x.n)).join(", ")}</small></summary>
      ${liees.map(x => `<div class="dps-liee"><span class="dps-num">${esc(x.n)}</span><span>${x.date ? fr(x.date) : ""}${x.demandeur ? ` · ${esc(x.demandeur)}` : ""}${x.local ? ` · 📍 ${esc(x.local)}` : ""}<br><i>${esc((x.descr || "").slice(0, 110))}</i></span>${perms.peutTraiter ? `<button type="button" class="dps-delier" data-delier="${esc(x.id)}" title="Détacher cette demande">✂ Délier</button>` : ""}</div>`).join("")}
      <small>Ce qui est enregistré sur ${esc(l.n)} est recopié sur ${liees.length > 1 ? "ces demandes" : "cette demande"}.</small></details>`;
  };
  // Doublon possible : même logement / local, demandé à quelques jours d'écart.
  const jours = (a, b) => (a && b ? Math.abs((new Date(a) - new Date(b)) / 86400000) : 99);
  // La suggestion s'affiche sur la future principale : celle qui regroupe déjà
  // des doublons, sinon celle au plus petit N°.
  const doublonsPossibles = (l) => (!perms.peutTraiter || l.lieeA || TRAITE(l.statut) || !l.local) ? [] : tousDuSite.filter(x => {
    if (x.id === l.id || x.lieeA || TRAITE(x.statut) || sa(x.local) !== sa(l.local) || jours(x.date, l.date) > 7) return false;
    const pl = lieesDe(l.id).length > 0, px = lieesDe(x.id).length > 0;
    if (px) return false; // x regroupe déjà : c'est sur x que la suggestion s'affichera
    return pl || String(l.n).localeCompare(String(x.n), "fr", { numeric: true }) < 0 || false;
  });
  const suggerePar = (l) => tousDuSite.find(y => y.id !== l.id && doublonsPossibles(y).some(x => x.id === l.id));
  const suggestionHTML = (l) => { const d = suggerePar(l) ? [] : doublonsPossibles(l); return d.length ? `<details class="dps-sugg-wrap"><summary>⚠️ ${d.length} doublon${d.length > 1 ? "s" : ""} possible${d.length > 1 ? "s" : ""} <small>(même local ${esc(l.local)}, à quelques jours)</small></summary>
      <div class="dps-sugg-liste">${d.map(x => `<div class="dps-sugg-ligne"><span class="dps-num">${esc(x.n)}</span><span class="t">${esc(x.descr || "")}</span><button type="button" data-lier-direct="${esc(l.id)}|${esc(x.id)}">🔗 Relier</button></div>`).join("")}</div></details>` : ""; };
  const carte = (l, opts = {}) => {
    const j = joursDepuis(l.date);
    return `
    <article class="dps-carte ${TRAITE(l.statut) ? "traitee" : ""} ${lieesDe(l.id).length ? "a-liees" : ""} u-${sa(l.urgence).replace(/[^a-z]/g, "")}" data-id="${esc(l.id)}">
      <div class="dps-carte-tete">
        <span class="dps-num">${esc(l.n)}</span>${l.n !== "—" && tousDuSite.some(x => x.id !== l.id && x.n === l.n && x.lieeA !== l.id && l.lieeA !== x.id) ? `<span class="dps-pastille numdouble" title="Plusieurs demandes portent ce N° dans le fichier Excel : vérifie que le commentaire et l'action sont sur la bonne (outil « ↔️ Échanger » en bas de la carte)">⚠️ N° en double</span>` : ""}${lieesDe(l.id).length ? `<span class="dps-pastille lien">🔗 + ${lieesDe(l.id).map(x => esc(x.n)).join(", ")}</span>` : ""}${(p => p ? `<span class="dps-pastille sugg">⚠️ doublon possible de ${esc(p.n)}</span>` : "")(tousDuSite.find(y => y.id !== l.id && doublonsPossibles(y).some(x => x.id === l.id)))}${estNouvelle(l, st.vuAvant) ? `<span class="dps-pastille nouv">🆕 Nouvelle</span>` : ""}${pastilleAttribHTML(l)}${pastilleActionHTML(l)}${badgeUrg(l.urgence)}${badgeAge(TRAITE(l.statut) ? null : j)}
        ${l.local ? `<span class="dps-local">📍 ${esc(l.local)}</span>` : ""}
        ${perms.peutTraiter && !TRAITE(l.statut) ? `<button type="button" class="dps-tk-copie" data-ticket-copie="${esc(l.id)}" title="Copie le ticket prestataire en image : colle-le ensuite dans ton mail (Ctrl+V ou appui long › Coller)">📋 Ticket pour mail</button>` : ""}
        ${l.logementOccupe && sa(l.logementOccupe).startsWith("oui") ? `<span class="dps-occ">🏠 Logement occupé</span>` : ""}
      </div>
      ${l.validation === "REFUSEE" && !TRAITE(l.statut) ? `<div class="dps-refus">↩ <b>Clôture refusée</b>${l.refusPar ? ` par ${esc(l.refusPar)}` : ""}${l.refusLe ? ` le ${fr(l.refusLe)}` : ""}${l.refusMotif ? ` : « ${esc(l.refusMotif)} »` : ""}<small>Complète puis renvoie la clôture.</small></div>` : ""}
      <p class="dps-descr">${esc(l.descr) || "<i>Sans descriptif</i>"}</p>
      <div class="dps-meta">${l.date ? `Demandé le ${fr(l.date)}` : ""}${l.demandeur ? ` par <b>${esc(l.demandeur)}</b>` : ""}${l.type ? ` · ${esc(l.type)}` : ""}</div>
      ${perms.isEditor ? `<div class="dps-urg-edit"><label>Urgence <select data-urgence="${esc(l.id)}">${["Critique", "Urgent", "À planifier", "Normal"].map(u => `<option ${u === l.urgence ? "selected" : ""}>${u}</option>`).join("")}${["Critique", "Urgent", "À planifier", "Normal"].includes(l.urgence) ? "" : `<option selected>${esc(l.urgence)}</option>`}</select></label>${l.urgenceCorrigee ? `<small>requalifiée${l.urgenceCorrigeePar ? ` par ${esc(l.urgenceCorrigeePar)}` : ""} — demandée « ${esc(l.urgenceDemandee)} » <button type="button" data-urgence-reset="${esc(l.id)}">↩ remettre</button></small>` : ""}</div>`
        : l.urgenceCorrigee ? `<div class="dps-urg-edit"><small>Urgence requalifiée (demandée « ${esc(l.urgenceDemandee)} »)</small></div>` : ""}
      ${attribBlocHTML(l)}
      ${lieesHTML(l)}${suggestionHTML(l)}
      ${perms.peutTraiter ? `
      <div class="dps-statuts" role="group" aria-label="Statut">
        ${STATUTS_RAPIDES.map(s => `<button type="button" class="dps-st ${val(l, "statut") === s ? "on" : ""} ${s === "Réalisé" ? "ok" : s === "Annulé" ? "ko" : ""}" data-dps-statut="${esc(s)}">${esc(s)}</button>`).join("")}
      </div>
      <div class="dps-champs">
        ${perms.isEditor ? `<label>Intervenant<select data-dps-champ="categorieIntervenant">${["", "Interne SG", "Externe SG", "Interne site", "Externe site"].map(o => `<option value="${o}" ${o === val(l, "categorieIntervenant") ? "selected" : ""}>${o || "—"}</option>`).join("")}</select></label>` : ""}
        <label>Contact / entreprise<input data-dps-champ="intervenant" value="${esc(val(l, "intervenant"))}" placeholder="ex. Ronald, Écol'eau…"></label>
        ${perms.isEditor && !TRAITE(l.statut) ? (() => {
          // Clôture par un superviseur : qui a réellement fait l'intervention.
          const parDefaut = val(l, "declarePar") || nomDe(techsDuSite(l.site)[0]) || "";
          const noms = [...new Set([...techs.map(t => t.nom || t.email), utilisateur].filter(Boolean))];
          return `<label class="dps-realise-par" ${val(l, "statut") === "Réalisé" ? "" : "hidden"}>Réalisé par<select data-dps-champ="declarePar">
            <option value="">— choisir le technicien —</option>
            ${noms.map(n => `<option value="${esc(n)}" ${n === parDefaut ? "selected" : ""}>${esc(n)}${n === utilisateur ? " (moi)" : ""}</option>`).join("")}
            <option value="Entreprise extérieure" ${parDefaut === "Entreprise extérieure" ? "selected" : ""}>Entreprise extérieure</option>
          </select></label>`;
        })() : ""}
        <label>Date d'intervention<span class="dps-date"><input type="date" data-dps-champ="dateIntervention" value="${esc(val(l, "dateIntervention"))}"><button type="button" class="dps-auj" data-dps-auj title="Mettre la date du jour">Aujourd'hui</button></span></label>
        <label class="dps-com">Commentaire<textarea spellcheck="true" lang="fr" data-dps-champ="commentaireTech" rows="2" placeholder="Ce qui a été fait, pièce à commander…">${esc(val(l, "commentaireTech"))}</textarea>${l.commentaireTech ? `<small class="dps-com-auteur">✍️ ${l.commentaireTechPar ? `${esc(l.commentaireTechPar)}${l.commentaireTechLe ? ` · ${fr(l.commentaireTechLe)}` : ""}` : "auteur inconnu (saisi dans le fichier Excel ou avant le suivi des auteurs)"}</small>` : ""}${phrasesHTML("commentaires", perms.isEditor)}<button type="button" class="dps-ia" data-dps-ia title="L'IA corrige et met au propre tes notes, sans rien inventer">✨ Mettre au propre</button></label>
      </div>
      <div class="dps-actions">
        ${!TRAITE(l.statut) && val(l, "statut") !== "Réalisé" ? `<button type="button" class="dps-realise-prep" data-dps-realise>${perms.isEditor ? "✓ Réalisé aujourd'hui" : "✓ Intervention terminée"}</button>` : ""}
        <button type="button" class="dps-enregistrer ${val(l, "statut") === "Réalisé" && !TRAITE(l.statut) ? "valider" : ""}" data-dps-enregistrer ${aChange(l) ? "" : "hidden"}>${val(l, "statut") === "Réalisé" && !TRAITE(l.statut) ? (perms.isEditor ? "✓ Valider la réalisation" : "📨 Envoyer pour validation") : "💾 Enregistrer"}</button>
        ${aChange(l) ? `<button type="button" class="dps-annuler" data-dps-annuler>Annuler</button>` : ""}
      </div>
      ${val(l, "statut") === "Réalisé" && !TRAITE(l.statut) ? `<p class="dps-aide">${perms.isEditor ? "Vérifie la date, le contact et le commentaire, puis valide." : "Complète le contact et le commentaire, puis envoie au superviseur."}</p>` : ""}
      ` : `
      <div class="dps-lecture"><span>Statut : <b>${esc(l.statut)}</b></span>${l.intervenant ? `<span>Contact : <b>${esc(l.intervenant)}</b></span>` : ""}${l.dateIntervention ? `<span>Intervention : <b>${fr(l.dateIntervention)}</b></span>` : ""}${l.commentaireTech ? `<span>${esc(l.commentaireTech)}${l.commentaireTechPar ? ` <small>— ${esc(l.commentaireTechPar)}</small>` : ""}</span>` : ""}</div>`}
      ${(() => {
        const liees = lieesDe(l.id);
        const candidats = tousDuSite.filter(x => x.id !== l.id && !x.lieeA && !lieesDe(x.id).length && !TRAITE(x.statut));
        const mails = Array.isArray(l.mailsEnvoyes) ? l.mailsEnvoyes : [];
        return `${mails.length ? `<div class="dps-mails">${mails.slice(-3).map(m => `<span>📧 Mail à <b>${esc(m.a)}</b> le ${fr(m.le)}${m.par ? ` par ${esc(m.par)}` : ""}</span>`).join("")}</div>` : ""}
        ${perms.peutTraiter ? `<div class="dps-mail-ligne"><button type="button" class="dps-mail-btn" data-mail="${esc(l.id)}">✉️ Envoyer par mail</button><button type="button" class="dps-mail-btn dps-ticket-btn" data-ticket="${esc(l.id)}">🎫 Ticket prestataire</button></div>` : ""}
        ${perms.peutTraiter && candidats.length ? `<details class="dps-lier"><summary>🔗 Relier un doublon à cette demande</summary>
          <div class="dps-lier-champs"><select data-lier-choix><option value="">— Choisir la demande en double —</option>${candidats.map(x => `<option value="${esc(x.id)}">${esc(x.n)} · ${x.date ? fr(x.date) : "?"}${x.local ? ` · ${esc(x.local)}` : ""} — ${esc((x.descr || "").slice(0, 60))}</option>`).join("")}</select>
          <button type="button" class="dps-action-ok" data-lier="${esc(l.id)}">🔗 Relier</button></div></details>` : ""}
        ${perms.isEditor && tousDuSite.length > 1 ? `<details class="dps-lier dps-echanger"><summary>↔️ Suivi sur la mauvaise demande ? Échanger avec une autre</summary>
          <p class="dps-echanger-aide">Échange le statut, le commentaire, l'intervenant, la clôture et l'action entre cette demande et celle choisie. Le descriptif, le N° et le local ne bougent pas.</p>
          <div class="dps-lier-champs"><select data-echanger-choix><option value="">— Choisir la bonne demande —</option>${tousDuSite.filter(x => x.id !== l.id).sort((a, b) => (a.local || "").localeCompare(b.local || "", "fr", { numeric: true })).map(x => `<option value="${esc(x.id)}">${esc(x.n)} · ${x.date ? fr(x.date) : "?"}${x.local ? ` · ${esc(x.local)}` : ""} — ${esc((x.descr || "").slice(0, 60))}</option>`).join("")}</select>
          <button type="button" class="dps-action-ok" data-echanger="${esc(l.id)}">↔️ Échanger le suivi</button></div></details>` : ""}`;
      })()}
      ${opts.sansAction ? "" : blocActionHTML(l, { perms, uid, utilisateurs })}
      <div class="dps-etat" aria-live="polite"></div>
    </article>`;
  };
  // Vue « demande seule » (ouverte depuis une action) : la demande à gauche,
  // l'action et ses échanges à droite.
  let focusRendu = false;
  if (st.focusId) {
    const lf = duSite.find(x => x.id === st.focusId) || tousDuSite.find(x => x.id === st.focusId);
    if (!lf) st.focusId = null;
    else {
      focusRendu = true;
      container.innerHTML = `
  <div class="stack dps">
    ${toggleHTML}
    <div class="dps-site-entete">
      <button class="dps-retour" id="dps-retour">← ${quitterFocus ? "Retour à mes actions" : "Retour au site"}</button>
      <div><h2>${esc(lf.n)} · ${esc(st.site)}</h2><p>${lf.local ? `📍 ${esc(lf.local)} · ` : ""}${esc(lf.statut)}</p></div>
      <button type="button" class="dps-voir-site" id="dps-voir-site">Voir tout le site →</button>
    </div>
    <div class="dps-focus">
      <div class="dps-focus-g"><div class="dps-cartes un">${carte(lf, { sansAction: true })}</div></div>
      <aside class="dps-focus-d" data-id="${esc(lf.id)}"><h3>📌 Action & échanges</h3>${blocActionHTML(lf, { perms, uid, utilisateurs, ouvert: !lf.actionPour })}</aside>
    </div>
  </div>`;
    }
  }
  if (!focusRendu) container.innerHTML = `
  <div class="stack dps">
    ${toggleHTML}
    <div class="dps-site-entete">
      <button class="dps-retour" id="dps-retour">← 🏠 Tous les sites</button>
      ${perms.peutTraiter ? `<button type="button" class="dps-nouvelle petit" data-nouvelle-demande="${esc(st.site)}">➕ Nouvelle demande ici</button>` : ""}
      <button type="button" class="dps-imprimer" id="dps-imprimer" title="Imprimer le récapitulatif des demandes du site">🖨 Imprimer</button>
      <div><h2>${esc(st.site)}</h2><p>${ouvertes.length} à traiter${enValidation.length ? ` · ${enValidation.length} à valider` : ""} · ${traitees.length} traitée${traitees.length > 1 ? "s" : ""}</p></div>
    </div>
    ${perms.isEditor && techs.length ? `<div class="dps-affect"><span>👷 Technicien(s) du site :</span>${techs.map(t => `<button type="button" class="dps-affect-tech ${techsDuSite(st.site).includes(t.uid) ? "on" : ""}" data-affect="${esc(t.uid)}">${techsDuSite(st.site).includes(t.uid) ? "✓ " : ""}${esc(t.nom || t.email)}</button>`).join("")}</div>`
      : techsDuSite(st.site).length ? `<div class="dps-affect"><span>👷 ${esc(techsDuSite(st.site).map(nomDe).filter(Boolean).join(", "))}</span></div>` : ""}
    ${enValidation.length ? `<section class="dps-valid-bloc"><div class="dps-valid-tete"><h3>⏳ ${enValidation.length} en attente de validation</h3><p>${perms.isEditor ? "Réalisations et annulations déclarées par les techniciens — vérifie puis valide ou refuse." : "Envoyées au superviseur : en attente de sa validation."}</p></div><div class="dps-cartes">${enValidation.map(l => carteValidation(l)).join("")}</div></section>` : ""}
    <div class="dps-tri-barre">
      <label class="dps-recherche"><span>🔎</span><input id="dps-qsite" type="search" placeholder="Logement, local, N°, mot du descriptif…" value="${esc(st.qSite)}"></label>
      <label class="dps-tri">Trier par<select id="dps-tri">${Object.entries(TRIS).map(([k, [lib]]) => `<option value="${k}" ${st.tri === k ? "selected" : ""}>${lib}</option>`).join("")}</select></label>
    </div>
    ${st.tri === "local" || st.tri === "avancement" ? (() => {
      // Regroupement visuel par logement / local ou par étape d'avancement.
      const cle = (l) => st.tri === "local" ? (l.local || "Sans local précisé") : (l.statut || "Non renseigné");
      const groupes = []; ouvertes.forEach(l => { const k = cle(l); let g = groupes.find(x => x.k === k); if (!g) groupes.push(g = { k, l: [] }); g.l.push(l); });
      return groupes.length ? groupes.map(g => `<h4 class="dps-groupe-titre">${st.tri === "local" ? "🚪" : "⏩"} ${esc(g.k)} <small>${g.l.length}</small></h4><div class="dps-cartes">${g.l.map(carte).join("")}</div>`).join("") : `<div class="dps-vide">Aucune demande${qS ? " ne correspond" : " à traiter sur ce site"}.</div>`;
    })() : ouvertes.length ? `<div class="dps-cartes">${ouvertes.map(carte).join("")}</div>` : `<div class="dps-vide">${qS ? "Aucune demande ne correspond à la recherche." : "✓ Aucune demande à traiter sur ce site."}</div>`}
    ${traitees.length ? `<details class="dps-historique"><summary>Historique : ${traitees.length} demande${traitees.length > 1 ? "s" : ""} traitée${traitees.length > 1 ? "s" : ""}</summary><div class="dps-cartes">${traitees.slice(0, 40).map(carte).join("")}</div></details>` : ""}
  </div>`;
  onToggle();
  container.querySelector("#dps-retour").addEventListener("click", () => {
    if (st.focusId) { st.focusId = null; if (quitterFocus) { st.site = null; quitterFocus(); } else rerender(); return; }
    st.site = null; st.qSite = ""; rerender();
  });
  { const f = document.createElement("button"); f.type = "button"; f.id = "dps-retour-flottant"; f.className = "dps-retour-flottant"; f.textContent = st.focusId && quitterFocus ? "← 📌 Mes actions" : st.focusId ? "← Retour au site" : "← 🏠 Tous les sites"; (container.querySelector(".stack") || container).append(f); }
  container.querySelector("#dps-retour-flottant")?.addEventListener("click", () => { container.querySelector("#dps-retour")?.click(); window.scrollTo({ top: 0 }); });
  container.querySelector("#dps-imprimer")?.addEventListener("click", () => ouvrirImpressionSite({
    site: st.site, techs: techsDuSite(st.site).map(nomDe).filter(Boolean).join(", "),
    ouvertes: duSite.filter(l => A_TRAITER(l.statut)), enValidation, traitees,
  }));
  container.querySelector("#dps-voir-site")?.addEventListener("click", () => { st.focusId = null; rerender(); });
  container.querySelector("#dps-tri")?.addEventListener("change", (e) => { st.tri = e.target.value; try { localStorage.setItem("etablieres-dps-tri", st.tri); } catch {} rerender(); });
  let tq = null;
  container.querySelector("#dps-qsite")?.addEventListener("input", (e) => { st.qSite = e.target.value; clearTimeout(tq); tq = setTimeout(() => { rerender(); const el = container.querySelector("#dps-qsite"); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 300); });
  brancherValidation();
  brancherActions(container, { lignes, maj, utilisateur, utilisateurs, uid });
  brancherNouvelle();
  container.querySelectorAll("[data-lier]").forEach(b => b.addEventListener("click", async () => {
    const sel = b.parentElement.querySelector("[data-lier-choix]"), idDoublon = sel.value;
    if (!idDoublon) { sel.focus(); return; }
    const principale = lignes.find(x => x.id === b.dataset.lier), doublon = lignes.find(x => x.id === idDoublon);
    if (!confirm(`Relier ${doublon?.n} à ${principale?.n} ?\n${doublon?.n} suivra le traitement de ${principale?.n} (statut, date, commentaire…).`)) return;
    b.disabled = true;
    const champs = { lieeA: principale.id, lieeANumero: principale.n };
    CHAMPS_PROPAGES.forEach(k => { if (principale[k]) champs[k] = principale[k]; });
    try { await maj(idDoublon, champs); } catch (e) { console.error(e); alert("Échec : " + (e?.message || e)); b.disabled = false; }
  }));
  container.querySelectorAll("[data-mail]").forEach(b => b.addEventListener("click", async () => {
    const { ouvrirEnvoiMail } = await import("./demandes-mail.js");
    ouvrirEnvoiMail({ ligne: lignes.find(x => x.id === b.dataset.mail), utilisateur, peutMemoriser: perms.isEditor, maj });
  }));
  container.querySelectorAll("[data-ticket]").forEach(b => b.addEventListener("click", async () => {
    const l = lignes.find(x => x.id === b.dataset.ticket); if (!l) return;
    const fenetre = preparerFenetre();
    const { ouvrirTicketPrestataire } = await import("./demandes-ticket.js");
    const fiche = (fav.fiches || []).find(f => memeSite(l.site, f.nom));
    ouvrirTicketPrestataire({ ligne: l, adresse: fiche?.adresse || "", utilisateur, email: (utilisateurs || []).find(u => u.uid === uid)?.email || "", fenetre });
  }));
  if (container.querySelector("[data-ticket-copie]")) prechargerCaptureTicket();
  container.querySelectorAll("[data-ticket-copie]").forEach(b => b.addEventListener("click", () => {
    const l = lignes.find(x => x.id === b.dataset.ticketCopie); if (!l) return;
    const fiche = (fav.fiches || []).find(f => memeSite(l.site, f.nom));
    const ent = l.attribueA === "ext" ? ficheEntreprise(l.attribueANom) : null;
    ouvrirTicketMail({ ligne: l, adresse: fiche?.adresse || "", utilisateur, email: (utilisateurs || []).find(u => u.uid === uid)?.email || "" }, { email: ent?.email || "", contact: ent?.contact || "" });
  }));
  brancherAttrib();
  container.querySelectorAll("[data-urgence]").forEach(sel => sel.addEventListener("change", async () => {
    const l = lignes.find(x => x.id === sel.dataset.urgence), v = sel.value;
    const champs = v === l.urgenceDemandee ? { urgenceCorrigee: "", urgenceCorrigeePar: "", urgenceCorrigeeLe: "" } : { urgenceCorrigee: v, urgenceCorrigeePar: utilisateur, urgenceCorrigeeLe: aujourdhui() };
    sel.disabled = true;
    try { await maj(l.id, champs); window.toast?.(`Urgence ${v === l.urgenceDemandee ? "remise comme demandée" : `requalifiée : ${v}`}`); } catch (e) { alert("Échec : " + (e?.message || e)); sel.disabled = false; }
  }));
  container.querySelectorAll("[data-urgence-reset]").forEach(b => b.addEventListener("click", async () => {
    try { await maj(b.dataset.urgenceReset, { urgenceCorrigee: "", urgenceCorrigeePar: "", urgenceCorrigeeLe: "" }); } catch (e) { alert("Échec : " + (e?.message || e)); }
  }));
  container.querySelectorAll("[data-lier-direct]").forEach(b => b.addEventListener("click", async () => {
    const [idP, idD] = b.dataset.lierDirect.split("|");
    const principale = lignes.find(x => x.id === idP), doublon = lignes.find(x => x.id === idD);
    if (!confirm(`Relier ${doublon?.n} à ${principale?.n} ?\n${doublon?.n} suivra le traitement de ${principale?.n}.`)) return;
    b.disabled = true;
    const champs = { lieeA: principale.id, lieeANumero: principale.n };
    CHAMPS_PROPAGES.forEach(k => { if (principale[k]) champs[k] = principale[k]; });
    try { await maj(idD, champs); } catch (e) { console.error(e); alert("Échec : " + (e?.message || e)); b.disabled = false; }
  }));
  // Réparation : le suivi (commentaire, action…) d'une demande s'est retrouvé
  // sous une autre → on échange les champs de traitement entre les deux.
  const CHAMPS_SUIVI = ["statut", "intervenant", "contact", "categorieIntervenant", "dateIntervention", "dateStatut", "commentaireTech", "commentaireTechPar", "commentaireTechLe",
    "declarePar", "declareLe", "validation", "dateValidation", "validePar", "refusPar", "refusLe", "refusMotif",
    "actionPour", "actionPourNom", "actionTexte", "actionEcheance", "actionImmediate", "actionPar", "actionParUid", "actionLe", "actionFaiteLe", "actionFaitePar", "actionFil", "actionReponseNonLue", "mailsEnvoyes"];
  const suiviDe = (x) => Object.fromEntries(CHAMPS_SUIVI.map(k => [k, k === "actionFil" || k === "mailsEnvoyes" ? (Array.isArray(x[k]) ? x[k] : []) : k === "actionImmediate" || k === "actionReponseNonLue" ? !!x[k] : (k === "statut" && x[k] === "Non renseigné" ? "" : (x[k] ?? ""))]));
  container.querySelectorAll("[data-echanger]").forEach(b => b.addEventListener("click", async () => {
    const a = lignes.find(x => x.id === b.dataset.echanger);
    const idB = b.closest(".dps-echanger")?.querySelector("[data-echanger-choix]")?.value;
    const c2 = lignes.find(x => x.id === idB);
    if (!a || !c2) { window.toast?.("Choisis d'abord la bonne demande dans la liste."); return; }
    if (!(await window.confirmDialog(`Échanger le suivi entre :\n• ${a.n} — ${(a.descr || "").slice(0, 50)}\n• ${c2.n} — ${(c2.descr || "").slice(0, 50)}\n\nStatut, commentaire, intervenant, clôture et action passent de l'une à l'autre.`, { titre: "↔️ Échanger le suivi", texteValider: "Échanger" }))) return;
    b.disabled = true;
    try {
      const sa_ = suiviDe(a), sb_ = suiviDe(c2), trace = `Suivi échangé avec ${c2.n} par ${utilisateur} le ${fr(aujourdhui())}`;
      await maj(a.id, { ...sb_, actionNonLuPour: false });
      await maj(c2.id, { ...sa_, actionNonLuPour: false });
      window.toast?.(`✓ Suivi échangé entre ${a.n} et ${c2.n}`, "success");
      console.info(trace);
    } catch (e) { console.error(e); alert("Échec : " + (e?.message || e)); b.disabled = false; }
  }));
  container.querySelectorAll("[data-delier]").forEach(b => b.addEventListener("click", async () => {
    if (!confirm("Détacher cette demande ? Elle redeviendra une demande à part.")) return;
    b.disabled = true;
    try { await maj(b.dataset.delier, { lieeA: "", lieeANumero: "" }); } catch (e) { console.error(e); alert("Échec : " + (e?.message || e)); b.disabled = false; }
  }));
  restaurerSaisies(container, saisies);
  apres?.();
  container.querySelectorAll("[data-affect]").forEach(b => b.addEventListener("click", async () => {
    const actuels = techsDuSite(st.site), id = b.dataset.affect;
    const nouveaux = actuels.includes(id) ? actuels.filter(x => x !== id) : [...actuels, id];
    b.disabled = true;
    try {
      await saveAffectationSite(st.site, nouveaux);
      // Variantes d'écriture du même site : on les vide (l'attribution est désormais sous le nom affiché).
      for (const n of Object.keys(aff.data || {})) if (n !== st.site && cleSiteAff(n) === cleSiteAff(st.site) && (aff.data[n] || []).length) await saveAffectationSite(n, []);
    }
    catch (e) { console.error(e); alert("Échec de l'attribution : " + (e?.message || e)); b.disabled = false; }
  }));

  const ligneDe = (id) => duSite.find(x => x.id === id);
  const majBoutons = (c) => {
    const l = ligneDe(c.dataset.id); if (!l) return;
    const changee = aChange(l), realise = val(l, "statut") === "Réalisé" && !TRAITE(l.statut);
    const btn = c.querySelector("[data-dps-enregistrer]");
    btn.hidden = !changee; btn.disabled = false; btn.classList.toggle("valider", realise);
    btn.textContent = realise ? (perms.isEditor ? "✓ Valider la réalisation" : "📨 Envoyer pour validation") : "💾 Enregistrer";
    let ann = c.querySelector("[data-dps-annuler]");
    if (changee && !ann) { ann = document.createElement("button"); ann.type = "button"; ann.className = "dps-annuler"; ann.dataset.dpsAnnuler = ""; ann.textContent = "Annuler"; btn.after(ann); ann.addEventListener("click", () => { delete st.brouillons[c.dataset.id]; rerender(); }); }
    if (!changee && ann) ann.remove();
    c.querySelector("[data-dps-realise]")?.toggleAttribute("hidden", realise);
    c.classList.toggle("modifiee", changee);
  };
  const poser = (c, k, v) => { (st.brouillons[c.dataset.id] ||= {})[k] = v; majBoutons(c); };
  container.querySelectorAll(".dps-carte:not(.a-valider)").forEach(c => {
    c.querySelectorAll("[data-dps-statut]").forEach(b => b.addEventListener("click", () => {
      c.querySelectorAll("[data-dps-statut]").forEach(x => x.classList.toggle("on", x === b));
      poser(c, "statut", b.dataset.dpsStatut);
      c.querySelector('[data-dps-champ="commentaireTech"]')?.classList.toggle("dps-requis", b.dataset.dpsStatut === "Réalisé");
      c.querySelector(".dps-realise-par")?.toggleAttribute("hidden", b.dataset.dpsStatut !== "Réalisé");
      if (b.dataset.dpsStatut === "Réalisé") {
        const d = c.querySelector('[data-dps-champ="dateIntervention"]');
        if (d && !d.value) { d.value = aujourdhui(); poser(c, "dateIntervention", d.value); }
        c.querySelector('[data-dps-champ="commentaireTech"]')?.focus();
      }
    }));
    c.querySelectorAll("[data-dps-champ]").forEach(inp => inp.addEventListener("input", () => { inp.classList.remove("dps-obligatoire"); poser(c, inp.dataset.dpsChamp, inp.value); }));
    c.querySelectorAll("select[data-dps-champ]").forEach(inp => inp.addEventListener("change", () => poser(c, inp.dataset.dpsChamp, inp.value)));
    brancherPhrases(c.querySelector(".dps-com") || c, () => c.querySelector('[data-dps-champ="commentaireTech"]'), "ajout", (ta) => poser(c, "commentaireTech", ta.value));
    c.querySelector("[data-dps-ia]")?.addEventListener("click", async (e) => {
      e.preventDefault();
      const ta = c.querySelector('[data-dps-champ="commentaireTech"]'), l = ligneDe(c.dataset.id), btn = e.currentTarget;
      const notes = ta.value.trim();
      if (!notes) { window.toast?.("Écris d'abord quelques mots (ce qui a été fait), l'IA les mettra au propre."); ta.focus(); return; }
      btn.disabled = true; const avant = btn.textContent; btn.textContent = "⏳ IA…";
      try {
        const { redigerCommentaireDemande } = await import("./ia.js");
        const texte = (await redigerCommentaireDemande({ descr: l?.descr, local: l?.local, statut: val(l, "statut"), notes, mots: motsConnus(lignes, utilisateurs) })).replace(/\*\*/g, "").trim();
        const { proposerIA } = await import("./ia-suggestion.js");
        if (texte) proposerIA(btn, texte, (v) => { ta.value = v; poser(c, "commentaireTech", v); });
      } catch (err) { console.error(err); import("./ia-suggestion.js").then(m => m.signalerErreurIA(err)); }
      finally { btn.disabled = false; btn.textContent = avant; }
    });
    c.querySelector("[data-dps-auj]")?.addEventListener("click", () => {
      const inp = c.querySelector('[data-dps-champ="dateIntervention"]'); inp.value = aujourdhui(); poser(c, "dateIntervention", inp.value);
    });
    // « Réalisé aujourd'hui » prépare seulement : statut + date du jour, puis on complète et on valide.
    c.querySelector("[data-dps-realise]")?.addEventListener("click", () => {
      c.querySelector('[data-dps-statut="Réalisé"]')?.click();
      const d = c.querySelector('[data-dps-champ="dateIntervention"]');
      if (d && !d.value) { d.value = aujourdhui(); poser(c, "dateIntervention", d.value); }
      c.querySelector('[data-dps-champ="intervenant"]')?.focus();
    });
    c.querySelector("[data-dps-annuler]")?.addEventListener("click", () => { delete st.brouillons[c.dataset.id]; rerender(); });
    c.querySelector("[data-dps-enregistrer]")?.addEventListener("click", async (e) => {
      const l = ligneDe(c.dataset.id), br = st.brouillons[c.dataset.id] || {};
      const champs = {};
      Object.keys(br).forEach(k => { const v = String(br[k] ?? "").trim(); if (v !== (l[k] || "")) champs[k] = v; });
      if (!Object.keys(champs).length) return;
      // Clôture : le commentaire (ce qui a été fait) est obligatoire.
      if (champs.statut === "Réalisé" || champs.statut === "Annulé") {
        const com = String(br.commentaireTech ?? l.commentaireTech ?? "").trim();
        if (com.length < 3 || (l.validation === "REFUSEE" && !("commentaireTech" in champs) && champs.statut)) {
          const ta = c.querySelector('[data-dps-champ="commentaireTech"]');
          ta?.classList.add("dps-obligatoire"); ta?.focus(); ta?.scrollIntoView({ behavior: "smooth", block: "center" });
          const etat = c.querySelector(".dps-etat"); if (etat) { etat.textContent = l.validation === "REFUSEE" && com.length >= 3 ? "✍️ Clôture refusée : complète le commentaire (ce qui a été fait) avant de renvoyer." : champs.statut === "Annulé" ? "✍️ Le commentaire est obligatoire : explique pourquoi la demande est annulée." : "✍️ Le commentaire est obligatoire pour clôturer : écris ce qui a été fait."; etat.className = "dps-etat erreur"; }
          window.toast?.("Commentaire obligatoire pour clôturer la demande.", "error");
          return;
        }
      }
      if (champs.statut === "Réalisé" && !(champs.dateIntervention || l.dateIntervention)) champs.dateIntervention = aujourdhui();
      if (champs.statut === "Réalisé" && perms.isEditor) {
        // Le superviseur indique quel technicien a réalisé l'intervention.
        const sel = c.querySelector('[data-dps-champ="declarePar"]');
        const par = String(br.declarePar ?? sel?.value ?? "").trim();
        if (!par) {
          sel?.classList.add("dps-obligatoire"); sel?.focus();
          const etat = c.querySelector(".dps-etat"); if (etat) { etat.textContent = "👷 Choisis le technicien qui a réalisé l'intervention."; etat.className = "dps-etat erreur"; }
          return;
        }
        Object.assign(champs, { declarePar: par, declareLe: champs.dateIntervention || l.dateIntervention || aujourdhui() });
      }
      if (champs.statut === "Réalisé") {
        if (perms.isEditor) Object.assign(champs, { validation: "OUI", dateValidation: aujourdhui(), validePar: utilisateur });
        else Object.assign(champs, { statut: A_VALIDER, validation: "", declarePar: utilisateur, declareLe: aujourdhui() });
      }
      // Annulation par un technicien : passe aussi par la validation du superviseur.
      if (champs.statut === "Annulé") {
        if (perms.isEditor) Object.assign(champs, { validation: "OUI", dateValidation: aujourdhui(), validePar: utilisateur });
        else Object.assign(champs, { statut: A_VALIDER, validation: "ANNULATION", declarePar: utilisateur, declareLe: aujourdhui() });
      }
      if (champs.statut && perms.isEditor) champs.dateStatut = aujourdhui();
      if ("commentaireTech" in champs) Object.assign(champs, { commentaireTechPar: utilisateur, commentaireTechLe: aujourdhui() });
      e.target.disabled = true;
      const etat = c.querySelector(".dps-etat"); etat.textContent = "⏳ Enregistrement…"; etat.className = "dps-etat";
      try {
        try { await majP(c.dataset.id, champs); }
        catch (err) {
          // Règles Firestore pas encore publiées pour « déclaré par » : on enregistre sans.
          if (!("declarePar" in champs || "commentaireTechPar" in champs) || !/permission/i.test(String(err?.message || err))) throw err;
          delete champs.declarePar; delete champs.declareLe; delete champs.commentaireTechPar; delete champs.commentaireTechLe;
          await majP(c.dataset.id, champs);
        }
        delete st.brouillons[c.dataset.id];
        etat.textContent = champs.statut === "Réalisé" ? "✓ Demande réalisée et validée" : champs.statut === "Annulé" ? "✓ Demande annulée" : champs.statut === A_VALIDER ? (champs.validation === "ANNULATION" ? "✓ Annulation envoyée au superviseur pour validation" : "✓ Envoyée au superviseur pour validation") : "✓ Enregistré"; etat.className = "dps-etat ok";
      } catch (err) {
        console.error("Demande :", err); etat.textContent = "❌ Échec — réessaie"; etat.className = "dps-etat ko"; e.target.disabled = false;
      }
    });
  });
}

export function resetVueSites() { st.site = null; st.focusId = null; st.qSite = ""; }
export function ouvrirSite(nom) { st.site = nom; st.q = ""; st.vuAvant = null; st.focusId = null; }
export function ouvrirDemandeSeule(id, site) { st.site = site; st.q = ""; st.vuAvant = null; st.focusId = id; }

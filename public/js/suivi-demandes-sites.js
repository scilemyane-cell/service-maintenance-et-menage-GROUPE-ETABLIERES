// suivi-demandes-sites.js — Vue « Par site » du Suivi des demandes, pensée
// pour les techniciens sur le terrain (téléphone) : on choisit un site, on
// voit ses demandes en cartes, et on les traite en un geste (statut, date
// d'intervention, intervenant, commentaire, « ✓ Réalisé aujourd'hui »).
import { esc } from "./astreinte-logic.js";
import { watchFavoris, saveFavorisDemandes } from "./favoris-data.js";
import { watchSitesDossiers } from "./site-dossier-data.js";
import { watchAffectationsSites, saveAffectationSite } from "./affectations-sites-data.js";
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
const techsDuSite = (nom) => aff.data[nom] || [];

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
const aujourdhui = () => new Date().toISOString().slice(0, 10);
const joursDepuis = (iso) => { if (!iso) return null; const d = new Date(iso + "T00:00:00"); return isNaN(d) ? null : Math.max(0, Math.round((Date.now() - d) / 86400000)); };
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
const btnIA = () => `<button type="button" class="dps-ia dps-ia-mini" data-ia-champ title="L'IA corrige et met au propre, sans changer le sens">✨ Mettre au propre</button>`;
function formReponseHTML(l, { avecFait }) {
  return `<details class="dps-repondre"><summary>💬 Répondre</summary>
    <div class="dps-repondre-champs"><textarea data-rep-texte data-ia-cible rows="2" placeholder="Ta réponse (question, info, avancement…)"></textarea>${btnIA()}
      <div class="dps-repondre-btns"><button type="button" class="dps-rep-envoyer" data-rep-envoyer="${esc(l.id)}">📨 Envoyer</button>${avecFait ? `<button type="button" class="dps-action-fait" data-rep-fait="${esc(l.id)}">✓ Envoyer et marquer fait</button>` : ""}</div></div></details>`;
}
export function blocActionHTML(l, { perms, uid, utilisateurs = [], ouvert = false }) {
  const peutAttribuer = perms.peutTraiter;
  const estAuteur = uid && l.actionParUid === uid;
  if (l.actionPour && !l.actionFaiteLe) {
    const retard = l.actionEcheance && l.actionEcheance < aujourdhui();
    const peutFaire = l.actionPour === uid || perms.isEditor;
    const peutRepondre = l.actionPour === uid || estAuteur || perms.isEditor;
    return `<div class="dps-action ${retard ? "retard" : ""}">
      <div class="dps-action-haut">
      <div class="dps-action-txt">📌 <b>Action pour ${esc(l.actionPourNom || "?")}</b>${l.actionEcheance ? ` <span class="dps-action-ech">${retard ? "⚠️ en retard — " : ""}avant le ${fr(l.actionEcheance)}</span>` : ""}
        ${l.actionTexte ? `<span class="dps-action-detail">${esc(l.actionTexte)}</span>` : ""}
        <small>Attribuée${l.actionPar ? ` par ${esc(l.actionPar)}` : ""}${l.actionLe ? ` le ${fr(l.actionLe)}` : ""}</small></div>
      <div class="dps-action-btns">
        ${peutFaire ? `<button type="button" class="dps-action-fait" data-act-fait="${esc(l.id)}">✓ Fait</button>` : ""}
        ${peutAttribuer || estAuteur ? `<button type="button" class="dps-action-suppr" data-act-modif title="Modifier l'action">✏️</button>` : ""}
        ${peutAttribuer ? `<button type="button" class="dps-action-suppr" data-act-retirer="${esc(l.id)}" title="Retirer l'action">✕</button>` : ""}
      </div></div>
      ${peutAttribuer || estAuteur ? `<div class="dps-action-champs dps-action-edit" hidden>
        <label>Pour<select data-edit-pour>${utilisateurs.map(u => `<option value="${esc(u.uid)}" ${u.uid === l.actionPour ? "selected" : ""}>${esc(u.nom || u.email)}</option>`).join("")}${utilisateurs.some(u => u.uid === l.actionPour) ? "" : `<option value="${esc(l.actionPour)}" selected>${esc(l.actionPourNom || "?")}</option>`}</select></label>
        <label>Avant le<input type="date" data-edit-ech value="${esc(l.actionEcheance || "")}"></label>
        <label class="large">Action à faire<input data-edit-texte data-ia-cible value="${esc(l.actionTexte || "")}">${btnIA()}</label>
        <button type="button" class="dps-action-ok" data-act-enregistrer="${esc(l.id)}">💾 Enregistrer la modification</button>
      </div>` : ""}
      ${filHTML(l)}
      ${peutRepondre ? formReponseHTML(l, { avecFait: peutFaire }) : ""}
    </div>`;
  }
  const faite = l.actionPour && l.actionFaiteLe ? `<div class="dps-action faite">✓ Action faite par ${esc(l.actionFaitePar || l.actionPourNom || "")} le ${fr(l.actionFaiteLe)}${l.actionTexte ? ` — ${esc(l.actionTexte)}` : ""}${filHTML(l)}</div>` : "";
  if (!peutAttribuer) return faite;
  return `${faite}<details class="dps-action-form" ${ouvert ? "open" : ""}><summary>📌 Attribuer une action à quelqu'un</summary>
    <div class="dps-action-champs">
      <label>Pour<select data-act-pour><option value="">— choisir —</option>${utilisateurs.map(u => `<option value="${esc(u.uid)}">${esc(u.nom || u.email)}</option>`).join("")}</select></label>
      <label>Avant le<input type="date" data-act-ech></label>
      <label class="large">Action à faire<input data-act-texte data-ia-cible placeholder="ex. Commander le mitigeur, rappeler le fournisseur…">${btnIA()}</label>
      <div class="large">${phrasesHTML("actions", perms.isEditor)}</div>
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
  const notif = (id) => ligne(id).actionParUid && ligne(id).actionParUid !== uid ? { actionReponseNonLue: true } : { actionNonLuPour: true };
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
      const t = (await redigerCommentaireDemande({ descr: l.descr, notes })).replace(/\*\*/g, "").trim();
      if (t) champ.value = t;
    } catch (err) { console.error(err); alert("IA indisponible : " + (err?.message || err)); }
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
    const champs = { actionTexte: texte, actionEcheance: ech };
    if (pour !== l.actionPour) Object.assign(champs, { actionPour: pour, actionPourNom: u?.nom || u?.email || "", actionNonLuPour: true });
    const modifs = [texte !== l.actionTexte && "action", ech !== (l.actionEcheance || "") && "échéance", pour !== l.actionPour && `personne (${champs.actionPourNom})`].filter(Boolean);
    if (!modifs.length) { f.hidden = true; return; }
    champs.actionFil = ajoutFil(id, `Action modifiée : ${modifs.join(", ")}`);
    b.disabled = true;
    try { await maj(id, champs); } catch (e) { console.error(e); alert("Échec : " + (e?.message || e)); b.disabled = false; }
  }));
  container.querySelectorAll("[data-act-fait]").forEach(b => b.addEventListener("click", async () => {
    b.disabled = true; b.textContent = "⏳";
    const id = b.dataset.actFait;
    try { await maj(id, { actionFaiteLe: aujourdhui(), actionFaitePar: utilisateur, actionFil: ajoutFil(id, "Action faite", true), actionReponseNonLue: true }); }
    catch (e) { console.error(e); alert("Échec : " + (e?.message || e)); b.disabled = false; b.textContent = "✓ Fait"; }
  }));
  const envoyer = async (b, fait) => {
    const zone = b.closest(".dps-repondre"), ta = zone.querySelector("[data-rep-texte]"), texte = ta.value.trim();
    const id = b.dataset.repEnvoyer || b.dataset.repFait;
    if (!texte && !fait) { ta.focus(); return; }
    b.disabled = true;
    const champs = { actionFil: ajoutFil(id, texte || "Action faite", fait), ...notif(id) };
    if (fait) Object.assign(champs, { actionFaiteLe: aujourdhui(), actionFaitePar: utilisateur, actionReponseNonLue: true });
    try { await maj(id, champs); }
    catch (e) { console.error(e); alert("Échec : " + (e?.message || e)); b.disabled = false; }
  };
  container.querySelectorAll("[data-rep-envoyer]").forEach(b => b.addEventListener("click", () => envoyer(b, false)));
  container.querySelectorAll("[data-rep-fait]").forEach(b => b.addEventListener("click", () => envoyer(b, true)));
  container.querySelectorAll("[data-rep-vu]").forEach(b => b.addEventListener("click", async () => {
    b.disabled = true;
    try { await maj(b.dataset.repVu, { actionReponseNonLue: false }); } catch (e) { console.error(e); b.disabled = false; }
  }));
  container.querySelectorAll("[data-act-retirer]").forEach(b => b.addEventListener("click", async () => {
    if (!confirm("Retirer cette action ?")) return;
    try { await maj(b.dataset.actRetirer, { actionPour: "", actionPourNom: "", actionTexte: "", actionEcheance: "", actionPar: "", actionParUid: "", actionLe: "", actionFaiteLe: "", actionFaitePar: "", actionFil: [], actionReponseNonLue: false, actionNonLuPour: false }); }
    catch (e) { console.error(e); alert("Échec : " + (e?.message || e)); }
  }));
  container.querySelectorAll("[data-act-attribuer]").forEach(b => b.addEventListener("click", async () => {
    const f = b.closest(".dps-action-form");
    const pour = f.querySelector("[data-act-pour]").value, texte = f.querySelector("[data-act-texte]").value.trim(), ech = f.querySelector("[data-act-ech]").value;
    if (!pour) { alert("Choisis la personne."); return; }
    if (!texte) { alert("Décris l'action à faire."); f.querySelector("[data-act-texte]").focus(); return; }
    const u = utilisateurs.find(x => x.uid === pour);
    b.disabled = true; b.textContent = "⏳";
    try { await maj(b.dataset.actAttribuer, { actionPour: pour, actionPourNom: u?.nom || u?.email || "", actionTexte: texte, actionEcheance: ech, actionPar: utilisateur, actionParUid: uid || "", actionLe: aujourdhui(), actionFaiteLe: "", actionFaitePar: "", actionFil: [], actionReponseNonLue: false, actionNonLuPour: false }); }
    catch (e) { console.error(e); alert("Échec : " + (e?.message || e)); b.disabled = false; b.textContent = "📌 Attribuer"; }
  }));
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

const st = { site: null, q: "", association: "", voirTraitees: false, brouillons: {}, tech: "" };
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

export function renderParSite(container, lignes, { toggleHTML, onToggle, perms, maj, utilisateur = "", uid = null, utilisateurs = [], apres = null, favLectureSeule = false }) {
  suivreFavoris(uid);
  suivreAffectations();
  suivrePhrases();
  if (!lignes) { container.innerHTML = `<div class="stack">${toggleHTML}<div class="hint">Chargement des demandes…</div></div>`; onToggle(); return; }
  const rerender = () => renderParSite(container, lignes, { toggleHTML, onToggle, perms, maj, utilisateur, uid, utilisateurs, apres, favLectureSeule });
  fav.rerender = () => { if (container.isConnected && !st.site) rerender(); };
  aff.rerender = () => { if (container.isConnected) rerender(); };
  phr.rerender = () => { if (container.isConnected && st.site) rerender(); };
  // Personnes à qui l'on peut confier un site : techniciens d'abord, puis superviseurs / admins.
  const ORDRE_ROLE = { technicien: 0, n1: 1, admin: 2, super_admin: 3 };
  const accesTerrain = (u) => ["menage", "mi_temps"].includes(u.role) && (u.permissions || {})["suivi-demandes"] === "write";
  const techs = utilisateurs.filter(u => u.role in ORDRE_ROLE || accesTerrain(u))
    .sort((a, b) => ((ORDRE_ROLE[a.role] ?? 0) - (ORDRE_ROLE[b.role] ?? 0)) || String(a.nom || a.email).localeCompare(String(b.nom || b.email), "fr"));
  const nomDe = (id) => { const u = utilisateurs.find(x => x.uid === id); return u ? (u.nom || u.email) : ""; };
  const estTech = perms.isTech && !perms.isEditor;
  const q = sa(st.q.trim());
  const carteValidation = (l) => `
    <article class="dps-carte a-valider" data-id="${esc(l.id)}">
      <div class="dps-carte-tete"><span class="dps-num">${esc(l.n)}</span>${badgeUrg(l.urgence)}<span class="dps-local">🏠 ${esc(l.site)}</span>${l.local ? `<span class="dps-local">📍 ${esc(l.local)}</span>` : ""}</div>
      <p class="dps-descr">${esc(l.descr) || "<i>Sans descriptif</i>"}</p>
      <div class="dps-lecture">
        <span>Réalisée le <b>${fr(l.dateIntervention) || "—"}</b>${l.intervenant ? ` · intervenant : <b>${esc(l.intervenant)}</b>` : ""}</span>
        ${l.declarePar ? `<span>Déclarée par <b>${esc(l.declarePar)}</b>${l.declareLe ? ` le ${fr(l.declareLe)}` : ""}</span>` : ""}
        ${l.commentaireTech ? `<span class="dps-com-lu">« ${esc(l.commentaireTech)} »${l.commentaireTechPar ? ` <small>— ${esc(l.commentaireTechPar)}</small>` : ""}</span>` : `<span class="dps-com-lu vide">Pas de commentaire</span>`}
      </div>
      ${perms.isEditor ? `<div class="dps-actions">
        <button type="button" class="dps-enregistrer valider" data-dps-valider>✓ Valider</button>
        <button type="button" class="dps-annuler" data-dps-refuser>↩ Refuser</button>
      </div>` : `<span class="dps-pastille valid">⏳ En attente du superviseur</span>`}
      <div class="dps-etat" aria-live="polite"></div>
    </article>`;
  const brancherValidation = () => container.querySelectorAll(".dps-carte.a-valider").forEach(c => {
    const etat = c.querySelector(".dps-etat");
    c.querySelector("[data-dps-valider]")?.addEventListener("click", async (e) => {
      e.target.disabled = true; etat.textContent = "⏳ Validation…";
      try { await maj(c.dataset.id, { statut: "Réalisé", validation: "OUI", dateValidation: aujourdhui(), validePar: utilisateur, dateStatut: aujourdhui() }); etat.textContent = "✓ Validée"; etat.className = "dps-etat ok"; }
      catch (err) { console.error(err); etat.textContent = "❌ Échec — réessaie"; etat.className = "dps-etat ko"; e.target.disabled = false; }
    });
    c.querySelector("[data-dps-refuser]")?.addEventListener("click", async () => {
      const motif = prompt("Motif du refus (sera ajouté au commentaire) :", "");
      if (motif === null) return;
      const l = lignes.find(x => x.id === c.dataset.id);
      const com = [l?.commentaireTech, `[Refusé le ${fr(aujourdhui())}${utilisateur ? " par " + utilisateur : ""}${motif.trim() ? " : " + motif.trim() : ""}]`].filter(Boolean).join("\n");
      etat.textContent = "⏳ …";
      try { await maj(c.dataset.id, { statut: "Pris en compte", commentaireTech: com, dateStatut: aujourdhui() }); etat.textContent = "↩ Renvoyée au technicien"; etat.className = "dps-etat ok"; }
      catch (err) { console.error(err); etat.textContent = "❌ Échec — réessaie"; etat.className = "dps-etat ko"; }
    });
  });
  const filtreAssoc = (l) => !st.association || l.association === st.association;

  // ---------- Liste des sites ----------
  if (!st.site) {
    const vu = lireVu(uid);
    const parSite = {};
    lignes.filter(filtreAssoc).forEach(l => {
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
          <p>Choisis un site pour voir et traiter ses demandes.</p></div>
        <div class="dps-hero-chiffres"><div><b>${totOuv}</b><span>à traiter</span></div><div class="urg"><b>${totUrg}</b><span>urgentes</span></div><div><b>${affiches.length}</b><span>sites</span></div></div>
      </section>
      ${perms.isEditor ? (() => { const av = lignes.filter(l => EN_ATTENTE_VALID(l.statut)).sort((a, b) => (a.dateIntervention || "").localeCompare(b.dateIntervention || "")); return av.length ? `
      <section class="dps-valid-bloc">
        <div class="dps-valid-tete"><h3>⏳ ${av.length} demande${av.length > 1 ? "s" : ""} à valider</h3><p>Déclarées réalisées par les techniciens — vérifie et valide.</p></div>
        <div class="dps-cartes">${av.map(l => carteValidation(l)).join("")}</div>
      </section>` : ""; })() : ""}
      <div class="dps-barre">
        <label class="dps-recherche"><span>🔎</span><input id="dps-q" type="search" placeholder="Rechercher un site…" value="${esc(st.q)}"></label>
        <div class="dps-seg">${[["", "Toutes"], ["Agropolis", "Agropolis"], ["École", "École"], ["Armonia", "Armonia"]].map(([k, l]) => `<button data-dps-asso="${esc(k)}" class="${st.association === k ? "on" : ""}">${l}</button>`).join("")}</div>
        ${!estTech && techs.length ? `<label class="dps-tech-filtre">👷<select id="dps-tech"><option value="">Tous les techniciens</option>${techs.map(t => `<option value="${esc(t.uid)}" ${st.tech === t.uid ? "selected" : ""}>${esc(t.nom || t.email)} (${(n => `${n} site${n > 1 ? "s" : ""}`)(Object.values(aff.data).filter(l => l.includes(t.uid)).length)})</option>`).join("")}</select></label>` : ""}
        <label class="dps-case"><input type="checkbox" id="dps-traitees" ${st.voirTraitees ? "checked" : ""}> Sites sans demande en attente</label>
      </div>
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
    container.querySelector("#dps-tech")?.addEventListener("change", (e) => { st.tech = e.target.value; rerender(); });
    container.querySelector("#dps-traitees")?.addEventListener("change", (e) => { st.voirTraitees = e.target.checked; rerender(); });
    container.querySelectorAll("[data-dps-fav]").forEach(b => b.addEventListener("click", (e) => { e.stopPropagation(); basculerFavori(b.dataset.dpsFav); }));
    container.querySelectorAll("[data-dps-site]").forEach(b => b.addEventListener("click", () => { st.site = b.dataset.dpsSite; st.q = ""; st.vuAvant = null; rerender(); container.scrollIntoView({ block: "start" }); }));
    brancherValidation();
    apres?.();
    return;
  }

  // ---------- Demandes d'un site ----------
  // À l'ouverture du site : on garde l'ancienne date de consultation pour
  // afficher les « 🆕 », puis on note le site comme vu.
  if (st.vuAvant == null || st.vuSite !== st.site) { const v = lireVu(uid); st.vuAvant = v.sites[st.site] || v.base; st.vuSite = st.site; marquerSiteVu(uid, st.site); }
  const duSite = lignes.filter(l => l.site === st.site);
  const enValidation = duSite.filter(l => EN_ATTENTE_VALID(l.statut));
  const ouvertes = duSite.filter(l => A_TRAITER(l.statut)).sort((a, b) => ((ORDRE_URG[a.urgence] ?? 9) - (ORDRE_URG[b.urgence] ?? 9)) || (a.date || "").localeCompare(b.date || ""));
  const traitees = duSite.filter(l => TRAITE(l.statut)).sort((a, b) => (b.dateIntervention || b.dateStatut || b.date || "").localeCompare(a.dateIntervention || a.dateStatut || a.date || ""));
  const carte = (l) => {
    const j = joursDepuis(l.date);
    return `
    <article class="dps-carte ${TRAITE(l.statut) ? "traitee" : ""} u-${sa(l.urgence).replace(/[^a-z]/g, "")}" data-id="${esc(l.id)}">
      <div class="dps-carte-tete">
        <span class="dps-num">${esc(l.n)}</span>${estNouvelle(l, st.vuAvant) ? `<span class="dps-pastille nouv">🆕 Nouvelle</span>` : ""}${badgeUrg(l.urgence)}${badgeAge(TRAITE(l.statut) ? null : j)}
        ${l.local ? `<span class="dps-local">📍 ${esc(l.local)}</span>` : ""}
        ${l.logementOccupe && sa(l.logementOccupe).startsWith("oui") ? `<span class="dps-occ">🏠 Logement occupé</span>` : ""}
      </div>
      <p class="dps-descr">${esc(l.descr) || "<i>Sans descriptif</i>"}</p>
      <div class="dps-meta">${l.date ? `Demandé le ${fr(l.date)}` : ""}${l.demandeur ? ` par <b>${esc(l.demandeur)}</b>` : ""}${l.type ? ` · ${esc(l.type)}` : ""}</div>
      ${perms.peutTraiter ? `
      <div class="dps-statuts" role="group" aria-label="Statut">
        ${STATUTS_RAPIDES.map(s => `<button type="button" class="dps-st ${val(l, "statut") === s ? "on" : ""} ${s === "Réalisé" ? "ok" : s === "Annulé" ? "ko" : ""}" data-dps-statut="${esc(s)}">${esc(s)}</button>`).join("")}
      </div>
      <div class="dps-champs">
        ${perms.isEditor ? `<label>Intervenant<select data-dps-champ="categorieIntervenant">${["", "Interne SG", "Externe SG", "Interne site", "Externe site"].map(o => `<option value="${o}" ${o === val(l, "categorieIntervenant") ? "selected" : ""}>${o || "—"}</option>`).join("")}</select></label>` : ""}
        <label>Contact / entreprise<input data-dps-champ="intervenant" value="${esc(val(l, "intervenant"))}" placeholder="ex. Ronald, Écol'eau…"></label>
        <label>Date d'intervention<span class="dps-date"><input type="date" data-dps-champ="dateIntervention" value="${esc(val(l, "dateIntervention"))}"><button type="button" class="dps-auj" data-dps-auj title="Mettre la date du jour">Aujourd'hui</button></span></label>
        <label class="dps-com">Commentaire<textarea data-dps-champ="commentaireTech" rows="2" placeholder="Ce qui a été fait, pièce à commander…">${esc(val(l, "commentaireTech"))}</textarea>${l.commentaireTech && l.commentaireTechPar ? `<small class="dps-com-auteur">✍️ ${esc(l.commentaireTechPar)}${l.commentaireTechLe ? ` · ${fr(l.commentaireTechLe)}` : ""}</small>` : ""}${phrasesHTML("commentaires", perms.isEditor)}<button type="button" class="dps-ia" data-dps-ia title="L'IA corrige et met au propre tes notes, sans rien inventer">✨ Mettre au propre</button></label>
      </div>
      <div class="dps-actions">
        ${!TRAITE(l.statut) && val(l, "statut") !== "Réalisé" ? `<button type="button" class="dps-realise-prep" data-dps-realise>${perms.isEditor ? "✓ Réalisé aujourd'hui" : "✓ Intervention terminée"}</button>` : ""}
        <button type="button" class="dps-enregistrer ${val(l, "statut") === "Réalisé" && !TRAITE(l.statut) ? "valider" : ""}" data-dps-enregistrer ${aChange(l) ? "" : "hidden"}>${val(l, "statut") === "Réalisé" && !TRAITE(l.statut) ? (perms.isEditor ? "✓ Valider la réalisation" : "📨 Envoyer pour validation") : "💾 Enregistrer"}</button>
        ${aChange(l) ? `<button type="button" class="dps-annuler" data-dps-annuler>Annuler</button>` : ""}
      </div>
      ${val(l, "statut") === "Réalisé" && !TRAITE(l.statut) ? `<p class="dps-aide">${perms.isEditor ? "Vérifie la date, le contact et le commentaire, puis valide." : "Complète le contact et le commentaire, puis envoie au superviseur."}</p>` : ""}
      ` : `
      <div class="dps-lecture"><span>Statut : <b>${esc(l.statut)}</b></span>${l.intervenant ? `<span>Contact : <b>${esc(l.intervenant)}</b></span>` : ""}${l.dateIntervention ? `<span>Intervention : <b>${fr(l.dateIntervention)}</b></span>` : ""}${l.commentaireTech ? `<span>${esc(l.commentaireTech)}${l.commentaireTechPar ? ` <small>— ${esc(l.commentaireTechPar)}</small>` : ""}</span>` : ""}</div>`}
      ${blocActionHTML(l, { perms, uid, utilisateurs })}
      <div class="dps-etat" aria-live="polite"></div>
    </article>`;
  };
  container.innerHTML = `
  <div class="stack dps">
    ${toggleHTML}
    <div class="dps-site-entete">
      <button class="dps-retour" id="dps-retour">← Tous les sites</button>
      <div><h2>${esc(st.site)}</h2><p>${ouvertes.length} à traiter${enValidation.length ? ` · ${enValidation.length} à valider` : ""} · ${traitees.length} traitée${traitees.length > 1 ? "s" : ""}</p></div>
    </div>
    ${perms.isEditor && techs.length ? `<div class="dps-affect"><span>👷 Technicien(s) du site :</span>${techs.map(t => `<button type="button" class="dps-affect-tech ${techsDuSite(st.site).includes(t.uid) ? "on" : ""}" data-affect="${esc(t.uid)}">${techsDuSite(st.site).includes(t.uid) ? "✓ " : ""}${esc(t.nom || t.email)}</button>`).join("")}</div>`
      : techsDuSite(st.site).length ? `<div class="dps-affect"><span>👷 ${esc(techsDuSite(st.site).map(nomDe).filter(Boolean).join(", "))}</span></div>` : ""}
    ${enValidation.length ? `<section class="dps-valid-bloc"><div class="dps-valid-tete"><h3>⏳ ${enValidation.length} en attente de validation</h3><p>${perms.isEditor ? "Déclarées réalisées par les techniciens — vérifie et valide." : "Envoyées au superviseur pour validation."}</p></div><div class="dps-cartes">${enValidation.map(l => carteValidation(l)).join("")}</div></section>` : ""}
    ${ouvertes.length ? `<div class="dps-cartes">${ouvertes.map(carte).join("")}</div>` : `<div class="dps-vide">✓ Aucune demande à traiter sur ce site.</div>`}
    ${traitees.length ? `<details class="dps-historique"><summary>Historique : ${traitees.length} demande${traitees.length > 1 ? "s" : ""} traitée${traitees.length > 1 ? "s" : ""}</summary><div class="dps-cartes">${traitees.slice(0, 40).map(carte).join("")}</div></details>` : ""}
  </div>`;
  onToggle();
  container.querySelector("#dps-retour").addEventListener("click", () => { st.site = null; rerender(); });
  brancherValidation();
  brancherActions(container, { lignes, maj, utilisateur, utilisateurs, uid });
  apres?.();
  container.querySelectorAll("[data-affect]").forEach(b => b.addEventListener("click", async () => {
    const actuels = techsDuSite(st.site), id = b.dataset.affect;
    const nouveaux = actuels.includes(id) ? actuels.filter(x => x !== id) : [...actuels, id];
    b.disabled = true;
    try { await saveAffectationSite(st.site, nouveaux); }
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
      if (b.dataset.dpsStatut === "Réalisé") {
        const d = c.querySelector('[data-dps-champ="dateIntervention"]');
        if (d && !d.value) { d.value = aujourdhui(); poser(c, "dateIntervention", d.value); }
        c.querySelector('[data-dps-champ="commentaireTech"]')?.focus();
      }
    }));
    c.querySelectorAll("[data-dps-champ]").forEach(inp => inp.addEventListener("input", () => poser(c, inp.dataset.dpsChamp, inp.value)));
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
        const texte = (await redigerCommentaireDemande({ descr: l?.descr, local: l?.local, statut: val(l, "statut"), notes })).replace(/\*\*/g, "").trim();
        if (texte) { ta.value = texte; poser(c, "commentaireTech", texte); }
      } catch (err) { console.error(err); alert("IA indisponible : " + (err?.message || err)); }
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
      if (champs.statut === "Réalisé" && !(champs.dateIntervention || l.dateIntervention)) champs.dateIntervention = aujourdhui();
      if (champs.statut === "Réalisé") {
        if (perms.isEditor) Object.assign(champs, { validation: "OUI", dateValidation: aujourdhui(), validePar: utilisateur });
        else Object.assign(champs, { statut: A_VALIDER, declarePar: utilisateur, declareLe: aujourdhui() });
      }
      if (champs.statut && perms.isEditor) champs.dateStatut = aujourdhui();
      if ("commentaireTech" in champs) Object.assign(champs, { commentaireTechPar: utilisateur, commentaireTechLe: aujourdhui() });
      e.target.disabled = true;
      const etat = c.querySelector(".dps-etat"); etat.textContent = "⏳ Enregistrement…"; etat.className = "dps-etat";
      try {
        try { await maj(c.dataset.id, champs); }
        catch (err) {
          // Règles Firestore pas encore publiées pour « déclaré par » : on enregistre sans.
          if (!("declarePar" in champs || "commentaireTechPar" in champs) || !/permission/i.test(String(err?.message || err))) throw err;
          delete champs.declarePar; delete champs.declareLe; delete champs.commentaireTechPar; delete champs.commentaireTechLe;
          await maj(c.dataset.id, champs);
        }
        delete st.brouillons[c.dataset.id];
        etat.textContent = champs.statut === "Réalisé" ? "✓ Demande réalisée et validée" : champs.statut === A_VALIDER ? "✓ Envoyée au superviseur pour validation" : "✓ Enregistré"; etat.className = "dps-etat ok";
      } catch (err) {
        console.error("Demande :", err); etat.textContent = "❌ Échec — réessaie"; etat.className = "dps-etat ko"; e.target.disabled = false;
      }
    });
  });
}

export function resetVueSites() { st.site = null; }
export function ouvrirSite(nom) { st.site = nom; st.q = ""; st.vuAvant = null; }

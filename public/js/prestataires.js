// prestataires.js — Suivi des demandes › 🏢 Prestataires (superviseurs)
// Une vraie page de gestion des entreprises extérieures : la liste à gauche,
// la fiche à droite (coordonnées, notes, demandes à faire, à valider,
// historique), confier une demande, imprimer / envoyer la liste par mail.
import { esc } from "./astreinte-logic.js";
import { abonnerEntreprises, entreprises, entreprisesPretes, saveEntreprises, cleEntreprise as cle } from "./entreprises-data.js";
import { imprimerListe } from "./demandes-impression.js";

const fr = (x) => (x ? String(x).slice(0, 10).split("-").reverse().join("/") : "");
const aujourdhui = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const jours = (d) => d ? Math.max(0, Math.floor((Date.now() - new Date(String(d).slice(0, 10) + "T00:00:00").getTime()) / 864e5)) : null;
const TRAITE = (s) => s === "Réalisé" || s === "Annulé";
const A_VALIDER = (s) => /à valider/i.test(s || "");
const ORDRE_URG = { Critique: 0, Urgent: 1, "À planifier": 2, Normal: 3 };
const STATUTS = ["Pris en compte", "Intervenant sollicité", "Demande de devis", "Planifié", "Commande en cours"];
const sa = (x) => String(x || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const urgCls = (u) => u === "Critique" ? "crit" : u === "Urgent" ? "urg" : u === "À planifier" ? "plan" : u === "Normal" ? "norm" : "nr";
const RETARD_J = 30;

const pst = { sel: null, q: "", qDem: "", edition: false, nouveau: false, onglet: "afaire", abonne: false, rerender: null, mobileFiche: false };

// Demande de l'entreprise : attribuée à elle, ou (anciennes) contact « Externe » à son nom.
const estDe = (l, nom) => !l.lieeA && (l.attribueA === "ext" ? cle(l.attribueANom) === cle(nom) : !l.attribueA && /externe/i.test(l.categorieIntervenant || "") && cle(l.intervenant) === cle(nom));
const depuis = (l) => jours(l.attribueLe || l.date);

function bilan(lignes, e) {
  const toutes = lignes.filter(l => estDe(l, e.nom));
  const aFaire = toutes.filter(l => !TRAITE(l.statut) && !A_VALIDER(l.statut))
    .sort((a, b) => ((ORDRE_URG[a.urgence] ?? 9) - (ORDRE_URG[b.urgence] ?? 9)) || (depuis(b) ?? 0) - (depuis(a) ?? 0));
  const faites = toutes.filter(l => l.statut === "Réalisé").sort((a, b) => (b.dateIntervention || b.dateStatut || "").localeCompare(a.dateIntervention || a.dateStatut || ""));
  const moisCourant = aujourdhui().slice(0, 7);
  return { e, aFaire, enValid: toutes.filter(l => A_VALIDER(l.statut)), faites, retard: aFaire.filter(l => (depuis(l) ?? 0) > RETARD_J).length,
    faitesMois: faites.filter(l => (l.dateIntervention || l.dateStatut || "").slice(0, 7) === moisCourant).length };
}

function texteMail(b) {
  const l = b.aFaire.map(x => `- ${x.n} · ${x.site}${x.local ? ` (${x.local})` : ""} : ${x.descr || ""}${x.urgence && !/non/i.test(x.urgence) ? ` [${x.urgence}]` : ""}`);
  let liste = "", n = 0;
  for (const x of l) { if (liste.length + x.length > 1500) break; liste += x + "\n"; n++; }
  if (n < l.length) liste += `… et ${l.length - n} autre(s) (voir le récapitulatif joint).\n`;
  return `Bonjour${b.e.contact ? ` ${b.e.contact}` : ""},\n\nVoici les demandes d'intervention en cours qui vous sont confiées par le Groupe Établières (${b.aFaire.length}) :\n\n${liste}\nMerci de nous indiquer vos dates de passage.\n\nCordialement,\nService Maintenance — Groupe Établières`;
}

export function renderPrestataires(container, lignes, { toggleHTML, onToggle, maj, utilisateur = "", ouvrirDemande, rafraichir = null }) {
  if (!pst.abonne) { pst.abonne = true; abonnerEntreprises(() => pst.rerender?.()); }
  // Toujours redessiner avec les demandes à jour (rafraichir relit l'état de l'appli).
  const rerender = rafraichir || (() => renderPrestataires(container, lignes, { toggleHTML, onToggle, maj, utilisateur, ouvrirDemande }));
  pst.rerender = () => { if (container.isConnected && container.querySelector(".pst")) rerender(); };
  if (!lignes || !entreprisesPretes()) { container.innerHTML = `<div class="stack">${toggleHTML}<div class="hint">Chargement des prestataires…</div></div>`; onToggle(); return; }

  const liste = entreprises();
  const bilans = liste.map(e => bilan(lignes, e));
  // Noms utilisés sur les demandes mais absents de la liste.
  const absents = new Map();
  lignes.forEach(l => {
    const n = l.attribueA === "ext" ? l.attribueANom : (!l.attribueA && /externe/i.test(l.categorieIntervenant || "") ? l.intervenant : "");
    const k = cle(n); if (k.length < 3 || liste.some(e => cle(e.nom) === k)) return;
    const a = absents.get(k) || { nom: String(n).trim(), n: 0, ouvertes: 0 }; a.n++; if (!TRAITE(l.statut)) a.ouvertes++; absents.set(k, a);
  });
  const aAjouter = [...absents.values()].sort((a, b) => b.ouvertes - a.ouvertes || b.n - a.n);
  if (pst.sel && !liste.some(e => e.nom === pst.sel) && !pst.nouveau) pst.sel = null;
  if (!pst.sel && !pst.nouveau && bilans.length) pst.sel = [...bilans].sort((a, b) => b.aFaire.length - a.aFaire.length)[0].e.nom;
  const q = sa(pst.q.trim());
  const visibles = bilans.filter(b => !q || sa(`${b.e.nom} ${b.e.metier} ${b.e.contact}`).includes(q))
    .sort((a, b) => (b.aFaire.length - a.aFaire.length) || a.e.nom.localeCompare(b.e.nom, "fr"));
  const tot = { afaire: bilans.reduce((t, b) => t + b.aFaire.length, 0), retard: bilans.reduce((t, b) => t + b.retard, 0), valid: bilans.reduce((t, b) => t + b.enValid.length, 0), mois: bilans.reduce((t, b) => t + b.faitesMois, 0) };
  const courant = pst.nouveau ? null : bilans.find(b => b.e.nom === pst.sel);

  const carteEnt = (b) => `
    <button type="button" class="pst-item ${b.e.nom === pst.sel && !pst.nouveau ? "on" : ""}" data-pst-sel="${esc(b.e.nom)}">
      <span class="pst-av">${esc(b.e.nom.slice(0, 1).toUpperCase())}</span>
      <span class="pst-item-txt"><b>${esc(b.e.nom)}</b><small>${esc(b.e.metier || "—")}</small></span>
      <span class="pst-item-n ${b.aFaire.length ? "" : "zero"}">${b.aFaire.length}${b.retard ? `<i title="${b.retard} en attente depuis plus de ${RETARD_J} jours">⏳${b.retard}</i>` : ""}</span>
    </button>`;

  const formHTML = (e) => `
    <form class="pst-form" id="pst-form">
      <div class="pst-form-g">
        <label class="large">Nom de la société *<input name="nom" required value="${esc(e.nom || "")}" placeholder="ex. SARL Plomberie Martin"></label>
        <label>Contact (personne)<input name="contact" value="${esc(e.contact || "")}" placeholder="ex. M. Martin"></label>
        <label>Métier / descriptif<input name="metier" value="${esc(e.metier || "")}" placeholder="ex. Plomberie, chauffage"></label>
        <label>Téléphone<input name="tel" type="tel" value="${esc(e.tel || "")}" placeholder="06…"></label>
        <label>Mail<input name="email" type="email" value="${esc(e.email || "")}" placeholder="contact@…"></label>
        <label class="large">Notes <small>(contrat, tarifs, horaires, accès…)</small><textarea name="notes" rows="3">${esc(e.notes || "")}</textarea></label>
      </div>
      <div class="pst-form-btns">${pst.nouveau || pst.edition ? `<button type="button" class="dps-annuler" data-pst-annuler>Annuler</button>` : ""}<button type="submit" class="dps-enregistrer">${pst.nouveau ? "➕ Créer le prestataire" : "💾 Enregistrer"}</button></div>
      <div class="pst-etat" aria-live="polite"></div>
    </form>`;

  const ligneDem = (l, mode) => {
    const j = depuis(l);
    return `<article class="pst-dem ${mode === "afaire" && (j ?? 0) > RETARD_J ? "retard" : ""}" data-id="${esc(l.id)}">
      <div class="pst-dem-tete"><span class="dps-num">${esc(l.n)}</span><span class="dps-urg ${urgCls(l.urgence)}">${esc(l.urgence)}</span><b>${esc(l.site)}</b>${l.local ? `<span class="pst-loc">📍 ${esc(l.local)}</span>` : ""}
        ${mode === "afaire" && j !== null ? `<span class="pst-age ${j > RETARD_J ? "vieux" : ""}">${l.attribueLe ? "confiée" : "demandée"} il y a ${j} j</span>` : ""}
        ${mode === "faites" ? `<span class="pst-age ok">✓ ${fr(l.dateIntervention || l.dateStatut)}</span>` : ""}</div>
      <p>${esc(l.descr || "") || "<i>Sans descriptif</i>"}</p>
      ${l.commentaireTech ? `<small class="pst-com">💬 ${esc(l.commentaireTech)}</small>` : ""}
      <div class="pst-dem-act">
        ${mode === "afaire" ? `<select data-pst-statut="${esc(l.id)}" title="Avancement">${[...new Set([...STATUTS, l.statut])].filter(s => s && s !== "Non renseigné").map(s => `<option ${s === l.statut ? "selected" : ""}>${esc(s)}</option>`).join("")}${!l.statut || l.statut === "Non renseigné" ? `<option selected value="">— statut —</option>` : ""}</select>
          <button type="button" class="pst-btn ok" data-pst-fait="${esc(l.id)}">✓ Réalisée</button>
          <button type="button" class="pst-btn" data-pst-retirer="${esc(l.id)}" title="Retirer cette demande au prestataire">✕ Retirer</button>` : ""}
        <button type="button" class="pst-btn lien" data-pst-ouvrir="${esc(l.id)}|${esc(l.site)}">Ouvrir la demande →</button>
      </div>
    </article>`;
  };

  const ficheHTML = () => {
    if (pst.nouveau) return `<div class="pst-fiche"><div class="pst-fiche-tete"><button type="button" class="pst-retour" data-pst-retour>← Liste</button><h3>➕ Nouveau prestataire</h3></div>${formHTML(pst.nouveauInit || {})}</div>`;
    if (!courant) return `<div class="pst-fiche vide"><p>Aucun prestataire pour l'instant.<br>Crée le premier avec « ➕ Nouveau prestataire »${aAjouter.length ? " ou ajoute ceux déjà utilisés dans le fichier" : ""}.</p></div>`;
    const b = courant, e = b.e;
    const qd = sa(pst.qDem.trim());
    const candidats = qd.length >= 2 ? lignes.filter(l => !l.lieeA && !TRAITE(l.statut) && !A_VALIDER(l.statut) && !estDe(l, e.nom) && sa(`${l.n} ${l.site} ${l.local} ${l.descr}`).includes(qd)).slice(0, 12) : [];
    const onglets = [["afaire", `À faire`, b.aFaire.length], ["valid", "À valider", b.enValid.length], ["faites", "Historique", b.faites.length]];
    const contenu = pst.onglet === "valid" ? b.enValid : pst.onglet === "faites" ? b.faites.slice(0, 60) : b.aFaire;
    return `<div class="pst-fiche">
      <div class="pst-fiche-tete">
        <button type="button" class="pst-retour" data-pst-retour>← Liste</button>
        <span class="pst-av grand">${esc(e.nom.slice(0, 1).toUpperCase())}</span>
        <div class="pst-id"><h3>${esc(e.nom)}</h3><p>${esc(e.metier || "Métier non renseigné")}</p></div>
        <div class="pst-outils">
          <button type="button" class="pst-btn" data-pst-modifier>${pst.edition ? "Fermer" : "✏️ Modifier"}</button>
          <button type="button" class="pst-btn" data-pst-imprimer>🖨 Imprimer / PDF</button>
          ${b.aFaire.length ? `<button type="button" class="pst-btn prim" data-pst-mail>✉️ Envoyer la liste</button>` : ""}
        </div>
      </div>
      <div class="pst-coord">
        ${e.contact ? `<span>👤 ${esc(e.contact)}</span>` : ""}
        ${e.tel ? `<a href="tel:${esc(e.tel.replace(/\s/g, ""))}">📞 ${esc(e.tel)}</a>` : `<span class="manque">📞 pas de téléphone</span>`}
        ${e.email ? `<a href="mailto:${esc(e.email)}">✉️ ${esc(e.email)}</a>` : `<span class="manque">✉️ pas de mail</span>`}
      </div>
      ${e.notes && !pst.edition ? `<div class="pst-notes">📝 ${esc(e.notes)}</div>` : ""}
      ${pst.edition ? `${formHTML(e)}<button type="button" class="pst-suppr" data-pst-suppr>🗑 Supprimer ce prestataire</button>` : ""}
      <div class="pst-kpis">
        <div><b>${b.aFaire.length}</b><span>à faire</span></div>
        <div class="${b.retard ? "rouge" : ""}"><b>${b.retard}</b><span>+ de ${RETARD_J} j</span></div>
        <div><b>${b.enValid.length}</b><span>à valider</span></div>
        <div class="vert"><b>${b.faitesMois}</b><span>faites ce mois</span></div>
        <div><b>${b.faites.length}</b><span>faites au total</span></div>
      </div>
      <details class="pst-confier" ${pst.qDem ? "open" : ""}>
        <summary>➕ Lui confier une demande</summary>
        <input id="pst-qdem" type="search" placeholder="N° (SG-623), site, logement ou mot de la demande…" value="${esc(pst.qDem)}">
        ${qd.length >= 2 ? (candidats.length ? `<div class="pst-cand">${candidats.map(l => `<div class="pst-cand-l"><span class="dps-num">${esc(l.n)}</span><span class="t"><b>${esc(l.site)}</b>${l.local ? ` · ${esc(l.local)}` : ""} — ${esc((l.descr || "").slice(0, 90))}${l.attribueANom ? ` <small>(actuellement : ${esc(l.attribueANom)})</small>` : ""}</span><button type="button" class="pst-btn prim" data-pst-confier="${esc(l.id)}">Confier</button></div>`).join("")}</div>` : `<p class="hint">Aucune demande ouverte ne correspond.</p>`) : ""}
      </details>
      <div class="pst-onglets">${onglets.map(([k, lib, n]) => `<button type="button" class="${pst.onglet === k ? "on" : ""}" data-pst-onglet="${k}">${lib} <span>${n}</span></button>`).join("")}</div>
      <div class="pst-dems">${contenu.map(l => ligneDem(l, pst.onglet)).join("") || `<p class="dps-vide">${pst.onglet === "afaire" ? "✓ Rien à faire en ce moment." : pst.onglet === "valid" ? "Rien en attente de validation." : "Pas encore d'intervention réalisée."}</p>`}</div>
    </div>`;
  };

  container.innerHTML = `
  <div class="stack pst ${pst.mobileFiche ? "voir-fiche" : ""}">
    ${toggleHTML}
    <section class="dps-hero">
      <div><span class="dps-sur">Entreprises extérieures</span><h2>Prestataires</h2><p>Ce que chaque entreprise a à faire, ses coordonnées et son historique.</p>
        <button type="button" class="dps-nouvelle" data-pst-nouveau>➕ Nouveau prestataire</button></div>
      <div class="dps-hero-chiffres"><div><b>${liste.length}</b><span>prestataires</span></div><div><b>${tot.afaire}</b><span>à faire</span></div><div class="urg"><b>${tot.retard}</b><span>+ de ${RETARD_J} j</span></div><div><b>${tot.mois}</b><span>faites ce mois</span></div></div>
    </section>
    <div class="pst-grille">
      <aside class="pst-liste">
        <label class="dps-recherche"><span>🔎</span><input id="pst-q" type="search" placeholder="Rechercher un prestataire…" value="${esc(pst.q)}"></label>
        <div class="pst-items">${visibles.map(carteEnt).join("") || `<p class="hint">${liste.length ? "Aucun prestataire ne correspond." : "Aucun prestataire."}</p>`}</div>
        ${aAjouter.length ? `<details class="pst-absents" ${liste.length < 3 ? "open" : ""}><summary>📄 ${aAjouter.length} entreprise${aAjouter.length > 1 ? "s" : ""} du fichier à ajouter</summary>
          <p class="hint">Notées sur des demandes mais pas encore dans ta liste.</p>
          ${aAjouter.slice(0, 30).map(a => `<button type="button" class="pst-absent" data-pst-ajouter="${esc(a.nom)}"><span>${esc(a.nom)}</span><small>${a.ouvertes ? `${a.ouvertes} en cours · ` : ""}${a.n} demande${a.n > 1 ? "s" : ""}</small><b>+ Ajouter</b></button>`).join("")}
        </details>` : ""}
      </aside>
      ${ficheHTML()}
    </div>
  </div>`;
  onToggle();

  // ---------- Événements ----------
  const $ = (s) => container.querySelector(s);
  const etat = (t, ok) => { const el = $(".pst-etat"); if (el) { el.textContent = t; el.className = `pst-etat ${ok ? "ok" : "ko"}`; } };
  let tq = null;
  $("#pst-q")?.addEventListener("input", (e) => { pst.q = e.target.value; clearTimeout(tq); tq = setTimeout(() => { rerender(); const el = $("#pst-q"); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 200); });
  let td = null;
  $("#pst-qdem")?.addEventListener("input", (e) => { pst.qDem = e.target.value; clearTimeout(td); td = setTimeout(() => { rerender(); const el = $("#pst-qdem"); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 250); });
  container.querySelectorAll("[data-pst-sel]").forEach(b => b.addEventListener("click", () => { pst.sel = b.dataset.pstSel; pst.nouveau = false; pst.edition = false; pst.qDem = ""; pst.onglet = "afaire"; pst.mobileFiche = true; rerender(); if (innerWidth < 900) $(".pst-fiche")?.scrollIntoView({ block: "start" }); }));
  container.querySelectorAll("[data-pst-retour]").forEach(b => b.addEventListener("click", () => { pst.mobileFiche = false; pst.nouveau = false; rerender(); }));
  $("[data-pst-nouveau]")?.addEventListener("click", () => { pst.nouveau = true; pst.nouveauInit = {}; pst.edition = false; pst.mobileFiche = true; rerender(); $("#pst-form [name=nom]")?.focus(); });
  container.querySelectorAll("[data-pst-ajouter]").forEach(b => b.addEventListener("click", () => { pst.nouveau = true; pst.nouveauInit = { nom: b.dataset.pstAjouter }; pst.mobileFiche = true; rerender(); $("#pst-form [name=metier]")?.focus(); }));
  $("[data-pst-annuler]")?.addEventListener("click", () => { pst.nouveau = false; pst.edition = false; rerender(); });
  $("[data-pst-modifier]")?.addEventListener("click", () => { pst.edition = !pst.edition; rerender(); });
  container.querySelectorAll("[data-pst-onglet]").forEach(b => b.addEventListener("click", () => { pst.onglet = b.dataset.pstOnglet; rerender(); }));

  $("#pst-form")?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const f = Object.fromEntries(new FormData(ev.target).entries());
    f.nom = String(f.nom || "").trim();
    if (!f.nom) return etat("Indique le nom de la société.");
    const ancien = pst.nouveau ? null : courant?.e;
    if (liste.some(e => cle(e.nom) === cle(f.nom) && e !== ancien)) return etat("Un prestataire porte déjà ce nom.");
    ev.target.querySelector("[type=submit]").disabled = true; etat("⏳ Enregistrement…", true);
    try {
      await saveEntreprises(ancien ? liste.map(e => e === ancien ? f : e) : [...liste, f]);
      // Renommage : les demandes confiées suivent le nouveau nom.
      if (ancien && cle(ancien.nom) !== cle(f.nom)) {
        for (const l of lignes.filter(x => x.attribueA === "ext" && cle(x.attribueANom) === cle(ancien.nom))) {
          const ch = { attribueANom: f.nom }; if (cle(l.intervenant) === cle(ancien.nom)) ch.intervenant = f.nom;
          try { await maj(l.id, ch); } catch (e) { console.warn(e); }
        }
      }
      pst.sel = f.nom; pst.nouveau = false; pst.edition = false; pst.mobileFiche = true;
      window.toast?.(ancien ? "✓ Prestataire enregistré" : "✓ Prestataire créé"); rerender();
    } catch (e) { console.error(e); etat("❌ " + (e?.message || e)); ev.target.querySelector("[type=submit]").disabled = false; }
  });
  $("[data-pst-suppr]")?.addEventListener("click", async () => {
    const b = courant; if (!b) return;
    if (!confirm(`Supprimer « ${b.e.nom} » de la liste des prestataires ?${b.aFaire.length ? `\n\n${b.aFaire.length} demande(s) lui sont encore confiées : elles gardent son nom.` : ""}`)) return;
    try { await saveEntreprises(liste.filter(e => e !== b.e)); pst.sel = null; pst.edition = false; pst.mobileFiche = false; window.toast?.("Prestataire supprimé"); rerender(); }
    catch (e) { alert("Échec : " + (e?.message || e)); }
  });

  const ligne = (id) => lignes.find(x => x.id === id);
  const confier = async (l, e) => {
    const ch = { attribueA: "ext", attribueANom: e.nom, attribueLe: aujourdhui(), attribuePar: utilisateur, categorieIntervenant: "Externe SG" };
    if (!l.intervenant || l.intervenant === l.attribueANom) ch.intervenant = e.nom;
    if (!l.statut || l.statut === "Non renseigné") ch.statut = "Intervenant sollicité";
    await maj(l.id, ch);
  };
  container.querySelectorAll("[data-pst-confier]").forEach(b => b.addEventListener("click", async () => {
    const l = ligne(b.dataset.pstConfier); if (!l || !courant) return;
    b.disabled = true;
    try { await confier(l, courant.e); window.toast?.(`${l.n} confiée à ${courant.e.nom}`); } catch (e) { alert("Échec : " + (e?.message || e)); b.disabled = false; }
  }));
  container.querySelectorAll("[data-pst-statut]").forEach(sel => sel.addEventListener("change", async () => {
    if (!sel.value) return; sel.disabled = true;
    try { await maj(sel.dataset.pstStatut, { statut: sel.value, dateStatut: aujourdhui() }); window.toast?.(`Statut : ${sel.value}`); } catch (e) { alert("Échec : " + (e?.message || e)); sel.disabled = false; }
  }));
  container.querySelectorAll("[data-pst-fait]").forEach(b => b.addEventListener("click", async () => {
    const l = ligne(b.dataset.pstFait); if (!l) return;
    const d = prompt(`${l.n} réalisée par ${courant?.e.nom || "l'entreprise"}.\nDate d'intervention (JJ/MM/AAAA) :`, fr(l.dateIntervention) || fr(aujourdhui()));
    if (d === null) return;
    const m = d.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    const iso = m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : aujourdhui();
    b.disabled = true;
    try { await maj(l.id, { statut: "Réalisé", dateIntervention: iso, dateStatut: aujourdhui(), validation: "OUI", dateValidation: aujourdhui(), validePar: utilisateur, declarePar: courant?.e.nom || "Entreprise extérieure", declareLe: aujourdhui() }); window.toast?.(`✓ ${l.n} réalisée`); }
    catch (e) { alert("Échec : " + (e?.message || e)); b.disabled = false; }
  }));
  container.querySelectorAll("[data-pst-retirer]").forEach(b => b.addEventListener("click", async () => {
    const l = ligne(b.dataset.pstRetirer); if (!l) return;
    if (!confirm(`Retirer ${l.n} à ${courant?.e.nom} ?\nLa demande redevient « à attribuer ».`)) return;
    const ch = { attribueA: "", attribueANom: "", attribueLe: "", attribuePar: "" };
    if (cle(l.intervenant) === cle(courant?.e.nom)) { ch.intervenant = ""; ch.categorieIntervenant = ""; }
    try { await maj(l.id, ch); } catch (e) { alert("Échec : " + (e?.message || e)); }
  }));
  container.querySelectorAll("[data-pst-ouvrir]").forEach(b => b.addEventListener("click", () => { const [id, site] = b.dataset.pstOuvrir.split("|"); ouvrirDemande?.(id, site); }));
  $("[data-pst-imprimer]")?.addEventListener("click", () => {
    const b = courant; if (!b) return;
    const coord = [b.e.metier, b.e.contact, b.e.tel, b.e.email].filter(Boolean).map(esc).join(" · ");
    imprimerListe({ titre: `🏢 ${b.e.nom}`, sousTitre: coord, sections: [{ titre: "À faire", liste: b.aFaire }, { titre: "En attente de validation", liste: b.enValid }, { titre: "Réalisées (30 derniers jours)", liste: b.faites.filter(l => (jours(l.dateIntervention || l.dateStatut) ?? 99) <= 30) }] });
  });
  $("[data-pst-mail]")?.addEventListener("click", () => {
    const b = courant; if (!b) return;
    location.href = `mailto:${encodeURIComponent(b.e.email || "")}?subject=${encodeURIComponent(`Demandes d'intervention en cours — Groupe Établières (${b.aFaire.length})`)}&body=${encodeURIComponent(texteMail(b))}`;
  });
}

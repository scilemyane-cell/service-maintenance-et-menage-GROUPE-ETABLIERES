// suivi-demandes-sites.js — Vue « Par site » du Suivi des demandes, pensée
// pour les techniciens sur le terrain (téléphone) : on choisit un site, on
// voit ses demandes en cartes, et on les traite en un geste (statut, date
// d'intervention, intervenant, commentaire, « ✓ Réalisé aujourd'hui »).
import { esc } from "./astreinte-logic.js";

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

const st = { site: null, q: "", association: "", voirTraitees: false, brouillons: {} };
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

export function renderParSite(container, lignes, { toggleHTML, onToggle, perms, maj, utilisateur = "" }) {
  if (!lignes) { container.innerHTML = `<div class="stack">${toggleHTML}<div class="hint">Chargement des demandes…</div></div>`; onToggle(); return; }
  const rerender = () => renderParSite(container, lignes, { toggleHTML, onToggle, perms, maj, utilisateur });
  const q = sa(st.q.trim());
  const carteValidation = (l) => `
    <article class="dps-carte a-valider" data-id="${esc(l.id)}">
      <div class="dps-carte-tete"><span class="dps-num">${esc(l.n)}</span>${badgeUrg(l.urgence)}<span class="dps-local">🏠 ${esc(l.site)}</span>${l.local ? `<span class="dps-local">📍 ${esc(l.local)}</span>` : ""}</div>
      <p class="dps-descr">${esc(l.descr) || "<i>Sans descriptif</i>"}</p>
      <div class="dps-lecture">
        <span>Réalisée le <b>${fr(l.dateIntervention) || "—"}</b>${l.intervenant ? ` · intervenant : <b>${esc(l.intervenant)}</b>` : ""}</span>
        ${l.declarePar ? `<span>Déclarée par <b>${esc(l.declarePar)}</b>${l.declareLe ? ` le ${fr(l.declareLe)}` : ""}</span>` : ""}
        ${l.commentaireTech ? `<span class="dps-com-lu">« ${esc(l.commentaireTech)} »</span>` : `<span class="dps-com-lu vide">Pas de commentaire</span>`}
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
    const parSite = {};
    lignes.filter(filtreAssoc).forEach(l => {
      const s = parSite[l.site] || (parSite[l.site] = { nom: l.site, association: l.association, ouvertes: 0, urgentes: 0, total: 0, plusVieille: 0, realiseesMois: 0, aValider: 0 });
      s.total++;
      if (EN_ATTENTE_VALID(l.statut)) s.aValider++;
      else if (!TRAITE(l.statut)) {
        s.ouvertes++;
        if (l.urgence === "Urgent" || l.urgence === "Critique") s.urgentes++;
        const j = joursDepuis(l.date); if (j !== null && j > s.plusVieille) s.plusVieille = j;
      } else if (l.statut === "Réalisé" && (l.dateIntervention || l.dateStatut || "").slice(0, 7) === aujourdhui().slice(0, 7)) s.realiseesMois++;
    });
    const sites = Object.values(parSite)
      .filter(s => (!q || sa(s.nom).includes(q)) && (st.voirTraitees || s.ouvertes > 0 || s.aValider > 0))
      .sort((a, b) => (b.urgentes - a.urgentes) || (b.ouvertes - a.ouvertes) || a.nom.localeCompare(b.nom, "fr"));
    const totOuv = sites.reduce((t, s) => t + s.ouvertes, 0), totUrg = sites.reduce((t, s) => t + s.urgentes, 0);
    container.innerHTML = `
    <div class="stack dps">
      ${toggleHTML}
      <section class="dps-hero">
        <div><span class="dps-sur">Traitement sur le terrain</span><h2>Demandes <em>par site</em></h2>
          <p>Choisis un site pour voir et traiter ses demandes.</p></div>
        <div class="dps-hero-chiffres"><div><b>${totOuv}</b><span>à traiter</span></div><div class="urg"><b>${totUrg}</b><span>urgentes</span></div><div><b>${sites.length}</b><span>sites</span></div></div>
      </section>
      ${perms.isEditor ? (() => { const av = lignes.filter(l => EN_ATTENTE_VALID(l.statut)).sort((a, b) => (a.dateIntervention || "").localeCompare(b.dateIntervention || "")); return av.length ? `
      <section class="dps-valid-bloc">
        <div class="dps-valid-tete"><h3>⏳ ${av.length} demande${av.length > 1 ? "s" : ""} à valider</h3><p>Déclarées réalisées par les techniciens — vérifie et valide.</p></div>
        <div class="dps-cartes">${av.map(l => carteValidation(l)).join("")}</div>
      </section>` : ""; })() : ""}
      <div class="dps-barre">
        <label class="dps-recherche"><span>🔎</span><input id="dps-q" type="search" placeholder="Rechercher un site…" value="${esc(st.q)}"></label>
        <div class="dps-seg">${[["", "Toutes"], ["Agropolis", "Agropolis"], ["École", "École"], ["Armonia", "Armonia"]].map(([k, l]) => `<button data-dps-asso="${esc(k)}" class="${st.association === k ? "on" : ""}">${l}</button>`).join("")}</div>
        <label class="dps-case"><input type="checkbox" id="dps-traitees" ${st.voirTraitees ? "checked" : ""}> Sites sans demande en attente</label>
      </div>
      <div class="dps-sites">
        ${sites.map(s => `
        <button class="dps-site ${s.urgentes ? "a-urg" : s.ouvertes ? "" : "vide"}" data-dps-site="${esc(s.nom)}">
          <div class="dps-site-tete"><b>${esc(s.nom)}</b><small>${esc(s.association)}</small></div>
          <div class="dps-site-compte"><span class="n">${s.ouvertes}</span><span>à traiter</span></div>
          <div class="dps-site-pied">
            ${s.urgentes ? `<span class="dps-pastille urg">🔴 ${s.urgentes} urgente${s.urgentes > 1 ? "s" : ""}</span>` : ""}
            ${s.plusVieille > 30 ? `<span class="dps-pastille vieux">⏳ ${s.plusVieille} j</span>` : ""}
            ${s.realiseesMois ? `<span class="dps-pastille ok">✓ ${s.realiseesMois} ce mois</span>` : ""}
            ${s.aValider ? `<span class="dps-pastille valid">⏳ ${s.aValider} à valider</span>` : ""}
            ${!s.ouvertes && !s.aValider ? `<span class="dps-pastille ok">✓ À jour</span>` : ""}
          </div>
        </button>`).join("") || `<div class="dps-vide">Aucun site${q ? " ne correspond à la recherche" : " avec des demandes en attente"}.</div>`}
      </div>
    </div>`;
    onToggle();
    let t = null;
    container.querySelector("#dps-q")?.addEventListener("input", (e) => { st.q = e.target.value; clearTimeout(t); t = setTimeout(() => { rerender(); const el = container.querySelector("#dps-q"); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 250); });
    container.querySelectorAll("[data-dps-asso]").forEach(b => b.addEventListener("click", () => { st.association = b.dataset.dpsAsso; rerender(); }));
    container.querySelector("#dps-traitees")?.addEventListener("change", (e) => { st.voirTraitees = e.target.checked; rerender(); });
    container.querySelectorAll("[data-dps-site]").forEach(b => b.addEventListener("click", () => { st.site = b.dataset.dpsSite; st.q = ""; rerender(); container.scrollIntoView({ block: "start" }); }));
    brancherValidation();
    return;
  }

  // ---------- Demandes d'un site ----------
  const duSite = lignes.filter(l => l.site === st.site);
  const enValidation = duSite.filter(l => EN_ATTENTE_VALID(l.statut));
  const ouvertes = duSite.filter(l => A_TRAITER(l.statut)).sort((a, b) => ((ORDRE_URG[a.urgence] ?? 9) - (ORDRE_URG[b.urgence] ?? 9)) || (a.date || "").localeCompare(b.date || ""));
  const traitees = duSite.filter(l => TRAITE(l.statut)).sort((a, b) => (b.dateIntervention || b.dateStatut || b.date || "").localeCompare(a.dateIntervention || a.dateStatut || a.date || ""));
  const carte = (l) => {
    const j = joursDepuis(l.date);
    return `
    <article class="dps-carte ${TRAITE(l.statut) ? "traitee" : ""} u-${sa(l.urgence).replace(/[^a-z]/g, "")}" data-id="${esc(l.id)}">
      <div class="dps-carte-tete">
        <span class="dps-num">${esc(l.n)}</span>${badgeUrg(l.urgence)}${badgeAge(TRAITE(l.statut) ? null : j)}
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
        <label class="dps-com">Commentaire<textarea data-dps-champ="commentaireTech" rows="2" placeholder="Ce qui a été fait, pièce à commander…">${esc(val(l, "commentaireTech"))}</textarea></label>
      </div>
      <div class="dps-actions">
        ${!TRAITE(l.statut) && val(l, "statut") !== "Réalisé" ? `<button type="button" class="dps-realise-prep" data-dps-realise>${perms.isEditor ? "✓ Réalisé aujourd'hui" : "✓ Intervention terminée"}</button>` : ""}
        <button type="button" class="dps-enregistrer ${val(l, "statut") === "Réalisé" && !TRAITE(l.statut) ? "valider" : ""}" data-dps-enregistrer ${aChange(l) ? "" : "hidden"}>${val(l, "statut") === "Réalisé" && !TRAITE(l.statut) ? (perms.isEditor ? "✓ Valider la réalisation" : "📨 Envoyer pour validation") : "💾 Enregistrer"}</button>
        ${aChange(l) ? `<button type="button" class="dps-annuler" data-dps-annuler>Annuler</button>` : ""}
      </div>
      ${val(l, "statut") === "Réalisé" && !TRAITE(l.statut) ? `<p class="dps-aide">${perms.isEditor ? "Vérifie la date, le contact et le commentaire, puis valide." : "Complète le contact et le commentaire, puis envoie au superviseur."}</p>` : ""}
      ` : `
      <div class="dps-lecture"><span>Statut : <b>${esc(l.statut)}</b></span>${l.intervenant ? `<span>Contact : <b>${esc(l.intervenant)}</b></span>` : ""}${l.dateIntervention ? `<span>Intervention : <b>${fr(l.dateIntervention)}</b></span>` : ""}${l.commentaireTech ? `<span>${esc(l.commentaireTech)}</span>` : ""}</div>`}
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
    ${enValidation.length ? `<section class="dps-valid-bloc"><div class="dps-valid-tete"><h3>⏳ ${enValidation.length} en attente de validation</h3><p>${perms.isEditor ? "Déclarées réalisées par les techniciens — vérifie et valide." : "Envoyées au superviseur pour validation."}</p></div><div class="dps-cartes">${enValidation.map(l => carteValidation(l)).join("")}</div></section>` : ""}
    ${ouvertes.length ? `<div class="dps-cartes">${ouvertes.map(carte).join("")}</div>` : `<div class="dps-vide">✓ Aucune demande à traiter sur ce site.</div>`}
    ${traitees.length ? `<details class="dps-historique"><summary>Historique : ${traitees.length} demande${traitees.length > 1 ? "s" : ""} traitée${traitees.length > 1 ? "s" : ""}</summary><div class="dps-cartes">${traitees.slice(0, 40).map(carte).join("")}</div></details>` : ""}
  </div>`;
  onToggle();
  container.querySelector("#dps-retour").addEventListener("click", () => { st.site = null; rerender(); });
  brancherValidation();

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
      e.target.disabled = true;
      const etat = c.querySelector(".dps-etat"); etat.textContent = "⏳ Enregistrement…"; etat.className = "dps-etat";
      try {
        try { await maj(c.dataset.id, champs); }
        catch (err) {
          // Règles Firestore pas encore publiées pour « déclaré par » : on enregistre sans.
          if (!("declarePar" in champs) || !/permission/i.test(String(err?.message || err))) throw err;
          delete champs.declarePar; delete champs.declareLe;
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

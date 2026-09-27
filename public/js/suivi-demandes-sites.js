// suivi-demandes-sites.js — Vue « Par site » du Suivi des demandes, pensée
// pour les techniciens sur le terrain (téléphone) : on choisit un site, on
// voit ses demandes en cartes, et on les traite en un geste (statut, date
// d'intervention, intervenant, commentaire, « ✓ Réalisé aujourd'hui »).
import { esc } from "./astreinte-logic.js";

const STATUTS_RAPIDES = ["Pris en compte", "Intervenant sollicité", "Demande de devis", "Planifié", "Commande en cours", "Réalisé", "Annulé"];
const ORDRE_URG = { "Critique": 0, "Urgent": 1, "À planifier": 2, "Normal": 3, "Non renseignée": 4 };
const TRAITE = (s) => s === "Réalisé" || s === "Annulé";
const aujourdhui = () => new Date().toISOString().slice(0, 10);
const joursDepuis = (iso) => { if (!iso) return null; const d = new Date(iso + "T00:00:00"); return isNaN(d) ? null : Math.max(0, Math.round((Date.now() - d) / 86400000)); };
const fr = (iso) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "");
const sa = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const st = { site: null, q: "", association: "", voirTraitees: false };

function badgeUrg(u) {
  const cls = u === "Critique" ? "crit" : u === "Urgent" ? "urg" : u === "À planifier" ? "plan" : u === "Normal" ? "norm" : "nr";
  return `<span class="dps-urg ${cls}">${esc(u)}</span>`;
}
function badgeAge(j) {
  if (j === null) return "";
  const cls = j > 90 ? "vieux" : j > 30 ? "moyen" : "";
  return `<span class="dps-age ${cls}" title="Ancienneté de la demande">${j === 0 ? "aujourd'hui" : `il y a ${j} j`}</span>`;
}

export function renderParSite(container, lignes, { toggleHTML, onToggle, perms, maj }) {
  if (!lignes) { container.innerHTML = `<div class="stack">${toggleHTML}<div class="hint">Chargement des demandes…</div></div>`; onToggle(); return; }
  const rerender = () => renderParSite(container, lignes, { toggleHTML, onToggle, perms, maj });
  const q = sa(st.q.trim());
  const filtreAssoc = (l) => !st.association || l.association === st.association;

  // ---------- Liste des sites ----------
  if (!st.site) {
    const parSite = {};
    lignes.filter(filtreAssoc).forEach(l => {
      const s = parSite[l.site] || (parSite[l.site] = { nom: l.site, association: l.association, ouvertes: 0, urgentes: 0, total: 0, plusVieille: 0, realiseesMois: 0 });
      s.total++;
      if (!TRAITE(l.statut)) {
        s.ouvertes++;
        if (l.urgence === "Urgent" || l.urgence === "Critique") s.urgentes++;
        const j = joursDepuis(l.date); if (j !== null && j > s.plusVieille) s.plusVieille = j;
      } else if (l.statut === "Réalisé" && (l.dateIntervention || l.dateStatut || "").slice(0, 7) === aujourdhui().slice(0, 7)) s.realiseesMois++;
    });
    const sites = Object.values(parSite)
      .filter(s => (!q || sa(s.nom).includes(q)) && (st.voirTraitees || s.ouvertes > 0))
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
            ${!s.ouvertes ? `<span class="dps-pastille ok">✓ À jour</span>` : ""}
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
    return;
  }

  // ---------- Demandes d'un site ----------
  const duSite = lignes.filter(l => l.site === st.site);
  const ouvertes = duSite.filter(l => !TRAITE(l.statut)).sort((a, b) => ((ORDRE_URG[a.urgence] ?? 9) - (ORDRE_URG[b.urgence] ?? 9)) || (a.date || "").localeCompare(b.date || ""));
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
        ${STATUTS_RAPIDES.map(s => `<button type="button" class="dps-st ${l.statut === s ? "on" : ""} ${s === "Réalisé" ? "ok" : s === "Annulé" ? "ko" : ""}" data-dps-statut="${esc(s)}">${esc(s)}</button>`).join("")}
      </div>
      <div class="dps-champs">
        ${perms.isEditor ? `<label>Intervenant<select data-dps-champ="categorieIntervenant">${["", "Interne SG", "Externe SG", "Interne site", "Externe site"].map(o => `<option value="${o}" ${o === (l.categorieIntervenant || "") ? "selected" : ""}>${o || "—"}</option>`).join("")}</select></label>` : ""}
        <label>Contact / entreprise<input data-dps-champ="intervenant" value="${esc(l.intervenant || "")}" placeholder="ex. Ronald, Écol'eau…"></label>
        <label>Date d'intervention<span class="dps-date"><input type="date" data-dps-champ="dateIntervention" value="${esc(l.dateIntervention || "")}"><button type="button" class="dps-auj" data-dps-auj title="Mettre la date du jour">Aujourd'hui</button></span></label>
        <label class="dps-com">Commentaire<textarea data-dps-champ="commentaireTech" rows="2" placeholder="Ce qui a été fait, pièce à commander…">${esc(l.commentaireTech || "")}</textarea></label>
      </div>
      ${!TRAITE(l.statut) ? `<button type="button" class="dps-realise" data-dps-realise>✓ Réalisé aujourd'hui</button>` : ""}
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
      <div><h2>${esc(st.site)}</h2><p>${ouvertes.length} à traiter · ${traitees.length} traitée${traitees.length > 1 ? "s" : ""}</p></div>
    </div>
    ${ouvertes.length ? `<div class="dps-cartes">${ouvertes.map(carte).join("")}</div>` : `<div class="dps-vide">✓ Aucune demande en attente sur ce site.</div>`}
    ${traitees.length ? `<details class="dps-historique"><summary>Historique : ${traitees.length} demande${traitees.length > 1 ? "s" : ""} traitée${traitees.length > 1 ? "s" : ""}</summary><div class="dps-cartes">${traitees.slice(0, 40).map(carte).join("")}</div></details>` : ""}
  </div>`;
  onToggle();
  container.querySelector("#dps-retour").addEventListener("click", () => { st.site = null; rerender(); });

  const enregistrer = async (carteEl, champs, message) => {
    const etat = carteEl.querySelector(".dps-etat");
    etat.textContent = "⏳ Enregistrement…"; etat.className = "dps-etat";
    try { await maj(carteEl.dataset.id, champs); etat.textContent = message || "✓ Enregistré"; etat.className = "dps-etat ok"; }
    catch (err) { console.error("Demande :", err); etat.textContent = "❌ Échec — réessaie"; etat.className = "dps-etat ko"; }
  };
  container.querySelectorAll(".dps-carte").forEach(c => {
    c.querySelectorAll("[data-dps-statut]").forEach(b => b.addEventListener("click", () => {
      c.querySelectorAll("[data-dps-statut]").forEach(x => x.classList.toggle("on", x === b));
      const champs = { statut: b.dataset.dpsStatut };
      if (perms.isEditor) champs.dateStatut = aujourdhui();
      enregistrer(c, champs, `✓ Statut : ${b.dataset.dpsStatut}`);
    }));
    c.querySelectorAll("[data-dps-champ]").forEach(inp => inp.addEventListener("change", () => enregistrer(c, { [inp.dataset.dpsChamp]: inp.value.trim() })));
    c.querySelector("[data-dps-auj]")?.addEventListener("click", () => {
      const inp = c.querySelector('[data-dps-champ="dateIntervention"]'); inp.value = aujourdhui();
      enregistrer(c, { dateIntervention: inp.value });
    });
    c.querySelector("[data-dps-realise]")?.addEventListener("click", (e) => {
      e.target.disabled = true;
      const champs = { statut: "Réalisé" };
      const d = c.querySelector('[data-dps-champ="dateIntervention"]');
      if (!d.value) champs.dateIntervention = aujourdhui();
      if (perms.isEditor) champs.dateStatut = aujourdhui();
      const com = c.querySelector('[data-dps-champ="commentaireTech"]')?.value.trim();
      if (com) champs.commentaireTech = com;
      enregistrer(c, champs, "✓ Marquée réalisée");
    });
  });
}

export function resetVueSites() { st.site = null; }

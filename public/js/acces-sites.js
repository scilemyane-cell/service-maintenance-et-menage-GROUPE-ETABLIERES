// acces-sites.js — Accès prestataire aux DOSSIERS DE SITE avec dates (comme
// les accès MNA) : sites cochés + du … au … → invitation de type « sites »
// (lien court …/m/CODE → sites-guest.html?a=CODE, dates et accès coupé
// vérifiés). Utilisé par Dossiers de site et par la tuile Prestataires.
import { esc } from "./astreinte-logic.js";

export async function ouvrirAccesSites({ dossiers = [], user = null, prerempli = {} } = {}) {
  const auj = new Date().toISOString().slice(0, 10);
  const parAssoc = {};
  dossiers.forEach(d => (parAssoc[d.association || "Autres sites"] ||= []).push(d));
  const fond = document.createElement("div");
  fond.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:12px";
  const champ = "width:100%;box-sizing:border-box;padding:7px 9px;border-radius:8px;border:1px solid var(--border,#ccd);background:var(--bg,#fff);color:inherit;font:inherit";
  fond.innerHTML = `<div style="background:var(--card,#fff);color:var(--text,#111);border-radius:14px;max-width:720px;width:100%;max-height:94vh;overflow:auto;padding:16px">
    <div style="display:flex;align-items:center;gap:8px"><b style="flex:1;font-size:17px">🔗 Accès prestataire aux dossiers de site</b><button type="button" class="nav-btn" data-x>✕</button></div>
    <p class="hint">Le prestataire ouvre la liste des sites cochés et la fiche PDF de chacun, uniquement entre les dates choisies. L'accès se coupe ensuite dans Paramètres › accès prestataires.</p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:10px 0">
      <label>Prestataire / société<input data-p="label" value="${esc(prerempli.label || "")}" style="${champ}" placeholder="Ex. : Dupont Plomberie"></label>
      <label>Téléphone (SMS)<input data-p="tel" type="tel" value="${esc(prerempli.tel || "")}" style="${champ}" placeholder="06…"></label>
      <label>Du<input data-p="debut" type="date" value="${auj}" style="${champ}"></label>
      <label>Au<input data-p="fin" type="date" value="${new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10)}" style="${champ}"></label>
    </div>
    <div style="display:flex;gap:8px;align-items:center;margin:4px 0 6px"><b style="flex:1">Sites</b><button type="button" class="nav-btn" data-tout="1">Tout cocher</button><button type="button" class="nav-btn" data-tout="0">Tout décocher</button></div>
    ${Object.keys(parAssoc).sort((x, y) => x.localeCompare(y, "fr")).map(g => `<div style="margin:6px 0"><div class="hint" style="font-weight:700">${esc(g)}</div>${parAssoc[g].sort((x, y) => String(x.nom).localeCompare(String(y.nom), "fr")).map(d => `<label style="display:inline-flex;gap:6px;align-items:center;margin:3px 10px 3px 0"><input type="checkbox" data-site="${esc(d.id)}" ${/^nouvelle r[ée]sidence$/i.test(String(d.nom || "").trim()) ? "" : "checked"}> ${esc(d.nom)}</label>`).join("")}</div>`).join("")}
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px"><button type="button" class="nav-btn" data-x>Annuler</button><button type="button" class="add-btn" data-creer>🔗 Créer l'accès</button></div></div>`;
  document.body.appendChild(fond);
  fond.querySelectorAll("[data-x]").forEach(x => x.onclick = () => fond.remove());
  fond.querySelectorAll("[data-tout]").forEach(x => x.onclick = () => fond.querySelectorAll("[data-site]").forEach(c => { c.checked = x.dataset.tout === "1"; }));
  fond.querySelector("[data-creer]").onclick = async (e) => {
    const v = (k) => fond.querySelector(`[data-p="${k}"]`).value.trim();
    const ids = new Set([...fond.querySelectorAll("[data-site]:checked")].map(c => c.dataset.site));
    const sites = dossiers.filter(d => ids.has(d.id)).map(d => ({ id: d.id, name: d.nom || "" }));
    if (!v("label")) return alert("Indique le nom du prestataire.");
    if (!sites.length) return alert("Coche au moins un site.");
    if (!v("debut") || !v("fin") || v("fin") < v("debut")) return alert("Vérifie les dates.");
    const b = e.currentTarget; b.disabled = true; b.textContent = "⏳ Création…";
    try {
      const { publierIndexSites } = await import("./pdf-public-share.js");
      const r = await publierIndexSites(dossiers.map(d => ({ id: d.id, nom: d.nom || "", adresse: d.adresse || "", association: d.association || "", groupe: d.groupe || "" })));
      const { createInvitation } = await import("./invitations-data.js");
      const token = await createInvitation({ type: "sites", sites, debut: v("debut"), fin: v("fin"), weeks: [], label: v("label"), telephone: v("tel"), createdBy: user?.uid || "" });
      const lien = `${location.origin}/m/${token}`, frJ = (iso) => iso.split("-").reverse().slice(0, 2).join("/");
      try { await navigator.clipboard.writeText(lien); } catch { /* */ }
      fond.remove();
      const sansPdf = sites.filter(st => !(r.sites || []).some(x => x.id === st.id && x.pdf)).length;
      window.toast?.(`🔗 Accès créé, lien copié${sansPdf ? ` — ${sansPdf} site(s) sans fiche publiée (« Fiche à venir »)` : ""}`);
      const { ouvrirMailPresta } = await import("./mail-presta.js");
      ouvrirMailPresta({
        objet: `Fiches des sites — Groupe Établières — du ${frJ(v("debut"))} au ${frJ(v("fin"))}`,
        etiquette: "ACCÈS PRESTATAIRE", titre: "Fiches de nos sites",
        intro: `voici votre accès${v("label") ? ` pour ${v("label")}` : ""} aux fiches techniques des sites ci-dessous (équipements, emplacements, procédures, photos, numéros d'urgence), valable du ${frJ(v("debut"))} au ${frJ(v("fin"))}.`,
        pastilles: sites.map(st => st.name),
        bouton: "Voir les sites", url: lien,
        sms: `Groupe Établières – Fiches des sites, du ${frJ(v("debut"))} au ${frJ(v("fin"))}.\nVotre accès : ${lien}`,
        etapes: ["Ouvrez le lien sur votre téléphone ou ordinateur.", "Choisissez le site (recherche par nom ou par ville).", "La fiche s'ouvre en PDF, sans compte ni mot de passe."],
        signature: user?.nom || "Service Maintenance et Entretien",
      });
    } catch (err) { alert("Création impossible : " + (err?.message || err)); b.disabled = false; b.textContent = "🔗 Créer l'accès"; }
  };
}

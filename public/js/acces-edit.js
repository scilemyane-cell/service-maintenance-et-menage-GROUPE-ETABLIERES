// acces-edit.js — ✏️ Modifier un accès prestataire : prestataire, téléphone,
// dates (ou ♾️ permanent, sans date de fin) et sites. Utilisé par la tuile
// Prestataires (Annuaire) et Paramètres › accès prestataires.
import { esc, addDays, dateKey } from "./astreinte-logic.js";
import { updateInvitation } from "./invitations-data.js";

const unAbonnement = (watch) => new Promise((ok) => { let u = null, fini = false; u = watch((l) => { if (fini) return; fini = true; ok(l || []); setTimeout(() => u?.(), 0); }); setTimeout(() => { if (!fini) { fini = true; ok([]); } }, 8000); });
const lundiDe = (iso) => { const d = new Date(iso + "T00:00:00"); return dateKey(addDays(d, -((d.getDay() + 6) % 7))); };

export async function modifierAcces(inv) {
  const fond = document.createElement("div");
  fond.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:12px";
  fond.innerHTML = `<div style="background:var(--card,#fff);color:var(--text,#111);border-radius:14px;max-width:720px;width:100%;max-height:94vh;overflow:auto;padding:16px"><p class="hint">⏳ Chargement…</p></div>`;
  document.body.appendChild(fond);
  // Sites proposés : dossiers de site pour un accès « sites », sinon la liste des sites ménage.
  let options = [];
  try {
    if (inv.type === "sites") { const { watchSitesDossiers } = await import("./site-dossier-data.js"); options = (await unAbonnement(watchSitesDossiers)).filter(d => !d.supprimeLe).map(d => ({ id: d.id, name: d.nom || "", groupe: d.association || "Autres sites" })); }
    else if (inv.type !== "ponctuel") { const { watchSites } = await import("./sites-data.js"); options = (await unAbonnement(watchSites)).map(s => ({ id: s.id, name: s.name || "", groupe: s.dispositif || s.groupe || "Sites" })); }
  } catch { /* sites non modifiables */ }
  const choisis = new Set((inv.sites || []).map(s => s.id));
  (inv.sites || []).forEach(s => { if (!options.some(o => o.id === s.id)) options.push({ id: s.id, name: s.name, groupe: "Sites de l'accès" }); });
  const groupes = {}; options.forEach(o => (groupes[o.groupe] ||= []).push(o));
  const champ = "width:100%;box-sizing:border-box;padding:7px 9px;border-radius:8px;border:1px solid var(--border,#ccd);background:var(--bg,#fff);color:inherit;font:inherit";
  const permanent = !inv.fin;
  fond.firstElementChild.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px"><b style="flex:1;font-size:17px">✏️ Modifier l'accès — ${esc(inv.label || "")}</b><button type="button" class="nav-btn" data-x>✕</button></div>
    <p class="hint">Le lien déjà envoyé au prestataire ne change pas : les modifications s'appliquent dès qu'il le rouvre.</p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:10px 0">
      <label>Prestataire / société<input data-p="label" value="${esc(inv.label || "")}" style="${champ}"></label>
      <label>Téléphone (SMS)<input data-p="tel" type="tel" value="${esc(inv.telephone || "")}" style="${champ}"></label>
      <label>Du<input data-p="debut" type="date" value="${esc(inv.debut || dateKey(new Date()))}" style="${champ}"></label>
      <label>Au<input data-p="fin" type="date" value="${esc(inv.fin || "")}" ${permanent ? "disabled" : ""} style="${champ}"></label>
    </div>
    <label style="display:flex;gap:8px;align-items:center;margin:0 0 12px;font-weight:600"><input type="checkbox" data-p="permanent" ${permanent ? "checked" : ""}> ♾️ Accès permanent (sans date de fin — reste ouvert jusqu'à ce que tu le coupes)</label>
    ${options.length ? `<div style="display:flex;gap:8px;align-items:center;margin:4px 0 6px"><b style="flex:1">Sites</b><button type="button" class="nav-btn" data-tout="1">Tout cocher</button><button type="button" class="nav-btn" data-tout="0">Tout décocher</button></div>
      ${Object.keys(groupes).sort((a, b) => a.localeCompare(b, "fr")).map(g => `<div style="margin:6px 0"><div class="hint" style="font-weight:700">${esc(g)}</div>${groupes[g].sort((a, b) => a.name.localeCompare(b.name, "fr")).map(o => `<label style="display:inline-flex;gap:6px;align-items:center;margin:3px 10px 3px 0"><input type="checkbox" data-site="${esc(o.id)}" ${choisis.has(o.id) ? "checked" : ""}> ${esc(o.name)}</label>`).join("")}</div>`).join("")}` : ""}
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px"><button type="button" class="nav-btn" data-x>Annuler</button><button type="button" class="add-btn" data-enreg>💾 Enregistrer</button></div>`;
  const q = (s) => fond.querySelector(s);
  fond.querySelectorAll("[data-x]").forEach(x => x.onclick = () => fond.remove());
  fond.querySelectorAll("[data-tout]").forEach(x => x.onclick = () => fond.querySelectorAll("[data-site]").forEach(c => { c.checked = x.dataset.tout === "1"; }));
  q('[data-p="permanent"]').onchange = (e) => { const f = q('[data-p="fin"]'); f.disabled = e.target.checked; if (e.target.checked) f.value = ""; };
  q("[data-enreg]").onclick = async (e) => {
    const v = (k) => q(`[data-p="${k}"]`).value.trim(), perm = q('[data-p="permanent"]').checked;
    const debut = v("debut"), fin = perm ? "" : v("fin");
    if (!v("label")) return alert("Indique le nom du prestataire.");
    if (!debut) return alert("Indique la date de début.");
    if (!perm && (!fin || fin < debut)) return alert("Vérifie la date de fin (ou coche « Accès permanent »).");
    const patch = { label: v("label"), telephone: v("tel"), debut, fin };
    if (options.length) {
      const ids = new Set([...fond.querySelectorAll("[data-site]:checked")].map(c => c.dataset.site));
      const sites = options.filter(o => ids.has(o.id)).map(o => ({ id: o.id, name: o.name }));
      if (!sites.length) return alert("Coche au moins un site.");
      patch.sites = sites; patch.siteId = sites[0].id; patch.siteName = sites.map(s => s.name).join(", ");
    }
    // Fiches de traçabilité : semaines ouvertes recalculées (permanent : calculées à l'ouverture).
    if (inv.type !== "sites" && inv.type !== "ponctuel") {
      const weeks = []; let cur = lundiDe(debut);
      if (fin) while (cur <= fin && weeks.length < 26) { weeks.push(cur); cur = dateKey(addDays(new Date(cur + "T00:00:00"), 7)); }
      patch.weeks = weeks;
    }
    e.target.disabled = true; e.target.textContent = "⏳ Enregistrement…";
    try { await updateInvitation(inv.id, patch); window.toast?.("✓ Accès modifié"); fond.remove(); }
    catch (err) { alert("Non enregistré : " + (err?.message || err)); e.target.disabled = false; e.target.textContent = "💾 Enregistrer"; }
  };
}

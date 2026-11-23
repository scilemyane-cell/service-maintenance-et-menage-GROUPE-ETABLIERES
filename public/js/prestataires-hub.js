// prestataires-hub.js — Tuile « 🤝 Prestataires » : tout ce qui concerne les
// entreprises extérieures au même endroit.
//  • 🏢 Entreprises : la page Prestataires du Suivi des demandes (fiches,
//    demandes confiées, à valider, historique).
//  • 🔗 Accès : tous les accès avec dates (fiches de traçabilité MNA, dossiers
//    de site) + création d'un accès « dossiers de site ».
//  • 📝 Liens de demande : liens donnés aux prestataires pour déposer une
//    demande d'intervention, et demandes reçues par ce biais.
import { watchSitesDossiers } from "./site-dossier-data.js";

const unDossiers = () => new Promise((ok) => { let u = null, fini = false; u = watchSitesDossiers((l) => { if (fini) return; fini = true; ok((l || []).filter(d => !d.supprimeLe)); setTimeout(() => u?.(), 0); }); setTimeout(() => { if (!fini) { fini = true; ok([]); } }, 8000); });

// ---- 📇 Annuaire : coordonnées de chaque prestataire + suivi de ses accès ----
import { abonnerEntreprises, entreprises, saveEntreprises, cleEntreprise } from "./entreprises-data.js";
import { watchInvitations, setInvitationActive } from "./invitations-data.js";

const escH = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const sansAcc = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const frD = (iso) => iso ? String(iso).slice(0, 10).split("-").reverse().slice(0, 2).join("/") : "";
const aujISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
function etatAcces(i) {
  if (i.active === false) return ["⛔ Coupé", "#9aa3af"];
  const a = aujISO();
  if (i.fin && a > i.fin) return ["⌛ Expiré", "#9aa3af"];
  if (i.debut && a < i.debut) return ["⏳ À venir", "#c9a227"];
  return ["✅ Actif", "#2e7d4f"];
}
const typeAcces = (i) => i.type === "sites" ? "🏢 Dossiers de site" : i.type === "ponctuel" ? "🧽 Ménage ponctuel" : "🧾 Fiches de traçabilité";
const lienAcces = (i) => `${location.origin}/m/${i.id}`;

const an = { sel: null, q: "", edition: false, invitations: [], unsubs: [] };

export function mountPrestaAnnuaire(container, user) {
  an.unsubs.forEach(u => { try { u(); } catch { /* */ } }); an.unsubs = [];
  const re = () => { if (document.contains(container)) rendreAnnuaire(container, user); else { an.unsubs.forEach(u => { try { u(); } catch { /* */ } }); an.unsubs = []; } };
  an.unsubs.push(abonnerEntreprises(re));
  an.unsubs.push(watchInvitations((l) => { an.invitations = (l || []).filter(i => i.type !== "agent"); re(); }));
  re();
}

function rendreAnnuaire(container, user) {
  const fiches = entreprises();
  // Prestataires = fiches de l'annuaire + noms d'accès sans fiche (à compléter).
  const noms = new Map(fiches.map(e => [cleEntreprise(e.nom), { ...e, fiche: true }]));
  an.invitations.forEach(i => { const k = cleEntreprise(i.label); if (k && !noms.has(k)) noms.set(k, { nom: i.label, tel: i.telephone || "", fiche: false }); });
  const tous = [...noms.values()].sort((a, b) => a.nom.localeCompare(b.nom, "fr", { sensitivity: "base" }));
  const accesDe = (nom) => an.invitations.filter(i => cleEntreprise(i.label) === cleEntreprise(nom)).sort((a, b) => String(b.debut || "").localeCompare(String(a.debut || "")));
  const actifs = (nom) => accesDe(nom).filter(i => etatAcces(i)[0].startsWith("✅")).length;
  const liste = tous.filter(e => !an.q || sansAcc(`${e.nom} ${e.metier || ""} ${e.contact || ""}`).includes(sansAcc(an.q)));
  if (an.sel !== "__nouveau" && (!an.sel || !noms.has(cleEntreprise(an.sel)))) an.sel = liste[0]?.nom || null;
  const sel = an.sel === "__nouveau" ? { nom: "", fiche: false, nouveau: true } : noms.get(cleEntreprise(an.sel));
  const champ = "width:100%;box-sizing:border-box;padding:8px 10px;border-radius:8px;border:1px solid var(--border,#ccd);background:var(--bg,#fff);color:inherit;font:inherit";

  const ficheHTML = !sel ? `<p class="hint">Aucun prestataire. Clique sur « ➕ Nouveau prestataire ».</p>` : (an.edition || sel.nouveau || !sel.fiche) ? `
    <h3 style="margin:0 0 10px">${sel.nouveau ? "➕ Nouveau prestataire" : sel.fiche ? "✏️ Modifier" : "📝 Compléter la fiche"}</h3>
    ${!sel.fiche && !sel.nouveau ? `<p class="hint">Ce prestataire a un accès mais pas encore de fiche : complète ses coordonnées.</p>` : ""}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <label>Société<input data-e="nom" value="${escH(sel.nom)}" style="${champ}"></label>
      <label>Métier<input data-e="metier" value="${escH(sel.metier || "")}" placeholder="Plomberie, nettoyage…" style="${champ}"></label>
      <label>Contact<input data-e="contact" value="${escH(sel.contact || "")}" placeholder="Nom du contact" style="${champ}"></label>
      <label>Téléphone<input data-e="tel" type="tel" value="${escH(sel.tel || "")}" style="${champ}"></label>
      <label style="grid-column:1/-1">Mail<input data-e="email" type="email" value="${escH(sel.email || "")}" style="${champ}"></label>
      <label style="grid-column:1/-1">Notes<textarea data-e="notes" rows="3" style="${champ}" placeholder="Horaires, n° de contrat, consignes…">${escH(sel.notes || "")}</textarea></label>
    </div>
    <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap"><button type="button" class="add-btn" data-an-enreg>💾 Enregistrer</button>
      ${sel.fiche ? `<button type="button" class="nav-btn" data-an-annuler>Annuler</button>` : sel.nouveau ? `<button type="button" class="nav-btn" data-an-annuler>Annuler</button>` : ""}
      ${sel.fiche && an.edition ? `<button type="button" class="nav-btn" data-an-suppr style="margin-left:auto;color:#c0392b">🗑️ Supprimer la fiche</button>` : ""}</div>`
  : `
    <div style="display:flex;gap:10px;align-items:flex-start"><div style="flex:1"><h2 style="margin:0">${escH(sel.nom)}</h2>${sel.metier ? `<div class="hint">${escH(sel.metier)}</div>` : ""}</div>
      <button type="button" class="nav-btn" data-an-modif>✏️ Modifier</button></div>
    <div style="display:grid;gap:8px;margin:14px 0">
      ${sel.contact ? `<div>👤 <b>${escH(sel.contact)}</b></div>` : ""}
      ${sel.tel ? `<div>📞 <a href="tel:${escH(String(sel.tel).replace(/[^\d+]/g, ""))}" style="font-weight:700;color:var(--gold,#c9a227);text-decoration:none">${escH(sel.tel)}</a></div>` : ""}
      ${sel.email ? `<div>✉️ <a href="mailto:${escH(sel.email)}" style="color:var(--gold,#c9a227);text-decoration:none">${escH(sel.email)}</a></div>` : ""}
      ${sel.notes ? `<div style="white-space:pre-wrap;background:var(--bg,#f6f7f9);border-radius:8px;padding:8px 10px">📝 ${escH(sel.notes)}</div>` : ""}
      ${!sel.contact && !sel.tel && !sel.email ? `<div class="hint">Pas encore de coordonnées : clique sur « ✏️ Modifier ».</div>` : ""}
    </div>`;

  const acc = sel && !sel.nouveau ? accesDe(sel.nom) : [];
  const accesHTML = !sel || sel.nouveau ? "" : `
    <div style="display:flex;align-items:center;gap:8px;margin-top:18px;flex-wrap:wrap"><h3 style="margin:0;flex:1">🔗 Accès (${acc.length})</h3>
      <button type="button" class="add-btn" data-an-acces-sites>➕ Accès dossiers de site</button></div>
    ${acc.length ? `<div style="display:grid;gap:8px;margin-top:10px">${acc.map(i => { const [et, col] = etatAcces(i); const nb = (i.sites || []).length; return `
      <div style="border:1px solid var(--border,#dde);border-left:4px solid ${col};border-radius:10px;padding:10px 12px">
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><b style="flex:1">${typeAcces(i)}</b><span style="color:${col};font-weight:700">${et}</span></div>
        <div class="hint">${i.debut ? `du ${frD(i.debut)} au ${frD(i.fin)}` : "sans date"} · ${nb} site${nb > 1 ? "s" : ""}${nb && nb <= 4 ? ` : ${escH((i.sites || []).map(x => x.name).join(", "))}` : ""}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
          <a class="nav-btn" href="${lienAcces(i)}?apercu=1" target="_blank" rel="noopener" style="text-decoration:none">👁️ Aperçu</a>
          <button type="button" class="nav-btn" data-an-copier="${escH(i.id)}">📋 Copier le lien</button>
          ${i.active === false ? `<button type="button" class="nav-btn" data-an-actif="${escH(i.id)}" data-v="1">✅ Réactiver</button>` : `<button type="button" class="nav-btn" data-an-actif="${escH(i.id)}" data-v="0">⛔ Couper</button>`}
        </div></div>`; }).join("")}</div>` : `<p class="hint">Aucun accès pour ce prestataire. Les accès MNA se créent dans l'onglet 🔗 Accès.</p>`}`;

  container.innerHTML = `
    <div style="display:grid;grid-template-columns:minmax(220px,320px) 1fr;gap:14px;align-items:start" class="an-grille">
      <div class="form-card" style="padding:12px">
        <input type="search" data-an-q value="${escH(an.q)}" placeholder="🔍 Rechercher un prestataire…" style="${champ};margin-bottom:8px">
        <button type="button" class="add-btn" data-an-nouveau style="width:100%;margin-bottom:8px">➕ Nouveau prestataire</button>
        <div style="display:grid;gap:4px;max-height:65vh;overflow:auto">${liste.map(e => { const n = actifs(e.nom), on = sel && !sel.nouveau && cleEntreprise(e.nom) === cleEntreprise(sel.nom); return `
          <button type="button" data-an-sel="${escH(e.nom)}" style="text-align:left;padding:9px 10px;border-radius:8px;border:1px solid ${on ? "#2e7d4f" : "transparent"};background:${on ? "rgba(46,125,79,.10)" : "transparent"};color:inherit;font:inherit;cursor:pointer">
            <b>${escH(e.nom)}</b>${!e.fiche ? ` <small style="color:#c9a227">· fiche à compléter</small>` : ""}<br><small class="hint">${escH(e.metier || e.tel || "")}${n ? ` · <span style="color:#2e7d4f;font-weight:700">${n} accès actif${n > 1 ? "s" : ""}</span>` : ""}</small></button>`; }).join("") || `<p class="hint">Aucun résultat.</p>`}</div>
      </div>
      <div class="form-card">${ficheHTML}${accesHTML}</div>
    </div>
    <style>@media (max-width:760px){.an-grille{grid-template-columns:1fr!important}}</style>`;

  const q = (sel) => container.querySelector(sel);
  q("[data-an-q]").addEventListener("input", (e) => { an.q = e.target.value; const p = e.target.selectionStart; rendreAnnuaire(container, user); const n = q("[data-an-q]"); n.focus(); n.setSelectionRange(p, p); });
  q("[data-an-nouveau]").onclick = () => { an.sel = "__nouveau"; an.edition = true; rendreAnnuaire(container, user); };
  container.querySelectorAll("[data-an-sel]").forEach(b => b.onclick = () => { an.sel = b.dataset.anSel; an.edition = false; rendreAnnuaire(container, user); });
  q("[data-an-modif]")?.addEventListener("click", () => { an.edition = true; rendreAnnuaire(container, user); });
  q("[data-an-annuler]")?.addEventListener("click", () => { an.edition = false; if (an.sel === "__nouveau") an.sel = null; rendreAnnuaire(container, user); });
  q("[data-an-enreg]")?.addEventListener("click", async (e) => {
    const v = (k) => q(`[data-e="${k}"]`).value.trim(), nom = v("nom");
    if (!nom) return alert("Indique le nom de la société.");
    const autre = entreprises().find(x => cleEntreprise(x.nom) === cleEntreprise(nom) && (!sel.fiche || cleEntreprise(x.nom) !== cleEntreprise(sel.nom)));
    if (autre) return alert("Un prestataire porte déjà ce nom.");
    const fiche = { nom, metier: v("metier"), contact: v("contact"), tel: v("tel"), email: v("email"), notes: v("notes") };
    const l = entreprises().filter(x => !(sel.fiche && cleEntreprise(x.nom) === cleEntreprise(sel.nom)));
    e.target.disabled = true;
    try { await saveEntreprises([...l, fiche]); an.sel = nom; an.edition = false; window.toast?.("✓ Prestataire enregistré"); }
    catch (err) { alert("Non enregistré : " + (err?.message || err)); e.target.disabled = false; }
  });
  q("[data-an-suppr]")?.addEventListener("click", async () => {
    if (!confirm(`Supprimer la fiche de « ${sel.nom} » ?\n\nSes accès et les demandes qui lui sont confiées ne sont pas supprimés.`)) return;
    try { await saveEntreprises(entreprises().filter(x => cleEntreprise(x.nom) !== cleEntreprise(sel.nom))); an.sel = null; an.edition = false; }
    catch (err) { alert("Suppression impossible : " + (err?.message || err)); }
  });
  q("[data-an-acces-sites]")?.addEventListener("click", async (e) => {
    const b = e.currentTarget, avant = b.textContent; b.disabled = true; b.textContent = "⏳ Chargement des sites…";
    try { const [{ ouvrirAccesSites }, dossiers] = await Promise.all([import("./acces-sites.js"), unDossiers()]); ouvrirAccesSites({ dossiers, user, prerempli: { label: sel.nom, tel: sel.tel || "" } }); }
    catch (err) { alert("Impossible : " + (err?.message || err)); }
    finally { b.disabled = false; b.textContent = avant; }
  });
  container.querySelectorAll("[data-an-copier]").forEach(b => b.onclick = async () => { try { await navigator.clipboard.writeText(lienAcces({ id: b.dataset.anCopier })); window.toast?.("📋 Lien copié"); } catch { prompt("Lien :", lienAcces({ id: b.dataset.anCopier })); } });
  container.querySelectorAll("[data-an-actif]").forEach(b => b.onclick = async () => {
    const actif = b.dataset.v === "1";
    if (!actif && !confirm("Couper cet accès ? Le prestataire ne pourra plus l'ouvrir.")) return;
    try { await setInvitationActive(b.dataset.anActif, actif); } catch (err) { alert("Impossible : " + (err?.message || err)); }
  });
}

export async function mountPrestaAcces(container, user) {
  container.innerHTML = `
    <div class="form-card" style="display:flex;flex-wrap:wrap;gap:10px;align-items:center">
      <div style="flex:1;min-width:240px"><b>🔗 Accès prestataires avec dates</b><div class="hint">Fiches de traçabilité MNA (formulaire ci-dessous) ou dossiers de site (bouton à droite). Tous les accès sont listés plus bas : SMS, mail / image, aperçu, couper.</div></div>
      <button type="button" class="add-btn" id="ph-acces-sites">🏢 Nouvel accès dossiers de site</button>
    </div>
    <div id="ph-acces-liste"></div>`;
  container.querySelector("#ph-acces-sites").addEventListener("click", async (e) => {
    const b = e.currentTarget, avant = b.textContent; b.disabled = true; b.textContent = "⏳ Chargement des sites…";
    try { const [{ ouvrirAccesSites }, dossiers] = await Promise.all([import("./acces-sites.js"), unDossiers()]); ouvrirAccesSites({ dossiers, user }); }
    catch (err) { alert("Impossible : " + (err?.message || err)); }
    finally { b.disabled = false; b.textContent = avant; }
  });
  const { mountAccesRemplacants } = await import("./parametres.js");
  return mountAccesRemplacants(container.querySelector("#ph-acces-liste"), user);
}

export async function mountPrestaLiens(container, user) {
  container.innerHTML = `<div class="form-card"><b>📝 Liens de demande d'intervention</b><div class="hint">Un lien par prestataire présent sur un site (restauration, nettoyage…) : il signale une panne sans compte, la demande arrive ici pour validation.</div></div><div id="ph-liens"></div>`;
  const [{ monterDemandesExternes }, dossiers] = await Promise.all([import("./demandes-externes.js"), unDossiers()]);
  monterDemandesExternes(container.querySelector("#ph-liens"), { lignes: dossiers.map(d => ({ site: d.nom })), utilisateur: user?.nom || user?.email || "" });
}

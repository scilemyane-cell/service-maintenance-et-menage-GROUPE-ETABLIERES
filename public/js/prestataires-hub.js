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

export async function mountPrestaEntreprises(container, user) {
  window.__suiviRaccourci = "prestataires";
  const { mountSuiviDemandesTab } = await import("./suivi-demandes.js");
  return mountSuiviDemandesTab(container, user);
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

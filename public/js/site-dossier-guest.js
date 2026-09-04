// site-dossier-guest.js
// Vue publique, strictement en lecture seule, d'un dossier de site —
// accessible sans compte via un QR code scanné avec l'appareil photo
// habituel du téléphone (voir site-dossier-guest.html, ?dossier=ID).
// Destinée à un intervenant extérieur, un prestataire ou un service de
// secours arrivant sur place : coordonnées d'urgence + organes techniques
// (emplacement, procédure). Les photos ne sont pas affichées ici — leur
// résolution passe par une session Microsoft/SharePoint que ce visiteur
// anonyme n'a pas ; l'appli complète reste le bon endroit pour les voir.

import { esc } from "./astreinte-logic.js";
import { getDossierUnique } from "./site-dossier-data.js";

export async function mountGuestDossier(container, dossierId) {
  container.innerHTML = `<div class="hint">Chargement…</div>`;
  let d;
  try {
    d = await getDossierUnique(dossierId);
  } catch (e) {
    container.innerHTML = `<div class="hint">❌ ${esc(e.message || String(e))}</div>`;
    return;
  }
  if (!d) {
    container.innerHTML = `<div class="hint">Cette fiche n'existe pas ou plus. Contacte ton responsable pour un lien à jour.</div>`;
    return;
  }

  const concernes = (d.sections || []).filter(s => s.concerne);

  container.innerHTML = `
    <div class="stack">
      <div class="stat-chip" style="width:fit-content">👁️ Consultation seule — cette fiche ne peut pas être modifiée depuis ce lien</div>

      <div class="form-card">
        <h2 style="margin:0 0 4px;font-size:20px">${esc(d.nom)}</h2>
        <p class="hint">${esc(d.adresse || "")}</p>
      </div>

      <div class="form-card">
        <h3 style="margin:0 0 10px;font-size:14px;color:var(--gold)">📞 Numéros d'urgence</h3>
        <div class="table-wrap" style="border:none">
          <table>
            <thead><tr><th>Service</th><th>Mission</th><th>Téléphone</th></tr></thead>
            <tbody>
              ${(d.urgences || []).map(u => `
                <tr><td>${esc(u.service)}</td><td>${esc(u.mission)}</td><td><a href="tel:${esc(u.telephone)}" style="color:var(--gold);font-weight:700">${esc(u.telephone)}</a></td></tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>

      <h3 style="margin:12px 0 0;font-size:14px;color:var(--gold)">🔧 Équipements & organes techniques</h3>
      ${concernes.length === 0 ? `<p class="hint">Aucun équipement marqué "concerné" pour l'instant.</p>` :
        concernes.map((s) => `
          <div class="form-card">
            <h4 style="margin:0 0 6px;font-size:14px">${esc(s.titre)}</h4>
            ${s.emplacement ? `<p style="font-size:13px;margin:0 0 4px"><b>Emplacement :</b> ${esc(s.emplacement)}</p>` : ""}
            ${s.procedure ? `<p style="font-size:13px;margin:0 0 4px;color:var(--text-dim)"><b>Procédure :</b> ${esc(s.procedure)}</p>` : ""}
            ${(s.photos || []).length ? `<p class="hint" style="margin:6px 0 0">📎 ${s.photos.length} photo(s) — consultable(s) depuis l'application (connexion complète)</p>` : ""}
          </div>
        `).join("")}
    </div>
  `;
}

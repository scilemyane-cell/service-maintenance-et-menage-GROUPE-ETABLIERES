// tracabilite-guest.js
// Vue publique, strictement en LECTURE SEULE, des fiches de traçabilité
// ménage d'un site — ouverte sans compte via le QR code « lecture seule »
// (onglet Traçabilité > 📱 QR lecture seule ; tracabilite-guest.html?site=ID).
// Aucune écriture : seulement une lecture ponctuelle (pas d'écoute en
// continu) de la liste des sites et des fiches de ce site.

import { db } from "./firebase-init.js";
import { doc, getDoc, getDocs, collection, query, where } from "./firestore-compte.js";
import { fmtShort, esc } from "./astreinte-logic.js";
import { mentionHTML, taskCompletion, ficheHTML, imprimerFiche } from "./tracabilite-rendu.js";

let etat = { site: null, fiches: [], ouverte: null };
let conteneur = null;

export async function mountGuestTracabilite(container, siteId) {
  conteneur = container;
  container.innerHTML = `<div class="hint">Chargement…</div>`;
  try {
    const cfg = await getDoc(doc(db, "config", "menage-sites"));
    etat.site = (cfg.exists() ? cfg.data().sites || [] : []).find(s => s.id === siteId) || null;
    if (!etat.site) {
      container.innerHTML = `<div class="hint">Ce site n'existe pas ou plus. Contacte ton responsable pour un QR code à jour.</div>`;
      return;
    }
    const snap = await getDocs(query(collection(db, "fiches"), where("siteId", "==", siteId)));
    etat.fiches = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .filter(f => !f.supprimeLe)
      .sort((a, b) => (a.weekStart < b.weekStart ? 1 : a.weekStart > b.weekStart ? -1 : String(a.agentNom).localeCompare(String(b.agentNom), "fr")));
  } catch (e) {
    console.error(e);
    container.innerHTML = `<div class="hint">❌ Impossible de charger les fiches : ${esc(e.code || e.message || String(e))}</div>`;
    return;
  }
  rendu();
}

function rendu() {
  const { site, fiches } = etat;
  const ouverte = etat.ouverte ? fiches.find(f => f.id === etat.ouverte) : null;
  const dispositif = site.dispositif || "Dispositif MNA";
  conteneur.innerHTML = `
    <div class="stack">
      <p class="hint" style="margin:0">📍 <b>${esc(site.name)}</b> — ${fiches.length} fiche(s). Consultation seule : rien n'est modifiable ici.</p>
      ${ouverte ? `
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="nav-btn" id="tg-retour">← Retour à la liste</button>
        <button class="add-btn" id="tg-print">🖨️ Imprimer / PDF</button>
      </div>
      ${ficheHTML(ouverte, site, dispositif)}` : `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Semaine</th><th>Agent</th><th>Avancement</th><th>État</th><th></th></tr></thead>
          <tbody>
            ${fiches.length === 0 ? `<tr><td colspan="5" class="empty-row">Aucune fiche pour ce site.</td></tr>` :
              fiches.map(f => {
                const { done, total } = taskCompletion(f, site);
                return `<tr>
                  <td>${fmtShort(new Date(f.weekStart))} → ${fmtShort(new Date(f.weekEnd))}</td>
                  <td>${esc(f.agentNom)}</td>
                  <td>${done}/${total}</td>
                  <td>${f.submitted ? `<span class="tag" style="background:var(--teal)">Terminée</span>` : `<span class="tag" style="background:var(--panel-alt);color:var(--text-dim)">${f.reconstituee && !done ? "À compléter" : "En cours"}</span>`} ${mentionHTML(f, true)}</td>
                  <td><button class="nav-btn" data-voir="${esc(f.id)}" style="padding:4px 10px;font-size:11px">Voir</button></td>
                </tr>`;
              }).join("")}
          </tbody>
        </table>
      </div>`}
    </div>`;
  conteneur.querySelectorAll("[data-voir]").forEach(b => b.addEventListener("click", () => { etat.ouverte = b.dataset.voir; rendu(); window.scrollTo(0, 0); }));
  document.getElementById("tg-retour")?.addEventListener("click", () => { etat.ouverte = null; rendu(); });
  document.getElementById("tg-print")?.addEventListener("click", imprimerFiche);
}

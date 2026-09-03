// export-sharepoint-admin.js
// Tableau de bord de contrôle de l'export quotidien vers SharePoint
// (Administration > Export SharePoint) : vérifier que ça tourne, et
// déclencher un export manuel si besoin (ex. avant la toute première
// connexion Microsoft d'une session).

import { esc } from "./astreinte-logic.js";
import { getStatutExport, exporterMaintenant } from "./export-sharepoint.js";
import { getGraphToken } from "./graph-auth.js";

let mountedContainer = null;
let state = { statut: null, running: false, progress: "" };

export async function mountExportSharepointAdmin(container) {
  mountedContainer = container;
  state = { statut: null, running: false, progress: "" };
  container.innerHTML = `<div class="hint">Chargement…</div>`;
  state.statut = await getStatutExport();
  render();
}

function render() {
  if (!mountedContainer) return;
  if (!document.contains(mountedContainer)) return;

  const today = new Date().toISOString().slice(0, 10);
  const fait = state.statut?.lastExportDate === today;

  mountedContainer.innerHTML = `
    <div class="stack">
      <p class="hint">Un rapport PDF des données (stock central, stock par site, interventions, dossiers de site) est envoyé automatiquement vers SharePoint (dossier "ExportsDonnees") à la connexion, une fois par jour maximum — en plus du stockage principal dans l'appli, pas à la place. Nécessite qu'une session Microsoft soit déjà active dans le navigateur pour se déclencher tout seul.</p>

      <div class="stat-chip ${fait ? 'ok' : 'warn'}" style="width:fit-content">
        ${fait ? `✓ Export effectué aujourd'hui (${state.statut.lastExportAt ? new Date(state.statut.lastExportAt).toLocaleTimeString('fr-FR') : ''})` : "⚠️ Pas encore effectué aujourd'hui"}
      </div>
      ${state.statut?.lastExportAt ? `<p class="hint">Dernier export : ${new Date(state.statut.lastExportAt).toLocaleString('fr-FR')}</p>` : `<p class="hint">Aucun export effectué pour l'instant.</p>`}

      <button class="add-btn" id="exa-run" style="width:fit-content" ${state.running ? "disabled" : ""}>${state.running ? `⏳ Export en cours… ${esc(state.progress)}` : "📤 Exporter maintenant"}</button>
      <div id="exa-status" style="font-size:12px"></div>
    </div>
  `;

  document.getElementById("exa-run").addEventListener("click", async () => {
    state.running = true; render();
    try {
      await exporterMaintenant(getGraphToken, (feuille) => { state.progress = feuille; render(); });
      state.statut = await getStatutExport();
      state.running = false; render();
      document.getElementById("exa-status").innerHTML = `<span style="color:var(--gold)">✓ Export terminé</span>`;
    } catch (e) {
      state.running = false; render();
      document.getElementById("exa-status").innerHTML = `<span style="color:var(--red)">❌ ${esc(e.message || String(e))}</span>`;
    }
  });
}

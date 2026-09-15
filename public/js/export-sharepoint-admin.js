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
// Persiste même si on quitte cet écran puis qu'on y revient — sans ça,
// remonter l'écran pendant qu'un export tourne encore en arrière-plan
// faisait perdre la trace qu'il était en cours, au risque d'en relancer
// un deuxième par-dessus.
let exportEnCoursGlobal = false;
let progressGlobal = "";

export async function mountExportSharepointAdmin(container) {
  mountedContainer = container;
  state = { statut: null, running: exportEnCoursGlobal, progress: progressGlobal };
  container.innerHTML = `<div class="hint">Chargement…</div>`;
  state.statut = await getStatutExport();
  render();
}

function render() {
  if (!mountedContainer) return;
  if (!document.contains(mountedContainer)) return;

  mountedContainer.innerHTML = `
    <div class="stack">
      <p class="hint">Un rapport PDF des données (stock central, stock par site, historique des inventaires, sorties de stock par site, sorties de stock ménage École/Agropolis, interventions, fiches de traçabilité ménage, relevés de compteurs, codes Masterlock) est envoyé automatiquement vers SharePoint à chaque connexion à l'appli — en plus du stockage principal dans l'appli, pas à la place. Chaque module a son propre sous-dossier dans "ExportsDonnees" (Stock, Stock Ménage, Interventions, Menage, Relevé de compteur, Codes Masterlock). Pour les compteurs : un récapitulatif global, un détail par site, et un PDF individuel par compteur (avec courbe d'évolution et historique découpé par année scolaire) rangé par type. Un sous-dossier "Archives" est créé à chaque niveau pour les copies datées, uniquement si les données ont changé depuis le dernier export. Nécessite qu'une session Microsoft soit déjà active dans le navigateur pour se déclencher tout seul.</p>

      <div class="stat-chip ok" style="width:fit-content">
        ${state.statut?.lastExportAt ? `✓ Dernier export : ${new Date(state.statut.lastExportAt).toLocaleString('fr-FR')}` : "Aucun export effectué pour l'instant"}
      </div>

      <button class="add-btn" id="exa-run" style="width:fit-content" ${state.running ? "disabled" : ""}>${state.running ? `⏳ Export en cours… ${esc(state.progress)}` : "📤 Exporter maintenant"}</button>
      ${state.running ? `<p class="hint">Vous pouvez naviguer ailleurs dans l'appli — l'export continue en arrière-plan tant que vous restez sur cette page (fermer complètement l'onglet/l'appli l'interromprait).</p>` : ""}
      <div id="exa-status" style="font-size:12px"></div>
    </div>
  `;

  document.getElementById("exa-run").addEventListener("click", async () => {
    if (exportEnCoursGlobal) return; // sécurité : jamais deux exports en même temps
    exportEnCoursGlobal = true;
    state.running = true; render();
    try {
      await exporterMaintenant(getGraphToken, (feuille) => {
        progressGlobal = feuille; state.progress = feuille; render();
      });
      state.statut = await getStatutExport();
      exportEnCoursGlobal = false; progressGlobal = "";
      state.running = false; render();
      document.getElementById("exa-status").innerHTML = `<span style="color:var(--gold)">✓ Export terminé</span>`;
    } catch (e) {
      exportEnCoursGlobal = false; progressGlobal = "";
      state.running = false; render();
      document.getElementById("exa-status").innerHTML = `<span style="color:var(--red)">❌ ${esc(e.message || String(e))}</span>`;
    }
  });
}

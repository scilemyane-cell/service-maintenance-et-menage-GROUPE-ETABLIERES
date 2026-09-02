// export-sharepoint-admin.js
// Tableau de bord de contrôle de la synchronisation quotidienne vers les
// listes SharePoint (Administration > Export SharePoint) : vérifier que ça
// tourne, déclencher une synchronisation manuelle, et ouvrir chaque liste.

import { esc } from "./astreinte-logic.js";
import { getStatutExport, exporterMaintenant, MODULES, urlListe } from "./export-sharepoint.js";
import { getGraphToken } from "./graph-auth.js";

let mountedContainer = null;
let state = { statut: null, running: false, progress: "", liens: {} };

export async function mountExportSharepointAdmin(container) {
  mountedContainer = container;
  state = { statut: null, running: false, progress: "", liens: {} };
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
      <p class="hint">Les données (stock central, stock par site, interventions, dossiers de site) sont synchronisées vers de vraies listes SharePoint — consultables et filtrables directement dans le navigateur, sans rien télécharger — à la connexion, une fois par jour maximum. Firestore reste la base de travail en temps réel de l'appli ; ceci n'est qu'une copie à jour, en plus. Nécessite qu'une session Microsoft soit déjà active dans le navigateur pour se déclencher tout seul.</p>

      <div class="stat-chip ${fait ? 'ok' : 'warn'}" style="width:fit-content">
        ${fait ? `✓ Synchronisé aujourd'hui (${state.statut.lastExportAt ? new Date(state.statut.lastExportAt).toLocaleTimeString('fr-FR') : ''})` : "⚠️ Pas encore synchronisé aujourd'hui"}
      </div>
      ${state.statut?.lastExportAt ? `<p class="hint">Dernière synchronisation : ${new Date(state.statut.lastExportAt).toLocaleString('fr-FR')}</p>` : `<p class="hint">Aucune synchronisation effectuée pour l'instant.</p>`}

      <button class="add-btn" id="exa-run" style="width:fit-content" ${state.running ? "disabled" : ""}>${state.running ? `⏳ Synchronisation en cours… ${esc(state.progress)}` : "🔄 Synchroniser maintenant"}</button>
      <div id="exa-status" style="font-size:12px"></div>

      <div class="form-card">
        <h3 style="margin:0 0 10px;font-size:14px;color:var(--gold)">Listes SharePoint</h3>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${MODULES.map(m => `
            <div style="display:flex;align-items:center;gap:10px">
              <span style="flex:1">${esc(m.nom)}</span>
              <button class="nav-btn" data-open-liste="${esc(m.nom)}" style="padding:4px 10px;font-size:11px">Ouvrir dans SharePoint ↗</button>
            </div>
          `).join("")}
        </div>
      </div>
    </div>
  `;

  document.getElementById("exa-run").addEventListener("click", async () => {
    state.running = true; render();
    try {
      await exporterMaintenant(getGraphToken, (nom) => { state.progress = nom; render(); });
      state.statut = await getStatutExport();
      state.running = false; render();
      document.getElementById("exa-status").innerHTML = `<span style="color:var(--gold)">✓ Synchronisation terminée</span>`;
    } catch (e) {
      state.running = false; render();
      document.getElementById("exa-status").innerHTML = `<span style="color:var(--red)">❌ ${esc(e.message || String(e))}</span>`;
    }
  });

  mountedContainer.querySelectorAll("[data-open-liste]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const nom = btn.dataset.openListe;
      btn.textContent = "⏳…";
      try {
        const url = await urlListe(nom);
        if (url) window.open(url, "_blank");
        else alert(`La liste "${nom}" n'existe pas encore — lance une synchronisation d'abord.`);
      } catch (e) {
        alert("Échec : " + (e.message || e));
      }
      btn.textContent = "Ouvrir dans SharePoint ↗";
    });
  });
}

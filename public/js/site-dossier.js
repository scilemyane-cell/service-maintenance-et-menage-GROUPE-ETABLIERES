import { esc } from "./astreinte-logic.js";
import {
  watchSitesDossiers, nouveauDossier, createDossier, saveDossier, deleteDossier,
} from "./site-dossier-data.js";

let state = { dossiers: [] };
let ui = { openId: null, mode: "view" }; // mode: "view" | "edit"
let unsubs = [];
let mountedContainer = null;
let mountedUser = null;

function cleanup() { unsubs.forEach(u => u()); unsubs = []; }
function isEditorUser(user) { return user && (user.role === "admin" || user.role === "n1"); }

export function mountSitesDossiers(container, user) {
  cleanup();
  mountedContainer = container;
  mountedUser = user;
  container.innerHTML = `<div class="hint">Chargement…</div>`;
  unsubs.push(watchSitesDossiers((d) => { state.dossiers = d; render(); }));
}

function render() {
  if (!mountedContainer) return;
  if (!document.contains(mountedContainer)) { cleanup(); return; }

  const opened = ui.openId ? state.dossiers.find(d => d.id === ui.openId) : null;

  if (opened) {
    if (ui.mode === "edit") renderEdit(opened); else renderView(opened);
    return;
  }

  mountedContainer.innerHTML = `
    <div class="stack">
      <p class="hint">Dossier technique et sécurité de chaque résidence — organes de coupure, accès clés, contacts d'urgence. Structure uniforme reprise de la fiche index papier.</p>
      ${isEditorUser(mountedUser) ? `<button class="add-btn" id="sd-new" style="width:fit-content">➕ Créer un nouveau dossier</button>` : ""}
      <div class="bubble-grid">
        ${state.dossiers.length === 0 ? `<p class="hint">Aucun dossier créé pour l'instant.</p>` :
          state.dossiers.map(d => `
            <button class="bubble-card" data-open="${d.id}">
              <span class="bubble-icon">🏢</span>
              <span class="bubble-label">${esc(d.nom)}</span>
              <span class="bubble-desc">${esc(d.adresse || "Adresse non renseignée")}</span>
            </button>
          `).join("")}
      </div>
    </div>
  `;

  document.getElementById("sd-new")?.addEventListener("click", async () => {
    const id = await createDossier(nouveauDossier());
    ui.openId = id; ui.mode = "edit"; render();
  });
  mountedContainer.querySelectorAll("[data-open]").forEach(btn => {
    btn.addEventListener("click", () => { ui.openId = btn.dataset.open; ui.mode = "view"; render(); });
  });
}

// =================================================================
// Vue de consultation (imprimable)
// =================================================================
function renderView(d) {
  mountedContainer.innerHTML = `
    <div class="stack">
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="nav-btn" id="sd-back">← Tous les dossiers</button>
        ${isEditorUser(mountedUser) ? `<button class="nav-btn" id="sd-edit">✏️ Modifier</button>` : ""}
        <button class="add-btn" id="sd-print">🖨️ Exporter en PDF (imprimer)</button>
        ${isEditorUser(mountedUser) ? `<button class="del-btn" id="sd-del" style="border:1px solid var(--red);border-radius:8px;padding:9px 16px">🗑️ Supprimer</button>` : ""}
      </div>

      <div class="print-fiche" style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:24px;color:#111">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:18px">
          <img src="img/logo-etablieres.png" alt="Groupe Établières" style="height:60px">
          <span style="font-size:13px">Dossier technique & sécurité</span>
        </div>
        <p style="font-size:18px;font-weight:700;margin:0 0 4px">${esc(d.nom)}</p>
        <p style="font-size:13px;color:#555;margin:0 0 20px">${esc(d.adresse || "")}</p>

        <p style="font-size:14px;font-weight:700;margin:0 0 8px">NUMÉROS D'URGENCE</p>
        <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
          <thead><tr>
            <th style="border:1px solid #999;padding:4px 6px;font-size:11px;text-align:left">Service</th>
            <th style="border:1px solid #999;padding:4px 6px;font-size:11px;text-align:left">Mission</th>
            <th style="border:1px solid #999;padding:4px 6px;font-size:11px;text-align:left">Téléphone</th>
          </tr></thead>
          <tbody>
            ${(d.urgences || []).map(u => `
              <tr>
                <td style="border:1px solid #999;padding:4px 6px;font-size:11px">${esc(u.service)}</td>
                <td style="border:1px solid #999;padding:4px 6px;font-size:11px">${esc(u.mission)}</td>
                <td style="border:1px solid #999;padding:4px 6px;font-size:11px;font-weight:700">${esc(u.telephone)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>

        <p style="font-size:14px;font-weight:700;margin:0 0 8px">ÉQUIPEMENTS & ORGANES TECHNIQUES</p>
        <table style="width:100%;border-collapse:collapse;margin-bottom:8px">
          <thead><tr>
            <th style="border:1px solid #999;padding:4px 6px;font-size:11px;text-align:left">Équipement</th>
            <th style="border:1px solid #999;padding:4px 6px;font-size:11px;text-align:center">Concerné</th>
            <th style="border:1px solid #999;padding:4px 6px;font-size:11px;text-align:left">Emplacement</th>
            <th style="border:1px solid #999;padding:4px 6px;font-size:11px;text-align:left">Procédure / consignes</th>
          </tr></thead>
          <tbody>
            ${(d.sections || []).map(s => `
              <tr>
                <td style="border:1px solid #999;padding:4px 6px;font-size:11px">${esc(s.titre)}</td>
                <td style="border:1px solid #999;padding:4px 6px;font-size:11px;text-align:center">${s.concerne ? "✓ Oui" : "Non"}</td>
                <td style="border:1px solid #999;padding:4px 6px;font-size:11px">${esc(s.emplacement || "")}</td>
                <td style="border:1px solid #999;padding:4px 6px;font-size:11px">${esc(s.procedure || "")}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
        <p style="font-size:10px;color:#666;margin-top:16px">Ce document doit rester consultable librement par tout intervenant extérieur, technicien de maintenance, prestataire ou service de secours dès son arrivée sur site.</p>
      </div>
    </div>
  `;

  document.getElementById("sd-back").addEventListener("click", () => { ui.openId = null; render(); });
  document.getElementById("sd-edit")?.addEventListener("click", () => { ui.mode = "edit"; render(); });
  document.getElementById("sd-print").addEventListener("click", () => { window.print(); });
  document.getElementById("sd-del")?.addEventListener("click", async () => {
    if (confirm(`Supprimer définitivement le dossier "${d.nom}" ?`)) {
      await deleteDossier(d.id);
      ui.openId = null;
      render();
    }
  });
}

// =================================================================
// Édition
// =================================================================
function renderEdit(dOriginal, workingCopy) {
  // `workingCopy` : quand fourni (ajout/suppression de ligne), on continue
  // d'éditer les données déjà en mémoire au lieu de repartir de zéro.
  const data = workingCopy || JSON.parse(JSON.stringify(dOriginal));

  mountedContainer.innerHTML = `
    <div class="stack">
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="nav-btn" id="sd-cancel">✕ Annuler</button>
        <button class="add-btn" id="sd-save">💾 Enregistrer</button>
        <span id="sd-save-status" style="font-size:12px;align-self:center"></span>
      </div>

      <div class="form-card">
        <div class="form-grid">
          <label>Nom de la résidence<input id="sd-nom" value="${esc(data.nom)}"></label>
          <label>Adresse<input id="sd-adresse" value="${esc(data.adresse || '')}"></label>
        </div>
      </div>

      <div class="form-card">
        <h3 style="margin:0 0 10px;font-size:14px;color:var(--gold)">Numéros d'urgence</h3>
        <div class="table-wrap" style="border:none">
          <table>
            <thead><tr><th>Service</th><th>Mission</th><th>Téléphone</th><th></th></tr></thead>
            <tbody>
              ${data.urgences.map((u, i) => `
                <tr>
                  <td><input data-urg-service="${i}" value="${esc(u.service)}" style="width:100%"></td>
                  <td><input data-urg-mission="${i}" value="${esc(u.mission)}" style="width:100%"></td>
                  <td><input data-urg-tel="${i}" value="${esc(u.telephone)}" style="width:100%"></td>
                  <td><button class="del-btn" data-del-urg="${i}">🗑️</button></td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
        <button class="nav-btn" id="sd-add-urg" style="margin-top:10px">➕ Ajouter un contact</button>
      </div>

      <div class="form-card">
        <h3 style="margin:0 0 10px;font-size:14px;color:var(--gold)">Équipements & organes techniques</h3>
        <div class="table-wrap" style="border:none">
          <table>
            <thead><tr><th>Équipement</th><th style="width:80px">Concerné</th><th>Emplacement</th><th>Procédure / consignes</th><th></th></tr></thead>
            <tbody>
              ${data.sections.map((s, i) => `
                <tr>
                  <td><input data-sec-titre="${i}" value="${esc(s.titre)}" style="width:100%"></td>
                  <td style="text-align:center"><input type="checkbox" data-sec-concerne="${i}" ${s.concerne ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--gold)"></td>
                  <td><input data-sec-emplacement="${i}" value="${esc(s.emplacement || '')}" placeholder="ex. hall d'entrée, placard technique…" style="width:100%"></td>
                  <td><input data-sec-procedure="${i}" value="${esc(s.procedure || '')}" placeholder="ex. clé de levage requise…" style="width:100%"></td>
                  <td><button class="del-btn" data-del-sec="${i}">🗑️</button></td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
        <button class="nav-btn" id="sd-add-sec" style="margin-top:10px">➕ Ajouter un équipement</button>
      </div>

      <button class="add-btn" id="sd-save-bottom">💾 Enregistrer</button>
    </div>
  `;

  document.getElementById("sd-nom").addEventListener("input", (e) => { data.nom = e.target.value; });
  document.getElementById("sd-adresse").addEventListener("input", (e) => { data.adresse = e.target.value; });

  mountedContainer.querySelectorAll("[data-urg-service]").forEach(inp => inp.addEventListener("input", () => { data.urgences[inp.dataset.urgService].service = inp.value; }));
  mountedContainer.querySelectorAll("[data-urg-mission]").forEach(inp => inp.addEventListener("input", () => { data.urgences[inp.dataset.urgMission].mission = inp.value; }));
  mountedContainer.querySelectorAll("[data-urg-tel]").forEach(inp => inp.addEventListener("input", () => { data.urgences[inp.dataset.urgTel].telephone = inp.value; }));
  mountedContainer.querySelectorAll("[data-del-urg]").forEach(btn => btn.addEventListener("click", () => { data.urgences.splice(parseInt(btn.dataset.delUrg, 10), 1); renderEdit(dOriginal, data); }));
  document.getElementById("sd-add-urg").addEventListener("click", () => { data.urgences.push({ service: "", mission: "", telephone: "" }); renderEdit(dOriginal, data); });

  mountedContainer.querySelectorAll("[data-sec-titre]").forEach(inp => inp.addEventListener("input", () => { data.sections[inp.dataset.secTitre].titre = inp.value; }));
  mountedContainer.querySelectorAll("[data-sec-concerne]").forEach(cb => cb.addEventListener("change", () => { data.sections[cb.dataset.secConcerne].concerne = cb.checked; }));
  mountedContainer.querySelectorAll("[data-sec-emplacement]").forEach(inp => inp.addEventListener("input", () => { data.sections[inp.dataset.secEmplacement].emplacement = inp.value; }));
  mountedContainer.querySelectorAll("[data-sec-procedure]").forEach(inp => inp.addEventListener("input", () => { data.sections[inp.dataset.secProcedure].procedure = inp.value; }));
  mountedContainer.querySelectorAll("[data-del-sec]").forEach(btn => btn.addEventListener("click", () => { data.sections.splice(parseInt(btn.dataset.delSec, 10), 1); renderEdit(dOriginal, data); }));
  document.getElementById("sd-add-sec").addEventListener("click", () => { data.sections.push({ titre: "Nouvel équipement", concerne: false, emplacement: "", procedure: "" }); renderEdit(dOriginal, data); });

  document.getElementById("sd-cancel").addEventListener("click", () => { ui.mode = "view"; render(); });
  const doSave = async () => {
    const statusEl = document.getElementById("sd-save-status");
    statusEl.innerHTML = `<span style="color:var(--text-dim)">⏳ Enregistrement…</span>`;
    try {
      await saveDossier(dOriginal.id, data);
      ui.mode = "view";
      render();
    } catch (e) {
      statusEl.innerHTML = `<span style="color:var(--red)">❌ Échec : ${esc(e.message || String(e))}</span>`;
    }
  };
  document.getElementById("sd-save").addEventListener("click", doSave);
  document.getElementById("sd-save-bottom").addEventListener("click", doSave);
}

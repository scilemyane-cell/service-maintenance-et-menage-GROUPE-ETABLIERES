// previsionnel.js
// Écran du nouvel onglet "📋 Prévisionnel Travaux" — voir
// previsionnel-data.js pour le contexte complet (besoin exprimé par
// Frédéric Legrand). Chaque ligne = un besoin de travaux identifié sur
// un site, à budgéter et proposer au conseil d'administration.

import { esc } from "./astreinte-logic.js";
import {
  watchLignes, creerLigne, modifierLigne, changerStatut, changerAvancement, supprimerLigne,
  nouvelleLigne, CATEGORIES_TRAVAUX, PRIORITES, STATUTS, AVANCEMENTS, anneesDisponibles, formatAnneeVisee,
} from "./previsionnel-data.js";
import { watchSitesDossiers } from "./site-dossier-data.js";
import { watchAssociations } from "./associations-data.js";
import { getAccessToken, uploadToDrive, getImageDisplayUrl, deleteDriveItem, DOSSIERS_ROOT_FOLDER } from "./sharepoint-storage.js";

let mountedContainer = null;
let mountedUser = null;
let state = { lignes: [], sites: [], associations: [] };
let ui = { filtreAnnee: "toutes", filtreSite: "toutes", filtrePriorite: "toutes", filtreStatut: "actives", addingOpen: false, editingId: null, form: null, vueEnsemble: false };
let unsubs = [];

export async function mountPrevisionnel(container, user) {
  mountedContainer = container;
  mountedUser = user;
  state = { lignes: [], sites: [], associations: [] };
  ui = { filtreAnnee: "toutes", filtreSite: "toutes", filtrePriorite: "toutes", filtreStatut: "actives", addingOpen: false, editingId: null, form: null, vueEnsemble: false };
  unsubs.forEach(u => u());
  container.innerHTML = `<div class="hint">Chargement…</div>`;
  unsubs = [
    watchLignes((l) => { state.lignes = l; render(); }),
    watchSitesDossiers((s) => { state.sites = s; render(); }),
    watchAssociations((a) => { state.associations = a; render(); }),
  ];
}

function formatMontant(m) {
  return (m || 0).toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
}
function formatDate(ms) {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}
function labelPriorite(p) { return PRIORITES[p] || p; }
function labelStatut(s) { return STATUTS[s] || s; }
function labelAvancement(a) { return AVANCEMENTS[a] || "Non renseigné"; }

function lignesFiltrees() {
  return state.lignes.filter(l => {
    if (ui.filtreAnnee !== "toutes" && `${l.typeAnnee || "civile"}-${l.anneeVisee}` !== String(ui.filtreAnnee)) return false;
    if (ui.filtreSite !== "toutes" && l.dossierId !== ui.filtreSite) return false;
    if (ui.filtrePriorite !== "toutes" && l.priorite !== ui.filtrePriorite) return false;
    if (ui.filtreStatut === "actives" && (l.statut === "refuse" || l.statut === "reporte")) return false;
    if (ui.filtreStatut !== "toutes" && ui.filtreStatut !== "actives" && l.statut !== ui.filtreStatut) return false;
    return true;
  });
}

function render() {
  if (!mountedContainer || !document.contains(mountedContainer)) return;
  if (ui.vueEnsemble) return renderVueEnsemble();
  renderListe();
}

function renderListe() {
  const lignes = lignesFiltrees();
  const total = lignes.reduce((s, l) => s + (l.montantEstime || 0), 0);
  const annees = anneesDisponibles(state.lignes);

  mountedContainer.innerHTML = `
    <div class="stack">
      <p class="hint">Prévisionnel travaux/investissement, saisi au fil de l'eau plutôt que reconstitué au moment du budget. Un montant total se calcule automatiquement selon les filtres choisis, et les exports ci-dessous suivent aussi ces mêmes filtres.</p>

      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="add-btn" id="pv-add">➕ Ajouter un besoin de travaux</button>
        <button class="nav-btn" id="pv-export">🖨️ Exporter en PDF pour le CA</button>
        <button class="nav-btn" id="pv-export-excel">📊 Exporter en Excel (filtré)</button>
        <button class="nav-btn" id="pv-vue-ensemble" style="border-color:var(--teal);color:var(--teal)">📈 Vue d'ensemble (suivi des travaux validés)</button>
      </div>

      <div class="filters-row" style="flex-wrap:wrap;gap:8px">
        <select id="pv-f-annee">
          <option value="toutes">Toutes années</option>
          ${annees.map(a => `<option value="${a.valeur}" ${String(ui.filtreAnnee) === String(a.valeur) ? "selected" : ""}>${a.libelle}</option>`).join("")}
        </select>
        <select id="pv-f-site">
          <option value="toutes">Tous les sites</option>
          ${state.sites.map(s => `<option value="${s.id}" ${ui.filtreSite === s.id ? "selected" : ""}>${esc(s.nom)}</option>`).join("")}
        </select>
        <select id="pv-f-priorite">
          <option value="toutes">Toutes priorités</option>
          ${Object.entries(PRIORITES).map(([k, v]) => `<option value="${k}" ${ui.filtrePriorite === k ? "selected" : ""}>${v}</option>`).join("")}
        </select>
        <select id="pv-f-statut">
          <option value="actives" ${ui.filtreStatut === "actives" ? "selected" : ""}>En cours (proposé/validé)</option>
          <option value="toutes" ${ui.filtreStatut === "toutes" ? "selected" : ""}>Tous statuts</option>
          ${Object.entries(STATUTS).map(([k, v]) => `<option value="${k}" ${ui.filtreStatut === k ? "selected" : ""}>${v}</option>`).join("")}
        </select>
      </div>

      <div class="stat-chip" style="width:fit-content;font-weight:700">💰 Total (filtré) : ${formatMontant(total)} — ${lignes.length} ligne(s)</div>

      ${ui.addingOpen ? renderForm(null) : ""}

      ${lignes.length === 0 ? `<p class="hint">Aucune ligne pour ces filtres.</p>` : lignes.map(l => `
        <div class="form-card" style="margin-bottom:10px">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap">
            <div style="min-width:0">
              <p style="margin:0;font-weight:700">${esc(l.titre || l.categorie)} <span style="font-weight:400;color:var(--text-dim);font-size:12px">— ${esc(l.dossierNom || "Site non renseigné")}</span></p>
              <p style="margin:2px 0 0;font-size:12px;color:var(--text-dim)">${esc(l.categorie)} · ${formatAnneeVisee(l)}${l.typeAnnee === "scolaire" ? " (année scolaire)" : ""} · ${labelPriorite(l.priorite)}</p>
              ${l.description ? `<p style="margin:4px 0 0;font-size:13px">${esc(l.description)}</p>` : ""}
              ${l.motif ? `<p style="margin:2px 0 0;font-size:12px;color:var(--text-dim)"><b>Motif :</b> ${esc(l.motif)}</p>` : ""}
              <p style="margin:4px 0 0;font-size:12px">Statut : <b>${labelStatut(l.statut)}</b>${l.dateStatut ? ` le ${formatDate(l.dateStatut)}${l.statutParNom ? " par " + esc(l.statutParNom) : ""}` : ""}</p>
              ${l.statut === "valide" ? `<p style="margin:2px 0 0;font-size:12px">Avancement : <b>${labelAvancement(l.avancement)}</b></p>` : ""}
            </div>
            <div style="text-align:right;flex:none">
              <p style="margin:0;font-size:20px;font-weight:800;color:var(--gold)">${formatMontant(l.montantEstime)}</p>
              <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap;justify-content:flex-end">
                <button class="nav-btn" data-edit-pv="${l.id}" style="padding:5px 9px;font-size:11px">✏️</button>
                <button class="del-btn" data-del-pv="${l.id}" style="padding:5px 9px;font-size:11px">🗑️</button>
              </div>
            </div>
          </div>
          ${(l.photos || []).length ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">${l.photos.map(p => `<img ${p.itemId ? `data-resolve-img-pv="${esc(p.itemId)}"` : `src="${esc(p.url)}"`} alt="" style="width:50px;height:50px;object-fit:cover;border-radius:6px;border:1px solid var(--border)" onerror="this.style.opacity=0.3">`).join("")}</div>` : ""}
          ${l.statut === "propose" ? `
            <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
              <button class="nav-btn" data-statut="${l.id}:valide" style="border-color:var(--teal);color:var(--teal);font-size:12px">✅ Marquer Validé</button>
              <button class="nav-btn" data-statut="${l.id}:refuse" style="border-color:var(--red);color:var(--red);font-size:12px">❌ Marquer Refusé</button>
              <button class="nav-btn" data-statut="${l.id}:reporte" style="font-size:12px">⏳ Reporter</button>
            </div>
          ` : l.statut === "valide" ? `
            <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;align-items:center">
              <label style="font-size:12px">Avancement
                <select data-avancement="${l.id}">
                  <option value="">— Non renseigné —</option>
                  ${Object.entries(AVANCEMENTS).map(([k, v]) => `<option value="${k}" ${l.avancement === k ? "selected" : ""}>${v}</option>`).join("")}
                </select>
              </label>
              <button class="nav-btn" data-statut="${l.id}:propose" style="font-size:11px">↩️ Remettre en Proposé</button>
            </div>
          ` : `<button class="nav-btn" data-statut="${l.id}:propose" style="margin-top:8px;font-size:11px">↩️ Remettre en Proposé</button>`}
          ${ui.editingId === l.id ? renderForm(l) : ""}
        </div>
      `).join("")}
    </div>
  `;

  document.getElementById("pv-add").addEventListener("click", () => { ui.addingOpen = !ui.addingOpen; ui.editingId = null; render(); });
  document.getElementById("pv-export").addEventListener("click", () => exporterPourCA(lignes));
  document.getElementById("pv-export-excel").addEventListener("click", () => exporterExcel(lignes));
  document.getElementById("pv-vue-ensemble").addEventListener("click", () => { ui.vueEnsemble = true; render(); });
  document.getElementById("pv-f-annee").addEventListener("change", (e) => { ui.filtreAnnee = e.target.value; render(); });
  document.getElementById("pv-f-site").addEventListener("change", (e) => { ui.filtreSite = e.target.value; render(); });
  document.getElementById("pv-f-priorite").addEventListener("change", (e) => { ui.filtrePriorite = e.target.value; render(); });
  document.getElementById("pv-f-statut").addEventListener("change", (e) => { ui.filtreStatut = e.target.value; render(); });

  mountedContainer.querySelectorAll("[data-avancement]").forEach(sel => sel.addEventListener("change", async (e) => {
    try { await changerAvancement(sel.dataset.avancement, e.target.value || null, mountedUser); } catch (err) { alert("Erreur : " + (err.message || err)); }
  }));
  mountedContainer.querySelectorAll("[data-edit-pv]").forEach(btn => btn.addEventListener("click", () => {
    ui.editingId = ui.editingId === btn.dataset.editPv ? null : btn.dataset.editPv;
    ui.addingOpen = false;
    render();
  }));
  mountedContainer.querySelectorAll("[data-del-pv]").forEach(btn => btn.addEventListener("click", async () => {
    if (!confirm("Supprimer définitivement cette ligne de prévisionnel ?")) return;
    try { await supprimerLigne(btn.dataset.delPv); } catch (e) { alert("Erreur : " + (e.message || e)); }
  }));
  mountedContainer.querySelectorAll("[data-statut]").forEach(btn => btn.addEventListener("click", async () => {
    const [id, statut] = btn.dataset.statut.split(":");
    try { await changerStatut(id, statut, mountedUser); } catch (e) { alert("Erreur : " + (e.message || e)); }
  }));
  mountedContainer.querySelectorAll("[data-resolve-img-pv]").forEach(async (img) => {
    try { img.src = await getImageDisplayUrl(img.dataset.resolveImgPv); } catch (e) { img.style.opacity = "0.3"; }
  });

  attacherFormulaireListeners();
}

function renderForm(ligneExistante) {
  const l = ligneExistante || nouvelleLigne();
  const prefix = ligneExistante ? "pv-edit" : "pv-new";
  return `
    <div class="form-card" style="margin:10px 0;background:var(--panel-alt)">
      <h4 style="margin:0 0 10px;font-size:14px">${ligneExistante ? "Modifier — " + esc(l.titre || l.categorie) : "Nouveau besoin de travaux"}</h4>
      <div class="form-grid">
        <label>Site
          <select id="${prefix}-site">
            <option value="">— Choisir —</option>
            ${state.sites.map(s => `<option value="${s.id}" ${l.dossierId === s.id ? "selected" : ""}>${esc(s.nom)}</option>`).join("")}
          </select>
        </label>
        <label>Catégorie
          <select id="${prefix}-categorie">
            <option value="">— Choisir —</option>
            ${CATEGORIES_TRAVAUX.map(c => `<option value="${esc(c)}" ${l.categorie === c ? "selected" : ""}>${esc(c)}</option>`).join("")}
          </select>
        </label>
        <label>Titre court<input id="${prefix}-titre" value="${esc(l.titre || "")}" placeholder="ex. Réfection toiture bâtiment A"></label>
        <label>Montant estimé (€)<input id="${prefix}-montant" type="number" min="0" step="100" value="${l.montantEstime || 0}"></label>
        <label>Type d'année
          <select id="${prefix}-typeannee">
            <option value="civile" ${l.typeAnnee !== "scolaire" ? "selected" : ""}>Année civile</option>
            <option value="scolaire" ${l.typeAnnee === "scolaire" ? "selected" : ""}>Année scolaire</option>
          </select>
        </label>
        <label>Année visée (début si scolaire)<input id="${prefix}-annee" type="number" min="2020" max="2100" value="${l.anneeVisee}"></label>
        <label>Priorité
          <select id="${prefix}-priorite">
            ${Object.entries(PRIORITES).map(([k, v]) => `<option value="${k}" ${l.priorite === k ? "selected" : ""}>${v}</option>`).join("")}
          </select>
        </label>
      </div>
      <label style="display:block;margin-top:8px">Description<input id="${prefix}-description" value="${esc(l.description || "")}" placeholder="détail du besoin"></label>
      <label style="display:block;margin-top:8px">Motif / justification (optionnel)<input id="${prefix}-motif" value="${esc(l.motif || "")}" placeholder="ex. état constaté, obligation réglementaire…"></label>

      <label style="display:block;font-size:11px;color:var(--text-dim);margin-top:10px">Photo(s) (optionnel)</label>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:6px">
        ${(l.photos || []).map((p, pi) => `
          <div style="position:relative">
            ${p.itemId ? `<img data-resolve-img-pv="${esc(p.itemId)}" alt="" style="width:56px;height:56px;object-fit:cover;border-radius:6px;border:1px solid var(--border)" onerror="this.style.opacity=0.3">` : `<img src="${esc(p.url)}" alt="" style="width:56px;height:56px;object-fit:cover;border-radius:6px;border:1px solid var(--border)">`}
            <button data-del-photo-pv="${prefix}:${pi}" style="position:absolute;top:-6px;right:-6px;background:var(--red);color:#fff;border:none;border-radius:50%;width:18px;height:18px;font-size:10px;cursor:pointer;line-height:1">✕</button>
          </div>
        `).join("")}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button type="button" class="nav-btn" data-photo-camera="${prefix}" style="font-size:12px">📷 Prendre une photo</button>
        <button type="button" class="nav-btn" data-photo-file="${prefix}" style="font-size:12px">📎 Importer un fichier</button>
        <input type="file" accept="image/*" capture="environment" id="${prefix}-photo-input-camera" style="display:none">
        <input type="file" id="${prefix}-photo-input-file" style="display:none">
      </div>
      <div id="${prefix}-photo-status" style="font-size:11px;margin-top:4px"></div>

      <div style="display:flex;gap:8px;margin-top:12px">
        <button class="add-btn" id="${prefix}-save">💾 Enregistrer</button>
        <button class="nav-btn" id="${prefix}-cancel">Annuler</button>
      </div>
      <div id="${prefix}-status" style="font-size:12px;margin-top:8px"></div>
    </div>
  `;
}

let formPhotos = { "pv-new": [], "pv-edit": [] };

function attacherFormulaireListeners() {
  ["pv-new", "pv-edit"].forEach(prefix => {
    const saveBtn = document.getElementById(`${prefix}-save`);
    if (!saveBtn) return;

    const ligneExistante = prefix === "pv-edit" ? state.lignes.find(x => x.id === ui.editingId) : null;
    if (!formPhotos[prefix] || (prefix === "pv-edit" && formPhotos.editingIdActuel !== ui.editingId)) {
      formPhotos[prefix] = ligneExistante ? [...(ligneExistante.photos || [])] : [];
      if (prefix === "pv-edit") formPhotos.editingIdActuel = ui.editingId;
    }

    document.getElementById(`${prefix}-cancel`).addEventListener("click", () => {
      if (prefix === "pv-new") { ui.addingOpen = false; formPhotos["pv-new"] = []; }
      else { ui.editingId = null; formPhotos["pv-edit"] = []; }
      render();
    });

    const inputCamera = document.getElementById(`${prefix}-photo-input-camera`);
    const inputFile = document.getElementById(`${prefix}-photo-input-file`);
    const statusEl = document.getElementById(`${prefix}-photo-status`);
    const declencher = async (input) => {
      statusEl.innerHTML = `<span style="color:var(--text-dim)">⏳ Connexion…</span>`;
      try {
        const token = await getAccessToken();
        statusEl.innerHTML = "";
        input.dataset.readyToken = token;
        input.click();
      } catch (e) {
        statusEl.innerHTML = `<span style="color:var(--red)">❌ ${esc(e.message || String(e))}</span>`;
      }
    };
    document.querySelector(`[data-photo-camera="${prefix}"]`)?.addEventListener("click", () => declencher(inputCamera));
    document.querySelector(`[data-photo-file="${prefix}"]`)?.addEventListener("click", () => declencher(inputFile));
    [inputCamera, inputFile].forEach(input => input?.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const siteNom = document.getElementById(`${prefix}-site`).selectedOptions[0]?.text || "Site non renseigné";
      const titre = document.getElementById(`${prefix}-titre`).value.trim() || "Besoin de travaux";
      statusEl.innerHTML = `<span style="color:var(--text-dim)">⏳ Envoi…</span>`;
      try {
        const { url, itemId, isImage, name } = await uploadToDrive(file, e.target.dataset.readyToken, [siteNom, "Prévisionnel Travaux", titre], DOSSIERS_ROOT_FOLDER);
        formPhotos[prefix].push({ url, itemId, isImage, name });
        render();
      } catch (err) {
        statusEl.innerHTML = `<span style="color:var(--red)">❌ Échec : ${esc(err.message || String(err))}</span>`;
      }
    }));
    mountedContainer.querySelectorAll(`[data-del-photo-pv^="${prefix}:"]`).forEach(btn => btn.addEventListener("click", () => {
      const pi = parseInt(btn.dataset.delPhotoPv.split(":")[1], 10);
      formPhotos[prefix].splice(pi, 1);
      render();
    }));

    saveBtn.addEventListener("click", async () => {
      const statusEl2 = document.getElementById(`${prefix}-status`);
      const siteSelect = document.getElementById(`${prefix}-site`);
      const data = {
        dossierId: siteSelect.value,
        dossierNom: siteSelect.selectedOptions[0]?.text || "",
        categorie: document.getElementById(`${prefix}-categorie`).value,
        titre: document.getElementById(`${prefix}-titre`).value.trim(),
        montantEstime: parseFloat(document.getElementById(`${prefix}-montant`).value) || 0,
        anneeVisee: parseInt(document.getElementById(`${prefix}-annee`).value, 10) || new Date().getFullYear() + 1,
        typeAnnee: document.getElementById(`${prefix}-typeannee`).value,
        priorite: document.getElementById(`${prefix}-priorite`).value,
        description: document.getElementById(`${prefix}-description`).value.trim(),
        motif: document.getElementById(`${prefix}-motif`).value.trim(),
        photos: formPhotos[prefix],
      };
      if (!data.categorie) { statusEl2.innerHTML = `<span style="color:var(--red)">La catégorie est obligatoire.</span>`; return; }
      statusEl2.innerHTML = `<span style="color:var(--text-dim)">⏳ Enregistrement…</span>`;
      try {
        if (prefix === "pv-edit" && ligneExistante) {
          await modifierLigne(ligneExistante.id, data);
          ui.editingId = null;
        } else {
          await creerLigne(data.dossierId, data.dossierNom, { ...nouvelleLigne(), ...data, statut: "propose" }, mountedUser);
          ui.addingOpen = false;
        }
        formPhotos[prefix] = [];
        render();
      } catch (e) {
        statusEl2.innerHTML = `<span style="color:var(--red)">❌ ${esc(e.message || String(e))}</span>`;
      }
    });
  });
}

// Export PDF prêt pour le conseil d'administration — groupé par site,
// avec le logo Établières, dans le même esprit que les autres exports
// de l'appli.
function exporterPourCA(lignes) {
  const parSite = new Map();
  lignes.forEach(l => {
    const nomSite = l.dossierNom || "Site non renseigné";
    if (!parSite.has(nomSite)) parSite.set(nomSite, []);
    parSite.get(nomSite).push(l);
  });
  const total = lignes.reduce((s, l) => s + (l.montantEstime || 0), 0);

  const ligneHTML = (l) => `
    <tr>
      <td style="border:1px solid #ccc;padding:4px 6px;font-size:11px">${esc(l.categorie)}</td>
      <td style="border:1px solid #ccc;padding:4px 6px;font-size:11px">${esc(l.titre || l.description || "")}</td>
      <td style="border:1px solid #ccc;padding:4px 6px;font-size:11px;text-align:center">${formatAnneeVisee(l)}</td>
      <td style="border:1px solid #ccc;padding:4px 6px;font-size:11px">${labelPriorite(l.priorite)}</td>
      <td style="border:1px solid #ccc;padding:4px 6px;font-size:11px;text-align:right;font-weight:700">${formatMontant(l.montantEstime)}</td>
    </tr>
  `;

  const html = `
    <div class="print-fiche" style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:0;color:#111;overflow:hidden">
      <div style="background:linear-gradient(135deg,#1a1a1a,#2b2b2b);padding:16px 22px;display:flex;align-items:center;gap:14px">
        <img src="img/logo-etablieres.png" alt="Groupe Établières" style="height:44px;background:#fff;border-radius:6px;padding:4px">
        <div>
          <p style="margin:0;color:#D9B24C;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase">Groupe Établières · Service Maintenance et Ménage</p>
          <h1 style="margin:1px 0 0;color:#fff;font-size:18px">📋 Prévisionnel Travaux — Conseil d'administration</h1>
        </div>
      </div>
      <div style="padding:16px 22px">
        <p style="margin:0 0 14px;font-size:11px;color:#666">Exporté le ${formatDate(Date.now())} · Total : <b style="color:#B08D46;font-size:14px">${formatMontant(total)}</b> sur ${lignes.length} ligne(s)</p>
        ${[...parSite.entries()].map(([nomSite, lignesSite]) => `
          <h3 style="margin:14px 0 6px;font-size:13px;color:#B08D46;border-bottom:1px solid #eee;padding-bottom:4px">${esc(nomSite)} — ${formatMontant(lignesSite.reduce((s, l) => s + (l.montantEstime || 0), 0))}</h3>
          <table style="width:100%;border-collapse:collapse;margin-bottom:8px">
            <thead><tr>
              <th style="border:1px solid #999;background:#f5f3ee;padding:4px 6px;font-size:10px;text-align:left">Catégorie</th>
              <th style="border:1px solid #999;background:#f5f3ee;padding:4px 6px;font-size:10px;text-align:left">Détail</th>
              <th style="border:1px solid #999;background:#f5f3ee;padding:4px 6px;font-size:10px;text-align:center">Année</th>
              <th style="border:1px solid #999;background:#f5f3ee;padding:4px 6px;font-size:10px;text-align:left">Priorité</th>
              <th style="border:1px solid #999;background:#f5f3ee;padding:4px 6px;font-size:10px;text-align:right">Montant estimé</th>
            </tr></thead>
            <tbody>${lignesSite.map(ligneHTML).join("")}</tbody>
          </table>
        `).join("")}
      </div>
    </div>
  `;

  const printRoot = document.createElement("div");
  printRoot.id = "pv-print-root";
  printRoot.className = "print-only";
  printRoot.innerHTML = html;
  document.body.appendChild(printRoot);
  window.print();
  setTimeout(() => printRoot.remove(), 1000);
}

// Export Excel — reflète exactement les mêmes lignes que la liste
// actuellement affichée (filtres année/site/priorité/statut appliqués),
// pour un tableau modifiable/triable plutôt qu'un PDF figé.
function exporterExcel(lignes) {
  if (!window.XLSX) { alert("Librairie Excel non chargée — vérifie ta connexion et recharge la page."); return; }
  if (lignes.length === 0) { alert("Aucune ligne à exporter pour ces filtres."); return; }
  const donnees = lignes.map(l => ({
    "Site": l.dossierNom || "", "Catégorie": l.categorie || "", "Titre": l.titre || "",
    "Description": l.description || "", "Motif": l.motif || "",
    "Année visée": formatAnneeVisee(l), "Type d'année": l.typeAnnee === "scolaire" ? "Scolaire" : "Civile",
    "Priorité": labelPriorite(l.priorite), "Montant estimé (€)": l.montantEstime || 0,
    "Statut": labelStatut(l.statut), "Avancement": l.statut === "valide" ? labelAvancement(l.avancement) : "",
    "Créé par": l.createdByNom || "", "Créé le": formatDate(l.createdAt),
  }));
  const feuille = window.XLSX.utils.json_to_sheet(donnees);
  feuille["!cols"] = [{ wch: 20 }, { wch: 18 }, { wch: 24 }, { wch: 30 }, { wch: 24 }, { wch: 12 }, { wch: 12 }, { wch: 20 }, { wch: 16 }, { wch: 14 }, { wch: 18 }, { wch: 16 }, { wch: 12 }];
  const classeur = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(classeur, feuille, "Prévisionnel travaux");
  window.XLSX.writeFile(classeur, `Previsionnel_travaux_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// Vue d'ensemble : uniquement les demandes déjà VALIDÉES par le CA,
// regroupées par étape d'avancement — pour suivre où en est chaque
// travaux voté, du "à planifier" jusqu'au "terminé".
function renderVueEnsemble() {
  const validees = state.lignes.filter(l => l.statut === "valide");
  const etapes = ["", ...Object.keys(AVANCEMENTS)];
  const total = validees.reduce((s, l) => s + (l.montantEstime || 0), 0);

  mountedContainer.innerHTML = `
    <div class="stack">
      <button class="nav-btn" id="pv-retour-liste">← Retour à la liste</button>
      <p class="hint">Suivi des travaux déjà validés par le conseil d'administration, du plus en amont (à planifier) au plus avancé (terminé).</p>
      <div class="stat-chip" style="width:fit-content;font-weight:700">💰 Total des travaux validés : ${formatMontant(total)} — ${validees.length} demande(s)</div>
      ${validees.length === 0 ? `<p class="hint">Aucune demande validée pour l'instant.</p>` : etapes.map(etape => {
        const lignesEtape = validees.filter(l => (l.avancement || "") === etape);
        if (lignesEtape.length === 0) return "";
        return `
          <h3 style="margin:16px 0 6px;font-size:14px;color:var(--gold)">${etape === "" ? "Non renseigné" : labelAvancement(etape)} (${lignesEtape.length})</h3>
          ${lignesEtape.map(l => `
            <div class="form-card" style="margin-bottom:8px">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap">
                <div>
                  <p style="margin:0;font-weight:700">${esc(l.titre || l.categorie)} <span style="font-weight:400;color:var(--text-dim);font-size:12px">— ${esc(l.dossierNom || "Site non renseigné")}</span></p>
                  <p style="margin:2px 0 0;font-size:12px;color:var(--text-dim)">${esc(l.categorie)} · ${formatAnneeVisee(l)} · Validé le ${formatDate(l.dateStatut)}</p>
                </div>
                <p style="margin:0;font-size:16px;font-weight:800;color:var(--gold)">${formatMontant(l.montantEstime)}</p>
              </div>
              <label style="display:block;margin-top:8px;font-size:12px">Avancement
                <select data-avancement-ve="${l.id}">
                  <option value="">— Non renseigné —</option>
                  ${Object.entries(AVANCEMENTS).map(([k, v]) => `<option value="${k}" ${l.avancement === k ? "selected" : ""}>${v}</option>`).join("")}
                </select>
              </label>
            </div>
          `).join("")}
        `;
      }).join("")}
    </div>
  `;

  document.getElementById("pv-retour-liste").addEventListener("click", () => { ui.vueEnsemble = false; render(); });
  mountedContainer.querySelectorAll("[data-avancement-ve]").forEach(sel => sel.addEventListener("change", async (e) => {
    try { await changerAvancement(sel.dataset.avancementVe, e.target.value || null, mountedUser); } catch (err) { alert("Erreur : " + (err.message || err)); }
  }));
}

import { esc } from "./astreinte-logic.js";
import {
  watchSitesDossiers, nouveauDossier, createDossier, saveDossier, deleteDossier,
} from "./site-dossier-data.js";
import { getAccessToken, uploadToDrive } from "./google-drive.js";

let state = { dossiers: [] };
let ui = { openId: null, mode: "view", lightbox: null };
let unsubs = [];
let mountedContainer = null;
let mountedUser = null;

function cleanup() { unsubs.forEach(u => u()); unsubs = []; }
function isEditorUser(user) { return user && (user.role === "admin" || user.role === "n1"); }

export function mountSitesDossiers(container, user) {
  cleanup();
  mountedContainer = container;
  mountedUser = user;
  ui.openId = null; ui.mode = "view"; ui.lightbox = null;
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
      <p class="hint">Dossier technique et sécurité de chaque résidence — organes de coupure, accès clés, contacts d'urgence, photos. Structure uniforme reprise de la fiche index papier.</p>
      ${isEditorUser(mountedUser) ? `<button class="add-btn" id="sd-new" style="width:fit-content">➕ Créer un nouveau dossier</button>` : ""}
      <div class="bubble-grid">
        ${state.dossiers.length === 0 ? `<p class="hint">Aucun dossier créé pour l'instant.</p>` :
          state.dossiers.map(d => {
            const nbPhotos = (d.sections || []).reduce((s, sec) => s + (sec.photos?.length || 0), 0);
            return `
            <button class="bubble-card" data-open="${d.id}">
              <span class="bubble-icon">🏢</span>
              <span class="bubble-label">${esc(d.nom)}</span>
              <span class="bubble-desc">${esc(d.adresse || "Adresse non renseignée")}${nbPhotos ? ` · 📷 ${nbPhotos}` : ""}</span>
            </button>`;
          }).join("")}
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

function photoGalleryHTML(section, sectionIndex, editable) {
  const photos = section.photos || [];
  return `
    <div class="sd-gallery" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
      ${photos.map((p, pi) => `
        <div style="position:relative">
          ${p.isImage !== false
            ? `<img src="${esc(p.url)}" data-lightbox="${esc(p.url)}" style="width:76px;height:76px;object-fit:cover;border-radius:8px;cursor:pointer;border:1px solid var(--border)" onerror="this.style.opacity=0.3">`
            : `<a href="${esc(p.url)}" target="_blank" rel="noopener" style="width:76px;height:76px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;border-radius:8px;border:1px solid var(--border);background:var(--panel-alt);text-decoration:none;color:var(--text);font-size:22px;padding:4px;text-align:center">
                📄<span style="font-size:8px;color:var(--text-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%">${esc(p.name || 'Document')}</span>
              </a>`}
          ${editable ? `<button data-del-photo="${sectionIndex}-${pi}" style="position:absolute;top:-6px;right:-6px;background:var(--red);color:#fff;border:none;border-radius:50%;width:20px;height:20px;font-size:11px;cursor:pointer;line-height:1">✕</button>` : ""}
        </div>
      `).join("")}
    </div>
    ${editable ? `
    <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
      <button type="button" class="nav-btn" data-open-photo-picker="${sectionIndex}" data-mode="camera" style="font-size:12px">📷 Prendre une photo</button>
      <button type="button" class="nav-btn" data-open-photo-picker="${sectionIndex}" data-mode="file" style="font-size:12px">📎 Importer un fichier</button>
      <input type="file" accept="image/*" capture="environment" data-hidden-file-input="${sectionIndex}" data-mode="camera" style="display:none">
      <input type="file" data-hidden-file-input="${sectionIndex}" data-mode="file" style="display:none">
    </div>
    <div data-upload-status="${sectionIndex}" style="font-size:11px;margin-top:4px"></div>` : ""}
  `;
}

function lightboxHTML() {
  if (!ui.lightbox) return "";
  return `
    <div id="sd-lightbox-overlay" style="position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:999;display:flex;align-items:center;justify-content:center;cursor:zoom-out">
      <img src="${esc(ui.lightbox)}" style="max-width:90vw;max-height:90vh;border-radius:8px">
    </div>
  `;
}

function attachLightboxListeners(container) {
  container.querySelectorAll("[data-lightbox]").forEach(img => {
    img.addEventListener("click", () => { ui.lightbox = img.dataset.lightbox; render(); });
  });
  document.getElementById("sd-lightbox-overlay")?.addEventListener("click", () => { ui.lightbox = null; render(); });
}

// =================================================================
// Vue de consultation (imprimable + galerie interactive)
// =================================================================
function renderView(d) {
  const concernes = (d.sections || []).filter(s => s.concerne);

  mountedContainer.innerHTML = `
    <div class="stack">
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="nav-btn" id="sd-back">← Tous les dossiers</button>
        ${isEditorUser(mountedUser) ? `<button class="nav-btn" id="sd-edit">✏️ Modifier</button>` : ""}
        <button class="add-btn" id="sd-print">🖨️ Exporter en PDF (imprimer)</button>
        ${isEditorUser(mountedUser) ? `<button class="del-btn" id="sd-del" style="border:1px solid var(--red);border-radius:8px;padding:9px 16px">🗑️ Supprimer</button>` : ""}
      </div>

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
        concernes.map((s) => {
          const si = d.sections.indexOf(s);
          return `
          <div class="form-card">
            <h4 style="margin:0 0 6px;font-size:14px">${esc(s.titre)}</h4>
            ${s.emplacement ? `<p style="font-size:13px;margin:0 0 4px"><b>Emplacement :</b> ${esc(s.emplacement)}</p>` : ""}
            ${s.procedure ? `<p style="font-size:13px;margin:0 0 4px;color:var(--text-dim)"><b>Procédure :</b> ${esc(s.procedure)}</p>` : ""}
            ${photoGalleryHTML(s, si, false)}
          </div>`;
        }).join("")}

      <!-- Version imprimable, en dessous, cachée à l'écran mais utilisée pour l'export PDF -->
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
        ${concernes.map(s => `
          <div style="margin-bottom:14px;page-break-inside:avoid">
            <p style="font-size:12px;font-weight:700;margin:0 0 3px">${esc(s.titre)}</p>
            ${s.emplacement ? `<p style="font-size:11px;margin:0 0 2px"><b>Emplacement :</b> ${esc(s.emplacement)}</p>` : ""}
            ${s.procedure ? `<p style="font-size:11px;margin:0 0 4px;color:#555"><b>Procédure :</b> ${esc(s.procedure)}</p>` : ""}
            ${(s.photos || []).length ? `<div style="display:flex;gap:6px;flex-wrap:wrap">${s.photos.map(p => p.isImage !== false
              ? `<img src="${esc(p.url)}" style="width:110px;height:110px;object-fit:cover;border:1px solid #999;border-radius:4px">`
              : `<span style="display:inline-block;padding:6px 10px;border:1px solid #999;border-radius:4px;font-size:10px">📄 ${esc(p.name || 'Document')}</span>`
            ).join("")}</div>` : ""}
          </div>
        `).join("")}
        <p style="font-size:10px;color:#666;margin-top:16px">Ce document doit rester consultable librement par tout intervenant extérieur, technicien de maintenance, prestataire ou service de secours dès son arrivée sur site.</p>
      </div>
    </div>
    ${lightboxHTML()}
  `;

  document.getElementById("sd-back").addEventListener("click", () => { ui.openId = null; render(); });
  document.getElementById("sd-edit")?.addEventListener("click", () => { ui.mode = "edit"; render(); });
  document.getElementById("sd-print").addEventListener("click", () => { window.print(); });
  document.getElementById("sd-del")?.addEventListener("click", async () => {
    if (confirm(`Supprimer définitivement le dossier "${d.nom}" ?`)) { await deleteDossier(d.id); ui.openId = null; render(); }
  });
  attachLightboxListeners(mountedContainer);
}

// =================================================================
// Édition
// =================================================================
function renderEdit(dOriginal, workingCopy) {
  const data = workingCopy || JSON.parse(JSON.stringify(dOriginal));
  data.sections.forEach(s => { if (!s.photos) s.photos = []; });

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

      <h3 style="margin:12px 0 0;font-size:14px;color:var(--gold)">Équipements & organes techniques</h3>
      ${data.sections.map((s, i) => `
        <div class="form-card">
          <div style="display:flex;gap:10px;align-items:flex-start;margin-bottom:8px">
            <label style="display:flex;align-items:center;gap:6px;white-space:nowrap;padding-top:8px">
              <input type="checkbox" data-sec-concerne="${i}" ${s.concerne ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--gold)"> Concerné
            </label>
            <input data-sec-titre="${i}" value="${esc(s.titre)}" style="flex:1;font-weight:700">
            <button class="del-btn" data-del-sec="${i}">🗑️</button>
          </div>
          <div class="form-grid">
            <label>Emplacement<input data-sec-emplacement="${i}" value="${esc(s.emplacement || '')}" placeholder="ex. hall d'entrée, placard technique…"></label>
            <label>Procédure / consignes<input data-sec-procedure="${i}" value="${esc(s.procedure || '')}" placeholder="ex. clé de levage requise…"></label>
          </div>
          <label style="display:block;font-size:11px;color:var(--text-dim);margin-top:8px">Photos & documents</label>
          ${photoGalleryHTML(s, i, true)}
        </div>
      `).join("")}
      <button class="nav-btn" id="sd-add-sec">➕ Ajouter un équipement</button>

      <button class="add-btn" id="sd-save-bottom">💾 Enregistrer</button>
    </div>
    ${lightboxHTML()}
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
  document.getElementById("sd-add-sec").addEventListener("click", () => { data.sections.push({ titre: "Nouvel équipement", concerne: false, emplacement: "", procedure: "", photos: [] }); renderEdit(dOriginal, data); });

  mountedContainer.querySelectorAll("[data-open-photo-picker]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const si = parseInt(btn.dataset.openPhotoPicker, 10);
      const mode = btn.dataset.mode;
      const statusEl = mountedContainer.querySelector(`[data-upload-status="${si}"]`);
      const fileInput = mountedContainer.querySelector(`[data-hidden-file-input="${si}"][data-mode="${mode}"]`);
      statusEl.innerHTML = `<span style="color:var(--text-dim)">⏳ Connexion à Google…</span>`;
      try {
        // La connexion Google DOIT être demandée en tout premier, en
        // réaction directe au clic — sinon le navigateur bloque la
        // fenêtre de connexion une fois le sélecteur de fichier ouvert.
        const token = await getAccessToken();
        statusEl.innerHTML = "";
        fileInput.dataset.readyToken = token;
        fileInput.click();
      } catch (err) {
        statusEl.innerHTML = `<span style="color:var(--red)">❌ ${esc(err.message || String(err))}</span>`;
      }
    });
  });
  mountedContainer.querySelectorAll("[data-hidden-file-input]").forEach(input => {
    input.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const si = parseInt(input.dataset.hiddenFileInput, 10);
      const statusEl = mountedContainer.querySelector(`[data-upload-status="${si}"]`);
      statusEl.innerHTML = `<span style="color:var(--text-dim)">⏳ Envoi de la photo…</span>`;
      try {
        const { url, driveId, isImage, name } = await uploadToDrive(file, input.dataset.readyToken);
        data.sections[si].photos.push({ url, driveId, isImage, name });
        renderEdit(dOriginal, data);
      } catch (err) {
        statusEl.innerHTML = `<span style="color:var(--red)">❌ Échec : ${esc(err.message || String(err))}</span>`;
      }
    });
  });
  mountedContainer.querySelectorAll("[data-del-photo]").forEach(btn => {
    btn.addEventListener("click", () => {
      const [si, pi] = btn.dataset.delPhoto.split("-").map(Number);
      data.sections[si].photos.splice(pi, 1);
      renderEdit(dOriginal, data);
    });
  });

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
  attachLightboxListeners(mountedContainer);
}

import { esc } from "./astreinte-logic.js";
import {
  watchSitesDossiers, nouveauDossier, createDossier, saveDossier, envoyerDossierCorbeille,
  watchSectionsOrder, saveSectionsOrder,
} from "./site-dossier-data.js";
import { getAccessToken, uploadToDrive, getImageDisplayUrl, deleteDriveItem } from "./sharepoint-storage.js";
import { watchAssociations } from "./associations-data.js";

let state = { dossiers: [], associations: [], sectionsOrder: [] };
let ui = { openId: null, mode: "view", lightbox: null };
let paramsWorking = null; // copie de travail de l'ordre standard, pendant l'édition
let unsubs = [];
let mountedContainer = null;
let mountedUser = null;

function cleanup() { unsubs.forEach(u => u()); unsubs = []; }
function isEditorUser(user) { return user && (user.role === "super_admin" || user.role === "admin" || user.role === "n1"); }

export function mountSitesDossiers(container, user) {
  cleanup();
  mountedContainer = container;
  mountedUser = user;
  ui.openId = null; ui.mode = "view"; ui.lightbox = null;
  paramsWorking = null;
  container.innerHTML = `<div class="hint">Chargement…</div>`;
  unsubs.push(watchSitesDossiers((d) => { state.dossiers = d; render(); }));
  unsubs.push(watchAssociations((a) => { state.associations = a; render(); }));
  unsubs.push(watchSectionsOrder((s) => { state.sectionsOrder = s; render(); }));
}

function groupedDossiers() {
  const result = [];
  const usedIds = new Set();
  state.associations.forEach(assoc => {
    const dossiersForAssoc = state.dossiers.filter(d => d.association === assoc.nom);
    if (dossiersForAssoc.length === 0) return;
    const groupeNames = [...new Set(dossiersForAssoc.map(d => d.groupe).filter(Boolean))];
    const groups = [];
    const sansGroupe = dossiersForAssoc.filter(d => !d.groupe);
    if (sansGroupe.length) groups.push({ groupeLabel: null, dossiers: sansGroupe });
    groupeNames.forEach(g => groups.push({ groupeLabel: g, dossiers: dossiersForAssoc.filter(d => d.groupe === g) }));
    result.push({ assocLabel: assoc.nom, groups });
    dossiersForAssoc.forEach(d => usedIds.add(d.id));
  });
  const orphans = state.dossiers.filter(d => !usedIds.has(d.id));
  if (orphans.length) result.push({ assocLabel: "Sans association", groups: [{ groupeLabel: null, dossiers: orphans }] });
  return result;
}

function render() {
  if (!mountedContainer) return;
  if (!document.contains(mountedContainer)) { cleanup(); return; }

  const opened = ui.openId ? state.dossiers.find(d => d.id === ui.openId) : null;
  if (opened) {
    if (ui.mode === "edit") renderEdit(opened); else renderView(opened);
    return;
  }
  if (ui.mode === "params") { renderParams(); return; }

  const groups = groupedDossiers();

  mountedContainer.innerHTML = `
    <div class="stack">
      <p class="hint">Dossier technique et sécurité de chaque résidence — organes de coupure, accès clés, contacts d'urgence, photos. Structure uniforme reprise de la fiche index papier.</p>
      ${isEditorUser(mountedUser) ? `
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="add-btn" id="sd-new" style="width:fit-content">➕ Créer un nouveau dossier</button>
          <button class="nav-btn" id="sd-params" style="width:fit-content">⚙️ Paramètres (ordre des équipements)</button>
        </div>` : ""}
      ${state.dossiers.length === 0 ? `<p class="hint">Aucun dossier créé pour l'instant.</p>` :
        groups.map(g => `
          <div>
            <h3 style="margin:12px 0 8px;font-size:15px;color:var(--gold)">${esc(g.assocLabel)}</h3>
            ${g.groups.map(sub => `
              ${sub.groupeLabel ? `<div style="font-size:12px;color:var(--text-dim);margin:6px 0 6px 4px">${esc(sub.groupeLabel)}</div>` : ""}
              <div class="bubble-grid" style="margin-bottom:8px">
                ${sub.dossiers.map(d => {
                  const nbFichiers = (d.sections || []).reduce((s, sec) => s + (sec.photos?.length || 0), 0);
                  return `
                  <button class="bubble-card" data-open="${d.id}">
                    <span class="bubble-icon">🏢</span>
                    <span class="bubble-label">${esc(d.nom)}</span>
                    <span class="bubble-desc">${esc(d.adresse || "Adresse non renseignée")}${nbFichiers ? ` · 📎 ${nbFichiers}` : ""}</span>
                  </button>`;
                }).join("")}
              </div>
            `).join("")}
          </div>
        `).join("")}
    </div>
  `;

  document.getElementById("sd-new")?.addEventListener("click", async () => {
    const id = await createDossier(nouveauDossier(state.sectionsOrder));
    ui.openId = id; ui.mode = "edit"; render();
  });
  document.getElementById("sd-params")?.addEventListener("click", () => { ui.mode = "params"; render(); });
  mountedContainer.querySelectorAll("[data-open]").forEach(btn => {
    btn.addEventListener("click", () => { ui.openId = btn.dataset.open; ui.mode = "view"; render(); });
  });
}

// =================================================================
// Paramètres — ordre standard des équipements pour les NOUVEAUX dossiers
// (les dossiers déjà créés se réordonnent individuellement avec ▲▼
// directement dans leur écran d'édition, sans passer par ici)
// =================================================================
function renderParams() {
  const list = paramsWorking || [...state.sectionsOrder];
  paramsWorking = list;

  mountedContainer.innerHTML = `
    <div class="stack">
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="nav-btn" id="sp-back">← Retour</button>
        <button class="add-btn" id="sp-save">💾 Enregistrer</button>
        <span id="sp-status" style="font-size:12px;align-self:center"></span>
      </div>
      <p class="hint">Cet ordre s'applique aux nouveaux dossiers créés à partir de maintenant. Pour réordonner un dossier déjà existant, ouvre-le, passe en mode Modifier, et utilise les flèches ▲▼ sur chaque équipement.</p>
      <div class="form-card">
        ${list.map((titre, i) => `
          <div style="display:flex;align-items:center;gap:8px;padding:6px 0;${i > 0 ? 'border-top:1px solid var(--border)' : ''}">
            <div style="display:flex;flex-direction:column;gap:2px">
              <button class="nav-btn" data-sp-up="${i}" ${i === 0 ? 'disabled style="opacity:0.3"' : ''} style="padding:2px 8px;font-size:11px">▲</button>
              <button class="nav-btn" data-sp-down="${i}" ${i === list.length - 1 ? 'disabled style="opacity:0.3"' : ''} style="padding:2px 8px;font-size:11px">▼</button>
            </div>
            <input data-sp-titre="${i}" value="${esc(titre)}" style="flex:1">
            <button class="del-btn" data-sp-del="${i}">🗑️</button>
          </div>
        `).join("")}
      </div>
      <button class="nav-btn" id="sp-add">➕ Ajouter une ligne standard</button>
    </div>
  `;

  document.getElementById("sp-back").addEventListener("click", () => { paramsWorking = null; ui.mode = "view"; render(); });
  document.getElementById("sp-add").addEventListener("click", () => { list.push("Nouvel équipement"); render(); });
  mountedContainer.querySelectorAll("[data-sp-titre]").forEach(inp => {
    inp.addEventListener("input", () => { list[parseInt(inp.dataset.spTitre, 10)] = inp.value; });
  });
  mountedContainer.querySelectorAll("[data-sp-del]").forEach(btn => {
    btn.addEventListener("click", () => { list.splice(parseInt(btn.dataset.spDel, 10), 1); render(); });
  });
  mountedContainer.querySelectorAll("[data-sp-up]").forEach(btn => btn.addEventListener("click", () => {
    const i = parseInt(btn.dataset.spUp, 10);
    if (i > 0) { [list[i - 1], list[i]] = [list[i], list[i - 1]]; render(); }
  }));
  mountedContainer.querySelectorAll("[data-sp-down]").forEach(btn => btn.addEventListener("click", () => {
    const i = parseInt(btn.dataset.spDown, 10);
    if (i < list.length - 1) { [list[i + 1], list[i]] = [list[i], list[i + 1]]; render(); }
  }));
  document.getElementById("sp-save").addEventListener("click", async () => {
    const statusEl = document.getElementById("sp-status");
    statusEl.innerHTML = `<span style="color:var(--text-dim)">⏳ Enregistrement…</span>`;
    try {
      await saveSectionsOrder(list.filter(t => t.trim() !== ""));
      paramsWorking = null;
      statusEl.innerHTML = `<span style="color:var(--gold)">✓ Enregistré</span>`;
    } catch (e) {
      statusEl.innerHTML = `<span style="color:var(--red)">❌ Échec : ${esc(e.message || String(e))}</span>`;
    }
  });
}

function photoGalleryHTML(section, sectionIndex, editable) {
  const photos = section.photos || [];
  return `
    <div class="sd-gallery" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
      ${photos.map((p, pi) => `
        <div style="position:relative">
          ${p.isImage !== false
            ? (p.itemId
                ? `<img data-resolve-img="${esc(p.itemId)}" data-lightbox-photo="${esc(p.itemId)}" alt="${esc(p.name || 'Photo')}" style="width:76px;height:76px;object-fit:cover;border-radius:8px;cursor:pointer;border:1px solid var(--border);background:var(--panel-alt)" onerror="this.style.opacity=0.3">`
                : `<img src="${esc(p.url)}" data-lightbox-static="${esc(p.url)}" alt="${esc(p.name || 'Photo')}" style="width:76px;height:76px;object-fit:cover;border-radius:8px;cursor:pointer;border:1px solid var(--border)" onerror="this.style.opacity=0.3">`)
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
  container.querySelectorAll("[data-lightbox-static]").forEach(img => {
    img.addEventListener("click", () => { ui.lightbox = img.dataset.lightboxStatic; render(); });
  });
  document.getElementById("sd-lightbox-overlay")?.addEventListener("click", () => { ui.lightbox = null; render(); });
}

// Contrairement à Google Drive, SharePoint ne fournit pas de lien image
// permanent : on redemande une URL fraîche pour chaque photo au moment de
// l'affichage (une seule requête par photo, même si elle apparaît deux
// fois à l'écran — galerie + version imprimable).
async function resolveGalleryImages(container) {
  const nodes = [...container.querySelectorAll("[data-resolve-img]")];
  const itemIds = [...new Set(nodes.map(n => n.dataset.resolveImg).filter(Boolean))];
  if (itemIds.length === 0) return;
  await Promise.all(itemIds.map(async (itemId) => {
    let url;
    try {
      url = await getImageDisplayUrl(itemId);
    } catch (e) {
      container.querySelectorAll(`[data-resolve-img="${itemId}"]`).forEach(img => { img.style.opacity = 0.3; });
      return;
    }
    container.querySelectorAll(`[data-resolve-img="${itemId}"]`).forEach(img => {
      img.crossOrigin = "anonymous"; // nécessaire pour que html2canvas puisse capturer l'image lors de l'export PDF
      img.src = url;
      if (img.dataset.lightboxPhoto) {
        img.addEventListener("click", () => { ui.lightbox = url; render(); });
      }
    });
  }));
}

// =================================================================
// Vue de consultation (imprimable + galerie interactive)
// =================================================================
// Gabarit HTML de la version imprimable — extrait en fonction réutilisable
// pour être aussi utilisé par l'outil de génération PDF en masse
// (migration-tool.js), sans dépendre de l'écran actuellement ouvert.
export function printFicheHtml(d) {
  const concernes = (d.sections || []).filter(s => s.concerne);
  return `
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
              ? (p.itemId
                  ? `<img data-resolve-img="${esc(p.itemId)}" alt="${esc(p.name || '')}" style="width:110px;height:110px;object-fit:cover;border:1px solid #999;border-radius:4px">`
                  : `<img src="${esc(p.url)}" alt="${esc(p.name || '')}" style="width:110px;height:110px;object-fit:cover;border:1px solid #999;border-radius:4px">`)
              : `<span style="display:inline-block;padding:6px 10px;border:1px solid #999;border-radius:4px;font-size:10px">📄 ${esc(p.name || 'Document')}</span>`
            ).join("")}</div>` : ""}
          </div>
        `).join("")}
        <p style="font-size:10px;color:#666;margin-top:16px">Ce document doit rester consultable librement par tout intervenant extérieur, technicien de maintenance, prestataire ou service de secours dès son arrivée sur site.</p>
      </div>
  `;
}

// Attend que toutes les images d'un élément soient chargées (ou en échec)
// avant de générer le PDF — sinon des photos encore en cours de résolution
// (voir resolveGalleryImages) apparaîtraient vides sur le PDF.
async function waitForImages(element, timeoutMs = 10000) {
  const imgs = [...element.querySelectorAll("img")];
  await Promise.race([
    Promise.all(imgs.map(img => (img.complete && img.naturalWidth > 0)
      ? Promise.resolve()
      : new Promise(res => {
          img.addEventListener("load", res, { once: true });
          img.addEventListener("error", res, { once: true });
        })
    )),
    new Promise(res => setTimeout(res, timeoutMs)),
  ]);
}

// Génère un PDF à partir d'un élément .print-fiche déjà présent dans le DOM
// (avec ses images déjà résolues, voir resolveGalleryImages) et l'envoie
// vers SharePoint, à la racine du dossier de la résidence. Réutilisée par
// l'outil de génération en masse (migration-tool.js) pour tous les
// dossiers existants.
export async function generateAndUploadPdf(d, element) {
  if (!window.html2pdf) throw new Error("Librairie PDF non chargée (vérifier app.html)");
  await waitForImages(element);
  const token = await getAccessToken();
  const filename = `${d.nom} - Dossier technique.pdf`;
  const blob = await window.html2pdf()
    .set({
      margin: 10,
      filename,
      image: { type: "jpeg", quality: 0.92 },
      html2canvas: { scale: 2, useCORS: true, allowTaint: false },
      jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
    })
    .from(element)
    .outputPdf("blob");
  const file = new File([blob], filename, { type: "application/pdf" });
  return uploadToDrive(file, token, [d.nom], undefined, { conflictBehavior: "replace", fixedFilename: filename });
}

function renderView(d) {
  const concernes = (d.sections || []).filter(s => s.concerne);

  mountedContainer.innerHTML = `
    <div class="stack">
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="nav-btn" id="sd-back">← Tous les dossiers</button>
        ${isEditorUser(mountedUser) ? `<button class="nav-btn" id="sd-edit">✏️ Modifier</button>` : ""}
        <button class="add-btn" id="sd-print">🖨️ Exporter en PDF (imprimer)</button>
        ${isEditorUser(mountedUser) ? `<button class="nav-btn" id="sd-save-pdf">💾 Enregistrer le PDF sur SharePoint</button>` : ""}
        ${isEditorUser(mountedUser) ? `<button class="del-btn" id="sd-del" style="border:1px solid var(--red);border-radius:8px;padding:9px 16px">🗑️ Mettre à la corbeille</button>` : ""}
      </div>
      <div id="sd-pdf-status" style="font-size:12px"></div>

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
      ${printFicheHtml(d)}
    </div>
    ${lightboxHTML()}
  `;

  document.getElementById("sd-back").addEventListener("click", () => { ui.openId = null; render(); });
  document.getElementById("sd-edit")?.addEventListener("click", () => { ui.mode = "edit"; render(); });
  document.getElementById("sd-print").addEventListener("click", () => { window.print(); });
  document.getElementById("sd-save-pdf")?.addEventListener("click", async () => {
    const statusEl = document.getElementById("sd-pdf-status");
    statusEl.innerHTML = `<span style="color:var(--text-dim)">⏳ Génération et envoi du PDF…</span>`;
    try {
      await generateAndUploadPdf(d, mountedContainer.querySelector(".print-fiche"));
      statusEl.innerHTML = `<span style="color:var(--gold)">✓ PDF enregistré sur SharePoint</span>`;
    } catch (e) {
      statusEl.innerHTML = `<span style="color:var(--red)">❌ ${esc(e.message || String(e))}</span>`;
    }
  });
  document.getElementById("sd-del")?.addEventListener("click", async () => {
    if (confirm(`Mettre le dossier "${d.nom}" à la corbeille ? Il restera récupérable 60 jours (Administration > Corbeille).`)) { await envoyerDossierCorbeille(d.id); ui.openId = null; render(); }
  });
  attachLightboxListeners(mountedContainer);
  resolveGalleryImages(mountedContainer);
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
          <label>Association
            <select id="sd-association">
              <option value="" ${!data.association ? 'selected' : ''}>— Aucune —</option>
              ${state.associations.map(a => `<option value="${esc(a.nom)}" ${data.association === a.nom ? 'selected' : ''}>${esc(a.nom)}</option>`).join("")}
            </select>
          </label>
          ${(() => {
            const assoc = state.associations.find(a => a.nom === data.association);
            const groupesDispo = assoc ? [...new Set(assoc.sites.filter(s => s.groupe).map(s => s.groupe))] : [];
            if (groupesDispo.length === 0) return "";
            return `<label>Groupe (optionnel)
              <select id="sd-groupe">
                <option value="" ${!data.groupe ? 'selected' : ''}>— Aucun —</option>
                ${groupesDispo.map(g => `<option value="${esc(g)}" ${data.groupe === g ? 'selected' : ''}>${esc(g)}</option>`).join("")}
              </select>
            </label>`;
          })()}
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
            <div style="display:flex;flex-direction:column;gap:2px;padding-top:6px">
              <button class="nav-btn" data-move-up="${i}" ${i === 0 ? 'disabled style="opacity:0.3"' : ''} style="padding:2px 8px;font-size:11px" title="Monter">▲</button>
              <button class="nav-btn" data-move-down="${i}" ${i === data.sections.length - 1 ? 'disabled style="opacity:0.3"' : ''} style="padding:2px 8px;font-size:11px" title="Descendre">▼</button>
            </div>
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
  document.getElementById("sd-association").addEventListener("change", (e) => {
    data.association = e.target.value;
    data.groupe = "";
    renderEdit(dOriginal, data);
  });
  document.getElementById("sd-groupe")?.addEventListener("change", (e) => { data.groupe = e.target.value; });

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
  mountedContainer.querySelectorAll("[data-move-up]").forEach(btn => btn.addEventListener("click", () => {
    const i = parseInt(btn.dataset.moveUp, 10);
    if (i > 0) { [data.sections[i - 1], data.sections[i]] = [data.sections[i], data.sections[i - 1]]; renderEdit(dOriginal, data); }
  }));
  mountedContainer.querySelectorAll("[data-move-down]").forEach(btn => btn.addEventListener("click", () => {
    const i = parseInt(btn.dataset.moveDown, 10);
    if (i < data.sections.length - 1) { [data.sections[i + 1], data.sections[i]] = [data.sections[i], data.sections[i + 1]]; renderEdit(dOriginal, data); }
  }));
  document.getElementById("sd-add-sec").addEventListener("click", () => { data.sections.push({ titre: "Nouvel équipement", concerne: false, emplacement: "", procedure: "", photos: [] }); renderEdit(dOriginal, data); });

  mountedContainer.querySelectorAll("[data-open-photo-picker]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const si = parseInt(btn.dataset.openPhotoPicker, 10);
      const mode = btn.dataset.mode;
      const statusEl = mountedContainer.querySelector(`[data-upload-status="${si}"]`);
      const fileInput = mountedContainer.querySelector(`[data-hidden-file-input="${si}"][data-mode="${mode}"]`);
      statusEl.innerHTML = `<span style="color:var(--text-dim)">⏳ Connexion à Microsoft…</span>`;
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
        const { url, itemId, isImage, name } = await uploadToDrive(
          file, input.dataset.readyToken, [data.nom, data.sections[si].titre]
        );
        data.sections[si].photos.push({ url, itemId, isImage, name });
        renderEdit(dOriginal, data);
      } catch (err) {
        statusEl.innerHTML = `<span style="color:var(--red)">❌ Échec : ${esc(err.message || String(err))}</span>`;
      }
    });
  });
  mountedContainer.querySelectorAll("[data-del-photo]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const [si, pi] = btn.dataset.delPhoto.split("-").map(Number);
      const photo = data.sections[si].photos[pi];
      if (!confirm(`Supprimer définitivement "${photo.name || 'ce fichier'}" ?`)) return;
      btn.disabled = true;
      if (photo.itemId) {
        try {
          await deleteDriveItem(photo.itemId);
        } catch (e) {
          alert("Échec de la suppression sur SharePoint : " + (e.message || e));
          btn.disabled = false;
          return;
        }
      }
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
  resolveGalleryImages(mountedContainer);
}

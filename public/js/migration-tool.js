// migration-tool.js
// Outil ponctuel (admin uniquement) : recherche toutes les photos encore
// hébergées sur l'ancien système Google Drive (dossiers de site + stock
// maintenance), les retélécharge, les renvoie vers SharePoint dans la
// nouvelle organisation par dossier lisible, et met à jour Firestore.
//
// Peut être retiré de la navigation une fois la migration terminée — voir
// app.html (catégorie Administration).

import { esc } from "./astreinte-logic.js";
import { db } from "./firebase-init.js";
import {
  collection, getDocs, doc, getDoc, updateDoc,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { getGoogleAccessToken, downloadDriveFile } from "./google-drive-readonly.js";
import { getAccessToken as getMsToken, uploadToDrive, moveItemToFolder, buildFolderPath, DOSSIERS_ROOT_FOLDER, STOCK_ROOT_FOLDER } from "./sharepoint-storage.js";

let mountedContainer = null;
let state = { candidates: null, googleReady: false, running: false, log: [], done: false, repairing: false, repairLog: null };

export function mountMigrationTool(container) {
  mountedContainer = container;
  state = { candidates: null, googleReady: false, running: false, log: [], done: false, repairing: false, repairLog: null };
  render();
}

function render() {
  if (!mountedContainer) return;
  if (!document.contains(mountedContainer)) return;

  mountedContainer.innerHTML = `
    <div class="stack">
      <p class="hint">Recherche les photos encore hébergées sur l'ancien système Google Drive (dossiers de site et stock maintenance), et les renvoie automatiquement vers SharePoint, dans la nouvelle organisation par dossier.</p>

      ${state.candidates === null ? `
        <button class="add-btn" id="mg-scan" style="width:fit-content">🔍 Rechercher les photos à migrer</button>
      ` : `
        <div class="form-card">
          <p style="margin:0 0 10px"><b>${state.candidates.length}</b> photo(s) trouvée(s) encore sur Google Drive.</p>
          ${state.candidates.length === 0 ? `<p class="hint">Rien à migrer — tout est déjà sur SharePoint.</p>` : `
            ${!state.googleReady ? `
              <button class="add-btn" id="mg-google">1️⃣ Se connecter avec le compte Google (application.etablieres@gmail.com)</button>
              <p class="hint" style="margin-top:8px">Utilise le compte qui a servi à envoyer les photos, sinon le téléchargement échouera.</p>
            ` : `
              <button class="add-btn" id="mg-start" ${state.running ? "disabled" : ""}>${state.running ? "⏳ Migration en cours…" : "2️⃣ Lancer la migration"}</button>
            `}
          `}
        </div>
      `}

      ${state.log.length > 0 ? `
        <div class="form-card">
          <h3 style="margin:0 0 10px;font-size:14px;color:var(--gold)">Journal</h3>
          <div style="max-height:320px;overflow-y:auto;font-size:12px;font-family:monospace">
            ${state.log.map(l => `<div style="padding:3px 0;color:${l.ok ? 'var(--gold)' : 'var(--red)'}">${l.ok ? '✓' : '❌'} ${esc(l.text)}</div>`).join("")}
          </div>
        </div>
      ` : ""}

      ${state.done ? `
        <div class="stat-chip ${state.log.some(l => !l.ok) ? 'warn' : 'ok'}" style="width:fit-content">
          Terminé — ${state.log.filter(l => l.ok).length} migrée(s), ${state.log.filter(l => !l.ok).length} échec(s)
        </div>
        ${state.log.some(l => !l.ok) ? `<p class="hint">Les échecs restent sur Google Drive — à migrer à la main (voir la procédure manuelle) : télécharger l'image depuis la fiche concernée, puis « Importer un fichier » au même endroit.</p>` : ""}
      ` : ""}

      <div class="form-card">
        <h3 style="margin:0 0 8px;font-size:14px;color:var(--gold)">🔧 Réparer l'organisation des dossiers</h3>
        <p class="hint" style="margin:0 0 10px">Si des photos apparaissent dans SharePoint mais pas bien rangées par résidence/équipement (ou par produit) — sans re-télécharger, déplace juste chaque fichier déjà présent vers le bon dossier.</p>
        <button class="nav-btn" id="mg-repair" ${state.repairing ? "disabled" : ""}>${state.repairing ? "⏳ Réparation en cours…" : "🔧 Réparer l'organisation"}</button>
        ${state.repairLog ? `
          <div style="max-height:320px;overflow-y:auto;font-size:12px;font-family:monospace;margin-top:10px">
            ${state.repairLog.map(l => `<div style="padding:3px 0;color:${l.ok ? 'var(--gold)' : 'var(--red)'}">${l.ok ? '✓' : '❌'} ${esc(l.text)}</div>`).join("")}
          </div>
          <div class="stat-chip ${state.repairLog.some(l => !l.ok) ? 'warn' : 'ok'}" style="width:fit-content;margin-top:8px">
            ${state.repairLog.filter(l => l.ok).length} déplacée(s), ${state.repairLog.filter(l => !l.ok).length} échec(s)
          </div>
        ` : ""}
      </div>
    </div>
  `;

  document.getElementById("mg-scan")?.addEventListener("click", scanCandidates);
  document.getElementById("mg-google")?.addEventListener("click", connectGoogle);
  document.getElementById("mg-start")?.addEventListener("click", runMigration);
  document.getElementById("mg-repair")?.addEventListener("click", runRepair);
}

async function runRepair() {
  state.repairing = true;
  state.repairLog = [];
  render();

  const items = [];

  const dossiersSnap = await getDocs(collection(db, "sites-dossiers"));
  dossiersSnap.forEach((d) => {
    const data = d.data();
    (data.sections || []).forEach((section) => {
      (section.photos || []).forEach((photo) => {
        if (photo.itemId) {
          items.push({
            itemId: photo.itemId,
            folderPath: buildFolderPath(DOSSIERS_ROOT_FOLDER, [data.nom, section.titre]),
            label: `${data.nom} / ${section.titre} / ${photo.name || "photo"}`,
          });
        }
      });
    });
  });

  const produitsSnap = await getDocs(collection(db, "stock-produits"));
  produitsSnap.forEach((d) => {
    const data = d.data();
    if (data.photo?.itemId) {
      items.push({
        itemId: data.photo.itemId,
        folderPath: buildFolderPath(STOCK_ROOT_FOLDER, [data.nom]),
        label: `Produit : ${data.nom}`,
      });
    }
  });

  for (const it of items) {
    try {
      await moveItemToFolder(it.itemId, it.folderPath);
      state.repairLog.push({ ok: true, text: it.label });
    } catch (e) {
      state.repairLog.push({ ok: false, text: `${it.label} — ${e.message || e}` });
    }
    render();
  }

  state.repairing = false;
  render();
}

async function scanCandidates() {
  mountedContainer.querySelector("#mg-scan").textContent = "⏳ Recherche…";
  const candidates = [];

  const dossiersSnap = await getDocs(collection(db, "sites-dossiers"));
  dossiersSnap.forEach((d) => {
    const data = d.data();
    (data.sections || []).forEach((section, si) => {
      (section.photos || []).forEach((photo, pi) => {
        if (photo.driveId && !photo.itemId) {
          candidates.push({
            type: "dossier", docId: d.id, sectionIndex: si, photoIndex: pi,
            driveId: photo.driveId, name: photo.name || "photo.jpg", isImage: photo.isImage !== false,
            folderSegments: [data.nom, section.titre],
            label: `${data.nom} / ${section.titre} / ${photo.name || "photo"}`,
          });
        }
      });
    });
  });

  const produitsSnap = await getDocs(collection(db, "stock-produits"));
  produitsSnap.forEach((d) => {
    const data = d.data();
    if (data.photo?.driveId && !data.photo?.itemId) {
      candidates.push({
        type: "produit", docId: d.id,
        driveId: data.photo.driveId, name: data.photo.name || "photo.jpg", isImage: data.photo.isImage !== false,
        folderSegments: [data.nom],
        label: `Produit : ${data.nom}`,
      });
    }
  });

  state.candidates = candidates;
  render();
}

async function connectGoogle() {
  const btn = document.getElementById("mg-google");
  btn.textContent = "⏳ Connexion…";
  try {
    await getGoogleAccessToken();
    state.googleReady = true;
    render();
  } catch (e) {
    btn.textContent = "1️⃣ Se connecter avec le compte Google (application.etablieres@gmail.com)";
    alert("Échec de connexion Google : " + (e.message || e));
  }
}

async function runMigration() {
  state.running = true;
  state.log = [];
  render();

  let googleToken, msToken;
  try {
    googleToken = await getGoogleAccessToken();
    msToken = await getMsToken();
  } catch (e) {
    state.log.push({ ok: false, text: `Connexion échouée : ${e.message || e}` });
    state.running = false; state.done = true; render();
    return;
  }

  for (const c of state.candidates) {
    try {
      const file = await downloadDriveFile(c.driveId, googleToken, c.name);
      const rootFolder = c.type === "produit" ? STOCK_ROOT_FOLDER : undefined;
      const uploaded = await uploadToDrive(file, msToken, c.folderSegments, rootFolder);

      if (c.type === "dossier") {
        const ref = doc(db, "sites-dossiers", c.docId);
        const fresh = await getDoc(ref);
        const data = fresh.data();
        data.sections[c.sectionIndex].photos[c.photoIndex] = {
          url: uploaded.url, itemId: uploaded.itemId, isImage: uploaded.isImage, name: uploaded.name,
        };
        await updateDoc(ref, { sections: data.sections });
      } else {
        await updateDoc(doc(db, "stock-produits", c.docId), {
          photo: { url: uploaded.url, itemId: uploaded.itemId, isImage: uploaded.isImage, name: uploaded.name },
        });
      }

      state.log.push({ ok: true, text: c.label });
    } catch (e) {
      state.log.push({ ok: false, text: `${c.label} — ${e.message || e}` });
    }
    render();
  }

  state.running = false;
  state.done = true;
  render();
}

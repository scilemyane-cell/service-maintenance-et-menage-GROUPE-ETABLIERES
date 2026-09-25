// export-sharepoint-admin.js
// Tableau de bord de contrôle de l'export quotidien vers SharePoint
// (Administration > Export SharePoint) : vérifier que ça tourne, et
// déclencher un export manuel si besoin (ex. avant la toute première
// connexion Microsoft d'une session).

import { esc } from "./astreinte-logic.js";
import { getStatutExport, exporterMaintenant } from "./export-sharepoint.js";
import { getGraphToken } from "./graph-auth.js";
import { listerDossierDrive, nomSegmentDrive, deleteDriveItem, EXPORTS_ROOT_FOLDER } from "./sharepoint-storage.js";
import { watchSitesDossiers } from "./site-dossier-data.js";

let mountedContainer = null;
let state = { statut: null, running: false, progress: "" };
let doublons = { etat: "", liste: [], orphelins: [], msg: "" };
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
      <p class="hint">Un rapport PDF des données (stock central, stock par site, historique des inventaires, sorties de stock par site, sorties de stock ménage École/Agropolis, interventions, fiches de traçabilité ménage, relevés de compteurs, codes Masterlock) est envoyé automatiquement vers SharePoint à chaque connexion à l'appli — en plus du stockage principal dans l'appli, pas à la place. Chaque module a son propre sous-dossier dans "ExportsDonnees" (Stock, Stock Ménage, Interventions, Menage, Relevé de compteur, Codes Masterlock). Relevés : un seul endroit, « Relevé de compteur / [Site] / [Type] », avec un PDF par compteur (courbe + historique par année scolaire). Un sous-dossier "Archives" garde une seule copie par mois (la plus récente), uniquement si les données ont changé. Nécessite qu'une session Microsoft soit déjà active dans le navigateur pour se déclencher tout seul.</p>

      <div class="stat-chip ok" style="width:fit-content">
        ${state.statut?.lastExportAt ? `✓ Dernier export : ${new Date(state.statut.lastExportAt).toLocaleString('fr-FR')}` : "Aucun export effectué pour l'instant"}
      </div>

      <button class="add-btn" id="exa-run" style="width:fit-content" ${state.running ? "disabled" : ""}>${state.running ? `⏳ Export en cours… ${esc(state.progress)}` : "📤 Exporter maintenant"}</button>
      ${state.running ? `<p class="hint">Vous pouvez naviguer ailleurs dans l'appli — l'export continue en arrière-plan tant que vous restez sur cette page (fermer complètement l'onglet/l'appli l'interromprait).</p>` : ""}
      <div id="exa-status" style="font-size:12px"></div>

      <div class="form-card">
        <h3 style="margin:0 0 6px;font-size:15px">🧹 Doublons SharePoint</h3>
        <p class="hint" style="margin:0 0 10px">Recherche les anciennes copies du PDF « Dossier technique » (une seule par site), les archives en trop (une seule par mois) et les anciens récapitulatifs de relevés (les relevés sont désormais uniquement dans un PDF par compteur, rangé par site). Les copies supprimées vont dans la corbeille SharePoint (récupérables 93 jours). Les photos et documents ne sont jamais touchés.</p>
        <button class="nav-btn" id="exa-doublons" ${doublons.etat === "scan" || doublons.etat === "suppr" ? "disabled" : ""}>${doublons.etat === "scan" ? "⏳ Recherche…" : "🔍 Rechercher les doublons"}</button>
        ${doublonsHTML()}
      </div>
    </div>
  `;
  brancherDoublons();

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


function doublonsHTML() {
  if (doublons.msg) return `<div style="margin-top:10px;font-size:13px">${doublons.msg}</div>` + listesDoublonsHTML();
  return listesDoublonsHTML();
}
function listesDoublonsHTML() {
  if (doublons.etat !== "fini") return "";
  const l = doublons.liste;
  return `
    ${l.length ? `
      <div style="margin-top:10px;border:1px solid var(--border);border-radius:10px;overflow:hidden">
        ${l.map((d, i) => `<label style="display:flex;gap:10px;align-items:center;padding:8px 10px;border-top:${i ? "1px solid var(--border)" : "none"};font-size:13px">
          <input type="checkbox" data-doublon="${i}" checked style="width:18px;height:18px">
          <span style="flex:1;min-width:0"><b>${esc(d.site)}</b>${d.folder ? " 📁" : ""} — <a href="${esc(d.webUrl)}" target="_blank" rel="noopener">${esc(d.name)}</a><br><small style="color:var(--text-dim)">modifié le ${new Date(d.lastModifiedDateTime).toLocaleDateString("fr-FR")}</small></span>
        </label>`).join("")}
      </div>
      <button class="add-btn" id="exa-doublons-suppr" style="margin-top:10px" ${doublons.etat === "suppr" ? "disabled" : ""}>🗑️ Supprimer les ${l.length} copie(s) cochée(s)</button>` : ""}
    ${doublons.orphelins.length ? `
      <div style="margin-top:14px;font-size:13px"><b>📁 Dossiers sans site correspondant</b> (souvent un site renommé : l'ancien dossier est resté). À vérifier et déplacer/supprimer à la main sur SharePoint, car ils peuvent contenir des photos :
        <ul style="margin:6px 0 0;padding-left:18px">${doublons.orphelins.map(o => `<li><a href="${esc(o.webUrl)}" target="_blank" rel="noopener">${esc(o.name)}</a></li>`).join("")}</ul>
      </div>` : ""}`;
}

function brancherDoublons() {
  document.getElementById("exa-doublons")?.addEventListener("click", rechercherDoublons);
  document.getElementById("exa-doublons-suppr")?.addEventListener("click", async () => {
    const choisis = [...mountedContainer.querySelectorAll("[data-doublon]:checked")].map(cb => doublons.liste[+cb.dataset.doublon]);
    if (!choisis.length) return;
    if (!confirm(`Supprimer ${choisis.length} ancienne(s) copie(s) du PDF ? (récupérables 93 jours dans la corbeille SharePoint)`)) return;
    doublons.etat = "suppr"; render();
    let ok = 0, ko = 0;
    for (const d of choisis) { try { await deleteDriveItem(d.id); ok++; } catch (e) { console.error(e); ko++; } }
    doublons.liste = doublons.liste.filter(d => !choisis.includes(d));
    doublons.etat = "fini";
    doublons.msg = `<span style="color:var(--teal)">✓ ${ok} copie(s) supprimée(s)</span>${ko ? ` · <span style="color:var(--red)">${ko} échec(s)</span>` : ""}`;
    render();
  });
}

async function rechercherDoublons() {
  doublons = { etat: "scan", liste: [], orphelins: [], msg: "" }; render();
  try {
    await getGraphToken(); // peut demander la connexion Microsoft
    const dossiers = await new Promise(res => { const u = watchSitesDossiers(l => { res(l); setTimeout(() => u && u(), 0); }); });
    const parNom = new Map(dossiers.map(d => [nomSegmentDrive(d.nom || "").toLowerCase(), d]));
    const racine = (await listerDossierDrive([])) || [];
    for (const f of racine.filter(x => x.folder)) {
      const d = parNom.get(f.name.toLowerCase());
      if (!d) { doublons.orphelins.push(f); continue; }
      const attendu = nomSegmentDrive(`${d.nom} - Dossier technique.pdf`).toLowerCase();
      const pdfs = ((await listerDossierDrive([d.nom])) || []).filter(x => !x.folder && /dossier technique.*\.pdf$/i.test(x.name));
      if (pdfs.length <= 1 && (!pdfs[0] || pdfs[0].name.toLowerCase() === attendu)) continue;
      // On garde le fichier au nom officiel (sinon le plus récent), le reste = doublons.
      pdfs.sort((a, b) => (b.name.toLowerCase() === attendu) - (a.name.toLowerCase() === attendu) || new Date(b.lastModifiedDateTime) - new Date(a.lastModifiedDateTime));
      pdfs.slice(1).forEach(p => doublons.liste.push({ ...p, site: d.nom }));
    }
    await chercherDoublonsExports();
    doublons.etat = "fini";
    doublons.msg = doublons.liste.length || doublons.orphelins.length
      ? `${doublons.liste.length} ancienne(s) copie(s) de PDF trouvée(s)${doublons.orphelins.length ? ` · ${doublons.orphelins.length} dossier(s) sans site` : ""}.`
      : `<span style="color:var(--teal)">✓ Aucun doublon : un seul PDF par site.</span>`;
  } catch (e) {
    doublons.etat = "fini";
    doublons.msg = `<span style="color:var(--red)">❌ ${esc(e.message || String(e))}</span>`;
  }
  render();
}


// ExportsDonnees : (1) dans "Relevé de compteur", les récapitulatifs
// devenus inutiles (Releves_compteurs.* à la racine, Releves.* par site,
// et leurs archives) — les PDF par compteur, rangés dans
// [Site]/[Type]/, sont conservés ; (2) dans chaque "Archives", on ne
// garde que la copie la plus récente de chaque mois.
async function chercherDoublonsExports() {
  const RC = "Relevé de compteur";
  const estRecap = (n) => /^(releves_compteurs|releves)(_\d{4}-\d{2}(-\d{2})?)?\.(pdf|xlsx)$/i.test(n);
  const aSupprimer = new Set();
  const racineRC = (await listerDossierDrive([RC], EXPORTS_ROOT_FOLDER)) || [];
  const recolter = (items, lib) => items.filter(x => !x.folder && estRecap(x.name)).forEach(x => { aSupprimer.add(x.id); doublons.liste.push({ ...x, site: lib }); });
  recolter(racineRC, "Récapitulatif relevés (en double avec les PDF par compteur)");
  const archRC = racineRC.find(x => x.folder && x.name === "Archives");
  if (archRC) recolter((await listerDossierDrive([RC, "Archives"], EXPORTS_ROOT_FOLDER)) || [], "Archives récapitulatif relevés");
  for (const site of racineRC.filter(x => x.folder && x.name !== "Archives")) {
    const items = (await listerDossierDrive([RC, site.name], EXPORTS_ROOT_FOLDER)) || [];
    recolter(items, `Relevés ${site.name} (en double avec les PDF par compteur)`);
    if (items.some(x => x.folder && x.name === "Archives")) recolter((await listerDossierDrive([RC, site.name, "Archives"], EXPORTS_ROOT_FOLDER)) || [], `Archives relevés ${site.name}`);
  }

  const parcourir = async (segments, profondeur) => {
    const items = (await listerDossierDrive(segments, EXPORTS_ROOT_FOLDER)) || [];
    if (segments[segments.length - 1] === "Archives") {
      const groupes = new Map();
      for (const it of items) {
        if (it.folder || aSupprimer.has(it.id)) continue;
        const m = it.name.match(/^(.*)_(\d{4}-\d{2})(?:-\d{2})?\.(pdf|xlsx)$/i);
        if (!m) continue;
        const cle = `${m[1]}|${m[2]}|${m[3].toLowerCase()}`;
        if (!groupes.has(cle)) groupes.set(cle, []);
        groupes.get(cle).push(it);
      }
      for (const liste of groupes.values()) {
        if (liste.length < 2) continue;
        liste.sort((a, b) => b.name.localeCompare(a.name) || new Date(b.lastModifiedDateTime) - new Date(a.lastModifiedDateTime));
        liste.slice(1).forEach(it => doublons.liste.push({ ...it, site: `Archives ${segments.slice(0, -1).join(" / ")}` }));
      }
      return;
    }
    if (profondeur >= 4) return;
    for (const f of items.filter(x => x.folder)) {
      await parcourir([...segments, f.name], profondeur + 1);
    }
  };
  await parcourir([], 0);
}

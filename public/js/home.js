import { resolveDayN1, resolveDayN2, computeWeeklyTitulaires, YEAR_START, YEAR_END, HOLIDAYS, dateKey, esc, initials, colorForPerson, nextHandover, addDays } from "./astreinte-logic.js";
import { watchPeople, watchAbsences } from "./firestore-data.js";
import { watchTransferts } from "./transfert-data.js";
import { transfertBannerHTML, attachTransfertListeners } from "./transfert-ui.js";
import { watchSitesDossiers } from "./site-dossier-data.js";
import { watchAssociations } from "./associations-data.js";
import { initCarteSites } from "./site-map.js";

let unsubs = [];
let people = { n1: [], n2: [] };
let absences = [];
let transferts = [];
let dossiers = [];
let associations = [];
let mountedContainer = null;
let mountedUser = null;
let catsRef = [];
let onSelectRef = null;
let onReorderRef = null;
let clearCountdown = null;
let debugForce = false;
let modeReorganisation = false;
let carteInstance = null;
let filtreAssociation = "";
let filtreSite = "";

// "Mes sites favoris" — accès rapide personnel à quelques fiches (voir la
// carte des sites sur Camelia GMAO). Purement une commodité d'affichage,
// pas une donnée métier partagée : stockée dans ce navigateur (comme le
// thème sombre/clair) plutôt que dans Firestore, pour rester disponible
// tout de suite sans avoir à ouvrir de nouveaux droits d'écriture.
const CLE_FAVORIS = "etablieres-sites-favoris";
function chargerFavoris() {
  try { return JSON.parse(localStorage.getItem(CLE_FAVORIS) || "[]"); } catch { return []; }
}
function sauvegarderFavoris(liste) {
  try { localStorage.setItem(CLE_FAVORIS, JSON.stringify(liste)); } catch { /* stockage indisponible, tant pis */ }
}

function cleanup() {
  unsubs.forEach(u => u());
  unsubs = [];
  if (clearCountdown) { clearCountdown(); clearCountdown = null; }
  if (carteInstance) { carteInstance.detruire(); carteInstance = null; }
  if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
  modeReorganisation = false;
}

export function mountDashboard(container, user, categories, onSelect, onReorder) {
  cleanup();
  mountedContainer = container;
  mountedUser = user;
  catsRef = categories;
  onSelectRef = onSelect;
  onReorderRef = onReorder;
  filtreAssociation = ""; filtreSite = "";
  container.innerHTML = `<div class="hint">Chargement…</div>`;
  unsubs.push(watchPeople((p) => { people = p; scheduleRender(); }));
  unsubs.push(watchAbsences((a) => { absences = a; scheduleRender(); }));
  unsubs.push(watchTransferts((t) => { transferts = t; scheduleRender(); }));
  unsubs.push(watchSitesDossiers((d) => { dossiers = d; scheduleRender(); }));
  unsubs.push(watchAssociations((a) => { associations = a; scheduleRender(); }));
}

// L'accueil écoute 5 flux Firestore indépendants — sans regroupement, la
// carte des sites (plus lourde à (re)créer que le reste) serait détruite
// et reconstruite à chaque arrivée, avec un effet de saut/scintillement
// à l'ouverture. Voir la même logique dans planning.js (onglet Astreinte).
let renderTimer = null;
function scheduleRender() {
  if (renderTimer) clearTimeout(renderTimer);
  renderTimer = setTimeout(() => { renderTimer = null; render(); }, 60);
}

// Bloc "Vos sites" de l'accueil (carte + filtres + favoris), inspiré de
// l'écran d'accueil de Camelia GMAO. N'est affiché que si l'utilisateur a
// accès à la tuile "Dossiers de site" (catsRef reflète déjà les droits).
function sitesFiltresPourCarte() {
  return dossiers.filter(d => {
    if (filtreAssociation && d.association !== filtreAssociation) return false;
    if (filtreSite && d.id !== filtreSite) return false;
    return true;
  });
}

function blocSitesHTML() {
  const totalEquipements = dossiers.reduce((s, d) => s + (d.sections || []).filter(sec => sec.concerne).length, 0);
  const favorisIds = chargerFavoris();
  const favorisDossiers = favorisIds.map(id => dossiers.find(d => d.id === id)).filter(Boolean);
  const dossiersPourAssoc = filtreAssociation ? dossiers.filter(d => d.association === filtreAssociation) : dossiers;
  const dispoPourAjout = dossiers.filter(d => !favorisIds.includes(d.id)).sort((a, b) => (a.nom || "").localeCompare(b.nom || ""));

  return `
    <div class="form-card">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:12px">
        <h3 style="margin:0;font-size:14px;color:var(--gold)">🗺️ Vos sites</h3>
        <div style="display:flex;gap:20px">
          <div style="text-align:center"><div style="font-size:20px;font-weight:800">${dossiers.length}</div><div class="hint" style="margin:0">Sites</div></div>
          <div style="text-align:center"><div style="font-size:20px;font-weight:800">${totalEquipements}</div><div class="hint" style="margin:0">Équipements suivis</div></div>
        </div>
      </div>
      <div class="home-carte-grid" style="display:grid;gap:16px;align-items:start">
        <div>
          <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px">
            <select id="hm-filtre-assoc"><option value="">Toutes les associations</option>${associations.map(a => `<option value="${esc(a.nom)}" ${filtreAssociation === a.nom ? "selected" : ""}>${esc(a.nom)}</option>`).join("")}</select>
            <select id="hm-filtre-site"><option value="">Tous les sites</option>${dossiersPourAssoc.map(d => `<option value="${d.id}" ${filtreSite === d.id ? "selected" : ""}>${esc(d.nom)}</option>`).join("")}</select>
          </div>
          <p class="hint" id="hm-carte-statut" style="margin:0 0 6px"></p>
          <div id="hm-carte-holder" style="height:360px;min-height:280px;border-radius:12px;overflow:hidden;border:1px solid var(--border)"></div>
        </div>
        <div>
          <h4 style="margin:0 0 8px;font-size:13px;color:var(--gold)">Mes sites favoris</h4>
          ${favorisDossiers.length === 0 ? `<p class="hint">Aucun site épinglé pour l'instant.</p>` : favorisDossiers.map(d => `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border);gap:8px">
              <button data-ouvrir-favori="${d.id}" style="border:none;background:none;padding:0;color:var(--gold);font-weight:700;text-align:left;cursor:pointer;font-size:13px">${esc(d.nom)}</button>
              <button class="del-btn" data-retirer-favori="${d.id}" title="Retirer" style="padding:2px 8px">🗑️</button>
            </div>
          `).join("")}
          ${dispoPourAjout.length > 0 ? `
          <div style="display:flex;gap:6px;margin-top:10px">
            <select id="hm-favori-select" style="flex:1;min-width:0">${dispoPourAjout.map(d => `<option value="${d.id}">${esc(d.nom)}</option>`).join("")}</select>
            <button class="add-btn" id="hm-favori-ajouter" style="white-space:nowrap">+ Ajouter</button>
          </div>` : ""}
        </div>
      </div>
    </div>
  `;
}

function attacherEcouteursBlocSites() {
  document.getElementById("hm-filtre-assoc")?.addEventListener("change", (e) => { filtreAssociation = e.target.value; filtreSite = ""; render(); });
  document.getElementById("hm-filtre-site")?.addEventListener("change", (e) => { filtreSite = e.target.value; render(); });
  mountedContainer.querySelectorAll("[data-ouvrir-favori]").forEach(btn => {
    btn.addEventListener("click", () => onSelectRef("sites", btn.dataset.ouvrirFavori));
  });
  mountedContainer.querySelectorAll("[data-retirer-favori]").forEach(btn => {
    btn.addEventListener("click", () => {
      sauvegarderFavoris(chargerFavoris().filter(id => id !== btn.dataset.retirerFavori));
      render();
    });
  });
  document.getElementById("hm-favori-ajouter")?.addEventListener("click", () => {
    const id = document.getElementById("hm-favori-select")?.value;
    if (!id) return;
    const liste = chargerFavoris();
    if (!liste.includes(id)) { liste.push(id); sauvegarderFavoris(liste); }
    render();
  });

  if (carteInstance) { carteInstance.detruire(); carteInstance = null; }
  const holder = document.getElementById("hm-carte-holder");
  if (holder) {
    carteInstance = initCarteSites(holder, sitesFiltresPourCarte(), {
      onOpenSite: (id) => onSelectRef("sites", id),
      onStatut: (texte) => { const el = document.getElementById("hm-carte-statut"); if (el) el.textContent = texte; },
    });
  }
}

function render() {
  if (!mountedContainer || !mountedUser) return;
  if (!document.contains(mountedContainer)) { cleanup(); return; }
  const today = new Date();
  const inRange = today >= addDays(YEAR_START, -7) && today <= addDays(YEAR_END, 7);
  const refDate = inRange ? today : YEAR_START;
  // Une personne peut figurer dans les listes N1/N2 (note de frais,
  // interventions, planning individuel...) sans jamais être tirée au sort
  // dans le roulement d'astreinte (ex. gael, ajouté seulement pour ses
  // congés, décoché "Astreinte" dans "Noms des personnes") : comme dans
  // l'onglet Calendrier, on calcule le roulement sur une version filtrée
  // des listes, jamais sur `people` brut — sinon la bulle d'accueil peut
  // afficher quelqu'un de non-astreinte comme titulaire du jour.
  const astreinteActive = people.astreinteActive || {};
  const peopleAstreinte = {
    ...people,
    n1: people.n1.filter(nom => astreinteActive[nom] !== false),
    n2: people.n2.filter(nom => astreinteActive[nom] !== false),
  };
  const hasPeople = peopleAstreinte.n1.length > 0 && peopleAstreinte.n2.length > 0;

  let n1 = null, n2 = null, holidayToday = null, next = null;
  if (hasPeople) {
    const { titN1, titN2 } = computeWeeklyTitulaires(peopleAstreinte, absences);
    n1 = resolveDayN1(refDate, peopleAstreinte, absences, titN1);
    n2 = resolveDayN2(refDate, peopleAstreinte, absences, titN2);
    holidayToday = HOLIDAYS.get(dateKey(refDate));
    if (inRange) next = nextHandover(refDate, peopleAstreinte, absences, titN1, resolveDayN1, 3);
  }
  const confirmedRecord = next ? transferts.find(t => t.id === dateKey(next.date)) : null;

  if (debugForce) { next = { from: "Test A", to: "Test B", date: refDate, daysUntil: 0 }; }

  if (clearCountdown) { clearCountdown(); clearCountdown = null; }

  mountedContainer.innerHTML = `
    <div class="stack">
      ${transfertBannerHTML(next, confirmedRecord)}

      <div class="hero">
        <div class="hero-label">Bonjour ${esc(mountedUser.nom || mountedUser.email)}</div>
        ${hasPeople ? `
        <div class="hero-blocks">
          <div class="hero-block n1">
            <div class="avatar" style="background:${colorForPerson(n1.assigned, people)}"></div>
            <div><div class="hero-block-label">Astreinte N1 aujourd'hui</div><div class="hero-block-value">${esc(n1.assigned)}</div></div>
          </div>
          <div class="hero-block n2">
            <div class="avatar" style="background:${colorForPerson(n2.assigned, people)}"></div>
            <div><div class="hero-block-label">Astreinte N2 aujourd'hui</div><div class="hero-block-value">${esc(n2.assigned)}</div></div>
          </div>
        </div>
        ${holidayToday ? `<div style="margin-top:10px;color:var(--violet);font-size:12px">☀️ ${esc(holidayToday)}</div>` : ""}
        ` : `<p class="hint">Astreinte pas encore configurée.</p>`}
      </div>

      ${catsRef.some(c => c.id === "sites") && dossiers.length > 0 ? blocSitesHTML() : ""}

      <div class="bubble-grid">
        ${catsRef.map((c, idx) => {
          const peutReorganiser = modeReorganisation && (mountedUser.role === "admin" || mountedUser.role === "super_admin");
          return `
          <div style="position:relative;height:100%">
            <button class="bubble-card" data-cat="${c.id}">
              ${c.badgeAtelier || c.badgeSites ? `
                <span style="position:absolute;top:8px;left:8px;display:flex;gap:4px">
                  ${c.badgeAtelier ? `<span title="Alertes stock atelier" style="background:var(--red);color:#fff;border-radius:999px;min-width:20px;height:20px;padding:0 5px;font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center;line-height:1">🔧${c.badgeAtelier > 99 ? "99+" : c.badgeAtelier}</span>` : ""}
                  ${c.badgeSites ? `<span title="Alertes stock déporté (sites)" style="background:var(--orange,#e08a2e);color:#fff;border-radius:999px;min-width:20px;height:20px;padding:0 5px;font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center;line-height:1">🏢${c.badgeSites > 99 ? "99+" : c.badgeSites}</span>` : ""}
                </span>
              ` : c.badge ? `<span style="position:absolute;top:8px;left:8px;background:var(--red);color:#fff;border-radius:999px;min-width:20px;height:20px;padding:0 5px;font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center;line-height:1">${c.badge > 99 ? "99+" : c.badge}</span>` : ""}
              <span class="bubble-icon">${c.icon}</span>
              <span class="bubble-label">${esc(c.label)}</span>
              <span class="bubble-desc">${esc(c.desc || "")}</span>
            </button>
            ${peutReorganiser ? `
              <div style="position:absolute;top:6px;right:6px;display:flex;gap:2px">
                <button class="nav-btn" data-reorder-left="${c.id}" style="padding:2px 6px;font-size:10px" ${idx === 0 ? "disabled" : ""}>◀</button>
                <button class="nav-btn" data-reorder-right="${c.id}" style="padding:2px 6px;font-size:10px" ${idx === catsRef.length - 1 ? "disabled" : ""}>▶</button>
              </div>
            ` : ""}
          </div>
        `;}).join("")}
      </div>

      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <a href="https://etablieresfr.sharepoint.com/sites/appsmm" target="_blank" rel="noopener" class="nav-btn" style="text-decoration:none;display:inline-flex;align-items:center">🔗 Ouvrir SharePoint (appsmm)</a>
      </div>

      ${(mountedUser.role === "admin" || mountedUser.role === "super_admin") ? `
      <button class="nav-btn" id="toggle-reorg" style="width:fit-content;opacity:.7;font-size:11px">${modeReorganisation ? "✓ Terminé" : "🔧 Réorganiser les bulles"}</button>
      ` : ""}

      ${(mountedUser.role === "admin" || mountedUser.role === "super_admin") ? `
      <button class="nav-btn" id="debug-toggle" style="width:fit-content;opacity:.6;font-size:11px">🧪 ${debugForce ? "Arrêter le test du bandeau" : "Tester l'affichage du bandeau de transfert"}</button>
      ` : ""}
    </div>
  `;

  mountedContainer.querySelectorAll("[data-cat]").forEach(btn => {
    btn.addEventListener("click", () => onSelectRef(btn.dataset.cat));
  });
  if (catsRef.some(c => c.id === "sites") && dossiers.length > 0) attacherEcouteursBlocSites();
  mountedContainer.querySelectorAll("[data-reorder-left], [data-reorder-right]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.dataset.reorderLeft || btn.dataset.reorderRight;
      const sens = btn.dataset.reorderLeft ? -1 : 1;
      onReorderRef?.(id, sens);
    });
  });
  document.getElementById("debug-toggle")?.addEventListener("click", () => { debugForce = !debugForce; render(); });
  document.getElementById("toggle-reorg")?.addEventListener("click", () => { modeReorganisation = !modeReorganisation; render(); });

  clearCountdown = attachTransfertListeners(mountedContainer, next, mountedUser, () => render());
}

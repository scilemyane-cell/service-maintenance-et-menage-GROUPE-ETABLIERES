import { resolveDayN1, resolveDayN2, computeWeeklyTitulaires, YEAR_START, YEAR_END, HOLIDAYS, dateKey, esc, initials, colorForPerson, nextHandover, addDays } from "./astreinte-logic.js";
import { watchPeople, watchAbsences } from "./firestore-data.js";
import { watchTransferts } from "./transfert-data.js";
import { transfertBannerHTML, attachTransfertListeners } from "./transfert-ui.js";
import { watchSitesDossiers } from "./site-dossier-data.js";
import { watchAssociations } from "./associations-data.js";
import { initCarteSites } from "./site-map.js";
import { watchCompteursTotal } from "./compteurs-data.js";
import { watchFavoris, saveFavoris } from "./favoris-data.js";

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
let horlogeTimer = null;
let nbCompteurs = null;
let onToggleConstructionRef = null;

// "Mes sites favoris" — accès rapide personnel à quelques fiches (voir la
// carte des sites sur Camelia GMAO). Purement une commodité d'affichage,
// pas une donnée métier partagée : stockée dans ce navigateur (comme le
// thème sombre/clair) plutôt que dans Firestore, pour rester disponible
// tout de suite sans avoir à ouvrir de nouveaux droits d'écriture.
// Ancienne version : favoris stockés dans le navigateur. Repris une seule
// fois vers Firestore (favoris-sites/{uid}) au premier chargement.
const CLE_FAVORIS_LOCAL = "etablieres-sites-favoris";
let favoris = [];
let favorisErreur = null;
function chargerFavoris() { return favoris; }
async function sauvegarderFavoris(liste) {
  const avant = favoris;
  favoris = liste; render();
  try { await saveFavoris(mountedUser.uid, liste); }
  catch (err) {
    console.error("saveFavoris:", err);
    favoris = avant; render();
    alert("Favoris non enregistrés : " + (err?.code === "permission-denied" ? "les règles Firestore doivent être republiées (collection favoris-sites)." : (err?.message || err)));
  }
}

function cleanup() {
  unsubs.forEach(u => u());
  unsubs = [];
  if (clearCountdown) { clearCountdown(); clearCountdown = null; }
  if (carteInstance) { carteInstance.detruire(); carteInstance = null; }
  if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
  if (horlogeTimer) { clearInterval(horlogeTimer); horlogeTimer = null; }
  modeReorganisation = false;
}

export function mountDashboard(container, user, categories, onSelect, onReorder, onToggleConstruction = null) {
  cleanup();
  mountedContainer = container;
  mountedUser = user;
  catsRef = categories;
  onSelectRef = onSelect;
  onReorderRef = onReorder;
  onToggleConstructionRef = onToggleConstruction;
  filtreAssociation = ""; filtreSite = "";
  container.classList.add("content-accueil");
  container.innerHTML = `<div class="hint">Chargement…</div>`;
  unsubs.push(watchPeople((p) => { people = p; scheduleRender(); }));
  unsubs.push(watchAbsences((a) => { absences = a; scheduleRender(); }));
  unsubs.push(watchTransferts((t) => { transferts = t; scheduleRender(); }));
  unsubs.push(watchSitesDossiers((d) => { dossiers = d; scheduleRender(); }));
  unsubs.push(watchAssociations((a) => { associations = a; scheduleRender(); }));
  unsubs.push(watchCompteursTotal((n) => { nbCompteurs = n; scheduleRender(); }));
  favoris = []; favorisErreur = null;
  if (user.uid) unsubs.push(watchFavoris(user.uid, (ids) => {
    if (ids === null) {
      // Jamais enregistré : reprise des favoris de l'ancienne version
      // (navigateur), uniquement pour son propre compte.
      let locaux = [];
      if (!user.apercu) { try { locaux = JSON.parse(localStorage.getItem(CLE_FAVORIS_LOCAL) || "[]"); } catch { locaux = []; } }
      favoris = locaux;
      if (locaux.length) saveFavoris(user.uid, locaux).then(() => { try { localStorage.removeItem(CLE_FAVORIS_LOCAL); } catch {} }).catch(() => {});
    } else favoris = ids;
    favorisErreur = null; scheduleRender();
  }, (err) => { favorisErreur = err; scheduleRender(); }));
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

// Lien direct vers la GMAO Camileia du groupe — l'accueil reprend la
// disposition de la page d'accueil Camileia (carte + filtres à gauche,
// compteurs et favoris, mosaïque de tuiles, notifications à droite) pour
// que les deux outils se ressemblent et que l'on passe de l'un à l'autre
// sans se perdre.
const URL_GMAO = "https://namixis.camileia.com";
const URL_SHAREPOINT = "https://etablieresfr.sharepoint.com/sites/appsmm";

// Dégradés des tuiles (à défaut de photos) — attribués de façon stable
// par identifiant de tuile, pour qu'une tuile garde toujours sa couleur.
const DEGRADES_TUILES = [
  ["#1F3B63", "#0E1B30"], ["#5B2340", "#2A0F1F"], ["#1E4F4B", "#0C2422"], ["#4A3B1C", "#231B0B"],
  ["#3A2E62", "#191430"], ["#1F4A2E", "#0D2215"], ["#5A3021", "#2A140C"], ["#23405A", "#0F1D2A"],
];
function degradePour(id) {
  let h = 0; for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const [a, b] = DEGRADES_TUILES[h % DEGRADES_TUILES.length];
  return `linear-gradient(145deg, ${a}, ${b})`;
}

function totalEquipements() {
  return dossiers.reduce((s, d) => s + (d.sections || []).filter(sec => sec.concerne).length, 0);
}

// Options d'une liste de sites, rangées par association (dans l'ordre
// des associations de l'Administration) puis par sous-groupe et par nom.
function optionsSitesRangees(liste, selectionne = "") {
  const ordreAssoc = new Map(associations.map((a, i) => [a.nom, i]));
  const groupes = new Map();
  [...liste].sort((a, b) =>
    (ordreAssoc.get(a.association) ?? 999) - (ordreAssoc.get(b.association) ?? 999)
    || (a.association || "").localeCompare(b.association || "", "fr")
    || (a.groupe || "").localeCompare(b.groupe || "", "fr")
    || (a.nom || "").localeCompare(b.nom || "", "fr", { numeric: true })
  ).forEach(d => {
    const cle = [d.association || "Sans association", d.groupe].filter(Boolean).join(" — ");
    if (!groupes.has(cle)) groupes.set(cle, []);
    groupes.get(cle).push(d);
  });
  return [...groupes].map(([cle, ds]) => `<optgroup label="${esc(cle)}">${ds.map(d => `<option value="${d.id}" ${selectionne === d.id ? "selected" : ""}>${esc(d.nom)}</option>`).join("")}</optgroup>`).join("");
}

function blocCarteHTML() {
  const dossiersPourAssoc = filtreAssociation ? dossiers.filter(d => d.association === filtreAssociation) : dossiers;
  return `
    <section class="gh-carte gh-rouge">
      <div class="gh-filtres">
        <label>UG :<select id="hm-filtre-assoc"><option value="">Toutes</option>${associations.map(a => `<option value="${esc(a.nom)}" ${filtreAssociation === a.nom ? "selected" : ""}>${esc(a.nom)}</option>`).join("")}</select></label>
        <label>Site :<select id="hm-filtre-site"><option value="">Tous</option>${optionsSitesRangees(dossiersPourAssoc, filtreSite)}</select></label>
      </div>
      <div id="hm-carte-holder" class="gh-carte-holder"></div>
      <p id="hm-carte-statut" class="gh-carte-statut"></p>
    </section>`;
}

function blocCompteursEtFavorisHTML() {
  const favorisIds = chargerFavoris();
  const favorisDossiers = favorisIds.map(id => dossiers.find(d => d.id === id)).filter(Boolean);
  const dispoPourAjout = dossiers.filter(d => !favorisIds.includes(d.id)).sort((a, b) => (a.nom || "").localeCompare(b.nom || ""));
  const peutRelever = catsRef.some(c => c.id === "compteurs");
  return `
    <div class="gh-milieu">
      <section class="gh-panneau-clair gh-compteurs">
        <div><b>${dossiers.length}</b><span>Sites</span></div>
        <div class="gh-sep"></div>
        <div><b>${nbCompteurs === null ? "—" : nbCompteurs}</b><span>Compteurs</span></div>
      </section>
      <section class="gh-panneau-clair gh-favoris">
        <h3>${mountedUser.apercu ? `Favoris de ${esc(mountedUser.nom || mountedUser.email)}` : "Mes sites favoris"}</h3>
        ${favorisErreur ? `<p class="gh-vide" style="color:#C23B27">⚠️ Favoris indisponibles${favorisErreur.code === "permission-denied" ? " — règles Firestore à republier (favoris-sites)" : ""}.</p>` : ""}
        <div class="gh-favoris-liste">
          ${favorisDossiers.length === 0 ? `<p class="gh-vide">Aucun site épinglé.</p>` : favorisDossiers.map(d => `
            <div class="gh-favori">
              <button data-ouvrir-favori="${d.id}">${esc(d.nom)}</button>
              <span class="gh-favori-actions">
                ${peutRelever && d.compteursActifs ? `<button class="gh-raccourci" data-relever-site="${d.id}" title="Compteurs de ce site">🎛️</button>` : ""}
                <button class="gh-favori-suppr" data-retirer-favori="${d.id}" title="Retirer">✕</button>
              </span>
            </div>`).join("")}
        </div>
        ${dispoPourAjout.length > 0 ? `
          <div class="gh-favori-ajout">
            <select id="hm-favori-select"><option value="">— Choisir un site à ajouter —</option>${optionsSitesRangees(dispoPourAjout)}</select>
            <button class="gh-bouton-rouge" id="hm-favori-ajouter">＋ Ajouter un site</button>
          </div>` : ""}
      </section>
    </div>`;
}

function attacherEcouteursBlocSites() {
  document.getElementById("hm-filtre-assoc")?.addEventListener("change", (e) => { filtreAssociation = e.target.value; filtreSite = ""; render(); });
  document.getElementById("hm-filtre-site")?.addEventListener("change", (e) => { filtreSite = e.target.value; render(); });
  mountedContainer.querySelectorAll("[data-ouvrir-favori]").forEach(btn => {
    btn.addEventListener("click", () => onSelectRef("sites", btn.dataset.ouvrirFavori));
  });
  mountedContainer.querySelectorAll("[data-relever-site]").forEach(btn => {
    btn.addEventListener("click", () => {
      window.compteursRapideSiteDeepLinkId = btn.dataset.releverSite;
      onSelectRef("compteurs");
    });
  });
  // Suppression d'un favori en deux temps : 1er clic = le bouton passe en
  // "Retirer ?" (4 s pour se raviser), 2e clic = fenêtre de confirmation.
  mountedContainer.querySelectorAll("[data-retirer-favori]").forEach(btn => {
    let arme = null;
    btn.addEventListener("click", async () => {
      const id = btn.dataset.retirerFavori;
      if (!arme) {
        btn.textContent = "Retirer ?"; btn.classList.add("gh-favori-suppr-arme");
        arme = setTimeout(() => { arme = null; btn.textContent = "✕"; btn.classList.remove("gh-favori-suppr-arme"); }, 4000);
        return;
      }
      clearTimeout(arme); arme = null;
      const nom = dossiers.find(d => d.id === id)?.nom || "ce site";
      const ok = window.confirmDialog
        ? await window.confirmDialog(`Retirer « ${nom} » des sites favoris${mountedUser.apercu ? ` de ${mountedUser.nom || mountedUser.email}` : ""} ?`, { texteValider: "Retirer" })
        : confirm(`Retirer « ${nom} » des sites favoris ?`);
      if (!ok) { btn.textContent = "✕"; btn.classList.remove("gh-favori-suppr-arme"); return; }
      sauvegarderFavoris(chargerFavoris().filter(x => x !== id));
    });
  });
  document.getElementById("hm-favori-ajouter")?.addEventListener("click", () => {
    const id = document.getElementById("hm-favori-select")?.value;
    if (!id) return;
    const liste = chargerFavoris();
    if (!liste.includes(id)) sauvegarderFavoris([...liste, id]);
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

  const estAdmin = mountedUser.role === "admin" || mountedUser.role === "super_admin";
  const afficherSites = catsRef.some(c => c.id === "sites") && dossiers.length > 0;

  // ---- Notifications (panneau de droite) ----
  const notifs = [];
  catsRef.forEach(c => {
    if (c.badgeAtelier) notifs.push({ cat: c.id, icone: "🔧", texte: `${c.badgeAtelier} alerte(s) stock atelier`, niveau: "rouge" });
    if (c.badgeSites) notifs.push({ cat: c.id, icone: "🏢", texte: `${c.badgeSites} alerte(s) stock déporté (sites)`, niveau: "orange" });
    if (!c.badgeAtelier && !c.badgeSites && c.badge) notifs.push({ cat: c.id, icone: c.icon, texte: `${c.badge} élément(s) à traiter — ${c.label}`, niveau: "rouge" });
  });
  if (next && !debugForce) notifs.push({ cat: "astreinte", icone: "📞", texte: `Transfert d'astreinte ${next.daysUntil === 0 ? "aujourd'hui" : next.daysUntil === 1 ? "demain" : `dans ${next.daysUntil} j`} : ${next.from} → ${next.to}`, niveau: confirmedRecord ? "vert" : "orange" });
  if (holidayToday) notifs.push({ icone: "☀️", texte: `Jour férié : ${holidayToday}`, niveau: "violet" });

  const jour = today.toLocaleDateString("fr-FR", { weekday: "short" });
  const heure = today.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

  mountedContainer.innerHTML = `
    <div class="gh">
      ${transfertBannerHTML(next, confirmedRecord)}

      <div class="gh-entete">
        <div class="gh-date">
          <span class="gh-horloge" id="gh-heure">🕘 ${heure}</span>
          <span class="gh-jour"><span>${esc(jour)}</span> <b>${today.getDate()}</b><br>${today.toLocaleDateString("fr-FR", { month: "long" })}</span>
        </div>
        <img src="img/logo-etablieres.png" alt="Groupe Établières" class="gh-logo">
        <div class="gh-bonjour">Bonjour <b>${esc(mountedUser.nom || mountedUser.email)}</b></div>
      </div>

      <div class="gh-grille ${afficherSites ? "" : "gh-sans-sites"}">
        ${afficherSites ? blocCarteHTML() : ""}
        ${afficherSites ? blocCompteursEtFavorisHTML() : ""}

        <section class="gh-tuiles">
          ${catsRef.map((c, idx) => {
            const peutReorganiser = modeReorganisation && estAdmin;
            return `
            <div class="gh-tuile-wrap">
              <button class="gh-tuile ${c.enConstruction ? "gh-tuile-construction" : ""}" data-cat="${c.id}" title="${esc(c.desc || c.label)}${c.enConstruction ? " — 🚧 en construction, visible uniquement par le Super Admin" : ""}" style="background:${degradePour(c.id)}">
                ${c.enConstruction ? `<span class="gh-ruban">🚧 En construction</span>` : ""}
                ${c.badgeAtelier || c.badgeSites ? `
                  <span class="gh-badges">
                    ${c.badgeAtelier ? `<span class="gh-badge" title="Alertes stock atelier">🔧${c.badgeAtelier > 99 ? "99+" : c.badgeAtelier}</span>` : ""}
                    ${c.badgeSites ? `<span class="gh-badge gh-badge-orange" title="Alertes stock déporté (sites)">🏢${c.badgeSites > 99 ? "99+" : c.badgeSites}</span>` : ""}
                  </span>` : c.badge ? `<span class="gh-badges"><span class="gh-badge">${c.badge > 99 ? "99+" : c.badge}</span></span>` : ""}
                <span class="gh-tuile-icone">${c.icon}</span>
                <span class="gh-tuile-label">${esc(c.label)}</span>
              </button>
              ${peutReorganiser ? `
                <div class="gh-reorg">
                  <button class="nav-btn" data-reorder-left="${c.id}" ${idx === 0 ? "disabled" : ""}>◀</button>
                  <button class="nav-btn" data-reorder-right="${c.id}" ${idx === catsRef.length - 1 ? "disabled" : ""}>▶</button>
                  ${onToggleConstructionRef && c.id !== "statistiques" ? `<button class="nav-btn ${c.enConstruction ? "active" : ""}" data-construction="${c.id}" title="${c.enConstruction ? "Remettre en service (visible par tous)" : "Passer en construction (masqué pour les autres)"}">🚧</button>` : ""}
                </div>` : ""}
            </div>`;
          }).join("")}
          <div class="gh-tuile-wrap">
            <a class="gh-tuile gh-tuile-gmao" href="${URL_GMAO}" target="_blank" rel="noopener" title="Ouvrir la GMAO Camileia dans un nouvel onglet">
              <span class="gh-tuile-icone">🛠️</span>
              <span class="gh-tuile-label">GMAO Camileia ↗</span>
            </a>
          </div>
          <div class="gh-tuile-wrap">
            <a class="gh-tuile" href="${URL_SHAREPOINT}" target="_blank" rel="noopener" title="Ouvrir le site SharePoint appsmm" style="background:${degradePour("sharepoint")}">
              <span class="gh-tuile-icone">🔗</span>
              <span class="gh-tuile-label">SharePoint ↗</span>
            </a>
          </div>
        </section>

        <section class="gh-notifs gh-rouge">
          <h3>${notifs.length} Notification${notifs.length > 1 ? "s" : ""}</h3>
          <div class="gh-notifs-corps">
            ${hasPeople ? `
              <div class="gh-astreinte">
                <p class="gh-astreinte-titre">Astreinte aujourd'hui</p>
                <div class="gh-astreinte-ligne"><span class="avatar" style="background:${colorForPerson(n1.assigned, people)}"></span><span>N1</span><b>${esc(n1.assigned)}</b></div>
                <div class="gh-astreinte-ligne"><span class="avatar" style="background:${colorForPerson(n2.assigned, people)}"></span><span>N2</span><b>${esc(n2.assigned)}</b></div>
              </div>` : `<p class="gh-vide">Astreinte pas encore configurée.</p>`}
            ${notifs.length === 0 ? `<p class="gh-aucune">Aucune notification</p>` : notifs.map(n => `
              <${n.cat ? `button data-notif-cat="${n.cat}"` : "div"} class="gh-notif gh-notif-${n.niveau}">
                <span>${n.icone}</span><span>${esc(n.texte)}</span>
              </${n.cat ? "button" : "div"}>`).join("")}
          </div>
        </section>
      </div>

      ${estAdmin ? `
      <div class="gh-outils">
        <button class="nav-btn" id="toggle-reorg">${modeReorganisation ? "✓ Terminé" : (onToggleConstructionRef ? "🔧 Réorganiser / 🚧 construction" : "🔧 Réorganiser les tuiles")}</button>
        <button class="nav-btn" id="debug-toggle">🧪 ${debugForce ? "Arrêter le test du bandeau" : "Tester le bandeau de transfert"}</button>
      </div>` : ""}
    </div>
  `;

  mountedContainer.querySelectorAll("[data-construction]").forEach(btn => {
    btn.addEventListener("click", (e) => { e.stopPropagation(); onToggleConstructionRef?.(btn.dataset.construction); });
  });
  mountedContainer.querySelectorAll("[data-notif-cat]").forEach(btn => {
    btn.addEventListener("click", () => onSelectRef(btn.dataset.notifCat));
  });
  if (horlogeTimer) clearInterval(horlogeTimer);
  horlogeTimer = setInterval(() => {
    const el = document.getElementById("gh-heure");
    if (!el) { clearInterval(horlogeTimer); horlogeTimer = null; return; }
    el.textContent = "🕘 " + new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  }, 30000);

  mountedContainer.querySelectorAll("[data-cat]").forEach(btn => {
    btn.addEventListener("click", () => onSelectRef(btn.dataset.cat));
  });
  if (afficherSites) attacherEcouteursBlocSites();
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

  import { watchAuth, logout, roleLabel } from "./auth.js";
  import "./ui-feedback.js";
  import { watchCompteursAlertCount } from "./compteurs-data.js";
  import { mountDashboard } from "./home.js";
  import { watchHomeOrder, saveHomeOrder } from "./home-order-data.js";
  import { watchStockAlertCount } from "./stock-alerts-data.js";
  import { mountFichesForDispositif } from "./fiches.js";
  import { watchDispositifSettings, heuresEnabled } from "./dispositif-settings-data.js";
  import { watchSites } from "./sites-data.js";
  import { watchAccess, hasAccess } from "./access-data.js";
  import { initTheme, cycleTheme, getStoredTheme, THEME_LABELS, getThemeModules, basculerThemeModules } from "./theme.js";
  import { watchModulesConstruction, basculerModuleConstruction } from "./modules-construction-data.js";
  import { watchUsers, updateUser } from "./users-data.js";
  import { db as dbMig } from "./firebase-init.js";
  import { doc as docMig, getDoc as getDocMig, setDoc as setDocMig } from "./firestore-compte.js";
  import { watchOrdreOnglets, saveOrdreOnglets } from "./ordre-onglets-data.js";

  initTheme();

  let currentUser = null;
  let currentCategory = null; // null = accueil (bulles)

  // ---------------------------------------------------------------
  // Modules chargés À LA DEMANDE : le code d'un module (Astreinte, Stock,
  // Compteurs…) n'est téléchargé qu'à la première ouverture de sa tuile,
  // au lieu de tout charger au démarrage (ouverture plus rapide sur
  // téléphone). Les modules déjà ouverts restent en mémoire.
  // ---------------------------------------------------------------
  let jetonNavigation = 0;
  function aLaDemande(charger, nom) {
    return (cible, user, ...reste) => {
      const jeton = ++jetonNavigation;
      const attente = setTimeout(() => { if (jeton === jetonNavigation && cible && !cible.childElementCount) cible.innerHTML = `<div class="hint" style="padding:24px;text-align:center">Chargement…</div>`; }, 120);
      return charger().then(m => {
        clearTimeout(attente);
        if (jeton !== jetonNavigation) return; // l'utilisateur est déjà ailleurs
        return m[nom](cible, user, ...reste);
      }).catch(err => {
        clearTimeout(attente);
        console.error("Chargement du module", nom, err);
        if (jeton === jetonNavigation && cible) cible.innerHTML = `<div class="placeholder-card"><b>Module impossible à charger</b><br><br>Vérifie la connexion puis <button class="nav-btn" onclick="location.reload()">Recharger</button></div>`;
      });
    };
  }
  const charger_planning = () => import("./planning.js");
  const mountCalendrier = aLaDemande(charger_planning, "mountCalendrier");
  const mountAbsencesTab = aLaDemande(charger_planning, "mountAbsencesTab");
  const mountInterventionsTab = aLaDemande(charger_planning, "mountInterventionsTab");
  const mountSyntheseTab = aLaDemande(charger_planning, "mountSyntheseTab");
  const mountTransfertsTab = aLaDemande(charger_planning, "mountTransfertsTab");
  const mountCoordonneesTab = aLaDemande(charger_planning, "mountCoordonneesTab");
  const mountArchiveRelevesTab = aLaDemande(charger_planning, "mountArchiveRelevesTab");
  const mountPlanningIndividuelTab = aLaDemande(charger_planning, "mountPlanningIndividuelTab");
  const mountMonPlanningTab = aLaDemande(charger_planning, "mountMonPlanningTab");
  const charger_site_dossier = () => import("./site-dossier.js");
  const mountSitesDossiers = aLaDemande(charger_site_dossier, "mountSitesDossiers");
  const charger_compteurs = () => import("./compteurs.js");
  const mountCompteurs = aLaDemande(charger_compteurs, "mountCompteurs");
  const charger_masterlock = () => import("./masterlock.js");
  const mountMasterlock = aLaDemande(charger_masterlock, "mountMasterlock");
  const charger_stock = () => import("./stock.js");
  const mountStockProduits = aLaDemande(charger_stock, "mountStockProduits");
  const charger_stock_inventaire = () => import("./stock-inventaire.js");
  const mountStockInventaire = aLaDemande(charger_stock_inventaire, "mountStockInventaire");
  const charger_stock_commandes = () => import("./stock-commandes.js");
  const mountStockCommandes = aLaDemande(charger_stock_commandes, "mountStockCommandes");
  const charger_stock_sites = () => import("./stock-sites.js");
  const mountStockSites = aLaDemande(charger_stock_sites, "mountStockSites");
  const charger_stock_site_catalogue = () => import("./stock-site-catalogue.js");
  const mountStockCatalogueSite = aLaDemande(charger_stock_site_catalogue, "mountStockCatalogueSite");
  const charger_fournisseurs = () => import("./fournisseurs.js");
  const mountFournisseurs = aLaDemande(charger_fournisseurs, "mountFournisseurs");
  const charger_heures = () => import("./heures.js");
  const mountHeures = aLaDemande(charger_heures, "mountHeures");
  const charger_heures_repartition = () => import("./heures-repartition.js");
  const mountRepartitionForDispositif = aLaDemande(charger_heures_repartition, "mountRepartitionForDispositif");
  const charger_heures_archive = () => import("./heures-archive.js");
  const mountArchiveForDispositif = aLaDemande(charger_heures_archive, "mountArchiveForDispositif");
  const charger_tracabilite = () => import("./tracabilite.js");
  const mountTracabilite = aLaDemande(charger_tracabilite, "mountTracabilite");
  const mountTracabiliteForDispositif = aLaDemande(charger_tracabilite, "mountTracabiliteForDispositif");
  const charger_parametres = () => import("./parametres.js");
  const mountUtilisateurs = aLaDemande(charger_parametres, "mountUtilisateurs");
  const mountAccesRemplacants = aLaDemande(charger_parametres, "mountAccesRemplacants");
  const mountParametresDispositif = aLaDemande(charger_parametres, "mountParametresDispositif");
  const mountAssociationsSites = aLaDemande(charger_parametres, "mountAssociationsSites");
  const charger_migration_tool = () => import("./migration-tool.js");
  const mountMigrationTool = aLaDemande(charger_migration_tool, "mountMigrationTool");
  const charger_export_sharepoint_admin = () => import("./export-sharepoint-admin.js");
  const mountExportSharepointAdmin = aLaDemande(charger_export_sharepoint_admin, "mountExportSharepointAdmin");
  const charger_qr_print_masse = () => import("./qr-print-masse.js");
  const mountQrMasse = aLaDemande(charger_qr_print_masse, "mountQrMasse");
  const charger_taches = () => import("./taches.js");
  const mountTaches = aLaDemande(charger_taches, "mountTaches");
  const charger_suivi_demandes = () => import("./suivi-demandes.js");
  const mountSuiviDemandesTab = aLaDemande(charger_suivi_demandes, "mountSuiviDemandesTab");
  const charger_permissions_doc = () => import("./permissions-doc.js");
  const mountPermissionsDoc = aLaDemande(charger_permissions_doc, "mountPermissionsDoc");
  const charger_previsionnel = () => import("./previsionnel.js");
  const mountPrevisionnel = aLaDemande(charger_previsionnel, "mountPrevisionnel");
  const charger_stock_menage = () => import("./stock-menage.js");
  const mountStockMenage = aLaDemande(charger_stock_menage, "mountStockMenage");
  const charger_statistiques = () => import("./statistiques.js");
  const mountStatistiques = aLaDemande(charger_statistiques, "mountStatistiques");
  const charger_corbeille = () => import("./corbeille.js");
  const mountCorbeille = aLaDemande(charger_corbeille, "mountCorbeille");
  const charger_connexions = () => import("./connexions.js");
  const mountConnexions = aLaDemande(charger_connexions, "mountConnexions");
  // Préchargement en arrière-plan de TOUS les modules, juste après
  // l'affichage de l'accueil : l'ouverture reste légère, et chaque tuile
  // s'ouvre ensuite instantanément (code déjà là, gardé en cache).
  let modulesPrecharges = false;
  function prechargerModules() {
    if (modulesPrecharges) return; modulesPrecharges = true;
    const liste = [charger_planning, charger_site_dossier, charger_compteurs, charger_masterlock, charger_stock, charger_stock_inventaire, charger_stock_commandes, charger_stock_sites, charger_stock_site_catalogue, charger_fournisseurs, charger_heures, charger_heures_repartition, charger_heures_archive, charger_tracabilite, charger_parametres, charger_migration_tool, charger_export_sharepoint_admin, charger_qr_print_masse, charger_taches, charger_suivi_demandes, charger_permissions_doc, charger_previsionnel, charger_stock_menage, charger_statistiques, charger_corbeille, charger_connexions];
    const suivant = () => { const f = liste.shift(); if (!f) return; f().catch(() => {}).finally(() => setTimeout(suivant, 30)); };
    (window.requestIdleCallback || ((cb) => setTimeout(cb, 300)))(() => { suivant(); suivant(); suivant(); }, { timeout: 1500 });
  }
  // ---------------------------------------------------------------
  // Version de l'appli : numéro posé par le déploiement (GitHub Actions)
  // dans le lien du code (app.bundle.js?v=NUMÉRO) et dans version.json.
  // Super Admin : la version est affichée. Tout le monde : bandeau
  // « Nouvelle version disponible » dès qu'une mise à jour est en ligne.
  // ---------------------------------------------------------------
  const VERSION_CHARGEE = (() => { try { return new URL(document.querySelector('script[src*="app.bundle.js"]').src).searchParams.get("v") || "dev"; } catch { return "dev"; } })();
  let versionEnLigne = null;
  function versionTexte() {
    const d = versionEnLigne && String(versionEnLigne.version) === VERSION_CHARGEE && versionEnLigne.date ? new Date(versionEnLigne.date) : null;
    return `Version ${escapeHtml(VERSION_CHARGEE)}${d && !isNaN(d) ? ` · ${d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })} ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}` : ""}`;
  }
  function bandeauNouvelleVersion(v) {
    if (document.getElementById("maj-bandeau")) return;
    const b = document.createElement("div");
    b.id = "maj-bandeau"; b.className = "maj-bandeau";
    b.innerHTML = `<span>🚀 <b>Nouvelle version disponible</b>${currentUser?.role === "super_admin" ? ` <em>(version ${escapeHtml(String(v.version))})</em>` : ""}</span><button type="button" id="maj-recharger">Mettre à jour</button><button type="button" class="maj-fermer" aria-label="Plus tard">✕</button>`;
    document.body.appendChild(b);
    b.querySelector("#maj-recharger").addEventListener("click", () => location.reload());
    b.querySelector(".maj-fermer").addEventListener("click", () => b.remove());
  }
  async function verifierVersion() {
    try {
      const r = await fetch(`version.json?t=${Date.now()}`, { cache: "no-store" });
      if (!r.ok) return;
      versionEnLigne = await r.json();
      document.querySelectorAll(".app-version").forEach(el => { el.innerHTML = versionTexte(); });
      if (VERSION_CHARGEE !== "dev" && String(versionEnLigne.version) !== VERSION_CHARGEE) bandeauNouvelleVersion(versionEnLigne);
    } catch { /* hors ligne : on réessaiera */ }
  }
  setTimeout(verifierVersion, 3000);
  setInterval(verifierVersion, 5 * 60 * 1000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") verifierVersion(); });

  const runDailyExportIfNeeded = () => { setTimeout(() => import("./export-sharepoint.js").then(m => m.runDailyExportIfNeeded()).catch(e => console.warn("Export quotidien :", e)), 4000); };
  let currentSubtab = null;
  let dispositifsList = [];
  let accessMap = {};
  let dispositifSettings = {};
  let sitesSubscribed = false;
  let homeOrder = [];
  let homeOrderSubscribed = false;
  let stockAlertCount = { central: 0, deporte: 0, total: 0 };
  let stockAlertSubscribed = false;
  let compteursAlertCount = 0;
  // Badge « actions attribuées » : suit l'utilisateur affiché (y compris en
  // « Aperçu en tant que… », pour voir ce que voit la personne).
  let mesActionsCount = 0, mesActionsUid = null, mesActionsUnsub = null;
  // Demandes à valider (superviseurs) : notification avec raccourci.
  let aValiderCount = 0, aValiderAbonne = false;
  function suivreAValider(role) {
    if (aValiderAbonne || !["super_admin", "admin", "n1"].includes(role)) return;
    aValiderAbonne = true;
    import("./firestore-data.js").then(({ watchDemandesAValider }) => watchDemandesAValider((n) => { const avant = aValiderCount; aValiderCount = n; if (avant !== n && currentCategory === null) render(); }));
  }
  function suivreMesActions(uid) {
    if (!uid || uid === mesActionsUid) return;
    mesActionsUid = uid; mesActionsCount = 0;
    if (mesActionsUnsub) { mesActionsUnsub(); mesActionsUnsub = null; }
    import("./firestore-data.js").then(({ watchMesActionsDemandes }) => {
      if (mesActionsUid !== uid) return;
      mesActionsUnsub = watchMesActionsDemandes(uid, (n) => { if (mesActionsUid !== uid) return; const avant = mesActionsCount; mesActionsCount = n; if (avant !== n && currentCategory === null) render(); });
    });
  }
  // En-tête de l'accueil (superviseurs) : demandes restant à traiter + urgentes.
  let demOuvertes = null, demOuvertesAbonne = false;
  const STATUTS_FINIS = ["Réalisé", "Annulé", "Réalisé – à valider"];
  function compteDemandesHTML() {
    if (!demOuvertes) return "";
    return `<button type="button" class="gh-compte" data-gh-compte="a-traiter" title="Demandes restant à traiter"><b>${demOuvertes.n}</b><span>à traiter</span></button>
      <button type="button" class="gh-compte ${demOuvertes.u ? "urg" : ""}" data-gh-compte="urgentes" title="Urgentes et critiques"><b>${demOuvertes.u}</b><span>urgente${demOuvertes.u > 1 ? "s" : ""}</span></button>`;
  }
  function suivreDemandesOuvertes(role) {
    if (demOuvertesAbonne || !["super_admin", "admin", "n1"].includes(role)) return;
    demOuvertesAbonne = true;
    import("./firestore-data.js").then(({ watchDemandes }) => watchDemandes((liste) => {
      const ouvertes = liste.filter(d => !d.lieeA && !STATUTS_FINIS.includes(d.statut));
      demOuvertes = { n: ouvertes.length, u: ouvertes.filter(d => ["Urgent", "Critique"].includes(d.urgenceCorrigee || d.urgence)).length };
      const el = document.getElementById("gh-compte-dem");
      if (el) { el.innerHTML = compteDemandesHTML(); brancherCompteDemandes(); }
    }));
  }
  function brancherCompteDemandes() {
    document.querySelectorAll("[data-gh-compte]").forEach(b => b.onclick = () => {
      window.__suiviRaccourci = b.dataset.ghCompte;
      currentCategory = "suivi-demandes";
      const cat = allCategories(currentUser).find(c => c.id === "suivi-demandes");
      currentSubtab = categorySubtabsFor(cat, currentUser)[0]?.id || null;
      render();
    });
  }
  let compteursAlertSubscribed = false;
  let backButtonGuardSetup = false;
  let modulesConstruction = [];
  let modulesConstructionSubscribed = false;
  // Mode "Aperçu en tant que…" (Super Admin uniquement) : l'appli est
  // affichée avec le rôle et les droits de la personne choisie, pour
  // vérifier ce que voit chaque technicien. Les données lues restent
  // celles du compte Super Admin (règles Firestore), et une saisie faite
  // dans ce mode serait enregistrée au nom de la personne affichée —
  // d'où le bandeau d'avertissement.
  let apercuUid = null;
  let usersList = [];
  let usersSubscribed = false;
  function utilisateurEffectif() {
    if (!apercuUid || currentUser?.role !== "super_admin") return currentUser;
    const u = usersList.find(x => x.uid === apercuUid);
    return u ? { ...u, apercu: true } : currentUser;
  }
  // Module en construction : visible et utilisable par le Super Admin ;
  // visible (avec son ruban) mais fermé par un écran « chantier » pour la
  // Direction ; totalement masqué pour les autres rôles.
  const estMasqueConstruction = (id, user) => modulesConstruction.includes(id) && user.role !== "direction" && (user.role !== "super_admin" || user.apercu);
  const estFermeConstruction = (id, user) => modulesConstruction.includes(id) && user.role === "direction";

  // Bouton "retour" du navigateur (ou geste retour mobile) : par défaut
  // il quitte carrément l'appli puisque celle-ci ne pousse jamais
  // d'entrée dans l'historique. On piège ce retour pour qu'il ramène
  // toujours à l'écran d'accueil de l'appli, jamais en dehors.
  function armerRetourNavigateur() {
    history.pushState({ appGuard: true }, "", window.location.href);
  }
  window.addEventListener("popstate", () => {
    if (currentCategory !== null) { currentCategory = null; currentSubtab = null; render(); }
    armerRetourNavigateur(); // ré-arme immédiatement pour le prochain retour
  });

  const ALL = ["super_admin","admin","n1","technicien","menage","mi_temps","direction"];
  const MENAGE_ROLES = ["super_admin","admin","n1","direction","menage","mi_temps"];
  const GESTION = ["super_admin","admin","n1"]; // gestion quotidienne (contenu)
  const ADMIN_ONLY = ["super_admin","admin"]; // administration du systeme (comptes, corbeille...)
  const SUPER_ADMIN_ONLY = ["super_admin"];

  function dispositifCategories(user) {
    return dispositifsList
      .filter(d => user.role === "direction" || hasAccess(accessMap, d, user) || (user.extraOnglets || []).includes("disp-" + d))
      .map(d => ({
        id: "disp-" + d, label: d, icon: "🧽", desc: "Fiches, traçabilité",
        subtabs: [
          { id: "fiches",      label: "Fiches",      icon: "📋", roles: MENAGE_ROLES,       mount: (c, u) => mountFichesForDispositif(c, u, d) },
          ...(heuresEnabled(dispositifSettings, d) ? [
            { id: "heures", label: "Heures", icon: "🕒", roles: MENAGE_ROLES, mount: mountHeures },
            { id: "repartition", label: "Répartition", icon: "📊", roles: MENAGE_ROLES, mount: (c, u) => mountRepartitionForDispositif(c, u, d) },
            { id: "archive", label: "Archive", icon: "🗄️", roles: [...GESTION,"direction"], mount: (c, u) => mountArchiveForDispositif(c, u, d) },
          ] : []),
          { id: "tracabilite", label: "Traçabilité", icon: "🧾", roles: MENAGE_ROLES,       mount: (c, u) => mountTracabiliteForDispositif(c, u, d) },
          { id: "parametres",  label: "Paramètres",  icon: "⚙️", roles: GESTION,     mount: (c, u) => mountParametresDispositif(c, u, d) },
        ],
      }));
  }

  function staticCategories() {
    return [
      {
        id: "statistiques", label: "Statistiques", icon: "📊", desc: "Tableau de bord — vue d'ensemble de l'activité",
        subtabs: [
          { id: "vue", label: "Vue d'ensemble", icon: "📊", roles: [...GESTION,"direction"], mount: mountStatistiques },
        ],
      },
      {
        id: "astreinte", label: "Astreinte", icon: "📅", desc: "Planning, absences, interventions",
        subtabs: [
          { id: "calendrier",     label: "Calendrier",     icon: "📅", roles: ALL,                         mount: mountCalendrier },
          { id: "absences",       label: "Absences",       icon: "👥", roles: GESTION,              mount: mountAbsencesTab },
          { id: "interventions",  label: "Interventions",  icon: "🔧", roles: [...GESTION,"technicien"], mount: mountInterventionsTab },
          { id: "synthese",       label: "Synthèse",       icon: "📊", roles: [...GESTION,"direction"],  mount: mountSyntheseTab },
          { id: "transferts",     label: "Historique transferts", icon: "🔄", roles: [...GESTION,"direction"], mount: mountTransfertsTab },
          { id: "coordonnees",    label: "Coordonnées",    icon: "📞", roles: ALL, mount: mountCoordonneesTab },
          { id: "archive-releves", label: "Archive relevés", icon: "🗄️", roles: [...GESTION,"direction"], mount: mountArchiveRelevesTab },
        ],
      },
      {
        id: "administration", label: "Administration", icon: "🛠️", desc: "Comptes, accès remplaçants",
        subtabs: [
          { id: "utilisateurs", label: "Utilisateurs",       icon: "👤", roles: ADMIN_ONLY, mount: mountUtilisateurs },
          { id: "connexions",   label: "Connexions",         icon: "🟢", roles: SUPER_ADMIN_ONLY, mount: mountConnexions },
          { id: "remplacants",  label: "Accès remplaçants",  icon: "🔗", roles: ADMIN_ONLY, mount: mountAccesRemplacants },
          { id: "associations", label: "Associations & Sites", icon: "🏫", roles: ADMIN_ONLY, mount: mountAssociationsSites },
          { id: "corbeille", label: "Corbeille", icon: "🗑️", roles: ADMIN_ONLY, mount: mountCorbeille },
          { id: "migration", label: "Migration photos", icon: "🔄", roles: ADMIN_ONLY, mount: mountMigrationTool },
          { id: "export-sharepoint", label: "Export SharePoint", icon: "📤", roles: ADMIN_ONLY, mount: mountExportSharepointAdmin },
          { id: "qr-masse", label: "Impression QR en masse", icon: "🖨️", roles: ADMIN_ONLY, mount: mountQrMasse },
          { id: "permissions", label: "Permissions par rôle", icon: "🔍", roles: ADMIN_ONLY, mount: mountPermissionsDoc },
        ],
      },
      {
        id: "sites", label: "Dossiers de site", icon: "🏠", desc: "Sécurité, contacts, organes techniques",
        subtabs: [
          { id: "liste", label: "Dossiers", icon: "🏢", roles: ALL, mount: mountSitesDossiers },
        ],
      },
      {
        id: "compteurs", label: "Relevé compteur", icon: "🎛️", desc: "Eau, gaz, électricité — avec photo et QR",
        badge: compteursAlertCount > 0 ? compteursAlertCount : null,
        subtabs: [
          { id: "liste", label: "Sites", icon: "🏢", roles: [...GESTION,"technicien"], mount: mountCompteurs },
        ],
      },
      {
        id: "masterlock", label: "Codes Masterlock", icon: "🔐", desc: "Boîtes à clés par site, avec récap équipe",
        subtabs: [
          { id: "liste", label: "Sites", icon: "🏢", roles: [...GESTION,"technicien"], mount: mountMasterlock },
        ],
      },
      {
        id: "previsionnel", label: "Prévisionnel Travaux", icon: "📋", desc: "Budget travaux/investissement, pour le conseil d'administration",
        subtabs: [
          { id: "liste", label: "Besoins", icon: "📋", roles: [...GESTION,"technicien"], mount: mountPrevisionnel },
        ],
      },
      {
        id: "taches", label: "Suivi des tâches", icon: "✅", desc: "À faire, en cours, avancement — usage interne Super Admin",
        subtabs: [
          { id: "liste", label: "Tâches", icon: "✅", roles: SUPER_ADMIN_ONLY, mount: mountTaches },
        ],
      },
      {
        id: "planning-individuel", label: "Planning individuel", icon: "🗓️", desc: "Congés, RTT, arrêts et interventions par personne, sur toute l'année",
        subtabs: [
          // Direction : consultation seule (planning.js ne permet la programmation qu'aux éditeurs)
          { id: "liste", label: "Planning", icon: "🗓️", roles: [...GESTION, "direction"], mount: mountPlanningIndividuelTab },
        ],
      },
      {
        id: "mon-planning", label: "Mon planning", icon: "🗓️", desc: "Mes interventions, congés, RTT et arrêts sur l'année",
        subtabs: [
          { id: "liste", label: "Mon planning", icon: "🗓️", roles: ["technicien", "menage", "mi_temps"], mount: mountMonPlanningTab },
        ],
      },
      {
        id: "suivi-demandes", label: "Suivi des demandes", icon: "📄", badge: (mesActionsCount + (["super_admin", "admin", "n1"].includes(utilisateurEffectif()?.role) ? aValiderCount : 0)) || null, badgeActions: mesActionsCount, badgeValider: ["super_admin", "admin", "n1"].includes(utilisateurEffectif()?.role) ? aValiderCount : 0, desc: "Demandes d'intervention importées du fichier Excel : tableau à traiter par les techniciens, + statistiques (mois, statut, association, site, urgence)",
        subtabs: [
          { id: "liste", label: "Demandes", icon: "📄", roles: [...GESTION,"direction","technicien","menage","mi_temps"], mount: mountSuiviDemandesTab },
        ],
      },
      {
        id: "stock-menage", label: "Stock Ménage", icon: "🧻", desc: "PQ, savon, entretien — sorties attribuées à un centre ou au dispositif MNA",
        subtabs: [
          { id: "liste", label: "Stock", icon: "🧻", roles: [...GESTION,"menage","technicien"], mount: mountStockMenage },
        ],
      },
      {
        id: "stock", label: "Stock maintenance", icon: "📦", desc: "Produits, inventaire QR, commandes",
        badgeAtelier: stockAlertCount.central > 0 ? stockAlertCount.central : null,
        badgeSites: stockAlertCount.deporte > 0 ? stockAlertCount.deporte : null,
        subtabs: [
          { id: "produits",   label: "Produits",   icon: "📦", roles: GESTION,              mount: mountStockProduits },
          { id: "inventaire", label: "Inventaire", icon: "📷", roles: [...GESTION,"technicien"], mount: mountStockInventaire },
          { id: "commandes",  label: "Commandes",  icon: "📧", roles: [...GESTION,"direction"],  mount: mountStockCommandes },
          { id: "sites",      label: "Sites",       icon: "🏢", roles: [...GESTION,"technicien"], mount: mountStockSites },
          { id: "catalogue-sites", label: "Catalogue sites", icon: "🗂️", roles: GESTION, mount: mountStockCatalogueSite },
          { id: "fournisseurs", label: "Fournisseurs", icon: "🏭", roles: GESTION, mount: mountFournisseurs },
        ],
      },
    ];
  }

  function allCategories(user) {
    const [statistiques, astreinte, administration, sites, compteurs, masterlock, previsionnel, taches, planningIndividuel, monPlanning, suiviDemandes, stockMenage, stock] = staticCategories();
    return [statistiques, astreinte, ...dispositifCategories(user), administration, sites, compteurs, masterlock, previsionnel, taches, planningIndividuel, monPlanning, suiviDemandes, stockMenage, stock];
  }

  watchAuth((user) => {
    if (!user) { window.location.href = "index.html"; return; }
    currentUser = user;
    // Lien direct depuis un QR produit (scanné avec l'appareil photo du
    // téléphone, hors appli) : .../app.html?stock=ID_PRODUIT
    const stockParam = new URLSearchParams(window.location.search).get("stock");
    if (stockParam && currentCategory === null) {
      currentCategory = "stock";
      currentSubtab = "inventaire";
      window.stockDeepLinkProduitId = stockParam;
      history.replaceState(null, "", window.location.pathname);
    }
    // Idem pour un produit du Stock Ménage : .../app.html?stockmenage=ID_PRODUIT
    const stockMenageParam = new URLSearchParams(window.location.search).get("stockmenage");
    if (stockMenageParam && currentCategory === null) {
      currentCategory = "stock-menage";
      currentSubtab = "liste";
      window.stockMenageDeepLinkProduitId = stockMenageParam;
      history.replaceState(null, "", window.location.pathname);
    }
    // QR général par zone menant directement au mode rapide d'actualisation
    // de tous les produits de cette zone : .../app.html?stockmenagerapide=ecole (ou agropolis)
    const stockMenageRapideParam = new URLSearchParams(window.location.search).get("stockmenagerapide");
    if (stockMenageRapideParam && currentCategory === null) {
      currentCategory = "stock-menage";
      currentSubtab = "liste";
      window.stockMenageRapideDeepLinkZone = stockMenageRapideParam;
      history.replaceState(null, "", window.location.pathname);
    }
    // Idem pour un article de stock déporté par site : .../app.html?stocksite=ID
    const stockSiteParam = new URLSearchParams(window.location.search).get("stocksite");
    if (stockSiteParam && currentCategory === null) {
      currentCategory = "stock";
      currentSubtab = "sites";
      window.stockSiteDeepLinkId = stockSiteParam;
      history.replaceState(null, "", window.location.pathname);
    }
    // QR unique par résidence menant directement au mode rapide de
    // l'inventaire de ce site : .../app.html?stocksiterapide=ID_DOSSIER
    const stockSiteRapideParam = new URLSearchParams(window.location.search).get("stocksiterapide");
    if (stockSiteRapideParam && currentCategory === null) {
      currentCategory = "stock";
      currentSubtab = "sites";
      window.stockSiteRapideDeepLinkId = stockSiteRapideParam;
      history.replaceState(null, "", window.location.pathname);
    }
    // QR unique menant directement au mode rapide de l'inventaire :
    // .../app.html?stockrapide=1
    const stockRapideParam = new URLSearchParams(window.location.search).get("stockrapide");
    if (stockRapideParam && currentCategory === null) {
      currentCategory = "stock";
      currentSubtab = "inventaire";
      window.stockRapideDeepLink = true;
      history.replaceState(null, "", window.location.pathname);
    }
    // QR unique par compteur menant directement à son formulaire de
    // relevé : .../app.html?compteurrelever=ID_COMPTEUR
    const compteurRelevParam = new URLSearchParams(window.location.search).get("compteurrelever");
    if (compteurRelevParam && currentCategory === null) {
      currentCategory = "compteurs";
      currentSubtab = "liste";
      window.compteurRelevDeepLinkId = compteurRelevParam;
      history.replaceState(null, "", window.location.pathname);
    }
    if (!sitesSubscribed) {
      sitesSubscribed = true;
      armerRetourNavigateur();
      watchSites((sitesList) => {
        dispositifsList = [...new Set(sitesList.map(s => s.dispositif || "Dispositif MNA"))];
        render();
      });
      watchAccess((a) => { accessMap = a; render(); });
      watchDispositifSettings((s) => { dispositifSettings = s; render(); });
      // Export vers SharePoint à chaque connexion, en arrière-plan, sans
      // bloquer ni ralentir l'affichage. Ne fait rien si aucune session
      // Microsoft n'est déjà active.
      runDailyExportIfNeeded();
    }
    if (!ordreOngletsAbonne) {
      ordreOngletsAbonne = true;
      watchOrdreOnglets((o) => { const avant = JSON.stringify(ordreOnglets); ordreOnglets = o || {}; if (avant !== JSON.stringify(ordreOnglets) && currentCategory && !reorgOnglets) render(); });
    }
    if (!homeOrderSubscribed) {
      homeOrderSubscribed = true;
      // homeOrder ne sert qu'à classer les tuiles de l'écran d'accueil :
      // on ne redessine que si on est sur cet écran, pour ne jamais
      // interrompre une saisie en cours dans un module ouvert.
      watchHomeOrder((o) => { homeOrder = o; if (currentCategory === null) render(); });
    }
    // Badges d'alerte stock : abonnement dans render() (voir « QUOTA »).
    if (!modulesConstructionSubscribed) {
      modulesConstructionSubscribed = true;
      watchModulesConstruction((ids) => { modulesConstruction = ids; if (currentCategory === null || estMasqueConstruction(currentCategory, utilisateurEffectif())) render(); });
    }
    if (!window.__synchroDemandesAuto && ["super_admin", "admin", "n1"].includes(user.role)) {
      window.__synchroDemandesAuto = true;
      import("./demandes-auto.js").then(m => m.demarrerSynchroAutoDemandes()).catch(e => console.warn("Synchro auto demandes :", e));
    }
    if (!usersSubscribed && user.role === "super_admin") {
      usersSubscribed = true;
      let migFaite = false;
      watchUsers((l) => { usersList = l; if (!migFaite && l.length) { migFaite = true; migrationAccesTechSuivi(l); } if (apercuUid) render(); else majSelectApercu(); });
    }
    if (!compteursAlertSubscribed) {
      compteursAlertSubscribed = true;
      watchCompteursAlertCount((n) => { compteursAlertCount = n; if (currentCategory === null) render(); });
    }
    render();
  });

  // Tuiles gérées au cas par cas, par utilisateur, pour les rôles de
  // terrain (technicien/menage/mi_temps) — via user.permissions, réglé
  // dans Paramètres → Utilisateurs → "Gérer l'accès". Un utilisateur de
  // l'un de ces rôles ne voit une de ces tuiles QUE si elle vaut "read" ou
  // "write" dans son profil ; absente ou "none" ⇒ tuile masquée, même si
  // le rôle y donnerait normalement accès plus bas. Volontairement sans
  // "Administration" ni "Suivi des tâches" (Super Admin), jamais
  // accessibles à ces rôles de toute façon. Les autres rôles (admin, n1,
  // super_admin) et les tuiles dispositif ménage ("disp-...",
  // via extraOnglets) ne sont pas concernés par ce mécanisme.
  // Migration unique (Super Admin) : donne aux techniciens l'accès
  // "Modification" sur Suivi des demandes, nécessaire pour l'envoi en
  // validation. Exécutée une seule fois (drapeau config/migrations), les
  // réglages faits ensuite à la main dans "Gérer l'accès" sont respectés.
  async function migrationAccesTechSuivi(liste) {
    try {
      const ref = docMig(dbMig, "config", "migrations");
      const snap = await getDocMig(ref);
      if (snap.exists() && snap.data().techSuiviDemandesWrite) return;
      let n = 0;
      for (const u of liste) {
        if (u.role !== "technicien" || (u.permissions || {})["suivi-demandes"] === "write") continue;
        await updateUser(u.uid, { ["permissions.suivi-demandes"]: "write" });
        n++;
      }
      await setDocMig(ref, { techSuiviDemandesWrite: new Date().toISOString(), techSuiviDemandesNb: n }, { merge: true });
      if (n) console.info(`Accès Suivi des demandes (modification) donné à ${n} technicien(s).`);
    } catch (e) { console.error("migrationAccesTechSuivi:", e); }
  }
  const TUILES_GEREES_PAR_UTILISATEUR = ["statistiques", "astreinte", "sites", "compteurs", "masterlock", "previsionnel", "planning-individuel", "suivi-demandes", "stock-menage", "stock"];
  const ROLES_ACCES_CAS_PAR_CAS = ["technicien", "menage", "mi_temps"];
  // Direction : voit tout comme le Super Admin, en consultation seule —
  // sauf l'Administration (comptes, corbeille…) et le Suivi des tâches.
  const TUILES_INTERDITES_DIRECTION = ["administration", "taches"];
  // Ordre des onglets choisi par le Super Admin (glisser-déposer), appliqué à tous.
  let ordreOnglets = {};
  let ordreOngletsAbonne = false;
  let reorgOnglets = false;
  function categorySubtabsFor(category, user) {
    const liste = categorySubtabsBrut(category, user);
    const ordre = ordreOnglets[category?.id];
    if (!Array.isArray(ordre) || !ordre.length) return liste;
    const rang = (id) => { const i = ordre.indexOf(id); return i < 0 ? 1000 : i; };
    return liste.map((s, i) => ({ s, i })).sort((a, b) => (rang(a.s.id) - rang(b.s.id)) || (a.i - b.i)).map(x => x.s);
  }
  function categorySubtabsBrut(category, user) {
    if (user.role === "direction") {
      if (TUILES_INTERDITES_DIRECTION.includes(category.id)) return [];
      return category.subtabs;
    }
    if (ROLES_ACCES_CAS_PAR_CAS.includes(user.role) && TUILES_GEREES_PAR_UTILISATEUR.includes(category.id)) {
      const niveau = (user.permissions || {})[category.id] || "none";
      if (niveau === "none") return [];
      return category.subtabs.filter(s => s.roles.includes(user.role));
    }
    // Dispositifs ménage ("disp-...") : mécanisme extraOnglets existant,
    // inchangé — un utilisateur avec un accès bonus explicite voit tous
    // les sous-onglets de ce dispositif même si son rôle habituel ne les
    // couvre pas.
    if ((user.extraOnglets || []).includes(category.id)) return category.subtabs;
    return category.subtabs.filter(s => s.roles.includes(user.role));
  }
  function visibleCategoriesFor(user) {
    const visibles = allCategories(user)
      .filter(c => c.id !== "administration") // accessible par la roue crantée en haut, plus en tuile
      .filter(c => !estMasqueConstruction(c.id, user))
      .filter(c => categorySubtabsFor(c, user).length > 0)
      .map(c => modulesConstruction.includes(c.id) ? { ...c, enConstruction: true } : c);
    if (homeOrder.length === 0) return visibles;
    // Catégories déjà classées, dans l'ordre sauvegardé, puis toute
    // catégorie nouvelle (pas encore dans l'ordre — ex. nouveau
    // dispositif) à la suite, dans son ordre naturel.
    const parId = new Map(visibles.map(c => [c.id, c]));
    const classees = homeOrder.map(id => parId.get(id)).filter(Boolean);
    const idsClasses = new Set(classees.map(c => c.id));
    const nouvelles = visibles.filter(c => !idsClasses.has(c.id));
    return [...classees, ...nouvelles];
  }

  function render() {
    const app = document.getElementById("app");
    try { suivreMesActions(currentUser?.role ? utilisateurEffectif()?.uid : null); suivreAValider(currentUser?.role); suivreDemandesOuvertes(currentUser?.role); } catch (e) { console.error(e); }

    if (currentUser.role === null) {
      app.innerHTML = `
        <div class="login-screen">
          <div class="login-card">
            <div class="login-eyebrow">Compte non configuré</div>
            <h1>Presque prêt</h1>
            <p class="hint">Ton compte existe mais n'a pas encore de rôle attribué dans la base. Demande à l'administrateur de créer ton profil dans la collection <code>users</code> (voir README).</p>
            <button class="logout-btn" id="logout-btn" style="margin-top:16px">Se déconnecter</button>
          </div>
        </div>`;
      document.getElementById("logout-btn").addEventListener("click", () => logout());
    document.getElementById("theme-modules-btn")?.addEventListener("click", (e) => {
      const t = basculerThemeModules(); // appliqué tout de suite, sans redessiner (aucune saisie perdue)
      e.currentTarget.textContent = t === "sombre" ? "☀️ Clair" : "🌙 Sombre";
    });
      return;
    }

    const eff = utilisateurEffectif();
    const cats = allCategories(eff);
    if (currentCategory && (estMasqueConstruction(currentCategory, eff) || !cats.some(c => c.id === currentCategory && categorySubtabsFor(c, eff).length > 0))) {
      currentCategory = null; currentSubtab = null;
    }
    const category = cats.find(c => c.id === currentCategory) || null;
    const adminCat = cats.find(c => c.id === "administration");
    const voitAdministration = adminCat && categorySubtabsFor(adminCat, eff).length > 0;

    // Accueil : en-tête au format de la GMAO Camileia (date/heure en haut à
    // gauche, menu utilisateur en haut à droite, fond marine) pour une
    // continuité visuelle entre les deux outils.
    document.body.classList.toggle("accueil-gmao", !category);
    // Accueil toujours sombre (comme Camileia) ; modules en clair ou en
    // sombre selon le choix de l'utilisateur (bouton ☀️/🌙 en haut).
    document.documentElement.dataset.theme = category ? getThemeModules() : "sombre";
    const maintenant = new Date();
    const enteteAccueil = `
      <header class="topbar-gmao">
        <div class="gh-date">
          <svg class="gh-ico-horloge" viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="21" fill="none" stroke="#fff" stroke-width="2.5"/><line id="gh-aiguille-h" x1="24" y1="24" x2="24" y2="14" stroke="#fff" stroke-width="3" stroke-linecap="round" transform="rotate(${(maintenant.getHours()%12)*30+maintenant.getMinutes()/2} 24 24)"/><line id="gh-aiguille-m" x1="24" y1="24" x2="24" y2="8" stroke="#fff" stroke-width="2.2" stroke-linecap="round" transform="rotate(${maintenant.getMinutes()*6} 24 24)"/><circle cx="24" cy="24" r="1.8" fill="#fff"/></svg>
          <span class="gh-horloge" id="gh-heure">${maintenant.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</span>
          <svg class="gh-ico-cal" viewBox="0 0 48 44" aria-hidden="true"><rect x="2" y="6" width="44" height="36" rx="4" fill="none" stroke="#fff" stroke-width="3"/><path d="M2 16h44" stroke="#fff" stroke-width="3"/><path d="M12 2v8M36 2v8" stroke="#fff" stroke-width="3" stroke-linecap="round"/></svg>
          <span class="gh-jour"><span>${maintenant.toLocaleDateString("fr-FR", { weekday: "short" })}</span> <b>${maintenant.getDate()}</b><br>${maintenant.toLocaleDateString("fr-FR", { month: "long" })}</span>
          ${["super_admin", "admin", "n1"].includes(utilisateurEffectif()?.role) ? `<span class="gh-compte-dem" id="gh-compte-dem">${compteDemandesHTML()}</span>` : ""}
        </div>
        <div class="gh-user">
          <button class="gh-user-btn" id="gh-user-btn" aria-haspopup="true"><svg class="gh-user-ico" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="14" fill="none" stroke="#fff" stroke-width="2"/><circle cx="16" cy="12.5" r="5" fill="none" stroke="#fff" stroke-width="2"/><path d="M7 26c2-5 5.5-7 9-7s7 2 9 7" fill="none" stroke="#fff" stroke-width="2"/></svg> <b>${escapeHtml(currentUser.nom || currentUser.email)}</b> <svg class="gh-user-chev" viewBox="0 0 16 10" aria-hidden="true"><path d="M1 1l7 7 7-7" fill="none" stroke="#fff" stroke-width="1.8"/></svg></button>
          <div class="gh-user-pop" id="gh-user-pop" hidden>
            <p class="gh-user-role">${escapeHtml(roleLabel(currentUser.role))}</p>
            ${currentUser.role === "super_admin" ? `<select id="apercu-select" class="apercu-select" title="Voir l'appli comme un autre utilisateur"><option value="">👁️ Aperçu en tant que…</option>${optionsApercu()}</select>` : ""}
            ${voitAdministration ? `<button class="nav-btn" id="admin-btn">⚙️ Administration</button>` : ""}
            <button class="logout-btn" id="logout-btn">Se déconnecter</button>
          </div>
        </div>
      </header>`;

    app.innerHTML = !category ? `
      ${enteteAccueil}
      ${eff.apercu ? `
      <div class="apercu-bandeau">👁️ Aperçu en tant que <b>${escapeHtml(eff.nom || eff.email)}</b> (${escapeHtml(roleLabel(eff.role))}) — tu vois exactement ses tuiles et onglets. Tu peux modifier ses favoris et son planning (enregistrés sous ton compte). <button class="nav-btn" id="apercu-quitter">Quitter l'aperçu</button></div>` : ""}
      <main class="content" id="content"></main>
      <footer class="gh-pied"><span class="gh-pied-texte">Service Maintenance et Ménage · Groupe Établières${currentUser.role === "super_admin" ? ` · <span class="app-version pied-version">${versionTexte()}</span>` : ""}</span></footer>
    ` : `
      <header class="topbar">
        <div class="topbar-title">
          ${category ? `<button class="back-btn" id="back-home">← Accueil</button>` : ""}
          <div class="topbar-title-row">
            <img src="img/logo-etablieres.png" alt="Groupe Établières" class="topbar-logo">
            <div class="topbar-title-text">
              <span class="topbar-eyebrow">Groupe Établières · Service Maintenance et Ménage</span>
              ${category
                ? `<h1>${escapeHtml(category.label)}${modulesConstruction.includes(category.id) ? " 🚧" : ""}${categorySubtabsFor(category, eff).find(s => s.id === currentSubtab) ? ` <span class="accent">› ${escapeHtml(categorySubtabsFor(category, eff).find(s => s.id === currentSubtab).label)}</span>` : ""}</h1>`
                : `<h1>Établières</h1>`}
            </div>
          </div>
        </div>
        <div class="topbar-user">
          <span><b>${escapeHtml(currentUser.nom || currentUser.email)}</b> · ${escapeHtml(roleLabel(currentUser.role))}${currentUser.role === "super_admin" ? ` <em class="app-version top-version">${versionTexte()}</em>` : ""}</span>
          ${currentUser.role === "super_admin" ? `<select id="apercu-select" class="apercu-select" title="Voir l'appli comme un autre utilisateur"><option value="">👁️ Aperçu en tant que…</option>${optionsApercu()}</select>` : ""}
          <button class="nav-btn theme-modules-btn" id="theme-modules-btn" title="Affichage clair ou sombre">${getThemeModules() === "sombre" ? "☀️ Clair" : "🌙 Sombre"}</button>
          ${voitAdministration ? `<button class="nav-btn gear-btn ${currentCategory === "administration" ? "active" : ""}" id="admin-btn" title="Administration">⚙️</button>` : ""}
          <button class="logout-btn" id="logout-btn">Se déconnecter</button>
        </div>
      </header>
      ${eff.apercu ? `
      <div class="apercu-bandeau">👁️ Aperçu en tant que <b>${escapeHtml(eff.nom || eff.email)}</b> (${escapeHtml(roleLabel(eff.role))}) — tu vois exactement ses tuiles et onglets. Tu peux modifier ses favoris et son planning (enregistrés sous ton compte). <button class="nav-btn" id="apercu-quitter">Quitter l'aperçu</button></div>` : ""}
      ${category && modulesConstruction.includes(category.id) && !eff.apercu && eff.role === "super_admin" ? `<div class="construction-bandeau">🚧 Module en construction — visible uniquement par le Super Admin (masqué pour tous les autres, y compris dans Statistiques).</div>` : ""}
      ${category ? `
      <nav class="tabs ${reorgOnglets ? "tabs-reorg" : ""}" id="tabs-nav" style="--nb-onglets:${Math.min(3, categorySubtabsFor(category, eff).length)}" data-nb="${categorySubtabsFor(category, eff).length}">
        ${categorySubtabsFor(category, eff).map(s => `<button class="tab-btn ${s.id===currentSubtab?'active':''}" data-subtab="${s.id}"><span class="tab-ico">${s.icon}</span><span class="tab-lib">${s.label}</span></button>`).join("")}
      ${eff.role === "super_admin" && !eff.apercu && categorySubtabsFor(category, eff).length > 1 ? `<button type="button" class="tab-reorg-btn ${reorgOnglets ? "on" : ""}" id="tab-reorg-btn" title="Réorganiser les onglets">${reorgOnglets ? "✓ Terminé" : "↕️"}</button>` : ""}
      </nav>` : ""}
      <main class="content" id="content"></main>
    `;

    document.getElementById("logout-btn").addEventListener("click", () => logout());
    document.getElementById("theme-modules-btn")?.addEventListener("click", (e) => {
      const t = basculerThemeModules(); // appliqué tout de suite, sans redessiner (aucune saisie perdue)
      e.currentTarget.textContent = t === "sombre" ? "☀️ Clair" : "🌙 Sombre";
    });
    document.getElementById("theme-btn")?.addEventListener("click", (e) => {
      cycleTheme();
      e.currentTarget.textContent = THEME_LABELS[getStoredTheme()]; // mise à jour du libellé seule, sans re-render de l'écran en cours (évite de perdre une saisie non enregistrée)
    });
    brancherCompteDemandes();
    const userBtn = document.getElementById("gh-user-btn"), userPop = document.getElementById("gh-user-pop");
    userBtn?.addEventListener("click", (e) => { e.stopPropagation(); userPop.hidden = !userPop.hidden; });
    userPop?.addEventListener("click", (e) => e.stopPropagation());
    document.addEventListener("click", () => { if (userPop) userPop.hidden = true; }, { once: true });
    document.getElementById("admin-btn")?.addEventListener("click", () => {
      if (currentCategory === "administration") { currentCategory = null; currentSubtab = null; }
      else { currentCategory = "administration"; currentSubtab = null; }
      render();
    });
    document.getElementById("apercu-select")?.addEventListener("change", (e) => {
      apercuUid = e.target.value || null; currentCategory = null; currentSubtab = null; render();
    });
    document.getElementById("apercu-quitter")?.addEventListener("click", () => {
      apercuUid = null; currentCategory = null; currentSubtab = null; render();
    });
    const backBtn = document.getElementById("back-home");
    if (backBtn) backBtn.addEventListener("click", () => { currentCategory = null; currentSubtab = null; render(); });

    document.querySelectorAll("[data-subtab]").forEach(btn => {
      btn.addEventListener("click", () => { if (reorgOnglets) return; currentSubtab = btn.dataset.subtab; render(); });
    });
    document.getElementById("tab-reorg-btn")?.addEventListener("click", () => { reorgOnglets = !reorgOnglets; render(); if (reorgOnglets) window.toast?.("↔️ Fais glisser les onglets pour les ranger, puis « Terminé »"); });
    const navOnglets = document.getElementById("tabs-nav");
    if (reorgOnglets && navOnglets && category) activerGlisserOnglets(navOnglets, (ids) => {
      ordreOnglets = { ...ordreOnglets, [category.id]: ids };
      saveOrdreOnglets(category.id, ids).then(() => window.toast?.("✓ Ordre des onglets enregistré pour tout le monde"))
        .catch(err => { console.error("saveOrdreOnglets:", err); alert("Échec de l'enregistrement de l'ordre : " + (err?.message || err)); });
    });

    renderContent(category);
  }

  // Glisser-déposer des onglets (souris et tactile), en ligne ou en grille.
  function activerGlisserOnglets(nav, onFin) {
    nav.querySelectorAll(".tab-btn").forEach(btn => {
      btn.style.touchAction = "none";
      btn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        btn.classList.add("tab-glisse");
        const avant = [...nav.querySelectorAll(".tab-btn")].map(b => b.dataset.subtab).join();
        const bouger = (ev) => {
          const cible = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.(".tab-btn");
          if (!cible || cible === btn || cible.parentNode !== nav) return;
          const r = cible.getBoundingClientRect();
          const apres = ev.clientX > r.left + r.width / 2;
          nav.insertBefore(btn, apres ? cible.nextSibling : cible);
        };
        const lacher = () => {
          document.removeEventListener("pointermove", bouger);
          document.removeEventListener("pointerup", lacher);
          document.removeEventListener("pointercancel", lacher);
          btn.classList.remove("tab-glisse");
          const ids = [...nav.querySelectorAll(".tab-btn")].map(b => b.dataset.subtab);
          if (ids.join() !== avant) onFin(ids);
        };
        document.addEventListener("pointermove", bouger);
        document.addEventListener("pointerup", lacher);
        document.addEventListener("pointercancel", lacher);
      });
    });
  }

  function optionsApercu() {
    return usersList.filter(u => u.uid !== currentUser.uid && u.role)
      .map(u => `<option value="${escapeHtml(u.uid)}" ${u.uid === apercuUid ? "selected" : ""}>${escapeHtml(u.nom || u.email || u.uid)} — ${escapeHtml(roleLabel(u.role))}</option>`).join("");
  }
  // La liste des utilisateurs arrive après le premier affichage : on
  // complète le sélecteur sans redessiner l'écran en cours.
  function majSelectApercu() {
    const sel = document.getElementById("apercu-select");
    if (sel) sel.innerHTML = `<option value="">👁️ Aperçu en tant que…</option>${optionsApercu()}`;
  }

  function renderContent(category) {
    const content = document.getElementById("content");
    const currentUser = utilisateurEffectif(); // masque volontairement la variable globale : tout le rendu se fait avec l'utilisateur affiché

    if (!category) {
      const cats = visibleCategoriesFor(currentUser);
      // QUOTA : les badges d'alerte stock relisent tout le stock (central +
      // sites) à chaque ouverture : seulement pour ceux qui voient la tuile.
      if (!stockAlertSubscribed && cats.some(c => c.id === "stock")) {
        stockAlertSubscribed = true;
        watchStockAlertCount((counts) => { stockAlertCount = counts; if (currentCategory === null) render(); });
      }
      setTimeout(prechargerModules, 600);
      mountDashboard(content, currentUser, cats, (catId, dossierIdAOuvrir) => {
        currentCategory = catId;
        const cat = allCategories(currentUser).find(c => c.id === catId);
        const subs = categorySubtabsFor(cat, currentUser);
        const voulu = window.ouvrirSousOnglet; window.ouvrirSousOnglet = null;
        currentSubtab = (voulu && subs.some(s => s.id === voulu) ? voulu : subs[0]?.id) || null;
        if (dossierIdAOuvrir) window.siteDossierDeepLinkId = dossierIdAOuvrir;
        render();
      }, (catId, sens) => {
        // Glisser-déposer : reçoit directement le nouvel ordre complet.
        if (Array.isArray(catId)) { saveHomeOrder(catId).catch(err => { console.error("saveHomeOrder:", err); alert("Ordre des tuiles non enregistré : " + (err?.message || err)); }); return; }
        // Échange la position de cette catégorie avec sa voisine dans
        // l'ordre courant, puis sauvegarde le nouvel ordre complet.
        const ids = cats.map(c => c.id);
        const idx = ids.indexOf(catId);
        const cible = idx + sens;
        if (cible < 0 || cible >= ids.length) return;
        [ids[idx], ids[cible]] = [ids[cible], ids[idx]];
        saveHomeOrder(ids);
      }, currentUser.role === "super_admin" && !currentUser.apercu ? (catId) => basculerModuleConstruction(catId).catch(err => {
        console.error("basculerModuleConstruction:", err);
        alert("Échec de l'enregistrement du statut « en construction » : " + (err?.message || err));
      }) : null);
      return;
    }

    const subs = categorySubtabsFor(category, currentUser);
    if (!subs.some(s => s.id === currentSubtab)) currentSubtab = subs[0]?.id || null;
    const activeSub = subs.find(s => s.id === currentSubtab);

    if (activeSub && activeSub.mount) {
      // Niveau d'accès "cas par cas" (Paramètres > Utilisateurs > Gérer
      // l'accès) pour cette tuile : "none" est déjà filtré par
      // categorySubtabsFor (la tuile n'apparaîtrait pas), donc ici seul
      // "read" (voir sans modifier) nous intéresse — transmis au module
      // via user.lectureSeule plutôt que de changer la signature mount().
      const niveauTuile = (ROLES_ACCES_CAS_PAR_CAS.includes(currentUser.role) && TUILES_GEREES_PAR_UTILISATEUR.includes(category.id))
        ? ((currentUser.permissions || {})[category.id] || "none")
        : null;
      const userPourModule = (niveauTuile === "read" || currentUser.role === "direction") ? { ...currentUser, lectureSeule: true } : currentUser;
      if (estFermeConstruction(category.id, currentUser)) { content.innerHTML = ecranChantier(category); return; }
      // Même présentation pour toutes les tuiles : bandeau marine commun
      // (les modules qui ont déjà leur propre bandeau en sont exclus).
      const AVEC_BANDEAU_PROPRE = ["sites", "compteurs", "astreinte", "planning-individuel", "mon-planning"];
      let cible = content;
      if (!AVEC_BANDEAU_PROPRE.includes(category.id)) {
        const mots = String(category.label || "").split(" ");
        const accent = mots.pop();
        content.innerHTML = `
          <div class="mod sdw">
            <div class="sdw-hero mod-hero">
              <div><h2>${escapeHtml(mots.join(" "))}${mots.length ? " " : ""}<span>${escapeHtml(accent)}</span></h2>
                <p>${escapeHtml(category.desc || "")}</p></div>
              ${subs.length > 1 && activeSub ? `<div class="mod-onglet">${activeSub.icon || ""} ${escapeHtml(activeSub.label)}</div>` : ""}
            </div>
            <div id="mod-corps"></div>
          </div>`;
        cible = document.getElementById("mod-corps");
      }
      activeSub.mount(cible, userPourModule);
      return;
    }

    content.innerHTML = `
      <div class="placeholder-card">
        <b>Bientôt disponible</b><br><br>
        Ce module (${escapeHtml(activeSub?.label || category.label)}) arrive dans une prochaine phase du projet.
      </div>`;
  }

  // Écran « chantier » (Direction sur un module en construction).
  const MESSAGES_CHANTIER = [
    ["Casque obligatoire au-delà de cette ligne !", "Nos meilleurs techniciens (et une quantité raisonnable de café) sont en train de monter ce module. Il ouvrira dès que la peinture sera sèche."],
    ["Chantier interdit au public… même à la direction 😄", "Le module est en cours de construction. Promis, il n'y aura pas de dépassement de budget — le Prévisionnel travaux nous surveille."],
    ["Attention, sol glissant : développement en cours", "Valentin est encore en train de serrer les derniers boulons. Revenez bientôt, la visite de chantier se fera avec les chaussures de sécurité."],
    ["Zone en travaux — accès réservé au chef de chantier", "Ce module n'a pas encore reçu son PV de réception. On vous invitera à couper le ruban !"],
  ];
  function ecranChantier(category) {
    const [titre, texte] = MESSAGES_CHANTIER[Math.floor(Math.random() * MESSAGES_CHANTIER.length)];
    return `
      <div class="chantier">
        <div class="chantier-bande"></div>
        <div class="chantier-scene"><span class="chantier-cone">🚧</span><span class="chantier-engin">🚜</span><span class="chantier-casque">⛑️</span></div>
        <h2>${escapeHtml(titre)}</h2>
        <p>${escapeHtml(texte)}</p>
        <p class="chantier-module">Module : <b>${escapeHtml(category.label)}</b> · 🚧 en construction</p>
        <div class="chantier-bande"></div>
      </div>`;
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  }

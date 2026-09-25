  import { watchAuth, logout, roleLabel } from "./auth.js";
  import { mountCalendrier, mountAbsencesTab, mountInterventionsTab, mountSyntheseTab, mountTransfertsTab, mountCoordonneesTab, mountArchiveRelevesTab, mountPlanningIndividuelTab } from "./planning.js";
  import { mountSitesDossiers } from "./site-dossier.js";
  import "./ui-feedback.js";
  import { mountCompteurs } from "./compteurs.js";
  import { mountMasterlock } from "./masterlock.js";
  import { watchCompteursAlertCount } from "./compteurs-data.js";
  import { mountStockProduits } from "./stock.js";
  import { mountStockInventaire } from "./stock-inventaire.js";
  import { mountStockCommandes } from "./stock-commandes.js";
  import { mountStockSites } from "./stock-sites.js";
  import { mountStockCatalogueSite } from "./stock-site-catalogue.js";
  import { mountFournisseurs } from "./fournisseurs.js";
  import { mountDashboard } from "./home.js";
  import { watchHomeOrder, saveHomeOrder } from "./home-order-data.js";
  import { watchStockAlertCount } from "./stock-alerts-data.js";
  import { mountFichesForDispositif } from "./fiches.js";
  import { mountHeures } from "./heures.js";
  import { mountRepartitionForDispositif } from "./heures-repartition.js";
  import { mountArchiveForDispositif } from "./heures-archive.js";
  import { watchDispositifSettings, heuresEnabled } from "./dispositif-settings-data.js";
  import { mountTracabilite, mountTracabiliteForDispositif } from "./tracabilite.js";
  import { mountUtilisateurs, mountAccesRemplacants, mountParametresDispositif, mountAssociationsSites } from "./parametres.js";
  import { mountMigrationTool } from "./migration-tool.js";
  import { runDailyExportIfNeeded } from "./export-sharepoint.js";
  import { mountExportSharepointAdmin } from "./export-sharepoint-admin.js";
  import { mountQrMasse } from "./qr-print-masse.js";
  import { mountTaches } from "./taches.js";
  import { mountSuiviDemandesTab } from "./suivi-demandes.js";
  import { mountPermissionsDoc } from "./permissions-doc.js";
  import { mountPrevisionnel } from "./previsionnel.js";
  import { mountStockMenage } from "./stock-menage.js";
  import { mountStatistiques } from "./statistiques.js";
  import { mountCorbeille } from "./corbeille.js";
  import { watchSites } from "./sites-data.js";
  import { watchAccess, hasAccess } from "./access-data.js";
  import { initTheme, cycleTheme, getStoredTheme, THEME_LABELS } from "./theme.js";
  import { watchModulesConstruction, basculerModuleConstruction } from "./modules-construction-data.js";
  import { watchUsers } from "./users-data.js";

  initTheme();

  let currentUser = null;
  let currentCategory = null; // null = accueil (bulles)
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
  const estMasqueConstruction = (id, user) => modulesConstruction.includes(id) && (user.role !== "super_admin" || user.apercu);

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
      .filter(d => hasAccess(accessMap, d, user) || (user.extraOnglets || []).includes("disp-" + d))
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
          { id: "liste", label: "Planning", icon: "🗓️", roles: GESTION, mount: mountPlanningIndividuelTab },
        ],
      },
      {
        id: "suivi-demandes", label: "Suivi des demandes", icon: "📄", desc: "Demandes d'intervention importées du fichier Excel : tableau à traiter par les techniciens, + statistiques (mois, statut, association, site, urgence)",
        subtabs: [
          { id: "liste", label: "Demandes", icon: "📄", roles: [...GESTION,"direction","technicien"], mount: mountSuiviDemandesTab },
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
    const [statistiques, astreinte, administration, sites, compteurs, masterlock, previsionnel, taches, planningIndividuel, suiviDemandes, stockMenage, stock] = staticCategories();
    return [statistiques, astreinte, ...dispositifCategories(user), administration, sites, compteurs, masterlock, previsionnel, taches, planningIndividuel, suiviDemandes, stockMenage, stock];
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
    if (!homeOrderSubscribed) {
      homeOrderSubscribed = true;
      // homeOrder ne sert qu'à classer les tuiles de l'écran d'accueil :
      // on ne redessine que si on est sur cet écran, pour ne jamais
      // interrompre une saisie en cours dans un module ouvert.
      watchHomeOrder((o) => { homeOrder = o; if (currentCategory === null) render(); });
    }
    if (!stockAlertSubscribed) {
      stockAlertSubscribed = true;
      // Idem pour les badges d'alerte stock : ils ne s'affichent que sur
      // les tuiles de l'accueil, jamais dans les onglets du module —
      // un remontage complet ici a déjà fait disparaître des saisies en
      // cours (ex. formulaire "Ajouter un produit" ouvert par un autre
      // utilisateur au même moment).
      watchStockAlertCount((counts) => { stockAlertCount = counts; if (currentCategory === null) render(); });
    }
    if (!modulesConstructionSubscribed) {
      modulesConstructionSubscribed = true;
      watchModulesConstruction((ids) => { modulesConstruction = ids; if (currentCategory === null || estMasqueConstruction(currentCategory, utilisateurEffectif())) render(); });
    }
    if (!usersSubscribed && user.role === "super_admin") {
      usersSubscribed = true;
      watchUsers((l) => { usersList = l; if (apercuUid) render(); else majSelectApercu(); });
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
  const TUILES_GEREES_PAR_UTILISATEUR = ["statistiques", "astreinte", "sites", "compteurs", "masterlock", "previsionnel", "planning-individuel", "suivi-demandes", "stock-menage", "stock"];
  const ROLES_ACCES_CAS_PAR_CAS = ["technicien", "menage", "mi_temps", "direction"];
  function categorySubtabsFor(category, user) {
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

    app.innerHTML = `
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
          <span><b>${escapeHtml(currentUser.nom || currentUser.email)}</b> · ${escapeHtml(roleLabel(currentUser.role))}</span>
          ${currentUser.role === "super_admin" ? `<select id="apercu-select" class="apercu-select" title="Voir l'appli comme un autre utilisateur"><option value="">👁️ Aperçu en tant que…</option>${optionsApercu()}</select>` : ""}
          ${voitAdministration ? `<button class="nav-btn gear-btn ${currentCategory === "administration" ? "active" : ""}" id="admin-btn" title="Administration">⚙️</button>` : ""}
          <button class="nav-btn" id="theme-btn" title="Changer l'apparence (propre à cet appareil)">${THEME_LABELS[getStoredTheme()]}</button>
          <button class="logout-btn" id="logout-btn">Se déconnecter</button>
        </div>
      </header>
      ${eff.apercu ? `
      <div class="apercu-bandeau">👁️ Aperçu en tant que <b>${escapeHtml(eff.nom || eff.email)}</b> (${escapeHtml(roleLabel(eff.role))}) — tu vois exactement ses tuiles et onglets. Tu peux modifier ses sites favoris ; évite les autres saisies (elles seraient enregistrées à son nom). <button class="nav-btn" id="apercu-quitter">Quitter l'aperçu</button></div>` : ""}
      ${category && modulesConstruction.includes(category.id) && !eff.apercu ? `<div class="construction-bandeau">🚧 Module en construction — visible uniquement par le Super Admin (masqué pour tous les autres, y compris dans Statistiques).</div>` : ""}
      ${category ? `
      <nav class="tabs">
        ${categorySubtabsFor(category, eff).map(s => `<button class="tab-btn ${s.id===currentSubtab?'active':''}" data-subtab="${s.id}">${s.icon} ${s.label}</button>`).join("")}
      </nav>` : ""}
      <main class="content" id="content"></main>
    `;

    document.getElementById("logout-btn").addEventListener("click", () => logout());
    document.getElementById("theme-btn").addEventListener("click", (e) => {
      cycleTheme();
      e.currentTarget.textContent = THEME_LABELS[getStoredTheme()]; // mise à jour du libellé seule, sans re-render de l'écran en cours (évite de perdre une saisie non enregistrée)
    });
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
      btn.addEventListener("click", () => { currentSubtab = btn.dataset.subtab; render(); });
    });

    renderContent(category);
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
      mountDashboard(content, currentUser, cats, (catId, dossierIdAOuvrir) => {
        currentCategory = catId;
        const cat = allCategories(currentUser).find(c => c.id === catId);
        const subs = categorySubtabsFor(cat, currentUser);
        currentSubtab = subs[0]?.id || null;
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
      const userPourModule = niveauTuile === "read" ? { ...currentUser, lectureSeule: true } : currentUser;
      activeSub.mount(content, userPourModule);
      return;
    }

    content.innerHTML = `
      <div class="placeholder-card">
        <b>Bientôt disponible</b><br><br>
        Ce module (${escapeHtml(activeSub?.label || category.label)}) arrive dans une prochaine phase du projet.
      </div>`;
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  }

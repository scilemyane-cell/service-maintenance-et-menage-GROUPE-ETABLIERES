/**
 * Relais Camileia pour l'appli Service Maintenance et Ménage.
 *
 * À utiliser si l'écran « Camileia (test) » affiche « Appel bloqué par le
 * navigateur (CORS) » en mode direct. Le relais garde les identifiants API
 * côté Google (jamais dans l'appli ni dans GitHub) et fait les appels à la
 * place du navigateur.
 *
 * Mise en place (compte application.etablieres@gmail.com) :
 *  1. script.google.com › Nouveau projet › coller ce fichier.
 *  2. Paramètres du projet › Propriétés du script › ajouter :
 *       CAMILEIA_BASE  = https://groupe-etablieres.camileia.com
 *       CAMILEIA_LOGIN = (identifiant API)
 *       CAMILEIA_MDP   = (mot de passe API)
 *       CLE_RELAIS     = (une longue phrase secrète au choix)
 *  3. Déployer › Nouveau déploiement › Application Web :
 *       Exécuter en tant que : moi — Accès : Tout le monde.
 *  4. Dans l'appli (version test) › Suivi des demandes › Camileia (test) :
 *     mode « Relais », coller l'URL /exec et la CLE_RELAIS.
 *
 * Sécurité : seules les adresses /api-platform/… sont relayées, et seulement
 * avec la bonne clé. Aucune suppression possible (pas de DELETE).
 *
 * MODE « AU NOM DU TECHNICIEN » (action "web") — pour que Camileia trace
 * l'historique (« modifié par … ») et envoie ses mails : le relais se connecte
 * à l'interface web de Camileia avec le compte du technicien et enregistre la
 * fiche DI exactement comme il le ferait à la main.
 *  • L'appli envoie son jeton de connexion Firebase : le relais vérifie auprès
 *    de Google QUI est connecté (impossible de se faire passer pour un autre).
 *  • Identifiants web : une propriété du script par personne, saisie par la
 *    personne elle-même (jamais dans l'appli ni sur les téléphones) :
 *       clé    = WEB prenom.nom@etablieres.fr   (l'adresse de connexion à l'appli)
 *       valeur = identifiant-camileia:mot-de-passe-camileia
 *    Sans propriété pour quelqu'un, l'appli repasse par l'API (non tracé).
 */
var FIREBASE_API_KEY_DEFAUT = "AIzaSyBuxtTTgsdstl2Fho4mUXPibuurFZGy7jk"; // clé web publique de l'appli
function doPost(e) {
  var p = PropertiesService.getScriptProperties();
  try {
    var req = JSON.parse(e.postData.contents || "{}");
    if (!req.cle || req.cle !== p.getProperty("CLE_RELAIS")) return repondre({ erreur: "Clé de relais incorrecte." });
    if (req.action === "web") return repondre(actionWeb(req));
    if (req.action === "inspecter") return repondre(inspecterWeb(req));
    if (req.action === "webMessage") return repondre(messageWeb(req)); // message dans la DI, au nom du technicien (Camileia prévient par mail) // lecture seule d'une page /DI/ (diagnostic)
    if (req.action === "diagWebApi") { // test du mécanisme de connexion web avec le compte API (aucun secret renvoyé)
      sessionWeb("diag-api", p.getProperty("CAMILEIA_LOGIN"), p.getProperty("CAMILEIA_MDP"), true);
      return repondre({ diag: DIAG });
    }
    var methode = String(req.methode || "GET").toUpperCase();
    if (["GET", "POST", "PUT"].indexOf(methode) < 0) return repondre({ erreur: "Méthode refusée : " + methode });
    var chemin = String(req.chemin || "");
    if (chemin.indexOf("/api-platform/") !== 0 || chemin.indexOf("..") >= 0) return repondre({ erreur: "Adresse refusée : " + chemin });

    var r = appelCamileia(methode, chemin, req.corps, jeton(false));
    if (r.statut === 401) r = appelCamileia(methode, chemin, req.corps, jeton(true)); // jeton expiré : on se reconnecte une fois
    return repondre(r);
  } catch (err) {
    return repondre({ erreur: String(err && err.message || err) });
  }
}

function appelCamileia(methode, chemin, corps, tok) {
  var base = PropertiesService.getScriptProperties().getProperty("CAMILEIA_BASE");
  var opts = { method: methode.toLowerCase(), muteHttpExceptions: true, headers: { Authorization: "Bearer " + tok, Accept: "application/json" } };
  if (corps != null) { opts.contentType = "application/json"; opts.payload = JSON.stringify(corps); }
  var res = UrlFetchApp.fetch(base + chemin, opts);
  var texte = res.getContentText(), json;
  try { json = texte ? JSON.parse(texte) : null; } catch (x) { json = texte; }
  return { statut: res.getResponseCode(), corps: json };
}

function jeton(forcer) {
  var cache = CacheService.getScriptCache();
  if (!forcer) { var t = cache.get("jeton"); if (t) return t; }
  var p = PropertiesService.getScriptProperties();
  var essais = [
    { username: p.getProperty("CAMILEIA_LOGIN"), password: p.getProperty("CAMILEIA_MDP") },
    { login: p.getProperty("CAMILEIA_LOGIN"), password: p.getProperty("CAMILEIA_MDP") },
  ];
  for (var i = 0; i < essais.length; i++) {
    var res = UrlFetchApp.fetch(p.getProperty("CAMILEIA_BASE") + "/api-authentication", {
      method: "post", contentType: "application/json", payload: JSON.stringify(essais[i]), muteHttpExceptions: true,
    });
    if (res.getResponseCode() < 300) {
      var d = JSON.parse(res.getContentText());
      var tok = d.token || d.jwt || d.access_token;
      if (tok) { cache.put("jeton", tok, 50 * 60); return tok; }
    }
  }
  throw new Error("Connexion Camileia refusée : vérifie CAMILEIA_LOGIN / CAMILEIA_MDP.");
}

/* ───────────── Mode « au nom du technicien » (interface web) ───────────── */

var P = "sitepro_demandeinterventionbundle_ditype";
var CHAMPS_WEB = {
  etat: P + "[etat]", noteb: P + "[noteb]", dateintervention: P + "[dateintervention]",
  dateinterventionplanifiee: P + "[dateinterventionplanifiee]",
  priorite: P + "[priorite]", typepanne: P + "[typepanne]",
  societes: P + "_societe[]", contacts: P + "_contact[]",
  suivi: P + "_traitement[]", // colonne « Suivi par » de la liste des DI
};

// req = { idToken, di: 6, champs: { etat: 7, noteb: "…", contacts: [12], societes: [4] } }
function actionWeb(req) {
  var email = emailFirebase(req.idToken);
  if (!email) return { erreur: "Connexion à l'appli non vérifiée." };
  var compte = PropertiesService.getScriptProperties().getProperty("WEB " + email);
  if (!compte) return { pasDeCompte: true, email: email };
  var i = compte.indexOf(":");
  var login = (i < 0 ? compte : compte.slice(0, i)).trim(), mdp = i < 0 ? "" : compte.slice(i + 1);
  // Compte web = compte API (même identifiant) sans mot de passe saisi : on reprend CAMILEIA_MDP.
  var pp = PropertiesService.getScriptProperties();
  if (!mdp && login === String(pp.getProperty("CAMILEIA_LOGIN") || "").trim()) mdp = pp.getProperty("CAMILEIA_MDP");
  var di = parseInt(req.di, 10);
  if (!di) return { erreur: "DI manquante." };
  // Le site de la DI (dans l'adresse de la fiche) : lu par l'API.
  var api = appelCamileia("GET", "/api-platform/d_is/" + di, null, jeton(false));
  if (api.statut === 401) api = appelCamileia("GET", "/api-platform/d_is/" + di, null, jeton(true));
  var site = api.corps && String(api.corps.site || "").split("/").pop();
  if (!site) return { erreur: "DI " + di + " introuvable dans Camileia." };
  var url = "/DI/Modifier/Liste_All_DI/" + site + "/" + site + "/" + di;

  var cookies = sessionWeb(email, login, mdp, false);
  var page = getWeb(url, cookies);
  if (page.indexOf("_username") >= 0) { cookies = sessionWeb(email, login, mdp, true); page = getWeb(url, cookies); }
  // Session neuve : Camileia attend qu'on passe par l'accueil et la liste des DI (sinon erreur 500).
  if (/Erreur 500/i.test(page)) {
    ["/Home/Home", "/DI/ListeAll", "/DI/Details/Liste_All_DI/" + site + "/" + site + "/" + di].forEach(function (u) { getWeb(u, cookies); });
    page = getWeb(url, cookies);
  }
  if (page.indexOf("_username") >= 0) return { erreur: "Connexion web Camileia refusée pour " + email + " (identifiant ou mot de passe).", diag: DIAG };

  var form = lireFormulaire(page, "/DI/Modifier/");
  if (req.lecture && form) { // lecture seule : champs de la fiche (sans rien enregistrer)
    var sel = {};
    page.replace(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi, function (t, a, o) {
      var n = attr(a, "name"); if (!n) return "";
      var opts = [], om, ro = /<option\b([^>]*)>([\s\S]*?)(?=<option\b|<\/option>|<\/optgroup>|$)/gi;
      while ((om = ro.exec(o))) opts.push((aAttr(om[1], "selected") ? "*" : "") + attr(om[1], "value") + "=" + decoder(om[2]).replace(/<[^>]+>/g, "").trim());
      sel[n] = opts.slice(0, 60); return "";
    });
    var lab = (page.match(/Suivi[\s\S]{0,400}/i) || [""])[0].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 300);
    return { lecture: true, selects: sel, suivi: lab };
  }
  if (!form) {
    var tt = page.match(/<title>([\s\S]*?)<\/title>/i);
    var corpsTxt = page.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    return { erreur: "Fiche DI " + di + " non modifiable avec le compte de " + email + ".", diagPage: { url: url, titre: tt ? tt[1].trim() : "", taille: page.length, nbForms: (page.match(/<form\b/gi) || []).length, actions: (page.match(/<form\b[^>]*>/gi) || []).slice(0, 5), texte: corpsTxt.slice(0, 400) } };
  }
  var absents = [], suiviRefuse = false;
  var ch = req.champs || {};
  Object.keys(ch).forEach(function (k) {
    var nom = CHAMPS_WEB[k]; if (!nom) return;
    var present = form.noms[nom];
    if (!present) { absents.push(k); return; }
    var v = ch[k];
    if (k === "suivi" && form.options[nom]) { // seulement les personnes proposées dans « Suivi par »
      var voulus = Array.isArray(v) ? v : [v];
      var garde = voulus.filter(function (x) { return form.options[nom].indexOf(String(x)) >= 0; });
      if (garde.length < voulus.length) suiviRefuse = true;
      if (voulus.length && !garde.length) return; // personne inconnue : on ne touche pas au « Suivi par » actuel
      v = garde;
    }
    form.champs = form.champs.filter(function (c) { return c.nom !== nom; });
    (Array.isArray(v) ? v : [v]).forEach(function (x) { if (x !== null && x !== undefined) form.champs.push({ nom: nom, valeur: String(x) }); });
  });
  var res = postMultipart(form.action, form.champs, cookies);
  var ok = /modifi[ée]e avec succ/i.test(res);
  if (!ok) {
    var txt = res.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "");
    var errs = (txt.match(/<(?:li|span|div|p)[^>]*class="[^"]*(?:error|invalid|alert|danger|help-block)[^"]*"[^>]*>[\s\S]{0,300}?<\/(?:li|span|div|p)>/gi) || []).map(function (e) { return e.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(); }).filter(String).slice(0, 6);
    var tt = txt.match(/<title>([\s\S]*?)<\/title>/i);
    return { erreur: "Camileia n'a pas confirmé l'enregistrement de la DI " + di + ".", absents: absents, detail: errs, titre: tt ? tt[1].trim() : "", taille: res.length };
  }
  // Garde-fou : un champ essentiel vidé par l'enregistrement est remis par l'API.
  var avant = api.corps, apres = appelCamileia("GET", "/api-platform/d_is/" + di, null, jeton(false)).corps || {};
  var vides = ["etat", "libelle", "typepanne", "priorite", "type", "batiment", "note"].filter(function (k) { return avant[k] && !apres[k] && !(k in ch); });
  if (ch.etat && !apres.etat) vides.push("etat*");
  if (vides.length) {
    var corps = JSON.parse(JSON.stringify(apres)); delete corps.id;
    vides.forEach(function (k) { if (k === "etat*") corps.etat = "/api-platform/d_i_etats/" + ch.etat; else corps[k] = avant[k]; });
    appelCamileia("PUT", "/api-platform/d_is/" + di, corps, jeton(false));
  }
  return { ok: true, email: email, absents: absents, restaures: vides, suiviRefuse: suiviRefuse };
}

function messageWeb(req) {
  var email = emailFirebase(req.idToken); if (!email) return { erreur: "Connexion à l'appli non vérifiée." };
  var compte = PropertiesService.getScriptProperties().getProperty("WEB " + email); if (!compte) return { pasDeCompte: true, email: email };
  var i = compte.indexOf(":"), login = (i < 0 ? compte : compte.slice(0, i)).trim(), mdp = i < 0 ? "" : compte.slice(i + 1);
  var pp = PropertiesService.getScriptProperties();
  if (!mdp && login === String(pp.getProperty("CAMILEIA_LOGIN") || "").trim()) mdp = pp.getProperty("CAMILEIA_MDP");
  var di = parseInt(req.di, 10), texte = String(req.texte || "").trim();
  if (!di || !texte) return { erreur: "DI ou message manquant." };
  var cookies = sessionWeb(email, login, mdp, false);
  var essai = getWeb("/DI/Messages/" + di, cookies);
  if (essai.indexOf("_username") >= 0) { cookies = sessionWeb(email, login, mdp, true); essai = getWeb("/DI/Messages/" + di, cookies); }
  if (essai.indexOf("_username") >= 0) return { erreur: "Connexion web Camileia refusée pour " + email + "." };
  // Nombre de messages avant / après, lu par l'API (fiable).
  var compter = function () { var r = appelCamileia("GET", "/api-platform/d_is/" + di, null, jeton(false)); return ((r.corps && r.corps.messages) || []).length; };
  var avant = compter();
  var ajax = { "X-Requested-With": "XMLHttpRequest", Accept: "application/json, text/javascript, */*; q=0.01" };
  var base = pp.getProperty("CAMILEIA_BASE");
  // Variantes d'envoi (celle du navigateur d'abord) ; on s'arrête dès que le message apparaît.
  var essais = [
    function () { return postMultipart("/DI/Messages/" + di, [{ nom: "message_tsa_text", valeur: texte }, { nom: "message_tsa_file", valeur: "", fichier: true }], cookies, ajax); },
    function () { return postMultipart("/DI/Messages/" + di, [{ nom: "message_tsa_text", valeur: texte }], cookies, ajax); },
    function () { return UrlFetchApp.fetch(base + "/DI/Messages/" + di, { method: "post", payload: { message_tsa_text: texte }, headers: Object.assign({ Cookie: cookies }, ajax), muteHttpExceptions: true, followRedirects: false }).getContentText(); },
    function () { return UrlFetchApp.fetch(base + "/DI/Messages/" + di, { method: "post", payload: { "message_tsa[text]": texte }, headers: Object.assign({ Cookie: cookies }, ajax), muteHttpExceptions: true, followRedirects: false }).getContentText(); },
  ];
  var res = "", k;
  for (k = 0; k < essais.length; k++) { res = essais[k](); if (compter() > avant) return { ok: true, email: email, variante: k }; }
  return { erreur: "Camileia n'a pas enregistré le message.", statut: DIAG.postStatut, detail: String(res).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 200) };
}

function inspecterWeb(req) {
  var email = emailFirebase(req.idToken); if (!email) return { erreur: "Connexion à l'appli non vérifiée." };
  var compte = PropertiesService.getScriptProperties().getProperty("WEB " + email); if (!compte) return { pasDeCompte: true };
  var i = compte.indexOf(":"), login = compte.slice(0, i).trim(), mdp = compte.slice(i + 1);
  var chemin = String(req.chemin || ""); if (chemin.indexOf("/DI/") !== 0 || chemin.indexOf("..") >= 0) return { erreur: "Adresse refusée" };
  var cookies = sessionWeb(email, login, mdp, false), page = getWeb(chemin, cookies);
  if (page.indexOf("_username") >= 0) { cookies = sessionWeb(email, login, mdp, true); page = getWeb(chemin, cookies); }
  var forms = [], m, re = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
  while ((m = re.exec(page))) forms.push({ action: attr(m[1], "action"), method: attr(m[1], "method"), id: attr(m[1], "id"), champs: (m[2].match(/name="[^"]+"/g) || []).slice(0, 30) });
  var urls = (page.match(/["'](\/DI\/[^"'\s]+)["']/g) || []).filter(function (u, k, a) { return a.indexOf(u) === k; }).slice(0, 40);
  var js = (page.match(/(\$\.(?:ajax|post)|fetch)\([\s\S]{0,300}/g) || []).filter(function (x) { return /essage/i.test(x); }).slice(0, 5);
  var p0 = page.indexOf("form_message"); var autour = p0 >= 0 ? page.slice(Math.max(0, p0 - 1500), p0 + 1500) : "";
  js.push((autour.match(/url\s*[=:][^;\n]{0,160}/g) || []).join(" ## "));
  var p1 = page.indexOf("/DI/Messages/"); js.push(p1 >= 0 ? page.slice(Math.max(0, p1 - 600), p1 + 900) : "");
  var p2 = page.indexOf("form_message"); js.push(p2 >= 0 ? page.slice(Math.max(0, p2 - 200), p2 + 1500) : "");
  if (req.chercher) { var p3 = page.indexOf(String(req.chercher)); js.push(p3 >= 0 ? page.slice(Math.max(0, p3 - 2000), p3 + 400) : "(absent)"); }
  return { taille: page.length, titre: (page.match(/<title>([\s\S]*?)<\/title>/i) || [, ""])[1].trim(), forms: forms, urls: urls, js: js };
}

function emailFirebase(idToken) {
  if (!idToken) return null;
  var cle = PropertiesService.getScriptProperties().getProperty("FIREBASE_API_KEY") || FIREBASE_API_KEY_DEFAUT;
  var r = UrlFetchApp.fetch("https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + cle, {
    method: "post", contentType: "application/json", payload: JSON.stringify({ idToken: idToken }), muteHttpExceptions: true,
  });
  if (r.getResponseCode() !== 200) return null;
  var u = (JSON.parse(r.getContentText()).users || [])[0];
  return u && u.email ? String(u.email).toLowerCase() : null;
}

var DIAG = {}; // déroulé de la dernière connexion web (sans aucun secret), pour dépannage
// Session web (cookies) gardée 20 min par personne.
function sessionWeb(email, login, mdp, forcer) {
  var cache = CacheService.getScriptCache(), k = "web:" + email;
  if (!forcer) { var c = cache.get(k); if (c) return c; }
  var base = PropertiesService.getScriptProperties().getProperty("CAMILEIA_BASE");
  var r1 = UrlFetchApp.fetch(base + "/", { followRedirects: false, muteHttpExceptions: true });
  var jar = {}; garderCookies(jar, r1);
  var m = r1.getContentText().match(/name="_csrf_token"[^>]*value="([^"]*)"/) || r1.getContentText().match(/value="([^"]*)"[^>]*name="_csrf_token"/);
  var r2 = UrlFetchApp.fetch(base + "/", {
    method: "post", followRedirects: false, muteHttpExceptions: true, headers: { Cookie: texteCookies(jar) },
    payload: { _username: login, _password: mdp, _csrf_token: m ? decoder(m[1]) : "" },
  });
  garderCookies(jar, r2);
  var h2 = r2.getAllHeaders();
  DIAG = { get: r1.getResponseCode(), csrf: !!m, cookies1: Object.keys(jar), post: r2.getResponseCode(), vers: String(h2["Location"] || ""), setCookie: typeof h2["Set-Cookie"], loginLen: login.length, mdpLen: mdp.length, espaces: /^\s|\s$/.test(login) || /^\s|\s$/.test(mdp) };
  try {
    var apres = UrlFetchApp.fetch(base + "/", { headers: { Cookie: texteCookies(jar) }, muteHttpExceptions: true, followRedirects: false });
    var t = apres.getContentText();
    DIAG.apres = apres.getResponseCode(); DIAG.apresVers = String(apres.getAllHeaders()["Location"] || "");
    DIAG.formulaire = t.indexOf("_username") >= 0;
    var al = t.match(/class="[^"]*(alert|error|danger)[^"]*"[^>]*>([\s\S]{0,300}?)<\//i);
    DIAG.message = al ? al[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "";
    var mots = t.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").match(/.{0,80}(invalid|incorrect|erron|bloqu|verrouill|expir|tentative).{0,80}/i);
    DIAG.texte = mots ? mots[0] : "";
  } catch (x) { DIAG.apresErr = String(x); }
  var c2 = texteCookies(jar);
  cache.put(k, c2, 20 * 60);
  return c2;
}
function garderCookies(jar, res) {
  var h = res.getAllHeaders()["Set-Cookie"]; if (!h) return;
  (Array.isArray(h) ? h : [h]).forEach(function (l) { var p = String(l).split(";")[0], i = p.indexOf("="); if (i > 0) jar[p.slice(0, i).trim()] = p.slice(i + 1); });
}
function texteCookies(jar) { return Object.keys(jar).map(function (k) { return k + "=" + jar[k]; }).join("; "); }

function getWeb(chemin, cookies) {
  var base = PropertiesService.getScriptProperties().getProperty("CAMILEIA_BASE");
  return UrlFetchApp.fetch(base + chemin, { headers: { Cookie: cookies }, muteHttpExceptions: true }).getContentText();
}

// Envoi du formulaire comme le navigateur (multipart, champs répétés permis).
function postMultipart(chemin, champs, cookies, entetes) {
  var base = PropertiesService.getScriptProperties().getProperty("CAMILEIA_BASE");
  var b = "----smm" + Utilities.getUuid().replace(/-/g, ""), corps = "";
  champs.forEach(function (c) {
    corps += "--" + b + "\r\n";
    if (c.fichier) corps += 'Content-Disposition: form-data; name="' + c.nom + '"; filename=""\r\nContent-Type: application/octet-stream\r\n\r\n\r\n';
    else corps += 'Content-Disposition: form-data; name="' + c.nom + '"\r\n\r\n' + c.valeur + "\r\n";
  });
  corps += "--" + b + "--\r\n";
  var r = UrlFetchApp.fetch(base + chemin, {
    method: "post", contentType: "multipart/form-data; boundary=" + b, payload: Utilities.newBlob(corps).getBytes(),
    headers: Object.assign({ Cookie: cookies }, entetes || {}), muteHttpExceptions: true, followRedirects: false,
  });
  DIAG.postStatut = r.getResponseCode();
  var loc = r.getAllHeaders()["Location"];
  if (loc) return getWeb(String(loc).replace(/^https?:\/\/[^/]+/, ""), cookies);
  return r.getContentText();
}

// Lit le formulaire de la fiche : mêmes valeurs que celles qu'enverrait le navigateur.
function lireFormulaire(html, actionContient) {
  var re = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi, m;
  while ((m = re.exec(html))) {
    var action = attr(m[1], "action");
    if (!action || action.indexOf(actionContient) < 0) continue;
    var corps = m[2].replace(/<script\b[\s\S]*?<\/script>/gi, "").replace(/<!--[\s\S]*?-->/g, ""), champs = [], noms = {}, options = {};
    var ajoute = function (nom, valeur, fichier) { champs.push({ nom: nom, valeur: valeur, fichier: !!fichier }); noms[nom] = true; };
    // zones de texte (retirées du corps pour ne pas lire leurs contenus comme des balises)
    corps = corps.replace(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/gi, function (t, a, v) {
      var nom = attr(a, "name"); if (nom && !aAttr(a, "disabled")) ajoute(nom, decoder(v.replace(/^\r?\n/, ""))); else if (nom) noms[nom] = true;
      return "";
    });
    corps.replace(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi, function (t, a, opts) {
      var nom = attr(a, "name"); if (!nom) return ""; noms[nom] = true;
      if (aAttr(a, "disabled")) return "";
      var multiple = aAttr(a, "multiple"), liste = [], om, ro = /<option\b([^>]*)>([\s\S]*?)(?=<option\b|<\/option>|<\/optgroup>|$)/gi;
      while ((om = ro.exec(opts))) liste.push({ v: attr(om[1], "value") !== null ? attr(om[1], "value") : decoder(om[2]).trim(), sel: aAttr(om[1], "selected"), dis: aAttr(om[1], "disabled") });
      options[nom] = liste.map(function (o) { return String(o.v); });
      var sel = liste.filter(function (o) { return o.sel; });
      if (!multiple && !sel.length) { var p = liste.filter(function (o) { return !o.dis; })[0]; if (p) sel = [p]; }
      if (!multiple) sel = sel.slice(-1);
      sel.forEach(function (o) { ajoute(nom, o.v); });
      return "";
    });
    corps.replace(/<input\b([^>]*)>/gi, function (t, a) {
      var nom = attr(a, "name"); if (!nom) return ""; noms[nom] = true;
      var type = String(attr(a, "type") || "text").toLowerCase();
      if (aAttr(a, "disabled") || /^(submit|button|image|reset)$/.test(type)) return "";
      if (type === "file") { ajoute(nom, "", true); return ""; }
      if ((type === "checkbox" || type === "radio") && !aAttr(a, "checked")) return "";
      var v = attr(a, "value"); ajoute(nom, v === null ? (type === "checkbox" || type === "radio" ? "on" : "") : v);
      return "";
    });
    return { action: decoder(action), champs: champs, noms: noms, options: options };
  }
  return null;
}
function attr(a, n) {
  var m = a.match(new RegExp("(?:^|\\s)" + n + "\\s*=\\s*(\"([^\"]*)\"|'([^']*)'|([^\\s>]+))", "i"));
  return m ? decoder(m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4]) : null;
}
function aAttr(a, n) { return new RegExp("(?:^|\\s)" + n + "(?:\\s|=|$)", "i").test(a); }
function decoder(s) {
  return String(s).replace(/&#x([0-9a-f]+);/gi, function (t, h) { return String.fromCharCode(parseInt(h, 16)); })
    .replace(/&#(\d+);/g, function (t, d) { return String.fromCharCode(+d); })
    .replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, "\u00a0").replace(/&amp;/g, "&");
}

function repondre(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

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
 */
function doPost(e) {
  var p = PropertiesService.getScriptProperties();
  try {
    var req = JSON.parse(e.postData.contents || "{}");
    if (!req.cle || req.cle !== p.getProperty("CLE_RELAIS")) return repondre({ erreur: "Clé de relais incorrecte." });
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
  var opts = { method: methode.toLowerCase(), muteHttpExceptions: true, headers: { Authorization: "Bearer " + tok, Accept: "application/ld+json" } };
  if (corps != null) { opts.contentType = "application/ld+json"; opts.payload = JSON.stringify(corps); }
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

function repondre(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

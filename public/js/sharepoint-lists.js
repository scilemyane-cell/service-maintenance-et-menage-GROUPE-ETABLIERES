// sharepoint-lists.js
// Gestion de listes SharePoint natives via Microsoft Graph API — pour
// afficher les données de l'appli directement dans SharePoint (consultable
// et filtrable dans le navigateur, sans rien télécharger), en complément
// de Firestore qui reste la base de travail en temps réel de l'appli.
//
// Stratégie simple et robuste : à chaque export, on vide la liste puis on
// la remplit à neuf avec les données actuelles — pas de logique de
// correspondance/mise à jour ligne par ligne, donc pas de risque de
// désynchronisation au fil du temps.

import { getGraphToken } from "./graph-auth.js";
import { resolveSiteId } from "./sharepoint-storage.js";

const GRAPH_ROOT = "https://graph.microsoft.com/v1.0";

let siteIdCache = null;
async function siteId(token) {
  if (!siteIdCache) siteIdCache = await resolveSiteId(token);
  return siteIdCache;
}

async function trouverListe(token, nomAffiche) {
  const site = await siteId(token);
  // Récupère toutes les listes et compare exactement côté code, plutôt que
  // de s'appuyer sur un filtre OData ($filter=displayName eq '...') dont
  // l'encodage des espaces dans l'URL s'est révélé peu fiable et pouvait
  // faire correspondre la mauvaise liste (ex. confusion entre deux noms
  // contenant tous deux un espace).
  let url = `${GRAPH_ROOT}/sites/${site}/lists?$top=200`;
  while (url) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Recherche de la liste "${nomAffiche}" échouée (${res.status})`);
    const data = await res.json();
    const trouvee = (data.value || []).find(l => l.displayName === nomAffiche);
    if (trouvee) return trouvee;
    url = data["@odata.nextLink"] || null;
  }
  return null;
}

// colonnes : [{ nom, type }] avec type parmi "text" | "number" | "boolean"
async function creerListe(token, nomAffiche, colonnes) {
  const site = await siteId(token);
  const columns = colonnes.map(c => {
    if (c.type === "number") return { name: c.nom, number: {} };
    if (c.type === "boolean") return { name: c.nom, boolean: {} };
    return { name: c.nom, text: { allowMultipleLines: c.long || false } };
  });
  const res = await fetch(`${GRAPH_ROOT}/sites/${site}/lists`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      displayName: nomAffiche,
      list: { template: "genericList" },
      columns,
    }),
  });
  if (!res.ok) throw new Error(`Création de la liste "${nomAffiche}" échouée (${res.status})`);
  return res.json();
}

async function assurerListe(token, nomAffiche, colonnes) {
  const existante = await trouverListe(token, nomAffiche);
  if (existante) return existante;
  return creerListe(token, nomAffiche, colonnes);
}

async function viderListe(token, listId) {
  const site = await siteId(token);
  let url = `${GRAPH_ROOT}/sites/${site}/lists/${listId}/items?$top=200`;
  const ids = [];
  while (url) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Lecture des éléments existants échouée (${res.status})`);
    const data = await res.json();
    (data.value || []).forEach(it => ids.push(it.id));
    url = data["@odata.nextLink"] || null;
  }
  // Suppressions en parallèle par petits lots, pour ne pas saturer l'API.
  const LOT = 10;
  for (let i = 0; i < ids.length; i += LOT) {
    await Promise.all(ids.slice(i, i + LOT).map(id =>
      fetch(`${GRAPH_ROOT}/sites/${site}/lists/${listId}/items/${id}`, {
        method: "DELETE", headers: { Authorization: `Bearer ${token}` },
      })
    ));
  }
}

// Récupère la correspondance nom affiché -> nom technique interne pour
// chaque colonne d'une liste. Indispensable : quand une liste est créée à
// la main dans l'interface SharePoint, le nom technique utilisé par l'API
// peut différer du nom affiché tapé au clavier — deviner ce nom mène à des
// erreurs "Field 'X' is not recognized".
async function obtenirMappingColonnes(token, listId) {
  const site = await siteId(token);
  const res = await fetch(`${GRAPH_ROOT}/sites/${site}/lists/${listId}/columns`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Lecture des colonnes échouée (${res.status})`);
  const data = await res.json();
  const mapping = {};
  (data.value || []).forEach(col => {
    // Ignore les colonnes système de SharePoint (lecture seule ou cachées,
    // ex. DocIcon, ContentType, Attachments...) — leur nom affiché peut
    // par coïncidence être identique à l'une de nos colonnes personnalisées.
    if (col.readOnly || col.hidden) return;
    mapping[col.displayName] = col.name;
  });
  // La colonne "Titre" par défaut de SharePoint a toujours le nom
  // technique "Title", quelle que soit la langue d'affichage du tenant
  // (ex. "Titre" en français) — on force cette correspondance plutôt que
  // de dépendre du nom affiché, qui varie selon la langue.
  mapping["Title"] = "Title";
  return mapping;
}

// Traduit une ligne (clés = noms affichés) vers les noms techniques réels.
function traduireLigne(ligne, mapping) {
  const traduite = {};
  for (const [affiche, valeur] of Object.entries(ligne)) {
    const technique = mapping[affiche];
    if (technique) {
      traduite[technique] = valeur;
    } else {
      // Colonne absente de la liste SharePoint (pas encore créée, ou nom
      // mal orthographié) — on ignore ce champ plutôt que de faire
      // échouer toute la ligne, mais on le signale dans la console.
      console.warn(`Colonne "${affiche}" introuvable dans la liste SharePoint, valeur ignorée.`);
    }
  }
  return traduite;
}

async function remplirListe(token, listId, lignes) {
  const site = await siteId(token);
  const mapping = await obtenirMappingColonnes(token, listId);
  const lignesTraduites = lignes.map(l => traduireLigne(l, mapping));
  const LOT = 10;
  let premiereErreur = null;
  for (let i = 0; i < lignesTraduites.length; i += LOT) {
    const resultats = await Promise.all(lignesTraduites.slice(i, i + LOT).map(async fields => {
      const res = await fetch(`${GRAPH_ROOT}/sites/${site}/lists/${listId}/items`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ fields }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => null);
        return detail?.error?.message || `HTTP ${res.status}`;
      }
      return null;
    }));
    const erreur = resultats.find(r => r);
    if (erreur && !premiereErreur) premiereErreur = erreur;
  }
  if (premiereErreur) throw new Error(`Échec de l'ajout des éléments : ${premiereErreur}`);
}

// Remplace entièrement le contenu d'une liste par les lignes fournies —
// crée la liste si elle n'existe pas encore.
export async function synchroniserListe(token, nomAffiche, colonnes, lignes) {
  const liste = await assurerListe(token, nomAffiche, colonnes);
  await viderListe(token, liste.id);
  if (lignes.length > 0) await remplirListe(token, liste.id, lignes);
  return liste;
}

export async function urlListe(nomAffiche) {
  const token = await getGraphToken();
  const liste = await trouverListe(token, nomAffiche);
  return liste?.webUrl || null;
}

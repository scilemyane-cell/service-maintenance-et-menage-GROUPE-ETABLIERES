// ia.js — Assistant IA (Gemini, via Firebase AI Logic / « Gemini Developer
// API », utilisable sur le forfait gratuit Spark). À activer une fois dans
// la console Firebase : AI Logic → Commencer → Gemini Developer API.
// Chargé seulement au premier usage (bouton ✨), dans une instance Firebase
// séparée pour ne pas interférer avec le reste de l'appli.
import { firebaseConfig } from "./firebase-config.js";

const VERSION = "12.0.0";
const MODELES = ["gemini-2.5-flash", "gemini-flash-latest", "gemini-2.5-flash-lite", "gemini-flash-lite-latest", "gemini-2.0-flash"];
let modeleQuiMarche = null; // mémorisé pour la session
let modeleMemo = null;

async function modele() {
  if (modeleMemo) return modeleMemo;
  const { initializeApp, getApps } = await import(`https://www.gstatic.com/firebasejs/${VERSION}/firebase-app.js`);
  const { getAI, getGenerativeModel, GoogleAIBackend } = await import(`https://www.gstatic.com/firebasejs/${VERSION}/firebase-ai.js`);
  const app = getApps().find(a => a.name === "ia") || initializeApp(firebaseConfig, "ia");
  const ai = getAI(app, { backend: new GoogleAIBackend() });
  modeleMemo = { ai, getGenerativeModel };
  return modeleMemo;
}

export async function genererTexte(prompt) {
  const { ai, getGenerativeModel } = await modele();
  let derniereErreur = null;
  const ordre = modeleQuiMarche ? [modeleQuiMarche, ...MODELES.filter(m => m !== modeleQuiMarche)] : MODELES;
  // 2 passages : un modèle momentanément surchargé (500/503/429) ou absent
  // (404) → on essaie le suivant ; on repasse une fois après une pause.
  for (let passage = 0; passage < 2; passage++) {
    for (const nom of ordre) {
      try {
        const m = getGenerativeModel(ai, { model: nom });
        const r = await m.generateContent(prompt);
        const t = r.response.text();
        if (t && t.trim()) { modeleQuiMarche = nom; return t.trim(); }
      } catch (e) {
        derniereErreur = e;
        const msg = String(e?.message || e);
        const passager = /\[(500|502|503|504|429)|high demand|overloaded|unavailable|RESOURCE_EXHAUSTED|try again/i.test(msg);
        const absent = /not found|404|unsupported|is not supported/i.test(msg);
        if (!passager && !absent) { passage = 2; break; } // autre erreur : inutile d'insister
      }
    }
    if (passage < 1) await new Promise(r => setTimeout(r, 2000));
  }
  const msg = String(derniereErreur?.message || derniereErreur || "Réponse vide");
  let conseil = "";
  if (/high demand|overloaded|\[50[0-4]|429|RESOURCE_EXHAUSTED/i.test(msg)) conseil = "Les serveurs IA de Google sont momentanément saturés — réessaie dans une minute.";
  else if (/API_KEY_SERVICE_BLOCKED|blocked|are blocked/i.test(msg)) conseil = "La clé API de l'appli bloque ce service : Google Cloud → API et services → Identifiants → ta clé « Browser key » → Restrictions d'API → ajouter « Firebase AI Logic API » (et « Generative Language API »).";
  else if (/has not been used|not.*enabled|SERVICE_DISABLED/i.test(msg)) conseil = "Service pas encore actif (l'activation peut prendre quelques minutes) — réessaie dans 5 min.";
  else if (/PERMISSION_DENIED|403/i.test(msg)) conseil = "Accès refusé par Google — vérifie AI Logic → Paramètres (fournisseur « Gemini Developer API »).";
  else if (/Failed to fetch dynamically imported module|Importing a module script failed/i.test(msg)) conseil = "Le module IA n'a pas pu être chargé (réseau ou version).";
  const e = new Error((conseil ? conseil + " " : "") + "Détail : " + msg.slice(0, 400));
  throw e;
}

// Compte rendu d'intervention rédigé à partir des champs du formulaire.
export async function redigerCompteRendu(f) {
  const lignes = [
    f.date && `Date : ${f.date}`,
    f.technicien && `Intervenant : ${f.technicien}`,
    (f.association || f.site) && `Lieu : ${[f.association, f.groupe, f.site].filter(Boolean).join(" / ")}`,
    f.type && `Type : ${f.type}`,
    (f.heureDebut || f.heureFin) && `Horaires : ${f.heureDebut || "?"} → ${f.heureFin || "?"}`,
    f.heures && `Durée : ${f.heures} h`,
    f.sansDeplacement && `Traité par téléphone / à distance, sans déplacement`,
    f.appelN1 && `Appel au N1 (${f.n1Contacte || "?"}) : ${f.motifAppelN1 || ""}${f.decisionN1 ? " → décision : " + f.decisionN1 : ""}`,
    f.description && `Notes du technicien : ${f.description}`,
    f.compteRendu && `Brouillon existant à améliorer : ${f.compteRendu}`,
  ].filter(Boolean).join("\n");
  return genererTexte(`Tu es l'assistant du service maintenance d'un organisme de formation (Groupe Établières, Vendée).
Rédige le compte rendu d'une intervention d'astreinte, en français, clair et professionnel, à partir des informations ci-dessous.
Règles : 4 à 8 lignes maximum ; structure « Constat », « Intervention réalisée », « Suite à donner » (écrire « Aucune » s'il n'y a rien) ;
n'invente AUCUN fait, matériel, cause ou chiffre absent des informations ; corrige l'orthographe ; pas de titre, pas de formule de politesse, pas de Markdown (pas d'astérisques).

${lignes}`);
}

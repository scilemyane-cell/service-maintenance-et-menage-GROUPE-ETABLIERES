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
// Le compte rendu décrit CE QUE LE TECHNICIEN A FAIT SUR PLACE : l'appel au
// N1, la décision et la validation du déplacement sont déjà affichés à part
// dans la fiche, ils servent seulement de contexte et ne sont pas racontés.
export async function redigerCompteRendu(f) {
  const contexte = [
    f.date && `Date : ${f.date}`,
    (f.association || f.site) && `Lieu : ${[f.association, f.groupe, f.site].filter(Boolean).join(" / ")}`,
    f.type && `Type : ${f.type}`,
    f.appelN1 && f.motifAppelN1 && `Motif de l'appel : ${f.motifAppelN1}`,
    f.sansDeplacement && `Traité par téléphone / à distance, sans déplacement`,
  ].filter(Boolean).join("\n");
  const notes = [
    f.description && `Notes du technicien : ${f.description}`,
    f.compteRendu && `Brouillon existant à améliorer : ${f.compteRendu}`,
  ].filter(Boolean).join("\n");
  return genererTexte(`Tu es l'assistant du service maintenance d'un organisme de formation (Groupe Établières, Vendée).
Un technicien${f.technicien ? ` (${f.technicien})` : ""} rédige le compte rendu de SON intervention d'astreinte. Mets ses notes au propre, en français, clair et professionnel, comme s'il l'écrivait lui-même.
Règles :
- 2 à 5 lignes, structure « Constat : … », « Travaux réalisés : … », « Suite à donner : … » (« Aucune » si rien n'est indiqué).
- Décris uniquement ce que le technicien a constaté et fait sur place, d'après SES notes.
- Ne parle PAS de l'appel au cadre d'astreinte (N1), de qui a appelé qui, ni de la validation du déplacement : c'est déjà noté ailleurs.
- Ne répète pas la date, le site, le nom du technicien ni les horaires : ils sont déjà affichés.
- N'invente AUCUN fait, test, résultat, matériel, cause ou chiffre absent des notes. Si les notes ne disent pas que c'est réglé, ne le dis pas.
- Corrige l'orthographe ; pas de titre, pas de formule de politesse, pas de Markdown (pas d'astérisques).

Contexte (à ne pas recopier) :
${contexte || "—"}

${notes}`);
}

// Reformule proprement la décision / consigne du N1 (1 à 2 phrases).
export async function reformulerDecision(f) {
  return genererTexte(`Reformule en français, en 1 à 2 phrases courtes et professionnelles, la décision ou consigne donnée par le cadre d'astreinte (N1) à un technicien de maintenance.
Corrige l'orthographe, garde exactement le sens, n'ajoute aucun fait, pas de guillemets, pas de Markdown.
${f.motifAppelN1 ? `Motif de l'appel : ${f.motifAppelN1}\n` : ""}Décision / consigne notée : ${f.decisionN1}`);
}

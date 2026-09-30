// ia.js — Assistant IA (Gemini, via Firebase AI Logic / « Gemini Developer
// API », utilisable sur le forfait gratuit Spark). À activer une fois dans
// la console Firebase : AI Logic → Commencer → Gemini Developer API.
// Chargé seulement au premier usage (bouton ✨), dans une instance Firebase
// séparée pour ne pas interférer avec le reste de l'appli.
import { firebaseConfig } from "./firebase-config.js";

const VERSION = "12.19.0"; // SDK récent : nécessaire pour les modèles Gemini 3.x
// Google retire régulièrement des modèles : on essaie les plus récents d'abord,
// et si Google en recommande un autre dans son message d'erreur, on l'essaie
// aussitôt (mémorisé sur l'appareil).
let MODELES = ["gemini-3.8-flash", "gemini-flash-latest", "gemini-3.5-flash", "gemini-flash-lite-latest", "gemini-3.5-flash-lite"];
// Modèles « lite » : bien plus rapides, suffisants pour corriger un texte court.
const MODELES_RAPIDES = ["gemini-3.8-flash", "gemini-flash-lite-latest", "gemini-3.5-flash-lite", "gemini-flash-latest"];
const memo = (cle) => { try { return localStorage.getItem(cle) || null; } catch { return null; } };
let modeleRapideQuiMarche = memo("etablieres-ia-modele-rapide");
let modeleQuiMarche = memo0("etablieres-ia-modele"); // mémorisé sur l'appareil
function memo0(cle) { try { return localStorage.getItem(cle) || null; } catch { return null; } }
let modeleMemo = null;
let sansThinking = memo0("etablieres-ia-sans-thinking") === "1";

async function modele() {
  if (modeleMemo) return modeleMemo;
  // Version récente du SDK, avec repli sur l'ancienne si elle ne se charge pas.
  let libApp, libAI;
  for (const v of [VERSION, "12.0.0"]) {
    try {
      libApp = await import(`https://www.gstatic.com/firebasejs/${v}/firebase-app.js`);
      libAI = await import(`https://www.gstatic.com/firebasejs/${v}/firebase-ai.js`);
      break;
    } catch (e) { if (v === "12.0.0") throw e; console.warn("SDK IA", v, "indisponible, repli :", e); }
  }
  const { initializeApp, getApps } = libApp;
  const { getAI, getGenerativeModel, GoogleAIBackend } = libAI;
  const app = getApps().find(a => a.name === "ia") || initializeApp(firebaseConfig, "ia");
  const ai = getAI(app, { backend: new GoogleAIBackend() });
  modeleMemo = { ai, getGenerativeModel };
  return modeleMemo;
}

// Préchargement (appelé au premier clic dans un champ) : la bibliothèque IA
// est déjà prête quand on clique sur ✨.
export function prechargerIA() { modele().catch(() => {}); }

export async function genererTexte(prompt, { rapide = false } = {}) {
  const { ai, getGenerativeModel } = await modele();
  let derniereErreur = null;
  const essais = [], erreurs = {};
  const dejaBon = rapide ? modeleRapideQuiMarche : modeleQuiMarche;
  const base = rapide ? [...MODELES_RAPIDES, ...MODELES] : MODELES;
  const ordre = dejaBon ? [dejaBon, ...base.filter(m => m !== dejaBon)] : [...new Set(base)];
  if (sansThinking) ordre.__sansThinking = true;
  // 2 passages : un modèle momentanément surchargé (500/503/429) ou absent
  // (404) → on essaie le suivant ; on repasse une fois après une pause.
  for (let passage = 0; passage < 2; passage++) {
    for (let k = 0; k < ordre.length; k++) {
      const nom = ordre[k];
      try {
        // Sans « réflexion » (thinking) : réponse beaucoup plus rapide pour ces textes courts.
        const m = getGenerativeModel(ai, { model: nom, generationConfig: { maxOutputTokens: rapide ? 400 : 1200, temperature: 0.3, ...(ordre.__sansThinking ? {} : { thinkingConfig: /gemini-3|latest/.test(nom) ? { thinkingLevel: "MINIMAL" } : { thinkingBudget: 0 } }) } });
        essais.push(nom);
        // 15 s max par modèle : un modèle saturé ne fait pas attendre indéfiniment.
        const r = await Promise.race([m.generateContent(prompt), new Promise((_, rej) => setTimeout(() => rej(new Error("[503] délai dépassé (15 s)")), 15000))]);
        const t = r.response.text();
        if (t && t.trim()) {
          if (rapide) { modeleRapideQuiMarche = nom; try { localStorage.setItem("etablieres-ia-modele-rapide", nom); } catch {} }
          else { modeleQuiMarche = nom; try { localStorage.setItem("etablieres-ia-modele", nom); } catch {} }
          return t.trim();
        }
      } catch (e) {
        derniereErreur = e;
        const msg = String(e?.message || e);
        if (!erreurs[nom]) erreurs[nom] = (msg.match(/\[\d{3}[^\]]*\][^.]*/) || [msg])[0].slice(0, 90);
        // Réglage « sans réflexion » refusé (400 / invalid argument) : on réessaie sans, et on s'en souvient.
        if ((/thinking|\[400|invalid argument/i.test(msg)) && !ordre.__sansThinking) { ordre.__sansThinking = true; sansThinking = true; try { localStorage.setItem("etablieres-ia-sans-thinking", "1"); } catch {} k--; continue; }
        const conseille = msg.match(/use (?:models\/)?(gemini-[\w.\-]+)/i)?.[1];
        if (conseille && !ordre.includes(conseille)) ordre.splice(k + 1, 0, conseille);
        const passager = /\[(500|502|503|504|429)|high demand|overloaded|unavailable|RESOURCE_EXHAUSTED|try again/i.test(msg);
        const absent = /not found|404|unsupported|is not supported|\[400|invalid argument/i.test(msg);
        if (!passager && !absent) { passage = 2; break; } // autre erreur : inutile d'insister
      }
    }
    if (passage < 1) await new Promise(r => setTimeout(r, 4000));
  }
  const msg = String(derniereErreur?.message || derniereErreur || "Réponse vide");
  let conseil = "";
  if (/high demand|overloaded|\[50[0-4]|429|RESOURCE_EXHAUSTED/i.test(msg)) conseil = "Les serveurs IA de Google sont momentanément saturés — réessaie dans une minute.";
  else if (/API_KEY_SERVICE_BLOCKED|blocked|are blocked/i.test(msg)) conseil = "La clé API de l'appli bloque ce service : Google Cloud → API et services → Identifiants → ta clé « Browser key » → Restrictions d'API → ajouter « Firebase AI Logic API » (et « Generative Language API »).";
  else if (/has not been used|not.*enabled|SERVICE_DISABLED/i.test(msg)) conseil = "Service pas encore actif (l'activation peut prendre quelques minutes) — réessaie dans 5 min.";
  else if (/PERMISSION_DENIED|403/i.test(msg)) conseil = "Accès refusé par Google — vérifie AI Logic → Paramètres (fournisseur « Gemini Developer API »).";
  else if (/Failed to fetch dynamically imported module|Importing a module script failed/i.test(msg)) conseil = "Le module IA n'a pas pu être chargé (réseau ou version).";
  const e = new Error((conseil ? conseil + " " : "") + `Modèles essayés : ${Object.entries(erreurs).slice(0, 4).map(([n, m]) => `${n} → ${m}`).join(" | ") || "aucun"}. Détail : ` + msg.slice(0, 200));
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

// Commentaire intervenant d'une demande (Suivi des demandes) : met au propre
// les notes du technicien, sans rien inventer.
// Correction orthographe / grammaire GRATUITE et rapide (LanguageTool,
// serveurs européens, sans compte) : corrige les fautes sans changer le
// sens ni reformuler. Utilisée en priorité pour les commentaires, actions et
// réponses ; l'IA Gemini ne sert plus qu'en secours.
// Complément au correcteur : notes de terrain du type « réparation réaliser »,
// « robinet changer » → participe passé accordé (« réparation réalisée »).
// Ne touche pas « à changer », « pour réparer », « il faut commander »…
const VERBES_NOTES = ["realiser", "effectuer", "terminer", "changer", "remplacer", "reparer", "commander", "poser", "installer", "nettoyer",
  "verifier", "controler", "regler", "debloquer", "deboucher", "fixer", "livrer", "demonter", "remonter", "graisser", "purger", "resserrer",
  "serrer", "valider", "signaler", "traiter", "securiser", "condamner", "reposer", "recoller", "repeindre", "refaire", "faire"];
const AVANT_INFINITIF = new Set(["a", "à", "pour", "de", "d", "faut", "doit", "doivent", "va", "vont", "peut", "peuvent", "pouvoir", "veut", "veulent",
  "souhaite", "souhaitent", "faire", "fait", "sans", "avant", "apres", "après", "devra", "devront", "prevoir", "prévoir", "merci", "et", "ou", "ne", "se", "s", "me", "te", "le", "la", "les", "l", "en", "y"]);
const FEMININS = /(tion|sion|ure|ee|ée|ie|ette|elle|ence|ance|ade|ise|ine|eille|aille|ouille|ere|ère|oire|ude|ite)$/i;
const FEMININS_MOTS = new Set(["porte", "fuite", "serrure", "poignee", "poignée", "fenetre", "fenêtre", "vitre", "ampoule", "prise", "chaudiere", "chaudière",
  "piece", "pièce", "chasse", "douche", "baignoire", "lampe", "plaque", "cle", "clé", "clef", "boite", "boîte", "vmc", "gache", "gâche", "charniere", "charnière",
  "poubelle", "table", "chaise", "armoire", "cuisine", "salle", "chambre", "commande", "barre", "grille", "tuyauterie", "canalisation", "evacuation", "évacuation",
  "bonde", "cuvette", "vanne", "pompe", "ventilation", "hotte", "plinthe", "dalle", "tringle", "rampe", "marche", "main", "cloison", "peinture", "moquette", "gaine", "sonde", "carte", "batterie", "pile"]);
const MASCULINS_MOTS = new Set(["mitigeur", "robinet", "joint", "radiateur", "ballon", "chauffe-eau", "wc", "lavabo", "evier", "évier", "siphon", "interrupteur",
  "neon", "néon", "store", "volet", "cylindre", "verrou", "groom", "placard", "tiroir", "lit", "matelas", "sommier", "carreau", "carrelage", "plafond", "mur", "sol",
  "tableau", "disjoncteur", "detecteur", "détecteur", "extincteur", "compteur", "thermostat", "circulateur", "flexible", "abattant", "mecanisme", "mécanisme", "devis", "travail", "travaux", "nettoyage", "remplacement", "depannage", "dépannage", "diagnostic", "controle", "contrôle"]);
const sansAccent = (m) => m.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
function accordParticipes(texte) {
  return texte.replace(/([\p{L}'’-]+)(\s+)([\p{L}]+)(?=\s*(?:[.,;:!?]|$|\s+(?:et|par|le|ce|ok|fait|termin)))/gu, (tout, avant, esp, verbe) => {
    const v = sansAccent(verbe);
    if (!VERBES_NOTES.includes(v)) return tout;
    const a = sansAccent(avant.replace(/^.*['’]/, ""));
    if (AVANT_INFINITIF.has(a) || AVANT_INFINITIF.has(avant.toLowerCase())) return tout;
    const brut = avant.toLowerCase();
    const pluriel = /[sx]$/.test(brut) && !["devis", "prix", "choix", "sas", "gaz", "bas", "bois", "dos", "puits", "radis", "tapis", "repas", "travaux"].includes(brut) || brut === "travaux";
    const singulier = pluriel ? brut.replace(/[sx]$/, "") : brut;
    const fem = !MASCULINS_MOTS.has(singulier) && !MASCULINS_MOTS.has(brut) && (FEMININS_MOTS.has(singulier) || FEMININS.test(singulier));
    // On repart de la forme du texte (accents éventuellement déjà corrigés).
    let p = v === "faire" ? "fait" : v === "refaire" ? "refait" : v === "repeindre" ? "repeint" : verbe.slice(0, -2) + "é";
    p = p.replace(/^r[eé]a/i, (m) => m[0] + "éa").replace(/^([rR])ep/, "$1ép").replace(/^([rR])eg/, "$1ég").replace(/^([dD])eb/, "$1éb").replace(/^([dD])em/, "$1ém").replace(/^([vV])er/, "$1ér").replace(/^([sS])ec/, "$1éc").replace(/^([cC])ontrol/, "$1ontrôl");
    if (fem) p += "e";
    if (pluriel) p += "s";
    return avant + esp + p;
  });
}

export async function corrigerOrthographe(texte) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch("https://api.languagetool.org/v2/check", {
      method: "POST", signal: ctrl.signal,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ text: texte, language: "fr", level: "picky" }),
    });
    if (!res.ok) throw new Error(`LanguageTool ${res.status}`);
    const { matches = [] } = await res.json();
    let out = texte;
    // On applique la première suggestion de chaque faute, de la fin vers le début.
    [...matches].sort((a, b) => b.offset - a.offset).forEach(m => {
      const r = m.replacements?.[0]?.value;
      if (r == null) return;
      out = out.slice(0, m.offset) + r + out.slice(m.offset + m.length);
    });
    out = accordParticipes(out);
    out = out.replace(/\s+([,.])/g, "$1").replace(/^\s*(\p{Ll})/u, (x, c) => c.toUpperCase()).trim();
    if (out && !/[.!?…]$/.test(out)) out += ".";
    return out;
  } finally { clearTimeout(t); }
}

export async function redigerCommentaireDemande(f) {
  try { return await corrigerOrthographe(f.notes); }
  catch (e) { console.warn("Correcteur indisponible, repli sur l'IA Gemini :", e); }
  return genererTexte(`Corrige et reformule légèrement le texte ci-dessous, écrit dans le champ « commentaire » d'une demande d'intervention (service maintenance, Groupe Établières).
RÈGLE ABSOLUE : garde EXACTEMENT le sens et la nature du texte.
- Si c'est une question ou un message adressé à quelqu'un (ex. « Bonjour Julie, as-tu fait… ? »), rends une question / un message, avec le même destinataire et la même signature. Ne le transforme JAMAIS en constat ou en action réalisée.
- Si c'est une note de travaux, rends une note factuelle courte.
- N'ajoute AUCUNE information, cause, action, résultat ou suite qui n'est pas écrite. Ne supprime rien d'important (noms, initiales, organismes, références).
- Corrige l'orthographe, la ponctuation et les majuscules (noms propres, ex. Vendée Habitat). Reste bref, même longueur ou presque.
- Réponds uniquement par le texte corrigé : pas de guillemets, pas de titre, pas de Markdown.

Contexte de la demande (ne pas recopier) : ${f.descr || "—"}

Texte à corriger :
${f.notes}`, { rapide: true });
}

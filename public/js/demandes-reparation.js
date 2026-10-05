// demandes-reparation.js
// Réparation des suivis mélangés : quand plusieurs demandes portent le même
// N° dans le fichier Excel, l'ancienne synchro a pu renommer une demande
// (descriptif d'une autre ligne) en laissant son suivi (commentaire, action)
// en place. Ici on repère, dans chaque groupe « même site + même N° », le
// suivi qui correspond nettement mieux au descriptif d'une AUTRE demande du
// groupe, et on propose d'échanger les suivis.

export const CHAMPS_SUIVI = ["statut", "intervenant", "contact", "categorieIntervenant", "dateIntervention", "dateStatut", "commentaireTech", "commentaireTechPar", "commentaireTechLe",
  "declarePar", "declareLe", "validation", "dateValidation", "validePar", "refusPar", "refusLe", "refusMotif",
  "actionPour", "actionPourNom", "actionTexte", "actionEcheance", "actionImmediate", "actionPar", "actionParUid", "actionLe", "actionFaiteLe", "actionFaitePar", "actionFil", "actionReponseNonLue", "mailsEnvoyes"];

const LISTES = new Set(["actionFil", "mailsEnvoyes"]), BOOLS = new Set(["actionImmediate", "actionReponseNonLue"]);
export function suiviDe(d) {
  return Object.fromEntries(CHAMPS_SUIVI.map(k => [k, LISTES.has(k) ? (Array.isArray(d[k]) ? d[k] : []) : BOOLS.has(k) ? !!d[k] : (k === "statut" && d[k] === "Non renseigné" ? "" : (d[k] ?? ""))]));
}
export async function echangerSuivi(a, b, maj) {
  const sa = suiviDe(a), sb = suiviDe(b);
  await maj(a.id, { ...sb, actionNonLuPour: false });
  await maj(b.id, { ...sa, actionNonLuPour: false });
}

// ---- Rapprochement par mots ----
const VIDES = new Set(["pour", "dans", "avec", "sans", "merci", "faire", "fait", "etre", "sont", "plus", "tres", "bien", "cette", "votre", "notre", "leur", "chambre", "logement",
  "demande", "intervention", "changer", "change", "changement", "remplacer", "remplacement", "verifier", "voir", "niveau", "aussi", "encore", "depuis", "toujours", "probleme"]);
const mots = (t) => new Set(String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/[^a-z0-9]+/)
  .filter(m => m.length >= 4 && !VIDES.has(m)).map(m => m.slice(0, 6)));
const texteSuivi = (d) => [d.commentaireTech, d.actionTexte, ...(Array.isArray(d.actionFil) ? d.actionFil.map(x => x?.texte) : [])].filter(Boolean).join(" ");
const aDuSuivi = (d) => !!texteSuivi(d).trim();
function score(suivi, descr) { const s = mots(suivi), dd = mots(descr); let n = 0; s.forEach(m => { if (dd.has(m)) n++; }); return n; }

export function analyserMelanges(demandes) {
  const groupes = new Map();
  demandes.filter(d => d.numero && !d.lieeA).forEach(d => { const k = `${d.site || ""}|${d.numero}`; groupes.set(k, [...(groupes.get(k) || []), d]); });
  const propositions = [], aVerifier = [];
  for (const g of groupes.values()) {
    if (g.length < 2 || !g.some(aDuSuivi)) continue;
    const pris = new Set(); let trouve = false, douteux = false;
    for (const a of g.filter(aDuSuivi)) {
      if (pris.has(a.id)) continue;
      const suivi = texteSuivi(a), propre = score(suivi, a.descriptif);
      const meilleur = g.filter(b => b.id !== a.id && !pris.has(b.id)).map(b => ({ b, s: score(suivi, b.descriptif) })).sort((x, y) => y.s - x.s)[0];
      if (meilleur && meilleur.s >= 1 && meilleur.s > propre) {
        pris.add(a.id); pris.add(meilleur.b.id); trouve = true;
        propositions.push({ a, b: meilleur.b, suivi, scoreA: propre, scoreB: meilleur.s });
      } else if (propre === 0) douteux = true; // suivi sans lien visible avec sa propre demande

    }
    if (!trouve && douteux) aVerifier.push(g);
  }
  return { propositions, aVerifier };
}

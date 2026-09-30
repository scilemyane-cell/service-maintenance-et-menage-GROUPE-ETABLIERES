// saisie-dates.js — Saisie des dates fiable sur tous les écrans.
//
// 1) Pendant qu'on tape une date (jour / mois / année), le champ est vide
//    ou incomplet : si l'écran se redessine à ce moment-là (mise à jour en
//    direct des données), la saisie était perdue et le curseur sautait —
//    « impossible de mettre une date ». On attend donc que le champ soit
//    quitté pour redessiner.
// 2) En tapant l'année chiffre par chiffre, le navigateur envoie des dates
//    intermédiaires (0002, 0020, 0202…) : elles sont ignorées, seule une
//    année plausible est prise en compte.
const SEL = 'input[type="date"],input[type="time"],input[type="month"],input[type="datetime-local"],input[type="week"]';

export function saisieDateEnCours(racine) {
  const a = document.activeElement;
  return !!(a && a.matches && a.matches(SEL) && (!racine || racine.contains(a)));
}

// À appeler en tête d'une fonction de rendu : renvoie true si le rendu
// doit être différé (il sera relancé à la sortie du champ).
export function differerSiSaisieDate(racine, relancer) {
  if (!saisieDateEnCours(racine)) return false;
  const el = document.activeElement;
  el.__relancer = relancer;
  if (!el.__attente) {
    el.__attente = true;
    el.addEventListener("blur", () => { el.__attente = false; const f = el.__relancer; el.__relancer = null; setTimeout(() => { try { f && f(); } catch (e) { console.error(e); } }, 0); }, { once: true });
  }
  return true;
}

let installe = false;
export function installerGardeDates() {
  if (installe) return; installe = true;
  const annee = (el) => { const m = /^(\d{4,})-/.exec(el.value || ""); return m ? +m[1] : null; };
  const garde = (e) => {
    const el = e.target;
    if (!el || !el.matches || !el.matches('input[type="date"],input[type="month"],input[type="datetime-local"]')) return;
    const a = annee(el);
    if (a !== null && (a < 1990 || a > 2100)) e.stopImmediatePropagation(); // année en cours de frappe
  };
  document.addEventListener("change", garde, true);
  document.addEventListener("input", garde, true);
}

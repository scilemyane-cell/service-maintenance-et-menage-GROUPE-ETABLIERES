// saisies-preservees.js — L'écran se redessine à chaque changement dans la
// base (quelqu'un d'autre modifie une demande, synchro automatique…). Sans
// ça, un formulaire en cours (action, réponse, modification) se refermait
// et la saisie était perdue. On mémorise l'état juste avant de redessiner,
// puis on le remet.
const CHAMPS = "[data-act-pour],[data-act-ech],[data-act-texte],[data-rep-texte],[data-edit-pour],[data-edit-ech],[data-edit-texte],#dps-qsite";

function cle(el) {
  const porteur = el.closest("[data-id]");
  const attr = [...el.attributes].map(a => a.name).find(n => n.startsWith("data-act-") || n.startsWith("data-rep-") || n.startsWith("data-edit-")) || el.id || el.className;
  return `${porteur?.dataset.id || ""}|${attr}`;
}

export function capturerSaisies(racine) {
  if (!racine) return null;
  const s = { valeurs: {}, ouverts: [], editions: [], focus: null };
  racine.querySelectorAll(CHAMPS).forEach(el => { if (el.value) s.valeurs[cle(el)] = el.value; });
  racine.querySelectorAll("details[open].dps-action-form, details[open].dps-repondre, details[open].dps-phrases-wrap").forEach(d => s.ouverts.push(cle(d)));
  racine.querySelectorAll(".dps-action-edit:not([hidden])").forEach(d => s.editions.push(cle(d)));
  const a = document.activeElement;
  if (a && racine.contains(a) && a.matches(CHAMPS)) s.focus = { k: cle(a), d: a.selectionStart, f: a.selectionEnd };
  return s;
}

export function restaurerSaisies(racine, s) {
  if (!racine || !s) return;
  racine.querySelectorAll("details.dps-action-form, details.dps-repondre, details.dps-phrases-wrap").forEach(d => { if (s.ouverts.includes(cle(d))) d.open = true; });
  racine.querySelectorAll(".dps-action-edit").forEach(d => { if (s.editions.includes(cle(d))) d.hidden = false; });
  racine.querySelectorAll(CHAMPS).forEach(el => { const v = s.valeurs[cle(el)]; if (v != null && el.value !== v) el.value = v; });
  if (s.focus) {
    const el = [...racine.querySelectorAll(CHAMPS)].find(x => cle(x) === s.focus.k);
    if (el) { el.focus({ preventScroll: true }); try { el.setSelectionRange(s.focus.d, s.focus.f); } catch {} }
  }
}

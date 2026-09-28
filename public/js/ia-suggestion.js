// ia-suggestion.js — La proposition de l'IA s'affiche SOUS le champ ; rien
// n'est remplacé tant que la personne n'a pas cliqué « ✓ Utiliser ».
// Les propositions sont gardées en mémoire : si l'écran se redessine (mise à
// jour en direct), elles réapparaissent au même endroit.
import { esc } from "./astreinte-logic.js";
import { cleChamp } from "./saisies-preservees.js";

const SUGG = new Map(); // clé du champ → texte proposé

function trouverChamp(cle, racine = document) {
  return [...racine.querySelectorAll("textarea, input")].find(el => cleChamp(el) === cle) || null;
}
function boite(cle, texte) {
  const box = document.createElement("div");
  box.className = "ia-sugg";
  box.dataset.suggCle = cle;
  box.innerHTML = `<div class="ia-sugg-tete">✨ Proposition de l'IA</div><div class="ia-sugg-texte">${esc(texte)}</div>
    <div class="ia-sugg-btns"><button type="button" class="ia-ok">✓ Utiliser</button><button type="button" class="ia-non">✕ Garder mon texte</button></div>`;
  return box;
}
function placer(champ, cle, texte) {
  const zone = champ.parentElement;
  zone.querySelector(`:scope > .ia-sugg`)?.remove();
  const bouton = zone.querySelector(":scope > [data-ia-champ], :scope > [data-dps-ia], :scope > [data-ndm-ia]");
  (bouton || champ).after(boite(cle, texte));
}

export function proposerIA(apres, texte, onUtiliser, champ = null) {
  champ = champ || apres.parentElement.querySelector("textarea, [data-ia-cible]");
  if (!champ) { apres.after(boite("", texte)); return; }
  if (texte.trim() === champ.value.trim()) { window.toast?.("✨ L'IA n'a rien trouvé à corriger."); return; }
  const cle = cleChamp(champ);
  SUGG.set(cle, texte);
  placer(champ, cle, texte);
}

// Après un ré-affichage : remettre les propositions en attente.
export function restaurerSuggestions(racine) {
  SUGG.forEach((texte, cle) => { const ch = trouverChamp(cle, racine); if (ch) placer(ch, cle, texte); });
}

if (!window.__iaSuggDeleg) {
  window.__iaSuggDeleg = true;
  document.addEventListener("click", (e) => {
    const ok = e.target.closest(".ia-sugg .ia-ok"), non = e.target.closest(".ia-sugg .ia-non");
    if (!ok && !non) return;
    e.preventDefault();
    const box = e.target.closest(".ia-sugg"), cle = box.dataset.suggCle;
    if (ok) {
      const ch = cle ? trouverChamp(cle) : null;
      if (ch) { ch.value = SUGG.get(cle) || box.querySelector(".ia-sugg-texte").textContent; ch.dispatchEvent(new Event("input", { bubbles: true })); ch.focus(); }
    }
    SUGG.delete(cle); box.remove();
  });
}

// Message court quand l'IA gratuite de Google est saturée (le texte saisi est gardé).
export function signalerErreurIA(err) {
  const m = String(err?.message || err);
  if (/high demand|satur|\[50\d|429|RESOURCE_EXHAUSTED|délai dépassé/i.test(m)) window.toast ? window.toast("⏳ IA de Google saturée pour le moment — ton texte est gardé, réessaie dans quelques minutes.") : alert("IA de Google saturée pour le moment — réessaie dans quelques minutes.");
  else alert("IA indisponible : " + m);
}

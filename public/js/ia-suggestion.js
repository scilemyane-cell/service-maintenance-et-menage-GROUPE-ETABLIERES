// ia-suggestion.js — La proposition de l'IA s'affiche SOUS le champ ; rien
// n'est remplacé tant que la personne n'a pas cliqué « ✓ Utiliser ».
import { esc } from "./astreinte-logic.js";

export function proposerIA(apres, texte, onUtiliser) {
  apres.parentElement.querySelector(":scope > .ia-sugg")?.remove();
  const box = document.createElement("div");
  box.className = "ia-sugg";
  box.innerHTML = `<div class="ia-sugg-tete">✨ Proposition de l'IA</div><div class="ia-sugg-texte">${esc(texte)}</div>
    <div class="ia-sugg-btns"><button type="button" class="ia-ok">✓ Utiliser</button><button type="button" class="ia-non">✕ Garder mon texte</button></div>`;
  apres.after(box);
  box.querySelector(".ia-ok").addEventListener("click", (e) => { e.preventDefault(); onUtiliser(texte); box.remove(); });
  box.querySelector(".ia-non").addEventListener("click", (e) => { e.preventDefault(); box.remove(); });
}

// Message court quand l'IA gratuite de Google est saturée (le texte saisi est gardé).
export function signalerErreurIA(err) {
  const m = String(err?.message || err);
  if (/high demand|satur|\[50\d|429|RESOURCE_EXHAUSTED|délai dépassé/i.test(m)) window.toast ? window.toast("⏳ IA de Google saturée pour le moment — ton texte est gardé, réessaie dans quelques minutes.") : alert("IA de Google saturée pour le moment — réessaie dans quelques minutes.");
  else alert("IA indisponible : " + m);
}

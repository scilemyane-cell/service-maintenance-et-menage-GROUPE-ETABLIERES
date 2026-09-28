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

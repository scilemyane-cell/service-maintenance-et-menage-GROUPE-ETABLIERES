// unites-stock.js
// Liste d'unités standardisée, partagée entre les 3 formulaires de stock
// (Stock maintenance central, Stock déporté par site, Stock Ménage), pour
// que le même mot soit toujours utilisé d'un module à l'autre plutôt que
// de la saisie libre non harmonisée.
//
// Le champ reste un simple <input> texte sous le capot (même id qu'avant)
// pour que tout le code existant qui lit sa valeur continue de fonctionner
// sans changement — on ajoute juste un <select> de propositions au-dessus
// qui le préremplit, avec une option "Autre…" pour les cas particuliers.

export const UNITES_STOCK = [
  "pièce", "lot", "boîte", "sachet", "paquet", "carton", "palette",
  "rouleau", "bidon", "litre", "mL", "kg", "g", "mètre",
];

export function renderUniteField(id, valeurActuelle, esc) {
  const val = (valeurActuelle || "pièce").trim();
  const connu = UNITES_STOCK.includes(val);
  return `
    <select id="${id}-choix" style="margin-bottom:6px">
      ${UNITES_STOCK.map(u => `<option value="${esc(u)}" ${val === u ? "selected" : ""}>${esc(u)}</option>`).join("")}
      <option value="__autre__" ${connu ? "" : "selected"}>Autre…</option>
    </select>
    <input id="${id}" value="${esc(val)}" placeholder="Préciser l'unité" style="display:${connu ? "none" : "block"}">
  `;
}

export function attacherUniteField(id) {
  const select = document.getElementById(`${id}-choix`);
  const input = document.getElementById(id);
  if (!select || !input) return;
  select.addEventListener("change", () => {
    if (select.value === "__autre__") {
      input.style.display = "block";
      input.value = "";
      input.focus();
    } else {
      input.style.display = "none";
      input.value = select.value;
    }
  });
}

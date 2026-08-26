import { mountFichesForDispositif } from "./fiches.js";
import { mountHeures } from "./heures.js";

let ui = {};

export function mountDispositifPage(container, user, dispositif) {
  ui[dispositif] = ui[dispositif] || "fiches";
  render(container, user, dispositif);
}

function render(container, user, dispositif) {
  const subtab = ui[dispositif];
  container.innerHTML = `
    <div class="stack">
      <div class="tabs" style="background:none;border:none;padding:0;margin-bottom:-6px">
        <button class="tab-btn ${subtab === 'fiches' ? 'active' : ''}" data-dp-sub="fiches">📋 Fiches</button>
        <button class="tab-btn ${subtab === 'heures' ? 'active' : ''}" data-dp-sub="heures">🕒 Heures</button>
      </div>
      <div id="dp-content"></div>
    </div>
  `;
  container.querySelectorAll("[data-dp-sub]").forEach(btn => {
    btn.addEventListener("click", () => { ui[dispositif] = btn.dataset.dpSub; render(container, user, dispositif); });
  });
  const c = document.getElementById("dp-content");
  if (subtab === "fiches") mountFichesForDispositif(c, user, dispositif);
  else mountHeures(c, user);
}

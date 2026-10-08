// choix-date.js — Sélecteur de date simple et rapide (relevés de compteur) :
// la date en clair, ◀ ▶ pour reculer/avancer d'un jour, des raccourcis
// (Aujourd'hui, Hier, Fin du mois dernier) et une saisie jj/mm/aaaa.
// La valeur (AAAA-MM-JJ) est dans un champ caché portant l'id demandé, qui
// émet « change » : le code qui lisait un <input type="date"> marche tel quel.
const pad = (n) => String(n).padStart(2, "0");
export const isoLocal = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const depuisIso = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ""); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
const libelle = (d) => d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

export function choixDateHTML(id, iso, { max = isoLocal(new Date()) } = {}) {
  const d = depuisIso(iso) || new Date();
  return `<div class="cdate" data-cdate="${id}" data-max="${max}">
    <input type="hidden" id="${id}" value="${isoLocal(d)}">
    <div class="cdate-ligne">
      <button type="button" class="cdate-pas" data-pas="-1" title="Jour précédent">◀</button>
      <div class="cdate-lib">📅 <b>${libelle(d)}</b></div>
      <button type="button" class="cdate-pas" data-pas="1" title="Jour suivant">▶</button>
    </div>
    <div class="cdate-chips">
      <button type="button" data-raccourci="auj">Aujourd'hui</button>
      <button type="button" data-raccourci="hier">Hier</button>
      <button type="button" data-raccourci="finmois">Fin du mois dernier</button>
      <input type="text" inputmode="numeric" class="cdate-saisie" placeholder="jj/mm/aaaa" maxlength="10" value="${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}">
    </div>
  </div>`;
}

export function activerChoixDate(racine = document) {
  racine.querySelectorAll("[data-cdate]").forEach(bloc => {
    if (bloc.__actif) return; bloc.__actif = true;
    const cache = bloc.querySelector('input[type="hidden"]'), lib = bloc.querySelector(".cdate-lib b"), saisie = bloc.querySelector(".cdate-saisie");
    const max = depuisIso(bloc.dataset.max);
    const poser = (d, majSaisie = true) => {
      if (max && d > max) d = new Date(max);
      cache.value = isoLocal(d); lib.textContent = libelle(d);
      if (majSaisie) saisie.value = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
      bloc.querySelectorAll("[data-raccourci]").forEach(b => b.classList.toggle("on", isoLocal(raccourci(b.dataset.raccourci)) === cache.value));
      cache.dispatchEvent(new Event("change", { bubbles: true }));
    };
    const raccourci = (k) => { const t = new Date(); t.setHours(0, 0, 0, 0); if (k === "hier") t.setDate(t.getDate() - 1); if (k === "finmois") t.setDate(0); return t; };
    bloc.querySelectorAll("[data-pas]").forEach(b => b.onclick = () => { const d = depuisIso(cache.value) || new Date(); d.setDate(d.getDate() + +b.dataset.pas); poser(d); });
    bloc.querySelectorAll("[data-raccourci]").forEach(b => b.onclick = () => poser(raccourci(b.dataset.raccourci)));
    saisie.addEventListener("input", () => {
      let v = saisie.value.replace(/\D/g, "").slice(0, 8);
      saisie.value = v.length > 4 ? `${v.slice(0, 2)}/${v.slice(2, 4)}/${v.slice(4)}` : v.length > 2 ? `${v.slice(0, 2)}/${v.slice(2)}` : v;
      if (v.length === 8) {
        const d = new Date(+v.slice(4), +v.slice(2, 4) - 1, +v.slice(0, 2));
        if (d.getDate() === +v.slice(0, 2) && d.getFullYear() >= 2000) poser(d, false);
      }
    });
    saisie.addEventListener("blur", () => { const d = depuisIso(cache.value); if (d) saisie.value = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`; });
    bloc.querySelectorAll("[data-raccourci]").forEach(b => b.classList.toggle("on", isoLocal(raccourci(b.dataset.raccourci)) === cache.value));
  });
}

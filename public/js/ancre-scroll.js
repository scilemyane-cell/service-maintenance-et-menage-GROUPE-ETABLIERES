// ancre-scroll.js — Quand l'écran se redessine parce qu'un AUTRE utilisateur a
// modifié quelque chose (ex. le superviseur valide une intervention), la page
// ne doit pas « sauter » : on repère l'élément que la personne regarde (le
// premier élément identifié visible en haut de l'écran) et on le remet à la
// même hauteur après le redessin. À défaut, on garde la position de défilement.
const ATTRS = ["data-id", "data-dps-site", "data-fiche-uid", "data-edit", "data-remettre-attente", "data-jour-edit-interv", "data-edit-abs"];
const SEL = ATTRS.map(a => `[${a}]`).join(", ");
const cle = (el) => { for (const a of ATTRS) { const v = el.getAttribute(a); if (v) return `${a}=${v}`; } return ""; };

export function capturerAncre(container) {
  if (!container || !container.isConnected) return null;
  const y = window.scrollY;
  if (y < 40) return { y }; // en haut de page : rien à garder
  const haut = 70; // sous l'en-tête collant
  let choix = null;
  for (const el of container.querySelectorAll(SEL)) {
    const r = el.getBoundingClientRect();
    if (r.height && r.bottom > haut) { choix = { k: cle(el), top: r.top }; break; }
  }
  return { y, ...(choix || {}) };
}

export function restaurerAncre(container, a) {
  if (!a || !container || !container.isConnected || a.y < 40) return;
  const applique = () => {
    if (a.k) {
      const el = [...container.querySelectorAll(SEL)].find(e => cle(e) === a.k);
      if (el) { const d = el.getBoundingClientRect().top - a.top; if (Math.abs(d) > 1) window.scrollBy(0, d); return; }
    }
    if (Math.abs(window.scrollY - a.y) > 1) window.scrollTo(0, a.y);
  };
  applique();
  requestAnimationFrame(applique); // après les images / bandeaux ajoutés juste après
}

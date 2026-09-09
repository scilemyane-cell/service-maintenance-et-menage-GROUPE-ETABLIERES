// drag-reorder.js
// Réordonnancement par glisser-déposer (souris ET tactile, via Pointer
// Events pour un comportement identique sur les deux) — remplace les
// boutons ▲▼ jugés peu pratiques. Chaque ligne déplaçable doit contenir
// une poignée dédiée portant l'attribut [data-drag-handle] (plutôt que
// rendre toute la ligne déplaçable, ce qui gênerait le défilement tactile
// et les boutons internes de la ligne) et un attribut data-drag-index
// donnant sa position d'origine dans le tableau de données.
//
// Fonctionne aussi bien pour des <div> (ex. cartes) que pour des <tr>
// (lignes de tableau) — une <tr> isolée perd sa mise en forme hors d'un
// <table>, donc pour ce cas on affiche un mini tableau flottant "fantôme"
// (avec des largeurs de colonnes figées) qui suit le pointeur, plutôt que
// de déplacer la vraie ligne elle-même.

// container : élément parent contenant les lignes.
// selector  : sélecteur CSS des lignes déplaçables.
// onReorder(nouvelOrdre) : appelée une fois le déplacement terminé, avec
//   un tableau donnant, dans le nouvel ordre visuel, l'ancien index
//   (data-drag-index) de chaque ligne — à l'appelant de reconstruire son
//   tableau de données dans ce nouvel ordre et de l'enregistrer.
export function activerGlisserDeposer(container, selector, onReorder) {
  const items = () => [...container.querySelectorAll(selector)];

  items().forEach((item) => {
    const handle = item.querySelector("[data-drag-handle]");
    if (!handle) return;
    handle.style.touchAction = "none"; // empêche le défilement de la page pendant le glissement tactile
    handle.style.cursor = "grab";

    handle.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      delete item.dataset.dragMoved;
      const estLigneTableau = item.tagName === "TR";
      const rect = item.getBoundingClientRect();
      const startX = e.clientX, startY = e.clientY;

      // Ghost flottant qui suit le pointeur.
      const ghost = item.cloneNode(true);
      let ghostWrapper = ghost;
      if (estLigneTableau) {
        const cells = [...item.children];
        const ghostCells = [...ghost.children];
        cells.forEach((c, i) => { if (ghostCells[i]) ghostCells[i].style.width = c.getBoundingClientRect().width + "px"; });
        const table = document.createElement("table");
        table.style.cssText = "border-collapse:collapse;margin:0";
        table.appendChild(ghost);
        ghostWrapper = table;
      }
      ghostWrapper.style.position = "fixed";
      ghostWrapper.style.top = rect.top + "px";
      ghostWrapper.style.left = rect.left + "px";
      ghostWrapper.style.width = rect.width + "px";
      ghostWrapper.style.zIndex = "1000";
      ghostWrapper.style.pointerEvents = "none";
      ghostWrapper.style.opacity = "0.92";
      ghostWrapper.style.boxShadow = "0 10px 24px rgba(0,0,0,.35)";
      ghostWrapper.style.background = "var(--panel)";
      document.body.appendChild(ghostWrapper);

      item.style.opacity = "0.3";

      const placeholder = document.createElement(estLigneTableau ? "tr" : "div");
      if (estLigneTableau) {
        const td = document.createElement("td");
        td.colSpan = item.children.length;
        td.style.cssText = `height:${rect.height}px;border:2px dashed var(--gold);padding:0`;
        placeholder.appendChild(td);
      } else {
        const cs = getComputedStyle(item);
        placeholder.style.cssText = `height:${rect.height}px;border:2px dashed var(--gold);border-radius:${cs.borderRadius};margin:${cs.marginTop} 0 ${cs.marginBottom}`;
      }
      item.parentNode.insertBefore(placeholder, item);
      item.style.display = "none";
      document.body.style.userSelect = "none";

      const onMove = (ev) => {
        item.dataset.dragMoved = "1";
        ghostWrapper.style.top = (rect.top + (ev.clientY - startY)) + "px";
        ghostWrapper.style.left = (rect.left + (ev.clientX - startX)) + "px";
        for (const el of items()) {
          if (el === item) continue;
          const r = el.getBoundingClientRect();
          if (ev.clientY > r.top && ev.clientY < r.bottom) {
            if (ev.clientY < r.top + r.height / 2) el.parentNode.insertBefore(placeholder, el);
            else el.parentNode.insertBefore(placeholder, el.nextSibling);
            break;
          }
        }
      };
      const onUp = () => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        placeholder.parentNode.insertBefore(item, placeholder);
        placeholder.remove();
        item.style.display = ""; item.style.opacity = "";
        ghostWrapper.remove();
        document.body.style.userSelect = "";
        // Laisse le temps à un éventuel écouteur "click" du contenu de la
        // ligne (ex. bouton "ouvrir") de vérifier ce marqueur pour ignorer
        // le clic qui suit un vrai glissement, avant de le retirer.
        if (item.dataset.dragMoved) setTimeout(() => { delete item.dataset.dragMoved; }, 300);
        onReorder(items().map(el => parseInt(el.dataset.dragIndex, 10)));
      };
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp, { once: true });
    });
  });
}

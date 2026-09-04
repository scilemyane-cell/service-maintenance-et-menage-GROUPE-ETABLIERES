// qr-logo.js
// Génère un QR code avec le logo du Groupe Établières incrusté au centre
// (sur un fond blanc arrondi, pour rester lisible), réutilisé par tous
// les écrans qui génèrent un QR (stock, dossiers de site...). Le niveau
// de correction d'erreur est réglé sur H (~30%) — c'est ce qui permet au
// QR de rester scannable malgré la portion centrale recouverte par le
// logo ; un niveau plus bas romprait la lecture.

let cachedLogo = null;
function loadLogo() {
  if (cachedLogo) return Promise.resolve(cachedLogo);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { cachedLogo = img; resolve(img); };
    img.onerror = reject;
    img.src = "img/logo-etablieres.png";
  });
}

// container : élément DOM vide dans lequel dessiner le QR (comme pour un
// new QRCode(container, ...) classique). text : contenu encodé. size :
// largeur/hauteur en pixels (carré).
export async function renderQrWithLogo(container, text, size = 220) {
  container.innerHTML = "";
  if (!window.QRCode) { container.textContent = "Librairie QR non chargée."; return; }
  new window.QRCode(container, { text, width: size, height: size, correctLevel: window.QRCode.CorrectLevel.H });

  try {
    const logo = await loadLogo();
    const canvas = container.querySelector("canvas");
    // Repli silencieux : anciens navigateurs sans support canvas (qrcodejs
    // rend alors en <table>) — le QR reste valide, simplement sans logo.
    if (!canvas || !container.isConnected) return;
    const ctx = canvas.getContext("2d");

    // Le logo Établières est rectangulaire (large), pas carré : on le
    // fait tenir dans une boîte carrée en conservant ses proportions
    // (comme un "object-fit: contain") au lieu de l'étirer en carré, ce
    // qui le déformait auparavant.
    const boxSize = size * 0.26;
    const ratio = logo.naturalWidth && logo.naturalHeight ? logo.naturalWidth / logo.naturalHeight : 1;
    let logoW = boxSize, logoH = boxSize;
    if (ratio > 1) logoH = boxSize / ratio; else logoW = boxSize * ratio;
    const x = (size - logoW) / 2;
    const y = (size - logoH) / 2;
    const pad = size * 0.03;
    const bx = (size - boxSize) / 2 - pad, by = (size - boxSize) / 2 - pad, bw = boxSize + pad * 2, bh = boxSize + pad * 2, r = 8;

    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.moveTo(bx + r, by);
    ctx.arcTo(bx + bw, by, bx + bw, by + bh, r);
    ctx.arcTo(bx + bw, by + bh, bx, by + bh, r);
    ctx.arcTo(bx, by + bh, bx, by, r);
    ctx.arcTo(bx, by, bx + bw, by, r);
    ctx.closePath();
    ctx.fill();
    ctx.drawImage(logo, x, y, logoW, logoH);
  } catch (e) {
    // Logo indisponible (hors-ligne, etc.) : le QR généré juste avant
    // reste parfaitement valide et scannable, simplement sans logo.
  }
}

// Imprime UNIQUEMENT la carte QR passée en paramètre (élément portant la
// classe .qr-print-card), même si l'écran contient par ailleurs une fiche
// imprimable cachée (ex. dossier de site) ou énormément de contenu au-
// dessus/en-dessous. Plutôt que de masquer tout le reste de la page en
// CSS (fragile : le contenu masqué garde sa hauteur en layout, ce qui
// provoquait un débordement sur plusieurs pages avec du vide), on clone
// la carte dans un conteneur dédié ajouté directement à <body>, et on
// masque le reste de l'application via #app pendant l'impression — une
// seule page, propre, quelle que soit la taille de l'écran d'origine.
// Le contenu du <canvas> du QR (dessiné en JS, jamais présent dans le
// HTML) est converti en image avant le clonage, sinon il apparaîtrait
// vide sur la copie.
export function printQrCard(card) {
  if (!card) { window.print(); return; }

  // Sécurité : si un précédent appel n'a pas été nettoyé à temps (double
  // clic, dialogue d'impression rouvert avant la fin du délai de repli),
  // on retire l'ancien conteneur avant d'en créer un nouveau — sinon les
  // deux s'impriment superposés/à la suite (vu en test : QR dupliqué sur
  // 2 pages).
  document.body.classList.remove("printing-qr");
  document.getElementById("qr-print-root")?.remove();

  const clone = card.cloneNode(true);
  clone.style.display = "block";
  clone.querySelectorAll("button").forEach(b => b.remove()); // inutile sur le papier

  const sourceCanvas = card.querySelector("canvas");
  const cloneCanvas = clone.querySelector("canvas");
  if (sourceCanvas && cloneCanvas) {
    const img = document.createElement("img");
    img.src = sourceCanvas.toDataURL("image/png");
    img.width = sourceCanvas.width;
    img.height = sourceCanvas.height;
    img.style.width = sourceCanvas.width + "px";
    img.style.height = sourceCanvas.height + "px";
    img.style.display = "block";
    img.style.margin = "0 auto";
    cloneCanvas.replaceWith(img);
  }
  // Le fallback interne de qrcodejs (une <img> cachée en display:none,
  // utilisée pour la sauvegarde d'image sur d'anciens navigateurs) ne
  // doit jamais apparaître à l'impression — retiré explicitement plutôt
  // que de compter sur son display:none d'origine.
  clone.querySelectorAll("img[alt='Scan me!']").forEach(el => el.remove());

  const printRoot = document.createElement("div");
  printRoot.id = "qr-print-root";
  printRoot.appendChild(clone);
  document.body.appendChild(printRoot);
  document.body.classList.add("printing-qr");

  const cleanup = () => { document.body.classList.remove("printing-qr"); printRoot.remove(); };
  window.addEventListener("afterprint", cleanup, { once: true });
  window.print();
  setTimeout(cleanup, 3000); // filet de sécurité si "afterprint" ne se déclenche pas
}

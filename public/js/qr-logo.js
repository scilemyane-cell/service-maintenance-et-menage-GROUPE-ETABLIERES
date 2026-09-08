// qr-logo.js
// Génère un QR code avec le logo du Groupe Établières incrusté au centre,
// réutilisé par tous les écrans qui génèrent un QR (stock, dossiers de
// site, compteurs, masterlock, impression en masse...).
//
// Rendu en SVG (librairie qr-code-styling) plutôt qu'en <canvas>
// (qrcodejs, utilisé auparavant) : un SVG est vectoriel, donc net à
// n'importe quelle taille d'affichage ou d'impression — fini l'effet
// flou/pixelisé d'un raster dessiné petit puis agrandi. Le niveau de
// correction d'erreur est réglé sur H (~30%) — c'est ce qui permet au QR
// de rester scannable malgré la portion centrale recouverte par le logo ;
// un niveau plus bas romprait la lecture. Sans logo (sansLogo=true), un
// niveau M (~15%) suffit et réduit la densité du QR pour la même donnée.

// container : élément DOM vide dans lequel dessiner le QR. text : contenu
// encodé. size : largeur/hauteur en pixels (carré). sansLogo : pour un
// QR sans logo incrusté (voir plus haut).
export async function renderQrWithLogo(container, text, size = 220, sansLogo = false) {
  container.innerHTML = "";
  if (!window.QRCodeStyling) { container.textContent = "Librairie QR non chargée."; return; }

  const options = {
    width: size, height: size, type: "svg", data: text, margin: 0,
    qrOptions: { errorCorrectionLevel: sansLogo ? "M" : "H" },
    dotsOptions: { color: "#000000", type: "square" },
    backgroundOptions: { color: "#ffffff" },
  };
  if (!sansLogo) {
    // Le logo Établières est rectangulaire (large), pas carré :
    // imageSize s'applique proportionnellement, sans le déformer.
    options.image = "img/logo-etablieres.png";
    options.imageOptions = { crossOrigin: "anonymous", margin: Math.round(size * 0.02), imageSize: 0.24, hideBackgroundDots: true };
  }

  const qr = new window.QRCodeStyling(options);
  try {
    // getRawData() attend la génération complète (y compris le
    // chargement du logo) avant de résoudre — on l'appelle d'abord pour
    // être sûr que append() affiche directement le rendu final, jamais
    // une version intermédiaire sans logo.
    await qr.getRawData("svg");
  } catch (e) {
    // Logo indisponible (hors-ligne, etc.) : on affiche quand même le QR
    // déjà généré juste après, qui reste parfaitement valide et
    // scannable, simplement sans logo.
  }
  if (!container.isConnected) return; // l'écran a peut-être changé entre-temps
  qr.append(container);
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
// Le QR étant un <svg> (contrairement à l'ancien <canvas>), il se clone
// tel quel sans perdre son contenu — plus besoin de le convertir en image
// avant le clonage.
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

  // Repli de sécurité pour un éventuel ancien rendu resté en <canvas>
  // (ne devrait plus se produire avec le moteur SVG actuel).
  const sourceCanvas = card.querySelector("canvas");
  const cloneCanvas = clone.querySelector("canvas");
  if (sourceCanvas && cloneCanvas) {
    const img = document.createElement("img");
    img.src = sourceCanvas.toDataURL("image/png");
    img.style.width = sourceCanvas.width + "px";
    img.style.height = sourceCanvas.height + "px";
    img.style.display = "block";
    img.style.margin = "0 auto";
    cloneCanvas.replaceWith(img);
  }

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

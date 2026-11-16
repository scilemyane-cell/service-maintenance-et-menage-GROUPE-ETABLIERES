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
  if (!window.QRCodeStyling) await window.chargerLib?.("QRCodeStyling").catch(() => {});
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
  // Identifiants des « clipPath » rendus uniques : la librairie numérote
  // ses dessins (clip-path-dot-color-0, -1…) ; si deux QR portent le même
  // numéro (librairie rechargée, QR déjà affiché ailleurs dans l'écran
  // masqué), le QR imprimé pointe sur celui de l'écran caché et sort BLANC
  // à l'impression (vu sur les étiquettes QR en masse).
  const svg = container.querySelector("svg");
  if (svg) {
    const suf = "-q" + Math.random().toString(36).slice(2, 9);
    svg.innerHTML = svg.innerHTML.replace(/(id="|#)(clip-path-[\w-]+)/g, `$1$2${suf}`);
  }
}

// Convertit un QR rendu en SVG en image matricielle (<img>, PNG) : étape
// nécessaire juste avant impression à cause d'un bug du moteur
// d'impression de Chrome, indépendant de cette appli (reproduit hors
// appli, avec la seule librairie qr-code-styling). Le QR est dessiné avec
// deux rectangles 100%×100% (fond blanc, pavés noirs) chacun découpé par
// un clip-path — celui des pavés contient un <rect> par module du QR, soit
// souvent plus de 1000 formes. Ce clip-path s'affiche parfaitement à
// l'écran mais ne survit pas au pipeline d'impression/export PDF de
// Chrome : constaté en sortant tantôt entièrement noir (clip ignoré, pavé
// affiché plein), tantôt entièrement blanc (clip résolu à une zone vide),
// selon le contexte — jamais le motif réel. Une image matricielle n'a pas
// de clip-path à résoudre, donc pas ce problème ; on sur-échantillonne
// (×3) pour rester net au tirage papier.
async function rasterizeSvg(svg, displaySize) {
  const SCALE = 3;
  const xml = new XMLSerializer().serializeToString(svg);
  const svg64 = btoa(unescape(encodeURIComponent(xml)));
  const img = new Image();
  await new Promise((ok, ko) => {
    img.onload = ok; img.onerror = ko;
    img.src = "data:image/svg+xml;base64," + svg64;
  });
  const canvas = document.createElement("canvas");
  canvas.width = displaySize * SCALE;
  canvas.height = displaySize * SCALE;
  canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
  const out = document.createElement("img");
  out.src = canvas.toDataURL("image/png");
  out.style.width = displaySize + "px";
  out.style.height = displaySize + "px";
  out.style.display = "block";
  out.style.margin = "0 auto";
  return out;
}

// Remplace, dans un conteneur donné, chaque <svg> de QR par sa version
// rasterisée (voir rasterizeSvg ci-dessus) — à appeler juste avant
// window.print(). displaySize : taille d'affichage en px si tous les QR du
// conteneur font la même taille (sinon on relit la largeur de chaque SVG).
export async function rasterizeQrSvgsIn(root, displaySize = null) {
  const svgs = [...root.querySelectorAll("svg")];
  await Promise.all(svgs.map(async (svg) => {
    const size = displaySize ?? parseFloat(svg.getAttribute("width")) ?? 220;
    try {
      const img = await rasterizeSvg(svg, size);
      svg.replaceWith(img);
    } catch (e) {
      // repli : on imprime le SVG tel quel si la rasterisation échoue
      // (ex. navigateur qui bloque data: dans un <img> — rare)
    }
  }));
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
export async function printQrCard(card) {
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

  // QR en SVG : on le rasterise en image avant impression (voir
  // rasterizeQrSvgsIn plus haut) — sinon le clip-path du QR (un par
  // module, souvent 1000+) ne s'imprime pas de façon fiable.
  await rasterizeQrSvgsIn(clone);

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

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
    const logoSize = size * 0.22;
    const pad = size * 0.035;
    const x = (size - logoSize) / 2;
    const y = (size - logoSize) / 2;
    const bx = x - pad, by = y - pad, bw = logoSize + pad * 2, bh = logoSize + pad * 2, r = 8;

    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.moveTo(bx + r, by);
    ctx.arcTo(bx + bw, by, bx + bw, by + bh, r);
    ctx.arcTo(bx + bw, by + bh, bx, by + bh, r);
    ctx.arcTo(bx, by + bh, bx, by, r);
    ctx.arcTo(bx, by, bx + bw, by, r);
    ctx.closePath();
    ctx.fill();
    ctx.drawImage(logo, x, y, logoSize, logoSize);
  } catch (e) {
    // Logo indisponible (hors-ligne, etc.) : le QR généré juste avant
    // reste parfaitement valide et scannable, simplement sans logo.
  }
}

// Imprime UNIQUEMENT la carte QR la plus proche (classe .qr-print-card,
// voir style.css) même si l'écran contient aussi une fiche imprimable
// cachée (ex. dossier de site) — sans cette exclusion mutuelle, les deux
// s'imprimeraient superposées. La classe est retirée juste après
// l'impression (ou après un court délai en repli, au cas où l'évènement
// "afterprint" ne se déclenche pas de façon fiable sur tous navigateurs).
export function printQrCard() {
  document.body.classList.add("printing-qr");
  const cleanup = () => document.body.classList.remove("printing-qr");
  window.addEventListener("afterprint", cleanup, { once: true });
  window.print();
  setTimeout(cleanup, 2000);
}

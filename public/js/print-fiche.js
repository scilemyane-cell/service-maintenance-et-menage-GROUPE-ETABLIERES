// Impression isolée d'une fiche (.print-fiche) dans un conteneur dédié.
//
// Le CSS d'impression historique masque tout le reste de la page via
// `visibility:hidden` pour ne garder que la fiche visible. Problème :
// un élément masqué avec `visibility:hidden` garde sa hauteur dans la
// mise en page — sur un écran contenant beaucoup de contenu sous la
// fiche (ex. la liste complète des interventions sous l'aperçu du
// relevé d'heures), cela produisait plusieurs pages vierges à la suite
// de la fiche imprimée/exportée en PDF.
//
// Même technique déjà éprouvée pour l'impression d'un QR isolé
// (voir printQrCard dans qr-logo.js) : on clone la fiche dans un
// conteneur ajouté directement à <body>, on masque le reste de
// l'application (#app) pendant l'impression — une seule page nette,
// quelle que soit la taille du contenu autour de la fiche à l'écran.
export function imprimerFicheIsolee(fiche) {
  if (!fiche) { window.print(); return; }

  // Sécurité : si un précédent appel n'a pas été nettoyé à temps (double
  // clic, dialogue d'impression rouvert avant la fin du délai de repli),
  // on retire l'ancien conteneur avant d'en créer un nouveau.
  document.body.classList.remove("printing-fiche");
  document.getElementById("fiche-print-root")?.remove();

  const clone = fiche.cloneNode(true);
  clone.style.display = "block";

  const printRoot = document.createElement("div");
  printRoot.id = "fiche-print-root";
  printRoot.appendChild(clone);
  document.body.appendChild(printRoot);
  document.body.classList.add("printing-fiche");

  const cleanup = () => { document.body.classList.remove("printing-fiche"); printRoot.remove(); };
  window.addEventListener("afterprint", cleanup, { once: true });
  window.print();
  setTimeout(cleanup, 3000); // filet de sécurité si "afterprint" ne se déclenche pas
}

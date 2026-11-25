// Filet de sécurité pour les photos prises avec l'appareil (téléphone).
//
// Les écrans de l'appli sont redessinés à chaque mise à jour des données. Si cela arrive pendant que
// l'appareil photo est ouvert, le champ « fichier » sur lequel on a appuyé est remplacé par un nouveau :
// au retour, la photo arrive sur l'ancien champ, qui n'est plus dans la page, et elle était perdue
// sans aucun message. Ici, on repère ce cas et on transmet la photo au champ équivalent de la page.
const attributs = (el) => [...el.attributes].filter(a => a.name.startsWith("data-") || a.name === "name" || a.name === "accept");
function equivalent(ancien) {
  const sel = "input[type=file]" + attributs(ancien).map(a => `[${a.name}="${CSS.escape(a.value)}"]`).join("");
  const l = [...document.querySelectorAll(sel)];
  return l.length === 1 ? l[0] : null; // au moindre doute (plusieurs candidats), on ne devine pas
}
document.addEventListener("click", (e) => {
  const champ = e.target;
  if (!(champ instanceof HTMLInputElement) || champ.type !== "file" || champ._surveille) return;
  champ._surveille = true;
  champ.addEventListener("change", () => {
    if (champ.isConnected || !champ.files?.length) return;
    const nouveau = equivalent(champ);
    if (!nouveau) { window.toast?.("📷 L'écran s'est mis à jour pendant la photo : refais-la, elle n'a pas pu être enregistrée.", "error"); return; }
    try {
      const dt = new DataTransfer(); [...champ.files].forEach(f => dt.items.add(f));
      nouveau.files = dt.files;
      nouveau.dispatchEvent(new Event("change", { bubbles: true }));
    } catch { window.toast?.("📷 L'écran s'est mis à jour pendant la photo : refais-la, elle n'a pas pu être enregistrée.", "error"); }
  });
}, true);

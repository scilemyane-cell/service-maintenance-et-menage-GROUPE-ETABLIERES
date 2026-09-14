// ui-feedback.js
// Notifications "toast" et boîte de confirmation stylées à l'identité de
// l'appli (couleurs, police, coins arrondis via les variables CSS du
// thème actif) — remplacent les popups natives grises du navigateur
// (alert/confirm), qui ne suivent ni le thème ni la charte.
//
// Exposées aussi sur window (toast/confirmDialog) pour que n'importe quel
// fichier existant puisse les utiliser immédiatement sans import, le
// temps que chaque alert()/confirm() du code soit converti au fur et à
// mesure.

let toastRoot = null;
function getToastRoot() {
  if (!toastRoot || !document.body.contains(toastRoot)) {
    toastRoot = document.createElement("div");
    toastRoot.id = "ui-toast-root";
    toastRoot.style.cssText = "position:fixed;top:16px;right:16px;z-index:9999;display:flex;flex-direction:column;gap:8px;max-width:340px;pointer-events:none";
    document.body.appendChild(toastRoot);
  }
  return toastRoot;
}

const COULEURS_TOAST = { info: "var(--border)", success: "var(--teal)", error: "var(--red)" };

export function toast(message, type = "info") {
  const root = getToastRoot();
  const couleur = COULEURS_TOAST[type] || COULEURS_TOAST.info;
  const el = document.createElement("div");
  el.setAttribute("role", "status");
  el.style.cssText = `pointer-events:auto;background:var(--panel);border:1px solid var(--border);border-left:4px solid ${couleur};color:var(--text);border-radius:8px;padding:12px 14px;font-size:13px;line-height:1.4;box-shadow:0 6px 18px rgba(0,0,0,.35);opacity:0;transform:translateX(12px);transition:opacity .18s ease,transform .18s ease`;
  el.textContent = message;
  root.appendChild(el);
  requestAnimationFrame(() => { el.style.opacity = "1"; el.style.transform = "translateX(0)"; });
  setTimeout(() => {
    el.style.opacity = "0"; el.style.transform = "translateX(12px)";
    setTimeout(() => el.remove(), 220);
  }, 3800);
}

export function confirmDialog(message, options = {}) {
  const { titre = "Confirmer", danger = false, texteValider = "Confirmer", texteAnnuler = "Annuler" } = options;
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(6,10,16,.62);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px";
    const boite = document.createElement("div");
    boite.style.cssText = "background:var(--panel);border:1px solid var(--border);border-radius:14px;padding:22px;max-width:380px;width:100%;box-shadow:0 20px 50px rgba(0,0,0,.45)";
    const h3 = document.createElement("h3");
    h3.style.cssText = `margin:0 0 10px;font-size:15px;color:${danger ? "var(--red)" : "var(--text)"}`;
    h3.textContent = titre;
    const p = document.createElement("p");
    p.style.cssText = "margin:0 0 20px;font-size:13px;color:var(--text-dim);line-height:1.5";
    p.textContent = message;
    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;gap:10px;justify-content:flex-end";
    const btnAnnuler = document.createElement("button");
    btnAnnuler.textContent = texteAnnuler;
    btnAnnuler.style.cssText = "background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:8px 16px;font-size:13px;cursor:pointer";
    const btnValider = document.createElement("button");
    btnValider.textContent = texteValider;
    btnValider.style.cssText = `background:${danger ? "var(--red)" : "var(--gold)"};border:none;color:${danger ? "#fff" : "#1A1305"};border-radius:8px;padding:8px 16px;font-size:13px;font-weight:700;cursor:pointer`;
    actions.append(btnAnnuler, btnValider);
    boite.append(h3, p, actions);
    overlay.appendChild(boite);
    document.body.appendChild(overlay);
    btnValider.focus();

    const fermer = (val) => { document.removeEventListener("keydown", surEchap); overlay.remove(); resolve(val); };
    function surEchap(e) { if (e.key === "Escape") fermer(false); }
    btnAnnuler.addEventListener("click", () => fermer(false));
    btnValider.addEventListener("click", () => fermer(true));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) fermer(false); });
    document.addEventListener("keydown", surEchap);
  });
}

window.toast = toast;
window.confirmDialog = confirmDialog;

// logements-miroir.js — « Logements Bât. A / B » : miroir de l'outil de
// gestion des logements (occupation, vidage, transfert) publié à part sur
// logements.novimmo.immo. On l'affiche tel quel dans l'appli (même données,
// même code d'accès), pour ne pas avoir plusieurs choses à ouvrir.
const URL_OUTIL = "https://logements.novimmo.immo/";

export function mountLogements(container) {
  container.innerHTML = `
    <div class="lg-miroir">
      <div class="lg-barre">
        <span>🏠 <b>Gestion des logements</b> — Bâtiments A et B</span>
        <span class="lg-espace"></span>
        <button class="nav-btn" id="lg-recharger" title="Recharger l'outil">↻ Recharger</button>
        <a class="nav-btn" href="${URL_OUTIL}" target="_blank" rel="noopener">↗ Ouvrir en plein écran</a>
      </div>
      <iframe id="lg-cadre" src="${URL_OUTIL}" title="Gestion des logements" loading="eager" referrerpolicy="no-referrer"></iframe>
    </div>`;
  const cadre = container.querySelector("#lg-cadre");
  container.querySelector("#lg-recharger").onclick = () => { cadre.src = URL_OUTIL + "?t=" + Date.now(); };
  // Hauteur : tout l'écran sous la barre de l'appli.
  const ajuster = () => { if (!document.contains(cadre)) { window.removeEventListener("resize", ajuster); return; } cadre.style.height = Math.max(480, window.innerHeight - cadre.getBoundingClientRect().top - 12) + "px"; };
  requestAnimationFrame(ajuster); setTimeout(ajuster, 300);
  window.addEventListener("resize", ajuster);
}

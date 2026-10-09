// logements-miroir.js — « Logements Bât. A / B » : l'outil de gestion des
// logements (occupation, vidage, transfert, planning saisonnier) dans
// l'appli. Mêmes données que logements.novimmo.immo (base « agropolis »),
// mais sans code d'accès : l'utilisateur connecté à l'appli est repris
// (son nom figure dans le journal des mouvements).
const PAGE = "logements.html";

export function mountLogements(container, user) {
  window.smmUtilisateur = user ? { nom: user.nom || user.email || "", email: user.email || "", role: user.role || "", lectureSeule: !!user.lectureSeule } : null;
  container.innerHTML = `
    <div class="lg-miroir">
      <div class="lg-barre">
        <span>🏠 <b>Gestion des logements</b> — Bâtiments A et B</span>
        <span class="lg-espace"></span>
        <button class="nav-btn" id="lg-recharger" title="Recharger l'outil">↻ Recharger</button>
        <button class="nav-btn" id="lg-plein">↗ Ouvrir en plein écran</button>
      </div>
      <iframe id="lg-cadre" src="${PAGE}" title="Gestion des logements" loading="eager"></iframe>
    </div>`;
  const cadre = container.querySelector("#lg-cadre");
  container.querySelector("#lg-recharger").onclick = () => { cadre.src = PAGE + "?t=" + Date.now(); };
  container.querySelector("#lg-plein").onclick = () => window.open(PAGE, "_blank");
  const ajuster = () => { if (!document.contains(cadre)) { window.removeEventListener("resize", ajuster); return; } cadre.style.height = Math.max(640, window.innerHeight - cadre.getBoundingClientRect().top - 12) + "px"; };
  requestAnimationFrame(ajuster); setTimeout(ajuster, 300);
  window.addEventListener("resize", ajuster);
}

// ============================================================
// Fiches de ménage & Traçabilité — squelette en attente.
// Quand tu m'enverras tes fiches de ménage réelles, on construira
// ici : une check-list par site/pièce, remplissable sur tablette
// par l'agent, avec horodatage et historique consultable
// (= la traçabilité des passages).
// ============================================================

export function mountFiches(container) {
  container.innerHTML = `
    <div class="stack">
      <div class="placeholder-card">
        <b>Fiches de ménage — bientôt disponible</b><br><br>
        Cet espace accueillera les check-lists de ménage par site,
        remplissables sur tablette par l'agent (pièce par pièce,
        tâche par tâche).<br><br>
        Envoie tes fiches de ménage actuelles pour qu'on les reproduise ici.
      </div>
    </div>
  `;
}

export function mountTracabilite(container) {
  container.innerHTML = `
    <div class="stack">
      <div class="placeholder-card">
        <b>Traçabilité — bientôt disponible</b><br><br>
        Cet espace affichera l'historique des passages : qui est
        intervenu, quand, sur quel site — à partir des fiches de
        ménage une fois remplies.
      </div>
    </div>
  `;
}

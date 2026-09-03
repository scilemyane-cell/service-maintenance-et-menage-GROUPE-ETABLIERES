import { esc } from "./astreinte-logic.js";
import { watchStockProduits, watchCommandesHistorique, enregistrerCommande } from "./stock-data.js";
import { watchFournisseurs } from "./fournisseurs-data.js";

let state = { produits: [], historique: [], fournisseurs: [] };
let unsubs = [];
let mountedContainer = null;
let mountedUser = null;

function cleanup() { unsubs.forEach(u => u()); unsubs = []; }

export function mountStockCommandes(container, user) {
  cleanup();
  mountedContainer = container;
  mountedUser = user;
  container.innerHTML = `<div class="hint">Chargement…</div>`;
  unsubs.push(watchStockProduits((p) => { state.produits = p; render(); }));
  unsubs.push(watchCommandesHistorique((h) => { state.historique = h; render(); }));
  unsubs.push(watchFournisseurs((f) => { state.fournisseurs = f; render(); }));
}

function produitsACommander() {
  return state.produits.filter(p => (p.stockActuel ?? 0) <= (p.stockMin ?? 0));
}

function groupesParFournisseur(liste) {
  const groupes = new Map();
  liste.forEach(p => {
    const key = p.fournisseurEmail || p.fournisseurNom || "__sans_fournisseur__";
    if (!groupes.has(key)) groupes.set(key, { nom: p.fournisseurNom || "Fournisseur non renseigné", email: p.fournisseurEmail || "", fournisseurId: p.fournisseurId || null, produits: [] });
    groupes.get(key).produits.push(p);
  });
  return [...groupes.values()];
}

function lignesPourGroupe(groupe) {
  return groupe.produits.map(p => ({
    nom: p.nom,
    quantite: Math.max(0, (p.stockCible ?? 0) - (p.stockActuel ?? 0)),
    unite: p.unite || "",
  }));
}

function buildMailto(groupe) {
  const lignes = lignesPourGroupe(groupe).map(l => `- ${l.nom} : ${l.quantite} ${l.unite}`).join("\n");
  // Retrouve le fournisseur (par id si connu, sinon par nom) pour utiliser
  // son message personnalisé s'il en a un — sinon message standard.
  const fournisseur = (groupe.fournisseurId && state.fournisseurs.find(f => f.id === groupe.fournisseurId))
    || state.fournisseurs.find(f => f.nom === groupe.nom);
  const intro = fournisseur?.messageDevis?.trim()
    || "Bonjour,\n\nMerci de nous transmettre un devis pour les produits suivants, afin de reconstituer notre stock :";
  const corps = `${intro}\n\n${lignes}\n\nCordialement,`;
  // Lien direct vers Outlook sur le web (messagerie Office 365) plutôt
  // qu'un simple "mailto:", qui ouvrirait le client mail par défaut du
  // système (pas forcément la bonne boîte).
  const params = new URLSearchParams({
    to: groupe.email,
    subject: "Demande de devis — réapprovisionnement stock maintenance",
    body: corps,
  });
  return `https://outlook.office.com/mail/deeplink/compose?${params.toString()}`;
}

function render() {
  if (!mountedContainer) return;
  if (!document.contains(mountedContainer)) { cleanup(); return; }

  const aCommander = produitsACommander();
  const groupes = groupesParFournisseur(aCommander);

  mountedContainer.innerHTML = `
    <div class="stack">
      <p class="hint">Liste automatique : tout produit dont le stock est passé sous son seuil minimum apparaît ici, groupé par fournisseur, avec un email de demande de devis prêt à envoyer. Une fois la commande passée, marque-la pour garder un historique par prestataire.</p>
      <h3 style="margin:6px 0 0;font-size:14px;color:var(--gold)">À commander</h3>
      ${aCommander.length === 0 ? `
        <div class="stat-chip ok" style="width:fit-content">✓ Aucun produit sous le seuil pour l'instant</div>
      ` : groupes.map((g, gi) => `
        <div class="form-card">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:10px">
            <h3 style="margin:0;font-size:14px;color:var(--gold)">${esc(g.nom)}${g.email ? ` · ${esc(g.email)}` : ""}</h3>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              ${g.email
                ? `<a class="add-btn" href="${buildMailto(g)}" target="_blank" rel="noopener" style="text-decoration:none">📧 Ouvrir dans Outlook</a>`
                : `<span class="hint" style="color:var(--red)">Email fournisseur manquant</span>`}
              <button class="nav-btn" data-marquer="${gi}">✓ Marquer comme commandée</button>
            </div>
          </div>
          <div class="table-wrap" style="border:none">
            <table>
              <thead><tr><th>Produit</th><th>Stock actuel</th><th>Seuil</th><th>Cible</th><th>À commander</th></tr></thead>
              <tbody>
                ${g.produits.map(p => `
                  <tr>
                    <td>${esc(p.nom)}</td>
                    <td style="color:var(--red);font-weight:700">${p.stockActuel ?? 0} ${esc(p.unite || '')}</td>
                    <td>${p.stockMin ?? 0}</td>
                    <td>${p.stockCible ?? 0}</td>
                    <td style="font-weight:700">${Math.max(0, (p.stockCible ?? 0) - (p.stockActuel ?? 0))} ${esc(p.unite || '')}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        </div>
      `).join("")}

      <h3 style="margin:16px 0 0;font-size:14px;color:var(--gold)">Historique des commandes passées</h3>
      ${state.historique.length === 0 ? `<p class="hint">Aucune commande enregistrée pour l'instant.</p>` : `
        <div class="table-wrap">
          <table>
            <thead><tr><th>Date</th><th>Fournisseur</th><th>Produits commandés</th></tr></thead>
            <tbody>
              ${state.historique.map(h => `
                <tr>
                  <td style="white-space:nowrap;font-size:12px">${h.date?.toDate ? h.date.toDate().toLocaleDateString('fr-FR') : '—'}</td>
                  <td>${esc(h.fournisseurNom)}</td>
                  <td style="font-size:12px">${(h.lignes || []).map(l => `${esc(l.nom)} (${l.quantite} ${esc(l.unite || '')})`).join(", ")}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      `}
    </div>
  `;

  mountedContainer.querySelectorAll("[data-marquer]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const g = groupes[parseInt(btn.dataset.marquer, 10)];
      btn.disabled = true; btn.textContent = "⏳…";
      try {
        await enregistrerCommande(g.nom, g.email, lignesPourGroupe(g), mountedUser?.uid || null);
      } catch (e) {
        alert("Échec de l'enregistrement : " + (e.message || e));
        btn.disabled = false; btn.textContent = "✓ Marquer comme commandée";
      }
    });
  });
}

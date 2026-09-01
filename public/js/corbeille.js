// corbeille.js
// Liste les dossiers de site et produits mis à la corbeille (suppression
// récupérable). N'importe quel Admin/Super Admin peut restaurer ; seul un
// Super Admin peut purger définitivement avant l'expiration automatique.

import { esc } from "./astreinte-logic.js";
import {
  listerDossiersCorbeille, restaurerDossier, purgerDossierDefinitivement,
} from "./site-dossier-data.js";
import {
  listerProduitsCorbeille, restaurerProduit, purgerProduitDefinitivement,
} from "./stock-data.js";

const RETENTION_JOURS = 60;

let mountedContainer = null;
let mountedUser = null;

function joursDepuis(timestamp) {
  if (!timestamp?.toMillis) return 0;
  return Math.floor((Date.now() - timestamp.toMillis()) / (1000 * 60 * 60 * 24));
}

export async function mountCorbeille(container, user) {
  mountedContainer = container;
  mountedUser = user;
  container.innerHTML = `<div class="hint">Chargement…</div>`;
  await load();
}

async function load() {
  if (!mountedContainer || !document.contains(mountedContainer)) return;
  const isSuperAdmin = mountedUser?.role === "super_admin";

  const [dossiers, produits] = await Promise.all([
    listerDossiersCorbeille(),
    listerProduitsCorbeille(),
  ]);

  // Purge automatique de tout ce qui dépasse le délai de rétention — les
  // règles Firestore réservent la suppression définitive au Super Admin,
  // donc cette purge ne peut s'exécuter réellement que lorsqu'un Super
  // Admin consulte l'écran. Pour les autres, les éléments expirés restent
  // affichés en attente, sans tentative de suppression (qui échouerait).
  if (isSuperAdmin) {
    const expiresDossiers = dossiers.filter(d => joursDepuis(d.supprimeLe) >= RETENTION_JOURS);
    const expiresProduits = produits.filter(p => joursDepuis(p.supprimeLe) >= RETENTION_JOURS);
    if (expiresDossiers.length || expiresProduits.length) {
      await Promise.all([
        ...expiresDossiers.map(d => purgerDossierDefinitivement(d.id)),
        ...expiresProduits.map(p => purgerProduitDefinitivement(p.id)),
      ]);
    }
  }

  const items = [
    ...dossiers.map(d => ({ type: "dossier", id: d.id, nom: d.nom, supprimeLe: d.supprimeLe })),
    ...produits.map(p => ({ type: "produit", id: p.id, nom: p.nom, supprimeLe: p.supprimeLe })),
  ].filter(it => isSuperAdmin || joursDepuis(it.supprimeLe) < RETENTION_JOURS)
   .sort((a, b) => joursDepuis(a.supprimeLe) - joursDepuis(b.supprimeLe));

  render(items);
}

function render(items) {
  const isSuperAdmin = mountedUser?.role === "super_admin";

  mountedContainer.innerHTML = `
    <div class="stack">
      <p class="hint">Les dossiers de site et produits supprimés restent ici ${RETENTION_JOURS} jours avant suppression définitive automatique. ${isSuperAdmin ? "En tant que Super Admin, tu peux aussi purger immédiatement." : "Seul un Super Admin peut purger avant l'échéance."}</p>
      ${items.length === 0 ? `<p class="hint">La corbeille est vide.</p>` : `
        <div class="table-wrap">
          <table>
            <thead><tr><th>Type</th><th>Nom</th><th>Jours restants</th><th></th></tr></thead>
            <tbody>
              ${items.map(it => {
                const restant = RETENTION_JOURS - joursDepuis(it.supprimeLe);
                const expire = restant <= 0;
                return `
                <tr>
                  <td>${it.type === "dossier" ? "🏢 Dossier de site" : "📦 Produit"}</td>
                  <td>${esc(it.nom)}</td>
                  <td style="color:${expire ? 'var(--red)' : restant <= 7 ? 'var(--gold)' : 'var(--text-dim)'}">${expire ? "Expiré, en attente de purge" : `${restant} j`}</td>
                  <td style="white-space:nowrap">
                    <button class="nav-btn" data-restore="${it.type}:${it.id}" style="padding:4px 10px;font-size:11px">↩️ Restaurer</button>
                    ${isSuperAdmin ? `<button class="del-btn" data-purge="${it.type}:${it.id}" style="padding:4px 10px;font-size:11px">🗑️ Purger</button>` : ""}
                  </td>
                </tr>
              `;}).join("")}
            </tbody>
          </table>
        </div>
      `}
    </div>
  `;

  mountedContainer.querySelectorAll("[data-restore]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const [type, id] = btn.dataset.restore.split(":");
      btn.disabled = true;
      if (type === "dossier") await restaurerDossier(id); else await restaurerProduit(id);
      await load();
    });
  });
  mountedContainer.querySelectorAll("[data-purge]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const [type, id] = btn.dataset.purge.split(":");
      if (!confirm("Suppression définitive et irréversible. Continuer ?")) return;
      btn.disabled = true;
      if (type === "dossier") await purgerDossierDefinitivement(id); else await purgerProduitDefinitivement(id);
      await load();
    });
  });
}

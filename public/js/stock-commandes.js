import { esc } from "./astreinte-logic.js";
import { watchStockProduits } from "./stock-data.js";

let state = { produits: [] };
let unsubs = [];
let mountedContainer = null;

function cleanup() { unsubs.forEach(u => u()); unsubs = []; }

export function mountStockCommandes(container) {
  cleanup();
  mountedContainer = container;
  container.innerHTML = `<div class="hint">Chargement…</div>`;
  unsubs.push(watchStockProduits((p) => { state.produits = p; render(); }));
}

function produitsACommander() {
  return state.produits.filter(p => (p.stockActuel ?? 0) <= (p.stockMin ?? 0));
}

function groupesParFournisseur(liste) {
  const groupes = new Map();
  liste.forEach(p => {
    const key = p.fournisseurEmail || p.fournisseurNom || "__sans_fournisseur__";
    if (!groupes.has(key)) groupes.set(key, { nom: p.fournisseurNom || "Fournisseur non renseigné", email: p.fournisseurEmail || "", produits: [] });
    groupes.get(key).produits.push(p);
  });
  return [...groupes.values()];
}

function buildMailto(groupe) {
  const lignes = groupe.produits.map(p => {
    const aCommander = Math.max(0, (p.stockCible ?? 0) - (p.stockActuel ?? 0));
    return `- ${p.nom} : ${aCommander} ${p.unite || ''} (stock actuel ${p.stockActuel ?? 0}, cible ${p.stockCible ?? 0})`;
  }).join("\n");
  const subject = encodeURIComponent("Demande de devis — réapprovisionnement stock maintenance");
  const body = encodeURIComponent(
    `Bonjour,\n\nMerci de nous transmettre un devis pour les produits suivants, afin de reconstituer notre stock :\n\n${lignes}\n\nCordialement,`
  );
  return `mailto:${groupe.email}?subject=${subject}&body=${body}`;
}

function render() {
  if (!mountedContainer) return;
  if (!document.contains(mountedContainer)) { cleanup(); return; }

  const aCommander = produitsACommander();
  const groupes = groupesParFournisseur(aCommander);

  mountedContainer.innerHTML = `
    <div class="stack">
      <p class="hint">Liste automatique : tout produit dont le stock est passé sous son seuil minimum apparaît ici, groupé par fournisseur, avec un email de demande de devis prêt à envoyer pour reconstituer le stock cible.</p>
      ${aCommander.length === 0 ? `
        <div class="stat-chip ok" style="width:fit-content">✓ Aucun produit sous le seuil pour l'instant</div>
      ` : groupes.map(g => `
        <div class="form-card">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:10px">
            <h3 style="margin:0;font-size:14px;color:var(--gold)">${esc(g.nom)}${g.email ? ` · ${esc(g.email)}` : ""}</h3>
            ${g.email
              ? `<a class="add-btn" href="${buildMailto(g)}" style="text-decoration:none">📧 Générer l'email de commande</a>`
              : `<span class="hint" style="color:var(--red)">Email fournisseur manquant — renseigne-le dans l'onglet Produits</span>`}
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
    </div>
  `;
}

import { esc } from "./astreinte-logic.js";
import { watchStockProduits, enregistrerInventaire } from "./stock-data.js";

let state = { produits: [] };
let ui = { scanning: false, ajusteId: null };
let unsubs = [];
let mountedContainer = null;
let mountedUser = null;
let scanner = null;

function cleanup() { unsubs.forEach(u => u()); unsubs = []; stopScanner(); }

function stopScanner() {
  if (scanner) {
    scanner.stop().catch(() => {}).finally(() => { scanner.clear?.(); scanner = null; });
  }
}

export function mountStockInventaire(container, user) {
  cleanup();
  mountedContainer = container;
  mountedUser = user;
  ui = { scanning: false, ajusteId: null };
  container.innerHTML = `<div class="hint">Chargement…</div>`;
  unsubs.push(watchStockProduits((p) => {
    state.produits = p;
    // Lien direct depuis un QR scanné avec l'appareil photo du téléphone
    // (hors appli) — voir app.html, paramètre ?stock=
    if (window.stockDeepLinkProduitId && !ui.ajusteId) {
      const cible = p.find(x => x.id === window.stockDeepLinkProduitId);
      window.stockDeepLinkProduitId = null;
      if (cible) ui.ajusteId = cible.id;
    }
    render();
  }));
}

function render() {
  if (!mountedContainer) return;
  if (!document.contains(mountedContainer)) { cleanup(); return; }

  if (ui.ajusteId) { renderAjuste(state.produits.find(p => p.id === ui.ajusteId)); return; }
  if (ui.scanning) { renderScan(); return; }

  const sorted = [...state.produits].sort((a, b) => {
    const da = a.dateDernierInventaire?.toMillis ? a.dateDernierInventaire.toMillis() : 0;
    const db_ = b.dateDernierInventaire?.toMillis ? b.dateDernierInventaire.toMillis() : 0;
    return da - db_; // jamais inventoriés / plus anciens en premier
  });

  mountedContainer.innerHTML = `
    <div class="stack">
      <p class="hint">Une fois par mois : scanne l'étiquette QR de chaque produit (ou choisis-le dans la liste) et indique la quantité comptée.</p>
      <button class="add-btn" id="sk-scan" style="width:fit-content">📷 Scanner un produit</button>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Produit</th><th>Stock actuel</th><th>Dernier inventaire</th><th></th></tr></thead>
          <tbody>
            ${sorted.length === 0 ? `<tr><td colspan="4" class="empty-row">Aucun produit — ajoute-les depuis l'onglet Produits.</td></tr>` :
              sorted.map(p => `
                <tr>
                  <td>${esc(p.nom)}</td>
                  <td>${p.stockActuel ?? 0} ${esc(p.unite || '')}</td>
                  <td style="font-size:12px;color:var(--text-dim)">${p.dateDernierInventaire?.toDate ? p.dateDernierInventaire.toDate().toLocaleDateString('fr-FR') : "Jamais"}</td>
                  <td><button class="nav-btn" data-ajuste="${p.id}" style="padding:4px 10px;font-size:11px">Ajuster</button></td>
                </tr>
              `).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById("sk-scan").addEventListener("click", () => { ui.scanning = true; render(); });
  mountedContainer.querySelectorAll("[data-ajuste]").forEach(btn => btn.addEventListener("click", () => { ui.ajusteId = btn.dataset.ajuste; render(); }));
}

function renderScan() {
  mountedContainer.innerHTML = `
    <div class="stack">
      <button class="nav-btn" id="sk-cancel-scan">✕ Annuler</button>
      <div id="sk-reader" style="max-width:360px;border-radius:10px;overflow:hidden"></div>
      <p class="hint" id="sk-scan-hint">Pointe la caméra vers l'étiquette QR collée sur le produit.</p>
    </div>
  `;
  document.getElementById("sk-cancel-scan").addEventListener("click", () => { ui.scanning = false; stopScanner(); render(); });

  if (!window.Html5Qrcode) {
    document.getElementById("sk-scan-hint").innerHTML = `<span style="color:var(--red)">Librairie de scan non chargée (vérifier app.html).</span>`;
    return;
  }

  scanner = new window.Html5Qrcode("sk-reader");
  scanner.start(
    { facingMode: "environment" },
    { fps: 10, qrbox: 220 },
    (decodedText) => {
      let produitId = null;
      try {
        const url = new URL(decodedText);
        produitId = url.searchParams.get("stock");
      } catch (e) {
        const match = decodedText.match(/^ETAB-STOCK:(.+)$/); // ancien format, compatibilité
        produitId = match ? match[1] : null;
      }
      const produit = produitId ? state.produits.find(p => p.id === produitId) : null;
      if (produit) {
        stopScanner();
        ui.scanning = false;
        ui.ajusteId = produit.id;
        render();
      } else {
        document.getElementById("sk-scan-hint").innerHTML = `<span style="color:var(--red)">QR non reconnu — ce n'est pas une étiquette produit de l'appli.</span>`;
      }
    },
    () => {} // erreurs de frame ignorées (normal en continu tant qu'aucun QR n'est détecté)
  ).catch((err) => {
    document.getElementById("sk-scan-hint").innerHTML = `<span style="color:var(--red)">Impossible d'accéder à la caméra : ${esc(err.message || String(err))}</span>`;
  });
}

function renderAjuste(p) {
  if (!p) { ui.ajusteId = null; render(); return; }
  mountedContainer.innerHTML = `
    <div class="stack">
      <button class="nav-btn" id="sk-back">← Retour</button>
      <div class="form-card">
        <h3 style="margin:0 0 4px;font-size:15px;color:var(--gold)">${esc(p.nom)}</h3>
        <p class="hint" style="margin:0 0 12px">Stock actuel enregistré : ${p.stockActuel ?? 0} ${esc(p.unite || '')} · Stock cible : ${p.stockCible ?? 0}</p>
        <label>Quantité comptée<input id="sk-qte" type="number" min="0" value="${p.stockActuel ?? 0}" style="font-size:18px;font-weight:700;width:120px"></label>
        <button class="add-btn" id="sk-valider" style="margin-top:12px">✓ Valider le comptage</button>
        <span id="sk-ajuste-status" style="font-size:12px;margin-left:8px"></span>
      </div>
    </div>
  `;
  document.getElementById("sk-back").addEventListener("click", () => { ui.ajusteId = null; render(); });
  document.getElementById("sk-valider").addEventListener("click", async () => {
    const statusEl = document.getElementById("sk-ajuste-status");
    const nouvelle = parseInt(document.getElementById("sk-qte").value, 10);
    if (isNaN(nouvelle) || nouvelle < 0) { statusEl.innerHTML = `<span style="color:var(--red)">Quantité invalide.</span>`; return; }
    statusEl.innerHTML = `<span style="color:var(--text-dim)">⏳ Enregistrement…</span>`;
    try {
      await enregistrerInventaire(p.id, p.stockActuel ?? 0, nouvelle, mountedUser?.uid || null);
      const alerte = nouvelle <= (p.stockMin ?? 0);
      statusEl.innerHTML = alerte
        ? `<span style="color:var(--red)">✓ Enregistré — sous le seuil, ce produit apparaîtra dans "Commandes".</span>`
        : `<span style="color:var(--gold)">✓ Enregistré</span>`;
      setTimeout(() => { ui.ajusteId = null; render(); }, alerte ? 1600 : 700);
    } catch (e) {
      statusEl.innerHTML = `<span style="color:var(--red)">❌ ${esc(e.message || String(e))}</span>`;
    }
  });
}

import { esc } from "./astreinte-logic.js";
import { watchStockProduits, enregistrerInventaire } from "./stock-data.js";
import { getImageDisplayUrl } from "./sharepoint-storage.js";

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
  const cible = p.stockCible ?? 0;
  const min = p.stockMin ?? 0;

  mountedContainer.innerHTML = `
    <div class="stack">
      <button class="nav-btn" id="sk-back">← Retour</button>
      <div class="form-card" style="text-align:center;max-width:360px;margin:0 auto">
        ${p.photo?.itemId
          ? `<img data-resolve-photo="${esc(p.photo.itemId)}" alt="" style="width:120px;height:120px;object-fit:cover;border-radius:12px;border:1px solid var(--border);margin:0 auto 12px" onerror="this.style.display='none'">`
          : p.photo?.url
          ? `<img src="${esc(p.photo.url)}" alt="" style="width:120px;height:120px;object-fit:cover;border-radius:12px;border:1px solid var(--border);margin:0 auto 12px" onerror="this.style.display='none'">`
          : `<div style="width:120px;height:120px;border-radius:12px;background:var(--panel-alt);display:flex;align-items:center;justify-content:center;font-size:40px;margin:0 auto 12px">📦</div>`}
        <h3 style="margin:0 0 2px;font-size:17px">${esc(p.nom)}</h3>
        <p class="hint" style="margin:0 0 4px">${esc(p.categorie || "")}${p.refFournisseur ? ` · réf. ${esc(p.refFournisseur)}` : ""}</p>
        <p class="hint" style="margin:0 0 16px">Dernier stock enregistré : <b>${p.stockActuel ?? 0} ${esc(p.unite || '')}</b> · Cible : ${cible} · Seuil : ${min}</p>

        <p style="font-size:12px;color:var(--text-dim);margin:0 0 8px">Quantité comptée</p>
        <div style="display:flex;align-items:center;justify-content:center;gap:14px;margin-bottom:10px">
          <button id="sk-moins" style="width:52px;height:52px;border-radius:50%;border:1px solid var(--border);background:var(--panel-alt);color:var(--text);font-size:26px;cursor:pointer">−</button>
          <input id="sk-qte" type="number" min="0" value="${p.stockActuel ?? 0}" style="font-size:32px;font-weight:700;width:110px;text-align:center;background:transparent;border:none;border-bottom:2px solid var(--border);padding:4px">
          <button id="sk-plus" style="width:52px;height:52px;border-radius:50%;border:1px solid var(--border);background:var(--panel-alt);color:var(--text);font-size:26px;cursor:pointer">+</button>
        </div>
        <div id="sk-indicateur" style="font-size:12px;font-weight:700;margin-bottom:14px"></div>

        <button class="nav-btn" id="sk-set-cible" style="margin-bottom:14px">Boîte pleine → régler sur ${cible} ${esc(p.unite || '')}</button>

        <button class="add-btn" id="sk-valider" style="width:100%;font-size:15px;padding:14px">✓ Valider le comptage</button>
        <div id="sk-ajuste-status" style="font-size:12px;margin-top:10px"></div>
      </div>
    </div>
  `;

  const qteInput = document.getElementById("sk-qte");
  const indicateur = document.getElementById("sk-indicateur");
  const photoEl = mountedContainer.querySelector("[data-resolve-photo]");
  if (photoEl) {
    getImageDisplayUrl(photoEl.dataset.resolvePhoto)
      .then(url => { photoEl.src = url; })
      .catch(() => { photoEl.style.display = "none"; });
  }

  function updateIndicateur() {
    const v = parseInt(qteInput.value, 10);
    if (isNaN(v)) { indicateur.innerHTML = ""; return; }
    if (v <= min) indicateur.innerHTML = `<span style="color:var(--red)">⚠️ Sous le seuil — apparaîtra dans "Commandes"</span>`;
    else if (v < cible) indicateur.innerHTML = `<span style="color:var(--gold)">En dessous de la cible</span>`;
    else indicateur.innerHTML = `<span style="color:var(--text-dim)">✓ Stock au niveau normal</span>`;
  }
  updateIndicateur();
  qteInput.addEventListener("input", updateIndicateur);

  document.getElementById("sk-moins").addEventListener("click", () => {
    qteInput.value = Math.max(0, (parseInt(qteInput.value, 10) || 0) - 1);
    updateIndicateur();
  });
  document.getElementById("sk-plus").addEventListener("click", () => {
    qteInput.value = (parseInt(qteInput.value, 10) || 0) + 1;
    updateIndicateur();
  });
  document.getElementById("sk-set-cible").addEventListener("click", () => {
    qteInput.value = cible;
    updateIndicateur();
  });

  document.getElementById("sk-back").addEventListener("click", () => { ui.ajusteId = null; render(); });
  document.getElementById("sk-valider").addEventListener("click", async () => {
    const statusEl = document.getElementById("sk-ajuste-status");
    const nouvelle = parseInt(qteInput.value, 10);
    if (isNaN(nouvelle) || nouvelle < 0) { statusEl.innerHTML = `<span style="color:var(--red)">Quantité invalide.</span>`; return; }
    statusEl.innerHTML = `<span style="color:var(--text-dim)">⏳ Enregistrement…</span>`;
    try {
      await enregistrerInventaire(p.id, p.stockActuel ?? 0, nouvelle, mountedUser?.uid || null);
      const alerte = nouvelle <= min;
      statusEl.innerHTML = alerte
        ? `<span style="color:var(--red)">✓ Enregistré — sous le seuil, ce produit apparaîtra dans "Commandes".</span>`
        : `<span style="color:var(--gold)">✓ Enregistré</span>`;
      setTimeout(() => { ui.ajusteId = null; render(); }, alerte ? 1600 : 700);
    } catch (e) {
      statusEl.innerHTML = `<span style="color:var(--red)">❌ ${esc(e.message || String(e))}</span>`;
    }
  });
}

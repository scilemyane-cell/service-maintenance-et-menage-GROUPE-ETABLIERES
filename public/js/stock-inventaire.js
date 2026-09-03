import { esc } from "./astreinte-logic.js";
import { watchStockProduits, enregistrerInventaire } from "./stock-data.js";
import { getImageDisplayUrl } from "./sharepoint-storage.js";

let state = { produits: [] };
let ui = { scanning: false, ajusteId: null, rapide: false, rapideIndex: 0 };
let unsubs = [];
let mountedContainer = null;
let mountedUser = null;

function cleanup() { unsubs.forEach(u => u()); unsubs = []; }

export function mountStockInventaire(container, user) {
  cleanup();
  mountedContainer = container;
  mountedUser = user;
  ui = { scanning: false, ajusteId: null, rapide: false, rapideIndex: 0 };
  container.innerHTML = `<div class="hint">Chargement…</div>`;
  unsubs.push(watchStockProduits((p) => {
    const dejaEnAjustement = !!ui.ajusteId;
    const dejaEnRapide = ui.rapide;
    state.produits = p;
    // Lien direct depuis un QR scanné avec l'appareil photo du téléphone
    // (hors appli) — voir app.html, paramètre ?stock=
    if (window.stockDeepLinkProduitId && !ui.ajusteId) {
      const cible = p.find(x => x.id === window.stockDeepLinkProduitId);
      window.stockDeepLinkProduitId = null;
      if (cible) ui.ajusteId = cible.id;
    }
    // Lien direct vers le mode rapide (QR unique, imprimé une fois) —
    // voir app.html, paramètre ?stockrapide=1
    if (window.stockRapideDeepLink) {
      window.stockRapideDeepLink = false;
      ui.rapide = true;
      ui.rapideIndex = 0;
    }
    // Ne pas reconstruire l'écran d'ajustement/mode rapide par-dessus une
    // saisie déjà en cours (perte de la quantité en train d'être tapée si
    // quelqu'un d'autre modifie le stock en même temps) — mais on affiche
    // bien le tout premier passage sur ces écrans (ouverture normale ou
    // lien QR).
    if (!dejaEnAjustement && !dejaEnRapide) render();
  }));
}

function render() {
  if (!mountedContainer) return;
  if (!document.contains(mountedContainer)) { cleanup(); return; }

  if (ui.ajusteId) { renderAjuste(state.produits.find(p => p.id === ui.ajusteId)); return; }
  if (ui.rapide) { renderRapide(); return; }
  if (ui.scanning) { renderScan(); return; }

  const sorted = [...state.produits].sort((a, b) => {
    const da = a.dateDernierInventaire?.toMillis ? a.dateDernierInventaire.toMillis() : 0;
    const db_ = b.dateDernierInventaire?.toMillis ? b.dateDernierInventaire.toMillis() : 0;
    return da - db_; // jamais inventoriés / plus anciens en premier
  });

  mountedContainer.innerHTML = `
    <div class="stack">
      <p class="hint">Une fois par mois : scanne l'étiquette QR de chaque produit (ou choisis-le dans la liste) et indique la quantité comptée. Le mode rapide te fait défiler tous les produits dans l'ordre des étagères (réglable dans l'onglet Produits), sans avoir à revenir à la liste entre chaque.</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="add-btn" id="sk-rapide" style="width:fit-content">🚀 Mode rapide</button>
        <button class="nav-btn" id="sk-scan" style="width:fit-content">📷 Scanner un produit</button>
        <button class="nav-btn" id="sk-qr-rapide" style="width:fit-content">🔳 QR du mode rapide</button>
      </div>
      <div id="sk-qr-rapide-holder" style="display:none;background:#fff;border-radius:10px;padding:16px;text-align:center;max-width:260px">
        <div id="sk-qr-rapide-canvas" style="width:200px;height:200px;margin:0 auto"></div>
        <p style="color:#111;font-size:11px;margin:8px 0 0">À imprimer et coller une seule fois — scanné avec l'appareil photo du téléphone, ouvre directement le mode rapide.</p>
      </div>
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
  document.getElementById("sk-rapide").addEventListener("click", () => { ui.rapide = true; ui.rapideIndex = 0; render(); });
  document.getElementById("sk-qr-rapide").addEventListener("click", () => {
    const holder = document.getElementById("sk-qr-rapide-holder");
    const canvas = document.getElementById("sk-qr-rapide-canvas");
    if (holder.style.display === "none") {
      holder.style.display = "block";
      canvas.innerHTML = "";
      if (window.QRCode) {
        new window.QRCode(canvas, { text: "https://service-maintenance-et-menage.web.app/app.html?stockrapide=1", width: 200, height: 200, correctLevel: window.QRCode.CorrectLevel.M });
      } else {
        canvas.textContent = "Librairie QR non chargée.";
      }
    } else {
      holder.style.display = "none";
    }
  });
  mountedContainer.querySelectorAll("[data-ajuste]").forEach(btn => btn.addEventListener("click", () => { ui.ajusteId = btn.dataset.ajuste; render(); }));
}

function renderScan() {
  mountedContainer.innerHTML = `
    <div class="stack">
      <button class="nav-btn" id="sk-cancel-scan">✕ Annuler</button>
      <div class="form-card" style="text-align:center;max-width:360px">
        <p class="hint" style="margin:0 0 14px">Prends une photo nette de l'étiquette QR collée sur le produit — l'appareil photo habituel de ton téléphone va s'ouvrir.</p>
        <input type="file" accept="image/*" capture="environment" id="sk-scan-input" style="display:none">
        <button class="add-btn" id="sk-scan-open" style="width:100%;padding:16px;font-size:15px">📷 Prendre la photo</button>
      </div>
      <p class="hint" id="sk-scan-hint"></p>
    </div>
  `;
  document.getElementById("sk-cancel-scan").addEventListener("click", () => { ui.scanning = false; render(); });

  const onDecoded = (decodedText) => {
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
      ui.scanning = false;
      ui.ajusteId = produit.id;
      render();
    } else {
      document.getElementById("sk-scan-hint").innerHTML = `<span style="color:var(--red)">QR non reconnu — ce n'est pas une étiquette produit de l'appli. Réessaie avec la photo plus nette/plus proche.</span>`;
    }
  };

  const inputEl = document.getElementById("sk-scan-input");
  document.getElementById("sk-scan-open").addEventListener("click", () => inputEl.click());
  inputEl.addEventListener("change", () => {
    const fichier = inputEl.files?.[0];
    if (!fichier) return;
    const hintEl = document.getElementById("sk-scan-hint");
    hintEl.innerHTML = `<span style="color:var(--text-dim)">⏳ Lecture du QR…</span>`;
    decoderImageQr(fichier)
      .then((texte) => {
        if (texte) onDecoded(texte);
        else hintEl.innerHTML = `<span style="color:var(--red)">Aucun QR détecté sur cette photo — réessaie en te rapprochant.</span>`;
      })
      .catch(() => { hintEl.innerHTML = `<span style="color:var(--red)">Échec de lecture de la photo.</span>`; })
      .finally(() => { inputEl.value = ""; });
  });
}

// Décode un QR code à partir d'une photo statique (plutôt qu'un flux
// vidéo en direct, qui s'est révélé peu fiable — écran noir — sur
// certains téléphones Android malgré l'autorisation caméra accordée).
function decoderImageQr(fichier) {
  return new Promise((resolve, reject) => {
    if (!window.jsQR) { reject(new Error("Librairie de lecture QR non chargée")); return; }
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const donnees = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const resultat = window.jsQR(donnees.data, donnees.width, donnees.height);
      resolve(resultat ? resultat.data : null);
    };
    img.onerror = () => reject(new Error("Image illisible"));
    img.src = URL.createObjectURL(fichier);
  });
}

function renderRapide() {
  // Utilise l'ordre défini dans l'onglet Produits (flèches ▲▼, rangé comme
  // les étagères) — watchStockProduits trie déjà selon ce champ "ordre".
  const liste = state.produits;

  if (ui.rapideIndex >= liste.length) {
    mountedContainer.innerHTML = `
      <div class="stack">
        <div class="form-card" style="text-align:center;max-width:360px;margin:0 auto">
          <p style="font-size:40px;margin:0 0 8px">🎉</p>
          <h3 style="margin:0 0 8px">Inventaire terminé</h3>
          <p class="hint" style="margin:0 0 16px">${liste.length} produit(s) parcouru(s).</p>
          <button class="add-btn" id="sk-rapide-fin" style="width:100%">← Retour à la liste</button>
        </div>
      </div>
    `;
    document.getElementById("sk-rapide-fin").addEventListener("click", () => { ui.rapide = false; render(); });
    return;
  }

  const p = liste[ui.rapideIndex];
  const cible = p.stockCible ?? 0;
  const min = p.stockMin ?? 0;

  mountedContainer.innerHTML = `
    <div class="stack">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <button class="nav-btn" id="sk-rapide-quitter">✕ Quitter le mode rapide</button>
        <span class="hint">${ui.rapideIndex + 1} / ${liste.length}</span>
      </div>
      <div class="form-card" style="text-align:center;max-width:360px;margin:0 auto">
        ${p.photo?.itemId
          ? `<img data-resolve-photo="${esc(p.photo.itemId)}" alt="" style="width:120px;height:120px;object-fit:cover;border-radius:12px;border:1px solid var(--border);margin:0 auto 12px" onerror="this.style.display='none'">`
          : p.photo?.url
          ? `<img src="${esc(p.photo.url)}" alt="" style="width:120px;height:120px;object-fit:cover;border-radius:12px;border:1px solid var(--border);margin:0 auto 12px" onerror="this.style.display='none'">`
          : `<div style="width:120px;height:120px;border-radius:12px;background:var(--panel-alt);display:flex;align-items:center;justify-content:center;font-size:40px;margin:0 auto 12px">📦</div>`}
        <h3 style="margin:0 0 2px;font-size:17px">${esc(p.nom)}</h3>
        <p class="hint" style="margin:0 0 16px">${esc(p.categorie || "")} · Dernier stock : ${p.stockActuel ?? 0} ${esc(p.unite || '')}</p>

        <p style="font-size:12px;color:var(--text-dim);margin:0 0 8px">Quantité comptée</p>
        <div style="display:flex;align-items:center;justify-content:center;gap:14px;margin-bottom:14px">
          <button id="sk-r-moins" style="width:52px;height:52px;border-radius:50%;border:1px solid var(--border);background:var(--panel-alt);color:var(--text);font-size:26px;cursor:pointer">−</button>
          <input id="sk-r-qte" type="number" min="0" value="${p.stockActuel ?? 0}" style="font-size:32px;font-weight:700;width:110px;text-align:center;background:transparent;border:none;border-bottom:2px solid var(--border);padding:4px">
          <button id="sk-r-plus" style="width:52px;height:52px;border-radius:50%;border:1px solid var(--border);background:var(--panel-alt);color:var(--text);font-size:26px;cursor:pointer">+</button>
        </div>

        <button class="add-btn" id="sk-r-valider" style="width:100%;font-size:15px;padding:14px">✓ Valider et suivant →</button>
        <button class="nav-btn" id="sk-r-passer" style="width:100%;margin-top:8px">Passer sans modifier</button>
        <div id="sk-r-status" style="font-size:12px;margin-top:10px"></div>
      </div>
    </div>
  `;

  const photoEl = mountedContainer.querySelector("[data-resolve-photo]");
  if (photoEl) {
    getImageDisplayUrl(photoEl.dataset.resolvePhoto).then(url => { photoEl.src = url; }).catch(() => { photoEl.style.display = "none"; });
  }

  const qteInput = document.getElementById("sk-r-qte");
  document.getElementById("sk-r-moins").addEventListener("click", () => { qteInput.value = Math.max(0, (parseInt(qteInput.value, 10) || 0) - 1); });
  document.getElementById("sk-r-plus").addEventListener("click", () => { qteInput.value = (parseInt(qteInput.value, 10) || 0) + 1; });
  document.getElementById("sk-rapide-quitter").addEventListener("click", () => { ui.rapide = false; render(); });
  document.getElementById("sk-r-passer").addEventListener("click", () => { ui.rapideIndex++; render(); });
  document.getElementById("sk-r-valider").addEventListener("click", async () => {
    const statusEl = document.getElementById("sk-r-status");
    const nouvelle = parseInt(qteInput.value, 10);
    if (isNaN(nouvelle) || nouvelle < 0) { statusEl.innerHTML = `<span style="color:var(--red)">Quantité invalide.</span>`; return; }
    try {
      await enregistrerInventaire(p.id, p.stockActuel ?? 0, nouvelle, mountedUser?.uid || null);
      ui.rapideIndex++;
      render();
    } catch (e) {
      statusEl.innerHTML = `<span style="color:var(--red)">❌ ${esc(e.message || String(e))}</span>`;
    }
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

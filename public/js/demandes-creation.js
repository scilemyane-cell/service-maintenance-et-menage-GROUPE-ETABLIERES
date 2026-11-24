// demandes-creation.js — Nouvelle demande saisie directement dans l'appli
// (technicien sur le terrain, superviseur…). Numérotée « SMM-001 »… pour ne
// pas entrer en conflit avec les N° du fichier Excel ; envoyée au fichier
// via le fichier des mises à jour (liste « nouvelles », ajoutées par le
// flux Power Automate n° 2).
import { db } from "./firebase-init.js";
import { doc, collection, runTransaction, serverTimestamp } from "./firestore-compte.js";
import { esc } from "./astreinte-logic.js";

const URGENCES = ["Normal", "Urgent", "À planifier", "Critique"];
const aujourdhui = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

export async function creerDemande(champs, refNouvelle = doc(collection(db, "demandes"))) {
  const refCompteur = doc(db, "config", "compteur-demandes-app");
  return runTransaction(db, async (tx) => {
    const s = await tx.get(refCompteur);
    const n = (s.exists() ? (s.data().dernier || 0) : 0) + 1;
    const numero = `SMM-${String(n).padStart(3, "0")}`;
    tx.set(refCompteur, { dernier: n }, { merge: true });
    tx.set(refNouvelle, { ...champs, numero, creeDansApp: true, importeLe: serverTimestamp(), dateMaj: serverTimestamp() });
    return numero;
  });
}

// lignes : demandes déjà connues (pour proposer sites, associations, types).
export function ouvrirNouvelleDemande({ lignes = [], siteDefaut = "", utilisateur = "", onCree = () => {} }) {
  const sites = {}; lignes.forEach(l => { if (l.site && l.site !== "Non renseigné") sites[l.site] = sites[l.site] || l.association; });
  const nomsSites = Object.keys(sites).sort((a, b) => a.localeCompare(b, "fr"));
  const types = [...new Set(lignes.map(l => l.type).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr"));
  const fond = document.createElement("div");
  fond.className = "ndm-fond";
  fond.innerHTML = `
  <form class="ndm" autocomplete="off">
    <div class="ndm-tete"><h3>➕ Nouvelle demande</h3><button type="button" class="ndm-x" data-fermer aria-label="Fermer">✕</button></div>
    <label>Site<select name="siteChoix" required>
      <option value="">— Choisis le site —</option>
      ${["Agropolis", "École", "Armonia", "Autres"].map(as => { const l = nomsSites.filter(n => (sites[n] || "Autres") === as); return l.length ? `<optgroup label="${as}">${l.map(n => `<option value="${esc(n)}" ${n === siteDefaut ? "selected" : ""}>${esc(n)}</option>`).join("")}</optgroup>` : ""; }).join("")}
      ${siteDefaut && !nomsSites.includes(siteDefaut) ? `<option value="${esc(siteDefaut)}" selected>${esc(siteDefaut)}</option>` : ""}
      <option value="__autre">✏️ Autre site (le taper)…</option>
    </select></label>
    <label class="ndm-autre-site" style="display:none">Nom du site<input name="siteAutre" placeholder="Tape le nom du site"></label>
    <label class="ndm-bat-cam" style="display:none">Bâtiment<select name="camBatiment"></select></label>
    <input type="hidden" name="site" value="${esc(siteDefaut)}">
    <div class="ndm-2">
      <label>Association<select name="association">${["Agropolis", "École", "Armonia", "Autres"].map(a => `<option ${a === (sites[siteDefaut] || "") ? "selected" : ""}>${a}</option>`).join("")}</select></label>
      <label>Local / pièce<input name="local" placeholder="ex. CH 301, Internat…"></label>
    </div>
    <div class="ndm-2">
      <label>Type<input name="type" list="ndm-types" placeholder="ex. Plomberie"><datalist id="ndm-types">${types.map(t => `<option value="${esc(t)}">`).join("")}</datalist></label>
      <label>Urgence<select name="urgence">${URGENCES.map(u => `<option>${u}</option>`).join("")}</select></label>
    </div>
    <label>Descriptif<textarea spellcheck="true" lang="fr" name="descriptif" rows="3" required placeholder="Ce qui ne va pas, où, depuis quand…"></textarea><button type="button" class="dps-ia dps-ia-mini" data-ndm-ia>✨ Mettre au propre</button></label>
    <div class="ndm-2">
      <label>Demandeur<input name="demandeur" value="${esc(utilisateur)}"></label>
      <label>Logement occupé<select name="logementOccupe"><option value="">—</option><option>OUI</option><option>NON</option></select></label>
    </div>
    <div class="ndm-photos"><div class="ndm-photo-btns"><label class="ndm-photo-btn">📸 Prendre une photo<input type="file" accept="image/*" capture="environment" data-ndm-photos hidden></label><label class="ndm-photo-btn">🖼️ Choisir des photos<input type="file" accept="image/*" multiple data-ndm-photos hidden></label></div><div class="ndm-vignettes" data-ndm-vign></div></div>
    ${location.pathname.startsWith("/beta/") && window.__smmRole === "super_admin" ? `<label class="ndm-camileia" style="display:flex;gap:6px;align-items:center"><input type="checkbox" name="envoyerCamileia" checked> 📤 Envoyer aussi dans Camileia (GMAO) — test</label>` : ""}
    <div class="ndm-etat" aria-live="polite"></div>
    <div class="ndm-btns"><button type="button" class="dps-annuler" data-fermer>Annuler</button><button type="submit" class="dps-enregistrer">➕ Créer la demande</button></div>
  </form>`;
  document.body.appendChild(fond);
  const f = fond.querySelector("form"), etat = fond.querySelector(".ndm-etat");
  const fermer = () => fond.remove();
  fond.querySelectorAll("[data-fermer]").forEach(b => b.addEventListener("click", fermer));
  fond.addEventListener("click", (e) => { if (e.target === fond) fermer(); });
  const majSite = () => {
    const autre = f.siteChoix.value === "__autre";
    fond.querySelector(".ndm-autre-site").style.display = autre ? "" : "none";
    if (f.siteChoix.value.startsWith("cam:")) return;
    f.site.value = autre ? f.siteAutre.value.trim() : f.siteChoix.value;
    const a = sites[f.site.value]; if (a) f.association.value = a;
  };
  f.siteChoix.addEventListener("change", () => { majSite(); if (f.siteChoix.value === "__autre") f.siteAutre.focus(); });
  f.siteAutre.addEventListener("input", majSite);
  // Version test : liste des sites identique à Camileia (GMAO), puis bâtiment.
  // La demande garde dans l'appli le nom de site relié (correspondance des sites),
  // pour que l'attribution aux techniciens par site continue de marcher.
  let camLieux = null;
  if (location.pathname.startsWith("/beta/") && window.__smmRole === "super_admin") (async () => {
    try {
      const cam = await import("./camileia.js");
      await cam.chargerRelaisPartage(); if (!cam.estConnecte()) return;
      const { lireCorrespSites } = await import("./camileia-envoi.js");
      // Sites et bâtiments Camileia gardés 24 h sur l'appareil (liste immédiate à l'ouverture).
      let lieux = null; try { lieux = JSON.parse(localStorage.getItem("camileia-sites-bats") || "null"); } catch { /* */ }
      if (!lieux || Date.now() - lieux.le > 24 * 3600 * 1000) {
        const [s1, b1] = await Promise.all([cam.lireTout(`${cam.RACINE}/sites`, { maxPages: 2 }), cam.lireTout(`${cam.RACINE}/batiments`, { maxPages: 2 })]);
        lieux = { le: Date.now(), sites: s1.map(x => ({ id: x.id, libelle: x.libelle, code: x.code, actif: x.actif })), bats: b1.map(x => ({ id: x.id, libelle: x.libelle, site: x.site, actif: x.actif })) };
        try { localStorage.setItem("camileia-sites-bats", JSON.stringify(lieux)); } catch { /* */ }
      }
      const [sitesC, batsC, corr] = [lieux.sites, lieux.bats, await lireCorrespSites()];
      const actifs = sitesC.filter(x => x.actif !== false);
      if (!actifs.length) return;
      camLieux = { sites: actifs, bats: batsC.filter(b => b.actif !== false), corr: corr.sites || {} };
      const iriS = (x) => `${cam.RACINE}/sites/${x.id}`, iriB = (x) => `${cam.RACINE}/batiments/${x.id}`;
      // Site de l'appli → site Camileia (pour présélectionner)
      const defaut = siteDefaut && camLieux.corr[siteDefaut];
      f.siteChoix.innerHTML = `<option value="">— Choisis le site —</option>${actifs.map(x => `<option value="cam:${x.id}" ${defaut?.site === iriS(x) ? "selected" : ""}>${esc(x.libelle)}</option>`).join("")}<option value="__autre">✏️ Autre site (le taper)…</option>`;
      const majBats = () => {
        const id = f.siteChoix.value.startsWith("cam:") ? f.siteChoix.value.slice(4) : "";
        const liste = id ? camLieux.bats.filter(b => String(b.site).endsWith(`/sites/${id}`)) : [];
        const zone = fond.querySelector(".ndm-bat-cam");
        zone.style.display = liste.length ? "" : "none";
        f.camBatiment.innerHTML = liste.map(b => `<option value="${b.id}" ${defaut?.batiment === iriB(b) ? "selected" : ""}>${esc(b.libelle)}</option>`).join("");
        majSiteCam();
      };
      const majSiteCam = () => {
        const v = f.siteChoix.value; if (!v.startsWith("cam:")) return;
        const sIri = `${cam.RACINE}/sites/${v.slice(4)}`, bIri = f.camBatiment.value ? `${cam.RACINE}/batiments/${f.camBatiment.value}` : "";
        const lib = actifs.find(x => iriS(x) === sIri)?.libelle || "";
        // Nom de site de l'appli relié à ce site + bâtiment (sinon à ce site, sinon le nom Camileia).
        // D'abord les noms de site réellement utilisés dans l'appli (ex. « Lycée » plutôt que « Lycee »).
        const tous = Object.entries(camLieux.corr);
        const noms = [...tous.filter(([n]) => n in sites), ...tous.filter(([n]) => !(n in sites))];
        const meme = (n) => n.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
        const relie = noms.find(([n, m]) => m?.site === sIri && meme(n) === meme(lib)) || noms.find(([, m]) => m?.site === sIri && m?.batiment === bIri) || noms.find(([, m]) => m?.site === sIri);
        f.site.value = relie ? relie[0] : lib;
        const a = sites[f.site.value]; if (a) f.association.value = a;
      };
      f.siteChoix.addEventListener("change", majBats);
      f.camBatiment.addEventListener("change", majSiteCam);
      majBats();
    } catch (er) { console.warn("Sites Camileia :", er); }
  })();
  // Photos : compressées tout de suite (aperçu), envoyées après la création de la demande.
  const photos = [];
  const dessinerVign = () => { const z = fond.querySelector("[data-ndm-vign]"); z.innerHTML = photos.map((p, i) => `<span class="ndm-vign"><img src="${p}" alt=""><button type="button" data-ndm-retirer="${i}" aria-label="Retirer">✕</button></span>`).join("");
    z.querySelectorAll("[data-ndm-retirer]").forEach(b => b.onclick = () => { photos.splice(+b.dataset.ndmRetirer, 1); dessinerVign(); }); };
  fond.querySelectorAll("[data-ndm-photos]").forEach(inp => inp.addEventListener("change", async (e) => {
    const { compresserImage } = await import("./demandes-photos.js");
    for (const fi of [...e.target.files].slice(0, 6 - photos.length)) { try { photos.push(await compresserImage(fi)); } catch { /* image illisible */ } }
    e.target.value = ""; dessinerVign();
  }));
  fond.querySelector("[data-ndm-ia]").addEventListener("click", async (e) => {
    const t = f.descriptif.value.trim(); if (!t) { f.descriptif.focus(); return; }
    const b = e.currentTarget; b.disabled = true; const avant = b.textContent; b.textContent = "⏳ IA…";
    try { const { redigerDescriptifDemande } = await import("./ia.js"); const r = (await redigerDescriptifDemande({ notes: t })).replace(/\*\*/g, "").trim(); const { proposerIA } = await import("./ia-suggestion.js"); if (r) proposerIA(b, r, (v) => { f.descriptif.value = v; }); }
    catch (err) { import("./ia-suggestion.js").then(m => m.signalerErreurIA(err)); }
    finally { b.disabled = false; b.textContent = avant; }
  });
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    majSite();
    const v = Object.fromEntries(new FormData(f).entries());
    if (!v.site.trim()) { etat.textContent = "Choisis le site."; (f.siteChoix.value === "__autre" ? f.siteAutre : f.siteChoix).focus(); return; }
    if (!v.descriptif.trim()) return;
    const bouton = f.querySelector('[type="submit"]'); bouton.disabled = true; etat.textContent = "⏳ Création…";
    // Version de test + « Envoyer dans Camileia » : la demande ne va QUE dans Camileia. Elle revient
    // dans l'appli comme ticket Camileia (visible seulement dans la version de test), jamais dans les
    // demandes de l'Excel / de la version validée — pour ne pas mélanger tant que c'est en test.
    if (v.envoyerCamileia) {
      try {
        etat.textContent = "⏳ Envoi dans Camileia…";
        const { envoyerDemande } = await import("./camileia-envoi.js");
        const { auth } = await import("./firebase-init.js");
        const camChoix = f.siteChoix.value.startsWith("cam:") ? { camSite: f.siteChoix.value.slice(4), camBatiment: f.camBatiment.value || "", camSiteCode: camLieux?.sites.find(x => String(x.id) === f.siteChoix.value.slice(4))?.code || "" } : {};
        const di = await envoyerDemande({ ...v, ...camChoix, site: v.site.trim(), numero: "" }, { email: auth.currentUser?.email || "" });
        if (photos.length && di?.id != null) {
          etat.textContent = "⏳ Envoi des photos…";
          const { ajouterPhotoDemande } = await import("./demandes-photos.js");
          for (const p of photos) { try { await ajouterPhotoDemande(`cam-${di.id}`, p, utilisateur); } catch (er) { console.warn("Photo demande :", er); } }
        }
        try { (await import("./camileia-synchro.js")).lancerMaintenant(); } catch { /* la synchro suivante la reprendra */ }
        window.toast?.(`✓ Demande envoyée dans Camileia (${di?.numero || di?.id}) — elle arrive dans le suivi (version test) dans un instant.`);
        fermer(); onCree(di?.numero || "", v.site.trim());
      } catch (err) { console.error(err); etat.textContent = "❌ Camileia : " + (err?.message || err); bouton.disabled = false; }
      return;
    }
    try {
      const ref = doc(collection(db, "demandes"));
      const numero = await creerDemande({
        dateDemande: aujourdhui(), site: v.site.trim(), association: v.association, local: v.local.trim(), type: v.type.trim(),
        urgence: v.urgence, descriptif: v.descriptif.trim(), demandeur: v.demandeur.trim(), logementOccupe: v.logementOccupe,
        statut: "Pris en compte", dateStatut: aujourdhui(), creePar: utilisateur, ...(photos.length ? { nbPhotos: photos.length } : {}),
      }, ref);
      if (photos.length) {
        etat.textContent = "⏳ Envoi des photos…";
        const { ajouterPhotoDemande } = await import("./demandes-photos.js");
        let ko = 0; for (const p of photos) { try { await ajouterPhotoDemande(ref.id, p, utilisateur); } catch (er) { ko++; console.warn("Photo demande :", er); } }
        if (ko) window.toast?.(`⚠️ ${ko} photo(s) non envoyée(s)`, "error");
      }
      const enTest = location.pathname.startsWith("/beta/");
      window.toast?.(`✓ Demande ${numero} créée${enTest ? " dans l'Excel (visible dans la version validée — la version test n'affiche que Camileia)" : ""}.`);
      fermer(); onCree(numero, v.site.trim());
    } catch (err) { console.error(err); etat.textContent = "❌ " + (err?.message || err); bouton.disabled = false; }
  });
  setTimeout(() => (siteDefaut ? f.descriptif : f.siteChoix).focus(), 50);
}

// vue-aerienne.js — Vue aérienne « poste de surveillance » d'un site, avec ses compteurs pointés.
// Fond : orthophotos IGN (Géoplateforme, très haute résolution en France), satellite Esri ou plan.
// Chaque compteur a une position { geo: { lat, lng } } posée par l'encadrement (« Pointer »).
import { esc } from "./astreinte-logic.js";
import { chargerLeaflet } from "./site-map.js";
import { saveDossierGeo, watchSitesDossiers } from "./site-dossier-data.js";
import { modifierCompteur } from "./compteurs-data.js";
import { suivreMaPosition } from "./ma-position.js";
let moi = null;

const FONDS = {
  ign: { lib: "IGN HR", url: "https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg", attr: "© IGN Géoplateforme", max: 19 },
  plan: { lib: "PLAN", url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", attr: "© OpenStreetMap", max: 19 },
};
const TYPE_LIB = { eau: "Eau", gaz: "Gaz", chauffage: "Chauffage", elec: "Électricité" };
const TYPES = { eau: { c: "#38bdf8", i: "💧", l: "EAU" }, gaz: { c: "#fb923c", i: "🔥", l: "GAZ" }, chauffage: { c: "#f472b6", i: "🌡️", l: "CHAUF." }, elec: { c: "#facc15", i: "⚡", l: "ÉLEC" } };
const CLE_FOND = "etablieres-va-fond";

let ov = null, map = null, fond = null, marqueurs = {}, horloge = null, st = null;

const dms = (v, pos, neg) => { const a = Math.abs(v), d = Math.floor(a), m = Math.floor((a - d) * 60), s = ((a - d - m / 60) * 3600).toFixed(1); return `${d}°${String(m).padStart(2, "0")}'${s.padStart(4, "0")}"${v >= 0 ? pos : neg}`; };
const refSite = (nom) => "SITE-" + String(nom || "").normalize("NFD").replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 6).padEnd(3, "X");
const fmtD = (ms) => ms ? new Date(ms).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "—";

function etat(c) {
  const P = st?.pro;
  if (c.frequence === "demande" && !c.campagneLe) return { k: "veille", l: P ? "Sur demande" : "EN VEILLE" };
  if (st.estEnRetard(c)) return { k: "alerte", l: c.dernierReleve ? (P ? "À relever" : "À RELEVER") : (P ? "Jamais relevé" : "JAMAIS RELEVÉ") };
  return { k: "ok", l: P ? "À jour" : "NOMINAL" };
}
const CLE_STYLE = "etablieres-va-style";
const T = (tactique, pro) => st?.pro ? pro : tactique;

export async function ouvrirVueAerienne({ site, compteurs, user, estEnRetard, peutPointer, onFiche, onFermer }) {
  fermer();
  // Techniciens (et tous ceux qui ne pointent pas) : présentation sobre « pro ». Encadrement : au choix.
  const pro = true; // présentation « pro » pour tout le monde
  st = { site, compteurs, pro, onFermer, user, estEnRetard, peutPointer, onFiche, pointage: null, filtre: "", geoSite: null, placerSite: false };
  ov = document.createElement("div");
  ov.className = "va" + (pro ? " pro" : "");
  ov.innerHTML = pro ? `<div class="va-boot"><div class="va-boot-l">Chargement du plan…</div><div class="va-boot-b"><i></i></div></div>` : `<div class="va-boot"><div class="va-boot-l">INITIALISATION DU FLUX AÉRIEN<span>…</span></div><div class="va-boot-b"><i></i></div><small>${esc(refSite(site.nom))} · CANAL SÉCURISÉ</small></div>`;
  document.body.appendChild(ov); document.documentElement.classList.add("va-ouvert");
  document.addEventListener("keydown", echap);
  try { await chargerLeaflet(); } catch { ov.innerHTML = `<div class="va-boot"><div class="va-boot-l">⚠ CARTE INDISPONIBLE (réseau)</div><button class="va-btn" data-va-fermer>Fermer</button></div>`; ov.querySelector("[data-va-fermer]").onclick = fermer; return; }
  const dossier = await new Promise((ok) => { let u = null, fini = false; u = watchSitesDossiers((l) => { if (fini) return; fini = true; setTimeout(() => u && u(), 0); ok((l || []).find(d => d.id === site.id) || null); }); setTimeout(() => { if (!fini) { fini = true; ok(null); } }, 5000); });
  st.geoSite = dossier?.geo?.lat ? dossier.geo : null;
  construire();
}

function construire() {
  const L = window.L;
  if (map) { try { map.remove(); } catch { /* */ } map = null; fond = null; marqueurs = {}; }
  clearInterval(horloge);
  ov.innerHTML = `
  <div class="va-hud-top">
    ${st.pro ? `<div class="va-id"><span class="va-pro-ico">📍</span><div><small>Plan des compteurs</small><span>${esc(st.site.nom)}</span></div></div>`
      : `<div class="va-id"><span class="va-rec">●</span><b>VUE AÉRIENNE</b><i>//</i><span>${esc(st.site.nom)}</span><em>${esc(refSite(st.site.nom))}</em></div>`}
    <div class="va-tel">${st.pro ? "" : `<span data-va-coord>— — —</span><span data-va-zoom></span><span data-va-heure></span>`}
      <button class="va-btn va-x" data-va-fermer title="Fermer (Échap)">✕</button></div>
  </div>
  <div class="va-corps">
    <aside class="va-panneau">
      <div class="va-kpis" data-va-kpis></div>
      <div class="va-filtres" data-va-filtres></div>
      <div class="va-liste" data-va-liste></div>
      ${st.pro ? `<div class="va-legende"><span><i class="alerte"></i>À relever</span><span><i class="ok"></i>À jour</span><span><i class="veille"></i>Sur demande</span></div>` : ""}
      ${st.peutPointer ? `<div class="va-aide">📍 <b>Pointer</b> un compteur puis touche la carte à son emplacement exact. Touche un repère pour le déplacer ou le retirer.</div>` : ""}
    </aside>
    <div class="va-carte-zone">
      <div class="va-carte" data-va-carte></div>
      <div class="va-grille"></div><div class="va-scan"></div><div class="va-vignette"></div>
      <div class="va-coin tl"></div><div class="va-coin tr"></div><div class="va-coin bl"></div><div class="va-coin br"></div>
      <div class="va-mire" data-va-mire><i></i><i></i><b></b></div>
      <div class="va-bandeau" data-va-bandeau hidden></div>
      <div class="va-fonds">${Object.entries(FONDS).map(([k, f]) => `<button class="va-btn" data-va-fond="${k}">${f.lib}</button>`).join("")}</div>
      ${st.pro ? "" : `<div class="va-boussole"><svg viewBox="0 0 60 60"><circle cx="30" cy="30" r="27"/><path d="M30 6 L35 30 L30 26 L25 30 Z" class="n"/><path d="M30 54 L35 30 L30 34 L25 30 Z"/><text x="30" y="5">N</text></svg></div>`}
      <div class="va-actions">
        <button class="va-btn" data-va-moi title="Ma position">◉ Moi</button>
        <button class="va-btn" data-va-centrer title="Recentrer sur le site">${T("⌖ SITE", "⌖ Recentrer")}</button>
        ${st.peutPointer ? `<button class="va-btn" data-va-placer-site title="Placer le centre du site">${T("◎ POSITION SITE", "◎ Position du site")}</button>` : ""}
      </div>
    </div>
  </div>`;
  ov.querySelector("[data-va-fermer]").onclick = fermer;
  ov.querySelector("[data-va-style]")?.addEventListener("click", () => { st.pro = !st.pro; try { localStorage.setItem(CLE_STYLE, st.pro ? "pro" : "tactique"); } catch { /* */ } ov.classList.toggle("pro", st.pro); construire(); });
  const centre = st.geoSite ? [st.geoSite.lat, st.geoSite.lng] : [46.8, -1.4];
  map = L.map(ov.querySelector("[data-va-carte]"), { zoomControl: false, attributionControl: true, maxZoom: 21, zoomSnap: 0.5 }).setView(centre, st.geoSite ? 18 : 9);
  L.control.zoom({ position: "bottomright" }).addTo(map);
  L.control.scale({ metric: true, imperial: false, position: "bottomleft" }).addTo(map);
  let f = "ign"; try { f = localStorage.getItem(CLE_FOND) || "ign"; } catch { /* */ }
  choisirFond(FONDS[f] ? f : "ign");
  // Zone du site : cercle de périmètre + balayage radar
  if (st.geoSite && !st.pro) {
    L.circle(centre, { radius: 120, className: "va-perimetre", interactive: false }).addTo(map);
    L.marker(centre, { interactive: false, icon: L.divIcon({ className: "", html: `<div class="va-radar"><i></i></div>`, iconSize: [0, 0] }) }).addTo(map);
  } else if (!st.geoSite) bandeau(st.peutPointer ? T("POSITION DU SITE INCONNUE — utilise « ◎ POSITION SITE » puis touche la carte", "Position du site inconnue : clique sur « ◎ Position du site » puis touche la carte") : T("POSITION DU SITE INCONNUE — à placer par un responsable", "Position du site pas encore renseignée"), "warn");
  map.on("mousemove", (e) => { const el = ov?.querySelector("[data-va-coord]"); if (el) el.textContent = `${dms(e.latlng.lat, "N", "S")}  ${dms(e.latlng.lng, "E", "O")}`; });
  map.on("zoomend", majZoom); majZoom();
  map.on("click", clicCarte);
  ov.querySelectorAll("[data-va-fond]").forEach(b => b.onclick = () => choisirFond(b.dataset.vaFond));
  ov.querySelector("[data-va-centrer]").onclick = () => { const g = Object.values(marqueurs); if (g.length) map.flyToBounds(window.L.featureGroup(g).getBounds().pad(0.4), { maxZoom: 19, duration: 0.8 }); else if (st.geoSite) map.flyTo([st.geoSite.lat, st.geoSite.lng], 18, { duration: 0.8 }); };
  ov.querySelector("[data-va-placer-site]")?.addEventListener("click", () => { st.placerSite = !st.placerSite; st.pointage = null; modePointage(); });
  moi?.arreter(); moi = suivreMaPosition(map, { bouton: ov.querySelector("[data-va-moi]") });
  ov.querySelector("[data-va-moi]").onclick = () => { if (!moi.aller()) window.toast?.("Position en cours de recherche… (à l'intérieur d'un bâtiment, le GPS peut mettre un peu de temps)"); };
  horloge = setInterval(tic, 1000); tic();
  dessinerMarqueurs(); panneau();
  const g = Object.values(marqueurs);
  if (g.length) map.fitBounds(window.L.featureGroup(g).getBounds().pad(0.4), { maxZoom: 19 });
  setTimeout(() => map?.invalidateSize(), 50);
}

function choisirFond(k) {
  if (fond) map.removeLayer(fond);
  const f = FONDS[k];
  fond = window.L.tileLayer(f.url, { attribution: f.attr, maxNativeZoom: f.max, maxZoom: 21, subdomains: "abc", crossOrigin: true }).addTo(map);
  try { localStorage.setItem(CLE_FOND, k); } catch { /* */ }
  ov.querySelectorAll("[data-va-fond]").forEach(b => b.classList.toggle("on", b.dataset.vaFond === k));
  ov.querySelector(".va-carte-zone")?.classList.toggle("va-plan", k === "plan");
}
function majZoom() { const z = map.getZoom(), el = ov?.querySelector("[data-va-zoom]"); if (el) el.textContent = `ALT ≈ ${Math.round(40075016 * Math.cos((map.getCenter().lat * Math.PI) / 180) / Math.pow(2, z) * 1.6)} M · Z${z}`; ov?.classList.toggle("va-proche", z >= 18.5); ov?.classList.toggle("va-loin", z < 18); }
function tic() { const el = ov?.querySelector("[data-va-heure]"); if (el) el.textContent = new Date().toLocaleTimeString("fr-FR") + " LOC"; }
function bandeau(txt, cls = "") { const b = ov?.querySelector("[data-va-bandeau]"); if (!b) return; b.hidden = !txt; b.className = "va-bandeau " + cls; b.textContent = txt || ""; }

function iconeCompteur(c) {
  const t = TYPES[c.type] || TYPES.eau, e = etat(c);
  if (st.pro) return window.L.divIcon({ className: "", iconSize: [0, 0], html: `<div class="va-p ${e.k}" style="--c:${t.c}"><span class="va-p-pin"><span>${t.i}</span></span><span class="va-p-etat"></span><span class="va-p-tag">${esc(c.nom || "")}</span></div>` });
  return window.L.divIcon({ className: "", iconSize: [0, 0], html: `<div class="va-m ${e.k}" style="--c:${t.c}"><span class="va-m-pulse"></span><span class="va-m-c"><span class="va-m-e">${t.i}</span></span><span class="va-m-tag"><b>${esc(c.nom || "")}</b><i>${t.l} · ${e.l}</i></span></div>` });
}
function dessinerMarqueurs() {
  Object.values(marqueurs).forEach(m => map.removeLayer(m)); marqueurs = {};
  st.compteurs.filter(c => c.geo?.lat).forEach(c => {
    const m = window.L.marker([c.geo.lat, c.geo.lng], { icon: iconeCompteur(c), draggable: false, riseOnHover: true }).addTo(map);
    m.on("click", () => carte(c, m));
    m.on("dragend", async () => { const p = m.getLatLng(); await sauverGeo(c, { lat: +p.lat.toFixed(7), lng: +p.lng.toFixed(7) }); m.dragging.disable(); bandeau(""); });
    marqueurs[c.id] = m;
  });
}
function carte(c, m) {
  const t = TYPES[c.type] || TYPES.eau, e = etat(c), d = c.dernierReleve;
  const pop = window.L.popup({ className: "va-pop" + (st.pro ? " pro" : ""), closeButton: true, offset: [0, -14], maxWidth: 300 }).setLatLng(m.getLatLng()).setContent(`
    <div class="va-fiche" style="--c:${t.c}">
      <div class="va-fiche-t"><span>${t.i} ${T(t.l, TYPE_LIB[c.type] || t.l)}</span><em class="${e.k}">${e.l}</em></div>
      <h4>${esc(c.nom || "")}</h4>
      ${c.emplacement ? `<p>⌁ ${esc(c.emplacement)}</p>` : ""}
      <dl><dt>${T("DERNIER RELEVÉ", "Dernier relevé")}</dt><dd>${fmtD(d?.at)}${d?.releveParNom ? ` · ${esc(d.releveParNom)}` : ""}</dd>
      ${c.pdl ? `<dt>${T("PDL", "PDL")}</dt><dd>${esc(c.pdl)}</dd>` : ""}
      ${st.pro ? "" : `<dt>POSITION</dt><dd>${c.geo.lat.toFixed(6)}, ${c.geo.lng.toFixed(6)}</dd>`}</dl>
      <div class="va-fiche-b">
        <button class="va-btn plein" data-va-fiche="${c.id}">${T("📝 RELEVER / FICHE", "📝 Relever / fiche")}</button>
        <a class="va-btn" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${c.geo.lat},${c.geo.lng}">${T("➤ ITINÉRAIRE", "➤ Itinéraire")}</a>
        ${st.peutPointer ? `<button class="va-btn" data-va-deplacer="${c.id}">${T("✥ DÉPLACER", "✥ Déplacer")}</button><button class="va-btn danger" data-va-retirer="${c.id}">${T("⌫ RETIRER", "⌫ Retirer")}</button>` : ""}
      </div>
    </div>`).openOn(map);
  const el = pop.getElement();
  el.querySelector("[data-va-fiche]").onclick = () => { const cb = st.onFiche, id = c.id; fermer(); cb?.(id); };
  el.querySelector("[data-va-deplacer]")?.addEventListener("click", () => { map.closePopup(); m.dragging.enable(); bandeau(T("DÉPLACEMENT — fais glisser le repère puis relâche", "Fais glisser le repère puis relâche"), "info"); });
  el.querySelector("[data-va-retirer]")?.addEventListener("click", async () => { map.closePopup(); await sauverGeo(c, null); });
}

async function sauverGeo(c, geo) {
  // Mise à jour immédiate (la liste des compteurs de l'onglet est modifiée aussi), envoi au serveur en arrière-plan :
  // la position reste affichée même si le réseau est lent, et elle est retrouvée en rouvrant la vue.
  const avant = c.geo || null;
  const envoi = modifierCompteur(c.id, { geo: geo || null, geoLe: Date.now(), geoPar: st.user?.nom || st.user?.email || "" });
  c.geo = geo;
  dessinerMarqueurs(); panneau();
  if (geo) { const m = marqueurs[c.id]; m?.getElement()?.querySelector(".va-m, .va-p")?.classList.add("verrou"); window.toast?.(st.pro ? `📍 ${c.nom} : position enregistrée` : `◉ ${c.nom} — position verrouillée`); }
  try { await envoi; }
  catch (e) { c.geo = avant; if (ov) { dessinerMarqueurs(); panneau(); } alert("Position non enregistrée : " + (e?.message || e)); }
}

async function clicCarte(e) {
  if (st.placerSite) {
    st.placerSite = false; modePointage();
    try { const geo = { lat: +e.latlng.lat.toFixed(6), lng: +e.latlng.lng.toFixed(6) }; await saveDossierGeo(st.site.id, geo); st.geoSite = geo; bandeau(""); window.toast?.("◎ Position du site enregistrée"); construire(); }
    catch (err) { alert("Enregistrement impossible : " + (err?.message || err)); }
    return;
  }
  if (!st.pointage) return;
  const c = st.compteurs.find(x => x.id === st.pointage); st.pointage = null; modePointage();
  if (c) await sauverGeo(c, { lat: +e.latlng.lat.toFixed(7), lng: +e.latlng.lng.toFixed(7) });
}
function modePointage() {
  const actif = !!st.pointage || st.placerSite;
  ov.classList.toggle("va-pointage", actif);
  const c = st.compteurs.find(x => x.id === st.pointage);
  bandeau(st.placerSite ? T("◎ ACQUISITION — touche la carte au centre du site", "Touche la carte au centre du site") : c ? T(`◉ ACQUISITION CIBLE — touche la carte à l'emplacement de « ${c.nom} »`, `Touche la carte à l'emplacement de « ${c.nom} »`) : "", "info");
  panneau();
}

function panneau() {
  const l = st.compteurs, q = st.filtre;
  const pos = l.filter(c => c.geo?.lat), al = l.filter(c => etat(c).k === "alerte").length;
  ov.querySelector("[data-va-kpis]").innerHTML = `<div><b>${l.length}</b><span>${T("COMPTEURS", "Compteurs")}</span></div><div><b>${pos.length}</b><span>${T("POINTÉS", "Sur le plan")}</span></div><div class="${al ? "al" : ""}"><b>${al}</b><span>${T("À RELEVER", "À relever")}</span></div>`;
  const types = [...new Set(l.map(c => c.type))];
  ov.querySelector("[data-va-filtres]").innerHTML = ["", ...types].map(t => `<button class="va-btn ${q === t ? "on" : ""}" data-va-type="${t}">${t ? (TYPES[t]?.i || "") + " " + T(TYPES[t]?.l || t, TYPE_LIB[t] || t) : T("TOUS", "Tous")}</button>`).join("");
  ov.querySelectorAll("[data-va-type]").forEach(b => b.onclick = () => { st.filtre = b.dataset.vaType; panneau(); });
  const vis = l.filter(c => !q || c.type === q).sort((a, b) => (!!a.geo?.lat - !!b.geo?.lat) || (etat(a).k === "alerte" ? -1 : 0) - (etat(b).k === "alerte" ? -1 : 0) || String(a.nom).localeCompare(String(b.nom), "fr", { numeric: true }));
  ov.querySelector("[data-va-liste]").innerHTML = vis.map(c => { const t = TYPES[c.type] || TYPES.eau, e = etat(c), p = !!c.geo?.lat;
    return `<div class="va-li ${e.k} ${st.pointage === c.id ? "cible" : ""}" style="--c:${t.c}">
      <button class="va-li-m" data-va-aller="${c.id}" ${p ? "" : "disabled"}><span class="va-li-i">${t.i}</span><span class="va-li-t"><b>${esc(c.nom || "")}</b><small>${e.l}${p ? "" : T(" · NON POINTÉ", " · pas sur le plan")}</small></span></button>
      ${st.peutPointer ? `<button class="va-btn ${st.pointage === c.id ? "on" : ""}" data-va-pointer="${c.id}">${p ? "⟲" : "📍"} ${st.pointage === c.id ? T("ANNULER", "Annuler") : p ? "" : T("POINTER", "Placer")}</button>` : ""}
    </div>`; }).join("") || `<p class="va-vide">Aucun compteur.</p>`;
  ov.querySelectorAll("[data-va-aller]").forEach(b => b.onclick = () => { const m = marqueurs[b.dataset.vaAller]; if (!m) return; map.flyTo(m.getLatLng(), Math.max(map.getZoom(), 19.5), { duration: 0.9 }); setTimeout(() => m.fire("click"), 950); });
  ov.querySelectorAll("[data-va-pointer]").forEach(b => b.onclick = () => { st.placerSite = false; st.pointage = st.pointage === b.dataset.vaPointer ? null : b.dataset.vaPointer; modePointage(); });
}

function echap(e) { if (e.key !== "Escape" || !ov) return; if (st?.pointage || st?.placerSite) { st.pointage = null; st.placerSite = false; modePointage(); } else fermer(); }
export function fermer() {
  clearInterval(horloge); horloge = null; moi?.arreter(); moi = null;
  try { map?.remove(); } catch { /* */ } map = null; fond = null; marqueurs = {};
  const cb = st?.onFermer;
  ov?.remove(); ov = null; document.documentElement.classList.remove("va-ouvert");
  if (cb) { st.onFermer = null; try { cb(); } catch { /* */ } }
  document.removeEventListener("keydown", echap);
}

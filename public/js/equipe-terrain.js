// equipe-terrain.js — Carte « Équipe sur le terrain » : dernière position des techniciens qui la partagent
// (voir geoloc-partage.js), avec le site le plus proche. Réservé à l'encadrement.
import { db } from "./firebase-init.js";
import { collection, onSnapshot } from "./firestore-compte.js";
import { esc } from "./astreinte-logic.js";
import { chargerLeaflet } from "./site-map.js";
import { watchSitesDossiers } from "./site-dossier-data.js";

const FONDS = {
  ign: { lib: "IGN HR", url: "https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg", attr: "© IGN Géoplateforme" },
  plan: { lib: "PLAN", url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", attr: "© OpenStreetMap" },
};
const RECENT = 15 * 60000, VIEUX = 12 * 3600000;
const COULEURS = ["#1f6feb", "#e8590c", "#2b8a3e", "#ae3ec9", "#c2255c", "#0c8599", "#5f3dc4", "#d9480f"];
let bloques = [];
let cont = null, map = null, fond = null, unsubs = [], positions = [], sites = [], marq = {}, timer = null, premierCadrage = true;

const couleur = (uid) => { let h = 0; for (const ch of String(uid)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return COULEURS[h % COULEURS.length]; };
const initiales = (n) => String(n || "?").trim().split(/\s+/).map(x => x[0]).join("").slice(0, 2).toUpperCase();
const prenom = (n) => { const p = String(n || "").trim().split(/\s+/); const x = p.find(m => m !== m.toUpperCase()) || p[0] || ""; return x.charAt(0).toUpperCase() + x.slice(1).toLowerCase(); };
const ilYa = (ms) => { const m = Math.floor((Date.now() - ms) / 60000); if (m < 1) return "à l'instant"; if (m < 60) return `il y a ${m} min`; const h = Math.floor(m / 60); return h < 24 ? `il y a ${h} h ${String(m % 60).padStart(2, "0")}` : `il y a ${Math.floor(h / 24)} j`; };
function dist(a, b) { const R = 6371e3, r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r; const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); }
function siteProche(p) { let best = null; sites.forEach(s => { const d = dist(p, s.geo); if (!best || d < best.d) best = { s, d }; }); return best; }
const libDist = (d) => d < 1000 ? `${Math.round(d / 10) * 10} m` : `${(d / 1000).toFixed(1).replace(".", ",")} km`;

export async function mountEquipeTerrain(container) {
  unsubs.forEach(f => { try { f(); } catch { /* */ } }); unsubs = []; clearInterval(timer);
  cont = container; premierCadrage = true; marq = {};
  cont.innerHTML = `<div class="et va pro">
    <div class="et-corps">
      <aside class="va-panneau et-panneau"><div class="va-kpis" data-et-kpis></div><div class="va-liste" data-et-liste></div>
        <div class="va-legende"><span><i class="ok"></i>Moins de 15 min</span><span><i class="veille"></i>Plus ancienne</span></div></aside>
      <div class="va-carte-zone et-carte-zone"><div class="va-carte" data-et-carte></div>
        <div class="va-fonds">${Object.entries(FONDS).map(([k, f]) => `<button class="va-btn" data-et-fond="${k}">${f.lib}</button>`).join("")}</div>
        <div class="va-actions"><button class="va-btn" data-et-tous>⌖ Voir tout le monde</button></div></div>
    </div></div>`;
  try { await chargerLeaflet(); } catch { cont.querySelector("[data-et-carte]").innerHTML = `<p class="hint" style="padding:20px">Carte indisponible (réseau).</p>`; return; }
  const L = window.L;
  map = L.map(cont.querySelector("[data-et-carte]"), { zoomControl: false, maxZoom: 20 }).setView([46.75, -1.6], 10);
  L.control.zoom({ position: "bottomright" }).addTo(map); L.control.scale({ metric: true, imperial: false, position: "bottomleft" }).addTo(map);
  choisirFond("plan");
  cont.querySelectorAll("[data-et-fond]").forEach(b => b.onclick = () => choisirFond(b.dataset.etFond));
  cont.querySelector("[data-et-tous]").onclick = () => cadrer(true);
  unsubs.push(watchSitesDossiers((l) => { sites = (l || []).filter(d => d.geo?.lat && !d.supprimeLe); dessinerSites(); rendre(); }));
  unsubs.push(onSnapshot(collection(db, "positions"), (s) => { const tous = s.docs.map(d => ({ uid: d.id, ...d.data() })); bloques = tous.filter(p => p.refus && !p.lat); positions = tous.filter(p => p.lat && !p.refus && Date.now() - (p.at || 0) < VIEUX); rendre(); },
    (e) => { cont.querySelector("[data-et-liste]").innerHTML = `<p class="hint" style="color:var(--red)">❌ ${esc(e.message)}<br>Publie la règle Firestore « positions ».</p>`; }));
  timer = setInterval(() => { if (!document.contains(cont)) { clearInterval(timer); unsubs.forEach(f => f()); unsubs = []; return; } rendre(); }, 30000);
  setTimeout(() => map?.invalidateSize(), 60);
}

function choisirFond(k) {
  if (fond) map.removeLayer(fond);
  fond = window.L.tileLayer(FONDS[k].url, { attribution: FONDS[k].attr, maxNativeZoom: 19, maxZoom: 20, subdomains: "abc" }).addTo(map);
  cont.querySelectorAll("[data-et-fond]").forEach(b => b.classList.toggle("on", b.dataset.etFond === k));
}
let calqueSites = null;
function dessinerSites() {
  if (!map) return; if (calqueSites) map.removeLayer(calqueSites);
  calqueSites = window.L.layerGroup(sites.map(s => window.L.marker([s.geo.lat, s.geo.lng], { interactive: true, icon: window.L.divIcon({ className: "", iconSize: [0, 0], html: `<div class="et-site" title="${esc(s.nom)}"></div>` }) }).bindTooltip(esc(s.nom), { direction: "top", offset: [0, -6] }))).addTo(map);
}
function cadrer(force) {
  const pts = Object.values(marq).map(m => m.getLatLng());
  if (!pts.length) return;
  if (force || premierCadrage) { premierCadrage = false; map.fitBounds(window.L.latLngBounds(pts).pad(0.3), { maxZoom: 17 }); }
}
function rendre() {
  if (!cont || !document.contains(cont) || !map) return;
  const L = window.L, recents = positions.filter(p => Date.now() - p.at < RECENT);
  cont.querySelector("[data-et-kpis]").innerHTML = `<div><b>${positions.length}</b><span>Positions</span></div><div><b>${recents.length}</b><span>Moins de 15 min</span></div><div><b>${sites.length}</b><span>Sites placés</span></div>`;
  const vus = new Set();
  positions.forEach(p => {
    vus.add(p.uid);
    const frais = Date.now() - p.at < RECENT, c = couleur(p.uid), pr = siteProche(p);
    const html = `<div class="et-pers ${frais ? "frais" : "vieux"}" style="--c:${c}"><span class="et-halo"></span><span class="et-av">${esc(initiales(p.nom))}</span><span class="et-nom">${esc(prenom(p.nom))}</span></div>`;
    const pop = `<div class="va-fiche"><div class="va-fiche-t"><span>👷 Technicien</span><em class="${frais ? "ok" : "veille"}">${ilYa(p.at)}</em></div><h4>${esc(p.nom)}</h4>
      ${pr ? `<p>${pr.d < 150 ? "Sur le site" : "Près de"} <b>${esc(pr.s.nom)}</b>${pr.d >= 150 ? ` (${libDist(pr.d)})` : ""}</p>` : ""}
      <dl><dt>Précision</dt><dd>± ${p.precision || "?"} m</dd><dt>Heure</dt><dd>${new Date(p.at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</dd></dl>
      <div class="va-fiche-b"><a class="va-btn plein" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}">➤ Itinéraire</a></div></div>`;
    if (marq[p.uid]) { marq[p.uid].setLatLng([p.lat, p.lng]).setIcon(L.divIcon({ className: "", iconSize: [0, 0], html })); marq[p.uid].setPopupContent(pop); }
    else marq[p.uid] = L.marker([p.lat, p.lng], { icon: L.divIcon({ className: "", iconSize: [0, 0], html }), riseOnHover: true }).bindPopup(pop, { className: "va-pop pro", maxWidth: 280 }).addTo(map);
    if (marq[p.uid]._cercle) marq[p.uid]._cercle.setLatLng([p.lat, p.lng]).setRadius(p.precision || 0);
    else marq[p.uid]._cercle = L.circle([p.lat, p.lng], { radius: p.precision || 0, color: c, weight: 1, fillOpacity: 0.08, interactive: false }).addTo(map);
  });
  Object.keys(marq).forEach(uid => { if (!vus.has(uid)) { map.removeLayer(marq[uid]); if (marq[uid]._cercle) map.removeLayer(marq[uid]._cercle); delete marq[uid]; } });
  const tri = [...positions].sort((a, b) => b.at - a.at);
  cont.querySelector("[data-et-liste]").innerHTML = tri.length ? tri.map(p => { const pr = siteProche(p), frais = Date.now() - p.at < RECENT;
    return `<div class="va-li ${frais ? "ok" : "veille"}" style="--c:${couleur(p.uid)}"><button class="va-li-m" data-et-aller="${p.uid}"><span class="et-av mini" style="--c:${couleur(p.uid)}">${esc(initiales(p.nom))}</span><span class="va-li-t"><b>${esc(p.nom)}</b><small>${ilYa(p.at)}${pr ? ` · ${pr.d < 150 ? "sur" : "près de"} ${esc(pr.s.nom)}` : ""}</small></span></button></div>`; }).join("")
    : `<p class="hint">Aucune position pour l'instant : elles arrivent dès qu'un technicien ouvre l'appli sur sa tablette.</p>`;
  cont.querySelector("[data-et-liste]").insertAdjacentHTML("beforeend", bloques.map(p => `<div class="va-li alerte" style="--c:#9aa4b2"><div class="va-li-m"><span class="et-av mini" style="--c:#9aa4b2">${esc(initiales(p.nom))}</span><span class="va-li-t"><b>${esc(p.nom)}</b><small>📵 Localisation désactivée sur l'appareil (${ilYa(p.at)})</small></span></div></div>`).join(""));
  cont.querySelectorAll("[data-et-aller]").forEach(b => b.onclick = () => { const m = marq[b.dataset.etAller]; if (m) { map.flyTo(m.getLatLng(), 18, { duration: 0.8 }); setTimeout(() => m.openPopup(), 850); } });
  cadrer(false);
}

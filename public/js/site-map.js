// site-map.js
// Carte interactive des sites (Leaflet/OpenStreetMap), partagée entre la
// vue "Carte" de Dossiers de site et le tableau de bord d'accueil — pour
// éviter de maintenir deux fois la même logique de géocodage/affichage.

import { esc } from "./astreinte-logic.js";
import { saveDossierGeo } from "./site-dossier-data.js";

function chargerLeaflet() {
  if (window.L) return Promise.resolve();
  if (window.__leafletLoading) return window.__leafletLoading;
  window.__leafletLoading = new Promise((resolve, reject) => {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
    document.head.appendChild(css);
    const script = document.createElement("script");
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
  return window.__leafletLoading;
}

// Géocode une adresse via Nominatim (gratuit, sans clé). Respecte la
// politique d'usage (max ~1 req/s) via l'appel séquentiel dans geocoderSitesManquants.
async function geocoderAdresse(adresse) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(adresse)}`;
  const res = await fetch(url, { headers: { "Accept-Language": "fr" } });
  if (!res.ok) return null;
  const data = await res.json();
  if (!data || !data.length) return null;
  return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
}

let geocodageEnCours = false;

// Géocode, un par un (throttle 1.1s), les dossiers ayant une adresse mais
// pas encore de coordonnées enregistrées — puis enregistre le résultat
// pour la prochaine fois et met à jour la carte au fur et à mesure.
// `estActif()` permet à l'appelant de stopper la boucle si l'écran a
// changé entre-temps (carte fermée, filtre changé...).
async function geocoderSitesManquants(dossiers, onNouvellesCoords, estActif) {
  if (geocodageEnCours) return;
  geocodageEnCours = true;
  try {
    for (const d of dossiers) {
      if (!estActif()) break;
      if (!d.adresse || !d.adresse.trim() || d.geo) continue;
      try {
        const coords = await geocoderAdresse(d.adresse);
        if (coords) {
          await saveDossierGeo(d.id, coords);
          onNouvellesCoords(d.id, coords);
        }
      } catch (e) { console.error("Géocodage échoué pour", d.nom, e); }
      await new Promise(r => setTimeout(r, 1100));
    }
  } finally {
    geocodageEnCours = false;
  }
}

// Initialise une carte Leaflet dans `holder` (déjà présent dans le DOM,
// avec une hauteur définie en CSS) à partir d'une liste de dossiers de
// site. Géocode automatiquement les adresses manquantes et enregistre le
// résultat. Renvoie { detruire() } pour que l'appelant nettoie proprement
// l'instance (changement d'écran, changement de filtre, démontage...).
//
// options.onOpenSite(dossierId) : appelé quand on clique "Ouvrir la
// fiche →" dans une bulle de marqueur.
// options.onStatut(texte) : appelé avec un texte du type "12/15 site(s)
// localisé(s)" à chaque mise à jour, pour affichage libre par l'appelant.
export function initCarteSites(holder, dossiers, options = {}) {
  const { onOpenSite, onStatut } = options;
  let detruit = false;
  let map = null;

  const avecAdresse = dossiers.filter(d => d.adresse && d.adresse.trim());
  const majStatut = () => {
    if (!onStatut) return;
    const localises = avecAdresse.filter(d => d.geo).length;
    onStatut(`${localises}/${avecAdresse.length} site(s) localisé(s)${avecAdresse.length !== dossiers.length ? ` · ${dossiers.length - avecAdresse.length} sans adresse renseignée` : ""}`);
  };
  majStatut();

  chargerLeaflet().then(() => {
    if (detruit) return;
    map = window.L.map(holder).setView([46.8, -1.4], 8); // centré Vendée par défaut
    window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap",
      maxZoom: 19,
    }).addTo(map);

    const markers = {};
    const ajouterMarker = (d) => {
      if (!d.geo) return;
      const m = window.L.marker([d.geo.lat, d.geo.lng]).addTo(map);
      m.bindPopup(`<b>${esc(d.nom)}</b><br>${esc(d.adresse || "")}<br>${onOpenSite ? `<a href="#" data-ouvrir-site="${d.id}">Ouvrir la fiche →</a>` : ""}`);
      m.on("popupopen", () => {
        document.querySelector(`[data-ouvrir-site="${d.id}"]`)?.addEventListener("click", (e) => {
          e.preventDefault();
          onOpenSite?.(d.id);
        });
      });
      markers[d.id] = m;
    };

    avecAdresse.forEach(d => { if (d.geo) ajouterMarker(d); });
    if (Object.keys(markers).length > 0) {
      const groupe = window.L.featureGroup(Object.values(markers));
      map.fitBounds(groupe.getBounds().pad(0.2));
    }

    geocoderSitesManquants(
      avecAdresse,
      (id, coords) => {
        const d = dossiers.find(x => x.id === id);
        if (d) d.geo = coords;
        if (!detruit && d && !markers[id]) ajouterMarker(d);
        majStatut();
      },
      () => !detruit
    );
  }).catch(() => {
    if (!detruit && holder) holder.innerHTML = `<p class="hint" style="padding:16px">❌ Impossible de charger la carte (connexion internet nécessaire).</p>`;
  });

  return {
    detruire() {
      detruit = true;
      if (map) { map.remove(); map = null; }
    },
  };
}

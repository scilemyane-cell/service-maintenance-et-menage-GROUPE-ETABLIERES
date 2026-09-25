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
// Bornes larges de la France métropolitaine + Corse. Une adresse mal
// formulée peut faire répondre Nominatim avec un résultat hors de cette
// zone (autre pays, DOM-TOM, résultat aberrant) : sans ce garde-fou, un
// seul site mal géocodé suffit à faire dézoomer la carte sur l'Europe
// entière pour englober ce point isolé, la rendant inutilisable pour les
// sites (tous en métropole) qu'elle est censée montrer.
const BORNES_FRANCE_METRO = { latMin: 41, latMax: 51.5, lngMin: -5.5, lngMax: 9.7 };
function dansFranceMetro({ lat, lng }) {
  return lat >= BORNES_FRANCE_METRO.latMin && lat <= BORNES_FRANCE_METRO.latMax
    && lng >= BORNES_FRANCE_METRO.lngMin && lng <= BORNES_FRANCE_METRO.lngMax;
}
// Un dossier peut déjà porter en base un `geo` enregistré avant ce
// garde-fou (potentiellement aberrant) : on ne le considère "localisé"
// que s'il retombe dans la zone attendue, sinon il est traité comme non
// géocodé (re-mis en file, exclu des marqueurs et du cadrage de la carte).
// Les coordonnées ne valent que pour l'adresse qui a été géocodée : si
// l'adresse du dossier a été modifiée depuis (ou si le géocodage date
// d'avant l'enregistrement de l'adresse géocodée), le site est
// re-géocodé et son marqueur déplacé automatiquement.
const normAdresse = a => String(a || "").trim().replace(/\s+/g, " ").toLowerCase();
function geoValide(d) {
  return !!d.geo && dansFranceMetro(d.geo) && !!d.geo.adresse && normAdresse(d.geo.adresse) === normAdresse(d.adresse);
}

async function geocoderAdresse(adresse) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=fr&q=${encodeURIComponent(adresse)}`;
  const res = await fetch(url, { headers: { "Accept-Language": "fr" } });
  if (!res.ok) return null;
  const data = await res.json();
  if (!data || !data.length) return null;
  const coords = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  if (!dansFranceMetro(coords)) {
    console.warn("Géocodage hors zone attendue, ignoré :", adresse, coords);
    return null;
  }
  return coords;
}

// File d'attente de géocodage GLOBALE au module (pas liée à une carte en
// particulier) : chaque enregistrement réussi (saveDossierGeo) déclenche
// une mise à jour Firestore, qui redessine l'écran qui affiche la carte
// (comme tout le reste de l'appli) — ce qui détruit puis recrée
// l'instance Leaflet en cours. Si la boucle de géocodage avait été liée à
// CETTE instance, chaque nouveau site localisé la faisait s'arrêter
// avant d'avoir eu la chance de traiter les suivants (observé : la
// progression restait bloquée après 4-5 sites sur une grosse liste). En
// la détachant complètement du cycle de vie d'une carte précise, elle
// continue jusqu'au bout même si la carte est fermée/rouverte/filtrée
// entre-temps ; les cartes actives se contentent de s'abonner aux
// résultats pour ajouter leurs marqueurs au fur et à mesure.
const enFile = new Map(); // id -> adresse, pas encore traité
let boucleEnCours = false;
const abonnes = new Map(); // symbole d'instance -> callback(id, coords)

function demarrerBoucleGeocodage() {
  if (boucleEnCours) return;
  boucleEnCours = true;
  (async () => {
    while (enFile.size > 0) {
      const [id, adresse] = enFile.entries().next().value;
      enFile.delete(id);
      try {
        const coords = await geocoderAdresse(adresse);
        if (coords) {
          const geo = { ...coords, adresse };
          await saveDossierGeo(id, geo);
          abonnes.forEach(cb => cb(id, geo));
        }
      } catch (e) { console.error("Géocodage échoué pour", id, e); }
      await new Promise(r => setTimeout(r, 1100));
    }
    boucleEnCours = false;
  })();
}

// Ajoute à la file globale les dossiers de cette liste qui ont une
// adresse mais pas encore de coordonnées valides, puis (re)lance la
// boucle si besoin — sans effet si tout est déjà en file ou déjà géocodé.
function mettreEnFileSiBesoin(dossiers) {
  dossiers.forEach((d) => {
    if (d.adresse && d.adresse.trim() && !geoValide(d) && !enFile.has(d.id)) enFile.set(d.id, d.adresse);
  });
  demarrerBoucleGeocodage();
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
  const idAbonne = Symbol("carte-sites");

  const avecAdresse = dossiers.filter(d => d.adresse && d.adresse.trim());
  const majStatut = () => {
    if (!onStatut) return;
    const localises = avecAdresse.filter(geoValide).length;
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
      if (!geoValide(d)) return;
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

    avecAdresse.forEach(d => { if (geoValide(d)) ajouterMarker(d); });
    if (Object.keys(markers).length > 0) {
      const groupe = window.L.featureGroup(Object.values(markers));
      map.fitBounds(groupe.getBounds().pad(0.2));
    }

    // S'abonne aux résultats de la file de géocodage globale (voir plus
    // haut) pour ajouter les marqueurs au fur et à mesure, sans jamais
    // démarrer/arrêter la file elle-même.
    abonnes.set(idAbonne, (id, coords) => {
      if (detruit) return;
      const d = dossiers.find(x => x.id === id);
      if (d) {
        d.geo = coords;
        if (markers[id]) markers[id].setLatLng([coords.lat, coords.lng]); // adresse corrigée : le marqueur se déplace
        else ajouterMarker(d);
      }
      majStatut();
    });
    mettreEnFileSiBesoin(avecAdresse);
  }).catch(() => {
    if (!detruit && holder) holder.innerHTML = `<p class="hint" style="padding:16px">❌ Impossible de charger la carte (connexion internet nécessaire).</p>`;
  });

  return {
    detruire() {
      detruit = true;
      abonnes.delete(idAbonne);
      if (map) { map.remove(); map = null; }
    },
  };
}

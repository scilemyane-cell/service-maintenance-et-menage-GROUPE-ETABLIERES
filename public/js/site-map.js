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
// Couleur des repères par association, et une couleur à part pour les
// dispositifs MNA (sous-groupe « MNA » ou nom contenant « MNA »).
export const CATEGORIES_CARTE = [
  { cle: "ecole", label: "École", couleur: "#2a78d6" },
  { cle: "agropolis", label: "Agropolis", couleur: "#1baf7a" },
  { cle: "mna", label: "MNA", couleur: "#eb6834" },
  { cle: "armonia", label: "Armonia", couleur: "#4a3aa7" },
  { cle: "autre", label: "Autres", couleur: "#8A8D93" },
];
const CAT = cle => CATEGORIES_CARTE.find(c => c.cle === cle);
const sansAccent = s => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
export function categorieSite(d) {
  if (/\bmna\b/.test(sansAccent(d.groupe)) || /\bmna\b/.test(sansAccent(d.nom))) return CAT("mna");
  const a = sansAccent(d.association);
  return CATEGORIES_CARTE.find(c => c.cle !== "autre" && c.cle !== "mna" && a.includes(c.cle)) || CAT("autre");
}
function iconeRepere(couleur) {
  return window.L.divIcon({
    className: "repere-site",
    html: `<svg width="28" height="38" viewBox="0 0 28 38"><path d="M14 1C7 1 1.5 6.5 1.5 13.5 1.5 23 14 37 14 37s12.5-14 12.5-23.5C26.5 6.5 21 1 14 1z" fill="${couleur}" stroke="#fff" stroke-width="2"/><circle cx="14" cy="13.5" r="5" fill="#fff"/></svg>`,
    iconSize: [28, 38], iconAnchor: [14, 37], popupAnchor: [0, -32],
  });
}

const normAdresse = a => String(a || "").trim().replace(/\s+/g, " ").toLowerCase();
function geoValide(d) {
  if (!d.geo || !dansFranceMetro(d.geo)) return false;
  // Position placée à la main : valable tant que l'adresse n'a pas changé
  // (y compris pour un site sans adresse).
  if (d.geo.manuel) return normAdresse(d.geo.adresse) === normAdresse(d.adresse);
  return !!d.geo.adresse && normAdresse(d.geo.adresse) === normAdresse(d.adresse);
}

// Adresse complète d'abord ; en cas d'échec (lieu-dit, nom de bâtiment,
// numéro inconnu…), repli sur « code postal + commune » — position
// approximative, à ajuster ensuite à la main en déplaçant le repère.
async function geocoderAdresse(adresse) {
  const precis = await geocoderRequete(adresse);
  if (precis) return precis;
  const m = String(adresse).match(/(\d{5})\s*([^,\n]+)/);
  if (m) {
    await new Promise(r => setTimeout(r, 1100));
    const approx = await geocoderRequete(`${m[1]} ${m[2].trim()}`);
    if (approx) return { ...approx, approx: true };
  }
  return null;
}
const echecsGeocodage = new Set(); // adresses introuvables cette session (pas de nouvelle tentative)

async function geocoderRequete(adresse) {
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
// Sites placés à la main pendant cette session : la file de géocodage
// automatique ne doit JAMAIS écraser ensuite leur position.
const placesALaMain = new Set();
function marquerPlaceALaMain(id) { placesALaMain.add(id); enFile.delete(id); }

function demarrerBoucleGeocodage() {
  if (boucleEnCours) return;
  boucleEnCours = true;
  (async () => {
    while (enFile.size > 0) {
      const [id, adresse] = enFile.entries().next().value;
      enFile.delete(id);
      try {
        const coords = await geocoderAdresse(adresse);
        if (!coords) echecsGeocodage.add(normAdresse(adresse));
        if (coords && !placesALaMain.has(id)) {
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
    if (d.adresse && d.adresse.trim() && !geoValide(d) && !placesALaMain.has(d.id) && !enFile.has(d.id) && !echecsGeocodage.has(normAdresse(d.adresse))) enFile.set(d.id, d.adresse);
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
  // options.editable : repères déplaçables (glisser) + placement manuel
  // des sites non localisés (voir placer()). options.onNonPlaces(liste) :
  // appelé avec les dossiers encore absents de la carte.
  const { onOpenSite, onStatut, editable = false, onNonPlaces } = options;
  let modePlacement = null;
  let activerPlacement = () => {};
  // Verrou : par défaut les repères ne bougent pas (évite un déplacement
  // par erreur). Bouton 🔒/🔓 sur la carte pour autoriser les modifications.
  let deverrouille = false;
  const markers_ = {};
  let markersRef = null;
  let detruit = false;
  let map = null;
  const idAbonne = Symbol("carte-sites");

  const avecAdresse = dossiers.filter(d => d.adresse && d.adresse.trim());
  const majStatut = () => {
    if (!onStatut) return;
    const localises = avecAdresse.filter(geoValide).length;
    onNonPlaces?.(dossiers.filter(d => !geoValide(d)));
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

    markersRef = markers_;
    const markers = markers_;
    // Légende des couleurs (uniquement les catégories présentes)
    const presentes = CATEGORIES_CARTE.filter(c => dossiers.some(d => categorieSite(d).cle === c.cle));
    if (presentes.length > 1) {
      const legende = window.L.control({ position: "bottomleft" });
      legende.onAdd = () => {
        const div = window.L.DomUtil.create("div", "legende-carte");
        div.innerHTML = presentes.map(c => `<span><i style="background:${c.couleur}"></i>${c.label}</span>`).join("");
        return div;
      };
      legende.addTo(map);
    }
    if (editable) {
      const verrou = window.L.control({ position: "topright" });
      verrou.onAdd = () => {
        const b = window.L.DomUtil.create("button", "carte-verrou");
        b.type = "button";
        const maj = () => {
          b.textContent = deverrouille ? "🔓 Modification activée" : "🔒 Carte verrouillée";
          b.classList.toggle("ouvert", deverrouille);
          b.title = deverrouille ? "Cliquer pour reverrouiller" : "Cliquer pour pouvoir déplacer les repères";
        };
        maj();
        window.L.DomEvent.disableClickPropagation(b);
        b.addEventListener("click", () => {
          deverrouille = !deverrouille;
          maj();
          Object.values(markers).forEach(m => deverrouille ? m.dragging?.enable() : m.dragging?.disable());
          holder.classList.toggle("carte-deverrouillee", deverrouille);
          map.closePopup();
          if (!deverrouille) { modePlacement = null; holder.classList.remove("carte-placement"); }
          window.toast?.(deverrouille ? "🔓 Tu peux déplacer les repères. Pense à reverrouiller après." : "🔒 Carte verrouillée");
        });
        return b;
      };
      verrou.addTo(map);
    }
    const ajouterMarker = (d) => {
      if (!geoValide(d)) return;
      const cat = categorieSite(d);
      const m = window.L.marker([d.geo.lat, d.geo.lng], { draggable: false, title: `${d.nom} — ${cat.label}`, icon: iconeRepere(cat.couleur) }).addTo(map);
      m.bindPopup(`<b>${esc(d.nom)}</b><br>${esc(d.adresse || "")}${d.geo.approx ? `<br><i style="color:#9a6700">Position approximative (commune)${editable ? " — fais glisser le repère au bon endroit" : ""}</i>` : ""}${d.geo.manuel ? `<br><i style="color:#1a7f37">Position ajustée à la main</i>` : ""}<br>${onOpenSite ? `<a href="#" data-ouvrir-site="${d.id}">Ouvrir la fiche →</a>` : ""}${editable ? `<br><button type="button" class="carte-btn-deplacer" data-deplacer-site="${d.id}" style="margin-top:8px;padding:6px 10px;border-radius:7px;border:1px solid #A87A12;background:#fff8e6;color:#6b4e00;font-weight:700;cursor:pointer">📍 Déplacer ce repère</button>` : ""}`);
      if (editable) {
        m.on("dragend", async () => {
          const { lat, lng } = m.getLatLng();
          const geo = { lat, lng, adresse: d.adresse || "", manuel: true };
          marquerPlaceALaMain(d.id);
          try { await saveDossierGeo(d.id, geo); d.geo = geo; window.toast?.(`📍 Position de « ${d.nom} » enregistrée`); }
          catch (e) { console.error("saveDossierGeo:", e); alert("Position non enregistrée : " + (e.message || e)); m.setLatLng([d.geo.lat, d.geo.lng]); }
        });
      }
      m.on("popupopen", () => {
        const btn = document.querySelector(`[data-deplacer-site="${d.id}"]`);
        if (btn) btn.style.display = deverrouille ? "" : "none";
        document.querySelector(`[data-ouvrir-site="${d.id}"]`)?.addEventListener("click", (e) => {
          e.preventDefault();
          onOpenSite?.(d.id);
        });
        document.querySelector(`[data-deplacer-site="${d.id}"]`)?.addEventListener("click", (e) => {
          e.preventDefault();
          m.closePopup();
          activerPlacement(d);
        });
      });
      if (editable && deverrouille) m.dragging?.enable();
      markers[d.id] = m;
    };

    avecAdresse.forEach(d => { if (geoValide(d)) ajouterMarker(d); });
    const cadrer = () => {
      if (!map || Object.keys(markers).length === 0) return;
      map.fitBounds(window.L.featureGroup(Object.values(markers)).getBounds().pad(0.2), { maxZoom: 14 });
    };
    cadrer();
    // Si la carte a été créée avant que sa zone ait sa taille définitive
    // (mise en page en colonnes), on recalcule puis on recadre sur tous les sites.
    setTimeout(() => { if (!detruit && map) { map.invalidateSize(); cadrer(); } }, 250);

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

    activerPlacement = (d) => {
      modePlacement = d;
      holder.classList.add("carte-placement");
      window.toast?.(`👆 Touche la carte à l'emplacement exact de « ${d.nom} » (Échap pour annuler)`);
      const echap = (e) => { if (e.key === "Escape") { modePlacement = null; holder.classList.remove("carte-placement"); document.removeEventListener("keydown", echap); } };
      document.addEventListener("keydown", echap);
    };

    // Placement manuel : clic sur la carte pour poser le repère du site choisi.
    map.on("click", async (e) => {
      if (!modePlacement) return;
      const d = modePlacement; modePlacement = null;
      holder.classList.remove("carte-placement");
      const geo = { lat: e.latlng.lat, lng: e.latlng.lng, adresse: d.adresse || "", manuel: true };
      marquerPlaceALaMain(d.id);
      try {
        await saveDossierGeo(d.id, geo);
        d.geo = geo;
        if (markers[d.id]) markers[d.id].setLatLng(e.latlng); else ajouterMarker(d);
        window.toast?.(`📍 « ${d.nom} » placé sur la carte`);
        majStatut();
      } catch (err) { console.error("saveDossierGeo:", err); alert("Position non enregistrée : " + (err.message || err)); }
    });
  }).catch(() => {
    if (!detruit && holder) holder.innerHTML = `<p class="hint" style="padding:16px">❌ Impossible de charger la carte (connexion internet nécessaire).</p>`;
  });

  return {
    // Active le placement manuel du dossier `id` : le prochain clic sur la
    // carte pose son repère (Échap pour annuler).
    placer(id) {
      const d = dossiers.find(x => x.id === id);
      if (!d || !map) return;
      activerPlacement(d);
    },
    // Centre la carte sur un site et ouvre sa bulle (liste à côté de la carte).
    focus(id) {
      const m = markersRef?.[id];
      if (!m || !map) return false;
      map.setView(m.getLatLng(), Math.max(map.getZoom(), 13), { animate: true });
      m.openPopup();
      return true;
    },
    detruire() {
      detruit = true;
      abonnes.delete(idAbonne);
      if (map) { map.remove(); map = null; }
    },
  };
}

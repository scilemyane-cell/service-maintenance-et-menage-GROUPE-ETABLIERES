// ma-position.js — Point bleu « Vous êtes ici » sur une carte Leaflet (position de cet appareil, non enregistrée).
// Première position rapide (réseau / wifi), puis suivi précis (GPS). L'état est affiché sur le bouton « Moi ».
export function suivreMaPosition(map, { onPremiere, bouton } = {}) {
  const etat = (txt, cls = "") => { if (bouton) { bouton.textContent = txt; bouton.dataset.etat = cls; } };
  if (!("geolocation" in navigator) || !window.L) { etat("📵 Pas de GPS", "ko"); return { arreter() {}, aller() { return false; }, pos: () => null }; }
  if (!window.isSecureContext) { etat("📵 Localisation indisponible", "ko"); }
  const L = window.L;
  let point = null, cercle = null, pos = null, premiere = true, refus = false;
  const placer = (p) => {
    const n = { lat: p.coords.latitude, lng: p.coords.longitude, precision: Math.round(p.coords.accuracy || 0) };
    if (pos && n.precision > pos.precision * 3 && Date.now() - pos.t < 60000) return; // ne pas remplacer une position précise par une grossière
    pos = { ...n, t: Date.now() };
    if (!point) {
      cercle = L.circle([pos.lat, pos.lng], { radius: pos.precision, color: "#1a73e8", weight: 1, fillColor: "#1a73e8", fillOpacity: 0.12, interactive: false }).addTo(map);
      point = L.marker([pos.lat, pos.lng], { interactive: true, zIndexOffset: 1000, icon: L.divIcon({ className: "", iconSize: [0, 0], html: `<div class="moi-pt"><i></i><b></b></div>` }) }).bindTooltip("Vous êtes ici", { direction: "top", offset: [0, -10] }).addTo(map);
    } else { point.setLatLng([pos.lat, pos.lng]); cercle.setLatLng([pos.lat, pos.lng]).setRadius(pos.precision); }
    etat(`◉ Moi · ±${pos.precision > 999 ? Math.round(pos.precision / 1000) + " km" : pos.precision + " m"}`, "ok");
    if (premiere) { premiere = false; onPremiere?.(pos); }
  };
  const erreur = (e) => {
    if (e.code === 1) { refus = true; etat("📵 Activer la localisation", "ko");
      if (bouton && !bouton.dataset.aide) { bouton.dataset.aide = "1"; bouton.addEventListener("click", (ev) => { if (!refus) return; ev.stopImmediatePropagation(); import("./geoloc-partage.js").then(m => m.aideLocalisation()); }, true); } }
    else if (!pos) etat("◉ Moi · recherche…", "");
  };
  etat("◉ Moi · recherche…");
  navigator.geolocation.getCurrentPosition(placer, erreur, { enableHighAccuracy: false, maximumAge: 300000, timeout: 10000 });
  const id = navigator.geolocation.watchPosition(placer, erreur, { enableHighAccuracy: true, maximumAge: 15000, timeout: 60000 });
  return {
    arreter() { navigator.geolocation.clearWatch(id); try { point && map.removeLayer(point); cercle && map.removeLayer(cercle); } catch { /* */ } },
    aller() {
      if (refus) { alert("La localisation est bloquée pour l'appli.\n\nSur le téléphone : touche le cadenas (ou ⓘ) à gauche de l'adresse du site › Autorisations › Position › Autoriser, puis recharge la page.\nVérifie aussi que la localisation du téléphone est activée."); return true; }
      if (!pos) return false;
      map.flyTo([pos.lat, pos.lng], Math.max(map.getZoom(), 18), { duration: 0.8 }); return true;
    },
    pos: () => pos,
  };
}

// ma-position.js — Point bleu « Vous êtes ici » sur une carte Leaflet (position de cet appareil, non enregistrée).
export function suivreMaPosition(map, { onPremiere } = {}) {
  if (!("geolocation" in navigator) || !window.L) return { arreter() {}, aller() { return false; }, pos: () => null };
  const L = window.L;
  let point = null, cercle = null, pos = null, premiere = true;
  const id = navigator.geolocation.watchPosition((p) => {
    pos = { lat: p.coords.latitude, lng: p.coords.longitude, precision: p.coords.accuracy || 0 };
    if (!point) {
      cercle = L.circle([pos.lat, pos.lng], { radius: pos.precision, color: "#1a73e8", weight: 1, fillColor: "#1a73e8", fillOpacity: 0.12, interactive: false }).addTo(map);
      point = L.marker([pos.lat, pos.lng], { interactive: true, zIndexOffset: 1000, icon: L.divIcon({ className: "", iconSize: [0, 0], html: `<div class="moi-pt"><i></i><b></b></div>` }) }).bindTooltip("Vous êtes ici", { direction: "top", offset: [0, -10] }).addTo(map);
    } else { point.setLatLng([pos.lat, pos.lng]); cercle.setLatLng([pos.lat, pos.lng]).setRadius(pos.precision); }
    if (premiere) { premiere = false; onPremiere?.(pos); }
  }, () => {}, { enableHighAccuracy: true, maximumAge: 20000, timeout: 20000 });
  return {
    arreter() { navigator.geolocation.clearWatch(id); try { point && map.removeLayer(point); cercle && map.removeLayer(cercle); } catch { /* */ } },
    aller() { if (!pos) return false; map.flyTo([pos.lat, pos.lng], Math.max(map.getZoom(), 18), { duration: 0.8 }); return true; },
    pos: () => pos,
  };
}

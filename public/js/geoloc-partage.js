// geoloc-partage.js — Partage de position des techniciens avec l'encadrement.
// Tablettes pro : partage automatique, indicateur visible ; position envoyée seulement appli ouverte,
// une seule position gardée (la dernière, écrasée : pas d'historique de trajets).
// Stockage : positions/{uid} { lat, lng, precision, at (ms), nom, role }
import { db } from "./firebase-init.js";
import { doc, setDoc, deleteDoc } from "./firestore-compte.js";

const ROLES = ["technicien"];
const MODULE = "equipe-terrain";
let user = null, watchId = null, dernier = null, chip = null, actifModule = false;


// À appeler à la connexion, puis à chaque changement de la liste des modules en construction.
// Tablettes professionnelles fournies par l'entreprise : partage automatique (pas de question),
// avec un indicateur discret pour que le technicien sache que sa position est visible.
export function initPartagePosition(u, modulesEnConstruction = []) {
  user = u;
  actifModule = !modulesEnConstruction.includes(MODULE);
  if (!u?.uid || !ROLES.includes(u.role) || u.apercu || !actifModule || !("geolocation" in navigator)) { arreter(false); retirerUI(); return; }
  demarrer(); afficherUI();
}

let bloque = false;
function demarrer() {
  if (watchId != null) return;
  watchId = navigator.geolocation.watchPosition((p) => { bloque = false; envoyer(p); afficherUI(); }, (e) => {
    if (e.code === 1 && !bloque) { bloque = true; afficherUI();
      // Prévenir l'encadrement que la localisation est coupée sur l'appareil.
      setDoc(doc(db, "positions", user.uid), { refus: true, at: Date.now(), nom: user.nom || user.email || "", role: user.role }).catch(() => {}); }
  }, { enableHighAccuracy: true, maximumAge: 60000, timeout: 30000 });
}
function arreter(effacer) {
  if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  dernier = null;
  if (effacer && user?.uid) deleteDoc(doc(db, "positions", user.uid)).catch(() => {});
}
function distance(a, b) { const R = 6371e3, r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r; const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); }
async function envoyer(p) {
  if (document.visibilityState !== "visible") return;
  const pos = { lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6), precision: Math.round(p.coords.accuracy || 0) };
  // Pas plus d'un envoi toutes les 2 min, sauf déplacement de plus de 40 m.
  if (dernier && Date.now() - dernier.t < 120000 && distance(dernier, pos) < 40) return;
  dernier = { ...pos, t: Date.now() };
  try { await setDoc(doc(db, "positions", user.uid), { ...pos, at: Date.now(), nom: user.nom || user.email || "", role: user.role }); } catch { /* règle pas encore publiée / réseau */ }
}

function retirerUI() { chip?.remove(); chip = null; }
function afficherUI() {
  const html = bloque ? `<span title="La localisation est désactivée pour l'appli sur cet appareil">📍 Localisation désactivée — à réactiver dans les réglages</span>`
    : `<span title="Ta position est visible par le responsable pendant que l'appli est ouverte">📍 Position visible par le responsable</span>`;
  if (chip && chip.innerHTML === html) return;
  retirerUI();
  chip = document.createElement("div");
  chip.className = "gp-chip" + (bloque ? " bloque" : "");
  chip.innerHTML = html;
  document.body.appendChild(chip);
}
export function arreterPartagePosition() { arreter(false); retirerUI(); user = null; }

// geoloc-partage.js — Partage de position des techniciens avec l'encadrement.
// Principes (RGPD / CNIL) : le technicien est informé et choisit (« Oui » / « Non », modifiable à tout moment),
// la position n'est envoyée QUE pendant que l'appli est ouverte, une seule position est gardée (la dernière,
// écrasée à chaque envoi : pas d'historique de trajets), et elle est effacée quand il arrête le partage.
// Stockage : positions/{uid} { lat, lng, precision, at (ms), nom, role }
import { db } from "./firebase-init.js";
import { doc, setDoc, deleteDoc } from "./firestore-compte.js";

const ROLES = ["technicien"];
const CLE = (uid) => "etablieres-partage-position-" + uid;
const MODULE = "equipe-terrain";
let user = null, watchId = null, dernier = null, chip = null, actifModule = false;

const choix = () => { try { return localStorage.getItem(CLE(user.uid)); } catch { return null; } };
const noter = (v) => { try { localStorage.setItem(CLE(user.uid), v); } catch { /* */ } };

// À appeler à la connexion, puis à chaque changement de la liste des modules en construction.
export function initPartagePosition(u, modulesEnConstruction = []) {
  user = u;
  actifModule = !modulesEnConstruction.includes(MODULE);
  if (!u?.uid || !ROLES.includes(u.role) || u.apercu || !actifModule || !("geolocation" in navigator)) { arreter(false); retirerUI(); return; }
  const c = choix();
  if (c === "oui") demarrer(); else arreter(false);
  afficherUI();
}

function demarrer() {
  if (watchId != null) return;
  watchId = navigator.geolocation.watchPosition(envoyer, (e) => { if (e.code === 1) { noter("non"); arreter(true); afficherUI(); } }, { enableHighAccuracy: true, maximumAge: 60000, timeout: 30000 });
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
  retirerUI();
  const c = choix();
  chip = document.createElement("div");
  chip.className = "gp-chip" + (c ? "" : " question");
  chip.innerHTML = !c
    ? `<div><b>📍 Partager ta position ?</b><small>Le responsable verra où tu es <b>seulement pendant que l'appli est ouverte</b> (dernière position, pas d'historique). Tu peux arrêter quand tu veux.</small></div><span><button data-gp="oui">Oui</button><button data-gp="non">Non</button></span>`
    : c === "oui" ? `<button data-gp="menu" title="Partage de position">📍 Position partagée</button>` : `<button data-gp="menu" title="Partage de position">📍 Position non partagée</button>`;
  document.body.appendChild(chip);
  chip.addEventListener("click", (e) => {
    const b = e.target.closest("[data-gp]"); if (!b) return;
    const a = b.dataset.gp;
    if (a === "oui") { noter("oui"); demarrer(); afficherUI(); }
    else if (a === "non") { noter("non"); arreter(true); afficherUI(); }
    else if (a === "menu") {
      const oui = choix() === "oui";
      if (confirm(oui ? "Arrêter de partager ta position ? Ta dernière position sera effacée." : "Partager ta position avec le responsable pendant que l'appli est ouverte ?")) {
        if (oui) { noter("non"); arreter(true); } else { noter("oui"); demarrer(); }
        afficherUI();
      }
    }
  });
}
export function arreterPartagePosition() { arreter(false); retirerUI(); user = null; }

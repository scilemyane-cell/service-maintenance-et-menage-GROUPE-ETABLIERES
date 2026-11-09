// geoloc-partage.js — Partage de position des techniciens avec l'encadrement.
// Tablettes pro : partage automatique, indicateur visible ; position envoyée seulement appli ouverte,
// une seule position gardée (la dernière, écrasée : pas d'historique de trajets).
// Stockage : positions/{uid} { lat, lng, precision, at (ms), nom, role }
import { db } from "./firebase-init.js";
import { doc, setDoc, deleteDoc } from "./firestore-compte.js";

// Personnes du terrain. Seuls les téléphones / tablettes envoient leur position (pas les PC,
// dont la position wifi écraserait celle du téléphone de la même personne).
const ROLES = ["technicien", "n1", "admin", "super_admin"];
const estMobile = () => /Mobi|Android|iPhone|iPad|Tablet/i.test(navigator.userAgent || "") || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent || ""));
const MODULE = "equipe-terrain";
let user = null, watchId = null, dernier = null, chip = null, actifModule = false;


// À appeler à la connexion, puis à chaque changement de la liste des modules en construction.
// Tablettes professionnelles fournies par l'entreprise : partage automatique (pas de question),
// avec un indicateur discret pour que le technicien sache que sa position est visible.
export function initPartagePosition(u, modulesEnConstruction = []) {
  user = u;
  actifModule = !modulesEnConstruction.includes(MODULE);
  if (!u?.uid || !ROLES.includes(u.role) || u.apercu || !estMobile() || !(actifModule || u.role === "super_admin") || !("geolocation" in navigator)) { arreter(false); retirerUI(); return; }
  demarrer(); afficherUI();
}

let bloque = false, envoiLe = 0, erreurEnvoi = "";
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
  try { await setDoc(doc(db, "positions", user.uid), { ...pos, at: Date.now(), nom: user.nom || user.email || "", role: user.role }); envoiLe = Date.now(); erreurEnvoi = ""; }
  catch (e) { erreurEnvoi = /permission/i.test(e?.message || "") ? "règles Firestore non publiées" : (e?.message || "réseau"); dernier = null; }
  afficherUI();
}

function retirerUI() { chip?.remove(); chip = null; }
function afficherUI() {
  // Encadrement : pas de bandeau en bas d'écran (inutile pour eux) ; seul le
  // technicien garde l'indicateur « position visible par le responsable ».
  if (user?.role !== "technicien" && !bloque) { retirerUI(); return; }
  const h = envoiLe ? new Date(envoiLe).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "";
  const etat = erreurEnvoi ? ` · ⚠️ non envoyée (${erreurEnvoi})` : envoiLe ? ` · envoyée à ${h}` : " · recherche GPS…";
  const html = bloque ? `<button type="button" data-gp-aide style="color:#ef4444">📍 Localisation désactivée — <u>toucher ici pour l'activer</u></button>`
    : (user?.role === "technicien" ? `<span title="Ta position est visible par le responsable pendant que l'appli est ouverte">📍 Position visible par le responsable</span>` : `<span title="Ta position est visible sur « Équipe sur le terrain » pendant que l'appli est ouverte">📍 Position partagée avec l'équipe${etat}</span>`);
  if (chip && chip.innerHTML === html) return;
  retirerUI();
  chip = document.createElement("div");
  chip.className = "gp-chip" + (bloque ? " bloque" : "");
  chip.innerHTML = html;
  document.body.appendChild(chip);
  chip.querySelector("[data-gp-aide]")?.addEventListener("click", aideLocalisation);
}

// Guide adapté à l'appareil (iPhone / Android, navigateur ou appli installée).
export function aideLocalisation() {
  const ua = navigator.userAgent || "", ios = /iPhone|iPad|iPod/i.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua));
  const installee = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  const nav = /CriOS|Chrome/i.test(ua) ? "Chrome" : /Firefox|FxiOS/i.test(ua) ? "Firefox" : /SamsungBrowser/i.test(ua) ? "Samsung Internet" : ios ? "Safari" : "Chrome";
  const pc = !estMobile();
  const etapes = pc ? [
    "Clique sur le <b>cadenas 🔒</b> (ou l'icône réglages) à gauche de l'adresse du site",
    "<b>Position</b> (ou Localisation) › <b>Autoriser</b>",
    "Clique sur <b>Réessayer</b> ci-dessous — sur ordinateur la position est approximative (wifi)",
  ] : ios ? [
    "Ouvre <b>Réglages</b> ⚙️ du téléphone",
    "<b>Confidentialité et sécurité</b> › <b>Service de localisation</b> : <b>activé</b>",
    `Plus bas dans la liste, touche <b>${nav === "Safari" ? "Sites Safari" : nav}</b> › <b>Lorsque l'app est active</b> (et <b>Position exacte</b> activée)`,
    "Reviens dans l'appli et touche <b>Réessayer</b> ci-dessous",
  ] : [
    "Glisse du <b>haut de l'écran vers le bas</b> et allume <b>📍 Localisation</b>",
    installee ? `<b>Paramètres</b> › <b>Applications</b> › <b>${nav}</b> › <b>Autorisations</b> › <b>Position</b> › <b>Autoriser seulement pendant l'utilisation</b>`
      : `Dans ${nav}, touche le <b>cadenas 🔒</b> à gauche de l'adresse › <b>Autorisations</b> › <b>Position</b> › <b>Autoriser</b>`,
    "Touche <b>Réessayer</b> ci-dessous",
  ];
  const f = document.createElement("div"); f.className = "cd-fond"; f.style.zIndex = "9500";
  f.innerHTML = `<div class="cd-fenetre" style="max-width:420px"><div class="cd-fenetre-tete"><div><b>📍 Activer la localisation</b><small>${pc ? "Ordinateur" : ios ? "iPhone" : "Android"} · ${nav}</small></div><button class="cd-x" data-x>✕</button></div>
    <p class="gp-etat" style="margin:0 0 10px;font-weight:700"></p><ol style="margin:0;padding-left:20px;display:flex;flex-direction:column;gap:10px;line-height:1.4">${etapes.map(e => `<li>${e}</li>`).join("")}</ol>
    <button class="add-btn" data-re style="margin-top:14px;width:100%">🔄 Réessayer</button><p class="gp-res" style="text-align:center;margin:8px 0 0;font-size:13px"></p></div>`;
  document.body.append(f);
  f.querySelector("[data-x]").onclick = () => f.remove();
  const et = f.querySelector(".gp-etat");
  if (!("geolocation" in navigator)) et.textContent = "📵 Cet appareil ne donne pas sa position.";
  else navigator.permissions?.query({ name: "geolocation" }).then(p => { et.textContent = p.state === "granted" ? "✅ La localisation est déjà autorisée pour l'appli." : p.state === "denied" ? "❌ La localisation est bloquée pour l'appli — suis les étapes :" : "ℹ️ Pas encore autorisée — touche Réessayer puis « Autoriser »."; et.style.color = p.state === "granted" ? "#10b981" : p.state === "denied" ? "#ef4444" : ""; }).catch(() => {});
  f.addEventListener("click", (e) => { if (e.target === f) f.remove(); });
  f.querySelector("[data-re]").onclick = () => {
    const r = f.querySelector(".gp-res"); r.textContent = "Recherche de la position…";
    navigator.geolocation.getCurrentPosition(() => { r.textContent = "✅ Localisation activée"; bloque = false; if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; } if (user) demarrer(); afficherUI(); setTimeout(() => f.remove(), 1200); },
      (e) => { r.textContent = e.code === 1 ? "❌ Toujours bloquée — refais les étapes ci-dessus" : "⚠️ Position introuvable — vérifie que la localisation du téléphone est allumée"; },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  };
}
export function arreterPartagePosition() { arreter(false); retirerUI(); user = null; }

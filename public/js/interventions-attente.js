// interventions-attente.js
// Filet de sécurité : une intervention d'astreinte ne doit JAMAIS être
// perdue. Si l'enregistrement échoue pour une raison temporaire (quota
// Firebase du jour dépassé, pas de réseau, serveur indisponible), elle est
// gardée sur l'appareil puis renvoyée automatiquement dès que possible
// (toutes les 3 min, au retour du réseau, à la réouverture de l'appli).

const CLE = "etablieres-interv-attente";

export function listerAttente() {
  try { return JSON.parse(localStorage.getItem(CLE) || "[]"); } catch { return []; }
}
function ecrire(liste) {
  try { localStorage.setItem(CLE, JSON.stringify(liste)); } catch (e) { console.error("Interventions en attente :", e); }
  window.dispatchEvent(new CustomEvent("interventions-attente"));
}

// Erreur temporaire = à réessayer plus tard (quota, réseau, serveur).
export function estErreurTemporaire(e) {
  const code = String(e?.code || ""), msg = String(e?.message || e || "").toLowerCase();
  return !navigator.onLine || ["resource-exhausted", "unavailable", "deadline-exceeded", "aborted", "internal", "unknown"].includes(code.replace(/^firestore\//, ""))
    || /quota|offline|network|failed to fetch|unavailable|hors ligne/.test(msg);
}

export function mettreEnAttente(item) {
  const liste = listerAttente();
  liste.push({ ...item, cle: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, gardeLe: new Date().toISOString() });
  ecrire(liste);
}

let enCours = false;
export async function envoyerAttente() {
  if (enCours || !navigator.onLine) return 0;
  const liste = listerAttente(); if (!liste.length) return 0;
  enCours = true;
  let envoyees = 0;
  try {
    const { addIntervention, updateIntervention } = await import("./firestore-data.js");
    for (const it of liste) {
      try {
        if (it.type === "update" && it.id) await updateIntervention(it.id, it.payload);
        else await addIntervention(it.payload);
        ecrire(listerAttente().filter(x => x.cle !== it.cle));
        envoyees++;
      } catch (e) {
        console.warn("Intervention en attente non envoyée :", e);
        if (estErreurTemporaire(e)) break; // encore bloqué : on retentera plus tard
      }
    }
  } finally { enCours = false; }
  if (envoyees) window.toast?.(`✓ ${envoyees} intervention${envoyees > 1 ? "s" : ""} en attente envoyée${envoyees > 1 ? "s" : ""}`);
  return envoyees;
}

let demarre = false;
export function demarrerEnvoiAuto() {
  if (demarre) return; demarre = true;
  setTimeout(envoyerAttente, 10000);
  setInterval(envoyerAttente, 3 * 60000);
  window.addEventListener("online", () => setTimeout(envoyerAttente, 2000));
  document.addEventListener("visibilitychange", () => { if (!document.hidden) setTimeout(envoyerAttente, 3000); });
}

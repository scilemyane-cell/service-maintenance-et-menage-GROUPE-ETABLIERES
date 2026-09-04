// theme.js
// Thème visuel de l'application — trois choix : "sombre" (bleu nuit,
// thème d'origine), "gris" (sombre neutre) et "clair". Le choix est
// propre à chaque utilisateur, mémorisé dans son propre navigateur
// (localStorage) — il n'est jamais partagé ni synchronisé avec les
// autres comptes.

const STORAGE_KEY = "etablieres-theme";
export const THEMES = ["sombre", "gris", "clair"];
export const THEME_LABELS = { sombre: "🌙 Sombre", gris: "⬛ Gris", clair: "☀️ Clair" };

export function getStoredTheme() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return THEMES.includes(saved) ? saved : "sombre";
  } catch (e) {
    return "sombre"; // navigation privée / stockage bloqué : repli silencieux
  }
}

export function applyTheme(theme) {
  const safe = THEMES.includes(theme) ? theme : "sombre";
  document.documentElement.dataset.theme = safe;
  try { localStorage.setItem(STORAGE_KEY, safe); } catch (e) { /* stockage indisponible, thème appliqué quand même pour cette session */ }
  return safe;
}

// À appeler le plus tôt possible (voir aussi le script inline dans le
// <head> de chaque page, qui applique déjà le thème mémorisé avant même
// le chargement des modules JS, pour éviter un flash de l'ancien thème).
export function initTheme() {
  applyTheme(getStoredTheme());
}

export function cycleTheme() {
  const current = getStoredTheme();
  const next = THEMES[(THEMES.indexOf(current) + 1) % THEMES.length];
  return applyTheme(next);
}

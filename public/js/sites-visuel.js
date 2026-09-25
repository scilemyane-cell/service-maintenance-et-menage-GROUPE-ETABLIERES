// sites-visuel.js — éléments visuels communs aux tuiles de site
// (Dossier de site, Relevé compteur) : nom propre, ville, dessin au trait.
import { categorieSite } from "./site-map.js";

// Nom sans l'adresse e-mail éventuelle ("La Yole (resfjt…@etablieres.fr)")
export function nomPropre(nom) { return String(nom || "").replace(/\s*\([^)]*@[^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim(); }
// Ville à partir de l'adresse : ce qui suit le code postal, sinon la dernière partie.
export function villeDe(adresse) {
  const a = String(adresse || "").trim();
  if (!a) return "";
  const m = a.match(/\b\d{5}\s+(.+)$/);
  const v = (m ? m[1] : a.split(",").pop()).trim();
  return v.toLowerCase().replace(/(^|[\s'-])([a-zà-ÿ])/g, (x, p, c) => p + c.toUpperCase()).replace(/\bSur\b/g, "sur").replace(/\bDe\b/g, "de").replace(/\bDu\b/g, "du");
}
export const DESSINS = {
  maison: '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M8 30 32 10l24 20"/><path d="M14 26v28h36V26"/><path d="M27 54V40h10v14"/><path d="M42 16v-6h6v11"/></svg>',
  residence: '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M10 56V14h26v42"/><path d="M36 26h18v30"/><path d="M6 56h52"/><path d="M16 22h4M26 22h4M16 32h4M26 32h4M16 42h4M26 42h4M42 34h4M42 44h4"/></svg>',
  ecole: '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M6 56h52"/><path d="M12 56V28h40v28"/><path d="M8 30 32 12l24 18"/><circle cx="32" cy="28" r="5"/><path d="M26 56V44h12v12"/><path d="M18 36h4M42 36h4"/></svg>',
};
export function dessinPourSite(d) {
  const cat = categorieSite(d);
  return cat.cle === "ecole" ? DESSINS.ecole : cat.cle === "mna" ? DESSINS.maison : DESSINS.residence;
}

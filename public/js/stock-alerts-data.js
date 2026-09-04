// stock-alerts-data.js
// Compte en direct le nombre d'articles sous leur seuil — stock central
// (sous le seuil minimum) et stock déporté par site (sous la quantité
// cible permanente) — pour afficher un badge d'alerte sur la bulle
// "Stock maintenance" de l'écran d'accueil, sans avoir à ouvrir le module.

import { db } from "./firebase-init.js";
import { collection, onSnapshot } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

export function watchStockAlertCount(callback) {
  let central = 0;
  let deporte = 0;
  const emettre = () => callback({ central, deporte, total: central + deporte });

  const unsub1 = onSnapshot(collection(db, "stock-produits"), (snap) => {
    let n = 0;
    snap.forEach((d) => {
      const p = d.data();
      if (!p.supprimeLe && (p.stockActuel ?? 0) <= (p.stockMin ?? 0)) n++;
    });
    central = n;
    emettre();
  }, (err) => { console.error("watchStockAlertCount (central):", err); });

  const unsub2 = onSnapshot(collection(db, "stock-site-items"), (snap) => {
    let n = 0;
    snap.forEach((d) => {
      const it = d.data();
      if ((it.quantite ?? 0) < (it.quantiteCible ?? 0)) n++;
    });
    deporte = n;
    emettre();
  }, (err) => { console.error("watchStockAlertCount (déporté):", err); });

  return () => { unsub1(); unsub2(); };
}

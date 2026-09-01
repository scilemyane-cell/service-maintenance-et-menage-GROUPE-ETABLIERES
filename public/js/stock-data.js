import { db } from "./firebase-init.js";
import {
  doc, setDoc, deleteDoc, addDoc, updateDoc,
  collection, onSnapshot, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

// Liste type de départ (plomberie/robinetterie, électricité, quincaillerie,
// consommables courants) — à ajuster/compléter depuis l'onglet Produits.
// stockCible = quantité normale à avoir en stock ; stockMin = seuil sous
// lequel une commande est déclenchée (par défaut ~30% du stock cible).
function withMin(nom, categorie, unite, stockCible) {
  return { nom, categorie, unite, stockCible, stockMin: Math.max(1, Math.round(stockCible * 0.3)), stockActuel: stockCible, fournisseurNom: "", fournisseurEmail: "" };
}

export const PRODUITS_TYPE = [
  // Robinetterie
  withMin("Robinet mitigeur évier", "Robinetterie", "pièce", 3),
  withMin("Robinet mitigeur lavabo", "Robinetterie", "pièce", 3),
  withMin("Flexible de douche", "Robinetterie", "pièce", 5),
  withMin("Pomme de douche", "Robinetterie", "pièce", 5),
  withMin("Joint fibre robinet (lot de 10)", "Robinetterie", "lot", 4),
  withMin("Joint torique robinet (lot de 10)", "Robinetterie", "lot", 4),
  withMin("Cartouche céramique mitigeur", "Robinetterie", "pièce", 4),
  withMin("Siphon lavabo", "Robinetterie", "pièce", 4),
  withMin("Siphon évier", "Robinetterie", "pièce", 4),
  withMin("Flexible alimentation eau 40cm", "Robinetterie", "pièce", 10),
  withMin("Flexible alimentation eau 60cm", "Robinetterie", "pièce", 10),
  withMin("Raccord laiton 15/21", "Robinetterie", "pièce", 10),
  withMin("Raccord laiton 20/27", "Robinetterie", "pièce", 10),
  withMin("Ruban téflon", "Robinetterie", "pièce", 15),
  // Plomberie
  withMin("Colle PVC", "Plomberie", "pièce", 6),
  withMin("Nettoyant PVC", "Plomberie", "pièce", 6),
  withMin("Tube PVC évacuation 32mm (barre 2m)", "Plomberie", "pièce", 8),
  withMin("Tube PVC évacuation 40mm (barre 2m)", "Plomberie", "pièce", 8),
  withMin("Coude PVC 32mm", "Plomberie", "pièce", 10),
  withMin("Coude PVC 40mm", "Plomberie", "pièce", 10),
  withMin("Collier de serrage inox (lot de 10)", "Plomberie", "lot", 6),
  withMin("Silicone sanitaire blanc", "Plomberie", "pièce", 10),
  withMin("Silicone sanitaire transparent", "Plomberie", "pièce", 10),
  withMin("Déboucheur chimique canalisation", "Plomberie", "pièce", 6),
  // Électricité
  withMin("Prise électrique 2P+T", "Électricité", "pièce", 15),
  withMin("Interrupteur va-et-vient", "Électricité", "pièce", 15),
  withMin("Disjoncteur 16A", "Électricité", "pièce", 6),
  withMin("Disjoncteur 20A", "Électricité", "pièce", 6),
  withMin("Fusible 10A (lot de 5)", "Électricité", "lot", 4),
  withMin("Ampoule LED E27", "Électricité", "pièce", 30),
  withMin("Ampoule LED GU10", "Électricité", "pièce", 30),
  withMin("Détecteur avertisseur de fumée (DAF)", "Électricité", "pièce", 10),
  withMin("Pile 9V (pour DAF)", "Électricité", "pièce", 20),
  withMin("Pile AA (lot de 4)", "Électricité", "lot", 10),
  withMin("Ruban isolant électrique", "Électricité", "pièce", 10),
  withMin("Douille B22", "Électricité", "pièce", 10),
  withMin("Câble électrique 3G1.5mm² (rouleau 25m)", "Électricité", "pièce", 4),
  // Quincaillerie
  withMin("Assortiment vis à bois (boîte)", "Quincaillerie", "boîte", 6),
  withMin("Chevilles Molly (lot de 20)", "Quincaillerie", "lot", 6),
  withMin("Chevilles nylon (lot de 50)", "Quincaillerie", "lot", 6),
  withMin("Silicone multi-usage", "Quincaillerie", "pièce", 8),
  withMin("Cadenas", "Quincaillerie", "pièce", 6),
  withMin("Serrure de porte intérieure", "Quincaillerie", "pièce", 4),
  withMin("Poignée de porte", "Quincaillerie", "pièce", 8),
  withMin("Charnière de porte", "Quincaillerie", "pièce", 10),
  withMin("Butée de porte", "Quincaillerie", "pièce", 10),
  // Consommables
  withMin("Gants latex jetables (boîte)", "Consommables", "boîte", 10),
  withMin("Masques FFP2 (boîte)", "Consommables", "boîte", 6),
  withMin("Sacs poubelle 110L (rouleau)", "Consommables", "rouleau", 10),
  withMin("Produit désinfectant surfaces", "Consommables", "pièce", 10),
  withMin("Papier toilette (colis)", "Consommables", "colis", 10),
];

export function watchStockProduits(callback) {
  return onSnapshot(collection(db, "stock-produits"), (snap) => {
    const list = [];
    snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
    callback(list.sort((a, b) => (a.categorie || "").localeCompare(b.categorie || "") || (a.nom || "").localeCompare(b.nom || "")));
  }, (err) => { console.error("watchStockProduits:", err); callback([]); });
}

export async function createProduit(data) {
  const ref = await addDoc(collection(db, "stock-produits"), data);
  return ref.id;
}

export async function saveProduit(id, data) {
  await setDoc(doc(db, "stock-produits", id), data);
}

export async function deleteProduit(id) {
  await deleteDoc(doc(db, "stock-produits", id));
}

// Charge la liste type en une fois (utile au premier démarrage du module).
export async function seedProduitsType() {
  for (const p of PRODUITS_TYPE) {
    await addDoc(collection(db, "stock-produits"), p);
  }
}

// Enregistre un comptage d'inventaire : met à jour le stock actuel du
// produit et journalise le mouvement (historique).
export async function enregistrerInventaire(produitId, quantiteAvant, quantiteApres, uid) {
  await updateDoc(doc(db, "stock-produits", produitId), {
    stockActuel: quantiteApres,
    dateDernierInventaire: serverTimestamp(),
  });
  await addDoc(collection(db, "stock-mouvements"), {
    produitId, quantiteAvant, quantiteApres, uid, date: serverTimestamp(),
  });
}

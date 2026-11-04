// demandes-photos.js — Photos jointes à une demande d'intervention (création dans l'appli, ou ajout ensuite).
// Une photo = un petit document (≈ 80 Ko, image compressée) dans la collection des photos de l'appli,
// marqué type « demande » + demandeId : rien n'alourdit la demande elle-même (copiée sur tous les appareils).
import { db, auth } from "./firebase-init.js";
import { collection, addDoc, deleteDoc, doc, query, where, getDocs } from "./firestore-compte.js";

const COL = "fiches-photos"; // règles déjà publiées : chacun peut ajouter ses propres photos (agentUid = soi)

export async function compresserImage(fichier, max = 1100) {
  const url = URL.createObjectURL(fichier);
  try {
    const img = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ko(new Error("Image illisible")); i.src = url; });
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas"); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    let q = 0.65, out = c.toDataURL("image/jpeg", q);
    while (out.length > 140000 && q > 0.3) { q -= 0.08; out = c.toDataURL("image/jpeg", q); }
    return out;
  } finally { URL.revokeObjectURL(url); }
}
export async function ajouterPhotoDemande(demandeId, data, par = "") {
  const uid = auth.currentUser?.uid; if (!uid) throw new Error("Non connecté");
  return addDoc(collection(db, COL), { type: "demande", demandeId, agentUid: uid, par, data, legende: "", le: Date.now() });
}
export async function photosDemande(demandeId) {
  const s = await getDocs(query(collection(db, COL), where("demandeId", "==", demandeId)));
  return s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.le || 0) - (b.le || 0));
}
export const supprimerPhotoDemande = (id) => deleteDoc(doc(db, COL, id));

// Visionneuse plein écran (‹ › pour passer d'une photo à l'autre).
export function voirPhotos(liste, i = 0) {
  if (!liste.length) return;
  const v = document.createElement("div"); v.className = "dph-visio";
  const dessiner = () => { v.innerHTML = `<img src="${liste[i].data}" alt=""><div class="dph-visio-b">${liste.length > 1 ? `<button data-p>‹</button><span>${i + 1} / ${liste.length}</span><button data-n>›</button>` : ""}<button data-x>✕ Fermer</button></div>`;
    v.querySelector("[data-x]").onclick = () => v.remove();
    v.querySelector("[data-p]")?.addEventListener("click", (e) => { e.stopPropagation(); i = (i + liste.length - 1) % liste.length; dessiner(); });
    v.querySelector("[data-n]")?.addEventListener("click", (e) => { e.stopPropagation(); i = (i + 1) % liste.length; dessiner(); }); };
  v.addEventListener("click", (e) => { if (e.target === v) v.remove(); });
  document.body.appendChild(v); dessiner();
}

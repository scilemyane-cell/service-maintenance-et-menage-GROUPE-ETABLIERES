// ecoute-partagee.js
// Quota gratuit Firestore : 50 000 lectures / jour pour toute l'appli. Chaque
// nouvelle écoute (onSnapshot) relit TOUS les documents de la requête. On garde
// donc une seule écoute par requête pour toute la session : revenir sur
// l'accueil ou rouvrir une tuile ne relit rien, seuls les documents modifiés
// sont ensuite facturés.
const PARTAGES = new Map();

export function ecoutePartagee(cle, demarrer, callback) {
  let p = PARTAGES.get(cle);
  if (!p) {
    p = { abonnes: new Set(), valeur: undefined };
    PARTAGES.set(cle, p);
    demarrer((v) => { p.valeur = v; p.abonnes.forEach(cb => { try { cb(v); } catch (e) { console.error(e); } }); });
  }
  p.abonnes.add(callback);
  if (p.valeur !== undefined) setTimeout(() => { if (p.abonnes.has(callback)) callback(p.valeur); }, 0);
  return () => { p.abonnes.delete(callback); };
}

// Transforme une fonction watchXxx(callback) en version partagée.
export const partager = (cle, brut) => (callback) => ecoutePartagee(cle, (emettre) => brut(emettre), callback);

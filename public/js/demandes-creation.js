// demandes-creation.js — Nouvelle demande saisie directement dans l'appli
// (technicien sur le terrain, superviseur…). Numérotée « SMM-001 »… pour ne
// pas entrer en conflit avec les N° du fichier Excel ; envoyée au fichier
// via le fichier des mises à jour (liste « nouvelles », ajoutées par le
// flux Power Automate n° 2).
import { db } from "./firebase-init.js";
import { doc, collection, runTransaction, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { esc } from "./astreinte-logic.js";

const URGENCES = ["Normal", "Urgent", "À planifier", "Critique"];
const aujourdhui = () => new Date().toISOString().slice(0, 10);

async function creerDemande(champs) {
  const refCompteur = doc(db, "config", "compteur-demandes-app");
  const refNouvelle = doc(collection(db, "demandes"));
  return runTransaction(db, async (tx) => {
    const s = await tx.get(refCompteur);
    const n = (s.exists() ? (s.data().dernier || 0) : 0) + 1;
    const numero = `SMM-${String(n).padStart(3, "0")}`;
    tx.set(refCompteur, { dernier: n }, { merge: true });
    tx.set(refNouvelle, { ...champs, numero, creeDansApp: true, importeLe: serverTimestamp(), dateMaj: serverTimestamp() });
    return numero;
  });
}

// lignes : demandes déjà connues (pour proposer sites, associations, types).
export function ouvrirNouvelleDemande({ lignes = [], siteDefaut = "", utilisateur = "", onCree = () => {} }) {
  const sites = {}; lignes.forEach(l => { if (l.site && l.site !== "Non renseigné") sites[l.site] = sites[l.site] || l.association; });
  const nomsSites = Object.keys(sites).sort((a, b) => a.localeCompare(b, "fr"));
  const types = [...new Set(lignes.map(l => l.type).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr"));
  const fond = document.createElement("div");
  fond.className = "ndm-fond";
  fond.innerHTML = `
  <form class="ndm" autocomplete="off">
    <div class="ndm-tete"><h3>➕ Nouvelle demande</h3><button type="button" class="ndm-x" data-fermer aria-label="Fermer">✕</button></div>
    <label>Site<input name="site" list="ndm-sites" required value="${esc(siteDefaut)}" placeholder="Choisis ou tape le site"><datalist id="ndm-sites">${nomsSites.map(s => `<option value="${esc(s)}">`).join("")}</datalist></label>
    <div class="ndm-2">
      <label>Association<select name="association">${["Agropolis", "École", "Armonia", "Autres"].map(a => `<option ${a === (sites[siteDefaut] || "") ? "selected" : ""}>${a}</option>`).join("")}</select></label>
      <label>Local / pièce<input name="local" placeholder="ex. CH 301, Internat…"></label>
    </div>
    <div class="ndm-2">
      <label>Type<input name="type" list="ndm-types" placeholder="ex. Plomberie"><datalist id="ndm-types">${types.map(t => `<option value="${esc(t)}">`).join("")}</datalist></label>
      <label>Urgence<select name="urgence">${URGENCES.map(u => `<option>${u}</option>`).join("")}</select></label>
    </div>
    <label>Descriptif<textarea name="descriptif" rows="3" required placeholder="Ce qui ne va pas, où, depuis quand…"></textarea><button type="button" class="dps-ia dps-ia-mini" data-ndm-ia>✨ Mettre au propre</button></label>
    <div class="ndm-2">
      <label>Demandeur<input name="demandeur" value="${esc(utilisateur)}"></label>
      <label>Logement occupé<select name="logementOccupe"><option value="">—</option><option>OUI</option><option>NON</option></select></label>
    </div>
    <div class="ndm-etat" aria-live="polite"></div>
    <div class="ndm-btns"><button type="button" class="dps-annuler" data-fermer>Annuler</button><button type="submit" class="dps-enregistrer">➕ Créer la demande</button></div>
  </form>`;
  document.body.appendChild(fond);
  const f = fond.querySelector("form"), etat = fond.querySelector(".ndm-etat");
  const fermer = () => fond.remove();
  fond.querySelectorAll("[data-fermer]").forEach(b => b.addEventListener("click", fermer));
  fond.addEventListener("click", (e) => { if (e.target === fond) fermer(); });
  f.site.addEventListener("change", () => { const a = sites[f.site.value]; if (a) f.association.value = a; });
  fond.querySelector("[data-ndm-ia]").addEventListener("click", async (e) => {
    const t = f.descriptif.value.trim(); if (!t) { f.descriptif.focus(); return; }
    const b = e.currentTarget; b.disabled = true; const avant = b.textContent; b.textContent = "⏳ IA…";
    try { const { redigerCommentaireDemande } = await import("./ia.js"); const r = (await redigerCommentaireDemande({ descr: "", notes: t })).replace(/\*\*/g, "").trim(); if (r) f.descriptif.value = r; }
    catch (err) { alert("IA indisponible : " + (err?.message || err)); }
    finally { b.disabled = false; b.textContent = avant; }
  });
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(f).entries());
    if (!v.site.trim() || !v.descriptif.trim()) return;
    const bouton = f.querySelector('[type="submit"]'); bouton.disabled = true; etat.textContent = "⏳ Création…";
    try {
      const numero = await creerDemande({
        dateDemande: aujourdhui(), site: v.site.trim(), association: v.association, local: v.local.trim(), type: v.type.trim(),
        urgence: v.urgence, descriptif: v.descriptif.trim(), demandeur: v.demandeur.trim(), logementOccupe: v.logementOccupe,
        statut: "Pris en compte", dateStatut: aujourdhui(), creePar: utilisateur,
      });
      window.toast?.(`✓ Demande ${numero} créée — elle sera ajoutée au fichier Excel.`);
      fermer(); onCree(numero, v.site.trim());
    } catch (err) { console.error(err); etat.textContent = "❌ " + (err?.message || err); bouton.disabled = false; }
  });
  setTimeout(() => (siteDefaut ? f.descriptif : f.site).focus(), 50);
}

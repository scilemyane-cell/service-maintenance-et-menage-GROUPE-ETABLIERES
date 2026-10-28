// demandes-externes.js — Demandes d'intervention envoyées par un prestataire
// extérieur (ex. restaurant scolaire) via un lien personnel, sans compte.
//  • « liens-demande/{token} » : un lien par prestataire / site (actif ou coupé) ;
//  • « demandes-externes/{id} » : ce que le prestataire envoie (statut
//    « nouvelle » → « creee » quand le responsable la transforme en vraie
//    demande SMM-xxx, ou « refusee »).
// Le responsable les voit en tête du Suivi des demandes, avec un bouton
// « ✓ Créer la demande ».
import { db } from "./firebase-init.js";
import { collection, doc, setDoc, updateDoc, onSnapshot, serverTimestamp } from "./firestore-compte.js";
import { esc } from "./astreinte-logic.js";
import { creerDemande } from "./demandes-creation.js";

const LIENS = "liens-demande", EXT = "demandes-externes";
let liens = [], recues = [], abonne = false, hote = null, ctx = {}, ouvertGestion = false;
const urlLien = (t) => `${location.origin}/demande-guest.html?l=${t}`;
const frDate = (ms) => ms ? new Date(ms).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
const auj = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const ms = (v) => v?.toMillis ? v.toMillis() : v?.seconds ? v.seconds * 1000 : (typeof v === "number" ? v : 0);

function abonner() {
  if (abonne) return; abonne = true;
  onSnapshot(collection(db, LIENS), (s) => { liens = s.docs.map(d => ({ id: d.id, ...d.data() })); rendre(); }, () => {});
  onSnapshot(collection(db, EXT), (s) => { recues = s.docs.map(d => ({ id: d.id, ...d.data() })); rendre(); }, () => {});
}

// À appeler après chaque rendu du Suivi des demandes (responsables uniquement).
export function monterDemandesExternes(el, contexte) { hote = el; ctx = contexte || {}; abonner(); rendre(); }

function rendre() {
  if (!hote || !document.contains(hote)) return;
  const nouv = recues.filter(r => r.statut === "nouvelle").sort((a, b) => ms(b.creeLe) - ms(a.creeLe));
  const sites = [...new Set((ctx.lignes || []).map(l => l.site).filter(s => s && s !== "Non renseigné"))].sort((a, b) => a.localeCompare(b, "fr"));
  hote.innerHTML = `
  ${nouv.length ? `<section class="dex-bloc">
    <div class="dps-valid-tete"><h3>📥 ${nouv.length} demande${nouv.length > 1 ? "s" : ""} de prestataire${nouv.length > 1 ? "s" : ""}</h3><p>Envoyées via un lien extérieur (sans compte). Vérifie puis crée la demande — elle prend un numéro SMM et suit le circuit normal.</p></div>
    <div class="dex-cartes">${nouv.map(r => `<div class="dex-carte">
      <div class="dex-tete"><b>🏠 ${esc(r.site)}${r.local ? ` · ${esc(r.local)}` : ""}</b><span class="dex-urg ${esc(r.urgence || "Normal")}">${esc(r.urgence || "Normal")}</span></div>
      <p class="dex-txt">${esc(r.descriptif || "").replace(/\n/g, "<br>")}</p>
      ${(r.photos || []).length ? `<div class="dex-photos">${r.photos.map(p => `<a href="${p}" target="_blank" rel="noopener"><img src="${p}" alt=""></a>`).join("")}</div>` : ""}
      <small>👤 ${esc(`${r.prenom || ""} ${r.nom || ""}`.trim())}${r.societe ? ` · ${esc(r.societe)}` : ""}${r.telephone ? ` · 📞 ${esc(r.telephone)}` : ""} · ${frDate(ms(r.creeLe))}${r.type ? ` · ${esc(r.type)}` : ""}</small>
      <div class="dex-btns"><button type="button" class="dps-annuler" data-dex-refus="${r.id}">✕ Refuser</button><button type="button" class="dps-enregistrer" data-dex-ok="${r.id}">✓ Créer la demande</button></div>
    </div>`).join("")}</div>
  </section>` : ""}
  <details class="dex-gestion" ${ouvertGestion ? "open" : ""}><summary>🔗 Liens « demande d'intervention » pour prestataires extérieurs (${liens.filter(l => l.actif !== false).length} actif${liens.filter(l => l.actif !== false).length > 1 ? "s" : ""})</summary>
    <p class="hint">Le prestataire ouvre le lien, indique son nom et prénom et envoie sa demande (avec photo). Elle arrive ici, à valider.</p>
    <form class="dex-form" id="dex-form">
      <label>Site<input name="site" list="dex-sites" required placeholder="ex. Restaurant scolaire" value="${liens.some(l => /restaurant scolaire/i.test(l.site || "")) ? "" : esc(sites.find(x => /restaurant scolaire/i.test(x)) || "")}"><datalist id="dex-sites">${sites.map(s => `<option value="${esc(s)}">`).join("")}</datalist></label>
      <label>Prestataire / société<input name="label" required placeholder="ex. Société de restauration"></label>
      <label>Association<select name="association">${["École", "Agropolis", "Armonia", "Autres"].map(a => `<option>${a}</option>`).join("")}</select></label>
      <button class="add-btn">➕ Créer le lien</button>
    </form>
    ${liens.length ? `<div class="dex-liens">${liens.sort((a, b) => ms(b.creeLe) - ms(a.creeLe)).map(l => { const n = recues.filter(r => r.lien === l.id).length; return `<div class="dex-lien ${l.actif === false ? "coupe" : ""}">
      <div><b>${esc(l.label || "")}</b> — ${esc(l.site || "")}<small>${l.actif === false ? "⛔ coupé" : "✅ actif"} · ${n} demande${n > 1 ? "s" : ""} reçue${n > 1 ? "s" : ""}</small><code>${esc(urlLien(l.id))}</code></div>
      <span class="dex-l-btns"><button type="button" class="nav-btn" data-dex-copie="${l.id}">📋 Copier</button><a class="nav-btn" href="mailto:?subject=${encodeURIComponent(`Demandes d'intervention — ${l.site}`)}&body=${encodeURIComponent(`Bonjour,\n\nPour toute demande d'intervention (panne, dépannage, réparation) sur le site ${l.site}, merci d'utiliser ce lien :\n${urlLien(l.id)}\n\nIl suffit d'indiquer votre nom, de décrire le problème et d'ajouter une photo si possible. La demande arrive directement au service maintenance.\n\nCordialement,\n${ctx.utilisateur || "Service Maintenance"}\nGroupe Établières`)}">✉️ Mail</a>
      <button type="button" class="nav-btn" data-dex-actif="${l.id}">${l.actif === false ? "▶ Réactiver" : "⛔ Couper"}</button></span>
    </div>`; }).join("")}</div>` : ""}
  </details>`;
  brancher();
}

function brancher() {
  hote.querySelector(".dex-gestion")?.addEventListener("toggle", (e) => { ouvertGestion = e.target.open; });
  hote.querySelector("#dex-form")?.addEventListener("submit", async (e) => {
    e.preventDefault(); const f = new FormData(e.target);
    const id = crypto.getRandomValues(new Uint32Array(3)).reduce((t, x) => t + x.toString(36), "").slice(0, 16);
    try { await setDoc(doc(db, LIENS, id), { site: String(f.get("site")).trim(), label: String(f.get("label")).trim(), association: f.get("association"), actif: true, creeLe: serverTimestamp(), creePar: ctx.utilisateur || "" }); ouvertGestion = true; window.toast?.("🔗 Lien créé : copie-le et envoie-le au prestataire."); }
    catch (err) { alert("Création impossible : " + (err?.message || err) + "\n(As-tu publié les règles Firestore « liens-demande » ?)"); }
  });
  hote.querySelectorAll("[data-dex-copie]").forEach(b => b.addEventListener("click", async () => { try { await navigator.clipboard.writeText(urlLien(b.dataset.dexCopie)); b.textContent = "✓ Copié"; } catch { prompt("Copie ce lien :", urlLien(b.dataset.dexCopie)); } }));
  hote.querySelectorAll("[data-dex-actif]").forEach(b => b.addEventListener("click", async () => { const l = liens.find(x => x.id === b.dataset.dexActif); if (l) await updateDoc(doc(db, LIENS, l.id), { actif: l.actif === false }); }));
  hote.querySelectorAll("[data-dex-refus]").forEach(b => b.addEventListener("click", async () => {
    const motif = prompt("Refuser cette demande ? Motif (facultatif) :", ""); if (motif === null) return;
    await updateDoc(doc(db, EXT, b.dataset.dexRefus), { statut: "refusee", motif, traiteLe: Date.now(), traitePar: ctx.utilisateur || "" });
  }));
  hote.querySelectorAll("[data-dex-ok]").forEach(b => b.addEventListener("click", async () => {
    const r = recues.find(x => x.id === b.dataset.dexOk); if (!r) return; b.disabled = true; b.textContent = "⏳…";
    try {
      const qui = `${r.prenom || ""} ${String(r.nom || "").toUpperCase()}`.trim() + (r.societe ? ` (${r.societe})` : "");
      const numero = await creerDemande({
        site: r.site, association: r.association || "Autres", local: r.local || "", type: r.type || "", urgence: r.urgence || "Normal",
        descriptif: r.descriptif + (r.telephone ? `\nContact : ${r.telephone}` : "") + ((r.photos || []).length ? `\n📷 ${(r.photos || []).length} photo(s) envoyée(s) par le prestataire` : ""), demandeur: qui, logementOccupe: "",
        statut: "Pris en compte", dateStatut: auj(), dateDemande: auj(), creePar: ctx.utilisateur || "", origine: "prestataire", demandeExterneId: r.id,
      });
      await updateDoc(doc(db, EXT, r.id), { statut: "creee", numero, traiteLe: Date.now(), traitePar: ctx.utilisateur || "" });
      window.toast?.(`✓ Demande ${numero} créée`, "success");
      ctx.apres?.();
    } catch (err) { alert("Création impossible : " + (err?.message || err)); b.disabled = false; b.textContent = "✓ Créer la demande"; }
  }));
}

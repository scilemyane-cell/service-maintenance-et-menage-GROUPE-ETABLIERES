// demandes-mail.js — Envoyer une demande par e-mail à un gestionnaire
// (bailleur) ou à un artisan : l'appli prépare le message et ouvre la
// messagerie (Outlook) avec destinataire, objet et texte déjà remplis.
// Carnet de contacts partagé : config/contacts-demandes.
import { db } from "./firebase-init.js";
import { doc, onSnapshot, setDoc } from "./firestore-compte.js";
import { esc } from "./astreinte-logic.js";

const REF = doc(db, "config", "contacts-demandes");
let contacts = [], abonne = false;
function suivreContacts() {
  if (abonne) return; abonne = true;
  onSnapshot(REF, (s) => { contacts = s.exists() ? (s.data().contacts || []) : []; }, () => {});
}
const fr = (iso) => (iso ? String(iso).slice(0, 10).split("-").reverse().join("/") : "");

function modele(type, l, utilisateur) {
  const lieu = [l.site, l.local && `local / logement ${l.local}`].filter(Boolean).join(" — ");
  const objet = `${type === "gestionnaire" ? "Signalement" : "Demande d'intervention"} ${l.n} — ${l.site}${l.local ? ` (${l.local})` : ""}`;
  const details = [
    `Lieu : ${lieu}`,
    `Problème : ${l.descr || "—"}`,
    l.urgence && l.urgence !== "Non renseignée" ? `Urgence : ${l.urgence}` : "",
    l.logementOccupe ? `Logement occupé : ${l.logementOccupe}` : "",
    l.date ? `Demande du ${fr(l.date)}${l.demandeur ? ` (${l.demandeur})` : ""}` : "",
    `Réf. interne : ${l.n}`,
  ].filter(Boolean).join("\n");
  const corps = type === "gestionnaire"
    ? `Bonjour,\n\nJe te signale le problème suivant, à prendre en charge côté bailleur :\n\n${details}\n\nPeux-tu me confirmer la prise en compte et me dire quand une intervention est prévue ?\n\nMerci,\n${utilisateur}\nService Maintenance — Groupe Établières`
    : `Bonjour,\n\nPeux-tu intervenir pour la demande suivante :\n\n${details}\n\nMerci de m'envoyer un devis ou de me proposer une date d'intervention.\n\nMerci,\n${utilisateur}\nService Maintenance — Groupe Établières`;
  return { objet, corps };
}

export function ouvrirEnvoiMail({ ligne: l, utilisateur = "", peutMemoriser = false, maj = null }) {
  suivreContacts();
  let type = "artisan";
  const fond = document.createElement("div");
  fond.className = "ndm-fond";
  const dessiner = (garder = {}) => {
    const m = modele(type, l, utilisateur);
    const liste = contacts.filter(c => c.type === type);
    fond.innerHTML = `<form class="ndm mail">
      <div class="ndm-tete"><h3>✉️ Envoyer ${esc(l.n)} par mail</h3><button type="button" class="ndm-x" data-fermer>✕</button></div>
      <div class="mail-type">${[["artisan", "🔧 Artisan / entreprise"], ["gestionnaire", "🏢 Gestionnaire / bailleur"]].map(([k, lib]) => `<button type="button" data-type="${k}" class="${type === k ? "on" : ""}">${lib}</button>`).join("")}</div>
      <label>À<input name="a" list="mail-contacts" type="text" required placeholder="nom@entreprise.fr" value="${esc(garder.a || "")}"><datalist id="mail-contacts">${liste.map(c => `<option value="${esc(c.email)}">${esc(c.nom)}</option>`).join("")}</datalist></label>
      ${liste.length ? `<div class="mail-contacts">${liste.map(c => `<button type="button" data-contact="${esc(c.email)}">${esc(c.nom)}</button>`).join("")}</div>` : ""}
      <label>Objet<input name="objet" value="${esc(garder.objet || m.objet)}"></label>
      <label>Message<textarea name="corps" rows="11">${esc(garder.corps || m.corps)}</textarea></label>
      <p class="mail-aide">Le message s'ouvre dans ta messagerie (Outlook) : tu peux encore le modifier et y joindre des photos avant d'envoyer.</p>
      <div class="ndm-btns">
        ${peutMemoriser ? `<button type="button" class="dps-annuler" data-memo>💾 Mémoriser ce contact</button>` : ""}
        <button type="submit" class="dps-enregistrer">📧 Ouvrir dans Outlook</button>
      </div>
    </form>`;
    const f = fond.querySelector("form");
    fond.querySelectorAll("[data-fermer]").forEach(b => b.addEventListener("click", () => fond.remove()));
    fond.querySelectorAll("[data-type]").forEach(b => b.addEventListener("click", () => { type = b.dataset.type; dessiner({ a: f.a.value }); }));
    fond.querySelectorAll("[data-contact]").forEach(b => b.addEventListener("click", () => { f.a.value = b.dataset.contact; }));
    fond.querySelector("[data-memo]")?.addEventListener("click", async () => {
      const email = f.a.value.trim(); if (!/@/.test(email)) { f.a.focus(); return; }
      const nom = prompt("Nom du contact (ex. Vendée Habitat, Plomberie Dupont) :", contacts.find(c => c.email === email)?.nom || "");
      if (!nom) return;
      const nv = [...contacts.filter(c => c.email !== email), { nom: nom.trim(), email, type }].sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
      try { await setDoc(REF, { contacts: nv }, { merge: true }); contacts = nv; window.toast?.("✓ Contact mémorisé"); dessiner({ a: email, objet: f.objet.value, corps: f.corps.value }); }
      catch (e) { alert("Échec : " + (e?.message || e)); }
    });
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const a = f.a.value.trim();
      const url = `mailto:${encodeURIComponent(a).replace(/%40/g, "@").replace(/%2C/gi, ",")}?subject=${encodeURIComponent(f.objet.value)}&body=${encodeURIComponent(f.corps.value.replace(/\n/g, "\r\n"))}`;
      window.location.href = url;
      const nom = contacts.find(c => c.email === a)?.nom || a;
      if (maj) {
        try { await maj(l.id, { mailsEnvoyes: [...(Array.isArray(l.mailsEnvoyes) ? l.mailsEnvoyes : []), { a: nom, type, le: new Date().toISOString(), par: utilisateur }] }); } catch (err) { console.warn("Trace mail :", err); }
      }
      fond.remove();
    });
  };
  dessiner();
  document.body.appendChild(fond);
  fond.addEventListener("click", (e) => { if (e.target === fond) fond.remove(); });
}

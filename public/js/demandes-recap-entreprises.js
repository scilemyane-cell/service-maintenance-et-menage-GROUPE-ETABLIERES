// demandes-recap-entreprises.js
// Récap par entreprise extérieure : ce qu'elle a à faire (demandes ouvertes
// qui lui sont attribuées), ce qui attend validation et ce qu'elle a réalisé
// récemment. Impression / PDF et mail à l'entreprise.
import { esc } from "./astreinte-logic.js";
import { imprimerListe } from "./demandes-impression.js";

const fr = (x) => (x ? String(x).slice(0, 10).split("-").reverse().join("/") : "");
const cle = (x) => String(x || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const TRAITE = (s) => s === "Réalisé" || s === "Annulé";
const A_VALIDER = (s) => /à valider/i.test(s || "");
const ORDRE_URG = { Critique: 0, Urgent: 1, "À planifier": 2, Normal: 3 };
const recente = (l) => { const d = l.dateIntervention || l.dateStatut || ""; return d && new Date(d.slice(0, 10)).getTime() >= Date.now() - 30 * 864e5; };

// Demande de l'entreprise : attribuée à elle, ou (anciennes) contact « Externe » à son nom.
const estDe = (l, nom) => !l.lieeA && (l.attribueA === "ext" ? cle(l.attribueANom) === cle(nom) : !l.attribueA && /externe/i.test(l.categorieIntervenant || "") && cle(l.intervenant) === cle(nom));

export function recapEntreprises(lignes, entreprises) {
  const noms = new Map();
  entreprises.forEach(e => noms.set(cle(e.nom), e));
  lignes.forEach(l => { if (l.attribueA === "ext" && l.attribueANom && !noms.has(cle(l.attribueANom))) noms.set(cle(l.attribueANom), { nom: l.attribueANom }); });
  return [...noms.values()].map(e => {
    const toutes = lignes.filter(l => estDe(l, e.nom));
    const aFaire = toutes.filter(l => !TRAITE(l.statut) && !A_VALIDER(l.statut)).sort((a, b) => ((ORDRE_URG[a.urgence] ?? 9) - (ORDRE_URG[b.urgence] ?? 9)) || (a.date || "").localeCompare(b.date || ""));
    return { e, aFaire, enValid: toutes.filter(l => A_VALIDER(l.statut)), faites: toutes.filter(l => l.statut === "Réalisé" && recente(l)) };
  }).sort((a, b) => (b.aFaire.length - a.aFaire.length) || a.e.nom.localeCompare(b.e.nom, "fr"));
}

function texteMail(r) {
  const lignes = r.aFaire.map(l => `- ${l.n} · ${l.site}${l.local ? ` (${l.local})` : ""} : ${l.descr || ""}${l.urgence && !/non/i.test(l.urgence) ? ` [${l.urgence}]` : ""}${l.date ? ` — demandé le ${fr(l.date)}` : ""}`);
  let corps = `Bonjour${r.e.contact ? ` ${r.e.contact}` : ""},\n\nVoici les demandes d'intervention en cours qui vous sont confiées par le Groupe Établières (${r.aFaire.length}) :\n\n`;
  let liste = "";
  for (const x of lignes) { if ((corps + liste + x).length > 1600) { liste += `… et ${lignes.length - liste.split("\n").filter(Boolean).length} autre(s), voir le récapitulatif joint.\n`; break; } liste += x + "\n"; }
  return corps + liste + "\nMerci de nous indiquer vos dates de passage.\n\nCordialement,\nService Maintenance — Groupe Établières";
}

export function ouvrirRecapEntreprises({ lignes, entreprises }) {
  const recap = recapEntreprises(lignes, entreprises);
  let ouvert = recap.find(r => r.aFaire.length)?.e.nom || "";
  const fond = document.createElement("div"); fond.className = "ndm-fond";
  const dessiner = () => {
    fond.innerHTML = `<div class="ndm rce">
      <div class="ndm-tete"><h3>📋 Récap par entreprise</h3><button type="button" class="ndm-x" data-fermer>✕</button></div>
      <p class="gaf-aide">Demandes attribuées à chaque entreprise extérieure (et anciennes demandes notées « Externe » à son nom).</p>
      ${recap.length ? `<div class="rce-liste">${recap.map(r => `
        <section class="rce-ent ${ouvert === r.e.nom ? "ouvert" : ""}">
          <button type="button" class="rce-tete" data-ouvrir="${esc(r.e.nom)}">
            <span class="rce-nom"><b>🏢 ${esc(r.e.nom)}</b>${r.e.metier ? `<small>${esc(r.e.metier)}</small>` : ""}</span>
            <span class="rce-chiffres"><span class="${r.aFaire.length ? "af" : "zero"}"><b>${r.aFaire.length}</b> à faire</span>${r.enValid.length ? `<span class="va"><b>${r.enValid.length}</b> à valider</span>` : ""}<span class="ok"><b>${r.faites.length}</b> faites (30 j)</span></span>
          </button>
          ${ouvert === r.e.nom ? `<div class="rce-corps">
            <div class="rce-coord">${r.e.contact ? `👤 ${esc(r.e.contact)}` : ""}${r.e.tel ? ` <a href="tel:${esc(r.e.tel.replace(/\s/g, ""))}">📞 ${esc(r.e.tel)}</a>` : ""}${r.e.email ? ` <a href="mailto:${esc(r.e.email)}">✉️ ${esc(r.e.email)}</a>` : ""}</div>
            ${r.aFaire.length ? `<table class="rce-table"><thead><tr><th>N°</th><th>Site / local</th><th>Demande</th><th>Urgence</th><th>Depuis</th><th>Statut</th></tr></thead><tbody>${r.aFaire.map(l => `<tr class="${l.urgence === "Critique" || l.urgence === "Urgent" ? "urg" : ""}"><td><b>${esc(l.n)}</b></td><td>${esc(l.site)}${l.local ? `<br><small>📍 ${esc(l.local)}</small>` : ""}</td><td>${esc(l.descr || "")}${l.commentaireTech ? `<br><small>💬 ${esc(l.commentaireTech)}</small>` : ""}</td><td>${esc(/non/i.test(l.urgence) ? "" : l.urgence)}</td><td>${fr(l.date)}</td><td>${esc(l.statut)}</td></tr>`).join("")}</tbody></table>` : `<p class="dps-vide">Rien à faire en ce moment.</p>`}
            ${r.faites.length ? `<details class="rce-faites"><summary>✓ ${r.faites.length} réalisée(s) ces 30 derniers jours</summary><ul>${r.faites.map(l => `<li><b>${esc(l.n)}</b> · ${esc(l.site)} — ${esc((l.descr || "").slice(0, 90))} <small>(${fr(l.dateIntervention || l.dateStatut)})</small></li>`).join("")}</ul></details>` : ""}
            <div class="rce-btns">
              <button type="button" class="dps-mail-btn" data-imprimer="${esc(r.e.nom)}">🖨 Imprimer / PDF</button>
              ${r.aFaire.length ? `<button type="button" class="dps-mail-btn" data-mail="${esc(r.e.nom)}">✉️ Envoyer la liste par mail${r.e.email ? "" : " (sans adresse)"}</button>` : ""}
            </div>
          </div>` : ""}
        </section>`).join("")}</div>` : `<p class="dps-vide">Aucune entreprise : ajoute-les avec « 🏢 Entreprises extérieures… ».</p>`}
      <div class="ndm-btns"><button type="button" class="dps-annuler" data-fermer>Fermer</button></div>
    </div>`;
    fond.querySelectorAll("[data-fermer]").forEach(b => b.addEventListener("click", () => fond.remove()));
    fond.querySelectorAll("[data-ouvrir]").forEach(b => b.addEventListener("click", () => { ouvert = ouvert === b.dataset.ouvrir ? "" : b.dataset.ouvrir; dessiner(); }));
    fond.querySelectorAll("[data-imprimer]").forEach(b => b.addEventListener("click", () => {
      const r = recap.find(x => x.e.nom === b.dataset.imprimer); if (!r) return;
      const coord = [r.e.metier, r.e.contact, r.e.tel, r.e.email].filter(Boolean).map(esc).join(" · ");
      imprimerListe({ titre: `🏢 ${r.e.nom}`, sousTitre: coord, sections: [{ titre: "À faire", liste: r.aFaire }, { titre: "En attente de validation", liste: r.enValid }, { titre: "Réalisées (30 derniers jours)", liste: r.faites }] });
    }));
    fond.querySelectorAll("[data-mail]").forEach(b => b.addEventListener("click", () => {
      const r = recap.find(x => x.e.nom === b.dataset.mail); if (!r) return;
      location.href = `mailto:${encodeURIComponent(r.e.email || "")}?subject=${encodeURIComponent(`Demandes d'intervention en cours — Groupe Établières (${r.aFaire.length})`)}&body=${encodeURIComponent(texteMail(r))}`;
    }));
  };
  dessiner();
  document.body.appendChild(fond);
  fond.addEventListener("click", (e) => { if (e.target === fond) fond.remove(); });
}

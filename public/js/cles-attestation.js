// cles-attestation.js — Attestation de remise de clé (document RH).
// Utilisé par la page de signature (cle-signature.html, accusé de réception)
// et par l'onglet Clés (consultation / impression PDF / transmission RH).
// Aucune dépendance Firebase : fonctions pures + rendu HTML.

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const dateLongue = (ms) => (ms ? new Date(ms).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : "—");
const dateHeure = (ms) => (ms ? new Date(ms).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—");

export const VERSION_ENGAGEMENT = "v1 — 18/10/2026";
export function engagementTexte(type = "Clé") {
  const b = type === "Badge", t = b ? "ce badge" : type === "Télécommande" ? "cette télécommande" : type === "Trousseau" ? "ce trousseau" : "cette clé";
  const le = b || type === "Trousseau" ? "le" : "la";
  return [
    `Je reconnais avoir reçu ${t} en bon état de fonctionnement, des mains du service Maintenance du Groupe Établières.`,
    `${b ? "Il" : type === "Trousseau" ? "Il" : "Elle"} m'est confié${b || type === "Trousseau" ? "" : "e"} pour les seuls besoins de mes fonctions. Je m'engage à ne ${le} prêter à personne, à ne pas ${le} reproduire ni ${le} faire reproduire.`,
    `Je m'engage à signaler sans délai au service Maintenance toute perte, tout vol ou toute détérioration.`,
    `Je m'engage à ${le} restituer à la fin de ma mission, en cas de départ ou de changement de poste, ou sur simple demande de l'établissement.`,
    `J'ai pris connaissance qu'en cas de perte, le remplacement de ${t} et, si nécessaire, des serrures ou du système d'accès concernés pourra être nécessaire pour garantir la sécurité des locaux.`,
  ];
}
export const reference = (p) => `RC-${new Date(p.sortieLe || Date.now()).getFullYear()}-${String(p.id || "").slice(0, 6).toUpperCase()}`;

export function infosAppareil() {
  const n = navigator, ua = n.userAgent || "";
  const os = /Windows/.test(ua) ? "Windows" : /iPhone|iPad/.test(ua) ? "iOS (iPhone/iPad)" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "inconnu";
  const nav = /Edg\//.test(ua) ? "Microsoft Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "inconnu";
  return {
    systeme: os, navigateur: nav, typeAppareil: /Mobi|Android|iPhone/.test(ua) ? "Téléphone" : /iPad|Tablet/.test(ua) ? "Tablette" : "Ordinateur",
    ecran: `${screen.width}×${screen.height}`, langue: n.language || "", fuseau: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
    tactile: (n.maxTouchPoints || 0) > 0, userAgent: ua.slice(0, 400),
  };
}
export async function empreinte(obj) {
  const data = new TextEncoder().encode(JSON.stringify(obj));
  const h = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(h), b => b.toString(16).padStart(2, "0")).join("");
}
// Contenu figé qui est « scellé » par l'empreinte au moment de la signature.
export const contenuScelle = (p, { nom, signeLe, signature }) => ({ ref: reference(p), cle: [p.cleType, p.cleNom, p.cleRepere, p.siteNom], personne: p.personneNom, email: p.personneEmail,
  remise: p.sortieLe, retourMax: p.retourMax || null, engagement: p.engagement || engagementTexte(p.cleType), nom, signeLe, signature });

export function attestationHTML(p, { base = "" } = {}) {
  const pr = p.preuve || {}, eng = p.engagement || engagementTexte(p.cleType), ap = pr.appareil || {};
  const ligne = (k, v) => v ? `<tr><th>${k}</th><td>${v}</td></tr>` : "";
  return `<div class="att">
    <div class="att-tete"><img src="${base}img/logo-etablieres.png" alt="" onerror="this.remove()"><div><b>Groupe Établières</b><span>Service Maintenance &amp; Ménage</span></div>
      <div class="att-ref"><span>Référence</span><b>${esc(reference(p))}</b></div></div>
    <h1>Attestation de remise ${p.cleType === "Badge" ? "de badge" : "de clé"}</h1>
    <p class="att-statut ${p.statut === "a-signer" ? "attente" : p.statut === "rendue" ? "rendue" : "ok"}">${p.statut === "a-signer" ? "⏳ En attente de signature" : p.statut === "rendue" ? "↩️ Restituée" : "✅ Signée — en possession du salarié"}</p>
    <h2>1. Bénéficiaire</h2>
    <table class="att-t">${ligne("Nom et prénom", `<b>${esc(p.personneNom)}</b>`)}${ligne("Adresse mail professionnelle", esc(p.personneEmail))}${ligne("Fonction", esc(p.personneFonction))}${ligne("Service / établissement", esc(p.personneService))}</table>
    <h2>2. Objet remis</h2>
    <table class="att-t">${ligne("Nature", esc(p.cleType || "Clé"))}${ligne("Désignation", `<b>${esc(p.cleNom)}</b>`)}${ligne("N° / repère", esc(p.cleRepere))}${ligne("Site", esc(p.siteNom))}${ligne("Motif de la remise", esc(p.motif))}${ligne("Note", esc(p.note))}</table>
    <h2>3. Conditions</h2>
    <table class="att-t">${ligne("Date de remise", dateLongue(p.sortieLe))}${ligne("Restitution prévue", p.retourMax ? `au plus tard le ${dateLongue(p.retourMax)}` : "durée indéterminée (fin de mission ou sur demande)")}${ligne("Remise effectuée par", esc(p.creePar))}</table>
    <h2>4. Engagement du bénéficiaire</h2>
    <ol class="att-eng">${eng.map(x => `<li>${esc(x)}</li>`).join("")}</ol>
    <p class="att-mini">Texte d'engagement ${esc(p.engagementVersion || VERSION_ENGAGEMENT)}</p>
    <h2>5. Signature</h2>
    ${p.signature ? `<div class="att-sig"><div><span>Lu et approuvé, signé électroniquement par</span><b>${esc(p.signeNom || p.personneNom)}</b><span>le ${dateHeure(p.signeLe)}</span>${pr.accepte ? `<span>☑ A coché « J'ai lu et j'accepte les conditions ci-dessus »</span>` : ""}</div><img src="${p.signature}" alt="signature"></div>`
      : `<p class="att-attente">Pas encore signée. Lien envoyé à ${esc(p.personneEmail)}.</p>`}
    ${p.statut === "rendue" ? `<h2>6. Restitution</h2><table class="att-t">${ligne("Restituée le", dateHeure(p.retourLe))}${ligne("Retour enregistré par", esc(p.retourPar))}${ligne("Durée de détention", `${Math.max(0, Math.round((p.retourLe - p.sortieLe) / 86400000))} jours`)}</table>` : ""}
    ${p.signature ? `<h2>${p.statut === "rendue" ? "7" : "6"}. Preuve de signature électronique</h2>
    <table class="att-t att-preuve">
      ${ligne("Mode de signature", "Lien personnel à usage unique envoyé sur la boîte mail professionnelle du bénéficiaire, signature manuscrite tracée à l'écran")}
      ${ligne("Lien envoyé à", esc(p.personneEmail))}${ligne("Demande créée le", dateHeure(p.creeLe || p.sortieLe))}${ligne("Page de signature ouverte le", dateHeure(pr.ouvertLe))}
      ${ligne("Signé le (horodatage)", `${dateHeure(p.signeLe)} <small>(${esc(ap.fuseau || "")})</small>`)}${ligne("Temps de lecture avant signature", pr.dureeLectureS != null ? `${pr.dureeLectureS} s` : "")}
      ${ligne("Appareil", esc([ap.typeAppareil, ap.systeme, ap.navigateur].filter(Boolean).join(" · ")))}${ligne("Écran / langue", esc([ap.ecran, ap.langue, ap.tactile ? "écran tactile" : ""].filter(Boolean).join(" · ")))}
      ${ligne("Identifiant de l'appareil", `<code>${esc(p.signeAppareil || "")}</code>`)}${ligne("Navigateur (détail)", `<small>${esc(ap.userAgent || "")}</small>`)}
      ${ligne("Empreinte SHA-256 du document signé", `<code class="att-hash">${esc(pr.empreinte || "")}</code>`)}
    </table>
    <p class="att-mini">L'empreinte SHA-256 est calculée au moment de la signature sur le contenu exact de cette attestation (bénéficiaire, objet, conditions, engagement, nom saisi, date et image de la signature) : toute modification ultérieure de ces éléments la rendrait différente.</p>` : ""}
    <p class="att-pied">Document généré par l'application Service Maintenance &amp; Ménage — Groupe Établières — ${esc(reference(p))}</p>
  </div>`;
}

export function texteRH(p) {
  const pr = p.preuve || {}, ap = pr.appareil || {};
  return `Bonjour,\n\nPour le dossier de ${p.personneNom}, voici l'attestation de remise ${p.cleType === "Badge" ? "de badge" : "de clé"} (réf. ${reference(p)}) :\n\n`
    + `• Bénéficiaire : ${p.personneNom} — ${p.personneEmail}${p.personneFonction ? ` — ${p.personneFonction}` : ""}${p.personneService ? ` (${p.personneService})` : ""}\n`
    + `• Objet : ${p.cleType || "Clé"} « ${p.cleNom} »${p.cleRepere ? ` n° ${p.cleRepere}` : ""}${p.siteNom ? ` — ${p.siteNom}` : ""}\n`
    + `• Remise le ${dateLongue(p.sortieLe)}${p.retourMax ? `, restitution au plus tard le ${dateLongue(p.retourMax)}` : ", durée indéterminée"}${p.motif ? ` — motif : ${p.motif}` : ""}\n`
    + `• Remise effectuée par : ${p.creePar || "—"}\n`
    + (p.signeLe ? `• Signée électroniquement par ${p.signeNom || p.personneNom} le ${dateHeure(p.signeLe)} depuis ${[ap.typeAppareil, ap.systeme, ap.navigateur].filter(Boolean).join(" / ")}\n• Empreinte SHA-256 : ${pr.empreinte || "—"}\n` : `• Statut : en attente de signature\n`)
    + (p.statut === "rendue" ? `• Restituée le ${dateHeure(p.retourLe)}${p.retourPar ? ` (enregistré par ${p.retourPar})` : ""}\n` : "")
    + `\nL'attestation complète (engagement signé, image de la signature, preuve électronique) est jointe en PDF.\n\nCordialement,\nService Maintenance`;
}

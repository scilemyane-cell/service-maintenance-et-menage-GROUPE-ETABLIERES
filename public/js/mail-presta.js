// mail-presta.js — Mail « pro » pour les prestataires (ménage ponctuel, lien
// de demande d'intervention) : logo Groupe Établières, encadré récapitulatif
// et un vrai bouton à cliquer, sans adresse https:// visible.
//
// L'appli n'a pas le droit d'envoyer des mails elle-même (pas de Mail.Send) :
// on prépare le mail, puis
//  • « Copier le mail » met le mail mis en forme dans le presse-papiers → coller
//    (Ctrl+V) dans un nouveau mail Outlook : le bouton et le logo sont gardés ;
//  • « Brouillon Outlook » télécharge un .eml qu'Outlook (PC) ouvre directement
//    comme un nouveau mail prêt à envoyer (destinataire et objet remplis).

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const LOGO = "https://service-maintenance-et-menage.web.app/img/logo-etablieres.png";
const BLEU = "#1f3a5f", OR = "#c9a227";

// opts : { a, objet, titre, intro, lignes: [[libellé, valeur]], encadre, bouton, url, apres, signature }
export function htmlMail(o, { sansSignature = false } = {}) {
  const lignes = (o.lignes || []).filter(l => l && l[1]).map(([k, v]) =>
    `<tr><td style="padding:6px 0;color:#5b6475;font-size:14px;width:150px;vertical-align:top">${esc(k)}</td><td style="padding:6px 0;color:#1d2433;font-size:14px;font-weight:600">${esc(v).replace(/\n/g, "<br>")}</td></tr>`).join("");
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>${esc(o.objet)}</title></head>
<body style="margin:0;padding:0;background:#f4f1ea">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1ea;padding:24px 0"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:10px;overflow:hidden;font-family:Segoe UI,Arial,sans-serif">
  <tr><td style="background:${BLEU};padding:18px 28px">
    <table role="presentation" width="100%"><tr>
      <td><img src="${LOGO}" alt="Groupe Établières" height="44" style="display:block;height:44px;background:#fff;border-radius:6px;padding:4px"></td>
      <td align="right" style="color:#ffffff;font-size:13px;letter-spacing:.04em">SERVICE MAINTENANCE<br>ET ENTRETIEN</td>
    </tr></table>
  </td></tr>
  <tr><td style="height:4px;background:${OR}"></td></tr>
  <tr><td style="padding:28px 28px 8px">
    <h1 style="margin:0 0 14px;font-size:21px;color:${BLEU};font-weight:600">${esc(o.titre)}</h1>
    <p style="margin:0 0 18px;font-size:15px;line-height:1.55;color:#1d2433">Bonjour,<br><br>${esc(o.intro).replace(/\n/g, "<br>")}</p>
    ${lignes ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f5ef;border-left:4px solid ${OR};border-radius:6px;padding:10px 16px;margin:0 0 22px">${lignes}</table>` : ""}
    ${o.encadre ? `<p style="margin:0 0 22px;padding:12px 16px;background:#fff8e1;border-radius:6px;font-size:14px;color:#5a4500">${esc(o.encadre).replace(/\n/g, "<br>")}</p>` : ""}
    <table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:6px auto 22px"><tr><td style="background:${BLEU};border-radius:8px">
      <a href="${esc(o.url)}" style="display:inline-block;padding:15px 34px;color:#ffffff;font-size:16px;font-weight:600;text-decoration:none">${esc(o.bouton)}</a>
    </td></tr></table>
    ${o.apres ? `<p style="margin:0 0 18px;font-size:14px;line-height:1.55;color:#5b6475">${esc(o.apres).replace(/\n/g, "<br>")}</p>` : ""}
    <p style="margin:0 0 ${sansSignature ? 18 : 6}px;font-size:15px;color:#1d2433">Cordialement,</p>
    ${sansSignature ? "" : `<p style="margin:0 0 24px;font-size:15px;color:#1d2433"><b>${esc(o.signature || "Service Maintenance et Entretien")}</b><br><span style="color:#5b6475">Groupe Établières</span></p>`}
  </td></tr>
  <tr><td style="background:#f7f5ef;padding:12px 28px;font-size:11px;color:#8a8f99">Ce lien est personnel : merci de ne pas le transférer. En cas de difficulté, répondez simplement à ce mail.</td></tr>
</table></td></tr></table></body></html>`;
}

const texteMail = (o) => [`Bonjour,`, ``, o.intro, ``, ...(o.lignes || []).filter(l => l && l[1]).map(([k, v]) => `${k} : ${v}`), ...(o.encadre ? [``, o.encadre] : []), ``, `${o.bouton} : ${o.url}`, ...(o.apres ? [``, o.apres] : []), ``, `Cordialement,`, o.signature || "Service Maintenance et Entretien", `Groupe Établières`].join("\n");

// Objet MIME encodé (accents) pour l'en-tête du .eml.
const motMime = (s) => `=?UTF-8?B?${btoa(unescape(encodeURIComponent(s)))}?=`;
function telechargerEml(o) {
  const html = htmlMail(o);
  const b64 = btoa(unescape(encodeURIComponent(html))).replace(/.{76}/g, "$&\r\n");
  const eml = [`To: ${o.a || ""}`, `Subject: ${motMime(o.objet)}`, `X-Unsent: 1`, `MIME-Version: 1.0`, `Content-Type: text/html; charset=UTF-8`, `Content-Transfer-Encoding: base64`, ``, b64].join("\r\n");
  const url = URL.createObjectURL(new Blob([eml], { type: "message/rfc822" }));
  const a = document.createElement("a"); a.href = url; a.download = `${(o.objet || "mail").replace(/[\\/:*?"<>|]+/g, "-").slice(0, 80)}.eml`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function copierMail(o) {
  const html = htmlMail(o, { sansSignature: true }); // la signature Outlook s'ajoute d'elle-même
  // Corps seul (sans <html>/<head>) : se colle mieux dans Outlook / Gmail.
  const corps = html.slice(html.indexOf("<table"), html.lastIndexOf("</body>"));
  if (window.ClipboardItem && navigator.clipboard?.write) {
    await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([corps], { type: "text/html" }), "text/plain": new Blob([texteMail(o)], { type: "text/plain" }) })]);
    return true;
  }
  // Repli : sélection d'un bloc mis en forme puis copie.
  const z = document.createElement("div"); z.innerHTML = corps; z.style.cssText = "position:fixed;left:-9999px;top:0"; document.body.appendChild(z);
  const r = document.createRange(); r.selectNodeContents(z); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
  const ok = document.execCommand("copy"); sel.removeAllRanges(); z.remove(); return ok;
}

export function ouvrirMailPresta(o) {
  document.querySelector(".mpx-fond")?.remove();
  const fond = document.createElement("div");
  fond.className = "mpx-fond";
  fond.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:12px";
  fond.innerHTML = `<div style="background:var(--card,#fff);color:var(--text,#111);border-radius:14px;max-width:680px;width:100%;max-height:94vh;display:flex;flex-direction:column;overflow:hidden">
    <div style="padding:14px 16px;display:flex;gap:10px;align-items:center;border-bottom:1px solid var(--border,#ddd)">
      <b style="flex:1">✉️ Mail pour le prestataire</b><button type="button" class="nav-btn" data-mpx-fermer>✕</button></div>
    <div style="padding:10px 16px;display:grid;gap:8px">
      <label style="display:grid;gap:3px;font-size:13px">À<input type="email" data-mpx-a value="${esc(o.a || "")}" placeholder="adresse mail du prestataire"></label>
      <label style="display:grid;gap:3px;font-size:13px">Objet<input data-mpx-objet value="${esc(o.objet)}"></label>
    </div>
    <iframe title="Aperçu du mail" style="flex:1;min-height:340px;border:0;border-top:1px solid var(--border,#ddd);background:#f4f1ea"></iframe>
    <div style="padding:12px 16px;display:flex;gap:8px;flex-wrap:wrap;border-top:1px solid var(--border,#ddd)">
      <button type="button" class="add-btn" data-mpx-copier>📋 Copier le mail</button>
      <button type="button" class="nav-btn" data-mpx-eml>⬇️ Brouillon Outlook (PC)</button>
      <small class="hint" data-mpx-aide style="flex-basis:100%">« Copier le mail » : ta messagerie s'ouvre, colle (Ctrl+V) dans le corps du mail. « Brouillon Outlook » : ouvre le fichier téléchargé, le mail est prêt, clique Envoyer.</small>
    </div></div>`;
  document.body.appendChild(fond);
  const val = () => ({ ...o, a: fond.querySelector("[data-mpx-a]").value.trim(), objet: fond.querySelector("[data-mpx-objet]").value.trim() || o.objet });
  const ifr = fond.querySelector("iframe"); ifr.srcdoc = htmlMail(o);
  const fermer = () => fond.remove();
  fond.addEventListener("click", (e) => { if (e.target === fond) fermer(); });
  fond.querySelector("[data-mpx-fermer]").addEventListener("click", fermer);
  fond.querySelector("[data-mpx-copier]").addEventListener("click", async (e) => {
    const v = val();
    try {
      await copierMail(v);
      e.target.textContent = "✓ Copié — colle-le dans le mail";
      // Ouvre un nouveau mail (destinataire + objet) : il reste à coller.
      setTimeout(() => { location.href = `mailto:${encodeURIComponent(v.a).replace(/%40/g, "@")}?subject=${encodeURIComponent(v.objet)}`; }, 400);
    } catch (err) { alert("Copie impossible : " + (err?.message || err)); }
  });
  fond.querySelector("[data-mpx-eml]").addEventListener("click", () => telechargerEml(val()));
}

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
const BLEU = "#1f3a5f", OR = "#c9a227", VERT = "#2e7d4f";

// opts : { a, objet, etiquette, titre, intro, pastilles: [..], lignes: [[icône, libellé, valeur]],
//          encadre, bouton, url, etapes: [..], apres, signature }
// Mise en page « carte d'accès » en tableaux + styles en ligne (compatible
// Outlook / Gmail / téléphone) ; police forcée droite (Outlook met parfois
// l'italique de son style par défaut).
export function htmlMail(o, { sansSignature = false } = {}) {
  const F = "font-family:Segoe UI,Arial,Helvetica,sans-serif;font-style:normal;";
  const pastilles = (o.pastilles || []).filter(Boolean).map(t =>
    `<span style="${F}display:inline-block;margin:3px;padding:6px 13px;border-radius:16px;background:#e8eef6;color:${BLEU};font-size:13px;font-weight:600">${esc(t)}</span>`).join("");
  const lignes = (o.lignes || []).filter(l => l && l[2]).map(([ic, k, v]) =>
    `<tr><td style="${F}width:34px;padding:9px 0;font-size:18px;vertical-align:top">${ic}</td><td style="${F}padding:9px 0;vertical-align:top"><div style="${F}font-size:12px;color:#6b7280;letter-spacing:.03em">${esc(k)}</div><div style="${F}font-size:15px;color:#1d2433;font-weight:600;margin-top:2px">${esc(v).replace(/\n/g, "<br>")}</div></td></tr>`).join("");
  const etapes = (o.etapes || []).map((t, i) =>
    `<tr><td style="${F}width:34px;padding:5px 0;vertical-align:top"><span style="${F}display:inline-block;width:22px;height:22px;line-height:22px;border-radius:11px;background:${OR};color:#fff;font-size:12px;font-weight:700;text-align:center">${i + 1}</span></td><td style="${F}padding:5px 0;font-size:14px;color:#374151">${esc(t)}</td></tr>`).join("");
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(o.objet)}</title></head>
<body style="margin:0;padding:0;background:#eef1f5">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f5"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="540" cellpadding="0" cellspacing="0" style="max-width:540px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e1e5eb">
  <tr><td style="height:6px;background:${BLEU};font-size:0;line-height:0">&nbsp;</td></tr>
  <tr><td align="center" style="padding:28px 30px 6px"><img src="${LOGO}" alt="Groupe Établières" height="62" style="display:block;height:62px;border:0"></td></tr>
  <tr><td align="center" style="padding:6px 30px 0">
    <div style="${F}font-size:12px;letter-spacing:.14em;color:${OR};font-weight:700">${esc(o.etiquette || "ACCÈS PRESTATAIRE")}</div>
    <div style="${F}font-size:23px;line-height:1.25;color:${BLEU};font-weight:700;margin:6px 0 12px">${esc(o.titre)}</div>
    <div style="${F}font-size:15px;line-height:1.55;color:#1d2433">Bonjour, ${esc(o.intro).replace(/\n/g, "<br>")}</div>
    ${pastilles ? `<div style="margin:16px 0 4px">${pastilles}</div>` : ""}
  </td></tr>
  ${lignes ? `<tr><td style="padding:14px 30px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f8fa;border-radius:10px;padding:6px 16px">${lignes}</table></td></tr>` : ""}
  ${o.encadre ? `<tr><td style="padding:12px 30px 0"><div style="${F}padding:12px 16px;background:#fff8e1;border-radius:10px;font-size:14px;color:#5a4500">${esc(o.encadre).replace(/\n/g, "<br>")}</div></td></tr>` : ""}
  <tr><td align="center" style="padding:22px 30px 6px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="background:${VERT};border-radius:12px">
      <a href="${esc(o.url)}" style="${F}display:block;padding:17px 20px;color:#ffffff;font-size:18px;font-weight:700;text-decoration:none">${esc(o.bouton)}&nbsp;&nbsp;›</a>
    </td></tr></table>
    <div style="${F}font-size:12px;color:#6b7280;margin-top:8px">Fonctionne sur téléphone, sans compte ni mot de passe.</div>
  </td></tr>
  ${etapes ? `<tr><td style="padding:16px 30px 0"><div style="${F}font-size:13px;font-weight:700;color:${BLEU};margin-bottom:4px">Comment ça marche</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${etapes}</table></td></tr>` : ""}
  ${o.apres ? `<tr><td style="${F}padding:12px 30px 0;font-size:14px;line-height:1.55;color:#4b5563">${esc(o.apres).replace(/\n/g, "<br>")}</td></tr>` : ""}
  <tr><td style="${F}padding:20px 30px 24px;font-size:15px;color:#1d2433">Cordialement,${sansSignature ? "" : `<br><b>${esc(o.signature || "Service Maintenance et Entretien")}</b><br><span style="color:#6b7280">Groupe Établières</span>`}</td></tr>
  <tr><td align="center" style="${F}background:${BLEU};color:#cfd8e3;font-size:12px;line-height:1.5;padding:14px 24px">Groupe Établières · Service Maintenance et Entretien<br><span style="color:#9fb0c6">Lien personnel, merci de ne pas le transférer. Une question ? Répondez à ce mail.</span></td></tr>
</table></td></tr></table></body></html>`;
}

const texteMail = (o) => [`Bonjour, ${o.intro}`, ``, ...(o.pastilles || []).length ? [o.pastilles.join(", ")] : [], ...(o.lignes || []).filter(l => l && l[2]).map(([, k, v]) => `${k} : ${v}`), ...(o.etapes || []).map((t, i) => `${i + 1}. ${t}`), ...(o.encadre ? [``, o.encadre] : []), ``, `${o.bouton} : ${o.url}`, ...(o.apres ? [``, o.apres] : []), ``, `Cordialement,`, o.signature || "Service Maintenance et Entretien", `Groupe Établières`].join("\n");

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
      ${o.cases?.items?.length ? `<div style="font-size:13px"><b>${esc(o.cases.libelle)} à joindre :</b><div style="display:grid;gap:3px;margin-top:4px;max-height:130px;overflow:auto">${o.cases.items.map((c, i) => `<label style="display:flex;gap:6px;align-items:center"><input type="checkbox" data-mpx-case="${i}" ${c.coche !== false ? "checked" : ""}> ${esc(c.texte)}</label>`).join("")}</div></div>` : o.cases ? `<small class="hint">${esc(o.cases.vide || "")}</small>` : ""}
    </div>
    <iframe title="Aperçu du mail" style="flex:1;min-height:340px;border:0;border-top:1px solid var(--border,#ddd);background:#f4f1ea"></iframe>
    <div style="padding:12px 16px;display:flex;gap:8px;flex-wrap:wrap;border-top:1px solid var(--border,#ddd)">
      <button type="button" class="add-btn" data-mpx-copier>📋 Copier le mail</button>
      <button type="button" class="nav-btn" data-mpx-eml>⬇️ Brouillon Outlook (PC)</button>
      <small class="hint" data-mpx-aide style="flex-basis:100%">« Copier le mail » : ta messagerie s'ouvre, colle (Ctrl+V) dans le corps du mail. « Brouillon Outlook » : ouvre le fichier téléchargé, le mail est prêt, clique Envoyer.</small>
    </div></div>`;
  document.body.appendChild(fond);
  // Ligne « cases » (ex. 🔑 codes) recalculée selon ce qui est coché.
  const avecCases = (x) => {
    if (!o.cases?.items?.length) return x;
    const t = [...fond.querySelectorAll("[data-mpx-case]")].filter(c => c.checked).map(c => o.cases.items[+c.dataset.mpxCase].texte).join("\n");
    return { ...x, lignes: [...(x.lignes || []), [o.cases.icone || "🔑", o.cases.libelle, t]] };
  };
  const val = () => avecCases({ ...o, a: fond.querySelector("[data-mpx-a]").value.trim(), objet: fond.querySelector("[data-mpx-objet]").value.trim() || o.objet });
  const ifr = fond.querySelector("iframe"); const apercu = () => { ifr.srcdoc = htmlMail(val()); }; apercu();
  fond.querySelectorAll("[data-mpx-case]").forEach(c => c.addEventListener("change", apercu));
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

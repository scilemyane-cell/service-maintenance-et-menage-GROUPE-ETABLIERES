// image-presta.js — Même « carte d'accès » que le mail prestataire, mais en
// IMAGE (PNG) pour l'envoyer par SMS/MMS : logo, titre, sites, codes, gros
// bouton et un QR code vers le lien (une image n'est pas cliquable : le lien
// part aussi en texte avec l'image).
// Sur téléphone : feuille de partage (Messages, WhatsApp…) avec image + texte.
// Sur PC : l'image est téléchargée et le texte copié.

const BLEU = "#1f3a5f", OR = "#c9a227", VERT = "#2e7d4f", GRIS = "#6b7280", TXT = "#1d2433";
const FONT = "Segoe UI, Roboto, Helvetica, Arial, sans-serif";
const W = 1080, M = 72;

const chargerImage = (src) => new Promise((ok) => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; });

function lignesTexte(ctx, texte, largeur) {
  const out = [];
  String(texte || "").split("\n").forEach(par => {
    let l = "";
    par.split(/\s+/).forEach(m => { const t = l ? l + " " + m : m; if (ctx.measureText(t).width > largeur && l) { out.push(l); l = m; } else l = t; });
    out.push(l);
  });
  return out;
}
function rond(ctx, x, y, w, h, r, fond) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fillStyle = fond; ctx.fill(); }

async function qrCanvas(url, taille) {
  try {
    await window.chargerLib?.("QRCodeStyling");
    const q = new window.QRCodeStyling({ width: taille, height: taille, type: "canvas", data: url, margin: 0,
      dotsOptions: { color: BLEU, type: "rounded" }, cornersSquareOptions: { color: BLEU, type: "extra-rounded" }, backgroundOptions: { color: "#ffffff" } });
    const blob = await q.getRawData("png");
    return await chargerImage(URL.createObjectURL(blob));
  } catch { return null; }
}

// Dessine la carte. Hauteur calculée en deux passes (mesure puis dessin).
export async function carteCanvas(o) {
  const logo = await chargerImage("img/logo-etablieres.png");
  const qr = o.url ? await qrCanvas(o.url, 260) : null;
  const c = document.createElement("canvas"), ctx = c.getContext("2d");
  const dessiner = (h, vrai) => {
    if (vrai) { c.width = W; c.height = h; ctx.fillStyle = "#eef1f5"; ctx.fillRect(0, 0, W, h); rond(ctx, 30, 30, W - 60, h - 60, 36, "#ffffff"); }
    let y = 80;
    if (logo) { const lh = 130, lw = logo.width * lh / logo.height; if (vrai) ctx.drawImage(logo, (W - lw) / 2, y, lw, lh); y += lh + 30; }
    ctx.textAlign = "center";
    ctx.font = `700 26px ${FONT}`; if (vrai) { ctx.fillStyle = OR; ctx.fillText((o.etiquette || "ACCÈS PRESTATAIRE").split("").join(String.fromCharCode(8202)), W / 2, y + 26); } y += 60;
    ctx.font = `700 54px ${FONT}`; lignesTexte(ctx, o.titre, W - 2 * M).forEach(l => { if (vrai) { ctx.fillStyle = BLEU; ctx.fillText(l, W / 2, y + 50); } y += 66; });
    y += 10;
    ctx.font = `400 34px ${FONT}`; lignesTexte(ctx, `Bonjour, ${o.intro || ""}`, W - 2 * M).forEach(l => { if (vrai) { ctx.fillStyle = TXT; ctx.fillText(l, W / 2, y + 34); } y += 48; });
    // Pastilles (sites) centrées, sur plusieurs rangées si besoin
    const pas = (o.pastilles || []).filter(Boolean);
    if (pas.length) {
      y += 24; ctx.font = `600 30px ${FONT}`;
      const rangs = [[]]; let lw = 0;
      pas.forEach(p => { const w = ctx.measureText(p).width + 48; if (lw + w > W - 2 * M && rangs.at(-1).length) { rangs.push([]); lw = 0; } rangs.at(-1).push([p, w]); lw += w + 14; });
      rangs.forEach(r => { const tot = r.reduce((t, [, w]) => t + w + 14, -14); let x = (W - tot) / 2;
        r.forEach(([p, w]) => { if (vrai) { rond(ctx, x, y, w, 60, 30, "#e8eef6"); ctx.fillStyle = BLEU; ctx.fillText(p, x + w / 2, y + 41); } x += w + 14; }); y += 74; });
    }
    // Encadré infos (🔑 codes, 📝 consignes…)
    const infos = (o.lignes || []).filter(l => l && l[2]);
    if (infos.length) {
      y += 20; ctx.textAlign = "left";
      const blocs = infos.map(([ic, k, v]) => { ctx.font = `600 31px ${FONT}`; return [ic, k, lignesTexte(ctx, v, W - 2 * M - 112)]; });
      const hh = 30 + blocs.reduce((t, [, , ls]) => t + 38 + ls.length * 44 + 16, 0) + 10;
      if (vrai) rond(ctx, M, y, W - 2 * M, hh, 22, "#f5f7fa");
      let yy = y + 30;
      blocs.forEach(([ic, k, ls]) => {
        if (vrai) { ctx.font = `400 34px ${FONT}`; ctx.fillStyle = TXT; ctx.fillText(ic, M + 28, yy + 32); ctx.font = `400 26px ${FONT}`; ctx.fillStyle = GRIS; ctx.fillText(k, M + 84, yy + 24); }
        yy += 38; ctx.font = `600 31px ${FONT}`;
        ls.forEach(l => { if (vrai) { ctx.fillStyle = TXT; ctx.fillText(l, M + 84, yy + 32); } yy += 44; });
        yy += 16;
      });
      y += hh; ctx.textAlign = "center";
    }
    // Bouton
    y += 40; if (vrai) { rond(ctx, M, y, W - 2 * M, 110, 26, VERT); ctx.font = `700 42px ${FONT}`; ctx.fillStyle = "#fff"; ctx.fillText(`${o.bouton || "Ouvrir"}  ›`, W / 2, y + 70); } y += 110;
    ctx.font = `400 26px ${FONT}`; if (vrai) { ctx.fillStyle = GRIS; ctx.fillText("Touchez le lien du message, ou scannez le QR code", W / 2, y + 44); } y += 70;
    if (qr) { if (vrai) ctx.drawImage(qr, (W - 260) / 2, y); y += 280; }
    // Étapes
    const et = o.etapes || [];
    if (et.length) {
      y += 20; ctx.textAlign = "left"; ctx.font = `700 30px ${FONT}`; if (vrai) { ctx.fillStyle = BLEU; ctx.fillText("Comment ça marche", M, y + 30); } y += 56;
      et.forEach((t, i) => {
        if (vrai) { ctx.beginPath(); ctx.arc(M + 22, y + 22, 22, 0, Math.PI * 2); ctx.fillStyle = OR; ctx.fill(); ctx.fillStyle = "#fff"; ctx.font = `700 24px ${FONT}`; ctx.textAlign = "center"; ctx.fillText(String(i + 1), M + 22, y + 31); ctx.textAlign = "left"; }
        ctx.font = `400 30px ${FONT}`; lignesTexte(ctx, t, W - 2 * M - 70).forEach(l => { if (vrai) { ctx.fillStyle = "#374151"; ctx.fillText(l, M + 66, y + 32); } y += 42; }); y += 12;
      });
      ctx.textAlign = "center";
    }
    // Pied
    y += 30; if (vrai) { ctx.fillStyle = "#e5e8ee"; ctx.fillRect(30, y, W - 60, 2); ctx.font = `600 26px ${FONT}`; ctx.fillStyle = BLEU; ctx.fillText("Groupe Établières · Service Maintenance et Entretien", W / 2, y + 52); ctx.font = `400 24px ${FONT}`; ctx.fillStyle = GRIS; ctx.fillText("Accès personnel, merci de ne pas le transférer.", W / 2, y + 88); }
    y += 130;
    return y;
  };
  const h = dessiner(0, false) + 30;
  dessiner(h, true);
  return c;
}

export async function partagerCarte(o, texte) {
  const c = await carteCanvas(o);
  const blob = await new Promise(ok => c.toBlob(ok, "image/png"));
  const fichier = new File([blob], "acces-groupe-etablieres.png", { type: "image/png" });
  if (navigator.canShare?.({ files: [fichier] })) {
    try { await navigator.share({ files: [fichier], text: texte, title: o.titre }); return "partage"; }
    catch (e) { if (e?.name === "AbortError") return "annule"; }
  }
  // PC : téléchargement de l'image + texte copié (à coller dans le SMS / WhatsApp Web).
  const url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url; a.download = fichier.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
  try { await navigator.clipboard.writeText(texte); } catch { /* */ }
  return "telecharge";
}

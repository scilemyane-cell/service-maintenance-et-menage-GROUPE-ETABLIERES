// demandes-ticket.js
// « Ticket prestataire » : fiche A4 propre d'une demande, à joindre au mail
// que l'on écrit soi-même (Imprimer → Enregistrer en PDF), ou à copier.
// Les zones en pointillés sont modifiables avant impression.

import { esc } from "./astreinte-logic.js";

const fr = (x) => (x ? String(x).slice(0, 10).split("-").reverse().join("/") : "");
const nomPropre = (n) => String(n || "").trim().replace(/\S+/g, (m) => m.charAt(0).toUpperCase() + m.slice(1));
const DELAIS = {
  Critique: "Intervention immédiate — dans la journée",
  Urgent: "Dès que possible — sous 48 h",
  Normal: "Dans les meilleurs délais",
  "À planifier": "À planifier avec nous",
};

// Logo intégré (data URL) pour qu'il apparaisse aussi dans le PDF enregistré.
let logoCache = null;
async function logoDataURL() {
  if (logoCache) return logoCache;
  try {
    const b = await (await fetch(new URL("img/logo-etablieres.png", location.href))).blob();
    logoCache = await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => ok(""); r.readAsDataURL(b); });
  } catch { logoCache = ""; }
  return logoCache || new URL("img/logo-etablieres.png", location.href).href;
}

// À appeler directement dans le clic (sinon le téléphone bloque la fenêtre).
export function preparerFenetre() {
  const w = window.open("", "_blank");
  if (w) w.document.write("<p style='font:16px system-ui;padding:20px'>Préparation du ticket…</p>");
  return w;
}

export async function ouvrirTicketPrestataire({ ligne: l, adresse = "", utilisateur = "", email = "", fenetre = null }) {
  const urg = l.urgence && l.urgence !== "Non renseignée" ? l.urgence : "";
  const travaux = l.commentaireTech || "Diagnostic et remise en état.";
  const aujourd = new Date().toLocaleDateString("fr-FR");
  const logo = await logoDataURL();
  const ed = (txt, cls = "", ph = "") => `<span class="ed ${cls}" contenteditable="true" spellcheck="true"${ph ? ` data-ph="${ph}"` : ""}>${txt}</span>`;
  const ligneInfo = (lib, val) => `<tr><th>${lib}</th><td>${val}</td></tr>`;

  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Demande d'intervention ${esc(l.n)} — ${esc(l.site)}</title>
<style>
@page{size:A4 portrait;margin:12mm}
*{box-sizing:border-box}
body{font:12.5px/1.45 system-ui,-apple-system,"Segoe UI",Arial,sans-serif;color:#1a1a1a;margin:0;background:#e9ecf1}
.page{max-width:210mm;margin:14px auto;background:#fff;padding:14mm 13mm;box-shadow:0 4px 20px rgba(0,0,0,.12)}
.barre{position:sticky;top:0;z-index:2;display:flex;gap:8px;justify-content:center;flex-wrap:wrap;padding:10px;background:#1b2a41}
.barre button{font:700 14px system-ui;padding:9px 16px;border-radius:10px;border:0;background:#c8102e;color:#fff;cursor:pointer}
.barre button.sec{background:#fff;color:#1b2a41}
.barre span{color:#cfd8e6;font-size:12.5px;align-self:center}
header{display:flex;justify-content:space-between;align-items:center;gap:16px;padding-bottom:10px;border-bottom:3px solid #c8102e}
header img{height:58px}
.ref{text-align:right}
.ref h1{margin:0;font-size:19px;letter-spacing:.5px;color:#1b2a41}
.ref .num{font-size:24px;font-weight:900;color:#c8102e}
.ref small{color:#555}
.urg{display:inline-block;margin-top:4px;padding:3px 10px;border-radius:20px;font-weight:800;font-size:12px;background:#e8edf5;color:#1b2a41}
.urg.Urgent{background:#ffe5c2;color:#8a4b00}.urg.Critique{background:#c8102e;color:#fff}
h2{font-size:13px;text-transform:uppercase;letter-spacing:.6px;color:#1b2a41;margin:16px 0 6px;padding-bottom:3px;border-bottom:1px solid #d5dbe5}
table{width:100%;border-collapse:collapse}
th{width:34%;text-align:left;font-weight:600;color:#555;padding:4px 8px 4px 0;vertical-align:top}
td{padding:4px 0;vertical-align:top}
.bloc{border:1px solid #d5dbe5;border-radius:8px;padding:9px 11px;background:#fafbfd;white-space:pre-wrap}
ul{margin:4px 0 0;padding-left:18px}
.contact{display:flex;gap:20px;flex-wrap:wrap}
.signature{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:6px}
.signature div{border:1px solid #bbb;border-radius:8px;min-height:70px;padding:6px 9px;color:#666;font-size:11.5px}
footer{margin-top:18px;font-size:10.5px;color:#777;text-align:center}
.ed{outline:none;border-bottom:1px dashed #9fb2d0;min-width:40px;display:inline-block}
.ed.bloc{display:block;border:1px dashed #9fb2d0}
.ed:focus{background:#fff8d6}
.ed:empty::before{content:attr(data-ph);color:#9aa7ba;font-style:italic}
.capture .ed,.capture .ed.bloc{border-color:transparent}.capture .ed.bloc{border:1px solid #d5dbe5}.capture .ed:empty::before{content:""}.capture .ed:focus{background:none}
.capture .page{box-shadow:none;margin:0}
.barre button.copie{background:#1a4fb4}
.barre .msg{font-weight:700;color:#1d6b35}
@media print{
  body{background:#fff}.barre{display:none}
  .page{box-shadow:none;margin:0;padding:0;max-width:none}
  .ed,.ed.bloc{border-color:transparent}
  .ed.bloc{border:1px solid #d5dbe5}
  .ed:empty::before{content:""}
}
</style></head><body>
<div class="barre"><button class="copie" id="copier-img" title="Copie le ticket en image : colle-le ensuite dans ton mail (Ctrl+V ou appui long › Coller)">📋 Copier pour un mail</button><button onclick="window.print()">🖨 Imprimer / Enregistrer en PDF</button><button class="sec" id="copier">📝 Copier le texte</button><span class="aide">Les zones en pointillés sont modifiables.</span></div>
<div class="page">
<header>
  <img src="${logo}" alt="Groupe Établières">
  <div class="ref"><h1>DEMANDE D'INTERVENTION</h1><div class="num">${esc(l.n)}</div><small>Émise le ${aujourd}</small><br>
  ${urg ? `<span class="urg ${esc(urg)}">${urg === "Critique" ? "⚠ " : ""}${esc(urg.toUpperCase())}</span>` : ""}</div>
</header>

<h2>Lieu d'intervention</h2>
<table>
  ${ligneInfo("Résidence / site", `<b>${esc(l.site)}</b>`)}
  ${ligneInfo("Adresse", ed(esc(adresse), "", "Adresse à compléter"))}
  ${ligneInfo("Logement / local", `<b>${esc(l.local || "—")}</b>`)}
  ${l.logementOccupe ? ligneInfo("Logement occupé", esc(l.logementOccupe)) : ""}
  ${ligneInfo("Accès / contact sur place", ed("À convenir avec nous avant le passage"))}
</table>

<h2>Objet de la demande</h2>
<table>
  ${l.type ? ligneInfo("Nature", esc(l.type)) : ""}
  ${ligneInfo("Signalé le", fr(l.date) || "—")}
</table>
<div class="bloc" style="margin-top:6px">${esc(l.descr || "")}</div>

<h2>Travaux demandés</h2>
${ed(esc(travaux), "bloc")}

<h2>Délai souhaité</h2>
${ed(esc(DELAIS[urg] || "Dans les meilleurs délais"))}

<h2>Merci de</h2>
<ul>
  <li>confirmer la prise en charge et la date de passage prévue ;</li>
  <li>rappeler la référence <b>${esc(l.n)}</b> sur vos échanges, devis et factures ;</li>
  <li>nous transmettre un devis préalable si les travaux dépassent le simple dépannage ;</li>
  <li>nous adresser un compte rendu d'intervention après votre passage.</li>
</ul>

<h2>Votre contact — Groupe Établières</h2>
<div class="contact"><div><b>${esc(nomPropre(utilisateur)) || "Service Maintenance"}</b><br>Service Maintenance et Ménage</div>
<div>${ed(esc(email), "", "e-mail")}<br>${ed("", "", "Téléphone")}</div></div>

<h2>Intervention réalisée</h2>
<div class="signature"><div>Date, intervenant et travaux effectués :</div><div>Visa Groupe Établières :</div></div>

<footer>Groupe Établières — Service Maintenance · Réf. ${esc(l.n)}</footer>
</div>
<script>
// Outil de capture chargé en arrière-plan (sans bloquer l'affichage du ticket).
let h2c=null;
const chargerCapture=()=>window.html2canvas?Promise.resolve():(h2c||(h2c=new Promise((ok,ko)=>{const sc=document.createElement("script");sc.src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";const echec=()=>{h2c=null;ko(new Error("outil de capture non chargé (connexion ?)"));};const t=setTimeout(echec,15000);sc.onload=()=>{clearTimeout(t);ok();};sc.onerror=()=>{clearTimeout(t);echec();};document.head.append(sc);})));
setTimeout(()=>chargerCapture().catch(()=>{}),300);
// « Copier pour un mail » : le ticket est copié en IMAGE dans le presse-papiers,
// à coller directement dans le corps du mail. Sinon, l'image est téléchargée.
document.getElementById("copier-img").addEventListener("click",()=>{
  const b=document.getElementById("copier-img"),page=document.querySelector(".page"),aide=document.querySelector(".barre .aide");
  b.disabled=true;b.textContent="⏳ Préparation…";
  const image=(async()=>{
    await chargerCapture();
    document.activeElement?.blur();document.body.classList.add("capture");
    try{const c=await html2canvas(page,{scale:2,backgroundColor:"#ffffff",useCORS:true,logging:false});return await new Promise(r=>c.toBlob(r,"image/png"));}
    finally{document.body.classList.remove("capture");}
  })();
  const fin=(txt)=>{b.disabled=false;b.textContent="📋 Copier pour un mail";aide.innerHTML=txt;aide.className="aide msg";};
  const telecharger=async()=>{const bl=await image;const a=document.createElement("a");a.href=URL.createObjectURL(bl);a.download="ticket-${esc(String(l.n).replace(/[^\w-]+/g, "_"))}.png";a.click();fin("⬇️ Image du ticket téléchargée : ajoute-la à ton mail.");};
  try{
    if(!navigator.clipboard?.write||!window.ClipboardItem)throw new Error("non pris en charge");
    navigator.clipboard.write([new ClipboardItem({"image/png":image})])
      .then(()=>fin("✓ Ticket copié ! Ouvre ton mail et colle-le (Ctrl+V, ou appui long › Coller)."))
      .catch(e=>{console.warn(e);telecharger().catch(err=>fin("❌ "+err.message));});
  }catch(e){telecharger().catch(err=>fin("❌ "+err.message));}
});
document.getElementById("copier").addEventListener("click",async()=>{
  const p=document.querySelector(".page").cloneNode(true);
  p.querySelectorAll("h2").forEach(h=>h.textContent="\\n"+h.textContent.toUpperCase());
  p.querySelectorAll("tr").forEach(r=>{const th=r.querySelector("th"),td=r.querySelector("td");if(th&&td)r.textContent=th.textContent+" : "+td.innerText+"\\n";});
  p.querySelectorAll("li").forEach(li=>li.textContent="- "+li.textContent+"\\n");
  p.querySelector("img")?.remove();p.querySelector(".signature")?.previousElementSibling?.remove();p.querySelector(".signature")?.remove();
  document.body.append(p);p.style.cssText="position:absolute;left:-9999px";
  const t=p.innerText.replace(/\\n{3,}/g,"\\n\\n").trim();p.remove();
  try{await navigator.clipboard.writeText(t);}catch(e){const ta=document.createElement("textarea");ta.value=t;document.body.append(ta);ta.select();document.execCommand("copy");ta.remove();}
  const b=document.getElementById("copier");b.textContent="✓ Copié";setTimeout(()=>b.textContent="📝 Copier le texte",1800);
});
</script>
</body></html>`;

  const w = fenetre || window.open("", "_blank");
  if (w) { w.document.open(); w.document.write(html); w.document.close(); return; }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  a.download = `demande-${String(l.n).replace(/[^\w-]+/g, "_")}.html`; a.click();
}

// demandes-impression.js
// Récapitulatif imprimable des demandes d'un site (vue Par site → 🖨 Imprimer).
// Ouvre une page A4 paysage prête à imprimer (ou « Enregistrer en PDF »).

import { esc } from "./astreinte-logic.js";

const fr = (x) => (x ? String(x).slice(0, 10).split("-").reverse().join("/") : "");
const nomPropre = (n) => String(n || "").trim().replace(/\S+/g, (m) => m.charAt(0).toUpperCase() + m.slice(1));
const ORDRE_URG = { Critique: 0, Urgent: 1, Normal: 2, "À planifier": 3 };

function suivi(l) {
  const t = [];
  if (l.intervenant) t.push(`<b>Intervenant :</b> ${esc(l.intervenant)}${l.dateIntervention ? ` (${fr(l.dateIntervention)})` : ""}`);
  if (l.commentaireTech) t.push(`<b>Commentaire${l.commentaireTechPar ? ` ${esc(nomPropre(l.commentaireTechPar))}` : ""} :</b> ${esc(l.commentaireTech)}`);
  if (l.actionTexte) t.push(`<b>${l.actionFaiteLe ? "✓ Action faite" : "📌 Action"} → ${esc(nomPropre(l.actionPourNom))} :</b> ${esc(l.actionTexte)}${l.actionEcheance && !l.actionFaiteLe ? ` (avant le ${fr(l.actionEcheance)})` : ""}`);
  return t.join("<br>");
}

function tableau(titre, liste, parLocal) {
  if (!liste.length) return "";
  const tri = [...liste].sort((a, b) => parLocal
    ? (a.local || "zzz").localeCompare(b.local || "zzz", "fr", { numeric: true }) || String(a.n).localeCompare(String(b.n), "fr", { numeric: true })
    : (ORDRE_URG[a.urgence] ?? 5) - (ORDRE_URG[b.urgence] ?? 5) || (a.date || "").localeCompare(b.date || ""));
  return `<h2>${titre} <span>(${liste.length})</span></h2>
  <table><thead><tr><th class="c-n">N°</th><th class="c-d">Date</th><th class="c-l">Logement / local</th><th>Demande</th><th class="c-u">Urgence</th><th class="c-s">Statut</th><th class="c-sv">Suivi</th><th class="c-f">Fait / notes</th></tr></thead>
  <tbody>${tri.map(l => `<tr class="${l.urgence === "Critique" ? "crit" : l.urgence === "Urgent" ? "urg" : ""}">
    <td class="c-n"><b>${esc(l.n)}</b></td>
    <td class="c-d">${fr(l.date)}</td>
    <td class="c-l"><b>${esc(l.local || "—")}</b>${l.logementOccupe ? `<br><small>Occupé : ${esc(l.logementOccupe)}</small>` : ""}</td>
    <td>${l.type ? `<small class="type">${esc(l.type)}</small><br>` : ""}${esc(l.descr)}${l.demandeur ? `<br><small>Demandeur : ${esc(l.demandeur)}</small>` : ""}</td>
    <td class="c-u">${esc(l.urgence === "Non renseignée" ? "" : l.urgence)}</td>
    <td class="c-s">${esc(l.statut)}</td>
    <td class="c-sv">${suivi(l)}</td>
    <td class="c-f"></td></tr>`).join("")}</tbody></table>`;
}

function pageHTML({ site, techs, sections, parLocal }) {
  const total = sections.reduce((n, s) => n + s.liste.length, 0);
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Demandes – ${esc(site)}</title>
<style>
@page{size:A4 landscape;margin:10mm}
*{box-sizing:border-box}
body{font:11px/1.35 system-ui,-apple-system,Segoe UI,Arial,sans-serif;color:#111;margin:0;padding:14px;background:#fff}
header{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #c8102e;padding-bottom:6px;margin-bottom:8px}
h1{font-size:20px;margin:0}
header p{margin:2px 0 0;color:#444}
.imp{position:sticky;top:0;display:flex;gap:8px;justify-content:flex-end;margin-bottom:8px}
.imp button{font:700 14px system-ui;padding:9px 16px;border-radius:10px;border:0;background:#c8102e;color:#fff;cursor:pointer}
.imp button.sec{background:#eee;color:#111}
h2{font-size:14px;margin:14px 0 4px;color:#c8102e}
h2 span{color:#555;font-weight:400}
table{width:100%;border-collapse:collapse;table-layout:fixed}
th,td{border:1px solid #999;padding:4px 5px;vertical-align:top;word-wrap:break-word}
th{background:#eee;text-align:left;font-size:10px;text-transform:uppercase}
thead{display:table-header-group}
tr{page-break-inside:avoid}
tr.crit td{background:#ffe1e1}
tr.urg td.c-u{background:#ffefd6;font-weight:700}
tr.crit td.c-u{font-weight:900;color:#a00}
small{color:#555}
.type{font-weight:700;color:#333}
.c-n{width:62px}.c-d{width:76px;white-space:nowrap}.c-l{width:110px}.c-u{width:66px}.c-s{width:90px}.c-sv{width:24%}.c-f{width:15%}
footer{margin-top:10px;color:#666;font-size:10px}
@media print{.imp{display:none}body{padding:0}}
</style></head><body>
<div class="imp"><button onclick="window.print()">🖨 Imprimer</button><button class="sec" onclick="window.close()">Fermer</button></div>
<header><div><h1>${esc(site)}</h1><p>Récapitulatif des demandes — ${total} demande${total > 1 ? "s" : ""}${techs ? ` · 👷 ${esc(techs)}` : ""}${parLocal ? " · classées par logement" : " · classées par urgence"}</p></div>
<p>Groupe Établières — Service Maintenance<br>Imprimé le ${new Date().toLocaleDateString("fr-FR")} à ${new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</p></header>
${sections.map(s => tableau(s.titre, s.liste, parLocal)).join("") || "<p>Aucune demande.</p>"}
<footer>Document généré depuis l'appli Service Maintenance et Ménage.</footer>
<script>window.addEventListener("load",()=>setTimeout(()=>{try{window.print()}catch(e){}},400));</script>
</body></html>`;
}

// Petite fenêtre de choix, puis ouverture de la page à imprimer.
export function ouvrirImpressionSite({ site, techs, ouvertes, enValidation, traitees }) {
  document.getElementById("imp-modal")?.remove();
  const m = document.createElement("div");
  m.id = "imp-modal"; m.className = "ndm-fond";
  m.innerHTML = `<div class="ndm imp-modal" role="dialog" aria-modal="true">
    <div class="ndm-tete"><h3>🖨 Récapitulatif — ${esc(site)}</h3></div>
    <label class="imp-ch"><input type="checkbox" data-imp="ouvertes" checked> À traiter <b>(${ouvertes.length})</b></label>
    <label class="imp-ch"><input type="checkbox" data-imp="valid" ${enValidation.length ? "checked" : ""}> En attente de validation <b>(${enValidation.length})</b></label>
    <label class="imp-ch"><input type="checkbox" data-imp="traitees"> Traitées (30 derniers jours) <b>(${traitees.filter(recente).length})</b></label>
    <label class="imp-ch">Classer par <select data-imp="ordre"><option value="local">Logement / local</option><option value="urgence">Urgence</option></select></label>
    <div class="ndm-btns"><button type="button" class="dps-annuler" data-imp-annuler>Annuler</button><button type="button" class="dps-enregistrer" data-imp-go>🖨 Imprimer</button></div>
  </div>`;
  document.body.append(m);
  const fermer = () => m.remove();
  m.addEventListener("click", (e) => { if (e.target === m) fermer(); });
  m.querySelector("[data-imp-annuler]").addEventListener("click", fermer);
  m.querySelector("[data-imp-go]").addEventListener("click", () => {
    const coche = (k) => m.querySelector(`[data-imp="${k}"]`).checked;
    const sections = [];
    if (coche("ouvertes")) sections.push({ titre: "À traiter", liste: ouvertes });
    if (coche("valid")) sections.push({ titre: "En attente de validation", liste: enValidation });
    if (coche("traitees")) sections.push({ titre: "Traitées (30 derniers jours)", liste: traitees.filter(recente) });
    const html = pageHTML({ site, techs, sections: sections.filter(s => s.liste.length), parLocal: m.querySelector('[data-imp="ordre"]').value === "local" });
    const w = window.open("", "_blank");
    if (w) { w.document.open(); w.document.write(html); w.document.close(); }
    else {
      // Fenêtre bloquée (certains téléphones) : on télécharge la page.
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([html], { type: "text/html" }));
      a.download = `demandes-${site.replace(/[^\w-]+/g, "_")}.html`; a.click();
    }
    fermer();
  });
}
function recente(l) {
  const d = l.dateIntervention || l.dateStatut || l.date || "";
  return d && new Date(d.slice(0, 10)).getTime() >= Date.now() - 30 * 86400000;
}

// rapport-direction.js
// « Rapport direction » : document A4 imprimable (ou PDF) qui reprend les
// statistiques de l'onglet Statistiques pour la période / l'association
// choisies — synthèse chiffrée comparée à la période précédente, points
// d'attention automatiques, puis une page par thème (demandes, astreinte,
// énergie, stock, absences, prévisionnel). Graphiques en HTML/CSS pur pour
// une impression nette, sans dépendance.

import { esc } from "./astreinte-logic.js";

const fmtNb = (n, dec = 0) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: dec }).format(n || 0);
const euros = (n) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n || 0);
const fr = (iso) => (iso ? iso.split("-").reverse().join("/") : "");
const pct = (n, t) => (t ? Math.round((n / t) * 100) : 0);

function variationHTML(v, inverse = false) {
  if (v === null || v === undefined || !Number.isFinite(v)) return `<span class="var neutre">—</span>`;
  const bon = inverse ? v <= 0 : v >= 0;
  return `<span class="var ${v === 0 ? "neutre" : bon ? "bon" : "mauvais"}">${v > 0 ? "▲ +" : v < 0 ? "▼ " : ""}${v} %</span>`;
}
const kpi = (valeur, libelle, sous = "", v = null, inverse = false) =>
  `<div class="kpi"><b>${valeur}</b><span>${libelle}</span>${v !== undefined && v !== false ? `<small>${v === null ? "" : variationHTML(v, inverse)} ${sous}</small>` : sous ? `<small>${sous}</small>` : ""}</div>`;

function barresMois(mois, series, legende) {
  const max = Math.max(1, ...series.flatMap((s) => s.valeurs));
  return `<div class="graph">${mois.map((m, i) => `<div class="col">
      <div class="piles">${series.map((s) => `<i style="height:${(s.valeurs[i] / max) * 100}%;background:${s.couleur}" title="${s.valeurs[i]}"></i>`).join("")}</div>
      <em>${series.map((s) => fmtNb(s.valeurs[i], s.dec || 0)).join(" / ")}</em><small>${esc(m.label)}</small></div>`).join("")}</div>
    <p class="leg">${series.map((s) => `<i style="background:${s.couleur}"></i>${esc(s.nom)}`).join(" ")}${legende ? ` · ${legende}` : ""}</p>`;
}
function barresH(liste, total, unite = "", fmt = (x) => fmtNb(x)) {
  if (!liste.length) return `<p class="vide">Aucune donnée sur la période.</p>`;
  const max = Math.max(1, ...liste.map(([, v]) => v));
  return `<div class="bh">${liste.map(([k, v]) => `<div class="bh-l"><span class="bh-n">${esc(k)}</span><span class="bh-p"><i style="width:${(v / max) * 100}%"></i></span><b>${fmt(v)}${unite}</b>${total ? `<small>${pct(v, total)} %</small>` : ""}</div>`).join("")}</div>`;
}
const table = (entetes, lignes, pied = null) => `<table><thead><tr>${entetes.map((e) => `<th>${e}</th>`).join("")}</tr></thead><tbody>${lignes.map((l) => `<tr>${l.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody>${pied ? `<tfoot><tr>${pied.map((c) => `<td>${c}</td>`).join("")}</tr></tfoot>` : ""}</table>`;

function pointsAttention(s, ctx) {
  const L = [];
  const { v, variation } = ctx;
  if (v("suivi-demandes")) {
    if (s.attentePlus30) L.push(["alerte", `<b>${s.attentePlus30}</b> demande(s) en attente depuis plus de 30 jours (dont ${s.tranchesAge["> 90 j"]} depuis plus de 90 jours).`]);
    if (s.dem.length && s.pctTraitees >= 80) L.push(["ok", `<b>${s.pctTraitees} %</b> des demandes reçues sur la période sont traitées.`]);
    else if (s.dem.length) L.push(["info", `<b>${s.pctTraitees} %</b> des demandes reçues sur la période sont traitées (${s.dem.length - s.demTraitees} encore ouvertes).`]);
    const vd = variation(s.dem.length, s.demPrev.length);
    if (vd !== null && Math.abs(vd) >= 15) L.push(["info", `Demandes reçues ${vd > 0 ? "en hausse" : "en baisse"} de <b>${Math.abs(vd)} %</b> ${ctx.comp}.`]);
    const crit = s.delaiParUrgence.find((x) => x.urgence === "Critique");
    if (crit && crit.moyen !== null) L.push([crit.moyen > 2 ? "alerte" : "ok", `Délai moyen de traitement des demandes <b>critiques</b> : ${fmtNb(crit.moyen, 1)} jour(s).`]);
    if (s.parSiteDem[0]) L.push(["info", `Site le plus demandeur : <b>${esc(s.parSiteDem[0][0])}</b> (${s.parSiteDem[0][1]} demandes, ${pct(s.parSiteDem[0][1], s.dem.length)} %).`]);
  }
  if (v("astreinte")) {
    if (s.interv.length) L.push(["info", `Astreinte : <b>${s.interv.length}</b> intervention(s), <b>${fmtNb(s.heuresTot, 1)} h</b> dont ${fmtNb(s.heuresNuit, 1)} h de nuit.`]);
    const vh = variation(s.heuresTot, s.heuresPrev);
    if (vh !== null && Math.abs(vh) >= 20) L.push([vh > 0 ? "alerte" : "ok", `Heures d'astreinte ${vh > 0 ? "en hausse" : "en baisse"} de <b>${Math.abs(vh)} %</b> ${ctx.comp}.`]);
    if (s.parSiteInterv[0] && s.interv.length >= 3) L.push(["info", `Site le plus sollicité en astreinte : <b>${esc(s.parSiteInterv[0][0])}</b> (${s.parSiteInterv[0][1]} intervention(s)).`]);
  }
  if (v("compteurs") && s.compteursEnRetard.length) L.push(["alerte", `<b>${s.compteursEnRetard.length}</b> compteur(s) sur ${s.compteurs.length} sans relevé depuis plus de ${ctx.seuilReleve} jours.`]);
  if ((v("stock") || v("stock-menage")) && s.sousSeuilMaint.length + s.sousSeuilMenage.length) L.push(["alerte", `<b>${s.sousSeuilMaint.length + s.sousSeuilMenage.length}</b> produit(s) actuellement sous le seuil minimum de stock.`]);
  if (v("previsionnel") && s.montantPropose) L.push(["info", `Prévisionnel travaux ${s.anneeCourante}–${s.anneeCourante + 1} : <b>${euros(s.montantPropose)}</b> proposés, dont <b>${euros(s.montantValide)}</b> validés.`]);
  return L;
}

export function ouvrirRapportDirection(ctx) {
  const { s, p, data, filtres, v, variation, periodeLibelle, auteur, typesCompteur, seuilReleve, ordreUrgence } = ctx;
  const comp = p.libelleComparaison;
  ctx.comp = comp; ctx.seuilReleve = seuilReleve;
  const points = pointsAttention(s, ctx);
  const aujourdhui = new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
  const plusieursMois = p.mois.length > 1;

  const secDemandes = !v("suivi-demandes") ? "" : `
  <section>
    <h2><span>1</span> Demandes d'intervention</h2>
    <div class="kpis">
      ${kpi(fmtNb(s.dem.length), "demandes reçues", comp, variation(s.dem.length, s.demPrev.length), true)}
      ${kpi(`${s.pctTraitees} %`, "traitées", `${fmtNb(s.demTraitees)} réalisées ou annulées`)}
      ${kpi(s.delaiMoyen === null ? "—" : `${fmtNb(s.delaiMoyen, 1)} j`, "délai moyen", s.delaiMedian === null ? "" : `médiane ${fmtNb(s.delaiMedian, 1)} j`)}
      ${kpi(fmtNb(s.enAttente.length), "en attente (toutes périodes)", `dont ${s.attentePlus30} > 30 j`)}
    </div>
    ${plusieursMois ? `<h3>Évolution mensuelle</h3>${barresMois(p.mois, [{ nom: "Reçues", valeurs: s.recuesParMois, couleur: "#1b2a41" }, { nom: "Réalisées", valeurs: s.realiseesParMois, couleur: "#1b9a4b" }])}` : ""}
    <div class="deux">
      <div><h3>Par urgence</h3>${barresH(s.urgenceTriee, s.dem.length)}</div>
      <div><h3>Délai de traitement par urgence</h3>${s.delaiParUrgence.length ? table(["Urgence", "Nb", "Délai moyen", "Médiane"], s.delaiParUrgence.map((x) => [esc(x.urgence), x.nb, x.moyen === null ? "—" : `${fmtNb(x.moyen, 1)} j`, x.median === null ? "—" : `${fmtNb(x.median, 1)} j`])) : `<p class="vide">Pas assez de demandes réalisées.</p>`}</div>
    </div>
    <div class="deux">
      <div><h3>Sites les plus demandeurs</h3>${barresH(s.parSiteDem, s.dem.length)}</div>
      <div><h3>Par association</h3>${barresH(s.parAssocDem, s.dem.length)}${s.parTypeDem.length ? `<h3>Par nature</h3>${barresH(s.parTypeDem, s.dem.length)}` : ""}</div>
    </div>
    <div class="deux">
      <div><h3>Ancienneté des demandes en attente</h3>${barresH(Object.entries(s.tranchesAge), s.enAttente.length)}</div>
      <div><h3>Activité par intervenant</h3>${s.intervenantsTries.length ? table(["Intervenant", "Traitées", "Délai moyen"], s.intervenantsTries.map(([n, o]) => [esc(n), o.nb, o.delais.length ? `${fmtNb(o.delais.reduce((a, b) => a + b, 0) / o.delais.length, 1)} j` : "—"])) : `<p class="vide">—</p>`}</div>
    </div>
    ${s.plusAnciennes.length ? `<h3>Demandes les plus anciennes encore ouvertes</h3>${table(["N°", "Site", "Urgence", "Ancienneté"], s.plusAnciennes.map((d) => [esc(d.numero || "—"), esc(d.site || "—"), esc(d.urgence || "—"), `<b${d._age > 30 ? ' class="rouge"' : ""}>${d._age} j</b>`]))}` : ""}
  </section>`;

  const secAstreinte = !v("astreinte") ? "" : `
  <section>
    <h2><span>2</span> Astreinte technique</h2>
    <div class="kpis">
      ${kpi(fmtNb(s.interv.length), "interventions", comp, variation(s.interv.length, s.intervPrev.length), true)}
      ${kpi(`${fmtNb(s.heuresTot, 1)} h`, "heures d'astreinte", comp, variation(s.heuresTot, s.heuresPrev), true)}
      ${kpi(`${fmtNb(s.heuresNuit, 1)} h`, "dont heures de nuit", "21h – 6h")}
      ${kpi(euros(s.primesDimanche), "primes dimanche", `${fmtNb(s.appelsN1)} appel(s) au cadre N1`)}
    </div>
    ${plusieursMois ? `<h3>Évolution mensuelle</h3>${barresMois(p.mois, [{ nom: "Interventions", valeurs: s.intervParMois, couleur: "#c8102e" }, { nom: "Heures", valeurs: s.heuresParMois, couleur: "#e0a526", dec: 1 }])}` : ""}
    <div class="deux">
      <div><h3>Par type d'intervention</h3>${barresH(s.parType, s.interv.length)}</div>
      <div><h3>Sites les plus sollicités</h3>${barresH(s.parSiteInterv, s.interv.length)}</div>
    </div>
    <div class="deux">
      <div><h3>Jour de la semaine</h3>${barresH(["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"].map((j, i) => [j, s.parJourSemaine[i]]), s.interv.length)}</div>
      <div><h3>Par technicien</h3>${s.techTries.length ? table(["Technicien", "Interv.", "Heures", "Nuit", "Primes"], s.techTries.map(([t, o]) => [esc(t), o.nb, `${fmtNb(o.heures, 1)} h`, `${fmtNb(o.nuit, 1)} h`, euros(o.primes)]),
        ["Total", s.interv.length, `${fmtNb(s.heuresTot, 1)} h`, `${fmtNb(s.heuresNuit, 1)} h`, euros(s.primesDimanche)]) : `<p class="vide">Aucune intervention.</p>`}</div>
    </div>
    ${s.programmes.length ? `<p class="note">Hors astreinte : ${s.programmes.length} passage(s) de travaux programmés (${fmtNb(s.heuresProgrammes, 1)} h), non comptés ci-dessus.</p>` : ""}
  </section>`;

  const conso = Object.entries(s.consoParType).filter(([, x]) => x > 0);
  const secEnergie = !v("compteurs") ? "" : `
  <section>
    <h2><span>3</span> Énergie et compteurs</h2>
    <div class="kpis">
      ${kpi(fmtNb(s.relevesPeriode.length), "relevés effectués")}
      ${kpi(fmtNb(s.compteurs.length), "compteurs suivis")}
      ${kpi(fmtNb(s.compteursEnRetard.length), `sans relevé > ${seuilReleve} j`)}
      ${conso.slice(0, 1).map(([t, x]) => kpi(`${fmtNb(x)} ${typesCompteur[t]?.unite || ""}`, `consommation ${typesCompteur[t]?.label?.toLowerCase() || t}`)).join("")}
    </div>
    ${conso.length ? `<h3>Consommations relevées sur la période</h3>${table(["Énergie", "Consommation", "Principaux compteurs"], conso.map(([t, x]) => [`${typesCompteur[t]?.icone || ""} ${esc(typesCompteur[t]?.label || t)}`, `<b>${fmtNb(x)} ${typesCompteur[t]?.unite || ""}</b>`, (s.topConso[t] || []).slice(0, 3).map((c) => `${esc(c.nom)}${c.site ? ` (${esc(c.site)})` : ""} : ${fmtNb(c.conso)}`).join("<br>")]))}` : `<p class="vide">Pas assez de relevés pour calculer des consommations sur la période.</p>`}
    ${plusieursMois ? `<h3>Relevés par mois</h3>${barresMois(p.mois, [{ nom: "Relevés", valeurs: s.relevesParMois, couleur: "#2a78d6" }])}` : ""}
    ${s.compteursEnRetard.length ? `<h3>Compteurs à relever</h3>${table(["Compteur", "Site", "Dernier relevé"], s.compteursEnRetard.slice(0, 15).map((c) => [esc(c.nom || ""), esc(c.dossierNom || "—"), c._dernier ? new Date(c._dernier).toLocaleDateString("fr-FR") : "jamais"]))}${s.compteursEnRetard.length > 15 ? `<p class="note">… et ${s.compteursEnRetard.length - 15} autre(s).</p>` : ""}` : ""}
  </section>`;

  const sousSeuil = [...s.sousSeuilMaint.map((x) => [x, "Maintenance"]), ...s.sousSeuilMenage.map((x) => [x, `Ménage${x.zone ? " · " + x.zone : ""}`])];
  const secStock = !(v("stock") || v("stock-menage")) ? "" : `
  <section>
    <h2><span>4</span> Stocks et achats</h2>
    <div class="kpis">
      ${v("stock") ? kpi(fmtNb(s.commandes.length), "commandes fournisseurs", comp, variation(s.commandes.length, s.commandesPrev.length), true) : ""}
      ${v("stock-menage") ? kpi(fmtNb(s.totalSorties), "unités ménage consommées", `${fmtNb(s.totalEntrees)} entrées`) : ""}
      ${kpi(fmtNb(sousSeuil.length), "produits sous le seuil", "état actuel")}
    </div>
    <div class="deux">
      ${v("stock") ? `<div><h3>Commandes par fournisseur</h3>${barresH(s.commandesParFournisseur, s.commandes.length)}</div>` : ""}
      ${v("stock-menage") ? `<div><h3>Consommation ménage par site</h3>${barresH(s.quotePartTriee.slice(0, 8), s.totalSorties)}</div>` : ""}
    </div>
    ${sousSeuil.length ? `<h3>Produits sous le seuil minimum</h3>${table(["Produit", "Stock", "Seuil", "Module"], sousSeuil.slice(0, 20).map(([x, m]) => [esc(x.nom || "?"), `<b class="rouge">${fmtNb(x.stockActuel)}</b>`, fmtNb(x.stockMin), esc(m)]))}` : ""}
  </section>`;

  const TYPES_ABS = { conge: "Congés", rtt: "RTT", arret: "Arrêts" };
  const secAbsences = !v("astreinte") ? "" : `
  <section>
    <h2><span>5</span> Absences de l'équipe</h2>
    <div class="kpis">
      ${kpi(fmtNb(s.totalJoursAbsence), "jours d'absence", comp, variation(s.totalJoursAbsence, s.totalJoursAbsencePrev), true)}
      ${Object.entries(s.joursParType).map(([t, j]) => kpi(fmtNb(j), `jours ${(TYPES_ABS[t] || t).toLowerCase()}`)).join("")}
    </div>
    <div class="deux">
      <div><h3>Par personne</h3>${barresH(s.personnesTriees, s.totalJoursAbsence, " j")}</div>
      <div>${plusieursMois ? `<h3>Par mois</h3>${barresH(p.mois.map((m, i) => [m.label, s.absencesParMois[i]]), 0, " j")}` : ""}</div>
    </div>
  </section>`;

  const secPrev = !v("previsionnel") || !s.previsionnel.length ? "" : `
  <section>
    <h2><span>6</span> Prévisionnel travaux ${s.anneeCourante}–${s.anneeCourante + 1}</h2>
    <div class="kpis">${kpi(euros(s.montantPropose), "montant proposé")}${kpi(euros(s.montantValide), "dont validé")}${kpi(fmtNb(s.previsionnel.length), "opérations")}</div>
    <div class="deux">
      <div><h3>Par statut</h3>${barresH(Object.entries(s.parStatutPrev).filter(([, x]) => x).map(([k, x]) => [s.statutsLabels[k] || k, x]), s.montantPropose, "", euros)}</div>
      <div><h3>Par catégorie</h3>${barresH(s.categoriePrevTriee, s.montantPropose, "", euros)}</div>
    </div>
  </section>`;

  const numeros = []; // renumérote les sections présentes
  const corps = [secDemandes, secAstreinte, secEnergie, secStock, secAbsences, secPrev].filter(Boolean)
    .map((h, i) => { numeros.push(i + 1); return h.replace(/<h2><span>\d<\/span>/, `<h2><span>${i + 1}</span>`); }).join("");

  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Rapport d'activité — Service Maintenance — ${esc(periodeLibelle)}</title>
<style>
@page{size:A4 portrait;margin:12mm 12mm 14mm}
*{box-sizing:border-box}
body{font:11.5px/1.45 system-ui,-apple-system,"Segoe UI",Arial,sans-serif;color:#1a1a1a;margin:0;background:#e9ecf1}
.barre{position:sticky;top:0;z-index:2;display:flex;gap:8px;justify-content:center;flex-wrap:wrap;padding:10px;background:#1b2a41}
.barre button{font:700 14px system-ui;padding:9px 16px;border-radius:10px;border:0;background:#c8102e;color:#fff;cursor:pointer}
.barre span{color:#cfd8e6;font-size:12.5px;align-self:center}
.page{max-width:210mm;margin:14px auto;background:#fff;padding:12mm;box-shadow:0 4px 20px rgba(0,0,0,.12)}
header{display:flex;justify-content:space-between;align-items:center;gap:16px;padding-bottom:10px;border-bottom:3px solid #c8102e}
header img{height:54px}
header .t{text-align:right}header h1{margin:0;font-size:20px;color:#1b2a41;letter-spacing:.3px}header p{margin:2px 0 0;color:#555}
.intro{display:flex;flex-wrap:wrap;gap:6px 18px;margin:10px 0 4px;color:#444;font-size:11px}
h2{display:flex;align-items:center;gap:8px;font-size:15px;color:#1b2a41;margin:22px 0 8px;padding-bottom:4px;border-bottom:1px solid #d5dbe5}
h2 span{display:inline-grid;place-items:center;width:22px;height:22px;border-radius:50%;background:#1b2a41;color:#fff;font-size:12px}
h3{font-size:11.5px;text-transform:uppercase;letter-spacing:.4px;color:#667;margin:12px 0 6px}
section{break-inside:auto}
section+section{break-before:page}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:8px 0}
.kpi{border:1px solid #d5dbe5;border-radius:10px;padding:8px 10px;background:#fafbfd;break-inside:avoid}
.kpi b{display:block;font-size:20px;color:#1b2a41;line-height:1.15}.kpi span{display:block;color:#444}.kpi small{display:block;color:#777;font-size:10px;margin-top:2px}
.var{font-weight:800}.var.bon{color:#1b7a3d}.var.mauvais{color:#c8102e}.var.neutre{color:#888}
.synthese .kpis{grid-template-columns:repeat(4,1fr)}
.points{list-style:none;padding:0;margin:6px 0}
.points li{padding:6px 10px 6px 30px;margin:4px 0;border-radius:8px;position:relative;break-inside:avoid}
.points li::before{position:absolute;left:9px;top:6px}
.points .alerte{background:#fdecee}.points .alerte::before{content:"⚠"}
.points .ok{background:#e9f7ef}.points .ok::before{content:"✓";color:#1b7a3d;font-weight:900}
.points .info{background:#eef2f8}.points .info::before{content:"•";font-weight:900;color:#1b2a41}
.deux{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.deux>div{break-inside:avoid}
.graph{display:flex;align-items:flex-end;gap:4px;height:130px;padding:4px 0;border-bottom:1px solid #ccc;break-inside:avoid}
.graph .col{flex:1;display:flex;flex-direction:column;align-items:center;height:100%;min-width:0}
.graph .piles{flex:1;width:100%;display:flex;align-items:flex-end;justify-content:center;gap:2px}
.graph .piles i{width:40%;max-width:18px;border-radius:3px 3px 0 0;min-height:1px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.graph em{font-style:normal;font-size:8.5px;color:#444;white-space:nowrap}.graph small{font-size:9px;color:#666}
.leg{font-size:10px;color:#555;margin:4px 0 0}.leg i{display:inline-block;width:10px;height:10px;border-radius:2px;margin:0 4px 0 10px;vertical-align:-1px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.bh-l{display:grid;grid-template-columns:38% 1fr auto auto;gap:6px;align-items:center;font-size:10.5px;padding:2px 0}
.bh-n{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bh-p{height:9px;background:#eef1f6;border-radius:5px;overflow:hidden}.bh-p i{display:block;height:100%;background:#1b2a41;border-radius:5px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.bh-l small{color:#777;min-width:32px;text-align:right}
table{width:100%;border-collapse:collapse;font-size:10.5px;break-inside:auto}
th{background:#eef1f6;text-align:left;padding:4px 6px;border-bottom:1px solid #c9d1de;font-size:9.5px;text-transform:uppercase;-webkit-print-color-adjust:exact;print-color-adjust:exact}
td{padding:4px 6px;border-bottom:1px solid #e3e7ee;vertical-align:top}
tfoot td{font-weight:800;border-top:2px solid #1b2a41}
tr{break-inside:avoid}
.rouge{color:#c8102e}
.vide,.note{color:#777;font-style:italic;font-size:10.5px}
footer{margin-top:18px;padding-top:6px;border-top:1px solid #d5dbe5;font-size:9.5px;color:#777;display:flex;justify-content:space-between}
@media print{body{background:#fff}.barre{display:none}.page{box-shadow:none;margin:0;padding:0;max-width:none}}
@media (max-width:640px){.kpis,.synthese .kpis{grid-template-columns:1fr 1fr}.deux{grid-template-columns:1fr}.page{padding:14px}}
</style></head><body>
<div class="barre"><button onclick="window.print()">🖨 Imprimer / Enregistrer en PDF</button><span>Conseil : format A4, orientation portrait.</span></div>
<div class="page">
<header><img src="${esc(ctx.logo)}" alt="Groupe Établières"><div class="t"><h1>RAPPORT D'ACTIVITÉ</h1><p>Service Maintenance et Ménage</p></div></header>
<div class="intro"><span>📅 <b>${esc(periodeLibelle)}</b> — du ${fr(p.debut)} au ${fr(p.fin)}</span><span>🏷️ ${filtres.association ? `Association : <b>${esc(filtres.association)}</b>` : "Toutes associations"}</span><span>↔ Comparaison ${esc(comp.replace(/^vs /, "avec "))} (${fr(p.prevDebut)} → ${fr(p.prevFin)})</span></div>

<section class="synthese">
  <h2>Synthèse</h2>
  <div class="kpis">
    ${v("suivi-demandes") ? kpi(fmtNb(s.dem.length), "demandes reçues", "", variation(s.dem.length, s.demPrev.length), true) : ""}
    ${v("suivi-demandes") ? kpi(`${s.pctTraitees} %`, "demandes traitées", s.delaiMoyen === null ? "" : `délai moyen ${fmtNb(s.delaiMoyen, 1)} j`) : ""}
    ${v("astreinte") ? kpi(fmtNb(s.interv.length), "interventions d'astreinte", "", variation(s.interv.length, s.intervPrev.length), true) : ""}
    ${v("astreinte") ? kpi(`${fmtNb(s.heuresTot, 1)} h`, "heures d'astreinte", "", variation(s.heuresTot, s.heuresPrev), true) : ""}
    ${v("compteurs") ? kpi(fmtNb(s.relevesPeriode.length), "relevés de compteurs", `${s.compteursEnRetard.length} en retard`) : ""}
    ${v("stock") ? kpi(fmtNb(s.commandes.length), "commandes fournisseurs", "", variation(s.commandes.length, s.commandesPrev.length), true) : ""}
    ${v("astreinte") ? kpi(fmtNb(s.totalJoursAbsence), "jours d'absence", "", variation(s.totalJoursAbsence, s.totalJoursAbsencePrev), true) : ""}
    ${v("previsionnel") && s.montantPropose ? kpi(euros(s.montantValide), "travaux validés", `sur ${euros(s.montantPropose)} proposés`) : ""}
  </div>
  <p class="note">Patrimoine suivi : ${data.sites.length} site(s) · ${s.compteurs.length} compteur(s). Les flèches comparent à la période précédente (▲ hausse, ▼ baisse).</p>
  ${points.length ? `<h3>Points clés et points d'attention</h3><ul class="points">${points.map(([c, t]) => `<li class="${c}">${t}</li>`).join("")}</ul>` : ""}
</section>
${corps}
<footer><span>Groupe Établières — Service Maintenance · Rapport édité le ${aujourdhui}${auteur ? ` par ${esc(auteur)}` : ""}</span><span>Source : application Service Maintenance et Ménage</span></footer>
</div>
</body></html>`;

  const w = ctx.fenetre || window.open("", "_blank");
  if (w) { w.document.open(); w.document.write(html); w.document.close(); return; }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  a.download = `rapport-activite-${p.debut}-${p.fin}.html`; a.click();
}

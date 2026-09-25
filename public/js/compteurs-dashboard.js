// compteurs-dashboard.js
// "Centre de contrôle énergie" — tableau de bord des compteurs façon salle
// de contrôle : tout est lisible d'un coup d'œil, sans aucune librairie de
// graphiques (SVG + CSS uniquement, donc aussi rapide sur téléphone).
//
//  1. HUD : taux de relevés à jour (jauge circulaire), compteurs, retards,
//     illisibles, activité des 30 derniers jours vs les 30 précédents.
//  2. Réacteurs : un par énergie (eau, gaz, chauffage urbain, électricité)
//     — consommation 30 j, courbe 12 mois, tendance, retards du type.
//  3. Constellation : radar des sites par association ; chaque compteur
//     est un satellite coloré par énergie, ceux en retard pulsent en rouge.
//  4. Matrice de couverture : sites × 12 mois — chaque case s'allume selon
//     la part des compteurs du site relevés ce mois-là (trous visibles).
//  5. Flux : derniers relevés en direct. 6. Alertes + top consommateurs.

import { esc } from "./astreinte-logic.js";
import { estEnRetard, consommationMensuelleAgregee, consommationRecente, uniteValeur } from "./compteurs-data.js";

const TYPES = [
  { id: "eau", label: "Eau", icone: "💧", couleur: "#27D3FF" },
  { id: "gaz", label: "Gaz", icone: "🔥", couleur: "#FF8A3D" },
  { id: "chauffage", label: "Chauffage urbain", icone: "🌡️", couleur: "#FF3DA8" },
  { id: "elec", label: "Électricité", icone: "⚡", couleur: "#F7E13B" },
];
const COUL = Object.fromEntries(TYPES.map(t => [t.id, t.couleur]));
const JOUR = 86400000;
const fmt = (n, d = 0) => n === null || n === undefined || !Number.isFinite(n) ? "—" : new Intl.NumberFormat("fr-FR", { maximumFractionDigits: d }).format(n);
const pad = n => String(n).padStart(2, "0");
const moisCle = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const ilYa = ms => {
  const s = (Date.now() - ms) / 1000;
  if (s < 3600) return `il y a ${Math.max(1, Math.round(s / 60))} min`;
  if (s < 86400) return `il y a ${Math.round(s / 3600)} h`;
  return `il y a ${Math.round(s / 86400)} j`;
};
const nomCourt = n => String(n || "").replace(/\s*\([^)]*@[^)]*\)\s*/g, " ").replace(/\S+@\S+/g, "").replace(/\s{2,}/g, " ").trim();

let horlogeTimer = null;

export function renderCentreControle(container, { compteurs, sites, associations, releves, typeTop, onRetour, onRelever, onOuvrirSite, onTypeTop }) {
  if (horlogeTimer) { clearInterval(horlogeTimer); horlogeTimer = null; }
  const maintenant = Date.now();

  // ---------- Indicateurs globaux ----------
  const enRetard = compteurs.filter(estEnRetard);
  const pctAJour = compteurs.length ? Math.round(((compteurs.length - enRetard.length) / compteurs.length) * 100) : 0;
  const rel30 = releves.filter(r => r.createdAt && r.createdAt > maintenant - 30 * JOUR).length;
  const rel60 = releves.filter(r => r.createdAt && r.createdAt > maintenant - 60 * JOUR && r.createdAt <= maintenant - 30 * JOUR).length;
  const deltaActivite = rel60 ? Math.round(((rel30 - rel60) / rel60) * 100) : null;
  const illisibles = releves.filter(r => r.createdAt > maintenant - 90 * JOUR && r.illisibles && Object.values(r.illisibles).some(Boolean)).length;
  const sitesAvecCompteurs = sites.filter(s => compteurs.some(c => c.dossierId === s.id));

  // ---------- Réacteurs par énergie ----------
  const reacteurs = TYPES.map(t => {
    const liste = compteurs.filter(c => c.type === t.id);
    if (!liste.length) return null;
    const { labels, valeurs } = consommationMensuelleAgregee(liste, releves);
    let c30 = 0, ok30 = false;
    liste.forEach(c => { const v = consommationRecente(c, releves, 30); if (v !== null) { c30 += v; ok30 = true; } });
    const connus = valeurs.filter(v => v !== null);
    const dernier = valeurs[valeurs.length - 1];
    const moyenne = connus.length > 1 ? connus.slice(0, -1).reduce((s, v) => s + v, 0) / (connus.length - 1) : null;
    const tendance = dernier !== null && moyenne ? Math.round(((dernier - moyenne) / moyenne) * 100) : null;
    return { ...t, liste, labels, valeurs, c30: ok30 ? c30 : null, tendance, retard: liste.filter(estEnRetard).length, unite: uniteValeur({ type: t.id }) };
  }).filter(Boolean);

  // ---------- Matrice de couverture (sites × 12 mois) ----------
  const mois = [];
  const d0 = new Date();
  for (let i = 11; i >= 0; i--) { const d = new Date(d0.getFullYear(), d0.getMonth() - i, 1); mois.push({ cle: moisCle(d), label: d.toLocaleDateString("fr-FR", { month: "narrow" }), long: d.toLocaleDateString("fr-FR", { month: "long", year: "numeric" }) }); }
  const ordreAssoc = new Map(associations.map((a, i) => [a.nom, i]));
  const sitesTries = [...sitesAvecCompteurs].sort((a, b) =>
    (ordreAssoc.get(a.association) ?? 99) - (ordreAssoc.get(b.association) ?? 99) || (a.nom || "").localeCompare(b.nom || "", "fr"));
  const couverture = sitesTries.map(s => {
    const ids = new Set(compteurs.filter(c => c.dossierId === s.id).map(c => c.id));
    const cells = mois.map(m => {
      const releve = new Set(releves.filter(r => ids.has(r.compteurId) && r.createdAt && moisCle(new Date(r.createdAt)) === m.cle).map(r => r.compteurId));
      return ids.size ? releve.size / ids.size : 0;
    });
    return { site: s, cells, nb: ids.size };
  });

  // ---------- Top consommateurs ----------
  const parSite = {};
  compteurs.filter(c => c.type === typeTop).forEach(c => {
    const v = consommationRecente(c, releves, 365);
    if (v === null) return;
    parSite[c.dossierId] = (parSite[c.dossierId] || 0) + v;
  });
  const top = Object.entries(parSite).sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([id, v]) => ({ site: sites.find(s => s.id === id), v }));
  const topMax = top[0]?.v || 1;

  // ---------- Flux ----------
  const nomCompteur = new Map(compteurs.map(c => [c.id, c]));
  const flux = [...releves].filter(r => r.createdAt).sort((a, b) => b.createdAt - a.createdAt).slice(0, 14);

  container.innerHTML = `
    <div class="cc">
      <div class="cc-grille-fond"></div>
      <header class="cc-entete">
        <button class="cc-btn" id="cc-retour">← Retour</button>
        <div class="cc-titre">
          <span class="cc-sur">GROUPE ÉTABLIÈRES · SERVICE MAINTENANCE</span>
          <h2>CENTRE DE CONTRÔLE <em>ÉNERGIE</em></h2>
        </div>
        <div class="cc-horloge"><span id="cc-heure">${new Date().toLocaleTimeString("fr-FR")}</span><small>${new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}</small><i class="cc-live">● EN DIRECT</i></div>
      </header>

      <!-- HUD -->
      <section class="cc-hud">
        <div class="cc-jauge">
          ${jauge(pctAJour)}
          <div class="cc-jauge-txt"><b>${pctAJour}<small>%</small></b><span>compteurs à jour</span></div>
        </div>
        <div class="cc-kpis">
          ${kpi("Compteurs actifs", fmt(compteurs.length), `${sitesAvecCompteurs.length} sites équipés`, "cyan")}
          ${kpi("En retard", fmt(enRetard.length), enRetard.length ? "à relever maintenant" : "tout est à jour", enRetard.length ? "rouge" : "vert")}
          ${kpi("Relevés 30 j", fmt(rel30), deltaActivite === null ? "activité" : `${deltaActivite >= 0 ? "▲" : "▼"} ${Math.abs(deltaActivite)} % vs 30 j préc.`, "violet")}
          ${kpi("Illisibles 90 j", fmt(illisibles), "buée, cadran, accès", illisibles ? "ambre" : "vert")}
        </div>
      </section>

      <!-- Réacteurs -->
      <section class="cc-reacteurs">
        ${reacteurs.map(r => `
          <article class="cc-reacteur" style="--c:${r.couleur}">
            <div class="cc-orbe"><span>${r.icone}</span></div>
            <div class="cc-reac-corps">
              <p class="cc-reac-nom">${esc(r.label.toUpperCase())} <small>${r.liste.length} compteur${r.liste.length > 1 ? "s" : ""}${r.retard ? ` · <em>${r.retard} en retard</em>` : ""}</small></p>
              <p class="cc-reac-val">${fmt(r.c30)} <small>${r.unite} · 30 derniers jours</small></p>
              ${sparkline(r.valeurs, r.couleur)}
              <p class="cc-reac-pied"><span>${r.labels[0]} → ${r.labels[r.labels.length - 1]}</span>${r.tendance === null ? "" : `<b class="${r.tendance > 10 ? "cc-hausse" : r.tendance < -10 ? "cc-baisse" : ""}">${r.tendance >= 0 ? "▲" : "▼"} ${Math.abs(r.tendance)} % ce mois vs moyenne</b>`}</p>
            </div>
          </article>`).join("")}
      </section>

      <div class="cc-deux">
        <!-- Constellation -->
        <section class="cc-panneau">
          <h3>CONSTELLATION DES SITES <small>chaque point = un compteur · rouge = en retard · clic = ouvrir le site</small></h3>
          ${constellation(sitesTries, compteurs, associations)}
          <div class="cc-legende">${TYPES.filter(t => compteurs.some(c => c.type === t.id)).map(t => `<span><i style="background:${t.couleur}"></i>${t.label}</span>`).join("")}<span><i class="cc-leg-retard"></i>En retard</span></div>
        </section>

        <!-- Flux -->
        <section class="cc-panneau">
          <h3>FLUX DES RELEVÉS <small>derniers enregistrements</small></h3>
          <div class="cc-flux">
            ${flux.length === 0 ? `<p class="cc-vide">Aucun relevé pour l'instant.</p>` : flux.map(r => {
              const c = nomCompteur.get(r.compteurId);
              const ill = r.illisibles && Object.values(r.illisibles).some(Boolean);
              return `<div class="cc-flux-ligne" style="--c:${COUL[r.type] || "#8FA3BF"}">
                <i></i>
                <div><b>${esc(nomCourt(r.dossierNom))}</b> · ${esc(r.nomCompteur || c?.nom || "")}${ill ? ` <span class="cc-tag-ambre">illisible</span>` : ""}${r.saisiHorsDate ? ` <span class="cc-tag">antidaté</span>` : ""}
                  <small>${esc(r.releveParNom || "")} · ${ilYa(r.createdAt)}</small></div>
              </div>`;
            }).join("")}
          </div>
        </section>
      </div>

      <!-- Matrice -->
      <section class="cc-panneau">
        <h3>MATRICE DE COUVERTURE <small>part des compteurs de chaque site relevés chaque mois — une case éteinte = aucun relevé</small></h3>
        <div class="cc-matrice-scroll">
          <table class="cc-matrice">
            <thead><tr><th></th>${mois.map(m => `<th title="${esc(m.long)}">${m.label}</th>`).join("")}<th>État</th></tr></thead>
            <tbody>
              ${couverture.map(l => {
                const retardSite = compteurs.filter(c => c.dossierId === l.site.id && estEnRetard(c)).length;
                return `<tr>
                  <td class="cc-mat-nom"><button data-cc-site="${l.site.id}" title="${esc(l.site.nom)}">${esc(nomCourt(l.site.nom))}</button></td>
                  ${l.cells.map((v, i) => `<td><span class="cc-cell" style="--a:${v === 0 ? 0 : 0.25 + v * 0.75}" title="${esc(mois[i].long)} : ${Math.round(v * 100)} % relevé"></span></td>`).join("")}
                  <td>${retardSite ? `<span class="cc-etat cc-etat-r">${retardSite} ⚠</span>` : `<span class="cc-etat">OK</span>`}</td>
                </tr>`;
              }).join("")}
            </tbody>
          </table>
        </div>
      </section>

      <div class="cc-deux">
        <!-- Alertes -->
        <section class="cc-panneau ${enRetard.length ? "cc-alerte" : ""}">
          <h3>${enRetard.length ? "⚠ ALERTES — COMPTEURS EN RETARD" : "✓ AUCUNE ALERTE"} <small>${enRetard.length ? `${enRetard.length} à relever` : "tous les compteurs sont à jour"}</small></h3>
          <div class="cc-alertes">
            ${enRetard.slice(0, 30).map(c => `
              <div class="cc-alerte-ligne" style="--c:${COUL[c.type] || "#fff"}">
                <i></i><div><b>${esc(c.nom)}</b><small>${esc(nomCourt(c.dossierNom))} · ${c.dernierReleve?.at ? `dernier relevé ${ilYa(c.dernierReleve.at)}` : "jamais relevé"}</small></div>
                <button class="cc-btn cc-btn-rouge" data-cc-relever="${c.id}">Relever</button>
              </div>`).join("")}
          </div>
        </section>

        <!-- Top -->
        <section class="cc-panneau">
          <h3>PLUS GROS CONSOMMATEURS <small>12 derniers mois</small></h3>
          <div class="cc-top-choix">${reacteurs.map(r => `<button class="cc-chip ${r.id === typeTop ? "cc-chip-on" : ""}" style="--c:${r.couleur}" data-cc-top="${r.id}">${r.icone} ${esc(r.label)}</button>`).join("")}</div>
          ${top.length === 0 ? `<p class="cc-vide">Pas encore assez d'historique pour ce type.</p>` : top.map((t, i) => `
            <div class="cc-barre" style="--c:${COUL[typeTop]};--w:${Math.max(4, (t.v / topMax) * 100)}%">
              <span class="cc-rang">${String(i + 1).padStart(2, "0")}</span>
              <span class="cc-barre-nom">${esc(nomCourt(t.site?.nom || "?"))}</span>
              <span class="cc-barre-piste"><span></span></span>
              <b>${fmt(t.v)} ${uniteValeur({ type: typeTop })}</b>
            </div>`).join("")}
        </section>
      </div>
    </div>`;

  container.querySelector("#cc-retour")?.addEventListener("click", onRetour);
  container.querySelectorAll("[data-cc-relever]").forEach(b => b.addEventListener("click", () => onRelever(b.dataset.ccRelever)));
  container.querySelectorAll("[data-cc-site]").forEach(b => b.addEventListener("click", () => onOuvrirSite(b.dataset.ccSite)));
  container.querySelectorAll("[data-cc-top]").forEach(b => b.addEventListener("click", () => onTypeTop(b.dataset.ccTop)));
  horlogeTimer = setInterval(() => {
    const el = document.getElementById("cc-heure");
    if (!el) { clearInterval(horlogeTimer); horlogeTimer = null; return; }
    el.textContent = new Date().toLocaleTimeString("fr-FR");
  }, 1000);
}

function kpi(label, valeur, sous, ton) {
  return `<div class="cc-kpi cc-${ton}"><span>${esc(label)}</span><b>${valeur}</b><small>${esc(sous)}</small></div>`;
}

// Jauge circulaire segmentée (60 graduations), allumées jusqu'au taux.
function jauge(pct) {
  const n = 60, allumes = Math.round((pct / 100) * n);
  const coul = pct >= 90 ? "#3CFFB0" : pct >= 70 ? "#F7E13B" : "#FF4D6D";
  let traits = "";
  for (let i = 0; i < n; i++) {
    const a = (-90 + (i / n) * 360) * Math.PI / 180;
    const r1 = 78, r2 = i % 5 === 0 ? 92 : 88;
    traits += `<line x1="${100 + r1 * Math.cos(a)}" y1="${100 + r1 * Math.sin(a)}" x2="${100 + r2 * Math.cos(a)}" y2="${100 + r2 * Math.sin(a)}" stroke="${i < allumes ? coul : "rgba(120,160,220,.18)"}" stroke-width="3" stroke-linecap="round"${i < allumes ? ` style="filter:drop-shadow(0 0 3px ${coul})"` : ""}/>`;
  }
  return `<svg viewBox="0 0 200 200" class="cc-jauge-svg">
    <circle cx="100" cy="100" r="66" fill="none" stroke="rgba(39,211,255,.15)" stroke-width="1"/>
    <circle cx="100" cy="100" r="98" fill="none" stroke="rgba(39,211,255,.12)" stroke-width="1" stroke-dasharray="2 6"/>
    <g class="cc-rotation"><circle cx="100" cy="100" r="72" fill="none" stroke="${coul}" stroke-width="1.5" stroke-dasharray="40 412" opacity=".8"/></g>
    ${traits}
  </svg>`;
}

// Courbe 12 mois en aire lumineuse ; les mois sans donnée sont des creux pointillés.
function sparkline(valeurs, couleur) {
  const W = 260, H = 56, n = valeurs.length;
  const max = Math.max(1, ...valeurs.filter(v => v !== null));
  const pts = valeurs.map((v, i) => [(i / (n - 1)) * W, v === null ? null : H - 4 - (v / max) * (H - 10)]);
  const segs = []; let cur = [];
  pts.forEach(p => { if (p[1] === null) { if (cur.length) segs.push(cur); cur = []; } else cur.push(p); });
  if (cur.length) segs.push(cur);
  const id = "g" + Math.random().toString(36).slice(2, 8);
  const lignes = segs.map(s => s.length === 1
    ? `<circle cx="${s[0][0]}" cy="${s[0][1]}" r="3" fill="${couleur}"/>`
    : `<path d="M${s.map(p => p.join(",")).join(" L")} L${s[s.length - 1][0]},${H} L${s[0][0]},${H} Z" fill="url(#${id})"/><path d="M${s.map(p => p.join(",")).join(" L")}" fill="none" stroke="${couleur}" stroke-width="2" style="filter:drop-shadow(0 0 4px ${couleur})"/>`).join("");
  const vides = pts.map((p, i) => p[1] === null ? `<line x1="${p[0]}" y1="${H - 2}" x2="${p[0]}" y2="${H - 8}" stroke="rgba(160,190,230,.25)"/>` : "").join("");
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="cc-spark">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${couleur}" stop-opacity=".45"/><stop offset="1" stop-color="${couleur}" stop-opacity="0"/></linearGradient></defs>
    ${vides}${lignes}
  </svg>`;
}

// Radar : associations en secteurs, sites en nœuds, compteurs en satellites.
function constellation(sites, compteurs, associations) {
  const S = 420, C = S / 2;
  const noms = [...new Set(sites.map(s => s.association || "Autres"))];
  const nomsTries = [...associations.map(a => a.nom).filter(n => noms.includes(n)), ...noms.filter(n => !associations.some(a => a.nom === n))];
  const parAssoc = nomsTries.map(n => ({ nom: n, sites: sites.filter(s => (s.association || "Autres") === n) }));
  const total = Math.max(1, sites.length);
  let angle = -Math.PI / 2;
  let secteurs = "", noeuds = "", etiquettes = "";
  const couleursAssoc = ["#27D3FF", "#FF3DA8", "#3CFFB0", "#F7E13B", "#A98BFF"];
  parAssoc.forEach((g, gi) => {
    const part = (g.sites.length / total) * Math.PI * 2;
    const a0 = angle, a1 = angle + part;
    const ca = couleursAssoc[gi % couleursAssoc.length];
    // séparation de secteur + nom de l'association
    secteurs += `<line x1="${C}" y1="${C}" x2="${C + 196 * Math.cos(a0)}" y2="${C + 196 * Math.sin(a0)}" stroke="rgba(120,170,240,.18)"/>`;
    const am = (a0 + a1) / 2;
    etiquettes += `<text x="${C + 205 * Math.cos(am)}" y="${C + 205 * Math.sin(am)}" fill="${ca}" font-size="10" font-weight="700" text-anchor="${Math.cos(am) > 0.2 ? "start" : Math.cos(am) < -0.2 ? "end" : "middle"}" dominant-baseline="middle" letter-spacing="1">${esc(g.nom.toUpperCase())}</text>`;
    g.sites.forEach((s, i) => {
      const a = a0 + ((i + 0.5) / g.sites.length) * part;
      const r = 70 + (i % 3) * 42 + (g.sites.length > 8 ? (i % 2) * 14 : 0);
      const x = C + r * Math.cos(a), y = C + r * Math.sin(a);
      const cs = compteurs.filter(c => c.dossierId === s.id);
      const retard = cs.some(estEnRetard);
      let sats = "";
      cs.forEach((c, k) => {
        const b = (k / cs.length) * Math.PI * 2 + a;
        const sx = x + 11 * Math.cos(b), sy = y + 11 * Math.sin(b);
        const late = estEnRetard(c);
        sats += `<circle cx="${sx}" cy="${sy}" r="${late ? 3.2 : 2.4}" fill="${late ? "#FF4D6D" : (COUL[c.type] || "#fff")}" ${late ? `class="cc-pulse"` : ""}><title>${esc(c.nom)}${late ? " — EN RETARD" : ""}</title></circle>`;
      });
      noeuds += `<g class="cc-noeud" data-cc-site="${s.id}" style="cursor:pointer">
        <line x1="${C}" y1="${C}" x2="${x}" y2="${y}" stroke="${ca}" stroke-opacity=".12"/>
        <circle cx="${x}" cy="${y}" r="15" fill="transparent"/>
        <circle cx="${x}" cy="${y}" r="5.5" fill="${retard ? "#FF4D6D" : ca}" style="filter:drop-shadow(0 0 6px ${retard ? "#FF4D6D" : ca})"/>
        ${sats}
        <title>${esc(nomCourt(s.nom))} — ${cs.length} compteur(s)${retard ? " · retard" : ""}</title>
      </g>`;
    });
    angle = a1;
  });
  return `<svg viewBox="-60 -20 ${S + 120} ${S + 40}" class="cc-radar">
    <defs><radialGradient id="cc-rg"><stop offset="0" stop-color="#27D3FF" stop-opacity=".35"/><stop offset="1" stop-color="#27D3FF" stop-opacity="0"/></radialGradient>
      <linearGradient id="cc-sweep" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#27D3FF" stop-opacity="0"/><stop offset="1" stop-color="#27D3FF" stop-opacity=".35"/></linearGradient></defs>
    ${[70, 112, 154, 196].map(r => `<circle cx="${C}" cy="${C}" r="${r}" fill="none" stroke="rgba(39,211,255,.14)" stroke-dasharray="${r === 196 ? "0" : "3 5"}"/>`).join("")}
    <circle cx="${C}" cy="${C}" r="196" fill="url(#cc-rg)" opacity=".25"/>
    <g class="cc-balayage" style="transform-origin:${C}px ${C}px"><path d="M${C},${C} L${C + 196},${C} A196,196 0 0,0 ${C + 196 * Math.cos(-0.6)},${C + 196 * Math.sin(-0.6)} Z" fill="url(#cc-sweep)"/></g>
    ${secteurs}${noeuds}${etiquettes}
    <circle cx="${C}" cy="${C}" r="16" fill="#061126" stroke="#27D3FF" stroke-width="1.5"/>
    <text x="${C}" y="${C + 4}" fill="#27D3FF" font-size="11" font-weight="800" text-anchor="middle">${compteurs.length}</text>
  </svg>`;
}

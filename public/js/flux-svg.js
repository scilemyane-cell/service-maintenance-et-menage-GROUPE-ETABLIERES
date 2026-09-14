// flux-svg.js
// Diagramme de flux animé façon "Sankey" fait maison (SVG pur, sans
// librairie externe) — un point central qui se déverse en rubans colorés
// vers plusieurs destinations, avec des particules lumineuses qui
// voyagent réellement le long de chaque flux. Utilisé par Stock Ménage
// et Stock résidence (déporté par site).

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// holder : élément DOM vide dans lequel dessiner.
// entries : tableau [ [nom, quantite], ... ], déjà trié.
// total : somme des quantités (pour les pourcentages).
// options : { labelCentre, reserveTotal, iconeCentre }
//   labelCentre  : texte dans le nœud de gauche (ex. "STOCK")
//   reserveTotal : nombre affiché au-dessus du nœud de gauche (optionnel)
//   iconeCentre  : emoji devant labelCentre (optionnel, défaut 📦)
export function dessinerFluxSVG(holder, entries, total, options = {}) {
  const { labelCentre = "STOCK", reserveTotal = null, iconeCentre = "📦" } = options;
  const largeur = 720, hauteur = Math.max(280, entries.length * 62);
  const gapRatio = entries.length > 1 ? 0.2 : 0;
  const hauteurUtile = hauteur * (1 - gapRatio);
  const gap = entries.length > 1 ? (hauteur * gapRatio) / (entries.length - 1) : 0;
  const leftX = 36, leftW = 34, rightX = largeur - 210, rightW = 16;
  const midX = (leftX + leftW + rightX) / 2;
  const palette = ["#B08D46", "#3FB6AC", "#C24444", "#6B5CA5", "#4C8CC2", "#C29A3F", "#5FA85A", "#A15C9E", "#D98A47", "#5C9EAD"];
  const tronquer = (s, n) => s.length > n ? s.slice(0, n - 1) + "…" : s;

  let cumulLeft = 0, cumulRight = 0;
  const rubans = entries.map(([nom, qte], i) => {
    const h = total > 0 ? (qte / total) * hauteurUtile : 0;
    const r = { nom, qte, h, y0Left: cumulLeft, y1Left: cumulLeft + h, y0Right: cumulRight, y1Right: cumulRight + h, color: palette[i % palette.length] };
    cumulLeft += h;
    cumulRight += h + gap;
    return r;
  });

  const svgDefs = `
    <defs>
      <filter id="fx-glow" x="-60%" y="-60%" width="220%" height="220%">
        <feGaussianBlur stdDeviation="3.2" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
      <filter id="fx-shadow" x="-30%" y="-30%" width="160%" height="160%">
        <feDropShadow dx="0" dy="2" stdDeviation="3" flood-opacity="0.35"/>
      </filter>
      ${rubans.map((r, i) => `
        <linearGradient id="fx-grad-${i}" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="var(--gold, #B08D46)"/>
          <stop offset="100%" stop-color="${r.color}"/>
        </linearGradient>
      `).join("")}
    </defs>
  `;

  const svgRubans = rubans.map((r, i) => {
    const centerY0 = (r.y0Left + r.y1Left) / 2, centerY1 = (r.y0Right + r.y1Right) / 2;
    const pathBord = `M ${leftX + leftW},${r.y0Left} C ${midX},${r.y0Left} ${midX},${r.y0Right} ${rightX},${r.y0Right} L ${rightX},${r.y1Right} C ${midX},${r.y1Right} ${midX},${r.y1Left} ${leftX + leftW},${r.y1Left} Z`;
    const pathCentre = `M ${leftX + leftW},${centerY0} C ${midX},${centerY0} ${midX},${centerY1} ${rightX},${centerY1}`;
    return `
      <path d="${pathBord}" fill="url(#fx-grad-${i})" fill-opacity="0.4" stroke="none"/>
      <path id="fx-centre-${i}" d="${pathCentre}" fill="none" stroke="none"/>
      <circle r="4.5" fill="${r.color}" filter="url(#fx-glow)">
        <animateMotion dur="${(2.6 - Math.min(1.4, r.h / hauteurUtile * 2)).toFixed(2)}s" repeatCount="indefinite" rotate="auto">
          <mpath href="#fx-centre-${i}" xlink:href="#fx-centre-${i}"/>
        </animateMotion>
      </circle>
      <circle r="3" fill="#fff" opacity="0.9">
        <animateMotion dur="${(2.6 - Math.min(1.4, r.h / hauteurUtile * 2)).toFixed(2)}s" begin="-0.5s" repeatCount="indefinite" rotate="auto">
          <mpath href="#fx-centre-${i}" xlink:href="#fx-centre-${i}"/>
        </animateMotion>
      </circle>
    `;
  }).join("");

  const svgNoeudsDroite = rubans.map(r => `
    <rect x="${rightX}" y="${r.y0Right}" width="${rightW}" height="${Math.max(3, r.h)}" rx="5" fill="${r.color}" filter="url(#fx-shadow)"/>
    <text x="${rightX + rightW + 12}" y="${(r.y0Right + r.y1Right) / 2 - 5}" fill="var(--text, #eee)" font-size="13" font-weight="700"><title>${esc(r.nom)}</title>${esc(tronquer(r.nom, 22))}</text>
    <text x="${rightX + rightW + 12}" y="${(r.y0Right + r.y1Right) / 2 + 13}" fill="var(--text-dim, #999)" font-size="11">${r.qte} unités · ${total > 0 ? Math.round((r.qte / total) * 100) : 0}%</text>
  `).join("");

  holder.innerHTML = `
    <svg viewBox="0 ${reserveTotal !== null ? -28 : 0} ${largeur} ${hauteur + (reserveTotal !== null ? 28 : 0)}" xmlns:xlink="http://www.w3.org/1999/xlink" style="width:100%;min-width:520px;height:${hauteur + (reserveTotal !== null ? 28 : 0)}px">
      ${svgDefs}
      <rect x="${leftX}" y="0" width="${leftW}" height="${hauteurUtile}" rx="${leftW / 2}" fill="var(--gold, #B08D46)" filter="url(#fx-shadow)"/>
      <text x="${leftX + leftW / 2}" y="${hauteurUtile / 2}" fill="#fff" font-size="12" font-weight="800" text-anchor="middle" letter-spacing="1" transform="rotate(-90 ${leftX + leftW / 2} ${hauteurUtile / 2})">${iconeCentre} ${esc(labelCentre)}</text>
      ${reserveTotal !== null ? `
        <text x="${leftX + leftW / 2}" y="-10" text-anchor="middle" font-size="13" font-weight="800" fill="var(--gold, #B08D46)">${reserveTotal}</text>
        <text x="${leftX + leftW / 2}" y="6" text-anchor="middle" font-size="9" fill="var(--text-dim, #999)">en réserve</text>
      ` : ""}
      ${svgRubans}
      ${svgNoeudsDroite}
    </svg>
  `;
}

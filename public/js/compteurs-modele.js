// compteurs-modele.js — « Mode modélisation » du schéma des compteurs.
// Un plan libre : on pose les compteurs (glissés depuis la liste de gauche),
// on les déplace, on tire un fil du rond du bas d'un compteur jusqu'au
// compteur qu'il alimente, on clique sur un fil pour le dire « déduit » ou
// « pour info ». « Enregistrer » écrit compteurParentId / nonDeduit et la
// position sur le plan (schemaPos), puis on revient au schéma visuel.
import { esc } from "./astreinte-logic.js";
import { modifierCompteur } from "./compteurs-data.js";
import { ENERGIES, estEauChaude, estDeduit, cmpCompteurs } from "./compteurs-schema.js";

const nomCourt = n => String(n || "").replace(/\S+@\S+/g, "").replace(/\s{2,}/g, " ").trim();
const LARG = 190, HAUT = 84, PAS_X = 220, PAS_Y = 150;
const ms = { energie: null, portee: "" }; // portee = "a:<association>" ou "s:<siteId>"

export function renderModele(container, { compteurs, sites = [], associations = [], energie, onRetour }) {
  const presentes = ENERGIES.filter(e => compteurs.some(c => c.type === e.id));
  if (energie) ms.energie = energie;
  if (!ms.energie || !presentes.some(e => e.id === ms.energie)) ms.energie = (presentes[0] || ENERGIES[0]).id;
  const E = ENERGIES.find(e => e.id === ms.energie);
  const siteDe = new Map(sites.map(s => [s.id, s]));
  const assocDe = (c) => siteDe.get(c.dossierId)?.association || "";
  const duType = compteurs.filter(c => c.type === ms.energie);

  // Portée : une association entière ou un seul site.
  const nomsAssoc = [...new Set([...associations.map(a => a.nom), ...duType.map(assocDe)])].filter(n => duType.some(c => assocDe(c) === n));
  if (duType.some(c => !assocDe(c)) && !nomsAssoc.includes("")) nomsAssoc.push("");
  const sitesAvec = (n) => sites.filter(s => (s.association || "") === n && duType.some(c => c.dossierId === s.id)).sort((a, b) => nomCourt(a.nom).localeCompare(nomCourt(b.nom), "fr", { numeric: true }));
  const valides = new Set(nomsAssoc.flatMap(n => [`a:${n}`, ...sitesAvec(n).map(s => `s:${s.id}`)]));
  if (!valides.has(ms.portee)) ms.portee = `a:${nomsAssoc[0] ?? ""}`;
  const dansPortee = (c) => ms.portee.startsWith("s:") ? c.dossierId === ms.portee.slice(2) : assocDe(c) === ms.portee.slice(2);
  const liste = duType.filter(dansPortee).sort(cmpCompteurs);
  const ids = new Set(liste.map(c => c.id));

  // Brouillon : rien n'est écrit avant « Enregistrer ».
  const d = new Map(liste.map(c => [c.id, { parent: c.compteurParentId || null, nonDeduit: c.nonDeduit, pos: c.schemaPos && Number.isFinite(c.schemaPos.x) ? { ...c.schemaPos } : null }]));
  const lien = (c) => { const p = d.get(c.id).parent; return p && ids.has(p) ? p : null; };
  const relies = new Set(); liste.forEach(c => { const p = lien(c); if (p) { relies.add(c.id); relies.add(p); } });
  // Compteurs reliés sans position : on les dispose en arbre.
  const disposer = (set) => {
    const aPlacer = liste.filter(c => set.has(c.id));
    const enf = (id) => aPlacer.filter(c => lien(c) === id);
    const racines = aPlacer.filter(c => !lien(c) || !set.has(lien(c)));
    let x0 = 0;
    liste.forEach(c => { const p = d.get(c.id).pos; if (p && !set.has(c.id)) x0 = Math.max(x0, p.x + PAS_X); });
    const largeur = (c) => { const e = enf(c.id); return e.length ? e.reduce((t, x) => t + largeur(x), 0) : 1; };
    const placer = (c, gauche, niveau) => {
      const w = largeur(c);
      d.get(c.id).pos = { x: Math.round(40 + (gauche + w / 2 - 0.5) * PAS_X), y: 40 + niveau * PAS_Y };
      let g = gauche; enf(c.id).forEach(x => { placer(x, g, niveau + 1); g += largeur(x); });
    };
    let g = x0 ? (x0 - 40) / PAS_X : 0;
    racines.forEach(r => { placer(r, g, 0); g += largeur(r) + 0.3; });
  };
  disposer(new Set([...relies].filter(id => !d.get(id).pos)));

  let selFil = null, sale = false;
  const nomC = (c) => c.nom || E.label;

  container.innerHTML = `
  <div class="md sx-e-${E.id}" style="--e:${E.couleur};--l:${E.couleur}">
    <div class="md-barre">
      <button class="nav-btn" id="md-retour">← Schéma</button>
      <h1>✏️ Modélisation</h1>
      <div class="md-energies">${presentes.map(e => `<button data-md-e="${e.id}" class="${e.id === ms.energie ? "on" : ""}" style="--e:${e.couleur}">${e.icone} ${e.label}</button>`).join("")}</div>
      <select id="md-portee">${nomsAssoc.map(n => `<optgroup label="${esc(n || "Sans association")}"><option value="a:${esc(n)}">🏢 Toute l'association ${esc(n || "(sans)")}</option>${sitesAvec(n).map(s => `<option value="s:${esc(s.id)}">📍 ${esc(nomCourt(s.nom))}</option>`).join("")}</optgroup>`).join("")}</select>
      <span class="md-espace"></span>
      <button class="nav-btn" id="md-auto" title="Remet les compteurs posés en arbre bien rangé">🪄 Ranger</button>
      <button class="add-btn" id="md-ok">✓ Enregistrer</button>
    </div>
    <p class="md-aide">① Glisse un compteur de la liste sur le plan. ② Tire un fil entre deux compteurs (depuis le <b>rond bleu</b>) : celui du <b>haut alimente</b> celui du bas. Un compteur peut en alimenter <b>plusieurs</b> : tire un fil vers chacun. ③ Clique sur un fil : <b>déduit</b>, <b>pour info</b> ou supprimer. ④ <b>Enregistrer</b>.</p>
    <div class="md-corps">
      <aside class="md-liste"><input id="md-cherche" placeholder="🔎 Chercher un compteur…"><div id="md-dispo"></div></aside>
      <div class="md-plan" id="md-plan"><div class="md-toile" id="md-toile"><svg class="md-fils" id="md-fils"></svg></div></div>
    </div>
  </div>`;

  const toile = container.querySelector("#md-toile"), svg = container.querySelector("#md-fils"), plan = container.querySelector("#md-plan");
  const dispo = container.querySelector("#md-dispo"), cherche = container.querySelector("#md-cherche");
  container.querySelector("#md-portee").value = ms.portee;

  const carteHTML = (c) => `<span class="md-in"></span><b>${chaudeIc(c)} ${esc(nomC(c))}</b><small>${esc(nomCourt(c.dossierNom))}${c.logement ? ` · Logt ${esc(c.logement)}` : ""}</small><button type="button" class="md-x" title="Retirer du plan">✕</button><span class="md-out" title="Tirer un fil vers le compteur alimenté"></span>`;
  const chaudeIc = (c) => estEauChaude(c) ? "♨️" : E.icone;

  const dessiner = () => {
    // Liste de gauche : compteurs pas encore posés.
    const q = cherche.value.trim().toLowerCase();
    const libres = liste.filter(c => !d.get(c.id).pos && (!q || `${nomC(c)} ${c.dossierNom} ${c.logement || ""}`.toLowerCase().includes(q)));
    dispo.innerHTML = libres.length ? libres.map(c => `<div class="md-dispo" data-md-libre="${c.id}"><b>${chaudeIc(c)} ${esc(nomC(c))}</b><small>${esc(nomCourt(c.dossierNom))}${c.logement ? ` · Logt ${esc(c.logement)}` : ""}</small></div>`).join("")
      : `<p class="md-vide">${q ? "Aucun résultat." : "Tous les compteurs sont posés sur le plan."}</p>`;
    // Cartes posées.
    toile.querySelectorAll(".md-c").forEach(el => { if (!d.get(el.dataset.id)?.pos) el.remove(); });
    let maxX = 900, maxY = 500;
    liste.forEach(c => {
      const p = d.get(c.id).pos; if (!p) return;
      let el = toile.querySelector(`.md-c[data-id="${c.id}"]`);
      if (!el) { el = document.createElement("div"); el.className = "md-c"; el.dataset.id = c.id; el.innerHTML = carteHTML(c); toile.append(el); brancherCarte(el, c); }
      el.style.left = p.x + "px"; el.style.top = p.y + "px";
      el.classList.toggle("chaude", estEauChaude(c));
      el.classList.toggle("tete", !lien(c) && liste.some(x => lien(x) === c.id));
      maxX = Math.max(maxX, p.x + LARG + 200); maxY = Math.max(maxY, p.y + HAUT + 200);
    });
    toile.style.width = maxX + "px"; toile.style.height = maxY + "px";
    filsSVG();
  };
  const filsSVG = () => {
    svg.setAttribute("width", toile.offsetWidth); svg.setAttribute("height", toile.offsetHeight);
    svg.innerHTML = `<defs><marker id="md-fl" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="13" markerHeight="13" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${E.couleur}"/></marker><marker id="md-fl-i" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="13" markerHeight="13" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#9aa4b2"/></marker></defs>`
      + liste.map(c => {
        const p = lien(c); if (!p) return "";
        const a = d.get(p).pos, b = d.get(c.id).pos; if (!a || !b) return "";
        const x1 = a.x + LARG / 2, y1 = a.y + HAUT, x2 = b.x + LARG / 2, y2 = b.y - 2;
        const my = (y1 + y2) / 2, chemin = `M${x1} ${y1} C${x1} ${my} ${x2} ${my} ${x2} ${y2}`;
        const info = !estDeduit({ ...c, nonDeduit: d.get(c.id).nonDeduit });
        return `<g class="md-fil ${info ? "info" : ""} ${selFil === c.id ? "sel" : ""}" data-fil="${c.id}"><path class="md-fil-zone" d="${chemin}"/><path class="md-fil-trait" d="${chemin}" marker-end="url(#${info ? "md-fl-i" : "md-fl"})"/>
          <text x="${(x1 + x2) / 2}" y="${my - 6}" text-anchor="middle">${info ? "pour info" : "− déduit"}</text></g>`;
      }).join("");
    svg.querySelectorAll("[data-fil]").forEach(g => g.addEventListener("click", (e) => { e.stopPropagation(); ouvrirFil(g.dataset.fil, e); }));
  };
  // Menu d'un fil : déduit / pour info / supprimer.
  const fermerMenu = () => { container.querySelector(".md-menu")?.remove(); selFil = null; filsSVG(); };
  const ouvrirFil = (id, e) => {
    container.querySelector(".md-menu")?.remove(); selFil = id; filsSVG();
    const c = liste.find(x => x.id === id), dd = d.get(id), P = liste.find(x => x.id === dd.parent);
    const ded = estDeduit({ ...c, nonDeduit: dd.nonDeduit });
    const m = document.createElement("div"); m.className = "md-menu";
    const r = plan.getBoundingClientRect();
    m.style.left = (e.clientX - r.left + plan.scrollLeft) + "px"; m.style.top = (e.clientY - r.top + plan.scrollTop) + "px";
    m.innerHTML = `<p><b>${esc(nomC(P))}</b> alimente <b>${esc(nomC(c))}</b></p>
      <button data-m="ded" class="${ded ? "on" : ""}">− Déduit du compteur au-dessus</button>
      <button data-m="info" class="${!ded ? "on" : ""}">ℹ️ Pour info (non déduit)</button>
      <button data-m="sup" class="sup">✂️ Supprimer le fil</button>`;
    toile.append(m);
    m.addEventListener("pointerdown", ev => ev.stopPropagation());
    m.querySelector('[data-m="ded"]').onclick = () => { dd.nonDeduit = estEauChaude(c) ? false : null; sale = true; fermerMenu(); };
    m.querySelector('[data-m="info"]').onclick = () => { dd.nonDeduit = true; sale = true; fermerMenu(); };
    m.querySelector('[data-m="sup"]').onclick = () => { dd.parent = null; sale = true; fermerMenu(); dessiner(); };
  };
  plan.addEventListener("pointerdown", (e) => { if (!e.target.closest(".md-menu,[data-fil]")) container.querySelector(".md-menu") && fermerMenu(); });

  // Interdit les boucles : on ne peut pas relier un compteur à l'un de ses descendants.
  const descend = (id, acc = new Set()) => { liste.forEach(c => { if (lien(c) === id && !acc.has(c.id)) { acc.add(c.id); descend(c.id, acc); } }); return acc; };
  const posToile = (ev) => { const r = toile.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; };

  function brancherCarte(el, c) {
    el.querySelector(".md-x").addEventListener("click", (e) => {
      e.stopPropagation();
      d.get(c.id).pos = null; d.get(c.id).parent = null;
      liste.forEach(x => { if (d.get(x.id).parent === c.id) d.get(x.id).parent = null; });
      sale = true; dessiner();
    });
    el.querySelector(".md-x").addEventListener("pointerdown", e => e.stopPropagation());
    // Déplacer la carte.
    el.addEventListener("pointerdown", (e) => {
      if (e.target.closest(".md-out,.md-in,.md-x") || (e.button !== undefined && e.button !== 0)) return;
      e.preventDefault();
      const p0 = { ...d.get(c.id).pos }, s = posToile(e);
      el.classList.add("bouge");
      const bouger = (ev) => { const q = posToile(ev); d.get(c.id).pos = { x: Math.max(0, Math.round(p0.x + q.x - s.x)), y: Math.max(0, Math.round(p0.y + q.y - s.y)) }; el.style.left = d.get(c.id).pos.x + "px"; el.style.top = d.get(c.id).pos.y + "px"; filsSVG(); };
      const fin = () => { document.removeEventListener("pointermove", bouger); document.removeEventListener("pointerup", fin); el.classList.remove("bouge"); sale = true; dessiner(); };
      document.addEventListener("pointermove", bouger); document.addEventListener("pointerup", fin);
    });
    // Tirer un fil depuis le rond du bas.
    el.querySelectorAll(".md-out,.md-in").forEach(port => port.addEventListener("pointerdown", (e) => {
      e.preventDefault(); e.stopPropagation();
      const a = d.get(c.id).pos, x1 = a.x + LARG / 2, y1 = port.classList.contains("md-in") ? a.y : a.y + HAUT;
      const interdits = new Set([c.id]);
      toile.querySelectorAll(".md-c").forEach(x => x.classList.add(interdits.has(x.dataset.id) ? "interdit" : "possible"));
      const tmp = document.createElementNS("http://www.w3.org/2000/svg", "path"); tmp.setAttribute("class", "md-tire"); svg.append(tmp);
      let cible = null;
      const bouger = (ev) => {
        const q = posToile(ev); const my = (y1 + q.y) / 2;
        tmp.setAttribute("d", `M${x1} ${y1} C${x1} ${my} ${q.x} ${my} ${q.x} ${q.y}`);
        const sous = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.(".md-c");
        toile.querySelectorAll(".md-c.survol").forEach(x => x.classList.remove("survol"));
        cible = sous && !interdits.has(sous.dataset.id) ? sous.dataset.id : null;
        if (cible) sous.classList.add("survol");
      };
      const fin = () => {
        document.removeEventListener("pointermove", bouger); document.removeEventListener("pointerup", fin);
        tmp.remove(); toile.querySelectorAll(".md-c").forEach(x => x.classList.remove("possible", "interdit", "survol"));
        if (cible) {
          // Le compteur placé le plus HAUT sur le plan alimente l'autre (peu
          // importe dans quel sens on a tiré le fil).
          const ya = d.get(c.id).pos.y, yb = d.get(cible).pos.y;
          const [pid, cid] = yb < ya - 40 ? [cible, c.id] : [c.id, cible];
          if (descend(cid).has(pid)) d.get(pid).parent = d.get(cid).parent; // il était dessous : on inverse
          const dd = d.get(cid), ancien = dd.parent;
          dd.parent = pid;
          if (estEauChaude(liste.find(x => x.id === cid)) && dd.nonDeduit == null) dd.nonDeduit = true;
          sale = true;
          const nm = (id) => { const x = liste.find(y => y.id === id); return `${nomC(x)} (${nomCourt(x.dossierNom)})`; };
          window.toast?.(`✓ ${nm(pid)} alimente ${nm(cid)}${ancien && ancien !== pid && ids.has(ancien) ? ` — il n'est plus sous ${nm(ancien)}` : ""}`);
        }
        dessiner();
      };
      document.addEventListener("pointermove", bouger); document.addEventListener("pointerup", fin);
    }));
  }

  // Poser un compteur depuis la liste.
  dispo.addEventListener("pointerdown", (e) => {
    const it = e.target.closest("[data-md-libre]"); if (!it || (e.button !== undefined && e.button !== 0)) return;
    e.preventDefault();
    const id = it.dataset.mdLibre, c = liste.find(x => x.id === id);
    const fant = document.createElement("div"); fant.className = "md-c md-fantome"; fant.innerHTML = `<b>${chaudeIc(c)} ${esc(nomC(c))}</b><small>${esc(nomCourt(c.dossierNom))}</small>`; document.body.append(fant);
    const bouger = (ev) => { fant.style.left = ev.clientX - LARG / 2 + "px"; fant.style.top = ev.clientY - 20 + "px"; };
    bouger(e);
    const fin = (ev) => {
      document.removeEventListener("pointermove", bouger); document.removeEventListener("pointerup", fin); fant.remove();
      const r = plan.getBoundingClientRect();
      const dedans = ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
      const q = posToile(ev);
      if (dedans) { d.get(id).pos = { x: Math.max(0, Math.round(q.x - LARG / 2)), y: Math.max(0, Math.round(q.y - 20)) }; }
      else { // simple clic : on le pose à un endroit libre
        let y = 40, x = 40; const occ = (x, y) => liste.some(o => { const p = d.get(o.id).pos; return p && Math.abs(p.x - x) < LARG && Math.abs(p.y - y) < HAUT + 20; });
        while (occ(x, y)) { x += PAS_X; if (x > 40 + PAS_X * 4) { x = 40; y += PAS_Y; } }
        d.get(id).pos = { x, y };
      }
      sale = true; dessiner();
    };
    document.addEventListener("pointermove", bouger); document.addEventListener("pointerup", fin);
  });
  cherche.addEventListener("input", dessiner);

  const quitter = (suite) => { if (sale && !confirm("Quitter sans enregistrer les changements ?")) return; suite(); };
  const rerendre = () => renderModele(container, { compteurs, sites, associations, onRetour });
  container.querySelector("#md-retour").onclick = () => quitter(onRetour);
  container.querySelectorAll("[data-md-e]").forEach(b => b.onclick = () => quitter(() => { ms.energie = b.dataset.mdE; ms.portee = ""; rerendre(); }));
  container.querySelector("#md-portee").onchange = (e) => { const v = e.target.value; if (sale && !confirm("Changer de zone sans enregistrer ?")) { e.target.value = ms.portee; return; } ms.portee = v; rerendre(); };
  container.querySelector("#md-auto").onclick = () => {
    const poses = new Set(liste.filter(c => d.get(c.id).pos).map(c => c.id));
    poses.forEach(id => { d.get(id).pos = null; });
    disposer(poses); sale = true; dessiner();
  };
  container.querySelector("#md-ok").onclick = async (e) => {
    const b = e.currentTarget; b.disabled = true; b.textContent = "⏳ Enregistrement…";
    try {
      for (const c of liste) {
        const dd = d.get(c.id), maj = {};
        if ((c.compteurParentId || null) !== (dd.parent || null)) maj.compteurParentId = dd.parent || null;
        if ((c.nonDeduit ?? null) !== (dd.nonDeduit ?? null)) maj.nonDeduit = dd.nonDeduit ?? null;
        const p0 = c.schemaPos && Number.isFinite(c.schemaPos.x) ? c.schemaPos : null;
        if (JSON.stringify(p0) !== JSON.stringify(dd.pos)) maj.schemaPos = dd.pos || null;
        if (Object.keys(maj).length) { await modifierCompteur(c.id, maj); Object.assign(c, maj); }
      }
      sale = false; window.toast?.("✓ Schéma enregistré"); onRetour(ms.energie);
    } catch (err) { alert("Enregistrement impossible : " + (err?.message || err)); b.disabled = false; b.textContent = "✓ Enregistrer"; }
  };
  dessiner();
}

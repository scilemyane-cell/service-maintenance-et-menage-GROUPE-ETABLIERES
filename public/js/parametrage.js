// parametrage.js — Administration > ⚙️ Paramétrage : centre de réglages des
// listes de l'appli (rubriques à gauche, une carte par liste à droite).
// On ajoute, renomme, réordonne (glisser ou ↑↓) et masque des valeurs ; rien
// n'est supprimé de l'historique. Chaque enregistrement est tracé au journal.
import { esc } from "./astreinte-logic.js";
import { toast, confirmDialog } from "./ui-feedback.js";
import { RUBRIQUES, toutesListes } from "./listes-registre.js";
import {
  itemsListe, optionsListe, estModifiee, infosListe, journalListes, ecouterListes, enregistrerListe, reinitialiserListe, estDeclaree,
} from "./listes-config.js";

const MOIS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
const MOIS_LONGS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
let cont = null, user = null, unsub = null;
let ui = { rubrique: RUBRIQUES[0].id, recherche: "" };
const brouillons = {};   // clé → items en cours de modification
const charges = new Set(), echecs = new Set();
let glisse = null;

const fmtDate = (t) => t ? new Date(t).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
const defListe = (cle) => toutesListes().find(l => l.cle === cle);
const typeListe = (cle) => defListe(cle)?.colonnes ? "tableau" : (optionsListe(cle).type || "texte");

export async function mountParametrage(container, u) {
  unsub?.(); cont = container; user = u;
  if (!container.dataset.prmEcoute) {
    container.addEventListener("click", surClic);
    container.addEventListener("input", surSaisie);
    container.addEventListener("change", surSaisie);
    container.addEventListener("dragstart", surDragStart);
    container.addEventListener("dragover", (e) => { if (glisse) e.preventDefault(); });
    container.addEventListener("drop", surDrop);
    container.dataset.prmEcoute = "1";
  }
  unsub = ecouterListes(() => { if (document.contains(cont)) render(false); else unsub?.(); });
  await chargerRubrique(ui.rubrique);
  render();
}

async function chargerRubrique(id) {
  const listes = id === "journal" ? [] : (RUBRIQUES.find(r => r.id === id)?.listes || []);
  await Promise.all(listes.filter(l => !charges.has(l.cle)).map(async l => {
    try { await l.charger(); charges.add(l.cle); echecs.delete(l.cle); } catch (e) { echecs.add(l.cle); console.warn("Chargement liste", l.cle, e); }
  }));
}

const items = (cle) => brouillons[cle] || itemsListe(cle);
const modifier = (cle) => (brouillons[cle] = brouillons[cle] || itemsListe(cle));

// ---------- Rendu ----------
function render(force = true) {
  if (!cont) return;
  const actif = document.activeElement;
  if (force && actif && cont.contains(actif) && actif.blur) actif.blur();
  // Ne pas redessiner sous les doigts (une mise à jour Firestore arrive) : on
  // garde la saisie, le rendu se fera au prochain clic.
  if (actif && cont.contains(actif) && actif.matches("input[type=text], input:not([type]), textarea")) return;
  const nav = RUBRIQUES.map(r => {
    const nb = r.listes.filter(l => estModifiee(l.cle)).length;
    return `<button type="button" class="prm-rub ${ui.rubrique === r.id ? "on" : ""}" data-rub="${r.id}">${r.icone} ${esc(r.label)}${nb ? ` <span class="prm-pt" title="${nb} liste(s) personnalisée(s)">${nb}</span>` : ""}</button>`;
  }).join("") + `<button type="button" class="prm-rub ${ui.rubrique === "journal" ? "on" : ""}" data-rub="journal">🕘 Journal</button>`;
  const corps = ui.rubrique === "journal" ? vueJournal() : vueRubrique();
  cont.innerHTML = `${STYLE}<div class="prm">
    <div class="prm-tete"><h2>⚙️ Paramétrage</h2><p class="hint">Les listes de l'appli, modifiables ici sans passer par la programmation. Les changements sont visibles par tous dès l'enregistrement. Ce qui est lié à l'Excel des demandes (statuts, urgences, catégories de pannes) n'est volontairement pas ici.</p></div>
    <div class="prm-grille"><nav class="prm-nav">${nav}</nav><div class="prm-corps">${corps}</div></div></div>`;
  const on = cont.querySelector(".prm-rub.on"), n = cont.querySelector(".prm-nav");
  if (on && n && n.scrollWidth > n.clientWidth) n.scrollLeft = on.offsetLeft - 16;
}

function vueRubrique() {
  const r = RUBRIQUES.find(x => x.id === ui.rubrique); if (!r) return "";
  return `<h3 class="prm-h">${r.icone} ${esc(r.label)}</h3>` + r.listes.map(carte).join("");
}

function carte(l) {
  if (!estDeclaree(l.cle)) return `<div class="form-card prm-carte"><b>${esc(l.label)}</b><div class="hint">${echecs.has(l.cle) ? `❌ Cette liste n'a pas pu être chargée (connexion ?). <button type="button" class="prm-lien" data-rub="${esc(ui.rubrique)}">Réessayer</button>` : "Chargement…"}</div></div>`;
  const t = typeListe(l.cle), opts = optionsListe(l.cle), info = infosListe(l.cle), sale = !!brouillons[l.cle];
  const its = items(l.cle);
  let liste;
  if (t === "groupes") liste = editeurGroupes(l, its);
  else if (t === "tableau") liste = editeurTableau(l, its, opts);
  else liste = editeurTexte(l, its, opts);
  const nbActifs = t === "groupes" ? its.filter(g => !g.masque).reduce((n, g) => n + (g.liste || []).filter(x => !x.masque).length, 0) : its.filter(i => !i.masque).length;
  return `<div class="form-card prm-carte ${sale ? "sale" : ""}" data-carte="${esc(l.cle)}">
    <div class="prm-ct"><b>${esc(l.label)}</b> <span class="prm-nb">${nbActifs}</span>
      <span class="prm-etat">${info ? `✏️ modifiée le ${fmtDate(info.majLe)}${info.majPar ? ` par ${esc(info.majPar)}` : ""}` : "valeurs d'origine"}</span></div>
    ${l.aide ? `<div class="hint">${esc(l.aide)}</div>` : ""}
    ${liste}
    <div class="prm-actions">
      ${sale ? `<button type="button" class="nav-btn prm-ok" data-sauver="${esc(l.cle)}">💾 Enregistrer</button><button type="button" class="nav-btn" data-annuler="${esc(l.cle)}">Annuler</button>` : ""}
      ${info && !sale ? `<button type="button" class="prm-lien" data-reinit="${esc(l.cle)}">↩️ Revenir aux valeurs d'origine</button>` : ""}
    </div></div>`;
}

const boutonsLigne = (cle, i, n, masque, ordreFixe, chemin = "") => `
  ${ordreFixe ? "" : `<button type="button" class="prm-ic" data-monter="${esc(cle)}|${chemin}${i}" ${i === 0 ? "disabled" : ""} title="Monter">↑</button><button type="button" class="prm-ic" data-descendre="${esc(cle)}|${chemin}${i}" ${i === n - 1 ? "disabled" : ""} title="Descendre">↓</button>`}
  ${ordreFixe ? "" : masque ? `<button type="button" class="prm-ic" data-afficher="${esc(cle)}|${chemin}${i}" title="Réafficher">👁️</button>` : `<button type="button" class="prm-ic" data-masquer="${esc(cle)}|${chemin}${i}" title="Masquer (reste dans l'historique)">✕</button>`}`;

function editeurTexte(l, its, opts) {
  const fixe = !!opts.ordreFixe;
  return `<div class="prm-liste">${its.map((it, i) => `
    <div class="prm-ligne ${it.masque ? "masque" : ""}" ${fixe ? "" : `draggable="true"`} data-drag="${esc(l.cle)}|${i}">
      ${fixe ? `<span class="prm-num">${i + 1}</span>` : `<span class="prm-poignee" title="Glisser pour déplacer">⋮⋮</span>`}
      <input type="text" value="${esc(it.v ?? "")}" data-val="${esc(l.cle)}|${i}|v" ${it.masque ? "disabled" : ""}>
      ${boutonsLigne(l.cle, i, its.length, it.masque, fixe)}
    </div>`).join("")}</div>
    <div class="prm-ajout"><input type="text" placeholder="Nouvelle valeur…" data-nouveau="${esc(l.cle)}"><button type="button" class="nav-btn" data-ajouter="${esc(l.cle)}">➕ Ajouter</button></div>`;
}

function champ(cle, i, col, it, suggestions) {
  const v = it[col.cle], dis = it.masque ? "disabled" : "", ref = `${esc(cle)}|${i}|${col.cle}`;
  if (col.type === "nombre") return `<input type="number" min="0" inputmode="numeric" value="${esc(v ?? "")}" data-val="${ref}" data-num="1" ${dis} placeholder="—">`;
  if (col.type === "couleur") return `<input type="color" value="${esc(v || "#888888")}" data-val="${ref}" ${dis}>`;
  if (col.type === "choix") return `<select data-val="${ref}" data-num="1" ${dis}>${col.options.map(o => `<option ${String(v) === o ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
  if (col.type === "mois") {
    const sel = new Set((v || []).map(Number));
    return `<span class="prm-mois">${MOIS.map((m, k) => `<button type="button" class="${sel.has(k + 1) ? "on" : ""}" data-mois="${esc(cle)}|${i}|${k + 1}" title="${MOIS_LONGS[k]}" ${dis}>${m}</button>`).join("")}</span>`;
  }
  return `<input type="text" value="${esc(v ?? "")}" data-val="${ref}" ${suggestions ? `list="prm-sug-${esc(cle)}-${col.cle}"` : ""} ${dis}>`;
}

function editeurTableau(l, its, opts) {
  const fixes = !!opts.lignesFixes, cols = l.colonnes;
  const datalists = cols.filter(c => c.suggestions).map(c => `<datalist id="prm-sug-${esc(l.cle)}-${c.cle}">${[...new Set(its.map(x => x[c.cle]).filter(Boolean))].map(v => `<option value="${esc(v)}">`).join("")}</datalist>`).join("");
  return `<div class="prm-liste">${its.map((it, i) => `
    <div class="prm-ligne prm-tab ${it.masque ? "masque" : ""}" ${fixes ? "" : `draggable="true"`} data-drag="${esc(l.cle)}|${i}">
      ${fixes ? "" : `<span class="prm-poignee">⋮⋮</span>`}
      <div class="prm-cols">${cols.map(c => `<label class="prm-col prm-${c.type}"><small>${esc(c.label)}</small>${champ(l.cle, i, c, it, c.suggestions)}</label>`).join("")}</div>
      ${fixes ? "" : boutonsLigne(l.cle, i, its.length, it.masque, false)}
    </div>`).join("")}</div>${datalists}
    ${fixes ? "" : `<div class="prm-ajout"><button type="button" class="nav-btn" data-ajouter-ligne="${esc(l.cle)}">➕ Ajouter une ligne</button></div>`}`;
}

function editeurGroupes(l, its) {
  return `<div class="prm-groupes">${its.map((g, gi) => `
    <div class="prm-groupe ${g.masque ? "masque" : ""}">
      <div class="prm-ligne"><input type="text" class="prm-theme" value="${esc(g.theme || "")}" data-gval="${esc(l.cle)}|${gi}" ${g.masque ? "disabled" : ""}>
        ${boutonsLigne(l.cle, gi, its.length, g.masque, false)}</div>
      ${g.masque ? "" : `<div class="prm-liste">${(g.liste || []).map((x, i) => `
        <div class="prm-ligne ${x.masque ? "masque" : ""}">
          <textarea rows="2" data-ival="${esc(l.cle)}|${gi}|${i}|texte" ${x.masque ? "disabled" : ""}>${esc(x.texte || "")}</textarea>
          <select data-ival="${esc(l.cle)}|${gi}|${i}|niveau" data-num="1" title="Niveau de délégation" ${x.masque ? "disabled" : ""}><option value="1" ${x.niveau !== 2 ? "selected" : ""}>N1</option><option value="2" ${x.niveau === 2 ? "selected" : ""}>N2</option></select>
          ${boutonsLigne(l.cle, i, g.liste.length, x.masque, false, gi + ".")}
        </div>`).join("")}
        <div class="prm-ajout"><button type="button" class="prm-lien" data-ajouter-mission="${esc(l.cle)}|${gi}">➕ Ajouter une mission dans ce thème</button></div></div>`}
    </div>`).join("")}</div>
    <div class="prm-ajout"><input type="text" placeholder="Nouveau thème (ex. 🔧 Maintenance)…" data-nouveau="${esc(l.cle)}"><button type="button" class="nav-btn" data-ajouter-theme="${esc(l.cle)}">➕ Ajouter le thème</button></div>`;
}

function vueJournal() {
  const j = journalListes();
  return `<h3 class="prm-h">🕘 Journal des modifications</h3>
    <div class="form-card">${j.length ? `<table class="prm-journal"><thead><tr><th>Quand</th><th>Qui</th><th>Liste</th><th>Changement</th></tr></thead><tbody>
    ${j.map(e => `<tr><td>${fmtDate(e.le)}</td><td>${esc(e.par || "")}</td><td>${esc(e.label || e.cle)}</td><td>${esc(e.detail || "")}</td></tr>`).join("")}</tbody></table>` : `<div class="hint">Aucune modification pour l'instant.</div>`}</div>`;
}

// ---------- Résumé des changements (pour le journal) ----------
function resume(cle, avant, apres) {
  const t = typeListe(cle);
  const nom = (x) => t === "groupes" ? x.theme : t === "tableau" ? (x.label || x.nom || "ligne") : x.v;
  const parts = [];
  if (apres.length > avant.length) parts.push(`ajout : ${apres.slice(avant.length).map(nom).filter(Boolean).join(", ")}`);
  const nbMasq = apres.filter(x => x.masque).length - avant.filter(x => x.masque).length;
  if (nbMasq > 0) parts.push(`${nbMasq} masquée(s)`);
  if (nbMasq < 0) parts.push(`${-nbMasq} réaffichée(s)`);
  const sans = (x) => JSON.stringify({ ...x, masque: 0 });
  const modifs = avant.filter((x, i) => apres[i] && sans(x) !== sans(apres[i])).length;
  if (modifs) parts.push(`${modifs} valeur(s) modifiée(s) ou déplacée(s)`);
  return parts.join(" · ") || "Modification";
}

// ---------- Événements ----------
const parse = (s) => s.split("|");
function deplacer(arr, i, j) { if (j < 0 || j >= arr.length) return; const [x] = arr.splice(i, 1); arr.splice(j, 0, x); }
function cible(cle, chemin) {
  const its = modifier(cle);
  if (String(chemin).includes(".")) { const [gi, i] = chemin.split(".").map(Number); return { arr: its[gi].liste, i }; }
  return { arr: its, i: Number(chemin) };
}

async function surClic(e) {
  const b = e.target.closest("button"); if (!b || b.disabled) return;
  const d = b.dataset;
  if (d.rub) { ui.rubrique = d.rub; await chargerRubrique(d.rub); render(); window.scrollTo?.(0, 0); return; }
  if (d.monter || d.descendre) { const [cle, ch] = parse(d.monter || d.descendre); const { arr, i } = cible(cle, ch); deplacer(arr, i, i + (d.monter ? -1 : 1)); render(); return; }
  if (d.masquer || d.afficher) { const [cle, ch] = parse(d.masquer || d.afficher); const { arr, i } = cible(cle, ch); if (d.masquer) arr[i].masque = true; else delete arr[i].masque; render(); return; }
  if (d.mois) { const [cle, i, m] = parse(d.mois); const it = modifier(cle)[+i]; const s = new Set((it.saison || []).map(Number)); s.has(+m) ? s.delete(+m) : s.add(+m); it.saison = [...s].sort((a, b) => a - b); render(); return; }
  if (d.ajouter || d.ajouterTheme) {
    const cle = d.ajouter || d.ajouterTheme; const inp = cont.querySelector(`[data-nouveau="${CSS.escape(cle)}"]`);
    const v = (inp?.value || "").trim().replace(/\s+/g, " ");
    if (!v) { toast("Écris d'abord la valeur à ajouter", "error"); inp?.focus(); return; }
    const its = modifier(cle);
    if (d.ajouter) {
      const ex = its.find(x => String(x.v).toLowerCase() === v.toLowerCase());
      if (ex) { if (ex.masque) { delete ex.masque; toast("Valeur masquée réaffichée", "success"); } else toast("Déjà dans la liste", "error"); }
      else its.push({ v });
    } else its.push({ theme: v, liste: [] });
    inp.value = ""; inp.blur(); render(); return;
  }
  if (d.ajouterLigne) { const cle = d.ajouterLigne; const cols = defListe(cle).colonnes; const l = {}; cols.forEach(c => { l[c.cle] = c.type === "mois" ? [] : c.type === "choix" ? Number(c.options[0]) : ""; }); modifier(cle).push(l); render(); return; }
  if (d.ajouterMission) { const [cle, gi] = parse(d.ajouterMission); modifier(cle)[+gi].liste.push({ id: "m-" + Date.now().toString(36), texte: "", niveau: 1 }); render(); return; }
  if (d.annuler) { delete brouillons[d.annuler]; render(); return; }
  if (d.sauver) { await sauver(d.sauver); return; }
  if (d.reinit) {
    const l = defListe(d.reinit);
    if (!await confirmDialog(`Revenir aux valeurs d'origine pour « ${l.label} » ? Tes modifications de cette liste seront perdues.`, { danger: true, texteValider: "Revenir" })) return;
    try { await reinitialiserListe(d.reinit, user, l.label); delete brouillons[d.reinit]; toast("Valeurs d'origine rétablies", "success"); }
    catch (err) { toast("Échec : " + (err.message || err), "error"); }
  }
}

async function sauver(cle) {
  const l = defListe(cle), t = typeListe(cle);
  let its = brouillons[cle]; if (!its) return;
  // Nettoyage : lignes vides retirées, textes épurés.
  if (t === "texte") its = its.map(x => ({ ...x, v: String(x.v ?? "").trim() })).filter(x => x.v);
  else if (t === "groupes") its = its.map(g => ({ ...g, theme: String(g.theme || "").trim(), liste: (g.liste || []).map(x => ({ ...x, texte: String(x.texte || "").trim() })).filter(x => x.texte) })).filter(g => g.theme);
  else { const c0 = l.colonnes[0].cle; its = its.map(x => ({ ...x, [c0]: String(x[c0] ?? "").trim() })).filter(x => x[c0]); }
  // Prestations espaces verts : une clé stable pour chaque nouvelle ligne.
  if (cle === "ev.taches") its.forEach(x => { if (!x.cle) x.cle = "p-" + String(x.label).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-" + Date.now().toString(36).slice(-3); });
  const doublons = t === "texte" && new Set(its.map(x => x.v.toLowerCase())).size !== its.length;
  if (doublons) { toast("La liste contient deux fois la même valeur", "error"); return; }
  const btn = cont.querySelector(`[data-sauver="${CSS.escape(cle)}"]`); if (btn) { btn.disabled = true; btn.textContent = "Enregistrement…"; }
  try {
    await enregistrerListe(cle, JSON.parse(JSON.stringify(its)), user, l.label, resume(cle, itemsListe(cle), its));
    delete brouillons[cle]; toast(`« ${l.label} » enregistrée`, "success"); render();
  } catch (err) {
    toast("Échec de l'enregistrement : " + (err.message || err), "error");
    if (btn) { btn.disabled = false; btn.textContent = "💾 Enregistrer"; }
  }
}

function marquerSale(cle) {
  const c = cont.querySelector(`[data-carte="${CSS.escape(cle)}"]`);
  if (c && !c.classList.contains("sale")) {
    c.classList.add("sale");
    const a = c.querySelector(".prm-actions");
    if (a) a.innerHTML = `<button type="button" class="nav-btn prm-ok" data-sauver="${esc(cle)}">💾 Enregistrer</button><button type="button" class="nav-btn" data-annuler="${esc(cle)}">Annuler</button>`;
  }
}

function surSaisie(e) {
  const el = e.target, d = el.dataset;
  const v = d.num ? Number(el.value) || (el.value === "" ? "" : el.value) : el.value;
  if (d.val) { const [cle, i, k] = parse(d.val); modifier(cle)[+i][k] = v; marquerSale(cle); }
  else if (d.gval) { const [cle, gi] = parse(d.gval); modifier(cle)[+gi].theme = v; marquerSale(cle); }
  else if (d.ival) { const [cle, gi, i, k] = parse(d.ival); modifier(cle)[+gi].liste[+i][k] = v; marquerSale(cle); }
  else if (d.nouveau && e.type === "change") { /* rien : l'ajout se fait au bouton */ }
}

function surDragStart(e) {
  const l = e.target.closest?.("[data-drag]"); if (!l) return;
  glisse = l.dataset.drag; try { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", glisse); } catch { /* */ }
}
function surDrop(e) {
  const l = e.target.closest?.("[data-drag]"); if (!glisse || !l) { glisse = null; return; }
  e.preventDefault();
  const [c1, i1] = parse(glisse), [c2, i2] = parse(l.dataset.drag); glisse = null;
  if (c1 !== c2 || i1 === i2) return;
  deplacer(modifier(c1), +i1, +i2); render();
}

const STYLE = `<style>
.prm-tete h2{margin:0 0 4px}
.prm-grille{display:grid;grid-template-columns:230px minmax(0,1fr);gap:16px;align-items:start;margin-top:10px}
.prm-grille>*,.prm-ligne,.prm-cols{min-width:0}
.prm,.prm *{box-sizing:border-box}
.prm-carte{max-width:100%}
.prm-nav{display:flex;flex-direction:column;gap:4px;position:sticky;top:8px}
.prm-rub{text-align:left;padding:9px 12px;border-radius:10px;border:1px solid transparent;background:transparent;color:inherit;cursor:pointer;font:inherit;display:flex;align-items:center;gap:6px}
.prm-rub:hover{background:rgba(127,127,127,.1)}
.prm-rub.on{background:var(--gold,#D9B24C);color:#1b1b1b;font-weight:600}
.prm-pt{margin-left:auto;font-size:11px;min-width:18px;text-align:center;border-radius:9px;background:rgba(0,0,0,.18);padding:1px 6px}
.prm-h{margin:0 0 10px}
.prm-carte{margin-bottom:14px}
.prm-carte.sale{outline:2px solid var(--gold,#D9B24C)}
.prm-ct{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.prm-nb{font-size:11px;padding:1px 7px;border-radius:9px;background:rgba(127,127,127,.18)}
.prm-etat{margin-left:auto;font-size:11px;opacity:.7}
.prm-liste{display:flex;flex-direction:column;gap:5px;margin:10px 0}
.prm-ligne{display:flex;align-items:center;gap:6px}
.prm-ligne input[type=text],.prm-ligne textarea{flex:1;min-width:0}
.prm-ligne.masque{opacity:.45}
.prm-ligne.masque input,.prm-ligne.masque textarea{text-decoration:line-through}
.prm-poignee{cursor:grab;opacity:.5;user-select:none;padding:0 2px}
.prm-num{font-size:11px;opacity:.6;min-width:18px;text-align:right}
.prm-ic{border:1px solid rgba(127,127,127,.35);background:transparent;color:inherit;border-radius:8px;min-width:30px;height:30px;cursor:pointer}
.prm-ic:disabled{opacity:.25;cursor:default}
.prm-tab{align-items:flex-start;padding:6px;border:1px solid rgba(127,127,127,.2);border-radius:10px}
.prm-cols{display:flex;flex-wrap:wrap;gap:8px;flex:1;min-width:0}
.prm-col{display:flex;flex-direction:column;gap:2px;flex:1;min-width:110px}
.prm-col input,.prm-col select{width:100%}
.prm-col.prm-texte{min-width:150px}
.prm-col small{font-size:10px;opacity:.65}
.prm-col.prm-nombre,.prm-col.prm-choix,.prm-col.prm-couleur{flex:0 0 90px;min-width:70px}
.prm-col.prm-mois{flex:1 1 100%}
.prm-mois{display:flex;gap:3px;flex-wrap:wrap}
.prm-mois button{width:26px;height:26px;border-radius:6px;border:1px solid rgba(127,127,127,.35);background:transparent;color:inherit;font-size:11px;cursor:pointer;padding:0}
.prm-mois button.on{background:#2fa35a;color:#fff;border-color:#2fa35a}
.prm-groupe{border:1px solid rgba(127,127,127,.25);border-radius:12px;padding:8px;margin:8px 0}
.prm-theme{font-weight:600}
.prm-ajout{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}
.prm-ajout input{flex:1;min-width:160px}
.prm-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;align-items:center}
.prm-ok{font-weight:700}
.prm-lien{background:none;border:none;color:var(--gold,inherit);cursor:pointer;text-decoration:underline;padding:4px 0;font:inherit}
.prm-journal{width:100%;border-collapse:collapse;font-size:13px}
.prm-journal td,.prm-journal th{padding:6px;border-bottom:1px solid rgba(127,127,127,.2);text-align:left;vertical-align:top}
@media (max-width:760px){
  .prm-grille{grid-template-columns:minmax(0,1fr)}
  .prm-ic{min-width:28px;height:28px;padding:0}
  .prm-nav{flex-direction:row;overflow-x:auto;position:static;padding-bottom:4px}
  .prm-rub{white-space:nowrap;flex:0 0 auto}
  .prm-poignee{display:none}
  .prm-journal thead{display:none}.prm-journal tr{display:block;padding:6px 0;border-bottom:1px solid rgba(127,127,127,.2)}.prm-journal td{display:block;border:none;padding:1px 0}
}
</style>`;

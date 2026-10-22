// mails.js — Assistant mails (Super Admin uniquement)
//
// Fonctionnement :
//  1. Power Automate copie chaque mail reçu dans la liste SharePoint
//     « MailsEntrants » du site appsmm (statut « Nouveau »).
//  2. À l'ouverture de cet écran, chaque mail « Nouveau » est envoyé au
//     Worker Cloudflare « agent-mails-smm », qui demande à Claude de le
//     classer et de rédiger un brouillon. La clé API reste côté Worker.
//  3. Le résultat est réécrit dans la liste (catégorie, priorité, résumé,
//     brouillon, statut « Traité ») et affiché ici, trié par priorité.

import { getGraphToken } from "./graph-auth.js";
import { esc } from "./astreinte-logic.js";
import { toast } from "./ui-feedback.js";

const WORKER_URL = "https://agent-mails-smm.valentin-barreteau.workers.dev/";
const GRAPH = "https://graph.microsoft.com/v1.0";
const LISTE = `${GRAPH}/sites/etablieresfr.sharepoint.com:/sites/appsmm:/lists/MailsEntrants`;
const LISTE_ENVOYES = `${GRAPH}/sites/etablieresfr.sharepoint.com:/sites/appsmm:/lists/MailsEnvoyes`;
const TITRE_GUIDE = "__GUIDE__";
const ORDRE_PRIO = { Urgent: 0, Normal: 1, Faible: 2 };

let conteneur = null;
let mails = [];
let colonnes = null; // nom affiché → nom interne SharePoint
let filtre = "a-traiter";
let erreur = "";
let enCours = false;
let progression = "";
let ouverts = new Set();
// Guide de style tiré des mails envoyés (stocké dans la liste MailsEnvoyes)
let guide = "";
let guideItemId = null;
let guideOuvert = false;
let guideEnCours = "";
let colonnesEnvoyes = null; // { corps, destinataire } : noms internes

// ---------- Microsoft Graph ----------

async function graph(url, options = {}) {
  const token = await getGraphToken();
  const res = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(options.headers || {}) },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    const nomListe = (url.match(/lists\/([^/?]+)/) || [])[1] || "SharePoint";
    if (res.status === 403) throw new Error(`Accès refusé à la liste ${nomListe} (403). ${detail.slice(0, 200)}`);
    if (res.status === 404) throw new Error(`Liste « ${nomListe} » introuvable sur le site appsmm (404).`);
    throw new Error(`Erreur Microsoft Graph ${res.status} : ${detail.slice(0, 200)}`);
  }
  return res.status === 204 ? null : res.json();
}

// Les colonnes importées depuis un CSV peuvent avoir un nom interne différent
// du nom affiché : on lit la correspondance une fois.
async function chargerColonnes() {
  if (colonnes) return colonnes;
  const data = await graph(`${LISTE}/columns?$select=name,displayName`);
  colonnes = {};
  for (const c of data.value || []) colonnes[c.displayName] = c.name;
  colonnes.Title = colonnes.Title || "Title";
  const manquantes = ["Expediteur", "DateReception", "Corps", "IdMessage", "Statut", "Categorie", "Priorite", "Resume", "Brouillon"].filter(n => !colonnes[n]);
  if (manquantes.length) throw new Error(`Colonnes absentes de la liste MailsEntrants : ${manquantes.join(", ")}`);
  return colonnes;
}

const champ = (f, nom) => f[colonnes[nom]] ?? "";

// Les colonnes « Plusieurs lignes de texte » de SharePoint renvoient du HTML
// (<div class="ExternalClass…">, &#58;…) : on le remet en texte simple.
// Texte d'origine du mail, tel qu'écrit par l'expéditeur (HTML Outlook →
// texte), historique compris, sans aucune retouche de l'IA.
function texteOriginal(v) {
  return texteSimple(v).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function texteSimple(v) {
  const s = String(v ?? "");
  if (!/[<&]/.test(s)) return s;
  const html = s.replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|tr)>/gi, "\n");
  const d = new DOMParser().parseFromString(html, "text/html");
  return (d.body.textContent || "").replace(/\u00a0/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

async function chargerMails() {
  await chargerColonnes();
  const tous = [];
  let url = `${LISTE}/items?$expand=fields&$top=200`;
  while (url && tous.length < 1000) {
    const data = await graph(url);
    tous.push(...(data.value || []));
    url = data["@odata.nextLink"] || null;
  }
  mails = tous.map(it => {
    const f = it.fields || {};
    return {
      id: it.id,
      objet: f.Title || "(sans objet)",
      expediteur: champ(f, "Expediteur"),
      date: it.createdDateTime || champ(f, "DateReception"),
      corps: champ(f, "Corps"),
      statut: champ(f, "Statut") || "Nouveau",
      categorie: texteSimple(champ(f, "Categorie")),
      priorite: champ(f, "Priorite") || "Normal",
      resume: texteSimple(champ(f, "Resume")),
      brouillon: texteSimple(champ(f, "Brouillon")),
    };
  });
}

async function majMail(id, valeurs) {
  const corps = {};
  for (const [nom, v] of Object.entries(valeurs)) corps[colonnes[nom]] = v;
  await graph(`${LISTE}/items/${id}/fields`, { method: "PATCH", body: JSON.stringify(corps) });
}

// ---------- Agent (Worker Cloudflare) ----------

// Lit un JSON « presque valide » : retours à la ligne et tabulations non
// échappés dans les textes, guillemets typographiques, texte autour.
function lireJsonTolerant(brut) {
  const t = String(brut || "");
  const debut = t.indexOf("{"), fin = t.lastIndexOf("}");
  if (debut < 0) return null;
  const bloc = fin > debut ? t.slice(debut, fin + 1) : t.slice(debut) + '"}';
  let sortie = "", dansTexte = false, echappe = false;
  for (const c of bloc) {
    if (dansTexte) {
      if (echappe) { sortie += c; echappe = false; continue; }
      if (c === "\\") { sortie += c; echappe = true; continue; }
      if (c === '"') { dansTexte = false; sortie += c; continue; }
      if (c === "\n") { sortie += "\\n"; continue; }
      if (c === "\r") continue;
      if (c === "\t") { sortie += "\\t"; continue; }
      sortie += c;
    } else {
      if (c === '"') dansTexte = true;
      sortie += c;
    }
  }
  try { return JSON.parse(sortie); } catch { /* on tente champ par champ */ }
  const champ = (nom, suivant) => {
    const re = new RegExp(`"${nom}"\\s*:\\s*"([\\s\\S]*?)"\\s*(?:,\\s*"${suivant}"|\\}\\s*$)`);
    const m = bloc.match(re);
    return m ? m[1].replace(/\\n/g, "\n").replace(/\\"/g, '"') : "";
  };
  const r = { categorie: champ("categorie", "priorite"), priorite: champ("priorite", "resume"), resume: champ("resume", "brouillon"), brouillon: champ("brouillon", "zzz") };
  return r.categorie || r.resume ? r : null;
}

async function analyser(mail) {
  const token = await getGraphToken();
  const res = await fetch(WORKER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ objet: mail.objet, expediteur: mail.expediteur, date: mail.date, corps: mail.corps, contexte: guide || undefined }),
  });
  let data = null;
  try { data = await res.json(); } catch { /* réponse non JSON */ }
  // Réponse de Claude presque en JSON (retours à la ligne bruts dans le
  // brouillon…) : on la répare ici plutôt que d'abandonner.
  if (data?.brut) {
    const repare = lireJsonTolerant(data.brut);
    if (repare) {
      console.warn("Réponse de l'agent réparée", data.brut);
      return {
        categorie: repare.categorie || "autre",
        priorite: ["Urgent", "Normal", "Faible"].includes(repare.priorite) ? repare.priorite : "Normal",
        resume: repare.resume || "",
        brouillon: repare.brouillon || "",
      };
    }
    console.error("Réponse de l'agent illisible :", data.brut);
  }
  if (!res.ok || !data || data.erreur) {
    throw new Error(data?.erreur ? `${data.erreur}${data.detail ? " — " + String(data.detail).slice(0, 200) : ""}` : `Agent injoignable (${res.status})`);
  }
  return data;
}

async function traiterNouveaux() {
  if (enCours) return;
  const aTraiter = mails.filter(m => m.statut === "Nouveau");
  if (!aTraiter.length) return;
  enCours = true;
  let ok = 0;
  const echecs = [];
  for (let i = 0; i < aTraiter.length; i++) {
    const m = aTraiter[i];
    progression = `Analyse ${i + 1}/${aTraiter.length} : ${m.objet}`;
    render();
    try {
      const r = await analyser(m);
      await majMail(m.id, { Categorie: r.categorie, Priorite: r.priorite, Resume: r.resume, Brouillon: r.brouillon, Statut: "Traité" });
      Object.assign(m, { categorie: r.categorie, priorite: r.priorite, resume: r.resume, brouillon: r.brouillon, statut: "Traité" });
      ok++;
    } catch (e) {
      console.error("Analyse du mail", m.objet, e);
      echecs.push(`« ${m.objet} » : ${e.message || e}`);
      if (/injoignable|Jeton|Origine|Compte non autorisé|API Claude \((401|402|403|429)\)/.test(e.message || "")) break; // inutile d'insister
    }
  }
  enCours = false;
  progression = "";
  erreur = echecs.length ? `Analyse impossible pour ${echecs.length} mail(s) :\n${echecs.join("\n")}` : "";
  if (ok) toast(`${ok} mail(s) analysé(s)`, "success");
  render();
}

// ---------- Affichage ----------

const fmtDate = (d) => { const x = new Date(d); return isNaN(x) ? "" : x.toLocaleString("fr-FR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); };
const adresse = (s) => (String(s).match(/[^\s<>"]+@[^\s<>"]+/) || [""])[0];

function lienOutlook(m, texte) {
  const objet = /^(re|tr)\s*:/i.test(m.objet) ? m.objet : `RE: ${m.objet}`;
  return `https://outlook.office.com/mail/deeplink/compose?to=${encodeURIComponent(adresse(m.expediteur))}&subject=${encodeURIComponent(objet)}&body=${encodeURIComponent(texte)}`;
}

function listeFiltree() {
  const l = mails.filter(m => filtre === "tous" ? true : filtre === "a-traiter" ? ["Nouveau", "Traité"].includes(m.statut) : ["Répondu", "Ignoré"].includes(m.statut));
  return l.sort((a, b) => (ORDRE_PRIO[a.priorite] ?? 1) - (ORDRE_PRIO[b.priorite] ?? 1) || new Date(b.date) - new Date(a.date));
}

function carte(m) {
  const ouvert = ouverts.has(m.id);
  return `<div class="form-card ml-carte ml-${esc(m.priorite.toLowerCase())}" data-id="${esc(m.id)}">
    <div class="ml-tete" data-act="ouvrir">
      <span class="ml-prio">${m.priorite === "Urgent" ? "🔴" : m.priorite === "Faible" ? "⚪" : "🟡"}</span>
      <div class="ml-titre"><b>${esc(m.objet)}</b><small>${esc(adresse(m.expediteur) || m.expediteur)} · ${esc(fmtDate(m.date))}</small></div>
      ${m.categorie ? `<span class="ml-cat">${esc(m.categorie)}</span>` : ""}
      ${m.statut !== "Traité" ? `<span class="ml-cat ml-statut">${esc(m.statut)}</span>` : ""}
    </div>
    <div class="ml-corps ${ouvert ? "" : "ml-apercu"}">${esc(texteOriginal(m.corps).slice(0, ouvert ? 15000 : 400))}</div>
    ${m.resume ? `<div class="ml-resume"><small>🤖 Résumé IA :</small> ${esc(m.resume)}</div>` : m.statut === "Nouveau" ? `<div class="hint">En attente d'analyse…</div>` : ""}
    ${ouvert ? `
      <label class="hint">Brouillon de réponse</label>
      <textarea class="ml-brouillon" rows="8" placeholder="Pas de réponse proposée">${esc(m.brouillon)}</textarea>
      <div class="ml-actions">
        <button class="nav-btn" data-act="outlook" ${adresse(m.expediteur) ? "" : "disabled"}>✉️ Répondre dans Outlook</button>
        <button class="nav-btn" data-act="copier">📋 Copier</button>
        <button class="nav-btn" data-act="repondu">✅ Répondu</button>
        <button class="nav-btn" data-act="ignorer">🙈 Ignorer</button>
        <button class="nav-btn" data-act="retraiter">🔄 Réanalyser</button>
      </div>` : ""}
  </div>`;
}

// ---------- Guide (apprentissage depuis les mails envoyés) ----------

async function chargerColonnesEnvoyes() {
  if (colonnesEnvoyes) return colonnesEnvoyes;
  const data = await graph(`${LISTE_ENVOYES}/columns?$select=name,displayName,text`);
  const parNom = {};
  for (const c of data.value || []) parNom[c.displayName] = c;
  const corps = parNom.Corps;
  if (!corps) throw new Error("Colonne « Corps » absente de la liste MailsEnvoyes");
  colonnesEnvoyes = {
    corps: corps.name,
    destinataire: parNom.Destinataire?.name || null,
  };
  return colonnesEnvoyes;
}

async function lireEnvoyes() {
  await chargerColonnesEnvoyes();
  const tous = [];
  let url = `${LISTE_ENVOYES}/items?$expand=fields&$top=200`;
  while (url && tous.length < 2000) {
    const data = await graph(url);
    tous.push(...(data.value || []));
    url = data["@odata.nextLink"] || null;
  }
  return tous;
}

async function chargerGuide() {
  try {
    const items = await lireEnvoyes();
    const it = items.find(x => x.fields?.Title === TITRE_GUIDE);
    guideItemId = it?.id || null;
    guide = it ? texteSimple(it.fields[colonnesEnvoyes.corps]) : "";
  } catch (e) {
    // Liste pas encore créée ou inaccessible : l'agent fonctionne sans guide.
    console.warn("Guide indisponible :", e);
  }
}

async function enregistrerGuide(texte) {
  await chargerColonnesEnvoyes();
  // Écrit en HTML simple : relu correctement par texteSimple(), que la
  // colonne soit en texte brut ou enrichi.
  const valeur = texte.split("\n").map(l => esc(l)).join("<br>");
  const fields = { Title: TITRE_GUIDE, [colonnesEnvoyes.corps]: valeur };
  if (guideItemId) {
    await graph(`${LISTE_ENVOYES}/items/${guideItemId}/fields`, { method: "PATCH", body: JSON.stringify(fields) });
  } else {
    const cree = await graph(`${LISTE_ENVOYES}/items`, { method: "POST", body: JSON.stringify({ fields }) });
    guideItemId = cree.id;
  }
  guide = texte;
}

function sansHistorique(t) {
  const coupe = t.search(/\n\s*(De ?:|From ?:|-{3,} ?Message d'origine|-{3,} ?Original Message|Le .{5,80} a écrit ?:|Envoyé ?: )/i);
  return (coupe > 0 ? t.slice(0, coupe) : t).trim();
}

async function genererGuide() {
  if (guideEnCours) return;
  try {
    guideEnCours = "Lecture de tes mails envoyés…";
    render();
    const items = await lireEnvoyes();
    const envoyes = items
      .filter(x => x.fields?.Title !== TITRE_GUIDE)
      .map(x => ({
        objet: x.fields?.Title || "",
        destinataire: colonnesEnvoyes.destinataire ? x.fields?.[colonnesEnvoyes.destinataire] || "" : "",
        corps: sansHistorique(texteSimple(x.fields?.[colonnesEnvoyes.corps])).slice(0, 1200),
      }))
      .filter(m => m.corps.length > 20);
    if (envoyes.length < 10) throw new Error(`Seulement ${envoyes.length} mail(s) envoyé(s) exploitable(s) dans la liste MailsEnvoyes : lance d'abord le flux « Import mails envoyés ».`);
    guideEnCours = `Claude étudie ${envoyes.length} mails envoyés… (1 à 2 minutes)`;
    render();
    const token = await getGraphToken();
    const res = await fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ mode: "guide", mails: envoyes.slice(0, 400) }),
    });
    let data = null;
    try { data = await res.json(); } catch { /* non JSON */ }
    if (!res.ok || !data?.guide) {
      if (data && !data.erreur && !data.guide) throw new Error("Le Worker ne connaît pas encore le mode « guide » : colle la version 2 du code dans Cloudflare.");
      throw new Error(data?.erreur ? `${data.erreur}${data.detail ? " — " + String(data.detail).slice(0, 200) : ""}` : `Agent injoignable (${res.status})`);
    }
    await enregistrerGuide(data.guide);
    guideOuvert = true;
    toast(`Guide créé à partir de ${data.nbMails} mails`, "success");
  } catch (e) {
    console.error(e);
    toast(`Guide : ${e.message || e}`, "error");
    erreur = `Guide : ${e.message || e}`;
  } finally {
    guideEnCours = "";
    render();
  }
}

function blocGuide() {
  if (!guideOuvert) return "";
  return `<div class="form-card ml-guide">
    <b>📘 Guide de l'agent</b>
    <div class="hint">Tiré de tes mails envoyés. L'agent le lit avant chaque mail pour répondre comme toi. Tu peux le corriger à la main.</div>
    ${guideEnCours ? `<div class="hint">⏳ ${esc(guideEnCours)}</div>` : ""}
    <textarea class="ml-brouillon ml-guide-texte" rows="16" placeholder="Pas encore de guide.">${esc(guide)}</textarea>
    <div class="ml-actions">
      <button class="nav-btn" data-act="guide-generer" ${guideEnCours ? "disabled" : ""}>✨ ${guide ? "Régénérer" : "Générer"} depuis mes mails envoyés</button>
      <button class="nav-btn" data-act="guide-enregistrer" ${guideEnCours ? "disabled" : ""}>💾 Enregistrer mes corrections</button>
    </div>
  </div>`;
}

function render() {
  if (!conteneur) return;
  const liste = listeFiltree();
  const nbNouveaux = mails.filter(m => m.statut === "Nouveau").length;
  const nbUrgents = mails.filter(m => m.statut === "Traité" && m.priorite === "Urgent").length;
  conteneur.innerHTML = `
    <style>
      .ml-barre{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px}
      .ml-carte{margin-bottom:10px;border-left:4px solid var(--gold)}
      .ml-carte.ml-urgent{border-left-color:var(--red)}
      .ml-carte.ml-faible{border-left-color:var(--border)}
      .ml-tete{display:flex;gap:10px;align-items:flex-start;cursor:pointer}
      .ml-titre{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
      .ml-titre b{overflow-wrap:anywhere}
      .ml-titre small{color:var(--text-dim)}
      .ml-cat{font-size:12px;padding:2px 8px;border-radius:10px;background:var(--panel-alt);border:1px solid var(--border);white-space:nowrap}
      .ml-statut{opacity:.7}
      .ml-resume{margin-top:8px;font-size:13px;color:var(--text-dim);font-style:italic}
      .ml-resume small{font-style:normal}
      .ml-brouillon{width:100%;box-sizing:border-box;margin-top:4px;font:inherit;background:var(--panel-alt);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:8px}
      .ml-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
      .ml-original{margin:8px 0}
      .ml-corps{white-space:pre-wrap;overflow-wrap:anywhere;margin-top:8px;max-height:60vh;overflow:auto}
      .ml-apercu{max-height:none;overflow:hidden;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical}
      .ml-erreur{white-space:pre-wrap;color:var(--red)}
    </style>
    <div class="ml-barre">
      <button class="nav-btn ${filtre === "a-traiter" ? "active" : ""}" data-filtre="a-traiter">À traiter</button>
      <button class="nav-btn ${filtre === "faits" ? "active" : ""}" data-filtre="faits">Répondus / ignorés</button>
      <button class="nav-btn ${filtre === "tous" ? "active" : ""}" data-filtre="tous">Tous</button>
      <button class="nav-btn" data-act="actualiser" ${enCours ? "disabled" : ""}>🔄 Actualiser</button>
      <button class="nav-btn ${guideOuvert ? "active" : ""}" data-act="guide">📘 Guide${guide ? "" : " (vide)"}</button>
      <small class="hint">${nbUrgents ? `${nbUrgents} urgent(s) · ` : ""}${nbNouveaux ? `${nbNouveaux} à analyser` : "tout est analysé"}</small>
    </div>
    ${blocGuide()}
    ${progression ? `<div class="hint">⏳ ${esc(progression)}</div>` : ""}
    ${erreur ? `<div class="form-card ml-erreur">❌ ${esc(erreur)}</div>` : ""}
    ${liste.length ? liste.map(carte).join("") : `<div class="hint" style="padding:24px;text-align:center">Aucun mail dans cette vue.</div>`}`;
}

async function surClic(e) {
  const btnFiltre = e.target.closest("[data-filtre]");
  if (btnFiltre) { filtre = btnFiltre.dataset.filtre; render(); return; }
  const act = e.target.closest("[data-act]")?.dataset.act;
  if (!act) return;
  if (act === "actualiser") { await rafraichir(); return; }
  if (act === "guide") { guideOuvert = !guideOuvert; render(); return; }
  if (act === "guide-generer") { await genererGuide(); return; }
  if (act === "guide-enregistrer") {
    try {
      await enregistrerGuide(conteneur.querySelector(".ml-guide-texte")?.value || "");
      toast("Guide enregistré", "success");
    } catch (err) { toast(`Échec : ${err.message || err}`, "error"); }
    render();
    return;
  }
  const el = e.target.closest(".ml-carte");
  const m = mails.find(x => x.id === el?.dataset.id);
  if (!m) return;
  const texte = el.querySelector(".ml-brouillon")?.value ?? m.brouillon;
  try {
    if (act === "ouvrir") { ouverts.has(m.id) ? ouverts.delete(m.id) : ouverts.add(m.id); render(); }
    else if (act === "outlook") { window.open(lienOutlook(m, texte), "_blank"); }
    else if (act === "copier") { await navigator.clipboard.writeText(texte); toast("Brouillon copié", "success"); }
    else if (act === "repondu" || act === "ignorer") {
      const statut = act === "repondu" ? "Répondu" : "Ignoré";
      await majMail(m.id, { Statut: statut, Brouillon: texte });
      Object.assign(m, { statut, brouillon: texte });
      ouverts.delete(m.id);
      render();
    } else if (act === "retraiter") {
      await majMail(m.id, { Statut: "Nouveau" });
      m.statut = "Nouveau";
      await traiterNouveaux();
    }
  } catch (err) {
    console.error(err);
    toast(`Échec : ${err.message || err}`, "error");
  }
}

async function rafraichir() {
  erreur = "";
  progression = "Lecture des mails…";
  render();
  try {
    await Promise.all([chargerMails(), chargerGuide()]);
    progression = "";
    render();
    await traiterNouveaux();
  } catch (e) {
    console.error(e);
    progression = "";
    erreur = e.message || String(e);
    render();
  }
}

export async function mountMails(container) {
  conteneur = container;
  if (!container.dataset.mlEcoute) {
    container.addEventListener("click", surClic);
    container.dataset.mlEcoute = "1";
  }
  render();
  await rafraichir();
}

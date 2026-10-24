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

// ---------- Briefing : les mails transformés en choses à faire ----------
// Plutôt qu'une boîte mail bis : trois piles claires.
//   ✍️ À répondre (l'IA a préparé une réponse) · 🎯 À faire (une action sans réponse)
//   · 📰 Pour info (repliés). « ✅ Fait » retire le mail, « ⏰ Demain » le reporte.
let repOuverts = new Set(), voirFaits = false;
const nomExp = (s) => { const t = String(s || "").trim(); const m = t.match(/^"?([^"<]+?)"?\s*<[^>]+>/); if (m) return m[1].trim(); const a = adresse(t); return a ? a.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, c => c.toUpperCase()) : t || "Expéditeur inconnu"; };
const heure = (d) => { const x = new Date(d); if (isNaN(x)) return ""; const auj = new Date(); return x.toDateString() === auj.toDateString() ? x.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : x.toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "2-digit" }); };
const isoJour = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function reports() { try { return JSON.parse(localStorage.getItem("ml-reports") || "{}"); } catch { return {}; } }
function reporter(id) { const r = reports(); const d = new Date(); d.setDate(d.getDate() + 1); r[id] = isoJour(d); try { localStorage.setItem("ml-reports", JSON.stringify(r)); } catch { /* */ } }
const estReporte = (m) => { const j = reports()[m.id]; return !!j && j > isoJour(); };
const parPrio = (a, b) => (ORDRE_PRIO[a.priorite] ?? 1) - (ORDRE_PRIO[b.priorite] ?? 1) || new Date(b.date) - new Date(a.date);

function piles() {
  const actifs = mails.filter(m => m.statut === "Traité" && !estReporte(m));
  return {
    repondre: actifs.filter(m => m.priorite !== "Faible" && String(m.brouillon || "").trim()).sort(parPrio),
    faire: actifs.filter(m => m.priorite !== "Faible" && !String(m.brouillon || "").trim()).sort(parPrio),
    info: actifs.filter(m => m.priorite === "Faible").sort(parPrio),
    reportes: mails.filter(m => m.statut === "Traité" && estReporte(m)),
    analyse: mails.filter(m => m.statut === "Nouveau"),
    faitsJour: mails.filter(m => ["Répondu", "Ignoré"].includes(m.statut) && m.faitLe === isoJour()),
  };
}

function carteAction(m, type) {
  const urgent = m.priorite === "Urgent", rep = repOuverts.has(m.id), voir = ouverts.has(m.id);
  return `<article class="bf-c ${urgent ? "urgent" : ""}" data-id="${esc(m.id)}">
    <div class="bf-c-tete">${urgent ? `<span class="bf-urg">Urgent</span>` : ""}${m.categorie ? `<span class="bf-cat">${esc(m.categorie)}</span>` : ""}<span class="bf-h">${esc(heure(m.date))}</span></div>
    <p class="bf-action">${esc(m.resume || m.objet)}</p>
    <p class="bf-de"><b>${esc(nomExp(m.expediteur))}</b> · ${esc(m.objet)}</p>
    ${rep ? `<div class="bf-rep"><textarea class="ml-brouillon" data-brouillon="${esc(m.id)}" rows="8">${esc(m.brouillonEdit ?? m.brouillon)}</textarea>
      <div class="bf-btns"><button class="bf-b principal" data-act="outlook" ${adresse(m.expediteur) ? "" : "disabled"}>✉️ Ouvrir dans Outlook</button><button class="bf-b" data-act="copier">📋 Copier</button><button class="bf-b" data-act="retraiter">🔄 Autre proposition</button></div></div>` : ""}
    ${voir ? `<div class="bf-mail">${esc(texteOriginal(m.corps).slice(0, 15000))}</div>` : ""}
    <div class="bf-btns">
      ${type === "repondre" ? `<button class="bf-b ${rep ? "" : "principal"}" data-act="rep">${rep ? "▲ Fermer la réponse" : "✍️ Voir la réponse proposée"}</button>` : ""}
      <button class="bf-b" data-act="ouvrir">${voir ? "▲ Masquer le mail" : "👁 Lire le mail"}</button>
      <span class="bf-sep"></span>
      <button class="bf-b" data-act="demain" title="Le remettre demain">⏰ Demain</button>
      <button class="bf-b ok" data-act="${type === "repondre" ? "repondu" : "ignorer"}">✅ Fait</button>
    </div></article>`;
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

let envoyesItems = [];
async function chargerGuide() {
  try {
    const items = await lireEnvoyes();
    envoyesItems = items;
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

let renduDiffere = false;
function render() {
  if (!conteneur) return;
  const actif = document.activeElement;
  if (actif && conteneur.contains(actif) && actif.matches("textarea")) { renduDiffere = true; return; }
  renduDiffere = false;
  const p = piles(), n = new Date();
  const total = p.repondre.length + p.faire.length;
  const pile = (titre, sous, liste, type, cls) => `<section class="bf-pile ${cls}"><h3>${titre} <span>${liste.length}</span></h3><p class="bf-sous">${sous}</p>
    ${liste.length ? liste.map(m => carteAction(m, type)).join("") : `<div class="bf-vide">Rien ici 👍</div>`}</section>`;
  conteneur.innerHTML = `<style>
    .bf{max-width:1200px;margin:0 auto}
    .bf-hero{background:linear-gradient(135deg,#0f2a52,#1d4f91);color:#fff;border-radius:18px;padding:20px 24px;display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:14px}
    .bf-hero h2{margin:0;font-size:22px}.bf-hero p{margin:4px 0 0;opacity:.9;font-size:14.5px}
    .bf-hero .bf-outils{margin-left:auto;display:flex;gap:8px;flex-wrap:wrap}
    .bf-hero button{background:rgba(255,255,255,.14);color:#fff;border:1px solid rgba(255,255,255,.3);border-radius:10px;padding:8px 13px;font:inherit;font-size:13px;cursor:pointer}
    .bf-prog{font-size:13px;color:var(--text-dim);margin:-4px 0 10px}
    .bf-grille{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;align-items:start}
    .bf-pile h3{margin:0;font-size:17px;display:flex;align-items:center;gap:8px}.bf-pile h3 span{font-size:13px;background:var(--panel-alt);border:1px solid var(--border);border-radius:99px;padding:1px 10px}
    .bf-sous{margin:2px 0 10px;color:var(--text-dim);font-size:12.5px}
    .bf-c{background:var(--panel);border:1px solid var(--border);border-left:5px solid #3b7be0;border-radius:14px;padding:12px 14px;margin-bottom:10px}
    .bf-faire .bf-c{border-left-color:#f0a020}.bf-c.urgent{border-left-color:#e04848}
    .bf-c-tete{display:flex;gap:6px;align-items:center;margin-bottom:4px}
    .bf-urg{font-size:11px;font-weight:800;color:#fff;background:#e04848;border-radius:6px;padding:1px 7px}
    .bf-cat{font-size:11px;color:var(--text-dim);border:1px solid var(--border);border-radius:99px;padding:1px 8px}
    .bf-h{margin-left:auto;font-size:12px;color:var(--text-dim)}
    .bf-action{margin:0;font-size:15.5px;font-weight:600;line-height:1.4}
    .bf-de{margin:4px 0 0;font-size:12.5px;color:var(--text-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .bf-btns{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:10px}.bf-sep{flex:1}
    .bf-b{border:1px solid var(--border);background:var(--panel-alt);color:var(--text);border-radius:9px;padding:7px 12px;font:inherit;font-size:13px;font-weight:600;cursor:pointer}
    .bf-b.principal{background:#1d4f91;border-color:#1d4f91;color:#fff}.bf-b.ok{border-color:#1baf7a;color:#11845b;background:#e9f8f0}
    .bf-rep{margin-top:10px}.ml-brouillon{width:100%;box-sizing:border-box;font:inherit;font-size:14px;line-height:1.5;background:var(--panel-alt);color:var(--text);border:1px solid var(--border);border-radius:10px;padding:10px 12px}
    .bf-mail{margin-top:10px;white-space:pre-wrap;font-size:13.5px;line-height:1.5;max-height:50vh;overflow:auto;background:var(--panel-alt);border-radius:10px;padding:10px 12px}
    .bf-vide{color:var(--text-dim);padding:16px;text-align:center;border:1px dashed var(--border);border-radius:12px}
    .bf-info{margin-top:16px}.bf-info summary{cursor:pointer;font-weight:700}
    .bf-info-l{display:flex;gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px}.bf-info-l span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .bf-info-l small{color:var(--text-dim)}
    .bf-pied{margin-top:16px;color:var(--text-dim);font-size:13px;display:flex;gap:14px;flex-wrap:wrap}
    .ml-erreur{white-space:pre-wrap;color:var(--red);margin-bottom:10px}
    @media (max-width:900px){.bf-grille{grid-template-columns:1fr}}
  </style><div class="bf">
    <div class="bf-hero"><div><h2>☀️ Ton briefing mails</h2><p>${n.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })} — ${total ? `<b>${p.repondre.length}</b> réponse${p.repondre.length > 1 ? "s" : ""} à envoyer, <b>${p.faire.length}</b> action${p.faire.length > 1 ? "s" : ""} à faire${p.repondre.concat(p.faire).some(m => m.priorite === "Urgent") ? `, dont <b>${p.repondre.concat(p.faire).filter(m => m.priorite === "Urgent").length} urgente(s)</b>` : ""}.` : "rien d'important en attente 🎉"}</p></div>
      <div class="bf-outils"><button data-act="actualiser" ${enCours ? "disabled" : ""}>🔄 Actualiser</button>${mails.some(m => m.statut === "Traité" && Date.now() - new Date(m.date).getTime() > 7 * 864e5) ? `<button data-act="nettoyer" title="Mettre de côté les mails reçus il y a plus de 7 jours">🧹 Ranger les plus de 7 jours</button>` : ""}<button data-act="guide">📘 Mon style d'écriture</button></div></div>
    ${progression ? `<div class="bf-prog">⏳ ${esc(progression)}</div>` : p.analyse.length ? `<div class="bf-prog">${p.analyse.length} mail(s) en attente d'analyse.</div>` : ""}
    ${blocGuide()}
    ${erreur ? `<div class="form-card ml-erreur">❌ ${esc(erreur)}</div>` : ""}
    <div class="bf-grille">
      ${pile("✍️ À répondre", "L'IA a préparé une réponse : relis-la, ajuste, envoie.", p.repondre, "repondre", "bf-repondre")}
      ${pile("🎯 À faire", "Une action à mener, pas forcément de réponse à écrire.", p.faire, "faire", "bf-faire")}
    </div>
    ${p.info.length ? `<details class="form-card bf-info"><summary>📰 Pour info (${p.info.length}) — rien à faire</summary>${p.info.map(m => `<div class="bf-info-l" data-id="${esc(m.id)}"><span><b>${esc(nomExp(m.expediteur))}</b> — ${esc(m.resume || m.objet)}</span><small>${esc(heure(m.date))}</small><button class="bf-b" data-act="ignorer">✓ Vu</button></div>`).join("")}</details>` : ""}
    <div class="bf-pied">${p.reportes.length ? `<span>⏰ ${p.reportes.length} reporté(s) à demain</span>` : ""}${p.faitsJour.length ? `<span>✅ ${p.faitsJour.length} traité(s) aujourd'hui</span>` : ""}</div>
  </div>`;
}

async function surClic(e) {

  const act = e.target.closest("[data-act]")?.dataset.act;
  if (!act) return;
  if (act === "actualiser") { await rafraichir(); return; }
  if (act === "nettoyer") {
    const vieux = mails.filter(m => m.statut === "Traité" && Date.now() - new Date(m.date).getTime() > 7 * 864e5);
    if (!vieux.length || !confirm(`Ranger ${vieux.length} mail(s) reçu(s) il y a plus de 7 jours ?\nIls disparaissent du briefing (rien n'est supprimé dans Outlook).`)) return;
    progression = "Rangement…"; render();
    let n = 0; for (const m of vieux) { try { await majMail(m.id, { Statut: "Ignoré" }); m.statut = "Ignoré"; n++; } catch (e) { console.warn(e); } }
    progression = ""; toast(`🧹 ${n} mail(s) rangé(s)`, "success"); render(); return;
  }
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
  const el = e.target.closest("[data-id]");
  const m = mails.find(x => x.id === el?.dataset.id);
  if (!m) return;
  const texte = el.querySelector(".ml-brouillon")?.value ?? m.brouillonEdit ?? m.brouillon;
  try {
    if (act === "ouvrir") { ouverts.has(m.id) ? ouverts.delete(m.id) : ouverts.add(m.id); render(); }
    else if (act === "rep") { repOuverts.has(m.id) ? repOuverts.delete(m.id) : repOuverts.add(m.id); render(); }
    else if (act === "demain") { reporter(m.id); toast("⏰ Reporté à demain", "success"); render(); }
    else if (act === "outlook") { window.open(lienOutlook(m, texte), "_blank"); }
    else if (act === "copier") { await navigator.clipboard.writeText(texte); toast("Brouillon copié", "success"); }
    else if (act === "repondu" || act === "ignorer") {
      const statut = act === "repondu" ? "Répondu" : "Ignoré";
      await majMail(m.id, { Statut: statut, Brouillon: texte });
      Object.assign(m, { statut, brouillon: texte });
      ouverts.delete(m.id); repOuverts.delete(m.id); m.faitLe = isoJour();
      toast("✅ C'est fait", "success");
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

// Lien avec Outlook : un mail auquel tu as répondu depuis Outlook (réponse
// copiée dans la liste MailsEnvoyes par le flux) passe tout seul en « fait ».
// Rapprochement : même objet (sans RE:/TR:), envoyé à l'expéditeur, après sa réception.
const cleObjet = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/^(\s*(re|tr|fw|fwd|ref|rép|rep)\s*:\s*)+/i, "").replace(/[^a-z0-9]/g, "");
async function marquerRepondusDepuisOutlook() {
  if (!envoyesItems.length || !colonnesEnvoyes) return 0;
  const envois = envoyesItems.filter(x => x.fields?.Title !== TITRE_GUIDE).map(x => ({
    cle: cleObjet(x.fields?.Title), dest: String(colonnesEnvoyes.destinataire ? x.fields?.[colonnesEnvoyes.destinataire] || "" : "").toLowerCase(), le: new Date(x.createdDateTime || 0).getTime(),
  })).filter(e => e.cle);
  const aMarquer = mails.filter(m => ["Nouveau", "Traité"].includes(m.statut)).filter(m => {
    const cle = cleObjet(m.objet), exp = adresse(m.expediteur).toLowerCase(), recu = new Date(m.date).getTime() || 0;
    return cle && envois.some(e => e.cle === cle && e.le >= recu - 60000 && (!e.dest || !exp || e.dest.includes(exp)));
  });
  let n = 0;
  for (const m of aMarquer.slice(0, 60)) { try { await majMail(m.id, { Statut: "Répondu" }); m.statut = "Répondu"; m.faitLe = isoJour(); n++; } catch (e) { console.warn("Répondu auto :", e); } }
  return n;
}

async function rafraichir() {
  erreur = "";
  progression = "Lecture des mails…";
  render();
  try {
    await Promise.all([chargerMails(), chargerGuide()]);
    const auto = await marquerRepondusDepuisOutlook().catch(() => 0);
    if (auto) toast(`✉️ ${auto} mail(s) déjà répondu(s) depuis Outlook retiré(s)`, "success");
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

export async function mountMails(container, user) {
  // Boîte mail personnelle : Super Admin uniquement, même si l'onglet
  // apparaissait par erreur (aperçu, droits mal réglés…).
  if (!user || user.role !== "super_admin" || user.apercu) { container.innerHTML = `<div class="form-card">🔒 Assistant mails réservé au Super Administrateur.</div>`; return; }
  conteneur = container;
  if (!container.dataset.mlEcoute) {
    container.addEventListener("click", surClic);
    container.addEventListener("input", (e) => {
      if (e.target.classList.contains("ml-q")) { recherche = e.target.value; render(); }
      const b = e.target.closest("[data-brouillon]"); if (b) { const m = mails.find(x => x.id === b.dataset.brouillon); if (m) m.brouillonEdit = b.value; }
    });
    container.addEventListener("focusout", () => setTimeout(() => { if (renduDiffere) render(); }, 300));
    container.dataset.mlEcoute = "1";
  }
  render();
  await rafraichir();
}

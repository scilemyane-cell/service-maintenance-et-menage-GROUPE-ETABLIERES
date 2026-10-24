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

let selection = null;   // mail affiché à droite
let filtreCat = "";     // catégorie choisie
let recherche = "";
const nomExp = (s) => { const t = String(s || "").trim(); const m = t.match(/^"?([^"<]+?)"?\s*<[^>]+>/); if (m) return m[1].trim(); const a = adresse(t); return a ? a.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, c => c.toUpperCase()) : t || "Expéditeur inconnu"; };
const heure = (d) => { const x = new Date(d); if (isNaN(x)) return ""; const auj = new Date(); return x.toDateString() === auj.toDateString() ? x.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : x.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }); };
const PRIO = { Urgent: { cls: "urgent", label: "Urgent" }, Normal: { cls: "normal", label: "Normal" }, Faible: { cls: "faible", label: "Faible" } };

function listeFiltree() {
  const q = recherche.trim().toLowerCase();
  const l = mails.filter(m => filtre === "tous" ? true : filtre === "a-traiter" ? ["Nouveau", "Traité"].includes(m.statut) : ["Répondu", "Ignoré"].includes(m.statut))
    .filter(m => !filtreCat || m.categorie === filtreCat)
    .filter(m => !q || `${m.objet} ${m.expediteur} ${m.resume}`.toLowerCase().includes(q));
  return l.sort((a, b) => (ORDRE_PRIO[a.priorite] ?? 1) - (ORDRE_PRIO[b.priorite] ?? 1) || new Date(b.date) - new Date(a.date));
}

function ligneListe(m) {
  const p = PRIO[m.priorite] || PRIO.Normal;
  return `<button type="button" class="ml-li ${selection === m.id ? "sel" : ""} ${m.statut === "Nouveau" ? "nouveau" : ""}" data-sel="${esc(m.id)}">
    <span class="ml-pt ${p.cls}" title="${p.label}"></span>
    <span class="ml-li-c">
      <span class="ml-li-l1"><b>${esc(nomExp(m.expediteur))}</b><small>${esc(heure(m.date))}</small></span>
      <span class="ml-li-obj">${esc(m.objet)}</span>
      <span class="ml-li-res">${m.statut === "Nouveau" ? "⏳ en attente d'analyse" : esc(m.resume || texteOriginal(m.corps).slice(0, 120))}</span>
      ${m.categorie || ["Répondu", "Ignoré"].includes(m.statut) ? `<span class="ml-li-tags">${m.categorie ? `<i>${esc(m.categorie)}</i>` : ""}${m.statut === "Répondu" ? `<i class="ok">✓ répondu</i>` : m.statut === "Ignoré" ? `<i>ignoré</i>` : ""}</span>` : ""}
    </span></button>`;
}

function detail(m) {
  if (!m) return `<div class="ml-vide"><div>📭</div><b>Choisis un mail dans la liste</b><span>Le résumé, la réponse proposée et le mail d'origine s'afficheront ici.</span></div>`;
  const p = PRIO[m.priorite] || PRIO.Normal, ouvert = ouverts.has(m.id), fait = ["Répondu", "Ignoré"].includes(m.statut);
  return `<article class="ml-detail" data-id="${esc(m.id)}">
    <button type="button" class="ml-retour" data-act="fermer">← Liste</button>
    <header class="ml-d-tete">
      <div class="ml-d-badges"><span class="ml-prio-b ${p.cls}">${p.label}</span>${m.categorie ? `<span class="ml-cat">${esc(m.categorie)}</span>` : ""}${fait ? `<span class="ml-cat">${esc(m.statut)}</span>` : ""}</div>
      <h2>${esc(m.objet)}</h2>
      <div class="ml-d-de"><span class="ml-av">${esc(nomExp(m.expediteur).slice(0, 1).toUpperCase())}</span><div><b>${esc(nomExp(m.expediteur))}</b><small>${esc(adresse(m.expediteur) || m.expediteur)} · ${esc(fmtDate(m.date))}</small></div></div>
    </header>
    ${m.statut === "Nouveau" ? `<div class="ml-bloc ml-attente">⏳ Analyse par l'IA en cours ou à venir…</div>` : `
    <section class="ml-bloc ml-afaire"><h3>🎯 Ce qu'il faut faire</h3><p>${esc(m.resume || "Pas de résumé.")}</p></section>
    <section class="ml-bloc ml-rep"><h3>✍️ Réponse proposée <small>— modifie-la si besoin avant d'envoyer</small></h3>
      <textarea class="ml-brouillon" data-brouillon="${esc(m.id)}" rows="9" placeholder="Pas de réponse proposée : ce mail n'en demande peut-être pas.">${esc(m.brouillonEdit ?? m.brouillon)}</textarea>
      <div class="ml-actions">
        <button class="ml-btn principal" data-act="outlook" ${adresse(m.expediteur) ? "" : "disabled"}>✉️ Répondre dans Outlook</button>
        <button class="ml-btn" data-act="copier">📋 Copier</button>
        <span class="ml-sep"></span>
        ${fait ? "" : `<button class="ml-btn ok" data-act="repondu">✅ C'est répondu</button><button class="ml-btn" data-act="ignorer">🙈 Pas de réponse</button>`}
        <button class="ml-btn discret" data-act="retraiter" title="Redemander à l'IA">🔄 Réanalyser</button>
      </div>
    </section>`}
    <section class="ml-bloc ml-orig"><h3 data-act="ouvrir">📨 Mail d'origine <small>${ouvert ? "▲ réduire" : "▼ tout afficher"}</small></h3>
      <div class="ml-corps ${ouvert ? "" : "ml-apercu"}">${esc(texteOriginal(m.corps).slice(0, ouvert ? 15000 : 900))}</div></section>
  </article>`;
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

let renduDiffere = false;
function render() {
  if (!conteneur) return;
  // Ne pas effacer une réponse en cours de frappe (l'analyse redessine l'écran).
  const actif = document.activeElement;
  if (actif && conteneur.contains(actif) && actif.matches("textarea")) { renduDiffere = true; return; }
  renduDiffere = false;
  const liste = listeFiltree();
  if (selection && !mails.some(m => m.id === selection)) selection = null;
  if (!selection && liste.length && window.innerWidth > 900) selection = liste[0].id;
  const m = mails.find(x => x.id === selection);
  const aTraiter = mails.filter(x => ["Nouveau", "Traité"].includes(x.statut));
  const nbNouveaux = mails.filter(x => x.statut === "Nouveau").length;
  const nbUrgents = aTraiter.filter(x => x.statut === "Traité" && x.priorite === "Urgent").length;
  const nbFaits = mails.filter(x => ["Répondu", "Ignoré"].includes(x.statut)).length;
  const cats = [...new Set(mails.filter(x => filtre === "tous" || (filtre === "a-traiter" ? ["Nouveau", "Traité"].includes(x.statut) : ["Répondu", "Ignoré"].includes(x.statut))).map(x => x.categorie).filter(Boolean))].sort();
  const restants = progression.match(/(\d+)\/(\d+)/);
  const focus = document.activeElement?.classList?.contains("ml-q");
  conteneur.innerHTML = `
    <style>
      .ml-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:12px}
      .ml-kpi{background:var(--panel);border:1px solid var(--border);border-left:5px solid var(--border);border-radius:14px;padding:10px 14px;display:flex;flex-direction:column;cursor:pointer;text-align:left;font:inherit;color:var(--text)}
      .ml-kpi b{font-size:24px;line-height:1.1}.ml-kpi span{font-size:12px;color:var(--text-dim)}
      .ml-kpi.rouge{border-left-color:#e04848}.ml-kpi.bleu{border-left-color:#3b7be0}.ml-kpi.vert{border-left-color:#1baf7a}.ml-kpi.gris{border-left-color:#9aa4b2}
      .ml-kpi.on{box-shadow:0 0 0 2px var(--teal,#1baf7a) inset}
      .ml-prog{display:flex;align-items:center;gap:10px;font-size:12.5px;color:var(--text-dim);margin:-2px 0 10px}
      .ml-prog-b{flex:1;max-width:320px;height:6px;border-radius:99px;background:var(--border);overflow:hidden}.ml-prog-b i{display:block;height:100%;background:#3b7be0;transition:width .3s}
      .ml-barre{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px}
      .ml-q{flex:1;min-width:180px;padding:9px 12px;border-radius:10px;border:1px solid var(--border);background:var(--panel);color:var(--text);font:inherit}
      .ml-chips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}
      .ml-chip{border:1px solid var(--border);background:var(--panel);color:var(--text);border-radius:99px;padding:4px 11px;font:inherit;font-size:12px;cursor:pointer}
      .ml-chip.on{background:var(--teal,#1baf7a);color:#fff;border-color:transparent}
      .ml-app{display:grid;grid-template-columns:minmax(280px,380px) minmax(0,1fr);gap:12px;align-items:start}
      .ml-liste{background:var(--panel);border:1px solid var(--border);border-radius:14px;overflow:hidden;max-height:calc(100vh - 230px);overflow-y:auto;position:sticky;top:10px}
      .ml-li{display:flex;gap:10px;width:100%;text-align:left;padding:11px 12px;border:none;border-bottom:1px solid var(--border);background:none;color:var(--text);font:inherit;cursor:pointer}
      .ml-li:hover{background:var(--panel-alt)}.ml-li.sel{background:color-mix(in srgb,var(--teal,#1baf7a) 14%,var(--panel));box-shadow:inset 3px 0 0 var(--teal,#1baf7a)}
      .ml-pt{flex:none;width:10px;height:10px;border-radius:50%;margin-top:5px;background:#f0a020}.ml-pt.urgent{background:#e04848}.ml-pt.faible{background:#b8c0cc}
      .ml-li-c{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
      .ml-li-l1{display:flex;justify-content:space-between;gap:8px}.ml-li-l1 b{font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ml-li-l1 small{color:var(--text-dim);font-size:11.5px;white-space:nowrap}
      .ml-li-obj{font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .ml-li-res{font-size:12px;color:var(--text-dim);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
      .ml-li-tags{display:flex;gap:4px;flex-wrap:wrap}.ml-li-tags i{font-style:normal;font-size:10.5px;padding:1px 7px;border-radius:99px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text-dim)}.ml-li-tags i.ok{color:#11845b;border-color:#bfe8d4}
      .ml-detail,.ml-vide{background:var(--panel);border:1px solid var(--border);border-radius:14px;padding:18px 20px}
      .ml-vide{display:flex;flex-direction:column;align-items:center;gap:6px;padding:60px 20px;color:var(--text-dim);text-align:center}.ml-vide div{font-size:40px}
      .ml-retour{display:none;border:1px solid var(--border);background:var(--panel-alt);color:var(--text);border-radius:8px;padding:6px 12px;font:inherit;margin-bottom:10px;cursor:pointer}
      .ml-d-badges{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}
      .ml-prio-b{font-size:11.5px;font-weight:700;padding:3px 10px;border-radius:99px;background:#fdecc8;color:#8a5a00}.ml-prio-b.urgent{background:#fde0e0;color:#b42323}.ml-prio-b.faible{background:var(--panel-alt);color:var(--text-dim)}
      .ml-cat{font-size:11.5px;padding:3px 10px;border-radius:99px;background:var(--panel-alt);border:1px solid var(--border)}
      .ml-detail h2{margin:0 0 10px;font-size:20px;line-height:1.3;overflow-wrap:anywhere}
      .ml-d-de{display:flex;gap:10px;align-items:center;margin-bottom:14px}.ml-d-de div{display:flex;flex-direction:column}.ml-d-de small{color:var(--text-dim);font-size:12px}
      .ml-av{width:36px;height:36px;border-radius:50%;background:#3b7be0;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700}
      .ml-bloc{border-radius:12px;padding:12px 14px;margin-top:10px;border:1px solid var(--border)}
      .ml-bloc h3{margin:0 0 6px;font-size:14px}.ml-bloc h3 small{font-weight:400;color:var(--text-dim);font-size:12px}
      .ml-afaire{background:color-mix(in srgb,#3b7be0 9%,var(--panel));border-color:color-mix(in srgb,#3b7be0 35%,var(--border))}.ml-afaire p{margin:0;font-size:14.5px;line-height:1.45}
      .ml-attente{color:var(--text-dim)}
      .ml-brouillon{width:100%;box-sizing:border-box;font:inherit;font-size:14px;line-height:1.5;background:var(--panel-alt);color:var(--text);border:1px solid var(--border);border-radius:10px;padding:10px 12px;resize:vertical}
      .ml-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px}.ml-sep{flex:1}
      .ml-btn{border:1px solid var(--border);background:var(--panel);color:var(--text);border-radius:10px;padding:9px 14px;font:inherit;font-size:13px;font-weight:600;cursor:pointer}
      .ml-btn.principal{background:#1d4f91;border-color:#1d4f91;color:#fff;padding:10px 18px}.ml-btn.ok{border-color:#1baf7a;color:#11845b}.ml-btn.discret{border-style:dashed;color:var(--text-dim)}
      .ml-btn:disabled{opacity:.5;cursor:default}
      .ml-orig h3{cursor:pointer}
      .ml-corps{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13.5px;line-height:1.5;max-height:60vh;overflow:auto}
      .ml-apercu{max-height:none;overflow:hidden;display:-webkit-box;-webkit-line-clamp:8;-webkit-box-orient:vertical}
      .ml-guide{margin-bottom:12px}
      .ml-erreur{white-space:pre-wrap;color:var(--red);margin-bottom:10px}
      @media (max-width:900px){.ml-app{grid-template-columns:1fr}.ml-liste{max-height:none;position:static}.ml-app.avec-sel .ml-liste{display:none}.ml-app:not(.avec-sel) .ml-droite{display:none}.ml-retour{display:inline-block}}
    </style>
    <div class="ml-kpis">
      <button class="ml-kpi rouge ${filtre === "a-traiter" ? "on" : ""}" data-filtre="a-traiter"><b>${nbUrgents}</b><span>urgent${nbUrgents > 1 ? "s" : ""} à traiter</span></button>
      <button class="ml-kpi bleu ${filtre === "a-traiter" ? "on" : ""}" data-filtre="a-traiter"><b>${aTraiter.length}</b><span>mails à traiter</span></button>
      <button class="ml-kpi vert ${filtre === "faits" ? "on" : ""}" data-filtre="faits"><b>${nbFaits}</b><span>répondus ou ignorés</span></button>
      <button class="ml-kpi gris ${filtre === "tous" ? "on" : ""}" data-filtre="tous"><b>${mails.length}</b><span>tous les mails</span></button>
    </div>
    ${progression ? `<div class="ml-prog">⏳ ${esc(progression)}${restants ? `<span class="ml-prog-b"><i style="width:${Math.round(restants[1] / restants[2] * 100)}%"></i></span>` : ""}</div>` : nbNouveaux ? `<div class="ml-prog">${nbNouveaux} mail(s) pas encore analysé(s)</div>` : ""}
    <div class="ml-barre">
      <input class="ml-q" type="search" placeholder="🔎 Rechercher : expéditeur, objet, mot…" value="${esc(recherche)}">
      <button class="ml-btn" data-act="actualiser" ${enCours ? "disabled" : ""}>🔄 Actualiser</button>
      <button class="ml-btn ${guideOuvert ? "ok" : ""}" data-act="guide">📘 Guide de style${guide ? "" : " (vide)"}</button>
    </div>
    ${cats.length > 1 ? `<div class="ml-chips"><button class="ml-chip ${filtreCat ? "" : "on"}" data-cat="">Toutes</button>${cats.map(c => `<button class="ml-chip ${filtreCat === c ? "on" : ""}" data-cat="${esc(c)}">${esc(c)}</button>`).join("")}</div>` : ""}
    ${blocGuide()}
    ${erreur ? `<div class="form-card ml-erreur">❌ ${esc(erreur)}</div>` : ""}
    <div class="ml-app ${selection ? "avec-sel" : ""}">
      <div class="ml-liste">${liste.length ? liste.map(ligneListe).join("") : `<div class="hint" style="padding:24px;text-align:center">Aucun mail ici. 🎉</div>`}</div>
      <div class="ml-droite">${detail(m)}</div>
    </div>`;
  if (focus) { const q = conteneur.querySelector(".ml-q"); q?.focus(); q?.setSelectionRange(q.value.length, q.value.length); }
}

async function surClic(e) {
  const btnFiltre = e.target.closest("[data-filtre]");
  if (btnFiltre) { filtre = btnFiltre.dataset.filtre; filtreCat = ""; selection = null; render(); return; }
  const btnCat = e.target.closest("[data-cat]");
  if (btnCat) { filtreCat = btnCat.dataset.cat; selection = null; render(); return; }
  const sel = e.target.closest("[data-sel]");
  if (sel) { selection = sel.dataset.sel; render(); if (window.innerWidth <= 900) window.scrollTo?.(0, 0); return; }
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
  if (act === "fermer") { selection = null; render(); return; }
  const el = e.target.closest(".ml-detail");
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
      const suivant = listeFiltree().find(x => x.id !== m.id);
      selection = window.innerWidth > 900 ? suivant?.id || null : null;
      toast(statut === "Répondu" ? "✓ Marqué répondu" : "Mail mis de côté", "success");
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

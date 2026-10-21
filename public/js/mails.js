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
const ORDRE_PRIO = { Urgent: 0, Normal: 1, Faible: 2 };

let conteneur = null;
let mails = [];
let colonnes = null; // nom affiché → nom interne SharePoint
let filtre = "a-traiter";
let erreur = "";
let enCours = false;
let progression = "";
let ouverts = new Set();

// ---------- Microsoft Graph ----------

async function graph(url, options = {}) {
  const token = await getGraphToken();
  const res = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(options.headers || {}) },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    if (res.status === 403) throw new Error(`Accès refusé à la liste MailsEntrants (403). ${detail.slice(0, 200)}`);
    if (res.status === 404) throw new Error(`Liste « MailsEntrants » introuvable sur le site appsmm (404).`);
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
      date: champ(f, "DateReception") || it.createdDateTime,
      corps: champ(f, "Corps"),
      statut: champ(f, "Statut") || "Nouveau",
      categorie: champ(f, "Categorie"),
      priorite: champ(f, "Priorite") || "Normal",
      resume: champ(f, "Resume"),
      brouillon: champ(f, "Brouillon"),
    };
  });
}

async function majMail(id, valeurs) {
  const corps = {};
  for (const [nom, v] of Object.entries(valeurs)) corps[colonnes[nom]] = v;
  await graph(`${LISTE}/items/${id}/fields`, { method: "PATCH", body: JSON.stringify(corps) });
}

// ---------- Agent (Worker Cloudflare) ----------

async function analyser(mail) {
  const token = await getGraphToken();
  const res = await fetch(WORKER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ objet: mail.objet, expediteur: mail.expediteur, date: mail.date, corps: mail.corps }),
  });
  let data = null;
  try { data = await res.json(); } catch { /* réponse non JSON */ }
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
    ${m.resume ? `<div class="ml-resume">${esc(m.resume)}</div>` : m.statut === "Nouveau" ? `<div class="hint">En attente d'analyse…</div>` : ""}
    ${ouvert ? `
      <details class="ml-original"><summary>Voir le mail d'origine</summary><div class="ml-corps">${esc(String(m.corps).replace(/<[^>]+>/g, " ").replace(/\s{3,}/g, "\n\n").slice(0, 8000))}</div></details>
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
      .ml-resume{margin-top:6px}
      .ml-brouillon{width:100%;box-sizing:border-box;margin-top:4px;font:inherit;background:var(--panel-alt);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:8px}
      .ml-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
      .ml-original{margin:8px 0}
      .ml-corps{white-space:pre-wrap;font-size:13px;color:var(--text-dim);max-height:300px;overflow:auto;margin-top:6px}
      .ml-erreur{white-space:pre-wrap;color:var(--red)}
    </style>
    <div class="ml-barre">
      <button class="nav-btn ${filtre === "a-traiter" ? "active" : ""}" data-filtre="a-traiter">À traiter</button>
      <button class="nav-btn ${filtre === "faits" ? "active" : ""}" data-filtre="faits">Répondus / ignorés</button>
      <button class="nav-btn ${filtre === "tous" ? "active" : ""}" data-filtre="tous">Tous</button>
      <button class="nav-btn" data-act="actualiser" ${enCours ? "disabled" : ""}>🔄 Actualiser</button>
      <small class="hint">${nbUrgents ? `${nbUrgents} urgent(s) · ` : ""}${nbNouveaux ? `${nbNouveaux} à analyser` : "tout est analysé"}</small>
    </div>
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
    await chargerMails();
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

// connexions.js — Administration > Connexions (Super Admin uniquement)
import { esc } from "./astreinte-logic.js";
import { listerConnexions } from "./connexions-data.js";
import { watchUsers } from "./users-data.js";
import { roleLabel } from "./auth.js";
import { lireLectures, jourQuota } from "./lectures-compteur.js";

let charge = 0, conteneur = null, lignes = [], users = [], unsub = null, filtre = "", periode = 30, erreur = "", lectures = null, erreurLectures = "";

export async function mountConnexions(container) {
  conteneur = container;
  container.innerHTML = `<div class="hint">Chargement des connexions…</div>`;
  unsub?.(); unsub = watchUsers(u => { users = u; render(); });
  lireLectures(7).then(l => { lectures = l; erreurLectures = ""; render(); }).catch(e => { lectures = []; erreurLectures = e?.code || e?.message || String(e); render(); });
  // 30 jours par défaut (chaque connexion listée = 1 lecture Firestore) ; 90 j à la demande.
  try { lignes = await listerConnexions(Math.max(30, periode)); charge = Math.max(30, periode); erreur = ""; }
  catch (e) { console.error(e); erreur = e.message || String(e); lignes = []; }
  render();
}

const fmt = (d) => d ? d.toLocaleString("fr-FR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
function ilYa(d) {
  if (!d) return "jamais";
  const min = Math.round((Date.now() - d) / 60000);
  if (min < 2) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const j = Math.round(h / 24);
  return j === 1 ? "hier" : `il y a ${j} jours`;
}
const icone = (a) => a === "Téléphone" ? "📱" : a === "Tablette" ? "📲" : "💻";

// ---- Compteur de lectures Firestore (estimation) ----
const QUOTA = 50000;
function blocLecturesHTML() {
  if (lectures === null) return `<div class="form-card cx-lect"><b>📊 Lectures Firestore</b><div class="hint">Chargement…</div></div>`;
  if (erreurLectures) return `<div class="form-card cx-lect"><b>📊 Lectures Firestore</b><div class="hint" style="color:var(--red)">❌ ${esc(erreurLectures)}${/permission/i.test(erreurLectures) ? " — publie la dernière version des règles Firestore (bloc « lectures »)." : /quota|exhaust/i.test(erreurLectures) ? " — quota du jour dépassé (remise à zéro vers 9 h)." : ""}</div><small class="hint">Cet appareil depuis l'ouverture de l'appli : <b>${(globalThis.__smmLectures?.n || 0).toLocaleString("fr-FR")}</b> lectures</small></div>`;
  const auj = jourQuota();
  const duJour = lectures.filter(l => l.jour === auj);
  const total = duJour.reduce((s, l) => s + (l.n || 0), 0);
  const pct = Math.min(100, Math.round(total / QUOTA * 100));
  const niveau = pct >= 80 ? "rouge" : pct >= 50 ? "orange" : "vert";
  const parJour = []; for (let i = 6; i >= 0; i--) { const j = jourQuota(new Date(Date.now() - i * 864e5)); parJour.push({ j, n: lectures.filter(l => l.jour === j).reduce((s, l) => s + (l.n || 0), 0) }); }
  const max = Math.max(QUOTA / 10, ...parJour.map(x => x.n));
  const nomDe = (uid, nom) => users.find(u => u.uid === uid)?.nom || nom || "?";
  return `<div class="form-card cx-lect">
    <div class="cx-lect-tete"><b>📊 Lectures Firestore aujourd'hui</b><small>estimation · quota gratuit remis à zéro vers 9 h</small></div>
    <small class="hint">Cet appareil depuis l'ouverture de l'appli : <b>${(globalThis.__smmLectures?.n || 0).toLocaleString("fr-FR")}</b> lectures</small>
    <div class="cx-lect-chiffre"><b>${total.toLocaleString("fr-FR")}</b> / ${QUOTA.toLocaleString("fr-FR")} <span class="cx-lect-pct ${niveau}">${pct} %</span></div>
    <div class="cx-lect-barre"><div class="${niveau}" style="width:${pct}%"></div></div>
    ${duJour.length ? `<div class="cx-lect-pers">${duJour.sort((a, b) => b.n - a.n).map(l => `<span><b>${esc(nomDe(l.uid, l.nom))}</b> ${(l.n || 0).toLocaleString("fr-FR")}</span>`).join("")}</div>` : `<div class="hint">Pas encore de lecture comptée aujourd'hui (envoi toutes les 5 min).</div>`}
    <div class="cx-lect-jours">${parJour.map(x => `<div title="${x.n.toLocaleString("fr-FR")} lectures"><i style="height:${Math.max(2, Math.round(x.n / max * 60))}px" class="${x.n >= QUOTA * .8 ? "rouge" : x.n >= QUOTA * .5 ? "orange" : "vert"}"></i><small>${x.j.slice(8)}/${x.j.slice(5, 7)}</small></div>`).join("")}</div>
  </div>`;
}

function render() {
  if (!conteneur || !document.contains(conteneur)) { unsub?.(); unsub = null; return; }
  const limite = Date.now() - periode * 864e5;
  const dansPeriode = lignes.filter(l => l.date && l.date.getTime() >= limite);
  const q = filtre.trim().toLowerCase();

  // Une ligne par utilisateur (comptes existants + connexions d'invités)
  const parUid = new Map();
  users.forEach(u => parUid.set(u.uid, { uid: u.uid, nom: u.nom || u.email, email: u.email, role: u.role, derniere: null, nb: 0, appareil: "" }));
  lignes.forEach(l => {
    if (!parUid.has(l.uid)) parUid.set(l.uid, { uid: l.uid, nom: l.nom || l.email || "?", email: l.email, role: l.role, derniere: null, nb: 0, appareil: "" });
    const p = parUid.get(l.uid);
    if (l.date && (!p.derniere || l.date > p.derniere)) { p.derniere = l.date; p.appareil = l.appareil; }
    if (l.date && l.date.getTime() >= limite) p.nb++;
  });
  const personnes = [...parUid.values()]
    .filter(p => !q || `${p.nom} ${p.email}`.toLowerCase().includes(q))
    .sort((a, b) => (b.derniere || 0) - (a.derniere || 0));
  const actifs = personnes.filter(p => p.nb > 0).length;
  const jamais = [...parUid.values()].filter(p => !p.derniere && p.role).length;
  const auj = new Date(); auj.setHours(0, 0, 0, 0);
  const aujourdhui = new Set(lignes.filter(l => l.date && l.date >= auj).map(l => l.uid)).size;
  const journal = dansPeriode.filter(l => !q || `${l.nom} ${l.email}`.toLowerCase().includes(q)).slice(0, 200);

  conteneur.innerHTML = `
  <div class="stack cx">
    ${blocLecturesHTML()}
    <div class="cx-kpis">
      <div class="cx-kpi"><b>${aujourdhui}</b><span>connecté(s) aujourd'hui</span></div>
      <div class="cx-kpi"><b>${actifs}</b><span>actif(s) sur ${periode} jours</span></div>
      <div class="cx-kpi"><b>${dansPeriode.length}</b><span>connexions sur ${periode} jours</span></div>
      <div class="cx-kpi ${jamais ? "alerte" : ""}"><b>${jamais}</b><span>compte(s) sans connexion sur ${charge} j*</span></div>
    </div>
    <div class="cx-filtres">
      <input id="cx-q" placeholder="🔍 Rechercher une personne…" value="${esc(filtre)}">
      <select id="cx-periode">${[7, 30, 90].map(j => `<option value="${j}" ${j === periode ? "selected" : ""}>${j} derniers jours</option>`).join("")}</select>
    </div>
    ${erreur ? `<div class="hint" style="color:var(--red)">❌ ${esc(erreur)}<br>Si c'est « Missing or insufficient permissions », publie la dernière version de firestore.rules (bloc « connexions »).</div>` : ""}

    <div class="form-card" style="padding:0;overflow:hidden">
      <div class="table-wrap" style="border:none">
        <table class="cx-table">
          <thead><tr><th>Personne</th><th>Rôle</th><th>Dernière connexion</th><th style="text-align:center">Connexions (${periode} j)</th></tr></thead>
          <tbody>
            ${personnes.map(p => `
              <tr class="${!p.derniere ? "cx-jamais" : ""}">
                <td><b>${esc(p.nom || "?")}</b>${p.email && p.email !== p.nom ? `<br><small>${esc(p.email)}</small>` : ""}</td>
                <td><small>${p.role ? esc(p.role === "invite" ? "Remplaçant (QR)" : roleLabel(p.role)) : "—"}</small></td>
                <td>${p.derniere ? `<span class="cx-pastille ${Date.now() - p.derniere < 864e5 ? "vert" : Date.now() - p.derniere < 7 * 864e5 ? "orange" : "gris"}"></span>${icone(p.appareil)} ${esc(ilYa(p.derniere))}<br><small>${fmt(p.derniere)}</small>` : `<small>Aucune connexion depuis la mise en place du suivi</small>`}</td>
                <td style="text-align:center;font-weight:700">${p.nb || "—"}</td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>
    </div>

    <details class="form-card">
      <summary style="cursor:pointer;font-weight:700">🕒 Journal détaillé (${journal.length} dernières connexions)</summary>
      <div class="table-wrap" style="border:none;margin-top:10px">
        <table class="cx-table">
          <thead><tr><th>Date</th><th>Personne</th><th>Appareil</th></tr></thead>
          <tbody>${journal.map(l => `<tr><td>${fmt(l.date)}</td><td>${esc(l.nom || l.email)}</td><td>${icone(l.appareil)} ${esc([l.appareil, l.systeme, l.navigateur].filter(Boolean).join(" · "))}</td></tr>`).join("")}</tbody>
        </table>
      </div>
    </details>
    <p class="hint" style="margin:0">* Le suivi démarre avec cette version : les connexions antérieures ne sont pas connues. Une connexion est comptée au plus une fois toutes les 30 minutes par appareil.</p>
  </div>`;

  const inp = document.getElementById("cx-q");
  inp.addEventListener("input", () => { filtre = inp.value; const pos = inp.selectionStart; render(); const n = document.getElementById("cx-q"); n.focus(); n.setSelectionRange(pos, pos); });
  document.getElementById("cx-periode").addEventListener("change", async (e) => {
    periode = +e.target.value;
    if (periode > charge) { try { lignes = await listerConnexions(periode); charge = periode; } catch (err) { console.error(err); } }
    render();
  });
}

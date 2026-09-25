// connexions.js — Administration > Connexions (Super Admin uniquement)
import { esc } from "./astreinte-logic.js";
import { listerConnexions } from "./connexions-data.js";
import { watchUsers } from "./users-data.js";
import { roleLabel } from "./auth.js";

let conteneur = null, lignes = [], users = [], unsub = null, filtre = "", periode = 30, erreur = "";

export async function mountConnexions(container) {
  conteneur = container;
  container.innerHTML = `<div class="hint">Chargement des connexions…</div>`;
  unsub?.(); unsub = watchUsers(u => { users = u; render(); });
  try { lignes = await listerConnexions(90); erreur = ""; }
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
    <div class="cx-kpis">
      <div class="cx-kpi"><b>${aujourdhui}</b><span>connecté(s) aujourd'hui</span></div>
      <div class="cx-kpi"><b>${actifs}</b><span>actif(s) sur ${periode} jours</span></div>
      <div class="cx-kpi"><b>${dansPeriode.length}</b><span>connexions sur ${periode} jours</span></div>
      <div class="cx-kpi ${jamais ? "alerte" : ""}"><b>${jamais}</b><span>compte(s) jamais connecté(s)*</span></div>
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
  document.getElementById("cx-periode").addEventListener("change", (e) => { periode = +e.target.value; render(); });
}

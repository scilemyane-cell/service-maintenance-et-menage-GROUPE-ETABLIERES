// equipe-aujourdhui.js — Tuile « 👥 Équipe & absences », onglet « Aujourd'hui » :
// qui est là, qui est absent (type, jusqu'à quand), et les absences des 14 prochains jours.
// Mêmes données que l'astreinte, l'écran atelier et les demandes (collection « absences »).
import { compteCeJour, joursAbsence } from "./absences-util.js";
import { esc } from "./astreinte-logic.js";
import { watchPeople, watchAbsences } from "./firestore-data.js";
import { watchCoordonnees } from "./coordonnees-data.js";

let unsubs = [], conteneur = null;
const st = { people: null, absences: [], coord: {} };
const TYPES = { conge: ["🌴", "Congé"], rtt: ["🕒", "RTT"], arret: ["🤒", "Arrêt"], enfant: ["🧒", "Enfant malade"], mtt: ["🩺", "Mi-temps thérapeutique"] };
const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const frJ = (j, opt = { weekday: "short", day: "numeric", month: "short" }) => new Date(j + "T12:00").toLocaleDateString("fr-FR", opt);
const sansAcc = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

function personnes() {
  const p = st.people || {}, actif = p.astreinteActive || {};
  const l = [...(p.n1 || []), ...(p.n2 || []), ...Object.keys(st.coord || {})].filter(Boolean);
  const vus = new Set(), out = [];
  l.forEach(n => { const k = sansAcc(n); if (!vus.has(k) && actif[n] !== false) { vus.add(k); out.push(n); } });
  // Personnes absentes mais pas dans la liste (saisies à la main) : ajoutées aussi.
  st.absences.forEach(a => { const k = sansAcc(a.person); if (a.person && !vus.has(k)) { vus.add(k); out.push(a.person); } });
  return out.sort((a, b) => a.localeCompare(b, "fr"));
}

function render() {
  if (!conteneur || !document.contains(conteneur)) return;
  const auj = iso(new Date()), dans14 = iso(new Date(Date.now() + 14 * 864e5));
  const absDe = (n, j) => st.absences.find(a => sansAcc(a.person) === sansAcc(n) && String(a.start || "").slice(0, 10) <= j && String(a.end || a.start || "").slice(0, 10) >= j && compteCeJour(a, j));
  const pers = personnes();
  const absents = pers.map(n => ({ n, a: absDe(n, auj) })).filter(x => x.a);
  const presents = pers.filter(n => !absDe(n, auj));
  const aVenir = st.absences.filter(a => String(a.start || "").slice(0, 10) > auj && String(a.start || "").slice(0, 10) <= dans14)
    .sort((a, b) => String(a.start).localeCompare(String(b.start)));
  const typ = (a) => TYPES[a.type] || TYPES.conge;
  const tel = (n) => { const c = st.coord[n] || {}; const t = c.telephone || (Array.isArray(c.telephones) ? c.telephones.find(x => x.numero)?.numero : ""); return t ? `<a href="tel:${esc(String(t).replace(/[^\d+]/g, ""))}">📞 ${esc(t)}</a>` : ""; };
  conteneur.innerHTML = `<div class="stack eq">
    <div class="eq-tete"><h2>👥 Aujourd'hui</h2><span>${frJ(auj, { weekday: "long", day: "numeric", month: "long" })}</span></div>
    <section class="form-card eq-bloc eq-abs">
      <h3>🏖️ Absents <b>${absents.length}</b></h3>
      ${absents.length ? `<div class="eq-liste">${absents.map(({ n, a }) => { const [ic, lib] = typ(a), fin = String(a.end || a.start).slice(0, 10);
        return `<div class="eq-p abs"><span class="eq-ic">${ic}</span><div><b>${esc(n)}</b><small>${lib}${a.note ? ` · ${esc(a.note)}` : ""}</small></div><em>${fin === auj ? "aujourd'hui seulement" : `jusqu'au ${frJ(fin)}`}<br><small>retour ${frJ(iso(new Date(new Date(fin + "T12:00").getTime() + 864e5)))}</small></em></div>`; }).join("")}</div>`
        : `<p class="eq-ok">👷 Toute l'équipe est là aujourd'hui.</p>`}
    </section>
    <section class="form-card eq-bloc">
      <h3>✅ Présents <b>${presents.length}</b></h3>
      <div class="eq-pres">${presents.map(n => `<span class="eq-chip">${esc(n)}${tel(n) ? ` <small>${tel(n)}</small>` : ""}</span>`).join("")}</div>
    </section>
    <section class="form-card eq-bloc">
      <h3>📅 Absences des 14 prochains jours <b>${aVenir.length}</b></h3>
      ${aVenir.length ? aVenir.map(a => { const [ic, lib] = typ(a), d = String(a.start).slice(0, 10), f = String(a.end || a.start).slice(0, 10);
        return `<div class="eq-av"><span class="eq-ic">${ic}</span><b>${esc(a.person || "")}</b><span>${lib}</span><em>${d === f ? frJ(d) : `du ${frJ(d)} au ${frJ(f)}`}</em></div>`; }).join("") : `<p class="hint">Aucune absence prévue.</p>`}
    </section>
  </div>`;
}

export function mountEquipeAujourdhui(container) {
  unsubs.forEach(u => { try { u(); } catch { /* */ } }); unsubs = [];
  conteneur = container;
  container.innerHTML = `<div class="hint">Chargement…</div>`;
  unsubs.push(watchPeople((p) => { st.people = p; render(); }));
  unsubs.push(watchAbsences((a) => { st.absences = a || []; render(); }));
  unsubs.push(watchCoordonnees((c) => { st.coord = c || {}; render(); }));
}

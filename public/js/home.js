import { resolveDayN1, resolveDayN2, computeWeeklyTitulaires, YEAR_START, YEAR_END, HOLIDAYS, dateKey, esc, initials, colorForPerson } from "./astreinte-logic.js";
import { watchPeople, watchAbsences } from "./firestore-data.js";

let unsubs = [];
let people = { n1: [], n2: [] };
let absences = [];
let mountedContainer = null;
let catsRef = [];
let onSelectRef = null;

function cleanup() { unsubs.forEach(u => u()); unsubs = []; }

export function mountDashboard(container, user, categories, onSelect) {
  cleanup();
  mountedContainer = container;
  catsRef = categories;
  onSelectRef = onSelect;
  container.innerHTML = `<div class="hint">Chargement…</div>`;
  unsubs.push(watchPeople((p) => { people = p; render(user); }));
  unsubs.push(watchAbsences((a) => { absences = a; render(user); }));
}

function render(user) {
  if (!mountedContainer) return;
  const today = new Date();
  const inRange = today >= YEAR_START && today <= YEAR_END;
  const refDate = inRange ? today : YEAR_START;
  const hasPeople = people.n1.length > 0 && people.n2.length > 0;

  let n1 = null, n2 = null, holidayToday = null;
  if (hasPeople) {
    const { titN1, titN2 } = computeWeeklyTitulaires(people, absences);
    n1 = resolveDayN1(refDate, people, absences, titN1);
    n2 = resolveDayN2(refDate, people, absences, titN2);
    holidayToday = HOLIDAYS.get(dateKey(refDate));
  }

  mountedContainer.innerHTML = `
    <div class="stack">
      <div class="hero">
        <div class="hero-label">Bonjour ${esc(user.nom || user.email)}</div>
        ${hasPeople ? `
        <div class="hero-blocks">
          <div class="hero-block n1">
            <div class="avatar" style="background:${colorForPerson(n1.assigned, people)}">${n1.assigned === 'A DÉFINIR' ? '!' : initials(n1.assigned)}</div>
            <div><div class="hero-block-label">Astreinte N1 aujourd'hui</div><div class="hero-block-value">${esc(n1.assigned)}</div></div>
          </div>
          <div class="hero-block n2">
            <div class="avatar" style="background:${colorForPerson(n2.assigned, people)}">${n2.assigned === 'A DÉFINIR' ? '!' : initials(n2.assigned)}</div>
            <div><div class="hero-block-label">Astreinte N2 aujourd'hui</div><div class="hero-block-value">${esc(n2.assigned)}</div></div>
          </div>
        </div>
        ${holidayToday ? `<div style="margin-top:10px;color:var(--violet);font-size:12px">☀️ ${esc(holidayToday)}</div>` : ""}
        ` : `<p class="hint">Astreinte pas encore configurée.</p>`}
      </div>

      <div class="bubble-grid">
        ${catsRef.map(c => `
          <button class="bubble-card" data-cat="${c.id}">
            <span class="bubble-icon">${c.icon}</span>
            <span class="bubble-label">${esc(c.label)}</span>
            <span class="bubble-desc">${esc(c.desc || "")}</span>
          </button>
        `).join("")}
      </div>
    </div>
  `;

  mountedContainer.querySelectorAll("[data-cat]").forEach(btn => {
    btn.addEventListener("click", () => onSelectRef(btn.dataset.cat));
  });
}

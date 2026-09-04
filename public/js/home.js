import { resolveDayN1, resolveDayN2, computeWeeklyTitulaires, YEAR_START, YEAR_END, HOLIDAYS, dateKey, esc, initials, colorForPerson, nextHandover, addDays } from "./astreinte-logic.js";
import { watchPeople, watchAbsences } from "./firestore-data.js";
import { watchTransferts } from "./transfert-data.js";
import { transfertBannerHTML, attachTransfertListeners } from "./transfert-ui.js";

let unsubs = [];
let people = { n1: [], n2: [] };
let absences = [];
let transferts = [];
let mountedContainer = null;
let mountedUser = null;
let catsRef = [];
let onSelectRef = null;
let onReorderRef = null;
let clearCountdown = null;
let debugForce = false;
let modeReorganisation = false;

function cleanup() {
  unsubs.forEach(u => u());
  unsubs = [];
  if (clearCountdown) { clearCountdown(); clearCountdown = null; }
  modeReorganisation = false;
}

export function mountDashboard(container, user, categories, onSelect, onReorder) {
  cleanup();
  mountedContainer = container;
  mountedUser = user;
  catsRef = categories;
  onSelectRef = onSelect;
  onReorderRef = onReorder;
  container.innerHTML = `<div class="hint">Chargement…</div>`;
  unsubs.push(watchPeople((p) => { people = p; render(); }));
  unsubs.push(watchAbsences((a) => { absences = a; render(); }));
  unsubs.push(watchTransferts((t) => { transferts = t; render(); }));
}

function render() {
  if (!mountedContainer || !mountedUser) return;
  if (!document.contains(mountedContainer)) { cleanup(); return; }
  const today = new Date();
  const inRange = today >= addDays(YEAR_START, -7) && today <= addDays(YEAR_END, 7);
  const refDate = inRange ? today : YEAR_START;
  const hasPeople = people.n1.length > 0 && people.n2.length > 0;

  let n1 = null, n2 = null, holidayToday = null, next = null;
  if (hasPeople) {
    const { titN1, titN2 } = computeWeeklyTitulaires(people, absences);
    n1 = resolveDayN1(refDate, people, absences, titN1);
    n2 = resolveDayN2(refDate, people, absences, titN2);
    holidayToday = HOLIDAYS.get(dateKey(refDate));
    if (inRange) next = nextHandover(refDate, people, absences, titN1, resolveDayN1, 3);
  }
  const confirmedRecord = next ? transferts.find(t => t.id === dateKey(next.date)) : null;

  if (debugForce) { next = { from: "Test A", to: "Test B", date: refDate, daysUntil: 0 }; }

  if (clearCountdown) { clearCountdown(); clearCountdown = null; }

  mountedContainer.innerHTML = `
    <div class="stack">
      ${transfertBannerHTML(next, confirmedRecord)}

      <div class="hero">
        <div class="hero-label">Bonjour ${esc(mountedUser.nom || mountedUser.email)}</div>
        ${hasPeople ? `
        <div class="hero-blocks">
          <div class="hero-block n1">
            <div class="avatar" style="background:${colorForPerson(n1.assigned, people)}"></div>
            <div><div class="hero-block-label">Astreinte N1 aujourd'hui</div><div class="hero-block-value">${esc(n1.assigned)}</div></div>
          </div>
          <div class="hero-block n2">
            <div class="avatar" style="background:${colorForPerson(n2.assigned, people)}"></div>
            <div><div class="hero-block-label">Astreinte N2 aujourd'hui</div><div class="hero-block-value">${esc(n2.assigned)}</div></div>
          </div>
        </div>
        ${holidayToday ? `<div style="margin-top:10px;color:var(--violet);font-size:12px">☀️ ${esc(holidayToday)}</div>` : ""}
        ` : `<p class="hint">Astreinte pas encore configurée.</p>`}
      </div>

      <div class="bubble-grid">
        ${catsRef.map((c, idx) => {
          const peutReorganiser = modeReorganisation && (mountedUser.role === "admin" || mountedUser.role === "super_admin");
          return `
          <div style="position:relative;height:100%">
            <button class="bubble-card" data-cat="${c.id}">
              ${c.badgeAtelier || c.badgeSites ? `
                <span style="position:absolute;top:8px;left:8px;display:flex;gap:4px">
                  ${c.badgeAtelier ? `<span title="Alertes stock atelier" style="background:var(--red);color:#fff;border-radius:999px;min-width:20px;height:20px;padding:0 5px;font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center;line-height:1">🔧${c.badgeAtelier > 99 ? "99+" : c.badgeAtelier}</span>` : ""}
                  ${c.badgeSites ? `<span title="Alertes stock déporté (sites)" style="background:var(--orange,#e08a2e);color:#fff;border-radius:999px;min-width:20px;height:20px;padding:0 5px;font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center;line-height:1">🏢${c.badgeSites > 99 ? "99+" : c.badgeSites}</span>` : ""}
                </span>
              ` : c.badge ? `<span style="position:absolute;top:8px;left:8px;background:var(--red);color:#fff;border-radius:999px;min-width:20px;height:20px;padding:0 5px;font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center;line-height:1">${c.badge > 99 ? "99+" : c.badge}</span>` : ""}
              <span class="bubble-icon">${c.icon}</span>
              <span class="bubble-label">${esc(c.label)}</span>
              <span class="bubble-desc">${esc(c.desc || "")}</span>
            </button>
            ${peutReorganiser ? `
              <div style="position:absolute;top:6px;right:6px;display:flex;gap:2px">
                <button class="nav-btn" data-reorder-left="${c.id}" style="padding:2px 6px;font-size:10px" ${idx === 0 ? "disabled" : ""}>◀</button>
                <button class="nav-btn" data-reorder-right="${c.id}" style="padding:2px 6px;font-size:10px" ${idx === catsRef.length - 1 ? "disabled" : ""}>▶</button>
              </div>
            ` : ""}
          </div>
        `;}).join("")}
      </div>

      ${(mountedUser.role === "admin" || mountedUser.role === "super_admin") ? `
      <button class="nav-btn" id="toggle-reorg" style="width:fit-content;opacity:.7;font-size:11px">${modeReorganisation ? "✓ Terminé" : "🔧 Réorganiser les bulles"}</button>
      ` : ""}

      ${(mountedUser.role === "admin" || mountedUser.role === "super_admin") ? `
      <button class="nav-btn" id="debug-toggle" style="width:fit-content;opacity:.6;font-size:11px">🧪 ${debugForce ? "Arrêter le test du bandeau" : "Tester l'affichage du bandeau de transfert"}</button>
      ` : ""}
    </div>
  `;

  mountedContainer.querySelectorAll("[data-cat]").forEach(btn => {
    btn.addEventListener("click", () => onSelectRef(btn.dataset.cat));
  });
  mountedContainer.querySelectorAll("[data-reorder-left], [data-reorder-right]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.dataset.reorderLeft || btn.dataset.reorderRight;
      const sens = btn.dataset.reorderLeft ? -1 : 1;
      onReorderRef?.(id, sens);
    });
  });
  document.getElementById("debug-toggle")?.addEventListener("click", () => { debugForce = !debugForce; render(); });
  document.getElementById("toggle-reorg")?.addEventListener("click", () => { modeReorganisation = !modeReorganisation; render(); });

  clearCountdown = attachTransfertListeners(mountedContainer, next, mountedUser, () => render());
}

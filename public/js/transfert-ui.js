import { esc, hoursLeftToday, dateKey, fmtShort } from "./astreinte-logic.js";
import { confirmTransfert } from "./transfert-data.js";

// `next` : { from, to, date, daysUntil } — venant de nextHandover().
// `confirmedRecord` : l'enregistrement Firestore confirmé pour LA DATE DU
// TRANSFERT (next.date), pas forcément la date du jour.
export function transfertBannerHTML(next, confirmedRecord) {
  if (!next) return "";

  if (confirmedRecord) {
    const time = new Date(confirmedRecord.confirmedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    const dateLabel = new Date(confirmedRecord.confirmedAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
    return `
      <div class="alert-banner" style="border-color:var(--teal);background:rgba(63,182,172,.12)">
        ✅ <div>
          <div><b>Transfert du numéro effectué</b> — de ${esc(next.from)} vers ${esc(next.to)}</div>
          <div style="font-size:12px;color:var(--text-dim);margin-top:2px">Confirmé par ${esc(confirmedRecord.confirmedByNom)} le ${dateLabel} à ${time}</div>
        </div>
      </div>`;
  }

  const when = next.daysUntil === 0
    ? "à faire aujourd'hui"
    : `à prévoir dans ${next.daysUntil} jour${next.daysUntil > 1 ? "s" : ""} (le ${fmtShort(next.date)})`;

  return `
    <div class="alert-banner" id="transfert-banner" style="border-color:var(--red);background:rgba(229,83,61,.18)">
      🔴 <div>
        <div><b>Transfert du numéro ${when}</b> — de ${esc(next.from)} vers ${esc(next.to)}</div>
        ${next.daysUntil === 0 ? `<div style="font-size:12px;margin-top:4px" id="transfert-countdown"></div>` : ""}
        <button class="add-btn" id="transfert-confirm-btn" style="margin-top:8px">✓ J'ai fait le transfert</button>
      </div>
    </div>`;
}

// Retourne une fonction de nettoyage (à ajouter aux unsubs du module appelant)
export function attachTransfertListeners(container, next, user, onConfirmed) {
  if (!next) return () => {};
  const countdownEl = container.querySelector("#transfert-countdown");
  let interval = null;
  if (countdownEl) {
    function updateCountdown() {
      const { h, m } = hoursLeftToday();
      countdownEl.textContent = `Il reste ${h}h${String(m).padStart(2, "0")} aujourd'hui pour faire le transfert.`;
    }
    updateCountdown();
    interval = setInterval(updateCountdown, 60000);
  }

  const btn = container.querySelector("#transfert-confirm-btn");
  if (btn) {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "Enregistrement…";
      try {
        await confirmTransfert(dateKey(next.date), next.from, next.to, user);
        if (onConfirmed) onConfirmed();
      } catch (e) {
        btn.disabled = false;
        btn.textContent = "✓ J'ai fait le transfert";
        alert("Échec de l'enregistrement : " + (e.message || e));
      }
    });
  }
  return () => { if (interval) clearInterval(interval); };
}

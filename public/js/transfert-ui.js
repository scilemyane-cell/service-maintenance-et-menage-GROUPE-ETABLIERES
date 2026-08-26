import { esc, hoursLeftToday, dateKey } from "./astreinte-logic.js";
import { confirmTransfert } from "./transfert-data.js";

export function transfertBannerHTML(handover, confirmedRecord) {
  if (!handover) return "";
  if (confirmedRecord) {
    const time = new Date(confirmedRecord.confirmedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    return `
      <div class="alert-banner" style="border-color:var(--teal);background:rgba(63,182,172,.12)">
        ✅ <div>
          <div><b>Transfert du numéro effectué</b> — de ${esc(handover.from)} vers ${esc(handover.to)}</div>
          <div style="font-size:12px;color:var(--text-dim);margin-top:2px">Confirmé par ${esc(confirmedRecord.confirmedByNom)} à ${time}</div>
        </div>
      </div>`;
  }
  return `
    <div class="alert-banner" id="transfert-banner" style="border-color:var(--red);background:rgba(229,83,61,.18)">
      🔴 <div>
        <div><b>Transfert du numéro à faire aujourd'hui</b> — de ${esc(handover.from)} vers ${esc(handover.to)}</div>
        <div style="font-size:12px;margin-top:4px" id="transfert-countdown"></div>
        <button class="add-btn" id="transfert-confirm-btn" style="margin-top:8px">✓ J'ai fait le transfert</button>
      </div>
    </div>`;
}

// Retourne une fonction de nettoyage (à ajouter aux unsubs du module appelant)
export function attachTransfertListeners(container, handover, user, onConfirmed) {
  if (!handover) return () => {};
  const countdownEl = container.querySelector("#transfert-countdown");
  function updateCountdown() {
    if (!countdownEl) return;
    const { h, m } = hoursLeftToday();
    countdownEl.textContent = `Il reste ${h}h${String(m).padStart(2, "0")} aujourd'hui pour faire le transfert.`;
  }
  updateCountdown();
  const interval = setInterval(updateCountdown, 60000);

  const btn = container.querySelector("#transfert-confirm-btn");
  if (btn) {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "Enregistrement…";
      try {
        await confirmTransfert(dateKey(new Date()), handover.from, handover.to, user);
        if (onConfirmed) onConfirmed();
      } catch (e) {
        btn.disabled = false;
        btn.textContent = "✓ J'ai fait le transfert";
        alert("Échec de l'enregistrement : " + (e.message || e));
      }
    });
  }
  return () => clearInterval(interval);
}

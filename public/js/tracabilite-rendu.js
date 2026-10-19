// tracabilite-rendu.js
// Rendu partagé d'une fiche de traçabilité ménage : utilisé par l'onglet
// Traçabilité de l'appli ET par la page publique en lecture seule ouverte
// par QR code (tracabilite-guest.html), pour que les deux affichent
// exactement la même fiche.
import { fmtShort, esc } from "./astreinte-logic.js";

// Mention de reconstitution (liste et impression). La date de saisie n'est
// pas affichée dans la traçabilité (les données restent enregistrées).
export function mentionHTML(f, court = false) {
  if (f.reconstituee) return court ? `<span class="tag" style="background:#fff1d6;color:#8a5a00" title="${esc(f.reconstituee.motif || "")}">🧾 Reconstituée</span>`
    : `Fiche reconstituée a posteriori le ${fmtShort(new Date(f.reconstituee.le))}${f.reconstituee.par ? ` (ouverte par ${esc(f.reconstituee.par)})` : ""} — motif : ${esc(f.reconstituee.motif || "fiche papier disparue")}.`;
  return "";
}

const ORDRE_J = ["LUN", "MAR", "MER", "JEU", "VEN"];
const vignettes = (l0) => { const liste = [...l0].sort((a, b) => ORDRE_J.indexOf(a.jour) - ORDRE_J.indexOf(b.jour) || a.le - b.le); return `<div class="trac-photos" style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:4px 0 10px">${liste.map(p => `<figure style="margin:0;border:1px solid #bbb;border-radius:6px;padding:3px;break-inside:avoid">
  <img src="${p.data}" alt="" style="width:100%;height:130px;object-fit:cover;border-radius:4px;display:block">
  <figcaption style="font-size:9.5px;margin-top:2px">${p.jour ? `<b>${({ LUN: "LUNDI", MAR: "MARDI", MER: "MERCREDI", JEU: "JEUDI", VEN: "VENDREDI" })[p.jour] || p.jour}</b> · ` : ""}${p.legende ? `${esc(p.legende)}<br>` : ""}<span style="color:#666">📷 ${new Date(p.le).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span></figcaption></figure>`).join("")}</div>`; };

export function taskCompletion(fiche, site) {
  if (!site) return { done: 0, total: 0 };
  let done = 0, total = 0;
  (site.rooms || []).forEach((room, ri) => {
    room.tasks.forEach((task, ti) => {
      room.days.forEach(d => {
        total++;
        if (fiche.cells && fiche.cells[`${ri}-${ti}-${d}`]) done++;
      });
    });
  });
  return { done, total };
}

// Fiche complète au format imprimable (bloc .print-fiche).
// dispositif : libellé ajouté au titre (ou "" pour ne rien ajouter).
export function ficheHTML(opened, openedSite, dispositif = "") {
  const dayNames = { LUN: "LUNDI", MAR: "MARDI", MER: "MERCREDI", JEU: "JEUDI", VEN: "VENDREDI" };
  return `
      <div class="print-fiche print-trac" style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:24px;color:#111">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:18px">
          <img src="img/logo-etablieres.png" alt="Groupe Établières" style="height:60px">
        </div>
        <p style="font-size:14px;margin:0 0 6px">FICHE DE TRAÇABILITÉ – AGENT D'ENTRETIEN${dispositif ? ` (${esc(dispositif).toUpperCase()})` : ""}</p>
        <p style="font-size:13px;margin:0 0 6px">Structure : ${esc(opened.siteName).toUpperCase()}</p>
        <p style="font-size:13px;margin:0 0 18px">Date du ${fmtShort(new Date(opened.weekStart))} au ${fmtShort(new Date(opened.weekEnd))} &nbsp;&nbsp;&nbsp; Nom de l'agent : ${esc(opened.agentNom)}</p>

        ${openedSite ? (openedSite.rooms || []).map((room, ri) => `
          <div class="trac-piece">
          <p class="trac-titre" style="font-size:13px;font-weight:700;margin:16px 0 6px">${esc(room.name).toUpperCase()}</p>
          <table class="print-fiche-table" style="width:100%;border-collapse:collapse;margin-bottom:8px">
            <colgroup><col style="width:34%">${room.days.map(() => `<col style="width:${(48 / Math.max(1, room.days.length)).toFixed(2)}%">`).join("")}<col style="width:18%"></colgroup>
            <thead><tr>
              <th style="border:1px solid #999;padding:4px 6px;font-size:11px;text-align:left">TÂCHE</th>
              ${room.days.map(d => `<th style="border:1px solid #999;padding:4px 6px;font-size:11px">${dayNames[d]}</th>`).join("")}
              <th style="border:1px solid #999;padding:4px 6px;font-size:11px;text-align:left">OBSERVATIONS</th>
            </tr></thead>
            <tbody>
              ${room.tasks.map((task, ti) => `
                <tr>
                  <td style="border:1px solid #999;padding:4px 6px;font-size:11px">${esc(task.label)}${task.freq ? ` (${esc(task.freq)})` : ""}</td>
                  ${room.days.map(d => `<td class="trac-coche" style="border:1px solid #999;padding:4px 6px;font-size:12px;text-align:center;font-weight:700">${(opened.cells && opened.cells[`${ri}-${ti}-${d}`]) ? "✓" : ""}</td>`).join("")}
                  <td style="border:1px solid #999;padding:4px 6px;font-size:11px">${esc((opened.obs && opened.obs[`${ri}-${ti}`]) || "")}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>${(() => { const ph = (opened.photos || []).filter(p => p.piece === room.name); return ph.length ? vignettes(ph) : ""; })()}</div>`).join("") : ""}

        ${opened.chambres && opened.chambres.length ? `
        <p style="font-size:13px;font-weight:700;margin:16px 0 6px">LITERIE SUR DEMANDE</p>
        <table class="print-fiche-table" style="width:100%;border-collapse:collapse;margin-bottom:8px">
          <thead><tr>
            <th style="border:1px solid #999;padding:4px 6px;font-size:11px;text-align:left">CHAMBRE</th>
            <th style="border:1px solid #999;padding:4px 6px;font-size:11px;text-align:left">DATE</th>
            <th style="border:1px solid #999;padding:4px 6px;font-size:11px;text-align:left">OBSERVATIONS</th>
          </tr></thead>
          <tbody>
            ${opened.chambres.map(c => `
              <tr>
                <td style="border:1px solid #999;padding:4px 6px;font-size:11px">${esc(c.chambre)}</td>
                <td style="border:1px solid #999;padding:4px 6px;font-size:11px">${c.date ? fmtShort(new Date(c.date)) : ""}</td>
                <td style="border:1px solid #999;padding:4px 6px;font-size:11px">${esc(c.observation)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>` : ""}

        <p style="font-size:12px;margin-top:16px">OBSERVATIONS GÉNÉRALES : ${esc(opened.observationsGenerales || "")}</p>
        ${(() => { const noms = new Set(((openedSite && openedSite.rooms) || []).map(r => r.name)); const autres = (opened.photos || []).filter(p => !p.piece || !noms.has(p.piece));
          return autres.length ? `<div class="trac-photos"><p style="font-size:13px;font-weight:700;margin:16px 0 6px">AUTRES PHOTOS</p>${vignettes(autres)}</div>` : ""; })()}
        ${mentionHTML(opened) ? `<p style="font-size:9px;margin-top:28px;color:#777">${mentionHTML(opened)}</p>` : ""}
      </div>`;
}

// Impression d'une fiche en A4 portrait (le reste de l'appli imprime en paysage).
export function imprimerFiche(avecPhotos = true) {
  const st = document.createElement("style");
  st.textContent = "@page{size:A4 portrait;margin:9mm 9mm 11mm 9mm}" + (avecPhotos ? "" : "@media print{.trac-photos{display:none !important}}");
  document.head.appendChild(st);
  const fin = () => { st.remove(); window.removeEventListener("afterprint", fin); };
  window.addEventListener("afterprint", fin);
  window.print();
  setTimeout(fin, 60000);
}

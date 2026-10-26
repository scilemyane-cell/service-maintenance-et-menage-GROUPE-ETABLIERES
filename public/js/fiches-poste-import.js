// fiches-poste-import.js — Reprise des fiches de poste faites AVANT l'appli :
// on lit le PDF (ou le Word) du formulaire RH 05 et on remplit les champs
// (collaborateur, périmètre, mission principale, missions + niveau N1/N2,
// savoir-faire, savoirs-être, délégations, date).
export const PDFJS = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.min.mjs";
export const PDFJS_WORKER = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.worker.min.mjs";
export const MAMMOTH = "https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js";

const ENTETE = /^(Date création|Code\s*:|Type\s*:|Destinataire|Date MAJ|Dernière\(s\) modification|principale$|Page \d+ sur \d+|Délégation de décision|Sur la base de la|intégrative du groupe|Niveau 1|Niveau 2|Délégation$|totale$|Partage$|d.intention$|MISSIONS$)/i;
const nettoie = (t) => String(t || "").replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();

// ---------- Lecture des lignes ----------
async function lignesPDF(buf) {
  const pdfjs = await import(/* @vite-ignore */ PDFJS);
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  const pdf = await pdfjs.getDocument({ data: buf }).promise, out = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n), vp = page.getViewport({ scale: 1 }), tc = await page.getTextContent();
    const items = tc.items.filter(i => i.str && i.str.trim()).map(i => ({ s: i.str, x: i.transform[4] / vp.width, y: Math.round(vp.height - i.transform[5]) }));
    const parY = [];
    items.sort((a, b) => a.y - b.y || a.x - b.x).forEach(i => { const l = parY.find(l => Math.abs(l.y - i.y) <= 3); if (l) l.items.push(i); else parY.push({ y: i.y, items: [i] }); });
    parY.forEach(l => {
      l.items.sort((a, b) => a.x - b.x);
      // « X » dans les colonnes de droite = niveau de délégation.
      const xs = l.items.filter(i => /^X$/i.test(i.s.trim()) && i.x > 0.68);
      const texte = nettoie(l.items.filter(i => !xs.includes(i)).map(i => i.s).join(" "));
      out.push({ t: texte, niveau: xs.length ? (xs[0].x < 0.80 ? 1 : 2) : 0 });
    });
  }
  return { lignes: out.filter(l => l.t || l.niveau), table: null };
}

async function lignesDOCX(buf) {
  const mammoth = await window.chargerLib?.("mammoth"); if (!mammoth) throw new Error("Lecture Word indisponible");
  const { value } = await mammoth.convertToHtml({ arrayBuffer: buf });
  const d = document.createElement("div"); d.innerHTML = value;
  // Tableau des missions : 1re colonne = mission, puis N1, N2.
  let table = null;
  d.querySelectorAll("table").forEach(t => {
    const rows = [...t.querySelectorAll("tr")].map(r => [...r.children].map(c => c));
    if (!rows.some(r => /délégation|niveau/i.test(r.map(c => c.textContent).join(" ")))) return;
    table = [];
    rows.forEach(r => {
      if (r.length < 3) return;
      const c0 = r[0], n1 = /x/i.test(r[r.length - 2].textContent), n2 = /x/i.test(r[r.length - 1].textContent);
      const titre = nettoie([...c0.childNodes].filter(n => n.nodeName !== "UL" && n.nodeName !== "OL").map(n => n.textContent).join(" "));
      if (!titre || ENTETE.test(titre) || /^missions$/i.test(titre)) return;
      const sous = [...c0.querySelectorAll("li")].map(li => nettoie(li.textContent)).filter(Boolean);
      table.push({ texte: titre, niveau: n2 && !n1 ? 2 : 1, sous });
    });
    t.remove();
  });
  const lignes = [...d.querySelectorAll("p, li, h1, h2, h3")].filter(p => !p.closest("li") || p.tagName === "LI").map(p => ({ t: (p.tagName === "LI" ? "- " : "") + nettoie(p.textContent), niveau: 0 })).filter(l => l.t && l.t !== "- ");
  return { lignes, table };
}

// ---------- Interprétation ----------
const oui = (t, lib) => { const m = t.match(new RegExp(lib + "\\s*:?\\s*([☐☒■□✓✔xX])\\s*oui\\s*([☐☒■□✓✔xX])\\s*non", "i")); return m ? /[☒■✓✔xX]/.test(m[1]) && !/[☒■✓✔xX]/.test(m[2]) : null; };

export function interpreter({ lignes, table }) {
  const L = lignes.filter(l => !ENTETE.test(l.t));
  const tout = L.map(l => l.t).join("\n");
  const cherche = (re) => { const m = tout.match(re); return m ? nettoie(m[1]) : ""; };
  const f = { modele: "import", importee: true };
  f.collaborateur = cherche(/Prénom NOM\s*:\s*(.+)/i);
  const iTitre = L.findIndex(l => /^Fiche de poste$/i.test(l.t));
  f.poste = iTitre >= 0 ? L[iTitre + 1]?.t || "" : "";
  f.association = cherche(/Association de rattachement\s*:\s*(.+?)(?:\s+Convention collective|\n|$)/i);
  f.convention = cherche(/Convention collective\s*:\s*(.+)/i) || "OEFMT";
  f.residence = cherche(/Résidence administrative principale\s*:\s*(.+)/i);
  f.multisite = !!oui(tout, "Poste en multisites");
  const second = cherche(/second site de travail\s*:\s*(.+)/i);
  f.secondSite = /choisissez/i.test(second) ? "" : second;
  f.teletravail = !!oui(tout, "Poste télétravaillable");
  f.management = !!oui(tout, "management d.équipe");
  f.manager = cherche(/Manager direct du collaborateur\s*:\s*(.+)/i);
  const entre = (deb, fin) => { const a = L.findIndex(l => deb.test(l.t)); if (a < 0) return []; const b = L.findIndex((l, i) => i > a && fin.test(l.t)); return L.slice(a + 1, b < 0 ? undefined : b); };
  f.principale = nettoie(entre(/^MISSION PRINCIPALE DU POSTE/i, /^MISSIONS DU POSTE/i).map(l => l.t).join(" "));
  // Missions
  if (table) f.missions = table;
  else {
    const zone = entre(/^MISSIONS DU POSTE/i, /^Compétences attendues/i);
    const debut = zone.findIndex(l => /remise\.?$/i.test(l.t));
    const ms = []; let cur = null;
    zone.slice(debut + 1).forEach(l => {
      const t = l.t.replace(/^[-•➢▪►\-–]\s*/, (m) => (m ? "§" : ""));
      if (t.startsWith("§")) { if (cur) cur.sous.push(t.slice(1).trim()); }
      else if (t) {
        if (!cur || /^[A-ZÀÂÉÈÊÎÔÛÇ]/.test(t)) { cur = { texte: t, niveau: 0, sous: [] }; ms.push(cur); }
        else if (cur.sous.length) cur.sous[cur.sous.length - 1] += " " + t; else cur.texte += " " + t;
      }
      if (l.niveau && cur && !cur.niveau) cur.niveau = l.niveau;
    });
    f.missions = ms.filter(m => !/délégation.*partage|totale.*intention/i.test(m.texte)).map(m => ({ ...m, niveau: m.niveau || 1 }));
  }
  const liste = (deb, fin) => entre(deb, fin).map(l => l.t).reduce((a, t) => { if (/^[-–•]/.test(t)) a.push(t.replace(/^[-–•]\s*/, "")); else if (a.length) a[a.length - 1] += " " + t; return a; }, []).map(nettoie).filter(Boolean);
  f.savoirFaire = liste(/^Savoir-faire/i, /^Savoirs?-être/i);
  f.savoirEtre = liste(/^Savoirs?-être/i, /^DELEGATION/i);
  f.signatureNonConcerne = /[☒■✓✔]\s*Poste non concerné par les délégations/i.test(tout);
  const sig = entre(/^DELEGATION/i, /Poste non concerné|La présente fiche/i).map(l => l.t).filter(t => !/^Listez ici|^responsabilité|signature par délégation|responsabilité finale/i.test(t));
  f.signatures = sig.join("\n");
  const d = tout.match(/établie le\s*:?\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*(?:par\s*(.+?))?\.?\s*$/im);
  if (d) { const an = d[3].length === 2 ? "20" + d[3] : d[3]; f.etablieLe = `${an}-${d[2].padStart(2, "0")}-${d[1].padStart(2, "0")}`; f.etabliePar = nettoie(d[4] || "le manager").replace(/\.$/, ""); }
  else { f.etablieLe = ""; f.etabliePar = "le manager"; }
  const maj = tout.match(/Date MAJ\s*:\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})/i);
  if (maj) f.dateMaj = `${maj[3].length === 2 ? "20" + maj[3] : maj[3]}-${maj[2].padStart(2, "0")}-${maj[1].padStart(2, "0")}`;
  return f;
}

export async function lireFicheExistante(file) {
  const buf = await file.arrayBuffer();
  const brut = /\.docx$/i.test(file.name) ? await lignesDOCX(buf) : await lignesPDF(buf);
  // Les en-têtes « Date MAJ » sont filtrés plus tard : on les relit ici.
  const f = interpreter(brut);
  const majLigne = brut.lignes.map(l => l.t).join("\n").match(/Date MAJ\s*:\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})/i);
  if (majLigne) f.dateMaj = `${majLigne[3].length === 2 ? "20" + majLigne[3] : majLigne[3]}-${majLigne[2].padStart(2, "0")}-${majLigne[1].padStart(2, "0")}`;
  f.fichierOrigine = file.name;
  return f;
}

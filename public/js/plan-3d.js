// plan-3d.js — « 🧊 Vue 3D » du plan des clés : les étages d'un bâtiment empilés en
// maquette holographique (sous-sol → R+2), qu'on fait tourner à la souris / au doigt.
// Les repères de clés deviennent des épingles debout ; le filtre par clé les allume
// sur tous les étages à la fois. Aucune librairie : CSS 3D + canvas.
import { esc } from "./astreinte-logic.js";

const sa = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const COULEURS = { rouge: "#ff4d5e", bleu: "#4da3ff", vert: "#3ddc84", orange: "#ffb020" };
const triCode = (a, b) => String(a).localeCompare(String(b), "fr", { numeric: true });

export function niveauDe(titre) {
  const s = sa(titre);
  if (/sous.?sol/.test(s)) return -1;
  if (/\brdc\b|rez.de.chaussee/.test(s)) return 0;
  const m = s.match(/r\s*\+\s*(\d)/); return m ? +m[1] : null;
}
const prefixe = (titre) => sa(titre).replace(/sous.?sol|\brdc\b|rez.de.chaussee|r\s*\+\s*\d/g, " ").replace(/^plan\s+/, "").replace(/[-–\s]+/g, " ").trim();
const nomNiveau = (n) => n < 0 ? "Sous-sol" : n === 0 ? "RDC" : `R+${n}`;
// Groupes d'étages d'un même bâtiment (au moins 2 niveaux), le plus complet d'abord.
export function groupesEtages(pages) {
  const g = {};
  pages.forEach(p => { const n = niveauDe(p.titre); if (n === null) return; const k = prefixe(p.titre) || "ensemble"; (g[k] = g[k] || []).push({ ...p, niv: n }); });
  const joli = (k, l) => { if (/^ensemble$/.test(k)) return "Ensemble du site";
    const t = String(l[0].titre || "").replace(/sous.?sol|\brdc\b|rez.de.chauss[ée]e|r\s*\+\s*\d/gi, " ").replace(/^plan\s+/i, "").replace(/\s*[-–]\s*(?=\s|$)/g, " ").replace(/\s+/g, " ").trim();
    return (t || k).replace(/^./, c => c.toUpperCase()).replace(/^Batiment/, "Bâtiment"); };
  return Object.entries(g).map(([k, l]) => ({ cle: k, nom: joli(k, l), etages: l.sort((a, b) => a.niv - b.niv) }))
    .filter(x => x.etages.length >= 2).sort((a, b) => (b.cle === "ensemble") - (a.cle === "ensemble") || b.etages.length - a.etages.length || a.nom.localeCompare(b.nom));
}

// Image → zone utile (sans cartouche) + version « hologramme » (traits lumineux, fond transparent).
const chargerImg = (src) => new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = src; });
function zoneUtile(img) {
  const w = 420, h = Math.round(img.height * w / img.width), c = document.createElement("canvas"); c.width = w; c.height = h;
  const x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(img, 0, 0, w, h); const d = x.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let y = 0; y < h; y++) for (let i = 0; i < w; i++) {
    const fx = i / w, fy = y / h;
    if (fy < 0.09 || fy > 0.86 || (fx < 0.3 && fy > 0.7) || (fx > 0.75 && fy < 0.16) || fx < 0.02 || fx > 0.98) continue;
    const k = (y * w + i) * 4; if (d[k] + d[k + 1] + d[k + 2] < 600) { if (i < x0) x0 = i; if (i > x1) x1 = i; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 <= x0 || y1 <= y0) return { x: 0, y: 0, w: 1, h: 1 };
  const m = 0.012; return { x: Math.max(0, x0 / w - m), y: Math.max(0, y0 / h - m), w: Math.min(1, (x1 - x0) / w + 2 * m), h: Math.min(1, (y1 - y0) / h + 2 * m) };
}
// Texture d'un étage : « clair » (traits foncés, fond blanc) ou « holo » (traits lumineux, fond transparent).
// Les traits sont épaissis d'un pixel pour rester lisibles en perspective.
function texture(img, z, style) {
  const sx = z.x * img.width, sy = z.y * img.height, sw = z.w * img.width, sh = z.h * img.height;
  const W = Math.min(2400, Math.round(sw)), H = Math.round(sh * W / sw);
  const c = document.createElement("canvas"); c.width = W; c.height = H; const x = c.getContext("2d", { willReadFrequently: true });
  x.drawImage(img, sx, sy, sw, sh, 0, 0, W, H);
  const id = x.getImageData(0, 0, W, H), d = id.data, a0 = new Uint8ClampedArray(W * H);
  for (let p = 0, k = 0; p < W * H; p++, k += 4) {
    const px = p % W, py = (p / W) | 0, fx = z.x + px / W * z.w, fy = z.y + py / H * z.h;
    if ((fx < 0.3 && fy > 0.7) || (fx > 0.75 && fy < 0.16) || fy > 0.86) continue;
    const l = d[k] * 0.3 + d[k + 1] * 0.59 + d[k + 2] * 0.11; a0[p] = Math.max(0, Math.min(255, (240 - l) * 1.9));
  }
  const [R, G, B] = style === "holo" ? [140, 235, 255] : [12, 38, 66];
  for (let y = 0; y < H; y++) for (let xx = 0; xx < W; xx++) {
    const p = y * W + xx; let a = a0[p];
    if (xx > 0 && a0[p - 1] > a) a = a0[p - 1]; if (xx < W - 1 && a0[p + 1] > a) a = a0[p + 1];
    if (y > 0 && a0[p - W] > a) a = a0[p - W]; if (y < H - 1 && a0[p + W] > a) a = a0[p + W];
    const k = p * 4; d[k] = R; d[k + 1] = G; d[k + 2] = B; d[k + 3] = a;
  }
  x.putImageData(id, 0, 0); return c.toDataURL("image/png");
}

export async function ouvrirVue3D({ titre, groupes, reperes, filtre = "", charger, onPlat }) {
  if (!document.getElementById("p3-style")) document.head.insertAdjacentHTML("beforeend", STYLE);
  const st = { g: 0, rx: 50, rz: -28, zoom: 1, zoom0: 1, ecart: 230, auto: true, focus: null, filtre, sel: null };
  const fond = document.createElement("div"); fond.className = "p3";
  fond.innerHTML = `<div class="p3-ciel"></div>
    <header class="p3-h"><b>🧊 ${esc(titre)}</b><span class="p3-sous">Maquette 3D · glisse pour tourner · molette pour zoomer</span>
      <div class="p3-hb"><select data-g>${groupes.map((g, i) => `<option value="${i}">${esc(g.nom)} (${g.etages.length} niveaux)</option>`).join("")}</select>
      <select data-f></select><button data-dessus>⬆ Vue de dessus</button><button data-auto>⏸ Rotation</button><label class="p3-ec">Éclater <input type="range" min="60" max="480" value="${st.ecart}" data-ecart></label><button data-x>✕ Fermer la 3D</button></div></header>
    <aside class="p3-niv"></aside>
    <div class="p3-vue"><div class="p3-stage"></div><div class="p3-load">⏳ Construction de la maquette…</div></div>
    <div class="p3-info" hidden></div>`;
  document.body.appendChild(fond);
  const $ = (s) => fond.querySelector(s), stage = $(".p3-stage"), vue = $(".p3-vue");
  let raf = 0, vivant = true;
  const fermer = () => { vivant = false; cancelAnimationFrame(raf); fond.remove(); document.removeEventListener("keydown", clavier); };
  const clavier = (e) => { if (e.key === "Escape") fermer(); };
  document.addEventListener("keydown", clavier);
  $("[data-x]").onclick = fermer;

  const W = 1000; let etages = [];
  function appliquer() {
    stage.style.transform = `scale(${st.zoom}) rotateX(${st.rx}deg) rotateZ(${st.rz}deg)`;
    stage.style.setProperty("--rx", st.rx + "deg"); stage.style.setProperty("--rz", st.rz + "deg");
  }
  function camera(rx, rz, zoom) {
    stage.classList.add("anim"); st.rx = rx; st.rz = rz; if (zoom) st.zoom = zoom; appliquer();
    clearTimeout(camera.t); camera.t = setTimeout(() => stage.classList.remove("anim"), 900);
  }
  function focaliser(n) {
    st.focus = n; st.auto = false; $("[data-auto]").textContent = "▶ Rotation"; placerEtages();
    // Étage mis en avant : version « plan papier » (fond blanc, traits foncés) pour une lecture nette.
    etages.forEach(et => { const im = et.el.querySelector("img"); if (!im || !et.img) return; const plein = et.n === n;
      if (plein && !et.clair) et.clair = texture(et.img, et.z, "clair"); if (!et.holo) et.holo = im.src;
      im.src = plein ? et.clair : et.holo; et.el.classList.toggle("plein", plein); });
    if (n === null) camera(50, -28, st.zoom0); else camera(14, 0, st.zoom0 * 1.35);
  }
  function placerEtages() {
    const n = etages.length, base = etages[0]?.niv ?? 0;
    etages.forEach((e, i) => { e.el.style.transform = `translate(-50%,-50%) translateZ(${(i - (n - 1) / 2) * st.ecart}px)`;
      e.el.classList.toggle("terne", st.focus !== null && st.focus !== e.n); e.el.classList.toggle("focus", st.focus === e.n); });
    void base;
  }
  function filtreOptions() {
    const m = {}; const ns = new Set(groupes[st.g].etages.map(e => e.n));
    reperes.filter(r => ns.has(r.p)).forEach(r => { m[r.c] = (m[r.c] || 0) + 1; });
    $("[data-f]").innerHTML = `<option value="">🔑 Toutes les clés</option>${Object.keys(m).sort(triCode).map(c => `<option value="${esc(c)}" ${c === st.filtre ? "selected" : ""}>${esc(c)} — ${m[c]} porte${m[c] > 1 ? "s" : ""}</option>`).join("")}`;
    if (st.filtre && !m[st.filtre]) st.filtre = "";
  }
  function dessinerEpingles() {
    etages.forEach(e => {
      const l = reperes.filter(r => r.p === e.n).map(r => ({ ...r, fx: (r.x - e.z.x) / e.z.w, fy: (r.y - e.z.y) / e.z.h })).filter(r => r.fx >= 0 && r.fx <= 1 && r.fy >= 0 && r.fy <= 1);
      e.pins.innerHTML = l.map(r => { const on = st.filtre && r.c === st.filtre, off = st.filtre && r.c !== st.filtre;
        return `<div class="p3-pin ${on ? "on" : ""} ${off ? "off" : ""}" data-r="${r.id}" style="left:${r.fx * 100}%;top:${r.fy * 100}%;--k:${COULEURS[r.col] || COULEURS.rouge}"><span>${esc(r.c)}</span><i></i></div>`; }).join("");
      const nb = st.filtre ? l.filter(r => r.c === st.filtre).length : l.length;
      fond.querySelector(`[data-niv="${e.n}"] em`)?.replaceChildren(document.createTextNode(nb ? `${nb} 🔑` : ""));
    });
  }
  async function construire() {
    $(".p3-load").hidden = false; stage.innerHTML = ""; etages = []; st.focus = null; st.sel = null; $(".p3-info").hidden = true;
    const g = groupes[st.g]; filtreOptions();
    $(".p3-niv").innerHTML = [...g.etages].reverse().map(e => `<button data-niv="${e.n}"><b>${nomNiveau(e.niv)}</b><em></em></button>`).join("") + `<button data-tous class="p3-tous">Tous les niveaux</button>`;
    const imgs = await Promise.all(g.etages.map(e => charger(e.n).then(src => src ? chargerImg(src) : null).catch(() => null)));
    if (!vivant) return;
    // Même cadrage pour tous les niveaux (plans superposables).
    const zs = imgs.map(i => i ? zoneUtile(i) : null).filter(Boolean);
    const z = zs.length ? { x: Math.min(...zs.map(a => a.x)), y: Math.min(...zs.map(a => a.y)) } : { x: 0, y: 0 };
    z.w = zs.length ? Math.max(...zs.map(a => a.x + a.w)) - z.x : 1; z.h = zs.length ? Math.max(...zs.map(a => a.y + a.h)) - z.y : 1;
    const ratio = imgs[0] ? (z.h * imgs[0].height) / (z.w * imgs[0].width) : 0.7, H = Math.round(W * ratio);
    g.etages.forEach((e, i) => {
      const el = document.createElement("div"); el.className = "p3-etage"; el.style.width = W + "px"; el.style.height = H + "px";
      el.innerHTML = `${imgs[i] ? `<img src="${texture(imgs[i], z, "holo")}" alt="">` : ""}<div class="p3-nom">${nomNiveau(e.niv)}</div><div class="p3-pins"></div>`;
      el.dataset.n = e.n; stage.appendChild(el);
      etages.push({ n: e.n, niv: e.niv, el, pins: el.querySelector(".p3-pins"), z, img: imgs[i] });
    });
    placerEtages(); dessinerEpingles(); appliquer(); $(".p3-load").hidden = true;
    // Entrée : les étages s'écartent.
    const fin = st.ecart; st.ecart = 0; placerEtages(); requestAnimationFrame(() => requestAnimationFrame(() => { st.ecart = fin; placerEtages(); }));
  }
  function infoPin(id) {
    const r = reperes.find(x => x.id === id); const box = $(".p3-info"); if (!r) { box.hidden = true; return; }
    const e = groupes[st.g].etages.find(x => x.n === r.p), tous = reperes.filter(x => x.c === r.c);
    box.hidden = false;
    box.innerHTML = `<b style="color:${COULEURS[r.col] || COULEURS.rouge}">🔑 ${esc(r.c)}</b>${r.note ? `<span>${esc(r.note)}</span>` : ""}<span>${e ? nomNiveau(e.niv) + " · " : ""}${tous.length} porte${tous.length > 1 ? "s" : ""} avec cette clé</span>
      <div><button data-allumer>Allumer toutes ses portes</button><button data-plat>Voir à plat ›</button><button data-fi>✕</button></div>`;
    box.querySelector("[data-allumer]").onclick = () => { st.filtre = r.c; filtreOptions(); dessinerEpingles(); };
    box.querySelector("[data-plat]").onclick = () => { fermer(); onPlat?.(r.p, st.filtre); };
    box.querySelector("[data-fi]").onclick = () => { box.hidden = true; };
  }

  // Interactions
  $("[data-g]").onchange = (e) => { st.g = +e.target.value; construire(); };
  $("[data-f]").onchange = (e) => { st.filtre = e.target.value; dessinerEpingles(); };
  $("[data-dessus]").onclick = () => { st.auto = false; $("[data-auto]").textContent = "▶ Rotation"; camera(0, 0); };
  $("[data-auto]").onclick = (e) => { st.auto = !st.auto; e.target.textContent = st.auto ? "⏸ Rotation" : "▶ Rotation"; };
  $("[data-ecart]").oninput = (e) => { st.ecart = +e.target.value; placerEtages(); };
  $(".p3-niv").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.tous !== undefined) { focaliser(null); return; }
    const n = +b.dataset.niv; if (st.focus === n) { fermer(); onPlat?.(n, st.filtre); return; }
    focaliser(n); window.toast?.("Clique encore sur l'étage (à gauche) pour l'ouvrir à plat");
  });
  const pts = new Map(); let g0 = null;
  vue.addEventListener("pointerdown", (e) => { vue.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); st.auto = false; $("[data-auto]").textContent = "▶ Rotation";
    if (pts.size === 2) { const [a, b] = [...pts.values()]; g0 = { pinch: Math.hypot(a.x - b.x, a.y - b.y) }; } else g0 = { x: e.clientX, y: e.clientY, rx: st.rx, rz: st.rz, bouge: false, pin: e.target.closest(".p3-pin")?.dataset.r }; });
  vue.addEventListener("pointermove", (e) => { if (!pts.has(e.pointerId) || !g0) return; pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (g0.pinch && pts.size === 2) { const [a, b] = [...pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y); st.zoom = Math.max(0.3, Math.min(3, st.zoom * d / g0.pinch)); g0.pinch = d; appliquer(); return; }
    const dx = e.clientX - g0.x, dy = e.clientY - g0.y; if (Math.abs(dx) + Math.abs(dy) > 4) g0.bouge = true;
    st.rz = g0.rz + dx * 0.35; st.rx = Math.max(0, Math.min(82, g0.rx - dy * 0.25)); appliquer(); });
  const finPt = (e) => { if (!pts.has(e.pointerId)) return; pts.delete(e.pointerId); const g = g0; if (pts.size) return; g0 = null;
    if (g && !g.pinch && !g.bouge) { if (g.pin) infoPin(g.pin); else { const et = e.target.closest(".p3-etage"); if (et) { const n = +et.dataset.n; focaliser(st.focus === n ? null : n); } } } };
  vue.addEventListener("pointerup", finPt); vue.addEventListener("pointercancel", finPt);
  vue.addEventListener("wheel", (e) => { e.preventDefault(); st.zoom = Math.max(0.3, Math.min(3, st.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1))); appliquer(); }, { passive: false });
  const ajusterZoom = () => { const r = vue.getBoundingClientRect(); st.zoom = st.zoom0 = Math.min(1.2, Math.max(0.35, Math.min(r.width / 1500, r.height / 1150))); appliquer(); };
  const boucle = () => { if (!vivant) return; if (st.auto) { st.rz += 0.06; appliquer(); } raf = requestAnimationFrame(boucle); };
  ajusterZoom(); boucle(); await construire();
}

const STYLE = `<style id="p3-style">
.p3{position:fixed;inset:0;z-index:6500;background:radial-gradient(ellipse at 50% 60%,#0d2238 0%,#050b14 70%);color:#dff6ff;display:flex;flex-direction:column;font-family:system-ui,sans-serif;overflow:hidden}
.p3-ciel{position:absolute;inset:0;background-image:linear-gradient(rgba(80,200,255,.06) 1px,transparent 1px),linear-gradient(90deg,rgba(80,200,255,.06) 1px,transparent 1px);background-size:44px 44px;mask-image:radial-gradient(ellipse at 50% 70%,#000 20%,transparent 75%);pointer-events:none}
.p3-h{position:relative;z-index:3;display:flex;align-items:center;gap:12px;padding:10px 16px;flex-wrap:wrap;background:linear-gradient(#050b14,transparent)}
.p3-h b{max-width:38vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:17px;letter-spacing:.02em;text-shadow:0 0 12px rgba(120,225,255,.6)}.p3-sous{font-size:12px;color:#7fb3cc}
.p3-hb{margin-left:auto;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.p3-hb select,.p3-hb button,.p3-niv button,.p3-info button{background:rgba(40,120,170,.18);color:#dff6ff;border:1px solid rgba(120,225,255,.35);border-radius:9px;padding:6px 11px;font:inherit;font-size:13px;cursor:pointer;backdrop-filter:blur(6px)}
.p3-hb select option{background:#0b1a2a}.p3-hb button:hover,.p3-niv button:hover,.p3-info button:hover{background:rgba(80,190,255,.3)}
.p3-ec{display:flex;align-items:center;gap:6px;font-size:12.5px;color:#9fd3ea}.p3-ec input{accent-color:#5fd4ff;width:110px}
.p3-niv{position:absolute;left:16px;top:50%;transform:translateY(-50%);z-index:3;display:flex;flex-direction:column;gap:8px}
.p3-niv button{display:flex;flex-direction:column;align-items:flex-start;min-width:96px;padding:8px 12px}.p3-niv b{font-size:15px}.p3-niv em{font-style:normal;font-size:11.5px;color:#ffb3bb;min-height:14px}.p3-niv .p3-tous{font-size:12px;opacity:.8}
.p3-vue{flex:1;position:relative;perspective:2400px;perspective-origin:50% 40%;touch-action:none;cursor:grab}.p3-vue:active{cursor:grabbing}
.p3-stage{position:absolute;left:50%;top:52%;width:0;height:0;transform-style:preserve-3d;--rx:58deg;--rz:-28deg}
.p3-etage{position:absolute;left:0;top:0;transform-style:preserve-3d;transition:transform .9s cubic-bezier(.2,.8,.2,1),opacity .4s;border:1.5px solid rgba(120,225,255,.55);background:linear-gradient(135deg,rgba(30,110,170,.16),rgba(10,40,70,.08));box-shadow:0 0 30px rgba(80,200,255,.18),inset 0 0 40px rgba(80,200,255,.08);border-radius:6px}
.p3-etage img{position:absolute;inset:0;width:100%;height:100%;filter:drop-shadow(0 0 2px rgba(120,225,255,.9));pointer-events:none}
.p3-etage.terne{opacity:0;pointer-events:none}.p3-stage.anim{transition:transform .85s cubic-bezier(.2,.8,.2,1)}
.p3-etage.plein{background:#f7fafd;border:2px solid #4da3ff;box-shadow:0 0 50px rgba(77,163,255,.45)}.p3-etage.plein img{filter:none}.p3-etage.plein .p3-pin span{background:#fff;box-shadow:0 2px 6px rgba(0,0,0,.35)}.p3-etage.plein .p3-pin.on span{background:var(--k);color:#fff}.p3-etage.focus{border-color:#7fe8ff;box-shadow:0 0 60px rgba(80,210,255,.45),inset 0 0 60px rgba(80,210,255,.15)}
.p3-nom{position:absolute;left:-8px;top:-8px;transform:translate(-100%,-100%);font-size:34px;font-weight:800;color:rgba(160,235,255,.9);text-shadow:0 0 14px rgba(80,200,255,.8);white-space:nowrap}
.p3-pins{position:absolute;inset:0;transform-style:preserve-3d}
.p3-pin{position:absolute;width:80px;height:64px;margin-left:-40px;margin-top:-64px;transform-origin:50% 100%;transform:rotateZ(calc(var(--rz) * -1)) rotateX(calc(var(--rx) * -1));display:flex;flex-direction:column;align-items:center;justify-content:flex-end;cursor:pointer;transform-style:preserve-3d}
.p3-pin span{background:rgba(6,14,24,.85);color:var(--k);border:1.5px solid var(--k);border-radius:5px;padding:1px 6px;font:800 15px/1.2 system-ui;white-space:nowrap;box-shadow:0 0 10px color-mix(in srgb,var(--k) 60%,transparent)}
.p3-pin i{width:2px;flex:1;background:linear-gradient(var(--k),transparent);box-shadow:0 0 6px var(--k)}
.p3-pin.off{opacity:.1}.p3-pin.on span{background:var(--k);color:#fff;transform:scale(1.35);box-shadow:0 0 22px var(--k)}.p3-pin.on i{width:3px}
.p3-load{position:absolute;inset:0;display:grid;place-items:center;font-size:16px;color:#9fd3ea}.p3-load[hidden]{display:none}
.p3-info{position:absolute;right:16px;bottom:16px;z-index:4;background:rgba(6,16,28,.88);border:1px solid rgba(120,225,255,.4);border-radius:14px;padding:12px 14px;display:flex;flex-direction:column;gap:6px;min-width:240px;box-shadow:0 0 30px rgba(80,200,255,.2);font-size:13.5px}
.p3-info[hidden]{display:none}.p3-info span{color:#9fc7da}.p3-info div{display:flex;gap:6px;flex-wrap:wrap}
@media (max-width:700px){.p3-niv{top:auto;bottom:12px;transform:none;flex-direction:row;flex-wrap:wrap;right:12px}.p3-niv button{min-width:0}.p3-sous{display:none}}
</style>`;

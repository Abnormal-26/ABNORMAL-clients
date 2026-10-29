/**
 * Ryde: Drop Shot — a merge-physics puzzle (the watermelon-game format) inside a giant Ryde bottle.
 * Drop the day's moments in; two of the same touch and become the next one up:
 *   Energy > Focus > Exercise > Relax > Sleep > Ryde: coin > Rhythm > Your Day, and two Your Days
 *   make "Wellbeing In One Shot." (both vanish, big bonus). Anything resting over the fill line for
 *   2 s caps the bottle and ends the run.
 *
 * QC hooks — window.__game (bottle units: interior is 10 wide × 14 deep, y grows downward,
 * y = 0 is the mouth, the fill line is at y = 1.6):
 *   state()          → { phase, score, pieces, highestTier, overLineTime, merges, bestChain, combo, drops,
 *                         current, next, discovered[], asleep, maxOverlap, seed, time, wellbeing, dpr }
 *                       (highestTier 9 = a Wellbeing; dpr drops below 2 if dynamic resolution kicked in)
 *   start()          start a run without the Play tap (music stays off until a real tap)
 *   setSeed(n)       deterministic piece sequence and fill()/spawn() positions from here on
 *   spawn(tier, x)   add a piece of tier 1–8 at x ∈ 0–1 across the bottle (random if omitted), released under the cap
 *   drop(x)          aim the hanging piece at x ∈ 0–1 and drop it, exactly like a player
 *   fill(n)          drop n random pieces (tiers 1–4) quickly, one every 4 physics steps (merges still happen)
 *   advance(sec)     run the simulation synchronously for sec seconds (fixed 1/60 steps)
 *   bodies()         [{ tier, x, y, r, vx, vy, asleep }]
 *   forceGameOver()  cap the bottle now
 *   pause() / resume()
 */
import { INK, PAPER, STONE, STONE_DARK, FONT, SHOTS, loadFont, drawWordmark, roundRect, fitFont, safeInsets, lockTouch, buzz } from "../shared/brand.js";
import { createBoard, renderBoard, savedName } from "../shared/board.js";
import { createAudio } from "../shared/audio.js";
import { createWorld } from "./physics.js";
import { TIERS, tierInfo, blit, clearSprites, warm } from "./pieces.js";
import { createSound } from "./sound.js";

// ---------- geometry (bottle units) ----------
const BW = 10, BH = 14, FILL = 1.6, CORNER = 1.25, WALL = 0.34;
const R1 = 0.6, K = 1.27, RAD = (t) => R1 * Math.pow(K, t - 1);
const CAP_W = 2.5, CAP_H = 0.95, CAP_BOT = -2.62;
const VIEW = { l: -WALL - 0.25, r: BW + WALL + 0.25, t: -3.8, b: BH + WALL + 0.6 };
const DT = 1 / 60, COOLDOWN = 0.42, CHAIN = 1.0, OVER_LIMIT = 2.0, WELLBEING_BONUS = 1000;
const REWARDS = [
  { at: 1000, code: "DROP10", off: "10% off the range" },
  { at: 2500, code: "DROP15", off: "15% off the range" },
  { at: 5000, code: "DROP20", off: "20% off the range", extra: "+ you're in the draw for a year of Ryde" },
];
const HELD_NOTE = "That name needs a quick human check before it goes on the board. Your score is saved.";
const tri = (k) => (k * (k + 1)) / 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const easeIn = (t) => clamp(t, 0, 1) ** 3;
const easeOutBack = (t) => { t = clamp(t, 0, 1); const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
const fmt = (n) => Math.round(n).toLocaleString("en-AU");
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------- seeded RNG (mulberry32) ----------
let seed = (Math.random() * 2 ** 31) | 0, rs = seed;
function rng() { rs = (rs + 0x6d2b79f5) | 0; let t = Math.imul(rs ^ (rs >>> 15), 1 | rs); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
function setSeed(n) { seed = n | 0; rs = seed; }

// ---------- DOM / services ----------
const $ = (id) => document.getElementById(id);
const cv = $("cv"), ctx = cv.getContext("2d");
const audio = createAudio(), sound = createSound(audio);
const board = createBoard("ryde-drop");
const FINE = matchMedia("(hover: hover) and (pointer: fine)").matches;
let L = null, G = null, phase = "start", lastTs = 0, acc = 0, best = 0;
const perf = { ema: 1 / 60, slow: 0 };
try { best = +localStorage.getItem("ryde:drop:best") || 0; } catch {}
const mkCanvas = (w, h) => Object.assign(document.createElement("canvas"), { width: Math.max(1, w), height: Math.max(1, h) });

// =====================================================================================
// Layout: portrait column (HUD on top, discovery strip below) or, on wide screens, the
// bottle in a white centre column with stone side panels carrying the HUD.
// =====================================================================================
let dprCap = 2;                         // lowered automatically if frames run slow (see frame())
function layout() {
  const W = innerWidth, H = innerHeight, dpr = Math.min(dprCap, window.devicePixelRatio || 1), ins = safeInsets();
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = W + "px"; cv.style.height = H + "px";
  const vw = VIEW.r - VIEW.l, vh = VIEW.b - VIEW.t;
  const l = { W, H, dpr, ins, wide: W > H * 1.05 };
  if (!l.wide) {
    const colW = Math.min(W, 480), colX = (W - colW) / 2;
    const top = ins.t + 10, hudH = 62, stripH = 62;
    const areaT = top + hudH, areaB = H - ins.b - 10 - stripH;
    const s = Math.min((colW - 16 - ins.l - ins.r) / vw, (areaB - areaT) / vh);
    Object.assign(l, { s, colX, colW });
    l.ox = colX + colW / 2 - (BW / 2) * s;
    l.oy = areaT + Math.max(0, (areaB - areaT - vh * s) * 0.22) - VIEW.t * s;
    l.hud = { x0: colX + Math.max(18, ins.l + 12), x1: colX + colW - Math.max(16, ins.r + 12), y0: top };
    const below = l.oy + (BH + WALL + 0.5) * s;            // bottom of the bottle's floor shadow
    l.strip = { cx: colX + colW / 2, cy: Math.min(H - ins.b - 10 - 16, below + 40), w: Math.min(colW - 32, 420) };
    l.strip.capY = l.strip.cy - 27;
    l.pause = { x: l.hud.x1 - 44, y: top + 4 };
  } else {
    const avail = H - ins.t - ins.b - 20;
    const s = Math.min(avail / vh, (W * 0.44) / vw);
    const colW = vw * s + 48;
    Object.assign(l, { s, colX: (W - colW) / 2, colW });
    l.ox = W / 2 - (BW / 2) * s;
    l.oy = ins.t + 10 + (avail - vh * s) / 2 - VIEW.t * s;
    const pad = clamp(W * 0.025, 16, 40);
    l.left = { x0: Math.max(ins.l, 0) + pad, x1: l.colX - pad };
    l.right = { x0: l.colX + colW + pad, x1: W - Math.max(ins.r, 0) - pad };
    l.pad = pad;
    l.pause = { x: l.right.x1 - 44, y: ins.t + pad };
  }
  L = l;
  clearSprites(); setBottle(null); dropOld();
  for (let t = 1; t <= 8; t++) warm(t, RAD(t) * l.s, dpr);   // in-bottle sizes, so big merges never hitch
  // page colour behind the canvases: white, with stone either side of the play column
  const a = Math.round(l.colX), b = Math.round(l.colX + l.colW);
  document.body.style.background = a > 0 ? `linear-gradient(90deg, ${STONE} 0 ${a}px, ${PAPER} ${a}px ${b}px, ${STONE} ${b}px)` : PAPER;
  const pb = $("pause"); pb.style.left = l.pause.x + "px"; pb.style.top = l.pause.y + "px";
  if (G) G.dragging = false;
}
const X = (x) => L.ox + x * L.s, Y = (y) => L.oy + y * L.s;

// =====================================================================================
// The bottle: walls + interior drawn once into a cache per band colour.
// =====================================================================================
const bottle = { cache: null, band: -1, old: null, fade: 1 };
function wallPath() {
  const p = new Path2D(), o = WALL, R = CORNER + o, lip = o / 2;
  p.moveTo(-o, 0); p.lineTo(-o, BH + o - R); p.arcTo(-o, BH + o, -o + R, BH + o, R);
  p.lineTo(BW + o - R, BH + o); p.arcTo(BW + o, BH + o, BW + o, BH + o - R, R); p.lineTo(BW + o, 0);
  p.arc(BW + lip, 0, lip, 0, Math.PI, true);
  p.lineTo(BW, BH - CORNER); p.arcTo(BW, BH, BW - CORNER, BH, CORNER); p.lineTo(CORNER, BH); p.arcTo(0, BH, 0, BH - CORNER, CORNER);
  p.lineTo(0, 0); p.arc(-lip, 0, lip, 0, Math.PI, true); p.closePath();
  return p;
}
function interiorPath() {
  const p = new Path2D();
  p.moveTo(0, -0.01); p.lineTo(0, BH - CORNER); p.arcTo(0, BH, CORNER, BH, CORNER); p.lineTo(BW - CORNER, BH); p.arcTo(BW, BH, BW, BH - CORNER, CORNER); p.lineTo(BW, -0.01); p.closePath();
  return p;
}
function metalStops(g, stops) { stops.forEach(([t, c]) => g.addColorStop(t, c)); return g; }
function buildBottle(bandTier) {
  const s = L.s, dpr = L.dpr, x0 = VIEW.l, y0 = -0.4;
  const w = Math.ceil((VIEW.r - x0) * s * dpr), h = Math.ceil((VIEW.b - y0) * s * dpr);
  const c = mkCanvas(w, h), g = c.getContext("2d");
  const unit = () => g.setTransform(s * dpr, 0, 0, s * dpr, -x0 * s * dpr, -y0 * s * dpr);
  const px = () => g.setTransform(dpr, 0, 0, dpr, -x0 * s * dpr, -y0 * s * dpr);
  const sh = SHOTS[bandTier - 1];
  unit();
  // floor shadow
  g.save(); g.translate(BW / 2, BH + WALL + 0.12); g.scale(1, 0.05);
  let gr = g.createRadialGradient(0, 0, 0, 0, 0, BW * 0.62); gr.addColorStop(0, "rgba(0,0,0,0.2)"); gr.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = gr; g.beginPath(); g.arc(0, 0, BW * 0.62, 0, Math.PI * 2); g.fill(); g.restore();
  // interior: the inside back wall of a brushed-aluminium can
  const inner = interiorPath();
  g.fillStyle = metalStops(g.createLinearGradient(0, 0, BW, 0), [[0, "#D9DADD"], [0.07, "#EAEBED"], [0.3, "#F6F6F7"], [0.55, "#FBFBFB"], [0.86, "#EEEFF1"], [1, "#D6D7DA"]]);
  g.fill(inner);
  g.save(); g.clip(inner);
  // the shoulder band, printed in the shot colour above the fill line
  g.fillStyle = metalStops(g.createLinearGradient(0, 0, BW, 0), [[0, sh.dark], [0.1, sh.color], [0.3, sh.light], [0.5, sh.color], [0.84, sh.color], [1, sh.dark]]);
  g.fillRect(0, -1, BW, FILL + 1);
  g.fillStyle = "rgba(255,255,255,0.35)"; g.fillRect(0, FILL - 0.05, BW, 0.05);
  gr = g.createLinearGradient(0, BH - 3, 0, BH); gr.addColorStop(0, "rgba(0,0,0,0)"); gr.addColorStop(1, "rgba(0,0,0,0.045)");
  g.fillStyle = gr; g.fillRect(0, BH - 3, BW, 3);
  // ghosted label on the back wall
  px();
  const wm = 2.7 * s; g.font = `900 ${wm}px ${FONT}`; const ww = g.measureText("Ryde").width + wm * 0.24;
  drawWordmark(g, (BW / 2) * s - ww / 2, BH * 0.6 * s, wm, "rgba(19,19,19,0.045)");
  const tl = 0.5 * s; if (tl >= 12) { g.font = `700 ${tl}px ${FONT}`; g.fillStyle = "rgba(19,19,19,0.07)"; g.textAlign = "left"; g.fillText("your rhythm", (BW / 2) * s - ww / 2 + wm * 1.02, BH * 0.6 * s + wm * 0.24); }
  unit();
  g.restore();
  // fill line
  px(); g.setLineDash([0.3 * s, 0.22 * s]); g.lineWidth = Math.max(1.5, 0.055 * s); g.strokeStyle = "rgba(19,19,19,0.32)";
  g.beginPath(); g.moveTo(0.14 * s, FILL * s); g.lineTo((BW - 0.14) * s, FILL * s); g.stroke(); g.setLineDash([]);
  unit();
  // walls: silver, coloured where the shoulder band runs
  const wp = wallPath(), f = WALL / (BW + 2 * WALL);
  g.fillStyle = metalStops(g.createLinearGradient(-WALL, 0, BW + WALL, 0), [[0, "#7C7E84"], [f * 0.35, "#C8CACE"], [f * 0.62, "#F5F5F6"], [f, "#C9CBCF"], [1 - f, "#BFC1C5"], [1 - f * 0.62, "#E6E7E9"], [1 - f * 0.3, "#A4A6AB"], [1, "#72747A"]]);
  g.fill(wp);
  g.save(); g.clip(wp);
  gr = g.createLinearGradient(0, BH - 0.2, 0, BH + WALL); gr.addColorStop(0, "rgba(0,0,0,0)"); gr.addColorStop(1, "rgba(0,0,0,0.22)");
  g.fillStyle = gr; g.fillRect(-WALL, BH - 0.2, BW + 2 * WALL, WALL + 0.2);
  g.fillStyle = metalStops(g.createLinearGradient(-WALL, 0, BW + WALL, 0), [[0, sh.dark], [f * 0.35, sh.color], [f * 0.62, sh.light], [f, sh.color], [1 - f, sh.color], [1 - f * 0.62, sh.light], [1 - f * 0.3, sh.color], [1, sh.dark]]);
  g.fillRect(-WALL - 0.1, -1, BW + 2 * WALL + 0.2, FILL + 1);
  g.fillStyle = "rgba(0,0,0,0.12)"; g.fillRect(-WALL - 0.1, FILL - 0.02, BW + 2 * WALL + 0.2, 0.04);
  // specular strips
  g.fillStyle = "rgba(255,255,255,0.65)"; g.fillRect(-WALL * 0.5, 0.15, 0.05, BH - CORNER - 0.2);
  g.fillStyle = "rgba(255,255,255,0.3)"; g.fillRect(BW + WALL * 0.32, 0.15, 0.04, BH - CORNER - 0.2);
  g.restore();
  g.lineWidth = 1 / s; g.strokeStyle = "rgba(0,0,0,0.28)"; g.stroke(wp);
  return { canvas: c, x0, y0, w: w / dpr, h: h / dpr, band: bandTier };
}
// The bottle never changes between band colours, so it lives on its own canvas layer under the game
// canvas (#scene). Shake / zoom / wobble move that layer with a compositor-only CSS transform, and the
// per-frame canvas only has to paint what actually moves.
const scene = $("scene");
function place(b) { Object.assign(b.canvas.style, { position: "absolute", left: X(b.x0) + "px", top: Y(b.y0) + "px", width: b.w + "px", height: b.h + "px" }); }
function setBottle(b) { if (bottle.cache && bottle.cache.canvas.parentNode) bottle.cache.canvas.remove(); bottle.cache = b; if (b) { place(b); scene.appendChild(b.canvas); } }
function dropOld() { if (bottle.old) { bottle.old.canvas.remove(); bottle.old = null; } }
function drawBottle() {
  const band = G ? G.band : 1;
  if (!bottle.cache || bottle.cache.band !== band) {
    const prev = bottle.cache;
    if (prev && G) { dropOld(); bottle.old = prev; bottle.cache = null; bottle.fade = 0; }
    setBottle(buildBottle(band));
    if (bottle.old) scene.appendChild(bottle.old.canvas);     // old one on top, fading out
  }
  if (bottle.old) { if (bottle.fade >= 1) dropOld(); else bottle.old.canvas.style.opacity = String(1 - bottle.fade); }
}
let lastTf = "";
function setSceneTransform(m) {
  const t = m ? `matrix(${m.a.toFixed(5)},${m.b.toFixed(5)},${m.c.toFixed(5)},${m.d.toFixed(5)},${m.e.toFixed(2)},${m.f.toFixed(2)})` : "none";
  if (t !== lastTf) { scene.style.transform = t; lastTf = t; }
}

// the cap (the dropper, and at the end the lid)
function drawCap(cx, bot, w, h, tier, twist = 0) {
  const s = L.s, sh = SHOTS[tier - 1], x = X(cx - w / 2), y = Y(bot - h), W = w * s, H = h * s, r = Math.min(W, H) * 0.14;
  ctx.save();
  // skirt under the cap
  ctx.fillStyle = sh.dark; roundRect(ctx, x + W * 0.06, y + H - 1, W * 0.88, Math.max(3, 0.12 * s), 2); ctx.fill();
  const g = ctx.createLinearGradient(x, 0, x + W, 0);
  metalStops(g, [[0, sh.dark], [0.22, sh.light], [0.42, sh.color], [0.8, sh.dark], [1, sh.dark]]);
  ctx.fillStyle = g; roundRect(ctx, x, y, W, H, r); ctx.fill();
  ctx.save(); roundRect(ctx, x, y, W, H, r); ctx.clip();
  ctx.strokeStyle = "rgba(0,0,0,0.2)"; ctx.lineWidth = Math.max(1, s * 0.035);
  const n = Math.max(8, Math.round(W / Math.max(4, s * 0.2))), step = W / n, off = ((twist % 1) + 1) % 1 * step;
  for (let i = -1; i <= n; i++) { const xx = x + i * step + off; ctx.beginPath(); ctx.moveTo(xx, y + H * 0.14); ctx.lineTo(xx, y + H * 0.9); ctx.stroke(); }
  ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.fillRect(x, y, W, H * 0.09);
  ctx.fillStyle = "rgba(0,0,0,0.12)"; ctx.fillRect(x, y + H * 0.9, W, H * 0.1);
  ctx.restore();
  ctx.restore();
}

// =====================================================================================
// Game state
// =====================================================================================
function newGame() {
  const world = createWorld({ W: BW, H: BH, corner: CORNER });
  G = {
    world, score: 0, shown: 0, merges: 0, combo: 0, lastMerge: -9, chainShow: 0, bestChain: 1, highest: 1, made: 1, drops: 0,
    current: 1, next: 1, aim: BW / 2, capX: BW / 2, cool: 0, hangT: 1, pendingDrop: false, dragging: false, keyDir: 0, pointerId: null,
    over: 0, overMax: 0, top: 99, wobble: 0, time: 0, stepN: 0, fillQueue: 0,
    discovered: new Set([1]), stripPop: {}, band: 1, bandT: 1, toast: null, hint: 1, codeIdx: -1,
    fx: [], parts: [], pops: [], confetti: [], stamp: null, hitStop: 0, shake: { x: 0, y: 0, vx: 0, vy: 0 }, zoom: 0, capT: -1, endT: 0,
  };
  G.current = pickTier(); G.next = pickTier();
}
function pickTier() {
  if (!G || G.drops < 3) return rng() < 0.6 ? 1 : 2;
  const p = clamp(G.score / 2500, 0, 1);
  const w = [0.4 - 0.08 * p, 0.3 - 0.02 * p, 0.2 + 0.03 * p, 0.1 + 0.07 * p];
  let r = rng() * (w[0] + w[1] + w[2] + w[3]);
  for (let i = 0; i < 4; i++) { r -= w[i]; if (r <= 0) return i + 1; }
  return 1;
}
const pieceData = () => ({ sq: 0, sqv: 0, sqa: 0, pop: 1, flash: 0, over: false });
function addPiece(tier, x, y, extra = {}) {
  const r = RAD(tier);
  const b = G.world.add({ x: clamp(x, r, BW - r), y, r, tier, vy: 1.5, data: pieceData(), ...extra });
  G.highest = Math.max(G.highest, tier);
  discover(tier);
  return b;
}

function drop() {
  if (!G || phase !== "play") return;
  if (G.cool > 0 || G.hangT < 0.35) { G.pendingDrop = true; return; }
  const t = G.current, r = RAD(t);
  addPiece(t, G.aim, CAP_BOT + r + 0.05);
  G.capX = G.aim;
  G.drops++; G.current = G.next; G.next = pickTier(); G.cool = COOLDOWN; G.hangT = 0;
  sound.drop(); buzz(8);
  if (G.drops >= 2) G.hint = Math.min(G.hint, 0.999);
}

function merge(a, b) {
  const w = G.world, t = a.tier;
  const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
  w.remove(a); w.remove(b);
  // a chain is a cascade: it only continues when a piece that was itself just made (≤ 1 s ago) merges again.
  // (Counting any two merges within 1 s let rapid-fire dropping farm the multiplier.)
  const fresh = [a, b].filter((q) => q.data.madeAt != null && G.time - q.data.madeAt <= CHAIN);
  G.combo = fresh.length ? Math.max(...fresh.map((q) => q.data.chain)) + 1 : 1;
  G.lastMerge = G.time; G.bestChain = Math.max(G.bestChain, G.combo); G.merges++;
  if (G.combo >= 2) G.chainShow = 1;
  if (t >= 8) return wellbeing(x, y);
  const nt = t + 1, r = RAD(nt);
  const nb = G.world.add({ x: clamp(x, r, BW - r), y: Math.min(BH - r, y), r: RAD(t), rTarget: r, tier: nt,
    vx: (a.vx + b.vx) / 2, vy: (a.vy + b.vy) / 2 - 1.6, w: (a.w + b.w) / 2, data: { ...pieceData(), pop: 0, flash: 1, madeAt: G.time, chain: G.combo } });
  nb.landed = true;
  const pts = tri(nt) * G.combo;
  G.score += pts; checkRewards(); G.highest = Math.max(G.highest, nt); G.made = Math.max(G.made, nt);
  // one popup per chain, showing the running total, so cascades don't stack numbers on top of each other
  if (G.combo === 1) { G.chainId = (G.chainId || 0) + 1; G.chainPts = 0; }
  G.chainPts += pts;
  const pop = G.pops.find((q) => q.chain === G.chainId);
  if (pop) Object.assign(pop, { x: nb.x, y: nb.y - r * 0.2, text: "+" + fmt(G.chainPts), combo: G.combo, life: 1, tier: nt });
  else G.pops.push({ x: nb.x, y: nb.y - r * 0.2, text: "+" + fmt(pts), combo: G.combo, life: 1, tier: nt, chain: G.chainId });
  burst(nb.x, nb.y, r, nt, 8 + nt * 3);
  G.fx.push({ kind: "ring", x: nb.x, y: nb.y, r, tier: nt, life: 1 });
  sound.merge(nt, G.combo); buzz(nt >= 6 ? 18 : 6);
  if (nt >= 6) { G.hitStop = 0.04 + (nt - 5) * 0.02; kick((nt - 5) * 2.6); G.zoom = Math.max(G.zoom, 0.006 * (nt - 4)); }
  discover(nt);
  if (nt === 8) { sound.yourDay(); G.stamp = { text: ["Your", "Day."], life: 1.6, max: 1.6 }; }
}
function wellbeing(x, y) {
  const pts = WELLBEING_BONUS * G.combo;
  G.score += pts; G.highest = 9; G.wellbeing = (G.wellbeing || 0) + 1; checkRewards();
  G.pops.push({ x, y, text: "+" + fmt(pts), combo: G.combo, life: 1.4, tier: 8 });
  for (let i = 0; i < 3; i++) G.fx.push({ kind: "ring", x, y, r: RAD(8) * (0.6 + i * 0.3), tier: 8, life: 1 + i * 0.15 });
  burst(x, y, RAD(8), 8, 60);
  confetti(X(x), Y(y), 160);
  G.stamp = { text: ["Wellbeing", "In One", "Shot."], life: 2.4, max: 2.4, big: true };
  G.hitStop = 0.14; kick(9); G.zoom = 0.03;
  sound.wellbeing(); buzz(40);
  G.world.wakeAll();
}
function discover(t) {
  if (G.discovered.has(t)) return;
  G.discovered.add(t); G.stripPop[t] = 1;
  if (t <= 5) { if (t > G.band) { G.band = t; G.bandT = 0; } }
  else toast("Unlocked >", tierInfo(t).short, tierInfo(t).tag);
  sound.discover();
}
function toast(line1, name, tag) { G.toast = { line1, name, tag, life: 2.8 }; }
function checkRewards() {
  const i = REWARDS.filter((r) => G.score >= r.at).length - 1;
  if (i > G.codeIdx) { G.codeIdx = i; const rw = REWARDS[i]; toast("Code unlocked >", rw.code, rw.off.replace(" the range", " the range")); sound.discover(); G.stripPop.code = 1; }
}
function burst(x, y, r, tier, n) {
  const cols = tierInfo(tier).fx;
  for (let i = 0; i < n && G.parts.length < 360; i++) {
    const a = rng() * Math.PI * 2, sp = 2 + rng() * 5 + r * 1.5;
    G.parts.push({ x: x + Math.cos(a) * r * 0.8, y: y + Math.sin(a) * r * 0.8, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 2, life: 0.5 + rng() * 0.45, max: 0.95, col: cols[i % cols.length], sz: 0.07 + rng() * 0.1 });
  }
}
function confetti(sx, sy, n) {
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (rng() - 0.5) * 2.4, sp = 300 + rng() * 650;
    G.confetti.push({ x: sx, y: sy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, rot: rng() * 6, vr: (rng() - 0.5) * 14, life: 2.4 + rng() * 0.8, col: SHOTS[i % 5].color, w: 6 + rng() * 6, h: 4 + rng() * 5, round: rng() < 0.35 });
  }
}
function kick(px) { if (REDUCED) return; const a = rng() * Math.PI * 2; G.shake.vx += Math.cos(a) * px * 30; G.shake.vy += Math.abs(Math.sin(a)) * px * 30; }

// ---------- fixed physics step ----------
function fixedStep() {
  const g = G, w = g.world;
  g.time += DT; g.stepN++;
  if (g.keyDir) g.aim += g.keyDir * 8.5 * DT;
  const r = RAD(g.current); g.aim = clamp(g.aim, r, BW - r);
  if (g.cool > 0) g.cool -= DT;
  else if (g.hangT < 1) g.hangT = Math.min(1, g.hangT + DT / 0.22);
  if (g.pendingDrop && g.cool <= 0 && g.hangT >= 0.35) { g.pendingDrop = false; drop(); }
  if (g.fillQueue > 0 && g.stepN % 4 === 0) { g.fillQueue--; const t = pickTier(), rr = RAD(t); addPiece(t, rr + rng() * (BW - 2 * rr), CAP_BOT + rr + 0.05); g.drops++; }

  w.step(DT);

  for (const e of w.drainEvents()) {
    if (e.speed < 2) continue;
    for (const b of [e.a, e.b]) {
      if (!b || !b.data) continue;
      const k = clamp(1.3 - b.tier * 0.08, 0.55, 1.2);
      const sq = Math.min(0.17, e.speed * 0.012) * k;
      if (sq > b.data.sq) { b.data.sq = sq; b.data.sqv = 0; b.data.sqa = Math.atan2(e.ny, e.nx); }
    }
    if (e.speed > 2.4) sound.clink((Math.max(e.a.tier, e.b ? e.b.tier : 0) - 1) / 7, e.speed);
  }
  for (const [a, b] of w.touchingPairs()) merge(a, b);

  // over the fill line? (only pieces that have landed and come to rest count)
  let any = false, top = 99;
  for (const b of w.bodies) {
    const settled = b.landed && w.time - b.born > 0.45 && Math.hypot(b.vx, b.vy) < 1.2;
    b.data.over = settled && b.y - b.r < FILL;
    if (b.data.over) any = true;
    if (settled) top = Math.min(top, b.y - b.r);
  }
  g.top = top;
  g.over = any ? g.over + DT : 0; g.overMax = Math.max(g.overMax, g.over);
  if (g.over >= OVER_LIMIT) startCapping();
}

// ---------- per-frame (render-rate) updates ----------
function update(dt) {
  const g = G;
  // smooth the dropper toward the aim
  g.capX += (g.aim - g.capX) * (1 - Math.exp(-dt * 28));
  g.shown += (g.score - g.shown) * (1 - Math.exp(-dt * 9)); if (Math.abs(g.score - g.shown) < 0.5) g.shown = g.score;
  if (g.chainShow > 0 && g.time - g.lastMerge > CHAIN) g.chainShow = Math.max(0, g.chainShow - dt * 2.5);
  g.bandT = Math.min(1, g.bandT + dt / 0.6); bottle.fade = Math.min(1, bottle.fade + dt / 0.6);
  if (g.toast && (g.toast.life -= dt) <= 0) g.toast = null;
  for (const k in g.stripPop) g.stripPop[k] = Math.max(0, g.stripPop[k] - dt / 0.6);
  if (g.hint < 1 || g.time > 5) g.hint = Math.max(0, Math.min(g.hint, 1) - dt * 2.5);
  // squash springs + merge pops
  for (const b of g.world.bodies) {
    const d = b.data; if (!d) continue;
    if (d.sq !== 0 || d.sqv !== 0) { d.sqv += (-700 * d.sq - 16 * d.sqv) * dt; d.sq += d.sqv * dt; if (Math.abs(d.sq) < 0.001 && Math.abs(d.sqv) < 0.02) { d.sq = 0; d.sqv = 0; } }
    if (d.pop < 1) d.pop = Math.min(1, d.pop + dt / 0.38);
    if (d.flash > 0) d.flash = Math.max(0, d.flash - dt / 0.28);
  }
  // camera
  const sk = g.shake; sk.vx += (-260 * sk.x - 15 * sk.vx) * dt; sk.vy += (-260 * sk.y - 15 * sk.vy) * dt; sk.x += sk.vx * dt; sk.y += sk.vy * dt;
  g.zoom *= Math.exp(-dt * 6);
  const near = g.over > 0 ? 1 : clamp(1 - (g.top - FILL) / 2.4, 0, 1);
  g.wobble += (near - g.wobble) * (1 - Math.exp(-dt * 4));
  // fx
  for (const f of g.fx) f.life -= dt / 0.5;
  g.fx = g.fx.filter((f) => f.life > 0);
  for (const p of g.parts) { p.vy += 26 * dt; p.vx *= Math.exp(-dt * 2.5); p.vy *= Math.exp(-dt * 1.2); p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
  g.parts = g.parts.filter((p) => p.life > 0);
  for (const p of g.pops) { p.life -= dt / 0.9; p.y -= dt * 1.4; }
  g.pops = g.pops.filter((p) => p.life > 0);
  for (const c of g.confetti) { c.vy += 1300 * dt; c.vx *= Math.exp(-dt * 1.6); c.vy *= Math.exp(-dt * 1.1); c.x += c.vx * dt; c.y += c.vy * dt; c.rot += c.vr * dt; c.life -= dt; }
  g.confetti = g.confetti.filter((c) => c.life > 0 && c.y < L.H + 40);
  if (g.stamp && (g.stamp.life -= dt) <= 0) g.stamp = null;
  if (g.over > 0 && phase === "play") sound.warn(g.over);
}

// ---------- the capping animation (game over) ----------
function startCapping() {
  if (!G || phase !== "play") return;
  phase = "capping"; G.capT = 0; G.dragging = false; G.pendingDrop = false;
  $("pause").classList.remove("on");
  sound.cap(); sound.stopMusic(1.8);
}
function capGeometry() {
  const t = G.capT;
  const p1 = easeOut(t / 0.45), p2 = easeIn((t - 0.45) / 0.22);
  const w = lerp(CAP_W, BW + 2 * WALL + 0.24, p1), h = lerp(CAP_H, 1.7, p1);
  const cx = lerp(G.capX, BW / 2, p1);
  const bot = lerp(CAP_BOT, 0.18, p2);
  const twist = t > 0.62 ? Math.min(1.1, t - 0.62) * 3.2 : 0;
  return { cx, bot, w, h, twist };
}
function updateCapping(dt) {
  const prev = G.capT; G.capT += dt;
  if (prev < 1.12 && G.capT >= 1.12) { kick(5); buzz(30); G.stamp = { text: ["Capped."], life: 1.0, max: 1.0 }; for (let i = 0; i < 18; i++) G.parts.push({ x: rng() * BW, y: -0.05, vx: (rng() - 0.5) * 6, vy: -2 - rng() * 3, life: 0.6, max: 0.6, col: SHOTS[G.band - 1].color, sz: 0.08 }); }
  if (G.capT >= 2.15 && phase === "capping") endGame();
}

// =====================================================================================
// Rendering
// =====================================================================================
function render(alpha) {
  const { W, H, dpr } = L;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.save();
  if (G) {
    const sk = G.shake, piv = [X(BW / 2), Y(BH + WALL)];
    ctx.translate(sk.x, sk.y);
    const z = 1 + G.zoom; ctx.translate(X(BW / 2), Y(BH / 2)); ctx.scale(z, z); ctx.translate(-X(BW / 2), -Y(BH / 2));
    const wob = REDUCED ? 0 : Math.sin(G.time * 8.5) * 0.0045 * G.wobble * G.wobble + (G.over > 0 ? Math.sin(G.time * 31) * 0.0025 : 0);
    if (wob) { ctx.translate(piv[0], piv[1]); ctx.rotate(wob); ctx.translate(-piv[0], -piv[1]); }
    if (phase === "capping" && G.capT > 1.12) { const q = Math.exp(-(G.capT - 1.12) * 9) * Math.sin((G.capT - 1.12) * 40) * 0.025; ctx.translate(piv[0], piv[1]); ctx.scale(1 + q, 1 - q); ctx.translate(-piv[0], -piv[1]); }
  }
  drawBottle();
  if (G) {
    const m = ctx.getTransform(); setSceneTransform(new DOMMatrix([m.a / dpr, m.b / dpr, m.c / dpr, m.d / dpr, m.e / dpr, m.f / dpr]));
  } else setSceneTransform(null);
  if (G) {
    drawBand();
    if (phase === "play") drawGuide();
    drawPieces(alpha);
    drawFx();
    drawWarning();
    if (phase === "capping") { const c = capGeometry(); drawCap(c.cx, c.bot, c.w, c.h, G.band, c.twist); }
    else drawDropper();
    drawPops();
  } else drawBand();
  ctx.restore();

  if (G) {
    if (L.wide) drawHudWide(); else drawHud();
    drawHint();
    drawStamp();
    drawConfetti();
    if (phase === "capping" && G.capT > 1.75) { ctx.fillStyle = `rgba(255,255,255,${easeOut((G.capT - 1.75) / 0.4)})`; ctx.fillRect(0, 0, W, H); }
  }
}

function drawBand() {
  const s = L.s, x0 = X(0.4), x1 = X(BW - 0.4), top = Y(0), h = FILL * s;
  const small = clamp(0.36 * s, 12, 15);
  let big = clamp(0.64 * s, 14, 28);
  if (small + big * 0.76 + 6 > h - 4) big = Math.max(12, (h - 10 - small) / 0.76);
  const blockH = small + 3 + big * 0.74, by = top + (h - blockH) / 2;
  const y1 = by + small * 0.78, y2 = by + small + 3 + big * 0.72;
  ctx.save();
  ctx.beginPath(); ctx.rect(X(0), top, BW * s, h); ctx.clip();
  ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
  const warn = G && G.over > 0;
  if (warn) {
    const p = 0.5 + 0.5 * Math.sin(G.time * 14);
    ctx.fillStyle = INK; ctx.fillRect(X(0), top, BW * s, h);
    ctx.fillStyle = `rgba(238,56,49,${0.3 * p})`; ctx.fillRect(X(0), top, BW * s, h);
    ctx.restore(); return;
  }
  let a = 1, dy = 0, line1 = "A shot of >", name, tag;
  const toast = G && G.toast;
  if (toast) {
    const k = toast.life;
    a = Math.min(1, (2.8 - k) / 0.25, k / 0.3); dy = (1 - easeOut((2.8 - k) / 0.35)) * 10;
    line1 = toast.line1; name = toast.name; tag = toast.tag;
  } else {
    const info = TIERS[(G ? G.band : 1) - 1];
    const bt = G ? G.bandT : 1; a = easeOut(bt / 0.6); dy = (1 - easeOut(bt)) * 12;
    name = info.name; tag = info.tag;
  }
  ctx.globalAlpha = clamp(a, 0, 1);
  ctx.fillStyle = INK; ctx.font = `700 ${small}px ${FONT}`; ctx.fillText(line1, x0, y1 + dy);
  ctx.font = `900 ${big}px ${FONT}`; const nw = ctx.measureText(name).width; ctx.fillText(name, x0, y2 + dy);
  const room = x1 - x0 - nw - small * 1.2;
  if (room > 40) { const fs = fitFont(ctx, 700, small, tag, room, 12); if (ctx.measureText(tag).width <= room + 0.5 && fs >= 12) { ctx.textAlign = "right"; ctx.fillText(tag, x1, y2 + dy); } }
  ctx.restore();
}

function drawGuide() {
  if (G.cool > 0) return;
  const r = RAD(G.current), x = G.capX, hy = CAP_BOT + r + 0.05;
  const land = G.world.landingY(x, r, hy);
  if (land <= hy + r * 2) return;
  ctx.save();
  ctx.setLineDash([3, 6]); ctx.lineCap = "round"; ctx.lineWidth = 2; ctx.strokeStyle = "rgba(19,19,19,0.2)";
  ctx.beginPath(); ctx.moveTo(X(x), Y(hy + r + 0.15)); ctx.lineTo(X(x), Y(land + r) - 2); ctx.stroke();
  ctx.setLineDash([2.5, 4]); ctx.lineWidth = 1.5; ctx.strokeStyle = "rgba(19,19,19,0.16)";
  ctx.beginPath(); ctx.arc(X(x), Y(land), r * L.s - 1, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

function bodyPos(b, alpha) { return [lerp(b.px, b.x, alpha), lerp(b.py, b.y, alpha), lerp(b.pa, b.a, alpha)]; }
function drawPieces(alpha) {
  const bodies = G.world.bodies, s = L.s, dpr = L.dpr;
  // soft contact shadows, one path so overlaps don't stack up darker; clipped to the inside of the bottle
  ctx.save();
  const clipP = new Path2D(); clipP.addPath(interiorPath(), new DOMMatrix([s, 0, 0, s, X(0), Y(0)])); ctx.clip(clipP);
  ctx.beginPath();
  for (const b of bodies) { const [x, y] = bodyPos(b, alpha); ctx.moveTo(X(x) + b.r * s, Y(y + b.r * 0.13)); ctx.arc(X(x), Y(y + b.r * 0.13), b.r * s * 0.99, 0, Math.PI * 2); }
  ctx.fillStyle = "rgba(40,30,20,0.09)"; ctx.fill();
  ctx.restore();
  for (const b of bodies) {
    const d = b.data, [x, y, a] = bodyPos(b, alpha);
    const bounce = d.pop < 1 ? Math.sin(d.pop * Math.PI * 2) * 0.1 * (1 - d.pop) : 0;
    const r = b.r * s * (1 + bounce);
    ctx.save(); ctx.translate(X(x), Y(y));
    if (d.sq) { ctx.rotate(d.sqa); ctx.scale(1 - d.sq, 1 + d.sq * 0.55); ctx.rotate(-d.sqa); }
    blit(ctx, b.tier, 0, 0, r, dpr, a, 1, b.rT * s);
    if (d.flash > 0) { ctx.globalAlpha = d.flash * 0.75; ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; }
    if (d.over) { const p = 0.5 + 0.5 * Math.sin(G.time * 14); ctx.lineWidth = 3; ctx.strokeStyle = `rgba(238,56,49,${0.55 + 0.45 * p})`; ctx.beginPath(); ctx.arc(0, 0, r + 2.5, 0, Math.PI * 2); ctx.stroke(); }
    ctx.restore();
  }
}

function drawFx() {
  const s = L.s;
  for (const f of G.fx) {
    const t = 1 - clamp(f.life, 0, 1), info = tierInfo(f.tier);
    const rr = (f.r * (1 + t * 0.9) + 0.15) * s;
    ctx.lineWidth = Math.max(1, (1 - t) * 0.22 * s);
    ctx.strokeStyle = f.tier === 8 ? SHOTS[Math.floor(t * 10) % 5].color : f.tier === 6 ? "#A9ACB1" : f.tier === 7 ? "#C9B6F5" : info.color;
    ctx.globalAlpha = (1 - t) * 0.9; ctx.beginPath(); ctx.arc(X(f.x), Y(f.y), rr, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.save(); ctx.beginPath(); ctx.rect(X(-WALL - 0.3), Y(VIEW.t), (BW + 2 * WALL + 0.6) * s, (BH - VIEW.t) * s); ctx.clip();
  for (const p of G.parts) {
    const k = clamp(p.life / p.max, 0, 1);
    ctx.globalAlpha = Math.min(1, k * 1.6); ctx.fillStyle = p.col;
    ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), Math.max(1, p.sz * s * (0.5 + k * 0.5)), 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

function drawWarning() {
  if (G.over <= 0 || phase !== "play") return;
  const p = 0.5 + 0.5 * Math.sin(G.time * 14), s = L.s;
  ctx.save(); ctx.setLineDash([0.3 * s, 0.2 * s]); ctx.lineWidth = 3; ctx.strokeStyle = `rgba(238,56,49,${0.6 + 0.4 * p})`;
  ctx.beginPath(); ctx.moveTo(X(0.14), Y(FILL)); ctx.lineTo(X(BW - 0.14), Y(FILL)); ctx.stroke(); ctx.setLineDash([]);
  // the label sits on top of the pieces (they're the reason it's showing), with a halo so it reads over anything
  const big = clamp(0.66 * s, 15, 28), x0 = X(0.4), x1 = X(BW - 0.4), y = Y(FILL) - big * 0.32;
  ctx.font = `900 ${big}px ${FONT}`; ctx.textBaseline = "alphabetic"; ctx.lineJoin = "round"; ctx.lineWidth = Math.max(4, big * 0.24); ctx.strokeStyle = INK;
  const left = Math.max(0, OVER_LIMIT - G.over).toFixed(1) + "s";
  ctx.textAlign = "left"; fitFont(ctx, 900, big, "OVER THE LINE", (x1 - x0) * 0.7, 12);
  ctx.strokeText("OVER THE LINE", x0, y); ctx.fillStyle = PAPER; ctx.fillText("OVER THE LINE", x0, y);
  ctx.font = `900 ${big}px ${FONT}`; ctx.textAlign = "right"; ctx.strokeText(left, x1, y); ctx.fillStyle = "#FF8A80"; ctx.fillText(left, x1, y);
  ctx.restore();
}

function drawDropper() {
  const s = L.s, x = G.capX;
  drawCap(x, CAP_BOT, CAP_W, CAP_H, G.band);
  if (G.cool <= 0 && phase === "play") {
    const r = RAD(G.current), k = easeOutBack(G.hangT), sway = Math.sin(G.time * 2.2) * 0.04;
    blit(ctx, G.current, X(x), Y(CAP_BOT + r + 0.05), r * s * clamp(k, 0, 1.2), L.dpr, sway, 1, r * s);
  }
}

function drawPops() {
  for (const p of G.pops) {
    const k = clamp(p.life, 0, 1), sz = clamp(0.62 * L.s, 15, 26) * (p.combo > 1 ? 1.15 : 1);
    ctx.save(); ctx.globalAlpha = Math.min(1, k * 2.2);
    const x = X(p.x), y = Y(p.y) - (1 - k) * 8;
    ctx.font = `900 ${sz}px ${FONT}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.lineJoin = "round"; ctx.lineWidth = 5; ctx.strokeStyle = "rgba(255,255,255,0.95)"; ctx.strokeText(p.text, x, y); ctx.fillStyle = INK; ctx.fillText(p.text, x, y);
    if (p.combo > 1) {
      const t = "×" + p.combo, fs = Math.max(12, sz * 0.62); ctx.font = `900 ${fs}px ${FONT}`;
      const tw = ctx.measureText(t).width + fs * 0.9, py = y + sz * 0.95;
      ctx.fillStyle = INK; roundRect(ctx, x - tw / 2, py - fs * 0.75, tw, fs * 1.5, fs * 0.75); ctx.fill();
      ctx.fillStyle = PAPER; ctx.fillText(t, x, py + 1);
    }
    ctx.restore();
  }
}

// ---------- HUD ----------
function nextPill(x, y, w, h, fill) {
  ctx.fillStyle = fill; roundRect(ctx, x, y, w, h, h / 2); ctx.fill();
  ctx.fillStyle = INK; ctx.font = `800 12px ${FONT}`; ctx.textBaseline = "middle"; ctx.textAlign = "left"; ctx.fillText("Next", x + h * 0.36, y + h / 2 + 1);
  const pr = h * 0.36 * (0.82 + 0.18 * (RAD(G.next) / RAD(4)));
  blit(ctx, G.next, x + w - h * 0.5, y + h / 2, pr, L.dpr, 0, 1, h * 0.36);
}
function chainPill(x, y, fs) {
  if (G.chainShow <= 0 || G.combo < 2) return;
  const t = `×${G.combo} chain`; ctx.save(); ctx.globalAlpha = clamp(G.chainShow * 2, 0, 1);
  ctx.font = `900 ${fs}px ${FONT}`; const w = ctx.measureText(t).width + fs * 1.3, h = fs * 1.9;
  ctx.fillStyle = SHOTS[G.band - 1].color; roundRect(ctx, x, y - h / 2, w, h, h / 2); ctx.fill();
  ctx.fillStyle = INK; ctx.textBaseline = "middle"; ctx.textAlign = "left"; ctx.fillText(t, x + fs * 0.65, y + 1);
  ctx.restore();
}
function drawHud() {
  const h = L.hud;
  ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
  ctx.fillStyle = "rgba(19,19,19,0.5)"; ctx.font = `800 12px ${FONT}`; ctx.fillText("SCORE", h.x0, h.y0 + 13);
  const bt = best > 0 ? `BEST ${fmt(Math.max(best, G.score))}` : ""; if (bt) ctx.fillText(bt, h.x0 + 58, h.y0 + 13);
  ctx.fillStyle = INK; ctx.font = `900 42px ${FONT}`; const sw = ctx.measureText(fmt(G.shown)).width; ctx.fillText(fmt(G.shown), h.x0 - 2, h.y0 + 52);
  const pw = 92, ph = 46, px = L.pause.x - 10 - pw;
  chainPill(h.x0 + sw + 10, h.y0 + 38, 13);
  nextPill(px, h.y0 + 3, pw, ph, STONE);
  drawStrip();
}
function drawStrip() {
  const st = L.strip, n = 8;
  const sr = clamp(st.w / (n * 2 + (n - 1) * 1.05), 9, 15), gap = sr * 1.05;
  const total = n * 2 * sr + (n - 1) * gap;
  let x = st.cx - total / 2 + sr;
  ctx.fillStyle = "rgba(19,19,19,0.5)"; ctx.font = `800 12px ${FONT}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  ctx.fillText("YOUR DAY SO FAR >", st.cx - total / 2, st.capY + 4);
  const last = Math.max(...G.discovered); ctx.textAlign = "right"; ctx.fillStyle = INK; ctx.fillText(tierInfo(last).short, st.cx + total / 2, st.capY + 4);
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (let t = 1; t <= n; t++) {
    const lit = G.discovered.has(t), pop = G.stripPop[t] || 0, k = 1 + Math.sin(pop * Math.PI) * 0.45;
    if (lit) blit(ctx, t, x, st.cy, sr * k, L.dpr, 0, 1, sr);
    else { ctx.save(); ctx.setLineDash([3, 3]); ctx.lineWidth = 1.5; ctx.strokeStyle = STONE_DARK; ctx.beginPath(); ctx.arc(x, st.cy, sr - 1, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); }
    if (t < n) { ctx.fillStyle = "rgba(19,19,19,0.32)"; ctx.font = `800 12px ${FONT}`; ctx.fillText(">", x + sr + gap / 2, st.cy + 1); }
    x += sr * 2 + gap;
  }
}
function drawHudWide() {
  const { left: lp, right: rp, H, ins, pad } = L;
  const lw = lp.x1 - lp.x0, rw = rp.x1 - rp.x0;
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  let y = ins.t + pad;
  const wm = clamp(H * 0.045, 18, 34);
  drawWordmark(ctx, lp.x0, y + wm * 0.8, wm, INK); y += wm * 1.2 + 8;
  const eb = clamp(H * 0.022, 12, 16);
  ctx.fillStyle = INK; ctx.font = `700 ${eb}px ${FONT}`; ctx.fillText("A shot of >", lp.x0, y + eb); y += eb + 4;
  const tsz = fitFont(ctx, 900, clamp(H * 0.065, 20, 54), "DROP SHOT.", lw, 14); ctx.fillText("DROP SHOT.", lp.x0, y + tsz * 0.8); y += tsz * 0.8 + clamp(H * 0.05, 12, 44);
  ctx.fillStyle = "rgba(19,19,19,0.55)"; ctx.font = `800 12px ${FONT}`; ctx.fillText("SCORE", lp.x0, y + 12); y += 14;
  ctx.fillStyle = INK; const ssz = fitFont(ctx, 900, clamp(H * 0.12, 34, 104), fmt(G.shown), lw, 20); ctx.fillText(fmt(G.shown), lp.x0 - 2, y + ssz * 0.78); const sw = ctx.measureText(fmt(G.shown)).width; y += ssz * 0.78;
  ctx.fillStyle = "rgba(19,19,19,0.55)"; ctx.font = `800 13px ${FONT}`;
  if (best > 0) ctx.fillText(`BEST ${fmt(Math.max(best, G.score))}`, lp.x0, y + 22);
  // progress to the next Black Friday code
  const nx = REWARDS.find((r) => G.score < r.at), py = y + 44;
  if (py + 46 < H - ins.b - pad - (FINE && H > 520 ? 24 : 0)) {
    const bw = Math.min(lw, 260);
    ctx.fillStyle = "rgba(19,19,19,0.55)"; ctx.font = `800 12px ${FONT}`;
    ctx.fillText(nx ? "NEXT CODE >" : "ALL CODES UNLOCKED >", lp.x0, py + 12);
    const prev = nx ? (REWARDS[REWARDS.indexOf(nx) - 1]?.at || 0) : 0, k = nx ? clamp((G.score - prev) / (nx.at - prev), 0, 1) : 1;
    ctx.fillStyle = "rgba(19,19,19,0.12)"; roundRect(ctx, lp.x0, py + 20, bw, 8, 4); ctx.fill();
    ctx.fillStyle = INK; roundRect(ctx, lp.x0, py + 20, Math.max(8, bw * k), 8, 4); ctx.fill();
    ctx.font = `700 13px ${FONT}`; ctx.fillStyle = INK;
    const t = nx ? `${fmt(nx.at - G.score)} to go · ${nx.off.replace(" the range", "")}` : `${REWARDS[2].code} · ${REWARDS[2].off.replace(" the range", "")}`;
    fitFont(ctx, 700, 13, t, lw, 12); ctx.fillText(t, lp.x0, py + 44);
  }
  if (lw - sw > 110) chainPill(lp.x0 + sw + 12, y - ssz * 0.32, clamp(H * 0.02, 12, 16)); else chainPill(lp.x0 + 110, y + 17, 12);
  if (FINE && H > 520) { ctx.fillStyle = "rgba(19,19,19,0.5)"; ctx.font = `700 12px ${FONT}`; ctx.fillText("← → aim · Space drop · P pause", lp.x0, H - ins.b - pad); }
  // right panel: next + the day so far
  let ry = ins.t + pad;
  const ph = clamp(H * 0.075, 40, 56), pw = Math.min(rw - 56, ph * 2.1);
  nextPill(rp.x0, ry, pw, ph, PAPER); ry += ph + clamp(H * 0.04, 10, 28);
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic"; ctx.fillStyle = INK; ctx.font = `800 13px ${FONT}`; ctx.fillText("Your day so far >", rp.x0, ry + 12); ry += 22;
  const rowH = clamp((H - ins.b - pad - ry) / 8, 22, 46), dr = clamp(rowH * 0.36, 8, 15);
  for (let t = 1; t <= 8; t++) {
    const info = TIERS[t - 1], lit = G.discovered.has(t), cy = ry + rowH * (t - 0.5), pop = G.stripPop[t] || 0;
    if (lit) blit(ctx, t, rp.x0 + dr, cy, dr * (1 + Math.sin(pop * Math.PI) * 0.4), L.dpr, 0, 1, dr);
    else { ctx.save(); ctx.setLineDash([3, 3]); ctx.lineWidth = 1.5; ctx.strokeStyle = STONE_DARK; ctx.beginPath(); ctx.arc(rp.x0 + dr, cy, dr - 1, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); }
    ctx.globalAlpha = lit ? 1 : 0.42; ctx.fillStyle = INK; ctx.textBaseline = "middle";
    const nx = rp.x0 + dr * 2 + 10, nsz = fitFont(ctx, 800, clamp(rowH * 0.38, 12, 16), info.short, rw - dr * 2 - 10, 12);
    ctx.fillText(info.short, nx, cy + 1);
    const nw = ctx.measureText(info.short).width, room = rp.x1 - nx - nw - 10;
    if (room > 60) { ctx.font = `600 12px ${FONT}`; if (ctx.measureText(info.tag).width <= room) { ctx.fillStyle = "rgba(19,19,19,0.6)"; ctx.fillText(info.tag, nx + nw + 8, cy + 1); } }
    ctx.globalAlpha = 1; void nsz;
  }
}

function drawHint() {
  if (G.hint <= 0 || phase !== "play" || G.stamp) return;
  const a = clamp(G.hint * 1.5, 0, 1), t = G.time;
  const text = FINE ? "Move to aim · click to drop" : "Drag to aim · let go to drop";
  const cx = X(BW / 2), cy = Y(6.4);
  ctx.save(); ctx.globalAlpha = a;
  const fs = clamp(0.44 * L.s, 13, 17); ctx.font = `800 ${fs}px ${FONT}`;
  const maxW = BW * L.s - 24, tw = Math.min(ctx.measureText(text).width, maxW - fs * 2), w = tw + fs * 2, h = fs * 2.5;
  if (ctx.measureText(text).width > tw) fitFont(ctx, 800, fs, text, tw, 12);
  ctx.fillStyle = INK; roundRect(ctx, cx - w / 2, cy - h / 2, w, h, h / 2); ctx.fill();
  ctx.fillStyle = PAPER; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(text, cx, cy + 1);
  // a thumb sweeping left and right
  const fx = cx + Math.sin(t * 3) * BW * L.s * 0.22, fy = cy + h * 1.25;
  ctx.strokeStyle = "rgba(19,19,19,0.18)"; ctx.lineWidth = 3; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(cx - BW * L.s * 0.22, fy); ctx.lineTo(cx + BW * L.s * 0.22, fy); ctx.stroke();
  ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(fx, fy, 9, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = PAPER; ctx.lineWidth = 3; ctx.stroke();
  ctx.fillStyle = "rgba(19,19,19,0.45)"; ctx.font = `900 16px ${FONT}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText("<", cx - BW * L.s * 0.22 - 16, fy + 1); ctx.fillText(">", cx + BW * L.s * 0.22 + 16, fy + 1);
  ctx.restore();
}

function drawStamp() {
  const st = G.stamp; if (!st) return;
  const age = st.max - st.life, k = easeOutBack(age / 0.38), a = Math.min(1, st.life / 0.35);
  const cx = X(BW / 2), cy = Y(st.big ? 5.6 : 4.4), maxW = BW * L.s * 0.92;
  ctx.save(); ctx.globalAlpha = a; ctx.translate(cx, cy); ctx.scale(k, k); ctx.rotate(st.big ? -0.04 : -0.06);
  const longest = st.text.reduce((m, s) => (s.length > m.length ? s : m), "");
  const fs = fitFont(ctx, 900, L.s * (st.big ? 2.1 : 2.4), longest, maxW, 20);
  ctx.font = `900 ${fs}px ${FONT}`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.lineJoin = "round";
  const lh = fs * 0.9, y0 = -((st.text.length - 1) * lh) / 2;
  st.text.forEach((line, i) => {
    ctx.lineWidth = fs * 0.22; ctx.strokeStyle = PAPER; ctx.strokeText(line, 0, y0 + i * lh);
    ctx.fillStyle = st.big ? SHOTS[i % 5 === 0 ? 0 : (i * 2) % 5].color : INK; ctx.fillText(line, 0, y0 + i * lh);
  });
  if (st.big) { ctx.fillStyle = INK; ctx.font = `900 ${fs * 0.36}px ${FONT}`; ctx.lineWidth = fs * 0.1; ctx.strokeText(`+${fmt(WELLBEING_BONUS)} bonus`, 0, y0 + st.text.length * lh * 0.98); ctx.fillText(`+${fmt(WELLBEING_BONUS)} bonus`, 0, y0 + st.text.length * lh * 0.98); }
  ctx.restore();
}
function drawConfetti() {
  for (const c of G.confetti) {
    ctx.save(); ctx.globalAlpha = Math.min(1, c.life * 1.5); ctx.translate(c.x, c.y); ctx.rotate(c.rot); ctx.fillStyle = c.col;
    if (c.round) { ctx.beginPath(); ctx.arc(0, 0, c.w * 0.45, 0, Math.PI * 2); ctx.fill(); } else ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h * Math.abs(Math.cos(c.rot * 1.7)) + 1);
    ctx.restore();
  }
}

// =====================================================================================
// Loop
// =====================================================================================
function frame(ts) {
  requestAnimationFrame(frame);
  const dt = lastTs ? Math.min(0.1, (ts - lastTs) / 1000) : 0; lastTs = ts;
  if (!L) return;
  // dynamic resolution: if a run is consistently under ~45 fps, render at a lower pixel ratio
  if (phase === "play" && dt > 0) {
    perf.ema = perf.ema * 0.92 + dt * 0.08;
    perf.slow = perf.ema > 0.022 ? perf.slow + dt : 0;
    if (perf.slow > 1.2 && dprCap > 1.25 && L.dpr > 1.25) { dprCap = Math.max(1.25, L.dpr - 0.375); perf.slow = 0; perf.ema = 1 / 60; layout(); }
  }
  let alpha = 1;
  if (G && phase === "play") {
    if (G.hitStop > 0) { G.hitStop -= dt; }
    else { acc += dt; let n = 0; while (acc >= DT && n < 6) { fixedStep(); acc -= DT; n++; if (phase !== "play") break; } if (n === 6) acc = 0; }
    alpha = clamp(acc / DT, 0, 1);
    update(dt);
  } else if (G && (phase === "capping" || phase === "end")) { updateCapping(dt); update(dt); }
  render(alpha);
}

// =====================================================================================
// Input
// =====================================================================================
function aimAt(clientX) { if (!G) return; const r = RAD(G.current); G.aim = clamp((clientX - L.ox) / L.s, r, BW - r); }
cv.addEventListener("pointerdown", (e) => {
  if (phase !== "play" || !G) return;
  G.dragging = true; G.pointerId = e.pointerId; try { cv.setPointerCapture(e.pointerId); } catch {}
  aimAt(e.clientX);
});
cv.addEventListener("pointermove", (e) => { if (phase !== "play" || !G) return; if (e.pointerType === "mouse" || (G.dragging && e.pointerId === G.pointerId)) aimAt(e.clientX); });
cv.addEventListener("pointerup", (e) => { if (!G || !G.dragging || e.pointerId !== G.pointerId) return; G.dragging = false; if (phase === "play") { aimAt(e.clientX); drop(); } });
cv.addEventListener("pointercancel", () => { if (G) G.dragging = false; });
lockTouch(cv, () => phase === "play");
addEventListener("keydown", (e) => {
  if (phase === "play" && G) {
    if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") { G.keyDir = -1; e.preventDefault(); }
    else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") { G.keyDir = 1; e.preventDefault(); }
    else if (e.key === " " || e.key === "Enter" || e.key === "ArrowDown") { if (!e.repeat) drop(); e.preventDefault(); }
    else if (e.key === "p" || e.key === "P" || e.key === "Escape") pauseGame();
  } else if (phase === "paused" && (e.key === "p" || e.key === "P" || e.key === "Escape")) resumeGame();
});
addEventListener("keyup", (e) => {
  if (!G) return;
  if ((e.key === "ArrowLeft" || e.key === "a" || e.key === "A") && G.keyDir < 0) G.keyDir = 0;
  if ((e.key === "ArrowRight" || e.key === "d" || e.key === "D") && G.keyDir > 0) G.keyDir = 0;
});
addEventListener("resize", () => { layout(); drawHeroChain(); });
addEventListener("orientationchange", () => setTimeout(() => { layout(); drawHeroChain(); }, 120));
document.addEventListener("visibilitychange", () => { if (document.hidden && phase === "play") pauseGame(); });

// =====================================================================================
// Screens
// =====================================================================================
function show(id) { const el = $(id); el.classList.remove("hidden"); el.scrollTop = 0; requestAnimationFrame(() => el.classList.remove("fade")); }
function hide(id) { const el = $(id); el.classList.add("hidden"); el.classList.add("fade"); }
function startGame(withSound = true) {
  hide("start"); hide("end"); hide("pausescr");
  newGame(); phase = "play"; acc = 0; lastTs = 0;
  dropOld(); setBottle(null); bottle.fade = 1;
  $("pause").classList.add("on");
  if (withSound) { sound.init(); sound.resume(); sound.startMusic(); }
}
function pauseGame() { if (phase !== "play") return; phase = "paused"; G.dragging = false; G.keyDir = 0; show("pausescr"); $("pause").classList.remove("on"); sound.suspend(); }
function resumeGame() { if (phase !== "paused") return; hide("pausescr"); phase = "play"; lastTs = 0; acc = 0; $("pause").classList.add("on"); sound.resume(); }

const SND_ON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="M15.5 9a4.5 4.5 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11"/></svg>';
const SND_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="M16 9.5l5 5M21 9.5l-5 5"/></svg>';
function syncSnd() { document.querySelectorAll("[data-snd]").forEach((b) => { b.innerHTML = (audio.muted ? SND_OFF : SND_ON) + `<span>${audio.muted ? "Sound off" : "Sound on"}</span>`; b.setAttribute("aria-pressed", String(!audio.muted)); }); }
document.querySelectorAll("[data-snd]").forEach((b) => b.addEventListener("click", () => { audio.setMuted(!audio.muted); syncSnd(); if (!audio.muted) { sound.init(); sound.ui(); } }));
syncSnd();

$("play").addEventListener("click", () => startGame(true));
$("again").addEventListener("click", () => startGame(true));
$("resume").addEventListener("click", resumeGame);
$("restart").addEventListener("click", () => { sound.resume(); sound.stopMusic(0.2); setTimeout(() => startGame(true), 60); });
$("pause").addEventListener("click", pauseGame);

// leaderboard
const roundLabel = (n) => tierInfo(n).label.replace(" In One Shot.", "");
board.onChange((view) => { renderBoard($("board1"), view, { roundLabel }); renderBoard($("board2"), view, { roundLabel }); });
board.load();

// the evolution line (start hero + end-screen collection)
function drawChain(canvas, lit) {
  const r0 = canvas.getBoundingClientRect(); if (!r0.width) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1), W = r0.width, H = r0.height;
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  const c = canvas.getContext("2d"); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H);
  const ov = 0.16, xs = [RAD(1)];
  for (let t = 2; t <= 8; t++) xs.push(xs[t - 2] + (RAD(t - 1) + RAD(t)) * (1 - ov));
  const span = xs[7] + RAD(8), k = Math.min((W - 4) / span, (H - 6) / (2 * RAD(8))), x0 = (W - span * k) / 2;
  for (let t = 1; t <= 8; t++) {
    const r = RAD(t) * k, cx = x0 + xs[t - 1] * k, cy = H - 4 - r;
    if (!lit || lit.has(t)) {
      c.fillStyle = "rgba(40,30,20,0.12)"; c.beginPath(); c.ellipse(cx, H - 3, r * 0.9, Math.max(1.5, r * 0.08), 0, 0, Math.PI * 2); c.fill();
      blit(c, t, cx, cy, r, dpr, t <= 5 ? -0.12 : 0);
    } else { c.save(); c.setLineDash([3, 3]); c.lineWidth = 1.5; c.strokeStyle = STONE_DARK; c.beginPath(); c.arc(cx, cy, r - 1, 0, Math.PI * 2); c.stroke(); c.restore(); }
  }
}
function drawHeroChain() { drawChain($("herochain"), null); if (phase === "end" && G) drawChain($("endchain"), G.discovered); }

// ---------- end of a run ----------
function endGame() {
  phase = "end";
  const g = G, score = g.score, newBest = score > best && score > 0;
  if (newBest) { best = score; try { localStorage.setItem("ryde:drop:best", String(best)); } catch {} }
  const topT = Math.min(9, g.wellbeing ? 9 : g.highest), top = tierInfo(topT);   // same as the posted `round`
  const sb = $("scoreblock");
  const bgs = { 6: "linear-gradient(120deg,#F4F5F6,#C9CCD0 45%,#EEF0F1)", 7: "linear-gradient(120deg,#FFD3B8,#F3DDF0 35%,#CDBDF5 65%,#BDEBDF)", 8: "linear-gradient(120deg,#EE3831 0 20%,#FFC845 20% 40%,#06AF9A 40% 60%,#6A9EF0 60% 80%,#8564AB 80%)" };
  sb.style.setProperty("--bg", topT <= 5 ? top.color : bgs[Math.min(8, topT)]);
  $("endeyebrow").textContent = "Capped. That's your day";
  $("endscore").textContent = fmt(score);
  $("endbest").innerHTML = newBest ? `<span class="new">New personal best</span>` : best ? `Your best: ${fmt(best)}` : "";
  $("endstats").innerHTML = `<div><b>${top.short}</b>Top moment</div><div><b>${g.merges}</b>Merges</div><div><b>×${g.bestChain}</b>Best chain</div>`;
  // reward
  const got = REWARDS.filter((r) => score >= r.at).pop(), nxt = REWARDS.find((r) => score < r.at), rw = $("reward");
  if (got) {
    rw.className = "reward";
    rw.innerHTML = `<div class="label">Your Black Friday code</div><b class="code">${got.code}</b><div class="t">${got.off}${got.extra ? " " + got.extra : ""}.${nxt ? ` ${fmt(nxt.at - score)} more for ${nxt.off.replace(" the range", "")}.` : ""}</div>`;
  } else {
    rw.className = "reward locked";
    const pc = Math.round((score / nxt.at) * 100);
    rw.innerHTML = `<div class="label">Black Friday code</div><b>${fmt(nxt.at - score)} to go</b><div class="t">Score ${fmt(nxt.at)} to unlock ${nxt.off}.</div><div class="bar"><i style="width:${pc}%"></i></div>`;
  }
  const btn = $("post"); btn.disabled = false; btn.textContent = "Post score"; btn.classList.remove("held");
  $("postnote").textContent = ""; $("name").value = savedName();
  board.load();
  show("end");
  requestAnimationFrame(() => drawChain($("endchain"), g.discovered));
}
$("post").addEventListener("click", async () => {
  const name = $("name").value.trim().toUpperCase().slice(0, 12), btn = $("post"), note = $("postnote");
  if (!name) { note.textContent = "Pop a name in first."; $("name").focus(); return; }
  if (!G) return;
  btn.disabled = true; btn.textContent = "Posting…"; note.textContent = "";
  try {
    const res = await board.post({ name, score: G.score, round: G.highest, detail: G.merges });
    if (res && res.status === "review") { btn.textContent = "Held"; btn.classList.add("held"); note.textContent = HELD_NOTE; }
    else { btn.textContent = "Posted"; note.textContent = "You're on the board. Good luck in the draw."; }
  } catch { btn.disabled = false; btn.textContent = "Post score"; note.textContent = "Offline — try again"; }
});
$("name").addEventListener("input", (e) => { e.target.value = e.target.value.toUpperCase(); });
$("name").addEventListener("keydown", (e) => { if (e.key === "Enter") $("post").click(); });

// =====================================================================================
// QC hooks
// =====================================================================================
window.__game = {
  state() {
    const b = G ? G.world.bodies : [];
    let maxOverlap = 0;
    for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) { const o = b[i].r + b[j].r - Math.hypot(b[i].x - b[j].x, b[i].y - b[j].y); if (o > maxOverlap) maxOverlap = o; }
    return { phase, score: G ? G.score : 0, pieces: b.length, highestTier: G ? G.highest : 0, overLineTime: G ? +G.over.toFixed(3) : 0, merges: G ? G.merges : 0,
      bestChain: G ? G.bestChain : 0, combo: G ? G.combo : 0, drops: G ? G.drops : 0, current: G ? G.current : 0, next: G ? G.next : 0,
      discovered: G ? [...G.discovered].sort((a, c) => a - c) : [], dpr: L ? L.dpr : 0, asleep: b.filter((x) => x.asleep).length, maxOverlap: +maxOverlap.toFixed(4), seed, time: G ? +G.time.toFixed(2) : 0, wellbeing: G ? G.wellbeing || 0 : 0 };
  },
  start() { startGame(false); },
  setSeed(n) { setSeed(n); },
  spawn(tier = 1, x) { if (!G) return; const t = clamp(tier | 0, 1, 8), r = RAD(t); const xx = x == null ? rng() : x; addPiece(t, r + clamp(xx, 0, 1) * (BW - 2 * r), CAP_BOT + r + 0.05); },
  drop(x) { if (!G || phase !== "play") return; if (x != null) { const r = RAD(G.current); G.aim = r + clamp(x, 0, 1) * (BW - 2 * r); G.capX = G.aim; } G.cool = 0; G.hangT = 1; drop(); },
  fill(n = 20) { if (G) G.fillQueue += n; },
  advance(sec = 1) { if (!G) return; const n = Math.round(sec / DT); for (let i = 0; i < n && phase === "play"; i++) fixedStep(); },
  bodies() { return G ? G.world.bodies.map((b) => ({ tier: b.tier, x: +b.x.toFixed(3), y: +b.y.toFixed(3), r: +b.r.toFixed(3), vx: +b.vx.toFixed(3), vy: +b.vy.toFixed(3), asleep: b.asleep })) : []; },
  forceGameOver() { startCapping(); },
  pause() { pauseGame(); },
  resume() { resumeGame(); },
};

// boot
layout();
requestAnimationFrame(frame);
loadFont().then(() => { clearSprites(); setBottle(null); drawHeroChain(); });
drawHeroChain();

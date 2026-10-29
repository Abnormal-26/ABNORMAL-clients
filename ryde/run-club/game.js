/**
 * Ryde: Run Club — one-tap endless runner. A Ryde shot in sneakers runs through a day; every label line
 * on the range is a power-up. Concept prototype by ABNORMAL.
 *
 * Testing hooks (window.__game):
 *   state()          → { phase, distance (m), speed (m/s), power, powerT, nap, dots, score, day, seed, y, onGround, invT, paused, autopilot, invincible }
 *   start()          → start a run (as if Play was tapped; audio stays silent until a real tap)
 *   skipTo(metres)   → jump the current run to a distance (rebuilds the world there; day, speed and patterns follow)
 *   invincible(on)   → ignore crashes (obstacles get knocked away, gaps bounce you out)
 *   give(id)         → trigger a power-up now: energy | focus | exercise | relax | sleep
 *   setSeed(n)       → fix the world seed for the next run (null = random)
 *   autopilot(on)    → the fairness planner plays for you (also proves every pattern is clearable)
 *   crash()          → end the current run now (for end-screen QC)
 *   pause() / resume()
 * Late-game QC: __game.start(); __game.setSeed(7); __game.skipTo(1900); __game.autopilot(true)
 */
import { SHOT, SHOTS, INK, STONE, FONT, loadFont, lockTouch, buzz, safeInsets, drawWordmark, drawDot, fitFont, roundRect as rr } from "../shared/brand.js";
import { createBoard, renderBoard, savedName } from "../shared/board.js";
import { createAudio } from "../shared/audio.js";
import { U, TICK, V0, VMAX, HERO, newHero, createWorld, generate, physStep, plan, prune, reflow, clearRange, surfaceAt, ix, dayAt, OB } from "./sim.js";
import { drawHero, drawBottleBody, drawCap, drawOb, outlineOb, drawHint, drawPower, drawSign, createCity, drawSky, drawGround, paletteAt, rgba, rgbOf, mix, signText, bannerOf } from "./art.js";

const $ = (id) => document.getElementById(id);
const cv = $("game"), ctx = cv.getContext("2d");
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, f) => a + (b - a) * f;
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const store = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };

const REWARDS = [
  { m: 500, code: "RUN10", off: "10% off the range" },
  { m: 1000, code: "RUN15", off: "15% off the range" },
  { m: 2000, code: "RUN20", off: "20% off the range", extra: "and you're in the draw for a year of Ryde" },
];
const DUR = { energy: 4, focus: 5, exercise: 10, relax: 12 };
const CAUSE = {
  cone: "Coned. It happens.", bin: "Wheelie bin: 1. You: 0.", paper: "Buried in paperwork.", puddle: "Splash. New socks, soaked.",
  scooter: "Rogue e-scooter. Of course.", pigeon: "Pigeon'd.", gap: "Mind the gap.", wall: "Missed the step up.",
};
const causeOf = (hit) => {
  if (hit.kind !== "ob") return CAUSE[hit.kind];
  const it = hit.it;
  if (it.type === "aframe") { const t = signText(it).join(" "); return t === "MONDAY" ? "Monday got you. Classic Monday." : t === "REPLY ALL" ? "Caught in a reply-all." : "8am got you."; }
  if (it.type === "banner") return `Tangled in the ${bannerOf(it)[0].toLowerCase()} banner.`;
  return CAUSE[it.type] || "Down you go.";
};

/* ── layout ─────────────────────────────────────────────────────────────── */
let dpr = 1; const L = { W: 390, H: 844, colW: 390, colX: 0, band: 220, groundPx: 600 }; let ins = { t: 0, r: 0, b: 0, l: 0 };
function layout() {
  const w = innerWidth, h = innerHeight; dpr = Math.min(2, devicePixelRatio || 1);
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.width = w + "px"; cv.style.height = h + "px";
  ins = safeInsets();
  L.W = w; L.H = h; L.land = w > h && h < 560;
  if (L.land) {   // landscape phones: a full-width side-scroller, world scaled to the height
    L.colX = 0; L.colW = w; L.band = Math.round(h * 0.18); L.groundPx = h - L.band;
    L.landScale = clamp((L.groundPx - ins.t - 40) / 300, 0.6, 1.2);
  } else {        // portrait phones + desktop: a portrait column (max 480px), stone either side
    L.colW = Math.round(Math.min(w, 480, h * 0.9)); L.colX = Math.round((w - L.colW) / 2);
    L.band = Math.round(clamp(h * 0.22, 72, 200)); L.groundPx = h - L.band;
  }
  sizePreview();
}
const viewWFor = (z) => 400 + 90 * z;   // world units across the column; widens with speed so you always see ~1.2 s ahead
/** Camera: world units across the screen and the px-per-unit scale. Landscape keeps the hero's size and shows more road. */
function cam() {
  const z = R ? R.zoom : 0;
  if (L.land) { const scale = L.landScale * (1 - 0.1 * z); return { scale, viewW: L.colW / scale }; }
  const viewW = viewWFor(z); return { viewW, scale: L.colW / viewW };
}

/* ── audio ──────────────────────────────────────────────────────────────── */
const audio = createAudio(); let lp = null, seq = null;
function audioInit() {
  const C = audio.init();
  if (!lp && C) { lp = C.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 18000; audio.music.disconnect(); audio.music.connect(lp); lp.connect(audio.master); }
}
const sfx = {
  step: () => audio.noise(0.03, { vol: 0.045, f: 2400, q: 1.4 }),
  jump: (dbl) => { audio.tone(dbl ? 520 : 340, 0.16, { type: "sine", vol: 0.13, slide: dbl ? 1150 : 720 }); audio.noise(0.12, { vol: 0.05, f: 1300, q: 0.7 }); },
  land: () => { audio.tone(150, 0.12, { type: "sine", vol: 0.2, slide: 55 }); audio.noise(0.06, { vol: 0.05, f: 500, type: "lowpass" }); },
  dot: (n) => { const sc = [0, 2, 4, 7, 9], k = Math.min(n, 14); const md = 72 + sc[k % 5] + 12 * Math.floor(k / 5); audio.tone(mtof(md), 0.12, { type: "triangle", vol: 0.09 }); audio.tone(mtof(md + 12), 0.07, { type: "sine", vol: 0.04 }); },
  power: (id) => {
    const now = audio.now();
    const P = { energy: [[60, 64, 67, 72, 76, 79], "square", 0.05, 0.06], focus: [[79, 84, 91, 96], "sine", 0.09, 0.45], exercise: [[67, 71, 74, 79, 83], "triangle", 0.06, 0.1], relax: [[60, 64, 67, 71], "sine", 0.1, 0.35], sleep: [[84, 79, 76, 72, 67], "sine", 0.11, 0.4] }[id];
    P[0].forEach((n, i) => audio.tone(mtof(n), P[3], { type: P[1], vol: id === "energy" ? 0.06 : 0.12, when: now + i * P[2] }));
    if (id === "energy") audio.noise(0.5, { vol: 0.08, f: 900, q: 0.5 });
  },
  crash: () => { audio.noise(0.35, { vol: 0.35, f: 700, type: "lowpass" }); audio.tone(320, 0.45, { type: "sawtooth", vol: 0.09, slide: 60 }); },
  pop: () => audio.tone(880, 0.09, { type: "sine", vol: 0.16, slide: 1500 }),
  knock: () => { audio.noise(0.12, { vol: 0.2, f: 1200, q: 0.6 }); audio.tone(240, 0.1, { type: "square", vol: 0.05, slide: 120 }); },
  chime: () => { const n = audio.now(); audio.tone(mtof(84), 0.3, { vol: 0.08, when: n }); audio.tone(mtof(88), 0.4, { vol: 0.08, when: n + 0.09 }); },
  reward: () => { const n = audio.now(); [72, 76, 79, 84, 88].forEach((m, i) => audio.tone(mtof(m), 0.25, { type: "triangle", vol: 0.1, when: n + i * 0.07 })); },
  ding: () => { audio.tone(1760, 0.25, { vol: 0.05 }); audio.tone(2349, 0.2, { vol: 0.03, when: audio.now() + 0.11 }); },
  coo: () => { audio.tone(330, 0.12, { vol: 0.04, slide: 280 }); },
};
function startMusic() {
  stopMusic();
  const roots = [48, 45, 41, 43], minor = [false, true, false, false];
  seq = audio.sequence(118, (i, when) => {
    if (!R || phase !== "play" || R.paused || R.napT > 0) return;
    const I = R.intensity, st = i % 16, bar = Math.floor(i / 16) % 4, root = roots[bar];
    if (st % 4 === 0 && (I > 0.22 || st % 8 === 0)) audio.kick(when, 0.75);
    if (st === 4 || st === 12) audio.snare(when, 0.26);
    if (st % 4 === 2) audio.hat(when, 0.1); else if (I > 0.55 && st % 2 === 1) audio.hat(when, 0.045);
    if ([0, 3, 6, 8, 11, 14].includes(st)) audio.bass(mtof(root + (st === 6 || st === 14 ? 12 : 0)), when, 0.2, 0.24);
    if (I > 0.32 && [0, 2, 3, 6, 8, 10, 11, 14].includes(st)) { const ch = minor[bar] ? [0, 3, 7, 12, 15] : [0, 4, 7, 12, 16]; audio.pluck(mtof(root + 24 + ch[(st * 3 + bar) % 5]), when, 0.13, 0.07 + I * 0.05); }
    if (R.power && R.power.id === "energy" && st % 2 === 0) audio.pluck(mtof(root + 36 + [0, 7, 12, 7][(st / 2) % 4]), when, 0.08, 0.05);
  });
}
function stopMusic() { if (seq) { seq.stop(); seq = null; } }

/* ── state ──────────────────────────────────────────────────────────────── */
let phase = "start";               // start | play | dying | end
let R = null;                      // the current run
let fixedSeed = null, invincible = false, autopilot = false, audioArmed = false;
let runAs = store.get("ryde-run:as", "exercise"); if (!SHOT[runAs]) runAs = "exercise";
const city = createCity(11);
const STARS = Array.from({ length: 40 }, (_, i) => [((i * 0.6180339) % 1), ((i * 0.37 + Math.sin(i) * 0.31 + 1) % 1), ((i * 0.77) % 1)]);
const isTouch = matchMedia("(pointer: coarse)").matches;

function newRun(startM = 0) {
  const seed = fixedSeed ?? ((Math.random() * 1e9) | 0);
  const S = newHero(startM * U);
  R = { seed, W: createWorld(seed, startM), S, prev: { x: S.x, y: S.y, t: 0 }, acc: 0, dots: 0, combo: 0, comboT: 0, power: null, nap: false, napT: 0,
    invT: 0, ts: 1, tsTarget: 1, stop: 0, cyc: 0, stepPh: 0, sq: 0, sqv: 0, shake: 0, nudge: 0, nudgeV: 0, parts: [], knocked: [], toasts: [], banner: null, flash: null,
    hintT: 0, rw: REWARDS.filter((r) => startM >= r.m).length, dayI: dayAt(startM).i, dayId: dayAt(startM).id, zoom: 0, intensity: 0.15, cmds: [], cur: null, lastPlan: -9,
    bulb: 0, tumble: null, dieT: 0, cause: "", pressQ: false, paused: false, camX: S.x - 100, signPulse: 0, jetOn: false, startM, maxCombo: 0, powersUsed: 0, log: [] };
  city.reset();
}

/* ── input ──────────────────────────────────────────────────────────────── */
const ptrs = new Set(); let keyDown = false;
const isDown = () => ptrs.size > 0 || keyDown;
function pauseRect() { const r = 20, x = L.colX + L.colW - 16 - r - (L.land ? ins.r : 0), y = ins.t + 14 + r; return { x, y, r }; }
cv.addEventListener("pointerdown", (e) => {
  if (phase !== "play" || !R) return;
  e.preventDefault();
  if (R.paused) { resumeGame(); return; }
  const p = pauseRect(); if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < p.r + 10) { pauseGame(); return; }
  if (!audioArmed) { audioInit(); audioArmed = true; startMusic(); }
  ptrs.add(e.pointerId); try { cv.setPointerCapture(e.pointerId); } catch {}
  R.pressQ = true;
}, { passive: false });
const up = (e) => ptrs.delete(e.pointerId);
addEventListener("pointerup", up); addEventListener("pointercancel", up); cv.addEventListener("lostpointercapture", up);
addEventListener("keydown", (e) => {
  const jumpKey = e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW";
  if (phase === "play" && R) {
    if (jumpKey) { e.preventDefault(); if (R.paused) { resumeGame(); return; } if (!e.repeat) { keyDown = true; R.pressQ = true; } }
    if (e.code === "Escape" || e.code === "KeyP") { R.paused ? resumeGame() : pauseGame(); }
  } else if ((phase === "start" || phase === "end") && (e.code === "Enter" || (jumpKey && document.activeElement?.tagName !== "INPUT"))) {
    if (document.activeElement?.tagName === "INPUT") return;
    e.preventDefault(); play();
  }
});
addEventListener("keyup", (e) => { if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW") keyDown = false; });
lockTouch(cv, () => phase === "play" || phase === "dying");

function pauseGame() { if (phase !== "play" || !R || R.paused) return; R.paused = true; ptrs.clear(); keyDown = false; $("pause").classList.remove("hidden"); if (audio.ctx) audio.ctx.suspend(); }
function resumeGame() { if (!R || !R.paused) return; R.paused = false; $("pause").classList.add("hidden"); if (audio.ctx) audio.ctx.resume(); lastTs = 0; }
document.addEventListener("visibilitychange", () => { if (document.hidden) { if (phase === "play") pauseGame(); else if (audio.ctx) audio.ctx.suspend(); } else if (phase !== "play" && audio.ctx) audio.ctx.resume(); });
addEventListener("blur", () => { if (phase === "play" && !isTouch) pauseGame(); });
$("resume").addEventListener("click", resumeGame);
$("quit").addEventListener("click", () => { if (!R) return; resumeGame(); crash({ kind: "quit" }); });

/* ── simulation tick (fixed 120 Hz) ─────────────────────────────────────── */
const jetCeil = () => Math.max(110, Math.min(230, (L.groundPx - ins.t - 122) / cam().scale - 102));   // keep the hero clear of the HUD
function tick() {
  if (R.napT > 0) return;
  const W = R.W, S = R.S;
  R.prev = { x: S.x, y: S.y, t: S.t };
  let pressed = R.pressQ; R.pressQ = false; let down = isDown() || pressed;
  if (autopilot) ({ pressed, down } = autoInput());
  const pw = R.power && R.power.id;
  const mods = { speedMul: pw === "exercise" ? 1.12 : 1, dj: pw === "exercise", jet: pw === "energy", ceil: jetCeil(), until: pw === "exercise" ? R.power.until : null };
  R.jetOn = mods.jet && down;
  const wasY = S.y;
  const hit = physStep(W, S, TICK, down, pressed, mods);
  if (S.ev & 1) onJump(false); if (S.ev & 2) onJump(true); if (S.ev & 4) onLand(wasY);
  if (hit) handleHit(hit);
  if (phase !== "play" || R.napT > 0) return;
  collect();
  // timers
  R.invT -= TICK; R.comboT -= TICK; if (R.comboT <= 0) R.combo = 0;
  if (R.power) {
    R.power.t -= R.power.id === "focus" ? TICK / Math.max(0.3, R.ts) : TICK;
    // the sneakers' speed boost only runs out on the ground, so a jump is never cut short mid-air
    if (R.power.id === "exercise" ? S.boostOff : R.power.t <= 0) endPower();
  }
  R.camX = S.x - 0.22 * cam().viewW;
  generate(W, S, S.x + 1800, { powerActive: !!R.power });
  prune(W, R.camX - 40, S.t);
  progress();
}
function autoInput() {
  const S = R.S;
  if (R.power && R.power.id === "energy") return { pressed: false, down: S.y < 150 };
  if (S.onGround && !R.cur && S.t - R.lastPlan > 0.2) { R.lastPlan = S.t; const ex = R.power && R.power.id === "exercise"; R.cmds = plan(R.W, S, ex ? { speedMul: 1.12, until: R.power.until } : {}) || []; }
  const k = Math.round(S.t / TICK); let pressed = false;
  if (!R.cur && R.cmds.length && Math.round(R.cmds[0].t / TICK) <= k) { R.cur = R.cmds.shift(); pressed = true; }
  const down = R.cur ? S.t - R.cur.t < R.cur.hold : false;
  if (R.cur && S.onGround && !pressed) R.cur = null;
  return { pressed, down };
}
function onJump(dbl) {
  R.sq = 0.2; R.sqv = 0; sfx.jump(dbl); R.hintSeen = (R.hintSeen || 0) + 1;
  const S = R.S;
  for (let i = 0; i < (dbl ? 10 : 6); i++) puff(S.x - 6 + Math.random() * 10, S.y + 2, dbl ? SHOT.exercise.color : null);
  if (dbl) ring(S.x, S.y + 6, SHOT.exercise.color);
}
function onLand(prevY) {
  const S = R.S, hard = clamp((prevY - S.y) / 6 + 0.5, 0.5, 1);
  R.sq = -0.2 * hard; R.sqv = 0; R.nudgeV = 90 * hard; sfx.land();
  for (let i = 0; i < 7; i++) puff(S.x - 12 + Math.random() * 24, S.y + 1);
}
function handleHit(hit) {
  const S = R.S, pw = R.power && R.power.id;
  const safe = pw === "energy" || R.invT > 0 || invincible;
  if (safe || pw === "relax") {
    if (hit.kind === "ob") knock(hit.it);
    else if (hit.kind === "wall") { S.y = hit.seg.h; S.vy = 0; S.onGround = true; S.jumping = false; }
    else if (hit.kind === "gap") { S.y = Math.max(S.y, -30); S.vy = 950; S.onGround = false; S.jumping = true; S.cut = true; S.ja = 1; puffs(S.x, S.y, 10, SHOT.relax.light); }
    if (!safe) {   // & comfy socks take the hit
      R.power = null; R.invT = 1.0; sfx.pop(); buzz(25);
      for (let i = 0; i < 16; i++) part({ x: S.x + rnd(-8, 8), y: S.y + 8, vx: rnd(-160, 160), vy: rnd(80, 360), r: rnd(3, 6), c: Math.random() < 0.5 ? SHOT.relax.light : SHOT.relax.color, life: 0.8, g: 600 });
      toast("Saved by the socks", SHOT.relax.color); R.log.push({ ev: "socks", kind: hit.kind, m: Math.floor(S.x / U) });
    }
    return;
  }
  if (R.nap) { startNap(); return; }
  crash(hit);
}
function knock(it) {
  if (it.gone) return; it.gone = true; sfx.knock(); R.shake = Math.max(R.shake, 4);
  R.knocked.push({ it, x: ix(it, R.S.t), base: it.base, t: R.S.t, vx: 240 + Math.random() * 120, vy: 380 + Math.random() * 160, rot: 0, vr: rnd(-12, 12), life: 1.2 });
}
function collect() {
  const S = R.S, jet = R.power && R.power.id === "energy";
  for (const it of R.W.items) {
    if (it.k === "dot" && !it.got) {
      if (jet) { const dx = S.x + 6 - it.x0, dy = S.y + 45 - it.y, d = Math.hypot(dx, dy); if (d < 170 && d > 1) { const k = Math.min(1, (700 * TICK) / d); it.x0 += dx * k; it.y += dy * k; } }
      if (Math.abs(it.x0 - S.x) < HERO.HW + 10 && it.y > S.y - 6 && it.y < S.y + HERO.HH + 10) {
        it.got = true; R.dots++; R.combo++; R.comboT = 0.7; R.maxCombo = Math.max(R.maxCombo, R.combo); sfx.dot(R.combo - 1);
        const c = SHOTS[it.c].color; ring(it.x0, it.y, c, 0.35);
        for (let i = 0; i < 4; i++) part({ x: it.x0, y: it.y, vx: rnd(-90, 90), vy: rnd(-40, 160), r: 2.4, c, life: 0.4 });
      }
    } else if (it.k === "pow" && !it.got) {
      const by = it.base + it.y;
      if (Math.abs(it.x0 - S.x) < 24 && S.y < by + it.h + 8 && S.y + HERO.HH > by - 8) { it.got = true; givePower(it.id); }
    } else if (it.k === "sign" && !it.passed && S.x >= it.x0) { it.passed = true; R.signPulse = 1; sfx.chime(); }
    else if (it.k === "ob" && it.type === "scooter" && !it.dinged && ix(it, S.t) < R.camX + cam().viewW + 20) { it.dinged = true; sfx.ding(); }
    else if (it.k === "ob" && it.type === "pigeon" && !it.dinged && ix(it, S.t) < R.camX + cam().viewW + 20) { it.dinged = true; sfx.coo(); }
  }
}
function givePower(id) {
  const S = R.S, W = R.W, s = SHOT[id];
  if (id === "sleep") { R.nap = true; }
  else {
    if (R.power) endPower(true);
    R.power = { id, t: DUR[id], dur: DUR[id], until: S.t + DUR[id] }; S.boostOff = false;
    if (id === "energy") {   // regenerate the unseen road as open sky, with a clean runway where the jetpack runs out
      reflow(W, R.camX + cam().viewW + 30); W.flightTo = S.x + DUR.energy * S.v; W.landPending = true;
      S.vy = Math.max(S.vy, 300); S.onGround = false;
    }
    if (id === "focus") { R.tsTarget = 0.55; R.bulb = 1; }
  }
  R.powersUsed++; R.log.push({ ev: "power", id, m: Math.floor(S.x / U) });
  R.banner = { id, t: 0 }; R.stop = 0.07; R.flash = { c: s.color, t: 0.35 }; sfx.power(id); buzz(30);
  ring(S.x, S.y + 45, s.color, 0.6, 120);
  for (let i = 0; i < 22; i++) part({ x: S.x, y: S.y + 45, vx: rnd(-260, 260), vy: rnd(-200, 300), r: rnd(2.5, 5), c: i % 3 ? s.color : s.light, life: 0.7, g: 300 });
}
function endPower(silent) {
  const p = R.power; if (!p) return; R.power = null;
  if (p.id === "energy") { R.invT = Math.max(R.invT, 0.9); R.S.jumping = false; }
  if (p.id === "focus") { R.tsTarget = 1; }
  R.lastPlan = -9; R.cmds = []; R.cur = null;
  if (!silent) audio.tone(mtof(67), 0.15, { type: "triangle", vol: 0.06, slide: mtof(60) });
}
function startNap() {
  R.nap = false; R.napT = 1.6; R.log.push({ ev: "nap", m: Math.floor(R.S.x / U) }); sfx.power("sleep"); R.stop = 0.1; buzz(40);
  toast("Power nap. Back at it.", SHOT.sleep.color);
}
function endNap() {
  const S = R.S;
  const gone = clearRange(R.W, S.x - 90, S.x + 2.3 * S.v);
  for (const it of gone) if (it.k === "ob") puffs(ix(it, S.t) + it.w / 2, it.base + 20, 8, SHOT.sleep.light);
  S.y = Math.max(0, surfaceAt(R.W, S.x - 9, S.x + 9) ?? 0); S.vy = 0; S.onGround = true; S.jumping = false; R.invT = 1.3; R.prev = { x: S.x, y: S.y, t: S.t };
  for (let i = 0; i < 12; i++) part({ x: S.x + rnd(-20, 20), y: S.y + rnd(20, 90), vx: rnd(-30, 30), vy: rnd(40, 120), r: rnd(2, 4), c: SHOT.sleep.light, life: 0.9 });
}
function crash(hit) {
  if (phase !== "play") return;
  const S = R.S; phase = "dying"; R.log.push({ ev: "crash", kind: hit.kind, type: hit.it && hit.it.type, m: Math.floor(S.x / U) }); R.cause = hit.kind === "quit" ? "Called it a day." : causeOf(hit); R.dieT = hit.kind === "quit" ? 0.4 : 1.35;
  R.stop = 0.12; R.shake = 12; sfx.crash(); buzz(80); stopMusic(); ptrs.clear(); keyDown = false;
  const fell = hit.kind === "gap";
  R.tumble = { x: S.x, y: S.y, vx: fell ? 30 : -90, vy: fell ? 60 : 560, rot: 0, vr: -10, cx: S.x, cy: S.y + 80, cvx: 70, cvy: 760, cr: 0, popped: false, t: 0 };
  if (hit.kind === "ob") { const it = hit.it; it.wobble = 0.6; }
  for (let i = 0; i < 26; i++) part({ x: S.x, y: S.y + 40, vx: rnd(-280, 220), vy: rnd(150, 560), r: rnd(3.5, 6.5), c: SHOTS[i % 5].color, life: 1.4, g: 1400, bounce: true });
}

/* ── progress, toasts ───────────────────────────────────────────────────── */
function progress() {
  const m = R.S.x / U;
  R.intensity = clamp(0.15 + m / 900, 0.15, 1);
  if (R.rw < REWARDS.length && m >= REWARDS[R.rw].m) { const r = REWARDS[R.rw]; R.rw++; sfx.reward(); toast(`${r.code} unlocked`, INK, true); for (let i = 0; i < 20; i++) part({ x: R.S.x, y: R.S.y + 60, vx: rnd(-220, 220), vy: rnd(100, 420), r: rnd(3, 5), c: SHOTS[i % 5].color, life: 1, g: 700 }); }
  const d = dayAt(m); if (d.i !== R.dayI) { R.dayI = d.i; if (d.id !== R.dayId) toast(d.name, null); R.dayId = d.id; }
}
function toast(text, color, big) { R.toasts.push({ text, color, big, t: 0 }); if (R.toasts.length > 3) R.toasts.shift(); }

/* ── particles ──────────────────────────────────────────────────────────── */
const rnd = (a, b) => a + Math.random() * (b - a);
function part(p) { if (R.parts.length < 320) R.parts.push({ g: 0, ...p, max: p.life }); }
function puff(x, y, c) { part({ x, y, vx: rnd(-70, 20), vy: rnd(10, 60), r: rnd(3, 6), c: c || null, life: 0.45, grow: 10, kind: "dust" }); }
function puffs(x, y, n, c) { for (let i = 0; i < n; i++) part({ x: x + rnd(-14, 14), y: y + rnd(-6, 18), vx: rnd(-80, 80), vy: rnd(10, 120), r: rnd(4, 8), c, life: 0.6, grow: 8, kind: "dust" }); }
function ring(x, y, c, life = 0.4, rmax = 34) { part({ x, y, vx: 0, vy: 0, r: 4, c, life, kind: "ring", rmax }); }
function stepParts(dt) {
  for (const p of R.parts) { p.life -= dt; p.vy -= (p.g || 0) * dt; p.x += p.vx * dt; p.y += p.vy * dt; if (p.grow) p.r += p.grow * dt; if (p.bounce && p.y < 0) { p.y = 0; p.vy *= -0.45; p.vx *= 0.7; } }
  R.parts = R.parts.filter((p) => p.life > 0);
}

/* ── main loop ──────────────────────────────────────────────────────────── */
let lastTs = 0;
function frame(ts) {
  requestAnimationFrame(frame);
  const dtReal = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 0; lastTs = ts;
  if (phase === "start") { drawPreview(ts / 1000); if (!R) return; }
  if (!R) return;
  if (phase === "play" && !R.paused) {
    R.ts += (R.tsTarget - R.ts) * Math.min(1, dtReal * 7);
    if (R.stop > 0) R.stop -= dtReal;
    else if (R.napT > 0) { R.napT -= dtReal; if (R.napT <= 0) endNap(); }
    else { R.acc += dtReal * R.ts; let n = 0; while (R.acc >= TICK && n < 12) { tick(); R.acc -= TICK; n++; if (phase !== "play" || R.napT > 0 || R.stop > 0) break; } }
    R.hintT += dtReal;
  } else if (phase === "dying") {
    if (R.stop > 0) R.stop -= dtReal; else { stepTumble(dtReal); R.dieT -= dtReal; if (R.dieT <= 0) endRun(); }
  }
  if (!R.paused) animate(dtReal);
  render(phase === "play" && !R.paused && R.stop <= 0 && R.napT <= 0 ? clamp(R.acc / TICK, 0, 1) : 1, ts / 1000);
}
function animate(dt) {
  const S = R.S, sdt = dt * (phase === "play" ? R.ts : 1);
  // run cycle advances with distance (stride ≈ 58 units); a footstep tick on each plant
  if (phase === "play" && S.onGround && R.napT <= 0) {
    const ph = R.cyc; R.cyc += (S.v * sdt / 58) * Math.PI * 2;
    if (Math.floor(R.cyc / Math.PI) !== Math.floor(ph / Math.PI)) { sfx.step(); if (Math.random() < 0.5) puff(S.x - 8, S.y + 1); }
  }
  // squash & stretch spring; stretch with vertical speed in the air
  const target = S.onGround ? 0 : clamp(S.vy / 3200, -0.05, 0.12);
  R.sqv += ((target - R.sq) * 520 - R.sqv * 20) * dt; R.sq += R.sqv * dt;
  R.nudgeV += (-R.nudge * 500 - R.nudgeV * 22) * dt; R.nudge += R.nudgeV * dt;
  R.shake = Math.max(0, R.shake - dt * 40);
  R.zoom += (clamp((S.v - V0) / (VMAX - V0), 0, 1) - R.zoom) * Math.min(1, dt * 2);
  R.bulb = R.power && R.power.id === "focus" ? Math.min(1, R.bulb + dt * 4) : Math.max(0, R.bulb - dt * 3);
  R.signPulse = Math.max(0, R.signPulse - dt * 2.5);
  if (R.banner) { R.banner.t += dt; if (R.banner.t > 1.7) R.banner = null; }
  if (R.flash) { R.flash.t -= dt; if (R.flash.t <= 0) R.flash = null; }
  for (const t of R.toasts) t.t += dt; R.toasts = R.toasts.filter((t) => t.t < 1.9);
  for (const k of R.knocked) { k.life -= dt; k.vy -= 1400 * dt; k.x += k.vx * dt; k.base += k.vy * dt; k.rot += k.vr * dt; } R.knocked = R.knocked.filter((k) => k.life > 0);
  // power trails
  if (phase === "play" && R.power && R.napT <= 0 && Math.random() < 0.7) { const s = SHOT[R.power.id]; part({ x: S.x - 14 + rnd(-3, 3), y: S.y + rnd(14, 70), vx: rnd(-140, -60), vy: rnd(-10, 10), r: rnd(2, 4), c: Math.random() < 0.5 ? s.color : s.light, life: 0.35 }); }
  if (phase === "play" && R.nap && Math.random() < 0.02) part({ x: S.x - 6, y: S.y + 95, vx: -40, vy: 40, r: 0, c: SHOT.sleep.color, life: 1, kind: "z" });
  stepParts(dt * (phase === "play" ? R.ts : 1));
}
function stepTumble(dt) {
  const T = R.tumble; T.t += dt;
  T.vy -= 1700 * dt; T.x += T.vx * dt; T.y += T.vy * dt; T.rot += T.vr * dt;
  const floor = surfaceAt(R.W, T.x - 10, T.x + 10);
  if (floor !== null && T.y < floor && T.vy < 0 && T.y > floor - 30) { T.y = floor; T.vy *= -0.35; T.vx *= 0.6; T.vr *= 0.5; if (Math.abs(T.vy) > 60) sfx.land(); }
  if (!T.popped && T.t > 0.12) { T.popped = true; sfx.pop(); T.cx = T.x; T.cy = T.y + 80; }
  if (T.popped) { T.cvy -= 1500 * dt; T.cx += T.cvx * dt; T.cy += T.cvy * dt; T.cr += 14 * dt; const f2 = surfaceAt(R.W, T.cx - 5, T.cx + 5); if (f2 !== null && T.cy < f2 + 6 && T.cvy < 0 && T.cy > f2 - 30) { T.cy = f2 + 6; T.cvy *= -0.4; T.cvx *= 0.6; T.cr *= 0.6; } }
}

/* ── rendering ──────────────────────────────────────────────────────────── */
function render(alpha, now) {
  const S = R.S;
  const hx = lerp(R.prev.x, S.x, alpha), hy = lerp(R.prev.y, S.y, alpha), tr = lerp(R.prev.t, S.t, alpha);
  const { viewW, scale } = cam();
  const camX = hx - 0.22 * viewW; R.camX = camX;
  const m = hx / U, P = paletteAt(m);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (L.colX > 0) drawSides(P);
  ctx.save(); ctx.beginPath(); ctx.rect(L.colX, 0, L.colW, L.H); ctx.clip();
  const sh = R.shake, sx = sh ? rnd(-sh, sh) : 0, sy = sh ? rnd(-sh, sh) : 0;
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * (L.colX + sx), dpr * (L.groundPx + sy + R.nudge));
  const topY = -(L.groundPx + 20) / scale, bottom = (L.H - L.groundPx + 20) / scale;
  drawSky(ctx, 0, viewW, topY, P, now, STARS, dayAt(m), (ins.t + 118) / scale);
  city.update(camX, viewW, dayAt((camX + viewW) / U).id, -topY);
  city.draw(ctx, camX, P, now, -topY);
  speedLines(ctx, viewW, topY, P, now);
  ctx.translate(-camX, 0);
  const pave = Math.min(64, bottom * 0.36);
  drawGround(ctx, R.W.ground, camX, viewW, bottom, P, pave);
  const fs = Math.max(13, 12.5 / scale);   // in-world labels never drop below ~12.5 px
  const focus = R.power && R.power.id === "focus" ? Math.min(1, (DUR.focus - R.power.t) * 4, R.power.t * 2) : 0;
  const x0 = camX - 80, x1 = camX + viewW + 80;
  // signs, then hints, dots, power-ups, obstacles
  for (const it of R.W.items) if (it.k === "sign" && it.x0 > x0 && it.x0 < x1) drawSign(ctx, it.x0, it.m, P, fs);
  if (focus > 0) {
    ctx.globalAlpha = focus;
    for (const it of R.W.items) { const h = it.hint; if (!h || h.x == null || it.gone || h.x < hx - 10 || h.x > x1) continue; drawHint(ctx, h.x, -(surfaceAt(R.W, h.x - 1, h.x + 1) ?? 0), h.kind, now, fs); }
    ctx.globalAlpha = 1;
  }
  for (const it of R.W.items) {
    if (it.k === "dot" && !it.got && it.x0 > x0 && it.x0 < x1) drawDot(ctx, it.x0, -it.y, 7, SHOTS[it.c].id);
    else if (it.k === "pow" && !it.got && it.x0 > x0 && it.x0 < x1) drawPower(ctx, it.id, it.x0, -(it.base), now, fs);
  }
  for (const it of R.W.items) {
    if (it.k !== "ob" || it.gone) continue;
    const x = ix(it, tr); if (x > x1 || x + it.w < x0) continue;
    drawOb(ctx, it, x, -it.base, tr, P);
    if (focus > 0 && it.type !== "puddle") { ctx.globalAlpha = focus; outlineOb(ctx, it, x, -it.base, now); ctx.globalAlpha = 1; }
    if (P.dark > 0.6 && it.type !== "puddle" && it.type !== "banner") { ctx.fillStyle = rgba("#FFC845", 0.18 * P.dark); ctx.fillRect(x, -it.base, it.w, 2); }
  }
  for (const k of R.knocked) { ctx.save(); ctx.globalAlpha = clamp(k.life * 2, 0, 1); ctx.translate(k.x + k.it.w / 2, -k.base - k.it.h / 2); ctx.rotate(k.rot); drawOb(ctx, k.it, -k.it.w / 2, k.it.h / 2, tr, P); ctx.restore(); }
  drawParticles(ctx, true);
  drawHeroNow(hx, hy, now);
  drawParticles(ctx, false);
  // one-time teaching pills: the first tall hazard ("HOLD") and the first banner ("STAY LOW")
  for (const it of R.W.items) if (it.teach && !it.gone && it.k === "ob") { const x = ix(it, tr); if (x > x0 && x < x1 && x + it.w > hx - 30) drawTeach(ctx, it, x, now, fs); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (R.flash) { ctx.fillStyle = rgba(R.flash.c, 0.28 * (R.flash.t / 0.35)); ctx.fillRect(L.colX, 0, L.colW, L.H); }
  if (R.napT > 0) drawNap(now);
  drawHUD(P, now);
  ctx.restore();
}
function speedLines(ctx, viewW, topY, P, now) {
  const f = clamp((R.zoom - 0.45) / 0.55, 0, 1) + (R.power && (R.power.id === "exercise" || R.power.id === "energy") ? 0.8 : 0);
  if (f <= 0 || phase !== "play") return;
  ctx.fillStyle = rgba(P.dark > 0.5 ? "#FFFFFF" : "#FFFFFF", 0.55 * Math.min(1, f));
  for (let i = 0; i < 7; i++) {
    const y = topY * (0.1 + ((i * 0.137) % 0.8)) * 0.7 - 30, len = 40 + (i % 3) * 30, x = viewW - ((now * (700 + i * 90) + i * 197) % (viewW + 300));
    ctx.fillRect(x, y, len, 2.5);
  }
}
function drawHeroNow(hx, hy, now) {
  const S = R.S, pw = R.power && R.power.id;
  if (phase === "dying" || phase === "end") {
    const T = R.tumble; if (!T) return;
    ctx.save(); ctx.translate(T.x, -T.y - 50); ctx.rotate(T.rot); ctx.translate(0, 50);
    drawHero(ctx, 0, 0, { shot: runAs, t: now, flail: T.t < 0.9, air: true, vy: -200, capOff: T.popped, lean: 0 });
    ctx.restore();
    if (T.popped) drawCap(ctx, T.cx, -T.cy, 70, runAs);
    return;
  }
  // ground shadow
  const surf = surfaceAt(R.W, hx - 9, hx + 9);
  if (surf !== null) { const k = clamp(1 - (hy - surf) / 260, 0.35, 1); ctx.fillStyle = "rgba(0,0,0,0.16)"; ctx.beginPath(); ctx.ellipse(hx + 2, -surf + 1, 17 * k, 3.6 * k, 0, 0, 7); ctx.fill(); }
  const blink = R.invT > 0 && pw !== "energy" && Math.floor(now * 16) % 2 === 0;
  if (R.napT > 0) {   // power nap: lies down for a moment
    const k = clamp((1.6 - R.napT) * 5, 0, 1);
    ctx.save(); ctx.translate(hx, -hy); ctx.rotate(-Math.PI / 2 * k * 0.92); drawHero(ctx, 0, 0, { shot: runAs, t: now, cyc: 0, air: false, sx: 1, sy: 1, lean: 0 }); ctx.restore();
    return;
  }
  ctx.save(); if (blink) ctx.globalAlpha = 0.45;
  const sq = R.sq, air = !S.onGround;
  drawHero(ctx, hx, -hy, {
    shot: runAs, cyc: R.cyc, air, vy: S.vy, t: now, sx: 1 - sq * 0.55, sy: 1 + sq, lean: air ? 0.1 - S.vy / 5000 : 0.1 + R.zoom * 0.06 + (pw === "exercise" ? 0.05 : 0),
    jet: pw === "energy", jetOn: R.jetOn, socks: pw === "relax", kicks: pw === "exercise", bulb: R.bulb,
  });
  ctx.restore();
  if (pw === "relax") { ctx.strokeStyle = rgba(SHOT.relax.color, 0.35 + 0.1 * Math.sin(now * 5)); ctx.lineWidth = 2.5; ctx.beginPath(); ctx.ellipse(hx + 2, -hy - 46, 34, 54, 0, 0, 7); ctx.stroke(); }
}
function drawParticles(ctx, back) {
  for (const p of R.parts) {
    const isDust = p.kind === "dust"; if (back !== isDust) continue;
    const a = clamp(p.life / p.max, 0, 1);
    if (p.kind === "ring") { ctx.strokeStyle = rgba(p.c, a); ctx.lineWidth = 3 * a + 0.5; ctx.beginPath(); ctx.arc(p.x, -p.y, 4 + (1 - a) * p.rmax, 0, 7); ctx.stroke(); continue; }
    if (p.kind === "z") { ctx.fillStyle = rgba(p.c, a); ctx.font = `900 ${14 + (1 - a) * 6}px ${FONT}`; ctx.fillText("z", p.x, -p.y); continue; }
    ctx.fillStyle = p.c ? rgba(p.c, isDust ? a * 0.8 : a) : `rgba(185,180,173,${a * 0.75})`;
    ctx.beginPath(); ctx.arc(p.x, -p.y, p.r, 0, 7); ctx.fill();
  }
}
function drawNap(now) {
  const k = clamp(Math.min((1.6 - R.napT) * 4, R.napT * 4), 0, 1), s = SHOT.sleep;
  ctx.fillStyle = rgba(s.dark, 0.55 * k); ctx.fillRect(L.colX, 0, L.colW, L.H);
  ctx.globalAlpha = k; ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const cx = L.colX + L.colW / 2, cy = L.H * 0.36;
  fitFont(ctx, 900, 44, "Sweet dreams.", L.colW - 48, 20); ctx.fillText("Sweet dreams.", cx, cy);
  ctx.font = `700 15px ${FONT}`; ctx.fillText("A power nap clears the way.", cx, cy + 36);
  for (let i = 0; i < 3; i++) { ctx.font = `900 ${18 + i * 7}px ${FONT}`; ctx.fillText("z", cx + 40 + i * 18, cy - 50 - i * 18 - Math.sin(now * 3 + i) * 4); }
  ctx.globalAlpha = 1;
}
function drawSides(P) {
  ctx.fillStyle = STONE; ctx.fillRect(0, 0, L.W, L.H);
  const sw = L.colX; if (sw < 180 || L.H < 420) return;
  ctx.fillStyle = INK; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  const x = Math.max(24, sw - 300);
  const wmW = drawWordmark(ctx, x, 86, 46, INK, false); ctx.font = `700 13px ${FONT}`; ctx.fillText("your rhythm", x + wmW * 0.42, 106);
  ctx.font = `900 ${Math.min(64, sw * 0.18)}px ${FONT}`; ctx.fillText("Run", x, 190); ctx.fillText("Club.", x, 190 + Math.min(64, sw * 0.18) * 0.92);
  ctx.font = `700 15px ${FONT}`; ctx.fillStyle = "rgba(19,19,19,0.7)";
  ctx.fillText("Space, ↑ or click to jump.", x, 300); ctx.fillText("Hold to go higher.  P to pause.", x, 322);
  // right: the label lines
  const rx = L.colX + L.colW + 36; let y = 92;
  ctx.fillStyle = INK; ctx.font = `800 14px ${FONT}`; ctx.fillText("Every label line is a power-up >", rx, y); y += 32;
  for (const s of SHOTS) { drawDot(ctx, rx + 11, y - 5, 11, s.id); ctx.fillStyle = INK; ctx.font = `800 16px ${FONT}`; ctx.fillText(s.tag, rx + 32, y); ctx.font = `600 13px ${FONT}`; ctx.fillStyle = "rgba(19,19,19,0.6)"; ctx.fillText(POWER_COPY[s.id], rx + 32, y + 18); y += 50; }
}
const POWER_COPY = { energy: "Fly for 4 s. Hold to rise.", focus: "Slow-mo, and the jumps light up.", exercise: "Double jump and a burst of pace.", relax: "Shrug off one hit.", sleep: "Night only. A nap that saves a crash." };

function drawHUD(P, now) {
  // HUD flips between ink and white by sky brightness (never a muddy mid-grey during a blend)
  const sk = rgbOf(P.sky), lum = (0.2126 * sk[0] + 0.7152 * sk[1] + 0.0722 * sk[2]) / 255;
  const S = R.S, ink = lum < 0.45 ? "#FFFFFF" : INK, x = L.colX + 16 + (L.land ? ins.l : 0), top = ins.t + 14;
  const dash = L.band >= 140;   // tall screens: code progress + power meter live in the band below the street
  const m = Math.floor(S.x / U);
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic"; ctx.fillStyle = ink;
  ctx.font = `900 ${34 + R.signPulse * 6}px ${FONT}`; const mt = `${m.toLocaleString()}`; ctx.fillText(mt, x, top + 30);
  const mw = ctx.measureText(mt).width; ctx.font = `800 17px ${FONT}`; ctx.fillText("m", x + mw + 4, top + 30);
  drawDot(ctx, x + 7, top + 50, 7, SHOTS[Math.floor(now * 1.5) % 5].id);
  ctx.fillStyle = ink; ctx.font = `800 15px ${FONT}`; ctx.fillText(`${R.dots}`, x + 20, top + 55);
  if (!dash) {
    if (R.rw < REWARDS.length) { const r = REWARDS[R.rw]; ctx.globalAlpha = 0.7; ctx.font = `700 12px ${FONT}`; ctx.fillText(`${r.code} at ${r.m.toLocaleString()} m`, x + 20 + ctx.measureText(`${R.dots}`).width + 26, top + 55); ctx.globalAlpha = 1; }
    let py = top + 70;
    if (R.power) { ctx.font = `800 13px ${FONT}`; powerPill(x, py, ctx.measureText(SHOT[R.power.id].tag).width + 30, 28, false, true); py += 36; }
    if (R.nap) napPill(x, py, 210, 28);
  }
  const pr = pauseRect(); ctx.fillStyle = rgba(ink, 0.12); ctx.beginPath(); ctx.arc(pr.x, pr.y, pr.r, 0, 7); ctx.fill();
  ctx.fillStyle = ink; ctx.fillRect(pr.x - 6, pr.y - 7, 4, 14); ctx.fillRect(pr.x + 2, pr.y - 7, 4, 14);
  if (dash) drawDash(m);
  // power banner: a colour block across the column (landscape: a block at the top centre, clear of the road)
  if (R.banner) {
    const s = SHOT[R.banner.id], t = R.banner.t, inT = clamp(t / 0.18, 0, 1), outT = clamp((t - 1.35) / 0.3, 0, 1), light = R.banner.id === "sleep";
    let bx, bw, bh, by;
    if (L.land) { bw = Math.min(520, L.W - 2 * (x + 170)); bx = (L.W - bw) / 2; bh = 78; by = ins.t + 8 - (1 - easeOut(inT)) * 100 - easeIn(outT) * 100; }
    else { bw = L.colW; bh = 104; by = Math.round(L.H * 0.3); bx = L.colX + (1 - easeOut(inT)) * L.colW - easeIn(outT) * L.colW; }
    ctx.fillStyle = s.color; ctx.fillRect(bx, by, bw, bh);
    const tx = bx + 20, small = bh < 90;
    ctx.fillStyle = light ? "#fff" : INK; ctx.font = `600 ${small ? 13 : 14}px ${FONT}`; ctx.fillText("A shot of >", tx, by + (small ? 22 : 28));
    const big = fitFont(ctx, 900, small ? 36 : 46, s.name, bw * 0.55, 20); const nb = by + (small ? 22 : 28) + big * 0.95; ctx.fillText(s.name, tx, nb);
    const nameW = ctx.measureText(s.name).width; ctx.font = `800 17px ${FONT}`; const tagW = ctx.measureText(s.tag).width;
    if (tx + nameW + 12 + tagW < bx + bw - 16) ctx.fillText(s.tag, tx + nameW + 12, nb); else ctx.fillText(s.tag, tx, by + bh - 12);
  }
  // toasts (day, codes, saves): under the HUD; landscape: top centre, one at a time
  let ty = L.land ? ins.t + 16 : ins.t + 84 + (!dash && (R.power || R.nap) ? 36 : 0);
  for (const tt of (L.land ? R.toasts.slice(-1) : R.toasts)) {
    if (L.land && R.banner) break;
    const a = clamp(Math.min(tt.t * 6, (1.9 - tt.t) * 4), 0, 1), lift = (1 - clamp(tt.t * 6, 0, 1)) * 10;
    ctx.globalAlpha = a; ctx.font = `800 ${tt.big ? 16 : 13}px ${FONT}`; ctx.textAlign = "center";
    const label = tt.color === null ? `${tt.text} >` : tt.text, tw = ctx.measureText(label).width + 28, ph = tt.big ? 36 : 30, cx = L.colX + L.colW / 2;
    const neutral = tt.color === null || tt.color === INK;   // day + code toasts follow the HUD so they always contrast with the sky
    ctx.fillStyle = neutral ? ink : tt.color; rr(ctx, cx - tw / 2, ty + lift, tw, ph, ph / 2); ctx.fill();
    ctx.fillStyle = neutral && ink !== INK ? INK : "#fff"; ctx.fillText(label, cx, ty + lift + ph / 2 + 5);
    ctx.textAlign = "left"; ctx.globalAlpha = 1; ty += ph + 8;
  }
  // first-run hint in the thumb zone (just below the street)
  const ha = clamp(Math.min(R.hintT * 4, (3.2 - R.hintT) * 3), 0, 1);
  if (ha > 0 && phase === "play") {
    const t = isTouch ? "TAP TO JUMP · HOLD TO GO HIGHER" : "SPACE / CLICK TO JUMP · HOLD TO GO HIGHER";
    ctx.globalAlpha = ha; ctx.textAlign = "center"; const cx = L.colX + L.colW / 2, cy = L.groundPx + (dash ? 40 : L.band * 0.55);
    fitFont(ctx, 800, 13, t, L.colW - 64, 12); const tw = ctx.measureText(t).width + 30;
    ctx.fillStyle = "#fff"; rr(ctx, cx - tw / 2, cy - 17, tw, 34, 17); ctx.fill(); ctx.fillStyle = INK; ctx.fillText(t, cx, cy + 5);
    ctx.globalAlpha = 1; ctx.textAlign = "left";
  }
}
/** Active power-up: its label line on a pill that drains in the shot colour (text stays legible over both halves). */
function powerPill(x, y, w, h, withTime, onLight) {
  const p = R.power, s = SHOT[p.id], f = clamp(p.t / p.dur, 0, 1), label = s.tag, fw = w * f;
  ctx.save(); rr(ctx, x, y, w, h, h / 2); ctx.clip();
  ctx.fillStyle = onLight ? s.light : "rgba(255,255,255,0.22)"; ctx.fillRect(x, y, w, h); ctx.fillStyle = s.color; ctx.fillRect(x, y, fw, h);
  ctx.font = `800 ${h > 30 ? 15 : 13}px ${FONT}`; ctx.textBaseline = "middle";
  const tl = withTime ? `${Math.max(0, p.t).toFixed(1)} s` : "";
  for (const [cx0, cx1, col] of [[x, x + fw, p.id === "sleep" ? "#fff" : INK], [x + fw, x + w, onLight && p.id !== "sleep" ? INK : "#fff"]]) {
    ctx.save(); ctx.beginPath(); ctx.rect(cx0, y, cx1 - cx0, h); ctx.clip(); ctx.fillStyle = col; ctx.textAlign = "left"; ctx.fillText(label, x + 14, y + h / 2 + 1);
    if (tl) { ctx.textAlign = "right"; ctx.fillText(tl, x + w - 14, y + h / 2 + 1); } ctx.restore();
  }
  ctx.restore(); ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
}
function napPill(x, y, w, h) {
  const s = SHOT.sleep; ctx.fillStyle = s.color; rr(ctx, x, y, w, h, h / 2); ctx.fill();
  ctx.fillStyle = "#fff"; ctx.font = `800 ${h > 30 ? 15 : 13}px ${FONT}`; ctx.textBaseline = "middle"; ctx.fillText("& sweet dreams · nap ready", x + 14, y + h / 2 + 1); ctx.textBaseline = "alphabetic";
}
/** The band below the street on tall screens: progress to the next code, and the active power-up's timer. */
function drawDash(m) {
  const x = L.colX + 16, w = L.colW - 32, rows = 1 + (R.power ? 1 : 0) + (R.nap ? 1 : 0), rowH = 34, gap = 8;
  const ph = 18 + rows * rowH + (rows - 1) * gap, py = L.H - Math.max(ins.b, 8) - 10 - ph;
  if (py < L.groundPx + 64) return;
  ctx.fillStyle = "rgba(19,19,19,0.78)"; rr(ctx, x, py, w, ph, 18); ctx.fill();
  let y = py + 9;
  if (R.power) { powerPill(x + 9, y, w - 18, rowH, true); y += rowH + gap; }
  if (R.nap) { napPill(x + 9, y, w - 18, rowH); y += rowH + gap; }
  // progress to the next code
  ctx.textBaseline = "middle"; const cy = y + rowH / 2;
  if (R.rw < REWARDS.length) {
    const r = REWARDS[R.rw], from = R.rw ? REWARDS[R.rw - 1].m : 0, f = clamp((m - from) / (r.m - from), 0, 1);
    ctx.fillStyle = "#fff"; ctx.font = `900 15px ${FONT}`; ctx.textAlign = "left"; ctx.fillText(r.code, x + 18, cy + 1);
    const lw = ctx.measureText(r.code).width; ctx.font = `700 13px ${FONT}`; ctx.textAlign = "right"; const rt = `${r.m.toLocaleString()} m`; ctx.fillText(rt, x + w - 18, cy + 1);
    const bx = x + 18 + lw + 14, bw = w - 36 - lw - 28 - ctx.measureText(rt).width;
    ctx.fillStyle = "rgba(255,255,255,0.22)"; rr(ctx, bx, cy - 4, bw, 8, 4); ctx.fill();
    ctx.fillStyle = "#fff"; rr(ctx, bx, cy - 4, Math.max(8, bw * f), 8, 4); ctx.fill();
  } else { ctx.fillStyle = "#fff"; ctx.font = `800 14px ${FONT}`; ctx.textAlign = "left"; ctx.fillText("Every code unlocked. You're in the draw.", x + 18, cy + 1); }
  ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
}
function drawTeach(ctx, it, x, now, fs) {
  const low = it.type === "banner", label = low ? "STAY LOW" : "HOLD", bob = Math.sin(now * 6) * 2;
  const cx = x + it.w / 2, yTop = -it.base - it.h;
  const cy = low ? -(it.base + OB.banner.hang) + 26 + bob : yTop - 30 + bob;
  ctx.font = `900 ${fs}px ${FONT}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const tw = ctx.measureText(label).width + fs * 2.6, ph = fs * 1.9;
  ctx.fillStyle = INK; rr(ctx, cx - tw / 2, cy - ph / 2, tw, ph, ph / 2); ctx.fill();
  ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; rr(ctx, cx - tw / 2, cy - ph / 2, tw, ph, ph / 2); ctx.stroke();
  ctx.fillStyle = "#fff"; ctx.fillText(label, cx - fs * 0.5, cy + 1);
  // arrow: up for HOLD, down for STAY LOW
  const ax = cx + tw / 2 - fs * 1.1, d = low ? 1 : -1; ctx.strokeStyle = SHOT.focus.color; ctx.lineWidth = 2.6; ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.beginPath(); ctx.moveTo(ax, cy - d * fs * 0.45); ctx.lineTo(ax, cy + d * fs * 0.45); ctx.moveTo(ax - fs * 0.32, cy + d * fs * 0.12); ctx.lineTo(ax, cy + d * fs * 0.45); ctx.lineTo(ax + fs * 0.32, cy + d * fs * 0.12); ctx.stroke();
  ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
}
const easeOut = (t) => 1 - Math.pow(1 - t, 3), easeIn = (t) => t * t * t;

/* ── start-screen preview: the hero running in place in front of a big brand circle ── */
const pv = $("preview"), pctx = pv.getContext("2d"); let pvW = 0, pvH = 0, pvCyc = 0, pvLast = 0, pvCircle = SHOT[runAs].color;
function sizePreview() { const r = pv.getBoundingClientRect(); pvW = r.width; pvH = r.height; pv.width = Math.round(pvW * dpr); pv.height = Math.round(pvH * dpr); }
function drawPreview(t) {
  if (!pvW) sizePreview(); if (!pvW) return;
  const dt = pvLast ? Math.min(0.05, t - pvLast) : 0; pvLast = t; pvCyc += dt * 3.4 * Math.PI * 2;
  const c = pctx, s = SHOT[runAs]; pvCircle = mix(pvCircle, s.color, Math.min(1, dt * 8));
  c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, pvW, pvH);
  const gy = Math.min(pvH * 0.7, pvH - 58), k = Math.min((gy - 40) / 104, pvW / 200);   // ground sits above the picker row
  c.fillStyle = pvCircle; c.beginPath(); c.arc(pvW * 0.64, pvH * 0.42, Math.min(pvH * 0.4, pvW * 0.3), 0, 7); c.fill();
  c.fillStyle = "#fff"; c.fillRect(0, gy, pvW, 3);
  c.fillStyle = "rgba(255,255,255,0.75)"; for (let i = 0; i < 8; i++) { const x = pvW - ((t * 180 + i * 90) % (pvW + 60)); c.fillRect(x, gy + 12, 28, 3); }
  c.save(); c.translate(pvW * 0.62, gy); c.scale(k, k);
  c.fillStyle = "rgba(0,0,0,0.14)"; c.beginPath(); c.ellipse(2, 1, 17, 3.4, 0, 0, 7); c.fill();
  drawHero(c, 0, 0, { shot: runAs, cyc: pvCyc, t, sx: 1, sy: 1, lean: 0.12 });
  c.restore();
}
function buildPicker() {
  const box = $("picker"); box.innerHTML = "";
  for (const s of SHOTS) {
    const b = document.createElement("button"); b.className = "pick-dot"; b.style.setProperty("--c", s.color); b.setAttribute("aria-label", `Run as ${s.name}`); b.setAttribute("aria-pressed", s.id === runAs);
    b.addEventListener("click", () => { runAs = s.id; store.set("ryde-run:as", s.id); updatePicker(); });
    box.appendChild(b);
  }
  updatePicker();
}
function updatePicker() {
  [...$("picker").children].forEach((b, i) => b.setAttribute("aria-pressed", SHOTS[i].id === runAs));
  $("asName").textContent = SHOT[runAs].name; $("asTag").textContent = SHOT[runAs].tag;
  document.documentElement.style.setProperty("--as", SHOT[runAs].color);
}

/* ── screens, leaderboard ───────────────────────────────────────────────── */
const board = createBoard("ryde-run");
const boardOpts = { fmt: (s) => s.toLocaleString() };
board.onChange((v) => { renderBoard($("board1"), v, boardOpts); renderBoard($("board2"), v, boardOpts); });
renderBoard($("board1"), null, boardOpts); renderBoard($("board2"), null, boardOpts);
let lastScore = null, posted = false;

function play() {
  if (phase === "play") return;
  audioInit(); audioArmed = true;
  newRun(0); phase = "play"; lastTs = 0;
  $("start").classList.add("hidden"); $("end").classList.add("hidden");
  startMusic();
}
function endRun() {
  phase = "end";
  const m = Math.floor(R.S.x / U), score = m + 10 * R.dots;
  const best = +store.get("ryde-run:best", 0), bestM = +store.get("ryde-run:bestm", 0); const isBest = score > best;
  if (isBest) store.set("ryde-run:best", score); if (m > bestM) store.set("ryde-run:bestm", m);
  lastScore = { score, m, dots: R.dots }; posted = false;
  $("cause").textContent = R.cause;
  $("score").textContent = score.toLocaleString();
  $("stDist").textContent = `${m.toLocaleString()} m`; $("stDots").textContent = R.dots; $("stBest").textContent = Math.max(best, score).toLocaleString();
  $("bestNote").textContent = score <= 0 ? "" : isBest && best > 0 ? "New personal best." : isBest ? "First run done. Post it to get on the board." : score === best ? "Level with your best." : `${(best - score).toLocaleString()} off your best.`;
  const got = [...REWARDS].reverse().find((r) => m >= r.m), next = REWARDS.find((r) => m < r.m), rw = $("reward");
  if (got) {
    rw.className = "reward";
    rw.innerHTML = `<div class="label">${got.m.toLocaleString()} m unlocked &gt;</div><b>${got.code}</b><div class="t">${got.off}${got.extra ? `, ${got.extra}` : ""}.</div>${next ? `<div class="t dim">Run ${next.m.toLocaleString()} m for ${next.code}.</div>` : ""}`;
  } else {
    const r = REWARDS[0], f = clamp(m / r.m, 0, 1);
    rw.className = "reward locked";
    rw.innerHTML = `<div class="label">Run ${r.m} m to unlock &gt;</div><b>10% off</b><div class="bar"><i style="width:${(f * 100).toFixed(1)}%"></i></div><div class="t">${m.toLocaleString()} of ${r.m} m. So close. One more lap?</div>`;
    if (m < 150) rw.querySelector(".t").textContent = `${m.toLocaleString()} of ${r.m} m. Warm-up lap. Go again.`;
  }
  $("post").disabled = score <= 0; $("post").textContent = "Post score"; $("note").textContent = score <= 0 ? "Run a few metres first, then post." : "";
  $("name").value = savedName();
  $("end").classList.remove("hidden"); $("end").scrollTop = 0;
  board.load();
}
async function postScore() {
  if (!lastScore || posted || lastScore.score <= 0) return;
  const name = $("name").value.trim().toUpperCase().slice(0, 12);
  if (!name) { $("note").textContent = "Add a name for the board first."; $("name").focus(); return; }
  const btn = $("post"); btn.disabled = true; btn.textContent = "Posting…"; $("note").textContent = "";
  try {
    const r = await board.post({ name, score: lastScore.score, round: Math.max(1, Math.floor(lastScore.m / 1000)), detail: lastScore.dots });
    posted = true;
    if (r.status === "review") { btn.textContent = "Held"; $("note").textContent = "That name needs a quick human check before it goes on the board. Your score is saved."; }
    else { btn.textContent = "Posted"; $("note").textContent = "You're on the board."; if ($("bestNote").textContent.startsWith("First run")) $("bestNote").textContent = "First run, straight on the board. Nice."; }
  } catch { btn.disabled = false; btn.textContent = "Offline — try again"; }
}
$("play").addEventListener("click", play);
$("again").addEventListener("click", play);
$("post").addEventListener("click", postScore);
$("name").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); postScore(); } });
$("name").addEventListener("input", (e) => { const v = e.target.value.toUpperCase().replace(/[^A-Z0-9 ._-]/g, "").slice(0, 12); if (v !== e.target.value) e.target.value = v; });
function syncMute() { document.querySelectorAll("[data-mute]").forEach((b) => { b.textContent = audio.muted ? "Sound off" : "Sound on"; b.setAttribute("aria-pressed", !audio.muted); b.classList.toggle("off", audio.muted); }); }
document.querySelectorAll("[data-mute]").forEach((b) => b.addEventListener("click", () => { audioInit(); audio.setMuted(!audio.muted); syncMute(); }));

/* ── test hooks ─────────────────────────────────────────────────────────── */
window.__game = {
  state: () => R ? { phase, distance: Math.floor(R.S.x / U), speed: +(R.S.v / U).toFixed(2), power: R.power ? R.power.id : null, powerT: R.power ? +R.power.t.toFixed(2) : 0, nap: R.nap, napping: R.napT > 0,
    dots: R.dots, score: Math.floor(R.S.x / U) + 10 * R.dots, day: dayAt(R.S.x / U).name, seed: R.seed, y: +R.S.y.toFixed(1), onGround: R.S.onGround, invT: +Math.max(0, R.invT).toFixed(2),
    paused: R.paused, autopilot, invincible, ts: +R.ts.toFixed(2), runAs, zoom: +R.zoom.toFixed(2) } : { phase },
  start: () => { if (phase !== "play") { newRun(0); phase = "play"; lastTs = 0; $("start").classList.add("hidden"); $("end").classList.add("hidden"); } },
  skipTo: (metres) => {
    if (!R) return; const keep = { dots: R.dots, power: R.power, nap: R.nap };
    const S = newHero(metres * U); S.t = R.S.t; R.S = S; R.W = createWorld(R.seed, metres); R.prev = { x: S.x, y: 0, t: S.t };
    R.rw = REWARDS.filter((r) => metres >= r.m).length; R.dayI = dayAt(metres).i; R.dayId = dayAt(metres).id; R.cmds = []; R.cur = null; R.lastPlan = -9; R.knocked = []; Object.assign(R, keep);
    R.zoom = clamp((S.v - V0) / (VMAX - V0), 0, 1); city.reset();
  },
  invincible: (on = true) => { invincible = !!on; },
  give: (id) => { if (R && SHOT[id] && phase === "play") givePower(id); },
  setSeed: (n) => { fixedSeed = n == null ? null : n | 0; },
  autopilot: (on = true) => { autopilot = !!on; if (R) { R.cmds = []; R.cur = null; R.lastPlan = -9; } },
  crash: () => { if (R && phase === "play") crash({ kind: "ob", it: { type: "bin", var: 0.1 } }); },
  pause: pauseGame, resume: resumeGame,
  world: () => R && R.W, hero: () => R && R.S,
  /** Fast-forward: run the simulation for `sec` seconds synchronously (no rendering). Returns state(). */
  step: (sec) => { if (!R) return null; const n = Math.round(sec / TICK); for (let i = 0; i < n && phase === "play"; i++) { if (R.napT > 0) { R.napT -= TICK; if (R.napT <= 0) endNap(); continue; } tick(); } return window.__game.state(); },
  log: () => R && R.log,
};

/* ── boot ───────────────────────────────────────────────────────────────── */
addEventListener("resize", () => { layout(); });
addEventListener("orientationchange", () => setTimeout(layout, 120));
layout(); buildPicker(); syncMute();
loadFont().then(() => { sizePreview(); });
board.load();
requestAnimationFrame(frame);

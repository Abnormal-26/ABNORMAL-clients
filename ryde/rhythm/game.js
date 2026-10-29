/**
 * Ryde: Your Rhythm. A one-thumb rhythm game. Moments of the day fall on the beat; tap the
 * matching shot as each lands on the NOW line. A day is a song (morning → night, ends on LIGHTS OUT).
 *
 * Timing: the music is scheduled by the shared look-ahead sequencer (audio.sequence), and every card
 * time is startTime + step × stepDur on that same AudioContext clock, so cards can't drift off the beat.
 * "Heard time" = ctx time − output latency (outputLatency + baseLatency) − the player's own offset.
 * Cards are drawn and taps are judged in heard time; taps use the event's own timestamp.
 *
 * QC hooks (window.__game):
 *   state()          → { phase, day, bpm, score, combo, bestCombo, mult, meter, cleared, counts, cards, judged, … }
 *   skipTo(day)      → start a fresh run on that day (audio is initialised; call from a click in real browsers)
 *   autoplay(on)     → perfect bot: presses the right pad, through the normal input path, as each card lands
 *   setLatency(ms)   → the player's timing offset used for judging (saved; the same value the Timing
 *                      calibration sets and the adaptive learner nudges). Positive = taps land late.
 *   setSeed(n)       → chart seed for the next day/run (same seed = same chart)
 *   setMeter(v)      → set the rhythm meter 0–1 (0 ends the run on the next frame)
 *   coach(on)        → force (or skip) the first-run hint on the next Day 1
 *   chart()          → this day's cards [{ i, step, time, lane, text, j, deltaMs }]
 *   timing()         → { startTime, stepDur, latency, log: [{ i, lane, j, deltaMs }], stepTimes: {step: ctxTime} }
 *   clock()          → { ctxTime, heard, latency, perf }
 *   pressAt(lane, perfMs) → judge a press as if a key went down at that performance.now() time
 *   end()            → finish the run now and show the end screen
 */
import { SHOTS, SHOT, INK, PAPER, STONE, STONE_DARK, FONT, drawBottle, drawWordmark, fitFont, roundRect, safeInsets, lockTouch, buzz, loadFont } from "../shared/brand.js";
import { createAudio } from "../shared/audio.js";
import { createBoard, renderBoard, savedName } from "../shared/board.js";
import { buildChart, daySpec, LANES, SECTIONS, CLOCK_START, CLOCK_END } from "./chart.js";
import { createMusic } from "./music.js";

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const easeOut = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const easeIn = (t) => Math.pow(clamp(t, 0, 1), 2.2);
const LS = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };
const MIN_POST = 100;   // no zero-point entries on the board
const fmt = (n) => Math.round(n).toLocaleString("en-AU");

const cvs = $("#game"), ctx = cvs.getContext("2d");
const audio = createAudio(), music = createMusic(audio);
const board = createBoard("ryde-rhythm");

// judgement windows (seconds either side of the beat) and points. Sized for real phones, not lab conditions.
const WIN = { perfect: 0.06, good: 0.11, ok: 0.16 };
const PTS = { perfect: 100, good: 70, early: 30, late: 30 };
const GAIN = { perfect: 0.03, good: 0.022, early: 0.008, late: 0.008 };
const REWARDS = [
  { day: 1, code: "RHYTHM10", pct: "10% off", t: "Black Friday code. Finish Day 2 for 15% off." },
  { day: 2, code: "RHYTHM15", pct: "15% off", t: "Black Friday code. Finish Day 3 for 20% off and the draw." },
  { day: 3, code: "RHYTHM20", pct: "20% off", t: "Black Friday code, and you're in the draw for a year of Ryde." },
];
// background colour-blocks through the day
const BG = { intro: "#ECE8E2", morning: "#ECE8E2", midday: "#FFFFFF", evening: "#F8BF8C", night: INK, outro: INK };
const KEYS = { d: 0, f: 1, j: 2, k: 3, l: 4, 1: 0, 2: 1, 3: 2, 4: 3, 5: 4 };
const KEYLABEL = ["D", "F", "J", "K", "L"];

let W = 0, H = 0, DPR = 1;
const L = {};
let G = null;              // the current run
let phase = "start";       // start | play | clear | over | end | paused | countdown
let seed = (Math.random() * 1e9) | 0;
let bot = false;
// Player timing offset (s), applied to judging only: how late this player/device tends to tap relative
// to what they hear. Starts from their calibration (pause menu → Timing) or a sensible default, then
// adapts from every hit (mean signed error), clamped ±150 ms, and is remembered between runs.
const COARSE = matchMedia("(pointer: coarse)").matches;
const OFF_DEFAULT = COARSE ? 0.035 : 0.012;
const OFF_MAX = 0.15;
let jOff = (() => { const v = LS.get("ryde:rhythm:offset"); return v != null && v !== "" && isFinite(+v) ? clamp(+v / 1000, -OFF_MAX, OFF_MAX) : OFF_DEFAULT; })();
const saveOffset = () => LS.set("ryde:rhythm:offset", String(Math.round(jOff * 1000)));
const inkOn = (id) => (id === "energy" || id === "sleep" ? PAPER : INK);   // dark text on the light shot colours
let clockOff = null;       // ctx.currentTime − performance.now()/1000, smoothed
let coachOverride = null;
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------------------------------------------------------------- clock
function syncClock() {
  const c = audio.ctx; if (!c || c.state !== "running") return;
  const est = c.currentTime - performance.now() / 1000;
  if (clockOff === null || Math.abs(est - clockOff) > 0.03) clockOff = est;
  else clockOff += (est - clockOff) * 0.05;     // ctx time ticks in render quanta; smooth it
}
function latency() {
  const c = audio.ctx; const out = c ? (c.outputLatency || 0) + (c.baseLatency || 0) : 0;
  return clamp(out, 0, 0.3);
}
/** heard song time (ctx clock) for a performance.now() timestamp in ms */
function heardAt(perfMs) {
  if (!G) return 0;
  if (phase === "paused" || phase === "countdown") return G.frozen;
  if (clockOff === null) syncClock();
  return perfMs / 1000 + (clockOff ?? 0) - latency();
}

// ---------------------------------------------------------------- layout + sprites
const sprites = {};
function layout() {
  W = Math.max(1, window.innerWidth); H = Math.max(1, window.innerHeight); DPR = Math.min(2, window.devicePixelRatio || 1);
  cvs.width = Math.round(W * DPR); cvs.height = Math.round(H * DPR); cvs.style.width = W + "px"; cvs.style.height = H + "px";
  const ins = safeInsets(); L.ins = ins;
  const availW = W - ins.l - ins.r;
  L.colW = Math.min(availW, 480); L.colX = Math.round(ins.l + (availW - L.colW) / 2);
  L.g = L.colW < 380 ? 14 : 16;
  L.compact = H < 560;
  L.hudTop = ins.t + (L.compact ? 6 : 12);
  L.hudH = L.compact ? 44 : 92;
  L.stripH = Math.round(clamp(H * 0.28, L.compact ? 108 : 150, 250));
  L.stripTop = H - ins.b - L.stripH;
  L.trackTop = L.hudTop + L.hudH;
  L.cardH = Math.round(clamp((L.stripTop - L.trackTop) * 0.105, 38, 58));
  L.rowH = L.compact ? 28 : 42;                                 // the judgement row under the slot: no card ever enters it
  L.nowY = L.stripTop - L.rowH - L.cardH / 2 - 6;
  L.rowY = L.nowY + L.cardH / 2 + 6 + L.rowH / 2;
  L.trackLen = L.nowY - L.trackTop;
  L.laneW = Math.min(L.colW - 60, 300);
  L.cardW = L.laneW - 14;
  L.padW = L.colW / 5;
  L.keys = matchMedia("(hover: hover) and (pointer: fine)").matches;
  L.nameSize = L.compact ? 12 : 13;
  const keyH = L.keys ? (L.compact ? 0 : 24) : 0;
  L.bh = Math.round(Math.min(L.stripH - 14 - 10 - L.nameSize - keyH - 14, L.padW * 1.95, 156));
  L.bottleBase = L.stripTop + 14 + L.bh;
  L.nameY = L.bottleBase + 10 + L.nameSize / 2 + 1;
  L.keyY = L.nameY + L.nameSize / 2 + 13;
  L.side = L.colX;
  makeSprites();
  if (phase === "start") sizeHero();
}
function makeSprites() {
  const h = L.bh, w = h * 0.44, sw = Math.ceil(w * 1.5), sh = Math.ceil(h * 1.1);
  for (const s of SHOTS) {
    const c = sprites[s.id]?.c || document.createElement("canvas");
    c.width = Math.ceil(sw * DPR); c.height = Math.ceil(sh * DPR);
    const x = c.getContext("2d"); x.setTransform(DPR, 0, 0, DPR, 0, 0); x.clearRect(0, 0, sw, sh);
    drawBottle(x, sw / 2, h / 2 + 1, h, s.id, { label: true });
    sprites[s.id] = { c, sw, sh, base: h + 1 };
  }
}
const padCx = (i) => L.padW * (i + 0.5);
const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; };
const mix = (a, b, t) => { const x = parseInt(a.slice(1), 16), y = parseInt(b.slice(1), 16); const c = (s) => Math.round(((x >> s) & 255) + (((y >> s) & 255) - ((x >> s) & 255)) * t); return `rgb(${c(16)},${c(8)},${c(0)})`; };

// ---------------------------------------------------------------- run / day lifecycle
function newRun(day = 1) {
  G = {
    day, score: 0, combo: 0, bestCombo: 0, mult: 1, meter: day > 1 ? 0.8 : 0.66, cleared: day - 1, startDay: day,
    counts: { perfect: 0, good: 0, early: 0, late: 0, miss: 0, wrong: 0 }, log: [], posted: false,
    pads: LANES.map(() => ({ t: -9, kind: "", hitT: -9 })), parts: [], fly: [], pops: [], word: null, shake: null, flash: null,
    bg: { from: BG.intro, to: BG.intro, t0: 0, sec: "intro" }, banner: null, clearT0: 0, clearOut: 0, overT0: 0, frozen: 0, stepTimes: {},
  };
}
function startDay(day) {
  if (G.seq) G.seq.stop();
  const coach = day === 1 && (coachOverride ?? LS.get("ryde:rhythm:coached") !== "1") && !bot;
  const chart = buildChart(day, seed + day * 31, { coach });
  G.day = day; G.chart = chart; G.spec = chart.spec; G.cards = chart.cards; G.next = 0; G.coach = coach; G.stepTimes = {};
  G.cards.forEach((c) => { c.li = LANES.indexOf(c.lane); c.j = null; c.jt = 0; c.delta = 0; });
  music.begin(chart);
  if (audio.ctx.state === "suspended") audio.ctx.resume();
  const seq = audio.sequence(chart.spec.bpm, (step, t) => {
    if (!G || G.seq !== seq || step >= chart.totalSteps) { seq.stop(); return; }   // a stale song never schedules into a new run
    G.stepTimes[step] = t;
    music.step(step, t);
  }, { startDelay: 0.3 });
  G.seq = seq; G.startTime = seq.startTime; G.stepDur = seq.stepDur;
  G.cards.forEach((c) => (c.time = seq.startTime + c.step * seq.stepDur));
  G.songEnd = seq.startTime + chart.totalSteps * seq.stepDur;
  G.firstT = G.cards[0].time; G.lastT = G.cards[G.cards.length - 1].time;
  G.banner = { t0: performance.now(), day };
  G.dayCounts = { perfect: 0, judged: 0, comboAtStart: G.combo };
  phase = "play";
}
function startRun(day = 1) {
  audio.init();
  if (audio.ctx.state === "suspended") audio.ctx.resume();
  clockOff = null;
  if (G && G.seq) { G.seq.stop(); music.fadeOut(0.08); }
  newRun(day);
  showScreen(null);
  startDay(day);
}
function enterClear() {
  phase = "clear"; G.clearT0 = performance.now() + 260;
  G.cleared = Math.max(G.cleared, G.day);
  const bonus = 500 * G.day; G.score += bonus; G.clearBonus = bonus;
  G.meter = Math.min(1, G.meter + 0.3);
  const r = REWARDS.find((x) => x.day === G.day);
  if (r) { const best = +LS.get("ryde:rhythm:tier") || 0; if (G.day > best) LS.set("ryde:rhythm:tier", String(G.day)); }
  G.clearReward = r || null; G.clearStats = { perfect: G.dayCounts.perfect, day: G.day };
  music.clearFanfare(audio.ctx.currentTime + 0.25);
  G.flash = { t0: performance.now() + 200, color: "#FFFFFF", a: 0.9 };
}
function gameOver() {
  if (phase === "over" || phase === "end") return;
  G.frozenOver = heardAt(performance.now());
  phase = "over"; G.overT0 = performance.now();
  if (G.seq) G.seq.stop(); music.fadeOut(0.35); music.tapeStop(); buzz(60);
  setTimeout(showEnd, 1900);
}
function endNow() {
  if (!G) return; if (G.seq) G.seq.stop(); music.fadeOut(0.25);
  if (G.chart && G.frozenOver == null) G.frozenOver = heardAt(performance.now());
  if (audio.ctx && audio.ctx.state === "suspended") audio.ctx.resume();
  phase = "over"; showEnd();
}

// ---------------------------------------------------------------- input + judging
function press(lane, perfMs) {
  if (!G || lane < 0 || lane > 4) return;
  const pad = G.pads[lane]; pad.t = performance.now(); pad.kind = "tap";
  if (phase !== "play" && phase !== "clear") return;
  const t = heardAt(perfMs) - jOff;          // judged time, after the player's timing offset
  // cards whose window contains this tap, earliest first
  const inWin = [];
  for (let i = G.next; i < G.cards.length; i++) {
    const c = G.cards[i]; if (c.time - t > WIN.ok) break;
    if (!c.j && Math.abs(t - c.time) <= WIN.ok) inWin.push(c);
  }
  if (!inWin.length) { music.tick(lane); pad.kind = "stray"; return; }   // in nobody's window: soft click, no penalty
  const match = inWin.find((c) => c.li === lane);
  if (match) return hit(match, t - match.time, lane);
  // a late tap meant for a card that just went by never costs the next one
  const justGone = G.cards.some((c) => c.li === lane && c.time < t && t - c.time < 0.35 && (!c.j || c.j === "miss" || c.j === "late"));
  if (justGone || inWin[0].slow) { music.tick(lane); pad.kind = "stray"; return; }
  wrong(inWin[0], lane, t - inWin[0].time);
}
/** Tapped the falling card instead of a bottle: point at the bottles and pulse the one it wants. */
function trackTap() {
  const now = performance.now(); if (now - (G.lastTrackTap || 0) < 500) return; G.lastTrackTap = now;
  const c = G.cards.find((x) => !x.j); if (!c) return;
  G.word = { t0: now, j: "hint", text: "TAP THE BOTTLES ↓", tag: "" };
  G.hintPad = { lane: c.li, t0: now };
}
function judge(c, j, d) {
  c.j = j; c.jt = performance.now(); c.delta = d;
  G.counts[j]++; G.log.push({ i: c.i, lane: c.lane, j, deltaMs: Math.round(d * 1000) });
  G.dayCounts.judged++; if (j === "perfect") G.dayCounts.perfect++;
  if (c.slow) { G.coachHits = (G.coachHits || 0) + (j === "perfect" || j === "good" || j === "early" || j === "late" ? 1 : 0); if (G.coachHits >= 2) LS.set("ryde:rhythm:coached", "1"); }
}
function hit(c, d, lane) {
  const ad = Math.abs(d);
  const j = ad <= WIN.perfect ? "perfect" : ad <= WIN.good ? "good" : d < 0 ? "early" : "late";
  judge(c, j, d);
  // learn the player's timing: nudge the offset toward their raw signed error on every hit
  if (!bot) jOff = clamp(jOff + d * (Math.abs(d) < WIN.good ? 0.12 : 0.06), -OFF_MAX, OFF_MAX);   // d = raw error − offset
  G.combo++; G.bestCombo = Math.max(G.bestCombo, G.combo);
  const mult = G.combo >= 24 ? 4 : G.combo >= 16 ? 3 : G.combo >= 8 ? 2 : 1;
  if (mult > G.mult) { music.comboUp(mult); G.multPop = performance.now(); }
  G.mult = mult;
  const pts = PTS[j] * mult; G.score += pts;
  G.meter = Math.min(1, G.meter + GAIN[j]);
  // the pad note: early taps are quantised onto the beat so the melody stays tight
  const ac = audio.ctx, when = c.time > ac.currentTime + 0.004 ? c.time : ac.currentTime;
  music.hit(lane, when, { perfect: j === "perfect" });
  const now = performance.now(), s = SHOT[c.lane];
  const pad = G.pads[lane]; pad.kind = "hit"; pad.hitT = now;
  G.word = { t0: now, j, lane: c.lane, text: j === "perfect" ? "PERFECT" : j === "good" ? "GOOD" : j === "early" ? "EARLY" : "LATE", tag: j === "perfect" || j === "good" ? s.tag : "" };
  G.fly.push({ c, t0: now });
  G.pops = [{ t0: now, text: `+${pts}` }];   // one score pop at a time, in the HUD
  burst(L.colW / 2, L.nowY, s, j === "perfect" ? 22 : 14, 1);
  buzz(j === "perfect" ? 12 : 8);
}
function wrong(c, lane, d) {
  judge(c, "wrong", d); breakCombo();
  G.meter -= G.spec.drain; music.thunk();
  G.pads[lane].kind = "wrong";
  G.word = { t0: performance.now(), j: "wrong", text: "WRONG SHOT", tag: "" };
  G.shake = { t0: performance.now(), amp: 7 }; buzz(30);
}
function miss(c) {
  judge(c, "miss", 0);
  if (c.slow) return;                       // first-run hint cards never cost you
  breakCombo(); G.meter -= G.spec.drain; music.thunk();
  G.word = { t0: performance.now(), j: "miss", text: "MISS", tag: "" };
  G.shake = { t0: performance.now(), amp: 4 };
}
function breakCombo() { if (G.combo >= 8) music.comboBreak(); G.combo = 0; G.mult = 1; }
function burst(x, y, s, n, power) {
  if (G.parts.length > 260) G.parts.splice(0, n);
  for (let k = 0; k < n; k++) {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.25, v = (180 + Math.random() * 360) * power;
    const col = k % 5 === 0 ? PAPER : k % 7 === 3 ? s.dark : k % 3 === 0 ? s.light : s.color;
    G.parts.push({ x: x + (Math.random() - 0.5) * L.cardW * 0.8, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: 3 + Math.random() * 5, col, life: 0.5 + Math.random() * 0.4, t: 0, sq: Math.random() < 0.4, rot: Math.random() * 6 });
  }
}

// pointer: whole column above each bottle in the control strip is its pad
cvs.addEventListener("pointerdown", (e) => {
  const x = e.clientX - L.colX, y = e.clientY;
  if (phase === "play" || phase === "clear") {
    // pause button (top right of the column)
    const px = L.colW - L.g - 20, py = L.hudTop + 20;
    if (Math.hypot(x - px, y - py) < 26) { pause(false); return; }
  }
  if (x < 0 || x > L.colW) return;
  if (y < L.stripTop - (L.compact ? 14 : 28)) { if (phase === "play" && y > L.trackTop) trackTap(); return; }
  press(clamp(Math.floor(x / L.padW), 0, 4), e.timeStamp || performance.now());
}, { passive: true });
lockTouch(cvs, () => phase === "play" || phase === "clear" || phase === "countdown");

window.addEventListener("keydown", (e) => {
  if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
  const k = e.key.toLowerCase();
  if (CAL.open) { if ((k === " " || k === "enter" || k in KEYS) && !e.repeat) { e.preventDefault(); calTap(e.timeStamp || performance.now()); } return; }
  if (phase === "play" || phase === "clear") {
    if (k in KEYS) { e.preventDefault(); if (!e.repeat) press(KEYS[k], e.timeStamp || performance.now()); return; }
    if (k === "escape" || k === "p" || k === " ") { e.preventDefault(); pause(false); return; }
  } else if (phase === "paused" && (k === "escape" || k === "p" || k === " ")) { e.preventDefault(); resume(); }
});

// ---------------------------------------------------------------- pause / resume
function pause(auto) {
  if (!G || (phase !== "play" && phase !== "clear" && phase !== "countdown")) return;
  if (phase !== "countdown") { G.frozen = heardAt(performance.now()); G.resumeTo = phase; }
  phase = "paused"; G.autoPaused = auto;
  if (audio.ctx) audio.ctx.suspend();
  if (!auto) showScreen("pause");
}
function resume() {
  if (!G || phase !== "paused") return;
  showScreen(null); phase = "countdown"; G.cdT0 = performance.now(); G.cdDone = false;
}
function finishCountdown() {
  clockOff = null;
  const go = () => { clockOff = null; if (phase === "countdown") phase = G.resumeTo || "play"; };
  if (audio.ctx) audio.ctx.resume().then(go, go); else go();
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { if (phase === "play" || phase === "clear" || phase === "countdown") pause(true); }
  else if (phase === "paused" && G && G.autoPaused) resume();
});
$("#resume").addEventListener("click", resume);
$("#quit").addEventListener("click", () => { showScreen(null); endNow(); });

// ---------------------------------------------------------------- per-frame update
let lastPerf = performance.now();
function update(now, perf, dt) {
  if (phase === "play" || phase === "clear") {
    // perfect bot: press through the normal path the moment a card lands
    if (bot) for (let i = G.next; i < G.cards.length; i++) {
      const c = G.cards[i]; if (c.j) continue; if (c.time + jOff > now + 0.002) break;
      const ideal = (c.time + jOff + latency() - (clockOff ?? 0)) * 1000;
      press(c.li, perf - ideal > 30 ? ideal : perf); break;
    }
    while (G.next < G.cards.length && G.cards[G.next].j) G.next++;
    for (let i = G.next; i < G.cards.length; i++) {
      const c = G.cards[i]; if (c.j) continue;
      if (now - jOff - c.time > WIN.ok) miss(c); else break;
    }
    while (G.next < G.cards.length && G.cards[G.next].j) G.next++;
    if (G.meter <= 0) { G.meter = 0; gameOver(); }
    else if (phase === "play" && G.next >= G.cards.length) enterClear();
    else if (phase === "clear" && now >= G.songEnd + 0.05) { G.clearOut = performance.now(); startDay(G.day + 1); }
    // colour-block the background by section
    const bar = Math.floor((now - G.startTime) / (G.stepDur * 16));
    const sec = G.chart.sectionOfBar(bar);
    if (sec !== G.bg.sec && now >= G.startTime - 0.5) { G.bg = { from: bgNow(perf), to: BG[sec] || BG.intro, t0: perf, sec }; }
  }
  // particles
  for (const p of G.parts) { p.t += dt; p.vy += 1100 * dt; p.vx *= 0.985; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += dt * 8; }
  G.parts = G.parts.filter((p) => p.t < p.life);
  G.fly = G.fly.filter((f) => perf - f.t0 < 420);
  G.pops = G.pops.filter((p) => perf - p.t0 < 800);
  if (phase === "countdown") {
    if (perf - G.cdT0 >= 2100 && !G.cdDone) { G.cdDone = true; finishCountdown(); }
  }
}
function bgNow(perf) {
  const b = G.bg; const t = clamp((perf - b.t0) / 650, 0, 1);
  return t >= 1 ? b.to : b.from; // the wipe draws the block; this is just the settled colour
}
function clockHour(now) {
  const p = clamp((now - G.firstT) / Math.max(0.1, G.lastT - G.firstT), 0, 1);
  return CLOCK_START + p * (CLOCK_END - CLOCK_START);
}
/** "MON 6:30 AM": the HUD shows the weekday so the day's moments read right */
function dayClock(now) { return `${G.chart.weekday} ${clockLabel(now)}`; }
function clockLabel(now) {
  const p = clamp((now - G.firstT) / Math.max(0.1, G.lastT - G.firstT), 0, 1);
  const mins = Math.round((CLOCK_START * 60 + p * (CLOCK_END - CLOCK_START) * 60) / 5) * 5;
  const h = Math.floor(mins / 60), m = mins % 60, h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}
function sectionLabel(now) {
  const bar = Math.floor((now - G.startTime) / (G.stepDur * 16));
  const s = G.chart.sectionOfBar(bar);
  return s === "intro" ? "DAWN" : s === "outro" ? "NIGHT" : SECTIONS.find((x) => x.id === s).label;
}

// ---------------------------------------------------------------- drawing
function frame() {
  requestAnimationFrame(frame);
  const perf = performance.now(); const dt = Math.min(0.05, (perf - lastPerf) / 1000); lastPerf = perf;
  if (phase === "start") { drawHero(perf); return; }
  if (!G || phase === "end") return;
  syncClock();
  const now = heardAt(perf);
  update(now, perf, dt);
  draw(now, perf);
}

function draw(now, perf) {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = STONE; ctx.fillRect(0, 0, W, H);
  drawSides(now);
  ctx.save();
  let sx = 0, sy = 0;
  if (G.shake && !reduceMotion) { const t = (perf - G.shake.t0) / 1000; if (t < 0.3) { const a = G.shake.amp * Math.exp(-t * 14); sx = Math.sin(t * 90) * a; sy = Math.cos(t * 70) * a * 0.4; } }
  ctx.translate(L.colX + sx, sy);
  ctx.beginPath(); ctx.rect(-10, 0, L.colW + 20, H); ctx.clip();

  // background colour block, wiping down from the top on each new time of day
  const b = G.bg, wt = easeOut((perf - b.t0) / 650);
  ctx.fillStyle = wt >= 1 ? b.to : b.from; ctx.fillRect(-10, 0, L.colW + 20, H);
  if (wt < 1) { ctx.fillStyle = b.to; ctx.fillRect(-10, 0, L.colW + 20, H * wt); }
  const bgc = wt > 0.5 ? b.to : b.from, dark = lum(bgc) < 0.4, fg = dark ? PAPER : INK; bgFill = bgc;

  const beatLen = G.stepDur * 4, bp = (now - G.startTime) / beatLen;
  const pulse = bp >= 0 && now < G.songEnd ? Math.exp(-(bp - Math.floor(bp)) * 7) : 0;

  drawTrack(now, perf, fg, dark, pulse);
  drawStrip(now, perf, fg);
  drawFx(now, perf, fg, dark);
  drawJudgement(perf, fg, dark);   // last in the play area: nothing ever sits on top of it
  drawHud(now, perf, fg, dark);
  drawOverlays(now, perf, fg);
  ctx.restore();
}

let bgFill = "#fff";
const SLOW = 1.35;   // first-run hint cards fall this much slower
/** 0–1 visibility of the day banner: in on the day's first frame, fully gone before the first card is a tenth of the way down. */
function bannerA(now, perf) {
  const b = G.banner; if (!b) return 0;
  const first = G.cards[0], ap = G.spec.approach * (first.slow ? SLOW : 1);
  return Math.min(clamp((perf - b.t0) / 250, 0, 1), clamp((first.time - ap * 0.9 - now) / 0.35, 0, 1));
}
function drawTrack(now, perf, fg, dark, pulse) {
  const lx = (L.colW - L.laneW) / 2, cx = L.colW / 2;
  ctx.save();
  ctx.beginPath(); ctx.rect(-10, L.trackTop, L.colW + 20, L.stripTop - L.trackTop); ctx.clip();
  // the lane
  ctx.fillStyle = dark ? "rgba(255,255,255,0.06)" : "rgba(19,19,19,0.045)";
  roundRect(ctx, lx, L.trackTop - 30, L.laneW, L.nowY - L.trackTop + 30 + L.cardH / 2 + 8, 22); ctx.fill();
  // beat grid scrolling down the lane, bar lines heavier
  const ap = G.spec.approach, beatLen = G.stepDur * 4;
  const k0 = Math.ceil((now - G.startTime - 0.3) / beatLen), k1 = Math.floor((now + ap - G.startTime) / beatLen);
  for (let k = Math.max(0, k0); k <= k1; k++) {
    const t = G.startTime + k * beatLen; if (t > G.songEnd) break;
    const y = L.nowY - ((t - now) / ap) * L.trackLen; if (y > L.nowY) continue;
    const barLine = k % 4 === 0;
    ctx.fillStyle = dark ? `rgba(255,255,255,${barLine ? 0.16 : 0.07})` : `rgba(19,19,19,${barLine ? 0.13 : 0.06})`;
    ctx.fillRect(lx + 10, y - (barLine ? 1.5 : 1), L.laneW - 20, barLine ? 3 : 2);
  }
  // giant combo number in the background
  if (G.combo >= 4 && bannerA(now, perf) <= 0) {
    const size = Math.min(L.trackLen * 0.34, L.colW * 0.42);
    ctx.fillStyle = dark ? "rgba(255,255,255,0.08)" : "rgba(19,19,19,0.06)";
    ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.font = `900 ${size}px ${FONT}`;
    const y = L.trackTop + L.trackLen * 0.45; ctx.fillText(String(G.combo), cx, y);
    ctx.font = `800 13px ${FONT}`; ctx.fillStyle = dark ? "rgba(255,255,255,0.35)" : "rgba(19,19,19,0.32)"; ctx.fillText("COMBO", cx, y + size * 0.5 + 4);
  }
  // NOW line (full width) + the target slot, both pulsing on the beat
  ctx.fillStyle = fg; const lh = 3 + pulse * 3;
  ctx.fillRect(0, L.nowY - lh / 2, L.colW, lh);
  const sc = 1 + pulse * 0.035;
  ctx.save(); ctx.translate(cx, L.nowY); ctx.scale(sc, sc);
  const sw = L.cardW + 12, sh = L.cardH + 12;
  ctx.fillStyle = bgFill; roundRect(ctx, -sw / 2, -sh / 2, sw, sh, 18); ctx.fill();
  ctx.strokeStyle = fg; ctx.lineWidth = 3; ctx.stroke();
  // on a hit the slot flashes the shot's colour (the words live in the row below)
  const w = G.word, wt = w ? (perf - w.t0) / 1000 : 9;
  if (w && w.j !== "hint" && wt < 0.35) {
    ctx.globalAlpha = 0.9 * Math.exp(-wt * 8); ctx.fillStyle = w.lane ? SHOT[w.lane].color : dark ? "#3A3836" : "#8A847D";
    roundRect(ctx, -sw / 2, -sh / 2, sw, sh, 18); ctx.fill(); ctx.globalAlpha = 1;
  }
  // the NOW label steps aside whenever a card (arriving, waiting or fading out) is in the slot
  const ap0 = G.spec.approach, reach = (L.cardH + 8) / L.trackLen;
  const busy = G.cards.some((c, i) => i >= G.next - 4 && (c.j ? (c.j === "miss" || c.j === "wrong" ? perf - c.jt < 480 : perf - c.jt < 80) : (c.time - now) / (ap0 * (c.slow ? SLOW : 1)) < reach && c.time - now > -1));
  if (!busy) {
    ctx.fillStyle = dark ? `rgba(255,255,255,${0.22 + pulse * 0.2})` : `rgba(19,19,19,${0.16 + pulse * 0.14})`;
    ctx.font = `900 ${Math.round(L.cardH * 0.36)}px ${FONT}`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("NOW", 0, 1);
  }
  ctx.restore();

  // cards
  for (let i = G.next > 3 ? G.next - 3 : 0; i < G.cards.length; i++) {
    const c = G.cards[i];
    const ap2 = c.slow ? ap * SLOW : ap;
    if (c.time - now > ap2 + 0.3) { if (!c.slow) break; else continue; }
    drawCard(c, now, perf, ap2, dark);
  }
  // day banner + tip sit above everything in the lane (and are gone before cards arrive)
  drawBanner(now, perf, fg, dark);
  drawTip(now, perf, fg, dark);
  ctx.restore();
}

/** The judgement row: its own strip between the NOW slot and the bottles. Nothing else goes here. */
function drawJudgement(perf, fg, dark) {
  const w = G.word; if (!w) return;
  const t = (perf - w.t0) / 1000; if (t > 0.7) return;
  const a = t < 0.5 ? 1 : 1 - (t - 0.5) / 0.2;
  let fill = INK, ink = PAPER;
  if (w.j === "perfect") { fill = SHOT[w.lane].color; ink = inkOn(w.lane); }
  else if (w.j === "good") { fill = fg; ink = dark ? INK : PAPER; }
  else if (w.j === "early" || w.j === "late") { fill = dark ? "#5A5652" : STONE_DARK; ink = dark ? PAPER : INK; }
  else if (w.j === "hint") { fill = fg; ink = dark ? INK : PAPER; }
  else { fill = dark ? "#3A3836" : "#8A847D"; ink = PAPER; }
  const size = L.compact ? 13 : 16, ph = L.rowH - (L.compact ? 6 : 10);
  ctx.save(); ctx.globalAlpha = clamp(a, 0, 1);
  ctx.font = `900 ${size}px ${FONT}`; const pw = ctx.measureText(w.text).width + size * 1.4;
  ctx.font = `800 ${size - 2}px ${FONT}`; const tagW = w.tag ? ctx.measureText(w.tag).width + 10 : 0;
  const x0 = L.colW / 2 - (pw + tagW) / 2, pop = t < 0.08 ? 1.25 - t * 3.1 : 1;
  ctx.translate(x0 + pw / 2, L.rowY); ctx.scale(pop, pop);
  ctx.fillStyle = fill; roundRect(ctx, -pw / 2, -ph / 2, pw, ph, ph / 2); ctx.fill();
  ctx.fillStyle = ink; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.font = `900 ${size}px ${FONT}`; ctx.fillText(w.text, 0, 1);
  if (w.tag) { ctx.fillStyle = fg; ctx.textAlign = "left"; ctx.font = `800 ${size - 2}px ${FONT}`; ctx.fillText(w.tag, pw / 2 + 10, 1); }
  ctx.restore();
}

function drawCard(c, now, perf, ap, dark) {
  const cx = L.colW / 2; let y = Math.min(L.nowY + 3, L.nowY - ((c.time - now) / ap) * L.trackLen);   // a late card waits on the line
  let alpha = 1, scale = 1, dx = 0, grey = false, flash = 0;
  if (c.j === "miss") { grey = true; const t = (perf - c.jt) / 1000; y = L.nowY + 3; scale = 1 - 0.12 * easeOut(t / 0.4); alpha = clamp(1 - t / 0.4, 0, 1) * 0.7; }
  else if (c.j === "wrong") { grey = true; const t = (perf - c.jt) / 1000; dx = Math.sin(t * 60) * 9 * Math.exp(-t * 8); y = L.nowY; scale = 1 - 0.1 * easeOut(t / 0.45); alpha = clamp(1 - t / 0.45, 0, 1); }
  else if (c.j) {
    // hit-stop: hold on the line with a white flash for a beat of a frame, then fly into the bottle
    const t = (perf - c.jt) / 1000; if (t > 0.07) return;
    y = L.nowY; flash = 1 - t / 0.07; scale = 1 + 0.08 * (1 - t / 0.07);
  }
  if (alpha <= 0 || y < L.trackTop - L.cardH) return;
  const big = c.text === "LIGHTS OUT" ? 1.12 : 1;
  const w = L.cardW * big, h = L.cardH * big, s = SHOT[c.lane];
  ctx.save(); ctx.globalAlpha = alpha; ctx.translate(cx + dx, y); ctx.scale(scale, scale);
  drawCardBody(ctx, c.text, s, w, h, grey ? "grey" : G.spec.colour, dark);
  if (flash > 0) { ctx.globalAlpha = flash * 0.85; ctx.fillStyle = PAPER; roundRect(ctx, -w / 2, -h / 2, w, h, h * 0.3); ctx.fill(); }
  ctx.restore();
}
/** A moment card centred on 0,0. mode: full (shot colour) | stripe | none | grey */
function drawCardBody(x, text, s, w, h, mode, dark) {
  const r = Math.min(h * 0.3, 18);
  x.fillStyle = dark ? "rgba(0,0,0,0.35)" : "rgba(19,19,19,0.13)"; roundRect(x, -w / 2, -h / 2 + 4, w, h, r); x.fill();
  let fill = PAPER, ink = INK, pad = 16;
  if (mode === "full") { fill = s.color; ink = inkOn(s.id); }
  if (mode === "grey") { fill = dark ? "#3A3836" : STONE_DARK; ink = dark ? "#8A8682" : "#7A756F"; }
  x.fillStyle = fill; roundRect(x, -w / 2, -h / 2, w, h, r); x.fill();
  if (mode === "stripe") { x.save(); roundRect(x, -w / 2, -h / 2, w, h, r); x.clip(); x.fillStyle = s.color; x.fillRect(-w / 2, -h / 2, 14, h); x.fillRect(w / 2 - 14, -h / 2, 14, h); x.restore(); pad = 26; }
  if (mode === "none" && !dark) { x.strokeStyle = INK; x.lineWidth = 2; roundRect(x, -w / 2 + 1, -h / 2 + 1, w - 2, h - 2, r); x.stroke(); }
  x.fillStyle = ink; x.textAlign = "center"; x.textBaseline = "middle";
  fitFont(x, 900, Math.round(h * 0.42), text, w - pad * 2, 12);
  x.fillText(text, 0, 1);
}

function drawStrip(now, perf, fg) {
  const top = L.stripTop;
  ctx.fillStyle = STONE; roundRect(ctx, 0, top, L.colW, H - top + 40, 26); ctx.fill();
  const coachCard = G.coach && phase === "play" ? G.cards.find((c) => c.slow && !c.j && c.time - heardAt(perf) < G.spec.approach * SLOW) : null;
  const hp = G.hintPad && perf - G.hintPad.t0 < 900 ? G.hintPad : null;
  for (let i = 0; i < 5; i++) {
    const s = SHOTS[i], p = G.pads[i], cx = padCx(i), x0 = L.padW * i;
    const t = (perf - p.t) / 1000;
    // column flash: big colour block on a hit, a whisper on a stray tap
    let fa = 0, fcol = s.color;
    if (p.kind === "hit") fa = 0.95 * Math.exp(-((perf - p.hitT) / 1000) * 5.5);
    else if (p.kind === "wrong") { fa = 0.55 * Math.exp(-t * 6); fcol = INK; }
    else if (t < 1) fa = 0.3 * Math.exp(-t * 9);
    if (coachCard && coachCard.li === i) fa = Math.max(fa, 0.35 + 0.25 * Math.sin(perf / 120));
    if (hp && hp.lane === i) fa = Math.max(fa, 0.6 * (0.5 + 0.5 * Math.cos((perf - hp.t0) / 70)) * (1 - (perf - hp.t0) / 900));
    if (fa > 0.01) {
      ctx.save(); roundRect(ctx, 0, top, L.colW, H - top + 40, 26); ctx.clip();
      ctx.globalAlpha = fa; ctx.fillStyle = fcol; ctx.fillRect(x0, top, L.padW, H - top); ctx.restore();
    }
    // a flat colour coaster under each bottle
    ctx.fillStyle = s.color; ctx.beginPath(); ctx.ellipse(cx, L.bottleBase + 1, Math.min(L.padW * 0.42, L.bh * 0.36), Math.max(5, L.bh * 0.05), 0, 0, Math.PI * 2); ctx.fill();
    // bottle with squash & stretch on press
    const sp = sprites[s.id]; if (!sp) continue;
    let sxs = 1, sys = 1, lift = 0;
    if (t < 0.6) { const k = Math.exp(-t * 11) * Math.cos(t * 34); sys = 1 - 0.13 * k; sxs = 1 + 0.09 * k; if (p.kind === "hit") lift = -Math.max(0, Math.sin(Math.min(1, t * 6) * Math.PI)) * 8; }
    ctx.save(); ctx.translate(cx, L.bottleBase + lift); ctx.scale(sxs, sys);
    ctx.drawImage(sp.c, -sp.sw / 2, -sp.base, sp.sw, sp.sh);
    // cap flash
    if (p.kind === "hit" && t < 0.3) {
      const capW = L.bh * 0.44 * 0.7, capH = L.bh * 0.2;
      ctx.globalAlpha = Math.exp(-t * 12) * 0.9; ctx.fillStyle = PAPER; roundRect(ctx, -capW / 2, -L.bh, capW, capH, capW * 0.08); ctx.fill();
    }
    ctx.restore();
    // name + key hint
    ctx.fillStyle = INK; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    fitFont(ctx, 800, L.nameSize, s.name, L.padW - 6, 12); ctx.fillText(s.name, cx, L.nameY);
    if (L.keys && !L.compact) {
      ctx.font = `800 12px ${FONT}`; ctx.strokeStyle = "rgba(19,19,19,0.35)"; ctx.lineWidth = 1.5;
      roundRect(ctx, cx - 11, L.keyY - 10, 22, 20, 6); ctx.stroke(); ctx.fillStyle = "rgba(19,19,19,0.7)"; ctx.fillText(KEYLABEL[i], cx, L.keyY + 1);
    }
  }
  // first-run hint: "TAP ENERGY ↓" over the pad it wants
  if (coachCard && !(G.word && perf - G.word.t0 < 700)) {
    const s = SHOT[coachCard.lane], text = `TAP ${s.name} ↓`;
    ctx.font = `900 13px ${FONT}`; const tw = ctx.measureText(text).width + 24, ph = L.compact ? 22 : 26;
    const x = clamp(padCx(coachCard.li), tw / 2 + 6, L.colW - tw / 2 - 6), y = L.rowY;
    const bob = Math.sin(perf / 140) * 2;
    ctx.fillStyle = INK; roundRect(ctx, x - tw / 2, y - ph / 2 + bob, tw, ph, ph / 2); ctx.fill();
    ctx.fillStyle = PAPER; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(text, x, y + 1 + bob);
  }
}

function drawFx(now, perf, fg, dark) {
  // cards flying into their bottle
  for (const f of G.fly) {
    const t = (perf - f.t0) / 1000 - 0.07; if (t < 0) continue;
    const k = easeIn(t / 0.26); if (k >= 1) { if (!f.landed) { f.landed = true; burst(padCx(f.c.li), L.bottleBase - L.bh * 0.95, SHOT[f.c.lane], 8, 0.55); } continue; }
    const x = L.colW / 2 + (padCx(f.c.li) - L.colW / 2) * k, y = L.nowY + (L.bottleBase - L.bh * 0.9 - L.nowY) * k;
    ctx.save(); ctx.translate(x, y); ctx.rotate((f.c.li - 2) * 0.25 * k); const sc = 0.7 - 0.5 * k; ctx.scale(sc, sc); ctx.globalAlpha = 0.9 - k * 0.5;
    drawCardBody(ctx, f.c.text, SHOT[f.c.lane], L.cardW, L.cardH, "full", dark); // once caught, a card shows its true colour
    ctx.restore();
  }
  // particles
  for (const p of G.parts) {
    const a = 1 - p.t / p.life; ctx.globalAlpha = clamp(a * 1.4, 0, 1); ctx.fillStyle = p.col;
    if (p.sq) { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillRect(-p.r, -p.r * 0.6, p.r * 2, p.r * 1.2); ctx.restore(); }
    else { ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (0.6 + a * 0.4), 0, Math.PI * 2); ctx.fill(); }
  }
  ctx.globalAlpha = 1;
}

function drawHud(now, perf, fg, dark) {
  const g = L.g, top = L.hudTop, right = L.colW - g;
  ctx.textBaseline = "alphabetic";
  // pause button
  const px = right - 20, py = top + 20;
  ctx.fillStyle = dark ? "rgba(255,255,255,0.14)" : "rgba(19,19,19,0.08)"; ctx.beginPath(); ctx.arc(px, py, 20, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = fg; ctx.fillRect(px - 6, py - 7, 4, 14); ctx.fillRect(px + 2, py - 7, 4, 14);
  const scoreRight = px - 32;
  const low = G.meter < 0.25;
  const meterCol = low ? (Math.sin(perf / 90) > 0 ? SHOT.energy.color : fg) : fg;
  const drawMeter = (x, y, w, h) => {
    ctx.fillStyle = dark ? "rgba(255,255,255,0.16)" : "rgba(19,19,19,0.1)"; roundRect(ctx, x, y, w, h, h / 2); ctx.fill();
    const fw = Math.max(h, w * clamp(G.meter, 0, 1)); if (G.meter > 0.005) { ctx.fillStyle = meterCol; roundRect(ctx, x, y, fw, h, h / 2); ctx.fill(); }
    ctx.fillStyle = dark ? "rgba(19,19,19,0.5)" : "rgba(255,255,255,0.55)"; for (let k = 1; k < 4; k++) ctx.fillRect(x + (w * k) / 4 - 1, y + 2, 2, h - 4);
  };
  if (!L.compact) {
    ctx.fillStyle = fg; ctx.textAlign = "left"; ctx.font = `900 26px ${FONT}`; ctx.fillText(`DAY ${G.day}`, g, top + 26);
    const dw = ctx.measureText(`DAY ${G.day}`).width;
    ctx.font = `800 14px ${FONT}`; ctx.fillText(dayClock(now), g + dw + 12, top + 25);
    ctx.font = `700 13px ${FONT}`; ctx.globalAlpha = 0.6; ctx.fillText(sectionLabel(now), g, top + 48); ctx.globalAlpha = 1;
    ctx.textAlign = "right"; ctx.font = `900 28px ${FONT}`; ctx.fillText(fmt(G.score), scoreRight, top + 28);
    let chipW = 0;
    if (G.mult > 1) {
      const txt = `×${G.mult} COMBO`; ctx.font = `900 13px ${FONT}`; const tw = ctx.measureText(txt).width + 18; chipW = tw;
      const id = [null, null, "focus", "exercise", "energy"][G.mult];
      const mp = G.multPop ? (perf - G.multPop) / 1000 : 9, sc = mp < 0.5 ? 1 + 0.45 * Math.exp(-mp * 9) * Math.cos(mp * 18) : 1;
      ctx.save(); ctx.translate(scoreRight - tw / 2, top + 47); ctx.scale(sc, sc);
      ctx.fillStyle = SHOT[id].color; roundRect(ctx, -tw / 2, -11, tw, 22, 11); ctx.fill();
      ctx.fillStyle = inkOn(id); ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(txt, 0, 1); ctx.restore(); ctx.textBaseline = "alphabetic";
    }
    // score pop, in the HUD under the score
    const sp = G.pops[0];
    if (sp && perf - sp.t0 < 650) {
      const t = (perf - sp.t0) / 1000; ctx.globalAlpha = clamp(1 - (t - 0.35) / 0.3, 0, 1);
      ctx.textAlign = "right"; ctx.font = `900 14px ${FONT}`; ctx.fillStyle = fg; ctx.fillText(sp.text, scoreRight - chipW - (chipW ? 8 : 0), top + 52 - easeOut(t / 0.65) * 5); ctx.globalAlpha = 1;
    }
    ctx.textAlign = "left"; ctx.fillStyle = fg; ctx.font = `800 12px ${FONT}`; ctx.fillText("RHYTHM >", g, top + 76);
    drawMeter(g + 74, top + 66, right - g - 74, 12);
  } else {
    ctx.fillStyle = fg; ctx.textAlign = "left"; ctx.font = `900 20px ${FONT}`; ctx.fillText(`DAY ${G.day}`, g, top + 27);
    const dw = ctx.measureText(`DAY ${G.day}`).width; ctx.font = `800 13px ${FONT}`; ctx.fillText(dayClock(now), g + dw + 8, top + 26);
    const cw = ctx.measureText(dayClock(now)).width;
    ctx.textAlign = "right"; ctx.font = `900 22px ${FONT}`; ctx.fillText(fmt(G.score) + (G.mult > 1 ? ` ×${G.mult}` : ""), scoreRight, top + 28);
    const sw = ctx.measureText(fmt(G.score) + (G.mult > 1 ? ` ×${G.mult}` : "")).width;
    const mx = g + dw + 8 + cw + 14, mw = scoreRight - sw - 14 - mx;
    if (mw > 40) drawMeter(mx, top + 15, mw, 10);
  }
}

function drawBanner(now, perf, fg, dark) {
  const b = G.banner; if (!b) return;
  const t = (perf - b.t0) / 1000, a = bannerA(now, perf); if (a <= 0) return;
  const cy = L.trackTop + L.trackLen * 0.4;
  ctx.save(); ctx.globalAlpha = clamp(a, 0, 1); ctx.fillStyle = fg; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
  const size = Math.min(L.colW * 0.27, L.trackLen * 0.3, 118);
  ctx.font = `900 ${size}px ${FONT}`; ctx.fillText(`DAY ${b.day}`, L.colW / 2, cy + size * 0.1 + (1 - easeOut(t / 0.4)) * 20);
  ctx.restore();
}
/** the day's one-line tip, as a pill above the cards so a falling card never hides it */
function drawTip(now, perf, fg, dark) {
  const a = bannerA(now, perf); if (a <= 0) return;
  const text = `${({ MON: "Monday", TUE: "Tuesday", WED: "Wednesday", THU: "Thursday", FRI: "Friday", SAT: "Saturday", SUN: "Sunday" })[G.chart.weekday]} · ${G.spec.bpm} BPM · ${G.spec.tip}`;
  const size = fitFont(ctx, 800, 14, text, L.colW - 2 * L.g - 32, 12); const tw = ctx.measureText(text).width + 30, ph = size + 16;
  const y = L.trackTop + L.trackLen * 0.4 + Math.min(L.colW * 0.27, L.trackLen * 0.3, 118) * 0.1 + 34;
  ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = fg; roundRect(ctx, L.colW / 2 - tw / 2, y - ph / 2, tw, ph, ph / 2); ctx.fill();
  ctx.fillStyle = dark ? INK : PAPER; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(text, L.colW / 2, y + 1); ctx.restore();
}

function drawOverlays(now, perf, fg) {
  const cx = L.colW / 2;
  // white flash
  if (G.flash) { const t = (perf - G.flash.t0) / 1000; if (t >= 0 && t < 0.35) { ctx.globalAlpha = G.flash.a * (1 - t / 0.35); ctx.fillStyle = G.flash.color; ctx.fillRect(-10, 0, L.colW + 20, H); ctx.globalAlpha = 1; } }
  // DAY DONE · LIGHTS OUT
  const showClear = phase === "clear" || (G.clearOut && perf - G.clearOut < 450);
  if (showClear && G.clearT0) {
    const tin = (perf - G.clearT0) / 1000; if (tin < 0) return;
    const out = phase === "clear" ? 0 : easeIn((perf - G.clearOut) / 450);
    const k = easeOut(tin / 0.42);
    const top = H * (1 - k) - H * out;
    ctx.fillStyle = SHOT.sleep.color; ctx.fillRect(-10, top, L.colW + 20, H);
    ctx.save(); ctx.beginPath(); ctx.rect(-10, top, L.colW + 20, H); ctx.clip();
    const a = clamp((tin - 0.2) / 0.3, 0, 1); ctx.globalAlpha = a;
    const d = G.clearStats.day, y0 = top + (L.compact ? 30 + L.ins.t : H * 0.2 + L.ins.t * 0.5);
    ctx.fillStyle = PAPER; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    ctx.font = `800 16px ${FONT}`; ctx.fillText(SHOT.sleep.tag, L.g + 6, y0);
    let y;
    if (L.compact) {   // short screens: one line of title, pill and stats side by side
      const size = fitFont(ctx, 900, 72, `DAY ${d} DONE.`, L.colW - L.g * 2 - 12, 32);
      ctx.fillText(`DAY ${d} DONE.`, L.g + 2, y0 + size * 0.95); y = y0 + size * 0.95 + 16;
    } else {
      const size = fitFont(ctx, 900, Math.min(L.colW * 0.28, 128), `DAY ${d}`, L.colW - L.g * 2 - 12, 40);
      ctx.fillText(`DAY ${d}`, L.g + 2, y0 + size * 0.95); ctx.fillText("DONE.", L.g + 2, y0 + size * 1.85); y = y0 + size * 1.85 + 26;
    }
    // LIGHTS OUT pill
    ctx.font = `900 18px ${FONT}`; const lw = ctx.measureText("LIGHTS OUT").width + 32;
    ctx.fillStyle = INK; roundRect(ctx, L.g + 6, y, lw, 40, 20); ctx.fill(); ctx.fillStyle = PAPER; ctx.textBaseline = "middle"; ctx.fillText("LIGHTS OUT", L.g + 22, y + 21);
    ctx.textBaseline = "alphabetic"; ctx.font = `800 15px ${FONT}`; ctx.fillStyle = PAPER;
    const stats = `${G.clearStats.perfect} perfect · +${fmt(G.clearBonus || 0)} day bonus`;
    if (L.compact) { ctx.textBaseline = "middle"; ctx.fillText(stats, L.g + lw + 20, y + 21); ctx.textBaseline = "alphabetic"; y += 40; }
    else { y += 66; ctx.fillText(stats, L.g + 6, y); }
    if (G.clearReward) {
      y += L.compact ? 12 : 22; const r = G.clearReward;
      ctx.fillStyle = PAPER; roundRect(ctx, L.g + 6, y, L.colW - L.g * 2 - 12, 64, 18); ctx.fill();
      ctx.fillStyle = SHOT.sleep.dark; ctx.font = `800 12px ${FONT}`; ctx.fillText("UNLOCKED · BLACK FRIDAY CODE", L.g + 22, y + 22);
      ctx.fillStyle = INK; ctx.font = `900 22px ${FONT}`; ctx.fillText(r.code, L.g + 22, y + 48);
      ctx.textAlign = "right"; ctx.fillText(r.pct, L.colW - L.g - 22, y + 48); ctx.textAlign = "left";
      y += 64;
    }
    // what's next sits right under the content, so the colour fade is never a surprise
    const nx = daySpec(d + 1), nextLine = `Day ${d + 1}: ${nx.tip.charAt(0).toLowerCase()}${nx.tip.slice(1)} >`;
    ctx.textAlign = "left"; ctx.fillStyle = PAPER; ctx.globalAlpha = a;
    fitFont(ctx, 800, 17, nextLine, L.colW - L.g * 2 - 12, 13);
    const ny = y + (L.compact ? 30 : 40); ctx.fillText(nextLine, L.g + 6, ny);
    // hero shot: the Sleep bottle and its moon, only in the space below that line (never behind text)
    const bb = top + H - L.ins.b - 24, bh = Math.min(H * 0.42, L.colW * 0.62, (bb - (ny + 22)) / 1.02);
    if (bh > 110) {
      const bx = L.colW * 0.68, rise = (1 - easeOut((tin - 0.15) / 0.6)) * 80;
      ctx.save(); ctx.beginPath(); ctx.rect(-10, ny + 14, L.colW + 20, H); ctx.clip();
      ctx.globalAlpha = 1; ctx.fillStyle = SHOT.sleep.light; ctx.beginPath(); ctx.arc(bx + bh * 0.05, bb - bh * 0.55 + rise * 0.5, Math.min(bh * 0.42, (bb - ny - 22) * 0.5), 0, Math.PI * 2); ctx.fill();
      drawBottle(ctx, bx, bb - bh / 2 + rise, bh, "sleep", { tilt: 0.1 });
      ctx.restore();
    }
    ctx.restore();
  }
  // OUT OF RHYTHM
  if (phase === "over" && G.overT0) {
    const t = (perf - G.overT0) / 1000; const k = easeOut(t / 0.35);
    ctx.globalAlpha = 0.93 * k; ctx.fillStyle = INK; ctx.fillRect(-10, 0, L.colW + 20, H); ctx.globalAlpha = clamp((t - 0.15) / 0.3, 0, 1);
    ctx.fillStyle = PAPER; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const size = fitFont(ctx, 900, Math.min(L.colW * 0.2, 92), "RHYTHM.", L.colW - L.g * 2 - 8, 36);
    const y = H * 0.42; ctx.fillText("OUT OF", L.g + 4, y); ctx.fillText("RHYTHM.", L.g + 4, y + size * 0.92);
    ctx.font = `800 16px ${FONT}`; ctx.fillText(`Day ${G.day} · ${dayClock(G.frozenOver ?? (G.frozenOver = heardAt(perf)))}`, L.g + 6, y + size * 0.92 + 34);
    ctx.globalAlpha = 1;
  }
  // 3-2-1
  if (phase === "countdown" || (phase === "paused" && G.autoPaused)) {
    ctx.globalAlpha = 0.6; ctx.fillStyle = STONE; ctx.fillRect(-10, 0, L.colW + 20, H); ctx.globalAlpha = 1;
    ctx.fillStyle = INK; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    if (phase === "countdown") {
      const e = (perf - G.cdT0) / 700, n = 3 - Math.floor(e), f = e - Math.floor(e);
      ctx.save(); ctx.translate(cx, H * 0.42); const sc = 1.25 - easeOut(f / 0.3) * 0.25; ctx.scale(sc, sc);
      ctx.font = `900 150px ${FONT}`; ctx.globalAlpha = 1 - Math.max(0, f - 0.7) / 0.3; ctx.fillText(String(Math.max(1, n)), 0, 0); ctx.restore();
      ctx.font = `800 16px ${FONT}`; ctx.fillText("Back in the rhythm", cx, H * 0.42 + 100);
    } else { ctx.font = `900 40px ${FONT}`; ctx.fillText("Paused", cx, H * 0.42); }
  }
}

function drawSides(now) {
  // desktop: the column sits on stone; wordmark on the left, key legend on the right
  if (L.side < 210 || H < 480) return;
  const lx = Math.max(32, L.side - 300), maxW = L.side - lx - 36;
  const wm = Math.min(72, maxW * 0.34);
  drawWordmark(ctx, lx, H * 0.3, wm, INK, true);
  ctx.fillStyle = INK; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  const hs = fitFont(ctx, 900, 44, "right moment.", maxW, 22);
  ctx.fillText("Right shot,", lx, H * 0.3 + wm * 0.5 + hs * 1.2); ctx.fillText("right moment.", lx, H * 0.3 + wm * 0.5 + hs * 2.15);
  SHOTS.forEach((s, i) => { ctx.fillStyle = s.color; ctx.beginPath(); ctx.arc(lx + 14 + i * 34, H * 0.3 + wm * 0.5 + hs * 2.15 + 40, 13, 0, Math.PI * 2); ctx.fill(); });
  if (!L.keys) return;
  const rx = L.colX + L.colW + 48;
  let y = H * 0.3 - 30;
  ctx.fillStyle = INK; ctx.font = `800 15px ${FONT}`; ctx.fillText("KEYS >", rx, y); y += 22;
  SHOTS.forEach((s, i) => {
    ctx.fillStyle = s.color; ctx.beginPath(); ctx.arc(rx + 9, y + 15, 9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = INK; ctx.strokeStyle = INK; ctx.lineWidth = 2; roundRect(ctx, rx + 28, y + 3, 26, 24, 7); ctx.stroke();
    ctx.font = `900 14px ${FONT}`; ctx.textAlign = "center"; ctx.fillText(KEYLABEL[i], rx + 41, y + 20);
    ctx.textAlign = "left"; ctx.font = `800 15px ${FONT}`; ctx.fillText(s.name, rx + 66, y + 20);
    y += 36;
  });
  ctx.font = `700 13px ${FONT}`; ctx.globalAlpha = 0.6; ctx.fillText("Esc to pause", rx, y + 14); ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------- start-screen hero
const hero = $("#hero"), hx = hero.getContext("2d"); let heroW = 0, heroH = 0;
function sizeHero() {
  const r = hero.getBoundingClientRect(); heroW = Math.max(1, r.width); heroH = Math.max(1, r.height);
  hero.width = Math.round(heroW * DPR); hero.height = Math.round(heroH * DPR);
}
function drawHero(perf) {
  if (!heroW) sizeHero(); if (heroW < 2) return;
  const x = hx; x.setTransform(DPR, 0, 0, DPR, 0, 0);
  x.fillStyle = STONE; x.fillRect(0, 0, heroW, heroH);
  // a slow 96 BPM pulse runs through the range, left to right, like the game's first day
  const beat = perf / 625, f = beat - Math.floor(beat), pulse = Math.exp(-f * 5), on = Math.floor(beat) % 5;
  const step = Math.min(heroW / 5.3, 96), x0 = heroW / 2 - step * 2;
  const bh = Math.min(heroH * 0.54, step * 1.75), base = heroH - Math.max(14, heroH * 0.08);
  SHOTS.forEach((s, i) => {   // flat colour coasters, the one on the beat swells
    const cx = x0 + step * i, b = on === i ? pulse : 0;
    x.fillStyle = s.color; x.beginPath(); x.ellipse(cx, base + 1, step * 0.44 * (1 + b * 0.12), Math.max(5, bh * 0.06) * (1 + b * 0.2), 0, 0, Math.PI * 2); x.fill();
  });
  SHOTS.forEach((s, i) => {
    const cx = x0 + step * i, b = on === i ? pulse : 0;
    x.save(); x.translate(cx, base - b * 6); x.scale(1 + b * 0.05, 1 - b * 0.05); drawBottle(x, 0, -bh / 2, bh, s.id, {}); x.restore();
  });
  // moment stickers, tilted, floating above
  const cw = Math.min(heroW * 0.34, 150), ch = Math.round(Math.max(28, cw * 0.26));
  const room = base - bh - 8;
  [["3PM SLUMP", "energy", -0.1, 0.22, 0.36], ["LEG DAY", "exercise", 0.07, 0.52, 0.2], ["LIGHTS OUT", "sleep", -0.05, 0.8, 0.42]].forEach(([t, id, rot, px, py], k) => {
    const bob = Math.sin(perf / 420 + k * 1.7) * 3;
    x.save(); x.translate(heroW * px, Math.max(ch / 2 + 8, room * py + ch / 2) + bob); x.rotate(rot);
    drawCardBody(x, t, SHOT[id], cw, ch, "full", false); x.restore();
  });
}

// ---------------------------------------------------------------- screens
function showScreen(id) {
  for (const s of ["start", "pause", "end", "timing"]) $("#" + s).classList.toggle("hidden", s !== id);
}
function syncMute() { $$(".mute").forEach((b) => { b.setAttribute("aria-pressed", audio.muted ? "true" : "false"); b.querySelector(".lbl").textContent = audio.muted ? "Sound off" : "Sound on"; }); }
$$(".mute").forEach((b) => b.addEventListener("click", () => { audio.setMuted(!audio.muted); syncMute(); }));
syncMute();

$("#play").addEventListener("click", () => startRun(1));
$("#again").addEventListener("click", () => startRun(1));

function showEnd() {
  if (!G || phase === "end") return;
  saveOffset();
  phase = "end";
  const best = Math.max(+LS.get("ryde:rhythm:best") || 0, 0), isBest = G.score > best && G.score > 0;
  if (isBest) LS.set("ryde:rhythm:best", String(Math.round(G.score)));
  const judged = Object.values(G.counts).reduce((a, b) => a + b, 0);
  // the end block takes the colour of the moment you reached (stone if you didn't get past the morning)
  const endT = G.frozenOver ?? (G.chart ? heardAt(performance.now()) : 0), hr = G.chart ? clockHour(endT) : 6;
  // morning → Focus yellow, midday → Exercise teal, evening → Relax blue, night / lights out → Sleep purple. Never Energy red.
  const ended = phase === "clear" || G.cleared >= G.day || hr >= 18.4 ? "sleep" : hr < 10.1 ? "focus" : hr < 14.25 ? "exercise" : "relax";
  const eh = $("#endhero"); eh.style.setProperty("--c", ended ? SHOT[ended].color : STONE); eh.style.setProperty("--t", ended ? inkOn(ended) : INK);
  const clock = G.chart && G.frozenOver != null ? dayClock(G.frozenOver) : null;
  $("#endEyebrow").textContent = G.meter <= 0 ? `Out of rhythm · ${clock || "dawn"}, Day ${G.day}` : `Run ended on Day ${G.day}`;
  $("#endScore").textContent = fmt(G.score);
  $("#stDay").textContent = String(G.day);
  $("#stCombo").textContent = String(G.bestCombo);
  $("#stPerf").textContent = judged ? Math.round((G.counts.perfect / judged) * 100) + "%" : "0%";
  $("#endBest").textContent = isBest ? "New personal best." : `Your best: ${fmt(Math.max(best, G.score))}`;
  // reward: the best tier this device has unlocked
  const tier = Math.max(+LS.get("ryde:rhythm:tier") || 0, G.cleared);
  const r = REWARDS.filter((x) => x.day <= tier).pop();
  const el = $("#reward");
  if (r) { el.className = "reward"; el.innerHTML = `<span class="label">${G.cleared >= r.day ? "UNLOCKED THIS RUN" : "YOUR CODE"} · PLACEHOLDER</span><b>${r.code}</b><span class="pct">${r.pct}</span><span class="t">${r.t}</span>`; }
  else { el.className = "reward locked"; el.innerHTML = `<span class="label">BLACK FRIDAY CODE · LOCKED</span><span class="lockline"><span class="lock" aria-hidden="true"></span>Make it to lights out on Day 1 to unlock 10% off.</span>`; }
  // post form
  const inp = $("#name"); if (!inp.value) inp.value = savedName();
  const btn = $("#post"); btn.disabled = false; btn.textContent = "Post score"; $("#postNote").textContent = "";
  const canPost = G.score >= MIN_POST; $("#postForm").hidden = !canPost;
  if (!canPost) $("#postNote").textContent = `Score ${MIN_POST}+ to post to the leaderboard.`;
  showScreen("end"); $("#end").scrollTop = 0;
  board.load();
}
$("#postForm").addEventListener("submit", async (e) => {
  e.preventDefault(); if (!G || G.score < MIN_POST) return;
  const btn = $("#post"), note = $("#postNote"), name = $("#name").value.trim().toUpperCase().slice(0, 12);
  if (!name) { note.textContent = "Add a name first."; $("#name").focus(); return; }
  if (G.posted) return;
  btn.disabled = true; btn.textContent = "Posting…"; note.textContent = "";
  try {
    const res = await board.post({ name, score: G.score, round: G.day, detail: G.bestCombo });
    G.posted = true;
    if (res.status === "review") { btn.textContent = "Held"; note.textContent = "That name needs a quick human check before it goes on the board. Your score is saved."; }
    else { btn.textContent = "Posted"; note.innerHTML = "You're on the board. <b>Nice rhythm.</b>"; }
  } catch { btn.disabled = false; btn.textContent = "Offline — try again"; }
});

const boardOpts = { fmt: (s) => fmt(s), roundLabel: (n) => `Day ${n}` };
board.onChange((view) => { renderBoard($("#board1"), view, boardOpts); renderBoard($("#board2"), view, boardOpts); });

// ---------------------------------------------------------------- timing calibration (pause → Timing)
// Its own short-lived AudioContext plays 4 count-in clicks + 8 beats at 100 BPM while the game's
// context stays suspended. Taps are compared with the heard beat; the median error becomes the offset.
const CAL = { open: false, ac: null, t0: 0, beat: 0.6, taps: [], off: null, raf: 0, done: false };
const calNote = () => { $("#calNote").textContent = `Current offset: ${jOff >= 0 ? "+" : ""}${Math.round(jOff * 1000)} ms${LS.get("ryde:rhythm:offset") ? "" : " (auto)"}`; };
function calOpen() { CAL.open = true; showScreen("timing"); $("#calCount").textContent = "Start"; $("#calPad").classList.remove("on"); calNote(); }
function calClose() { calStop(); CAL.open = false; showScreen("pause"); }
function calStop() { cancelAnimationFrame(CAL.raf); if (CAL.ac) { CAL.ac.close().catch(() => {}); CAL.ac = null; } $("#calPad").style.transform = ""; $("#calPad").style.boxShadow = ""; }
function calStart() {
  calStop(); const AC = window.AudioContext || window.webkitAudioContext; const ac = new AC(); CAL.ac = ac;
  CAL.taps = []; CAL.off = null; CAL.done = false; CAL.t0 = ac.currentTime + 0.5;
  for (let i = 0; i < 12; i++) {
    const t = CAL.t0 + i * CAL.beat, o = ac.createOscillator(), g = ac.createGain();
    o.frequency.value = i < 4 ? 1320 : 880; o.type = "sine"; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + 0.12);
  }
  const lat = () => clamp((ac.outputLatency || 0) + (ac.baseLatency || 0), 0, 0.3);
  const loop = () => {
    if (!CAL.ac) return;
    const est = ac.currentTime - performance.now() / 1000; CAL.off = CAL.off == null || Math.abs(est - CAL.off) > 0.03 ? est : CAL.off + (est - CAL.off) * 0.08;
    const heard = performance.now() / 1000 + CAL.off - lat(), k = (heard - CAL.t0) / CAL.beat, n = Math.floor(k), f = k - n;
    const pad = $("#calPad");
    if (k >= 0 && n < 12) { const e = Math.exp(-f * 6); pad.style.transform = `scale(${1 + 0.12 * e})`; pad.style.boxShadow = `0 0 0 ${Math.round(14 * e)}px rgba(6,175,154,${0.45 * e})`; $("#calCount").textContent = n < 4 ? String(4 - n) : String(n - 3); pad.classList.toggle("on", n >= 4); }
    if (k > 12.3 && !CAL.done) { CAL.done = true; calFinish(); return; }
    CAL.raf = requestAnimationFrame(loop);
  };
  CAL.lat = lat; CAL.raf = requestAnimationFrame(loop);
}
function calTap(perfMs) {
  if (!CAL.ac || CAL.off == null) { calStart(); return; }
  const heard = perfMs / 1000 + CAL.off - CAL.lat(), k = Math.round((heard - CAL.t0) / CAL.beat);
  if (k < 4 || k > 11) return;                                      // count-in taps don't count
  const d = heard - (CAL.t0 + k * CAL.beat); if (Math.abs(d) < 0.3) CAL.taps.push(d);
  const pad = $("#calPad"); pad.animate([{ filter: "brightness(1.4)" }, { filter: "none" }], { duration: 160 });
}
function calFinish() {
  const d = CAL.taps.slice().sort((a, b) => a - b);
  calStop(); $("#calPad").classList.remove("on");
  if (d.length < 4) { $("#calCount").textContent = "Again"; $("#calNote").textContent = "Didn't catch enough taps. Give it another go."; return; }
  jOff = clamp(d[Math.floor(d.length / 2)], -OFF_MAX, OFF_MAX); saveOffset();
  $("#calCount").textContent = "Set"; $("#calNote").textContent = `Set: ${jOff >= 0 ? "+" : ""}${Math.round(jOff * 1000)} ms. Saved for next time.`;
}
$("#timingBtn").addEventListener("click", calOpen);
$("#calPad").addEventListener("pointerdown", (e) => { e.preventDefault(); calTap(e.timeStamp || performance.now()); });
$("#calDone").addEventListener("click", calClose);
$("#calReset").addEventListener("click", () => { calStop(); jOff = OFF_DEFAULT; LS.set("ryde:rhythm:offset", ""); $("#calCount").textContent = "Start"; calNote(); });

// ---------------------------------------------------------------- QC hooks
window.__game = {
  state() {
    const s = { phase, autoplay: bot, latencyMs: Math.round(latency() * 1000), offsetMs: Math.round(jOff * 1000), seed };
    if (!G) return s;
    const judged = G.cards ? G.cards.filter((c) => c.j).length : 0;
    return { ...s, day: G.day, bpm: G.spec?.bpm, colour: G.spec?.colour, score: G.score, combo: G.combo, bestCombo: G.bestCombo, mult: G.mult,
      meter: +G.meter.toFixed(3), cleared: G.cleared, counts: { ...G.counts }, cards: G.cards?.length || 0, judged, next: G.next,
      clock: G.chart ? dayClock(heardAt(performance.now())) : null, weekday: G.chart?.weekday, coach: !!G.coach, ctx: audio.ctx?.state };
  },
  skipTo(day = 1) { startRun(Math.max(1, day | 0)); return this.state(); },
  autoplay(on = true) { bot = !!on; return bot; },
  setLatency(ms = 0) { jOff = clamp(ms / 1000, -OFF_MAX, OFF_MAX); saveOffset(); return Math.round(jOff * 1000); },
  setSeed(n) { seed = n | 0; return seed; },
  setMeter(v) { if (G) G.meter = clamp(+v, 0, 1); },
  coach(on = true) { coachOverride = !!on; return coachOverride; },
  chart() { return G?.cards?.map((c) => ({ i: c.i, step: c.step, time: c.time, lane: c.lane, text: c.text, slow: c.slow, j: c.j, deltaMs: c.j ? Math.round(c.delta * 1000) : null })) || []; },
  timing() { return G ? { startTime: G.startTime, stepDur: G.stepDur, latency: latency(), log: G.log.slice(), stepTimes: { ...G.stepTimes } } : null; },
  clock() { const p = performance.now(); return { ctxTime: audio.ctx?.currentTime, heard: heardAt(p), latency: latency(), perf: p, clockOff }; },
  pressAt(lane, perfMs) { press(lane, perfMs); return G?.log[G.log.length - 1] || null; },
  layout() { return { ...L, W, H, DPR }; },
  end() { endNow(); },
};

// ---------------------------------------------------------------- boot
window.addEventListener("resize", layout);
window.addEventListener("orientationchange", () => setTimeout(layout, 120));
if (window.visualViewport) window.visualViewport.addEventListener("resize", layout);
layout();
board.load();
loadFont().then(() => { makeSprites(); });
requestAnimationFrame(frame);

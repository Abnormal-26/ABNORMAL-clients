/**
 * Run Club: simulation core. Pure and deterministic (seeded RNG, fixed 120 Hz tick), no DOM, no drawing.
 * The game, the autopilot (window.__game.autopilot) and the fairness test all run on this exact code,
 * so "the bot can clear every pattern" means a player can too.
 *
 * Units: 20 world units = 1 metre. x = distance along the run, y = height above street level (up is +).
 * Obstacle patterns are authored in SECONDS of travel and converted with the speed at generation time,
 * so spacing stays fair as the run speeds up.
 */
export const U = 20;
export const TICK = 1 / 120;
export const V0 = 210, VMAX = 320;            // units per second (10.5 → 16 m/s)
/**
 * Jump feel. Anything released within TAP s (a natural finger tap is 60–120 ms) is the same safe hop, high enough
 * for cones, puddles and bins. Holding past TAP keeps lift on until HOLD_MAX: about twice as high, for the tall stuff.
 * Releasing after TAP cuts the rise, so height follows the hold.
 */
export const P = { G: 2400, G_HOLD: 850, JUMP_V: 860, TAP: 0.13, HOLD_MAX: 0.32, CUT: 0.5, COYOTE: 0.08, BUFFER: 0.1, DJUMP_V: 720, MAXFALL: -1100 };
/** Hero hitbox: ±HW wide (the legs, not the full bottle: forgiving), HH tall from the feet. FOOT = half-width of the feet for standing. */
export const HERO = { HW: 9, HH: 84, FOOT: 9 };
/** Speed ramps to VMAX by ~1.3 km, then keeps creeping (+2 m/s per km, up to +3.5 m/s) while the patterns get harder. */
export const speedAt = (m) => V0 + (VMAX - V0) * (1 - Math.exp(-Math.max(0, m) / 700)) + Math.min(70, Math.max(0, m - 1300) * 0.04);

export function mulberry32(a) {
  return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/* ── A run is a day: dawn → morning city → midday park → dusk → night streets → next dawn (loops every 1.2 km) ── */
export const DAY_LEN = 1200;
export const DAY = [
  { id: "dawn", name: "Dawn", at: 0, shot: "energy" },
  { id: "morning", name: "Morning city", at: 100, shot: "focus" },
  { id: "midday", name: "Midday park", at: 350, shot: "exercise" },
  { id: "dusk", name: "Dusk", at: 600, shot: "relax" },
  { id: "night", name: "Night streets", at: 800, shot: "sleep" },
  { id: "dawn", name: "Next dawn", at: 1100, shot: "energy" },
];
/** Which part of the day a distance falls in; f = blend (0..1) into the next part over the last 50 m. */
export function dayAt(m) {
  const mm = ((m % DAY_LEN) + DAY_LEN) % DAY_LEN;
  let i = DAY.length - 1; while (DAY[i].at > mm) i--;
  const end = i + 1 < DAY.length ? DAY[i + 1].at : DAY_LEN;
  const f = Math.max(0, Math.min(1, (mm - (end - 50)) / 50));
  return { i, id: DAY[i].id, name: DAY[i].name, next: DAY[(i + 1) % DAY.length].id, f, mm };
}

/* ── Obstacles: the everyday hassles. w/h are the drawn size; hitboxes are ~80% (see obBox). ── */
export const OB = {
  cone:    { w: 24, h: 32 },
  bin:     { w: 34, h: 52 },
  aframe:  { w: 96, h: 70 },
  paper:   { w: 42, h: 90 },
  puddle:  { w: 80, h: 6 },
  scooter: { w: 56, h: 54, move: 0.38 },   // rolls toward you at 38% of run speed
  pigeon:  { w: 30, h: 20, fly: 50, move: 0.26 },
  banner:  { w: 120, h: 42, hang: 178 },   // bottom edge 178 up: a tap-hop passes under it, only a full hold hits it
};
/** Current x of an item (movers travel at vx from x0 at time t0). */
export const ix = (it, t) => it.x0 + (it.vx ? it.vx * (t - it.t0) : 0);
export function pigeonY(it, t) { return it.base + OB.pigeon.fly + Math.sin(t * 5 + it.var * 6) * 4; }
/** Hitbox [x0, x1, y0, y1] for a solid obstacle. */
export function obBox(it, t) {
  const x = ix(it, t);
  if (it.type === "banner") return [x + it.w * 0.04, x + it.w * 0.96, it.base + OB.banner.hang + 4, it.base + OB.banner.hang + it.h];
  if (it.type === "pigeon") { const y = pigeonY(it, t); return [x + 5, x + it.w - 5, y + 3, y + it.h - 3]; }
  const f = HB[it.type] || HB.tall;
  return [x + it.w * f[0], x + it.w * (1 - f[0]), it.base, it.base + it.h * f[1]];
}
/** Hitbox forgiveness per hazard: [side inset, height factor]. Low hazards are generous so a tap is a safe move. */
export const HB = { cone: [0.16, 0.78], bin: [0.14, 0.8], scooter: [0.12, 0.82], tall: [0.1, 0.85], puddle: [0.22] };

/* ── Terrain: sorted list of solid segments {x0, x1, h, kind}. No segment = a gap between rooftops. ── */
export function surfaceAt(W, a, b) {
  let s = null;
  for (const g of W.ground) { if (g.x0 >= b) break; if (g.x1 > a && (s === null || g.h > s)) s = g.h; }
  return s;
}
/** Replace [a,b] with a segment of height h (or a gap when h is null). */
export function carve(W, a, b, h, kind = "roof") {
  const out = [];
  for (const g of W.ground) {
    if (g.x1 <= a || g.x0 >= b) { out.push(g); continue; }
    if (g.x0 < a) out.push({ ...g, x1: a });
    if (g.x1 > b) out.push({ ...g, x0: b });
  }
  if (h != null) out.push({ x0: a, x1: b, h, kind });
  out.sort((p, q) => p.x0 - q.x0);
  W.ground = out;
}
function addGround(W, a, b, kind = "street") {
  const last = W.ground[W.ground.length - 1];
  if (last && last.h === 0 && last.kind === kind && Math.abs(last.x1 - a) < 0.01) last.x1 = b;
  else W.ground.push({ x0: a, x1: b, h: 0, kind });
}

/* ── Hero physics ── */
export function newHero(x) { return { x, t: 0, y: 0, vy: 0, v: speedAt(x / U), onGround: true, jumping: false, ja: 0, cut: false, coy: 0, buf: 0, aj: 0, fresh: false, ev: 0 }; }
export const cloneHero = (S) => ({ ...S });
function doJump(S, v) { S.vy = v; S.onGround = false; S.jumping = true; S.ja = 0; S.cut = false; S.coy = 0; S.buf = 0; }

/**
 * Advance the hero one tick. down = any finger/key held; pressed = a new press since the last tick.
 * mods: { speedMul, dj (double jump), jet (jetpack), ceil (jetpack ceiling) }.
 * Sets S.ev bits (1 jump, 2 double jump, 4 land, 8 walked off an edge) and returns a hit or null.
 */
export function physStep(W, S, dt, down, pressed, mods = {}) {
  S.ev = 0;
  // a speed boost (mods.until = when it runs out) only ends on the ground, so a jump is never cut short mid-air
  if (mods.until != null && !S.boostOff && S.t >= mods.until && S.onGround) S.boostOff = true;
  const v = speedAt(S.x / U) * (S.boostOff ? 1 : mods.speedMul || 1);
  S.v = v; S.x += v * dt; S.t += dt;
  const surf = surfaceAt(W, S.x - HERO.FOOT, S.x + HERO.FOOT);
  if (mods.jet) return jetStep(W, S, dt, down, surf, mods);
  if (pressed) { S.buf = P.BUFFER; S.fresh = true; }
  if (S.buf > 0) {
    if (S.onGround || S.coy > 0) { doJump(S, P.JUMP_V); S.ev |= 1; }
    else if (S.fresh && mods.dj && S.aj < 1) { doJump(S, P.DJUMP_V); S.aj = 1; S.ev |= 2; }
  }
  S.fresh = false; S.buf -= dt;
  if (S.onGround) {
    if (surf === null || surf < S.y - 0.5) { S.onGround = false; S.coy = P.COYOTE; S.vy = 0; S.jumping = false; S.ja = 0; S.ev |= 8; }
    else S.y = surf;
  }
  if (!S.onGround) {
    S.ja += dt; S.coy -= dt;
    let g = P.G;
    if (S.jumping && S.vy > 0 && !S.cut && S.ja > P.TAP) {
      if (!down) { S.vy *= P.CUT; S.cut = true; }
      else if (S.ja < P.HOLD_MAX) g = P.G_HOLD;
      else S.cut = true;
    }
    S.vy = Math.max(P.MAXFALL, S.vy - g * dt);
    const py = S.y; S.y += S.vy * dt;
    if (S.vy <= 0 && surf !== null && S.y <= surf && py >= surf - 18) { S.y = surf; S.vy = 0; S.onGround = true; S.jumping = false; S.aj = 0; S.ev |= 4; }
  }
  return collide(W, S);
}

/** Jetpack: hold to rise, release to sink. Gaps act as a floor at street level; step-ups lift you. */
function jetStep(W, S, dt, down, surf, mods) {
  S.vy = down ? Math.min(380, S.vy + 2600 * dt) : Math.max(-340, S.vy - 1500 * dt);
  S.y += S.vy * dt;
  let floor = Math.max(surf ?? 0, 0);
  for (const g of W.ground) { if (g.x0 > S.x + HERO.HW) break; if (g.x1 > S.x - HERO.HW && g.h > floor) floor = g.h; }
  const was = S.onGround;
  if (S.y <= floor) { S.y = floor; S.vy = Math.max(0, S.vy); S.onGround = true; if (!was) S.ev |= 4; } else S.onGround = false;
  const ceil = mods.ceil ?? 230; if (S.y > ceil) { S.y = ceil; S.vy = Math.min(0, S.vy); }
  S.jumping = false; S.aj = 0; S.coy = 0; S.buf = 0; S.fresh = false;
  return collide(W, S);
}

export function collide(W, S) {
  if (S.y < -70) return { kind: "gap" };
  const fx = S.x + HERO.HW, bx = S.x - HERO.HW + 4;
  for (const g of W.ground) { if (g.x0 > fx) break; if (g.x1 > bx && g.h > S.y + 12) return { kind: "wall", seg: g }; }
  const x0 = S.x - HERO.HW, x1 = S.x + HERO.HW, y0 = S.y + 3, y1 = S.y + HERO.HH;
  for (const it of W.items) {
    if (it.k !== "ob" || it.gone) continue;
    const x = ix(it, S.t); if (x > x1 + 4 || x + it.w < x0 - 4) continue;
    if (it.type === "puddle") { if (S.onGround && S.y <= it.base + 1 && x1 > x + it.w * HB.puddle[0] && x0 < x + it.w * (1 - HB.puddle[0])) return { kind: "ob", it }; continue; }
    const b = obBox(it, S.t);
    if (x1 > b[0] && x0 < b[1] && y1 > b[2] && y0 < b[3]) return { kind: "ob", it };
  }
  return null;
}

/* ── Reference jump curves (flat ground) for dot arcs and the FOCUS "ideal jump point" hints ── */
const FLAT = { ground: [{ x0: -1e9, x1: 1e9, h: 0 }], items: [] };
function curve(hold) {
  const S = newHero(0); const ys = []; let k = 0, apex = 0, top = 0;
  physStep(FLAT, S, TICK, true, true);
  do { ys.push(S.y); if (S.y > top) { top = S.y; apex = k * TICK; } k++; physStep(FLAT, S, TICK, k * TICK < hold, false); } while (!S.onGround && k < 400);
  return { ys, air: k * TICK, apex, top, y: (t) => ys[Math.max(0, Math.min(ys.length - 1, Math.round(t / TICK)))] || 0 };
}
export const CURVES = { tap: curve(0), mid: curve(0.16), full: curve(0.4) };
// banners hang just above the top of a slow tap (a press of up to 180 ms) + the hero's head: tap under it, never hold
CURVES.press180 = curve(0.18);
OB.banner.hang = Math.ceil(CURVES.press180.top + HERO.HH + 2);

/* ── Pattern library ("chunks"). Times are seconds of travel from the chunk start; ob() places an obstacle's left edge. ── */
const C = (id, min, wt, len, build, extra = {}) => ({ id, min, wt, len, build, ...extra });
export const CHUNKS = [
  // the first ~25 s: tap-only hazards (cones, puddles, bins)
  C("cone", 0, 3, 0.9, (c) => c.arcOver(c.ob("cone", 0.35)), { fade: 700 }),
  C("puddle", 0, 2, 1.0, (c) => c.arcOver(c.ob("puddle", 0.3, { dur: 0.22 })), { fade: 700 }),
  C("bin", 90, 3, 0.95, (c) => c.arcOver(c.ob("bin", 0.35)), { fade: 1100 }),
  C("dots", 0, 1.2, 0.8, (c) => c.line(0.05, 0.7, 46), { fade: 600 }),
  C("cone-cone", 60, 2, 1.8, (c) => { c.arcOver(c.ob("cone", 0.3)); c.arcOver(c.ob("cone", 1.45)); }, { fade: 1500 }),
  C("cones2", 120, 2, 1.05, (c) => { const a = c.ob("cone", 0.35), b = c.ob("cone", 0.35, { dx: 20 }); c.group([a, b]); c.arcOver(a); }, { fade: 1500 }),
  C("puddle-wide", 180, 1.5, 1.1, (c) => c.arcOver(c.ob("puddle", 0.3, { dur: 0.27 })), { fade: 1500 }),
  C("bin-cone", 200, 2, 1.85, (c) => { c.arcOver(c.ob("bin", 0.3)); c.arcOver(c.ob("cone", 1.45)); }, { fade: 1700 }),
  // tall stuff: hold to go higher (the first one comes with a HOLD pill)
  C("aframe", 280, 2.5, 1.05, (c) => c.arcOver(c.ob("aframe", 0.35)), { fade: 1700 }),
  C("paper", 300, 2.5, 1.05, (c) => c.arcOver(c.ob("paper", 0.35)), { fade: 1700 }),
  C("banner", 330, 2, 1.0, (c) => { c.ob("banner", 0.2, { dur: 0.6 }); c.line(0.24, 0.52, 40); }, { fade: 1700 }),
  C("pigeon", 360, 2, 1.1, (c) => c.arcOver(c.ob("pigeon", 0.55)), { fade: 1700 }),
  // rush hour
  C("scooter", 400, 2.5, 1.25, (c) => c.ob("scooter", 0.65)),
  C("gap", 430, 2.5, 1.25, (c) => { c.gap(0.3, 0.58); c.arcOver(c.hintGap(0.3, 0.58)); }, { roof: true }),
  C("plat", 480, 2, 2.0, (c) => { c.plat(0.35, 1.4, 56); c.hintWall(0.35); c.arcOver(c.ob("cone", 1.05)); }, { roof: true }),
  C("banner-bin", 520, 2, 1.45, (c) => { c.ob("banner", 0.15, { dur: 0.5 }); c.line(0.2, 0.4, 40); c.arcOver(c.ob("bin", 1.05)); }),
  C("aframe2", 560, 1.6, 1.85, (c) => { c.arcOver(c.ob("aframe", 0.3)); c.arcOver(c.ob("aframe", 1.4)); }),
  C("puddle-cone", 600, 1.6, 1.8, (c) => { c.arcOver(c.ob("puddle", 0.3, { dur: 0.22 })); c.arcOver(c.ob("cone", 1.4)); }),
  // night shift
  C("roofs", 750, 2, 2.5, (c) => { c.gap(0.3, 0.55); c.arcOver(c.hintGap(0.3, 0.55)); c.plat(1.35, 0.95, 56); c.hintWall(1.35); }, { roof: true }),
  C("cone-scooter", 800, 1.8, 1.8, (c) => { c.arcOver(c.ob("cone", 0.3)); c.ob("scooter", 1.4); }),
  C("bin-pigeon", 850, 1.8, 1.9, (c) => { c.arcOver(c.ob("bin", 0.3)); c.ob("pigeon", 1.4); }),
  C("paper-banner", 900, 1.6, 2.0, (c) => { c.arcOver(c.ob("paper", 0.3)); c.ob("banner", 1.2, { dur: 0.5 }); c.line(1.25, 0.4, 40); }),
  C("triple", 950, 1.6, 2.15, (c) => { c.ob("cone", 0.3); c.ob("bin", 1.0); c.ob("cone", 1.7); }),
  C("gap2", 1000, 1.6, 2.15, (c) => { c.gap(0.3, 0.55); c.hintGap(0.3, 0.55); c.gap(1.4, 0.55); c.arcOver(c.hintGap(1.4, 0.55)); }, { roof: true }),
  C("paper-gap", 1100, 1.4, 2.1, (c) => { c.arcOver(c.ob("paper", 0.3)); c.gap(1.3, 0.55); c.hintGap(1.3, 0.55); }, { roof: true }),
  C("scooter2", 1150, 1.4, 2.2, (c) => { c.ob("scooter", 0.65); c.ob("scooter", 1.65); }),
  // past 1.3 km: speed has capped, so the challenge comes from combinations
  C("gap-bin", 1300, 2, 2.0, (c) => { c.gap(0.3, 0.55); c.hintGap(0.3, 0.55); c.arcOver(c.ob("bin", 1.45)); }, { roof: true }),
  C("banner-scooter", 1350, 2, 1.9, (c) => { c.ob("banner", 0.15, { dur: 0.5 }); c.ob("scooter", 1.35); }),
  C("cone-pigeon", 1400, 2, 1.85, (c) => { c.arcOver(c.ob("cone", 0.3)); c.ob("pigeon", 1.25); }),
  C("banner-gap", 1500, 2, 1.9, (c) => { c.ob("banner", 0.15, { dur: 0.45 }); c.gap(1.0, 0.55); c.hintGap(1.0, 0.55); }, { roof: true }),
  C("quad", 1600, 2, 2.9, (c) => { c.ob("cone", 0.3); c.ob("bin", 0.95); c.ob("aframe", 1.7); c.ob("cone", 2.55); }),
  C("gap-paper-gap", 1800, 2, 3.0, (c) => { c.gap(0.3, 0.55); c.hintGap(0.3, 0.55); c.ob("paper", 1.45); c.gap(2.35, 0.55); c.hintGap(2.35, 0.55); }, { roof: true }),
  C("scooter3", 2000, 2, 2.9, (c) => { c.ob("scooter", 0.65); c.ob("scooter", 1.5); c.ob("scooter", 2.35); }),
  C("pigeon-paper", 2200, 2, 2.05, (c) => { c.ob("pigeon", 0.5); c.ob("paper", 1.45); }),
];
/** Breather between patterns; tightens with distance. */
export const breather = (m) => Math.max(0.18, 0.85 - m / 2600);

const FLIGHT = C("flight", 0, 0, 1.0, (c, R) => {
  const t = ["cone", "bin", "paper", "aframe"][Math.floor(R() * 4)]; c.ob(t, 0.45);
  for (let i = 0; i < 6; i++) c.dot(c.at(0.1 + i * 0.14), 150 + Math.sin(i * 0.9 + R() * 2) * 40);
});
const RUNWAY = C("runway", 0, 0, 1.3, (c) => c.line(0.25, 0.9, 46));
const POWER = C("power", 0, 0, 1.1, (c) => { c.line(0.05, 0.3, 46); c.power(0.5); });

/**
 * A fresh world. opts.noPowers disables power-ups (used by the fairness test).
 * The first 1.3 s are an empty runway so the first obstacle arrives ~2 s in.
 */
export function createWorld(seed, startM = 0, opts = {}) {
  const x = startM * U;
  const W = { seed, rand: mulberry32((seed >>> 0) || 1), items: [], ground: [{ x0: x - 900, x1: x + 280, h: 0, kind: "street" }],
    genX: x + 280, chunkStarts: [], last: "", uid: 0, dotC: 0, noPowers: !!opts.noPowers, flightTo: 0, landPending: false,
    nextPowM: startM < 60 ? 110 : startM + 60 + mulberry32(seed + 7)() * 60, lastPow: "", sleepSpawned: false, signNext: (Math.floor(startM / 250) + 1) * 250, log: [] };
  return W;
}

function pickChunk(W, m) {
  const pool = CHUNKS.filter((c) => m >= c.min && c.id !== W.last);
  // new patterns fade in over 300 m; the easy ones fade out; past 1.3 km the newest patterns are favoured
  const wts = pool.map((c) => c.wt * Math.min(1, 0.5 + (m - c.min) / 300) * (c.fade && m > c.fade ? 0.35 : 1) * (m > 1300 && c.min >= 1000 ? 2.2 : 1));
  let r = W.rand() * wts.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) { r -= wts[i]; if (r <= 0) return pool[i]; }
  return pool[pool.length - 1];
}

function pickPower(W, m) {
  const night = dayAt(m).id === "night" && dayAt(m).mm < 1040;
  if (night && !W.sleepSpawned && W.lastPow !== "sleep") return "sleep";
  // a shuffled bag: you meet all four daytime moments before any repeats
  if (!W.bag || !W.bag.length) { W.bag = ["energy", "focus", "exercise", "relax"]; for (let i = 3; i > 0; i--) { const j = Math.floor(W.rand() * (i + 1)); [W.bag[i], W.bag[j]] = [W.bag[j], W.bag[i]]; } }
  if (W.bag[0] === W.lastPow) W.bag.push(W.bag.shift());   // never the same one twice in a row
  return W.bag.shift();
}

/** Keep generating patterns until the world reaches untilX. ctl: { powerActive } from the game. */
export function generate(W, S, untilX, ctl = {}) {
  while (W.genX < untilX) {
    const m0 = W.genX / U, v0 = speedAt(m0);
    addGround(W, W.genX, W.genX + breather(m0) * v0);
    W.genX += breather(m0) * v0;
    const x0 = W.genX, m = x0 / U, v = speedAt(m);
    let ch;
    if (W.flightTo > x0) ch = FLIGHT;
    else if (W.landPending) { ch = RUNWAY; W.landPending = false; }
    else if (!W.noPowers && m >= W.nextPowM && !ctl.powerActive) ch = POWER;
    else ch = pickChunk(W, m);
    W.chunkStarts.push(x0);
    addGround(W, x0, x0 + ch.len * v, ch.roof ? "roof" : "street");
    const c = chunkCtx(W, S, x0, v);
    ch.build(c, W.rand, m);
    if (ch.roof) addGround(W, x0 + ch.len * v, x0 + ch.len * v + 0.12 * v, "roof");   // roofs run on a moment past the pattern
    W.genX = Math.max(W.genX, x0 + ch.len * v + (ch.roof ? 0.12 * v : 0));
    W.last = ch.id; W.log.push(ch.id); if (W.log.length > 60) W.log.shift();
  }
  while (W.signNext * U < W.genX) { W.items.push({ k: "sign", x0: W.signNext * U, m: W.signNext, id: ++W.uid }); W.signNext += 250; }
}

function chunkCtx(W, S, x0, v) {
  const at = (t) => x0 + t * v;
  const c = {
    v, x0, at,
    gap(t, dur) { carve(W, at(t), at(t + dur), null); },
    plat(t, dur, h) { carve(W, at(t), at(t + dur), h, "roof"); },
    dotAbs(x, y) { W.items.push({ k: "dot", x0: x, y, c: W.dotC++ % 5, id: ++W.uid }); },
    dot(x, y) { c.dotAbs(x, (surfaceAt(W, x - 1, x + 1) ?? 0) + y); },
    line(t, dur, y) { const n = Math.max(2, Math.round((dur * v) / 26) + 1); for (let i = 0; i < n; i++) c.dot(at(t) + (i * dur * v) / (n - 1), y); },
    ob(type, t, o = {}) {
      const d = OB[type];
      const w = o.dur ? Math.max(type === "banner" ? 160 : 0, Math.round(o.dur * v)) : d.w;   // banners wide enough for big lettering
      const x = at(t) + (o.dx || 0);
      const it = { k: "ob", type, x0: x, vx: 0, t0: 0, w, h: d.h, base: surfaceAt(W, x, x + w) ?? 0, var: W.rand(), id: ++W.uid };
      if (d.move) {   // movers: arrive at x when the hero does (approximately), so the pattern reads the same at any speed
        const tm = S.t + (x - S.x) / v; it.t0 = tm; it.vx = -d.move * v;
      }
      it.hint = hintFor(it, v);
      if (!W.taughtHold && (type === "aframe" || type === "paper" || type === "pigeon")) { W.taughtHold = true; it.teach = "HOLD ↑"; }
      if (!W.taughtLow && type === "banner") { W.taughtLow = true; it.teach = "STAY LOW"; }
      W.items.push(it); return it;
    },
    /** Several obstacles cleared with one jump: one HOLD hint for the lot. */
    group(list) { const a = list[0], b = list[list.length - 1]; const cx = (a.x0 + b.x0 + b.w) / 2; a.hint = { x: cx - 0.26 * v, kind: "TAP" }; for (const o of list.slice(1)) o.hint = null; },
    hintGap(t, dur) { const cx = at(t + dur / 2); const h = { x: cx - (CURVES.full.air / 2 - 0.07) * v, kind: "HOLD", base: 0 }; W.items.push({ k: "hint", x0: h.x, hint: h, id: ++W.uid }); return { hint: h, base: 0 }; },
    hintWall(t) { const h = { x: at(t) - 0.45 * v, kind: "HOLD", base: 0 }; W.items.push({ k: "hint", x0: h.x, hint: h, id: ++W.uid }); },
    /** A dot arc along the hinted jump: collect them by jumping the way the hint suggests. */
    arcOver(it) {
      const h = it && it.hint; if (!h || h.x == null) return it;
      const cv = h.kind === "HOLD" ? CURVES.full : CURVES.tap;
      const base = surfaceAt(W, h.x - 1, h.x + 1) ?? 0, n = 5;
      for (let i = 0; i < n; i++) { const tt = (cv.air * (i + 1)) / (n + 1); c.dotAbs(h.x + tt * v, base + cv.y(tt) + 44); }
      return it;
    },
    power(t) {
      const m = at(t) / U, id = pickPower(W, m);
      W.items.push({ k: "pow", id, x0: at(t), base: surfaceAt(W, at(t), at(t) + 1) ?? 0, y: 30, w: 26, h: 46, uid: ++W.uid });
      W.lastPow = id; if (id === "sleep") W.sleepSpawned = true; (W.powLog || (W.powLog = [])).push({ id, m: Math.round(m) });
      W.nextPowM = m + 450 + W.rand() * 120;   // moments, not candy
    },
  };
  return c;
}

/** The FOCUS power-up's "ideal jump point": where to take off, and whether to tap or hold. */
function hintFor(it, v) {
  // Offsets measured with the planner (win2.mjs): each hint sits in the middle of its take-off window.
  const cx = it.x0 + it.w / 2;
  switch (it.type) {
    case "cone": case "bin": return { x: cx - 0.26 * v, kind: "TAP" };
    case "puddle": return { x: cx - 0.237 * v, kind: "TAP" };
    case "aframe": case "paper": return { x: cx - 0.457 * v, kind: "HOLD" };
    // movers: the hero's centre meets theirs w/2 ÷ (relative speed) after reaching the left edge
    case "pigeon": case "scooter": return { x: it.x0 + it.w / (2 * (1 + OB[it.type].move)) - 0.456 * v, kind: "HOLD" };
    case "banner": return { x: it.x0 - 0.12 * v, kind: "LOW" };   // marks where to stay low (no jump needed)
  }
  return null;
}

/** Cut the not-yet-seen future (from the first pattern boundary at or after fromX) so it can be regenerated. */
export function reflow(W, fromX) {
  const cut = W.chunkStarts.find((x) => x >= fromX);
  if (cut == null) return W.genX;
  W.items = W.items.filter((it) => it.k === "sign" || it.x0 < cut);
  W.ground = W.ground.filter((g) => g.x0 < cut).map((g) => (g.x1 > cut ? { ...g, x1: cut } : g));
  W.chunkStarts = W.chunkStarts.filter((x) => x < cut);
  W.signNext = Math.min(W.signNext, Math.ceil(cut / U / 250) * 250);
  W.items = W.items.filter((it) => !(it.k === "sign" && it.x0 >= cut));
  W.genX = cut; W.last = "";
  return cut;
}

/** Power nap: clear obstacles and fill gaps in [a, b]. Returns the obstacles removed (for the poof). */
export function clearRange(W, a, b) {
  const gone = [];
  for (const it of W.items) if ((it.k === "ob" || it.k === "hint") && !it.gone && it.x0 + (it.w || 0) > a && it.x0 < b) { it.gone = true; gone.push(it); }
  carve(W, a, b, 0, "street");
  return gone;
}

/** Drop what's behind the camera. */
export function prune(W, x, t) {
  if (W.items.length > 40) W.items = W.items.filter((it) => ix(it, t) + (it.w || 30) > x - 260);
  while (W.ground.length > 2 && W.ground[0].x1 < x - 600) W.ground.shift();
  while (W.chunkStarts.length && W.chunkStarts[0] < x - 1000) W.chunkStarts.shift();
}

/* ── Autopilot / fairness planner ──────────────────────────────────────────────────────────────────
 * Depth-first search over "keep running" vs "jump now, holding for 0 / 0.16 / 0.4 s". On the ground the
 * state at a given tick is fully determined (x depends only on time), so failed ground ticks are memoised,
 * which keeps the search cheap. Returns a list of { t, hold } jump commands (sim times) or null if no plan
 * survives the horizon (= an unfair pattern, or you're already doomed).
 */
const HOLDS = [0, 0.16, 0.4];
export function plan(W, S0, mods = {}, horizon = 2.4) {
  const tEnd = S0.t + horizon; const fail = new Set(); let budget = 60000;
  const key = (S) => Math.round(S.t / TICK);
  function air(S, hold, t0) {   // simulate a jump already in flight until landing; null on death
    while (!S.onGround) {
      if (--budget < 0) return null;
      const hit = physStep(W, S, TICK, S.t - t0 < hold, false, mods);
      if (hit) return null;
      if (S.t >= tEnd) return S;
    }
    return S;
  }
  function ground(S) {
    if (S.t >= tEnd) return [];
    const k = key(S); if (fail.has(k)) return null;
    // 1) keep running one tick
    const R = cloneHero(S); const hit = physStep(W, R, TICK, false, false, mods);
    if (!hit) {
      if (R.onGround) { const r = ground(R); if (r) return r; }
      else { const L = air(R, 0, R.t); if (L) { const r = L.t >= tEnd ? [] : ground(L); if (r) return r; } }
    }
    // 2) jump now
    for (const hold of HOLDS) {
      if (--budget < 0) break;
      const J = cloneHero(S); const t0 = J.t;
      if (physStep(W, J, TICK, true, true, mods)) continue;
      const L = air(J, hold, t0); if (!L) continue;
      const r = L.t >= tEnd ? [] : ground(L); if (r) return [{ t: t0, hold }, ...r];
    }
    fail.add(k); return null;
  }
  if (!S0.onGround) { const L = air(cloneHero(S0), 0, S0.t - S0.ja); if (!L) return null; return L.t >= tEnd ? [] : ground(L); }
  return ground(cloneHero(S0));
}

/** Test helper: lay one named pattern at the generator cursor (after a flat run-up). */
export function forceChunk(W, S, id) {
  const ch = CHUNKS.find((c) => c.id === id); const x0 = W.genX, v = speedAt(x0 / U);
  W.chunkStarts.push(x0); addGround(W, x0, x0 + ch.len * v, ch.roof ? "roof" : "street");
  ch.build(chunkCtx(W, S, x0, v), W.rand, x0 / U);
  addGround(W, x0 + ch.len * v, x0 + ch.len * v + 6 * v, "street"); W.genX = x0 + (ch.len + 6) * v;
  return x0;
}

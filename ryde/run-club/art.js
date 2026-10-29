/**
 * Run Club art: the hero, the everyday hassles, the city through a day. All flat vector, drawn in world
 * units (y up is negative on the canvas; callers pass the screen-space baseline). Ryde palette only:
 * stone, white, ink + one shot colour per time of day.
 *
 * drawBottleBody / drawCap are copies of shared drawBottle split in two (so the cap can pop off in a crash);
 * everything else uses the shared kit as-is.
 */
import { drawBottle, drawWordmark, SHOT, SHOTS, INK, FONT, roundRect as rr, fitFont } from "../shared/brand.js";
import { OB, pigeonY, dayAt } from "./sim.js";

/* ── colour ─────────────────────────────────────────────────────────────────── */
const cache = new Map();
export function rgbOf(hex) {
  let v = cache.get(hex); if (v) return v;
  const h = hex.replace("#", ""); v = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; cache.set(hex, v); return v;
}
export function mix(a, b, f) {
  if (f <= 0) return a; if (f >= 1) return b;
  const A = rgbOf(a), B = rgbOf(b);
  const c = (i) => Math.round(A[i] + (B[i] - A[i]) * f).toString(16).padStart(2, "0");
  return `#${c(0)}${c(1)}${c(2)}`;
}
/** Smallest in-world lettering, in world units; the game sets it every frame so text never drops below ~12.5 px. */
let TXT = 12; export function setTextFloor(u) { TXT = u; }
export const rgba = (hex, a) => { const c = rgbOf(hex); return `rgba(${c[0]},${c[1]},${c[2]},${a})`; };

/* ── the day's palettes (one shot accent per moment) ───────────────────────── */
export const PAL = {
  dawn: { sky: "#FBE1D2", sun: "#EE3831", sunR: 96, sunY: 0.74, far: "#F3C6B3", mid0: "#D4D0CA", mid1: "#FFFFFF", mid2: "#EE3831", win0: "#EAE5DF", win1: "#F7D6C9", win2: "#F59A8D", near: "#E9C7B8", pave: "#E9E2DA", joint: "#DDD4CA", kerb: "#FFFFFF", road: "#2C2626", lane: "#E9E2DA", alley: "#1E1919", roof: "#C9C2BA", roofTop: "#E9E2DA", roofWin: "#A9A29B", hud: "#131313", dark: 0, stars: 0, lawn: 0, accent: "#EE3831", tree: "#EE3831", tree2: "#B8241F" },
  morning: { sky: "#F4F2EF", sun: "#FFC845", sunR: 74, sunY: 0.2, far: "#E3DFD9", mid0: "#D4D0CA", mid1: "#FFFFFF", mid2: "#131313", win0: "#F4F2EF", win1: "#DAD6D0", win2: "#FFC845", near: "#D2CDC6", pave: "#E6E2DC", joint: "#D8D3CC", kerb: "#FFFFFF", road: "#262626", lane: "#FFC845", alley: "#171717", roof: "#D4D0CA", roofTop: "#F4F2EF", roofWin: "#B9B4AD", hud: "#131313", dark: 0, stars: 0, lawn: 0, accent: "#FFC845", tree: "#06AF9A", tree2: "#047E6F" },
  midday: { sky: "#E1F3EF", sun: "#FFC845", sunR: 66, sunY: 0.11, far: "#C9E7E0", mid0: "#FFFFFF", mid1: "#D4D0CA", mid2: "#06AF9A", win0: "#C9E7E0", win1: "#F4F2EF", win2: "#5FD8C6", near: "#A6D9CE", pave: "#EEEAE4", joint: "#E0DBD4", kerb: "#FFFFFF", road: "#06AF9A", lane: "#5FD8C6", alley: "#0F332E", roof: "#D4D0CA", roofTop: "#FFFFFF", roofWin: "#B9B4AD", hud: "#131313", dark: 0, stars: 0, lawn: 1, accent: "#06AF9A", tree: "#06AF9A", tree2: "#047E6F" },
  dusk: { sky: "#A9C8F7", sun: "#FFC845", sunR: 88, sunY: 0.8, far: "#8AB2F0", mid0: "#3E6FC4", mid1: "#131313", mid2: "#6A9EF0", win0: "#6A9EF0", win1: "#FFC845", win2: "#D9E6FB", near: "#759EE2", pave: "#CBCBD8", joint: "#BDBDCC", kerb: "#FFFFFF", road: "#20232D", lane: "#6A9EF0", alley: "#11141C", roof: "#3E6FC4", roofTop: "#6A9EF0", roofWin: "#A9C8F7", hud: "#131313", dark: 0.15, stars: 0, lawn: 0, accent: "#6A9EF0", tree: "#3E6FC4", tree2: "#131313" },
  night: { sky: "#1C1630", sun: "#F4F1FA", sunR: 52, sunY: 0.15, far: "#292142", mid0: "#3A2F57", mid1: "#2A2240", mid2: "#5C4183", win0: "#FFC845", win1: "#8564AB", win2: "#FFE08F", near: "#3A3152", pave: "#4A425E", joint: "#433B56", kerb: "#8564AB", road: "#141120", lane: "#8564AB", alley: "#0A0811", roof: "#2E2645", roofTop: "#4A425E", roofWin: "#FFC845", hud: "#FFFFFF", dark: 1, stars: 1, lawn: 0, accent: "#8564AB", tree: "#5C4183", tree2: "#3A2F57" },
};
/** Palette for a distance: the current part of the day blended into the next over its last 50 m. */
const PREDAWN = { sky: "#8564AB", sun: "#FF7A6E", sunR: 80, sunY: 0.68, far: "#7353A0", mid0: "#5C4183", mid1: "#4A3570", mid2: "#B79BD6", win0: "#FFC845", win1: "#B79BD6", win2: "#FFE08F", near: "#6E5596", pave: "#9C8FB4", joint: "#8E80A8", kerb: "#FFFFFF", road: "#241C33", lane: "#B79BD6", alley: "#140F1D", roof: "#5C4183", roofTop: "#9C8FB4", roofWin: "#FFC845", hud: "#FFFFFF", dark: 0.6, stars: 0.4, lawn: 0, accent: "#FF7A6E", tree: "#5C4183", tree2: "#3A2F57" };
function blend(A, B, f) { const o = {}; for (const k in A) o[k] = typeof A[k] === "number" ? A[k] + (B[k] - A[k]) * f : mix(A[k], B[k], f); return o; }
export function paletteAt(m) {
  const d = dayAt(m), A = PAL[d.id], B = PAL[d.next];
  if (d.f <= 0) return { ...A, dayId: d.id, dayName: d.name, dayI: d.i };
  if (d.id === "night" && d.next === "dawn") return { ...(d.f < 0.5 ? blend(A, PREDAWN, d.f * 2) : blend(PREDAWN, B, d.f * 2 - 1)), dayId: d.id, dayName: d.name, dayI: d.i };
  const o = { dayId: d.id, dayName: d.name, dayI: d.i };
  for (const k in A) o[k] = typeof A[k] === "number" ? A[k] + (B[k] - A[k]) * d.f : mix(A[k], B[k], d.f);
  return o;
}

/* ── bottle, split so the cap can pop off (copied from shared drawBottle) ─── */
function metal(ctx, x0, x1, stops) { const g = ctx.createLinearGradient(x0, 0, x1, 0); stops.forEach(([t, c]) => g.addColorStop(t, c)); return g; }
export function drawBottleBody(ctx, cx, cy, h, id) {
  const s = SHOT[id], w = h * 0.44, top = -h / 2, bot = h / 2, capW = w * 0.7, capH = h * 0.2, neckY = top + capH, shoulderY = top + h * 0.33, bandY = top + h * 0.43;
  ctx.save(); ctx.translate(cx, cy);
  const body = new Path2D();
  body.moveTo(-capW / 2, neckY); body.bezierCurveTo(-capW / 2, neckY + h * 0.05, -w / 2, shoulderY - h * 0.07, -w / 2, shoulderY);
  body.lineTo(-w / 2, bot - w * 0.12); body.quadraticCurveTo(-w / 2, bot, -w / 2 + w * 0.12, bot); body.lineTo(w / 2 - w * 0.12, bot); body.quadraticCurveTo(w / 2, bot, w / 2, bot - w * 0.12);
  body.lineTo(w / 2, shoulderY); body.bezierCurveTo(w / 2, shoulderY - h * 0.07, capW / 2, neckY + h * 0.05, capW / 2, neckY); body.closePath();
  ctx.fillStyle = metal(ctx, -w / 2, w / 2, [[0, "#8E9095"], [0.18, "#D9DADD"], [0.36, "#F6F6F7"], [0.55, "#E3E4E6"], [0.8, "#B3B5B9"], [1, "#7D7F84"]]); ctx.fill(body);
  ctx.save(); ctx.clip(body); ctx.fillStyle = metal(ctx, -w / 2, w / 2, [[0, s.dark], [0.3, s.light], [0.5, s.color], [0.85, s.dark], [1, s.dark]]); ctx.fillRect(-w, neckY - 1, w * 2, bandY - neckY + 1); ctx.restore();
  // open neck
  ctx.fillStyle = "#5d5f63"; ctx.beginPath(); ctx.ellipse(0, neckY, capW * 0.42, h * 0.018, 0, 0, Math.PI * 2); ctx.fill();
  drawWordmark(ctx, -w * 0.4, bandY + h * 0.24, h * 0.115, INK);
  ctx.restore();
}
export function drawCap(ctx, cx, cy, h, id) {
  const s = SHOT[id], w = h * 0.44, capW = w * 0.7, capH = h * 0.2;
  ctx.save(); ctx.translate(cx, cy);
  ctx.fillStyle = metal(ctx, -capW / 2, capW / 2, [[0, s.dark], [0.25, s.light], [0.45, s.color], [0.8, s.dark], [1, s.dark]]);
  rr(ctx, -capW / 2, -capH / 2, capW, capH, capW * 0.08); ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.18)"; ctx.lineWidth = 0.8;
  for (let i = 1; i < 7; i++) { const x = -capW / 2 + (capW * i) / 7; ctx.beginPath(); ctx.moveTo(x, -capH * 0.38); ctx.lineTo(x, capH * 0.42); ctx.stroke(); }
  ctx.restore();
}

/* ── the hero ───────────────────────────────────────────────────────────────
 * Ryde bottle (shared drawBottle) on noodle legs in chunky sneakers, with a terry headband round the cap.
 * Feet at (0,0). Run cycle: the lower foot always touches the ground, which gives the bob for free.
 */
export const BH = 70; const TH = 14, SH = 13.5, CAPW = BH * 0.44 * 0.7;
function legRun(q) {
  const a1 = 0.82 * Math.sin(q), fwd = Math.cos(q);
  const flex = 0.22 + 1.35 * Math.max(0, fwd) + 0.25 * Math.max(0, -Math.sin(q)) * Math.max(0, -fwd);
  return { a1, a2: a1 - flex, foot: fwd > 0 ? 0.45 * fwd : -0.1 * Math.sin(q) };
}
function legAir(vy, back) {
  const f = Math.max(-1, Math.min(1, vy / 420));   // +1 rising, -1 falling
  const up = back ? { a1: -0.55, a2: -1.75, foot: 0.7 } : { a1: 1.05, a2: -0.55, foot: 0.25 };
  const dn = back ? { a1: -0.2, a2: -0.95, foot: 0.4 } : { a1: 0.55, a2: 0.05, foot: -0.05 };
  const t = (f + 1) / 2; return { a1: dn.a1 + (up.a1 - dn.a1) * t, a2: dn.a2 + (up.a2 - dn.a2) * t, foot: dn.foot + (up.foot - dn.foot) * t };
}
const drop = (L) => TH * Math.cos(L.a1) + SH * Math.cos(L.a2);

function sneaker(ctx, x, y, ang, o, back) {
  const s = SHOT[o.shot], kicks = o.kicks, ex = SHOT.exercise;
  ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
  ctx.lineJoin = "round"; ctx.lineWidth = 1.1; ctx.strokeStyle = INK;
  if (!o.socks) { ctx.fillStyle = "#fff"; rr(ctx, -3.6, -9.2, 6.6, 3.6, 1.4); ctx.fill(); ctx.stroke(); }
  // upper
  ctx.beginPath(); ctx.moveTo(-5.6, -0.5); ctx.lineTo(-5.8, -6.4); ctx.quadraticCurveTo(-5.4, -8.2, -2.6, -8); ctx.lineTo(1.2, -7.4);
  ctx.quadraticCurveTo(3, -5, 6.4, -4.6); ctx.quadraticCurveTo(11.6, -4, 12, -0.5); ctx.closePath();
  ctx.fillStyle = kicks ? ex.color : "#fff"; ctx.fill(); ctx.stroke();
  // stripe + heel tab
  ctx.strokeStyle = kicks ? "#fff" : s.color; ctx.lineWidth = 2.1; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(-3.6, -2.6); ctx.quadraticCurveTo(2, -1.5, 8.4, -3.4); ctx.stroke();
  ctx.fillStyle = kicks ? ex.dark : s.color; rr(ctx, -6.8, -8.4, 3, 5.6, 1.2); ctx.fill();
  // laces
  ctx.strokeStyle = INK; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.moveTo(1.6, -6.6); ctx.lineTo(3.2, -5.4); ctx.moveTo(3.4, -5.6); ctx.lineTo(4.8, -4.2); ctx.stroke();
  // chunky midsole + outsole
  ctx.lineWidth = 1.1; ctx.fillStyle = kicks ? "#fff" : (back ? "#EDEBE8" : "#fff"); rr(ctx, -7, -1.4, 19.6, 3.8, 1.8); ctx.fill(); ctx.stroke();
  ctx.fillStyle = INK; rr(ctx, -7, 2.1, 19.6, 2.1, 1); ctx.fill();
  ctx.restore();
}

function limb(ctx, x0, y0, a, b, l1, l2, w, col, socks) {
  const kx = x0 + l1 * Math.sin(a), ky = y0 + l1 * Math.cos(a), fx = kx + l2 * Math.sin(b), fy = ky + l2 * Math.cos(b);
  ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(kx, ky); ctx.lineTo(fx, fy); ctx.stroke();
  if (socks) {   // & comfy socks: knee-high, fluffy, RELAX blue
    const r = SHOT.relax, sx = kx + (fx - kx) * 0.12, sy = ky + (fy - ky) * 0.12;
    ctx.strokeStyle = r.light; ctx.lineWidth = w + 4.4; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(fx, fy); ctx.stroke();
    ctx.strokeStyle = r.color; ctx.lineWidth = 1.6; ctx.setLineDash([2.2, 2.6]); ctx.beginPath(); ctx.moveTo(sx + (fx - sx) * 0.15, sy + (fy - sy) * 0.15); ctx.lineTo(fx, fy); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = r.light; for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.arc(sx + i * 2.6 * Math.cos(b), sy - i * 2.6 * Math.sin(b), 3.3, 0, 7); ctx.fill(); }
  }
  return [fx, fy];
}
function hand(ctx, x, y) { ctx.fillStyle = "#fff"; ctx.strokeStyle = INK; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(x, y, 3.3, 0, 7); ctx.fill(); ctx.stroke(); }

/**
 * o: { shot, cyc (run phase), air, vy, sx, sy, lean, t, jet, jetOn, socks, kicks, bulb (0..1), capOff, flail, sleepy }
 */
export function drawHero(ctx, x, y, o) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(o.lean || 0); ctx.scale(o.sx || 1, o.sy || 1);
  let L0, L1;
  if (o.flail) { const f = o.t * 26; L0 = { a1: Math.sin(f) * 1.2, a2: Math.sin(f) * 1.2 - 1.1, foot: 0.4 }; L1 = { a1: Math.cos(f * 1.1) * 1.1, a2: Math.cos(f * 1.1) - 1.3, foot: 0.6 }; }
  else if (o.air) { L0 = legAir(o.vy, false); L1 = legAir(o.vy, true); }
  else { L0 = legRun(o.cyc); L1 = legRun(o.cyc + Math.PI); }
  const hipY = o.air || o.flail ? -(TH + SH + 4.2) : -(Math.max(drop(L0), drop(L1)) + 4.2);
  const cy = hipY + 3 - BH / 2, top = cy - BH / 2;
  // arms swing against the legs; up and out in the air
  let A0, A1;
  if (o.flail) { A0 = { a: 2.6 + Math.sin(o.t * 30) * 0.6, b: 3 }; A1 = { a: -2.4 + Math.cos(o.t * 27) * 0.6, b: -2.2 }; }
  else if (o.air) { const f = Math.max(-1, Math.min(1, o.vy / 420)); A0 = { a: 1.6 + f * 0.9, b: 2.2 + f * 0.5 }; A1 = { a: -1.2 - f * 0.8, b: -0.6 - f * 0.6 }; }
  else { const sw = Math.sin(o.cyc); A0 = { a: -0.95 * sw, b: -0.95 * sw + 1.55 }; A1 = { a: 0.95 * sw, b: 0.95 * sw + 1.55 }; }
  const sh = top + BH * 0.3;   // shoulders sit on the coloured band, so the hands never cover the wordmark
  // back limbs (behind the bottle)
  const bk = "#3b3b3b";
  const [hx1, hy1] = limb(ctx, 1, sh, A1.a, A1.b, 8.5, 8, 3.2, bk); hand(ctx, hx1, hy1);
  const [fx1, fy1] = limb(ctx, -2, hipY, L1.a1, L1.a2, TH, SH, 4.2, bk, o.socks); sneaker(ctx, fx1, fy1 + 2, L1.foot, o, true);
  // jetpack on the back
  if (o.jet) jetpack(ctx, cy, o);
  // bottle (+ cap pops off in a crash)
  if (o.capOff) drawBottleBody(ctx, 0, cy, BH, o.shot); else drawBottle(ctx, 0, cy, BH, o.shot, { shadow: false, label: false });
  if (!o.capOff) headband(ctx, top, o);
  // front limbs
  const [fx0, fy0] = limb(ctx, 2, hipY, L0.a1, L0.a2, TH, SH, 4.2, INK, o.socks); sneaker(ctx, fx0, fy0 + 2, L0.foot, o, false);
  if (o.jet) jetStraps(ctx, top, o);
  const [hx0, hy0] = limb(ctx, -1, sh, A0.a, A0.b, 8.5, 8, 3.2, INK); hand(ctx, hx0, hy0);
  if (o.bulb > 0) bulb(ctx, 4, top - 15 + Math.sin(o.t * 6) * 1.5, o.bulb, o.t);
  ctx.restore();
}
function headband(ctx, top, o) {
  const s = SHOT[o.shot], y = top + 4.2, x0 = -CAPW / 2 - 0.9, w = CAPW + 1.8;
  // tails flutter behind
  const wv = Math.sin(o.t * 19), wv2 = Math.sin(o.t * 17 + 1.3);
  ctx.fillStyle = "#fff"; ctx.strokeStyle = INK; ctx.lineWidth = 0.9; ctx.lineJoin = "round";
  ctx.beginPath(); ctx.moveTo(x0 + 1, y + 0.6); ctx.quadraticCurveTo(x0 - 6, y - 1 + wv * 2, x0 - 12, y - 1.5 + wv * 3.2); ctx.lineTo(x0 - 11, y + 2.2 + wv * 3); ctx.quadraticCurveTo(x0 - 5, y + 3 + wv, x0 + 1, y + 3.8); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x0 + 1, y + 2); ctx.quadraticCurveTo(x0 - 5, y + 4 + wv2 * 2, x0 - 9.5, y + 6.5 + wv2 * 3); ctx.lineTo(x0 - 8, y + 9 + wv2 * 2.6); ctx.quadraticCurveTo(x0 - 3, y + 6 + wv2, x0 + 1, y + 4.4); ctx.closePath(); ctx.fill(); ctx.stroke();
  rr(ctx, x0, y, w, 4.6, 1.2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = s.color; ctx.fillRect(x0 + 0.6, y + 1.8, w - 1.2, 1.1);
}
function jetpack(ctx, cy, o) {
  // & a jetpack: a twin-can ENERGY-red pack on the back, flames sized by thrust
  const e = SHOT.energy, x = -BH * 0.22 - 13, y = cy - 20;
  for (const dx of [2, 9]) {
    const fl = (o.jetOn ? 18 : 8) + Math.sin(o.t * 60 + dx) * 3 + Math.random() * 5, nx = x + dx + 3;
    ctx.fillStyle = "#FFC845"; ctx.beginPath(); ctx.moveTo(nx - 3.4, y + 33); ctx.quadraticCurveTo(nx - 3, y + 33 + fl * 0.8, nx, y + 35 + fl * 1.2); ctx.quadraticCurveTo(nx + 3, y + 33 + fl * 0.8, nx + 3.4, y + 33); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.moveTo(nx - 1.8, y + 33); ctx.quadraticCurveTo(nx - 1.4, y + 33 + fl * 0.4, nx, y + 34 + fl * 0.62); ctx.quadraticCurveTo(nx + 1.4, y + 33 + fl * 0.4, nx + 1.8, y + 33); ctx.fill();
    ctx.fillStyle = INK; rr(ctx, nx - 3, y + 29, 6, 5, 1.5); ctx.fill();
  }
  ctx.fillStyle = e.dark; rr(ctx, x, y, 17, 31, 5); ctx.fill();
  ctx.fillStyle = e.color; rr(ctx, x + 2.5, y + 1.5, 12, 28, 4.5); ctx.fill();
  ctx.fillStyle = e.light; rr(ctx, x + 4.5, y + 4, 2.4, 20, 1.2); ctx.fill();
  ctx.fillStyle = "#FFC845"; ctx.beginPath(); ctx.moveTo(x + 10.5, y + 8); ctx.lineTo(x + 7.5, y + 15.5); ctx.lineTo(x + 10, y + 15.5); ctx.lineTo(x + 8.5, y + 22); ctx.lineTo(x + 12.5, y + 13.5); ctx.lineTo(x + 10, y + 13.5); ctx.closePath(); ctx.fill();
}
function jetStraps(ctx, top, o) {
  ctx.strokeStyle = INK; ctx.lineWidth = 2.6; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(-BH * 0.22, top + BH * 0.25); ctx.quadraticCurveTo(0, top + BH * 0.27, BH * 0.21, top + BH * 0.22); ctx.stroke();
}
function bulb(ctx, x, y, a, t) {
  const f = SHOT.focus;
  ctx.save(); ctx.globalAlpha = Math.min(1, a); ctx.translate(x, y);
  ctx.strokeStyle = f.color; ctx.lineWidth = 2; ctx.lineCap = "round";
  for (let i = 0; i < 7; i++) { const an = -Math.PI / 2 + (i - 3) * 0.45 + Math.sin(t * 3) * 0.05; ctx.beginPath(); ctx.moveTo(Math.cos(an) * 10, Math.sin(an) * 10); ctx.lineTo(Math.cos(an) * 14, Math.sin(an) * 14); ctx.stroke(); }
  ctx.fillStyle = f.color; ctx.strokeStyle = INK; ctx.lineWidth = 1.1; ctx.beginPath(); ctx.arc(0, 0, 7, 0, 7); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(-2.2, -2.2, 1.8, 0, 7); ctx.fill();
  ctx.fillStyle = "#9a9a9a"; ctx.fillRect(-3, 6, 6, 4.5); ctx.strokeRect(-3, 6, 6, 4.5);
  ctx.restore();
}

/* ── the everyday hassles ───────────────────────────────────────────────── */
// each draws with its left edge at x and its base at yb (screen y, up is negative)
const LIDS = ["#FFC845", "#EE3831"];
const SIGNS = [["MONDAY"], ["MONDAY"], ["REPLY", "ALL"], ["8AM"], ["MONDAY"]];
const BANNERS = [["SALE ON NOW"], ["FREE WI-FI"], ["NEW MENU"], ["OPEN LATE"]];   // short enough to stay ≥ 12 px on a 160-unit banner
export const signText = (it) => SIGNS[Math.floor(it.var * SIGNS.length)];
export const bannerOf = (it) => BANNERS[Math.floor(it.var * BANNERS.length)];

export function drawOb(ctx, it, x, yb, t, P) {
  switch (it.type) {
    case "cone": return cone(ctx, x, yb, it.w, it.h);
    case "bin": return bin(ctx, x, yb, it.w, it.h, LIDS[it.var < 0.55 ? 0 : 1]);
    case "aframe": return aframe(ctx, x, yb, it.w, it.h, signText(it));
    case "paper": return paper(ctx, x, yb, it.w, it.h, it.var, t);
    case "puddle": return puddle(ctx, x, yb, it.w, t);
    case "scooter": return scooter(ctx, x, yb, it.w, it.h, t, P && P.dark > 0.4);
    case "pigeon": return pigeon(ctx, x, -pigeonY(it, t), it.w, t, P && P.dark > 0.4);
    case "banner": return banner(ctx, x, yb, it, t, P);
  }
}
function cone(ctx, x, yb, w, h) {
  ctx.fillStyle = "#B8241F"; rr(ctx, x, yb - 4.5, w, 4.5, 1.5); ctx.fill();
  const body = new Path2D(); body.moveTo(x + 4, yb - 4); body.lineTo(x + w / 2 - 2.6, yb - h + 2.5); body.quadraticCurveTo(x + w / 2, yb - h - 0.5, x + w / 2 + 2.6, yb - h + 2.5); body.lineTo(x + w - 4, yb - 4); body.closePath();
  ctx.fillStyle = "#EE3831"; ctx.fill(body);
  ctx.save(); ctx.clip(body); ctx.fillStyle = "#fff"; ctx.fillRect(x, yb - h * 0.47, w, 5); ctx.fillRect(x, yb - h * 0.74, w, 3.6);
  ctx.fillStyle = "rgba(0,0,0,0.1)"; ctx.fillRect(x + w / 2 + 2, yb - h, w, h); ctx.restore();
}
function bin(ctx, x, yb, w, h, lid) {
  // wheel at the back
  ctx.fillStyle = "#2B2B2B";
  ctx.beginPath(); ctx.moveTo(x + 4, yb - 2); ctx.lineTo(x + 2, yb - h + 6); ctx.lineTo(x + w - 2, yb - h + 6); ctx.lineTo(x + w - 5, yb - 2); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.07)"; ctx.fillRect(x + 6, yb - h + 8, 4, h - 12);
  ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.fillRect(x + w - 10, yb - h + 8, 4, h - 12);
  ctx.fillStyle = "#fff"; rr(ctx, x + w * 0.42, yb - h * 0.62, 10, 12, 1.5); ctx.fill();
  ctx.fillStyle = "#2B2B2B"; ctx.fillRect(x + w * 0.42 + 2.5, yb - h * 0.62 + 3, 5, 1.6); ctx.fillRect(x + w * 0.42 + 2.5, yb - h * 0.62 + 6.5, 5, 1.6);
  ctx.fillStyle = lid; rr(ctx, x - 1.5, yb - h, w + 3, 7, 2.5); ctx.fill();
  ctx.fillStyle = "#131313"; rr(ctx, x - 3.5, yb - h + 1, 4, 9, 1.5); ctx.fill();                   // handle
  ctx.beginPath(); ctx.arc(x + 6, yb - 5, 5, 0, 7); ctx.fill(); ctx.fillStyle = "#B9B4AD"; ctx.beginPath(); ctx.arc(x + 6, yb - 5, 1.8, 0, 7); ctx.fill();
}
function aframe(ctx, x, yb, w, h, lines) {
  ctx.strokeStyle = "#131313"; ctx.lineWidth = 3; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(x + 7, yb); ctx.lineTo(x + 10, yb - 12); ctx.moveTo(x + w - 7, yb); ctx.lineTo(x + w - 10, yb - 12); ctx.stroke();
  ctx.fillStyle = "#D4D0CA"; rr(ctx, x + 2, yb - h, w - 4, h - 9, 3); ctx.fill();
  ctx.fillStyle = "#131313"; rr(ctx, x + 5, yb - h + 3, w - 10, h - 15, 2); ctx.fill();
  ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const n = lines.length, mid = yb - h + 3 + (h - 15) / 2;
  for (let i = 0; i < n; i++) { fitFont(ctx, 900, Math.max(17, TXT), lines[i], w - 18, TXT); ctx.fillText(lines[i], x + w / 2, mid - 2 + (i - (n - 1) / 2) * 18); }
  ctx.fillStyle = "#EE3831"; ctx.fillRect(x + 11, yb - 20, w - 22, 2.5);
}
function paper(ctx, x, yb, w, h, v, t) {
  const n = Math.round(h / 8.5); let y = yb;
  for (let i = 0; i < n; i++) {
    const j = Math.sin(v * 50 + i * 2.1) * 2.6, th = i % 3 === 1 ? 9 : 7.5;
    ctx.fillStyle = i % 3 === 1 ? "#D4D0CA" : i % 4 === 3 ? "#FFC845" : "#fff";
    ctx.fillRect(x + 2 + j, y - th, w - 4, th);
    ctx.fillStyle = "rgba(19,19,19,0.55)"; ctx.fillRect(x + 2 + j, y - 1, w - 4, 1);
    y -= th;
  }
  // the top sheet won't sit still
  ctx.save(); ctx.translate(x + w / 2, y); ctx.rotate(Math.sin(t * 7 + v * 9) * 0.12 - 0.05);
  ctx.fillStyle = "#fff"; ctx.fillRect(-w / 2 + 1, -3, w - 2, 3); ctx.fillStyle = INK; ctx.fillRect(-w / 2 + 1, -1, w - 2, 1); ctx.restore();
  // red URGENT tab + paper clip
  ctx.fillStyle = "#EE3831"; rr(ctx, x + w - 8, yb - h * 0.55, 10, 13, 1.5); ctx.fill();
  ctx.strokeStyle = INK; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(x + 8, y + 1); ctx.lineTo(x + 8, y + 9); ctx.stroke();
}
function puddle(ctx, x, yb, w, t) {
  const c = "#2A3242";
  ctx.fillStyle = c; ctx.beginPath();
  ctx.ellipse(x + w * 0.42, yb - 1.8, w * 0.42, 4.6, 0, 0, 7); ctx.ellipse(x + w * 0.74, yb - 1.4, w * 0.26, 3.6, 0.05, 0, 7); ctx.ellipse(x + w * 0.16, yb - 1.2, w * 0.15, 3, -0.05, 0, 7); ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.55)"; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.ellipse(x + w * 0.42, yb - 1.8, w * 0.42, 4.6, 0, Math.PI * 1.08, Math.PI * 1.9); ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.75)"; rr(ctx, x + w * 0.22, yb - 3.4, w * 0.2, 1.6, 0.8); ctx.fill(); rr(ctx, x + w * 0.5, yb - 2.6, w * 0.1, 1.3, 0.6); ctx.fill();
  // splash: a few drops hopping up off the surface
  const p = (t * 1.6) % 1;
  for (let i = 0; i < 3; i++) { const q = (p + i / 3) % 1, dx = x + w * (0.3 + i * 0.2), hgt = Math.sin(q * Math.PI) * 10; ctx.fillStyle = `rgba(169,200,247,${0.9 * (1 - q)})`; ctx.beginPath(); ctx.arc(dx + (i - 1) * q * 6, yb - 4 - hgt, 1.8, 0, 7); ctx.fill(); }
}
function scooter(ctx, x, yb, w, h, t, night) {
  const red = SHOT.energy;
  // speed streaks behind (it's heading left, straight at you)
  ctx.strokeStyle = night ? "rgba(255,255,255,0.45)" : "rgba(19,19,19,0.28)"; ctx.lineWidth = 2; ctx.lineCap = "round";
  for (let i = 0; i < 3; i++) { const yy = yb - 14 - i * 12, o = ((t * 90 + i * 13) % 14); ctx.beginPath(); ctx.moveTo(x + w + 4 + o, yy); ctx.lineTo(x + w + 16 + o, yy); ctx.stroke(); }
  ctx.fillStyle = night ? "rgba(255,232,170,0.42)" : "rgba(255,200,69,0.28)"; ctx.beginPath(); ctx.moveTo(x + 8, yb - h + 15); ctx.lineTo(x - 26, yb - h + 6); ctx.lineTo(x - 26, yb - h + 30); ctx.closePath(); ctx.fill();
  const shape = (halo) => {
    const e = halo ? 3.2 : 0; const col = halo ? "#FFFFFF" : INK;
    ctx.strokeStyle = col; ctx.lineCap = "round"; ctx.lineWidth = 4 + e; ctx.beginPath(); ctx.moveTo(x + 14, yb - 9); ctx.lineTo(x + 8, yb - h + 4); ctx.stroke();
    ctx.lineWidth = 3.4 + e; ctx.beginPath(); ctx.moveTo(x + 2, yb - h + 3); ctx.lineTo(x + 16, yb - h + 5); ctx.stroke();
    ctx.fillStyle = halo ? col : INK; rr(ctx, x + 10 - e / 2, yb - 13 - e / 2, w - 16 + e, 7 + e, 3); ctx.fill();
    ctx.lineWidth = 2.4 + e; ctx.beginPath(); ctx.arc(x + w - 9, yb - 6, 8, Math.PI * 1.05, Math.PI * 1.75); ctx.stroke();
    for (const wx of [x + 9, x + w - 9]) { ctx.fillStyle = halo ? col : INK; ctx.beginPath(); ctx.arc(wx, yb - 6, 6 + e / 2, 0, 7); ctx.fill(); }
  };
  if (night) shape(true);
  shape(false);
  ctx.fillStyle = red.color; ctx.fillRect(x + 13, yb - 12, w - 22, 2.6);
  for (const wx of [x + 9, x + w - 9]) { ctx.fillStyle = "#B9B4AD"; ctx.beginPath(); ctx.arc(wx, yb - 6, 2.2, 0, 7); ctx.fill(); }
  ctx.fillStyle = "#FFC845"; ctx.beginPath(); ctx.arc(x + 8.5, yb - h + 15, 3.4, 0, 7); ctx.fill();
}
function pigeon(ctx, x, yTop, w, t, night) {
  // yTop = screen y of the bottom of its box; draw upward from there (facing left)
  const cx = x + w / 2, cy = yTop - 10, fl = Math.sin(t * 22);
  if (night) { ctx.fillStyle = "rgba(255,255,255,0.85)"; ctx.beginPath(); ctx.ellipse(cx + 1, cy, 14, 9.5, -0.08, 0, 7); ctx.fill(); ctx.beginPath(); ctx.arc(cx - 11, cy - 6, 7, 0, 7); ctx.fill(); }
  ctx.fillStyle = "#8F8A84"; ctx.beginPath(); ctx.moveTo(cx + 9, cy - 1); ctx.lineTo(cx + 19, cy - 4); ctx.lineTo(cx + 18, cy + 3); ctx.closePath(); ctx.fill();   // tail
  ctx.fillStyle = "#A8A39C"; ctx.beginPath(); ctx.ellipse(cx + 1, cy, 12, 7.5, -0.08, 0, 7); ctx.fill();
  ctx.fillStyle = "#C9C4BC"; ctx.beginPath(); ctx.ellipse(cx - 2, cy + 3, 8, 3.6, 0, 0, 7); ctx.fill();
  ctx.strokeStyle = "#06AF9A"; ctx.lineWidth = 2.6; ctx.beginPath(); ctx.arc(cx - 9, cy - 3, 5.2, Math.PI * 0.2, Math.PI * 0.75); ctx.stroke();
  ctx.strokeStyle = "#8564AB"; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(cx - 9, cy - 3, 3.6, Math.PI * 0.25, Math.PI * 0.7); ctx.stroke();
  ctx.fillStyle = "#6F6B66"; ctx.beginPath(); ctx.arc(cx - 11, cy - 6, 5, 0, 7); ctx.fill();
  ctx.fillStyle = "#FFC845"; ctx.beginPath(); ctx.moveTo(cx - 15.5, cy - 7); ctx.lineTo(cx - 20, cy - 5.2); ctx.lineTo(cx - 15.5, cy - 4.4); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(cx - 12.4, cy - 7.2, 1.6, 0, 7); ctx.fill(); ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(cx - 12.8, cy - 7.2, 0.8, 0, 7); ctx.fill();
  // wing
  ctx.save(); ctx.translate(cx + 1, cy - 3); ctx.rotate(-0.25 + fl * 0.85);
  ctx.fillStyle = "#77736D"; ctx.beginPath(); ctx.moveTo(-4, 0); ctx.quadraticCurveTo(6, -16, 14, -9); ctx.quadraticCurveTo(8, -3, 6, 1); ctx.closePath(); ctx.fill(); ctx.restore();
}
function banner(ctx, x, yb, it, t, P) {
  // hazards never wear the time of day's colour: an ink banner on light skies, a white one on dark skies
  const sk = rgbOf(P ? P.sky : "#FFFFFF"), dark = (0.2126 * sk[0] + 0.7152 * sk[1] + 0.0722 * sk[2]) / 255 < 0.45;
  const fill = dark ? "#FFFFFF" : INK, ink = dark ? INK : "#FFFFFF";
  const [text] = bannerOf(it), y0 = yb - OB.banner.hang - it.h, sway = Math.sin(t * 2.2 + it.var * 5) * 1.2;
  const cg = ctx.createLinearGradient(0, y0, 0, y0 - 170); cg.addColorStop(0, fill === INK ? INK : "#FFFFFF"); cg.addColorStop(1, fill === INK ? "rgba(19,19,19,0)" : "rgba(255,255,255,0)");
  ctx.strokeStyle = cg; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(x + 6, y0); ctx.lineTo(x + 6 + sway, y0 - 170); ctx.moveTo(x + it.w - 6, y0); ctx.lineTo(x + it.w - 6 + sway, y0 - 170); ctx.stroke();
  const path = () => { ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x + it.w, y0); ctx.lineTo(x + it.w, y0 + it.h); const n = Math.max(4, Math.round(it.w / 22)); for (let i = n; i >= 0; i--) ctx.lineTo(x + (it.w * i) / n, y0 + it.h - (i % 2 ? 6 : 0)); ctx.closePath(); };
  path(); ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = ink; ctx.lineWidth = 2.5; ctx.lineJoin = "round"; ctx.stroke();
  ctx.fillStyle = SHOT.energy.color; ctx.fillRect(x + 6, y0 + 5, it.w - 12, 3);
  ctx.fillStyle = ink; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  fitFont(ctx, 900, Math.max(20, TXT), text, it.w - 16, TXT); ctx.fillText(text, x + it.w / 2, y0 + it.h / 2 + 1);
}

/** FOCUS: outline a hazard in light-bulb yellow. */
export function outlineOb(ctx, it, x, yb, t) {
  ctx.save(); ctx.strokeStyle = SHOT.focus.color; ctx.lineWidth = 3; ctx.setLineDash([6, 4]); ctx.lineDashOffset = -t * 30;
  if (it.type === "banner") { const y0 = yb - OB.banner.hang - it.h; rr(ctx, x - 4, y0 - 4, it.w + 8, it.h + 8, 6); }
  else if (it.type === "pigeon") { const y = -pigeonY(it, t); rr(ctx, x - 4, y - it.h - 4, it.w + 8, it.h + 8, 6); }
  else rr(ctx, x - 4, yb - it.h - 5, it.w + 8, it.h + 9, 6);
  ctx.stroke(); ctx.restore();
}
/** FOCUS: the ideal take-off point glows on the ground, labelled TAP or HOLD. */
export function drawHint(ctx, x, yb, kind, t, fs) {
  const f = SHOT.focus, p = 0.5 + 0.5 * Math.sin(t * 9);
  ctx.save();
  ctx.fillStyle = rgba(f.color, 0.25 + 0.2 * p); ctx.beginPath(); ctx.ellipse(x, yb, 22 + p * 4, 6, 0, 0, 7); ctx.fill();
  ctx.fillStyle = f.color; ctx.beginPath(); ctx.ellipse(x, yb, 9, 3, 0, 0, 7); ctx.fill();
  ctx.strokeStyle = f.color; ctx.lineWidth = 3; ctx.lineCap = "round"; ctx.lineJoin = "round";
  const low = kind === "LOW", label = low ? "STAY LOW" : kind;
  const ay = yb - 18 - p * 4; ctx.beginPath(); if (low) { ctx.moveTo(x - 7, ay); ctx.lineTo(x, ay + 6); ctx.lineTo(x + 7, ay); } else { ctx.moveTo(x - 7, ay + 6); ctx.lineTo(x, ay); ctx.lineTo(x + 7, ay + 6); } ctx.stroke();
  ctx.font = `900 ${fs}px ${FONT}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  kind = label; const tw = ctx.measureText(kind).width + fs * 1.1, ph = fs * 1.7, py = ay - 6 - ph / 2;
  ctx.fillStyle = f.color; rr(ctx, x - tw / 2, py - ph / 2, tw, ph, ph / 2); ctx.fill();
  ctx.fillStyle = INK; ctx.fillText(kind, x, py + 1);
  ctx.restore();
}

/** Power-up: the floating bottle with its label line in a pill. fs = font size in world units (≥12 px on screen). */
export function drawPower(ctx, id, x, yb, t, fs) {
  const s = SHOT[id], bob = Math.sin(t * 3.2) * 4, cy = yb - 54 + bob, r = 25;
  ctx.fillStyle = "rgba(0,0,0,0.12)"; ctx.beginPath(); ctx.ellipse(x, yb - 1, 13 - bob * 0.6, 3, 0, 0, 7); ctx.fill();
  const p = (t * 1.4) % 1;
  ctx.strokeStyle = rgba(s.color, 0.55 * (1 - p)); ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, cy, r + 3 + p * 16, 0, 7); ctx.stroke();
  ctx.fillStyle = s.color; ctx.beginPath(); ctx.arc(x, cy, r, 0, 7); ctx.fill();
  ctx.strokeStyle = "#fff"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, cy, r, 0, 7); ctx.stroke();
  ctx.save(); ctx.translate(x, cy); ctx.rotate(Math.sin(t * 2.4) * 0.1); drawIcon(ctx, id, t); ctx.restore();
  ctx.font = `800 ${fs}px ${FONT}`; ctx.textBaseline = "middle"; ctx.textAlign = "center";
  const tw = ctx.measureText(s.tag).width + fs * 1.3, ph = fs * 1.9, py = cy - r - 12 - ph / 2;
  ctx.fillStyle = s.color; rr(ctx, x - tw / 2, py - ph / 2, tw, ph, ph / 2); ctx.fill();
  ctx.fillStyle = id === "sleep" ? "#fff" : INK; ctx.fillText(s.tag, x, py + 1);
  ctx.beginPath(); ctx.moveTo(x - 5, py + ph / 2 - 0.5); ctx.lineTo(x, py + ph / 2 + 5); ctx.lineTo(x + 5, py + ph / 2 - 0.5); ctx.fillStyle = s.color; ctx.fill();
}
/** The label lines as icons, ~34 units across, centred on 0,0: a jetpack, a light bulb, a sneaker, a sock, a moon. */
export function drawIcon(ctx, id, t) {
  ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.strokeStyle = INK; ctx.lineWidth = 1.6;
  if (id === "energy") {
    for (const dx of [-6, 6]) { const fl = 7 + Math.sin(t * 40 + dx) * 2; ctx.fillStyle = "#FFC845"; ctx.beginPath(); ctx.moveTo(dx - 3.4, 9); ctx.quadraticCurveTo(dx, 9 + fl * 1.4, dx + 3.4, 9); ctx.fill(); }
    for (const dx of [-6, 6]) { ctx.fillStyle = "#fff"; rr(ctx, dx - 5, -13, 10, 22, 4); ctx.fill(); ctx.stroke(); ctx.fillStyle = INK; rr(ctx, dx - 3, 8, 6, 3.5, 1); ctx.fill(); }
    ctx.fillStyle = "#FFC845"; ctx.beginPath(); ctx.moveTo(1.5, -9); ctx.lineTo(-2.5, -1); ctx.lineTo(0.5, -1); ctx.lineTo(-1.5, 6); ctx.lineTo(3, -3); ctx.lineTo(0, -3); ctx.closePath(); ctx.fill(); ctx.lineWidth = 0.8; ctx.stroke();
  } else if (id === "focus") {
    ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(0, -4, 10, Math.PI * 0.8, Math.PI * 2.2); ctx.lineTo(4, 7); ctx.lineTo(-4, 7); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#B9B4AD"; rr(ctx, -4.5, 7, 9, 6, 1.5); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-3, -3); ctx.lineTo(0, 1); ctx.lineTo(3, -3); ctx.moveTo(0, 1); ctx.lineTo(0, 7); ctx.stroke();
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 2.2; for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + (i - 2) * 0.62; ctx.beginPath(); ctx.moveTo(Math.cos(a) * 14, -4 + Math.sin(a) * 14); ctx.lineTo(Math.cos(a) * 18, -4 + Math.sin(a) * 18); ctx.stroke(); }
  } else if (id === "exercise") {
    ctx.save(); ctx.scale(1.45, 1.45); ctx.translate(-2.5, 3); sneaker(ctx, 0, 0, 0, { shot: "exercise", kicks: false }, false); ctx.restore();
  } else if (id === "relax") {
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.moveTo(-6, -14); ctx.lineTo(4, -14); ctx.lineTo(4, 2); ctx.quadraticCurveTo(13, 2, 13, 8); ctx.quadraticCurveTo(13, 13, 6, 13); ctx.lineTo(-2, 13); ctx.quadraticCurveTo(-6, 13, -6, 8); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = SHOT.relax.dark; ctx.fillRect(-5.2, -8, 8.4, 2.4); ctx.fillRect(-5.2, -3.5, 8.4, 2.4);
    ctx.fillStyle = "#fff"; for (const dx of [-5, -1, 3]) { ctx.beginPath(); ctx.arc(dx, -14, 2.6, 0, 7); ctx.fill(); }
  } else if (id === "sleep") {
    ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(-2, 1, 12, 0, 7); ctx.fill();
    ctx.fillStyle = SHOT.sleep.color; ctx.beginPath(); ctx.arc(4, -4, 10.5, 0, 7); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.font = `900 9px ${FONT}`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("z", 8, -8); ctx.font = `900 6.5px ${FONT}`; ctx.fillText("z", 13, -13);
  }
}

/** km marker: a lollipop sign, a flat brand circle on an ink pole. */
export function drawSign(ctx, x, m, P, fs) {
  // the circle grows with the lettering, so the number never has to shrink below the text floor
  const f = Math.max(15, fs, TXT), r = Math.max(24, f * 1.75), cy = -96 - r + 12;
  ctx.fillStyle = P.dark > 0.5 ? "#8C84A3" : INK; ctx.fillRect(x - 1.6, -96, 3.2, 96);
  ctx.fillStyle = P.accent; ctx.beginPath(); ctx.arc(x, cy, r, 0, 7); ctx.fill();
  const t = m % 1000 === 0 ? `${m / 1000}` : `${m}`, u = m % 1000 === 0 ? "km" : "m";
  ctx.fillStyle = P.accent === "#8564AB" || P.dark > 0.5 ? "#fff" : INK; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
  fitFont(ctx, 900, f, t, r * 2 - 8, TXT); ctx.fillText(t, x, cy + f * 0.15);
  ctx.font = `800 ${Math.max(TXT, f * 0.8)}px ${FONT}`; ctx.fillText(u, x, cy + f * 0.15 + Math.max(TXT, f * 0.8));
}

/* ── the city ────────────────────────────────────────────────────────────────
 * Three parallax layers of flat colour blocks, generated as the camera moves. What gets generated follows
 * the part of the day at that point of the run (park trees at midday, lit windows at night); colours are
 * always taken from the live blended palette, so a whole skyline shifts smoothly from dawn to night.
 */
export function createCity(seed) {
  let s = seed * 9301 + 49297; const R = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const layers = [
    { par: 0.12, items: [], next: -400 },
    { par: 0.38, items: [], next: -400 },
    { par: 0.72, items: [], next: -400 },
  ];
  let skyH = 600;
  function make(li, x, day) {
    const park = day === "midday", night = day === "night", sk = Math.min(1, skyH / 640);
    if (li === 0) {
      const w = 46 + R() * 70, h = (park ? 110 + R() * 150 : 170 + R() * 280) * (0.55 + 0.45 * sk);
      return { x, w, h, kind: R() < 0.22 ? "dome" : R() < 0.4 ? "step" : "tower", gap: 6 + R() * 30, r: R() };
    }
    if (li === 1) {
      if (park && R() < 0.75) { const w = 70 + R() * 50; return { x, w, h: 120 + R() * 90, kind: R() < 0.5 ? "tree" : "tree2", gap: 4 + R() * 20, r: R(), tone: 0 }; }
      if (!park && R() < 0.045) return { x, w: 132, h: 230 + R() * 60, kind: "billboard", gap: 30 + R() * 30, r: R(), tone: 2 };
      const w = 62 + R() * 76, h = (90 + R() * 190) * (0.7 + 0.3 * sk);
      const kinds = ["stripes", "grid", "arch", "stripes", "grid", "split"];
      return { x, w, h, kind: kinds[Math.floor(R() * kinds.length)], gap: 4 + R() * 26, r: R(), tone: R() < 0.16 ? 2 : R() < 0.55 ? 0 : 1, lit: night };
    }
    const k = park ? (R() < 0.6 ? "bush" : "lamp") : R() < 0.55 ? "lamp" : R() < 0.75 ? "bollards" : "tree";
    return { x, w: k === "bush" ? 40 + R() * 40 : k === "bollards" ? 34 : 20, h: 0, kind: k, gap: 70 + R() * 120, r: R() };
  }
  return {
    update(camX, viewW, day, sky) {
      skyH = sky || skyH;
      layers.forEach((L, li) => {
        const lx = camX * L.par;
        if (L.next < lx - 400) L.next = lx - 300;
        while (L.next < lx + viewW + 200) { const it = make(li, L.next, day); L.items.push(it); L.next += it.w + it.gap; }
        while (L.items.length && L.items[0].x + L.items[0].w < lx - 300) L.items.shift();
      });
    },
    reset() { layers.forEach((L) => { L.items = []; L.next = -1e9; }); },
    draw(ctx, camX, P, t, skyH) {
      // 0: far towers
      const L0 = layers[0]; ctx.fillStyle = P.far;
      for (const it of L0.items) {
        const x = it.x - camX * L0.par;
        if (it.kind === "dome") { ctx.fillRect(x, -it.h + it.w / 2, it.w, it.h - it.w / 2); ctx.beginPath(); ctx.arc(x + it.w / 2, -it.h + it.w / 2, it.w / 2, Math.PI, 0); ctx.fill(); }
        else if (it.kind === "step") { ctx.fillRect(x, -it.h * 0.72, it.w, it.h * 0.72); ctx.fillRect(x + it.w * 0.2, -it.h, it.w * 0.6, it.h * 0.3); ctx.fillRect(x + it.w * 0.48, -it.h - 26, 2, 26); }
        else ctx.fillRect(x, -it.h, it.w, it.h);
      }
      // 1: mid buildings / park
      const L1 = layers[1];
      for (const it of L1.items) drawMid(ctx, it, it.x - camX * L1.par, P, t);
      // 2: near street furniture (soft, so it never reads as an obstacle)
      const L2 = layers[2];
      for (const it of L2.items) drawNear(ctx, it, it.x - camX * L2.par, P, t);
    },
  };
}
function toneCol(P, tone) { return [P.mid0, P.mid1, P.mid2][tone]; }
function winCol(P, tone) { return [P.win0, P.win1, P.win2][tone]; }
function drawMid(ctx, it, x, P, t) {
  const w = it.w, h = it.h;
  if (it.kind === "tree" || it.kind === "tree2") {
    ctx.fillStyle = P.tree2; ctx.fillRect(x + w / 2 - 3, -h * 0.5, 6, h * 0.5);
    if (it.kind === "tree") { ctx.fillStyle = P.tree; ctx.beginPath(); ctx.arc(x + w / 2, -h + w * 0.42, w * 0.42, 0, 7); ctx.fill(); ctx.fillStyle = P.tree2; ctx.beginPath(); ctx.arc(x + w * 0.66, -h * 0.62, w * 0.24, 0, 7); ctx.fill(); }
    else { ctx.fillStyle = P.tree2; ctx.beginPath(); ctx.arc(x + w / 2, -h + w * 0.38, w * 0.38, 0, 7); ctx.fill(); ctx.fillStyle = P.tree; ctx.beginPath(); ctx.arc(x + w * 0.38, -h * 0.66, w * 0.3, 0, 7); ctx.fill(); }
    return;
  }
  if (it.kind === "billboard") {
    ctx.fillStyle = P.near; ctx.fillRect(x + 22, -h + 50, 5, h - 50); ctx.fillRect(x + w - 27, -h + 50, 5, h - 50);   // poles in a background tone, never read as a hazard
    ctx.fillStyle = P.accent; ctx.fillRect(x, -h, w, 60);
    drawWordmark(ctx, x + 12, -h + 38, 30, P.accent === "#8564AB" ? "#fff" : INK, true);
    ctx.fillStyle = P.dark > 0.5 ? "#fff" : INK; ctx.beginPath(); ctx.arc(x + w - 22, -h + 30, 12, 0, 7); ctx.fill();
    return;
  }
  const c = toneCol(P, it.tone), wc = winCol(P, it.tone);
  ctx.fillStyle = c;
  if (it.kind === "arch") { ctx.fillRect(x, -h + w / 2, w, h - w / 2); ctx.beginPath(); ctx.arc(x + w / 2, -h + w / 2, w / 2, Math.PI, 0); ctx.fill(); }
  else if (it.kind === "split") { ctx.fillRect(x, -h, w, h); ctx.fillStyle = toneCol(P, (it.tone + 1) % 3 === 2 ? 0 : (it.tone + 1) % 3); ctx.fillRect(x + w * 0.62, -h * 0.7, w * 0.38, h * 0.7); }
  else ctx.fillRect(x, -h, w, h);
  ctx.fillStyle = wc;
  if (it.kind === "stripes" || it.kind === "split") {
    const ww = it.kind === "split" ? w * 0.62 : w;
    for (let y = -h + 16, i = 0; y < -18; y += 20, i++) if (!it.lit || ((i * 7 + Math.floor(it.r * 13)) % 3)) ctx.fillRect(x + 8, y, ww - 16, 7);
  } else if (it.kind === "grid") {
    let i = 0; for (let y = -h + 16; y < -16; y += 18) for (let xx = x + 12; xx < x + w - 8; xx += 16) { i++; if (it.lit && (i * 5 + Math.floor(it.r * 11)) % 4 === 0) continue; ctx.beginPath(); ctx.arc(xx, y, 4, 0, 7); ctx.fill(); }
  } else if (it.kind === "arch") {
    for (let xx = x + 10; xx < x + w - 10; xx += 14) ctx.fillRect(xx, -h + w / 2 + 6, 5, h - w / 2 - 26);
  }
}
function drawNear(ctx, it, x, P, t) {
  const c = P.near;
  if (it.kind === "lamp") {
    ctx.fillStyle = c; ctx.fillRect(x, -112, 3, 112); ctx.fillRect(x - 10, -112, 13, 3);
    if (P.dark > 0.5) { ctx.fillStyle = "rgba(255,200,69,0.16)"; ctx.beginPath(); ctx.moveTo(x - 10, -108); ctx.lineTo(x - 34, 0); ctx.lineTo(x + 14, 0); ctx.closePath(); ctx.fill(); ctx.fillStyle = "#FFC845"; }
    ctx.beginPath(); ctx.arc(x - 9, -106, 5, 0, 7); ctx.fill();
  } else if (it.kind === "bollards") {
    ctx.fillStyle = c; for (let i = 0; i < 3; i++) { rr(ctx, x + i * 13, -22, 7, 22, 3.5); ctx.fill(); }
  } else if (it.kind === "tree") {
    ctx.fillStyle = c; ctx.fillRect(x + 8, -60, 4, 60); ctx.beginPath(); ctx.arc(x + 10, -70, 22, 0, 7); ctx.fill();
  } else if (it.kind === "bush") {
    ctx.fillStyle = c; rr(ctx, x, -26, it.w, 26, 13); ctx.fill();
  }
}

/** The day's moments, straight off the range: giant type in the sky. */
export const MOMENT = { dawn: ["Jump", "start."], morning: ["Head", "down."], midday: ["Get", "moving."], dusk: ["Unwind."], night: ["Lights", "out."] };
function momentType(ctx, w, topY, hudU, P, words, alpha) {
  const sky = -topY; if (sky < 440 || alpha <= 0) return;
  let size = 150; ctx.font = `900 ${size}px ${FONT}`;
  const widest = Math.max(...words.map((l) => ctx.measureText(l).width)); size = Math.min(150, Math.floor((size * w * 0.84) / widest), sky * 0.17);
  ctx.font = `900 ${size}px ${FONT}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  ctx.fillStyle = mix(P.sky, P.far, 0.62); ctx.globalAlpha = alpha;
  const y0 = topY + hudU + size * 0.92;
  words.forEach((l, i) => ctx.fillText(l, w * 0.07, y0 + i * size * 0.9));
  ctx.globalAlpha = 1;
}
/** Sky: flat colour, giant moment type, the day's big circle (sun → moon), a few stars at night. */
export function drawSky(ctx, x0, w, topY, P, t, stars, day, hudU) {
  ctx.fillStyle = P.sky; ctx.fillRect(x0, topY, w, -topY + 2);
  if (day) { momentType(ctx, w, topY, hudU, P, MOMENT[day.id], 1 - day.f * 2); momentType(ctx, w, topY, hudU, P, MOMENT[day.next], day.f * 2 - 1); }   // out, then in
  if (P.stars > 0.01) {
    ctx.fillStyle = rgba("#FFFFFF", 0.85 * P.stars);
    for (const s of stars) { const tw = 0.6 + 0.4 * Math.sin(t * 2 + s[2] * 10); ctx.globalAlpha = P.stars * tw; ctx.beginPath(); ctx.arc(x0 + s[0] * w, topY + s[1] * -topY * 0.7, s[2] * 1.8 + 0.6, 0, 7); ctx.fill(); }
    ctx.globalAlpha = 1;
  }
  const r = P.sunR, cy = topY + (-topY) * P.sunY + r * 0.2;
  ctx.fillStyle = P.sun; ctx.beginPath(); ctx.arc(x0 + w * 0.7, cy, r, 0, 7); ctx.fill();
  if (P.stars > 0.5) { ctx.fillStyle = P.sky; ctx.beginPath(); ctx.arc(x0 + w * 0.7 + r * 0.42, cy - r * 0.2, r * 0.86, 0, 7); ctx.fill(); }  // crescent
}

/** Street / rooftops / gaps for the visible ground segments. bottom = world y of the screen bottom (positive, below street). */
export function drawGround(ctx, segs, camX, viewW, bottom, P, pave) {
  ctx.fillStyle = P.alley; ctx.fillRect(camX - 10, 0, viewW + 20, bottom + 2);
  for (const g of segs) {
    if (g.x1 < camX - 20 || g.x0 > camX + viewW + 20) continue;
    const x0 = Math.max(g.x0, camX - 20), x1 = Math.min(g.x1, camX + viewW + 20), top = -g.h;
    if (g.kind === "street" && g.h === 0) {
      ctx.fillStyle = P.pave; ctx.fillRect(x0, top, x1 - x0, pave);
      ctx.fillStyle = P.joint; for (let x = Math.ceil(x0 / 46) * 46; x < x1; x += 46) ctx.fillRect(x, top + 4, 2, pave - 8);
      ctx.fillStyle = P.kerb; ctx.fillRect(x0, top + pave, x1 - x0, 5);
      ctx.fillStyle = P.road; ctx.fillRect(x0, top + pave + 5, x1 - x0, bottom - pave);
      if (P.lawn < 0.99) { ctx.fillStyle = rgba(P.lane, 1 - P.lawn); const ly = top + pave + 5 + Math.min(70, (bottom - pave) * 0.42); for (let x = Math.ceil(x0 / 80) * 80; x < x1; x += 80) ctx.fillRect(x, ly, 34, 4); }
      if (P.lawn > 0.01) { ctx.fillStyle = rgba(P.lane, P.lawn); for (let x = Math.ceil(x0 / 37) * 37; x < x1; x += 37) { const yy = top + pave + 22 + ((x * 7) % 50); ctx.beginPath(); ctx.arc(x, yy, 3, 0, 7); ctx.fill(); } }
    } else {
      ctx.fillStyle = P.roof; ctx.fillRect(x0, top, x1 - x0, bottom - top);
      ctx.fillStyle = P.roofTop; ctx.fillRect(x0, top, x1 - x0, 7);
      ctx.fillStyle = P.roofWin; for (let y = top + 26; y < bottom; y += 30) ctx.fillRect(x0 + (g.x0 >= x0 ? 10 : 0), y, x1 - x0 - (g.x0 >= x0 ? 10 : 0) - (g.x1 <= x1 ? 10 : 0), 10);
      if (g.x0 >= x0) { ctx.fillStyle = "rgba(0,0,0,0.18)"; ctx.fillRect(g.x0, top, 3, bottom - top); }
    }
  }
}

export { SHOTS };

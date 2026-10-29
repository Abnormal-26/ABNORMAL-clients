/**
 * Drop Shot pieces: the eight tiers as little brand objects, drawn once into cached sprites.
 * Tiers 1–5 are the five shots as flat brand dots with an ink + white icon for their label line
 * (jetpack, light bulb, sneaker, sock, moon). 6 is a brushed "Ryde:" coin, 7 the pastel "Rhythm"
 * orb, 8 "Your Day" (the five-moment brand wheel).
 */
import { SHOTS, FONT, INK, roundRect, drawWordmark } from "../shared/brand.js";

const S = SHOTS;
export const TIERS = [
  { ...S[0], tier: 1, label: "Energy", short: "ENERGY", fx: [S[0].color, S[0].light, "#FFC845"] },
  { ...S[1], tier: 2, label: "Focus", short: "FOCUS", fx: [S[1].color, S[1].light, "#FFFFFF"] },
  { ...S[2], tier: 3, label: "Exercise", short: "EXERCISE", fx: [S[2].color, S[2].light, "#FFFFFF"] },
  { ...S[3], tier: 4, label: "Relax", short: "RELAX", fx: [S[3].color, S[3].light, "#FFFFFF"] },
  { ...S[4], tier: 5, label: "Sleep", short: "SLEEP", fx: [S[4].color, S[4].light, "#FFFFFF"] },
  { id: "coin", tier: 6, name: "RYDE: COIN", short: "RYDE:", label: "Ryde: coin", color: "#BFC2C7", dark: "#8E9196", light: "#F1F2F4", tag: "small enough to fit in your pocket", fx: ["#D9DBDE", "#A9ACB1", INK] },
  { id: "orb", tier: 7, name: "RHYTHM", short: "RHYTHM", label: "Rhythm", color: "#E7C9EE", dark: "#B79BD6", light: "#FFF1F8", tag: "you've found your rhythm", fx: ["#FFC9A8", "#C9B6F5", "#B8EBDD", "#FFB8D6", "#B9D4FA"] },
  { id: "day", tier: 8, name: "YOUR DAY", short: "YOUR DAY", label: "Your Day", color: "#FFFFFF", dark: "#D4D0CA", light: "#FFFFFF", tag: "big enough to change your day", fx: SHOTS.map((s) => s.color) },
];
export const WELLBEING = { tier: 9, short: "WELLBEING", label: "Wellbeing In One Shot.", fx: SHOTS.map((s) => s.color) };
export const tierInfo = (t) => (t >= 9 ? WELLBEING : TIERS[Math.max(1, Math.min(8, t)) - 1]);

// ---------- icons (unit space: the dot's radius is 1) ----------
const WHITE = "#FFFFFF";
function jetpack(c) {
  c.translate(0, -0.06);
  c.fillStyle = INK; c.strokeStyle = INK; c.lineCap = "round";
  // carry handle + straps make it read as a pack, not binoculars
  c.lineWidth = 0.075; c.beginPath(); c.arc(0, -0.34, 0.12, Math.PI, 0); c.stroke();
  roundRect(c, -0.37, -0.36, 0.28, 0.58, 0.14); c.fill();
  roundRect(c, 0.09, -0.36, 0.28, 0.58, 0.14); c.fill();
  roundRect(c, -0.14, -0.38, 0.28, 0.5, 0.07); c.fill();        // pack body between the tanks
  c.fillStyle = "#FFC845"; roundRect(c, -0.07, -0.24, 0.14, 0.09, 0.03); c.fill();   // a little yellow dial
  for (const x of [-0.23, 0.23]) {
    c.fillStyle = INK;
    c.beginPath(); c.moveTo(x - 0.09, 0.21); c.lineTo(x + 0.09, 0.21); c.lineTo(x + 0.06, 0.29); c.lineTo(x - 0.06, 0.29); c.closePath(); c.fill();
    c.fillStyle = "#FFC845";                               // flame in Focus yellow
    c.beginPath(); c.moveTo(x, 0.31); c.quadraticCurveTo(x - 0.13, 0.46, x, 0.66); c.quadraticCurveTo(x + 0.13, 0.46, x, 0.31); c.fill();
    c.fillStyle = WHITE;
    c.beginPath(); c.moveTo(x, 0.34); c.quadraticCurveTo(x - 0.05, 0.43, x, 0.52); c.quadraticCurveTo(x + 0.05, 0.43, x, 0.34); c.fill();
  }
  c.fillStyle = "rgba(255,255,255,0.5)";
  roundRect(c, -0.32, -0.28, 0.06, 0.32, 0.03); c.fill();
  roundRect(c, 0.27, -0.28, 0.06, 0.32, 0.03); c.fill();
}
function bulb(c) {
  c.translate(0, 0.07);
  c.lineJoin = "round"; c.lineCap = "round";
  // rays
  c.strokeStyle = INK; c.lineWidth = 0.085;
  for (const a of [-90, -140, -40]) { const r = (a * Math.PI) / 180; c.beginPath(); c.moveTo(Math.cos(r) * 0.46, -0.12 + Math.sin(r) * 0.46); c.lineTo(Math.cos(r) * 0.6, -0.12 + Math.sin(r) * 0.6); c.stroke(); }
  // glass
  c.beginPath(); c.arc(0, -0.12, 0.31, (125 * Math.PI) / 180, (415 * Math.PI) / 180); c.lineTo(0.12, 0.22); c.lineTo(-0.12, 0.22); c.closePath();
  c.fillStyle = WHITE; c.fill(); c.lineWidth = 0.08; c.stroke();
  // filament
  c.lineWidth = 0.06; c.beginPath(); c.moveTo(-0.07, 0.16); c.lineTo(-0.07, 0.02); c.lineTo(0, -0.06); c.lineTo(0.07, 0.02); c.lineTo(0.07, 0.16); c.stroke();
  // screw base
  c.fillStyle = INK; roundRect(c, -0.14, 0.26, 0.28, 0.075, 0.035); c.fill(); roundRect(c, -0.105, 0.36, 0.21, 0.075, 0.035); c.fill();
}
function sneaker(c) {
  c.translate(-0.01, 0.02);
  c.fillStyle = INK;
  c.beginPath();
  c.moveTo(-0.5, 0.14); c.lineTo(0.5, 0.14);
  c.quadraticCurveTo(0.58, 0.12, 0.54, 0.03);
  c.quadraticCurveTo(0.48, -0.05, 0.3, -0.07);
  c.lineTo(0.06, -0.14);
  c.quadraticCurveTo(-0.04, -0.3, -0.19, -0.33);
  c.lineTo(-0.27, -0.24);
  c.quadraticCurveTo(-0.37, -0.22, -0.45, -0.33);
  c.quadraticCurveTo(-0.55, -0.1, -0.5, 0.14);
  c.closePath(); c.fill();
  // sole
  c.fillStyle = WHITE; roundRect(c, -0.53, 0.13, 1.1, 0.13, 0.065); c.fill();
  c.fillStyle = INK; roundRect(c, -0.5, 0.215, 1.04, 0.05, 0.025); c.fill();
  // laces
  c.strokeStyle = WHITE; c.lineWidth = 0.06; c.lineCap = "round";
  for (const [x, y] of [[0.06, -0.06], [-0.04, -0.13], [-0.13, -0.2]]) { c.beginPath(); c.moveTo(x - 0.05, y - 0.06); c.lineTo(x + 0.06, y + 0.05); c.stroke(); }
  // heel stripe
  c.beginPath(); c.moveTo(-0.38, -0.12); c.quadraticCurveTo(-0.3, 0.0, -0.36, 0.08); c.stroke();
}
function sock(c) {
  c.translate(-0.14, -0.02);
  const p = new Path2D();
  p.moveTo(-0.2, -0.48); p.lineTo(0.13, -0.48); p.lineTo(0.13, 0.04);
  p.lineTo(0.37, 0.1); p.quadraticCurveTo(0.54, 0.14, 0.52, 0.29); p.quadraticCurveTo(0.5, 0.44, 0.32, 0.44);
  p.lineTo(0.0, 0.44); p.quadraticCurveTo(-0.22, 0.44, -0.21, 0.2); p.closePath();
  c.fillStyle = WHITE; c.fill(p);
  c.save(); c.clip(p);
  c.fillStyle = INK;
  c.fillRect(-0.3, -0.5, 0.6, 0.075); c.fillRect(-0.3, -0.38, 0.6, 0.075);   // cuff stripes
  c.beginPath(); c.arc(0.45, 0.3, 0.17, 0, Math.PI * 2); c.fill();          // toe
  c.beginPath(); c.arc(-0.2, 0.4, 0.17, 0, Math.PI * 2); c.fill();          // heel
  c.restore();
}
function moon(c) {
  c.translate(-0.02, 0.02);
  c.save();
  const cut = new Path2D(); cut.rect(-2, -2, 4, 4); cut.arc(0.17, -0.13, 0.33, 0, Math.PI * 2);
  c.clip(cut, "evenodd");
  c.fillStyle = WHITE; c.beginPath(); c.arc(-0.03, 0.02, 0.42, 0, Math.PI * 2); c.fill();
  c.restore();
  const star = (x, y, s) => { c.beginPath(); c.moveTo(x, y - s); c.quadraticCurveTo(x, y, x + s, y); c.quadraticCurveTo(x, y, x, y + s); c.quadraticCurveTo(x, y, x - s, y); c.quadraticCurveTo(x, y, x, y - s); c.fill(); };
  c.fillStyle = WHITE; star(0.27, 0.12, 0.13); star(0.42, -0.24, 0.07);
}
const ICONS = [jetpack, bulb, sneaker, sock, moon];

// ---------- piece renderers (centred at 0,0, radius r px) ----------
function dot(c, t, r) {
  const s = TIERS[t - 1];
  c.fillStyle = s.color; c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.fill();
  // gentle form: lit from the top-left, the way the bottles are shot
  let g = c.createRadialGradient(-0.4 * r, -0.5 * r, 0, -0.4 * r, -0.5 * r, 1.3 * r);
  g.addColorStop(0, "rgba(255,255,255,0.28)"); g.addColorStop(0.55, "rgba(255,255,255,0)");
  c.fillStyle = g; c.fill();
  g = c.createRadialGradient(0.15 * r, 0.25 * r, 0.6 * r, 0, 0, r * 1.05);
  g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,0.13)");
  c.fillStyle = g; c.fill();
  c.save(); c.scale(r, r); ICONS[t - 1](c); c.restore();
}
function coin(c, r, k) {
  const disc = () => { c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); };
  disc();
  let g;
  if (c.createConicGradient) {
    g = c.createConicGradient(-0.5, 0, 0);
    [["#E9EBEE", 0], ["#B5B9BF", 0.12], ["#F8F9FA", 0.26], ["#C2C5CA", 0.38], ["#EEEFF1", 0.5], ["#B0B4BA", 0.63], ["#F6F7F8", 0.76], ["#BEC1C6", 0.88], ["#E9EBEE", 1]].forEach(([col, p]) => g.addColorStop(p, col));
  } else { g = c.createLinearGradient(-r, -r, r, r); g.addColorStop(0, "#F4F5F6"); g.addColorStop(0.5, "#C6C9CD"); g.addColorStop(1, "#EEF0F1"); }
  c.fillStyle = g; c.fill();
  // lathe rings
  c.lineWidth = Math.max(0.5, r * 0.012);
  for (let i = 0; i < 16; i++) { c.strokeStyle = i % 2 ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.045)"; c.beginPath(); c.arc(0, 0, r * (0.12 + i * 0.05), 0, Math.PI * 2); c.stroke(); }
  // bevelled rim
  c.lineWidth = r * 0.085; c.strokeStyle = "#A3A7AD"; c.beginPath(); c.arc(0, 0, r * 0.955, 0, Math.PI * 2); c.stroke();
  g = c.createLinearGradient(-r, -r, r, r); g.addColorStop(0, "rgba(255,255,255,0.95)"); g.addColorStop(0.5, "rgba(255,255,255,0.1)"); g.addColorStop(1, "rgba(255,255,255,0.7)");
  c.lineWidth = r * 0.035; c.strokeStyle = g; c.beginPath(); c.arc(0, 0, r * 0.89, 0, Math.PI * 2); c.stroke();
  c.lineWidth = Math.max(0.6, r * 0.018); c.strokeStyle = "rgba(0,0,0,0.25)"; c.beginPath(); c.arc(0, 0, r * 0.995, 0, Math.PI * 2); c.stroke();
  // wordmark
  c.font = `900 100px ${FONT}`; const kw = c.measureText("Ryde").width / 100 + 0.24;
  const size = (r * 1.22) / kw;
  drawWordmark(c, -(size * kw) / 2, size * 0.32, size, INK);
  if (size * 0.2 / k >= 12) { c.font = `700 ${size * 0.2}px ${FONT}`; c.fillStyle = INK; c.textAlign = "center"; c.fillText("your rhythm", size * 0.06, size * 0.62); }
}
function orb(c, r, k) {
  c.save();
  c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.clip();
  let g = c.createRadialGradient(-0.2 * r, -0.25 * r, 0, 0, 0, r);
  g.addColorStop(0, "#FFF6FB"); g.addColorStop(0.6, "#F3DDF0"); g.addColorStop(1, "#E2CDEF");
  c.fillStyle = g; c.fillRect(-r, -r, 2 * r, 2 * r);
  const blob = (x, y, rad, col, a = 0.9) => { const gg = c.createRadialGradient(x * r, y * r, 0, x * r, y * r, rad * r); gg.addColorStop(0, col); gg.addColorStop(1, col.replace(/^#(..)(..)(..)$/, (m, a1, b1, c1) => `rgba(${parseInt(a1, 16)},${parseInt(b1, 16)},${parseInt(c1, 16)},0)`)); c.globalAlpha = a; c.fillStyle = gg; c.fillRect(-r, -r, 2 * r, 2 * r); };
  blob(-0.5, -0.4, 0.95, "#FFC6A3");
  blob(0.55, -0.35, 0.85, "#C7B2F6");
  blob(0.35, 0.55, 0.95, "#AEE8D8");
  blob(-0.45, 0.5, 0.8, "#B6D2FA");
  blob(0.05, 0.02, 0.55, "#FFB3D3", 0.7);
  c.globalAlpha = 1;
  // ripple rings (rhythm)
  c.lineWidth = Math.max(0.6, r * 0.016);
  for (let i = 1; i <= 4; i++) { c.strokeStyle = `rgba(255,255,255,${0.42 - i * 0.07})`; c.beginPath(); c.arc(0, 0, r * (0.2 + i * 0.17), 0, Math.PI * 2); c.stroke(); }
  // gloss
  g = c.createRadialGradient(-0.35 * r, -0.45 * r, 0, -0.35 * r, -0.45 * r, 0.6 * r);
  g.addColorStop(0, "rgba(255,255,255,0.75)"); g.addColorStop(1, "rgba(255,255,255,0)");
  c.fillStyle = g; c.fillRect(-r, -r, 2 * r, 2 * r);
  c.restore();
  c.lineWidth = Math.max(0.8, r * 0.03); c.strokeStyle = "rgba(255,255,255,0.85)"; c.beginPath(); c.arc(0, 0, r * 0.97, 0, Math.PI * 2); c.stroke();
  const fs = r * 0.27;
  if (fs / k >= 12) { c.fillStyle = INK; c.textAlign = "center"; c.textBaseline = "middle"; c.font = `900 ${fs}px ${FONT}`; c.fillText("rhythm", 0, fs * 0.08); }
}
function wheel(c, r, k) {
  c.fillStyle = "#FFFFFF"; c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.fill();
  const fs = r * 0.12, ringText = fs / k >= 12;
  const cr = ringText ? 0.3 : 0.335, cd = cr / 0.64;            // slight overlap between neighbours
  const pos = SHOTS.map((s, i) => { const a = -Math.PI / 2 + (i * Math.PI * 2) / 5; return [Math.cos(a) * cd * r, Math.sin(a) * cd * r]; });
  const circ = (i) => { c.beginPath(); c.arc(pos[i][0], pos[i][1], cr * r, 0, Math.PI * 2); };
  SHOTS.forEach((s, i) => { c.fillStyle = s.color; circ(i); c.fill(); });
  // close the chain: Energy back over Sleep, but still under Focus
  c.save(); const cl = new Path2D(); cl.rect(-r, -r, 2 * r, 2 * r); cl.arc(pos[1][0], pos[1][1], cr * r, 0, Math.PI * 2); c.clip(cl, "evenodd");
  c.fillStyle = SHOTS[0].color; circ(0); c.fill(); c.restore();
  c.lineWidth = Math.max(1, r * 0.035); c.strokeStyle = "#D4D0CA"; c.beginPath(); c.arc(0, 0, r * 0.975, 0, Math.PI * 2); c.stroke();
  const hub = (cd - cr) * r * 2;                                 // the white hole in the middle
  c.font = `900 100px ${FONT}`; const kw = c.measureText("Ryde").width / 100 + 0.24, ws = (hub * 0.86) / kw;
  if (ws / k >= 9) drawWordmark(c, -(ws * kw) / 2, ws * 0.33, ws, INK);
  if (ringText) {
    c.fillStyle = INK; c.font = `800 ${fs}px ${FONT}`; c.textAlign = "center"; c.textBaseline = "middle";
    const text = "YOUR DAY \u2022 YOUR RHYTHM \u2022 YOUR DAY \u2022 YOUR RHYTHM \u2022 ";
    const rr = r * 0.84, total = c.measureText(text).width, scale = (Math.PI * 2 * rr) / total;
    let ang = -Math.PI / 2;
    for (const ch of text) {
      const w = c.measureText(ch).width * scale; ang += w / rr / 2;
      c.save(); c.rotate(ang); c.translate(0, -rr); c.scale(scale, 1); c.fillText(ch, 0, 0); c.restore();
      ang += w / rr / 2;
    }
  }
}

/** Draw tier t at the origin with radius r (px). k = device pixels per CSS px (text under 12 CSS px is dropped). */
export function drawPiece(c, t, r, k = 1) {
  c.save();
  if (t <= 5) dot(c, t, r); else if (t === 6) coin(c, r, k); else if (t === 7) orb(c, r, k); else wheel(c, r, k);
  c.restore();
}

// sprite cache: key by tier + device-pixel radius
const cache = new Map();
export function sprite(t, r, dpr) {
  const pr = Math.max(2, Math.round(r * dpr)), key = t * 100000 + pr;
  let cv = cache.get(key);
  if (!cv) {
    const size = pr * 2 + 4;
    // a plain canvas, not OffscreenCanvas: blitting an OffscreenCanvas into the 2D game canvas is far slower in Chromium
    cv = Object.assign(document.createElement("canvas"), { width: size, height: size });
    const c = cv.getContext("2d");
    c.translate(size / 2, size / 2); drawPiece(c, t, pr, dpr);
    cv.pr = pr;
    cache.set(key, cv);
    if (cache.size > 120) cache.delete(cache.keys().next().value);
  }
  return cv;
}
export function clearSprites() { cache.clear(); }

/**
 * Blit tier t at (x,y), radius r (CSS px), rotated a. `base` is the radius the sprite is rendered at:
 * pass the piece's resting size so pops/growth/squash just scale one cached bitmap instead of
 * re-rendering the artwork every frame. Sprites are cached in 6% size steps.
 */
const quant = (base, dpr) => Math.pow(1.06, Math.ceil(Math.log(Math.max(1, base * dpr)) / Math.log(1.06))) / dpr;
/** Render a sprite ahead of time so the first merge into a big tier doesn't hitch. */
export function warm(t, base, dpr) { sprite(t, quant(base, dpr), dpr); }
export function blit(ctx, t, x, y, r, dpr, a = 0, alpha = 1, base = r) {
  const q = quant(base, dpr);
  const cv = sprite(t, q, dpr), s = r / cv.pr, half = cv.width / 2;
  ctx.save(); ctx.translate(x, y); if (a) ctx.rotate(a); if (alpha < 1) ctx.globalAlpha *= alpha;
  ctx.drawImage(cv, -half * s, -half * s, cv.width * s, cv.height * s);
  ctx.restore();
}

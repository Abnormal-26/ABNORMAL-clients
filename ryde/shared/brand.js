/**
 * Ryde brand kit for the game prototypes. Colours are sampled from au.ryde.com; type is
 * Inter Tight standing in for Helvetica Now Display / RydeSans (both licensed).
 * Everything here is drawn in canvas so it stays crisp and light: no image downloads.
 */
export const INK = "#131313";
export const PAPER = "#FFFFFF";
export const STONE = "#D4D0CA";   // the warm grey behind the hero bottles
export const STONE_DARK = "#B9B4AD";
export const FONT = '"Inter Tight", "Helvetica Neue", Helvetica, Arial, sans-serif';

// The range, in the order of a day (the brand wheel runs Energy → Focus → Exercise → Relax → Sleep).
export const SHOTS = [
  { id: "energy",   name: "ENERGY",   color: "#EE3831", dark: "#B8241F", light: "#FF7A6E", flavour: "Tropical",   tag: "& a jetpack",            moment: "Jump start",  ingredients: ["Guarana Seeds", "Taurine", "Ginseng Extract", "Vitamin B1 + B6"] },
  { id: "focus",    name: "FOCUS",    color: "#FFC845", dark: "#D99A12", light: "#FFE08F", flavour: "Orange",     tag: "& a light bulb moment",  moment: "Head down",   ingredients: ["L-Theanine", "Guarana Seeds", "Ginseng Extract", "Vitamin B2 + B7"] },
  { id: "exercise", name: "EXERCISE", color: "#06AF9A", dark: "#047E6F", light: "#5FD8C6", flavour: "Apple",      tag: "& new sneakers",         moment: "Get moving",  ingredients: ["Guarana Seeds", "Beetroot", "Magnesium", "Vitamin B1 + B2"] },
  { id: "relax",    name: "RELAX",    color: "#6A9EF0", dark: "#3E6FC4", light: "#A9C8F7", flavour: "Raspberry",  tag: "& comfy socks",          moment: "Unwind",      ingredients: ["Lemon Balm", "L-Theanine", "Chamomile", "Ginseng Extract"] },
  { id: "sleep",    name: "SLEEP",    color: "#8564AB", dark: "#5C4183", light: "#B79BD6", flavour: "Blackberry", tag: "& sweet dreams",         moment: "Lights out",  ingredients: ["L-Theanine", "Magnesium", "Passion Flower", "Holy Basil"] },
];
export const SHOT = Object.fromEntries(SHOTS.map((s) => [s.id, s]));

/** Make sure the self-hosted display font is ready for canvas (ui.css declares it). Resolves after 2.5s regardless. */
export function loadFont() {
  const want = ["900 20px \"Inter Tight\"", "800 20px \"Inter Tight\"", "700 20px \"Inter Tight\"", "600 20px \"Inter Tight\""];
  return Promise.race([
    Promise.all(want.map((f) => document.fonts.load(f))).catch(() => {}),
    new Promise((r) => setTimeout(r, 2500)),
  ]);
}

/** The "Ryde:" wordmark. x,y is the left of the baseline. Returns its width. */
export function drawWordmark(ctx, x, y, size, color = INK, withTagline = false) {
  ctx.save();
  ctx.fillStyle = color; ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
  ctx.font = `900 ${size}px ${FONT}`;
  const w = ctx.measureText("Ryde").width;
  ctx.fillText("Ryde", x, y);
  // the colon is two round dots, a touch heavier than a typed colon
  const r = size * 0.085, cx = x + w + size * 0.13;
  ctx.beginPath(); ctx.arc(cx, y - size * 0.47, r, 0, Math.PI * 2); ctx.arc(cx, y - size * 0.1, r, 0, Math.PI * 2); ctx.fill();
  if (withTagline) { ctx.font = `700 ${size * 0.2}px ${FONT}`; ctx.fillText("your rhythm", x + w * 0.42, y + size * 0.24); }
  ctx.restore();
  return w + size * 0.24;
}

function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
export { rr as roundRect };

function metal(ctx, x0, x1, stops) {
  const g = ctx.createLinearGradient(x0, 0, x1, 0);
  stops.forEach(([t, c]) => g.addColorStop(t, c));
  return g;
}

/**
 * A Ryde shot bottle, drawn upright and centred on (cx, cy), h tall (width ≈ 0.44h).
 * opts: { tilt: radians, label: true|false (small text), shadow: true|false, alpha }
 * The silver body, coloured metallic cap+shoulder, "A shot of > NAME" and the wordmark.
 */
export function drawBottle(ctx, cx, cy, h, id, opts = {}) {
  const s = SHOT[id] || SHOTS[0];
  const w = h * 0.44, top = -h / 2, bot = h / 2;
  const capW = w * 0.7, capH = h * 0.2, neckY = top + capH, shoulderY = top + h * 0.33, bandY = top + h * 0.43;
  ctx.save();
  ctx.translate(cx, cy); if (opts.tilt) ctx.rotate(opts.tilt);
  if (opts.alpha != null) ctx.globalAlpha = opts.alpha;
  if (opts.shadow !== false) { ctx.fillStyle = "rgba(0,0,0,0.16)"; ctx.beginPath(); ctx.ellipse(w * 0.06, bot + h * 0.02, w * 0.55, h * 0.04, 0, 0, Math.PI * 2); ctx.fill(); }
  // body silhouette: cylinder, rounded shoulder into the neck
  const body = new Path2D();
  body.moveTo(-capW / 2, neckY);
  body.bezierCurveTo(-capW / 2, neckY + h * 0.05, -w / 2, shoulderY - h * 0.07, -w / 2, shoulderY);
  body.lineTo(-w / 2, bot - w * 0.12); body.quadraticCurveTo(-w / 2, bot, -w / 2 + w * 0.12, bot);
  body.lineTo(w / 2 - w * 0.12, bot); body.quadraticCurveTo(w / 2, bot, w / 2, bot - w * 0.12);
  body.lineTo(w / 2, shoulderY);
  body.bezierCurveTo(w / 2, shoulderY - h * 0.07, capW / 2, neckY + h * 0.05, capW / 2, neckY);
  body.closePath();
  ctx.fillStyle = metal(ctx, -w / 2, w / 2, [[0, "#8E9095"], [0.18, "#D9DADD"], [0.36, "#F6F6F7"], [0.55, "#E3E4E6"], [0.8, "#B3B5B9"], [1, "#7D7F84"]]);
  ctx.fill(body);
  // coloured shoulder band (clipped to the body)
  ctx.save(); ctx.clip(body);
  ctx.fillStyle = metal(ctx, -w / 2, w / 2, [[0, s.dark], [0.3, s.light], [0.5, s.color], [0.85, s.dark], [1, s.dark]]);
  ctx.fillRect(-w, neckY - 1, w * 2, bandY - neckY + 1);
  ctx.restore();
  // cap with ridges
  ctx.fillStyle = metal(ctx, -capW / 2, capW / 2, [[0, s.dark], [0.25, s.light], [0.45, s.color], [0.8, s.dark], [1, s.dark]]);
  rr(ctx, -capW / 2, top, capW, capH, capW * 0.08); ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.18)"; ctx.lineWidth = Math.max(0.6, w * 0.012);
  const ridges = Math.max(6, Math.round(capW / Math.max(2.2, h * 0.03)));
  for (let i = 1; i < ridges; i++) { const x = -capW / 2 + (capW * i) / ridges; ctx.beginPath(); ctx.moveTo(x, top + capH * 0.12); ctx.lineTo(x, top + capH * 0.92); ctx.stroke(); }
  ctx.fillStyle = "rgba(255,255,255,0.35)"; ctx.fillRect(-capW / 2, top, capW, capH * 0.08);
  // label text
  ctx.fillStyle = INK; ctx.textAlign = "left";
  if (opts.label !== false && h >= 70) {
    ctx.textBaseline = "alphabetic";
    ctx.font = `600 ${h * 0.034}px ${FONT}`; ctx.fillText("A shot of >", -w * 0.4, bandY - h * 0.058);
    ctx.font = `900 ${h * 0.054}px ${FONT}`; ctx.fillText(s.name, -w * 0.4, bandY - h * 0.014);
  }
  const wm = h * 0.115;
  drawWordmark(ctx, -w * 0.4, bandY + h * 0.24, wm, INK);
  if (opts.label !== false && h >= 110) {
    ctx.font = `700 ${h * 0.022}px ${FONT}`; ctx.fillText("your rhythm", -w * 0.4 + wm * 1.05, bandY + h * 0.27);
    ctx.font = `600 ${h * 0.026}px ${FONT}`; ctx.fillText("60 mL", -w * 0.12, bot - h * 0.05);
  }
  ctx.restore();
}

/** Flat brand dot (the circles on the site's daily-moments wheel). */
export function drawDot(ctx, x, y, r, id) { const s = SHOT[id] || SHOTS[0]; ctx.fillStyle = s.color; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }

/** Pill with text, like the site's black "Where to Buy" buttons. Returns its width. */
export function pill(ctx, text, x, y, size, { fill = INK, ink = PAPER, align = "center", weight = 800 } = {}) {
  ctx.save(); ctx.font = `${weight} ${size}px ${FONT}`; ctx.textBaseline = "middle";
  const tw = ctx.measureText(text).width, w = tw + size * 1.6, h = size * 2.1;
  const x0 = align === "center" ? x - w / 2 : align === "right" ? x - w : x;
  ctx.fillStyle = fill; rr(ctx, x0, y - h / 2, w, h, h / 2); ctx.fill();
  ctx.fillStyle = ink; ctx.textAlign = "left"; ctx.fillText(text, x0 + size * 0.8, y + 1);
  ctx.restore(); return w;
}

/** Shrink a font until text fits maxW. Sets ctx.font and returns the size used. */
export function fitFont(ctx, weight, size, text, maxW, min = 10) {
  ctx.font = `${weight} ${size}px ${FONT}`;
  const w = ctx.measureText(text).width;
  if (w > maxW) { size = Math.max(min, Math.floor(size * maxW / w)); ctx.font = `${weight} ${size}px ${FONT}`; }
  return size;
}

/** Safe-area insets in CSS px (iPhone notch / home bar). */
export function safeInsets() {
  let p = document.getElementById("__ins");
  if (!p) { p = document.createElement("div"); p.id = "__ins"; p.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)"; document.body.appendChild(p); }
  const cs = getComputedStyle(p);
  return { t: parseFloat(cs.paddingTop) || 0, r: parseFloat(cs.paddingRight) || 0, b: parseFloat(cs.paddingBottom) || 0, l: parseFloat(cs.paddingLeft) || 0 };
}

/** Stop iOS turning game touches into zoom, selection, callouts or page scroll. Call once with the play surface. */
export function lockTouch(el, isPlaying) {
  for (const ev of ["gesturestart", "gesturechange", "gestureend"]) document.addEventListener(ev, (e) => { if (isPlaying()) e.preventDefault(); }, { passive: false });
  for (const ev of ["touchstart", "touchmove"]) el.addEventListener(ev, (e) => { if (isPlaying()) e.preventDefault(); }, { passive: false });
  el.addEventListener("contextmenu", (e) => e.preventDefault());
  el.style.touchAction = "none"; el.style.webkitUserSelect = "none"; el.style.userSelect = "none"; el.style.webkitTouchCallout = "none";
}

export function buzz(ms) { try { if (navigator.vibrate && matchMedia("(pointer: coarse)").matches) navigator.vibrate(ms); } catch {} }

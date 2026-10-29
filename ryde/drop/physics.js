/**
 * Drop Shot physics: a small, stable 2D circle solver for a merge puzzle.
 *
 * Modelled on Box2D v3's "soft step" solver, which is what makes tall stacks sit dead still:
 *   - fixed step, split into substeps (8 by default)
 *   - per substep: integrate velocity → warm start → solve contacts with a soft (spring-damper)
 *     position bias → integrate position → "relax" pass without bias (removes the push-out
 *     velocity, so corrections never turn into bounce/jitter)
 *   - restitution applied once after the substeps, only for genuine impacts
 *   - accumulated impulses are carried frame to frame (warm starting) per contact key
 *   - speculative contacts (positive separation) stop fast pieces before they touch → no tunnelling
 *   - island sleeping: a connected pile only sleeps when every piece in it is still, so nothing
 *     can float when a support moves; new touches / merges wake islands again
 *
 * World units ("u"): the bottle interior is W wide, y grows downward, y = 0 is the mouth and
 * y = H the inside bottom. Side walls run up forever, so nothing can escape sideways.
 * No DOM in here, so it can be stress-tested in Node.
 */

const TAU = Math.PI * 2;

function makeSoft(hz, zeta, h) {
  if (hz === 0) return { biasRate: 0, massScale: 1, impulseScale: 0 };
  const omega = TAU * hz, a1 = 2 * zeta + h * omega, a2 = h * omega * a1, a3 = 1 / (1 + a2);
  return { biasRate: omega / a1, massScale: a2 * a3, impulseScale: a3 };
}

// contact kinds
const PAIR = 0, WALL_L = 1, WALL_R = 2, FLOOR = 3, CORNER_L = 4, CORNER_R = 5;

export function createWorld(cfg = {}) {
  const P = Object.assign({
    W: 10, H: 14, corner: 1.2,       // interior size, bottom corner radius
    gravity: 45, substeps: 8, dt: 1 / 60,
    friction: 0.3, wallFriction: 0.2, restitution: 0.12, restThreshold: 1.6,
    rolling: 0.06,                    // rolling resistance (× normal impulse × radius)
    linDamp: 0.08, angDamp: 0.6,
    hertz: 100, zeta: 10, pushMax: 5, // contact softness (stiff, capped at 0.25×substep rate) + max push-out speed
    sleepSpeed: 0.06, sleepTime: 0.45,
    massExp: 1.7,                     // mass ∝ r^massExp (gentler than area so big pieces don't crush small ones)
    maxSpeed: 38,
    mergeGap: 0.05,                   // two same-tier pieces closer than this are "touching"
    jam: 0.06,                        // overlap beyond this counts as a jam (see geom)
    magnet: 7, magnetRange: 0.11,     // same-tier pieces within ~3–4 px drift together (u/s²); further apart stays a miss
    pushFresh: 16, freshAge: 0.35,    // a just-merged piece shoves what it engulfed out this fast
  }, cfg);

  const bodies = [];
  let nextId = 1, warm = new Map(), islandSeq = 1, time = 0;
  const events = [];                  // impacts since last drain: {a, b, speed, nx, ny}

  function add({ x, y, r, rTarget, tier = 1, vx = 0, vy = 0, w = 0, a = 0, data = null }) {
    const rt = rTarget || r;
    const m = Math.pow(rt, P.massExp), I = 0.5 * m * rt * rt;
    const b = { id: nextId++, tier, x, y, a, vx, vy, w, r, rT: rt, m, invM: 1 / m, invI: 1 / I,
      px: x, py: y, pa: a, asleep: false, sleepT: 0, island: 0, landed: false, born: time, contactT: 0, data };
    bodies.push(b);
    return b;
  }
  function remove(b) { const i = bodies.indexOf(b); if (i >= 0) bodies.splice(i, 1); b.asleep = false; b.removed = true; wakeAll(); }
  function wakeAll() { for (const b of bodies) { b.asleep = false; b.sleepT = 0; } }
  function wakeIsland(id) { if (!id) return; for (const b of bodies) if (b.asleep && b.island === id) { b.asleep = false; b.sleepT = 0; } }
  function wake(b) { if (b.asleep) wakeIsland(b.island); b.asleep = false; b.sleepT = 0; }

  // -- contact geometry (recomputed every substep from current positions) --
  function geom(c) {
    const A = c.A;
    switch (c.kind) {
      case PAIR: {
        const B = c.B, dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy);
        if (d < 1e-9) { c.nx = 0; c.ny = 1; } else { c.nx = dx / d; c.ny = dy / d; }
        c.s = d - A.r - B.r;
        // Jam relief. A freshly grown merge piece can wedge a row of pieces wider than the bottle; with
        // near-horizontal normals the solver only shoves sideways into the walls and the overlap never
        // clears. Real piles squeeze the smaller piece up and out, so on deep overlaps tilt the normal
        // to push the smaller (or, if equal, the lower) piece upward.
        // Only side-by-side squeezes count (normal within ~25° of horizontal): tilting a vertical
        // contact would let a piece above sink into the one below it.
        if (c.s < -P.jam && Math.abs(c.ny) < 0.42) {
          A.jam = B.jam = time;
          const k = Math.min(0.55, (-c.s - P.jam) * 3);
          const bUp = B.r < A.r - 1e-6 || (Math.abs(B.r - A.r) <= 1e-6 && B.y > A.y);
          c.ny += bUp ? -k : k;
          const l = Math.hypot(c.nx, c.ny); c.nx /= l; c.ny /= l;
        }
        return;
      }
      case WALL_L: c.nx = -1; c.ny = 0; c.s = A.x - A.r; return;
      case WALL_R: c.nx = 1; c.ny = 0; c.s = P.W - A.x - A.r; return;
      case FLOOR: c.nx = 0; c.ny = 1; c.s = P.H - A.y - A.r; return;
      case CORNER_L: case CORNER_R: {
        // the region the centre may occupy is the interior inset by r, whose corner radius is corner - r;
        // that corner's centre is (corner, H - corner) whatever r is.
        const rce = P.corner - A.r, cx = c.kind === CORNER_L ? P.corner : P.W - P.corner, cy = P.H - P.corner;
        const inRegion = rce > 1e-3 && A.y > cy && (c.kind === CORNER_L ? A.x < cx : A.x > cx);
        if (!inRegion) { c.s = 1e9; return; }
        const dx = A.x - cx, dy = A.y - cy, d = Math.hypot(dx, dy) || 1e-9;
        c.nx = dx / d; c.ny = dy / d; c.s = rce - d; return;
      }
    }
  }

  function makeContact(A, B, kind, key) {
    const c = { A, B, kind, key, nx: 0, ny: 1, s: 0, ni: 0, ti: 0, ri: 0, maxNi: 0, vn0: 0, wasTouching: false };
    const prev = warm.get(key);
    if (prev) { c.ni = prev.ni; c.ti = prev.ti; c.ri = prev.ri; c.wasTouching = prev.ni > 0; }
    const iA = A.invM, jA = A.invI, ra = A.r;
    if (B) {
      const rb = B.r;
      c.nm = 1 / (iA + B.invM);
      c.tm = 1 / (iA + B.invM + jA * ra * ra + B.invI * rb * rb);
      c.rm = 1 / (jA + B.invI);
      c.mu = P.friction; c.rr = P.rolling * (ra * rb) / (ra + rb);
    } else {
      c.nm = 1 / iA; c.tm = 1 / (iA + jA * ra * ra); c.rm = 1 / jA;
      c.mu = P.wallFriction; c.rr = P.rolling * ra;
    }
    geom(c);
    // relative normal velocity at the start of the step (for restitution + impact events)
    c.vn0 = B ? (B.vx - A.vx) * c.nx + (B.vy - A.vy) * c.ny : -(A.vx * c.nx + A.vy * c.ny);
    if (c.s > 0.02) { c.ni = 0; c.ti = 0; c.ri = 0; }   // not touching: nothing to warm start
    return c;
  }

  function gather(dt) {
    const out = [];
    const n = bodies.length;
    for (let i = 0; i < n; i++) {
      const A = bodies[i];
      const sa = Math.hypot(A.vx, A.vy) * dt;
      // walls (only for awake bodies)
      if (!A.asleep) {
        const m = 0.2 + sa;
        if (A.x - A.r < m) out.push(makeContact(A, null, WALL_L, A.id * 8 + 1));
        if (P.W - A.x - A.r < m) out.push(makeContact(A, null, WALL_R, A.id * 8 + 2));
        if (P.H - A.y - A.r < m) out.push(makeContact(A, null, FLOOR, A.id * 8 + 3));
        if (A.y > P.H - P.corner - m && A.r < P.corner) {
          if (A.x < P.corner + m) out.push(makeContact(A, null, CORNER_L, A.id * 8 + 4));
          if (A.x > P.W - P.corner - m) out.push(makeContact(A, null, CORNER_R, A.id * 8 + 5));
        }
      }
      for (let j = i + 1; j < n; j++) {
        const B = bodies[j];
        if (A.asleep && B.asleep) continue;
        let m = 0.2 + sa + Math.hypot(B.vx, B.vy) * dt;
        if (A.tier === B.tier) m = Math.max(m, P.magnetRange + 0.02);
        const dx = B.x - A.x, dy = B.y - A.y, rr = A.r + B.r + m;
        if (dx * dx + dy * dy > rr * rr) continue;
        // an awake piece touching, or closing in on, a sleeping pile wakes the pile. Mere proximity doesn't:
        // that used to let two neighbouring piles keep waking each other forever.
        if (A.asleep || B.asleep) {
          const d = Math.sqrt(dx * dx + dy * dy) || 1e-9, gap = d - A.r - B.r;
          const vn = ((B.vx - A.vx) * dx + (B.vy - A.vy) * dy) / d;            // < 0 = approaching
          if (gap > 0.01 && (vn > -0.05 || gap > -vn * dt * 2 + 0.01)) continue;
          if (A.asleep) wake(A); else wake(B);
        }
        const lo = A.id < B.id ? A : B, hi = lo === A ? B : A;
        out.push(makeContact(lo, hi, PAIR, 1e6 + lo.id * 65536 + hi.id));
      }
    }
    return out;
  }

  function warmStart(cs) {
    for (const c of cs) {
      const A = c.A, B = c.B;
      const tx = -c.ny, ty = c.nx;
      const Px = c.nx * c.ni + tx * c.ti, Py = c.ny * c.ni + ty * c.ti;
      const rAx = c.nx * A.r, rAy = c.ny * A.r;
      A.vx -= Px * A.invM; A.vy -= Py * A.invM; A.w -= A.invI * (rAx * Py - rAy * Px) + A.invI * c.ri;
      if (B) {
        const rBx = -c.nx * B.r, rBy = -c.ny * B.r;
        B.vx += Px * B.invM; B.vy += Py * B.invM; B.w += B.invI * (rBx * Py - rBy * Px) + B.invI * c.ri;
      }
    }
  }

  function solve(cs, h, useBias, soft, staticSoft) {
    const inv_h = 1 / h;
    for (const c of cs) {
      geom(c);
      if (c.s > 1e8) { if (c.ni) { /* left the corner region: drop it */ } continue; }
      const A = c.A, B = c.B;
      const sf = B ? soft : staticSoft;
      // ---- normal ----
      let bias = 0, massScale = 1, impulseScale = 0;
      if (c.s > 0) bias = c.s * inv_h;                      // speculative
      else if (useBias) {
        const fresh = time - A.born < P.freshAge || (B && time - B.born < P.freshAge);
        bias = Math.max(sf.biasRate * c.s, fresh ? -P.pushFresh : -P.pushMax); massScale = sf.massScale; impulseScale = sf.impulseScale;
      }
      let vn = B ? (B.vx - A.vx) * c.nx + (B.vy - A.vy) * c.ny : -(A.vx * c.nx + A.vy * c.ny);
      let imp = -c.nm * massScale * (vn + bias) - impulseScale * c.ni;
      const ni = Math.max(c.ni + imp, 0); imp = ni - c.ni; c.ni = ni; if (ni > c.maxNi) c.maxNi = ni;
      A.vx -= c.nx * imp * A.invM; A.vy -= c.ny * imp * A.invM;
      if (B) { B.vx += c.nx * imp * B.invM; B.vy += c.ny * imp * B.invM; }
      // ---- friction ----
      const tx = -c.ny, ty = c.nx;
      const rAx = c.nx * A.r, rAy = c.ny * A.r;
      let dvx = -(A.vx - A.w * rAy), dvy = -(A.vy + A.w * rAx);
      let rBx = 0, rBy = 0;
      if (B) { rBx = -c.nx * B.r; rBy = -c.ny * B.r; dvx += B.vx - B.w * rBy; dvy += B.vy + B.w * rBx; }
      const vt = dvx * tx + dvy * ty;
      const jammed = A.jam === time || (B && B.jam === time);
      const maxF = (jammed ? 0.05 : 1) * c.mu * c.ni;
      let ti = Math.min(maxF, Math.max(-maxF, c.ti - c.tm * vt));
      let dti = ti - c.ti; c.ti = ti;
      const Px = tx * dti, Py = ty * dti;
      A.vx -= Px * A.invM; A.vy -= Py * A.invM; A.w -= A.invI * (rAx * Py - rAy * Px);
      if (B) { B.vx += Px * B.invM; B.vy += Py * B.invM; B.w += B.invI * (rBx * Py - rBy * Px); }
      // ---- rolling resistance (lets piles come to rest instead of rolling forever) ----
      const dw = (B ? B.w : 0) - A.w;
      const maxR = c.rr * c.ni;
      const ri = Math.min(maxR, Math.max(-maxR, c.ri - c.rm * dw));
      const dri = ri - c.ri; c.ri = ri;
      A.w -= A.invI * dri; if (B) B.w += B.invI * dri;
    }
  }

  function restitution(cs) {
    if (P.restitution === 0) return;
    for (const c of cs) {
      if (c.vn0 > -P.restThreshold || c.maxNi === 0 || c.s > 1e8) continue;
      const A = c.A, B = c.B;
      const vn = B ? (B.vx - A.vx) * c.nx + (B.vy - A.vy) * c.ny : -(A.vx * c.nx + A.vy * c.ny);
      let imp = -c.nm * (vn + P.restitution * c.vn0);
      const ni = Math.max(c.ni + imp, 0); imp = ni - c.ni; c.ni = ni;
      A.vx -= c.nx * imp * A.invM; A.vy -= c.ny * imp * A.invM;
      if (B) { B.vx += c.nx * imp * B.invM; B.vy += c.ny * imp * B.invM; }
    }
  }

  // union-find for islands
  function islands(cs) {
    const idx = new Map(); bodies.forEach((b, i) => idx.set(b, i));
    const par = bodies.map((_, i) => i);
    const find = (i) => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
    for (const c of cs) if (c.B && (c.ni > 0 || c.s < 0.01)) { const a = find(idx.get(c.A)), b = find(idx.get(c.B)); if (a !== b) par[a] = b; }
    const groups = new Map();
    bodies.forEach((b, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(b); });
    return [...groups.values()];
  }

  /** Advance one fixed step. */
  function step(dt = P.dt) {
    time += dt;
    for (const b of bodies) { b.px = b.x; b.py = b.y; b.pa = b.a; }
    // grow freshly merged pieces (their push on neighbours is limited by pushMax, so it's a shove, not a blast)
    for (const b of bodies) if (b.r < b.rT) { b.r = Math.min(b.rT, b.r + b.rT * 3.2 * dt); wake(b); }

    const cs = gather(dt);
    // same-tier pieces sitting a hair apart look touching, so pull them together gently
    const mags = [];
    if (P.magnet > 0) for (const c of cs) {
      if (c.kind !== PAIR || c.A.tier !== c.B.tier || c.A.data?.noMerge || c.B.data?.noMerge) continue;
      if (c.s > 0 && c.s < P.magnetRange) mags.push(c);     // never wakes anything (that ping-pongs blocked pairs)
    }
    const n = P.substeps, h = dt / n;
    const hz = Math.min(P.hertz, 0.25 / h);
    const soft = makeSoft(hz, P.zeta, h), staticSoft = makeSoft(2 * hz, P.zeta, h);
    const ld = 1 / (1 + h * P.linDamp), ad = 1 / (1 + h * P.angDamp);
    const g = P.gravity, vmax = P.maxSpeed;
    for (let k = 0; k < n; k++) {
      for (const b of bodies) {
        if (b.asleep) continue;
        b.vy += g * h; b.vx *= ld; b.vy *= ld; b.w *= ad;
        const sp = Math.hypot(b.vx, b.vy); if (sp > vmax) { b.vx *= vmax / sp; b.vy *= vmax / sp; }
      }
      for (const c of mags) {
        geom(c); if (c.s <= 0) continue;
        const a = P.magnet * (0.4 + 0.6 * (1 - c.s / P.magnetRange)) * h, mA = c.A.m, mB = c.B.m, k = 1 / (mA + mB);
        if (!c.A.asleep) { c.A.vx += c.nx * a * mB * k * 2; c.A.vy += c.ny * a * mB * k * 2; }
        if (!c.B.asleep) { c.B.vx -= c.nx * a * mA * k * 2; c.B.vy -= c.ny * a * mA * k * 2; }
      }
      warmStart(cs);
      solve(cs, h, true, soft, staticSoft);
      for (const b of bodies) { if (b.asleep) continue; b.x += b.vx * h; b.y += b.vy * h; b.a += b.w * h; }
      solve(cs, h, false, soft, staticSoft);
    }
    restitution(cs);

    // keep impulses for next frame + emit impacts
    const nw = new Map();
    // sleeping piles aren't gathered, so carry their stored impulses over: when they wake they're still
    // holding each other up instead of sagging for a few frames (which used to wake the neighbours)
    for (const [k, v] of warm) if (v.A.asleep && !v.A.removed && (!v.B || (v.B.asleep && !v.B.removed))) nw.set(k, v);
    for (const c of cs) {
      nw.set(c.key, { ni: c.ni, ti: c.ti, ri: c.ri, A: c.A, B: c.B });
      if (c.s < -P.jam) { c.A.sleepT = -1; if (c.B) c.B.sleepT = -1; }   // still jammed: not allowed to sleep
      // a same-tier neighbour within magnet range: never let that pair fall asleep un-merged
      if (c.B && c.A.tier === c.B.tier && c.s < P.magnetRange) { c.A.sleepT = -1; c.B.sleepT = -1; }
      if (c.maxNi > 0) {
        c.A.landed = true; if (c.B) c.B.landed = true;
        c.A.contactT = time; if (c.B) c.B.contactT = time;
        if (!c.wasTouching && c.vn0 < -1.2) events.push({ a: c.A, b: c.B, speed: -c.vn0, nx: c.nx, ny: c.ny });
      }
    }
    warm = nw;

    // safety net: never let a non-finite value or a wall breach survive a frame
    for (const b of bodies) {
      if (!Number.isFinite(b.x + b.y + b.vx + b.vy + b.w + b.a)) { b.x = P.W / 2; b.y = -2; b.vx = b.vy = b.w = 0; b.a = 0; }
      if (b.x < b.r - 0.05) { b.x = b.r; if (b.vx < 0) b.vx = 0; }
      if (b.x > P.W - b.r + 0.05) { b.x = P.W - b.r; if (b.vx > 0) b.vx = 0; }
      if (b.y > P.H - b.r + 0.05) { b.y = P.H - b.r; if (b.vy > 0) b.vy = 0; }
    }

    // sleeping, per island
    const vs2 = P.sleepSpeed * P.sleepSpeed;
    for (const b of bodies) {
      if (b.asleep) continue;
      const v2 = b.vx * b.vx + b.vy * b.vy, rw = b.w * b.r;
      if (b.sleepT < 0) b.sleepT = 0;
      else if (v2 < vs2 && rw * rw < vs2 && b.r >= b.rT && b.landed) b.sleepT += dt; else b.sleepT = 0;
    }
    for (const g2 of islands(cs)) {
      if (g2.every((b) => b.asleep)) continue;
      let minT = Infinity; for (const b of g2) minT = Math.min(minT, b.asleep ? Infinity : b.sleepT);
      if (minT >= P.sleepTime) { const id = islandSeq++; for (const b of g2) { b.asleep = true; b.island = id; b.vx = b.vy = b.w = 0; } }
      else for (const b of g2) if (b.asleep) wake(b);
    }
  }

  /** Same-tier pairs that are touching right now (each body appears at most once). */
  function touchingPairs() {
    const out = [], used = new Set();
    for (let i = 0; i < bodies.length; i++) {
      const A = bodies[i]; if (used.has(A) || A.data?.noMerge) continue;
      for (let j = i + 1; j < bodies.length; j++) {
        const B = bodies[j]; if (used.has(B) || B.tier !== A.tier || B.data?.noMerge) continue;
        const d = Math.hypot(B.x - A.x, B.y - A.y);
        const gap = d - A.r - B.r;
        // touching, or resting a hair apart (inside magnet range) with nothing left to close the gap
        const resting = gap < P.magnetRange && Math.hypot(A.vx, A.vy) < 0.15 && Math.hypot(B.vx, B.vy) < 0.15;
        if (gap < P.mergeGap || resting) { out.push([A, B]); used.add(A); used.add(B); break; }
      }
    }
    return out;
  }

  /** Where would a circle of radius r dropped at x first touch something? Returns centre y. */
  function landingY(x, r, fromY) {
    let y = P.H - r;
    // bottom corners
    const rce = P.corner - r;
    if (rce > 0) {
      const cx = x < P.corner ? P.corner : x > P.W - P.corner ? P.W - P.corner : null;
      if (cx !== null) { const dx = x - cx; y = Math.min(y, P.H - P.corner + Math.sqrt(Math.max(0, rce * rce - dx * dx))); }
    }
    for (const b of bodies) {
      const dx = b.x - x, R = b.r + r; if (Math.abs(dx) >= R || b.y < fromY) continue;
      y = Math.min(y, b.y - Math.sqrt(R * R - dx * dx));
    }
    return y;
  }

  function drainEvents() { return events.splice(0, events.length); }

  return { P, bodies, add, remove, step, wake, wakeAll, touchingPairs, landingY, drainEvents, get time() { return time; }, get warmSize() { return warm.size; } };
}

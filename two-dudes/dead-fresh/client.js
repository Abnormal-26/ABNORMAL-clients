/* DEAD FRESH — Two Dudes. Office tower raycaster: floors, friendlies, bosses. */
const MAPS = {"A": ["########################", "#RRRRRR#...............#", "#R.P..R#..d...d...d....#", "#R....L#..f...........z#", "#R....L#..d...d...d....#", "#R....R#......f........#", "#R....R###D######......#", "#R....R#......#........#", "#RRRDRR#..d...#..d..d..#", "#......#..f...#........#", "#..p...#......#...z....#", "#......#......#..d..d..#", "####D###......#........#", "#......####D############", "#..d..d.......#..z.....#", "#.............#........#", "#..d..d...f...#...p....#", "#.............#........#", "#.......p.....#..f.....#", "#..d..d...z..........p.#", "#.............#........#", "#..d..d.......#...z....#", "#.............#........#", "########################"], "B": ["########################", "#KKKKKKKKKK#GGGGGGGGGGG#", "#K::::::::K#G.........G#", "#K:P....w.K#G.d..d..d.G#", "#K::::::::K#G.........G#", "#K::::::::D.G.f.......G#", "#K::::::::K#G.........G#", "#KKKK::KKKK#GGGGGDGGGGG#", "#....::....#...........#", "#.d..::..d.#..f........#", "#....::....#...........#", "#.f..::....#..z....p...#", "#....::....GGGGGDGGGGG.#", "#L...::....G.........G.#", "#L...::....G.d.....d.G.#", "#....::..z.G....f....G.#", "#....::....G.d.....d.G.#", "#p...::....GGGGGDGGGGG.#", "#......................#", "#..d..d..d..#...z......#", "#...........#..........#", "#..f........#....p.....#", "#.....z.....#.......z..#", "########################"], "C": ["########################", "#SSSSSSSSSSS#..........#", "#L_________S#..d..d..d.#", "#L_P_______S#..........#", "#S_________S#..f.......#", "#S_________.....d..d...#", "#S_________S#..........#", "#SSSSSDSSSSS#.....z....#", "#....._.....#..........#", "#..d.._..d..######D#####", "#....._.....#..........#", "#..f.._.....#..d..d..d.#", "#....._.....#..........#", "#####_.#####.....f.....#", "#...........#..........#", "#...........#..d..d..d.#", "#.p...z..p..#.....z....#", "#...........######D#####", "#....GGGGGDGGGGG.......#", "#....G.........G..p....#", "#....G..b......G.......#", "#....G.........G...z...#", "#....GGGGGGGDGGG.......#", "########################"]};

// ── net: the scoreboard. HTTP endpoint (meta df-board) when configured, else the room socket ──
const PID_KEY = "df:pid";
let PID = localStorage.getItem(PID_KEY) || localStorage.getItem("hf:game:playerId");
if (!PID) { PID = Math.random().toString(36).slice(2, 10); } localStorage.setItem(PID_KEY, PID);
const BOARD_URL = (document.querySelector('meta[name="df-board"]')?.content || "").trim();
let socket = null, retry = 0, view = null;
function connect() {
  if (BOARD_URL) return;
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  try { socket = new WebSocket(`${proto}//${location.host}/ws/board`); } catch { return; }
  socket.addEventListener("open", () => { retry = 0; socket.send(JSON.stringify({ type: "join", playerId: PID })); });
  socket.addEventListener("message", (e) => { if (e.data === "__pong") return; let m; try { m = JSON.parse(e.data); } catch { return; } if (m.type === "state") { view = m.view || null; renderBoards(); } });
  socket.addEventListener("close", () => { retry = Math.min(retry + 1, 6); setTimeout(connect, 500 * 2 ** (retry - 1)); });
}
function send(msg) { if (socket && socket.readyState === WebSocket.OPEN) { socket.send(JSON.stringify(msg)); return true; } return false; }
setInterval(() => { if (socket && socket.readyState === WebSocket.OPEN) socket.send("__ping"); }, 30000);
let boardBusy = false;
async function boardLoad() {
  if (!BOARD_URL || boardBusy) return; boardBusy = true;
  try { const r = await fetch(`${BOARD_URL}?pid=${encodeURIComponent(PID)}&t=${Date.now()}`, { cache: "no-store" }); const j = await r.json(); if (j && Array.isArray(j.top)) { view = j; renderBoards(); } }
  catch { if (!view) { view = { top: [], offline: true }; renderBoards(); } }
  boardBusy = false;
}
async function boardPost(entry) {
  const r = await fetch(BOARD_URL, { method: "POST", body: JSON.stringify({ ...entry, pid: PID }) });
  const j = await r.json(); if (!j || !j.ok) throw new Error(j && j.error || "post failed");
  return j;
}
connect(); boardLoad();
setInterval(() => { if (BOARD_URL && (!G || G.over)) boardLoad(); }, 30000);
const $ = (s) => document.querySelector(s);
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function boardHtml() {
  const top = view?.top || [];
  if (!top.length) return `<li class="empty">${view ? (view.offline ? "Scoreboard offline right now." : "No one has posted yet. Be the first.") : "Connecting…"}</li>`;
  return top.slice(0, 10).map((s, i) => `<li class="${s.you ? "you" : ""}"><span class="r">${i + 1}</span><span class="n">${esc(s.name)}</span><span class="rd">F${s.round}</span><span class="s">${s.score.toLocaleString()}</span></li>`).join("");
}
function renderBoards() { $("#startTop").innerHTML = boardHtml(); $("#endList").innerHTML = boardHtml(); }

// ── assets ────────────────────────────────────────────────────────────────
const IMG = {};
const NAMES = ["zombie_f", "zombie_w1", "zombie_w2", "tex_door", "fresh", "leaving", "hand", "stick", "charcoal", "sage", "kawakawa", "tee", "sixpack", "friend0", "friend1", "friend2", "friend_shocked", "boss_sales", "boss_cfo", "boss_ceo", "plane", "desk", "plant", "cooler",
  "tex_office", "tex_glass", "tex_kitchen", "tex_server", "tex_lift", "tex_wood", "floor_carpet", "floor_lino", "ceil_tiles"];
const TEXPIX = {};
let loaded = 0;
for (const n of NAMES) {
  const i = new Image(); i.src = `img/${n}.png`;
  const done = () => { if (n.startsWith("floor_") || n.startsWith("ceil_")) bakePix(n, i); loaded++; if (loaded === NAMES.length) $("#go").disabled = false; };
  i.onload = done; i.onerror = done; IMG[n] = i;
}
$("#go").disabled = true;
const TS = 64;
function bakePix(n, img) {
  const c = document.createElement("canvas"); c.width = c.height = TS; const x = c.getContext("2d");
  if (img.naturalWidth) x.drawImage(img, 0, 0, TS, TS); else { x.fillStyle = "#b9b094"; x.fillRect(0, 0, TS, TS); }
  TEXPIX[n] = new Uint32Array(x.getImageData(0, 0, TS, TS).data.buffer);
}
function darkPix(src, k) { const s = TEXPIX[src]; const d = new Uint32Array(s.length); for (let i = 0; i < s.length; i++) { const p = s[i]; d[i] = 0xff000000 | (((p >> 16) & 255) * k) << 16 | (((p >> 8) & 255) * k) << 8 | ((p & 255) * k); } return d; }

// ── world ────────────────────────────────────────────────────────────────
const WALL = { "#": "tex_office", "G": "tex_glass", "K": "tex_kitchen", "S": "tex_server", "L": "tex_lift", "R": "tex_wood" };
const PROPS = { d: { img: "desk", h: 0.55, w: 1.4, r: 0.45 }, p: { img: "plant", h: 0.9, w: 0.55, r: 0.25 }, w: { img: "cooler", h: 1.0, w: 0.45, r: 0.25 } };
const FLOORS = [
  "RECEPTION", "THE KITCHEN", "IT", "FINANCE", "HEAD OF SALES", "SECURITY", "LEGAL", "MEETINGS", "DATA", "THE CFO",
  "PEOPLE & CULTURE", "THE EXEC FLOOR", "STRATEGY", "THE BOARD", "THE CEO",
];
const BOSSES = { 1: { img: "boss_sales", name: "HEAD OF SALES", hp: 10, speed: 1.9, h: 1.05, w: 0.9, planes: 0, line: "CHAMP. CHAMP. CHAMP." }, 2: { img: "boss_cfo", name: "THE CFO", hp: 16, speed: 0.8, h: 1.25, w: 1.3, planes: 4.5, line: "THAT'S NOT IN THE BUDGET." }, 3: { img: "boss_ceo", name: "THE CEO", hp: 22, speed: 1.3, h: 1.3, w: 0.95, planes: 2.2, line: "WHO LET YOU IN?" } };
let MAP = null, MH = 24, MW = 24, SPAWNS = [], FRIENDSPOTS = [], PROPLIST = [], BOSSSPOT = null, START = { x: 1.5, y: 1.5 }, SOLID = null;
const doorK = (x, y) => { const d = G && G.doors && G.doors[y * MW + x]; return d ? d.k : 0; };
const isWall = (x, y) => { if (x < 0 || y < 0 || x >= MW || y >= MH) return true; const c = MAP[y][x]; if (c === "D") return doorK(x, y) < 0.5; return !!WALL[c]; };
const isHardWall = (x, y) => x < 0 || y < 0 || x >= MW || y >= MH || !!WALL[MAP[y][x]];
const isSolid = (x, y) => isWall(x, y) || SOLID[y * MW + x] === 1;
const isPathBlocked = (x, y) => isHardWall(x, y) || SOLID[y * MW + x] === 1;
function loadMap(key) {
  MAP = MAPS[key]; MH = MAP.length; MW = MAP[0].length; SPAWNS = []; FRIENDSPOTS = []; PROPLIST = []; BOSSSPOT = null; SOLID = new Uint8Array(MW * MH);
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
    const c = MAP[y][x];
    if (c === "z") SPAWNS.push({ x: x + 0.5, y: y + 0.5 });
    if (c === "f") FRIENDSPOTS.push({ x: x + 0.5, y: y + 0.5 });
    if (c === "b") BOSSSPOT = { x: x + 0.5, y: y + 0.5 };
    if (c === "P") { START.x = x + 0.5; START.y = y + 0.5; }
    if (PROPS[c]) { PROPLIST.push({ x: x + 0.5, y: y + 0.5, ...PROPS[c] }); SOLID[y * MW + x] = 1; }
  }
}
function floorTex(x, y) { const c = (MAP[y] || "")[x]; return c === ":" ? "floor_lino" : c === "_" ? "floor_dark" : "floor_carpet"; }

// ── setup ────────────────────────────────────────────────────────────────
const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");
let W = 0, H = 0, U = 0, COLS = 0, CW = 2, FW = 160, RS = 3, FROWS = 0, offF, offC, fctx, cctx, fImg, cImg, fBuf, cBuf;
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth; H = window.innerHeight; U = Math.min(W, H);
  CW = 2; COLS = Math.ceil(W / CW);
  canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.width = W + "px"; canvas.style.height = H + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.imageSmoothingEnabled = true;
  FW = W > 700 ? Math.min(360, Math.ceil(W / 3.2)) : Math.min(176, Math.ceil(W / 2.4)); RS = W > 700 ? 2 : (H > 900 ? 4 : 3); FROWS = Math.ceil(H * 0.56 / RS);
  offF = document.createElement("canvas"); offF.width = FW; offF.height = FROWS; fctx = offF.getContext("2d"); fImg = fctx.createImageData(FW, FROWS); fBuf = new Uint32Array(fImg.data.buffer);
  offC = document.createElement("canvas"); offC.width = FW; offC.height = FROWS; cctx = offC.getContext("2d"); cImg = cctx.createImageData(FW, FROWS); cBuf = new Uint32Array(cImg.data.buffer);
}
window.addEventListener("resize", resize); resize();
const rnd = (a, b) => a + Math.random() * (b - a);
const TOUCH = matchMedia("(pointer: coarse)").matches;
if (!TOUCH) $("#ctl").textContent = "WASD to move. Click the game to lock the mouse, then look around and click to throw.";

let G = null, raf = 0, lastTs = 0;
const zbuf = new Float32Array(2048);
function newGame() {
  return {
    t: 0, floor: 0, phase: "lift", liftT: 0.6, score: 0, kills: 0, saved: 0, lives: 3,
    px: 1.5, py: 1.5, dirX: 1, dirY: 0, planeX: 0, planeY: 0.78, bob: 0, moving: false,
    zombies: [], friends: [], sticks: [], pickups: [], planes: [], parts: [], floaters: [], dist: null, distT: 0,
    toSpawn: 0, spawnT: 0, power: null, powerT: 0, bombs: 0, slow: 0, shake: 0, flash: 0, inv: 0, over: false, banner: "", bannerT: 0, hand: 0,
    boss: null, ambient: 1, tint: null, floorName: "", bossLine: "", bossLineT: 0,
  };
}
function rotate(a) { const c = Math.cos(a), s = Math.sin(a); const dx = G.dirX * c - G.dirY * s, dy = G.dirX * s + G.dirY * c; G.dirX = dx; G.dirY = dy; G.planeX = -dy * 0.78; G.planeY = dx * 0.78; }
function setDir(x, y) { G.dirX = x; G.dirY = y; G.planeX = -y * 0.78; G.planeY = x * 0.78; }

function loadFloor(n) {
  G.floor = n;
  const key = ["A", "B", "C"][(n - 1) % 3];
  loadMap(key);
  G.px = START.x; G.py = START.y;
  // face into the room: away from the nearest wall
  const d = [[1, 0], [0, 1], [-1, 0], [0, -1]].map(([dx, dy]) => { let k = 0; while (k < 6 && !isSolid(Math.floor(G.px + dx * (k + 1)), Math.floor(G.py + dy * (k + 1)))) k++; return { dx, dy, k }; }).sort((a, b) => b.k - a.k)[0];
  setDir(d.dx, d.dy);
  G.zombies = []; G.friends = []; G.sticks = []; G.pickups = []; G.planes = []; G.boss = null; G.dist = null; G.doors = {};
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) if (MAP[y][x] === "D") G.doors[y * MW + x] = { x: x + 0.5, y: y + 0.5, k: 0, want: 0 };
  G.floorName = FLOORS[n - 1] || `FLOOR ${n}`; G.floorT = 0;
  G.ambient = key === "C" ? 0.74 : key === "B" ? 0.9 : 1;
  G.tint = key === "C" ? "rgba(140,30,30,0.09)" : key === "B" ? "rgba(120,170,150,0.08)" : null;
  TEXPIX.floor_dark = TEXPIX.floor_dark || (TEXPIX.floor_carpet ? darkPix("floor_carpet", 0.45) : null);
  const pool = ["DAVE", "PRIYA", "JONNO", "MEL", "TANE", "SOPH", "AROHA", "BAZ", "KIRI", "HAMISH"].sort(() => Math.random() - 0.5);
  FRIENDSPOTS.forEach((s, i) => G.friends.push({ x: s.x, y: s.y, type: i % 3, state: "idle", st: 0, w: rnd(0, 6.28), h: 0.85, name: pool[i % pool.length] }));
  G.toSpawn = 3 + n * 2 + Math.floor(n * n * 0.12);
  G.spawnT = 0.4;
  if (n % 5 === 0) {
    const kind = Math.min(3, n / 5), B = BOSSES[kind];
    const at = BOSSSPOT || SPAWNS[SPAWNS.length - 1];
    G.boss = { x: at.x, y: at.y, hp: B.hp + Math.floor(n / 5) * 2, maxHp: B.hp + Math.floor(n / 5) * 2, speed: B.speed, boss: true, kind, name: B.name, img: B.img, state: "zombie", st: 0, w: 0, flash: 0, stun: 0, h: B.h, wmul: B.w, rad: 0.42, planeT: B.planes ? 3 : 0, planes: B.planes, line: B.line, flow: 0 };
    G.zombies.push(G.boss);
    G.toSpawn = Math.floor(G.toSpawn * 0.6);
  }
  G.phase = "play";
  G.banner = `FLOOR ${n} · ${G.floorName}`; G.bannerT = 2.4;
  if (G.boss) { G.bossLine = G.boss.line; G.bossLineT = 3; sfx("horn"); const bk = G.boss.kind; setTimeout(() => voice(bk === 1 ? "champ" : "fired"), 2200); }
}
function los(ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, d = Math.hypot(dx, dy), n = Math.ceil(d * 10);
  for (let i = 1; i < n; i++) { const t = i / n; if (isWall(Math.floor(ax + dx * t), Math.floor(ay + dy * t))) return false; }
  return true;
}
function spawnZombie(at) {
  const r = G.floor;
  let s = at;
  if (!s) {
    const nearFriend = (p) => G.friends.some((f) => Math.hypot(f.x - p.x, f.y - p.y) < 5);
    const hidden = SPAWNS.filter((p) => Math.hypot(p.x - G.px, p.y - G.py) > 4.5 && !los(p.x, p.y, G.px, G.py));
    let far = hidden.filter((p) => !nearFriend(p));
    if (!far.length) far = hidden;
    far = far.sort((a, b) => Math.hypot(a.x - G.px, a.y - G.py) - Math.hypot(b.x - G.px, b.y - G.py));
    const pool = Math.random() < 0.3 && hidden.length ? hidden : far.length ? far.slice(0, 3) : SPAWNS;
    s = pool[Math.floor(Math.random() * pool.length)];
  }
  const speed = Math.min(3.0, 1.5 + r * 0.12) * rnd(0.85, 1.15);
  G.zombies.push({ x: s.x + (at ? 0 : rnd(-0.3, 0.3)), y: s.y + (at ? 0 : rnd(-0.3, 0.3)), hp: 1, maxHp: 1, speed, boss: false, state: "zombie", st: 0, w: rnd(0, 6.28), flash: 0, stun: 0, h: 0.85, wmul: 0.85, rad: 0.28, flow: 0, img: "zombie_f" });
}

// ── input ────────────────────────────────────────────────────────────────
const keys = {};
addEventListener("keydown", (e) => { if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return; keys[e.key.toLowerCase()] = true; if (e.key === " " && G && !G.over) throwStick(); });
addEventListener("keyup", (e) => { keys[e.key.toLowerCase()] = false; });
let moveStick = null, lookDrag = null;
canvas.addEventListener("pointerdown", (e) => {
  if (!G || G.over) return;
  if (e.pointerType === "mouse") { if (document.pointerLockElement !== canvas) { canvas.requestPointerLock?.(); return; } throwStick(); return; }
  canvas.setPointerCapture(e.pointerId);
  if (e.clientX < W * 0.45) moveStick = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY };
  else lookDrag = { id: e.pointerId, x: e.clientX, x0: e.clientX, y0: e.clientY, moved: 0, t0: performance.now() };
});
canvas.addEventListener("pointermove", (e) => {
  if (!G) return;
  if (e.pointerType === "mouse") { if (document.pointerLockElement === canvas) rotate(e.movementX * 0.0022); return; }
  if (moveStick && e.pointerId === moveStick.id) { moveStick.x = e.clientX; moveStick.y = e.clientY; }
  if (lookDrag && e.pointerId === lookDrag.id) { const dx = e.clientX - lookDrag.x; lookDrag.moved += Math.abs(dx) + Math.abs(e.clientY - lookDrag.y0) * 0.2; rotate(dx * (2.4 / W)); lookDrag.x = e.clientX; }
});
const up = (e) => {
  if (moveStick && e.pointerId === moveStick.id) moveStick = null;
  if (lookDrag && e.pointerId === lookDrag.id) { if (lookDrag.moved < 12 && performance.now() - lookDrag.t0 < 350 && G && !G.over) throwStick(); lookDrag = null; }
};
canvas.addEventListener("pointerup", up); canvas.addEventListener("pointercancel", up);

function camSpace(x, y) {
  const dx = x - G.px, dy = y - G.py;
  const inv = 1 / (G.planeX * G.dirY - G.dirX * G.planeY);
  return { tx: inv * (G.dirY * dx - G.dirX * dy), ty: inv * (-G.planeY * dx + G.planeX * dy) };
}
function inCone(o, cone) { return (Math.hypot(o.x - G.px, o.y - G.py) < 1.1 && camSpace(o.x, o.y).ty > -0.3) || (() => { const c = camSpace(o.x, o.y); return c.ty > 0.2 && c.ty < 8 && Math.abs(c.tx / c.ty) < cone + (0.5 / c.ty) * 0.45 && los(G.px, G.py, o.x, o.y); })(); }
function throwStick() {
  if (!G || G.phase !== "play") return;
  G.hand = 1;
  const bomb = G.bombs > 0;
  const cone = bomb ? 0.6 : 0.16;
  const zs = G.zombies.filter((z) => z.state === "zombie" && inCone(z, cone)).map((z) => ({ e: z, d: Math.hypot(z.x - G.px, z.y - G.py), kind: "z" }));
  const fs = G.friends.filter((f) => inCone(f, 0.07)).map((f) => ({ e: f, d: Math.hypot(f.x - G.px, f.y - G.py), kind: "f" }));
  const all = [...zs, ...fs.filter((f) => !zs.length || f.d < zs.reduce((m, o) => Math.min(m, o.d), 99) - 0.8)].sort((a, b) => a.d - b.d);
  let targets = [];
  if (bomb) { targets = zs.map((o) => o); G.bombs--; }
  else { const n = G.power === "sage" ? 2 : 1; targets = all.slice(0, n); }
  let tx, ty;
  if (targets.length) { tx = targets[0].e.x; ty = targets[0].e.y; }
  else { tx = G.px + G.dirX * 5; ty = G.py + G.dirY * 5; for (let k = 1; k <= 20; k++) { const qx = G.px + G.dirX * k * 0.25, qy = G.py + G.dirY * k * 0.25; if (isWall(Math.floor(qx), Math.floor(qy))) { tx = G.px + G.dirX * (k - 1) * 0.25; ty = G.py + G.dirY * (k - 1) * 0.25; break; } } }
  const dd = Math.hypot(tx - G.px, ty - G.py);
  G.sticks.push({ t: 0, dur: Math.max(0.16, Math.min(0.55, dd / 14)), targets, bomb, x0: G.px + G.planeX / 0.78 * 0.22, y0: G.py + G.planeY / 0.78 * 0.22, x1: tx, y1: ty, w: rnd(0, 6) });
  sfx("whoosh");
}
function stickArrive(s) {
  if (s.bomb) {
    G.shake = 0.3; G.flash = 0.25;
    for (let k = 0; k < 40; k++) { const a = rnd(0, 6.28), sp = rnd(U * 0.2, U * 0.9); G.parts.push({ x: W / 2, y: H / 2, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t: rnd(0.3, 0.7), r: rnd(3, 9), c: "#2a2a2a" }); }
    floater(s.targets.length ? `CHARCOAL. ${s.targets.length} FRESHENED.` : "CHARCOAL. NOBODY HOME.");
    for (const o of s.targets) convert(o.e, 99);
    return;
  }
  if (!s.targets.length) { for (let k = 0; k < 6; k++) G.parts.push({ x: W / 2, y: H / 2, vx: rnd(-60, 60), vy: rnd(-120, -20), t: 0.4, r: 3, c: "#d6f26b" }); floater("MISSED", true); return; }
  for (const o of s.targets) { if (o.kind === "z") convert(o.e, 1); else hitFriend(o.e); }
}
function floater(text, bad, y) {
  for (const f of G.floaters) if (f.t < 0.6) f.y -= U * 0.045;
  G.floaters.push({ x: W / 2, y: y || H * 0.58, text, t: 0, bad: !!bad });
}
function dirWord(o) { const c = camSpace(o.x, o.y); if (c.ty < 0) return "BEHIND YOU"; const a = c.tx / Math.max(0.01, c.ty); return a < -0.4 ? "LEFT" : a > 0.4 ? "RIGHT" : "AHEAD"; }
function hitFriend(f) {
  G.score = Math.max(0, G.score - 50); voice(f.type === 0 ? "alreadyfresh_f" : "alreadyfresh"); sfx("thud"); f.state = "annoyed"; f.st = 0;
  floater(`${f.name}: I'M ALREADY FRESH, MATE.  −50`, true);
}
function convert(z, dmg) {
  if (z.state !== "zombie") return;
  z.hp -= dmg; z.flash = 0.12; G.hitstop = Math.max(G.hitstop || 0, z.hp > 0 ? 0.035 : (z.boss ? 0.18 : 0.07)); sfx(z.hp > 0 ? "hit" : "pop");
  if (z.hp > 0) { floater(z.boss ? ["NOT YET.", "STILL REEKS.", "KEEP GOING."][Math.floor(rnd(0, 3))] : "HIT"); z.stun = z.boss ? 0.15 : 0.25; if (z.boss && z.hp === Math.floor(z.maxHp / 2)) { G.bossLine = z.kind === 3 ? "YOU'RE FIRED." : z.kind === 2 ? "I'LL HAVE TO ESCALATE THIS." : "LET'S CIRCLE BACK."; G.bossLineT = 2.5; } return; }
  z.state = "fresh"; z.st = 0; z.h = 0.85; z.wmul = 0.85;
  G.kills++; voice(z.boss ? (z.kind === 3 ? "pub" : "legend") : ["cheers", "better", "legend"][Math.floor(rnd(0, 3))]);
  const pts = (z.boss ? 1500 * z.kind : 100) * (1 + Math.floor((G.floor - 1) / 5) * 0.5);
  G.score += pts;
  floater(z.boss ? `+${pts}  ${z.name} IS FRESH` : `+${pts}  FRESH`);
  for (let k = 0; k < (z.boss ? 40 : 14); k++) { const a = rnd(0, 6.28), sp = rnd(U * 0.1, U * 0.6); G.parts.push({ x: W / 2, y: H / 2, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t: rnd(0.3, 0.7), r: rnd(3, 8), c: "#d6f26b" }); }
  if (z.boss) { G.boss = null; G.bossLine = z.kind === 3 ? "RIGHT. PUB?" : z.kind === 2 ? "...APPROVED." : "LEGEND. BEERS?"; G.bossLineT = 3.5; drop(z, "charcoal"); drop(z, "tee"); drop(z, "sixpack"); G.shake = 0.4; return; }
  const roll = Math.random();
  if (roll < 0.07) drop(z, "charcoal"); else if (roll < 0.14) drop(z, "sage"); else if (roll < 0.19) drop(z, "kawakawa"); else if (roll < 0.24) drop(z, "tee"); else if (roll < 0.27) drop(z, "sixpack");
}
function drop(z, type) {
  let x = z.x, y = z.y;
  if (z.boss) { for (let k = 0; k < 16; k++) { const a = rnd(0, 6.28), r = rnd(1.0, 1.7); const nx = z.x + Math.cos(a) * r, ny = z.y + Math.sin(a) * r; if (!isSolid(Math.floor(nx), Math.floor(ny)) && los(z.x, z.y, nx, ny) && Math.hypot(nx - G.px, ny - G.py) > 0.9 && !G.pickups.some((q) => Math.hypot(q.x - nx, q.y - ny) < 0.8)) { x = nx; y = ny; break; } } }
  G.pickups.push({ x, y, type, t: 25, h: 0.4, w: rnd(0, 6.28) });
}
function takePickup(p) {
  G.score += 50;
  if (p.type === "tee") { G.lives = Math.min(5, G.lives + 1); G.banner = "CLEAN TEE. +1 LIFE."; }
  else if (p.type === "kawakawa") { G.slow = 5; G.banner = "KAWAKAWA. SLOW DOWN."; }
  else if (p.type === "charcoal") { G.bombs += 1; G.banner = "CHARCOAL BOMB. NEXT THROW."; }
  else if (p.type === "sixpack") { G.bombs += 3; G.banner = "SIX-PACK. THREE BOMBS."; }
  else { G.power = "sage"; G.powerT = 12; G.banner = "SAGE. TWO STICKS A THROW."; }
  floater(G.banner); G.bannerT = 1.4; sfx("pickup");
}

// ── movement + pathing ───────────────────────────────────────────────────
function tryMove(o, dx, dy, rad) {
  const ox = o.x, oy = o.y, nudge = Math.min(0.08, Math.hypot(dx, dy) * 0.9);
  if (dx) {
    const ex = Math.floor(o.x + dx + Math.sign(dx) * rad);
    const c = isSolid(ex, Math.floor(o.y)), a = isSolid(ex, Math.floor(o.y - rad)), b = isSolid(ex, Math.floor(o.y + rad));
    if (!c && !a && !b) o.x += dx;
    else if (!c && a && !b && !isSolid(Math.floor(o.x), Math.floor(o.y + nudge + rad))) o.y += nudge;
    else if (!c && b && !a && !isSolid(Math.floor(o.x), Math.floor(o.y - nudge - rad))) o.y -= nudge;
  }
  if (dy) {
    const ey = Math.floor(o.y + dy + Math.sign(dy) * rad);
    const c = isSolid(Math.floor(o.x), ey), a = isSolid(Math.floor(o.x - rad), ey), b = isSolid(Math.floor(o.x + rad), ey);
    if (!c && !a && !b) o.y += dy;
    else if (!c && a && !b && !isSolid(Math.floor(o.x + nudge + rad), Math.floor(o.y))) o.x += nudge;
    else if (!c && b && !a && !isSolid(Math.floor(o.x - nudge - rad), Math.floor(o.y))) o.x -= nudge;
  }
  return Math.hypot(o.x - ox, o.y - oy);
}
function flowField() {
  const d = new Int16Array(MW * MH).fill(-1);
  const sx = Math.floor(G.px), sy = Math.floor(G.py);
  const q = [[sx, sy]]; d[sy * MW + sx] = 0;
  for (let i = 0; i < q.length; i++) {
    const [x, y] = q[i], v = d[y * MW + x];
    for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + ox, ny = y + oy; if (isPathBlocked(nx, ny) || d[ny * MW + nx] !== -1) continue; d[ny * MW + nx] = v + 1; q.push([nx, ny]); }
  }
  return d;
}
function update(dt) {
  G.shake = Math.max(0, G.shake - dt); G.flash = Math.max(0, G.flash - dt); G.bannerT = Math.max(0, G.bannerT - dt); G.bossLineT = Math.max(0, G.bossLineT - dt);
  G.slow = Math.max(0, G.slow - dt); G.inv = Math.max(0, G.inv - dt); G.hand = Math.max(0, G.hand - dt * 5);
  G.t += dt; G.floorT = (G.floorT || 0) + dt;
  if (G.phase === "lift") {
    G.liftT += dt;
    if (G.liftT >= 0.75 && !G.liftLoaded) { G.liftLoaded = true; loadFloor(G.floor + 1); G.phase = "lift"; sfx("ding"); voice("goingup"); }
    if (G.liftT >= 1.6) { G.phase = "play"; G.liftLoaded = false; }
    return;
  }
  // player
  let f = 0, s = 0;
  if (keys["w"] || keys["arrowup"]) f += 1; if (keys["s"] || keys["arrowdown"]) f -= 1;
  if (keys["a"]) s -= 1; if (keys["d"]) s += 1;
  if (keys["arrowleft"] || keys["q"]) rotate(-2.2 * dt); if (keys["arrowright"] || keys["e"]) rotate(2.2 * dt);
  if (moveStick) { const dx = moveStick.x - moveStick.ox, dy = moveStick.y - moveStick.oy, d = Math.hypot(dx, dy), max = U * 0.12; if (d > 6) { const k = Math.min(1, d / max); s += dx / d * k; f -= dy / d * k; } }
  const l = Math.hypot(f, s); if (l > 1) { f /= l; s /= l; }
  G.moving = l > 0.05;
  const sp = 3.1 * dt;
  const P = { x: G.px, y: G.py }; tryMove(P, (G.dirX * f + G.planeX / 0.78 * s) * sp, (G.dirY * f + G.planeY / 0.78 * s) * sp, 0.25); G.px = P.x; G.py = P.y;
  G.bob += dt * (G.moving ? 11 : 0);

  if (G.phase === "clear") { G.phaseT += dt; if (G.phaseT > 2.2) { G.phase = "lift"; G.liftT = 0; G.liftLoaded = false; sfx("ding"); } }
  if (G.power === "sage") { G.powerT -= dt; if (G.powerT <= 0) { G.power = null; G.banner = "SAGE RAN OUT."; G.bannerT = 1; } }
  const zt = G.slow > 0 ? 0.4 : 1;
  if (G.phase === "play" && G.toSpawn > 0) { G.spawnT -= dt; if (G.spawnT <= 0) { const n = Math.min(G.toSpawn, G.floor >= 4 ? 2 : 1); for (let k = 0; k < n; k++) { G.toSpawn--; spawnZombie(); } G.spawnT = Math.max(0.5, 1.3 - G.floor * 0.08) * rnd(0.7, 1.3); } }
  for (let i = G.sticks.length - 1; i >= 0; i--) { const st = G.sticks[i]; st.t += dt; st.w += dt * 18; if (st.targets.length && st.targets[0].e.state === "zombie") { st.x1 = st.targets[0].e.x; st.y1 = st.targets[0].e.y; } if (st.t >= st.dur) { stickArrive(st); G.sticks.splice(i, 1); } }
  G.distT -= dt; if (!G.dist || G.distT <= 0) { G.dist = flowField(); G.distT = 0.3; }
  // friendlies
  for (const fr of G.friends) { fr.w += dt * 3; if (fr.state === "annoyed") { fr.st += dt; if (fr.st > 3) fr.state = "idle"; } }
  // doors: open for anyone within reach, close 2 s after
  for (const key in G.doors) {
    const dr = G.doors[key];
    let near = Math.hypot(dr.x - G.px, dr.y - G.py) < 2.0;
    if (!near) for (const z of G.zombies) if (z.state === "zombie" && Math.hypot(dr.x - z.x, dr.y - z.y) < 1.2) { near = true; break; }
    if (near) dr.want = 2; else dr.want = Math.max(0, dr.want - dt);
    const target = dr.want > 0 ? 1 : 0;
    if (target === 1 && dr.k < 1) { if (dr.k === 0) sfx("door"); dr.k = Math.min(1, dr.k + dt * 2.6); }
    else if (target === 0 && dr.k > 0 && Math.hypot(dr.x - G.px, dr.y - G.py) > 0.9) dr.k = Math.max(0, dr.k - dt * 2.0);
  }
  // zombies
  for (let i = G.zombies.length - 1; i >= 0; i--) {
    const z = G.zombies[i];
    z.flash = Math.max(0, z.flash - dt); z.stun = Math.max(0, z.stun - dt);
    const dx = G.px - z.x, dy = G.py - z.y, d = Math.hypot(dx, dy) || 0.001;
    if (z.state === "zombie") {
      if (z.stun > 0) continue;
      // boss paper planes
      if (z.boss && z.planes) { z.planeT -= dt; if (z.planeT <= 0 && d < 9 && los(z.x, z.y, G.px, G.py)) { z.planeT = z.planes * rnd(0.8, 1.2); const v = 4.5; G.planes.push({ x: z.x, y: z.y, vx: dx / d * v, vy: dy / d * v, t: 0, w: 0 }); sfx("plane"); } }
      // pick target: a nearby friendly with LOS, else the player
      let tgt = null, td = Infinity;
      if (!z.boss && G.floorT > 5) for (const fr of G.friends) { const fd = Math.hypot(fr.x - z.x, fr.y - z.y); if (fd < 2.2 && fd < td && los(z.x, z.y, fr.x, fr.y)) { td = fd; tgt = fr; } }
      let mx, my;
      z.flow = Math.max(0, (z.flow || 0) - dt);
      if (tgt) { mx = (tgt.x - z.x) / td; my = (tgt.y - z.y) / td; }
      else if (z.flow <= 0 && los(z.x, z.y, G.px, G.py)) { mx = dx / d; my = dy / d; }
      else {
        const cx = Math.floor(z.x), cy = Math.floor(z.y); let best = G.dist[cy * MW + cx], bx = cx, by = cy;
        for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = cx + ox, ny = cy + oy; const v = G.dist[ny * MW + nx]; if (!isPathBlocked(nx, ny) && v >= 0 && (best < 0 || v < best)) { best = v; bx = nx; by = ny; } }
        const tx = bx + 0.5 - z.x, ty = by + 0.5 - z.y, tl = Math.hypot(tx, ty) || 1; mx = tx / tl; my = ty / tl;
      }
      if (!z.boss) for (const o of G.zombies) { if (o === z || o.state !== "zombie") continue; const ox = z.x - o.x, oy = z.y - o.y, od = Math.hypot(ox, oy), min = z.rad + o.rad; if (od > 0 && od < min) { mx += ox / od * 4; my += oy / od * 4; } }
      const ml = Math.hypot(mx, my) || 1; const v = z.speed * zt * dt;
      const moved = tryMove(z, mx / ml * v, my / ml * v, z.rad * 0.8); z.w += moved * (z.boss ? 3 : 5.5);
      if (moved < v * 0.35 && d > 1.2 && !tgt) z.flow = 1.2;
      if (tgt && td < 0.7) { if (tgt.lastT !== G.t) { tgt.lastT = G.t; tgt.threat = (tgt.threat || 0) + dt; } if (tgt.threat < 3.2) { if (!tgt.warned) { tgt.warned = true; floater(`${tgt.name}'S IN TROUBLE · ${dirWord(tgt)}`, true); } } }
      if (tgt && td < 0.7 && (tgt.threat || 0) >= 3.2) { // friendly turned
        G.friends.splice(G.friends.indexOf(tgt), 1);
        spawnZombie({ x: tgt.x, y: tgt.y });
        floater(`${tgt.name}'S TURNED.`, true); G.shake = 0.2;
      }
      if (d < z.rad + 0.45 && G.inv <= 0) hitPlayer(z);
    } else if (z.state === "fresh") { z.st += dt; z.w += dt * 2; if (z.st > 1.3) { z.state = "leaving"; z.st = 0; } }
    else { z.st += dt; tryMove(z, -dx / d * 1.3 * dt, -dy / d * 1.3 * dt, 0.2); if (z.st > 3) G.zombies.splice(i, 1); }
  }
  // paper planes
  for (let i = G.planes.length - 1; i >= 0; i--) {
    const p = G.planes[i]; p.t += dt; p.w += dt * 12; p.x += p.vx * dt * zt; p.y += p.vy * dt * zt;
    if (isWall(Math.floor(p.x), Math.floor(p.y)) || p.t > 4) { G.planes.splice(i, 1); continue; }
    if (Math.hypot(p.x - G.px, p.y - G.py) < 0.45) { G.planes.splice(i, 1); if (G.inv <= 0) hitPlayer(null, "PERFORMANCE REVIEW"); }
  }
  const active = G.zombies.filter((z) => z.state === "zombie").length;
  if (G.phase === "play" && G.toSpawn === 0 && active === 0) {
    G.phase = "clear"; G.phaseT = 0;
    const bonus = G.floor * 250 + G.friends.length * 150; G.score += bonus; G.saved += G.friends.length;
    G.banner = `FLOOR ${G.floor} CLEAR  +${bonus}`; G.bannerT = 2.2;
    if (G.friends.length) floater(`${G.friends.length} COLLEAGUES SAVED`);
  }
  for (let i = G.pickups.length - 1; i >= 0; i--) { const p = G.pickups[i]; p.t -= dt; p.w += dt * 3; if (p.t <= 0) { G.pickups.splice(i, 1); continue; } if (Math.hypot(p.x - G.px, p.y - G.py) < 0.55) { takePickup(p); G.pickups.splice(i, 1); } }
  for (let i = G.parts.length - 1; i >= 0; i--) { const p = G.parts[i]; p.t -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.9; p.vy = p.vy * 0.9 + 200 * dt; if (p.t <= 0) G.parts.splice(i, 1); }
  for (let i = G.floaters.length - 1; i >= 0; i--) { const fl = G.floaters[i]; fl.t += dt; fl.y -= dt * 34; if (fl.t > 1) G.floaters.splice(i, 1); }
}
function hitPlayer(z, why) {
  G.lives -= 1; sfx("thud"); G.inv = 1.8; G.shake = 0.4; G.flash = 0.5;
  if (z) { z.stun = z.boss ? 0.8 : 1.6; const kx = z.x - G.px, ky = z.y - G.py, kd = Math.hypot(kx, ky) || 1; for (let i = 0; i < (z.boss ? 3 : 6); i++) tryMove(z, kx / kd * 0.3, ky / kd * 0.3, z.rad * 0.8); }
  floater(why || "STAINED TEE", true, H * 0.62);
  if (G.lives <= 0) { G.over = true; cancelAnimationFrame(raf); document.exitPointerLock?.(); if (AU.drone) AU.drone.gain.setTargetAtTime(0, AU.ctx.currentTime, 0.2); if (AU.music) AU.musicGain.gain.setTargetAtTime(AU.musicVol * 0.5, AU.ctx.currentTime, 0.6); draw(); setTimeout(showEnd, 900); }
}

// ── render ───────────────────────────────────────────────────────────────
function castFloor(hor) {
  const carpet = TEXPIX.floor_carpet, lino = TEXPIX.floor_lino || carpet, dark = TEXPIX.floor_dark || carpet, ceil = TEXPIX.ceil_tiles;
  if (!carpet || !ceil) return false;
  const rdx0 = G.dirX - G.planeX, rdy0 = G.dirY - G.planeY, rdx1 = G.dirX + G.planeX, rdy1 = G.dirY + G.planeY;
  const posZ = 0.5 * H, amb = G.ambient;
  for (let r = 0; r < FROWS; r++) {
    const p = r * RS + RS * 0.5 + 1;
    const rowDist = posZ / p;
    const shade = Math.max(0.12, Math.min(1, 1.15 - rowDist / 11)) * amb;
    const sh = (shade * 256) | 0;
    const stepX = rowDist * (rdx1 - rdx0) / FW, stepY = rowDist * (rdy1 - rdy0) / FW;
    let fx = G.px + rowDist * rdx0, fy = G.py + rowDist * rdy0;
    const base = r * FW;
    for (let c = 0; c < FW; c++) {
      const cx = fx | 0, cy = fy | 0;
      const tx = ((fx - cx) * TS) | 0, ty = ((fy - cy) * TS) | 0;
      const ch = (MAP[cy] || "")[cx];
      const tex = ch === ":" ? lino : ch === "_" ? dark : carpet;
      const i = ty * TS + tx;
      let q = tex[i];
      fBuf[base + c] = 0xff000000 | ((((q >> 16) & 255) * sh) >> 8) << 16 | ((((q >> 8) & 255) * sh) >> 8) << 8 | (((q & 255) * sh) >> 8);
      q = ceil[i];
      cBuf[base + c] = 0xff000000 | ((((q >> 16) & 255) * sh) >> 8) << 16 | ((((q >> 8) & 255) * sh) >> 8) << 8 | (((q & 255) * sh) >> 8);
      fx += stepX; fy += stepY;
    }
  }
  fctx.putImageData(fImg, 0, 0); cctx.putImageData(cImg, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(offF, 0, hor, W, FROWS * RS);
  ctx.save(); ctx.translate(0, hor); ctx.scale(1, -1); ctx.drawImage(offC, 0, 0, W, FROWS * RS); ctx.restore();
  return true;
}
function draw() {
  const bobY = Math.sin(G.bob) * H * 0.012 + (G.shake > 0 ? rnd(-1, 1) * U * 0.012 : 0);
  const hor = H / 2 + bobY;
  if (!castFloor(hor)) {
    let g = ctx.createLinearGradient(0, 0, 0, hor); g.addColorStop(0, "#efe6cf"); g.addColorStop(1, "#b9b094"); ctx.fillStyle = g; ctx.fillRect(0, 0, W, hor);
    g = ctx.createLinearGradient(0, hor, 0, H); g.addColorStop(0, "#9c8d66"); g.addColorStop(1, "#e2cf9f"); ctx.fillStyle = g; ctx.fillRect(0, hor, W, H - hor);
  }
  // walls
  for (let col = 0; col < COLS; col++) {
    const camX = 2 * (col + 0.5) / COLS - 1;
    const rdx = G.dirX + G.planeX * camX, rdy = G.dirY + G.planeY * camX;
    let mx = Math.floor(G.px), my = Math.floor(G.py);
    const ddx = rdx === 0 ? 1e30 : Math.abs(1 / rdx), ddy = rdy === 0 ? 1e30 : Math.abs(1 / rdy);
    let stepX, stepY, sdx, sdy;
    if (rdx < 0) { stepX = -1; sdx = (G.px - mx) * ddx; } else { stepX = 1; sdx = (mx + 1 - G.px) * ddx; }
    if (rdy < 0) { stepY = -1; sdy = (G.py - my) * ddy; } else { stepY = 1; sdy = (my + 1 - G.py) * ddy; }
    let side = 0, hit = 0, n = 0;
    let doorShift = 0;
    while (!hit && n++ < 64) {
      if (sdx < sdy) { sdx += ddx; mx += stepX; side = 0; } else { sdy += ddy; my += stepY; side = 1; }
      const ch = (MAP[my] || "")[mx];
      if (ch === "D") { const dd = side === 0 ? sdx - ddx : sdy - ddy; let dwx = side === 0 ? G.py + dd * rdy : G.px + dd * rdx; dwx -= Math.floor(dwx); const k = doorK(mx, my); if (dwx < k) continue; doorShift = k; hit = 1; }
      else if (WALL[ch] || mx < 0 || my < 0 || mx >= MW || my >= MH) hit = 1;
    }
    const dist = side === 0 ? sdx - ddx : sdy - ddy;
    zbuf[col] = dist;
    const lh = H / Math.max(0.0001, dist);
    const y0 = hor - lh / 2;
    const chh = (MAP[my] || "")[mx];
    const tex = IMG[chh === "D" ? "tex_door" : (WALL[chh] || "tex_office")];
    let wx = side === 0 ? G.py + dist * rdy : G.px + dist * rdx; wx -= Math.floor(wx); if (chh === "D") wx = Math.max(0, Math.min(0.999, wx - doorShift));
    if (tex && tex.complete && tex.naturalWidth) {
      let tx = Math.floor(wx * tex.naturalWidth); if ((side === 0 && rdx < 0) || (side === 1 && rdy > 0)) tx = tex.naturalWidth - tx - 1;
      ctx.drawImage(tex, tx, 0, 1, tex.naturalHeight, col * CW, y0, CW, lh);
    } else { ctx.fillStyle = "#cbbf9a"; ctx.fillRect(col * CW, y0, CW, lh); }
    const shade = Math.min(0.8, dist / 11 + (side === 1 ? 0.14 : 0) + (1 - G.ambient) * 0.6);
    if (shade > 0.02) { ctx.fillStyle = `rgba(20,40,30,${shade})`; ctx.fillRect(col * CW, y0, CW, lh); }
  }
  // sprites far → near
  const ents = [];
  for (const z of G.zombies) ents.push({ e: z, kind: "z" });
  for (const fr of G.friends) ents.push({ e: fr, kind: "f" });
  for (const p of G.pickups) ents.push({ e: p, kind: "p" });
  for (const p of PROPLIST) ents.push({ e: p, kind: "o" });
  for (const p of G.planes) ents.push({ e: p, kind: "a" });
  for (const s of G.sticks) { const k = s.t / s.dur; ents.push({ e: { x: s.x0 + (s.x1 - s.x0) * k, y: s.y0 + (s.y1 - s.y0) * k, h: 0.26, lift: 0.1 + Math.sin(k * Math.PI) * 0.45, w: s.w, img: s.bomb ? "charcoal" : "stick" }, kind: "s" }); }
  const list = ents.map((o) => ({ ...o, c: camSpace(o.e.x, o.e.y) })).filter((o) => o.c.ty > 0.15).sort((a, b) => b.c.ty - a.c.ty);
  for (const o of list) {
    const { tx, ty } = o.c, e = o.e;
    const sx = (W / 2) * (1 + tx / ty);
    const unit = H / ty;
    const bottom = hor + unit / 2;
    let name, h = e.h, wmul = 0.85, lift = 0;
    if (o.kind === "p") { name = e.type; h = 0.35 + Math.sin(e.w) * 0.04; wmul = 1; }
    else if (o.kind === "o") { name = e.img; wmul = e.w; }
    else if (o.kind === "a") { name = "plane"; h = 0.42; wmul = 1.4; lift = unit * 0.4; }
    else if (o.kind === "s") { name = e.img; h = e.h; wmul = 1; lift = unit * e.lift; }
    else if (o.kind === "f") { name = e.state === "annoyed" && e.type === 1 ? "friend_shocked" : "friend" + e.type; wmul = e.type === 0 ? 1.1 : 0.8; }
    else { name = e.state === "zombie" ? (e.boss ? e.img : ["zombie_f", "zombie_w1", "zombie_f", "zombie_w2"][Math.floor(e.w * 0.9) % 4]) : e.state === "fresh" ? "fresh" : "leaving"; if (name !== "zombie_f" && !(IMG[name] && IMG[name].naturalWidth)) name = e.img || "zombie_f"; wmul = e.state === "zombie" ? e.wmul : 0.85; }
    const sh = unit * h, sw = sh * wmul;
    const top = bottom - sh - lift - (o.kind === "p" ? unit * 0.05 : 0);
    const img = IMG[name]; if (!img || !img.complete || !img.naturalWidth) continue;
    const x0 = sx - sw / 2, x1 = sx + sw / 2;
    if (x1 < 0 || x0 > W) continue;
    const alpha = (o.kind === "z" && e.state === "leaving" ? Math.max(0, 1 - e.st / 3) : 1) * (1 - Math.min(0.6, ty / 14)) * (0.55 + 0.45 * G.ambient);
    const sway = o.kind === "z" && e.state === "zombie" ? Math.sin(e.w * 0.45) * 0.035 : o.kind === "s" ? e.w : 0;
    const flash = (o.kind === "z" && e.flash > 0) || (o.kind === "f" && e.state === "annoyed" && e.st < 0.3);
    const c0 = Math.max(0, Math.floor(x0 / CW)), c1 = Math.min(COLS - 1, Math.floor(x1 / CW));
    ctx.save(); ctx.globalAlpha = alpha; if (flash) ctx.filter = "brightness(1.7)";
    ctx.translate(sx, bottom); ctx.rotate(sway); ctx.translate(-sx, -bottom);
    let c = c0;
    while (c <= c1) {
      if (zbuf[c] <= ty) { c++; continue; }
      let en = c; while (en + 1 <= c1 && zbuf[en + 1] > ty) en++;
      const px0 = Math.max(c * CW, x0), px1 = Math.min(x1, (en + 1) * CW);
      const u0 = (px0 - x0) / sw, u1 = (px1 - x0) / sw;
      if (u1 > 0 && u0 < 1 && px1 > px0) ctx.drawImage(img, u0 * img.naturalWidth, 0, Math.max(1, (u1 - u0) * img.naturalWidth), img.naturalHeight, px0, top, px1 - px0, sh);
      c = en + 1;
    }
    ctx.restore();
    if (ty < 8 && o.kind === "z" && e.state === "fresh") { ctx.fillStyle = "#103b2d"; ctx.font = `900 ${Math.max(11, sh * 0.1)}px system-ui`; ctx.textAlign = "center"; ctx.textBaseline = "bottom"; ctx.fillText(["CHEERS MATE", "OH THAT'S BETTER", "LEGEND", "SMELL THAT"][Math.floor(e.w) % 4], sx, top - 6); }
    if (ty < 6 && o.kind === "f" && e.state === "idle" && zbuf[Math.floor(sx / CW)] > ty) { ctx.fillStyle = "rgba(16,59,45,0.75)"; ctx.font = `800 ${Math.max(10, sh * 0.07)}px system-ui`; ctx.textAlign = "center"; ctx.textBaseline = "bottom"; ctx.fillText(e.name, sx, top - 4); }
  }
  // (sticks are drawn as world sprites above)
  for (const p of G.parts) { ctx.globalAlpha = Math.min(1, p.t * 3); ctx.fillStyle = p.c; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill(); } ctx.globalAlpha = 1;
  for (const f of G.floaters) { ctx.globalAlpha = 1 - f.t; ctx.fillStyle = f.bad ? "#ff6b6b" : "#d6f26b"; ctx.strokeStyle = "rgba(16,59,45,0.8)"; ctx.lineWidth = 4; ctx.font = `900 ${U * 0.036}px system-ui`; ctx.textAlign = "center"; ctx.textBaseline = "bottom"; ctx.strokeText(f.text, f.x, f.y); ctx.fillText(f.text, f.x, f.y); ctx.globalAlpha = 1; }
  if (G.tint) { ctx.fillStyle = G.tint; ctx.fillRect(0, 0, W, H); }
  { let nd = 99; for (const z of G.zombies) if (z.state === "zombie") nd = Math.min(nd, Math.hypot(z.x - G.px, z.y - G.py)); const k = Math.max(0, Math.min(1, (7 - nd) / 7)); if (k > 0) { const vg = ctx.createRadialGradient(W / 2, H / 2, U * 0.22, W / 2, H / 2, Math.max(W, H) * 0.68); vg.addColorStop(0, "rgba(120,140,20,0)"); vg.addColorStop(1, `rgba(110,135,15,${0.7 * k})`); ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H); } }
  // hand
  const hs = U * 0.62, hb = Math.sin(G.bob * 0.5) * (G.moving ? U * 0.015 : 0);
  const hand = IMG.hand; if (hand.complete && hand.naturalWidth) ctx.drawImage(hand, W - hs * 0.78 + G.hand * hs * 0.15 + hb, H - hs * 0.82 + G.hand * hs * 0.25 + Math.abs(hb), hs, hs);
  ctx.fillStyle = "#d6f26b"; ctx.strokeStyle = "rgba(16,59,45,0.7)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(W / 2, H / 2, 5, 0, 7); ctx.fill(); ctx.stroke();
  if (G.slow > 0) { ctx.fillStyle = "rgba(60,157,90,0.14)"; ctx.fillRect(0, 0, W, H); }
  if (G.flash > 0) { ctx.fillStyle = `rgba(230,60,60,${G.flash * 0.5})`; ctx.fillRect(0, 0, W, H); }
  if (G.inv > 0 && Math.floor(G.inv * 10) % 2 === 0) { ctx.strokeStyle = "rgba(255,80,80,0.6)"; ctx.lineWidth = 8; ctx.strokeRect(4, 4, W - 8, H - 8); }
  if (moveStick) { ctx.strokeStyle = "rgba(244,236,217,0.5)"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(moveStick.ox, moveStick.oy, U * 0.12, 0, 7); ctx.stroke(); const dx = moveStick.x - moveStick.ox, dy = moveStick.y - moveStick.oy, d = Math.hypot(dx, dy), k = Math.min(1, d / (U * 0.12)); ctx.fillStyle = "rgba(244,236,217,0.6)"; ctx.beginPath(); ctx.arc(moveStick.ox + (d ? dx / d * k * U * 0.12 : 0), moveStick.oy + (d ? dy / d * k * U * 0.12 : 0), U * 0.05, 0, 7); ctx.fill(); }
  // minimap
  const cell = Math.max(3, Math.floor(U * 0.011)), mmx = W - cell * MW - U * 0.04, mmy = U * 0.17;
  ctx.fillStyle = "rgba(16,59,45,0.55)"; ctx.fillRect(mmx - 3, mmy - 3, cell * MW + 6, cell * MH + 6);
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) { const c = MAP[y][x]; if (WALL[c]) { ctx.fillStyle = "rgba(244,236,217,0.5)"; ctx.fillRect(mmx + x * cell, mmy + y * cell, cell, cell); } else if (c === "D") { ctx.fillStyle = "rgba(214,242,107,0.6)"; ctx.fillRect(mmx + x * cell, mmy + y * cell, cell, cell); } }
  for (const z of G.zombies) if (z.state === "zombie") { ctx.fillStyle = z.boss ? "#ffd166" : "#ff6b6b"; ctx.fillRect(mmx + z.x * cell - 1.5, mmy + z.y * cell - 1.5, z.boss ? 5 : 3, z.boss ? 5 : 3); }
  for (const fr of G.friends) { ctx.fillStyle = fr.threat > 0 ? "#ffd166" : "#7fd3ff"; ctx.fillRect(mmx + fr.x * cell - 2, mmy + fr.y * cell - 2, 4, 4); }
  for (const p of G.pickups) { ctx.fillStyle = "#d6f26b"; ctx.fillRect(mmx + p.x * cell - 1.5, mmy + p.y * cell - 1.5, 3, 3); }
  ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(mmx + G.px * cell, mmy + G.py * cell, 2.5, 0, 7); ctx.fill();
  ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(mmx + G.px * cell, mmy + G.py * cell); ctx.lineTo(mmx + (G.px + G.dirX * 2) * cell, mmy + (G.py + G.dirY * 2) * cell); ctx.stroke();
  // HUD
  const ink = "#f4ecd9";
  ctx.fillStyle = ink; ctx.strokeStyle = "rgba(16,59,45,0.8)"; ctx.lineWidth = 4; ctx.textBaseline = "top"; ctx.textAlign = "left";
  ctx.font = `900 ${U * 0.03}px system-ui`; ctx.strokeText("FLOOR", U * 0.05, U * 0.04); ctx.fillText("FLOOR", U * 0.05, U * 0.04);
  ctx.font = `900 ${U * 0.12}px system-ui`; ctx.strokeText(String(Math.max(1, G.floor)), U * 0.05, U * 0.065); ctx.fillText(String(Math.max(1, G.floor)), U * 0.05, U * 0.065);
  if (!(G.boss && G.boss.state === "zombie")) { ctx.font = `800 ${U * 0.024}px system-ui`; ctx.strokeText(G.floorName, U * 0.05, U * 0.19); ctx.fillText(G.floorName, U * 0.05, U * 0.19); }
  ctx.textAlign = "right"; ctx.font = `900 ${U * 0.055}px system-ui`; const sc = Math.round(G.score).toLocaleString(); ctx.strokeText(sc, W - U * 0.05, U * 0.04); ctx.fillText(sc, W - U * 0.05, U * 0.04);
  const left = G.zombies.filter((z) => z.state === "zombie").length + G.toSpawn;
  ctx.font = `800 ${U * 0.026}px system-ui`; ctx.strokeText(`${left} STILL STINK`, W - U * 0.05, U * 0.105); ctx.fillText(`${left} STILL STINK`, W - U * 0.05, U * 0.105);
  for (let i = 0; i < G.lives; i++) { const t = IMG.tee; if (t.complete && t.naturalWidth) ctx.drawImage(t, U * 0.05 + i * U * 0.062, U * 0.23, U * 0.06, U * 0.06); }
  ctx.textAlign = "left"; ctx.textBaseline = "bottom"; ctx.font = `900 ${U * 0.03}px system-ui`;
  const wn = G.bombs > 0 ? `CHARCOAL BOMB ×${G.bombs}` : G.power === "sage" ? `SAGE · ${Math.ceil(G.powerT)}s` : "ROLL-ON";
  ctx.strokeText(wn, U * 0.05, H - U * 0.05); ctx.fillText(wn, U * 0.05, H - U * 0.05);
  if (G.boss && G.boss.state === "zombie") {
    const mmLeft = W - Math.max(3, Math.floor(U * 0.011)) * MW - U * 0.04 - 10; const bw = Math.max(U * 0.3, Math.min(U * 0.6, 2 * (mmLeft - W / 2))), bx = W / 2 - bw / 2, by = U * 0.15;
    ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.font = `900 ${U * 0.026}px system-ui`; ctx.strokeText(G.boss.name, W / 2, by + U * 0.04); ctx.fillText(G.boss.name, W / 2, by + U * 0.04);
    ctx.fillStyle = "rgba(0,0,0,0.45)"; ctx.fillRect(bx - 2, by - 2, bw + 4, U * 0.022 + 4);
    ctx.fillStyle = "#ff6b6b"; ctx.fillRect(bx, by, bw * Math.max(0, G.boss.hp / G.boss.maxHp), U * 0.022);
    ctx.fillStyle = ink;
  }
  if (G.bossLineT > 0) { ctx.globalAlpha = Math.min(1, G.bossLineT); ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.font = `900 ${U * 0.04}px system-ui`; ctx.fillStyle = "#ffd166"; ctx.strokeText(G.bossLine, W / 2, H * 0.22); ctx.fillText(G.bossLine, W / 2, H * 0.22); ctx.globalAlpha = 1; ctx.fillStyle = ink; }
  if (G.bannerT > 0) { const k = Math.min(1, G.bannerT / 0.3); ctx.globalAlpha = k; ctx.fillStyle = "rgba(16,59,45,0.85)"; ctx.fillRect(0, H * 0.3, W, H * 0.12); ctx.fillStyle = "#d6f26b"; ctx.font = `900 ${U * 0.06}px system-ui`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(G.banner, W / 2, H * 0.36); ctx.globalAlpha = 1; }
  // lift doors
  if (G.phase === "lift") {
    const t = G.liftT, k = t < 0.75 ? Math.min(1, t / 0.6) : Math.max(0, 1 - (t - 0.95) / 0.6);
    const lw = W / 2 * k, lift = IMG.tex_lift;
    if (lift.complete && lift.naturalWidth) {
      ctx.drawImage(lift, 0, 0, lift.naturalWidth / 2, lift.naturalHeight, lw - W / 2, 0, W / 2, H);
      ctx.drawImage(lift, lift.naturalWidth / 2, 0, lift.naturalWidth / 2, lift.naturalHeight, W - lw, 0, W / 2, H);
    } else { ctx.fillStyle = "#8a9a8f"; ctx.fillRect(0, 0, lw, H); ctx.fillRect(W - lw, 0, lw, H); }
    if (k > 0.95) { ctx.fillStyle = "#d6f26b"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.font = `900 ${U * 0.16}px system-ui`; ctx.strokeText(String(G.floor + (G.liftLoaded ? 0 : 1)), W / 2, H * 0.42); ctx.fillText(String(G.floor + (G.liftLoaded ? 0 : 1)), W / 2, H * 0.42); ctx.font = `900 ${U * 0.035}px system-ui`; ctx.fillStyle = "#f4ecd9"; ctx.fillText(G.liftLoaded ? G.floorName : "GOING UP", W / 2, H * 0.53); }
  }
}
function frame(ts) {
  if (!G || G.over) return;
  const dt = Math.min(0.05, (ts - lastTs) / 1000 || 0.016); lastTs = ts;
  if (G.hitstop > 0) { G.hitstop -= dt; } else update(dt);
  audioTick();
  if (!G.over) { draw(); raf = requestAnimationFrame(frame); }
}

// ── audio ────────────────────────────────────────────────────────────────
const TRACKS = { coconut: { file: "sfx/coconut.mp3", scent: "Coconut Rush", title: "Liquid Memoirs" }, forest: { file: "sfx/forest.mp3", scent: "Zesty Forest", title: "Neon Pulse Party" }, none: { file: null, scent: "Smoked Cedar", title: "Just the office" } };
const AU = { ctx: null, master: null, muted: localStorage.getItem("df:mute") === "1", drone: null, voices: {}, lastVoice: 0, music: null, musicGain: null, musicVol: 0.32, track: TRACKS[localStorage.getItem("df:music")] ? localStorage.getItem("df:music") : "coconut", buffers: {} };
function stopMusic() { if (AU.music) { try { AU.music.stop(); } catch {} AU.music = null; } }
function playMusic(key) {
  const C = AU.ctx, t = TRACKS[key]; if (!C || !t || !t.file) return;
  const go = (b) => { if (AU.track !== key || AU.music) return; const m = C.createBufferSource(); m.buffer = b; m.loop = true; m.connect(AU.musicGain); m.start(); AU.music = m; const g = AU.musicGain.gain; g.cancelScheduledValues(C.currentTime); g.setValueAtTime(0, C.currentTime); g.setTargetAtTime(AU.musicVol, C.currentTime, 1.2); };
  if (AU.buffers[key]) return go(AU.buffers[key]);
  fetch(t.file).then((r) => r.ok ? r.arrayBuffer() : null).then((ab) => ab && C.decodeAudioData(ab)).then((b) => { if (!b) return; AU.buffers[key] = b; go(b); }).catch(() => {});
}
function setMusic(key, play) {
  if (!TRACKS[key]) return; AU.track = key; localStorage.setItem("df:music", key);
  document.querySelectorAll(".track").forEach((b) => b.classList.toggle("on", b.dataset.m === key));
  if (play) { audioInit(); } if (!AU.ctx) return;
  stopMusic(); playMusic(key);
}
document.querySelectorAll(".track").forEach((b) => b.addEventListener("click", () => setMusic(b.dataset.m, true)));
setMusic(AU.track, false);
function audioInit() {
  if (AU.ctx) { if (AU.ctx.state === "suspended") AU.ctx.resume(); return; }
  const C = new (window.AudioContext || window.webkitAudioContext)(); AU.ctx = C;
  AU.master = C.createGain(); AU.master.gain.value = AU.muted ? 0 : 1; AU.master.connect(C.destination);
  const len = C.sampleRate * 2, buf = C.createBuffer(1, len, C.sampleRate), d = buf.getChannelData(0); let last = 0;
  for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
  const hum = C.createBufferSource(); hum.buffer = buf; hum.loop = true; const hf = C.createBiquadFilter(); hf.type = "lowpass"; hf.frequency.value = 220; const hg = C.createGain(); hg.gain.value = 0.16; hum.connect(hf); hf.connect(hg); hg.connect(AU.master); hum.start();
  const mains = C.createOscillator(); mains.frequency.value = 60; const mg = C.createGain(); mg.gain.value = 0.018; mains.connect(mg); mg.connect(AU.master); mains.start();
  const o1 = C.createOscillator(), o2 = C.createOscillator(); o1.type = "sawtooth"; o2.type = "sawtooth"; o1.frequency.value = 55; o2.frequency.value = 55.7;
  const lf = C.createBiquadFilter(); lf.type = "lowpass"; lf.frequency.value = 260; const dg = C.createGain(); dg.gain.value = 0;
  const lfo = C.createOscillator(); lfo.frequency.value = 0.35; const lg = C.createGain(); lg.gain.value = 60; lfo.connect(lg); lg.connect(lf.frequency); lfo.start();
  o1.connect(lf); o2.connect(lf); lf.connect(dg); dg.connect(AU.master); o1.start(); o2.start(); AU.drone = dg;
  AU.musicGain = C.createGain(); AU.musicGain.gain.value = 0; AU.musicGain.connect(AU.master);
  playMusic(AU.track);
  for (const n of ["cheers", "better", "legend", "alreadyfresh", "alreadyfresh_f", "cheers_f", "pub", "champ", "fired", "goingup"]) fetch(`sfx/${n}.mp3`).then((r) => r.ok ? r.arrayBuffer() : null).then((ab) => ab && C.decodeAudioData(ab)).then((b) => { if (b) AU.voices[n] = b; }).catch(() => {});
}
function audioTick() {
  if (!AU.ctx || !G || !AU.drone) return;
  let nd = 99; for (const z of G.zombies) if (z.state === "zombie") nd = Math.min(nd, Math.hypot(z.x - G.px, z.y - G.py));
  const g = G.over ? 0 : Math.max(0, Math.min(1, (7 - nd) / 7)) * 0.22 + (G.boss && G.boss.state === "zombie" ? 0.05 : 0);
  AU.drone.gain.setTargetAtTime(g, AU.ctx.currentTime, 0.25);
}
function noiseBurst(dur, f0, f1, vol, type = "bandpass") {
  const C = AU.ctx, n = Math.floor(C.sampleRate * dur), b = C.createBuffer(1, n, C.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = C.createBufferSource(); src.buffer = b; const f = C.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(f0, C.currentTime); f.frequency.exponentialRampToValueAtTime(f1, C.currentTime + dur); f.Q.value = 1.2;
  const g = C.createGain(); g.gain.value = vol; src.connect(f); f.connect(g); g.connect(AU.master); src.start();
}
function tone(freq, dur, vol, type = "sine", slideTo) {
  const C = AU.ctx, o = C.createOscillator(), g = C.createGain(); o.type = type; o.frequency.setValueAtTime(freq, C.currentTime); if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, C.currentTime + dur);
  g.gain.setValueAtTime(vol, C.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, C.currentTime + dur); o.connect(g); g.connect(AU.master); o.start(); o.stop(C.currentTime + dur + 0.05);
}
function sfx(kind) {
  if (!AU.ctx) return;
  try {
    if (kind === "whoosh") noiseBurst(0.22, 500, 2600, 0.35);
    else if (kind === "pop") { tone(520, 0.12, 0.25, "sine", 1240); noiseBurst(0.08, 3000, 6000, 0.12, "highpass"); setTimeout(() => tone(1040, 0.14, 0.12, "triangle"), 60); setTimeout(() => tone(1560, 0.18, 0.1, "triangle"), 120); }
    else if (kind === "hit") { tone(300, 0.07, 0.18, "square", 180); }
    else if (kind === "thud") { tone(90, 0.3, 0.5, "sine", 40); noiseBurst(0.18, 200, 60, 0.4, "lowpass"); }
    else if (kind === "ding") { tone(880, 0.6, 0.18); setTimeout(() => tone(1175, 0.8, 0.16), 180); }
    else if (kind === "horn") { tone(110, 0.7, 0.3, "sawtooth", 82); tone(165, 0.7, 0.18, "sawtooth", 123); }
    else if (kind === "pickup") { tone(660, 0.08, 0.14, "triangle"); setTimeout(() => tone(990, 0.12, 0.14, "triangle"), 70); }
    else if (kind === "plane") noiseBurst(0.3, 1200, 400, 0.2);
    else if (kind === "door") noiseBurst(0.35, 300, 120, 0.22, "lowpass");
  } catch {}
}
function voice(name) {
  if (!AU.ctx || !AU.voices[name]) return;
  const now = AU.ctx.currentTime; if (now - AU.lastVoice < 0.7) return; AU.lastVoice = now;
  const src = AU.ctx.createBufferSource(); src.buffer = AU.voices[name]; const g = AU.ctx.createGain(); g.gain.value = 0.9; src.connect(g); g.connect(AU.master); src.start();
  if (AU.music) { const mg = AU.musicGain.gain; mg.cancelScheduledValues(now); mg.setTargetAtTime(AU.musicVol * 0.4, now, 0.08); mg.setTargetAtTime(AU.musicVol, now + src.buffer.duration + 0.3, 0.6); }
}
function toggleMute() { AU.muted = !AU.muted; localStorage.setItem("df:mute", AU.muted ? "1" : "0"); if (AU.master) AU.master.gain.setTargetAtTime(AU.muted ? 0 : 1, AU.ctx.currentTime, 0.05); document.querySelectorAll(".snd").forEach((b) => (b.textContent = AU.muted ? "Sound off" : "Sound on")); }
addEventListener("keydown", (e) => { if (e.key.toLowerCase() === "m" && !(e.target && /INPUT|TEXTAREA/.test(e.target.tagName))) toggleMute(); });
document.querySelectorAll(".snd").forEach((b) => { b.textContent = AU.muted ? "Sound off" : "Sound on"; b.addEventListener("click", toggleMute); });

// ── name screen: shared between the game client and the scoreboard script ──
const SCREEN_STRONG = ["fuck","fuk","fck","shit","sh1t","cunt","kunt","nigg","nigr","negro","faggot","fagot","kike","spic","chink","gook","wetback","wank","twat","bitch","biatch","whore","slut","penis","vagina","pussy","dildo","blowjob","handjob","rimjob","cumshot","jizz","porn","bastard","bollock","retard","spastic","tranny","nazi","hitler","pedo","paedo","molest","felch","queef","clit","scrotum","ballsack","nutsack","motherf","muthaf","arsehole","asshole","a55hole","dickhead","cocksuck","shithead","fuckwit","goddamn","nonce","kys","isis"];
const SCREEN_WHOLE = ["ass","arse","cock","dick","dik","cum","tits","tit","anal","anus","boob","boobs","hoe","hoes","ho","dyke","coon","paki","muff","fanny","knob","sex","sexy","piss","crap","fag","fags","homo","gay","jew","jews","poo","wee","balls","nads","prick","pricks","nob","minge","slag","tart","skank","thot","simp","incel","milf","dilf","gilf","bj","bbc","69","420","rape","rapist","raped"];
const SCREEN_LEET = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "@": "a", "$": "s", "!": "i", "|": "l", "+": "t" };
function screenName(raw) {
  var s = String(raw || "").toLowerCase();
  var leet = s.replace(/[0134578@$!|+]/g, function (c) { return SCREEN_LEET[c] || c; });
  var letters = leet.replace(/[^a-z]/g, "");
  var squashed = letters.replace(/(.)\1+/g, "$1");
  var i;
  var collapsed = letters.replace(/(.)\1\1+/g, "$1$1");
  for (i = 0; i < SCREEN_STRONG.length; i++) {
    var w = SCREEN_STRONG[i];
    var hasDouble = /(.)\1/.test(w);
    if (letters.indexOf(w) >= 0 || collapsed.indexOf(w) >= 0 || (!hasDouble && squashed.indexOf(w) >= 0)) return { ok: false, why: "strong" };
  }
  var tokens = leet.split(/[^a-z0-9]+/).concat(s.split(/[^a-z0-9]+/)).filter(Boolean);
  for (i = 0; i < tokens.length; i++) {
    var t = tokens[i].replace(/(.)\1\1+/g, "$1$1");
    if (SCREEN_WHOLE.indexOf(t) >= 0 || SCREEN_WHOLE.indexOf(tokens[i]) >= 0) return { ok: false, why: "whole" };
  }
  if (letters.length === 0) return { ok: false, why: "noletters" };
  return { ok: true };
}

// ── screens ──────────────────────────────────────────────────────────────
function tier(r) {
  if (r >= 15) return { code: "ALLDAY20", text: "20% off + free shipping. You freshened the CEO." };
  if (r >= 10) return { code: "FRESH15", text: "15% off your next order." };
  if (r >= 5) return { code: "DUDE10", text: "10% off your next order." };
  return null;
}
let posted = false;
function showEnd() {
  const r = G.floor, score = Math.round(G.score);
  const best = Math.max(Number(localStorage.getItem("df:best") || 0), score); localStorage.setItem("df:best", String(best));
  $("#endEyebrow").textContent = r >= 15 ? "YOU STINK. BUT WHAT A RUN." : "YOU STINK.";
  $("#endRound").textContent = `FLOOR ${r}`;
  $("#endScore").textContent = score.toLocaleString(); $("#endKills").textContent = String(G.kills); $("#endBest").textContent = best.toLocaleString();
  const t = tier(r), rw = $("#reward");
  if (t) { rw.classList.remove("locked"); $("#rewardCode").textContent = t.code; $("#rewardText").textContent = t.text; }
  else { rw.classList.add("locked"); $("#rewardCode").textContent = "LOCKED"; $("#rewardText").textContent = `Reach floor 5 for 10% off. You got to ${r}.`; }
  $("#name").value = localStorage.getItem("df:name") || "";
  posted = false; $("#post").textContent = "Post score"; $("#post").disabled = false; $("#postNote").textContent = "";
  if (BOARD_URL) boardLoad();
  $("#end").classList.remove("hidden"); $("#end").scrollTop = 0;
}
$("#post").addEventListener("click", async () => {
  if (posted || !G) return;
  const name = $("#name").value.trim().slice(0, 12);
  if (!name) { $("#name").focus(); return; }
  localStorage.setItem("df:name", name);
  const flag = screenName(name).ok ? 0 : 1;
  const entry = { type: "score", name, score: Math.round(G.score), round: Math.max(1, G.floor), kills: G.kills, flag };
  const note = $("#postNote");
  if (BOARD_URL) {
    posted = true; $("#post").textContent = "Posting…"; $("#post").disabled = true; note.textContent = "";
    try {
      const j = await boardPost(entry);
      if (j.status === "live") { $("#post").textContent = "Posted"; note.textContent = ""; }
      else { $("#post").textContent = "Held"; note.textContent = "That name needs a human look before it goes on the board. Your score is saved."; }
      boardLoad();
    } catch { posted = false; $("#post").textContent = "Offline — retry"; $("#post").disabled = false; }
    return;
  }
  const ok = send({ type: "action", action: entry });
  if (ok) { posted = true; $("#post").textContent = flag ? "Held" : "Posted"; $("#post").disabled = true; note.textContent = flag ? "That name needs a human look before it goes on the board. Your score is saved." : ""; } else { $("#post").textContent = "Offline — retry"; }
});
$("#name").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#post").click(); });
function start() {
  audioInit(); if (AU.music) { const g = AU.musicGain.gain; g.cancelScheduledValues(AU.ctx.currentTime); g.setTargetAtTime(AU.musicVol, AU.ctx.currentTime, 0.6); } else playMusic(AU.track);
  $("#start").classList.add("hidden"); $("#end").classList.add("hidden");
  G = newGame(); loadMap("A"); G.px = START.x; G.py = START.y; G.phase = "lift"; G.liftT = 0.5; G.liftLoaded = false; G.floor = 0; G.floorName = "";
  lastTs = performance.now(); moveStick = null; lookDrag = null;
  raf = requestAnimationFrame(frame);
}
$("#go").addEventListener("click", start);
$("#again").addEventListener("click", start);

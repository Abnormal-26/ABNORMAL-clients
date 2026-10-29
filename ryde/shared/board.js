/**
 * Shared leaderboard client for the Ryde prototypes.
 * Talks to the ABNORMAL scoreboard (Google Apps Script → "Dead Fresh Scoreboard" sheet in
 * ollie@abnormal.au's Drive). Each game posts with its own `game` id and only sees its own board.
 * Names are screened here AND server-side; anything flagged is held for review (Status column in
 * the sheet: live / review / rejected) and never shows publicly until a person approves it.
 *
 *   const board = createBoard("ryde-run");
 *   board.onChange((view) => renderBoard(listEl, view));
 *   board.load();
 *   const res = await board.post({ name, score, round, detail }); // res.status: "live" | "review"
 */
export const BOARD_URL = "https://script.google.com/macros/s/AKfycbwi87Xkpl4c6aMPnlG3wVKnIkEo0gwxCuufS68QHGyFujsKQevUtSvzbwiIl0KjozvNGQ/exec";

const SCREEN_STRONG = ["fuck","fuk","fck","shit","sh1t","cunt","kunt","nigg","nigr","negro","faggot","fagot","kike","spic","chink","gook","wetback","wank","twat","bitch","biatch","whore","slut","penis","vagina","pussy","dildo","blowjob","handjob","rimjob","cumshot","jizz","porn","bastard","bollock","retard","spastic","tranny","nazi","hitler","pedo","paedo","molest","felch","queef","clit","scrotum","ballsack","nutsack","motherf","muthaf","arsehole","asshole","a55hole","dickhead","cocksuck","shithead","fuckwit","goddamn","nonce","kys","isis"];
const SCREEN_WHOLE = ["ass","arse","cock","dick","dik","cum","tits","tit","anal","anus","boob","boobs","hoe","hoes","ho","dyke","coon","paki","muff","fanny","knob","sex","sexy","piss","crap","fag","fags","homo","gay","jew","jews","poo","wee","balls","nads","prick","pricks","nob","minge","slag","tart","skank","thot","simp","incel","milf","dilf","gilf","bj","bbc","69","420","rape","rapist","raped"];
const SCREEN_LEET = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "@": "a", "$": "s", "!": "i", "|": "l", "+": "t" };
export function screenName(raw) {
  const s = String(raw || "").toLowerCase();
  const leet = s.replace(/[0134578@$!|+]/g, (c) => SCREEN_LEET[c] || c);
  const letters = leet.replace(/[^a-z]/g, "");
  const squashed = letters.replace(/(.)\1+/g, "$1");
  const collapsed = letters.replace(/(.)\1\1+/g, "$1$1");
  for (const w of SCREEN_STRONG) { const dbl = /(.)\1/.test(w); if (letters.includes(w) || collapsed.includes(w) || (!dbl && squashed.includes(w))) return { ok: false }; }
  const tokens = leet.split(/[^a-z0-9]+/).concat(s.split(/[^a-z0-9]+/)).filter(Boolean);
  for (const t0 of tokens) { const t = t0.replace(/(.)\1\1+/g, "$1$1"); if (SCREEN_WHOLE.includes(t) || SCREEN_WHOLE.includes(t0)) return { ok: false }; }
  if (!letters.length) return { ok: false };
  return { ok: true };
}

function pid() {
  let p = null; try { p = localStorage.getItem("ryde:pid"); } catch {}
  if (!p) { p = Math.random().toString(36).slice(2, 10); try { localStorage.setItem("ryde:pid", p); } catch {} }
  return p;
}

export function createBoard(game, url = BOARD_URL) {
  const me = pid();
  let view = null, busy = false; const subs = [];
  const emit = () => subs.forEach((f) => { try { f(view); } catch {} });
  return {
    pid: me,
    get view() { return view; },
    onChange(f) { subs.push(f); if (view) f(view); },
    async load() {
      if (busy) return view; busy = true;
      try {
        const r = await fetch(`${url}?game=${encodeURIComponent(game)}&pid=${encodeURIComponent(me)}&t=${Date.now()}`, { cache: "no-store" });
        const j = await r.json(); if (j && Array.isArray(j.top)) view = j;
      } catch { if (!view) view = { top: [], offline: true }; }
      busy = false; emit(); return view;
    },
    /** entry: { name, score, round (1–999, e.g. level/day), detail (0–100000, e.g. combo/kms) } */
    async post(entry) {
      const name = String(entry.name || "").trim().slice(0, 12);
      if (!name) throw new Error("name");
      const flag = screenName(name).ok ? 0 : 1;
      const body = { game, pid: me, name, score: Math.max(0, Math.round(entry.score || 0)), round: Math.min(999, Math.max(1, Math.round(entry.round || 1))), kills: Math.min(100000, Math.max(0, Math.round(entry.detail || 0))), flag };
      const r = await fetch(url, { method: "POST", body: JSON.stringify(body) });
      const j = await r.json(); if (!j || !j.ok) throw new Error((j && j.error) || "post failed");
      try { localStorage.setItem("ryde:name", name); } catch {}
      this.load();
      return j; // { ok, status: "live" | "review" }
    },
  };
}

export function savedName() { try { return localStorage.getItem("ryde:name") || ""; } catch { return ""; } }

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
/** Fill an <ol> with the top N. fmt(score) formats the score column; roundLabel(n) labels the small column (e.g. n => `Day ${n}`). */
export function renderBoard(ol, view, { n = 10, fmt = (s) => s.toLocaleString(), roundLabel = null, empty = "No one on the board yet. Be first." } = {}) {
  if (!ol) return;
  const top = (view && view.top) || [];
  if (!top.length) { ol.innerHTML = `<li class="empty">${view ? (view.offline ? "Leaderboard offline right now." : empty) : "Loading…"}</li>`; return; }
  ol.innerHTML = top.slice(0, n).map((s, i) => `<li class="${s.you ? "you" : ""}"><span class="r">${i + 1}</span><span class="n">${esc(s.name)}</span>${roundLabel ? `<span class="rd">${esc(roundLabel(s.round))}</span>` : ""}<span class="s">${esc(fmt(s.score))}</span></li>`).join("");
}

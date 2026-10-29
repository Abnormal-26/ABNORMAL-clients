// Local stand-in for ops/scoreboard.gs: same contract, in memory, with the 302-after-POST
// behaviour Apps Script has, so the client's fetch path gets exercised for real.
import http from "node:http";
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

const rows = []; const echo = new Map(); let n = 0;
const json = (res, code, o, extra = {}) => { res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*", ...extra }); res.end(JSON.stringify(o)); };
http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (req.method === "GET" && u.pathname.startsWith("/echo/")) { const o = echo.get(u.pathname.slice(6)); return json(res, 200, o || { ok: false }); }
  if (req.method === "GET") {
    const pid = u.searchParams.get("pid") || ""; const live = rows.filter((r) => r.status === "live").sort((a, b) => b.score - a.score);
    const mine = live.findIndex((s) => s.pid === pid);
    return json(res, 200, { top: live.slice(0, 20).map((s) => ({ name: s.name, score: s.score, round: s.round, you: s.pid === pid })), yourRank: mine >= 0 ? mine + 1 : null, yourBest: mine >= 0 ? live[mine].score : null, runs: live.length });
  }
  if (req.method === "POST") {
    let body = ""; req.on("data", (c) => (body += c)); req.on("end", () => {
      let b; try { b = JSON.parse(body); } catch { b = {}; }
      const name = String(b.name || "").trim().slice(0, 12); const flag = screenName(name).ok ? 0 : 1; const status = flag || b.flag === 1 ? "review" : "live";
      const out = name ? { ok: true, status } : { ok: false, error: "name" };
      if (name) rows.push({ pid: String(b.pid || ""), name, score: Number(b.score), round: Number(b.round), status });
      const id = String(++n); echo.set(id, out);
      res.writeHead(302, { location: `http://127.0.0.1:8768/echo/${id}`, "access-control-allow-origin": "*" }); res.end();
    }); return;
  }
  json(res, 404, { ok: false });
}).listen(8768, "127.0.0.1", () => console.log("mock board on 8768"));

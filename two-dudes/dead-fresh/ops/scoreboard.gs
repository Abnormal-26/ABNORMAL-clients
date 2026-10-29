/**
 * DEAD FRESH — scoreboard. Google Apps Script bound to the "Dead Fresh Scoreboard" sheet.
 * Deploy as a Web app (Execute as: me, Who has access: Anyone) and paste the /exec URL
 * into <meta name="df-board"> in index.html.
 *
 * Sheet "Scores": When | Player | Name | Score | Floor | Freshened | Status | Flag
 * Status is the approval switch — live / review / rejected. Clean names go live on
 * their own; names the screen trips land in "review" and stay off the board until a
 * human flips them. Flip anything to "rejected" and it vanishes within ten seconds.
 */
var SHEET = "Scores";
var TOP = 20;

// ── name screen: shared between the game client and the scoreboard script ──
var SCREEN_STRONG = ["fuck","fuk","fck","shit","sh1t","cunt","kunt","nigg","nigr","negro","faggot","fagot","kike","spic","chink","gook","wetback","wank","twat","bitch","biatch","whore","slut","penis","vagina","pussy","dildo","blowjob","handjob","rimjob","cumshot","jizz","porn","bastard","bollock","retard","spastic","tranny","nazi","hitler","pedo","paedo","molest","felch","queef","clit","scrotum","ballsack","nutsack","motherf","muthaf","arsehole","asshole","a55hole","dickhead","cocksuck","shithead","fuckwit","goddamn","nonce","kys","isis"];
var SCREEN_WHOLE = ["ass","arse","cock","dick","dik","cum","tits","tit","anal","anus","boob","boobs","hoe","hoes","ho","dyke","coon","paki","muff","fanny","knob","sex","sexy","piss","crap","fag","fags","homo","gay","jew","jews","poo","wee","balls","nads","prick","pricks","nob","minge","slag","tart","skank","thot","simp","incel","milf","dilf","gilf","bj","bbc","69","420","rape","rapist","raped"];
var SCREEN_LEET = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "@": "a", "$": "s", "!": "i", "|": "l", "+": "t" };
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

function sheet_() {
  var ss = SpreadsheetApp.getActive(); var sh = ss.getSheetByName(SHEET);
  if (!sh) {
    sh = ss.insertSheet(SHEET);
    sh.appendRow(["When", "Player", "Name", "Score", "Floor", "Freshened", "Status", "Flag"]);
    sh.setFrozenRows(1); sh.getRange("A1:H1").setFontWeight("bold");
    sh.getRange("G2:G5000").setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(["live", "review", "rejected"], true).build());
  }
  return sh;
}
function rows_() { var sh = sheet_(); var n = sh.getLastRow(); if (n < 2) return []; return sh.getRange(2, 1, n - 1, 8).getValues(); }
function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function live_() {
  var cache = CacheService.getScriptCache(); var hit = cache.get("board");
  if (hit) return JSON.parse(hit);
  var live = rows_().filter(function (r) { return String(r[6]).toLowerCase() === "live"; })
    .map(function (r) { return { pid: String(r[1]), name: String(r[2]), score: Number(r[3]), round: Number(r[4]) }; })
    .sort(function (a, b) { return b.score - a.score; }).slice(0, 100);
  cache.put("board", JSON.stringify(live), 10);
  return live;
}
function doGet(e) {
  var pid = (e && e.parameter && e.parameter.pid) || "";
  var live = live_();
  var top = live.slice(0, TOP).map(function (s) { return { name: s.name, score: s.score, round: s.round, you: s.pid === pid }; });
  var mine = -1; for (var i = 0; i < live.length; i++) if (live[i].pid === pid) { mine = i; break; }
  return out_({ top: top, yourRank: mine >= 0 ? mine + 1 : null, yourBest: mine >= 0 ? live[mine].score : null, runs: live.length });
}
function doPost(e) {
  var b; try { b = JSON.parse(e.postData.contents); } catch (err) { return out_({ ok: false, error: "bad json" }); }
  var name = String(b.name || "").replace(/[^\x20-\x7E]/g, "").trim().slice(0, 12);
  var score = Math.round(Number(b.score)), round = Math.round(Number(b.round)), kills = Math.round(Number(b.kills));
  var pid = String(b.pid || "").replace(/[^a-z0-9]/gi, "").slice(0, 16);
  if (!name) return out_({ ok: false, error: "name" });
  if (!(score >= 0 && score <= 10000000) || !(round >= 1 && round <= 999) || !(kills >= 0 && kills <= 100000)) return out_({ ok: false, error: "range" });
  var flag = screenName(name).ok ? 0 : 1; if (b.flag === 1) flag = 1;
  var status = flag ? "review" : "live";
  var lock = LockService.getScriptLock(); lock.waitLock(5000);
  try { sheet_().appendRow([new Date(), pid, name, score, round, kills, status, flag]); CacheService.getScriptCache().remove("board"); }
  finally { lock.releaseLock(); }
  return out_({ ok: true, status: status });
}

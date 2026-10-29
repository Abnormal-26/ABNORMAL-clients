# ABNORMAL — client prototypes

Playable prototypes and working files for ABNORMAL client projects.

## Two Dudes — Dead Fresh

`two-dudes/dead-fresh/` — a browser game for the Two Dudes natural deodorant range.
First-person, office tower, B.O. zombies, a boss every five floors, a global
scoreboard with discount tiers. Runs anywhere static files are served; no build step.

- `index.html`, `client.js` — the game (vanilla JS raycaster, no dependencies)
- `img/`, `sfx/` — art, voice lines and the three soundtracks (one per scent)
- `ops/scoreboard.gs` — the scoreboard backend, a Google Apps Script bound to the
  "Dead Fresh Scoreboard" sheet; `ops/mock-board.mjs` is a local stand-in for testing
- The scoreboard endpoint is set in `<meta name="df-board">` in `index.html`

Names posted to the scoreboard pass a screen; anything it catches is held in the sheet
with Status = review until someone flips it to live or rejected.

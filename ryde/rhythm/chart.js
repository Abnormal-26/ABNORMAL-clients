/**
 * Your Rhythm: day settings, the moment cards, and the seeded chart generator.
 *
 * A day is one song: a 2-bar intro (count-in while the day banner shows), four sections
 * (morning, midday, evening, night) and an outro bar. Cards sit on an 8th-note grid (8 "slots"
 * per bar). The on-screen clock is the master: it runs 6:00 AM at the first card to 10:30 PM at
 * LIGHTS OUT, linearly in song time, and every moment has the hours it's allowed to appear in.
 * A card is only placed where its moment makes sense at that clock time, on every day.
 * Difficulty from Day 3 comes from tempo, density, off-beats and no colour, never from the
 * day's logic.
 */

export const CLOCK_START = 6, CLOCK_END = 22.5; // hours shown on the HUD clock (first card → LIGHTS OUT)

// One obvious moment, one shot. [label, [fromHour, toHour]]. Labels with a printed time
// only appear within ±40 min of it.
// ENERGY = early starts and the arvo slump · FOCUS = work/study/thinking · EXERCISE = clearly physical
// RELAX = late-arvo / evening downtime · SLEEP = night and bedtime. "LIGHTS OUT" ends every day.
export const MOMENTS = {
  energy: [
    ["6:30 ALARM", [5.83, 7.17]], ["EARLY START", [6, 8]], ["MONDAY, AGAIN", [6, 9.5]], ["FIRST DAY BACK", [6, 9]],
    ["4 DAYS TO FRIDAY", [6, 9.5]], ["3PM SLUMP", [14.33, 15.67]], ["ARVO SLUMP", [13.5, 16]],
  ],
  focus: [
    ["9:00 STAND-UP", [8.33, 9.67]], ["DEADLINE", [9, 18]], ["EXAM", [8.5, 16]], ["BIG PITCH", [9, 17]],
    ["SPREADSHEET", [9, 17.5]], ["BAS DUE", [9, 17]], ["TAX RETURN", [9, 20]], ["STUDY SESH", [9, 20.5]],
  ],
  exercise: [
    ["RUN CLUB", [6, 8]], ["PARKRUN", [7.33, 8.67]], ["OCEAN SWIM", [6, 10]], ["BOOTCAMP", [6, 8.5]],
    ["LEG DAY", [6, 20]], ["SPIN CLASS", [6, 20]], ["PILATES", [6, 20]], ["LUNCH RUN", [11.5, 14]], ["SOCIAL NETBALL", [17.5, 21]],
  ],
  relax: [
    ["FEET UP", [16, 22.5]], ["COUCH O'CLOCK", [17, 22.5]], ["FRIDAY ARVO", [16, 19]], ["BACKYARD ARVO", [16, 18.5]],
    ["TAKEAWAY NIGHT", [17.5, 21]], ["BOOK CLUB", [18, 22]], ["BATH TIME", [18.5, 22.5]], ["VEG OUT", [16, 22.5]],
  ],
  sleep: [
    ["BIG DAY TOMORROW", [21, 22.5]], ["DOONA TIME", [21, 22.5]], ["PHONE DOWN", [21.5, 22.5]], ["PJS ON", [21, 22.5]],
    ["EARLY NIGHT", [21, 22.5]], ["COUNTING SHEEP", [21.5, 22.5]],
  ],
};
export const LANES = ["energy", "focus", "exercise", "relax", "sleep"];

// Which shots a section leans on (only moments whose hours match the clock are eligible).
export const SECTIONS = [
  { id: "morning", label: "MORNING", weights: { energy: 0.35, focus: 0.35, exercise: 0.3 } },
  { id: "midday",  label: "MIDDAY",  weights: { focus: 0.5, exercise: 0.4, energy: 0.1 } },
  { id: "evening", label: "EVENING", weights: { relax: 0.45, exercise: 0.3, focus: 0.15, energy: 0.1 } },
  { id: "night",   label: "NIGHT",   weights: { relax: 0.5, sleep: 0.5, focus: 0.05, exercise: 0.05 } },
];

/** Everything that changes day to day. `next` is what the day-complete screen says about the following day. */
export function daySpec(day) {
  const d = Math.max(1, day | 0);
  const bpm = Math.min(140, 96 + (d - 1) * 10);           // 96, 106, 116, 126, 136, 140 …
  const bps = d <= 2 ? 4 : d <= 4 ? 5 : 6;                 // bars per section
  const intro = 2;
  return {
    day: d, bpm, bps, intro,
    bars: intro + 4 * bps + 1,                             // intro + sections + outro bar
    colour: d === 1 ? "full" : d === 2 ? "stripe" : "none", // how much the card tells you
    approach: Math.max(1.25, 1.9 - (d - 1) * 0.13),        // seconds a card is on screen before it lands
    key: [0, 2, 5, 7, 3, 10, 0, 2][(d - 1) % 8],            // semitones above C
    drain: Math.min(0.17, 0.09 + (d - 1) * 0.016),          // meter lost per miss / wrong shot
    tip: d === 1 ? "Match the colour." : d === 2 ? "Colours fade. Read the moment." : d === 3 ? "No colour. Faster." : d === 4 ? "Off-beats. Stay loose." : "Faster again.",
  };
}

// 8-slot bar patterns ("x" = card on that 8th). Even slots are on the beat, odd are off-beats.
const P = {
  1: ["x...x...", "x...x...", "x.x.x...", "x...x.x.", "x...x..."],
  2: ["x.x.x.x.", "x.x.x...", "x...x.x.", "x.x...x.", "x.x.x.x."],
  3: ["x.x.x.x.", "x..x..x.", "x.x..x..", "x.x.x..x", "x...x.x.", "x.x.x.x.", "x..x.x.."],
  4: ["x.x.x.x.", "x..x..x.", "x.xx.x..", "xx..x.x.", "x.x.xx.x", "x..x.xx.", "x.x..x.x", "x.x.x.x."],
};
const NIGHT = { 1: P[1], 2: ["x...x.x.", "x.x.x...", "x...x..."], 3: P[2], 4: P[3] };

/** Small seeded PRNG (mulberry32) so a seed gives the same chart every time. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function pickWeighted(r, weights) {
  const ks = Object.keys(weights).filter((k) => weights[k] > 0); let tot = 0; ks.forEach((k) => (tot += weights[k]));
  let x = r() * tot; for (const k of ks) { x -= weights[k]; if (x <= 0) return k; } return ks[ks.length - 1];
}
const inWin = (m, h) => h >= m[1][0] && h <= m[1][1];
/** Clock hour for a step, given the first and last card steps (the HUD uses the same mapping). */
export function hourAt(step, firstStep, lastStep) { return CLOCK_START + ((step - firstStep) / Math.max(1, lastStep - firstStep)) * (CLOCK_END - CLOCK_START); }

/**
 * Build a day's chart. Returns { spec, cards:[{i, step, slot, bar, lane, text, section, hour, slow}], sectionOfBar(bar), … }.
 * step = 16th-note index from the start of the song.
 */
export function buildChart(day, seed, { coach = false } = {}) {
  const spec = daySpec(day), I = spec.intro;
  const r = rng(seed * 7919 + day * 104729);
  const tier = day <= 1 ? 1 : day === 2 ? 2 : day === 3 ? 3 : 4;
  const firstBar = I, lastBar = I + 4 * spec.bps - 1;          // lastBar holds LIGHTS OUT on its downbeat
  const firstStep = firstBar * 16, lastStep = lastBar * 16;
  const recent = [];                                            // texts used lately (no repeats close together)
  const cards = []; let lastSlotAbs = -99; let run = { lane: null, n: 0 };
  for (let bar = firstBar; bar <= lastBar; bar++) {
    const secIdx = Math.min(3, Math.floor((bar - firstBar) / spec.bps));
    const sec = SECTIONS[secIdx];
    let pat;
    if (bar === lastBar) pat = "x.......";
    else if (bar === lastBar - 1) pat = tier >= 3 ? "x.x.x..." : "x...x...";   // breathe before lights out
    else if (secIdx === 3) pat = pick(r, NIGHT[tier]);
    else if (bar === firstBar) pat = tier === 1 ? "x...x..." : "x.x.x.x.";
    else pat = pick(r, P[tier]);
    for (let slot = 0; slot < 8; slot++) {
      if (pat[slot] !== "x") continue;
      const abs = bar * 8 + slot;
      if (tier < 4 && abs - lastSlotAbs < 2) continue;            // no back-to-back 8ths until day 4
      const step = abs * 2, hour = hourAt(step, firstStep, lastStep);
      let lane, text;
      if (bar === lastBar) { lane = "sleep"; text = "LIGHTS OUT"; }
      // Day 1 always opens on the alarm then run club (both fit 6 AM). On a first run they fall slowly.
      else if (day === 1 && cards.length < 2) { [lane, text] = cards.length ? ["exercise", "RUN CLUB"] : ["energy", "6:30 ALARM"]; }
      else {
        // only shots with a moment that fits the clock right now
        const prev = cards.length ? cards[cards.length - 1].text : "";
        const ok = {}; for (const k of LANES) ok[k] = MOMENTS[k].filter((m) => inWin(m, hour) && m[0] !== prev);
        const w = {};
        for (const k of LANES) if (ok[k].length) w[k] = (sec.weights[k] || 0) + (tier >= 3 ? 0.05 * (tier - 2) : 0);
        if (!Object.values(w).some((v) => v > 0)) for (const k of LANES) if (ok[k].length) w[k] = 1;
        if (tier >= 2 && run.n >= 2 && w[run.lane] && Object.keys(w).filter((k) => w[k] > 0).length > 1) w[run.lane] = 0;
        lane = pickWeighted(r, w);
        const fresh = ok[lane].filter((m) => !recent.includes(m[0]));
        const pool = fresh.length ? fresh : ok[lane];
        text = pool[Math.floor(r() * pool.length)][0];
      }
      run = run.lane === lane ? { lane, n: run.n + 1 } : { lane, n: 1 };
      recent.push(text); if (recent.length > 6) recent.shift();
      cards.push({ i: cards.length, step, slot, bar, lane, text, section: sec.id, hour: +hour.toFixed(2), slow: day === 1 && coach && cards.length < 2 });
      lastSlotAbs = abs;
    }
  }
  const sectionOfBar = (bar) => (bar < firstBar ? "intro" : bar > lastBar ? "outro" : SECTIONS[Math.min(3, Math.floor((bar - firstBar) / spec.bps))].id);
  return { spec, cards, sectionOfBar, firstBar, lastBar, firstStep, lastStep, totalSteps: spec.bars * 16 };
}
function pick(r, arr) { return arr[Math.floor(r() * arr.length)]; }

/**
 * Drop Shot sound: a gentle lo-fi loop (84 BPM, Fmaj7 – Dm9 – B♭maj7 – C6/9) plus SFX that
 * sit in the same key, so merges and chains play as a melody. Built on ../shared/audio.js.
 */
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
// F major pentatonic, from C5 up: merges walk up this as tiers and chains rise
const PENTA = [72, 74, 77, 79, 81, 84, 86, 89, 91, 93, 96, 98];
const PROG = [[53, 57, 60, 64, 67], [50, 53, 57, 60, 64], [46, 50, 53, 57, 60], [48, 52, 55, 57, 62]];
const ROOT = [41, 38, 34, 36];

export function createSound(A) {
  let bus = null, sfx = null, seq = null, lastClink = 0, warnAt = 0;
  const S = { A };

  function ensure() {
    const C = A.init();
    if (!bus) {
      const lp = C.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 2100; lp.Q.value = 0.4;
      bus = C.createGain(); bus.gain.value = 0.6; bus.connect(lp); lp.connect(A.music);
      sfx = C.createGain(); sfx.gain.value = 0.85; sfx.connect(A.master);
    }
    return C;
  }
  S.init = ensure;

  // soft electric-piano voice for the chords
  function ep(m, when, dur, vol) {
    const C = A.ctx, f = mtof(m) * Math.pow(2, ((Math.random() - 0.5) * 8) / 1200);   // a touch of tape wobble
    const g = C.createGain(), o1 = C.createOscillator(), o2 = C.createOscillator(), g2 = C.createGain();
    o1.type = "sine"; o2.type = "triangle"; o1.frequency.value = f; o2.frequency.value = f * 2.003; g2.gain.value = 0.16;
    o1.connect(g); o2.connect(g2); g2.connect(g);
    g.gain.setValueAtTime(0.0001, when); g.gain.linearRampToValueAtTime(vol, when + 0.012);
    g.gain.exponentialRampToValueAtTime(vol * 0.35, when + 0.35); g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    g.connect(bus); o1.start(when); o2.start(when); o1.stop(when + dur + 0.05); o2.stop(when + dur + 0.05);
  }
  // glassy bell for merges
  function bell(m, when, vol = 0.16, dur = 1.1) {
    const C = A.ctx, f = mtof(m);
    [[1, vol, dur], [2.76, vol * 0.22, dur * 0.45], [5.4, vol * 0.07, dur * 0.2]].forEach(([k, v, d]) => {
      if (f * k > 16000) return;                       // drop overtones above 16 kHz (inaudible, and out of range on high chain notes)
      const o = C.createOscillator(), g = C.createGain(); o.type = "sine"; o.frequency.value = f * k;
      g.gain.setValueAtTime(0.0001, when); g.gain.exponentialRampToValueAtTime(v, when + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, when + d);
      o.connect(g); g.connect(sfx); o.start(when); o.stop(when + d + 0.05);
    });
  }

  S.startMusic = () => {
    const C = ensure();
    if (seq) return;
    A.music.gain.cancelScheduledValues(C.currentTime); A.music.gain.setValueAtTime(0.0001, C.currentTime); A.music.gain.exponentialRampToValueAtTime(0.5, C.currentTime + 1.2);
    seq = A.sequence(84, (i, t) => {
      const st = i % 16, bar = Math.floor(i / 16) % 4, sw = i % 2 ? 0.032 : 0, tt = t + sw;
      if (st === 0) { PROG[bar].forEach((m, k) => ep(m, tt + k * 0.012, 2.6, 0.05)); A.bass(mtof(ROOT[bar]), tt, 0.7, 0.2); A.kick(tt, 0.32); }
      if (st === 7) PROG[bar].slice(2).forEach((m) => ep(m + 12, tt, 0.9, 0.022));
      if (st === 10) { A.bass(mtof(ROOT[bar] + 7), tt, 0.35, 0.13); A.kick(tt, 0.18); }
      if (st === 4 || st === 12) { A.noise(0.09, { vol: 0.07, f: 2400, q: 1.1, when: tt, dest: A.music }); A.tone(330, 0.05, { type: "triangle", vol: 0.03, when: tt, dest: A.music }); }
      if (st % 4 === 2) A.hat(tt, 0.045); else if (st % 2 === 1) A.hat(tt, 0.016);
      if (Math.random() < 0.22) A.noise(0.015, { vol: 0.012, f: 5000 + Math.random() * 3000, q: 2, when: tt + Math.random() * 0.1, dest: A.music });   // vinyl dust
    });
  };
  S.stopMusic = (fade = 0.8) => {
    if (!seq || !A.ctx) return;
    const C = A.ctx, s = seq; seq = null;
    A.music.gain.cancelScheduledValues(C.currentTime); A.music.gain.setValueAtTime(A.music.gain.value, C.currentTime); A.music.gain.exponentialRampToValueAtTime(0.0001, C.currentTime + fade);
    setTimeout(() => s.stop(), fade * 1000 + 50);
  };

  S.drop = () => { if (!A.ctx) return; A.tone(640, 0.09, { vol: 0.07, slide: 360, dest: sfx }); A.noise(0.05, { vol: 0.03, f: 1800, q: 0.6, dest: sfx }); };
  /** contact clink: size 0..1 (small → big), speed u/s */
  S.clink = (size, speed) => {
    if (!A.ctx) return; const now = A.ctx.currentTime; if (now - lastClink < 0.045) return; lastClink = now;
    const v = Math.min(1, (speed - 1.2) / 10);
    if (size < 0.45) A.tone(2300 - size * 1400 + Math.random() * 200, 0.05, { vol: 0.02 + v * 0.05, dest: sfx });
    else { A.tone(260 - size * 90, 0.12, { vol: 0.05 + v * 0.1, slide: 120, dest: sfx }); A.noise(0.06, { vol: 0.03 + v * 0.06, f: 700, q: 0.7, type: "lowpass", dest: sfx }); }
  };
  /** merge into tier (2..8) as part of a chain of length combo (1..) */
  S.merge = (tier, combo) => {
    if (!A.ctx) return; const now = A.ctx.currentTime;
    const idx = Math.min(PENTA.length - 1, tier - 2 + Math.min(combo - 1, 4));
    bell(PENTA[idx], now, 0.14 + tier * 0.008);
    if (combo > 1) bell(PENTA[idx] + 12, now + 0.07, 0.05, 0.6);
    A.noise(0.07, { vol: 0.05, f: 3200, q: 0.8, dest: sfx });
    A.tone(180 + tier * 18, 0.1, { type: "sine", vol: 0.08, slide: 90, dest: sfx });
  };
  S.yourDay = () => {
    if (!A.ctx) return; const now = A.ctx.currentTime;
    [65, 69, 72, 76, 79, 84].forEach((m, i) => bell(m, now + i * 0.055, 0.11, 1.8));
    [41, 53].forEach((m) => ep(m, now, 2.5, 0.12));
  };
  S.wellbeing = () => {
    if (!A.ctx) return; const now = A.ctx.currentTime;
    PENTA.forEach((m, i) => bell(m, now + i * 0.06, 0.1, 1.2));
    [65, 69, 72, 76, 79].forEach((m) => bell(m + 12, now + 0.8, 0.07, 2.4));
    A.noise(1.4, { vol: 0.05, f: 7000, q: 0.5, type: "highpass", when: now + 0.1, dest: sfx });
  };
  S.discover = () => { if (!A.ctx) return; const now = A.ctx.currentTime; bell(96, now, 0.05, 0.5); bell(100, now + 0.07, 0.04, 0.5); };
  /** called every frame while over the line; t = seconds over */
  S.warn = (t) => {
    if (!A.ctx) return; const now = A.ctx.currentTime; if (now < warnAt) return; warnAt = now + Math.max(0.22, 0.5 - t * 0.14);
    A.tone(196 + t * 40, 0.16, { type: "triangle", vol: 0.09, dest: sfx });
  };
  S.cap = () => {
    if (!A.ctx) return; const now = A.ctx.currentTime;
    for (let i = 0; i < 7; i++) A.noise(0.018, { vol: 0.11, f: 4200, q: 3, when: now + 0.62 + i * 0.07, dest: sfx });
    A.tone(150, 0.32, { vol: 0.32, slide: 55, when: now + 1.12, dest: sfx }); A.noise(0.16, { vol: 0.22, f: 500, q: 0.6, type: "lowpass", when: now + 1.12, dest: sfx });
    [77, 72, 69, 65].forEach((m, i) => bell(m, now + 1.3 + i * 0.12, 0.08, 1.4));
  };
  S.ui = () => { if (!A.ctx) return; A.tone(880, 0.06, { vol: 0.05, dest: sfx }); };
  S.suspend = () => { try { A.ctx && A.ctx.suspend(); } catch {} };
  S.resume = () => { try { A.ctx && A.ctx.resume(); } catch {} };
  return S;
}

/**
 * Your Rhythm: the procedural soundtrack. Uses the shared audio kit's AudioContext and its
 * music/master buses (ryde/shared/audio.js) but brings its own voices, because the groove needs a
 * filtered bass, chord stabs and a kick-ducked chord bus that the shared kit doesn't have.
 *
 * A day is one song. game.js drives it from the shared look-ahead sequencer:
 *   music.begin(song)            // fresh buses for this song
 *   music.step(stepIndex, time)  // called ~100 ms ahead for every 16th note
 *   music.hit(lane, when)        // the pad melody (each shot is a note of the pentatonic)
 */
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

// chord voicings (semitones above the key's C4) and bass roots
const VOICE = { I: [0, 4, 7], V: [-1, 2, 7], vi: [0, 4, 9], IV: [0, 5, 9], IV7: [0, 4, 5, 9], iii7: [-1, 2, 4, 7], vi7: [0, 4, 7, 9], V7: [-1, 2, 5, 7], Iadd9: [0, 2, 4, 7] };
const ROOT = { I: 0, V: 7, vi: 9, IV: 5, IV7: 5, iii7: 4, vi7: 9, V7: 7, Iadd9: 0 };
const PROG = {
  intro: ["I"],
  morning: ["I", "V", "vi", "IV"],          // bright
  midday: ["vi", "IV", "I", "V"],           // driving
  evening: ["IV7", "iii7", "vi7", "V7"],    // warmer, sevenths
  night: ["vi7", "IV7", "Iadd9", "Iadd9"],  // mellow, filter closing
  outro: ["Iadd9"],
};
// bass lines on 16ths: 0 = root, 7 = fifth, o = octave up, "-" = rest, "~" = hold
const BASS = {
  intro:   "0-------0---0-7-",
  morning: "0--0--o--0--0-7-",
  midday:  "0-o--0-0--o-0-7-",
  evening: "0~~~--0-0~~~7---",
  night:   "0~~~~~~~0~~~~~~~",
};
// pad melody: energy → sleep runs down the major pentatonic, so LIGHTS OUT (sleep) is the tonic
const PAD_NOTES = [9, 7, 4, 2, 0];

export function createMusic(A) {
  const M = { song: null };
  let bus = null, duck = null, hats = null;

  /** New buses per song so a fade-out can never leak into the next one. */
  M.begin = (song) => {
    const C = A.ctx; M.song = song;
    if (bus) { try { bus.disconnect(); } catch {} }
    const comp = C.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 3.5; comp.attack.value = 0.004; comp.release.value = 0.15;
    bus = C.createGain(); bus.gain.value = 1.5; bus.connect(comp); comp.connect(A.music);
    duck = C.createGain(); duck.gain.value = 1; duck.connect(bus);   // chords + bass, pumped by the kick
    hats = C.createGain(); hats.gain.value = 1; hats.connect(bus);
    M.bus = bus;
  };
  /** Fade the song out (game over / quit). */
  M.fadeOut = (dur = 0.5) => {
    if (!bus || !A.ctx) return; const t = A.ctx.currentTime, b = bus;
    b.gain.cancelScheduledValues(t); b.gain.setValueAtTime(b.gain.value, t); b.gain.linearRampToValueAtTime(0.0001, t + dur);
    setTimeout(() => { try { b.disconnect(); } catch {} }, dur * 1000 + 300);
  };

  // ---------- voices ----------
  const env = (g, t, a, peak, d) => { g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); };
  let noiseBuf = null;
  const noiseSrc = () => {
    const C = A.ctx;
    if (!noiseBuf) { noiseBuf = C.createBuffer(1, C.sampleRate, C.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
    const s = C.createBufferSource(); s.buffer = noiseBuf; return s;
  };
  const noise = (t, dur, { f = 3000, q = 0.8, type = "bandpass", vol = 0.2, dest = bus, a = 0.002 } = {}) => {
    const C = A.ctx, s = noiseSrc(), bf = C.createBiquadFilter(), g = C.createGain();
    bf.type = type; bf.frequency.value = f; bf.Q.value = q; env(g, t, a, vol, dur);
    s.connect(bf); bf.connect(g); g.connect(dest); s.start(t, Math.random() * 0.6); s.stop(t + a + dur + 0.05);
  };
  const osc = (t, type, f, dur, vol, dest, { a = 0.004, slide = 0 } = {}) => {
    const C = A.ctx, o = C.createOscillator(), g = C.createGain(); o.type = type; o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur * 0.6);
    env(g, t, a, vol, dur); o.connect(g); g.connect(dest); o.start(t); o.stop(t + a + dur + 0.05); return o;
  };
  M.kick = (t, v = 1) => {
    const C = A.ctx, o = C.createOscillator(), g = C.createGain();
    o.type = "sine"; o.frequency.setValueAtTime(165, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.11);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.95 * v, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
    o.connect(g); g.connect(bus); o.start(t); o.stop(t + 0.45);
    noise(t, 0.012, { f: 4000, type: "highpass", vol: 0.12 * v });
    // sidechain pump on the chord/bass bus: the thing that makes it groove
    duck.gain.cancelScheduledValues(t); duck.gain.setValueAtTime(0.42, t); duck.gain.linearRampToValueAtTime(1, t + 0.19);
  };
  M.snare = (t, v = 1) => { noise(t, 0.17, { f: 1900, q: 0.7, vol: 0.32 * v }); osc(t, "triangle", 210, 0.08, 0.16 * v, bus, { slide: 150 }); };
  M.clap = (t, v = 1) => { for (let i = 0; i < 3; i++) noise(t + i * 0.011, 0.03, { f: 1300, q: 1.1, vol: 0.26 * v }); noise(t + 0.033, 0.16, { f: 1200, q: 0.9, vol: 0.22 * v }); };
  M.hat = (t, v = 1, open = false) => noise(t, open ? 0.2 : 0.035, { f: open ? 7500 : 9000, q: 1.1, type: "highpass", vol: (open ? 0.09 : 0.11) * v, dest: hats });
  M.rim = (t, v = 1) => { osc(t, "square", 1650, 0.025, 0.06 * v, bus); osc(t, "sine", 820, 0.04, 0.09 * v, bus); };
  M.crash = (t, v = 1) => noise(t, 1.6, { f: 5200, type: "highpass", vol: 0.12 * v, a: 0.004 });
  M.bass = (midi, t, dur, v = 1) => {
    const C = A.ctx, o = C.createOscillator(), o2 = C.createOscillator(), lp = C.createBiquadFilter(), g = C.createGain();
    o.type = "sawtooth"; o2.type = "square"; o.frequency.value = mtof(midi); o2.frequency.value = mtof(midi - 12);
    lp.type = "lowpass"; lp.Q.value = 6; lp.frequency.setValueAtTime(1500, t); lp.frequency.exponentialRampToValueAtTime(240, t + Math.min(0.25, dur));
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.26 * v, t + 0.006); g.gain.setValueAtTime(0.22 * v, t + dur * 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.06);
    const o2g = C.createGain(); o2g.gain.value = 0.45;
    o.connect(lp); o2.connect(o2g); o2g.connect(lp); lp.connect(g); g.connect(duck);
    o.start(t); o2.start(t); o.stop(t + dur + 0.1); o2.stop(t + dur + 0.1);
  };
  /** detuned-saw chord through a lowpass: short = stab, long = pad */
  M.chord = (notes, t, dur, { v = 1, cutoff = 2400, a = 0.005, type = "sawtooth" } = {}) => {
    const C = A.ctx, lp = C.createBiquadFilter(), g = C.createGain();
    lp.type = "lowpass"; lp.frequency.setValueAtTime(cutoff, t); lp.frequency.exponentialRampToValueAtTime(Math.max(300, cutoff * 0.45), t + dur); lp.Q.value = 1.2;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.075 * v, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + dur);
    lp.connect(g); g.connect(duck);
    for (const n of notes) for (const det of [-8, 7]) {
      const o = C.createOscillator(); o.type = type; o.frequency.value = mtof(n); o.detune.value = det; o.connect(lp); o.start(t); o.stop(t + a + dur + 0.05);
    }
  };
  M.pluck = (midi, t, v = 1) => { osc(t, "triangle", mtof(midi), 0.16, 0.06 * v, duck); osc(t, "sine", mtof(midi + 12), 0.08, 0.03 * v, duck); };

  /** The pad melody note, straight to master so it's never ducked. Marimba-ish: fundamental + bright partials. */
  M.hit = (lane, when, { perfect = false } = {}) => {
    if (!A.ctx) return; const t = when ?? A.ctx.currentTime, key = M.song ? M.song.spec.key : 0;
    const m = 72 + key + PAD_NOTES[lane] - (key > 6 ? 12 : 0);
    osc(t, "sine", mtof(m), 0.42, 0.26, A.master, { a: 0.002 });
    osc(t, "triangle", mtof(m), 0.2, 0.08, A.master, { a: 0.002 });
    osc(t, "sine", mtof(m) * 4.01, 0.07, 0.035, A.master, { a: 0.001 });
    if (perfect) osc(t + 0.004, "sine", mtof(m + 12), 0.22, 0.05, A.master, { a: 0.002 });
  };
  /** wrong shot / miss: a muted thunk, no pitch */
  M.thunk = (t) => { if (!A.ctx) return; t = t ?? A.ctx.currentTime; osc(t, "triangle", 110, 0.14, 0.22, A.master, { slide: 60 }); noise(t, 0.08, { f: 400, type: "lowpass", vol: 0.25, dest: A.master }); };
  /** stray tap with nothing to hit: tiny tick so pads never feel dead */
  M.tick = (lane) => { if (!A.ctx) return; const key = M.song ? M.song.spec.key : 0; osc(A.ctx.currentTime, "sine", mtof(60 + key + PAD_NOTES[lane]), 0.06, 0.05, A.master); };
  M.comboUp = (level) => { if (!A.ctx) return; const t = A.ctx.currentTime, key = M.song ? M.song.spec.key : 0; [0, 4, 7, 12].forEach((s, i) => osc(t + i * 0.045, "square", mtof(72 + key + s + level * 2), 0.09, 0.03, A.master)); };
  M.comboBreak = () => { if (!A.ctx) return; const t = A.ctx.currentTime; osc(t, "sawtooth", 330, 0.12, 0.05, A.master, { slide: 120 }); };
  M.tapeStop = () => {
    if (!A.ctx) return; const t = A.ctx.currentTime;
    osc(t, "sawtooth", 220, 0.7, 0.09, A.master, { slide: 38, a: 0.01 }); osc(t, "sine", 110, 0.8, 0.2, A.master, { slide: 30, a: 0.01 });
  };
  M.clearFanfare = (t) => { if (!A.ctx) return; t = t ?? A.ctx.currentTime; const key = M.song ? M.song.spec.key : 0; [0, 4, 7, 11, 14].forEach((s, i) => osc(t + i * 0.07, "triangle", mtof(72 + key + s), 0.5, 0.07, A.master)); };
  M.countBlip = (n) => { if (!A.ctx || A.ctx.state !== "running") return; osc(A.ctx.currentTime, "sine", n ? 880 : 1320, 0.1, 0.12, A.master); };

  /**
   * Schedule everything for one 16th step. step counts from the start of the song (bar 0 = intro).
   */
  M.step = (step, t) => {
    const song = M.song; if (!song || !bus) return;
    const bar = Math.floor(step / 16), s = step % 16, sd = 60 / song.spec.bpm / 4;
    if (bar >= song.spec.bars) return;
    const sec = song.sectionOfBar(bar);
    const house = song.spec.bpm >= 115;
    const swing = house ? 0.05 : 0.17;                       // late odd 16ths on the hats = groove
    const sw = s % 2 === 1 ? sd * swing : 0;
    const keyC = 60 + song.spec.key - (song.spec.key > 6 ? 12 : 0);
    const prog = PROG[sec] || PROG.intro;
    const barIn = sec === "intro" || sec === "outro" ? 0 : (bar - song.firstBar) % song.spec.bps;
    let ch = prog[barIn % prog.length];

    // ---- the LIGHTS OUT bar: one big tonic and a long tail ----
    if (bar === song.lastBar) {
      if (s === 0) { M.kick(t, 0.9); M.crash(t, 1); M.chord(VOICE.Iadd9.map((n) => n + keyC), t, 3.2, { v: 1.4, cutoff: 1800, a: 0.01 }); M.bass(keyC - 24, t, 2.2, 1); }
      if (s === 8) M.rim(t, 0.6);
      return;
    }
    if (sec === "outro") return; // the tail rings out

    const notes = VOICE[ch].map((n) => n + keyC), root = keyC - 24 + ROOT[ch];
    // ---- drums ----
    if (sec === "intro") {
      const countIn = bar === song.firstBar - 1;               // last intro bar counts you in
      if (s === 0 || (!countIn && s === 8)) M.kick(t, 0.8);
      if (countIn && s % 4 === 0) M.rim(t, s === 0 ? 1 : 0.75);
      if (s % 2 === 0) M.hat(t + sw, countIn ? 0.75 : 0.5);
    } else if (sec === "night") {
      if (s === 0 || s === 8) M.kick(t, 0.7);
      if (s === 10 && !house) M.kick(t, 0.45);
      if (s === 4 || s === 12) M.rim(t, 0.8);
      if (s % 4 === 2) M.hat(t + sw, 0.55);
    } else if (house) {
      if (s % 4 === 0) M.kick(t, 1);
      if (s === 4 || s === 12) { M.clap(t, 1); if (sec !== "morning") M.snare(t, 0.4); }
      if (s % 4 === 2) M.hat(t, 0.9, true);
      else if (sec !== "morning" || s % 2 === 0) M.hat(t + sw, s % 2 ? 0.45 : 0.75);
      if (sec === "evening" && s === 14 && barIn % 2 === 1) M.snare(t, 0.3);
    } else {
      // boom-bap-ish pocket for the slower days
      if (s === 0 || s === 10 || (s === 7 && barIn % 2 === 1)) M.kick(t, s === 0 ? 1 : 0.8);
      if (s === 4 || s === 12) { M.snare(t, 1); if (sec === "midday") M.clap(t, 0.5); }
      if (s % 2 === 0) M.hat(t + sw, s % 4 === 0 ? 0.8 : 0.55);
      else if (sec !== "morning") M.hat(t + sw, 0.3);
      if (s === 15 && barIn % 4 === 3) M.snare(t + sw, 0.35);
    }
    // ---- bass ----
    const bl = BASS[sec] || BASS.intro, c = bl[s];
    if (c !== "-" && c !== "~") {
      let n = s; while (n + 1 < 16 && bl[n + 1] === "~") n++;
      const v = c === "o" ? 12 : c === "7" ? 7 : 0;
      M.bass(root + v, t, (n - s + 1) * sd * 0.92, sec === "night" ? 0.8 : 1);
    }
    // ---- chords ----
    if (sec === "morning") {
      if (s === 2 || s === 6 || s === 10 || s === 14) M.chord(notes, t, sd * 1.5, { v: 0.9, cutoff: 3200 });
    } else if (sec === "midday") {
      if ([0, 3, 6, 10, 12].includes(s)) M.chord(notes, t, sd * (s === 0 ? 2.5 : 1.4), { v: 0.9, cutoff: 2800 });
      if (s % 2 === 1) M.pluck(notes[(s >> 1) % notes.length] + 12, t + sw, 0.8); // little arp up top
    } else if (sec === "evening") {
      if (s === 0) M.chord(notes, t, sd * 6, { v: 1, cutoff: 1900, a: 0.02 });
      if (s === 6 || s === 10) M.chord(notes, t, sd * 1.6, { v: 0.6, cutoff: 1500 });
    } else if (sec === "night") {
      if (s === 0) M.chord(notes, t, sd * 15, { v: 1.1, cutoff: 1100 - Math.min(500, barIn * 90), a: 0.18, type: "triangle" });
    }
  };
  return M;
}

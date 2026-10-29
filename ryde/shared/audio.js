/**
 * Tiny WebAudio kit: synthesised SFX and a step sequencer so music stays in sync with gameplay
 * (no audio files to download). Call audio.init() from a user gesture (the Play button).
 */
export function createAudio() {
  const A = { ctx: null, master: null, music: null, muted: false, timer: 0 };
  try { A.muted = localStorage.getItem("ryde:mute") === "1"; } catch {}
  A.init = () => {
    if (A.ctx) { if (A.ctx.state === "suspended") A.ctx.resume(); return A.ctx; }
    const C = new (window.AudioContext || window.webkitAudioContext)(); A.ctx = C;
    A.master = C.createGain(); A.master.gain.value = A.muted ? 0 : 0.9; A.master.connect(C.destination);
    A.music = C.createGain(); A.music.gain.value = 0.5; A.music.connect(A.master);
    return C;
  };
  A.setMuted = (m) => { A.muted = m; try { localStorage.setItem("ryde:mute", m ? "1" : "0"); } catch {} if (A.master) A.master.gain.setTargetAtTime(m ? 0 : 0.9, A.ctx.currentTime, 0.03); };
  A.now = () => (A.ctx ? A.ctx.currentTime : 0);
  /** one oscillator note. when = absolute ctx time (default now) */
  A.tone = (freq, dur = 0.15, { type = "sine", vol = 0.25, when, slide, dest } = {}) => {
    if (!A.ctx) return; const C = A.ctx, t = when ?? C.currentTime;
    const o = C.createOscillator(), g = C.createGain(); o.type = type; o.frequency.setValueAtTime(freq, t); if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || A.master); o.start(t); o.stop(t + dur + 0.05);
  };
  let noiseBuf = null;
  A.noise = (dur = 0.1, { vol = 0.2, f = 3000, q = 0.8, type = "bandpass", when, dest } = {}) => {
    if (!A.ctx) return; const C = A.ctx, t = when ?? C.currentTime;
    if (!noiseBuf) { noiseBuf = C.createBuffer(1, C.sampleRate, C.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
    const s = C.createBufferSource(); s.buffer = noiseBuf; const bf = C.createBiquadFilter(); bf.type = type; bf.frequency.value = f; bf.Q.value = q;
    const g = C.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(bf); bf.connect(g); g.connect(dest || A.master); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  };
  // drum voices for the sequencer
  A.kick = (when, vol = 0.9) => A.tone(150, 0.32, { type: "sine", vol, when, slide: 42, dest: A.music });
  A.snare = (when, vol = 0.35) => { A.noise(0.16, { vol, f: 1800, q: 0.7, when, dest: A.music }); A.tone(190, 0.08, { type: "triangle", vol: vol * 0.5, when, dest: A.music }); };
  A.hat = (when, vol = 0.12) => A.noise(0.04, { vol, f: 9000, q: 1.2, type: "highpass", when, dest: A.music });
  A.bass = (freq, when, dur = 0.22, vol = 0.32) => A.tone(freq, dur, { type: "triangle", vol, when, dest: A.music });
  A.pluck = (freq, when, dur = 0.18, vol = 0.14) => { A.tone(freq, dur, { type: "square", vol: vol * 0.5, when, dest: A.music }); A.tone(freq * 2, dur * 0.7, { type: "sine", vol: vol * 0.6, when, dest: A.music }); };
  /**
   * Look-ahead sequencer. onStep(stepIndex, timeOfStep) is called ~100ms ahead of each 16th note.
   * Returns { stop(), startTime, stepDur }. Use startTime + n * stepDur to know when beat n lands.
   */
  A.sequence = (bpm, onStep, { startDelay = 0.12 } = {}) => {
    A.init(); const C = A.ctx; const stepDur = 60 / bpm / 4; const startTime = C.currentTime + startDelay;
    let next = 0; let alive = true;
    const pump = () => { if (!alive) return; while (startTime + next * stepDur < C.currentTime + 0.12) { onStep(next, startTime + next * stepDur); next++; } A.timer = setTimeout(pump, 25); };
    pump();
    return { stop() { alive = false; clearTimeout(A.timer); }, startTime, stepDur };
  };
  return A;
}

// ═════════════════════════ 1 · Audio analysis ═════════════════════════
// One analysis layer for every scene. What it publishes, and which envelope to use for what:
//
//   bands / bass, mid, high, level      fast (≈25 ms up, ≈110 ms down)      LIGHT only: glow, emissive, sparkle
//   bandsS / bassS, midS, highS, levelS slow (≈90 ms up, ≈400 ms down)      GEOMETRY: size, displacement, camera, speed
//   kick                                eased impulse: zero slope at the hit, top at ≈60 ms, gone by ≈550 ms.
//                                       Safe for geometry and for light that covers a lot of the screen.
//   kickL                               quicker twin (top at ≈35 ms, ≈200 ms tail) for small glints only
//   snare                               the same eased shape, fired by broadband mid/high onsets
//   pulse[8]                            the age in seconds of the last eight pulses, so a ring or wave can grow from
//                                       its own beat and fade at both ends; nothing ever has to wrap or restart.
//                                       A pulse needs 0.4 s since the last one, so a slot is at least 3.2 s old when it
//                                       is reused: longer than any ring lives, and no ring is ever cut short
//   dyn                                 0..1, how full the music is now against its own recent peak (≈1 s smoothing):
//                                       the section-level dynamics. Use it to scale whole forms and moods.
//   drop                                eased impulse (≈0.2 s up, ≈1.5 s down) when the energy jumps after a lull:
//                                       the chorus arriving. Use it for the big, rare gestures.
//   accent                              eased impulse (≈0.3 s up, ≈1.5 s down) on the strong beats: a kick clearly harder
//                                       than the recent ones, at most every 1.7 s and at least every 3.5 s. For slow, phrased gestures.
//   notes / hats (counters)             onsets in the mids (a note starting: noteBand says where, 0..1, noteAmp how hard)
//                                       and in the top octave (hatAmp). Scenes watch the counters to place their own events.
//   slow history texture (512×1)        dyn, accent, slow bass and slow level over the last ≈17 s, for waves that should
//                                       cross a scene at walking pace (gusts over a field)
//   hit[0..2] (low, mid, high)          onsets found on a second, short FFT (1024 samples, no smoothing), so they are
//                                       known within a frame or two of the sound. Each has n (a counter), amp (0..1, how
//                                       hard against the recent hardest), fast (jumps on the onset, gone in ≈150 ms: for
//                                       light), slow (eased, for form) and lvl (the band's level now). The threshold
//                                       adapts to the material, so busy music does not fire it constantly.
//   spectrum texture (256×1, RG)        R = fast bands, G = slow bands
//   waterfall texture (128×256, R16F)   the spectrum's last ≈4 s as a ring buffer, read with a fractional head
//   waveform texture (512×1)            trigger-aligned and averaged over ≈70 ms, so the trace stands still and
//                                       anything it displaces moves like geometry, not like noise
//
// Porting note: everything here is plain arithmetic on an FFT magnitude array. On native platforms feed the
// same code from the player's tap (vDSP / Oboe FFT); nothing below depends on Web Audio except audioInit().
const QS = new URLSearchParams(location.search), MUTED = QS.has('mute');
const BANDS = 256, WAVE = 512, HIST_W = 128, HIST_H = 256, HIST_HZ = 60;
const A = {
  ctx: null, analyser: null, bus: null, out: null, synth: null, mediaSrc: null, micSrc: null, source: 'none',
  freq: null, time: null, binOf: null, bandHz: new Float32Array(BANDS),
  bands: new Float32Array(BANDS), bandsS: new Float32Array(BANDS), bandsM: new Float32Array(BANDS), prevV: new Float32Array(BANDS),
  specU8: new Uint8Array(BANDS * 2), wave: new Float32Array(WAVE), waveU8: new Uint8Array(WAVE), histRow: new Float32Array(HIST_W),
  bass: 0, mid: 0, high: 0, level: 0, bassS: 0, midS: 0, highS: 0, levelS: 0,
  kickF: 0, kickR: 0, kickA: 0, kick: 0, kickL: 0, snareF: 0, snareR: 0, snareA: 0, snare: 0,
  dyn: 0, drop: 0, dropR: 0, dropA: 0, eLong: 0, ePeak: 0.15, sinceDrop: 9,
  accent: 0, accentR: 0, accentA: 0, accents: 0, kickAmp: 1, kMean: 1, sinceAccent: 9,
  notes: 0, noteBand: 0.5, noteAmp: 0, nAvg: 0, sinceNote: 9, hats: 0, hatAmp: 0, hAvg: 0, sinceHat: 9, bassVS: 0, levelVS: 0,
  slowRow: new Float32Array(4), slowAcc: 0,
  fast: null, fastF: null, hit: [0, 1, 2].map(() => ({ n: 0, amp: 0, imp: 0, fast: 0, slow: 0, slowA: 0, hold: 0, lvl: 0, prev: 0, mean: 0, dev: 0.3, peak: 0.8, top: 1, since: 9 })),
  hitLin: new Float32Array(3), hitFast: new Float32Array(3), hitSlow: new Float32Array(3), hitLvl: new Float32Array(3),
  beat: 0, snares: 0, pulse: new Float32Array(8).fill(9), pulseAt: 0, sincePulse: 9, fluxAvg: 0, prevLow: 0, sfluxAvg: 0, agc: 1, agcPeak: 0.9,
};
for (let i = 0; i < BANDS; i++) A.bandHz[i] = 28 * Math.pow(16000 / 28, i / BANDS);   // log-spaced, 28 Hz – 16 kHz

function audioInit() {
  if (A.ctx) return;
  const ctx = A.ctx = new (window.AudioContext || window.webkitAudioContext)();
  A.bus = ctx.createGain();
  A.analyser = ctx.createAnalyser();
  A.analyser.fftSize = 4096; A.analyser.smoothingTimeConstant = 0.55;
  A.analyser.minDecibels = -92; A.analyser.maxDecibels = -18;
  A.out = ctx.createGain(); A.out.gain.value = MUTED ? 0 : +vol.value;     // ?mute: the output stays at zero for the whole session
  A.fast = ctx.createAnalyser(); A.fast.fftSize = 1024; A.fast.smoothingTimeConstant = 0; A.fast.minDecibels = -100; A.fast.maxDecibels = -10;
  A.fastF = new Float32Array(512);
  A.bus.connect(A.analyser); A.bus.connect(A.fast); A.bus.connect(A.out); A.out.connect(ctx.destination);
  A.freq = new Float32Array(A.analyser.frequencyBinCount);
  A.time = new Float32Array(A.analyser.fftSize);
  const ny = ctx.sampleRate / 2, n = A.analyser.frequencyBinCount;
  A.binOf = new Array(BANDS + 1);
  for (let i = 0; i <= BANDS; i++) A.binOf[i] = Math.min(n - 1, Math.max(1, Math.round(28 * Math.pow(16000 / 28, i / BANDS) / ny * n)));
}

function stopSources() {
  if (A.synth) { A.synth.stop(); A.synth = null; }
  media.pause();
  if (A.micSrc) { A.micSrc.mediaStream.getTracks().forEach(t => t.stop()); A.micSrc.disconnect(); A.micSrc = null; }
}
async function useDemo() {
  audioInit(); await A.ctx.resume(); stopSources();
  A.synth = new DemoSynth(A.ctx, A.bus); A.synth.start();
  A.source = 'demo'; setNow('Built-in demo', 'Generative · 124 BPM'); markSource();
}
async function useFile(file) {
  audioInit(); await A.ctx.resume(); stopSources();
  if (!A.mediaSrc) { A.mediaSrc = A.ctx.createMediaElementSource(media); A.mediaSrc.connect(A.bus); }
  media.src = URL.createObjectURL(file); media.loop = true;
  await media.play();
  A.source = 'file'; setNow(file.name.replace(/\.[^.]+$/, ''), 'Local file'); markSource();
}
async function useMic() {
  audioInit(); await A.ctx.resume(); stopSources();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    A.micSrc = A.ctx.createMediaStreamSource(stream);
    A.micSrc.connect(A.analyser); A.micSrc.connect(A.fast); // never to the speakers
    A.source = 'mic'; setNow('Microphone', 'Live input'); markSource();
  } catch (e) { setNow('Microphone unavailable', String(e.message || e)); }
}

// One-pole follower with separate attack and release rates (per second).
const env = (cur, target, dt, att, rel) => cur + (target - cur) * (1 - Math.exp(-dt * (target > cur ? att : rel)));

function analyse(dt) {
  for (let i = 0; i < 8; i++) A.pulse[i] = Math.min(99, A.pulse[i] + dt);
  A.sincePulse += dt;
  if (!A.analyser) return;
  A.analyser.getFloatFrequencyData(A.freq);
  A.analyser.getFloatTimeDomainData(A.time);
  const lo = A.analyser.minDecibels, span = A.analyser.maxDecibels - lo;
  let bass = 0, nb = 0, mid = 0, nm = 0, high = 0, nh = 0, level = 0, low = 0, peak = 0, sflux = 0, srise = 0, ns = 0, nflux = 0, ncent = 0, hflux = 0;
  for (let i = 0; i < BANDS; i++) {
    let m = -Infinity;
    for (let b = A.binOf[i]; b <= Math.max(A.binOf[i], A.binOf[i + 1] - 1); b++) m = Math.max(m, A.freq[b]);
    // Gentle tilt so the top end is not starved (real music falls ~3 dB/oct).
    let v = (m - lo) / span + (i / BANDS) * 0.18;
    v = Math.min(1, Math.max(0, v)); v = v * v * (3 - 2 * v);
    const f = A.bandHz[i];
    if (f < 150) low += v;
    if (f > 900 && f < 5200) { const d = v - A.prevV[i]; if (d > 0) sflux += d; if (d > 0.05) srise++; ns++; }
    { const d = v - A.prevV[i]; if (d > 0) { if (f > 250 && f < 2500) { nflux += d; ncent += d * i; } else if (f > 6000) hflux += d; } }
    A.prevV[i] = v; peak = Math.max(peak, v);
    v = Math.min(1, v * A.agc);
    A.bands[i] = env(A.bands[i], v, dt, 40, 9);            // light
    A.bandsM[i] = env(A.bandsM[i], v, dt, 20, 5);          // what the waterfall records
    A.bandsS[i] = env(A.bandsS[i], v, dt, 12, 2.6);        // geometry
    A.specU8[i * 2] = A.bands[i] * 255; A.specU8[i * 2 + 1] = A.bandsS[i] * 255;
    if (f < 150) { bass += v; nb++; } else if (f < 2200) { mid += v; nm++; } else if (f > 3500 && f < 12000) { high += v; nh++; }
    level += v;
  }
  bass /= nb; mid /= nm; high /= nh; level /= BANDS;
  A.bass = env(A.bass, bass, dt, 30, 6); A.mid = env(A.mid, mid, dt, 22, 5); A.high = env(A.high, high, dt, 30, 7); A.level = env(A.level, level, dt, 18, 4);
  A.bassS = env(A.bassS, bass, dt, 10, 2.5); A.midS = env(A.midS, mid, dt, 9, 2.2); A.highS = env(A.highS, high, dt, 10, 2.5); A.levelS = env(A.levelS, level, dt, 8, 2);
  // Section dynamics: the energy against its own slow average and recent peak.
  const e = 0.5 * A.bassS + 0.5 * A.levelS;
  A.ePeak = Math.max(e, A.ePeak * Math.exp(-dt / 25), 0.15);
  A.dyn = env(A.dyn, Math.min(1, e / A.ePeak), dt, 2.2, 1.1);
  A.sinceDrop += dt;
  if (e > A.eLong * 1.3 + 0.03 && A.sinceDrop > 6) { A.dropR = 1; A.sinceDrop = 0; A.accentR = 1; A.accents++; A.sinceAccent = 0; }
  A.eLong = env(A.eLong, e, dt, 0.35, 0.35);
  A.dropR *= Math.exp(-dt * 1.1);
  A.dropA = env(A.dropA, A.dropR, dt, 9, 9); A.drop = env(A.drop, A.dropA, dt, 9, 9);
  // Quiet material is lifted (never more than ×2.2) so a soft master still moves the picture; loud material is left alone.
  A.agcPeak = Math.max(peak, A.agcPeak * Math.exp(-dt / 6));
  A.agc = env(A.agc, Math.min(2.2, Math.max(1, 0.92 / Math.max(A.agcPeak, 0.2))), dt, 3, 0.5);
  // Kick: positive flux in the low bands against an adaptive threshold.
  const flux = Math.max(0, low - A.prevLow); A.prevLow = low;
  A.fluxAvg = A.fluxAvg * 0.94 + flux * 0.06;
  if (flux > A.fluxAvg * 2.2 + 0.25 && A.kickF < 0.35) { A.kickF = 1; A.kickR = 1; A.beat++;
    A.kickAmp = flux / (A.fluxAvg * 2.2 + 0.25);
    if ((A.kickAmp > A.kMean * 1.15 && A.sinceAccent > 1.7) || A.sinceAccent > 3.5) { A.accentR = 1; A.accents++; A.sinceAccent = 0; }
    A.kMean += (A.kickAmp - A.kMean) * 0.2;
    if (A.sincePulse > 0.4) { A.pulse[A.pulseAt++ & 7] = 0; A.sincePulse = 0; } }
  A.kickF *= Math.exp(-dt * 6.5);
  // Snare / clap: a broadband rise through the mids. It needs breadth as well as size, so a melody note does not fire it.
  A.sfluxAvg = A.sfluxAvg * 0.94 + sflux * 0.06;
  if (sflux > A.sfluxAvg * 2.4 + 0.02 * ns && srise > ns * 0.4 && A.snareF < 0.35) { A.snareF = 1; A.snareR = 1; A.snares++; }
  A.snareF *= Math.exp(-dt * 6.5);
  // The eased impulses: held with a ~0.3 s release, then run through two one-pole stages so they start with
  // zero slope. They peak near 0.8, which the 1.25 brings back to about 1.
  A.kickR *= Math.exp(-dt * 3.6); A.snareR *= Math.exp(-dt * 4.2);
  A.kickA = env(A.kickA, Math.max(0, A.kickR - 0.15) / 0.85 * 1.25, dt, 34, 34); A.kick = env(A.kick, A.kickA, dt, 34, 34);
  A.snareA = env(A.snareA, Math.max(0, A.snareR - 0.15) / 0.85 * 1.25, dt, 34, 34); A.snare = env(A.snare, A.snareA, dt, 34, 34);
  A.kickL = env(A.kickL, A.kickF * 1.3, dt, 48, 30);
  A.accentR *= Math.exp(-dt * 0.9); A.accentA = env(A.accentA, A.accentR, dt, 6, 6); A.accent = env(A.accent, A.accentA, dt, 6, 6);
  // Notes and hats: onsets in the mids and in the top octave.
  A.sinceNote += dt; A.sinceHat += dt; A.sinceAccent += dt;
  if (nflux > A.nAvg * 1.7 + 0.5 && A.sinceNote > 0.1) { A.notes++; A.noteBand = ncent / nflux / BANDS; A.noteAmp = Math.min(1, nflux / (A.nAvg * 4 + 1.5)); A.sinceNote = 0; }
  if (hflux > A.hAvg * 1.8 + 0.6 && A.sinceHat > 0.07) { A.hats++; A.hatAmp = Math.min(1, hflux / (A.hAvg * 4 + 2)); A.sinceHat = 0; }
  A.nAvg = A.nAvg * 0.95 + nflux * 0.05; A.hAvg = A.hAvg * 0.95 + hflux * 0.05;
  A.bassVS = env(A.bassVS, bass, dt, 1.4, 1.1); A.levelVS = env(A.levelVS, level, dt, 1.2, 0.9);
  A.slowRow[0] = A.dyn; A.slowRow[1] = A.accent; A.slowRow[2] = A.bassVS; A.slowRow[3] = A.levelVS;
  // Waveform: start at an upward zero crossing so successive frames line up, then average a little over time.
  let z = 64; const tm = A.time, wk = 1 - Math.exp(-dt * 14);
  for (let i = 64; i < 1000; i++) if (tm[i - 1] < 0 && tm[i] >= 0 && tm[i + 3] > tm[i]) { z = i; break; }
  for (let i = 0; i < WAVE; i++) { const k = z + i * 6; const s = (tm[k] + tm[k + 1] + tm[k + 2]) / 3;
    A.wave[i] += (s - A.wave[i]) * wk; A.waveU8[i] = Math.max(0, Math.min(255, (A.wave[i] * 0.5 + 0.5) * 255)); }
  analyseHits(dt);
  // One waterfall row: the medium bands, halved and lightly smoothed across frequency.
  for (let c = 0; c < HIST_W; c++) { const i = c * 2;
    A.histRow[c] = (A.bandsM[Math.max(0, i - 1)] + 2 * A.bandsM[i] + 2 * A.bandsM[i + 1] + A.bandsM[Math.min(BANDS - 1, i + 2)]) / 6; }
}

// Three-band onsets from the short FFT. Kept as one function so a native host can call exactly this after its
// own long-FFT analysis. Reads A.fast (the 1024 analyser); writes A.hit[], A.hitFast, A.hitSlow, A.hitLvl.
function analyseHits(dt) {
  A.fast.getFloatFrequencyData(A.fastF);
  const hz = A.ctx.sampleRate / 1024, top = A.fastF.length - 1, GAP = [0.24, 0.1, 0.06], SIGMA = [3, 2.4, 2.45], FLOOR = [0.3, 0.18, 0.22], EDGE = [[35, 150], [250, 2500], [5000, 14000]], lin = A.hitLin;
  for (let k = 0; k < 3; k++) { let s = 0, n = 0;                       // all three band levels first, so each is compared with this frame's others
    for (let b = Math.max(1, Math.round(EDGE[k][0] / hz)), e = Math.min(top, Math.round(EDGE[k][1] / hz)); b <= e; b++) { s += Math.pow(10, A.fastF[b] / 20); n++; }
    lin[k] = n ? s / n : 0; }
  const loud = Math.max(lin[0], lin[1], lin[2]);
  for (let k = 0; k < 3; k++) { const H = A.hit[k];
    const en = Math.log(1 + 400 * lin[k]), flux = Math.max(0, en - H.prev); H.prev = en; H.since += dt;
    H.top = Math.max(en, H.top * Math.exp(-dt / 12), 1); H.lvl = env(H.lvl, Math.min(1, en / H.top), dt, 60, 9);
    H.peak = Math.max(flux, H.peak * Math.exp(-dt / 6), 0.8);
    if (flux > H.mean + SIGMA[k] * H.dev + FLOOR[k] && H.since > GAP[k] && lin[k] > 0.1 * loud) {   // a band fires on its own sound, not on another's leakage
      H.n++; H.amp = Math.min(1, flux / H.peak); H.imp = Math.max(H.imp, 0.35 + 0.65 * H.amp); H.hold = 1; H.since = 0; }
    H.dev += (Math.abs(flux - H.mean) - H.dev) * Math.min(1, dt * 1.2); H.mean += (flux - H.mean) * Math.min(1, dt * 1.2);
    H.imp *= Math.exp(-dt * 9); H.fast = env(H.fast, H.imp, dt, 40, 40); H.hold *= Math.exp(-dt * 3.6);   // fast: half way up within a frame, never a step
    H.slowA = env(H.slowA, Math.max(0, H.hold - 0.15) / 0.85 * 1.25 * (0.4 + 0.6 * H.amp), dt, 34, 34); H.slow = env(H.slow, H.slowA, dt, 34, 34);
    A.hitFast[k] = H.fast; A.hitSlow[k] = H.slow; A.hitLvl[k] = H.lvl; }
}

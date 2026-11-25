// The framework's analyse() (framework/10_audio.js) split in two, for hosts whose JavaScript has no JIT
// (JavaScriptCore inside an iOS/tvOS app, Hermes on Android), where the whole function costs ≈4.5 ms a frame.
//
//   reduce   pure DSP, done natively next to the PCM tap: the loudest bin of each of the 256 log bands (dB), and
//            the waveform trigger-aligned and decimated to 512 points. Specified here in JS (vizReduce) so the
//            native versions have a reference to be tested against.
//   interpret the musical part, unchanged and still shared: envelopes, kick/snare/accent/drop detection, history.
//            The only change is that the six per-band smoothing coefficients are computed once per frame instead
//            of 768 times; the arithmetic, and so every result, is identical (test/analyse-split.test.ts).
//
// Proposed upstream: 10_audio.js keeps this shape itself, so the page and the native hosts run one interpret().

// reduce: freq = AnalyserNode-style dB magnitudes (2048), time = the last 4096 samples (mono).
function vizReduce(freq, time, binOf, bands, outBandDb, outWave) {
  for (let i = 0; i < bands; i++) {
    let m = -Infinity;
    for (let b = binOf[i]; b <= Math.max(binOf[i], binOf[i + 1] - 1); b++) m = Math.max(m, freq[b]);
    outBandDb[i] = m;
  }
  let z = 64;
  for (let i = 64; i < 1000; i++) if (time[i - 1] < 0 && time[i] >= 0 && time[i + 3] > time[i]) { z = i; break; }
  for (let i = 0; i < outWave.length; i++) { const k = z + i * 6; outWave[i] = (time[k] + time[k + 1] + time[k + 2]) / 3; }
}

// interpret: everything analyse() does after the scan, reading the reduced input.
function vizInterpret(A, dt, bandDb, waveRaw, lo, span) {
  for (let i = 0; i < 8; i++) A.pulse[i] = Math.min(99, A.pulse[i] + dt);
  A.sincePulse += dt;
  const BANDS = bandDb.length;
  const kA1 = 1 - Math.exp(-dt * 40), kR1 = 1 - Math.exp(-dt * 9), kA2 = 1 - Math.exp(-dt * 20), kR2 = 1 - Math.exp(-dt * 5), kA3 = 1 - Math.exp(-dt * 12), kR3 = 1 - Math.exp(-dt * 2.6);
  const bandsF = A.bands, bandsM = A.bandsM, bandsS = A.bandsS, prevV = A.prevV, hz = A.bandHz, specU8 = A.specU8, agc = A.agc;
  let bass = 0, nb = 0, mid = 0, nm = 0, high = 0, nh = 0, level = 0, low = 0, peak = 0, sflux = 0, srise = 0, ns = 0, nflux = 0, ncent = 0, hflux = 0;
  for (let i = 0; i < BANDS; i++) {
    let v = (bandDb[i] - lo) / span + (i / BANDS) * 0.18;
    v = Math.min(1, Math.max(0, v)); v = v * v * (3 - 2 * v);
    const f = hz[i], d = v - prevV[i];
    if (f < 150) low += v;
    if (f > 900 && f < 5200) { if (d > 0) sflux += d; if (d > 0.05) srise++; ns++; }
    if (d > 0) { if (f > 250 && f < 2500) { nflux += d; ncent += d * i; } else if (f > 6000) hflux += d; }
    prevV[i] = v; if (v > peak) peak = v;
    v = Math.min(1, v * agc);
    let c = bandsF[i]; bandsF[i] = c + (v - c) * (v > c ? kA1 : kR1);
    c = bandsM[i]; bandsM[i] = c + (v - c) * (v > c ? kA2 : kR2);
    c = bandsS[i]; bandsS[i] = c + (v - c) * (v > c ? kA3 : kR3);
    specU8[i * 2] = bandsF[i] * 255; specU8[i * 2 + 1] = bandsS[i] * 255;
    if (f < 150) { bass += v; nb++; } else if (f < 2200) { mid += v; nm++; } else if (f > 3500 && f < 12000) { high += v; nh++; }
    level += v;
  }
  vizInterpretTail(A, dt, bass / nb, mid / nm, high / nh, level / BANDS, low, peak, sflux, srise, ns, nflux, ncent, hflux, BANDS);
  const wk = 1 - Math.exp(-dt * 14), wave = A.wave, waveU8 = A.waveU8;
  for (let i = 0; i < wave.length; i++) { wave[i] += (waveRaw[i] - wave[i]) * wk; waveU8[i] = Math.max(0, Math.min(255, (wave[i] * 0.5 + 0.5) * 255)); }
  const hr = A.histRow, n = hr.length;
  for (let c = 0; c < n; c++) { const i = c * 2; hr[c] = (bandsM[Math.max(0, i - 1)] + 2 * bandsM[i] + 2 * bandsM[i + 1] + bandsM[Math.min(BANDS - 1, i + 2)]) / 6; }
}

// The scalar part of analyse(), verbatim apart from taking its sums as arguments.
function vizInterpretTail(A, dt, bass, mid, high, level, low, peak, sflux, srise, ns, nflux, ncent, hflux, BANDS) {
  const env = (cur, target, dt, att, rel) => cur + (target - cur) * (1 - Math.exp(-dt * (target > cur ? att : rel)));
  A.bass = env(A.bass, bass, dt, 30, 6); A.mid = env(A.mid, mid, dt, 22, 5); A.high = env(A.high, high, dt, 30, 7); A.level = env(A.level, level, dt, 18, 4);
  A.bassS = env(A.bassS, bass, dt, 10, 2.5); A.midS = env(A.midS, mid, dt, 9, 2.2); A.highS = env(A.highS, high, dt, 10, 2.5); A.levelS = env(A.levelS, level, dt, 8, 2);
  const e = 0.5 * A.bassS + 0.5 * A.levelS;
  A.ePeak = Math.max(e, A.ePeak * Math.exp(-dt / 25), 0.15);
  A.dyn = env(A.dyn, Math.min(1, e / A.ePeak), dt, 2.2, 1.1);
  A.sinceDrop += dt;
  if (e > A.eLong * 1.3 + 0.03 && A.sinceDrop > 6) { A.dropR = 1; A.sinceDrop = 0; A.accentR = 1; A.accents++; A.sinceAccent = 0; }
  A.eLong = env(A.eLong, e, dt, 0.35, 0.35);
  A.dropR *= Math.exp(-dt * 1.1);
  A.dropA = env(A.dropA, A.dropR, dt, 9, 9); A.drop = env(A.drop, A.dropA, dt, 9, 9);
  A.agcPeak = Math.max(peak, A.agcPeak * Math.exp(-dt / 6));
  A.agc = env(A.agc, Math.min(2.2, Math.max(1, 0.92 / Math.max(A.agcPeak, 0.2))), dt, 3, 0.5);
  const flux = Math.max(0, low - A.prevLow); A.prevLow = low;
  A.fluxAvg = A.fluxAvg * 0.94 + flux * 0.06;
  if (flux > A.fluxAvg * 2.2 + 0.25 && A.kickF < 0.35) { A.kickF = 1; A.kickR = 1; A.beat++;
    A.kickAmp = flux / (A.fluxAvg * 2.2 + 0.25);
    if ((A.kickAmp > A.kMean * 1.15 && A.sinceAccent > 1.7) || A.sinceAccent > 3.5) { A.accentR = 1; A.accents++; A.sinceAccent = 0; }
    A.kMean += (A.kickAmp - A.kMean) * 0.2;
    if (A.sincePulse > 0.4) { A.pulse[A.pulseAt++ & 7] = 0; A.sincePulse = 0; } }
  A.kickF *= Math.exp(-dt * 6.5);
  A.sfluxAvg = A.sfluxAvg * 0.94 + sflux * 0.06;
  if (sflux > A.sfluxAvg * 2.4 + 0.02 * ns && srise > ns * 0.4 && A.snareF < 0.35) { A.snareF = 1; A.snareR = 1; A.snares++; }
  A.snareF *= Math.exp(-dt * 6.5);
  A.kickR *= Math.exp(-dt * 3.6); A.snareR *= Math.exp(-dt * 4.2);
  A.kickA = env(A.kickA, Math.max(0, A.kickR - 0.15) / 0.85 * 1.25, dt, 34, 34); A.kick = env(A.kick, A.kickA, dt, 34, 34);
  A.snareA = env(A.snareA, Math.max(0, A.snareR - 0.15) / 0.85 * 1.25, dt, 34, 34); A.snare = env(A.snare, A.snareA, dt, 34, 34);
  A.kickL = env(A.kickL, A.kickF * 1.3, dt, 48, 30);
  A.accentR *= Math.exp(-dt * 0.9); A.accentA = env(A.accentA, A.accentR, dt, 6, 6); A.accent = env(A.accent, A.accentA, dt, 6, 6);
  A.sinceNote += dt; A.sinceHat += dt; A.sinceAccent += dt;
  if (nflux > A.nAvg * 1.7 + 0.5 && A.sinceNote > 0.1) { A.notes++; A.noteBand = ncent / nflux / BANDS; A.noteAmp = Math.min(1, nflux / (A.nAvg * 4 + 1.5)); A.sinceNote = 0; }
  if (hflux > A.hAvg * 1.8 + 0.6 && A.sinceHat > 0.07) { A.hats++; A.hatAmp = Math.min(1, hflux / (A.hAvg * 4 + 2)); A.sinceHat = 0; }
  A.nAvg = A.nAvg * 0.95 + nflux * 0.05; A.hAvg = A.hAvg * 0.95 + hflux * 0.05;
  A.bassVS = env(A.bassVS, bass, dt, 1.4, 1.1); A.levelVS = env(A.levelVS, level, dt, 1.2, 0.9);
  A.slowRow[0] = A.dyn; A.slowRow[1] = A.accent; A.slowRow[2] = A.bassVS; A.slowRow[3] = A.levelVS;
}

if (typeof module !== 'undefined') module.exports = { vizReduce, vizInterpret };

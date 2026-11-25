// A small generative track so the page works with no file.
class DemoSynth {
  constructor(ctx, dest) {
    this.ctx = ctx; this.out = ctx.createGain(); this.out.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 4;
    this.out.connect(comp); comp.connect(dest);
    this.delay = ctx.createDelay(1); this.delay.delayTime.value = 60 / 124 * 0.75;
    const fb = ctx.createGain(); fb.gain.value = 0.38; const dl = ctx.createGain(); dl.gain.value = 0.35;
    this.delay.connect(fb); fb.connect(this.delay); this.delay.connect(dl); dl.connect(this.out);
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.step = 0; this.next = 0; this.timer = 0; this.voices = [];
    this.prog = [[57, 60, 64, 69], [53, 57, 60, 65], [48, 52, 55, 60], [55, 59, 62, 67]];
  }
  start() { this.next = this.ctx.currentTime + 0.08; this.timer = setInterval(() => this.tick(), 25); }
  stop() { clearInterval(this.timer); const t = this.ctx.currentTime; this.out.gain.setTargetAtTime(0, t, 0.05); setTimeout(() => this.out.disconnect(), 400); }
  tick() {
    const sp = 60 / 124 / 4;
    while (this.next < this.ctx.currentTime + 0.14) { this.play(this.step, this.next, sp); this.step++; this.next += sp; }
  }
  play(s, t, sp) {
    const st = s % 16, bar = Math.floor(s / 16), chord = this.prog[bar % 4], phrase = Math.floor(bar / 8) % 4;
    if (st % 4 === 0 && !(phrase === 3 && bar % 8 > 5)) this.kick(t);
    if (st === 4 || st === 12) this.clap(t);
    if (st % 2 === 1 || phrase > 0) this.hat(t, st % 4 === 2 ? 0.22 : 0.07, st % 4 === 2 ? 0.12 : 0.035);
    if ([0, 3, 6, 8, 10, 14].includes(st)) this.bass(t, chord[0] - 24 + (st === 14 ? 7 : 0), sp * 1.6);
    if (st === 0) this.pad(t, chord, sp * 16);
    if (phrase !== 0 && st % 2 === 0) this.pluck(t, chord[(st / 2 + bar) % 4] + 12 + (st > 7 ? 12 : 0), sp);
  }
  osc(type, f) { const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = f; return o; }
  vca(t, a, d, peak) { const g = this.ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); return g; }
  hz(n) { return 440 * Math.pow(2, (n - 69) / 12); }
  kick(t) { const o = this.osc('sine', 150), g = this.vca(t, 0.002, 0.42, 1.1); o.frequency.setValueAtTime(155, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12); o.connect(g); g.connect(this.out); o.start(t); o.stop(t + 0.5); }
  noiseHit(t, type, f, q, a, d, peak) { const s = this.ctx.createBufferSource(); s.buffer = this.noise; const fl = this.ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; const g = this.vca(t, a, d, peak); s.connect(fl); fl.connect(g); g.connect(this.out); s.start(t, Math.random() * 0.5); s.stop(t + a + d + 0.05); }
  clap(t) { this.noiseHit(t, 'bandpass', 1500, 1.2, 0.004, 0.2, 0.55); this.noiseHit(t + 0.012, 'bandpass', 2400, 0.8, 0.002, 0.08, 0.3); }
  hat(t, d, v) { this.noiseHit(t, 'highpass', 8000, 0.7, 0.001, d, v); }
  bass(t, n, len) { const o = this.osc('sawtooth', this.hz(n)), f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 9; f.frequency.setValueAtTime(1600, t); f.frequency.exponentialRampToValueAtTime(110, t + len); const g = this.vca(t, 0.004, len, 0.32); o.connect(f); f.connect(g); g.connect(this.out); o.start(t); o.stop(t + len + 0.05); }
  pad(t, notes, len) {
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(600, t); f.frequency.linearRampToValueAtTime(2400, t + len * 0.5); f.frequency.linearRampToValueAtTime(700, t + len);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.06, t + 0.6); g.gain.setValueAtTime(0.06, t + len - 0.3); g.gain.linearRampToValueAtTime(0, t + len + 0.2);
    f.connect(g); g.connect(this.out); g.connect(this.delay);
    for (const n of notes) for (const det of [-9, 0, 8]) { const o = this.osc('sawtooth', this.hz(n)); o.detune.value = det; o.connect(f); o.start(t); o.stop(t + len + 0.3); }
  }
  pluck(t, n, sp) { const o = this.osc('square', this.hz(n)), f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(5200, t); f.frequency.exponentialRampToValueAtTime(400, t + 0.18); const g = this.vca(t, 0.002, 0.2, 0.09); o.connect(f); f.connect(g); g.connect(this.out); g.connect(this.delay); o.start(t); o.stop(t + 0.3); }
}


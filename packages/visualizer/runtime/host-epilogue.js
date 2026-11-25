// Runs after the framework on a native host, in place of the page's UI section (framework/95_ui.js).
// It wires the framework's analyser input to the host's DSP output and exposes one small API, __viz.
function renderModes() {} function setNow() {} function markSource() {}
const __analyser = { fftSize: 4096, frequencyBinCount: 2048, minDecibels: -92, maxDecibels: -18, smoothingTimeConstant: 0.55,
  getFloatFrequencyData(a) { a.set(__host.freq); }, getFloatTimeDomainData(a) { a.set(__host.time); } };
function __audioFormat(rate) {
  A.ctx = { sampleRate: rate }; A.analyser = __analyser; A.source = 'native';
  A.freq = new Float32Array(2048); A.time = new Float32Array(4096);
  if (typeof analyseHits === 'function') {
    // Native FFTs write directly into the heard-time short spectrum. Older
    // tools without a short spectrum render the scene with quiet onsets.
    A.fastF = __host.fastFreq || new Float32Array(512).fill(-Infinity);
    A.fast = { getFloatFrequencyData() {} };
  }
  const ny = rate / 2, n = 2048; A.binOf = new Array(BANDS + 1);
  for (let i = 0; i <= BANDS; i++) A.binOf[i] = Math.min(n - 1, Math.max(1, Math.round(28 * Math.pow(16000 / 28, i / BANDS) / ny * n)));
}
__audioFormat(__host.sampleRate || 48000);
// No-JIT hosts reduce the spectrum natively (runtime/analyse-split.js): __host.bandDb (256 dB maxima) and
// __host.wave (512 aligned samples) replace freq/time, and only the musical interpretation runs here.
if (__host.bandDb) analyse = dt => {
  vizInterpret(A, dt, __host.bandDb, __host.wave, -92, 74);
  if (typeof analyseHits === 'function') analyseHits(dt);
};
// Preserve the scene's authored palette while picking up the current sleeve or skin.
const __originalPalettes = PALETTES.map(p => p.v.slice());
function __tint(artwork, accent) {
  const valid = value => typeof value === 'string' && /^#[a-f0-9]{6}$/i.test(value);
  const color = valid(artwork) ? artwork : valid(accent) ? accent : '';
  for (let i = 0; i < PALETTES.length; i++) {
    for (let channel = 0; channel < 3; channel++) {
      const original = __originalPalettes[i][channel];
      PALETTES[i].v[channel] = color ? original * .88 + parseInt(color.slice(1 + channel * 2, 3 + channel * 2), 16) / 255 * .12 : original;
    }
  }
}
__tint(__host.artworkTint, __host.accent);
var __warmAt = 0, __frameMs = 0, __frameN = 0;
var __viz = {
  scenes: SCENES.map(s => ({ id: s.id, name: s.name, about: s.about || '', group: s.group || '' })),
  palettes: PALETTES.map(p => p.name),
  audioFormat: __audioFormat,
  tint: __tint,
  setScene(id, immediate = false) {
    const index = typeof id === 'string' ? SCENES.findIndex(s => s.id === id) : id;
    if (!Number.isInteger(index) || index < 0 || index >= SCENES.length) return;
    setScene(index);
    if (immediate) { prevIx = -1; prevLive = false; needStill = false; }
  },
  setPalette: m => setPalette(m),
  get scene() { return sceneIx; },
  resize(w, h, dpr) { innerWidth = w; innerHeight = h; devicePixelRatio = dpr; resize(); },
  // One display tick: timers, the frame itself, then the whole frame goes to the executor.
  frame(now) {
    const t0 = __host.now();
    if (__timers.length) { const due = __timers.filter(t => t.at <= now); __timers = __timers.filter(t => t.at > now); due.forEach(t => t.fn()); }
    // Compile the other scenes one at a time, a few frames apart, so a later switch never stalls.
    if (!warm && ++__warmAt % 6 === 0) { const next = SCENES.findIndex(s => !s._ok && !s._bad); if (next < 0) warm = true; else ensure(SCENES[next]); }
    const f = __raf; __raf = null; if (f) f(now);
    __gl.__endFrame();
    __frameMs += __host.now() - t0; __frameN++;
  },
  stats() { const r = { jsMs: __frameN ? __frameMs / __frameN : 0, frames: __frameN, res: [T.sw, T.sh], budget: budgetScale, broken: SCENES.filter(s => s._bad).map(s => s.id) }; __frameMs = 0; __frameN = 0; return r; },
  state: () => A,
};
if (typeof __host.scene === 'string') { const i = SCENES.findIndex(s => s.id === __host.scene); if (i >= 0) sceneIx = i; }
ensure(SCENES[sceneIx]);
requestAnimationFrame(frame);

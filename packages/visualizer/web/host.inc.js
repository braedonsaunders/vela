// This instance initializes one scene. Its canvas and all GPU allocations retire together.
sceneIx = SCENES.findIndex(s => s.id === stage.sceneId);
if (sceneIx < 0 || !ensure(SCENES[sceneIx])) throw new Error('Visualizer scene unavailable: ' + stage.sceneId);
warm = true;
time = 1;
let rate = 0;
const budget = frameBudget();
const originalPalettes = PALETTES.map(p => p.v.slice());
return {
  resize(width, height) {
    if (width === innerWidth && height === innerHeight) return;
    innerWidth = width; innerHeight = height;
    resize();
  },
  tint(rgb) {
    for (let i = 0; i < PALETTES.length; i++) {
      for (let channel = 0; channel < 3; channel++) {
        const original = originalPalettes[i][channel];
        PALETTES[i].v[channel] = rgb ? original * .88 + rgb[channel] * .12 : original;
      }
    }
  },
  resetBudget: budget.reset,
  frame(seconds, sample, targetSeconds) {
    const dt = Math.min(.05, Math.max(0, seconds));
    if (sample) {
      if (rate !== sample.sampleRate) {
        rate = sample.sampleRate;
        A.ctx = { sampleRate: rate };
        A.binOf = Array.from({length: BANDS + 1}, (_, i) =>
          Math.min(2047, Math.max(1, Math.round(28 * Math.pow(16000 / 28, i / BANDS) * 4096 / rate))));
      }
      A.freq = sample.frequency;
      A.time = sample.waveform;
      A.fastF = sample.shortFrequency;
      A.analyser = stage.analysisRange;
    } else A.analyser = null;
    gov.best = Math.min(gov.best, targetSeconds);
    govern(Math.min(.24, seconds));
    analyse(dt);
    render(dt);
    return budget.sample(seconds, targetSeconds, budgetScale <= .3);
  },
  stats() {
    return { scene: SCENES[sceneIx].id, frames, resolution: [T.sw, T.sh], beat: A.beat, level: A.level,
      gpuMs: perf.n ? perf.sum / perf.n : null };
  },
};

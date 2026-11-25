// A silent probe of Vela's Web Audio output and the framework's direct WebGL2 renderer.
import { createGaplessPlayer } from '../../../../modules/vela-player/web/gapless/player';

const query = new URLSearchParams(location.search);
const out = document.querySelector('pre')!;
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

async function measure() {
  const scene = query.get('scene') ?? 'ink';
  const seconds = Number(query.get('seconds') ?? 20);
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('Expected positive measurement duration');
  const response = await fetch('/dist/viz-native.js');
  if (!response.ok) throw new Error('Build the framework bundle first');
  const bundle = await response.text();
  // Keep transport latency out of the rendering measurement. The normal player still opens,
  // decodes and schedules the compressed track, including its range reads on the blob URL.
  const audio = await fetch(query.get('track') ?? '/dist/track.mp3');
  if (!audio.ok) throw new Error('Could not load the music fixture');
  const track = URL.createObjectURL(await audio.blob());
  const player = createGaplessPlayer();
  let raf = 0;
  let failure: unknown;
  let stalls = 0;
  const unsubscribe = player.subscribe(event => {
    if (event === 'waiting') stalls++;
    if (event === 'unsupported' || event === 'error') failure = new Error(player.error() || event);
  });
  try {
    // Mute before load, detach the speaker destination, then restore gain into the analyser only.
    player.setVolume(0);
    player.load(track, 0);
    let node = player.output();
    for (let i = 0; i < 200 && !node && !failure; i++) {
      await delay(50);
      node = player.output();
    }
    if (failure) throw failure;
    if (!node) throw new Error('Player did not open an audio output');
    const ctx = node.context as AudioContext;
    node.disconnect(ctx.destination);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 4096;
    analyser.smoothingTimeConstant = 0.55;
    analyser.minDecibels = -92;
    analyser.maxDecibels = -18;
    node.connect(analyser);
    // Keep the browser pulling the graph. This final gain is always zero.
    const silent = ctx.createGain();
    silent.gain.value = 0;
    analyser.connect(silent).connect(ctx.destination);
    player.setVolume(1);
    const canvas = document.querySelector('canvas')!;
    canvas.width = 1280;
    canvas.height = 720;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
    if (!gl) throw new Error('WebGL2 unavailable');
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER);
    const host = {
      width: canvas.width, height: canvas.height, dpr: 1, scene, sampleRate: ctx.sampleRate,
      now: () => performance.now(), log: console.log, directGL: gl,
      freq: new Float32Array(analyser.frequencyBinCount), time: new Float32Array(analyser.fftSize),
    };
    const viz = new Function('__host', bundle + '\n;return __viz;')(host);
    if (viz.scenes[viz.scene]?.id !== scene) throw new Error('Scene missing from bundle: ' + scene);
    let last: number | undefined;
    let cpuMs = 0;
    let frames = 0;
    const intervals: number[] = [];
    const frame = (timestamp: number) => {
      try {
        if (last !== undefined) intervals.push(timestamp - last);
        last = timestamp;
        const start = performance.now();
        analyser.getFloatFrequencyData(host.freq);
        analyser.getFloatTimeDomainData(host.time);
        viz.frame(timestamp);
        cpuMs += performance.now() - start;
        frames++;
        raf = requestAnimationFrame(frame);
      } catch (error) { failure = error; }
    };
    const context = ctx as AudioContext & {
      playbackStats?: { underrunEvents: number; underrunDuration: number; totalDuration: number };
      playoutStats?: { fallbackFramesEvents: number; fallbackFramesDuration: number; totalFramesDuration: number };
    };
    const readAudioStats = () => {
      const playback = context.playbackStats;
      const playout = context.playoutStats;
      return {
        underruns: playback?.underrunEvents ?? playout?.fallbackFramesEvents ?? null,
        underrunDuration: playback?.underrunDuration ?? playout?.fallbackFramesDuration ?? null,
        totalDuration: playback?.totalDuration ?? playout?.totalFramesDuration ?? null,
      };
    };
    player.play();
    raf = requestAnimationFrame(frame);
    // Record startup separately so shader warm-up and the initial audio device start are visible.
    for (let i = 0; i < 120 && player.position() < 2 && !failure; i++) await delay(100);
    if (failure) throw failure;
    if (player.position() < 2) throw new Error('Audio clock did not advance through startup');
    const startup = { ...readAudioStats(), stalls, position: player.position(), beats: viz.state().beat };
    stalls = 0;
    frames = 0;
    cpuMs = 0;
    intervals.length = 0;
    last = undefined;
    await delay(seconds * 1000);
    if (failure) throw failure;
    if (!intervals.length || !player.position()) throw new Error('Rendering or playback did not advance');
    intervals.sort((a, b) => a - b);
    const state = viz.state();
    const stats = viz.stats();
    if (stats.broken.includes(scene)) throw new Error('Shader failed: ' + scene);
    const final = readAudioStats();
    const delta = (after: number | null, before: number | null) => after !== null && before !== null ? after - before : null;
    return {
      scene, renderer, rate: ctx.sampleRate, frames, cpuMs: cpuMs / frames,
      intervalMedian: intervals[intervals.length >> 1], intervalP99: intervals[Math.floor(intervals.length * 0.99)],
      beats: state.beat - startup.beats, level: state.level, resolution: stats.res, positionDelta: player.position() - startup.position, stalls, startup,
      underruns: delta(final.underruns, startup.underruns),
      underrunDuration: delta(final.underrunDuration, startup.underrunDuration),
      totalDuration: delta(final.totalDuration, startup.totalDuration),
    };
  } finally {
    cancelAnimationFrame(raf);
    unsubscribe();
    player.unload();
    URL.revokeObjectURL(track);
  }
}

measure().then(result => { out.textContent = JSON.stringify(result); })
  .catch(error => { out.textContent = String(error); })
  .finally(() => { document.title = 'DONE'; });

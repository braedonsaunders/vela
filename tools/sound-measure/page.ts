// The web measurement harness (tools/sound-measure/README.md): the real gapless player (levelling, the
// EQ, AutoMix crossfades) plays the signals in the page, and an AudioWorklet on its output records what
// it produces, before the device. Each case's capture is posted to the harness server for analysis.
import { createGaplessPlayer } from '../../modules/vela-player/web/gapless/player';
import { eqChain } from '../../packages/core/src/audio/eq';
import { DEFAULT_SOUND, withPreset } from '../../packages/core/src/audio/sound';

interface Case { name: string; url: string; seconds: number; gain?: number; preset?: string; next?: { url: string; gain?: number; crossfade?: { seconds: number; at: number } } }

const s = (name: string) => `/signals/${name}`;
const CASES: Case[] = [
  { name: 'm1-unity', url: s('tone1k.flac'), seconds: 9 },
  { name: 'm1-half', url: s('tone1k.flac'), seconds: 9, gain: 0.5 },
  { name: 'm1-double', url: s('tone1k.flac'), seconds: 9, gain: 2 },
  { name: 'm2-boundary', url: s('tone1k.flac'), seconds: 16, gain: 0.5, next: { url: `${s('tone1k.flac')}?second`, gain: 1 } },
  { name: 'm3-off', url: s('noise.flac'), seconds: 11.5 },
  { name: 'm3-rock', url: s('noise.flac'), seconds: 11.5, preset: 'rock' },
  { name: 'm3-bassBoost', url: s('noise.flac'), seconds: 11.5, preset: 'bassBoost' },
  { name: 'm3-vocal', url: s('noise.flac'), seconds: 11.5, preset: 'vocal' },
  { name: 'm4-crossfade', url: s('toneA.flac'), seconds: 29, next: { url: s('toneB.flac'), crossfade: { seconds: 6, at: 20 } } },
  { name: 'm5-beats', url: s('beatsA.flac'), seconds: 25, next: { url: s('beatsB.flac'), crossfade: { seconds: 6, at: 20.2 } } },
];

const RECORDER = `
class Recorder extends AudioWorkletProcessor {
  constructor() { super(); this.on = false; this.parts = []; this.frames = 0;
    this.port.onmessage = e => { if (e.data === 'start') { this.on = true; this.parts = []; this.frames = 0; }
      else if (e.data === 'stop') { this.on = false; this.port.postMessage(this.parts); this.parts = []; } }; }
  process(inputs) { const ch = inputs[0] && inputs[0][0]; if (this.on && ch) { this.parts.push(new Float32Array(ch)); } return true; }
}
registerProcessor('vela-recorder', Recorder);`;

const log = (text: string) => { document.getElementById('log')!.textContent += `${text}\n`; void fetch('/log', { method: 'POST', body: text }); };
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function run(): Promise<void> {
  const only = new URLSearchParams(location.search).get('only');
  const player = createGaplessPlayer();
  player.subscribe(event => { if (event !== 'time') log(`  event ${event}${event === 'error' || event === 'unsupported' ? `: ${player.error()}` : ''}`); });
  let recorder: AudioWorkletNode | null = null;
  for (const c of CASES) {
    if (only && !c.name.startsWith(only)) continue;
    const opened = new Promise<void>(resolve => { const off = player.subscribe(e => { if (e === 'duration') { off(); resolve(); } }); });
    player.load(c.url, 0);
    await opened;
    const output = player.output()!;
    const context = output.context as AudioContext;
    if (!recorder || recorder.context !== context) {
      await context.audioWorklet.addModule(URL.createObjectURL(new Blob([RECORDER], { type: 'text/javascript' })));
      recorder = new AudioWorkletNode(context, 'vela-recorder');
      output.connect(recorder);
      recorder.connect(context.destination);
    }
    const sound = c.preset ? withPreset(DEFAULT_SOUND, c.preset) : DEFAULT_SOUND;
    player.setSound({ gain: c.gain ?? 1, eq: eqChain(sound.eq) });
    if (c.next) player.preload({ url: c.next.url, startSeconds: 0, ...(c.next.gain !== undefined ? { gain: c.next.gain } : {}), ...(c.next.crossfade ? { crossfade: c.next.crossfade } : {}) });
    // Let the first audio decode, then record from just before it starts.
    await sleep(1500);
    recorder.port.postMessage('start');
    player.play();
    await sleep(c.seconds * 1000);
    const parts = await new Promise<Float32Array[]>(resolve => { recorder!.port.onmessage = e => resolve(e.data); recorder!.port.postMessage('stop'); });
    player.unload();
    const frames = parts.reduce((n, p) => n + p.length, 0);
    const pcm = new Float32Array(frames);
    let at = 0;
    for (const p of parts) { pcm.set(p, at); at += p.length; }
    await fetch(`/capture/${c.name}?rate=${context.sampleRate}`, { method: 'POST', body: pcm.buffer });
    await fetch(`/meta/${c.name}`, { method: 'POST', body: JSON.stringify({ rate: context.sampleRate, frames, diagnostics: player.diagnostics() }) });
    log(`${c.name}: ${frames} frames at ${context.sampleRate} Hz ${JSON.stringify(player.diagnostics())}`);
  }
  await fetch('/done', { method: 'POST' });
  log('done');
}

document.getElementById('go')!.addEventListener('click', () => void run().catch(error => log(`failed: ${error instanceof Error ? error.stack : error}`)));

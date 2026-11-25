// A side tap on the player's existing mixed output. Nothing here owns the playback clock or speaker path.
export interface MusicOutput {
  kind: 'unavailable' | 'opening' | 'ready';
  node: AudioNode | null;
  playing: boolean;
}

let current: MusicOutput = { kind: 'unavailable', node: null, playing: false };
const listeners = new Set<() => void>();
let notifying = false;

export const musicOutput = () => current;
export function subscribeMusicOutput(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function publishMusicOutput(kind: MusicOutput['kind'], node: AudioNode | null, playing: boolean) {
  if (current.kind === kind && current.node === node && current.playing === playing) return;
  current = { kind, node, playing };
  // Paint, connect, and retire the observer outside the player's event and scheduling callbacks.
  if (notifying) return;
  notifying = true;
  queueMicrotask(() => {
    notifying = false;
    for (const listener of listeners) listener();
  });
}

/** Select the newest captured FFT window ending at or before the estimated speaker playhead. */
export function observeMusicOutput(node: AudioNode) {
  const context = node.context as AudioContext;
  const analyser = context.createAnalyser();
  analyser.fftSize = 4096;
  analyser.minDecibels = -92;
  analyser.maxDecibels = -18;
  analyser.smoothingTimeConstant = 0.55;
  const short = context.createAnalyser();
  short.fftSize = 1024;
  short.minDecibels = -100;
  short.maxDecibels = -10;
  short.smoothingTimeConstant = 0;
  type Snapshot = { end: number; frequency: Float32Array<ArrayBuffer>; shortFrequency: Float32Array<ArrayBuffer>; waveform: Float32Array<ArrayBuffer> };
  const slots: Snapshot[] = [];
  let write = 0;
  node.connect(analyser);
  try { node.connect(short); } catch (error) { node.disconnect(analyser); throw error; }
  return {
    sample(now: number) {
      const slot = slots[write] ??= {
        end: 0, frequency: new Float32Array(analyser.frequencyBinCount),
        shortFrequency: new Float32Array(short.frequencyBinCount), waveform: new Float32Array(analyser.fftSize),
      };
      analyser.getFloatFrequencyData(slot.frequency);
      analyser.getFloatTimeDomainData(slot.waveform);
      short.getFloatFrequencyData(slot.shortFrequency);
      slot.end = context.currentTime;
      const stamp = context.getOutputTimestamp?.();
      const heard = stamp?.performanceTime !== undefined && stamp.performanceTime > 0 && stamp.contextTime !== undefined
        ? Math.min(slot.end, stamp.contextTime + Math.max(0, now - stamp.performanceTime) / 1000)
        : Math.max(0, slot.end - ((context.baseLatency || 0) + (context.outputLatency || 0)));
      // Half a second of history even at 120 Hz. Allocate slots only as the running stage needs them.
      write = (write + 1) % 64;
      let selected = slot;
      for (let offset = 1; offset < slots.length && selected.end > heard; offset++) {
        selected = slots[(write - 1 - offset + 64) % 64]!;
      }
      if (selected.end > heard) return null;
      return { frequency: selected.frequency, shortFrequency: selected.shortFrequency, waveform: selected.waveform, sampleRate: context.sampleRate };
    },
    close() { node.disconnect(analyser); node.disconnect(short); },
  };
}

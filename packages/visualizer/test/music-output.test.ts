import { expect, test } from 'bun:test';
import { musicOutput, observeMusicOutput, publishMusicOutput, subscribeMusicOutput } from '../../../apps/vela/src/visualizer/music-output.web';

function fixture() {
  let time = 0;
  let heard = 0;
  const connected = new Set<unknown>();
  const speakers = {};
  connected.add(speakers);
  const node = {
    context: {
      sampleRate: 48000,
      get currentTime() { return time; },
      getOutputTimestamp: () => ({ performanceTime: 1000, contextTime: heard }),
      createAnalyser: () => ({
        fftSize: 0,
        get frequencyBinCount() { return this.fftSize / 2; },
        getFloatFrequencyData(data: Float32Array) { data.fill(time); },
        getFloatTimeDomainData(data: Float32Array) { data.fill(time); },
      }),
    },
    connect(to: unknown) { connected.add(to); },
    disconnect(to: unknown) { if (!connected.delete(to)) throw new Error('Removed an unrelated connection'); },
  } as unknown as AudioNode;
  return { node, speakers, connected, at(next: number, output: number) { time = next; heard = output; } };
}

test('analysis follows heard PCM through history wrap and detaches only its own taps', () => {
  const f = fixture();
  const monitor = observeMusicOutput(f.node);
  for (let time = 1; time <= 75; time++) {
    f.at(time, time - 1.5);
    const sample = monitor.sample(1000);
    if (time <= 2) { expect(sample).toBeNull(); continue; }
    if (!sample) throw new Error('Expected a heard-time sample');
    expect(sample.waveform[0]).toBe(time - 2);
    expect(sample.frequency[0]).toBe(sample.waveform[0]);
    expect(sample.shortFrequency).toHaveLength(512);
    expect(sample.shortFrequency[0]).toBe(sample.waveform[0]);
    expect(sample.sampleRate).toBe(48000);
  }
  monitor.close();
  expect([...f.connected]).toEqual([f.speakers]);
});

test('moving between PCM, HTML element fallback, and PCM again publishes each availability change once', async () => {
  const { node } = fixture();
  const seen: string[] = [];
  const unsubscribe = subscribeMusicOutput(() => seen.push(musicOutput().kind));
  try {
    publishMusicOutput('opening', null, false);
    await Promise.resolve();
    publishMusicOutput('ready', node, true);
    publishMusicOutput('ready', node, true);
    await Promise.resolve();
    publishMusicOutput('unavailable', null, false);
    await Promise.resolve();
    publishMusicOutput('ready', node, true);
    await Promise.resolve();
    expect(seen).toEqual(['opening', 'ready', 'unavailable', 'ready']);
  } finally {
    unsubscribe();
    publishMusicOutput('unavailable', null, false);
  }
});

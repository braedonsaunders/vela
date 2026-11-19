import { expect, test } from 'bun:test';
import { LiveLatency } from '../web/engine/live-latency';

for (const latencyProfile of ['auto', 'low', 'stable'] as const) {
  test(latencyProfile + ': a live backlog never changes playback speed after a stall', () => {
    const policy = new LiveLatency();
    policy.reset({ latencyProfile, targetLatencySeconds: 6 });
    for (let now = 1000; now <= 180000; now += 1000) {
      const stalled = now >= 10000 && now < 20000;
      const decision = policy.sample({
        now, playing: !stalled, waiting: stalled, bufferAhead: stalled ? 0 : 30,
        throughputBps: 10000000, bitrateBps: 1000000, segmentSeconds: 2,
        windowSeconds: 120, behindSeconds: now < 10000 ? 10 : 60,
      });
      expect(decision.playbackRate).toBe(1);
      expect(decision.targetSeconds).toBeGreaterThan(0);
    }
  });
}

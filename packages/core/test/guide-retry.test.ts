import { expect, test } from 'bun:test';
import { VelaError } from '../src/adapter/errors';
import { GuideRetry, guideRetryDelay } from '../src/live/retry';
import { loadGuide, liveIdentity, type GuideApi } from '../src/live/guide';

const NOW = Date.parse('2026-11-18T12:00:00Z');
const capacity = (after: string | null = null) => new VelaError({ class: 'capacity', code: 'service_unavailable', message: 'Unavailable', retry: { allowed: true } }, 503, after);
const api: GuideApi = {
  channels: async () => ({ items: [], continuation: 'exhausted' }),
  guide: async q => ({ ...q, items: [], continuation: 'exhausted' }),
};

test('capacity backoff grows from thirty seconds to ten minutes without bursts', () => {
  expect(Array.from({ length: 9 }, (_, attempt) => guideRetryDelay(capacity(), attempt, NOW))).toEqual([30000, 60000, 120000, 240000, 480000, 600000, 600000, 600000, 600000]);
});

test('Retry-After seconds and dates are honoured, even above the ten-minute fallback cap', () => {
  expect(guideRetryDelay(capacity('120'), 0, NOW)).toBe(120000);
  expect(guideRetryDelay(capacity(new Date(NOW + 20 * 60000).toUTCString()), 9, NOW)).toBe(20 * 60000);
  expect(guideRetryDelay(capacity('invalid'), 1, NOW)).toBe(60000);
  expect(guideRetryDelay(capacity('-1'), 1, NOW)).toBe(60000);
  expect(guideRetryDelay(capacity('0'), 0, NOW)).toBeGreaterThanOrEqual(1000);
});

test('blocked readers cannot extend a deadline or reset its failure count', async () => {
  const retry = new GuideRetry(); let now = NOW, calls = 0;
  const failing: GuideApi = { ...api, channels: async () => { calls++; throw capacity(); } };
  await expect(retry.run(failing, () => now, source => source.channels())).rejects.toMatchObject({ status: 503 });
  const deadline = retry.deadline;
  for (let i = 0; i < 30; i++) await expect(retry.run(failing, () => now + i, source => source.channels())).rejects.toMatchObject({ status: 503 });
  expect(calls).toBe(1); expect(retry.deadline).toBe(deadline);
  now = deadline;
  await expect(retry.run(failing, () => now, source => source.channels())).rejects.toMatchObject({ status: 503 });
  expect(calls).toBe(2); expect(retry.remaining(now)).toBe(60000);
});

test('an overlapping successful read cannot erase a failed wave or its exponential backoff', async () => {
  const retry = new GuideRetry(); let now = NOW;
  const failing: GuideApi = { ...api, channels: async () => { throw capacity(); } };
  const failedWave = () => Promise.allSettled([
    retry.run(failing, () => now, source => source.channels()),
    retry.run(api, () => now, source => source.guide({ from: '', until: '' })),
  ]);
  await failedWave(); expect(retry.remaining(now)).toBe(30000);
  now += 30000; await failedWave(); expect(retry.remaining(now)).toBe(60000);
  now += 60000;
  await retry.run(api, () => now, source => source.channels());
  expect(retry.remaining(now)).toBe(0);
  await failedWave(); expect(retry.remaining(now)).toBe(30000);
});

test('channel, guide and full-watch identity reads share a server/viewer deadline', async () => {
  let calls = 0;
  const source: GuideApi = { ...api, channels: async () => { calls++; throw capacity('120'); } };
  const scope = 'cross-surface-backoff';
  await expect(loadGuide(source, 0, NOW, scope)).rejects.toMatchObject({ status: 503 });
  await expect(loadGuide(source, 1, NOW + 60000, scope)).rejects.toMatchObject({ status: 503 });
  await expect(liveIdentity(source, 'one', NOW + 60000, undefined, scope)).rejects.toMatchObject({ status: 503 });
  expect(calls).toBe(1);
});

test('a cache-only projection cannot reset the backoff before a successful request', async () => {
  const retry = new GuideRetry(); let now = NOW;
  const failing: GuideApi = { ...api, channels: async () => { throw capacity(); } };
  await expect(retry.run(failing, () => now, source => source.channels())).rejects.toMatchObject({ status: 503 });
  now += 30000;
  await retry.run(api, () => now, async () => 'cached guide');
  await expect(retry.run(failing, () => now, source => source.channels())).rejects.toMatchObject({ status: 503 });
  expect(retry.remaining(now)).toBe(60000);
});

test('guide page and bulk-window capacity failures gate all subsequent endpoints', async () => {
  for (const bulk of [false, true]) {
    const retry = new GuideRetry(); let calls = 0;
    const source: GuideApi = { ...api,
      guide: async () => { calls++; throw capacity(); },
      guideWindow: async () => { calls++; throw capacity(); },
      channels: async () => { calls++; return { items: [], continuation: 'exhausted' }; },
    };
    const query = { channelIds: ['one'], from: '', until: '' };
    await expect(retry.run<unknown>(source, () => NOW, guarded => bulk ? guarded.guideWindow!(query) : guarded.guide(query))).rejects.toMatchObject({ status: 503 });
    await expect(retry.run(source, () => NOW + 1000, guarded => guarded.channels())).rejects.toMatchObject({ status: 503 });
    expect(calls).toBe(1);
  }
});

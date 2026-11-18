import { expect, test } from 'bun:test';
import { VelaError } from '@vela/core';
import { LiveController, type LiveOptions } from '../src/widgets/guide/controller';

const MINUTE = 60000;
const unavailable = (retryAfter: string | null = null) => new VelaError({ class: 'capacity', code: 'service_unavailable', message: 'Unavailable', retry: { allowed: true } }, 503, retryAfter);
let sequence = 0;
function clock() {
  let now = Date.parse('2026-11-18T12:00:00Z'), id = 0;
  const tasks = new Map<number, { at: number; run(): void }>();
  const timing: NonNullable<LiveOptions['timing']> = {
    now: () => now,
    set: (run, delay) => { tasks.set(++id, { at: now + delay, run }); return id as unknown as ReturnType<typeof setTimeout>; },
    clear: timer => { tasks.delete(timer as unknown as number); },
  };
  const settle = () => Bun.sleep(0);
  return { timing, settle, async advance(delay: number) {
    const until = now + delay;
    while (true) {
      const next = [...tasks].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > until) break;
      now = next[1].at; tasks.delete(next[0]); next[1].run(); await settle();
    }
    now = until; await settle();
  } };
}
function setup(retryAfter: string | null = null) {
  const time = clock();
  let reads = 0, guideReads = 0, failing = true, permanent = false;
  const controller = new LiveController({
    timing: time.timing, scope: `guide-backoff-${++sequence}`, memory: { get: () => null, set: () => {} }, openWatch: () => {},
    source: {
      channels: async () => {
        reads++;
        if (failing) throw permanent ? new VelaError({ class: 'policy', code: 'forbidden', message: 'Forbidden', retry: { allowed: false } }, 403) : unavailable(retryAfter);
        return { items: [{ id: 'one', name: 'One', number: '1', kind: 'tv', favorite: false, artwork: [] }], continuation: 'exhausted' };
      },
      guide: async q => { guideReads++; return { from: q.from, until: q.until, items: [], continuation: 'exhausted' }; },
      tune: async () => { throw new Error('Unexpected tune'); }, stop: async () => {},
    },
  });
  return { controller, time, open: () => controller.open('guide'), reads: () => reads, guideReads: () => guideReads,
    fail: (value: boolean) => { failing = value; }, permanent: () => { permanent = true; } };
}

test('initial failures wait 30s then 60s; clock ticks and manual retry cannot form bursts', async () => {
  const s = setup(); s.open();
  try {
    await s.time.settle(); expect(s.reads()).toBe(1);
    for (let i = 0; i < 20; i++) { s.controller.retry(); s.controller.chooseDay(0); s.controller.setGuideChannels([String(i)]); }
    await s.time.advance(29999); expect(s.reads()).toBe(1);
    await s.time.advance(1); expect(s.reads()).toBe(2);
    await s.time.advance(59999); expect(s.reads()).toBe(2);
    s.fail(false); await s.time.advance(1);
    expect(s.reads()).toBe(3); expect(s.controller.view().load).toBe('ready');
  } finally { s.controller.dispose(); }
});

test('Retry-After blocks minute ticks, focus changes and route reentry until its deadline', async () => {
  const s = setup('600'); let close = s.open();
  try {
    await s.time.settle();
    for (let i = 0; i < 9; i++) {
      s.controller.setGuideRange(i * 60, i * 60 + 180); s.controller.setRetainedChannels([String(i)]);
      close(); close = s.open();
      await s.time.advance(MINUTE);
      expect(s.reads()).toBe(1); expect(s.guideReads()).toBe(0);
    }
    s.fail(false); await s.time.advance(MINUTE);
    expect(s.reads()).toBe(2); expect(s.controller.view().load).toBe('ready');
  } finally { close(); s.controller.dispose(); }
});

test('backgrounding cancels retry wakeups and foregrounding retains the deadline', async () => {
  const s = setup('120'); s.open();
  try {
    await s.time.settle(); s.controller.setVisible(false);
    await s.time.advance(90000); expect(s.reads()).toBe(1);
    s.controller.setVisible(true); await s.time.advance(29999); expect(s.reads()).toBe(1);
    s.fail(false); await s.time.advance(1); expect(s.reads()).toBe(2);
  } finally { s.controller.dispose(); }
});

test('leaving the last surface cancels retry wakeups without forgetting the deadline', async () => {
  const s = setup(); const close = s.open();
  try {
    await s.time.settle(); close(); await s.time.advance(20000); expect(s.reads()).toBe(1);
    s.open(); await s.time.advance(9999); expect(s.reads()).toBe(1);
    s.fail(false); await s.time.advance(1); expect(s.reads()).toBe(2);
  } finally { s.controller.dispose(); }
});

test('a failed metadata refresh retains the last good guide and only success restores five-minute refresh', async () => {
  const s = setup('120'); s.fail(false); s.open();
  try {
    await s.time.settle(); await s.time.advance(4 * MINUTE + 59000);
    const last = s.controller.view().guide; expect(last).not.toBeNull();
    s.fail(true); await s.time.advance(2000);
    expect(s.reads()).toBe(2); expect(s.controller.view().guide).toBe(last); expect(s.controller.view().load).toBe('ready');
    await s.time.advance(118000); expect(s.reads()).toBe(2);
    s.fail(false); await s.time.advance(2000); expect(s.reads()).toBe(3);
    await s.time.advance(4 * MINUTE); expect(s.reads()).toBe(3);
    await s.time.advance(2 * MINUTE); expect(s.reads()).toBe(4);
  } finally { s.controller.dispose(); }
});

test('permanent refusals do not schedule a transient retry', async () => {
  const s = setup(); s.permanent(); s.open();
  try {
    await s.time.settle(); await s.time.advance(59000);
    expect(s.reads()).toBe(1); expect(s.controller.view().load).toBe('failed');
  } finally { s.controller.dispose(); }
});

test('a failure from an obsolete viewport still gates the next viewport request', async () => {
  const time = clock(); let reads = 0, reject!: (error: unknown) => void;
  const pending = new Promise<never>((_, fail) => { reject = fail; });
  const controller = new LiveController({
    timing: time.timing, scope: `obsolete-viewport-${++sequence}`, memory: { get: () => null, set: () => {} }, openWatch: () => {},
    source: {
      channels: async () => { if (++reads === 1) return pending; return { items: [], continuation: 'exhausted' }; },
      guide: async q => ({ ...q, items: [], continuation: 'exhausted' }),
      tune: async () => { throw new Error('Unexpected tune'); }, stop: async () => {},
    },
  });
  controller.open('guide');
  try {
    controller.setGuideChannels(['new-viewport']);
    reject(unavailable()); await time.settle();
    await time.advance(29999); expect(reads).toBe(1);
    await time.advance(1); expect(reads).toBe(2); expect(controller.view().load).toBe('ready');
  } finally { controller.dispose(); }
});

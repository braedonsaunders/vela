import { expect, test } from 'bun:test';
import { VelaError } from '@vela/core';
import { LiveController, type LiveOptions } from '../src/widgets/guide/controller';

const MINUTE = 60000;
const unavailable = (retryAfter: string | null = null) => new VelaError({ class: 'capacity', code: 'service_unavailable', message: 'Unavailable', retry: { allowed: true } }, 503, retryAfter);
let sequence = 0;
function clock(start = Date.parse('2026-11-18T12:00:00Z')) {
  let now = start, id = 0;
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

test('failed resume retains the last good guide and only a later resume revalidates again', async () => {
  const s = setup('120'); s.fail(false); s.open();
  try {
    await s.time.settle(); await s.time.advance(5 * MINUTE);
    expect(s.reads()).toBe(1);
    const last = s.controller.view().guide; expect(last).not.toBeNull();
    s.fail(true); s.controller.setVisible(false); s.controller.setVisible(true); await s.time.settle();
    expect(s.reads()).toBe(2); expect(s.controller.view().guide?.channels[0]?.name).toBe(last?.channels[0]?.name);
    expect(s.controller.view().load).toBe('ready');
    await s.time.advance(119999); expect(s.reads()).toBe(2);
    s.fail(false); await s.time.advance(1); expect(s.reads()).toBe(3);
    await s.time.advance(60 * MINUTE); expect(s.reads()).toBe(3);
    s.controller.setVisible(false); s.controller.setVisible(true); await s.time.settle(); expect(s.reads()).toBe(4);
  } finally { s.controller.dispose(); }
});

 test('an idle guide makes zero channel or programme requests over an hour of local ticks', async () => {
  const s = setup(); s.fail(false); s.open();
  try {
    await s.time.advance(200);
    const channels = s.reads(), programmes = s.guideReads();
    await s.time.advance(60 * MINUTE);
    expect(s.reads()).toBe(channels); expect(s.guideReads()).toBe(programmes);
    s.controller.setGuideChannels(['one']); s.controller.setGuideRange(720, 750); s.controller.chooseDay(0);
    await s.time.advance(200);
    expect(s.reads()).toBe(channels); expect(s.guideReads()).toBe(programmes);
  } finally { s.controller.dispose(); }
});

 test('the clock prefetches one missing window when less than an hour remains', async () => {
  const s = setup(); s.fail(false); s.controller.setGuideRange(710, 760); s.open();
  try {
    await s.time.advance(90 * MINUTE);
    const channels = s.reads(), programmes = s.guideReads();
    await s.time.advance(60 * MINUTE);
    expect(s.reads()).toBe(channels); expect(s.guideReads() - programmes).toBe(1);
    await s.time.advance(20 * MINUTE);
    expect(s.guideReads() - programmes).toBe(1);
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

test('an initial request spanning midnight loads today before publishing programme focus', async () => {
  const time = clock(Date.parse('2026-11-18T23:59:30Z'));
  let release!: () => void, reads = 0;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const controller = new LiveController({
    timing: time.timing, scope: `midnight-open-${++sequence}`, memory: { get: () => null, set: () => {} }, openWatch: () => {},
    source: {
      channels: async () => { reads++; await pending; return { items: [{ id: 'one', name: 'One', number: '1', kind: 'tv', favorite: false, artwork: [] }], continuation: 'exhausted' }; },
      guide: async q => ({ ...q, items: [{ id: q.from, channelId: 'one', name: 'Programme', summary: '', start: q.from, end: q.until, artwork: [] }], continuation: 'exhausted' }),
      tune: async () => { throw new Error('Unexpected tune'); }, stop: async () => {},
    },
  });
  controller.open('guide');
  try {
    await time.advance(31000); expect(controller.view().guide).toBeNull();
    release(); await time.settle(); await time.advance(250);
    expect(controller.view().load).toBe('ready');
    expect(controller.view().guide?.day).toBe(0);
    const guide = controller.view().guide!;
    expect(guide.startsAt! + guide.dayStarts![0]! * MINUTE).toBe(Date.parse('2026-11-19T00:00:00Z'));
    expect(guide.nowMinute).toBeGreaterThanOrEqual(guide.dayStarts![0]!);
    expect(guide.channels[0]?.nowId).toContain('2026-11-19');
    expect(reads).toBe(1);
  } finally { controller.dispose(); }
});

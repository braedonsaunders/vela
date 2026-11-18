import { expect, test } from 'bun:test';
import { LiveController } from '../src/widgets/guide/controller';
import type { Channel, Page } from '../../core/src/wire';

test('late guide responses and child cleanup cannot restart a disposed controller', async () => {
  let release!: (page: Page<Channel>) => void;
  let reads = 0, notifications = 0;
  const pending = new Promise<Page<Channel>>(resolve => { release = resolve; });
  const controller = new LiveController({
    scope: 'disposed-guide', memory: { get: () => null, set: () => {} }, openWatch: () => {},
    source: {
      channels: async () => { reads++; return pending; },
      guide: async q => ({ from: q.from, until: q.until, items: [], continuation: 'exhausted' }),
      tune: async () => { throw new Error('Unexpected tune'); }, stop: async () => {},
    },
  });
  controller.open('guide');
  controller.dispose();
  controller.subscribe(() => { notifications++; });
  controller.setGuideChannels(['late-child-cleanup']);
  controller.open('guide');
  release({ items: [], continuation: 'exhausted' });
  await Bun.sleep(140);
  expect(reads).toBe(1);
  expect(notifications).toBe(0);
});

test('an already retained offscreen preview cannot refetch on every visible focus move', async () => {
  const controller = new LiveController({
    scope: `retained-guide-${Date.now()}`, memory: { get: () => null, set: () => {} }, openWatch: () => {},
    source: {
      channels: async () => ({ items: ['preview', 'one', 'two'].map((id, i) => ({ id, name: id, number: String(i), kind: 'tv', favorite: false, artwork: [] } as Channel)), continuation: 'exhausted' }),
      guide: async q => ({ from: q.from, until: q.until, items: [], continuation: 'exhausted' }),
      tune: async () => { throw new Error('Unexpected tune'); }, stop: async () => {},
    },
  });
  try {
    controller.setGuideChannels(['one', 'two']);
    controller.setRetainedChannels(['preview', 'one']);
    const close = controller.open('guide');
    await Bun.sleep(250);
    // Keep a wall-clock minute boundary out of the projection-count observation.
    close();
    let updates = 0;
    controller.subscribe(() => { updates++; });
    controller.setRetainedChannels(['preview', 'two']);
    await Bun.sleep(140);
    expect(updates).toBe(0);
  } finally { controller.dispose(); }
});

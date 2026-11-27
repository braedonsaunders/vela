import { expect, test } from 'bun:test';
import type { PlaybackPlan } from '../../protocol/types';
import { LiveController } from '../src/widgets/guide/controller';
import { Tile } from '../src/widgets/guide/tile';

const plan = (id: string): PlaybackPlan => ({
  sessionId: id, revision: 1, sourceGeneration: 1, seekGeneration: 1, channelId: 'one', state: 'playing',
  durationSeconds: 0, positionSeconds: 0, paths: [], selectedPathId: '', audioTracks: [], subtitleTracks: [],
  selectedSubtitleTrackId: null, chapters: [], fallback: { state: 'unsupported' },
});

async function tile(mode: 'auto' | 'on-click' | 'off') {
  const tuned: string[] = [];
  const stopped: string[] = [];
  const value = new Tile({
    channels: async () => ({ items: [], continuation: 'exhausted' }),
    guide: async query => ({ from: query.from, until: query.until, items: [], continuation: 'exhausted' }),
    tune: async id => { tuned.push(id); return plan(`session-${tuned.length}`); },
    stop: async value => { stopped.push(value.sessionId); },
  }, () => {}, () => {});
  value.setMode(mode);
  value.update({ open: true, order: ['one'], remembered: '', quiet: false, canPreview: true });
  await Promise.resolve(); await Promise.resolve();
  return { value, tuned, stopped };
}

test('live preview policy separates automatic, explicit and disabled tuning', async () => {
  const automatic = await tile('auto');
  expect(automatic.tuned).toEqual(['one']);

  const clicked = await tile('on-click');
  expect(clicked.tuned).toEqual([]);
  expect(clicked.value.view().state).toBe('tune-in');
  clicked.value.tuneIn();
  await Promise.resolve(); await Promise.resolve();
  expect(clicked.tuned).toEqual(['one']);

  const disabled = await tile('off');
  expect(disabled.tuned).toEqual([]);
  expect(disabled.value.view().state).toBe('off');
  disabled.value.tuneIn();
  await Promise.resolve();
  expect(disabled.tuned).toEqual([]);
});

test('closing a preview surface reports off and releases the held session', async () => {
  const current = await tile('auto');
  current.value.update({ open: false, order: ['one'], remembered: '', quiet: false, canPreview: true });
  await Promise.resolve(); await Promise.resolve();
  expect(current.value.view().state).toBe('off');
  expect(current.value.view().plan).toBeNull();
  expect(current.stopped).toEqual(['session-1']);
});

test('a listings-only guide has no ambient tune and releases a preview or full watch when it takes over', async () => {
  const tuned: string[] = [], stopped: string[] = [];
  const controller = new LiveController({
    scope: 'listings-only-guide', memory: { get: () => null, set: () => {} }, openWatch: () => {},
    source: {
      channels: async () => ({ items: [{ id: 'one', name: 'One', number: '101', kind: 'tv', favorite: false, artwork: [] }], continuation: 'exhausted' }),
      guide: async q => ({ from: q.from, until: q.until, items: [], continuation: 'exhausted' }),
      tune: async id => { tuned.push(id); return plan(`session-${tuned.length}`); },
      stop: async value => { stopped.push(value.sessionId); },
    },
  });
  controller.setCanPreview(true);
  const close = controller.open('guide', false);
  try {
    for (let i = 0; i < 20 && controller.view().load !== 'ready'; i++) await Bun.sleep(10);
    expect(controller.view().load).toBe('ready');
    expect(controller.view().guide?.channels.map(channel => channel.id)).toEqual(['one']);
    controller.initializePreview('one');
    expect(tuned).toEqual([]);
    expect(controller.view().tile.state).toBe('off');

    const closePreview = controller.open('guide');
    await Promise.resolve();
    expect(tuned).toEqual(['one']);
    closePreview();
    expect(stopped).toEqual(['session-1']);
    expect(controller.view().tile.state).toBe('off');

    controller.watch('one');
    await Promise.resolve();
    expect(tuned).toEqual(['one', 'one']);
    expect(controller.view().tile.fullscreen).toBe(true);
    controller.leaveWatch('one');
    expect(stopped).toEqual(['session-1', 'session-2']);
    expect(controller.view().tile.state).toBe('off');
  } finally {
    close();
    controller.dispose();
  }
});

test('a tune that resolves after the preview closes is stopped, and reopening can tune again', async () => {
  let finish!: (value: PlaybackPlan) => void;
  let starts = 0;
  const stopped: string[] = [];
  const value = new Tile({
    channels: async () => ({ items: [], continuation: 'exhausted' }),
    guide: async q => ({ from: q.from, until: q.until, items: [], continuation: 'exhausted' }),
    tune: () => ++starts === 1 ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(plan('next')),
    stop: async owner => { stopped.push(owner.sessionId); },
  }, () => {}, () => {});
  const inputs = { open: true, order: ['one'], remembered: '', quiet: false, canPreview: true };
  try {
    value.update(inputs);
    value.update({ ...inputs, open: false });
    finish(plan('late'));
    await Promise.resolve();
    expect(stopped).toEqual(['late']);
    expect(value.view().plan).toBeNull();
    value.update(inputs);
    await Promise.resolve();
    expect(starts).toBe(2);
    expect(value.view().plan?.sessionId).toBe('next');
  } finally {
    value.dispose();
  }
});

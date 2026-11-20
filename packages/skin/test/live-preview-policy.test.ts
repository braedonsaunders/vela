import { expect, test } from 'bun:test';
import type { PlaybackPlan } from '../../protocol/types';
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

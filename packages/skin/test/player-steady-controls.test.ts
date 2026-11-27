// The player's controls skip a redraw that only moved the clock, and only that.
import { expect, test } from 'bun:test';
import { sameControls, type ControlProps } from '../src/widgets/player/steady-controls';
import type { PlayerView } from '../src/widgets/player/present';
import type { PlayerChromeState } from '../src/widgets/player/context';

const audio = [{ id: 'a1', name: 'English', detail: '' }];
const view = (extra: Partial<PlayerView> = {}) => ({ state: 'playing', playing: true, position: 10, progress: 0.1, elapsed: '0:10',
  remaining: '-1:30', buffered: [], stats: { buffer: '3 s' }, duration: 100, audio, quality: '1080p', ...extra } as unknown as PlayerView);
const plan = { sessionId: 's' };
const state = (extra: Partial<PlayerChromeState> = {}) => ({ plan, snapshot: { position: 1 }, title: 'T', ...extra } as unknown as PlayerChromeState);
const seek = () => {};
const props = (extra: Partial<ControlProps> = {}): ControlProps =>
  ({ view: view(), state: state(), live: { live: false }, opened: null, visible: true, seek, ...extra });

test('a redraw that only moved the clock leaves the controls', () => {
  const a = props();
  expect(sameControls(a, props({ view: view({ position: 11, progress: 0.11, elapsed: '0:11', remaining: '-1:29', stats: { buffer: '4 s' } } as never),
    state: state({ snapshot: { position: 2 } } as never) }))).toBe(true);
});

test('anything the controls show draws them', () => {
  const a = props();
  expect(sameControls(a, props({ view: view({ playing: false }) }))).toBe(false);
  expect(sameControls(a, props({ view: view({ audio: [...audio] }) }))).toBe(false);
  expect(sameControls(a, props({ visible: false }))).toBe(false);
  expect(sameControls(a, props({ seek: () => {} }))).toBe(false);
  expect(sameControls(a, props({ state: state({ plan: { sessionId: 's2' } } as never) }))).toBe(false);
  expect(sameControls(a, props({ state: state({ pendingQualityId: 'path:x' }) }))).toBe(false);
});

test('a live picture and the chapter strip always draw', () => {
  expect(sameControls(props({ live: { live: true } }), props({ live: { live: true } }))).toBe(false);
  expect(sameControls(props({ opened: 'chapters' }), props({ opened: 'chapters' }))).toBe(false);
});

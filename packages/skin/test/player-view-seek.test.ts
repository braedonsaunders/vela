import { expect, test } from 'bun:test';
import type { Command } from '@vela/player-api';
import { restartAt, viewCommand } from '../src/widgets/player/present';

test('a view mounted for a replacement session does not replay a seek from the old session', () => {
  // Seek to 90 was sent on s1; the replacement s2 opened at 97.6 s.
  const seek = { id: 3, type: 'seek', seconds: 90 } as Command;
  expect(viewCommand(seek, 's1', 's1', 'title')).toBe(seek);
  expect(viewCommand(seek, 's1', 's2', 'title')).toBeUndefined();
  const back = { id: 4, type: 'seekBy', seconds: -10 } as Command;
  expect(viewCommand(back, 's1', 's1', 'title')).toBe(back);
  expect(viewCommand(back, 's1', 's2', 'title')).toBeUndefined();
});

test('other commands still reach a remounted view', () => {
  const mute = { id: 1, type: 'mute', muted: true } as Command;
  expect(viewCommand(mute, '', 's1', 'title')).toBe(mute);
  const pause = { id: 2, type: 'pause' } as Command;
  expect(viewCommand(pause, 's1', 's2', 'title')).toBe(pause);
  expect(viewCommand(undefined, 's1', 's2', 'title')).toBeUndefined();
});

test('an archived programme or an extra, which does not restart from the restart position, keeps the seek on a remounted view', () => {
  const seek = { id: 3, type: 'seek', seconds: 900 } as Command;
  expect(viewCommand(seek, 's1', 's2', 'programme')).toBe(seek);
  expect(viewCommand(seek, 's1', 's2', 'extra')).toBe(seek);
});

test('Try again and a return to the foreground start again at a zero the player presented', () => {
  // A Start Over to 0 s, confirmed and reported paused, on a title opened with a 1800 s resume point.
  expect(restartAt(0, true)).toBe(0);
  // A zero reported while loading is a reset clock: the title's own start point stands.
  expect(restartAt(0, false)).toBeUndefined();
  expect(restartAt(1815, false)).toBe(1815);
});

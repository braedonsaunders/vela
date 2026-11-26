import { expect, test } from 'bun:test';
import type { Command } from '@vela/player-api';
import { viewCommand } from '../src/widgets/player/present';

test('a view mounted for a replacement session does not replay a track command from the old file', () => {
  // Forced subtitle 4 was chosen on s1; on the replacement file of s2, 4 is the regular one.
  const forced = { id: 3, type: 'subtitle', trackId: '4' } as Command;
  expect(viewCommand(forced, 's1', 's1')).toBe(forced);
  expect(viewCommand(forced, 's1', 's2')).toBeUndefined();
  const french = { id: 4, type: 'audio', trackId: '2' } as Command;
  expect(viewCommand(french, 's1', 's2')).toBeUndefined();
});

test('other commands still reach a remounted view', () => {
  const mute = { id: 1, type: 'mute', muted: true } as Command;
  expect(viewCommand(mute, '', 's1')).toBe(mute);
  const pause = { id: 2, type: 'pause' } as Command;
  expect(viewCommand(pause, 's1', 's2')).toBe(pause);
  expect(viewCommand(undefined, 's1', 's2')).toBeUndefined();
});

import { expect, test } from 'bun:test';
import { playsOnAfterEnd } from '../web/engine/host/continuation';

const base = { ended: true, sameSession: true, serverState: 'playing', sourceGeneration: 2, previousSourceGeneration: 1 };
test('a session moved on to a new source after its media ended plays on (the next part)', () => {
  expect(playsOnAfterEnd(base)).toBe(true);
});
test('an ended title, a paused session, another session or the same source stays as it is', () => {
  expect(playsOnAfterEnd({ ...base, serverState: 'ended' })).toBe(false);
  expect(playsOnAfterEnd({ ...base, serverState: 'paused' })).toBe(false);
  expect(playsOnAfterEnd({ ...base, sameSession: false })).toBe(false);
  expect(playsOnAfterEnd({ ...base, sourceGeneration: 1 })).toBe(false);
  expect(playsOnAfterEnd({ ...base, ended: false })).toBe(false);
});

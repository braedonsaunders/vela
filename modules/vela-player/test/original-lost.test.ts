import { expect, test } from 'bun:test';
import { isOriginalLostError, originalEndedEarly, originalLostError, originalLostResponse } from '../web/engine/original-lost';

test('only Ether original_lost 409 responses request a plan refresh', () => {
  expect(originalLostResponse(new Response('', { status: 409, headers: { 'X-Ether-Playback-Error': 'original_lost' } }))).toBe(true);
  expect(originalLostResponse(new Response('', { status: 409 }))).toBe(false);
  expect(originalLostResponse(new Response('', { status: 410, headers: { 'X-Ether-Playback-Error': 'original_lost' } }))).toBe(false);
});

test('a truncated original has a private typed marker and never looks like a natural end', () => {
  expect(isOriginalLostError(originalLostError('truncated'))).toBe(true);
  expect(originalEndedEarly(47, 180)).toBe(true);
  expect(originalEndedEarly(179, 180)).toBe(false);
  expect(originalEndedEarly(47, null)).toBe(false);
});

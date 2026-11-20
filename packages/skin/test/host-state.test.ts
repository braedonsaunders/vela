import { expect, test } from 'bun:test';
import type { VelaState } from '@vela/core';
import { createHostStateSelector } from '../../../apps/vela/src/host-state';

test('player snapshots and keyed pages do not invalidate the app host', () => {
  const select = createHostStateSelector();
  const state = { auth: {}, home: {}, playback: {}, library: {}, collections: {} } as VelaState;
  expect(select(state)).toBe(state);
  expect(select({ ...state, playback: {} } as VelaState)).toBe(state);
  expect(select({ ...state, library: {}, collections: {} } as VelaState)).toBe(state);
  const changed = { ...state, auth: {} } as VelaState;
  expect(select(changed)).toBe(changed);
  const catalogue = { ...changed, home: {} } as VelaState;
  expect(select(catalogue)).toBe(catalogue);
});

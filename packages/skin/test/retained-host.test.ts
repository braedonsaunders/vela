import { expect, test } from 'bun:test';
import type { SkinHost } from '../src/host';
import { retainedHost } from '../../../apps/vela/src/retained-host';

test('covered route freezes content, then takes the latest host on return', () => {
  const a = { doc: {}, env: { viewer: {}, query: '' } } as SkinHost;
  const b = { ...a, env: { ...a.env, query: 'new' } };
  expect(retainedHost(a, b, false)).toBe(a);
  expect(retainedHost(a, b, true)).toBe(b);
  expect(retainedHost(a, { ...b, doc: {} } as SkinHost, false)).not.toBe(a);
  expect(retainedHost(a, { ...b, env: { ...b.env, viewer: {} } } as SkinHost, false)).not.toBe(a);
  expect(retainedHost(a, null, false)).toBeNull();
  expect(retainedHost(null, a, false)).toBe(a);
});

import { describe, expect, test } from 'bun:test';
import { HostReader, HostSource } from '../src/host-source';
import type { SkinHost } from '../src/host';

const doc = { name: 'doc' }, viewport = { width: 100 }, dispatch = () => {};
const base = (env: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  ({ doc, viewport, dispatch, env, ...extra }) as unknown as SkinHost;

describe('tracked host', () => {
  test('a reader moves only when a key it read changes', () => {
    const flags: string[] = [];
    const source = new HostSource(base({ flags, heroIndex: 0, home: 'h' }));
    const reader = new HostReader(source);
    expect(reader.snapshot()).toBe(0);
    expect(reader.host.env.flags).toBe(flags);
    const view = reader.host;
    source.publish(base({ flags, heroIndex: 1, home: 'h' }));
    expect(reader.snapshot()).toBe(0);
    expect(reader.host).toBe(view);
    source.publish(base({ flags: ['menu'], heroIndex: 1, home: 'h' }));
    expect(reader.snapshot()).toBe(1);
    expect(reader.host).not.toBe(view);
    expect(reader.host.env.flags).toEqual(['menu']);
  });

  test('reads see the latest host, including keys first read after a change', () => {
    const source = new HostSource(base({ heroIndex: 0 }));
    const reader = new HostReader(source);
    source.publish(base({ heroIndex: 3 }));
    reader.snapshot();
    expect(reader.host.env.heroIndex).toBe(3);
    source.publish(base({ heroIndex: 4 }));
    expect(reader.snapshot()).toBe(1);
  });

  test('host keys other than env are tracked too', () => {
    const source = new HostSource(base({}, { children: 'a' }));
    const reader = new HostReader(source);
    expect(reader.host.viewport.width).toBe(100);
    source.publish(base({}, { children: 'b' }));
    expect(reader.snapshot()).toBe(0);
    source.publish({ ...base({}, { children: 'b' }), viewport: { width: 200 } } as unknown as SkinHost);
    expect(reader.snapshot()).toBe(1);
  });

  test('a spread copies the latest values and tracks every key', () => {
    const source = new HostSource(base({ query: '' }));
    const reader = new HostReader(source);
    const copy = { ...reader.host, viewport: { width: 1 } };
    expect(copy.doc).toEqual({ name: 'doc' } as never);
    expect(copy.viewport.width).toBe(1);
    expect({ ...copy.env }).toEqual({ query: '' } as never);
    source.publish(base({ query: 'x' }));
    expect(reader.snapshot()).toBe(1);
  });
});

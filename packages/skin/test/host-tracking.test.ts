import { describe, expect, test } from 'bun:test';
import { HostReader, HostSource, selectEnv } from '../src/host-source';
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

  test('a native font registration redraws a reader whose other inputs are unchanged', () => {
    const host = base({ heroIndex: 0 }, { fontRevision: 1 });
    const source = new HostSource(host);
    const reader = new HostReader(source);
    expect(reader.host.viewport.width).toBe(100);
    source.publish({ ...host, fontRevision: 2 });
    expect(reader.snapshot()).toBe(1);
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

describe('selected env reads', () => {
  test("a card redraws when its own preview starts or ends, not another card's", () => {
    const source = new HostSource(base({ preview: { cardId: '', heroId: '' }, flags: [] }));
    const a = new HostReader(source), b = new HostReader(source);
    const playing = (reader: HostReader, id: string) => selectEnv(reader.host.env, 'preview', `card:${id}`, p => p?.cardId === id);
    expect(playing(a, 'a')).toBe(false);
    expect(playing(b, 'b')).toBe(false);
    source.publish(base({ preview: { cardId: 'a', heroId: '' }, flags: [] }));
    expect(a.snapshot()).toBe(1);
    expect(b.snapshot()).toBe(0);
    expect(playing(a, 'a')).toBe(true);
    source.publish(base({ preview: { cardId: 'c', heroId: '' }, flags: [] }));
    expect(a.snapshot()).toBe(2);
    expect(b.snapshot()).toBe(0);
  });

  test('a flag redraws only the nodes it shows or hides', () => {
    const source = new HostSource(base({ flags: [] }));
    const menu = new HostReader(source), other = new HostReader(source);
    const open = (reader: HostReader, flag: string) => selectEnv(reader.host.env, 'flags', `flag:${flag}`, flags => flags.includes(flag));
    open(menu, 'menu');
    open(other, 'drawer');
    source.publish(base({ flags: ['hero-interacting'] }));
    expect(menu.snapshot()).toBe(0);
    expect(other.snapshot()).toBe(0);
    source.publish(base({ flags: ['hero-interacting', 'menu'] }));
    expect(menu.snapshot()).toBe(1);
    expect(other.snapshot()).toBe(0);
  });

  test('a node that also reads the key itself redraws for any change of it', () => {
    const source = new HostSource(base({ flags: [] }));
    const reader = new HostReader(source);
    selectEnv(reader.host.env, 'flags', 'flag:menu', flags => flags.includes('menu'));
    expect(reader.host.env.flags).toEqual([]);
    source.publish(base({ flags: ['other'] }));
    expect(reader.snapshot()).toBe(1);
  });

  test('outside a tracked host it is the plain read', () => {
    const env = { flags: ['menu'] } as unknown as SkinHost['env'];
    expect(selectEnv(env, 'flags', 'flag:menu', flags => flags.includes('menu'))).toBe(true);
  });
});

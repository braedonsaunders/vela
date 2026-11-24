// Ether's rewriting of a plugin answer, as the mock does it (in process, on a frozen clock).
import { beforeAll, expect, test } from 'bun:test';

process.env.VELA_MOCK_SPORTS_FREEZE = '1';
let checkArg: (spec: { type: string; max?: number; enum?: string[] }, value: unknown) => unknown;
let rewrite: (value: unknown, records: { type: string; id: string; value: unknown }[], plugin: unknown, read: unknown) => unknown;
beforeAll(async () => {
  const sports = await import('../sports');
  sports.initSports([]);
  const screens = await import('../screens');
  rewrite = screens.rewritePlugin as typeof rewrite;
  checkArg = screens.checkArg as typeof checkArg;
  // Read once at import: other test files (and the mocks they launch) must not inherit it.
  delete process.env.VELA_MOCK_SPORTS_FREEZE;
});

const plugin = { pluginID: 'sports', version: '2.0.0', feeds: ['sports'], hosts: ['img.example'], routes: {}, actions: {} };
const read = () => ({ viewerId: 'v1', tz: 'UTC', records: {} as Record<string, { rev: number; value: unknown }>, scope: '' });

test('envelopes become references, images and links; everything else that could load a URL is dropped', () => {
  const r = read();
  const out = rewrite({
    story: { $record: { type: 'story', id: 's1' } },
    unknownRecord: { $record: { type: 'story', id: 'nope' } },
    hero: { $image: 'https://img.example/a.jpg' },
    foreignImage: { $image: 'https://evil.example/a.jpg' },
    asset: { $image: 'asset:icons/x.svg' },
    escape: { $image: 'asset:../secret' },
    link: { $link: 'https://site.example/a?b=1' },
    plainLink: { $link: 'http://site.example/' },
    bare: 'https://site.example/raw',
    sneaky: 'javascript:alert(1)',
    text: 'Hello',
    game: { $event: { feed: 'sports', id: 'nfl-nyg-phi' } },
    foreignGame: { $event: { feed: 'other', id: 'x' } },
    team: { $entity: { feed: 'sports', kind: 'team', id: 'nfl-phi' } },
    item: { $item: { kind: 'clips', id: 'c1' } },
    channel: { $channel: 'ch-1' },
    weird: { $unknown: 1 },
    mixed: { $secret: 'x', visible: 1 },
    list: [{ $record: { type: 'story', id: 's1' } }, { $item: { kind: 'clips', id: 'c1' } }, 'keep', { $event: { feed: 'other', id: 'x' } }, null],
  }, [{ type: 'story', id: 's1', value: { title: 'T', cover: { $image: 'https://img.example/c.jpg' }, raw: 'https://x.example' } }, { type: 'Bad Type', id: 'x', value: {} }], plugin, r) as Record<string, unknown>;
  expect(out.story).toEqual({ $record: 'p:story:s1' });
  expect(out.unknownRecord).toBeNull();
  expect(out.hero).toMatch(/^\/vela\/v0\/artwork\//);
  expect(out.foreignImage).toBeNull();
  expect(out.asset).toBe('/vela/v0/screen-assets/sports/2.0.0/icons/x.svg');
  expect(out.escape).toBeNull();
  expect(out.link).toEqual({ href: 'https://site.example/a?b=1', host: 'site.example' });
  expect(out.plainLink).toBeNull();
  expect(out.bare).toBeNull();
  expect(out.sneaky).toBeNull();
  expect(out.text).toBe('Hello');
  expect(out.game).toEqual({ $record: 'event:sports:sports:nfl-nyg-phi' });
  expect(out.foreignGame).toBeNull();
  expect(out.team).toEqual({ $record: 'entity:sports:sports:team:nfl-phi' });
  expect(out.item).toBeNull();
  expect(out.channel).toBeNull();
  expect(out.weird).toBeNull();
  expect(out.mixed).toEqual({ visible: 1 });
  // A dropped envelope closes its gap in a list; a plain null stays.
  expect(out.list).toEqual([{ $record: 'p:story:s1' }, 'keep', null]);
  expect(Object.keys(r.records).sort()).toEqual(['entity:sports:sports:team:nfl-phi', 'event:sports:sports:nfl-nyg-phi', 'p:story:s1']);
  const story = r.records['p:story:s1']!.value as Record<string, unknown>;
  expect(story.title).toBe('T');
  expect(story.cover).toMatch(/^\/vela\/v0\/artwork\//);
  expect(story.raw).toBeNull();
});

test('more than 500 records refuse the answer', () => {
  expect(() => rewrite({}, Array.from({ length: 501 }, (_, n) => ({ type: 'story', id: `s${n}`, value: {} })), plugin, read())).toThrow();
});

test('plugin action arguments: raw JSON of the declared type, or text coerced to it', () => {
  expect([true, 'true', '1', false, 'false', '0'].map(v => checkArg({ type: 'bool' }, v))).toEqual([true, true, true, false, false, false]);
  expect(() => checkArg({ type: 'bool' }, 'yes')).toThrow();
  expect(() => checkArg({ type: 'bool' }, 1)).toThrow();
  expect([12, '12', '-3'].map(v => checkArg({ type: 'int' }, v))).toEqual([12, 12, -3]);
  expect(() => checkArg({ type: 'int' }, '1.5')).toThrow();
  expect(() => checkArg({ type: 'int' }, 'twelve')).toThrow();
  expect(checkArg({ type: 'strings' }, 'a,b')).toEqual(['a', 'b']);
  expect(checkArg({ type: 'strings' }, ['a', 'b'])).toEqual(['a', 'b']);
  expect(checkArg({ type: 'strings' }, '')).toEqual([]);
  expect(() => checkArg({ type: 'strings' }, [1])).toThrow();
  expect(checkArg({ type: 'string', enum: ['top', 'tech'] }, 'tech')).toBe('tech');
  expect(() => checkArg({ type: 'string', enum: ['top'] }, 'tech')).toThrow();
  expect(() => checkArg({ type: 'string' }, true)).toThrow();
  expect(() => checkArg({ type: 'date' }, '2026-13')).toThrow();
  expect(checkArg({ type: 'ref' }, 'entity:sports:sports:team:nfl-phi')).toBe('entity:sports:sports:team:nfl-phi');
  for (const key of ['event:a', 'item:b', 'channel:c', 'p:story:s1']) expect(checkArg({ type: 'ref' }, key)).toBe(key);
  expect(() => checkArg({ type: 'ref' }, 'sports:sports:nfl-nyg-phi')).toThrow();
  expect(() => checkArg({ type: 'ref' }, 'detail:x')).toThrow();
});

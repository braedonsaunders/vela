// Scrub thumbnails: where a moment's frame sits in the sheets, the sheets as image URIs, the sheet
// cache's reads, and each adapter's offer and sheet read.
import { afterEach, describe, expect, test } from 'bun:test';
import { base64, jellyfinTrickplay, sheetURI, trickplayCell } from '../src/protocol/trickplay';
import { TrickplayCache, type SheetRead } from '../src/store/trickplay';
import { JellyfinAdapter } from '../src/adapter/jellyfin';
import { EtherAdapter } from '../src/adapter/ether';
import { Playback, initialPlayback } from '../src/store/playback';
import { StateBox } from '../src/store/state';
import type { VelaState } from '../src/store';
import type { Session } from '../src/store/session';
import type { TrickplaySheet } from '../src/adapter/capabilities';
import type * as V from '../src/wire';
import { FakeCredentials, device, restoreFetch, routeFetch } from './helpers';

afterEach(restoreFetch);

const offer: V.TrickplayMetadata = { width: 320, height: 180, intervalMs: 10_000, count: 250, cols: 10, rows: 10, coverageUntilMs: 2_500_000, revision: 1 };
const jpeg = (marker = 1) => new Uint8Array([0xff, 0xd8, 0xff, marker]);
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

describe('trickplayCell', () => {
  test('finds the slot, its sheet and its cell', () => {
    expect(trickplayCell(offer, 0)).toEqual({ sheet: 0, column: 0, row: 0 });
    expect(trickplayCell(offer, 9.99)).toEqual({ sheet: 0, column: 0, row: 0 });
    expect(trickplayCell(offer, 125)).toEqual({ sheet: 0, column: 2, row: 1 });
    // Slot 100 starts the second sheet; slot 123 is its fourth column, third row.
    expect(trickplayCell(offer, 1000)).toEqual({ sheet: 1, column: 0, row: 0 });
    expect(trickplayCell(offer, 1235)).toEqual({ sheet: 1, column: 3, row: 2 });
  });

  test('has no frame before zero, past the last slot or beyond contiguous coverage', () => {
    expect(trickplayCell(offer, -1)).toBeNull();
    expect(trickplayCell(offer, Number.NaN)).toBeNull();
    expect(trickplayCell(offer, 2500)).toBeNull();
    const growing = { ...offer, coverageUntilMs: 65_000 };
    expect(trickplayCell(growing, 60)).toEqual({ sheet: 0, column: 6, row: 0 });
    expect(trickplayCell(growing, 70)).toBeNull();
    expect(trickplayCell({ ...offer, coverageUntilMs: 0 }, 0)).toBeNull();
  });
});

describe('sheet images', () => {
  test('base64 matches the platform encoder at every padding', () => {
    for (const text of ['', 'f', 'fo', 'foo', 'foob', 'fooba', 'foobar']) {
      const bytes = new TextEncoder().encode(text);
      expect(base64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
    }
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(base64(all)).toBe(Buffer.from(all).toString('base64'));
  });

  test('only JPEG and PNG become images; an untyped sheet is known by its bytes', () => {
    expect(sheetURI(jpeg(), 'image/jpeg')).toBe(`data:image/jpeg;base64,${Buffer.from(jpeg()).toString('base64')}`);
    expect(sheetURI(jpeg(), '')).toStartWith('data:image/jpeg;base64,');
    expect(sheetURI(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), 'application/octet-stream')).toStartWith('data:image/png;base64,');
    expect(sheetURI(jpeg(), 'text/html')).toBeNull();
    expect(sheetURI(new Uint8Array([1, 2, 3]), '')).toBeNull();
    expect(sheetURI(new Uint8Array(), 'image/jpeg')).toBeNull();
  });
});

describe('jellyfinTrickplay', () => {
  const info = (Width: number) => ({ Width, Height: Width * 9 / 16, TileWidth: 10, TileHeight: 10, ThumbnailCount: 600, Interval: 10000, Bandwidth: 1 });

  test('reads Jellyfin\'s source-then-width manifest for the playing source, nearest 320 wide', () => {
    const manifest = { main: { 160: info(160), 320: info(320), 640: info(640) }, other: { 320: { ...info(320), Interval: 5000 } } };
    expect(jellyfinTrickplay(manifest, 'main')).toEqual({ sourceId: 'main', width: 320, height: 180, intervalMs: 10000, count: 600, cols: 10, rows: 10, coverageUntilMs: 6_000_000, revision: 0 });
    expect(jellyfinTrickplay(manifest, 'other')?.intervalMs).toBe(5000);
    expect(jellyfinTrickplay(manifest, 'missing')).toBeNull();
  });

  test('reads a width-first manifest too, and takes a single source as the playing one', () => {
    expect(jellyfinTrickplay({ 320: { 'item-guid': info(320) } }, 'source-id')).toMatchObject({ sourceId: 'item-guid', width: 320, count: 600 });
  });

  test('ignores empty, malformed or incomplete manifests', () => {
    expect(jellyfinTrickplay(undefined, 'main')).toBeNull();
    expect(jellyfinTrickplay({}, 'main')).toBeNull();
    expect(jellyfinTrickplay({ main: { 320: { ...info(320), Interval: 0 } } }, 'main')).toBeNull();
    expect(jellyfinTrickplay({ main: 'x' }, 'main')).toBeNull();
  });
});

describe('TrickplayCache', () => {
  function reader(answers: (index: number, etag?: string) => TrickplaySheet | null | Promise<TrickplaySheet | null>) {
    const reads: { index: number; etag?: string }[] = [];
    const read: SheetRead = async (index, etag) => {
      reads.push({ index, ...(etag ? { etag } : {}) });
      return answers(index, etag);
    };
    return { reads, read };
  }

  test('reads a sheet once, then draws every frame of it from the copy held', async () => {
    const cache = new TrickplayCache();
    let heard = 0;
    cache.subscribe(() => heard++);
    const { reads, read } = reader(index => ({ bytes: jpeg(index), mimeType: 'image/jpeg', etag: `"s${index}"` }));
    expect(cache.frame('s1', 1, offer, 125, read)).toBeNull();
    expect(cache.frame('s1', 1, offer, 135, read)).toBeNull();
    await settle();
    expect(heard).toBe(1);
    expect(cache.frame('s1', 1, offer, 125, read)).toEqual({
      sheet: 0, column: 2, row: 1, columns: 10, rows: 10, width: 320, height: 180, uri: sheetURI(jpeg(0), 'image/jpeg')!,
    });
    expect(cache.frame('s1', 1, offer, 990, read)?.column).toBe(9);
    expect(reads).toEqual([{ index: 0 }]);
  });

  test('a new revision is revalidated with the ETag while the held copy stays on screen', async () => {
    let now = 0;
    const cache = new TrickplayCache(() => now);
    let release!: (value: TrickplaySheet) => void;
    const { reads, read } = reader((_, etag) => etag ? new Promise(resolve => { release = resolve; }) : { bytes: jpeg(1), mimeType: 'image/jpeg', etag: '"r1"' });
    cache.frame('s1', 1, offer, 0, read);
    await settle();
    const before = cache.frame('s1', 1, offer, 0, read)!.uri;
    const republished = { ...offer, revision: 2 };
    expect(cache.frame('s1', 1, republished, 0, read)?.uri).toBe(before);
    expect(reads).toEqual([{ index: 0 }, { index: 0, etag: '"r1"' }]);
    release('unchanged');
    await settle();
    expect(cache.frame('s1', 1, republished, 0, read)?.uri).toBe(before);
    expect(reads.length).toBe(2);
    // An aged sheet is revalidated too, and new bytes replace it.
    now += 61_000;
    cache.frame('s1', 1, republished, 0, read);
    release({ bytes: jpeg(9), mimeType: 'image/jpeg' });
    await settle();
    expect(cache.frame('s1', 1, republished, 0, read)?.uri).toBe(sheetURI(jpeg(9), 'image/jpeg')!);
  });

  test('a sheet the server lacks, or a failed read, is asked again only later', async () => {
    let now = 0;
    const cache = new TrickplayCache(() => now);
    let fail = true;
    const { reads, read } = reader(() => { if (fail) throw new Error('offline'); return null; });
    cache.frame('s1', 1, offer, 0, read);
    await settle();
    cache.frame('s1', 1, offer, 0, read);
    expect(reads.length).toBe(1);
    now += 15_000;
    fail = false;
    cache.frame('s1', 1, offer, 0, read);
    await settle();
    expect(reads.length).toBe(2);
    expect(cache.frame('s1', 1, offer, 0, read)).toBeNull();
    expect(reads.length).toBe(2);
  });

  test('another session or source generation never sees the old sheets, nor a late answer for them', async () => {
    const cache = new TrickplayCache();
    let release!: (value: TrickplaySheet) => void;
    const slow: SheetRead = () => new Promise(resolve => { release = resolve; });
    cache.frame('s1', 1, offer, 0, slow);
    const { reads, read } = reader(() => ({ bytes: jpeg(2), mimeType: 'image/jpeg' }));
    expect(cache.frame('s1', 2, offer, 0, read)).toBeNull();
    release({ bytes: jpeg(1), mimeType: 'image/jpeg' });
    await settle();
    expect(cache.frame('s1', 2, offer, 0, read)?.uri).toBe(sheetURI(jpeg(2), 'image/jpeg')!);
    expect(cache.frame('s2', 2, offer, 0, read)).toBeNull();
    expect(reads.length).toBe(2);
  });

  test('holds a few sheets, letting the least recently used go', async () => {
    const cache = new TrickplayCache();
    const long = { ...offer, count: 1000, coverageUntilMs: 10_000_000 };
    const { reads, read } = reader(index => ({ bytes: jpeg(index), mimeType: 'image/jpeg' }));
    for (const sheet of [0, 1, 2, 3, 4]) { cache.frame('s1', 1, long, sheet * 1000, read); await settle(); }
    expect(reads.map(r => r.index)).toEqual([0, 1, 2, 3, 4]);
    cache.frame('s1', 1, long, 4000, read);
    cache.frame('s1', 1, long, 0, read);
    await settle();
    expect(reads.map(r => r.index)).toEqual([0, 1, 2, 3, 4, 0]);
  });
});

describe('adapters', () => {
  const BASE = 'https://media.example/jf';
  const client: V.ClientCapabilities = { device, protocolVersions: [0], containers: ['mp4'], videoCodecs: ['h264'], audioCodecs: ['aac'], subtitleFormats: ['vtt'], hls: true, mse: false };
  const manifest = { source: { 320: { Width: 320, Height: 136, TileWidth: 10, TileHeight: 10, ThumbnailCount: 60, Interval: 10000 } } };
  const jellyfinRoutes = (trickplay?: unknown) => ({
    'GET /jf/Users/viewer-1/Items/10': { Id: '10', Type: 'Movie', Name: 'Movie', RunTimeTicks: 6_000_000_000, ...(trickplay ? { Trickplay: trickplay } : {}) },
    'POST /jf/Items/10/PlaybackInfo': { PlaySessionId: 'jf-session', MediaSources: [{ Id: 'source', Container: 'mp4', SupportsDirectPlay: true, MediaStreams: [] }] },
  });

  test('Jellyfin offers the item\'s thumbnails on the plan and reads sheets with its own authorization', async () => {
    const seen = routeFetch({ ...jellyfinRoutes(manifest), 'GET /jf/Videos/10/Trickplay/320/0.jpg': () => new Response(jpeg(), { headers: { 'content-type': 'image/jpeg', etag: '"t0"' } }) });
    const adapter = new JellyfinAdapter(BASE, new FakeCredentials());
    const plan = await adapter.startPlayback({ titleId: '10', client, idempotencyKey: 'start' });
    expect(plan.trickplay).toEqual({ width: 320, height: 136, intervalMs: 10000, count: 60, cols: 10, rows: 10, coverageUntilMs: 600_000, revision: 0 });
    const sheet = await adapter.trickplaySheet(plan.sessionId, plan.trickplay!, 0);
    expect(sheet).toEqual({ bytes: jpeg(), mimeType: 'image/jpeg', etag: '"t0"' });
    const request = seen.at(-1)!;
    expect(request.url.searchParams.get('MediaSourceId')).toBe('source');
    expect(request.headers.get('Authorization')).toContain('Token="token-1"');
    expect(request.url.search).not.toContain('api_key');
    expect(await adapter.trickplaySheet(plan.sessionId, plan.trickplay!, 1)).toBeNull();
  });

  test('Jellyfin reads an offer that appears once the session streams', async () => {
    let streaming = false;
    routeFetch({ ...jellyfinRoutes(), 'GET /jf/Users/viewer-1/Items/10': () => ({ Id: '10', Type: 'Movie', Name: 'Movie', RunTimeTicks: 6_000_000_000, ...(streaming ? { Trickplay: { 320: { 'item-guid': manifest.source[320] } } } : {}) }) });
    const adapter = new JellyfinAdapter(BASE, new FakeCredentials());
    const plan = await adapter.startPlayback({ titleId: '10', client, idempotencyKey: 'start' });
    expect(plan.trickplay).toBeUndefined();
    expect(await adapter.trickplayOffer(plan.sessionId)).toBeNull();
    streaming = true;
    expect(await adapter.trickplayOffer(plan.sessionId)).toMatchObject({ width: 320, count: 60 });
  });

  test('Ether reads a session\'s sheet with bearer and device, revalidating by ETag', async () => {
    let calls = 0;
    const seen = routeFetch({ 'GET /vela/v0/sessions/s%201/trickplay/320/2.jpg': (request: { headers: Headers }) => {
      calls++;
      return request.headers.get('If-None-Match') === '"e2"' ? new Response(null, { status: 304 }) : new Response(jpeg(), { headers: { 'content-type': 'image/jpeg', etag: '"e2"' } });
    } });
    const ether = new EtherAdapter('https://ether.example', new FakeCredentials(), 'web-1');
    expect(await ether.trickplaySheet('s 1', offer, 2)).toEqual({ bytes: jpeg(), mimeType: 'image/jpeg', etag: '"e2"' });
    expect(await ether.trickplaySheet('s 1', offer, 2, '"e2"')).toBe('unchanged');
    expect(seen[0]!.url.pathname).toBe('/vela/v0/sessions/s%201/trickplay/320/2.jpg');
    expect(seen[0]!.headers.get('Authorization')).toBe('Bearer token-1');
    expect(seen[0]!.headers.get('X-Vela-Device-Id')).toBe(device.id);
    expect(await ether.trickplaySheet('s 1', offer, 3)).toBeNull();
    expect(await ether.trickplaySheet('s 1', offer, -1)).toBeNull();
    expect(calls).toBe(2);
  });
});

describe('Playback.trickplayFrame', () => {
  function harness(plan: V.PlaybackPlan, adapter: object) {
    const session = { epoch: 0, onReset() {}, ready: async () => ({ adapter, plan: (p: V.PlaybackPlan) => p }) };
    const box = new StateBox({ playback: { ...initialPlayback, plan, sessionId: plan.sessionId, phase: 'playing' }, auth: { phase: 'signed-in' } } as VelaState);
    return new Playback(box, session as unknown as Session, () => {}, () => {});
  }
  const plan = (extra: Partial<V.PlaybackPlan> = {}) => ({ sessionId: 's1', sourceGeneration: 1, seekGeneration: 1, ...extra } as V.PlaybackPlan);

  test('draws the plan\'s offer once its sheet arrives, and says so', async () => {
    const asked: number[] = [];
    const playback = harness(plan({ trickplay: offer }), { trickplaySheet: async (_s: string, _o: unknown, index: number) => { asked.push(index); return { bytes: jpeg(), mimeType: 'image/jpeg' }; } });
    let heard = 0;
    playback.onTrickplay(() => heard++);
    expect(playback.trickplayFrame('s1', 1100)).toBeNull();
    await settle();
    expect(heard).toBe(1);
    expect(playback.trickplayFrame('s1', 1100)).toMatchObject({ sheet: 1, column: 0, row: 1 });
    expect(playback.trickplayFrame('other', 1100)).toBeNull();
    expect(asked).toEqual([1]);
  });

  test('live plans and servers without sheets show none; a late offer is read now and then', async () => {
    expect(harness(plan({ trickplay: offer, channelId: 'c' }), { trickplaySheet: async () => null }).trickplayFrame('s1', 0)).toBeNull();
    let offers = 0;
    const late = harness(plan(), {
      trickplayOffer: async () => { offers++; return offer; },
      trickplaySheet: async () => ({ bytes: jpeg(), mimeType: 'image/jpeg' }),
    });
    let heard = 0;
    late.onTrickplay(() => heard++);
    expect(late.trickplayFrame('s1', 0)).toBeNull();
    await settle();
    expect(offers).toBe(1);
    expect(heard).toBe(1);
    expect(late.trickplayFrame('s1', 0)).toBeNull();
    await settle();
    expect(late.trickplayFrame('s1', 0)).toMatchObject({ sheet: 0, column: 0, row: 0 });
    expect(offers).toBe(1);
    const none = harness(plan(), { startPlayback: async () => null });
    expect(none.trickplayFrame('s1', 0)).toBeNull();
  });
});

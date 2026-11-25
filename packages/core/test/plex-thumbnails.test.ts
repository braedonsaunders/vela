// Plex scrub thumbnails: a part's BIF media index read as single-image trickplay sheets.
import { afterEach, describe, expect, test } from 'bun:test';
import { bifCoverage, bifFrameAt, bifFrames, bifHeader, bifInterval, bifOffer, bifTableRange, jpegSize, type BifFrame } from '../src/adapter/plex/bif';
import { PlexAdapter } from '../src/adapter/plex';
import { TrickplayCache } from '../src/store/trickplay';
import { FakeCredentials, restoreFetch, routeFetch, type Seen } from './helpers';

afterEach(restoreFetch);

/** A baseline JPEG's first bytes: SOI, an APP0 segment, then a frame header of `width` by `height`. */
function jpeg(width: number, height: number, tag = 0): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, tag, 0xff, 0xc0, 0x00, 0x0b, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x01, 0x01, 0x11, 0x00, 0xff, 0xd9]);
}

/** A BIF of `images` at their times (in units of `multiplier` milliseconds; 0 writes the default). */
function bif(images: { at: number; bytes: Uint8Array }[], multiplier = 1000): Uint8Array {
  const tableEnd = 64 + (images.length + 1) * 8;
  const size = tableEnd + images.reduce((n, i) => n + i.bytes.length, 0);
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  out.set([0x89, 0x42, 0x49, 0x46, 0x0d, 0x0a, 0x1a, 0x0a]);
  view.setUint32(12, images.length, true);
  view.setUint32(16, multiplier, true);
  let offset = tableEnd;
  images.forEach((image, i) => {
    view.setUint32(64 + i * 8, image.at, true);
    view.setUint32(64 + i * 8 + 4, offset, true);
    out.set(image.bytes, offset);
    offset += image.bytes.length;
  });
  view.setUint32(64 + images.length * 8, 0xffffffff, true);
  view.setUint32(64 + images.length * 8 + 4, offset, true);
  return out;
}

const frames = (...times: number[]): BifFrame[] => times.map((atMs, i) => ({ atMs, start: 100 + i * 10, end: 110 + i * 10 }));

describe('BIF index', () => {
  test('reads the header, the table and each image\'s byte range', () => {
    const file = bif([{ at: 0, bytes: jpeg(320, 180, 1) }, { at: 10, bytes: jpeg(320, 180, 2) }, { at: 20, bytes: jpeg(320, 180, 3) }]);
    const header = bifHeader(file)!;
    expect(header).toEqual({ count: 3, multiplierMs: 1000 });
    const range = bifTableRange(header);
    expect(range).toEqual({ start: 64, end: 96 });
    const list = bifFrames(header, file.subarray(range.start, range.end))!;
    expect(list.map(f => f.atMs)).toEqual([0, 10_000, 20_000]);
    expect(file.subarray(list[1]!.start, list[1]!.end)).toEqual(jpeg(320, 180, 2));
    expect(jpegSize(file.subarray(list[0]!.start, list[0]!.end))).toEqual({ width: 320, height: 180 });
  });

  test('a zero multiplier means seconds; other multipliers scale the times', () => {
    const images = [{ at: 0, bytes: jpeg(2, 2) }, { at: 4, bytes: jpeg(2, 2) }];
    expect(bifHeader(bif(images, 0))!.multiplierMs).toBe(1000);
    const header = bifHeader(bif(images, 500))!;
    expect(bifFrames(header, bif(images, 500).subarray(64))!.map(f => f.atMs)).toEqual([0, 2000]);
  });

  test('refuses what is not a BIF, and a table cut short', () => {
    expect(bifHeader(new Uint8Array(64))).toBeNull();
    expect(bifHeader(bif([{ at: 0, bytes: jpeg(2, 2) }]).subarray(0, 40))).toBeNull();
    const file = bif([{ at: 0, bytes: jpeg(2, 2) }, { at: 10, bytes: jpeg(2, 2) }]);
    expect(bifFrames(bifHeader(file)!, file.subarray(64, 70))).toBeNull();
  });

  test('the interval is the commonest gap; a single frame is ten seconds apart', () => {
    expect(bifInterval(frames(0, 2000, 4000, 6000, 10_000))).toBe(2000);
    expect(bifInterval(frames(5000))).toBe(10_000);
  });

  test('a slot shows the latest frame up to its end, never one more than a slot older', () => {
    const sparse = frames(0, 10_000, 20_000, 60_000);
    expect(bifFrameAt(sparse, 10_000, 0)?.atMs).toBe(0);
    expect(bifFrameAt(sparse, 10_000, 2)?.atMs).toBe(20_000);
    expect(bifFrameAt(sparse, 10_000, 3)?.atMs).toBe(20_000);
    // Slot 5 (50 s) is more than a slot past the frame at 20 s: a gap in the index.
    expect(bifFrameAt(sparse, 10_000, 5)).toBeNull();
    expect(bifFrameAt(sparse, 10_000, 6)?.atMs).toBe(60_000);
    expect(bifFrameAt(sparse, 10_000, -1)).toBeNull();
    // Frames a little after each slot's start still belong to their slot.
    expect(bifFrameAt(frames(500, 10_500), 10_000, 1)?.atMs).toBe(10_500);
  });

  test('coverage runs from zero while frames are no more than a slot apart', () => {
    expect(bifCoverage(frames(0, 10_000, 20_000, 60_000), 10_000)).toBe(30_000);
    expect(bifCoverage(frames(30_000, 40_000), 10_000)).toBe(0);
    expect(bifCoverage([], 10_000)).toBe(0);
  });

  test('the offer is one image per sheet over the title\'s duration', () => {
    expect(bifOffer(frames(0, 10_000, 20_000), { width: 320, height: 180 }, 95_000, 2)).toEqual({
      width: 320, height: 180, intervalMs: 10_000, count: 10, cols: 1, rows: 1, coverageUntilMs: 30_000, revision: 2,
    });
    // Without a duration the index's own extent stands.
    expect(bifOffer(frames(0, 10_000), { width: 320, height: 180 }, undefined, 1)?.count).toBe(2);
    expect(bifOffer([], { width: 320, height: 180 }, 1000, 1)).toBeNull();
  });

  test('JPEG size skips segments to the frame header and refuses what is not a JPEG', () => {
    expect(jpegSize(jpeg(240, 136))).toEqual({ width: 240, height: 136 });
    expect(jpegSize(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(jpegSize(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]))).toBeNull();
  });
});

describe('Plex trickplay', () => {
  const ORIGIN = 'https://plex.example:32400';
  const client = { device: { id: 'd', name: 'd', platform: 'web', appVersion: '1' }, containers: ['mp4'], videoCodecs: ['h264'], audioCodecs: ['aac'], subtitleFormats: [], hls: true, mse: true } as never;
  const movie = { ratingKey: '5', type: 'movie', title: 'Scrub', duration: 95_000, Media: [{ id: 5, container: 'mp4', videoCodec: 'h264', audioCodec: 'aac', width: 1920, height: 800,
    Part: [{ id: 55, key: '/library/parts/55/file.mp4', duration: 95_000 }] }] };
  const file = bif([{ at: 0, bytes: jpeg(320, 134, 1) }, { at: 10, bytes: jpeg(320, 134, 2) }, { at: 20, bytes: jpeg(320, 134, 3) }]);

  /** The index route answering byte ranges (206), or ignoring them (200), as `ranges` says. */
  function serve(index: () => Uint8Array | null, ranges = true) {
    const seen = routeFetch({
      'GET /library/metadata/5': { MediaContainer: { Metadata: [movie] } },
      'GET /library/parts/55/indexes/sd': (r: Seen) => {
        const bytes = index();
        if (!bytes) return new Response('none', { status: 404 });
        const range = /bytes=(\d+)-(\d+)/.exec(r.headers.get('range') ?? '');
        if (!ranges || !range) return new Response(new Blob([bytes.slice()]), { headers: { 'content-length': String(bytes.length) } });
        return new Response(new Blob([bytes.slice(Number(range[1]), Number(range[2]) + 1)]), { status: 206 });
      },
    });
    return seen;
  }
  async function playing() {
    const adapter = new PlexAdapter({ origin: ORIGIN, credentials: new FakeCredentials(), clientIdentifier: 'c' });
    const plan = await adapter.startPlayback({ titleId: '5', client, idempotencyKey: 'k' } as never);
    return { adapter, plan };
  }

  test('reads the header, table and first image by range, and offers one image per slot', async () => {
    const seen = serve(() => file);
    const { adapter, plan } = await playing();
    expect(plan.trickplay).toBeUndefined();
    const offer = await adapter.trickplayOffer(plan.sessionId);
    expect(offer).toEqual({ width: 320, height: 134, intervalMs: 10_000, count: 10, cols: 1, rows: 1, coverageUntilMs: 30_000, revision: 1 });
    const reads = seen.filter(r => r.url.pathname.endsWith('/indexes/sd'));
    expect(reads.map(r => r.headers.get('range'))).toEqual(['bytes=0-63', 'bytes=64-95', `bytes=96-${96 + jpeg(1, 1).length - 1}`]);
    expect(reads[0]!.headers.get('x-plex-token')).toBe('token-1');
    const sheet = await adapter.trickplaySheet(plan.sessionId, offer!, 1);
    expect(sheet).toEqual({ bytes: jpeg(320, 134, 2), mimeType: 'image/jpeg', etag: '"bif-10000"' });
    // The slot's image is unchanged until the index has a nearer one.
    expect(await adapter.trickplaySheet(plan.sessionId, offer!, 1, '"bif-10000"')).toBe('unchanged');
    // Past coverage the slot has no frame.
    expect(await adapter.trickplaySheet(plan.sessionId, offer!, 7)).toBeNull();
  });

  test('a grown index is a new revision; the same table keeps its revision', async () => {
    let current = bif([{ at: 0, bytes: jpeg(320, 134) }, { at: 10, bytes: jpeg(320, 134) }]);
    serve(() => current);
    const { adapter, plan } = await playing();
    expect((await adapter.trickplayOffer(plan.sessionId))?.revision).toBe(1);
    expect((await adapter.trickplayOffer(plan.sessionId))?.revision).toBe(1);
    current = file;
    expect(await adapter.trickplayOffer(plan.sessionId)).toMatchObject({ revision: 2, coverageUntilMs: 30_000 });
  });

  test('a server without ranges sends the file once; it is read whole and not again', async () => {
    const seen = serve(() => file, false);
    const { adapter, plan } = await playing();
    const offer = (await adapter.trickplayOffer(plan.sessionId))!;
    expect(offer.width).toBe(320);
    expect(await adapter.trickplayOffer(plan.sessionId)).toEqual(offer);
    expect((await adapter.trickplaySheet(plan.sessionId, offer, 2)) as unknown).toMatchObject({ bytes: jpeg(320, 134, 3) });
    expect(seen.filter(r => r.url.pathname.endsWith('/indexes/sd')).length).toBe(1);
  });

  test('no index, or bytes that are not one, is no offer; an unmeasurable image takes the video\'s shape', async () => {
    serve(() => null);
    let { adapter, plan } = await playing();
    expect(await adapter.trickplayOffer(plan.sessionId)).toBeNull();
    serve(() => new Uint8Array(200));
    ({ adapter, plan } = await playing());
    expect(await adapter.trickplayOffer(plan.sessionId)).toBeNull();
    serve(() => bif([{ at: 0, bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]) }, { at: 10, bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]) }]));
    ({ adapter, plan } = await playing());
    expect(await adapter.trickplayOffer(plan.sessionId)).toMatchObject({ width: 320, height: 133 });
  });

  test('a rewritten index (bytes no longer an image) gives no frame rather than a wrong one', async () => {
    let current = file;
    serve(() => current);
    const { adapter, plan } = await playing();
    const offer = (await adapter.trickplayOffer(plan.sessionId))!;
    current = new Uint8Array(file.length);
    expect(await adapter.trickplaySheet(plan.sessionId, offer, 0)).toBeNull();
  });
});

test('the sheet cache keeps about as many single-image sheets as a few full sheets hold thumbnails', async () => {
  const cache = new TrickplayCache();
  const single = { width: 320, height: 180, intervalMs: 1000, count: 1000, cols: 1, rows: 1, coverageUntilMs: 1_000_000, revision: 1 };
  const reads: number[] = [];
  const read = async (index: number) => { reads.push(index); return { bytes: jpeg(2, 2), mimeType: 'image/jpeg' }; };
  for (let i = 0; i < 150; i++) cache.frame('s', 0, single, i, read);
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(reads.length).toBe(150);
  // The most recent 120 are held: going back over them reads nothing more.
  for (let i = 30; i < 150; i++) expect(cache.frame('s', 0, single, i, read)).not.toBeNull();
  expect(reads.length).toBe(150);
  expect(cache.frame('s', 0, single, 0, read)).toBeNull();
});

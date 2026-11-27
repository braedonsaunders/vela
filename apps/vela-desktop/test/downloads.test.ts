import { afterAll, beforeAll, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, realpathSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
const { Downloads, dispatch, parseRequest, exportName, imageExtension } = require('../downloads.js');

const parent = realpathSync(mkdtempSync(join(tmpdir(), 'vela-downloads-')));
afterAll(() => rmSync(parent, { recursive: true, force: true }));
const TOKEN = 'secret-token-never-on-disk';
const FILE = Buffer.alloc(300_000);
for (let i = 0; i < FILE.length; i++) FILE[i] = (i * 31) % 251;
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);

type Seen = { path: string; headers: IncomingMessage['headers'] };
let media: Server, other: Server, mediaBase = '', otherBase = '';
const seen: Seen[] = [];
const otherSeen: Seen[] = [];
/** Per-test behaviour of the media server. */
const behaviour = { cutAt: 0, cuts: 0, status: 0, etag: '"v1"', hold: false };
let release: (() => void) | undefined;

function serveMedia(req: IncomingMessage, res: ServerResponse) {
  seen.push({ path: req.url!, headers: req.headers });
  const path = req.url!.split('?')[0];
  if (path === '/redirect-same') { res.writeHead(302, { location: '/file' }).end(); return; }
  if (path === '/redirect-away') { res.writeHead(302, { location: `${otherBase}/file` }).end(); return; }
  if (path === '/poster.jpg') { res.writeHead(200, { 'content-type': 'image/jpeg' }).end(JPEG); return; }
  if (path === '/en.srt') { res.writeHead(200, { 'content-type': 'application/x-subrip' }).end('1\n00:00:01,000 --> 00:00:02,000\nHello\n'); return; }
  if (path === '/svg') { res.writeHead(200, { 'content-type': 'image/svg+xml' }).end('<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>'); return; }
  if (path !== '/file') { res.writeHead(404).end(); return; }
  if (behaviour.status) { res.writeHead(behaviour.status).end(); return; }
  let start = 0;
  const range = /^bytes=(\d+)-$/.exec(String(req.headers.range ?? ''));
  const ifRange = req.headers['if-range'];
  if (range && (!ifRange || ifRange === behaviour.etag)) start = Number(range[1]);
  const body = FILE.subarray(start);
  const headers: Record<string, string> = { 'content-type': 'video/x-matroska', etag: behaviour.etag, 'last-modified': 'Wed, 01 Jan 2025 00:00:00 GMT', 'content-length': String(body.length), 'accept-ranges': 'bytes' };
  if (start) headers['content-range'] = `bytes ${start}-${FILE.length - 1}/${FILE.length}`;
  res.writeHead(start ? 206 : 200, headers);
  if (behaviour.hold) {
    // Send a little, then wait for the test (a pause or quit while the transfer is live).
    res.write(body.subarray(0, 1000));
    release = () => res.destroy();
    return;
  }
  if (behaviour.cutAt && behaviour.cuts > 0) {
    behaviour.cuts--;
    res.write(body.subarray(0, behaviour.cutAt), () => setTimeout(() => res.destroy(), 20));
    return;
  }
  res.end(body);
}

beforeAll(async () => {
  media = createServer(serveMedia);
  other = createServer((req, res) => { otherSeen.push({ path: req.url!, headers: req.headers }); res.writeHead(200, { 'content-type': 'image/jpeg' }).end(JPEG); });
  await new Promise<void>(resolve => media.listen(0, '127.0.0.1', resolve));
  await new Promise<void>(resolve => other.listen(0, '127.0.0.1', resolve));
  mediaBase = `http://127.0.0.1:${(media.address() as { port: number }).port}`;
  // Another exact origin: same host, different port.
  otherBase = `http://127.0.0.1:${(other.address() as { port: number }).port}`;
});
afterAll(() => { media.closeAllConnections(); media.close(); other.closeAllConnections(); other.close(); });

let counter = 0;
function engine(options: Record<string, unknown> = {}) {
  const root = join(parent, `root-${++counter}`);
  const events: any[] = [];
  const waiters: { match: (event: any) => boolean; resolve: (event: any) => void }[] = [];
  const downloads = new Downloads({
    root, delay: () => 10,
    emit: (event: any) => {
      events.push(event);
      for (const waiter of [...waiters]) if (waiter.match(event)) { waiters.splice(waiters.indexOf(waiter), 1); waiter.resolve(event); }
    },
    ...options,
  });
  const next = (match: (event: any) => boolean) => {
    const found = events.find(match);
    return found ? Promise.resolve(found) : new Promise<any>(resolve => waiters.push({ match, resolve }));
  };
  return { root, events, downloads, next, settled: (status: string) => next(event => event.status === status) };
}
const request = (fields: Record<string, unknown> = {}) => ({
  serverId: 'srv', viewerId: 'viewer', titleId: 't1', url: `${mediaBase}/file`, headers: { 'X-Plex-Token': TOKEN },
  container: 'mkv', mimeType: 'video/x-matroska', wifiOnly: true, sidecars: [], ...fields,
});
const reset = () => { Object.assign(behaviour, { cutAt: 0, cuts: 0, status: 0, etag: '"v1"', hold: false }); seen.length = 0; otherSeen.length = 0; };
function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile()).map(entry => join(entry.parentPath, entry.name));
}

test('downloads the original, its poster and sidecars; headers go only to the media origin and never to disk', async () => {
  reset();
  const { root, downloads, settled, events } = engine();
  await downloads.startTransfer(request({
    posterUrl: `${otherBase}/poster.jpg`,
    sidecars: [{ trackId: 'en', format: 'srt', url: `${mediaBase}/en.srt` }, { trackId: '../x', format: 'srt', url: `${mediaBase}/en.srt` }],
  }));
  const done = await settled('completed');
  const dir = join(root, 'srv', 'viewer', 't1');
  expect(done).toMatchObject({
    serverId: 'srv', viewerId: 'viewer', titleId: 't1', bytesWritten: FILE.length, byteLength: FILE.length, etag: '"v1"',
    mediaPath: 'srv/viewer/t1/media.mkv', posterPath: 'srv/viewer/t1/poster.jpg', sidecarPaths: { en: 'srv/viewer/t1/subtitles/en.srt' },
    lastModified: 'Wed, 01 Jan 2025 00:00:00 GMT',
  });
  expect(readFileSync(join(dir, 'media.mkv')).equals(FILE)).toBe(true);
  expect(readFileSync(join(dir, 'poster.jpg')).equals(JPEG)).toBe(true);
  expect(readFileSync(join(dir, 'subtitles', 'en.srt'), 'utf8')).toContain('Hello');
  expect(existsSync(join(dir, 'media.mkv.part'))).toBe(false);
  expect(existsSync(join(dir, 'transfer.json'))).toBe(false);
  // The media origin saw the token; the poster's other origin never did.
  expect(seen.find(s => s.path === '/file')!.headers['x-plex-token']).toBe(TOKEN);
  expect(seen.find(s => s.path === '/file')!.headers['accept-encoding']).toBe('identity');
  expect(otherSeen).toHaveLength(1);
  expect(otherSeen[0]!.headers['x-plex-token']).toBeUndefined();
  for (const file of filesUnder(root)) expect(readFileSync(file, 'utf8')).not.toContain(TOKEN);
  for (const file of filesUnder(root)) expect(readFileSync(file, 'utf8')).not.toContain(mediaBase);
  expect(JSON.stringify(events)).not.toContain(TOKEN);
  expect(JSON.stringify(events)).not.toContain('127.0.0.1');
  expect(events[0]).toMatchObject({ status: 'downloading', bytesWritten: 0 });
});

test('same-origin redirects keep the headers; another origin fails the transfer and never sees them', async () => {
  reset();
  const same = engine();
  await same.downloads.startTransfer(request({ url: `${mediaBase}/redirect-same` }));
  expect((await same.settled('completed')).bytesWritten).toBe(FILE.length);
  expect(seen.filter(s => s.path === '/file')[0]!.headers['x-plex-token']).toBe(TOKEN);

  reset();
  const away = engine();
  await away.downloads.startTransfer(request({ url: `${mediaBase}/redirect-away` }));
  const failed = await away.settled('failed');
  expect(failed.errorCode).toBe('unknown');
  expect(failed.error).not.toContain('127.0.0.1');
  expect(otherSeen).toHaveLength(0);
});

test('maps refusals to the iOS codes', async () => {
  for (const [status, code] of [[401, 'forbidden'], [403, 'forbidden'], [429, 'rate_limited'], [404, 'network']] as const) {
    reset();
    behaviour.status = status;
    const { downloads, settled } = engine();
    await downloads.startTransfer(request());
    expect((await settled('failed')).errorCode).toBe(code);
  }
});

test('a dropped connection backs off, reports interrupted, and resumes with Range and If-Range', async () => {
  reset();
  Object.assign(behaviour, { cutAt: 100_000, cuts: 1 });
  const { root, downloads, settled, events } = engine();
  await downloads.startTransfer(request());
  const done = await settled('completed');
  expect(done.bytesWritten).toBe(FILE.length);
  expect(readFileSync(join(root, 'srv/viewer/t1/media.mkv')).equals(FILE)).toBe(true);
  expect(events.find(e => e.status === 'paused')).toMatchObject({ errorCode: 'interrupted', bytesWritten: 100_000 });
  const resumed = seen.filter(s => s.path === '/file')[1]!;
  expect(resumed.headers.range).toBe('bytes=100000-');
  expect(resumed.headers['if-range']).toBe('"v1"');
  expect(resumed.headers['x-plex-token']).toBe(TOKEN);
});

test('a link that vanished while waiting for the network leaves the transfer interrupted for a fresh grant', async () => {
  reset();
  Object.assign(behaviour, { cutAt: 40_000, cuts: 1 });
  const { downloads, next, events } = engine({ delay: () => 30 });
  await downloads.startTransfer(request());
  await next(e => e.status === 'paused');
  behaviour.status = 404;
  const final = await next(e => e.status === 'paused' && /online/.test(e.error ?? ''));
  expect(final).toMatchObject({ errorCode: 'interrupted', bytesWritten: 40_000 });
  expect(events.some(e => e.status === 'failed')).toBe(false);
});

test('a changed original restarts from the first byte instead of splicing two versions', async () => {
  reset();
  Object.assign(behaviour, { cutAt: 50_000, cuts: 1 });
  const { root, downloads, settled } = engine({ delay: () => 30 });
  await downloads.startTransfer(request());
  await settled('paused');
  behaviour.etag = '"v2"';
  const done = await settled('completed');
  expect(done.etag).toBe('"v2"');
  expect(readFileSync(join(root, 'srv/viewer/t1/media.mkv')).equals(FILE)).toBe(true);
});

test('pause keeps the partial file; resume continues it; quitting leaves it interrupted for the next launch', async () => {
  reset();
  behaviour.hold = true;
  const first = engine();
  await first.downloads.startTransfer(request());
  await first.next(e => e.status === 'downloading' && e.bytesWritten > 0 || (e.status === 'downloading' && existsSync(join(first.root, 'srv/viewer/t1/transfer.json'))));
  await Bun.sleep(100);
  await first.downloads.pauseTransfer('srv', 'viewer', 't1');
  release?.();
  const paused = await first.settled('paused');
  expect(paused.errorCode).toBeUndefined();
  expect(paused.bytesWritten).toBe(1000);

  behaviour.hold = false;
  await first.downloads.resumeTransfer(request());
  await first.settled('completed');
  expect(seen.filter(s => s.path === '/file').at(-1)!.headers.range).toBe('bytes=1000-');
  expect(readFileSync(join(first.root, 'srv/viewer/t1/media.mkv')).equals(FILE)).toBe(true);

  // A transfer live when the app quits: the next launch (a new engine) reports it interrupted.
  reset();
  behaviour.hold = true;
  const quit = engine();
  await quit.downloads.startTransfer(request({ titleId: 't2' }));
  await Bun.sleep(150);
  await quit.downloads.writeSnapshot({ items: [{ serverId: 'srv', viewerId: 'viewer', titleId: 't2', status: 'downloading', bytesWritten: 0, container: 'mkv' }], outbox: [{ id: 'o1' }] });
  await quit.downloads.shutdown();
  release?.();
  expect(quit.events.some(e => e.status === 'paused' || e.status === 'failed')).toBe(false);
  const relaunched = new Downloads({ root: quit.root });
  const snapshot = await relaunched.readSnapshot();
  expect(snapshot.outbox).toEqual([{ id: 'o1' }]);
  expect(snapshot.items[0]).toMatchObject({ status: 'paused', errorCode: 'interrupted', bytesWritten: 1000 });
  for (const file of filesUnder(quit.root)) expect(readFileSync(file, 'utf8')).not.toContain(TOKEN);
});

test('a settled event the page missed is kept beside the files and merged into the snapshot', async () => {
  reset();
  const { root, downloads, settled } = engine();
  await downloads.writeSnapshot({ items: [{ serverId: 'srv', viewerId: 'viewer', titleId: 't1', status: 'downloading', bytesWritten: 0, error: 'old', previousCompleted: { mediaPath: 'x' } }], outbox: [] });
  await downloads.startTransfer(request());
  await settled('completed');
  const { items } = await new Downloads({ root }).readSnapshot();
  expect(items[0]).toMatchObject({ status: 'completed', mediaPath: 'srv/viewer/t1/media.mkv', bytesWritten: FILE.length });
  expect(items[0].error).toBeUndefined();
  expect(items[0].previousCompleted).toBeUndefined();
});

test('out of space fails as no_space with the bytes still needed', async () => {
  reset();
  const transport = async () => ({
    status: 200, headers: { 'content-length': '5000', etag: '"v1"' },
    body: new Readable({ read() { this.destroy(Object.assign(new Error('no space'), { code: 'ENOSPC' })); } }),
  });
  const { downloads, settled } = engine({ transport });
  await downloads.startTransfer(request());
  const failed = await settled('failed');
  expect(failed).toMatchObject({ errorCode: 'no_space', neededBytes: 5000 });
});

test('remove, reveal and save a copy', async () => {
  reset();
  const revealed: string[] = [];
  let choice: string | null = null;
  const { root, downloads, settled } = engine({ revealFile: (file: string) => revealed.push(file), chooseSaveFile: async (name: string) => { expect(name).toBe('Film (2020).mkv'); return choice; } });
  await downloads.startTransfer(request());
  await settled('completed');
  await downloads.reveal('srv', 'viewer', 't1');
  expect(revealed).toEqual([join(root, 'srv/viewer/t1/media.mkv')]);
  expect(await downloads.exportCopy('srv', 'viewer', 't1', 'Film (2020).mkv')).toBe(false);
  const out = join(parent, 'exports');
  mkdirSync(out, { recursive: true });
  choice = join(out, 'Film (2020).mkv');
  expect(await downloads.exportCopy('srv', 'viewer', 't1', 'Film (2020).mkv')).toBe(true);
  expect(readFileSync(choice).equals(FILE)).toBe(true);
  choice = join(root, 'srv', 'copy.mkv');
  await expect(downloads.exportCopy('srv', 'viewer', 't1', 'Film (2020).mkv')).rejects.toThrow();
  await downloads.removeViewer('srv', 'viewer');
  expect(existsSync(join(root, 'srv', 'viewer'))).toBe(false);
  await expect(downloads.reveal('srv', 'viewer', 't1')).rejects.toThrow();
});

test('snapshots write atomically and read back; free space comes from the volume', async () => {
  const { root, downloads } = engine();
  await Promise.all([1, 2, 3].map(n => downloads.writeSnapshot({ items: [{ n }], outbox: [] })));
  expect(JSON.parse(readFileSync(join(root, 'index.json'), 'utf8'))).toEqual([{ n: 3 }]);
  expect(readdirSync(root).filter(name => name.endsWith('.tmp'))).toEqual([]);
  expect(statSync(join(root, 'index.json')).mode & 0o077).toBe(0);
  expect(await downloads.freeBytes()).toBeGreaterThan(0);
  await expect(downloads.writeSnapshot({ items: 'x' })).rejects.toThrow();
});

test('the bridge allows only its methods with valid IDs and requests', async () => {
  const { downloads } = engine();
  await expect(dispatch(downloads, 'constructor', [])).rejects.toThrow('Unknown downloads method');
  await expect(dispatch(downloads, 'shutdown', [])).rejects.toThrow('Unknown downloads method');
  await expect(dispatch(downloads, 'removeTitle', ['srv', '..', 't'])).rejects.toThrow();
  await expect(dispatch(downloads, 'removeServer', ['a/b'])).rejects.toThrow();
  await expect(dispatch(downloads, 'removeViewer', ['srv'])).rejects.toThrow();
  await expect(dispatch(downloads, 'startTransfer', [request({ url: 'file:///etc/passwd' })])).rejects.toThrow();
  await expect(dispatch(downloads, 'startTransfer', [request({ url: 'https://user:pw@media.example/x' })])).rejects.toThrow();
  await expect(dispatch(downloads, 'startTransfer', [request({ titleId: 'C:' })])).rejects.toThrow();
  expect(await dispatch(downloads, 'readSnapshot', [])).toEqual({ items: [], outbox: [] });
  const parsed = parseRequest(request({ container: '../MK V', headers: { Range: 'bytes=0-', 'X-Ok': 'yes', 'X-Bad': 'a\r\nb' } }));
  expect(parsed.container).toBe('mkv');
  expect(parsed.headers).toEqual({ 'X-Ok': 'yes' });
  expect(exportName('a/b:c\u0000.mkv', 'mkv')).toBe('a b c .mkv');
  expect(exportName('', 'mp4')).toBe('Video.mp4');
  expect(imageExtension(JPEG)).toBe('jpg');
  expect(imageExtension(Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe('svg');
  expect(imageExtension(Buffer.from('<html><svg></svg></html>'))).toBeNull();
});

test('an SVG poster is kept as SVG (served sandboxed); anything that is not an image is dropped', async () => {
  reset();
  const svg = engine();
  await svg.downloads.startTransfer(request({ posterUrl: `${mediaBase}/svg` }));
  expect((await svg.settled('completed')).posterPath).toBe('srv/viewer/t1/poster.svg');
  reset();
  const text = engine();
  await text.downloads.startTransfer(request({ posterUrl: `${mediaBase}/en.srt` }));
  expect((await text.settled('completed')).posterPath).toBeUndefined();
  expect(readdirSync(join(text.root, 'srv/viewer/t1')).some(name => name.startsWith('poster'))).toBe(false);
});

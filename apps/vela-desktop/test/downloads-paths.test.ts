import { afterAll, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const {
  routeSegments, localDownloadPath, localizePlayback, localFileOf, parseRange, downloadsRoute, downloadRouteOf,
} = require('../downloads-paths.js');
const { bundleServer } = require('../bundle-server.js');

const parent = realpathSync(mkdtempSync(join(tmpdir(), 'vela-downloads-paths-')));
const root = join(parent, 'vela-downloads');
afterAll(() => rmSync(parent, { recursive: true, force: true }));
const title = join(root, 'srv', 'viewer', 'title 1');
mkdirSync(join(title, 'subtitles'), { recursive: true });
const media = Buffer.alloc(1000, 7);
media.write('MKV!', 0);
writeFileSync(join(title, 'media.mkv'), media);
writeFileSync(join(title, 'media.mp4.part'), 'partial');
writeFileSync(join(title, 'subtitles', 'en.vtt'), 'WEBVTT\n');
writeFileSync(join(title, 'poster.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0x00]));
writeFileSync(join(root, 'index.json'), '[]');
writeFileSync(join(parent, 'secret.txt'), 'outside the downloads root');
// A symlink that escapes the root, and one that stays inside it.
symlinkSync(join(parent, 'secret.txt'), join(title, 'escape.mkv'));
symlinkSync(join(title, 'media.mkv'), join(title, 'alias.mkv'));
mkdirSync(join(root, 'srv', 'viewer', 'linked'), { recursive: true });
symlinkSync(parent, join(root, 'srv', 'viewer', 'linked', 'dir'));

const url = (rel: string) => `vela-app://app/vela-downloads/${rel}`;

test('route segments refuse dot, empty, backslash, NUL, drive letters and encoded separators before decoding', () => {
  expect(routeSegments('srv/viewer/title%201/media.mkv')).toEqual(['srv', 'viewer', 'title 1', 'media.mkv']);
  for (const bad of ['srv/../x', 'srv/./x', 'srv//x', 'srv\\x', 'srv%2fx', 'srv%2Fx', 'srv%5cx', 'srv%00x', 'srv/%2e%2e/x',
    'srv/%2E/x', 'C:/x', 'srv/c:/x', 'srv/a%0ab', '', 'srv/%zz']) {
    expect(routeSegments(bad)).toBeNull();
  }
});

test('download URLs map to files inside the resolved root only', () => {
  expect(localDownloadPath(root, url('srv/viewer/title%201/media.mkv'))).toBe(join(title, 'media.mkv'));
  expect(localDownloadPath(root, url('srv/viewer/title%201/alias.mkv'))).toBe(join(title, 'media.mkv'));
  for (const bad of [
    url('srv/viewer/title%201/escape.mkv'),            // symlink out of the root
    url('srv/viewer/linked/dir/secret.txt'),            // directory symlink out of the root
    url('srv/viewer/title%201/../../../../secret.txt'), // dot segments
    url('srv/viewer/title%201/%2e%2e/media.mkv'),
    url('srv/viewer/title%201/media.mp4.part'),         // in-progress files are not served
    url('index.json'), url('srv/viewer/title%201'),     // the index and directories are not files
    url('srv/viewer/title%201/missing.mkv'),
    url('srv/viewer/title%201/media.mkv?x=1'), url('srv/viewer/title%201/media.mkv#t'),
    'vela-app://other/vela-downloads/srv/viewer/title%201/media.mkv',
    'vela-app://app/vela/srv/viewer/title%201/media.mkv',
    'https://app/vela-downloads/srv/viewer/title%201/media.mkv',
    pathToFileURL(join(title, 'media.mkv')).href,
  ]) expect(localDownloadPath(root, bad)).toBeNull();
  expect(downloadRouteOf('vela-app://app/vela-downloads/a/./b/c/d')).toBeNull();
});

test('ranges: single, open, suffix, clamped, unsatisfiable, and ignorable', () => {
  expect(parseRange('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 });
  expect(parseRange('bytes=900-', 1000)).toEqual({ start: 900, end: 999 });
  expect(parseRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 });
  expect(parseRange('bytes=990-5000', 1000)).toEqual({ start: 990, end: 999 });
  expect(parseRange('bytes=1000-', 1000)).toBe('unsatisfiable');
  expect(parseRange('bytes=-0', 1000)).toBe('unsatisfiable');
  expect(parseRange('bytes=5-1', 1000)).toBeNull();
  expect(parseRange('bytes=0-1,5-9', 1000)).toBeNull();
  expect(parseRange(undefined, 1000)).toBeNull();
});

test('the route serves stored files with ranges and types, and nothing else', async () => {
  const serve = bundleServer(join(parent, 'ui'), { downloads: downloadsRoute(root) });
  const get = (rel: string, headers: Record<string, string> = {}, method = 'GET') => serve(new Request(url(rel), { headers, method }));
  const whole = await get('srv/viewer/title%201/media.mkv');
  expect(whole.status).toBe(200);
  expect(whole.headers.get('content-type')).toBe('video/x-matroska');
  expect(whole.headers.get('accept-ranges')).toBe('bytes');
  expect(whole.headers.get('content-length')).toBe('1000');
  expect(Buffer.from(await whole.arrayBuffer()).equals(media)).toBe(true);

  const part = await get('srv/viewer/title%201/media.mkv', { range: 'bytes=0-3' });
  expect(part.status).toBe(206);
  expect(part.headers.get('content-range')).toBe('bytes 0-3/1000');
  expect(part.headers.get('content-length')).toBe('4');
  expect(await part.text()).toBe('MKV!');
  const tail = await get('srv/viewer/title%201/media.mkv', { range: 'bytes=-10' });
  expect(tail.headers.get('content-range')).toBe('bytes 990-999/1000');
  expect((await tail.arrayBuffer()).byteLength).toBe(10);
  const beyond = await get('srv/viewer/title%201/media.mkv', { range: 'bytes=2000-' });
  expect(beyond.status).toBe(416);
  expect(beyond.headers.get('content-range')).toBe('bytes */1000');
  const head = await get('srv/viewer/title%201/media.mkv', {}, 'HEAD');
  expect(head.status).toBe(200);
  expect(head.headers.get('content-length')).toBe('1000');

  expect((await get('srv/viewer/title%201/subtitles/en.vtt')).headers.get('content-type')).toBe('text/vtt; charset=utf-8');
  expect((await get('srv/viewer/title%201/poster.jpg')).headers.get('content-type')).toBe('image/jpeg');
  expect((await get('srv/viewer/title%201/poster.jpg')).headers.get('x-content-type-options')).toBe('nosniff');
  expect((await get('srv/viewer/title%201/poster.jpg')).headers.get('content-security-policy')).toStartWith('sandbox;');
  for (const bad of ['srv/viewer/title%201/escape.mkv', 'srv/viewer/linked/dir/secret.txt', 'srv/viewer/title%201/media.mp4.part',
    'index.json', 'srv/viewer/title%201/%2e%2e/%2e%2e/%2e%2e/%2e%2e/secret.txt', 'srv%2fviewer/title%201/media.mkv']) {
    const response = await get(bad);
    expect(response.status).toBe(404);
  }
  expect((await get('srv/viewer/title%201/media.mkv', {}, 'POST')).status).toBe(404);
});

test('native hosts get validated file URLs for downloads and never a file URL the page supplied', () => {
  const plan = {
    sessionId: 'local-1', selectedPathId: 'original',
    paths: [{ id: 'original', transport: 'file', url: url('srv/viewer/title%201/media.mkv') }],
    subtitleTracks: [
      { id: 'en', url: url('srv/viewer/title%201/subtitles/en.vtt'), delivery: { kind: 'external', url: url('srv/viewer/title%201/subtitles/en.vtt') } },
      { id: 'emb', delivery: { kind: 'embedded' } },
    ],
  };
  const mapped = localizePlayback({ active: true, plan }, root);
  expect(mapped.plan.paths[0].url).toBe(pathToFileURL(join(title, 'media.mkv')).href);
  expect(mapped.plan.subtitleTracks[0].delivery.url).toBe(pathToFileURL(join(title, 'subtitles', 'en.vtt')).href);
  expect(mapped.plan.subtitleTracks[0].url).toBe(mapped.plan.subtitleTracks[0].delivery.url);
  expect(mapped.plan.subtitleTracks[1]).toEqual({ id: 'emb', delivery: { kind: 'embedded' } });
  expect(localFileOf(root, mapped.plan.paths[0].url)).toBe(join(title, 'media.mkv'));

  // Server plans are left exactly as they were.
  const server = { plan: { selectedPathId: 'hls', paths: [{ id: 'hls', url: 'https://media.example/a.m3u8' }, { id: 'rel', url: '/sessions/x' }], subtitleTracks: [] } };
  expect(localizePlayback(server, root)).toEqual(server);
  expect(localizePlayback({ active: false }, root)).toEqual({ active: false });

  const refuse = (address: string) => expect(() => localizePlayback({ plan: { paths: [{ id: 'p', url: address }] } }, root)).toThrow();
  refuse(pathToFileURL(join(parent, 'secret.txt')).href);
  refuse(pathToFileURL(join(title, 'media.mkv')).href);
  refuse(url('srv/viewer/title%201/escape.mkv'));
  refuse(url('srv/viewer/title%201/missing.mkv'));
  refuse('data:video/mp4;base64,AAAA');
  expect(localFileOf(root, pathToFileURL(join(parent, 'secret.txt')).href)).toBeNull();
  expect(localFileOf(root, pathToFileURL(join(title, 'escape.mkv')).href)).toBeNull();
  expect(localFileOf(root, pathToFileURL(join(title, 'media.mp4.part')).href)).toBeNull();
});

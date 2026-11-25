import { expect, test } from 'bun:test';
import { pathUnplayable, refusedReason, unplayableMessage, type PageAbility } from '../web/engine/path-playability';

// Chrome: its own player takes MP4, not Matroska.
const chromePlays = (mime: string) => mime.startsWith('video/mp4');
const httpChrome: PageAbility = { secure: false, originalRoute: false, canPlay: chromePlays };
const httpsChrome: PageAbility = { secure: true, originalRoute: true, canPlay: chromePlays };
const httpsNoGpu: PageAbility = { secure: true, originalRoute: false, canPlay: chromePlays };
const mkv = { delivery: 'file' as const, mime: 'video/x-matroska', original: true };

test('an original MKV on a plain-http page is refused for the page, not the file', () => {
  expect(pathUnplayable(mkv, httpChrome)).toBe('insecure-page');
  expect(unplayableMessage('insecure-page')).toContain('https');
});

test('on https the original-file route plays it; a browser without that route cannot', () => {
  expect(pathUnplayable(mkv, httpsChrome)).toBeNull();
  expect(pathUnplayable(mkv, httpsNoGpu)).toBe('browser');
});

test('a file the browser plays itself is playable anywhere', () => {
  expect(pathUnplayable({ delivery: 'file', mime: 'video/mp4', original: true }, httpChrome)).toBeNull();
  expect(pathUnplayable({ delivery: 'file', mime: 'video/x-matroska' }, httpChrome)).toBe('browser');
});

test('HLS and paths of unknown type are judged when they play, not ahead', () => {
  expect(pathUnplayable({ delivery: 'hls', mime: 'application/vnd.apple.mpegurl' }, httpChrome)).toBeNull();
  expect(pathUnplayable({}, httpChrome)).toBeNull();
  expect(pathUnplayable({ delivery: 'file' }, httpChrome)).toBeNull();
});

test('an HLS original no player here takes is the page\'s fault over http, the browser\'s over https', () => {
  const remux = { delivery: 'hls' as const, mime: 'application/vnd.apple.mpegurl', original: true };
  expect(refusedReason(remux, httpChrome)).toBe('insecure-page');
  expect(refusedReason(remux, httpsNoGpu)).toBe('browser');
  expect(refusedReason(mkv, httpChrome)).toBe('insecure-page');
  expect(refusedReason({ delivery: 'file', mime: 'video/x-matroska' }, httpsNoGpu)).toBe('browser');
});

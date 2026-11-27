import { describe, expect, test } from 'bun:test';
import type { Extra, TitleDetail, TrailerEmbedFeature } from '../src/wire';
import { advertise } from '../src/adapter/advertise';
import { detailModel } from '../src/discovery/models';
import {
  acceptClientPlayback, acceptEmbedOriginOverride, embedFrameUrl, embedPlayerUrl, EMBED_LISTENING, extraPlayback,
  nativeEmbedHostOrigin, nativeEmbedPage, nextEmbedPhase, parseEmbedMessage, platformEmbedsTrailers,
  serverAllowsTrailerEmbed, trailerEmbedAllowed,
} from '../src/trailer-embed';

const VIDEO = 'dQw4w9WgXcQ';
const playback = (videoId = VIDEO) => ({ provider: 'youtube' as const, videoId, embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}` });
const allowed: TrailerEmbedFeature = { available: true, mode: 'clientWhenPossible' };
const youtube = (fields: Partial<Extra> = {}): Extra => ({
  id: 'extra-1', parentId: 'title-1', kind: 'trailer', name: 'Trailer', availability: 'ready', source: 'youtube', clientPlayback: playback(), ...fields,
});

describe('embed URL validation', () => {
  test('accepts only the exact nocookie embed of a valid id', () => {
    expect(acceptClientPlayback(playback())).toEqual({ provider: 'youtube', videoId: VIDEO });
    expect(acceptClientPlayback(playback('a_b-C1234567'.slice(0, 11)))).toEqual({ provider: 'youtube', videoId: 'a_b-C123456' });
  });

  test('refuses other origins, paths, ids and providers', () => {
    const refused = [
      { ...playback(), embedUrl: `https://www.youtube.com/embed/${VIDEO}` },
      { ...playback(), embedUrl: `http://www.youtube-nocookie.com/embed/${VIDEO}` },
      { ...playback(), embedUrl: `https://youtube-nocookie.com/embed/${VIDEO}` },
      { ...playback(), embedUrl: `https://www.youtube-nocookie.com.evil.example/embed/${VIDEO}` },
      { ...playback(), embedUrl: `https://www.youtube-nocookie.com/embed/${VIDEO}?autoplay=1` },
      { ...playback(), embedUrl: `https://www.youtube-nocookie.com/embed/${VIDEO}/` },
      { ...playback(), embedUrl: `https://www.youtube-nocookie.com/watch?v=${VIDEO}` },
      { ...playback(), embedUrl: `https://user@www.youtube-nocookie.com/embed/${VIDEO}` },
      { ...playback(), embedUrl: 'https://www.youtube-nocookie.com/embed/otherVideo1' },
      playback('short'),
      playback('twelve_chars'),
      playback('bad/char..x'),
      playback('%2e%2e%2fxyzab'),
      playback('<script>12'),
      { ...playback(), provider: 'vimeo' },
      { provider: 'youtube', videoId: VIDEO },
      { provider: 'youtube', embedUrl: `https://www.youtube-nocookie.com/embed/${VIDEO}` },
      null, undefined, 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', 42,
    ];
    for (const value of refused) expect(acceptClientPlayback(value)).toBeNull();
  });

  test('a mock origin override is loopback only, and a bare origin', () => {
    expect(acceptEmbedOriginOverride('http://127.0.0.1:43254')).toBe('http://127.0.0.1:43254');
    expect(acceptEmbedOriginOverride('http://localhost:7788/')).toBe('http://localhost:7788');
    expect(acceptEmbedOriginOverride('http://10.0.2.2:7788')).toBe('http://10.0.2.2:7788');
    expect(acceptEmbedOriginOverride('http://[::1]:7788')).toBe('http://[::1]:7788');
    for (const value of ['https://www.youtube.com', 'https://evil.example', 'http://192.168.68.84:32550', 'http://127.0.0.1.evil.example',
      'http://127.0.0.1:43254/embed', 'http://user@127.0.0.1:1', 'javascript:alert(1)', 'file:///etc', '', undefined, 3]) {
      expect(acceptEmbedOriginOverride(value)).toBeNull();
    }
  });

  test('the player URL autoplays, hides other channels, and reports only to the parent', () => {
    const url = new URL(embedPlayerUrl({ provider: 'youtube', videoId: VIDEO }, 'https://ether.example'));
    expect(url.origin).toBe('https://www.youtube-nocookie.com');
    expect(url.pathname).toBe(`/embed/${VIDEO}`);
    expect(Object.fromEntries(url.searchParams)).toEqual({ autoplay: '1', rel: '0', playsinline: '1', enablejsapi: '1', origin: 'https://ether.example' });
    expect(embedFrameUrl(url.href)).toBe(`https://www.youtube-nocookie.com/embed/${VIDEO}`);
    expect(new URL(embedPlayerUrl({ provider: 'youtube', videoId: VIDEO }, 'http://127.0.0.1:1', 'http://127.0.0.1:2')).origin).toBe('http://127.0.0.1:2');
    expect(() => embedPlayerUrl({ provider: 'youtube', videoId: '../x/y?z=12' }, 'https://ether.example')).toThrow();
  });
});

describe('embed or server, per platform and capability', () => {
  test('phones, tablets, browsers and desktops embed; TVs never do', () => {
    expect(platformEmbedsTrailers({ os: 'web', isTV: false })).toBe(true);
    expect(platformEmbedsTrailers({ os: 'ios', isTV: false })).toBe(true);
    expect(platformEmbedsTrailers({ os: 'android', isTV: false })).toBe(true);
    // tvOS reports os 'ios' with isTV; Android TV and Fire TV report 'android' with isTV.
    expect(platformEmbedsTrailers({ os: 'ios', isTV: true })).toBe(false);
    expect(platformEmbedsTrailers({ os: 'android', isTV: true })).toBe(false);
    expect(platformEmbedsTrailers({ os: 'web', isTV: true })).toBe(false);
    expect(platformEmbedsTrailers({ os: 'windows', isTV: false })).toBe(false);
  });

  test('the server must allow client embeds', () => {
    expect(serverAllowsTrailerEmbed(allowed)).toBe(true);
    expect(serverAllowsTrailerEmbed({ available: true, mode: 'server' })).toBe(false);
    expect(serverAllowsTrailerEmbed({ available: false, mode: 'clientWhenPossible' })).toBe(false);
    expect(serverAllowsTrailerEmbed(undefined)).toBe(false);
    expect(trailerEmbedAllowed(true, allowed)).toBe(true);
    expect(trailerEmbedAllowed(false, allowed)).toBe(false);
  });

  test('a YouTube trailer embeds where allowed, with the server extra as fallback', () => {
    expect(extraPlayback(youtube(), { embeds: true, extraPlayback: true })).toEqual({ kind: 'embed', embed: { provider: 'youtube', videoId: VIDEO }, fallback: true });
    expect(extraPlayback(youtube({ availability: 'unavailable' }), { embeds: true, extraPlayback: true })).toEqual({ kind: 'embed', embed: { provider: 'youtube', videoId: VIDEO }, fallback: false });
    // A TV, or a server in `server` mode: the server plays it, as before.
    expect(extraPlayback(youtube(), { embeds: false, extraPlayback: true })).toEqual({ kind: 'server' });
    expect(extraPlayback(youtube({ availability: 'unavailable' }), { embeds: false, extraPlayback: true })).toEqual({ kind: 'none' });
    // A refused URL falls back to the server.
    expect(extraPlayback(youtube({ clientPlayback: { ...playback(), embedUrl: 'https://evil.example/embed/x' } }), { embeds: true, extraPlayback: true })).toEqual({ kind: 'server' });
    expect(extraPlayback(youtube({ clientPlayback: undefined }), { embeds: true, extraPlayback: true })).toEqual({ kind: 'server' });
  });

  const detail = (extras: Extra[]): TitleDetail => ({
    title: { id: 'title-1', kind: 'movie', name: 'Film', summary: '', genres: [], artwork: [] }, extras, chapters: [], cast: [],
  });

  test('TVs keep the server-played trailer even when the server offers the embed', () => {
    for (const os of ['ios', 'android']) {
      const embeds = trailerEmbedAllowed(platformEmbedsTrailers({ os, isTV: true }), allowed);
      const model = detailModel(detail([youtube()]), undefined, 1280, true, false, false, embeds);
      expect(model.extras[0]).toEqual({ id: 'extra-1', name: 'Trailer', kind: 'trailer', ready: true });
      expect(model.trailerReady).toBe(true);
    }
  });

  test('the detail model carries the embed and prefers a trailer that plays here', () => {
    const server = youtube({ id: 'server-only', clientPlayback: undefined, availability: 'unavailable', source: undefined });
    const embedded = youtube({ id: 'embedded', availability: 'unavailable' });
    const model = detailModel(detail([server, embedded]), undefined, 1280, true, false, false, true);
    expect(model.trailerId).toBe('embedded');
    expect(model.trailerReady).toBe(true);
    expect(model.extras.map(extra => [extra.id, extra.ready, extra.embed])).toEqual([
      ['server-only', false, undefined],
      ['embedded', true, { provider: 'youtube', videoId: VIDEO, fallback: false }],
    ]);
    // Without the embed, the same answer is the server's: neither plays.
    const plain = detailModel(detail([server, embedded]), undefined, 1280, true);
    expect(plain.trailerReady).toBe(false);
    expect(plain.extras.every(extra => !extra.ready && !extra.embed)).toBe(true);
  });

  test('the capability passes through to the client as the server states it', () => {
    const description = { protocolVersion: 0 as const, server: { id: 's', name: 'S', version: '1' }, features: { trailerEmbed: allowed } } as never;
    expect(advertise({} as never, description).features.trailerEmbed).toEqual(allowed);
    expect(advertise({} as never, { ...(description as object), features: {} } as never).features.trailerEmbed).toBeUndefined();
  });
});

describe('YouTube embed messages', () => {
  test('reads ready, state and error events strictly', () => {
    expect(parseEmbedMessage('{"event":"onReady","id":1,"channel":"widget"}')).toEqual({ kind: 'ready' });
    expect(parseEmbedMessage('{"event":"initialDelivery","info":{}}')).toEqual({ kind: 'ready' });
    expect(parseEmbedMessage('{"event":"infoDelivery","info":{"playerState":1}}')).toEqual({ kind: 'state', state: 1 });
    expect(parseEmbedMessage('{"event":"onStateChange","info":0}')).toEqual({ kind: 'state', state: 0 });
    expect(parseEmbedMessage('{"event":"onError","info":150}')).toEqual({ kind: 'error', code: 150 });
    expect(parseEmbedMessage('{"event":"onError"}')).toEqual({ kind: 'error', code: -1 });
    for (const value of ['{"event":"command"}', 'not json', '{}', 'null', 42, { event: 'onReady' }, 'x'.repeat(70_000)]) {
      expect(parseEmbedMessage(value)).toBeNull();
    }
    expect(JSON.parse(EMBED_LISTENING)).toEqual({ event: 'listening', id: 1, channel: 'widget' });
  });

  test('errors fail at any point; the end closes only a started player', () => {
    expect(nextEmbedPhase('starting', { kind: 'ready' })).toBe('ready');
    expect(nextEmbedPhase('starting', { kind: 'error', code: 150 })).toBe('failed');
    expect(nextEmbedPhase('ready', { kind: 'error', code: 101 })).toBe('failed');
    expect(nextEmbedPhase('ready', { kind: 'state', state: 1 })).toBe('ready');
    expect(nextEmbedPhase('ready', { kind: 'state', state: 0 })).toBe('ended');
    expect(nextEmbedPhase('failed', { kind: 'ready' })).toBe('failed');
    expect(nextEmbedPhase('ended', { kind: 'error', code: 2 })).toBe('ended');
  });
});

describe('native host page', () => {
  test('loads under the app identity, https beside YouTube and http only beside a mock', () => {
    expect(nativeEmbedHostOrigin()).toBe('https://app.ether.vela');
    expect(nativeEmbedHostOrigin('http://127.0.0.1:7788')).toBe('http://app.ether.vela');
  });

  test('frames the player URL escaped, and listens to the player origin only', () => {
    const url = embedPlayerUrl({ provider: 'youtube', videoId: VIDEO }, nativeEmbedHostOrigin());
    const page = nativeEmbedPage(url);
    expect(page).toContain(`src="${url.replace(/&/g, '&amp;')}"`);
    expect(page).toContain('allow="autoplay; encrypted-media; picture-in-picture; fullscreen"');
    expect(page).toContain('referrerpolicy="strict-origin-when-cross-origin"');
    expect(page).toContain('o="https://www.youtube-nocookie.com"');
    expect(page).toContain('e.source!==f.contentWindow');
    expect(page.match(/<iframe/g)).toHaveLength(1);
  });
});

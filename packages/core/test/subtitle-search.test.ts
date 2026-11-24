import { afterEach, expect, test } from 'bun:test';
import { EtherAdapter } from '../src/adapter/ether';
import { etherSubtitleLanguages, etherSubtitleSearch, subtitleRetryDelayMs } from '../src/adapter/ether/subtitles';
import { JellyfinAdapter, jellyfinSubtitleOffer } from '../src/adapter/jellyfin';
import { plexSubtitleOffer } from '../src/adapter/plex';
import { hasSubtitleSearch } from '../src/adapter/media-actions';
import { iso6391, iso6392, languageKey, orderSubtitleLanguages, pickSubtitleLanguage } from '../src/subtitle-languages';
import type * as V from '../src/wire';
import { FakeCredentials, restoreFetch, routeFetch } from './helpers';
afterEach(restoreFetch);

const features = (subtitleSearch?: unknown) => ({ protocolVersion: 0, server: { id: 's', name: 'Ether', version: '1' }, skins: [], defaultSkinId: 'x',
  features: { passwordSignIn: { available: true }, ...(subtitleSearch ? { subtitleSearch } : {}) } }) as unknown as V.ServerCapabilities;

test('an Ether without the feature, or with it off or empty, offers no subtitle search', () => {
  expect(etherSubtitleLanguages(features())).toBeNull();
  expect(etherSubtitleLanguages(features({ available: false, languages: ['nl'] }))).toBeNull();
  expect(etherSubtitleLanguages(features({ available: true, languages: [] }))).toBeNull();
  expect(etherSubtitleLanguages(features({ available: true, languages: ['nl', ' en ', '', 'nl', 3] }))?.languages).toEqual([{ code: 'nl' }, { code: 'en' }]);
});

test('Ether offers keep every detail the server gives and drop malformed ones', () => {
  const result = etherSubtitleSearch({ language: 'nl', preferredLanguages: ['nl', 'en', ''], offers: [
    { id: 'a', language: 'nl', name: 'Film.2160p.nl', provider: 'OpenSubtitles', format: 'srt', author: 'jan', downloads: 1234.4, rating: 8.5, releaseMatch: true, hearingImpaired: true, forced: false },
    { id: 'ai', language: 'nl', name: 'Dutch (from English)', provider: 'Ether', aiTranslated: true, downloads: -1, rating: Number.NaN },
    { id: '', language: 'nl', name: 'no id', provider: 'x' },
    { id: 'b', language: '', name: '', provider: 'Site', rating: 42 },
  ] as V.SubtitleOffer[] });
  expect(result.language).toBe('nl');
  expect(result.preferred).toEqual(['nl', 'en']);
  expect(result.offers).toEqual([
    { id: 'a', name: 'Film.2160p.nl', language: 'nl', provider: 'OpenSubtitles', format: 'srt', author: 'jan', downloads: 1234, rating: 8.5, releaseMatch: true, hearingImpaired: true },
    { id: 'ai', name: 'Dutch (from English)', language: 'nl', provider: 'Ether', aiTranslated: true },
    { id: 'b', name: 'Site', language: 'nl', provider: 'Site', rating: 10 },
  ]);
});

test('Ether search asks for the language only when one is chosen', async () => {
  const seen = routeFetch({ 'GET /vela/v0/sessions/s1/subtitles/search': (r: { url: URL }) => ({ language: r.url.searchParams.get('language') ?? 'nl', offers: [], preferredLanguages: ['nl'] }) });
  const api = new EtherAdapter('https://test.example', new FakeCredentials(), 'test');
  expect(hasSubtitleSearch(api)).toBe(true);
  expect((await api.searchSubtitles('s1')).language).toBe('nl');
  expect(seen[0]?.url.search).toBe('');
  expect((await api.searchSubtitles('s1', 'pt-BR')).language).toBe('pt-BR');
  expect(seen[1]?.url.searchParams.get('language')).toBe('pt-BR');
});

test('Ether download asks again, as a new mutation, while an AI translation prepares', async () => {
  let asks = 0;
  const plan = { sessionId: 's1', revision: 3, subtitleTracks: [{ id: 'new', kind: 'subtitle' }], selectedSubtitleTrackId: 'new' };
  const seen = routeFetch({ 'POST /vela/v0/sessions/s1/subtitles/ai%3Anl': () => ++asks < 2 ? new Response(JSON.stringify({ state: 'preparing', retryAfterSeconds: 0 }), { status: 202 }) : plan });
  const api = new EtherAdapter('https://test.example', new FakeCredentials(), 'test');
  const answer = await api.downloadSubtitle('s1', 'ai:nl', 'key-1');
  expect(answer.selectedSubtitleTrackId).toBe('new');
  expect(seen.map(r => (r.body as { idempotencyKey: string }).idempotencyKey)).toEqual(['key-1', 'key-1:1']);
  expect(subtitleRetryDelayMs({ state: 'preparing', retryAfterSeconds: 0 })).toBe(1000);
  expect(subtitleRetryDelayMs({ state: 'preparing', retryAfterSeconds: 600 })).toBe(10_000);
});

test('Jellyfin and Plex offers carry their providers\' details', () => {
  expect(jellyfinSubtitleOffer({ Id: 'p1', Name: 'Film.nl', ThreeLetterISOLanguageName: 'dut', ProviderName: 'Open Subtitles', Format: 'srt', DownloadCount: 9, CommunityRating: 7.5, IsHashMatch: true, HearingImpaired: false, MachineTranslated: true }, 'dut'))
    .toEqual({ id: 'p1', name: 'Film.nl', language: 'dut', provider: 'Open Subtitles', format: 'srt', downloads: 9, rating: 7.5, releaseMatch: true, aiTranslated: true });
  expect(plexSubtitleOffer({ key: '/library/streams/9', title: 'Film.nl', displayTitle: 'Dutch (SRT)', languageCode: 'dut', providerTitle: 'OpenSubtitles', codec: 'srt', perfectMatch: '1', hearingImpaired: true, forced: '0' }, 'nl'))
    .toEqual({ id: '/library/streams/9', name: 'Film.nl', language: 'dut', provider: 'OpenSubtitles', format: 'srt', releaseMatch: true, hearingImpaired: true });
});

test('Jellyfin lists its cultures and starts in the viewer\'s subtitle preference', async () => {
  const source = { Id: 'media', SupportsDirectPlay: true, Container: 'mp4', MediaStreams: [] };
  const seen = routeFetch({
    'GET /Users/viewer-1/Items/10': { Id: '10', Type: 'Movie', Name: 'Movie', MediaSources: [source] },
    'POST /Items/10/PlaybackInfo': { PlaySessionId: 'session', MediaSources: [source] },
    'GET /Localization/Cultures': [{ DisplayName: 'Dutch; Flemish', ThreeLetterISOLanguageName: 'dut' }, { DisplayName: 'English', ThreeLetterISOLanguageName: 'eng' }],
    'GET /Users/viewer-1': { Id: 'viewer-1', Name: 'Viewer', Configuration: { SubtitleLanguagePreference: 'dut' } },
    'GET /Items/10/RemoteSearch/Subtitles/dut': [],
  });
  const api = new JellyfinAdapter('https://test.example', new FakeCredentials());
  const plan = await api.startPlayback({ titleId: '10', client: { device: { id: 'd', name: 'd', platform: 'web', appVersion: '1' }, protocolVersions: [0], containers: ['mp4'], videoCodecs: ['h264'], audioCodecs: ['aac'], subtitleFormats: ['vtt'], hls: false, mse: false }, idempotencyKey: 'start' });
  expect(await api.subtitleLanguages(plan.sessionId)).toEqual({ languages: [{ code: 'dut', name: 'Dutch; Flemish' }, { code: 'eng', name: 'English' }], preferred: ['dut'] });
  const result = await api.searchSubtitles(plan.sessionId);
  expect(result).toEqual({ language: 'dut', preferred: ['dut'], offers: [] });
  expect(seen.filter(r => r.url.pathname === '/Localization/Cultures')).toHaveLength(1);
});

test('language codes from every server compare as one language', () => {
  expect(['nl', 'NL', 'dut', 'nld', 'nl_NL'].map(languageKey)).toEqual(['nl', 'nl', 'nl', 'nl', 'nl-nl']);
  expect(languageKey('pt-BR')).toBe('pt-br');
  expect(languageKey('xx')).toBe('xx');
  expect(iso6391('ger')).toBe('de');
  expect(iso6392('nl')).toBe('dut');
  expect(iso6392('fr-CA')).toBe('fre');
});

test('a language list leads with the viewer\'s languages in their order, then the rest by name', () => {
  const languages = ['de', 'en', 'nl', 'fr', 'pt', 'pt-BR', 'ja'].map(code => ({ code }));
  const { preferred, others } = orderSubtitleLanguages(languages, ['pt-BR', 'dut', 'nl-BE', 'xx', 'en-GB', 'en']);
  expect(preferred.map(l => l.code)).toEqual(['pt-BR', 'nl', 'en']);
  expect(others.map(l => l.code)).toEqual(['fr', 'de', 'ja', 'pt']);
  // A server's own names order the rest; a code listed twice is shown once.
  const named = orderSubtitleLanguages([{ code: 'eng', name: 'English' }, { code: 'dut', name: 'Dutch' }, { code: 'nld', name: 'Nederlands' }, { code: 'ger', name: 'German' }], []);
  expect(named.others.map(l => l.code)).toEqual(['dut', 'eng', 'ger']);
});

test('a search starts in the first preferred language the server has, else its first', () => {
  const languages = ['eng', 'dut', 'ger'].map(code => ({ code }));
  expect(pickSubtitleLanguage(languages, ['xx', 'nl-NL', 'en'])).toBe('dut');
  expect(pickSubtitleLanguage(languages, ['ja'])).toBe('eng');
  expect(pickSubtitleLanguage([], ['en'])).toBeUndefined();
});

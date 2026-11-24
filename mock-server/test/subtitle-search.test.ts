import { expect, test } from 'bun:test';
import type { PlaybackPlan } from '../../packages/protocol/types';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { downloadSubtitle, foundSubtitleVtt, searchSubtitles } from '../subtitle-search';
import { mediaRoot } from '../media';
import { launchMock } from './launch';

const plan = (sessionId: string) => ({ sessionId, titleId: 'movie-1', revision: 1, subtitleTracks: [], selectedSubtitleTrackId: null }) as unknown as PlaybackPlan;

test('a search without a language uses the viewer\'s first preferred one and offers an AI translation', () => {
  const answer = searchSubtitles(plan('s1'), null);
  expect(answer.language).toBe('nl');
  expect(answer.preferredLanguages).toEqual(['nl', 'en']);
  expect(answer.offers.some(offer => offer.aiTranslated)).toBe(true);
  expect(answer.offers.find(offer => offer.releaseMatch)?.downloads).toBeGreaterThan(0);
  expect(searchSubtitles(plan('s1'), 'en').offers.some(offer => offer.aiTranslated)).toBe(false);
});

test('only an offer the session was shown is downloaded, as a selected external WebVTT track', () => {
  const p = plan('s2');
  expect(downloadSubtitle(p, '/media', 'site-nl-1')).toBeUndefined();
  searchSubtitles(p, 'nl');
  const next = downloadSubtitle(p, '/media', 'site-nl-1') as PlaybackPlan;
  expect(next.subtitleTracks).toHaveLength(1);
  expect(next.selectedSubtitleTrackId).toBe(next.subtitleTracks[0]!.id);
  expect(next.subtitleTracks[0]!.delivery).toEqual({ kind: 'external', format: 'webvtt', url: '/media/found-subtitles/site-nl-1.vtt' });
  expect(foundSubtitleVtt('s2', 'site-nl-1')).toContain('Signaal ontvangen');
  // Choosing it again adds nothing.
  expect((downloadSubtitle(p, '/media', 'site-nl-1') as PlaybackPlan).subtitleTracks).toHaveLength(1);
});

test('an AI translation prepares before it joins the session', () => {
  const p = plan('s3');
  searchSubtitles(p, 'de');
  expect(downloadSubtitle(p, '/media', 'ai-de')).toMatchObject({ state: 'preparing' });
  expect(p.subtitleTracks).toHaveLength(0);
});

// Over HTTP, a session needs the generated fixture (scripts/make-media.ts); CI has none.
const mediaGenerated = existsSync(join(mediaRoot, 'master.m3u8'));
(mediaGenerated ? test : test.skip)('over HTTP a download raises the plan revision, and a preparing answer is asked again, not replayed', async () => {
  const mock = await launchMock({ VELA_MOCK_TRANSLATE_MS: '300' });
  try {
    const device = { id: 'sub-test', name: 'Test', platform: 'web', appVersion: '0.1.0' };
    const post = (path: string, body: object, token?: string) => fetch(`${mock.url}/vela/v0${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Vela-Device-Id': device.id, ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    const tokens = await (await post('/auth/sign-in', { username: 'demo', password: 'vela', device, idempotencyKey: 'sign-in' })).json() as { accessToken: string };
    const client = { device, protocolVersions: [0], containers: ['mp4'], videoCodecs: ['h264'], audioCodecs: ['aac'], subtitleFormats: ['vtt'], hls: true, mse: false };
    const plan = await (await post('/playback', { titleId: 'title-1-1', client, idempotencyKey: 'play' }, tokens.accessToken)).json() as PlaybackPlan;
    const search = await fetch(`${mock.url}/vela/v0/sessions/${plan.sessionId}/subtitles/search?language=de`, { headers: { Authorization: `Bearer ${tokens.accessToken}`, 'X-Vela-Device-Id': device.id } });
    expect((await search.json() as { language: string }).language).toBe('de');
    const site = await post(`/sessions/${plan.sessionId}/subtitles/site-de-1`, { idempotencyKey: 'd1' }, tokens.accessToken);
    expect(site.status).toBe(200);
    const added = await site.json() as PlaybackPlan;
    expect(added.revision).toBeGreaterThan(plan.revision);
    expect(added.selectedSubtitleTrackId).toBe('found-site-de-1');
    expect((await post(`/sessions/${plan.sessionId}/subtitles/ai-de`, { idempotencyKey: 'a1' }, tokens.accessToken)).status).toBe(202);
    await Bun.sleep(400);
    const ready = await post(`/sessions/${plan.sessionId}/subtitles/ai-de`, { idempotencyKey: 'a2' }, tokens.accessToken);
    expect(ready.status).toBe(200);
    expect((await ready.json() as PlaybackPlan).subtitleTracks.map(track => track.id)).toContain('found-ai-de');
    await post(`/sessions/${plan.sessionId}/commands`, { kind: 'stop', sourceGeneration: added.sourceGeneration, seekGeneration: added.seekGeneration, idempotencyKey: 'stop' }, tokens.accessToken);
  } finally { await mock.stop(); }
}, 20_000);

import { describe, expect, test } from 'bun:test';
import {
  formatFirstPlayLabel,
  formatRecapSummary,
  msg,
  recapChartBuckets,
  recapKey,
  recapLabels,
  recapStatCards,
} from '../src';
import { initialMusic, Music } from '../src/store/music';
import { StateBox } from '../src/store/state';
import type { VelaState } from '../src/store';
import type { Session } from '../src/store/session';
import type * as V from '../src/wire';

const sampleArtwork: V.ArtworkRef = {
  id: 'art-1',
  kind: 'poster',
  tag: 'tag-1',
  sizes: [{ width: 300, height: 300, url: '/art/poster.svg' }],
};

const sampleTrack = (id: string, name: string, albumId: string, albumName: string, recordingId: string): V.Title => ({
  id,
  kind: 'episode',
  name,
  summary: '',
  genres: ['Indie Folk'],
  year: 2024,
  durationSeconds: 228,
  artwork: [sampleArtwork],
  media: {
    class: 'music',
    role: 'track',
    disc: 1,
    index: 1,
    recordingId,
    parents: [
      { id: albumId, role: 'album', name: albumName },
      { id: 'artist-hollow-lanterns', role: 'artist', name: 'Mira Solis' },
    ],
  },
});

const sampleArtist: V.Title = {
  id: 'artist-hollow-lanterns',
  kind: 'show',
  name: 'Mira Solis',
  summary: '',
  genres: ['Indie Folk'],
  artwork: [sampleArtwork],
  media: { class: 'music', role: 'artist', childCount: 3 },
};

const sampleAlbum: V.Title = {
  id: 'album-paper-boats',
  kind: 'season',
  name: 'Paper Boats',
  summary: '',
  genres: ['Indie Folk'],
  year: 2024,
  artwork: [sampleArtwork],
  media: {
    class: 'music',
    role: 'album',
    childCount: 9,
    parents: [{ id: 'artist-hollow-lanterns', role: 'artist', name: 'Mira Solis' }],
  },
};

function makeMusicHarness() {
  const calls: string[] = [];
  let importPollCount = 0;
  let keys = 0;
  const preferredByRecording = new Map<string, string>();

  const trackOriginal = sampleTrack('track-paper-boats-1-01', 'Paper Boats', 'album-paper-boats', 'Paper Boats', 'US-DRW-19-00101');
  const trackDeluxe = sampleTrack('track-harbour-sessions-deluxe-1-01', 'Paper Boats (2024 Remaster)', 'album-harbour-sessions-deluxe', 'Paper Boats (Anniversary Deluxe Edition)', 'US-DRW-19-00101');
  const trackComp = sampleTrack('track-coastal-anthology-1-01', 'Paper Boats', 'album-coastal-anthology', 'Coastal Anthology: Five Years of Driftwood', 'US-DRW-19-00101');

  const adapter = {
    favoriteTitles: async (role: string) => {
      calls.push(`favorites:${role}`);
      return { items: [], total: 0, continuation: 'exhausted' as const };
    },
    titleLyrics: async () => null,
    titleContinuation: async () => ({ items: [], continuation: 'exhausted' as const }),
    recentPlayContexts: async () => ({ items: [] }),
    historyRecap: async ({ period, library, at }: { period: V.HistoryRecapPeriod; library?: string; at?: string; tz?: string }): Promise<V.HistoryRecap> => {
      calls.push(`recap:${period}:${library ?? ''}:${at ?? ''}`);
      const days = period === 'week' ? 7 : period === 'month' ? 30 : 365;
      return {
        period,
        from: '2026-10-25T00:00:00.000Z',
        to: '2026-11-24T23:59:59.999Z',
        minutes: 842,
        plays: 214,
        distinctTracks: 48,
        distinctArtists: 11,
        topArtists: [{ title: sampleArtist, plays: 94, minutes: 368 }],
        topTracks: [{ title: trackOriginal, plays: 28, minutes: 106 }],
        topAlbums: [{ title: sampleAlbum, plays: 76, minutes: 298 }],
        streak: { current: 9, longest: 16 },
        byDay: Array.from({ length: days }, (_, i) => ({
          date: `2026-11-${String((i % 30) + 1).padStart(2, '0')}`,
          minutes: i % 3 === 0 ? 0 : 28,
        })),
        firstPlayAt: '2025-11-04T19:15:00.000Z',
        generatedAt: '2026-11-24T12:00:00.000Z',
      };
    },
    startPlaylistImport: async (request: V.PlaylistImportRequest): Promise<V.PlaylistImportJobRef> => {
      calls.push(`import:start:${request.library}:${'url' in request && request.url ? request.url : request.file?.format ?? ''}`);
      importPollCount = 0;
      return { id: 'imp-1' };
    },
    playlistImport: async (id: string): Promise<V.PlaylistImport> => {
      importPollCount++;
      calls.push(`import:poll:${id}:${importPollCount}`);
      const done = importPollCount >= 2;
      return {
        id,
        state: done ? 'done' : 'matching',
        name: 'Late Night Harbor',
        description: 'Imported from Spotify',
        artwork: sampleAlbum.artwork,
        total: 3,
        done: done ? 3 : 1,
        matched: [
          {
            index: 0,
            source: { title: 'Paper Boats', artist: 'Mira Solis', album: 'Paper Boats', isrc: 'US-DRW-19-00101', durationSeconds: 228 },
            title: trackOriginal,
            by: 'isrc',
          },
        ],
        unmatched: [
          {
            index: 1,
            source: { title: 'Unknown Song', artist: 'Ghost Artist' },
            reason: 'not_found',
          },
          {
            index: 2,
            source: { title: 'Harbour Lights', artist: 'Mira Solis' },
            reason: 'ambiguous',
            candidates: [trackOriginal, trackDeluxe],
          },
        ],
      };
    },
    savePlaylistImport: async (id: string, request: V.SavePlaylistImportRequest): Promise<V.PlaylistCard> => {
      const chooseStr = request.choose ? Object.entries(request.choose).map(([k, v]) => `${k}=${v}`).join(';') : '';
      calls.push(`import:save:${id}:${request.name ?? ''}:${(request.exclude ?? []).join(',')}:${chooseStr}`);
      return {
        id: 'playlist-imported-1',
        kind: 'playlist',
        name: request.name || 'Late Night Harbor',
        smart: false,
        itemCount: 1 + (request.choose ? Object.keys(request.choose).length : 0),
        updatedAt: '2026-11-24T12:00:00.000Z',
        artwork: sampleAlbum.artwork,
      };
    },
    libraryDuplicates: async (libraryId: string): Promise<V.DuplicateGroupsPage> => {
      calls.push(`duplicates:${libraryId}`);
      const preferred = preferredByRecording.get('US-DRW-19-00101') ?? trackOriginal.id;
      return {
        items: [
          {
            recordingId: 'US-DRW-19-00101',
            count: 3,
            titles: [trackOriginal, trackDeluxe, trackComp],
            preferredTitleId: preferred,
          },
        ],
        continuation: 'exhausted',
      };
    },
    titleRecording: async (titleId: string): Promise<V.RecordingReleases> => {
      calls.push(`recording:${titleId}`);
      const preferred = preferredByRecording.get('US-DRW-19-00101') ?? trackOriginal.id;
      return {
        recordingId: 'US-DRW-19-00101',
        titles: [trackOriginal, trackDeluxe, trackComp],
        preferredTitleId: preferred,
      };
    },
    setDuplicatePreference: async (libraryId: string, recordingId: string, request: V.DuplicatePreferenceRequest): Promise<V.DuplicateGroup> => {
      calls.push(`duplicates:prefer:${libraryId}:${recordingId}:${request.preferredTitleId}:${(request.hideOtherIds ?? []).join(',')}`);
      preferredByRecording.set(recordingId, request.preferredTitleId);
      const hidden = new Set(request.hideOtherIds ?? []);
      const remaining = [trackOriginal, trackDeluxe, trackComp].filter(t => !hidden.has(t.id));
      return {
        recordingId,
        count: remaining.length,
        titles: remaining,
        preferredTitleId: request.preferredTitleId,
      };
    },
  };

  const box = new StateBox({ music: initialMusic } as unknown as VelaState);
  const session = {
    features: {
      favoritesList: { available: true, roles: ['track', 'album', 'artist'] },
      historyRecap: { available: true, periods: ['week', 'month', 'year', 'all'] },
      playlistImport: { available: true, links: ['deezer', 'spotify'], files: ['m3u', 'csv'], maxTracks: 500 },
      duplicates: { available: true },
    },
    onReset() {},
    key: () => `key-${++keys}`,
    ready: async () => ({ adapter, images: async () => undefined }),
  } as unknown as Session;

  const music = new Music(box, session, () => 640);
  return { music, box, calls };
}

describe('B6 listening recap, B7 playlist import, B8b duplicate review in @vela/core', () => {
  test('B6 listening recap loads period data, formats stats/summary, and buckets 365-day charts with tooltips', async () => {
    const { music, box, calls } = makeMusicHarness();
    expect(music.recapAvailable).toBe(true);
    expect(music.recapPeriods).toEqual(['week', 'month', 'year', 'all']);

    await music.recap('year', 'music', '2026-11-24');
    const key = recapKey('year', 'music', '2026-11-24');
    const loaded = box.get().music.recaps[key];
    expect(loaded?.load).toBe('ready');
    const recap = loaded!.value!;
    expect(recap.minutes).toBe(842);
    expect(recap.plays).toBe(214);
    expect(recap.byDay).toHaveLength(365);
    expect(recap.topArtists[0]?.card.name).toBe('Mira Solis');
    expect(recap.topTracks[0]?.card.media?.recordingId).toBe('US-DRW-19-00101');
    expect(calls).toContain('recap:year:music:2026-11-24');

    const buckets = recapChartBuckets(recap.byDay, 31);
    expect(buckets.length).toBeLessThanOrEqual(31);
    expect(buckets.length).toBeGreaterThan(25);
    expect(buckets[0]?.tooltip).toContain('min/day');
    expect(buckets[0]?.dayCount).toBeGreaterThan(1);

    const monthBuckets = recapChartBuckets(recap.byDay.slice(0, 7), 31);
    expect(monthBuckets).toHaveLength(7);
    expect(monthBuckets[1]?.tooltip).toContain('2026-11-02 · 28 min');

    const stats = recapStatCards(recap, recapLabels('music'));
    expect(stats.map(s => s.key)).toEqual(['minutes', 'plays', 'artists', 'streak']);

    const summary = formatRecapSummary(recap, 'Aria', recapLabels('music'));
    expect(summary).toContain('Aria’s Vela Rewind');
    expect(summary).toContain('#1 Top artists: Mira Solis');
    expect(summary).toContain('#1 Top songs: Paper Boats');

    const podcastLabels = recapLabels('podcast');
    expect(podcastLabels.topAlbums).toBe('Top shows');
    const audiobookLabels = recapLabels('audiobook');
    expect(audiobookLabels.topArtists).toBe('Top authors');
    expect(formatFirstPlayLabel(recap.firstPlayAt)).toContain('Listening since');
  });

  test('B7 playlist import starts, polls matching progress to done, maps ambiguous candidates, and saves with exclusions and chosen releases', async () => {
    const { music, box, calls } = makeMusicHarness();
    expect(music.playlistImportAvailable).toBe(true);
    expect(msg('music.import.matchBy.isrc')).toBe('Exact match');
    expect(msg('music.import.matchBy.title')).toBe('Matched by title & artist');

    const first = await music.startPlaylistImport('music', {
      url: 'https://open.spotify.com/playlist/37i9dQZF1DX4JAvHpjipBk',
    });
    expect(first?.state).toBe('matching');
    expect(first?.done).toBe(1);
    expect(first?.total).toBe(3);

    const second = await music.pollPlaylistImport(first!.id);
    expect(second?.state).toBe('done');
    expect(second?.matched).toHaveLength(1);
    expect(second?.matched[0]?.by).toBe('isrc');
    expect(second?.matched[0]?.card.name).toBe('Paper Boats');
    expect(second?.unmatched.map(u => u.reason)).toEqual(['not_found', 'ambiguous']);
    expect(second?.unmatched[1]?.candidates.map(c => c.id)).toEqual([
      'track-paper-boats-1-01',
      'track-harbour-sessions-deluxe-1-01',
    ]);

    const saved = await music.savePlaylistImport(first!.id, {
      name: 'My Harbor Mix',
      exclude: [0],
      choose: { '2': 'track-harbour-sessions-deluxe-1-01' },
    });
    expect(saved?.id).toBe('playlist-imported-1');
    expect(saved?.name).toBe('My Harbor Mix');
    expect(calls).toContain('import:save:imp-1:My Harbor Mix:0:2=track-harbour-sessions-deluxe-1-01');

    music.resetPlaylistImport();
    expect(box.get().music.playlistImport.load).toBe('idle');
  });

  test('B8b duplicates loads recording groups, reads title recording releases, and updates preferred release & hides others', async () => {
    const { music, box, calls } = makeMusicHarness();
    expect(music.duplicatesAvailable).toBe(true);

    await music.duplicates('music');
    await music.recording('track-paper-boats-1-01');

    const groups = box.get().music.duplicates.music?.value?.items ?? [];
    expect(groups).toHaveLength(1);
    expect(groups[0]?.recordingId).toBe('US-DRW-19-00101');
    expect(groups[0]?.count).toBe(3);
    expect(groups[0]?.preferredTitleId).toBe('track-paper-boats-1-01');

    const rec = box.get().music.recordings['track-paper-boats-1-01']?.value;
    expect(rec?.cards).toHaveLength(3);

    const updated = await music.setDuplicatePreference(
      'music',
      'US-DRW-19-00101',
      'track-harbour-sessions-deluxe-1-01',
      ['track-coastal-anthology-1-01'],
    );
    expect(updated?.preferredTitleId).toBe('track-harbour-sessions-deluxe-1-01');
    expect(updated?.cards.map(c => c.id)).toEqual([
      'track-paper-boats-1-01',
      'track-harbour-sessions-deluxe-1-01',
    ]);

    // Both cached duplicate groups and cached recording release lists update coherently.
    const nextGroup = box.get().music.duplicates.music?.value?.items[0];
    expect(nextGroup?.preferredTitleId).toBe('track-harbour-sessions-deluxe-1-01');
    expect(nextGroup?.count).toBe(2);
    expect(box.get().music.recordings['track-paper-boats-1-01']?.value?.preferredTitleId).toBe('track-harbour-sessions-deluxe-1-01');
    expect(calls).toContain('duplicates:prefer:music:US-DRW-19-00101:track-harbour-sessions-deluxe-1-01:track-coastal-anthology-1-01');
  });
});

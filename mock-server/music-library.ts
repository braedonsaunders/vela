// Listening recap (B6), playlist import (B7) and duplicate recording review (B8b) for the mock server.
import type * as V from '../packages/protocol/types';
import { mediaArtwork, mediaGroups, mediaLibraries, mediaTitle } from '../packages/protocol/fixtures/media';

// ---------------------------------------------------------------------------------------------
// B8b: Duplicate recordings and viewer preferences / hidden releases

interface ViewerDuplicateState {
  preferredByRecording: Map<string, string>;
  hiddenTitleIds: Set<string>;
}
const viewerDuplicates = new Map<string, ViewerDuplicateState>();
function duplicateState(viewerId: string): ViewerDuplicateState {
  let state = viewerDuplicates.get(viewerId);
  if (!state) {
    state = {
      preferredByRecording: new Map([['US-DRW-19-00101', 'track-paper-boats-1-01']]),
      hiddenTitleIds: new Set(),
    };
    viewerDuplicates.set(viewerId, state);
  }
  return state;
}

export function isHiddenDuplicateTitle(viewerId: string, titleId: string): boolean {
  return duplicateState(viewerId).hiddenTitleIds.has(titleId);
}

/** All tracks in a library grouped by recordingId, keeping groups with at least 2 releases, most copies first. */
export function libraryDuplicateGroups(
  libraryId: string,
  viewerId: string,
  presentTitle: (title: V.Title) => V.Title,
): V.DuplicateGroup[] {
  const lib = mediaLibraries.find(item => item.id === libraryId);
  if (!lib || lib.media !== 'music') return [];
  const state = duplicateState(viewerId);
  const byRecording = new Map<string, V.Title[]>();
  for (const track of mediaGroups.tracks) {
    const recId = track.media?.recordingId;
    if (!recId) continue;
    const list = byRecording.get(recId) ?? [];
    list.push(presentTitle(track));
    byRecording.set(recId, list);
  }
  const groups: V.DuplicateGroup[] = [];
  for (const [recordingId, titles] of byRecording) {
    if (titles.length < 2) continue;
    const preferredTitleId = state.preferredByRecording.get(recordingId);
    groups.push({
      recordingId,
      count: titles.length,
      titles,
      ...(preferredTitleId && titles.some(t => t.id === preferredTitleId) ? { preferredTitleId } : {}),
    });
  }
  return groups.sort((a, b) => b.count - a.count || a.recordingId.localeCompare(b.recordingId));
}

export function recordingReleasesForTitle(
  title: V.Title,
  viewerId: string,
  presentTitle: (title: V.Title) => V.Title,
): V.RecordingReleases {
  const recordingId = title.media?.recordingId ?? `rec-${title.id}`;
  const state = duplicateState(viewerId);
  const matching = title.media?.recordingId
    ? mediaGroups.tracks.filter(candidate => candidate.media?.recordingId === recordingId).map(presentTitle)
    : [presentTitle(title)];
  const preferredTitleId = state.preferredByRecording.get(recordingId);
  return {
    recordingId,
    ...(preferredTitleId && matching.some(t => t.id === preferredTitleId) ? { preferredTitleId } : {}),
    titles: matching,
  };
}

export function setDuplicatePreference(
  libraryId: string,
  recordingId: string,
  viewerId: string,
  body: Partial<V.DuplicatePreferenceRequest>,
  presentTitle: (title: V.Title) => V.Title,
): V.DuplicateGroup | 'not_found' | 'invalid' {
  const groups = libraryDuplicateGroups(libraryId, viewerId, presentTitle);
  const group = groups.find(item => item.recordingId === recordingId);
  if (!group) return 'not_found';
  if (typeof body.preferredTitleId !== 'string' || !group.titles.some(t => t.id === body.preferredTitleId)) return 'invalid';
  if (body.hideOtherIds !== undefined) {
    if (!Array.isArray(body.hideOtherIds) || body.hideOtherIds.some(id => typeof id !== 'string' || id === body.preferredTitleId || !group.titles.some(t => t.id === id))) {
      return 'invalid';
    }
  }
  const state = duplicateState(viewerId);
  state.preferredByRecording.set(recordingId, body.preferredTitleId);
  // Clear previous hidden state for this recording group when updating preference, then apply hideOtherIds if supplied.
  for (const t of group.titles) state.hiddenTitleIds.delete(t.id);
  for (const id of body.hideOtherIds ?? []) {
    state.hiddenTitleIds.add(id);
    const target = mediaTitle(id);
    if (target) {
      target.watch = { ...(target.watch ?? { positionSeconds: 0, played: false, favorite: false, watchlisted: false }), favorite: false };
    }
  }
  return libraryDuplicateGroups(libraryId, viewerId, presentTitle).find(item => item.recordingId === recordingId)!;
}

// ---------------------------------------------------------------------------------------------
// B6: Listening recap ("Rewind")

const RECAP_PERIODS: V.HistoryRecapPeriod[] = ['week', 'month', 'year', 'all'];
export const isRecapPeriod = (value: string): value is V.HistoryRecapPeriod => RECAP_PERIODS.includes(value as V.HistoryRecapPeriod);

function parseAnchorDate(at?: string | null): Date | undefined {
  if (!at) return new Date(Date.UTC(2026, 10, 24));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(at)) return undefined;
  const parsed = new Date(`${at}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) ? parsed : undefined;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function buildHistoryRecap(
  period: V.HistoryRecapPeriod,
  atParam: string | null | undefined,
  libraryId: string | null | undefined,
  presentTitle: (title: V.Title) => V.Title,
): V.HistoryRecap | 'invalid_date' | 'invalid_library' {
  const anchor = parseAnchorDate(atParam);
  if (!anchor) return 'invalid_date';

  const dayCount = period === 'week' ? 7 : period === 'month' ? 30 : 365;
  const toDate = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate(), 23, 59, 59));
  const fromDate = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate() - (dayCount - 1), 0, 0, 0));

  // If the anchor date is before 2015 or library does not exist / has no audio, return an empty period (never 404).
  const lib = libraryId ? mediaLibraries.find(item => item.id === libraryId) : undefined;
  const isEmptyYear = anchor.getUTCFullYear() < 2015 || (libraryId && (!lib || (lib.media !== 'music' && lib.media !== 'audiobook' && lib.media !== 'podcast')));

  const byDay: { date: string; minutes: number }[] = [];
  for (let i = 0; i < dayCount; i++) {
    const day = new Date(Date.UTC(fromDate.getUTCFullYear(), fromDate.getUTCMonth(), fromDate.getUTCDate() + i));
    if (isEmptyYear) {
      byDay.push({ date: isoDate(day), minutes: 0 });
      continue;
    }
    const seed = (i * 17 + day.getUTCDate() * 7 + (day.getUTCMonth() + 1) * 13) % 19;
    const isRestDay = seed === 0 || (period !== 'week' && seed === 5);
    const baseMinutes = isRestDay ? 0 : 22 + ((seed * 11) % 74) + (day.getUTCDay() === 0 || day.getUTCDay() === 6 ? 18 : 0);
    byDay.push({ date: isoDate(day), minutes: baseMinutes });
  }

  if (isEmptyYear) {
    return {
      period,
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
      minutes: 0,
      plays: 0,
      distinctTracks: 0,
      distinctArtists: 0,
      topArtists: [],
      topTracks: [],
      topAlbums: [],
      streak: { current: 0, longest: 0 },
      byDay,
      generatedAt: new Date().toISOString(),
    };
  }

  let currentStreak = 0;
  let longestStreak = 0;
  let running = 0;
  for (const entry of byDay) {
    if (entry.minutes > 0) {
      running++;
      if (running > longestStreak) longestStreak = running;
    } else {
      running = 0;
    }
  }
  for (let i = byDay.length - 1; i >= 0; i--) {
    if (byDay[i]!.minutes > 0) currentStreak++;
    else break;
  }

  const scale = period === 'week' ? 1 : period === 'month' ? 4 : period === 'year' ? 32 : 48;
  const mediaKind = lib?.media ?? 'music';

  if (mediaKind === 'audiobook') {
    const books = mediaGroups.audiobooks.slice(0, 5).map(presentTitle);
    const parts = mediaGroups.parts.slice(0, 6).map(presentTitle);
    const topAlbums: V.RecapEntry[] = books.map((title, idx) => ({
      title,
      plays: Math.max(1, (8 - idx) * Math.max(1, Math.round(scale / 2))),
      minutes: Math.max(15, (64 - idx * 9) * Math.max(1, Math.round(scale / 2))),
    }));
    const topTracks: V.RecapEntry[] = parts.map((title, idx) => ({
      title,
      plays: Math.max(1, (6 - idx) * Math.max(1, Math.round(scale / 3))),
      minutes: Math.max(12, (42 - idx * 5) * Math.max(1, Math.round(scale / 3))),
    }));
    const totalMinutes = byDay.reduce((acc, d) => acc + d.minutes, 0);
    return {
      period,
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
      minutes: totalMinutes,
      plays: topTracks.reduce((acc, item) => acc + item.plays, 0),
      distinctTracks: parts.length,
      distinctArtists: books.length,
      topArtists: topAlbums.slice(0, 4),
      topTracks,
      topAlbums,
      streak: { current: currentStreak, longest: Math.max(longestStreak, currentStreak) },
      byDay,
      firstPlayAt: '2024-03-14T18:10:00.000Z',
      generatedAt: new Date().toISOString(),
    };
  }

  if (mediaKind === 'podcast') {
    const shows = mediaGroups.shows.slice(0, 4).map(presentTitle);
    const episodes = mediaGroups.episodes.slice(0, 8).map(presentTitle);
    const topAlbums: V.RecapEntry[] = shows.map((title, idx) => ({
      title,
      plays: Math.max(1, (10 - idx * 2) * Math.max(1, Math.round(scale / 2))),
      minutes: Math.max(18, (85 - idx * 14) * Math.max(1, Math.round(scale / 2))),
    }));
    const topTracks: V.RecapEntry[] = episodes.map((title, idx) => ({
      title,
      plays: Math.max(1, (7 - Math.min(5, idx)) * Math.max(1, Math.round(scale / 4))),
      minutes: Math.max(14, (38 - idx * 3) * Math.max(1, Math.round(scale / 4))),
    }));
    const totalMinutes = byDay.reduce((acc, d) => acc + d.minutes, 0);
    return {
      period,
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
      minutes: totalMinutes,
      plays: topTracks.reduce((acc, item) => acc + item.plays, 0),
      distinctTracks: episodes.length,
      distinctArtists: shows.length,
      topArtists: topAlbums,
      topTracks,
      topAlbums,
      streak: { current: currentStreak, longest: Math.max(longestStreak, currentStreak) },
      byDay,
      firstPlayAt: '2023-09-02T08:30:00.000Z',
      generatedAt: new Date().toISOString(),
    };
  }

  const artistIds = [
    'artist-hollow-lanterns',
    'artist-mira-kestrel',
    'artist-cedar-and-wire',
    'artist-velvet-comet',
    'artist-ondine-marsh-quartet',
  ];
  const albumIds = [
    'album-paper-boats',
    'album-glasshouse-weather',
    'album-late-tram-home',
    'album-neon-orchard',
    'album-northern-almanac',
    'album-copper-kettle-sessions',
    'album-satellite-lullabies',
    'album-tidewater-suite',
  ];
  const trackIds = [
    'track-paper-boats-1-01',
    'track-paper-boats-1-02',
    'track-glasshouse-weather-1-02',
    'track-late-tram-home-1-01',
    'track-neon-orchard-1-01',
    'track-paper-boats-1-05',
    'track-northern-almanac-1-01',
    'track-copper-kettle-sessions-1-01',
    'track-satellite-lullabies-1-03',
    'track-tidewater-suite-1-01',
  ];

  const baseArtistPlays = [42, 31, 24, 19, 14];
  const baseAlbumPlays = [28, 22, 18, 15, 13, 11, 9, 8];
  const baseTrackPlays = [19, 16, 14, 12, 11, 10, 9, 8, 7, 6];

  const topArtists: V.RecapEntry[] = artistIds
    .map(id => mediaTitle(id))
    .filter((t): t is V.Title => !!t)
    .map((t, idx) => {
      const plays = Math.max(2, Math.round(baseArtistPlays[idx]! * Math.sqrt(scale)));
      return { title: presentTitle(t), plays, minutes: plays * 4 };
    });

  const topAlbums: V.RecapEntry[] = albumIds
    .map(id => mediaTitle(id))
    .filter((t): t is V.Title => !!t)
    .map((t, idx) => {
      const plays = Math.max(2, Math.round(baseAlbumPlays[idx]! * Math.sqrt(scale)));
      return { title: presentTitle(t), plays, minutes: plays * 4 };
    });

  const topTracks: V.RecapEntry[] = trackIds
    .map(id => mediaTitle(id))
    .filter((t): t is V.Title => !!t)
    .map((t, idx) => {
      const plays = Math.max(1, Math.round(baseTrackPlays[idx]! * Math.sqrt(scale)));
      const durMin = Math.max(2, Math.round((t.durationSeconds ?? 210) / 60));
      return { title: presentTitle(t), plays, minutes: plays * durMin };
    });

  const totalMinutes = byDay.reduce((acc, d) => acc + d.minutes, 0);
  const totalPlays = Math.max(topTracks.reduce((acc, item) => acc + item.plays, 0), Math.round(totalMinutes / 3.6));
  const distinctTracks = period === 'week' ? 24 : period === 'month' ? 68 : period === 'year' ? 142 : 164;
  const distinctArtists = period === 'week' ? 5 : period === 'month' ? 6 : 7;

  return {
    period,
    from: fromDate.toISOString(),
    to: toDate.toISOString(),
    minutes: totalMinutes,
    plays: totalPlays,
    distinctTracks,
    distinctArtists,
    topArtists,
    topTracks,
    topAlbums,
    streak: { current: currentStreak, longest: Math.max(longestStreak, currentStreak) },
    byDay,
    firstPlayAt: '2019-04-12T19:24:00.000Z',
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------------------------
// B7: Playlist import

interface StoredImportJob {
  id: string;
  library: string;
  createdAt: number;
  polls: number;
  holdMatching: boolean;
  name: string;
  description: string;
  artwork: V.ArtworkRef[];
  matched: V.PlaylistImportMatch[];
  unmatched: V.PlaylistImportUnmatched[];
}

const importJobs = new Map<string, StoredImportJob>();

const SUPPORTED_LINK_RE = /^https?:\/\/(?:open\.spotify\.com\/(?:playlist|album)\/|spotify\.link\/|(?:www\.)?deezer\.com\/(?:[a-z]{2}\/)?(?:playlist|album)\/|dzr\.page\.link\/)/i;

function defaultImportCatalogue(presentTitle: (title: V.Title) => V.Title): {
  matched: V.PlaylistImportMatch[];
  unmatched: V.PlaylistImportUnmatched[];
} {
  const picks: { id: string; by: 'isrc' | 'title'; isrc?: string }[] = [
    { id: 'track-paper-boats-1-01', by: 'isrc', isrc: 'US-DRW-19-00101' },
    { id: 'track-paper-boats-1-02', by: 'isrc', isrc: 'US-DRW-19-00102' },
    { id: 'track-glasshouse-weather-1-02', by: 'isrc', isrc: 'US-NLR-20-00202' },
    { id: 'track-late-tram-home-1-01', by: 'title' },
    { id: 'track-neon-orchard-1-01', by: 'isrc', isrc: 'US-LTA-17-00401' },
    { id: 'track-northern-almanac-1-01', by: 'title' },
    { id: 'track-copper-kettle-sessions-1-01', by: 'isrc', isrc: 'US-KTS-24-00315' },
    { id: 'track-satellite-lullabies-1-03', by: 'title' },
  ];
  const matched: V.PlaylistImportMatch[] = [];
  picks.forEach((pick, idx) => {
    const found = mediaTitle(pick.id);
    if (!found) return;
    const title = presentTitle(found);
    matched.push({
      index: idx < 3 ? idx : idx < 6 ? idx + 1 : idx + 2,
      by: pick.by,
      title,
      source: {
        title: title.name,
        artist: title.showName ?? title.media?.parents?.[1]?.name ?? 'Unknown Artist',
        album: title.media?.parents?.[0]?.name,
        ...(pick.isrc ? { isrc: pick.isrc } : {}),
        durationSeconds: title.durationSeconds,
      },
    });
  });
  const unmatched: V.PlaylistImportUnmatched[] = [
    {
      index: 3,
      reason: 'not_found',
      source: { title: 'Harbour Fog (1998 Cassette Demo)', artist: 'The Hollow Lanterns', album: 'Boathouse Tapes', isrc: 'US-DRW-98-00014', durationSeconds: 214 },
    },
    {
      index: 7,
      reason: 'ambiguous',
      source: { title: 'Nocturne in Blue', artist: 'Cedar & Wire', album: 'Live at the Corner Booth', durationSeconds: 298 },
    },
    {
      index: 10,
      reason: 'not_found',
      source: { title: 'Starlight Over Pier 9', artist: 'Velvet Comet', album: 'B-Sides & Rarities', isrc: 'US-LTA-19-00902', durationSeconds: 196 },
    },
  ];
  return { matched, unmatched };
}

function parseImportFileText(
  file: { name: string; format: V.PlaylistImportFormat; text: string },
  presentTitle: (title: V.Title) => V.Title,
): { matched: V.PlaylistImportMatch[]; unmatched: V.PlaylistImportUnmatched[] } {
  const rawLines = file.text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const entries: { title: string; artist: string; album?: string; isrc?: string; durationSeconds?: number }[] = [];

  if (file.format === 'm3u') {
    let pendingInf: { title: string; artist: string; durationSeconds?: number } | undefined;
    for (const line of rawLines) {
      if (line.toUpperCase().startsWith('#EXTM3U')) continue;
      if (line.toUpperCase().startsWith('#EXTINF:')) {
        const afterColon = line.slice(8);
        const commaIdx = afterColon.indexOf(',');
        const dur = commaIdx >= 0 ? Number.parseInt(afterColon.slice(0, commaIdx), 10) : Number.NaN;
        const label = (commaIdx >= 0 ? afterColon.slice(commaIdx + 1) : afterColon).trim();
        const dashParts = label.split(/\s+-\s+/);
        const artist = dashParts.length > 1 ? dashParts[0]!.trim() : 'The Hollow Lanterns';
        const title = dashParts.length > 1 ? dashParts.slice(1).join(' - ').trim() : label;
        pendingInf = {
          title,
          artist,
          ...(Number.isFinite(dur) && dur > 0 ? { durationSeconds: dur } : {}),
        };
        continue;
      }
      if (line.startsWith('#')) continue;
      if (pendingInf) {
        entries.push(pendingInf);
        pendingInf = undefined;
      } else {
        const cleaned = line.replace(/\.(flac|mp3|m4a|wav|ogg|aac)$/i, '').trim();
        const dashParts = cleaned.split(/\s+-\s+/);
        const artist = dashParts.length > 1 ? dashParts[0]!.trim() : 'The Hollow Lanterns';
        const title = dashParts.length > 1 ? dashParts.slice(1).join(' - ').trim() : cleaned;
        entries.push({ title, artist });
      }
    }
    if (pendingInf) entries.push(pendingInf);
  } else {
    const nonComment = rawLines.filter(l => !l.startsWith('#'));
    const rows = /^title\s*,/i.test(nonComment[0] ?? '') ? nonComment.slice(1) : nonComment;
    for (const row of rows) {
      const parts = row.includes(',') ? row.split(',').map(s => s.trim()) : row.split(/\s+-\s+/).map(s => s.trim());
      entries.push({
        title: parts[0] || row,
        artist: parts[1] || 'The Hollow Lanterns',
        ...(parts[2] ? { album: parts[2] } : {}),
        ...(parts[3] ? { isrc: parts[3] } : {}),
      });
    }
  }

  if (!entries.length) return defaultImportCatalogue(presentTitle);

  const matched: V.PlaylistImportMatch[] = [];
  const unmatched: V.PlaylistImportUnmatched[] = [];
  entries.forEach((entry, index) => {
    const cleanTitle = entry.title.replace(/\.(flac|mp3|m4a|wav|ogg|aac)$/i, '').trim();
    const byIsrc = entry.isrc ? mediaGroups.tracks.find(t => t.media?.recordingId?.toLowerCase() === entry.isrc!.toLowerCase()) : undefined;
    const byName = !byIsrc ? mediaGroups.tracks.filter(t => t.name.toLowerCase() === cleanTitle.toLowerCase()) : [];
    const exact = byIsrc
      ?? (byName.length === 1
        ? byName[0]
        : byName.find(t => (t.showName ?? '').toLowerCase() === entry.artist.toLowerCase()) ?? byName[0]);
    const isAmbiguous = /ambiguous|\(live/i.test(cleanTitle);
    const source: V.ImportSource = {
      title: cleanTitle,
      artist: entry.artist,
      ...(entry.album ? { album: entry.album } : {}),
      ...(entry.isrc ? { isrc: entry.isrc } : {}),
      ...(entry.durationSeconds ? { durationSeconds: entry.durationSeconds } : {}),
    };
    if (exact && !isAmbiguous) {
      matched.push({
        index,
        source: { ...source, durationSeconds: source.durationSeconds ?? exact.durationSeconds },
        title: presentTitle(exact),
        by: byIsrc ? 'isrc' : 'title',
      });
    } else if (isAmbiguous || byName.length > 1) {
      unmatched.push({ index, source, reason: 'ambiguous' });
    } else {
      unmatched.push({ index, source, reason: 'not_found' });
    }
  });
  return { matched, unmatched };
}

export function startPlaylistImport(
  body: Partial<V.PlaylistImportRequest>,
  presentTitle: (title: V.Title) => V.Title,
): { status: 202; job: V.PlaylistImportJobRef } | { status: 400; code: string; message: string } {
  if (typeof body.library !== 'string' || !body.library.trim()) {
    return { status: 400, code: 'invalid_library', message: 'A target library id is required' };
  }
  const hasUrl = typeof body.url === 'string' && body.url.trim().length > 0;
  const hasFile = !!body.file && typeof body.file === 'object';
  if ((hasUrl && hasFile) || (!hasUrl && !hasFile)) {
    return { status: 400, code: 'invalid_request', message: 'Provide either a playlist URL or a file' };
  }
  let name = 'Late Night Harbour Mix';
  let description = 'Imported from external music service · 11 tracks inspected across your library';
  let holdMatching = false;
  let catalogue: { matched: V.PlaylistImportMatch[]; unmatched: V.PlaylistImportUnmatched[] };

  if (hasUrl) {
    const url = body.url!.trim();
    if (!SUPPORTED_LINK_RE.test(url)) {
      return { status: 400, code: 'unsupported_link', message: 'Only Spotify and Deezer playlist or album links are supported' };
    }
    const isDeezer = /deezer\.com|dzr\.page\.link/i.test(url);
    name = isDeezer ? 'Deezer Coastal Favorites' : 'Midnight Boathouse Sessions';
    description = `Imported from ${isDeezer ? 'Deezer' : 'Spotify'} · matched by ISRC and title against Music`;
    holdMatching = /progress|matching|slow/i.test(url);
    catalogue = defaultImportCatalogue(presentTitle);
  } else {
    const file = body.file!;
    if (typeof file.name !== 'string' || !['m3u', 'csv'].includes(file.format) || typeof file.text !== 'string') {
      return { status: 400, code: 'invalid_file', message: 'File name, format (m3u or csv) and text are required' };
    }
    name = file.name.replace(/\.(m3u8?|csv)$/i, '').replace(/[-_]+/g, ' ').trim() || 'Imported Playlist';
    description = `Imported from ${file.format.toUpperCase()} file (${file.name})`;
    holdMatching = /progress|matching/i.test(file.name);
    catalogue = parseImportFileText(file, presentTitle);
  }

  const id = `import-${crypto.randomUUID().slice(0, 8)}`;
  importJobs.set(id, {
    id,
    library: body.library,
    createdAt: Date.now(),
    polls: 0,
    holdMatching,
    name,
    description,
    artwork: [mediaArtwork('album-paper-boats', 'square')],
    matched: catalogue.matched,
    unmatched: catalogue.unmatched,
  });
  return { status: 202, job: { id } };
}

export function getPlaylistImport(id: string, forceState?: string | null): V.PlaylistImport | undefined {
  const job = importJobs.get(id);
  if (!job) return undefined;
  job.polls++;
  const total = job.matched.length + job.unmatched.length;
  const effectiveState: V.PlaylistImport['state'] =
    forceState === 'reading' || forceState === 'matching' || forceState === 'done'
      ? forceState
      : job.holdMatching && job.polls <= 3
        ? 'matching'
        : 'done';
  if (effectiveState === 'reading') {
    return {
      id: job.id,
      state: 'reading',
      name: job.name,
      description: job.description,
      artwork: job.artwork,
      total,
      done: 0,
      matched: [],
      unmatched: [],
    };
  }
  if (effectiveState === 'matching') {
    const done = Math.max(1, Math.min(total - 1, Math.ceil(total * 0.55)));
    return {
      id: job.id,
      state: 'matching',
      name: job.name,
      description: job.description,
      artwork: job.artwork,
      total,
      done,
      matched: job.matched.filter(m => m.index < done),
      unmatched: job.unmatched.filter(u => u.index < done),
    };
  }
  return {
    id: job.id,
    state: 'done',
    name: job.name,
    description: job.description,
    artwork: job.artwork,
    total,
    done: total,
    matched: job.matched,
    unmatched: job.unmatched,
  };
}

export function resolvePlaylistImportSave(
  id: string,
  body: Partial<V.SavePlaylistImportRequest>,
): { name: string; description?: string; titleIds: string[] } | undefined {
  const job = importJobs.get(id);
  if (!job) return undefined;
  const excluded = new Set(Array.isArray(body.exclude) ? body.exclude : []);
  const ordered = [...job.matched]
    .filter(entry => !excluded.has(entry.index))
    .sort((a, b) => a.index - b.index);
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : job.name;
  return {
    name,
    description: job.description,
    titleIds: ordered.map(entry => entry.title.id),
  };
}

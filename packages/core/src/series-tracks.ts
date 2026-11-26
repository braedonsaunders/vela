// Per-series audio and subtitle track preferences: remembered per viewer and per server, keyed by
// series (show) identity rather than file-specific stream IDs, and matched onto later episodes by
// language, forced/SDH flags and codec family. Pure: no store, no storage, no server writes.
import { languageKey, sameLanguage } from './subtitle-languages';
import type * as V from './wire';

/** Maximum series track entries kept on this device (oldest by `updatedAt` are evicted). */
export const MAX_SERIES_TRACKS = 500;

/** The traits of a viewer's deliberate track pick that travel across episodes of a series. */
export interface SeriesTrackChoice {
  language: string;
  forced?: boolean;
  hearingImpaired?: boolean;
  codecFamily?: string;
}

/**
 * Remembered track choices for one `(serverId, viewerId, showId)`.
 * - `audio`: undefined = unset (use server default); object = preferred audio traits.
 * - `subtitle`: undefined = unset (use server default); null = explicitly Off; object = preferred subtitle traits.
 */
export interface SeriesTrackPreference {
  audio?: SeriesTrackChoice;
  subtitle?: SeriesTrackChoice | null;
  updatedAt: number;
}

export type SeriesTrackMap = Record<string, SeriesTrackPreference>;

/** The matched track IDs that can be applied locally to a plan without writing back to the server. */
export interface SeriesTrackMatch {
  audioTrackId?: string;
  subtitleTrackId?: string | null;
}

const UNMATCHABLE_LANGUAGES = new Set(['', 'und', 'unknown', 'zxx', 'mul']);

const IMAGE_SUBTITLE_CODECS = new Set([
  'pgs', 'hdmv_pgs_subtitle', 'pgssub', 'vobsub', 'dvd_subtitle', 'dvdsub',
  'dvb_subtitle', 'dvbsub', 'xsub', 'bitmap', 'sup',
]);

const TEXT_SUBTITLE_CODECS = new Set([
  'srt', 'subrip', 'ass', 'ssa', 'webvtt', 'vtt', 'mov_text', 'tx3g', 'ttml',
  'eia_608', 'eia_708', 'cea_608', 'cea_708', 'cc', 'text', 'utf8', 'smi', 'sami', 'sub', 'microdvd',
]);

/** Coarse codec family used only as a tiebreaker when multiple tracks share language and flags. */
export function trackCodecFamily(codec: string | undefined, kind: 'audio' | 'subtitle'): string | undefined {
  const raw = (codec ?? '').trim().toLowerCase();
  if (!raw) return undefined;
  if (kind === 'subtitle') {
    if (IMAGE_SUBTITLE_CODECS.has(raw) || raw.includes('pgs') || raw.includes('vobsub') || raw.includes('dvd_sub') || raw.includes('dvb_sub')) {
      return 'image';
    }
    if (TEXT_SUBTITLE_CODECS.has(raw) || raw.includes('vtt') || raw.includes('srt') || raw.includes('ass') || raw.includes('ssa') || raw.includes('subrip') || raw.includes('text')) {
      return 'text';
    }
    return undefined;
  }
  if (raw === 'truehd' || raw.startsWith('truehd') || raw === 'mlp') return 'truehd';
  if (raw === 'eac3' || raw === 'ec-3' || raw === 'ec3' || raw === 'ac3' || raw === 'ac-3' || raw === 'a52' || raw.startsWith('eac3') || raw.startsWith('ac3')) return 'dolby';
  if (raw === 'dts' || raw === 'dca' || raw.startsWith('dts')) return 'dts';
  if (raw === 'aac' || raw.startsWith('aac') || raw.startsWith('mp4a') || raw === 'he-aac') return 'aac';
  if (raw === 'opus' || raw.startsWith('opus')) return 'opus';
  if (raw === 'flac') return 'flac';
  if (raw === 'alac') return 'alac';
  if (raw === 'mp3' || raw === 'mp2' || raw.startsWith('mp3')) return 'mp3';
  if (raw === 'vorbis') return 'vorbis';
  if (raw === 'pcm' || raw === 'lpcm' || raw === 'wav' || raw.startsWith('pcm_')) return 'pcm';
  return undefined;
}

/** Normalized language key, or '' when absent or undetermined (`und`). */
function normalizedLanguage(code: string | undefined): string {
  if (!code) return '';
  const key = languageKey(code);
  const base = key.split('-')[0] ?? '';
  if (UNMATCHABLE_LANGUAGES.has(key) || UNMATCHABLE_LANGUAGES.has(base)) return '';
  return key;
}

/** Extract portable series traits from a track, or null when the track has no matchable language. */
export function trackChoiceOf(track: Pick<V.Track, 'kind' | 'language' | 'codec' | 'forced' | 'hearingImpaired'>): SeriesTrackChoice | null {
  const language = normalizedLanguage(track.language);
  if (!language) return null;
  const family = trackCodecFamily(track.codec, track.kind);
  return {
    language,
    ...(track.forced ? { forced: true } : {}),
    ...(track.hearingImpaired ? { hearingImpaired: true } : {}),
    ...(family ? { codecFamily: family } : {}),
  };
}

/**
 * Match a remembered track choice onto another episode's tracks by language and flags (forced,
 * hearingImpaired), narrowing by exact region and codec family only to break ties. Returns
 * undefined when 0 tracks match or >= 2 remain ambiguous (e.g. main audio + commentary).
 */
export function matchTrack(
  tracks: readonly V.Track[],
  choice: SeriesTrackChoice,
  kind: 'audio' | 'subtitle',
): V.Track | undefined {
  const wanted = normalizedLanguage(choice.language);
  if (!wanted) return undefined;
  const forced = Boolean(choice.forced);
  const sdh = Boolean(choice.hearingImpaired);

  let candidates = tracks.filter(track => {
    const lang = normalizedLanguage(track.language);
    return lang !== ''
      && sameLanguage(lang, wanted)
      && Boolean(track.forced) === forced
      && Boolean(track.hearingImpaired) === sdh;
  });

  if (candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0];

  // Prefer exact region match when it narrows the set.
  const exact = candidates.filter(track => normalizedLanguage(track.language) === wanted);
  if (exact.length === 1) return exact[0];
  if (exact.length > 0 && exact.length < candidates.length) candidates = exact;

  // Tiebreak by codec family only when multiple candidates still share language and flags.
  if (choice.codecFamily) {
    const byFamily = candidates.filter(track => trackCodecFamily(track.codec, kind) === choice.codecFamily);
    if (byFamily.length === 1) return byFamily[0];
  }

  // Ambiguous (e.g. main + commentary with identical language, flags, and family): leave server default.
  return undefined;
}

/** Normalized audio codec token for comparing a track's codec against client declarations. */
function normalizedAudioCodec(codec: string): string {
  const raw = codec.trim().toLowerCase();
  if (raw === 'ac-3' || raw === 'a52') return 'ac3';
  if (raw === 'ec-3' || raw === 'ec3' || raw === 'eac-3' || raw === 'eac3-joc') return 'eac3';
  if (raw.startsWith('mp4a') || raw === 'he-aac' || raw === 'aac_latm') return 'aac';
  if (raw === 'dca' || raw === 'dts-hd' || raw === 'dts-hd ma' || raw === 'dtshd' || raw === 'dtsx' || raw === 'dts-uhd') return 'dts';
  if (raw === 'truehd-atmos' || raw === 'mlp') return 'truehd';
  if (raw === 'lpcm' || raw === 'wav' || raw.startsWith('pcm_')) return 'pcm';
  return raw;
}

function canPlayAudioLocally(
  track: V.Track,
  path: V.PlaybackPath | undefined,
  client: V.ClientCapabilities | undefined,
): boolean {
  if (!path) return false;
  // Separate HLS audio renditions can always be switched locally by the engine.
  if (path.audioRenditions?.some(r => r.trackId === track.id)) return true;
  const direct = path.kind === 'direct' || path.original === true;
  if (!direct) return false;
  if (!client || !track.codec) return true;
  const declared = path.original && client.originalPlayback?.audioDecoders?.length
    ? [...client.originalPlayback.audioDecoders, ...client.audioCodecs]
    : client.audioCodecs;
  if (!declared.length) return true;
  const target = normalizedAudioCodec(track.codec);
  return declared.some(codec => normalizedAudioCodec(codec) === target);
}

/**
 * Resolve which remembered series tracks can be applied locally to `plan` without asking the
 * server to persist or re-transcode. Explicit start choices win over remembered audio; burned-in
 * subtitles or unplayable tracks are skipped for this episode while keeping the preference.
 */
export function matchSeriesTracks(
  plan: V.PlaybackPlan,
  preference: SeriesTrackPreference | undefined,
  options?: { explicitAudio?: boolean; client?: V.ClientCapabilities },
): SeriesTrackMatch {
  if (!preference) return {};
  return playableLocally(plan, {
    ...(!options?.explicitAudio && preference.audio ? { audioTrackId: matchTrack(plan.audioTracks, preference.audio, 'audio')?.id } : {}),
    ...(preference.subtitle === null ? { subtitleTrackId: null }
      : preference.subtitle ? { subtitleTrackId: matchTrack(plan.subtitleTracks, preference.subtitle, 'subtitle')?.id } : {}),
  }, options?.client);
}

/**
 * The tracks of `plan` in `ids` (a subtitle id or null for Off) that the engine can apply to it on
 * its own; the others are left out, so the plan's own selection stands for them.
 */
export function playableLocally(plan: V.PlaybackPlan, ids: SeriesTrackMatch, client?: V.ClientCapabilities): SeriesTrackMatch {
  const path = plan.paths.find(p => p.id === plan.selectedPathId) ?? plan.paths[0];
  const direct = path?.kind === 'direct' || path?.original === true;
  const result: SeriesTrackMatch = {};

  const audio = ids.audioTrackId !== undefined ? plan.audioTracks.find(t => t.id === ids.audioTrackId) : undefined;
  if (audio && canPlayAudioLocally(audio, path, client)) {
    result.audioTrackId = audio.id;
  }

  if (ids.subtitleTrackId !== undefined) {
    const currentSub = plan.selectedSubtitleTrackId
      ? plan.subtitleTracks.find(t => t.id === plan.selectedSubtitleTrackId)
      : undefined;
    const currentlyBurned = !direct && currentSub?.delivery?.kind === 'burn-in';

    if (ids.subtitleTrackId === null) {
      // Explicit Off: apply locally unless the server already burned subtitles into a transcode.
      if (!currentlyBurned) result.subtitleTrackId = null;
    } else {
      const matched = plan.subtitleTracks.find(t => t.id === ids.subtitleTrackId);
      if (matched) {
        const delivery = matched.delivery?.kind;
        const canApply = delivery === 'burn-in'
          ? false
          : delivery === 'external' || Boolean(matched.url)
            ? !currentlyBurned || matched.id === currentSub?.id
            : direct;
        if (canApply) result.subtitleTrackId = matched.id;
      }
    }
  }

  return result;
}

/** Collision-free key for one `(serverId, viewerId, showId)` tuple. */
export function seriesTrackKey(serverId: string, viewerId: string, showId: string): string {
  return JSON.stringify([serverId, viewerId, showId]);
}

export function parseSeriesTrackKey(key: string): { serverId: string; viewerId: string; showId: string } | null {
  try {
    const parsed = JSON.parse(key);
    if (!Array.isArray(parsed) || parsed.length !== 3) return null;
    const [serverId, viewerId, showId] = parsed;
    if (typeof serverId !== 'string' || typeof viewerId !== 'string' || typeof showId !== 'string') return null;
    if (!serverId || !viewerId || !showId) return null;
    return { serverId, viewerId, showId };
  } catch {
    return null;
  }
}

function parseChoice(value: unknown): SeriesTrackChoice | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw.language !== 'string') return undefined;
  const language = normalizedLanguage(raw.language);
  if (!language) return undefined;
  return {
    language,
    ...(raw.forced === true ? { forced: true } : {}),
    ...(raw.hearingImpaired === true ? { hearingImpaired: true } : {}),
    ...(typeof raw.codecFamily === 'string' && raw.codecFamily ? { codecFamily: raw.codecFamily } : {}),
  };
}

/** Trim the map to `max` entries, keeping the most recently updated series. */
export function pruneSeriesTracks(map: SeriesTrackMap, max = MAX_SERIES_TRACKS): SeriesTrackMap {
  const entries = Object.entries(map);
  if (entries.length <= max) return map;
  entries.sort(([, a], [, b]) => b.updatedAt - a.updatedAt);
  return Object.fromEntries(entries.slice(0, max));
}

/** Drop every preference belonging to a removed server. */
export function removeServerSeriesTracks(map: SeriesTrackMap, serverId: string): SeriesTrackMap {
  let changed = false;
  const next: SeriesTrackMap = {};
  for (const [key, value] of Object.entries(map)) {
    const parsed = parseSeriesTrackKey(key);
    if (!parsed || parsed.serverId === serverId) {
      changed = true;
      continue;
    }
    next[key] = value;
  }
  return changed ? next : map;
}

/** Read persisted preferences defensively: malformed entries are dropped and the map is bounded. */
export function storedSeriesTracks(value: unknown): SeriesTrackMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: SeriesTrackMap = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!parseSeriesTrackKey(key)) continue;
    if (!entry || typeof entry !== 'object') continue;
    const raw = entry as Record<string, unknown>;
    const audio = parseChoice(raw.audio);
    const subtitle = raw.subtitle === null ? null : parseChoice(raw.subtitle);
    if (audio === undefined && subtitle === undefined) continue;
    const updatedAt = typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0;
    result[key] = {
      ...(audio !== undefined ? { audio } : {}),
      ...(subtitle !== undefined ? { subtitle } : {}),
      updatedAt,
    };
  }
  return pruneSeriesTracks(result);
}

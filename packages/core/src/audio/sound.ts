// The viewer's sound settings for the audio app: AutoMix (crossfades between songs), loudness
// levelling from the server's measurements (features.loudness) and the equalizer. Each device keeps
// its own: the right EQ for headphones is wrong for a TV's speakers. Everything here is pure; the
// platform engines apply the results (docs/sound.md).
import type * as V from '../wire';
import type { Card } from '../models';

export type LevellingMode = 'off' | 'smart' | 'track' | 'album';
/** Smart picks the transition from each song's ending and the tempo; a number is fixed seconds. */
export type TransitionLength = 'smart' | 3 | 6 | 9 | 12;

export interface SoundSettings {
  automix: {
    on: boolean;
    length: TransitionLength;
    /** An album played in order runs straight on (gapless), as the artist made it. */
    keepAlbumsGapless: boolean;
  };
  levelling: {
    mode: LevellingMode;
    /** Added to every levelled song, dB (-6..+6). */
    preampDb: number;
    /** Never raise a song so far that its peak would clip. */
    preventClipping: boolean;
  };
  eq: {
    on: boolean;
    /** A preset's id, or 'custom' once a band is moved by hand. */
    preset: string;
    /** Gain per band of EQ_BANDS_HZ, dB (-12..+12). */
    bands: number[];
  };
}

export const TRANSITION_LENGTHS: readonly TransitionLength[] = ['smart', 3, 6, 9, 12];
export const LEVELLING_MODES: readonly LevellingMode[] = ['off', 'smart', 'track', 'album'];
export const PREAMP_RANGE_DB = 6;
export const EQ_RANGE_DB = 12;
/** A ten-band graphic equalizer, ISO octave centres. */
export const EQ_BANDS_HZ = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;

const FLAT = EQ_BANDS_HZ.map(() => 0);

/** The presets, in the order they are offered. Gains are gentle on purpose: levelling and clipping
 * protection run before the EQ, so a boost here eats into headroom. */
export const EQ_PRESETS: readonly { id: string; bands: readonly number[]; spoken?: boolean }[] = [
  { id: 'flat', bands: FLAT },
  { id: 'bassBoost', bands: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0] },
  { id: 'bassReducer', bands: [-6, -5, -4, -2, 0, 0, 0, 0, 0, 0] },
  { id: 'trebleBoost', bands: [0, 0, 0, 0, 0, 1, 2, 4, 5, 6] },
  { id: 'vocal', bands: [-2, -2, -1, 0, 2, 4, 4, 2, 0, -1] },
  { id: 'spoken', bands: [-6, -4, -2, 0, 2, 4, 4, 3, 1, -2], spoken: true },
  { id: 'loudness', bands: [5, 4, 1, 0, -1, 0, 0, 1, 3, 4] },
  { id: 'lateNight', bands: [-3, -2, 0, 1, 2, 2, 1, 0, -2, -3] },
  { id: 'rock', bands: [4, 3, 1, -1, -1, 0, 2, 3, 4, 4] },
  { id: 'pop', bands: [-1, 0, 2, 3, 3, 1, 0, 0, 1, 1] },
  { id: 'electronic', bands: [5, 4, 1, 0, -2, 1, 0, 1, 4, 5] },
  { id: 'acoustic', bands: [3, 2, 1, 1, 2, 2, 2, 3, 2, 1] },
  { id: 'jazz', bands: [3, 2, 1, 2, -1, -1, 0, 1, 2, 3] },
  { id: 'classical', bands: [4, 3, 2, 1, 0, 0, 0, 1, 2, 3] },
];

export const DEFAULT_SOUND: SoundSettings = {
  automix: { on: false, length: 'smart', keepAlbumsGapless: true },
  levelling: { mode: 'smart', preampDb: 0, preventClipping: true },
  eq: { on: false, preset: 'flat', bands: [...FLAT] },
};

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Settings read back from storage (any shape, any older version): every field checked, the rest defaults. */
export function soundSettings(raw: unknown): SoundSettings {
  const value = (raw && typeof raw === 'object' ? raw : {}) as { automix?: Partial<SoundSettings['automix']>; levelling?: Partial<SoundSettings['levelling']>; eq?: Partial<SoundSettings['eq']> };
  const automix = value.automix ?? {}, levelling = value.levelling ?? {}, eq = value.eq ?? {};
  const bands = Array.isArray(eq.bands) && eq.bands.length === EQ_BANDS_HZ.length && eq.bands.every(finite)
    ? eq.bands.map(b => clamp(Math.round(b * 2) / 2, -EQ_RANGE_DB, EQ_RANGE_DB)) : [...DEFAULT_SOUND.eq.bands];
  return {
    automix: {
      on: typeof automix.on === 'boolean' ? automix.on : DEFAULT_SOUND.automix.on,
      length: TRANSITION_LENGTHS.includes(automix.length as TransitionLength) ? automix.length as TransitionLength : DEFAULT_SOUND.automix.length,
      keepAlbumsGapless: typeof automix.keepAlbumsGapless === 'boolean' ? automix.keepAlbumsGapless : DEFAULT_SOUND.automix.keepAlbumsGapless,
    },
    levelling: {
      mode: LEVELLING_MODES.includes(levelling.mode as LevellingMode) ? levelling.mode as LevellingMode : DEFAULT_SOUND.levelling.mode,
      preampDb: finite(levelling.preampDb) ? clamp(Math.round(levelling.preampDb), -PREAMP_RANGE_DB, PREAMP_RANGE_DB) : DEFAULT_SOUND.levelling.preampDb,
      preventClipping: typeof levelling.preventClipping === 'boolean' ? levelling.preventClipping : DEFAULT_SOUND.levelling.preventClipping,
    },
    eq: {
      on: typeof eq.on === 'boolean' ? eq.on : DEFAULT_SOUND.eq.on,
      preset: presetOf(bands),
      bands,
    },
  };
}

/** The preset these bands are, or 'custom'. */
export function presetOf(bands: readonly number[]): string {
  return EQ_PRESETS.find(p => p.bands.every((gain, i) => gain === bands[i]))?.id ?? 'custom';
}

/** The settings with one band moved (to the nearest half dB, within range); the preset follows. */
export function withBand(settings: SoundSettings, band: number, gainDb: number): SoundSettings {
  if (band < 0 || band >= EQ_BANDS_HZ.length || !finite(gainDb)) return settings;
  const bands = settings.eq.bands.map((gain, i) => (i === band ? clamp(Math.round(gainDb * 2) / 2, -EQ_RANGE_DB, EQ_RANGE_DB) : gain));
  return { ...settings, eq: { ...settings.eq, on: true, bands, preset: presetOf(bands) } };
}

/** The settings with a preset chosen (and the EQ on). An unknown id changes nothing. */
export function withPreset(settings: SoundSettings, id: string): SoundSettings {
  const preset = EQ_PRESETS.find(p => p.id === id);
  if (!preset) return settings;
  return { ...settings, eq: { on: true, preset: preset.id, bands: [...preset.bands] } };
}

/** A server's loudness value, checked: anything malformed reads as unmeasured. */
export function loudnessOf(raw: unknown): V.Loudness | undefined {
  const value = raw as Partial<V.Loudness> | null | undefined;
  if (!value || typeof value !== 'object' || !finite(value.trackGainDb) || Math.abs(value.trackGainDb) > 60) return undefined;
  const peak = (p: unknown) => (finite(p) && p > 0 && p < 16 ? p : undefined);
  const trim = value.trim && finite(value.trim.startMs) && finite(value.trim.endMs) && value.trim.endMs > value.trim.startMs ? value.trim : undefined;
  return {
    trackGainDb: value.trackGainDb,
    ...(peak(value.trackPeak) ? { trackPeak: value.trackPeak } : {}),
    ...(finite(value.albumGainDb) && Math.abs(value.albumGainDb) <= 60 ? { albumGainDb: value.albumGainDb } : {}),
    ...(peak(value.albumPeak) ? { albumPeak: value.albumPeak } : {}),
    ...(finite(value.lufs) ? { lufs: value.lufs } : {}),
    reference: finite(value.reference) ? value.reference : -18,
    source: value.source === 'provider' ? 'provider' : 'measured',
    ...(trim ? { trim: {
      startMs: trim.startMs, endMs: trim.endMs,
      ...(finite(trim.fadeInEndMs) ? { fadeInEndMs: trim.fadeInEndMs } : {}),
      ...(finite(trim.fadeOutStartMs) ? { fadeOutStartMs: trim.fadeOutStartMs } : {}),
    } } : {}),
  };
}

/** How the queue is being heard: an album straight through, or a mix (shuffle, a playlist, autoplay). */
export interface ListeningContext { albumInOrder: boolean }

/** The queue is an album played in order: its source is the album the item belongs to, not shuffled. */
export function albumInOrder(queue: { shuffle: boolean; source?: { id: string } } | null | undefined, item: Card | undefined): boolean {
  const album = item?.media?.parents.find(p => p.role === 'album');
  return !!queue && !queue.shuffle && !!album && queue.source?.id === album.id;
}

export interface Levelling {
  /** What was applied: the album's gain, the track's, or nothing (off, or unmeasured). */
  applied: 'album' | 'track' | 'none';
  gainDb: number;
  /** The gain as a multiplier for the engine. */
  linear: number;
  /** Clipping protection lowered the gain. */
  limited: boolean;
}

const UNITY: Levelling = { applied: 'none', gainDb: 0, linear: 1, limited: false };

/**
 * The gain for one song. Smart uses the album's gain while an album plays in order (its quiet songs stay
 * quiet) and the track's otherwise; album mode falls back to the track's gain until the album is
 * measured. With clipping protection the gain stops where the peak would pass full scale.
 */
export function levellingGain(loudness: V.Loudness | undefined, settings: SoundSettings['levelling'], context: ListeningContext): Levelling {
  if (settings.mode === 'off' || !loudness) return UNITY;
  const wantAlbum = settings.mode === 'album' || (settings.mode === 'smart' && context.albumInOrder);
  const album = wantAlbum && finite(loudness.albumGainDb);
  const base = album ? loudness.albumGainDb! : loudness.trackGainDb;
  const peak = album ? loudness.albumPeak ?? loudness.trackPeak : loudness.trackPeak;
  let gainDb = base + settings.preampDb;
  let limited = false;
  if (settings.preventClipping && peak && peak > 0) {
    const ceiling = -20 * Math.log10(peak);
    if (gainDb > ceiling) { gainDb = ceiling; limited = true; }
  }
  gainDb = Math.round(gainDb * 100) / 100;
  return { applied: album ? 'album' : 'track', gainDb, linear: 10 ** (gainDb / 20), limited };
}

/** What one song needs to know for the join into the next. */
export interface TransitionSide {
  card: Card;
  durationSeconds: number;
  loudness?: V.Loudness;
}

export type Transition =
  | { kind: 'gapless' }
  /** Start the next song `seconds` before the outgoing one's audible end (`at`, seconds into it), and
   * fade across. `nextFrom` skips the incoming song's leading silence. */
  | { kind: 'crossfade'; seconds: number; at: number; nextFrom: number };

export const MIN_CROSSFADE = 2;
export const MAX_CROSSFADE = 12;
/** Smart's length when nothing is known about the songs' endings. */
const SMART_FALLBACK = 6;

/** Consecutive tracks of one album (the second straight after the first). */
export function sameAlbumRun(from: Card, to: Card): boolean {
  const a = from.media?.parents.find(p => p.role === 'album'), b = to.media?.parents.find(p => p.role === 'album');
  if (!a || !b || a.id !== b.id) return false;
  const disc = (c: Card) => c.media?.disc || 1;
  const index = (c: Card) => c.media?.index ?? 0;
  if (!index(from) || !index(to)) return true;
  return disc(to) === disc(from) ? index(to) === index(from) + 1 : disc(to) === disc(from) + 1 && index(to) === 1;
}

/**
 * How `from` hands over to `to`. Gapless when AutoMix is off, for spoken word, and (by default) between
 * consecutive tracks of an album. Otherwise a crossfade: a fixed length, or Smart's, which spans the
 * outgoing song's own fade-out (the server's fadeOutStartMs) and is held to whole bars when the tempo
 * is known, within 2 to 12 seconds and never more than a third of either song.
 */
export function transitionBetween(from: TransitionSide, to: TransitionSide, settings: SoundSettings['automix']): Transition {
  const spoken = (c: Card) => c.media?.class === 'audiobook' || c.media?.class === 'podcast';
  if (!settings.on || spoken(from.card) || spoken(to.card)) return { kind: 'gapless' };
  if (settings.keepAlbumsGapless && sameAlbumRun(from.card, to.card)) return { kind: 'gapless' };
  const trim = from.loudness?.trim;
  const end = trim && trim.endMs / 1000 <= from.durationSeconds + 0.5 ? trim.endMs / 1000 : from.durationSeconds;
  const nextFrom = to.loudness?.trim ? to.loudness.trim.startMs / 1000 : 0;
  let seconds: number;
  if (settings.length !== 'smart') seconds = settings.length;
  else {
    const fade = trim?.fadeOutStartMs !== undefined && trim.fadeOutStartMs / 1000 < end ? end - trim.fadeOutStartMs / 1000 : undefined;
    seconds = fade ?? SMART_FALLBACK;
    const bpm = from.card.media?.bpm;
    if (bpm && bpm >= 40 && bpm <= 240) {
      const bar = (4 * 60) / bpm;
      seconds = Math.max(1, Math.round(seconds / bar)) * bar;
    }
  }
  const shortest = Math.min(from.durationSeconds, to.durationSeconds || Infinity);
  seconds = Math.min(seconds, MAX_CROSSFADE, shortest / 3);
  if (!(seconds >= MIN_CROSSFADE)) return { kind: 'gapless' };
  seconds = Math.round(seconds * 100) / 100;
  return { kind: 'crossfade', seconds, at: Math.max(0, Math.round((end - seconds) * 100) / 100), nextFrom };
}

import { expect, test } from 'bun:test';
import type { Loudness, Title } from '../src/wire';
import { card } from '../src/discovery/models';
import { createQueue } from '../src/audio/queue';
import {
  albumInOrder, DEFAULT_SOUND, EQ_BANDS_HZ, levellingGain, loudnessOf, presetOf, sameAlbumRun, soundSettings, transitionBetween, withBand, withPreset,
  type SoundSettings,
} from '../src/audio/sound';

const track = (id: string, extra: Partial<NonNullable<Title['media']>> = {}, durationSeconds = 240): Title => ({
  id, kind: 'episode', name: id, summary: '', genres: [], artwork: [], durationSeconds,
  media: { class: 'music', role: 'track', index: 1, parents: [{ id: 'album-1', name: 'Harbour Lights', role: 'album' }, { id: 'artist-1', name: 'The Tides', role: 'artist' }], ...extra },
});
const measured: Loudness = { trackGainDb: -7.9, trackPeak: 0.98, albumGainDb: -8.4, albumPeak: 1, lufs: -10.1, reference: -18, source: 'measured',
  trim: { startMs: 120, endMs: 213_400, fadeInEndMs: 900, fadeOutStartMs: 205_400 } };
const levelling = (patch: Partial<SoundSettings['levelling']> = {}) => ({ ...DEFAULT_SOUND.levelling, ...patch });
const automix = (patch: Partial<SoundSettings['automix']> = {}) => ({ ...DEFAULT_SOUND.automix, on: true, ...patch });

test('stored settings are read field by field: anything malformed or out of range falls back or is clamped', () => {
  expect(soundSettings(null)).toEqual(DEFAULT_SOUND);
  expect(soundSettings('garbage')).toEqual(DEFAULT_SOUND);
  const read = soundSettings({ automix: { on: true, length: 7, keepAlbumsGapless: 'yes' }, levelling: { mode: 'loud', preampDb: 40, preventClipping: false },
    eq: { on: true, preset: 'rock', bands: [20, -20, 1.26, 0, 0, 0, 0, 0, 0, 0] } });
  expect(read.automix).toEqual({ on: true, length: 'smart', keepAlbumsGapless: true });
  expect(read.levelling).toEqual({ mode: 'smart', preampDb: 6, preventClipping: false });
  expect(read.eq.bands.slice(0, 3)).toEqual([12, -12, 1.5]);
  // The preset is worked out from the bands, never trusted from storage.
  expect(read.eq.preset).toBe('custom');
  expect(soundSettings({ eq: { bands: [1, 2, 3] } }).eq.bands).toHaveLength(EQ_BANDS_HZ.length);
});

test('a preset sets its bands and turns the EQ on; moving a band makes it custom, and back again', () => {
  const rock = withPreset(DEFAULT_SOUND, 'rock');
  expect(rock.eq.on).toBe(true);
  expect(rock.eq.preset).toBe('rock');
  const moved = withBand(rock, 0, 2.2);
  expect(moved.eq.bands[0]).toBe(2);
  expect(moved.eq.preset).toBe('custom');
  expect(withBand(moved, 0, 4).eq.preset).toBe('rock');
  expect(withBand(rock, 3, 99).eq.bands[3]).toBe(12);
  expect(withPreset(rock, 'nope')).toBe(rock);
  expect(presetOf(EQ_BANDS_HZ.map(() => 0))).toBe('flat');
});

test('the server loudness is checked: malformed values read as unmeasured, a provider hint stays gain only', () => {
  expect(loudnessOf(undefined)).toBeUndefined();
  expect(loudnessOf({ trackGainDb: 'loud' })).toBeUndefined();
  expect(loudnessOf({ trackGainDb: 400 })).toBeUndefined();
  expect(loudnessOf({ trackGainDb: -12.8, source: 'provider' })).toEqual({ trackGainDb: -12.8, reference: -18, source: 'provider' });
  const kept = loudnessOf({ ...measured, trackPeak: -1, trim: { startMs: 5, endMs: 1 } });
  expect(kept?.trackPeak).toBeUndefined();
  expect(kept?.trim).toBeUndefined();
  expect(loudnessOf(measured)).toEqual(measured);
});

test('the card carries the loudness and the provider tempo from the title', () => {
  const c = card(track('a', { loudness: measured, bpm: 120 }));
  expect(c.media?.loudness).toEqual(measured);
  expect(c.media?.bpm).toBe(120);
  expect(card(track('b', { bpm: 0 })).media?.bpm).toBeUndefined();
});

test('smart levelling uses the album gain for an album in order and the track gain for a mix', () => {
  const album = levellingGain(measured, levelling(), { albumInOrder: true });
  expect(album).toMatchObject({ applied: 'album', gainDb: -8.4 });
  expect(album.linear).toBeCloseTo(10 ** (-8.4 / 20));
  expect(levellingGain(measured, levelling(), { albumInOrder: false })).toMatchObject({ applied: 'track', gainDb: -7.9 });
  expect(levellingGain(measured, levelling({ mode: 'track' }), { albumInOrder: true }).applied).toBe('track');
  // Album mode falls back to the track gain until the whole album is measured.
  expect(levellingGain({ ...measured, albumGainDb: undefined }, levelling({ mode: 'album' }), { albumInOrder: false })).toMatchObject({ applied: 'track', gainDb: -7.9 });
  expect(levellingGain(measured, levelling({ mode: 'off' }), { albumInOrder: true })).toMatchObject({ applied: 'none', linear: 1 });
  expect(levellingGain(undefined, levelling(), { albumInOrder: true })).toMatchObject({ applied: 'none', linear: 1 });
});

test('the pre-amp adds to the gain, and clipping protection stops it at the peak', () => {
  const quiet: Loudness = { trackGainDb: 4, trackPeak: 0.5, reference: -18, source: 'measured' };
  // A peak of 0.5 has 6.02 dB of headroom: +4 +6 would clip, so it stops there.
  const held = levellingGain(quiet, levelling({ mode: 'track', preampDb: 6 }), { albumInOrder: false });
  expect(held.limited).toBe(true);
  expect(held.gainDb).toBeCloseTo(6.02, 2);
  expect(levellingGain(quiet, levelling({ mode: 'track', preampDb: 6, preventClipping: false }), { albumInOrder: false })).toMatchObject({ gainDb: 10, limited: false });
  // A provider hint has no peak, so there is nothing to protect against.
  expect(levellingGain({ trackGainDb: 3, reference: -18, source: 'provider' }, levelling({ mode: 'track', preampDb: 2 }), { albumInOrder: false })).toMatchObject({ gainDb: 5, limited: false });
});

test('an album is in order when the queue plays it unshuffled from that album', () => {
  const items = ['a', 'b'].map(id => card(track(id)));
  expect(albumInOrder(createQueue(items, 0, { source: { id: 'album-1', name: 'Harbour Lights' } }), items[0])).toBe(true);
  expect(albumInOrder(createQueue(items, 0, { source: { id: 'album-1', name: 'Harbour Lights' }, shuffle: true }, () => 0.3), items[0])).toBe(false);
  expect(albumInOrder(createQueue(items, 0, { source: { id: 'playlist-1', name: 'Mix', kind: 'playlist' } }), items[0])).toBe(false);
});

test('consecutive tracks of one album, across a disc change, run straight on', () => {
  const one = card(track('a', { index: 9, disc: 1 })), two = card(track('b', { index: 10, disc: 1 }));
  expect(sameAlbumRun(one, two)).toBe(true);
  expect(sameAlbumRun(two, one)).toBe(false);
  expect(sameAlbumRun(card(track('c', { index: 12, disc: 1 })), card(track('d', { index: 1, disc: 2 })))).toBe(true);
  const elsewhere = card(track('e', { index: 10, parents: [{ id: 'album-2', name: 'Other', role: 'album' }] }));
  expect(sameAlbumRun(one, elsewhere)).toBe(false);
});

test('AutoMix stays gapless when off, for spoken word, and inside an album played in order', () => {
  const a = { card: card(track('a', { index: 1 })), durationSeconds: 240 }, b = { card: card(track('b', { index: 2 })), durationSeconds: 200 };
  expect(transitionBetween(a, b, { ...automix(), on: false })).toEqual({ kind: 'gapless' });
  expect(transitionBetween(a, b, automix())).toEqual({ kind: 'gapless' });
  expect(transitionBetween(a, b, automix({ keepAlbumsGapless: false })).kind).toBe('crossfade');
  const book = { card: card({ ...track('book'), media: { class: 'audiobook', role: 'part' } }), durationSeconds: 3600 };
  expect(transitionBetween(book, b, automix({ keepAlbumsGapless: false }))).toEqual({ kind: 'gapless' });
});

test('smart length spans the outgoing fade-out, held to whole bars, and skips the incoming silence', () => {
  const elsewhere = [{ id: 'album-2', name: 'Other', role: 'album' as const }];
  const from = { card: card(track('a', { loudness: measured })), durationSeconds: 214, loudness: measured };
  const to = { card: card(track('b', { parents: elsewhere })), durationSeconds: 200, loudness: { ...measured, trim: { startMs: 450, endMs: 199_000 } } };
  // The fade-out runs 8 s (205.4 to 213.4), so the blend starts there.
  expect(transitionBetween(from, to, automix())).toEqual({ kind: 'crossfade', seconds: 8, at: 205.4, nextFrom: 0.45 });
  // At 100 bpm a bar is 2.4 s: 8 s becomes three bars.
  const tempo = { ...from, card: card(track('a', { loudness: measured, bpm: 100 })) };
  expect(transitionBetween(tempo, to, automix())).toMatchObject({ seconds: 7.2, at: 206.2 });
  // A fixed length ignores the markers, but still ends at the audible end.
  expect(transitionBetween(from, to, automix({ length: 3 }))).toMatchObject({ seconds: 3, at: 210.4 });
});

test('smart length without markers uses six seconds, never more than a third of a short song, and gives up below two', () => {
  const elsewhere = [{ id: 'album-2', name: 'Other', role: 'album' as const }];
  const from = { card: card(track('a')), durationSeconds: 240 };
  const to = (seconds: number) => ({ card: card(track('b', { parents: elsewhere }, seconds)), durationSeconds: seconds });
  expect(transitionBetween(from, to(200), automix())).toEqual({ kind: 'crossfade', seconds: 6, at: 234, nextFrom: 0 });
  expect(transitionBetween(from, to(12), automix())).toMatchObject({ seconds: 4 });
  expect(transitionBetween(from, to(5), automix())).toEqual({ kind: 'gapless' });
  // A long fade-out is capped at twelve seconds.
  const long = { ...measured, trim: { startMs: 0, endMs: 240_000, fadeOutStartMs: 200_000 } };
  expect(transitionBetween({ ...from, loudness: long }, to(200), automix())).toMatchObject({ seconds: 12, at: 228 });
});

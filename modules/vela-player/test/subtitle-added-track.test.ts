import { expect, test } from 'bun:test';
import { SubtitleSession } from '../web/engine/universal/subtitles/session';

const external = (id: string, url: string) => ({ id, label: id, language: 'nl', delivery: { kind: 'external' as const, format: 'webvtt' as const, url } });
const session = (onTracks: (ids: string[]) => void) => new SubtitleSession({
  surface: {} as HTMLDivElement, source: { url: 'https://media.example/film.mp4', container: 'mp4', sessionId: 's', sourceGeneration: 1, seekGeneration: 1 },
  epoch: 1, clock: () => 0, assetBaseURL: '/', signal: new AbortController().signal,
  describedTracks: [external('sub-en', 'https://media.example/en.vtt')],
  onTracks: tracks => onTracks(tracks.map(track => track.id)),
} as unknown as ConstructorParameters<typeof SubtitleSession>[0]);

test('a subtitle a newer plan adds joins an open overlay without reopening the source', async () => {
  const seen: string[][] = [];
  const overlay = session(ids => seen.push(ids));
  expect((await overlay.discover()).map(track => track.id)).toEqual(['sub-en']);
  expect(overlay.describe([external('sub-en', 'https://media.example/en.vtt'), external('found-nl', 'https://media.example/nl.vtt')])).toBe(true);
  expect(overlay.tracks.map(track => track.id)).toEqual(['sub-en', 'found-nl']);
  expect(seen.at(-1)).toEqual(['sub-en', 'found-nl']);
  // Selection reads the list as it is now, not as it was first discovered.
  expect((await overlay.discover()).map(track => track.id)).toEqual(['sub-en', 'found-nl']);
  // The same plan again changes nothing; embedded entries never join this way.
  expect(overlay.describe([external('found-nl', 'https://media.example/nl.vtt'), { id: 'emb', delivery: { kind: 'embedded' } } as never])).toBe(false);
});

test('a subtitle added while the overlay is still opening is listed when it opens', async () => {
  const overlay = session(() => {});
  overlay.describe([external('found-nl', 'https://media.example/nl.vtt')]);
  expect((await overlay.discover()).map(track => track.id)).toEqual(['sub-en', 'found-nl']);
});

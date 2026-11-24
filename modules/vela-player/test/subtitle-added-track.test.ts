import { expect, test } from 'bun:test';
import { withDescribed } from '../web/engine/universal/subtitles/described';
import type { SubtitleDescription, SubtitleTrack } from '../web/engine/universal/subtitles/types';

const external = (id: string, format: 'webvtt' | 'webvtt-window' = 'webvtt'): SubtitleDescription =>
  ({ id, label: id, language: 'nl', delivery: { kind: 'external', format, url: `https://media.example/${id}.vtt` } }) as SubtitleDescription;
const listed = withDescribed([], [external('sub-en')])!;

test('a subtitle a newer plan adds joins the tracks an open overlay lists', () => {
  const next = withDescribed(listed, [external('sub-en'), external('found-nl')]);
  expect(next?.map((track: SubtitleTrack) => track.id)).toEqual(['sub-en', 'found-nl']);
  expect(next?.[1]).toMatchObject({ serverId: 'found-nl', codec: 'webvtt', language: 'nl', containerTrackId: null });
});

test('the same plan again, or an embedded entry, adds nothing', () => {
  expect(withDescribed(listed, [external('sub-en')])).toBeNull();
  expect(withDescribed(listed, [{ id: 'embedded', delivery: { kind: 'embedded' } } as SubtitleDescription])).toBeNull();
});

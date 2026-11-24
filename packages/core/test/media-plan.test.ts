import { expect, test } from 'bun:test';
import { mediaPlan } from '../src/protocol/media';
import type * as V from '../src/wire';

const origin = 'https://ether.example';
const plan = (delivery: string) => ({ sessionId: 's', paths: [], audioTracks: [], subtitleTracks: [
  { id: 'found', kind: 'subtitle', language: 'nl', name: 'Dutch', codec: 'webvtt', delivery: { kind: 'external', format: 'webvtt', url: delivery } },
] }) as unknown as V.PlaybackPlan;

test('a sidecar delivered by path is made absolute against the server, so native players can fetch it', () => {
  expect(mediaPlan(plan('/sessions/media/s/t/found-subtitles/a.vtt'), origin).subtitleTracks[0]!.delivery)
    .toEqual({ kind: 'external', format: 'webvtt', url: `${origin}/sessions/media/s/t/found-subtitles/a.vtt` });
  // One somewhere else, or carrying credentials, is left exactly as the server sent it.
  expect((mediaPlan(plan('https://cdn.example/a.vtt'), origin).subtitleTracks[0]!.delivery as { url: string }).url).toBe('https://cdn.example/a.vtt');
  expect((mediaPlan(plan('https://u:p@ether.example/a.vtt'), origin).subtitleTracks[0]!.delivery as { url: string }).url).toBe('https://u:p@ether.example/a.vtt');
});

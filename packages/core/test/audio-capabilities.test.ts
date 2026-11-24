import { expect, test } from 'bun:test';
import { Playback, initialPlayback, type PlaybackTarget } from '../src/store/playback';
import { Session } from '../src/store/session';
import { StateBox } from '../src/store/state';
import type { VelaState } from '../src/store';
import type { MediaCapabilities, VelaPlatform } from '../src/store/platform';
import type { ClientCapabilities, PlaybackPlan } from '../src/wire';
import { MemoryStore } from './helpers';

// Music, audiobooks and podcasts play in the app's audio engine, not the video player: their requests
// declare what that engine plays. On a desktop the native video host (Aether: AAC/AC-3/E-AC-3 in MP4)
// is not what plays music, and declaring it made the server transcode every FLAC album.

const videoHost: MediaCapabilities = {
  containers: ['mp4'], videoCodecs: ['h264', 'hevc'], audioCodecs: ['aac', 'ac3', 'eac3'], subtitleFormats: ['webvtt'], hls: true, mse: false,
  hdr: ['hdr10'], originalPlayback: { version: 1 } as never,
};
const audioEngine: MediaCapabilities = {
  containers: ['flac', 'mp4', 'm4a', 'm4b', 'mp3', 'ogg', 'webm', 'wav'], videoCodecs: [], audioCodecs: ['flac', 'aac', 'mp3', 'opus', 'vorbis', 'pcm'],
  subtitleFormats: [], hls: false, mse: false,
};

function platform(audio?: VelaPlatform['audio']): VelaPlatform {
  return { secrets: new MemoryStore(), device: { name: 'Vela for Mac', platform: 'macos' }, appVersion: '0.2.58', media: Promise.resolve(videoHost), audio, artWidth: 1920 };
}

test('an audio session declares the audio engine; everything else the video player', async () => {
  const session = new Session(platform(Promise.resolve(audioEngine)));
  const video = await session.declared();
  expect(video.audioCodecs).toEqual(['aac', 'ac3', 'eac3']);
  const audio = session.audioClient;
  expect(audio.audioCodecs).toContain('flac');
  expect(audio.containers).toContain('flac');
  // Only the engine's own statements: none of the video host's decoders or its original-file route.
  expect(audio.videoCodecs).toEqual([]);
  expect(audio.originalPlayback).toBeUndefined();
  expect(audio.hdr).toBeUndefined();
  expect(audio.device).toEqual(video.device);
  expect(audio.protocolVersions).toEqual(video.protocolVersions);
});

test('without a separate audio engine, or when it cannot say, audio declares the player', async () => {
  for (const audio of [undefined, Promise.reject(new Error('probe failed'))]) {
    const session = new Session(platform(audio));
    const video = await session.declared();
    expect(session.audioClient).toEqual(video);
  }
});

test('the play request carries the declaration of the engine its target names', async () => {
  const requests: { titleId?: string; client: ClientCapabilities }[] = [];
  const plan = (titleId: string) => ({ sessionId: `s-${titleId}`, sourceGeneration: 1, seekGeneration: 1, state: 'ready', titleId, paths: [], audioTracks: [], subtitleTracks: [] }) as unknown as PlaybackPlan;
  const adapter = {
    startPlayback: async (request: { titleId: string; client: ClientCapabilities }) => { requests.push(request); return plan(request.titleId); },
    sessionSnapshot: async (id: string) => ({ plan: plan(id.slice(2)) }), command: async (id: string) => plan(id.slice(2)), reportObservation: async () => ({ ok: true }),
  };
  const audioClient = { device: {}, protocolVersions: [0], ...audioEngine } as ClientCapabilities;
  const videoClient = { device: {}, protocolVersions: [0], ...videoHost } as ClientCapabilities;
  const session = { epoch: 0, features: {}, onReset() {}, ready: async () => ({ adapter, plan: (p: PlaybackPlan) => p }), negotiate: async () => {}, key: () => 'k', client: videoClient, audioClient };
  const box = new StateBox({ playback: initialPlayback } as VelaState);
  const playback = new Playback(box, session as unknown as Session, () => {}, () => {});
  const targets: PlaybackTarget[] = [{ kind: 'title', id: 'track', audio: true }, { kind: 'title', id: 'film' }];
  for (const target of targets) { await playback.start(target); await playback.stop(); }
  await playback.prepare({ kind: 'title', id: 'next-track', audio: true });
  expect(requests.map(request => [request.titleId, request.client.audioCodecs.includes('flac')])).toEqual([['track', true], ['film', false], ['next-track', true]]);
});

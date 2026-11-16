// What this browser can play through the web player, for the client's negotiation request. The
// payload declares what it installed (capabilities.json, written by export-assets.ts); this probe
// keeps only what the browser can run and what playback has qualified. Format support is what the
// browser declares, not a promise of real-time decode.
import type { PlayerCapabilities } from '@vela/player-api';
import type { OriginalPlaybackCapabilities } from '../../../protocol/v0/types';
import { canAttemptOriginal } from './engine/original-support';
import { QUALIFIED_ORIGINAL_AUDIO, QUALIFIED_ORIGINAL_VIDEO } from './engine/universal/qualified';
import { playerAssetBase } from './asset-base';

/** The payload's declaration: installed decoder families and embedded subtitle formats. */
export interface PayloadCapabilities {
  schemaVersion: 1;
  originalPlayback?: OriginalPlaybackCapabilities;
  embeddedSubtitleFormats: string[];
}

const EMBEDDED_SUBTITLES = ['srt', 'webvtt', 'ass', 'ssa', 'pgs', 'tx3g'];
const codecName = /^[a-z0-9_-]{1,40}$/;

const videoFormats: [string, string][] = [
  ['h264', 'video/mp4; codecs="avc1.42E01E"'],
  ['hevc', 'video/mp4; codecs="hvc1.1.6.L93.B0"'],
  ['vp9', 'video/webm; codecs="vp9"'],
  ['av1', 'video/mp4; codecs="av01.0.05M.08"'],
];
const audioFormats: [string, string][] = [
  ['aac', 'audio/mp4; codecs="mp4a.40.2"'],
  ['opus', 'audio/webm; codecs="opus"'],
  ['ac3', 'audio/mp4; codecs="ac-3"'],
  ['eac3', 'audio/mp4; codecs="ec-3"'],
];

function validList(list: unknown): list is string[] {
  return (
    Array.isArray(list) &&
    list.length > 0 &&
    list.length <= 32 &&
    list.every((value) => typeof value === 'string' && codecName.test(value))
  );
}

async function payloadCapabilities(signal: AbortSignal): Promise<PayloadCapabilities | null> {
  const base = playerAssetBase();
  if (!base) return null;
  const response = await fetch(new URL('capabilities.json', base), {
    signal,
    credentials: 'same-origin',
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`Player capabilities HTTP ${response.status}`);
  const value = (await response.json()) as PayloadCapabilities;
  if (value.schemaVersion !== 1 || !Array.isArray(value.embeddedSubtitleFormats)) {
    throw new Error('Invalid player capabilities');
  }
  return value;
}

/** The original-file route, if the payload installed it and this browser can run it. */
async function originalPlayback(
  declaration: OriginalPlaybackCapabilities | undefined,
  signal: AbortSignal,
): Promise<OriginalPlaybackCapabilities | null> {
  if (!declaration || declaration.version !== 1 || declaration.range !== true || declaration.webgpu !== true) {
    return null;
  }
  if (![declaration.demuxContainers, declaration.videoDecoders, declaration.audioDecoders].every(validList)) {
    return null;
  }
  if (!canAttemptOriginal()) return null;
  if (typeof VideoDecoder !== 'function' || typeof AudioContext !== 'function') return null;
  if (typeof AudioWorkletNode !== 'function') return null;
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  const adapter = await gpu?.requestAdapter().catch(() => null);
  signal.throwIfAborted();
  if (!adapter) return null;
  const videoDecoders = declaration.videoDecoders.filter((codec) => QUALIFIED_ORIGINAL_VIDEO.includes(codec));
  if (!videoDecoders.length) return null;
  return {
    ...declaration,
    videoDecoders,
    audioDecoders: declaration.audioDecoders.filter((codec) => QUALIFIED_ORIGINAL_AUDIO.includes(codec)),
  };
}

async function probe(signal: AbortSignal): Promise<PlayerCapabilities> {
  const payload = await payloadCapabilities(signal).catch(() => null);
  const original = await originalPlayback(payload?.originalPlayback, signal);
  const video = document.createElement('video');
  const supports = (mime: string) => video.canPlayType(mime) !== '';
  const managed = (globalThis as typeof globalThis & { ManagedMediaSource?: typeof MediaSource })
    .ManagedMediaSource;
  const mediaSource = managed ?? globalThis.MediaSource;
  const embedded = original
    ? payload!.embeddedSubtitleFormats.filter((format) => EMBEDDED_SUBTITLES.includes(format))
    : [];
  const overlays = payload ? ['webvtt', 'ether-vtt-window', ...embedded] : [];
  return {
    ...(original ? { originalPlayback: original } : {}),
    containers: ['mp4', 'webm'].filter((container) => supports(`video/${container}`)),
    videoCodecs: videoFormats.filter(([name, mime]) => name === 'h264' && supports(mime)).map(([name]) => name),
    audioCodecs: audioFormats.filter(([, mime]) => supports(mime)).map(([name]) => name),
    subtitleFormats: [...new Set([...(typeof VTTCue === 'function' ? ['webvtt'] : []), ...overlays])],
    hls: supports('application/vnd.apple.mpegurl'),
    mse: !!mediaSource && videoFormats.some(([, mime]) => mediaSource.isTypeSupported(mime)),
  };
}

let probed: Promise<PlayerCapabilities> | undefined;

/** The page's capabilities, probed once; a failed probe is retried by the next caller. */
export function playerCapabilities(): Promise<PlayerCapabilities> {
  probed ??= probe(AbortSignal.timeout(12000)).catch((error) => {
    probed = undefined;
    throw error;
  });
  return probed;
}

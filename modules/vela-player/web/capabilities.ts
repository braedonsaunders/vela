// What this browser can play through the web player, for the client's negotiation request. The
// payload declares what it installed (capabilities.json, written by export-assets.ts); this probe
// keeps only what the browser can run and what playback has qualified. Format support is what the
// browser declares, not a promise of real-time decode.
import type { PlayerCapabilities } from '@vela/player-api';
import type { OriginalPlaybackCapabilities } from '../../../packages/protocol/types';
import { canAttemptOriginal } from './engine/original-support';
import { abortable } from './engine/core/async';
import {
  QUALIFIED_CHROMIUM_PACKAGE_VIDEO,
  QUALIFIED_ORIGINAL_AUDIO,
  QUALIFIED_ORIGINAL_VIDEO,
} from './engine/universal/qualified';
import { playerAssetBase } from './asset-base';
import { audioOutputCapabilities } from './audio-output';

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
  // Music and audiobooks play these directly in the browser's own <audio> element.
  ['flac', 'audio/flac'],
  ['mp3', 'audio/mpeg'],
  ['vorbis', 'audio/ogg; codecs="vorbis"'],
  ['alac', 'audio/mp4; codecs="alac"'],
  ['pcm', 'audio/wav; codecs="1"'],
];
/** Audio-only files the browser opens itself (m4a and m4b are mp4). */
const audioContainers: [string, string][] = [
  ['flac', 'audio/flac'],
  ['mp3', 'audio/mpeg'],
  ['ogg', 'audio/ogg'],
  ['wav', 'audio/wav'],
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

/** Codecs a browser may decode only in software, listed only when a hardware decoder takes a 4K
 * stream: the server then sends the original rather than relying on a software decoder that may
 * not keep up. H.264 and HEVC keep their existing routes (HEVC has the WebGPU package). */
const HARDWARE_PROBES: Record<string, string> = { av1: 'av01.0.12M.10', vp9: 'vp09.00.50.08' };
async function decodesInRealTime(codec: string): Promise<boolean> {
  const probe = HARDWARE_PROBES[codec];
  if (!probe) return true;
  try {
    const support = await abortable(
      VideoDecoder.isConfigSupported({ codec: probe, codedWidth: 3840, codedHeight: 2160, hardwareAcceleration: 'prefer-hardware' }),
      AbortSignal.timeout(1500),
    );
    return support.supported === true;
  } catch {
    return false;
  }
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
  // A stalled GPU process must not hold playback negotiation indefinitely.
  const adapter = await abortable(gpu?.requestAdapter(), AbortSignal.timeout(2000)).catch(() => null);
  signal.throwIfAborted();
  if (!adapter) return null;
  const brands = (navigator as Navigator & { userAgentData?: { brands?: { brand: string }[] } }).userAgentData?.brands;
  const chromium = !!brands?.some((entry) => entry.brand === 'Chromium');
  const qualified = declaration.videoDecoders.filter(
    (codec) => QUALIFIED_ORIGINAL_VIDEO.includes(codec) || (chromium && QUALIFIED_CHROMIUM_PACKAGE_VIDEO.includes(codec)),
  );
  const realTime = await Promise.all(qualified.map((codec) => decodesInRealTime(codec)));
  signal.throwIfAborted();
  const videoDecoders = qualified.filter((_, index) => realTime[index]);
  if (!videoDecoders.length) return null;
  return {
    ...declaration,
    videoDecoders,
    audioDecoders: declaration.audioDecoders.filter((codec) => QUALIFIED_ORIGINAL_AUDIO.includes(codec)),
  };
}

async function destinationChannels(): Promise<number | null> {
  if (typeof AudioContext !== 'function') return null;
  // A suspended context needs no user activation and reports the current output device.
  const context = new AudioContext({ latencyHint: 'playback' });
  try {
    const count = context.destination.maxChannelCount;
    return Number.isSafeInteger(count) && count > 0 ? count : null;
  } finally {
    void context.close().catch(() => {});
  }
}

async function probe(signal: AbortSignal): Promise<PlayerCapabilities> {
  const payload = await payloadCapabilities(signal).catch(() => null);
  const original = await originalPlayback(payload?.originalPlayback, signal);
  const channels = original ? await destinationChannels().catch(() => null) : null;
  const video = document.createElement('video');
  const supports = (mime: string) => video.canPlayType(mime) !== '';
  const managed = (globalThis as typeof globalThis & { ManagedMediaSource?: typeof MediaSource })
    .ManagedMediaSource;
  const mediaSource = managed ?? globalThis.MediaSource;
  // VobSub is decoded by the app's own code (subtitles/vobsub.ts), not a payload library.
  const embedded = original
    ? [...payload!.embeddedSubtitleFormats.filter((format) => EMBEDDED_SUBTITLES.includes(format)), 'vobsub']
    : [];
  const overlays = payload ? ['webvtt', 'ether-vtt-window', ...embedded] : [];
  return {
    ...(original ? { originalPlayback: original, audioOutput: audioOutputCapabilities(channels) } : {}),
    containers: [
      ...['mp4', 'webm'].filter((container) => supports(`video/${container}`)),
      ...audioContainers.filter(([, mime]) => supports(mime)).map(([name]) => name),
    ],
    videoCodecs: videoFormats.filter(([name, mime]) => name === 'h264' && supports(mime)).map(([name]) => name),
    audioCodecs: audioFormats.filter(([, mime]) => supports(mime)).map(([name]) => name),
    subtitleFormats: [...new Set([...(typeof VTTCue === 'function' ? ['webvtt'] : []), ...overlays])],
    // The web engine does not probe or negotiate Dolby Vision output.
    dolbyVisionProfiles: [],
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

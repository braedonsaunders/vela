import type { VideoInfo } from '../video-info';
import { abortable } from '../core/async';
import { playbackMark } from '../timing';
import { QUALIFIED_ORIGINAL_VIDEO, QUALIFIED_ORIGINAL_AUDIO } from './qualified';
import type { ClientCapabilities } from '../../../../../client/wire/v0/types';
import type { DecoderRetry } from './retry';
import type { OriginalMedia } from './source';
import type { ByteReader } from '../core/types';
import type { SubtitleSession, SubtitleSessionOptions } from './subtitles/session';
import type { Track } from '../model';
import type { MediaRequestPolicy } from '../media-auth';
import type { BrowserRuntimeServices } from '../host/services';
import { canAttemptOriginal } from '../original-support';
export interface UniversalReadout {
  state: 'loading' | 'playing' | 'paused' | 'buffering' | 'ended' | 'failed';
  video?: VideoInfo | null;
  readAheadSeconds?: number | null;
  bufferAheadSeconds?: number | null;
  throughputBps?: number | null;
  throughputHistory?: number[];
  position: number;
  duration: number | null;
  frames: number;
  dropped: number;
  audioTrackId: string | null;
  metadataDiscrepancies: string[];
  presentedFrames: number;
  decoderReady: boolean;
}
export interface OriginalBackend {
  readonly implementation?: 'vela-core' | 'upstream-controller';
  readonly retainsSource?: boolean;
  /** The Vela core owns progress-based startup and its hard admission ceiling. */
  readonly startupPending?: boolean;
  readonly live?: {
    startSeconds: number;
    edgeSeconds: number;
    segmentSeconds: number;
    ended: boolean;
    retries: number;
    retrying: boolean;
    delivery: 'upstream-gap' | 'segment-delayed' | 'waiting-for-publication' | 'available';
  };
  setLiveTarget?(seconds: number, rate: number): void;
  readonly supportsLocalAudioSwitch?: boolean;
  readonly supportsSubtitles?: boolean;
  readonly byteReader?: ByteReader;
  readonly subtitleClusters?: import('./subtitles/types').SubtitleClusterStream;
  readonly sourceContainer?: string;
  readonly videoSize?: { width: number; height: number };
  position: number;
  readout: UniversalReadout;
  open(media: OriginalMedia): Promise<void>;
  pause(): void;
  resume(): void;
  setVolume(volume: number): void;
  setMuted(muted: boolean): void;
  readonly audioTrackIds: string[];
  readonly pendingAudioTrackId: string | null;
  readonly audioTracks?: Track[];
  selectAudio(trackId: string): Promise<void>;
  /** Optional for compatibility with an already-installed immutable payload. */
  setSpeed?(value: number): Promise<void>;
  seek(position: number): Promise<void>;
  dispose(): Promise<void>;
}
export interface OriginalRuntimeOptions {
  mediaRequests?: MediaRequestPolicy;
  surface: { container: HTMLDivElement; video: HTMLVideoElement };
  assets: {
    baseURL: string;
    assetKey: string;
    audioDecoderURL: string;
    videoDecoderURL: string;
    subtitleBaseURL?: string;
  };
  retry?: DecoderRetry;
  signal: AbortSignal;
  onEvent: (event: { type: string }) => void;
  onFailure: (reason: string, position: number, transport?: { httpStatus: number | null }) => void;
}
/** Production shares an immutable payload across skin engines. Only an absent
 * descriptor uses diagnostic-relative assets; invalid explicit bases fail closed. */
function assetLocation(): { base: URL; assetKey?: string } {
  const descriptor = (window as Window & { velaUniversalAssets?: unknown }).velaUniversalAssets;
  if (descriptor === undefined) return { base: new URL('./universal', import.meta.url) };
  if (!descriptor || typeof descriptor !== 'object')
    throw new Error('Invalid shared original runtime descriptor');
  const { baseURL, assetKey } = descriptor as { baseURL?: unknown; assetKey?: unknown };
  if (typeof baseURL !== 'string' || typeof assetKey !== 'string' || !/^[a-f0-9]{16}$/.test(assetKey))
    throw new Error('Invalid shared original runtime identity');
  const base = new URL(baseURL, location.origin);
  if (
    base.origin !== location.origin ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    base.pathname !== `/vela/universal/${assetKey}/`
  )
    throw new Error('Original runtime assets must use the same-origin immutable base');
  return { base, assetKey };
}
export { canAttemptOriginal };

/** The Exact host's runtime services: the payload's runtime.js, loaded by URL. The Expo web app
 * bundles the core instead (host/bundled-runtime.ts); this goes with the Exact app. */
export const loadedRuntimeServices: BrowserRuntimeServices = {
  get hls() {
    return hasCoreHls();
  },
  get live() {
    return hasCoreLive();
  },
  create: loadOriginalRuntime,
  createSubtitles: loadSubtitleSession,
};
export async function loadOriginalRuntime(
  options: Omit<OriginalRuntimeOptions, 'assets'>,
): Promise<OriginalBackend> {
  if (!canAttemptOriginal())
    throw new Error('Secure WebGPU, workers and VideoFrame are required for original playback');
  const { module, assets } = await loadRuntimeModule(options.signal);
  return new module.UniversalRuntime({ ...options, assets });
}
interface RuntimeManifest {
  version: number;
  assetKey: string;
  upstreamRevision: string;
  originalPlayback?: ClientCapabilities['originalPlayback'];
  subtitleAssets?: { assetKey: string; directory: string };
  originalSubtitleFormats?: unknown;
  core?: { version: 1; vodHls: boolean; liveHls?: boolean };
}
const manifests = new Map<string, Promise<RuntimeManifest>>();
const resolvedManifests = new Map<string, RuntimeManifest>();
/** Only an explicitly prepared migration payload enables this route. */
export function hasCoreHls() {
  return (
    canAttemptOriginal() &&
    resolvedManifests.get(capabilityIdentity())?.core?.version === 1 &&
    resolvedManifests.get(capabilityIdentity())?.core?.vodHls === true
  );
}
export function hasCoreLive() {
  return hasCoreHls() && resolvedManifests.get(capabilityIdentity())?.core?.liveHls === true;
}
/** Identity changes invalidate the page-local capability snapshot. */
export function capabilityIdentity() {
  const { base, assetKey } = assetLocation();
  return `${base.href}#${assetKey ?? ''}`;
}
function runtimeManifest(signal: AbortSignal): Promise<RuntimeManifest> {
  const { base, assetKey } = assetLocation(),
    key = capabilityIdentity();
  let pending = manifests.get(key);
  if (!pending) {
    playbackMark('assets:start');
    const load = (async () => {
      const response = await fetch(new URL('assets.json', base), {
        signal: AbortSignal.timeout(10000),
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error(`Original runtime assets HTTP ${response.status}`);
      const manifest = (await response.json()) as RuntimeManifest;
      if (
        manifest.version !== 1 ||
        (assetKey !== undefined && manifest.assetKey !== assetKey) ||
        !/^[a-f0-9]{16}$/.test(manifest.assetKey) ||
        manifest.upstreamRevision !== 'a7a95ef26bd0a71f5ee12f863b8ffb2cfbc3c9d2'
      )
        throw new Error('Original runtime asset identity mismatch');
      if (
        manifest.subtitleAssets &&
        (!/^[a-f0-9]{16}$/.test(manifest.subtitleAssets.assetKey) ||
          manifest.subtitleAssets.directory !== 'libraries/subtitles/')
      )
        throw new Error('Invalid subtitle asset identity');
      resolvedManifests.set(key, manifest);
      if (resolvedManifests.size > 2) resolvedManifests.delete(resolvedManifests.keys().next().value!);
      playbackMark('assets:ready');
      return Object.freeze(manifest);
    })();
    pending = load.catch((error) => {
      if (manifests.get(key) === pending) manifests.delete(key);
      throw error;
    });
    manifests.set(key, pending);
    // An aborted view may detach while its immutable shared fetch settles.
    void pending.catch(() => {});
    if (manifests.size > 2) manifests.delete(manifests.keys().next().value!);
  }
  return abortable(pending, signal);
}
async function loadRuntimeModule(signal: AbortSignal) {
  const { base } = assetLocation();
  const manifest = await runtimeManifest(signal);
  signal.throwIfAborted();
  playbackMark('runtime:start');
  const moduleURL = new URL('runtime.js', base);
  moduleURL.searchParams.set('v', manifest.assetKey);
  const module = (await import(moduleURL.href)) as {
    UniversalRuntime: new (options: OriginalRuntimeOptions) => OriginalBackend;
    SubtitleSession?: new (options: SubtitleSessionOptions) => SubtitleSession;
    warmup?: (options: Pick<OriginalRuntimeOptions, 'assets' | 'signal'>) => Promise<boolean | undefined>;
  };
  signal.throwIfAborted();
  playbackMark('runtime:ready');
  const subtitles = manifest.subtitleAssets;
  if (
    subtitles &&
    (!/^[a-f0-9]{16}$/.test(subtitles.assetKey) || subtitles.directory !== 'libraries/subtitles/')
  )
    throw new Error('Invalid subtitle asset identity');
  return {
    module,
    assets: {
      baseURL: new URL('libraries/', base).href,
      assetKey: manifest.assetKey,
      audioDecoderURL: new URL('libraries/audio-decoders/', base).href,
      videoDecoderURL: new URL('libraries/video-decoders/', base).href,
      subtitleBaseURL: subtitles ? new URL(subtitles.directory, base).href : undefined,
    },
  };
}

export async function loadSubtitleSession(
  options: Omit<SubtitleSessionOptions, 'assetBaseURL'>,
): Promise<SubtitleSession> {
  const { module, assets } = await loadRuntimeModule(options.signal);
  if (!module.SubtitleSession || !assets.subtitleBaseURL)
    throw new Error('Subtitle overlay assets are not installed');
  options.signal.throwIfAborted();
  return new module.SubtitleSession({ ...options, assetBaseURL: assets.subtitleBaseURL });
}

/** Embedded families are advertised only by a core payload with installed assets. */
export async function subtitleCapabilities(signal: AbortSignal, original: boolean): Promise<string[]> {
  const value = await runtimeManifest(signal);
  if (!value.subtitleAssets) return [];
  const embedded =
    original && Array.isArray(value.originalSubtitleFormats)
      ? value.originalSubtitleFormats.filter(
          (format): format is string =>
            typeof format === 'string' && ['srt', 'webvtt', 'ass', 'ssa', 'pgs', 'tx3g'].includes(format),
        )
      : [];
  return [...new Set(['webvtt', 'ether-vtt-window', ...embedded])];
}

/** The build describes only separately installed decoder families. Exact source
 * profiles/layouts still go through runtime admission and bounded fallback. */
export async function originalPlaybackCapabilities(
  signal: AbortSignal,
): Promise<ClientCapabilities['originalPlayback'] | null> {
  if (!canAttemptOriginal()) return null;
  const adapterSignal = AbortSignal.timeout(2000);
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  // Fetch the immutable declaration while the browser resolves its GPU adapter.
  // Caller cancellation detaches; it never cancels another view's shared probe.
  const [adapter, manifest] = await abortable(
    Promise.all([abortable(gpu?.requestAdapter(), adapterSignal).catch(() => null), runtimeManifest(signal)]),
    signal,
  );
  if (!adapter) return null;
  const declaration = manifest.originalPlayback;
  if (!declaration || declaration.version !== 1 || declaration.range !== true || declaration.webgpu !== true)
    return null;
  for (const list of [declaration.demuxContainers, declaration.videoDecoders, declaration.audioDecoders])
    if (
      !Array.isArray(list) ||
      !list.length ||
      list.length > 32 ||
      list.some((value) => typeof value !== 'string' || !/^[a-z0-9_-]{1,40}$/.test(value))
    )
      return null;
  // The common H.264 route requires WebCodecs; HEVC exact configurations can
  // instead select the separately installed package after native probing.
  if (
    typeof VideoDecoder !== 'function' ||
    typeof AudioContext !== 'function' ||
    typeof AudioWorkletNode !== 'function'
  )
    return null;
  const videoDecoders = declaration.videoDecoders.filter((codec) => QUALIFIED_ORIGINAL_VIDEO.includes(codec));
  if (!videoDecoders.length) return null;
  return {
    ...declaration,
    videoDecoders,
    audioDecoders: declaration.audioDecoders.filter((codec) => QUALIFIED_ORIGINAL_AUDIO.includes(codec)),
  };
}

/** Warm only a verified core payload, after first paint or a title hover/focus.
 * This issues no playback, source, grant or auth request. The current wrapper
 * payload has no core flag, so an installed wrapper does no extra runtime work. */
export function mountCoreWarmup(signal: AbortSignal): () => void {
  let phase = new AbortController(),
    pending = false,
    last = -Infinity,
    frame: number | undefined,
    idle: number | undefined;
  const stopped = () =>
    signal.aborted ||
    !canAttemptOriginal() ||
    document.hidden ||
    (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
  const run = () => {
    idle = undefined;
    if (stopped() || pending) return;
    pending = true;
    last = performance.now();
    const active = phase;
    void (async () => {
      const manifest = await runtimeManifest(active.signal);
      if (manifest.core?.version !== 1) return;
      const { module, assets } = await loadRuntimeModule(active.signal);
      active.signal.throwIfAborted();
      if (!module.warmup) return;
      playbackMark('warmup:start');
      const ready = await module.warmup({ assets, signal: active.signal });
      active.signal.throwIfAborted();
      playbackMark(ready === undefined ? 'warmup:skipped' : ready ? 'warmup:ready' : 'warmup:failed');
    })()
      .catch(() => {
        if (!active.signal.aborted) playbackMark('warmup:failed');
      })
      .finally(() => {
        pending = false;
        if (active !== phase && !stopped()) queue();
      });
  };
  const queue = () => {
    if (stopped() || pending || frame !== undefined || idle !== undefined || performance.now() - last < 5000)
      return;
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        frame = undefined;
        idle =
          typeof requestIdleCallback === 'function'
            ? requestIdleCallback(run, { timeout: 1000 })
            : window.setTimeout(run, 0);
      });
    });
  };
  const intent = (event: Event) => {
    const target = event
      .composedPath()
      .find((node) => node instanceof HTMLElement && node.hasAttribute('data-testid')) as
      | HTMLElement
      | undefined;
    const id = target?.getAttribute('data-testid') ?? '';
    if (!id.startsWith('player-') && /card|detail|hero-primary|play/.test(id)) queue();
  };
  const cancelSchedule = () => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
    if (idle !== undefined) {
      if (typeof cancelIdleCallback === 'function') cancelIdleCallback(idle);
      clearTimeout(idle);
    }
    idle = undefined;
  };
  const visible = () => {
    if (document.hidden) {
      cancelSchedule();
      phase.abort();
      phase = new AbortController();
      last = -Infinity;
    } else queue();
  };
  const release = () => {
    cancelSchedule();
    phase.abort();
    document.removeEventListener('pointerover', intent);
    document.removeEventListener('focusin', intent);
    document.removeEventListener('visibilitychange', visible);
    signal.removeEventListener('abort', release);
  };
  signal.addEventListener('abort', release, { once: true });
  document.addEventListener('pointerover', intent, { passive: true });
  document.addEventListener('focusin', intent);
  document.addEventListener('visibilitychange', visible);
  queue();
  return release;
}

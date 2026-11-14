import type { ClientCapabilities } from '../../wire/v0/types';
import type { DecoderRetry } from './retry';
import type { OriginalMedia } from './source';
export interface UniversalReadout {
  state: 'loading' | 'playing' | 'paused' | 'buffering' | 'ended' | 'failed';
  position: number; duration: number | null; frames: number; dropped: number;
}
export interface OriginalBackend {
  position: number; readout: UniversalReadout;
  open(media: OriginalMedia): Promise<void>; pause(): void; resume(): void;
  setVolume(volume: number): void; setMuted(muted: boolean): void;
  readonly audioTrackIds: string[]; readonly pendingAudioTrackId: string | null;
  selectAudio(trackId: string): Promise<void>;
  seek(position: number): Promise<void>; dispose(): Promise<void>;
}
export interface OriginalRuntimeOptions {
  surface: {container: HTMLDivElement; video: HTMLVideoElement};
  assets: {baseURL: string; assetKey: string; audioDecoderURL: string; videoDecoderURL: string};
  retry?: DecoderRetry;
  signal: AbortSignal; onEvent: (event: {type: string}) => void;
  onFailure: (reason: string, position: number) => void;
}
export function canAttemptOriginal() { return isSecureContext && !!(navigator as Navigator & {gpu?: unknown}).gpu && typeof VideoFrame === 'function' && typeof Worker === 'function'; }
export async function loadOriginalRuntime(options: Omit<OriginalRuntimeOptions, 'assets'>): Promise<OriginalBackend> {
  if (!canAttemptOriginal()) throw new Error('Secure WebGPU, workers and VideoFrame are required for original playback');
  const base = new URL('./universal/', import.meta.url);
  const response = await fetch(new URL('assets.json', base), {signal: AbortSignal.any([options.signal, AbortSignal.timeout(10000)]), credentials:'same-origin'});
  if (!response.ok) throw new Error(`Original runtime assets HTTP ${response.status}`);
  const manifest = await response.json() as {version: number; assetKey: string; upstreamRevision: string};
  if (manifest.version !== 1 || !/^[a-f0-9]{16}$/.test(manifest.assetKey) || manifest.upstreamRevision !== 'a7a95ef26bd0a71f5ee12f863b8ffb2cfbc3c9d2') throw new Error('Original runtime asset identity mismatch');
  options.signal.throwIfAborted();
  const moduleURL = new URL('runtime.js', base); moduleURL.searchParams.set('v', manifest.assetKey);
  const module = await import(moduleURL.href) as {UniversalRuntime: new (options: OriginalRuntimeOptions) => OriginalBackend};
  options.signal.throwIfAborted();
  return new module.UniversalRuntime({...options, assets: {baseURL: new URL('libraries/',base).href, assetKey: manifest.assetKey, audioDecoderURL: new URL('libraries/audio-decoders/',base).href, videoDecoderURL: new URL('libraries/video-decoders/',base).href}});
}

/** The build describes only separately installed decoder families. Exact source
 * profiles/layouts still go through runtime admission and bounded fallback. */
export async function originalPlaybackCapabilities(signal: AbortSignal): Promise<ClientCapabilities['originalPlayback'] | null> {
  if (!canAttemptOriginal()) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const gpu = (navigator as Navigator & {gpu?: {requestAdapter(): Promise<unknown>}}).gpu;
    const adapter = await Promise.race([gpu?.requestAdapter(), new Promise<null>(resolve => { timer=setTimeout(() => resolve(null),2000); })]);
    if (!adapter) return null;
  } finally { if (timer) clearTimeout(timer); }
  signal.throwIfAborted();
  const response = await fetch(new URL('./universal/assets.json',import.meta.url),
    {credentials:'same-origin',signal:AbortSignal.any([signal,AbortSignal.timeout(10000)])});
  if (!response.ok) return null;
  const manifest = await response.json() as {version?:number;assetKey?:string;upstreamRevision?:string;originalPlayback?:ClientCapabilities['originalPlayback']};
  if (manifest.version !== 1 || !/^[a-f0-9]{16}$/.test(manifest.assetKey ?? '') ||
      manifest.upstreamRevision !== 'a7a95ef26bd0a71f5ee12f863b8ffb2cfbc3c9d2') return null;
  const declaration = manifest.originalPlayback;
  if (!declaration || declaration.version !== 1 || declaration.range !== true || declaration.webgpu !== true) return null;
  for (const list of [declaration.demuxContainers,declaration.videoDecoders,declaration.audioDecoders])
    if (!Array.isArray(list) || !list.length || list.length>32 || list.some(value => typeof value !== 'string' || !/^[a-z0-9_-]{1,40}$/.test(value))) return null;
  // Native codec APIs are optional only when an installed package supplies that
  // family. Current beta admission requires WebCodecs for the common video path.
  if (typeof VideoDecoder !== 'function' || typeof AudioContext !== 'function' || typeof AudioWorkletNode !== 'function') return null;
  return declaration;
}

import { QUALIFIED_ORIGINAL_VIDEO, QUALIFIED_ORIGINAL_AUDIO } from './qualified';
import type { ClientCapabilities } from '../../wire/v0/types';
import type { DecoderRetry } from './retry';
import type { OriginalMedia } from './source';
import type { ByteReader } from '../core/types';
import type { SubtitleSession,SubtitleSessionOptions } from './subtitles/session';
import type {Track} from '../model';
export interface UniversalReadout {
  state: 'loading' | 'playing' | 'paused' | 'buffering' | 'ended' | 'failed';
  position: number; duration: number | null; frames: number; dropped: number; audioTrackId: string | null; metadataDiscrepancies: string[]; presentedFrames: number; decoderReady: boolean;
}
export interface OriginalBackend {
  readonly retainsSource?: boolean;
  readonly supportsSubtitles?: boolean;
  readonly byteReader?: ByteReader;
  readonly sourceContainer?: string;
  readonly videoSize?: {width:number;height:number};
  position: number; readout: UniversalReadout;
  open(media: OriginalMedia): Promise<void>; pause(): void; resume(): void;
  setVolume(volume: number): void; setMuted(muted: boolean): void;
  readonly audioTrackIds: string[]; readonly pendingAudioTrackId: string | null;
  readonly audioTracks?:Track[];
  selectAudio(trackId: string): Promise<void>;
  /** Optional for compatibility with an already-installed immutable payload. */
  setSpeed?(value: number): Promise<void>;
  seek(position: number): Promise<void>; dispose(): Promise<void>;
}
export interface OriginalRuntimeOptions {
  surface: {container: HTMLDivElement; video: HTMLVideoElement};
  assets: {baseURL: string; assetKey: string; audioDecoderURL: string; videoDecoderURL: string; subtitleBaseURL?:string};
  retry?: DecoderRetry;
  signal: AbortSignal; onEvent: (event: {type: string}) => void;
  onFailure: (reason: string, position: number) => void;
}
/** Production shares an immutable payload across skin engines. Only an absent
 * descriptor uses diagnostic-relative assets; invalid explicit bases fail closed. */
function assetLocation(): {base: URL; assetKey?: string} {
  const descriptor = (window as Window & {velaUniversalAssets?:unknown}).velaUniversalAssets;
  if (descriptor === undefined) return {base:new URL('./universal/',import.meta.url)};
  if (!descriptor || typeof descriptor !== 'object') throw new Error('Invalid shared original runtime descriptor');
  const {baseURL,assetKey} = descriptor as {baseURL?:unknown;assetKey?:unknown};
  if (typeof baseURL !== 'string' || typeof assetKey !== 'string' || !/^[a-f0-9]{16}$/.test(assetKey)) throw new Error('Invalid shared original runtime identity');
  const base = new URL(baseURL,location.origin);
  if (base.origin !== location.origin || base.username || base.password || base.search || base.hash || base.pathname !== `/vela/universal/${assetKey}/`)
    throw new Error('Original runtime assets must use the same-origin immutable base');
  return {base,assetKey};
}
export function canAttemptOriginal() { return isSecureContext && !!(navigator as Navigator & {gpu?: unknown}).gpu && typeof VideoFrame === 'function' && typeof Worker === 'function'; }
export async function loadOriginalRuntime(options: Omit<OriginalRuntimeOptions, 'assets'>): Promise<OriginalBackend> {
  if (!canAttemptOriginal()) throw new Error('Secure WebGPU, workers and VideoFrame are required for original playback');
  const {module,assets}=await loadRuntimeModule(options.signal);
  return new module.UniversalRuntime({...options,assets});
}
async function loadRuntimeModule(signal:AbortSignal){
  const {base,assetKey} = assetLocation();
  const response = await fetch(new URL('assets.json', base), {signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]), credentials:'same-origin'});
  if (!response.ok) throw new Error(`Original runtime assets HTTP ${response.status}`);
  const manifest = await response.json() as {version: number; assetKey: string; upstreamRevision: string;subtitleAssets?:{assetKey:string;directory:string}};
  if (manifest.version !== 1 || assetKey !== undefined && manifest.assetKey !== assetKey || !/^[a-f0-9]{16}$/.test(manifest.assetKey) || manifest.upstreamRevision !== 'a7a95ef26bd0a71f5ee12f863b8ffb2cfbc3c9d2') throw new Error('Original runtime asset identity mismatch');
  signal.throwIfAborted();
  const moduleURL = new URL('runtime.js', base); moduleURL.searchParams.set('v', manifest.assetKey);
  const module = await import(moduleURL.href) as {UniversalRuntime: new (options: OriginalRuntimeOptions) => OriginalBackend;SubtitleSession?:new(options:SubtitleSessionOptions)=>SubtitleSession};
  signal.throwIfAborted();
  const subtitles=manifest.subtitleAssets;
  if(subtitles&&(!/^[a-f0-9]{16}$/.test(subtitles.assetKey)||subtitles.directory!=='libraries/subtitles/'))throw new Error('Invalid subtitle asset identity');
  return {module,assets:{baseURL:new URL('libraries/',base).href,assetKey:manifest.assetKey,audioDecoderURL:new URL('libraries/audio-decoders/',base).href,
    videoDecoderURL:new URL('libraries/video-decoders/',base).href,subtitleBaseURL:subtitles?new URL(subtitles.directory,base).href:undefined}};
}

export async function loadSubtitleSession(options:Omit<SubtitleSessionOptions,'assetBaseURL'>):Promise<SubtitleSession>{
  const {module,assets}=await loadRuntimeModule(options.signal);
  if(!module.SubtitleSession||!assets.subtitleBaseURL)throw new Error('Subtitle overlay assets are not installed');
  options.signal.throwIfAborted();
  return new module.SubtitleSession({...options,assetBaseURL:assets.subtitleBaseURL});
}

/** Embedded families are advertised only by a core payload with installed assets. */
export async function subtitleCapabilities(signal:AbortSignal,original:boolean):Promise<string[]>{
  const {base,assetKey}=assetLocation();
  const response=await fetch(new URL('assets.json',base),{credentials:'same-origin',signal:AbortSignal.any([signal,AbortSignal.timeout(10000)])});
  if(!response.ok)return[];
  const value=await response.json() as {version?:number;assetKey?:string;upstreamRevision?:string;subtitleAssets?:{assetKey?:string;directory?:string};originalSubtitleFormats?:unknown};
  if(value.version!==1||assetKey!==undefined&&value.assetKey!==assetKey||!/^[a-f0-9]{16}$/.test(value.assetKey??'')||value.upstreamRevision!=='a7a95ef26bd0a71f5ee12f863b8ffb2cfbc3c9d2'||
    !/^[a-f0-9]{16}$/.test(value.subtitleAssets?.assetKey??'')||value.subtitleAssets?.directory!=='libraries/subtitles/')return[];
  const embedded=original&&Array.isArray(value.originalSubtitleFormats)?value.originalSubtitleFormats.filter((format):format is string=>typeof format==='string'&&['srt','webvtt','ass','ssa','pgs','tx3g'].includes(format)):[];
  return [...new Set(['webvtt','ether-vtt-window',...embedded])];
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
  const {base,assetKey} = assetLocation();
  const response = await fetch(new URL('assets.json',base),
    {credentials:'same-origin',signal:AbortSignal.any([signal,AbortSignal.timeout(10000)])});
  if (!response.ok) return null;
  const manifest = await response.json() as {version?:number;assetKey?:string;upstreamRevision?:string;originalPlayback?:ClientCapabilities['originalPlayback']};
  if (manifest.version !== 1 || assetKey !== undefined && manifest.assetKey !== assetKey || !/^[a-f0-9]{16}$/.test(manifest.assetKey ?? '') ||
      manifest.upstreamRevision !== 'a7a95ef26bd0a71f5ee12f863b8ffb2cfbc3c9d2') return null;
  const declaration = manifest.originalPlayback;
  if (!declaration || declaration.version !== 1 || declaration.range !== true || declaration.webgpu !== true) return null;
  for (const list of [declaration.demuxContainers,declaration.videoDecoders,declaration.audioDecoders])
    if (!Array.isArray(list) || !list.length || list.length>32 || list.some(value => typeof value !== 'string' || !/^[a-z0-9_-]{1,40}$/.test(value))) return null;
  // The common H.264 route requires WebCodecs; HEVC exact configurations can
  // instead select the separately installed package after native probing.
  if (typeof VideoDecoder !== 'function' || typeof AudioContext !== 'function' || typeof AudioWorkletNode !== 'function') return null;
  const videoDecoders = declaration.videoDecoders.filter(codec => QUALIFIED_ORIGINAL_VIDEO.includes(codec));
  if (!videoDecoders.length) return null;
  return {...declaration,videoDecoders,audioDecoders:declaration.audioDecoders.filter(codec => QUALIFIED_ORIGINAL_AUDIO.includes(codec))};
}

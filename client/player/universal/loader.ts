import type { OriginalMedia } from './source';
export interface UniversalReadout {
  state: 'loading' | 'playing' | 'paused' | 'buffering' | 'ended' | 'failed';
  position: number; duration: number | null; frames: number; dropped: number;
}
export interface OriginalBackend {
  position: number; readout: UniversalReadout;
  open(media: OriginalMedia): Promise<void>; pause(): void; resume(): void;
  setVolume(volume: number): void; setMuted(muted: boolean): void;
  seek(position: number): Promise<void>; dispose(): Promise<void>;
}
export interface OriginalRuntimeOptions {
  surface: {container: HTMLDivElement; video: HTMLVideoElement};
  assets: {baseURL: string; assetKey: string; audioDecoderURL: string};
  signal: AbortSignal; onEvent: (event: {type: string}) => void;
  onFailure: (reason: string, position: number) => void;
}
export function canAttemptOriginal() { return isSecureContext && !!(navigator as Navigator & {gpu?: unknown}).gpu && typeof VideoDecoder === 'function'; }
export async function loadOriginalRuntime(options: Omit<OriginalRuntimeOptions, 'assets'>): Promise<OriginalBackend> {
  if (!canAttemptOriginal()) throw new Error('Secure WebGPU and WebCodecs are required for original playback');
  const base = new URL('./universal/', import.meta.url);
  const response = await fetch(new URL('assets.json', base), {signal: AbortSignal.any([options.signal, AbortSignal.timeout(10000)]), credentials:'same-origin'});
  if (!response.ok) throw new Error(`Original runtime assets HTTP ${response.status}`);
  const manifest = await response.json() as {version: number; assetKey: string; upstreamRevision: string};
  if (manifest.version !== 1 || !/^[a-f0-9]{16}$/.test(manifest.assetKey) || manifest.upstreamRevision !== 'a7a95ef26bd0a71f5ee12f863b8ffb2cfbc3c9d2') throw new Error('Original runtime asset identity mismatch');
  options.signal.throwIfAborted();
  const moduleURL = new URL('runtime.js', base); moduleURL.searchParams.set('v', manifest.assetKey);
  const module = await import(moduleURL.href) as {UniversalRuntime: new (options: OriginalRuntimeOptions) => OriginalBackend};
  options.signal.throwIfAborted();
  return new module.UniversalRuntime({...options, assets: {baseURL: new URL('libraries/',base).href, assetKey: manifest.assetKey, audioDecoderURL: new URL('libraries/audio-decoders/',base).href}});
}

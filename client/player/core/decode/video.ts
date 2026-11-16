import type { GPUVideoDecodeSessionFactory } from '../../../../vendor/webgpu-player/src/decode/video/gpu/GPUVideoDecodeFeed';
import type { GPUDecoderOutputFormat } from '../../../../vendor/webgpu-player/src/decode/video/gpu/GPUDecodeFormats';
import { VideoPackages } from '../../universal/video/packages';
import { abortable } from '../async';
import type { EncodedPacket, VideoTrack } from '../types';
import { NativeVideoDecoder, type NativeVideoFrame } from './native-video';
import { PackageVideoDecoder, type PackageVideoFrame } from './package-video';

export type CoreVideoFrame = NativeVideoFrame | PackageVideoFrame;
export type VideoRoute = { kind: 'native' } | { kind: 'gpu'; format: GPUDecoderOutputFormat };
export interface VideoPresentation {
  prepare(track: VideoTrack, epoch: number, signal: AbortSignal, route?: VideoRoute): Promise<void>;
  createGPUDecodeFactory(): GPUVideoDecodeSessionFactory;
}
export interface VideoBackend {
  readonly metrics: { decoded: number };
  configure(track: VideoTrack, epoch: number, signal: AbortSignal): Promise<void>;
  decode(packet: EncodedPacket, signal: AbortSignal): Promise<void>;
  drain(signal: AbortSignal): Promise<void>;
  dispose(): void;
}
export interface VideoCallbacks {
  output(frame: CoreVideoFrame): void;
  canOutput(): boolean;
  active(): boolean;
  onFailure(error: Error): void;
}

/** Route selection is Vela-owned and based on the actual decoder configuration. */
export class VideoDecoderRouter implements VideoBackend {
  private backend?: Pick<VideoBackend, 'metrics' | 'decode' | 'drain' | 'dispose'>;
  private native?: NativeVideoDecoder;
  private gpu?: PackageVideoDecoder;
  private closed = false;
  constructor(
    private readonly presentation: VideoPresentation,
    private readonly packages: VideoPackages,
    private readonly callbacks: VideoCallbacks,
    private readonly forcePackage = false,
  ) {}
  get metrics() {
    return this.backend?.metrics ?? { decoded: 0 };
  }
  async configure(track: VideoTrack, epoch: number, signal: AbortSignal): Promise<void> {
    if (this.closed) throw new Error('Video route is disposed');
    if (!this.forcePackage) {
      const phase = new AbortController(),
        operation = AbortSignal.any([signal, phase.signal]);
      const native = (this.native = new NativeVideoDecoder(this.callbacks.output, this.callbacks.onFailure));
      try {
        await abortable(
          Promise.all([
            native.configure(track, epoch, operation),
            this.presentation.prepare(track, epoch, operation, { kind: 'native' }),
          ]),
          operation,
        );
        signal.throwIfAborted();
        this.backend = native;
        return;
      } catch {
        phase.abort();
        native.dispose();
        this.native = undefined;
        signal.throwIfAborted();
      }
    }
    const decoder = await abortable(this.packages.load(track.codec, signal), signal);
    signal.throwIfAborted();
    if (this.closed) throw new DOMException('Video route superseded', 'AbortError');
    if (decoder) {
      const gpu = (this.gpu = new PackageVideoDecoder({
        ...this.callbacks,
        createSession: this.presentation.createGPUDecodeFactory(),
      }));
      const format = await gpu.configure(track, decoder, epoch, signal);
      await this.presentation.prepare(track, epoch, signal, { kind: 'gpu', format });
      signal.throwIfAborted();
      this.backend = gpu;
      return;
    }
    // Chromium can expose a software WebCodecs implementation without a separate
    // WGSL package (notably AVC). This still decodes original packets locally.
    const software = (this.native = new NativeVideoDecoder(
      this.callbacks.output,
      this.callbacks.onFailure,
      'prefer-software',
    ));
    await abortable(
      Promise.all([
        software.configure(track, epoch, signal),
        this.presentation.prepare(track, epoch, signal, { kind: 'native' }),
      ]),
      signal,
    );
    signal.throwIfAborted();
    this.backend = software;
  }
  decode(packet: EncodedPacket, signal: AbortSignal) {
    if (!this.backend) return Promise.reject(new Error('Video route is not configured'));
    return this.backend.decode(packet, signal);
  }
  drain(signal: AbortSignal) {
    return this.backend?.drain(signal) ?? Promise.resolve();
  }
  dispose() {
    if (this.closed) return;
    this.closed = true;
    this.native?.dispose();
    this.gpu?.dispose();
    this.backend = undefined;
  }
}

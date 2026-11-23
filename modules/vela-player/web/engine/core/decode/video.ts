import type { GPUVideoDecodeSessionFactory } from 'webgpu-player/src/decode/video/gpu/GPUVideoDecodeFeed';
import type { GPUDecoderOutputFormat } from 'webgpu-player/src/decode/video/gpu/GPUDecodeFormats';
import { VideoPackages } from '../../universal/video/packages';
import { abortable } from '../async';
import type { EncodedPacket, VideoTrack } from '../types';
import { baseLayerFilter } from './base-layer';
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
  /** Packets in the decoder plus decoded frames not yet released; the presentation queue holds as
   * many (8 when absent). */
  readonly frameBound?: number;
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

const SOFTWARE_FIRST = new Set(['h264', 'vp9', 'vp8', 'av1']);

/** Route selection is Vela-owned and based on the actual decoder configuration. */
export class VideoDecoderRouter implements VideoBackend {
  private backend?: Pick<VideoBackend, 'metrics' | 'frameBound' | 'decode' | 'drain' | 'dispose'>;
  private native?: NativeVideoDecoder;
  private gpu?: PackageVideoDecoder;
  private closed = false;
  /** The decoder that took the stream, for the info card. */
  route: { decoder: 'hardware' | 'software'; decoderName: string; deinterlaces?: boolean } | null = null;
  constructor(
    private readonly presentation: VideoPresentation,
    private readonly packages: VideoPackages,
    private readonly callbacks: VideoCallbacks,
    private readonly forcePackage = false,
    /** Decode only a dual-layer Dolby Vision stream's base layer. */
    private readonly baseLayerOnly = false,
  ) {}
  private filter: ((data: Uint8Array) => Uint8Array | null) | null = null;
  get metrics() {
    return this.backend?.metrics ?? { decoded: 0 };
  }
  get frameBound() {
    return this.backend?.frameBound;
  }
  async configure(track: VideoTrack, epoch: number, signal: AbortSignal): Promise<void> {
    if (this.closed) throw new Error('Video route is disposed');
    this.filter = this.baseLayerOnly ? baseLayerFilter(track) : null;
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
        this.route = { decoder: 'hardware', decoderName: 'WebCodecs' };
        return;
      } catch {
        phase.abort();
        native.dispose();
        this.native = undefined;
        signal.throwIfAborted();
      }
    }
    // Browsers decode H.264, VP9 and AV1 well in software, so those try WebCodecs software before a
    // WebGPU package; codecs without a WebCodecs registration (MPEG-2, VC-1, MPEG-4 Part 2) and HEVC
    // go to their package first.
    if (SOFTWARE_FIRST.has(track.codec)) {
      try {
        await this.software(track, epoch, signal);
        return;
      } catch (error) {
        signal.throwIfAborted();
        this.native?.dispose();
        this.native = undefined;
        if (!PackageVideoDecoder.accepts(track)) throw error;
      }
    }
    const decoder = PackageVideoDecoder.accepts(track)
      ? await abortable(this.packages.load(track.codec, signal), signal)
      : null;
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
      // The package's parser reports each picture's fields, so the presenter deinterlaces them.
      this.route = { decoder: 'software', decoderName: `WebGPU ${decoder.id} package`, deinterlaces: true };
      return;
    }
    if (SOFTWARE_FIRST.has(track.codec)) throw new Error(`No decoder took this ${track.codec} configuration`);
    await this.software(track, epoch, signal);
  }
  /** Chromium can expose a software WebCodecs implementation without a separate WGSL package. */
  private async software(track: VideoTrack, epoch: number, signal: AbortSignal) {
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
    this.route = { decoder: 'software', decoderName: 'WebCodecs' };
  }
  decode(packet: EncodedPacket, signal: AbortSignal) {
    if (!this.backend) return Promise.reject(new Error('Video route is not configured'));
    if (this.filter) {
      const data = this.filter(packet.data);
      if (!data) return Promise.resolve();
      packet = { ...packet, data };
    }
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
    this.route = null;
  }
}

import { createEngineWorker } from 'webgpu-player/src/EngineAssets';
import GPUDecoderCoordinatorHost, {
  type GPUDecoderParserRemotePipeline,
} from 'webgpu-player/src/decode/video/gpu/GPUDecoderCoordinatorHost';
import { getGPUDecoderParserModule } from 'webgpu-player/src/decode/video/gpu/GPUDecoderParser';
import GPUVideoDecodeFeed, {
  type GPUVideoDecodeSessionFactory,
} from 'webgpu-player/src/decode/video/gpu/GPUVideoDecodeFeed';
import { createGPUDecodeStreamFacts } from 'webgpu-player/src/decode/video/gpu/GPUFramePool';
import type { GPUDecoderOutputFormat } from 'webgpu-player/src/decode/video/gpu/GPUDecodeFormats';
import type { VideoDecoderPackage } from 'webgpu-player/src/decode/packages/DecoderPackage';
import type { DecodedFramePoolPresentationFrame } from 'webgpu-player/src/presentation/WebGPUPresenter';
import { secondsToMicroseconds } from 'webgpu-player/src/MediaTime';
import { abortable } from '../async';
import type { DecodedVideoFrame, EncodedPacket, VideoTrack } from '../types';
import { packageOutputFormat } from './codec-config';

export interface PackageVideoFrame extends DecodedVideoFrame {
  kind: 'gpu';
  frame: DecodedFramePoolPresentationFrame;
}
interface Options {
  createSession: GPUVideoDecodeSessionFactory;
  output(frame: PackageVideoFrame): void;
  canOutput(): boolean;
  active(): boolean;
  onFailure(error: Error): void;
}

/** Drives one installed decoder package, never an upstream playback controller. */
export class PackageVideoDecoder {
  readonly metrics = { decoded: 0 };
  private readonly coordinator = new GPUDecoderCoordinatorHost(() =>
    createEngineWorker('webgpu-player/GPUDecoderCoordinator.worker.js'),
  );
  private readonly feed: GPUVideoDecodeFeed;
  private pipeline?: GPUDecoderParserRemotePipeline;
  private epoch = 0;
  private generation = 0;
  private reserved = 0;
  private limit = 8;
  private pending: PackageVideoFrame[] = [];
  private failure: Error | null = null;
  private events: number[] = [];
  private reset = true;
  private drained = false;
  private pumping = false;
  private waiters = new Set<() => void>();
  constructor(private readonly options: Options) {
    this.feed = new GPUVideoDecodeFeed(options.createSession);
  }

  /** Whether the core can drive a package for the track: HEVC with its configuration record, AV1
   * with its av1C, and the 8-bit 4:2:0 codecs (MPEG-1/2, MPEG-4 Part 2, H.263, VC-1/WMV3). */
  static accepts(track: VideoTrack): boolean {
    return packageOutputFormat(track) !== null;
  }

  async configure(
    track: VideoTrack,
    decoder: VideoDecoderPackage,
    epoch: number,
    signal: AbortSignal,
  ): Promise<GPUDecoderOutputFormat> {
    this.stop();
    const generation = this.generation;
    this.epoch = epoch;
    const description = track.config?.description;
    const bytes = description
      ? ArrayBuffer.isView(description)
        ? new Uint8Array(description.buffer, description.byteOffset, description.byteLength).slice()
        : new Uint8Array(description.slice(0))
      : null;
    const format = packageOutputFormat(track);
    if (!format) throw new Error(`Package video has no route for ${track.codec}`);
    if (
      !decoder.manifest.accepts.codecs.includes(track.codec) ||
      !decoder.manifest.outputFormats.includes(format)
    )
      throw new Error('Installed video package does not accept this actual format');
    this.limit = Math.min(64, 8 + decoder.manifest.reorder);
    try {
      const pipeline =
        decoder.manifest.parser === null
          ? null
          : await abortable(
              this.coordinator.open(getGPUDecoderParserModule(decoder), decoder, bytes),
              signal,
            );
      signal.throwIfAborted();
      if (generation !== this.generation) {
        pipeline?.close();
        throw new DOMException('Package configuration superseded', 'AbortError');
      }
      this.pipeline = pipeline ?? undefined;
      this.feed.start(
        {
          onCreditsReleased: () => this.wake(),
          onFailure: (message) => {
            if (generation === this.generation) this.fail(new Error(`GPU decode: ${message}`));
          },
          onVideoDrained: () => {
            if (generation === this.generation) {
              this.drained = true;
              this.wake();
            }
          },
          onFrame: (frame) => {
            if (generation !== this.generation) {
              this.feed.releaseFrame(frame);
              return;
            }
            this.metrics.decoded++;
            let released = false;
            const wrapped: PackageVideoFrame = {
              kind: 'gpu',
              frame,
              epoch,
              timestampUs: frame.mediaTimeMicroseconds,
              durationUs: frame.durationMicroseconds,
              release: () => {
                if (released) return;
                released = true;
                this.feed.releaseFrame(frame);
                if (generation === this.generation) {
                  this.reserved = Math.max(0, this.reserved - 1);
                  this.wake();
                  this.pump();
                }
              },
            };
            if (this.pending.length >= this.limit) {
              wrapped.release();
              this.fail(new Error('GPU decoded output exceeded its bounded queue'));
              return;
            }
            this.pending.push(wrapped);
            this.pump();
          },
        },
        epoch,
      );
      this.feed.configure(
        {
          codecPrivate: bytes,
          decoder: { codec: track.codec, decoderId: decoder.id, package: decoder },
          format,
          maximumPictureSize: pipeline?.maximumPictureSize ?? null,
          stream: createGPUDecodeStreamFacts(track.width, track.height, format),
        },
        { displayWidth: track.width, displayHeight: track.height },
      );
      return format;
    } catch (error) {
      this.stop();
      throw error;
    }
  }

  async decode(packet: EncodedPacket, signal: AbortSignal): Promise<void> {
    if (packet.epoch !== this.epoch) return;
    const generation = this.generation;
    const parsed = this.pipeline
      ? await abortable(this.pipeline.submit(packet.data.slice().buffer), signal)
      : null;
    signal.throwIfAborted();
    if (generation !== this.generation) throw new DOMException('Package decode superseded', 'AbortError');
    const pictures = parsed?.pictures ?? [
      {
        record: packet.data.slice().buffer,
        events: new Uint32Array(0),
        fields: null,
        format: null,
        maximumPictureSize: null,
        repeatCounts: null,
        visibleSize: null,
      },
    ];
    if (pictures.length > 64) throw new Error('Video packet contains too many pictures');
    for (let index = 0; index < pictures.length; index++) {
      await this.wait(() => this.reserved < this.limit, signal);
      const picture = pictures[index];
      const events =
        index === 0 && this.events.length
          ? new Uint32Array([...this.events, ...picture.events])
          : picture.events;
      if (index === 0) this.events = [];
      this.reserved++;
      this.feed.queuePacket({
        data: picture.record,
        durationMicroseconds: secondsToMicroseconds(packet.durationUs / 1e6),
        timestampMicroseconds: secondsToMicroseconds(packet.timestampUs / 1e6),
        keyframe: packet.key,
        reset: this.reset,
        hold: false,
        recovery: null,
        encodedDolbyVisionMetadata: null,
        HDR10PlusMetadata: null,
        fields: picture.fields,
        format: picture.format,
        maximumPictureSize: picture.maximumPictureSize,
        outputEvents: events,
        repeatCounts: picture.repeatCounts,
        visibleSize: picture.visibleSize,
      });
      this.reset = false;
    }
    if (parsed?.trailingEvents.length) this.events.push(...parsed.trailingEvents);
    if (this.events.length > 65536) throw new Error('Video parser event history exceeded its bound');
  }

  async drain(signal: AbortSignal): Promise<void> {
    this.feed.endVideo(this.events.length ? new Uint32Array(this.events) : null);
    this.events = [];
    await this.wait(() => this.drained && this.pending.length === 0, signal);
  }
  private pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.pending.length && this.options.canOutput()) this.options.output(this.pending.shift()!);
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.pumping = false;
      this.wake();
    }
  }
  private wait(predicate: () => boolean, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    const generation = this.generation;
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout>,
        active = 0,
        last = performance.now();
      const clean = () => {
        clearTimeout(timer);
        this.waiters.delete(check);
        signal.removeEventListener('abort', check);
      };
      const check = () => {
        if (signal.aborted || generation !== this.generation) {
          clean();
          reject(signal.reason ?? new DOMException('Package epoch retired', 'AbortError'));
        } else if (this.failure) {
          clean();
          reject(this.failure);
        } else if (predicate()) {
          clean();
          resolve();
        }
      };
      const deadline = () => {
        const now = performance.now();
        if (this.options.active()) active += now - last;
        last = now;
        if (active >= 8000) {
          this.fail(new Error('GPU decoder stopped making progress'));
          check();
        } else timer = setTimeout(deadline, 250);
      };
      this.waiters.add(check);
      signal.addEventListener('abort', check, { once: true });
      timer = setTimeout(deadline, 250);
      check();
    });
  }
  private wake() {
    for (const resolve of [...this.waiters]) resolve();
  }
  private fail(error: Error) {
    if (this.failure) return;
    this.failure = error;
    this.wake();
    this.options.onFailure(error);
  }
  private stop() {
    this.generation++;
    this.pipeline?.close();
    this.pipeline = undefined;
    this.coordinator.destroy();
    this.feed.stop();
    for (const frame of this.pending.splice(0)) frame.release();
    this.reserved = 0;
    this.failure = null;
    this.events = [];
    this.reset = true;
    this.drained = false;
    this.wake();
  }
  dispose() {
    this.stop();
    this.feed.destroy();
  }
}

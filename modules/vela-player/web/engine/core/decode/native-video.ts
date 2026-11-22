import { abortable } from '../async';
import { prepareNativeHEVC } from './hevc';
import { prepareNativeAV1 } from './av1';
import type { DecodedVideoFrame, EncodedPacket, VideoTrack } from '../types';
import { avcDecodedPictureBufferFrames } from './avc-buffer';

/** Decoded frames the presentation queue may hold beyond what the decoder keeps for reordering. */
const PRESENTATION_FRAMES = 8;

/** How many packets may be in the decoder or in presentation at once. A decoder can hold its
 * whole decoded picture buffer before its first output: H.264 without a bitstream restriction is
 * sized by its level, so a small Level 3.1 picture (852x480: eleven frames) needs more than eight
 * packets in before one comes out, and a bound of eight never sees a picture. Such a stream gets
 * room for its buffer plus the presentation frames; every other stream keeps eight. The
 * presentation queue is sized to the same bound, so a burst of outputs always fits. */
export function nativeFrameBound(decodedPictureBuffer: number | null): number {
  if (decodedPictureBuffer === null || decodedPictureBuffer + 2 <= PRESENTATION_FRAMES) return PRESENTATION_FRAMES;
  return Math.min(16, decodedPictureBuffer) + PRESENTATION_FRAMES;
}

export interface NativeVideoFrame extends DecodedVideoFrame {
  kind: 'native';
  frame: VideoFrame;
}

/** Exact-config WebCodecs component. Vela owns input credits and output lifetime. */
export class NativeVideoDecoder {
  readonly metrics = { decoded: 0 };
  /** Packets in the decoder plus decoded frames not yet released (nativeFrameBound). */
  frameBound = PRESENTATION_FRAMES;
  private decoder?: VideoDecoder;
  private epoch = 0;
  private held = 0;
  private failure: Error | null = null;
  private waiters = new Set<() => void>();
  private generation = 0;
  private durations = new Map<number, number>();
  /** Codec-specific bitstream preparation (HEVC always, AV1 for HDR); absent for other codecs. */
  private prepared: ReturnType<typeof prepareNativeHEVC> | ReturnType<typeof prepareNativeAV1>;
  constructor(
    private readonly output: (frame: NativeVideoFrame) => void,
    private readonly onFailure: (error: Error) => void,
    private readonly acceleration: HardwareAcceleration = 'prefer-hardware',
  ) {}

  async configure(track: VideoTrack, epoch: number, signal: AbortSignal): Promise<void> {
    this.dispose();
    if (!track.config || typeof VideoDecoder !== 'function')
      throw new Error('Native video decoder is unavailable for this actual configuration');
    const generation = this.generation;
    const requested = { ...track.config, hardwareAcceleration: this.acceleration };
    this.prepared = prepareNativeHEVC(track, requested) ?? prepareNativeAV1(track, requested);
    const config: VideoDecoderConfig = this.prepared?.configuration ?? {
      ...track.config,
      hardwareAcceleration: this.acceleration,
    };
    const support = await abortable(
      VideoDecoder.isConfigSupported(config),
      AbortSignal.any([signal, AbortSignal.timeout(1500)]),
    );
    signal.throwIfAborted();
    if (generation !== this.generation)
      throw new DOMException('Decoder configuration superseded', 'AbortError');
    if (!support.supported) throw new Error('Actual video configuration needs a package decoder');
    this.epoch = epoch;
    this.failure = null;
    this.frameBound = nativeFrameBound(this.prepared ? null : avcDecodedPictureBufferFrames(track.config));
    this.decoder = new VideoDecoder({
      output: (frame) => {
        if (generation !== this.generation) {
          frame.close();
          return;
        }
        try {
          this.prepared?.validateFrame(frame);
        } catch (error) {
          frame.close();
          this.held = Math.max(0, this.held - 1);
          this.wake();
          this.fail(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        this.metrics.decoded++;
        let released = false;
        const release = () => {
          if (released) return;
          released = true;
          frame.close();
          if (generation === this.generation) {
            this.held = Math.max(0, this.held - 1);
            this.wake();
          }
        };
        const durationUs = frame.duration ?? this.durations.get(frame.timestamp) ?? 0;
        this.durations.delete(frame.timestamp);
        try {
          this.output({ kind: 'native', frame, epoch, timestampUs: frame.timestamp, durationUs, release });
        } catch (error) {
          release();
          this.fail(error instanceof Error ? error : new Error(String(error)));
        }
      },
      error: (error) => {
        if (generation === this.generation) this.fail(error);
      },
    });
    try {
      this.decoder.configure(config);
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  async decode(packet: EncodedPacket, signal: AbortSignal): Promise<void> {
    if (packet.epoch !== this.epoch) return;
    const generation = this.generation;
    while (this.held >= this.frameBound && !this.failure && generation === this.generation) await this.available(signal);
    signal.throwIfAborted();
    if (generation !== this.generation) throw new DOMException('Video decode superseded', 'AbortError');
    if (this.failure) throw this.failure;
    if (!this.decoder || this.decoder.state !== 'configured')
      throw new Error('Video decoder is not configured');
    if (packet.data.length > 16 * 1024 * 1024) throw new Error('Video packet exceeds decoder input bound');
    const data = this.prepared ? this.prepared.packet(packet.data) : packet.data;
    if (!data) return;
    this.held++;
    this.durations.set(packet.timestampUs, packet.durationUs);
    try {
      this.decoder.decode(
        new EncodedVideoChunk({
          type: packet.key ? 'key' : 'delta',
          timestamp: packet.timestampUs,
          duration: packet.durationUs,
          data,
        }),
      );
    } catch (error) {
      this.held--;
      this.durations.delete(packet.timestampUs);
      throw error;
    }
  }

  async drain(signal: AbortSignal): Promise<void> {
    if (!this.decoder) return;
    await abortable(this.decoder.flush(), signal);
    if (this.failure) throw this.failure;
  }

  private available(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const wake = () => {
        cleanup();
        resolve();
      };
      const abort = () => {
        cleanup();
        reject(signal.reason);
      };
      const cleanup = () => {
        this.waiters.delete(wake);
        signal.removeEventListener('abort', abort);
      };
      this.waiters.add(wake);
      signal.addEventListener('abort', abort, { once: true });
    });
  }
  private wake() {
    for (const wake of [...this.waiters]) wake();
  }
  private fail(error: Error) {
    if (this.failure) return;
    this.failure = error;
    this.wake();
    this.onFailure(error);
  }
  dispose(): void {
    this.generation++;
    if (this.decoder && this.decoder.state !== 'closed') this.decoder.close();
    this.decoder = undefined;
    this.held = 0;
    this.failure = null;
    this.prepared = undefined;
    this.durations.clear();
    this.wake();
  }
}

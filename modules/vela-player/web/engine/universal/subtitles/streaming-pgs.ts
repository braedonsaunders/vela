import { paintPGS, type SubtitleViewport } from './canvas';
import type { MatroskaSubtitles } from './matroska';
import { PGSDecoder, type PGSDisplay } from './pgs';
import type { SubtitleClusterStream, SubtitleStreamPacket } from './types';

interface Surface {
  canvas: HTMLCanvasElement;
  resize(): boolean;
  viewport(): SubtitleViewport;
}
type StreamingContainer = Pick<MatroskaSubtitles, 'tracks' | 'streamPackets' | 'decodeStreamPacket'>;
interface StreamingOptions {
  container: StreamingContainer;
  trackId: string;
  stream: SubtitleClusterStream;
  /** Subtitle time to start from: video time minus the subtitle delay. */
  position: number;
  /** The subtitle clock, in the same terms as `position`. */
  clock(): number;
  signal: AbortSignal;
  /** Errors after start-up. Errors before it reject the start-up instead. */
  onFailure(error: unknown): void;
}
export interface StreamingPGSDisplays {
  /** The display set showing at subtitle time `time`, or null for none. */
  at(time: number): PGSDisplay | null;
  dispose(): void;
}
/** Packets are decoded into bitmaps only this far ahead of the subtitle clock. Later ones wait as
 * packets: the demux reads each cluster once, so a packet set aside is never offered again. */
export const PGS_DECODE_AHEAD_SECONDS = 8;

/**
 * One embedded PGS track's display sets, from the clusters the AV demux reads anyway: no subtitle
 * index, file scan or private byte cache. Ready once the replay around `position` has been read;
 * nothing to show yet (the start of a film, a quiet stretch, a long subtitle delay) is a valid
 * state. The replay's own time limit still fails a source that cannot be read.
 */
export async function streamingPGSDisplays(options: StreamingOptions): Promise<StreamingPGSDisplays> {
  const { container, trackId, stream, signal } = options;
  const local = new AbortController(),
    lifetime = AbortSignal.any([signal, local.signal]);
  let epoch = stream.epoch,
    decoder = new PGSDecoder(),
    active: PGSDisplay | null = null;
  let queue: SubtitleStreamPacket[] = [],
    queuedBytes = 0,
    displays: PGSDisplay[] = [],
    displayBytes = 0,
    lastTime = -Infinity;
  let replayed = false,
    working = false,
    ready = false,
    disposed = false,
    acquired = false;
  const startupErrors: unknown[] = [];
  const seen = new Map<number, number>();
  /** Packets that arrived over 4 s after their time (a subtitle advance beyond the demux's
   * read-ahead). They still end whatever was showing, but are never painted late. */
  const late = new WeakSet<SubtitleStreamPacket>();
  const bytes = (display: PGSDisplay) =>
    display.bitmaps.reduce((sum, bitmap) => sum + bitmap.rgba.byteLength, 0);
  const byTime = (a: SubtitleStreamPacket, b: SubtitleStreamPacket) => a.time - b.time || a.position - b.position;
  const reset = () => {
    decoder.reset();
    decoder = new PGSDecoder();
    active = null;
    queue = [];
    queuedBytes = 0;
    displays = [];
    displayBytes = 0;
    lastTime = -Infinity;
    seen.clear();
    acquired = false;
  };
  const failed = (error: unknown) => {
    if (lifetime.aborted || disposed) return;
    if (ready) options.onFailure(error);
    else startupErrors.push(error);
  };
  const due = (time: number) => queue.length > 0 && queue[0].time <= time + PGS_DECODE_AHEAD_SECONDS;
  const pump = async () => {
    if (working || !replayed || disposed) return;
    working = true;
    try {
      while (due(options.clock())) {
        lifetime.throwIfAborted();
        const raw = queue.shift()!,
          stale = late.has(raw);
        queuedBytes -= raw.data.length;
        const attempt = epoch;
        if (raw.time < lastTime) continue;
        const packet = await container.decodeStreamPacket(trackId, raw, lifetime);
        lifetime.throwIfAborted();
        if (attempt !== epoch) continue;
        let output: PGSDisplay[];
        try {
          output = decoder.push(packet.data, packet.time);
        } catch (error) {
          // A bounded seek may start in the middle of an object. Wait for a
          // complete display, never paint a partially reconstructed bitmap.
          if (!acquired && error instanceof Error && error.message === 'PGS continuation has no object') {
            decoder.reset();
            continue;
          }
          throw error;
        }
        lastTime = packet.time;
        for (const decoded of output) {
          const display = stale ? { ...decoded, bitmaps: [] } : decoded;
          displayBytes += bytes(display);
          if (displayBytes > 64 * 1024 * 1024 || displays.length >= 256)
            throw new Error('Subtitle display look-ahead exceeds bound');
          displays.push(display);
          acquired = true;
        }
      }
    } catch (error) {
      failed(error);
    } finally {
      working = false;
    }
  };
  const stop = stream.subscribe(
    (cluster) => {
      if (lifetime.aborted || disposed) return;
      try {
        if (cluster.epoch !== epoch) {
          epoch = cluster.epoch;
          reset();
        }
        const now = options.clock();
        for (const packet of container.streamPackets(trackId, cluster.bytes, cluster.payloadStart)) {
          if (seen.has(packet.position)) continue;
          // Skipping a late packet would leave the subtitle it clears on screen.
          if (cluster.endTime < now - 4 && packet.time < now - 4) late.add(packet);
          seen.set(packet.position, packet.time);
          if (seen.size > 1024) {
            const floor = options.clock() - 30;
            for (const [position, time] of seen) if (time < floor) seen.delete(position);
          }
          queuedBytes += packet.data.length;
          if (queuedBytes > 16 * 1024 * 1024 || queue.length >= 8192 || seen.size > 65536)
            throw new Error('Streaming subtitle queue exceeds bound');
          queue.push(packet);
        }
        queue.sort(byTime);
        void pump();
      } catch (error) {
        failed(error);
      }
    },
    failed,
    container.tracks.find((track) => track.id === trackId)?.containerTrackId ?? undefined,
  );
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    stop();
    local.abort();
    signal.removeEventListener('abort', dispose);
    reset();
  };
  signal.addEventListener('abort', dispose, { once: true });
  try {
    const startup = AbortSignal.any([lifetime, AbortSignal.timeout(8000)]);
    await stream.replay(options.position, startup);
    startup.throwIfAborted();
    replayed = true;
    // Decode what the replay read, so a subtitle already showing at `position` paints at once.
    await pump();
    startup.throwIfAborted();
    if (startupErrors.length) throw startupErrors[0];
    ready = true;
    return {
      dispose,
      at: (time: number) => {
        if (disposed) return null;
        if (!working && due(time)) void pump();
        while (displays.length && displays[0].time <= time) {
          const next = displays.shift()!;
          displayBytes -= bytes(next);
          active = next;
        }
        return active;
      },
    };
  } catch (error) {
    dispose();
    throw error;
  }
}

/** Selected-track stream only: no subtitle index, file scan or private byte cache. */
export async function streamingPGS(options: StreamingOptions & { surface: Surface }) {
  const { surface, signal } = options;
  const context = surface.canvas.getContext('2d');
  if (!context) throw new Error('Subtitle overlay canvas unavailable');
  const displays = await streamingPGSDisplays(options);
  let drawn: PGSDisplay | null = null,
    disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    signal.removeEventListener('abort', dispose);
    displays.dispose();
    context.clearRect(0, 0, surface.canvas.width, surface.canvas.height);
    surface.canvas.remove();
  };
  signal.addEventListener('abort', dispose, { once: true });
  return {
    canvas: surface.canvas,
    end: Infinity,
    dispose,
    render: (time: number) => {
      if (disposed) return;
      const resized = surface.resize();
      const active = displays.at(time);
      if (drawn !== active || resized) {
        context.clearRect(0, 0, surface.canvas.width, surface.canvas.height);
        if (active) paintPGS(context, active, surface.viewport());
        drawn = active;
      }
    },
  };
}

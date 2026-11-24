import type { ByteReader } from '../types';
import type { SubtitleCluster, SubtitleClusterStream } from '../../universal/subtitles/types';

type ClusterBytes = Omit<SubtitleCluster, 'epoch'>;
const observers = new WeakMap<object, (cluster: ClusterBytes) => void>();
export function observeSubtitleClusters(source: object, receive: (cluster: ClusterBytes) => void) {
  observers.set(source, receive);
  return () => {
    if (observers.get(source) === receive) observers.delete(source);
  };
}
/** Called synchronously by the library while its already-read cluster is borrowed. */
export function publishSubtitleCluster(
  source: object,
  position: number,
  payloadStart: number,
  bytes: Uint8Array,
  time: number,
  endTime: number,
) {
  observers.get(source)?.({ position, payloadStart, bytes, time, endTime });
}
interface Fragment {
  start: number;
  length: number;
  track: number;
}
type Hint = Omit<SubtitleCluster, 'bytes'> & {
  length: number;
  fragments?: Fragment[];
  prefix?: Uint8Array;
  unavailable?: boolean;
};
export interface StreamingClusterHint {
  position: number;
  payloadStart: number;
  length: number;
  time: number;
  endTime: number;
  timestamp: number;
}
interface Listener {
  failure?: (error: unknown) => void;
  track?: number;
}
function timestampHeader(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid subtitle cluster timestamp');
  const bytes: number[] = [];
  do {
    bytes.unshift(value % 256);
    value = Math.floor(value / 256);
  } while (value);
  return new Uint8Array([0xe7, 0x80 | bytes.length, ...bytes]);
}
/** Position hints only. The core's reader owns all byte caching and acquisition. */
export class MatroskaSubtitleStream implements SubtitleClusterStream {
  epoch = 0;
  private hints: Hint[] = [];
  private listeners = new Map<(cluster: SubtitleCluster) => void, Listener>();
  private pending = new Map<string, Promise<void>>();
  private pendingBytes = 0;
  private epochAbort = new AbortController();
  constructor(
    private reader: ByteReader,
    private signal: AbortSignal,
  ) {
    signal.addEventListener(
      'abort',
      () => {
        this.hints = [];
        this.listeners.clear();
        this.epochAbort.abort();
      },
      { once: true },
    );
  }
  reset(epoch: number) {
    this.epochAbort.abort();
    this.epochAbort = new AbortController();
    this.epoch = epoch;
    this.hints = [];
    this.pending.clear();
    this.pendingBytes = 0;
  }
  readonly receive = (cluster: ClusterBytes) => {
    if (
      this.signal.aborted ||
      !Number.isFinite(cluster.time) ||
      cluster.time < 0 ||
      !Number.isFinite(cluster.endTime) ||
      cluster.endTime < cluster.time ||
      !Number.isSafeInteger(cluster.position) ||
      !Number.isSafeInteger(cluster.payloadStart) ||
      cluster.bytes.length > 32 * 1024 * 1024
    )
      return;
    const value = { ...cluster, epoch: this.epoch };
    this.hints = this.hints.filter((hint) => hint.position !== cluster.position);
    this.hints.push({
      epoch: this.epoch,
      position: cluster.position,
      payloadStart: cluster.payloadStart,
      time: cluster.time,
      endTime: cluster.endTime,
      length: cluster.bytes.length,
    });
    this.prune();
    this.emit(value);
  };
  private prune() {
    while (this.hints.length > 64 || this.hints.reduce((n, h) => n + (h.fragments?.length ?? 0), 0) > 16384)
      this.hints.shift();
  }
  /** Incremental AV parsing records subtitle ranges without acquiring their bodies. */
  advance(cluster: StreamingClusterHint) {
    if (
      this.signal.aborted ||
      cluster.time < 0 ||
      cluster.endTime < cluster.time ||
      !Number.isFinite(cluster.endTime)
    )
      return;
    let hint = this.hints.find((h) => h.position === cluster.position);
    if (!hint) {
      hint = {
        epoch: this.epoch,
        position: cluster.position,
        payloadStart: cluster.payloadStart,
        length: cluster.length,
        time: cluster.time,
        endTime: cluster.endTime,
        fragments: [],
        prefix: timestampHeader(cluster.timestamp),
      };
      this.hints.push(hint);
      this.prune();
    } else {
      hint.endTime = Math.max(hint.endTime, cluster.endTime);
      hint.length = cluster.length;
      hint.prefix ??= timestampHeader(cluster.timestamp);
    }
  }
  fragment(cluster: StreamingClusterHint, start: number, length: number, track: number) {
    this.advance(cluster);
    const hint = this.hints.find((h) => h.position === cluster.position);
    if (!hint) return;
    if (hint.fragments) {
      if (hint.fragments.some((f) => f.start === start)) return;
      if (hint.fragments.length >= 4096) {
        hint.unavailable = true;
        this.failed(new Error('Subtitle fragment history exceeds bound'), track);
        return;
      }
      hint.fragments.push({ start, length, track });
      this.prune();
    }
    if (![...this.listeners.values()].some((l) => l.track === undefined || l.track === track)) return;
    const epoch = this.epoch,
      key = epoch + ':' + start;
    if (this.pending.has(key)) return;
    if (
      length > 16 * 1024 * 1024 ||
      this.pending.size >= 4 ||
      this.pendingBytes + length > 16 * 1024 * 1024
    ) {
      this.failed(new Error('Subtitle fragment acquisition exceeds bound'), track);
      return;
    }
    this.pendingBytes += length;
    const work = this.readFragment(
      hint,
      { start, length, track },
      AbortSignal.any([this.signal, this.epochAbort.signal, AbortSignal.timeout(8000)]),
      epoch,
    )
      .catch((error) => {
        if (this.epoch === epoch && !this.signal.aborted) this.failed(error, track);
      })
      .finally(() => {
        if (this.epoch === epoch) {
          this.pending.delete(key);
          this.pendingBytes -= length;
        }
      });
    this.pending.set(key, work);
  }
  private async readFragment(hint: Hint, fragment: Fragment, signal: AbortSignal, epoch: number) {
    const prefix = hint.prefix;
    if (!prefix) throw new Error('Subtitle fragment timestamp is unavailable');
    const bytes = await this.reader.read(fragment.start, fragment.length, signal);
    signal.throwIfAborted();
    if (this.epoch !== epoch) throw new DOMException('Subtitle fragment retired', 'AbortError');
    this.emitFragment(hint, fragment, bytes, prefix, epoch);
  }
  private emitFragment(hint: Hint, fragment: Fragment, bytes: Uint8Array, prefix: Uint8Array, epoch: number) {
    const joined = new Uint8Array(prefix.length + bytes.length);
    joined.set(prefix);
    joined.set(bytes, prefix.length);
    // Prefixing only the timestamp preserves each original block's byte identity.
    this.emit({
      epoch,
      position: hint.position,
      payloadStart: fragment.start - prefix.length,
      time: hint.time,
      endTime: hint.endTime,
      bytes: joined,
    });
  }
  private failed(error: unknown, track: number) {
    for (const listener of this.listeners.values())
      if (listener.track === undefined || listener.track === track) {
        try {
          listener.failure?.(error);
        } catch {}
      }
  }
  private emit(cluster: SubtitleCluster) {
    for (const listener of this.listeners.keys()) {
      try {
        listener(cluster);
      } catch {
        /* A subtitle consumer cannot fail the AV demux. */
      }
    }
  }
  subscribe(
    receive: (cluster: SubtitleCluster) => void,
    onFailure?: (error: unknown) => void,
    trackNumber?: number,
  ) {
    this.listeners.set(receive, { failure: onFailure, track: trackNumber });
    return () => {
      this.listeners.delete(receive);
    };
  }
  async replay(position: number, signal: AbortSignal) {
    if (!Number.isFinite(position) || position < 0) throw new Error('Invalid subtitle replay position');
    const epoch = this.epoch,
      operation = AbortSignal.any([signal, this.signal, this.epochAbort.signal, AbortSignal.timeout(8000)]);
    const ordered = this.hints.filter((hint) => hint.epoch === epoch).sort((a, b) => a.time - b.time);
    const covering = ordered
      .filter((hint) => hint.time <= position && hint.endTime + 1e-6 >= position)
      .at(-1);
    const previous = covering
      ? ordered.find(
          (hint) =>
            hint !== covering &&
            hint.payloadStart + hint.length === covering.position &&
            hint.time >= position - 4,
        )
      : undefined;
    const selected = [
      ...(previous ? [previous] : []),
      ...(covering ? [covering] : []),
      ...ordered.filter((hint) => hint.time > position && hint.time <= position + 4).slice(0, 2),
    ];
    const subscribed = (track: number) =>
      [...this.listeners.values()].some((l) => l.track === undefined || l.track === track);
    let total = 0;
    for (const hint of selected) {
      operation.throwIfAborted();
      if (this.epoch !== epoch) throw new DOMException('Subtitle replay retired', 'AbortError');
      if (hint.unavailable) throw new Error('Exact subtitle fragment history is unavailable');
      if (hint.fragments) {
        for (const fragment of hint.fragments.slice().sort((a, b) => a.start - b.start)) {
          if (!subscribed(fragment.track)) continue;
          total += fragment.length;
          if (total > 48 * 1024 * 1024) throw new Error('Subtitle fragment replay exceeds bound');
          await this.readFragment(hint, fragment, operation, epoch);
        }
      } else {
        total += hint.length;
        if (total > 48 * 1024 * 1024) throw new Error('Subtitle cluster look-ahead exceeds bound');
        const bytes = await this.reader.read(hint.payloadStart, hint.length, operation);
        operation.throwIfAborted();
        if (this.epoch !== epoch) throw new DOMException('Subtitle replay retired', 'AbortError');
        this.emit({ ...hint, bytes });
      }
    }
    // The demux may have parsed well past the window before this listener subscribed (a
    // low-bitrate file, a delay change). Those blocks are never offered again, so offer
    // them now, but only from bytes the reader still holds: no new reads at start-up.
    if (!this.reader.peek) return;
    for (const hint of ordered) {
      if (hint.time <= position || selected.includes(hint) || hint.unavailable) continue;
      operation.throwIfAborted();
      if (this.epoch !== epoch) throw new DOMException('Subtitle replay retired', 'AbortError');
      if (hint.fragments) {
        if (!hint.prefix) continue;
        for (const fragment of hint.fragments.slice().sort((a, b) => a.start - b.start)) {
          if (!subscribed(fragment.track)) continue;
          if (total + fragment.length > 48 * 1024 * 1024) return;
          const bytes = this.reader.peek(fragment.start, fragment.length);
          if (!bytes) continue;
          total += fragment.length;
          this.emitFragment(hint, fragment, bytes, hint.prefix, epoch);
        }
      } else {
        if (total + hint.length > 48 * 1024 * 1024) return;
        const bytes = this.reader.peek(hint.payloadStart, hint.length);
        if (!bytes) continue;
        total += hint.length;
        this.emit({ ...hint, bytes });
      }
    }
  }
}

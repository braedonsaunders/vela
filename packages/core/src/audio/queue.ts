// An audio queue (docs/media-kinds.md): the items in their own order, the order they play in
// (shuffled or not), where playback is, and repeat. Pure values: every change returns a new queue.
import type { Card } from '../models';

export type RepeatMode = 'off' | 'all' | 'one';

export interface AudioQueue {
  items: Card[];
  /** Indices into items, in play order. */
  order: number[];
  /** Where playback is in `order`. */
  at: number;
  shuffle: boolean;
  repeat: RepeatMode;
  source?: { id: string; name: string };
}

/** A uniform random number in [0, 1): injectable so tests are deterministic. */
export type Random = () => number;

/** A shuffled order that starts with `first` (the item the viewer chose). */
function shuffled(count: number, first: number, random: Random): number[] {
  const rest = Array.from({ length: count }, (_, i) => i).filter(i => i !== first);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [rest[i], rest[j]] = [rest[j]!, rest[i]!];
  }
  return first >= 0 && first < count ? [first, ...rest] : rest;
}

export function createQueue(items: Card[], index: number, options: { shuffle?: boolean; repeat?: RepeatMode; source?: AudioQueue['source'] } = {}, random: Random = Math.random): AudioQueue {
  const start = Math.min(Math.max(0, index), Math.max(0, items.length - 1));
  // Shuffle with no chosen item (an album's Shuffle button) starts anywhere.
  const first = options.shuffle && index <= 0 ? Math.floor(random() * items.length) : start;
  const order = options.shuffle ? shuffled(items.length, first, random) : items.map((_, i) => i);
  return { items, order, at: options.shuffle ? 0 : start, shuffle: !!options.shuffle, repeat: options.repeat ?? 'off', ...(options.source ? { source: options.source } : {}) };
}

export function current(queue: AudioQueue | null | undefined): Card | undefined {
  if (!queue) return undefined;
  const index = queue.order[queue.at];
  return index === undefined ? undefined : queue.items[index];
}

/** What plays after the current item, in order (for Now Playing's Up Next). */
export function upNext(queue: AudioQueue): Card[] {
  const after = queue.order.slice(queue.at + 1).map(i => queue.items[i]!);
  return queue.repeat === 'all' ? [...after, ...queue.order.slice(0, queue.at).map(i => queue.items[i]!)] : after;
}

/**
 * The queue after the current item: `auto` when it finished by itself (repeat-one plays it again),
 * otherwise the viewer asked for the next one. Undefined at the end with repeat off.
 */
export function next(queue: AudioQueue, auto = false): AudioQueue | undefined {
  if (auto && queue.repeat === 'one') return queue;
  if (queue.at + 1 < queue.order.length) return { ...queue, at: queue.at + 1 };
  return queue.repeat === 'off' ? undefined : { ...queue, at: 0 };
}

/** Previous: restart the item when it has played more than three seconds, else the one before. */
export function previous(queue: AudioQueue, positionSeconds: number): { queue: AudioQueue; restart: boolean } {
  if (positionSeconds > 3 || (queue.at === 0 && queue.repeat !== 'all')) return { queue, restart: true };
  return { queue: { ...queue, at: queue.at === 0 ? queue.order.length - 1 : queue.at - 1 }, restart: false };
}

/** Shuffle on keeps the current item playing and shuffles the rest after it; off restores album order. */
export function toggleShuffle(queue: AudioQueue, random: Random = Math.random): AudioQueue {
  const playing = queue.order[queue.at] ?? 0;
  if (queue.shuffle) return { ...queue, shuffle: false, order: queue.items.map((_, i) => i), at: playing };
  return { ...queue, shuffle: true, order: shuffled(queue.items.length, playing, random), at: 0 };
}

export function cycleRepeat(queue: AudioQueue): AudioQueue {
  return { ...queue, repeat: queue.repeat === 'off' ? 'all' : queue.repeat === 'all' ? 'one' : 'off' };
}

/** Play the item at `itemIndex` (an index into items) now. */
export function jumpTo(queue: AudioQueue, itemIndex: number): AudioQueue {
  const at = queue.order.indexOf(itemIndex);
  return at < 0 ? queue : { ...queue, at };
}

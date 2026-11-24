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
  /** Where the queue came from: Now Playing's "Playing from", and Recently played's context
   * (`kind`: an album or artist title, a playlist, or a liked list whose id is its role). */
  source?: { id: string; name: string; kind?: 'title' | 'playlist' | 'favorites' };
  /** Items (indices into items) the viewer queued with Play next or Add to queue that have not
   * played yet: they play before the rest of the source, and Now Playing lists them apart. */
  queued?: number[];
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
  if (queue.at + 1 < queue.order.length) return played({ ...queue, at: queue.at + 1 });
  return queue.repeat === 'off' ? undefined : played({ ...queue, at: 0 });
}

/** A queued item that is now playing is no longer waiting in the viewer's queue. */
function played(queue: AudioQueue): AudioQueue {
  const now = queue.order[queue.at];
  if (!queue.queued?.length || now === undefined || !queue.queued.includes(now)) return queue;
  return { ...queue, queued: queue.queued.filter(i => i !== now) };
}

/** With shuffle off the play order is the items' own order: keep them one and the same, so turning
 * shuffle off never moves what the viewer queued or reordered. */
function settle(queue: AudioQueue): AudioQueue {
  if (queue.shuffle) return queue;
  const map = new Map(queue.order.map((item, position) => [item, position]));
  return {
    ...queue,
    items: queue.order.map(i => queue.items[i]!),
    order: queue.order.map((_, i) => i),
    ...(queue.queued ? { queued: queue.queued.map(i => map.get(i)!).filter(i => i !== undefined) } : {}),
  };
}

/** The viewer's queued items still to play, in play order. */
export function queuedNext(queue: AudioQueue): Card[] {
  const waiting = new Set(queue.queued ?? []);
  return queue.order.slice(queue.at + 1).filter(i => waiting.has(i)).map(i => queue.items[i]!);
}

/** What plays after the viewer's queue: the rest of the source (and, with repeat all, its start). */
export function sourceNext(queue: AudioQueue): Card[] {
  const waiting = new Set(queue.queued ?? []);
  return upNext(queue).filter(card => !waiting.has(queue.items.indexOf(card)));
}

/**
 * Play next (`next`: right after the current item) or Add to queue (`last`: after everything the
 * viewer already queued, before the rest of the source).
 */
export function enqueue(queue: AudioQueue, cards: Card[], where: 'next' | 'last'): AudioQueue {
  if (!cards.length) return queue;
  const waiting = new Set(queue.queued ?? []);
  let position = queue.at + 1;
  if (where === 'last') while (position < queue.order.length && waiting.has(queue.order[position]!)) position++;
  const base = queue.items.length;
  const added = cards.map((_, i) => base + i);
  return settle({
    ...queue,
    items: [...queue.items, ...cards],
    order: [...queue.order.slice(0, position), ...added, ...queue.order.slice(position)],
    queued: [...(queue.queued ?? []), ...added],
  });
}

/** Take the item at play position `position` out of the queue (never the one playing). */
export function removeAt(queue: AudioQueue, position: number): AudioQueue {
  if (position === queue.at || position < 0 || position >= queue.order.length) return queue;
  const gone = queue.order[position]!;
  const shift = (i: number) => (i > gone ? i - 1 : i);
  return {
    ...queue,
    items: queue.items.filter((_, i) => i !== gone),
    order: queue.order.filter((_, p) => p !== position).map(shift),
    at: position < queue.at ? queue.at - 1 : queue.at,
    ...(queue.queued ? { queued: queue.queued.filter(i => i !== gone).map(shift) } : {}),
  };
}

/** Move an upcoming item from one play position to another (both after the one playing). A moved
 * item takes the lane it lands in: into the viewer's queue, or out of it into the source. */
export function moveTo(queue: AudioQueue, from: number, to: number): AudioQueue {
  if (from <= queue.at || to <= queue.at || from >= queue.order.length || to >= queue.order.length || from === to) return queue;
  const order = [...queue.order];
  const [item] = order.splice(from, 1) as [number];
  const waiting = new Set(queue.queued ?? []);
  let block = 0;
  while (queue.at + 1 + block < order.length && waiting.has(order[queue.at + 1 + block]!)) block++;
  order.splice(to, 0, item);
  // Inside the viewer's queue (or at its end, if it came from there) it is queued; otherwise source.
  const joins = block > 0 && (to <= queue.at + block || (to === queue.at + block + 1 && waiting.has(item)));
  const queued = (queue.queued ?? []).filter(i => i !== item);
  return settle({ ...queue, order, queued: joins ? [...queued, item] : queued });
}

/** Clear the viewer's queue (Play next / Add to queue items still to play); the source stays. */
export function clearQueued(queue: AudioQueue): AudioQueue {
  let out = queue;
  const waiting = new Set(queue.queued ?? []);
  for (let p = out.order.length - 1; p > out.at; p--) if (waiting.has(out.order[p]!)) out = removeAt(out, p);
  return { ...out, queued: [] };
}

/** Previous: restart the item when it has played more than three seconds, else the one before. */
export function previous(queue: AudioQueue, positionSeconds: number): { queue: AudioQueue; restart: boolean } {
  if (positionSeconds > 3 || (queue.at === 0 && queue.repeat !== 'all')) return { queue, restart: true };
  return { queue: { ...queue, at: queue.at === 0 ? queue.order.length - 1 : queue.at - 1 }, restart: false };
}

/** Shuffle on keeps the current item playing and shuffles the rest after it; off restores album order. */
export function toggleShuffle(queue: AudioQueue, random: Random = Math.random): AudioQueue {
  const playing = queue.order[queue.at] ?? 0;
  // What the viewer queued stays right after the item playing, in its order, either way.
  const mine = queuedNext(queue).map(card => queue.items.indexOf(card));
  const keep = new Set(mine);
  if (queue.shuffle) {
    const rest = queue.items.map((_, i) => i).filter(i => !keep.has(i));
    const at = rest.indexOf(playing);
    return settle({ ...queue, shuffle: false, order: [...rest.slice(0, at + 1), ...mine, ...rest.slice(at + 1)], at });
  }
  const rest = shuffled(queue.items.length, playing, random).filter(i => !keep.has(i));
  return { ...queue, shuffle: true, order: [rest[0]!, ...mine, ...rest.slice(1)], at: 0 };
}

export function cycleRepeat(queue: AudioQueue): AudioQueue {
  return { ...queue, repeat: queue.repeat === 'off' ? 'all' : queue.repeat === 'all' ? 'one' : 'off' };
}

/** Play the item at `itemIndex` (an index into items) now. */
export function jumpTo(queue: AudioQueue, itemIndex: number): AudioQueue {
  const at = queue.order.indexOf(itemIndex);
  if (at < 0) return queue;
  // Jumping ahead plays past whatever the viewer had queued before that item.
  const skipped = new Set(at > queue.at ? queue.order.slice(queue.at + 1, at) : []);
  return played({ ...queue, at, ...(queue.queued ? { queued: queue.queued.filter(i => !skipped.has(i)) } : {}) });
}

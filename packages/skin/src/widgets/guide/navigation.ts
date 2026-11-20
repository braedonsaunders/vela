/** Scroll only enough to keep a target inside a stable central band. */
export function bandOffset(position: number, size: number, offset: number, viewport: number, total: number): number {
  const margin = Math.min(Math.max(size, viewport * 0.18), viewport / 4);
  const next = position < offset + margin ? position - margin
    : position + Math.min(size, viewport - 2 * margin) > offset + viewport - margin
      ? position + Math.min(size, viewport - 2 * margin) - viewport + margin : offset;
  return Math.max(0, Math.min(Math.max(0, total - viewport), next));
}

/** Balanced channel lookahead, independent of total lineup size. */
export function rowWindow(index: number, count: number, visible: number, margin = 12) {
  return { start: Math.max(0, index - margin), end: Math.min(count, index + visible + margin) };
}

/** Fetch farther than we draw, in stable bands: fast touch flings need listings before
 * their cells enter the viewport. One band fits the guide's 100-channel request batch. */
export function prefetchRows(index: number, count: number, visible: number, direction = 1) {
  const budget = Math.min(100, count);
  const showing = Math.min(budget, Math.max(1, Math.ceil(visible)));
  const behind = Math.min(16, Math.floor((budget - showing) / 4));
  const ahead = budget - showing - behind;
  const anchor = direction < 0 ? Math.ceil(index / 20) * 20 : Math.floor(index / 20) * 20;
  const start = Math.max(0, Math.min(Math.max(0, count - budget), anchor - (direction < 0 ? ahead : behind)));
  return { start, end: Math.min(count, start + budget) };
}

/** A cancellable trailing action; selection changes never enqueue stale tunes. */
export class PreviewDebounce {
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(private readonly tune: (id: string) => void, private readonly wait = 180) {}
  select(id: string) {
    this.cancel();
    if (id) this.timer = setTimeout(() => { this.timer = undefined; this.tune(id); }, this.wait);
  }
  cancel() { clearTimeout(this.timer); this.timer = undefined; }
}

/** Stable three-hour request boundaries reuse cache entries as focus advances. */
export function timeWindow(from: number, to: number, offset = 0, minutes = 1440) {
  return { from: Math.max(0, Math.min(minutes - 180, Math.floor((from - offset) / 180) * 180)),
    to: Math.min(minutes, Math.max(180, Math.ceil((to - offset) / 180) * 180)) };
}

/** Complete retained coverage, including adjacent windows; a gap still needs data. */
export function coversRange(ranges: readonly { from: number; to: number }[], from: number, to: number): boolean {
  let end = from;
  for (const range of [...ranges].sort((a, b) => a.from - b.from)) {
    if (range.to <= end) continue;
    if (range.from > end) return false;
    end = range.to;
    if (end >= to) return true;
  }
  return end >= to;
}

/** Reuse native programme views without changing the slot of any programme still visible. */
export class ProgrammeSlots {
  private readonly slots = new Map<string, number>();
  private readonly free: number[] = [];
  private next = 0;
  keys(ids: string[]): number[] {
    const wanted = new Set(ids);
    for (const [id, slot] of this.slots) if (!wanted.has(id)) { this.slots.delete(id); this.free.push(slot); }
    // Replacing an entire recycled row must keep the native child order. A stack of freed
    // slots reverses it and makes React move every native view instead of updating its props.
    this.free.sort((a, b) => b - a);
    return ids.map(id => {
      let slot = this.slots.get(id);
      if (slot === undefined) { slot = this.free.pop() ?? this.next++; this.slots.set(id, slot); }
      return slot;
    });
  }
  ordered<T>(items: T[], id: (item: T) => string): { key: number; index: number; item: T }[] {
    const keys = this.keys(items.map(id));
    return items.map((item, index) => ({ key: keys[index]!, index, item })).sort((a, b) => a.key - b.key);
  }

}

export function remoteDirection(eventType: string): string | undefined {
  const direction = eventType.replace(/^(long|swipe)/i, '').toLowerCase();
  return ({ up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' } as Record<string, string>)[direction];
}

/** A time anchor inside a programme; long programmes must not pull vertical focus to their start. */
export function programmeMinute(programme: { at: number; span: number }, preferred: number): number {
  const end = programme.at + programme.span - Math.min(0.01, programme.span / 2);
  return Math.max(programme.at, Math.min(end, preferred < 0 ? programme.at : preferred));
}

/** Traverse a known gap in one-hour steps, requesting the next window when needed. */
export function gapStep(minute: number, direction: -1 | 1, minutes: number): number {
  return Math.max(0, Math.min(minutes - 0.01, minute + direction * 60));
}

export type TimeTarget = { kind: 'day'; day: number; offset: number } | { kind: 'now'; offset: number };
export function resolveTimeTarget(target: TimeTarget, starts: Record<number, number>, now: number, visible: number, total: number) {
  const at = target.kind === 'day' ? starts[target.day] : now < 0 ? undefined : now;
  if (at === undefined) return undefined;
  const desired = at + target.offset;
  const left = Math.max(0, Math.min(Math.max(0, total - visible), target.kind === 'now' ? desired - visible / 3 : desired));
  return { left, minute: target.kind === 'now' ? Math.max(0, Math.min(total - 0.01, desired)) : left + visible / 3 };
}

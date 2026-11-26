import type { GuideChannel, GuideModel, GuideProgramme } from '@vela/core';

const rows = new WeakMap<GuideChannel, { parts: (GuideChannel | undefined)[]; offsets: number[]; value: GuideChannel }>();

/** Contiguous local-day blocks, each expressed in its own minutes. */
export function timeline(blocks: ReadonlyMap<number, GuideModel>, selected: number): GuideModel & { dayStarts: Record<number, number> } {
  const ordered = [...blocks.entries()].sort(([a], [b]) => a - b);
  if (!ordered.length) throw new Error('An empty guide has no timeline');
  const starts: Record<number, number> = {};
  let minutes = 0;
  for (const [day, block] of ordered) { starts[day] = minutes; minutes += block.minutes; }
  const base = blocks.get(selected) ?? ordered[0]![1];
  const indexed = ordered.map(([day, block]) => ({ offset: starts[day]!, block, channels: new Map(block.channels.map(c => [c.id, c])) }));
  const now = indexed.find(({ block }) => block.nowMinute >= 0);
  return {
    ...base, day: selected, minutes, dayStarts: starts, startsAt: ordered[0]![1].startsAt,
    loadedRanges: indexed.flatMap(({ offset, block }) => (block.loadedRanges ?? [{ from: 0, to: block.minutes }]).map(range => ({ from: range.from + offset, to: range.to + offset }))),
    nowMinute: now ? now.offset + now.block.nowMinute : -1,
    landing: (starts[base.day] ?? 0) + base.landing,
    ticks: indexed.flatMap(({ offset, block }) => block.ticks.map(t => ({ ...t, minute: t.minute + offset }))),
    channels: indexed.length === 1 && indexed[0]!.offset === 0 ? base.channels : base.channels.map(channel => {
      const parts = indexed.map(({ channels }) => channels.get(channel.id));
      const offsets = indexed.map(({ offset }) => offset);
      const previous = rows.get(channel);
      if (previous && previous.parts.length === parts.length && parts.every((part, i) => part === previous.parts[i] && offsets[i] === previous.offsets[i])) return previous.value;
      const value = { ...channel, listed: parts.some(part => part?.listed),
      programmes: parts.flatMap((part, i) => (part?.programmes ?? []).map(p => ({ ...p, at: p.at + offsets[i]! }))).reduce<GuideProgramme[]>((merged, p) => {
        const last = merged[merged.length - 1];
        if (last?.id === p.id && Math.abs(last.at + last.span - p.at) < 0.01) last.span += p.span;
        else merged.push(p);
        return merged;
      }, []) };
      rows.set(channel, { parts, offsets, value });
      return value;
    }),
  };
}

/** Include adjacent days only inside the server's seven-day window. */
export function requestedDays(first: number, last: number, from: number, to: number, total: number, firstAvailable = 0): number[] {
  const days: number[] = [];
  if (from <= 180 && first > firstAvailable) days.push(first - 1);
  if (to >= total - 180 && last < 6) days.push(last + 1);
  return days;
}

/** Preserve the same point in time when new blocks are inserted to the left. */
export function prependOffset(oldStarts: Record<number, number>, newStarts: Record<number, number>, oldOrigin?: number, newOrigin?: number): number {
  if (oldOrigin !== undefined && newOrigin !== undefined) return (oldOrigin - newOrigin) / 60000;
  const anchor = Object.keys(oldStarts).map(Number).find(day => newStarts[day] !== undefined);
  return anchor === undefined ? 0 : newStarts[anchor]! - oldStarts[anchor]!;
}

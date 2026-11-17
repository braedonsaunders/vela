import type { GuideModel, GuideProgramme } from '@vela/core';

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
    ...base, day: selected, minutes, dayStarts: starts,
    nowMinute: now ? now.offset + now.block.nowMinute : -1,
    landing: (starts[base.day] ?? 0) + base.landing,
    ticks: indexed.flatMap(({ offset, block }) => block.ticks.map(t => ({ ...t, minute: t.minute + offset }))),
    channels: base.channels.map(channel => ({
      ...channel,
      programmes: indexed.flatMap(({ offset, channels }) => (channels.get(channel.id)?.programmes ?? []).map(p => ({ ...p, at: p.at + offset }))).reduce<GuideProgramme[]>((merged, p) => {
        const last = merged[merged.length - 1];
        if (last?.id === p.id && Math.abs(last.at + last.span - p.at) < 0.01) last.span += p.span;
        else merged.push(p);
        return merged;
      }, []),
    })),
  };
}

/** Include adjacent days only inside the server's seven-day window. */
export function requestedDays(first: number, last: number, from: number, to: number, total: number): number[] {
  const days: number[] = [];
  if (from <= 180 && first > 0) days.push(first - 1);
  if (to >= total - 180 && last < 6) days.push(last + 1);
  return days;
}

/** Preserve the same point in time when new blocks are inserted to the left. */
export function prependOffset(oldStarts: Record<number, number>, newStarts: Record<number, number>): number {
  const anchor = Object.keys(oldStarts).map(Number).find(day => newStarts[day] !== undefined);
  return anchor === undefined ? 0 : newStarts[anchor]! - oldStarts[anchor]!;
}

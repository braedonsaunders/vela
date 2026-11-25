// The sleep timer's rules, shared by spoken audio and video: pause after some minutes, at the end of
// the chapter, or at the end of the item, holding back whatever would play next.
import type * as V from './wire';

export type SleepMode = 'off' | 'timer' | 'chapter' | 'item';
/** Until a time (ms since the epoch), the end of the chapter set at `endsAt` seconds, or the item's end. */
export interface Sleep { mode: SleepMode; endsAt: number; /** A timer's length, as it was chosen. */ minutes?: number }

export const AWAKE: Sleep = { mode: 'off', endsAt: 0 };

/** A sleep set now: a timer ends `minutes` from `now`; a chapter sleep remembers where it was set,
 * so it ends with that chapter rather than the next. */
export function sleepFrom(mode: SleepMode, minutes: number, now: number, positionSeconds: number): Sleep {
  if (mode === 'timer') return { mode, endsAt: now + minutes * 60_000, minutes };
  return { mode, endsAt: mode === 'chapter' ? positionSeconds : 0 };
}

/** The end of the chapter holding `position`: the next chapter's start where it states no end. */
export function chapterEnd(chapters: V.Chapter[], position: number): number | undefined {
  const sorted = [...chapters].sort((a, b) => a.startSeconds - b.startSeconds);
  const index = sorted.findLastIndex(c => c.startSeconds <= position);
  if (index < 0) return sorted[0]?.startSeconds;
  return sorted[index]!.endSeconds ?? sorted[index + 1]?.startSeconds;
}

/** Whether to pause now, from a progress report: the timer ran out, or the chapter it was set in ended. */
export function sleepDue(sleep: Sleep, now: number, positionSeconds: number, chapters: V.Chapter[] = []): boolean {
  if (sleep.mode === 'timer') return now >= sleep.endsAt;
  if (sleep.mode === 'chapter') {
    const end = chapterEnd(chapters, sleep.endsAt);
    return end !== undefined && positionSeconds >= end - 0.3;
  }
  return false;
}

/** Whether the item's end is where the viewer falls asleep: nothing after it starts on its own. */
export function holdsNext(sleep: Sleep): boolean {
  return sleep.mode === 'item' || sleep.mode === 'chapter';
}

/** Milliseconds until a timer runs out (0 when due, or for any other mode). */
export function sleepLeftMs(sleep: Sleep, now: number): number {
  return sleep.mode === 'timer' ? Math.max(0, sleep.endsAt - now) : 0;
}

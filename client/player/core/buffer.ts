import type { DecodedVideoFrame } from './types';

/** Bounded presentation queue. The scheduler, not a decoder callback, owns frames. */
export class VideoBuffer<T extends DecodedVideoFrame> {
  private frames: T[] = [];
  constructor(readonly capacity = 8) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) throw new Error('Invalid video buffer capacity');
  }
  get length(): number {
    return this.frames.length;
  }
  get full(): boolean {
    return this.length >= this.capacity;
  }
  get nextTimestampUs(): number | null {
    return this.frames[0]?.timestampUs ?? null;
  }
  bufferedEnd(positionUs: number, displayedEndUs: number): number {
    let end = Math.max(positionUs, displayedEndUs);
    for (const frame of this.frames) {
      if (frame.timestampUs > end + 2000) break;
      end = Math.max(end, frame.timestampUs + frame.durationUs);
    }
    return end;
  }
  push(frame: T, epoch: number): boolean {
    if (
      frame.epoch !== epoch ||
      !Number.isFinite(frame.timestampUs) ||
      !Number.isFinite(frame.durationUs) ||
      frame.durationUs < 0
    ) {
      frame.release();
      return false;
    }
    if (this.full) {
      frame.release();
      throw new Error('Video decoder exceeded presentation backpressure');
    }
    const index = this.frames.findIndex((other) => other.timestampUs > frame.timestampUs);
    this.frames.splice(index < 0 ? this.frames.length : index, 0, frame);
    return true;
  }
  /** Keep the newest due frame. Future frames remain queued; preroll never paints. */
  takeDue(
    positionUs: number,
    epoch: number,
    minimumUs = 0,
  ): { frame: T | null; dropped: number; firstDroppedUs: number | null } {
    let frame: T | null = null,
      dropped = 0,
      firstDroppedUs: number | null = null;
    while (this.frames.length && this.frames[0].timestampUs <= positionUs) {
      const next = this.frames.shift()!;
      if (
        next.epoch !== epoch ||
        (next.timestampUs < minimumUs && next.timestampUs + next.durationUs <= minimumUs)
      ) {
        next.release();
        continue;
      }
      if (frame) {
        firstDroppedUs ??= frame.timestampUs;
        frame.release();
        dropped++;
      }
      frame = next;
    }
    return { frame, dropped, firstDroppedUs };
  }
  clear(): void {
    for (const frame of this.frames) frame.release();
    this.frames = [];
  }
}

import { VideoBuffer } from './buffer';
import { MediaClock } from './clock';
import type { DecodedVideoFrame } from './types';

/** Vela's presentation scheduler; no upstream frame loop or playback controller. */
export class VideoScheduler<T extends DecodedVideoFrame> {
  readonly buffer = new VideoBuffer<T>(8);
  readonly dropEvents: {
    epoch: number;
    clockUs: number;
    targetUs: number;
    firstDroppedUs: number | null;
    selectedUs: number | null;
    presentedBefore: number;
  }[] = [];
  readonly metrics = { presented: 0, dropped: 0, preroll: 0, lastLagUs: 0, maxLagUs: 0 };
  private epoch = 0;
  private targetUs = 0;
  private request: number | null = null;
  private active = false;
  private preview = false;
  private hasPresented = false;
  private displayedEndUs = 0;
  bufferedEnd(positionUs: number) {
    return this.buffer.bufferedEnd(positionUs, this.displayedEndUs);
  }
  constructor(
    readonly clock: MediaClock,
    private readonly present: (frame: T, positionUs: number) => boolean,
    private readonly onFailure: (error: unknown) => void,
    private readonly onPresent: () => void,
  ) {}

  reset(epoch: number, targetUs: number, preview = false): void {
    this.stop();
    this.buffer.clear();
    this.epoch = epoch;
    this.targetUs = targetUs;
    this.preview = preview;
    this.hasPresented = false;
    this.displayedEndUs = targetUs;
  }
  push(frame: T): void {
    if (frame.epoch !== this.epoch) {
      frame.release();
      return;
    }
    if (frame.timestampUs < this.targetUs && frame.timestampUs + frame.durationUs <= this.targetUs) {
      this.metrics.preroll++;
      frame.release();
      return;
    }
    this.buffer.push(frame, this.epoch);
    if (this.active) this.schedule();
  }
  setPreview(preview: boolean): void {
    this.preview = preview;
  }
  start(): void {
    this.active = true;
    this.schedule();
  }
  stop(): void {
    this.active = false;
    if (this.request !== null) cancelAnimationFrame(this.request);
    this.request = null;
  }
  private schedule(): void {
    if (this.request !== null) return;
    this.request = requestAnimationFrame(() => {
      this.request = null;
      this.tick();
    });
  }
  private tick(): void {
    if (!this.active) return;
    try {
      const position = this.clock.time();
      const next = this.buffer.nextTimestampUs;
      const deadline =
        this.preview && !this.hasPresented && next !== null && next <= this.targetUs + 100000
          ? Math.max(position, next)
          : position;
      const selected = this.buffer.takeDue(deadline, this.epoch, this.targetUs);
      this.metrics.dropped += selected.dropped;
      if (selected.dropped) {
        this.dropEvents.push({
          epoch: this.epoch,
          clockUs: position,
          targetUs: this.targetUs,
          firstDroppedUs: selected.firstDroppedUs,
          selectedUs: selected.frame?.timestampUs ?? null,
          presentedBefore: this.metrics.presented,
        });
        if (this.dropEvents.length > 8) this.dropEvents.shift();
      }
      if (selected.frame) {
        try {
          if (this.present(selected.frame, position)) {
            this.hasPresented = true;
            this.displayedEndUs = selected.frame.timestampUs + selected.frame.durationUs;
            this.metrics.presented++;
            this.metrics.lastLagUs = position - selected.frame.timestampUs;
            this.metrics.maxLagUs = Math.max(this.metrics.maxLagUs, Math.abs(this.metrics.lastLagUs));
            this.onPresent();
          }
        } finally {
          selected.frame.release();
        }
      }
    } catch (error) {
      this.stop();
      this.onFailure(error);
      return;
    }
    this.schedule();
  }
  dispose(): void {
    this.stop();
    this.buffer.clear();
  }
}

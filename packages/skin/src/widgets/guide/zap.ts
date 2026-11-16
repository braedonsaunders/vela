// Channel flicking: each step moves a dialled channel through the guide's order, wrapping at the
// ends, and the channel is tuned only once the viewer pauses. Holding a key never opens a session
// per channel passed.
import type { GuideChannel } from '@vela/core';

export class Zap {
  target = '';
  /** The channel flicking started from; landing back on it tunes nothing. */
  private origin = '';
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly wait: number,
    private readonly channels: () => GuideChannel[],
    private readonly tune: (channelId: string) => void,
    private readonly changed: () => void,
  ) {}

  step(step: number, from: string): void {
    const ids = this.channels().map(c => c.id);
    if (ids.length === 0) return;
    if (!this.target) this.origin = from;
    const at = ids.indexOf(this.target || from);
    const next = at < 0 ? 0 : (((at + step) % ids.length) + ids.length) % ids.length;
    this.target = ids[next]!;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.commit(), this.wait);
    this.changed();
  }

  /** Tune the dialled channel now (Enter, or the pause after the last step). */
  commit(): void {
    const target = this.target;
    const origin = this.origin;
    this.clear();
    if (target && target !== origin) this.tune(target);
    this.changed();
  }

  cancel(): void {
    if (!this.target) return;
    this.clear();
    this.changed();
  }

  private clear(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.target = '';
    this.origin = '';
  }
}

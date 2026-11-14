import type { Interaction } from '../../../protocol/v0/types';
import type { ServerAdapter } from '../adapter';

/** Only enqueue events supplied by the UI. A failed batch remains queued for retry. */
export class InteractionQueue {
  private pending: Interaction[] = [];
  private batch?: { idempotencyKey: string; interactions: Interaction[] };
  private sending?: Promise<void>;
  constructor(private adapter: ServerAdapter, private limit = 256) {}
  add(interaction: Interaction): boolean {
    if (this.pending.length + (this.batch?.interactions.length ?? 0) >= this.limit) return false;
    if (interaction.kind === 'visible') {
      const prior = this.pending.find(x => x.kind === 'visible' && x.receiptToken === interaction.receiptToken && x.sessionId === interaction.sessionId);
      if (prior) { prior.visibleMilliseconds = Math.max(prior.visibleMilliseconds ?? 0, interaction.visibleMilliseconds ?? 0); return true; }
    }
    this.pending.push({ ...interaction });
    return true;
  }
  flush(idempotencyKey: string): Promise<void> {
    if (this.sending) return this.sending;
    if (!this.batch && this.pending.length) this.batch = { idempotencyKey, interactions: this.pending.splice(0) };
    if (!this.batch) return Promise.resolve();
    const batch = this.batch;
    this.sending = this.adapter.interactions(batch).then(() => { if (this.batch === batch) this.batch = undefined; }).finally(() => { this.sending = undefined; });
    return this.sending;
  }
}

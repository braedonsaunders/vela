import type { Interaction } from '../../wire/v0/types';
import type { ServerAdapter } from '../adapter';
import { randomId } from '../protocol/id';

/** Only enqueue events supplied by the UI. A failed batch remains queued for retry. */
export class InteractionQueue {
  private pending: Interaction[] = [];
  private batch?: { idempotencyKey: string; interactions: Interaction[]; wireKey?: string };
  private sending?: Promise<void>;
  constructor(private adapter: ServerAdapter, private limit = 256) {}
  get size(): number { return this.pending.length + (this.batch?.interactions.length ?? 0); }
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
    if (!this.batch && this.pending.length) this.batch = { idempotencyKey, interactions: this.pending.splice(0, 100) };
    if (!this.batch) return Promise.resolve();
    const batch = this.batch;
    this.sending = (async () => {
      // Browsers expose getRandomValues on insecure LAN HTTP, but not SubtleCrypto.
      // A retry retains the same wire key and exact batch body.
      if (!batch.wireKey) {
        const bytes = new TextEncoder().encode(JSON.stringify(batch.interactions));
        let suffix: string;
        if (crypto.subtle) {
          const digest = await crypto.subtle.digest('SHA-256', bytes);
          suffix = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
        } else {
          // The sequence may restart in deterministic agent drives. Fold in the
          // body as well as a random nonce so distinct batches do not replay it.
          let a = 2166136261, b = 2246822519;
          for (const byte of bytes) { a = Math.imul(a ^ byte, 16777619); b = Math.imul(b ^ byte, 3266489917); }
          suffix = `${randomId()}-${(a >>> 0).toString(16)}${(b >>> 0).toString(16)}`;
        }
        batch.wireKey = `${batch.idempotencyKey}-${suffix}`;
      }
      await this.adapter.interactions({ idempotencyKey: batch.wireKey, interactions: batch.interactions });
      if (this.batch === batch) this.batch = undefined;
    })().finally(() => { this.sending = undefined; });
    return this.sending;
  }
}

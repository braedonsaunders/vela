import type { Interaction } from '../../wire/v0/types';
import type { Interactions } from '../adapter/capabilities';
import { randomId } from '../protocol/id';
import { VelaError } from '../adapter/errors';

/** Only enqueue events supplied by the UI. A failed batch remains queued for retry. */
export class InteractionQueue {
  private pending: Interaction[] = [];
  private batch?: { idempotencyKey: string; interactions: Interaction[]; wireKey?: string };
  private sending?: Promise<boolean>;
  private attempts = 0;
  private retryAt = 0;
  private stopped = false;
  constructor(private adapter: Interactions, private limit = 256) {}
  get size(): number { return this.pending.length + (this.batch?.interactions.length ?? 0); }
  get disabled(): boolean { return this.stopped; }
  add(interaction: Interaction): boolean {
    if (this.stopped) return false;
    if (this.pending.length + (this.batch?.interactions.length ?? 0) >= this.limit) return false;
    if (interaction.kind === 'visible') {
      const prior = this.pending.find(x => x.kind === 'visible' && x.receiptToken === interaction.receiptToken && x.sessionId === interaction.sessionId);
      if (prior) { prior.visibleMilliseconds = Math.max(prior.visibleMilliseconds ?? 0, interaction.visibleMilliseconds ?? 0); return true; }
    }
    this.pending.push({ ...interaction });
    return true;
  }
  flush(idempotencyKey: string, at: number): Promise<boolean> {
    if (this.sending) return this.sending;
    if (this.stopped || !Number.isFinite(at) || at < this.retryAt) return Promise.resolve(false);
    if (!this.batch && this.pending.length) this.batch = { idempotencyKey, interactions: this.pending.splice(0, 100) };
    if (!this.batch) return Promise.resolve(true);
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
      await this.adapter.sendInteractions({ idempotencyKey: batch.wireKey, interactions: batch.interactions });
      if (this.batch === batch) this.batch = undefined;
      this.attempts = 0; this.retryAt = 0;
      return true;
    })().catch(error => {
      this.attempts++;
      const policy = error instanceof VelaError ? error.detail?.retry : undefined;
      const limit = policy?.maxAttempts !== undefined && Number.isFinite(policy.maxAttempts) ? Math.max(1, Math.min(3, Math.floor(policy.maxAttempts))) : 3;
      if ((policy && !policy.allowed) || this.attempts >= limit) { this.stopped = true; return false; }
      let wait = policy?.afterSeconds !== undefined && Number.isFinite(policy.afterSeconds) ? Math.max(0, policy.afterSeconds * 1000) : 5000;
      if (error instanceof VelaError && error.retryAfter) {
        const seconds = Number(error.retryAfter);
        const date = Date.parse(error.retryAfter);
        if (Number.isFinite(seconds) && seconds >= 0) wait = Math.max(wait, seconds * 1000);
        else if (Number.isFinite(date)) wait = Math.max(wait, date - at);
      }
      this.retryAt = at + Math.max(1000, wait);
      return false;
    }).finally(() => { this.sending = undefined; });
    return this.sending;
  }
}

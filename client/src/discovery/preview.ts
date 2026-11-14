import type { ClientCapabilities, PreviewGrant } from '../../wire/v0/types';
import type { ServerAdapter } from '../adapter';

type Preview = { cardId: string; url: string; expiresAt: number; retryAfterSeconds: number; generation: number };
const empty = (generation: number, retryAfterSeconds = 0): Preview => ({ cardId: '', url: '', expiresAt: 0, retryAfterSeconds, generation });

/** One broker grant per viewer; serial requests and fence late answers by intent. */
export class PreviewCoordinator {
  private generation = 0;
  private grant?: PreviewGrant;
  private tail: Promise<void> = Promise.resolve();
  constructor(private api: ServerAdapter, private origin: string, private client: ClientCapabilities, private key: () => string) {}
  setClient(client: ClientCapabilities): void { this.client = client; }
  private async stop(grant: PreviewGrant): Promise<void> {
    await this.api.command(grant.sessionId, { kind: 'stop', idempotencyKey: this.key(), sourceGeneration: grant.sourceGeneration, seekGeneration: grant.seekGeneration });
  }
  cancel(generation: number): Promise<void> {
    if (generation <= this.generation) return Promise.resolve();
    this.generation = generation;
    const grant = this.grant;
    this.grant = undefined;
    const previous = this.tail;
    const operation = previous.then(async () => { if (grant) await this.stop(grant); });
    this.tail = operation.catch(() => {});
    return operation;
  }
  request(id: string, generation: number, now: number): Promise<Preview> {
    if (generation < this.generation) return Promise.resolve(empty(generation));
    const advance = this.cancel(generation);
    const operation = this.tail.then(async () => {
      await advance;
      if (generation !== this.generation) return empty(generation);
      const result = await this.api.trailerPreview(id, { idempotencyKey: this.key(), client: this.client });
      if (result.state !== 'ready') return empty(generation, generation === this.generation && result.state === 'preparing' && Number.isFinite(result.retryAfterSeconds) ? Math.max(1, result.retryAfterSeconds) : 0);
      const grant = result.grant;
      const expiresAt = Date.parse(grant.expiresAt);
      let url: URL | undefined;
      try { url = new URL(grant.url, `${this.origin}/`); } catch { /* Refuse malformed broker URLs. */ }
      if (generation !== this.generation || grant.purpose !== 'preview' || !url || url.origin !== this.origin || !url.pathname.startsWith('/sessions/media/') || !Number.isFinite(expiresAt) || expiresAt <= now) {
        await this.stop(grant);
        return empty(generation);
      }
      this.grant = grant;
      return { cardId: id, url: url.href, expiresAt, retryAfterSeconds: 0, generation };
    });
    this.tail = operation.then(() => {}, () => {});
    return operation;
  }
}

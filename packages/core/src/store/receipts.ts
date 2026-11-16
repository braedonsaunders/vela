// Ranking receipts: which cards the viewer saw, selected and played. Visible receipts are
// coalesced and sent in batches; a selection or play flushes at once. A server without the
// Interactions capability accepts none, and nothing is queued for it.
import { hasInteractions } from '../adapter/capabilities';
import { InteractionQueue } from '../telemetry';
import type { Session } from './session';

export type ReceiptKind = 'visible' | 'selected' | 'played';

const BATCH = 16;

export class Receipts {
  private queue: InteractionQueue | undefined;

  constructor(private readonly session: Session) {
    session.onReset(() => {
      this.queue = undefined;
    });
  }

  /** Record one receipt; resolves false when the server takes none (or stopped taking them). */
  async record(receipt: string, kind: ReceiptKind): Promise<boolean> {
    if (!receipt) return false;
    const api = (await this.session.ready()).adapter;
    if (!hasInteractions(api)) return false;
    this.queue ??= new InteractionQueue(api);
    const at = Date.now();
    if (!this.queue.add({ receiptToken: receipt, kind, occurredAt: new Date(at).toISOString() })) return false;
    if (kind !== 'visible' || this.queue.size >= BATCH) await this.queue.flush(this.session.key(), at);
    return !this.queue.disabled;
  }

  /** Send everything queued: when the app is hidden, and before signing out. */
  async flush(): Promise<boolean> {
    const queue = this.queue;
    while (queue?.size) {
      if (!(await queue.flush(this.session.key(), Date.now()))) return false;
    }
    return true;
  }
}

// Trailer previews on focus: one muted preview grant at a time for the viewer, on a server that
// offers them (Ether's broker). Each focus is a new generation; a later focus cancels an earlier
// one, and its grant's session is stopped at the server.
import type * as V from '../wire';
import { hasTrailerPreviews } from '../adapter/capabilities';
import { PreviewCoordinator } from '../discovery/preview';
import type { Session } from './session';

export interface Preview {
  cardId: string;
  url: string;
  expiresAt: number;
  /** While the server prepares the preview: when to ask again (0: do not). */
  retryAfterSeconds: number;
  generation: number;
}

const none = (generation: number): Preview => ({ cardId: '', url: '', expiresAt: 0, retryAfterSeconds: 0, generation });

export class Previews {
  private coordinator: PreviewCoordinator | undefined;
  private generation = 0;

  constructor(private readonly session: Session) {
    session.onReset(() => {
      void this.coordinator?.cancel(++this.generation).catch(() => {});
      this.coordinator = undefined;
    });
  }

  /** Ask for a card's preview; an older focus's answer comes back empty. */
  async request(cardId: string): Promise<Preview> {
    const generation = ++this.generation;
    const epoch = this.session.epoch;
    const connection = await this.session.ready();
    const adapter = connection.adapter;
    const offered = this.session.features?.trailerPreview?.available === true;
    if (epoch !== this.session.epoch || generation !== this.generation || !offered || !hasTrailerPreviews(adapter)) {
      return none(generation);
    }
    const client = await this.session.declared();
    this.coordinator ??= new PreviewCoordinator(adapter, connection.record.origin, client, () => this.session.key());
    return this.coordinator.request(cardId, generation, Date.now());
  }

  /** The player declared new capabilities: later preview requests carry them. */
  setClient(client: V.ClientCapabilities): void {
    this.coordinator?.setClient(client);
  }

  /** Focus left the card: stop its preview. */
  async cancel(): Promise<void> {
    const generation = ++this.generation;
    await this.coordinator?.cancel(generation);
  }
}

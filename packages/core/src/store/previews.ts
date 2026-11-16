// Trailer previews: one muted preview at a time, on a server that offers them (Ether's broker).
// What plays is the card the viewer rests on in a preview row, else the hero on show when the
// server marked it previewable. Each change of mind is a new generation: the previous grant's
// session is stopped, and the new one is asked for only after a dwell (700 ms on a card, three
// seconds on a new hero slide). A trailer the server is still preparing is asked again at its
// delay, doubled per attempt, at most three times; a grant is dropped when it expires.
import type * as V from '../wire';
import { hasTrailerPreviews } from '../adapter/capabilities';
import { PreviewCoordinator } from '../discovery/preview';
import type { Session } from './session';
import type { StateBox } from './state';
import type { VelaState } from './index';

/** The preview playing now: a card's or the hero's (the other id is ''), and its media URL. */
export interface PreviewState {
  cardId: string;
  heroId: string;
  url: string;
  expiresAt: number;
}

export const initialPreviews: PreviewState = { cardId: '', heroId: '', url: '', expiresAt: 0 };

/** Where previews may play, as the app sees it. */
export interface PreviewContext {
  /** Home is in front, visible, with no query open and motion allowed. */
  allowed: boolean;
  /** The hero on show when the server marked it previewable, else ''. */
  heroId: string;
}

const CARD_DWELL_MS = 700;
const HERO_DWELL_MS = 3000;
const MAX_ATTEMPTS = 3;

export class Previews {
  private coordinator: PreviewCoordinator | undefined;
  private generation = 0;
  private attempts = 0;
  private target = { cardId: '', rowId: '' };
  private context: PreviewContext = { allowed: false, heroId: '' };
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly box: StateBox<VelaState>,
    private readonly session: Session,
  ) {
    session.onReset(() => {
      this.target = { cardId: '', rowId: '' };
      void this.coordinator?.cancel(++this.generation).catch(() => {});
      this.coordinator = undefined;
      this.stopTimer();
      this.box.update('previews', () => initialPreviews);
    });
  }

  /** The app's view changed: whether previews may play, and which hero is on show. */
  setContext(context: PreviewContext): void {
    const previous = this.context;
    const wanted = this.desired();
    this.context = context;
    // Only a change in what should play restarts: the hero carousel moving on while a card's
    // trailer plays must not stop that trailer.
    if (this.desired() === wanted) return;
    const newSlide = context.heroId !== previous.heroId && !this.target.cardId;
    this.restart(newSlide ? HERO_DWELL_MS : CARD_DWELL_MS);
  }

  /** Hover or focus came to (`on`) or left a card of a preview row. */
  intent(cardId: string, rowId: string, on: boolean): void {
    if (on) {
      if (!this.previewable(cardId, rowId)) return;
      if (this.target.cardId === cardId && this.target.rowId === rowId) return;
      this.target = { cardId, rowId };
      this.restart(CARD_DWELL_MS);
      return;
    }
    const matches = (!rowId || rowId === this.target.rowId) && (!cardId || cardId === this.target.cardId);
    if (!this.target.cardId || !matches) return;
    this.target = { cardId: '', rowId: '' };
    this.restart(CARD_DWELL_MS);
  }

  /** The player declared new capabilities: later preview requests carry them. */
  setClient(client: V.ClientCapabilities): void {
    this.coordinator?.setClient(client);
  }

  /** A card is previewable only inside a home row the server marked for previews. */
  private previewable(cardId: string, rowId: string): boolean {
    const rows = this.box.get().home.value?.rows ?? [];
    return rows.some(row => row.id === rowId && row.previewOnFocus && row.items.some(card => card.id === cardId));
  }

  private desired(): string {
    if (!this.context.allowed) return '';
    return this.target.cardId || this.context.heroId;
  }

  /** A change of mind: stop what plays, and ask for what is wanted after the dwell. */
  private restart(dwell: number): void {
    const generation = ++this.generation;
    this.attempts = 0;
    this.stopTimer();
    this.box.update('previews', previews => (previews.url ? initialPreviews : previews));
    void this.coordinator?.cancel(generation).catch(() => {});
    if (this.desired()) this.timer = setTimeout(() => void this.ask(generation), dwell);
  }

  private async ask(generation: number): Promise<void> {
    const wanted = this.desired();
    if (generation !== this.generation || !wanted) return;
    const epoch = this.session.epoch;
    let preview: Awaited<ReturnType<PreviewCoordinator['request']>>;
    try {
      const coordinator = await this.coordinatorFor();
      if (!coordinator || epoch !== this.session.epoch) return;
      preview = await coordinator.request(wanted, generation, Date.now());
    } catch {
      return;
    }
    if (generation !== this.generation || epoch !== this.session.epoch || wanted !== this.desired()) return;
    if (preview.cardId === wanted && preview.url) {
      const card = this.target.cardId === wanted;
      this.box.update('previews', () => ({
        cardId: card ? wanted : '',
        heroId: card ? '' : wanted,
        url: preview.url,
        expiresAt: preview.expiresAt,
      }));
      this.timer = setTimeout(() => this.restart(0), Math.max(0, preview.expiresAt - Date.now()));
      return;
    }
    if (preview.retryAfterSeconds > 0 && this.attempts < MAX_ATTEMPTS) {
      const delay = preview.retryAfterSeconds * 1000 * 2 ** this.attempts;
      this.attempts++;
      this.timer = setTimeout(() => void this.ask(generation), delay);
    }
  }

  /** The broker's coordinator for the selected server, or none when it offers no previews. */
  private async coordinatorFor(): Promise<PreviewCoordinator | undefined> {
    const connection = await this.session.ready();
    const adapter = connection.adapter;
    if (this.session.features?.trailerPreview?.available !== true || !hasTrailerPreviews(adapter)) return undefined;
    const client = await this.session.declared();
    this.coordinator ??= new PreviewCoordinator(adapter, connection.record.origin, client, () => this.session.key());
    return this.coordinator;
  }

  private stopTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }
}

// Media titles beyond video (docs/media-kinds.md): a title's children read whole (an album's
// tracks, an artist's albums, a series' books, an audiobook's parts) and reading: a document
// grant and the viewer's shared reading progress.
import type * as V from '../wire';
import type { Card, DetailModel } from '../models';
import { entry } from '../discovery/models';
import { hasReading, hasTitleChildren } from '../adapter/capabilities';
import { childrenKey, pluginLevelsOf } from '../plugin-levels';
import type { Session } from './session';
import { failed, loading, ready, type Loadable, type StateBox } from './state';
import type { VelaState } from './index';

export interface ChildrenModel { items: Card[]; complete: boolean }
export interface MediaFeatures {
  classes: V.MediaClass[];
  /** Readable formats: reading needs its own endpoint, so only what the server advertises. */
  reading: V.ReadingFormat[];
  /** Children are read one child level at a time (features.pluginLevels.childRoles). */
  childRoles: boolean;
  /** Audio plays through the ordinary playback path: off only when the server says so. */
  audio: boolean;
}

/** At most this many children are read for one page (an album's tracks, an artist's albums). */
const MAX_CHILDREN = 1000;

export class Media {
  /** The last reading-progress write, so leaving a book waits for it before shelves are re-read. */
  private saving: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly box: StateBox<VelaState>,
    private readonly session: Session,
    private readonly artWidth: () => number,
    /** Continue rows (Home's and the libraries') are read again: they show the book's new place. */
    private readonly progressChanged: () => void = () => {},
  ) {
    session.onReset(() => this.box.update('children', () => ({})));
  }

  /** What the server offers for media classes; empty for servers that predate them. */
  features(): MediaFeatures {
    const features = this.session.features;
    return {
      classes: features?.mediaClasses?.available ? features.mediaClasses.classes ?? [] : [],
      reading: features?.reading?.available ? features.reading.formats ?? [] : [],
      childRoles: pluginLevelsOf(features).childRoles,
      // A server that predates the flag already plays audio-only titles through POST /playback;
      // only an explicit `audioPlayback: { available: false }` turns listening off.
      audio: features?.audioPlayback?.available !== false,
    };
  }

  /** A title's children in the server's order, every page, read once unless `refresh`. `role`
   * reads one child level (an artist's concerts), held under childrenKey(id, role); a server
   * without child roles is never sent one. */
  async children(id: string, refresh = false, role?: string): Promise<void> {
    const filter = role && pluginLevelsOf(this.session.features).childRoles ? role : undefined;
    if (role && !filter) return;
    const key = childrenKey(id, filter);
    const previous = this.box.get().children[key];
    if (previous && previous.load !== 'failed' && !refresh) return;
    const epoch = this.session.epoch;
    const set = (value: Loadable<ChildrenModel>) => this.box.update('children', map => ({ ...map, [key]: value }));
    if (!previous?.value) set(loading(previous));
    try {
      const connection = await this.session.ready();
      const adapter = connection.adapter;
      if (!hasTitleChildren(adapter)) throw new Error('Title children are unavailable');
      const images = await connection.images();
      const items: Card[] = [];
      let cursor: string | undefined, complete = false;
      while (items.length < MAX_CHILDREN) {
        const page: V.ChildrenPage = await adapter.children(id, cursor, 100, filter);
        items.push(...page.items.map(title => entry({ id: title.id, kind: 'title', title, receiptToken: '' }, images, this.artWidth())));
        if (page.continuation !== 'more' || !page.nextCursor) { complete = page.continuation === 'exhausted'; break; }
        cursor = page.nextCursor;
      }
      if (epoch === this.session.epoch) set(ready({ items, complete }));
    } catch (error) {
      if (epoch === this.session.epoch) set(failed(error, previous));
    }
  }

  /** A short-lived URL for a readable title's document, with the viewer's saved place. */
  async openReading(id: string): Promise<V.ReadingGrant> {
    const connection = await this.session.ready();
    const adapter = connection.adapter;
    if (!hasReading(adapter)) throw new Error('Reading is unavailable');
    const grant = await adapter.openReading(id, { idempotencyKey: this.session.key() });
    return { ...grant, url: readingURL(grant.url, connection.record.origin) };
  }

  /** Save where the viewer is; every drawn copy of the title shows it at once. */
  async saveReadingProgress(id: string, locator: string, fraction: number, label?: string, observedAt = new Date().toISOString()): Promise<void> {
    const value = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0));
    this.applyReading(id, locator, value, label);
    const save = (async () => {
      const adapter = (await this.session.ready()).adapter;
      if (!hasReading(adapter)) return;
      await adapter.saveReadingProgress(id, { idempotencyKey: this.session.key(), locator, fraction: value, ...(label ? { label } : {}), observedAt });
    })();
    this.saving = save.catch(() => undefined);
    await save;
  }

  /** The viewer left a book: once its last place is saved, the progress shelves are read again. */
  async finishedReading(): Promise<void> {
    await this.saving;
    this.progressChanged();
  }

  private applyReading(id: string, locator: string, fraction: number, label?: string): void {
    const update = (card: Card): Card => card.id === id && card.media
      ? { ...card, played: card.played || fraction >= 0.98, media: { ...card.media, readingLocator: locator, readingFraction: fraction, readingLabel: label ?? card.media.readingLabel } }
      : card;
    this.box.update('titles', titles => {
      const known = titles[id];
      if (!known?.value) return titles;
      const detail: DetailModel = { ...known.value, title: known.value.title.map(update) };
      return { ...titles, [id]: { ...known, value: detail } };
    });
    this.box.update('children', map => {
      let changed = false;
      const next: typeof map = {};
      for (const [key, value] of Object.entries(map)) {
        if (value.value?.items.some(card => card.id === id)) {
          changed = true;
          next[key] = { ...value, value: { ...value.value, items: value.value.items.map(update) } };
        } else next[key] = value;
      }
      return changed ? next : map;
    });
  }
}

/** A reading grant's URL, resolved on the server's origin; anything elsewhere or carrying credentials is refused. */
export function readingURL(value: string, origin: string): string {
  const parsed = new URL(value, `${origin.replace(/\/$/, '')}/`);
  if (parsed.origin !== new URL(origin).origin || parsed.username || parsed.password) throw new Error('Reading URL outside the selected server');
  return parsed.href;
}

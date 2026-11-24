// The music app's server reads (docs/media-kinds.md): a viewer's likes of one role, a page at a
// time (Liked Songs, saved albums, followed artists), and a title's lyrics. Both exist only where
// the server advertises them (features.favoritesList, features.lyrics).
import type * as V from '../wire';
import { hasMusicLibrary } from '../adapter/capabilities';
import { card } from '../discovery/models';
import type { Card } from '../models';
import type { Session } from './session';
import { failed, loading, ready, type Loadable, type StateBox } from './state';
import type { VelaState } from './index';

export interface LikedList { items: (Card & { likedAt: string })[]; total: number; cursor: string; more: boolean }
export interface Lyrics { lines: { startMs: number; text: string }[]; plain: string; instrumental: boolean; source: string }

export interface MusicState {
  liked: Record<string, Loadable<LikedList>>;
  /** null: the title has no lyrics. */
  lyrics: Record<string, Loadable<Lyrics | null>>;
}

export const initialMusic: MusicState = { liked: {}, lyrics: {} };

export class Music {
  constructor(private readonly box: StateBox<VelaState>, private readonly session: Session, private readonly artWidth: () => number) {
    session.onReset(() => this.box.update('music', () => initialMusic));
  }

  get likedAvailable(): boolean { return this.session.features?.favoritesList?.available === true; }
  get lyricsAvailable(): boolean { return this.session.features?.lyrics?.available === true; }

  /** The viewer's likes of `role`; `more` reads the next page, `refresh` the first again. */
  async liked(role: string, more = false, refresh = false): Promise<void> {
    if (!this.likedAvailable) return;
    const current = this.box.get().music.liked[role];
    if (current?.load === 'loading') return;
    if (current?.value && !more && !refresh && current.load !== 'failed') return;
    if (more && !current?.value?.more) return;
    this.set('liked', role, loading(current));
    try {
      const connection = await this.session.ready();
      if (!hasMusicLibrary(connection.adapter)) throw new Error('Liked lists are unavailable');
      const page = await connection.adapter.favoriteTitles(role, more ? current?.value?.cursor : undefined, 100);
      const images = await connection.images();
      const items = page.items.map(item => ({ ...card(item.title as V.Title, item.receiptToken, images, this.artWidth()), likedAt: item.likedAt }));
      const before = more ? current?.value?.items ?? [] : [];
      this.set('liked', role, ready({ items: [...before, ...items], total: page.total, cursor: page.nextCursor ?? '', more: page.continuation === 'more' }));
    } catch (error) {
      this.set('liked', role, failed(error, current));
    }
  }

  async lyrics(id: string): Promise<void> {
    if (!this.lyricsAvailable) return;
    const current = this.box.get().music.lyrics[id];
    if (current && current.load !== 'failed') return;
    this.set('lyrics', id, loading(current));
    try {
      const connection = await this.session.ready();
      if (!hasMusicLibrary(connection.adapter)) throw new Error('Lyrics are unavailable');
      const answer = await connection.adapter.titleLyrics(id);
      this.set('lyrics', id, ready(answer ? { lines: answer.lines, plain: answer.plain ?? '', instrumental: answer.instrumental, source: answer.source ?? '' } : null));
    } catch (error) {
      this.set('lyrics', id, failed(error, current));
    }
  }

  private set<K extends keyof MusicState>(field: K, key: string, value: MusicState[K][string]): void {
    this.box.update('music', music => ({ ...music, [field]: { ...music[field], [key]: value } }));
  }
}

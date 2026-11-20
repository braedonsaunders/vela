import type * as V from '../wire';
import { hasViewerPlaylists } from '../adapter/capabilities';
import { artworkURL } from '../discovery/artwork';
import { entry } from '../discovery/models';
import type { CollectionModel, PlaylistModel } from '../models';
import type { Session } from './session';
import { failed, idle, loading, ready, type Loadable, type StateBox } from './state';
import type { VelaState } from './index';

export interface PlaylistsState {
  list: Loadable<PlaylistModel[]>;
  memberships: Record<string, Loadable<V.TitlePlaylistMembership[]>>;
  notice: string;
}

export const initialPlaylists: PlaylistsState = { list: idle(), memberships: {}, notice: '' };

function failureMessage(error: unknown): string {
  const code = typeof error === 'object' && error && 'detail' in error
    ? (error as { detail?: { code?: string } }).detail?.code : '';
  if (code === 'playlist_read_only') return 'Smart playlists can’t be changed.';
  if (code === 'playlist_too_large') return 'That playlist has reached its entry limit.';
  if (code === 'unsupported_kind') return 'That title type can’t be added to a playlist.';
  return 'The playlist change couldn’t be saved. Your previous list has been restored.';
}

export class Playlists {
  private readonly reads = new Map<string, { items: V.RowEntry[]; cursor?: string; continuation: V.Page<never>['continuation'] }>();

  constructor(
    private readonly box: StateBox<VelaState>,
    private readonly session: Session,
    private readonly artWidth: () => number,
  ) {
    session.onReset(() => {
      this.reads.clear();
      this.box.update('playlists', () => initialPlaylists);
    });
  }

  get available(): boolean {
    try {
      return this.session.features?.playlists?.available === true && hasViewerPlaylists(this.session.selected().adapter);
    } catch { return false; }
  }

  clearNotice(): void { this.box.update('playlists', state => ({ ...state, notice: '' })); }

  private async api() {
    const adapter = (await this.session.ready()).adapter;
    if (this.session.features?.playlists?.available !== true || !hasViewerPlaylists(adapter)) throw new Error('Playlists are unavailable');
    return adapter;
  }

  private notice(error: unknown): void {
    this.box.update('playlists', state => ({ ...state, notice: failureMessage(error) }));
  }

  async load(): Promise<void> {
    if (!this.available) return;
    const previous = this.box.get().playlists.list;
    this.box.update('playlists', state => ({ ...state, list: loading(previous) }));
    try {
      const connection = await this.session.ready();
      const api = await this.api();
      const items: V.PlaylistCard[] = [];
      let cursor: string | undefined;
      const seen = new Set<string>();
      do {
        const page = await api.playlists(cursor, 100);
        items.push(...page.items);
        if (page.continuation !== 'more') break;
        if (!page.nextCursor || seen.has(page.nextCursor)) throw new Error('Invalid playlist continuation');
        seen.add(page.nextCursor); cursor = page.nextCursor;
      } while (true);
      const images = await connection.images();
      const models = items.map(item => {
        const card = entry({ id: item.id, kind: 'playlist', name: item.name, artwork: item.artwork, targetId: item.id, itemCount: item.itemCount, receiptToken: '' }, images, this.artWidth());
        return { id: item.id, name: item.name, poster: card.poster, backdrop: card.backdrop, itemCount: item.itemCount,
          smart: item.smart, updatedAt: item.updatedAt } satisfies PlaylistModel;
      });
      this.box.update('playlists', state => ({ ...state, list: ready(models) }));
    } catch (error) {
      this.box.update('playlists', state => ({ ...state, list: failed(error, previous) }));
    }
  }

  async memberships(titleId: string, refresh = false): Promise<void> {
    if (!this.available) return;
    const previous = this.box.get().playlists.memberships[titleId];
    if (!refresh && previous && previous.load !== 'failed') return;
    this.box.update('playlists', state => ({ ...state, memberships: { ...state.memberships, [titleId]: loading(previous) } }));
    try {
      const answer = await (await this.api()).titlePlaylists(titleId);
      this.box.update('playlists', state => ({ ...state, memberships: { ...state.memberships, [titleId]: ready(answer.items) } }));
    } catch (error) {
      this.box.update('playlists', state => ({ ...state, memberships: { ...state.memberships, [titleId]: failed(error, previous) } }));
    }
  }

  async create(name: string, titleId?: string): Promise<string | null> {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const before = this.box.get().playlists;
    const temporary = `optimistic:${this.session.key()}`;
    const optimistic: PlaylistModel = { id: temporary, name: trimmed, poster: '', backdrop: '', itemCount: titleId ? 1 : 0, smart: false, updatedAt: '' };
    this.box.update('playlists', state => ({ ...state, list: ready([...(state.list.value ?? []), optimistic]) }));
    try {
      const created = await (await this.api()).createPlaylist({ idempotencyKey: this.session.key(), name: trimmed, ...(titleId ? { titleIds: [titleId] } : {}) });
      await this.load();
      if (titleId) await this.memberships(titleId, true);
      return created.id;
    } catch (error) {
      this.box.update('playlists', state => ({ ...state, list: before.list, memberships: before.memberships, notice: failureMessage(error) }));
      return null;
    }
  }

  async setMembership(titleId: string, playlistId: string, add: boolean): Promise<void> {
    const known = this.box.get().playlists.memberships[titleId];
    const before = known?.value ?? [];
    const membership = before.find(item => item.id === playlistId);
    if (!membership || membership.smart) return;
    const next = before.map(item => item.id !== playlistId ? item : { ...item, entryIds: add ? [`optimistic:${this.session.key()}`] : [] });
    this.box.update('playlists', state => ({ ...state, memberships: { ...state.memberships, [titleId]: ready(next) } }));
    try {
      const api = await this.api();
      if (add) await api.addPlaylistEntries(playlistId, { idempotencyKey: this.session.key(), titleIds: [titleId] });
      else await Promise.all(membership.entryIds.map(entryId => api.removePlaylistEntry(playlistId, entryId, { idempotencyKey: this.session.key() })));
      await Promise.all([this.memberships(titleId, true), this.load()]);
      if (this.box.get().collections[playlistId]) await this.open(playlistId);
    } catch (error) {
      this.box.update('playlists', state => ({ ...state, memberships: { ...state.memberships, [titleId]: known ?? ready(before) }, notice: failureMessage(error) }));
    }
  }

  async open(id: string, more = false): Promise<void> {
    const current = this.box.get().collections[id];
    if (current?.load === 'loading' || current?.value && !more && current.load !== 'failed') return;
    const previous = more ? this.reads.get(id) : undefined;
    if (more && previous?.continuation !== 'more') return;
    this.box.update('collections', collections => ({ ...collections, [id]: loading(current) }));
    try {
      const connection = await this.session.ready();
      const answer = await (await this.api()).playlist(id, previous?.cursor, 100);
      const items = [...(previous?.items ?? []), ...answer.items];
      this.reads.set(id, { items, cursor: answer.nextCursor, continuation: answer.continuation });
      const images = await connection.images();
      const model: CollectionModel = { id, kind: 'playlist', name: answer.collection.name, smart: !!answer.collection.smart,
        entryCount: answer.collection.entryCount ?? items.length, items: items.map(item => ({ ...entry(item, images, this.artWidth()), entryId: item.entryId })),
        more: answer.continuation === 'more', complete: answer.continuation === 'exhausted' };
      this.box.update('collections', collections => ({ ...collections, [id]: ready(model) }));
    } catch (error) {
      this.box.update('collections', collections => ({ ...collections, [id]: failed(error, current) }));
    }
  }

  async rename(id: string, name: string): Promise<void> {
    const trimmed = name.trim(); if (!trimmed) return;
    const beforeList = this.box.get().playlists.list;
    const beforeCollection = this.box.get().collections[id];
    this.box.update('playlists', state => ({ ...state, list: ready((state.list.value ?? []).map(item => item.id === id ? { ...item, name: trimmed } : item)) }));
    if (beforeCollection?.value) this.box.update('collections', collections => ({ ...collections, [id]: ready({ ...beforeCollection.value!, name: trimmed }) }));
    try { await (await this.api()).renamePlaylist(id, { idempotencyKey: this.session.key(), name: trimmed }); }
    catch (error) {
      this.box.update('playlists', state => ({ ...state, list: beforeList, notice: failureMessage(error) }));
      this.box.update('collections', collections => ({ ...collections, [id]: beforeCollection! }));
    }
  }

  async delete(id: string): Promise<boolean> {
    const before = this.box.get().playlists.list;
    this.box.update('playlists', state => ({ ...state, list: ready((state.list.value ?? []).filter(item => item.id !== id)) }));
    try { await (await this.api()).deletePlaylist(id, { idempotencyKey: this.session.key() }); return true; }
    catch (error) { this.box.update('playlists', state => ({ ...state, list: before, notice: failureMessage(error) })); return false; }
  }

  async removeEntry(id: string, entryId: string): Promise<void> {
    const before = this.box.get().collections[id]; if (!before?.value || before.value.smart) return;
    const value = { ...before.value, items: before.value.items.filter(item => item.entryId !== entryId), entryCount: Math.max(0, (before.value.entryCount ?? before.value.items.length) - 1) };
    this.box.update('collections', collections => ({ ...collections, [id]: ready(value) }));
    try { await (await this.api()).removePlaylistEntry(id, entryId, { idempotencyKey: this.session.key() }); await this.load(); }
    catch (error) { this.box.update('collections', collections => ({ ...collections, [id]: before })); this.notice(error); }
  }

  async moveEntry(id: string, entryId: string, afterEntryId: string | null): Promise<void> {
    const before = this.box.get().collections[id]; if (!before?.value || before.value.smart) return;
    const item = before.value.items.find(card => card.entryId === entryId); if (!item) return;
    const items = before.value.items.filter(card => card.entryId !== entryId);
    const index = afterEntryId === null ? 0 : items.findIndex(card => card.entryId === afterEntryId) + 1;
    if (index < 0) return;
    items.splice(index, 0, item);
    this.box.update('collections', collections => ({ ...collections, [id]: ready({ ...before.value!, items }) }));
    try { await (await this.api()).movePlaylistEntry(id, entryId, { idempotencyKey: this.session.key(), afterEntryId }); }
    catch (error) { this.box.update('collections', collections => ({ ...collections, [id]: before })); this.notice(error); }
  }
}

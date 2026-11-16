// The catalogue beyond home: a title's details and related rows, a library browsed with a sort
// and filters, and a collection read page by page. Each is kept by key for the current session
// and dropped when the session or server changes.
import type * as V from '../wire';
import { capabilitiesOf } from '../adapter/advertise';
import { artworkURL, type Images } from '../discovery/artwork';
import { detailModel, entry, feedRow } from '../discovery/models';
import type { Card, CollectionModel, DetailModel, LibraryModel, Row } from '../models';
import type { Connection } from '../adapter/connection';
import { msg } from '../i18n';
import type { Session } from './session';
import { failed, loading, ready, type Loadable, type StateBox } from './state';
import type { VelaState } from './index';

/** A library view: sort, direction and filters; absent fields are the server's defaults. */
export interface LibraryQuery {
  sort?: V.LibrarySort;
  direction?: V.SortDirection;
  kind?: V.TitleKind;
  genre?: string;
  year?: number;
  played?: boolean;
  favorite?: boolean;
}

/** The key a library view is kept under in state (`state.library`). */
export function libraryKey(id: string, query: LibraryQuery): string {
  const { sort, direction, kind, genre, year, played, favorite } = query;
  return JSON.stringify([id, sort, direction, kind, genre, year, played, favorite]);
}

const PAGE = 100;

export class Catalogue {
  /** What each collection has read so far, and where the server said to continue. */
  private readonly collectionReads = new Map<string, { items: V.RowEntry[]; cursor?: string; continuation: string }>();

  constructor(
    private readonly box: StateBox<VelaState>,
    private readonly session: Session,
    private readonly artWidth: () => number,
  ) {
    session.onReset(() => {
      this.collectionReads.clear();
      this.box.update('titles', () => ({}));
      this.box.update('related', () => ({}));
      this.box.update('library', () => ({}));
      this.box.update('collections', () => ({}));
    });
  }

  /** A title's details, read once per session unless `refresh` asks again (after playback, say). */
  async title(id: string, refresh = false): Promise<void> {
    const known = this.box.get().titles[id];
    if (known && known.load !== 'failed' && !refresh) return;
    await this.read('titles', id, async connection => {
      const [detail, capabilities] = await Promise.all([connection.adapter.detail(id), capabilitiesOf(connection.adapter)]);
      const images = await connection.images();
      const features = capabilities.features;
      return detailModel(
        detail,
        images,
        this.artWidth(),
        features.extraPlayback?.available === true,
        features.themeMusic?.available === true,
      );
    });
  }

  /** The rows the server relates to a title. */
  async related(id: string): Promise<void> {
    const known = this.box.get().related[id];
    if (known && known.load !== 'failed') return;
    await this.read('related', id, async connection => {
      const data = await connection.adapter.rows({ placement: 'detail', titleId: id });
      const images = await connection.images();
      return data.items.map(row => feedRow(row, images, this.artWidth()));
    });
  }

  /** One library view, `pages` pages deep (100 items a page). */
  async library(id: string, query: LibraryQuery = {}, pages = 1): Promise<void> {
    const key = libraryKey(id, query);
    await this.read('library', key, async connection => {
      const api = connection.adapter;
      const browse: V.LibraryBrowseQuery = { ...query, limit: PAGE };
      let result = await api.library(id, browse);
      const items = [...result.items];
      const seen = new Set<string>();
      let read = 1;
      for (; read < Math.max(1, Math.floor(pages)) && result.continuation === 'more'; read++) {
        const cursor = result.nextCursor;
        if (!cursor || seen.has(cursor)) throw new Error('Invalid library continuation');
        seen.add(cursor);
        result = await api.library(id, { ...browse, cursor });
        items.push(...result.items);
      }
      if (result.continuation === 'more' && !result.nextCursor) throw new Error('Invalid library continuation');
      const images = await connection.images();
      return libraryModel(result, items, read, query, images, this.artWidth());
    });
  }

  /** A collection's first page, or with `more` its next one, continued from the server's cursor. */
  async collection(id: string, more = false): Promise<void> {
    const known = this.box.get().collections[id];
    if (known?.load === 'loading' || (known?.load === 'ready' && !more)) return;
    const previous = more ? this.collectionReads.get(id) : undefined;
    if (more && previous?.continuation !== 'more') return;
    await this.read('collections', id, async connection => {
      const cursor = previous?.cursor;
      const data = await connection.adapter.collection(id, cursor, PAGE);
      if (data.continuation === 'more' && (!data.nextCursor || data.nextCursor === cursor)) {
        throw new Error('Invalid collection continuation');
      }
      const items = [...(previous?.items ?? []), ...data.items];
      this.collectionReads.set(id, { items, cursor: data.nextCursor, continuation: data.continuation });
      const images = await connection.images();
      const seen = new Set<string>();
      const unique = items.filter(item => !seen.has(item.id) && !!seen.add(item.id));
      // Only an exhausted collection is complete; an unknown end is never presented as the whole.
      return {
        name: data.collection.name,
        items: unique.map(item => entry(item, images, this.artWidth())),
        more: data.continuation === 'more',
        complete: data.continuation === 'exhausted',
      };
    });
  }

  /** Read one keyed value into its slice, dropping the answer if the session moved on meanwhile. */
  private async read<K extends 'titles' | 'related' | 'library' | 'collections'>(
    slice: K,
    key: string,
    work: (connection: Connection) => Promise<SliceValue<K>>,
  ): Promise<void> {
    const epoch = this.session.epoch;
    const set = (value: Loadable<SliceValue<K>>) => {
      this.box.update(slice, map => ({ ...map, [key]: value }) as VelaState[K]);
    };
    const previous = this.box.get()[slice][key] as Loadable<SliceValue<K>> | undefined;
    set(loading(previous));
    try {
      const connection = await this.session.ready();
      const value = await work(connection);
      if (epoch === this.session.epoch) set(ready(value));
    } catch (error) {
      if (epoch === this.session.epoch) set(failed(error, previous));
    }
  }
}

type SliceValue<K extends 'titles' | 'related' | 'library' | 'collections'> = {
  titles: DetailModel;
  related: Row[];
  library: LibraryModel;
  collections: CollectionModel;
}[K];

function libraryModel(
  result: V.LibraryContents,
  items: V.RowEntry[],
  pages: number,
  query: LibraryQuery,
  images: Images,
  artWidth: number,
): LibraryModel {
  const library = result.library;
  const filters = library.browse.filters;
  const image = library.artwork.find(a => a.kind === 'backdrop');
  const cards: Card[] = items.map(item => entry(item, images, artWidth));
  return {
    id: library.id,
    name: library.name,
    kind: library.kind,
    backdrop: image ? artworkURL(image, artWidth, Math.ceil(artWidth * 9 / 16), images) ?? '' : '',
    sorts: library.browse.sorts.map(s => ({ id: s.id, label: msg(`library.sort.${s.id}`), directions: s.directions })),
    sort: result.sort,
    direction: result.direction,
    kinds: (filters.kind ?? []).map(k => ({ id: k, label: msg(`library.kind.${k}`) })),
    genres: (filters.genre ? filters.genres ?? [] : []).map(g => ({ id: g, label: g })),
    kindFilter: query.kind ?? '',
    genreFilter: query.genre ?? '',
    playedFilter: query.played === undefined ? '' : String(query.played),
    favoriteFilter: query.favorite === true,
    yearFilter: query.year ?? 0,
    canYear: !!filters.year,
    canPlayed: !!filters.played,
    canFavorite: !!filters.favorite,
    items: cards,
    more: result.continuation === 'more',
    pages,
  };
}

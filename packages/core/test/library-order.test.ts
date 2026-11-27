import { describe, expect, test } from 'bun:test';
import {
  arrangeLibraries,
  libraryOrderKey,
  moveLibrary,
  orderLibraries,
  removeServerLibraryOrders,
  setLibraryHidden,
  storedLibraryOrders,
  type LibraryOrder,
} from '../src/library-order';
import { LibraryOrders, viewerLibraryOrder } from '../src/store/library-orders';
import { StateBox, ready } from '../src/store/state';
import type { VelaState } from '../src';

const library = (id: string) => ({ id, name: id, kind: 'movies', dateDisplay: 'year' as const, backdrop: '' });
const server = ['movies', 'shows', 'music', 'live'].map(library);
const ids = (list: readonly { id: string }[]) => list.map(item => item.id);
const rows = (preference: LibraryOrder | undefined, libraries = server) =>
  orderLibraries(libraries, preference).map(row => row.hidden ? `(${row.library.id})` : row.library.id);

describe('library order', () => {
  test('without a preference the navigation is the server list itself', () => {
    expect(arrangeLibraries(server, undefined)).toBe(server);
    expect(arrangeLibraries(server, { order: [], hidden: [] })).toBe(server);
    expect(rows(undefined)).toEqual(['movies', 'shows', 'music', 'live']);
  });

  test('moves a library one place, and nothing past either end', () => {
    const down = moveLibrary(server, undefined, 'movies', 1);
    expect(down.order).toEqual(['shows', 'movies', 'music', 'live']);
    expect(ids(arrangeLibraries(server, down))).toEqual(['shows', 'movies', 'music', 'live']);
    expect(moveLibrary(server, down, 'music', -1).order).toEqual(['shows', 'music', 'movies', 'live']);
    expect(moveLibrary(server, down, 'shows', -1)).toBe(down);
    expect(moveLibrary(server, down, 'live', 1)).toBe(down);
    expect(moveLibrary(server, down, 'gone', 1)).toBe(down);
  });

  test('a hidden library leaves the navigation and keeps its place in the list', () => {
    const hidden = setLibraryHidden(server, undefined, 'shows', true);
    expect(ids(arrangeLibraries(server, hidden))).toEqual(['movies', 'music', 'live']);
    expect(rows(hidden)).toEqual(['movies', '(shows)', 'music', 'live']);
    expect(setLibraryHidden(server, hidden, 'shows', true)).toBe(hidden);
    const shown = setLibraryHidden(server, hidden, 'shows', false);
    expect(ids(arrangeLibraries(server, shown))).toEqual(['movies', 'shows', 'music', 'live']);
  });

  test('hiding alone keeps the order of the day, so a library the server lists first later goes at the end', () => {
    const hidden = setLibraryHidden(server, undefined, 'shows', true);
    expect(hidden.order).toEqual(['movies', 'shows', 'music', 'live']);
    const grown = [library('books'), ...server];
    expect(rows(hidden, grown)).toEqual(['movies', '(shows)', 'music', 'live', 'books']);
    expect(ids(arrangeLibraries(grown, hidden))).toEqual(['movies', 'music', 'live', 'books']);
    // A second hide keeps the order it has, libraries the server no longer lists included, and
    // places the libraries the server added since at the end.
    const again = setLibraryHidden(grown.filter(item => item.id !== 'music'), hidden, 'books', true);
    expect(again.order).toEqual(['movies', 'shows', 'music', 'live', 'books']);
    expect(rows(again, grown)).toEqual(['movies', '(shows)', 'music', 'live', '(books)']);
  });

  test('every hide or show places the libraries the server added since, so a later one goes after them', () => {
    const tv = ['movies', 'tv'].map(library);
    let preference = setLibraryHidden(tv, undefined, 'tv', true);
    const withBooks = [...tv, library('books')];
    preference = setLibraryHidden(withBooks, preference, 'books', true);
    preference = setLibraryHidden(withBooks, preference, 'books', false);
    expect(preference.order).toEqual(['movies', 'tv', 'books']);
    const withPhotos = [library('photos'), ...withBooks];
    expect(ids(arrangeLibraries(withPhotos, preference))).toEqual(['movies', 'books', 'photos']);
  });

  test('a library added later goes at the end, in the server order', () => {
    const preference = moveLibrary(server, undefined, 'live', -1);
    const grown = [library('books'), ...server, library('photos')];
    expect(rows(preference, grown)).toEqual(['movies', 'shows', 'live', 'music', 'books', 'photos']);
  });

  test('a library the server stops listing keeps its place for when it returns', () => {
    const preference: LibraryOrder = { order: ['live', 'music', 'shows', 'movies'], hidden: ['music'] };
    const without = server.filter(item => item.id !== 'music');
    expect(rows(preference, without)).toEqual(['live', 'shows', 'movies']);
    // Moving past the missing library swaps with the next one listed, and keeps the missing one.
    const moved = moveLibrary(without, preference, 'shows', -1);
    expect(moved.order).toEqual(['shows', 'music', 'live', 'movies']);
    expect(moved.hidden).toEqual(['music']);
    expect(rows(moved)).toEqual(['shows', '(music)', 'live', 'movies']);
  });

  test('stored data is read defensively', () => {
    const key = libraryOrderKey('srv-1', 'viewer-a');
    expect(storedLibraryOrders(null)).toEqual({});
    expect(storedLibraryOrders('movies')).toEqual({});
    expect(storedLibraryOrders([key])).toEqual({});
    expect(storedLibraryOrders({
      'not-a-key': { order: ['movies'], hidden: [] },
      [libraryOrderKey('', 'viewer-a')]: { order: ['movies'], hidden: [] },
      [libraryOrderKey('srv-2', 'viewer-a')]: { order: 'movies', hidden: {} },
      [key]: { order: ['shows', 7, 'shows', '', 'movies'], hidden: ['music', null] },
    })).toEqual({ [key]: { order: ['shows', 'movies'], hidden: ['music'] } });
  });

  test('removing a server drops only its preferences', () => {
    const map = {
      [libraryOrderKey('srv-1', 'viewer-a')]: { order: ['shows'], hidden: [] },
      [libraryOrderKey('srv-2', 'viewer-a')]: { order: ['movies'], hidden: [] },
    };
    expect(Object.keys(removeServerLibraryOrders(map, 'srv-1'))).toEqual([libraryOrderKey('srv-2', 'viewer-a')]);
    expect(removeServerLibraryOrders(map, 'srv-3')).toBe(map);
  });
});

describe('library orders store', () => {
  const state = (serverId: string, viewerId: string, libraryOrders = {}) => ({
    auth: { serverId, viewerId },
    libraries: ready(server),
    libraryOrders,
  }) as unknown as VelaState;
  const setup = (serverId: string, viewerId: string, libraryOrders = {}) => {
    const box = new StateBox(state(serverId, viewerId, libraryOrders));
    let forget: (id: string) => void = () => {};
    const store = new LibraryOrders(box, { onForget: (listener: (id: string) => void) => { forget = listener; } } as never);
    return { box, store, forget: (id: string) => forget(id) };
  };

  test('two viewers and two servers with the same library ids keep their own order, and Reset clears only the active one', () => {
    const a = setup('srv-1', 'viewer-a');
    a.store.moveDown('movies');
    a.store.setHidden('music', true);
    const stored = a.box.get().libraryOrders;

    const b = setup('srv-1', 'viewer-b', stored);
    expect(viewerLibraryOrder(b.box.get())).toBeUndefined();
    b.store.moveUp('live');
    const other = setup('srv-2', 'viewer-a', b.box.get().libraryOrders);
    expect(viewerLibraryOrder(other.box.get())).toBeUndefined();
    other.store.setHidden('movies', true);

    const all = other.box.get().libraryOrders;
    expect(ids(arrangeLibraries(server, all[libraryOrderKey('srv-1', 'viewer-a')]))).toEqual(['shows', 'movies', 'live']);
    expect(ids(arrangeLibraries(server, all[libraryOrderKey('srv-1', 'viewer-b')]))).toEqual(['movies', 'shows', 'live', 'music']);
    expect(ids(arrangeLibraries(server, all[libraryOrderKey('srv-2', 'viewer-a')]))).toEqual(['shows', 'music', 'live']);

    const back = setup('srv-1', 'viewer-a', all);
    back.store.reset();
    expect(Object.keys(back.box.get().libraryOrders)).toEqual([libraryOrderKey('srv-1', 'viewer-b'), libraryOrderKey('srv-2', 'viewer-a')]);
    expect(viewerLibraryOrder(back.box.get())).toBeUndefined();
  });

  test('a press that changes nothing stores nothing; no viewer, nothing is kept', () => {
    const { box, store } = setup('srv-1', 'viewer-a');
    const before = box.get().libraryOrders;
    store.moveUp('movies');
    store.moveDown('live');
    store.setHidden('shows', false);
    store.reset();
    expect(box.get().libraryOrders).toBe(before);
    const anonymous = setup('srv-1', '');
    anonymous.store.moveDown('movies');
    expect(anonymous.box.get().libraryOrders).toEqual({});
  });

  test('a viewer who only hid a library gets a library the server lists first at the end', () => {
    const { box, store } = setup('srv-1', 'viewer-a');
    store.setHidden('shows', true);
    box.update('libraries', () => ready([library('books'), ...server]));
    expect(ids(arrangeLibraries(box.get().libraries.value!, viewerLibraryOrder(box.get())))).toEqual(['movies', 'music', 'live', 'books']);
  });

  test('loads stored preferences under changes made first, and forgets a removed server', () => {
    const { box, store, forget } = setup('srv-1', 'viewer-a');
    store.setHidden('shows', true);
    store.load({
      [libraryOrderKey('srv-1', 'viewer-a')]: { order: ['live'], hidden: [] },
      [libraryOrderKey('srv-2', 'viewer-a')]: { order: ['music'], hidden: [] },
    });
    expect(viewerLibraryOrder(box.get())).toEqual({ order: ['movies', 'shows', 'music', 'live'], hidden: ['shows'] });
    forget('srv-2');
    expect(Object.keys(box.get().libraryOrders)).toEqual([libraryOrderKey('srv-1', 'viewer-a')]);
  });
});

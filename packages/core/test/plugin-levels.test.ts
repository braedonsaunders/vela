// Plugin branching levels (features.pluginLevels): which tab a library's rows are read for and
// held under, a tab's own card, and an artist's sections from its per-level child counts. A
// server without the feature reads exactly what it read before.
import { expect, test } from 'bun:test';
import { childCountsLine, childCountsOf, childrenKey, childSectionLabel, childSections, pluginLevelsOf, recommendationTab, tabCard } from '../src/plugin-levels';
import { card } from '../src/discovery/models';
import { cardMedia, mediaFacts } from '../src/media';
import { Catalogue } from '../src/store/catalogue';
import { Media } from '../src/store/media';
import { StateBox } from '../src/store/state';
import type { VelaState } from '../src/store';
import type { Session } from '../src/store/session';
import type { ChildrenPage, LibraryTab, Row, ServerCapabilities, Title } from '../src/wire';

const LEVELS = { pluginLevels: { available: true, tabRows: true, childRoles: true } } as Partial<ServerCapabilities['features']>;
const tabs: LibraryTab[] = [
  { id: 'recommended', label: 'Recommended', kind: 'recommended' },
  { id: 'concerts', label: 'Concerts', kind: 'recommended', card: 'landscape' },
  { id: 'artists', label: 'Artists', kind: 'library' },
];

test('the capability counts only when available, flag by flag', () => {
  expect(pluginLevelsOf(LEVELS)).toEqual({ tabCards: true, tabRows: true, childRoles: true });
  expect(pluginLevelsOf({ pluginLevels: { available: true } })).toEqual({ tabCards: true, tabRows: false, childRoles: false });
  expect(pluginLevelsOf({ pluginLevels: { available: false, tabRows: true, childRoles: true } })).toEqual({ tabCards: false, tabRows: false, childRoles: false });
  expect(pluginLevelsOf(undefined)).toEqual({ tabCards: false, tabRows: false, childRoles: false });
});

test('rows are read for a recommended tab past the first, and only from a server with tab rows', () => {
  expect(recommendationTab(tabs, 'concerts', true)).toBe('concerts');
  // The first recommended tab is the library's own rows: shared with a prefetch and older servers.
  expect(recommendationTab(tabs, 'recommended', true)).toBeUndefined();
  expect(recommendationTab(tabs, 'artists', true)).toBeUndefined();
  expect(recommendationTab(tabs, undefined, true)).toBeUndefined();
  expect(recommendationTab(undefined, 'concerts', true)).toBeUndefined();
  expect(recommendationTab(tabs, 'concerts', false)).toBeUndefined();
});

test("a tab's own card wins over the library's, only from a server with plugin levels", () => {
  expect(tabCard(tabs[1], 'square', true)).toBe('landscape');
  expect(tabCard(tabs[0], 'square', true)).toBe('square');
  expect(tabCard(tabs[1], 'square', false)).toBe('square');
  expect(tabCard({ card: 'wide' as never }, 'poster', true)).toBe('poster');
  expect(tabCard(undefined, undefined, true)).toBeUndefined();
});

test('an artist splits into sections only with child roles and something besides albums', () => {
  expect(childSections({ album: 4, concert: 2 }, true)).toEqual(['album', 'concert']);
  expect(childSections({ concert: 2, album: 4 }, true)).toEqual(['album', 'concert']);
  // Albums alone, no counts, or an older server: the page reads its children whole, as before.
  expect(childSections({ album: 4 }, true)).toEqual([]);
  expect(childSections({}, true)).toEqual([]);
  expect(childSections({ album: 4, concert: 2 }, false)).toEqual([]);
  expect(childSections({ concert: 3 }, true)).toEqual(['concert']);
  expect(childSections({ album: 0, concert: 3 }, true)).toEqual(['concert']);
});

test('per-level counts drop malformed entries; each level has its own children key', () => {
  expect(childCountsOf({ album: 4, concert: 2.9, live: 0, bad: 'x', neg: -1 })).toEqual({ album: 4, concert: 2 });
  expect(childCountsOf(null)).toEqual({});
  expect(childCountsOf([3])).toEqual({});
  expect(childrenKey('artist-1')).toBe('artist-1');
  expect(childrenKey('artist-1', 'concert')).not.toBe(childrenKey('artist-1'));
  expect(childrenKey('artist-1', 'concert')).not.toBe(childrenKey('artist-1', 'album'));
});

test('sections are labelled and counted in words', () => {
  expect(childSectionLabel('album')).toBe('Albums');
  expect(childSectionLabel('concert')).toBe('Concerts');
  expect(childSectionLabel('rehearsal')).toBe('Rehearsal');
  expect(childCountsLine({ concert: 1, album: 4 })).toBe('4 albums · 1 concert');
});

const artist: Title = { id: 'artist-1', kind: 'show', name: 'The Band', summary: '', genres: [], artwork: [],
  media: { class: 'music', role: 'artist', childCount: 6, childCounts: { album: 4, concert: 2 } } };
const concert: Title = { id: 'concert-1', kind: 'movie', name: 'Live at the Boathouse', summary: '', genres: [], artwork: [], year: 2023,
  media: { class: 'video', role: 'concert', parents: [{ id: 'artist-1', name: 'The Band', role: 'artist' }] } };

test("an artist's facts count albums and concerts apart; one without per-level counts reads as before", () => {
  const media = cardMedia(artist)!;
  expect(media.childCounts).toEqual({ album: 4, concert: 2 });
  expect(mediaFacts(media, artist)).toBe('4 albums · 2 concerts');
  const before = { ...artist, media: { ...artist.media!, childCount: 4, childCounts: undefined } };
  expect(mediaFacts(cardMedia(before)!, before)).toBe('4 albums');
});

test('a concert is a video card that names its artist and links back to it', () => {
  const value = card(concert);
  expect(value.kind).toBe('movie');
  expect(value.media).toBeUndefined();
  expect(value.episodeContext).toBe('The Band');
  expect(value.contextParts).toEqual([{ label: 'The Band', select: 'artist-1|artist' }]);
  // An ordinary video title is unchanged.
  const movie = card({ ...concert, media: { class: 'video', role: 'item' } });
  expect(movie.contextParts).toEqual([]);
  expect(movie.episodeContext).toBe('');
});

function catalogueWith(features: Partial<ServerCapabilities['features']> | undefined) {
  const box = new StateBox({ library: {}, titles: {}, related: {}, collections: {}, home: { progressRevision: 0 } } as unknown as VelaState);
  const calls: unknown[][] = [];
  const adapter = {
    libraryRows: async (...args: unknown[]): Promise<Row[]> => {
      calls.push(args);
      return [{ id: `row-${String(args[3] ?? 'library')}`, name: String(args[3] ?? 'library'), purpose: 'recommendation', items: [], receiptToken: '', continuation: 'exhausted' } as unknown as Row];
    },
    libraryCollections: async () => ({ items: [], continuation: 'exhausted' }),
    libraryGenres: async () => [],
  };
  const session = { epoch: 0, features, onReset() {}, async ready() { return { adapter, images: async () => ({ origin: 'https://fixture.test' }) }; } };
  return { catalogue: new Catalogue(box, session as unknown as Session, () => 640), calls };
}

test("a tab's rows are read with ?tab= and held apart from the library's", async () => {
  const f = catalogueWith(LEVELS);
  expect((await f.catalogue.libraryRecommendations('music', 'shows', false, 'concerts'))?.map(row => row.name)).toEqual(['concerts']);
  expect((await f.catalogue.libraryRecommendations('music', 'shows'))?.map(row => row.name)).toEqual(['library']);
  expect(f.calls).toEqual([['music', 'shows', false, 'concerts'], ['music', 'shows', false]]);
  expect(f.catalogue.cachedLibraryRecommendations('music', 'concerts')?.value.map(row => row.name)).toEqual(['concerts']);
  expect(f.catalogue.cachedLibraryRecommendations('music')?.value.map(row => row.name)).toEqual(['library']);
  // Held: a second read of either is not sent again.
  await f.catalogue.libraryRecommendations('music', 'shows', false, 'concerts');
  expect(f.calls).toHaveLength(2);
});

test('a server without tab rows is never sent a tab: every tab shares the library rows', async () => {
  const f = catalogueWith(undefined);
  await f.catalogue.libraryRecommendations('music', 'shows', false, 'concerts');
  expect(f.calls).toEqual([['music', 'shows', false]]);
  expect(f.catalogue.cachedLibraryRecommendations('music', 'concerts')).toEqual(f.catalogue.cachedLibraryRecommendations('music'));
  expect(f.catalogue.libraryTabRowsAvailable).toBe(false);
  expect(f.catalogue.libraryTabCardsAvailable).toBe(false);
});

function mediaWith(features: Partial<ServerCapabilities['features']> | undefined) {
  const box = new StateBox({ children: {}, titles: {} } as unknown as VelaState);
  const calls: unknown[][] = [];
  const adapter = {
    children: async (...args: unknown[]): Promise<ChildrenPage> => {
      calls.push(args);
      const role = args[3];
      return { items: role === 'concert' ? [concert] : [], continuation: 'exhausted' };
    },
  };
  const session = { epoch: 0, features, onReset() {}, async ready() { return { adapter, images: async () => ({ origin: 'https://fixture.test' }) }; } };
  return { box, media: new Media(box, session as unknown as Session, () => 640), calls };
}

test("one child level is read with ?role= and held under its own key", async () => {
  const f = mediaWith(LEVELS);
  await f.media.children('artist-1', false, 'concert');
  expect(f.calls).toEqual([['artist-1', undefined, 100, 'concert']]);
  expect(f.box.get().children[childrenKey('artist-1', 'concert')]?.value?.items.map(item => item.id)).toEqual(['concert-1']);
  expect(f.box.get().children['artist-1']).toBeUndefined();
});

test('a server without child roles is never sent a role', async () => {
  const f = mediaWith(undefined);
  await f.media.children('artist-1', false, 'concert');
  expect(f.calls).toEqual([]);
  await f.media.children('artist-1');
  expect(f.calls).toEqual([['artist-1', undefined, 100, undefined]]);
});

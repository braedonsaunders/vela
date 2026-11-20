import { expect, test } from 'bun:test';
import type { Card } from '../src/models';
import type { VelaState } from '../src/store';
import { Catalogue } from '../src/store/catalogue';
import type { Session } from '../src/store/session';
import { StateBox } from '../src/store/state';
import { optimisticWatchState } from '../src/store/watch-state';

const card = (id: string): Card => ({
  id, kind: 'movie', name: id, summary: '', airDate: '', year: 2026, rating: '', durationSeconds: 3600,
  progressSeconds: 600, played: false, favorite: false, watchlisted: false, showId: '', showName: '', episodeContext: '',
  contextParts: [], seasonId: '', seasonNumber: 0, episodeNumber: 0, genres: [], durationLabel: '', yearLabel: '',
  progressLabel: '17%', seasonNumberLabel: '', episodeNumberLabel: '', facts: '', poster: '', backdrop: '', logo: '', accent: '', receipt: '',
});

function stateWithCards(): VelaState {
  const target = card('target');
  const keep = card('keep');
  return {
    home: { load: 'ready', error: '', retry: null, slow: false, rowsLoading: [], moreRows: 'idle', value: {
      viewer: '', defaultSkinId: '', skins: [], hero: [target], heroActions: [], heroPreviewIds: [], previews: [], nextCursor: '',
      liveAvailable: false, libraryLiveAvailable: false, aiAvailable: false, descriptiveAvailable: false, trailerPreviewAvailable: false,
      rows: [{ id: 'continue', name: 'Continue Watching', purpose: 'continue', receipt: '', items: [target, keep], nextCursor: '', continuation: 'exhausted', previewOnFocus: false, presentation: '' }],
    } },
    titles: { target: { load: 'ready', error: '', value: { title: [target], episodes: [], related: [], nextUp: [], ratings: [], trailerId: '', trailerReady: false, themeMusicUrl: '', themeMusicExpiresAt: 0, mediaFacts: [], resumePosition: '', crew: [], crewPeople: [], canPlay: true, resumeSeconds: 600, seasons: [], extras: [], cast: [], castPeople: [], pending: [] } } },
    related: {}, rows: {}, library: {}, collections: {},
    search: { query: '', generation: 0, fast: { status: 'ready', items: [target], error: '', liveChannels: [], liveProgrammes: [] }, descriptive: { status: 'idle', items: [], error: '', canRetry: false }, ai: { status: 'idle', items: [], error: '' } },
  } as unknown as VelaState;
}

test('optimistic watch changes update detail, search and shelves and remove finished Continue Watching cards', () => {
  const state = stateWithCards();
  const next = optimisticWatchState(state, 'target', { played: true, favorite: true });
  expect(next.home.value!.rows[0]!.items.map(value => value.id)).toEqual(['keep']);
  expect(next.titles.target!.value!.title[0]).toMatchObject({ played: true, favorite: true, progressSeconds: 0 });
  expect(next.search.fast.items[0]).toMatchObject({ played: true, favorite: true, progressSeconds: 0 });
  expect(state.titles.target!.value!.title[0]!.played).toBe(false);
  const removed = optimisticWatchState(state, 'target', { continueWatching: false });
  expect(removed.home.value!.rows[0]!.items.map(value => value.id)).toEqual(['keep']);
});

test('a refused mutation restores an optimistically removed Continue Watching card', async () => {
  const state = stateWithCards();
  const box = new StateBox(state);
  let reject!: (reason: Error) => void;
  const pending = new Promise<never>((_resolve, no) => { reject = no; });
  const adapter = {
    titleActions: async () => ({ watched: true, favorite: true, watchlist: true, removeFromContinue: true, watch: card('target'), versions: [] }),
    setTitleWatch: () => pending,
  };
  const session = { onReset() {}, key: () => 'mutation-key', async ready() { return { adapter }; } };
  const catalogue = new Catalogue(box, session as unknown as Session, () => 640);
  const mutation = catalogue.setTitleWatch('target', { continueWatching: false });
  await Promise.resolve();
  expect(box.get().home.value!.rows[0]!.items.map(value => value.id)).toEqual(['keep']);
  reject(new Error('refused'));
  await expect(mutation).rejects.toThrow("That action couldn't be completed.");
  expect(box.get()).toBe(state);
  expect(box.get().home.value!.rows[0]!.items.map(value => value.id)).toEqual(['target', 'keep']);
});

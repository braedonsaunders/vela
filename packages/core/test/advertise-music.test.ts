import { expect, test } from 'bun:test';
import type * as V from '../src/wire';
import { advertise } from '../src/adapter/advertise';
import type { ServerAdapter, ServerDescription } from '../src/adapter';

const on: V.Feature = { available: true };
const description = { features: { favoritesList: on, lyrics: on, playContexts: on } } as unknown as ServerDescription;

test('music features reach the app only when the adapter can call them', () => {
  const music = { favoriteTitles() {}, titleLyrics() {}, recentPlayContexts() {} } as unknown as ServerAdapter;
  const plain = {} as unknown as ServerAdapter;
  const offered = advertise(music, description).features;
  expect([offered.favoritesList, offered.lyrics, offered.playContexts]).toEqual([on, on, on]);
  const withheld = advertise(plain, description).features;
  expect([withheld.favoritesList, withheld.lyrics, withheld.playContexts]).toEqual([undefined, undefined, undefined]);
});

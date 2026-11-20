import { expect, test } from 'bun:test';
import type { Card, TitleActions } from '@vela/core';
import { cardContextActions } from '../src/card-context-actions';

const card = (extra: Partial<Card> = {}): Card => ({
  id: 'episode-1', kind: 'episode', name: 'Pilot', summary: '', airDate: '', year: 2026,
  rating: '', durationSeconds: 3600, progressSeconds: 900, played: false, showId: 'show-1', showName: 'Show',
  episodeContext: '', contextParts: [
    { label: 'Show', select: 'show-1|' },
    { label: 'Season 1', select: 'season-1|season||show-1' },
  ], seasonId: 'season-1', seasonNumber: 1, episodeNumber: 1, genres: [], durationLabel: '1h', yearLabel: '2026',
  progressLabel: '15m', seasonNumberLabel: 'S1', episodeNumberLabel: 'E1', facts: '', poster: '', backdrop: '', logo: '', accent: '', receipt: 'receipt',
  ...extra,
});

test('resumable play actions lead with resume time and include restart, details and episode parents', () => {
  const actions = cardContextActions(card(), { action: 'play', arg: 'episode-1|source|audio' });
  expect(actions.map(action => action.id)).toEqual(['play', 'restart', 'details', 'show', 'season']);
  expect(actions[0]!.label).toContain('15m');
  expect(actions[1]!.command).toEqual({ kind: 'dispatch', action: 'play', arg: 'episode-1|source|audio|0' });
});

test('non-resumable cards never offer play from beginning', () => {
  for (const value of [card({ progressSeconds: 0 }), card({ played: true }), card({ kind: 'channel' })]) {
    expect(cardContextActions(value, { action: 'play', arg: value.id }).some(action => action.id === 'restart')).toBe(false);
  }
});

test('a playable card whose normal press opens details still offers play first', () => {
  const actions = cardContextActions(card({ id: 'movie-1', kind: 'movie', progressSeconds: 0 }), { action: 'select', arg: 'movie-1|movie|receipt' });
  expect(actions.map(action => action.id).slice(0, 2)).toEqual(['play', 'details']);
  expect(actions[0]?.command).toEqual({ kind: 'dispatch', action: 'play', arg: 'movie-1' });
  expect(actions[1]?.command).toEqual({ kind: 'dispatch', action: 'select', arg: 'movie-1|movie|receipt' });
});

test('adapter-backed mutations are included and unsupported mutations are absent', () => {
  const none = cardContextActions(card(), { action: 'play', arg: 'episode-1' });
  expect(none.some(action => action.command.kind === 'watch')).toBe(false);
  const management: TitleActions = {
    watched: true, favorite: true, watchlist: false, removeFromContinue: true, versions: [],
    watch: { positionSeconds: 0, played: false, favorite: true, watchlisted: false },
  };
  const actions = cardContextActions(card(), { action: 'play', arg: 'episode-1' }, management);
  expect(actions.find(action => action.id === 'watched')?.command).toEqual({ kind: 'watch', change: { played: true } });
  expect(actions.find(action => action.id === 'favorite')?.command).toEqual({ kind: 'watch', change: { favorite: false } });
  expect(cardContextActions(card(), { action: 'play', arg: 'episode-1' }, management, { continueWatching: true }).find(action => action.id === 'remove-continue')?.command)
    .toEqual({ kind: 'watch', change: { continueWatching: false } });
  expect(cardContextActions(card(), { action: 'play', arg: 'episode-1' }, management).some(action => action.id === 'remove-continue')).toBe(false);
});

test('openable non-title cards retain their actual primary action without invented title calls', () => {
  const actions = cardContextActions(card({ id: 'person-1', kind: 'person', progressSeconds: 0, contextParts: [] }), { action: 'select', arg: 'person-1|person' });
  expect(actions).toHaveLength(1);
  expect(actions[0]!.command).toEqual({ kind: 'dispatch', action: 'select', arg: 'person-1|person' });
});

test('a live channel retains the shared live action', () => {
  const actions = cardContextActions(card({ id: 'channel-1', kind: 'channel', progressSeconds: 0, contextParts: [] }), { action: 'watch', arg: 'channel-1' });
  expect(actions.map(action => action.id)).toEqual(['watch-live']);
  expect(actions[0]?.command).toEqual({ kind: 'dispatch', action: 'watch', arg: 'channel-1' });
});

test('an extra keeps its playable action without title mutations', () => {
  const actions = cardContextActions(card({ id: 'extra-1', kind: 'extra', progressSeconds: 0, contextParts: [] }), { action: 'playExtra', arg: 'extra-1' });
  expect(actions.map(action => action.id)).toEqual(['play']);
  expect(actions[0]?.command).toEqual({ kind: 'dispatch', action: 'playExtra', arg: 'extra-1' });
});

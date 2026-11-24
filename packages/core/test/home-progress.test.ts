import { describe, expect, test } from 'bun:test';
import { freshCard, homeWatched, laterProgressRows, reconcileHomeProgress, reconcileProgressRows, reconcileShelves } from '../src/discovery/progress';
import type { Card, HeroAction, HomeModel, Row } from '../src/models';

const card = (id: string, progressSeconds = 0) => ({ id, progressSeconds, progressLabel: `${progressSeconds}`, played: false } as Card);
const row = (id: string, purpose: Row['purpose'], item = id): Row => ({
  id, purpose, name: id, receipt: '', items: [card(item)], nextCursor: '', continuation: 'exhausted', previewOnFocus: false, presentation: '', layout: 'standard', personal: false,
});
const action = (heroId: string, kind: HeroAction['action'], progress = 0) => ({ heroId, action: kind, progress } as HeroAction);
const home = (rows: Row[], hero: Card[] = [], heroActions: HeroAction[] = []) => ({ rows, hero, heroActions } as HomeModel);

describe('Home progress reconciliation', () => {
  test('adds, updates, removes and orders progress rows without touching ordinary or paged rows', () => {
    const ordinaryA = row('ordinary-a', 'recommendation');
    const ordinaryB = row('ordinary-b', 'collection');
    const paged = row('paged-row', 'recentlyAdded');
    const oldContinue = row('continue-old', 'continue', 'old');
    const nextUp = row('next-up', 'nextUp', 'episode-3');
    const newContinue = row('continue-new', 'continue', 'movie-2');
    const current = home([ordinaryA, oldContinue, ordinaryB, paged]);
    const fresh = home([nextUp, ordinaryA, newContinue, ordinaryB]);

    const merged = reconcileHomeProgress(current, fresh);

    expect(merged.rows.map(value => value.id)).toEqual(['next-up', 'ordinary-a', 'continue-new', 'ordinary-b', 'paged-row']);
    expect(merged.rows[0]).toBe(nextUp);
    expect(merged.rows[2]).toBe(newContinue);
    expect(merged.rows[1]).toBe(ordinaryA);
    expect(merged.rows[3]).toBe(ordinaryB);
    expect(merged.rows[4]).toBe(paged);
  });

  test('corrects hero progress and resume actions without replacing or reordering the carousel', () => {
    const first = card('first', 10), second = card('second');
    const current = home([], [first, second], [action('first', 'resume', 0.1), action('second', 'details')]);
    const fresh = home([], [card('second'), { ...card('first', 80), played: true }], [action('second', 'details'), action('first', 'play', 0)]);

    const merged = reconcileHomeProgress(current, fresh);

    expect(merged.hero.map(value => value.id)).toEqual(['first', 'second']);
    expect(merged.hero[0]).toMatchObject({ progressSeconds: 80, played: true });
    expect(merged.hero[1]).toBe(second);
    expect(merged.heroActions.map(value => value.heroId)).toEqual(['first', 'second']);
    expect(merged.heroActions[0]?.action).toBe('play');
    expect(merged.heroActions[1]).toBe(current.heroActions[1]);
  });
});

describe('Home progress shelves read on their own', () => {
  test('a read shelf takes its fresh copy; the hero and other shelves take its titles\' progress; unread shelves keep theirs', () => {
    const film = card('film', 10);
    const watching = { ...row('continue', 'continue'), items: [film] };
    const nextUp = row('next-up', 'nextUp', 'episode');
    const trending = { ...row('trending', 'recommendation'), items: [card('film', 10), card('other')] };
    const current = home([watching, nextUp, trending], [card('film', 10), card('hero-other')], [action('film', 'resume', 0.1)]);
    const fresh = { ...watching, items: [card('film', 55)] };

    const merged = reconcileShelves(current, [fresh]);

    expect(merged.rows[0]!.items[0]!.progressSeconds).toBe(55);
    expect(merged.rows[1]).toBe(nextUp);
    expect(merged.rows[2]!.items[0]!.progressSeconds).toBe(55);
    expect(merged.rows[2]!.items[1]).toBe(trending.items[1]);
    expect(merged.hero[0]!.progressSeconds).toBe(55);
    expect(merged.hero[1]).toBe(current.hero[1]);
    expect(merged.heroActions).toBe(current.heroActions);
  });

  test('an emptied shelf goes, and an answer with nothing new is the very same Home', () => {
    const watching = row('continue', 'continue', 'film');
    const other = row('other', 'recommendation');
    const current = home([watching, other]);
    expect(reconcileShelves(current, [{ ...watching, items: [] }]).rows).toEqual([other]);
    expect(reconcileShelves(current, [{ ...watching, items: watching.items.map(value => ({ ...value })) }])).toBe(current);
  });
});

describe('Progress shelves update in place (no visible refresh)', () => {
  const book = (id: string, fraction: number, poster = `/art/${id}?sig=1`) =>
    ({ id, progressSeconds: 0, progressLabel: '', played: false, poster, backdrop: '', logo: '', media: { readingFraction: fraction, readingLocator: `cfi-${fraction}` } } as unknown as Card);
  const shelf = (id: string, purpose: Row['purpose'], items: Card[]): Row => ({
    id, purpose, name: id, receipt: '', items, nextCursor: '', continuation: 'exhausted', previewOnFocus: false, presentation: '', layout: 'standard', personal: false,
  });

  test('a library\'s Continue reading row takes the new place; every other shelf keeps its objects', () => {
    const popular = shelf('popular', 'recommendation', [book('kings', 0.002), book('empire', 0)]);
    const awards = shelf('awards', 'recommendation', [book('ender', 0)]);
    const reading = shelf('continue', 'continue', [book('kings', 0.002)]);
    const current = [reading, popular, awards];
    const fresh = [shelf('continue', 'continue', [book('kings', 0.31, '/art/kings?sig=2')]), shelf('popular', 'recommendation', [book('empire', 0), book('kings', 0.31)]), awards];

    const merged = reconcileProgressRows(current, fresh, true);

    expect(merged.map(row => row.id)).toEqual(['continue', 'popular', 'awards']);
    expect(merged[0]!.items[0]!.media?.readingFraction).toBe(0.31);
    // The shown picture is kept: a re-signed URL for the same cover never reloads it.
    expect(merged[0]!.items[0]!.poster).toBe('/art/kings?sig=1');
    // A recommendation shelf keeps its order and its untouched cards; the book's progress is refreshed.
    expect(merged[1]!.items.map(card => card.id)).toEqual(['kings', 'empire']);
    expect(merged[1]!.items[0]!.media?.readingFraction).toBe(0.31);
    expect(merged[1]!.items[1]).toBe(popular.items[1]);
    expect(merged[2]).toBe(awards);
  });

  test('nothing changed: the very same rows come back, so nothing draws again', () => {
    const current = [shelf('continue', 'continue', [book('kings', 0.2)]), shelf('popular', 'recommendation', [book('kings', 0.2)])];
    const fresh = current.map(row => ({ ...row, items: row.items.map(card => ({ ...card, media: { ...card.media! } })) }));
    expect(reconcileProgressRows(current, fresh, true)).toBe(current);
  });

  test('a finished book\'s Continue row goes when the whole list is fresh; a new one arrives beside its neighbour', () => {
    const popular = shelf('popular', 'recommendation', [book('a', 0)]);
    expect(reconcileProgressRows([shelf('continue', 'continue', [book('kings', 0.9)]), popular], [popular], true)).toEqual([popular]);
    const listening = shelf('listening', 'continue', [book('habits', 0.1)]);
    const merged = reconcileProgressRows([popular], [listening, popular], true);
    expect(merged.map(row => row.id)).toEqual(['listening', 'popular']);
  });

  test('Home keeps a Continue row from a later page, and takes it from its own re-read', () => {
    const first = shelf('recent', 'recentlyAdded', [book('x', 0)]);
    const second = shelf('ordinary', 'recommendation', [book('y', 0)]);
    const reading = shelf('continue-reading', 'continue', [book('kings', 0.1)]);
    const later = shelf('more', 'recommendation', [book('z', 0)]);
    const current = { rows: [first, second, reading, later], hero: [], heroActions: [] } as unknown as HomeModel;
    const fresh = { rows: [first, second], hero: [], heroActions: [] } as unknown as HomeModel;
    expect(laterProgressRows(current, fresh).map(row => row.id)).toEqual(['continue-reading']);
    expect(reconcileHomeProgress(current, fresh).rows.map(row => row.id)).toEqual(['recent', 'ordinary', 'continue-reading', 'more']);
    const reread = shelf('continue-reading', 'continue', [book('kings', 0.4)]);
    const merged = reconcileHomeProgress(current, fresh, [reread]);
    expect(merged.rows[2]!.items[0]!.media?.readingFraction).toBe(0.4);
    expect(merged.rows[0]).toBe(first);
    expect(merged.rows[3]).toBe(later);
  });

  test('a fresh card with nothing new is the shown card', () => {
    const shown = book('kings', 0.2);
    expect(freshCard(shown, { ...shown, media: { ...shown.media! } })).toBe(shown);
    expect(freshCard(shown, book('kings', 0.3))).not.toBe(shown);
  });

  test('a watched film redraws only the rows that show it', () => {
    const film = { ...card('film', 10), durationSeconds: 100 } as Card;
    const other = row('other', 'recommendation');
    const watching = { ...row('continue', 'continue'), items: [film] };
    const next = homeWatched(home([watching, other]), { titleId: 'film', positionSeconds: 50, finished: false });
    expect(next.rows[1]).toBe(other);
    expect(next.rows[0]!.items[0]!.progressSeconds).toBe(50);
  });
});

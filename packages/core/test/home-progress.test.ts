import { describe, expect, test } from 'bun:test';
import { adoptHome, adoptRows, drawnAs, freshCard, homeWatched, matchRows, reconcileShelves } from '../src/discovery/progress';
import type { Card, HeroAction, HomeModel, Row } from '../src/models';

const card = (id: string, progressSeconds = 0) => ({ id, progressSeconds, progressLabel: `${progressSeconds}`, played: false } as Card);
const row = (id: string, purpose: Row['purpose'], item = id): Row => ({
  id, purpose, name: id, receipt: '', items: [card(item)], nextCursor: '', continuation: 'exhausted', previewOnFocus: false, presentation: '', layout: 'standard', personal: false,
});
const action = (heroId: string, kind: HeroAction['action'], progress = 0) => ({ heroId, action: kind, progress } as HeroAction);
const home = (rows: Row[], hero: Card[] = [], heroActions: HeroAction[] = []) => ({ rows, hero, heroActions } as HomeModel);

describe('Home progress reconciliation', () => {
  test('takes the server\'s rows: ids, order and membership; matched rows keep their objects', () => {
    const ordinaryA = row('ordinary-a', 'recommendation');
    const ordinaryB = row('ordinary-b', 'collection');
    const paged = row('paged-row', 'recentlyAdded');
    const oldContinue = row('continue-old', 'continue', 'old');
    const nextUp = row('next-up', 'nextUp', 'episode-3');
    const newContinue = row('continue-new', 'continue', 'movie-2');
    const current = home([ordinaryA, oldContinue, ordinaryB, paged]);
    const fresh = home([nextUp, ordinaryA, newContinue, { ...ordinaryB, items: ordinaryB.items.map(value => ({ ...value })) }]);

    const merged = adoptHome(current, fresh);

    // A row the fresh read does not have goes (paged-row); the old Continue row is the new one.
    expect(merged.rows.map(value => value.id)).toEqual(['next-up', 'ordinary-a', 'continue-new', 'ordinary-b']);
    expect(merged.rows[0]).toBe(nextUp);
    expect(merged.rows[1]).toBe(ordinaryA);
    expect(merged.rows[2]!.items[0]!.id).toBe('movie-2');
    expect(merged.rows[3]).toBe(ordinaryB);
  });

  test('corrects hero progress and resume actions without replacing or reordering the carousel', () => {
    const first = card('first', 10), second = card('second');
    const current = home([], [first, second], [action('first', 'resume', 0.1), action('second', 'details')]);
    const fresh = home([], [card('second'), { ...card('first', 80), played: true }], [action('second', 'details'), action('first', 'play', 0)]);

    const merged = adoptHome(current, fresh);

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

  test('a library\'s Continue reading row takes the new place; unchanged shelves and cards keep their objects', () => {
    const popular = shelf('popular', 'recommendation', [book('kings', 0.002), book('empire', 0)]);
    const awards = shelf('awards', 'recommendation', [book('ender', 0)]);
    const reading = shelf('continue', 'continue', [book('kings', 0.002)]);
    const current = [reading, popular, awards];
    const fresh = [shelf('continue', 'continue', [book('kings', 0.31, '/art/kings?sig=2')]), shelf('popular', 'recommendation', [book('empire', 0), book('kings', 0.31)]), awards];

    const merged = adoptRows(current, fresh);

    expect(merged.map(row => row.id)).toEqual(['continue', 'popular', 'awards']);
    expect(merged[0]!.items[0]!.media?.readingFraction).toBe(0.31);
    // The shown picture is kept: a re-signed URL for the same cover never reloads it.
    expect(merged[0]!.items[0]!.poster).toBe('/art/kings?sig=1');
    // A recommendation shelf takes the server's order; its untouched card is the shown object.
    expect(merged[1]!.items.map(card => card.id)).toEqual(['empire', 'kings']);
    expect(merged[1]!.items[1]!.media?.readingFraction).toBe(0.31);
    expect(merged[1]!.items[0]).toBe(popular.items[1]);
    expect(merged[2]).toBe(awards);
  });

  test('nothing changed: the very same rows come back, so nothing draws again', () => {
    const current = [shelf('continue', 'continue', [book('kings', 0.2)]), shelf('popular', 'recommendation', [book('kings', 0.2)])];
    const fresh = current.map(row => ({ ...row, items: row.items.map(card => ({ ...card, media: { ...card.media! } })) }));
    expect(adoptRows(current, fresh)).toBe(current);
  });

  test('a finished book\'s Continue row goes when the whole list is fresh; a new one arrives beside its neighbour', () => {
    const popular = shelf('popular', 'recommendation', [book('a', 0)]);
    expect(adoptRows([shelf('continue', 'continue', [book('kings', 0.9)]), popular], [popular])).toEqual([popular]);
    const listening = shelf('listening', 'continue', [book('habits', 0.1)]);
    const merged = adoptRows([popular], [listening, popular]);
    expect(merged.map(row => row.id)).toEqual(['listening', 'popular']);
  });

  test('a re-minted row is matched by its key, else by what it is; it draws as it was, and keeps cards paged past the fresh read', () => {
    const items = [book('a', 0), book('b', 0), book('c', 0)];
    const named = (value: Row, name: string) => ({ ...value, name });
    const shown = [named(shelf('new@1', 'recommendation', items), 'New'), named(shelf('continue@1', 'continue', [book('kings', 0.1)]), 'Continue')];
    const fresh = [
      named(shelf('continue@2', 'continue', [book('kings', 0.4)]), 'Continue'),
      { ...named(shelf('new@2', 'recommendation', [book('a', 0), book('b', 0)]), 'New'), continuation: 'more' as const, nextCursor: 'new@2|2' },
    ];
    const merged = adoptRows(shown, fresh);
    expect(merged.map(row => row.id)).toEqual(['continue@2', 'new@2']);
    expect(merged.map(drawnAs)).toEqual(['continue@1', 'new@1']);
    expect(merged[1]!.items.map(card => card.id)).toEqual(['a', 'b', 'c']);
    expect(merged[1]!.items[2]).toBe(items[2]);
    expect(merged[1]!.nextCursor).toBe('new@2|2');
    // Read again: still drawn as first drawn.
    expect(adoptRows(merged, [{ ...fresh[0]!, id: 'continue@3' }]).map(drawnAs)).toEqual(['continue@1']);
    // Fresh items that begin differently are the server's alone.
    expect(adoptRows(shown, [{ ...fresh[1]!, items: [book('z', 0)] }])[0]!.items.map(card => card.id)).toEqual(['z']);
  });

  test('rows that cannot be told apart are not matched; keys decide over names; surface rows match by plugin and surface', () => {
    const twin = (id: string) => shelf(id, 'recommendation', [book(id, 0)]);
    expect(matchRows([twin('x@1'), twin('y@1')].map(row => ({ ...row, name: 'Picks' })), [twin('x@2'), twin('y@2')].map(row => ({ ...row, name: 'Picks' }))).size).toBe(0);
    const keyed = (id: string, key: string, name: string) => ({ ...twin(id), key, name });
    const pairs = matchRows([keyed('a@1', 'k1', 'Because you watched A'), keyed('b@1', 'k2', 'Top')], [keyed('b@2', 'k2', 'Top'), keyed('c@2', 'k3', 'Because you watched A')]);
    expect([...pairs].map(([fresh, old]) => [fresh.id, old.id])).toEqual([['b@2', 'b@1']]);
    const surface = (id: string): Row => ({ ...shelf(id, 'recommendation', []), name: 'Tonight', surface: 'tonight', plugin: 'sports' });
    expect([...matchRows([surface('s@1')], [surface('s@2')])].map(([fresh, old]) => [fresh.id, old.id])).toEqual([['s@2', 's@1']]);
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

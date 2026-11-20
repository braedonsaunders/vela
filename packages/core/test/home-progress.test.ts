import { describe, expect, test } from 'bun:test';
import { reconcileHomeProgress } from '../src/discovery/progress';
import type { Card, HeroAction, HomeModel, Row } from '../src/models';

const card = (id: string, progressSeconds = 0) => ({ id, progressSeconds, progressLabel: `${progressSeconds}`, played: false } as Card);
const row = (id: string, purpose: Row['purpose'], item = id): Row => ({
  id, purpose, name: id, receipt: '', items: [card(item)], nextCursor: '', continuation: 'exhausted', previewOnFocus: false, presentation: '',
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

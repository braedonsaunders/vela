import { describe, expect, test } from 'bun:test';
import { liveQuery, resultsFocus, type ResultsView, type Timers } from '../src/model';

function fakeTimers() {
  let now = 0;
  const queue = new Map<number, { at: number; run: () => void }>();
  let next = 1;
  const timers: Timers = {
    set(run, ms) { const id = next++; queue.set(id, { at: now + ms, run }); return id; },
    clear(handle) { queue.delete(handle as number); },
  };
  const advance = (ms: number) => {
    now += ms;
    for (const [id, timer] of [...queue].sort((a, b) => a[1].at - b[1].at)) {
      if (timer.at > now) continue;
      queue.delete(id);
      timer.run();
    }
  };
  return { timers, advance, pending: () => queue.size };
}

describe('liveQuery', () => {
  test('searches once typing pauses, with the latest text', () => {
    const { timers, advance } = fakeTimers();
    const searched: string[] = [];
    const live = liveQuery(text => searched.push(text), 250, timers);
    live.change('h');
    advance(100);
    live.change('he');
    advance(100);
    live.change('hei');
    expect(searched).toEqual([]);
    advance(250);
    expect(searched).toEqual(['hei']);
  });

  test('Return searches at once and drops the pending pause', () => {
    const { timers, advance, pending } = fakeTimers();
    const searched: string[] = [];
    const live = liveQuery(text => searched.push(text), 250, timers);
    live.change('heat');
    live.submit('heat');
    expect(searched).toEqual(['heat']);
    expect(pending()).toBe(0);
    advance(1000);
    expect(searched).toEqual(['heat']);
  });

  test('Return after the pause already searched the text does not search it again', () => {
    const { timers, advance } = fakeTimers();
    const searched: string[] = [];
    const live = liveQuery(text => searched.push(text), 250, timers);
    live.change('heat');
    advance(300);
    live.submit('heat');
    expect(searched).toEqual(['heat']);
  });

  test('emptying the field clears at once', () => {
    const { timers, advance } = fakeTimers();
    const searched: string[] = [];
    const live = liveQuery(text => searched.push(text), 250, timers);
    live.change('he');
    advance(300);
    live.change('');
    expect(searched).toEqual(['he', '']);
  });

  test('closing the screen searches nothing still pending', () => {
    const { timers, advance } = fakeTimers();
    const searched: string[] = [];
    const live = liveQuery(text => searched.push(text), 250, timers);
    live.change('heat');
    live.cancel();
    advance(1000);
    expect(searched).toEqual([]);
  });
});

const view = (query: string, state: ResultsView['titles']['state'], found = 0, described = 0): ResultsView => ({
  query,
  titles: { state, items: Array(found).fill({}), channels: [], programmes: [] },
  descriptive: { items: Array(described).fill({}) },
});

describe('resultsFocus', () => {
  test('waits for the titles of the submitted text', () => {
    expect(resultsFocus('heat', view('heat', 'loading'))).toBe('wait');
  });

  test('focuses the results once something came back', () => {
    expect(resultsFocus('heat', view('heat', 'ready', 3))).toBe('focus');
    expect(resultsFocus('heat', view('heat', 'failed', 0, 2))).toBe('focus');
  });

  test('leaves focus on the keyboard when nothing came back', () => {
    expect(resultsFocus('zzzz', view('zzzz', 'ready'))).toBe('drop');
    expect(resultsFocus('zzzz', view('zzzz', 'failed'))).toBe('drop');
  });

  test('drops the request once the query moved on or was cleared', () => {
    expect(resultsFocus('heat', view('heater', 'ready', 2))).toBe('drop');
    expect(resultsFocus('heat', undefined)).toBe('drop');
    expect(resultsFocus('  ', undefined)).toBe('drop');
  });
});

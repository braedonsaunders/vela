import { expect, test } from 'bun:test';
import type { Card } from '@vela/core';
import { timelineGroups, watchedTime } from '../src/widgets/library/timeline';

const card = (id: string, lastViewedAt = '', airDate = '') => ({ id, lastViewedAt, airDate } as Card);

test('timeline groups merge accumulated pages and remove overlap by item identity', () => {
  const now = new Date('2026-11-19T17:00:00Z');
  const first = [card('today', '2026-11-19T14:00:00Z'), card('yesterday', '2026-11-18T20:00:00Z')];
  const second = [card('yesterday', '2026-11-18T20:00:00Z'), card('week', '2026-11-16T12:00:00Z'), card('older', '2026-10-02T12:00:00Z')];
  const groups = timelineGroups([...first, ...second], now, 'America/Toronto');
  expect(groups.map(group => [group.label, group.items.map(item => item.id)])).toEqual([
    ['Today', ['today']], ['Yesterday', ['yesterday']], ['This week', ['week']], ['October 2026', ['older']],
  ]);
});

test('timeline calendar boundaries use the requested zone across DST and local midnight', () => {
  const beforeMidnight = new Date('2026-03-09T03:30:00Z'); // Mar 8, 23:30 in Toronto after the DST jump.
  expect(timelineGroups([card('same-day', '2026-03-08T05:30:00Z'), card('yesterday', '2026-03-08T04:30:00Z')], beforeMidnight, 'America/Toronto')
    .map(group => [group.label, group.items.map(item => item.id)])).toEqual([['Today', ['same-day']], ['Yesterday', ['yesterday']]]);
  const afterMidnight = new Date('2026-03-09T04:30:00Z');
  expect(timelineGroups([card('previous', '2026-03-09T03:30:00Z')], afterMidnight, 'America/Toronto')[0]?.label).toBe('Yesterday');
});

test('timeline falls back to release dates and leaves invalid undated items in the tail', () => {
  const groups = timelineGroups([card('release', '', '2026-11-18'), card('none'), card('bad', 'not-rfc3339')], new Date('2026-11-19T12:00:00Z'), 'UTC');
  expect(groups.map(group => [group.label, group.items.map(item => item.id)])).toEqual([
    ['Yesterday', ['release']], ['Earlier', ['none', 'bad']],
  ]);
  expect(watchedTime('2026-11-19T10:00:00Z', new Date('2026-11-19T12:00:00Z'), 'en')).toBe('2 hours ago');
});

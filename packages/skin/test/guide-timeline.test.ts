import { expect, test } from 'bun:test';
import type { GuideModel } from '@vela/core';
import { prependOffset, requestedDays, timeline } from '../src/widgets/guide/timeline';

const block = (day: number, minutes = 1440): GuideModel => ({
  day, dayLabel: '', fromLabel: '', untilLabel: '', minutes, nowMinute: day === 0 ? 100 : -1,
  nowLabel: '', landing: 100, ticks: [{ id: String(day), label: '', minute: 0, hour: true }],
  days: [], groups: [], guides: [], tuneOrder: [], channels: [],
});

test('timeline appends and prepends local days without moving the visible instant', () => {
  const one = timeline(new Map([[1, block(1)]]), 1);
  const appended = timeline(new Map([[1, block(1)], [2, block(2, 1500)]]), 1);
  expect(appended.dayStarts).toEqual({ 1: 0, 2: 1440 });
  expect(appended.minutes).toBe(2940);
  const prepended = timeline(new Map([[0, block(0, 1380)], [1, block(1)], [2, block(2, 1500)]]), 1);
  expect(prependOffset(one.dayStarts, prepended.dayStarts)).toBe(1380);
  expect(prepended.nowMinute).toBe(100);
  expect(prepended.ticks.map(t => t.minute)).toEqual([0, 1380, 2820]);
});

test('nearby edges request adjacent days within the seven-day cap', () => {
  expect(requestedDays(1, 2, 100, 2800, 2880)).toEqual([0, 3]);
  expect(requestedDays(0, 6, 0, 10080, 10080)).toEqual([]);
  expect(requestedDays(0, 0, 200, 1000, 1440)).toEqual([]);
});

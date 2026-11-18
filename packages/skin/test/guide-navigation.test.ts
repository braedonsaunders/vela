import { expect, test } from 'bun:test';
import { bandOffset, gapStep, PreviewDebounce, rowWindow } from '../src/widgets/guide/navigation';
import { programmeAt } from '../src/widgets/guide/geometry';
import type { GuideChannel } from '@vela/core';

test('scroll band preserves position inside it and advances by a single row at the edge', () => {
  expect(bandOffset(192, 96, 0, 480, 960000)).toBe(0);
  expect(bandOffset(384, 96, 0, 480, 960000)).toBe(96);
  expect(bandOffset(96, 96, 192, 480, 960000)).toBe(0);
  expect(bandOffset(959904, 96, 959800, 480, 960000)).toBe(959520);
});
test('row lookahead is bounded and balanced at 1,000 and 10,000 channels', () => {
  for (const count of [1000, 10000]) {
    expect(rowWindow(500, count, 6)).toEqual({ start: 488, end: 518 });
    expect(rowWindow(0, count, 6)).toEqual({ start: 0, end: 18 });
    expect(rowWindow(count - 2, count, 6).end).toBe(count);
  }
});
test('empty guide intervals remain navigable across request windows without leaving the timeline', () => {
  expect(gapStep(170, 1, 1440)).toBe(230);
  expect(gapStep(190, -1, 1440)).toBe(130);
  expect(gapStep(20, -1, 1440)).toBe(0);
  expect(gapStep(1430, 1, 1440)).toBeCloseTo(1439.99);
});
test('vertical focus retains its time across rows with different programme lengths', () => {
  const channel = { programmes: [{ id: 'a', at: 0, span: 45 }, { id: 'b', at: 45, span: 60 }] } as GuideChannel;
  expect(programmeAt(channel, 44)?.id).toBe('a');
  expect(programmeAt(channel, 45)?.id).toBe('b');
  expect(programmeAt(channel, 90)?.id).toBe('b');
});
test('preview coalesces rapid movement and cancels on leaving the guide', async () => {
  const tunes: string[] = [];
  const debounce = new PreviewDebounce(id => tunes.push(id), 10);
  debounce.select('one'); debounce.select('two'); debounce.select('three');
  await Bun.sleep(25);
  expect(tunes).toEqual(['three']);
  debounce.select('four'); debounce.cancel();
  await Bun.sleep(25);
  expect(tunes).toEqual(['three']);
});
test('time lookahead uses reusable windows and clamps to the local day', async () => {
  const { timeWindow } = await import('../src/widgets/guide/navigation');
  expect(timeWindow(400, 700)).toEqual({ from: 360, to: 720 });
  expect(timeWindow(410, 710)).toEqual(timeWindow(400, 700));
  expect(timeWindow(1400, 1600)).toEqual({ from: 1260, to: 1440 });
  expect(timeWindow(1400, 1700, 1440)).toEqual({ from: 0, to: 360 });
});
test('recycling retains visible programme slots and bounds the native pool while scrolling', async () => {
  const { ProgrammeSlots } = await import('../src/widgets/guide/navigation');
  const slots = new ProgrammeSlots();
  const first = slots.keys(['a', 'b', 'c']);
  const second = slots.keys(['b', 'c', 'd']);
  expect(second.slice(0, 2)).toEqual(first.slice(1));
  expect(second[2]).toBe(first[0]);
  for (let i = 0; i < 10000; i++) {
    const keys = slots.keys([String(i), String(i + 1), String(i + 2)]);
    expect(new Set(keys).size).toBe(3);
    expect(Math.max(...keys)).toBe(2);
  }
});
test('a fully recycled row keeps native child order instead of reversing every cell', async () => {
  const { ProgrammeSlots } = await import('../src/widgets/guide/navigation');
  const slots = new ProgrammeSlots();
  expect(slots.keys(['a', 'b', 'c', 'd'])).toEqual([0, 1, 2, 3]);
  expect(slots.keys(['e', 'f'])).toEqual([0, 1]);
  expect(slots.keys(['g', 'h', 'i', 'j'])).toEqual([0, 1, 2, 3]);
});

test('TV taps, long presses and swipes share directional navigation', async () => {
  const { remoteDirection } = await import('../src/widgets/guide/navigation');
  expect(remoteDirection('down')).toBe('ArrowDown');
  expect(remoteDirection('longDown')).toBe('ArrowDown');
  expect(remoteDirection('longRight')).toBe('ArrowRight');
  expect(remoteDirection('swipeUp')).toBe('ArrowUp');
  expect(remoteDirection('select')).toBeUndefined();
});
test('long programmes preserve the focused time rather than jumping to their start', async () => {
  const { programmeMinute } = await import('../src/widgets/guide/navigation');
  const programme = { at: 480, span: 360 };
  const minute = programmeMinute(programme, 780);
  expect(minute).toBe(780);
  expect(bandOffset(minute * 6, 1, 720 * 6, 180 * 6, 1440 * 6)).toBe(720 * 6);
  expect(programmeMinute(programme, 900)).toBeLessThan(840);
  expect(programmeMinute(programme, -1)).toBe(480);
});
test('programme focus IDs remain distinct across channels and delimiter characters', async () => {
  const { cellId } = await import('../src/widgets/guide/geometry');
  expect(cellId('shared-programme', 'one')).not.toBe(cellId('shared-programme', 'two'));
  expect(cellId('a|b', 'c')).not.toBe(cellId('b', 'c|a'));
});

import { expect, test } from 'bun:test';
import type { GuideModel } from '@vela/core';
import { guideMinute, gridContentKey, currentlyAiring } from '../src/widgets/guide/content';

test('the now marker moves once per minute, including before/after the visible day', () => {
  expect([100, 100.01, 100.5, 100.999].map(guideMinute)).toEqual([100,100,100,100]);
  expect(guideMinute(101)).toBe(101);
  expect(guideMinute(-1)).toBe(-1);
});

test('clock/progress changes do not invalidate rows, only listing content does', () => {
  const model = {day:0,minutes:1440,ticks:[],nowMinute:100,nowLabel:'1:40', channels:[{id:'one',name:'One',listed:true,listingsLoaded:true,programmes:[{id:'p',name:'Programme',at:90,span:30,airing:true,ended:false,progress:30,remainingLabel:'20 min'}]}]} as unknown as GuideModel;
  const tick = structuredClone(model);
  tick.nowMinute=101; tick.nowLabel='1:41'; tick.channels[0]!.programmes[0]!.progress=40;
  tick.channels[0]!.programmes[0]!.remainingLabel='19 min';
  expect(gridContentKey(model,model.channels)).toBe(gridContentKey(tick,tick.channels));
  const boundary=structuredClone(tick);boundary.channels[0]!.programmes[0]!.airing=false;
  expect(currentlyAiring(model,'one','p')).toBe(true);
  expect(currentlyAiring(boundary,'one','p')).toBe(false);
  expect(gridContentKey(boundary,boundary.channels)).toBe(gridContentKey(model,model.channels));
  const changed=structuredClone(tick);changed.channels[0]!.programmes[0]!.name='Corrected listing';
  expect(gridContentKey(changed,changed.channels)).not.toBe(gridContentKey(model,model.channels));
});
test('large shared lineups compare by unchanged rows while preserving clock isolation', async () => {
  const { sameGridContent } = await import('../src/widgets/guide/content');
  const channels = Array.from({ length: 10000 }, (_, index) => ({ id: String(index), programmes: [], listingsLoaded: false }));
  const model = { day: 0, minutes: 1440, ticks: [], channels } as unknown as GuideModel;
  const next = { ...model, channels: [...model.channels] };
  expect(sameGridContent(model, model.channels, next, next.channels)).toBe(true);
  next.channels[9999] = { ...next.channels[9999]!, listingsLoaded: true };
  expect(sameGridContent(model, model.channels, next, next.channels)).toBe(false);
});

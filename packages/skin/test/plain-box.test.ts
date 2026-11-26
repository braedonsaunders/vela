import { describe, expect, test } from 'bun:test';
import { plainBox } from '../src/plain-box';
import type { RNode } from '../src/resolve';

type BoxNode = Extract<RNode, { kind: 'box' }>;
const box = (fields: Partial<BoxNode> = {}): BoxNode => ({
  kind: 'box', children: [], when: [], base: { style: { display: 'flex', opacity: '0.86' } }, states: [],
  group: false, order: 0, controlStates: false, ...fields,
}) as BoxNode;

describe('boxes that only draw', () => {
  test('a card\'s art frame, gloss and caption only draw, whatever their group looks do', () => {
    expect(plainBox(box({ base: { style: { position: 'relative', 'border-radius': '12px', 'overflow-x': 'hidden', 'box-shadow': '0 0 0 1px #fff' },
      groupFocus: { scale: '1.045' } } }))).toBe(true);
    expect(plainBox(box({ base: { style: { 'background-image': 'linear-gradient(145deg, #ffffff21 0%, #ffffff00 42%)' } } }))).toBe(true);
    expect(plainBox(box({ base: { style: { display: 'none' } } }))).toBe(true);
  });

  test('anything Box does beyond drawing keeps a box with Box', () => {
    expect(plainBox(box({ press: { action: 'select', arg: 'x' } }))).toBe(false);
    expect(plainBox(box({ group: true }))).toBe(false);
    expect(plainBox(box({ escape: ['menu'] }))).toBe(false);
    expect(plainBox(box({ pager: {} }))).toBe(false);
    expect(plainBox(box({ readingStop: true }))).toBe(false);
    expect(plainBox(box({ role: 'navigation' }))).toBe(false);
    expect(plainBox(box({ motion: { keyframes: 'rise' } as BoxNode['motion'] }))).toBe(false);
    expect(plainBox(box({ id: 'vela-library-views' }))).toBe(false);
    expect(plainBox(box({ testId: 'detail-close' }))).toBe(false);
  });

  test('a scroll, grid, sticky header, mask, blur or url() background in any state keeps Box', () => {
    expect(plainBox(box({ base: { style: { 'overflow-y': 'auto' } } }))).toBe(false);
    expect(plainBox(box({ base: { style: { display: 'grid' } } }))).toBe(false);
    expect(plainBox(box({ base: { style: { position: 'sticky' } } }))).toBe(false);
    expect(plainBox(box({ base: { style: { 'mask-image': 'linear-gradient(black, transparent)' } } }))).toBe(false);
    expect(plainBox(box({ base: { style: { 'backdrop-filter': 'blur(20px)' } } }))).toBe(false);
    expect(plainBox(box({ base: { style: { 'background-image': 'url(art.jpg)' } } }))).toBe(false);
    expect(plainBox(box({ states: [{ when: [], layer: { style: { overflow: 'scroll' } } }] }))).toBe(false);
    expect(plainBox(box({ active: { display: 'grid' } }))).toBe(false);
  });

  test('a bound value could be any of them', () => {
    expect(plainBox(box({ base: { style: { display: { parts: ['', () => 'grid'] } as never } } }))).toBe(false);
    expect(plainBox(box({ base: { style: { width: { parts: ['', () => '50'] } as never } } }))).toBe(true);
  });
});

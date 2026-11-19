import { expect, test } from 'bun:test';
import type { GuideChannel } from '@vela/core';
import { nativeGuideChannels, nativeGuideLineup } from '../src/widgets/guide/native-data';
import { logoIdentity } from '../src/widgets/guide/logo';

test('native and RN logo identities agree when a recycled row changes channel or URL', () => {
  const channel = (id: string, logo: string) => ({ id, logo, programmes: [] }) as unknown as GuideChannel;
  const a = nativeGuideChannels([channel('fox', '/fox')], 0, 60)[0]!;
  const b = nativeGuideChannels([channel('tlc', '/tlc')], 0, 60)[0]!;
  expect(a.logoKey).toBe(logoIdentity('fox', '/fox'));
  expect(b.logoKey).toBe(logoIdentity('tlc', '/tlc'));
  expect(a.logoKey).not.toBe(b.logoKey);
  expect(nativeGuideChannels([channel('fox', '')], 0, 60)[0]!.logoKey).not.toBe(a.logoKey);
});

test('10,000 native channel descriptors keep only intersecting programme geometry and stable IDs', () => {
  const programmes = [{ id: 'before', at: 0, span: 60 }, { id: 'overlap', at: 60, span: 180 }, { id: 'after', at: 240, span: 30 }];
  const rows = Array.from({ length: 10000 }, (_, i) => ({ id: `channel-${i}`, programmes })) as unknown as GuideChannel[];
  const projected = nativeGuideChannels(rows, 120, 240);
  expect(projected.length).toBe(10000);
  expect(projected[9999]!.id).toBe('channel-9999');
  expect(projected.every(row => row.cells.length === 1 && row.cells[0]!.id === 'overlap')).toBe(true);
  expect(projected[0]!.cells[0]).toEqual({ id: 'overlap', at: 60, span: 180 });
  expect(nativeGuideChannels(rows.slice(0, 1), 240, 270)[0]!.cells).toEqual([{ id: 'after', at: 240, span: 30 }]);
});

test('native lineup keeps its identity across programme loads and changes image identity on replacement', () => {
  const a = [{ id: 'fox', name: 'Fox', number: '1', logo: '/fox', programmes: [] }] as unknown as GuideChannel[];
  const first = nativeGuideLineup(a);
  const updated = [{ ...a[0]!, programmes: [{ id: 'programme' }] }] as unknown as GuideChannel[];
  expect(nativeGuideLineup(updated, first)).toBe(first);
  const changed = nativeGuideLineup([{ ...a[0]!, logo: '/new' }], first);
  expect(changed).not.toBe(first);
  expect(changed[0]!.logoKey).not.toBe(first[0]!.logoKey);
});

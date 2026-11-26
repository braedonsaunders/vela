import { describe, expect, test } from 'bun:test';
import { groupIntoMap, groupIntoObject, installGroupBy } from '../../../apps/vela/src/media/group-by';

describe('groupBy for older web views (foliate-js EPUB parsing)', () => {
  test('groups into a null-prototype object in encounter order, passing the index', () => {
    const seen: number[] = [];
    const groups = groupIntoObject(['a1', 'b1', 'a2'], (item, index) => { seen.push(index); return item[0]!; });
    expect(Object.getPrototypeOf(groups)).toBeNull();
    expect({ ...groups }).toEqual({ a: ['a1', 'a2'], b: ['b1'] });
    expect(seen).toEqual([0, 1, 2]);
  });
  test('groups into a Map keyed by any value', () => {
    const one = { id: 1 };
    const groups = groupIntoMap([one, { id: 2 }, one], item => item);
    expect(groups.get(one)).toEqual([one, one]);
    expect(groups.size).toBe(2);
  });
  test('installs only where missing and never replaces a native implementation', () => {
    const fakeObject: Record<string, unknown> = {};
    const native = () => 'native';
    const fakeMap: Record<string, unknown> = { groupBy: native };
    installGroupBy(fakeObject, fakeMap as object);
    expect(fakeObject.groupBy).toBe(groupIntoObject);
    expect(fakeMap.groupBy).toBe(native);
    expect(Object.keys(fakeObject)).toEqual([]);
  });
});

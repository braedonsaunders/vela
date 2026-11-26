import { expect, test } from 'bun:test';
import { installPdfBuiltins } from '../../../apps/vela/src/media/pdf-builtins';

test('PDF.js can dispatch an action synchronously and await its result on older web views', async () => {
  const stub = {} as { try: (this: PromiseConstructor, action: (data: number, sink: number) => number | Promise<number>, data: number, sink: number) => Promise<number> };
  installPdfBuiltins(stub, {}, {}, {});
  const calls: number[] = [];
  const result = stub.try.call(Promise, (data, sink) => {
    calls.push(data, sink);
    return Promise.resolve(data + sink);
  }, 2, 3);
  expect(calls).toEqual([2, 3]);
  expect(await result).toBe(5);
  await expect(stub.try.call(Promise, () => { throw new Error('bad action'); }, 0, 0)).rejects.toThrow('bad action');
});

test('PDF.js can encode a fingerprint without replacing native built-ins', () => {
  const native = () => Promise.resolve('native');
  const stub = { try: native };
  const bytes = {} as { toHex: (this: Uint8Array) => string };
  installPdfBuiltins(stub, bytes, {}, {});
  expect(stub.try).toBe(native);
  expect(bytes.toHex.call(Uint8Array.of(0x00, 0x0a, 0xbc, 0xff))).toBe('000abcff');
  expect(bytes.toHex.call(new Uint8Array())).toBe('');
});

test('PDF.js can find the pending range by its offset', () => {
  const ranges = new Set([32, 64, 96]);
  const stub = {} as { find: (this: IterableIterator<number>, predicate: (offset: number, index: number) => boolean) => number | undefined };
  installPdfBuiltins({}, {}, stub, {});
  const offsets = ranges.keys();
  expect(stub.find.call(offsets, (offset, index) => offset === 64 && index === 1)).toBe(64);
  expect(offsets.next().value).toBe(96);
  expect(stub.find.call(offsets, () => true)).toBeUndefined();
});

test('PDF.js caches computed values including undefined', () => {
  const cache = new Map<string, number | undefined>();
  const stub = {} as { getOrInsertComputed: (this: typeof cache, key: string, compute: (key: string) => number | undefined) => number | undefined };
  installPdfBuiltins({}, {}, {}, stub);
  const get = stub.getOrInsertComputed.bind(cache);
  expect(get('page', key => key.length)).toBe(4);
  expect(get('page', () => 0)).toBe(4);
  expect(get('missing', () => undefined)).toBeUndefined();
  expect(get('missing', () => 1)).toBeUndefined();
});

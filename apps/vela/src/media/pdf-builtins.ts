// PDF.js runs its worker in this realm. Install the built-ins the pinned build
// uses for message dispatch, fingerprints, range reads and caches on older web views.
export function installPdfBuiltins(
  promiseCtor: object = Promise,
  bytesPrototype: object = Uint8Array.prototype,
  setIteratorPrototype: object = Object.getPrototypeOf(new Set().keys()),
  mapPrototype: object = Map.prototype,
): void {
  if (typeof (promiseCtor as { try?: unknown }).try !== 'function') {
    Object.defineProperty(promiseCtor, 'try', {
      configurable: true,
      writable: true,
      value: function <T, Args extends unknown[]>(this: PromiseConstructor, callback: (...args: Args) => T | PromiseLike<T>, ...args: Args): Promise<T> {
        return new this<T>(resolve => resolve(callback(...args)));
      },
    });
  }
  if (typeof (bytesPrototype as { toHex?: unknown }).toHex !== 'function') {
    Object.defineProperty(bytesPrototype, 'toHex', {
      configurable: true,
      writable: true,
      value: function (this: Uint8Array): string {
        let hex = '';
        for (const byte of this) hex += byte.toString(16).padStart(2, '0');
        return hex;
      },
    });
  }
  if (typeof (setIteratorPrototype as { find?: unknown }).find !== 'function') {
    Object.defineProperty(setIteratorPrototype, 'find', {
      configurable: true,
      writable: true,
      value: function <T>(this: IterableIterator<T>, predicate: (value: T, index: number) => unknown): T | undefined {
        let index = 0;
        for (const value of this) {
          if (predicate(value, index++)) return value;
        }
        return undefined;
      },
    });
  }
  if (typeof (mapPrototype as { getOrInsertComputed?: unknown }).getOrInsertComputed !== 'function') {
    Object.defineProperty(mapPrototype, 'getOrInsertComputed', {
      configurable: true,
      writable: true,
      value: function <K, V>(this: Map<K, V>, key: K, compute: (key: K) => V): V {
        if (this.has(key)) return this.get(key)!;
        const value = compute(key);
        this.set(key, value);
        return value;
      },
    });
  }
}

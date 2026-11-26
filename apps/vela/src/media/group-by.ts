// ES2024 built-ins the reader's libraries call: Object.groupBy and Map.groupBy (foliate-js's EPUB
// parser) and Promise.withResolvers (pdf.js). The reader engine runs in the platform web view, and
// older Android System WebViews (Chrome < 117 and < 119) lack them, so EPUBs and PDFs failed to
// open there. Installed only where missing, before the engine loads.
type Grouper<T, K> = (item: T, index: number) => K;

export function groupIntoObject<T>(items: Iterable<T>, key: Grouper<T, PropertyKey>): Record<PropertyKey, T[]> {
  const groups: Record<PropertyKey, T[]> = Object.create(null);
  let index = 0;
  for (const item of items) (groups[key(item, index++)] ??= []).push(item);
  return groups;
}

export function groupIntoMap<T, K>(items: Iterable<T>, key: Grouper<T, K>): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  let index = 0;
  for (const item of items) {
    const k = key(item, index++);
    const group = groups.get(k);
    if (group) group.push(item); else groups.set(k, [item]);
  }
  return groups;
}

export function withResolvers<T>(this: PromiseConstructor | void): { promise: Promise<T>; resolve: (value: T | PromiseLike<T>) => void; reject: (reason?: unknown) => void } {
  const Ctor = (typeof this === 'function' ? this : Promise) as PromiseConstructor;
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Ctor<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

/** Adds the missing ES2024 functions (the two groupBys and Promise.withResolvers) to the given constructors. */
export function installGroupBy(objectCtor: object = Object, mapCtor: object = Map, promiseCtor: object = Promise): void {
  const define = (target: object, name: string, value: unknown) => {
    if (typeof (target as Record<string, unknown>)[name] === 'function') return;
    Object.defineProperty(target, name, { value, writable: true, configurable: true, enumerable: false });
  };
  define(objectCtor, 'groupBy', groupIntoObject);
  define(mapCtor, 'groupBy', groupIntoMap);
  define(promiseCtor, 'withResolvers', withResolvers);
}

// Object.groupBy and Map.groupBy (ES2024), which foliate-js's EPUB parser calls. The reader engine
// runs in the platform web view, and older Android System WebViews (Chrome < 117) lack both, so
// every EPUB failed to open there. Installed only where missing, before the engine loads.
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

/** Adds the two groupBy functions to the given constructors when they are missing. */
export function installGroupBy(objectCtor: object = Object, mapCtor: object = Map): void {
  const define = (target: object, name: string, value: unknown) => {
    if (typeof (target as Record<string, unknown>)[name] === 'function') return;
    Object.defineProperty(target, name, { value, writable: true, configurable: true, enumerable: false });
  };
  define(objectCtor, 'groupBy', groupIntoObject);
  define(mapCtor, 'groupBy', groupIntoMap);
}

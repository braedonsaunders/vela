// Which sources a parameter change re-reads: those whose served `deps` name a changed param.
// Ether derives `deps` from each source's {param.x} holes; a source served without them is read
// for its holes here, so an older document never keeps stale data.
import type { ScreenDocument, SourceSpec } from '../wire';

/** The params a source reads: its served `deps`, else the {param.x} holes in its arguments. */
export function sourceDeps(spec: SourceSpec): string[] {
  if (Array.isArray(spec.deps)) return spec.deps.filter((name): name is string => typeof name === 'string');
  const found = new Set<string>();
  const { deps: _deps, from: _from, lazy: _lazy, ...args } = spec;
  for (const match of JSON.stringify(args).matchAll(/\{param\.([A-Za-z0-9_-]+)/g)) found.add(match[1]!);
  return [...found];
}

export const isLazy = (document: ScreenDocument | undefined, source: string) => document?.sources?.[source]?.lazy === true;

/** The sources the first read (and a refresh) asks for: every source that is not lazy, plus lazy ones already read. */
export function eagerSources(document: ScreenDocument, readLazy: ReadonlySet<string>): string[] {
  return Object.entries(document.sources ?? {}).filter(([name, spec]) => !spec?.lazy || readLazy.has(name)).map(([name]) => name).sort();
}

/**
 * The sources to read again after `changed` params changed: those depending on one of them, lazy
 * ones only when already read. Without the document (deps unknown) every source the page holds.
 */
export function sourcesToReread(document: ScreenDocument | undefined, changed: readonly string[], held: Iterable<string>, readLazy: ReadonlySet<string>): string[] {
  if (!changed.length) return [];
  const heldSet = new Set(held);
  if (!document?.sources) return [...heldSet].sort();
  const set = new Set(changed);
  return Object.entries(document.sources)
    .filter(([name, spec]) => spec && (!spec.lazy || readLazy.has(name) || heldSet.has(name)))
    .filter(([, spec]) => sourceDeps(spec).some(name => set.has(name)))
    .map(([name]) => name)
    .sort();
}

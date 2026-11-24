// Which page or surface a read is for, and its canonical key. A page is one document read with
// one set of parameters (and, for a surface, the host's context): `pages[key]` in the store, and
// the unit a data read, a stream topic and an action belong to.
import type { SurfaceContext } from '../wire';

export type ScreenTarget = { kind: 'screen'; id: string; page: string } | { kind: 'surface'; id: string };

/** What a host opens: the document's href (from bootstrap or a navigate), the target and its params. */
export interface PageRequest {
  target: ScreenTarget;
  href: string;
  params?: Record<string, string>;
  context?: SurfaceContext;
}

/** The context names a surface read sends to Ether (as `p.<name>`); chrome, pictureTime and delayed stay here. */
export function serverContext(context: SurfaceContext | undefined): Record<string, string> {
  if (!context) return {};
  const out: Record<string, string> = {};
  for (const name of ['event', 'channel', 'title', 'kind'] as const) {
    const value = context[name];
    if (typeof value === 'string' && value) out[name] = value;
  }
  if (typeof context.alert?.ref === 'string' && context.alert.ref) out['alert.ref'] = context.alert.ref;
  return out;
}

/** Params as sent: string values only, empty ones left out (an empty param is the default). */
export function cleanParams(params: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(params ?? {})) {
    if (typeof value === 'string' && value !== '') out[name] = value;
    else if ((typeof value === 'number' && Number.isFinite(value)) || typeof value === 'boolean') out[name] = String(value);
  }
  return out;
}

const encode = (values: Record<string, string>) =>
  Object.keys(values).sort().map(name => `${encodeURIComponent(name)}=${encodeURIComponent(values[name]!)}`).join('&');

/** `screen:<id>/<page>?a=1&b=2` or `surface:<id>?event=…`: sorted, empty params dropped, so equal
 * requests share one page. A surface's key holds only the context Ether reads. */
export function pageKey(target: ScreenTarget, params?: Record<string, unknown>, context?: SurfaceContext): string {
  const base = target.kind === 'screen' ? `screen:${target.id}/${target.page}` : `surface:${target.id}`;
  const query = encode({ ...cleanParams(params), ...Object.fromEntries(Object.entries(serverContext(context)).map(([name, value]) => [`context.${name}`, value])) });
  return query ? `${base}?${query}` : base;
}

export const sameTarget = (a: ScreenTarget, b: ScreenTarget) =>
  a.kind === b.kind && a.id === b.id && (a.kind === 'surface' || a.page === (b as typeof a).page);

/** The params whose value differs between two sets (added, removed or changed). */
export function changedParams(before: Record<string, string>, after: Record<string, string>): string[] {
  const names = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...names].filter(name => (before[name] ?? '') !== (after[name] ?? '')).sort();
}

/** Another page's document href beside a known one (navigate within a screen): the same
 * `v`, `r` and `l`, with `/pages/<page>/` swapped. Ether serves that page's variant (a stale `v`
 * answers 301 with the fresh href, which the client follows). */
export function screenDocumentHref(href: string, page: string): string {
  return href.replace(/\/pages\/[^/?#]+\/document/, `/pages/${encodeURIComponent(page)}/document`);
}

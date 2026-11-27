// A lazily resolved document (the app's cold start) draws every route as the eager one does, resolving
// only home, the shell and the library switch until another route is first read.
import { expect, test } from 'bun:test';
import { resolveDocument } from '../src/resolve';
import { cinematicDoc } from '../../protocol/fixtures/skins/cinematic';
import marquee from '../../protocol/fixtures/skins/marquee/document';
import type { SkinDocument } from '../../protocol/skin';

/** A resolved tree as comparable text: compiled templates are functions, compared by their source. */
const shape = (value: unknown) => JSON.stringify(value, (_key, v) => (typeof v === 'function' ? `fn:${String(v)}` : v instanceof Set ? [...v] : v));

for (const doc of [cinematicDoc, marquee] as SkinDocument[]) {
  test(`${doc.id}: every lazy route and the media title equal the eager ones`, () => {
    const eager = resolveDocument(doc, 1920, 'en');
    const lazy = resolveDocument(doc, 1920, 'en', undefined, { lazy: true });
    expect(Object.keys(lazy.routes).sort()).toEqual(Object.keys(eager.routes).sort());
    expect(shape(lazy.shell)).toBe(shape(eager.shell));
    expect(shape(lazy.routes.home)).toBe(shape(eager.routes.home));
    for (const name of Object.keys(eager.routes) as (keyof typeof eager.routes)[]) expect(shape(lazy.routes[name])).toBe(shape(eager.routes[name]));
    expect(shape(lazy.mediaTitle)).toBe(shape(eager.mediaTitle));
    expect(shape(lazy.mediaTitleSlot)).toBe(shape(eager.mediaTitleSlot));
    expect([...lazy.unsupported].sort()).toEqual([...eager.unsupported].sort());
  });
}

test('a lazy route is resolved once, when first read', () => {
  const lazy = resolveDocument(cinematicDoc as SkinDocument, 1920, 'en', undefined, { lazy: true });
  const first = lazy.routes.title;
  expect(first).toBeDefined();
  expect(lazy.routes.title).toBe(first);
});

test('a lazy route that cannot be resolved is left out, not thrown at its reader', () => {
  const broken = { ...cinematicDoc, routes: { ...(cinematicDoc as SkinDocument).routes, search: { type: 'use', template: 'nope' } } } as SkinDocument;
  expect(() => resolveDocument(broken, 1920, 'en')).toThrow('Unknown template nope');
  const lazy = resolveDocument(broken, 1920, 'en', undefined, { lazy: true });
  const warn = console.warn;
  console.warn = () => {};
  try { expect(lazy.routes.search).toBeUndefined(); } finally { console.warn = warn; }
  expect(lazy.routes.home).toBeDefined();
});

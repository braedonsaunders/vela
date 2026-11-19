import { expect, test } from 'bun:test';
import { resolveDocument, holds, fill, type RNode } from '../src/resolve';
import type { Env, Ctx } from '../src/vocabulary';
import { cinematicDoc } from '../../protocol/fixtures/skins/cinematic';
import mochi from '../../protocol/fixtures/skins/mochi/document';
import kids from '../../protocol/fixtures/skins/kids/document';

for (const doc of [cinematicDoc, mochi, kids]) {
  for (const view of ['collections', 'people', 'genres', 'recommended'] as const) {
    test(`${doc.id}: ${view} is empty only after its own successful answer`, () => {
      const root = resolveDocument({ ...doc, routes: { ...doc.routes, library: { type: 'use', template: 'velaLibraryAlternative' } } }, 1440).routes.library!;
      const ctx = { index: 0 } as Ctx;
      const texts = (status: string) => {
        const env = { load: 'ready', library: { view, viewLoad: status, extras: { rows: [], collections: [], genres: [] } } } as unknown as Env;
        const result: string[] = [];
        const walk = (node: RNode) => {
          if (!holds(node.when, ctx, env)) return;
          if (node.kind === 'text') result.push(fill(node.text, ctx, env));
          if (node.kind === 'box') node.children.forEach(walk);
        };
        walk(root); return result;
      };
      expect(texts('ready').length).toBe(1);
      for (const status of ['idle', 'loading']) expect(texts(status)).toEqual([]);
      expect(texts('failed').join(' ')).not.toMatch(/No collections|No people|no rows|No genres/);
    });
  }
}

import { expect, test } from 'bun:test';
import mochiDoc from '../../protocol/fixtures/skins/mochi/document';
import { holds, resolveDocument, type RNode } from '../src/resolve';
import type { Env } from '../src/vocabulary';

function find(node: RNode, matches: (node: RNode) => boolean): RNode | undefined {
  if (matches(node)) return node;
  if (node.kind === 'repeat') return find(node.item, matches);
  if (node.kind === 'box') for (const child of node.children) { const result = find(child, matches); if (result) return result; }
}

test('Mochi folds featured content when empty search takes focus, before keyboard input', () => {
  for (const width of [390, 800, 1280]) {
    const home = resolveDocument(mochiDoc, width).routes.home!;
    const hero = find(home, node => node.kind === 'repeat' && node.over === 'home.hero')!;
    const dots = find(home, node => node.kind === 'box' && node.children.some(child => child.kind === 'repeat' && child.over === 'home.heroes'))!;
    const env = { load: 'ready', flags: [], query: '', home: { hero: [{ id: 'featured' }, { id: 'other' }] } } as unknown as Env;
    expect(holds(hero.when, { index: 0 }, env)).toBe(true);
    expect(holds(dots.when, { index: 0 }, env)).toBe(true);
    const focused = { ...env, flags: ['search-focused'] };
    expect(holds(hero.when, { index: 0 }, focused)).toBe(false);
    expect(holds(dots.when, { index: 0 }, focused)).toBe(false);
  }
});

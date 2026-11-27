import { expect, test } from 'bun:test';
import { cinematicDoc } from '../../protocol/fixtures/skins/cinematic';
import { copyColumn, heroPager } from '../src/resolve/vela-base/home';
import { holds, resolveDocument } from '../src/resolve';
import type { Env } from '../src/vocabulary';

test('empty focused search folds hero copy above a native keyboard and restores it on blur', () => {
  for (const width of [390, 800, 1280]) {
    const node = resolveDocument({ ...cinematicDoc, routes: { home: copyColumn } }, width).routes.home!;
    if (node.kind !== 'box') throw Error('Expected hero column');
    const pager = resolveDocument({ ...cinematicDoc, routes: { home: heroPager } }, width).routes.home!;
    const env = { query: '', flags: ['search-focused'], small: width < 640,
      home: { hero: [{}, {}] } } as unknown as Env;
    const ctx = { index: 0 };
    const style = node.states.find(state => holds(state.when, ctx, env))?.layer.style;
    expect(style?.height).toBe(width < 640 ? '72px' : '82px');
    expect(holds(node.children[0]!.when, ctx, env)).toBe(false);
    expect(holds(pager.when, ctx, env)).toBe(false);
    env.flags = [];
    expect(holds(node.children[0]!.when, ctx, env)).toBe(true);
    expect(holds(pager.when, ctx, env)).toBe(true);
    env.query = 'Fall';
    expect(node.states.find(state => holds(state.when, ctx, env))?.layer.style.height).toBe(width < 640 ? '72px' : '82px');
  }
});

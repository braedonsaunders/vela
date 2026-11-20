import { expect, test } from 'bun:test';
import { resolveDocument } from '../src/resolve';
import { sameRouteHost } from '../src/route-host';
import type { SkinHost } from '../src/host';
import { cinematicDoc } from '../../protocol/fixtures/skins/cinematic';
import mochi from '../../protocol/fixtures/skins/mochi/document';
import marquee from '../../protocol/fixtures/skins/marquee/document';
import jellytwin from '../../protocol/fixtures/skins/jellytwin/document';
import index from '../../protocol/fixtures/skins/index/document';
import lounge from '../../protocol/fixtures/skins/lounge/document';
import latenight from '../../protocol/fixtures/skins/latenight/document';
import kids from '../../protocol/fixtures/skins/kids/document';
import broadcast from '../../protocol/fixtures/skins/broadcast/document';
import { holds } from '../src/resolve';
import type { RNode } from '../src/resolve';

test('built-in home routes remain independent of the shell profile menu', () => {
  for (const document of [cinematicDoc, mochi, marquee, jellytwin, index, lounge, latenight, kids, broadcast]) {
    const doc = resolveDocument(document, 1280);
    const a = { doc, env: { flags: [] } } as unknown as SkinHost;
    const b = { ...a, env: { ...a.env, flags: ['menu'] } };
    expect(sameRouteHost(a, b, [doc.routes.home, doc.libraryViews]), document.name).toBe(true);
  }
});

test('the inherited profile menu has a modal outside-press layer', () => {
  const shell = resolveDocument(cinematicDoc, 1280).shell!;
  const dismiss = find(shell, node => node.kind === 'box' && node.testId === 'profile-menu-dismiss');
  expect(dismiss?.kind).toBe('box');
  if (dismiss?.kind !== 'box') return;

  expect(dismiss.press).toEqual({ action: 'close', arg: 'menu' });
  expect(holds(dismiss.when, { index: 0 }, { viewer: 'Demo', flags: ['menu'] } as never)).toBe(true);
  expect(holds(dismiss.when, { index: 0 }, { viewer: 'Demo', flags: [] } as never)).toBe(false);
  expect(dismiss.base.style).toMatchObject({ position: 'absolute', top: '0px', right: '0px', bottom: '0px', left: '0px', 'z-index': '29' });
});

function find(node: RNode, predicate: (node: RNode) => boolean): RNode | undefined {
  if (predicate(node)) return node;
  if (node.kind === 'box') for (const child of node.children) {
    const found = find(child, predicate);
    if (found) return found;
  }
  return node.kind === 'repeat' ? find(node.item, predicate) : undefined;
}

import { expect, test } from 'bun:test';
import { resolveDocument, type RNode } from '../src/resolve';
import lounge from '../../protocol/fixtures/skins/lounge/document';

const find = (node: RNode, match: (node: RNode) => boolean): RNode | undefined => {
  if (match(node)) return node;
  if (node.kind === 'box') for (const child of node.children) { const found = find(child, match); if (found) return found; }
  if (node.kind === 'repeat') return find(node.item, match);
  return undefined;
};
const byTestId = (shell: RNode, id: string) => find(shell, node => node.testId === id);
const px = (value: unknown) => Number(String(value).replace('px', ''));

test('Lounge phones open every destination from one menu instead of a clipped tab capsule', () => {
  const phone = resolveDocument(lounge, 390).shell!;
  const tv = resolveDocument(lounge, 1440).shell!;

  const trigger = byTestId(phone, 'mobile-navigation');
  expect(trigger?.base.style.display).toBe('flex');
  expect(trigger?.kind === 'box' && trigger.press).toEqual({ action: 'only', arg: 'navigation' });
  expect(trigger?.a11y?.expanded).toHaveLength(1);
  expect(byTestId(tv, 'mobile-navigation')?.base.style.display).toBe('none');

  // The tab capsule gives way on phones and stays on the TV.
  const capsule = (shell: RNode) => find(shell, node => node.kind === 'box' && node.children.some(child => child.kind === 'box' && child.children.some(c => c.testId === 'nav-home')));
  expect(capsule(phone)?.base.style.display).toBe('none');
  expect(capsule(tv)?.base.style.display).not.toBe('none');

  // The sheet: Escape closes it, focus returns to the trigger, and Live TV keeps its place.
  const sheet = find(phone, node => node.escape?.includes('navigation') ?? false)!;
  expect(sheet.returnFocus).toBe('lounge-navigation');
  const ids: string[] = [];
  find(sheet, node => { if (node.testId) ids.push(typeof node.testId === 'string' ? node.testId : node.testId.parts.map(p => typeof p === 'string' ? p : '*').join('')); return false; });
  expect(ids).toEqual(['nav-sheet-home', 'nav-sheet-*', 'nav-sheet-live']);
  expect(byTestId(sheet, 'nav-sheet-live')?.when).toHaveLength(2);
});

test('Lounge phone controls are at least 44px', () => {
  const phone = resolveDocument(lounge, 390).shell!;
  const trigger = byTestId(phone, 'mobile-navigation')!;
  const search = byTestId(phone, 'nav-search-phone')!;
  const profile = byTestId(phone, 'profile-menu')!;
  const badge = profile.kind === 'box' ? profile.children[0]! : profile;
  expect(px(trigger.base.style.height)).toBeGreaterThanOrEqual(44);
  expect([px(search.base.style.width), px(search.base.style.height)]).toEqual([44, 44]);
  expect([px(badge.base.style.width), px(badge.base.style.height)]).toEqual([44, 44]);
});

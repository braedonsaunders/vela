import { expect, test } from 'bun:test';
import { pointerPolicy, type PointerMode } from '../src/pointer-policy';
import lateNightDoc from '../../protocol/fixtures/skins/latenight/document';
import { resolveDocument, type RNode } from '../src/resolve';

test('a disabled CSS container permits explicitly enabled descendants', () => {
  const parent = pointerPolicy('none', 'auto');
  expect(parent.box).toBe('box-none');
  expect(pointerPolicy(undefined, parent.content).content).toBe('none');
  expect(pointerPolicy('auto', parent.content).content).toBe('auto');
  expect(pointerPolicy(undefined, 'auto').box).toBe('auto');
  expect(pointerPolicy('box-none', 'none').content).toBe('auto');
});

test('Late Night profile is interactive while its decorative glass stays transparent', () => {
  const shell = resolveDocument(lateNightDoc, 1280).shell!;
  let profile: PointerMode | undefined;
  let decorative = 0;
  function visit(node: RNode, inherited: PointerMode) {
    const policy = pointerPolicy(node.base.style['pointer-events'], inherited);
    if (node.testId === 'profile-menu') profile = policy.content;
    if (node.base.style['pointer-events'] === 'none') {
      expect(policy.box).toBe('box-none');
      decorative++;
    }
    if (node.kind === 'box') node.children.forEach(child => visit(child, policy.content));
  }
  visit(shell, 'auto');
  expect(profile).toBe('auto');
  expect(decorative).toBeGreaterThan(2);
});

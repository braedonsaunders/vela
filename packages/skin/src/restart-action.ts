import type { RNode } from './resolve';

type Box = Extract<RNode, { kind: 'box' }>;

/** Reuse the skin's title secondary action, without requiring an available trailer. */
export function secondaryPlayAction(root: RNode | undefined): Box | undefined {
  if (root?.kind === 'repeat' && root.over === 'detail.trailers') return secondaryPlayAction(root.item);
  if (root?.kind !== 'box') return undefined;
  if (root.press?.action === 'playExtra') return root;
  for (const child of root.children) {
    const found = secondaryPlayAction(child);
    if (found) return found;
  }
  return undefined;
}

export function restartAction(primary: Box, secondary: Box | undefined, arg: string, label: string): Box {
  const template = secondary ?? primary;
  let labelled = false;
  const content = (node: RNode): RNode[] => {
    if (node.kind === 'text') {
      if (labelled) return [];
      labelled = true;
      return [{ ...node, when: [], text: label }];
    }
    return [{ ...node, when: [], ...(node.kind === 'box' ? { children: node.children.flatMap(content) } : {}) }];
  };
  return { ...template, id: undefined, testId: undefined, motion: undefined, stagger: undefined,
    when: [], disabled: undefined, states: [], label, press: { action: 'play', arg },
    base: { ...template.base, style: { ...template.base.style, 'border-radius': '9999px' } },
    children: template.children.flatMap(content) };
}

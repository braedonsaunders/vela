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

const drawn = (node: RNode): boolean => node.kind !== 'box' || node.children.some(drawn);

/** `compact` draws the restart mark alone in a 44px circle, for a row with no room for words. */
export function restartAction(primary: Box, secondary: Box | undefined, arg: string, label: string, compact = false): Box {
  const template = secondary ?? primary;
  let labelled = false;
  const content = (node: RNode): RNode[] => {
    if (node.kind === 'text') {
      if (labelled) return [];
      labelled = true;
      return [{ ...node, when: [], text: label }];
    }
    if (node.kind !== 'box') return [{ ...node, when: [] }];
    // A box with no words or marks in it is decoration, such as the primary's progress track:
    // a restart starts from nothing, so it draws none.
    const children = node.children.flatMap(content);
    return children.some(drawn) ? [{ ...node, when: [], children }] : [];
  };
  const restart: Box = { ...template, id: undefined, testId: undefined, motion: undefined, stagger: undefined,
    when: [], disabled: undefined, states: [], label, press: { action: 'play', arg },
    base: { ...template.base, style: { ...template.base.style, 'border-radius': '9999px', 'justify-content': 'center' } },
    children: template.children.flatMap(content) };
  if (!compact) return restart;
  const mark: RNode = { kind: 'icon', symbol: 'restart', when: [], states: [], group: false, order: 0, base: { style: { width: '18px', height: '18px' } } };
  return { ...restart, children: [mark], base: { ...restart.base, style: { ...restart.base.style,
    width: '44px', height: '44px', 'min-width': '44px', padding: '0px', 'padding-left': '0px', 'padding-right': '0px',
    display: 'flex', 'align-items': 'center', 'justify-content': 'center', 'flex-shrink': '0' } } };
}

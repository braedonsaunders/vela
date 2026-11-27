import type { ViewStyle } from 'react-native';
import type { RNode } from './resolve';

type Box = Extract<RNode, { kind: 'box' }>;

/** A phone hero's Resume beside Restart's 44px mark: `pair` holds the two, `resume` holds Resume.
 * Resume keeps its own width (a basis of 0 collapsed it to nothing wherever the pair sized to its
 * content) and takes the room left over. In a column of hero actions the pair spans the column; in
 * a row of them (Late Night's, wrapping) it grows into the line's spare room, and the next action
 * moves to a line of its own when Resume and the mark already fill this one. */
export function heroResumeLayout(parent: 'row' | 'column'): { pair: ViewStyle; resume: ViewStyle } {
  const pair: ViewStyle = { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch', gap: 8 };
  return {
    pair: parent === 'row' ? { ...pair, flexGrow: 1, flexShrink: 1, minWidth: 0 } : pair,
    resume: { flexGrow: 1, flexShrink: 1, minWidth: 0 },
  };
}

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

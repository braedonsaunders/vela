import type { Node } from '../../../protocol/skin';

/** Upgrade document shelves as well as the base, retaining each skin's typography. */
export function withRowLinks(node: Exclude<Node, { type: 'use' }>, seeAll?: Node): Exclude<Node, { type: 'use' }> {
  if (node.type === 'widget' && node.widget === 'sentinel' && (!node.params?.on || node.params.on === 'row')) return { type: 'box' };
  if (node.type === 'text' && node.text === '{row.name}') {
    const { text: _, type: __, ...rest } = node;
    return { ...rest, type: 'widget', widget: 'rowLink' };
  }
  if (node.type !== 'box') return node;
  const repeat = node.children?.find(child => child.type === 'repeat' && child.over === 'row.items');
  if (!repeat || repeat.type !== 'repeat') return node;
  // Old end cells contained a sentinel. Paging now belongs exclusively to the full page.
  const children = node.children!.filter(child => !(child.type === 'box' && child.children?.some(n => n.type === 'widget' && n.widget === 'sentinel' && (!n.params?.on || n.params.on === 'row'))));
  const styled = seeAll && seeAll.type !== 'use' ? seeAll : undefined;
  return { ...node, children: [...children, { ...styled, type: 'widget', widget: 'rowLink',
    params: { ...(styled?.type === 'widget' ? styled.params : {}), end: 'true', ...(repeat.limit ? { limit: String(repeat.limit) } : {}) },
    style: { ...styled?.style, 'flex-shrink': '0' } }] };
}

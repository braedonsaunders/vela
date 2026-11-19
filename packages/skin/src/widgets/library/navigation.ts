import type { Node } from '../../../../protocol/skin';

/** A shell can host view tabs beside its destinations, leaving the page toolbar for filters. */
export function shellHasLibraryTabs(node: Node | undefined): boolean {
  if (!node) return false;
  if (node.type === 'widget') return node.widget === 'libraryTabs';
  if (node.type === 'box') return node.children?.some(shellHasLibraryTabs) ?? false;
  if (node.type === 'repeat') return shellHasLibraryTabs(node.item);
  return false;
}

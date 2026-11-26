// A music, book or audiobook title opens in the document's own title page (docs/media-kinds.md):
// the same frame, scrim, opening motion and close control as a film, with the media page drawn in
// the frame's scroll region in place of the film's sections. Each document keeps its look.
import type { Node } from '../../../protocol/skin';
import type { RNode } from '../resolve';

/** The id every title page gives the region that scrolls inside its frame. */
export const TITLE_SCROLL_ID = '{env.route}-scroll-{env.entry}';

/** Whether a node (or anything inside it) closes the page: the close strip a phone draws in the
 * scroll region, which the media page keeps. */
function closes(node: Node): boolean {
  if ((node.type === 'box') && (node.press?.action === 'back' || node.press?.action === 'close') && !node.press.arg) return true;
  return node.type === 'box' && !!node.children?.some(closes);
}

/** The title page with its scroll region holding the media page, or undefined when the page has
 * no such region (the app then draws the media page on a page of its own). */
export function mediaTitleTree(title: Node | undefined): Node | undefined {
  if (!title) return undefined;
  let found = false;
  const walk = (node: Node): Node => {
    if (node.type !== 'box' || !node.children) return node;
    if (node.id === TITLE_SCROLL_ID) {
      found = true;
      // The page's loading and failure states are the media page's own (it says so and retries).
      const kept = node.children.filter(child => closes(child) && !child.when?.some(condition => condition.test === 'env.load'));
      return { ...node, children: [{ type: 'widget', widget: 'mediaPage', style: { 'flex-shrink': '0' } }, ...kept] };
    }
    return { ...node, children: node.children.map(walk) };
  };
  const tree = walk(title);
  return found ? tree : undefined;
}

/** Reuse the resolved title frame and host a built-in page in its media slot. */
export function inlineMediaTitleTree(node: RNode): RNode {
  if (node.kind === 'widget' && node.widget === 'mediaPage') {
    const { widget: _widget, params: _params, ...common } = node;
    return { ...common, kind: 'slot', slot: 'children' };
  }
  if (node.kind !== 'box') return node;
  const children = node.children.map(inlineMediaTitleTree);
  return children.every((child, index) => child === node.children[index]) ? node : { ...node, children };
}

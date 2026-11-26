// Which document boxes only draw (render.tsx PlainBox): no press or focus of their own, no group,
// scroll, grid, pager, sticky, mask, blur, background image, motion, menu, measuring row or reading
// stop. Most boxes in a card (its art frame, gloss, badges, caption) are such boxes, and each paid
// for the whole Box component: some forty-five hooks, half a dozen effects and six context
// providers per box, for every card a row or grid draws. The answer depends on the node alone (its
// authored rows in every state), so a box never switches between the two components as it redraws.
import type { CssT, RNode, Template } from './resolve';

type BoxNode = Extract<RNode, { kind: 'box' }>;

const answers = new WeakMap<BoxNode, boolean>();

/** Literal text of a template, its holes as `{}`. */
function text(template: Template | undefined): string {
  if (template === undefined) return '';
  return typeof template === 'string' ? template : template.parts.map(part => (typeof part === 'string' ? part : '{}')).join('');
}

/** A row that makes Box draw something PlainBox does not: a scroll, a grid, a sticky header, a
 * native mask or blur, a url() background. A bound value could be any of them. */
function special(row: string, value: Template): boolean {
  const literal = typeof value === 'string' ? value.trim() : null;
  switch (row) {
    case 'display': return literal === null || literal === 'grid';
    case 'overflow': case 'overflow-x': case 'overflow-y':
      return literal === null || literal === 'auto' || literal === 'scroll';
    case 'position': return literal === null || literal === 'sticky';
    case 'background-image': case 'background': return literal === null || literal.includes('url(');
    case 'grid-template-columns': case 'mask-image': case '-webkit-mask-image': case 'mask':
    case 'backdrop-filter': case '-webkit-backdrop-filter':
      return true;
    default: return false;
  }
}

function layers(node: BoxNode): (CssT | undefined)[] {
  const looks = (layer: BoxNode['base']) => [layer.style, layer.hover, layer.focus, layer.groupHover, layer.groupFocus];
  return [...looks(node.base), ...node.states.flatMap(state => looks(state.layer)), node.active, node.disabledStyle];
}

/** Whether a box only draws. */
export function plainBox(node: BoxNode): boolean {
  const known = answers.get(node);
  if (known !== undefined) return known;
  const id = text(node.id);
  const testId = text(node.testId);
  const plain = !node.press && !node.group && !node.escape?.length && !node.pager && !node.motion && !node.onChange
    && !node.fit && !node.navMore && !node.readingStop && !node.readingStopWhen?.length && node.role !== 'navigation'
    // Boxes the renderer knows by id: the library's views row and the search groups' grids.
    && !id.includes('vela-library') && !id.includes('vela-search-server-grid')
    && testId !== 'detail-close' && testId !== 'detail-back'
    && !layers(node).some(css => Object.entries(css ?? {}).some(([row, value]) => special(row, value)));
  answers.set(node, plain);
  return plain;
}

import type { CssT, Layer, RNode } from './resolve';

const choices = new WeakMap<RNode, boolean>();
const transitions = (rows: CssT | undefined) => rows?.transition !== undefined;
const animatedLayer = (layer: Layer) => [layer.style, layer.hover, layer.focus, layer.groupHover, layer.groupFocus].some(transitions);

/** Choose once from every authored look. A hover/state change must never replace the native
 * component (and lose focus or cancel a touch), but static nodes need no animation machinery. */
export function needsAnimatedFrame(node: RNode): boolean {
  const previous = choices.get(node);
  if (previous !== undefined) return previous;
  const animated = !!node.motion || animatedLayer(node.base) || node.states.some(state => animatedLayer(state.layer))
    || transitions(node.active) || transitions(node.disabledStyle);
  choices.set(node, animated);
  return animated;
}

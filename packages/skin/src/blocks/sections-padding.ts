// The padding an experience page's root `sections` gives its scroll content (blocks/sections.tsx):
// the node's own padding rows from the style in force: its viewport, TV, fold and platform variants
// (already in its resolved style), replaced by the first state that holds (a compact shell with a
// queue leaves room for the mini player). Pure, so it is tested without React Native.
import { fill, holds, type RNode } from '../resolve';
import type { Ctx, Env } from '../vocabulary';
import { parsePoints } from './layout-math';

export interface ContentPadding { top?: number; bottom?: number; left?: number; right?: number }

export function sectionsContentPadding(node: Pick<RNode, 'base' | 'states'>, ctx: Ctx, env: Env, px: (n: number) => number): ContentPadding {
  const style = node.states?.find(state => holds(state.when, ctx, env))?.layer.style ?? node.base.style;
  const row = (name: string) => {
    const raw = style?.[name];
    return raw === undefined ? undefined : parsePoints(fill(raw, ctx, env), px, 0);
  };
  const all = row('padding');
  const pick = (side: string) => row(`padding-${side}`) ?? all;
  return { top: pick('top'), bottom: pick('bottom'), left: pick('left'), right: pick('right') };
}

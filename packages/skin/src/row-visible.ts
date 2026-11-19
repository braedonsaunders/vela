import { holds, type RNode } from './resolve';
import type { Ctx, Env } from './vocabulary';

/** Count the active shelf's document limit, including ranked/viewport variants. */
export function visibleRowItems(node: RNode, ctx: Ctx, env: Env): number {
  const limits: number[] = [];
  const visit = (node: RNode) => {
    if (!holds(node.when, ctx, env)) return;
    if (node.kind === 'repeat') {
      if (node.over === 'row.items') limits.push(node.limit);
      return;
    }
    if (node.kind === 'box') node.children.forEach(visit);
  };
  visit(node);
  return Math.min(ctx.row?.items.length ?? 0, limits.length ? Math.max(...limits) : Infinity);
}

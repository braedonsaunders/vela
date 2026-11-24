// Where render.tsx draws a renderer 19 block (docs/plugin-screens.md: Building blocks): W3's
// blocks (packages/skin/src/blocks), through the runtime the screen host provides.
import type { RNode } from '../resolve';
import type { Ctx } from '../vocabulary';
import { Block, type AnyBlockNode } from '../blocks';

type BlockNode = Extract<RNode, { kind: AnyBlockNode['kind'] }>;

export function BlockView({ node, ctx }: { node: BlockNode; ctx: Ctx }) {
  return <Block node={node as AnyBlockNode} ctx={ctx} />;
}

// Types and runtime context shared by renderer-19 layout blocks (`packages/skin/src/blocks/*`).
// Bridges W1's resolved block `RNode` shapes (`resolveScreenDocument`) and W2's `@vela/core` page/record
// hooks with `SkinNode` from `render.tsx`.
import { createContext, useContext, type ReactElement } from 'react';
import { BLOCK_KINDS, type BlockKind, type RNode, type Template } from '../resolve';
import type { Value } from '../screen/holes';
import { screenItemKey, screenItems, tabCtx, type Items } from '../screen/items';
import type { Card, Ctx, Env } from '../vocabulary';
import { nonSubscribingItemKey } from './record-scope';

export { BLOCK_KINDS, type BlockKind };

export type ScreenValueReader = Value;
export type ScreenItemsSpec = Items;

export type SectionsBlockNode = Extract<RNode, { kind: 'sections' }>;
export type ShelfBlockNode = Extract<RNode, { kind: 'shelf' }>;
export type GridBlockNode = Extract<RNode, { kind: 'grid' }>;
export type MarqueeBlockNode = Extract<RNode, { kind: 'marquee' }>;
export type TabsBlockNode = Extract<RNode, { kind: 'tabs' }> & { after?: RNode[] };
export type TableBlockNode = Extract<RNode, { kind: 'table' }>;
export type LineGraphBlockNode = Extract<RNode, { kind: 'lineGraph' }>;
export type PlayerBlockNode = Extract<RNode, { kind: 'player' }>;
export type ParamInputBlockNode = Extract<RNode, { kind: 'paramInput' }>;
export type TitleCardBlockNode = Extract<RNode, { kind: 'titleCard' }>;

export type AnyBlockNode =
  | SectionsBlockNode
  | ShelfBlockNode
  | GridBlockNode
  | MarqueeBlockNode
  | TabsBlockNode
  | TableBlockNode
  | LineGraphBlockNode
  | PlayerBlockNode
  | ParamInputBlockNode
  | TitleCardBlockNode;

export interface BlockRNodeCommon {
  id?: Template;
  testId?: Template;
  when?: unknown[];
  needs?: string[];
  label?: Template;
}

export interface ScreenBlockRuntime {
  /** Renders any resolved `RNode` with the given `Ctx`. */
  renderNode(node: unknown, ctx: Ctx): ReactElement | null;
  /** Evaluates a compiled screen collection into child `Ctx` items (`screenItems(node.items, ctx, env)`). */
  evalItems(nodeWithItems: { items: Items }, ctx: Ctx, env: Env): Ctx[];
  /** Evaluates a stable key for a repeated item (`screenItemKey(node.items, itemCtx, env)`). */
  evalItemKey(nodeWithItems: { items: Items }, itemCtx: Ctx, env?: Env): string;
  /** Binds the `$tab` alias (`{$tab.label}`, `{$tab.count}`, `{$tab.on}`) for a `tabs.chip` node (`tabCtx`). */
  bindTabCtx(ctx: Ctx, itemCtx: Ctx | undefined, tab: { label: string; count: string; on: boolean }, as?: string): Ctx;
  /** Requests lazy sources (`needs`) for the current screen page (W2's `vela.screens.need(pageKey, sources)`). */
  requestNeeds?(sources: readonly string[]): void;
  /** Looks up an `item:` record or converts it to a `Card` for `titleCard`. */
  resolveItemCard?(itemKey: string, ctx: Ctx): Card | undefined;
  /** Optional screen title for the hidden web `<h1>` inside `sections`, and presentation mode (`section` | `page`). */
  pageTitle?: string;
  presentation?: 'section' | 'page';
  /** Renderer 20, a page in an experience's shell: the page's key, under which `sections` keeps and
   * restores its scroll (screen/scroll-memory.ts). */
  scrollKey?: string;
}

const ScreenBlockRuntimeContext = createContext<ScreenBlockRuntime | null>(null);

export const ScreenBlockRuntimeProvider = ScreenBlockRuntimeContext.Provider;

export function useScreenBlockRuntime(): ScreenBlockRuntime | null {
  return useContext(ScreenBlockRuntimeContext);
}

/** Creates a default `ScreenBlockRuntime` given a `renderNode` callback and optional screen page handlers. */
export function createScreenBlockRuntime(
  renderNode: (node: unknown, ctx: Ctx) => ReactElement | null,
  options: {
    requestNeeds?(sources: readonly string[]): void;
    resolveItemCard?(itemKey: string, ctx: Ctx): Card | undefined;
    pageTitle?: string;
    presentation?: 'section' | 'page';
    scrollKey?: string;
  } = {},
): ScreenBlockRuntime {
  return {
    renderNode,
    evalItems: (node, ctx, env) => screenItems(node.items, ctx, env),
    evalItemKey: (node, itemCtx, env) =>
      nonSubscribingItemKey(node.items.as, itemCtx, () =>
        screenItemKey(node.items, itemCtx, env ?? ({} as Env)),
      ),
    bindTabCtx: (ctx, itemCtx, tab, as = 'item') => {
      if (itemCtx) {
        const bound = itemCtx.screen?.items[as];
        return tabCtx(ctx, as, bound?.value, itemCtx.index, tab);
      }
      return tabCtx(ctx, as, { id: 'all' }, 0, tab);
    },
    ...options,
  };
}

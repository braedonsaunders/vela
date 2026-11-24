// Where render.tsx draws a renderer 19 block (docs/plugin-screens.md: Building blocks). The blocks
// themselves are W3's (packages/skin/src/blocks); until they join this tree, a minimal stand-in
// draws the layout blocks Sports needs (sections as a column, shelves as a row, tabs as chips)
// so a document page can be seen, and the rest draw nothing. The screen host gives the runtime.
import { createContext, useContext, useEffect, type ReactElement } from 'react';
import { ScrollView, View } from 'react-native';
import { useHost } from '../host';
import { PX } from '../css';
import { fill, holds, type RNode } from '../resolve';
import type { Ctx } from '../vocabulary';
import { screenItemKey, screenItems, tabCtx } from './items';

/** What a block needs from the screen it is drawn in. */
export interface ScreenRuntime {
  /** Draw any resolved node (render.tsx's SkinNode). */
  renderNode(node: RNode, ctx: Ctx): ReactElement | null;
  /** Read lazy sources (a node's `needs`) for this page. */
  need(sources: readonly string[]): void;
  /** The page's title (the hidden heading `sections` gives) and how it is presented. */
  title: string;
  presentation: string;
  /** Points the page's content starts below the top (a section under a floating shell bar). */
  insetTop: number;
}

export const ScreenRuntimeContext = createContext<ScreenRuntime | null>(null);

export function useScreenRuntime(): ScreenRuntime | null {
  return useContext(ScreenRuntimeContext);
}

type Block = Extract<RNode, { kind: 'sections' | 'shelf' | 'grid' | 'marquee' | 'tabs' | 'table' | 'lineGraph' | 'player' | 'paramInput' | 'titleCard' }>;

const px = (value: string | undefined) => {
  const m = /^(-?\d*\.?\d+)px$/.exec(value?.trim() ?? '');
  return m ? Number(m[1]) : undefined;
};

export function BlockView({ node, ctx }: { node: Block; ctx: Ctx }) {
  const runtime = useScreenRuntime();
  const { env } = useHost();
  const needs = node.kind === 'sections' ? node.children.flatMap(child => (holds(child.when, ctx, env) ? child.needs ?? [] : [])) : [];
  const needed = needs.join(',');
  useEffect(() => { if (needed && runtime) runtime.need(needed.split(',')); }, [needed, runtime]);
  if (!runtime) return null;
  switch (node.kind) {
    case 'sections':
      return (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: (px(node.gap) ?? 0) * PX, paddingTop: runtime.insetTop + (env.tv ? 8 : 12) * PX, paddingBottom: 64 * PX }}>
          {node.children.map((child, i) => <View key={i}>{runtime.renderNode(child, ctx)}</View>)}
        </ScrollView>
      );
    case 'shelf': case 'marquee': {
      const width = node.kind === 'shelf' ? px(node.itemWidth) : undefined;
      return (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: px(node.gap) ?? 0 }}>
          {screenItems(node.items, ctx, env).map(item => (
            <View key={screenItemKey(node.items, item, env)} style={width ? { width } : undefined}>{runtime.renderNode(node.item, item)}</View>
          ))}
        </ScrollView>
      );
    }
    case 'grid':
      return (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: px(node.gap) ?? 0 }}>
          {screenItems(node.items, ctx, env).map(item => (
            <View key={screenItemKey(node.items, item, env)} style={{ width: `${100 / node.columns}%` }}>{runtime.renderNode(node.item, item)}</View>
          ))}
        </View>
      );
    case 'tabs': {
      const items = screenItems(node.items, ctx, env);
      const bound = node.bind.param ? ctx.screen?.page.params[node.bind.param] : ctx.screen?.state[node.bind.state ?? ''];
      const current = bound ?? (node.default ? fill(node.default, ctx, env) : '');
      const chip = (option: Ctx, value: string, label: string, count: string, key: string) => {
        const on = value === current;
        const press = node.bind.param
          ? { action: 'setParam' as const, args: { name: node.bind.param, value, ...(node.bind.clear ? { clear: node.bind.clear.join(',') } : {}) } }
          : { action: 'open' as const, arg: `${node.bind.state}=${value}` };
        return <View key={key}>{runtime.renderNode({ ...node.chip, press, role: 'tab' } as RNode, tabCtx(option, '$tab', undefined, option.index, { label, count, on }))}</View>;
      };
      return (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, alignItems: 'center' }}>
          {node.all ? chip(ctx, '', fill(node.all, ctx, env), '', '$all') : null}
          {items.map(item => chip(item, fill(node.value, item, env), fill(node.label, item, env), node.count ? fill(node.count, item, env) : '', screenItemKey(node.items, item, env)))}
          {node.after?.map((child, i) => <View key={`after-${i}`}>{runtime.renderNode(child, ctx)}</View>)}
        </ScrollView>
      );
    }
    default:
      return null;
  }
}

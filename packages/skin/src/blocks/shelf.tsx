// The `shelf` layout block (`docs/plugin-screens.md` §6): virtualised horizontal row of items.
// - Supports `itemWidth`: optional / `"auto"` (items size themselves), fixed length (`"286px"`,
//   `"min(272px, 74vw)"`), percentage (`"100%"`), or `"fit min..max"` (e.g. `"fit 320px..640px"`
//   for standings tables, measuring `tableNaturalWidth + pad * 2 + px(8)` with `pad = px(16)`).
// - Supports `stableOrder`: preserves first-seen key order while mounted so toggling a property
//   (such as `favorite` on a team pill) never reshuffles the shelf under a TV remote.
// - Wraps each repeated item in `ScopedRecordNode` (`useRecordReader`) so a live record push only
//   re-renders the card whose `$record` changed.
// - Wraps the row in a TV `FocusBand` (`TVFocusGuideView autoFocus`) for focus memory.
import { useMemo, useRef } from 'react';
import { FlatList, View, type ViewStyle } from 'react-native';
import { measure, useHost } from '../host';
import { fill, type RNode } from '../resolve';
import { boxStyle } from '../translate';
import type { Ctx, Env } from '../vocabulary';
import { FocusBand } from './focus';
import { applyStableOrder, parseItemWidth, parsePoints, resolveShelfItemWidth } from './layout-math';
import { useBlockLook } from './look';
import { ScopedRecordNode } from './record-scope';
import { normalizeTableData, tableNaturalWidth } from './table-fit';
import { useScreenBlockRuntime, type ShelfBlockNode, type TableBlockNode } from './types';

function findTableBlockInTree(node: unknown): TableBlockNode | null {
  if (!node || typeof node !== 'object') return null;
  const n = node as { kind?: string; children?: unknown[] };
  if (n.kind === 'table') return node as TableBlockNode;
  if (Array.isArray(n.children)) {
    for (const child of n.children) {
      const found = findTableBlockInTree(child);
      if (found) return found;
    }
  }
  return null;
}

function measureItemNaturalWidth(
  itemNode: unknown,
  itemCtx: Ctx,
  env: Env,
  px: (n: number) => number,
): number | undefined {
  const tableNode = findTableBlockInTree(itemNode);
  if (!tableNode || typeof tableNode.data !== 'function') return undefined;
  const raw = tableNode.data(itemCtx, env);
  const table = normalizeTableData(raw);
  if (!table) return undefined;
  const compact = tableNode.compact === true;
  // Matches legacy `Tables` shelf: `tableWidth(look, table, compact) + pad * 2 + px(8)`
  // where `pad = px(16)` at all sizes (`small` takes the full available width).
  const pad = px(16);
  return tableNaturalWidth(px, table, compact) + pad * 2 + px(8);
}

function translateOwnStyle(node: RNode, ctx: Ctx, env: Env, host: ReturnType<typeof useHost>): ViewStyle {
  const raw: Record<string, string> = {};
  for (const [k, v] of Object.entries(node.base.style ?? {})) {
    raw[k] = fill(v, ctx, env);
  }
  return boxStyle(raw, measure(host.viewport, 16)).style as ViewStyle;
}

interface ShelfEntry {
  key: string;
  ctx: Ctx;
  width: number | undefined;
}

export function ShelfBlock({ node, ctx }: { node: ShelfBlockNode; ctx: Ctx }) {
  const host = useHost();
  const look = useBlockLook();
  const runtime = useScreenBlockRuntime();
  const { px } = look;
  const seenOrder = useRef<Map<string, number>>(new Map());
  const lastScopeKey = useRef<string>('');

  const availableInnerWidth = Math.max(px(220), look.width - look.gutter * 2);
  const gap = parsePoints(node.gap, px, px(14));
  const parsedWidth = useMemo(
    () => parseItemWidth(node.itemWidth, px, availableInnerWidth, look.width),
    [node.itemWidth, px, availableInnerWidth, look.width],
  );

  // Reset `stableOrder` map when the page's active filter parameters change (just as Sports `Entities`
  // cleared `order.current` when `league` changed).
  const pageParams = ctx.screen?.page.params;
  const scopeKey = pageParams ? JSON.stringify(pageParams) : '';
  if (scopeKey !== lastScopeKey.current) {
    lastScopeKey.current = scopeKey;
    seenOrder.current.clear();
  }

  const rawItems = runtime ? runtime.evalItems(node, ctx, host.env) : [];
  const keyedItems = useMemo(() => {
    if (!runtime) return [];
    const base = rawItems.map((itemCtx, idx) => ({
      key: runtime.evalItemKey(node, itemCtx, host.env) || String(idx),
      ctx: itemCtx,
    }));
    if (!node.stableOrder) return base;
    return applyStableOrder(base, entry => entry.key, seenOrder.current).map((entry, idx) => ({
      ...entry,
      ctx: { ...entry.ctx, index: idx },
    }));
  }, [runtime, node, rawItems, host.env]);

  const entries: ShelfEntry[] = useMemo(() => {
    return keyedItems.map(entry => {
      const natural = parsedWidth.kind === 'fit'
        ? measureItemNaturalWidth(node.item, entry.ctx, host.env, px)
        : undefined;
      return {
        key: entry.key,
        ctx: entry.ctx,
        width: resolveShelfItemWidth(parsedWidth, availableInnerWidth, natural),
      };
    });
  }, [keyedItems, parsedWidth, node.item, host.env, px, availableInnerWidth]);

  if (!runtime) return null;

  if (!entries.length) {
    if (!node.empty) return null;
    return <View style={{ paddingHorizontal: look.gutter }}>{runtime.renderNode(node.empty, ctx)}</View>;
  }

  const ownStyle = translateOwnStyle(node, ctx, host.env, host);
  // Strip any CSS `gap` / `columnGap` from `contentContainerStyle` because `FlatList` spaces
  // horizontal items via `ItemSeparatorComponent` (`width: gap`); leaving `gap` on the flex
  // container would double-apply the gap between items on `react-native-web`.
  const { gap: _ownGap, columnGap: _ownColumnGap, rowGap: _ownRowGap, ...cleanOwnStyle } = ownStyle as ViewStyle & {
    gap?: unknown;
    columnGap?: unknown;
    rowGap?: unknown;
  };
  const hasOwnPadding =
    cleanOwnStyle.padding !== undefined ||
    cleanOwnStyle.paddingHorizontal !== undefined ||
    cleanOwnStyle.paddingVertical !== undefined ||
    cleanOwnStyle.paddingLeft !== undefined ||
    cleanOwnStyle.paddingRight !== undefined ||
    cleanOwnStyle.paddingTop !== undefined ||
    cleanOwnStyle.paddingBottom !== undefined;

  const contentContainerStyle: ViewStyle = hasOwnPadding
    ? cleanOwnStyle
    : {
        paddingHorizontal: look.gutter,
        paddingVertical: px(8),
        ...cleanOwnStyle,
      };

  const fixedWidth = parsedWidth.kind === 'fixed' ? parsedWidth.width : undefined;
  const fixedStride = fixedWidth !== undefined ? fixedWidth + gap : undefined;
  const initialCount = fixedStride
    ? Math.min(entries.length, Math.max(3, Math.ceil(look.width / fixedStride) + 1))
    : Math.min(entries.length, 6);

  return (
    <FocusBand>
      <FlatList
        horizontal
        data={entries}
        keyExtractor={item => item.key}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={contentContainerStyle}
        ItemSeparatorComponent={() => <View style={{ width: gap }} />}
        initialNumToRender={initialCount}
        maxToRenderPerBatch={4}
        windowSize={5}
        getItemLayout={
          fixedWidth !== undefined && fixedStride !== undefined
            ? (_, index) => ({
                length: fixedStride,
                offset: look.gutter + index * fixedStride,
                index,
              })
            : undefined
        }
        renderItem={({ item }) => (
          <View style={item.width !== undefined ? { width: item.width } : undefined}>
            <ScopedRecordNode node={node.item} ctx={item.ctx} renderNode={runtime.renderNode} />
          </View>
        )}
      />
    </FocusBand>
  );
}

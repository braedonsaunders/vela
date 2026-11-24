// The `shelf` layout block (`docs/plugin-screens.md` §6): virtualised horizontal row of items.
// - Supports `itemWidth`: optional / `"auto"` (items size themselves), fixed length (`"286px"`),
//   percentage (`"100%"`), or `"fit min..max"` (e.g. `"fit 320px..640px"` for standings tables,
//   measuring `tableNaturalWidth + pad * 2 + px(8)` with `pad = px(16)`).
// - Supports `stableOrder`: preserves first-seen key order while mounted so toggling a property
//   (such as `favorite` on a team pill) never reshuffles the shelf under a TV remote.
// - Wraps the row in a TV `FocusBand` (`TVFocusGuideView autoFocus`) for focus memory.
import { useMemo, useRef } from 'react';
import { FlatList, View } from 'react-native';
import { useHost } from '../host';
import type { Ctx, Env } from '../vocabulary';
import { FocusBand } from './focus';
import { applyStableOrder, parseItemWidth, parsePoints, resolveShelfItemWidth } from './layout-math';
import { useBlockLook } from './look';
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
    () => parseItemWidth(node.itemWidth, px, availableInnerWidth),
    [node.itemWidth, px, availableInnerWidth],
  );

  // Reset `stableOrder` map when the page's active filter parameters change (just as Sports `Entities`
  // cleared `order.current` when `league` changed).
  const pageParams = (ctx as { screen?: { page?: { params?: Record<string, string> } } }).screen?.page?.params;
  const scopeKey = pageParams ? JSON.stringify(pageParams) : '';
  if (scopeKey !== lastScopeKey.current) {
    lastScopeKey.current = scopeKey;
    seenOrder.current.clear();
  }

  const rawItems = runtime ? runtime.evalItems(node, ctx, host.env) : [];
  const keyedItems = useMemo(() => {
    if (!runtime) return [];
    const base = rawItems.map((itemCtx, idx) => ({
      key: runtime.evalItemKey(node, itemCtx) || String(idx),
      ctx: itemCtx,
    }));
    if (!node.stableOrder) return base;
    return applyStableOrder(base, entry => entry.key, seenOrder.current).map((entry, idx) => ({
      ...entry,
      ctx: { ...entry.ctx, index: idx },
    }));
  }, [runtime, node, rawItems]);

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

  const fixedStride = parsedWidth.kind === 'fixed' ? parsedWidth.width + gap : undefined;
  const initialCount = fixedStride
    ? Math.min(entries.length, Math.max(3, Math.ceil(look.width / fixedStride) + 1))
    : Math.min(entries.length, 4);

  return (
    <FocusBand>
      <FlatList
        horizontal
        data={entries}
        keyExtractor={item => item.key}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: look.gutter,
          paddingVertical: px(8),
        }}
        ItemSeparatorComponent={() => <View style={{ width: gap }} />}
        initialNumToRender={initialCount}
        maxToRenderPerBatch={4}
        windowSize={5}
        getItemLayout={
          fixedStride
            ? (_, index) => ({
                length: parsedWidth.width,
                offset: look.gutter + index * fixedStride,
                index,
              })
            : undefined
        }
        renderItem={({ item }) => (
          <View style={item.width !== undefined ? { width: item.width } : undefined}>
            {runtime.renderNode(node.item, item.ctx)}
          </View>
        )}
      />
    </FocusBand>
  );
}

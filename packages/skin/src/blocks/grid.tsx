// The `grid` layout block (`docs/plugin-screens.md` §6): wrapping grid of `columns` per class,
// chunked and virtualised by row, with each row wrapped in a TV `FocusBand`.
import { useMemo } from 'react';
import { View } from 'react-native';
import { useHost } from '../host';
import type { Ctx } from '../vocabulary';
import { FocusBand } from './focus';
import { chunkGridRows, parsePoints } from './layout-math';
import { useBlockLook } from './look';
import { useScreenBlockRuntime, type GridBlockNode } from './types';

export function GridBlock({ node, ctx }: { node: GridBlockNode; ctx: Ctx }) {
  const host = useHost();
  const look = useBlockLook();
  const runtime = useScreenBlockRuntime();
  const { px } = look;

  const columns = Math.max(1, Math.floor(node.columns) || 1);
  const gap = parsePoints(node.gap, px, px(14));

  const rawItems = runtime ? runtime.evalItems(node, ctx, host.env) : [];
  const rows = useMemo(() => {
    if (!runtime) return [];
    const keyed = rawItems.map((itemCtx, idx) => ({
      key: runtime.evalItemKey(node, itemCtx) || String(idx),
      ctx: itemCtx,
    }));
    return chunkGridRows(keyed, columns);
  }, [runtime, node, rawItems, columns]);

  if (!runtime || !rows.length) return null;

  return (
    <View style={{ paddingHorizontal: look.gutter, gap }}>
      {rows.map((row, rIdx) => (
        <FocusBand key={row[0]?.key ?? `row-${rIdx}`}>
          <View style={{ flexDirection: 'row', gap }}>
            {row.map(cell => (
              <View key={cell.key} style={{ flex: 1 }}>
                {runtime.renderNode(node.item, cell.ctx)}
              </View>
            ))}
            {row.length < columns
              ? Array.from({ length: columns - row.length }, (_, filler) => (
                  <View key={`empty-${filler}`} style={{ flex: 1 }} pointerEvents="none" />
                ))
              : null}
          </View>
        </FocusBand>
      ))}
    </View>
  );
}

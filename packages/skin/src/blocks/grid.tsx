// The `grid` layout block (`docs/plugin-screens.md` §6): wrapping grid of `columns` per class,
// chunked and virtualised by row, with each row wrapped in a TV `FocusBand`.
import { useMemo } from 'react';
import { View, type ViewStyle } from 'react-native';
import { measure, useHost } from '../host';
import { fill, type RNode } from '../resolve';
import { boxStyle } from '../translate';
import type { Ctx, Env } from '../vocabulary';
import { FocusBand } from './focus';
import { chunkGridRows, parsePoints } from './layout-math';
import { useBlockLook } from './look';
import { useScreenBlockRuntime, type GridBlockNode } from './types';

function translateOwnStyle(node: RNode, ctx: Ctx, env: Env, host: ReturnType<typeof useHost>): ViewStyle {
  const raw: Record<string, string> = {};
  for (const [k, v] of Object.entries(node.base.style ?? {})) {
    raw[k] = fill(v, ctx, env);
  }
  return boxStyle(raw, measure(host.viewport, 16)).style as ViewStyle;
}

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
      key: runtime.evalItemKey(node, itemCtx, host.env) || String(idx),
      ctx: itemCtx,
    }));
    return chunkGridRows(keyed, columns);
  }, [runtime, node, rawItems, columns, host.env]);

  if (!runtime || !rows.length) return null;

  const ownStyle = translateOwnStyle(node, ctx, host.env, host);
  const hasOwnPadding =
    ownStyle.padding !== undefined ||
    ownStyle.paddingHorizontal !== undefined ||
    ownStyle.paddingVertical !== undefined ||
    ownStyle.paddingLeft !== undefined ||
    ownStyle.paddingRight !== undefined ||
    ownStyle.paddingTop !== undefined ||
    ownStyle.paddingBottom !== undefined;

  const containerStyle: ViewStyle = hasOwnPadding
    ? { gap, ...ownStyle }
    : { paddingHorizontal: look.gutter, gap, ...ownStyle };

  return (
    <View style={containerStyle}>
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

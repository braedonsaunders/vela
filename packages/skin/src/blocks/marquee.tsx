// The `marquee` layout block: horizontal strip of items over a collection.
import { useMemo } from 'react';
import { ScrollView, View } from 'react-native';
import { useHost } from '../host';
import type { Ctx } from '../vocabulary';
import { FocusBand } from './focus';
import { parsePoints } from './layout-math';
import { useBlockLook } from './look';
import { useScreenBlockRuntime, type MarqueeBlockNode } from './types';

export function MarqueeBlock({ node, ctx }: { node: MarqueeBlockNode; ctx: Ctx }) {
  const host = useHost();
  const look = useBlockLook();
  const runtime = useScreenBlockRuntime();
  const { px } = look;

  const gap = parsePoints(node.gap, px, px(14));
  const rawItems = runtime ? runtime.evalItems(node, ctx, host.env) : [];
  const entries = useMemo(() => {
    if (!runtime) return [];
    return rawItems.map((itemCtx, idx) => ({
      key: runtime.evalItemKey(node, itemCtx, host.env) || String(idx),
      ctx: itemCtx,
    }));
  }, [runtime, node, rawItems, host.env]);

  if (!runtime || !entries.length) return null;

  return (
    <FocusBand>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: look.gutter,
          gap,
          alignItems: 'center',
        }}
      >
        {entries.map(entry => (
          <View key={entry.key}>{runtime.renderNode(node.item, entry.ctx)}</View>
        ))}
      </ScrollView>
    </FocusBand>
  );
}

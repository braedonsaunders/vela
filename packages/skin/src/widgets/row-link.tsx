import { useRef, useState, useEffect } from 'react';
import { Pressable, Text, type HostInstance } from 'react-native';
import { canSeeAll } from '@vela/core';
import { useHost, useInheritedText, type WidgetProps } from '../host';
import { notePress, trackButton } from '../escape';
import { useLook } from './common/look';

/** Shared by every document: shelves never fetch their continuation speculatively. */
export function RowLink({ ctx, params }: WidgetProps) {
  const host = useHost();
  const ink = useInheritedText();
  const look = useLook();
  const [focused, setFocused] = useState(false);
  const ref = useRef<HostInstance>(null);
  const row = ctx.row;
  const end = params.end === 'true';
  const available = !!row && !!host.openRow && canSeeAll(row, ctx.rowVisibleCount ?? (params.limit ? Number(params.limit) : undefined));
  const does = `row:${row?.id}:${end ? 'end' : 'heading'}`;
  useEffect(() => available ? trackButton(ref.current, does) : undefined, [available, does]);
  if (!row) return null;
  if (!available) return end ? null : <Text style={ink.style} accessibilityRole="header">{row.name}</Text>;
  return <Pressable ref={ref} accessibilityRole="button" accessibilityLabel={`See all ${row.name}`}
    onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    onPress={() => { notePress(ref.current, does); host.openRow?.({ ...row, cardStyle: row.cardStyle ?? host.env.library?.model?.presentation?.card }); }}
    style={{ minHeight: 48, justifyContent: 'center', paddingHorizontal: end ? 24 : 0,
      ...(end ? { minWidth: 144, height: 120, marginTop: 16, borderRadius: 12, backgroundColor: look.ui.control } : {}),
      ...(focused ? { borderWidth: 2, borderColor: look.ui.accent, borderRadius: 8 } : {}) }}>
    <Text style={ink.style}>{end ? 'See all' : row.name} ›</Text>
  </Pressable>;
}

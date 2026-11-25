import { useRef, useEffect } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, type HostInstance } from 'react-native';
import { rowLinkAvailable } from '../row-link-available';
import { useHost, useInheritedText, useWidgetInteraction, type WidgetProps } from '../host';
import { notePress, trackButton } from '../escape';
import { rowLinkTakesDirectionalFocus } from '../focus-stop-policy';
import { moveWebRowFocus } from '../web-row-navigation';


/** Shared by every document: shelves never fetch their continuation speculatively. */
export function RowLink({ ctx, params }: WidgetProps) {
  const host = useHost();
  const ink = useInheritedText();
  const interaction = useWidgetInteraction();
  const ref = useRef<HostInstance>(null);
  const row = ctx.row;
  const end = params.end === 'true';
  const available = rowLinkAvailable(row, host.openRow, ctx.rowVisibleCount, params.limit);
  const does = `row:${row?.id}:${end ? 'end' : 'heading'}`;
  useEffect(() => available ? trackButton(ref.current, does) : undefined, [available, does]);
  if (!row) return null;
  if (!available) return end ? null : <Text style={ink.style} accessibilityRole="header" aria-level={2}>{row.name}</Text>;
  const href = host.rowHref?.(row);
  const link = <Pressable ref={ref} accessibilityRole={href ? 'link' : 'button'} accessibilityLabel={`See all ${row.name}`}
    {...(href ? { href } : {})}
    focusable={rowLinkTakesDirectionalFocus(end)}
    {...(Platform.OS === 'web' && !end ? { tabIndex: -1 } : {})}
    {...(Platform.OS === 'web' && end ? {
      // The end card is the row's last stop for the web's arrow keys, as it is for TV focus.
      dataSet: { velaRowItem: 'end' },
      onKeyDown: (event: { key?: string; nativeEvent?: { key?: string }; currentTarget: unknown; preventDefault(): void; stopPropagation(): void }) => {
        const key = event.key ?? event.nativeEvent?.key ?? '';
        if (moveWebRowFocus(event.currentTarget as HTMLElement, key)) { event.preventDefault(); event.stopPropagation(); }
      },
    } : {})}
    onFocus={() => interaction.report('focus', true)} onBlur={() => interaction.report('focus', false)}
    onHoverIn={() => interaction.report('hover', true)} onHoverOut={() => interaction.report('hover', false)}
    onPress={event => {
      if (href) {
        const click = event.nativeEvent as unknown as { button?: number; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean };
        if (click.button === 1 || click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return;
        event.preventDefault();
      }
      notePress(ref.current, does);
      host.openRow?.({ ...row, card: row.card ?? host.env.library?.model?.presentation?.card });
    }}
    style={end ? [StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 }] : { minHeight: 48, justifyContent: 'center' }}>
    <Text style={ink.style}>{end ? 'See all' : row.name} ›</Text>
  </Pressable>;
  // A row's name stays its heading when it also opens the whole row, as it is for rows without one.
  return end ? link : <View accessibilityRole="header" aria-level={2} style={{ alignSelf: 'flex-start' }}>{link}</View>;
}

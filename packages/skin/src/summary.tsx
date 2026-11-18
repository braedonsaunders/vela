// Every title synopsis (including legacy documents binding detail.summary) uses this part.
// Measure an unclamped copy at the same width: short copy is ordinary text, never a dead focus stop.
import { msg } from '@vela/core';
import { useCallback, useContext, useEffect, useRef, useState, type ComponentType } from 'react';
import { Modal, Platform, ScrollView, StyleSheet, Text, TVTextScrollView, View, type ScrollViewProps, type TextStyle, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';
import type { Focusable } from './escape';
import { FocusPressable } from './focus';
import { focusStyle } from './focus-style';
import { isFocusVisible } from './focus-visible';
import { useHost } from './host';
import { holdBack } from './menu-key';
import { useRouteFocusContext } from './route-focus';
import { RevealContext } from './tv-reveal';
import { useFocusClaim } from './widgets/common/focus-claim';
import { useLook } from './widgets/common/look';

const web = Platform.OS === 'web';
// The TV wrapper's generated type mistakenly uses typeof ScrollView instead of its props.
const DescriptionScroll = Platform.isTV ? TVTextScrollView as unknown as ComponentType<ScrollViewProps> : ScrollView;
function focus(target: Focusable | null) {
  if (target?.requestTVFocus) target.requestTVFocus();
  else target?.focus?.();
}

export function ExpandableSummary({ value, lines, style, textStyle }: {
  value: string; lines: number; style: ViewStyle; textStyle: TextStyle;
}) {
  const { env } = useHost();
  const look = useLook();
  const [sizes, setSizes] = useState({ full: 0, clipped: 0 });
  const [nativeLines, setNativeLines] = useState(0);
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const opener = useRef<Focusable | null>(null);
  const routeFocus = useRouteFocusContext();
  const reveal = useContext(RevealContext);
  const truncated = web ? sizes.clipped > 0 && sizes.full > sizes.clipped + 1 : nativeLines > lines;
  const size = (key: keyof typeof sizes, height: number) => setSizes(old => old[key] === height ? old : { ...old, [key]: height });
  const restore = useCallback(() => focus(opener.current), []);
  const close = useCallback(() => {
    setOpen(false);
    requestAnimationFrame(restore);
  }, [restore]);

  useEffect(() => {
    if (!open) return;
    if (!web) return holdBack(() => { close(); return true; });
    // The title route also handles Escape. Consume keydown before it can pop the title;
    // react-native-web's Modal handles only keyup.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing) return;
      event.preventDefault(); event.stopPropagation(); close();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, close]);

  const copy = <Text testID="detail-summary-text" style={textStyle} numberOfLines={lines} ellipsizeMode="tail"
    onLayout={web ? event => size('clipped', event.nativeEvent.layout.height) : undefined}>{value}</Text>;
  return (
    <Animated.View style={style}>
      <View pointerEvents="none" aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 0, overflow: 'hidden', opacity: 0 }}>
        <Text style={textStyle} onLayout={web ? event => size('full', event.nativeEvent.layout.height) : undefined}
          onTextLayout={web ? undefined : event => setNativeLines(event.nativeEvent.lines.length)}>{value}</Text>
      </View>
      {truncated ? (
        <FocusPressable ref={target => { opener.current = target; }} testID="detail-summary-more"
          accessibilityRole="button" accessibilityLabel={msg('detail.readDescription')}
          {...(web && env.tv ? { dataSet: { velaFocus: 'frame' } } : {})}
          accessibilityState={{ expanded: open }}
          {...(web ? { 'aria-expanded': open, 'aria-haspopup': 'dialog' as const } : {})}
          onPress={() => setOpen(true)} onFocus={event => {
            setFocused(isFocusVisible(event.currentTarget)); routeFocus?.focused();
            if (opener.current) reveal?.(opener.current);
          }} onBlur={() => setFocused(false)}
          style={({ pressed }) => [{ padding: 8, margin: -8, borderRadius: 8, opacity: pressed ? 0.8 : 1 }, focused && (env.tv ? { backgroundColor: look.ui.control, transform: [{ scale: env.still ? 1 : 1.015 }], outlineWidth: 0 } : focusStyle(undefined, env.still))]}>
          {copy}
          <Text style={[textStyle, { fontSize: Math.max(14, (textStyle.fontSize ?? 16) * 0.85), fontWeight: '700', marginTop: 6 }]}>{msg('detail.more')} ›</Text>
        </FocusPressable>
      ) : copy}
      {open ? <DescriptionSheet value={value} close={close} restore={restore} /> : null}
    </Animated.View>
  );
}

function DescriptionSheet({ value, close, restore }: { value: string; close(): void; restore(): void }) {
  const { env, viewport } = useHost();
  const pad = env.small ? 16 : 48;
  const look = useLook();
  const preferred = useFocusClaim(true);
  const [focused, setFocused] = useState(false);
  const [reading, setReading] = useState(false);
  const title = env.detail?.title[0];
  return (
    <Modal visible transparent animationType="none" onRequestClose={close} onDismiss={restore}
      supportedOrientations={['portrait', 'landscape']}>
      <View style={[StyleSheet.absoluteFill, {
        alignItems: 'center', justifyContent: 'center', padding: pad, backgroundColor: 'rgba(0,0,0,0.82)',
        paddingLeft: pad + (viewport.sides?.left ?? 0), paddingRight: pad + (viewport.sides?.right ?? 0),
      }]}>
        <View accessibilityViewIsModal style={look.box({
          width: '100%', 'max-width': env.tv ? '960px' : '760px', 'max-height': '85vh', padding: env.small ? '22px' : '40px',
          gap: '24px', 'border-radius': '20px', 'background-color': '$ui.page', border: '1px solid $ui.glassEdge',
        })} testID="description-sheet">
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 20 }}>
            <View style={{ flex: 1, gap: 8 }}>
              <Text accessibilityRole="header" style={look.text({ 'font-size': env.tv ? '36px' : '28px', 'font-weight': '700' })}>{env.route === 'person' ? env.personPage?.name : title?.name}</Text>
              {env.route !== 'person' && title?.yearLabel ? <Text style={look.text({ 'font-size': '18px', color: '$ui.inkSecondary' })}>{title.yearLabel}</Text> : null}
            </View>
            <FocusPressable accessibilityRole="button" accessibilityLabel={msg('detail.closeDescription')}
              testID="description-close" hasTVPreferredFocus={preferred} onPress={close}
              onFocus={event => setFocused(isFocusVisible(event.currentTarget))} onBlur={() => setFocused(false)}
              style={[{ padding: 12, borderRadius: 10, backgroundColor: look.ui.control }, focused && (env.tv ? { backgroundColor: look.ui.control, transform: [{ scale: env.still ? 1 : 1.015 }], outlineWidth: 0 } : focusStyle(undefined, env.still))]}>
              <Text style={look.text({ 'font-size': '17px', 'font-weight': '600' })}>{msg('ui.close')}</Text>
            </FocusPressable>
          </View>
          <DescriptionScroll focusable testID="description-scroll" accessibilityLabel={msg('detail.description')}
            onFocus={event => setReading(isFocusVisible(event.currentTarget))} onBlur={() => setReading(false)}
            style={[{ flexShrink: 1, padding: 4, borderRadius: 6 }, reading && focusStyle(undefined, true)]}
            contentContainerStyle={{ paddingBottom: 8 }}>
            <Text selectable={!Platform.isTV} testID="description-full" style={look.text({ 'font-size': env.tv ? '26px' : '19px', 'line-height': '1.6' })}>{value}</Text>
          </DescriptionScroll>
        </View>
      </View>
    </Modal>
  );
}

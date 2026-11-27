// A plugin screen's page (`presentation: page`), framed as a title page is: a modal over the dimmed
// page it came from on desktop, web and tablets, the whole screen on a TV and a phone. The frame
// rises into place as the scrim dissolves in. Drawn in the active skin's `ui` look.
import { useEffect, type ReactNode } from 'react';
import { Platform, Pressable, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { msg } from '@vela/core';
import type { SkinHost } from '@vela/skin';
import { PillButton } from '@vela/skin/src/blocks/media/parts';
import { PX } from '@vela/skin/src/css';
import { resolveUi } from '@vela/skin/src/resolve/ui';
import { useSideInsets } from './vela';
import { FocusBoundary } from './focus-boundary';
import { MODAL_TEST_ID } from './modal-motion';

export function PageFrame({ host, children, close, active }: { host: SkinHost; children: ReactNode; close(): void; active: boolean }) {
  const ui = resolveUi(host.doc.document.ui);
  const still = host.env.still;
  const sides = useSideInsets();
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const framed = !Platform.isTV && window.width >= 900;
  const radius = Math.min(Math.round(ui.radiusPanel * 0.6 * PX * 2) / 2, 22 * PX);
  const shown = useSharedValue(still ? 1 : 0);
  useEffect(() => {
    if (!still) shown.value = withTiming(1, { duration: 520, easing: Easing.bezier(0.16, 1, 0.3, 1) });
  }, [still, shown]);
  const frameStyle = useAnimatedStyle(() => ({ opacity: shown.value, transform: [{ translateY: (1 - shown.value) * 28 }, { scale: 0.97 + 0.03 * shown.value }] }));
  const scrimStyle = useAnimatedStyle(() => ({ opacity: shown.value }));
  const content = <>
    <View style={{ flexDirection: 'row', paddingHorizontal: 18 * PX, paddingVertical: 6 * PX }}>
      <PillButton label={msg('ui.back')} icon="back" onPress={close} testID="screen-page-back" />
    </View>
    {children}
  </>;
  if (!framed) return (
    // The whole screen, clear of the status bar and of the sides' cutouts (a phone's notch in
    // landscape, a folded iPhone Duo's status strip down its right edge), over the page colour.
    <FocusBoundary active={active} enterWhenReady style={{ flex: 1, backgroundColor: ui.page, paddingTop: Platform.isTV || Platform.OS === 'android' ? 0 : insets.top,
      paddingLeft: sides.paddingLeft, paddingRight: sides.paddingRight }} accessibilityViewIsModal>
      <Animated.View style={[{ flex: 1 }, frameStyle]}>{content}</Animated.View>
    </FocusBoundary>
  );
  return (
    <View testID={MODAL_TEST_ID} style={{ flex: 1 }}>
      <Animated.View style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0, 0, 0, 0.72)' }, scrimStyle]}>
        <Pressable accessibilityLabel="Close" onPress={close} style={{ flex: 1 }} focusable={false} />
      </Animated.View>
      <FocusBoundary active={active} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingLeft: sides.paddingLeft, paddingRight: sides.paddingRight }} pointerEvents="box-none" accessibilityViewIsModal>
        <Animated.View testID="detail-frame" style={[{ width: Math.min(1240, window.width - 96), height: window.height - 72, borderRadius: radius, overflow: 'hidden', backgroundColor: ui.page,
          borderWidth: 1, borderColor: ui.glassEdge, shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 40, shadowOffset: { width: 0, height: 20 } }, frameStyle]}>
          {content}
        </Animated.View>
      </FocusBoundary>
    </View>
  );
}

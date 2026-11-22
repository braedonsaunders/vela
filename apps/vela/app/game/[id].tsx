// A game's page (Sports). Like a title page it opens over the page it came from: a framed modal
// over the dimmed page on desktop, web and tablets, the whole screen on a TV and a phone. Back,
// Menu and Escape close it; on the web so does a click on the dimmed page around the frame.
import { router, useFocusEffect, useIsFocused, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect } from 'react';
import { BackHandler, Platform, Pressable, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { ScreenActive } from '@vela/skin';
import { HostContext } from '@vela/skin/src/host';
import { GamePage, SportsActionsContext, useSportsLook } from '@vela/skin/src/widgets/sports';
import { useSideInsets, useVela } from '../../src/vela';
import { FocusBoundary } from '../../src/focus-boundary';
import { useAppSportsActions } from '../../src/sports/actions';
import { closeModal, MODAL_TEST_ID } from '../../src/modal-motion';

export default function Game() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const vela = useVela();
  const host = vela.host('screen', 'game');
  const focused = useIsFocused();
  const back = useCallback(() => closeModal(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }), []);
  const actions = useAppSportsActions(back);
  useFocusEffect(useCallback(() => {
    if (Platform.OS !== 'web') {
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => { back(); return true; });
      return () => subscription.remove();
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !event.isComposing) { event.preventDefault(); back(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [back]));
  if (!host || !id) return <View style={{ flex: 1 }} />;
  return (
    <ScreenActive.Provider value={focused}>
      <HostContext.Provider value={host}>
        <SportsActionsContext.Provider value={actions}>
          <Frame close={back} active={focused}>
            <GamePage id={id} active={focused} />
          </Frame>
        </SportsActionsContext.Provider>
      </HostContext.Provider>
    </ScreenActive.Provider>
  );
}

/** Framed over a scrim where there is room and no TV; the whole screen otherwise. The frame rises
 * into place as the scrim dissolves in. */
function Frame({ children, close, active }: { children: React.ReactNode; close(): void; active: boolean }) {
  const look = useSportsLook();
  const sides = useSideInsets();
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const framed = !Platform.isTV && window.width >= 900;
  const shown = useSharedValue(look.still ? 1 : 0);
  useEffect(() => {
    if (!look.still) shown.value = withTiming(1, { duration: 520, easing: Easing.bezier(0.16, 1, 0.3, 1) });
  }, [look.still, shown]);
  const frameStyle = useAnimatedStyle(() => ({ opacity: shown.value, transform: [{ translateY: (1 - shown.value) * 28 }, { scale: 0.97 + 0.03 * shown.value }] }));
  const scrimStyle = useAnimatedStyle(() => ({ opacity: shown.value }));
  if (!framed) return (
    <FocusBoundary active={active} enterWhenReady style={{ flex: 1, backgroundColor: look.page, paddingTop: Platform.isTV || Platform.OS === 'android' ? 0 : insets.top }} accessibilityViewIsModal>
      <Animated.View style={[{ flex: 1 }, frameStyle]}>{children}</Animated.View>
    </FocusBoundary>
  );
  return (
    <View testID={MODAL_TEST_ID} style={{ flex: 1 }}>
      <Animated.View style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0, 0, 0, 0.72)' }, scrimStyle]}>
        <Pressable accessibilityLabel="Close" onPress={close} style={{ flex: 1 }} focusable={false} />
      </Animated.View>
      <FocusBoundary active={active} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingLeft: sides.paddingLeft, paddingRight: sides.paddingRight }} pointerEvents="box-none" accessibilityViewIsModal>
        <Animated.View testID="detail-frame" style={[{ width: Math.min(1240, window.width - 96), height: window.height - 72, borderRadius: look.radiusPanel, overflow: 'hidden', backgroundColor: look.page,
          borderWidth: 1, borderColor: look.edge, shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 40, shadowOffset: { width: 0, height: 20 } }, frameStyle]}>
          {children}
        </Animated.View>
      </FocusBoundary>
    </View>
  );
}
